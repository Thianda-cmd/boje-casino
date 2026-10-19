/*
  The newer rewards, kept as plain data and pure functions (the wallet holds their state and applies them):

  - Daily missions: three a day, the same for everyone on a given calendar day (drawn from the date), one from each
    group: an everyday one (play rounds / wager coins), a variety one (play different games / today's featured game)
    and a winning one (land a big multiple / win rounds). Rounds count from MISSION_MIN_BET up, so they can't be
    farmed with 1-coin bets; the wager mission counts every coin. Progress resets at local midnight.
  - The Lucky Wheel: claiming all three missions unlocks one spin for the day (WHEEL_PRIZES, about 159 coins on
    average). The spin is drawn and kept until it is collected, so the balance doesn't give the wheel away while it
    turns, and a spin collected late (after midnight, or after a closed page) is never lost.
  - VIP rakeback: every bet puts a share of its stake aside (RAKEBACK, by VIP tier: 0.2% at Bronze up to 0.75% at
    Diamond), claimable whenever the player likes.
  - Tier-up bonuses: a one-time reward for reaching each VIP tier (TIER_BONUS).

  (tools/rewards-test.ts checks the draws and the wallet's bookkeeping.)
*/

import { GAMES, type GameId } from './games'

/** a round counts toward the round, variety, win and featured missions from this bet up */
export const MISSION_MIN_BET = 10

export type MissionKind = 'rounds' | 'wager' | 'games' | 'featured' | 'bigwin' | 'wins'

export interface Mission {
  kind: MissionKind
  /** rounds, coins, games or wins to reach; for 'bigwin' the multiple of the bet one round must pay */
  goal: number
  reward: number
  /** the featured game */
  game?: GameId
}

const POOL: Readonly<Record<MissionKind, readonly (readonly [number, number])[]>> = {
  rounds: [
    [15, 60],
    [25, 90],
    [40, 130],
  ],
  wager: [
    [300, 60],
    [750, 100],
    [1500, 150],
  ],
  games: [
    [3, 70],
    [4, 100],
    [5, 130],
  ],
  featured: [
    [5, 70],
    [10, 110],
  ],
  bigwin: [
    [5, 80],
    [10, 120],
    [25, 180],
  ],
  wins: [
    [5, 60],
    [10, 90],
    [15, 120],
  ],
}
const GROUPS: readonly (readonly MissionKind[])[] = [
  ['rounds', 'wager'],
  ['games', 'featured'],
  ['bigwin', 'wins'],
]
/** games that can be featured: every single-player game (the live tables need other players or the server) */
export const FEATURABLE: readonly GameId[] = GAMES.filter((g) => !['livebj', 'battles', 'double', 'crash'].includes(g.id)).map((g) => g.id)

