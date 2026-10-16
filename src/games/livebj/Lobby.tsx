import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { CardBack, CardFace } from '../../art/Card'
import { Chip } from '../../art/Chip'
import { IconUsers } from '../../components/icons'
import { fmt } from '../../lib/format'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { LiveDot, SoloNote } from './Panel'
import { settleMissed } from './settle'
import type { LobbyFeed, LobbyTable, TableServer } from './types'
import { arcSeat } from './view'

/* The Live Blackjack lobby: every listed table with who is sitting where and what the round is doing,
   a Quick seat button, and a way back to the table you're seated at. Polling it also keeps your seat. */

export default function Lobby({ server, connecting, onRetry, onOpen }: { server: TableServer; connecting: boolean; onRetry: () => void; onOpen: (table: number, sit: boolean) => void }) {
  const uid = useAuth((s) => s.uid)
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const [feed, setFeed] = useState<LobbyFeed | null>(null)
  const [failed, setFailed] = useState(false)
  const offset = useRef(0)
  const who = uid ?? 'guest'

  useEffect(() => {
    let stop = false
    let timer = 0
    const tick = async () => {
      clearTimeout(timer)
      const t0 = Date.now()
      try {
        const f = await server.tables()
        if (stop) return
        offset.current = f.now - (t0 + Date.now()) / 2
        setFeed(f)
        setFailed(false)
        if (!f.mine || f.mine.active) void settleMissed(server, who, server.online ? 'shared' : 'local', null, [])
      } catch {
        if (!stop) setFailed(true)
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 10000 : 3000)
    }
    tick()
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [server, who])

  const mine = feed?.mine ?? null
  const seated = mine ? feed!.tables.find((t) => t.id === mine.table) : null
  const playing = feed?.tables.reduce((a, t) => a + t.players.length, 0) ?? 0

  const quickSeat = () => {
    if (!feed) return
    // the busiest affordable table that still has room, then the cheapest
    const pick = feed.tables
      .filter((t) => t.players.length < t.seats && t.min <= balance)
      .sort((a, b) => b.players.length - a.players.length || a.min - b.min)[0]
    if (pick) onOpen(pick.id, true)
    else pushToast({ kind: 'info', title: feed.tables.some((t) => t.players.length < t.seats) ? 'Not enough coins for a free seat. Visit Rewards to earn more.' : 'Every table is full right now.' })
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-2xl shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_20%,#1f7a5c_0%,#125240_45%,#0a3027_85%,#08251f_100%)] shadow-[inset_0_0_90px_20px_rgba(0,0,0,.35)]" />
        <BannerArt />
        <div className="relative max-w-[560px] p-5 sm:p-8">
          <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider text-gold">
            <LiveDot live={server.online && !failed} /> {server.online ? 'Live tables' : 'Offline tables'}
          </div>
          <h1 className="mt-2 text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">Live Blackjack</h1>
          <p className="mt-1 text-[14px] text-white/75 sm:text-[15px]">Real players, one shoe. Pull up a seat at a shared table.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            {seated ? (
              <button
                onClick={() => onOpen(seated.id, false)}
                className="h-12 rounded-lg bg-gold px-5 text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.4)] transition hover:brightness-105"
              >
                Back to {seated.name} · seat {mine!.seat}
              </button>
            ) : (
              <button
                onClick={quickSeat}
                disabled={!feed}
                className="h-12 rounded-lg bg-accent px-6 text-[15px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110 disabled:opacity-50"
              >
                Quick seat
              </button>
            )}
            {feed && (
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-white/70">
                <IconUsers size={16} /> {playing} {playing === 1 ? 'player' : 'players'} at {feed.tables.length} tables
              </span>
            )}
          </div>
        </div>
      </section>

      {!server.online && <SoloNote connecting={connecting} onRetry={onRetry} />}

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {feed
          ? feed.tables.map((t, i) => <TableCard key={t.id} t={t} i={i} offset={offset.current} mine={mine?.table === t.id ? mine.seat : null} seatedElsewhere={!!mine && mine.table !== t.id} onOpen={onOpen} />)
          : Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[248px] animate-pulse rounded-xl bg-panel" />)}
      </div>
    </div>
  )
}

/** A hand and a few chips on the right of the banner. */
function BannerArt() {
  return (
    <svg className="pointer-events-none absolute bottom-0 right-3 hidden h-full w-[46%] sm:block" viewBox="0 0 300 220" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <g transform="rotate(-14 130 120)" style={{ filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.4))' }}>
        <CardFace rank="A" suit="♠" x={92} y={40} width={86} height={120} />
      </g>
      <g transform="rotate(9 190 120)" style={{ filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.4))' }}>
        <CardFace rank="K" suit="♥" x={146} y={44} width={86} height={120} />
      </g>
      <Chip value={100} size={46} x={238} y={158} />
      <Chip value={100} size={46} x={238} y={150} />
      <Chip value={25} size={46} x={238} y={142} />
      <Chip value={500} size={40} x={44} y={168} />
    </svg>
  )
}

function SecondsLeft({ to, offset }: { to: number; offset: number }) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [])
  return <span className="tnum">{Math.max(0, Math.ceil((to - Date.now() - offset) / 1000))}s</span>
}

