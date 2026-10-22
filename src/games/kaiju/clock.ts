/*
  Kaiju Clash's timetable, on the database clock. It never changes from round to round, so the database only has to
  keep the clock (api/_lib/schema.js _kj_current runs the same one; tools/kaiju-sql/test.mjs holds the two to it).

  Round n opens at n × CYCLE_MS. Bets are taken for BET_MS, closing CLOSE_MS before the show, when the key (and so
  the fight) is revealed. The walkout takes WALKOUT_MS: the kaiju come out and roar. Then three rounds of ROUND_MS
  with BREAK_MS between them; a knockout or a Splash ends the fight early, and the rest of the slot is the replay and
  the celebration. The result is final at endsAt, when the seed is revealed, and shows for RESULT_MS before the next
  round opens.
*/

export const BET_MS = 17000
/** betting closes this long before the show starts; the key is revealed then */
export const CLOSE_MS = 500
export const WALKOUT_MS = 6000
export const ROUND_MS = 10000
export const BREAK_MS = 3000
export const RESULT_MS = 8000
/** the first bell to the final bell */
export const FIGHT_MS = 3 * ROUND_MS + 2 * BREAK_MS
export const CYCLE_MS = BET_MS + WALKOUT_MS + FIGHT_MS + RESULT_MS

export type Phase = 'bets' | 'closed' | 'walkout' | 'fight' | 'result'

export interface Times {
  /** betting opens */
  opensAt: number
  /** betting closes; the key is revealed */
  closesAt: number
  /** the walkout starts */
  showAt: number
  /** the first bell */
  fightAt: number
  /** the final bell: the result is final and the seed is revealed */
  endsAt: number
  /** the next round opens */
  nextAt: number
}

/** the round taking bets (or on stage) at a moment */
export const roundAt = (now: number) => Math.floor(now / CYCLE_MS)

export function timesOf(id: number): Times {
  const opensAt = id * CYCLE_MS
  const showAt = opensAt + BET_MS
  const fightAt = showAt + WALKOUT_MS
  const endsAt = fightAt + FIGHT_MS
  return { opensAt, closesAt: showAt - CLOSE_MS, showAt, fightAt, endsAt, nextAt: endsAt + RESULT_MS }
}

export function phaseAt(t: Times, now: number): Phase {
  if (now < t.closesAt) return 'bets'
  if (now < t.showAt) return 'closed'
  if (now < t.fightAt) return 'walkout'
  if (now < t.endsAt) return 'fight'
  return 'result'
}

/*
  The result is shown, and paid, once the show has told it: REVEAL_FINISH_MS after a knockout or a Splash (the K.O. or
  SPLASH banner), REVEAL_DECISION_MS after the final bell of a decision (THAT'S THE FIGHT, then the three judges' cards
  turned one by one). The fight is known from the close, but no screen, and no balance, shows it any sooner.
*/
export const REVEAL_FINISH_MS = 3000
export const REVEAL_DECISION_MS = 3350

/** when a fight's result is shown and paid (server ms), from its first bell and when the script says it ended */
export const revealAt = (fightAt: number, ended: number) => fightAt + ended + (ended >= FIGHT_MS ? REVEAL_DECISION_MS : REVEAL_FINISH_MS)

/** when round k (1 to 3) starts, in ms from the first bell */
export const roundStart = (k: number) => (k - 1) * (ROUND_MS + BREAK_MS)

/** which round a moment of the fight falls in (ms from the first bell), and whether it is a break before that round */
export function fightRoundAt(ms: number): { round: 1 | 2 | 3; break: boolean } {
  for (const k of [1, 2, 3] as const) {
    if (ms < roundStart(k)) return { round: k, break: true }
    if (ms < roundStart(k) + ROUND_MS) return { round: k, break: false }
  }
  return { round: 3, break: false }
}
