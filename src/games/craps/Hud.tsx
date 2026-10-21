import { forwardRef, useEffect, useState } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { crapsSfx } from './sound'
import { FACE, Lettering, PuckGlyph, RedDie } from './art'
import { NUMBERS, totalOf, type Num } from './rules'
import type { PastRoll } from './storage'
import { rollWords, type Call } from './words'

/*
  What sits over the table: the strip of the last rolls (each total coloured by what it did: a natural, craps, the
  point set, the point made, a seven-out), the point and the shooter's progress, the stickman's call in a speech
  bubble over the dice, what the roll came to, the celebration of a big win (and of the Fire Bet), and the gentle
  hints that walk a newcomer through a first hand.
*/

/** what a past roll's pill looks like: its fill and ink */
function tone(r: PastRoll): { bg: string; ink: string; ring?: string } {
  switch (r.event) {
    case 'natural':
      return { bg: '#17a673', ink: '#fff' }
    case 'craps':
      return { bg: '#7a3e9d', ink: '#fff' }
    case 'point-set':
      return { bg: 'rgba(241,230,200,.1)', ink: '#f1e6c8', ring: 'rgba(241,230,200,.7)' }
    case 'point-made':
      return { bg: '#f7c548', ink: '#2a1c00' }
    case 'seven-out':
      return { bg: '#e0473f', ink: '#fff' }
    default:
      return { bg: 'rgba(255,255,255,.1)', ink: 'rgba(255,255,255,.78)' }
  }
}

const EVENT_WORD: Record<PastRoll['event'], string> = { natural: 'Natural', craps: 'Craps', 'point-set': 'Point set', 'point-made': 'Point made', 'seven-out': 'Seven out', roll: '' }

/** the last rolls, newest first: the latest as its two dice (unless `bare`), then a pill per roll */
export function RollStrip({ rolls, max, bare, size = 26 }: { rolls: readonly PastRoll[]; max: number; bare?: boolean; size?: number }) {
  const list = rolls.slice(-max).reverse()
  const last = list[0]
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {!bare && last && (
        <motion.div key={last.t} className="flex shrink-0 items-center gap-1 rounded-full bg-black/45 py-1 pl-1 pr-2 ring-1 ring-white/10" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
          <RedDie n={last.dice[0]} size={size - 6} />
          <RedDie n={last.dice[1]} size={size - 6} />
        </motion.div>
      )}
      <div className="no-scrollbar flex min-w-0 gap-1 overflow-hidden" aria-label={list.length ? 'Last rolls' : 'No rolls yet'}>
        <AnimatePresence initial={false}>
          {list.map((r) => {
            const t = tone(r)
            const hard = r.dice[0] === r.dice[1]
            return (
              <motion.span
                key={r.t}
                layout="position"
                initial={{ opacity: 0, scale: 0.5, x: -10 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.5 }}
                transition={{ type: 'spring', stiffness: 520, damping: 32 }}
                className="tnum relative flex shrink-0 items-center justify-center rounded-[9px] font-black leading-none"
                style={{ width: size, height: size, fontSize: size * 0.46, background: t.bg, color: t.ink, boxShadow: `${t.ring ? `inset 0 0 0 1.5px ${t.ring},` : ''} inset 0 -2px 0 rgba(0,0,0,.18)` }}
                title={`${rollWords(r.dice, r.event, r.point)}${EVENT_WORD[r.event] ? ` (${EVENT_WORD[r.event]})` : ''}`}
              >
                {totalOf(r.dice)}
                {hard && totalOf(r.dice) !== 2 && totalOf(r.dice) !== 12 && <span className="absolute bottom-[3px] left-1/2 h-[2px] w-2.5 -translate-x-1/2 rounded-full" style={{ background: t.ink, opacity: 0.7 }} />}
              </motion.span>
            )
          })}
        </AnimatePresence>
        {/* before the first roll: the strip's empty places, faint */}
        {!list.length &&
          Array.from({ length: Math.min(5, max) }, (_, i) => (
            <span key={i} className="shrink-0 rounded-[9px] ring-1 ring-inset ring-white/[0.07]" style={{ width: size, height: size, background: 'rgba(255,255,255,.035)', opacity: 1 - i * 0.16 }} aria-hidden />
          ))}
      </div>
    </div>
  )
}

