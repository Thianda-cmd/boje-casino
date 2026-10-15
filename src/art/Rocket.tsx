import { useUid } from './ids'

/* A sleek rocket pointing right (0°). The flame sits behind the tail and flickers while `thrust` is on. */
export function Rocket({ width = 96, thrust = true, className, x, y }: { width?: number; thrust?: boolean; className?: string; x?: number; y?: number }) {
  const u = useUid()
  return (
    <svg x={x} y={y} width={width} height={(width * 48) / 120} viewBox="0 0 120 48" className={className} overflow="visible" aria-hidden>
      <defs>
        <linearGradient id={`${u}b`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".55" stopColor="#dfe6f0" />
          <stop offset="1" stopColor="#9aa8bd" />
        </linearGradient>
        <linearGradient id={`${u}n`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff7b8c" />
          <stop offset="1" stopColor="#c81f3d" />
        </linearGradient>
        <linearGradient id={`${u}f`} x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stopColor="#fffbe6" />
          <stop offset=".3" stopColor="#ffd84d" />
          <stop offset=".7" stopColor="#ff7a2b" />
          <stop offset="1" stopColor="#ff3d3d" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}w`} cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#bfe6ff" />
          <stop offset="1" stopColor="#2b7fd0" />
        </radialGradient>
      </defs>
      {thrust && (
        <g transform="translate(34 24)">
          <g className="flame-h">
            <path d="M0 -8.5C-12 -7 -26 -3 -34 0C-26 3 -12 7 0 8.5Z" fill={`url(#${u}f)`} transform="translate(0 0)" />
            <path d="M0 -4.5C-6 -4 -13 -1.5 -17 0C-13 1.5 -6 4 0 4.5Z" fill="#fffbe6" opacity=".9" />
          </g>
        </g>
      )}
      {/* fins */}
      <path d="M44 15 36 3h11l12 12Z" fill={`url(#${u}n)`} />
      <path d="M44 33 36 45h11l12-12Z" fill={`url(#${u}n)`} />
      {/* body */}
      <path d="M38 13h48c13 0 24 5 31 11-7 6-18 11-31 11H38c-3 0-4-3-4-11s1-11 4-11Z" fill={`url(#${u}b)`} />
      <path d="M95 13.6c9 1.4 16.5 5.2 22 10.4-5.5 5.2-13 9-22 10.4 2.4-3 3.6-6.6 3.6-10.4S97.4 16.6 95 13.6Z" fill={`url(#${u}n)`} />
      <rect x="34" y="17" width="5" height="14" rx="1.5" fill="#5a6577" />
      <path d="M50 35h30" stroke="#8b98ad" strokeWidth="1.2" strokeOpacity=".7" />
      <circle cx="74" cy="24" r="6.5" fill="#1d3448" />
      <circle cx="74" cy="24" r="5" fill={`url(#${u}w)`} />
      <circle cx="72.3" cy="22.2" r="1.5" fill="#fff" opacity=".8" />
      <path d="M58 24h-8" stroke="#c81f3d" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
