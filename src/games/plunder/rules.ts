/*
  Plunder Bay maths. Megaways: six reels, each lands 2 to 7 symbols on every spin, so the ways to win are the product
  of the six heights (up to 117,649). Three or more of a symbol on adjacent reels from the left win, paid per way:
  ways = (that symbol on reel 1) × the product, over each following reel the run reaches, of (that symbol + flags on
  the reel); the run goes on while every reel has at least one. The Jolly Roger flag is wild on reels 2 to 6 and
  stands in for every paying symbol at once, so one flag can take part in several wins. It never lands on reel 1
  (and would not count there), so every way starts with a real symbol. Treasure maps never win ways.

  Cascades: every cell taking part in a win, flags included, blasts away (all of the step's wins together), the
  cells above fall down their reel and new ones drop in from the top, until nothing wins. The reel heights stay put
  for the spin. Maps never blast, so the maps of the first board stay and the drops may add more.

  Treasure maps are counted on a spin's final board (after its cascades). On a paid spin 4, 5 or 6+ maps pay
  scatterPays and start spins[0], [1] or [2] free spins (Treasure Hunt). In free spins 3, 4 or 5+ maps add
  retrigger[0], [1] or [2] spins, up to MAX_FREE_SPINS in the feature. Free spins have their own symbol and height
  weights. The win multiplier starts at ×1 when the feature starts and never resets: each cascade step that wins is
  paid at the multiplier as it stands (Step.mult, all of that step's wins), then the multiplier rises by one before
  the blast. In the base game it is always ×1. The buy (BUY_PRICE × the bet) starts the feature as four maps would:
  spins[0] free spins, with no paid spin and no scatter pay.

  Max win: the round's running total (cascade steps and scatter pays, in play order) stops at MAX_WIN. The step (or
  scatter pay) that reaches it is the last thing in the round and no further spin is played. A capping step keeps
  its wins, nothing blasts (no drops), the multiplier does not rise and the spin counts no maps (maps 0, award 0); a
  capping scatter pay keeps its maps but starts nothing (award 0). The round pays exactly MAX_WIN. MAX_STEPS bounds
  a spin's cascades (a safety net the maths never meets).

  Everything is drawn up front: a round is the paid spin (none for a buy) and every free spin, step by step, which
  the screen plays back.

  Random draws, in this exact order. Every draw is one rng() call; a weighted pick walks its table in the order
  written (heights 2 to 7; symbols PAY_SYMS, then flag, then map), subtracting each weight from rng() × the table's
  total and stopping where it goes below zero (the last entry with a weight catches rounding).
  Each spin (the paid spin, then the free spins in play order):
    1. Heights: reel 1 to 6, one pick each from heights.base (heights.free in free spins).
    2. The board: reel 1 to 6, each top to bottom, one pick per cell from `base` (`free`); on reel 1 the flag's
       weight counts as 0.
    3. After each step that wins and does not reach the cap: reel 1 to 6, that reel's new cells top first (as many
       as blasted on it), one pick each from the same table, again with no flag on reel 1. The cells left on a reel
       keep their order below the new ones.
  Nothing else draws: the ways, pays, maps, awards and the multiplier all follow from the boards.

  Ids: the paid spin's cells count up from 1 in the order they are drawn, the free spins' cells count up from
  FREE_ID_BASE through the whole feature, so every id is unique in a round.

  Simulated return 96.05% for paid spins and 96.10% for the buy, each ±0.06 at 95% confidence (tools/plunder-sim.ts;
  tests in tools/plunder-test.ts).
*/

export type PaySym = 'captain' | 'shark' | 'monkey' | 'crab' | 'anchor' | 'compass' | 'spyglass' | 'bottle'
export type Sym = PaySym | 'flag' | 'map'
export type Buy = 'none' | 'fs'

