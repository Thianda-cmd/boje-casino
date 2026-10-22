import { useEffect, type ReactNode, type RefObject } from 'react'

/*
  Shared bits for the animated cosmetics: the frames in fx-frames.tsx, the auras in auras.tsx and the name styles and
  title plates in fx-names.ts.

  - Geometry on the 100-unit grid the frames are drawn in (the avatar's middle at 50, 50): points on circles, a
    sparkle, jagged bolts, a flame tongue, and a small seeded random sequence so every scene comes out the same each
    time. All of it runs once, when the art is built, never per frame.
  - orbit(): something travelling round a tilted ellipse in 3D, passing in front of the avatar on the near half and
    behind it on the far half. It is two copies, one in the layer drawn over the avatar and one in the layer under
    it, each shown for its half of the turn. The motion is two CSS rotations: the group spins about the ellipse's
    middle inside a squashed group (which turns the circle into the ellipse), and the rider spins back the other way
    about itself and is unsquashed, so it travels the ellipse upright and undistorted. Nothing is computed per frame.
  - The keyframes several modules use, in one style sheet added to the page once (injectCss).
  - The motion rules every one of them follows. Every animated element carries a class starting with "bjx-", so one
    rule holds them all: for reduced motion the animations are paused rather than removed, and since every particle
    starts part-way through its cycle (a negative delay), a paused one stands where it would have been, which makes a
    natural still frame of the whole effect. The same pause is used for anything scrolled out of view: one shared
    IntersectionObserver marks an element data-bjx-off while it is offscreen (hidden tabs need nothing: the browser
    stops animating them by itself).
*/

/** a point on a circle round (cx, cy), angle in degrees (0 is right, 90 is down) */
export const at = (r: number, deg: number, cx = 50, cy = 50) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)] as const
/** the same as "x y" for a path */
export const P = (r: number, deg: number, cx?: number, cy?: number) => at(r, deg, cx, cy).map((v) => v.toFixed(2)).join(' ')
/** a number cut to two decimals, for path strings */
export const n2 = (v: number) => Math.round(v * 100) / 100
/** a four-pointed sparkle at (x, y) */
export const sparkle = (x: number, y: number, s: number) =>
  `M${n2(x)} ${n2(y - s)}Q${n2(x + s * 0.16)} ${n2(y - s * 0.16)} ${n2(x + s)} ${n2(y)}Q${n2(x + s * 0.16)} ${n2(y + s * 0.16)} ${n2(x)} ${n2(y + s)}Q${n2(x - s * 0.16)} ${n2(y + s * 0.16)} ${n2(x - s)} ${n2(y)}Q${n2(x - s * 0.16)} ${n2(y - s * 0.16)} ${n2(x)} ${n2(y - s)}Z`
/** an annulus sector between radii r0 and r1, angles a0 to a1 (degrees) */
export const sector = (r0: number, r1: number, a0: number, a1: number, cx = 50, cy = 50) =>
  `M${P(r0, a0, cx, cy)}L${P(r1, a0, cx, cy)}A${r1} ${r1} 0 0 1 ${P(r1, a1, cx, cy)}L${P(r0, a1, cx, cy)}A${r0} ${r0} 0 0 0 ${P(r0, a0, cx, cy)}Z`
/** an arc of a circle from a0 to a1 (degrees, clockwise) as an open path */
export const arc = (r: number, a0: number, a1: number, cx = 50, cy = 50) => `M${P(r, a0, cx, cy)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${P(r, a1, cx, cy)}`
/** a heart centred on (x, y), w wide */
export const heart = (x: number, y: number, w: number) => {
  const s = w / 8
  const p = (a: number, b: number) => `${n2(x + a * s)} ${n2(y + b * s)}`
  return `M${p(0, 3.4)}C${p(-1.8, 2.1)} ${p(-4, 0.5)} ${p(-4, -1.3)}C${p(-4, -3)} ${p(-2.8, -4)} ${p(-1.6, -4)}C${p(-0.8, -4)} ${p(-0.2, -3.5)} ${p(0, -2.8)}C${p(0.2, -3.5)} ${p(0.8, -4)} ${p(1.6, -4)}C${p(2.8, -4)} ${p(4, -3)} ${p(4, -1.3)}C${p(4, 0.5)} ${p(1.8, 2.1)} ${p(0, 3.4)}Z`
}
/** a flame tongue standing on (50, b), w half-wide and h tall, pointing up, with a lick to one side */
export const tongue = (w: number, h: number, b: number, x = 50) => {
  const p = (a: number, c: number) => `${n2(x + a * w)} ${n2(b - c * h)}`
  return `M${p(-1, 0)}C${p(-1.15, 0.38)} ${p(-0.35, 0.5)} ${p(-0.42, 0.78)}C${p(-0.1, 0.62)} ${p(0.18, 0.74)} ${p(0.04, 1)}C${p(0.7, 0.78)} ${p(1.2, 0.42)} ${p(1, 0)}Z`
}

