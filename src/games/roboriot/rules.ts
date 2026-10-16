/*
  Robo Riot maths. A 5 × 5 board that pays 3,125 ways from the left. Power cells (and the ability bots) land
  anywhere; six or more start the Power Grid: they lock, every empty socket respins on its own, and any new
  arrival resets the respins to three. The bots work on the plain power cells only, never on each other: Zap bots
  double random power cells, Boost bots add their value to every power cell, Magnet bots collect the value of every
  power cell into themselves. Each bot fires once when it locks; a gold bot fires again on every later respin where
  something new clamps in. A bot with no power cell on the board to work on does nothing (it records no action).
  Every bot still pays its own value at the end. Gold bots only ever land on a respin; the one exception is the
  Super's, which starts on the board. A full board doubles the lot. Volt's Power Surge zaps in the missing cells
  now and then when four or five land.

  Keeping the bots off each other removes every bot-on-bot loop: a boost's or zap's own value never changes and a
  magnet's grows only from the power cells. The one effect that still compounds is a gold zap doubling power cells
  again on every landing respin, which is why zaps are the rarest bots on respins (kinds.bonus).

  Everything is drawn up front: a round is the base spin and the whole Power Grid, which the screen plays back.
  Simulated return about 96% for paid spins, Overclock and both buys (tools/roboriot-sim.ts).

  The board is drawn cell by cell. On the base reels a paying symbol may now and then repeat the paying symbol
  above it (`stack`); wilds and bonus symbols never stack.

  Random draws, in this exact order (every draw is one rng() call; a weighted pick walks its table in the order
  the table is written: PAY_SYMS then wild then the bonus symbol for the reels, BONUS_KINDS for kinds, the
  listed rows for values):
  Paid spin
    1. The board, pos 0 to 24 (column by column, top to bottom). For each cell:
       a. the symbol from the reel table (`base`, or `ante` with Overclock; reel 1 has no wild). The four bonus
          entries of the table add up to one "bonus symbol" weight (keep it on `cell`);
       b. a bonus symbol: its kind (kinds.base), then its value (values.base);
       c. a paying symbol on rows 1-4 under another paying symbol: one draw, below `stack` it becomes a copy of
          the symbol above.
    2. Only when exactly 4 or 5 bonus symbols landed: one draw, below pSurge[n - 4] Volt's Power Surge fires.
       Then for each missing cell (up to six): the socket (uniform over the sockets without a bonus symbol, in
       board order), then its value (values.base). Surge cells are always plain power cells.
    3. On a trigger, the Power Grid (below).
  Buy
    1. Six starting cells, each: the socket (uniform over the empty sockets, in board order), its kind
       (kinds.bonus), its value (values.bonus). Never gold.
    2. Super only, a seventh: the socket, its kind (kinds.bonus with the cell weight left out), its value
       (values.bonus). Always gold.
    3. The Power Grid.
  Power Grid
    1. The starting bots fire once (new zaps, new boosts, new magnets, board order within a kind); a zap draws
       one target per bolt, uniform over the locked plain power cells in board order (none when there are none).
    2. Each respin: for every empty socket in board order, one draw below pLand lands a bonus symbol; when it
       lands, its kind (kinds.bonus), value (values.bonus) and, for a bot only, gold (below pGold). Then the
       abilities: new zaps, new boosts, new magnets, then, only when something landed this respin, the gold bots
       locked before it (zaps, boosts, magnets), board order within a kind; again one draw per zap bolt.

  Ids: the base board is 1 to 25 (pos + 1), surge cells continue from 26, every cell that appears in the Power
  Grid (respin arrivals and a buy's starting cells) counts up from BONUS_ID_BASE. Trigger cells keep their ids.

  Max win: the running total is the ways win plus the sum of the Power Grid values. The round stops the moment it
  reaches MAX_WIN: the capping change is the last hit of the last action (or, when the values that just landed or
  locked reach it, the round ends on that respin's landing / the start, with no actions after it), and nothing
  after it is played. A full board is doubled at the very end, which can cap there too.
*/

