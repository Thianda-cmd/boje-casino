import type { CSSProperties } from 'react'
import { BOJE_HEX, bojeFacets } from '../../art/brand'
import { colorOf, type Color } from './rules'

/* Double's tiles: glossy red and slate-black tiles carrying their number, and the green zero, which carries the Boje
   gem. Plain styled divs, so a strip of a hundred and fifty of them stays one cheap layer while it spins. */

export const TONE: Record<Color, { bg: string; shadow: string; ink: string; ring: string; glow: string; solid: string; soft: string }> = {
  red: {
    bg: 'linear-gradient(155deg,#ff7083 0%,#f2384f 44%,#c2173a 100%)',
    shadow: 'inset 0 1.5px 0 rgba(255,255,255,.4), inset 0 -4px 0 rgba(90,0,20,.28)',
    ink: '#ffffff',
    ring: 'rgba(255,255,255,.24)',
    glow: '#ff4d61',
    solid: '#f2384f',
    soft: 'rgba(242,56,79,.16)',
  },
  black: {
    bg: 'linear-gradient(155deg,#435066 0%,#2a3445 48%,#171e2a 100%)',
    shadow: 'inset 0 1.5px 0 rgba(255,255,255,.14), inset 0 -4px 0 rgba(0,0,0,.32)',
    ink: '#dde6f0',
    ring: 'rgba(255,255,255,.11)',
    glow: '#8ea7c6',
    solid: '#323d50',
    soft: 'rgba(150,170,195,.12)',
  },
  green: {
    bg: 'linear-gradient(155deg,#6dfbb0 0%,#22d36f 44%,#0b944a 100%)',
    shadow: 'inset 0 1.5px 0 rgba(255,255,255,.45), inset 0 -4px 0 rgba(0,60,25,.3)',
    ink: '#ffffff',
    ring: 'rgba(255,255,255,.3)',
    glow: '#22d36f',
    solid: '#22d36f',
    soft: 'rgba(34,211,111,.16)',
  },
}

const FACETS = bojeFacets(0.09)
const FACET_SHADE = [0.98, 0.86, 0.7, 0.62, 0.76, 0.92]

/** The Boje gem in white, its six facets lit from the top right. */
export function GemMark({ size, className = '' }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden style={{ filter: 'drop-shadow(0 1.5px 1.5px rgba(0,50,20,.35))' }}>
      <path d={BOJE_HEX} fill="#0a7a3c" opacity=".35" transform="translate(0 1)" />
      {FACETS.map((d, i) => (
        <path key={i} d={d} fill="#ffffff" opacity={FACET_SHADE[i]} />
      ))}
    </svg>
  )
}

/** One tile of the wheel. */
export function Tile({ roll, size, className = '', style }: { roll: number; size: number; className?: string; style?: CSSProperties }) {
  const c = colorOf(roll)
  const t = TONE[c]
  const r = Math.round(size * 0.2)
  const inset = Math.max(3, Math.round(size * 0.1))
  return (
    <div
      className={`relative flex shrink-0 select-none items-center justify-center ${className}`}
      style={{ width: size, height: size, borderRadius: r, background: t.bg, boxShadow: t.shadow, ...style }}
    >
      {size >= 30 && <div className="pointer-events-none absolute" style={{ inset, borderRadius: Math.max(2, r - inset * 0.6), border: `${size >= 60 ? 1.5 : 1}px solid ${t.ring}` }} />}
      {c === 'green' ? (
        <GemMark size={Math.round(size * (size >= 30 ? 0.5 : 0.62))} />
      ) : (
        <span className="tnum relative font-black leading-none" style={{ fontSize: Math.round(size * (size >= 30 ? 0.32 : 0.44)), color: t.ink, textShadow: '0 1px 2px rgba(0,0,0,.28)' }}>
          {roll}
        </span>
      )}
    </div>
  )
}

/** A colour's swatch for labels and buttons: a small tile without a number. */
export function Swatch({ color, size = 14, className = '' }: { color: Color; size?: number; className?: string }) {
  const t = TONE[color]
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), background: t.bg, boxShadow: t.shadow }}
      aria-hidden
    >
      {color === 'green' && size >= 16 && <GemMark size={Math.round(size * 0.62)} />}
    </span>
  )
}
