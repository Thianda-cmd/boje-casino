/*
  Sic Bo rules. Three dice are shaken under a glass dome; the player has chips on any of 52 spots on the table.

  Lucky strikes: after betting closes and before the dice are shaken, some of the 42 "lucky" spots (the totals 4-17,
  the six doubles, the six triples, any triple and the 15 two-dice combinations) are struck with a multiplier. A
  winning bet on a struck spot is paid its odds times the multiplier (a 5 to 1 combination struck ×10 pays 50 to 1);
  stakes are always returned on a win. Each lucky spot is struck on its own with a fixed chance; if none is, one is
  picked anyway (weighted by those same chances), so every roll has at least one. The chances are solved below so
  that every lucky bet returns exactly RTP. The even-money bets (Small, Big, Odd, Even) and the six single numbers
  are never struck and return 97.22%.

  Everything is drawn up front by `drawRound()`: the strikes first, then the dice from separate random numbers, so
  the dice never depend on where the strikes fell. (tools/sicbo-test.ts checks every spot's exact return, samples the
  draw, and checks the payouts against a direct reading of the rules.)
*/

import { round2 } from '../../lib/format'

/** what every lucky spot returns; the even-money spots and singles return 35/36 = 97.22% */
export const RTP = 0.97

export type Die = 1 | 2 | 3 | 4 | 5 | 6
export type Dice = readonly [Die, Die, Die]
export const FACES: readonly Die[] = [1, 2, 3, 4, 5, 6]

export type BetKind = 'small' | 'big' | 'odd' | 'even' | 'total' | 'double' | 'triple' | 'anyTriple' | 'combo' | 'single'
export type LuckyKind = 'total' | 'double' | 'triple' | 'anyTriple' | 'combo'

export type BetKey =
  | 'small'
  | 'big'
  | 'odd'
  | 'even'
  | `total${4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17}`
  | `double${Die}`
  | `triple${Die}`
  | 'anyTriple'
  | `combo${Die}${Die}`
  | `single${Die}`

export interface BetSpot {
  key: BetKey
  kind: BetKind
  /** the name in full: "Small", "Total 9", "Double 3s", "Triple 6s", "Any triple", "1 & 4", "Single 5" */
  label: string
  /** a short label for chips, history and small screens: "S", "9", "33", "666", "ANY", "1-4", "5" */
  short: string
  /** base odds, x to 1 (singles pay SINGLE_ODDS by how many dice match; this is the one-die odds) */
  odds: number
  /** winning rolls out of the 216 (for singles: rolls showing the number at least once) */
  ways: number
  /** the faces the spot is about (the total's spot has none) */
  faces: readonly Die[]
  total?: number
  /** can be struck by a lucky multiplier */
  lucky: boolean
  /** the most that may be staked on this one spot */
  limit: number
}

/** a single number pays 1, 2 or 14 to 1 when it shows on one, two or three dice */
export const SINGLE_ODDS = [0, 1, 2, 14] as const

/** base odds of the totals, by total (4 and 17 pay 50 to 1, 10 and 11 pay 5 to 1) */
export const TOTAL_ODDS: Readonly<Record<number, number>> = { 4: 50, 5: 25, 6: 15, 7: 10, 8: 7, 9: 6, 10: 5, 11: 5, 12: 6, 13: 7, 14: 10, 15: 15, 16: 25, 17: 50 }
export const DOUBLE_ODDS = 8
export const TRIPLE_ODDS = 160
export const ANY_TRIPLE_ODDS = 24
export const COMBO_ODDS = 5

/** per-spot stake limits */
export const LIMITS: Readonly<Record<BetKind, number>> = {
  small: 10_000,
  big: 10_000,
  odd: 10_000,
  even: 10_000,
  single: 5_000,
  total: 2_000,
  double: 2_000,
  combo: 2_000,
  triple: 1_000,
  anyTriple: 1_000,
}

