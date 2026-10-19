/*
  What the Rewards page can pay right now, worked out from the wallet in one place so the header's summary, Claim all
  and the nav badge (useClaimableCount in the wallet) always agree: the same things count, each mission and challenge
  on its own, rakeback once it reaches RAKEBACK_BADGE, and the Lucky Wheel once it is ready or its prize is waiting.
  Rakeback below that line is still paid by Claim all and shown in the total; it just doesn't count as a reward.

  Claim all takes everything with an amount. It never spins the wheel (the spin is a moment for the player to have),
  and while the wheel turns it leaves the drawn prize alone, so the balance can't give the result away.

  Also here, because they read the same wallet: what the history says was earned today and this week, and a readable
  title for each history entry. (Midnight takes nothing away: the wallet pays yesterday's finished missions and spins
  an earned wheel when the day turns over.)
*/
import { create } from 'zustand'
import {
  CHALLENGES,
  FAUCET_AMOUNT,
  FAUCET_COOLDOWN,
  FAUCET_THRESHOLD,
  RAKEBACK_BADGE,
  TIERS,
  dailyReward,
  levelFromXp,
  levelReward,
  missionsToday,
  tierBonusDue,
  useWallet,
  type WalletState,
} from '../../store/wallet'
import { LOG_SIZE, dayKey, missionTarget, missionText, missionsFor, type RewardEntry } from '../../store/rewards'
import { gameById } from '../../store/games'
import { dailyState } from './daily'

/** The page's own bit of shared state: the Lucky Wheel is mid-spin (the header and Claim all hold back its prize). */
export const useWheelUi = create<{ spinning: boolean }>(() => ({ spinning: false }))

/** Coins the levels reached but not yet claimed pay. */
export function pendingLevelCoins(xp: number, levelClaimed: number) {
  const { level } = levelFromXp(xp)
  let total = 0
  for (let l = levelClaimed + 1; l <= level; l++) total += levelReward(l)
  return total
}

/** rakeback as it would be paid: whole cents */
export const rakebackPayable = (rakeback: number) => Math.floor((rakeback ?? 0) * 100) / 100

const round2 = (n: number) => Math.round(n * 100) / 100

