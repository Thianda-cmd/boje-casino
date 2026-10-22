import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useUid } from './ids'
import { P, arc, arcBolt, at, bolt, heart, injectCss, n2, orbit, orbitHalf, orbitPlace, seq, sparkle, tm, tongue, useOffscreenPause, type Orbit } from './fx-kit'

/*
  Auras: an animated effect round a player's framed avatar (src/store/cosmetics.ts has the thirteen and who may wear
  them). FramedAvatar draws one when it is given `aura` and is at least 44 px; Aura draws one round anything.

  An aura lives in a box half as big again as the avatar (a 150-unit grid from -25 to 125 round the frame's 100-unit
  one), so it can reach a quarter of the size past the frame on every side. It has two layers, one under the avatar
  and one over it, and each aura puts its parts where they belong: halo rays, shadow flames, the atomic glow and the
  Prism's light rays behind; sparkles, rising embers, bubbles, hearts, pixels breaking away and lightning in front;
  and the things that circle (butterflies, coins, electrons, crystal shards, the halo ring) pass in front on the near
  half of their path and behind on the far half (fx-kit's orbit()). Particles that rise or fall go mostly up the sides,
  so the avatar's face stays clear.

  Everything is SVG built once at load and moved by CSS animations (fx-kit.tsx: transforms and opacity, a particle's
  path given by a few CSS variables). The Prism's rays are conic gradients on plain elements, which the browser turns
  and tints without repainting. Smaller auras (under 72 px) carry about half the particles; `still` draws one frame
  with no animation at all, for thumbnails in lists. Reduced motion pauses everything where it stands (fx-kit).
*/

type Layer = (u: string, live: boolean, dense: boolean) => ReactNode
interface AuraArt {
  /** drawn under the avatar */
  back?: Layer
  /** drawn over the avatar and its frame */
  front?: Layer
  /** plain elements under everything, filling the aura's box */
  under?: (live: boolean) => ReactNode
}
const vars = (o: Record<string, string | number>) => o as CSSProperties
const px = (v = 0) => `${n2(v)}px`
const rad = (deg: number) => (deg * Math.PI) / 180

injectCss(
  'bjx-auras',
  `@keyframes bjx-bub{0%{transform:translate(0,0) scale(.55);opacity:0}8%{opacity:.95}25%{transform:translate(var(--sx),calc(var(--dy) * .25)) scale(.75)}50%{transform:translate(calc(var(--sx) * -1),calc(var(--dy) * .5)) scale(.9)}75%{transform:translate(var(--sx),calc(var(--dy) * .75)) scale(1)}93%{opacity:.9;transform:translate(0,calc(var(--dy) * .95)) scale(1.05)}100%{transform:translate(0,var(--dy)) scale(1.55);opacity:0}}
.bjx-bub{transform-box:fill-box;transform-origin:center;animation:bjx-bub 5s ease-in-out infinite}
@keyframes bjx-flap{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.16)}}
.bjx-flap{transform-box:fill-box;transform-origin:right center;animation:bjx-flap .3s ease-in-out infinite}
@keyframes bjx-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(var(--b,-3px))}}
.bjx-bob{animation:bjx-bob 1.2s ease-in-out infinite}
@keyframes bjx-coin{0%,100%{transform:scaleX(1)}50%{transform:scaleX(.1)}}
.bjx-coin{transform-box:fill-box;transform-origin:center;animation:bjx-coin 1.6s ease-in-out infinite}
@keyframes bjx-beat{0%,42%,100%{transform:scale(1)}10%{transform:scale(1.09)}20%{transform:scale(1)}30%{transform:scale(1.05)}}
.bjx-beat{transform-origin:50px 50px;animation:bjx-beat 1.5s ease-out infinite}
@keyframes bjx-wave{0%{transform:scale(.82);opacity:.85}100%{transform:scale(1.6);opacity:0}}
.bjx-wave{transform-origin:50px 50px;animation:bjx-wave 3s ease-out infinite}
@keyframes bjx-flk{0%,100%{opacity:.55}10%{opacity:.95}12%{opacity:.35}40%{opacity:.8}42%{opacity:.3}70%{opacity:.9}72%{opacity:.5}}
.bjx-flk{animation:bjx-flk 1.9s steps(1,end) infinite}
@keyframes bjx-pix{0%,100%{opacity:0}20%,45%{opacity:1}55%{opacity:.3}65%,80%{opacity:1}}
.bjx-pix{animation:bjx-pix 1.6s steps(1,end) infinite}
.bjx-steps{animation-timing-function:steps(4,end)!important}
.bjx-a-spin{transform-box:fill-box;transform-origin:center;animation:bjx-rot 3s linear infinite}
@keyframes bjx-hue{to{filter:hue-rotate(360deg)}}
.bjx-a-rays{animation:bjx-rot 48s linear infinite,bjx-hue 8s linear infinite}
.bjx-a-rays2{animation:bjx-rot 30s linear infinite reverse,bjx-hue 8s linear infinite}`,
)

