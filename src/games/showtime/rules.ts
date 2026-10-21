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

  The show is shared: everyone watches the same round, drawn by drawRound() from the round's seed (fair.ts). The two
  rounds with a choice are played on that shared draw, each player with their own pick:
    Prize Wall  one wall for everyone; each player's prize is the one behind the tile they picked. The prizes are
                drawn independently, so every tile hides a draw from WALL and no pick is better than another.
    Mega Spin   one wheel for everyone, spun until every flapper has stopped on a multiplier; each player follows
                their own flapper. The wheel stops at random each spin, so each flapper's run of DOUBLEs and TRIPLEs
                and the multiplier it ends on are distributed as if the wheel were spun for it alone.
  The picks are made before anyone can know what they turn up: the prizes and the stops are drawn from the seed, which
  is only revealed once the picks are in. (tools/showtime-test.ts checks every spot's exact return and samples the
  draw against it, for every tile and flapper.)
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
  /** the prizes behind the tiles (before the boost), once the picks are in; null until then */
  prizes: number[] | null
  /** the tile played for a player who never picked one */
  auto: number
}

export interface MegaSpin {
  kind: 'mega'
  /** the wheel as first shown: a multiplier (before the boost), or -2 for a DOUBLE and -3 for a TRIPLE */
  wheel: number[]
  /**
   * The segment at the top after each spin, once the picks are in (null until then). The flapper at segment position
   * `at` reads the segment at + top; the wheel spins again until every flapper has stopped on a multiplier.
   */
  spins: number[] | null
  /** the flapper (0 to 2) played for a player who never picked one */
  auto: number
}

export type Bonus = CoinToss | PegDrop | PrizeWall | MegaSpin

export interface Round {
  booster: Booster | null
  /** the segment of the main wheel under the pointer */
  segment: number
  spot: Spot
  bonus: Bonus | null
}

/**
 * Where a round's numbers come from: draw(what, i) is the i-th whole number in [0, 2^52) drawn for `what`, and the
 * same arguments always give the same number. fair.ts draws them from the round's seed.
 */
export type Draw = (what: string, i: number) => number
/** a draw as a uniform number in [0, 1) (exact: it has 52 bits) */
const unit = (d: Draw, what: string, i = 0) => d(what, i) / 2 ** 52
/** a draw as a whole number below n, in integers so the database gets the same one (_st_below in api/_lib/schema.js) */
export const below = (d: Draw, what: string, i: number, n: number) => Number((BigInt(d(what, i)) * BigInt(n)) >> 52n)

const DOUBLE = 0
/** the sixths of the Mega Spin wheel, each with one DOUBLE or TRIPLE: segments MEGA_SIXTHS[i] to MEGA_SIXTHS[i + 1] */
export const MEGA_SIXTHS = Array.from({ length: 7 }, (_, i) => Math.round((i * MEGA_SEGMENTS) / 6))
const MEGA_MARKS = [-2, -3, -2, -2, -3, -2]
/** the most spins a Mega Spin, and the most drops a Peg Drop, can take */
export const MEGA_MAX_SPINS = 30
export const PEG_MAX_DROPS = 40

function drawBooster(d: Draw): Booster | null {
  let x = unit(d, 'booster', 0)
  for (const s of SPOTS) if ((x -= BOOST_CHANCE[s]) < 0) return { spot: s, mult: pick(BOOST, unit(d, 'booster', 1)) }
  return null
}

function drawCoin(d: Draw): CoinToss {
  return { kind: 'coin', faces: [pick(COIN, unit(d, 'coin', 0)), pick(COIN, unit(d, 'coin', 1))], up: unit(d, 'coin', 2) < 0.5 ? 0 : 1 }
}

function drawPeg(d: Draw): PegDrop {
  const row = Array.from({ length: PEG_SLOTS }, (_, i) => pick(PEG, unit(d, 'peg', i)))
  // the DOUBLEs go in two different slots
  const a = below(d, 'pegdouble', 0, PEG_SLOTS)
  let b = below(d, 'pegdouble', 1, PEG_SLOTS - 1)
  if (b >= a) b++
  row[a] = row[b] = DOUBLE
  const drops: number[] = []
  for (let i = 0; i < PEG_MAX_DROPS; i++) {
    drops.push(below(d, 'pegdrop', i, PEG_SLOTS))
    if (row[drops[i]] !== DOUBLE) break
  }
  // a run of 40 DOUBLEs (never, in practice) ends on the first multiplier
  if (row[drops[drops.length - 1]] === DOUBLE) drops[drops.length - 1] = row.findIndex((v) => v !== DOUBLE)
  return { kind: 'peg', row, drops }
}

function drawWall(open: Draw, hidden: Draw | null): PrizeWall {
  const prizes = hidden ? Array.from({ length: WALL_TILES }, (_, i) => pick(WALL, unit(hidden, 'wall', i))) : null
  return { kind: 'wall', prizes, auto: below(open, 'wallpick', 0, WALL_TILES) }
}

