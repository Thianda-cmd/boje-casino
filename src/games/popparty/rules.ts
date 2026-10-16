/*
  Pop Party maths: a 7 × 7 disco floor with cluster pays. Five or more touching balloons of one kind win (up,
  down, left and right; disco balls never join), the winners pop, the rest float up to the top of their column
  and new balloons rise in from below until nothing wins. Every position has a disco tile: the first pop lights
  it, each pop after that doubles it from ×2 up to ×128, and a cluster is multiplied by the sum of the tiles
  under it. In the base game the floor goes dark again after every spin.

  Three or more disco balls left on the floor pay 2× to 100× and start 10 to 30 free spins (Disco Night), where
  the floor stays lit from spin to spin and more disco balls add spins. DJ Bop rescues dead drops: Pump It! grows
  a near miss into a cluster on paid spins, and Pin Drop! pops every balloon of one kind in free spins.

  Everything is drawn up front: a round is the whole list of spins and steps, which the screen then plays back.
  Simulated return about 96% for paid spins, Party Mode and both buys (tools/popparty-sim.ts).
*/

export type PaySym = 'poodle' | 'giraffe' | 'bunny' | 'octo' | 'heart' | 'star' | 'round'
export type Sym = PaySym | 'disco'
export type Buy = 'none' | 'fs' | 'super'

export const COLS = 7
export const ROWS = 7
export const CELLS = 49
export const MIN_CLUSTER = 5
export const PAY_SYMS: readonly PaySym[] = ['poodle', 'giraffe', 'bunny', 'octo', 'heart', 'star', 'round']
/** draw order for weighted picks; also the paytable order */
export const SYMS: readonly Sym[] = [...PAY_SYMS, 'disco']
/** lower bound of each size band */
export const BANDS = [5, 6, 7, 8, 10, 12, 15] as const
export const BAND_LABELS = ['5', '6', '7', '8–9', '10–11', '12–14', '15+'] as const
export const MAX_LEVEL = 8
export const SCATTER_MIN = 3
export const SCATTER_PAYS = [2, 5, 15, 50, 100] as const // D = 3, 4, 5, 6, 7+
export const SCATTER_SPINS = [10, 12, 15, 20, 30] as const // D = 3, 4, 5, 6, 7+
export const RETRIGGER_SPINS = [5, 8, 10] as const // D = 3, 4, 5+
export const MAX_FREE_SPINS = 100
export const BUY_SPINS = 10
export const BUY_PRICE = 100
export const SUPER_PRICE = 525
export const ANTE_COST = 1.25
export const MAX_WIN = 10000
export const MAX_STEPS = 100
export const FREE_ID_BASE = 100000

export interface Config {
  /** 7 entries per symbol, by band */
  pays: Record<PaySym, readonly number[]>
  /** relative weights, paid spins */
  base: Record<Sym, number>
  /** paid spins with Party Mode */
  ante: Record<Sym, number>
  /** every free spin (natural or bought) */
  free: Record<Sym, number>
  pPump: number
  pPin: number
  /** 8 = ×128 */
  maxLevel: number
  /** 2 = ×2 */
  superStart: number
}

export const CONFIG: Config = {
  pays: {
    poodle: [2.5, 4, 7, 14, 35, 90, 250],
    giraffe: [1.8, 3, 4.5, 9, 22, 55, 180],
    bunny: [1.25, 2, 3.25, 6.5, 15, 36, 110],
    octo: [0.9, 1.5, 2.2, 4.5, 11, 27, 72],
    heart: [0.55, 0.9, 1.45, 2.7, 7, 18, 45],
    star: [0.45, 0.7, 1.1, 2.2, 5.5, 14, 36],
    round: [0.35, 0.55, 0.9, 1.8, 4.5, 11, 27],
  },
  base: { poodle: 7.5, giraffe: 9.5, bunny: 11.5, octo: 13.5, heart: 16, star: 18, round: 20.5, disco: 0.583 },
  ante: { poodle: 7.5, giraffe: 9.5, bunny: 11.5, octo: 13.5, heart: 16, star: 18, round: 20.5, disco: 0.689 },
  free: { poodle: 6.5, giraffe: 8, bunny: 10, octo: 12.5, heart: 17, star: 20.5, round: 25.5, disco: 0.75 },
  pPump: 0.05,
  pPin: 0.5185,
  maxLevel: 8,
  superStart: 2,
}
export const PAYS: Config['pays'] = CONFIG.pays