/** a particle drifting along (dx, dy) from (x, y), with a sway, a turn and a size change (fx-kit's bjx-drift) */
interface Mote {
  x: number
  y: number
  dur: number
  f: number
  dx?: number
  dy?: number
  sx?: number
  r?: number
  s0?: number
  s1?: number
  o?: number
}
function drift(m: Mote, live: boolean, child: ReactNode, key: number, cls = 'bjx-drift') {
  if (!live)
    return (
      <g key={key} transform={`translate(${n2(m.x + (m.dx ?? 0) * m.f)} ${n2(m.y + (m.dy ?? 0) * m.f)})`} opacity={m.o ?? 1}>
        {child}
      </g>
    )
  return (
    <g key={key} className={cls} style={{ ...tm(m.dur, m.f), ...vars({ '--dx': px(m.dx), '--dy': px(m.dy), '--sx': px(m.sx), '--r': `${n2(m.r ?? 0)}deg`, '--s0': m.s0 ?? 1, '--s1': m.s1 ?? 1, '--o': m.o ?? 1 }) }}>
      <g transform={`translate(${n2(m.x)} ${n2(m.y)})`}>{child}</g>
    </g>
  )
}
/** n things spaced evenly round a turn: fn(index, share of the turn) */
const spaced = <T,>(n: number, fn: (i: number, f: number) => T) => Array.from({ length: n }, (_, i) => fn(i, i / n))
const halfOf = <T,>(list: T[], dense: boolean) => (dense ? list : list.filter((_, i) => i % 2 === 0))
const glowGrad = (id: string, c: string, o = 0.6) => (
  <radialGradient id={id}>
    <stop offset="0" stopColor={c} stopOpacity={o} />
    <stop offset="1" stopColor={c} stopOpacity="0" />
  </radialGradient>
)

/* ---------------- Stardust ---------------- */

const STARDUST = (() => {
  const r = seq(301)
  return Array.from({ length: 22 }, (_, i) => {
    const [x, y] = at(54 + r() * 17, (i / 22) * 360 + r() * 12)
    return { x, y, s: i % 5 === 0 ? 6.4 : i % 2 ? 2.9 : 4.2, c: ['#ffffff', '#fff2b0', '#bfe9ff', '#ffd6f6'][i % 4], dur: 2 + r() * 2.6, f: r() }
  })
})()
const DUST = (() => {
  const r = seq(303)
  return Array.from({ length: 26 }, () => [...at(48 + r() * 24, r() * 360), 0.55 + r() * 0.7, r()] as const)
})()

const sparkles: AuraArt = {
  back: (u, live, dense) => (
    <g className={live ? 'bjx-rot bjx-rev' : undefined} style={live ? tm(120) : undefined}>
      <defs>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="72">
          <stop offset=".55" stopColor="#fff2b0" stopOpacity=".13" />
          <stop offset="1" stopColor="#fff2b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="72" fill={`url(#${u}g)`} />
      {halfOf([...DUST], dense).map(([x, y, s, f], i) => (
        <circle key={i} className={live ? 'bjx-tw' : undefined} style={live ? tm(3.4, f) : undefined} cx={n2(x)} cy={n2(y)} r={n2(s)} fill="#fff6d6" />
      ))}
    </g>
  ),
  front: (_u, live, dense) => (
    <g className={live ? 'bjx-rot' : undefined} style={live ? tm(80) : undefined}>
      {halfOf(STARDUST, dense).map((s, i) => (
        <g key={i} className={live ? 'bjx-tw' : undefined} style={live ? tm(s.dur, s.f) : undefined}>
          <circle cx={n2(s.x)} cy={n2(s.y)} r={n2(s.s * 1.3)} fill={s.c} fillOpacity=".22" />
          <path d={sparkle(s.x, s.y, s.s)} fill={s.c} />
        </g>
      ))}
    </g>
  ),
}

/* ---------------- Embers ---------------- */

const EMBERS = (() => {
  const r = seq(311)
  return Array.from({ length: 24 }, (_, i) => {
    // mostly up the two sides, a few through the middle
    const side = i % 5 === 4 ? 0.35 + r() * 0.3 : i % 2 ? r() * 0.26 : 0.74 + r() * 0.26
    return { x: -8 + side * 116, y: 86 + r() * 26, dur: 2.8 + r() * 2.4, f: r(), dy: -(64 + r() * 40), sx: (r() * 2 - 1) * 8, dx: (r() * 2 - 1) * 7, rs: 1 + r() * 1.3, c: ['#ffd27a', '#ff9a3d', '#ff6a2f'][i % 3], s1: 0.35 }
  })
})()
const ember = (rs: number, c: string) => (
  <>
    <circle r={n2(rs * 3)} fill={c} fillOpacity=".3" />
    <circle r={n2(rs * 1.5)} fill={c} fillOpacity=".55" />
    <circle r={n2(rs)} fill="#fff1c0" />
  </>
)

const embers: AuraArt = {
  back: (u, live, dense) => (
    <>
      <defs>
        <radialGradient id={`${u}g`}>
          <stop offset="0" stopColor="#ff7a2a" stopOpacity=".5" />
          <stop offset=".6" stopColor="#ff4a1c" stopOpacity=".16" />
          <stop offset="1" stopColor="#ff4a1c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse className={live ? 'bjx-pulse' : undefined} style={live ? tm(3) : undefined} cx="50" cy="96" rx="62" ry="30" fill={`url(#${u}g)`} />
      {halfOf(EMBERS, dense)
        .filter((_, i) => i % 3 === 1)
        .map((e, i) => drift({ ...e, o: 0.6 }, live, ember(e.rs * 0.8, e.c), i))}
    </>
  ),
  front: (_u, live, dense) => <>{halfOf(EMBERS, dense).map((e, i) => (i % 3 === 1 ? null : drift(e, live, ember(e.rs, e.c), i)))}</>,
}

/* ---------------- Bubbles ---------------- */

