/*
  Slots maths: a 6 × 5 grid that pays anywhere. Eight or more of one symbol anywhere on the grid win,
  the winning symbols shatter and everything above falls into the gaps (a tumble), and new symbols drop
  in from the top until nothing more wins. Four or more stars start ten free spins. In free spins,
  multiplier orbs can land; they stay put through the tumbles and, if the spin won anything, their
  values are added up and multiply that spin's total. Three or more stars during free spins add five.

  Everything is drawn up front: a round is the whole sequence of grids, which the screen then plays back.
  Simulated return: base game about 96.5%, bought free spins about 96.5% (see tools/slots-sim.ts).
*/

export type PaySym = 'crown' | 'heart' | 'diamond' | 'coin' | 'emerald' | 'sapphire' | 'amethyst' | 'topaz' | 'aqua'
export type Sym = PaySym | 'star' | 'orb'

export const COLS = 6
export const ROWS = 5
export const MIN_COUNT = 8

/** Highest paying first. */
export const PAY_SYMS: PaySym[] = ['crown', 'heart', 'diamond', 'coin', 'emerald', 'sapphire', 'amethyst', 'topaz', 'aqua']

/** Pays for 8–9, 10–11 and 12+ anywhere, in multiples of the total bet. */
export const PAYS: Record<PaySym, [number, number, number]> = {
  crown: [25, 60, 125],
  heart: [6, 25, 60],
  diamond: [5, 12, 40],
  coin: [4, 5, 30],
  emerald: [2.5, 4, 25],
  sapphire: [2, 3, 20],
  amethyst: [1.2, 2.5, 12],
  topaz: [1, 2, 10],
  aqua: [0.6, 1.8, 5],
}

export const payFor = (sym: PaySym, count: number) => (count < MIN_COUNT ? 0 : PAYS[sym][count >= 12 ? 2 : count >= 10 ? 1 : 0])

/** Stars anywhere at the end of a base-game spin: 4, 5 and 6+ pay this many times the bet. */
export const STAR_PAYS: [number, number, number] = [3, 5, 100]
export const STARS_TO_TRIGGER = 4
export const FREE_SPINS = 10
export const RETRIGGER_STARS = 3
export const RETRIGGER_SPINS = 5
export const MAX_FREE_SPINS = 100
/** Price of buying straight into free spins, in multiples of the bet. */
export const BUY_PRICE = 100
/** No round pays more than this many times the bet. */
export const MAX_WIN = 5000

/** Orb multipliers and how often each lands (relative). */
export const ORB_VALUES: [number, number][] = [
  [2, 300],
  [3, 220],
  [4, 140],
  [5, 110],
  [6, 70],
  [8, 50],
  [10, 34],
  [12, 20],
  [15, 14],
  [20, 9],
  [25, 6],
  [50, 2.2],
  [100, 0.7],
]

type Weights = Record<Sym, number>

/** How often each symbol drops in (relative), in the base game and in free spins. */
const BASE: Weights = {
  crown: 10,
  heart: 11.7,
  diamond: 13.7,
  coin: 16,
  emerald: 18.7,
  sapphire: 21.9,
  amethyst: 25.7,
  topaz: 30,
  aqua: 35.1,
  star: 3,
  orb: 0,
}
// free spins lean harder on the common gems, so far more spins win and the orbs have something to multiply
const FREE: Weights = {
  crown: 10,
  heart: 13,
  diamond: 16.9,
  coin: 22,
  emerald: 28.6,
  sapphire: 37.1,
  amethyst: 48.3,
  topaz: 62.7,
  aqua: 81.6,
  star: 5,
  orb: 6.2,
}

export interface Cell {
  /** unique within a round, so the screen can follow a symbol as it falls */
  id: number
  sym: Sym
  /** orb multiplier */
  mult?: number
}
/** grid[col][row], row 0 at the top */
export type Grid = Cell[][]

export interface Win {
  sym: PaySym
  count: number
  /** multiple of the bet */
  pay: number
  ids: number[]
}

export interface Tumble {
  /** the grid as it stands before this step's wins are taken */
  grid: Grid
  wins: Win[]
  /** sum of this step's wins, multiple of the bet */
  win: number
}

export interface Spin {
  /** the last tumble has no wins; it is the grid the spin ends on */
  tumbles: Tumble[]
  /** line-up wins over all tumbles, before orbs */
  tumbleWin: number
  /** total of the orbs on the final grid (free spins only); 0 when there are none */
  orbSum: number
  stars: number
  /** star pay (base game) */
  starPay: number
  /** what the spin pays in all, multiple of the bet */
  win: number
  /** free spins this spin awards */
  award: number
}

export interface Round {
  base: Spin | null
  free: Spin[]
  /** total return, multiple of the bet */
  total: number
  bought: boolean
  capped: boolean
}

