import { memo, useEffect, useRef } from 'react'
import { animate, motion, useMotionValue } from 'framer-motion'
import { BOOST, SPOTS, type Booster as BoosterResult, type Spot } from './rules'
import { SpotBadge } from './art'
import { LOOK } from './words'

/*
  The Booster: a two-reel slot over the stage. Before every spin its reels run and stop on a spot and a multiplier,
  or on blanks when it misses. Each new `spin` (a counter) runs the reels to `result`; `onStop` is told as each reel
  lands (0, then 1), for the sound. Between spins it shows the last result.
*/

const H = 52
const SPIN_REPEAT = 6
type SpotCell = Spot | null
type MultCell = number | null
const SPOT_CELLS: SpotCell[] = [...SPOTS, null]
const MULT_CELLS: MultCell[] = [...BOOST.map(([m]) => m), null]
/** the reel strips: the cells over and over, so a spin can run several turns before it stops */
const SPOT_STRIP = Array.from({ length: SPIN_REPEAT }, () => SPOT_CELLS).flat()
const MULT_STRIP = Array.from({ length: SPIN_REPEAT }, () => MULT_CELLS).flat()

function Reel<T>({ strip, cells, target, spin, delay, onStop, render }: { strip: T[]; cells: T[]; target: T; spin: number; delay: number; onStop: () => void; render: (c: T) => React.ReactNode }) {
  const y = useMotionValue(-cells.indexOf(target) * H)
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      y.set(-(cells.indexOf(target) + cells.length) * H)
      return
    }
    // start from the same cell one turn up, and run four turns and a bit on to the target in the last turn
    const n = cells.length
    const from = ((Math.round(-y.get() / H) % n) + n) % n
    y.set(-from * H)
    const to = (SPIN_REPEAT - 2) * n + cells.indexOf(target)
    const a = animate(y, -to * H, { duration: 1.25 + delay, ease: [0.15, 0.55, 0.2, 1], onComplete: onStop })
    return () => a.stop()
    // a new spin is the only trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin])
  return (
    <div className="relative h-[52px] w-[64px] overflow-hidden rounded-lg bg-[#0b0820] shadow-[inset_0_3px_10px_rgba(0,0,0,.8)] ring-2 ring-[#f7c548]/70 sm:w-[72px]">
      <motion.div style={{ y }} className="absolute inset-x-0 top-0">
        {strip.map((c, i) => (
          <div key={i} className="flex h-[52px] items-center justify-center">
            {render(c)}
          </div>
        ))}
      </motion.div>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(11,8,32,.85),transparent_30%,transparent_70%,rgba(11,8,32,.85))]" />
    </div>
  )
}

export const BoosterPanel = memo(function BoosterPanel({
  result,
  spin,
  landed,
  onStop,
  compact,
}: {
  result: BoosterResult | null
  spin: number
  /** both reels have stopped on this spin's result */
  landed: boolean
  onStop: (reel: number) => void
  compact?: boolean
}) {
  const spot = result?.spot ?? null
  const mult = result?.mult ?? null
  return (
    <div className={`rounded-2xl bg-[linear-gradient(180deg,#2a1d5c,#140e33)] p-2.5 shadow-[0_18px_40px_-14px_rgba(0,0,0,.85)] ring-1 ring-white/10 ${compact ? '' : 'sm:p-3'}`}>
      <div className="mb-2 flex items-center justify-between gap-2 px-0.5">
        <span className="text-[11px] font-black uppercase tracking-[.18em] text-[#ffd25e]">Booster</span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span key={i} className={`h-1.5 w-1.5 rounded-full ${landed && result ? 'animate-pulse bg-[#ffd25e]' : 'bg-white/25'}`} style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <Reel strip={SPOT_STRIP} cells={SPOT_CELLS} target={spot} spin={spin} delay={0} onStop={() => onStop(0)} render={(c) => (c ? <SpotBadge spot={c} size={38} /> : <Blank />)} />
        <Reel
          strip={MULT_STRIP}
          cells={MULT_CELLS}
          target={mult}
          spin={spin}
          delay={0.45}
          onStop={() => onStop(1)}
          render={(c) => (c ? <span className="tnum text-[22px] font-black text-[#ffd25e] [text-shadow:0_2px_0_#7a4f0e]">×{c}</span> : <Blank />)}
        />
      </div>
      {!compact && (
        <div className="mt-2 h-4 px-0.5 text-center text-[11.5px] font-bold text-white/70">
          {spin === 0 ? 'Boosts a spot each spin' : !landed ? 'Spinning…' : result ? (
            <span>
              <span style={{ color: LOOK[result.spot].face }}>{LOOK[result.spot].name}</span> boosted ×{result.mult}
            </span>
          ) : (
            'No boost this spin'
          )}
        </div>
      )}
    </div>
  )
})

const Blank = () => <span className="h-1.5 w-7 rounded-full bg-white/20" />
