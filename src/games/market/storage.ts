import { safeStorage } from '../../lib/storage'
import { LEVERAGES, LIQ, MOODS, type CloseReason, type Market, type Position, type Side } from './rules'

/*
  What Market Rush keeps on this device, and the records that keep its money safe while the price moves ten times a
  second.

  The market (its price, mood and tick) is one for the device: it carries on where it left off on the next visit,
  and only one page drives it at a time, its owner, named in the record with a heartbeat (the time of its last tick).
  The owner writes the market here on every tick, synchronously, before the tick is drawn: the screen never shows a
  price storage has not got. Another tab showing the game follows the owner's ticks read-only (the storage event)
  until the owner goes away (it frees the market as it leaves, or its heartbeat stops) or the player takes the market
  over there.

  The open positions of a page are its book, kept under a key of its own (the player's id and the page's), with the
  price they were last valued at: written as each one opens, on every tick that moves them, and as each one closes,
  always before the coins are paid. So the book in storage is exactly what is owed if the page dies: the next page to
  own the market finds a book whose heartbeat has stopped and pays it, once, at its stored price. While a page lives
  (hidden too) it beats its book every second, so a second tab leaves its positions alone; and before paying
  anything a page checks its book is still there, so a book another tab took (a long-hidden tab's heartbeat slows)
  is never paid twice.

  Also kept: the last few minutes of prices (for the chart on the next visit), the last trades, the player's
  choices (leverage, auto close, chart style), and a notice of positions closed as the page was left, which the next
  visit announces.
*/

const MARKET = 'lumen.market.state'
const HIST = 'lumen.market.hist'
const TRADES = 'lumen.market.trades'
const PREFS = 'lumen.market.prefs'
const NOTICE = 'lumen.market.notice'
const PROBE = 'lumen.market.probe'
/** a heartbeat younger than this means a page is still there */
export const LIVE_MS = 4000
/** prices kept for the chart (ticks) */
export const HIST_KEEP = 1800
export const MAX_TRADES = 30

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/** whether localStorage works at all (a private window may refuse it): without it a page is on its own */
export function storageWorks(): boolean {
  try {
    localStorage.setItem(PROBE, '1')
    localStorage.removeItem(PROBE)
    return true
  } catch {
    return false
  }
}

/* ---------------- the market ---------------- */

export interface MarketRecord extends Market {
  /** the page driving it, null when it was left free */
  owner: string | null
  /** the owner's heartbeat (ms) */
  at: number
}

export function readMarket(): MarketRecord | null {
  try {
    const r = JSON.parse(safeStorage.getItem(MARKET) ?? 'null') as MarketRecord | null
    if (!r || !finite(r.price) || !(r.price > 0) || !Number.isInteger(r.mood) || !MOODS[r.mood] || !Number.isInteger(r.tick) || r.tick < 0) return null
    return { price: r.price, mood: r.mood, tick: r.tick, owner: typeof r.owner === 'string' ? r.owner : null, at: finite(r.at) ? r.at : 0 }
  } catch {
    return null
  }
}
export const writeMarket = (r: MarketRecord) => safeStorage.setItem(MARKET, JSON.stringify(r))
export const MARKET_KEY = MARKET
/** whether a market record is free to take: left free, or its owner's heartbeat has stopped */
export const isFree = (r: MarketRecord | null, me: string, now = Date.now()) => !r || r.owner == null || r.owner === me || now - r.at > LIVE_MS

/** the chart's prices, the newest last, and the tick of the newest */
export interface Hist {
  tick: number
  prices: number[]
}
export function loadHist(): Hist | null {
  try {
    const h = JSON.parse(safeStorage.getItem(HIST) ?? 'null') as Hist | null
    if (!h || !Number.isInteger(h.tick) || !Array.isArray(h.prices) || !h.prices.length || !h.prices.every((p) => finite(p) && p > 0)) return null
    return { tick: h.tick, prices: h.prices.slice(-HIST_KEEP) }
  } catch {
    return null
  }
}
/** prices to 6 significant figures: the chart needs no more */
export const saveHist = (tick: number, prices: readonly number[]) => safeStorage.setSoon(HIST, JSON.stringify({ tick, prices: prices.slice(-HIST_KEEP).map((p) => Number(p.toPrecision(6))) }))

/* ---------------- a page's book of open positions ---------------- */

export interface Book {
  positions: Position[]
  /** the price (and tick) they were last valued at: what they are paid at if the page dies */
  price: number
  tick: number
  /** the page's heartbeat (ms) */
  at: number
}

const isSide = (s: unknown): s is Side => s === 'up' || s === 'down'
function cleanPosition(p: Position): Position | null {
  if (!p || typeof p.id !== 'string' || !isSide(p.side) || !(LEVERAGES as readonly number[]).includes(p.leverage) || !finite(p.stake) || !(p.stake > 0) || !finite(p.entry) || !(p.entry > 0)) return null
  return {
    id: p.id,
    side: p.side,
    leverage: p.leverage,
    stake: p.stake,
    entry: p.entry,
    at: finite(p.at) ? p.at : 0,
    tick: Number.isInteger(p.tick) ? p.tick : 0,
    takeProfit: finite(p.takeProfit) && p.takeProfit > 1 ? p.takeProfit : undefined,
    stopLoss: finite(p.stopLoss) && p.stopLoss > LIQ && p.stopLoss < 1 ? p.stopLoss : undefined,
  }
}

