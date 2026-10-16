import { useUid } from '../../art/ids'
import { CrateArt, ItemArt, twinkle } from '../cases/art'
import type { Mode } from './types'

/*
  Case Battles art, in the Cases style: flat shades lit from the top left, no SVG filters. The two sides of a 2v2 wear
  sky and coral, the battle's own accent is the lobby's ember orange, and crazy battles (lowest total wins) are marked
  with an upside-down crown.
*/

export const EMBER = '#ff7a3d'
export const CRAZY = '#ff5fd2'
export const TEAM = ['#38bdf8', '#fb7185'] as const
export const GOLD = '#ffc23d'

/** The seat layout of a mode: dots for players, grouped by side, with a fine "vs" bar between sides. */
export function ModeGlyph({ mode, size = 14, color = 'currentColor' }: { mode: Mode; size?: number; color?: string }) {
  const groups = mode === '1v1' ? [1, 1] : mode === '1v1v1' ? [1, 1, 1] : mode === '1v1v1v1' ? [1, 1, 1, 1] : [2, 2]
  const r = 2.6
  const dot = 7.2
  const bar = 5
  let x = 0
  const parts: { x: number; kind: 'dot' | 'bar' }[] = []
  groups.forEach((n, g) => {
    if (g) {
      parts.push({ x: x + bar / 2 - 0.6, kind: 'bar' })
      x += bar
    }
    for (let i = 0; i < n; i++) {
      parts.push({ x: x + dot / 2, kind: 'dot' })
      x += dot
    }
  })
  const h = 10
  return (
    <svg width={(size * x) / h} height={size} viewBox={`0 0 ${x} ${h}`} aria-hidden>
      {parts.map((p, i) =>
        p.kind === 'dot' ? (
          <g key={i} fill={color}>
            <circle cx={p.x} cy={3.3} r={r * 0.82} />
            <path d={`M${p.x - 3} 9.6a3 3 0 0 1 6 0Z`} />
          </g>
        ) : (
          <rect key={i} x={p.x} y={1.5} width={1.2} height={7.5} rx={0.6} fill={color} opacity={0.45} />
        ),
      )}
    </svg>
  )
}

/** A gold crown for the winners. */
export function Crown({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={(size * 26) / 32} viewBox="0 0 32 26" className={className} aria-hidden>
      <path d="M3 21 1.5 6.5 9.5 13 16 2l6.5 11 8-6.5L29 21Z" fill="#f4b72f" stroke="#8a5705" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M16 2l6.5 11 8-6.5L29 21H16Z" fill="#c98b12" opacity=".55" />
      <path d="M9 15.5 15 5.5" stroke="#fff6cf" strokeWidth="1.4" strokeLinecap="round" opacity=".85" />
      <rect x="2.6" y="19.6" width="26.8" height="5" rx="1.6" fill="#c98b12" stroke="#8a5705" strokeWidth="1.2" />
      <rect x="3.4" y="19.8" width="25.2" height="1.6" rx=".8" fill="#ffdc6e" />
      {[
        [1.5, 6.5],
        [16, 2],
        [30.5, 6.5],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="1.9" fill="#fff6cf" stroke="#8a5705" strokeWidth=".9" />
      ))}
      <path d="M16 20.4 18 22.2 16 24 14 22.2Z" fill="#ff4d61" />
    </svg>
  )
}

/** Crazy mode's mark: the crown turned upside down (the lowest total takes it). */
export function CrazyMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      <g transform="rotate(180 8 8)">
        <path d="M2.5 12.5 1.6 4.6 5.6 8 8 3l2.4 5 4-3.4-.9 7.9Z" fill="currentColor" />
        <rect x="2.4" y="12" width="11.2" height="2.6" rx=".9" fill="currentColor" />
      </g>
    </svg>
  )
}

