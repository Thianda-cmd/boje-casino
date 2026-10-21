import { useEffect, useRef, useState, type ReactNode } from 'react'
import { animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import type { BoardId } from './rules'
import { Spark, TierBadge } from './art'
import { dealSfx } from './sound'
import { TIERS, multText, oneIn, chanceOf, topOf } from './words'

/*
  The big moments on the stage: the board's reveal at the start of a game (the badge flicks through the three boards
  and lands; Classic quickly, Gold with a gold burst and its headline, Diamond with the works), the stamps (DEAL!, NO
  DEAL!, SWAP!), and a big result's celebration (the headline over turning rays, the amount counted up; five times
  the stake and more). The lettering is the house's: big, italic, outlined in ink.
*/

const INK = '#0b1220'
const FACE = {
  gold: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]',
  green: 'bg-[linear-gradient(180deg,#eafff2_0%,#5cf59a_45%,#12a956_100%)]',
  red: 'bg-[linear-gradient(180deg,#fff0f1_0%,#ff7a88_42%,#d11830_100%)]',
  violet: 'bg-[linear-gradient(180deg,#f3eeff_0%,#b9a0ff_45%,#6a43e8_100%)]',
  ice: 'bg-[linear-gradient(180deg,#ffffff_0%,#bdf0ff_40%,#7aa8ff_75%,#c08cff_100%)]',
  rainbow: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
}
export type Face = keyof typeof FACE