export interface Cell {
  /** unique within a round */
  id: number
  sym: Sym
}
/** grid[col][row], row 0 at the top */
export type Grid = Cell[][]

export const posOf = (col: number, row: number) => col * ROWS + row
export const colOf = (pos: number) => Math.floor(pos / ROWS)
export const rowOf = (pos: number) => pos % ROWS

/** a tile change; only real changes (to > from) */
export interface TileUp {
  pos: number
  from: number
  to: number
}

export interface Cluster {
  sym: PaySym
  /** BFS order = pop order */
  ids: number[]
  /** aligned with ids */
  pos: number[]
  size: number
  /** pays[sym][band] */
  base: number
  /** levelMult of the tile under each cell, aligned with ids */
  mults: number[]
  /** Σ mults */
  sum: number
  /** max(1, sum) */
  mult: number
  /** round2(base × mult) */
  pay: number
  /** this cluster's tile changes, in pop order */
  ups: TileUp[]
}
/** ids in playback order */
export interface Pin {
  sym: PaySym
  ids: number[]
  pos: number[]
  ups: TileUp[]
}
/** `to` has a new id */
export interface PumpChange {
  pos: number
  from: Cell
  to: Cell
}
/** group = ids of the starting group */
export interface Pump {
  sym: PaySym
  group: number[]
  changes: PumpChange[]
}

/** One evaluation. A step pops something when clusters.length > 0 or pin != null.
 *  The last step of an uncapped spin has neither: its grid is the final grid. */
export interface Step {
  /** the grid before this step's pops */
  grid: Grid
  /** ordered by lowest pos (column-major scan order) */
  clusters: Cluster[]
  /** only ever on step 0 of a free spin, with clusters = [] */
  pin: Pin | null
  /** = clusters' ups concatenated in order, or pin.ups */
  ups: TileUp[]
  /** round2(Σ cluster.pay), uncapped */
  win: number
}

export interface Spin {
  free: boolean
  /** 0 = the paid spin, 1.. = free spins in play order */
  index: number
  /** 49 levels before the drop */
  tilesStart: number[]
  /** 49 levels after the last step */
  tilesEnd: number[]
  /** the first drop exactly as it lands (before Pump It!) */
  drop: Grid
  pump: Pump | null
  /** steps[0].grid = drop with the pump changes applied */
  steps: Step[]
  /** D on the final grid (0 if capped mid-spin) */
  discos: number
  /** ids of those disco balls */
  discoIds: number[]
  /** paid spins only */
  scatterPay: number
  /** spins awarded: start spins (paid) or retrigger spins actually added (free); 0 once the round is capped */
  award: number
  /** Σ step.win, uncapped */
  clusterWin: number
  /** what this spin adds to the round total, after the cap */
  win: number
  /** the round reached MAX_WIN in this spin; when a step did it, that step is the last (no settle step follows) */
  capped: boolean
}

export interface Round {
  kind: Buy
  /** always false for buys */
  ante: boolean
  /** in bets: 1, ANTE_COST, BUY_PRICE or SUPER_PRICE */
  cost: number
  /** null for buys */
  base: Spin | null
  free: Spin[]
  /** base.award, or BUY_SPINS */
  startSpins: number
  /** a natural trigger (base.award > 0) */
  feature: boolean
  /** multiple of the bet, ≤ MAX_WIN */
  total: number
  capped: boolean
  /** highest levelMult any tile reached in the round: 0, 2, 4, …, 128 */
  maxTile: number
  /** Σ levelMult of the last spin's tilesEnd */
  floor: number
}

