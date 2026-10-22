import { memo, useLayoutEffect, useMemo, type ReactNode } from 'react'
import { AnimatePresence, motion, useMotionValue, type MotionValue } from 'framer-motion'
import { useUid } from '../../art/ids'
import { PITCHES, ROUTES, nextMultiplier, type RouteId } from './rules'
import { APEX, SNOW, campPt, dOf, halfWidth, jitter, routePath, type Geo, type Layout, type Pt } from './geom'
import { Climber, type Pose } from './Climber'
import { LOOK, multText } from './words'

/*
  The mountain, side-on, and the weather on it.

  One tall SVG holds the whole world in stage pixels (geom.ts), and the camera moves it: the world's translation is
  worked out from the camera altitude (a motion value the page animates), so a climb scrolls the mountain without
  re-rendering it. Back to front: the sky, coloured by altitude (a warm daytime blue at base camp darkening to a deep
  navy with stars above the summit); the sun and two far ranges on parallax groups, so they sink as the climber rises
  past them; a sea of clouds round the mountain at two heights; the mountain itself (a meadow of pines at its foot,
  rock shaded on its far side and scratched with strata, a snow cap from the snow line up, the apex just above the
  summit camp); the camps (rock ledges with a tent and a pennant that turns gold once reached, base camp with its
  signpost, the summit cairn where the climber's own flag goes up); the routes (the pitches climbed so far in their
  colours, and the four ways up from the climber's camp, the one pointed at glowing with the multiplier it would
  make); wisps of cloud in front; then the rope, the climber, and the moments (a burst where a pitch gives way, with
  rocks or the rope's ends flying, and a multiplier rising off a camp just made).

  Over the world, fixed to the stage: the weather, worse the higher the climb (wind streaks from Camp 2, snow from
  Camp 5, a blizzard and a darker sky near the top; all of it clears at the summit), a bank of clouds below the
  climber that the deck sits on (a fall drops into it), and a vignette.
*/

const INK = '#141a2b'
const TENTS = ['#ff7a3d', '#ffc23d', '#ff5d73', '#4cb4ff', '#9b7bff', '#22d36f']

const KEYFRAMES = `
@keyframes summit-wind { from { transform: translate3d(var(--x0), 0, 0) } to { transform: translate3d(var(--x1), 0, 0) } }
@keyframes summit-snow { from { transform: translate3d(0, -14px, 0) } to { transform: translate3d(var(--dx), var(--dy), 0) } }
@keyframes summit-drift { from { transform: translateX(-16px) } to { transform: translateX(16px) } }
@keyframes summit-wave { 0%, 100% { transform: skewY(0deg) scaleX(1) } 50% { transform: skewY(-7deg) scaleX(.9) } }
@keyframes summit-rays { to { transform: rotate(360deg) } }
@keyframes summit-throb { 0%, 100% { opacity: .5 } 50% { opacity: 1 } }
`

/** the scale of the camps' furniture and the climber for the camps' spacing */
export const furnitureScale = (g: Geo) => Math.min(1.08, Math.max(0.62, g.S / 178))

/* ---------------- the still art ---------------- */