/** the point (the puck), the shooter's roll and the points made so far (the Fire Bet counts them) */
export function PointReadout({ point, rolls, points, compact }: { point: Num | null; rolls: number; points: readonly Num[]; compact?: boolean }) {
  const dots = (
    <span className="flex gap-[3px]" title="Points made by this shooter (the Fire Bet counts them)">
      {NUMBERS.map((n) => (
        <span key={n} className={`rounded-[2px] ${compact ? 'h-[5px] w-[5px]' : 'h-[7px] w-[7px]'} ${points.includes(n) ? 'bg-[#ff8a1f] shadow-[0_0_6px_#ff8a1f]' : 'bg-white/15'}`} />
      ))}
    </span>
  )
  const shooter = rolls ? `${rolls} roll${rolls > 1 ? 's' : ''}` : 'New'
  return (
    <div className={`flex items-center rounded-2xl bg-black/50 ring-1 ring-white/10 backdrop-blur-[2px] ${compact ? 'gap-1.5 py-1 pl-1 pr-2' : 'gap-2.5 py-1.5 pl-1.5 pr-3'}`}>
      <motion.span key={point ?? 'off'} initial={{ scale: 1.4, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 420, damping: 16 }}>
        <PuckGlyph on={point !== null} size={compact ? 24 : 32} />
      </motion.span>
      <div className="leading-none">
        <div className={`font-black uppercase tracking-[0.14em] ${compact ? 'text-[8.5px]' : 'text-[10px]'} ${point ? 'text-gold' : 'text-white/55'}`}>{point ? 'Point' : 'Come-out'}</div>
        <div className={`tnum font-black text-ink ${compact ? 'mt-0.5 text-[15px]' : 'mt-1 text-[21px]'}`}>{point ?? 'Roll'}</div>
      </div>
      {compact ? (
        // on a phone: the shooter's rolls and points made, small, beside the point
        <div className="ml-0.5 border-l border-white/10 pl-1.5 leading-none" aria-label={`Shooter: ${shooter}, ${points.length} point${points.length === 1 ? '' : 's'} made`}>
          <div className="tnum text-[10px] font-extrabold text-white/75">{shooter}</div>
          <div className="mt-1">{dots}</div>
        </div>
      ) : (
        <div className="ml-1 border-l border-white/10 pl-2.5 leading-none">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/50">Shooter</div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="tnum text-[12px] font-extrabold text-white/80">{shooter}</span>
            {dots}
          </div>
        </div>
      )}
    </div>
  )
}

/** the stickman's call, in a speech bubble over the dice; the screen moves it (the ref) to follow them */
export const StickBubble = forwardRef<HTMLDivElement, { call: Call; narrow: boolean }>(function StickBubble({ call, narrow }, ref) {
  const ink = call.tone === 'win' ? '#0f6b47' : call.tone === 'lose' ? '#a3241c' : call.tone === 'point' ? '#7a5200' : '#1d2a24'
  return (
    <div ref={ref} className="pointer-events-none absolute left-0 top-0 z-[26]" style={{ willChange: 'transform' }}>
      <motion.div
        className="relative -translate-x-1/2 -translate-y-full"
        initial={{ opacity: 0, scale: 0.6, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 520, damping: 22 }}
        style={{ transformOrigin: '50% 100%' }}
      >
        <div className={`flex items-center gap-2 rounded-2xl border-[2.5px] border-[#0b1f16] bg-[linear-gradient(180deg,#fffdf6,#f3ead2)] shadow-[0_4px_0_rgba(11,31,22,.45),0_16px_30px_-12px_rgba(0,0,0,.8)] ${narrow ? 'py-1 pl-1 pr-2.5' : 'py-1.5 pl-1.5 pr-3.5'}`}>
          {/* the stickman: a gold disc with his hooked stick */}
          <span className={`flex shrink-0 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#fff1b8,#e6bd62_55%,#a8771f)] ring-2 ring-[#0b1f16] ${narrow ? 'h-7 w-7' : 'h-9 w-9'}`}>
            <svg viewBox="0 0 24 24" className={narrow ? 'h-4 w-4' : 'h-5 w-5'} fill="none" stroke="#3a2200" strokeWidth="2.2" strokeLinecap="round">
              <path d="M5 20 16.5 6.5" />
              <path d="M16.5 6.5c1.4-1.6 3.8-.6 3.3 1.4-.3 1.2-1.6 1.6-2.6 1" />
            </svg>
          </span>
          <span className="min-w-0">
            <span className={`block whitespace-nowrap font-black italic leading-tight ${narrow ? 'text-[15px]' : 'text-[19px]'}`} style={{ color: ink }}>
              {call.big}
            </span>
            {call.small && <span className={`block whitespace-nowrap font-extrabold leading-tight text-[#4a5a52] ${narrow ? 'text-[10px]' : 'text-[11.5px]'}`}>{call.small}</span>}
          </span>
        </div>
        {/* the tail, down toward the dice */}
        <svg className="absolute left-1/2 top-full -mt-[3px] -translate-x-1/2" width="22" height="13" viewBox="0 0 22 13" aria-hidden>
          <path d="M1 1 L11 11.5 L21 1" fill="#f3ead2" stroke="#0b1f16" strokeWidth="2.5" strokeLinejoin="round" />
          <rect x="2" y="-2" width="18" height="3.4" fill="#f3ead2" />
        </svg>
      </motion.div>
    </div>
  )
})

