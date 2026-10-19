import { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { sfx } from '../../lib/sound'
import { FONT, GAME_U, INK, Sym } from './art'
import { RollUp } from './Plates'
import type { Fx } from './fx'

/*
  The big win over the whole stage, by tier: a Big Win from 10× the bet, a Mega Win from 40×, and the full card
  (500×). The stage dims, gold rays turn slowly behind the jester, the title slams in, the amount rolls up, and
  confetti and coins fly (more of them, and longer, the bigger the win). It is only the show: the game was paid
  when it was collected. A click, a tap or Space ends it early.
*/

export interface BigWinData {
  id: number
  tier: 1 | 2 | 3
  mult: number
  lines: number
  amount: number
}

export const tierOf = (mult: number, lines: number): 0 | 1 | 2 | 3 => (lines === 12 ? 3 : mult >= 40 ? 2 : mult >= 10 ? 1 : 0)
const TITLE = ['', 'Big win!', 'Mega win!', 'Full card!']
const HOLD = [0, 3400, 4300, 5600]
/** gold for a Big Win, fire for a Mega Win, a rainbow for the full card */
const TITLE_FILL = [
  '',
  'linear-gradient(180deg,#fffbe0 0%,#ffd84a 45%,#f39b12 100%)',
  'linear-gradient(180deg,#fff3c4 0%,#ffb340 38%,#ff5a3c 72%,#e0245e 100%)',
  'linear-gradient(100deg,#ff5fb8 0%,#ffe23d 30%,#6dff8a 55%,#5cc8ff 78%,#b38bff 100%)',
]

export function BigWin({ win, fx, box, quick, onDone }: { win: BigWinData; fx: Fx | null; box: { w: number; h: number }; quick: boolean; onDone: () => void }) {
  // the rays and the jester hold still for players who ask for less motion
  const calm = useReducedMotion()
  const s = Math.max(0.55, Math.min(1.1, box.w / 760, box.h / 620))
  const done = useRef(onDone)
  done.current = onDone
  const hold = HOLD[win.tier] * (quick ? 0.72 : 1)
  const roll = Math.min(hold * 0.55, 1200 + win.tier * 500)

  useEffect(() => {
    sfx.lines.bigWin(win.tier)
    fx?.confetti(60 + win.tier * 50)
    // the coins come up from under the stage and rain back down past the amount
    const at = window.setTimeout(() => fx?.coins(box.w / 2, box.h + 20, 22 + win.tier * 14, s * 1.15), 260)
    const more = win.tier >= 2 ? window.setTimeout(() => fx?.confetti(70 * win.tier), 1500) : 0
    const end = window.setTimeout(() => done.current(), hold)
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault()
        e.stopImmediatePropagation()
        done.current()
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => {
      clearTimeout(at)
      clearTimeout(more)
      clearTimeout(end)
      window.removeEventListener('keydown', onKey, { capture: true })
    }
    // one show per win
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win.id])

  const R = Math.hypot(box.w, box.h) * 0.6
  return (
    <motion.div
      className="absolute inset-0 z-40 flex cursor-pointer items-center justify-center overflow-hidden"
      onClick={() => done.current()}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      style={{ background: 'radial-gradient(ellipse at 50% 46%, rgba(70,30,140,.78) 0%, rgba(14,5,32,.92) 72%)' }}
    >
      {/* the rays */}
      <motion.svg
        className="pointer-events-none absolute"
        width={R * 2}
        height={R * 2}
        viewBox="-100 -100 200 200"
        style={{ left: box.w / 2 - R, top: box.h * 0.46 - R }}
        animate={calm ? undefined : { rotate: 360 }}
        transition={{ duration: 40, repeat: Infinity, ease: 'linear' }}
        aria-hidden
      >
        {Array.from({ length: 18 }, (_, i) => (
          <path key={i} d="M0 0 L-7 -100 L7 -100 Z" fill={win.tier === 1 ? '#fff' : '#ffe27a'} opacity={win.tier === 1 ? 0.08 : 0.15} transform={`rotate(${i * 20})`} />
        ))}
      </motion.svg>

      <div className="relative flex flex-col items-center" style={{ transform: `scale(${s})` }}>
        <motion.div
          initial={{ y: 60, scale: 0.2, rotate: -20 }}
          animate={{ y: 0, scale: 1, rotate: calm ? 0 : [0, -8, 6, 0] }}
          transition={{ type: 'spring', stiffness: 260, damping: 13, rotate: calm ? { duration: 0.3 } : { duration: 1.4, repeat: Infinity, repeatDelay: 0.6 } }}
        >
          <Sym u={GAME_U} s={{ kind: win.tier === 3 ? 'super' : 'joker' }} col={0} size={150} />
        </motion.div>
        <motion.div
          initial={{ scale: 2.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 16, delay: 0.12 }}
          className="-mt-2 whitespace-nowrap bg-clip-text px-3 text-[76px] font-black uppercase italic leading-[1.1] tracking-tight text-transparent"
          style={{
            fontFamily: FONT,
            backgroundImage: TITLE_FILL[win.tier],
            WebkitTextStroke: `3px ${INK}`,
            filter: `drop-shadow(0 6px 0 ${INK})`,
          }}
        >
          {TITLE[win.tier]}
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }} className="mt-1 text-[20px] font-black uppercase tracking-[.16em] text-white" style={{ fontFamily: FONT, textShadow: `0 3px 0 ${INK}` }}>
          {win.lines === 12 ? 'Every number marked' : `${win.lines} lines`} · {win.mult}×
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.45 }}
          className="mt-4 flex items-center gap-2.5 rounded-full border-[4px] bg-white py-2 pl-6 pr-5 text-[44px] font-black leading-none"
          style={{ borderColor: INK, color: INK, fontFamily: FONT, boxShadow: '0 7px 0 rgba(29,15,48,.55)' }}
        >
          <RollUp value={win.amount} ms={roll} onTick={() => sfx.lines.count()} />
          <Coin size={40} />
        </motion.div>
      </div>
    </motion.div>
  )
}
