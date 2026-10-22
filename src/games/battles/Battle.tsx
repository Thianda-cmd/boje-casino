import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { BojeLoader, Spinner } from '../../components/Loader'
import { Coin, IconChevron } from '../../components/icons'
import { AnimatedNumber, useStake } from '../../components/ui'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { casesSfx } from '../cases/sound'
import { battlesSfx } from './sound'
import { useWallet } from '../../store/wallet'
import { CrateArt, ItemArt, twinkle } from '../cases/art'
import { CRATES, RARITIES, RARITY, multLabel, type Rarity, type Tier } from '../cases/rules'
import { RARITY_TEXT } from '../cases/tiles'
import { battleLink, callBots, copyText, createBattle, joinBattle, leaveBattle, mySeat } from './actions'
import { CRAZY, CrazyMark, Crown, EMBER, GOLD, TEAM, VsBadge } from './art'
import { ModeChip, TagChip, closesIn } from './bits'
import { PlayerName } from '../../components/profile/PlayerName'
import { itemOfMult, landedBy, leadersAfter, roundAt, roundLand, roundStart, sideOf, totalsAfter } from './engine'
import { Reel } from './Reel'
import { Burst, Sparkles } from '../cases/LootReel'
import { settleMissed, settleView, srcOfServer } from './settle'
import { isNew, keyOf, pending, pendingAll } from './ledger'
import { SEATS, isAccount, statusAt, type BattleServer, type BattleView, type SeatView } from './types'
import { battleInstants, useBattle, useInstants, useMeasure, type Clock } from './useBattle'

/*
  One battle, #/game/battles/<id>: a column per seat with the player, their running total, their reel and the items
  they've pulled so far, under the row of crates being opened. While it waits for players, empty seats offer Join (or
  Call bots to whoever sits in it); once full, a 3-2-1 countdown, then every reel spins at once each round and lands on
  its seat's item, the totals count up, and at the end the winners are crowned and paid. Everything is timed by the
  server's clock, so everyone watching sees the same moment, and a reload picks the battle up where it is.
*/

