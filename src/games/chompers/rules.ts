/*
  Chompers maths: five reels of four rows, 1,024 ways. Three or more of a symbol on adjacent reels from the
  left win; each symbol pays its value times the number of ways (the product of how many it shows on each reel).
  Wild monsters land on reels 2 to 5, stand in for every paying symbol and, whenever donuts are showing,
  chomp them: each wild collects the value of every donut on the screen.

  Three, four or five eggs anywhere start 10, 15 or 20 free spins. In free spins donuts land far more often,
  every wild landed is counted, and each fourth wild adds ten spins and raises the collect multiplier to
  2×, 3× and finally 10×. Sometimes, when donuts land with no wild to eat them, a hungry wild sneaks in.

  Everything is drawn up front: a round is the whole list of spins, which the screen then plays back.
  Simulated return about 96% for paid spins and for bought free spins (tools/chompers-sim.ts).
*/

export type PaySym = 'grumbo' | 'fang' | 'blip' | 'mimi' | 'A' | 'K' | 'Q' | 'J' | 'T'
export type Sym = PaySym | 'wild' | 'egg' | 'donut'

export const COLS = 5
export const ROWS = 4

/** Highest paying first. */
export const PAY_SYMS: PaySym[] = ['grumbo', 'fang', 'blip', 'mimi', 'A', 'K', 'Q', 'J', 'T']

/** Pays for 3, 4 and 5 of a kind, per way, in multiples of the total bet. */
export const PAYS: Record<PaySym, [number, number, number]> = {
  grumbo: [0.25, 1, 5],
  fang: [0.2, 0.8, 3],
  blip: [0.15, 0.6, 2],
  mimi: [0.12, 0.5, 1.5],
  A: [0.08, 0.2, 1],
  K: [0.08, 0.2, 1],
  Q: [0.04, 0.15, 0.5],
  J: [0.04, 0.15, 0.5],
  T: [0.04, 0.15, 0.5],
}

/** Eggs anywhere: 3, 4 and 5 pay this many times the bet, and start this many free spins. */
export const EGG_PAYS: [number, number, number] = [2, 5, 20]
export const EGG_SPINS: [number, number, number] = [10, 15, 20]
export const EGGS_TO_TRIGGER = 3
/** Every this many wilds in free spins adds spins and raises the multiplier. */
export const WILDS_PER_LEVEL = 4
export const LEVEL_SPINS = 10
export const LEVEL_MULTS = [1, 2, 3, 10]
/** Price of buying straight into 10 free spins, in multiples of the bet. */
export const BUY_PRICE = 100
export const BUY_SPINS = 10
/** No round pays more than this many times the bet. */
export const MAX_WIN = 5000

/** Donut values in multiples of the bet, and how often each lands (relative): smaller ones in the base game. */
export const DONUT_VALUES: [number, number][] = [
  [2, 320],
  [5, 260],
  [10, 150],
  [15, 80],
  [20, 50],
  [25, 34],
  [50, 12],
  [100, 3.5],
  [250, 0.8],
]
export const BASE_DONUT_VALUES: [number, number][] = [
  [1, 400],
  [2, 300],
  [3, 150],
  [5, 100],
  [10, 40],
  [20, 8],
  [50, 1],
]

type Weights = Record<Sym, number>

/** How often each symbol lands (relative), base game and free spins. Wilds never land on the first reel. */
const BASE: Weights = {
  grumbo: 4,
  fang: 5,
  blip: 6,
  mimi: 7,
  A: 10,
  K: 10,
  Q: 12,
  J: 12,
  T: 13,
  wild: 1.4,
  egg: 1.3,
  donut: 0.45,
}
const FREE: Weights = {
  grumbo: 4,
  fang: 5,
  blip: 6,
  mimi: 7,
  A: 10,
  K: 10,
  Q: 12,
  J: 12,
  T: 13,
  wild: 0.95,
  egg: 0,
  donut: 12.3,
}
/** chance that a wild sneaks in when donuts land without one */
const SNEAK_BASE = 0.12
const SNEAK_FREE = 0.08

export interface Cell {
  /** unique within a round, so the screen can follow a symbol */
  id: number
  sym: Sym
  /** donut value, multiple of the bet */
  value?: number
}
/** grid[col][row], row 0 at the top */
export type Grid = Cell[][]

