import { useEffect, type ReactNode } from 'react'
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { Coin } from '../../components/icons'
import { AnimatedNumber } from '../../components/ui'
import { fmt } from '../../lib/format'
import { PITCHES, multiplierOf, type Climb } from './rules'
import type { How } from './storage'
import { LOOK, altText, campName, multText, oneIn, pathChance } from './words'

/*
  How a climb ended, on the stage. The end card drops in over the sky once the moment has played: SUMMIT! in gold,
  BANKED! in green (BANKED FOR YOU for a climb finished after a week away), FELL! in red; what it paid, where it
  stopped, the routes it took as a string of coloured chips (with a cross where it gave way), how rare a climb like
  it is, and Play again. The summit gets a party first: the sky turns to rays, SUMMIT! slams in, the coins count up
  and confetti falls, for a few seconds or until tapped.
*/

const INITIAL = { trail: 'T', ridge: 'R', cliff: 'C', wall: 'W' } as const

export function RouteChips({ climb, small }: { climb: Climb; small?: boolean }) {
  const sz = small ? 'h-[18px] min-w-[18px] text-[10px]' : 'h-[22px] min-w-[22px] text-[11px]'
  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      {climb.path.map((r, i) => (
        <span key={i} className={`flex items-center justify-center rounded-md px-1 font-black ${sz}`} style={{ background: LOOK[r].a, color: LOOK[r].ink }} title={r}>
          {INITIAL[r]}
        </span>
      ))}
      {climb.fellOn && (
        <span className={`flex items-center justify-center rounded-md px-1 font-black ring-1 ring-danger ${sz}`} style={{ background: '#2a1620', color: '#ff8a9a' }}>
          {INITIAL[climb.fellOn]}✕
        </span>
      )}
    </div>
  )
}

export function EndCard({ how, stake, climb, payout, narrow, action }: { how: How | 'away'; stake: number; climb: Climb; payout: number; narrow: boolean; action: ReactNode }) {
  const fell = climb.state === 'fell'
  const k = climb.path.length
  const m = fell ? 0 : multiplierOf(climb.path)
  const top = !fell && k >= PITCHES
  const headline = top ? 'SUMMIT!' : fell ? 'FELL!' : how === 'stale' ? 'BANKED FOR YOU' : 'BANKED!'
  const color = top ? '#ffd45c' : fell ? '#ff5d73' : '#3ee68a'
  const line = fell ? `${LOOK[climb.fellOn ?? 'trail'].gives} above ${campName(k)}` : `${multText(m)} at ${campName(k)} · ${altText(k)}`
  const odds = !fell && k > 0 ? `${oneIn(pathChance(climb.path))} climbs make it this far on these routes` : fell ? (k > 0 ? `Made it to ${campName(k)} (${altText(k)}) first` : 'Down at the first pitch') : null
  return (
    <div className={`relative w-full overflow-hidden rounded-2xl bg-[#0a1322]/[.92] text-center ring-1 ring-white/12 backdrop-blur-sm ${narrow ? 'px-3 pb-3 pt-3' : 'px-5 pb-4 pt-4'}`} style={{ boxShadow: `0 30px 70px -20px rgba(0,0,0,.85), 0 0 50px -16px ${color}` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-1.5" style={{ background: color }} />
      <motion.div className={`font-black italic leading-none tracking-tight ${narrow ? 'text-[30px]' : 'text-[40px]'}`} style={{ color, textShadow: '0 3px 0 rgba(0,0,0,.45)' }} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }}>
        {headline}
      </motion.div>
      <div className={`tnum mt-2 flex items-center justify-center gap-2 font-black text-white ${narrow ? 'text-[24px]' : 'text-[30px]'}`}>
        {fell ? <span className="text-white/45">0.00</span> : <>+<AnimatedNumber value={payout} /></>}
        <Coin size={narrow ? 20 : 24} />
      </div>
      <div className={`mt-1 font-bold text-white/70 ${narrow ? 'text-[12px]' : 'text-[13.5px]'}`}>{line}</div>
      <div className="mt-2.5">
        <RouteChips climb={climb} small={narrow} />
      </div>
      {odds && <div className={`mt-2 font-semibold text-white/45 ${narrow ? 'text-[11px]' : 'text-[12px]'}`}>{odds}{fell ? ` · stake ${fmt(stake)} lost` : ''}</div>}
      {how === 'away' && <div className="mt-1 text-[11.5px] font-semibold text-white/40">Finished in another tab</div>}
      <div className={`${narrow ? 'mt-2.5' : 'mt-3.5'}`}>{action}</div>
    </div>
  )
}