function Sky({ g, u }: { g: Geo; u: string }) {
  const H = g.bottom - g.top
  const off = (a: number) => Math.min(1, Math.max(0, (-a * g.S - g.top) / H))
  const stops: [number, string][] = [
    [11.6, '#071030'],
    [9.6, '#122a63'],
    [7.6, '#21509b'],
    [5, '#3a85cc'],
    [2.5, '#66b3e8'],
    [0, '#a4dbf6'],
    [-2, '#d8f1fb'],
  ]
  const stars = Array.from({ length: 80 }, (_, i) => {
    const a = 7.6 + ((jitter(i * 5) + 1) / 2) * 4.6
    return { x: ((jitter(i * 5 + 1) + 1) / 2) * g.w, y: -a * g.S, r: 0.6 + ((jitter(i * 5 + 2) + 1) / 2) * 1.1, o: Math.min(1, (a - 7.6) / 2.6) * (0.5 + ((jitter(i * 5 + 3) + 1) / 4)) }
  })
  return (
    <>
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1={g.top} x2="0" y2={g.bottom} gradientUnits="userSpaceOnUse">
          {stops.map(([a, c]) => (
            <stop key={a} offset={off(a)} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${u}sun`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fffbe8" />
          <stop offset=".18" stopColor="#fff2b8" />
          <stop offset=".34" stopColor="#ffe08a" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x={-20} y={g.top} width={g.w + 40} height={H} fill={`url(#${u}sky)`} />
      {stars.map((s, i) => (
        <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#fff" opacity={s.o} />
      ))}
    </>
  )
}

/** a far range of peaks, in its own coordinates (moved by a parallax group) */
function Range({ g, seed, peakHi, peakLo, base, fill, shade, snow }: { g: Geo; seed: number; peakHi: number; peakLo: number; base: number; fill: string; shade: string; snow: string }) {
  const S = g.S
  const n = Math.max(4, Math.round(g.w / 150))
  const peaks: Pt[] = []
  for (let i = -1; i <= n + 1; i++) {
    const x = (i / n) * g.w + jitter(seed + i) * 30
    const y = -(peakLo + ((jitter(seed + i * 3 + 7) + 1) / 2) * (peakHi - peakLo)) * S
    peaks.push({ x, y })
  }
  const pts: Pt[] = []
  for (let i = 0; i < peaks.length - 1; i++) {
    const a = peaks[i]
    const b = peaks[i + 1]
    pts.push(a)
    pts.push({ x: (a.x + b.x) / 2 + jitter(seed + i * 11) * 14, y: Math.max(a.y, b.y) + S * (0.3 + ((jitter(seed + i * 13) + 1) / 2) * 0.3) })
  }
  pts.push(peaks[peaks.length - 1])
  const d = `M${pts[0].x} ${base * S}L${dOf(pts).slice(1)}L${pts[pts.length - 1].x} ${base * S}Z`
  return (
    <g>
      <path d={d} fill={fill} />
      {/* the shaded side of each peak, and its snow */}
      {peaks.map((p, i) => {
        const w = S * 0.32
        return (
          <g key={i}>
            <path d={`M${p.x} ${p.y}L${p.x - w * 0.95} ${p.y + w * 1.25}L${p.x - w * 0.1} ${p.y + w * 1.6}Z`} fill={shade} />
            <path d={`M${p.x} ${p.y}L${p.x - w * 0.42} ${p.y + w * 0.55}L${p.x - w * 0.12} ${p.y + w * 0.42}L${p.x + w * 0.1} ${p.y + w * 0.6}L${p.x + w * 0.4} ${p.y + w * 0.5}Z`} fill={snow} />
          </g>
        )
      })}
    </g>
  )
}

/** a band of cloud puffs at altitude a across the stage */
function Puffs({ g, a, seed, r, color, under, opacity = 1, from = -60, to }: { g: Geo; a: number; seed: number; r: number; color: string; under: string; opacity?: number; from?: number; to?: number }) {
  const y = -a * g.S
  const end = to ?? g.w + 60
  const step = r * 1.45
  const puffs: { x: number; y: number; r: number }[] = []
  for (let x = from, i = 0; x <= end; x += step, i++) puffs.push({ x: x + jitter(seed + i) * r * 0.3, y: y + jitter(seed + i + 50) * r * 0.25, r: r * (0.75 + ((jitter(seed + i + 90) + 1) / 2) * 0.55) })
  return (
    <g opacity={opacity}>
      {puffs.map((p, i) => (
        <circle key={`u${i}`} cx={p.x} cy={p.y + p.r * 0.32} r={p.r} fill={under} />
      ))}
      {puffs.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={color} />
      ))}
    </g>
  )
}

function Pine({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g>
      <rect x={x - 1.6 * s} y={y - 5 * s} width={3.2 * s} height={6 * s} fill="#6b4524" stroke={INK} strokeWidth={1.1} />
      <path d={`M${x} ${y - 30 * s}L${x - 7 * s} ${y - 17 * s}H${x - 3.5 * s}L${x - 10 * s} ${y - 5 * s}H${x + 10 * s}L${x + 3.5 * s} ${y - 17 * s}H${x + 7 * s}Z`} fill="#1f7a4a" stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      <path d={`M${x} ${y - 28 * s}L${x - 4 * s} ${y - 19 * s}`} stroke="#4fb878" strokeWidth={1.2 * s} strokeLinecap="round" />
    </g>
  )
}

/** the mountain: the meadow at its foot, the rock, its shaded side, strata, the snow cap */
function Rock({ g, u }: { g: Geo; u: string }) {
  const S = g.S
  const sc = furnitureScale(g)
  const left: Pt[] = []
  const right: Pt[] = []
  let i = 0
  for (let a = -4; a < APEX - 0.05; a += 0.25, i++) {
    const hw = halfWidth(g, a)
    const rough = (a < 0 ? 4 : 10) * Math.min(1, hw / 60)
    left.push({ x: g.cx - hw + jitter(i) * rough, y: -a * S + jitter(i + 500) * 3 })
    right.push({ x: g.cx + hw + jitter(i + 1000) * rough, y: -a * S + jitter(i + 1500) * 3 })
  }
  const apex = { x: g.cx + 1, y: -APEX * S - 5 }
  const outline = [...left, apex, ...[...right].reverse()]
  const spine: Pt[] = []
  i = 0
  for (let a = -4; a < APEX - 0.05; a += 0.25, i++) {
    const hw = halfWidth(g, a)
    spine.push({ x: g.cx + Math.sin(a * 1.3 + 0.5) * g.sw * 0.035 * Math.min(1, hw / 70) + jitter(i + 2000) * 3, y: -a * S })
  }
  const shadow = [...left, apex, ...[...spine].reverse()]

  // the face's ribs: big planes running down and out from the spine, lit on the sunny side and dark on the other
  const spineAt = (a: number) => g.cx + Math.sin(a * 1.3 + 0.5) * g.sw * 0.035 * Math.min(1, halfWidth(g, a) / 70)
  const ribs: { d: string; edge: string; lit: boolean }[] = []
  for (let j = 0; j < 18; j++) {
    const a = -0.7 + j * 0.62 + jitter(j + 6000) * 0.14
    if (a > APEX - 0.45) break
    const side = j % 2 ? 1 : -1
    const hw = halfWidth(g, a)
    const sx = spineAt(a)
    const p1 = { x: sx + side * hw * 0.04, y: -a * S }
    const p2 = { x: sx + side * hw * (0.8 + jitter(j + 6100) * 0.15), y: -(a - 0.7) * S }
    const p3 = { x: sx + side * hw * (0.36 + jitter(j + 6200) * 0.1), y: -(a - 1.0) * S }
    const p4 = { x: sx + side * hw * 0.1, y: -(a - 0.5) * S }
    const f = (q: Pt) => `${q.x.toFixed(1)} ${q.y.toFixed(1)}`
    ribs.push({ d: `M${f(p1)}L${f(p2)}L${f(p3)}L${f(p4)}Z`, edge: `M${f(p1)}L${f(p2)}`, lit: side === 1 })
  }
  // boulders and outcrops dotted over the face, kept off the camps
  const boulders: { x: number; y: number; r: number }[] = []
  for (let j = 0; j < 22; j++) {
    const a = 0.3 + ((jitter(j + 6500) + 1) / 2) * 8.8
    const k = Math.round(a)
    const x = g.cx + jitter(j + 6600) * halfWidth(g, a) * 0.78
    const c = campPt(g, Math.max(0, Math.min(PITCHES, k)))
    if (Math.abs(a - k) < 0.3 && Math.abs(x - c.x) < 60 * sc) continue
    boulders.push({ x, y: -a * S, r: (4 + ((jitter(j + 6700) + 1) / 2) * 6) * sc })
  }

  // the snow cap: the silhouette above the snow line, with a ragged, dripping lower edge
  const sy = -SNOW * S
  const lS = left.filter((p) => p.y <= sy)
  const rS = right.filter((p) => p.y <= sy)
  const edge: Pt[] = []
  const x0 = rS[0]?.x ?? g.cx
  const x1 = lS[0]?.x ?? g.cx
  const n = Math.max(6, Math.round((x0 - x1) / 15))
  for (let j = 0; j <= n; j++) {
    const x = x0 + ((x1 - x0) * j) / n
    edge.push({ x, y: sy + (jitter(j + 3000) * 0.08 + (j % 5 === 2 ? 0.2 : j % 7 === 4 ? 0.13 : 0)) * S })
  }
  const snowPts = [...lS, apex, ...[...rS].reverse(), ...edge]

  // strata and crags, kept off the camps
  const marks: { d: string; snow: boolean }[] = []
  for (let j = 0; j < 120; j++) {
    const a = -0.2 + ((jitter(j * 3) + 1) / 2) * 9.5
    const hw = halfWidth(g, a)
    const x = g.cx + jitter(j * 3 + 1) * hw * 0.82
    const y = -a * S
    const k = Math.round(a)
    const c = campPt(g, Math.max(0, Math.min(PITCHES, k)))
    if (Math.abs(a - k) < 0.28 && Math.abs(x - c.x) < 54 * sc) continue
    const len = (10 + (jitter(j * 3 + 2) + 1) * 12) * sc
    const ang = jitter(j * 7) * 0.45
    const dx = Math.cos(ang) * len
    const dy = Math.sin(ang) * len
    marks.push({ d: `M${(x - dx / 2).toFixed(1)} ${(y - dy / 2).toFixed(1)}L${(x + dx / 2).toFixed(1)} ${(y + dy / 2).toFixed(1)}`, snow: a > SNOW + 0.2 })
  }

  // the meadow and its pines
  const c0 = campPt(g, 0)
  const meadowY = (x: number) => 5 - S * 0.5 * Math.min(1, Math.abs(x - c0.x) / (g.w * 0.75)) ** 1.6 + Math.sin(x * 0.031) * 4
  const top: Pt[] = []
  for (let x = -40; x <= g.w + 40; x += 18) top.push({ x, y: meadowY(x) })
  const meadow = `${dOf(top)}L${g.w + 40} ${g.bottom}L-40 ${g.bottom}Z`
  const pines: { x: number; y: number; s: number }[] = []
  for (let j = 0; j < 22; j++) {
    const x = -20 + (j / 21) * (g.w + 40) + jitter(j + 4000) * 12
    if (Math.abs(x - c0.x) < 92 * sc) continue
    pines.push({ x, y: meadowY(x) + 6 + ((jitter(j + 4040) + 1) / 2) * S * 0.22, s: sc * (0.75 + ((jitter(j + 4080) + 1) / 2) * 0.5) })
  }
  pines.sort((a, b) => a.y - b.y)

  return (
    <>
      <defs>
        <linearGradient id={`${u}rock`} x1="0" y1={0} x2="0" y2={-PITCHES * S} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a08b76" />
          <stop offset=".3" stopColor="#8a8492" />
          <stop offset=".65" stopColor="#6f7894" />
          <stop offset="1" stopColor="#606c8c" />
        </linearGradient>
        <linearGradient id={`${u}snow`} x1="0" y1={-APEX * S} x2="0" y2={sy} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#dcebfb" />
        </linearGradient>
        <linearGradient id={`${u}grass`} x1="0" y1={-S * 0.5} x2="0" y2={S * 1.4} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#82d870" />
          <stop offset=".45" stopColor="#47a656" />
          <stop offset="1" stopColor="#2a7344" />
        </linearGradient>
        <linearGradient id={`${u}mist`} x1="0" y1={S * 0.45} x2="0" y2={S * 1.6} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#eef7ff" stopOpacity="0" />
          <stop offset="1" stopColor="#eef7ff" stopOpacity=".92" />
        </linearGradient>
      </defs>
      <clipPath id={`${u}face`}>
        <path d={`${dOf(outline)}Z`} />
      </clipPath>
      <path d={`${dOf(outline)}Z`} fill={`url(#${u}rock)`} stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      <g clipPath={`url(#${u}face)`}>
        {ribs.map((r, j) => (
          <g key={j}>
            <path d={r.d} fill={r.lit ? '#ffffff' : '#0c1233'} opacity={r.lit ? 0.075 : 0.13} />
            <path d={r.edge} stroke={r.lit ? '#dfe5f2' : '#1a2140'} strokeWidth={r.lit ? 1.6 : 2} opacity={r.lit ? 0.35 : 0.3} strokeLinecap="round" fill="none" />
          </g>
        ))}
      </g>
      <g strokeLinecap="round">
        {marks.map((m, j) =>
          m.snow ? null : (
            <g key={j}>
              <path d={m.d} stroke="#2c3550" strokeWidth={2.2} opacity={0.32} />
              <path d={m.d} stroke="#c3cada" strokeWidth={1.2} opacity={0.2} transform="translate(0 -2.2)" />
            </g>
          ),
        )}
      </g>
      {boulders.map((b, j) => (
        <g key={`b${j}`}>
          <path d={`M${b.x - b.r * 1.2} ${b.y + b.r * 0.3}L${b.x - b.r * 0.8} ${b.y - b.r * 0.55}L${b.x - b.r * 0.1} ${b.y - b.r * 0.9}L${b.x + b.r * 0.75} ${b.y - b.r * 0.5}L${b.x + b.r * 1.15} ${b.y + b.r * 0.35}Z`} fill={b.y < -SNOW * S ? '#e9f1fb' : '#646a80'} stroke={INK} strokeWidth={1.1} strokeLinejoin="round" />
          <path d={`M${b.x - b.r * 0.1} ${b.y - b.r * 0.9}L${b.x + b.r * 0.75} ${b.y - b.r * 0.5}L${b.x + b.r * 1.15} ${b.y + b.r * 0.35}L${b.x + b.r * 0.2} ${b.y + b.r * 0.32}Z`} fill="#000" opacity={0.22} />
          <path d={`M${b.x - b.r * 0.8} ${b.y - b.r * 0.55}L${b.x - b.r * 0.1} ${b.y - b.r * 0.9}`} stroke="#fff" strokeWidth={1.2} opacity={0.4} fill="none" strokeLinecap="round" />
        </g>
      ))}
      {/* snow patches below the snow line */}
      {Array.from({ length: 9 }, (_, j) => {
        const a = SNOW - 1.5 + ((jitter(j + 5000) + 1) / 2) * 1.3
        const x = g.cx + jitter(j + 5100) * halfWidth(g, a) * 0.7
        const r = (10 + (jitter(j + 5200) + 1) * 8) * sc
        return <path key={j} d={`M${x - r} ${-a * S}Q${x - r * 0.3} ${-a * S - r * 0.55} ${x + r * 0.2} ${-a * S - r * 0.2}Q${x + r * 0.7} ${-a * S - r * 0.45} ${x + r} ${-a * S}Q${x} ${-a * S + r * 0.25} ${x - r} ${-a * S}Z`} fill="#eef5ff" opacity={0.8} />
      })}
      <path d={`${dOf(snowPts)}Z`} fill={`url(#${u}snow)`} stroke={INK} strokeWidth={1.6} strokeLinejoin="round" />
      <g strokeLinecap="round">
        {marks.map((m, j) => (m.snow ? <path key={j} d={m.d} stroke="#9db8dc" strokeWidth={1.8} opacity={0.55} /> : null))}
      </g>
      <path d={`${dOf(shadow)}Z`} fill="#16204a" opacity={0.26} />
      <path d={`${dOf(outline)}Z`} fill="none" stroke={INK} strokeWidth={2.4} strokeLinejoin="round" />
      {/* the meadow, its pines, and the mist in the valley below */}
      <path d={meadow} fill={`url(#${u}grass)`} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      {pines.map((p, j) => (
        <Pine key={j} {...p} />
      ))}
      <rect x={-40} y={S * 0.45} width={g.w + 80} height={g.bottom - S * 0.45} fill={`url(#${u}mist)`} />
    </>
  )
}

/* ---------------- the camps ---------------- */

function Tent({ x, y, s, color }: { x: number; y: number; s: number; color: string }) {
  return (
    <g>
      <path d={`M${x - 12 * s} ${y}L${x} ${y - 16 * s}L${x + 12 * s} ${y}Z`} fill={color} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
      <path d={`M${x} ${y - 16 * s}L${x - 4 * s} ${y}H${x + 4 * s}Z`} fill="#000" opacity={0.35} />
      <path d={`M${x - 8 * s} ${y - 5.5 * s}L${x - 1.5 * s} ${y - 13 * s}`} stroke="#fff" strokeWidth={1.4 * s} opacity={0.45} strokeLinecap="round" />
    </g>
  )
}

function Pennant({ x, y, s, dir, color, k }: { x: number; y: number; s: number; dir: number; color: string; k?: number }) {
  return (
    <g>
      <path d={`M${x} ${y}V${y - 27 * s}`} stroke={INK} strokeWidth={3.2} strokeLinecap="round" />
      <path d={`M${x} ${y}V${y - 27 * s}`} stroke="#e8edf4" strokeWidth={1.5} strokeLinecap="round" />
      <path d={`M${x} ${y - 27 * s}L${x + dir * 16 * s} ${y - 22.5 * s}L${x} ${y - 18 * s}Z`} fill={color} stroke={INK} strokeWidth={1.3} strokeLinejoin="round" />
      {k != null && (
        <text x={x + dir * 6 * s} y={y - 22.3 * s} textAnchor="middle" dominantBaseline="central" fontSize={6.5 * s} fontWeight={900} fill={INK} fontFamily="Manrope, system-ui, sans-serif">
          {k}
        </text>
      )}
    </g>
  )
}

const Camps = memo(function Camps({ g, reached, planted }: { g: Geo; reached: number; planted: boolean }) {
  const s = furnitureScale(g)
  const out: ReactNode[] = []
  // base camp: two tents and a signpost
  const b = campPt(g, 0)
  out.push(
    <g key="base">
      <Tent x={b.x - 34 * s} y={b.y + 3} s={s} color={TENTS[0]} />
      <Tent x={b.x + 36 * s} y={b.y + 4} s={s * 1.15} color={TENTS[1]} />
      <g>
        <rect x={b.x - 70 * s} y={b.y - 22 * s} width={3 * s} height={24 * s} fill="#7a4e28" stroke={INK} strokeWidth={1.1} />
        <rect x={b.x - 92 * s} y={b.y - 26 * s} width={46 * s} height={12 * s} rx={2 * s} fill="#c98a4b" stroke={INK} strokeWidth={1.3} />
        <text x={b.x - 69 * s} y={b.y - 19.8 * s} textAnchor="middle" dominantBaseline="central" fontSize={6.6 * s} fontWeight={900} fill="#3a1e08" fontFamily="Manrope, system-ui, sans-serif" letterSpacing=".04em">
          BASE CAMP
        </text>
      </g>
    </g>,
  )
  for (let k = 1; k < PITCHES; k++) {
    const p = campPt(g, k)
    const side = p.x >= g.cx ? 1 : -1
    const w = 38 * s
    const snow = k >= SNOW - 0.2
    const made = k <= reached
    out.push(
      <g key={k}>
        <path
          d={`M${p.x - w} ${p.y + 1}Q${p.x - w * 0.7} ${p.y - 3 * s} ${p.x - w * 0.3} ${p.y - 1}L${p.x + w * 0.35} ${p.y - 1.5}Q${p.x + w * 0.8} ${p.y - 3 * s} ${p.x + w} ${p.y + 2}L${p.x + w * 0.62} ${p.y + 11 * s}Q${p.x + w * 0.1} ${p.y + 25 * s} ${p.x - w * 0.5} ${p.y + 12 * s}Z`}
          fill="#454b63"
          stroke={INK}
          strokeWidth={1.7}
          strokeLinejoin="round"
        />
        <path d={`M${p.x - w} ${p.y + 1}Q${p.x - w * 0.7} ${p.y - 3 * s} ${p.x - w * 0.3} ${p.y - 1}L${p.x + w * 0.35} ${p.y - 1.5}Q${p.x + w * 0.8} ${p.y - 3 * s} ${p.x + w} ${p.y + 2}L${p.x + w * 0.88} ${p.y + 4.6 * s}H${p.x - w * 0.9}Z`} fill={snow ? '#f4f9ff' : '#a2a9bc'} />
        <circle cx={p.x - w * 0.06} cy={p.y + 11 * s} r={6.2 * s} fill={made ? '#f7c548' : '#1b2235'} stroke={INK} strokeWidth={1.2} />
        <text x={p.x - w * 0.06} y={p.y + 11.4 * s} textAnchor="middle" dominantBaseline="central" fontSize={7.6 * s} fontWeight={900} fill={made ? '#2a1c00' : '#dfe7f0'} fontFamily="Manrope, system-ui, sans-serif">
          {k}
        </text>
        <Tent x={p.x + side * 22 * s} y={p.y - 1} s={s * 0.85} color={TENTS[k % TENTS.length]} />
        <Pennant x={p.x - side * 25 * s} y={p.y - 0.5} s={s} dir={-side} color={made ? '#f7c548' : '#dfe7f0'} />
      </g>,
    )
  }
  // the summit: a cairn, a marker, and once made the climber's own flag
  const t = campPt(g, PITCHES)
  out.push(
    <g key="top">
      <circle cx={t.x} cy={t.y - 14 * s} r={44 * s} fill="#fff6c8" opacity={planted ? 0.4 : 0.16} />
      <g>
        <ellipse cx={t.x - 15 * s} cy={t.y - 2 * s} rx={7 * s} ry={4 * s} fill="#6d7488" stroke={INK} strokeWidth={1.2} />
        <ellipse cx={t.x - 15 * s} cy={t.y - 7 * s} rx={5.4 * s} ry={3.4 * s} fill="#80879b" stroke={INK} strokeWidth={1.2} />
        <ellipse cx={t.x - 15 * s} cy={t.y - 11.2 * s} rx={3.6 * s} ry={2.6 * s} fill="#959cb0" stroke={INK} strokeWidth={1.2} />
      </g>
      {planted ? (
        <g>
          <path d={`M${t.x + 12 * s} ${t.y}V${t.y - 46 * s}`} stroke={INK} strokeWidth={3.6} strokeLinecap="round" />
          <path d={`M${t.x + 12 * s} ${t.y}V${t.y - 46 * s}`} stroke="#f1f4f8" strokeWidth={1.8} strokeLinecap="round" />
          <g style={{ transformBox: 'fill-box', transformOrigin: '0% 50%', animation: 'summit-wave 1.1s ease-in-out infinite' }}>
            <path d={`M${t.x + 12 * s} ${t.y - 46 * s}H${t.x + 40 * s}L${t.x + 34 * s} ${t.y - 37 * s}L${t.x + 40 * s} ${t.y - 28 * s}H${t.x + 12 * s}Z`} fill="#f7c548" stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
            <text x={t.x + 24 * s} y={t.y - 37 * s} textAnchor="middle" dominantBaseline="central" fontSize={11 * s} fontWeight={900} fill="#2a1c00" fontFamily="Manrope, system-ui, sans-serif">
              B
            </text>
          </g>
        </g>
      ) : (
        <Pennant x={t.x - 15 * s} y={t.y - 13 * s} s={s * 0.8} dir={1} color="#ff4d61" />
      )}
    </g>,
  )
  return <>{out}</>
})

/* ---------------- the routes ---------------- */

const DASH: Record<RouteId, { dash: string; w: number }> = {
  trail: { dash: '0.5 7', w: 4 },
  ridge: { dash: '', w: 2.6 },
  cliff: { dash: '7 5', w: 3 },
  wall: { dash: '2.5 3.5', w: 3.4 },
}

function RouteLines({ g, path, options, hover, active }: { g: Geo; path: readonly RouteId[]; options: number | null; hover: RouteId | null; active: { k: number; r: RouteId } | null }) {
  const past = path.map((r, i) => ({ r, d: dOf(routePath(g, i, r).pts) }))
  const s = furnitureScale(g)
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      {past.map((p, i) =>
        active && active.k === i ? null : (
          <g key={i}>
            <path d={p.d} stroke={INK} strokeWidth={6} opacity={0.4} />
            <path d={p.d} stroke={LOOK[p.r].a} strokeWidth={3} opacity={0.95} />
          </g>
        ),
      )}
      {options != null &&
        options < PITCHES &&
        ROUTES.map((r) => {
          const d = dOf(routePath(g, options, r.id).pts)
          const on = hover === r.id
          const dim = hover != null && !on
          return (
            <g key={r.id} opacity={dim ? 0.3 : 1}>
              {on && <path d={d} stroke={LOOK[r.id].a} strokeWidth={13} opacity={0.28} />}
              <path d={d} stroke={INK} strokeWidth={DASH[r.id].w + 3} opacity={on ? 0.55 : 0.28} strokeDasharray={on ? undefined : DASH[r.id].dash || undefined} />
              <path d={d} stroke={LOOK[r.id].a} strokeWidth={on ? DASH[r.id].w + 0.8 : DASH[r.id].w} opacity={on ? 1 : 0.7} strokeDasharray={on ? undefined : DASH[r.id].dash || undefined} />
            </g>
          )
        })}
      {options != null && options < PITCHES && hover && (
        <HoverTag g={g} k={options + 1} r={hover} path={path} s={s} />
      )}
      {active && (
        <g>
          <path d={dOf(routePath(g, active.k, active.r).pts)} stroke={LOOK[active.r].a} strokeWidth={11} opacity={0.25} />
          <path d={dOf(routePath(g, active.k, active.r).pts)} stroke={INK} strokeWidth={6} opacity={0.45} />
          <path d={dOf(routePath(g, active.k, active.r).pts)} stroke={LOOK[active.r].a} strokeWidth={3.2} />
        </g>
      )}
    </g>
  )
}

function HoverTag({ g, k, r, path, s }: { g: Geo; k: number; r: RouteId; path: readonly RouteId[]; s: number }) {
  const p = campPt(g, k)
  const text = multText(nextMultiplier(path, r))
  const w = (text.length * 7.6 + 22) * Math.max(0.85, s)
  const h = 22 * Math.max(0.85, s)
  const y = p.y - 46 * s - h
  return (
    <g>
      <circle cx={p.x} cy={p.y - 2} r={16 * s} fill="none" stroke={LOOK[r].a} strokeWidth={2.5} style={{ animation: 'summit-throb 1s ease-in-out infinite' }} />
      <rect x={p.x - w / 2} y={y} width={w} height={h} rx={h / 2} fill={LOOK[r].a} stroke={INK} strokeWidth={1.8} />
      <path d={`M${p.x - 5} ${y + h - 0.5}L${p.x} ${y + h + 6}L${p.x + 5} ${y + h - 0.5}`} fill={LOOK[r].a} stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
      <rect x={p.x - 6} y={y + h - 3} width={12} height={3} fill={LOOK[r].a} />
      <text x={p.x} y={y + h / 2 + 0.5} textAnchor="middle" dominantBaseline="central" fontSize={12.5 * Math.max(0.85, s)} fontWeight={900} fill={LOOK[r].ink} fontFamily="Manrope, system-ui, sans-serif">
        {text}
      </text>
    </g>
  )
}

/* ---------------- the moments ---------------- */

export interface Burst {
  id: number
  x: number
  y: number
  word: string
  rope: boolean
}
export interface Pop {
  id: number
  k: number
  text: string
  color: string
}

function BurstMark({ b, s }: { b: Burst; s: number }) {
  const R = 40 * s
  const star = Array.from({ length: 24 }, (_, i) => {
    const r = i % 2 ? R * 0.55 : R
    const a = (i / 24) * Math.PI * 2
    return `${(b.x + Math.cos(a) * r).toFixed(1)} ${(b.y + Math.sin(a) * r * 0.78).toFixed(1)}`
  }).join('L')
  return (
    <motion.g initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.2, 1, 1.05] }} transition={{ duration: 2, times: [0, 0.1, 0.75, 1] }} style={{ originX: '50%', originY: '50%' }}>
      <path d={`M${star}Z`} fill="#fff4cf" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
      <text x={b.x} y={b.y + 1} textAnchor="middle" dominantBaseline="central" fontSize={16 * s} fontWeight={900} fontStyle="italic" fill="#e0233f" stroke="#fff4cf" strokeWidth={1} paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
        {b.word}
      </text>
    </motion.g>
  )
}

