import type { CardId } from './rules'
import { BONUS, CARD_H, CARD_W, PANEL, cellCenter } from './layout'

/*
  The scratch-off foil, painted procedurally on a canvas (no image files): a metallic base with diagonal banding, a
  brushed grain, a lattice of the card's motif embossed into it (a highlight and a shadow either side of every raised
  shape), a coin-like "?" badge pressed over every hidden cell, glitter, and a bevel round the panel's edge. Each card
  has its own metal: mint silver for Lucky Clover, brushed gold for Gold Rush, pastel rainbow for Fruit Frenzy and
  black chrome under a prismatic film for Diamond Deluxe. A painted foil is cached per card and scale, so a new card of
  the same kind costs nothing to draw.

  Also here: the brushes a coin leaves when it scratches. Each is an irregular disc with a ragged, crumbly rim and a few
  specks of foil left inside it, so a stroke has torn edges and a second pass cleans it up, the way real foil does. They
  are white on the engine's mask, which cuts the foil by alpha and lights its cut edge with the colour.
*/

type Motif = (c: CanvasRenderingContext2D, s: number) => void

export interface FoilStyle {
  /** metallic banding along the panel's diagonal */
  base: [number, string][]
  /** a second banding across it (soft-light), for the play of light */
  cross?: [number, string][]
  /** emboss rims */
  hi: string
  lo: string
  /** tint over the raised faces */
  face: string
  motif: Motif
  spacing: number
  size: number
  /** the badge over each cell */
  badge: { ring: string; glyph: string; hi: string; lo: string }
  grain: number
  glitter: number
  /** what the flying flakes look like: [front, back] pairs */
  flecks: [string, string][]
  /** the passing glint */
  sheen: string
  /** how bright the foil's cut edge catches the light along a scratch */
  edge: number
  /** a prismatic film over the metal (holographic foil): hues repeating across the diagonal */
  holo?: { colors: string[]; period: number; alpha: number }
}

/* ---------------- motifs, drawn around the origin at size s ---------------- */

const shamrock: Motif = (c, s) => {
  const r = s * 0.3
  c.beginPath()
  for (let i = 0; i < 3; i++) {
    const a = (i * 2 * Math.PI) / 3 - Math.PI / 2
    c.moveTo(Math.cos(a) * r * 1.1 + r, Math.sin(a) * r * 1.1)
    c.arc(Math.cos(a) * r * 1.1, Math.sin(a) * r * 1.1, r, 0, Math.PI * 2)
  }
  c.fill()
  c.fillRect(-s * 0.04, 0, s * 0.08, s * 0.55)
}

const nugget: Motif = (c, s) => {
  const pts = [
    [-0.5, 0.1],
    [-0.32, -0.36],
    [0.06, -0.5],
    [0.44, -0.26],
    [0.5, 0.18],
    [0.16, 0.48],
    [-0.3, 0.42],
  ]
  c.beginPath()
  pts.forEach(([x, y], i) => (i ? c.lineTo(x * s, y * s) : c.moveTo(x * s, y * s)))
  c.closePath()
  c.fill()
}

const heart: Motif = (c, s) => {
  const k = s / 100
  c.beginPath()
  c.moveTo(0, 36 * k)
  c.bezierCurveTo(-24 * k, 20 * k, -46 * k, 4 * k, -46 * k, -16 * k)
  c.bezierCurveTo(-46 * k, -34 * k, -30 * k, -42 * k, -20 * k, -42 * k)
  c.bezierCurveTo(-10 * k, -42 * k, -3 * k, -36 * k, 0, -26 * k)
  c.bezierCurveTo(3 * k, -36 * k, 10 * k, -42 * k, 20 * k, -42 * k)
  c.bezierCurveTo(30 * k, -42 * k, 46 * k, -34 * k, 46 * k, -16 * k)
  c.bezierCurveTo(46 * k, 4 * k, 24 * k, 20 * k, 0, 36 * k)
  c.fill()
}

/** a four-point sparkle with a small brilliant in its heart */
const sparkle: Motif = (c, s) => {
  const r = s * 0.5
  const q = r * 0.16
  c.beginPath()
  c.moveTo(0, -r)
  c.quadraticCurveTo(q, -q, r, 0)
  c.quadraticCurveTo(q, q, 0, r)
  c.quadraticCurveTo(-q, q, -r, 0)
  c.quadraticCurveTo(-q, -q, 0, -r)
  c.fill()
}