export type PaySym = 'rex' | 'dot' | 'clank' | 'zip' | 'nut' | 'gear' | 'battery' | 'chip'
export type BotKind = 'magnet' | 'zap' | 'boost'
/** the bonus symbols: a plain power cell or an ability bot; all of them carry a value */
export type BonusKind = 'cell' | BotKind
export type Sym = PaySym | 'wild' | BonusKind
export type Buy = 'none' | 'bonus' | 'super'

export const COLS = 5
export const ROWS = 5
export const CELLS = 25
/** Highest paying first. */
export const PAY_SYMS: readonly PaySym[] = ['rex', 'dot', 'clank', 'zip', 'nut', 'gear', 'battery', 'chip']
export const BOTS: readonly BotKind[] = ['magnet', 'zap', 'boost']
export const BONUS_KINDS: readonly BonusKind[] = ['cell', 'magnet', 'zap', 'boost']
/** bonus symbols needed to start the Power Grid */
export const TRIGGER = 6
export const RESPINS = 3
/** a Zap bot fires this many bolts; each doubles the cell it hits */
export const ZAP_BOLTS = 3
/** a full board multiplies the Power Grid total by this */
export const FULL_MULT = 2
export const BUY_PRICE = 100
export const SUPER_PRICE = 425
export const ANTE_COST = 1.25
export const MAX_WIN = 20000
export const BONUS_ID_BASE = 100000

export interface Config {
  /** pays for 3, 4 and 5 reels, per way, in multiples of the total bet */
  pays: Record<PaySym, readonly [number, number, number]>
  /** relative symbol weights on the base reels (wild never on reel 1) */
  base: Record<Sym, number>
  /** base reels with Overclock (ante) on */
  ante: Record<Sym, number>
  /** which bonus symbol a bonus symbol is, in the base game, the Power Grid and the buys (relative) */
  kinds: { base: Record<BonusKind, number>; bonus: Record<BonusKind, number> }
  /** chance a bot landing on a respin is gold (persistent); gold never lands in the base game or a buy's start */
  pGold: number
  /** chance that an empty socket lands a bonus symbol on a respin */
  pLand: number
  /** values in multiples of the bet, [value, weight]; base game and Power Grid */
  values: { base: readonly (readonly [number, number])[]; bonus: readonly (readonly [number, number])[] }
  /** chance Volt zaps in the missing power cells when 4 or 5 land without a trigger */
  pSurge: readonly [number, number]
  /** chance that a paying symbol on the base reels repeats the paying symbol above it (stacks in the tubes) */
  stack: number
}

/** Tuned with tools/roboriot-sim.ts.
 *  - Reels: near-even weights with a light stack keep the hit rate near 58% with few wins under the bet.
 *  - Power Grid: bots are 7% of respin arrivals and about one in five of them is gold, so a gold bot shows up in
 *    about 13% of Power Grids. A gold bot is worth about 4.5× a plain Power Grid, and the Super's price rests on
 *    that gap, which narrows as gold gets commoner. Zaps are the rarest bots on respins (a second gold zap is what
 *    reaches the max win); the reels bring more of them to the start (kinds.base), where they fire once. */