export const REELS = 6
export const MIN_ROWS = 2
export const MAX_ROWS = 7
/** Highest paying first. */
export const PAY_SYMS: readonly PaySym[] = ['captain', 'shark', 'monkey', 'crab', 'anchor', 'compass', 'spyglass', 'bottle']
/** treasure maps needed to start free spins, anywhere on the reels */
export const SCATTER_MIN = 4
export const BUY_PRICE = 100
export const MAX_WIN = 20000
export const FREE_ID_BASE = 100000
/** treasure maps needed in free spins to add spins */
export const RETRIGGER_MIN = 3
/** most free spins one feature can hold (retriggers stop adding at this) */
export const MAX_FREE_SPINS = 100
/** most steps in one spin (a safety net: the last one is treated as the final board) */
export const MAX_STEPS = 100
/** heights 2 to 7 */
export const HEIGHTS: readonly number[] = [2, 3, 4, 5, 6, 7]
/** symbols in table order (the order a weighted pick walks) */
export const SYMS: readonly Sym[] = [...PAY_SYMS, 'flag', 'map']

export interface Config {
  /** pays for 3, 4, 5 and 6 reels, per way, in multiples of the total bet */
  pays: Record<PaySym, readonly [number, number, number, number]>
  /** relative symbol weights per spin type; the wild flag never lands on reel 1 */
  base: Record<Sym, number>
  free: Record<Sym, number>
  /** relative weights for a reel landing 2, 3, 4, 5, 6 or 7 symbols (base game, free spins) */
  heights: { base: readonly number[]; free: readonly number[] }
  /** maps: free spins awarded for 4, 5 and 6+ maps (paid spins) */
  spins: readonly [number, number, number]
  /** maps in free spins: spins added for 3, 4 and 5+ */
  retrigger: readonly [number, number, number]
  /** maps on a paid spin pay this many times the bet for 4, 5 and 6+ */
  scatterPays: readonly [number, number, number]
}

/** Tuned with tools/plunder-sim.ts (the figures are in README.md, Game math).
 *  - Base reels: the four low symbols make up most of the reels and most of the base wins; the crew is rarer.
 *    Short reels (3.2 symbols a reel on average, about 1,270 ways) keep the hit rate near 34%. The maps start
 *    Treasure Hunt about 1 in 250 paid spins.
 *  - Free-spin reels turn that around: the crew is the commonest, so most free-spin wins are character wins, and
 *    the reels stand a little taller. About 36% of free spins win, which puts the multiplier at ×7.7 on average at
 *    the end of a 12-spin hunt and at ×10 or more in about a quarter of them.
 *  - Every return is linear in the pays (the boards never depend on them), so the pays were solved from the
 *    measured ways per symbol and length: the crew's pays set the hunt's value (the buy), the low symbols' pays the
 *    base game's, and the map weight the share between them. */
export const CONFIG: Config = {
  pays: {
    captain: [0.6, 1.5, 3.5, 8],
    shark: [0.45, 1.1, 2.5, 6],
    monkey: [0.4, 0.85, 2, 4.5],
    crab: [0.3, 0.7, 1.6, 3.5],
    anchor: [0.16, 0.25, 0.5, 1],
    compass: [0.16, 0.25, 0.5, 1],
    spyglass: [0.14, 0.2, 0.4, 0.8],
    bottle: [0.14, 0.2, 0.4, 0.8],
  },
  base: { captain: 5, shark: 6, monkey: 7, crab: 8, anchor: 11, compass: 11, spyglass: 12, bottle: 12, flag: 0.8, map: 2.09 },
  free: { captain: 10, shark: 10, monkey: 11, crab: 11, anchor: 7, compass: 7, spyglass: 8, bottle: 8, flag: 0.69, map: 0.9 },
  heights: { base: [38, 26, 17, 10, 6, 3], free: [32, 26, 19, 12, 7, 4] },
  spins: [12, 17, 22],
  retrigger: [5, 8, 12],
  scatterPays: [2, 5, 20],
}
export const PAYS: Config['pays'] = CONFIG.pays

export interface Cell {
  /** unique within a round */
  id: number
  sym: Sym
}
/** reels[r][row], row 0 at the top; reels[r].length is that reel's height for the spin */
export type Board = Cell[][]

export interface WayWin {
  sym: PaySym
  /** reels it runs across, 3 to 6 */
  len: number
  ways: number
  /** multiple of the bet, before the free-spins multiplier */
  base: number
  /** every cell taking part, wilds included */
  ids: number[]
}

/** One evaluation of the board. The last step of a spin has no wins: its board is the final board. */
export interface Step {
  /** the board before this step's wins blast away */
  board: Board
  wins: WayWin[]
  /** free-spins multiplier applied to this step's wins (1 in the base game) */
  mult: number
  /** round2(Σ win.base × mult) */
  win: number
  /** the cells that drop in to refill after the blast, per reel, top first (empty on the last step) */
  drops: Cell[][]
}

