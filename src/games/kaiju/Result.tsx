import { useEffect, useRef } from 'react'
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { fighter, oddsOf, selName, sideId, winOf } from './rules'
import { KaijuPortrait } from './portraits'
import { MethodMark } from './art'
import type { Outcome } from './ledger'
import type { Sel } from './types'

/*
  The player's own result, once their round has settled (live.ts lastSettled): a card at the foot of the stage, YOU
  WON 412.50 with the selection that paid the most under it ("Gorrath by KO · 4.24×", and how many more paid), the net
  and a short burst of confetti, or "No win this time" with the stake it was on. A big win (ten times the stake or
  more) gets the party over the whole stage first: rays, the title slamming in (BIG WIN, or MONSTER WIN from fifty
  times), the amount counting up and confetti falling, for a few seconds or until tapped. Players who ask for less
  motion get the card and the party as still pictures.
*/

export const bigWin = (o: Outcome) => o.bet > 0 && o.payout >= o.bet * 10
const CONFETTI = ['#ffd45c', '#ff5d73', '#3ee68a', '#62cdff', '#ffffff', '#ffb547', '#9b7bff']

/** the selection that paid the most (or, on a loss, the biggest stake) and how many others */
function headline(o: Outcome): { sel: Sel | null; more: number } {
  const list = (o.won.length ? o.won : (Object.keys(o.landed) as Sel[])).filter((s) => (o.landed[s] ?? 0) > 0)
  if (!list.length) return { sel: null, more: 0 }
  const mult = oddsOf(o.matchup.a, o.matchup.b).mult
  const worth = (s: Sel) => (o.won.length ? winOf(o.landed[s]!, mult[s]) : o.landed[s]!)
  const best = list.reduce((x, y) => (worth(y) > worth(x) ? y : x))
  return { sel: best, more: list.length - 1 }
}

export function MyResult({ outcome, compact }: { outcome: Outcome; compact: boolean }) {
  const calm = useReducedMotion()
  const o = outcome
  const won = o.payout > 0
  const { sel, more } = headline(o)
  const r = o.result
  const winnerId = r ? sideId(o.matchup, r.winner) : null
  const what = sel ? selName(sel, o.matchup) : ''
  const price = sel ? oddsOf(o.matchup.a, o.matchup.b).mult[sel] : 0
  return (
    <motion.div
      className={`pointer-events-auto relative overflow-visible rounded-2xl text-center ring-1 backdrop-blur ${won ? 'bg-[#0b1d16]/90 ring-accent/50' : 'bg-[#0a1220]/85 ring-white/10'} ${compact ? 'px-3 py-2' : 'px-5 py-3'}`}
      style={{ boxShadow: won ? '0 0 50px -14px rgba(34,211,111,.8), 0 20px 50px -20px rgba(0,0,0,.8)' : '0 20px 50px -20px rgba(0,0,0,.8)' }}
      initial={calm ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 340, damping: 22 }}
      data-my-result={won ? 'win' : 'loss'}
    >
      {won && !calm && <Burst />}
      <div className="flex items-center justify-center gap-2.5">
        {winnerId && <KaijuPortrait id={winnerId} size={compact ? 30 : 40} mood={won ? 'win' : 'fierce'} bg mirror={r?.winner === 'b'} className="shrink-0 rounded-lg" />}
        <div className="min-w-0 text-left">
          <div className={`font-black uppercase tracking-[.16em] ${won ? 'text-accent' : 'text-white/55'} ${compact ? 'text-[9.5px]' : 'text-[11px]'}`}>{won ? 'You won' : 'No win this time'}</div>
          {won ? (
            <div className={`tnum flex items-center gap-1.5 font-black leading-none text-white ${compact ? 'text-[22px]' : 'text-[30px]'}`}>
              <CountUp value={o.payout} calm={!!calm} /> <Coin size={compact ? 18 : 24} />
            </div>
          ) : (
            <div className={`tnum font-black leading-tight text-white/85 ${compact ? 'text-[14px]' : 'text-[17px]'}`}>{fmt(o.bet)} staked</div>
          )}
          <div className={`truncate font-bold text-white/65 ${compact ? 'max-w-[220px] text-[11px]' : 'max-w-[340px] text-[12.5px]'}`}>
            {won ? `${what} · ${price.toFixed(2)}×` : sel ? `Your biggest was ${what}` : ''}
            {more > 0 && <span className="text-white/45"> + {more} more</span>}
          </div>
        </div>
        {won && (
          <div className={`tnum shrink-0 rounded-lg bg-accent/15 px-2 py-1 font-black text-accent ${compact ? 'text-[11px]' : 'text-[13px]'}`}>
            {o.net >= 0 ? '+' : ''}
            {fmt(o.net)}
          </div>
        )}
      </div>
    </motion.div>
  )
}

/** a number counting up from nothing */
function CountUp({ value, calm }: { value: number; calm: boolean }) {
  const mv = useMotionValue(calm ? value : 0)
  const text = useTransform(mv, (v) => fmt(v))
  useEffect(() => {
    if (calm) return mv.set(value)
    const c = animate(mv, value, { duration: 1.3, ease: [0.16, 1, 0.3, 1], delay: 0.2 })
    return c.stop
  }, [value, mv, calm])
  return <motion.span className="tnum">{text}</motion.span>
}