const BUBBLES = (() => {
  const r = seq(321)
  return Array.from({ length: 20 }, (_, i) => {
    const side = i % 4 === 3 ? 0.3 + r() * 0.4 : i % 2 ? r() * 0.3 : 0.7 + r() * 0.3
    return { x: -10 + side * 120, y: 110 + r() * 14, rs: 2 + r() * 4.4, dur: 4.2 + r() * 3.2, f: r(), dy: -(122 + r() * 20), sx: 3 + r() * 4 }
  })
})()
const bubble = (u: string, rs: number) => (
  <>
    <circle r={n2(rs)} fill={`url(#${u}b)`} stroke="#d8fbff" strokeOpacity=".85" strokeWidth=".45" />
    <path d={arc(rs * 0.62, 200, 255, 0, 0)} fill="none" stroke="#fff" strokeOpacity=".85" strokeWidth={n2(Math.max(0.35, rs * 0.2))} strokeLinecap="round" />
  </>
)
const bubbleDefs = (u: string) => (
  <defs>
    <radialGradient id={`${u}b`}>
      <stop offset="0" stopColor="#bff6ff" stopOpacity="0" />
      <stop offset=".72" stopColor="#7fe8ff" stopOpacity=".08" />
      <stop offset="1" stopColor="#bff6ff" stopOpacity=".42" />
    </radialGradient>
    {glowGrad(`${u}g`, '#4fd8ff', 0.3)}
  </defs>
)

const bubbles: AuraArt = {
  back: (u, live, dense) => (
    <>
      {bubbleDefs(u)}
      <ellipse cx="50" cy="92" rx="64" ry="34" fill={`url(#${u}g)`} />
      {halfOf(BUBBLES, dense)
        .filter((_, i) => i % 3 === 2)
        .map((b, i) => drift({ ...b, o: 0.55 }, live, bubble(u, b.rs * 0.75), i, 'bjx-bub'))}
    </>
  ),
  front: (u, live, dense) => (
    <>
      {bubbleDefs(u)}
      {halfOf(BUBBLES, dense).map((b, i) => (i % 3 === 2 ? null : drift(b, live, bubble(u, b.rs), i, 'bjx-bub')))}
    </>
  ),
}

/* ---------------- Snowfall ---------------- */

const flake = (s: number) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = i * 60 - 90
    const [ex, ey] = at(s, a, 0, 0)
    const [bx, by] = at(s * 0.5, a, 0, 0)
    return `M0 0L${n2(ex)} ${n2(ey)}M${n2(bx)} ${n2(by)}L${P(s * 0.8, a - 30, 0, 0)}M${n2(bx)} ${n2(by)}L${P(s * 0.8, a + 30, 0, 0)}`
  }).join('')
const FLAKES = (() => {
  const r = seq(331)
  return Array.from({ length: 24 }, (_, i) => {
    const big = i % 3 === 0
    const side = i % 4 === 1 ? 0.25 + r() * 0.5 : i % 2 ? r() * 0.28 : 0.72 + r() * 0.28
    return { x: -14 + side * 128, y: -26 + r() * 8, dur: 6.5 + r() * 5, f: r(), dy: 150, sx: (r() * 2 - 1) * 8, dx: (r() * 2 - 1) * 10, r: (r() * 2 - 1) * 220, s: big ? 4.4 + r() * 1.4 : 1.3 + r() * 1.1, big }
  })
})()
const snowBit = (f: (typeof FLAKES)[number]) =>
  f.big ? (
    <>
      <circle r={n2(f.s * 0.9)} fill="#dff6ff" fillOpacity=".18" />
      <path d={flake(f.s)} fill="none" stroke="#fff" strokeWidth=".75" strokeLinecap="round" />
    </>
  ) : (
    <circle r={n2(f.s)} fill="#fff" />
  )

const snow: AuraArt = {
  back: (_u, live, dense) => <>{halfOf(FLAKES, dense).map((f, i) => (i % 2 ? drift({ ...f, o: 0.55, s0: 0.8, s1: 0.8 }, live, snowBit(f), i) : null))}</>,
  front: (_u, live, dense) => <>{halfOf(FLAKES, dense).map((f, i) => (i % 2 ? null : drift({ ...f, o: 0.95 }, live, snowBit(f), i)))}</>,
}

/* ---------------- Smitten ---------------- */

const HEART_COLORS = ['#ff4f7f', '#ff8fb8', '#ff2f5f', '#ffb3cf']
const HEARTS = (() => {
  const r = seq(341)
  return Array.from({ length: 16 }, (_, i) => {
    const left = i % 2 === 1
    return { x: left ? -8 + r() * 28 : 80 + r() * 28, y: 80 + r() * 22, w: 7 + r() * 5, dur: 3.4 + r() * 2.2, f: r(), dy: -(70 + r() * 32), sx: (r() * 2 - 1) * 7, dx: (left ? -1 : 1) * (4 + r() * 6), r: (r() * 2 - 1) * 26, s0: 0.4, s1: 1.1, c: HEART_COLORS[i % 4] }
  })
})()
const heartBit = (w: number, c: string) => (
  <>
    <path d={heart(0, 0, w)} fill={c} stroke="#7a0f2a" strokeOpacity=".35" strokeWidth=".35" />
    <ellipse cx={n2(-w * 0.2)} cy={n2(-w * 0.22)} rx={n2(w * 0.12)} ry={n2(w * 0.08)} transform={`rotate(-30 ${n2(-w * 0.2)} ${n2(-w * 0.22)})`} fill="#fff" fillOpacity=".75" />
  </>
)

const hearts: AuraArt = {
  back: (u, live, dense) => (
    <>
      <defs>
        <radialGradient id={`${u}g`}>
          <stop offset=".45" stopColor="#ff4f8f" stopOpacity=".32" />
          <stop offset="1" stopColor="#ff4f8f" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className={live ? 'bjx-beat' : undefined}>
        <circle cx="50" cy="50" r="64" fill={`url(#${u}g)`} />
      </g>
      {halfOf(HEARTS, dense)
        .filter((_, i) => i % 4 === 3)
        .map((h, i) => drift({ ...h, o: 0.6 }, live, heartBit(h.w * 0.75, h.c), i))}
    </>
  ),
  front: (_u, live, dense) => <>{halfOf(HEARTS, dense).map((h, i) => (i % 4 === 3 ? null : drift(h, live, heartBit(h.w, h.c), i)))}</>,
}