export const FOIL: Record<CardId, FoilStyle> = {
  clover: {
    base: [
      [0, '#eef6f0'],
      [0.18, '#b9c9bf'],
      [0.36, '#f4faf5'],
      [0.52, '#a9bcb0'],
      [0.7, '#dde9e1'],
      [0.86, '#9fb3a6'],
      [1, '#e3eee6'],
    ],
    cross: [
      [0, '#ffffff'],
      [0.5, '#6f8a79'],
      [1, '#ffffff'],
    ],
    hi: 'rgba(255,255,255,.85)',
    lo: 'rgba(40,70,52,.42)',
    face: 'rgba(120,200,150,.10)',
    motif: shamrock,
    spacing: 30,
    size: 15,
    badge: { ring: '#8fa898', glyph: '#7d978a', hi: 'rgba(255,255,255,.95)', lo: 'rgba(30,60,42,.5)' },
    grain: 16,
    glitter: 2.2,
    flecks: [
      ['#f4fbf6', '#9fb5a7'],
      ['#dbe8df', '#7f988a'],
      ['#c6d8cc', '#6c8577'],
    ],
    sheen: 'rgba(255,255,255,.55)',
    edge: 0.6,
  },
  gold: {
    base: [
      [0, '#fff0b8'],
      [0.16, '#d9a631'],
      [0.34, '#ffe08a'],
      [0.5, '#b9821b'],
      [0.68, '#f7d26b'],
      [0.84, '#a8700f'],
      [1, '#f0c95a'],
    ],
    cross: [
      [0, '#fff6d8'],
      [0.5, '#7a4a06'],
      [1, '#fff6d8'],
    ],
    hi: 'rgba(255,248,215,.9)',
    lo: 'rgba(90,50,0,.45)',
    face: 'rgba(255,220,120,.12)',
    motif: nugget,
    spacing: 28,
    size: 13,
    badge: { ring: '#b58321', glyph: '#a87412', hi: 'rgba(255,246,206,.95)', lo: 'rgba(80,44,0,.55)' },
    grain: 20,
    glitter: 2.6,
    flecks: [
      ['#fff1b8', '#b8801a'],
      ['#ffd95c', '#9a6408'],
      ['#f4c64a', '#7e5004'],
    ],
    sheen: 'rgba(255,250,225,.6)',
    edge: 0.55,
  },
  fruit: {
    base: [
      [0, '#ffd1ec'],
      [0.14, '#c9f2ff'],
      [0.28, '#fff6b8'],
      [0.42, '#d8c4ff'],
      [0.56, '#b8ffe0'],
      [0.7, '#ffc4dc'],
      [0.84, '#c4e6ff'],
      [1, '#fff1c4'],
    ],
    cross: [
      [0, '#ffffff'],
      [0.5, '#8d7ab8'],
      [1, '#ffffff'],
    ],
    hi: 'rgba(255,255,255,.9)',
    lo: 'rgba(110,70,140,.38)',
    face: 'rgba(255,255,255,.12)',
    motif: heart,
    spacing: 26,
    size: 12,
    badge: { ring: '#b39ad0', glyph: '#a58ac6', hi: 'rgba(255,255,255,.95)', lo: 'rgba(90,50,120,.45)' },
    grain: 14,
    glitter: 3.4,
    flecks: [
      ['#ffd6ef', '#b48ad8'],
      ['#cdf4ff', '#7fa8d8'],
      ['#fff4b8', '#d8a86a'],
      ['#d4ffe8', '#6fbf9a'],
    ],
    sheen: 'rgba(255,255,255,.7)',
    edge: 0.6,
  },
  // black chrome under a prismatic film: hard light bands on near-black, rainbow hues sliding across them
  diamond: {
    base: [
      [0, '#3a3f52'],
      [0.12, '#0c0d14'],
      [0.27, '#6b7190'],
      [0.36, '#151722'],
      [0.52, '#9aa0bc'],
      [0.6, '#1a1c28'],
      [0.78, '#4c5268'],
      [0.9, '#0d0e15'],
      [1, '#2c3042'],
    ],
    cross: [
      [0, '#dfe4ff'],
      [0.5, '#030409'],
      [1, '#dfe4ff'],
    ],
    hi: 'rgba(225,232,255,.8)',
    lo: 'rgba(0,0,0,.8)',
    face: 'rgba(160,140,255,.10)',
    motif: sparkle,
    spacing: 34,
    size: 13,
    badge: { ring: '#8b92ad', glyph: '#a2a9c4', hi: 'rgba(235,240,255,.9)', lo: 'rgba(0,0,0,.8)' },
    grain: 14,
    glitter: 5.5,
    flecks: [
      ['#d6dcf2', '#1b1e2c'],
      ['#9fa6c2', '#10121c'],
      ['#f0d4ff', '#2a2142'],
      ['#c6f2ff', '#152a36'],
    ],
    sheen: 'rgba(230,236,255,.6)',
    edge: 0.7,
    holo: { colors: ['#ff5ea8', '#ffb35c', '#fff36b', '#5cffb1', '#5cc8ff', '#a77bff', '#ff5ea8'], period: 120, alpha: 0.3 },
  },
}

