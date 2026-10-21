import { fmt } from '../../lib/format'
import { FEE, LIQ, MOODS, shock, type Position } from './rules'

/*
  The arithmetic the screen needs around the rules (rules.ts stays the money's source of truth): where on the chart a
  position is worth so many stakes, how far the price has to move for that, and the price and percentage formats.
*/

/** the price move (a share of the entry price) that takes a position from its margin to `mult` stakes */
export const moveFor = (leverage: number, mult: number) => (mult - (1 - FEE)) / leverage
/** the move against a position that liquidates it */
export const liqMove = (leverage: number) => (1 - FEE - LIQ) / leverage

/** the price at which a position is worth `mult` stakes */
export const priceAtMult = (p: Pick<Position, 'entry' | 'side' | 'leverage'>, mult: number) => p.entry * (1 + (p.side === 'up' ? 1 : -1) * moveFor(p.leverage, mult))

export const fmtPrice = (p: number) => fmt(p, 2)
/** a share as a percentage: 0.0312 → "3.12%"; small ones keep more digits */
export const fmtPct = (x: number) => `${(x * 100).toFixed(Math.abs(x) >= 0.1 ? 1 : 2)}%`
/** a signed amount of coins: "+12.40", "−3.10" */
export const signed = (v: number) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 2)}`

/**
 * A believable minute or so of prices behind a market that has none yet (a first visit): the walk run backwards from
 * the price, at the market's mood. Only for the chart; nothing is valued on it.
 */
export function backfill(price: number, mood: number, n = 900): number[] {
  const out = new Array<number>(n)
  out[n - 1] = price
  const sigma = MOODS[mood]?.sigma ?? MOODS[1].sigma
  for (let i = n - 2; i >= 0; i--) out[i] = out[i + 1] / (1 + sigma * shock(Math.random))
  return out
}
