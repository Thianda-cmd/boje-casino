import { useUid } from './ids'

/* Vault art shared by the lobby, Rewards and Vault Heist. */

export function Lockpick({ on, size = 30 }: { on: boolean; size?: number }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={on ? '#ffe08a' : '#3a4d5c'} />
          <stop offset="1" stopColor={on ? '#d9901f' : '#24333f'} />
        </linearGradient>
      </defs>
      <g transform="rotate(-45 16 16)">
        <rect x="1.5" y="12" width="11" height="8" rx="3" fill={`url(#${u}h)`} />
        <circle cx="5.5" cy="16" r="1.6" fill={on ? '#8a5a0c' : '#162029'} />
        <rect x="12" y="15" width="15" height="2.2" rx="1" fill={on ? '#e6edf5' : '#3a4d5c'} />
        <path d="M26 16.1h2.6l1.2-3.4h-1.6l-.8 1.6H26z" fill={on ? '#e6edf5' : '#3a4d5c'} />
      </g>
    </svg>
  )
}

/** A closed vault door, for promos. */
export function VaultDoor({ size = 220, className = '' }: { size?: number; className?: string }) {
  const u = useUid()
  const C = 100
  const p = (r: number, d: number) => [C + r * Math.sin((d * Math.PI) / 180), C - r * Math.cos((d * Math.PI) / 180)] as const
  const [a1x, a1y] = p(59, 52)
  const [a2x, a2y] = p(59, 70)
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#56687b" />
          <stop offset=".5" stopColor="#2a3644" />
          <stop offset="1" stopColor="#121a22" />
        </linearGradient>
        <radialGradient id={`${u}d`} cx=".36" cy=".28" r=".95">
          <stop offset="0" stopColor="#e1bd62" />
          <stop offset=".55" stopColor="#6b4f17" />
          <stop offset="1" stopColor="#140f05" />
        </radialGradient>
        <radialGradient id={`${u}h`} cx=".38" cy=".3" r=".9">
          <stop offset="0" stopColor="#5a6a7c" />
          <stop offset="1" stopColor="#0d141b" />
        </radialGradient>
        <filter id={`${u}g`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <circle cx={C} cy={C} r="99" fill={`url(#${u}f)`} />
      <circle cx={C} cy={C} r="98.5" fill="none" stroke="rgba(255,255,255,.15)" />
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = p(91, i * 22.5 + 11.25)
        return <circle key={i} cx={x} cy={y} r="2.2" fill="#8796a8" />
      })}
      <circle cx={C} cy={C} r="84" fill="#0a1016" />
      <circle cx={C} cy={C} r="82" fill={`url(#${u}d)`} />
      <circle cx={C} cy={C} r="75" fill="none" stroke="rgba(0,0,0,.35)" strokeWidth="3" />
      <circle cx={C} cy={C} r="58" fill="none" stroke="#071017" strokeWidth="20" />
      {Array.from({ length: 36 }, (_, i) => {
        const [x1, y1] = p(49, i * 10)
        const [x2, y2] = p(i % 3 ? 51 : 53, i * 10)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,.3)" strokeWidth={i % 3 ? 0.7 : 1.2} />
      })}
      <path d={`M${a1x} ${a1y}A59 59 0 0 1 ${a2x} ${a2y}`} stroke="#22d36f" strokeWidth="16" fill="none" filter={`url(#${u}g)`} opacity=".8" />
      <path d={`M${a1x} ${a1y}A59 59 0 0 1 ${a2x} ${a2y}`} stroke="#22d36f" strokeWidth="13" fill="none" />
      <g transform={`rotate(28 ${C} ${C})`}>
        <path d={`M${C - 2.5} ${C}L${C - 1} ${C - 68}h2L${C + 2.5} ${C}z`} fill="#fff" />
      </g>
      <circle cx={C} cy={C} r="26" fill={`url(#${u}h)`} stroke="rgba(255,255,255,.15)" />
      {Array.from({ length: 12 }, (_, i) => {
        const [x, y] = p(28, i * 30)
        return <circle key={i} cx={x} cy={y} r="2.4" fill="#1e2833" />
      })}
    </svg>
  )
}