export interface WayWin {
  sym: PaySym
  /** reels it runs across, 3 to 5 */
  len: number
  ways: number
  /** multiple of the bet */
  pay: number
  /** every cell taking part, wilds included */
  ids: number[]
}

export interface Collect {
  /** the wild doing the eating */
  wild: number
  /** donut ids it eats, left to right */
  donuts: number[]
  /** multiple of the bet, after the multiplier */
  pay: number
}

export interface Spin {
  grid: Grid
  /** the wild that snuck in after the reels stopped: where, and the cell it replaced */
  sneak: { col: number; row: number; cell: Cell; replaced: Cell } | null
  ways: WayWin[]
  waysWin: number
  eggs: number
  eggPay: number
  collects: Collect[]
  /** collect multiplier in force for this spin (free spins) */
  mult: number
  /** wilds this spin adds to the meter (free spins) */
  wildsCounted: number
  /** level reached after this spin (free spins), and spins it adds */
  levelUp: number
  award: number
  /** total for the spin, multiple of the bet */
  win: number
}

export interface Round {
  base: Spin | null
  free: Spin[]
  total: number
  bought: boolean
  capped: boolean
}

function picker<T extends string>(w: Record<T, number>, skip: T[] = []) {
  const syms = (Object.keys(w) as T[]).filter((s) => w[s] > 0 && !skip.includes(s))
  const total = syms.reduce((a, s) => a + w[s], 0)
  return (rng: () => number): T => {
    let x = rng() * total
    for (const s of syms) {
      x -= w[s]
      if (x < 0) return s
    }
    return syms[syms.length - 1]
  }
}
const pick = {
  base: [picker<Sym>(BASE, ['wild']), picker<Sym>(BASE)],
  free: [picker<Sym>(FREE, ['wild']), picker<Sym>(FREE)],
}
function valuePicker(table: [number, number][]) {
  const total = table.reduce((a, [, w]) => a + w, 0)
  return (rng: () => number) => {
    let x = rng() * total
    for (const [v, w] of table) {
      x -= w
      if (x < 0) return v
    }
    return table[0][0]
  }
}
const donutValue = { base: valuePicker(BASE_DONUT_VALUES), free: valuePicker(DONUT_VALUES) }

const round2 = (n: number) => Math.round(n * 100) / 100

export interface Maker {
  next: number
  cell: (col: number) => Cell
}
export function maker(rng: () => number, free: boolean): Maker {
  const p = free ? pick.free : pick.base
  const value = free ? donutValue.free : donutValue.base
  const m: Maker = {
    next: 1,
    cell: (col) => {
      const sym = p[col === 0 ? 0 : 1](rng)
      return sym === 'donut' ? { id: m.next++, sym, value: value(rng) } : { id: m.next++, sym }
    },
  }
  return m
}

/** A random symbol for the blur of a spinning reel (never a wild on the first reel). */
export function fillerSym(rng: () => number, col: number, free: boolean): Sym {
  return (free ? pick.free : pick.base)[col === 0 ? 0 : 1](rng)
}

export function findWays(grid: Grid): WayWin[] {
  const wins: WayWin[] = []
  for (const sym of PAY_SYMS) {
    let ways = 1
    let len = 0
    const ids: number[] = []
    for (let c = 0; c < COLS; c++) {
      const hit = grid[c].filter((x) => x.sym === sym || x.sym === 'wild')
      if (!hit.length) break
      ways *= hit.length
      len++
      ids.push(...hit.map((x) => x.id))
    }
    if (len >= 3) {
      // a run made only of wilds after the first reel is still this symbol's win; reel 1 never has wilds
      wins.push({ sym, len, ways, pay: round2(PAYS[sym][len - 3] * ways), ids })
    }
  }
  return wins
}

export function cellsOf(grid: Grid, sym: Sym) {
  return grid.flatMap((col) => col.filter((x) => x.sym === sym))
}