export interface Spin {
  free: boolean
  /** 0 = the paid spin, 1.. = free spins in play order */
  index: number
  /** the six reel heights for this spin */
  heights: number[]
  steps: Step[]
  /** maps on the final board */
  maps: number
  mapIds: number[]
  /** paid spins only */
  scatterPay: number
  /** free spins this spin awards (start spins on a paid spin, retrigger spins on a free spin) */
  award: number
  /** free-spins multiplier after this spin */
  multEnd: number
  /** what this spin adds to the round total, after the cap */
  win: number
  capped: boolean
}

export interface Round {
  kind: Buy
  /** in bets: 1 or BUY_PRICE */
  cost: number
  base: Spin | null
  free: Spin[]
  startSpins: number
  feature: boolean
  /** multiple of the bet, ≤ MAX_WIN */
  total: number
  capped: boolean
  /** highest free-spins multiplier reached (1 without a feature) */
  maxMult: number
}

export interface PlayOpts {
  buy: Buy
}

// Field notes the types above leave open (all decided here, see the header):
// - Step: when the round caps, the capping step is the spin's last step; it has wins and empty drops.
// - Spin.maps / mapIds: 0 / [] when the round capped during that spin's cascades. award is 0 once capped.
// - Spin.award on a free spin is what was actually added (MAX_FREE_SPINS may cut it short).
// - Round.feature: a natural trigger (base.award > 0), as in Pop Party; a buy has free spins and feature false.
// - Round.startSpins: base.award, or spins[0] for a buy. Round.maxMult: the last free spin's multEnd.

// ---------------------------------------------------------------------------------------------------------------
// Tables

// Internally a board is symbol codes by slot: slot = reel * MAX_ROWS + row; codes are the index in SYMS.
const FLAG = 8
const MAP = 9
const CODES = 10
const NPAY = 8
const SLOTS = REELS * MAX_ROWS

const round2 = (n: number) => Math.round(n * 100) / 100

interface Weights {
  w: Float64Array
  total: number
  /** the last entry with a weight, which also catches rounding at the top end */
  last: number
}
interface Tables {
  /** [base, free] × [reel 1 (no flag), reels 2-6] */
  sym: readonly [readonly [Weights, Weights], readonly [Weights, Weights]]
  /** [base, free] */
  heights: readonly [Weights, Weights]
  /** pays[code * 4 + len - 3] */
  pays: Float64Array
}

function weights(w: Float64Array): Weights {
  return { w, total: w.reduce((a, v) => a + v, 0), last: w.reduce((l, v, i) => (v > 0 ? i : l), 0) }
}
function symWeights(r: Record<Sym, number>, first: boolean, maps = true): Weights {
  return weights(Float64Array.from(SYMS, (s) => (s === 'flag' && first ? 0 : s === 'map' && !maps ? 0 : r[s])))
}

// built once per Config object, so a config must not be changed after it has been played
const tableCache = new WeakMap<Config, Tables>()
function tablesOf(cfg: Config): Tables {
  let t = tableCache.get(cfg)
  if (!t) {
    const pays = new Float64Array(NPAY * 4)
    PAY_SYMS.forEach((s, i) => cfg.pays[s].forEach((v, k) => (pays[i * 4 + k] = v)))
    if (cfg.heights.base.length !== HEIGHTS.length || cfg.heights.free.length !== HEIGHTS.length) throw new Error('Plunder Bay: six height weights per table')
    t = {
      sym: [
        [symWeights(cfg.base, true), symWeights(cfg.base, false)],
        [symWeights(cfg.free, true), symWeights(cfg.free, false)],
      ],
      heights: [weights(Float64Array.from(cfg.heights.base)), weights(Float64Array.from(cfg.heights.free))],
      pays,
    }
    tableCache.set(cfg, t)
  }
  return t
}

/** One weighted draw: a single rng() call, walking the table and subtracting weights. */
function pick(rng: () => number, t: Weights): number {
  let x = rng() * t.total
  for (let i = 0; i < t.last; i++) {
    x -= t.w[i]
    if (x < 0) return i
  }
  return t.last
}