export interface ReadyItem {
  key: 'daily' | 'levels' | 'refill' | 'missions' | 'wheel' | 'rakeback' | 'tier' | 'challenges'
  label: string
  /** coins it pays; null for a wheel spin not yet taken */
  amount: number | null
  /** how many rewards it stands for, as the badge counts them (missions and challenges one each, small rakeback none) */
  count: number
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** the parts of the wallet that decide what's ready (a component can select just these, with useShallow) */
export type ReadySource = Pick<
  WalletState,
  'balance' | 'faucetLast' | 'dailyLast' | 'dailyStreak' | 'xp' | 'levelClaimed' | 'missions' | 'wheelSpin' | 'rakeback' | 'tierClaimed' | 'challenges'
>
export const pickReady = (s: WalletState): ReadySource => ({
  balance: s.balance,
  faucetLast: s.faucetLast,
  dailyLast: s.dailyLast,
  dailyStreak: s.dailyStreak,
  xp: s.xp,
  levelClaimed: s.levelClaimed,
  missions: s.missions,
  wheelSpin: s.wheelSpin,
  rakeback: s.rakeback,
  tierClaimed: s.tierClaimed,
  challenges: s.challenges,
})

/** Everything claimable now, in the order Claim all takes it. */
export function readyRewards(s: ReadySource, now: number, spinning: boolean): ReadyItem[] {
  const out: ReadyItem[] = []
  if (s.balance < FAUCET_THRESHOLD && now - s.faucetLast >= FAUCET_COOLDOWN) out.push({ key: 'refill', label: 'refill', amount: FAUCET_AMOUNT, count: 1 })
  const daily = dailyState(s.dailyLast, s.dailyStreak, now)
  if (daily.ready) out.push({ key: 'daily', label: 'daily bonus', amount: dailyReward(daily.day), count: 1 })
  const lvl = pendingLevelCoins(s.xp, s.levelClaimed)
  if (lvl > 0) out.push({ key: 'levels', label: levelFromXp(s.xp).level - s.levelClaimed > 1 ? 'level rewards' : 'level reward', amount: lvl, count: 1 })
  const m = missionsToday(s.missions, dayKey(now))
  const list = missionsFor(m.day)
  const done = list.filter((mi, i) => !m.claimed[i] && (m.progress[i] ?? 0) >= missionTarget(mi))
  if (done.length) out.push({ key: 'missions', label: plural(done.length, 'mission', 'missions'), amount: done.reduce((a, x) => a + x.reward, 0), count: done.length })
  if (s.wheelSpin && !spinning) out.push({ key: 'wheel', label: 'wheel prize', amount: s.wheelSpin.amount, count: 1 })
  else if (!s.wheelSpin && m.wheel === 'ready') out.push({ key: 'wheel', label: 'wheel spin', amount: null, count: 1 })
  const rakeback = rakebackPayable(s.rakeback)
  if (rakeback >= 0.01) out.push({ key: 'rakeback', label: 'rakeback', amount: rakeback, count: (s.rakeback ?? 0) >= RAKEBACK_BADGE ? 1 : 0 })
  const tier = tierBonusDue(levelFromXp(s.xp).level, s.tierClaimed)
  if (tier.coins) out.push({ key: 'tier', label: tier.tiers.length > 1 ? 'tier bonuses' : `${TIERS[tier.tiers[0]].name} bonus`, amount: tier.coins, count: 1 })
  const ch = CHALLENGES.filter((c) => {
    const st = s.challenges[c.id]
    return st && !st.claimed && st.progress >= c.goal
  })
  if (ch.length) out.push({ key: 'challenges', label: plural(ch.length, 'challenge', 'challenges'), amount: ch.reduce((a, c) => a + c.reward, 0), count: ch.length })
  return out
}

/**
 * Claims everything readyRewards lists with an amount. Returns the coins paid, how many rewards that was (counted as
 * the header counts them), and whether the last mission claimed unlocked the wheel.
 */
export function claimEverything(spinning: boolean) {
  const w = useWallet.getState()
  const items = readyRewards(w, Date.now(), spinning)
  const item = (k: ReadyItem['key']) => items.find((i) => i.key === k && i.amount !== null)
  let sum = 0
  let n = 0
  const add = (amount: number, count = 1) => {
    if (amount > 0) {
      sum += amount
      n += count
    }
  }
  // the refill first: it needs the balance to still be low
  if (item('refill')) add(w.claimFaucet())
  if (item('daily')) add(w.claimDaily())
  if (item('levels')) add(w.claimLevels())
  const wheelBefore = missionsToday(useWallet.getState().missions).wheel
  if (item('missions')) for (let i = 0; i < 3; i++) add(w.claimMission(i))
  const unlocked = wheelBefore === 'locked' && missionsToday(useWallet.getState().missions).wheel === 'ready'
  if (item('wheel')) add(w.collectWheel())
  const rakeback = item('rakeback')
  if (rakeback) add(w.claimRakeback(), rakeback.count)
  if (item('tier')) add(w.claimTierBonus())
  if (item('challenges')) for (const c of CHALLENGES) add(w.claimChallenge(c.id))
  return { sum: round2(sum), n, unlocked }
}

/* ---------------- the clock ---------------- */

/* ---------------- the history ---------------- */

/** local midnight, `back` calendar days before the day `t` falls on (a DST change makes a day 23 or 25 hours) */
const dayStart = (t: number, back = 0) => {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime()
}

/**
 * Coins collected today and over the last seven calendar days (today and the six before), from the history, plus each
 * of those days on its own (oldest first) for the little week chart. The history keeps the latest LOG_SIZE rewards,
 * so when it is full and doesn't reach back a whole week, the week's figures are a floor (`weekPartial`).
 */
export function earnedFromLog(log: RewardEntry[] | undefined, now: number) {
  const entries = log ?? []
  const starts = Array.from({ length: 7 }, (_, i) => dayStart(now, 6 - i))
  const days = [0, 0, 0, 0, 0, 0, 0]
  for (const e of entries) {
    if (e.time < starts[0] || e.time > now) continue
    let i = 6
    while (e.time < starts[i]) i--
    days[i] += e.amount
  }
  const oldest = entries[entries.length - 1]
  return {
    today: round2(days[6]),
    week: round2(days.reduce((a, b) => a + b, 0)),
    days: days.map(round2),
    weekPartial: entries.length >= LOG_SIZE && !!oldest && oldest.time > starts[0],
  }
}

/**
 * A history entry's title. The wallet logs every mission as "Daily mission"; the day's three missions usually tell
 * which one it was by its reward, and then the entry gets that mission's own title.
 */
export function historyTitle(e: RewardEntry) {
  if (e.kind !== 'mission' || e.label !== 'Daily mission') return e.label
  const same = missionsFor(dayKey(e.time)).filter((m) => m.reward === e.amount)
  return same.length === 1 ? missionText(same[0], (id) => gameById(id).name).title : e.label
}
