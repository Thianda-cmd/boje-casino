import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Market Rush's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): a deep teal trading floor with a faint grid, a row of fat candlesticks climbing from the bottom left (two
  red ones on the way, to keep it honest), the rush line breaking out over them to the top right in a teal-to-gold
  stroke with a gold arrowhead, the BOJE token (a teal coin stamped with a rising chart) and the gold "100×" plaque of
  the top leverage. The bottom of the tile is left calm for the game's name. Plain SVG, part of the main bundle. The
  icon is a 24 × 24 stroke drawing like the other nav icons: two candlesticks under a rising arrow.
*/

const INK = '#03211c'
const FONT = 'Manrope, system-ui, sans-serif'

/** the candles, left to right: x, open, close, high, low (in the tile's coordinates; y grows downward) */
const CANDLES: [number, number, number, number, number][] = [
  [26, 218, 188, 178, 228],
  [54, 188, 202, 182, 212],
  [82, 200, 160, 148, 208],
  [110, 162, 128, 116, 170],
  [138, 128, 146, 120, 154],
  [166, 146, 98, 84, 154],
]

export function MarketCover() {
  const u = useUid() + 'mk'
  const rush = 'M2 172 L40 140 L64 154 L98 108 L122 120 L170 70'
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".45" y2="1">
          <stop offset="0" stopColor="#13806e" />
          <stop offset=".45" stopColor="#074238" />
          <stop offset="1" stopColor="#02171a" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx=".74" cy=".26" r=".62">
          <stop offset="0" stopColor="#7dffe0" stopOpacity=".55" />
          <stop offset=".45" stopColor="#00d1a0" stopOpacity=".16" />
          <stop offset="1" stopColor="#00d1a0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d8fff4" stopOpacity=".22" />
          <stop offset="1" stopColor="#d8fff4" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}up`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8affc0" />
          <stop offset=".45" stopColor="#2fe07f" />
          <stop offset="1" stopColor="#139a4e" />
        </linearGradient>
        <linearGradient id={`${u}dn`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffa3ae" />
          <stop offset=".45" stopColor="#ff4d61" />
          <stop offset="1" stopColor="#b81d36" />
        </linearGradient>
        <linearGradient id={`${u}rush`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#00d1a0" />
          <stop offset=".55" stopColor="#8cffe0" />
          <stop offset="1" stopColor="#ffe08a" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#d9901a" />
        </linearGradient>
        <linearGradient id={`${u}coin`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#b5fff0" />
          <stop offset=".45" stopColor="#00d1a0" />
          <stop offset="1" stopColor="#037a61" />
        </linearGradient>
      </defs>

      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <path d="M118 -10 L160 -10 L96 250 L40 250Z" fill={`url(#${u}beam)`} />
      <path d="M182 -10 L210 -10 L170 250 L136 250Z" fill={`url(#${u}beam)`} opacity=".7" />
      <rect width="200" height="250" fill={`url(#${u}glow)`} />
      {/* the grid */}
      {[44, 76, 108, 140, 172, 204].map((y) => (
        <line key={y} x1="0" x2="200" y1={y} y2={y} stroke="#9fffe6" strokeOpacity=".08" strokeWidth="1" />
      ))}
      {[40, 96, 152].map((x) => (
        <line key={x} y1="0" y2="250" x1={x} x2={x} stroke="#9fffe6" strokeOpacity=".06" strokeWidth="1" />
      ))}

      {/* the candles */}
      {CANDLES.map(([x, o, c, h, l], i) => {
        const up = c < o
        const top = Math.min(o, c)
        const hgt = Math.max(6, Math.abs(o - c))
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={h} y2={l} stroke={INK} strokeWidth="3" strokeLinecap="round" />
            <rect x={x - 9} y={top} width="18" height={hgt} rx="3.5" fill={`url(#${up ? `${u}up` : `${u}dn`})`} stroke={INK} strokeWidth="2.6" />
            <rect x={x - 5.5} y={top + 3} width="3.4" height={Math.max(1, hgt - 6)} rx="1.7" fill="#fff" opacity=".5" />
          </g>
        )
      })}

      {/* the rush line, breaking out */}
      <path d={rush} fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" transform="translate(0 5)" />
      <path d={rush} fill="none" stroke={INK} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <path d={rush} fill="none" stroke={`url(#${u}rush)`} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={rush} fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="translate(-1 -2)" />
      {/* the arrowhead, along the last leg */}
      <path d="M192 46 L183 81 L158 58 Z" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M188 53 L182.5 73 L168.5 60 Z" fill="#fff" opacity=".45" />

      {/* the BOJE token */}
      <g transform="rotate(-12 50 78)">
        <ellipse cx="53" cy="85" rx="29" ry="29" fill="#000" opacity=".3" />
        <circle cx="50" cy="78" r="29" fill="#024c3d" stroke={INK} strokeWidth="3.2" />
        <circle cx="50" cy="78" r="24.5" fill={`url(#${u}coin)`} />
        <circle cx="50" cy="78" r="18" fill="none" stroke="#013a2e" strokeOpacity=".45" strokeWidth="2" />
        <path d="M37 87.5 45 79.5l5 5 11-12" stroke={INK} strokeWidth="4.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M54 72.5h7v7" stroke={INK} strokeWidth="4.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <ellipse cx="40" cy="63" rx="11" ry="4.6" fill="#fff" opacity=".42" transform="rotate(-30 40 63)" />
      </g>

      {/* the top leverage */}
      <g transform="rotate(-8 140 34)" style={{ filter: 'drop-shadow(0 5px 6px rgba(1,14,12,.6))' }}>
        <rect x="104" y="17" width="66" height="34" rx="17" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.8" />
        <rect x="112" y="20.5" width="50" height="9" rx="4.5" fill="#fff" opacity=".4" />
        <text x="137" y="42.5" textAnchor="middle" fontSize="22" fontWeight="900" fill="#2a1600" fontFamily={FONT}>
          100×
        </text>
      </g>

      {/* sparkles */}
      {[
        [94, 70, 4.6],
        [184, 118, 3.6],
        [20, 130, 3],
        [130, 92, 2.6],
        [186, 12, 2.4],
      ].map(([x, y, r], i) => {
        const k = r * 0.22
        return <path key={i} d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`} fill="#eafff8" />
      })}
    </svg>
  )
}

export function MarketIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      {/* two candlesticks */}
      <path d="M7 5v3M7 16v4" />
      <rect x="4.6" y="8" width="4.8" height="8" rx="1.2" />
      <path d="M15 10v2M15 18v2.5" opacity=".6" />
      <rect x="12.6" y="12" width="4.8" height="6" rx="1.2" opacity=".6" />
      {/* the rising arrow */}
      <path d="M12 8.5 16 5l2.2 2.2L21.5 4" />
      <path d="M18.6 3.5h3v3" />
    </svg>
  )
}
