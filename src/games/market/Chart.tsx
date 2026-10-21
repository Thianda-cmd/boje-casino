import { useEffect, useRef } from 'react'
import { fmt } from '../../lib/format'
import { useSize } from '../../lib/useSize'
import { TICK_MS, liqPrice, marginOf, valueAt, type Position } from './rules'
import { priceAtMult } from './levels'
import type { Desk, Fx } from './desk'
import type { ChartStyle } from './storage'

/*
  The live chart, drawn on a canvas every frame from the desk (desk.ts): the price as a glowing line over a soft
  fill, or as one-second candles; the grid with the price scale in a gutter on the right and clock times along the
  foot; the newest price as a pulsing head with its tag in the gutter; and each open position on it: its entry line
  with a live P&L tag, the band between entry and price, its liquidation line (red, dashed) and its take profit and
  stop loss lines, pinned to the edge with an arrow when they lie off the chart. Exits stay marked where they
  happened; a liquidation bursts red, a big close gold.

  Smoothness: ticks come ten times a second, frames sixty. The chart scrolls continuously (the newest tick slides in
  over TICK_MS) and the head glides from the last price to the new one, so it never steps. The y scale eases toward
  the range in view. The price printed in the tag is always the price the desk has stored: only the drawing glides.

  Crisp on any screen: the canvas is sized in device pixels (capped at 2×).
*/

const UP = '#22d36f'
const DOWN = '#ff4d61'
const LINE = '#00d1a0'
const LINE_HI = '#8cffe4'
const GOLD = '#f7c548'
const FONT = 'Manrope, system-ui, sans-serif'

