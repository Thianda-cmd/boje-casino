import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Pot Luck's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold gradients):
  a violet room with a burst of gold light, the ring of everyone's tickets in their colours behind, the gold pointer
  on top, and in front the glass jar crammed with bands of coloured coins, heaped over its gold rim, with more coins
  tumbling in. Plain SVG, part of the main bundle; the busy part sits high, clear of the tile's name strip. The icon is
  a 24 × 24 stroke drawing like the other nav icons: a jar with a coin dropping in.
*/

const INK = '#170733'
const RING = [
  ['#4cb4ff', 0.2],
  ['#f7c548', 0.11],
  ['#ff5fa2', 0.17],
  ['#22d36f', 0.24],
  ['#ff8a3d', 0.09],
  ['#9b7bff', 0.12],
  ['#22c7d8', 0.07],
] as const
const BANDS = [
  ['#4cb4ff', 16],
  ['#f7c548', 9],
  ['#ff5fa2', 13],
  ['#22d36f', 19],
] as const

export function PotCover() {
  const u = useUid() + 'pc'
  const cx = 100
  const cy = 118
  const pt = (r: number, a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)] as const
  const f = (n: number) => n.toFixed(2)
  const sector = (r0: number, r1: number, a0: number, a1: number) => {
    const [x0, y0] = pt(r1, a0)
    const [x1, y1] = pt(r1, a1)
    const [x2, y2] = pt(r0, a1)
    const [x3, y3] = pt(r0, a0)
    const big = a1 - a0 > 180 ? 1 : 0
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${big} 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${big} 0 ${f(x3)} ${f(y3)}Z`
  }
  let at = -14
  const arcs = RING.map(([c, s]) => {
    const a0 = at
    at += s * 360
    return { c, a0, a1: at }
  })
  // the jar: its body, and the inside the coins fill
  const body = 'M70 92 C70 100 52 104 52 118 L52 188 Q52 202 66 202 L134 202 Q148 202 148 188 L148 118 C148 104 130 100 130 92 Z'
  let y = 198
  const bands = BANDS.map(([c, h]) => {
    y -= h
    return { c, y, h }
  })
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#a35bff" />
          <stop offset=".45" stopColor="#5b20b8" />
          <stop offset="1" stopColor="#1c0943" />
        </linearGradient>
        <radialGradient id={`${u}burst`} cx=".5" cy=".46" r=".55">
          <stop offset="0" stopColor="#ffe58a" stopOpacity=".75" />
          <stop offset=".45" stopColor="#ffb84d" stopOpacity=".18" />
          <stop offset="1" stopColor="#ffb84d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
        <linearGradient id={`${u}glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#d8f1ff" stopOpacity=".38" />
          <stop offset=".22" stopColor="#d8f1ff" stopOpacity=".04" />
          <stop offset=".78" stopColor="#d8f1ff" stopOpacity=".02" />
          <stop offset="1" stopColor="#d8f1ff" stopOpacity=".3" />
        </linearGradient>
        <linearGradient id={`${u}cyl`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".45" />
          <stop offset=".35" stopColor="#fff" stopOpacity=".18" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".5" />
        </linearGradient>
        <clipPath id={`${u}in`}>
          <path d={body} />
        </clipPath>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      {/* the burst of light, its rays */}
      {Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * 360
        const [x0, y0] = pt(0, a)
        const [x1, y1] = pt(190, a - 6)
        const [x2, y2] = pt(190, a + 6)
        return <path key={i} d={`M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}Z`} fill="#ffe58a" opacity=".07" />
      })}
      <circle cx={cx} cy={cy} r="120" fill={`url(#${u}burst)`} />
      {/* sparkles */}
      {[
        [24, 40, 3.2],
        [176, 34, 2.4],
        [18, 150, 2.2],
        [184, 132, 3],
        [160, 214, 2],
        [36, 222, 2.4],
      ].map(([x, sy, r], i) => (
        <path key={i} d={`M${x} ${sy - r * 2}L${x + r * 0.5} ${sy - r * 0.5}L${x + r * 2} ${sy}L${x + r * 0.5} ${sy + r * 0.5}L${x} ${sy + r * 2}L${x - r * 0.5} ${sy + r * 0.5}L${x - r * 2} ${sy}L${x - r * 0.5} ${sy - r * 0.5}Z`} fill="#fff6c8" />
      ))}
      {/* the ring of tickets */}
      <circle cx={cx} cy={cy + 4} r="88" fill="#000" opacity=".3" />
      <circle cx={cx} cy={cy} r="88" fill="#1b0b3d" stroke={INK} strokeWidth="3" />
      {arcs.map((a, i) => (
        <path key={i} d={sector(64, 84, a.a0, a.a1)} fill={a.c} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      ))}
      {arcs.map((a, i) => {
        const [x0, y0] = pt(80, a.a0 + 4)
        const [x1, y1] = pt(80, a.a1 - 4)
        return <path key={`h${i}`} d={`M${f(x0)} ${f(y0)}A80 80 0 0 1 ${f(x1)} ${f(y1)}`} fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      })}
      <circle cx={cx} cy={cy} r="64" fill="#2a1260" stroke={INK} strokeWidth="2.5" />
      {/* the jar */}
      <ellipse cx="100" cy="205" rx="52" ry="6" fill="#000" opacity=".35" />
      <path d={body} fill="#12062b" fillOpacity=".75" />
      <g clipPath={`url(#${u}in)`}>
        {bands.map((b, i) => (
          <rect key={i} x="50" y={b.y} width="100" height={b.h + 0.5} fill={b.c} />
        ))}
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d={`M50 ${f(196 - i * 3.6)} Q62 ${f(197.4 - i * 3.6)} 75 ${f(196 - i * 3.6)} T100 ${f(196 - i * 3.6)} T125 ${f(196 - i * 3.6)} T150 ${f(196 - i * 3.6)}`} fill="none" stroke={INK} strokeOpacity=".28" strokeWidth=".9" />
        ))}
        <rect x="50" y="130" width="100" height="72" fill={`url(#${u}cyl)`} />
      </g>
      {/* coins heaped over the rim */}
      <path d="M58 142 Q70 118 100 114 Q130 118 142 142 Z" fill="#22d36f" stroke={INK} strokeWidth="2" />
      {[
        [80, 120, -12],
        [100, 112, 0],
        [120, 121, 10],
        [90, 104, -6],
        [111, 103, 8],
        [69, 132, -16],
        [131, 133, 14],
        [100, 95, 0],
      ].map(([x, cy2, r], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${cy2})`}>
          <ellipse cx={x} cy={cy2 + 2} rx="11.5" ry="4.6" fill="#a8700c" stroke={INK} strokeWidth="1.6" />
          <ellipse cx={x} cy={cy2} rx="11.5" ry="4.6" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="1.6" />
          <ellipse cx={x} cy={cy2} rx="6.5" ry="2.2" fill="none" stroke="#a8700c" strokeWidth="1" />
        </g>
      ))}
      {/* the glass over them */}
      <path d={body} fill={`url(#${u}glass)`} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M60 124 C60 114 66 108 74 104 L74 110 C69 113 66 118 66 126 L66 186 Q66 192 70 194 L68 197 Q60 194 60 186 Z" fill="#fff" opacity=".55" />
      <path d="M140 128 L140 182 Q140 188 137 191" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="2.4" strokeLinecap="round" />
      {/* the gold rim */}
      <rect x="64" y="84" width="72" height="12" rx="5" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.4" />
      <rect x="68" y="86.5" width="64" height="3" rx="1.5" fill="#fff8d8" opacity=".7" />
      {/* coins tumbling in */}
      {[
        [166, 26, 32, '#ff5fa2'],
        [186, 54, -24, '#4cb4ff'],
        [150, 8, 58, '#22d36f'],
      ].map(([x, cy3, r, c], i) => (
        <g key={i} transform={`rotate(${r} ${x} ${cy3})`}>
          <ellipse cx={x as number} cy={(cy3 as number) + 2.2} rx="9.5" ry="9.5" fill="#a8700c" stroke={INK} strokeWidth="1.8" />
          <ellipse cx={x as number} cy={cy3 as number} rx="9.5" ry="9.5" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="1.8" />
          <circle cx={x as number} cy={cy3 as number} r="5.2" fill={c as string} stroke={INK} strokeWidth="1.2" />
        </g>
      ))}
      <path d="M154 40 Q146 46 140 52 M172 66 Q166 70 161 74 M140 20 Q134 26 130 32" fill="none" stroke="#fff6c8" strokeOpacity=".7" strokeWidth="2.2" strokeLinecap="round" />
      {/* the pointer */}
      <g transform={`translate(${cx} 22)`}>
        <path d="M0 26 L-10 4 A11 11 0 1 1 10 4 Z" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        <circle cx="0" cy="0" r="4.4" fill="#ff4d61" stroke={INK} strokeWidth="1.6" />
      </g>
    </svg>
  )
}

export function PotIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M8.5 9.5c0 1.2-3 1.6-3 3.8V19a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5.7c0-2.2-3-2.6-3-3.8" />
      <rect x="7.5" y="7" width="9" height="2.5" rx="1" />
      <path d="M8.5 16.5h7" opacity=".55" />
      <circle cx="16.5" cy="3" r="1.7" fill="currentColor" />
      <path d="M13.2 2.6 11.6 4.4" opacity=".6" />
    </svg>
  )
}
