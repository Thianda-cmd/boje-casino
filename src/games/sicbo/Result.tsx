import { useEffect, useState } from 'react'
import { animate, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { DieFace, FACE, Lettering } from './art'
import { SIZE_COLOR } from './Roads'
import { describe, sorted, type Dice } from './rules'

/*
  What a roll came to, on the stage: the readout of the dice (sorted, with the total, Small / Big / Triple and Odd /
  Even), in three sizes for the stage's three arrangements; the win plate; and the celebration of a big win, whose
  tier is the payout over the whole stake (15× Big win, 50× Huge win, 200× Legendary).
*/

export type ReadoutVariant = 'card' | 'bar' | 'mini'

/** the win tier for a payout of `x` times the stake */
export const tierOf = (x: number) => (x >= 200 ? 3 : x >= 50 ? 2 : x >= 15 ? 1 : 0)
const TIER_NAME = ['', 'BIG WIN!', 'HUGE WIN!', 'LEGENDARY!']
/** how long each tier's celebration counts the win up (ms) */
export const TIER_COUNT = [0, 1700, 2500, 3600]

function Tag({ kind, small }: { kind: 'small' | 'big' | 'triple' | 'odd' | 'even'; small?: boolean }) {
  const color = kind === 'small' || kind === 'big' || kind === 'triple' ? SIZE_COLOR[kind] : null
  return (
    <span
      className={`rounded-md font-black uppercase leading-none tracking-wider ${small ? 'px-1 py-[3px] text-[9px]' : 'px-1.5 py-1 text-[10.5px]'}`}
      style={color ? { background: color, color: kind === 'triple' ? '#2a1c00' : '#fff' } : { background: 'rgba(255,255,255,.14)', color: 'rgba(255,255,255,.85)' }}
    >
      {kind}
    </span>
  )
}

/** the dice of a roll and what they make; `live` is the roll just revealed, otherwise it is the last one, dimmer */
export function Readout({ dice, live, rolling, variant }: { dice: Dice | null; live: boolean; rolling: boolean; variant: ReadoutVariant }) {
  const d = dice ? describe(dice) : null
  const tags = d ? (d.size === 'triple' ? (['triple'] as const) : ([d.size, d.parity] as const)) : []
  const dieSize = variant === 'card' ? 34 : variant === 'bar' ? 22 : 14
  const faces = dice ? sorted(dice) : null
  const diceRow = (
    <span className={`flex ${variant === 'mini' ? 'gap-[3px]' : 'gap-1.5'}`}>
      {[0, 1, 2].map((i) =>
        rolling || !faces ? (
          <motion.span
            key={`q${i}`}
            className="flex items-center justify-center rounded-[22%] bg-white/10 font-black text-white/40"
            style={{ width: dieSize, height: dieSize * 1.06, fontSize: dieSize * 0.5 }}
            animate={rolling ? { opacity: [0.4, 1, 0.4] } : { opacity: 0.6 }}
            transition={rolling ? { duration: 0.9, repeat: Infinity, delay: i * 0.15 } : undefined}
          >
            ?
          </motion.span>
        ) : (
          <motion.span
            key={`${faces.join('')}-${i}`}
            initial={live ? { scale: 0.4, opacity: 0, y: -6 } : false}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08, type: 'spring', stiffness: 520, damping: 20 }}
          >
            <DieFace n={faces[i]} size={dieSize} />
          </motion.span>
        ),
      )}
    </span>
  )
  const state = rolling ? 'Rolling…' : live ? 'Result' : dice ? 'Last roll' : 'No rolls yet'

  if (variant === 'card')
    return (
      <div className={`rounded-2xl px-3.5 py-3 ring-1 backdrop-blur-[2px] transition-colors duration-500 ${live && !rolling ? 'bg-[#1c0d08]/80 ring-gold/45' : 'bg-[#12070a]/70 ring-white/10'}`}>
        <div className={`text-[10.5px] font-black uppercase tracking-[0.16em] ${live && !rolling ? 'text-gold' : 'text-white/50'}`}>{state}</div>
        <div className="mt-2">{diceRow}</div>
        {/* the total and what it makes (a placeholder while the dice roll; nothing before the first roll) */}
        {(d || rolling) && (
          <div className="mt-2.5 flex items-center gap-2">
            <motion.span
              key={d && !rolling ? `${d.total}-${live}` : 'none'}
              initial={live ? { scale: 1.5, opacity: 0 } : false}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.22, type: 'spring', stiffness: 420, damping: 18 }}
              className={`tnum text-[32px] font-black leading-none ${d && !rolling ? 'text-ink' : 'text-white/25'}`}
            >
              {d && !rolling ? d.total : '··'}
            </motion.span>
            {!rolling && (
              <span className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <Tag key={t} kind={t} />
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    )

  if (variant === 'bar')
    return (
      <div className={`flex items-center gap-2 rounded-full py-1 pl-1.5 pr-2 ring-1 backdrop-blur-[2px] ${live && !rolling ? 'bg-[#1c0d08]/85 ring-gold/45' : 'bg-[#12070a]/75 ring-white/10'}`}>
        {diceRow}
        {d && !rolling && <span className="tnum text-[18px] font-black leading-none text-ink">{d.total}</span>}
        {!rolling && tags.map((t) => <Tag key={t} kind={t} small />)}
        {!d && !rolling && <span className="pr-1 text-[11px] font-extrabold text-white/50">No rolls yet</span>}
      </div>
    )

  return (
    <div className={`flex flex-col items-center gap-1 rounded-xl px-1.5 py-1.5 ring-1 ${live && !rolling ? 'bg-[#1c0d08]/85 ring-gold/45' : 'bg-[#12070a]/70 ring-white/10'}`}>
      <span className={`text-[8.5px] font-black uppercase tracking-[0.12em] ${live && !rolling ? 'text-gold' : 'text-white/45'}`}>{rolling ? 'Rolling' : live ? 'Result' : 'Last'}</span>
      {diceRow}
      {d && !rolling && (
        <span className="flex items-center gap-1">
          <span className="tnum text-[15px] font-black leading-none text-ink">{d.total}</span>
          <Tag kind={tags[0]} small />
        </span>
      )}
      {d && !rolling && tags[1] && <Tag kind={tags[1]} small />}
    </div>
  )
}

/** a number that counts up to `to` over `ms`, ticking as it goes */
function useCount(to: number, ms: number) {
  const [v, setV] = useState(ms > 0 ? 0 : to)
  useEffect(() => {
    if (ms <= 0) return setV(to)
    let last = 0
    const c = animate(0, to, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        const now = performance.now()
        if (now - last > 70) {
          last = now
          sfx.sicbo.count(x / (to || 1))
        }
      },
    })
    return () => c.stop()
  }, [to, ms])
  return v
}

