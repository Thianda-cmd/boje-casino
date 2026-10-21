import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useWallet, type BetRecord } from '../store/wallet'
import { gameInfo, type GameId } from '../store/games'
import { GameIcon } from '../components/GameIcon'
import { Coin, IconChart, IconTrophy } from '../components/icons'
import { fmt, fmtMult } from '../lib/format'
import { navigate } from '../lib/router'
import { useUid } from '../art/ids'

/* My bets: your totals, a chart of how the last rounds went, every one of them (filtered by game or result) and how
   each game has treated you. The rounds are the last 60 kept on this device; the totals count every round. */

type Result = 'all' | 'wins' | 'losses'

const isWin = (b: BetRecord) => b.payout > b.bet

export default function History() {
  const bets = useWallet((s) => s.bets)
  const [game, setGame] = useState<GameId | 'all'>('all')
  const [result, setResult] = useState<Result>('all')
  const byGame = useMemo(() => {
    const m = new Map<GameId, { n: number; wagered: number; net: number; best: number }>()
    for (const b of bets) {
      const r = m.get(b.game) ?? { n: 0, wagered: 0, net: 0, best: 0 }
      r.n++
      r.wagered += b.bet
      r.net += b.payout - b.bet
      r.best = Math.max(r.best, b.bet ? b.payout / b.bet : 0)
      m.set(b.game, r)
    }
    return [...m.entries()].map(([id, r]) => ({ id, ...r })).sort((a, b) => b.n - a.n)
  }, [bets])
  // a game filter for a game no longer in the list (progress was reset) falls back to all
  const gameOn = game !== 'all' && byGame.some((g) => g.id === game) ? game : 'all'
  const shown = bets.filter((b) => (gameOn === 'all' || b.game === gameOn) && (result === 'all' || (result === 'wins' ? isWin(b) : !isWin(b))))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-black tracking-tight">My bets</h1>
          <p className="text-[13px] text-muted">Your totals, and your last 60 rounds kept on this device.</p>
        </div>
        <ResetButton />
      </div>

      <Overview />

      {bets.length > 0 && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:px-0">
              <Pill active={gameOn === 'all'} onClick={() => setGame('all')}>
                All games <span className="tnum text-dim">{bets.length}</span>
              </Pill>
              {byGame.map(({ id, n }) => {
                const g = gameInfo(id)
                return (
                  <Pill key={id} active={gameOn === id} onClick={() => setGame(id)}>
                    <span style={{ color: g.accent }}>
                      <GameIcon id={id} size={15} />
                    </span>
                    {g.name} <span className="tnum text-dim">{n}</span>
                  </Pill>
                )
              })}
            </div>
            <div className="flex shrink-0 gap-1 self-start rounded-full bg-panel p-1">
              {(['all', 'wins', 'losses'] as Result[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setResult(r)}
                  className={`h-8 rounded-full px-3.5 text-[13px] font-bold capitalize transition ${result === r ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <BetsList
              bets={shown}
              empty={
                <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-8 text-center text-[14px] text-muted">
                  No {result === 'wins' ? 'wins' : 'losses'} {gameOn === 'all' ? 'in these rounds' : `at ${gameInfo(gameOn).name} in these rounds`}.
                </div>
              }
            />
            <ByGame rows={byGame} active={gameOn} onPick={(id) => setGame(gameOn === id ? 'all' : id)} />
          </div>
        </>
      )}
      {!bets.length && <EmptyBets />}
    </div>
  )
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold transition ${
        active ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'bg-panel text-muted hover:bg-panel2 hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}

/** wipes the wallet back to a fresh start, after a second tap */
export function ResetButton({ className = 'bg-panel' }: { className?: string }) {
  const reset = useWallet((s) => s.reset)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 4000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button
      onClick={() => {
        if (armed) {
          reset()
          setArmed(false)
        } else setArmed(true)
      }}
      className={`h-10 shrink-0 rounded-lg px-4 text-[13px] font-bold transition ${armed ? 'bg-danger/15 text-danger ring-1 ring-danger' : `${className} text-muted hover:text-danger`}`}
    >
      {armed ? 'Tap again to wipe everything' : 'Reset progress'}
    </button>
  )
}

/** the totals beside a chart of the last rounds */
function Overview() {
  const bets = useWallet((s) => s.bets)
  const rounds = useWallet((s) => s.rounds ?? 0)
  const wagered = useWallet((s) => s.totalWagered)
  const won = useWallet((s) => s.totalWon)
  const biggest = useWallet((s) => s.biggestWin)
  const net = won - wagered
  const wins = bets.filter(isWin).length
  const best = bets.reduce((m, b) => Math.max(m, b.bet ? b.payout / b.bet : 0), 0)
  const items: { k: string; v: ReactNode; icon: ReactNode; tone?: string }[] = [
    { k: 'Rounds', v: fmt(rounds, 0), icon: <IconChart size={14} /> },
    { k: 'Wagered', v: fmt(wagered), icon: <Coin size={14} /> },
    { k: 'Net result', v: `${net > 0 ? '+' : ''}${fmt(net)}`, icon: <Coin size={14} />, tone: net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : '' },
    { k: 'Win rate', v: bets.length ? `${Math.round((wins / bets.length) * 100)}%` : '–', icon: <IconChart size={14} /> },
    { k: 'Biggest win', v: fmt(biggest), icon: <IconTrophy size={14} />, tone: biggest > 0 ? 'text-gold' : '' },
    { k: 'Best multiplier', v: best ? fmtMult(best) : '–', icon: <IconTrophy size={14} />, tone: best >= 2 ? 'text-gold' : '' },
  ]
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="relative overflow-hidden rounded-2xl bg-panel p-4 sm:p-5">
        <ProfitChart bets={bets} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-2">
        {items.map((it) => (
          <div key={it.k} className="rounded-xl bg-panel px-3 py-3 sm:px-4">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
              {it.icon} {it.k}
            </div>
            <div className={`tnum mt-1 truncate text-[19px] font-extrabold tracking-tight ${it.tone ?? ''}`}>{it.v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Profit over the rounds kept, oldest to newest, as a line from zero: green where you are up, red where you are down.
 * Pointing at it shows the round under the pointer.
 */
function ProfitChart({ bets }: { bets: BetRecord[] }) {
  const u = useUid()
  const [at, setAt] = useState<number | null>(null)
  const { pts, rounds } = useMemo(() => {
    const rounds = [...bets].reverse()
    const pts = [0]
    for (const b of rounds) pts.push(pts[pts.length - 1] + b.payout - b.bet)
    return { pts, rounds }
  }, [bets])
  const W = 600
  const H = 180
  const pad = 10
  const min = Math.min(0, ...pts)
  const max = Math.max(0, ...pts)
  const span = max - min || 1
  const n = Math.max(1, pts.length - 1)
  const x = (i: number) => (i / n) * W
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - 2 * pad)
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const zero = y(0)
  const last = pts[pts.length - 1]
  const pick = at !== null && at > 0 ? { i: at, v: pts[at], b: rounds[at - 1] } : null
  const shown = pick ? pick.v : last
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[12px] font-semibold text-dim">{pick ? `Round ${pick.i} of ${rounds.length} · ${gameInfo(pick.b.game).name}` : `Profit over your last ${rounds.length || ''} rounds`}</div>
          <div className={`tnum mt-0.5 flex items-center gap-1.5 text-[24px] font-black tracking-tight ${shown > 0 ? 'text-accent' : shown < 0 ? 'text-danger' : ''}`}>
            {shown > 0 ? '+' : ''}
            {fmt(shown)} <Coin size={18} />
          </div>
        </div>
        {pick && (
          <div className="tnum rounded-lg bg-stage px-2.5 py-1.5 text-right text-[12px] font-bold">
            <div className="text-dim">
              Bet {fmt(pick.b.bet)} · {pick.b.bet ? (pick.b.payout / pick.b.bet).toFixed(2) : '0.00'}×
            </div>
            <div className={isWin(pick.b) ? 'text-accent' : 'text-dim'}>
              {isWin(pick.b) ? '+' : ''}
              {fmt(pick.b.payout - pick.b.bet)}
            </div>
          </div>
        )}
      </div>
      <div className="relative mt-3">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="block h-[150px] w-full touch-none sm:h-[180px]"
          onPointerMove={(e) => {
            if (!rounds.length) return
            const r = e.currentTarget.getBoundingClientRect()
            setAt(Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n))))
          }}
          onPointerLeave={() => setAt(null)}
          aria-label="Profit chart"
        >
          <defs>
            <linearGradient id={`${u}up`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#22d36f" stopOpacity=".35" />
              <stop offset="1" stopColor="#22d36f" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${u}dn`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" stopColor="#ff4d61" stopOpacity=".35" />
              <stop offset="1" stopColor="#ff4d61" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${u}a`}>
              <rect x="0" y="0" width={W} height={zero} />
            </clipPath>
            <clipPath id={`${u}b`}>
              <rect x="0" y={zero} width={W} height={H - zero} />
            </clipPath>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="#1f3547" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          ))}
          {rounds.length > 0 && (
            <>
              <path d={`${line}L${W},${zero}L0,${zero}Z`} fill={`url(#${u}up)`} clipPath={`url(#${u}a)`} />
              <path d={`${line}L${W},${zero}L0,${zero}Z`} fill={`url(#${u}dn)`} clipPath={`url(#${u}b)`} />
            </>
          )}
          <line x1="0" x2={W} y1={zero} y2={zero} stroke="#5d7488" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          {rounds.length > 0 && (
            <>
              <path d={line} fill="none" stroke="#22d36f" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${u}a)`} />
              <path d={line} fill="none" stroke="#ff4d61" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${u}b)`} />
            </>
          )}
          {pick && <line x1={x(pick.i)} x2={x(pick.i)} y1="0" y2={H} stroke="#90a4b8" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
        </svg>
        {pick && (
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-panel"
            style={{ left: `${(x(pick.i) / W) * 100}%`, top: `${(y(pick.v) / H) * 100}%`, background: pick.v >= 0 ? '#22d36f' : '#ff4d61' }}
          />
        )}
        {!rounds.length && <div className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-dim">Your rounds will draw a line here</div>}
      </div>
    </div>
  )
}

/** each game's rounds, stakes and result among the rounds kept; picking one filters the list */
function ByGame({ rows, active, onPick }: { rows: { id: GameId; n: number; wagered: number; net: number; best: number }[]; active: GameId | 'all'; onPick: (id: GameId) => void }) {
  const most = Math.max(...rows.map((r) => r.n), 1)
  return (
    <div className="rounded-2xl bg-panel p-2 lg:sticky lg:top-3">
      <div className="px-2.5 pb-1 pt-2 text-[13px] font-extrabold">By game</div>
      {rows.map((r) => {
        const g = gameInfo(r.id)
        return (
          <button
            key={r.id}
            onClick={() => onPick(r.id)}
            className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition ${active === r.id ? 'bg-raised' : 'hover:bg-panel2'}`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${g.accent}1f`, color: g.accent }}>
              <GameIcon id={r.id} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13.5px] font-bold">{g.name}</span>
                <span className={`tnum shrink-0 text-[13px] font-extrabold ${r.net > 0 ? 'text-accent' : r.net < 0 ? 'text-danger' : 'text-muted'}`}>
                  {r.net > 0 ? '+' : ''}
                  {fmt(r.net)}
                </span>
              </span>
              <span className="mt-1 flex items-center gap-2">
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-stage">
                  <span className="block h-full rounded-full" style={{ width: `${(r.n / most) * 100}%`, background: g.accent }} />
                </span>
                <span className="tnum shrink-0 text-[11.5px] font-semibold text-dim">
                  {r.n} {r.n === 1 ? 'round' : 'rounds'} · best {fmtMult(r.best)}
                </span>
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** what My bets and the lobby show before the first round: a few games to start with */
function EmptyBets({ className = '' }: { className?: string }) {
  return (
    <div className={`flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-panel/50 p-8 text-center ${className}`}>
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
        <IconChart size={22} />
      </span>
      <div>
        <div className="text-[16px] font-extrabold">No bets yet</div>
        <div className="mt-1 text-[13px] text-muted">Every round you play shows up here. A few to start with:</div>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        {(['chicken', 'plinko', 'crash', 'mines'] as GameId[]).map((id) => {
          const g = gameInfo(id)
          return (
            <button key={id} onClick={() => navigate(`/game/${id}`)} className="flex h-9 items-center gap-2 rounded-full bg-raised px-3.5 text-[13px] font-bold transition hover:bg-hover">
              <span style={{ color: g.accent }}>
                <GameIcon id={id} size={15} />
              </span>
              {g.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** the lobby's recent rounds: the latest few, or the empty state */
export function BetsTable({ limit }: { limit?: number }) {
  const bets = useWallet((s) => s.bets).slice(0, limit)
  return <BetsList bets={bets} empty={<EmptyBets className="h-full" />} />
}

function BetsList({ bets, empty }: { bets: BetRecord[]; empty: ReactNode }) {
  if (!bets.length) return <>{empty}</>
  return (
    <div className="overflow-hidden rounded-2xl bg-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12px] font-bold text-dim">
            <th className="px-2.5 py-3 sm:px-4">Game</th>
            <th className="hidden px-2.5 py-3 sm:table-cell sm:px-4">Time</th>
            <th className="px-2.5 py-3 text-right sm:px-4">Bet</th>
            <th className="px-2.5 py-3 text-right sm:px-4">
              <span className="sm:hidden">Multi</span>
              <span className="max-sm:hidden">Multiplier</span>
            </th>
            <th className="px-2.5 py-3 text-right sm:px-4">Payout</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b, i) => {
            const g = gameInfo(b.game)
            const mult = b.bet ? b.payout / b.bet : 0
            const win = b.payout > b.bet
            const push = b.payout === b.bet
            return (
              <motion.tr
                key={b.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(i, 12) * 0.015 }}
                className={`${i % 2 ? '' : 'bg-panel2/50'} cursor-pointer transition-colors hover:bg-raised/60`}
                onClick={() => !g.retired && navigate(`/game/${b.game}`)}
              >
                <td className="px-2.5 py-2.5 sm:px-4">
                  <span className="flex items-center gap-2.5 font-semibold">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md" style={{ background: `${g.accent}1f`, color: g.accent }}>
                      <GameIcon id={b.game} size={15} />
                    </span>
                    <span className="truncate max-sm:max-w-[72px]">{g.name}</span>
                  </span>
                </td>
                <td className="tnum hidden px-2.5 py-2.5 text-muted sm:table-cell sm:px-4">{new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="tnum px-2.5 py-2.5 text-right sm:px-4">
                  <span className="inline-flex items-center gap-1">
                    {fmt(b.bet)}
                    <span className="max-sm:hidden">
                      <Coin size={13} />
                    </span>
                  </span>
                </td>
                <td className="px-2.5 py-2.5 text-right sm:px-4">
                  <span className={`tnum inline-block rounded-md px-2 py-0.5 text-[12px] font-bold ${win ? 'bg-accent/12 text-accent' : push ? 'bg-raised text-muted' : 'bg-stage text-dim'}`}>
                    {mult.toFixed(2)}×
                  </span>
                </td>
                <td className={`tnum px-2.5 py-2.5 text-right font-bold sm:px-4 ${win ? 'text-accent' : push ? 'text-muted' : 'text-dim'}`}>
                  <span className="inline-flex items-center gap-1">
                    {win ? '+' : ''}
                    {fmt(b.payout - b.bet)}
                    <span className="max-sm:hidden">
                      <Coin size={13} />
                    </span>
                  </span>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
