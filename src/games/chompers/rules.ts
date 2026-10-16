/*
  Chompers maths: five reels of four rows, 1,024 ways. Three or more of a symbol on adjacent reels from the
  left win; each symbol pays its value times the number of ways (the product of how many it shows on each reel).
  Wild monsters land on reels 2 to 5, stand in for every paying symbol and, whenever donuts are showing,
  chomp them: each wild collects the value of every donut on the screen.

  Three, four or five eggs anywhere start 10, 15 or 20 free spins. In free spins donuts land far more often,
  every wild landed is counted, and each fourth wild adds ten spins and raises the collect multiplier to
  2×, 3× and finally 10×. Sometimes, when donuts land with no wild to eat them, a hungry wild sneaks in.

  Feast Pick: when free spins start, Big Mama offers three eggs. The modifier is drawn up front (the pick is only
  presentation; the other two eggs show what they would have been): hungry (the meter starts full at level 1, so
  collects pay 2× from the first spin), rain (donuts land 1.6× as often), crowd (wilds land 1.6× as often) or
  extra (+5 spins). The Super Feast buy (SUPER_PRICE) starts at level 1 and adds a second modifier drawn from
  rain, crowd and extra; the normal buy (BUY_PRICE) gets a normal Feast Pick. Hungry Mode (the ante) makes paid
  spins cost ANTE_COST× with eggs landing more often; buys are off while it is on.

  Everything is drawn up front: a round is the whole list of spins, which the screen then plays back without
  re-running any rules. Simulated return (tools/chompers-sim.ts, 95% confidence): paid spins 96.06 ± 0.04%,
  Hungry Mode 96.08 ± 0.04%, the 100× buy 96.07 ± 0.06%, the Super Feast buy 96.05 ± 0.07%.

  Exports added for the Feast / Super / Hungry Mode upgrade (everything older keeps its name and meaning):
    SUPER_PRICE, ANTE_COST, FEAST_MODS, SUPER_MODS, RAIN_MULT, CROWD_MULT, EXTRA_SPINS, HUNGRY_LEVEL,
    MAX_LEVEL, FREE_ID_BASE, SYMS, CONFIG / Config (PAYS, EGG_PAYS, DONUT_VALUES, BASE_DONUT_VALUES alias it),
    types Buy, FeastMod, SuperMod, Feast, PlayOpts,
    playRound(rng, opts) where opts is the old `buy` boolean or { buy: 'none' | 'fs' | 'super', ante, force },
    playFeature(rng, spins, opts) (simulator helper: the bought-feature code with any start), eggOdds(ante)
    (exact chance of 3 / 4 / 5+ eggs), levelOf(meter), feastWeights(mods), fillerSym(rng, col, free, mods?).
  New Round fields: kind, ante, cost, startSpins, feature, feast (null without free spins).
  New Spin fields: index, level, meter, left. For playback: the meter starts at feast.level × WILDS_PER_LEVEL
  (4 with hungry and on the Super buy, so the first spin already pays 2×) and the free spins start with
  startSpins + feast.spins; after each free spin, spin.meter / spin.level + spin.levelUp / spin.left are the HUD
  values, so nothing needs recounting. A capped round stops after the spin that reached MAX_WIN; that spin's
  `win` is its full win, round.total is MAX_WIN.
  rng call order (binding; tools/chompers-test.ts replays it):
    a spin = 20 cells column by column, top to bottom: one call for the symbol, and one more for a donut's value;
      then, only when donuts landed and no wild did, one call for the sneak chance and, if it sneaks and a spot
      exists, one call for the spot (reels 2-5, not a donut or egg, scanned column by column).
    a paid round = the paid spin, then, when it starts free spins, the Feast draw and the free spins.
    a buy = the Feast draw, then the free spins.
    the Feast draw = one call for the modifier (weighted; a forced modifier still uses up the call), then for a
      normal pick one call choosing the first of the three left (in FEAST_MODS order) and one choosing the
      second of the two left; for the Super buy the modifier comes from SUPER_MODS and one call orders the
      two left.
*/

