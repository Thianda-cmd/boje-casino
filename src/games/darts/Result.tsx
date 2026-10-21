import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { dartsSfx } from './sound'
import { multText } from './table'

/*
  How a round comes out, on the stage. Part of the stake back is a quiet plate; a win is the gold plate under the
  board, with the caller's line over it when the darts earned one (a ton, a ton-plus); ten times the stake or more
  takes the stage: the line (or the tier: Big win 10×, Huge win 50×, Legendary 250×) in big outlined lettering over
  turning rays, the times-your-bet badge and the amount counted up. A tap closes it.

  The ribbon is the moment before the last dart when it could make the round: "180 ON!", or what it needs and
  what that pays.
*/

export const tierOf = (m: number) => (m >= 250 ? 3 : m >= 50 ? 2 : m >= 10 ? 1 : 0)
export const TIER_NAME = ['', 'BIG WIN!', 'HUGE WIN!', 'LEGENDARY!']
/** how long each tier counts its amount up (ms) */
export const TIER_COUNT = [0, 1500, 2300, 3300]

const FACE = {
  gold: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]',
  fire: 'bg-[linear-gradient(180deg,#fff3e0_0%,#ff9a4d_40%,#e8344e_100%)]',
  rainbow: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
}
const INK = '#1a0710'

