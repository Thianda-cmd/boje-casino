/*
  Duck Derby art: the six rubber ducks, drawn from one model in two places. The model is a list of shapes (SVG path
  data and ellipses) in the duck's own coordinates: the waterline runs along y = 0, the beak tip is at x = NOSE_X and
  the tail at x = -50. The React <DuckArt> turns it into an SVG for the race card, slip and podium; drawDuck() draws
  the same shapes on the race canvas with Path2D, where the wing flaps, the beak quacks, the eyes blink and spin,
  Nugget's propeller turns and Dash's scarf streams out behind.
*/
import { memo, type CSSProperties } from 'react'
import { useUid } from '../../art/ids'
import { DUCKS } from './rules'

export const INK = '#26182f'
/** the beak tip, where a duck's progress is measured */
export const NOSE_X = 62
/** from the tail to the beak tip, in model units */
export const DUCK_LEN = 112

export type Expr = 'happy' | 'blink' | 'dizzy' | 'wow' | 'joy' | 'grit'

type Fill = string | 'G:body' | 'G:head' | 'G:lens'
interface Prim {
  d?: string
  /** ellipse: cx, cy, rx, ry, rotation in degrees */
  e?: [number, number, number, number, number?]
  fill?: Fill
  stroke?: string
  sw?: number
  a?: number
}
type Group = 'scarf' | 'body' | 'wing' | 'head' | 'neck' | 'beakTop' | 'beakBot' | 'eye' | 'hat' | 'prop'
interface Layer {
  g: Group
  prims: Prim[]
}

const SW = 3.2
const BEAK = '#ff8f1f'
const BEAK_DARK = '#e4600c'

const BODY = 'M -50 -47 C -43 -39 -46 -27 -40 -15 C -32 -1 -10 3 12 2 C 34 1 47 -9 45 -26 C 43 -38 33 -44 22 -44 L 4 -44 C -10 -44 -22 -37 -34 -39 C -42 -40 -46 -43 -50 -47 Z'
const BELLY = 'M -40 -15 C -32 -1 -10 3 12 2 C 34 1 47 -9 45 -26 C 41 -15 24 -9 4 -9 C -16 -9 -30 -10 -40 -15 Z'
const WING = 'M -17 -31 C -5 -40 16 -36 21 -25 C 15 -14 -1 -12 -13 -19 C -16 -20.5 -17.5 -22.5 -16.5 -24.5 C -19.5 -26 -20 -29 -17 -31 Z'
const WING_LINES = 'M -4 -22 C 2 -27 10 -28 16 -25 M -9 -27 C -4 -32 4 -33 10 -31'
const BEAK_TOP = 'M 39 -65 C 49 -71 60 -67 62 -60.5 C 56 -56.5 46 -56.5 39.5 -57.5 Z'
const BEAK_BOT = 'M 40.5 -57.5 C 47 -55.5 55 -55.5 58.5 -54.5 C 54 -48.5 45 -48.5 40 -52 Z'
/** the lower beak hinges here */
export const BEAK_HINGE = [41, -56] as const
/** the wing pivots at the shoulder */
export const WING_PIVOT = [-14, -30] as const
export const HEAD = { cx: 22, cy: -62, r: 22 }
/** the race number, on the wing */
const BIB = [-32, -23] as const

