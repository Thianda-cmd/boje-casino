import { PITCHES, type RouteId } from './rules'

/*
  Summit's geometry: where everything sits on the stage and on the mountain.

  The stage (layoutOf): a top bar, the altitude ladder down the right side, and the deck of route cards along the
  bottom; the mountain fills the rest and the camera keeps the climber's camp at `anchor`, about two thirds of the
  way down the open sky. The world (Geo) is the mountain side-on in stage pixels: x across the stage, y up from base
  camp (negative going up), the camps S apart. A camera altitude of a camps puts world y = -a·S at the anchor, so
  everything on screen sits at world y + anchor + a·S.

  The mountain narrows as it rises (halfWidth) and comes to its apex just above the summit camp. The camps zig-zag a
  little either side of its centre line, and each pitch between two camps can be climbed four ways (routeKeys): the
  Trail swings out in wide switchbacks, the Ridge arcs along a crest on the other side, the Cliff goes fairly
  straight with a jog or two, and the Sheer Wall goes up a vertical face. Each route is a Catmull-Rom curve through a
  few key points, sampled densely and measured, so the climber can be placed by the share of the way travelled.
*/

export interface Pt {
  x: number
  y: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function layoutOf(w: number, h: number) {
  const wide = w >= 640 && h >= 480
  const pad = wide ? 16 : 8
  const topH = wide ? 48 : 38
  const deckH = wide ? Math.round(clamp(h * 0.19, 128, 156)) : h >= 560 ? 112 : 100
  const deckY = h - pad - deckH
  const ladderW = wide ? Math.round(clamp(w * 0.15, 112, 138)) : 30
  const sw = w - ladderW - pad
  const cx = wide ? pad + (sw - pad) / 2 : (w - ladderW - pad) / 2 + 2
  const S = Math.round(clamp((deckY - topH) / (wide ? 3.1 : 2.9), 84, 200))
  const anchor = Math.round(topH + (deckY - topH) * 0.64)
  return {
    wide,
    w,
    h,
    pad,
    topH,
    deck: { x: pad, y: deckY, w: w - 2 * pad, h: deckH },
    ladder: { x: w - pad - ladderW, y: pad + topH + (wide ? 10 : 6), w: ladderW, h: deckY - (pad + topH + (wide ? 10 : 6)) - (wide ? 14 : 10) },
    geo: geoOf(w, h, cx, sw, S, anchor),
  }
}
export type Layout = ReturnType<typeof layoutOf>

export interface Geo {
  w: number
  h: number
  /** the mountain's centre line, and the width it has to itself */
  cx: number
  sw: number
  /** px between camps */
  S: number
  /** the stage y the camera keeps the climber's camp at */
  anchor: number
  /** the world's top and bottom edges (world y) */
  top: number
  bottom: number
}

export function geoOf(w: number, h: number, cx: number, sw: number, S: number, anchor: number): Geo {
  return { w, h, cx, sw, S, anchor, top: -(PITCHES * S + anchor + 90), bottom: h - anchor + 3.2 * S }
}

/* ---------------- the mountain ---------------- */

/** each camp's offset from the centre line, as a share of the mountain's width */
const DX = [-0.1, 0.06, -0.07, 0.07, -0.06, 0.06, -0.05, 0.05, -0.035, 0.03, 0]
/** the apex, a touch above the summit camp */
export const APEX = PITCHES + 0.1
/** the snow line, in camps */
export const SNOW = 6.1

export const campPt = (g: Geo, k: number): Pt => ({ x: g.cx + DX[clamp(Math.round(k), 0, PITCHES)] * g.sw, y: -k * g.S })
/** the screen y of world y at camera altitude a */
export const screenY = (g: Geo, y: number, a: number) => y + g.anchor + a * g.S

/** the mountain's half width at altitude a (camps), widening below base camp */
export function halfWidth(g: Geo, a: number): number {
  const hw0 = Math.max(g.sw * 0.54, 196)
  if (a <= 9) return hw0 * (1 - Math.max(-4, a) * 0.066)
  if (a >= APEX) return 0
  return hw0 * (1 - 9 * 0.066) * ((APEX - a) / (APEX - 9)) ** 0.8
}

/** a small deterministic noise in [-1, 1] for the rock's edges and texture */
export const jitter = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return (s - Math.floor(s)) * 2 - 1
}

/* ---------------- the routes ---------------- */

export function routeKeys(g: Geo, k: number, r: RouteId): Pt[] {
  const A = campPt(g, k)
  const B = campPt(g, k + 1)
  const s = B.x >= A.x ? 1 : -1
  const amp = Math.min(g.sw * 0.19, halfWidth(g, k + 0.5) * 0.6)
  const S = g.S
  const lx = (u: number) => A.x + (B.x - A.x) * u
  switch (r) {
    case 'trail':
      return [A, { x: A.x + s * amp, y: A.y - S * 0.3 }, { x: lx(0.5) - s * amp * 0.42, y: A.y - S * 0.63 }, B]
    case 'ridge':
      return [A, { x: lx(0.2) - s * amp * 0.75, y: A.y - S * 0.36 }, { x: lx(0.65) - s * amp * 0.7, y: A.y - S * 0.72 }, B]
    case 'cliff':
      return [A, { x: lx(0.3) + s * amp * 0.24, y: A.y - S * 0.34 }, { x: lx(0.55) - s * amp * 0.12, y: A.y - S * 0.68 }, B]
    case 'wall': {
      const x = lx(0.72)
      return [A, { x, y: A.y - S * 0.12 }, { x, y: B.y + S * 0.16 }, B]
    }
  }
}

function catmull(keys: Pt[], per = 18): Pt[] {
  const out: Pt[] = []
  for (let i = 0; i < keys.length - 1; i++) {
    const p0 = keys[Math.max(0, i - 1)]
    const p1 = keys[i]
    const p2 = keys[i + 1]
    const p3 = keys[Math.min(keys.length - 1, i + 2)]
    for (let j = 0; j < per; j++) {
      const t = j / per
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(keys[keys.length - 1])
  return out
}

/** a route sampled and measured */
export interface Path {
  pts: Pt[]
  /** distance along at each point */
  len: number[]
  total: number
}

export function routePath(g: Geo, k: number, r: RouteId): Path {
  const pts = catmull(routeKeys(g, k, r))
  const len = [0]
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  return { pts, len, total: len[len.length - 1] }
}

/** the point a share t of the way along a path, and the direction of travel there (1 right, -1 left) */
export function along(p: Path, t: number): Pt & { dir: 1 | -1 } {
  const d = clamp(t, 0, 1) * p.total
  let i = 1
  while (i < p.len.length - 1 && p.len[i] < d) i++
  const a = p.pts[i - 1]
  const b = p.pts[i]
  const seg = p.len[i] - p.len[i - 1] || 1
  const u = (d - p.len[i - 1]) / seg
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, dir: b.x >= a.x - 0.3 ? 1 : -1 }
}

export const dOf = (pts: readonly Pt[]) => 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')

/** where a falling climber is, a share t of the way through the fall: a pop off the rock, then a long drop */
export function fallPt(g: Geo, from: Pt, dir: number, t: number): Pt {
  return { x: from.x + dir * g.S * 0.62 * t, y: from.y - g.S * 0.18 * Math.sin(Math.min(1, t * 2.4) * Math.PI) + g.S * 2.9 * t * t }
}