/* ---------------- Butterflies ---------------- */

const FLIERS: (Orbit & { c: [string, string]; s: number; flap: number })[] = [
  { cx: 50, cy: 48, R: 62, sq: 0.42, tilt: -18, dur: 11, frac: 0.05, c: ['#ff6fae', '#ffd36e'], s: 1, flap: 0.3 },
  { cx: 50, cy: 52, R: 58, sq: 0.5, tilt: 24, dur: 14, frac: 0.42, c: ['#5fd8ff', '#9b7bff'], s: 0.85, flap: 0.26 },
  { cx: 50, cy: 50, R: 66, sq: 0.34, tilt: 8, dur: 17, frac: 0.72, c: ['#9dff7d', '#1fb86a'], s: 0.9, flap: 0.34 },
  { cx: 50, cy: 46, R: 56, sq: 0.46, tilt: -40, dur: 12.5, frac: 0.26, c: ['#ffb347', '#ff4f5f'], s: 0.78, flap: 0.28 },
  { cx: 50, cy: 54, R: 64, sq: 0.38, tilt: 36, dur: 15.5, frac: 0.9, c: ['#e2ccff', '#ff6bdf'], s: 0.8, flap: 0.31 },
]
const flierDefs = (u: string) => (
  <defs>
    {FLIERS.map((b, k) => (
      <linearGradient key={k} id={`${u}w${k}`} x1="1" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={b.c[1]} />
        <stop offset="1" stopColor={b.c[0]} />
      </linearGradient>
    ))}
  </defs>
)
function butterfly(u: string, k: number, live: boolean) {
  const b = FLIERS[k]
  const wing = (
    <g className={live ? 'bjx-flap' : undefined} style={live ? tm(b.flap, k * 0.2) : undefined}>
      <path d="M0 -.6C-2 -4.8 -6.4 -5.8 -7 -2.6C-7.4 -.6 -3.6 .5 0 .1Z" fill={`url(#${u}w${k})`} stroke="#1a1030" strokeWidth=".4" />
      <path d="M0 .2C-2.6 .6 -5.2 2.6 -4.3 4.6C-3.5 6 -1 3.6 0 .9Z" fill={`url(#${u}w${k})`} stroke="#1a1030" strokeWidth=".4" />
      <circle cx="-4.5" cy="-2.6" r=".95" fill="#fff" fillOpacity=".8" />
      <circle cx="-2.8" cy="2.8" r=".55" fill="#fff" fillOpacity=".6" />
    </g>
  )
  return (
    <g className={live ? 'bjx-bob' : undefined} style={live ? { ...tm(1.1 + k * 0.17, k * 0.3), ...vars({ '--b': '-3.5px' }) } : undefined}>
      <g transform={`scale(${n2(b.s * 1.6)})`}>
        {wing}
        <g transform="scale(-1 1)">{wing}</g>
        <ellipse rx=".65" ry="2.9" fill="#1a1030" />
        <path d="M-.3 -2.6Q-1.3 -4.7 -2.3 -5.1M.3 -2.6Q1.3 -4.7 2.3 -5.1" fill="none" stroke="#1a1030" strokeWidth=".38" strokeLinecap="round" />
      </g>
    </g>
  )
}
const butterflies: AuraArt = {
  back: (u, live, dense) => (
    <>
      {flierDefs(u)}
      {FLIERS.map((b, k) => (!dense && k > 3 ? null : orbit(b, 'back', live, <g opacity=".85">{butterfly(u, k, live)}</g>, k)))}
    </>
  ),
  front: (u, live, dense) => (
    <>
      {flierDefs(u)}
      {FLIERS.map((b, k) => (!dense && k > 3 ? null : orbit(b, 'front', live, butterfly(u, k, live), k)))}
    </>
  ),
}

/* ---------------- 8-Bit ---------------- */

const PIX_COLORS = ['#ff4fb8', '#4fd8ff', '#ffe14d', '#3dff8a', '#9b7bff', '#ffffff']
const PIXELS = (() => {
  const r = seq(351)
  return Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * 360 + r() * 12
    const [x, y] = at(46 + r() * 6, a)
    const out = 12 + r() * 12
    return { x, y, dx: Math.cos(rad(a)) * out, dy: Math.sin(rad(a)) * out - 5 - r() * 7, s: [2.4, 3.2, 4][i % 3], c: PIX_COLORS[i % 6], dur: 1.6 + r() * 1.6, f: r() }
  })
})()
const PLUS = [
  [100, 6, 0],
  [-6, 30, 0.3],
  [108, 74, 0.55],
  [4, 100, 0.8],
  [62, -14, 0.15],
]
/** a ring of square cells round the middle, on a grid of `c`, from radius r0 to r1, as one path */
const pixelRing = (r0: number, r1: number, c: number) => {
  let d = ''
  for (let y = -25; y < 125; y += c)
    for (let x = -25; x < 125; x += c) {
      const dd = Math.hypot(x + c / 2 - 50, y + c / 2 - 50)
      if (dd >= r0 && dd < r1) d += `M${x} ${y}h${c}v${c}h-${c}z`
    }
  return d
}
const PIX_RING_A = pixelRing(52, 55, 3)
const PIX_RING_B = pixelRing(57.5, 59.5, 3)

