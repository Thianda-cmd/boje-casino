import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Summit's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold gradients): a
  bright sky with a burst of light behind a big snow-capped peak, far ranges either side, the climber roped up on the
  face just below the top in a red jacket and yellow helmet, the gold flag on the summit, a sea of clouds below, and
  the gold "10,000×" plaque the summit can pay. Plain SVG, part of the main bundle. The icon is a 24 × 24 stroke
  drawing like the other nav icons: a peak with a flag on it.
*/

const INK = '#0d1830'
const FONT = 'Manrope, system-ui, sans-serif'

export function SummitCover() {
  const u = useUid() + 'sm'
  const apex = { x: 116, y: 50 }
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}sky`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#1d3f9e" />
          <stop offset=".5" stopColor="#2f86e0" />
          <stop offset="1" stopColor="#8fd4ff" />
        </linearGradient>
        <linearGradient id={`${u}rock`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a8fb0" />
          <stop offset=".55" stopColor="#6b6f92" />
          <stop offset="1" stopColor="#4d4f72" />
        </linearGradient>
        <linearGradient id={`${u}snow`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#d5e8fb" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
        <radialGradient id={`${u}sun`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset=".3" stopColor="#fff1b0" stopOpacity=".85" />
          <stop offset="1" stopColor="#fff1b0" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}sky)`} />
      {/* the burst of light behind the peak */}
      <g opacity=".17">
        {Array.from({ length: 14 }, (_, i) => {
          const a0 = ((i * 360) / 14 - 5) * (Math.PI / 180)
          const a1 = ((i * 360) / 14 + 5) * (Math.PI / 180)
          return <path key={i} d={`M${apex.x} ${apex.y}L${(apex.x + Math.sin(a0) * 320).toFixed(1)} ${(apex.y - Math.cos(a0) * 320).toFixed(1)}L${(apex.x + Math.sin(a1) * 320).toFixed(1)} ${(apex.y - Math.cos(a1) * 320).toFixed(1)}Z`} fill="#fff6d6" />
        })}
      </g>
      <circle cx={apex.x} cy={apex.y - 2} r="46" fill={`url(#${u}sun)`} />
      {/* sparkles */}
      {[
        [24, 34, 3],
        [178, 70, 2.6],
        [40, 92, 2],
        [168, 26, 2.2],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y - r * 2}L${x + r * 0.5} ${y - r * 0.5}L${x + r * 2} ${y}L${x + r * 0.5} ${y + r * 0.5}L${x} ${y + r * 2}L${x - r * 0.5} ${y + r * 0.5}L${x - r * 2} ${y}L${x - r * 0.5} ${y - r * 0.5}Z`} fill="#fff6d6" />
      ))}
      {/* the far ranges */}
      <path d="M-10 190L18 128L34 146L56 104L84 168L84 250H-10Z" fill="#6aa3dc" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M56 104L47 122L54 120L60 128L66 117Z" fill="#f2f8ff" />
      <path d="M18 128L12 142L19 139L24 144Z" fill="#f2f8ff" />
      <path d="M210 188L184 120L168 140L150 112L128 170L128 250H210Z" fill="#5a92cf" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M184 120L178 134L185 131L191 137Z" fill="#f2f8ff" />
      <path d="M150 112L143 127L150 124L157 130Z" fill="#f2f8ff" />
      {/* the peak */}
      <path d={`M14 250L52 168L66 176L88 112L100 118L${apex.x} ${apex.y}L134 96L146 92L168 150L182 158L204 250Z`} fill={`url(#${u}rock)`} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d={`M14 250L52 168L66 176L88 112L100 118L${apex.x} ${apex.y}L110 110L98 160L92 250Z`} fill="#20264d" opacity=".28" />
      <path d="M126 140L142 128M150 176L166 168M70 206L86 198M120 196L134 204M104 230L120 224" stroke="#2f3458" strokeWidth="2.4" strokeLinecap="round" opacity=".5" />
      {/* the snow cap */}
      <path d={`M${apex.x} ${apex.y}L134 96L146 92L152 108L144 104L138 116L130 108L122 122L116 110L108 126L102 114L94 122L88 112L100 118Z`} fill={`url(#${u}snow)`} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d={`M${apex.x} ${apex.y}L100 118L94 122L102 114L108 126L112 104Z`} fill="#a9c4e8" opacity=".55" />
      {/* the rope and the climber on the face */}
      <path d="M100 178C104 160 98 146 101 128" fill="none" stroke="#f6efd9" strokeWidth="2" strokeLinecap="round" />
      <path d="M100 178C104 160 98 146 101 128" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" opacity=".25" transform="translate(1.5 1.5)" />
      <g transform="translate(103 128) rotate(-8) scale(.62)">
        <rect x="-13" y="-41" width="9" height="17" rx="3.2" fill="#ffae1f" stroke={INK} strokeWidth="2" />
        <path d="M1 -38L-6 -52" stroke={INK} strokeWidth="7.5" strokeLinecap="round" />
        <path d="M1 -38L-6 -52" stroke="#c63a24" strokeWidth="5" strokeLinecap="round" />
        <path d="M-1 -23L-10 -12L-4 -2" fill="none" stroke={INK} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-1 -23L-10 -12L-4 -2" fill="none" stroke="#2e3b62" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M0 -23L8 -14L4 -3" fill="none" stroke={INK} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M0 -23L8 -14L4 -3" fill="none" stroke="#2e3b62" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M-6 -40.5C-8 -33 -7 -26 -5.5 -21L6 -21C7.5 -26 8 -33 6.5 -40.5Q.5 -43.5 -6 -40.5Z" fill="#ff5a3c" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="2.5" cy="-48" r="6.5" fill="#ffd0a6" stroke={INK} strokeWidth="2" />
        <path d="M-4.3 -49.4A6.9 6.9 0 0 1 9.5 -49.4L10.5 -48.3H-4.7Z" fill="#ffd23f" stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="7.2" cy="-47.4" r="2.4" fill="#5be3ff" stroke={INK} strokeWidth="1.3" />
        <path d="M2 -38L10 -54" stroke={INK} strokeWidth="7.5" strokeLinecap="round" />
        <path d="M2 -38L10 -54" stroke="#ff5a3c" strokeWidth="5" strokeLinecap="round" />
        <circle cx="10" cy="-54" r="3.2" fill="#283049" stroke={INK} strokeWidth="1.5" />
      </g>
      {/* the summit flag */}
      <path d={`M${apex.x} ${apex.y + 1}V${apex.y - 30}`} stroke={INK} strokeWidth="4" strokeLinecap="round" />
      <path d={`M${apex.x} ${apex.y + 1}V${apex.y - 30}`} stroke="#f1f4f8" strokeWidth="2" strokeLinecap="round" />
      <path d={`M${apex.x + 1} ${apex.y - 30}C${apex.x + 12} ${apex.y - 34} ${apex.x + 20} ${apex.y - 25} ${apex.x + 31} ${apex.y - 29}L${apex.x + 25} ${apex.y - 20}L${apex.x + 30} ${apex.y - 11}C${apex.x + 20} ${apex.y - 8} ${apex.x + 12} ${apex.y - 16} ${apex.x + 1} ${apex.y - 12}Z`} fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {/* the sea of clouds below */}
      <g stroke={INK} strokeWidth="2">
        {[
          [-6, 228, 22],
          [26, 236, 20],
          [60, 230, 24],
          [98, 238, 22],
          [134, 230, 24],
          [170, 236, 22],
          [204, 228, 22],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={i % 2 ? '#eef6ff' : '#ffffff'} />
        ))}
      </g>
      <rect x="-10" y="236" width="220" height="20" fill="#ffffff" />
      {/* the plaque: what the summit can pay */}
      <g transform="translate(104 116) rotate(8 47 39)">
        <rect x="8" y="22" width="78" height="34" rx="11" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="3" />
        <rect x="13" y="26" width="68" height="8" rx="4" fill="#fff" opacity=".35" />
        <text x="47" y="40.5" textAnchor="middle" dominantBaseline="central" fontSize="19" fontWeight="900" fontStyle="italic" fill="#3a2400" fontFamily={FONT} letterSpacing="-.5">
          10,000×
        </text>
      </g>
    </svg>
  )
}

export function SummitIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M2.5 20.5 9.2 8.8l3.1 4.4 2.4-3.4 6.8 10.7Z" />
      <path d="M7 12.6l2.2 1.4 1.6-1.3" />
      <path d="M9.2 8.8V3.2l4.3 1.6-4.3 1.6" />
    </svg>
  )
}
