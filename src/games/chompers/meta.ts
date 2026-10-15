import type { Sym } from './rules'

/* Colours and names of the Chompers symbols, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  grumbo: '#9b5cff',
  fang: '#ff8a2a',
  blip: '#3db4ff',
  mimi: '#ff5fa2',
  A: '#ff4d61',
  K: '#3d8bff',
  Q: '#b06bff',
  J: '#1fc9b0',
  T: '#ffae2b',
  wild: '#2ee87f',
  egg: '#ffd96a',
  donut: '#ff7ac8',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  grumbo: 'Grumbo',
  fang: 'Fang',
  blip: 'Blip',
  mimi: 'Mimi',
  A: 'A',
  K: 'K',
  Q: 'Q',
  J: 'J',
  T: '10',
  wild: 'Chomper wild',
  egg: 'Monster egg',
  donut: 'Donut',
}

/** Icing colour by donut value: pink, sky, violet, red, gold. */
export function donutColor(v: number) {
  return v >= 100 ? '#ffcf3a' : v >= 50 ? '#ff5b6e' : v >= 20 ? '#b77bff' : v >= 10 ? '#59c8ff' : '#ff8ad0'
}