function Debris({ b, g }: { b: Burst; g: Geo }) {
  const s = furnitureScale(g)
  if (b.rope) {
    // the rope's two ends whip away from the break
    return (
      <g fill="none" stroke="#f3ecd9" strokeWidth={2.2} strokeLinecap="round">
        <motion.path initial={{ d: `M${b.x} ${b.y - 4}Q${b.x + 4} ${b.y - 20} ${b.x} ${b.y - 36}` }} animate={{ d: [`M${b.x} ${b.y - 4}Q${b.x + 4} ${b.y - 20} ${b.x} ${b.y - 36}`, `M${b.x} ${b.y - 36}Q${b.x - 16} ${b.y - 30} ${b.x - 10} ${b.y - 46}`, `M${b.x} ${b.y - 50}Q${b.x - 4} ${b.y - 44} ${b.x - 2} ${b.y - 54}`], opacity: [1, 1, 0] }} transition={{ duration: 0.9 }} />
        <motion.path initial={{ d: `M${b.x} ${b.y + 4}Q${b.x - 4} ${b.y + 18} ${b.x} ${b.y + 30}` }} animate={{ d: [`M${b.x} ${b.y + 4}Q${b.x - 4} ${b.y + 18} ${b.x} ${b.y + 30}`, `M${b.x} ${b.y + 8}Q${b.x + 18} ${b.y + 18} ${b.x + 12} ${b.y + 36}`], opacity: [1, 0] }} transition={{ duration: 0.8 }} />
      </g>
    )
  }
  return (
    <g>
      {Array.from({ length: 7 }, (_, i) => {
        const dx = jitter(b.id + i) * 26 * s
        const r = (2.2 + ((jitter(b.id + i + 9) + 1) / 2) * 3) * s
        return (
          <motion.path
            key={i}
            d={`M${b.x + dx - r} ${b.y}L${b.x + dx} ${b.y - r}L${b.x + dx + r} ${b.y - r * 0.2}L${b.x + dx + r * 0.4} ${b.y + r}Z`}
            fill="#6d6f80"
            stroke={INK}
            strokeWidth={1}
            initial={{ y: 0, opacity: 1, rotate: 0 }}
            animate={{ y: g.S * (1.2 + i * 0.12), opacity: [1, 1, 0], rotate: jitter(i) * 360 }}
            transition={{ duration: 1.1 + i * 0.06, ease: [0.5, 0, 0.9, 0.6] }}
            style={{ originX: '50%', originY: '50%' }}
          />
        )
      })}
    </g>
  )
}

