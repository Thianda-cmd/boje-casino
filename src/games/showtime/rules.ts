/*
  Showtime's rules: a game-show money wheel with four bonus rounds.

  The wheel has 54 segments: 21 × "1", 13 × "2", 7 × "5", 4 × "10", and the bonus rounds Coin Toss (4), Peg Drop (2),
  Prize Wall (2) and Mega Spin (1). The player stakes any of the eight spots; the wheel lands on one segment and only
  that spot wins. A number pays its value to 1 (a "5" returns 6 × the stake). A bonus round pays the multiplier it
  ends on, to 1. Stakes are always returned on a win.

  The Booster: before each spin a slot machine lights one spot with a multiplier (×2 to ×50), or misses. If the wheel
  then lands on that spot, its win is multiplied: a "2" boosted ×10 pays 20 to 1; a boosted bonus round has every one
  of its multipliers boosted. The Booster's chance of lighting each spot is solved below so that every spot returns
  exactly RTP; what is left over is its chance of missing.

  The bonus rounds:
    Coin Toss   a coin with a multiplier on each face is tossed; the face that lands up pays.
    Peg Drop    a puck falls down a wall of pegs onto 16 slots: 14 multipliers and 2 DOUBLEs. A DOUBLE doubles every
                multiplier on the row and the puck drops again.
    Prize Wall  60 prizes are shuffled behind the tiles of a wall and the player picks one.
    Mega Spin   a giant wheel of 64 segments: 58 multipliers, 4 DOUBLEs and 2 TRIPLEs, and three flappers to choose
                from. When the player's flapper stops on a DOUBLE or TRIPLE, every multiplier on the wheel is
                doubled or tripled and it spins again.
  A bonus round's win is capped at MAX_WIN times the stake.

  Everything is drawn up front by drawRound(): the Booster, the segment, and the whole bonus round. The two rounds
  where the player chooses (a tile, a flapper) draw what the player's choice will turn up; the screen then puts that
  result under whichever tile or flapper is chosen. Every tile and every flapper is alike until it is revealed, so the
  odds are the same as revealing the tile picked. (tools/showtime-test.ts checks every spot's exact return and samples
  the draw against it.)
*/

import { round2 } from '../../lib/format'

export const RTP = 0.96
/** the most a bonus round can pay, times the stake */
export const MAX_WIN = 20_000

export type NumberSpot = '1' | '2' | '5' | '10'
export type BonusSpot = 'coin' | 'peg' | 'wall' | 'mega'
export type Spot = NumberSpot | BonusSpot
export const NUMBER_SPOTS: readonly NumberSpot[] = ['1', '2', '5', '10']
export const BONUS_SPOTS: readonly BonusSpot[] = ['coin', 'peg', 'wall', 'mega']
export const SPOTS: readonly Spot[] = [...NUMBER_SPOTS, ...BONUS_SPOTS]
export const isSpot = (k: unknown): k is Spot => typeof k === 'string' && (SPOTS as readonly string[]).includes(k)
export const isBonus = (s: Spot): s is BonusSpot => (BONUS_SPOTS as readonly string[]).includes(s)
/** what a number pays, to 1 */
export const PAYS: Record<NumberSpot, number> = { '1': 1, '2': 2, '5': 5, '10': 10 }

/** the wheel, clockwise from the top, segment 0 under the pointer at rest */
export const WHEEL: readonly Spot[] = [
  'mega', '1', '2', '1', '5', '1', 'coin', '1', '2', '1', '10', '1', '2', 'peg', '1', '5', '1', '2', '1', '5', 'coin', '1', '2', '1', '10', '1', '2',
  'wall', '1', '5', '1', '2', '1', 'coin', '1', '2', '1', '10', '1', '5', 'peg', '1', '2', '1', '5', '1', '2', 'coin', '2', '10', '2', 'wall', '5', '2',
]
export const SEGMENTS = WHEEL.length
/** how many segments each spot has */
export const COUNT = Object.fromEntries(SPOTS.map((s) => [s, WHEEL.filter((w) => w === s).length])) as Record<Spot, number>

/* ---------------- tables ---------------- */

