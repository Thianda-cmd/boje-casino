import { useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
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
import { Coin, IconCheck, IconChevron, IconFire, IconGift, IconLock, IconTrophy, IconBolt, IconVault } from '../components/icons'
import { Lockpick, VaultDoor } from '../art/Vault'
import { GameIcon } from '../components/GameIcon'
import { Segmented } from '../components/ui'
import { TierBadge } from '../art/TierBadge'
import { sfx } from '../lib/sound'
import { navigate } from '../lib/router'

const EASE = [0.22, 1, 0.36, 1] as const

export default function Rewards() {
  return (
    <div className="flex flex-col gap-4">
      <Header />
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

/* ------------------------------------------------------------------ */
/*  Shared pieces                                                      */
/* ------------------------------------------------------------------ */

/** A card. `flush` drops the padding for cards that lay out their own sections. */
function Panel({ children, className = '', flush = false }: { children: ReactNode; className?: string; flush?: boolean }) {
  return <div className={`relative overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/[.03] ${flush ? '' : 'p-5 sm:p-6'} ${className}`}>{children}</div>
}

/** Soft coloured light behind a card. A radial gradient, not a blur filter, so it costs nothing to draw. */
function Glow({ color, opacity = 0.16, className = '' }: { color: string; opacity?: number; className?: string }) {
  return <div className={`pointer-events-none absolute rounded-full ${className}`} style={{ background: `radial-gradient(closest-side, ${color}, transparent)`, opacity }} />
}

function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-2 text-[13px] font-bold ${className}`}>{children}</div>
}

/** Progress bar that animates with a transform only: a full-width fill slides in from the left. */
function Bar({ pct, color, className = 'h-2', track = 'bg-stage' }: { pct: number; color: string; className?: string; track?: string }) {
  const p = Math.max(0, Math.min(100, pct))
  return (
    <div className={`overflow-hidden rounded-full ${track} ${className}`}>
      <motion.div
        className="h-full w-full rounded-full"
        style={{ background: color }}
        initial={{ x: '-100%' }}
        animate={{ x: `${p - 100}%` }}
        transition={{ duration: 0.9, ease: EASE }}
      />
    </div>
  )
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

const BURST = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + 0.25
  const reach = 1 + (i % 3) * 0.28
  return { x: Math.cos(a) * 58 * reach, y: Math.sin(a) * 30 * reach - 22, r: (i % 2 ? 1 : -1) * (120 + i * 12), d: (i % 4) * 0.03 }
})

/** A quick spray of coins from the middle of a button. */
function Burst() {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 z-20">
      {BURST.map((p, i) => (
        <motion.span
          key={i}
          className="absolute -ml-2 -mt-2"
          initial={{ x: 0, y: 0, scale: 0.4, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, scale: 1, opacity: 0, rotate: p.r }}
          transition={{ duration: 0.85, delay: p.d, ease: [0.15, 0.75, 0.3, 1] }}
        >
          <Coin size={16} />
        </motion.span>
      ))}
    </div>
  )
}

type Tone = 'gold' | 'violet' | 'sky'
const TONES: Record<Tone, string> = {
  gold: 'shimmer bg-[linear-gradient(90deg,#f7c548,#ffe38f,#f7c548)] text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)]',
  violet: 'bg-[linear-gradient(180deg,#a98cff,#8a66ff)] text-white shadow-[0_10px_26px_-12px_rgba(155,123,255,.9),inset_0_-3px_0_rgba(0,0,0,.16)] hover:brightness-110',
  sky: 'bg-[linear-gradient(180deg,#6cc3ff,#3aa6f5)] text-[#03233a] shadow-[0_10px_26px_-12px_rgba(76,180,255,.9),inset_0_-3px_0_rgba(0,0,0,.14)] hover:brightness-110',
}

/**
 * The claim button used across the page. When it can't be pressed it can show how far along the
 * cooldown is (`progress` 0..1) as a faint fill behind the label.
 */
function ClaimButton({
  ready,
  onClick,
  children,
  tone = 'gold',
  progress,
  className = 'h-12 w-full',
}: {
  ready: boolean
  onClick: () => void
  children: ReactNode
  tone?: Tone
  progress?: number
  className?: string
}) {
  const reduce = useReducedMotion()
  const [bursts, setBursts] = useState<number[]>([])
  const press = () => {
    if (!ready) return
    onClick()
    if (reduce) return
    const id = performance.now()
    setBursts((b) => [...b, id])
    setTimeout(() => setBursts((b) => b.filter((x) => x !== id)), 1000)
  }
  return (
    <div className={`relative ${className}`}>
      <motion.button
        whileTap={ready ? { scale: 0.97 } : undefined}
        disabled={!ready}
        onClick={press}
        className={`relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl text-[15px] font-extrabold transition ${ready ? TONES[tone] : 'cursor-default bg-raised/80 text-muted'}`}
      >
        {!ready && progress !== undefined && (
          <span className="absolute inset-0 origin-left bg-white/[.06]" style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} />
        )}
        <span className="relative flex items-center gap-2 px-3">{children}</span>
      </motion.button>
      {bursts.map((id) => (
        <Burst key={id} />
      ))}
    </div>
  )
}

function pendingLevelCoins(xp: number, levelClaimed: number) {
  const { level } = levelFromXp(xp)
  let total = 0
  for (let l = levelClaimed + 1; l <= level; l++) total += levelReward(l)
  return total
}

function dailyState(dailyLast: number, dailyStreak: number, now: number) {
  const ready = now - dailyLast >= DAILY_COOLDOWN
  const alive = dailyLast > 0 && now - dailyLast < DAILY_STREAK_RESET
  const day = ready ? (alive ? Math.min(dailyStreak + 1, 7) : 1) : dailyStreak
  return { ready, alive, day, streak: alive ? dailyStreak : 0, left: DAILY_COOLDOWN - (now - dailyLast) }
}

/* ------------------------------------------------------------------ */
/*  Header with everything that's ready, and Claim all                 */
/* ------------------------------------------------------------------ */

function Header() {
  const now = useNow(1000)
  const s = useWallet()
  const daily = dailyState(s.dailyLast, s.dailyStreak, now)
  const ready: number[] = []
  if (s.balance < FAUCET_THRESHOLD && now - s.faucetLast >= FAUCET_COOLDOWN) ready.push(FAUCET_AMOUNT)
  if (daily.ready) ready.push(dailyReward(daily.day))
  const lvl = pendingLevelCoins(s.xp, s.levelClaimed)
  if (lvl > 0) ready.push(lvl)
  for (const c of CHALLENGES) {
    const st = s.challenges[c.id]
    if (st && !st.claimed && st.progress >= c.goal) ready.push(c.reward)
  }
  const total = ready.reduce((a, b) => a + b, 0)

  const claimAll = () => {
    const w = useWallet.getState()
    let sum = 0
    let n = 0
    const add = (amount: number) => {
      if (amount > 0) {
        sum += amount
        n++
      }
    }
    // the refill first: it needs the balance to still be low
    add(w.claimFaucet())
    add(w.claimDaily())
    add(w.claimLevels())
    for (const c of CHALLENGES) add(w.claimChallenge(c.id))
    if (sum > 0) {
      sfx.coin()
      w.pushToast({ kind: 'reward', title: n === 1 ? 'Reward claimed' : `${n} rewards claimed`, amount: sum })
    }
  }

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="text-[24px] font-black tracking-tight">Rewards</h1>
        <p className="text-[13px] text-muted">Free coins for playing, leveling up and coming back. Coins have no cash value.</p>
      </div>
      <div className="flex w-full items-center gap-3 rounded-2xl bg-panel p-2 pl-4 ring-1 ring-white/[.03] sm:w-auto">
        <div className="min-w-0 flex-1 leading-tight sm:min-w-[150px]">
          {ready.length ? (
            <>
              <div className="text-[12px] font-bold text-muted">{ready.length === 1 ? '1 reward ready' : `${ready.length} rewards ready`}</div>
              <div className="tnum mt-0.5 flex items-center gap-1.5 text-[19px] font-black text-gold">
                {fmt(total, 0)} <Coin size={16} />
              </div>
            </>
          ) : (
            <>
              <div className="text-[12px] font-bold text-muted">All caught up</div>
              <div className="tnum mt-0.5 text-[14px] font-extrabold">Next daily in {fmtDuration(daily.left)}</div>
            </>
          )}
        </div>
        <ClaimButton ready={ready.length > 0} onClick={claimAll} className="h-11 w-[132px]">
          {ready.length ? 'Claim all' : <IconCheck size={18} />}
        </ClaimButton>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  VIP: level ring, stats, level rewards and the tier track           */
/* ------------------------------------------------------------------ */

function LevelRing({ pct, color, size, children }: { pct: number; color: string; size: number; children: ReactNode }) {
  const r = 45
  const c = 2 * Math.PI * r
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" width={size} height={size} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="5" />
        <motion.circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - Math.max(0.015, pct / 100)) }}
          transition={{ duration: 1.1, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pb-1">{children}</div>
      <span className="tnum absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-stage px-2 py-0.5 text-[11px] font-extrabold ring-1 ring-white/10" style={{ color }}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-white/[.04]">
      <div className="truncate text-[11px] font-bold text-dim">{label}</div>
      <div className="tnum mt-0.5 truncate text-[15px] font-extrabold">{value}</div>
    </div>
  )
}

function VipCard() {
  const { xp, levelClaimed, claimLevels, totalWagered, rounds, biggestWin } = useWallet()
  const claim = useClaim()
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  const pending = pendingLevelCoins(xp, levelClaimed)
  const pct = Math.min(100, (lv.into / lv.need) * 100)

  return (
    <Panel flush>
      <Glow color={tier.color} opacity={0.22} className="-left-40 -top-56 h-[520px] w-[520px]" />
      <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)_290px] lg:items-center lg:gap-8">
        <div className="flex items-center gap-4 sm:gap-5">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
            <LevelRing pct={pct} color={tier.color} size={104}>
              <TierBadge color={tier.color} rank={rank} size={54} className="drop-shadow-[0_8px_14px_rgba(0,0,0,.45)]" />
            </LevelRing>
          </motion.div>
          <div className="min-w-0">
            <span className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[.08em]" style={{ color: tier.color, background: `${tier.color}1f` }}>
              {tier.name} VIP
            </span>
            <div className="mt-2 text-[34px] font-black leading-none tracking-tight">Level {lv.level}</div>
            <div className="tnum mt-2 text-[13px] text-muted">
              <span className="font-bold text-ink">{fmt(lv.need - lv.into, 0)} XP</span> to level {lv.level + 1}
            </div>
            <div className="mt-0.5 text-[12px] text-dim">1 XP for every coin you wager</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="Wagered" value={fmt(totalWagered, 0)} />
          <Stat label="Rounds" value={fmt(rounds, 0)} />
          <Stat label="Best win" value={fmt(biggestWin, 0)} />
        </div>

        <div className="rounded-xl bg-stage/80 p-3.5 ring-1 ring-white/[.05]">
          <div className="flex items-center justify-between gap-2 text-[12px] font-bold">
            <span className="text-muted">Level rewards</span>
            <span className="tnum flex items-center gap-1 text-dim">
              Level {lv.level + 1} pays <span className="text-gold">{fmt(levelReward(lv.level + 1), 0)}</span> <Coin size={12} />
            </span>
          </div>
          <ClaimButton className="mt-2.5 h-12 w-full" ready={pending > 0} tone="violet" onClick={() => claim(claimLevels(), 'Level reward claimed')}>
            {pending > 0 ? (
              <>
                Claim {fmt(pending, 0)} <Coin size={16} />
              </>
            ) : (
              <>
                <IconLock size={15} /> Level up to unlock
              </>
            )}
          </ClaimButton>
        </div>
      </div>
      <TierTrack level={lv.level} rank={rank} />
    </Panel>
  )
}

/** The five VIP tiers on one line, filled up to where the player is. */
function TierTrack({ level, rank }: { level: number; rank: number }) {
  const cur = TIERS[rank]
  const next = TIERS[rank + 1]
  const frac = next ? Math.min(1, (level - cur.min) / (next.min - cur.min)) : 0
  const pos = Math.min(1, (rank + frac) / (TIERS.length - 1))
  const gradient = `linear-gradient(90deg, ${TIERS.map((t) => t.color).join(', ')})`
  return (
    <div className="relative border-t border-white/[.05] bg-black/15 px-2 py-4 sm:px-6">
      <div className="relative">
        {/* nodes sit at the centre of five equal columns: 10%, 30%, ... 90% */}
        <div className="absolute left-[10%] right-[10%] top-[16px] h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/[.07]">
          <motion.div className="h-full w-full" style={{ background: gradient }} initial={{ x: '-100%' }} animate={{ x: `${(pos - 1) * 100}%` }} transition={{ duration: 1.1, ease: EASE }} />
        </div>
        <div className="relative grid grid-cols-5">
          {TIERS.map((t, i) => {
            const reached = level >= t.min
            const current = i === rank
            return (
              <div key={t.name} className="flex flex-col items-center text-center">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full ${reached ? 'bg-panel2' : 'bg-stage'}`}
                  style={current ? { boxShadow: `0 0 0 2px ${t.color}, 0 0 16px -2px ${t.color}` } : undefined}
                >
                  <TierBadge color={t.color} rank={i} size={20} dim={!reached} />
                </div>
                <div className={`mt-1.5 text-[11px] font-extrabold sm:text-[13px] ${reached ? '' : 'text-dim'}`} style={reached ? { color: t.color } : undefined}>
                  {t.name}
                </div>
                <div className="tnum text-[10px] font-semibold text-dim sm:text-[11px]">
                  <span className="max-sm:hidden">Level </span>
                  {t.min}+
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Daily streak                                                       */
/* ------------------------------------------------------------------ */

function Daily() {
  const now = useNow(1000)
  const { dailyLast, dailyStreak, claimDaily } = useWallet()
  const claim = useClaim()
  const d = dailyState(dailyLast, dailyStreak, now)
  const broke = d.ready && !d.alive && dailyStreak > 1

  return (
    <Panel>
      <Glow color="#f7c548" opacity={0.12} className="-right-24 -top-28 h-80 w-80" />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Eyebrow className="text-gold">
            <IconGift size={18} /> Daily bonus
          </Eyebrow>
          <div className="mt-1 text-[22px] font-black tracking-tight">{d.ready ? `Day ${d.day} is ready` : `Day ${d.day} claimed`}</div>
          <p className="mt-0.5 text-[13px] text-muted">{broke ? 'Your streak reset after 48 hours away.' : 'Claim once a day. Miss 48 hours and the streak starts over.'}</p>
        </div>
        <span className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-extrabold ${d.streak ? 'bg-[#ff8a3d]/12 text-[#ff9a52]' : 'bg-stage text-dim'}`}>
          <IconFire size={15} /> <span className="tnum">{d.streak}</span>
          <span className="max-sm:hidden">day streak</span>
        </span>
      </div>

      <div className="relative mt-5 grid grid-cols-7 gap-1.5 sm:gap-2">
        {Array.from({ length: 7 }, (_, i) => {
          const day = i + 1
          const done = d.ready ? day < d.day : day <= d.day
          const today = d.ready && day === d.day
          const big = day === 7
          return (
            <motion.div
              key={day}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: today ? -3 : 0 }}
              transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
              className={`relative flex flex-col items-center gap-1.5 rounded-xl px-0.5 pb-2.5 pt-2 sm:gap-2 ${
                today
                  ? 'bg-[linear-gradient(180deg,rgba(247,197,72,.26),rgba(247,197,72,.06))] shadow-[0_10px_24px_-12px_rgba(247,197,72,.8)] ring-2 ring-gold/80'
                  : done
                    ? 'bg-accent/[.08] ring-1 ring-accent/25'
                    : big
                      ? 'bg-[linear-gradient(180deg,rgba(155,123,255,.22),rgba(155,123,255,.05))] ring-1 ring-violet/35'
                      : 'bg-stage ring-1 ring-white/[.04]'
              }`}
            >
              <span className={`text-[10px] font-bold sm:text-[11px] ${today ? 'text-gold' : done ? 'text-accent' : big ? 'text-violet' : 'text-dim'}`}>Day {day}</span>
              {done ? (
                <span className="flex h-8 items-center justify-center">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[#032412] shadow-[0_4px_12px_-4px_rgba(34,211,111,.8)]">
                    <IconCheck size={14} />
                  </span>
                </span>
              ) : (
                <CoinPile n={big ? 4 : Math.min(3, 1 + Math.floor(i / 2))} faded={!today && !big} />
              )}
              <span className={`tnum text-[12px] font-black sm:text-[14px] ${done ? 'text-accent' : today ? 'text-gold' : big ? 'text-ink' : 'text-muted'}`}>{dailyReward(day)}</span>
              {today && <span className="pointer-events-none absolute inset-0 animate-pulse rounded-xl ring-2 ring-gold/40" />}
            </motion.div>
          )
        })}
      </div>

      <div className="relative mt-5">
        <ClaimButton ready={d.ready} progress={1 - d.left / DAILY_COOLDOWN} onClick={() => claim(claimDaily(), 'Daily bonus claimed')}>
          {d.ready ? (
            <>
              <Coin size={18} /> Claim {dailyReward(d.day)} coins
            </>
          ) : (
            <span className="tnum">Next bonus in {fmtDuration(d.left)}</span>
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
    <div className={`relative h-8 w-10 max-sm:scale-[.82] ${faded ? 'opacity-45 grayscale-[.5]' : ''}`}>
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
  const left = FAUCET_COOLDOWN - (now - faucetLast)
  const cooling = left > 0
  const eligible = balance < FAUCET_THRESHOLD
  const ready = eligible && !cooling
  return (
    <Panel className="flex flex-col">
      <Glow color="#4cb4ff" opacity={0.13} className="-right-24 -top-28 h-80 w-80" />
      <Eyebrow className="relative text-sky">
        <IconBolt size={18} /> Emergency refill
      </Eyebrow>
      <div className="relative mt-1 flex items-center gap-1.5 text-[22px] font-black tracking-tight">
        <span className="tnum">+{FAUCET_AMOUNT}</span> <Coin size={20} />
      </div>
      <p className="relative mt-0.5 text-[13px] text-muted">A top-up to get you back in the game when you're nearly out.</p>
      <div className="relative mt-4 flex flex-col gap-2">
        <Condition ok={eligible} label={`Balance under ${FAUCET_THRESHOLD}`} value={fmt(balance)} />
        <Condition ok={!cooling} label={`Once every ${FAUCET_COOLDOWN / 60000} min`} value={cooling ? fmtDuration(left) : 'Ready'} />
      </div>
      <div className="relative mt-auto pt-5">
        <ClaimButton ready={ready} tone="sky" progress={cooling ? 1 - left / FAUCET_COOLDOWN : undefined} onClick={() => claim(claimFaucet(), 'Refill claimed')}>
          {ready ? (
            <>
              Claim {FAUCET_AMOUNT} coins
            </>
          ) : (
            <>
              <IconLock size={16} /> {eligible ? 'Cooling down' : 'Only when nearly out'}
            </>
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

function Condition({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] ring-1 ${ok ? 'bg-accent/[.06] ring-accent/20' : 'bg-stage ring-white/[.04]'}`}>
      <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${ok ? 'bg-accent text-[#032412]' : 'bg-raised text-dim'}`}>
        {ok ? <IconCheck size={12} /> : <IconLock size={11} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-muted">{label}</span>
      <span className={`tnum font-bold ${ok ? 'text-ink' : 'text-dim'}`}>{value}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Vault Heist                                                        */
/* ------------------------------------------------------------------ */

function HeistCard() {
  const now = useNow(1000)
  const heist = useWallet((s) => s.heist)
  const { picks, next } = heistPicks(heist, now)
  const best = heist.best ?? 0
  return (
    <Panel flush>
      <Glow color="#f7c548" opacity={0.12} className="-left-24 top-1/2 h-96 w-96 -translate-y-1/2" />
      <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)_250px] lg:items-center lg:gap-7">
        <VaultDoor size={116} className="hidden shrink-0 drop-shadow-[0_16px_30px_rgba(0,0,0,.6)] lg:block" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow className="text-gold">
              <IconVault size={18} /> Vault Heist
            </Eyebrow>
            <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[11px] font-extrabold text-accent">Free to play</span>
          </div>
          <div className="mt-1 text-[22px] font-black tracking-tight">Earn up to {fmt(HEIST_LOOT[HEIST_LOOT.length - 1], 0)} coins a run</div>
          <p className="mt-1 max-w-[560px] text-[13px] text-muted">Time your picks to crack eight vaults, each faster than the last. Bank whenever you like, but one slip sets off the alarm and the bag is gone.</p>
          <div className="mt-3 grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {HEIST_LOOT.map((loot, i) => {
              const hit = i < best
              return (
                <div key={i} className={`rounded-lg px-1 py-1.5 text-center ring-1 ${hit ? 'bg-gold/[.1] ring-gold/30' : 'bg-stage ring-white/[.04]'}`}>
                  <div className={`text-[10px] font-bold ${hit ? 'text-gold/80' : 'text-dim'}`}>Vault {i + 1}</div>
                  <div className={`tnum text-[13px] font-black ${hit ? 'text-gold' : 'text-muted'}`}>{loot}</div>
                </div>
              )
            })}
          </div>
          {heist.runs > 0 && (
            <div className="tnum mt-2 text-[12px] text-dim">
              Best run: vault {best} of {HEIST_LOOT.length} · {fmt(heist.earned, 0)} coins banked in {heist.runs} {heist.runs === 1 ? 'run' : 'runs'}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-xl bg-stage px-3 py-2 ring-1 ring-white/[.04]">
            <div className="flex gap-1">
              {Array.from({ length: HEIST_MAX_PICKS }, (_, i) => (
                <Lockpick key={i} on={i < picks} size={26} />
              ))}
            </div>
            <span className="tnum text-[12px] font-bold text-muted">{next ? `+1 in ${fmtDuration(next)}` : 'Full'}</span>
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => navigate('/heist')}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl bg-gold text-[15px] font-extrabold text-[#2a1c00] shadow-[0_8px_22px_-10px_rgba(247,197,72,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-105"
          >
            {picks ? 'Play Vault Heist' : 'Practice the dial'} <IconChevron size={16} />
          </motion.button>
        </div>
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ */
/*  Challenges                                                         */
/* ------------------------------------------------------------------ */

type ChallengeFilter = 'all' | 'todo' | 'done'

function Challenges() {
  const { challenges, claimChallenge } = useWallet()
  const claim = useClaim()
  const [filter, setFilter] = useState<ChallengeFilter>('all')
  const state = (id: string) => challenges[id] ?? { progress: 0, claimed: false }
  const all = CHALLENGES.map((c) => {
    const st = state(c.id)
    const ready = !st.claimed && st.progress >= c.goal
    return { c, st, ready, rank: ready ? 0 : st.claimed ? 2 : 1 }
  })
  const rows = all.filter((r) => (filter === 'all' ? true : filter === 'done' ? r.st.claimed : !r.st.claimed)).sort((a, b) => a.rank - b.rank)
  const doneCount = all.filter((r) => r.st.claimed).length
  const earned = all.filter((r) => r.st.claimed).reduce((a, r) => a + r.c.reward, 0)
  const pot = CHALLENGES.reduce((a, c) => a + c.reward, 0)

  return (
    <section className="mt-2">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[20px] font-black tracking-tight">
            <IconTrophy size={21} className="text-gold" /> Challenges
          </h2>
          <p className="mt-0.5 text-[13px] text-muted">One-time rewards. Only bets of {CHALLENGE_MIN_BET}+ coins count.</p>
          <div className="mt-3 flex items-center gap-3">
            <Bar pct={(earned / pot) * 100} color="linear-gradient(90deg,#f7c548,#ffe38f)" className="h-2 w-[150px] sm:w-[200px]" />
            <span className="tnum text-[12px] font-bold text-muted">
              <span className="text-ink">{doneCount}</span>/{CHALLENGES.length} done · <span className="text-gold">{fmt(earned, 0)}</span> of {fmt(pot, 0)} coins
            </span>
          </div>
        </div>
        <div className="w-full sm:w-[300px]">
          <Segmented<ChallengeFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              {
                value: 'todo',
                label: (
                  <>
                    To do <span className="tnum text-dim">{CHALLENGES.length - doneCount}</span>
                  </>
                ),
              },
              {
                value: 'done',
                label: (
                  <>
                    Claimed <span className="tnum text-dim">{doneCount}</span>
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>
      <motion.div layout className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map(({ c, st, ready }) => (
            <ChallengeCard key={c.id} id={c.id} progress={st.progress} claimed={st.claimed} ready={ready} onClaim={() => claim(claimChallenge(c.id), `${c.title} reward claimed`)} />
          ))}
        </AnimatePresence>
      </motion.div>
      {rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line p-8 text-center text-[14px] text-muted">{filter === 'done' ? 'No challenges claimed yet.' : 'Every challenge is done. Nice work.'}</div>
      )}
    </section>
  )
}

function ChallengeCard({ id, progress, claimed, ready, onClaim }: { id: string; progress: number; claimed: boolean; ready: boolean; onClaim: () => void }) {
  const c = CHALLENGES.find((x) => x.id === id)!
  const game = c.game ? gameById(c.game) : null
  const accent = game ? game.accent : '#f7c548'
  const pct = Math.min(100, (progress / c.goal) * 100)
  const counter = c.goal > 100 ? `${fmt(Math.min(progress, c.goal), 0)} / ${fmt(c.goal, 0)}` : `${Math.min(progress, c.goal)} / ${c.goal}`
  const tile: CSSProperties = { background: `linear-gradient(145deg, ${accent}38, ${accent}10)`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}33` }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-panel p-4 ${
        ready ? 'shadow-[0_14px_36px_-18px_rgba(247,197,72,.7)] ring-2 ring-gold/70' : claimed ? 'ring-1 ring-accent/15' : 'ring-1 ring-white/[.04] transition-colors hover:ring-white/[.09]'
      }`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${ready ? '#f7c548' : accent}, transparent)`, opacity: claimed ? 0.25 : 0.7 }} />
      {ready && <Glow color="#f7c548" opacity={0.16} className="-right-16 -top-20 h-56 w-56" />}

      <div className={`relative flex items-start gap-3 ${claimed ? 'opacity-60' : ''}`}>
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={tile}>
          {c.game ? <GameIcon id={c.game} size={22} /> : <IconTrophy size={22} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 pt-0.5 text-[15px] font-extrabold leading-tight">{c.title}</div>
            <span className={`tnum flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-extrabold ${claimed ? 'bg-accent/10 text-accent' : 'bg-gold/10 text-gold'}`}>
              <Coin size={13} /> {fmt(c.reward, 0)}
            </span>
          </div>
          <div className="mt-1 text-[13px] leading-snug text-muted">{c.desc}</div>
        </div>
      </div>

      <div className="relative mt-auto pt-4">
        {c.goal > 1 && !claimed && (
          <div className="mb-3 flex items-center gap-3">
            <Bar pct={pct} color={ready ? '#f7c548' : accent} className="h-1.5 flex-1" />
            <span className="tnum text-[12px] font-bold text-muted">{counter}</span>
          </div>
        )}
        {claimed ? (
          <div className="flex h-10 items-center justify-center gap-1.5 rounded-xl bg-accent/10 text-[13px] font-bold text-accent">
            <IconCheck size={16} /> Completed
          </div>
        ) : ready ? (
          <ClaimButton ready className="h-10 w-full" onClick={onClaim}>
            Claim {fmt(c.reward, 0)} <Coin size={15} />
          </ClaimButton>
        ) : (
          <button
            onClick={() => navigate(c.game ? `/game/${c.game}` : '/')}
            className="group flex h-10 w-full items-center justify-center gap-1 rounded-xl bg-raised/70 text-[13px] font-bold text-muted transition hover:bg-hover hover:text-ink"
          >
            {game ? `Play ${game.name}` : 'Browse games'}
            <IconChevron size={15} className="transition-transform group-hover:translate-x-0.5" />
          </button>
        )}
      </div>
    </motion.div>
  )
}
