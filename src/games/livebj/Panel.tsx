import { useEffect, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { CardFace } from '../../art/Card'
import { Modal } from '../../components/Modal'
import { Spinner } from '../../components/Loader'
import { Coin, IconChevron, IconUsers } from '../../components/icons'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { fmtScore } from '../blackjack/table'
import { isSticker, PHRASES, Sticker, STICKERS } from './stickers'
import { REACTIONS, type Outcome, type ReactionCode, type RoundDetail, type TableFeed, type TableServer } from './types'
import { bestOutcome, handsAt, resultsOut, toCard } from './view'

/* The side panel's parts: the table header, reactions, who is seated, your last rounds, the guest name
   editor, the offline note and the round history dialog. */

export function LiveDot({ live }: { live: boolean }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${live ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'animate-pulse bg-gold'}`} />
}

export function TableHeader({ feed, live }: { feed: TableFeed | null; live: boolean }) {
  const playing = feed ? feed.seats.filter(Boolean).length : 0
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => navigate('/game/livebj')}
        className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-raised pl-2 pr-3 text-[13px] font-bold text-muted transition hover:bg-hover hover:text-ink"
      >
        <IconChevron size={16} className="rotate-180" /> Tables
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <LiveDot live={live} />
          <span className="truncate text-[15px] font-extrabold">{feed?.table.name ?? 'Live Blackjack'}</span>
        </div>
        {feed && (
          <div className="tnum truncate text-[12px] font-semibold text-muted">
            {fmt(feed.table.min, 0)}–{fmt(feed.table.max, 0)} · {playing} playing{feed.table.watchers > 0 && ` · ${feed.table.watchers} watching`}
          </div>
        )}
      </div>
    </div>
  )
}

/** Stickers and phrases. 1–8 send a sticker while the number hints are showing (R). */
export function Reactions({ enabled, cooling, hints, onReact }: { enabled: boolean; cooling: boolean; hints: boolean; onReact: (c: ReactionCode) => void }) {
  const phrases = REACTIONS.filter((c) => !isSticker(c))
  const off = !enabled || cooling
  return (
    <div className={`flex flex-col gap-2 transition-opacity ${!enabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between text-[12px] font-semibold text-muted">
        <span>React</span>
        <span className="text-dim">{enabled ? <span className="hidden lg:inline">Press R</span> : 'Take a seat to react'}</span>
      </div>
      <div className={`no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 lg:grid lg:grid-cols-8 ${cooling ? 'shimmer rounded-lg' : ''}`}>
        {STICKERS.map((c, i) => (
          <button
            key={c}
            disabled={off}
            onClick={() => onReact(c)}
            className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:bg-raised active:scale-90 disabled:pointer-events-none lg:h-9 lg:w-auto"
          >
            <Sticker code={c} size={30} />
            {hints && <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] font-black text-panel">{i + 1}</span>}
          </button>
        ))}
      </div>
      <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 lg:flex-wrap">
        {phrases.map((c) => (
          <button
            key={c}
            disabled={off}
            onClick={() => onReact(c)}
            className="h-11 shrink-0 whitespace-nowrap rounded-full bg-raised px-3 text-[12px] font-bold text-ink/90 transition hover:bg-hover active:scale-95 disabled:pointer-events-none lg:h-8"
          >
            {PHRASES[c as keyof typeof PHRASES]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Everyone at the table this round: seat, name, stake and result. */
export function SeatList({ feed, t }: { feed: TableFeed; t: number }) {
  const out = resultsOut(feed, t)
  const rows = Array.from({ length: feed.table.seats }, (_, i) => i + 1).flatMap((seat) => {
    const s = feed.seats[seat - 1]
    const hs = handsAt(feed, seat)
    if (!s && !hs.length) return []
    const bet = hs.reduce((a, h) => a + h.bet, 0)
    const net = out && hs.every((h) => h.payout != null) ? hs.reduce((a, h) => a + (h.payout ?? 0) - h.bet, 0) : null
    return [{ seat, name: s?.name ?? hs[0].name, avatar: s?.avatar ?? hs[0].avatar, me: s?.me ?? hs[0]?.mine, bot: !!s?.bot, acct: s ? s.acct : hs[0]?.acct, left: !s, bet, net, best: out ? bestOutcome(hs) : null }]
  })
  return (
    <div className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-stage">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5 text-[12px] font-bold text-muted">
        <span className="flex items-center gap-1.5">
          <IconUsers size={15} /> At the table
        </span>
        <span className="tnum flex items-center gap-1">
          {fmt(rows.reduce((a, r) => a + r.bet, 0))} <Coin size={12} />
        </span>
      </div>
      {rows.length === 0 && <div className="px-3 py-4 text-center text-[12px] text-dim">Nobody is seated yet</div>}
      {rows.map((r, i) => (
        <div key={r.seat} className={`flex items-center gap-2 px-3 py-1.5 text-[12px] ${r.me ? 'bg-gold/8' : i % 2 ? 'bg-panel/40' : ''} ${r.left ? 'opacity-55' : ''}`}>
          <span className="tnum w-3 text-dim">{r.seat}</span>
          <Avatar index={r.avatar} size={20} />
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <PlayerName name={r.name} acct={r.acct} className={`truncate font-semibold ${r.me ? 'text-gold' : 'text-ink/85'}`} />
            {r.bot && <span className="shrink-0 rounded bg-raised px-1 text-[9px] font-black uppercase text-muted">Bot</span>}
          </span>
          <span className="tnum w-14 text-right text-muted">{r.bet ? fmt(r.bet) : '-'}</span>
          <span className={`tnum w-14 text-right font-bold ${r.net == null ? 'text-dim' : r.net > 0 ? 'text-accent' : r.net < 0 ? 'text-danger' : 'text-ink'}`}>
            {r.net == null ? '-' : r.best === 'push' && r.net === 0 ? 'push' : `${r.net > 0 ? '+' : ''}${fmt(r.net)}`}
          </span>
        </div>
      ))}
    </div>
  )
}

export function PastRounds({ past, onPick }: { past: TableFeed['past']; onPick: (round: number) => void }) {
  if (!past.length) return null
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-muted">My last rounds</div>
      <div className="flex shrink-0 flex-col overflow-hidden rounded-xl bg-stage">
        {past.map((p, i) => {
          const net = p.payout - p.bet
          return (
            <button key={p.round} onClick={() => onPick(p.round)} className={`flex items-center gap-2 px-3 py-1.5 text-left text-[12px] transition hover:bg-panel2 ${i % 2 ? 'bg-panel/40' : ''}`}>
              <span className="tnum flex-1 text-dim">#{p.round}</span>
              <span className="tnum w-16 text-right text-muted">{fmt(p.bet)}</span>
              <span className={`tnum w-16 text-right font-bold ${net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : 'text-ink'}`}>
                {net > 0 ? '+' : ''}
                {fmt(net)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** "Playing as …", editable for guests (signed-in players use their username). */
export function NameEditor({ name, editable, onName }: { name: string; editable: boolean; onName: (n: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="shrink-0 text-dim">Playing as</span>
      {editing ? (
        <input
          autoFocus
          maxLength={16}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = draft.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16)
            if (n && n !== name) onName(n)
            else setDraft(name)
            setEditing(false)
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="min-w-0 flex-1 rounded bg-stage px-2 py-1 text-[16px] font-semibold text-ink outline-none ring-1 ring-accent/50 sm:text-[12px]"
        />
      ) : editable ? (
        <button onClick={() => (setDraft(name), setEditing(true))} className="-my-1 min-w-0 flex-1 truncate py-1 text-left font-semibold text-ink hover:text-accent">
          {name} <span className="text-dim">✎</span>
        </button>
      ) : (
        <span className="min-w-0 flex-1 truncate font-semibold text-ink">{name}</span>
      )}
    </div>
  )
}

export function SoloNote({ connecting, onRetry }: { connecting: boolean; onRetry: () => void }) {
  return (
    <div className="rounded-xl bg-stage p-3 text-[12px] leading-relaxed text-muted">
      <div className="flex items-center gap-3">
        <span className="flex-1">Playing offline with house bots. The shared tables can't be reached right now.</span>
        <button onClick={onRetry} disabled={connecting} className="flex shrink-0 items-center gap-2 rounded-lg bg-raised px-3 py-2 font-bold text-ink transition hover:bg-hover disabled:opacity-50">
          {connecting && <Spinner size={12} />} Retry
        </button>
      </div>
    </div>
  )
}

/** A finished round: the dealer's hand and every player's, from bj_round_info. */
export function HistoryModal({ server, id, recent, onPick, onClose }: { server: TableServer; id: number; recent: TableFeed['history']; onPick: (id: number) => void; onClose: () => void }) {
  const [info, setInfo] = useState<RoundDetail | null | 'loading'>('loading')
  useEffect(() => {
    let alive = true
    setInfo('loading')
    server
      .roundInfo(id)
      .catch(() => null)
      .then((r) => alive && setInfo(r))
    return () => void (alive = false)
  }, [server, id])

  let body: ReactNode
  if (info === 'loading')
    body = (
      <div className="flex h-40 items-center justify-center">
        <Spinner size={22} className="text-accent" />
      </div>
    )
  else if (!info) body = <p className="py-8 text-center text-[13px] text-muted">This round is too old to look up.</p>
  else
    body = (
      <div className="flex flex-col gap-3">
        <HandRow label="Dealer" cards={info.dealer} />
        {info.hands.map((h) => (
          <HandRow
            key={`${h.seat}:${h.idx}`}
            label={
              <span className="flex items-center gap-2">
                <Avatar index={h.avatar} size={20} />
                <PlayerName name={h.name} acct={h.acct} className="truncate" />
                <span className="text-dim">· seat {h.seat}</span>
              </span>
            }
            cards={h.cards}
            extra={
              <span className="flex items-center gap-2 text-[12px] text-muted">
                <span className="tnum">
                  {fmt(h.bet)}
                  {h.doubled ? ' (doubled)' : ''}
                </span>
                {h.auto && <span className="text-dim">auto-stood</span>}
              </span>
            }
            result={{ outcome: h.outcome, bet: h.bet, payout: h.payout }}
          />
        ))}
      </div>
    )

  return (
    <Modal onClose={onClose} title={`Round #${id}`} width={480}>
      <div className="flex flex-col gap-4">
        {body}
        {recent.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {recent.map((h) => (
              <button
                key={h.id}
                onClick={() => onPick(h.id)}
                className={`tnum rounded-full px-3 py-1.5 text-[12px] font-extrabold transition ${h.id === id ? 'bg-ink text-panel' : 'bg-raised text-ink/80 hover:bg-hover'}`}
              >
                {h.bj ? 'BJ' : h.total > 21 ? 'Bust' : h.total}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

function HandRow({ label, cards, extra, result }: { label: ReactNode; cards: number[]; extra?: ReactNode; result?: { outcome: Outcome; bet: number; payout: number } }) {
  const cs = cards.map((c, i) => toCard(c, i))
  return (
    <div className="rounded-xl bg-stage p-3">
      <div className="mb-2 flex items-center justify-between gap-2 text-[13px] font-bold">
        <span className="min-w-0 truncate">{label}</span>
        <span className="tnum shrink-0 rounded-full bg-raised px-2.5 py-1 text-[12px] font-extrabold">{cs.length ? fmtScore(cs) : '-'}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex">
          {cs.map((c, i) => (
            <motion.span key={i} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="-ml-3 first:ml-0">
              <CardFace rank={c.rank} suit={c.suit} width={40} height={56} className="drop-shadow-[0_3px_6px_rgba(0,0,0,.35)]" />
            </motion.span>
          ))}
        </div>
        <div className="flex flex-col items-end gap-1">
          {extra}
          {result && <ResultPill {...result} />}
        </div>
      </div>
    </div>
  )
}

const RESULT: Record<Outcome, [string, string]> = {
  win: ['Win', 'bg-accent text-[#032412]'],
  blackjack: ['Blackjack', 'bg-gold text-[#2a1c00]'],
  push: ['Push', 'bg-white text-[#0b1520]'],
  lose: ['Lose', 'bg-danger text-white'],
  bust: ['Bust', 'bg-danger text-white'],
}

/** The outcome badge's look, inline. */
function ResultPill({ outcome, bet, payout }: { outcome: Outcome; bet: number; payout: number }) {
  const [text, cls] = RESULT[outcome]
  return (
    <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold leading-none ${cls}`}>
      {text}
      {payout > bet && <span className="tnum ml-1.5">+{fmt(payout - bet)}</span>}
    </span>
  )
}
