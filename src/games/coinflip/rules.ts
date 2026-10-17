/*
  Coin Flip rules. Call Heads (the Boje gem) or Tails (the crown), pay the bet and flip. A flip the coin lands on your
  call wins; then cash out, or flip again to double the streak's value. A flip that lands the other way ends the
  streak with nothing. A streak is at most MAX_FLIPS flips: the sixteenth win cashes out by itself.

  The cash-out after n wins is RTP × 2^n: 1.94×, 3.88×, 7.76× ... 63,569.92× (97 × 2^n hundredths, so always a whole
  number of cents and never floored). A flip wins with chance exactly 1/2 whatever side is called, the game has no
  memory, and so every way of playing returns 97%: stopping after n wins pays RTP × 2^n with chance 2^-n, and any
  rule for when to stop, or what to call, is a mix of those (2^n × [still alive after n] is a martingale).

  Each flip is drawn the moment it is thrown, from one number of the stream, before the call is looked at
  (`drawWin`); the face it lands on follows from the outcome and the call. (tools/coinflip-test.ts checks the
  multipliers and returns exactly, and that the call never changes the odds.)
*/

export const RTP = 0.97
export const MAX_FLIPS = 16

export type Side = 'heads' | 'tails'
export const SIDES: readonly Side[] = ['heads', 'tails']
export const other = (s: Side): Side => (s === 'heads' ? 'tails' : 'heads')
export const isSide = (x: unknown): x is Side => x === 'heads' || x === 'tails'
export const sideLetter = (s: Side) => (s === 'heads' ? 'H' : 'T')
export const sideName = (s: Side) => (s === 'heads' ? 'Heads' : 'Tails')

/** floor(a / b) for whole numbers a, b below 2^53, exactly (a % b is exact in floating point) */
const idiv = (a: number, b: number) => (a - (a % b)) / b

/** the cash-out value after n wins, in whole hundredths: 97 × 2^n (0 before the first win) */
export function multCents(n: number): number {
  if (n <= 0) return 0
  return 97 * 2 ** Math.min(MAX_FLIPS, Math.floor(n))
}

/** the cash-out multiplier after n wins (0 before the first) */
export const multiplier = (n: number) => multCents(n) / 100

/** the multipliers after 1 to MAX_FLIPS wins */
export const ladder = () => Array.from({ length: MAX_FLIPS }, (_, i) => multiplier(i + 1))

/**
 * What cashing out after n wins pays on a bet, floored to the cent and worked in whole numbers (the largest product,
 * 10,000,000 cents × 97 × 2^16, is far under 2^53). A whole-coin bet is paid exactly bet × multiplier.
 */
export function payoutFor(bet: number, n: number): number {
  const cents = Math.round(bet * 100)
  return idiv(cents * multCents(n), 100) / 100
}

/** the chance that a streak reaches n wins */
export const reachChance = (n: number) => 2 ** -Math.max(0, n)

/* ---------------- a flip ---------------- */

export interface Flip {
  /** the side called for this flip */
  call: Side
  win: boolean
  /** the face the coin lands on */
  face: Side
}

/** Whether a flip wins: one number from `rng`, halved. Never sees the call. */
export function drawWin(rng: () => number): boolean {
  return Math.min(1, Math.floor(rng() * 2)) === 0
}

/** Throws the coin: the first number from `rng` decides the outcome; the face follows from it and the call. */
export function drawFlip(call: Side, rng: () => number): Flip {
  const win = drawWin(rng)
  return { call, win, face: win ? call : other(call) }
}

/* ---------------- calling in auto mode ---------------- */

export type Pattern = 'same' | 'switch' | 'random' | 'follow'
export const PATTERNS: readonly { id: Pattern; label: string; hint: string }[] = [
  { id: 'same', label: 'Same', hint: 'Always call your side' },
  { id: 'switch', label: 'Switch', hint: 'Heads, tails, heads, tails...' },
  { id: 'random', label: 'Random', hint: 'A random call every flip' },
  { id: 'follow', label: 'Follow', hint: 'Call the face that landed last' },
]
export const isPattern = (x: unknown): x is Pattern => PATTERNS.some((p) => p.id === x)

/**
 * The call for the i-th flip of an auto run (0-based over the whole run), from the player's side and the face that
 * landed last. `pick` is a fair coin for the random pattern (never the outcome stream).
 */
export function autoCall(p: Pattern, side: Side, i: number, lastFace: Side | null, pick: () => number): Side {
  if (p === 'switch') return i % 2 === 0 ? side : other(side)
  if (p === 'random') return pick() < 0.5 ? 'heads' : 'tails'
  if (p === 'follow') return lastFace ?? side
  return side
}

/* ---------------- labels ---------------- */

/** "1.94×", "63,569.92×" */
export const multLabel = (m: number) => `${m >= 1000 ? m.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : m.toFixed(2)}×`
/** the ladder's short form: two decimals, thousands as K */
export const shortMult = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 1 : 2)}K×` : `${m.toFixed(2)}×`)
/** "50%", "0.39%", "0.0015%" */
export function chanceLabel(p: number) {
  const pc = p * 100
  if (pc >= 10) return `${+pc.toFixed(2)}%`
  if (pc >= 0.1) return `${pc.toFixed(2)}%`
  return `${pc.toPrecision(2)}%`
}
/** "1 in 128" */
export const oddsLabel = (n: number) => `1 in ${(2 ** n).toLocaleString('en-US')}`
