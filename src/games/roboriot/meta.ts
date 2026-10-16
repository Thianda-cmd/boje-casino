import type { BonusKind, Sym } from './rules'

/* Colours and names of the Robo Riot cast, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  rex: '#ff4b3e',
  dot: '#19d3c5',
  clank: '#ffc21a',
  zip: '#a45bff',
  nut: '#c9d3e6',
  gear: '#ff9a3c',
  battery: '#4dff8f',
  chip: '#3ea2ff',
  wild: '#ff3fd2',
  cell: '#5cf2ff',
  magnet: '#ff3b5c',
  zap: '#ffe14a',
  boost: '#59ff7a',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  rex: 'Rex',
  dot: 'Dot',
  clank: 'Clank',
  zip: 'Zip',
  nut: 'Hex nut',
  gear: 'Gear',
  battery: 'Battery',
  chip: 'Microchip',
  wild: 'Wild core',
  cell: 'Power cell',
  magnet: 'Magnet bot',
  zap: 'Zap bot',
  boost: 'Boost bot',
}

/** what each bonus symbol does in the Power Grid; bots work on the plain power cells only, never on each other */
export const BOT_TEXT: Record<BonusKind, string> = {
  cell: 'Holds its value, and the bots power it up.',
  magnet: 'Collects the value of every power cell on the board.',
  zap: 'Fires three bolts at power cells; each doubles the cell it hits.',
  boost: 'Adds its value to every power cell on the board.',
}

/** cell glow by value (multiples of the bet): cyan, blue, violet, magenta, gold */
export function valueColor(v: number) {
  return v >= 50 ? '#ffcf3a' : v >= 20 ? '#ff4fd8' : v >= 10 ? '#b56bff' : v >= 5 ? '#3d8bff' : '#5cf2ff'
}

export const TIERS = [
  { min: 15, name: 'Big win' },
  { min: 40, name: 'Mega win' },
  { min: 100, name: 'Epic win' },
  { min: 500, name: 'Riot!' },
] as const
/** the highest tier reached by a win of `mult` × bet, or -1 below 15× */
export const tierIndex = (mult: number) => TIERS.reduce((i, t, k) => (mult >= t.min ? k : i), -1)
