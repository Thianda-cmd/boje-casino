import type { Round, Spot } from './rules'

/*
  Showtime's timetable, on the database clock. A round takes bets for 15 s, closing half a second before its show
  starts. The Booster runs for 3 s, then the wheel for 7 s. A number's result shows for 4 s before the next round
  opens. A bonus round takes the stage 2 s after the wheel stops and plays to a fixed timetable, whose length depends
  only on how many drops (Peg Drop) or spins (Mega Spin) it takes; its result shows for 5 s. Prize Wall and Mega Spin
  give the players a fixed time to pick, and the seed is revealed when it is up. _st_current in api/_lib/schema.js
  runs the same timetable (tools/showtime-sql/test.mjs holds the two to it).
*/

export const BET_MS = 15000
/** betting closes this long before the show starts; the key is revealed then */
export const CLOSE_MS = 500
export const BOOST_MS = 3000
export const WHEEL_MS = 7000
export const NUMBER_SHOW_MS = 4000
/** a bonus round: the wheel shows what it stopped on, then the bonus round's intro */
export const LAND_MS = 2000
export const INTRO_MS = 2500
export const TOSS_MS = 3000
/** Peg Drop: each drop, the DOUBLE between drops, and the last drop settling */
export const DROP_MS = 2400
export const DOUBLE_MS = 1600
export const PEG_LAND_MS = 900
export const WALL_PICK_MS = 10000
export const WALL_REVEAL_MS = 4500
/** Mega Spin: the pick, a moment before the first spin, the first spin, then a DOUBLE or TRIPLE and a respin each */
export const MEGA_PICK_MS = 8000
export const MEGA_LEAD_MS = 1000
export const MEGA_FIRST_MS = 6000
export const MEGA_MARK_MS = 2000
export const MEGA_RESPIN_MS = 4500
export const MEGA_FINAL_MS = 1200
export const BONUS_SHOW_MS = 5000
/** a bonus round's result plate shows this long before the stage goes back to the wheel */
export const PLATE_MS = 2000

export interface Times {
  /** the show starts: the Booster */
  startsAt: number
  /** the wheel stops */
  landsAt: number
  /** a bonus round takes the stage, and its intro ends (null for a number) */
  bonusAt: number | null
  playAt: number | null
  /** Prize Wall and Mega Spin: the picks close and the seed is revealed (null otherwise) */
  picksUntil: number | null
  /** the result is final */
  endsAt: number
  /** the next round opens */
  nextAt: number
}

/** A round's timetable from when its show starts; `n` is how many drops (Peg Drop) or spins (Mega Spin) it takes. */
export function timesOf(spot: Spot, n: number, startsAt: number): Times {
  const landsAt = startsAt + BOOST_MS + WHEEL_MS
  if (spot === '1' || spot === '2' || spot === '5' || spot === '10') return { startsAt, landsAt, bonusAt: null, playAt: null, picksUntil: null, endsAt: landsAt, nextAt: landsAt + NUMBER_SHOW_MS }
  const bonusAt = landsAt + LAND_MS
  const playAt = bonusAt + INTRO_MS
  let picksUntil: number | null = null
  let endsAt: number
  if (spot === 'coin') endsAt = playAt + TOSS_MS
  else if (spot === 'peg') endsAt = playAt + n * DROP_MS + (n - 1) * DOUBLE_MS + PEG_LAND_MS
  else if (spot === 'wall') {
    picksUntil = playAt + WALL_PICK_MS
    endsAt = picksUntil + WALL_REVEAL_MS
  } else {
    picksUntil = playAt + MEGA_PICK_MS
    endsAt = megaSpins(picksUntil, Math.max(1, n)).pop()!.to + MEGA_FINAL_MS
  }
  return { startsAt, landsAt, bonusAt, playAt, picksUntil, endsAt, nextAt: endsAt + BONUS_SHOW_MS }
}

/** how many drops or spins a drawn round's bonus takes (the Mega Spin's are only known once it is revealed) */
export const stepsOf = (r: Round) => (r.bonus?.kind === 'peg' ? r.bonus.drops.length : r.bonus?.kind === 'mega' ? (r.bonus.spins?.length ?? 0) : 0)

/** when each Peg Drop drop starts */
export const dropAt = (playAt: number, k: number) => playAt + k * (DROP_MS + DOUBLE_MS)

/** when each of a Mega Spin's n spins starts and stops */
export function megaSpins(picksUntil: number, n: number): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = []
  let t = picksUntil + MEGA_LEAD_MS
  for (let k = 0; k < n; k++) {
    const len = k ? MEGA_RESPIN_MS : MEGA_FIRST_MS
    out.push({ from: t, to: t + len })
    t += len + MEGA_MARK_MS
  }
  return out
}

export type Phase = 'betting' | 'show' | 'done'

/** the phase a round is in at `now` on the server clock ('next' once its result has been shown) */
export function phaseAt(r: { startsAt: number; endsAt: number; nextAt: number }, now: number): Phase | 'next' {
  if (now < r.startsAt - CLOSE_MS) return 'betting'
  if (now < r.endsAt) return 'show'
  return now < r.nextAt ? 'done' : 'next'
}
