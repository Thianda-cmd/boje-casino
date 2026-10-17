/*
  Penalty Shootout rules. The goal mouth is split into six zones (top left, top middle, top right, bottom left, bottom
  middle, bottom right). The player pays the bet and takes up to MAX_SHOTS penalties: before each one they pick a
  zone; after each goal they may cash out or shoot again; a save ends the run with nothing.

  Difficulty sets how many zones the keeper covers on his dive (1 to 4), so a shot scores with chance
  p = (6 - covers) / 6 whatever zone it goes to. The cash-out multiplier after n goals is RTP / p^n floored to the
  cent, so every way of playing returns 97% (before the cent is floored): the game has no memory, and stopping after
  n goals pays p^n × RTP / p^n = RTP.

  The outcome of a shot is drawn the moment it is taken, from the first number of the stream, before the zone is even
  looked at (`drawGoal`). Everything else about the shot is drawn after it, from the outcome and the zone
  (`details`): which zones the keeper read (a random set of `covers` zones that holds the shot on a save and misses
  it on a goal), where he dives (straight at the ball on a save, to the zone he read nearest to it on a goal, which
  is often just next to it: those are the fingertip near misses), and how the ball goes in or is kept out.
  (tools/penalty-test.ts checks the multipliers and the return exactly, and that the outcome never depends on the zone.)
*/

export const RTP = 0.97
export const ZONES = 6
export const MAX_SHOTS = 10

export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert'
/** 0 top left, 1 top middle, 2 top right, 3 bottom left, 4 bottom middle, 5 bottom right (reading order) */
export type Zone = 0 | 1 | 2 | 3 | 4 | 5

export interface Level {
  id: Difficulty
  label: string
  /** zones the keeper covers on his dive */
  covers: number
  /** the keeper you face */
  keeper: string
}

export const LEVELS: readonly Level[] = [
  { id: 'easy', label: 'Easy', covers: 1, keeper: 'Rookie Rudi' },
  { id: 'medium', label: 'Medium', covers: 2, keeper: 'Steady Sven' },
  { id: 'hard', label: 'Hard', covers: 3, keeper: 'Big Bruno' },
  { id: 'expert', label: 'Expert', covers: 4, keeper: 'The Wall' },
]

export const levelOf = (d: Difficulty) => LEVELS.find((l) => l.id === d)!
export const isDifficulty = (x: unknown): x is Difficulty => LEVELS.some((l) => l.id === x)

/** scoring zones out of six */
export const scoreWays = (d: Difficulty) => ZONES - levelOf(d).covers
/** the chance that a shot scores, whatever the zone */
export const scoreChance = (d: Difficulty) => scoreWays(d) / ZONES

/** floor(a / b) for whole numbers a, b below 2^53, exactly (a % b is exact in floating point) */
const idiv = (a: number, b: number) => (a - (a % b)) / b

/**
 * The cash-out value after n goals in whole hundredths: floor(97 × 6^n / k^n), k the scoring zones. Worked in whole
 * numbers (97 × 6^10 is under 2^53), so a value that is a whole number of cents is never floored a cent too far.
 */
export function multCents(d: Difficulty, n: number): number {
  if (n <= 0) return 0
  const k = scoreWays(d)
  return idiv(97 * ZONES ** n, k ** n)
}

/** the cash-out multiplier after n goals (0 before the first goal) */
export const multiplier = (d: Difficulty, n: number) => multCents(d, n) / 100

/** the multipliers after 1 to MAX_SHOTS goals */
export const ladder = (d: Difficulty) => Array.from({ length: MAX_SHOTS }, (_, i) => multiplier(d, i + 1))

/** what cashing out after n goals pays on a bet, to the cent */
export const payoutFor = (bet: number, d: Difficulty, n: number) => Math.round(bet * multCents(d, n)) / 100

/* ---------------- a shot ---------------- */