// ---------------------------------------------------------------------------------------------------------------
// The working board. Rounds are synchronous, so one working copy serves them all.

const work = new Int8Array(SLOTS)
const workCells: Cell[] = new Array<Cell>(SLOTS)
const hts = new Int8Array(REELS)
const counts = new Int16Array(REELS * CODES)
const blasted = new Uint8Array(SLOTS)

function snapshot(): Board {
  const b: Board = []
  for (let r = 0; r < REELS; r++) b.push(workCells.slice(r * MAX_ROWS, r * MAX_ROWS + hts[r]))
  return b
}

/** Ways wins on the board in work/workCells/hts, highest paying symbol first. With `mark`, every winning cell's
 *  slot is set in `blasted` (which the caller has cleared). A flag on reel 1 never substitutes. */
function scanWays(pays: Float64Array, mark: boolean): WayWin[] {
  counts.fill(0)
  for (let r = 0; r < REELS; r++) for (let p = r * MAX_ROWS, e = p + hts[r]; p < e; p++) counts[r * CODES + work[p]]++
  let out: WayWin[] | null = null
  for (let s = 0; s < NPAY; s++) {
    let ways = counts[s]
    if (!ways) continue
    let len = 1
    while (len < REELS) {
      const m = counts[len * CODES + s] + counts[len * CODES + FLAG]
      if (!m) break
      ways *= m
      len++
    }
    if (len < 3) continue
    const ids: number[] = []
    for (let r = 0; r < len; r++)
      for (let p = r * MAX_ROWS, e = p + hts[r]; p < e; p++)
        if (work[p] === s || (r > 0 && work[p] === FLAG)) {
          ids.push(workCells[p].id)
          if (mark) blasted[p] = 1
        }
    ;(out ??= []).push({ sym: PAY_SYMS[s], len, ways, base: round2(pays[s * 4 + len - 3] * ways), ids })
  }
  return out ?? NO_WINS
}
const NO_WINS: WayWin[] = []

function codeOf(s: Sym): number {
  const c = SYMS.indexOf(s)
  if (c < 0) throw new Error(`Plunder Bay: unknown symbol ${s}`)
  return c
}
function loadBoard(board: Board) {
  if (board.length !== REELS) throw new Error('Plunder Bay: a board has six reels')
  board.forEach((reel, r) => {
    if (reel.length > MAX_ROWS) throw new Error('Plunder Bay: at most seven symbols a reel')
    hts[r] = reel.length
    reel.forEach((c, row) => {
      work[r * MAX_ROWS + row] = codeOf(c.sym)
      workCells[r * MAX_ROWS + row] = c
    })
  })
}

/** ways wins on a board (the flag wild on reels 2-6 stands in for every paying symbol) */
export function findWays(board: Board, cfg: Config = CONFIG): WayWin[] {
  loadBoard(board)
  const w = scanWays(tablesOf(cfg).pays, false)
  return w === NO_WINS ? [] : w
}

/** treasure maps on a board */
export const countMaps = (board: Board) => board.reduce((n, reel) => n + reel.reduce((m, c) => m + (c.sym === 'map' ? 1 : 0), 0), 0)

/** first reel that should hold back because `need - 1` maps already show on the reels to its left; -1 if none
 *  (need = SCATTER_MIN on a paid spin, RETRIGGER_MIN in free spins) */
export function teaseReel(board: Board, need: number = SCATTER_MIN): number {
  let shown = 0
  for (let r = 0; r < REELS; r++) {
    if (shown >= need - 1) return r
    for (const c of board[r]) if (c.sym === 'map') shown++
  }
  return -1
}

let fillerTables: Weights[] | null = null
/** a random symbol for the blur of a falling reel (never a flag on reel 1): one rng() call over the shipped base
 *  (or free-spin) weights of the paying symbols and the flag; never a map */
export function fillerSym(rng: () => number, reel: number, free: boolean): Sym {
  fillerTables ??= [symWeights(CONFIG.base, true, false), symWeights(CONFIG.base, false, false), symWeights(CONFIG.free, true, false), symWeights(CONFIG.free, false, false)]
  return SYMS[pick(rng, fillerTables[(free ? 2 : 0) + (reel === 0 ? 0 : 1)])]
}