function PopMark({ p, g }: { p: Pop; g: Geo }) {
  const c = campPt(g, p.k)
  const s = furnitureScale(g)
  return (
    <motion.g initial={{ opacity: 0, y: 0 }} animate={{ opacity: [0, 1, 1, 0], y: -54 * s }} transition={{ duration: 1.5, ease: 'easeOut', times: [0, 0.12, 0.7, 1] }}>
      <text x={c.x} y={c.y - 62 * s} textAnchor="middle" dominantBaseline="central" fontSize={22 * s} fontWeight={900} fill={p.color} stroke={INK} strokeWidth={4.5} paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
        {p.text}
      </text>
    </motion.g>
  )
}

/* ---------------- the weather ---------------- */

const Weather = memo(function Weather({ L, level, clear }: { L: Layout; level: number; clear: boolean }) {
  const wind = clear ? 0 : Math.max(0, Math.min(1, (level - 1) / 8))
  const snow = clear ? 0 : Math.max(0, Math.min(1, (level - 4.5) / 4.5))
  const streaks = Math.round(wind * 14)
  const flakes = Math.round(snow * 84)
  const h = L.h
  const w = L.w
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: streaks }, (_, i) => {
        const len = 50 + ((jitter(i + 7000) + 1) / 2) * 110
        return (
          <div
            key={`w${i}`}
            className="absolute left-0 rounded-full"
            style={{
              top: `${8 + ((jitter(i + 7100) + 1) / 2) * 72}%`,
              width: len,
              height: 1.6,
              background: 'linear-gradient(to right, transparent, rgba(255,255,255,.6), transparent)',
              ['--x0' as string]: `${w + 20}px`,
              ['--x1' as string]: `${-len - 40}px`,
              animation: `summit-wind ${(1.5 - wind * 0.6 + ((jitter(i + 7200) + 1) / 2) * 0.6).toFixed(2)}s linear ${(((jitter(i + 7300) + 1) / 2) * 2).toFixed(2)}s infinite`,
              opacity: 0.5 + wind * 0.5,
              transform: `translate3d(${w + 20}px, 0, 0)`,
            }}
          />
        )
      })}
      {Array.from({ length: flakes }, (_, i) => {
        const r = 1.6 + ((jitter(i + 8000) + 1) / 2) * (2 + snow * 2.2)
        return (
          <div
            key={`s${i}`}
            className="absolute top-0 rounded-full bg-white"
            style={{
              left: `${((jitter(i + 8100) + 1) / 2) * 115}%`,
              width: r,
              height: r,
              opacity: 0.55 + ((jitter(i + 8200) + 1) / 2) * 0.45,
              ['--dx' as string]: `${-(60 + wind * 220)}px`,
              ['--dy' as string]: `${h + 20}px`,
              animation: `summit-snow ${(3.4 - snow * 1.6 + ((jitter(i + 8300) + 1) / 2) * 1.2).toFixed(2)}s linear ${(((jitter(i + 8400) + 1) / 2) * 3).toFixed(2)}s infinite`,
              transform: 'translate3d(0, -14px, 0)',
            }}
          />
        )
      })}
      {snow > 0.4 && <div className="absolute inset-0" style={{ background: `rgba(200,215,240,${(snow - 0.4) * 0.18})` }} />}
      {clear && (
        <div className="absolute left-1/2 top-[-40%] h-[140%] w-[140%] -translate-x-1/2 opacity-[.16]" style={{ background: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(255,236,170,.5) 0deg 7deg, transparent 7deg 22deg)', animation: 'summit-rays 40s linear infinite', maskImage: 'radial-gradient(closest-side, #000, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000, transparent)' }} />
      )}
      <div className="absolute inset-0" style={{ background: `radial-gradient(120% 95% at 45% 42%, transparent 58%, rgba(5,10,28,${(0.16 + snow * 0.34).toFixed(2)}) 100%)` }} />
    </div>
  )
})

