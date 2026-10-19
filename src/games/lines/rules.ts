/*
  Lucky Lines rules: a bingo card played with a row of five reels.

  The card is 5 × 5: column c holds five different numbers from 15c+1 to 15c+15, low to high. Each spin lands one
  symbol on each column's reel: a number from that column's range (if it is on the card, it is marked), a Joker (mark
  any number in that column), a Super Joker (mark any number on the card) or, on the paid-up spins, a Free Spin. Jokers
  are placed by the player before the next spin. A full row, column or diagonal is a line (12 in all); the payout at
  the end climbs a ladder by the number of lines (LADDER), up to 500× the bet for a full card.

  A game is BASE_SPINS spins for the bet, plus any free spins won. Then the player may buy up to MAX_EXTRA extra
  spins, one at a time, at a price worked out from the card: each extra spin costs what it is worth on average (the
  exact expected rise of the ladder over one spin, placing jokers the suggested way) ÷ EXTRA_RTP, so the extra spins
  return 97% of their price on average (a little less where the price is rounded up to the cent, or held up by its
  floor of MIN_PRICE of the bet). The base game returns about 95.5% (tools/lines-sim.ts), placing jokers the
  suggested way (`bestCell`): the suggestion is always on screen, and a player who places them worse gets less.

  Everything about a spin is drawn when it is spun; the game is plain data that is saved after every step, so a
  closed page picks up exactly where it was. (tools/lines-test.ts checks the card, the spins, the jokers, the lines,
  the ladder and the price against a brute-force check.)
*/

import { round2 } from '../../lib/format'

export const COLS = 5
export const BASE_SPINS = 10
export const MAX_EXTRA = 10
/** an extra spin is priced to return this much of its price on average, placing jokers the suggested way */
export const EXTRA_RTP = 0.97
/** an extra spin never costs less than this share of the bet */
export const MIN_PRICE = 0.01

/** reel weights: each of the column's 15 numbers weighs 1 */
export const W_JOKER = 1
export const W_SUPER = 0.25
/** free spins only land on the paid-up spins (the base game and its free spins), never on a bought one */
export const W_FREE = 0.5

/** pays × the bet by lines at the end (11 lines can't happen: one cell short of full leaves at least two open) */
export const LADDER: readonly number[] = [0, 0, 0.3, 0.75, 1.5, 2.5, 5, 10, 20, 40, 80, 0, 500]

/** the 12 lines, as card cells (cell = column * 5 + row) */
export const LINES: readonly (readonly number[])[] = [
  ...[0, 1, 2, 3, 4].map((r) => [0, 1, 2, 3, 4].map((c) => c * 5 + r)),
  ...[0, 1, 2, 3, 4].map((c) => [0, 1, 2, 3, 4].map((r) => c * 5 + r)),
  [0, 6, 12, 18, 24],
  [20, 16, 12, 8, 4],
]
/** for each cell, the lines through it */
export const LINES_AT: readonly (readonly number[])[] = Array.from({ length: 25 }, (_, i) => LINES.flatMap((l, k) => (l.includes(i) ? [k] : [])))
export const colOf = (cell: number) => Math.floor(cell / 5)

export type ReelSym = { kind: 'num'; n: number; cell: number | null } | { kind: 'joker' } | { kind: 'super' } | { kind: 'free' }

export interface Game {
  bet: number
  /** 25 numbers, cell = column * 5 + row */
  card: number[]
  marks: boolean[]
  /** paid-up spins left (base and free) */
  spins: number
  spun: number
  freeWon: number
  /** extra spins bought, and what they cost */
  extras: number
  extraPaid: number
  /** an extra spin is bought and waiting to be spun */
  extraReady: boolean
  /** jokers waiting to be placed: one column each */
  jokers: number[]
  supers: number
  /** the last spin's reels */
  last: ReelSym[] | null
  done: boolean
}

/* ---------------- the card ---------------- */

export function newCard(rng: () => number): number[] {
  const card: number[] = []
  for (let c = 0; c < COLS; c++) {
    const pool = Array.from({ length: 15 }, (_, i) => 15 * c + 1 + i)
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(rng() * (15 - i))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    card.push(...pool.slice(0, 5).sort((a, b) => a - b))
  }
  return card
}

export function newGame(bet: number, rng: () => number): Game {
  return { bet, card: newCard(rng), marks: new Array(25).fill(false), spins: BASE_SPINS, spun: 0, freeWon: 0, extras: 0, extraPaid: 0, extraReady: false, jokers: [], supers: 0, last: null, done: false }
}

/* ---------------- lines ---------------- */

export const lineDone = (marks: readonly boolean[], k: number) => LINES[k].every((i) => marks[i])
export const linesOf = (marks: readonly boolean[]) => LINES.reduce((a, _l, k) => a + (lineDone(marks, k) ? 1 : 0), 0)
/** which lines are complete */
export const doneLines = (marks: readonly boolean[]) => LINES.flatMap((_l, k) => (lineDone(marks, k) ? [k] : []))
export const ladderPay = (lines: number) => LADDER[Math.max(0, Math.min(12, lines))]
/** what the card would pay now, × the bet */
export const valueOf = (marks: readonly boolean[]) => ladderPay(linesOf(marks))