/** big outlined lettering, as the house's banners have it */
export function Lettering({ text, face, className }: { text: string; face: keyof typeof FACE; className: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight ${className}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] [-webkit-text-stroke:0.16em_#1a0710] [filter:drop-shadow(0_0.07em_0_#1a0710)]" style={{ color: INK }}>
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${FACE[face]}`}>{text}</span>
    </span>
  )
}

/** a number that counts up to `to` over `ms`, ticking as it goes */
function useCount(to: number, ms: number) {
  const [v, setV] = useState(ms > 0 ? 0 : to)
  useEffect(() => {
    if (ms <= 0) return setV(to)
    const c = animate(0, to, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        dartsSfx.count(x / (to || 1))
      },
    })
    return () => c.stop()
  }, [to, ms])
  return v
}

/** splits a long line in two at the space nearest its middle */
function lines(text: string): string[] {
  if (text.length < 14) return [text]
  const mid = text.length / 2
  let best = -1
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  return best < 0 ? [text] : [text.slice(0, best), text.slice(best + 1)]
}

/**
 * A big win's moment, centred at `top` px down its area: the headline over turning rays, the times-your-bet badge
 * and the amount counted up.
 */
export function Celebration({ headline, tier, amount, mult, narrow, top, left, onDone }: { headline: string; tier: number; amount: number; mult: number; narrow: boolean; top: number; left: number; onDone: () => void }) {
  const counted = useCount(amount, TIER_COUNT[Math.max(1, tier)])
  const legend = tier >= 3 || headline.length > 14
  const rows = lines(headline)
  const size = narrow ? (rows.length > 1 ? 'text-[30px]' : 'text-[36px]') : rows.length > 1 ? 'text-[52px]' : 'text-[64px]'
  return (
    <motion.div className="absolute inset-0 z-[32] cursor-pointer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} onClick={onDone}>
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse ${narrow ? '85% 34%' : '48% 30%'} at ${left}px ${top}px, rgba(14,3,8,.78) 0%, rgba(14,3,8,.4) 55%, transparent 88%)` }} />
      <div className="pointer-events-none absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center" style={{ top, left }}>
        <motion.div
          className="absolute left-1/2 top-1/2 aspect-square w-[min(140vw,900px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 [mask-image:radial-gradient(circle,black_14%,transparent_52%)]"
          style={{
            background: legend
              ? 'repeating-conic-gradient(from 0deg, #ff4fd8 0deg 8deg, transparent 8deg 20deg, #ffe23d 20deg 28deg, transparent 28deg 40deg, #2fd3ff 40deg 48deg, transparent 48deg 60deg)'
              : 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 9deg, transparent 9deg 22deg)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: legend ? 14 : 22, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.3, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          <motion.div
            className={`mb-2 rounded-full bg-[#1a0710] font-black tracking-[0.2em] text-gold ${narrow ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[12.5px]'}`}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.15, 1] }}
            transition={{ delay: 0.35, duration: 0.4 }}
          >
            {multText(mult)} YOUR BET
          </motion.div>
          <motion.div className="flex flex-col items-center" animate={{ scale: [1, 1.04, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            {rows.map((r, i) => (
              <Lettering key={i} text={r} face={legend ? 'rainbow' : tier >= 2 ? 'fire' : 'gold'} className={`${size} ${i ? '-mt-[0.08em]' : ''}`} />
            ))}
          </motion.div>
          <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#1a0710] bg-white shadow-[0_6px_0_rgba(26,7,16,.45)] ${narrow ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
            <span className={`tnum flex items-center gap-1.5 font-black text-[#1a0710] ${narrow ? 'text-[19px]' : 'text-[28px]'}`}>
              {fmt(counted)} <Coin size={narrow ? 18 : 24} />
            </span>
          </div>
          <div className="mt-2 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-bold text-white/70">Tap to continue</div>
        </motion.div>
      </div>
    </motion.div>
  )
}

/** a win under ten times the stake (or part of it back): the plate, with the caller's line over it */
export function WinPlate({ amount, mult, line, narrow }: { amount: number; mult: number; line: string | null; narrow: boolean }) {
  const full = mult >= 1
  return (
    <motion.div
      className="pointer-events-none flex flex-col items-center"
      initial={{ opacity: 0, y: 14, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.94, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 20 }}
    >
      {line && (
        <motion.div initial={{ scale: 0.4, rotate: -6 }} animate={{ scale: 1, rotate: -3 }} transition={{ type: 'spring', stiffness: 380, damping: 12 }} className="mb-1">
          <Lettering text={line} face="gold" className={narrow ? 'text-[26px]' : 'text-[38px]'} />
        </motion.div>
      )}
      {full ? (
        <>
          <div className="relative z-10 mb-[-9px] rounded-full bg-[#1a0710] px-3 py-0.5 text-[11px] font-black tracking-[0.24em] text-gold">WIN</div>
          <div
            className={`tnum flex items-center gap-1.5 whitespace-nowrap rounded-2xl border-[3px] border-[#1a0710] bg-[linear-gradient(180deg,#fff6d6,#ffe08a_55%,#f2b53a)] font-black leading-none text-[#2a1600] shadow-[0_5px_0_rgba(26,7,16,.5),0_18px_40px_-12px_rgba(0,0,0,.8)] ${narrow ? 'px-3.5 pb-1.5 pt-2.5 text-[19px]' : 'px-4 pb-2 pt-3 text-[25px]'}`}
          >
            {fmt(amount)} <Coin size={narrow ? 17 : 22} />
          </div>
          <div className="tnum mt-1.5 rounded-full bg-black/60 px-2.5 py-0.5 text-[11px] font-extrabold text-white/85">{multText(mult)} your bet</div>
        </>
      ) : (
        <div className="tnum flex items-center gap-1.5 rounded-full bg-black/65 px-3 py-1 text-[13px] font-extrabold text-white/85 ring-1 ring-white/10">
          {fmt(amount)} <Coin size={14} /> back <span className="text-white/50">· {multText(mult)}</span>
        </div>
      )}
    </motion.div>
  )
}

/** the last dart could make the round */
export function Ribbon({ text, sub, narrow }: { text: string; sub: string; narrow: boolean }) {
  return (
    <motion.div
      className="pointer-events-none flex flex-col items-center"
      initial={{ opacity: 0, scale: 0.6, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 18 }}
    >
      <div className={`flex flex-col items-center rounded-2xl bg-[#0b0306]/75 ring-1 ring-white/10 shadow-[0_12px_30px_-10px_rgba(0,0,0,.9)] backdrop-blur-[3px] ${narrow ? 'px-3.5 pb-1.5 pt-1' : 'px-5 pb-2 pt-1.5'}`}>
        <motion.div animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 0.5, repeat: Infinity }}>
          <Lettering text={text} face="fire" className={narrow ? 'text-[26px]' : 'text-[38px]'} />
        </motion.div>
        <div className="tnum text-[11.5px] font-extrabold text-white/85">{sub}</div>
      </div>
    </motion.div>
  )
}