/* ---------------- the regions the foil covers ---------------- */

export type Region = { kind: 'rect'; x: number; y: number; w: number; h: number; r: number } | { kind: 'circle'; cx: number; cy: number; r: number }

export const foilRegions = (bonus: boolean): Region[] => [{ kind: 'rect', ...PANEL }, ...(bonus ? [{ kind: 'circle' as const, ...BONUS }] : [])]

export function regionPath(c: CanvasRenderingContext2D, g: Region, k: number, grow = 0) {
  if (g.kind === 'rect') c.roundRect((g.x - grow) * k, (g.y - grow) * k, (g.w + grow * 2) * k, (g.h + grow * 2) * k, (g.r + grow) * k)
  else {
    c.moveTo((g.cx + g.r + grow) * k, g.cy * k)
    c.arc(g.cx * k, g.cy * k, (g.r + grow) * k, 0, Math.PI * 2)
  }
}

/* ---------------- painting ---------------- */

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

/** a seeded generator, so a card's foil looks the same every time it is painted */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draws `mask` (white shapes on transparent) as raised metal: a shadow below right, a highlight above left, then the
 * face itself in the same metal (`metal`, opaque) with a little `tint` over it, so only the rims catch the light.
 */
function emboss(c: CanvasRenderingContext2D, mask: HTMLCanvasElement, d: number, hi: string, lo: string, metal: string | CanvasGradient, tint?: string | CanvasGradient) {
  const fill = (f: string | CanvasGradient) => {
    const t = canvas(mask.width, mask.height)
    const x = t.getContext('2d')!
    x.drawImage(mask, 0, 0)
    x.globalCompositeOperation = 'source-in'
    x.fillStyle = f
    x.fillRect(0, 0, t.width, t.height)
    return t
  }
  c.drawImage(fill(lo), d, d)
  c.drawImage(fill(hi), -d * 0.8, -d * 0.8)
  c.drawImage(fill(metal), 0, 0)
  if (tint) c.drawImage(fill(tint), 0, 0)
}

const cache = new Map<string, HTMLCanvasElement>()

