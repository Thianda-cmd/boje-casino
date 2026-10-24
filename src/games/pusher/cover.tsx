import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Coin Cascade's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): the inside of the neon coin pusher seen from just above its front edge, the striped pusher at the back
  shoving a carpet of silver and gold coins over the edge in a cascade that tumbles down towards the viewer, the Crown
  teetering on the lip in a burst of light, a pink gem in the crowd, the cabinet's teal pillars lined with bulbs, and
  the gold "500×" plaque the Crown pays. Plain SVG, part of the main bundle. The icon is a 24 × 24 stroke drawing like
  the other nav icons: the pusher on its shelf and a coin going over the edge.
*/

const INK = '#0b1033'
const FONT = 'Manrope, system-ui, sans-serif'

/** a coin seen from above at an angle: its edge (the thickness) under its face, a rim, and a star or a B */
function Coin({ x, y, r, flat = 0.42, rot = 0, gold, u }: { x: number; y: number; r: number; flat?: number; rot?: number; gold: boolean; u: string }) {
  const ry = r * flat
  const t = Math.max(1.6, r * 0.22)
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <ellipse cx="0" cy={t} rx={r} ry={ry} fill={gold ? '#b8700c' : '#526899'} stroke={INK} strokeWidth="1.6" />
      <rect x={-r} y="0" width={r * 2} height={t} fill={gold ? '#b8700c' : '#526899'} />
      <path d={`M${-r} 0V${t}M${r} 0V${t}`} stroke={INK} strokeWidth="1.6" />
      <ellipse cx="0" cy="0" rx={r} ry={ry} fill={`url(#${u}${gold ? 'g' : 's'})`} stroke={INK} strokeWidth="1.6" />
      <ellipse cx="0" cy="0" rx={r * 0.74} ry={ry * 0.74} fill="none" stroke={gold ? '#c98a10' : '#8fa2c2'} strokeWidth={Math.max(0.8, r * 0.08)} />
      {gold ? (
        <text x="0" y={ry * 0.05} textAnchor="middle" dominantBaseline="central" fontSize={r * 0.95} fontWeight="900" fill="#c98a10" fontFamily={FONT} transform={`scale(1 ${Math.max(0.45, flat)})`}>
          B
        </text>
      ) : (
        <path transform={`scale(${r / 10} ${(ry / 10) * 1.05})`} d="M0 -5.6L1.5 -1.9L5.4 -1.7L2.4 0.8L3.4 4.6L0 2.5L-3.4 4.6L-2.4 0.8L-5.4 -1.7L-1.5 -1.9Z" fill="#9fb0cb" />
      )}
    </g>
  )
}