/** a weighted table of values */
export type Table = readonly (readonly [value: number, weight: number])[]
const total = (t: Table) => t.reduce((a, [, w]) => a + w, 0)
export const mean = (t: Table) => t.reduce((a, [v, w]) => a + v * w, 0) / total(t)
export function pick(t: Table, r: number) {
  let x = r * total(t)
  for (const [v, w] of t) if ((x -= w) < 0) return v
  return t[t.length - 1][0]
}

/** the Booster's multipliers */
export const BOOST: Table = [
  [2, 40],
  [3, 25],
  [5, 16],
  [7, 7],
  [10, 6],
  [15, 3],
  [25, 2],
  [50, 1],
]
/** a face of the coin */
export const COIN: Table = [
  [2, 10],
  [3, 16],
  [4, 15],
  [5, 15],
  [6, 11],
  [8, 10],
  [10, 9],
  [15, 6],
  [20, 4],
  [25, 2.2],
  [50, 1.2],
  [100, 0.6],
]
/** a Peg Drop slot */
export const PEG: Table = [
  [5, 28],
  [7, 22],
  [10, 20],
  [15, 11],
  [20, 7],
  [25, 5],
  [50, 4],
  [100, 1.8],
  [200, 0.8],
  [500, 0.4],
]
export const PEG_SLOTS = 16
export const PEG_DOUBLES = 2
/** a Prize Wall prize */
export const WALL: Table = [
  [5, 22],
  [7, 20],
  [10, 18],
  [15, 14],
  [20, 9],
  [25, 6],
  [50, 6],
  [75, 2],
  [100, 1.6],
  [200, 0.9],
  [500, 0.3],
  [1000, 0.1],
]
export const WALL_TILES = 60
/** a Mega Spin multiplier */
export const MEGA: Table = [
  [10, 28],
  [15, 18],
  [20, 17],
  [25, 12],
  [50, 11],
  [75, 5],
  [100, 5],
  [150, 2.2],
  [200, 1.8],
  [250, 0.9],
  [500, 0.4],
  [1000, 0.2],
]
export const MEGA_SEGMENTS = 64
export const MEGA_DOUBLES = 4
export const MEGA_TRIPLES = 2
/** the three flappers, by where they sit round the Mega Spin wheel (segments clockwise from the top) */
export const FLAPPERS = [
  { id: 'green', name: 'Green', color: '#2ee87f', at: 0 },
  { id: 'blue', name: 'Blue', color: '#4cb4ff', at: 21 },
  { id: 'gold', name: 'Gold', color: '#f7c548', at: 43 },
] as const
export type FlapperId = (typeof FLAPPERS)[number]['id']

/* ---------------- the exact returns ---------------- */

/**
 * A bonus round's win before the cap, as the distribution of a factor (the DOUBLEs and TRIPLEs it went through) times
 * a value from its table. Coin Toss and Prize Wall have no factor; a uniformly chosen tile or face of independently
 * drawn values is distributed as one draw from the table.
 */
function factors(s: BonusSpot): (readonly [f: number, p: number])[] {
  if (s === 'coin' || s === 'wall') return [[1, 1]]
  const out: [number, number][] = []
  if (s === 'peg') {
    // each drop lands on one of the 16 slots alike: a DOUBLE with 2/16, and the drops go on until a multiplier
    const d = PEG_DOUBLES / PEG_SLOTS
    for (let k = 0; k <= 40; k++) out.push([2 ** k, d ** k * (1 - d)])
    return out
  }
  // Mega Spin: a run of a DOUBLEs and b TRIPLEs in any order, then a multiplier
  const d = MEGA_DOUBLES / MEGA_SEGMENTS
  const t = MEGA_TRIPLES / MEGA_SEGMENTS
  const n = 1 - d - t
  for (let a = 0; a <= 30; a++)
    for (let b = 0; a + b <= 30; b++) out.push([2 ** a * 3 ** b, binom(a + b, a) * d ** a * t ** b * n])
  return out
}
function binom(n: number, k: number) {
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return r
}
export const TABLE: Record<BonusSpot, Table> = { coin: COIN, peg: PEG, wall: WALL, mega: MEGA }

