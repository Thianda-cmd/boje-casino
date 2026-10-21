import { BET_MS, CLOSE_MS, CYCLE_MS, SHOW_MS, SPIN_MS } from './rules'

/*
  Pot Luck's round timetable, shared by the page, the offline stand-in and the tests; _pot_current in
  api/_lib/schema.js makes rounds on the same one. A round opens, takes coins for BET_MS (closing CLOSE_MS early, so a
  late payment can't race the draw), the wheel turns for SPIN_MS onto the winning ticket, and the winner is shown for
  SHOW_MS before the next round opens.

  The wheel's turn is a pure function of the clock (spinAt): every browser, and a page that arrives mid-draw, shows
  the same angle at the same moment.
*/

export interface Times {
  opensAt: number
  /** the draw starts; betting closed CLOSE_MS before */
  startsAt: number
  /** the wheel lands on the winner */
  endsAt: number
  /** the next round opens */
  nextAt: number
}

export const timesFrom = (opensAt: number): Times => ({ opensAt, startsAt: opensAt + BET_MS, endsAt: opensAt + BET_MS + SPIN_MS, nextAt: opensAt + CYCLE_MS })

export type Phase = 'betting' | 'spinning' | 'done'

/** The phase a round is in at `now` on the server clock ('next' once its winner has been shown). */
export function phaseAt(r: { startsAt: number; endsAt: number }, now: number): Phase | 'next' {
  if (now < r.startsAt - CLOSE_MS) return 'betting'
  if (now < r.endsAt) return 'spinning'
  return now < r.endsAt + SHOW_MS ? 'done' : 'next'
}

/* ---------- the wheel ---------- */

/** full turns the wheel makes in every draw before it reaches the winning ticket */
export const LAPS = 4

/** where the winning ticket sits on the ring, in degrees clockwise from the top: the middle of its own sliver */
export const ticketAngle = (ticket: number, tickets: number) => (tickets > 0 ? ((ticket + 0.5) / tickets) * 360 : 0)

/** the wheel's final turn for a draw: LAPS full turns, then on until the winning ticket is under the pointer at the top */
export const landAngle = (ticket: number, tickets: number) => LAPS * 360 + (360 - ticketAngle(ticket, tickets))

/** the ease of the draw: a hard push off, a long coast, a slow creep onto the ticket */
export function spinEase(p: number) {
  const x = Math.max(0, Math.min(1, p))
  // a quintic ease-out, with a touch of quartic so the last turn still moves
  return 1 - 0.8 * (1 - x) ** 5 - 0.2 * (1 - x) ** 4
}

/** the wheel's turn at `now` for a round drawing `ticket` of `tickets` (0 while betting) */
export function spinAt(r: { startsAt: number; endsAt: number }, ticket: number | null, tickets: number, now: number) {
  if (ticket == null || tickets <= 0 || now < r.startsAt) return 0
  const to = landAngle(ticket, tickets)
  if (now >= r.endsAt) return to
  return to * spinEase((now - r.startsAt) / SPIN_MS)
}

export { BET_MS, CLOSE_MS, CYCLE_MS, SHOW_MS, SPIN_MS }