function eyes(expr: Expr): Prim[] {
  const cx = 29
  const cy = -67
  switch (expr) {
    case 'blink':
      return [{ d: `M ${cx - 6} ${cy + 1} C ${cx - 3} ${cy + 4} ${cx + 3} ${cy + 4} ${cx + 6} ${cy + 1}`, stroke: INK, sw: 2.8 }]
    case 'joy':
      return [{ d: `M ${cx - 6} ${cy + 2} C ${cx - 3} ${cy - 5} ${cx + 3} ${cy - 5} ${cx + 6} ${cy + 2}`, stroke: INK, sw: 3 }]
    case 'dizzy':
      return [
        { e: [cx, cy, 7, 8.5], fill: '#fff', stroke: INK, sw: 2.4 },
        { d: `M ${cx} ${cy} m 0 -1 c 2 0 2.6 2.4 0.8 3.2 c -2.6 1 -4.4 -1.8 -3.2 -4 c 1.6 -3 6.2 -2.4 7 0.8 c 0.8 3.6 -2.2 6.6 -5.8 6.2`, stroke: INK, sw: 1.8 },
      ]
    case 'wow':
      return [
        { e: [cx, cy - 0.5, 7.6, 9.6], fill: '#fff', stroke: INK, sw: 2.4 },
        { e: [cx + 1.5, cy, 3, 3.4], fill: INK },
        { e: [cx + 0.6, cy - 1.6, 1.2, 1.2], fill: '#fff' },
      ]
    default:
      return [
        { e: [cx, cy, 6.6, 8.2], fill: '#fff', stroke: INK, sw: 2.4 },
        { e: [cx + 2, cy + 1, 4.2, 4.8], fill: INK },
        { e: [cx + 0.6, cy - 1.6, 1.7, 1.7], fill: '#fff' },
        { e: [cx + 4, cy + 3.2, 0.8, 0.8], fill: '#fff', a: 0.8 },
        ...(expr === 'grit' ? [{ d: `M ${cx - 7} ${cy - 12} L ${cx + 7} ${cy - 8}`, stroke: INK, sw: 3.4 }] : []),
      ]
  }
}

