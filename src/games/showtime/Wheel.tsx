import { memo } from 'react'
import { motion, type MotionValue } from 'framer-motion'
import { useUid } from '../../art/ids'
import { SEGMENTS, WHEEL, type Spot } from './rules'
import { LOOK } from './words'
import { BonusGlyph } from './art'

/*
  The money wheel, seen face on, segment 0 at the top under the flapper when the wheel is at rest. The disc turns
  (the page drives `rot`, in degrees clockwise); the frame of chasing bulbs and the flapper stay still. The flapper
  is knocked aside by the pegs as they pass (`flap`, degrees).

  Drawn on a 1000 × 1000 board: the face reaches 452, the pegs sit at 438, the hub is 118 across the middle.
*/

const C = 500
const R = 452
const STEP = 360 / SEGMENTS
const rad = (deg: number) => ((deg - 90) * Math.PI) / 180
const at = (deg: number, r: number) => [C + r * Math.cos(rad(deg)), C + r * Math.sin(rad(deg))] as const

/** a wedge of the face from angle a0 to a1 (degrees clockwise from the top), between radii r0 and r1 */
function wedge(a0: number, a1: number, r0: number, r1: number) {
  const [x0, y0] = at(a0, r1)
  const [x1, y1] = at(a1, r1)
  const [x2, y2] = at(a1, r0)
  const [x3, y3] = at(a0, r0)
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`
}

/** the turning disc: its segments, labels, pegs and hub (drawn once) */
const Disc = memo(function Disc({ boosted, boost }: { boosted: Spot | null; boost: number }) {
  const u = useUid()
  return (
    <svg viewBox="0 0 1000 1000" className="absolute inset-0 h-full w-full" aria-hidden>
      <defs>
        <radialGradient id={`${u}sh`} cx=".5" cy=".5" r=".5">
          <stop offset=".25" stopColor="#000" stopOpacity="0" />
          <stop offset=".86" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".35" />
        </radialGradient>
        <radialGradient id={`${u}hub`} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#3a2a6e" />
          <stop offset=".7" stopColor="#1a1240" />
          <stop offset="1" stopColor="#0d0a24" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#b9851c" />
        </linearGradient>
        <linearGradient id={`${u}mega`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff4d61" />
          <stop offset=".35" stopColor="#ffb02e" />
          <stop offset=".65" stopColor="#2ee87f" />
          <stop offset="1" stopColor="#4cb4ff" />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R + 6} fill="#0c0a1e" />
      {WHEEL.map((s, i) => {
        const a = i * STEP
        const L = LOOK[s]
        return (
          <g key={i}>
            <path d={wedge(a - STEP / 2, a + STEP / 2, 120, R)} fill={s === 'mega' ? `url(#${u}mega)` : L.face} stroke="#0c0a1e" strokeWidth="2.5" />
            {/* a darker band at the rim and a lighter one inside give each segment some depth */}
            <path d={wedge(a - STEP / 2, a + STEP / 2, R - 26, R)} fill={L.deep} opacity=".55" />
            <path d={wedge(a - STEP / 2 + 0.6, a + STEP / 2 - 0.6, 128, 210)} fill="#fff" opacity=".08" />
            {boosted === s && <path d={wedge(a - STEP / 2 + 0.4, a + STEP / 2 - 0.4, 124, R - 2)} fill="none" stroke={`url(#${u}gold)`} strokeWidth="7" />}
          </g>
        )
      })}
      {WHEEL.map((s, i) => {
        const a = i * STEP
        const L = LOOK[s]
        if (s === 'coin' || s === 'peg' || s === 'wall' || s === 'mega')
          return (
            <g key={i} transform={`rotate(${a} ${C} ${C})`}>
              <BonusGlyph spot={s} x={C} y={112} size={44} />
              <text
                x={C}
                y={226}
                transform={`rotate(90 ${C} 226)`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="31"
                fontWeight="900"
                letterSpacing="1"
                fill={L.ink}
                fontFamily="Manrope, system-ui, sans-serif"
                stroke={L.deep}
                strokeWidth="1.2"
              >
                {L.short.toUpperCase()}
              </text>
            </g>
          )
        return (
          <g key={i} transform={`rotate(${a} ${C} ${C})`}>
            <text x={C} y={112} textAnchor="middle" dominantBaseline="central" fontSize={s === '10' ? 40 : 50} fontWeight="900" fill={L.ink} fontFamily="Manrope, system-ui, sans-serif" letterSpacing={s === '10' ? -2 : 0}>
              {s}
            </text>
            <text x={C} y={250} textAnchor="middle" dominantBaseline="central" fontSize="22" fontWeight="900" fill={L.ink} opacity=".55" fontFamily="Manrope, system-ui, sans-serif">
              {s}
            </text>
          </g>
        )
      })}
      {boosted && (
        <g>
          {WHEEL.map((s, i) =>
            s === boosted ? (
              <g key={i} transform={`rotate(${i * STEP} ${C} ${C})`}>
                <rect x={C - 24} y={300} width="48" height="26" rx="13" fill={`url(#${u}gold)`} />
                <text x={C} y={314} textAnchor="middle" dominantBaseline="central" fontSize="17" fontWeight="900" fill="#3a2400" fontFamily="Manrope, system-ui, sans-serif">
                  ×{boost}
                </text>
              </g>
            ) : null,
          )}
        </g>
      )}
      <circle cx={C} cy={C} r={R} fill={`url(#${u}sh)`} />
      {/* the pegs between segments, which knock the flapper */}
      {WHEEL.map((_, i) => {
        const [x, y] = at((i + 0.5) * STEP, R - 13)
        return <circle key={i} cx={x} cy={y} r="6.5" fill={`url(#${u}gold)`} stroke="#6b4a0c" strokeWidth="1.5" />
      })}
      {/* the hub */}
      <circle cx={C} cy={C} r="124" fill="#0c0a1e" />
      <circle cx={C} cy={C} r="116" fill={`url(#${u}hub)`} stroke={`url(#${u}gold)`} strokeWidth="6" />
      {Array.from({ length: 16 }, (_, i) => {
        const [x, y] = at(i * 22.5, 100)
        return <circle key={i} cx={x} cy={y} r="4" fill="#f7c548" opacity={i % 2 ? 0.5 : 0.9} />
      })}
      <text x={C} y={C - 18} textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif" letterSpacing="2">
        SHOW
      </text>
      <text x={C} y={C + 22} textAnchor="middle" dominantBaseline="central" fontSize="38" fontWeight="900" fill={`url(#${u}gold)`} fontFamily="Manrope, system-ui, sans-serif" letterSpacing="2">
        TIME
      </text>
    </svg>
  )
})

