import { create } from 'zustand'
import { round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { useWallet } from '../../store/wallet'
import { backfill } from './levels'
import { MOODS, START_PRICE, TICK_MS, autoClose, newMarket, payoutAt, step, type CloseReason, type Market, type Position, type Side } from './rules'
import {
  HIST_KEEP,
  LIVE_MS,
  MARKET_KEY,
  MAX_TRADES,
  addNotice,
  bookKey,
  bookPrefix,
  bookTaken,
  clearBook,
  isFree,
  loadHist,
  loadTrades,
  readMarket,
  saveBook,
  saveHist,
  saveTrades,
  staleBooks,
  storageWorks,
  takeBook,
  takeNotice,
  writeMarket,
  type MarketRecord,
  type Notice,
  type Trade,
} from './storage'

/*
  The trading desk: the live market and the player's positions on it, with every coin going in and out. It is plain
  code, not React: the page makes one, starts it when it mounts and stops it when it goes, and draws what it shows
  (the chart reads it every frame; the rest of the screen reads the `useView` store, which it updates).

  The market ticks every TICK_MS while the page is the market's owner and in view (a hidden page pauses it: its
  positions simply wait). Each tick, in this order: the next price is drawn; each position is checked against it
  (liquidated, the cap, take profit, stop loss); the new market and the book (the positions still open, at the new
  price) are written to storage; then the closed positions are paid; then the screen hears of the new price. So
  storage always has the price on screen, and a book is out of storage before its coins are paid.

  Opening takes the stake and writes the position into the book; closing takes it out of the book, then pays it at
  the price on screen. Leaving (pagehide, beforeunload, the page unmounting) closes everything at that price and pays
  it, with a notice for the next visit (or a toast, when the page only unmounts). A page that died is paid on a later
  visit: its book's heartbeat stops, and the next owner of the market pays it at the price stored with it.

  One page drives the market at a time (storage.ts). A second tab follows the owner's ticks and can take the market
  over; the page that loses it closes its positions where they were last valued (the price the new owner carries on
  from) and pays them. A book another page took is never paid again (bookTaken), and positions are only ever valued
  on ticks they saw: a market that moved on without them (in another tab) closes them at their last price, so no
  liquidation can be skipped.

  Dev builds only: window.__marketForce = { jump?: 0.03, drift?: 0.001, ticks?: 30, mood?: 2, hold?: 50 } bends the
  next ticks (a one-off jump, a drift each tick for `ticks` ticks, a mood, the price held still for `hold` ticks), and
  window.__market is the desk.
*/

/** the most positions open at once */
export const MAX_OPEN = 5
/** a market that has wandered outside this range starts again at START_PRICE, when no position is open */
export const PRICE_RANGE = [100, 10_000] as const

export type Role = 'owner' | 'viewer' | 'idle'

/** a position closed, at the price and tick it closed at */
export interface Closed {
  pos: Position
  reason: CloseReason
  payout: number
  price: number
  tick: number
  /** paid on a later visit: its page died */
  recovered?: boolean
}

export type DeskEvent =
  | { kind: 'open'; pos: Position }
  /** closed by a tick or by the player, and paid */
  | { kind: 'close'; closed: Closed[] }
  | { kind: 'mood'; from: number; to: number }
  /** the market went to another tab: these closed where they were, and were paid */
  | { kind: 'lost'; closed: Closed[] }
  /** positions another page already paid */
  | { kind: 'taken'; count: number }
  /** a dead page's positions, paid now */
  | { kind: 'recovered'; closed: Closed[] }
  /** positions closed as the page was left, announced on this visit */
  | { kind: 'notice'; notice: Notice }

/** an exit on the chart */
export interface Mark {
  tick: number
  price: number
  side: Side
  mult: number
  reason: CloseReason
}

/** a burst on the chart: a liquidation, a big close */
export interface Fx {
  kind: 'liq' | 'win'
  tick: number
  price: number
  t0: number
}

/** what the screen shows, in a store so each part re-renders only for what it reads */
export interface View {
  price: number
  /** the price a tick before */
  prev: number
  /** the price a minute of ticks before (or the oldest kept), for the change */
  ref: number
  mood: number
  tick: number
  positions: readonly Position[]
  role: Role
  trades: readonly Trade[]
}
export const useView = create<View>(() => ({ price: START_PRICE, prev: START_PRICE, ref: START_PRICE, mood: 1, tick: 0, positions: [], role: 'idle', trades: [] }))

interface Force {
  jump?: number
  drift?: number
  ticks?: number
  mood?: number
  /** the price stays put for this many ticks (the money audit's fixed price) */
  hold?: number
}

/** dev builds only: the market as the dev hook bends it */
function forced(was: Market, m: Market): Market {
  const w = window as unknown as { __marketForce?: Force | null }
  const f = w.__marketForce
  if (!f) return m
  if ((f.hold ?? 0) > 0) {
    f.hold = (f.hold ?? 1) - 1
    return { price: was.price, mood: was.mood, tick: m.tick }
  }
  let { price, mood } = m
  if (typeof f.mood === 'number' && MOODS[f.mood]) {
    mood = f.mood
    f.mood = undefined
  }
  if (typeof f.jump === 'number') {
    price *= 1 + f.jump
    f.jump = undefined
  }
  if (typeof f.drift === 'number' && (f.ticks ?? 0) > 0) {
    price *= 1 + f.drift
    f.ticks = (f.ticks ?? 1) - 1
  }
  if (f.mood === undefined && f.jump === undefined && !((f.ticks ?? 0) > 0)) delete w.__marketForce
  return { ...m, price, mood }
}

/** the chart behind a market: the stored one if it reaches the market's tick (topped up to a minute), else a made-up one */
function chartFor(m: Market): number[] {
  const h = loadHist()
  const prices = h && h.tick === m.tick && h.prices[h.prices.length - 1] === Number(m.price.toPrecision(6)) ? [...h.prices.slice(0, -1), m.price] : [m.price]
  return prices.length >= 600 ? prices : [...backfill(prices[0], m.mood, 901 - prices.length).slice(0, -1), ...prices]
}

const sum = (cs: readonly Closed[], f: (c: Closed) => number) => round2(cs.reduce((a, c) => a + f(c), 0))
export const noticeOf = (cs: readonly Closed[]): Notice => ({ count: cs.length, stake: sum(cs, (c) => c.pos.stake), payout: sum(cs, (c) => c.payout) })

export class Desk {
  /** this page, among the pages that might share the market */
  readonly tab = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  readonly key: string
  private readonly prefix: string
  market: Market
  positions: Position[] = []
  role: Role = 'idle'
  /** the chart's prices, the newest last; `last` is the tick of the newest */
  prices: number[]
  last: number
  /** when the newest price arrived (performance.now()), for the chart's glide into it */
  arrived = 0
  marks: Mark[] = []
  fx: Fx[] = []
  /** the position whose card the pointer is over (the chart draws its lines bold; otherwise the newest's) */
  hover: string | null = null
  trades: Trade[]
  onEvent: (e: DeskEvent) => void = () => {}

  private timer = 0
  private on = false
  /** sign-in has settled: books are paid into the wallet that took their stakes */
  private ready = false
  /** no storage at all: the page is on its own */
  private solo = false
  private beatAt = 0
  private claimAt = 0
  private scanAt = 0
  /** when the page last began to leave: a reload keeps the old page running a moment, and it must not take the
   *  market back in that moment (the new page would find it owned) */
  private leftAt = -Infinity

  constructor(uid: string | null) {
    this.key = bookKey(uid, this.tab)
    this.prefix = bookPrefix(uid)
    const r = readMarket()
    this.market = r ? { price: r.price, mood: r.mood, tick: r.tick } : newMarket()
    this.prices = chartFor(this.market)
    this.last = this.market.tick
    this.trades = loadTrades()
  }

  /* ---------------- life ---------------- */

  start() {
    if (this.on) return
    this.on = true
    this.solo = !storageWorks()
    window.addEventListener('storage', this.onStorage)
    window.addEventListener('beforeunload', this.onHide)
    window.addEventListener('pagehide', this.onHide)
    window.addEventListener('pageshow', this.onShow)
    document.addEventListener('visibilitychange', this.onVisible)
    this.timer = window.setInterval(this.loop, TICK_MS)
    if (import.meta.env.DEV) (window as unknown as { __market?: Desk }).__market = this
    if (!document.hidden) this.claim(false)
    this.publish()
  }

  /** the page is going (it unmounts): everything open is closed and paid; returns what was */
  stop(): Closed[] {
    if (!this.on) return []
    this.on = false
    clearInterval(this.timer)
    window.removeEventListener('storage', this.onStorage)
    window.removeEventListener('beforeunload', this.onHide)
    window.removeEventListener('pagehide', this.onHide)
    window.removeEventListener('pageshow', this.onShow)
    document.removeEventListener('visibilitychange', this.onVisible)
    if (import.meta.env.DEV) {
      const w = window as unknown as { __market?: Desk }
      if (w.__market === this) delete w.__market
    }
    return this.leave()
  }

  /** sign-in has settled: a notice from the last visit is announced, and a dead page's positions can be paid */
  setReady() {
    if (this.ready) return
    this.ready = true
    const n = takeNotice()
    if (n) this.onEvent({ kind: 'notice', notice: n })
    if (this.role === 'owner') this.recover()
  }

  /** the player takes the market over from another tab */
  takeOver() {
    if (document.hidden) return
    this.claim(true)
  }

  private loop = () => {
    const now = Date.now()
    if (document.hidden) return this.beat(now)
    if (performance.now() - this.leftAt < 1500) return
    if (this.role === 'owner') this.tick(now)
    else if (now - this.claimAt > 300) {
      this.claimAt = now
      this.claim(false)
    }
    if (this.role === 'owner' && this.ready && now - this.scanAt > 2000) {
      this.scanAt = now
      this.recover()
    }
  }

  private onHide = () => {
    this.leftAt = performance.now()
    const closed = this.leave()
    if (closed.length) addNotice(noticeOf(closed))
  }

  // back from the back-forward cache: what was closed on the way out is announced here and now
  private onShow = (e: PageTransitionEvent) => {
    if (!e.persisted || !this.on) return
    this.leftAt = -Infinity
    const n = takeNotice()
    if (n) this.onEvent({ kind: 'notice', notice: n })
    if (!document.hidden) this.claim(false)
  }

  private onVisible = () => {
    if (document.hidden) return
    // back in view: carry on (or find the market has moved to another tab)
    if (this.role === 'owner') this.tick(Date.now())
    else this.claim(false)
  }

  private onStorage = (e: StorageEvent) => {
    if (e.key !== MARKET_KEY) return
    const r = readMarket()
    if (!r) return
    if (this.role === 'owner') {
      // another tab took the market over
      if (r.owner && r.owner !== this.tab) this.lose(r)
    } else if (r.owner !== this.tab) this.follow(r)
  }

  /* ---------------- the market ---------------- */

  /** takes the market if it is free (or `force`), else watches it */
  private claim(force: boolean) {
    if (!this.on) return
    if (this.solo) {
      if (this.role !== 'owner') this.setRole('owner')
      return
    }
    const r = readMarket()
    const now = Date.now()
    if (!force && !isFree(r, this.tab, now)) {
      if (this.role !== 'viewer') this.setRole('viewer')
      if (r) this.follow(r)
      return
    }
    let m: Market = r ? { price: r.price, mood: r.mood, tick: r.tick } : this.market
    // positions are only good on the ticks they saw: a market that moved on without them closes them where they were
    if (this.positions.length && m.tick !== this.market.tick) {
      const closed = this.closeAll('left')
      if (closed.length) this.onEvent({ kind: 'lost', closed })
    }
    if (!this.positions.length && (m.price < PRICE_RANGE[0] || m.price > PRICE_RANGE[1])) m = newMarket()
    writeMarket({ ...m, owner: this.tab, at: now })
    this.adopt(m)
    this.setRole('owner')
  }

  /** the market went to another tab: what is open closes where it was last valued, and this page watches */
  private lose(r: MarketRecord) {
    const closed = this.closeAll('left')
    this.setRole('viewer')
    this.follow(r)
    if (closed.length) this.onEvent({ kind: 'lost', closed })
  }

  /** a tick of the market another tab drives */
  private follow(r: MarketRecord) {
    if (r.tick !== this.market.tick || r.price !== this.market.price || r.mood !== this.market.mood) this.adopt({ price: r.price, mood: r.mood, tick: r.tick })
  }

  /** the market as it now is, onto the chart and the screen */
  private adopt(m: Market) {
    const was = this.market.mood
    if (m.tick === this.last + 1) this.prices.push(m.price)
    else if (m.tick !== this.last || m.price !== this.prices[this.prices.length - 1]) {
      // a jump (another tab's ticks, a fresh market): the stored chart if it reaches this tick, else a new one
      this.prices = chartFor(m)
      this.marks = []
    }
    if (this.prices.length > HIST_KEEP + 600) this.prices = this.prices.slice(-HIST_KEEP)
    this.last = m.tick
    this.market = m
    this.arrived = performance.now()
    this.publish()
    if (m.mood !== was) this.onEvent({ kind: 'mood', from: was, to: m.mood })
  }

  private tick(now: number) {
    if (!this.solo) {
      const r = readMarket()
      if (!r || r.owner !== this.tab || r.tick !== this.market.tick) {
        if (r && r.owner && r.owner !== this.tab && now - r.at <= LIVE_MS) return this.lose(r)
        return this.claim(false)
      }
      if (this.positions.length && bookTaken(this.key)) this.abandon()
    }
    let m = step(this.market, rand)
    if (import.meta.env.DEV) m = forced(this.market, m)
    const price = m.price
    const keep: Position[] = []
    const closing: Closed[] = []
    for (const p of this.positions) {
      const why = autoClose(p, price)
      if (why) closing.push({ pos: p, reason: why, payout: payoutAt(p, price, why), price, tick: m.tick })
      else keep.push(p)
    }
    // the new price, and the book at it, are in storage before anything is shown or paid
    if (!this.solo) {
      writeMarket({ ...m, owner: this.tab, at: now })
      if (this.positions.length) {
        if (keep.length) saveBook(this.key, { positions: keep, price, tick: m.tick, at: now })
        else clearBook(this.key)
        this.beatAt = now
      }
      if (m.tick % 10 === 0) saveHist(m.tick, this.prices.concat(price))
    }
    this.positions = keep
    if (closing.length) {
      this.pay(closing)
      this.onEvent({ kind: 'close', closed: closing })
    }
    this.adopt(m)
  }

  /* ---------------- positions ---------------- */

  /** opens a position at the price on screen; `take` takes the stake (false: it could not be) */
  open(o: { side: Side; stake: number; leverage: number; takeProfit?: number; stopLoss?: number }, take: (amount: number) => boolean): Position | null {
    if (!this.on || this.role !== 'owner' || document.hidden || this.positions.length >= MAX_OPEN) return null
    if (this.positions.length && !this.solo && bookTaken(this.key)) this.abandon()
    if (!take(o.stake)) return null
    const now = Date.now()
    const p: Position = {
      id: now.toString(36) + Math.random().toString(36).slice(2, 6),
      side: o.side,
      leverage: o.leverage,
      stake: o.stake,
      entry: this.market.price,
      at: now,
      tick: this.market.tick,
      takeProfit: o.takeProfit,
      stopLoss: o.stopLoss,
    }
    this.positions = [...this.positions, p]
    if (!this.solo) saveBook(this.key, { positions: this.positions, price: this.market.price, tick: this.market.tick, at: now })
    this.beatAt = now
    this.onEvent({ kind: 'open', pos: p })
    this.publish()
    return p
  }

  /** closes one position at the price on screen, and pays it */
  close(id: string): Closed | null {
    const p = this.positions.find((x) => x.id === id)
    if (!p) return null
    if (!this.solo && bookTaken(this.key)) {
      this.abandon()
      return null
    }
    const price = this.market.price
    const reason = autoClose(p, price) === 'liquidated' ? 'liquidated' : 'manual'
    const c: Closed = { pos: p, reason, payout: payoutAt(p, price, reason), price, tick: this.market.tick }
    const keep = this.positions.filter((x) => x !== p)
    if (!this.solo) {
      if (keep.length) saveBook(this.key, { positions: keep, price, tick: this.market.tick, at: Date.now() })
      else clearBook(this.key)
    }
    this.positions = keep
    this.pay([c])
    this.onEvent({ kind: 'close', closed: [c] })
    this.publish()
    return c
  }

  /** closes every position (the player's Close all) */
  closeEvery(): Closed[] {
    const closed = this.closeAll('manual')
    if (closed.length) this.onEvent({ kind: 'close', closed })
    return closed
  }

  /** closes everything at the price on screen (each at its own reason should that price have closed it anyway) */
  private closeAll(reason: CloseReason): Closed[] {
    if (!this.positions.length) return []
    const { price, tick } = this.market
    const closing = this.positions.map((p): Closed => {
      const why = autoClose(p, price) === 'liquidated' ? 'liquidated' : reason
      return { pos: p, reason: why, payout: payoutAt(p, price, why), price, tick }
    })
    if (!this.solo && bookTaken(this.key)) {
      this.abandon()
      return []
    }
    if (!this.solo) clearBook(this.key)
    this.positions = []
    this.pay(closing)
    this.publish()
    return closing
  }

  /** the book is gone from storage: another page paid it */
  private abandon() {
    const n = this.positions.length
    this.positions = []
    this.publish()
    if (n) this.onEvent({ kind: 'taken', count: n })
  }

  /** pays closed positions, each its own round; and onto the chart and the trade list */
  private pay(cs: readonly Closed[]) {
    const w = useWallet.getState()
    const now = Date.now()
    for (const c of cs) {
      const mult = round2(c.payout / c.pos.stake)
      w.settle({ game: 'market', bet: c.pos.stake, payout: c.payout, meta: { side: c.pos.side, leverage: c.pos.leverage, mult, reason: c.reason, ...(c.recovered ? { recovered: true } : {}) } })
      this.trades = [{ id: c.pos.id, side: c.pos.side, leverage: c.pos.leverage, stake: c.pos.stake, payout: c.payout, reason: c.reason, t: now }, ...this.trades]
      if (!c.recovered) {
        this.marks.push({ tick: c.tick, price: c.price, side: c.pos.side, mult, reason: c.reason })
        if (c.reason === 'liquidated' || mult >= 3) this.fx.push({ kind: c.reason === 'liquidated' ? 'liq' : 'win', tick: c.tick, price: c.price, t0: performance.now() })
      }
      if (this.hover === c.pos.id) this.hover = null
    }
    this.trades = this.trades.slice(0, MAX_TRADES)
    if (this.marks.length > 24) this.marks = this.marks.slice(-24)
    saveTrades(this.trades)
  }

  /** a dead page's books: taken (so only once) and paid at the price stored with them */
  private recover() {
    if (this.solo) return
    for (const k of staleBooks(this.prefix, this.key)) {
      const b = takeBook(k)
      if (!b || !b.positions.length) continue
      const closed = b.positions.map((p): Closed => {
        const why = autoClose(p, b.price) === 'liquidated' ? 'liquidated' : 'left'
        return { pos: p, reason: why, payout: payoutAt(p, b.price, why), price: b.price, tick: b.tick, recovered: true }
      })
      this.pay(closed)
      this.publish()
      this.onEvent({ kind: 'recovered', closed })
    }
  }

  /** a hidden page's heartbeat: its book stays its own while it waits */
  private beat(now: number) {
    if (!this.positions.length || this.solo || now - this.beatAt < 900) return
    this.beatAt = now
    if (bookTaken(this.key)) return this.abandon()
    saveBook(this.key, { positions: this.positions, price: this.market.price, tick: this.market.tick, at: now })
  }

  /** the page is going: everything closes at the price on screen and is paid, the chart is kept, the market freed */
  private leave(): Closed[] {
    const closed = this.closeAll('left')
    if (!this.solo && this.role === 'owner') {
      saveHist(this.last, this.prices)
      const r = readMarket()
      if (!r || r.owner === this.tab) writeMarket({ ...this.market, owner: null, at: Date.now() })
    }
    this.setRole('idle')
    return closed
  }

  /* ---------------- the screen ---------------- */

  private setRole(r: Role) {
    if (this.role === r) return
    this.role = r
    this.publish()
  }

  private publish() {
    const n = this.prices.length
    useView.setState({
      price: this.market.price,
      prev: n > 1 ? this.prices[n - 2] : this.market.price,
      ref: this.prices[Math.max(0, n - 601)],
      mood: this.market.mood,
      tick: this.market.tick,
      positions: this.positions,
      role: this.role,
      trades: this.trades,
    })
  }
}