function picker(w: Weights) {
  const syms = (Object.keys(w) as Sym[]).filter((s) => w[s] > 0)
  const total = syms.reduce((a, s) => a + w[s], 0)
  return (rng: () => number): Sym => {
    let x = rng() * total
    for (const s of syms) {
      x -= w[s]
      if (x < 0) return s
    }
    return syms[syms.length - 1]
  }
}
const pickBase = picker(BASE)
const pickFree = picker(FREE)
const ORB_TOTAL = ORB_VALUES.reduce((a, [, w]) => a + w, 0)
function pickOrb(rng: () => number) {
  let x = rng() * ORB_TOTAL
  for (const [v, w] of ORB_VALUES) {
    x -= w
    if (x < 0) return v
  }
  return 2
}

interface Maker {
  next: number
  cell: () => Cell
}
function maker(rng: () => number, free: boolean): Maker {
  const m: Maker = {
    next: 1,
    cell: () => {
      const sym = (free ? pickFree : pickBase)(rng)
      return sym === 'orb' ? { id: m.next++, sym, mult: pickOrb(rng) } : { id: m.next++, sym }
    },
  }
  return m
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function findWins(grid: Grid): Win[] {
  const by = new Map<PaySym, number[]>()
  for (const col of grid)
    for (const c of col) {
      if (c.sym === 'star' || c.sym === 'orb') continue
      let list = by.get(c.sym)
      if (!list) by.set(c.sym, (list = []))
      list.push(c.id)
    }
  const wins: Win[] = []
  for (const sym of PAY_SYMS) {
    const ids = by.get(sym)
    if (ids && ids.length >= MIN_COUNT) wins.push({ sym, count: ids.length, pay: payFor(sym, ids.length), ids })
  }
  return wins
}

/** Takes out the winners: survivors fall to the bottom of their column, new cells fill the top. */
export function collapse(grid: Grid, gone: Set<number>, make: () => Cell): Grid {
  return grid.map((col) => {
    const keep = col.filter((c) => !gone.has(c.id))
    const fresh = Array.from({ length: ROWS - keep.length }, make)
    return [...fresh, ...keep]
  })
}

function playSpin(m: Maker, free: boolean): Spin {
  let grid: Grid = Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => m.cell()))
  const tumbles: Tumble[] = []
  let tumbleWin = 0
  for (;;) {
    const wins = findWins(grid)
    const win = round2(wins.reduce((a, w) => a + w.pay, 0))
    tumbles.push({ grid, wins, win })
    if (!wins.length) break
    tumbleWin = round2(tumbleWin + win)
    grid = collapse(grid, new Set(wins.flatMap((w) => w.ids)), () => m.cell())
  }
  let stars = 0
  let orbSum = 0
  for (const col of grid)
    for (const c of col) {
      if (c.sym === 'star') stars++
      else if (c.sym === 'orb') orbSum += c.mult ?? 0
    }
  const starPay = free || stars < STARS_TO_TRIGGER ? 0 : STAR_PAYS[Math.min(stars, 6) - 4]
  const lineUp = free && orbSum > 0 && tumbleWin > 0 ? tumbleWin * orbSum : tumbleWin
  const award = free ? (stars >= RETRIGGER_STARS ? RETRIGGER_SPINS : 0) : stars >= STARS_TO_TRIGGER ? FREE_SPINS : 0
  return { tumbles, tumbleWin, orbSum: free ? orbSum : 0, stars, starPay, win: round2(lineUp + starPay), award }
}

/** One paid spin and any free spins it leads to; or, when `buy` is set, a bought feature. */
export function playRound(rng: () => number, buy = false): Round {
  let total = 0
  let capped = false
  let base: Spin | null = null
  let left = FREE_SPINS
  if (!buy) {
    base = playSpin(maker(rng, false), false)
    total = base.win
    left = base.award
    if (total >= MAX_WIN) {
      total = MAX_WIN
      capped = true
      left = 0
    }
  }
  const free: Spin[] = []
  // one id counter for the whole feature keeps ids unique across spins (the screen keys symbols by id)
  const m = maker(rng, true)
  if (base) m.next = 100000
  let given = left
  while (left > 0) {
    const s = playSpin(m, true)
    free.push(s)
    total = round2(total + s.win)
    left--
    if (s.award && given < MAX_FREE_SPINS) {
      const add = Math.min(s.award, MAX_FREE_SPINS - given)
      left += add
      given += add
    }
    if (total >= MAX_WIN) {
      total = MAX_WIN
      capped = true
      break
    }
  }
  return { base, free, total, bought: buy, capped }
}

/** Every cell of a grid by id, for lookups during playback. */
export function cellsById(grid: Grid) {
  const m = new Map<number, { col: number; row: number; cell: Cell }>()
  grid.forEach((col, c) => col.forEach((cell, r) => m.set(cell.id, { col: c, row: r, cell })))
  return m
}