export default function Battle({ server, id, who, name, connecting, onRetry }: { server: BattleServer; id: number; who: string; name: string; connecting: boolean; onRetry: () => void }) {
  const { view: v, accept, clock, gone, reconnecting, poll } = useBattle(server, id)
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const [busy, setBusy] = useState<string | null>(null)
  const [areaRef, area] = useMeasure<HTMLDivElement>({ w: 1000, h: 600 })

  useInstants(battleInstants(v), clock.now)
  const now = clock.now()
  const st = v ? statusAt(v, now) : null

  // the stake on this battle: paid at the reveal, refunded if it's called off or the seat was never ours; checked when
  // the battle changes and every few seconds while a stake on it is still open (a join whose answer was lost)
  const viewRef = useRef(v)
  viewRef.current = v
  useEffect(() => {
    let alive = true
    const check = () => {
      const b = viewRef.current
      if (!b || !pending(who, keyOf(srcOfServer(server), b.id))) return
      void settleView(server, who, b, clock.now()).then((r) => {
        if (alive && r === 'refunded') pushToast({ kind: 'info', title: b.status === 'cancelled' ? 'Battle called off. Your stake is back.' : 'You have no seat in this battle. Your stake is back.' })
      })
    }
    check()
    const id = window.setInterval(check, 4000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [v, st, server, who, clock, pushToast])

  // every other battle this browser paid into (one still open while you watch this, one you left mid-spin) pays out
  // from here too: App only covers the pages outside Case Battles, and the lobby isn't on screen
  useEffect(() => {
    let alive = true
    let busy = false
    const here = keyOf(srcOfServer(server), id)
    const run = async () => {
      const all = pendingAll(who)
      if (busy || !alive || !Object.keys(all).some((k) => k !== here)) return
      busy = true
      try {
        // a create whose answer was lost is found among your own battles
        const mine = Object.keys(all).some(isNew) ? ((await server.list().catch(() => null))?.mine ?? null) : null
        if (alive) await settleMissed(server, who, { current: id, mine })
      } finally {
        busy = false
      }
    }
    run()
    const t = window.setInterval(run, 5000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [server, who, id])

  // the beats of the show, played only as they happen (never for moments that passed before the page opened)
  const prevT = useRef<number | null>(null)
  const filled = useRef<number | null>(null)
  useEffect(() => {
    if (!v) return
    const t = clock.now()
    const prev = prevT.current ?? t
    prevT.current = t
    const seated = v.seats.filter(Boolean).length
    if (filled.current != null && seated > filled.current && v.status === 'open') battlesSfx.join()
    filled.current = seated
    if (prev >= t || v.startAt == null) return
    const hit = (x: number | null) => x != null && x > prev && x <= t && t - x < 900
    for (const k of [3, 2, 1]) if (hit(v.startAt - k * 1000)) battlesSfx.count(k)
    if (hit(v.startAt)) {
      battlesSfx.count(0)
      battlesSfx.push()
    }
    for (let r = 1; r < v.cases.length; r++) if (hit(roundStart(v, r))) battlesSfx.push()
    for (let r = 0; r < v.cases.length; r++)
      if (hit(roundLand(v, r)) && v.results) {
        const best = Math.max(...v.results.map((row) => RARITIES.indexOf(CRATES[v.cases[r]].items[itemOfMult(v.cases[r], row[r])].rarity)))
        casesSfx.land(best)
      }
    if (v.endAt != null) {
      if (hit(v.endAt - 1500)) battlesSfx.roll(1.3)
      const me = mySeat(v)
      if (hit(v.endAt)) battlesSfx.reveal(me ? !!v.winners?.includes(me) : true)
    }
  })

  const act = async (what: string, fn: () => Promise<BattleView | null | boolean>) => {
    if (busy) return
    setBusy(what)
    try {
      const r = await fn()
      if (r && typeof r === 'object') accept(r)
      return r
    } finally {
      setBusy(null)
      poll()
    }
  }

  if (gone)
    return (
      <Shell>
        <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 rounded-2xl bg-panel2/50 px-4 text-center">
          <CrateArt tier="medium" size={84} />
          <p className="text-[16px] font-extrabold">This battle is gone</p>
          <p className="max-w-[340px] text-[13px] text-muted">Finished battles are cleared after a week, and offline battles only live in the browser that made them.</p>
          <button onClick={() => navigate('/game/battles')} className="mt-2 h-10 rounded-lg bg-raised px-4 text-[13px] font-extrabold text-ink transition hover:bg-hover">
            Back to battles
          </button>
        </div>
      </Shell>
    )
  if (!v)
    return (
      <Shell>
        <div className="flex h-[calc(100dvh-170px)] min-h-[420px] items-center justify-center rounded-2xl bg-panel2/50">
          <BojeLoader />
        </div>
      </Shell>
    )

  const n = v.seats.length
  const me = mySeat(v)
  const r = roundAt(v, now)
  const nLanded = landedBy(v, now)
  const revealed = st === 'done'
  const finale = v.endAt != null && nLanded === v.cases.length && !revealed
  const countdown = st === 'running' && v.startAt != null && now < v.startAt ? Math.ceil((v.startAt - now) / 1000) : 0
  const totals = totalsAfter(v, nLanded)
  const leaders = st === 'running' && !finale ? leadersAfter(v, nLanded) : []
  // the pot as it builds; the server's own figure (floored to the cent) once the winner shows
  const potSoFar = revealed && v.pot != null ? v.pot : Math.round(totals.reduce((a, t) => a + t, 0) * v.unit * 100) / 100

  // the columns: as wide as the arena allows; a 2v2 leaves a wider gap between the sides
  const phone = area.w < 640
  const gap = phone ? 6 : 14
  const mid = v.mode === '2v2' ? (phone ? 14 : 30) : gap
  const colW = (area.w - gap * (n - 1) - (mid - gap)) / n
  const compact = colW < 150
  const tileW = Math.round(compact ? Math.max(46, Math.min(84, colW - 14)) : Math.max(84, Math.min(128, colW * 0.42)))
  const reelW = Math.round(compact ? colW - 4 : Math.min(colW - 20, tileW + 48))
  const reelH = Math.round(tileW * (compact ? 2.5 : 2.7))

  const copy = async () => {
    sfx.click()
    pushToast({ kind: 'info', title: (await copyText(battleLink(v.id))) ? 'Link copied. Send it to a friend.' : "Couldn't copy the link." })
  }
  const join = (seat: number | null) => act('join', () => joinBattle(server, who, v, seat, name, stake))
  const bots = () => act('bots', () => callBots(server, v.id))
  const leave = () =>
    act('leave', async () => {
      const ok = await leaveBattle(server, who, v.id)
      if (ok) navigate('/game/battles')
      return ok
    })
  const recreate = () =>
    act('recreate', async () => {
      const b = await createBattle(server, who, { mode: v.mode, crazy: v.crazy, unit: v.unit, cases: v.cases }, name, false, stake)
      if (b) navigate(`/game/battles/${b.id}`)
      return null
    })

  return (
    <Shell>
      <TopBar v={v} st={st!} pot={st === 'open' ? null : potSoFar} live={server.online && !reconnecting} onCopy={copy} />
      {!server.online && (
        <div className="flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2 text-[12px] text-muted">
          <span className="flex-1">Offline battle: only the house bots can join.</span>
          <button onClick={onRetry} disabled={connecting} className="flex shrink-0 items-center gap-2 rounded-lg bg-raised px-3 py-1.5 font-bold text-ink transition hover:bg-hover disabled:opacity-50">
            {connecting && <Spinner size={12} />} Retry online
          </button>
        </div>
      )}
      <div className="relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_50%_0%,#1b3044_0%,#0d1b27_55%,#0a1620_100%)] shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
        <CrateTrack cases={v.cases} round={st === 'open' ? -1 : r} landed={nLanded} done={revealed} phone={phone} />
        {v.mode === '2v2' && <TeamBar v={v} totals={totals} revealed={revealed} leaders={leaders} phone={phone} />}
        <div className={`relative ${phone ? 'px-2 pb-2' : 'px-4 pb-4'} ${v.mode === '2v2' ? '' : phone ? 'pt-2' : 'pt-3'}`}>
          <div ref={areaRef} className="flex items-start" style={{ gap }}>
            {v.seats.map((s, i) => {
              const seat = i + 1
              const split = i > 0 && sideOf(v.mode, seat) !== sideOf(v.mode, seat - 1)
              return (
                <div key={i} className="relative" style={{ width: colW, marginLeft: split && v.mode === '2v2' ? mid - gap : 0 }}>
                  {i > 0 && (v.mode === '2v2' ? split : !compact) && (
                    <div className="pointer-events-none absolute z-10" style={{ left: -(split && v.mode === '2v2' ? mid : gap) / 2, top: (compact ? 102 : 62) + reelH / 2, transform: 'translate(-50%,-50%)' }}>
                      <VsBadge size={compact ? 24 : 34} color={v.crazy ? CRAZY : EMBER} />
                    </div>
                  )}
                  <SeatColumn
                    v={v}
                    s={s}
                    seat={seat}
                    clock={clock}
                    round={r}
                    nLanded={nLanded}
                    total={totals[i]}
                    leading={leaders.includes(seat)}
                    revealed={revealed}
                    finale={finale}
                    compact={compact}
                    colW={colW}
                    reelW={reelW}
                    reelH={reelH}
                    tileW={tileW}
                    ticks={me ? seat === me : seat === 1}
                    canJoin={st === 'open' && !me}
                    canBots={st === 'open' && !!me}
                    busy={busy}
                    afford={balance >= v.cost}
                    onJoin={() => join(seat)}
                    onBots={bots}
                  />
                </div>
              )
            })}
          </div>
          <AnimatePresence>{countdown > 0 && <Countdown key="cd" n={countdown} crazy={v.crazy} />}</AnimatePresence>
          <WinnerCard v={v} revealed={revealed} me={me} now={now} top={(compact ? 102 : 62) + reelH / 2 + (phone ? 8 : 12)} />
        </div>
      </div>
      <ActionBar v={v} st={st!} now={now} me={me} busy={busy} afford={balance >= v.cost} onJoin={() => join(null)} onBots={bots} onLeave={leave} onRecreate={recreate} />
    </Shell>
  )
}

const Shell = ({ children }: { children: ReactNode }) => <div className="flex flex-col gap-3">{children}</div>

function TopBar({ v, st, pot, live, onCopy }: { v: BattleView; st: string; pot: number | null; live: boolean; onCopy: () => void }) {
  const status = st === 'open' ? 'Waiting for players' : st === 'running' ? 'Live' : st === 'done' ? 'Finished' : 'Called off'
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <button onClick={() => navigate('/game/battles')} aria-label="Back to battles" className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-raised pl-2 pr-2 text-[13px] font-bold sm:pr-3 text-muted transition hover:bg-hover hover:text-ink">
        <IconChevron size={16} className="rotate-180" /> <span className="max-sm:hidden">Battles</span>
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${st === 'running' ? (live ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'animate-pulse bg-gold') : st === 'open' ? 'animate-pulse bg-gold' : 'bg-dim'}`} />
          <span className="truncate text-[15px] font-extrabold">Battle #{v.id}</span>
          <span className="hidden truncate text-[12px] font-bold text-muted sm:inline">{status}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[12px] font-semibold text-muted">
          <ModeChip mode={v.mode} crazy={v.crazy} size="sm" />
          <span className="tnum truncate">
            {v.cases.length} {v.cases.length === 1 ? 'crate' : 'crates'} · {fmt(v.cost)} a seat
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {pot != null && (
          <div className="flex h-10 items-center gap-2 rounded-lg bg-stage px-3">
            <span className="text-[11px] font-extrabold uppercase tracking-wide text-dim">Pot</span>
            <AnimatedNumber value={pot} className="text-[15px] font-black" />
            <Coin size={15} />
          </div>
        )}
        <button onClick={onCopy} className="flex h-10 items-center gap-1.5 rounded-lg bg-raised px-3 text-[13px] font-bold text-muted transition hover:bg-hover hover:text-ink" title="Copy a link to this battle">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
          <span className="hidden sm:inline">Copy link</span>
        </button>
      </div>
    </div>
  )
}

/** The crates in order along the top: the one being opened lifted and lit, the opened ones dimmed and ticked. */
function CrateTrack({ cases, round, landed, done, phone }: { cases: Tier[]; round: number; landed: number; done: boolean; phone: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const size = phone ? 34 : 44
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`[data-r="${round}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [round])
  return (
    <div className={`flex items-center gap-3 border-b border-white/5 bg-black/15 ${phone ? 'px-2 py-2' : 'px-4 py-2.5'}`}>
      <div className="shrink-0 leading-tight">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-dim">Round</div>
        <div className="tnum text-[15px] font-black text-ink">
          {done ? cases.length : Math.max(0, round + 1)}
          <span className="text-dim">/{cases.length}</span>
        </div>
      </div>
      <div ref={ref} className="no-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 sm:gap-2">
        {cases.map((t, i) => {
          const cur = i === round && !done
          const opened = i < landed
          return (
            <div
              key={i}
              data-r={i}
              className="relative shrink-0 rounded-lg transition-all duration-300"
              style={{
                padding: phone ? 3 : 4,
                background: cur ? `${EMBER}22` : 'rgba(255,255,255,.035)',
                boxShadow: cur ? `inset 0 0 0 2px ${EMBER}, 0 0 18px -6px ${EMBER}` : 'inset 0 0 0 1px rgba(255,255,255,.05)',
                transform: cur ? 'translateY(-1px) scale(1.06)' : undefined,
                opacity: opened && !cur ? 0.5 : 1,
              }}
              title={`Round ${i + 1}: ${CRATES[t].name}`}
            >
              <CrateArt tier={t} size={size} />
              {opened && !cur && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[#032412]">
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
                    <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A 2v2's two sides and their totals. */
function TeamBar({ v, totals, revealed, leaders, phone }: { v: BattleView; totals: number[]; revealed: boolean; leaders: number[]; phone: boolean }) {
  const side = (k: 0 | 1) => {
    const t = (totals[k * 2] ?? 0) + (totals[k * 2 + 1] ?? 0)
    const won = revealed && !!v.winners?.includes(k * 2 + 1)
    const lead = leaders.includes(k * 2 + 1)
    return (
      <div className={`flex min-w-0 flex-1 items-center gap-2 ${k ? 'flex-row-reverse text-right' : ''}`} style={{ opacity: revealed && !won ? 0.5 : 1 }}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: TEAM[k], boxShadow: `0 0 10px ${TEAM[k]}` }} />
        <span className="truncate text-[12px] font-extrabold uppercase tracking-wider" style={{ color: TEAM[k] }}>
          Team {k ? 'B' : 'A'}
        </span>
        {won && <Crown size={18} />}
        {lead && !phone && (
          <span className="rounded px-1 text-[9.5px] font-black uppercase" style={{ color: v.crazy ? CRAZY : GOLD, background: v.crazy ? `${CRAZY}22` : `${GOLD}22` }}>
            {v.crazy ? 'Lowest' : 'Ahead'}
          </span>
        )}
        <span className={`tnum flex items-center gap-1 font-black text-ink ${phone ? 'text-[13px]' : 'text-[15px]'} ${k ? 'mr-auto' : 'ml-auto'}`}>
          <AnimatedNumber value={Math.round(t * v.unit * 100) / 100} />
          <Coin size={13} />
        </span>
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-3 ${phone ? 'px-2 pt-2 pb-1.5' : 'px-4 pt-3 pb-2'}`}>
      {side(0)}
      <span className="shrink-0 text-[11px] font-black uppercase text-dim">vs</span>
      {side(1)}
    </div>
  )
}

const SeatColumn = memo(function SeatColumn({
  v,
  s,
  seat,
  clock,
  round,
  nLanded,
  total,
  leading,
  revealed,
  finale,
  compact,
  colW,
  reelW,
  reelH,
  tileW,
  ticks,
  canJoin,
  canBots,
  busy,
  afford,
  onJoin,
  onBots,
}: {
  v: BattleView
  s: SeatView | null
  seat: number
  clock: Clock
  round: number
  nLanded: number
  total: number
  leading: boolean
  revealed: boolean
  finale: boolean
  compact: boolean
  colW: number
  reelW: number
  reelH: number
  tileW: number
  ticks: boolean
  canJoin: boolean
  canBots: boolean
  busy: string | null
  afford: boolean
  onJoin: () => void
  onBots: () => void
}) {
  const won = revealed && !!v.winners?.includes(seat)
  const lost = revealed && !won
  const team = v.mode === '2v2' ? TEAM[sideOf(v.mode, seat)] : null
  const payout = v.payouts?.[seat - 1] ?? 0
  const running = v.status !== 'open' && v.status !== 'cancelled'
  const items = useMemo(() => {
    const out: { r: number; tier: Tier; mult: number }[] = []
    for (let r = nLanded - 1; r >= 0; r--) {
      const m = v.results?.[seat - 1]?.[r]
      if (m != null) out.push({ r, tier: v.cases[r], mult: m })
    }
    return out
  }, [v.results, v.cases, seat, nLanded])

  // an epic or legendary pull this round: a halo behind the reel and a few twinkles
  const curMult = round >= 0 && nLanded > round ? v.results?.[seat - 1]?.[round] : undefined
  const curRarity = curMult != null ? CRATES[v.cases[round]].items[itemOfMult(v.cases[round], curMult)].rarity : null
  const big = !revealed && (curRarity === 'epic' || curRarity === 'legendary') ? curRarity : null
  const ring = won ? `0 0 0 2px ${GOLD}, 0 0 34px -6px ${GOLD}` : leading ? `0 0 0 1.5px ${v.crazy ? CRAZY : EMBER}aa` : 'inset 0 0 0 1px rgba(255,255,255,.05)'
  return (
    <div
      className="relative flex flex-col items-center rounded-xl transition-[box-shadow,background] duration-500"
      style={{ background: won ? 'linear-gradient(180deg, rgba(255,194,61,.12), rgba(13,26,38,.75) 40%)' : 'rgba(13,26,38,.72)', boxShadow: ring }}
    >
      {team && <div className="absolute inset-x-3 top-0 h-[3px] rounded-b-full" style={{ background: team }} />}
      <SeatHeader v={v} s={s} seat={seat} total={total} payout={payout} won={won} lost={lost} leading={leading} finale={finale} compact={compact} team={team} />
      <div className={`relative ${compact ? 'mt-1' : 'mt-1.5'} transition-[opacity,filter] duration-700`} style={{ opacity: lost ? 0.42 : 1, filter: lost ? 'saturate(.35)' : undefined }}>
        <AnimatePresence>{big && <Burst key={`b${round}`} rarity={big} x={0} reelH={Math.round(tileW * 1.25)} tileW={tileW} />}</AnimatePresence>
        {s || running ? (
          <Reel battle={v} seat={seat} clock={clock} round={round} landed={nLanded > round && round >= 0} width={reelW} tileW={tileW} height={reelH} ticks={ticks} idle={!running} />
        ) : (
          <EmptySeat w={reelW} h={reelH} compact={compact} canJoin={canJoin} canBots={canBots} busy={busy} afford={afford} cost={v.cost} onJoin={onJoin} onBots={onBots} />
        )}
        <AnimatePresence>{big && <Sparkles key={`s${round}`} rarity={big} x={0} tileW={tileW} tileH={Math.round(tileW * 0.92)} />}</AnimatePresence>
        {s && !running && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-1 rounded-full bg-[#0b1621]/90 px-2.5 py-1 text-[11px] font-extrabold text-accent ring-1 ring-accent/30">
              <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 6.2 5 8.6l4.5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Ready
            </span>
          </div>
        )}
      </div>
      <Stack items={items} unit={v.unit} compact={compact} colW={colW} lost={lost} />
    </div>
  )
})

function SeatHeader({
  v,
  s,
  seat,
  total,
  payout,
  won,
  lost,
  leading,
  finale,
  compact,
  team,
}: {
  v: BattleView
  s: SeatView | null
  seat: number
  total: number
  payout: number
  won: boolean
  lost: boolean
  leading: boolean
  finale: boolean
  compact: boolean
  team: string | null
}) {
  const coins = Math.round(total * v.unit * 100) / 100
  const size = compact ? 30 : 40
  const avatar = s ? (
    <span className="relative block rounded-full" style={{ boxShadow: `0 0 0 2px #0d1a26, 0 0 0 3.5px ${won ? GOLD : team ?? (s.me ? '#22d36f' : 'rgba(255,255,255,.12)')}` }}>
      <Avatar index={s.avatar} size={size} />
      <AnimatePresence>
        {won && (
          <motion.span className="absolute left-1/2 top-0" initial={{ y: -26, x: '-50%', opacity: 0, rotate: -18 }} animate={{ y: -size * 0.62, x: '-50%', opacity: 1, rotate: -8 }} transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.15 }}>
            <Crown size={Math.round(size * 0.72)} className="drop-shadow-[0_3px_3px_rgba(0,0,0,.5)]" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  ) : (
    <span className="block rounded-full border-2 border-dashed border-white/20 bg-[#0b1621]" style={{ width: size, height: size }} />
  )
  const totalEl = (
    <span className={`tnum flex shrink-0 items-center gap-1 font-black ${compact ? 'text-[12px]' : 'text-[16px]'} ${finale ? 'animate-pulse' : ''}`} style={{ color: won ? GOLD : '#eef4f9' }}>
      <AnimatedNumber value={coins} />
      <Coin size={compact ? 11 : 15} />
    </span>
  )
  const badge = won ? (
    <motion.span
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.25 }}
      className={`tnum rounded-md font-black text-[#2a1c00] ${compact ? 'px-1 text-[10px]' : 'px-1.5 py-0.5 text-[12px]'}`}
      style={{ background: GOLD }}
    >
      +{fmt(payout)}
    </motion.span>
  ) : leading ? (
    <span className={`rounded px-1 font-black uppercase ${compact ? 'text-[8.5px]' : 'text-[9.5px]'}`} style={{ color: v.crazy ? CRAZY : GOLD, background: v.crazy ? `${CRAZY}22` : `${GOLD}22` }}>
      {v.crazy ? 'Lowest' : 'Leading'}
    </span>
  ) : null

  if (compact)
    return (
      <div className="flex w-full flex-col items-center gap-1 px-1 pt-2.5 text-center" style={{ opacity: lost ? 0.6 : 1 }}>
        {avatar}
        <span className="flex w-full min-w-0 items-center justify-center gap-1">
          {s ? <PlayerName name={s.name} acct={isAccount(s)} className="truncate text-[11px] font-extrabold text-ink" /> : <span className="truncate text-[11px] font-extrabold text-ink">Open seat</span>}
        </span>
        {s ? totalEl : <span className="text-[11px] font-bold text-dim">—</span>}
        <span className="flex h-4 items-center">{badge ?? (s ? <TagChip s={s} /> : null)}</span>
      </div>
    )
  return (
    <div className="flex w-full items-center gap-2.5 px-3 pb-1 pt-3" style={{ opacity: lost ? 0.6 : 1 }}>
      {avatar}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {s ? <PlayerName name={s.name} acct={isAccount(s)} className="truncate text-[14px] font-extrabold text-ink" /> : <span className="truncate text-[14px] font-extrabold text-ink">Open seat</span>}
          {s && <TagChip s={s} />}
        </div>
        <div className="flex h-5 items-center gap-1.5 text-[11px] font-semibold text-dim">{badge ?? (team ? <span style={{ color: team }}>Team {seat <= 2 ? 'A' : 'B'}</span> : `Seat ${seat}`)}</div>
      </div>
      {s && totalEl}
    </div>
  )
}

/** An empty seat while the battle waits: a Join button for a spectator, Call bots for whoever's already in. */
function EmptySeat({ w, h, compact, canJoin, canBots, busy, afford, cost, onJoin, onBots }: { w: number; h: number; compact: boolean; canJoin: boolean; canBots: boolean; busy: string | null; afford: boolean; cost: number; onJoin: () => void; onBots: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-white/10 bg-[#08131c]/70 px-2 text-center" style={{ width: w, height: h }}>
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-white/40" animate={{ opacity: [0.25, 1, 0.25] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />
        ))}
      </span>
      <span className={`font-bold text-muted ${compact ? 'text-[10.5px]' : 'text-[12px]'}`}>Waiting for a player</span>
      {canJoin && (
        <button onClick={onJoin} disabled={!!busy || !afford} className={`flex items-center justify-center gap-1 rounded-lg bg-accent font-extrabold text-[#032412] shadow-[inset_0_-2px_0_rgba(0,0,0,.16)] transition hover:brightness-110 disabled:opacity-45 ${compact ? 'h-8 w-full px-1 text-[11px]' : 'h-9 px-4 text-[13px]'}`}>
          {busy === 'join' ? <Spinner size={13} /> : compact ? 'Join' : <>Join · {fmt(cost)}</>}
        </button>
      )}
      {canBots && (
        <button onClick={onBots} disabled={!!busy} className={`flex items-center justify-center gap-1.5 rounded-lg bg-raised font-extrabold text-ink transition hover:bg-hover disabled:opacity-45 ${compact ? 'h-8 w-full px-1 text-[11px]' : 'h-9 px-4 text-[13px]'}`}>
          {busy === 'bots' ? <Spinner size={13} /> : compact ? 'Bots' : 'Call bots'}
        </button>
      )}
    </div>
  )
}

/** The items a seat has pulled, newest on top, each with what it's worth at this battle's stake. */
function Stack({ items, unit, compact, colW, lost }: { items: { r: number; tier: Tier; mult: number }[]; unit: number; compact: boolean; colW: number; lost: boolean }) {
  // fixed-width cards (80 to 112 px), centred under the reel, as many to a row as fit, so ten crates stay a short stack
  const cols = compact ? 1 : Math.max(1, Math.min(5, Math.floor((colW - 16 + 6) / (80 + 6))))
  const cardW = compact ? 0 : Math.min(112, Math.floor((colW - 16 - (cols - 1) * 6) / cols))
  return (
    <div
      className={`flex w-full flex-wrap content-start justify-center transition-opacity duration-700 ${compact ? 'gap-1 px-1 pb-1.5 pt-2' : 'gap-1.5 px-2 pb-2 pt-2.5'}`}
      style={{ opacity: lost ? 0.55 : 1, minHeight: compact ? 40 : 56 }}
    >
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <ItemCard key={it.r} {...it} unit={unit} compact={compact} width={cardW} />
        ))}
      </AnimatePresence>
    </div>
  )
}

function ItemCard({ r, tier, mult, unit, compact, width }: { r: number; tier: Tier; mult: number; unit: number; compact: boolean; width: number }) {
  const it = CRATES[tier].items[itemOfMult(tier, mult)]
  const c = RARITY[it.rarity]
  const coins = Math.round(mult * unit * 100) / 100
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, y: -14, scale: 0.85 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 460, damping: 30 }}
      className={`relative flex items-center overflow-hidden rounded-lg ${compact ? 'gap-1 px-1 py-1' : 'flex-col px-1.5 pb-1.5 pt-1.5'}`}
      style={{ width: compact ? '100%' : width, background: 'linear-gradient(180deg,#172a39,#0f1d29)', boxShadow: `inset 0 0 0 1px ${c.color}44, inset 0 -2px 0 ${c.color}` }}
      title={`Round ${r + 1}: ${multLabel(mult)}`}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(70% 55% at 50% ${compact ? '50%' : '36%'}, ${c.glow}, transparent 72%)` }} />
      <ItemArt kind={it.kind} size={compact ? 24 : 40} className="relative shrink-0" />
      <div className={`relative min-w-0 ${compact ? 'flex-1 text-left' : 'mt-0.5 text-center'}`}>
        <div className={`tnum font-black leading-tight ${compact ? 'text-[10.5px]' : 'text-[12.5px]'}`} style={{ color: RARITY_TEXT[it.rarity as Rarity] }}>
          {multLabel(mult)}
        </div>
        {!compact && <div className="tnum truncate text-[10.5px] font-bold leading-tight text-dim">{fmt(coins)}</div>}
      </div>
    </motion.div>
  )
}

/** 3, 2, 1 before the first round. */
function Countdown({ n, crazy }: { n: number; crazy: boolean }) {
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#08131c]/45" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
      <div className="relative flex h-[132px] w-[132px] items-center justify-center">
        <motion.div key={`ring${n}`} className="absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 4px ${crazy ? CRAZY : EMBER}` }} initial={{ scale: 1.35, opacity: 0 }} animate={{ scale: 1, opacity: [0, 1, 0.35] }} transition={{ duration: 0.9, ease: 'easeOut' }} />
        <div className="absolute inset-[10px] rounded-full bg-[#0b1621]/90 shadow-[0_18px_40px_-10px_rgba(0,0,0,.8)]" />
        <motion.span key={n} className="tnum relative text-[64px] font-black leading-none text-ink" initial={{ scale: 1.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }}>
          {n}
        </motion.span>
      </div>
      <div className="absolute bottom-[18%] text-[12px] font-extrabold uppercase tracking-[.2em] text-white/80">{crazy ? 'Crazy · lowest total wins' : 'Get ready'}</div>
    </motion.div>
  )
}