/** a number counting up from nothing */
function CountUp({ value }: { value: number }) {
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => fmt(v))
  useEffect(() => {
    const c = animate(mv, value, { duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.35 })
    return c.stop
  }, [value, mv])
  return <motion.span className="tnum">{text}</motion.span>
}

const CONFETTI = ['#ffd45c', '#ff5d73', '#3ee68a', '#62cdff', '#ffffff', '#ffb547', '#9b7bff']

export function SummitParty({ amount, mult, narrow, onDone }: { amount: number; mult: number; narrow: boolean; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 3600)
    return () => clearTimeout(t)
  }, [onDone])
  return (
    <motion.div className="absolute inset-0 z-[35] flex cursor-pointer items-center justify-center overflow-hidden" onClick={onDone} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.35 } }}>
      <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgba(255,214,120,.38),rgba(6,10,26,.55))]" />
      <div className="absolute left-1/2 top-1/2 h-[220%] w-[220%] -translate-x-1/2 -translate-y-1/2 opacity-40" style={{ background: 'repeating-conic-gradient(from 0deg, rgba(255,226,140,.55) 0deg 8deg, transparent 8deg 20deg)', animation: 'summit-rays 22s linear infinite', maskImage: 'radial-gradient(closest-side, #000 20%, transparent)', WebkitMaskImage: 'radial-gradient(closest-side, #000 20%, transparent)' }} />
      {Array.from({ length: 46 }, (_, i) => {
        const x = (i * 37) % 100
        const d = 1.8 + ((i * 13) % 10) / 6
        return (
          <motion.span
            key={i}
            className="absolute top-0 block rounded-[2px]"
            style={{ left: `${x}%`, width: 7 + (i % 3) * 2, height: 11 + (i % 4) * 2, background: CONFETTI[i % CONFETTI.length] }}
            initial={{ y: -30, rotate: 0, opacity: 1 }}
            animate={{ y: narrow ? 640 : 900, rotate: (i % 2 ? 1 : -1) * (360 + i * 20), x: ((i % 5) - 2) * 26 }}
            transition={{ duration: d, delay: (i % 12) * 0.09, ease: 'easeIn' }}
          />
        )
      })}
      <div className="relative text-center">
        <motion.div className={`font-black italic leading-none tracking-tight text-[#ffd45c] ${narrow ? 'text-[58px]' : 'text-[96px]'}`} style={{ WebkitTextStroke: narrow ? '2px #2a1600' : '3px #2a1600', textShadow: '0 6px 0 #2a1600, 0 0 50px rgba(255,212,92,.7)' }} initial={{ scale: 3, opacity: 0, rotate: -8 }} animate={{ scale: 1, opacity: 1, rotate: -4 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          SUMMIT!
        </motion.div>
        <motion.div className={`tnum mt-4 flex items-center justify-center gap-2 font-black text-white ${narrow ? 'text-[30px]' : 'text-[44px]'}`} style={{ textShadow: '0 3px 0 rgba(0,0,0,.5)' }} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}>
          +<CountUp value={amount} /> <Coin size={narrow ? 26 : 36} />
        </motion.div>
        <motion.div className={`mt-2 font-black text-white/80 ${narrow ? 'text-[15px]' : 'text-[19px]'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
          {multText(mult)} · {altText(PITCHES)} · all ten pitches
        </motion.div>
      </div>
    </motion.div>
  )
}
