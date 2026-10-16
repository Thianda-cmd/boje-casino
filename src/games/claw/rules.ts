/*
  Lucky Claw rules. Eight prize plushies sit on top of the pile, each with a multiplier tag. The player picks one and
  drops the claw; the grab is decided the moment the claw drops, with a win chance of exactly RTP / multiplier, so
  every prize returns exactly 97% of the bet.

  The chance is a whole number of ways out of DRAW: prize.ways / DRAW = 0.97 / prize.mult exactly (DRAW is the least
  common multiple that makes every one of them whole). Everything the grab then looks like (which failure a loss
  plays, how far a plushie gets, whether a win gives you a scare on the way) is drawn by `details()`, which is only
  ever told whether the grab won: it cannot treat one prize differently from another, so the claw is never weaker
  "by design" for a big prize than for a small one. (tools/claw-test.ts checks the sums, samples the draw and checks
  that the details only follow the outcome.)
*/

export const RTP = 0.97
/** the draw is a whole number in [0, DRAW): a grab wins when it falls below the prize's `ways` */
export const DRAW = 30_000

export type PrizeId = 'bear' | 'bunny' | 'frog' | 'penguin' | 'cat' | 'dino' | 'octopus' | 'unicorn'

export interface Prize {
  id: PrizeId
  name: string
  /** what kind of plushie it is, for the paytable */
  kind: string
  mult: number
  /** winning draws out of DRAW: ways / DRAW = RTP / mult */
  ways: number
  /** the tag's colour, and the plushie's own main colour for the UI */
  tag: string
  color: string
}

export const PRIZES: readonly Prize[] = [
  { id: 'bear', name: 'Biscuit', kind: 'Teddy bear', mult: 1.5, ways: 19_400, tag: '#5cc8ff', color: '#c98a4b' },
  { id: 'bunny', name: 'Clover', kind: 'Bunny', mult: 2, ways: 14_550, tag: '#3ee08f', color: '#f3dbe6' },
  { id: 'frog', name: 'Pickle', kind: 'Frog', mult: 3, ways: 9_700, tag: '#c6f03c', color: '#6cd35b' },
  { id: 'penguin', name: 'Pip', kind: 'Penguin', mult: 5, ways: 5_820, tag: '#ffd23f', color: '#33497e' },
  { id: 'cat', name: 'Mochi', kind: 'Cat', mult: 10, ways: 2_910, tag: '#ff9a3c', color: '#ff9b4a' },
  { id: 'dino', name: 'Rex', kind: 'Dino', mult: 25, ways: 1_164, tag: '#ff5f7e', color: '#4fd6b0' },
  { id: 'octopus', name: 'Inky', kind: 'Octopus', mult: 50, ways: 582, tag: '#c77dff', color: '#ff5fa8' },
  { id: 'unicorn', name: 'Goldie', kind: 'Golden unicorn', mult: 100, ways: 291, tag: '#ffcc33', color: '#ffcc33' },
]

export const prizeIndex = (id: string) => PRIZES.findIndex((p) => p.id === id)

/** the exact win chance as a fraction */
export const winChance = (p: Prize) => p.ways / DRAW

/** how a lost grab plays out */
export type Failure =
  /** the plushie slides out of the prongs on the way up and drops back onto the pile */
  | 'slip'
  /** it swings, wriggles free mid-carry and tumbles onto the pile */
  | 'wriggle'
  /** it makes it all the way, then lands on the edge of the chute and topples back in */
  | 'edge'
  /** the claw comes down a little off, closes on the plushie next to it, and that one falls off */
  | 'neighbour'

/** each failure out of 100, the same for every prize */
export const FAILURES: readonly { kind: Failure; weight: number }[] = [
  { kind: 'slip', weight: 30 },
  { kind: 'wriggle', weight: 28 },
  { kind: 'edge', weight: 20 },
  { kind: 'neighbour', weight: 22 },
]

/** a heart-stopping moment on a grab that holds: none, a slip and catch on the lift, or a big swing on the carry */
export type Scare = 'none' | 'lift' | 'carry'
export const SCARES: readonly { kind: Scare; weight: number }[] = [
  { kind: 'none', weight: 45 },
  { kind: 'lift', weight: 25 },
  { kind: 'carry', weight: 30 },
]

export interface Details {
  failure: Failure | null
  scare: Scare
  /** where along its leg the failure (or scare) happens, 0 to 1: how high a slip gets, how far a wriggle gets */
  at: number
  /** which way the plushie swings or topples: -1 or 1 */
  side: -1 | 1
  /** a free number for the scene's small variations (the bounce, the swing's rhythm), 0 to 1 */
  flavour: number
}

export interface Plan extends Details {
  prize: PrizeId
  mult: number
  won: boolean
}

function weighted<T>(list: readonly { kind: T; weight: number }[], r: number): T {
  const total = list.reduce((a, x) => a + x.weight, 0)
  let x = r * total
  for (const it of list) {
    if (x < it.weight) return it.kind
    x -= it.weight
  }
  return list[list.length - 1].kind
}

/**
 * How a grab looks, given only whether it won. It takes exactly four numbers from `rng` whatever the outcome, and
 * nothing about the prize, so a loss on the 100× unicorn plays out exactly like a loss on the 1.5× bear would.
 */
export function details(won: boolean, rng: () => number): Details {
  const a = rng()
  const b = rng()
  const c = rng()
  const d = rng()
  return won
    ? { failure: null, scare: weighted(SCARES, a), at: 0.25 + b * 0.4, side: c < 0.5 ? -1 : 1, flavour: d }
    : { failure: weighted(FAILURES, a), scare: 'none', at: 0.2 + b * 0.6, side: c < 0.5 ? -1 : 1, flavour: d }
}

/** the draw for a prize: a whole number in [0, DRAW) from one call to `rng` */
export const drawWays = (rng: () => number) => Math.min(DRAW - 1, Math.floor(rng() * DRAW))

/** Decides a grab: the first number from `rng` decides the outcome, the next four how it looks (details()). */
export function drawPlan(prize: Prize, rng: () => number): Plan {
  const won = drawWays(rng) < prize.ways
  return { prize: prize.id, mult: prize.mult, won, ...details(won, rng) }
}

/** "9.70%", "0.97%", "64.67%" */
export const chanceLabel = (p: Prize) => `${(winChance(p) * 100).toFixed(2)}%`
/** "1.5×", "100×" */
export const multLabel = (m: number) => `${m}×`