/* ---------------- jokers ---------------- */

const WT = [0, 1, 4, 16, 64]
/** how good marking `cell` is: completing lines first, then building the fullest ones */
function cellScore(marks: readonly boolean[], cell: number): number {
  let s = 0
  for (const k of LINES_AT[cell]) {
    let m = 0
    for (const j of LINES[k]) if (marks[j]) m++
    s += m + 1 >= 5 ? 1000 : WT[m + 1]
  }
  return s
}

/** the suggested cell for a joker in `col` (or anywhere, for a Super Joker: col = -1); -1 if there is none */
export function suggest(marks: readonly boolean[], col: number): number {
  let best = -1
  let bs = -1
  for (let i = 0; i < 25; i++) {
    if (marks[i] || (col >= 0 && colOf(i) !== col)) continue
    const s = cellScore(marks, i)
    if (s > bs) {
      bs = s
      best = i
    }
  }
  return best
}

/** whether a joker can still go somewhere: a column joker in a column with an unmarked cell, or any super */
const usable = (g: Game) => g.jokers.some((c) => [0, 1, 2, 3, 4].some((r) => !g.marks[c * 5 + r])) || (g.supers > 0 && g.marks.some((m) => !m))

/** jokers that can't go anywhere (their column is full) are dropped */
function dropDead(g: Game): Game {
  const jokers = g.jokers.filter((c) => [0, 1, 2, 3, 4].some((r) => !g.marks[c * 5 + r]))
  const supers = g.marks.some((m) => !m) ? g.supers : 0
  return jokers.length === g.jokers.length && supers === g.supers ? g : { ...g, jokers, supers }
}

/** the next joker's suggested cell (column jokers first), or -1 */
export function bestCell(g: Game): number {
  for (const c of g.jokers) {
    const i = suggest(g.marks, c)
    if (i >= 0) return i
  }
  return g.supers > 0 ? suggest(g.marks, -1) : -1
}

/** cells a waiting joker may go on now */
export function placeable(g: Game): Set<number> {
  const out = new Set<number>()
  for (let i = 0; i < 25; i++) if (!g.marks[i] && (g.jokers.includes(colOf(i)) || g.supers > 0)) out.add(i)
  return out
}

/** places a waiting joker on `cell`: a column joker of that column if there is one, else a Super Joker */
export function place(g: Game, cell: number): Game {
  if (g.done || g.marks[cell] || cell < 0 || cell > 24) throw new Error('not a free cell')
  const c = colOf(cell)
  const j = g.jokers.indexOf(c)
  if (j < 0 && g.supers <= 0) throw new Error('no joker for that cell')
  const marks = g.marks.slice()
  marks[cell] = true
  const next = j >= 0 ? { ...g, marks, jokers: g.jokers.filter((_, k) => k !== j) } : { ...g, marks, supers: g.supers - 1 }
  return dropDead(next)
}

/** places every waiting joker on its suggested cell */
export function autoPlace(g: Game): Game {
  let x = g
  while (x.jokers.length || x.supers) {
    const i = bestCell(x)
    if (i < 0) return { ...x, jokers: [], supers: 0 }
    x = place(x, i)
  }
  return x
}

/* ---------------- spins ---------------- */

/** a spin can be taken now (paid up or bought, and no joker waiting) */
export const canSpin = (g: Game) => !g.done && !g.jokers.length && !g.supers && (g.spins > 0 || g.extraReady)

function reelSym(c: number, card: readonly number[], withFree: boolean, rng: () => number): ReelSym {
  const total = 15 + W_JOKER + W_SUPER + (withFree ? W_FREE : 0)
  const x = rng() * total
  if (x < 15) {
    const n = 15 * c + 1 + Math.min(14, Math.floor(x))
    const at = card.indexOf(n)
    return { kind: 'num', n, cell: at >= 0 ? at : null }
  }
  if (x < 15 + W_JOKER) return { kind: 'joker' }
  if (x < 15 + W_JOKER + W_SUPER || !withFree) return { kind: 'super' }
  return { kind: 'free' }
}

/** spins the reels: numbers on the card are marked, jokers wait to be placed, free spins are added */
export function spin(g: Game, rng: () => number): Game {
  if (!canSpin(g)) throw new Error('no spin to take')
  const paidUp = g.spins > 0
  const reels = [0, 1, 2, 3, 4].map((c) => reelSym(c, g.card, paidUp, rng))
  const marks = g.marks.slice()
  const jokers: number[] = []
  let supers = 0
  let free = 0
  reels.forEach((r, c) => {
    if (r.kind === 'num' && r.cell !== null) marks[r.cell] = true
    else if (r.kind === 'joker') jokers.push(c)
    else if (r.kind === 'super') supers++
    else if (r.kind === 'free') free++
  })
  const next: Game = {
    ...g,
    marks,
    spins: paidUp ? g.spins - 1 + free : g.spins,
    freeWon: g.freeWon + free,
    extraReady: paidUp ? g.extraReady : false,
    spun: g.spun + 1,
    jokers,
    supers,
    last: reels,
  }
  return dropDead(next)
}