export const zoneCol = (z: Zone) => z % 3
export const zoneRow = (z: Zone) => Math.floor(z / 3)
export const isTop = (z: Zone) => z < 3
/** steps apart on the 3 × 2 grid */
export const zoneDist = (a: Zone, b: Zone) => Math.abs(zoneCol(a) - zoneCol(b)) + Math.abs(zoneRow(a) - zoneRow(b))
export const ALL_ZONES: readonly Zone[] = [0, 1, 2, 3, 4, 5]
export const ZONE_NAMES = ['Top left', 'Top middle', 'Top right', 'Bottom left', 'Bottom middle', 'Bottom right'] as const

export type Finish = 'clean' | 'post' | 'bar'
export type Save = 'catch' | 'parry' | 'tip'

export interface Details {
  /** the zones the keeper read: `covers` of them, with the shot's zone among them exactly when he saves it */
  read: Zone[]
  /** the zone he dives to: the shot's zone on a save, the zone he read nearest to it on a goal */
  dive: Zone
  /** a goal that beats his fingertips by a whisker (he dove the right way, one zone short): shown in slow motion */
  close: boolean
  /** how a goal goes in: clean, in off the post (corners), in off the bar (top zones) */
  finish: Finish
  /** how a save is made: held, pushed wide, tipped away */
  save: Save
  /** where in its zone the ball goes, -1 to 1 across and up */
  dx: number
  dy: number
  /** a free number for small variations in the show */
  flavour: number
}

export interface Shot extends Details {
  zone: Zone
  goal: boolean
}

/** Whether a shot scores: one number from `rng`, compared with the scoring ways out of six. Never sees the zone. */
export function drawGoal(d: Difficulty, rng: () => number): boolean {
  const draw = Math.min(ZONES - 1, Math.floor(rng() * ZONES))
  return draw < scoreWays(d)
}

/**
 * How a shot looks, given its outcome and zone. Takes exactly ten numbers from `rng` whatever happens. The keeper's
 * read is a uniformly random set of `covers` zones among those that agree with the outcome: the other five zones are
 * shuffled and he takes the first covers - 1 of them plus the shot's zone on a save, or the first `covers` on a goal.
 */
export function details(d: Difficulty, goal: boolean, zone: Zone, rng: () => number): Details {
  const covers = levelOf(d).covers
  const others = ALL_ZONES.filter((z) => z !== zone)
  for (let i = others.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)))
    ;[others[i], others[j]] = [others[j], others[i]]
  }
  const read: Zone[] = goal ? others.slice(0, covers) : [zone, ...others.slice(0, covers - 1)]
  // on a goal he goes for the zone he read nearest the ball (the shuffle breaks ties)
  let dive: Zone = zone
  if (goal) {
    dive = read[0]
    for (const z of read) if (zoneDist(z, zone) < zoneDist(dive, zone)) dive = z
  }
  const rClose = rng()
  const rFinish = rng()
  const rSave = rng()
  const dx = rng() * 2 - 1
  const dy = rng() * 2 - 1
  const flavour = rng()
  const corner = zoneCol(zone) !== 1
  const close = goal && zoneDist(dive, zone) === 1 && rClose < 0.75
  const finish: Finish = !goal ? 'clean' : corner && rFinish < 0.14 ? 'post' : isTop(zone) && rFinish >= 0.14 && rFinish < 0.24 ? 'bar' : 'clean'
  const save: Save = isTop(zone) ? (rSave < 0.42 ? 'tip' : 'catch') : corner ? (rSave < 0.55 ? 'parry' : 'catch') : rSave < 0.3 ? 'parry' : 'catch'
  return { read, dive, close, finish, save, dx, dy, flavour }
}

/** Takes a shot: the first number from `rng` decides it, the next ten how it looks (details()). */
export function drawShot(d: Difficulty, zone: Zone, rng: () => number): Shot {
  const goal = drawGoal(d, rng)
  return { zone, goal, ...details(d, goal, zone, rng) }
}

/* ---------------- labels ---------------- */

/** "2.91×", "57,277.53×" */
export const multLabel = (m: number) => `${m >= 1000 ? m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : m.toFixed(2)}×`
/** "83.33%" */
export const chanceLabel = (d: Difficulty) => `${(scoreChance(d) * 100).toFixed(2)}%`
/** "5 in 6" */
export const waysLabel = (d: Difficulty) => `${scoreWays(d)} in 6`
