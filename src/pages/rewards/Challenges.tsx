/*
  The challenges: one-off feats, most tied to a game, each paying its reward once. The list is ordered to be useful:
  anything ready to claim first, then what's in progress (furthest along first), and the claimed ones folded away at
  the end. Filters narrow it by state and by kind of game, and a search finds a challenge or a game by name. Each card
  opens its game. Without a search, the list stops after a few rows of challenges in progress ("Show all"), so the
  page doesn't end in a wall of cards; and an empty tab says where the matches are when another tab has them.
*/
import { useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CHALLENGES, CHALLENGE_MIN_BET, useWallet, type Challenge } from '../../store/wallet'
import { gameById, type Category } from '../../store/games'
import { GameIcon } from '../../components/GameIcon'
import { Coin, IconCheck, IconChevron, IconSearch, IconTrophy, IconX } from '../../components/icons'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { Bar, ClaimButton, Glow, SectionTitle, useClaim } from './kit'

type Status = 'all' | 'ready' | 'progress' | 'claimed'
type Kind = 'all' | Category

const TAB: Record<Exclude<Status, 'all'>, { name: string; adj: string }> = {
  ready: { name: 'Ready', adj: 'ready' },
  progress: { name: 'In progress', adj: 'in-progress' },
  claimed: { name: 'Claimed', adj: 'claimed' },
}
/** challenges in progress shown before "Show all" (phones show the first two rows of these) */
const FIRST = 9
const FIRST_PHONE = 6

/** What a multi-step challenge's counter counts ("2 / 5 in a row"). */
const UNITS: Record<string, string> = { explorer: 'games', 'card-shark': 'in a row', 'high-roller': 'wagered' }

interface Row {
  c: Challenge
  progress: number
  claimed: boolean
  ready: boolean
  pct: number
}