/** Two blades crossed, for the vs badges between seats. */
export function Swords({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
      <path d="m13 19 6-6M16 16l4 4M19 21l2-2" />
      <path d="M9.5 6.5 13 3h3v3l-3.5 3.5" opacity=".9" />
      <path d="m5 14 4 4M7 17l-3 3M3 19l2 2" />
    </svg>
  )
}

/** The round badge between two seats: crossed blades on a dark coin. */
export function VsBadge({ size = 34, color = EMBER }: { size?: number; color?: string }) {
  return (
    <div
      className="flex items-center justify-center rounded-full"
      style={{ width: size, height: size, background: 'radial-gradient(circle at 35% 30%, #22384b, #0b1621 72%)', boxShadow: `0 0 0 2px #0a1620, 0 0 0 3.5px ${color}55, 0 8px 18px -6px rgba(0,0,0,.8)` }}
    >
      <Swords size={Math.round(size * 0.52)} color={color} />
    </div>
  )
}

/** The lobby banner's picture: two crates squaring up across a crackle of light, loot flying off them. */
export function BattleBannerArt({ className }: { className?: string }) {
  const u = useUid()
  return (
    <svg className={className} viewBox="0 0 400 230" preserveAspectRatio="xMaxYMid meet" aria-hidden>
      <defs>
        <radialGradient id={`${u}g`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff1d6" stopOpacity=".95" />
          <stop offset=".35" stopColor={EMBER} stopOpacity=".55" />
          <stop offset="1" stopColor={EMBER} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={TEAM[0]} stopOpacity="0" />
          <stop offset=".5" stopColor={TEAM[0]} stopOpacity=".35" />
          <stop offset="1" stopColor={TEAM[0]} stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={TEAM[1]} stopOpacity="0" />
          <stop offset=".5" stopColor={TEAM[1]} stopOpacity=".35" />
          <stop offset="1" stopColor={TEAM[1]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <ellipse cx="236" cy="128" rx="150" ry="70" fill={`url(#${u}b)`} transform="rotate(-8 236 128)" opacity=".7" />
      <ellipse cx="300" cy="120" rx="130" ry="64" fill={`url(#${u}r)`} transform="rotate(10 300 120)" opacity=".6" />
      <circle cx="268" cy="118" r="78" fill={`url(#${u}g)`} />
      {/* the spark between them */}
      <path d="M262 62 252 108h16l-12 54 30-66h-17l11-34Z" fill="#fff6dd" />
      <path d="M262 62 252 108h16l-12 54 30-66h-17l11-34Z" fill="none" stroke={EMBER} strokeWidth="2.5" strokeLinejoin="round" />
      {/* left crate: steel, lid up */}
      <g transform="rotate(-8 176 150)">
        <CrateArt tier="medium" part="body" size={132} x={110} y={88} />
        <g transform="translate(-6 -18) rotate(-14 176 120)">
          <CrateArt tier="medium" part="lid" size={132} x={110} y={88} />
        </g>
      </g>
      {/* right crate: obsidian, lid up */}
      <g transform="rotate(9 356 150)">
        <CrateArt tier="extreme" part="body" size={132} x={292} y={86} />
        <g transform="translate(8 -20) rotate(15 356 120)">
          <CrateArt tier="extreme" part="lid" size={132} x={292} y={86} />
        </g>
      </g>
      <g transform="rotate(-18 150 50)">
        <ItemArt kind="ring" size={42} x={128} y={26} />
      </g>
      <g transform="rotate(14 214 40)">
        <ItemArt kind="bar" size={40} x={194} y={16} />
      </g>
      <g transform="rotate(16 352 46)">
        <ItemArt kind="diamond" size={52} x={326} y={14} />
      </g>
      <g transform="rotate(-10 306 30)">
        <ItemArt kind="crown" size={36} x={290} y={8} />
      </g>
      <path d={twinkle(236, 34, 6)} fill="#fff" />
      <path d={twinkle(388, 104, 4.5)} fill="#fff" />
      <path d={twinkle(112, 98, 4)} fill="#fff" opacity=".85" />
    </svg>
  )
}
