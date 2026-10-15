import type { Sym } from './rules'

/* Colours and names of the symbols, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  crown: '#ffc83d',
  heart: '#ff2e6a',
  diamond: '#cfeaff',
  coin: '#ffb627',
  emerald: '#12c86c',
  sapphire: '#3d7dff',
  amethyst: '#b05cff',
  topaz: '#ff8a1f',
  aqua: '#25d9f0',
  star: '#ffd54a',
  orb: '#7cffb2',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  crown: 'Crown',
  heart: 'Heart',
  diamond: 'Diamond',
  coin: 'Boje coin',
  emerald: 'Emerald',
  sapphire: 'Sapphire',
  amethyst: 'Amethyst',
  topaz: 'Topaz',
  aqua: 'Aquamarine',
  star: 'Star',
  orb: 'Multiplier orb',
}

/** Orb colour by value: green, blue, purple, red, gold. */
export function orbColor(v: number) {
  return v >= 100 ? '#ffcf3a' : v >= 50 ? '#ff3d5e' : v >= 12 ? '#b35cff' : v >= 6 ? '#3d9bff' : '#2fe08a'
}