/** the clouds below the climber: the deck sits on them, and a fall drops into them */
const CloudBank = memo(function CloudBank({ L, level }: { L: Layout; level: number }) {
  const top = L.deck.y - (L.wide ? 92 : 64)
  const h = L.h - top
  const r = L.wide ? 34 : 24
  const rows = [
    { y: 26, r: r * 0.85, c: '#e9f2fb', seed: 9100 },
    { y: 48, r, c: '#f6fbff', seed: 9200 },
    { y: 78, r: r * 1.15, c: '#ffffff', seed: 9300 },
  ]
  return (
    <div className="pointer-events-none absolute left-0 right-0" style={{ top, height: h, opacity: Math.min(1, Math.max(0.28, level / 2.2)), transition: 'opacity 1.2s' }}>
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${L.w} ${h}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="summit-bank" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset=".45" stopColor="#f4f9ff" stopOpacity=".85" />
            <stop offset="1" stopColor="#dfeaf6" />
          </linearGradient>
        </defs>
        <rect x="0" y={h * 0.35} width={L.w} height={h * 0.65} fill="url(#summit-bank)" />
        {rows.map((row) => (
          <g key={row.seed} style={{ animation: `summit-drift ${9 + row.seed / 2300}s ease-in-out infinite alternate` }}>
            {Array.from({ length: Math.ceil((L.w + 120) / (row.r * 1.4)) }, (_, i) => {
              const x = -60 + i * row.r * 1.4 + jitter(row.seed + i) * row.r * 0.3
              const rr = row.r * (0.8 + ((jitter(row.seed + i + 40) + 1) / 2) * 0.5)
              return (
                <g key={i}>
                  <circle cx={x} cy={row.y + rr * 0.35} r={rr} fill="#c9d9ea" />
                  <circle cx={x} cy={row.y} r={rr} fill={row.c} />
                </g>
              )
            })}
          </g>
        ))}
      </svg>
    </div>
  )
})

