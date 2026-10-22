import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coin } from '../../components/icons'
import { AnimatedNumber } from '../../components/ui'
import { fmt } from '../../lib/format'
import { MAX_MULT, ROUTES, nextMultiplier, type RouteId } from './rules'
import { RouteGlyph } from './art'
import { LOOK, multText, passesCap, pct } from './words'

/*
  The deck along the bottom of the stage: the four route cards and (on a wide stage) the big button beside them.

  Each card is a route's whole offer for the next pitch: its chance of holding (and a bar of it), the multiplier the
  climb would make if it holds, and what that would bank in coins. The riskier the route the more the card burns: the
  Cliff smoulders orange, the Sheer Wall throbs red over hazard stripes. A card whose pitch would pass the 10,000×
  cap says so (the cap is all it can make). Pointing at a card lights its line on the mountain; the keys 1 to 4 pick
  them. The big button is Start (or Play again) before a climb and Bank during one, gold, with the coins it pays
  now: the figure bounces each time it grows, and a ring breathes round it.
*/

export function RouteCard({
  r,
  i,
  path,
  stake,
  enabled,
  hot,
  narrow,
  keys,
  onPick,
  onHover,
}: {
  r: RouteId
  i: number
  path: readonly RouteId[]
  stake: number
  enabled: boolean
  hot: boolean
  narrow: boolean
  keys: boolean
  onPick: (r: RouteId) => void
  onHover: (r: RouteId | null) => void
}) {
  const route = ROUTES[i]
  const L = LOOK[r]
  const m = nextMultiplier(path, r)
  const capped = passesCap(path, r)
  const coins = Math.floor(stake * m * 100 + 1e-6) / 100
  const k = path.length + 1
  const label = `${route.name}: holds ${pct(route.p)} of the time; if it holds the climb makes ${multText(m)}${capped ? ' (the 10,000× cap)' : ''}, ${fmt(coins)} coins at ${k >= 10 ? 'the summit' : `Camp ${k}`}`
  const stripes = i === 3 ? 'repeating-linear-gradient(135deg, rgba(255,90,110,.11) 0 9px, transparent 9px 18px)' : undefined
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={!enabled}
      onClick={() => onPick(r)}
      onMouseEnter={() => onHover(r)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(r)}
      onBlur={() => onHover(null)}
      initial={false}
      animate={{ y: hot && enabled ? -5 : 0 }}
      whileTap={enabled ? { scale: 0.96 } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
      className={`relative flex h-full min-w-0 flex-1 flex-col overflow-hidden text-left outline-none transition-[filter,opacity] focus-visible:ring-2 focus-visible:ring-white ${narrow ? 'rounded-xl' : 'rounded-2xl'} ${enabled ? 'cursor-pointer' : 'cursor-default'} ${!enabled ? 'opacity-[.62] saturate-[.7]' : ''}`}
      style={{
        background: `linear-gradient(168deg, ${L.b} 0%, #101b2e 58%, #0a1220 100%)`,
        boxShadow: hot && enabled ? `0 0 0 2px ${L.a}, 0 14px 34px -10px ${L.glow}, inset 0 1px 0 rgba(255,255,255,.18)` : `inset 0 0 0 1.5px ${L.a}66, inset 0 1px 0 rgba(255,255,255,.12)`,
      }}
    >
      {stripes && <span className="pointer-events-none absolute inset-0" style={{ background: stripes }} />}
      {i >= 2 && <span className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ boxShadow: `inset 0 0 ${i === 3 ? 26 : 16}px ${L.glow}`, animation: `summit-throb ${i === 3 ? 1.05 : 1.7}s ease-in-out infinite` }} />}
      <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/[.07] to-transparent" />
      {capped && narrow && <span className="absolute right-1 top-1 rounded bg-gold px-1 text-[8.5px] font-black uppercase leading-[13px] text-[#2a1c00]">cap</span>}
      {narrow ? (
        <div className="relative flex h-full flex-col items-center justify-between px-1 pb-1.5 pt-1.5 text-center">
          <div className="flex items-center gap-1">
            <RouteGlyph id={r} size={20} />
            <span className="truncate text-[11.5px] font-black text-white">{r === 'wall' ? 'Wall' : route.name}</span>
          </div>
          <div className={`tnum font-black leading-none ${capped || m >= 1000 ? 'text-[14px]' : 'text-[17px]'}`} style={{ color: L.a }}>
            {capped ? multText(MAX_MULT) : multText(m)}
          </div>
          <div className="w-full px-1">
            <div className="tnum text-[11px] font-extrabold leading-none text-white">{pct(route.p)}</div>
            <div className="mx-auto mt-1 h-1 w-full overflow-hidden rounded-full bg-black/45">
              <div className="h-full rounded-full" style={{ width: pct(route.p), background: L.a }} />
            </div>
          </div>
        </div>
      ) : (
        <div className="relative flex h-full flex-col">
          <div className="flex items-center gap-2 px-2.5 pt-2.5">
            <span className="relative shrink-0">
              <RouteGlyph id={r} size={32} />
              {keys && <kbd className="absolute -bottom-1 -right-1 flex h-[15px] min-w-[15px] items-center justify-center rounded-[5px] bg-[#0b1220] px-0.5 text-[9.5px] font-black leading-none text-white/80 ring-1 ring-white/25">{i + 1}</kbd>}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-black leading-tight text-white">{route.name}</div>
              <div className={`truncate text-[10.5px] font-bold leading-tight ${capped ? 'text-gold' : 'text-white/55'}`}>{capped ? 'Hits the cap' : route.line}</div>
            </div>
          </div>
          <div className="mt-auto px-2.5">
            <div className="tnum flex items-baseline gap-1 text-[25px] font-black leading-none" style={{ color: L.a }}>
              {capped ? multText(MAX_MULT) : multText(m)}
            </div>
            <div className="tnum mt-0.5 flex items-center gap-1 text-[11.5px] font-bold text-white/60">
              {fmt(coins)} <Coin size={11} />
            </div>
          </div>
          <div className="px-2.5 pb-2.5 pt-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.12em] text-white/45">
              <span>Holds</span>
              <span className="tnum text-[12px] tracking-normal text-white">{pct(route.p)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/45">
              <div className="h-full rounded-full" style={{ width: pct(route.p), background: `linear-gradient(90deg, ${L.b}, ${L.a})` }} />
            </div>
          </div>
        </div>
      )}
    </motion.button>
  )
}

