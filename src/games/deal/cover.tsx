import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Banker's Deal's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): a TV studio at night in deep violet under two spotlights, the Banker's silhouette in his lit booth at the
  top with his phone ringing, the player's gold briefcase (number 7) on its podium in the middle with two silver cases
  tilted behind it, and the gold "×250" plaque of the Diamond board's top prize. Plain SVG, part of the main bundle.
  The icon is a 24 × 24 stroke drawing like the other nav icons: a briefcase with its latch.
*/

const INK = '#120a2e'
const FONT = 'Manrope, system-ui, sans-serif'

/** a briefcase drawn at the origin, w wide (its handle above), silver or gold */
function Case({ w, gold, n, u }: { w: number; gold: boolean; n: number; u: string }) {
  const h = w * 0.7
  const r = w * 0.08
  const plate = { w: w * 0.4, h: h * 0.42 }
  return (
    <g>
      <path
        d={`M${w * 0.34} 0 V${-h * 0.14} C${w * 0.34} ${-h * 0.24} ${w * 0.38} ${-h * 0.27} ${w * 0.44} ${-h * 0.27} H${w * 0.56} C${w * 0.62} ${-h * 0.27} ${w * 0.66} ${-h * 0.24} ${w * 0.66} ${-h * 0.14} V0 H${w * 0.6} V${-h * 0.13} C${w * 0.6} ${-h * 0.17} ${w * 0.58} ${-h * 0.18} ${w * 0.56} ${-h * 0.18} H${w * 0.44} C${w * 0.42} ${-h * 0.18} ${w * 0.4} ${-h * 0.17} ${w * 0.4} ${-h * 0.13} V0Z`}
        fill="#3a2414"
        stroke={INK}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <rect x="0" y="0" width={w} height={h} rx={r} fill={`url(#${u}${gold ? 'gc' : 'sc'})`} stroke={INK} strokeWidth="2.6" />
      <path d={`M${w * 0.05} ${h * 0.18} H${w * 0.95} M${w * 0.05} ${h * 0.84} H${w * 0.95}`} stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" />
      {[
        [0, 0, 1, 1],
        [w, 0, -1, 1],
        [0, h, 1, -1],
        [w, h, -1, -1],
      ].map(([x, y, sx, sy], i) => (
        <path key={i} d={`M${x} ${y + sy * h * 0.2} V${y + sy * r} Q${x} ${y} ${x + sx * r} ${y} H${x + sx * w * 0.14}`} fill="none" stroke={gold ? '#7a4c08' : `url(#${u}gd)`} strokeWidth={w * 0.05} strokeLinecap="round" />
      ))}
      {[0.16, 0.72].map((x) => (
        <rect key={x} x={w * x} y={-h * 0.02} width={w * 0.12} height={h * 0.12} rx="1.5" fill={gold ? '#7a4c08' : `url(#${u}gd)`} stroke={INK} strokeWidth="1.4" />
      ))}
      <rect x={(w - plate.w) / 2} y={(h - plate.h) / 2} width={plate.w} height={plate.h} rx={plate.h * 0.22} fill={gold ? '#24160a' : `url(#${u}gd)`} stroke={INK} strokeWidth="1.8" />
      <rect x={(w - plate.w) / 2 + 3} y={(h - plate.h) / 2 + 3} width={plate.w - 6} height={plate.h - 6} rx={plate.h * 0.16} fill={gold ? '#100902' : '#fffaf0'} />
      <text x={w / 2} y={h / 2 + 1} textAnchor="middle" dominantBaseline="central" fontSize={plate.h * 0.72} fontWeight="900" fill={gold ? '#ffd45c' : '#16202c'} fontFamily={FONT}>
        {n}
      </text>
      <path d={`M${w * 0.06} ${h * 0.1} L${w * 0.3} ${h * 0.1} L${w * 0.14} ${h * 0.9} L${w * 0.06} ${h * 0.9}Z`} fill="#fff" opacity=".18" />
    </g>
  )
}

