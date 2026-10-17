import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { safeStorage } from '../lib/storage'
import { round2 } from '../lib/format'
import type { GameId } from './games'

/* ------------------------------------------------------------------ */
/*  Economy tuning. Play money only, deliberately slow to earn.        */
/* ------------------------------------------------------------------ */

export const STARTING_BALANCE = 1000
export const MIN_BET = 1
export const MAX_BET = 100_000

/** Daily bonus: 22h cooldown, streak grows the reward, a missed day (48h) resets it. */
export const DAILY_COOLDOWN = 22 * 3600_000
export const DAILY_STREAK_RESET = 48 * 3600_000
export const dailyReward = (streakDay: number) => [100, 125, 150, 200, 250, 300, 500][Math.min(streakDay, 7) - 1]

/** Faucet: only when nearly broke, small top-up, long cooldown. */
export const FAUCET_THRESHOLD = 10
export const FAUCET_AMOUNT = 50
export const FAUCET_COOLDOWN = 30 * 60_000

/** Vault Heist: a skill game that pays coins. Lockpicks cap how often it can be played. */
export const HEIST_MAX_PICKS = 3
export const HEIST_REGEN = 45 * 60_000
/** What the bag holds after cracking vault 1, 2, … 8. */
export const HEIST_LOOT = [10, 25, 50, 90, 150, 250, 400, 650]

export interface HeistState {
  picks: number
  /** when the regen clock last ticked; only meaningful below the cap */
  at: number
  best: number
  earned: number
  runs: number
}

/** Lockpicks available now, and ms until the next one (0 when full). */
export function heistPicks(h: HeistState, now = Date.now()) {
  if (h.picks >= HEIST_MAX_PICKS) return { picks: HEIST_MAX_PICKS, next: 0, gained: 0 }
  const gained = Math.max(0, Math.floor((now - h.at) / HEIST_REGEN))
  const picks = Math.min(HEIST_MAX_PICKS, h.picks + gained)
  return { picks, gained, next: picks >= HEIST_MAX_PICKS ? 0 : h.at + (gained + 1) * HEIST_REGEN - now }
}

/** XP = coins wagered. Each level needs more than the last. */
export const xpForLevel = (lvl: number) => Math.round(2000 * Math.pow(lvl, 1.55))
export const levelReward = (lvl: number) => 75 * lvl
export function levelFromXp(xp: number) {
  let lvl = 0
  let acc = 0
  while (acc + xpForLevel(lvl + 1) <= xp) {
    acc += xpForLevel(lvl + 1)
    lvl++
  }
  return { level: lvl, into: xp - acc, need: xpForLevel(lvl + 1) }
}

/** VIP tier names for level bands; purely cosmetic. */
export const TIERS = [
  { min: 0, name: 'Bronze', color: '#d4925a' },
  { min: 5, name: 'Silver', color: '#c6d2de' },
  { min: 12, name: 'Gold', color: '#f7c548' },
  { min: 25, name: 'Platinum', color: '#7fe3ff' },
  { min: 40, name: 'Diamond', color: '#b892ff' },
] as const
export const tierOf = (level: number) => [...TIERS].reverse().find((t) => level >= t.min)!

/** Bets below this don't count toward challenges, so they can't be farmed with tiny stakes. */
export const CHALLENGE_MIN_BET = 25

export interface BetEvent {
  game: GameId
  bet: number
  payout: number
  /** game-specific details used by challenges */
  meta?: Record<string, number | string | boolean>
}