/** The painted foil for a card at k pixels per design unit: transparent everywhere but the scratch regions. */
export function foilTexture(id: CardId, k: number, bonus: boolean): HTMLCanvasElement {
  // painted again once the display font has arrived (the badges' "?" use it)
  let fonts = false
  try {
    fonts = document.fonts?.check('800 30px Manrope') ?? false
  } catch {
    /* no font loading API */
  }
  const key = `${id}:${k.toFixed(3)}:${bonus ? 1 : 0}:${fonts ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  if (cache.size > 12) cache.clear()
  const st = FOIL[id]
  const W = CARD_W * k
  const H = CARD_H * k
  const out = canvas(W, H)
  const c = out.getContext('2d')!
  const regions = foilRegions(bonus)
  const rnd = seeded(id.length * 7919 + 13)

  c.save()
  c.beginPath()
  for (const g of regions) regionPath(c, g, k)
  c.clip()

  // 1. metallic banding along the diagonal, and a cross banding for the play of light
  const diag = (stops: [number, string][], x0: number, y0: number, x1: number, y1: number) => {
    const gr = c.createLinearGradient(x0 * k, y0 * k, x1 * k, y1 * k)
    for (const [o, col] of stops) gr.addColorStop(o, col)
    return gr
  }
  const baseGrad = diag(st.base, PANEL.x, PANEL.y, PANEL.x + PANEL.w, PANEL.y + PANEL.h * 1.15)
  c.fillStyle = baseGrad
  c.fillRect(0, 0, W, H)
  if (st.cross) {
    c.globalCompositeOperation = 'soft-light'
    c.globalAlpha = 0.55
    c.fillStyle = diag(st.cross, PANEL.x + PANEL.w, PANEL.y, PANEL.x, PANEL.y + PANEL.h)
    c.fillRect(0, 0, W, H)
    c.globalAlpha = 1
    c.globalCompositeOperation = 'source-over'
  }

  // 2. brushed grain: fine streaks of light and dark
  for (let y = PANEL.y; y < CARD_H; y += 0.9) {
    const a = rnd() * 0.07
    c.fillStyle = rnd() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 0.8})`
    c.fillRect(0, y * k, W, Math.max(1, 0.5 * k))
  }

  // 3. the motif lattice, embossed
  const mask = canvas(W, H)
  const m = mask.getContext('2d')!
  m.fillStyle = '#fff'
  const sp = st.spacing
  for (let row = -1, y = PANEL.y - sp / 2; y < CARD_H + sp; y += sp * 0.5, row++) {
    for (let x = PANEL.x - sp + (row % 2 ? sp / 2 : 0); x < CARD_W + sp; x += sp) {
      m.save()
      m.translate(x * k, y * k)
      m.rotate(((row % 2 ? -1 : 1) * Math.PI) / 14)
      st.motif(m, st.size * k)
      m.restore()
    }
  }
  // keep the lattice off the badges, so the "?" marks read cleanly
  m.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < 9; i++) {
    const p = cellCenter(i)
    m.beginPath()
    m.arc(p.x * k, p.y * k, 31 * k, 0, Math.PI * 2)
    m.fill()
  }
  if (bonus) {
    m.beginPath()
    m.arc(BONUS.cx * k, BONUS.cy * k, BONUS.r * k, 0, Math.PI * 2)
    m.fill()
  }
  emboss(c, mask, Math.max(1, 0.85 * k), st.hi, st.lo, baseGrad, st.face)

  // 4. the badges: a pressed coin with a "?" over every cell (and "×?" on the bonus spot)
  const badges = canvas(W, H)
  const b = badges.getContext('2d')!
  b.fillStyle = '#fff'
  b.strokeStyle = '#fff'
  b.textAlign = 'center'
  b.textBaseline = 'middle'
  const mark = (x: number, y: number, r: number, text: string, size: number) => {
    b.lineWidth = 2.6 * k
    b.beginPath()
    b.arc(x * k, y * k, r * k, 0, Math.PI * 2)
    b.stroke()
    b.lineWidth = 1.1 * k
    b.beginPath()
    b.arc(x * k, y * k, (r - 4.5) * k, 0, Math.PI * 2)
    b.stroke()
    b.font = `800 ${size * k}px Manrope, system-ui, sans-serif`
    b.fillText(text, x * k, (y + size * 0.04) * k)
  }
  for (let i = 0; i < 9; i++) {
    const p = cellCenter(i)
    mark(p.x, p.y, 25, '?', 30)
  }
  if (bonus) mark(BONUS.cx, BONUS.cy, 26, '×?', 22)
  const face = c.createLinearGradient(0, PANEL.y * k, 0, (PANEL.y + PANEL.h) * k)
  face.addColorStop(0, st.badge.ring)
  face.addColorStop(1, st.badge.glyph)
  c.globalAlpha = 0.88
  emboss(c, badges, Math.max(1, 1.1 * k), st.badge.hi, st.badge.lo, baseGrad, face)
  c.globalAlpha = 1

  // 4b. a prismatic film (holographic foil): bands of hue repeating across the diagonal, screened over the metal and
  // soft-lit into it, so the bright bands of the chrome turn to rainbow and the dark ones stay black
  if (st.holo) {
    const h = st.holo
    const ux = 0.86
    const uy = 0.51
    const L = (CARD_W + CARD_H) * 2
    const ox = PANEL.x - 140
    const oy = (bonus ? BONUS.cy - BONUS.r : PANEL.y) - 140
    for (const [mode, alpha] of [
      ['soft-light', h.alpha * 1.3],
      ['screen', h.alpha * 0.14],
    ] as const) {
      c.globalCompositeOperation = mode
      c.globalAlpha = Math.min(1, alpha)
      for (let s0 = 0; s0 < L; s0 += h.period) {
        const s1 = s0 + h.period
        const g = c.createLinearGradient((ox + ux * s0) * k, (oy + uy * s0) * k, (ox + ux * s1) * k, (oy + uy * s1) * k)
        h.colors.forEach((col, i) => g.addColorStop(i / (h.colors.length - 1), col))
        c.fillStyle = g
        c.beginPath()
        c.moveTo((ox + ux * s0 - uy * L) * k, (oy + uy * s0 + ux * L) * k)
        c.lineTo((ox + ux * s0 + uy * L) * k, (oy + uy * s0 - ux * L) * k)
        c.lineTo((ox + ux * s1 + uy * L) * k, (oy + uy * s1 - ux * L) * k)
        c.lineTo((ox + ux * s1 - uy * L) * k, (oy + uy * s1 + ux * L) * k)
        c.closePath()
        c.fill()
      }
    }
    c.globalCompositeOperation = 'source-over'
    c.globalAlpha = 1
  }

  // 5. grain: a little noise in every pixel
  // (the bonus spot sits inside the panel's columns, above it)
  const bx0 = Math.max(0, Math.floor(PANEL.x * k) - 2)
  const by0 = Math.max(0, Math.floor((bonus ? BONUS.cy - BONUS.r : PANEL.y) * k) - 2)
  const bx1 = Math.min(out.width, Math.ceil((PANEL.x + PANEL.w) * k) + 2)
  const by1 = Math.min(out.height, Math.ceil((PANEL.y + PANEL.h) * k) + 2)
  const img = c.getImageData(bx0, by0, bx1 - bx0, by1 - by0)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue
    const n = (rnd() - 0.5) * st.grain
    d[i] = Math.max(0, Math.min(255, d[i] + n))
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n))
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n))
  }
  c.putImageData(img, bx0, by0)

  // 6. glitter: a scatter of bright specks, a few of them crossed like a star
  const area = PANEL.w * PANEL.h + (bonus ? Math.PI * BONUS.r * BONUS.r : 0)
  const n = Math.round((area / 1000) * st.glitter)
  for (let i = 0; i < n; i++) {
    let x: number
    let y: number
    if (bonus && i % 9 === 0) {
      const a = rnd() * Math.PI * 2
      const r = Math.sqrt(rnd()) * BONUS.r
      x = BONUS.cx + Math.cos(a) * r
      y = BONUS.cy + Math.sin(a) * r
    } else {
      x = PANEL.x + rnd() * PANEL.w
      y = PANEL.y + rnd() * PANEL.h
    }
    const a = 0.35 + rnd() * 0.65
    const s = (0.35 + rnd() * 0.6) * k
    c.fillStyle = `rgba(255,255,255,${a})`
    c.fillRect(x * k - s / 2, y * k - s / 2, s, s)
    if (rnd() < 0.08) {
      c.fillStyle = `rgba(255,255,255,${a * 0.6})`
      c.fillRect(x * k - s * 2.5, y * k - s * 0.15, s * 5, s * 0.3)
      c.fillRect(x * k - s * 0.15, y * k - s * 2.5, s * 0.3, s * 5)
    }
  }

  // 7. a broad soft highlight across the panel
  const sheen = c.createLinearGradient(PANEL.x * k, PANEL.y * k, (PANEL.x + PANEL.w) * k, (PANEL.y + PANEL.h) * k)
  sheen.addColorStop(0, 'rgba(255,255,255,.22)')
  sheen.addColorStop(0.3, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.62, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.72, 'rgba(255,255,255,.14)')
  sheen.addColorStop(0.8, 'rgba(255,255,255,0)')
  c.fillStyle = sheen
  c.fillRect(0, 0, W, H)
  c.restore()

  // 8. the bevel: light along the top left edge, shade along the bottom right, and a thin dark rim
  for (const g of regions) {
    c.save()
    c.beginPath()
    regionPath(c, g, k)
    c.clip()
    c.lineWidth = 2.2 * k
    // the outline shifted down-right shows only along the top and left inside edges, and the other way round
    c.translate(1.2 * k, 1.2 * k)
    c.strokeStyle = 'rgba(255,255,255,.55)'
    c.beginPath()
    regionPath(c, g, k)
    c.stroke()
    c.translate(-2.4 * k, -2.4 * k)
    c.strokeStyle = 'rgba(0,0,0,.28)'
    c.beginPath()
    regionPath(c, g, k)
    c.stroke()
    c.restore()
    c.lineWidth = Math.max(1, 0.8 * k)
    c.strokeStyle = 'rgba(0,0,0,.35)'
    c.beginPath()
    regionPath(c, g, k, -0.4)
    c.stroke()
  }

  cache.set(key, out)
  return out
}