export interface PlayOpts {
  buy: Buy
  ante: boolean
}

export const levelMult = (level: number) => (level >= 2 ? 2 ** (level - 1) : 0)
/** -1 below 5, else 0..6 */
export function bandOf(size: number): number {
  let b = -1
  for (let i = 0; i < BANDS.length; i++) if (size >= BANDS[i]) b = i
  return b
}
export function payFor(sym: PaySym, size: number, cfg: Config = CONFIG): number {
  const b = bandOf(size)
  return b < 0 ? 0 : cfg.pays[sym][b]
}

// Internally a floor is typed arrays indexed by pos: symbol codes (the index in SYMS) and tile levels.
const DISCO = SYMS.indexOf('disco')
const SYM_CODE = Object.fromEntries(SYMS.map((s, i) => [s, i])) as Record<Sym, number>
const MULT = Float64Array.from({ length: 64 }, (_, l) => levelMult(l))
const BAND_OF = Int8Array.from({ length: CELLS + 1 }, (_, n) => bandOf(n))
/** neighbours of each position in BFS order (up, down, left, right), -1 past the edge */
const NEIGHBOURS = Int8Array.from({ length: CELLS * 4 }, (_, k) => {
  const p = k >> 2
  const c = colOf(p)
  const r = rowOf(p)
  return [r > 0 ? p - 1 : -1, r < ROWS - 1 ? p + 1 : -1, c > 0 ? p - ROWS : -1, c < COLS - 1 ? p + ROWS : -1][k & 3]
})

const round2 = (n: number) => Math.round(n * 100) / 100

