import type { Spot } from './rules'

/* How each spot looks and reads: on the wheel, the betting board, the Booster and the history. */

export interface SpotLook {
  /** the board's title and the history's short label */
  name: string
  short: string
  /** the segment's colours: its face, a deeper shade for its edge, and the text on it */
  face: string
  deep: string
  ink: string
  /** one line for the board and the paytable */
  line: string
}

export const LOOK: Record<Spot, SpotLook> = {
  '1': { name: '1', short: '1', face: '#3fa9f5', deep: '#1f6fb8', ink: '#fff', line: 'Pays 1 to 1' },
  '2': { name: '2', short: '2', face: '#f7c548', deep: '#c98d14', ink: '#3a2400', line: 'Pays 2 to 1' },
  '5': { name: '5', short: '5', face: '#ff5fa2', deep: '#c22a6b', ink: '#fff', line: 'Pays 5 to 1' },
  '10': { name: '10', short: '10', face: '#9b7bff', deep: '#5d3fd1', ink: '#fff', line: 'Pays 10 to 1' },
  coin: { name: 'Coin Toss', short: 'Coin', face: '#ff8a3d', deep: '#c4501a', ink: '#fff', line: 'A coin with a prize on each face' },
  peg: { name: 'Peg Drop', short: 'Peg', face: '#22d36f', deep: '#11894a', ink: '#04210f', line: 'Drop the puck down the pegs' },
  wall: { name: 'Prize Wall', short: 'Wall', face: '#22c7d8', deep: '#0f7f8c', ink: '#032a30', line: 'Pick a prize from the wall' },
  mega: { name: 'Mega Spin', short: 'Mega', face: '#ff4d61', deep: '#b31d34', ink: '#fff', line: 'The giant wheel, up to 20,000×' },
}

/** a multiplier as the show prints it: ×12, ×1,250 */
export const fmtX = (m: number) => `×${m >= 1000 ? m.toLocaleString('en-US') : +m.toFixed(2)}`