const pixels: AuraArt = {
  back: (_u, live) => (
    <g shapeRendering="crispEdges">
      <path className={live ? 'bjx-flk' : undefined} d={PIX_RING_A} fill="#ff4fb8" fillOpacity=".4" />
      <path className={live ? 'bjx-flk' : undefined} style={live ? tm(1.9, 0.5) : undefined} d={PIX_RING_B} fill="#4fd8ff" fillOpacity=".28" />
    </g>
  ),
  front: (_u, live, dense) => (
    <g shapeRendering="crispEdges">
      {halfOf(PIXELS, dense).map((p, i) =>
        drift({ x: p.x, y: p.y, dx: p.dx, dy: p.dy, dur: p.dur, f: p.f, sx: p.dx * 0.5 }, live, <rect x={-p.s / 2} y={-p.s / 2} width={p.s} height={p.s} fill={p.c} />, i, 'bjx-drift bjx-steps'),
      )}
      {PLUS.map(([x, y, f], i) => (
        <path key={i} className={live ? 'bjx-pix' : undefined} style={live ? tm(1.6 + i * 0.2, f) : undefined} d={`M${x - 1} ${y - 3}h2v2h2v2h-2v2h-2v-2h-2v-2h2z`} fill={PIX_COLORS[(i + 2) % 6]} />
      ))}
    </g>
  ),
}

/* ---------------- Coin Orbit ---------------- */

const COINS: Orbit = { cx: 50, cy: 54, R: 61, sq: 0.27, tilt: -9, dur: 10, frac: 0 }
const coinStar = (() => {
  let d = ''
  for (let i = 0; i < 10; i++) d += `${i ? 'L' : 'M'}${P(i % 2 ? 1.25 : 2.9, -90 + i * 36, 0, 0)}`
  return d + 'Z'
})()
const coinDefs = (u: string) => (
  <defs>
    <linearGradient id={`${u}c`} x1="0" y1="0" x2=".4" y2="1">
      <stop offset="0" stopColor="#fff6c8" />
      <stop offset=".45" stopColor="#f7c548" />
      <stop offset="1" stopColor="#b47a10" />
    </linearGradient>
    {glowGrad(`${u}g`, '#ffd36e', 0.3)}
  </defs>
)
const coin = (u: string, i: number, live: boolean) => (
  <>
    <g className={live ? 'bjx-coin' : undefined} style={live ? tm(1.7, i * 0.23) : undefined}>
      <g transform="scale(1.4)">
        <circle r="5.7" fill="#8a5208" />
        <circle r="5.2" cy="-.3" fill={`url(#${u}c)`} stroke="#8a5a08" strokeWidth=".45" />
        <circle r="3.8" cy="-.3" fill="none" stroke="#a86c0c" strokeOpacity=".6" strokeWidth=".55" />
        <path d={coinStar} transform="translate(0 -.3)" fill="#fff1b0" />
      </g>
    </g>
    {live && <path className="bjx-tw" style={tm(3.2, i * 0.37)} d={sparkle(5, -5.6, 3)} fill="#fff" />}
  </>
)

const coins: AuraArt = {
  back: (u, live, dense) => (
    <>
      {coinDefs(u)}
      <ellipse cx="50" cy="54" rx="68" ry="22" transform="rotate(-9 50 54)" fill={`url(#${u}g)`} />
      <path d={orbitHalf(COINS, 'back')} transform={orbitPlace(COINS)} fill="none" stroke="#ffd36e" strokeOpacity=".28" strokeWidth=".6" strokeDasharray="2 3" />
      {spaced(dense ? 7 : 5, (i, f) => orbit({ ...COINS, frac: f }, 'back', live, <g opacity=".8">{coin(u, i, live)}</g>, i))}
    </>
  ),
  front: (u, live, dense) => (
    <>
      {coinDefs(u)}
      <path d={orbitHalf(COINS, 'front')} transform={orbitPlace(COINS)} fill="none" stroke="#ffd36e" strokeOpacity=".4" strokeWidth=".6" strokeDasharray="2 3" />
      {spaced(dense ? 7 : 5, (i, f) => orbit({ ...COINS, frac: f }, 'front', live, coin(u, i, live), i))}
    </>
  ),
}

/* ---------------- Static ---------------- */

const STATIC = (() => {
  const r = seq(361)
  return Array.from({ length: 8 }, (_, i) => {
    const a = i * 45 + r() * 20
    const span = 26 + r() * 22
    const main = arcBolt(r, 53 + r() * 3, a, a + span, 3.6, 7)
    const ma = a + span * (0.3 + r() * 0.4)
    const [bx, by] = at(54, ma)
    const [ex, ey] = at(62 + r() * 6, ma + (r() - 0.5) * 18)
    return { d: main + bolt(r, bx, by, ex, ey, 1.8, 3).d, dur: 1.3 + r() * 1.7, f: r() }
  })
})()
const SPARKS = (() => {
  const r = seq(363)
  return Array.from({ length: 12 }, () => {
    const a = r() * 360
    const [x, y] = at(53, a)
    const d = 9 + r() * 8
    return { x, y, dx: Math.cos(rad(a)) * d, dy: Math.sin(rad(a)) * d, dur: 0.8 + r() * 0.7, f: r(), s1: 0.3 }
  })
})()

