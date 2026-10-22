/*
  The Statistics tab: the lifetime figures the wallet counts (rounds, wagered, won, the net, the biggest win), the
  figures worked out from the rounds kept (the best multiplier, the win rate, how the rounds paid), VIP progress up the
  tier ladder, the favourite games, and each game's breakdown. Lifetime round counts per game are the wallet's
  gamesPlayed (bets of 25 coins or more, as the challenges count them); the rest per game comes from the last 60 rounds.
*/
import { useMemo, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { GameCover } from '../../components/covers'
import { GameIcon } from '../../components/GameIcon'
import { Coin, IconChart, IconTrophy } from '../../components/icons'
import { TierBadge } from '../../art/TierBadge'
import { fmt, fmtCompact, fmtMult } from '../../lib/format'
import { navigate } from '../../lib/router'
import { gameInfo, type GameId } from '../../store/games'
import { CHALLENGES, TIERS, levelFromXp, rakebackRate, tierIndexOf, useWallet, type BetRecord } from '../../store/wallet'
import { CardHead, EASE, Figure, Glow, IconCrown, IconStack, IconTarget, Panel } from './kit'
import { LevelBlock } from './ProfileHeader'

const NO_BETS: BetRecord[] = []
const big = (n: number) => (Math.abs(n) >= 1e6 ? fmtCompact(n) : fmt(n))
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${big(Math.abs(n))}`

/** the games played most: the counted rounds, or the rounds kept, whichever is more */
export function useTopGames(limit = 4) {
  const played = useWallet((s) => s.gamesPlayed)
  const bets = useWallet((s) => s.bets)
  return useMemo(() => {
    const n = new Map<string, number>(Object.entries(played ?? {}).map(([k, v]) => [k, v ?? 0]))
    const recent = new Map<string, number>()
    for (const b of bets ?? []) recent.set(b.game, (recent.get(b.game) ?? 0) + 1)
    for (const [k, v] of recent) n.set(k, Math.max(n.get(k) ?? 0, v))
    return [...n.entries()].filter(([id, v]) => v > 0 && !gameInfo(id).retired).sort((a, b) => b[1] - a[1]).slice(0, limit) as [GameId, number][]
  }, [played, bets, limit])
}

export function FavouriteGames({ className = '' }: { className?: string }) {
  const top = useTopGames(4)
  const most = Math.max(1, ...top.map(([, n]) => n))
  return (
    <Panel className={className}>
      <CardHead icon={<IconTarget size={18} />} title="Favourite games" sub="The games you come back to." />
      {top.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {top.map(([id, n], i) => {
            const g = gameInfo(id)
            return (
              <motion.button key={id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} onClick={() => navigate(`/game/${id}`)} className="group flex min-w-0 items-center gap-3 rounded-xl bg-panel2/60 p-2 text-left ring-1 ring-white/[.04] transition hover:bg-panel2 hover:ring-white/10">
                <div className="relative h-[84px] w-[67px] shrink-0 overflow-hidden rounded-lg ring-1 ring-white/5 transition group-hover:-translate-y-0.5">
                  <GameCover id={id} />
                </div>
                <div className="min-w-0 flex-1 pr-1">
                  <div className="text-[11px] font-extrabold uppercase tracking-[.08em] text-dim">No. {i + 1}</div>
                  <div className="truncate text-[14px] font-extrabold">{g.name}</div>
                  <div className="tnum text-[11.5px] font-semibold text-dim">{fmt(n, 0)} rounds</div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-stage">
                    <div className="h-full rounded-full" style={{ width: `${(n / most) * 100}%`, background: g.accent }} />
                  </div>
                </div>
              </motion.button>
            )
          })}
        </div>
      ) : (
        <p className="rounded-xl bg-stage/60 p-4 text-[13px] text-muted">Play a few rounds and the games you come back to will show up here.</p>
      )}
    </Panel>
  )
}

/** the five VIP tiers as a ladder, the current one lit */
function VipLadder() {
  const xp = useWallet((s) => s.xp)
  const level = levelFromXp(xp).level
  const t = tierIndexOf(level)
  const next = TIERS[t + 1]
  return (
    <Panel>
      <Glow color={TIERS[t].color} className="-right-24 -top-24 h-72 w-72" opacity={0.14} />
      <CardHead icon={<IconCrown size={18} />} title="VIP progress" sub="Every coin you wager is a point of XP. Levels make the tiers." right={<button onClick={() => navigate('/rewards')} className="h-8 shrink-0 rounded-full bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">Perks</button>} />
      <div className="relative mb-5 mt-1 grid grid-cols-5 gap-1">
        <div className="absolute left-[10%] right-[10%] top-[22px] h-1 rounded-full bg-stage" />
        <motion.div className="absolute left-[10%] top-[22px] h-1 origin-left rounded-full" style={{ width: '80%', background: `linear-gradient(90deg, ${TIERS[0].color}, ${TIERS[t].color})` }} initial={{ scaleX: 0 }} animate={{ scaleX: t / 4 }} transition={{ duration: 0.9, ease: EASE }} />
        {TIERS.map((tier, i) => (
          <div key={tier.name} className="relative flex flex-col items-center">
            <div className={`rounded-full ${i === t ? 'drop-shadow-[0_0_14px_rgba(255,255,255,.18)]' : ''}`}>
              <TierBadge color={tier.color} rank={i} size={i === t ? 46 : 40} dim={i > t} />
            </div>
            <div className={`mt-1 text-[11.5px] font-extrabold ${i === t ? '' : i < t ? 'text-muted' : 'text-dim'}`} style={i === t ? { color: tier.color } : undefined}>
              {tier.name}
            </div>
            <div className="tnum text-[10.5px] font-semibold text-dim">Lv {tier.min}</div>
          </div>
        ))}
      </div>
      <LevelBlock xp={xp} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Figure label="Next tier" value={next ? next.name : 'Top tier'} sub={next ? `${next.min - level} level${next.min - level === 1 ? '' : 's'} to go` : 'You made it'} />
        <Figure label="Rakeback" value={`${+(rakebackRate(level) * 100).toFixed(2)}%`} sub="of every bet, back" />
      </div>
    </Panel>
  )
}

const BUCKETS: { name: string; test: (m: number) => boolean; win: boolean }[] = [
  { name: 'Lost', test: (m) => m === 0, win: false },
  { name: 'Under 1×', test: (m) => m > 0 && m < 1, win: false },
  { name: '1–2×', test: (m) => m >= 1 && m < 2, win: true },
  { name: '2–5×', test: (m) => m >= 2 && m < 5, win: true },
  { name: '5–10×', test: (m) => m >= 5 && m < 10, win: true },
  { name: '10×+', test: (m) => m >= 10, win: true },
]

/** how the rounds kept paid, as a bar per multiplier band; pointing at a bar says how many */
function PayoutChart({ bets }: { bets: BetRecord[] }) {
  const [at, setAt] = useState<number | null>(null)
  const counts = BUCKETS.map((b) => bets.filter((x) => b.test(x.bet ? x.payout / x.bet : 0)).length)
  const most = Math.max(1, ...counts)
  const wins = bets.filter((b) => b.payout > b.bet).length
  return (
    <Panel className="flex flex-col">
      <CardHead icon={<IconChart size={18} />} title="How your rounds paid" sub={bets.length ? `Your last ${bets.length} rounds by what they paid back.` : 'Your rounds, by what they paid back.'} right={<span className="tnum shrink-0 text-right"><span className="block text-[20px] font-black leading-none text-accent">{bets.length ? `${Math.round((wins / bets.length) * 100)}%` : '–'}</span><span className="text-[11px] font-bold text-dim">won</span></span>} />
      <div className="relative flex min-h-[180px] flex-1 items-end gap-2 pt-6" onPointerLeave={() => setAt(null)}>
        {[0.5, 1].map((f) => (
          <div key={f} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `calc(22px + (100% - 46px) * ${f})` }} />
        ))}
        {BUCKETS.map((b, i) => {
          const h = counts[i] / most
          return (
            <div key={b.name} className="relative flex h-full flex-1 flex-col items-center justify-end" onPointerEnter={() => setAt(i)} onClick={() => setAt(i)}>
              {at === i && (
                <div className="tnum absolute -top-1 z-10 whitespace-nowrap rounded-lg bg-panel2 px-2.5 py-1.5 text-[11.5px] font-bold shadow-lg ring-1 ring-white/10">
                  {counts[i]} round{counts[i] === 1 ? '' : 's'} · {bets.length ? Math.round((counts[i] / bets.length) * 100) : 0}%
                </div>
              )}
              <motion.div
                className="w-full max-w-[44px] origin-bottom rounded-t-[4px]"
                style={{ height: `calc((100% - 22px) * ${Math.max(h, counts[i] ? 0.04 : 0.012)})`, background: b.win ? (at === i ? '#3fe28a' : '#22d36f') : at === i ? '#3a566c' : '#2b475c' }}
                initial={{ scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ duration: 0.6, delay: i * 0.05, ease: EASE }}
              />
              <div className="mt-1.5 h-4 whitespace-nowrap text-[10.5px] font-bold text-dim">{b.name}</div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

/** each game's rounds, stakes, result and best multiplier */
function PerGame() {
  const bets = useWallet((s) => s.bets)
  const played = useWallet((s) => s.gamesPlayed)
  const rows = useMemo(() => {
    const m = new Map<string, { kept: number; wagered: number; net: number; best: number }>()
    for (const b of bets ?? []) {
      const r = m.get(b.game) ?? { kept: 0, wagered: 0, net: 0, best: 0 }
      r.kept++
      r.wagered += b.bet
      r.net += b.payout - b.bet
      r.best = Math.max(r.best, b.bet ? b.payout / b.bet : 0)
      m.set(b.game, r)
    }
    for (const id of Object.keys(played ?? {})) if (!m.has(id)) m.set(id, { kept: 0, wagered: 0, net: 0, best: 0 })
    return [...m.entries()].map(([id, r]) => ({ id: id as GameId, life: (played ?? {})[id as GameId] ?? 0, ...r })).sort((a, b) => b.life + b.kept - (a.life + a.kept))
  }, [bets, played])
  const most = Math.max(1, ...rows.map((r) => Math.max(r.life, r.kept)))
  return (
    <Panel flush>
      <div className="p-5 pb-2 sm:p-6 sm:pb-2">
        <CardHead icon={<IconStack size={18} />} title="By game" sub="Lifetime rounds count bets of 25 coins or more. Wagered, net and best are from your last 60 rounds." />
      </div>
      {rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11.5px] font-bold text-dim">
                <th className="px-5 py-2 sm:px-6">Game</th>
                <th className="px-3 py-2 text-right">Rounds</th>
                <th className="px-3 py-2 text-right">Wagered</th>
                <th className="px-3 py-2 text-right">Net</th>
                <th className="px-5 py-2 text-right sm:px-6">Best</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const g = gameInfo(r.id)
                return (
                  <tr key={r.id} onClick={() => !g.retired && navigate(`/game/${r.id}`)} className={`cursor-pointer transition-colors hover:bg-raised/50 ${i % 2 ? '' : 'bg-panel2/40'}`}>
                    <td className="px-5 py-2.5 sm:px-6">
                      <span className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: `${g.accent}1f`, color: g.accent }}>
                          <GameIcon id={r.id} size={16} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-bold">{g.name}</span>
                          <span className="mt-1 block h-1 w-28 overflow-hidden rounded-full bg-stage">
                            <span className="block h-full rounded-full" style={{ width: `${(Math.max(r.life, r.kept) / most) * 100}%`, background: g.accent }} />
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 text-right font-semibold">
                      {fmt(Math.max(r.life, r.kept), 0)}
                      {r.kept > 0 && <span className="block text-[11px] text-dim">{r.kept} kept</span>}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right text-muted">{r.kept ? big(r.wagered) : '–'}</td>
                    <td className={`tnum px-3 py-2.5 text-right font-extrabold ${r.net > 0 ? 'text-accent' : r.net < 0 ? 'text-danger' : 'text-muted'}`}>{r.kept ? signed(r.net) : '–'}</td>
                    <td className="tnum px-5 py-2.5 text-right sm:px-6">
                      {r.kept ? <span className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${r.best >= 2 ? 'bg-gold/12 text-gold' : 'bg-stage text-dim'}`}>{fmtMult(r.best)}</span> : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="m-5 mt-1 rounded-xl bg-stage/60 p-4 text-[13px] text-muted sm:m-6 sm:mt-1">No rounds yet.</p>
      )}
      <div className="h-3" />
    </Panel>
  )
}

