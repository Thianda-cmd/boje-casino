import type { BonusSpot, Spot } from './rules'
import { LOOK } from './words'

/* Showtime's little pictures: a glyph for each bonus round (drawn inside any svg), and a spot's badge for HTML. */

/** a bonus round's glyph, centred on (x, y), about size across */
export function BonusGlyph({ spot, x, y, size }: { spot: BonusSpot; x: number; y: number; size: number }) {
  const k = size / 40
  const t = `translate(${x - 20 * k} ${y - 20 * k}) scale(${k})`
  if (spot === 'coin')
    return (
      <g transform={t}>
        <circle cx="20" cy="22" r="17" fill="#8a4a12" />
        <circle cx="20" cy="20" r="17" fill="#ffd25e" stroke="#b9741a" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="11.5" fill="none" stroke="#b9741a" strokeWidth="2" strokeDasharray="2.5 2" />
        <text x="20" y="21" textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="900" fill="#8a4a12" fontFamily="Manrope, system-ui, sans-serif">
          ×
        </text>
      </g>
    )
  if (spot === 'peg')
    return (
      <g transform={t}>
        {[
          [20, 6],
          [13, 15],
          [27, 15],
          [6, 24],
          [20, 24],
          [34, 24],
        ].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3.6" fill="#eafff2" stroke="#0b5a30" strokeWidth="1.5" />
        ))}
        <circle cx="16" cy="33" r="5.5" fill="#ff4d61" stroke="#7a1020" strokeWidth="1.5" />
      </g>
    )
  if (spot === 'wall')
    return (
      <g transform={t}>
        <circle cx="20" cy="20" r="17" fill="#fff" stroke="#0a5560" strokeWidth="2.5" />
        <circle cx="20" cy="20" r="11.5" fill="#ff4d61" />
        <circle cx="20" cy="20" r="6.5" fill="#fff" />
        <circle cx="20" cy="20" r="2.8" fill="#ff4d61" />
      </g>
    )
  return (
    <g transform={t}>
      <path d="M20 2.5l5.1 11.2 12.2 1.3-9.1 8.2 2.6 12-10.8-6.2-10.8 6.2 2.6-12-9.1-8.2 12.2-1.3z" fill="#fff6c9" stroke="#b9741a" strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M20 10l2.6 5.8 6.3.7-4.7 4.2 1.4 6.2L20 23.7l-5.6 3.2 1.4-6.2-4.7-4.2 6.3-.7z" fill="#ffb02e" />
    </g>
  )
}

/** a spot as a round badge: a number in its colour, or a bonus round's glyph */
export function SpotBadge({ spot, size = 28, className = '' }: { spot: Spot; size?: number; className?: string }) {
  const L = LOOK[spot]
  const bonus = spot === 'coin' || spot === 'peg' || spot === 'wall' || spot === 'mega'
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="19" fill={spot === 'mega' ? '#ff4d61' : L.face} stroke={L.deep} strokeWidth="2" />
      {bonus ? (
        <BonusGlyph spot={spot} x={20} y={20} size={26} />
      ) : (
        <text x="20" y="21" textAnchor="middle" dominantBaseline="central" fontSize={spot === '10' ? 17 : 21} fontWeight="900" fill={L.ink} fontFamily="Manrope, system-ui, sans-serif">
          {spot}
        </text>
      )}
    </svg>
  )
}
