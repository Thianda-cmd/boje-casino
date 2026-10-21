import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Showtime's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): a game-show studio in purple under two spotlights, the money wheel rising from the bottom edge with its
  gold rim of bulbs and the flapper on top, the marquee sign over it, and the Booster's gold "×25" plaque. Plain SVG,
  part of the main bundle. The icon is a 24 × 24 stroke drawing like the other nav icons: a wheel under its pointer.
*/

const INK = '#140a33'
const FONT = 'Manrope, system-ui, sans-serif'
const SEG = ['#3fa9f5', '#f7c548', '#3fa9f5', '#ff5fa2', '#3fa9f5', '#ff8a3d', '#3fa9f5', '#f7c548', '#9b7bff', '#3fa9f5', '#22d36f', '#f7c548', '#3fa9f5', '#ff5fa2', '#22c7d8', '#f7c548', '#3fa9f5', '#ff4d61']
const LABEL: Record<string, string> = { '#3fa9f5': '1', '#f7c548': '2', '#ff5fa2': '5', '#9b7bff': '10' }

export function ShowtimeCover() {
  const u = useUid() + 'st'
  const cx = 100
  const cy = 186
  const R = 104
  const n = SEG.length
  const step = 360 / n
  const pt = (deg: number, r: number) => [cx + r * Math.sin((deg * Math.PI) / 180), cy - r * Math.cos((deg * Math.PI) / 180)] as const
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#5a2fb8" />
          <stop offset=".5" stopColor="#2a1468" />
          <stop offset="1" stopColor="#100828" />
        </linearGradient>
        <linearGradient id={`${u}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".35" />
          <stop offset="1" stopColor="#fff6c8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
        <radialGradient id={`${u}hub`} cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#4a3392" />
          <stop offset="1" stopColor="#1a1040" />
        </radialGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      {/* the spotlights */}
      <path d="M-10 -10 L40 -10 L120 250 L40 250Z" fill={`url(#${u}beam)`} opacity=".7" />
      <path d="M210 -10 L160 -10 L80 250 L160 250Z" fill={`url(#${u}beam)`} opacity=".55" />
      {/* sparkles */}
      {[
        [22, 70, 3],
        [178, 96, 2.5],
        [30, 128, 2],
        [168, 150, 3],
        [150, 24, 2],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y - r * 2}L${x + r * 0.5} ${y - r * 0.5}L${x + r * 2} ${y}L${x + r * 0.5} ${y + r * 0.5}L${x} ${y + r * 2}L${x - r * 0.5} ${y + r * 0.5}L${x - r * 2} ${y}L${x - r * 0.5} ${y - r * 0.5}Z`} fill="#fff6c8" />
      ))}
      {/* the wheel */}
      <circle cx={cx} cy={cy + 4} r={R + 14} fill="#000" opacity=".4" />
      <circle cx={cx} cy={cy} r={R + 12} fill={`url(#${u}gold)`} stroke={INK} strokeWidth="3" />
      {SEG.map((c, i) => {
        const a0 = (i - 0.5) * step
        const a1 = (i + 0.5) * step
        const [x0, y0] = pt(a0, R)
        const [x1, y1] = pt(a1, R)
        return <path key={i} d={`M${cx} ${cy}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`} fill={c} stroke={INK} strokeWidth="2" />
      })}
      {SEG.map((c, i) => {
        const l = LABEL[c]
        if (!l) return null
        const a = i * step
        const [x, y] = pt(a, R - 18)
        return (
          <text key={i} x={x} y={y} transform={`rotate(${a} ${x} ${y})`} textAnchor="middle" dominantBaseline="central" fontSize={l === '10' ? 12 : 15} fontWeight="900" fill={c === '#f7c548' ? '#3a2400' : '#fff'} fontFamily={FONT}>
            {l}
          </text>
        )
      })}
      {Array.from({ length: 24 }, (_, i) => {
        const [x, y] = pt(i * 15, R + 6)
        return <circle key={i} cx={x} cy={y} r="2.6" fill={i % 2 ? '#fff6c8' : '#ffd25e'} stroke="#8a5a0c" strokeWidth=".8" />
      })}
      <circle cx={cx} cy={cy} r="34" fill={`url(#${u}hub)`} stroke={`url(#${u}gold)`} strokeWidth="4" />
      <circle cx={cx} cy={cy} r="34" fill="none" stroke={INK} strokeWidth="2" />
      {/* the flapper */}
      <path d={`M${cx} ${cy - R + 12} L${cx - 9} ${cy - R - 14} A10 10 0 1 1 ${cx + 9} ${cy - R - 14} Z`} fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={cx} cy={cy - R - 17} r="4.2" fill="#ff4d61" stroke={INK} strokeWidth="1.6" />
      {/* the marquee */}
      <g transform="rotate(-4 100 34)">
        <rect x="30" y="16" width="140" height="38" rx="12" fill="#ff4d61" stroke={INK} strokeWidth="3" />
        <rect x="35" y="21" width="130" height="28" rx="8" fill="#b31d34" />
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={37 + i * 9.7} cy="18.5" r="1.7" fill="#fff6c8" />
        ))}
        {Array.from({ length: 14 }, (_, i) => (
          <circle key={i} cx={37 + i * 9.7} cy="51.5" r="1.7" fill="#fff6c8" />
        ))}
        <text x="100" y="36" textAnchor="middle" dominantBaseline="central" fontSize="21" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="1.2" paintOrder="stroke" letterSpacing="1.5" fontFamily={FONT}>
          SHOWTIME
        </text>
      </g>
      {/* the Booster's plaque */}
      <g transform="rotate(10 166 84)">
        <rect x="142" y="70" width="48" height="28" rx="9" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.5" />
        <text x="166" y="85" textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="900" fill="#3a2400" fontFamily={FONT}>
          ×25
        </text>
      </g>
    </svg>
  )
}

export function ShowtimeIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <circle cx="12" cy="13.5" r="8.5" />
      <path d="M12 13.5 5.4 8.2M12 13.5l6.6-5.3M12 13.5v8.5M12 13.5 3.6 15.5M12 13.5l8.4 2" opacity=".55" />
      <path d="M12 6.8 10 2.6h4Z" fill="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="13.5" r="2.2" fill="currentColor" />
    </svg>
  )
}
