import { BULL, OUTER_BULL, regionName, regionScore, type Region } from './rules'

/*
  What the caller says. Each dart is called as the board reads ("T20", "S5", "25", "BULL", "MISS"; spoken in full
  for screen readers), and a round that earns it gets the caller's line, in darts' own words: a ton (100), a ton-plus,
  a ton-forty (140 and over), three in a bed (three darts in one treble), three bulls, and the one hundred and
  eighty. Twenty-six off a single 20, 1 and 5 is the old pub "bed and breakfast" (it was the price of one).
*/

export const callOf = (r: Region) => regionName(r)

export function spoken(r: Region): string {
  if (r === 0) return 'a miss'
  if (r === BULL) return 'the bull'
  if (r === OUTER_BULL) return 'the 25'
  if (r <= 20) return `single ${r}`
  if (r <= 40) return `double ${r - 20}`
  return `treble ${r - 40}`
}

export interface Callout {
  text: string
  /** 'max' takes the stage, 'big' is a headline, 'small' a line under the board */
  size: 'max' | 'big' | 'small'
  /** how loud the crowd is, 0 to 1 (none below 0) */
  roar: number
}

export function calloutOf(regions: Region[]): Callout | null {
  const total = regions.reduce((a, r) => a + regionScore(r), 0)
  if (total === 180) return { text: 'ONE HUNDRED AND EIGHTY!', size: 'max', roar: 1 }
  if (regions.every((r) => r === BULL)) return { text: 'THREE BULLS!', size: 'max', roar: 1 }
  if (regions[0] > 40 && regions.every((r) => r === regions[0])) return { text: 'THREE IN A BED!', size: 'max', roar: 1 }
  if (total >= 140) return { text: 'TON FORTY!', size: 'big', roar: 0.65 }
  if (total > 100) return { text: 'TON PLUS!', size: 'small', roar: 0.3 }
  if (total === 100) return { text: 'TON!', size: 'small', roar: 0.3 }
  if (total === 26 && [...regions].sort((a, b) => a - b).join() === '1,5,20') return { text: 'BED & BREAKFAST', size: 'small', roar: -1 }
  return null
}
