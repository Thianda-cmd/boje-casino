import { memo, useEffect } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'framer-motion'
import type { Region } from './rules'
import { regionScore } from './rules'
import { kindOf, type Kind } from './geom'
import { callOf } from './words'

/*
  The scoreboard under the board, like a broadcast's lower third: the three darts' calls as they go in ("T20" over
  its 60), the running total counting up, and a line with what the darts to come need (from rules.ts's outlook,
  worked out by the page): the chance of reaching par, what is already locked in, the next step and its chance.
*/

const SLOT: Record<Kind, string> = {
  treble: 'bg-[linear-gradient(180deg,#ff5a6e,#c4142f)] text-white ring-[#ff9aa8]/50',
  double: 'bg-[linear-gradient(180deg,#2fd87e,#0d8a47)] text-white ring-[#8affbe]/50',
  bull: 'bg-[linear-gradient(180deg,#fff0b0,#f7c548_55%,#e09a1f)] text-[#2a1c00] ring-[#fff3c4]/70',
  outer: 'bg-[linear-gradient(180deg,#36c98a,#14845a)] text-white ring-[#8affbe]/40',
  single: 'bg-[linear-gradient(180deg,#2c4558,#1d3343)] text-ink ring-white/15',
  miss: 'bg-[#141d26] text-white/50 ring-white/10',
}

function Count({ value }: { value: number }) {
  const mv = useMotionValue(value)
  const text = useTransform(mv, (v) => String(Math.round(v)))
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.45, ease: [0.22, 1, 0.36, 1] })
    return c.stop
  }, [value, mv])
  return <motion.span className="tnum">{text}</motion.span>
}

export const Scoreboard = memo(function Scoreboard({
  darts,
  flying,
  total,
  line,
  verdict,
  compact,
}: {
  /** the darts in so far, in order */
  darts: Region[]
  /** the dart in the air (its index), if any */
  flying: number | null
  total: number
  /** what the darts to come need, or how the round came out */
  line: React.ReactNode
  /** once the round is in: what it pays, as the total's foot */
  verdict: { text: string; tone: 'win' | 'gold' | 'part' | 'none' } | null
  compact: boolean
}) {
  const slotH = compact ? 50 : 62
  return (
    <div className="overflow-hidden rounded-2xl bg-[#08121b]/90 ring-1 ring-white/[.08] shadow-[0_18px_40px_-16px_rgba(0,0,0,.8)] backdrop-blur-sm">
      <div className={`flex items-stretch ${compact ? 'gap-1 p-1' : 'gap-1.5 p-1.5'}`}>
        {[0, 1, 2].map((i) => {
          const r = darts[i]
          const has = r !== undefined
          const kind = has ? kindOf(r) : null
          return (
            <div key={i} className="relative min-w-0 flex-1" style={{ height: slotH }}>
              <div className="absolute inset-0 rounded-xl border border-dashed border-white/[.12]" />
              {!has && (
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  {flying === i ? (
                    <motion.span className="h-2.5 w-2.5 rounded-full bg-white" animate={{ opacity: [0.25, 1, 0.25], scale: [0.8, 1.15, 0.8] }} transition={{ duration: 0.6, repeat: Infinity }} />
                  ) : (
                    <span className={`font-black text-white/20 ${compact ? 'text-[10px]' : 'text-[11px]'} tracking-[0.14em]`}>DART {i + 1}</span>
                  )}
                </div>
              )}
              <AnimatePresence>
                {has && kind && (
                  <motion.div
                    key={`${i}-${r}`}
                    className={`absolute inset-0 flex flex-col items-center justify-center rounded-xl ring-1 ${SLOT[kind]} shadow-[inset_0_1px_0_rgba(255,255,255,.25),inset_0_-3px_0_rgba(0,0,0,.18)]`}
                    initial={{ scale: 0.4, opacity: 0, y: -10 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
                    transition={{ type: 'spring', stiffness: 520, damping: 22 }}
                  >
                    <span className={`font-black leading-none tracking-tight ${compact ? 'text-[19px]' : 'text-[24px]'}`}>{callOf(r)}</span>
                    <span className={`tnum font-extrabold leading-none opacity-75 ${compact ? 'mt-0.5 text-[10.5px]' : 'mt-1 text-[12px]'}`}>{regionScore(r)}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
        <div
          className={`flex shrink-0 flex-col items-center justify-center rounded-xl transition-colors duration-300 ${compact ? 'w-[86px]' : 'w-[118px]'} ${
            verdict?.tone === 'gold' ? 'bg-[linear-gradient(180deg,#fff0b0,#f7c548_55%,#e09a1f)] text-[#2a1c00]' : verdict?.tone === 'win' ? 'bg-[linear-gradient(180deg,#3ff08f,#16b85e)] text-[#032412]' : 'bg-white/[.06] text-ink'
          }`}
          style={{ height: slotH }}
        >
          <span className={`font-black uppercase leading-none tracking-[0.16em] opacity-60 ${compact ? 'text-[8.5px]' : 'text-[9.5px]'}`}>Total</span>
          <span className={`font-black leading-none ${compact ? 'mt-0.5 text-[24px]' : 'mt-1 text-[32px]'}`}>
            <Count value={total} />
          </span>
          {verdict && <span className={`tnum font-extrabold leading-none ${compact ? 'mt-0.5 text-[9.5px]' : 'mt-1 text-[11px]'} ${verdict.tone === 'none' || verdict.tone === 'part' ? 'text-white/60' : 'opacity-80'}`}>{verdict.text}</span>}
        </div>
      </div>
      <div className={`flex items-center justify-center border-t border-white/[.06] bg-white/[.025] px-3 text-center font-bold text-white/70 ${compact ? 'min-h-[24px] py-0.5 text-[10.5px]' : 'min-h-[30px] py-1 text-[12px]'}`}>{line}</div>
    </div>
  )
})