/** confetti bursting out round the card */
function Burst() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0" aria-hidden>
      {Array.from({ length: 26 }, (_, i) => {
        const a = (i / 26) * Math.PI * 2 + (i % 3) * 0.2
        const d = 70 + (i % 5) * 26
        return (
          <motion.span
            key={i}
            className="absolute block rounded-[2px]"
            style={{ width: 6 + (i % 3) * 2, height: 9 + (i % 4) * 2, background: CONFETTI[i % CONFETTI.length], left: -4, top: -5 }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: Math.cos(a) * d * 1.6, y: Math.sin(a) * d + 60, opacity: 0, rotate: (i % 2 ? 1 : -1) * 420, scale: 1 }}
            transition={{ duration: 1.5 + (i % 4) * 0.2, ease: [0.1, 0.7, 0.3, 1] }}
          />
        )
      })}
    </div>
  )
}

/** the big win over the whole stage */
export function Party({ outcome, compact, onDone }: { outcome: Outcome; compact: boolean; onDone: () => void }) {
  const calm = useReducedMotion()
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const t = window.setTimeout(() => done.current(), 4200)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        done.current()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
  }, [])
  const mult = outcome.payout / outcome.bet
  const monster = mult >= 50
  const r = outcome.result
  return (
    <motion.div
      className="absolute inset-0 z-[45] flex cursor-pointer items-center justify-center overflow-hidden"
      onClick={() => done.current()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      data-party
    >
      <div className="absolute inset-0" style={{ background: `radial-gradient(closest-side, ${monster ? 'rgba(255,90,130,.34)' : 'rgba(255,214,120,.3)'}, transparent), rgba(6,8,22,.95)` }} />
      <div
        className={`absolute left-1/2 top-1/2 h-[240%] w-[240%] -translate-x-1/2 -translate-y-1/2 opacity-40 ${calm ? '' : 'kj-anim'}`}
        style={{
          background: `repeating-conic-gradient(from 0deg, ${monster ? 'rgba(255,140,200,.5)' : 'rgba(255,226,140,.55)'} 0deg 8deg, transparent 8deg 20deg)`,
          animation: calm ? undefined : 'kj-rays 24s linear infinite',
          maskImage: 'radial-gradient(closest-side, #000 18%, transparent)',
          WebkitMaskImage: 'radial-gradient(closest-side, #000 18%, transparent)',
        }}
      />
      {!calm &&
        Array.from({ length: 52 }, (_, i) => {
          const x = (i * 37) % 100
          const d = 1.9 + ((i * 13) % 10) / 6
          return (
            <motion.span
              key={i}
              className="absolute top-0 block rounded-[2px]"
              style={{ left: `${x}%`, width: 7 + (i % 3) * 2, height: 11 + (i % 4) * 2, background: CONFETTI[i % CONFETTI.length] }}
              initial={{ y: -30, rotate: 0, opacity: 1 }}
              animate={{ y: compact ? 520 : 820, rotate: (i % 2 ? 1 : -1) * (360 + i * 20), x: ((i % 5) - 2) * 26 }}
              transition={{ duration: d, delay: (i % 12) * 0.09, ease: 'easeIn' }}
            />
          )
        })}
      <div className="relative text-center">
        {r && (
          <motion.div className="mb-2 flex justify-center" initial={calm ? false : { y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.15 }}>
            <KaijuPortrait id={sideId(outcome.matchup, r.winner)} size={compact ? 64 : 96} mood="win" bg mirror={r.winner === 'b'} className="rounded-2xl" />
          </motion.div>
        )}
        <motion.div
          className={`font-black italic uppercase leading-none tracking-tight ${compact ? 'text-[46px]' : 'text-[84px]'}`}
          style={{
            color: monster ? '#ff8ac8' : '#ffd45c',
            WebkitTextStroke: compact ? '2px #2a0d16' : '3px #2a0d16',
            textShadow: `0 6px 0 #2a0d16, 0 0 50px ${monster ? 'rgba(255,120,190,.7)' : 'rgba(255,212,92,.7)'}`,
          }}
          initial={calm ? false : { scale: 3, opacity: 0, rotate: -8 }}
          animate={{ scale: 1, opacity: 1, rotate: -4 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        >
          {monster ? 'Monster win!' : 'Big win!'}
        </motion.div>
        <motion.div
          className={`tnum mt-3 flex items-center justify-center gap-2 font-black text-white ${compact ? 'text-[30px]' : 'text-[46px]'}`}
          style={{ textShadow: '0 3px 0 rgba(0,0,0,.5)' }}
          initial={calm ? false : { y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          +<CountUp value={outcome.payout} calm={!!calm} /> <Coin size={compact ? 26 : 38} />
        </motion.div>
        {r && (
          <div className={`mt-1.5 flex items-center justify-center gap-1.5 font-black text-white/80 ${compact ? 'text-[13px]' : 'text-[17px]'}`}>
            <MethodMark method={r.method} size={compact ? 15 : 19} />
            {fighter(sideId(outcome.matchup, r.winner)).name} · {mult.toFixed(1)}× your stake
          </div>
        )}
      </div>
    </motion.div>
  )
}