/** a small deterministic random sequence in [0, 1) */
export function seq(seed: number) {
  let s = seed
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

/** a jagged line along a circle (an electric arc): from a0 to a1 at radius r, each kink up to `jit` off the circle */
export function arcBolt(rnd: () => number, r: number, a0: number, a1: number, jit: number, kinks = 7, cx = 50, cy = 50) {
  let d = ''
  for (let i = 0; i <= kinks; i++) {
    const a = a0 + ((a1 - a0) * i) / kinks
    const rr = i === 0 || i === kinks ? r : r + (rnd() * 2 - 1) * jit
    d += `${i ? 'L' : 'M'}${P(rr, a, cx, cy)}`
  }
  return d
}

/** a jagged bolt from (x0, y0) to (x1, y1) with `kinks` turns, each up to `jit` to the side; its path and the points it passed */
export function bolt(rnd: () => number, x0: number, y0: number, x1: number, y1: number, jit: number, kinks = 5) {
  const dx = x1 - x0
  const dy = y1 - y0
  const len = Math.hypot(dx, dy) || 1
  const nx = -dy / len
  const ny = dx / len
  const pts: [number, number][] = [[x0, y0]]
  for (let i = 1; i < kinks; i++) {
    const t = i / kinks + (rnd() - 0.5) * (0.5 / kinks)
    const o = (rnd() * 2 - 1) * jit
    pts.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o])
  }
  pts.push([x1, y1])
  return { d: pts.map(([x, y], i) => `${i ? 'L' : 'M'}${n2(x)} ${n2(y)}`).join(''), pts }
}

/** negative animation delays, so a particle starts part-way through its cycle (and stands there when paused) */
export const phase = (dur: number, frac: number) => `${-(dur * (((frac % 1) + 1) % 1)).toFixed(2)}s`
/** the timing style of an animated element: its duration and where in the cycle it starts */
export const tm = (dur: number, frac = 0) => ({ animationDuration: `${dur}s`, animationDelay: phase(dur, frac) })

/** adds (or refreshes, on a hot reload) a style sheet with this id */
export function injectCss(id: string, css: string) {
  if (typeof document === 'undefined') return
  const el = document.getElementById(id) ?? document.head.appendChild(Object.assign(document.createElement('style'), { id }))
  el.textContent = css
}

/*
  The shared keyframes. In SVG a CSS length is a user unit, so "50px 50px" is the middle of the 100-unit grid and a
  translate of 10px moves ten units at any size.
  - bjx-rot spins about the middle of the grid, bjx-rot0 about the element's own origin; bjx-rev turns either back.
  - bjx-tw twinkles (fades and scales in place), bjx-pulse breathes.
  - bjx-front / bjx-back show an orbit's rider on its near / far half (see orbit()).
  - bjx-fl licks a flame up from its base; bjx-zap and bjx-bolt flash an electric arc and a lightning strike.
  - bjx-drift carries a particle along (--dx, --dy) with a sway (--sx), a turn (--r) and a size change (--s0 to --s1).
*/
injectCss(
  'bjx-css',
  `@keyframes bjx-rot{to{transform:rotate(360deg)}}
.bjx-rot{transform-origin:50px 50px;animation:bjx-rot 12s linear infinite}
.bjx-rot0{transform-origin:0 0;animation:bjx-rot 12s linear infinite}
@keyframes bjx-tw{0%,100%{opacity:.08;transform:scale(.25)}50%{opacity:1;transform:scale(1)}}
.bjx-tw{transform-box:fill-box;transform-origin:center;animation:bjx-tw 2.6s ease-in-out infinite}
@keyframes bjx-pulse{0%,100%{opacity:.4}50%{opacity:1}}
.bjx-pulse{animation:bjx-pulse 2.4s ease-in-out infinite}
@keyframes bjx-front{0%,49.9%{opacity:1}50%,100%{opacity:0}}
@keyframes bjx-back{0%,49.9%{opacity:0}50%,100%{opacity:1}}
.bjx-front{animation:bjx-front 8s linear infinite}
.bjx-back{animation:bjx-back 8s linear infinite}
@keyframes bjx-fl{0%,100%{transform:scale(1,1) skewX(0)}25%{transform:scale(1.07,.8) skewX(5deg)}50%{transform:scale(.93,1.13) skewX(-4deg)}75%{transform:scale(1.02,.9) skewX(2deg)}}
.bjx-fl{transform-box:fill-box;transform-origin:50% 100%;animation:bjx-fl 1s ease-in-out infinite}
@keyframes bjx-zap{0%{opacity:1}6%{opacity:.25}9%{opacity:1}34%{opacity:.85}40%,100%{opacity:0}}
.bjx-zap{animation:bjx-zap 1.6s linear infinite}
@keyframes bjx-bolt{0%,88%,100%{opacity:0}89%{opacity:1}90.5%{opacity:.12}92%{opacity:1}95%{opacity:0}}
.bjx-bolt{animation:bjx-bolt 5s linear infinite}
@keyframes bjx-drift{0%{transform:translate(0,0) rotate(0) scale(var(--s0,1));opacity:0}12%{opacity:var(--o,1)}50%{transform:translate(var(--sx,0px),calc(var(--dy,0px) * .5)) rotate(calc(var(--r,0deg) * .5)) scale(calc((var(--s0,1) + var(--s1,1)) * .5))}86%{opacity:var(--o,1)}100%{transform:translate(var(--dx,0px),var(--dy,0px)) rotate(var(--r,0deg)) scale(var(--s1,1));opacity:0}}
.bjx-drift{transform-box:fill-box;transform-origin:center;animation:bjx-drift 5s linear infinite}
.bjx-rev{animation-direction:reverse}
[data-bjx-off] [class*="bjx-"],[data-bjx-off][class*="bjx-"]{animation-play-state:paused!important}
@media (prefers-reduced-motion:reduce){[class*="bjx-"],[class*="bjx-"]::before,[class*="bjx-"]::after{animation-play-state:paused!important}}`,
)