export const bookPrefix = (uid: string | null) => `lumen.market.open.${uid ?? 'guest'}.`
export const bookKey = (uid: string | null, tab: string) => bookPrefix(uid) + tab
export const saveBook = (key: string, b: Book) => safeStorage.setItem(key, JSON.stringify(b))
export const clearBook = (key: string) => safeStorage.removeItem(key)

/** whether the book stored under key was taken by another page: it is gone, from storage that works */
export function bookTaken(key: string): boolean {
  if (safeStorage.getItem(key) != null) return false
  return storageWorks()
}

/** the books under prefix (but not `mine`) whose page's heartbeat has stopped */
export function staleBooks(prefix: string, mine: string, now = Date.now()): string[] {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(prefix) && k !== mine) keys.push(k)
    }
  } catch {
    return []
  }
  return keys.filter((k) => {
    try {
      const at = (JSON.parse(safeStorage.getItem(k) ?? 'null') as Book | null)?.at
      return !finite(at) || now - at > LIVE_MS
    } catch {
      return true
    }
  })
}

/** a book a page left unpaid, removed as it is read so it can only be paid once */
export function takeBook(key: string): Book | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  try {
    const b = JSON.parse(raw) as Book
    if (!b || !finite(b.price) || !(b.price > 0) || !Array.isArray(b.positions)) return null
    return { positions: b.positions.map(cleanPosition).filter((p): p is Position => !!p), price: b.price, tick: Number.isInteger(b.tick) ? b.tick : 0, at: finite(b.at) ? b.at : 0 }
  } catch {
    return null
  }
}

/* ---------------- trades, choices, notices ---------------- */

/** a closed position, for the list of recent trades */
export interface Trade {
  id: string
  side: Side
  leverage: number
  stake: number
  payout: number
  reason: CloseReason
  /** when it closed (ms) */
  t: number
}
const REASONS: CloseReason[] = ['manual', 'liquidated', 'takeProfit', 'stopLoss', 'cap', 'left']
export function loadTrades(): Trade[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(TRADES) ?? '[]') as Trade[]
    if (!Array.isArray(raw)) return []
    return raw.filter((t) => t && typeof t.id === 'string' && isSide(t.side) && finite(t.leverage) && finite(t.stake) && t.stake > 0 && finite(t.payout) && REASONS.includes(t.reason) && finite(t.t)).slice(0, MAX_TRADES)
  } catch {
    return []
  }
}
export const saveTrades = (t: readonly Trade[]) => safeStorage.setSoon(TRADES, JSON.stringify(t.slice(0, MAX_TRADES)))

export type ChartStyle = 'line' | 'candles'
export interface Prefs {
  leverage: number
  tpOn: boolean
  tp: number
  slOn: boolean
  sl: number
  chart: ChartStyle
}
export const TP_RANGE = { min: 1.05, max: 1000 } as const
export const SL_RANGE = { min: Math.round((LIQ + 0.05) * 100) / 100, max: 0.95 } as const
export const DEFAULT_PREFS: Prefs = { leverage: 25, tpOn: false, tp: 2, slOn: false, sl: 0.5, chart: 'line' }
export function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(safeStorage.getItem(PREFS) ?? 'null') as Partial<Prefs> | null
    if (!p) return DEFAULT_PREFS
    const clamp = (v: unknown, lo: number, hi: number, d: number) => (finite(v) ? Math.min(hi, Math.max(lo, v)) : d)
    return {
      leverage: (LEVERAGES as readonly number[]).includes(p.leverage as number) ? (p.leverage as number) : DEFAULT_PREFS.leverage,
      tpOn: p.tpOn === true,
      tp: clamp(p.tp, TP_RANGE.min, TP_RANGE.max, DEFAULT_PREFS.tp),
      slOn: p.slOn === true,
      sl: clamp(p.sl, SL_RANGE.min, SL_RANGE.max, DEFAULT_PREFS.sl),
      chart: p.chart === 'candles' ? 'candles' : 'line',
    }
  } catch {
    return DEFAULT_PREFS
  }
}
export const savePrefs = (p: Prefs) => safeStorage.setSoon(PREFS, JSON.stringify(p))

/* Positions closed as the page was left: the next visit says what they came to. */
export interface Notice {
  count: number
  stake: number
  payout: number
}
function readNotice(raw: string | null): Notice | null {
  try {
    const n = JSON.parse(raw ?? 'null') as Notice | null
    return n && Number.isInteger(n.count) && n.count > 0 && finite(n.stake) && finite(n.payout) ? n : null
  } catch {
    return null
  }
}
/** adds positions closed on the way out to the notice the next visit shows (a page restored from the back-forward
 *  cache may leave twice before anyone reads it) */
export function addNotice(n: Notice) {
  const was = readNotice(safeStorage.getItem(NOTICE))
  safeStorage.setItem(NOTICE, JSON.stringify(was ? { count: was.count + n.count, stake: was.stake + n.stake, payout: was.payout + n.payout } : n))
}
export function takeNotice(): Notice | null {
  const raw = safeStorage.getItem(NOTICE)
  if (raw == null) return null
  safeStorage.removeItem(NOTICE)
  return readNotice(raw)
}