export type PaySym = 'grumbo' | 'fang' | 'blip' | 'mimi' | 'cupcake' | 'lolly' | 'cookie' | 'gummy' | 'candy'
export type Sym = PaySym | 'wild' | 'egg' | 'donut'
export type Buy = 'none' | 'fs' | 'super'
export type FeastMod = 'hungry' | 'rain' | 'crowd' | 'extra'
export type SuperMod = Exclude<FeastMod, 'hungry'>

export const COLS = 5
export const ROWS = 4
const CELLS = COLS * ROWS

/** Highest paying first. */
export const PAY_SYMS: PaySym[] = ['grumbo', 'fang', 'blip', 'mimi', 'cupcake', 'lolly', 'cookie', 'gummy', 'candy']
/** draw order for weighted picks */
export const SYMS: readonly Sym[] = [...PAY_SYMS, 'wild', 'egg', 'donut']

/** Eggs anywhere: 3, 4 and 5 start this many free spins (and pay CONFIG.eggPays). */
export const EGG_SPINS: [number, number, number] = [10, 15, 20]
export const EGGS_TO_TRIGGER = 3
/** Every this many wilds in free spins adds spins and raises the multiplier. */
export const WILDS_PER_LEVEL = 4
export const LEVEL_SPINS = 10
export const LEVEL_MULTS = [1, 2, 3, 10]
export const MAX_LEVEL = LEVEL_MULTS.length - 1
/** Price of buying straight into 10 free spins, in multiples of the bet. */
export const BUY_PRICE = 100
/** Super Feast: 10 free spins from level 1 with a second Feast modifier. */
export const SUPER_PRICE = 175
export const BUY_SPINS = 10
/** Hungry Mode: paid spins cost this many bets. */
export const ANTE_COST = 1.25
/** No round pays more than this many times the bet. */
export const MAX_WIN = 10000
/** free-spin cell ids start here, so ids stay unique across a round */
export const FREE_ID_BASE = 100000

/** Feast Pick modifiers, in draw order. */
export const FEAST_MODS: readonly FeastMod[] = ['hungry', 'rain', 'crowd', 'extra']
/** the Super buy's second modifier comes from these */
export const SUPER_MODS: readonly SuperMod[] = ['rain', 'crowd', 'extra']
/** rain: donut weight × this for the whole feature */
export const RAIN_MULT = 1.6
/** crowd: wild weight × this for the whole feature */
export const CROWD_MULT = 1.6
/** extra: spins added */
export const EXTRA_SPINS = 5
/** hungry (and Super): the meter starts this many levels up */
export const HUNGRY_LEVEL = 1

export interface Config {
  /** pays for 3, 4 and 5 of a kind, per way, in multiples of the total bet */
  pays: Record<PaySym, readonly [number, number, number]>
  /** 3, 4 and 5+ eggs pay this many bets */
  eggPays: readonly [number, number, number]
  /** relative weights, paid spins (wilds never land on reel 1) */
  base: Record<Sym, number>
  /** paid spins in Hungry Mode */
  ante: Record<Sym, number>
  /** every free spin, before the Feast modifiers */
  free: Record<Sym, number>
  /** donut values (bets) and their relative weights */
  baseDonuts: readonly (readonly [number, number])[]
  freeDonuts: readonly (readonly [number, number])[]
  /** chance a wild sneaks in when donuts land without one */
  sneakBase: number
  sneakFree: number
  /** Feast Pick weights, natural features and the 100× buy */
  feast: Record<FeastMod, number>
  /** the Super buy's second modifier */
  superFeast: Record<SuperMod, number>
}