export const CONFIG: Config = {
  pays: {
    rex: [0.2, 0.5, 1],
    dot: [0.15, 0.4, 0.75],
    clank: [0.12, 0.3, 0.5],
    zip: [0.1, 0.2, 0.4],
    nut: [0.05, 0.1, 0.15],
    gear: [0.05, 0.1, 0.15],
    battery: [0.04, 0.06, 0.12],
    chip: [0.04, 0.06, 0.12],
  },
  base: { rex: 7, dot: 8, clank: 8, zip: 9, nut: 9, gear: 9, battery: 9, chip: 9, wild: 1.5, cell: 4.49, magnet: 0, zap: 0, boost: 0 },
  ante: { rex: 7, dot: 8, clank: 8, zip: 9, nut: 9, gear: 9, battery: 9, chip: 9, wild: 1.5, cell: 5.04, magnet: 0, zap: 0, boost: 0 },
  kinds: { base: { cell: 85, magnet: 5, zap: 5, boost: 5 }, bonus: { cell: 93, magnet: 3, zap: 1, boost: 3 } },
  pGold: 0.196,
  pLand: 0.063,
  values: {
    base: [[1, 520], [2, 260], [3, 100], [5, 55], [8, 18], [10, 12], [15, 5], [25, 2], [50, 0.5]],
    bonus: [[1, 509], [2, 230], [3, 95], [5, 62], [8, 28], [10, 22], [15, 13], [25, 8], [50, 2.8]],
  },
  pSurge: [0.01, 0.04],
  stack: 0.15,
}
export const PAYS: Config['pays'] = CONFIG.pays

export interface Cell {
  /** unique within a round */
  id: number
  sym: Sym
  /** bonus symbols only: value in multiples of the bet */
  value?: number
  /** bonus bots only: persistent (fires again on every later respin where something lands) */
  gold?: boolean
}
/** grid[col][row], row 0 at the top */
export type Grid = Cell[][]

export const posOf = (col: number, row: number) => col * ROWS + row
export const colOf = (pos: number) => Math.floor(pos / ROWS)
export const rowOf = (pos: number) => pos % ROWS
export const isBonus = (s: Sym): s is BonusKind => s === 'cell' || s === 'magnet' || s === 'zap' || s === 'boost'

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

/** Volt zaps a power cell onto a socket that held something else */
export interface SurgeChange {
  pos: number
  from: Cell
  to: Cell
}

export interface BaseSpin {
  /** the board exactly as the reels land it */
  grid: Grid
  /** the power cells Volt adds when 4 or 5 landed without a trigger, or null */
  surge: SurgeChange[] | null
  /** the board after the surge (the same array as grid when there is none) */
  final: Grid
  ways: WayWin[]
  waysWin: number
  /** bonus symbols on the final board */
  bonusCount: number
  trigger: boolean
  /** multiple of the bet (the ways win; the Power Grid is paid separately) */
  win: number
}

/** one cell's value changing */
export interface Hit {
  id: number
  from: number
  to: number
}

export interface Action {
  /** the bot doing it */
  by: number
  kind: BotKind
  /** a gold bot firing again on a respin where something landed */
  persistent: boolean
  /** cells it reads from (magnet: every power cell it collects, in board order; zap/boost: none) */
  sources: number[]
  /** value changes in playback order: zap = one per bolt at a power cell (a cell can be hit twice), boost = every
   *  power cell in board order, magnet = itself. Never another bot: bots only work on plain power cells. */
  hits: Hit[]
}

export interface Placed {
  pos: number
  cell: Cell
}

export interface Respin {
  /** 1-based */
  index: number
  /** bonus symbols that landed this respin, in board order, with their starting values */
  landed: Placed[]
  /** abilities in the order they resolve: new zaps, new boosts, new magnets, then (only when something landed) the
   *  gold zaps, boosts and magnets locked earlier. Empty on a respin where nothing landed. */
  actions: Action[]
  /** respins left after this one (reset to RESPINS whenever something landed) */
  left: number
  /** Σ values on the board after this respin, before the full-board multiplier */
  sum: number
}

export interface Bonus {
  /** what is locked when the Power Grid starts (the trigger board's bonus symbols, or a buy's starting cells) */
  start: Placed[]
  /** the starting bots fire once, in the usual order, before the first respin */
  startActions: Action[]
  respins: Respin[]
  /** all 25 sockets filled */
  full: boolean
  /** Σ values at the end */
  sum: number
  /** sum × FULL_MULT when full, else sum (before the round's cap) */
  total: number
}