export interface Challenge {
  id: string
  game?: GameId
  title: string
  desc: string
  reward: number
  goal: number
  /** returns progress after this event (given previous progress) */
  step: (ev: BetEvent, prev: number, s: WalletState) => number
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'explorer',
    title: 'Explorer',
    desc: "Play at least one round in 8 different games (Vault Heist runs don't count).",
    reward: 600,
    goal: 8,
    step: (_e, _p, s) => Object.keys(s.gamesPlayed).length,
  },
  {
    id: 'road-warrior',
    game: 'chicken',
    title: 'Road Warrior',
    desc: 'Cash out Chicken Road at 10× or more on Medium, Hard or Daredevil.',
    reward: 2500,
    goal: 1,
    step: (e, p) =>
      e.game === 'chicken' && e.payout > 0 && e.meta?.difficulty !== 'easy' && e.payout / e.bet >= 10 ? 1 : p,
  },
  {
    id: 'card-shark',
    game: 'blackjack',
    title: 'Card Shark',
    desc: 'Win 5 Blackjack rounds in a row. A push keeps the streak alive; a loss resets it.',
    reward: 2000,
    goal: 5,
    step: (e, p) => {
      if (e.game !== 'blackjack') return p
      if (e.payout > e.bet) return p + 1
      if (e.payout === e.bet) return p // push keeps the streak
      return 0
    },
  },
  {
    id: 'sweeper',
    game: 'mines',
    title: 'Minesweeper',
    desc: 'In Mines, play with 5 or more mines, find at least 8 gems, then cash out.',
    reward: 3000,
    goal: 1,
    step: (e, p) =>
      e.game === 'mines' && e.payout > 0 && Number(e.meta?.mines) >= 5 && Number(e.meta?.gems) >= 8 ? 1 : p,
  },
  {
    id: 'edge-lord',
    game: 'plinko',
    title: 'Edge Lord',
    desc: 'Land a ball in a 100× or higher Plinko slot. Only High risk with 12 or 16 rows has them.',
    reward: 4000,
    goal: 1,
    step: (e, p) => (e.game === 'plinko' && e.payout / e.bet >= 100 ? 1 : p),
  },
  {
    id: 'moonshot',
    game: 'crash',
    title: 'Moonshot',
    desc: 'Cash out of Crash at 25× or higher.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'crash' && e.payout / e.bet >= 25 ? 1 : p),
  },
  {
    id: 'sniper',
    game: 'dice',
    title: 'Sniper',
    desc: 'Win a Dice roll with the win chance set to 2% or lower.',
    reward: 2500,
    goal: 1,
    step: (e, p) => (e.game === 'dice' && e.payout > 0 && Number(e.meta?.chance) <= 2 ? 1 : p),
  },
  {
    id: 'limbo-100',
    game: 'limbo',
    title: 'Over the Bar',
    desc: 'Win a Limbo round with the target set to 100× or higher.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'limbo' && e.payout > 0 && Number(e.meta?.target) >= 100 ? 1 : p),
  },
  {
    id: 'keno-six',
    game: 'keno',
    title: 'Number Cruncher',
    desc: 'Match 6 or more of your numbers in one Keno draw (so pick at least 6).',
    reward: 2500,
    goal: 1,
    step: (e, p) => (e.game === 'keno' && Number(e.meta?.hits) >= 6 ? 1 : p),
  },
  {
    id: 'hilo-run',
    game: 'hilo',
    title: 'Card Counter',
    desc: 'Build a Hi-Lo run to 10× or more, then cash out.',
    reward: 2500,
    goal: 1,
    step: (e, p) => (e.game === 'hilo' && e.payout > 0 && Number(e.meta?.mult) >= 10 ? 1 : p),
  },
  {
    id: 'wheel-jackpot',
    game: 'wheel',
    title: 'Jackpot Spin',
    desc: 'Set Wheel to High risk with 30 or more segments, then land the one segment that pays.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'wheel' && e.meta?.risk === 'high' && Number(e.meta?.segments) >= 30 && e.payout > 0 ? 1 : p),
  },
  {
    id: 'straight-up',
    game: 'roulette',
    title: 'Straight Up',
    desc: 'Win a straight-up bet (a chip on a single number) in Roulette.',
    reward: 1500,
    goal: 1,
    step: (e, p) => (e.game === 'roulette' && e.meta?.straight === true ? 1 : p),
  },
  {
    id: 'cases-legend',
    game: 'cases',
    title: 'Legendary Pull',
    desc: 'Open a legendary item (100× or more) in Cases. Steel, Gold and Obsidian crates can drop one.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'cases' && Number(e.meta?.mult) >= 100 ? 1 : p),
  },
  {
    id: 'battles-royale',
    game: 'battles',
    title: 'Battle Royale',
    desc: 'Win a four-player Case Battle, 1v1v1v1 or 2v2. Sharing the win in a tie counts too.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'battles' && e.meta?.won === true && Number(e.meta?.players) === 4 ? 1 : p),
  },
  {
    id: 'derby-longshot',
    game: 'derby',
    title: 'Long Shot',
    desc: 'Place a Win bet in Duck Derby on a duck paying 8× or more, and have it finish first.',
    reward: 2500,
    goal: 1,
    step: (e, p) => (e.game === 'derby' && e.meta?.longshot === true ? 1 : p),
  },
  {
    id: 'claw-prize',
    game: 'claw',
    title: 'Top Prize',
    desc: 'Grab the 50× octopus or the 100× golden unicorn in Lucky Claw.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'claw' && e.payout > 0 && Number(e.meta?.mult) >= 50 ? 1 : p),
  },
  {
    id: 'double-green',
    game: 'double',
    title: 'Going Green',
    desc: 'Back Green in Double and have the strip land on the green tile.',
    reward: 2000,
    goal: 1,
    step: (e, p) => (e.game === 'double' && e.meta?.green === true ? 1 : p),
  },
  {
    id: 'penalty-perfect',
    game: 'penalty',
    title: 'Perfect Five',
    desc: 'Score five penalties in a row on Hard or Expert in Penalty Shootout, then cash out.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'penalty' && e.payout > 0 && Number(e.meta?.goals) >= 5 && (e.meta?.difficulty === 'hard' || e.meta?.difficulty === 'expert') ? 1 : p),
  },
  {
    id: 'scratch-top',
    game: 'scratch',
    title: 'Jackpot Scratch',
    desc: 'Reveal the top prize on any Scratch & Win card.',
    reward: 3500,
    goal: 1,
    step: (e, p) => (e.game === 'scratch' && e.meta?.top === true ? 1 : p),
  },
  {
    id: 'coinflip-streak',
    game: 'coinflip',
    title: 'Flip Master',
    desc: 'Win 7 Coin Flips in a row, then cash out.',
    reward: 3000,
    goal: 1,
    step: (e, p) => (e.game === 'coinflip' && e.payout > 0 && Number(e.meta?.flips) >= 7 ? 1 : p),
  },
  {
    id: 'plunder-mult',
    game: 'plunder',
    title: 'Sea Legs',
    desc: 'Push the Plunder Bay free-spins multiplier to ×10 or higher.',
    reward: 3500,
    goal: 1,
    step: (e, p) => (e.game === 'plunder' && Number(e.meta?.maxMult) >= 10 ? 1 : p),
  },
  {
    id: 'chompers-max',
    game: 'chompers',
    title: 'Monster Mash',
    desc: 'Raise the donut multiplier to 10× during Chompers free spins.',
    reward: 3500,
    goal: 1,
    step: (e, p) => (e.game === 'chompers' && Number(e.meta?.level) >= 3 ? 1 : p),
  },
  {
    id: 'popparty-floor',
    game: 'popparty',
    title: 'Floor Filler',
    desc: 'Pop balloons on the same Pop Party floor tile until it reaches ×128.',
    reward: 3500,
    goal: 1,
    step: (e, p) => (e.game === 'popparty' && Number(e.meta?.maxTile) >= 128 ? 1 : p),
  },
  {
    id: 'roboriot-full',
    game: 'roboriot',
    title: 'Full Grid',
    desc: 'Fill all 25 sockets during a Robo Riot Power Grid bonus.',
    reward: 4000,
    goal: 1,
    step: (e, p) => (e.game === 'roboriot' && e.meta?.full === true ? 1 : p),
  },
  {
    id: 'baccarat-tie',
    game: 'baccarat',
    title: 'Dead Heat',
    desc: 'Place a Tie bet in Baccarat and have the hand end in a tie.',
    reward: 2000,
    goal: 1,
    step: (e, p) => (e.game === 'baccarat' && e.meta?.tieWin === true ? 1 : p),
  },
  {
    id: 'poker-quads',
    game: 'videopoker',
    title: 'Four of a Kind',
    desc: 'Get four of a kind, a straight flush or a royal flush in Video Poker.',
    reward: 2500,
    goal: 1,
    step: (e, p) => (e.game === 'videopoker' && ['quads', 'sflush', 'royal'].includes(String(e.meta?.hand)) ? 1 : p),
  },
  {
    id: 'high-roller',
    title: 'High Roller',
    desc: 'Wager 100,000 coins in total across all games. Every bet counts, whatever its size.',
    reward: 3500,
    goal: 100_000,
    step: (_e, _p, s) => Math.min(s.totalWagered, 100_000),
  },
]