interface Weights {
  /** by symbol code */
  w: Float64Array
  total: number
  /** the last symbol with a weight, which also catches rounding at the top end */
  last: number
}
interface Tables {
  base: Weights
  ante: Weights
  free: Weights
  /** pays[code * 7 + band] */
  pays: Float64Array
}
// built once per Config object, so a config must not be changed after it has been played
const tableCache = new WeakMap<Config, Tables>()
function tablesOf(cfg: Config): Tables {
  let t = tableCache.get(cfg)
  if (!t) {
    const weights = (r: Record<Sym, number>): Weights => {
      const w = Float64Array.from(SYMS, (s) => r[s])
      return { w, total: w.reduce((a, v) => a + v, 0), last: w.reduce((l, v, i) => (v > 0 ? i : l), 0) }
    }
    const pays = new Float64Array(PAY_SYMS.length * BANDS.length)
    PAY_SYMS.forEach((s, i) => cfg.pays[s].forEach((v, b) => (pays[i * BANDS.length + b] = v)))
    t = { base: weights(cfg.base), ante: weights(cfg.ante), free: weights(cfg.free), pays }
    tableCache.set(cfg, t)
  }
  return t
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

// flood-fill scratch: a cell is visited when seen[pos] === stamp
const seen = new Int32Array(CELLS)
const queue = new Int32Array(CELLS)
let stamp = 0
function nextStamp() {
  if (++stamp > 0x3fffffff) {
    seen.fill(0)
    stamp = 1
  }
}

/** Breadth-first flood over unvisited cells of start's symbol; leaves them in queue[0..n) in dequeue order and returns n. */
function flood(g: Int8Array, start: number): number {
  const s = g[start]
  seen[start] = stamp
  queue[0] = start
  let head = 0
  let tail = 1
  while (head < tail) {
    const p = queue[head++]
    for (let k = p * 4; k < p * 4 + 4; k++) {
      const q = NEIGHBOURS[k]
      if (q >= 0 && seen[q] !== stamp && g[q] === s) {
        seen[q] = stamp
        queue[tail++] = q
      }
    }
  }
  return tail
}

/** Every cluster on a floor in scan order, paid with the tiles as they stand. */
function scan(g: Int8Array, cells: readonly Cell[], tiles: ArrayLike<number>, pays: Float64Array, maxLevel: number): Cluster[] {
  const out: Cluster[] = []
  nextStamp()
  for (let p = 0; p < CELLS; p++) {
    if (seen[p] === stamp || g[p] === DISCO) continue
    const n = flood(g, p)
    if (n < MIN_CLUSTER) continue
    const ids: number[] = []
    const pos: number[] = []
    const mults: number[] = []
    const ups: TileUp[] = []
    let sum = 0
    for (let i = 0; i < n; i++) {
      const q = queue[i]
      const from = tiles[q]
      ids.push(cells[q].id)
      pos.push(q)
      mults.push(MULT[from])
      sum += MULT[from]
      if (from < maxLevel) ups.push({ pos: q, from, to: from + 1 })
    }
    const base = pays[g[p] * BANDS.length + BAND_OF[n]]
    const mult = Math.max(1, sum)
    out.push({ sym: PAY_SYMS[g[p]], ids, pos, size: n, base, mults, sum, mult, pay: round2(base * mult), ups })
  }
  return out
}

/** Every cluster on the grid, ordered by lowest pos, with the tile changes its pops would make. */
export function findClusters(grid: Grid, tiles: readonly number[], cfg: Config = CONFIG): Cluster[] {
  const cells = grid.flat()
  const g = Int8Array.from(cells, (c) => SYM_CODE[c.sym])
  return scan(g, cells, tiles, tablesOf(cfg).pays, cfg.maxLevel)
}
/** Survivors keep their order at the top of each column; `draw` refills columns left to right, top-most gap first. */
export function floatUp(grid: Grid, popped: ReadonlySet<number>, draw: () => Cell): Grid {
  return grid.map((col) => {
    const next = col.filter((c) => !popped.has(c.id))
    while (next.length < ROWS) next.push(draw())
    return next
  })
}
export function countDiscos(grid: Grid): number {
  return grid.reduce((n, col) => n + col.filter((c) => c.sym === 'disco').length, 0)
}
export function floorSum(tiles: readonly number[]): number {
  return tiles.reduce((a, l) => a + levelMult(l), 0)
}
export function maxMult(tiles: readonly number[]): number {
  return tiles.reduce((a, l) => Math.max(a, levelMult(l)), 0)
}
/** first column that should hold back because ≥2 disco balls already show in the columns to its left; -1 if none */
export function teaseColumn(drop: Grid): number {
  let shown = 0
  for (let c = 0; c < COLS; c++) {
    if (shown >= SCATTER_MIN - 1) return c
    shown += drop[c].filter((x) => x.sym === 'disco').length
  }
  return -1
}
/** a calm opening grid: no cluster and at most 1 disco ball (up to 200 tries with base weights) */
export function calmGrid(rng: () => number, cfg: Config = CONFIG): Grid {
  const t = tablesOf(cfg)
  const g = new Int8Array(CELLS)
  const cells: Cell[] = []
  const dark = new Uint8Array(CELLS)
  for (let tries = 0; tries < 200; tries++) {
    for (let p = 0; p < CELLS; p++) {
      g[p] = drawSym(rng, t.base)
      cells[p] = { id: p + 1, sym: SYMS[g[p]] }
    }
    if (g.filter((s) => s === DISCO).length <= 1 && !scan(g, cells, dark, t.pays, cfg.maxLevel).length) break
  }
  return Array.from({ length: COLS }, (_, c) => cells.slice(c * ROWS, (c + 1) * ROWS))
}
export function cellsById(grid: Grid): Map<number, { col: number; row: number; pos: number; cell: Cell }> {
  const m = new Map<number, { col: number; row: number; pos: number; cell: Cell }>()
  grid.forEach((col, c) => col.forEach((cell, r) => m.set(cell.id, { col: c, row: r, pos: posOf(c, r), cell })))
  return m
}

// The floor of the round being played. Rounds are synchronous, so one working copy serves them all.
const work = new Int8Array(CELLS)
const workCells: Cell[] = new Array<Cell>(CELLS)
const workTiles = new Uint8Array(CELLS)
const popped = new Uint8Array(CELLS)

interface Ctx {
  rng: () => number
  cfg: Config
  t: Tables
  /** draw table of the spin in play */
  weights: Weights
  /** next id: the paid spin and the free spins each have their own counter */
  next: number
  total: number
  maxWin: number
  capped: boolean
  /** spins a retrigger may still add before the feature reaches MAX_FREE_SPINS */
  room: number
}

function fresh(ctx: Ctx, p: number) {
  const s = drawSym(ctx.rng, ctx.weights)
  work[p] = s
  workCells[p] = { id: ctx.next++, sym: SYMS[s] }
}
/** the working tiles as a plain array (a loop: Array.from on a typed array is many times slower) */
function levels(): number[] {
  const out = new Array<number>(CELLS)
  for (let p = 0; p < CELLS; p++) out[p] = workTiles[p]
  return out
}
function snapshot(): Grid {
  const g: Grid = []
  for (let c = 0; c < COLS; c++) g.push(workCells.slice(c * ROWS, (c + 1) * ROWS))
  return g
}
function markPopped(pos: readonly number[]) {
  for (const p of pos) popped[p] = 1
}
function raise(ups: readonly TileUp[]) {
  for (const u of ups) workTiles[u.pos] = u.to
}
/** Float-up on the working floor: survivors move to the top in order, then refills from the left column. */
function floatWork(ctx: Ctx) {
  for (let c = 0; c < COLS; c++) {
    const top = c * ROWS
    let w = top
    for (let p = top; p < top + ROWS; p++) {
      if (popped[p]) {
        popped[p] = 0
        continue
      }
      work[w] = work[p]
      workCells[w++] = workCells[p]
    }
    while (w < top + ROWS) fresh(ctx, w++)
  }
}

/** Pump It!: grows the best near miss on a dead drop into a cluster; null when no group can reach five. */
function pumpIt(ctx: Ctx): Pump | null {
  // every group, best first: larger, then lower paying, then lower first position
  const groups: { s: number; at: number; n: number }[] = []
  nextStamp()
  for (let p = 0; p < CELLS; p++) if (seen[p] !== stamp && work[p] !== DISCO) groups.push({ s: work[p], at: p, n: flood(work, p) })
  groups.sort((a, b) => b.n - a.n || b.s - a.s || a.at - b.at)
  // a group runs out of candidates exactly when fewer than five disco-free cells connect to it, so skip those up front
  const pick = groups.find((g) => reach(g.at) >= MIN_CLUSTER)
  if (!pick) return null
  const sym = PAY_SYMS[pick.s]
  nextStamp()
  let size = flood(work, pick.at)
  const group = Array.from(queue.subarray(0, size), (p) => workCells[p].id)
  const changes: PumpChange[] = []
  const cand: number[] = []
  while (size < MIN_CLUSTER) {
    cand.length = 0
    for (let p = 0; p < CELLS; p++) {
      if (seen[p] === stamp || work[p] === DISCO) continue
      for (let k = p * 4; k < p * 4 + 4; k++) {
        if (NEIGHBOURS[k] >= 0 && seen[NEIGHBOURS[k]] === stamp) {
          cand.push(p)
          break
        }
      }
    }
    const q = cand[Math.floor(ctx.rng() * cand.length)]
    const to: Cell = { id: ctx.next++, sym }
    changes.push({ pos: q, from: workCells[q], to })
    work[q] = pick.s
    workCells[q] = to
    // the new balloon joins the group along with any same-kind balloons it touches
    size += flood(work, q)
  }
  return { sym, group, changes }
}
/** How many disco-free cells connect to `start`, counting no further than MIN_CLUSTER. */
function reach(start: number): number {
  nextStamp()
  seen[start] = stamp
  queue[0] = start
  let head = 0
  let tail = 1
  while (head < tail && tail < MIN_CLUSTER) {
    const p = queue[head++]
    for (let k = p * 4; k < p * 4 + 4; k++) {
      const q = NEIGHBOURS[k]
      if (q >= 0 && seen[q] !== stamp && work[q] !== DISCO) {
        seen[q] = stamp
        queue[tail++] = q
      }
    }
  }
  return tail
}

/** Pin Drop!: every balloon of one kind on the floor pops without paying, nearest the centre first. */
function pinDrop(ctx: Ctx): Pin | null {
  const present: number[] = []
  for (let s = 0; s < PAY_SYMS.length; s++) if (work.includes(s)) present.push(s)
  if (!present.length) return null
  const s = present[Math.floor(ctx.rng() * present.length)]
  const at: number[] = []
  for (let p = 0; p < CELLS; p++) if (work[p] === s) at.push(p)
  const dist = (a: number, b: number) => Math.abs(colOf(a) - colOf(b)) + Math.abs(rowOf(a) - rowOf(b))
  // ties go to the lower column, then the lower row: that is the lower pos
  const centre = posOf(3, 3)
  const first = at.reduce((f, p) => (dist(p, centre) < dist(f, centre) ? p : f))
  at.sort((a, b) => dist(a, first) - dist(b, first) || a - b)
  const ups: TileUp[] = []
  for (const p of at) if (workTiles[p] < ctx.cfg.maxLevel) ups.push({ pos: p, from: workTiles[p], to: workTiles[p] + 1 })
  return { sym: PAY_SYMS[s], ids: at.map((p) => workCells[p].id), pos: at, ups }
}

/** One spin on the working tiles: the drop, a rescue if it is dead, then cascades until nothing pops. */
function playSpin(ctx: Ctx, free: boolean, index: number): Spin {
  const { rng, cfg, t } = ctx
  const before = ctx.total
  const tilesStart = levels()
  for (let p = 0; p < CELLS; p++) fresh(ctx, p)
  const drop = snapshot()
  let grid = drop
  let clusters = scan(work, workCells, workTiles, t.pays, cfg.maxLevel)
  let pump: Pump | null = null
  let pin: Pin | null = null
  if (!clusters.length) {
    if (!free) {
      if (rng() < cfg.pPump) pump = pumpIt(ctx)
      if (pump) {
        grid = snapshot()
        clusters = scan(work, workCells, workTiles, t.pays, cfg.maxLevel)
      }
    } else if (rng() < cfg.pPin) pin = pinDrop(ctx)
  }

  const steps: Step[] = []
  let clusterWin = 0
  for (;;) {
    if (pin && !steps.length) {
      steps.push({ grid, clusters: [], pin, ups: pin.ups, win: 0 })
      raise(pin.ups)
      markPopped(pin.pos)
    } else if (clusters.length && steps.length < MAX_STEPS - 1) {
      const ups: TileUp[] = []
      let win = 0
      for (const c of clusters) {
        win += c.pay
        for (const u of c.ups) ups.push(u)
      }
      win = round2(win)
      steps.push({ grid, clusters, pin: null, ups, win })
      raise(ups)
      clusterWin = round2(clusterWin + win)
      ctx.total = round2(ctx.total + win)
      if (ctx.total >= ctx.maxWin) {
        ctx.total = ctx.maxWin
        ctx.capped = true
        break
      }
      for (const c of clusters) markPopped(c.pos)
    } else {
      // nothing pops (or the safety limit is reached): this is the final grid
      steps.push({ grid, clusters: [], pin: null, ups: [], win: 0 })
      break
    }
    floatWork(ctx)
    grid = snapshot()
    clusters = scan(work, workCells, workTiles, t.pays, cfg.maxLevel)
  }

  const discoIds: number[] = []
  let scatterPay = 0
  let award = 0
  if (!ctx.capped) {
    for (let p = 0; p < CELLS; p++) if (work[p] === DISCO) discoIds.push(workCells[p].id)
    const d = discoIds.length
    if (d >= SCATTER_MIN && free) award = Math.min(RETRIGGER_SPINS[Math.min(d, 5) - 3], ctx.room)
    else if (d >= SCATTER_MIN) {
      const k = Math.min(d, 7) - 3
      scatterPay = SCATTER_PAYS[k]
      ctx.total = round2(ctx.total + scatterPay)
      if (ctx.total >= ctx.maxWin) {
        ctx.total = ctx.maxWin
        ctx.capped = true
      } else award = SCATTER_SPINS[k]
    }
  }
  return {
    free,
    index,
    tilesStart,
    tilesEnd: levels(),
    drop,
    pump,
    steps,
    discos: discoIds.length,
    discoIds,
    scatterPay,
    award,
    clusterWin,
    win: round2(ctx.total - before),
    capped: ctx.capped,
  }
}

/** Disco Night: `spins` free spins on a floor starting at `startLevel`, the tiles carrying over from spin to spin. */
function playFree(ctx: Ctx, spins: number, startLevel: number): Spin[] {
  const free: Spin[] = []
  workTiles.fill(startLevel)
  ctx.weights = ctx.t.free
  ctx.next = FREE_ID_BASE
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

function context(rng: () => number, cfg: Config, maxWin: number): Ctx {
  const t = tablesOf(cfg)
  return { rng, cfg, t, weights: t.base, next: 1, total: 0, maxWin, capped: false, room: 0 }
}

function finish(ctx: Ctx, kind: Buy, ante: boolean, cost: number, base: Spin | null, free: Spin[], startSpins: number): Round {
  const last = free.length ? free[free.length - 1] : (base as Spin)
  return {
    kind,
    ante,
    cost,
    base,
    free,
    startSpins,
    feature: !!base && base.award > 0,
    total: ctx.total,
    capped: ctx.capped,
    // tiles only ever rise within a spin and within a feature, so the ends hold the highest levels
    maxTile: Math.max(base ? maxMult(base.tilesEnd) : 0, maxMult(last.tilesEnd)),
    floor: floorSum(last.tilesEnd),
  }
}

/** One paid spin and the Disco Night it may start; or, when `opts.buy` is set, a bought Disco Night. */
export function playRound(rng: () => number, opts: PlayOpts = { buy: 'none', ante: false }, cfg: Config = CONFIG): Round {
  const ctx = context(rng, cfg, MAX_WIN)
  if (opts.buy !== 'none') {
    const sup = opts.buy === 'super'
    const free = playFree(ctx, BUY_SPINS, sup ? cfg.superStart : 0)
    return finish(ctx, opts.buy, false, sup ? SUPER_PRICE : BUY_PRICE, null, free, BUY_SPINS)
  }
  workTiles.fill(0)
  ctx.weights = opts.ante ? ctx.t.ante : ctx.t.base
  const base = playSpin(ctx, false, 0)
  const free = base.award > 0 ? playFree(ctx, base.award, 0) : []
  return finish(ctx, 'none', opts.ante, opts.ante ? ANTE_COST : 1, base, free, base.award)
}

/** Simulator helper: a Disco Night of `spins` spins from `startLevel`, played by the same code as a buy (cost 0).
 *  A higher `maxWin` measures what the cap takes. */
export function playFeature(rng: () => number, spins: number, startLevel = 0, cfg: Config = CONFIG, maxWin = MAX_WIN): Round {
  const ctx = context(rng, cfg, maxWin)
  return finish(ctx, 'fs', false, 0, null, playFree(ctx, spins, startLevel), spins)
}