function playSpin(rng: () => number, m: Maker, free: boolean, level: number): Spin {
  const grid: Grid = Array.from({ length: COLS }, (_, c) => Array.from({ length: ROWS }, () => m.cell(c)))
  let wilds = cellsOf(grid, 'wild')
  const donuts = cellsOf(grid, 'donut')
  let sneak: Spin['sneak'] = null
  if (donuts.length && !wilds.length && rng() < (free ? SNEAK_FREE : SNEAK_BASE)) {
    // a wild drops onto a reel from 2 to 5, on anything but a donut or an egg
    const spots: [number, number][] = []
    for (let c = 1; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (grid[c][r].sym !== 'donut' && grid[c][r].sym !== 'egg') spots.push([c, r])
    if (spots.length) {
      const [col, row] = spots[Math.floor(rng() * spots.length)]
      const cell: Cell = { id: m.next++, sym: 'wild' }
      sneak = { col, row, cell, replaced: grid[col][row] }
      grid[col][row] = cell
      wilds = cellsOf(grid, 'wild')
    }
  }
  const ways = findWays(grid)
  const waysWin = round2(ways.reduce((a, w) => a + w.pay, 0))
  const eggs = free ? 0 : cellsOf(grid, 'egg').length
  const eggPay = eggs >= EGGS_TO_TRIGGER ? EGG_PAYS[Math.min(eggs, 5) - 3] : 0
  const mult = free ? LEVEL_MULTS[level] : 1
  const donutSum = donuts.reduce((a, d) => a + (d.value ?? 0), 0)
  // wilds eat left to right, column by column
  const order = [...wilds].sort((a, b) => colOf(grid, a.id) - colOf(grid, b.id) || rowOf(grid, a.id) - rowOf(grid, b.id))
  const sortedDonuts = [...donuts].sort((a, b) => colOf(grid, a.id) - colOf(grid, b.id) || rowOf(grid, a.id) - rowOf(grid, b.id))
  const collects: Collect[] = donuts.length ? order.map((w) => ({ wild: w.id, donuts: sortedDonuts.map((d) => d.id), pay: round2(donutSum * mult) })) : []
  const collectWin = round2(collects.reduce((a, c) => a + c.pay, 0))
  const award = !free && eggs >= EGGS_TO_TRIGGER ? EGG_SPINS[Math.min(eggs, 5) - 3] : 0
  return {
    grid,
    sneak,
    ways,
    waysWin,
    eggs,
    eggPay,
    collects,
    mult,
    wildsCounted: free ? wilds.length : 0,
    levelUp: 0,
    award,
    win: round2(waysWin + eggPay + collectWin),
  }
}

function colOf(grid: Grid, id: number) {
  return grid.findIndex((col) => col.some((x) => x.id === id))
}
function rowOf(grid: Grid, id: number) {
  for (const col of grid) {
    const r = col.findIndex((x) => x.id === id)
    if (r >= 0) return r
  }
  return -1
}

/** One paid spin and any free spins it leads to; or, when `buy` is set, a bought feature. */
export function playRound(rng: () => number, buy = false): Round {
  let total = 0
  let capped = false
  let base: Spin | null = null
  let left = BUY_SPINS
  if (!buy) {
    base = playSpin(rng, maker(rng, false), false, 0)
    total = base.win
    left = base.award
    if (total >= MAX_WIN) {
      total = MAX_WIN
      capped = true
      left = 0
    }
  }
  const free: Spin[] = []
  const m = maker(rng, true)
  // ids stay unique across the whole round (the screen keys symbols by id)
  m.next = 100000
  let level = 0
  let wilds = 0
  while (left > 0) {
    const s = playSpin(rng, m, true, level)
    left--
    // the meter fills after this spin's collects; a new level applies from the next spin
    const before = Math.min(wilds, WILDS_PER_LEVEL * (LEVEL_MULTS.length - 1))
    wilds += s.wildsCounted
    const reached = Math.min(LEVEL_MULTS.length - 1, Math.floor(wilds / WILDS_PER_LEVEL))
    if (reached > level && before < WILDS_PER_LEVEL * (LEVEL_MULTS.length - 1)) {
      s.levelUp = reached - level
      left += LEVEL_SPINS * s.levelUp
      level = reached
    }
    free.push(s)
    total = round2(total + s.win)
    if (total >= MAX_WIN) {
      total = MAX_WIN
      capped = true
      break
    }
  }
  return { base, free, total, bought: buy, capped }
}
