import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

/*
  Backdrops: the animated scenes a player can hang behind their whole public profile page (src/store/cosmetics.ts
  kind 'backdrop'). Thirteen scenes besides "none" (which is just the house colours): Starlight, Blizzard, Code Rain,
  Sakura, Fireflies, Coin Rain, Chip Shower, Warp Speed, Confetti, Ember Storm, Thunderstorm, Aurora and Prism.

  <Backdrop id className mini /> fills its box. The sky is a CSS gradient on the box itself; the scene is drawn on up
  to three canvases over it: a still layer behind (nebulae, distant hills), the moving layer, and a still layer in
  front (branches, grass, mountains), the still ones drawn only when the box changes size. Each scene is a small
  particle system written for this: `update(dt)` moves it on, `draw` paints the moving layer, sizes are in CSS pixels
  and the canvases are scaled for the screen (at most 2 device pixels per pixel, less for a page-sized one, so a
  full-page scene stays near two million pixels). Particle counts follow the area, so a phone draws fewer, and `mini`
  (the shop's and the wardrobe's tiles) draws a denser, smaller version at half the frame rate.

  One requestAnimationFrame loop drives every backdrop on the page, and only the ones on screen
  (IntersectionObserver); nothing runs while the tab is hidden, and time is capped per frame so a scene coming back
  picks up where it was instead of jumping. For players who ask for reduced motion each scene is run on for a moment
  off screen and drawn once, a still frame, and redrawn only on a resize. Everything random comes from a seeded
  sequence, so a scene always starts the same way. Nothing here decides anything; it is decoration only.
*/

type Ctx = CanvasRenderingContext2D
interface Opts {
  mini: boolean
  /** particle size factor */
  s: number
  /** share of the full particle count */
  q: number
  rnd: () => number
}
interface Scene {
  /** paints the still layer behind the moving one (on every resize) */
  back?: (c: Ctx) => void
  /** paints the still layer in front of it */
  front?: (c: Ctx) => void
  /** moves everything on by dt seconds; t is the seconds since the scene began */
  update: (dt: number, t: number) => void
  /** paints the moving layer (already cleared) */
  draw: (c: Ctx, t: number) => void
}
type Make = (w: number, h: number, o: Opts) => Scene

const TAU = Math.PI * 2
function seq(seed: number) {
  let s = seed % 2147483647 || 1
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}
const hash = (str: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193) >>> 0
  return h
}
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
/** particles for an area: `perMpx` per million CSS pixels, scaled by the quality, at least `min` */
const count = (w: number, h: number, perMpx: number, o: Opts, min = 6) => Math.max(min, Math.round(((w * h) / 1e6) * perMpx * o.q))

/* ---------------- sprites ---------------- */

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.ceil(w))
  c.height = Math.max(1, Math.ceil(h))
  return c
}
const SPRITES = new Map<string, HTMLCanvasElement>()
/** a small picture drawn once and reused by every scene */
function sprite(key: string, w: number, h: number, paint: (g: Ctx) => void) {
  let c = SPRITES.get(key)
  if (!c) {
    c = canvas(w, h)
    paint(c.getContext('2d')!)
    SPRITES.set(key, c)
  }
  return c
}
/** a soft round light: a radial gradient through the given stops */
const glow = (key: string, stops: [number, string][], size = 64) =>
  sprite(`glow:${key}`, size, size, (g) => {
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    for (const [o, c] of stops) gr.addColorStop(o, c)
    g.fillStyle = gr
    g.fillRect(0, 0, size, size)
  })
/** a four-pointed glint with a soft middle */
const glint = (key: string, color: string) =>
  sprite(`glint:${key}`, 64, 64, (g) => {
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    gr.addColorStop(0, color)
    gr.addColorStop(0.25, color.replace(/[\d.]+\)$/, '0.35)'))
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(32, 0)
    g.quadraticCurveTo(35, 29, 64, 32)
    g.quadraticCurveTo(35, 35, 32, 64)
    g.quadraticCurveTo(29, 35, 0, 32)
    g.quadraticCurveTo(29, 29, 32, 0)
    g.fill()
    g.fillRect(16, 16, 32, 32)
  })

/** the device pixel ratio of the canvas being drawn: per-particle transforms include it */
let D = 1
/** puts the drawing origin at (x, y), turned by a and scaled by (sx, sy), in CSS pixels */
const place = (c: Ctx, x: number, y: number, a = 0, sx = 1, sy = 1) => {
  const co = Math.cos(a)
  const si = Math.sin(a)
  c.setTransform(D * sx * co, D * sx * si, -D * sy * si, D * sy * co, D * x, D * y)
}
const unplace = (c: Ctx) => c.setTransform(D, 0, 0, D, 0, 0)

/* ---------------- Starlight ---------------- */