/** each duck's look: hats, scarves, bows */
function accessory(lane: number): Layer[] {
  switch (lane) {
    case 0: // Quackers: a red neckerchief and a curl on top
      return [
        {
          g: 'neck',
          prims: [
            { d: 'M 3 -46 C 14 -39 30 -39 40 -46 L 37 -37 C 30 -32 25 -30 22 -24 C 17 -30 9 -36 3 -46 Z', fill: '#ff4b55', stroke: INK, sw: 2.6 },
            { e: [15, -38, 1.8, 1.8], fill: '#fff' },
            { e: [27, -36, 1.8, 1.8], fill: '#fff' },
            { e: [22, -30, 1.5, 1.5], fill: '#fff' },
          ],
        },
        { g: 'head', prims: [{ d: 'M 15 -82 C 10 -91 16 -97 21 -93 M 21 -84 C 20 -95 29 -98 31 -91', stroke: INK, sw: 3 }] },
      ]
    case 1: // Puddles: a yellow sou'wester
      return [
        {
          g: 'hat',
          prims: [
            { d: 'M -2 -72 C -10 -64 -10 -55 -3 -50 C 1 -57 4 -64 6 -70 Z', fill: '#ffc928', stroke: INK, sw: 2.6 },
            { d: 'M 4 -75 C 5 -93 37 -96 41 -77 Z', fill: '#ffd93d', stroke: INK, sw: 2.6 },
            { d: 'M -5 -73 C 8 -82 36 -84 52 -75 C 40 -70 8 -68 -5 -73 Z', fill: '#ffc928', stroke: INK, sw: 2.6 },
            { d: 'M 9 -86 C 16 -91 28 -91 34 -86', stroke: '#fff4b0', sw: 2.4, a: 0.9 },
          ],
        },
      ]
    case 2: // Sir Waddles: a top hat and a monocle
      return [
        {
          g: 'hat',
          prims: [
            { d: 'M 9 -80 L 11 -106 C 17 -108.5 26 -108.5 32 -106 L 31 -80 Z', fill: '#2c2238', stroke: INK, sw: 2.6 },
            { d: 'M 9.5 -88 L 31.5 -88 L 31.2 -82 L 9.4 -82 Z', fill: '#d6334f' },
            { e: [20.5, -80, 19, 4.6, -6], fill: '#2c2238', stroke: INK, sw: 2.6 },
            { d: 'M 14 -103 L 15 -91', stroke: '#fff', sw: 2, a: 0.25 },
          ],
        },
        {
          g: 'eye',
          prims: [
            { e: [29, -67, 9.6, 10.2], fill: '#ffffff', a: 0.22 },
            { e: [29, -67, 9.6, 10.2], stroke: '#f2c14e', sw: 2.6 },
            { d: 'M 25 -57.5 C 22 -48 14 -46 8 -40', stroke: '#f2c14e', sw: 1.6 },
          ],
        },
      ]
    case 3: // Bubbles: a polka-dot bow and lashes
      return [
        {
          g: 'hat',
          prims: [
            { d: 'M 19 -84 C 6 -99 -1 -84 8 -79 C 12 -78 16 -80 19 -84 Z', fill: '#ff3f8e', stroke: INK, sw: 2.6 },
            { d: 'M 21 -84 C 34 -99 41 -84 32 -79 C 28 -78 24 -80 21 -84 Z', fill: '#ff3f8e', stroke: INK, sw: 2.6 },
            { e: [9, -86, 1.6, 1.6], fill: '#fff' },
            { e: [33, -87, 1.6, 1.6], fill: '#fff' },
            { e: [12, -82, 1.3, 1.3], fill: '#fff' },
            { e: [30, -82, 1.3, 1.3], fill: '#fff' },
            { e: [20, -83, 4.4, 4.4], fill: '#ff6faa', stroke: INK, sw: 2.4 },
          ],
        },
        { g: 'eye', prims: [{ d: 'M 25 -75 L 23 -79 M 29 -76 L 29 -80.5 M 33 -75 L 35 -79', stroke: INK, sw: 2 }] },
      ]
    case 4: // Dash: racing goggles and a streaming scarf
      return [
        {
          g: 'scarf',
          prims: [{ d: 'M 8 -42 C -4 -45 -18 -52 -34 -50 C -28 -46 -26 -42 -30 -38 C -18 -40 -6 -36 4 -36 Z', fill: '#ff4b55', stroke: INK, sw: 2.6 }],
        },
        {
          g: 'neck',
          prims: [
            { d: 'M 3 -47 C 14 -40 30 -40 40 -47 L 39 -38 C 28 -33 14 -33 3 -38 Z', fill: '#ff4b55', stroke: INK, sw: 2.6 },
            { d: 'M 9 -44 L 9 -37 M 17 -42 L 17 -35 M 25 -42 L 25 -35 M 33 -43 L 33 -36', stroke: '#fff', sw: 2.2, a: 0.85 },
          ],
        },
        {
          g: 'head',
          prims: [
            { d: 'M 0.5 -70 C 8 -77 20 -80 26 -80', stroke: INK, sw: 5.6 },
            { d: 'M 0.5 -70 C 8 -77 20 -80 26 -80', stroke: '#ff4b55', sw: 2.6 },
            { e: [33.5, -79, 10.4, 9, -12], fill: '#4a4060', stroke: INK, sw: 2.8 },
            { e: [34, -79, 7.4, 6.2, -12], fill: 'G:lens', stroke: INK, sw: 1.8 },
            { d: 'M 29.5 -81.5 C 31 -83.6 34 -84.4 36.4 -83.6', stroke: '#fff', sw: 2.2, a: 0.95 },
          ],
        },
      ]
    default: // Nugget: a propeller beanie
      return [
        {
          g: 'hat',
          prims: [
            { d: 'M 4 -77 C 5 -95 39 -95 40 -77 C 30 -73 14 -73 4 -77 Z', fill: '#4aa8ff', stroke: INK, sw: 2.6 },
            { d: 'M 15 -92 C 13 -86 13 -80 14 -74.5 L 22 -74 C 22 -80 22 -88 22 -93.5 Z', fill: '#ffd23f' },
            { d: 'M 29 -92 C 31 -86 31 -80 30 -74.5 L 22 -74 L 22 -93.5 Z', fill: '#ff4b55' },
            { d: 'M 4 -77 C 5 -95 39 -95 40 -77 C 30 -73 14 -73 4 -77 Z', stroke: INK, sw: 2.6 },
            { d: 'M 22 -93 L 22 -101', stroke: INK, sw: 2.8 },
          ],
        },
        {
          g: 'prop',
          prims: [
            { e: [13.5, -102, 9, 3, 0], fill: '#ffd23f', stroke: INK, sw: 2.2 },
            { e: [30.5, -102, 9, 3, 0], fill: '#ff4b55', stroke: INK, sw: 2.2 },
            { e: [22, -102, 2.6, 2.6], fill: INK },
          ],
        },
      ]
  }
}

