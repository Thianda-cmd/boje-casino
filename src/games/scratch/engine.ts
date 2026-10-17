import type { CardId } from './rules'
import { BONUS, CARD_H, CARD_W, CELL, GAP, GRID_X, GRID_Y, PANEL, cellRect } from './layout'
import { FOIL, brushes, foilRegions, foilTexture, raggedRect, regionPath, seeded } from './foil'

/*
  One card's foil: the painted texture, a mask of what has been scratched away, and the canvas that shows texture minus
  mask, with the cut edge of the foil catching the light along every scratch (plus a glint that follows the coin and a
  sheen that sweeps across now and then). Strokes are stamped along a smoothed path with the coin brushes, a stamp every
  few units, each at a random turn.

  What has been cleared is tracked on a 3-unit grid, worked out from the stamps (no pixel reads), per area: the nine
  cells (each measured over its middle, where the symbol is) and the bonus spot. An area that is 65% clear reveals
  itself: its leftover foil is cut out of the panel with a ragged edge and handed back as a loose piece for the card to
  fade away. When all nine cells are out, what is left of the panel goes the same way.

  The coin can also work by itself (Reveal all, autoplay): one area at a time, a few quick passes across each, lifting
  between them; the card decides the order (reveal.ts) and may ask for a slow, deliberate last cell.
*/

export const REVEAL_AT = 0.65
/** radius of the glint that follows the coin, in design units */
const GLINT = 70
const CG = 3
const COLS = Math.ceil(CARD_W / CG)
const ROWS = Math.ceil(CARD_H / CG)
/** area index of the bonus spot */
export const BONUS_AREA = 9
/** the panel's leftovers once every cell is out */
export const PANEL_AREA = 10
/** the coin's radius when it works by itself */
const AUTO_R = 24

export interface Piece {
  canvas: HTMLCanvasElement
  /** where it goes, in design units */
  x: number
  y: number
  w: number
  h: number
  area: number
}

export type Pt = { x: number; y: number }
/** where the self-working coin is (design units), lifted off the card or on it; null once it's put away */
export type CoinFn = (p: (Pt & { lifted: boolean }) | null) => void

export interface EngineHooks {
  /** an area passed the reveal mark (or was revealed): its loose piece of foil, to fade out */
  reveal: (area: number, piece: Piece | null) => void
  /** foil was torn off at (x, y) design units, moving at (vx, vy) units/s: n flakes' worth */
  flecks: (x: number, y: number, vx: number, vy: number, n: number) => void
}

export class ScratchEngine {
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private mask: HTMLCanvasElement
  private mctx: CanvasRenderingContext2D
  private texture: HTMLCanvasElement | null = null
  private k = 0
  private bonus: boolean
  private id: CardId
  private hooks: EngineHooks
  private cov = new Uint8Array(COLS * ROWS)
  /** which area each coverage cell counts toward: 0-8 cells, 9 bonus, -2 the panel between cells, -1 nothing */
  private owner = new Int8Array(COLS * ROWS).fill(-1)
  private total = new Array(11).fill(0)
  private clear = new Array(11).fill(0)
  readonly revealed = new Array(11).fill(false)
  private rnd = seeded((Math.random() * 1e9) | 0)
  /** what needs drawing again, in design units (the whole foil after a repaint, a sheen or a resize) */
  private dirtyAll = true
  private dirtyBox: [number, number, number, number] | null = null
  private raf = 0
  private glint: { x: number; y: number; a: number; r: number } | null = null
  private glintFade = 0
  private sheenAt = -1
  private nextSheen = performance.now() + 1600
  private alive = true
  /** motion of the stroke in progress */
  private last: { x: number; y: number; t: number } | null = null
  private mid: { x: number; y: number } | null = null
  private carry = 0
  /** the coin has touched the foil: sheens come less often */
  private scratched = false
  /** the coin is working by itself */
  private auto = false
  private r = 15
  /** units per ms, smoothed */
  speed = 0
  /** foil removed by the latest strokes, decaying (drives the scratch sound) */
  removing = 0