export const CONFIG: Config = {
  pays: {
    grumbo: [0.25, 1, 5],
    fang: [0.2, 0.8, 3],
    blip: [0.15, 0.6, 2],
    mimi: [0.12, 0.5, 1.5],
    cupcake: [0.08, 0.2, 1],
    lolly: [0.08, 0.2, 1],
    cookie: [0.04, 0.15, 0.5],
    gummy: [0.04, 0.15, 0.5],
    candy: [0.04, 0.15, 0.5],
  },
  eggPays: [2, 5, 20],
  base: { grumbo: 4, fang: 5, blip: 6, mimi: 7, cupcake: 10, lolly: 10, cookie: 12, gummy: 12, candy: 13, wild: 1.4, egg: 1.34, donut: 0.45 },
  ante: { grumbo: 4, fang: 5, blip: 6, mimi: 7, cupcake: 10, lolly: 10, cookie: 12, gummy: 12, candy: 13, wild: 1.4, egg: 1.575, donut: 0.45 },
  free: { grumbo: 4, fang: 5, blip: 6, mimi: 7, cupcake: 10, lolly: 10, cookie: 12, gummy: 12, candy: 13, wild: 0.85, egg: 0, donut: 12.3 },
  baseDonuts: [
    [1, 460],
    [2, 310],
    [3, 145],
    [5, 88],
    [10, 32],
    [20, 6.5],
    [50, 0.9],
  ],
  freeDonuts: [
    [2, 560],
    [5, 290],
    [10, 95],
    [15, 36],
    [20, 17],
    [25, 9],
    [50, 4],
    [100, 2.5],
    [250, 0.8],
  ],
  sneakBase: 0.12,
  sneakFree: 0.08,
  feast: { hungry: 28, rain: 32, crowd: 15, extra: 25 },
  superFeast: { rain: 38, crowd: 29, extra: 33 },
}
/** Pays for 3, 4 and 5 of a kind, per way, in multiples of the total bet. */
export const PAYS = CONFIG.pays
/** Eggs anywhere: 3, 4 and 5 pay this many times the bet. */
export const EGG_PAYS = CONFIG.eggPays
/** Donut values in multiples of the bet, and how often each lands (relative): smaller ones in the base game. */
export const DONUT_VALUES = CONFIG.freeDonuts
export const BASE_DONUT_VALUES = CONFIG.baseDonuts

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
  /** 0 = the paid spin, 1.. = free spins in play order */
  index: number
  grid: Grid
  /** the wild that snuck in after the reels stopped: where, and the cell it replaced */
  sneak: { col: number; row: number; cell: Cell; replaced: Cell } | null
  ways: WayWin[]
  waysWin: number
  eggs: number
  eggPay: number
  collects: Collect[]
  /** meter level in force for this spin (free spins; 0 on the paid spin); mult = LEVEL_MULTS[level] */
  level: number
  /** collect multiplier in force for this spin (free spins) */
  mult: number
  /** wilds this spin adds to the meter (free spins) */
  wildsCounted: number
  /** wilds on the meter after this spin, counting the start fill (WILDS_PER_LEVEL × feast.level); 0 on the paid spin */
  meter: number
  /** levels gained after this spin (free spins); each adds LEVEL_SPINS spins from the next spin on */
  levelUp: number
  /** free spins still to play after this one, its level-up spins included (0 on the paid spin) */
  left: number
  /** free spins this paid spin starts, before the Feast Pick (0 on free spins) */
  award: number
  /** total for the spin, multiple of the bet (before the cap) */
  win: number
}

export interface Feast {
  /** what the picked egg hatches */
  pick: FeastMod
  /** what the other two eggs would have hatched (presentation only): distinct from pick and each other */
  others: [FeastMod, FeastMod]
  /** every modifier in force for the feature: [pick], or ['hungry', pick] on the Super buy */
  mods: FeastMod[]
  /** a Super Feast buy (pick and others are then rain / crowd / extra) */
  super: boolean
  /** spins the Feast adds to the start (EXTRA_SPINS with extra, else 0) */
  spins: number
  /** meter level the feature starts at (HUNGRY_LEVEL with hungry or Super, else 0) */
  level: number
}

export interface Round {
  kind: Buy
  /** Hungry Mode; always false for buys */
  ante: boolean
  /** in bets: 1, ANTE_COST, BUY_PRICE or SUPER_PRICE */
  cost: number
  /** null for buys */
  base: Spin | null
  free: Spin[]
  /** free spins before the Feast Pick: base.award, BUY_SPINS for a buy, 0 without free spins */
  startSpins: number
  /** a natural trigger (base.award > 0 and not capped) */
  feature: boolean
  /** the Feast Pick, whenever free spins are played */
  feast: Feast | null
  /** multiple of the bet, ≤ MAX_WIN */
  total: number
  /** kind !== 'none' */
  bought: boolean
  capped: boolean
}

