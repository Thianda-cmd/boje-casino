import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Spinner } from '../../components/Loader'
import { Coin, IconChevron, IconUsers } from '../../components/icons'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { battlesSfx } from './sound'
import { useWallet } from '../../store/wallet'
import { BattleBannerArt, EMBER, GOLD, Swords } from './art'
import { CrateRuns, ModeChip, SeatRow, closesIn } from './bits'
import { roundAt } from './engine'
import { settleMissed } from './settle'
import { statusAt, type BattleServer, type BattleView, type ListFeed } from './types'
import { useFeed, type Clock } from './useBattle'

/* The Case Battles lobby: a banner with Create, your own battles, every open battle with a Join button, the battles
   being played right now and the latest results. Polling it also settles battles you paid into but didn't watch. */

export default function Lobby({
  server,
  who,
  connecting,
  onRetry,
  onCreate,
  onJoin,
}: {
  server: BattleServer
  who: string
  connecting: boolean
  onRetry: () => void
  onCreate: () => void
  onJoin: (b: BattleView) => Promise<void>
}) {
  const pushToast = useWallet((s) => s.pushToast)
  const started = useRef(new Set<number>())
  const { feed, failed, clock } = useFeed(server, (f: ListFeed) => {
    void settleMissed(server, who, { mine: f.mine })
    // a battle of yours filled while you were here: say so, once
    for (const b of f.mine) {
      if (b.status !== 'running' || started.current.has(b.id)) continue
      started.current.add(b.id)
      if (statusAt(b, f.now) === 'running' && b.startAt != null && f.now < b.startAt + 1500) {
        battlesSfx.join()
        pushToast({ kind: 'info', title: `Battle #${b.id} is starting` })
      }
    }
  })
  // battles already running when the lobby opened don't count as news
  const primed = useRef(false)
  if (feed && !primed.current) {
    primed.current = true
    for (const b of feed.mine) if (b.status !== 'open') started.current.add(b.id)
  }

  const mine = feed?.mine ?? []
  const players = feed ? new Set([...feed.open, ...feed.live].flatMap((b) => b.seats.filter((s) => s && !s.bot).map((s) => `${b.id}:${s!.seat}`))).size : 0

  return (
    <div className="flex flex-col gap-5">
      <section className="relative overflow-hidden rounded-2xl shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/5">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_72%_40%,#5a2410_0%,#2a1410_42%,#140f17_78%,#0f0d16_100%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_10%_120%,rgba(56,189,248,.16),transparent_55%)]" />
        <BattleBannerArt className="pointer-events-none absolute bottom-0 right-0 hidden h-full w-[58%] sm:block" />
        <div className="relative max-w-[560px] p-5 sm:p-8">
          <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider" style={{ color: EMBER }}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${server.online && !failed ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'animate-pulse bg-gold'}`} />
            {server.online ? 'Multiplayer' : 'Offline · house bots'}
          </div>
          <h1 className="mt-2 text-[28px] font-black leading-tight tracking-tight sm:text-[36px]">Case Battles</h1>
          <p className="mt-1 max-w-[420px] text-[14px] text-white/75 sm:text-[15px]">Open the same crates side by side. The biggest haul takes the whole pot, or the smallest in a crazy battle.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={onCreate}
              className="flex h-12 items-center gap-2 rounded-lg bg-gold px-5 text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.4)] transition hover:brightness-105"
            >
              <Swords size={18} /> Create battle
            </button>
            {feed && (
              <span className="flex items-center gap-1.5 text-[13px] font-bold text-white/70">
                <IconUsers size={16} /> {feed.open.length} open · {feed.live.length} live{server.online ? ` · ${players} ${players === 1 ? 'player' : 'players'}` : ''}
              </span>
            )}
          </div>
        </div>
      </section>

      {!server.online && (
        <div className="flex items-center gap-3 rounded-xl bg-panel2 p-3 text-[12px] leading-relaxed text-muted">
          <span className="flex-1">Playing offline: the shared battles can't be reached, so the house bots are your opponents.</span>
          <button onClick={onRetry} disabled={connecting} className="flex shrink-0 items-center gap-2 rounded-lg bg-raised px-3 py-2 font-bold text-ink transition hover:bg-hover disabled:opacity-50">
            {connecting && <Spinner size={12} />} Retry
          </button>
        </div>
      )}

      {mine.length > 0 && (
        <Section title="Your battles" count={mine.length}>
          {mine.map((b) => (
            <Row key={b.id} b={b} clock={clock} kind="mine" onJoin={onJoin} />
          ))}
        </Section>
      )}

      <Section title="Open battles" count={feed?.open.length} accent>
        {!feed ? (
          <Skeleton rows={3} />
        ) : feed.open.length ? (
          <AnimatePresence initial={false}>
            {feed.open.map((b) => (
              <Row key={b.id} b={b} clock={clock} kind="open" onJoin={onJoin} />
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <span className="text-[14px] font-bold text-ink">No battles waiting</span>
            <span className="max-w-[360px] text-[13px] text-muted">Create one and share the link, or play the house bots straight away.</span>
            <button onClick={onCreate} className="mt-1 h-10 rounded-lg bg-raised px-4 text-[13px] font-extrabold text-ink transition hover:bg-hover">
              Create battle
            </button>
          </div>
        )}
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Live now" count={feed?.live.length}>
          {!feed ? (
            <Skeleton rows={2} />
          ) : feed.live.length ? (
            feed.live.map((b) => <Row key={b.id} b={b} clock={clock} kind="live" onJoin={onJoin} />)
          ) : (
            <Empty>Nothing being opened right now.</Empty>
          )}
        </Section>
        <Section title="Recent results">
          {!feed ? <Skeleton rows={2} /> : feed.recent.length ? feed.recent.map((b) => <Row key={b.id} b={b} clock={clock} kind="recent" onJoin={onJoin} />) : <Empty>No finished battles yet.</Empty>}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, count, accent, children }: { title: string; count?: number; accent?: boolean; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex items-center gap-2">
        <h2 className="text-[17px] font-extrabold tracking-tight">{title}</h2>
        {count != null && count > 0 && (
          <span className="tnum rounded-full px-2 py-0.5 text-[11px] font-black" style={accent ? { background: `${EMBER}26`, color: EMBER } : { background: 'rgba(255,255,255,.07)', color: '#9fb3c8' }}>
            {count}
          </span>
        )}
      </div>
      <div className="overflow-hidden rounded-xl bg-panel ring-1 ring-white/5">{children}</div>
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className="px-4 py-6 text-center text-[13px] font-semibold text-dim">{children}</div>

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-[68px] animate-pulse border-b border-line/60 bg-panel2/40 last:border-0" />
      ))}
    </div>
  )
}

