import { useUid } from '../../art/ids'
import type { ItemKind } from './types'

/*
  Coin Cascade's things as small flat pictures for the page (the paytable, the field strip, the history, the banners
  and the celebration), drawn like the machine's models and the lobby cover: the silver coin with its star, the gold
  coin with its B, the pink cut gem, the stamped gold bar, the Golden Idol and the Crown, each with an ink outline.
*/

const INK = '#0b1033'

/** the Idol's sunburst headdress: seven rays fanning up behind its head */
const ray = (r: number, t: number) => `${(20 + Math.sin(t) * r).toFixed(2)} ${(15.6 - Math.cos(t) * r).toFixed(2)}`
const RAYS = Array.from({ length: 7 }, (_, k) => {
  const a = (k - 3) * 0.36
  const r1 = k === 3 ? 15.2 : 14
  return `M${ray(6.6, a - 0.21)}L${ray(r1, a - 0.075)}L${ray(r1, a + 0.075)}L${ray(6.6, a + 0.21)}Z`
})
/** the disc the rays stand on */
const HALO = `M${ray(8, -1.4)}A8 8 0 0 1 ${ray(8, 1.4)}Z`

/** a Coin Shower (coins raining) or a Quake (a jolt), in the current colour, for the history pills */
export function FeatureMark({ kind, size = 12 }: { kind: 'shower' | 'quake'; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === 'shower' ? (
        <>
          <circle cx="3" cy="3" r="1.6" />
          <circle cx="8.5" cy="5" r="1.6" />
          <circle cx="4.5" cy="9" r="1.6" />
        </>
      ) : (
        <path d="M1 6.5L3.5 3.5L5.5 8.5L8 2.5L9.5 6.5H11" />
      )}
    </svg>
  )
}