export function Challenges() {
  const challenges = useWallet((s) => s.challenges)
  const claimChallenge = useWallet((s) => s.claimChallenge)
  const claim = useClaim()
  const [status, setStatus] = useState<Status>('all')
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [showClaimed, setShowClaimed] = useState(false)
  const [showAll, setShowAll] = useState(false)

  const all: Row[] = CHALLENGES.map((c) => {
    const st = challenges[c.id] ?? { progress: 0, claimed: false }
    return { c, progress: st.progress, claimed: st.claimed, ready: !st.claimed && st.progress >= c.goal, pct: Math.min(1, st.progress / c.goal) }
  })
  const claimedAll = all.filter((r) => r.claimed)
  const earned = claimedAll.reduce((a, r) => a + r.c.reward, 0)
  const pot = CHALLENGES.reduce((a, c) => a + c.reward, 0)

  // the kind and search filters first, so the state tabs can count what they would show
  const q = query.trim().toLowerCase()
  const matches = all.filter((r) => {
    const game = r.c.game ? gameById(r.c.game) : null
    if (kind !== 'all' && game?.category !== kind) return false
    return !q || `${r.c.title} ${r.c.desc} ${game?.name ?? ''}`.toLowerCase().includes(q)
  })
  const ready = matches.filter((r) => r.ready)
  // in progress: furthest along first (a stable sort keeps the list's own order among equals)
  const progress = matches.filter((r) => !r.ready && !r.claimed).sort((a, b) => b.pct - a.pct)
  const claimed = matches.filter((r) => r.claimed)
  const open = status === 'all' ? [...ready, ...progress] : status === 'ready' ? ready : status === 'progress' ? progress : []
  const foldClaimed = status === 'all' && claimed.length > 0
  // the cut: every ready one, then the first few in progress (without a search; a search shows all it finds)
  const cut = !showAll && !q && (status === 'all' || status === 'progress') ? (status === 'all' ? ready.length : 0) + FIRST : Infinity
  const phoneCut = cut - (FIRST - FIRST_PHONE)

  const onClaim = (c: Challenge) => claim(claimChallenge(c.id), `${c.title} reward claimed`)

  // an empty tab: point to the tab that has the matches, if one does
  const counts = { ready: ready.length, progress: progress.length, claimed: claimed.length }
  const here = status === 'all' ? matches.length : counts[status]
  const elsewhere = status === 'all' ? undefined : (['ready', 'progress', 'claimed'] as const).find((k) => k !== status && counts[k] > 0)
  const filtered = !!q || kind !== 'all'
  let empty: ReactNode = null
  if (here === 0) {
    const what = status === 'all' ? 'challenges' : `${TAB[status].adj} challenges`
    empty =
      status === 'ready' && !filtered
        ? 'Nothing ready to claim yet. Finish a challenge and it shows up here.'
        : status === 'claimed' && !filtered
          ? 'No challenges claimed yet. Finish one and claim it to see it here.'
          : status === 'progress' && !filtered && !ready.length
            ? 'You have claimed every challenge. Nice work.'
            : status === 'progress' && !filtered
              ? 'Everything left is ready to claim.'
              : `No ${what} match${q ? ` "${query.trim()}"` : ' this filter'}.`
  }

  return (
    <section id="challenges" className="scroll-mt-4">
      <SectionTitle icon={<IconTrophy size={21} className="text-gold" />}>Challenges</SectionTitle>
      <p className="mt-0.5 px-0.5 text-pretty text-[13px] text-muted">
        Each challenge pays its reward once. Only bets of {CHALLENGE_MIN_BET} coins or more count, except for High Roller, which counts every bet.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-0.5">
        <Bar pct={(earned / pot) * 100} color="linear-gradient(90deg,#f7c548,#ffe38f)" className="h-2 w-full sm:w-[200px]" track="bg-white/[.06]" />
        <span className="tnum text-[12px] font-bold text-muted">
          <span className="text-ink">{claimedAll.length}</span> of {CHALLENGES.length} claimed · <span className="text-gold">{fmt(earned, 0)}</span> of {fmt(pot, 0)} coins earned
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2 lg:flex-row lg:items-center">
        <Pills<Status>
          id="ch-status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All', count: matches.length },
            { value: 'ready', label: 'Ready', count: ready.length, hot: ready.length > 0 },
            { value: 'progress', label: 'In progress', count: progress.length },
            { value: 'claimed', label: 'Claimed', count: claimed.length },
          ]}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
          <Pills<Kind>
            id="ch-kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All games' },
              { value: 'originals', label: 'Originals' },
              { value: 'table', label: 'Table games' },
            ]}
          />
          <label className="flex h-11 min-w-0 items-center gap-2 rounded-full bg-panel px-4 ring-1 ring-white/[.04] transition focus-within:ring-white/15 sm:w-[240px]">
            <IconSearch size={16} className="shrink-0 text-dim" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search challenges"
              aria-label="Search challenges"
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] font-semibold outline-none placeholder:text-dim"
            />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search" className="-mr-2.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-dim transition hover:bg-raised hover:text-ink">
                <IconX size={14} />
              </button>
            )}
          </label>
        </div>
      </div>

      {open.length > 0 && (
        <motion.div layout className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <AnimatePresence initial={false} mode="popLayout">
            {open.slice(0, cut).map((r, i) => (
              <ChallengeCard key={r.c.id} row={r} onClaim={() => onClaim(r.c)} className={i >= phoneCut ? 'max-md:hidden' : ''} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      {(open.length > phoneCut || showAll) && (status === 'all' || status === 'progress') && !q && (
        <button
          onClick={() => (sfx.click(), setShowAll((a) => !a))}
          className={`group mt-3 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-panel text-[13px] font-bold text-muted ring-1 ring-white/[.04] transition hover:text-ink ${open.length > cut || showAll ? '' : 'md:hidden'}`}
        >
          {showAll ? 'Show fewer' : `Show all ${open.length} challenges`}
          <IconChevron size={15} className={`transition-transform ${showAll ? '-rotate-90' : 'rotate-90'}`} />
        </button>
      )}

      {foldClaimed && (
        <div className="mt-4">
          <button
            onClick={() => (sfx.click(), setShowClaimed((s) => !s))}
            aria-expanded={showClaimed}
            className="group flex h-11 w-full items-center gap-2 rounded-xl bg-panel px-4 text-[13px] font-bold text-muted ring-1 ring-white/[.04] transition hover:text-ink"
          >
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent/15 text-accent">
              <IconCheck size={12} />
            </span>
            Claimed <span className="tnum text-dim">{claimed.length}</span>
            <span className="tnum ml-auto flex items-center gap-1 text-accent">
              {fmt(claimed.reduce((a, r) => a + r.c.reward, 0), 0)} <Coin size={13} />
            </span>
            <IconChevron size={16} className={`transition-transform ${showClaimed ? '-rotate-90' : 'rotate-90'}`} />
          </button>
          <AnimatePresence initial={false}>
            {showClaimed && (
              <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.15 } }} transition={{ duration: 0.25 }}>
                <ClaimedGrid rows={claimed} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      {status === 'claimed' && claimed.length > 0 && <ClaimedGrid rows={claimed} />}

      {empty && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line p-8 text-center text-[14px] text-muted">
          {empty}
          {elsewhere && (
            <button onClick={() => (sfx.click(), setStatus(elsewhere))} className="flex h-10 items-center gap-1 rounded-full bg-raised px-4 text-[13px] font-bold text-ink transition hover:bg-hover">
              See {TAB[elsewhere].name} ({counts[elsewhere]}) <IconChevron size={14} />
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** A row of pill tabs with a sliding highlight; scrolls sideways when a phone is too narrow for it. */
function Pills<T extends string>({ id, value, options, onChange }: { id: string; value: T; options: { value: T; label: ReactNode; count?: number; hot?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto rounded-full bg-panel p-1 ring-1 ring-white/[.03]">
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            onClick={() => {
              if (active) return
              sfx.click()
              onChange(o.value)
            }}
            className={`relative flex h-9 flex-1 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[13px] font-bold transition-colors sm:flex-none sm:px-3.5 ${active ? 'text-ink' : 'text-muted hover:text-ink'}`}
          >
            {active && <motion.span layoutId={id} className="absolute inset-0 rounded-full bg-raised shadow-[0_2px_6px_rgba(0,0,0,.25),inset_0_1px_0_rgba(255,255,255,.06)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
            <span className="relative">{o.label}</span>
            {o.count !== undefined && (
              // phones keep only the count that matters (what's ready), so the four tabs fit across
              <span className={`tnum relative min-w-[20px] rounded-full px-1.5 text-[11px] font-extrabold leading-[18px] ${o.hot ? 'bg-gold text-[#2a1c00]' : `max-sm:hidden ${active ? 'bg-white/10 text-ink' : 'text-dim'}`}`}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ChallengeCard({ row, onClaim, className = '' }: { row: Row; onClaim: () => void; className?: string }) {
  const { c, progress, ready } = row
  const game = c.game ? gameById(c.game) : null
  const accent = game ? game.accent : '#f7c548'
  const counter = `${fmt(Math.min(progress, c.goal), 0)} / ${fmt(c.goal, 0)}${UNITS[c.id] ? ` ${UNITS[c.id]}` : ''}`
  const tile: CSSProperties = { background: `linear-gradient(145deg, ${accent}38, ${accent}10)`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}33` }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
      className={`relative flex flex-col overflow-hidden rounded-2xl bg-panel p-4 ${ready ? 'shadow-[0_14px_36px_-18px_rgba(247,197,72,.7)] ring-2 ring-gold/70' : 'ring-1 ring-white/[.04] transition-colors hover:ring-white/[.09]'} ${className}`}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, transparent, ${ready ? '#f7c548' : accent}, transparent)`, opacity: 0.7 }} />
      {ready && <Glow color="#f7c548" opacity={0.16} className="-right-16 -top-20 h-56 w-56" />}

      <div className="relative flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={tile}>
          {c.game ? <GameIcon id={c.game} size={22} /> : <IconTrophy size={22} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 pt-0.5 text-[15px] font-extrabold leading-tight">{c.title}</div>
            <span className="tnum flex shrink-0 items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-[12px] font-extrabold text-gold">
              <Coin size={13} /> {fmt(c.reward, 0)}
            </span>
          </div>
          <div className="mt-1 text-pretty text-[13px] leading-snug text-muted">{c.desc}</div>
        </div>
      </div>

      <div className="relative mt-auto pt-4">
        {c.goal > 1 && (
          <div className="mb-3 flex items-center gap-3">
            <Bar pct={row.pct * 100} color={ready ? '#f7c548' : accent} className="h-1.5 flex-1" />
            <span className="tnum text-[12px] font-bold text-muted">{counter}</span>
          </div>
        )}
        {ready ? (
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

/** Claimed challenges, compact: they've paid, so only the name, the game and the reward remain. */
function ClaimedGrid({ rows }: { rows: Row[] }) {
  return (
    <div className="mt-2.5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map(({ c }) => {
        const game = c.game ? gameById(c.game) : null
        const accent = game ? game.accent : '#f7c548'
        return (
          <div key={c.id} className="flex items-center gap-3 rounded-xl bg-panel px-3 py-2.5 ring-1 ring-accent/10">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-70" style={{ color: accent, background: `${accent}1c` }}>
              {c.game ? <GameIcon id={c.game} size={18} /> : <IconTrophy size={18} />}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13.5px] font-bold text-muted">{c.title}</div>
              <div className="truncate text-[11.5px] text-dim">{game ? game.name : 'Any game'}</div>
            </div>
            <span className="tnum flex shrink-0 items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[12px] font-extrabold text-accent">
              <IconCheck size={12} /> {fmt(c.reward, 0)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
