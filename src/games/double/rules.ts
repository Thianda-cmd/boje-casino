/*
  Double's rules, shared by the page, the offline stand-in and the tests. The wheel has 33 positions: roll 0 is green,
  1 to 16 red and 17 to 32 black. Red and black pay 2× (16/33 × 2) and green 32× (1/33 × 32), so every bet returns
  32/33 = 96.97%. A round takes 15 s of betting (closing half a second before the spin), a 6 s spin and 3 s showing the
  winners; api/_lib/schema.js runs the same timings on the database clock.
*/

export type Color = 'red' | 'green' | 'black'
export const COLORS: readonly Color[] = ['red', 'green', 'black']
export const MULT: Record<Color, number> = { red: 2, green: 32, black: 2 }
export const LABEL: Record<Color, string> = { red: 'Red', green: 'Green', black: 'Black' }

export const BET_MS = 15000
/** betting closes this long before the spin; the roll is revealed then */
export const CLOSE_MS = 500
export const SPIN_MS = 6000
export const SHOW_MS = 3000
export const CYCLE_MS = BET_MS + SPIN_MS + SHOW_MS

/** per chip, and the most one player may have on a colour in a round */
export const MIN_STAKE = 1
export const MAX_STAKE = 100000

export const colorOf = (roll: number): Color => (roll === 0 ? 'green' : roll <= 16 ? 'red' : 'black')

/** The order of the tiles round the strip: green, then red and black alternating (1, 17, 2, 18, ... 16, 32). */
export const WHEEL: readonly number[] = [0, ...Array.from({ length: 32 }, (_, i) => (i % 2 ? 17 + (i - 1) / 2 : 1 + i / 2))]
/** where each roll sits on the strip */
export const POS: readonly number[] = WHEEL.reduce<number[]>((a, roll, i) => ((a[roll] = i), a), [])

export type Stakes = Record<Color, number>
export const noStakes = (): Stakes => ({ red: 0, green: 0, black: 0 })
const cents = (n: number) => Math.round(n * 100)
export const sumStakes = (s: Stakes) => (cents(s.red) + cents(s.green) + cents(s.black)) / 100

export interface Outcome {
  /** the stakes that reached the table: what this browser paid, capped by what the server holds */
  landed: Stakes
  bet: number
  payout: number
  /** paid but never on the table: goes back to the wallet */
  refund: number
  color: Color
  /** a green bet won (the Going Green challenge) */
  green: boolean
}

/**
 * Settles one round for this browser. `staked` is what it paid per colour, `held` what the server has on its name;
 * only what both agree on is played, and the rest is refunded.
 */
export function outcomeOf(staked: Stakes, held: Stakes, roll: number): Outcome {
  const landed = noStakes()
  for (const c of COLORS) landed[c] = Math.max(0, Math.min(cents(staked[c]), cents(held[c]))) / 100
  const color = colorOf(roll)
  const bet = sumStakes(landed)
  return {
    landed,
    bet,
    payout: (cents(landed[color]) * MULT[color]) / 100,
    refund: Math.max(0, cents(sumStakes(staked)) - cents(bet)) / 100,
    color,
    green: color === 'green' && landed.green > 0,
  }
}

export type Phase = 'betting' | 'spinning' | 'done'

/** The phase a round is in at `now` on the server clock ('next' once its winners have been shown). */
export function phaseAt(r: { startsAt: number; endsAt: number }, now: number): Phase | 'next' {
  if (now < r.startsAt - CLOSE_MS) return 'betting'
  if (now < r.endsAt) return 'spinning'
  return now < r.endsAt + SHOW_MS ? 'done' : 'next'
}

/* ---------- the strip's motion ---------- */

/** Where inside its tile the strip comes to rest after round `id`: a spread of ±0.36 of a tile, the same in every
 *  browser (it only moves the marker within the winning tile, so it says nothing about the roll). */
export function restOffset(id: number) {
  let h = (Math.imul(id | 0, 0x9e3779b1) ^ 0x5bd1e995) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  return (h / 2 ** 32 - 0.5) * 0.72
}

/** The strip's resting position (in tiles, 0 to 33) after round `id` landed on `roll`. */
export const restAt = (id: number, roll: number) => POS[roll] + restOffset(id)

/** Full turns of the strip in every spin before it reaches the winning tile. */
export const LAPS = 2

/** A spin from `from` onto round `id`'s roll: always forward, LAPS full turns and then on to the winning tile. */
export function spinTarget(from: number, id: number, roll: number) {
  const to = restAt(id, roll)
  const d = (((to - from) % 33) + 33) % 33
  return from + LAPS * 33 + d
}