export interface Round {
  kind: Buy
  /** always false for buys */
  ante: boolean
  /** in bets: 1, ANTE_COST, BUY_PRICE or SUPER_PRICE */
  cost: number
  /** null for buys */
  base: BaseSpin | null
  bonus: Bonus | null
  /** multiple of the bet, ≤ MAX_WIN */
  total: number
  capped: boolean
  /** highest single cell value seen, multiple of the bet */
  maxCell: number
  /** any gold bot appeared */
  gold: boolean
}

export interface PlayOpts {
  buy: Buy
  ante: boolean
}

// ---------------------------------------------------------------------------------------------------------------
// Tables

// Internally a board is symbol codes by pos: 0-7 the paying symbols (PAY_SYMS order), then wild, then "bonus".
const WILD = 8
const BONUS = 9
const CODES = 10
// Bonus kinds are their index in BONUS_KINDS; abilities resolve zaps, then boosts, then magnets.
const K_CELL = 0
const K_MAGNET = 1
const K_ZAP = 2
const K_BOOST = 3
const FIRE_ORDER = [K_ZAP, K_BOOST, K_MAGNET] as const

const round2 = (n: number) => Math.round(n * 100) / 100

interface Weights {
  w: Float64Array
  total: number
  /** the last entry with a weight, which also catches rounding at the top end */
  last: number
}
interface Values {
  v: Float64Array
  pick: Weights
}
interface Tables {
  /** [reel 1, reels 2-5] */
  base: readonly [Weights, Weights]
  ante: readonly [Weights, Weights]
  /** pays[code * 3 + len - 3] */
  pays: Float64Array
  kindBase: Weights
  kindBonus: Weights
  /** kinds.bonus without the plain cell (a Super's gold bot) */
  kindBot: Weights
  valBase: Values
  valBonus: Values
}

function weights(w: Float64Array): Weights {
  return { w, total: w.reduce((a, v) => a + v, 0), last: w.reduce((l, v, i) => (v > 0 ? i : l), 0) }
}
function reelWeights(r: Record<Sym, number>, first: boolean): Weights {
  const w = new Float64Array(CODES)
  PAY_SYMS.forEach((s, i) => (w[i] = r[s]))
  w[WILD] = first ? 0 : r.wild
  w[BONUS] = r.cell + r.magnet + r.zap + r.boost
  return weights(w)
}
const kindWeights = (r: Record<BonusKind, number>, bots = false) => weights(Float64Array.from(BONUS_KINDS, (k) => (bots && k === 'cell' ? 0 : r[k])))
const valueTable = (rows: Config['values']['base']): Values => ({
  v: Float64Array.from(rows, (r) => r[0]),
  pick: weights(Float64Array.from(rows, (r) => r[1])),
})