export function PusherCover() {
  const u = useUid() + 'pc'
  // the carpet of coins on the tier, back rows first: x, y, radius, gold
  const carpet: [number, number, number, boolean][] = []
  const rows: [number, number, number][] = [
    [104, 13, 9],
    [114, 14.5, 9],
    [126, 16, 8],
    [139, 17.5, 8],
  ]
  rows.forEach(([y, r, n], ri) => {
    for (let i = 0; i < n; i++) {
      const x = 14 + ((i + (ri % 2) * 0.5) * 182) / (n - 0.5)
      const k = Math.sin((i + 1) * 12.9898 + (ri + 1) * 78.233) * 43758.5453
      carpet.push([x + ((k - Math.floor(k)) - 0.5) * 6, y, r, k - Math.floor(k) < 0.32])
    }
  })
  // the cascade: coins tumbling over the edge and down, nearer and bigger as they fall
  const cascade: [number, number, number, number, number, boolean][] = [
    [40, 158, 15, 0.7, -24, false],
    [74, 166, 16, 0.95, 18, true],
    [150, 160, 15, 0.6, 30, false],
    [118, 176, 17, 1, -12, false],
    [58, 196, 19, 0.85, 34, true],
    [168, 190, 18, 0.9, -30, true],
    [96, 210, 21, 0.75, 10, false],
    [140, 222, 22, 0.95, -20, true],
    [28, 226, 20, 0.6, -8, false],
    [188, 232, 21, 0.7, 24, false],
  ]
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0d1450" />
          <stop offset=".55" stopColor="#2a1670" />
          <stop offset="1" stopColor="#4a1a78" />
        </linearGradient>
        <radialGradient id={`${u}burst`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset=".3" stopColor="#ffe9a0" stopOpacity=".75" />
          <stop offset="1" stopColor="#ffd86b" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}teal`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#3ff0e0" stopOpacity=".45" />
          <stop offset="1" stopColor="#3ff0e0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}felt`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#16287a" />
          <stop offset="1" stopColor="#2a46b0" />
        </linearGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#dfe7f5" />
          <stop offset="1" stopColor="#a9b8d2" />
        </linearGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2=".4" y2="1">
          <stop offset="0" stopColor="#fff6c8" />
          <stop offset=".5" stopColor="#ffd23a" />
          <stop offset="1" stopColor="#e09412" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
        <linearGradient id={`${u}chrome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#c7d3e8" />
          <stop offset="1" stopColor="#7898bb" />
        </linearGradient>
        <linearGradient id={`${u}pillar`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0d8a92" />
          <stop offset=".6" stopColor="#16c0b4" />
          <stop offset="1" stopColor="#0d8a92" />
        </linearGradient>
        <pattern id={`${u}stripe`} width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="12" height="12" fill="#ffc93a" />
          <rect width="6" height="12" fill="#121a52" />
        </pattern>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <circle cx="100" cy="96" r="120" fill={`url(#${u}teal)`} />

      {/* the back wall's sunburst and the pusher's striped face */}
      <g opacity=".16">
        {Array.from({ length: 16 }, (_, i) => (
          <path key={i} d="M100 110L92 -60L108 -60Z" fill="#3ff0e0" transform={`rotate(${-80 + i * 10.6} 100 110)`} />
        ))}
      </g>
      <rect x="-4" y="70" width="208" height="22" fill={`url(#${u}stripe)`} stroke={INK} strokeWidth="2.4" />
      <rect x="-4" y="66" width="208" height="6" fill={`url(#${u}chrome)`} stroke={INK} strokeWidth="2" />
      <rect x="-4" y="86" width="208" height="3" fill="#ff3fb4" />

      {/* the tier: felt, then the carpet of coins */}
      <path d="M-4 92H204V150H-4Z" fill={`url(#${u}felt)`} />
      {carpet.map(([x, y, r, g], i) => (
        <Coin key={i} x={x} y={y} r={r} gold={g} u={u} flat={0.4} />
      ))}
      {/* a pink gem in the crowd */}
      <g transform="translate(150 118)">
        <path d="M-9 -3L-5 -9H5L9 -3L0 9Z" fill="#ff3d9a" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M-9 -3H9M-5 -9L-2 -3L0 9M5 -9L2 -3L0 9" fill="none" stroke="#ff9ccd" strokeWidth="1.2" />
        <path d="M-4 -7L-1 -4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </g>

      {/* the front edge: a chrome lip and its strip of lights */}
      <rect x="-4" y="147" width="208" height="7" rx="3.5" fill={`url(#${u}chrome)`} stroke={INK} strokeWidth="2.2" />
      {Array.from({ length: 13 }, (_, i) => (
        <circle key={i} cx={4 + i * 16} cy="158.5" r="2" fill={i % 2 ? '#ff3fb4' : '#ffd23a'} />
      ))}

      {/* the Crown, teetering on the lip in a burst of light */}
      <circle cx="74" cy="132" r="46" fill={`url(#${u}burst)`} />
      <g opacity=".5" stroke="#fff6d6" strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 10 }, (_, i) => {
          const a = (i / 10) * Math.PI * 2 + 0.2
          return <path key={i} d={`M${(74 + Math.cos(a) * 34).toFixed(1)} ${(132 + Math.sin(a) * 34).toFixed(1)}L${(74 + Math.cos(a) * 44).toFixed(1)} ${(132 + Math.sin(a) * 44).toFixed(1)}`} />
        })}
      </g>
      <g transform="translate(74 136) rotate(16)" strokeLinejoin="round">
        <ellipse cx="0" cy="4" rx="27" ry="8" fill="#f6f2ea" stroke={INK} strokeWidth="2.4" />
        {[-18, -6, 6, 18].map((x) => (
          <path key={x} d={`M${x} 2v4`} stroke="#1a1424" strokeWidth="2" strokeLinecap="round" />
        ))}
        <path d="M-22 -14C-12 -30 12 -30 22 -14L22 0H-22Z" fill="#c4126e" stroke={INK} strokeWidth="2.4" />
        <path d="M-24 2L-26 -22L-13 -10L0 -28L13 -10L26 -22L24 2Z" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.4" />
        {[[-26, -22], [0, -28], [26, -22]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="3.4" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="1.8" />
        ))}
        <circle cx="-12" cy="-6" r="3.2" fill="#ff2b4f" stroke={INK} strokeWidth="1.5" />
        <circle cx="0" cy="-5" r="3.6" fill="#3a7bff" stroke={INK} strokeWidth="1.5" />
        <circle cx="12" cy="-6" r="3.2" fill="#20e08a" stroke={INK} strokeWidth="1.5" />
        <path d="M-20 -1H20" stroke="#fff3b8" strokeWidth="1.6" opacity=".8" />
      </g>

      {/* the cascade */}
      {cascade.map(([x, y, r, flat, rot, g], i) => (
        <Coin key={i} x={x} y={y} r={r} flat={flat} rot={rot} gold={g} u={u} />
      ))}
      {/* sparkles */}
      {[
        [36, 112, 4],
        [112, 124, 3],
        [184, 142, 3.4],
        [22, 182, 3],
        [126, 196, 3.6],
        [96, 150, 2.6],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y - r * 2}L${x + r * 0.45} ${y - r * 0.45}L${x + r * 2} ${y}L${x + r * 0.45} ${y + r * 0.45}L${x} ${y + r * 2}L${x - r * 0.45} ${y + r * 0.45}L${x - r * 2} ${y}L${x - r * 0.45} ${y - r * 0.45}Z`} fill="#fff6d6" />
      ))}

      {/* the cabinet's teal pillars, lined with bulbs */}
      {[0, 1].map((s) => (
        <g key={s} transform={s ? 'translate(200 0) scale(-1 1)' : undefined}>
          <path d="M-4 -4H14C16 40 14 170 18 254H-4Z" fill={`url(#${u}pillar)`} stroke={INK} strokeWidth="2.4" />
          <path d="M14 -4C16 40 14 170 18 254" fill="none" stroke="#ffd23a" strokeWidth="2" />
          {Array.from({ length: 9 }, (_, i) => (
            <g key={i}>
              <circle cx={6.5 + i * 0.2} cy={16 + i * 24} r="4" fill={i % 2 ? '#ff7ac8' : '#fff1a8'} opacity=".5" />
              <circle cx={6.5 + i * 0.2} cy={16 + i * 24} r="2.3" fill={i % 2 ? '#ffd1ec' : '#ffffff'} />
            </g>
          ))}
        </g>
      ))}

      {/* the marquee lights along the top */}
      <rect x="-5" y="-4" width="210" height="18" fill="#0f175a" />
      <rect x="-5" y="12" width="210" height="4" fill="#ffcf4d" />
      {Array.from({ length: 11 }, (_, i) => (
        <g key={i}>
          <circle cx={6 + i * 19} cy="5" r={i % 2 ? 4.2 : 5} fill={i % 2 ? '#ff7ac8' : '#fff1a8'} opacity=".55" />
          <circle cx={6 + i * 19} cy="5" r={i % 2 ? 2.6 : 3.2} fill={i % 2 ? '#ffd1ec' : '#ffffff'} />
        </g>
      ))}

      {/* the plaque: what the Crown pays */}
      <g transform="translate(104 26) rotate(-7 47 39)">
        <rect x="8" y="22" width="78" height="34" rx="11" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="3" />
        <rect x="13" y="26" width="68" height="8" rx="4" fill="#fff" opacity=".35" />
        <text x="47" y="40.5" textAnchor="middle" dominantBaseline="central" fontSize="21" fontWeight="900" fontStyle="italic" fill="#3a2400" fontFamily={FONT} letterSpacing="-.5">
          500×
        </text>
      </g>
    </svg>
  )
}

export function PusherIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <path d="M2 10.5h13" />
      <rect x="2" y="4" width="4" height="6.5" rx="1" />
      <rect x="8.2" y="7.4" width="5.6" height="3.1" rx="1.55" />
      <circle cx="17.3" cy="17" r="4.3" />
      <path d="M17.3 14.8v4.4" opacity=".6" />
      <path d="M15.4 11.8c.6.5 1 1 1.3 1.7" opacity=".55" />
    </svg>
  )
}