/** The winner, announced over the arena for a few seconds when the battle ends. */
function WinnerCard({ v, revealed, me, now, top }: { v: BattleView; revealed: boolean; me: number; now: number; top: number }) {
  const [show, setShow] = useState(false)
  const nowRef = useRef(now)
  nowRef.current = now
  useEffect(() => {
    // only announce a finish that happens while watching; a battle opened after the fact just shows its crowns
    if (!revealed || v.endAt == null || nowRef.current - v.endAt > 3000) return
    setShow(true)
    const t = window.setTimeout(() => setShow(false), 3800)
    return () => clearTimeout(t)
  }, [revealed, v.endAt])
  const winners = v.winners ?? []
  const iWon = !!me && winners.includes(me)
  const each = v.payouts?.[winners[0] - 1] ?? 0
  const names = winners.map((s) => v.seats[s - 1]?.name ?? 'Player')
  const title =
    v.mode === '2v2'
      ? winners.length === 4
        ? 'The teams tie'
        : `Team ${winners[0] <= 2 ? 'A' : 'B'} wins`
      : winners.length > 1
        ? 'Split pot'
        : iWon
          ? 'You win!'
          : `${names[0]} wins`
  const sub = winners.length > 1 ? `${winners.length} winners · ${fmt(each)} each` : iWon ? 'The whole pot is yours' : v.crazy ? 'Lowest total takes the pot' : 'Biggest haul takes the pot'
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="pointer-events-none absolute inset-x-0 z-30 flex -translate-y-1/2 justify-center px-3" style={{ top }} initial={{ opacity: 0, y: -16, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.3 } }} transition={{ type: 'spring', stiffness: 340, damping: 22 }}>
          <div className="relative isolate min-w-[240px] max-w-[420px] rounded-2xl border-[3px] bg-panel px-7 pb-5 pt-7 text-center shadow-[0_30px_70px_-14px_rgba(0,0,0,.85)]" style={{ borderColor: iWon || !me ? GOLD : '#2b475c', boxShadow: iWon ? `0 30px 70px -14px rgba(0,0,0,.85), 0 0 60px -12px ${GOLD}` : undefined }}>
            <div className="absolute -top-6 left-1/2 -translate-x-1/2">
              <Crown size={50} className="drop-shadow-[0_4px_4px_rgba(0,0,0,.5)]" />
            </div>
            <div className="text-[24px] font-black leading-tight tracking-tight" style={{ color: iWon ? GOLD : '#eef4f9' }}>
              {title}
            </div>
            <div className="mt-1 text-[13px] font-semibold text-muted">{sub}</div>
            <div className="mx-auto my-3 h-[3px] w-10 rounded-full bg-raised" />
            <div className="tnum flex items-center justify-center gap-1.5 text-[22px] font-black text-ink">
              {fmt(winners.length > 1 ? each : (v.pot ?? 0))} <Coin size={20} />
            </div>
            {iWon && <Confetti />}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Twinkles bursting out of the winner card (under its text: the card is its own stacking context). */
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * Math.PI * 2 + (i % 2) * 0.2
        const d = 120 + (i % 3) * 40
        return { x: Math.cos(a) * d, y: Math.sin(a) * d * 0.7, r: 5 + (i % 4) * 2, c: [GOLD, '#fff', EMBER, '#ad72ff', '#38d98a'][i % 5], delay: (i % 5) * 0.04 }
      }),
    [],
  )
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 -z-10">
      {bits.map((b, i) => (
        <motion.svg key={i} className="absolute" width={b.r * 2} height={b.r * 2} viewBox="-10 -10 20 20" style={{ left: -b.r, top: -b.r }} initial={{ x: 0, y: 0, scale: 0, opacity: 1 }} animate={{ x: b.x, y: b.y, scale: [0, 1.2, 0.8], opacity: [1, 1, 0], rotate: 120 }} transition={{ duration: 1.3, delay: 0.1 + b.delay, ease: [0.2, 0.8, 0.3, 1] }} aria-hidden>
          <path d={twinkle(0, 0, 10)} fill={b.c} />
        </motion.svg>
      ))}
    </div>
  )
}

