import { memo, useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Coin, IconUsers } from '../../components/icons'
import { Chip, chipLabel } from '../../art/Chip'
import { fmt, fmtCompact } from '../../lib/format'
import { Kbd } from '../blackjack/table'
import { MARKETS, METHOD_NAME, fighter, payoutOf, selName, selShort, sideId, stakeTotal, winOf } from './rules'
import { KaijuPortrait } from './portraits'
import { BuildingMark, CORNER, MethodMark } from './art'
import type { LiveRound } from './live'
import type { Market, Matchup, Method, Odds, Result, Sel, Side, Stakes } from './types'

/*
  The betting board and the rack above it.

  The rack holds the chips (the value a tap puts on a selection), Undo, Clear, ×2 and Rebet, and the bet clock: the
  countdown while betting is open (a bar running down behind it), then what the fight night is doing. Under it, what
  this player has on the board and the most it could pay back.

  The board is the six markets as cards, each selection a button with its price (what it pays per coin, the stake
  included), this player's stake on it as a chip badge, and the crowd's total and how many players back it. The
  kaiju's selections carry their portraits and corner colours (red A, blue B); Winner and method is a small matrix,
  the kaiju down the side and the three ways to win across. A tap adds the chip while betting is open; after the
  close the board is locked, and once the fight is decided on stage the winning selections light up (with what each
  of this player's winning stakes pays) and the rest go dim.
*/

export const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000]

/** how the rack and the board lay out, by the width they have (not the screen's: the site has a sidebar) */
export type Layout = 'phone' | 'mid' | 'wide'
export const layoutFor = (w: number): Layout => (w < 640 ? 'phone' : w < 920 ? 'mid' : 'wide')
const SPANS: Record<Layout, Record<Market, string>> = {
  wide: { win: 'col-span-4', how: 'col-span-4', rnd: 'col-span-4', exact: 'col-span-6', first: 'col-span-3', dmg: 'col-span-3' },
  mid: { win: 'col-span-6', how: 'col-span-6', rnd: 'col-span-12', exact: 'col-span-12', first: 'col-span-6', dmg: 'col-span-6' },
  phone: { win: 'col-span-12', how: 'col-span-12', rnd: 'col-span-12', exact: 'col-span-12', first: 'col-span-6', dmg: 'col-span-6' },
}

/** the most a set of stakes could pay back, over every way the fight can go */
export function bestCase(stakes: Stakes, odds: Odds): number {
  if (!stakeTotal(stakes)) return 0
  let best = 0
  for (const winner of ['a', 'b'] as Side[])
    for (const [method, round] of [['ko', 1], ['ko', 2], ['ko', 3], ['splash', 1], ['splash', 2], ['splash', 3], ['dec', 3]] as [Method, 1 | 2 | 3][])
      for (const first of ['a', 'b'] as Side[])
        for (const damage of [odds.line + 0.5, odds.line - 0.5]) {
          const r: Result = { winner, method, round, first, damage }
          best = Math.max(best, payoutOf(stakes, r, odds))
        }
  return best
}

const MARKET_INDEX: Record<Market, number> = { win: 0, how: 1, exact: 2, rnd: 3, first: 4, dmg: 5 }
export const marketIndex = (s: Sel) => MARKET_INDEX[s.slice(0, s.indexOf(':')) as Market]

/* ---------------- the rack ---------------- */

export function Rack({
  chip,
  onChip,
  open,
  canUndo,
  staked,
  hasLast,
  onUndo,
  onClear,
  onDouble,
  onRebet,
  clock,
  touch,
  layout,
}: {
  chip: number
  onChip: (v: number) => void
  open: boolean
  canUndo: boolean
  staked: number
  hasLast: boolean
  onUndo: () => void
  onClear: () => void
  onDouble: () => void
  onRebet: () => void
  clock: ReactNode
  touch: boolean
  layout: Layout
}) {
  const phone = layout === 'phone'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className={`no-scrollbar -mx-1 flex min-w-0 gap-1 overflow-x-auto px-1 py-1 ${phone ? 'w-full' : 'flex-1'}`} role="radiogroup" aria-label="Chip value">
        {CHIPS.map((v, i) => (
          <button
            key={v}
            role="radio"
            onClick={() => onChip(v)}
            aria-label={`Chip ${v}`}
            aria-checked={chip === v}
            title={touch ? undefined : `Chip ${fmt(v, 0)} (key ${i + 1})`}
            className={`shrink-0 rounded-full transition ${chip === v ? '-translate-y-1 ring-2 ring-white ring-offset-2 ring-offset-panel2' : 'opacity-70 hover:opacity-100'}`}
          >
            <Chip value={v} size={38} label={chipLabel(v)} />
          </button>
        ))}
      </div>
      <div className={`flex items-center gap-1.5 ${phone ? 'w-full [&>*]:flex-1' : ''}`}>
        <Small onClick={onUndo} off={!open || !canUndo}>
          Undo<Kbd>U</Kbd>
        </Small>
        <Small onClick={onClear} off={!open || !staked}>
          Clear<Kbd>X</Kbd>
        </Small>
        <Small onClick={onDouble} off={!open || !staked}>
          ×2<Kbd>D</Kbd>
        </Small>
        <Small onClick={onRebet} off={!open || !hasLast}>
          Rebet<Kbd>R</Kbd>
        </Small>
      </div>
      {clock}
    </div>
  )
}