export interface BetRecord {
  id: string
  game: GameId
  bet: number
  payout: number
  time: number
}

export interface Toast {
  id: number
  kind: 'win' | 'loss' | 'reward' | 'info'
  title: string
  amount?: number
}

interface WalletState {
  balance: number
  xp: number
  rounds: number
  totalWagered: number
  totalWon: number
  biggestWin: number
  bets: BetRecord[]
  gamesPlayed: Partial<Record<GameId, number>>
  dailyLast: number
  dailyStreak: number
  faucetLast: number
  levelClaimed: number
  challenges: Record<string, { progress: number; claimed: boolean }>
  heist: HeistState
  toasts: Toast[]

  /** Deducts the stake. Returns false if the balance can't cover it. */
  placeBet: (amount: number) => boolean
  /** Credits the payout (0 for a loss) and records the round. */
  settle: (ev: BetEvent) => void
  /** Refund without recording (e.g. a round that never started). */
  refund: (amount: number) => void
  claimDaily: () => number
  claimFaucet: () => number
  claimLevels: () => number
  claimChallenge: (id: string) => number
  /** Uses a lockpick to start a run. False when none are left. */
  heistStart: () => boolean
  /** Ends a run: banks the loot (0 if the alarm went off) without counting it as a bet. */
  heistEnd: (vaults: number, loot: number) => void
  pushToast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: number) => void
  reset: () => void
}