/** the duck's layers back to front */
function model(lane: number, expr: Expr): Layer[] {
  const acc = accessory(lane)
  const pick = (g: Group) => acc.filter((l) => l.g === g).flatMap((l) => l.prims)
  return [
    { g: 'scarf', prims: pick('scarf') },
    {
      g: 'body',
      prims: [
        { d: BODY, fill: 'G:body', stroke: INK, sw: SW },
        { d: BELLY, fill: DUCKS[lane].dark, a: 0.38 },
        { e: [-15, -35, 12, 4, -10], fill: '#fff', a: 0.5 },
      ],
    },
    { g: 'wing', prims: [{ d: WING, fill: DUCKS[lane].color, stroke: INK, sw: 2.8 }, { d: WING_LINES, stroke: DUCKS[lane].dark, sw: 2 }] },
    {
      g: 'head',
      prims: [
        { e: [HEAD.cx, HEAD.cy, HEAD.r, HEAD.r], fill: 'G:head', stroke: INK, sw: SW },
        { e: [12, -74, 7, 4, -32], fill: '#fff', a: 0.55 },
        { e: [19, -53.5, 6, 3.6], fill: '#ff6d93', a: 0.45 },
        ...pick('head'),
      ],
    },
    { g: 'neck', prims: pick('neck') },
    { g: 'beakBot', prims: [{ d: BEAK_BOT, fill: BEAK_DARK, stroke: INK, sw: 2.6 }] },
    { g: 'beakTop', prims: [{ d: BEAK_TOP, fill: BEAK, stroke: INK, sw: 2.6 }, { d: 'M 46 -64.5 C 50 -66 54 -65.5 56 -64', stroke: '#ffd08a', sw: 2, a: 0.9 }] },
    { g: 'eye', prims: [...eyes(expr), ...pick('eye')] },
    { g: 'hat', prims: pick('hat') },
    { g: 'prop', prims: pick('prop') },
  ]
}

/* ---------------- SVG ---------------- */

function gradients(lane: number, u: string) {
  const d = DUCKS[lane]
  return (
    `<radialGradient id="${u}b" gradientUnits="userSpaceOnUse" cx="-12" cy="-40" r="64"><stop offset="0" stop-color="${d.light}"/><stop offset=".45" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></radialGradient>` +
    `<radialGradient id="${u}h" gradientUnits="userSpaceOnUse" cx="14" cy="-74" r="32"><stop offset="0" stop-color="${d.light}"/><stop offset=".5" stop-color="${d.color}"/><stop offset="1" stop-color="${d.dark}"/></radialGradient>` +
    `<linearGradient id="${u}l" gradientUnits="userSpaceOnUse" x1="26" y1="-86" x2="40" y2="-70"><stop offset="0" stop-color="#e6fbff"/><stop offset=".5" stop-color="#5fd8ff"/><stop offset="1" stop-color="#1b7fc4"/></linearGradient>`
  )
}