export interface PlayOpts {
  buy: Buy
  /** Hungry Mode (paid spins only) */
  ante: boolean
  /** dev and simulator only: the Feast Pick hatches this (for Super, the second modifier; 'hungry' is ignored there) */
  force?: FeastMod
}

// ---------------------------------------------------------------------------------------------------------------
// Tables, built once per Config object (so a config must not be changed after it has been played)

const WILD = SYMS.indexOf('wild')
const EGG = SYMS.indexOf('egg')
const DONUT = SYMS.indexOf('donut')
const NSYM = SYMS.length
const NPAY = PAY_SYMS.length

interface Weights {
  w: Float64Array
  total: number
  /** the last symbol with a weight, which also catches rounding at the top end */
  last: number
}
interface Values {
  v: Float64Array
  w: Float64Array
  total: number
}
interface Tables {
  /** [reel 1 (no wilds), reels 2-5] */
  base: [Weights, Weights]
  ante: [Weights, Weights]
  /** by rain + 2 × crowd */
  free: [Weights, Weights][]
  baseDonuts: Values
  freeDonuts: Values
  /** pays[code * 3 + len - 3] */
  pays: Float64Array
}

function weightsOf(r: Record<Sym, number>, noWild: boolean): Weights {
  const w = Float64Array.from(SYMS, (s, i) => (noWild && i === WILD ? 0 : Math.max(0, r[s])))
  return { w, total: w.reduce((a, v) => a + v, 0), last: w.reduce((l, v, i) => (v > 0 ? i : l), 0) }
}
const pair = (r: Record<Sym, number>): [Weights, Weights] => [weightsOf(r, true), weightsOf(r, false)]
function valuesOf(t: readonly (readonly [number, number])[]): Values {
  const v = Float64Array.from(t, (x) => x[0])
  const w = Float64Array.from(t, (x) => x[1])
  return { v, w, total: w.reduce((a, x) => a + x, 0) }
}

const tableCache = new WeakMap<Config, Tables>()
function tablesOf(cfg: Config): Tables {
  let t = tableCache.get(cfg)
  if (!t) {
    const free: [Weights, Weights][] = []
    for (let k = 0; k < 4; k++) free.push(pair(feastWeights([...(k & 1 ? (['rain'] as const) : []), ...(k & 2 ? (['crowd'] as const) : [])], cfg.free)))
    const pays = new Float64Array(NPAY * 3)
    PAY_SYMS.forEach((s, i) => cfg.pays[s].forEach((v, j) => (pays[i * 3 + j] = v)))
    t = { base: pair(cfg.base), ante: pair(cfg.ante), free, baseDonuts: valuesOf(cfg.baseDonuts), freeDonuts: valuesOf(cfg.freeDonuts), pays }
    tableCache.set(cfg, t)
  }
  return t
}

/** The free-spin weights with Feast modifiers applied (rain: donuts × RAIN_MULT, crowd: wilds × CROWD_MULT). */
export function feastWeights(mods: readonly FeastMod[], free: Record<Sym, number> = CONFIG.free): Record<Sym, number> {
  const w = { ...free }
  if (mods.includes('rain')) w.donut *= RAIN_MULT
  if (mods.includes('crowd')) w.wild *= CROWD_MULT
  return w
}

/** One weighted draw: a single rng() call, walking SYMS and subtracting weights. */
function drawSym(rng: () => number, t: Weights): number {
  let x = rng() * t.total
  for (let s = 0; s < t.last; s++) {
    x -= t.w[s]
    if (x < 0) return s
  }
  return t.last
}
function drawValue(rng: () => number, t: Values): number {
  let x = rng() * t.total
  const n = t.v.length - 1
  for (let i = 0; i < n; i++) {
    x -= t.w[i]
    if (x < 0) return t.v[i]
  }
  return t.v[n]
}