let io: IntersectionObserver | null = null
/** pauses every animation inside `el` while it is offscreen; returns the way to stop watching */
export function watchOffscreen(el: Element) {
  if (typeof IntersectionObserver === 'undefined') return () => {}
  io ??= new IntersectionObserver((list) => list.forEach((e) => e.target.toggleAttribute('data-bjx-off', !e.isIntersecting)), { rootMargin: '80px' })
  io.observe(el)
  return () => {
    io?.unobserve(el)
    el.removeAttribute('data-bjx-off')
  }
}

/** the hook form: watches `ref` while `on` */
export function useOffscreenPause(ref: RefObject<Element | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current
    return on && el ? watchOffscreen(el) : undefined
  }, [ref, on])
}

/** a path round a tilted ellipse: its middle, its radius along the long axis, how squashed it is, its tilt */
export interface Orbit {
  cx: number
  cy: number
  /** the long radius */
  R: number
  /** the short radius as a share of the long one */
  sq: number
  /** degrees, clockwise */
  tilt: number
  /** seconds per turn */
  dur: number
  /** where in the turn it starts (0 to 1) */
  frac: number
}

/** the half of an orbit nearer the viewer (front) or behind the avatar (back), as a path */
export const orbitHalf = (o: Orbit, half: 'front' | 'back') =>
  `M${n2(-o.R)} 0A${o.R} ${n2(o.R * o.sq)} 0 0 ${half === 'front' ? 0 : 1} ${o.R} 0`
export const orbitPlace = (o: Orbit) => `translate(${o.cx} ${o.cy}) rotate(${o.tilt})`

/** `child` (drawn round its own 0, 0) riding an orbit, in one of its two layers (see the top of this file), with a fading comet tail in `trail`'s colour */
export function orbit(o: Orbit, layer: 'front' | 'back', live: boolean, child: ReactNode, key?: string | number, trail?: string) {
  if (!live) {
    // a still: where it is at its starting point, in whichever layer that half belongs to
    const th = o.frac * 2 * Math.PI
    if (Math.sin(th) >= 0 !== (layer === 'front')) return null
    const x = o.R * Math.cos(th)
    const y = o.R * o.sq * Math.sin(th)
    return (
      <g key={key} transform={`${orbitPlace(o)} translate(${n2(x)} ${n2(y)}) rotate(${-o.tilt})`}>
        {child}
      </g>
    )
  }
  const t = tm(o.dur, o.frac)
  return (
    <g key={key} transform={orbitPlace(o)}>
      <g className={layer === 'front' ? 'bjx-front' : 'bjx-back'} style={t}>
        <g transform={`scale(1 ${o.sq})`}>
          <g className="bjx-rot0" style={t}>
            {trail &&
              [36, 22, 11].map((a, i) => (
                <path key={a} d={`M${P(o.R, -a, 0, 0)}A${o.R} ${o.R} 0 0 1 ${o.R} 0`} fill="none" stroke={trail} strokeOpacity={[0.14, 0.22, 0.34][i]} strokeWidth={[1.6, 2.2, 2.8][i]} strokeLinecap="round" />
              ))}
            <g transform={`translate(${o.R} 0)`}>
              <g className="bjx-rot0 bjx-rev" style={t}>
                <g transform={`scale(1 ${n2(1 / o.sq)}) rotate(${-o.tilt})`}>{child}</g>
              </g>
            </g>
          </g>
        </g>
      </g>
    </g>
  )
}
