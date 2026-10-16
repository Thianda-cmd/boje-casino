import type { Sym } from './rules'

/* Colours and names of the Chompers symbols, kept apart from the 3D models so the screen can use them without loading three.js. */

export const SYMBOL_COLOR: Record<Sym, string> = {
  grumbo: '#9b5cff',
  fang: '#ff8a2a',
  blip: '#3db4ff',
  mimi: '#ff5fa2',
  cupcake: '#ff6fae',
  lolly: '#ffd23f',
  cookie: '#e39a4c',
  gummy: '#ff3b5c',
  candy: '#2fd3c4',
  wild: '#2ee87f',
  egg: '#ffd96a',
  donut: '#ff7ac8',
}

export const SYMBOL_NAME: Record<Sym, string> = {
  grumbo: 'Grumbo',
  fang: 'Fang',
  blip: 'Blip',
  mimi: 'Mimi',
  cupcake: 'Cupcake',
  lolly: 'Lollipop',
  cookie: 'Cookie',
  gummy: 'Gummy',
  candy: 'Candy',
  wild: 'Chomper wild',
  egg: 'Monster egg',
  donut: 'Donut',
}

/** Icing colour by donut value: pink, sky, violet, red, gold. */
export function donutColor(v: number) {
  return v >= 100 ? '#ffcf3a' : v >= 50 ? '#ff5b6e' : v >= 20 ? '#b77bff' : v >= 10 ? '#59c8ff' : '#ff8ad0'
}