export type { WalletState }

let toastSeq = 1

const initial = () => ({
  balance: STARTING_BALANCE,
  xp: 0,
  rounds: 0,
  totalWagered: 0,
  totalWon: 0,
  biggestWin: 0,
  bets: [] as BetRecord[],
  gamesPlayed: {},
  dailyLast: 0,
  dailyStreak: 0,
  faucetLast: 0,
  levelClaimed: 0,
  challenges: {} as Record<string, { progress: number; claimed: boolean }>,
  heist: { picks: HEIST_MAX_PICKS, at: 0, best: 0, earned: 0, runs: 0 } as HeistState,
  toasts: [] as Toast[],
})

export const useWallet = create<WalletState>()(
  persist(
    (set, get) => ({
      ...initial(),

      placeBet: (amount) => {
        amount = round2(amount)
        if (!(amount >= MIN_BET) || amount > get().balance) return false
        set((s) => ({ balance: round2(s.balance - amount) }))
        return true
      },

      refund: (amount) => set((s) => ({ balance: round2(s.balance + amount) })),

      settle: (ev) => {
        const payout = round2(ev.payout)
        set((s) => {
          const counts = ev.bet >= CHALLENGE_MIN_BET
          const next: Partial<WalletState> = {
            balance: round2(s.balance + payout),
            xp: s.xp + ev.bet,
            rounds: (s.rounds ?? 0) + 1,
            totalWagered: round2(s.totalWagered + ev.bet),
            totalWon: round2(s.totalWon + payout),
            biggestWin: Math.max(s.biggestWin, payout - ev.bet),
            bets: [
              { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, game: ev.game, bet: ev.bet, payout, time: Date.now() },
              ...s.bets,
            ].slice(0, 60),
            gamesPlayed: counts ? { ...s.gamesPlayed, [ev.game]: (s.gamesPlayed[ev.game] ?? 0) + 1 } : s.gamesPlayed,
          }
          // advance challenges
          const merged = { ...s, ...next } as WalletState
          const ch = { ...s.challenges }
          for (const c of CHALLENGES) {
            const cur = ch[c.id] ?? { progress: 0, claimed: false }
            if (cur.claimed || cur.progress >= c.goal) continue
            if (!counts && c.id !== 'high-roller') continue
            const progress = Math.min(c.goal, c.step(ev, cur.progress, merged))
            if (progress !== cur.progress) {
              ch[c.id] = { ...cur, progress }
              if (progress >= c.goal) {
                queueMicrotask(() => get().pushToast({ kind: 'reward', title: `Challenge complete: ${c.title}` }))
              }
            }
          }
          next.challenges = ch
          return next
        })
      },

      claimDaily: () => {
        const s = get()
        const now = Date.now()
        if (now - s.dailyLast < DAILY_COOLDOWN) return 0
        const streak = s.dailyLast && now - s.dailyLast < DAILY_STREAK_RESET ? Math.min(s.dailyStreak + 1, 7) : 1
        const amt = dailyReward(streak)
        set({ balance: round2(s.balance + amt), dailyLast: now, dailyStreak: streak })
        return amt
      },

      claimFaucet: () => {
        const s = get()
        const now = Date.now()
        if (s.balance >= FAUCET_THRESHOLD || now - s.faucetLast < FAUCET_COOLDOWN) return 0
        set({ balance: round2(s.balance + FAUCET_AMOUNT), faucetLast: now })
        return FAUCET_AMOUNT
      },

      claimLevels: () => {
        const s = get()
        const { level } = levelFromXp(s.xp)
        let total = 0
        for (let l = s.levelClaimed + 1; l <= level; l++) total += levelReward(l)
        if (total > 0) set({ balance: round2(s.balance + total), levelClaimed: level })
        return total
      },

      claimChallenge: (id) => {
        const s = get()
        const c = CHALLENGES.find((x) => x.id === id)
        const cur = s.challenges[id]
        if (!c || !cur || cur.claimed || cur.progress < c.goal) return 0
        set({ balance: round2(s.balance + c.reward), challenges: { ...s.challenges, [id]: { ...cur, claimed: true } } })
        return c.reward
      },

      heistStart: () => {
        const now = Date.now()
        const h = { ...initial().heist, ...get().heist }
        const { picks, gained } = heistPicks(h, now)
        if (picks < 1) return false
        // dropping below the cap starts the regen clock; otherwise keep the clock's partial progress
        const at = picks >= HEIST_MAX_PICKS ? now : h.at + gained * HEIST_REGEN
        set({ heist: { ...h, picks: picks - 1, at } })
        return true
      },

      heistEnd: (vaults, loot) => {
        loot = Math.max(0, Math.min(round2(loot), 5000))
        set((s) => {
          const h = { ...initial().heist, ...s.heist }
          return {
            balance: round2(s.balance + loot),
            heist: { ...h, best: Math.max(h.best, vaults), earned: round2(h.earned + loot), runs: h.runs + 1 },
          }
        })
      },

      pushToast: (t) => {
        const id = toastSeq++
        set((s) => ({ toasts: [...s.toasts.slice(-3), { ...t, id }] }))
        setTimeout(() => get().dismissToast(id), 3200)
      },
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

      reset: () => set({ ...initial() }),
    }),
    {
      name: 'lumen.wallet.v1',
      storage: createJSONStorage(() => safeStorage),
      partialize: ({ toasts: _t, ...rest }) => rest,
    },
  ),
)

