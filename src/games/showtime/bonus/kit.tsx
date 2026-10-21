import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { MAX_WIN, type BonusSpot } from '../rules'
import { LOOK, fmtX } from '../words'
import { SpotBadge } from '../art'
import { showtimeSfx } from '../sound'

/* What the four bonus rounds share: the stage they take over, their countdown, and the plate their result lands on. */

/** a multiplier as a bonus round shows it: boosted, and capped at the round's limit */
export const shownX = (v: number, boost: number) => Math.min(MAX_WIN, v * boost)

export function BonusShell({ spot, boost, stake, bg, children, note, noteOnPhone = true }: { spot: BonusSpot; boost: number; stake: number; bg: string; children: ReactNode; note?: ReactNode; noteOnPhone?: boolean }) {
  const L = LOOK[spot]
  return (
    <motion.div className="absolute inset-0 z-20 overflow-hidden" style={{ background: bg }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
      {/* stage lights sweeping from the top corners */}
      <div className="pointer-events-none absolute -left-1/4 -top-1/3 h-[140%] w-1/2 origin-top rotate-[24deg] bg-[linear-gradient(180deg,rgba(255,255,255,.10),transparent_70%)] blur-xl" />
      <div className="pointer-events-none absolute -right-1/4 -top-1/3 h-[140%] w-1/2 origin-top -rotate-[24deg] bg-[linear-gradient(180deg,rgba(255,255,255,.10),transparent_70%)] blur-xl" />
      <motion.div
        className="absolute left-1/2 top-2.5 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-black/45 py-1.5 pl-1.5 pr-4 ring-1 ring-white/15 backdrop-blur sm:top-3"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 24, delay: 0.1 }}
      >
        <SpotBadge spot={spot} size={26} />
        <span className="text-[14px] font-black uppercase tracking-wider text-white sm:text-[15px]">{L.name}</span>
        {boost > 1 && <span className="tnum rounded-full bg-[linear-gradient(180deg,#fff1b8,#f7c548)] px-2 py-0.5 text-[12px] font-black text-[#3a2400]">Boosted ×{boost}</span>}
      </motion.div>
      {(stake > 0 || note) && (
        <div className={`absolute bottom-2.5 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/40 px-3 py-1 text-[12px] font-bold text-white/80 ring-1 ring-white/10 ${noteOnPhone ? '' : 'max-sm:hidden'}`}>
          {note ?? (
            <>
              Your <span className="tnum text-white">{stake.toLocaleString('en-US')}</span> is riding on it
            </>
          )}
        </div>
      )}
      {children}
    </motion.div>
  )
}

/** counts down from `secs` while `on`, calling onEnd at zero; ticks the last three seconds */
export function useCountdown(secs: number, on: boolean, onEnd: () => void) {
  const [left, setLeft] = useState(secs)
  const end = useRef(onEnd)
  end.current = onEnd
  useEffect(() => {
    if (!on) return
    setLeft(secs)
    const t0 = Date.now()
    let last = secs
    const id = window.setInterval(() => {
      const l = Math.max(0, secs - Math.floor((Date.now() - t0) / 1000))
      if (l !== last) {
        last = l
        setLeft(l)
        if (l > 0 && l <= 3) showtimeSfx.count(l)
        if (l === 0) {
          clearInterval(id)
          end.current()
        }
      }
    }, 100)
    return () => clearInterval(id)
  }, [secs, on])
  return left
}

export function CountdownPill({ left, label }: { left: number; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-black/50 py-1 pl-1 pr-3 ring-1 ring-white/15">
      <span className={`tnum flex h-7 w-7 items-center justify-center rounded-full text-[13px] font-black ${left <= 3 ? 'bg-danger text-white' : 'bg-white text-[#140e33]'}`}>{left}</span>
      <span className="text-[13px] font-bold text-white">{label}</span>
    </div>
  )
}

/** the bonus round's result, centred over its stage */
export function ResultPlate({ x, capped, color }: { x: number; capped: boolean; color: string }) {
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        initial={{ scale: 0.4, rotate: -8 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="rounded-3xl border-4 bg-[#140e33]/90 px-8 py-4 text-center shadow-[0_30px_80px_-20px_rgba(0,0,0,.9)] backdrop-blur"
        style={{ borderColor: color, boxShadow: `0 0 60px -10px ${color}` }}
      >
        <div className="text-[12px] font-black uppercase tracking-[.2em] text-white/70">{capped ? 'Maximum win' : 'Bonus pays'}</div>
        <div className="tnum text-[46px] font-black leading-none tracking-tight sm:text-[58px]" style={{ color }}>
          {fmtX(x)}
        </div>
      </motion.div>
    </motion.div>
  )
}