  constructor(id: CardId, bonus: boolean, hooks: EngineHooks) {
    this.id = id
    this.bonus = bonus
    this.hooks = hooks
    this.canvas = document.createElement('canvas')
    this.ctx = this.canvas.getContext('2d')!
    this.mask = document.createElement('canvas')
    this.mctx = this.mask.getContext('2d')!
    // what each coverage cell belongs to
    for (let gy = 0; gy < ROWS; gy++)
      for (let gx = 0; gx < COLS; gx++) {
        const x = (gx + 0.5) * CG
        const y = (gy + 0.5) * CG
        let o = -1
        if (x > PANEL.x && x < PANEL.x + PANEL.w && y > PANEL.y && y < PANEL.y + PANEL.h) {
          o = -2
          const c = Math.floor((x - GRID_X) / (CELL + GAP))
          const r = Math.floor((y - GRID_Y) / (CELL + GAP))
          if (c >= 0 && c < 3 && r >= 0 && r < 3) {
            const cr = cellRect(r * 3 + c)
            if (x > cr.x + 5 && x < cr.x + cr.w - 5 && y > cr.y + 5 && y < cr.y + cr.h - 5) o = r * 3 + c
          }
        } else if (bonus && Math.hypot(x - BONUS.cx, y - BONUS.cy) < BONUS.r - 4) o = BONUS_AREA
        this.owner[gy * COLS + gx] = o
        if (o >= 0) this.total[o]++
      }
    if (!bonus) this.revealed[BONUS_AREA] = true
  }

  get scale() {
    return this.k
  }

  /** false once disposed: nothing scratches, reveals or draws any more */
  get live() {
    return this.alive
  }

  /** k: real pixels per design unit. Repaints the texture and carries the scratches over. */
  setScale(k: number) {
    if (Math.abs(k - this.k) < 1e-3) return
    const W = Math.round(CARD_W * k)
    const H = Math.round(CARD_H * k)
    const old = this.k ? this.mask : null
    let keep: HTMLCanvasElement | null = null
    if (old) {
      keep = document.createElement('canvas')
      keep.width = old.width
      keep.height = old.height
      keep.getContext('2d')!.drawImage(old, 0, 0)
    }
    this.k = k
    this.canvas.width = W
    this.canvas.height = H
    this.mask.width = W
    this.mask.height = H
    if (keep) this.mctx.drawImage(keep, 0, 0, W, H)
    this.texture = foilTexture(this.id, k, this.bonus)
    this.dirtyAll = true
    this.kick()
  }

  /** repaints with fonts that have arrived since */
  repaint() {
    this.texture = foilTexture(this.id, this.k, this.bonus)
    this.dirtyAll = true
    this.kick()
  }

  /** marks a box (design units) to be drawn again on the next frame */
  private touch(x0: number, y0: number, x1: number, y1: number) {
    const b = this.dirtyBox
    this.dirtyBox = b ? [Math.min(b[0], x0), Math.min(b[1], y0), Math.max(b[2], x1), Math.max(b[3], y1)] : [x0, y0, x1, y1]
  }

  /* ---------------- scratching ---------------- */