function Small({ onClick, off, children }: { onClick: () => void; off: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={off} className="flex h-10 items-center justify-center rounded-lg bg-raised px-2.5 text-[12.5px] font-bold text-ink transition hover:bg-hover disabled:opacity-40 sm:px-3">
      {children}
    </button>
  )
}

/** the bet clock: the countdown while betting is open, then what the night is doing */
export function BetClock({ round, now, staked, players, full }: { round: LiveRound | null; now: () => number; staked: number; players: number; full: boolean }) {
  const count = useRef<HTMLSpanElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const open = round?.phase === 'bets'
  useEffect(() => {
    if (!open || !round) return
    let raf = 0
    const span = round.betUntil - round.times.opensAt
    const frame = () => {
      const left = Math.max(0, round.betUntil - now())
      if (count.current) count.current.textContent = (left / 1000).toFixed(1)
      if (bar.current) bar.current.style.transform = `scaleX(${Math.min(1, left / span).toFixed(4)})`
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [open, round?.id, round?.betUntil, now])
  const label = !round
    ? 'Joining the fight night…'
    : round.phase === 'closed'
      ? 'No more bets'
      : round.phase === 'walkout'
        ? 'The walkout'
        : round.phase === 'fight'
          ? round.over
            ? 'Fight over'
            : `Fight on${players ? ` · ${players} ${players === 1 ? 'player' : 'players'}` : ''}`
          : round.phase === 'result'
            ? 'Next fight soon…'
            : ''
  return (
    <div
      role="timer"
      className={`relative flex h-12 min-w-[180px] items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-[15px] font-black ${full ? 'w-full' : 'flex-none'} ${open ? 'bg-accent text-[#032412] shadow-[0_10px_28px_-10px_rgba(34,211,111,.8)]' : 'bg-raised text-ink/80'}`}
    >
      {open && <div ref={bar} className="absolute inset-y-0 left-0 w-full origin-left bg-white/20" />}
      <span className="relative flex items-center gap-2">
        {open ? (
          <>
            Bets close in <span ref={count} className="tnum w-9 text-left" />
            {staked > 0 && (
              <span className="tnum flex items-center gap-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[13px]">
                {fmt(staked)} <Coin size={13} />
              </span>
            )}
          </>
        ) : (
          label
        )}
      </span>
    </div>
  )
}

/* ---------------- the board ---------------- */

interface BoardProps {
  matchup: Matchup
  odds: Odds
  mine: Stakes
  totals: Record<Sel, { total: number; players: number }>
  open: boolean
  /** the winning selections, once the fight is decided on stage */
  hits: Sel[] | null
  chip: number
  onPick: (s: Sel) => void
  compact: boolean
  touch: boolean
  layout: Layout
}

export const Board = memo(function Board(p: BoardProps) {
  const span = SPANS[p.layout]
  const m = p.matchup
  const card = (id: Market, cls: string, body: ReactNode) => {
    const mk = MARKETS.find((x) => x.id === id)!
    return (
      <section key={id} className={`flex min-w-0 flex-col rounded-xl bg-stage/80 p-1.5 ring-1 ring-white/[.04] sm:p-2 ${cls}`} aria-label={mk.name}>
        <header className="mb-1.5 flex items-baseline gap-2 px-1">
          <h3 className="shrink-0 text-[11.5px] font-black uppercase tracking-[.1em] text-ink/85">{mk.name}</h3>
          {!p.compact && <span className="truncate text-[11px] font-semibold text-dim">{mk.line}</span>}
        </header>
        {body}
      </section>
    )
  }
  const btn = (s: Sel, extra?: { lead?: ReactNode; label?: string }) => <SelButton key={s} s={s} {...p} lead={extra?.lead} label={extra?.label ?? selShort(s, m)} />
  const face = (side: Side, size: number) => <KaijuPortrait id={sideId(m, side)} size={size} mirror={side === 'b'} mood="fierce" />
  const big = p.compact ? 26 : 30
  return (
    <div className="grid grid-cols-12 gap-1.5 sm:gap-2">
      {card('win', span.win, <div className="grid grid-cols-2 gap-1.5">{(['a', 'b'] as Side[]).map((x) => btn(`win:${x}` as Sel, { lead: face(x, big) }))}</div>)}
      {card('how', span.how, <div className="grid grid-cols-3 gap-1.5">{(['ko', 'splash', 'dec'] as Method[]).map((x) => btn(`how:${x}` as Sel, { lead: <MethodMark method={x} size={p.compact ? 15 : 17} /> }))}</div>)}
      {card(
        'rnd',
        span.rnd,
        <div className="grid grid-cols-4 gap-1.5">{(['rnd:1', 'rnd:2', 'rnd:3', 'rnd:dist'] as Sel[]).map((s) => btn(s, { label: p.compact ? (s === 'rnd:dist' ? 'Distance' : `Rd ${s.slice(4)}`) : undefined }))}</div>,
      )}
      {card(
        'exact',
        span.exact,
        <div className="grid grid-cols-[auto_1fr_1fr_1fr] items-stretch gap-1.5">
          {(['a', 'b'] as Side[]).map((x) => (
            <ExactRow key={x} side={x} m={m} face={face(x, p.compact ? 30 : 34)}>
              {(['ko', 'splash', 'dec'] as Method[]).map((how) => btn(`exact:${x}-${how}` as Sel, { lead: <MethodMark method={how} size={14} />, label: METHOD_NAME[how] }))}
            </ExactRow>
          ))}
        </div>,
      )}
      {card('first', span.first, <div className="grid grid-cols-2 gap-1.5">{(['a', 'b'] as Side[]).map((x) => btn(`first:${x}` as Sel, { lead: p.compact ? undefined : face(x, 24) }))}</div>)}
      {card('dmg', span.dmg, <div className="grid grid-cols-2 gap-1.5">{(['dmg:over', 'dmg:under'] as Sel[]).map((s) => btn(s, { lead: <BuildingMark size={14} color={s === 'dmg:over' ? '#ffb547' : '#90a4b8'} />, label: p.compact ? `${s === 'dmg:over' ? 'O' : 'U'} ${p.odds.line}` : undefined }))}</div>)}
    </div>
  )
})

function ExactRow({ side, m, face, children }: { side: Side; m: Matchup; face: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center gap-1.5 rounded-lg px-1" style={{ boxShadow: `inset 3px 0 0 ${CORNER[side].color}` }} title={fighter(sideId(m, side)).name}>
        <span className="shrink-0">{face}</span>
      </div>
      {children}
    </>
  )
}

function SelButton({ s, label, lead, matchup, odds, mine, totals, open, hits, onPick, compact, touch, chip }: BoardProps & { s: Sel; label: string; lead?: ReactNode }) {
  const stake = mine[s] ?? 0
  const crowd = totals[s]
  const mult = odds.mult[s]
  const decided = !!hits
  const hit = decided && hits!.includes(s)
  const side: Side | null = s === 'win:a' || s === 'first:a' || s.startsWith('exact:a') ? 'a' : s === 'win:b' || s === 'first:b' || s.startsWith('exact:b') ? 'b' : null
  const tint = side ? CORNER[side].color : null
  const title = `${selName(s, matchup)} · ${(odds.p[s] * 100).toFixed(1)}% chance · pays ${mult.toFixed(2)}×${open && !touch ? ` · tap to add ${fmt(chip, chip % 1 ? 2 : 0)}` : ''}`
  return (
    <button
      onClick={() => onPick(s)}
      disabled={!open}
      aria-label={`${selName(s, matchup)}, pays ${mult.toFixed(2)} times${stake ? `, your stake ${fmt(stake)}` : ''}${hit ? ', won' : ''}`}
      data-sel={s}
      title={title}
      className={`group relative flex min-w-0 flex-col justify-between rounded-lg text-left transition-[transform,opacity,background-color,box-shadow] duration-300 ${compact ? 'min-h-[48px] px-1.5 py-1' : 'min-h-[56px] px-2 py-1.5'} ${
        open ? 'bg-panel2 hover:-translate-y-px hover:bg-raised active:translate-y-0' : 'cursor-default bg-panel2/80'
      } ${decided && !hit ? 'opacity-40' : ''}`}
      style={{
        boxShadow: hit ? '0 0 0 2px #f7c548, 0 0 26px -6px rgba(247,197,72,.75)' : stake ? '0 0 0 1.5px rgba(34,211,111,.75)' : undefined,
        background: hit ? 'linear-gradient(180deg, rgba(247,197,72,.22), rgba(22,43,58,.95))' : undefined,
      }}
    >
      {tint && <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] rounded-l-lg" style={{ background: tint }} />}
      <span className="flex min-w-0 items-center gap-1.5">
        {lead && <span className="flex shrink-0 items-center">{lead}</span>}
        <span className={`truncate font-extrabold leading-tight text-ink ${compact ? 'text-[11.5px]' : 'text-[12.5px]'}`}>{label}</span>
      </span>
      <span className="mt-0.5 flex items-end justify-between gap-1">
        <span className={`tnum flex min-w-0 items-center gap-0.5 truncate font-bold text-dim ${compact ? 'text-[9.5px]' : 'text-[10.5px]'}`}>
          {crowd.players > 0 && (
            <>
              <IconUsers size={compact ? 10 : 11} />
              {crowd.players}
              {!compact && <span className="text-dim/80">· {fmtCompact(crowd.total)}</span>}
            </>
          )}
        </span>
        <span className={`tnum shrink-0 font-black leading-none ${hit ? 'text-gold' : 'text-ink'} ${compact ? 'text-[13px]' : 'text-[15px]'}`}>{mult.toFixed(2)}×</span>
      </span>
      <AnimatePresence>
        {stake > 0 && (
          <motion.span
            key={hit ? 'won' : 'stake'}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            className={`tnum absolute -right-1 -top-2 z-[1] flex items-center gap-0.5 rounded-full py-[1px] pl-[1px] pr-1.5 text-[10.5px] font-black shadow-[0_3px_8px_rgba(0,0,0,.45)] ${hit ? 'bg-gold text-[#2a1a00]' : 'bg-[#0b1a14] text-white ring-1 ring-accent/70'}`}
          >
            <Chip value={stake} size={13} label="" />
            {hit ? `+${fmt(winOf(stake, mult))}` : fmt(stake, stake % 1 ? 2 : 0)}
          </motion.span>
        )}
      </AnimatePresence>
      {hit && !stake && <span className="absolute -right-1 -top-2 z-[1] rounded bg-gold px-1 text-[9px] font-black uppercase tracking-wider text-[#2a1a00] shadow-[0_3px_8px_rgba(0,0,0,.45)]">Won</span>}
    </button>
  )
}

/** this player's bets this round as a slip: each selection, its stake and what it pays; settled, what came back */
export function Slip({ matchup, odds, mine, hits, payout, refund, compact }: { matchup: Matchup; odds: Odds; mine: Stakes; hits: Sel[] | null; payout: number | null; refund: number; compact?: boolean }) {
  const sels = (Object.keys(mine) as Sel[]).filter((s) => (mine[s] ?? 0) > 0).sort((x, y) => marketIndex(x) - marketIndex(y))
  const total = stakeTotal(mine)
  return (
    <div className="rounded-xl bg-stage p-3 text-[12px]">
      <div className="mb-2 flex items-center justify-between font-bold text-muted">
        <span>Your bets</span>
        {total > 0 && (
          <span className="tnum flex items-center gap-1 text-ink">
            {fmt(total)} <Coin size={13} />
          </span>
        )}
      </div>
      {!sels.length ? (
        <p className="leading-relaxed text-dim">Pick a chip and tap a price on the board. Bets are open for 16 seconds before each fight; everyone watches the same fight.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {sels.map((s) => {
            const st = mine[s]!
            const hit = hits ? hits.includes(s) : null
            return (
              <div key={s} className={`flex items-center gap-2 rounded-lg bg-panel2 px-2 py-1.5 ${hit === false ? 'opacity-45' : ''}`}>
                <span className={`min-w-0 flex-1 truncate font-semibold ${hit ? 'text-gold' : 'text-ink/90'}`}>{selName(s, matchup)}</span>
                <span className="tnum shrink-0 text-dim">{odds.mult[s].toFixed(2)}×</span>
                <span className="tnum w-[64px] shrink-0 text-right font-bold text-ink">{fmt(st)}</span>
                {!compact && <span className={`tnum w-[78px] shrink-0 text-right font-bold ${hit ? 'text-accent' : hit === false ? 'text-dim line-through' : 'text-muted'}`}>{fmt(winOf(st, odds.mult[s]))}</span>}
              </div>
            )
          })}
          <div className="mt-1 flex items-center justify-between px-1 font-bold">
            {payout != null ? (
              <>
                <span className="text-muted">{payout > 0 ? 'Paid' : 'No win this time'}</span>
                <span className={`tnum ${payout > total ? 'text-accent' : payout > 0 ? 'text-ink' : 'text-dim'}`}>{fmt(payout)}</span>
              </>
            ) : (
              <>
                <span className="text-dim">Best case</span>
                <span className="tnum text-muted">{fmt(bestCase(mine, odds))}</span>
              </>
            )}
          </div>
          {refund > 0 && <div className="px-1 text-[11px] font-semibold text-dim">{fmt(refund)} never reached the fight and came back.</div>}
        </div>
      )}
    </div>
  )
}