export function ItemGlyph({ kind, size = 24, className = '' }: { kind: ItemKind; size?: number; className?: string }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${u}s`} cx="0.36" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor="#d6e0f2" />
          <stop offset="1" stopColor="#8a9dc0" />
        </radialGradient>
        <radialGradient id={`${u}g`} cx="0.36" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#fff6c4" />
          <stop offset="0.45" stopColor="#ffd24a" />
          <stop offset="1" stopColor="#d98a10" />
        </radialGradient>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset="0.5" stopColor="#ffd23a" />
          <stop offset="1" stopColor="#f19a1c" />
        </linearGradient>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffb3e2" />
          <stop offset="0.5" stopColor="#ff4fb8" />
          <stop offset="1" stopColor="#b8237e" />
        </linearGradient>
      </defs>
      {kind === 'silver' || kind === 'gold' ? (
        <g>
          <circle cx="20" cy="21.2" r="15" fill={kind === 'gold' ? '#b8700c' : '#526899'} stroke={INK} strokeWidth="2.2" />
          <circle cx="20" cy="19.5" r="15" fill={`url(#${u}${kind === 'gold' ? 'g' : 's'})`} stroke={INK} strokeWidth="2.2" />
          <circle cx="20" cy="19.5" r="11" fill="none" stroke={kind === 'gold' ? '#d48b12' : '#8fa2c2'} strokeWidth="1.8" />
          {kind === 'gold' ? (
            <text x="20" y="20.3" textAnchor="middle" dominantBaseline="central" fontSize="15" fontWeight="900" fill="#c47f0c" fontFamily="Manrope, system-ui, sans-serif">
              B
            </text>
          ) : (
            <path d="M20 12.6L22.1 17.4L27.2 17.8L23.3 21.1L24.5 26.2L20 23.4L15.5 26.2L16.7 21.1L12.8 17.8L17.9 17.4Z" fill="#9fb0cb" stroke="#7d90b3" strokeWidth="0.8" strokeLinejoin="round" />
          )}
          <path d="M10.5 14.5A11 11 0 0 1 16 9.6" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      ) : kind === 'gem' ? (
        <g strokeLinejoin="round">
          <path d="M6.5 15L13 7.5H27L33.5 15L20 34Z" fill={`url(#${u}p)`} stroke={INK} strokeWidth="2.2" />
          <path d="M13 7.5L16 15L20 7.5L24 15L27 7.5" fill="#ffc6ea" fillOpacity="0.55" stroke={INK} strokeWidth="1.3" />
          <path d="M6.5 15H33.5" stroke={INK} strokeWidth="1.3" />
          <path d="M16 15L20 34L24 15" fill="none" stroke={INK} strokeWidth="1.2" strokeOpacity="0.75" />
          <path d="M6.5 15L16 15L20 34Z" fill="#9a1d68" fillOpacity="0.35" />
          <path d="M14.5 9.5L16.2 13.2L18.6 9.5Z" fill="#fff" fillOpacity="0.85" />
        </g>
      ) : kind === 'bar' ? (
        <g strokeLinejoin="round">
          <path d="M5 29L7.5 20H32.5L35 29Z" fill="#e0901a" stroke={INK} strokeWidth="2.2" />
          <path d="M7.5 20L11.5 11H28.5L32.5 20Z" fill={`url(#${u}b)`} stroke={INK} strokeWidth="2.2" />
          <path d="M14.2 13.6H25.8L27.6 17.6H12.4Z" fill="none" stroke="#c97c0e" strokeWidth="1.4" />
          <path d="M10 26.5H30" stroke="#ffcf5a" strokeWidth="1.4" strokeLinecap="round" strokeOpacity="0.8" />
          <path d="M12.4 12.8L10.2 18" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.6" strokeLinecap="round" />
        </g>
      ) : kind === 'idol' ? (
        // a tiki statuette, as the machine has it: the sunburst headdress, the big square head with ruby eyes and a
        // jade brow gem, the round belly with folded arms, the stepped plinth
        <g strokeLinejoin="round">
          {RAYS.map((d, i) => (
            <path key={i} d={d} fill={i % 2 ? '#fff0b8' : '#ffc23a'} stroke={INK} strokeWidth="1.1" />
          ))}
          <path d={HALO} fill="#ffe08a" stroke={INK} strokeWidth="1.4" />
          <rect x="7.5" y="34" width="25" height="4.2" rx="1.2" fill="#d98a10" stroke={INK} strokeWidth="2" />
          <rect x="10" y="31" width="20" height="3.4" rx="1" fill="#ffe08a" stroke={INK} strokeWidth="1.8" />
          <ellipse cx="20" cy="26.4" rx="8.6" ry="6.2" fill={`url(#${u}g)`} stroke={INK} strokeWidth="2" />
          <rect x="11.6" y="28.6" width="16.8" height="3.6" rx="1.8" fill="#ffd24a" stroke={INK} strokeWidth="1.6" />
          <path d="M13.8 24.2Q20 28.6 26.2 24.2" fill="none" stroke={INK} strokeWidth="1.3" strokeLinecap="round" />
          <circle cx="12.4" cy="16.4" r="1.6" fill="#ffe9a8" stroke={INK} strokeWidth="1" />
          <circle cx="27.6" cy="16.4" r="1.6" fill="#ffe9a8" stroke={INK} strokeWidth="1" />
          <rect x="13" y="9.6" width="14" height="12.2" rx="3" fill={`url(#${u}g)`} stroke={INK} strokeWidth="2" />
          <rect x="13.6" y="11.6" width="12.8" height="2.4" fill="#ffe9a8" stroke={INK} strokeWidth="0.8" />
          <path d="M20 11.3L21.1 12.8L20 14.3L18.9 12.8Z" fill="#2bf0a0" stroke={INK} strokeWidth="0.6" />
          <ellipse cx="16.9" cy="16.3" rx="1.5" ry="1.15" fill="#ff2b4f" stroke={INK} strokeWidth="0.7" />
          <ellipse cx="23.1" cy="16.3" rx="1.5" ry="1.15" fill="#ff2b4f" stroke={INK} strokeWidth="0.7" />
          <rect x="19.2" y="15.6" width="1.6" height="2.8" rx="0.5" fill="#ffe9a8" stroke={INK} strokeWidth="0.6" />
          <rect x="16.4" y="19" width="7.2" height="1.7" rx="0.6" fill="#3a1606" />
          <path d="M14.6 13.6V19.6" stroke="#fff" strokeOpacity="0.8" strokeWidth="1.2" strokeLinecap="round" />
        </g>
      ) : (
        <g strokeLinejoin="round">
          <path d="M8 28L5.2 12.5L13.6 19L20 7.5L26.4 19L34.8 12.5L32 28Z" fill={`url(#${u}b)`} stroke={INK} strokeWidth="2.2" />
          <rect x="7.4" y="26.5" width="25.2" height="7" rx="1.8" fill="#e8a21c" stroke={INK} strokeWidth="2.2" />
          <circle cx="20" cy="30" r="2.3" fill="#ff4fb8" stroke={INK} strokeWidth="1" />
          <circle cx="13.2" cy="30" r="1.6" fill="#4cd6ff" stroke={INK} strokeWidth="0.9" />
          <circle cx="26.8" cy="30" r="1.6" fill="#4cd6ff" stroke={INK} strokeWidth="0.9" />
          <circle cx="5.2" cy="12.3" r="2.3" fill="#fff2b0" stroke={INK} strokeWidth="1.4" />
          <circle cx="20" cy="7" r="2.5" fill="#fff2b0" stroke={INK} strokeWidth="1.4" />
          <circle cx="34.8" cy="12.3" r="2.3" fill="#fff2b0" stroke={INK} strokeWidth="1.4" />
          <path d="M11 22.5L9.6 15.8" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.5" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}
