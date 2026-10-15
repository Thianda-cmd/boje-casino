import { useUid } from './ids'
import { segmentColor } from '../games/wheel/rules'

/* The Wheel game's wheel: a ring of coloured segments around a dark disc. Segment 0 is centred at the top. */

const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, a: number) => [r * Math.cos(rad(a)), r * Math.sin(rad(a))] as const

function wedge(r0: number, r1: number, a0: number, a1: number) {
  const [x0, y0] = pt(r1, a0)
  const [x1, y1] = pt(r1, a1)
  const [x2, y2] = pt(r0, a1)
  const [x3, y3] = pt(r0, a0)
  const large = a1 - a0 > 180 ? 1 : 0
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`
}

export function PrizeWheel({ segments, size = 300, x, y, lit }: { segments: number[]; size?: number; x?: number; y?: number; lit?: number | null }) {
  const u = useUid()
  const n = segments.length
  const seg = 360 / n
  const gap = Math.min(0.9, seg * 0.08)
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="-100 -100 200 200" aria-hidden>
      <defs>
        <radialGradient id={`${u}d`} cx=".5" cy=".42">
          <stop offset="0" stopColor="#1d3d55" />
          <stop offset="1" stopColor="#0b1a26" />
        </radialGradient>
        <radialGradient id={`${u}h`} cx=".4" cy=".35">
          <stop offset="0" stopColor="#4a6a85" />
          <stop offset="1" stopColor="#1a3042" />
        </radialGradient>
      </defs>
      <circle r="99" fill="#0f2231" stroke="#2b475c" strokeWidth="2" />
      {segments.map((m, i) => {
        const a = -90 + i * seg
        return (
          <path
            key={i}
            d={wedge(72, 95, a - seg / 2 + gap / 2, a + seg / 2 - gap / 2)}
            fill={segmentColor(m)}
            opacity={lit == null || lit === i ? 1 : 0.4}
            style={{ transition: 'opacity .3s' }}
          />
        )
      })}
      <circle r="72" fill={`url(#${u}d)`} />
      <circle r="66" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="6" />
      <circle r="18" fill={`url(#${u}h)`} stroke="rgba(255,255,255,.12)" strokeWidth="1.5" />
      <circle r="6" fill="#0b1a26" />
    </svg>
  )
}