export function Lettering({ text, face, className }: { text: string; face: Face; className: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight ${className}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] [-webkit-text-stroke:0.16em_#0b1220] [filter:drop-shadow(0_0.07em_0_#0b1220)]" style={{ color: INK }}>
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${FACE[face]}`}>{text}</span>
    </span>
  )
}

/** turning rays behind a moment */
function Rays({ colors, period = 18, size = 'min(150vw,980px)', opacity = 0.3 }: { colors: string[]; period?: number; size?: string; opacity?: number }) {
  const step = 360 / (colors.length * 2)
  const stops = colors.map((c, i) => `${c} ${i * 2 * step}deg ${(i * 2 + 0.7) * step}deg, transparent ${(i * 2 + 0.7) * step}deg ${(i * 2 + 2) * step}deg`).join(', ')
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-1/2 aspect-square -translate-x-1/2 -translate-y-1/2 rounded-full [mask-image:radial-gradient(circle,black_12%,transparent_55%)]"
      style={{ width: size, opacity, background: `repeating-conic-gradient(from 0deg, ${stops})` }}
      animate={{ rotate: 360 }}
      transition={{ duration: period, repeat: Infinity, ease: 'linear' }}
    />
  )
}

/** sparkles scattered over an area, twinkling */
function Sparkles({ n, color = '#fff' }: { n: number; color?: string }) {
  const pts = useRef(Array.from({ length: n }, (_, i) => ({ x: 8 + ((i * 37) % 84), y: 10 + ((i * 53) % 80), d: (i * 0.23) % 1.6, r: 1.6 + ((i * 7) % 4) * 0.5 }))).current
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {pts.map((p, i) => (
        <motion.svg key={i} className="absolute" width="16" height="16" viewBox="0 0 16 16" style={{ left: `${p.x}%`, top: `${p.y}%` }} initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: [0, 1, 0], scale: [0.3, 1, 0.3] }} transition={{ duration: 1.3, repeat: Infinity, delay: p.d }}>
          <Spark x={8} y={8} r={p.r} color={color} />
        </motion.svg>
      ))}
    </div>
  )
}

const ORDER: BoardId[] = ['classic', 'gold', 'diamond']

/**
 * The board's reveal: the badge flicks through the boards and lands on tonight's. Classic lands in about a second;
 * Gold and Diamond get their headline, a burst and a longer hold. Tap once it has landed to move on.
 */
export function BoardReveal({ board, narrow, onDone }: { board: BoardId; narrow: boolean; onDone: () => void }) {
  const [shown, setShown] = useState<BoardId>('classic')
  const [landed, setLanded] = useState(false)
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => {
    const flicks = board === 'classic' ? 6 : board === 'gold' ? 10 : 14
    // the flicks end on the board: count back from it
    const end = ORDER.indexOf(board)
    const seq = Array.from({ length: flicks }, (_, i) => ORDER[(((end - (flicks - 1 - i)) % 3) + 3) % 3])
    const timers: number[] = []
    let t = 0
    seq.forEach((b, i) => {
      const k = i / Math.max(1, flicks - 1)
      t += 55 + k * k * (board === 'classic' ? 150 : 240)
      timers.push(
        window.setTimeout(() => {
          setShown(b)
          if (i < flicks - 1) dealSfx.flick(i)
          else {
            setLanded(true)
            dealSfx.board(board)
          }
        }, t),
      )
    })
    const hold = board === 'classic' ? 650 : board === 'gold' ? 2300 : 3300
    timers.push(window.setTimeout(() => done.current(), t + hold))
    return () => timers.forEach(clearTimeout)
  }, [board])
  const t = TIERS[board]
  const rare = board !== 'classic'
  return (
    <motion.div
      className={`absolute inset-0 z-[35] flex items-center justify-center ${landed ? 'cursor-pointer' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.35 } }}
      onClick={() => landed && done.current()}
      role="status"
      aria-live="polite"
      aria-label={landed ? `Tonight's board: ${t.name}, top prize ${multText(topOf(board))}` : 'Drawing tonight’s board'}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse ${narrow ? '90% 50%' : '55% 45%'} at 50% 50%, rgba(5,7,16,.92) 0%, rgba(5,7,16,.78) 55%, rgba(5,7,16,.5) 100%)` }} />
      {landed && rare && <Rays colors={board === 'gold' ? ['#ffd45c'] : ['#9fe3ff', '#c9a8ff', '#ffd1f4']} period={board === 'gold' ? 20 : 12} opacity={board === 'gold' ? 0.28 : 0.38} />}
      {landed && board === 'diamond' && <Sparkles n={18} />}
      {landed && board === 'gold' && <Sparkles n={9} color="#fff3b8" />}
      <div className="relative flex flex-col items-center">
        <div className="mb-3 text-[11px] font-black uppercase tracking-[0.3em] text-white/60 sm:text-[13px]">Tonight's board</div>
        <motion.div key={shown} initial={{ rotateX: -80, opacity: 0.4 }} animate={{ rotateX: 0, opacity: 1, scale: landed ? [1, rare ? 1.25 : 1.1, 1] : 1 }} transition={{ duration: landed ? 0.5 : 0.08 }} style={{ transformPerspective: 400 }}>
          <TierBadge board={shown} size="lg" />
        </motion.div>
        {landed && rare && (
          <motion.div className="mt-4 flex flex-col items-center" initial={{ scale: 0.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 13, delay: 0.15 }}>
            <Lettering text={board === 'gold' ? 'GOLD BOARD!' : 'DIAMOND BOARD!'} face={board === 'gold' ? 'gold' : 'ice'} className={narrow ? 'text-[34px]' : 'text-[60px]'} />
            <div className="tnum mt-2 rounded-full bg-[#0b1220] px-3.5 py-1 text-[12px] font-black tracking-[0.12em] text-[#ffd45c] sm:text-[14px]">
              TOP PRIZE {multText(topOf(board))} · {oneIn(chanceOf(board)).toUpperCase()} GAMES
            </div>
          </motion.div>
        )}
        {landed && !rare && (
          <motion.div className="mt-3 text-[12px] font-bold text-white/60 sm:text-[13px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            Top prize {multText(topOf(board))}
          </motion.div>
        )}
      </div>
    </motion.div>
  )
}

/** DEAL!, NO DEAL! or SWAP!, slammed onto the stage */
export function Stamp({ text, face, narrow }: { text: string; face: Face; narrow: boolean }) {
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-[36] flex items-center justify-center" initial={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <motion.div className="absolute rounded-full border-[6px]" style={{ borderColor: face === 'green' ? '#5cf59a' : face === 'red' ? '#ff6b7a' : '#b9a0ff' }} initial={{ width: 40, height: 40, opacity: 0.9 }} animate={{ width: narrow ? 360 : 640, height: narrow ? 360 : 640, opacity: 0 }} transition={{ duration: 0.7, ease: 'easeOut' }} />
      <motion.div initial={{ scale: 2.6, rotate: -14, opacity: 0 }} animate={{ scale: 1, rotate: -7, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }}>
        <Lettering text={text} face={face} className={narrow ? 'text-[48px]' : 'text-[88px]'} />
      </motion.div>
    </motion.div>
  )
}

export const tierOf = (m: number) => (m >= 100 ? 3 : m >= 25 ? 2 : m >= 5 ? 1 : 0)
const HEADLINE = ['', 'BIG WIN!', 'HUGE WIN!', 'LEGENDARY!']
const COUNT_MS = [0, 1500, 2300, 3200]

/** a big result takes the stage: the headline over turning rays, the amount counted up; a tap closes it */
export function Celebration({ amount, mult, narrow, onDone }: { amount: number; mult: number; narrow: boolean; onDone: () => void }) {
  const tier = Math.max(1, tierOf(mult))
  const [v, setV] = useState(0)
  useEffect(() => {
    const c = animate(0, amount, {
      duration: COUNT_MS[tier] / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        dealSfx.tick(x / (amount || 1))
      },
    })
    const t = window.setTimeout(onDone, COUNT_MS[tier] + 2600)
    return () => {
      c.stop()
      clearTimeout(t)
    }
    // onDone is the page's, stable for the moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, tier])
  return (
    <motion.div className="absolute inset-0 z-[38] flex cursor-pointer items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} onClick={onDone}>
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(ellipse 70% 55% at 50% 50%, rgba(5,7,16,.85) 0%, rgba(5,7,16,.45) 60%, rgba(5,7,16,.1) 100%)' }} />
      <Rays colors={tier >= 3 ? ['#ff4fd8', '#ffe23d', '#2fd3ff'] : ['#ffd45c']} period={tier >= 3 ? 12 : 20} opacity={0.32} />
      {tier >= 2 && <Sparkles n={tier >= 3 ? 20 : 10} color={tier >= 3 ? '#fff' : '#fff3b8'} />}
      <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.3, y: 24 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <motion.div className={`mb-2 rounded-full bg-[#0b1220] font-black tracking-[0.2em] text-[#ffd45c] ${narrow ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[12.5px]'}`} initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.35, duration: 0.4 }}>
          {multText(mult)} YOUR STAKE
        </motion.div>
        <motion.div animate={{ scale: [1, 1.04, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <Lettering text={HEADLINE[tier]} face={tier >= 3 ? 'rainbow' : tier >= 2 ? 'red' : 'gold'} className={narrow ? 'text-[40px]' : 'text-[68px]'} />
        </motion.div>
        <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#0b1220] bg-white shadow-[0_6px_0_rgba(11,18,32,.45)] ${narrow ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
          <span className={`tnum flex items-center gap-1.5 font-black text-[#0b1220] ${narrow ? 'text-[20px]' : 'text-[30px]'}`}>
            {fmt(v)} <Coin size={narrow ? 18 : 26} />
          </span>
        </div>
        <div className="mt-2 rounded-full bg-black/45 px-2.5 py-0.5 text-[11px] font-bold text-white/70">Tap to continue</div>
      </motion.div>
    </motion.div>
  )
}

/** a prize card, as on the cases: blue for the low half, gold for the high half, the top prize iridescent; green for a deal */
const CHIP = {
  low: { bg: 'linear-gradient(180deg,#9fd3ff 0%,#3b93f5 42%,#1a55c4 100%)', ink: '#fff' },
  high: { bg: 'linear-gradient(180deg,#fff4c2 0%,#ffd04f 45%,#d9900c 100%)', ink: '#2a1600' },
  top: { bg: 'linear-gradient(110deg,#fff7d1 0%,#ffd04f 30%,#ff9fe0 62%,#8fd8ff 100%)', ink: '#2a1600' },
  deal: { bg: 'linear-gradient(180deg,#c8ffde 0%,#3ee584 45%,#0f9a4c 100%)', ink: '#04230f' },
}
export function PrizeChip({ text, tone, big }: { text: string; tone: keyof typeof CHIP; big?: boolean }) {
  return (
    <span
      className={`tnum inline-flex items-center justify-center gap-1 rounded-lg border-2 border-[#0b1220] font-black leading-none ${big ? 'min-w-[96px] px-3 py-1.5 text-[22px] sm:px-4 sm:py-2 sm:text-[30px]' : 'px-2 py-1 text-[15px] sm:text-[18px]'}`}
      style={{ background: CHIP[tone].bg, color: CHIP[tone].ink, boxShadow: '0 3px 0 rgba(11,18,32,.6), inset 0 1px 0 rgba(255,255,255,.5)' }}
    >
      {text}
    </span>
  )
}

/** the game's end on the big screen: what happened, what it paid, and Play again */
export function FinalScreen({ headline, face, rows, paid, mult, verdict, narrow, action }: { headline: string; face: Face; rows: ReactNode; paid: number; mult: number; verdict: string | null; narrow: boolean; action: ReactNode }) {
  return (
    <div className="relative w-full rounded-[22px] border-[3px] border-[#0b1220] p-[4px] shadow-[0_30px_70px_-20px_rgba(0,0,0,.9)]" style={{ background: 'linear-gradient(180deg,#fff0b0,#e8b23a 40%,#9a6508 100%)' }}>
      <div className="relative flex flex-col items-center overflow-hidden rounded-[17px] border-2 border-[#0b1220] px-3 pb-3 pt-3 sm:px-6 sm:pb-5 sm:pt-5" style={{ background: 'radial-gradient(ellipse 85% 65% at 50% 28%, #24407a 0%, #12204a 48%, #080e22 100%)' }}>
        <div className="pointer-events-none absolute inset-0 opacity-[.05] [background:repeating-linear-gradient(0deg,#fff_0,#fff_1px,transparent_1px,transparent_3px)]" />
        <div className="pointer-events-none absolute -top-[30%] left-1/2 h-[70%] w-[90%] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgba(255,220,140,.16),transparent)]" />
        <motion.div initial={{ scale: 0.4, rotate: -8, opacity: 0 }} animate={{ scale: 1, rotate: -3, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 14 }}>
          <Lettering text={headline} face={face} className={narrow ? 'text-[30px]' : 'text-[48px]'} />
        </motion.div>
        <div className={`relative flex w-full flex-col items-center ${narrow ? 'mt-2 gap-1.5' : 'mt-4 gap-2.5'}`}>{rows}</div>
        {verdict && <div className={`relative text-center font-extrabold text-white/85 ${narrow ? 'mt-2 text-[12.5px]' : 'mt-3 text-[14.5px]'}`}>{verdict}</div>}
        <div className="tnum relative mt-2 flex items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-[13px] font-black text-white ring-1 ring-white/10 sm:mt-3 sm:text-[15px]">
          {paid > 0 ? (
            <>
              Paid <span className="text-[#ffd45c]">{fmt(paid)}</span> <Coin size={15} /> <span className="text-white/50">· {multText(mult)} your stake</span>
            </>
          ) : (
            <span className="text-white/70">Nothing paid</span>
          )}
        </div>
        <div className={`relative w-full ${narrow ? 'mt-2.5' : 'mt-4'}`}>{action}</div>
      </div>
    </div>
  )
}