/** the game is waiting on the player to buy an extra spin or collect */
export const atExtras = (g: Game) => !g.done && g.spins === 0 && !g.extraReady && !g.jokers.length && !g.supers
export const extrasLeft = (g: Game) => MAX_EXTRA - g.extras

/* ---------------- the price of an extra spin ---------------- */

/**
 * The exact expected rise of the ladder (× the bet) over one more spin from this card, placing jokers the suggested
 * way. Each reel lands, out of 15 + W_JOKER + W_SUPER: one of its column's unmarked card numbers (weight 1 each), a
 * Joker, a Super Joker, or nothing new; every combination of the five reels is counted with its weight.
 */
export function extraValue(marks: readonly boolean[]): number {
  const total = 15 + W_JOKER + W_SUPER
  const now = valueOf(marks)
  // per column: [outcome, weight]; outcome: cell to mark, -1 joker, -2 super, -3 nothing
  const cols = [0, 1, 2, 3, 4].map((c) => {
    const free = [0, 1, 2, 3, 4].map((r) => c * 5 + r).filter((i) => !marks[i])
    const o: [number, number][] = free.map((i) => [i, 1])
    o.push([-1, W_JOKER], [-2, W_SUPER], [-3, 15 - free.length])
    return o
  })
  let sum = 0
  const pick = new Array<number>(5)
  const walk = (c: number, w: number) => {
    if (c === 5) {
      const m = marks.slice()
      let supers = 0
      const jokers: number[] = []
      for (let k = 0; k < 5; k++) {
        const o = pick[k]
        if (o >= 0) m[o] = true
        else if (o === -1) jokers.push(k)
        else if (o === -2) supers++
      }
      for (const k of jokers) {
        const i = suggest(m, k)
        if (i >= 0) m[i] = true
      }
      for (let s = 0; s < supers; s++) {
        const i = suggest(m, -1)
        if (i >= 0) m[i] = true
      }
      sum += w * valueOf(m)
      return
    }
    for (const [o, ow] of cols[c]) {
      if (ow <= 0) continue
      pick[c] = o
      walk(c + 1, w * ow)
    }
  }
  walk(0, 1)
  return sum / total ** 5 - now
}

/**
 * What the next extra spin costs, in coins (whole cents, rounded up, never under MIN_PRICE of the bet). `value` is
 * extraValue(g.marks), passed in when the caller has already worked it out (it is the slow part).
 */
export function extraPrice(g: Game, value = extraValue(g.marks)): number {
  const v = Math.max(MIN_PRICE, value / EXTRA_RTP)
  return Math.max(1, Math.ceil(v * g.bet * 100 - 1e-9)) / 100
}
/** whether the price floor (MIN_PRICE of the bet) sets the price rather than what the spin is worth */
export const atPriceFloor = (value: number) => value / EXTRA_RTP < MIN_PRICE

/** an extra spin is bought for `price` (taken from the balance by the caller) */
export function buyExtra(g: Game, price: number): Game {
  if (!atExtras(g) || g.extras >= MAX_EXTRA) throw new Error('no extra spin to buy')
  return { ...g, extras: g.extras + 1, extraPaid: round2(g.extraPaid + price), extraReady: true }
}

/** the game ends: it pays the ladder for its lines */
export function finish(g: Game): { game: Game; payout: number; lines: number } {
  const lines = linesOf(g.marks)
  return { game: { ...g, done: true }, payout: round2(g.bet * ladderPay(lines)), lines }
}

/** everything staked on this game: the bet and the extra spins */
export const staked = (g: Game) => round2(g.bet + g.extraPaid)

/** a saved game read back, or null if it isn't one */
export function parseGame(raw: unknown): Game | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Game>
  const nums = ['bet', 'spins', 'spun', 'freeWon', 'extras', 'extraPaid', 'supers'] as const
  if (nums.some((k) => typeof o[k] !== 'number' || !Number.isFinite(o[k]) || (o[k] as number) < 0)) return null
  if (!Array.isArray(o.card) || o.card.length !== 25 || !o.card.every((n, i) => Number.isInteger(n) && n >= 15 * colOf(i) + 1 && n <= 15 * colOf(i) + 15)) return null
  if (!Array.isArray(o.marks) || o.marks.length !== 25 || !o.marks.every((m) => typeof m === 'boolean')) return null
  if (!Array.isArray(o.jokers) || !o.jokers.every((c) => Number.isInteger(c) && c >= 0 && c < 5)) return null
  if (typeof o.extraReady !== 'boolean' || typeof o.done !== 'boolean') return null
  return { ...(o as Game), last: Array.isArray(o.last) ? o.last : null }
}

export { usable as jokersUsable }
