import type { Sym } from './rules'

/* Colours and names of the Plunder Bay cast, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  captain: '#ff5a4e',
  shark: '#4aa3ff',
  monkey: '#c98a4b',
  crab: '#ff8a3d',
  anchor: '#9fb3c8',
  compass: '#f2c14e',
  spyglass: '#b88cff',
  bottle: '#3fd6a0',
  flag: '#1b1f2e',
  map: '#f4dca0',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  captain: 'Captain Polly',
  shark: 'Finn the Shark',
  monkey: 'Coco the Monkey',
  crab: 'Pinch the Crab',
  anchor: 'Anchor',
  compass: 'Compass',
  spyglass: 'Spyglass',
  bottle: 'Message in a bottle',
  flag: 'Jolly Roger wild',
  map: 'Treasure map',
}

export const TIERS = [
  { min: 15, name: 'Big win' },
  { min: 40, name: 'Mega win' },
  { min: 100, name: 'Epic win' },
  { min: 500, name: 'Legendary loot' },
] as const
/** the highest tier reached by a win of `mult` × bet, or -1 below 15× */
export const tierIndex = (mult: number) => TIERS.reduce((i, t, k) => (mult >= t.min ? k : i), -1)