/* ------------------------------------------------------------------ */
/*  Switching between the guest wallet and an account's wallet         */
/* ------------------------------------------------------------------ */

export const GUEST_WALLET_KEY = 'lumen.wallet.v1'
export const accountWalletKey = (uid: string) => `lumen.wallet.acct.${uid}`

/** The saved part of the wallet as plain data (no actions, no toasts). */
export function walletSnapshot(): Record<string, unknown> {
  const { toasts: _t, ...rest } = useWallet.getState()
  return JSON.parse(JSON.stringify(rest))
}

function readStored(key: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(safeStorage.getItem(key) ?? 'null')
    return v && typeof v.state === 'object' ? v.state : null
  } catch {
    return null
  }
}

/**
 * Point the wallet at another storage key. With `data` the wallet becomes that data (and is saved
 * under the key); without it the wallet is loaded from the key, or starts fresh if nothing is there.
 * Fields missing from the data get their starting values, so nothing leaks from the previous wallet.
 */
export function switchWallet(key: string, data?: Record<string, unknown> | null) {
  const src = data ?? readStored(key) ?? {}
  const clean = Object.fromEntries(Object.entries(src).filter(([k, v]) => k !== 'toasts' && typeof v !== 'function'))
  useWallet.persist.setOptions({ name: key })
  useWallet.setState({ ...initial(), ...clean, toasts: useWallet.getState().toasts } as Partial<WalletState>)
}

/** Lockpicks ready right now, refreshed every 10 seconds. */
export function useHeistPicks() {
  const heist = useWallet((s) => s.heist)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])
  return heist ? heistPicks(heist, now).picks : HEIST_MAX_PICKS
}

/** Claimable rewards count, for the badge on the Rewards button. */
export function useClaimableCount() {
  return useWallet((s) => {
    const now = Date.now()
    let n = 0
    if (now - s.dailyLast >= DAILY_COOLDOWN) n++
    if (levelFromXp(s.xp).level > s.levelClaimed) n++
    if (s.balance < FAUCET_THRESHOLD && now - s.faucetLast >= FAUCET_COOLDOWN) n++
    for (const c of CHALLENGES) {
      const cur = s.challenges[c.id]
      if (cur && !cur.claimed && cur.progress >= c.goal) n++
    }
    return n
  })
}