/** the expected capped win of a bonus round, to 1, with every multiplier boosted by m */
export function bonusMean(s: BonusSpot, m = 1) {
  const t = TABLE[s]
  const tw = total(t)
  let e = 0
  for (const [f, p] of factors(s)) for (const [v, w] of t) e += p * (w / tw) * Math.min(MAX_WIN, v * f * m)
  return e
}

/** the Booster's average multiplier, and the average of a bonus round's capped win over it */
const BOOST_MEAN = mean(BOOST)
const boostedMean = (s: BonusSpot) => BOOST.reduce((a, [m, w]) => a + w * bonusMean(s, m), 0) / total(BOOST)

/**
 * The Booster's chance of lighting each spot, solved so the spot returns RTP:
 *   a number:  RTP = p × (1 + a × (1 + w × (B̄ − 1)))                        (B̄ the average boost)
 *   a bonus:   RTP = p × (1 + (1 − w) × E[win] + w × E[boosted win])
 * where p is the spot's share of the wheel. Whatever is left is the chance the Booster misses.
 */
export const BOOST_CHANCE = Object.fromEntries(
  SPOTS.map((s) => {
    const p = COUNT[s] / SEGMENTS
    if (!isBonus(s)) {
      const a = PAYS[s]
      return [s, (RTP / p - 1 - a) / (a * (BOOST_MEAN - 1))]
    }
    const e1 = bonusMean(s)
    return [s, (RTP / p - 1 - e1) / (boostedMean(s) - e1)]
  }),
) as Record<Spot, number>
export const BOOST_MISS = 1 - SPOTS.reduce((a, s) => a + BOOST_CHANCE[s], 0)

/** the exact return of a stake on a spot, from the tables (the tests compare it with RTP) */
export function spotReturn(s: Spot) {
  const p = COUNT[s] / SEGMENTS
  const w = BOOST_CHANCE[s]
  if (!isBonus(s)) return p * (1 + PAYS[s] * (1 + w * (BOOST_MEAN - 1)))
  return p * (1 + (1 - w) * bonusMean(s) + w * boostedMean(s))
}

/* ---------------- a round ---------------- */

export interface Booster {
  spot: Spot
  mult: number
}

export interface CoinToss {
  kind: 'coin'
  /** the multipliers on the faces (before the boost), and the face that lands up */
  faces: [heads: number, tails: number]
  up: 0 | 1
}

export interface PegDrop {
  kind: 'peg'
  /** the row as first shown: a multiplier (before the boost) or 0 for a DOUBLE */
  row: number[]
  /** the slot each drop lands in; every drop but the last lands on a DOUBLE */
  drops: number[]
}

export interface PrizeWall {
  kind: 'wall'
  /** the prizes behind the tiles (before the boost), in the order drawn */
  prizes: number[]
  /** which of them the player's pick turns up; the screen puts it behind the tile picked */
  hit: number
}

export interface MegaSpin {
  kind: 'mega'
  /** the wheel as first shown: a multiplier (before the boost), or -2 for a DOUBLE and -3 for a TRIPLE */
  wheel: number[]
  /**
   * The segment under the player's flapper after each spin; every spin but the last ends on a DOUBLE or TRIPLE. The
   * screen turns the wheel so the flapper chosen points there.
   */
  stops: number[]
}

export type Bonus = CoinToss | PegDrop | PrizeWall | MegaSpin

export interface Round {
  booster: Booster | null
  /** the segment of the main wheel under the pointer */
  segment: number
  spot: Spot
  bonus: Bonus | null
  /** what the bonus round ended on, boost and cap included, to 1 (0 when there is none) */
  bonusWin: number
}

const DOUBLE = 0

function drawBooster(r: () => number): Booster | null {
  let x = r()
  for (const s of SPOTS) if ((x -= BOOST_CHANCE[s]) < 0) return { spot: s, mult: pick(BOOST, r()) }
  return null
}

function drawCoin(r: () => number): CoinToss {
  return { kind: 'coin', faces: [pick(COIN, r()), pick(COIN, r())], up: r() < 0.5 ? 0 : 1 }
}