function drawMega(open: Draw, hidden: Draw | null): MegaSpin {
  const wheel = Array.from({ length: MEGA_SEGMENTS }, (_, i) => pick(MEGA, unit(open, 'mega', i)))
  // the DOUBLEs and TRIPLEs spread round the wheel: one in each sixth, the rest of each sixth multipliers
  MEGA_MARKS.forEach((m, i) => (wheel[MEGA_SIXTHS[i] + below(open, 'megamark', i, MEGA_SIXTHS[i + 1] - MEGA_SIXTHS[i])] = m))
  let spins: number[] | null = null
  if (hidden) {
    spins = []
    const going = FLAPPERS.map(() => true)
    for (let k = 0; k < MEGA_MAX_SPINS && going.some(Boolean); k++) {
      const top = below(hidden, 'megaspin', k, MEGA_SEGMENTS)
      spins.push(top)
      FLAPPERS.forEach((f, i) => {
        if (wheel[(top + f.at) % MEGA_SEGMENTS] > 0) going[i] = false
      })
    }
  }
  return { kind: 'mega', wheel, spins, auto: below(open, 'megapick', 0, FLAPPERS.length) }
}

/**
 * The round from its two streams: `open`, revealed when betting closes (the Booster, the segment, and the bonus round
 * as everyone sees it), and `hidden`, revealed once the picks are in (the wall's prizes, the Mega Spin's stops). With
 * `hidden` null those are left out.
 */
export function drawRound(open: Draw, hidden: Draw | null): Round {
  const booster = drawBooster(open)
  const segment = below(open, 'segment', 0, SEGMENTS)
  const spot = WHEEL[segment]
  let bonus: Bonus | null = null
  if (spot === 'coin') bonus = drawCoin(open)
  else if (spot === 'peg') bonus = drawPeg(open)
  else if (spot === 'wall') bonus = drawWall(open, hidden)
  else if (spot === 'mega') bonus = drawMega(open, hidden)
  return { booster, segment, spot, bonus }
}

/** the round's boost of its own spot: the Booster's multiplier if it lit the spot the wheel stopped on, else 1 */
export const boostOf = (r: Round) => (r.booster?.spot === r.spot ? r.booster.mult : 1)

/** whether a round's results are all known (the wall's prizes and the Mega Spin's stops come with the seed) */
export const revealed = (r: Round) => !r.bonus || (r.bonus.kind === 'wall' ? !!r.bonus.prizes : r.bonus.kind === 'mega' ? !!r.bonus.spins : true)

/** a player's pick in a round with a choice, or the round's own pick for them when they made none (or a bad one) */
export function pickOf(b: Bonus, pick: number | null | undefined): number {
  if (b.kind !== 'wall' && b.kind !== 'mega') return 0
  const n = b.kind === 'wall' ? WALL_TILES : FLAPPERS.length
  return pick != null && Number.isInteger(pick) && pick >= 0 && pick < n ? pick : b.auto
}

/** where flapper f (0 to 2) stops after each spin: every stop but the last is a DOUBLE or TRIPLE */
export function megaStops(m: MegaSpin, f: number): number[] {
  const stops: number[] = []
  for (const top of m.spins ?? []) {
    stops.push((top + FLAPPERS[f].at) % MEGA_SEGMENTS)
    if (m.wheel[stops[stops.length - 1]] > 0) return stops
  }
  // thirty DOUBLEs and TRIPLEs in a row (never, in practice) end on the first multiplier
  if (stops.length) stops[stops.length - 1] = m.wheel.findIndex((v) => v > 0)
  return stops
}

/** what a bonus round ends on for a player with this pick, before the boost and the cap (null until it is revealed) */
export function bonusValue(b: Bonus, pick: number | null = null): number | null {
  if (b.kind === 'coin') return b.faces[b.up]
  if (b.kind === 'peg') return b.row[b.drops[b.drops.length - 1]] * 2 ** (b.drops.length - 1)
  if (b.kind === 'wall') return b.prizes ? b.prizes[pickOf(b, pick)] : null
  if (!b.spins) return null
  const stops = megaStops(b, pickOf(b, pick))
  let f = 1
  for (const s of stops.slice(0, -1)) f *= -b.wheel[s]
  return b.wheel[stops[stops.length - 1]] * f
}

/** what a bonus round pays to 1 for a player with this pick, boost and cap included (null until it is revealed) */
export function bonusWin(r: Round, pick: number | null = null): number | null {
  const v = r.bonus ? bonusValue(r.bonus, pick) : null
  return v == null ? null : Math.min(MAX_WIN, v * boostOf(r))
}

/* ---------------- stakes and payouts ---------------- */

export type Stakes = Partial<Record<Spot, number>>
export const stakeTotal = (s: Stakes) => round2(SPOTS.reduce((a, k) => a + (s[k] ?? 0), 0))

/** what the winning spot pays to 1, for a player with this pick (null while a bonus round is not revealed) */
export function winOf(round: Round, pick: number | null = null): number | null {
  if (round.bonus) return bonusWin(round, pick)
  return PAYS[round.spot as NumberSpot] * boostOf(round)
}

/** what the stakes return: the winning spot's stake and its win (0 if it had no stake); the round must be revealed */
export function settle(stakes: Stakes, round: Round, pick: number | null = null) {
  const on = stakes[round.spot] ?? 0
  const win = winOf(round, pick) ?? 0
  const ret = on > 0 ? round2(on * (1 + win)) : 0
  return { ret, on, win }
}
