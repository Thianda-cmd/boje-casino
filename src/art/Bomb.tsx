import { useUid } from './ids'

/* A round bomb with a lit fuse. `lit` animates the spark. */
export function Bomb({ size = 48, lit = true, className, x, y }: { size?: number; lit?: boolean; className?: string; x?: number; y?: number }) {
  const u = useUid()
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 64 64" className={className} overflow="visible" aria-hidden>
      <defs>
        <radialGradient id={`${u}b`} cx="0.36" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#6b7a90" />
          <stop offset=".35" stopColor="#323d4f" />
          <stop offset="1" stopColor="#0c1119" />
        </radialGradient>
        <radialGradient id={`${u}s`}>
          <stop offset="0" stopColor="#fffbe0" />
          <stop offset=".45" stopColor="#ffd34d" />
          <stop offset="1" stopColor="#ff6a2b" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="29" cy="58.5" rx="17" ry="3" fill="rgba(0,0,0,.35)" />
      <circle cx="29" cy="37" r="20" fill={`url(#${u}b)`} />
      <rect x="35.5" y="12.5" width="12" height="10" rx="2.5" fill="#596579" transform="rotate(42 41.5 17.5)" />
      <rect x="35.5" y="12.5" width="12" height="3.2" rx="1.6" fill="#8995a8" transform="rotate(42 41.5 17.5)" />
      <path d="M45.5 13.5c1.5-4 4.5-6 8-5.5" fill="none" stroke="#caa06a" strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="21" cy="28" rx="6.5" ry="4.5" fill="#fff" opacity=".22" transform="rotate(-35 21 28)" />
      <circle cx="17.5" cy="31" r="1.8" fill="#fff" opacity=".35" />
      {lit && (
        <g>
          <circle cx="54.5" cy="8" r="7" fill={`url(#${u}s)`} />
          <path className="spark" d="M54.5 2.5l1.3 4.2 4.2 1.3-4.2 1.3-1.3 4.2-1.3-4.2-4.2-1.3 4.2-1.3Z" fill="#fff6c2" />
        </g>
      )}
    </svg>
  )
}
