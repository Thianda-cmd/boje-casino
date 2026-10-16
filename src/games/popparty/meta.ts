import type { PaySym, Sym } from './rules'

/* Colours and names of the Pop Party cast and tiles, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  poodle: '#ff4fb8',
  giraffe: '#ffcc29',
  bunny: '#3fc4ff',
  octo: '#9a6bff',
  heart: '#ff3b55',
  star: '#49e06a',
  round: '#ff8a2a',
  disco: '#dfe6ff',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  poodle: 'Fifi the Poodle',
  giraffe: 'Stretch the Giraffe',
  bunny: 'Hopper the Bunny',
  octo: 'Squiggs the Octopus',
  heart: 'Heart balloon',
  star: 'Star balloon',
  round: 'Party balloon',
  disco: 'Disco ball',
}

export const SYMBOL_SHORT: Record<Sym, string> = {
  poodle: 'Fifi',
  giraffe: 'Stretch',
  bunny: 'Hopper',
  octo: 'Squiggs',
  heart: 'Heart',
  star: 'Star',
  round: 'Balloon',
  disco: 'Disco ball',
}

export const SYMBOL_PLURAL: Record<PaySym, string> = {
  poodle: 'Fifis',
  giraffe: 'Stretches',
  bunny: 'Hoppers',
  octo: 'Squiggs',
  heart: 'Hearts',
  star: 'Stars',
  round: 'Party balloons',
}

/** Tile colours by level 0..8: dark, lit, ×2, ×4, ×8, ×16, ×32, ×64, ×128 (×128 animates as rainbow; this is its gold rim). */
export const LEVEL_COLOR = ['#2a1a4f', '#fff1c4', '#2fd3ff', '#6dff5a', '#ffe23d', '#ff9a2e', '#ff4a5a', '#ff4fd8', '#ffd23f'] as const
export const levelColor = (level: number) => LEVEL_COLOR[Math.max(0, Math.min(8, level))]
export const levelLabel = (level: number) => (level <= 0 ? 'Dark' : level === 1 ? 'Lit' : `×${2 ** (level - 1)}`)
/** colour for a multiplier value (2..128): the matching level's colour */
export const multColor = (mult: number) => levelColor(mult >= 2 ? Math.round(Math.log2(mult)) + 1 : 1)

export const TIERS = [
  { min: 15, name: 'Big win' },
  { min: 40, name: 'Mega win' },
  { min: 100, name: 'Epic win' },
  { min: 500, name: 'Party legend' },
] as const
/** the highest tier reached by a win of `mult` × bet, or -1 below 15× */
export const tierIndex = (mult: number) => TIERS.reduce((i, t, k) => (mult >= t.min ? k : i), -1)
/** the signature "Big Pop" moment plays once per round when the shown total first reaches this many bets */
export const BIG_POP_AT = 50