function Hero({ label, value, sub, icon, tone, color }: { label: string; value: ReactNode; sub?: ReactNode; icon: ReactNode; tone?: string; color: string }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-2xl bg-panel p-4 ring-1 ring-white/[.03] sm:p-5">
      <Glow color={color} className="-right-10 -top-10 h-32 w-32" opacity={0.18} />
      <div className="flex items-center gap-2 text-[12px] font-bold text-dim">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: `${color}22`, color }}>
          {icon}
        </span>
        {label}
      </div>
      <div className={`tnum mt-2.5 flex items-center gap-1.5 truncate text-[22px] font-black tracking-tight sm:text-[26px] ${tone ?? ''}`}>{value}</div>
      {sub && <div className="tnum mt-0.5 truncate text-[11.5px] font-semibold text-dim">{sub}</div>}
    </div>
  )
}

export function StatsTab() {
  const w = useWallet(useShallow((s) => ({ rounds: s.rounds ?? 0, wagered: s.totalWagered, won: s.totalWon, biggest: s.biggestWin, bets: s.bets ?? NO_BETS, streak: s.dailyStreak, challenges: s.challenges })))
  const net = w.won - w.wagered
  const best = w.bets.reduce((m, b) => Math.max(m, b.bet ? b.payout / b.bet : 0), 0)
  const done = CHALLENGES.filter((c) => w.challenges?.[c.id]?.claimed).length
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Hero label="Rounds played" value={fmt(w.rounds, 0)} icon={<IconChart size={15} />} color="#4cb4ff" sub="every game, all time" />
        <Hero label="Total wagered" value={<>{big(w.wagered)} <Coin size={18} /></>} icon={<IconStack size={15} />} color="#9b7bff" sub="also your XP" />
        <Hero label="Total won" value={<>{big(w.won)} <Coin size={18} /></>} icon={<IconTrophy size={15} />} color="#f7c548" sub="paid back to you" />
        <Hero label="Net result" value={signed(net)} tone={net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : ''} icon={<Coin size={15} />} color={net >= 0 ? '#22d36f' : '#ff4d61'} sub={w.wagered ? `${((w.won / w.wagered) * 100).toFixed(1)}% returned` : 'no bets yet'} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Biggest win" value={big(w.biggest)} tone={w.biggest > 0 ? 'text-gold' : ''} sub="profit in one round" />
        <Figure label="Best multiplier" value={best ? fmtMult(best) : '–'} tone={best >= 2 ? 'text-gold' : ''} sub="in your last rounds" />
        <Figure label="Daily streak" value={`${w.streak} ${w.streak === 1 ? 'day' : 'days'}`} sub="daily bonus run" />
        <Figure label="Challenges" value={`${done} / ${CHALLENGES.length}`} sub="completed" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <VipLadder />
        <PayoutChart bets={w.bets} />
      </div>
      <FavouriteGames />
      <PerGame />
    </div>
  )
}
