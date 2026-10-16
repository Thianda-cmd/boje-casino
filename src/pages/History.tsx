import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../store/wallet'
import { GAMES, gameInfo, type GameId } from '../store/games'
import { GameIcon } from '../components/GameIcon'
import { Coin, IconChart, IconTrophy } from '../components/icons'
import { fmt } from '../lib/format'
import { navigate } from '../lib/router'

export default function History() {
  const bets = useWallet((s) => s.bets)
  const [game, setGame] = useState<GameId | 'all'>('all')
  const played = useMemo(() => {
    const counts = new Map<GameId, number>()
    for (const b of bets) counts.set(b.game, (counts.get(b.game) ?? 0) + 1)
    return GAMES.filter((g) => counts.has(g.id)).map((g) => ({ g, n: counts.get(g.id)! }))
  }, [bets])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[24px] font-black tracking-tight">My bets</h1>
          <p className="text-[13px] text-muted">Your last 60 rounds, kept on this device.</p>
        </div>
        <ResetButton />
      </div>
      <Summary />
      {played.length > 1 && (
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
          <Chip active={game === 'all'} onClick={() => setGame('all')}>
            All <span className="tnum text-dim">{bets.length}</span>
          </Chip>
          {played.map(({ g, n }) => (
            <Chip key={g.id} active={game === g.id} onClick={() => setGame(g.id)}>
              <span style={{ color: g.accent }}>
                <GameIcon id={g.id} size={15} />
              </span>
              {g.name} <span className="tnum text-dim">{n}</span>
            </Chip>
          ))}
        </div>
      )}
      <BetsTable game={game === 'all' ? undefined : game} />
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
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

function ResetButton() {
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
      className={`h-10 rounded-lg px-4 text-[13px] font-bold transition ${armed ? 'bg-danger/15 text-danger ring-1 ring-danger' : 'bg-panel text-muted hover:text-danger'}`}
    >
      {armed ? 'Tap again to wipe everything' : 'Reset progress'}
    </button>
  )
}

function Summary() {
  const s = useWallet()
  const net = s.totalWon - s.totalWagered
  const wins = s.bets.filter((b) => b.payout > b.bet).length
  const rate = s.bets.length ? (wins / s.bets.length) * 100 : 0
  const items: { k: string; v: ReactNode; icon: ReactNode; tone?: string }[] = [
    { k: 'Rounds', v: fmt(s.rounds ?? 0, 0), icon: <IconChart size={15} /> },
    { k: 'Wagered', v: fmt(s.totalWagered), icon: <Coin size={15} /> },
    { k: 'Net result', v: `${net > 0 ? '+' : ''}${fmt(net)}`, icon: <Coin size={15} />, tone: net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : '' },
    { k: 'Win rate, last 60', v: `${rate.toFixed(0)}%`, icon: <IconChart size={15} /> },
    { k: 'Biggest win', v: fmt(s.biggestWin), icon: <IconTrophy size={15} />, tone: s.biggestWin > 0 ? 'text-gold' : '' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {items.map((it, i) => (
        <div key={it.k} className={`rounded-xl bg-panel px-2.5 py-3 sm:px-4 ${i === items.length - 1 ? 'max-sm:col-span-2' : ''}`}>
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
            {it.icon} {it.k}
          </div>
          <div className={`tnum mt-1 text-[19px] font-extrabold tracking-tight ${it.tone ?? ''}`}>{it.v}</div>
        </div>
      ))}
    </div>
  )
}

export function BetsTable({ limit, game }: { limit?: number; game?: GameId }) {
  const all = useWallet((s) => s.bets)
  const bets = (game ? all.filter((b) => b.game === game) : all).slice(0, limit)
  if (!bets.length)
    return (
      <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-8 text-center text-[14px] text-muted">
        No bets yet. Pick a game and your rounds will show up here.
      </div>
    )
  return (
    <div className="overflow-hidden rounded-2xl bg-panel">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-left text-[12px] font-bold text-dim">
            <th className="px-2.5 py-3 sm:px-4">Game</th>
            <th className="hidden px-2.5 py-3 sm:px-4 sm:table-cell">Time</th>
            <th className="px-2.5 py-3 sm:px-4 text-right">Bet</th>
            <th className="px-2.5 py-3 text-right sm:px-4">
              <span className="sm:hidden">Multi</span>
              <span className="max-sm:hidden">Multiplier</span>
            </th>
            <th className="px-2.5 py-3 sm:px-4 text-right">Payout</th>
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
                    <span className="flex h-7 w-7 items-center justify-center rounded-md" style={{ background: `${g.accent}1f`, color: g.accent }}>
                      <GameIcon id={b.game} size={15} />
                    </span>
                    <span className="truncate max-sm:max-w-[72px]">{g.name}</span>
                  </span>
                </td>
                <td className="tnum hidden px-2.5 py-2.5 sm:px-4 text-muted sm:table-cell">{new Date(b.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                <td className="tnum px-2.5 py-2.5 sm:px-4 text-right">
                  <span className="inline-flex items-center gap-1">
                    {fmt(b.bet)}
                    <span className="max-sm:hidden">
                      <Coin size={13} />
                    </span>
                  </span>
                </td>
                <td className="px-2.5 py-2.5 sm:px-4 text-right">
                  <span className={`tnum inline-block rounded-md px-2 py-0.5 text-[12px] font-bold ${win ? 'bg-accent/12 text-accent' : push ? 'bg-raised text-muted' : 'bg-stage text-dim'}`}>
                    {mult.toFixed(2)}×
                  </span>
                </td>
                <td className={`tnum px-2.5 py-2.5 sm:px-4 text-right font-bold ${win ? 'text-accent' : push ? 'text-muted' : 'text-dim'}`}>
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