/** A random symbol for the blur of a spinning reel (never a wild on the first reel). */
export function fillerSym(rng: () => number, col: number, free: boolean, mods: readonly FeastMod[] = []): Sym {
  const t = tablesOf(CONFIG)
  const w = free ? t.free[(mods.includes('rain') ? 1 : 0) + (mods.includes('crowd') ? 2 : 0)] : t.base
  return SYMS[drawSym(rng, w[col === 0 ? 0 : 1])]
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** meter level for this many wilds on the meter */
export const levelOf = (meter: number) => Math.min(MAX_LEVEL, Math.floor(meter / WILDS_PER_LEVEL))

/** Exact chance that a paid spin lands 3, 4 and 5+ eggs (each starts EGG_SPINS free spins); eggs are never replaced. */
export function eggOdds(ante = false, cfg: Config = CONFIG): [number, number, number] {
  const t = tablesOf(cfg)
  const [w1, w] = ante ? t.ante : t.base
  const q1 = w1.w[EGG] / w1.total
  const q = w.w[EGG] / w.total
  // distribution of the egg count, capped at 5
  let dist = [1, 0, 0, 0, 0, 0]
  for (let i = 0; i < CELLS; i++) {
    const p = i < ROWS ? q1 : q
    const next = [0, 0, 0, 0, 0, 0]
    dist.forEach((v, k) => {
      next[k] += v * (1 - p)
      next[Math.min(5, k + 1)] += v * p
    })
    dist = next
  }
  return [dist[3], dist[4], dist[5]]
}

export function findWays(grid: Grid, cfg: Config = CONFIG): WayWin[] {
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
      wins.push({ sym, len, ways, pay: round2(cfg.pays[sym][len - 3] * ways), ids })
    }
  }
  return wins
}

export function cellsOf(grid: Grid, sym: Sym) {
  return grid.flatMap((col) => col.filter((x) => x.sym === sym))
}

// ---------------------------------------------------------------------------------------------------------------
// Playing. Rounds are synchronous, so one set of working arrays (indexed col * ROWS + row) serves them all.

const wSym = new Int8Array(CELLS)
const wCell: Cell[] = new Array<Cell>(CELLS)
const counts = new Int8Array(COLS * NSYM)

interface Ctx {
  rng: () => number
  cfg: Config
  t: Tables
  /** next cell id */
  next: number
  total: number
  maxWin: number
  capped: boolean
}