/** the multipliers a struck spot can get, with their weights (each table's weights sum to 100) */
export const LUCKY_MULTS: Readonly<Record<LuckyKind, readonly { mult: number; weight: number }[]>> = {
  total: [
    { mult: 2, weight: 30 },
    { mult: 3, weight: 28 },
    { mult: 5, weight: 22 },
    { mult: 10, weight: 13 },
    { mult: 20, weight: 7 },
  ],
  double: [
    { mult: 2, weight: 30 },
    { mult: 3, weight: 28 },
    { mult: 5, weight: 22 },
    { mult: 10, weight: 13 },
    { mult: 25, weight: 7 },
  ],
  triple: [
    { mult: 2, weight: 34 },
    { mult: 3, weight: 30 },
    { mult: 4, weight: 22 },
    { mult: 6, weight: 14 },
  ],
  anyTriple: [
    { mult: 2, weight: 30 },
    { mult: 3, weight: 28 },
    { mult: 5, weight: 22 },
    { mult: 10, weight: 13 },
    { mult: 25, weight: 7 },
  ],
  combo: [
    { mult: 2, weight: 30 },
    { mult: 3, weight: 28 },
    { mult: 5, weight: 22 },
    { mult: 10, weight: 13 },
    { mult: 25, weight: 7 },
  ],
}

/* ---------------- the dice ---------------- */

export const totalOf = (d: Dice) => d[0] + d[1] + d[2]
export const isTriple = (d: Dice) => d[0] === d[1] && d[1] === d[2]
export const countOf = (d: Dice, n: number) => (d[0] === n ? 1 : 0) + (d[1] === n ? 1 : 0) + (d[2] === n ? 1 : 0)

/** every roll of three dice, in order: 216 of them */
export const ALL_ROLLS: readonly Dice[] = FACES.flatMap((a) => FACES.flatMap((b) => FACES.map((c) => [a, b, c] as Dice)))

/** the payout odds a spot wins on this roll, before any lucky multiplier: 0 when it loses */
export function oddsWon(spot: BetSpot, d: Dice): number {
  const t = totalOf(d)
  const triple = isTriple(d)
  switch (spot.kind) {
    case 'small':
      return !triple && t >= 4 && t <= 10 ? 1 : 0
    case 'big':
      return !triple && t >= 11 && t <= 17 ? 1 : 0
    case 'odd':
      return !triple && t % 2 === 1 ? 1 : 0
    case 'even':
      return !triple && t % 2 === 0 ? 1 : 0
    case 'total':
      return t === spot.total ? spot.odds : 0
    case 'double':
      return countOf(d, spot.faces[0]) >= 2 ? spot.odds : 0
    case 'triple':
      return triple && d[0] === spot.faces[0] ? spot.odds : 0
    case 'anyTriple':
      return triple ? spot.odds : 0
    case 'combo':
      return countOf(d, spot.faces[0]) > 0 && countOf(d, spot.faces[1]) > 0 ? spot.odds : 0
    case 'single':
      return SINGLE_ODDS[countOf(d, spot.faces[0])]
  }
}

/* ---------------- the table ---------------- */

const spots: BetSpot[] = []
const add = (s: Omit<BetSpot, 'ways' | 'limit'>) => {
  const full = { ...s, ways: 0, limit: LIMITS[s.kind] } as BetSpot
  full.ways = ALL_ROLLS.filter((d) => oddsWon(full, d) > 0).length
  spots.push(full)
}
add({ key: 'small', kind: 'small', label: 'Small', short: 'S', odds: 1, faces: [], lucky: false })
add({ key: 'big', kind: 'big', label: 'Big', short: 'B', odds: 1, faces: [], lucky: false })
add({ key: 'odd', kind: 'odd', label: 'Odd', short: 'O', odds: 1, faces: [], lucky: false })
add({ key: 'even', kind: 'even', label: 'Even', short: 'E', odds: 1, faces: [], lucky: false })
for (let t = 4; t <= 17; t++) add({ key: `total${t}` as BetKey, kind: 'total', label: `Total ${t}`, short: String(t), odds: TOTAL_ODDS[t], faces: [], total: t, lucky: true })
for (const n of FACES) add({ key: `double${n}`, kind: 'double', label: `Double ${n}s`, short: `${n}${n}`, odds: DOUBLE_ODDS, faces: [n], lucky: true })
for (const n of FACES) add({ key: `triple${n}`, kind: 'triple', label: `Triple ${n}s`, short: `${n}${n}${n}`, odds: TRIPLE_ODDS, faces: [n], lucky: true })
add({ key: 'anyTriple', kind: 'anyTriple', label: 'Any triple', short: 'ANY', odds: ANY_TRIPLE_ODDS, faces: [], lucky: true })
for (const a of FACES) for (const b of FACES) if (b > a) add({ key: `combo${a}${b}`, kind: 'combo', label: `${a} & ${b}`, short: `${a}-${b}`, odds: COMBO_ODDS, faces: [a, b], lucky: true })
for (const n of FACES) add({ key: `single${n}`, kind: 'single', label: `Single ${n}`, short: String(n), odds: 1, faces: [n], lucky: false })