function PhaseChip({ t, offset }: { t: LobbyTable; offset: number }) {
  const [text, cls] =
    t.phase === 'betting'
      ? [
          <>
            Betting {t.betEndsAt != null && <SecondsLeft to={t.betEndsAt} offset={offset} />}
          </>,
          'bg-gold/15 text-gold',
        ]
      : t.phase === 'playing'
        ? ['In play', 'bg-accent/15 text-accent']
        : t.phase === 'done'
          ? ['Results', 'bg-sky/15 text-sky']
          : ['Waiting', 'bg-raised text-muted']
  return <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-extrabold ${cls}`}>{text}</span>
}

function TableCard({ t, i, offset, mine, seatedElsewhere, onOpen }: { t: LobbyTable; i: number; offset: number; mine: number | null; seatedElsewhere: boolean; onOpen: (table: number, sit: boolean) => void }) {
  const full = t.players.length >= t.seats
  const btn = 'h-10 rounded-lg text-[13px] font-extrabold transition disabled:opacity-45'
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 26 }}
      className={`flex flex-col overflow-hidden rounded-xl bg-panel shadow-[0_14px_30px_-16px_rgba(0,0,0,.9)] ring-1 ${mine ? 'ring-gold/50' : 'ring-white/5'}`}
    >
      <button onClick={() => onOpen(t.id, false)} className="relative h-32 w-full overflow-hidden" aria-label={`Watch ${t.name}`}>
        <MiniTable t={t} mine={mine} />
      </button>
      <div className="flex flex-1 flex-col p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold">{t.name}</div>
            <div className="tnum text-[12px] font-semibold text-muted">
              {fmt(t.min, 0)} – {fmt(t.max, 0)}
            </div>
          </div>
          <PhaseChip t={t} offset={offset} />
        </div>
        <div className="mt-1.5 text-[12px] text-dim">
          {t.players.length} playing · {t.watchers} watching
        </div>
        <div className="mt-auto pt-3">
          {mine ? (
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[12px] font-bold text-gold">You're at seat {mine}</span>
              <button onClick={() => onOpen(t.id, false)} className={`${btn} bg-gold px-4 text-[#2a1c00] hover:brightness-105`}>
                Return
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onOpen(t.id, true)} disabled={full} className={`${btn} bg-accent text-[#032412] hover:brightness-110`} title={seatedElsewhere ? 'Moves you from your other table' : undefined}>
                {full ? 'Full' : 'Sit'}
              </button>
              <button onClick={() => onOpen(t.id, false)} className={`${btn} bg-raised text-ink hover:bg-hover`}>
                Watch
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

/** A little felt with the five seats: avatars where someone sits, dashed rings where nobody does. */
function MiniTable({ t, mine }: { t: LobbyTable; mine: number | null }) {
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_10%,#1f7a5c_0%,#125240_50%,#0a3027_100%)]" />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path d="M 4 34 Q 50 72 96 34" fill="none" stroke="rgba(247,197,72,.35)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="absolute left-1/2 top-[10%] flex -translate-x-1/2">
        {[-8, 8].map((r) => (
          <CardBack key={r} width={18} height={25} className="-mx-0.5 drop-shadow-[0_2px_3px_rgba(0,0,0,.4)]" style={{ transform: `rotate(${r}deg)` }} />
        ))}
      </div>
      {Array.from({ length: t.seats }, (_, i) => {
        const seat = i + 1
        const p = arcSeat(seat, t.seats)
        const who = t.players.find((x) => x.seat === seat)
        return (
          <div key={seat} className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: `${p.x}%`, top: `${p.y - 6}%` }}>
            {who ? (
              <div className={`rounded-full ${mine === seat ? 'ring-2 ring-gold ring-offset-2 ring-offset-[#125240]' : ''}`} title={who.name}>
                <Avatar index={who.avatar} size={26} />
              </div>
            ) : (
              <span className="block h-[26px] w-[26px] rounded-full border-2 border-dashed border-white/20" />
            )}
          </div>
        )
      })}
    </div>
  )
}