  /** one stamp of the coin at (x, y) design units with radius r; returns how much new foil it took */
  private stamp(x: number, y: number, r: number) {
    const k = this.k
    if (!k) return 0
    const list = brushes(r * k)
    const b = list[Math.floor(this.rnd() * list.length)]
    const m = this.mctx
    m.setTransform(1, 0, 0, 1, x * k, y * k)
    m.rotate(this.rnd() * Math.PI * 2)
    m.drawImage(b, -b.width / 2, -b.height / 2)
    m.setTransform(1, 0, 0, 1, 0, 0)
    this.scratched = true
    this.touch(x - r * 1.4, y - r * 1.4, x + r * 1.4, y + r * 1.4 + 2)
    // coverage
    const re = r * 0.84
    const x0 = Math.max(0, Math.floor((x - re) / CG))
    const x1 = Math.min(COLS - 1, Math.floor((x + re) / CG))
    const y0 = Math.max(0, Math.floor((y - re) / CG))
    const y1 = Math.min(ROWS - 1, Math.floor((y + re) / CG))
    let fresh = 0
    const touched = new Set<number>()
    for (let gy = y0; gy <= y1; gy++)
      for (let gx = x0; gx <= x1; gx++) {
        const i = gy * COLS + gx
        if (this.cov[i]) continue
        const cx = (gx + 0.5) * CG - x
        const cy = (gy + 0.5) * CG - y
        if (cx * cx + cy * cy > re * re) continue
        const o = this.owner[i]
        if (o === -1) continue
        // foil already gone from a revealed area doesn't count as fresh
        const gone = (o >= 0 && this.revealed[o]) || (o === -2 && this.revealed[PANEL_AREA])
        this.cov[i] = 1
        if (gone) continue
        fresh++
        if (o >= 0) {
          this.clear[o]++
          touched.add(o)
        }
      }
    for (const o of touched) if (!this.revealed[o] && this.clear[o] >= this.total[o] * REVEAL_AT) this.reveal(o)
    return fresh
  }

  /** the pointer went down at (x, y) */
  down(x: number, y: number, r: number) {
    const t = performance.now()
    this.r = r
    this.last = { x, y, t }
    this.mid = { x, y }
    this.carry = 0
    const fresh = this.stamp(x, y, r)
    this.took(fresh, x, y, 0, 0)
    this.kick()
  }

  /** the pointer moved to (x, y): stamps along a smooth curve through the points so far */
  move(x: number, y: number, r: number, t = performance.now()) {
    const last = this.last
    if (!last || !this.mid) return this.down(x, y, r)
    this.r = r
    const dt = Math.max(1, t - last.t)
    const dist = Math.hypot(x - last.x, y - last.y)
    if (dist < 0.6) return
    const vx = ((x - last.x) / dt) * 1000
    const vy = ((y - last.y) / dt) * 1000
    this.speed = this.speed * 0.6 + (dist / dt) * 0.4
    // a quadratic from the last midpoint, through the last point as control, to the new midpoint
    const nm = { x: (last.x + x) / 2, y: (last.y + y) / 2 }
    const p0 = this.mid
    const len = Math.hypot(last.x - p0.x, last.y - p0.y) + Math.hypot(nm.x - last.x, nm.y - last.y)
    const step = Math.max(1.4, r * 0.26)
    let fresh = 0
    let s = this.carry
    for (; s <= len; s += step) {
      const u = len ? s / len : 1
      const a = (1 - u) * (1 - u)
      const b = 2 * (1 - u) * u
      const c = u * u
      fresh += this.stamp(a * p0.x + b * last.x + c * nm.x, a * p0.y + b * last.y + c * nm.y, r * (0.94 + this.rnd() * 0.1))
    }
    this.carry = s - len
    this.mid = nm
    this.last = { x, y, t }
    this.took(fresh, x, y, vx, vy)
    this.kick()
  }

  up() {
    const last = this.last
    const mid = this.mid
    if (last && mid) {
      // finish the curve: the half segment from the last midpoint to where the pointer let go
      const len = Math.hypot(last.x - mid.x, last.y - mid.y)
      const step = Math.max(1.4, this.r * 0.26)
      for (let s = this.carry; s <= len; s += step) {
        const u = len ? s / len : 1
        this.stamp(mid.x + (last.x - mid.x) * u, mid.y + (last.y - mid.y) * u, this.r)
      }
    }
    this.last = null
    this.mid = null
  }

