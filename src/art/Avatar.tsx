import type { ReactNode } from 'react'
import { useUid } from './ids'

/* Player avatars: a glossy gradient disc with a white emblem. Sixteen designs, picked by index. */

export const AVATAR_COUNT = 16

const COLORS: [string, string][] = [
  ['#ffd36e', '#ff8a3d'],
  ['#7b5cff', '#3fb8ff'],
  ['#34e08a', '#0f8f6a'],
  ['#ff6fa8', '#ff4d61'],
  ['#ffe066', '#f0a020'],
  ['#6f7dff', '#2a2f8f'],
  ['#3ee08f', '#16704a'],
  ['#a9b5d4', '#4b5675'],
  ['#ff7b9a', '#c2185b'],
  ['#6ee7ff', '#2f7bff'],
  ['#d3b8ff', '#7b5cff'],
  ['#ffab6b', '#e2523a'],
  ['#ffc2dc', '#ff6fa8'],
  ['#eef1fa', '#8a94b3'],
  ['#64f0c8', '#2a9df4'],
  ['#ff8a5c', '#ffcd4d'],
]

// each emblem is drawn in a 24x24 box; `d` is the dark detail colour
const EMBLEMS: ((d: string) => ReactNode)[] = [
  () => (
    <>
      <path d="M4 16.5h16l1.2-9-5.2 3.6L12 4.5 8 11.1 2.8 7.5z" />
      <rect x="4" y="18" width="16" height="2.4" rx="1" />
    </>
  ),
  () => <path d="M13.8 2 5 13.6h6.1L9.6 22 19 9.6h-6.3z" />,
  (d) => (
    <>
      <path d="M7 4h10l4 5-9 11.5L3 9z" />
      <path d="M3 9h18M9.5 4 8 9l4 11.5L16 9l-1.5-5" fill="none" stroke={d} strokeOpacity=".45" strokeWidth="1.1" strokeLinejoin="round" />
    </>
  ),
  (d) => (
    <>
      <path d="M12 2.2c.8 3.6 5.8 5.6 5.8 11a5.8 5.8 0 0 1-11.6 0c0-2.8 1.7-4.4 2.1-6.6 1.8 1.2 2.6 2.8 2.7 4.6 1.6-1.4 2-4.8 1-9z" />
      <path d="M12 21c-1.8 0-3-1.3-3-3 0-1.8 1.6-2.8 2.2-4.3 1.6 1.2 3.8 2.4 3.8 4.3 0 1.7-1.2 3-3 3z" fill={d} fillOpacity=".4" />
    </>
  ),
  () => <path d="M12 2.6l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.2 1.2-6.5-4.8-4.6 6.6-.9z" />,
  (d) => (
    <>
      <path d="M15.6 3A9 9 0 1 0 21 15.6 7.2 7.2 0 0 1 15.6 3z" />
      <circle cx="9" cy="14" r="1.3" fill={d} fillOpacity=".35" />
      <circle cx="12.5" cy="17.5" r=".9" fill={d} fillOpacity=".35" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="7.6" r="3.6" />
      <circle cx="7.6" cy="12" r="3.6" />
      <circle cx="16.4" cy="12" r="3.6" />
      <circle cx="12" cy="16.2" r="3.6" />
      <path d="M12 12c0 4 1 7 3 9.4" fill="none" stroke={d} strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
    </>
  ),
  () => <path d="M12 2C8.3 6.8 4 9.6 4 13.6A4 4 0 0 0 10.8 16.4L9.4 21.5h5.2l-1.4-5.1A4 4 0 0 0 20 13.6C20 9.6 15.7 6.8 12 2z" />,
  () => <path d="M12 21.2s-8.4-5.3-8.4-11.3a4.6 4.6 0 0 1 8.4-2.6 4.6 4.6 0 0 1 8.4 2.6c0 6-8.4 11.3-8.4 11.3z" />,
  (d) => (
    <>
      <path d="M12 2c3.2 2.2 5.2 6.2 5.2 10.4l-1.8 4.2H8.6l-1.8-4.2C6.8 8.2 8.8 4.2 12 2z" />
      <path d="M6.8 12.4 3.6 15.6l.4 3.2 3.6-2.2zM17.2 12.4l3.2 3.2-.4 3.2-3.6-2.2z" />
      <circle cx="12" cy="9.4" r="2.1" fill={d} fillOpacity=".55" />
      <path d="M10 17.8h4l-.8 3.6h-2.4z" fill={d} fillOpacity=".45" />
    </>
  ),
  (d) => (
    <>
      <path d="M5 21.4V11a7 7 0 0 1 14 0v10.4l-2.3-2-2.4 2-2.3-2-2.3 2-2.4-2z" />
      <ellipse cx="9.4" cy="11" rx="1.5" ry="2" fill={d} fillOpacity=".7" />
      <ellipse cx="14.6" cy="11" rx="1.5" ry="2" fill={d} fillOpacity=".7" />
    </>
  ),
  (d) => (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      {[
        [8, 8],
        [16, 8],
        [12, 12],
        [8, 16],
        [16, 16],
      ].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" fill={d} fillOpacity=".7" />
      ))}
    </>
  ),
  (d) => (
    <>
      <path d="M4.5 3.5 9 8h6l4.5-4.5V13a7.5 7.5 0 0 1-15 0z" />
      <ellipse cx="9" cy="12.6" rx="1.3" ry="1.8" fill={d} fillOpacity=".7" />
      <ellipse cx="15" cy="12.6" rx="1.3" ry="1.8" fill={d} fillOpacity=".7" />
      <path d="M11 16h2l-1 1.2z" fill={d} fillOpacity=".7" />
    </>
  ),
  (d) => (
    <>
      <path d="M12 2.6a8.2 8.2 0 0 0-8.2 8.2c0 3 1.4 4.6 3.2 5.7v3.9h10v-3.9c1.8-1.1 3.2-2.7 3.2-5.7A8.2 8.2 0 0 0 12 2.6z" />
      <circle cx="8.7" cy="11.4" r="2.2" fill={d} fillOpacity=".7" />
      <circle cx="15.3" cy="11.4" r="2.2" fill={d} fillOpacity=".7" />
      <path d="M10 20.4v-2.6M14 20.4v-2.6M12 20.4v-2.6" stroke={d} strokeOpacity=".5" strokeWidth="1" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="12" r="6.2" />
      <ellipse cx="12" cy="12" rx="10.6" ry="3.4" transform="rotate(-24 12 12)" fill="none" stroke="#fff" strokeWidth="1.8" />
      <path d="M8.2 9.6a4.6 4.6 0 0 1 4.8-2.8" fill="none" stroke={d} strokeOpacity=".35" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  (d) => (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="7" fill="none" stroke={d} strokeOpacity=".5" strokeWidth="2.6" strokeDasharray="3.66 3.66" />
      <circle cx="12" cy="12" r="4.2" fill={d} fillOpacity=".3" />
    </>
  ),
]

export function Avatar({ index, size = 40, className = '', ring }: { index: number; size?: number; className?: string; ring?: string }) {
  const id = useUid()
  const i = ((Math.round(index) % AVATAR_COUNT) + AVATAR_COUNT) % AVATAR_COUNT
  const [a, b] = COLORS[i]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".3" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      {ring && <circle cx="24" cy="24" r="23.5" fill={ring} />}
      <circle cx="24" cy="24" r={ring ? 21.5 : 24} fill={`url(#${id}b)`} />
      <circle cx="24" cy="24" r={ring ? 21.5 : 24} fill={`url(#${id}g)`} />
      <g transform="translate(11.5 11.5) scale(1.04)" fill="#fff" fillOpacity=".96" style={{ filter: 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,.25))' }}>
        {EMBLEMS[i](b)}
      </g>
    </svg>
  )
}
