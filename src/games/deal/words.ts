import { fmt } from '../../lib/format'
import { BOARDS, CASES, ROUNDS, boardOf, unseen, type BoardId, type Game } from './rules'

/*
  Banker's Deal's numbers and words: prizes as coins at a stake (floored to the cent, exactly as payoutOf pays them),
  short coin and multiple texts that fit a case's card or a prize bar, each board's colours, and the line under the
  stage for every moment of a game.
*/

/** a prize (a multiple of the stake) in coins, to the cent, as the game would pay it */
export const prizeCoins = (stake: number, prize: number) => Math.floor(stake * prize * 100 + 1e-6) / 100

const trim = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
/** coins short enough for a card or a bar: 0.10, 7.50, 250, 2,500, 12.5K, 1.25M */
export function coinText(v: number): string {
  if (v >= 1e6) return `${trim((v / 1e6).toFixed(v >= 1e7 ? 1 : 2))}M`
  if (v >= 1e4) return `${trim((v / 1e3).toFixed(v >= 1e5 ? 0 : 1))}K`
  return Number.isInteger(v) ? fmt(v, 0) : fmt(v, 2)
}
/** a multiple of the stake: 0.05×, 1.5×, 250× */
export const multText = (m: number) => `${m >= 100 ? fmt(m, 0) : trim(m.toFixed(2))}×`

export interface Tier {
  id: BoardId
  name: string
  /** light and deep colours, the glow, and the studio wall's tint */
  a: string
  b: string
  glow: string
  wall: string
}
export const TIERS: Record<BoardId, Tier> = {
  classic: { id: 'classic', name: 'Classic', a: '#8fd0ff', b: '#2a6fd8', glow: 'rgba(76,170,255,.40)', wall: '#2a5bd8' },
  gold: { id: 'gold', name: 'Gold', a: '#fff0a8', b: '#e09a10', glow: 'rgba(247,197,72,.50)', wall: '#e0a21c' },
  diamond: { id: 'diamond', name: 'Diamond', a: '#c9f6ff', b: '#8a5cff', glow: 'rgba(160,215,255,.55)', wall: '#7f6bff' },
}
export const topOf = (b: BoardId) => boardOf(b).prizes[CASES - 1]
export const chanceOf = (b: BoardId) => BOARDS.find((x) => x.id === b)!.chance
export const pct = (p: number, d = 2) => `${(p * 100).toFixed(d)}%`
/** "1 in 500" for the rare boards */
export const oneIn = (p: number) => `1 in ${fmt(Math.round(1 / p), 0)}`

/** a prize's rank on its board, 0 (the smallest) to 1 (the top) */
export const rankOf = (b: BoardId, prize: number) => boardOf(b).prizes.indexOf(prize) / (CASES - 1)
/** whether a prize is one of the board's top half (the gold column) */
export const isHigh = (b: BoardId, prize: number) => boardOf(b).prizes.indexOf(prize) >= CASES / 2

const mean = (v: readonly number[]) => (v.length ? v.reduce((a, x) => a + x, 0) / v.length : 0)
/** the average of the prizes still unseen: what the player's case is worth on average now */
export const unseenAverage = (g: Game) => mean(unseen(g))

/** cases opened before round r */
export const openedBefore = (r: number) => ROUNDS.slice(0, r).reduce((a, n) => a + n, 0)

/** what the game is waiting for, in a few words */
export function stepLine(g: Game, left: number): string {
  if (g.step === 'pick') return 'Pick the case you will keep'
  if (g.step === 'open') return left === 1 ? 'Open 1 more case' : `Open ${left} cases`
  if (g.step === 'offer') return g.round >= ROUNDS.length ? 'Final two: Deal, No Deal or Swap?' : 'Deal or No Deal?'
  return g.dealt != null ? 'Deal done' : 'Case opened'
}