  /** foil came off: the sound's drive, and flakes in proportion to the foil taken and the speed of the stroke */
  private took(fresh: number, x: number, y: number, vx: number, vy: number) {
    this.removing = Math.min(1, this.removing * 0.7 + Math.min(1, fresh / 26) * 0.6)
    if (fresh > 0) {
      const pace = Math.max(0.35, Math.min(1.7, this.speed / 0.7))
      const n = Math.min(5, Math.round((fresh / 14) * pace + this.rnd()))
      if (n > 0) this.hooks.flecks(x, y, vx, vy, n)
    }
  }

  /**
   * A glint follows the mouse over the card, and the coin while it scratches (a tighter one then, so each frame only
   * draws a little more than the stroke itself).
   */
  hover(x: number, y: number) {
    const g = this.glint
    if (g) this.touch(g.x - g.r, g.y - g.r, g.x + g.r, g.y + g.r)
    const r = this.last ? GLINT * 0.5 : GLINT
    this.glint = { x, y, a: 1, r }
    this.glintFade = 1
    this.touch(x - r, y - r, x + r, y + r)
    this.kick()
  }

  leave() {
    this.glintFade = -1
    this.kick()
  }

  /* ---------------- revealing ---------------- */

  /** cuts an area's leftover foil out of the panel and hands it over as a loose piece */
  reveal(area: number) {
    if (this.revealed[area]) return
    this.revealed[area] = true
    const k = this.k
    let piece: Piece | null = null
    if (k && this.texture) {
      // the shape of the hole
      let x: number, y: number, w: number, h: number
      const shape = (c: CanvasRenderingContext2D, ox: number, oy: number) => {
        if (area === BONUS_AREA) {
          c.beginPath()
          c.arc((BONUS.cx - ox) * k, (BONUS.cy - oy) * k, (BONUS.r + 2) * k, 0, Math.PI * 2)
        } else if (area === PANEL_AREA) {
          c.beginPath()
          regionPath(c, { kind: 'rect', x: PANEL.x - ox, y: PANEL.y - oy, w: PANEL.w, h: PANEL.h, r: PANEL.r }, k, 2)
        } else {
          const cr = cellRect(area)
          raggedRect(c, (cr.x - 3 - ox) * k, (cr.y - 3 - oy) * k, (cr.w + 6) * k, (cr.h + 6) * k, 9 * k, 2.4 * k, this.rnd)
        }
      }
      if (area === BONUS_AREA) [x, y, w, h] = [BONUS.cx - BONUS.r - 4, BONUS.cy - BONUS.r - 4, BONUS.r * 2 + 8, BONUS.r * 2 + 8]
      else if (area === PANEL_AREA) [x, y, w, h] = [PANEL.x - 4, PANEL.y - 4, PANEL.w + 8, PANEL.h + 8]
      else {
        const cr = cellRect(area)
        ;[x, y, w, h] = [cr.x - 6, cr.y - 6, cr.w + 12, cr.h + 12]
      }
      // the loose piece: what the foil looks like there right now, cut to the same shape
      this.composite()
      const pc = document.createElement('canvas')
      pc.width = Math.max(1, Math.round(w * k))
      pc.height = Math.max(1, Math.round(h * k))
      const p = pc.getContext('2d')!
      p.drawImage(this.canvas, x * k, y * k, w * k, h * k, 0, 0, pc.width, pc.height)
      p.globalCompositeOperation = 'destination-in'
      shape(p, x, y)
      p.fill()
      piece = { canvas: pc, x, y, w, h, area }
      const m = this.mctx
      m.fillStyle = '#fff'
      shape(m, 0, 0)
      m.fill()
      this.touch(x, y, x + w, y + h + 2)
      this.kick()
      // the foil inside the cut is gone: scratching there later tears nothing off
      const gx0 = Math.max(0, Math.floor(x / CG))
      const gx1 = Math.min(COLS - 1, Math.floor((x + w) / CG))
      const gy0 = Math.max(0, Math.floor(y / CG))
      const gy1 = Math.min(ROWS - 1, Math.floor((y + h) / CG))
      for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) this.cov[gy * COLS + gx] = 1
    }
    this.hooks.reveal(area, piece)
    // all nine cells out: the rest of the panel goes too
    if (area < 9 && !this.revealed[PANEL_AREA] && this.revealed.slice(0, 9).every(Boolean)) this.reveal(PANEL_AREA)
  }

  get gridDone() {
    return this.revealed.slice(0, 9).every(Boolean)
  }

  get done() {
    return this.gridDone && this.revealed[BONUS_AREA]
  }

  /** the nine cells, out or not */
  get cellsOut() {
    return this.revealed.slice(0, 9)
  }

  /* ---------------- the coin working by itself ---------------- */

  /** the coin's path over one area: quick passes back and forth (more and slower ones for a deciding cell) */
  private areaPath(area: number, from: Pt | null, deciding: boolean): Pt[] {
    const path: Pt[] = []
    const j = () => (this.rnd() - 0.5) * 5
    if (area === BONUS_AREA) {
      const turns = deciding ? 2.6 : 2.2
      const n = 22
      const a0 = from ? Math.atan2(from.y - BONUS.cy, from.x - BONUS.cx) : -Math.PI / 2
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI * turns
        const rr = 6 + (i / n) * 16
        path.push({ x: BONUS.cx + Math.cos(a) * rr, y: BONUS.cy + Math.sin(a) * rr })
      }
      return path
    }
    const c = cellRect(area)
    const passes = deciding ? 4 : 3
    const x0 = c.x + 14
    const x1 = c.x + c.w - 14
    // start on the side nearest the coin
    let dir = from && Math.abs(from.x - x1) < Math.abs(from.x - x0) ? -1 : 1
    const topFirst = !from || Math.abs(from.y - c.y) <= Math.abs(from.y - (c.y + c.h))
    for (let p = 0; p < passes; p++) {
      const q = topFirst ? p : passes - 1 - p
      const y = c.y + 22 + ((c.h - 44) * q) / Math.max(1, passes - 1)
      const n = 7
      for (let i = 0; i <= n; i++) {
        const t = i / n
        const x = dir > 0 ? x0 + (x1 - x0) * t : x1 - (x1 - x0) * t
        path.push({ x: x + j() * 0.4, y: y + Math.sin(t * Math.PI * 2 + p) * 4 + j() * 0.4 })
      }
      dir = -dir
    }
    return path
  }

  /** walks the coin along `path` at `speed` units per ms, scratching as it goes */
  private walk(path: Pt[], speed: number, coin: CoinFn): Promise<void> {
    const seg: number[] = [0]
    for (let i = 1; i < path.length; i++) seg.push(seg[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y))
    const total = seg[seg.length - 1]
    return new Promise((resolve) => {
      const t0 = performance.now()
      let i = 0
      let started = false
      const step = (now: number) => {
        if (!this.alive) return resolve()
        const d = Math.min(total, (now - t0) * speed)
        while (i < seg.length - 1 && seg[i + 1] < d) i++
        const a = path[i]
        const b = path[Math.min(path.length - 1, i + 1)]
        const u = seg[i + 1] > seg[i] ? (d - seg[i]) / (seg[i + 1] - seg[i]) : 1
        const x = a.x + (b.x - a.x) * Math.min(1, u)
        const y = a.y + (b.y - a.y) * Math.min(1, u)
        if (!started) {
          this.down(x, y, AUTO_R)
          started = true
        } else this.move(x, y, AUTO_R, now)
        this.hover(x, y)
        coin({ x, y, lifted: false })
        if (d < total) requestAnimationFrame(step)
        else {
          this.up()
          resolve()
        }
      }
      requestAnimationFrame(step)
    })
  }

  /** the coin lifts and glides to `to` over `ms` (no scratching) */
  private hop(from: Pt, to: Pt, ms: number, coin: CoinFn): Promise<void> {
    return new Promise((resolve) => {
      const t0 = performance.now()
      const step = (now: number) => {
        if (!this.alive) return resolve()
        const t = Math.min(1, (now - t0) / ms)
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
        coin({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, lifted: t < 0.92 })
        if (t < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
  }

  private coinAt: Pt | null = null

  /**
   * The coin scratches one area by itself, from wherever it is. `speed` is units per ms; a deciding cell gets more
   * passes. Resolves once the area is out.
   */
  async scratchArea(area: number, speed: number, coin: CoinFn, deciding = false) {
    if (!this.alive || this.revealed[area]) return
    this.auto = true
    const path = this.areaPath(area, this.coinAt, deciding)
    const from = this.coinAt ?? { x: path[0].x + 30, y: path[0].y - 50 }
    await this.hop(from, path[0], Math.max(60, Math.min(180, Math.hypot(path[0].x - from.x, path[0].y - from.y) / (speed * 1.3))), coin)
    await this.walk(path, speed, coin)
    this.coinAt = path[path.length - 1]
    // whatever the passes left of it comes off
    if (this.alive && !this.revealed[area]) this.reveal(area)
  }

  /** the self-working coin is done: it lifts off and goes away */
  park(coin: CoinFn) {
    this.auto = false
    this.coinAt = null
    this.leave()
    coin(null)
  }

  /** everything left comes off in a quick cascade, in the given order (Instant speed) */
  async cascade(order: number[], gap: number) {
    this.auto = true
    for (const a of order) {
      if (!this.alive) return
      if (this.revealed[a]) continue
      this.reveal(a)
      await new Promise((r) => setTimeout(r, gap))
    }
    this.auto = false
  }

  /** a card shown already finished (paid while away): no foil at all, and no events */
  clearAll() {
    this.revealed.fill(true)
    this.cov.fill(1)
    const m = this.mctx
    m.setTransform(1, 0, 0, 1, 0, 0)
    m.fillStyle = '#fff'
    m.fillRect(0, 0, this.mask.width, this.mask.height)
    this.dirtyAll = true
    this.kick()
  }

  /** reveals whatever is left at once */
  finish() {
    for (let a = 0; a < 9; a++) this.reveal(a)
    if (this.bonus) this.reveal(BONUS_AREA)
  }

  /* ---------------- drawing ---------------- */

  kick() {
    if (this.raf || !this.alive) return
    this.raf = requestAnimationFrame(this.frame)
  }

  private frame = (now: number) => {
    this.raf = 0
    if (!this.alive) return
    let again = false
    // a sheen sweeps across the foil every few seconds (less often once it has been scratched, never mid-stroke)
    const open = !this.revealed[PANEL_AREA] && !this.last && !this.auto
    if (this.sheenAt < 0 && now > this.nextSheen && open && !reduceMotion()) this.sheenAt = now
    if (this.sheenAt >= 0) {
      this.dirtyAll = true
      if (now - this.sheenAt > 1300) {
        this.sheenAt = -1
        this.nextSheen = now + (this.scratched ? 6500 + Math.random() * 3500 : 4200 + Math.random() * 2600)
      }
      again = true
    } else if (!this.revealed[PANEL_AREA]) {
      // wake up for the next sheen
      setTimeoutOnce(this, this.nextSheen - now)
    }
    if (this.glintFade < 0 && this.glint) {
      this.glint.a -= 0.08
      this.touch(this.glint.x - this.glint.r, this.glint.y - this.glint.r, this.glint.x + this.glint.r, this.glint.y + this.glint.r)
      if (this.glint.a <= 0) {
        this.glint = null
        this.glintFade = 0
      } else again = true
    }
    this.removing *= 0.86
    this.speed *= 0.9
    if (this.dirtyAll || this.dirtyBox) this.composite(now)
    if (again || this.removing > 0.02) this.kick()
  }

  /**
   * Texture, then the glint and the sheen on the metal only, then the scratches cut out, then the foil's cut edge lit
   * along the lower side of every scratch (the mask, shifted down a touch, drawn over the foil that is left). Only the
   * box that changed is drawn again (a stroke touches a few dozen units), clipped to the foil's own bounds.
   */
  composite(now = performance.now()) {
    const k = this.k
    const c = this.ctx
    if (!k || !this.texture) return
    const [fx0, fy0, fx1, fy1] = this.bounds
    let [x0, y0, x1, y1] = this.dirtyAll || !this.dirtyBox ? [0, 0, CARD_W, CARD_H] : this.dirtyBox
    this.dirtyAll = false
    this.dirtyBox = null
    x0 = Math.max(fx0, Math.floor(x0 * k) - 1)
    y0 = Math.max(fy0, Math.floor(y0 * k) - 1)
    x1 = Math.min(fx1, Math.ceil(x1 * k) + 1)
    y1 = Math.min(fy1, Math.ceil(y1 * k) + 1)
    if (x1 <= x0 || y1 <= y0) return
    c.save()
    c.beginPath()
    c.rect(x0, y0, x1 - x0, y1 - y0)
    c.clip()
    c.globalCompositeOperation = 'copy'
    c.drawImage(this.texture, 0, 0)
    c.globalCompositeOperation = 'source-atop'
    if (this.sheenAt >= 0) {
      const t = Math.min(1, (now - this.sheenAt) / 1300)
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2
      const span = (PANEL.w + PANEL.h) * 1.3
      const pos = -span * 0.25 + e * span
      const g = c.createLinearGradient((PANEL.x + pos - 60) * k, PANEL.y * k, (PANEL.x + pos + 60 - PANEL.h * 0.5) * k, (PANEL.y + PANEL.h) * k)
      g.addColorStop(0, 'rgba(255,255,255,0)')
      g.addColorStop(0.42, 'rgba(255,255,255,0)')
      g.addColorStop(0.5, FOIL[this.id].sheen)
      g.addColorStop(0.58, 'rgba(255,255,255,0)')
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    if (this.glint) {
      const g = c.createRadialGradient(this.glint.x * k, this.glint.y * k, 0, this.glint.x * k, this.glint.y * k, this.glint.r * k)
      g.addColorStop(0, `rgba(255,255,255,${0.3 * this.glint.a})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      c.fillStyle = g
      c.fillRect(x0, y0, x1 - x0, y1 - y0)
    }
    c.globalCompositeOperation = 'destination-out'
    c.drawImage(this.mask, 0, 0)
    // the cut edge: foil just below and right of a scratch faces the light
    if (this.scratched) {
      const d = Math.max(1, 0.85 * k)
      c.globalCompositeOperation = 'source-atop'
      c.globalAlpha = FOIL[this.id].edge
      c.drawImage(this.mask, d * 0.45, d)
      c.globalAlpha = 1
    }
    c.restore()
  }

  /** the foil's bounds in pixels: the panel, and the bonus spot above it when there is one */
  private get bounds(): [number, number, number, number] {
    const k = this.k
    const top = this.bonus ? Math.min(PANEL.y, BONUS.cy - BONUS.r) : PANEL.y
    return [Math.floor((PANEL.x - 3) * k), Math.floor((top - 3) * k), Math.ceil((PANEL.x + PANEL.w + 3) * k), Math.ceil((PANEL.y + PANEL.h + 3) * k)]
  }

  dispose() {
    this.alive = false
    cancelAnimationFrame(this.raf)
    clearTimeout(sheenTimers.get(this))
    sheenTimers.delete(this)
    // free the backing stores at once rather than waiting for the collector (the texture is shared through the
    // cache, so it is only let go of)
    this.canvas.width = this.canvas.height = 0
    this.mask.width = this.mask.height = 0
    this.texture = null
  }
}

const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const sheenTimers = new WeakMap<ScratchEngine, number>()
function setTimeoutOnce(e: ScratchEngine, ms: number) {
  if (sheenTimers.has(e)) return
  sheenTimers.set(
    e,
    window.setTimeout(() => {
      sheenTimers.delete(e)
      e.kick()
    }, Math.max(16, ms)),
  )
}

/** the foil regions, re-exported for the card */
export { foilRegions }
