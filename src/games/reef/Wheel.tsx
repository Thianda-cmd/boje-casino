import { useEffect, useState } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { WHEEL } from './rules'
import { GoldCoin, INK, inked } from './art'

/*
  The treasure wheel: when a chest is caught the scene lifts it open and asks the screen to spin (its 'wheel' event
  carries the segment rules.resolveHit already drew). The wheel rises out of the chest to the middle of the stage,
  spins WHEEL_SPIN seconds with the pointer clicking past each peg, and lands on that segment; the win shows under it
  as the chest bursts into coins, then it sinks away. It never takes the pointer, so the player can fire on while it
  spins.
*/

/** the segments round the wheel, clockwise from the top: indices into WHEEL, small and big interleaved */
const ORDER = [0, 5, 2, 7, 1, 4, 3, 6]
const COLORS: Record<number, [string, string]> = {
  20: ['#2fc6c0', '#1b8f8a'],
  25: ['#4cb4ff', '#2a7fd0'],
  30: ['#46c37b', '#2b8f55'],
  40: ['#ff6fa8', '#d9437f'],
  50: ['#ff8a2a', '#d0611a'],
  60: ['#8a5cff', '#6338d0'],
  80: ['#ff4b3e', '#c92a22'],
  150: ['#ffd23a', '#e09a12'],
}
const SEG = 360 / ORDER.length
const R = 92
/** how long the result stays up after the wheel lands (s) */
const HOLD = 1.5

export interface WheelSpin {
  key: number
  segment: number
  mult: number
  payout: number
  spin: number
  /** where the chest is on the stage (CSS px) */
  x: number
  y: number
}

const polar = (deg: number, r: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [Math.cos(a) * r, Math.sin(a) * r] as const
}