// built once per Config object, so a config must not be changed after it has been played
const tableCache = new WeakMap<Config, Tables>()
function tablesOf(cfg: Config): Tables {
  let t = tableCache.get(cfg)
  if (!t) {
    const pays = new Float64Array(PAY_SYMS.length * 3)
    PAY_SYMS.forEach((s, i) => cfg.pays[s].forEach((v, k) => (pays[i * 3 + k] = v)))
    t = {
      base: [reelWeights(cfg.base, true), reelWeights(cfg.base, false)],
      ante: [reelWeights(cfg.ante, true), reelWeights(cfg.ante, false)],
      pays,
      kindBase: kindWeights(cfg.kinds.base),
      kindBonus: kindWeights(cfg.kinds.bonus),
      kindBot: kindWeights(cfg.kinds.bonus, true),
      valBase: valueTable(cfg.values.base),
      valBonus: valueTable(cfg.values.bonus),
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
const drawValue = (rng: () => number, t: Values) => t.v[pick(rng, t.pick)]

// ---------------------------------------------------------------------------------------------------------------
// Base board and ways

// The board of the round being played. Rounds are synchronous, so one working copy serves them all.
const board = new Int8Array(CELLS)
const boardCells: Cell[] = new Array<Cell>(CELLS)
const counts = new Int8Array(COLS * CODES)

/** Draws the 25 cells into board/boardCells with ids first, first + 1, … (rng order 1a-1c). */
function drawBoard(rng: () => number, t: Tables, reels: readonly [Weights, Weights], stack: number, first: number) {
  for (let p = 0; p < CELLS; p++) {
    let s = pick(rng, p < ROWS ? reels[0] : reels[1])
    if (s === BONUS) {
      const k = pick(rng, t.kindBase)
      boardCells[p] = { id: first + p, sym: BONUS_KINDS[k], value: drawValue(rng, t.valBase) }
    } else {
      if (s < WILD && p % ROWS > 0 && board[p - 1] < WILD && rng() < stack) s = board[p - 1]
      boardCells[p] = { id: first + p, sym: s === WILD ? 'wild' : PAY_SYMS[s] }
    }
    board[p] = s
  }
}
function snapshot(): Grid {
  const g: Grid = []
  for (let c = 0; c < COLS; c++) g.push(boardCells.slice(c * ROWS, (c + 1) * ROWS))
  return g
}
function bonusOnBoard(): number {
  let n = 0
  for (let p = 0; p < CELLS; p++) if (board[p] === BONUS) n++
  return n
}

/** Ways wins on a code board; `cells` gives the ids. Reel 1 wilds (never drawn) do not substitute. */
function scanWays(g: Int8Array, cells: readonly Cell[], pays: Float64Array): WayWin[] {
  counts.fill(0)
  for (let p = 0; p < CELLS; p++) counts[colOf(p) * CODES + g[p]]++
  const out: WayWin[] = []
  for (let s = 0; s < PAY_SYMS.length; s++) {
    let ways = counts[s]
    if (!ways) continue
    let len = 1
    while (len < COLS) {
      const m = counts[len * CODES + s] + counts[len * CODES + WILD]
      if (!m) break
      ways *= m
      len++
    }
    if (len < 3) continue
    const ids: number[] = []
    for (let p = 0; p < len * ROWS; p++) if (g[p] === s || (g[p] === WILD && p >= ROWS)) ids.push(cells[p].id)
    out.push({ sym: PAY_SYMS[s], len, ways, pay: round2(pays[s * 3 + len - 3] * ways), ids })
  }
  return out
}
const waysTotal = (ways: readonly WayWin[]) => round2(ways.reduce((a, w) => a + w.pay, 0))

function codeOf(s: Sym): number {
  if (s === 'wild') return WILD
  if (isBonus(s)) return BONUS
  return PAY_SYMS.indexOf(s)
}

/** ways wins on a board (wilds on reels 2-5 stand in for every paying symbol) */
export function findWays(grid: Grid, cfg: Config = CONFIG): WayWin[] {
  const cells = grid.flat()
  return scanWays(Int8Array.from(cells, (c) => codeOf(c.sym)), cells, tablesOf(cfg).pays)
}

let fillerTable: Weights[] | null = null
/** a random symbol for the blur of a falling column (never a wild on the first reel): one rng() call over the base
 *  weights of the paying symbols and the wild; never a bonus symbol (those carry a value) */
export function fillerSym(rng: () => number, col: number): Sym {
  if (!fillerTable) {
    const w = (first: boolean) => {
      const r = reelWeights(CONFIG.base, first).w.slice()
      r[BONUS] = 0
      return weights(r)
    }
    fillerTable = [w(true), w(false)]
  }
  const s = pick(rng, fillerTable[col === 0 ? 0 : 1])
  return s === WILD ? 'wild' : PAY_SYMS[s]
}

/** first column that should hold back because 4+ bonus symbols already show to its left; -1 if none */
export function teaseColumn(grid: Grid): number {
  let shown = 0
  for (let c = 0; c < COLS; c++) {
    if (shown >= TRIGGER - 2) return c
    for (const cell of grid[c]) if (isBonus(cell.sym)) shown++
  }
  return -1
}

/** a calm opening board: no win and fewer than 3 bonus symbols (up to 200 tries on the base reels; ids 1-25) */
export function calmGrid(rng: () => number, cfg: Config = CONFIG): Grid {
  const t = tablesOf(cfg)
  for (let tries = 0; tries < 200; tries++) {
    drawBoard(rng, t, t.base, cfg.stack, 1)
    if (bonusOnBoard() < 3 && !scanWays(board, boardCells, t.pays).length) break
  }
  return snapshot()
}

export function cellsById(grid: Grid): Map<number, { col: number; row: number; pos: number; cell: Cell }> {
  const m = new Map<number, { col: number; row: number; pos: number; cell: Cell }>()
  grid.forEach((col, c) => col.forEach((cell, r) => m.set(cell.id, { col: c, row: r, pos: posOf(c, r), cell })))
  return m
}

// ---------------------------------------------------------------------------------------------------------------
// The round

interface Ctx {
  rng: () => number
  cfg: Config
  t: Tables
  /** the next Power Grid id */
  nextBonus: number
  /** what the round has won before the Power Grid (the ways win) */
  pre: number
  /** Σ values on the Power Grid */
  sum: number
  maxWin: number
  capped: boolean
  maxCell: number
  gold: boolean
}

function context(rng: () => number, cfg: Config, maxWin: number): Ctx {
  return { rng, cfg, t: tablesOf(cfg), nextBonus: BONUS_ID_BASE, pre: 0, sum: 0, maxWin, capped: false, maxCell: 0, gold: false }
}

/** The paid spin: the board, the Power Surge and the ways (rng order 1-2). */
function playBase(ctx: Ctx, ante: boolean): BaseSpin {
  const { rng, cfg, t } = ctx
  drawBoard(rng, t, ante ? t.ante : t.base, cfg.stack, 1)
  for (let p = 0; p < CELLS; p++) if (board[p] === BONUS) ctx.maxCell = Math.max(ctx.maxCell, boardCells[p].value as number)
  const grid = snapshot()
  let n = bonusOnBoard()
  let surge: SurgeChange[] | null = null
  let final = grid
  if ((n === TRIGGER - 2 || n === TRIGGER - 1) && rng() < cfg.pSurge[n - (TRIGGER - 2)]) {
    surge = []
    let next = CELLS + 1
    const open: number[] = []
    for (let p = 0; p < CELLS; p++) if (board[p] !== BONUS) open.push(p)
    while (n < TRIGGER) {
      const pos = open.splice(Math.floor(rng() * open.length), 1)[0]
      const to: Cell = { id: next++, sym: 'cell', value: drawValue(rng, t.valBase) }
      surge.push({ pos, from: boardCells[pos], to })
      board[pos] = BONUS
      boardCells[pos] = to
      ctx.maxCell = Math.max(ctx.maxCell, to.value as number)
      n++
    }
    final = snapshot()
  }
  const ways = scanWays(board, boardCells, t.pays)
  const waysWin = waysTotal(ways)
  return { grid, surge, final, ways, waysWin, bonusCount: n, trigger: n >= TRIGGER, win: waysWin }
}

// The Power Grid being played: kind (index in BONUS_KINDS, -1 empty), value, gold, id and when it locked.
const gKind = new Int8Array(CELLS)
const gVal = new Float64Array(CELLS)
const gGold = new Uint8Array(CELLS)
const gId = new Int32Array(CELLS)
/** 0 = locked at the start, n = landed on respin n */
const gAt = new Int32Array(CELLS)
let gFilled = 0

function lock(ctx: Ctx, pos: number, cell: Cell, at: number) {
  const v = cell.value as number
  gKind[pos] = BONUS_KINDS.indexOf(cell.sym as BonusKind)
  gVal[pos] = v
  gGold[pos] = cell.gold ? 1 : 0
  gId[pos] = cell.id
  gAt[pos] = at
  gFilled++
  ctx.sum += v
  ctx.maxCell = Math.max(ctx.maxCell, v)
  if (cell.gold) ctx.gold = true
}
/** the running total reached the cap: stop the round there */
function reached(ctx: Ctx): boolean {
  if (!ctx.capped && ctx.pre + ctx.sum >= ctx.maxWin) ctx.capped = true
  return ctx.capped
}
function setValue(ctx: Ctx, pos: number, to: number, hits: Hit[]) {
  const from = gVal[pos]
  gVal[pos] = to
  ctx.sum += to - from
  ctx.maxCell = Math.max(ctx.maxCell, to)
  hits.push({ id: gId[pos], from, to })
}

/** the plain power cells on the board, in board order (what the bots work on) */
const plain: number[] = []

/** One bot firing at the plain power cells; it stops at the hit that reaches the cap. null when there are none. */
function fire(ctx: Ctx, pos: number, persistent: boolean): Action | null {
  plain.length = 0
  for (let q = 0; q < CELLS; q++) if (gKind[q] === K_CELL) plain.push(q)
  if (!plain.length) return null
  const kind = gKind[pos]
  const sources: number[] = []
  const hits: Hit[] = []
  if (kind === K_ZAP) {
    for (let b = 0; b < ZAP_BOLTS; b++) {
      const q = plain[Math.floor(ctx.rng() * plain.length)]
      setValue(ctx, q, gVal[q] * 2, hits)
      if (reached(ctx)) break
    }
  } else if (kind === K_BOOST) {
    const v = gVal[pos]
    for (const q of plain) {
      setValue(ctx, q, gVal[q] + v, hits)
      if (reached(ctx)) break
    }
  } else {
    let add = 0
    for (const q of plain) {
      sources.push(gId[q])
      add += gVal[q]
    }
    setValue(ctx, pos, gVal[pos] + add, hits)
    reached(ctx)
  }
  return { by: gId[pos], kind: BONUS_KINDS[kind] as BotKind, persistent, sources, hits }
}

/** The abilities of one respin (or the start, at = 0): the bots that locked at `at`, then, on a respin where
 *  something landed, the gold bots locked before it. */
function resolve(ctx: Ctx, at: number, landed: boolean): Action[] {
  const actions: Action[] = []
  for (const persistent of landed && at > 0 ? [false, true] : [false])
    for (const kind of FIRE_ORDER)
      for (let p = 0; p < CELLS; p++) {
        if (ctx.capped) return actions
        if (gKind[p] !== kind || (persistent ? !gGold[p] || gAt[p] >= at : gAt[p] !== at)) continue
        const a = fire(ctx, p, persistent)
        if (a) actions.push(a)
      }
  return actions
}

/** The Power Grid from `start` (board order), on top of ctx.pre. */
function playGrid_(ctx: Ctx, start: Placed[]): Bonus {
  const { rng, cfg, t } = ctx
  gKind.fill(-1)
  gFilled = 0
  ctx.sum = 0
  for (const pl of start) lock(ctx, pl.pos, pl.cell, 0)
  const startActions = reached(ctx) ? [] : resolve(ctx, 0, true)
  const respins: Respin[] = []
  let left = RESPINS
  while (!ctx.capped && left > 0 && gFilled < CELLS) {
    const index = respins.length + 1
    const landed: Placed[] = []
    for (let p = 0; p < CELLS; p++) {
      if (gKind[p] >= 0 || rng() >= cfg.pLand) continue
      const k = pick(rng, t.kindBonus)
      const cell: Cell = { id: ctx.nextBonus++, sym: BONUS_KINDS[k], value: drawValue(rng, t.valBonus) }
      if (k !== 0 && rng() < cfg.pGold) cell.gold = true
      landed.push({ pos: p, cell })
    }
    // the landing is one moment: lock them all, then see whether it reached the cap
    for (const pl of landed) lock(ctx, pl.pos, pl.cell, index)
    left = landed.length ? RESPINS : left - 1
    const actions = reached(ctx) ? [] : resolve(ctx, index, landed.length > 0)
    respins.push({ index, landed, actions, left, sum: ctx.sum })
  }
  const full = gFilled === CELLS
  const sum = ctx.sum
  const total = full ? sum * FULL_MULT : sum
  if (!ctx.capped && ctx.pre + total >= ctx.maxWin) ctx.capped = true
  return { start, startActions, respins, full, sum, total }
}

/** A buy's starting cells, in board order (rng order: buy 1-2). Only the Super's seventh is gold. */
function buyStart(ctx: Ctx, sup: boolean): Placed[] {
  const { rng, t } = ctx
  const open = Array.from({ length: CELLS }, (_, p) => p)
  const start: Placed[] = []
  for (let i = 0; i < TRIGGER + (sup ? 1 : 0); i++) {
    const pos = open.splice(Math.floor(rng() * open.length), 1)[0]
    const k = i < TRIGGER ? pick(rng, t.kindBonus) : pick(rng, t.kindBot)
    const cell: Cell = { id: ctx.nextBonus++, sym: BONUS_KINDS[k], value: drawValue(rng, t.valBonus) }
    if (i >= TRIGGER) cell.gold = true
    start.push({ pos, cell })
  }
  return start.sort((a, b) => a.pos - b.pos)
}

function finish(ctx: Ctx, kind: Buy, ante: boolean, cost: number, base: BaseSpin | null, bonus: Bonus | null): Round {
  const total = ctx.capped ? ctx.maxWin : round2(ctx.pre + (bonus ? bonus.total : 0))
  return { kind, ante, cost, base, bonus, total, capped: ctx.capped, maxCell: ctx.maxCell, gold: ctx.gold }
}

/** One paid spin and the Power Grid it may start; or, when `opts.buy` is set, a bought Power Grid.
 *  `maxWin` is for the simulator (a higher one measures what the cap takes). */
export function playRound(rng: () => number, opts: PlayOpts = { buy: 'none', ante: false }, cfg: Config = CONFIG, maxWin = MAX_WIN): Round {
  const ctx = context(rng, cfg, maxWin)
  if (opts.buy !== 'none') {
    const sup = opts.buy === 'super'
    const bonus = playGrid_(ctx, buyStart(ctx, sup))
    return finish(ctx, opts.buy, false, sup ? SUPER_PRICE : BUY_PRICE, null, bonus)
  }
  const base = playBase(ctx, opts.ante)
  ctx.pre = base.win
  if (ctx.pre >= maxWin) {
    ctx.capped = true
    return finish(ctx, 'none', opts.ante, opts.ante ? ANTE_COST : 1, base, null)
  }
  let bonus: Bonus | null = null
  if (base.trigger) {
    const start: Placed[] = []
    base.final.forEach((col, c) => col.forEach((cell, r) => isBonus(cell.sym) && start.push({ pos: posOf(c, r), cell })))
    bonus = playGrid_(ctx, start)
  }
  return finish(ctx, 'none', opts.ante, opts.ante ? ANTE_COST : 1, base, bonus)
}

/** Simulator helper: a Power Grid from `start` (board order) on top of `pre` already won, played by the same code as
 *  a round (kind 'none', no base spin, cost 0). Its total includes `pre`. */
export function playGrid(rng: () => number, start: Placed[], cfg: Config = CONFIG, pre = 0, maxWin = MAX_WIN): Round {
  const ctx = context(rng, cfg, maxWin)
  ctx.pre = pre
  for (const pl of start) ctx.maxCell = Math.max(ctx.maxCell, pl.cell.value as number)
  const bonus = playGrid_(ctx, start)
  return finish(ctx, 'none', false, 0, null, bonus)
}