/** One spin: the reels land, maybe a wild sneaks in, then ways, eggs and collects are paid. */
function playSpin(ctx: Ctx, weights: [Weights, Weights], donuts: Values, pSneak: number, free: boolean, level: number, index: number): Spin {
  const { rng, t } = ctx
  counts.fill(0)
  let nDonut = 0
  let nWild = 0
  let nEgg = 0
  let donutSum = 0
  for (let p = 0; p < CELLS; p++) {
    const c = (p / ROWS) | 0
    const s = drawSym(rng, weights[c === 0 ? 0 : 1])
    wSym[p] = s
    counts[c * NSYM + s]++
    if (s === DONUT) {
      const value = drawValue(rng, donuts)
      wCell[p] = { id: ctx.next++, sym: 'donut', value }
      nDonut++
      donutSum += value
    } else {
      wCell[p] = { id: ctx.next++, sym: SYMS[s] }
      if (s === WILD) nWild++
      else if (s === EGG) nEgg++
    }
  }

  let sneak: Spin['sneak'] = null
  if (nDonut && !nWild && rng() < pSneak) {
    // a wild drops onto a reel from 2 to 5, on anything but a donut or an egg
    let spots = 0
    for (let p = ROWS; p < CELLS; p++) if (wSym[p] !== DONUT && wSym[p] !== EGG) spots++
    if (spots) {
      let k = Math.floor(rng() * spots)
      let p = ROWS
      for (; p < CELLS; p++) if (wSym[p] !== DONUT && wSym[p] !== EGG && k-- === 0) break
      const col = (p / ROWS) | 0
      const cell: Cell = { id: ctx.next++, sym: 'wild' }
      sneak = { col, row: p % ROWS, cell, replaced: wCell[p] }
      counts[col * NSYM + wSym[p]]--
      counts[col * NSYM + WILD]++
      wSym[p] = WILD
      wCell[p] = cell
      nWild = 1
    }
  }

  // ways: each paying symbol (with wilds) on adjacent reels from the left
  const ways: WayWin[] = []
  let waysWin = 0
  for (let s = 0; s < NPAY; s++) {
    let n = 1
    let len = 0
    for (let c = 0; c < COLS; c++) {
      const h = counts[c * NSYM + s] + counts[c * NSYM + WILD]
      if (!h) break
      n *= h
      len++
    }
    if (len < 3) continue
    const ids: number[] = []
    for (let p = 0; p < len * ROWS; p++) if (wSym[p] === s || wSym[p] === WILD) ids.push(wCell[p].id)
    const pay = round2(t.pays[s * 3 + len - 3] * n)
    ways.push({ sym: PAY_SYMS[s], len, ways: n, pay, ids })
    waysWin += pay
  }
  waysWin = round2(waysWin)

  const eggs = free ? 0 : nEgg
  const eggPay = eggs >= EGGS_TO_TRIGGER ? ctx.cfg.eggPays[Math.min(eggs, 5) - 3] : 0
  const mult = free ? LEVEL_MULTS[level] : 1

  // every wild eats every donut; wilds eat left to right, column by column
  const collects: Collect[] = []
  let collectWin = 0
  if (nDonut && nWild) {
    const ids: number[] = []
    for (let p = 0; p < CELLS; p++) if (wSym[p] === DONUT) ids.push(wCell[p].id)
    const pay = round2(donutSum * mult)
    for (let p = ROWS; p < CELLS; p++)
      if (wSym[p] === WILD) {
        collects.push({ wild: wCell[p].id, donuts: ids.slice(), pay })
        collectWin += pay
      }
    collectWin = round2(collectWin)
  }

  const grid: Grid = []
  for (let c = 0; c < COLS; c++) grid.push(wCell.slice(c * ROWS, (c + 1) * ROWS))
  const win = round2(waysWin + eggPay + collectWin)
  return {
    index,
    grid,
    sneak,
    ways,
    waysWin,
    eggs,
    eggPay,
    collects,
    level: free ? level : 0,
    mult,
    wildsCounted: free ? nWild : 0,
    meter: 0,
    levelUp: 0,
    left: 0,
    award: !free && eggs >= EGGS_TO_TRIGGER ? EGG_SPINS[Math.min(eggs, 5) - 3] : 0,
    win,
  }
}
/** The Feast Pick: one modifier drawn by weight, then the other two eggs (see the rng order at the top). */
function drawFeast(rng: () => number, cfg: Config, sup: boolean, force?: FeastMod): Feast {
  const pool: FeastMod[] = sup ? [...SUPER_MODS] : [...FEAST_MODS]
  const weights = pool.map((m) => (sup ? cfg.superFeast[m as SuperMod] : cfg.feast[m]))
  const total = weights.reduce((a, w) => a + w, 0)
  let x = rng() * total
  let i = 0
  while (i < pool.length - 1 && (x -= weights[i]) >= 0) i++
  if (force && pool.includes(force)) i = pool.indexOf(force)
  const pick = pool[i]
  const rest = pool.filter((m) => m !== pick)
  let others: [FeastMod, FeastMod]
  if (sup) {
    const j = Math.floor(rng() * 2)
    others = [rest[j], rest[1 - j]]
  } else {
    const a = rest.splice(Math.floor(rng() * 3), 1)[0]
    const b = rest[Math.floor(rng() * 2)]
    others = [a, b]
  }
  const mods: FeastMod[] = sup ? ['hungry', pick] : [pick]
  return {
    pick,
    others,
    mods,
    super: sup,
    spins: mods.includes('extra') ? EXTRA_SPINS : 0,
    level: mods.includes('hungry') ? HUNGRY_LEVEL : 0,
  }
}

