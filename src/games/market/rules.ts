/*
  Market Rush's rules: a live price that ticks ten times a second, and positions on it, Up (long) or Down (short),
  with leverage, closed whenever the player likes.

  The price is a martingale: each tick multiplies it by (1 + σ·z), where z has mean 0 and variance 1 and never
  exceeds 3 either way (the sum of three uniform numbers, centred and scaled), and σ is the market's mood (Calm,
  Steady or Wild), which changes now and then. So, whatever has happened, the next price is on average the price now,
  and no way of watching it can tell which way it will go.

  A position stakes coins. Opening it costs FEE of the stake; what is left is its margin. Its notional is the stake
  times the leverage, and its value moves with the price in a straight line:
      value = margin + notional × (price / entry − 1)     (Up; Down subtracts the move)
  The value is therefore a martingale too: closing at any moment the player chooses is worth, on average, the
  margin, i.e. the stake less the fee. That is the house edge, and no timing changes it.

  Liquidation: when a tick leaves the value at LIQ of the stake or less, the position is closed for nothing. A tick
  moves the price by at most 3σ, so the value can only fall a bounded way past the liquidation line in one tick;
  LIQ is set well above what a tick can take away on average (see tools/market-test.ts), so a liquidation is on
  average a gain for the house, never a loss, and the edge for any way of playing is at least the fee. A position
  worth MAX_MULT stakes closes itself and pays MAX_MULT. Auto close (take profit, stop loss) closes at the first tick
  past its line, at that tick's value.
*/

export const FEE = 0.02
/** a position is liquidated when worth this share of its stake or less */
export const LIQ = 0.2
/** a position closes itself when worth this many stakes */
export const MAX_MULT = 1000
export const LEVERAGES = [1, 2, 5, 10, 25, 50, 100] as const
export const TICK_MS = 100
/** the price a new market starts at */
export const START_PRICE = 1000

/* ---------------- the market ---------------- */

export const MOODS = [
  { id: 'calm', name: 'Calm', sigma: 0.0003 },
  { id: 'steady', name: 'Steady', sigma: 0.0006 },
  { id: 'wild', name: 'Wild', sigma: 0.0011 },
] as const
/** the chance each tick that the mood changes (about every 40 seconds) */
export const MOOD_CHANGE = 1 / 400
/** the most one tick can move the price, as a share of it */
export const MAX_MOVE = 3 * MOODS[MOODS.length - 1].sigma

export interface Market {
  price: number
  /** index into MOODS */
  mood: number
  /** ticks since the market began */
  tick: number
}

export const newMarket = (price = START_PRICE): Market => ({ price, mood: 1, tick: 0 })

/** a shock with mean 0 and variance 1, never beyond ±3: three uniforms, summed, centred and scaled by 2 */
export const shock = (rng: () => number) => (rng() + rng() + rng() - 1.5) * 2

/** the market one tick on */
export function step(m: Market, rng: () => number): Market {
  const price = m.price * (1 + MOODS[m.mood].sigma * shock(rng))
  let mood = m.mood
  if (rng() < MOOD_CHANGE) {
    // to one of the other moods, alike
    mood = (m.mood + 1 + Math.floor(rng() * (MOODS.length - 1))) % MOODS.length
  }
  return { price, mood, tick: m.tick + 1 }
}

/* ---------------- positions ---------------- */

export type Side = 'up' | 'down'

export interface Position {
  id: string
  side: Side
  leverage: number
  stake: number
  entry: number
  /** when it opened (ms) and at which tick */
  at: number
  tick: number
  /** auto close: take profit when worth this many stakes or more; stop loss when worth this many or less */
  takeProfit?: number
  stopLoss?: number
}

export const marginOf = (stake: number) => stake * (1 - FEE)

/** what a position is worth at a price, in coins (before liquidation or the cap are applied) */
export function valueAt(p: Position, price: number): number {
  const move = (price / p.entry - 1) * (p.side === 'up' ? 1 : -1)
  return marginOf(p.stake) + p.stake * p.leverage * move
}

/** the price at which a position is liquidated */
export function liqPrice(p: Position): number {
  const room = (1 - FEE - LIQ) / p.leverage
  return p.entry * (p.side === 'up' ? 1 - room : 1 + room)
}

export type CloseReason = 'manual' | 'liquidated' | 'takeProfit' | 'stopLoss' | 'cap' | 'left'

/** whether a position closes itself at this price, and why */
export function autoClose(p: Position, price: number): CloseReason | null {
  const v = valueAt(p, price)
  if (v <= LIQ * p.stake) return 'liquidated'
  if (v >= MAX_MULT * p.stake) return 'cap'
  if (p.takeProfit && v >= p.takeProfit * p.stake) return 'takeProfit'
  if (p.stopLoss && v <= p.stopLoss * p.stake) return 'stopLoss'
  return null
}

/** what closing a position at this price pays, in coins (to the cent) */
export function payoutAt(p: Position, price: number, reason: CloseReason): number {
  if (reason === 'liquidated') return 0
  const v = Math.min(MAX_MULT * p.stake, valueAt(p, price))
  return Math.max(0, Math.floor(v * 100 + 1e-6) / 100)
}

/** a position's value as a multiple of its stake, for the screen */
export const multipleAt = (p: Position, price: number) => valueAt(p, price) / p.stake