export type BigKind = 'start' | 'bank' | 'wait' | 'stop'

/** the deck's big button: Start (or Play again), Bank with what it pays now, a waiting state, or Stop for auto */
export function BigButton({ kind, title, amount, sub, onClick, disabled }: { kind: BigKind; title: ReactNode; amount?: number; sub?: ReactNode; onClick?: () => void; disabled?: boolean }) {
  const tone =
    kind === 'start'
      ? 'bg-[linear-gradient(180deg,#3cec88,#18b85c)] text-[#032412] shadow-[0_12px_30px_-12px_rgba(34,211,111,.9),inset_0_-4px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.45)]'
      : kind === 'bank'
        ? 'bg-[linear-gradient(180deg,#ffe07a,#f2b630)] text-[#2a1800] shadow-[0_12px_30px_-10px_rgba(247,197,72,.95),inset_0_-4px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.55)]'
        : kind === 'stop'
          ? 'bg-danger text-white shadow-[inset_0_-4px_0_rgba(0,0,0,.2)]'
          : 'bg-raised text-ink/80 shadow-[inset_0_-4px_0_rgba(0,0,0,.2)]'
  const live = kind === 'bank' && !disabled
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.97 }}
      className={`relative flex h-full w-full flex-col items-center justify-center overflow-visible rounded-2xl px-3 text-center transition disabled:cursor-not-allowed ${tone} ${disabled ? 'opacity-55' : 'hover:brightness-105'}`}
    >
      {live && (
        <motion.span
          className="pointer-events-none absolute inset-0 rounded-2xl"
          animate={{ boxShadow: ['0 0 0 0 rgba(255,214,90,.55)', '0 0 0 12px rgba(255,214,90,0)'] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className={`font-black uppercase leading-tight ${amount == null && (kind === 'start' || kind === 'stop') ? 'text-[19px] tracking-[0.06em]' : 'text-[13px] tracking-[0.16em] opacity-80'}`}>{title}</span>
      {amount != null && (
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={amount} className={`tnum mt-0.5 flex items-center gap-1.5 font-black leading-none ${amount >= 100_000 ? 'text-[17px]' : amount >= 10_000 ? 'text-[21px]' : 'text-[26px]'}`} initial={{ scale: 1.3, y: -4 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 14 }}>
            <AnimatedNumber value={amount} /> <Coin size={20} />
          </motion.span>
        </AnimatePresence>
      )}
      {sub && <span className="tnum mt-1 text-[12px] font-bold opacity-75">{sub}</span>}
    </motion.button>
  )
}