function drawPeg(r: () => number): PegDrop {
  const row = Array.from({ length: PEG_SLOTS }, () => pick(PEG, r()))
  // the DOUBLEs go in two different slots
  const at = new Set<number>()
  while (at.size < PEG_DOUBLES) at.add(Math.floor(r() * PEG_SLOTS))
  for (const i of at) row[i] = DOUBLE
  const drops: number[] = []
  for (;;) {
    const d = Math.floor(r() * PEG_SLOTS)
    drops.push(d)
    if (row[d] !== DOUBLE || drops.length >= 40) break
  }
  // a run of 40 DOUBLEs (never, in practice) ends on the first multiplier
  if (row[drops[drops.length - 1]] === DOUBLE) drops[drops.length - 1] = row.findIndex((v) => v !== DOUBLE)
  return { kind: 'peg', row, drops }
}

function drawWall(r: () => number): PrizeWall {
  const prizes = Array.from({ length: WALL_TILES }, () => pick(WALL, r()))
  return { kind: 'wall', prizes, hit: Math.floor(r() * WALL_TILES) }
}

function drawMega(r: () => number): MegaSpin {
  const wheel = Array.from({ length: MEGA_SEGMENTS }, () => pick(MEGA, r()))
  // the DOUBLEs and TRIPLEs spread round the wheel: one in each sixth, the rest of each sixth multipliers
  const marks = [-2, -3, -2, -2, -3, -2]
  marks.forEach((m, i) => {
    const from = Math.round((i * MEGA_SEGMENTS) / 6)
    const to = Math.round(((i + 1) * MEGA_SEGMENTS) / 6)
    wheel[from + Math.floor(r() * (to - from))] = m
  })
  const stops: number[] = []
  for (;;) {
    const s = Math.floor(r() * MEGA_SEGMENTS)
    stops.push(s)
    if (wheel[s] > 0 || stops.length >= 30) break
  }
  if (wheel[stops[stops.length - 1]] < 0) stops[stops.length - 1] = wheel.findIndex((v) => v > 0)
  return { kind: 'mega', wheel, stops }
}

/** what a bonus round ends on, before the boost and the cap */
export function bonusValue(b: Bonus): number {
  if (b.kind === 'coin') return b.faces[b.up]
  if (b.kind === 'wall') return b.prizes[b.hit]
  if (b.kind === 'peg') return b.row[b.drops[b.drops.length - 1]] * 2 ** (b.drops.length - 1)
  let f = 1
  for (const s of b.stops.slice(0, -1)) f *= -b.wheel[s]
  return b.wheel[b.stops[b.stops.length - 1]] * f
}

/** the round, all of it, from a source of uniform numbers in [0, 1) */
export function drawRound(r: () => number): Round {
  const booster = drawBooster(r)
  const segment = Math.floor(r() * SEGMENTS)
  const spot = WHEEL[segment]
  let bonus: Bonus | null = null
  if (spot === 'coin') bonus = drawCoin(r)
  else if (spot === 'peg') bonus = drawPeg(r)
  else if (spot === 'wall') bonus = drawWall(r)
  else if (spot === 'mega') bonus = drawMega(r)
  const boost = booster?.spot === spot ? booster.mult : 1
  const bonusWin = bonus ? Math.min(MAX_WIN, bonusValue(bonus) * boost) : 0
  return { booster, segment, spot, bonus, bonusWin }
}

/* ---------------- stakes and payouts ---------------- */

export type Stakes = Partial<Record<Spot, number>>
export const stakeTotal = (s: Stakes) => round2(SPOTS.reduce((a, k) => a + (s[k] ?? 0), 0))

/** what the winning spot pays, to 1 */
export function winOf(round: Round): number {
  if (round.bonus) return round.bonusWin
  const boost = round.booster?.spot === round.spot ? round.booster.mult : 1
  return PAYS[round.spot as NumberSpot] * boost
}

/** what the stakes return: the winning spot's stake and its win (0 if it had no stake) */
export function settle(stakes: Stakes, round: Round) {
  const on = stakes[round.spot] ?? 0
  const ret = on > 0 ? round2(on * (1 + winOf(round))) : 0
  return { ret, on, win: winOf(round) }
}