/* ---------------- brushes ---------------- */

const brushCache = new Map<number, HTMLCanvasElement[]>()

/**
 * Lets go of every painted foil and coin brush, once the game is left, so none of them outlives it. Only the maps are
 * emptied: a card still on its way out keeps drawing with what it holds, and the collector frees them after it.
 */
export function releaseFoilCaches() {
  cache.clear()
  brushCache.clear()
}

/**
 * Coin brushes of radius r pixels: irregular discs with a torn, crumbly rim and a few specks of foil left inside.
 * Drawn on the mask (opaque = scratched away).
 */
export function brushes(r: number): HTMLCanvasElement[] {
  const key = Math.round(r * 2) / 2
  const hit = brushCache.get(key)
  if (hit) return hit
  // every scale the card is shown at adds a few sizes: start over rather than keep them all
  if (brushCache.size > 48) brushCache.clear()
  const rnd = seeded(Math.round(key * 100))
  const list: HTMLCanvasElement[] = []
  const size = Math.ceil(key * 2.7)
  const c0 = size / 2
  for (let v = 0; v < 6; v++) {
    const cv = canvas(size, size)
    const c = cv.getContext('2d')!
    // the disc: a wobbly outline from a few sine harmonics
    const ph = [rnd() * 6, rnd() * 6, rnd() * 6]
    c.beginPath()
    const N = 48
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      const w = 0.9 + 0.05 * Math.sin(a * 3 + ph[0]) + 0.04 * Math.sin(a * 5 + ph[1]) + 0.025 * Math.sin(a * 11 + ph[2]) + (rnd() - 0.5) * 0.05
      const x = c0 + Math.cos(a) * key * w
      const y = c0 + Math.sin(a) * key * w
      if (i) c.lineTo(x, y)
      else c.moveTo(x, y)
    }
    c.closePath()
    const g = c.createRadialGradient(c0, c0, 0, c0, c0, key)
    // white, so the mask can light the foil's cut edge as well as cut it (the engine only reads its alpha to cut)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.78, 'rgba(255,255,255,1)')
    g.addColorStop(1, 'rgba(255,255,255,.82)')
    c.fillStyle = g
    c.fill()
    // crumbs torn off round the rim
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2
      const rr = key * (0.86 + rnd() * 0.24)
      const s = Math.max(0.5, key * (0.025 + rnd() * 0.07))
      c.globalAlpha = 0.45 + rnd() * 0.55
      c.beginPath()
      c.arc(c0 + Math.cos(a) * rr, c0 + Math.sin(a) * rr, s, 0, Math.PI * 2)
      c.fill()
    }
    // specks of foil that cling on inside the stroke (the next pass takes them)
    c.globalCompositeOperation = 'destination-out'
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2
      const rr = key * Math.sqrt(rnd()) * 0.8
      const s = Math.max(0.5, key * (0.02 + rnd() * 0.05))
      c.globalAlpha = 0.5 + rnd() * 0.5
      c.beginPath()
      c.ellipse(c0 + Math.cos(a) * rr, c0 + Math.sin(a) * rr, s * 1.6, s, rnd() * 3, 0, Math.PI * 2)
      c.fill()
    }
    list.push(cv)
  }
  brushCache.set(key, list)
  return list
}