/**
 * The win: what came back and how many times the stake. 'md' in the desktop side column, 'sm' over the dome, 'line'
 * (one row, for a phone) under the dice, at the foot of the dome.
 */
export function WinPlate({ amount, stake, size }: { amount: number; stake: number; size: 'md' | 'sm' | 'line' }) {
  const enter = {
    initial: { opacity: 0, y: 14, scale: 0.7 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, scale: 0.94, transition: { duration: 0.2 } },
    transition: { type: 'spring' as const, stiffness: 420, damping: 20 },
  }
  if (size === 'line')
    return (
      <motion.div
        {...enter}
        className="tnum pointer-events-none flex items-center gap-2 whitespace-nowrap rounded-full border-[3px] border-[#1d0f30] bg-[linear-gradient(180deg,#fff6d6,#ffe08a_55%,#f2b53a)] py-1 pl-1.5 pr-3 font-black leading-none text-[#2a1600] shadow-[0_4px_0_rgba(29,15,48,.5),0_14px_30px_-10px_rgba(0,0,0,.8)]"
      >
        <span className="rounded-full bg-[#1d0f30] px-2 py-[3px] text-[10px] tracking-[0.2em] text-gold">WIN</span>
        <span className="flex items-center gap-1 text-[18px]">
          {fmt(amount)} <Coin size={15} />
        </span>
        <span className="text-[11.5px] font-extrabold text-[#6b3d00]">{timesText(amount / stake)}</span>
      </motion.div>
    )
  const md = size === 'md'
  return (
    <motion.div {...enter} className="pointer-events-none flex flex-col items-center">
      <div className="relative z-10 mb-[-9px] rounded-full bg-[#1d0f30] px-3 py-0.5 text-[11px] font-black tracking-[0.24em] text-gold sm:text-[12px]">WIN</div>
      <div
        className={`tnum flex items-center gap-1.5 whitespace-nowrap rounded-2xl border-[3px] border-[#1d0f30] bg-[linear-gradient(180deg,#fff6d6,#ffe08a_55%,#f2b53a)] font-black leading-none text-[#2a1600] shadow-[0_5px_0_rgba(29,15,48,.5),0_18px_40px_-12px_rgba(0,0,0,.8)] ${md ? 'px-4 pb-2 pt-3 text-[25px]' : 'px-3.5 pb-1.5 pt-2.5 text-[19px]'}`}
      >
        {fmt(amount)} <Coin size={md ? 22 : 17} />
      </div>
      <div className={`tnum mt-1.5 rounded-full bg-black/55 px-2.5 py-0.5 font-extrabold text-white/85 ${md ? 'text-[11.5px]' : 'text-[10.5px]'}`}>{timesText(amount / stake)} your bet</div>
    </motion.div>
  )
}