const lightning: AuraArt = {
  back: (u, live) => (
    <>
      <defs>
        <radialGradient id={`${u}g`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="66">
          <stop offset=".62" stopColor="#4fc3ff" stopOpacity="0" />
          <stop offset=".8" stopColor="#4fc3ff" stopOpacity=".32" />
          <stop offset="1" stopColor="#4fc3ff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle className={live ? 'bjx-flk' : undefined} cx="50" cy="50" r="66" fill={`url(#${u}g)`} />
      <circle className={live ? 'bjx-flk' : undefined} style={live ? tm(1.9, 0.4) : undefined} cx="50" cy="50" r="51" fill="none" stroke="#9b7bff" strokeOpacity=".22" strokeWidth="3" />
    </>
  ),
  front: (_u, live, dense) => (
    <>
      {halfOf(STATIC, dense).map((s, i) =>
        !live && i > 1 ? null : (
          <g key={i} className={live ? 'bjx-zap' : undefined} style={live ? tm(s.dur, s.f) : undefined}>
            <path d={s.d} fill="none" stroke="#9b7bff" strokeOpacity=".22" strokeWidth="4.6" strokeLinejoin="round" strokeLinecap="round" />
            <path d={s.d} fill="none" stroke="#6fd8ff" strokeOpacity=".6" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
            <path d={s.d} fill="none" stroke="#ffffff" strokeWidth=".75" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ),
      )}
      {live && halfOf(SPARKS, dense).map((s, i) => drift(s, live, <circle r=".7" fill="#e8fbff" />, i))}
    </>
  ),
}

/* ---------------- Halo ---------------- */

const RAYS = Array.from({ length: 18 }, (_, i) => {
  const a = i * 20
  const L = i % 2 ? 62 : 76
  return `M50 50L${P(L, a - 3.4)}L${P(L, a + 3.4)}Z`
}).join('')
const HALO = { far: 'M23 -9A27 7 0 0 1 77 -9', near: 'M23 -9A27 7 0 0 0 77 -9' }
const MOTES = (() => {
  const r = seq(371)
  return Array.from({ length: 8 }, (_, i) => ({ x: 22 + r() * 56 + (i % 2 ? -26 : 26), y: -4 + r() * 10, dy: 34 + r() * 22, sx: (r() * 2 - 1) * 6, dur: 5 + r() * 3, f: r(), s1: 0.5 }))
})()
const haloRing = (u: string, d: string, live: boolean) => (
  <g className={live ? 'bjx-bob' : undefined} style={live ? { ...tm(3.4), ...vars({ '--b': '-2.2px' }) } : undefined}>
    <path d={d} fill="none" stroke="#ffd36e" strokeOpacity=".32" strokeWidth="7.5" strokeLinecap="round" />
    <path d={d} fill="none" stroke={`url(#${u}h)`} strokeWidth="3.4" strokeLinecap="round" />
    <path d={d} transform="translate(0 -.9)" fill="none" stroke="#fffbe8" strokeOpacity=".9" strokeWidth=".8" strokeLinecap="round" />
  </g>
)
const haloDefs = (u: string) => (
  <linearGradient id={`${u}h`} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor="#fffbe0" />
    <stop offset=".5" stopColor="#ffe28a" />
    <stop offset="1" stopColor="#e0a22a" />
  </linearGradient>
)

const halo: AuraArt = {
  back: (u, live) => (
    <>
      <defs>
        {haloDefs(u)}
        <radialGradient id={`${u}r`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="76">
          <stop offset=".45" stopColor="#fff4c8" stopOpacity=".6" />
          <stop offset=".75" stopColor="#ffd36e" stopOpacity=".18" />
          <stop offset="1" stopColor="#ffd36e" stopOpacity="0" />
        </radialGradient>
        {glowGrad(`${u}g`, '#ffe9a0', 0.35)}
      </defs>
      <circle cx="50" cy="50" r="62" fill={`url(#${u}g)`} />
      <g className={live ? 'bjx-rot' : undefined} style={live ? tm(70) : undefined}>
        <path d={RAYS} fill={`url(#${u}r)`} />
      </g>
      {haloRing(u, HALO.far, live)}
    </>
  ),
  front: (u, live, dense) => (
    <>
      <defs>{haloDefs(u)}</defs>
      {haloRing(u, HALO.near, live)}
      {halfOf(MOTES, dense).map((m, i) => drift(m, live, <path d={sparkle(0, 0, 1.6)} fill="#fff4c8" />, i))}
      {live &&
        [
          [18, -12, 2.6, 0],
          [84, -6, 2, 0.5],
        ].map(([x, y, s, f]) => <path key={x} className="bjx-tw" style={tm(2.8, f)} d={sparkle(x, y, s)} fill="#fffbe8" />)}
    </>
  ),
}

/* ---------------- Atomic ---------------- */

const ATOM: Orbit[] = [0, 60, -60].map((tilt, i) => ({ cx: 50, cy: 50, R: 64, sq: 0.3, tilt, dur: [2.4, 3, 3.6][i], frac: [0, 0.33, 0.66][i] }))
const SPECKS = (() => {
  const r = seq(381)
  return Array.from({ length: 10 }, () => {
    const a = r() * 360
    const [x, y] = at(46 + r() * 6, a)
    const d = 16 + r() * 12
    return { x, y, dx: Math.cos(rad(a)) * d, dy: Math.sin(rad(a)) * d, dur: 2 + r() * 1.6, f: r(), s1: 0.4 }
  })
})()
const electron = (u: string) => (
  <>
    <circle r="6.5" fill={`url(#${u}e)`} />
    <circle r="2.3" fill="#ffffff" />
  </>
)
const atomLines = (half: 'front' | 'back') =>
  ATOM.map((o, i) => (
    <g key={i} transform={orbitPlace(o)}>
      <path d={orbitHalf(o, half)} fill="none" stroke="#5fe0ff" strokeOpacity=".16" strokeWidth="2.6" />
      <path d={orbitHalf(o, half)} fill="none" stroke="#9ff3ff" strokeOpacity={half === 'front' ? 0.6 : 0.35} strokeWidth=".75" />
    </g>
  ))
const electrons = (u: string, half: 'front' | 'back', live: boolean, dense: boolean) =>
  ATOM.flatMap((o, i) => [orbit(o, half, live, electron(u), `a${i}`), dense ? orbit({ ...o, frac: o.frac + 0.5 }, half, live, electron(u), `b${i}`) : null])

const atomic: AuraArt = {
  back: (u, live, dense) => (
    <>
      <defs>
        {glowGrad(`${u}g`, '#5fe0ff', 0.4)}
        {glowGrad(`${u}e`, '#7df9ff', 0.7)}
      </defs>
      <circle className={live ? 'bjx-pulse' : undefined} style={live ? tm(1.8) : undefined} cx="50" cy="50" r="64" fill={`url(#${u}g)`} />
      {live && [0, 0.5].map((f) => <circle key={f} className="bjx-wave" style={tm(3, f)} cx="50" cy="50" r="44" fill="none" stroke="#7df9ff" strokeWidth="1.6" />)}
      {atomLines('back')}
      {electrons(u, 'back', live, dense)}
    </>
  ),
  front: (u, live, dense) => (
    <>
      <defs>{glowGrad(`${u}e`, '#7df9ff', 0.7)}</defs>
      {atomLines('front')}
      {electrons(u, 'front', live, dense)}
      {live && halfOf(SPECKS, dense).map((s, i) => drift(s, live, <circle r=".75" fill="#b8ffef" />, i))}
    </>
  ),
}

/* ---------------- Shadowflame ---------------- */

const SHADOW_FLAMES = Array.from({ length: 13 }, (_, i) => {
  const a = -132 + (i / 12) * 264
  return { a, h: 21 + 15 * ((1 + Math.cos(rad(a))) / 2), w: 7.4 - Math.abs(a) / 55 }
})
const WISPS = (() => {
  const r = seq(391)
  return Array.from({ length: 12 }, (_, i) => {
    const [x, y] = at(46 + r() * 8, -170 + (i / 11) * 160 + (r() - 0.5) * 14)
    return { x, y, dy: -(26 + r() * 20), sx: (r() * 2 - 1) * 6, dx: (r() * 2 - 1) * 4, dur: 2.2 + r() * 1.8, f: r(), s1: 0.3, rs: 0.6 + r() * 0.7, c: ['#d9a6ff', '#ff7bf0', '#9b5cff'][i % 3] }
  })
})()

const shadow: AuraArt = {
  back: (u, live, dense) => (
    <>
      <defs>
        <radialGradient id={`${u}s`} gradientUnits="userSpaceOnUse" cx="50" cy="50" r="66">
          <stop offset=".5" stopColor="#1a0630" stopOpacity=".8" />
          <stop offset="1" stopColor="#1a0630" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}v`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#2b0a52" />
          <stop offset=".35" stopColor="#6a22c8" />
          <stop offset=".72" stopColor="#c05cff" stopOpacity=".75" />
          <stop offset="1" stopColor="#ff7bf0" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}k`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#05010c" />
          <stop offset=".6" stopColor="#1f0640" stopOpacity=".85" />
          <stop offset="1" stopColor="#1f0640" stopOpacity="0" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="66" fill={`url(#${u}s)`} />
      {SHADOW_FLAMES.map((f, i) =>
        !dense && i % 2 ? null : (
          <g key={i} transform={`rotate(${n2(f.a)} 50 50)`}>
            <path className={live ? 'bjx-fl' : undefined} style={live ? tm(1.1 + (i % 3) * 0.17, i * 0.21) : undefined} d={tongue(f.w, f.h, 13)} fill={`url(#${u}v)`} />
            <path className={live ? 'bjx-fl' : undefined} style={live ? tm(0.85 + (i % 2) * 0.2, i * 0.31 + 0.5) : undefined} d={tongue(f.w * 0.6, f.h * 0.72, 13)} fill={`url(#${u}k)`} />
          </g>
        ),
      )}
    </>
  ),
  front: (_u, live, dense) => (
    <>
      {halfOf(WISPS, dense).map((w, i) =>
        drift(
          w,
          live,
          <>
            <circle r={n2(w.rs * 2.6)} fill={w.c} fillOpacity=".25" />
            <circle r={n2(w.rs)} fill={w.c} />
          </>,
          i,
        ),
      )}
    </>
  ),
}

/* ---------------- Prism ---------------- */

const RAY_MASK = 'radial-gradient(circle closest-side, transparent 50%, #000 62%, rgba(0,0,0,.45) 82%, transparent 100%)'
const RAYS_A = `repeating-conic-gradient(from 0deg,${['#ff3b6b', '#ffe53b', '#5cff8a', '#3bd8ff', '#8a6bff', '#ff4fd8']
  .map((c, i) => `transparent ${i * 10}deg,${c}cc ${i * 10 + 1.6}deg,transparent ${i * 10 + 3.2}deg`)
  .join(',')},transparent 60deg)`
const RAYS_B = 'repeating-conic-gradient(from 7deg,transparent 0deg,#ffffffaa 1deg,transparent 2deg,transparent 24deg)'
const SHARDS: Orbit = { cx: 50, cy: 50, R: 61, sq: 0.34, tilt: 16, dur: 13, frac: 0 }
const shardDefs = (u: string) => (
  <defs>
    <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1">
      {['#ff3b6b', '#ffe53b', '#5cff8a', '#3bd8ff', '#8a6bff'].map((c, i) => (
        <stop key={c} offset={i / 4} stopColor={c} />
      ))}
    </linearGradient>
  </defs>
)
const crystal = (u: string, i: number, live: boolean) => (
  <g className={live ? 'bjx-a-spin' : undefined} style={live ? tm(2.4 + (i % 3) * 0.7, i * 0.2) : undefined}>
    <path d="M0 -4.6L2 0L0 4.6L-2 0Z" fill={`url(#${u}p)`} stroke="#fff" strokeOpacity=".8" strokeWidth=".35" />
    <path d="M0 -4.6L2 0L0 .4Z" fill="#fff" fillOpacity=".6" />
  </g>
)
const PRISM_SPARKS = (() => {
  const r = seq(401)
  return Array.from({ length: 10 }, (_, i) => {
    const [x, y] = at(52 + r() * 18, (i / 10) * 360 + r() * 20)
    return { x, y, s: 1.6 + r() * 2.4, f: r(), c: ['#ffffff', '#ffd3f6', '#d3f6ff', '#fff6c8'][i % 4] }
  })
})()

const prism: AuraArt = {
  under: (live) => (
    <>
      <span aria-hidden className={`pointer-events-none absolute rounded-full ${live ? 'bjx-a-rays' : ''}`} style={{ inset: '-25%', background: RAYS_A, WebkitMaskImage: RAY_MASK, maskImage: RAY_MASK }} />
      <span aria-hidden className={`pointer-events-none absolute rounded-full ${live ? 'bjx-a-rays2' : ''}`} style={{ inset: '-25%', background: RAYS_B, WebkitMaskImage: RAY_MASK, maskImage: RAY_MASK, opacity: 0.5 }} />
    </>
  ),
  back: (u, live, dense) => (
    <>
      <defs>
        {shardDefs(u)}
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="1">
          {['#ff3b6b', '#ff9f3b', '#ffe53b', '#5cff8a', '#3bd8ff', '#8a6bff', '#ff4fd8'].map((c, i) => (
            <stop key={c} offset={i / 6} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      <circle className={live ? 'bjx-pulse' : undefined} style={live ? tm(3) : undefined} cx="50" cy="50" r="55" fill="none" stroke={`url(#${u}r)`} strokeOpacity=".3" strokeWidth="5" />
      {spaced(dense ? 6 : 4, (i, f) => orbit({ ...SHARDS, frac: f }, 'back', live, <g opacity=".8">{crystal(u, i, live)}</g>, i))}
    </>
  ),
  front: (u, live, dense) => (
    <>
      <defs>
        {shardDefs(u)}
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="1">
          {['#ff3b6b', '#ff9f3b', '#ffe53b', '#5cff8a', '#3bd8ff', '#8a6bff', '#ff4fd8'].map((c, i) => (
            <stop key={c} offset={i / 6} stopColor={c} />
          ))}
        </linearGradient>
      </defs>
      {live && [0, 0.5].map((f) => <circle key={f} className="bjx-wave" style={tm(3.6, f)} cx="50" cy="50" r="46" fill="none" stroke={`url(#${u}r)`} strokeWidth="1.3" />)}
      {spaced(dense ? 6 : 4, (i, f) => orbit({ ...SHARDS, frac: f }, 'front', live, crystal(u, i, live), i))}
      {halfOf(PRISM_SPARKS, dense).map((s, i) => (
        <path key={i} className={live ? 'bjx-tw' : undefined} style={live ? tm(2.4, s.f) : undefined} d={sparkle(s.x, s.y, s.s)} fill={s.c} />
      ))}
    </>
  ),
}

/* ---------------- the auras, and drawing them ---------------- */

const AURA_ART: Record<string, AuraArt> = {
  'aura:sparkles': sparkles,
  'aura:embers': embers,
  'aura:bubbles': bubbles,
  'aura:snow': snow,
  'aura:hearts': hearts,
  'aura:butterflies': butterflies,
  'aura:pixels': pixels,
  'aura:coins': coins,
  'aura:lightning': lightning,
  'aura:halo': halo,
  'aura:atomic': atomic,
  'aura:shadow': shadow,
  'aura:prism': prism,
}

/** whether an aura id has anything to draw (aura:none and unknown ids don't) */
export const hasAura = (id: string | null | undefined) => !!id && id in AURA_ART

/**
 * One layer of an aura, positioned in the box of the element it surrounds (which must be `relative`): the back layer
 * goes before the avatar, the front one after it. FramedAvatar uses this; anything else can use Aura.
 */
export function AuraLayer({ id, size, layer, still = false }: { id: string; size: number; layer: 'back' | 'front'; still?: boolean }) {
  const u = useUid()
  const art = AURA_ART[id]
  if (!art) return null
  const live = !still
  const dense = size >= 72
  const draw = layer === 'back' ? art.back : art.front
  return (
    <>
      {layer === 'back' && art.under?.(live)}
      {draw && (
        <svg viewBox="-25 -25 150 150" width={size * 1.5} height={size * 1.5} className="pointer-events-none absolute overflow-visible" style={{ left: -size * 0.25, top: -size * 0.25 }} aria-hidden>
          {draw(u + layer[0], live, dense)}
        </svg>
      )}
    </>
  )
}

/** an aura round `children` (or round nothing), `size` square; the aura reaches a quarter of the size past it */
export function Aura({ id, size, children, still = false, className = '' }: { id: string; size: number; children?: ReactNode; still?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const on = hasAura(id)
  useOffscreenPause(ref, on && !still)
  return (
    <span ref={ref} className={`relative inline-block shrink-0 align-middle ${className}`} style={{ width: size, height: size }} data-aura={id}>
      {on && <AuraLayer id={id} size={size} layer="back" still={still} />}
      {children !== undefined && <span className="relative flex h-full w-full items-center justify-center">{children}</span>}
      {on && <AuraLayer id={id} size={size} layer="front" still={still} />}
    </span>
  )
}