/** all 52 spots, in board order: the four even-money bets, totals 4-17, doubles, triples, any triple, combinations, singles */
export const SPOTS: readonly BetSpot[] = spots
export const LUCKY_SPOTS: readonly BetSpot[] = spots.filter((s) => s.lucky)
const BY_KEY = new Map<string, BetSpot>(spots.map((s) => [s.key, s]))
export const spotOf = (key: BetKey) => BY_KEY.get(key)!
export const isBetKey = (x: unknown): x is BetKey => typeof x === 'string' && BY_KEY.has(x)
export const luckyKindOf = (s: BetSpot) => s.kind as LuckyKind

/* ---------------- the strike chances ---------------- */

const meanMult = (k: LuckyKind) => {
  const t = LUCKY_MULTS[k]
  return t.reduce((a, m) => a + m.mult * m.weight, 0) / t.reduce((a, m) => a + m.weight, 0)
}

/** how often each lucky spot must end up struck for it to return exactly RTP: q (1 + odds (1 + i (E[mult] - 1))) = RTP */
const need = LUCKY_SPOTS.map((s) => ((RTP / (s.ways / 216) - 1) / s.odds - 1) / (meanMult(luckyKindOf(s)) - 1))

/*
  Each spot is struck on its own with chance p; if none is (chance P0 = prod (1 - p)), one is picked with weight p. So
  a spot ends up struck with chance i = p + P0 p / sum(p) = p (1 + P0 / S). Solving p = need / (1 + P0 / S) by fixed
  point converges in a handful of rounds (P0 is about 3.5%).
*/
function solveStrikes(): number[] {
  let p = need.slice()
  for (let it = 0; it < 100; it++) {
    const P0 = p.reduce((a, x) => a * (1 - x), 1)
    const S = p.reduce((a, x) => a + x, 0)
    p = need.map((n) => n / (1 + P0 / S))
  }
  return p
}
const strikeArr = solveStrikes()

/** each lucky spot's own chance to be struck on a roll */
export const STRIKE: Readonly<Record<string, number>> = Object.fromEntries(LUCKY_SPOTS.map((s, i) => [s.key, strikeArr[i]]))
/** chance that no spot is struck on its own (one is then picked) */
export const NONE_STRUCK = strikeArr.reduce((a, x) => a * (1 - x), 1)
const STRIKE_SUM = strikeArr.reduce((a, x) => a + x, 0)
/** chance each lucky spot ends up struck on a roll, counting the pick when none is */
export const STRUCK_CHANCE: Readonly<Record<string, number>> = Object.fromEntries(LUCKY_SPOTS.map((s, i) => [s.key, strikeArr[i] * (1 + NONE_STRUCK / STRIKE_SUM)]))
/** the average number of struck spots per roll (about 3.2) */
export const MEAN_STRIKES = Object.values(STRUCK_CHANCE).reduce((a, x) => a + x, 0)

/* ---------------- a round ---------------- */

export interface Lucky {
  key: BetKey
  mult: number
}

export interface Round {
  lucky: Lucky[]
  dice: Dice
}

function pickMult(k: LuckyKind, rng: () => number): number {
  const t = LUCKY_MULTS[k]
  let r = rng() * t.reduce((a, m) => a + m.weight, 0)
  for (const m of t) {
    r -= m.weight
    if (r < 0) return m.mult
  }
  return t[t.length - 1].mult
}

/** which spots are struck this roll, and their multipliers, in board order */
export function drawLucky(rng: () => number): Lucky[] {
  const hit = LUCKY_SPOTS.filter((s) => rng() < STRIKE[s.key])
  if (!hit.length) {
    let r = rng() * STRIKE_SUM
    let pick = LUCKY_SPOTS[LUCKY_SPOTS.length - 1]
    for (const s of LUCKY_SPOTS) {
      r -= STRIKE[s.key]
      if (r < 0) {
        pick = s
        break
      }
    }
    hit.push(pick)
  }
  return hit.map((s) => ({ key: s.key, mult: pickMult(luckyKindOf(s), rng) }))
}