const starsScene: Make = (w, h, o) => {
  const r = o.rnd
  const tints = [glow('star-w', [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,.85)'], [0.45, 'rgba(190,215,255,.18)'], [1, 'rgba(190,215,255,0)']], 32), glow('star-b', [[0, 'rgba(235,245,255,1)'], [0.2, 'rgba(160,205,255,.8)'], [0.5, 'rgba(110,170,255,.15)'], [1, 'rgba(110,170,255,0)']], 32), glow('star-g', [[0, 'rgba(255,250,230,1)'], [0.2, 'rgba(255,214,140,.8)'], [0.5, 'rgba(255,190,90,.15)'], [1, 'rgba(255,190,90,0)']], 32)]
  const shine = glint('star', 'rgba(255,255,255,1)')
  const stars = Array.from({ length: count(w, h, 420, o, 50) }, () => {
    const l = r() < 0.64 ? 0 : r() < 0.78 ? 1 : 2
    return { x: r() * w, y: r() * h, l, s: [2.2, 3.4, 5.6][l] * o.s * (0.7 + r() * 0.6), ph: r() * TAU, f: 0.5 + r() * 2.4, a: 0.35 + r() * 0.65, t: r() < 0.16 ? 1 : r() < 0.12 ? 2 : 0 }
  })
  let meteor: { x: number; y: number; vx: number; vy: number; life: number } | null = null
  let next = 1 + r() * 2.5
  return {
    back(c) {
      // two soft nebulae and the Milky Way's dust, drawn once
      for (const [x, y, rad, col] of [
        [0.18, 0.3, 0.55, 'rgba(123,73,255,.16)'],
        [0.85, 0.7, 0.5, 'rgba(40,180,220,.12)'],
        [0.6, 0.15, 0.35, 'rgba(255,95,162,.07)'],
      ] as const) {
        const R = rad * Math.max(w, h)
        const g = c.createRadialGradient(x * w, y * h, 0, x * w, y * h, R)
        g.addColorStop(0, col)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = g
        c.fillRect(0, 0, w, h)
      }
      const band = seq(77)
      c.fillStyle = 'rgba(220,230,255,.5)'
      for (let i = 0; i < count(w, h, 900, o, 80); i++) {
        const u = band()
        const x = u * w
        const y = h * (0.85 - u * 0.7) + (band() - 0.5) * h * 0.22 * (0.4 + band())
        c.globalAlpha = 0.08 + band() * 0.22
        c.fillRect(x, y, 1.1, 1.1)
      }
      c.globalAlpha = 1
    },
    update(dt) {
      for (const s of stars) {
        s.x -= [2, 5, 9][s.l] * dt * o.s
        if (s.x < -6) s.x += w + 12
      }
      next -= dt
      if (!meteor && next <= 0) {
        const sp = (380 + r() * 260) * o.s
        meteor = { x: w * (0.25 + r() * 0.8), y: h * r() * 0.35, vx: -sp * 0.86, vy: sp * 0.5, life: 1 }
        next = 2.5 + r() * 5
      }
      if (meteor) {
        meteor.x += meteor.vx * dt
        meteor.y += meteor.vy * dt
        meteor.life -= dt * 1.25
        if (meteor.life <= 0) meteor = null
      }
    },
    draw(c, t) {
      c.globalCompositeOperation = 'lighter'
      for (const s of stars) {
        const a = s.a * (0.55 + 0.45 * Math.sin(t * s.f + s.ph))
        c.globalAlpha = a
        c.drawImage(tints[s.t], s.x - s.s, s.y - s.s, s.s * 2, s.s * 2)
        if (s.l === 2 && a > 0.6) {
          const g = s.s * 3.2 * (a - 0.4)
          c.globalAlpha = (a - 0.6) * 1.6
          c.drawImage(shine, s.x - g, s.y - g, g * 2, g * 2)
        }
      }
      if (meteor) {
        const m = meteor
        const len = 120 * o.s
        const k = len / Math.hypot(m.vx, m.vy)
        const g = c.createLinearGradient(m.x, m.y, m.x - m.vx * k, m.y - m.vy * k)
        g.addColorStop(0, `rgba(255,255,255,${0.95 * Math.min(1, m.life * 2)})`)
        g.addColorStop(1, 'rgba(160,200,255,0)')
        c.globalAlpha = 1
        c.strokeStyle = g
        c.lineWidth = 2 * o.s
        c.lineCap = 'round'
        c.beginPath()
        c.moveTo(m.x, m.y)
        c.lineTo(m.x - m.vx * k, m.y - m.vy * k)
        c.stroke()
        c.drawImage(tints[0], m.x - 5 * o.s, m.y - 5 * o.s, 10 * o.s, 10 * o.s)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- Blizzard ---------------- */

const snowScene: Make = (w, h, o) => {
  const r = o.rnd
  const flake = glow('snow', [[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,.85)'], [0.7, 'rgba(230,242,255,.2)'], [1, 'rgba(230,242,255,0)']], 32)
  const flakes = Array.from({ length: count(w, h, 360, o, 40) }, () => {
    const l = r() < 0.55 ? 0 : r() < 0.82 ? 1 : 2
    return { x: r() * w, y: r() * h, l, s: [2.2, 3.8, 7][l] * o.s * (0.7 + r() * 0.6), v: [26, 48, 90][l] * (0.8 + r() * 0.4) * o.s, ph: r() * TAU, f: 0.6 + r() * 1.4, a: [0.45, 0.7, 0.55][l] }
  })
  const streaks = Array.from({ length: o.mini ? 3 : 10 }, () => ({ x: r() * w, y: r() * h, len: (60 + r() * 140) * o.s }))
  let gust = 0
  let nextGust = 3 + r() * 4
  let wind = 0
  return {
    back(c) {
      // a fog bank and a far line of pines, low and dark
      const g = c.createLinearGradient(0, h * 0.6, 0, h)
      g.addColorStop(0, 'rgba(180,205,230,0)')
      g.addColorStop(1, 'rgba(180,205,230,.12)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
      // each pine four stacked tiers on a short trunk
      const p = seq(5)
      for (let x = -20; x < w + 20; ) {
        const th = (40 + p() * 70) * o.s * (o.mini ? 0.7 : 1)
        c.fillStyle = p() < 0.5 ? 'rgba(14,30,48,.8)' : 'rgba(20,38,58,.7)'
        c.fillRect(x - th * 0.03, h - th * 0.12, th * 0.06, th * 0.12)
        for (let k = 0; k < 4; k++) {
          const half = th * 0.24 * (1 - k * 0.2)
          const bottom = h - th * 0.1 - th * k * 0.2
          c.beginPath()
          c.moveTo(x - half, bottom)
          c.lineTo(x, bottom - th * 0.36)
          c.lineTo(x + half, bottom)
          c.closePath()
          c.fill()
        }
        x += th * (0.22 + p() * 0.3)
      }
    },
    update(dt, t) {
      nextGust -= dt
      if (nextGust <= 0) {
        gust = 1
        nextGust = 6 + r() * 6
      }
      gust = Math.max(0, gust - dt * 0.45)
      wind = (34 * Math.sin(t * 0.31) + 18 * Math.sin(t * 0.73 + 1) + 150 * gust * gust) * o.s
      for (const f of flakes) {
        const k = [0.55, 0.8, 1.15][f.l]
        f.y += f.v * dt
        f.x += (wind * k + Math.sin(t * f.f + f.ph) * 14 * o.s) * dt
        if (f.y > h + 8) (f.y -= h + 16), (f.x = r() * w)
        if (f.x > w + 10) f.x -= w + 20
        else if (f.x < -10) f.x += w + 20
      }
      for (const s of streaks) {
        s.x += (wind * 2.2 + 30) * dt
        s.y += 10 * dt
        if (s.x - s.len > w) (s.x = -r() * w * 0.5), (s.y = r() * h)
      }
    },
    draw(c) {
      for (const f of flakes) {
        c.globalAlpha = f.a
        c.drawImage(flake, f.x - f.s, f.y - f.s, f.s * 2, f.s * 2)
      }
      // gusts: thin streaks of blown snow, only while the wind is up
      const g = clamp(gust * 1.4, 0, 1)
      if (g > 0.02) {
        c.globalAlpha = 0.22 * g
        c.strokeStyle = '#e8f3ff'
        c.lineWidth = 1.2 * o.s
        c.beginPath()
        for (const s of streaks) {
          c.moveTo(s.x, s.y)
          c.quadraticCurveTo(s.x - s.len * 0.5, s.y - 6 * o.s, s.x - s.len, s.y + 3 * o.s)
        }
        c.stroke()
      }
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Code Rain ---------------- */

const GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ012345789Z'
/** every glyph in three inks (dim green, green, white), side by side in one strip */
const glyphAtlas = (cell: number) =>
  sprite(`glyphs:${cell}`, cell * GLYPHS.length, cell * 3, (g) => {
    g.font = `${Math.round(cell * 0.86)}px ui-monospace, 'MS Gothic', 'Osaka-Mono', monospace`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    ;['#1f8f4a', '#4dff95', '#effff4'].forEach((ink, row) => {
      g.fillStyle = ink
      if (row === 2) (g.shadowColor = '#7dffb0'), (g.shadowBlur = cell * 0.5)
      ;[...GLYPHS].forEach((ch, i) => g.fillText(ch, i * cell + cell / 2, row * cell + cell / 2))
    })
  })

const matrixScene: Make = (w, h, o) => {
  const r = o.rnd
  const cell = Math.round((o.mini ? 9 : 15) * (o.mini ? 1 : clamp(o.s, 0.8, 1.2)))
  const atlas = glyphAtlas(cell)
  const rows = Math.ceil(h / cell) + 1
  const cols = Math.ceil(w / cell)
  const lanes = Array.from({ length: cols }, () => ({
    head: -r() * rows * 1.5,
    v: (6 + r() * 14) * (o.mini ? 0.8 : 1),
    trail: 8 + Math.floor(r() * 22),
    far: r() < 0.35,
    g: Array.from({ length: rows + 40 }, () => Math.floor(r() * GLYPHS.length)),
  }))
  return {
    update(dt) {
      for (const l of lanes) {
        l.head += l.v * dt * (l.far ? 0.6 : 1)
        if (l.head - l.trail > rows) {
          l.head = -r() * rows * 0.6
          l.v = (6 + r() * 14) * (o.mini ? 0.8 : 1)
          l.trail = 8 + Math.floor(r() * 22)
        }
        // a few glyphs change as they fall
        if (r() < 0.25) l.g[Math.floor(r() * l.g.length)] = Math.floor(r() * GLYPHS.length)
      }
    },
    draw(c) {
      lanes.forEach((l, x) => {
        const top = Math.floor(l.head)
        for (let k = 0; k < l.trail; k++) {
          const row = top - k
          if (row < 0 || row >= rows) continue
          const fade = 1 - k / l.trail
          const ink = k === 0 ? 2 : l.far || k > 4 ? 0 : 1
          c.globalAlpha = (k === 0 ? 1 : fade * fade) * (l.far ? 0.5 : 0.95)
          c.drawImage(atlas, l.g[(row + 40) % l.g.length] * cell, ink * cell, cell, cell, x * cell, row * cell, cell, cell)
        }
      })
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Sakura ---------------- */

const PETAL_TONES = ['#ffd3e6', '#ffa9cf', '#ff86bb', '#fff0f6']
const petalSprite = (k: number) =>
  sprite(`petal:${k}`, 40, 40, (g) => {
    const gr = g.createLinearGradient(8, 4, 32, 36)
    gr.addColorStop(0, '#fff7fb')
    gr.addColorStop(0.5, PETAL_TONES[k])
    gr.addColorStop(1, k === 2 ? '#e85d9c' : '#ff9cc8')
    g.fillStyle = gr
    g.beginPath()
    g.moveTo(20, 6)
    g.lineTo(17, 2)
    g.bezierCurveTo(6, 2, 2, 16, 20, 38)
    g.bezierCurveTo(38, 16, 34, 2, 23, 2)
    g.closePath()
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,.5)'
    g.lineWidth = 1.2
    g.beginPath()
    g.moveTo(20, 10)
    g.lineTo(20, 30)
    g.stroke()
  })

/** a dark blossoming branch reaching in from a corner, drawn into a still layer */
function branch(c: Ctx, x0: number, y0: number, dir: 1 | -1, size: number, r: () => number) {
  c.strokeStyle = '#2b0d26'
  c.lineCap = 'round'
  const blooms: [number, number][] = []
  const grow = (x: number, y: number, a: number, len: number, width: number, depth: number) => {
    const x1 = x + Math.cos(a) * len
    const y1 = y + Math.sin(a) * len
    c.lineWidth = width
    c.beginPath()
    c.moveTo(x, y)
    c.quadraticCurveTo((x + x1) / 2 + Math.sin(a) * len * 0.15, (y + y1) / 2 - Math.cos(a) * len * 0.15, x1, y1)
    c.stroke()
    blooms.push([x1, y1])
    if (depth <= 0) return
    grow(x1, y1, a + (r() - 0.3) * 0.7 * dir, len * (0.62 + r() * 0.2), width * 0.62, depth - 1)
    if (r() < 0.75) grow(x + (x1 - x) * 0.6, y + (y1 - y) * 0.6, a + (0.5 + r() * 0.5) * dir, len * 0.5, width * 0.5, depth - 2)
  }
  grow(x0, y0, dir === 1 ? 0.35 : Math.PI - 0.35, size, size * 0.09, 4)
  for (const [bx, by] of blooms)
    for (let i = 0; i < 7; i++) {
      const a = r() * TAU
      const d = r() * size * 0.12
      c.fillStyle = PETAL_TONES[Math.floor(r() * 4)]
      c.globalAlpha = 0.85 + r() * 0.15
      c.beginPath()
      c.arc(bx + Math.cos(a) * d, by + Math.sin(a) * d * 0.8, size * (0.018 + r() * 0.022), 0, TAU)
      c.fill()
    }
  c.globalAlpha = 1
}

const sakuraScene: Make = (w, h, o) => {
  const r = o.rnd
  const sprites = [0, 1, 2, 3].map(petalSprite)
  const bokeh = glow('bokeh', [[0, 'rgba(255,200,225,.35)'], [0.7, 'rgba(255,190,220,.3)'], [0.84, 'rgba(255,220,235,.4)'], [1, 'rgba(255,190,220,0)']], 64)
  const petals = Array.from({ length: count(w, h, 70, o, 14) }, () => ({ x: r() * w, y: r() * h, s: (7 + r() * 9) * o.s, vx: -(20 + r() * 40) * o.s, vy: (22 + r() * 30) * o.s, a: r() * TAU, va: (r() - 0.5) * 2, flip: r() * TAU, vf: 1.4 + r() * 2.6, k: Math.floor(r() * 4), ph: r() * TAU }))
  const lights = Array.from({ length: o.mini ? 3 : 12 }, () => ({ x: r() * w, y: r() * h, s: (20 + r() * 50) * o.s, v: (4 + r() * 8) * o.s, a: 0.12 + r() * 0.22 }))
  return {
    back(c) {
      const R = Math.max(w, h) * 0.45
      const g = c.createRadialGradient(w * 0.82, h * 0.16, 0, w * 0.82, h * 0.16, R)
      g.addColorStop(0, 'rgba(255,214,232,.35)')
      g.addColorStop(0.18, 'rgba(255,170,210,.12)')
      g.addColorStop(1, 'rgba(255,170,210,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
      c.fillStyle = 'rgba(255,246,240,.85)'
      c.beginPath()
      c.arc(w * 0.82, h * 0.16, Math.min(w, h) * 0.06, 0, TAU)
      c.fill()
    },
    front(c) {
      const b = seq(9)
      const size = Math.min(w, h) * (o.mini ? 0.55 : 0.42)
      branch(c, -size * 0.1, size * 0.18, 1, size, b)
      branch(c, w + size * 0.1, size * 0.08, -1, size * 0.85, b)
    },
    update(dt, t) {
      const gust = 1 + 0.6 * Math.sin(t * 0.4) + 0.3 * Math.sin(t * 1.3)
      for (const p of petals) {
        p.x += (p.vx * gust + Math.sin(t * 1.2 + p.ph) * 12 * o.s) * dt
        p.y += (p.vy + Math.cos(t * 0.9 + p.ph) * 8 * o.s) * dt
        p.a += p.va * dt
        p.flip += p.vf * dt
        if (p.y > h + 20 || p.x < -20) {
          if (r() < 0.5) (p.x = w + 10), (p.y = r() * h * 0.8)
          else (p.x = r() * w * 1.2), (p.y = -15)
        }
      }
      for (const l of lights) {
        l.y -= l.v * dt
        if (l.y < -l.s) (l.y = h + l.s), (l.x = r() * w)
      }
    },
    draw(c) {
      c.globalCompositeOperation = 'lighter'
      for (const l of lights) {
        c.globalAlpha = l.a
        c.drawImage(bokeh, l.x - l.s, l.y - l.s, l.s * 2, l.s * 2)
      }
      c.globalCompositeOperation = 'source-over'
      c.globalAlpha = 1
      for (const p of petals) {
        const sx = Math.cos(p.flip)
        place(c, p.x, p.y, p.a, Math.abs(sx) < 0.12 ? 0.12 : sx, 1)
        c.globalAlpha = 0.75 + 0.25 * Math.abs(sx)
        c.drawImage(sprites[p.k], -p.s, -p.s, p.s * 2, p.s * 2)
      }
      unplace(c)
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Fireflies ---------------- */

const firefliesScene: Make = (w, h, o) => {
  const r = o.rnd
  const light = glow('firefly', [[0, 'rgba(255,255,230,1)'], [0.12, 'rgba(240,255,140,.95)'], [0.35, 'rgba(190,255,70,.35)'], [1, 'rgba(160,255,60,0)']], 64)
  const flies = Array.from({ length: count(w, h, 120, o, 12) }, () => ({
    x0: r() * w,
    y0: h * (0.25 + r() * 0.72),
    ax: (30 + r() * 80) * o.s,
    ay: (16 + r() * 40) * o.s,
    fx: 0.08 + r() * 0.2,
    fy: 0.1 + r() * 0.25,
    p: r() * TAU,
    q: r() * TAU,
    period: 2.6 + r() * 3.4,
    off: r() * 6,
    s: (10 + r() * 14) * o.s,
    drift: (r() - 0.5) * 8 * o.s,
  }))
  const twinkle = Array.from({ length: o.mini ? 6 : 40 }, () => ({ x: r() * w, y: r() * h * 0.45, ph: r() * TAU, s: 0.6 + r() * 1.1 }))
  // every so often a wave of light runs across the meadow and the fireflies it passes flash together
  let wave: number | null = null
  let nextWave = 5 + r() * 5
  return {
    back(c) {
      const g = c.createRadialGradient(w * 0.5, h * 1.1, 0, w * 0.5, h * 1.1, Math.max(w, h) * 0.8)
      g.addColorStop(0, 'rgba(120,200,90,.12)')
      g.addColorStop(1, 'rgba(120,200,90,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
      // a far tree line
      const p = seq(21)
      c.fillStyle = 'rgba(6,20,22,.9)'
      c.beginPath()
      c.moveTo(0, h)
      for (let x = 0; x <= w + 20; x += 14 * o.s) c.lineTo(x, h * 0.78 - (p() * 0.08 + Math.sin(x * 0.01) * 0.04) * h)
      c.lineTo(w, h)
      c.fill()
    },
    front(c) {
      // tall grass along the bottom, in front of the lowest fireflies
      const p = seq(23)
      c.lineCap = 'round'
      const n = Math.round(w / (o.mini ? 2.5 : 4))
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w + (p() - 0.5) * 6
        const tall = h * (0.06 + p() * 0.14) * (o.mini ? 1.4 : 1)
        const lean = (p() - 0.5) * tall * 0.8
        c.strokeStyle = p() < 0.5 ? '#04100c' : '#071a12'
        c.lineWidth = (1.2 + p() * 1.6) * o.s
        c.beginPath()
        c.moveTo(x, h + 2)
        c.quadraticCurveTo(x + lean * 0.2, h - tall * 0.6, x + lean, h - tall)
        c.stroke()
      }
    },
    update(dt) {
      nextWave -= dt
      if (wave === null && nextWave <= 0) (wave = -0.2 * w), (nextWave = 9 + r() * 6)
      if (wave !== null) {
        wave += w * 0.32 * dt
        if (wave > w * 1.25) wave = null
      }
      for (const f of flies) f.x0 += f.drift * dt
    },
    draw(c, t) {
      c.globalCompositeOperation = 'lighter'
      for (const s of twinkle) {
        c.globalAlpha = 0.25 + 0.25 * Math.sin(t * 1.3 + s.ph)
        c.fillStyle = '#eaf4ff'
        c.fillRect(s.x, s.y, s.s, s.s)
      }
      for (const f of flies) {
        const x = (((f.x0 + Math.sin(t * f.fx * TAU + f.p) * f.ax + Math.sin(t * 0.37 + f.q) * f.ax * 0.3) % w) + w) % w
        const y = f.y0 + Math.sin(t * f.fy * TAU + f.q) * f.ay
        const ph = ((t + f.off) % f.period) / f.period
        let b = ph < 0.2 ? Math.sin((ph / 0.2) * Math.PI) : 0
        if (wave !== null) b = Math.max(b, clamp(1 - Math.abs(x - wave) / (90 * o.s + 20), 0, 1))
        c.globalAlpha = 0.2 + b * 0.8
        const s = f.s * (0.6 + b * 0.7)
        c.drawImage(light, x - s, y - s, s * 2, s * 2)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- Coin Rain ---------------- */

const coinFace = (back: boolean) =>
  sprite(`coin:${back ? 'b' : 'f'}`, 64, 64, (g) => {
    const rim = g.createLinearGradient(0, 0, 64, 64)
    rim.addColorStop(0, back ? '#d9a93a' : '#fff0a8')
    rim.addColorStop(0.5, back ? '#a87412' : '#f2b134')
    rim.addColorStop(1, back ? '#6b4300' : '#9a600a')
    g.fillStyle = rim
    g.beginPath()
    g.arc(32, 32, 31, 0, TAU)
    g.fill()
    const face = g.createRadialGradient(24, 22, 2, 32, 32, 26)
    face.addColorStop(0, back ? '#f5d27a' : '#fff6cf')
    face.addColorStop(0.6, back ? '#d39a22' : '#f7c548')
    face.addColorStop(1, back ? '#a87412' : '#d39417')
    g.fillStyle = face
    g.beginPath()
    g.arc(32, 32, 25, 0, TAU)
    g.fill()
    g.strokeStyle = back ? 'rgba(107,67,0,.55)' : 'rgba(150,96,10,.7)'
    g.lineWidth = 2
    g.beginPath()
    g.arc(32, 32, 20.5, 0, TAU)
    g.stroke()
    g.fillStyle = back ? 'rgba(107,67,0,.5)' : 'rgba(168,108,12,.75)'
    g.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rr = i % 2 ? 6 : 13
      g.lineTo(32 + Math.cos(a) * rr, 33 + Math.sin(a) * rr)
    }
    g.fill()
    g.fillStyle = 'rgba(255,255,255,.55)'
    g.beginPath()
    g.ellipse(22, 18, 9, 4, -0.6, 0, TAU)
    g.fill()
  })
const coinEdge = () =>
  sprite('coin:e', 64, 64, (g) => {
    g.fillStyle = '#7a4a06'
    g.beginPath()
    g.arc(32, 32, 31, 0, TAU)
    g.fill()
  })

const coinsScene: Make = (w, h, o) => {
  const r = o.rnd
  const face = coinFace(false)
  const backFace = coinFace(true)
  const edge = coinEdge()
  const shine = glint('coin', 'rgba(255,250,220,1)')
  const warm = glow('warm', [[0, 'rgba(255,214,110,.5)'], [1, 'rgba(255,190,60,0)']], 64)
  const make = (y?: number) => {
    const s = (9 + r() * r() * 22) * o.s
    return { x: r() * w, y: y ?? -s - r() * h * 0.3, s, v: (60 + s * 7) * (0.8 + r() * 0.4), sp: r() * TAU, vs: (2 + r() * 5) * (r() < 0.5 ? -1 : 1), a: r() * TAU, va: (r() - 0.5) * 1.2, sway: r() * TAU }
  }
  const coins = Array.from({ length: count(w, h, 46, o, 10) }, () => make(r() * h)).sort((a, b) => a.s - b.s)
  return {
    back(c) {
      const g = c.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, Math.max(w, h) * 0.75)
      g.addColorStop(0, 'rgba(247,197,72,.22)')
      g.addColorStop(1, 'rgba(247,197,72,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
    },
    update(dt, t) {
      for (const k of coins) {
        k.y += k.v * dt
        k.x += Math.sin(t * 0.8 + k.sway) * 10 * dt * o.s
        k.sp += k.vs * dt
        k.a += k.va * dt
        if (k.y > h + k.s * 2) Object.assign(k, make())
      }
    },
    draw(c) {
      for (const k of coins) {
        const cy = Math.cos(k.sp)
        const sy = Math.max(0.06, Math.abs(cy))
        const th = k.s * 0.22 * Math.sin(k.sp)
        // the coin's thickness: its edge drawn a little behind the face, along the way it is tipping
        place(c, k.x - Math.sin(k.a) * th, k.y + Math.cos(k.a) * th, k.a, 1, sy)
        c.drawImage(edge, -k.s, -k.s, k.s * 2, k.s * 2)
        place(c, k.x, k.y, k.a, 1, sy)
        c.drawImage(cy >= 0 ? face : backFace, -k.s, -k.s, k.s * 2, k.s * 2)
      }
      unplace(c)
      c.globalCompositeOperation = 'lighter'
      for (const k of coins) {
        const flash = (Math.abs(Math.cos(k.sp)) - 0.93) / 0.07
        if (flash <= 0 || k.s < 12 * o.s) continue
        c.globalAlpha = flash
        const g = k.s * 1.4
        c.drawImage(shine, k.x - k.s * 0.4 - g / 2, k.y - k.s * 0.4 - g / 2, g, g)
        c.globalAlpha = flash * 0.4
        c.drawImage(warm, k.x - k.s * 2, k.y - k.s * 2, k.s * 4, k.s * 4)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- Chip Shower ---------------- */

const CHIP_COLORS = ['#d8243a', '#2a6cf0', '#18a957', '#1c1d24', '#7b3fd6', '#f2b134']
const chipSprite = (k: number) =>
  sprite(`chip:${k}`, 64, 64, (g) => {
    const col = CHIP_COLORS[k]
    g.fillStyle = col
    g.beginPath()
    g.arc(32, 32, 31, 0, TAU)
    g.fill()
    g.fillStyle = k === 5 ? '#fff6cf' : '#ffffff'
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * TAU - 0.17
      const a1 = a0 + 0.34
      g.beginPath()
      g.arc(32, 32, 31, a0, a1)
      g.arc(32, 32, 23.5, a1, a0, true)
      g.closePath()
      g.fill()
    }
    g.fillStyle = 'rgba(0,0,0,.18)'
    g.beginPath()
    g.arc(32, 32, 21, 0, TAU)
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,.75)'
    g.lineWidth = 1.6
    g.setLineDash([3, 3])
    g.beginPath()
    g.arc(32, 32, 18.5, 0, TAU)
    g.stroke()
    g.setLineDash([])
    g.fillStyle = 'rgba(255,255,255,.85)'
    g.beginPath()
    g.moveTo(32, 23)
    g.lineTo(39, 32)
    g.lineTo(32, 41)
    g.lineTo(25, 32)
    g.fill()
    const hi = g.createLinearGradient(0, 0, 0, 64)
    hi.addColorStop(0, 'rgba(255,255,255,.28)')
    hi.addColorStop(0.5, 'rgba(255,255,255,0)')
    g.fillStyle = hi
    g.beginPath()
    g.arc(32, 32, 31, 0, TAU)
    g.fill()
  })
const chipEdge = (k: number) =>
  sprite(`chip:e${k}`, 64, 64, (g) => {
    g.fillStyle = CHIP_COLORS[k] === '#1c1d24' ? '#0a0a0e' : CHIP_COLORS[k]
    g.beginPath()
    g.arc(32, 32, 31, 0, TAU)
    g.fill()
    g.fillStyle = 'rgba(0,0,0,.45)'
    g.fill()
  })
const cardSprite = (k: number) =>
  sprite(`card:${k}`, 48, 66, (g) => {
    g.fillStyle = '#fbfdff'
    g.beginPath()
    g.moveTo(7, 1)
    g.arcTo(47, 1, 47, 65, 6)
    g.arcTo(47, 65, 1, 65, 6)
    g.arcTo(1, 65, 1, 1, 6)
    g.arcTo(1, 1, 47, 1, 6)
    g.closePath()
    g.fill()
    g.strokeStyle = '#c9d3dd'
    g.lineWidth = 1.2
    g.stroke()
    const red = k === 1
    g.fillStyle = red ? '#d0213a' : '#1b2a38'
    g.font = '900 15px Manrope, system-ui, sans-serif'
    g.textAlign = 'left'
    g.fillText(k === 0 ? 'A' : 'K', 6, 18)
    g.font = '28px system-ui, sans-serif'
    g.textAlign = 'center'
    g.fillText(red ? '♥' : '♠', 25, 48)
  })

const chipsScene: Make = (w, h, o) => {
  const r = o.rnd
  const faces = CHIP_COLORS.map((_, k) => chipSprite(k))
  const edges = CHIP_COLORS.map((_, k) => chipEdge(k))
  const cards = [0, 1].map(cardSprite)
  const make = (y?: number) => {
    const card = r() < 0.09
    const s = (card ? 18 + r() * 12 : 11 + r() * r() * 22) * o.s
    return { card, k: card ? Math.floor(r() * 2) : Math.floor(r() * CHIP_COLORS.length), x: r() * w, y: y ?? -s * 2 - r() * h * 0.3, s, v: (50 + s * 6) * (0.8 + r() * 0.4), sp: r() * TAU, vs: (1.6 + r() * 4) * (r() < 0.5 ? -1 : 1), a: r() * TAU, va: (r() - 0.5) * (card ? 2.4 : 1.4) }
  }
  const items = Array.from({ length: count(w, h, 44, o, 10) }, () => make(r() * h)).sort((a, b) => a.s - b.s)
  return {
    back(c) {
      const g = c.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, Math.max(w, h) * 0.9)
      g.addColorStop(0, 'rgba(60,220,140,.22)')
      g.addColorStop(0.5, 'rgba(30,140,90,.07)')
      g.addColorStop(1, 'rgba(30,140,90,0)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
    },
    update(dt) {
      for (const k of items) {
        k.y += k.v * dt
        k.sp += k.vs * dt
        k.a += k.va * dt
        if (k.y > h + k.s * 3) Object.assign(k, make())
      }
    },
    draw(c) {
      for (const k of items) {
        const cy = Math.cos(k.sp)
        const sy = Math.max(0.05, Math.abs(cy))
        if (k.card) {
          place(c, k.x, k.y, k.a, sy, 1)
          c.drawImage(cards[k.k], -k.s * 0.72, -k.s, k.s * 1.44, k.s * 2)
          continue
        }
        const th = k.s * 0.3 * Math.sin(k.sp)
        place(c, k.x - Math.sin(k.a) * th, k.y + Math.cos(k.a) * th, k.a, 1, sy)
        c.drawImage(edges[k.k], -k.s, -k.s, k.s * 2, k.s * 2)
        place(c, k.x, k.y, k.a, 1, sy)
        c.drawImage(faces[k.k], -k.s, -k.s, k.s * 2, k.s * 2)
      }
      unplace(c)
    },
  }
}

/* ---------------- Warp Speed ---------------- */

const warpScene: Make = (w, h, o) => {
  const r = o.rnd
  const core = glow('warp-core', [[0, 'rgba(255,255,255,.9)'], [0.2, 'rgba(190,225,255,.5)'], [0.6, 'rgba(80,140,255,.12)'], [1, 'rgba(80,140,255,0)']], 128)
  const cx = w / 2
  const cy = h * 0.42
  const fov = Math.max(w, h) * 0.5
  const spawn = (z = 1) => ({ x: (r() - 0.5) * 2.2, y: (r() - 0.5) * 2.2, z: z * (0.35 + r() * 0.65), px: NaN, py: NaN, c: r() < 0.7 ? 0 : r() < 0.5 ? 1 : 2 })
  const pts = Array.from({ length: count(w, h, 520, o, 60) }, () => spawn(r()))
  const tones = ['rgba(225,238,255,', 'rgba(140,200,255,', 'rgba(190,160,255,']
  let speed = 0.45
  let jump = 0
  let nextJump = 4 + r() * 3
  return {
    update(dt) {
      nextJump -= dt
      if (nextJump <= 0) (jump = 1), (nextJump = 9 + r() * 5)
      // "punch it": the jump ramps up fast and eases off over a couple of seconds
      jump = Math.max(0, jump - dt * 0.42)
      const boost = jump > 0.8 ? (1 - jump) * 5 : jump * 1.25
      speed = 0.45 + boost * 1.9
      for (const p of pts) {
        p.px = cx + (p.x / p.z) * fov
        p.py = cy + (p.y / p.z) * fov
        p.z -= speed * dt
        const sx = cx + (p.x / p.z) * fov
        const sy = cy + (p.y / p.z) * fov
        if (p.z <= 0.02 || sx < -50 || sx > w + 50 || sy < -50 || sy > h + 50) Object.assign(p, spawn())
      }
    },
    draw(c) {
      const flash = jump > 0.8 ? (jump - 0.8) * 5 : 0
      c.globalCompositeOperation = 'lighter'
      const R = Math.min(w, h) * (0.35 + speed * 0.12)
      c.globalAlpha = 0.5 + Math.min(0.5, speed * 0.3)
      c.drawImage(core, cx - R, cy - R, R * 2, R * 2)
      c.lineCap = 'round'
      for (const p of pts) {
        if (Number.isNaN(p.px)) continue
        const sx = cx + (p.x / p.z) * fov
        const sy = cy + (p.y / p.z) * fov
        const near = clamp(1 - p.z, 0, 1)
        c.globalAlpha = 0.25 + near * 0.75
        c.strokeStyle = tones[p.c] + (0.5 + near * 0.5) + ')'
        c.lineWidth = (0.6 + near * 2.4) * o.s
        // a streak from where it was; a long one while jumping
        const k = 4 + speed * 5
        c.beginPath()
        c.moveTo(sx - (sx - p.px) * k, sy - (sy - p.py) * k)
        c.lineTo(sx, sy)
        c.stroke()
      }
      if (flash > 0) {
        c.globalAlpha = flash * 0.3
        c.fillStyle = '#cfe6ff'
        c.fillRect(0, 0, w, h)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- Confetti ---------------- */

const CONFETTI = ['#22d36f', '#f7c548', '#ff5fa2', '#4cb4ff', '#9b7bff', '#ff8a3d', '#ffffff']

const confettiScene: Make = (w, h, o) => {
  const r = o.rnd
  type Bit = { x: number; y: number; vx: number; vy: number; s: number; c: string; a: number; va: number; f: number; vf: number; shape: number; life: number }
  const bits: Bit[] = []
  const cap = count(w, h, 170, o, 40)
  const add = (x: number, y: number, vx: number, vy: number) => {
    if (bits.length >= cap) bits.shift()
    bits.push({ x, y, vx, vy, s: (3 + r() * 4) * o.s, c: CONFETTI[Math.floor(r() * CONFETTI.length)], a: r() * TAU, va: (r() - 0.5) * 8, f: r() * TAU, vf: 4 + r() * 8, shape: r() < 0.55 ? 0 : r() < 0.6 ? 1 : 2, life: 1 })
  }
  for (let i = 0; i < cap * 0.6; i++) add(r() * w, r() * h, (r() - 0.5) * 30, 40 + r() * 40)
  let drizzle = 0
  let nextBurst = 1.2
  let side = r() < 0.5 ? 0 : 1
  return {
    back(c) {
      for (const [x, y, col] of [
        [0.15, 0.2, 'rgba(255,95,162,.12)'],
        [0.85, 0.35, 'rgba(76,180,255,.12)'],
        [0.5, 0.95, 'rgba(247,197,72,.1)'],
      ] as const) {
        const g = c.createRadialGradient(x * w, y * h, 0, x * w, y * h, Math.max(w, h) * 0.5)
        g.addColorStop(0, col)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        c.fillStyle = g
        c.fillRect(0, 0, w, h)
      }
    },
    update(dt) {
      // a steady drizzle from the top, and a popper from a bottom corner every few seconds
      drizzle += dt * cap * 0.16
      while (drizzle > 1) (drizzle -= 1), add(r() * w, -10, (r() - 0.5) * 30, 30 + r() * 30)
      nextBurst -= dt
      if (nextBurst <= 0) {
        const x = side ? w + 10 : -10
        const n = Math.round((o.mini ? 14 : 50) * Math.max(0.6, o.q))
        for (let i = 0; i < n; i++) {
          const sp = (420 + r() * 520) * Math.sqrt(h / 900) * (o.mini ? 0.55 : 1)
          const a = -Math.PI / 2 + (side ? -1 : 1) * (0.25 + r() * 0.45)
          add(x, h + 10, Math.cos(a) * sp, Math.sin(a) * sp)
        }
        side = 1 - side
        nextBurst = 3.6 + r() * 2.5
      }
      for (const b of bits) {
        // fast pieces slow down in the air until they flutter at their own falling speed
        b.vy += 520 * dt * (o.mini ? 0.5 : 1)
        const drag = Math.pow(0.12, dt)
        b.vx *= drag
        if (b.vy > 0) b.vy = Math.min(b.vy, (55 + b.s * 6) * (o.mini ? 0.6 : 1))
        else b.vy *= Math.pow(0.55, dt)
        b.x += (b.vx + Math.sin(b.f) * 18 * o.s) * dt
        b.y += b.vy * dt
        b.a += b.va * dt
        b.f += b.vf * dt
      }
      for (let i = bits.length - 1; i >= 0; i--) if (bits[i].y > h + 20 || bits[i].x < -40 || bits[i].x > w + 40) bits.splice(i, 1)
    },
    draw(c) {
      for (const b of bits) {
        const fx = Math.cos(b.f)
        place(c, b.x, b.y, b.a, fx < 0 ? Math.min(-0.15, fx) : Math.max(0.15, fx), 1)
        c.fillStyle = b.c
        c.globalAlpha = 0.65 + 0.35 * Math.abs(fx)
        if (b.shape === 0) c.fillRect(-b.s, -b.s * 0.45, b.s * 2, b.s * 0.9)
        else if (b.shape === 1) {
          c.beginPath()
          c.arc(0, 0, b.s * 0.6, 0, TAU)
          c.fill()
        } else {
          c.strokeStyle = b.c
          c.lineWidth = b.s * 0.45
          c.beginPath()
          c.moveTo(-b.s * 1.4, 0)
          c.quadraticCurveTo(-b.s * 0.7, -b.s, 0, 0)
          c.quadraticCurveTo(b.s * 0.7, b.s, b.s * 1.4, 0)
          c.stroke()
        }
      }
      unplace(c)
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Ember Storm ---------------- */

const embersScene: Make = (w, h, o) => {
  const r = o.rnd
  const spark = glow('ember', [[0, 'rgba(255,248,210,1)'], [0.15, 'rgba(255,190,70,.9)'], [0.4, 'rgba(255,100,30,.28)'], [1, 'rgba(255,80,20,0)']], 64)
  const make = (y?: number) => ({ x: r() * w, y: y ?? h + 10, vy: -(40 + r() * 120) * o.s, s: (2 + r() * r() * 7) * o.s, ph: r() * TAU, f: 0.8 + r() * 2.4, life: 0.5 + r() * 0.5, px: 0, py: 0 })
  const embers = Array.from({ length: count(w, h, 150, o, 24) }, () => make(r() * h))
  const ash = Array.from({ length: o.mini ? 3 : 18 }, () => ({ x: r() * w, y: r() * h, s: (1.5 + r() * 2.5) * o.s, a: r() * TAU, v: (8 + r() * 14) * o.s }))
  let gust = 0
  let nextGust = 2 + r() * 3
  return {
    back(c) {
      const g = c.createLinearGradient(0, h * 0.55, 0, h)
      g.addColorStop(0, 'rgba(255,90,30,0)')
      g.addColorStop(1, 'rgba(255,90,30,.28)')
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
      const p = seq(41)
      for (let i = 0; i < 7; i++) {
        const x = p() * w
        const y = h * (0.1 + p() * 0.5)
        const R = Math.max(w, h) * (0.15 + p() * 0.2)
        const s = c.createRadialGradient(x, y, 0, x, y, R)
        s.addColorStop(0, 'rgba(10,4,4,.45)')
        s.addColorStop(1, 'rgba(10,4,4,0)')
        c.fillStyle = s
        c.fillRect(0, 0, w, h)
      }
    },
    update(dt, t) {
      nextGust -= dt
      if (nextGust <= 0) (gust = 1), (nextGust = 4 + r() * 4)
      gust = Math.max(0, gust - dt * 0.5)
      const wind = (25 * Math.sin(t * 0.37) + 160 * gust * gust * (Math.sin(t * 0.11) > 0 ? 1 : -1)) * o.s
      for (const e of embers) {
        e.px = e.x
        e.py = e.y
        e.y += e.vy * dt
        e.x += (wind + Math.sin(t * e.f + e.ph + e.y * 0.01) * 45 * o.s) * dt
        e.life -= dt * 0.08
        if (e.y < -10 || e.life <= 0 || e.x < -30 || e.x > w + 30) Object.assign(e, make(), { px: NaN })
      }
      for (const a of ash) {
        a.y += a.v * dt
        a.x += wind * 0.5 * dt
        a.a += dt
        if (a.y > h + 6) (a.y = -6), (a.x = r() * w)
        if (a.x > w + 6) a.x -= w + 12
        else if (a.x < -6) a.x += w + 12
      }
    },
    draw(c, t) {
      c.fillStyle = 'rgba(120,110,110,.5)'
      for (const a of ash) {
        place(c, a.x, a.y, a.a, 1, Math.max(0.2, Math.abs(Math.cos(a.a * 1.7))))
        c.fillRect(-a.s, -a.s * 0.6, a.s * 2, a.s * 1.2)
      }
      unplace(c)
      c.globalCompositeOperation = 'lighter'
      c.lineCap = 'round'
      for (const e of embers) {
        const flick = 0.6 + 0.4 * Math.sin(t * 13 * e.f + e.ph)
        const a = clamp(e.life * 1.6, 0, 1) * flick
        if (!Number.isNaN(e.px) && e.s > 2.4 * o.s) {
          c.globalAlpha = a * 0.5
          c.strokeStyle = '#ff9a3d'
          c.lineWidth = e.s * 0.5
          c.beginPath()
          c.moveTo(e.px + (e.px - e.x) * 2, e.py + (e.py - e.y) * 2)
          c.lineTo(e.x, e.y)
          c.stroke()
        }
        c.globalAlpha = a
        const s = e.s * 2.2
        c.drawImage(spark, e.x - s, e.y - s, s * 2, s * 2)
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- Thunderstorm ---------------- */

/** a forked bolt by midpoint displacement: the main path and a few branches, as polylines */
function boltPaths(r: () => number, x0: number, y0: number, x1: number, y1: number, rough: number) {
  const split = (pts: [number, number][], depth: number): [number, number][] => {
    if (depth === 0) return pts
    const out: [number, number][] = []
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const len = Math.hypot(bx - ax, by - ay)
      out.push([ax, ay], [(ax + bx) / 2 + (r() - 0.5) * len * rough, (ay + by) / 2 + (r() - 0.5) * len * rough * 0.3])
    }
    out.push(pts[pts.length - 1])
    return split(out, depth - 1)
  }
  const main = split(
    [
      [x0, y0],
      [x1, y1],
    ],
    6,
  )
  const forks: [number, number][][] = []
  for (let i = 0; i < 3; i++) {
    const k = Math.floor(main.length * (0.2 + r() * 0.5))
    const [sx, sy] = main[k]
    const len = Math.hypot(x1 - x0, y1 - y0) * (0.2 + r() * 0.25)
    const a = Math.atan2(y1 - y0, x1 - x0) + (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5)
    forks.push(
      split(
        [
          [sx, sy],
          [sx + Math.cos(a) * len, sy + Math.sin(a) * len],
        ],
        4,
      ),
    )
  }
  return { main, forks }
}

const stormScene: Make = (w, h, o) => {
  const r = o.rnd
  const drops = [0, 1, 2].map((l) => Array.from({ length: count(w, h, [260, 130, 50][l], o, [16, 8, 4][l]) }, () => ({ x: r() * w * 1.3 - w * 0.15, y: r() * h, v: [900, 1300, 1800][l] * (0.85 + r() * 0.3) * Math.sqrt(h / 900) })))
  const lens = [10, 18, 30].map((v) => v * o.s * (o.mini ? 0.7 : 1))
  const splashes: { x: number; y: number; life: number }[] = []
  let clouds: HTMLCanvasElement | null = null
  let strike: { paths: ReturnType<typeof boltPaths>; life: number } | null = null
  let flash = 0
  let next = 1.5 + r() * 2
  let wind = 0.18
  return {
    back(c) {
      // heavy clouds across the top, kept on their own canvas so a flash can light them up
      clouds = canvas(w, h * 0.6)
      const g = clouds.getContext('2d')!
      const p = seq(61)
      for (let i = 0; i < 26; i++) {
        const x = p() * w
        const y = p() * h * 0.32
        const R = Math.max(w, h) * (0.08 + p() * 0.14)
        const gr = g.createRadialGradient(x, y, 0, x, y, R)
        gr.addColorStop(0, 'rgba(40,52,66,.7)')
        gr.addColorStop(1, 'rgba(40,52,66,0)')
        g.fillStyle = gr
        g.fillRect(0, 0, w, h)
      }
      c.drawImage(clouds, 0, 0)
    },
    front(c) {
      // wet ground and a few roofs, with the city's light low on the horizon
      const g = c.createLinearGradient(0, h * 0.86, 0, h)
      g.addColorStop(0, 'rgba(8,12,18,0)')
      g.addColorStop(1, 'rgba(8,12,18,.85)')
      c.fillStyle = g
      c.fillRect(0, h * 0.8, w, h * 0.2)
    },
    update(dt, t) {
      wind = 0.18 + 0.1 * Math.sin(t * 0.25)
      drops.forEach((layer, l) => {
        for (const d of layer) {
          d.y += d.v * dt
          d.x += d.v * wind * dt
          if (d.y > h) {
            if (l === 2 && splashes.length < 60) splashes.push({ x: d.x, y: h - r() * 12, life: 1 })
            d.y -= h + lens[l]
            d.x = r() * w * 1.3 - w * 0.3
          }
        }
      })
      for (const s of splashes) s.life -= dt * 4
      for (let i = splashes.length - 1; i >= 0; i--) if (splashes[i].life <= 0) splashes.splice(i, 1)
      next -= dt
      if (next <= 0) {
        const x = w * (0.1 + r() * 0.8)
        strike = { paths: boltPaths(r, x, -10, x + (r() - 0.5) * w * 0.25, h * (0.45 + r() * 0.35), 0.55), life: 1 }
        flash = 1
        next = 2.6 + r() * 5.5
      }
      if (strike) {
        strike.life -= dt * 3.2
        if (strike.life <= 0) strike = null
      }
      flash = Math.max(0, flash - dt * 2.4)
    },
    draw(c) {
      // the flash: the sky, then the clouds lit from inside, flickering as the bolt does
      const flick = strike ? [1, 0.25, 0.9, 0.6, 1, 0.3][Math.floor((1 - strike.life) * 6) % 6] : 0
      if (flash > 0) {
        c.globalAlpha = flash * 0.15 * (0.5 + flick * 0.5)
        c.fillStyle = '#cfe0ff'
        c.fillRect(0, 0, w, h)
        if (clouds) {
          c.globalCompositeOperation = 'lighter'
          c.globalAlpha = flash * 0.55
          c.drawImage(clouds, 0, 0)
          c.globalCompositeOperation = 'source-over'
        }
      }
      c.lineCap = 'round'
      drops.forEach((layer, l) => {
        c.globalAlpha = [0.22, 0.32, 0.45][l] + flash * 0.3
        c.strokeStyle = '#b9d2ea'
        c.lineWidth = [0.8, 1.1, 1.6][l] * o.s
        c.beginPath()
        for (const d of layer) {
          c.moveTo(d.x, d.y)
          c.lineTo(d.x - lens[l] * wind * 1.4, d.y - lens[l])
        }
        c.stroke()
      })
      c.globalAlpha = 0.5
      c.strokeStyle = '#cfe2f5'
      c.lineWidth = 1 * o.s
      c.beginPath()
      for (const s of splashes) {
        const k = (1 - s.life) * 6 * o.s
        c.moveTo(s.x - k, s.y)
        c.quadraticCurveTo(s.x, s.y - k * 1.2, s.x + k, s.y)
      }
      c.stroke()
      if (strike && flick > 0.2) {
        const line = (pts: [number, number][]) => {
          c.beginPath()
          pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
          c.stroke()
        }
        c.globalCompositeOperation = 'lighter'
        c.lineJoin = 'round'
        c.globalAlpha = flick * 0.35
        c.strokeStyle = '#7fb4ff'
        c.lineWidth = 9 * o.s
        line(strike.paths.main)
        c.globalAlpha = flick
        c.strokeStyle = '#ffffff'
        c.lineWidth = 2.4 * o.s
        line(strike.paths.main)
        c.lineWidth = 1.2 * o.s
        c.globalAlpha = flick * 0.8
        strike.paths.forks.forEach(line)
        c.globalCompositeOperation = 'source-over'
      }
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Aurora ---------------- */

const AURORA = [
  ['#3dffa8', 0.62, 0.24],
  ['#3de0ff', 0.48, 0.18],
  ['#b17cff', 0.36, 0.14],
] as const
const auroraStrip = (k: number) =>
  sprite(`aurora:${k}`, 2, 128, (g) => {
    const c = AURORA[k][0]
    const gr = g.createLinearGradient(0, 0, 0, 128)
    gr.addColorStop(0, `${c}00`)
    gr.addColorStop(0.35, `${c}18`)
    gr.addColorStop(0.78, `${c}88`)
    gr.addColorStop(0.9, `${c}ee`)
    gr.addColorStop(0.95, '#ffffff99')
    gr.addColorStop(1, `${c}00`)
    g.fillStyle = gr
    g.fillRect(0, 0, 2, 128)
  })

const auroraScene: Make = (w, h, o) => {
  const r = o.rnd
  const strips = [0, 1, 2].map(auroraStrip)
  // the curtains are drawn as thin vertical strips: narrow on a tile, wider on a page-sized canvas (they are soft anyway)
  const step = o.mini ? 2 : clamp(Math.round(w / 240), 4, 7)
  const ph = AURORA.map(() => [r() * TAU, r() * TAU, r() * TAU, r() * TAU])
  const twinkle = Array.from({ length: o.mini ? 6 : 60 }, () => ({ x: r() * w, y: r() * h * 0.7, ph: r() * TAU, s: 0.6 + r() * 1.2 }))
  return {
    back(c) {
      const p = seq(83)
      c.fillStyle = '#eaf4ff'
      for (let i = 0; i < count(w, h, 260, o, 30); i++) {
        c.globalAlpha = 0.15 + p() * 0.5
        const s = 0.5 + p() * 1.1
        c.fillRect(p() * w, p() * h * 0.85, s, s)
      }
      c.globalAlpha = 1
    },
    front(c) {
      // snowy mountains along the bottom, and their dark foothills
      const p = seq(89)
      const ridge = (base: number, amp: number, fill: string, snow: boolean) => {
        const peaks: [number, number][] = []
        for (let x = -40; x <= w + 40; x += (o.mini ? 18 : 90) * (0.6 + p() * 0.8)) peaks.push([x, h * base - p() * h * amp])
        c.fillStyle = fill
        c.beginPath()
        c.moveTo(-40, h)
        peaks.forEach(([x, y]) => c.lineTo(x, y))
        c.lineTo(w + 40, h)
        c.fill()
        if (!snow) return
        c.fillStyle = 'rgba(220,236,255,.6)'
        for (const [x, y] of peaks) {
          const s = Math.min(h * amp * 0.3, (h * base - y) * 0.5)
          c.beginPath()
          c.moveTo(x, y)
          c.lineTo(x - s * 0.9, y + s)
          c.lineTo(x - s * 0.2, y + s * 0.7)
          c.lineTo(x + s * 0.3, y + s * 1.1)
          c.lineTo(x + s * 0.8, y + s)
          c.fill()
        }
      }
      ridge(0.96, 0.24, '#04131e', true)
      ridge(1.02, 0.09, '#01070c', false)
    },
    update() {},
    draw(c, t) {
      c.globalCompositeOperation = 'lighter'
      AURORA.forEach(([, base, amp], k) => {
        const p = ph[k]
        for (let x = -step; x < w + step; x += step) {
          const u = x / w
          const y = h * (0.2 + k * 0.09) + Math.sin(u * 5.2 + t * 0.21 + p[0]) * h * 0.07 + Math.sin(u * 13 - t * 0.37 + p[1]) * h * 0.03
          const tall = h * amp * 1.4 * (0.9 + 0.6 * Math.sin(u * 3.1 + t * 0.15 + p[2]))
          // the curtain's folds: brighter and dimmer bands drifting along it
          const fold = 0.5 + 0.5 * Math.sin(u * 37 + t * 0.9 + p[3]) * Math.sin(u * 9 - t * 0.3)
          c.globalAlpha = clamp((0.25 + fold * 0.75) * base, 0, 1)
          c.drawImage(strips[k], 0, 0, 2, 128, x, y, step + 0.6, tall)
        }
      })
      c.globalCompositeOperation = 'source-over'
      for (const s of twinkle) {
        c.globalAlpha = 0.3 + 0.3 * Math.sin(t * 1.7 + s.ph)
        c.fillStyle = '#ffffff'
        c.fillRect(s.x, s.y, s.s, s.s)
      }
      c.globalAlpha = 1
    },
  }
}

/* ---------------- Prism (Mythic) ---------------- */

const prismScene: Make = (w, h, o) => {
  const r = o.rnd
  const white = glint('prism', 'rgba(255,255,255,1)')
  const halo = glow('prism-halo', [[0, 'rgba(255,255,255,.6)'], [0.3, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']], 64)
  const ox = w * 0.5
  const oy = -h * 0.08
  const beams = Array.from({ length: o.mini ? 5 : 9 }, (_, i) => ({ a: Math.PI / 2 + (i / (o.mini ? 4 : 8) - 0.5) * 1.9, wd: 0.05 + r() * 0.08, sp: 0.1 + r() * 0.2, ph: r() * TAU, hue: i * 40 }))
  const shards = Array.from({ length: count(w, h, 14, o, 6) }, () => {
    const n = 3 + Math.floor(r() * 3)
    const s = (14 + r() * 38) * o.s
    return { x: r() * w, y: r() * h, s, pts: Array.from({ length: n }, (_, k) => [Math.cos((k / n) * TAU + r() * 0.5) * s * (0.6 + r() * 0.5), Math.sin((k / n) * TAU + r() * 0.5) * s * (0.6 + r() * 0.5)] as const), a: r() * TAU, va: (r() - 0.5) * 0.5, v: (6 + r() * 14) * o.s, hue: r() * 360 }
  })
  const glitter = Array.from({ length: count(w, h, 70, o, 12) }, () => ({ x: r() * w, y: r() * h, s: (5 + r() * 10) * o.s, ph: r() * TAU, f: 1 + r() * 2.5, hue: r() * 360 }))
  return {
    update(dt) {
      for (const s of shards) {
        s.y -= s.v * dt
        s.a += s.va * dt
        if (s.y < -s.s * 1.5) (s.y = h + s.s * 1.5), (s.x = r() * w)
      }
    },
    draw(c, t) {
      const hue = (t * 24) % 360
      c.globalCompositeOperation = 'lighter'
      // light from above, split into colours, the beams swinging slowly
      const L = Math.hypot(w, h) * 1.2
      for (const b of beams) {
        const a = b.a + Math.sin(t * b.sp + b.ph) * 0.18
        const g = c.createLinearGradient(ox, oy, ox + Math.cos(a) * L, oy + Math.sin(a) * L)
        const hh = (hue + b.hue) % 360
        g.addColorStop(0, `hsla(${hh},100%,70%,.22)`)
        g.addColorStop(0.5, `hsla(${(hh + 30) % 360},100%,60%,.07)`)
        g.addColorStop(1, `hsla(${(hh + 60) % 360},100%,60%,0)`)
        c.fillStyle = g
        c.beginPath()
        c.moveTo(ox, oy)
        c.lineTo(ox + Math.cos(a - b.wd) * L, oy + Math.sin(a - b.wd) * L)
        c.lineTo(ox + Math.cos(a + b.wd) * L, oy + Math.sin(a + b.wd) * L)
        c.closePath()
        c.fill()
      }
      // the shards: rainbow glass turning as it rises, a glint when a face catches the light
      for (const s of shards) {
        const hh = (hue + s.hue) % 360
        place(c, s.x, s.y, s.a)
        const g = c.createLinearGradient(-s.s, -s.s, s.s, s.s)
        g.addColorStop(0, `hsla(${hh},100%,70%,.28)`)
        g.addColorStop(1, `hsla(${(hh + 90) % 360},100%,60%,.06)`)
        c.fillStyle = g
        c.strokeStyle = `hsla(${(hh + 40) % 360},100%,80%,.7)`
        c.lineWidth = 1.1 * o.s
        c.beginPath()
        s.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)))
        c.closePath()
        c.fill()
        c.stroke()
        const shine = Math.pow(Math.max(0, Math.sin(s.a * 2 + t * 0.6)), 12)
        if (shine > 0.05) {
          c.globalAlpha = shine
          c.drawImage(white, -s.s * 0.5, -s.s * 0.5, s.s, s.s)
          c.globalAlpha = 1
        }
      }
      unplace(c)
      // glitter in every colour
      for (const g of glitter) {
        const tw = Math.pow(Math.max(0, Math.sin(t * g.f + g.ph)), 3)
        if (tw < 0.03) continue
        const s = g.s * (0.4 + tw * 0.8)
        c.globalAlpha = tw * 0.5
        c.drawImage(halo, g.x - s, g.y - s, s * 2, s * 2)
        c.globalAlpha = tw
        c.fillStyle = `hsl(${(hue + g.hue) % 360},100%,78%)`
        c.beginPath()
        c.moveTo(g.x, g.y - s)
        c.quadraticCurveTo(g.x + s * 0.12, g.y - s * 0.12, g.x + s, g.y)
        c.quadraticCurveTo(g.x + s * 0.12, g.y + s * 0.12, g.x, g.y + s)
        c.quadraticCurveTo(g.x - s * 0.12, g.y + s * 0.12, g.x - s, g.y)
        c.quadraticCurveTo(g.x - s * 0.12, g.y - s * 0.12, g.x, g.y - s)
        c.fill()
      }
      c.globalAlpha = 1
      c.globalCompositeOperation = 'source-over'
    },
  }
}

/* ---------------- the catalog ---------------- */

const SCENES: Record<string, Make> = {
  'backdrop:stars': starsScene,
  'backdrop:snow': snowScene,
  'backdrop:matrix': matrixScene,
  'backdrop:sakura': sakuraScene,
  'backdrop:fireflies': firefliesScene,
  'backdrop:coins': coinsScene,
  'backdrop:chips': chipsScene,
  'backdrop:warp': warpScene,
  'backdrop:confetti': confettiScene,
  'backdrop:embers': embersScene,
  'backdrop:storm': stormScene,
  'backdrop:aurora': auroraScene,
  'backdrop:prism': prismScene,
}

/** each scene's sky (the box's own background, under the canvases) */
export const BACKDROP_BG: Record<string, string> = {
  'backdrop:none': 'radial-gradient(120% 80% at 70% 0%, #14293d 0%, #0d1a25 60%)',
  'backdrop:stars': 'radial-gradient(130% 90% at 30% 10%, #172452 0%, #0a1030 45%, #04060f 100%)',
  'backdrop:snow': 'linear-gradient(180deg, #142336 0%, #20354c 55%, #2c4660 100%)',
  'backdrop:matrix': 'linear-gradient(180deg, #010805 0%, #031a0d 100%)',
  'backdrop:sakura': 'linear-gradient(180deg, #140a2c 0%, #3a1650 55%, #6e2758 100%)',
  'backdrop:fireflies': 'linear-gradient(180deg, #06101f 0%, #0b2026 55%, #10302a 100%)',
  'backdrop:coins': 'radial-gradient(120% 90% at 50% 100%, #3a2507 0%, #1a1004 55%, #0b0702 100%)',
  'backdrop:chips': 'radial-gradient(120% 90% at 50% 0%, #0f5a36 0%, #08301d 55%, #04140c 100%)',
  'backdrop:warp': 'radial-gradient(90% 70% at 50% 42%, #142060 0%, #070b26 55%, #020309 100%)',
  'backdrop:confetti': 'radial-gradient(120% 90% at 50% 20%, #1a2a4a 0%, #0e1830 55%, #070b18 100%)',
  'backdrop:embers': 'linear-gradient(180deg, #0c0406 0%, #2a0a0c 55%, #5a1608 100%)',
  'backdrop:storm': 'linear-gradient(180deg, #0a1018 0%, #16222e 50%, #223240 100%)',
  'backdrop:aurora': 'linear-gradient(180deg, #020b16 0%, #062033 60%, #0a2c40 100%)',
  'backdrop:prism': 'radial-gradient(120% 90% at 50% 0%, #241038 0%, #110a22 50%, #06040e 100%)',
}

/* ---------------- the loop ---------------- */

interface Live {
  draw: (now: number) => void
}
const running = new Set<Live>()
// dev only: how many backdrops are drawing now (tools/scenes-sheet.mjs checks offscreen and still ones are not)
if (import.meta.env.DEV && typeof window !== 'undefined') Object.assign(window, { __backdropsRunning: () => running.size })
let raf = 0
const tick = (now: number) => {
  raf = 0
  for (const l of running) l.draw(now)
  if (running.size && !document.hidden) raf = requestAnimationFrame(tick)
}
const wake = () => {
  if (!raf && running.size && typeof document !== 'undefined' && !document.hidden) raf = requestAnimationFrame(tick)
}
if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf)
      raf = 0
    } else wake()
  })
const calmQuery = typeof window !== 'undefined' ? window.matchMedia?.('(prefers-reduced-motion: reduce)') : undefined

/**
 * Runs one scene in `box`: makes its canvases, draws it while it is on screen, and returns the clean-up. The scene is
 * made again on a resize (the particles spread over the new size).
 */
function mount(box: HTMLElement, make: Make, mini: boolean, seed: number, hold: boolean) {
  const layer = (z: number) => {
    const c = document.createElement('canvas')
    c.style.cssText = `position:absolute;inset:0;width:100%;height:100%;z-index:${z}`
    box.appendChild(c)
    return c
  }
  const [backCv, fxCv, frontCv] = [layer(0), layer(1), layer(2)]
  const fx = fxCv.getContext('2d')!
  let scene: Scene | null = null
  let w = 0
  let h = 0
  let dpr = 1
  let t = 0
  let last = 0
  let odd = false
  let visible = false
  let calm = hold || !!calmQuery?.matches

  const build = () => {
    const rect = box.getBoundingClientRect()
    w = Math.max(1, Math.round(rect.width))
    h = Math.max(1, Math.round(rect.height))
    // at most 2 device pixels per CSS pixel, and a page-sized backdrop kept near two million pixels
    dpr = Math.min(window.devicePixelRatio || 1, 2, Math.max(1, Math.sqrt(2.2e6 / (w * h))))
    const phone = Math.min(window.innerWidth, window.innerHeight) < 640
    const opts: Opts = { mini, s: mini ? 0.55 : phone ? 0.85 : 1, q: mini ? 2.2 : phone ? 0.7 : 1, rnd: seq(seed) }
    for (const c of [backCv, fxCv, frontCv]) {
      c.width = Math.round(w * dpr)
      c.height = Math.round(h * dpr)
    }
    scene = make(w, h, opts)
    t = 0
    D = dpr
    for (const [c, paint] of [
      [backCv, scene.back],
      [frontCv, scene.front],
    ] as const) {
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      paint?.(g)
      c.style.display = paint ? '' : 'none'
    }
    if (calm) still()
  }
  const paint = () => {
    if (!scene) return
    D = dpr
    fx.setTransform(dpr, 0, 0, dpr, 0, 0)
    fx.clearRect(0, 0, w, h)
    scene.draw(fx, t)
  }
  /** a still frame: the scene run on for a few seconds, then drawn once */
  const still = () => {
    if (!scene) return
    for (let i = 0; i < 90; i++) {
      t += 1 / 30
      scene.update(1 / 30, t)
    }
    paint()
  }
  const live: Live = {
    draw: (now) => {
      if (!scene) return
      // a tile draws every other frame; time never jumps more than 50 ms at once
      if (mini && (odd = !odd)) return
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
      last = now
      t += dt
      scene.update(dt, t)
      paint()
    },
  }
  const sync = () => {
    if (visible && !calm) {
      if (!running.has(live)) (last = 0), running.add(live)
      wake()
    } else running.delete(live)
  }
  const io = new IntersectionObserver((e) => {
    visible = e[e.length - 1].isIntersecting
    sync()
  })
  io.observe(box)
  let sized = ''
  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect()
    const key = `${Math.round(r.width)}x${Math.round(r.height)}`
    if (key === sized || !r.width || !r.height) return
    sized = key
    build()
    if (!calm && visible) paint()
  })
  ro.observe(box)
  const onCalm = () => {
    calm = hold || !!calmQuery?.matches
    if (calm) still()
    sync()
  }
  calmQuery?.addEventListener('change', onCalm)
  return () => {
    io.disconnect()
    ro.disconnect()
    calmQuery?.removeEventListener('change', onCalm)
    running.delete(live)
    backCv.remove()
    fxCv.remove()
    frontCv.remove()
  }
}

/**
 * A backdrop filling its box (give it a size, or absolute inset-0). `mini` for the shop's and the wardrobe's tiles:
 * smaller, denser, at half the frame rate; `still` draws one frame and never moves (thumbnails in long lists).
 * 'backdrop:none' (or an unknown id) is the house colours alone.
 */
export function Backdrop({ id, className = '', mini = false, still = false }: { id: string; className?: string; mini?: boolean; still?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const make = SCENES[id] as Make | undefined
  useEffect(() => {
    if (!make || !ref.current) return
    return mount(ref.current, make, mini, hash(id), still)
  }, [id, make, mini, still])
  return <div ref={ref} aria-hidden className={`pointer-events-none isolate overflow-hidden ${className.includes('absolute') || className.includes('fixed') ? '' : 'relative'} ${className}`} style={{ background: BACKDROP_BG[id] ?? BACKDROP_BG['backdrop:none'] }} data-backdrop={make ? id : 'backdrop:none'} />
}

/** whether an id is a scene that moves (not none, not unknown) */
export const hasScene = (id: string) => !!SCENES[id]

/**
 * A backdrop behind a whole page (a player's public profile): fixed over the app's scrolling main area, so the page
 * scrolls over a scene that stays put, and put in the body under everything else (z-index -1 over the body's own
 * colour), so it never covers the page, its menus or its dialogs. It fades in, and a shade that deepens towards the
 * bottom keeps the page's panels, and the footer's small print, easy to read. Nothing for 'backdrop:none'.
 */
export function PageBackdrop({ id }: { id: string }) {
  const [rect, setRect] = useState<{ l: number; t: number; w: number; h: number } | null>(null)
  useLayoutEffect(() => {
    const main = document.querySelector('main')
    if (!main) return
    const measure = () => {
      const r = main.getBoundingClientRect()
      setRect((o) => (o && o.l === r.left && o.t === r.top && o.w === r.width && o.h === r.height ? o : { l: r.left, t: r.top, w: r.width, h: r.height }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(main)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  if (!hasScene(id) || !rect) return null
  return createPortal(
    <motion.div aria-hidden className="pointer-events-none fixed overflow-hidden" style={{ left: rect.l, top: rect.t, width: rect.w, height: rect.h, zIndex: -1 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }} data-page-backdrop={id}>
      <Backdrop id={id} className="absolute inset-0" />
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(13,26,37,.1) 0%, rgba(13,26,37,.35) 55%, rgba(13,26,37,.72) 100%)' }} />
    </motion.div>,
    document.body,
  )
}
