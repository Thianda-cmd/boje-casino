import { memo, useEffect, useState, type ReactNode, type Ref } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { AnimatedNumber } from '../../components/ui'
import { Coin, IconCheck, IconUsers } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/Loader'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt } from '../../lib/format'
import { Swatch, TONE, Tile } from './art'
import { verifyRound, type Verdict } from './fair'
import type { Bettor, DoubleServer, Feed, RoundInfo } from './net'
import { COLORS, LABEL, MULT, colorOf, type Color, type Outcome, type Stakes } from './rules'

/* The pieces of the Double page: the history row, the status bar, the bet columns, the colour buttons, the summary of
   your bets, the connection card and the fairness check. */

export type Conn = 'connecting' | 'live' | 'reconnecting' | 'solo'

/* ---------- history ---------- */

/** The last rolls, newest first; tap one to check it. */
export const HistoryRow = memo(function HistoryRow({ items, size, onPick }: { items: { id: number; roll: number }[]; size: number; onPick: (id: number) => void }) {
  const head = items[0]?.id
  return (
    <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden [mask-image:linear-gradient(90deg,#000_80%,transparent)]">
      <AnimatePresence initial={false}>
        {items.map((h, i) => (
          <motion.button
            key={h.id}
            layout
            layoutDependency={head}
            initial={{ opacity: 0, scale: 0.4, x: -10 }}
            animate={{ opacity: i === 0 ? 1 : Math.max(0.55, 1 - i * 0.035), scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.5 }}
            transition={{ type: 'spring', stiffness: 480, damping: 30 }}
            onClick={() => onPick(h.id)}
            className="shrink-0 rounded-[7px] transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            aria-label={`Round ${h.id}: ${LABEL[colorOf(h.roll)]} ${h.roll}`}
          >
            <Tile roll={h.roll} size={size} />
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
})

/** How the last 100 rolls split between the colours. */
export function Last100({ items, compact }: { items: { id: number; roll: number }[]; compact?: boolean }) {
  const last = items.slice(0, 100)
  const n: Record<Color, number> = { red: 0, green: 0, black: 0 }
  for (const h of last) n[colorOf(h.roll)]++
  return (
    <div className="flex shrink-0 items-center gap-2.5 text-[12px] font-bold text-muted">
      {!compact && <span className="text-[11px] font-semibold uppercase tracking-[.12em] text-dim">Last {last.length || 100}</span>}
      {COLORS.map((c) => (
        <span key={c} className="tnum flex items-center gap-1.5 text-ink/90" title={`${LABEL[c]} in the last ${last.length} rounds`}>
          <Swatch color={c} size={compact ? 12 : 14} />
          {n[c]}
        </span>
      ))}
    </div>
  )
}

/* ---------- status bar ---------- */

export function StatusBar({
  phase,
  shut,
  roll,
  round,
  countRef,
  barRef,
  result,
  onFair,
}: {
  phase: 'betting' | 'spinning' | 'done' | 'next' | null
  /** betting, but this page has stopped taking chips: the strip rolls in a moment */
  shut: boolean
  roll: number | null
  round: number | null
  countRef: Ref<HTMLSpanElement>
  barRef: Ref<HTMLDivElement>
  result: Outcome | null
  onFair: () => void
}) {
  const color = roll != null ? colorOf(roll) : null
  const landed = phase === 'done' && roll != null
  return (
    <div className="relative">
      <div className="flex min-h-[34px] items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {phase === 'betting' && shut ? (
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[.16em] text-gold">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gold shadow-[0_0_10px_rgba(247,197,72,.9)]" />
              No more bets
            </div>
          ) : phase === 'betting' ? (
            <div className="flex items-baseline gap-2 text-[13px] font-bold uppercase tracking-[.16em] text-white/55">
              Rolling in
              <span className="tnum text-[20px] font-black normal-case tracking-normal text-white">
                <span ref={countRef}>15.0</span>
                <span className="ml-0.5 text-[14px] text-white/60">s</span>
              </span>
            </div>
          ) : landed && color ? (
            <motion.div key={round} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2.5">
              <Tile roll={roll!} size={30} />
              <span className="whitespace-nowrap text-[15px] font-black" style={{ color: color === 'black' ? '#dde6f0' : TONE[color].glow }}>
                {LABEL[color]} wins
              </span>
              <span className="hidden rounded-md bg-white/[.07] px-1.5 py-0.5 text-[12px] font-black text-white/80 sm:inline">{MULT[color]}×</span>
            </motion.div>
          ) : (
            <div className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-[.16em] text-white/70">
              <span className="h-2 w-2 animate-pulse rounded-full bg-gold shadow-[0_0_10px_rgba(247,197,72,.9)]" />
              {phase === 'next' || phase === null ? 'Next round' : 'Rolling'}
            </div>
          )}
          <AnimatePresence>
            {landed && result && (result.bet > 0 || result.refund > 0) && (
              <motion.div
                key={`r${round}`}
                initial={{ opacity: 0, scale: 0.85, x: -6 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 26 }}
                className={`tnum flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-extrabold ${
                  result.payout > result.bet
                    ? 'bg-accent/15 text-accent shadow-[0_0_24px_-6px_rgba(34,211,111,.7)] ring-1 ring-accent/50'
                    : result.payout > 0
                      ? 'bg-white/[.07] text-ink ring-1 ring-white/10'
                      : 'bg-white/[.05] text-white/55'
                }`}
              >
                {result.bet === 0 ? `${fmt(result.refund)} back` : result.payout > result.bet ? `+${fmt(result.payout - result.bet)}` : result.payout > 0 ? `${fmt(result.payout)} back` : `−${fmt(result.bet)}`}
                {result.bet > 0 && result.payout > result.bet && <Coin size={14} />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {round != null && (
          <button onClick={onFair} className="tnum -mr-1 flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-bold text-dim transition hover:bg-white/5 hover:text-ink" title="Check this round is fair">
            <ShieldIcon />#{round}
          </button>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.07]">
        <div
          ref={barRef}
          className="h-full origin-left rounded-full"
          style={{
            background: phase === 'betting' ? 'linear-gradient(90deg,#ff4d61,#f7c548 55%,#22d36f)' : landed && color ? TONE[color].glow : 'transparent',
            transform: phase === 'betting' ? undefined : 'scaleX(1)',
            opacity: phase === 'betting' ? 1 : landed ? 0.55 : 0,
            transition: 'opacity .4s, background-color .4s',
          }}
        />
      </div>
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.8 4.5 5.6v6c0 4.6 3.1 8.2 7.5 9.6 4.4-1.4 7.5-5 7.5-9.6v-6Z" />
      <path d="m8.8 12 2.2 2.2 4.3-4.4" />
    </svg>
  )
}

/* ---------- bet columns ---------- */

export interface ColumnView {
  total: number
  players: number
  rows: Bettor[]
}

/** The three columns: everyone's bets on each colour, yours highlighted, and after the spin the winners glowing. */
export const Columns = memo(function Columns({
  view,
  open,
  winner,
  onBet,
  amount,
  round,
  compact,
  className = '',
}: {
  view: Record<Color, ColumnView>
  /** the round on show: its totals count up from zero, not down from the last round's */
  round: number
  open: boolean
  /** the amount a click on a column's header bets (wide layout only) */
  amount: number
  /** the winning colour once the strip has landed */
  winner: Color | null
  onBet: (c: Color) => void
  compact: boolean
  className?: string
}) {
  return (
    <div className={`grid grid-cols-3 gap-2 sm:gap-3 ${className}`}>
      {COLORS.map((c) => (
        <BetColumn key={c} color={c} col={view[c]} open={open} state={winner == null ? 'live' : winner === c ? 'won' : 'lost'} onBet={onBet} amount={amount} round={round} compact={compact} />
      ))}
    </div>
  )
})

function BetColumn({
  color,
  col,
  open,
  state,
  onBet,
  amount,
  round,
  compact,
}: {
  color: Color
  col: ColumnView
  round: number
  open: boolean
  state: 'live' | 'won' | 'lost'
  onBet: (c: Color) => void
  amount: number
  compact: boolean
}) {
  const t = TONE[color]
  const won = state === 'won'
  // on a phone the colour buttons sit just above, so the headers stay put while you scroll the lists
  const clickable = open && !compact
  // a row's key: names aren't unique (two guests may pick the same name and avatar), so namesakes are numbered
  const seen = new Map<string, number>()
  const keyOf = (b: Bettor) => {
    // ':' never appears in a name (the server keeps letters, digits, spaces and _ . -), so "you:" is never a player's
    const k = b.me ? 'you:' : `${b.name}:${b.avatar}`
    const n = seen.get(k) ?? 0
    seen.set(k, n + 1)
    return n ? `${k}#${n}` : k
  }
  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-[#0c1823]/85 ring-1 transition-[opacity,box-shadow] duration-500"
      style={{
        opacity: state === 'lost' ? 0.42 : 1,
        boxShadow: won ? `0 0 0 2px ${t.glow}, 0 0 38px -8px ${t.glow}` : undefined,
        ['--tw-ring-color' as string]: 'rgba(255,255,255,.06)',
      }}
    >
      <button
        onClick={() => onBet(color)}
        disabled={!clickable}
        className="group relative shrink-0 overflow-hidden px-2.5 pb-2.5 pt-2.5 text-left transition enabled:hover:brightness-110 disabled:cursor-default sm:px-3.5 sm:pb-3 sm:pt-3"
        style={{ background: `linear-gradient(180deg, ${t.soft}, rgba(12,24,35,0) 140%)` }}
        aria-label={`Bet on ${LABEL[color]}`}
      >
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: t.bg }} />
        <div className="flex items-center gap-2">
          {!compact && <Swatch color={color} size={24} />}
          <span className="text-[13px] font-extrabold text-ink sm:text-[15px]">{LABEL[color]}</span>
          <span className="relative ml-auto flex justify-end">
            <span className={`rounded-md bg-black/30 px-1.5 py-0.5 text-[11px] font-black text-white/85 transition sm:text-[12px] ${clickable ? 'group-hover:opacity-0' : ''}`}>{MULT[color]}×</span>
            {clickable && (
              <span className="tnum pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-md bg-white/95 px-1.5 py-0.5 text-[11px] font-black text-panel opacity-0 shadow-[0_4px_12px_rgba(0,0,0,.35)] transition group-hover:translate-x-0 group-hover:opacity-100 sm:text-[12px]">
                Bet {fmt(amount)}
              </span>
            )}
          </span>
        </div>
        <div className={`mt-2 flex ${compact ? 'flex-col items-start gap-0.5' : 'items-center justify-between'} text-[12px] font-bold`}>
          <span className="flex items-center gap-1 text-muted">
            <IconUsers size={13} /> {col.players}
          </span>
          <span className="tnum flex items-center gap-1 text-ink">
            <AnimatedNumber key={round} value={col.total} /> <Coin size={13} />
          </span>
        </div>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/[.05] py-1">
        {col.rows.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-dim">{open ? 'No bets yet' : 'No bets'}</div>}
        <AnimatePresence initial={false}>
          {col.rows.map((b) => (
            <motion.div
              key={keyOf(b)}
              layout="position"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className={`mx-1 flex items-center gap-2 rounded-lg px-1.5 py-1.5 sm:px-2 ${b.me ? 'bg-accent/[.09] ring-1 ring-accent/40' : ''}`}
            >
              <Avatar index={b.avatar} size={compact ? 18 : 22} />
              <div className={`flex min-w-0 flex-1 ${compact ? 'flex-col' : 'items-center gap-2'}`}>
                <span className={`flex min-w-0 items-center gap-1 truncate text-[12px] font-semibold ${b.me ? 'text-accent' : 'text-ink/85'}`}>
                  <PlayerName name={b.name} acct={b.acct} className="truncate">
                    {b.me ? 'You' : b.name}
                  </PlayerName>
                  {b.bot && !compact && <BotTag />}
                </span>
                <span className={`flex items-center gap-1.5 ${compact ? '' : 'ml-auto'}`}>
                  <span className={`tnum text-[12px] font-bold ${won ? 'text-accent' : 'text-white/75'}`} style={won ? { textShadow: '0 0 12px rgba(34,211,111,.65)' } : undefined}>
                    {won ? `+${fmt(b.amount * (MULT[color] - 1))}` : fmt(b.amount)}
                  </span>
                  {b.bot && compact && <BotTag />}
                </span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

/** marks a house bot (offline stand-in) */
function BotTag() {
  return <span className="shrink-0 rounded bg-white/10 px-1 text-[9px] font-black tracking-wider text-white/55">BOT</span>
}

/* ---------- the colour buttons ---------- */

export function ColorButtons({ open, mine, onBet, hint }: { open: boolean; mine: Stakes; onBet: (c: Color) => void; hint: ReactNode }) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {COLORS.map((c) => {
          const t = TONE[c]
          return (
            <motion.button
              key={c}
              whileTap={open ? { scale: 0.95 } : undefined}
              onClick={() => onBet(c)}
              disabled={!open}
              className="relative flex h-[60px] flex-col items-center justify-center rounded-xl text-white transition enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: t.bg, boxShadow: `${t.shadow}, 0 10px 22px -12px ${t.glow}` }}
              aria-label={`Bet on ${LABEL[c]}, pays ${MULT[c]} times`}
            >
              <span className="flex items-center gap-1 text-[14px] font-extrabold" style={{ color: t.ink, textShadow: '0 1px 2px rgba(0,0,0,.3)' }}>
                {LABEL[c]}
                <span className="ml-0.5 hidden rounded border border-white/25 px-1 text-[10px] font-bold text-white/60 lg:inline">{c[0].toUpperCase()}</span>
              </span>
              <span className="text-[12px] font-black opacity-80">{MULT[c]}×</span>
              <AnimatePresence>
                {mine[c] > 0 && (
                  <motion.span
                    key={mine[c]}
                    initial={{ scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="tnum absolute -right-1.5 -top-2 rounded-full bg-ink px-1.5 py-0.5 text-[10px] font-black text-panel shadow-[0_3px_8px_rgba(0,0,0,.4)]"
                  >
                    {fmt(mine[c], mine[c] % 1 ? 2 : 0)}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          )
        })}
      </div>
      <div className="mt-2 h-4 text-center text-[11px] font-semibold text-dim">{hint}</div>
    </div>
  )
}

/** Set the amount in one tap. */
export function QuickAmounts({ value, max, onPick, disabled }: { value: number; max: number; onPick: (v: number) => void; disabled?: boolean }) {
  const opts: [string, number][] = [
    ['1', 1],
    ['10', 10],
    ['100', 100],
    ['1K', 1000],
    ['Max', Math.max(1, Math.min(100000, Math.floor(max * 100) / 100))],
  ]
  return (
    <div className="-mt-2 grid grid-cols-5 gap-1.5">
      {opts.map(([label, v]) => (
        <button
          key={label}
          disabled={disabled}
          onClick={() => onPick(v)}
          className={`h-9 rounded-lg text-[12px] font-bold transition disabled:opacity-50 ${value === v ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/* ---------- your bets ---------- */

export function YourBets({ mine, round, landedColor, result }: { mine: Stakes; round: number | null; landedColor: Color | null; result: Outcome | null }) {
  const placed = COLORS.filter((c) => mine[c] > 0)
  const shown = landedColor && result ? COLORS.filter((c) => result.landed[c] > 0) : placed
  const stakes = landedColor && result ? result.landed : mine
  const total = shown.reduce((a, c) => a + stakes[c], 0)
  return (
    <div className="rounded-xl bg-stage p-3">
      <div className="mb-2 flex items-center justify-between text-[12px] font-bold text-muted">
        <span>Your bets</span>
        {round != null && <span className="tnum text-dim">Round #{round}</span>}
      </div>
      {shown.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-dim">Pick a colour to bet the amount above. Back more than one colour, or tap again to add to a bet, until the strip rolls.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((c) => {
            const hit = landedColor === c
            const miss = landedColor != null && !hit
            return (
              <div key={c} className={`flex items-center gap-2 text-[13px] transition-opacity ${miss ? 'opacity-45' : ''}`}>
                <Swatch color={c} size={16} />
                <span className="font-semibold text-ink/90">{LABEL[c]}</span>
                <span className="tnum ml-auto font-bold text-ink">{fmt(stakes[c])}</span>
                <span className={`tnum w-[92px] text-right text-[12px] font-bold ${hit ? 'text-accent' : 'text-dim'}`}>
                  {hit ? `won ${fmt(stakes[c] * MULT[c])}` : miss ? 'lost' : `pays ${fmt(stakes[c] * MULT[c])}`}
                </span>
              </div>
            )
          })}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-[12px] font-bold">
            <span className="text-muted">Total</span>
            <span className="tnum flex items-center gap-1 text-ink">
              {fmt(total)} <Coin size={13} />
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- connection and identity ---------- */

export function StatusCard({
  conn,
  online,
  bots,
  name,
  editable,
  onName,
  onFair,
  onRetry,
  busy,
}: {
  conn: Conn
  online: number
  bots: number
  name: string
  editable: boolean
  onName: (n: string) => void
  onFair: () => void
  onRetry: () => void
  busy: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  useEffect(() => setDraft(name), [name])
  return (
    <div className="overflow-hidden rounded-xl bg-stage text-[12px]">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 font-bold text-muted">
        {conn === 'connecting' ? (
          <span className="flex items-center gap-2">
            <Spinner size={14} className="text-gold" /> Joining the shared rounds…
          </span>
        ) : conn === 'solo' ? (
          <>
            <span className="h-2 w-2 rounded-full bg-sky shadow-[0_0_8px_rgba(76,180,255,.8)]" />
            <span className="flex-1">
              Solo · you and {bots} house bots
              <span className="block text-[11px] font-semibold text-dim">The shared rounds can't be reached right now.</span>
            </span>
            <button onClick={onRetry} disabled={busy} className="shrink-0 rounded-lg bg-raised px-3 py-2 font-bold text-ink transition hover:bg-hover disabled:opacity-50">
              Retry
            </button>
          </>
        ) : (
          <>
            <span className={`h-2 w-2 rounded-full ${conn === 'live' ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'animate-pulse bg-gold'}`} />
            <span className={conn === 'live' ? 'text-accent' : 'text-gold'}>{conn === 'live' ? 'Live' : 'Reconnecting…'}</span>
            <span className="ml-auto flex items-center gap-1.5">
              <IconUsers size={14} /> <span className="tnum">{online}</span> online
            </span>
          </>
        )}
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="shrink-0 text-dim">Playing as</span>
        {editing ? (
          <input
            autoFocus
            maxLength={16}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const n = draft.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16)
              if (n) onName(n)
              else setDraft(name)
              setEditing(false)
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="min-w-0 flex-1 rounded bg-panel2 px-2 py-0.5 text-[16px] font-semibold text-ink outline-none ring-1 ring-accent/50 sm:text-[12px]"
          />
        ) : editable ? (
          <button onClick={() => setEditing(true)} className="min-w-0 flex-1 truncate text-left font-semibold text-ink hover:text-accent">
            {name} <span className="text-dim">✎</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name}</span>
        )}
        <button onClick={onFair} className="-my-1 shrink-0 rounded-md px-2.5 py-2 font-bold text-muted transition hover:bg-panel2 hover:text-ink">
          Fairness
        </button>
      </div>
    </div>
  )
}

/* ---------- fairness ---------- */

/** A round's published hash and, once it has landed, the revealed seed checked in the browser. */
export function FairnessModal({
  server,
  feed,
  history,
  id,
  landed,
  onPick,
  onClose,
}: {
  server: DoubleServer
  feed: Feed
  history: { id: number; roll: number }[]
  id: number
  /** the current round has landed on this page's clock */
  landed: boolean
  onPick: (id: number) => void
  onClose: () => void
}) {
  const current = feed.round.id === id ? feed.round : null
  const [info, setInfo] = useState<RoundInfo | null>(null)
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'pending' | 'missing'>('loading')
  const [copied, setCopied] = useState<string | null>(null)
  const done = !current || (landed && current.seed != null)

  useEffect(() => {
    let alive = true
    setVerdict(null)
    setInfo(null)
    if (!done) {
      setState('pending')
      return
    }
    setState('loading')
    const known = current?.seed && current.roll != null ? { id, hash: current.hash, seed: current.seed, roll: current.roll } : null
    ;(known ? Promise.resolve(known) : server.roundInfo(id).catch(() => null)).then(async (r) => {
      if (!alive) return
      if (!r) return setState('missing')
      setInfo(r)
      setState('ready')
      const v = await verifyRound(r.seed, r.hash, r.roll)
      if (alive) setVerdict(v)
    })
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, done])

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  const hash = current?.hash ?? info?.hash ?? ''
  const roll = info?.roll ?? (done ? (current?.roll ?? history.find((h) => h.id === id)?.roll ?? null) : null)
  const field = (label: string, value: string | null, placeholder: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-muted">
        {label}
        {value && (
          <button onClick={() => copy(label, value)} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-dim transition hover:bg-panel2 hover:text-ink">
            {copied === label ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="break-all rounded-lg bg-stage px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink/90">{value || <span className="font-sans text-dim">{placeholder}</span>}</div>
    </div>
  )
  const check = (ok: boolean | undefined, text: string) => (
    <div className="flex items-center gap-2 text-[13px] font-semibold">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok == null ? 'bg-raised' : ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>
        {ok == null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /> : ok ? <IconCheck size={12} /> : '!'}
      </span>
      {text}
    </div>
  )

  return (
    <Modal onClose={onClose} title={`Round #${id}`} width={520}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {roll != null ? (
            <>
              <Tile roll={roll} size={44} />
              <div>
                <div className="text-[20px] font-black leading-tight">
                  {LABEL[colorOf(roll)]} {roll}
                </div>
                <div className="text-[12px] font-semibold text-muted">Paid {MULT[colorOf(roll)]}× on {LABEL[colorOf(roll)]}</div>
              </div>
            </>
          ) : (
            <div className="text-[24px] font-black leading-none text-ink">{current?.phase === 'betting' ? 'Taking bets' : 'Rolling'}</div>
          )}
          {!server.online && <span className="ml-auto rounded-full bg-raised px-2.5 py-1 text-[11px] font-bold text-muted">Solo round</span>}
        </div>
        {field('Hash, published before betting', hash || null, 'Not available')}
        {field('Seed', state === 'ready' ? info!.seed : null, state === 'pending' ? 'Revealed when the strip lands' : state === 'missing' ? 'This round is too old to look up' : 'Loading…')}
        {state === 'ready' && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            {check(verdict?.hashOk, 'The seed matches the published hash')}
            {check(verdict?.rollOk, verdict ? `The seed gives roll ${verdict.computed}: ${LABEL[colorOf(verdict.computed)]}` : 'Working out the roll from the seed')}
          </div>
        )}
        <div>
          <div className="mb-2 text-[12px] font-bold text-muted">Recent rounds</div>
          <div className="flex flex-wrap gap-1.5">
            {history.slice(0, 16).map((h) => (
              <button key={h.id} onClick={() => onPick(h.id)} className={`rounded-[8px] transition ${h.id === id ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'opacity-80 hover:opacity-100'}`} aria-label={`Round ${h.id}`}>
                <Tile roll={h.roll} size={28} />
              </button>
            ))}
            {feed.round.id !== id && (
              <button onClick={() => onPick(feed.round.id)} className="rounded-full bg-raised px-3 py-1.5 text-[12px] font-extrabold text-muted hover:bg-hover hover:text-ink">
                Current round
              </button>
            )}
          </div>
        </div>
        <p className="text-[12px] leading-relaxed text-dim">
          Each round's roll comes from a random seed. Its SHA-256 hash is shown before anyone bets, so the roll can't be changed afterwards. When the strip lands the seed is revealed and your browser checks
          it: the first 52 bits of SHA-256(seed + ":double") taken mod 33 give the roll. 0 is green (pays 32×), 1 to 16 red and 17 to 32 black (pay 2×).
        </p>
      </div>
    </Modal>
  )
}
