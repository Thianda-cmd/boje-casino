import { memo } from 'react'
import { R_BULL, R_OUTER_BULL, type TargetId } from './rules'
import { EDGE, SEGMENTS, aimOf, regionPath, targetRegions } from './geom'

/*
  Bullseye's small pictures for the panel and the info sheet: a little board with a target's bed lit gold (the
  target picker), and a thrower's grouping (a dozen darts' holes round the aim, as wide as the thrower scatters).
*/

const SINGLE = ['#1d1c1f', '#ecdcb6']
const BED = ['#d3263a', '#11904f']

/** a small board with the target's bed lit, `size` px across */
export const MiniBoard = memo(function MiniBoard({ target, size, lit = true }: { target: TargetId; size: number; lit?: boolean }) {
  const aim = aimOf(target)
  return (
    <svg viewBox={`${-EDGE} ${-EDGE} ${2 * EDGE} ${2 * EDGE}`} width={size} height={size} aria-hidden>
      <circle r={EDGE} fill="#121214" />
      {SEGMENTS.map((s) => (
        <g key={s.n}>
          <path d={s.double} fill={BED[s.i % 2]} />
          <path d={s.outer} fill={SINGLE[s.i % 2]} />
          <path d={s.treble} fill={BED[s.i % 2]} />
          <path d={s.inner} fill={SINGLE[s.i % 2]} />
        </g>
      ))}
      <circle r={R_OUTER_BULL} fill={BED[1]} />
      <circle r={R_BULL} fill={BED[0]} />
      <circle r="178" fill="#000" opacity={lit ? 0.38 : 0.2} />
      {lit && (
        <>
          {targetRegions(target).map((r) => (
            <path key={r} d={regionPath(r)} fill="#ffd45c" stroke="#fff3c4" strokeWidth="5" strokeLinejoin="round" />
          ))}
          <circle cx={aim.x} cy={-aim.y} r={target === 'bull' ? 26 : 22} fill="none" stroke="#fff" strokeWidth="7" />
        </>
      )}
    </svg>
  )
})

/** fixed offsets (in spreads) for the grouping's holes: a dozen draws of a round Gaussian, worked out once */
const HOLES = (() => {
  let s = 0x5eed
  const r = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
  return Array.from({ length: 12 }, () => {
    const u = Math.sqrt(-2 * Math.log(1 - r() * 0.98))
    const v = 2 * Math.PI * r()
    return [u * Math.cos(v), u * Math.sin(v)] as const
  })
})()

/** a thrower's grouping on a little target: holes `sigma` mm apart from the aim, drawn on a 120 mm face */
export const Grouping = memo(function Grouping({ sigma, size, color }: { sigma: number; size: number; color: string }) {
  return (
    <svg viewBox="-60 -60 120 120" width={size} height={size} aria-hidden>
      <circle r="58" fill="#0d1820" stroke="#ffffff" strokeOpacity=".12" strokeWidth="2" />
      <circle r="38" fill="none" stroke="#ffffff" strokeOpacity=".1" strokeWidth="2" />
      <circle r="18" fill="none" stroke="#ffffff" strokeOpacity=".1" strokeWidth="2" />
      <circle r={Math.min(56, sigma * 2)} fill={color} fillOpacity=".14" stroke={color} strokeOpacity=".6" strokeWidth="2" strokeDasharray="5 4" />
      {HOLES.map(([x, y], i) => {
        const px = x * sigma * 0.75
        const py = y * sigma * 0.75
        if (Math.hypot(px, py) > 56) return null
        return <circle key={i} cx={px} cy={py} r="4.2" fill={color} stroke="#081016" strokeWidth="1.6" />
      })}
      <path d="M0 -9V-4M0 9V4M-9 0H-4M9 0H4" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
})
