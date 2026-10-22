/*
  The History tab: everything that moved the balance, in one list, newest first: the rounds played (the wallet keeps
  the last 60), the rewards collected (the last 40) and the cosmetics bought or found in crates (the last 40; a crate's
  row shows what dropped, with the crate on its corner). It filters by kind (and
  rounds by result), totals what came in and went out for what is shown, and groups the rows by day. A round opens
  its game; a purchase opens the wardrobe. The Overview's recent activity uses the same rows.
*/
import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GameIcon } from '../../components/GameIcon'
import { Coin, IconHistory } from '../../components/icons'
import { CosmeticPreview } from '../../art/cosmetics'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { useNow } from '../../lib/useNow'
import { gameInfo, type GameId } from '../../store/games'
import { useWallet, type BetRecord, type Purchase } from '../../store/wallet'
import { cosmetic } from '../../store/cosmetics'
import type { RewardEntry } from '../../store/rewards'
import { RARITY } from '../../art/cosmetics'
import { IconBag, KIND_NAME, KINDS, KindTile, Panel, timeAgo } from './kit'
import { CrateArt } from './Crates'
import { crateOf } from '../../store/cosmetics'
import { useAccountTab } from './tab'

export type FeedKind = 'bet' | 'reward' | 'shop'

export interface FeedItem {
  key: string
  kind: FeedKind
  time: number
  title: string
  sub: string
  /** what it did to the balance */
  amount: number
  game?: GameId
  reward?: RewardEntry['kind']
  item?: string
  /** the crate it came out of (a crate opening) */
  crate?: string
  win?: boolean
}

/** the three histories as one list, newest first */
export function feedOf(bets: BetRecord[], rewards: RewardEntry[], purchases: Purchase[]): FeedItem[] {
  const out: FeedItem[] = []
  for (const b of bets) {
    const mult = b.bet ? b.payout / b.bet : 0
    out.push({ key: `b${b.id}`, kind: 'bet', time: b.time, title: gameInfo(b.game).name, sub: `Bet ${fmt(b.bet)} · ${mult.toFixed(2)}×`, amount: b.payout - b.bet, game: b.game, win: b.payout > b.bet })
  }
  rewards.forEach((r, i) => out.push({ key: `r${r.time}${i}`, kind: 'reward', time: r.time, title: r.label, sub: KINDS[r.kind]?.one ?? 'Reward', amount: r.amount, reward: r.kind }))
  purchases.forEach((p, i) => {
    const c = cosmetic(p.id)
    const from = p.crate ? (crateOf(p.crate)?.name ?? 'Crate') : 'Shop'
    out.push({ key: `p${p.time}${i}`, kind: 'shop', time: p.time, title: c?.name ?? 'Cosmetic', sub: c ? `${from} · ${RARITY[c.rarity].name} ${KIND_NAME[c.kind].toLowerCase()}` : from, amount: -p.price, item: p.id, crate: p.crate })
  })
  return out.sort((a, b) => b.time - a.time)
}

/** the wallet's histories as one list */
export function useFeed() {
  const bets = useWallet((s) => s.bets)
  const rewards = useWallet((s) => s.rewardLog)
  const purchases = useWallet((s) => s.purchases)
  return useMemo(() => feedOf(bets ?? [], rewards ?? [], purchases ?? []), [bets, rewards, purchases])
}