/** The free spins: `spins` to start with, plus the Feast's; the meter carries from spin to spin. */
function playFree(ctx: Ctx, spins: number, feast: Feast): Spin[] {
  const { t, cfg } = ctx
  const weights = t.free[(feast.mods.includes('rain') ? 1 : 0) + (feast.mods.includes('crowd') ? 2 : 0)]
  ctx.next = FREE_ID_BASE
  let level = feast.level
  let meter = level * WILDS_PER_LEVEL
  let left = spins + feast.spins
  const free: Spin[] = []
  while (left > 0 && !ctx.capped) {
    const s = playSpin(ctx, weights, t.freeDonuts, cfg.sneakFree, true, level, free.length + 1)
    left--
    // the meter fills after this spin's collects; a new level applies from the next spin
    meter += s.wildsCounted
    const reached = levelOf(meter)
    if (reached > level) {
      s.levelUp = reached - level
      left += LEVEL_SPINS * s.levelUp
      level = reached
    }
    s.meter = meter
    s.left = left
    free.push(s)
    ctx.total = round2(ctx.total + s.win)
    if (ctx.total >= ctx.maxWin) {
      ctx.total = ctx.maxWin
      ctx.capped = true
    }
  }
  return free
}

function context(rng: () => number, cfg: Config, maxWin: number): Ctx {
  return { rng, cfg, t: tablesOf(cfg), next: 1, total: 0, maxWin, capped: false }
}

function optsOf(o: boolean | Partial<PlayOpts>): PlayOpts {
  if (typeof o === 'boolean') return { buy: o ? 'fs' : 'none', ante: false }
  return { buy: o.buy ?? 'none', ante: !!o.ante && (o.buy ?? 'none') === 'none', force: o.force }
}

/** One paid spin and any free spins it leads to; or, with a buy, a bought feature. `opts` may be the old `buy` flag. */
export function playRound(rng: () => number, opts: boolean | Partial<PlayOpts> = false, cfg: Config = CONFIG): Round {
  const o = optsOf(opts)
  const ctx = context(rng, cfg, MAX_WIN)
  if (o.buy !== 'none') {
    const sup = o.buy === 'super'
    const feast = drawFeast(rng, cfg, sup, o.force)
    const free = playFree(ctx, BUY_SPINS, feast)
    return { kind: o.buy, ante: false, cost: sup ? SUPER_PRICE : BUY_PRICE, base: null, free, startSpins: BUY_SPINS, feature: false, feast, total: ctx.total, bought: true, capped: ctx.capped }
  }
  const t = ctx.t
  const base = playSpin(ctx, o.ante ? t.ante : t.base, t.baseDonuts, cfg.sneakBase, false, 0, 0)
  ctx.total = base.win
  if (ctx.total >= ctx.maxWin) {
    ctx.total = ctx.maxWin
    ctx.capped = true
  }
  const feature = base.award > 0 && !ctx.capped
  const feast = feature ? drawFeast(rng, cfg, false, o.force) : null
  const free = feast ? playFree(ctx, base.award, feast) : []
  return {
    kind: 'none',
    ante: o.ante,
    cost: o.ante ? ANTE_COST : 1,
    base,
    free,
    startSpins: feature ? base.award : 0,
    feature,
    feast,
    total: ctx.total,
    bought: false,
    capped: ctx.capped,
  }
}

/** Simulator helper: a feature of `spins` start spins, played by the same code as a buy (cost 0). A higher `maxWin`
 *  measures what the cap takes; `force` fixes the Feast Pick. */
export function playFeature(rng: () => number, spins: number, opts: { super?: boolean; force?: FeastMod; maxWin?: number } = {}, cfg: Config = CONFIG): Round {
  const sup = !!opts.super
  const ctx = context(rng, cfg, opts.maxWin ?? MAX_WIN)
  const feast = drawFeast(rng, cfg, sup, opts.force)
  const free = playFree(ctx, spins, feast)
  return { kind: sup ? 'super' : 'fs', ante: false, cost: 0, base: null, free, startSpins: spins, feature: false, feast, total: ctx.total, bought: true, capped: ctx.capped }
}