/** One battle in a list: mode, crates, seats, what it costs or how it's going, and a way in. */
function Row({ b, clock, onJoin }: { b: BattleView; clock: Clock; kind: 'open' | 'live' | 'recent' | 'mine'; onJoin: (b: BattleView) => Promise<void> }) {
  const balance = useWallet((s) => s.balance)
  const [joining, setJoining] = useState(false)
  const now = clock.now()
  const st = statusAt(b, now)
  const seated = b.seats.some((s) => s?.me)

  const open = () => navigate(`/game/battles/${b.id}`)
  const join = async () => {
    if (joining) return
    setJoining(true)
    await onJoin(b)
    setJoining(false)
  }

  const myPay = seated && b.payouts ? b.payouts[b.seats.findIndex((s) => s?.me)] : 0
  let side: ReactNode
  let action: ReactNode
  if (st === 'open') {
    side = (
      <div className="text-right">
        <div className="tnum flex items-center justify-end gap-1 text-[15px] font-black text-ink">
          {fmt(b.cost)} <Coin size={14} />
        </div>
        <div className="tnum text-[11px] font-semibold text-dim">
          closes <Ticking render={() => closesIn(b.expiresAt - clock.now())} />
        </div>
      </div>
    )
    action = seated ? (
      <RowButton onClick={open} tone="neutral">
        Open
      </RowButton>
    ) : (
      <RowButton onClick={join} disabled={joining || balance < b.cost} tone="accent">
        {joining ? <Spinner size={14} /> : 'Join'}
      </RowButton>
    )
  } else if (st === 'running') {
    side = (
      <Ticking
        render={() => {
          const t = clock.now()
          const r = roundAt(b, t)
          const n = b.cases.length
          const pct = b.startAt != null && t >= b.startAt ? Math.min(1, (t - b.startAt) / (n * b.roundMs)) : 0
          return (
            <div className="w-[92px] text-right">
              <div className="tnum text-[13px] font-extrabold text-ink">{r < 0 ? 'Starting' : `Round ${r + 1}/${n}`}</div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${pct * 100}%`, background: EMBER }} />
              </div>
            </div>
          )
        }}
      />
    )
    action = (
      <RowButton onClick={open} tone={seated ? 'gold' : 'neutral'}>
        {seated ? 'Back in' : 'Watch'}
      </RowButton>
    )
  } else {
    side = (
      <div className="text-right">
        {seated && st === 'done' ? (
          <div className={`tnum flex items-center justify-end gap-1 text-[15px] font-black ${myPay > 0 ? 'text-accent' : 'text-muted'}`}>
            {myPay > 0 ? `+${fmt(myPay)}` : 'Lost'} {myPay > 0 && <Coin size={14} />}
          </div>
        ) : (
          <div className="tnum flex items-center justify-end gap-1 text-[15px] font-black" style={{ color: st === 'done' ? GOLD : undefined }}>
            {st === 'done' && b.pot != null ? fmt(b.pot) : 'Called off'} {st === 'done' && <Coin size={14} />}
          </div>
        )}
        <div className="text-[11px] font-semibold text-dim">{st === 'done' ? (seated ? `pot ${fmt(b.pot ?? 0)}` : 'pot') : ''}</div>
      </div>
    )
    action = (
      <RowButton onClick={open} tone="neutral">
        View
      </RowButton>
    )
  }

  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.15 } }}
      transition={{ duration: 0.25 }}
      onClick={open}
      className="group grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-line/60 px-3 py-3 transition-colors last:border-0 hover:bg-panel2/60 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_118px_auto] sm:gap-y-1.5 sm:px-4"
    >
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2">
        <ModeChip mode={b.mode} crazy={b.crazy} size="sm" />
        <span className="tnum truncate text-[11px] font-bold text-dim">
          #{b.id} · {b.cases.length} {b.cases.length === 1 ? 'crate' : 'crates'}
        </span>
      </div>
      <div className="col-span-2 row-start-2 min-w-0 overflow-hidden sm:col-span-1 sm:col-start-1">
        <CrateRuns cases={b.cases} size={36} max={8} />
      </div>
      <div className="col-start-2 row-start-1 justify-self-end sm:row-span-2 sm:self-center sm:justify-self-center">
        <SeatRow b={b} size={30} winners={st === 'done' ? b.winners : null} />
      </div>
      <div className="col-start-1 row-start-3 sm:col-start-3 sm:row-span-2 sm:row-start-1 sm:self-center max-sm:[&>div]:text-left max-sm:[&>div>div]:justify-start">{side}</div>
      <div className="col-start-2 row-start-3 justify-self-end sm:col-start-4 sm:row-span-2 sm:row-start-1 sm:self-center" onClick={(e) => e.stopPropagation()}>
        {action}
      </div>
    </motion.div>
  )
}

function RowButton({ children, onClick, disabled, tone }: { children: ReactNode; onClick: () => void; disabled?: boolean; tone: 'accent' | 'gold' | 'neutral' }) {
  const tones = {
    accent: 'bg-accent text-[#032412] shadow-[inset_0_-2px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.3)] hover:brightness-110',
    gold: 'bg-gold text-[#2a1c00] shadow-[inset_0_-2px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-105',
    neutral: 'bg-raised text-ink hover:bg-hover',
  }
  return (
    <button onClick={onClick} disabled={disabled} className={`flex h-9 min-w-[76px] items-center justify-center gap-1 rounded-lg px-3 text-[13px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]}`}>
      {children}
      {tone === 'neutral' && <IconChevron size={14} className="opacity-60" />}
    </button>
  )
}

/** A bit of a row that moves with the clock (a countdown, a progress bar): it re-renders itself every second, so the
 *  row around it (and its layout animation) stays still. */
function Ticking({ render }: { render: () => ReactNode }) {
  const [, bump] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => bump((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return <>{render()}</>
}