/** Under the arena: what you can do now (join, call the bots, leave) or, once it's over, how it went and Recreate. */
function ActionBar({
  v,
  st,
  now,
  me,
  busy,
  afford,
  onJoin,
  onBots,
  onLeave,
  onRecreate,
}: {
  v: BattleView
  st: string
  now: number
  me: number
  busy: string | null
  afford: boolean
  onJoin: () => void
  onBots: () => void
  onLeave: () => void
  onRecreate: () => void
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (st !== 'open') return
    const id = window.setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [st])
  const free = v.seats.filter((s) => !s).length
  const btn = 'flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-[14px] font-extrabold transition disabled:cursor-not-allowed disabled:opacity-45'
  let left: ReactNode = null
  let right: ReactNode = null
  if (st === 'open') {
    left = (
      <div className="min-w-0">
        <div className="text-[14px] font-extrabold text-ink">
          {free} {free === 1 ? 'seat' : 'seats'} left · {SEATS[v.mode]} players
        </div>
        <div className="tnum text-[12px] font-semibold text-muted">Starts the moment the last seat fills · closes in {closesIn(v.expiresAt - now)}</div>
      </div>
    )
    right = me ? (
      <>
        <button onClick={onLeave} disabled={!!busy} className={`${btn} bg-raised text-muted hover:bg-hover hover:text-ink`}>
          {busy === 'leave' && <Spinner size={14} />} {me === 1 ? 'Cancel battle' : 'Leave'}
        </button>
        <button onClick={onBots} disabled={!!busy} className={`${btn} bg-gold text-[#2a1c00] shadow-[inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.4)] hover:brightness-105`}>
          {busy === 'bots' && <Spinner size={14} />} Call bots
        </button>
      </>
    ) : (
      <button onClick={onJoin} disabled={!!busy || !afford} className={`${btn} bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] hover:brightness-110`}>
        {busy === 'join' && <Spinner size={14} />} Join for {fmt(v.cost)} <Coin size={15} />
      </button>
    )
  } else if (st === 'running') {
    left = (
      <div className="text-[13px] font-semibold text-muted">
        {v.crazy ? (
          <span className="inline-flex items-center gap-1.5" style={{ color: CRAZY }}>
            <CrazyMark size={14} /> Crazy battle: the lowest total wins.
          </span>
        ) : v.mode === '2v2' ? (
          'Team totals decide: the side with more takes the pot.'
        ) : (
          'The biggest total takes the whole pot.'
        )}
      </div>
    )
  } else if (st === 'done') {
    const winners = v.winners ?? []
    const mine = me ? (v.payouts?.[me - 1] ?? 0) : 0
    left = (
      <div className="min-w-0">
        <div className="text-[14px] font-extrabold text-ink">
          {me ? (mine > 0 ? `You won ${fmt(mine)}` : `You lost ${fmt(v.cost)}`) : `${winners.map((s) => v.seats[s - 1]?.name).join(', ')} took the pot`}
        </div>
        <div className="tnum text-[12px] font-semibold text-muted">Pot {fmt(v.pot ?? 0)} · {winners.length > 1 ? `split ${winners.length} ways` : 'winner takes all'}</div>
      </div>
    )
    right = (
      <>
        <button onClick={() => navigate('/game/battles')} className={`${btn} bg-raised text-muted hover:bg-hover hover:text-ink`}>
          Lobby
        </button>
        <button onClick={onRecreate} disabled={!!busy} className={`${btn} bg-gold text-[#2a1c00] shadow-[inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.4)] hover:brightness-105`}>
          {busy === 'recreate' && <Spinner size={14} />} Recreate · {fmt(v.cost)}
        </button>
      </>
    )
  } else {
    left = <div className="text-[14px] font-extrabold text-muted">This battle was called off before it filled. Every stake went back.</div>
    right = (
      <button onClick={onRecreate} disabled={!!busy} className={`${btn} bg-raised text-ink hover:bg-hover`}>
        {busy === 'recreate' && <Spinner size={14} />} Recreate · {fmt(v.cost)}
      </button>
    )
  }
  // from a tablet up the bar rides along the bottom of the screen, so Join, Call bots, the result and Recreate stay in
  // reach however tall the stacks of loot grow (above the tab bar until the sidebar layout takes over)
  return (
    <div className="z-20 flex flex-col gap-3 rounded-xl bg-panel px-4 py-3 ring-1 ring-white/5 sm:sticky sm:bottom-[calc(76px+env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:shadow-[0_-14px_32px_-14px_rgba(0,0,0,.75)] lg:bottom-3">
      <div className="min-w-0 flex-1">{left}</div>
      {right && <div className="flex shrink-0 gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">{right}</div>}
    </div>
  )
}