/* ---------------- the scene ---------------- */

export interface SceneProps {
  L: Layout
  /** the camera altitude, in camps */
  alt: MotionValue<number>
  /** the routes climbed so far, on show */
  path: readonly RouteId[]
  /** the camp whose four routes are offered (null: none) */
  options: number | null
  hover: RouteId | null
  /** the pitch being climbed */
  active: { k: number; r: RouteId } | null
  /** camps made: their pennants turn gold */
  reached: number
  /** the climber's flag is up on the summit */
  planted: boolean
  climber: { x: MotionValue<number>; y: MotionValue<number>; spin: MotionValue<number>; fade: MotionValue<number>; pose: Pose; face: 1 | -1 }
  /** roped up from camp k (the Sheer Wall) */
  rope: number | null
  burst: Burst | null
  pop: Pop | null
  /** the weather: the camp the climber is at, and whether the summit cleared it */
  level: number
  clear: boolean
}

export function Scene(p: SceneProps) {
  const g = p.L.geo
  const u = useUid()
  // the world, the parallax groups and the rope follow the camera and the climber (subscribed here, so a new stage
  // size re-places them at once)
  const worldY = useMotionValue(0)
  const far1 = useMotionValue(0)
  const far2 = useMotionValue(0)
  const sunY = useMotionValue(0)
  const ropeD = useMotionValue('M0 0')
  useLayoutEffect(() => {
    const place = (a: number) => {
      worldY.set(g.top + g.anchor + a * g.S)
      far1.set(-(1 - 0.16) * a * g.S)
      far2.set(-(1 - 0.34) * a * g.S)
      sunY.set(-(1 - 0.05) * a * g.S)
    }
    place(p.alt.get())
    return p.alt.on('change', place)
  }, [g.top, g.anchor, g.S, p.alt, worldY, far1, far2, sunY])
  const { x: climberX, y: climberY } = p.climber
  useLayoutEffect(() => {
    if (p.rope == null) return
    const a = campPt(g, p.rope)
    const lift = 22 * furnitureScale(g)
    const draw = () => {
      const x = climberX.get()
      const y = climberY.get()
      ropeD.set(`M${a.x.toFixed(1)} ${(a.y - 3).toFixed(1)}Q${((x + a.x) / 2 + 6).toFixed(1)} ${((y + a.y) / 2 + 4).toFixed(1)} ${x.toFixed(1)} ${(y - lift).toFixed(1)}`)
    }
    draw()
    const u1 = climberX.on('change', draw)
    const u2 = climberY.on('change', draw)
    return () => {
      u1()
      u2()
    }
  }, [p.rope, g, climberX, climberY, ropeD])

  // the still art is drawn once per stage size
  const key = `${g.w}|${g.h}|${g.S}|${g.cx}|${g.sw}|${g.anchor}`
  const still = useMemo(
    () => ({
      sky: <Sky g={g} u={u} />,
      range1: <Range g={g} seed={100} peakHi={1.75} peakLo={1.05} base={4} fill="#9dbcdc" shade="#86a7cc" snow="#f2f8ff" />,
      range2: <Range g={g} seed={300} peakHi={1.05} peakLo={0.5} base={4} fill="#6f90b8" shade="#5b7ca6" snow="#e8f1fc" />,
      sea: (
        <>
          <Puffs g={g} a={2.3} seed={200} r={26 * furnitureScale(g)} color="#f7fbff" under="#cddcec" opacity={0.95} />
          <Puffs g={g} a={5.5} seed={600} r={30 * furnitureScale(g)} color="#ffffff" under="#d6e2f0" opacity={0.92} />
          <Puffs g={g} a={8.4} seed={900} r={22 * furnitureScale(g)} color="#e9f0fb" under="#b9c9e2" opacity={0.75} />
        </>
      ),
      rock: <Rock g={g} u={u} />,
      front: (
        <g style={{ animation: 'summit-drift 14s ease-in-out infinite alternate' }}>
          <Puffs g={g} a={2.75} seed={400} r={15 * furnitureScale(g)} color="#ffffff" under="#e0eaf5" opacity={0.75} from={-50} to={g.cx - halfWidth(g, 2.75) + 30} />
          <Puffs g={g} a={2.6} seed={450} r={15 * furnitureScale(g)} color="#ffffff" under="#e0eaf5" opacity={0.75} from={g.cx + halfWidth(g, 2.6) - 40} />
          <Puffs g={g} a={5.95} seed={700} r={17 * furnitureScale(g)} color="#ffffff" under="#dfe8f4" opacity={0.7} from={-50} to={g.cx - halfWidth(g, 5.95) + 26} />
          <Puffs g={g} a={6.05} seed={750} r={17 * furnitureScale(g)} color="#ffffff" under="#dfe8f4" opacity={0.7} from={g.cx + halfWidth(g, 6.05) - 30} />
        </g>
      ),
    }),
    // the still art depends only on the stage's size
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, u],
  )
  const sc = furnitureScale(g)

  return (
    <div className="absolute inset-0 overflow-hidden">
      <style>{KEYFRAMES}</style>
      <motion.svg className="absolute left-0 top-0" width={g.w} height={g.bottom - g.top} viewBox={`0 ${g.top} ${g.w} ${g.bottom - g.top}`} style={{ y: worldY }} aria-hidden>
        {still.sky}
        <motion.g style={{ y: sunY }}>
          <circle cx={g.cx + g.sw * 0.3} cy={-g.anchor + 84} r={92} fill={`url(#${u}sun)`} />
          <circle cx={g.cx + g.sw * 0.3} cy={-g.anchor + 84} r={17} fill="#fffbe6" />
        </motion.g>
        <motion.g style={{ y: far1 }}>{still.range1}</motion.g>
        <motion.g style={{ y: far2 }}>{still.range2}</motion.g>
        {still.sea}
        {still.rock}
        <Camps g={g} reached={p.reached} planted={p.planted} />
        <RouteLines g={g} path={p.path} options={p.options} hover={p.hover} active={p.active} />
        {still.front}
        {p.rope != null && <motion.path d={ropeD} fill="none" stroke="#f3ecd9" strokeWidth={2.2} strokeLinecap="round" style={{ filter: 'drop-shadow(0 1px 0 rgba(20,26,43,.8))' }} />}
        <Climber x={p.climber.x} y={p.climber.y} spin={p.climber.spin} fade={p.climber.fade} pose={p.climber.pose} face={p.climber.face} scale={sc} />
        <AnimatePresence>{p.burst && <Debris key={`d${p.burst.id}`} b={p.burst} g={g} />}</AnimatePresence>
        <AnimatePresence>{p.burst && <BurstMark key={`b${p.burst.id}`} b={p.burst} s={sc} />}</AnimatePresence>
        <AnimatePresence>{p.pop && <PopMark key={p.pop.id} p={p.pop} g={g} />}</AnimatePresence>
      </motion.svg>
      <CloudBank L={p.L} level={p.level} />
      <Weather L={p.L} level={p.level} clear={p.clear} />
    </div>
  )
}