const pad = (n: number) => String(n).padStart(2, '0')
/** the local calendar day a time falls on, as 'YYYY-MM-DD' */
export function dayKey(t = Date.now()) {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** ms from `t` to the next local midnight, when missions reset */
export function msToMidnight(t = Date.now()) {
  const d = new Date(t)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() - t
}

/** a small seeded generator (mulberry32) from the day, so every player gets the same missions that day */
function seeded(day: string) {
  let h = 2166136261
  for (let i = 0; i < day.length; i++) h = Math.imul(h ^ day.charCodeAt(i), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** the day's three missions */
export function missionsFor(day: string): Mission[] {
  const r = seeded(`missions:${day}`)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length) % xs.length]
  return GROUPS.map((g) => {
    const kind = pick(g)
    const [goal, reward] = pick(POOL[kind])
    return kind === 'featured' ? { kind, goal, reward, game: pick(FEATURABLE) } : { kind, goal, reward }
  })
}

/** what the progress bar fills to: the goal, or 1 for a big win (it happens or it doesn't) */
export const missionTarget = (m: Mission) => (m.kind === 'bigwin' ? 1 : m.goal)

/** a mission's progress after one settled round; `games` are the games played (counting bets) today, this one included */
export function missionStep(m: Mission, ev: { game: GameId; bet: number; payout: number }, prev: number, games: readonly string[]): number {
  const counts = ev.bet >= MISSION_MIN_BET
  let next = prev
  switch (m.kind) {
    case 'rounds':
      next = counts ? prev + 1 : prev
      break
    case 'wager':
      next = Math.round((prev + ev.bet) * 100) / 100
      break
    case 'games':
      next = games.length
      break
    case 'featured':
      next = counts && ev.game === m.game ? prev + 1 : prev
      break
    case 'bigwin':
      next = counts && ev.payout >= ev.bet * m.goal ? 1 : prev
      break
    case 'wins':
      next = counts && ev.payout > ev.bet ? prev + 1 : prev
      break
  }
  return Math.min(missionTarget(m), next)
}

/* ---------------- the Lucky Wheel ---------------- */

export const WHEEL_PRIZES: readonly { amount: number; weight: number }[] = [
  { amount: 50, weight: 20 },
  { amount: 75, weight: 20 },
  { amount: 100, weight: 18 },
  { amount: 150, weight: 15 },
  { amount: 200, weight: 12 },
  { amount: 300, weight: 8 },
  { amount: 500, weight: 5 },
  { amount: 1000, weight: 2 },
]
export const WHEEL_TOTAL = WHEEL_PRIZES.reduce((a, p) => a + p.weight, 0)
export const WHEEL_MEAN = WHEEL_PRIZES.reduce((a, p) => a + p.amount * p.weight, 0) / WHEEL_TOTAL
/** each prize's chance */
export const wheelChance = (i: number) => WHEEL_PRIZES[i].weight / WHEEL_TOTAL

/** the prize a spin lands on (its index) */
export function pickWheel(rng: () => number): number {
  let x = rng() * WHEEL_TOTAL
  for (let i = 0; i < WHEEL_PRIZES.length; i++) {
    x -= WHEEL_PRIZES[i].weight
    if (x < 0) return i
  }
  return WHEEL_PRIZES.length - 1
}

/* ---------------- VIP perks ---------------- */

/** the share of every stake set aside as rakeback, by VIP tier (Bronze, Silver, Gold, Platinum, Diamond) */
export const RAKEBACK = [0.002, 0.003, 0.004, 0.005, 0.0075] as const
/** the one-time bonus for reaching each tier (Bronze is where everyone starts) */
export const TIER_BONUS = [0, 1000, 3000, 8000, 20000] as const

/* ---------------- the reward history ---------------- */

export type RewardKind = 'daily' | 'level' | 'refill' | 'challenge' | 'mission' | 'wheel' | 'rakeback' | 'tier' | 'heist'

export interface RewardEntry {
  kind: RewardKind
  amount: number
  time: number
  /** what it was for: the challenge's or mission's title, the level, the tier */
  label: string
}

/** the history keeps this many */
export const LOG_SIZE = 40

/** a mission's title and the line under it */
export function missionText(m: Mission, gameName: (id: GameId) => string): { title: string; desc: string } {
  const n = (x: number) => x.toLocaleString('en-US')
  switch (m.kind) {
    case 'rounds':
      return { title: `Play ${m.goal} rounds`, desc: `Any game. Bets of ${MISSION_MIN_BET} coins or more count.` }
    case 'wager':
      return { title: `Wager ${n(m.goal)} coins`, desc: 'Across any games. Every bet counts.' }
    case 'games':
      return { title: `Play ${m.goal} different games`, desc: `One round of ${MISSION_MIN_BET} coins or more in each.` }
    case 'featured':
      return { title: `Play ${m.goal} rounds of ${gameName(m.game!)}`, desc: `Today's featured game. Bets of ${MISSION_MIN_BET} coins or more count.` }
    case 'bigwin':
      return { title: `Land a ${m.goal}× win`, desc: `One round that pays ${m.goal} times its bet or more (bet ${MISSION_MIN_BET}+).` }
    case 'wins':
      return { title: `Win ${m.goal} rounds`, desc: `A round wins when it pays back more than its bet (bet ${MISSION_MIN_BET}+).` }
  }
}