/** what the roll came to: won, lost or even (a roll that decided nothing shows nothing) */
export function NetPill({ net, narrow }: { net: number; narrow: boolean }) {
  const won = net > 0
  const lost = net < 0
  return (
    <motion.div
      className={`tnum pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full font-black leading-none ${narrow ? 'px-2.5 py-1 text-[13px]' : 'px-3.5 py-1.5 text-[16px]'} ${
        won ? 'border-[2.5px] border-[#0b1f16] bg-[linear-gradient(180deg,#fff6d6,#ffe08a_55%,#f2b53a)] text-[#2a1600] shadow-[0_4px_0_rgba(11,31,22,.45),0_12px_26px_-10px_rgba(0,0,0,.8)]' : lost ? 'bg-black/70 text-[#ffb3a8] ring-1 ring-[#e0473f]/45' : 'bg-black/65 text-white/80 ring-1 ring-white/15'
      }`}
      initial={{ opacity: 0, y: 10, scale: 0.7 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 440, damping: 20 }}
    >
      {won ? (
        <>
          <span className={`rounded-full bg-[#0b1f16] px-1.5 py-[3px] tracking-[0.18em] text-gold ${narrow ? 'text-[8.5px]' : 'text-[9.5px]'}`}>WIN</span>+{fmt(net)}
          <Coin size={narrow ? 13 : 16} />
        </>
      ) : lost ? (
        <>−{fmt(-net)}</>
      ) : (
        <>Even</>
      )}
    </motion.div>
  )
}

/** a number that counts up to `to` over `ms`, ticking as it goes */
function useCount(to: number, ms: number) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let last = 0
    const c = animate(0, to, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        const now = performance.now()
        if (now - last > 70) {
          last = now
          crapsSfx.count(x / (to || 1))
        }
      },
    })
    return () => c.stop()
  }, [to, ms])
  return v
}

/** the win tier of a roll that returned `x` times the stakes it decided (and the Fire Bet has its own) */
export const tierOf = (x: number) => (x >= 100 ? 3 : x >= 25 ? 2 : x >= 10 ? 1 : 0)
const TIER_NAME = ['', 'BIG WIN!', 'HUGE WIN!', 'MASSIVE WIN!']
/** how long each tier's celebration counts the win up (ms); the Fire Bet's as tier 3 */
export const TIER_COUNT = [0, 1600, 2300, 3200]

/**
 * A big win's moment over the table: the tier's lettering (or FIRE BET! with the points it took) over turning rays,
 * the amount counted up. A tap closes it.
 */
