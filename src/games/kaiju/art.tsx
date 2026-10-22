import type { Method, Side } from './types'

/*
  Kaiju Clash's small page art: the corner colours (red for A, blue for B, as in a boxing ring), the method marks the
  history and the board use (a fist for a knockout, a wave for a Splash, a scorecard for the judges), a building glyph,
  and the Neon Bay backdrop that sits behind the 3D stage (it shows while the stage's own code loads). All plain SVG.
*/

/** the corners: A red on the left, B blue on the right */
export const CORNER: Record<Side, { name: string; color: string }> = {
  a: { name: 'Red corner', color: '#ff4d61' },
  b: { name: 'Blue corner', color: '#4cb4ff' },
}

/** the method's own colour, wherever it is marked */
export const METHOD_COLOR: Record<Method, string> = { ko: '#ff5d4d', splash: '#38c6ff', dec: '#f7c548' }

/** how a fight ended, as a small mark: a fist, a wave, a scorecard */
export function MethodMark({ method, size = 16, className = '' }: { method: Method; size?: number; className?: string }) {
  const c = METHOD_COLOR[method]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      {method === 'ko' && (
        <g fill={c} stroke="#140a10" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M6.5 9.2c0-1.4 1-2.4 2.3-2.4.5-1.2 1.5-1.9 2.7-1.9 1 0 1.9.5 2.4 1.3.4-.2.8-.3 1.3-.3 1.5 0 2.7 1.2 2.7 2.7v5.1c0 3.4-2.6 6.1-6 6.1h-.5c-2.8 0-4.9-2.3-4.9-5.1z" />
          <path d="M8.8 6.8v4M11.5 4.9v5.4M14.6 6.4v4.3" fill="none" strokeWidth="1.3" />
          <path d="M6.6 12.4c1.6-.4 3.4.2 4.2 1.6" fill="none" strokeWidth="1.3" />
        </g>
      )}
      {method === 'splash' && (
        <g stroke="#06121c" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <path d="M2.5 16.5c2 0 2.4-1.6 4.4-1.6s2.4 1.6 4.6 1.6 2.4-1.6 4.6-1.6 2.4 1.6 5.4 1.6v4.3h-19z" fill={c} />
          <path d="M12 3.2c2.4 3.3 3.6 5.6 3.6 7.2a3.6 3.6 0 0 1-7.2 0c0-1.6 1.2-3.9 3.6-7.2z" fill="#9fe7ff" />
          <path d="M5.2 8.6l1.4 2.4M18.8 8.6l-1.4 2.4" fill="none" stroke={c} strokeWidth="1.8" />
        </g>
      )}
      {method === 'dec' && (
        <g stroke="#1c1404" strokeWidth="1.5" strokeLinejoin="round">
          <rect x="4.5" y="3.2" width="15" height="17.6" rx="2.2" fill={c} />
          <path d="M8 8h8M8 11.6h8M8 15.2h4.6" fill="none" strokeLinecap="round" />
          <path d="M14.6 15.6l1.3 1.3 2.6-2.8" fill="none" stroke="#1c1404" strokeWidth="1.7" strokeLinecap="round" />
        </g>
      )}
    </svg>
  )
}

/** a city block with lit windows: the buildings counter */
export function BuildingMark({ size = 16, color = 'currentColor', className = '' }: { size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M3.5 21V9.5l5-2.5V21M8.5 21V4.2L16 2.8V21M16 21V8.5l4.5 1.6V21M2 21h20" stroke={color} strokeWidth="1.9" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M11 7h2.4M11 10.4h2.4M11 13.8h2.4M5.6 12.6h.9M5.6 15.8h.9M17.9 13h.9M17.9 16.2h.9" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

/*
  Neon Bay at night, flat: the sky going from deep navy to a magenta glow over the water, the moon, a skyline of dark
  towers with a few lit windows and neon roof signs in the site's colours, and the bay with the city's light on it.
  It stretches to any box (preserveAspectRatio none for the sky, the skyline pinned to the bottom).
*/
const TOWERS: [number, number, number, string][] = [
  [0, 64, 46, '#ffd36b'], [44, 40, 38, '#7fdcff'], [80, 78, 30, '#ffd36b'], [108, 30, 52, '#ff8ac8'], [158, 58, 40, '#7fdcff'],
  [196, 22, 34, '#ffd36b'], [228, 70, 50, '#9dffc4'], [276, 44, 36, '#ffd36b'], [310, 12, 44, '#7fdcff'], [352, 52, 40, '#ffd36b'],
  [390, 34, 30, '#ff8ac8'], [418, 66, 56, '#ffd36b'], [472, 26, 40, '#7fdcff'], [510, 56, 34, '#ffd36b'], [542, 40, 48, '#9dffc4'],
  [588, 70, 42, '#ffd36b'], [628, 30, 36, '#7fdcff'], [662, 60, 48, '#ffd36b'], [708, 20, 40, '#ff8ac8'], [746, 54, 54, '#ffd36b'],
]
const SIGNS: [number, number, string, string][] = [
  [118, 24, '#ff5fa2', 'HOTEL'], [318, 6, '#22d36f', 'BOJE'], [550, 34, '#f7c548', 'CASINO'], [716, 14, '#4cb4ff', 'BAY'],
]

export function BayBackdrop({ className = '', glow = '#8a2d8f' }: { className?: string; glow?: string }) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="absolute inset-0" style={{ background: `linear-gradient(180deg,#050a1c 0%,#0b1233 42%,${glow}55 74%,#1a0f2e 78%,#060a18 100%)` }} />
      <div className="absolute left-[72%] top-[10%] w-[6%] min-w-[34px] rounded-full bg-[#fff4d6] opacity-90 shadow-[0_0_60px_18px_rgba(255,236,190,.28)]" style={{ aspectRatio: '1 / 1' }} />
      <svg className="absolute inset-x-0 bottom-[22%] h-[30%] w-full" viewBox="0 0 800 110" preserveAspectRatio="xMidYMax slice">
        {TOWERS.map(([x, top, w, win], i) => (
          <g key={i}>
            <rect x={x} y={top} width={w - 3} height={110 - top} fill={i % 3 === 0 ? '#0c1330' : i % 3 === 1 ? '#0f1838' : '#0a1028'} />
            {Array.from({ length: Math.floor((110 - top - 8) / 9) }, (_, r) =>
              Array.from({ length: Math.max(1, Math.floor((w - 9) / 7)) }, (_, c) => ((r * 7 + c * 3 + i) % 5 < 2 ? <rect key={`${r}-${c}`} x={x + 4 + c * 7} y={top + 6 + r * 9} width="3" height="4" fill={win} opacity=".55" /> : null)),
            )}
          </g>
        ))}
        {SIGNS.map(([x, y, c, t]) => (
          <text key={t} x={x} y={y + 12} fill={c} fontSize="11" fontWeight="900" fontFamily="Manrope, system-ui, sans-serif" style={{ filter: `drop-shadow(0 0 4px ${c})` }}>
            {t}
          </text>
        ))}
      </svg>
      <div className="absolute inset-x-0 bottom-0 h-[22%] bg-[linear-gradient(180deg,#0a1435,#050916)]" />
      <div className="absolute inset-x-0 bottom-[14%] h-px bg-gradient-to-r from-transparent via-[#ff8ac8]/40 to-transparent" />
    </div>
  )
}