function primSvg(p: Prim, u: string) {
  const fill = p.fill == null ? 'none' : p.fill === 'G:body' ? `url(#${u}b)` : p.fill === 'G:head' ? `url(#${u}h)` : p.fill === 'G:lens' ? `url(#${u}l)` : p.fill
  const st = p.stroke ? ` stroke="${p.stroke}" stroke-width="${p.sw ?? SW}" stroke-linecap="round" stroke-linejoin="round"` : ''
  const op = p.a != null ? ` opacity="${p.a}"` : ''
  if (p.d) return `<path d="${p.d}" fill="${fill}"${st}${op}/>`
  const [cx, cy, rx, ry, rot = 0] = p.e!
  return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : ''} fill="${fill}"${st}${op}/>`
}

/** the inside of a duck's SVG (its own coordinates), with the beak opened by `beak` degrees */
export function duckMarkup(lane: number, u: string, expr: Expr = 'happy', beak = 0, bib = true) {
  let s = `<defs>${gradients(lane, u)}</defs>`
  for (const layer of model(lane, expr)) {
    if (!layer.prims.length) continue
    const inner = layer.prims.map((p) => primSvg(p, u)).join('')
    if (layer.g === 'beakBot' && beak) s += `<g transform="rotate(${beak} ${BEAK_HINGE[0]} ${BEAK_HINGE[1]})">${inner}</g>`
    else s += inner
    if (layer.g === 'body' && bib) s += bibSvg(lane)
  }
  return s
}

function bibSvg(lane: number) {
  return (
    `<g transform="translate(${BIB[0]} ${BIB[1]})"><circle r="8" fill="#fff" stroke="${INK}" stroke-width="2.2"/>` +
    `<text y="4.3" text-anchor="middle" font-size="12" font-weight="900" fill="${INK}" font-family="Manrope, system-ui, sans-serif">${lane + 1}</text></g>`
  )
}

/** the viewBox that fits every duck, hats included */
export const DUCK_VIEWBOX = '-56 -112 124 120'

/** a duck for the race card, slip and podium */
export const DuckArt = memo(function DuckArt({ lane, size = 48, expr = 'happy', beak = 0, bib = true, className = '', style }: { lane: number; size?: number; expr?: Expr; beak?: number; bib?: boolean; className?: string; style?: CSSProperties }) {
  const u = useUid()
  return <svg viewBox={DUCK_VIEWBOX} width={size} height={(size * 120) / 124} className={className} style={style} aria-hidden dangerouslySetInnerHTML={{ __html: duckMarkup(lane, u, expr, beak, bib) }} />
})

/** a duck's head in a round badge: the position strip and the history */
export const DuckBadge = memo(function DuckBadge({ lane, size = 28, ring = true }: { lane: number; size?: number; ring?: boolean }) {
  const u = useUid()
  const d = DUCKS[lane]
  return (
    <svg viewBox="-4 -94 56 56" width={size} height={size} aria-hidden className="shrink-0">
      <circle cx="24" cy="-66" r="27" fill={d.dark} />
      <circle cx="24" cy="-66" r={ring ? 24.5 : 27} fill={`url(#${u}bg)`} />
      <defs>
        <radialGradient id={`${u}bg`} cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" />
          <stop offset="1" stopColor={d.light} />
        </radialGradient>
        <clipPath id={`${u}c`}>
          <circle cx="24" cy="-66" r={ring ? 24.5 : 27} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}c)`} dangerouslySetInnerHTML={{ __html: duckMarkup(lane, u + 'd', 'happy', 0, false) }} transform="translate(-6 8) scale(1.05)" />
    </svg>
  )
})

/* ---------------- canvas ---------------- */

interface CanvasDuck {
  layers: { g: Group; prims: { path: Path2D | null; e?: Prim['e']; fill: string | CanvasGradient | null; stroke?: string; sw: number; a: number }[] }[]
}
const cache = new Map<string, CanvasDuck>()

function canvasDuck(ctx: CanvasRenderingContext2D, lane: number, expr: Expr): CanvasDuck {
  const key = `${lane}:${expr}`
  let c = cache.get(key)
  if (c) return c
  const d = DUCKS[lane]
  const rg = (cx: number, cy: number, r: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, d.light)
    g.addColorStop(0.47, d.color)
    g.addColorStop(1, d.dark)
    return g
  }
  const lens = ctx.createLinearGradient(26, -86, 40, -70)
  lens.addColorStop(0, '#e6fbff')
  lens.addColorStop(0.5, '#5fd8ff')
  lens.addColorStop(1, '#1b7fc4')
  const fills: Record<string, CanvasGradient> = { 'G:body': rg(-12, -40, 64), 'G:head': rg(14, -74, 32), 'G:lens': lens }
  c = {
    layers: model(lane, expr).map((l) => ({
      g: l.g,
      prims: l.prims.map((p) => ({
        path: p.d ? new Path2D(p.d) : null,
        e: p.e,
        fill: p.fill == null ? null : (fills[p.fill] ?? p.fill),
        stroke: p.stroke,
        sw: p.sw ?? SW,
        a: p.a ?? 1,
      })),
    })),
  }
  cache.set(key, c)
  return c
}

export interface DuckPose {
  expr: Expr
  /** lower beak open, degrees */
  beak: number
  /** wing raised, degrees */
  wing: number
  /** head tilt, degrees */
  head: number
  /** propeller phase and scarf flutter, radians */
  spin: number
  flutter: number
}

const DEG = Math.PI / 180
const HEAD_GROUPS = new Set<Group>(['head', 'beakTop', 'beakBot', 'eye', 'hat', 'prop'])

/** draws a duck in the context's current transform (its own model units) */
export function drawDuck(ctx: CanvasRenderingContext2D, lane: number, pose: DuckPose, part: 'all' | 'still' | 'moving' = 'all') {
  const duck = canvasDuck(ctx, lane, pose.expr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const layer of duck.layers) {
    if (!layer.prims.length) continue
    // 'still' is the duck at rest without its propeller and scarf (a sprite); 'moving' is just those two
    const moving = layer.g === 'prop' || layer.g === 'scarf'
    if ((part === 'still' && moving) || (part === 'moving' && !moving)) continue
    ctx.save()
    if (layer.g === 'wing' && pose.wing) rotateAbout(ctx, WING_PIVOT[0], WING_PIVOT[1], -pose.wing * DEG)
    if (pose.head && HEAD_GROUPS.has(layer.g)) rotateAbout(ctx, 18, -44, pose.head * DEG)
    if (layer.g === 'beakBot' && pose.beak) rotateAbout(ctx, BEAK_HINGE[0], BEAK_HINGE[1], pose.beak * DEG)
    if (layer.g === 'prop') {
      ctx.translate(22, 0)
      ctx.scale(Math.cos(pose.spin), 1)
      ctx.translate(-22, 0)
    }
    if (layer.g === 'scarf') {
      // the tail of the scarf ripples: a little shear and stretch about the knot
      ctx.translate(6, -42)
      ctx.transform(1 + 0.08 * Math.sin(pose.flutter), 0.18 * Math.sin(pose.flutter * 1.3), 0, 1, 0, 0)
      ctx.translate(-6, 42)
    }
    for (const p of layer.prims) {
      ctx.globalAlpha = p.a
      if (p.path) {
        if (p.fill) {
          ctx.fillStyle = p.fill
          ctx.fill(p.path)
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke
          ctx.lineWidth = p.sw
          ctx.stroke(p.path)
        }
      } else if (p.e) {
        const [cx, cy, rx, ry, rot = 0] = p.e
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, rot * DEG, 0, Math.PI * 2)
        if (p.fill) {
          ctx.fillStyle = p.fill
          ctx.fill()
        }
        if (p.stroke) {
          ctx.strokeStyle = p.stroke
          ctx.lineWidth = p.sw
          ctx.stroke()
        }
      }
    }
    ctx.restore()
    if (layer.g === 'body') drawBib(ctx, lane)
  }
  ctx.globalAlpha = 1
}

/** the model's extent, hats and tails included */
const BOUNDS = { x0: -58, y0: -112, x1: 68, y1: 8 }
const REST: Omit<DuckPose, 'expr'> = { beak: 0, wing: 0, head: 0, spin: 0, flutter: 0 }

export interface DuckSprite {
  img: HTMLCanvasElement
  /** where the image sits in model units */
  x: number
  y: number
  w: number
  h: number
}

/** a duck at rest (no propeller or scarf) drawn once at `k` pixels per model unit, for the race to stamp */
export function duckSprite(lane: number, expr: Expr, k: number): DuckSprite {
  const w = BOUNDS.x1 - BOUNDS.x0
  const h = BOUNDS.y1 - BOUNDS.y0
  const img = document.createElement('canvas')
  img.width = Math.ceil(w * k)
  img.height = Math.ceil(h * k)
  const g = img.getContext('2d')!
  g.scale(k, k)
  g.translate(-BOUNDS.x0, -BOUNDS.y0)
  drawDuck(g, lane, { expr, ...REST }, 'still')
  return { img, x: BOUNDS.x0, y: BOUNDS.y0, w, h }
}

function drawBib(ctx: CanvasRenderingContext2D, lane: number) {
  ctx.save()
  ctx.beginPath()
  ctx.arc(BIB[0], BIB[1], 8, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.lineWidth = 2.2
  ctx.strokeStyle = INK
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.font = '900 12px Manrope, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(String(lane + 1), BIB[0], BIB[1] + 4.3)
  ctx.restore()
}

function rotateAbout(ctx: CanvasRenderingContext2D, x: number, y: number, a: number) {
  ctx.translate(x, y)
  ctx.rotate(a)
  ctx.translate(-x, -y)
}