/** a multiple of the stake as the banners print it: "26×", "14.4×", "312×" */
const timesText = (x: number) => {
  const r = Math.round(x * 10) / 10
  return `${fmt(r, Number.isInteger(r) || r >= 100 ? 0 : 1)}×`
}

/**
 * A big win's moment: the tier's lettering over turning sun rays and the amount counted up, high in the room (`top`,
 * px from the top of its area) so the dice stay in view under it; a tap closes it.
 */
export function Celebration({ tier, amount, stake, narrow, top, onDone }: { tier: number; amount: number; stake: number; narrow: boolean; top: number; onDone: () => void }) {
  const counted = useCount(amount, TIER_COUNT[tier])
  const legend = tier >= 3
  return (
    <motion.div className="absolute inset-0 z-[32] cursor-pointer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }} onClick={onDone}>
      {/* a soft dark pool behind the lettering, fading out before the dice */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse ${narrow ? '75% 34%' : '48% 30%'} at 50% ${top + (narrow ? 60 : 90)}px, rgba(20,4,8,.66) 0%, rgba(20,4,8,.3) 55%, transparent 85%)` }}
      />
      <div className="pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center" style={{ top }}>
        <motion.div
          className="absolute left-1/2 top-1/2 aspect-square w-[min(130vw,900px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 [mask-image:radial-gradient(circle,black_14%,transparent_52%)]"
          style={{
            background: legend
              ? 'repeating-conic-gradient(from 0deg, #ff4fd8 0deg 8deg, transparent 8deg 20deg, #ffe23d 20deg 28deg, transparent 28deg 40deg, #2fd3ff 40deg 48deg, transparent 48deg 60deg)'
              : 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 9deg, transparent 9deg 22deg)',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: legend ? 14 : 22, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.4, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
          <motion.div
            className={`mb-2 rounded-full bg-[#1d0f30] font-black tracking-[0.22em] text-gold ${narrow ? 'px-3 py-0.5 text-[10.5px]' : 'px-3.5 py-1 text-[13px]'}`}
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.15, 1] }}
            transition={{ delay: 0.35, duration: 0.4 }}
          >
            {timesText(amount / stake)} YOUR BET
          </motion.div>
          <motion.div animate={{ scale: [1, 1.05, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
            <Lettering text={TIER_NAME[tier]} face={tier >= 2 ? FACE.rainbow : FACE.gold} size={legend ? (narrow ? 'text-[38px]' : 'text-[76px]') : narrow ? 'text-[34px]' : 'text-[62px]'} />
          </motion.div>
          <div className={`flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white shadow-[0_6px_0_rgba(29,15,48,.45)] ${narrow ? 'mt-2 px-3 py-1' : 'mt-3 px-4 py-1.5'}`}>
            <span className={`tnum flex items-center gap-1.5 font-black text-[#1d0f30] ${narrow ? 'text-[19px]' : 'text-[28px]'}`}>
              {fmt(counted)} <Coin size={narrow ? 18 : 24} />
            </span>
          </div>
        </motion.div>
      </div>
      <div className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11.5px] font-bold text-white/55">Tap to continue</div>
    </motion.div>
  )
}