export function DealCover() {
  const u = useUid() + 'dl'
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".3" y2="1">
          <stop offset="0" stopColor="#4b2fb0" />
          <stop offset=".5" stopColor="#24146a" />
          <stop offset="1" stopColor="#0c0726" />
        </linearGradient>
        <linearGradient id={`${u}beam`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".38" />
          <stop offset="1" stopColor="#fff6c8" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}gd`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f2c14e" />
          <stop offset="1" stopColor="#b07a10" />
        </linearGradient>
        <linearGradient id={`${u}gc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset=".35" stopColor="#f2c14e" />
          <stop offset=".72" stopColor="#c48a18" />
          <stop offset="1" stopColor="#e7b444" />
        </linearGradient>
        <linearGradient id={`${u}sc`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4f8fb" />
          <stop offset=".35" stopColor="#c6d0d9" />
          <stop offset=".72" stopColor="#8794a1" />
          <stop offset="1" stopColor="#b8c3cd" />
        </linearGradient>
        <radialGradient id={`${u}glass`} cx=".5" cy=".45" r=".7">
          <stop offset="0" stopColor="#ffe2a0" />
          <stop offset=".55" stopColor="#f0a040" />
          <stop offset="1" stopColor="#7a3a0c" />
        </radialGradient>
        <radialGradient id={`${u}floor`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#ffd45c" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffd45c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      {/* the LED wall and the spotlights */}
      <g opacity=".14">
        {Array.from({ length: 11 }, (_, i) => (
          <rect key={i} x={6 + i * 18} y="0" width="4" height="170" fill="#8fd0ff" />
        ))}
      </g>
      <path d="M-20 -10 L30 -10 L130 250 L40 250Z" fill={`url(#${u}beam)`} opacity=".7" />
      <path d="M220 -10 L170 -10 L70 250 L160 250Z" fill={`url(#${u}beam)`} opacity=".55" />
      {[
        [24, 92, 3],
        [178, 104, 2.6],
        [18, 150, 2],
        [184, 164, 2.4],
        [150, 18, 2],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y - r * 2}L${x + r * 0.5} ${y - r * 0.5}L${x + r * 2} ${y}L${x + r * 0.5} ${y + r * 0.5}L${x} ${y + r * 2}L${x - r * 0.5} ${y + r * 0.5}L${x - r * 2} ${y}L${x - r * 0.5} ${y - r * 0.5}Z`} fill="#fff6c8" />
      ))}
      {/* the Banker's booth */}
      <g transform="translate(58 14)">
        <rect x="0" y="0" width="84" height="56" rx="10" fill="#3b2416" stroke={INK} strokeWidth="2.6" />
        <rect x="6" y="6" width="72" height="38" rx="6" fill={`url(#${u}glass)`} stroke={INK} strokeWidth="2" />
        <g fill="#140a05">
          <path d="M22 44 C23 36 30 33 36.5 32 L39 30 H45 L47.5 32 C54 33 61 36 62 44Z" />
          <ellipse cx="42" cy="23" rx="7" ry="8" />
        </g>
        <path d="M10 9 L26 9 L16 41 L10 41Z" fill="#fff" opacity=".14" />
        <rect x="4" y="42" width="76" height="9" rx="2.5" fill="#24130a" stroke={INK} strokeWidth="1.6" />
        <path d="M60 42 L62 36 H72 L74 42Z" fill="#111" stroke={INK} strokeWidth="1.2" />
        <path d="M59 35 C59 32.5 61 32 63 32.6 L64 34 H70 L71 32.6 C73 32 75 32.5 75 35 L73 36 C72 35 70.5 34.8 70 35.4 H64 C63.5 34.8 62 35 61 36Z" fill="#161616" stroke={INK} strokeWidth="1.1" transform="rotate(-12 67 34)" />
        <g stroke="#ffd45c" strokeWidth="2.2" fill="none" strokeLinecap="round">
          <path d="M84 24 C88 28 88 34 84 38" />
          <path d="M89 19 C95 26 95 36 89 43" />
          <path d="M0 24 C-4 28 -4 34 0 38" />
          <path d="M-5 19 C-11 26 -11 36 -5 43" />
        </g>
      </g>
      {/* the floor's glow and the podium */}
      <g opacity=".16">
        {Array.from({ length: 12 }, (_, i) => {
          const a = ((i * 30 - 6) * Math.PI) / 180
          const c = ((i * 30 + 6) * Math.PI) / 180
          return <path key={i} d={`M100 160L${(100 + 240 * Math.sin(a)).toFixed(1)} ${(160 - 240 * Math.cos(a)).toFixed(1)}L${(100 + 240 * Math.sin(c)).toFixed(1)} ${(160 - 240 * Math.cos(c)).toFixed(1)}Z`} fill="#fff4d6" />
        })}
      </g>
      <ellipse cx="100" cy="208" rx="96" ry="26" fill={`url(#${u}floor)`} />
      <path d="M48 200 V214 C48 222 72 227 100 227 C128 227 152 222 152 214 V200Z" fill="#5a4316" stroke={INK} strokeWidth="2.4" />
      <ellipse cx="100" cy="200" rx="52" ry="12" fill="#1d2040" stroke="#f2c14e" strokeWidth="2.2" />
      {/* two silver cases behind, the gold one in front */}
      <g transform="translate(2 116) rotate(-16)">
        <Case w={70} gold={false} n={3} u={u} />
      </g>
      <g transform="translate(134 98) rotate(15)">
        <Case w={70} gold={false} n={12} u={u} />
      </g>
      <g transform="translate(46 126)">
        <Case w={108} gold n={7} u={u} />
      </g>
      {/* the top prize's plaque */}
      <g transform="rotate(10 166 80)">
        <rect x="134" y="64" width="62" height="32" rx="10" fill={`url(#${u}gd)`} stroke={INK} strokeWidth="2.8" />
        <rect x="139" y="68" width="52" height="8" rx="4" fill="#fff" opacity=".35" />
        <text x="165" y="81" textAnchor="middle" dominantBaseline="central" fontSize="20" fontWeight="900" fontStyle="italic" fill="#3a2400" fontFamily={FONT}>
          ×250
        </text>
      </g>
      {/* DEAL / NO DEAL */}
      <g transform="rotate(-8 34 84)">
        <rect x="4" y="72" width="56" height="24" rx="8" fill="#ff4d61" stroke={INK} strokeWidth="2.6" />
        <rect x="8" y="75" width="48" height="6" rx="3" fill="#fff" opacity=".3" />
        <text x="32" y="85" textAnchor="middle" dominantBaseline="central" fontSize="11.5" fontWeight="900" fontStyle="italic" fill="#fff" fontFamily={FONT} letterSpacing=".3">
          NO DEAL
        </text>
      </g>
    </svg>
  )
}

export function DealIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <rect x="3" y="7.5" width="18" height="12.5" rx="2.5" />
      <path d="M9 7.5V5.8a1.3 1.3 0 0 1 1.3-1.3h3.4A1.3 1.3 0 0 1 15 5.8v1.7" />
      <path d="M3 12.5h7M14 12.5h7" />
      <rect x="10" y="11" width="4" height="3.2" rx="1" />
    </svg>
  )
}