/**
 * The shape a revealed cell's leftover foil is cleared with: its rectangle grown a little, with rounded corners and
 * a ragged edge, so the hole looks scratched rather than cut.
 */
export function raggedRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, rough: number, rnd: () => number) {
  const pts: [number, number][] = []
  const step = Math.max(2, rough * 1.6)
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const n = Math.max(2, Math.round(len / step))
    const nx = (y1 - y0) / len
    const ny = -(x1 - x0) / len
    for (let i = 0; i < n; i++) {
      const t = i / n
      const j = (rnd() - 0.35) * rough
      pts.push([x0 + (x1 - x0) * t - nx * j, y0 + (y1 - y0) * t - ny * j])
    }
  }
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i < 4; i++) {
      const a = a0 + (i / 4) * (Math.PI / 2)
      const j = (rnd() - 0.35) * rough
      pts.push([cx + Math.cos(a) * (r + j), cy + Math.sin(a) * (r + j)])
    }
  }
  edge(x + r, y, x + w - r, y)
  corner(x + w - r, y + r, -Math.PI / 2)
  edge(x + w, y + r, x + w, y + h - r)
  corner(x + w - r, y + h - r, 0)
  edge(x + w - r, y + h, x + r, y + h)
  corner(x + r, y + h - r, Math.PI / 2)
  edge(x, y + h - r, x, y + r)
  corner(x + r, y + r, Math.PI)
  c.beginPath()
  pts.forEach(([px, py], i) => (i ? c.lineTo(px, py) : c.moveTo(px, py)))
  c.closePath()
}

export { seeded }
