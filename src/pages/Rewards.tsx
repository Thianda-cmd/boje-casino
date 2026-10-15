import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CHALLENGES,
  CHALLENGE_MIN_BET,
  DAILY_COOLDOWN,
  DAILY_STREAK_RESET,
  FAUCET_AMOUNT,
  FAUCET_COOLDOWN,
  FAUCET_THRESHOLD,
  HEIST_LOOT,
  HEIST_MAX_PICKS,
  TIERS,
  heistPicks,
  dailyReward,
  levelFromXp,
  levelReward,
  tierOf,
  useWallet,
} from '../store/wallet'
import { gameById } from '../store/games'
import { useNow } from '../lib/useNow'
import { fmt, fmtDuration } from '../lib/format'
import { Coin, IconCheck, IconGift, IconLock, IconTrophy, IconBolt, IconVault } from '../components/icons'
import { Lockpick, VaultDoor } from '../art/Vault'
import { GameIcon } from '../components/GameIcon'
import { Segmented } from '../components/ui'
import { TierBadge } from '../art/TierBadge'
import { sfx } from '../lib/sound'
import { navigate } from '../lib/router'

export default function Rewards() {
  return (
    <div className="flex flex-col gap-4">
      <VipCard />
      <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
        <Daily />
        <Refill />
      </div>
      <HeistCard />
      <Challenges />
    </div>
  )
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden rounded-2xl bg-panel p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] sm:p-6 ${className}`}>{children}</div>
}

function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-2 text-[13px] font-bold ${className}`}>{children}</div>
}

function useClaim() {
  const pushToast = useWallet((s) => s.pushToast)
  return (amount: number, title: string) => {
    if (amount > 0) {
      sfx.coin()
      pushToast({ kind: 'reward', title, amount })
    }
  }
}

function ClaimButton({ ready, onClick, children, tone = 'gold' }: { ready: boolean; onClick: () => void; children: ReactNode; tone?: 'gold' | 'violet' | 'sky' }) {
  const tones = {
    gold: 'shimmer bg-[linear-gradient(90deg,#f7c548,#ffe38f,#f7c548)] text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9)]',
    violet: 'bg-violet text-white shadow-[0_10px_26px_-12px_rgba(155,123,255,.9)] hover:brightness-110',
    sky: 'bg-sky text-[#03233a] shadow-[0_10px_26px_-12px_rgba(76,180,255,.9)] hover:brightness-110',
  }
  return (
    <motion.button
      whileTap={ready ? { scale: 0.97 } : undefined}
      disabled={!ready}
      onClick={onClick}
      className={`flex h-12 w-full items-center justify-center gap-2 rounded-lg text-[15px] font-extrabold transition ${ready ? tones[tone] : 'cursor-default bg-raised text-muted'}`}
    >
      {children}
    </motion.button>
  )
}

/* ------------------------------------------------------------------ */
/*  VIP: level progress, level rewards and the tier ladder             */
/* ------------------------------------------------------------------ */

