import type { RouteId } from './rules'
import { LOOK } from './words'

/*
  Summit's small pictures: each route's glyph for its card and the panel (the Trail a dotted path winding up a green
  hill to a flag, the Ridge a knife-edge crest with snow, the Cliff a rock face with handholds, the Sheer Wall a
  vertical slab with bolts and a rope), and the little summit flag the ladder and the history use. Plain SVG in the
  lobby's ink-outlined style.
*/

const INK = '#141a2b'

export function RouteGlyph({ id, size = 36 }: { id: RouteId; size?: number }) {
  const L = LOOK[id]
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden className="shrink-0">
      <rect x="1.5" y="1.5" width="37" height="37" rx="11" fill="#0d1726" stroke={INK} strokeWidth="2" />
      {id === 'trail' && (
        <>
          <path d="M3 33C10 22 17 19 25 20S36 14 38 9V37H3Z" fill="#3fbf6b" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M8 33C13 30 20 29 18 25S24 21 28 19" fill="none" stroke="#f3e2b8" strokeWidth="2.4" strokeDasharray="0.5 4" strokeLinecap="round" />
          <path d="M28.5 19V11" stroke={INK} strokeWidth="1.6" strokeLinecap="round" />
          <path d="M28.5 11L34 13L28.5 15Z" fill={L.a} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
        </>
      )}
      {id === 'ridge' && (
        <>
          <path d="M3 35L13 22L18 26L27 10L37 30V37H3Z" fill="#4c6a92" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M18 26L27 10L37 30L27 18Z" fill="#2f4870" />
          <path d="M23.5 16.5L27 10L30.5 17L27 15Z" fill="#f2f8ff" />
          <path d="M5 33L13 22L18 26L27 10" fill="none" stroke={L.a} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {id === 'cliff' && (
        <>
          <path d="M9 37V20L14 14L13 6H32V37Z" fill="#8a6a55" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M22 6V37" stroke="#6c5040" strokeWidth="1.4" />
          {[
            [17, 30],
            [25, 25],
            [18, 19],
            [26, 13],
          ].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="2.1" fill={L.a} stroke={INK} strokeWidth="1.1" />
          ))}
        </>
      )}
      {id === 'wall' && (
        <>
          <path d="M11 37V4H30V37Z" fill="#5d6378" stroke={INK} strokeWidth="1.6" />
          <path d="M11 4H15V37H11Z" fill="#474c5e" />
          <path d="M21 36C23 28 19 22 21 14S22 6 21 4" fill="none" stroke="#f3ecd9" strokeWidth="1.8" strokeLinecap="round" />
          {[30, 21, 12].map((y) => (
            <circle key={y} cx="21" cy={y} r="1.8" fill={L.a} stroke={INK} strokeWidth="1" />
          ))}
          <path d="M33 8L29 15H33L29 22" fill="none" stroke={L.a} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  )
}

export function FlagMark({ size = 14, color = '#f7c548' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path d="M3.5 15V1.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M4 2H13L11 5.5L13 9H4Z" fill={color} stroke={INK} strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}
