/*
  VIP and its perks. Every coin wagered is a point of XP; levels pay a level-up reward, and the five tiers (bands of
  levels) now pay too: a share of every bet back as rakeback, larger at each tier, and a one-time bonus on reaching
  each tier. The VIP card keeps the level ring, the stats and the level-up rewards, and its foot is the tier track
  turned into a perks table (the current tier's column lit). Below it, the rakeback card and the tier bonus card,
  which shows the next tier and how far away it is when nothing is waiting.
*/
import type { ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { RAKEBACK, TIER_BONUS } from '../../store/rewards'
import { TIERS, levelFromXp, levelReward, rakebackRate, tierBonusDue, tierIndexOf, useWallet, xpForLevel } from '../../store/wallet'
import { AnimatedNumber } from '../../components/ui'
import { Coin, IconCheck, IconLock } from '../../components/icons'
import { TierBadge } from '../../art/TierBadge'
import { fmt, fmtCompact } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { Bar, ClaimButton, EASE, Eyebrow, Glow, IconCrown, IconReturn, Panel, joinAnd, useClaim } from './kit'
import { pendingLevelCoins, rakebackPayable } from './ready'

/** "0.2%", "0.75%" */
const pct = (rate: number) => `${+(rate * 100).toFixed(2)}%`
/** a stat that still fits a phone's third of the row: "11.2M" from a million up */
const big = (n: number) => (n >= 1e6 ? fmtCompact(n) : fmt(n, 0))
/** total XP to reach a level */
const xpAt = (level: number) => Array.from({ length: level }, (_, i) => xpForLevel(i + 1)).reduce((a, b) => a + b, 0)

function LevelRing({ pct: p, color, size, children }: { pct: number; color: string; size: number; children: ReactNode }) {
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
          animate={{ strokeDashoffset: c * (1 - Math.max(0.015, p / 100)) }}
          transition={{ duration: 1.1, ease: EASE }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pb-1">{children}</div>
      <span className="tnum absolute -bottom-1.5 left-1/2 -translate-x-1/2 rounded-full bg-stage px-2 py-0.5 text-[11px] font-extrabold ring-1 ring-white/10" style={{ color }}>
        {p.toFixed(0)}%
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

export function VipCard() {
  const xp = useWallet((s) => s.xp)
  const levelClaimed = useWallet((s) => s.levelClaimed)
  const claimLevels = useWallet((s) => s.claimLevels)
  const totalWagered = useWallet((s) => s.totalWagered)
  const rounds = useWallet((s) => s.rounds)
  const biggestWin = useWallet((s) => s.biggestWin)
  const tierClaimed = useWallet((s) => s.tierClaimed)
  const claim = useClaim()
  const lv = levelFromXp(xp)
  const rank = tierIndexOf(lv.level)
  const tier = TIERS[rank]
  const pending = pendingLevelCoins(xp, levelClaimed)
  const ringPct = Math.min(100, (lv.into / lv.need) * 100)
  // levels reached but not yet paid: levelClaimed + 1 … lv.level
  const from = levelClaimed + 1
  const reached = from === lv.level ? `Level ${lv.level} reached` : `Levels ${from}–${lv.level} reached`

  return (
    <Panel flush id="vip">
      <Glow color={tier.color} opacity={0.22} className="-left-40 -top-56 h-[520px] w-[520px]" />
      <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)_290px] lg:items-center lg:gap-8">
        <div className="flex items-center gap-4 sm:gap-5">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
            <LevelRing pct={ringPct} color={tier.color} size={104}>
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
          <Stat label="Wagered" value={big(totalWagered)} />
          <Stat label="Rounds" value={big(rounds ?? 0)} />
          <Stat label="Biggest win" value={big(biggestWin)} />
        </div>

        <div className="rounded-xl bg-stage/80 p-3.5 ring-1 ring-white/[.05]">
          <div className="flex items-center justify-between gap-2 text-[12px] font-bold">
            <span className="text-muted">Level-up rewards</span>
            {pending > 0 ? (
              <span className="tnum text-violet">{reached}</span>
            ) : (
              <span className="tnum flex items-center gap-1 text-dim">
                Level {lv.level + 1} pays <span className="text-gold">{fmt(levelReward(lv.level + 1), 0)}</span> <Coin size={12} />
              </span>
            )}
          </div>
          <p className="mt-1 text-pretty text-[12px] leading-snug text-dim">Each level you reach pays {levelReward(1)} coins times the level number.</p>
          <ClaimButton className="mt-2.5 h-12 w-full" ready={pending > 0} tone="violet" onClick={() => claim(claimLevels(), 'Level reward claimed', sfx.levelUp)}>
            {pending > 0 ? (
              <>
                Claim {fmt(pending, 0)} <Coin size={16} />
              </>
            ) : (
              <>
                <IconLock size={15} /> Unlocks at level {lv.level + 1}
              </>
            )}
          </ClaimButton>
        </div>
      </div>
      <PerksTable level={lv.level} rank={rank} tierClaimed={tierClaimed ?? 0} />
    </Panel>
  )
}

/** the label column's width on wider screens; phones put each row's label above it instead */
const LABEL_W = 116

/**
 * The tier track as a table: each tier's badge on the line (filled up to the player), its levels, its rakeback, its
 * one-time bonus and where the player stands with it. The current tier's column is lit.
 */
function PerksTable({ level, rank, tierClaimed }: { level: number; rank: number; tierClaimed: number }) {
  const cur = TIERS[rank]
  const next = TIERS[rank + 1]
  const frac = next ? Math.min(1, (level - cur.min) / (next.min - cur.min)) : 0
  const pos = Math.min(1, (rank + frac) / (TIERS.length - 1))
  const gradient = `linear-gradient(90deg, ${TIERS.map((t) => t.color).join(', ')})`
  const due = tierBonusDue(level, tierClaimed).tiers

  const row = (label: string, caption: string, cell: (i: number) => ReactNode) => (
    <>
      <div className="col-span-5 mt-3 text-center text-[10.5px] font-extrabold uppercase tracking-[.1em] text-dim sm:hidden">{caption}</div>
      <div className="hidden items-center text-[12px] font-bold text-dim sm:flex">{label}</div>
      {TIERS.map((_, i) => (
        <div key={i} className="relative flex min-h-[36px] items-center justify-center px-0.5 text-center sm:min-h-[40px]">
          {cell(i)}
        </div>
      ))}
    </>
  )

  return (
    <div className="relative border-t border-white/[.05] bg-black/15 px-3 pb-4 pt-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="text-[13px] font-extrabold">VIP tiers and perks</div>
        <div className="text-pretty text-[12px] text-dim">Each tier gives back more of every bet and pays a one-time bonus when you reach it.</div>
      </div>
      <div className="relative grid grid-cols-5 sm:grid-cols-[116px_repeat(5,minmax(0,1fr))]">
        {/* the current tier's column, behind everything */}
        <div className="pointer-events-none absolute inset-y-0 rounded-xl sm:hidden" style={{ left: `${rank * 20}%`, width: '20%', background: `${cur.color}12`, boxShadow: `inset 0 0 0 1px ${cur.color}40` }} />
        <div
          className="pointer-events-none absolute inset-y-0 hidden rounded-xl sm:block"
          style={{ left: `calc(${LABEL_W}px + (100% - ${LABEL_W}px) * ${rank / 5})`, width: `calc((100% - ${LABEL_W}px) / 5)`, background: `${cur.color}12`, boxShadow: `inset 0 0 0 1px ${cur.color}40` }}
        />

        <div className="hidden sm:block" />
        <div className="relative col-span-5 grid grid-cols-5 pt-2.5">
          {/* nodes sit at the centre of five equal columns: 10%, 30%, ... 90% */}
          <div className="absolute left-[10%] right-[10%] top-[26px] h-[3px] -translate-y-1/2 overflow-hidden rounded-full bg-white/[.07]">
            <motion.div className="h-full w-full" style={{ background: gradient }} initial={{ x: '-100%' }} animate={{ x: `${(pos - 1) * 100}%` }} transition={{ duration: 1.1, ease: EASE }} />
          </div>
          {TIERS.map((t, i) => {
            const got = level >= t.min
            const here = i === rank
            return (
              <div key={t.name} className="relative flex flex-col items-center text-center">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${got ? 'bg-panel2' : 'bg-stage'}`} style={here ? { boxShadow: `0 0 0 2px ${t.color}, 0 0 16px -2px ${t.color}` } : undefined}>
                  <TierBadge color={t.color} rank={i} size={20} dim={!got} />
                </div>
                <div className={`mt-1.5 text-[11px] font-extrabold sm:text-[13px] ${got ? '' : 'text-dim'}`} style={got ? { color: t.color } : undefined}>
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

        {row('Rakeback', 'Rakeback on every bet', (i) => (
          <span className={`tnum text-[13px] font-black sm:text-[15px] ${i === rank ? 'text-ink' : i < rank ? 'text-muted' : 'text-dim'}`}>{pct(RAKEBACK[i])}</span>
        ))}
        {row('Tier bonus', 'One-time tier bonus', (i) => {
          if (!TIER_BONUS[i]) return <span className="text-[13px] font-bold text-dim">–</span>
          const claimed = i <= tierClaimed
          const ready = due.includes(i)
          return (
            <span
              className={`tnum inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[12px] font-black sm:px-2 sm:text-[14px] ${
                ready ? 'bg-gold/15 text-gold ring-1 ring-gold/50' : claimed ? 'text-accent' : i <= rank ? 'text-ink' : 'text-dim'
              }`}
            >
              {claimed && <IconCheck size={13} className="max-sm:hidden" />}
              {/* a phone's column is too narrow for "20,000" */}
              {TIER_BONUS[i] >= 10000 ? (
                <>
                  <span className="sm:hidden">{TIER_BONUS[i] / 1000}K</span>
                  <span className="max-sm:hidden">{fmt(TIER_BONUS[i], 0)}</span>
                </>
              ) : (
                fmt(TIER_BONUS[i], 0)
              )}
            </span>
          )
        })}
        {row('Status', 'Where you stand', (i) => {
          const t = TIERS[i]
          if (i < rank) return <span className="text-[11px] font-bold text-accent sm:text-[12px]">Reached</span>
          if (i === rank) return <span className="text-[11px] font-extrabold sm:text-[12px]" style={{ color: t.color }}>Your tier</span>
          const gap = t.min - level
          return (
            <span className="tnum text-[11px] font-semibold leading-tight text-dim sm:text-[12px]">
              {gap} {gap === 1 ? 'level' : 'levels'}
              <span className="max-sm:hidden"> to go</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function RakebackCard() {
  const rakeback = useWallet((s) => s.rakeback ?? 0)
  const xp = useWallet((s) => s.xp)
  const claimRakeback = useWallet((s) => s.claimRakeback)
  const claim = useClaim()
  const level = levelFromXp(xp).level
  const rank = tierIndexOf(level)
  const rate = rakebackRate(level)
  const next = TIERS[rank + 1]
  const payable = rakebackPayable(rakeback)
  const color = '#2fd6c3'
  return (
    <Panel className="flex flex-col" id="rakeback">
      <Glow color={color} opacity={0.13} className="-right-24 -top-28 h-80 w-80" />
      <div className="relative flex items-start justify-between gap-3">
        <Eyebrow className="text-[#3fe3cf]">
          <IconReturn size={18} /> VIP rakeback
        </Eyebrow>
        <span className="tnum shrink-0 rounded-full px-2.5 py-1 text-[11px] font-extrabold" style={{ color: TIERS[rank].color, background: `${TIERS[rank].color}1c` }}>
          {TIERS[rank].name} · {pct(rate)} back
        </span>
      </div>
      <div className="relative mt-1 flex items-center gap-2 text-[30px] font-black leading-tight tracking-tight">
        <AnimatedNumber value={payable} digits={2} /> <Coin size={24} />
      </div>
      <p className="relative mt-0.5 text-pretty text-[13px] text-muted">
        {pct(rate)} of every bet comes back here, win or lose. Claim it whenever you like.
      </p>
      <div className="relative mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-stage px-3 py-2.5 ring-1 ring-white/[.04]">
          <div className="text-[11px] font-bold text-dim">On 1,000 wagered</div>
          <div className="tnum mt-0.5 flex items-center gap-1 text-[15px] font-extrabold">
            {fmt(1000 * rate, 2)} <Coin size={13} />
          </div>
        </div>
        <div className="rounded-xl bg-stage px-3 py-2.5 ring-1 ring-white/[.04]">
          <div className="truncate text-[11px] font-bold text-dim">{next ? `At ${next.name}` : 'Top rate'}</div>
          <div className="tnum mt-0.5 text-[15px] font-extrabold" style={{ color: (next ?? TIERS[rank]).color }}>
            {pct(next ? RAKEBACK[rank + 1] : rate)}
          </div>
        </div>
      </div>
      <div className="relative mt-auto pt-5">
        <ClaimButton ready={payable >= 0.01} tone="green" onClick={() => claim(claimRakeback(), 'Rakeback claimed', sfx.rewards.rakeback)}>
          {payable >= 0.01 ? (
            <>
              <Coin size={18} /> Claim {fmt(payable, 2)} coins
            </>
          ) : (
            'Play to build it up'
          )}
        </ClaimButton>
      </div>
    </Panel>
  )
}

export function TierBonusCard() {
  const xp = useWallet((s) => s.xp)
  const tierClaimed = useWallet((s) => s.tierClaimed ?? 0)
  const claimTierBonus = useWallet((s) => s.claimTierBonus)
  const claim = useClaim()
  const reduce = useReducedMotion()
  const level = levelFromXp(xp).level
  const rank = tierIndexOf(level)
  const due = tierBonusDue(level, tierClaimed)
  const next = TIERS[rank + 1]
  const shown = due.coins ? TIERS[due.tiers[due.tiers.length - 1]] : (next ?? TIERS[rank])
  const shownRank = TIERS.indexOf(shown)

  // the card's text beside the badge, and what sits along its foot
  let body: ReactNode
  let foot: ReactNode = null
  if (due.coins) {
    const names = due.tiers.map((t) => TIERS[t].name)
    body = (
      <>
        <div className="mt-1 text-[22px] font-black tracking-tight">{names.length > 1 ? `${joinAnd(names)} bonuses ready` : `${names[0]} bonus ready`}</div>
        <div className="tnum mt-1 flex items-center gap-2 text-[30px] font-black leading-tight tracking-tight text-gold">
          {fmt(due.coins, 0)} <Coin size={24} />
        </div>
        <p className="mt-0.5 text-pretty text-[13px] text-muted">A one-time thank-you for reaching {names.length > 1 ? 'these tiers' : names[0]}. It's yours to claim.</p>
      </>
    )
    foot = (
      <ClaimButton ready onClick={() => claim(claimTierBonus(), names.length > 1 ? 'Tier bonuses claimed' : `${names[0]} bonus claimed`, sfx.rewards.tier)} burst={1.5}>
        <Coin size={18} /> Claim {fmt(due.coins, 0)} coins
      </ClaimButton>
    )
  } else if (next) {
    const span = xpAt(next.min) - xpAt(TIERS[rank].min)
    const into = xp - xpAt(TIERS[rank].min)
    const gap = next.min - level
    body = (
      <>
        <div className="mt-1 text-[22px] font-black tracking-tight">
          Next: <span style={{ color: next.color }}>{next.name}</span> at level {next.min}
        </div>
        <p className="mt-0.5 text-pretty text-[13px] text-muted">
          A one-time <span className="font-bold text-ink">{fmt(TIER_BONUS[rank + 1], 0)}</span>-coin bonus, and your rakeback rises from {pct(RAKEBACK[rank])} to {pct(RAKEBACK[rank + 1])} of every bet.
        </p>
      </>
    )
    foot = (
      <>
        <div className="mb-2 flex items-center justify-between gap-2 text-[12px] font-bold">
          <span className="tnum text-muted">Level {level}</span>
          <span className="tnum text-right text-dim">
            {gap} {gap === 1 ? 'level' : 'levels'} · {fmt(Math.max(0, xpAt(next.min) - xp), 0)} XP to go
          </span>
        </div>
        <Bar pct={(into / span) * 100} color={`linear-gradient(90deg, ${TIERS[rank].color}, ${next.color})`} className="h-2.5" track="bg-stage" />
      </>
    )
  } else {
    body = (
      <>
        <div className="mt-1 text-[22px] font-black tracking-tight">Diamond, the top tier</div>
        <p className="mt-0.5 text-pretty text-[13px] text-muted">Every tier bonus is collected, and you get the best rakeback there is: {pct(RAKEBACK[RAKEBACK.length - 1])} of every bet.</p>
      </>
    )
  }

  return (
    <Panel className="flex flex-col" id="tier-bonus">
      <Glow color={shown.color} opacity={due.coins ? 0.2 : 0.12} className="-right-20 -top-24 h-80 w-80" />
      <div className="relative flex gap-4">
        <div className="min-w-0 flex-1">
          <Eyebrow className="text-[#9fe9ff]">
            <IconCrown size={18} /> Tier bonus
          </Eyebrow>
          {body}
        </div>
        {/* bobs while a bonus waits; once it's claimed, glides back to rest (an animation left undefined would freeze mid-bob) */}
        <motion.div
          className="shrink-0 pt-5"
          animate={{ y: due.coins && !reduce ? [0, -5, 0] : 0 }}
          transition={due.coins && !reduce ? { duration: 2.4, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3, ease: EASE }}
        >
          <TierBadge color={shown.color} rank={shownRank} size={64} dim={!due.coins && !!next} className="drop-shadow-[0_10px_18px_rgba(0,0,0,.5)]" />
        </motion.div>
      </div>
      {foot && <div className="relative mt-auto pt-5">{foot}</div>}
    </Panel>
  )
}