function VipCard() {
  const { xp, levelClaimed, claimLevels } = useWallet()
  const claim = useClaim()
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  const next = TIERS[rank + 1]
  let pending = 0
  for (let l = levelClaimed + 1; l <= lv.level; l++) pending += levelReward(l)
  const pct = Math.min(100, (lv.into / lv.need) * 100)

  return (
    <Panel className="p-0 sm:p-0">
      <div className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ background: tier.color, opacity: 0.14 }} />
      <div className="relative grid gap-6 p-5 sm:p-6 lg:grid-cols-[auto_1fr_260px] lg:items-center">
        <div className="flex items-center gap-4">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <TierBadge color={tier.color} rank={rank} size={76} className="drop-shadow-[0_12px_20px_rgba(0,0,0,.5)]" />
          </motion.div>
          <div>
            <div className="text-[13px] font-bold" style={{ color: tier.color }}>
              {tier.name} VIP
            </div>
            <div className="text-[30px] font-black leading-none tracking-tight">Level {lv.level}</div>
            <div className="mt-1.5 text-[13px] text-muted">{next ? `${next.name} at level ${next.min}` : 'Top tier reached'}</div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="font-bold text-muted">Progress to level {lv.level + 1}</span>
            <span className="tnum font-bold text-ink">{pct.toFixed(1)}%</span>
          </div>
          <div className="mt-2 h-3 overflow-hidden rounded-full bg-stage">
            <motion.div
              className="relative h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${tier.color}aa, ${tier.color})` }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className="absolute inset-y-0 right-0 w-6 rounded-full bg-white/40 blur-[6px]" />
            </motion.div>
          </div>
          <div className="tnum mt-1.5 flex justify-between text-[12px] text-dim">
            <span>{fmt(lv.into, 0)} XP</span>
            <span>{fmt(lv.need, 0)} XP</span>
          </div>
          <p className="mt-2 text-[12px] text-dim">Every coin you wager is 1 XP. Each level asks for more than the last.</p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5 text-[13px]">
            <span className="text-muted">Next level pays</span>
            <span className="tnum flex items-center gap-1 font-extrabold text-gold">
              {fmt(levelReward(lv.level + 1), 0)} <Coin size={14} />
            </span>
          </div>
          <ClaimButton ready={pending > 0} tone="violet" onClick={() => claim(claimLevels(), 'Level reward claimed')}>
            {pending > 0 ? (
              <>
                Claim {fmt(pending, 0)} <Coin size={16} />
              </>
            ) : (
              'No level rewards yet'
            )}
          </ClaimButton>
        </div>
      </div>

      <div className="relative border-t border-line/70 bg-panel2/40 px-5 py-4 sm:px-6">
        <div className="grid grid-cols-5 gap-1">
          {TIERS.map((t, i) => {
            const reached = lv.level >= t.min
            const current = i === rank
            return (
              <div key={t.name} className={`flex flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-center transition sm:flex-row sm:gap-3 sm:px-3 sm:text-left ${current ? 'bg-raised/70' : ''}`}>
                <TierBadge color={t.color} rank={i} size={30} dim={!reached} />
                <div className="leading-tight">
                  <div className={`text-[11px] font-extrabold sm:text-[13px] ${reached ? '' : 'text-dim'}`} style={reached ? { color: t.color } : undefined}>
                    {t.name}
                  </div>
                  <div className="tnum text-[11px] font-semibold text-dim">
                    <span className="max-sm:hidden">Level </span>
                    {t.min}+
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/*  Daily streak                                                       */
/* ------------------------------------------------------------------ */

function Daily() {
  const now = useNow(1000)
  const { dailyLast, dailyStreak, claimDaily } = useWallet()
  const claim = useClaim()
  const ready = now - dailyLast >= DAILY_COOLDOWN
  const streakAlive = dailyLast > 0 && now - dailyLast < DAILY_STREAK_RESET
  const today = ready ? (streakAlive ? Math.min(dailyStreak + 1, 7) : 1) : dailyStreak

  return (
    <Panel>
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold/10 blur-3xl" />
      <div className="relative flex items-start justify-between gap-3">
        <div>
          <Eyebrow className="text-gold">
            <IconGift size={18} /> Daily bonus
          </Eyebrow>
          <div className="mt-1 text-[22px] font-black tracking-tight">{ready ? `Day ${today} is ready` : `Day ${today} claimed`}</div>
        </div>
        <span className="rounded-full bg-stage px-3 py-1 text-[12px] font-bold text-muted">Resets after 48h away</span>
      </div>

      <div className="relative mt-5 grid grid-cols-4 gap-2 sm:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1
          const done = ready ? day < today : day <= today
          const isToday = ready && day === today
          const big = day === 7
          return (
            <motion.div
              key={day}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className={`relative flex flex-col items-center justify-between gap-2 overflow-hidden rounded-xl px-1 pb-2.5 pt-2 ${big ? 'max-sm:col-span-1' : ''} ${
                isToday
                  ? 'bg-[linear-gradient(180deg,rgba(247,197,72,.22),rgba(247,197,72,.06))] ring-2 ring-gold/70'
                  : done
                    ? 'bg-accent/10 ring-1 ring-accent/25'
                    : big
                      ? 'bg-[linear-gradient(180deg,rgba(155,123,255,.18),rgba(155,123,255,.04))] ring-1 ring-violet/30'
                      : 'bg-stage ring-1 ring-line'
              }`}
            >
              <span className={`text-[11px] font-bold ${isToday ? 'text-gold' : done ? 'text-accent' : 'text-dim'}`}>Day {day}</span>
              <CoinPile n={big ? 4 : Math.min(3, 1 + Math.floor(i / 2))} faded={!done && !isToday} />
              <span className={`tnum text-[14px] font-black ${done ? 'text-accent' : isToday ? 'text-gold' : 'text-ink'}`}>{dailyReward(day)}</span>
              {done && (
                <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[#032412]">
                  <IconCheck size={11} />
                </span>
              )}
              {isToday && <span className="pointer-events-none absolute inset-0 animate-pulse rounded-xl ring-2 ring-gold/40" />}
            </motion.div>
          )
        })}
      </div>

      <div className="relative mt-5">
        <ClaimButton ready={ready} onClick={() => claim(claimDaily(), 'Daily bonus claimed')}>
          {ready ? (
            <>
              <Coin size={18} /> Claim {dailyReward(today)} coins
            </>
          ) : (
            <span className="tnum">Next bonus in {fmtDuration(DAILY_COOLDOWN - (now - dailyLast))}</span>
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

const PILE = [
  [10, 0],
  [2, 3],
  [18, 3],
  [10, 9],
] as const

/** A small heap of coins; more coins on later streak days. */
function CoinPile({ n, faded }: { n: number; faded: boolean }) {
  return (
    <div className={`relative h-8 w-10 ${faded ? 'opacity-50 grayscale-[.4]' : ''}`}>
      {PILE.slice(0, n).map(([left, bottom], i) => (
        <span key={i} className="absolute" style={{ left, bottom }}>
          <Coin size={20} />
        </span>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Emergency refill                                                   */
/* ------------------------------------------------------------------ */

function Refill() {
  const now = useNow(1000)
  const { balance, faucetLast, claimFaucet } = useWallet()
  const claim = useClaim()
  const cooling = now - faucetLast < FAUCET_COOLDOWN
  const eligible = balance < FAUCET_THRESHOLD
  const ready = eligible && !cooling
  return (
    <Panel className="flex flex-col">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-sky/10 blur-3xl" />
      <Eyebrow className="relative text-sky">
        <IconBolt size={18} /> Emergency refill
      </Eyebrow>
      <div className="relative mt-1 flex items-baseline gap-2">
        <span className="tnum text-[22px] font-black tracking-tight">{FAUCET_AMOUNT} coins</span>
        <span className="text-[13px] text-muted">to get back in the game</span>
      </div>
      <div className="relative mt-4 flex flex-col gap-2">
        <Condition ok={eligible} label={`Balance under ${FAUCET_THRESHOLD} coins`} value={fmt(balance)} />
        <Condition ok={!cooling} label={`Once every ${FAUCET_COOLDOWN / 60000} minutes`} value={cooling ? fmtDuration(FAUCET_COOLDOWN - (now - faucetLast)) : 'Ready'} />
      </div>
      <div className="relative mt-auto pt-5">
        <ClaimButton ready={ready} tone="sky" onClick={() => claim(claimFaucet(), 'Refill claimed')}>
          {ready ? (
            'Claim refill'
          ) : (
            <>
              <IconLock size={16} /> {eligible ? 'Cooling down' : 'Balance too high'}
            </>
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

function HeistCard() {
  const now = useNow(1000)
  const heist = useWallet((s) => s.heist)
  const { picks, next } = heistPicks(heist, now)
  return (
    <Panel className="flex flex-col gap-5 sm:flex-row sm:items-center">
      <div className="pointer-events-none absolute -right-10 top-1/2 h-64 w-64 -translate-y-1/2 rounded-full bg-gold/10 blur-3xl" />
      <VaultDoor size={120} className="relative hidden shrink-0 drop-shadow-[0_16px_30px_rgba(0,0,0,.6)] sm:block" />
      <div className="relative min-w-0 flex-1">
        <Eyebrow className="text-gold">
          <IconVault size={18} /> Vault Heist
        </Eyebrow>
        <div className="mt-1 text-[22px] font-black tracking-tight">Earn up to {fmt(HEIST_LOOT[HEIST_LOOT.length - 1], 0)} coins a run</div>
        <p className="mt-1 max-w-[520px] text-[13px] text-muted">Time your picks to crack eight vaults, each faster than the last. Bank whenever you like, but one slip sets off the alarm and the bag is gone.</p>
      </div>
      <div className="relative flex shrink-0 flex-col gap-2 sm:w-[230px]">
        <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2">
          <div className="flex gap-1">
            {Array.from({ length: HEIST_MAX_PICKS }, (_, i) => (
              <Lockpick key={i} on={i < picks} size={26} />
            ))}
          </div>
          <span className="tnum text-[12px] font-bold text-muted">{next ? fmtDuration(next) : 'Full'}</span>
        </div>
        <button
          onClick={() => navigate('/heist')}
          className="flex h-12 items-center justify-center gap-2 rounded-lg bg-gold text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-105"
        >
          {picks ? 'Play Vault Heist' : 'Practice the dial'}
        </button>
      </div>
    </Panel>
  )
}

function Condition({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-stage px-3 py-2.5 text-[13px]">
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-accent text-[#032412]' : 'bg-raised text-dim'}`}>
        {ok ? <IconCheck size={12} /> : <IconLock size={11} />}
      </span>
      <span className="flex-1 text-muted">{label}</span>
      <span className={`tnum font-bold ${ok ? 'text-ink' : 'text-dim'}`}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Challenges                                                         */
/* ------------------------------------------------------------------ */

type ChallengeFilter = 'all' | 'open' | 'done'

function Challenges() {
  const { challenges, claimChallenge } = useWallet()
  const claim = useClaim()
  const [filter, setFilter] = useState<ChallengeFilter>('all')
  const state = (id: string) => challenges[id] ?? { progress: 0, claimed: false }
  const rows = CHALLENGES.map((c) => {
    const st = state(c.id)
    const ready = !st.claimed && st.progress >= c.goal
    return { c, st, ready, rank: ready ? 0 : st.claimed ? 2 : 1 }
  })
    .filter((r) => (filter === 'all' ? true : filter === 'done' ? r.st.claimed : !r.st.claimed))
    .sort((a, b) => a.rank - b.rank)
  const doneCount = CHALLENGES.filter((c) => state(c.id).claimed).length

  return (
    <section className="mt-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-[18px] font-extrabold tracking-tight">
            <IconTrophy size={20} className="text-gold" /> Challenges
            <span className="tnum rounded-full bg-raised px-2 py-0.5 text-[12px] font-bold text-muted">
              {doneCount}/{CHALLENGES.length}
            </span>
          </h2>
          <p className="mt-0.5 text-[12px] text-dim">One-time rewards. Only bets of {CHALLENGE_MIN_BET}+ coins count.</p>
        </div>
        <div className="w-[260px]">
          <Segmented<ChallengeFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'open', label: 'Open' },
              { value: 'done', label: 'Claimed' },
            ]}
          />
        </div>
      </div>
      <motion.div layout className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ c, st, ready }) => {
            const accent = c.game ? gameById(c.game).accent : '#f7c548'
            const pct = Math.min(100, (st.progress / c.goal) * 100)
            return (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                className={`relative flex flex-col overflow-hidden rounded-2xl bg-panel p-4 ${ready ? 'ring-2 ring-gold/60' : 'ring-1 ring-white/[.03]'}`}
              >
                {ready && <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gold/15 blur-2xl" />}
                <div className="relative flex items-start gap-3">
                  <div
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: `linear-gradient(145deg, ${accent}33, ${accent}12)`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}30` }}
                  >
                    {c.game ? <GameIcon id={c.game} size={24} /> : <IconTrophy size={24} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-extrabold">{c.title}</div>
                    <div className="text-[13px] leading-snug text-muted">{c.desc}</div>
                  </div>
                </div>
                <div className="relative mt-4 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-stage">
                    <motion.div
                      className="h-full rounded-full"
                      style={{ background: st.claimed ? '#22d36f' : ready ? '#f7c548' : accent }}
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <span className="tnum text-[12px] font-bold text-dim">{c.goal > 100 ? `${fmt(st.progress, 0)} / ${fmt(c.goal, 0)}` : `${st.progress}/${c.goal}`}</span>
                </div>
                <div className="relative mt-auto flex items-center gap-2 pt-4">
                  <span className="tnum flex h-10 items-center gap-1.5 rounded-lg bg-stage px-3 text-[14px] font-extrabold text-gold">
                    <Coin size={16} /> {fmt(c.reward, 0)}
                  </span>
                  {st.claimed ? (
                    <span className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent/10 text-[13px] font-bold text-accent">
                      <IconCheck size={16} /> Claimed
                    </span>
                  ) : ready ? (
                    <motion.button
                      whileTap={{ scale: 0.97 }}
                      onClick={() => claim(claimChallenge(c.id), `${c.title} reward claimed`)}
                      className="shimmer h-10 flex-1 rounded-lg bg-[linear-gradient(90deg,#f7c548,#ffe38f,#f7c548)] text-[14px] font-extrabold text-[#2a1c00]"
                    >
                      Claim reward
                    </motion.button>
                  ) : (
                    <button
                      onClick={() => navigate(c.game ? `/game/${c.game}` : '/')}
                      className="h-10 flex-1 rounded-lg bg-raised text-[13px] font-bold text-muted transition hover:bg-hover hover:text-ink"
                    >
                      {c.game ? `Play ${gameById(c.game).name}` : 'Browse games'}
                    </button>
                  )}
                </div>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </motion.div>
      {rows.length === 0 && <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[14px] text-muted">Nothing here yet.</div>}
    </section>
  )
}