export function TreasureWheel({ spin, stage, onDone }: { spin: WheelSpin; stage: { w: number; h: number }; onDone: () => void }) {
  const size = Math.round(Math.max(190, Math.min(330, Math.min(stage.w, stage.h) * 0.56)))
  const rot = useMotionValue(0)
  const kick = useMotionValue(0)
  const [landed, setLanded] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const pos = ORDER.indexOf(spin.segment)

  useEffect(() => {
    // five turns and a bit, stopping somewhere inside the drawn segment (never on a peg)
    const inside = (Math.random() - 0.5) * SEG * 0.6
    const to = 360 * 5 + (360 - (pos * SEG + SEG / 2)) + inside
    let peg = 0
    const a = animate(rot, to, {
      duration: spin.spin,
      ease: [0.15, 0.62, 0.12, 1],
      onUpdate: (v) => {
        // a click and a flick of the pointer each time a peg passes under it
        const n = Math.floor(v / SEG)
        if (n !== peg) {
          peg = n
          sfx.reef.tick()
          kick.set(-22)
          animate(kick, 0, { type: 'spring', stiffness: 700, damping: 14 })
        }
      },
      onComplete: () => {
        setLanded(true)
        sfx.reef.wheelWin(spin.mult)
      },
    })
    const leave = window.setTimeout(() => setLeaving(true), (spin.spin + HOLD) * 1000)
    const done = window.setTimeout(onDone, (spin.spin + HOLD + 0.45) * 1000)
    return () => {
      a.stop()
      clearTimeout(leave)
      clearTimeout(done)
    }
    // one spin per mount (the screen keys the wheel by its spin)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const big = spin.mult >= 80
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[44%] z-30"
      style={{ width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
      initial={{ x: spin.x - stage.w / 2, y: spin.y - stage.h * 0.44, scale: 0.15, opacity: 0 }}
      animate={leaving ? { scale: 0.6, opacity: 0, y: 30, transition: { duration: 0.4 } } : { x: 0, y: 0, scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 170, damping: 19 }}
    >
      {/* a soft gold light behind it */}
      <div className="absolute -inset-[18%] rounded-full bg-[radial-gradient(circle,rgba(255,214,90,.55)_0%,rgba(255,190,60,.18)_45%,transparent_70%)]" />
      <svg viewBox="-110 -110 220 220" className="absolute inset-0 h-full w-full drop-shadow-[0_10px_16px_rgba(10,30,60,.45)]">
        <circle r="106" fill={INK} />
        <circle r="101" fill="#ffcf5a" />
        <circle r="96" fill={INK} />
        <motion.g style={{ rotate: rot }}>
          {ORDER.map((wi, p) => {
            const m = WHEEL[wi]
            const [c, dark] = COLORS[m]
            const a0 = p * SEG
            const a1 = a0 + SEG
            const [x0, y0] = polar(a0, R)
            const [x1, y1] = polar(a1, R)
            const [lx, ly] = polar(a0 + SEG / 2, R * 0.66)
            const win = landed && p === pos
            return (
              <g key={p}>
                <path d={`M0 0 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`} fill={c} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
                <path d={`M0 0 L${x0 * 0.98} ${y0 * 0.98} A${R * 0.98} ${R * 0.98} 0 0 1 ${x1 * 0.98} ${y1 * 0.98} Z`} fill="none" stroke={dark} strokeWidth="5" strokeOpacity=".5" transform="scale(.9)" />
                {win && (
                  <motion.path
                    d={`M0 0 L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`}
                    fill="#fff"
                    initial={{ opacity: 0.9 }}
                    animate={{ opacity: [0.9, 0.25, 0.7, 0.2, 0.55] }}
                    transition={{ duration: 1.2 }}
                  />
                )}
                <text
                  x={lx}
                  y={ly}
                  transform={`rotate(${a0 + SEG / 2} ${lx} ${ly})`}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={m >= 100 ? 19 : 21}
                  fontWeight="900"
                  fill="#fff"
                  stroke={INK}
                  strokeWidth="4.5"
                  paintOrder="stroke"
                  fontFamily="Manrope, system-ui, sans-serif"
                >
                  {m}×
                </text>
              </g>
            )
          })}
          {/* pegs on the rim between the segments */}
          {ORDER.map((_, p) => {
            const [x, y] = polar(p * SEG, R + 1)
            return <circle key={p} cx={x} cy={y} r="4.2" fill="#fff6d6" stroke={INK} strokeWidth="2" />
          })}
        </motion.g>
        {/* the hub: a gold coin with a gem */}
        <circle r="21" fill="#ffc93c" stroke={INK} strokeWidth="3.5" />
        <circle r="14" fill="none" stroke="#d99a2b" strokeWidth="2.4" />
        <path d="M0 -9 L8 0 L0 9 L-8 0 Z" fill="#3be8ff" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M-3.5 -3.5 L0 -7" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".8" />
      </svg>
      {/* the pointer at the top, flicking as the pegs go by */}
      <motion.svg viewBox="0 0 40 46" className="absolute left-1/2 top-[-6%] w-[15%] -translate-x-1/2" style={{ rotate: kick, originY: '20%' }}>
        <path d="M20 44 L6 16 A14 14 0 1 1 34 16 Z" fill="#ff4b3e" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <circle cx="20" cy="14" r="5.5" fill="#ffcf5a" stroke={INK} strokeWidth="2.6" />
        <path d="M11 10 Q13 5 18 4" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="2.6" strokeLinecap="round" />
      </motion.svg>
      {/* the win, once it lands: stamped over the wheel, what it pays under it */}
      {landed && (
        <>
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.3, rotate: -24 }}
            animate={{ opacity: 1, scale: 1, rotate: -7 }}
            transition={{ type: 'spring', stiffness: 460, damping: 12 }}
          >
            <span className="tnum whitespace-nowrap font-black leading-none" style={{ ...inked(Math.max(5, size * 0.024), Math.max(4, size * 0.018)), fontSize: size * (big ? 0.27 : 0.24), color: big ? '#ffd84a' : '#fff' }}>
              {spin.mult}×
            </span>
          </motion.div>
          <motion.div
            className="absolute left-1/2 top-full mt-2 -translate-x-1/2"
            initial={{ opacity: 0, y: -14, scale: 0.6 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: 'spring', stiffness: 460, damping: 16, delay: 0.12 }}
          >
            <span className="tnum flex items-center gap-1.5 whitespace-nowrap rounded-full border-[3px] bg-white px-3.5 py-1 text-[19px] font-black leading-none shadow-[0_4px_0_rgba(23,19,56,.45)]" style={{ borderColor: INK, color: INK }}>
              +{fmt(spin.payout)} <GoldCoin size={19} />
            </span>
          </motion.div>
        </>
      )}
    </motion.div>
  )
}