/** a calm opening board: no win and fewer than 3 maps (up to 200 tries on the base heights and reels; ids from 1) */
export function calmBoard(rng: () => number, cfg: Config = CONFIG): Board {
  const t = tablesOf(cfg)
  for (let tries = 0; tries < 200; tries++) {
    const ctx = context(rng, cfg, MAX_WIN)
    drawSpinBoard(ctx, t, 0)
    let maps = 0
    for (let r = 0; r < REELS; r++) for (let p = r * MAX_ROWS, e = p + hts[r]; p < e; p++) if (work[p] === MAP) maps++
    if (maps < 3 && scanWays(t.pays, false) === NO_WINS) break
  }
  return snapshot()
}

/** the cells of a board by id, with where they sit */
export function cellsById(board: Board): Map<number, { reel: number; row: number; cell: Cell }> {
  const m = new Map<number, { reel: number; row: number; cell: Cell }>()
  board.forEach((reel, r) => reel.forEach((cell, row) => m.set(cell.id, { reel: r, row, cell })))
  return m
}

/** the cells left on each reel after `wins` blast away, top to bottom (what falls) */
export function survivors(board: Board, wins: readonly WayWin[]): Cell[][] {
  const gone = new Set<number>()
  for (const w of wins) for (const id of w.ids) gone.add(id)
  return board.map((reel) => reel.filter((c) => !gone.has(c.id)))
}

export const waysOf = (heights: readonly number[]) => heights.reduce((a, h) => a * h, 1)

// ---------------------------------------------------------------------------------------------------------------
// The round

interface Ctx {
  rng: () => number
  cfg: Config
  t: Tables
  /** the next cell id */
  next: number
  /** the running total of the round */
  total: number
  maxWin: number
  capped: boolean
  /** the free-spins multiplier */
  mult: number
  /** free spins a retrigger may still add */
  room: number
}

function context(rng: () => number, cfg: Config, maxWin: number): Ctx {
  return { rng, cfg, t: tablesOf(cfg), next: 1, total: 0, maxWin, capped: false, mult: 1, room: 0 }
}

/** rng order 1-2: the heights, then the board reel by reel, top to bottom. `f` = 0 base, 1 free. */
function drawSpinBoard(ctx: Ctx, t: Tables, f: 0 | 1) {
  const { rng } = ctx
  for (let r = 0; r < REELS; r++) hts[r] = HEIGHTS[pick(rng, t.heights[f])]
  const [first, rest] = t.sym[f]
  for (let r = 0; r < REELS; r++) {
    const w = r === 0 ? first : rest
    for (let p = r * MAX_ROWS, e = p + hts[r]; p < e; p++) {
      const s = pick(rng, w)
      work[p] = s
      workCells[p] = { id: ctx.next++, sym: SYMS[s] }
    }
  }
}

/** rng order 3: the blasted cells go, the rest fall, new ones drop in top first, reel by reel. */
function refill(ctx: Ctx, f: 0 | 1): Cell[][] {
  const { rng } = ctx
  const [first, rest] = ctx.t.sym[f]
  const drops: Cell[][] = []
  for (let r = 0; r < REELS; r++) {
    const top = r * MAX_ROWS
    // survivors fall to the bottom, keeping their order
    let w = top + hts[r] - 1
    for (let p = w; p >= top; p--) {
      if (blasted[p]) continue
      work[w] = work[p]
      workCells[w--] = workCells[p]
    }
    const k = w - top + 1
    const reelDrops: Cell[] = []
    const t = r === 0 ? first : rest
    for (let p = top; p < top + k; p++) {
      const s = pick(rng, t)
      const c: Cell = { id: ctx.next++, sym: SYMS[s] }
      work[p] = s
      workCells[p] = c
      reelDrops.push(c)
    }
    drops.push(reelDrops)
  }
  return drops
}