const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`

/** one row of the history */
export function FeedRow({ it, now, i = 0 }: { it: FeedItem; now: number; i?: number }) {
  const setTab = useAccountTab((s) => s.setTab)
  const g = it.game ? gameInfo(it.game) : null
  const k = it.reward ? KINDS[it.reward] : null
  const open = () => {
    if (it.kind === 'bet' && g && !g.retired) navigate(`/game/${it.game}`)
    else if (it.kind === 'shop') setTab('customize')
    else if (it.kind === 'reward') navigate('/rewards')
  }
  const tone = it.kind === 'shop' ? 'text-muted' : it.kind === 'reward' ? 'text-gold' : it.win ? 'text-accent' : it.amount === 0 ? 'text-muted' : 'text-dim'
  return (
    <motion.button
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(i, 10) * 0.02, duration: 0.25 }}
      onClick={open}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-panel2"
      data-feed={it.kind}
    >
      {it.kind === 'bet' && g ? (
        <KindTile color={g.accent} size={38}>
          <GameIcon id={it.game!} size={18} />
        </KindTile>
      ) : it.kind === 'reward' && k ? (
        <KindTile color={k.color} size={38}>
          {k.icon(18)}
        </KindTile>
      ) : (
        <span className="relative flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-raised/70" data-feed-crate={it.crate}>
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-xl">{it.item ? <CosmeticPreview id={it.item} size={36} /> : <IconBag size={18} />}</span>
          {it.crate && (
            <span className="absolute -bottom-1.5 -right-1.5 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-stage ring-2 ring-panel" title={crateOf(it.crate)?.name}>
              <CrateArt id={it.crate} size={22} still />
            </span>
          )}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-bold">{it.title}</span>
        <span className="tnum block truncate text-[11.5px] font-semibold text-dim">
          {it.sub} · {timeAgo(it.time, now)}
        </span>
      </span>
      <span className={`tnum flex shrink-0 items-center gap-1 text-[13.5px] font-extrabold ${tone}`}>
        {signed(it.amount)}
        <Coin size={13} />
      </span>
    </motion.button>
  )
}

type Filter = 'all' | 'bet' | 'reward' | 'shop'
type Result = 'all' | 'wins' | 'losses'

const dayLabel = (t: number, now: number) => {
  const d = new Date(t)
  const today = new Date(now)
  const y = new Date(now - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
}

export function ActivityTab() {
  const now = useNow(30_000)
  const feed = useFeed()
  const [filter, setFilter] = useState<Filter>('all')
  const [result, setResult] = useState<Result>('all')
  const shown = feed.filter((it) => (filter === 'all' || it.kind === filter) && (filter !== 'bet' || result === 'all' || (result === 'wins' ? it.win : !it.win)))
  const inflow = shown.reduce((a, it) => a + Math.max(0, it.amount), 0)
  const outflow = shown.reduce((a, it) => a + Math.min(0, it.amount), 0)
  const counts = { all: feed.length, bet: feed.filter((f) => f.kind === 'bet').length, reward: feed.filter((f) => f.kind === 'reward').length, shop: feed.filter((f) => f.kind === 'shop').length }
  const groups: { day: string; items: FeedItem[] }[] = []
  for (const it of shown) {
    const day = dayLabel(it.time, now)
    const g = groups[groups.length - 1]
    if (g && g.day === day) g.items.push(it)
    else groups.push({ day, items: [it] })
  }
  const pills: [Filter, string][] = [
    ['all', 'Everything'],
    ['bet', 'Rounds'],
    ['reward', 'Rewards'],
    ['shop', 'Shop & crates'],
  ]
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 py-0.5 sm:mx-0 sm:px-0">
          {pills.map(([f, name]) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex h-9 shrink-0 items-center gap-2 rounded-full px-3.5 text-[13px] font-bold transition ${filter === f ? 'bg-raised text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)]' : 'bg-panel text-muted hover:bg-panel2 hover:text-ink'}`}
            >
              {name} <span className="tnum text-dim">{counts[f]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {filter === 'bet' && (
            <div className="flex gap-1 rounded-full bg-panel p-1">
              {(['all', 'wins', 'losses'] as Result[]).map((r) => (
                <button key={r} onClick={() => setResult(r)} className={`h-7 rounded-full px-3 text-[12.5px] font-bold capitalize transition ${result === r ? 'bg-raised text-ink' : 'text-muted hover:text-ink'}`}>
                  {r}
                </button>
              ))}
            </div>
          )}
          <span className="tnum flex h-9 items-center gap-1.5 rounded-full bg-panel px-3.5 text-[12.5px] font-bold">
            <span className="text-dim">In</span> <span className="text-accent">+{fmt(inflow)}</span>
            <span className="mx-1 h-3.5 w-px bg-line" />
            <span className="text-dim">Out</span> <span className="text-ink/80">−{fmt(Math.abs(outflow))}</span>
          </span>
        </div>
      </div>

      {shown.length ? (
        <Panel flush className="p-2 sm:p-3">
          <AnimatePresence initial={false}>
            {groups.map((g) => (
              <div key={g.day} className="mb-1 last:mb-0">
                <div className="flex items-center gap-3 px-2.5 pb-1.5 pt-2.5 text-[11.5px] font-extrabold uppercase tracking-[.08em] text-dim">
                  {g.day}
                  <span className="h-px flex-1 bg-line" />
                  <span className="tnum normal-case tracking-normal">{g.items.length}</span>
                </div>
                {g.items.map((it, i) => (
                  <FeedRow key={it.key} it={it} now={now} i={i} />
                ))}
              </div>
            ))}
          </AnimatePresence>
        </Panel>
      ) : (
        <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-panel/50 p-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-raised text-muted">
            <IconHistory size={22} />
          </span>
          <div className="text-[15px] font-extrabold">Nothing here yet</div>
          <div className="max-w-[340px] text-[13px] text-muted">Rounds you play, rewards you collect, cosmetics you buy and crates you open all show up here.</div>
        </div>
      )}
      <p className="px-1 text-[12px] text-dim">The last 60 rounds, 40 rewards and 40 purchases and crate openings are kept. Lifetime totals are on the Statistics tab.</p>
    </div>
  )
}