function niceStep(x: number) {
  const p = 10 ** Math.floor(Math.log10(x))
  const m = x / p
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

const clock = (ms: number) => {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

interface Spark {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  size: number
  color: string
}

export function Chart({ desk, style, compact }: { desk: Desk; style: ChartStyle; compact: boolean }) {
  const [box, size] = useSize<HTMLDivElement>({ w: 0, h: 0 })
  const cv = useRef<HTMLCanvasElement>(null)
  const styleRef = useRef(style)
  styleRef.current = style

  useEffect(() => {
    const W = size.w
    const H = size.h
    if (W < 10 || H < 10) return
    const c = cv.current!
    const ctx = c.getContext('2d')!
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(W * dpr)
    c.height = Math.round(H * dpr)
    let raf = 0
    let last = performance.now()
    let lo = NaN
    let hi = NaN
    let wild = desk.market.mood === 2 ? 1 : 0
    let sparks: Spark[] = []
    const seen = new WeakSet<Fx>()

    const gutter = compact ? 60 : 78
    const padT = compact ? 12 : 18
    const padB = compact ? 22 : 26
    const plotR = W - gutter
    const headX = plotR - (compact ? 26 : 44)
    const plotB = H - padB
    const visible = Math.max(180, Math.min(720, Math.round(headX / (compact ? 1.2 : 1.55))))
    const ppt = headX / visible

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const prices = desk.prices
      const n = prices.length
      const lastTick = desk.last
      const f = Math.max(0, Math.min(1, (now - desk.arrived) / TICK_MS))
      const ease = 1 - (1 - f) * (1 - f)
      const pCur = prices[n - 1]
      const pPrev = n > 1 ? prices[n - 2] : pCur
      const headTick = n > 1 ? lastTick - 1 + f : lastTick
      const headP = pPrev + (pCur - pPrev) * ease
      const X = (t: number) => headX - (headTick - t) * ppt
      const firstTick = headTick - visible - 12
      const i0 = Math.max(0, n - 1 - Math.ceil(lastTick - firstTick))
      const tickAt = (i: number) => lastTick - (n - 1 - i)
      const positions = desk.positions
      const focus = positions.some((p) => p.id === desk.hover) ? desk.hover : positions.length ? positions[positions.length - 1].id : null

      // the range in view: the prices, every entry, and the focused position's lines when they are near
      let tLo = headP
      let tHi = headP
      for (let i = i0; i < n - 1; i++) {
        const p = prices[i]
        if (p < tLo) tLo = p
        if (p > tHi) tHi = p
      }
      for (const p of positions) {
        tLo = Math.min(tLo, p.entry)
        tHi = Math.max(tHi, p.entry)
      }
      const minSpan = pCur * (compact ? 0.0022 : 0.0018)
      let span = Math.max(minSpan, tHi - tLo)
      const near = (v: number) => v > tLo - span * 0.7 && v < tHi + span * 0.7
      for (const p of positions) {
        if (p.id !== focus) continue
        for (const v of lines(p)) if (near(v.price)) ((tLo = Math.min(tLo, v.price)), (tHi = Math.max(tHi, v.price)))
      }
      span = Math.max(minSpan, tHi - tLo)
      if (tHi - tLo < minSpan) {
        const mid = (tHi + tLo) / 2
        tLo = mid - minSpan / 2
        tHi = mid + minSpan / 2
      }
      tLo -= span * 0.16
      tHi += span * 0.16
      if (!Number.isFinite(lo) || Math.abs(tLo - lo) > span * 6 || Math.abs(tHi - hi) > span * 6) {
        lo = tLo
        hi = tHi
      } else {
        const k = 1 - Math.exp(-dt * 4.5)
        lo += (tLo - lo) * k
        hi += (tHi - hi) * k
      }
      const Y = (p: number) => plotB - ((p - lo) / (hi - lo)) * (plotB - padT)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      // a wild market warms the edges
      wild += ((desk.market.mood === 2 ? 1 : 0) - wild) * (1 - Math.exp(-dt * 2))
      if (wild > 0.01) {
        const pulse = 0.75 + 0.25 * Math.sin(now / 380)
        const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75)
        g.addColorStop(0, 'rgba(255,90,40,0)')
        g.addColorStop(1, `rgba(255,90,40,${0.16 * wild * pulse})`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, W, H)
      }

      // the grid: prices across, clock times along the foot
      const step = niceStep((hi - lo) / (compact ? 4 : 6))
      const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
      const tagY = Math.max(padT + 2, Math.min(plotB - 2, Y(headP)))
      ctx.font = `700 ${compact ? 10 : 11}px ${FONT}`
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.lineWidth = 1
      for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
        const y = Math.round(Y(v)) + 0.5
        if (y < padT - 4 || y > plotB + 4) continue
        ctx.strokeStyle = 'rgba(160,200,230,.07)'
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(plotR, y)
        ctx.stroke()
        if (Math.abs(y - tagY) < 15) continue
        ctx.fillStyle = 'rgba(170,195,215,.5)'
        ctx.fillText(fmt(v, digits), plotR + (compact ? 7 : 10), y)
      }
      ctx.textAlign = 'center'
      const every = compact ? 150 : 100
      const wall = Date.now()
      for (let t = Math.ceil(firstTick / every) * every; t <= headTick; t += every) {
        const x = Math.round(X(t)) + 0.5
        if (x < 24 || x > plotR - 10) continue
        ctx.strokeStyle = 'rgba(160,200,230,.05)'
        ctx.beginPath()
        ctx.moveTo(x, padT)
        ctx.lineTo(x, plotB)
        ctx.stroke()
        ctx.fillStyle = 'rgba(170,195,215,.38)'
        ctx.fillText(clock(wall - (headTick - t) * TICK_MS + 500), x, plotB + padB / 2 + 1)
      }
      // the gutter's edge
      ctx.strokeStyle = 'rgba(160,200,230,.08)'
      ctx.beginPath()
      ctx.moveTo(plotR + 0.5, 0)
      ctx.lineTo(plotR + 0.5, H)
      ctx.stroke()

      // each position's band, from its entry to the price: green while it is up, red while it is down
      const cur = pCur
      for (const p of positions) {
        if (p.id !== focus) continue
        const up = valueAt(p, cur) >= marginOf(p.stake)
        const x0 = Math.max(0, X(p.tick))
        const ya = Y(p.entry)
        const yb = Y(headP)
        const g = ctx.createLinearGradient(x0, 0, headX, 0)
        g.addColorStop(0, up ? 'rgba(34,211,111,0)' : 'rgba(255,77,97,0)')
        g.addColorStop(1, up ? 'rgba(34,211,111,.16)' : 'rgba(255,77,97,.16)')
        ctx.fillStyle = g
        ctx.fillRect(x0, Math.min(ya, yb), headX - x0, Math.abs(yb - ya))
      }

      // the price
      if (styleRef.current === 'candles') drawCandles()
      else drawLine()

      function drawLine() {
        const path = new Path2D()
        let started = false
        let minY = Y(headP)
        for (let i = i0; i < n - 1; i++) {
          const x = X(tickAt(i))
          const y = Y(prices[i])
          if (y < minY) minY = y
          if (!started) {
            path.moveTo(x, y)
            started = true
          } else path.lineTo(x, y)
        }
        const hx = X(headTick)
        const hy = Y(headP)
        if (!started) path.moveTo(hx, hy)
        else path.lineTo(hx, hy)
        const x0 = n > 1 ? X(tickAt(i0)) : hx
        // the fill under it
        const fill = new Path2D(path)
        fill.lineTo(hx, plotB)
        fill.lineTo(x0, plotB)
        fill.closePath()
        const g = ctx.createLinearGradient(0, minY, 0, plotB)
        g.addColorStop(0, 'rgba(0,209,160,.26)')
        g.addColorStop(0.6, 'rgba(0,209,160,.06)')
        g.addColorStop(1, 'rgba(0,209,160,0)')
        ctx.fillStyle = g
        ctx.fill(fill)
        // the glow is wide see-through strokes under the line (a shadow blur on a long path is far slower)
        ctx.lineJoin = 'round'
        ctx.lineCap = 'round'
        ctx.strokeStyle = LINE
        ctx.globalAlpha = 0.07
        ctx.lineWidth = 12
        ctx.stroke(path)
        ctx.globalAlpha = 0.16
        ctx.lineWidth = 5.5
        ctx.stroke(path)
        ctx.globalAlpha = 1
        const sg = ctx.createLinearGradient(0, 0, headX, 0)
        sg.addColorStop(0, 'rgba(0,209,160,.35)')
        sg.addColorStop(0.55, LINE)
        sg.addColorStop(1, LINE_HI)
        ctx.strokeStyle = sg
        ctx.lineWidth = compact ? 2 : 2.3
        ctx.stroke(path)
      }

      function drawCandles() {
        // (a made-up history behind a new market runs into negative ticks: floor keeps the groups aligned)
        const g0 = Math.floor((lastTick - (n - 1) > firstTick ? lastTick - (n - 1) : firstTick) / 10)
        const g1 = Math.floor(lastTick / 10)
        const w = Math.max(2, 10 * ppt * 0.64)
        for (let g = g0; g <= g1; g++) {
          const a = g * 10
          const b = Math.min(lastTick, a + 9)
          const ia = n - 1 - (lastTick - a)
          const ib = n - 1 - (lastTick - b)
          if (ib < 0 || ib < ia) continue
          const io = Math.max(0, ia - 1)
          const open = prices[io]
          let h = open
          let l = open
          for (let i = Math.max(0, ia); i <= ib; i++) {
            const p = i === n - 1 ? headP : prices[i]
            if (p > h) h = p
            if (p < l) l = p
          }
          const close = ib === n - 1 ? headP : prices[ib]
          const x = X(a + 4.5)
          if (x < -w || x > plotR) continue
          const up = close >= open
          const col = up ? UP : DOWN
          ctx.strokeStyle = col
          ctx.globalAlpha = 0.85
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(Math.round(x) + 0.5, Y(h))
          ctx.lineTo(Math.round(x) + 0.5, Y(l))
          ctx.stroke()
          const y0 = Y(Math.max(open, close))
          const y1 = Y(Math.min(open, close))
          const bh = Math.max(1.5, y1 - y0)
          const bg = ctx.createLinearGradient(0, y0, 0, y0 + bh)
          bg.addColorStop(0, up ? '#5df59c' : '#ff7d8b')
          bg.addColorStop(1, col)
          ctx.globalAlpha = 1
          ctx.fillStyle = bg
          pill(ctx, x - w / 2, y0, w, bh, Math.min(2, w / 4, bh / 2))
          ctx.fill()
        }
        ctx.globalAlpha = 1
      }

      // exits, where they happened
      ctx.font = `800 ${compact ? 9.5 : 10.5}px ${FONT}`
      ctx.textAlign = 'center'
      for (const m of desk.marks) {
        const x = X(m.tick)
        if (x < 4 || x > plotR) continue
        const y = Y(m.price)
        const col = m.reason === 'liquidated' ? DOWN : m.mult >= 1 ? UP : GOLD
        ctx.fillStyle = 'rgba(6,14,20,.9)'
        ctx.beginPath()
        ctx.arc(x, y, 5.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = col
        ctx.lineWidth = 2
        ctx.stroke()
        const label = m.reason === 'liquidated' ? 'LIQ' : `${m.mult.toFixed(2)}×`
        const tw = ctx.measureText(label).width + 10
        const ly = y - 17
        ctx.fillStyle = col
        ctx.globalAlpha = 0.92
        pill(ctx, x - tw / 2, ly - 8, tw, 16, 8)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = m.reason === 'liquidated' ? '#fff' : '#06180f'
        ctx.fillText(label, x, ly + 0.5)
      }

      // each position's lines, and its tag on its entry line
      const tags: { y: number; head: string; text: string; up: boolean; side: 'up' | 'down' }[] = []
      const edge: { y: number; text: string; color: string; dir: -1 | 1 }[] = []
      for (const p of positions) {
        const bold = p.id === focus
        const col = p.side === 'up' ? UP : DOWN
        const ye = Y(p.entry)
        ctx.strokeStyle = col
        ctx.globalAlpha = bold ? 0.85 : 0.45
        ctx.lineWidth = bold ? 1.5 : 1
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(0, Math.round(ye) + 0.5)
        ctx.lineTo(plotR, Math.round(ye) + 0.5)
        ctx.stroke()
        ctx.globalAlpha = 1
        // the entry
        const xe = X(p.tick)
        if (xe > 0 && xe < plotR) {
          ctx.fillStyle = col
          ctx.beginPath()
          ctx.arc(xe, ye, bold ? 5 : 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 1.6
          ctx.stroke()
        }
        for (const l of lines(p)) {
          if (!bold && l.kind !== 'liq') continue
          const y = Y(l.price)
          const color = l.kind === 'liq' ? DOWN : l.kind === 'tp' ? UP : GOLD
          if (y < padT - 2 || y > plotB + 2) {
            if (bold) edge.push({ y: y < padT ? padT + 10 : plotB - 10, text: `${l.label} ${fmt(l.price, 2)}`, color, dir: y < padT ? -1 : 1 })
            continue
          }
          ctx.strokeStyle = color
          ctx.globalAlpha = bold ? 0.9 : 0.35
          ctx.lineWidth = bold ? 1.4 : 1
          ctx.setLineDash(l.kind === 'liq' ? [7, 5] : [2, 4])
          ctx.beginPath()
          ctx.moveTo(0, Math.round(y) + 0.5)
          ctx.lineTo(plotR, Math.round(y) + 0.5)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.globalAlpha = 1
          if (bold) gutterTag(y, l.label, color, l.kind === 'liq' ? '#fff' : '#1b1300')
        }
        const pnl = Math.max(-p.stake, valueAt(p, cur) - p.stake)
        tags.push({ y: ye, side: p.side, head: `${p.side === 'up' ? '▲' : '▼'} ${p.leverage}×`, text: `${pnl >= 0 ? '+' : '−'}${fmt(Math.abs(pnl), 2)}`, up: pnl >= 0 })
      }

      // the tags on the entry lines, kept apart
      tags.sort((a, b) => a.y - b.y)
      for (let i = 1; i < tags.length; i++) if (tags[i].y - tags[i - 1].y < 22) tags[i].y = tags[i - 1].y + 22
      ctx.font = `800 ${compact ? 10.5 : 11.5}px ${FONT}`
      ctx.textAlign = 'left'
      // each tag: the side and leverage in the side's colour, then the profit or loss on green or red
      for (const t of tags) {
        const y = Math.max(padT + 9, Math.min(plotB - 9, t.y))
        const hw = ctx.measureText(t.head).width + 14
        const w = ctx.measureText(t.text).width + 14
        ctx.fillStyle = 'rgba(6,16,22,.94)'
        pill(ctx, 8, y - 10, hw + w, 20, 6)
        ctx.fill()
        ctx.strokeStyle = t.side === 'up' ? 'rgba(34,211,111,.55)' : 'rgba(255,77,97,.55)'
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.fillStyle = t.up ? 'rgba(34,211,111,.95)' : 'rgba(255,77,97,.95)'
        pill(ctx, 8 + hw, y - 10, w, 20, 6)
        ctx.fill()
        ctx.fillStyle = t.side === 'up' ? UP : DOWN
        ctx.fillText(t.head, 15, y + 0.5)
        ctx.fillStyle = t.up ? '#03200f' : '#fff'
        ctx.fillText(t.text, 15 + hw, y + 0.5)
      }
      // the lines off the chart, pinned to its edge
      ctx.font = `800 ${compact ? 9.5 : 10.5}px ${FONT}`
      ctx.textAlign = 'right'
      for (const e of edge) {
        const text = `${e.dir < 0 ? '↑' : '↓'} ${e.text}`
        const w = ctx.measureText(text).width + 12
        ctx.fillStyle = 'rgba(6,14,20,.85)'
        pill(ctx, plotR - 8 - w, e.y - 9, w, 18, 9)
        ctx.fill()
        ctx.strokeStyle = e.color
        ctx.lineWidth = 1.2
        ctx.stroke()
        ctx.fillStyle = e.color
        ctx.fillText(text, plotR - 14, e.y + 0.5)
      }

      // the head: a pulsing ring round the newest price, and the dashed line out to its tag
      const hx = X(headTick)
      const hy = Y(headP)
      ctx.strokeStyle = 'rgba(140,255,228,.45)'
      ctx.lineWidth = 1
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(hx, Math.round(hy) + 0.5)
      ctx.lineTo(plotR, Math.round(hy) + 0.5)
      ctx.stroke()
      ctx.setLineDash([])
      const ph = (now % 1400) / 1400
      ctx.strokeStyle = LINE_HI
      ctx.globalAlpha = (1 - ph) * 0.55
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(hx, hy, 4 + ph * 13, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 0.25
      ctx.fillStyle = LINE
      ctx.beginPath()
      ctx.arc(hx, hy, 9, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      ctx.fillStyle = '#eafff8'
      ctx.beginPath()
      ctx.arc(hx, hy, 4, 0, Math.PI * 2)
      ctx.fill()

      // the price tag, in the gutter (the stored price; only its place glides)
      {
        const up = pCur >= pPrev
        const th = compact ? 20 : 24
        const ty = tagY
        ctx.fillStyle = LINE
        ctx.beginPath()
        ctx.moveTo(plotR - 5, ty)
        ctx.lineTo(plotR + 2, ty - th / 2)
        ctx.lineTo(W - 4 - 6, ty - th / 2)
        ctx.arcTo(W - 4, ty - th / 2, W - 4, ty + th / 2, 6)
        ctx.arcTo(W - 4, ty + th / 2, plotR + 2, ty + th / 2, 6)
        ctx.lineTo(plotR + 2, ty + th / 2)
        ctx.closePath()
        ctx.fill()
        ctx.fillStyle = '#022019'
        ctx.font = `900 ${compact ? 10.5 : 12}px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillText(fmt(pCur, pCur >= 10_000 && compact ? 1 : 2), plotR + (compact ? 5 : 8), ty + 0.5)
        // which way the last tick went (the phone's narrow gutter leaves it to the ticker)
        if (!compact) {
          ctx.fillStyle = up ? '#05622f' : '#a3122a'
          ctx.font = `900 8px ${FONT}`
          ctx.textAlign = 'right'
          ctx.fillText(up ? '▲' : '▼', W - 8, ty + 0.5)
        }
      }

      // bursts: a liquidation in red (and the whole chart flashes), a big close in gold
      for (const fx of desk.fx) {
        const k = (now - fx.t0) / 1100
        if (k >= 1) continue
        const x = Math.min(headX, X(fx.tick))
        const y = Y(fx.price)
        if (!seen.has(fx)) {
          seen.add(fx)
          const colors = fx.kind === 'liq' ? ['#ff4d61', '#ff8a5c', '#ffd1d6', '#b31d34'] : ['#fff3b8', '#f7c548', '#7dffb4', '#ffffff']
          for (let i = 0; i < (fx.kind === 'liq' ? 46 : 36); i++) {
            const a = Math.random() * Math.PI * 2
            const sp = 70 + Math.random() * 260
            sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0, max: 0.5 + Math.random() * 0.6, size: 1.4 + Math.random() * 2.6, color: colors[i % colors.length] })
          }
        }
        if (fx.kind === 'liq') {
          ctx.fillStyle = `rgba(255,40,70,${0.16 * (1 - k)})`
          ctx.fillRect(0, 0, W, H)
        }
        const r = 18 + k * 120
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, fx.kind === 'liq' ? `rgba(255,220,220,${0.9 * (1 - k)})` : `rgba(255,246,200,${0.9 * (1 - k)})`)
        g.addColorStop(0.4, fx.kind === 'liq' ? `rgba(255,60,80,${0.55 * (1 - k)})` : `rgba(247,197,72,${0.5 * (1 - k)})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = fx.kind === 'liq' ? `rgba(255,120,130,${0.8 * (1 - k)})` : `rgba(255,230,150,${0.8 * (1 - k)})`
        ctx.lineWidth = 2.5
        ctx.beginPath()
        ctx.arc(x, y, 10 + k * 150, 0, Math.PI * 2)
        ctx.stroke()
      }
      if (desk.fx.length && desk.fx.every((fx) => now - fx.t0 > 1200)) desk.fx = []
      sparks = sparks.filter((s) => (s.life += dt) < s.max)
      for (const s of sparks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vy += 260 * dt
        s.vx *= 0.985
        const a = 1 - (s.life / s.max) ** 2
        ctx.fillStyle = s.color
        ctx.globalAlpha = a * 0.25
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size * 2.4, 0, Math.PI * 2)
        ctx.fill()
        ctx.globalAlpha = a
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      /** a small tag in the gutter for a position's line */
      function gutterTag(y: number, label: string, color: string, ink: string) {
        if (Math.abs(y - tagY) < 20) return
        ctx.font = `900 ${compact ? 9 : 10}px ${FONT}`
        ctx.textAlign = 'center'
        const w = ctx.measureText(label).width + 12
        const x = plotR + (compact ? 6 : 9)
        ctx.fillStyle = color
        pill(ctx, x, y - 8, w, 16, 4)
        ctx.fill()
        ctx.fillStyle = ink
        ctx.fillText(label, x + w / 2, y + 0.5)
      }
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [size.w, size.h, compact, desk])

  return (
    <div ref={box} className="absolute inset-0">
      <canvas ref={cv} style={{ width: size.w, height: size.h }} className="block" aria-hidden />
    </div>
  )
}

/** a position's lines besides its entry: liquidation, and take profit and stop loss when set */
function lines(p: Position): { kind: 'liq' | 'tp' | 'sl'; price: number; label: string }[] {
  const out: { kind: 'liq' | 'tp' | 'sl'; price: number; label: string }[] = [{ kind: 'liq', price: liqPrice(p), label: 'LIQ' }]
  if (p.takeProfit) out.push({ kind: 'tp', price: priceAtMult(p, p.takeProfit), label: 'TP' })
  if (p.stopLoss) out.push({ kind: 'sl', price: priceAtMult(p, p.stopLoss), label: 'SL' })
  return out
}