/** One spin: heights, board, cascades until nothing wins (or the cap), then the maps. */
function playSpin(ctx: Ctx, free: boolean, index: number): Spin {
  const { cfg, t } = ctx
  const f = free ? 1 : 0
  const before = ctx.total
  drawSpinBoard(ctx, t, f)
  const heights = Array.from(hts)
  const steps: Step[] = []
  for (;;) {
    const board = snapshot()
    blasted.fill(0)
    const wins = steps.length < MAX_STEPS - 1 ? scanWays(t.pays, true) : NO_WINS
    if (wins === NO_WINS) {
      steps.push({ board, wins: [], mult: ctx.mult, win: 0, drops: [] })
      break
    }
    const mult = ctx.mult
    let sum = 0
    for (const w of wins) sum += w.base
    const win = round2(sum * mult)
    ctx.total = round2(ctx.total + win)
    if (ctx.total >= ctx.maxWin) {
      ctx.total = ctx.maxWin
      ctx.capped = true
      steps.push({ board, wins, mult, win, drops: [] })
      break
    }
    if (free) ctx.mult++
    steps.push({ board, wins, mult, win, drops: refill(ctx, f) })
  }

  const mapIds: number[] = []
  let scatterPay = 0
  let award = 0
  if (!ctx.capped) {
    for (let r = 0; r < REELS; r++) for (let p = r * MAX_ROWS, e = p + hts[r]; p < e; p++) if (work[p] === MAP) mapIds.push(workCells[p].id)
    const m = mapIds.length
    if (free) {
      if (m >= RETRIGGER_MIN) award = Math.min(cfg.retrigger[Math.min(m, RETRIGGER_MIN + 2) - RETRIGGER_MIN], ctx.room)
    } else if (m >= SCATTER_MIN) {
      const k = Math.min(m, SCATTER_MIN + 2) - SCATTER_MIN
      scatterPay = cfg.scatterPays[k]
      ctx.total = round2(ctx.total + scatterPay)
      if (ctx.total >= ctx.maxWin) {
        ctx.total = ctx.maxWin
        ctx.capped = true
      } else award = cfg.spins[k]
    }
  }
  return {
    free,
    index,
    heights,
    steps,
    maps: mapIds.length,
    mapIds,
    scatterPay,
    award,
    multEnd: ctx.mult,
    win: round2(ctx.total - before),
    capped: ctx.capped,
  }
}

/** Treasure Hunt: `spins` free spins, the multiplier from ×1, retriggers adding spins up to MAX_FREE_SPINS. */
function playFree(ctx: Ctx, spins: number): Spin[] {
  const free: Spin[] = []
  ctx.next = FREE_ID_BASE
  ctx.mult = 1
  ctx.room = Math.max(0, MAX_FREE_SPINS - spins)
  let left = spins
  while (left > 0 && !ctx.capped) {
    const s = playSpin(ctx, true, free.length + 1)
    free.push(s)
    left += s.award - 1
    ctx.room -= s.award
  }
  return free
}

function finish(ctx: Ctx, kind: Buy, cost: number, base: Spin | null, free: Spin[], startSpins: number): Round {
  return {
    kind,
    cost,
    base,
    free,
    startSpins,
    feature: !!base && base.award > 0,
    total: ctx.total,
    capped: ctx.capped,
    maxMult: free.length ? free[free.length - 1].multEnd : 1,
  }
}

/** One paid spin and the Treasure Hunt it may start; or, with `opts.buy` 'fs', a bought Treasure Hunt.
 *  `maxWin` is for the simulator (a higher one measures what the cap takes). */
export function playRound(rng: () => number, opts: PlayOpts = { buy: 'none' }, cfg: Config = CONFIG, maxWin = MAX_WIN): Round {
  const ctx = context(rng, cfg, maxWin)
  if (opts.buy === 'fs') {
    const spins = cfg.spins[0]
    return finish(ctx, 'fs', BUY_PRICE, null, playFree(ctx, spins), spins)
  }
  const base = playSpin(ctx, false, 0)
  const free = base.award > 0 ? playFree(ctx, base.award) : []
  return finish(ctx, 'none', 1, base, free, base.award)
}

/** Simulator helper: a Treasure Hunt of `spins` free spins on top of `pre` already won, played by the same code as a
 *  buy (kind 'fs', cost 0). Its total includes `pre`. */
export function playFeature(rng: () => number, spins: number, cfg: Config = CONFIG, pre = 0, maxWin = MAX_WIN): Round {
  const ctx = context(rng, cfg, maxWin)
  ctx.total = pre
  if (pre >= maxWin) {
    ctx.total = maxWin
    ctx.capped = true
    return finish(ctx, 'fs', 0, null, [], spins)
  }
  return finish(ctx, 'fs', 0, null, playFree(ctx, spins), spins)
}