/** the still frame round the disc: a ring of bulbs that chase while the wheel turns, and the flapper at the top */
const Frame = memo(function Frame({ chase, win }: { chase: boolean; win: boolean }) {
  const u = useUid()
  const n = 40
  return (
    <svg viewBox="0 0 1000 1000" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${u}rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe7a3" />
          <stop offset=".45" stopColor="#d79b2a" />
          <stop offset="1" stopColor="#7a4f0e" />
        </linearGradient>
      </defs>
      {win && <path d={wedge(-STEP / 2, STEP / 2, 124, R)} fill="#fff" className="st-win" />}
      {win && <path d={wedge(-STEP / 2, STEP / 2, 124, R)} fill="none" stroke="#fff" strokeWidth="6" />}
      <circle cx={C} cy={C} r={R + 24} fill="none" stroke={`url(#${u}rim)`} strokeWidth="30" />
      <circle cx={C} cy={C} r={R + 8} fill="none" stroke="#2a1a05" strokeWidth="3" opacity=".6" />
      {Array.from({ length: n }, (_, i) => {
        const [x, y] = at((i * 360) / n, R + 24)
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="8"
            className={chase ? 'st-bulb st-chase' : win ? 'st-bulb st-flash' : 'st-bulb'}
            style={{ animationDelay: chase ? `${-(i % 4) * 0.12}s` : win ? `${(i % 2) * 0.25}s` : undefined }}
          />
        )
      })}
    </svg>
  )
})

export function MoneyWheel({
  rot,
  flap,
  boosted,
  boost,
  chase,
  win,
}: {
  rot: MotionValue<number>
  flap: MotionValue<number>
  boosted: Spot | null
  boost: number
  chase: boolean
  win: Spot | null
}) {
  return (
    <div className="relative h-full w-full">
      <style>{`
        .st-bulb { fill: #fff3c4; opacity: .55; }
        .st-chase { animation: st-chase .48s steps(1) infinite; }
        .st-flash { animation: st-flash .5s steps(1) infinite; }
        .st-win { animation: st-win 1s ease-in-out infinite; }
        @keyframes st-win { 0%, 100% { opacity: .1; } 50% { opacity: .38; } }
        @keyframes st-chase { 0% { opacity: 1; fill: #fff; } 25% { opacity: .3; fill: #ffd25e; } }
        @keyframes st-flash { 0% { opacity: 1; fill: #fff; } 50% { opacity: .25; fill: #ffd25e; } }
      `}</style>
      <div className="absolute inset-0 rounded-full shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)]" />
      <motion.div className="absolute inset-0 will-change-transform" style={{ rotate: rot }}>
        <Disc boosted={boosted} boost={boost} />
      </motion.div>
      <Frame chase={chase} win={!!win} />
      {/* the flapper, hung over the top of the wheel; the pegs push it aside as they pass */}
      <motion.svg viewBox="0 0 80 120" className="absolute left-1/2 top-0 w-[8%] -translate-x-1/2 -translate-y-[38%]" style={{ rotate: flap, originX: 0.5, originY: 0.22 }} aria-hidden>
        <defs>
          <linearGradient id="st-flapper" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6d0" />
            <stop offset=".5" stopColor="#f7c548" />
            <stop offset="1" stopColor="#a8720f" />
          </linearGradient>
        </defs>
        <path d="M40 112 L14 34 A28 28 0 1 1 66 34 Z" fill="url(#st-flapper)" stroke="#5c3d06" strokeWidth="4" strokeLinejoin="round" />
        <circle cx="40" cy="26" r="11" fill="#ff4d61" stroke="#5c3d06" strokeWidth="3" />
      </motion.svg>
    </div>
  )
}

/** the rotation (degrees) that puts segment i under the flapper, offset within the segment by f (-0.5 to 0.5) */
export const restAngle = (i: number, f = 0) => -(i + f) * STEP
export { STEP }