export function Celebration({ tier, fire, amount, narrow, top, onDone }: { tier: number; fire: number; amount: number; narrow: boolean; top: number; onDone: () => void }) {
  const counted = useCount(amount, TIER_COUNT[fire ? 3 : tier])
  const big = fire > 0 || tier >= 3
  return (
    <motion.div className="pointer-events-auto absolute inset-0 z-[32] cursor-pointer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} onClick={onDone}>
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse ${narrow ? '80% 36%' : '50% 32%'} at 50% ${top + (narrow ? 58 : 86)}px, rgba(4,16,10,.72) 0%, rgba(4,16,10,.34) 55%, transparent 85%)` }}
      />
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top }}>
        <motion.div
          className="absolute left-1/2 top-1/2 aspect-square w-[min(130vw,880px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 [mask-image:radial-gradient(circle,black_14%,transparent_52%)]"
          style={{
            background: fire
              ? 'repeating-conic-gradient(from 0deg, #ff7a1a 0deg 9deg, transparent 9deg 20deg, #ffd23d 20deg 27deg, transparent 27deg 40deg)'
              : 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 9deg, transparent 9deg 22deg)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: big ? 14 : 22, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.4, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          {fire > 0 && (
            <motion.div
              className={`mb-2 rounded-full bg-[#2a0c00] font-black tracking-[0.2em] text-[#ffb36b] ${narrow ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[13px]'}`}
              initial={{ scale: 0 }}
              animate={{ scale: [0, 1.15, 1] }}
              transition={{ delay: 0.35, duration: 0.4 }}
            >
              {fire} POINTS MADE
            </motion.div>
          )}
          <motion.div animate={{ scale: [1, 1.05, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            <Lettering text={fire ? 'FIRE BET!' : TIER_NAME[tier]} face={fire ? FACE.fire : FACE.gold} size={big ? (narrow ? 'text-[38px]' : 'text-[74px]') : narrow ? 'text-[34px]' : 'text-[60px]'} />
          </motion.div>
          <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#0b1f16] bg-white shadow-[0_6px_0_rgba(11,31,22,.45)] ${narrow ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
            <span className={`tnum flex items-center gap-1.5 font-black text-[#0b1f16] ${narrow ? 'text-[19px]' : 'text-[28px]'}`}>
              +{fmt(counted)} <Coin size={narrow ? 18 : 24} />
            </span>
          </div>
        </motion.div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11.5px] font-bold text-white/55">Tap to continue</div>
    </motion.div>
  )
}

/**
 * A newcomer's hint: a small card standing on the board's top edge (`x`: its middle, `y`: its foot, px), kept inside
 * the stage's width `W`, while the spot it is about breathes on the board. It never covers the board, and only its
 * "Got it" (which puts the hints away for good) takes a tap.
 */
export function CoachMark({ x, y, W, title, sub, onClose }: { x: number; y: number; W: number; title: string; sub?: string; onClose: () => void }) {
  const w = Math.min(W < 500 ? 300 : 380, W - 16)
  const left = Math.max(8, Math.min(W - w - 8, x - w / 2))
  return (
    <motion.div
      className="pointer-events-none absolute z-[28]"
      style={{ left, top: y, width: w }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 380, damping: 26 }}
    >
      <div className="absolute bottom-0 left-0 w-full">
        <div className="flex items-start gap-2.5 rounded-xl border border-[#ffe08a]/45 bg-[#0b1f16]/92 px-3 py-2 shadow-[0_14px_30px_-10px_rgba(0,0,0,.85)] backdrop-blur-[2px]">
          <span className="mt-[3px] flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full bg-[#ffe08a] text-[11px] font-black text-[#2a1c00]" aria-hidden>
            ?
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-extrabold leading-snug text-[#ffe08a]">{title}</div>
            {sub && <div className="mt-0.5 text-[11.5px] font-semibold leading-snug text-white/72">{sub}</div>}
          </div>
          <button onClick={onClose} className="pointer-events-auto -mr-1 -mt-0.5 shrink-0 rounded-md px-1.5 py-1 text-[11px] font-extrabold text-white/55 transition hover:bg-white/10 hover:text-white" aria-label="Hide the tips">
            Got it
          </button>
        </div>
      </div>
    </motion.div>
  )
}