export const rollDie = (rng: () => number) => (Math.min(5, Math.floor(rng() * 6)) + 1) as Die
export const rollDice = (rng: () => number): Dice => [rollDie(rng), rollDie(rng), rollDie(rng)]

/** the whole round, drawn before anything is shown: the strikes, then the dice */
export function drawRound(rng: () => number): Round {
  const lucky = drawLucky(rng)
  return { lucky, dice: rollDice(rng) }
}

/** the lucky multiplier on a spot this round, or 1 */
export const multOn = (key: BetKey, lucky: readonly Lucky[]) => lucky.find((l) => l.key === key)?.mult ?? 1

/** what a stake on a spot returns on this roll, stake included (0 when it loses) */
export function spotReturn(key: BetKey, stake: number, dice: Dice, lucky: readonly Lucky[]): number {
  const spot = spotOf(key)
  const odds = oddsWon(spot, dice)
  if (!odds) return 0
  return round2(stake * (1 + odds * (spot.lucky ? multOn(key, lucky) : 1)))
}

export interface BetResult {
  key: BetKey
  stake: number
  /** returned, stake included; 0 when it lost */
  ret: number
  /** the lucky multiplier it was paid with (1 when not struck or lost) */
  mult: number
}

export type Bets = Partial<Record<BetKey, number>>

/** every bet on the table settled against the round */
export function settleBets(bets: Bets, round: Round): { stake: number; ret: number; results: BetResult[] } {
  const results: BetResult[] = []
  let stake = 0
  let ret = 0
  for (const s of SPOTS) {
    const amount = bets[s.key]
    if (!amount) continue
    const r = spotReturn(s.key, amount, round.dice, round.lucky)
    const mult = r > 0 && s.lucky ? multOn(s.key, round.lucky) : 1
    results.push({ key: s.key, stake: amount, ret: r, mult })
    stake += amount
    ret += r
  }
  return { stake: round2(stake), ret: round2(ret), results }
}

/** a bet table that respects every limit: each spot at most its limit, the whole table at most `max` */
export function withinLimits(bets: Bets, max: number): boolean {
  let total = 0
  for (const [k, v] of Object.entries(bets)) {
    if (!isBetKey(k) || typeof v !== 'number' || !(v > 0) || v > spotOf(k).limit) return false
    total += v
  }
  return total <= max
}

/* ---------------- exact returns, for the paytable and tests ---------------- */

/** a spot's exact return (stake included) per unit staked */
export function spotRtp(key: BetKey): number {
  const s = spotOf(key)
  if (s.kind === 'single') return ALL_ROLLS.reduce((a, d) => a + (oddsWon(s, d) ? 1 + oddsWon(s, d) : 0), 0) / 216
  const q = s.ways / 216
  if (!s.lucky) return q * (1 + s.odds)
  return q * (1 + s.odds * (1 + STRUCK_CHANCE[s.key] * (meanMult(luckyKindOf(s)) - 1)))
}

/** the largest multiple of the stake a spot can return (struck at its top multiplier) */
export function spotMax(key: BetKey): number {
  const s = spotOf(key)
  if (s.kind === 'single') return 1 + SINGLE_ODDS[3]
  if (!s.lucky) return 1 + s.odds
  return 1 + s.odds * Math.max(...LUCKY_MULTS[luckyKindOf(s)].map((m) => m.mult))
}

/** chance a spot wins on a roll */
export const winChance = (key: BetKey) => spotOf(key).ways / 216

/* ---------------- describing a roll ---------------- */

/** what a roll was, for the history strip: its total, Small/Big (or Triple), Odd/Even */
export function describe(d: Dice): { total: number; size: 'small' | 'big' | 'triple'; parity: 'odd' | 'even' | 'triple' } {
  const total = totalOf(d)
  if (isTriple(d)) return { total, size: 'triple', parity: 'triple' }
  return { total, size: total <= 10 ? 'small' : 'big', parity: total % 2 ? 'odd' : 'even' }
}

/** the dice sorted low to high, which is how a roll is read out */
export const sorted = (d: Dice): Dice => [...d].sort((a, b) => a - b) as unknown as Dice
