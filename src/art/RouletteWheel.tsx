import { useUid } from './ids'
import { POCKET_COLORS, WHEEL_ORDER, colorOf } from '../games/roulette/rules'

/* A European roulette wheel seen from above. Pocket 0 sits at the top when the wheel is not rotated. */

const SEG = 360 / 37
const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, a: number) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))] as const

function wedge(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = pt(r1, a0)
  const [x1, y1] = pt(r1, a1)
  const [x2, y2] = pt(r0, a1)
  const [x3, y3] = pt(r0, a0)
  return `M${x0} ${y0}A${r1} ${r1} 0 0 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 0 0 ${x3} ${y3}Z`
}

/** Angle (degrees, 0 = right, clockwise) of a pocket's centre on an unrotated wheel. */
export const pocketAngle = (n: number) => -90 + WHEEL_ORDER.indexOf(n) * SEG

export function RouletteWheel({ size = 300, x, y, numbers = true }: { size?: number; x?: number; y?: number; numbers?: boolean }) {
  const u = useUid()
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="-100 -100 200 200" aria-hidden>
      <defs>
        <radialGradient id={`${u}w`}>
          <stop offset=".82" stopColor="#6a3b22" />
          <stop offset=".92" stopColor="#4a2614" />
          <stop offset="1" stopColor="#2b150a" />
        </radialGradient>
        <radialGradient id={`${u}c`} cx=".45" cy=".4">
          <stop offset="0" stopColor="#8a5a34" />
          <stop offset=".7" stopColor="#4d2c17" />
          <stop offset="1" stopColor="#2e1a0d" />
        </radialGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe9a8" />
          <stop offset=".5" stopColor="#e3b04b" />
          <stop offset="1" stopColor="#9c6b16" />
        </linearGradient>
      </defs>
      <circle r="99" fill={`url(#${u}w)`} />
      <circle r="99" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1" />
      <circle r="86.5" fill="none" stroke={`url(#${u}g)`} strokeWidth="2.5" />
      {WHEEL_ORDER.map((n, i) => {
        const a = -90 + i * SEG
        const col = POCKET_COLORS[colorOf(n)]
        return (
          <g key={n}>
            <path d={wedge(60, 85, a - SEG / 2, a + SEG / 2)} fill={col} />
            <path d={wedge(60, 70, a - SEG / 2, a + SEG / 2)} fill="rgba(0,0,0,.28)" />
            {numbers && (
              <text
                transform={`rotate(${a + 90}) translate(0 -77.5)`}
                textAnchor="middle"
                dy=".35em"
                fontSize="7.2"
                fontWeight="800"
                fill="#fff"
                fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif"
              >
                {n}
              </text>
            )}
          </g>
        )
      })}
      {WHEEL_ORDER.map((_, i) => {
        const a = -90 + (i + 0.5) * SEG
        const [x0, y0] = pt(60, a)
        const [x1, y1] = pt(85, a)
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={`url(#${u}g)`} strokeWidth=".9" />
      })}
      <circle r="60" fill={`url(#${u}c)`} stroke={`url(#${u}g)`} strokeWidth="1.5" />
      {Array.from({ length: 8 }, (_, i) => (
        <path key={i} d="M0 -50 L3 -44 L0 -38 L-3 -44Z" fill={`url(#${u}g)`} transform={`rotate(${i * 45 + 22.5})`} />
      ))}
      <circle r="24" fill="#3a2212" stroke="rgba(0,0,0,.4)" strokeWidth="1" />
      {[0, 90, 180, 270].map((r) => (
        <g key={r} transform={`rotate(${r})`}>
          <rect x="-2.2" y="-30" width="4.4" height="24" rx="2" fill={`url(#${u}g)`} />
          <circle cy="-31" r="4" fill={`url(#${u}g)`} />
        </g>
      ))}
      <circle r="9" fill={`url(#${u}g)`} />
      <circle r="4" fill="#fff4d0" opacity=".7" />
    </svg>
  )
}

/** The ivory ball. */
export function Ball({ r = 5 }: { r?: number }) {
  const u = useUid()
  return (
    <svg width={r * 2} height={r * 2} viewBox="-10 -10 20 20" overflow="visible" aria-hidden>
      <defs>
        <radialGradient id={`${u}b`} cx=".35" cy=".3">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".6" stopColor="#e9edf2" />
          <stop offset="1" stopColor="#9aa6b5" />
        </radialGradient>
      </defs>
      <circle r="10" cy="2" fill="rgba(0,0,0,.35)" />
      <circle r="10" fill={`url(#${u}b)`} />
    </svg>
  )
}
