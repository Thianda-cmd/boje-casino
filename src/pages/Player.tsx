import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgeIcon, FramedAvatar, NameTag, ProfileBanner, RARITY, TitleChip } from '../art/cosmetics'
import { PageBackdrop, hasScene } from '../art/backdrops'
import { TierBadge } from '../art/TierBadge'
import { GameCover } from '../components/covers'
import { GameIcon } from '../components/GameIcon'
import { Coin, IconChart, IconCheck, IconChevron, IconLock, IconStar, IconTrophy, IconUsers } from '../components/icons'
import { LevelPill, OnlineDot, Skel, badgeTitle } from '../components/profile/ProfileCard'
import { copyText, monthYear, profileLink, seenText, useMedia, useMyLook, useProfile } from '../components/profile/data'
import { fmt, fmtAgo, fmtCompact, fmtMult } from '../lib/format'
import type { PublicBet, PublicProfile, PublicStats } from '../lib/profiles'
import { navigate, useRoute } from '../lib/router'
import { useNow } from '../lib/useNow'
import { useAuth } from '../store/auth'
import { achievement, allAchievements, earnedAchievements, type Achievement, type Rarity } from '../store/cosmetics'
import { GAMES, gameInfo, type GameId } from '../store/games'
import { TIERS, levelFromXp, tierOf } from '../store/levels'
import { DEFAULT_PRIVACY, useWallet } from '../store/wallet'

/*
  A player's public profile, at #/player/<username>: their banner, framed avatar (with its aura), name in its colour,
  title and showcase badges, their level and VIP tier, whether they are online, when they joined and their bio; then,
  unless they keep them private, their numbers, favourite games and achievements, and their recent big wins. The
  whole page stands on their backdrop (src/art/backdrops.tsx PageBackdrop), still behind the scrolling page, and what
  sits straight on it (the way back, the own-profile note) gets a solid footing so it stays readable.

  The profile comes from the server (src/lib/profiles.ts fetchProfile, kept for the visit by
  src/components/profile/data.ts, so a profile opened from a hover card shows at once). The signed-in player's own
  profile shows what they wear and wrote this moment (the server's copy follows a few seconds after a change), with
  a note on what their privacy settings share and the way to edit it.
*/

const RANK: Record<Rarity, number> = { mythic: -1, legendary: 0, epic: 1, rare: 2, common: 3 }

const IconLink = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6" />
  </svg>
)
const IconPen = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
)
const IconCalendar = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
)
const IconEye = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

/** the username in the route, decoded; '' when there is none */
function nameIn(route: string) {
  const raw = route.replace(/^\/player\/?/, '').split(/[/?#]/)[0] ?? ''
  try {
    return decodeURIComponent(raw).trim()
  } catch {
    return raw.trim()
  }
}

export default function Player() {
  // each profile is a page of its own (App.tsx keys pages by route): the name is read once, so a page fading out
  // after the route has moved on doesn't turn into a profile of whatever the new route says
  const route = useRoute()
  const [name] = useState(() => nameIn(route))
  const { answer, retry } = useProfile(name)
  const me = useAuth((s) => s.profile)
  const own = !!me && !!name && me.username.toLowerCase() === name.toLowerCase()

  let body: ReactNode
  if (!name) body = <NotFound name="" />
  else if (answer === undefined) body = <ProfileSkeleton />
  else if (answer === 'offline') body = <Offline onRetry={retry} />
  else if (answer === null) body = <NotFound name={name} />
  else body = <Profile p={answer} own={own} />
  const scene = !!answer && answer !== 'offline' && hasScene(answer.look.backdrop)
  return (
    <div className="flex flex-col gap-4">
      <button onClick={() => navigate('/players')} className={`flex h-8 items-center gap-1 self-start rounded-lg pr-2.5 text-[13px] font-bold transition hover:text-ink ${scene ? 'bg-black/40 pl-1.5 text-ink/85 backdrop-blur-sm' : 'text-muted'}`}>
        <IconChevron size={15} className="rotate-180" /> Players
      </button>
      {body}
    </div>
  )
}

/* ------------------------------ the profile ------------------------------ */

/** the own profile as it is now on this device: the look, bio, avatar and level the server is about to have */
function useOwn(p: PublicProfile, own: boolean): PublicProfile {
  const look = useMyLook()
  const bio = useWallet((s) => s.profile?.bio ?? '')
  const xp = useWallet((s) => s.xp)
  const avatar = useAuth((s) => s.profile?.avatar)
  return useMemo(() => (own ? { ...p, look, bio, xp: Math.max(p.xp, xp), avatar: avatar ?? p.avatar, online: true } : p), [p, own, look, bio, xp, avatar])
}

function Profile({ p: server, own }: { p: PublicProfile; own: boolean }) {
  const p = useOwn(server, own)
  return (
    <>
      <PageBackdrop key={p.look.backdrop} id={p.look.backdrop} />
      {own && <OwnNote solid={hasScene(p.look.backdrop)} />}
      <Header p={p} own={own} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          {p.stats ? (
            <>
              <StatTiles s={p.stats} />
              <Favourites s={p.stats} />
              <Achievements s={p.stats} showcase={p.look.badges} />
            </>
          ) : (
            <PrivateStats name={p.username} />
          )}
          <BigWins wins={p.bigWins} />
        </div>
        <div className="flex flex-col gap-4">
          <VipCard xp={p.xp} />
          <Details p={p} />
        </div>
      </div>
    </>
  )
}

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`relative overflow-hidden rounded-2xl bg-panel p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] sm:p-5 ${className}`}>{children}</section>
}

function PanelTitle({ icon, children, right }: { icon: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3.5 flex min-h-7 items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[16px] font-extrabold tracking-tight">
        <span className="shrink-0 text-muted">{icon}</span>
        <span className="truncate">{children}</span>
      </h2>
      {right}
    </div>
  )
}

/** the signed-in player looking at their own profile: what it shares, and the way to change it */
function OwnNote({ solid = false }: { solid?: boolean }) {
  const saved = useWallet((s) => s.profile?.privacy)
  const privacy = { ...DEFAULT_PRIVACY, ...(saved ?? {}) }
  const bits: [string, string, boolean][] = [
    ['Stats shown', 'Stats hidden', privacy.stats],
    ['Big wins shown', 'Big wins hidden', privacy.bets],
    ['Listed in search', 'Not listed', privacy.listed],
  ]
  return (
    <div className={`flex flex-col gap-3 rounded-xl bg-[linear-gradient(90deg,rgba(34,211,111,.13),rgba(34,211,111,.03))] px-4 py-3 ring-1 ring-accent/20 sm:flex-row sm:items-center ${solid ? 'bg-panel' : ''}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
          <IconEye size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[14px] font-extrabold">This is your public profile</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {bits.map(([yes, no, on]) => (
              <span key={yes} className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? 'bg-accent/12 text-accent' : 'bg-raised text-dim'}`}>
                {on ? <IconCheck size={11} strokeWidth={3} /> : <IconLock size={11} />} {on ? yes : no}
              </span>
            ))}
          </div>
        </div>
      </div>
      <button onClick={() => navigate('/account')} className="flex h-9 shrink-0 items-center justify-center gap-1 self-start rounded-lg px-3 text-[13px] font-bold text-accent transition hover:bg-accent/10 sm:self-auto">
        Privacy settings <IconChevron size={14} />
      </button>
    </div>
  )
}

function Header({ p, own }: { p: PublicProfile; own: boolean }) {
  const wide = useMedia('(min-width: 640px)')
  const now = useNow(60_000)
  const since = monthYear(p.createdAt)
  return (
    <section className="relative overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
      <ProfileBanner id={p.look.banner} className="h-[128px] sm:h-[210px]">
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/40" />
      </ProfileBanner>
      <div className="relative px-4 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
          <div className="flex items-end justify-between gap-3">
            <motion.div
              className="relative -mt-[52px] shrink-0 sm:-mt-[76px]"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            >
              <span className="absolute inset-[6%] rounded-full bg-panel" />
              <FramedAvatar avatar={p.avatar} frame={p.look.frame} aura={p.look.aura} size={wide ? 140 : 100} className="relative drop-shadow-[0_14px_26px_rgba(0,0,0,.6)]" />
              {p.online && <OnlineDot size={wide ? 22 : 18} ring="border-panel" className="absolute bottom-[9%] right-[9%]" />}
            </motion.div>
            {!wide && (
              <div className="flex min-w-0 gap-2 pb-1">
                <CopyLink name={p.username} short />
                {own && <EditButton short />}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <NameTag key={p.look.nameColor} name={p.username} color={p.look.nameColor} className="min-w-0 truncate text-[27px] font-black leading-tight tracking-tight sm:text-[34px]" />
              <TitleChip id={p.look.title} className="text-[12px]" />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-[13px] font-semibold text-muted">
              <LevelPill xp={p.xp} tier />
              <span className={`flex items-center gap-1.5 ${p.online ? 'text-accent' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${p.online ? 'bg-accent shadow-[0_0_8px_rgba(34,211,111,.8)]' : 'bg-dim'}`} />
                {seenText(p, now)}
              </span>
              {since && (
                <span className="flex items-center gap-1.5">
                  <IconCalendar size={14} /> Member since {since}
                </span>
              )}
            </div>
          </div>
          {wide && (
            <div className="flex gap-2 pb-1">
              <CopyLink name={p.username} />
              {own && <EditButton />}
            </div>
          )}
        </div>
        {(p.bio || p.look.badges.length > 0) && (
          <div className="mt-4 flex flex-col gap-4 border-t border-line/70 pt-4 lg:flex-row lg:items-end lg:justify-between lg:gap-8">
            {p.bio && (
              <div className="min-w-0">
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-dim">About</div>
                <p className="max-w-[620px] text-pretty text-[14.5px] leading-relaxed text-ink/85">{p.bio}</p>
              </div>
            )}
            {p.look.badges.length > 0 && (
              <div className="min-w-0 lg:shrink-0">
                <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">Showcase</div>
                <div className="flex flex-wrap gap-2">
                  {p.look.badges.map((b, i) => (
                    <Showcased key={b} id={b} i={i} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

/** a badge in the showcase: its picture, name and rarity */
function Showcased({ id, i }: { id: string; i: number }) {
  const a = achievement(id)
  if (!a) return null
  const r = RARITY[a.rarity]
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26, delay: 0.08 + i * 0.06 }}
      className="flex min-w-0 items-center gap-2.5 rounded-xl bg-stage/70 py-1.5 pl-1.5 pr-3.5 ring-1 ring-white/[.04]"
      title={badgeTitle(id)}
    >
      <BadgeIcon id={id} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-extrabold leading-tight">{a.name}</span>
        <span className="block text-[11px] font-bold" style={{ color: r.color }}>
          {r.name}
        </span>
      </span>
    </motion.div>
  )
}

function EditButton({ short = false }: { short?: boolean }) {
  return (
    <button onClick={() => navigate('/account')} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-raised px-3.5 text-[13.5px] font-bold transition hover:bg-hover sm:px-4">
      <IconPen size={15} /> {short ? 'Edit' : 'Edit profile'}
    </button>
  )
}

function CopyLink({ name, short = false }: { name: string; short?: boolean }) {
  const [done, setDone] = useState<null | boolean>(null)
  useEffect(() => {
    if (done === null) return
    const t = setTimeout(() => setDone(null), 2200)
    return () => clearTimeout(t)
  }, [done])
  return (
    <button
      onClick={async () => setDone(await copyText(profileLink(name)))}
      className={`flex h-10 min-w-0 items-center justify-center gap-2 rounded-lg px-3.5 text-[13.5px] font-bold transition sm:px-4 ${done ? 'bg-accent/15 text-accent' : 'bg-raised text-ink hover:bg-hover'}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={String(done)} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }} className="flex items-center gap-2">
          {done ? <IconCheck size={16} strokeWidth={3} /> : <IconLink size={16} />}
          {done ? (short ? 'Copied' : 'Link copied') : done === false ? "Couldn't copy" : short ? 'Copy link' : 'Copy profile link'}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}

/* ------------------------------ stats ------------------------------ */

function StatTiles({ s }: { s: PublicStats }) {
  const earned = earnedAchievements(s.source).length
  const total = allAchievements().length
  const tiles: { k: string; v: ReactNode; icon: ReactNode; tone?: string; sub?: string }[] = [
    { k: 'Rounds played', v: fmt(s.rounds, 0), icon: <IconChart size={14} /> },
    { k: 'Total wagered', v: fmtCompact(s.wagered), icon: <Coin size={14} />, sub: `${fmt(s.wagered, 0)} coins` },
    { k: 'Biggest win', v: fmtCompact(s.biggestWin), icon: <IconTrophy size={14} />, tone: s.biggestWin > 0 ? 'text-gold' : '', sub: s.biggestWin > 0 ? `${fmt(s.biggestWin, 0)} coins` : undefined },
    { k: 'Achievements', v: `${earned} / ${total}`, icon: <IconStar size={14} /> },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t, i) => (
        <motion.div
          key={t.k}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30, delay: i * 0.04 }}
          className="rounded-xl bg-panel px-3.5 py-3 sm:px-4"
          title={t.sub}
        >
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
            {t.icon} {t.k}
          </div>
          <div className={`tnum mt-1 truncate text-[21px] font-black tracking-tight ${t.tone ?? ''}`}>{t.v}</div>
        </motion.div>
      ))}
    </div>
  )
}

function Favourites({ s }: { s: PublicStats }) {
  const known = new Set<string>(GAMES.map((g) => g.id))
  const top = Object.entries(s.gamesPlayed)
    .filter(([id, n]) => known.has(id) && n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4) as [GameId, number][]
  const most = top[0]?.[1] ?? 1
  return (
    <Panel>
      <PanelTitle icon={<IconStar size={17} />}>Favourite games</PanelTitle>
      {top.length ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {top.map(([id, n], i) => {
            const g = gameInfo(id)
            return (
              <button key={id} onClick={() => navigate(`/game/${id}`)} className="group flex min-w-0 items-center gap-3 rounded-xl bg-stage/60 p-2 pr-3.5 text-left ring-1 ring-white/[.03] transition hover:bg-stage">
                <span className="relative h-[72px] w-[58px] shrink-0 overflow-hidden rounded-lg shadow-[0_8px_18px_-8px_rgba(0,0,0,.8)] ring-1 ring-white/5 transition-transform group-hover:-translate-y-0.5">
                  <GameCover id={id} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider" style={{ color: g.accent }}>
                    #{i + 1}
                  </span>
                  <span className="block truncate text-[15px] font-extrabold leading-tight">{g.name}</span>
                  <span className="tnum mt-0.5 block text-[12px] font-semibold text-dim">{fmt(n, 0)} rounds</span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-black/30">
                    <motion.span className="block h-full rounded-full" style={{ background: g.accent }} initial={{ width: 0 }} animate={{ width: `${Math.max(6, (n / most) * 100)}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20, delay: 0.1 + i * 0.05 }} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      ) : (
        <p className="rounded-xl bg-stage/50 px-4 py-5 text-center text-[13.5px] text-muted">No favourites yet. Rounds of 25 coins or more count here.</p>
      )}
    </Panel>
  )
}

function Achievements({ s, showcase }: { s: PublicStats; showcase: string[] }) {
  const [all, setAll] = useState(false)
  const list = allAchievements()
  const earned = new Set(earnedAchievements(s.source))
  const sorted = [...list].sort((a, b) => Number(earned.has(b.id)) - Number(earned.has(a.id)) || RANK[a.rarity] - RANK[b.rarity])
  const shown = all ? sorted : sorted.filter((a) => earned.has(a.id))
  const locked = list.length - earned.size
  return (
    <Panel>
      <PanelTitle
        icon={<IconTrophy size={17} />}
        right={
          <span className="tnum text-[12.5px] font-bold text-dim">
            <span className="text-ink">{earned.size}</span> of {list.length}
          </span>
        }
      >
        Achievements
      </PanelTitle>
      <div className="-mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-stage">
        <motion.div className="h-full rounded-full bg-[linear-gradient(90deg,#f7c548,#ffe38f)]" initial={{ width: 0 }} animate={{ width: `${(earned.size / Math.max(1, list.length)) * 100}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
      </div>
      {shown.length ? (
        <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
          {shown.map((a, i) => (
            <AchievementTile key={a.id} a={a} on={earned.has(a.id)} showcased={showcase.includes(a.id)} i={i} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-stage/50 px-4 py-5 text-center text-[13.5px] text-muted">No achievements yet. The first one comes with the first win.</p>
      )}
      {locked > 0 && (
        <button onClick={() => setAll(!all)} className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-stage/60 text-[13px] font-bold text-muted transition hover:text-ink">
          {all ? 'Hide locked' : `Show ${locked} locked`}
          <IconChevron size={14} className={`transition-transform ${all ? '-rotate-90' : 'rotate-90'}`} />
        </button>
      )}
    </Panel>
  )
}

function AchievementTile({ a, on, showcased, i }: { a: Achievement; on: boolean; showcased: boolean; i: number }) {
  const r = RARITY[a.rarity]
  return (
    <motion.div
      layout="position"
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 30, delay: Math.min(i, 18) * 0.015 }}
      className={`relative flex min-w-0 flex-col items-center gap-2 overflow-hidden rounded-xl px-2.5 py-3 text-center ring-1 sm:flex-row sm:items-center sm:gap-3 sm:py-2.5 sm:text-left ${on ? 'bg-stage/70 ring-white/[.04]' : 'bg-stage/30 ring-white/[.02]'}`}
      title={`${a.name}: ${a.line}`}
    >
      {on && <span className="pointer-events-none absolute left-1/2 top-2 h-16 w-16 -translate-x-1/2 rounded-full blur-2xl sm:-left-6 sm:top-1/2 sm:translate-x-0 sm:-translate-y-1/2" style={{ background: r.color, opacity: 0.18 }} />}
      {showcased && <span className="absolute right-1.5 top-1.5 rounded-full bg-gold/15 px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wider text-gold">Showcase</span>}
      <span className="relative shrink-0">
        <BadgeIcon id={a.id} size={42} locked={!on} />
      </span>
      <span className="relative w-full min-w-0 flex-1">
        <span className={`block truncate text-[13.5px] font-extrabold leading-tight ${on ? '' : 'text-muted'}`}>{a.name}</span>
        <span className="mt-0.5 line-clamp-2 text-[11.5px] font-semibold leading-snug text-dim">{a.line}</span>
        <span className="mt-1 block text-[10px] font-extrabold uppercase tracking-wider" style={{ color: on ? r.color : undefined }}>
          {r.name}
        </span>
      </span>
    </motion.div>
  )
}

/** a padlock on a felt table, for what a player keeps to themselves */
function LockArt({ size = 84 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden>
      <defs>
        <radialGradient id="pl-glow" cx=".5" cy=".55" r=".5">
          <stop offset="0" stopColor="#22d36f" stopOpacity=".28" />
          <stop offset="1" stopColor="#22d36f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pl-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset=".55" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c48a1c" />
        </linearGradient>
        <linearGradient id="pl-shackle" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#8aa0b4" />
          <stop offset=".5" stopColor="#e6eef5" />
          <stop offset="1" stopColor="#7d93a7" />
        </linearGradient>
      </defs>
      <circle cx="48" cy="52" r="46" fill="url(#pl-glow)" />
      <path d="M31 44V33a17 17 0 0 1 34 0v11" fill="none" stroke="url(#pl-shackle)" strokeWidth="8" strokeLinecap="round" />
      <rect x="20" y="42" width="56" height="42" rx="10" fill="#7a5410" />
      <rect x="20" y="40" width="56" height="41" rx="10" fill="url(#pl-body)" />
      <path d="M26 46h44" stroke="#fff" strokeOpacity=".45" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="48" cy="58" r="6" fill="#5b3d06" />
      <path d="M45.5 60h5l1.5 11h-8Z" fill="#5b3d06" />
    </svg>
  )
}

function PrivateStats({ name }: { name: string }) {
  return (
    <Panel className="flex flex-col items-center px-6 py-10 text-center sm:py-14">
      <span className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(ellipse_at_top,rgba(247,197,72,.10),transparent_70%)]" />
      <motion.div initial={{ y: 10, opacity: 0, rotate: -6 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
        <LockArt />
      </motion.div>
      <h2 className="mt-3 text-[20px] font-black tracking-tight">This player keeps their stats private</h2>
      <p className="mt-1.5 max-w-[420px] text-[13.5px] leading-relaxed text-muted">
        {name}'s rounds, favourite games and achievements are hidden. Their level and VIP tier are always public.
      </p>
    </Panel>
  )
}

function BigWins({ wins }: { wins: PublicBet[] | null }) {
  const now = useNow(60_000)
  return (
    <Panel>
      <PanelTitle icon={<IconTrophy size={17} />}>Recent big wins</PanelTitle>
      {wins === null ? (
        <div className="flex items-center gap-3 rounded-xl bg-stage/50 px-4 py-4 text-[13.5px] text-muted">
          <IconLock size={16} className="shrink-0 text-dim" /> This player keeps their recent wins private.
        </div>
      ) : !wins.length ? (
        <p className="rounded-xl bg-stage/50 px-4 py-5 text-center text-[13.5px] text-muted">No big wins yet.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {wins.map((w, i) => {
            const g = gameInfo(w.game)
            const mult = w.bet > 0 ? w.payout / w.bet : 0
            return (
              <motion.button
                key={`${w.game}-${w.time}-${i}`}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 30, delay: i * 0.04 }}
                onClick={() => !g.retired && navigate(`/game/${g.id}`)}
                className="flex min-w-0 items-center gap-3 rounded-xl bg-stage/60 px-3 py-2.5 text-left transition hover:bg-stage"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${g.accent}22`, color: g.accent }}>
                  <GameIcon id={g.id} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-extrabold">{g.name}</span>
                  <span className="tnum block text-[12px] font-semibold text-dim">
                    {fmt(w.bet)} bet · {fmtAgo(now - w.time)}
                  </span>
                </span>
                {mult > 0 && <span className="tnum hidden rounded-full bg-gold/12 px-2 py-0.5 text-[12px] font-extrabold text-gold sm:inline">{fmtMult(mult)}</span>}
                <span className="tnum flex shrink-0 items-center gap-1.5 text-[15px] font-black text-accent">
                  +{fmt(w.payout)} <Coin size={15} />
                </span>
              </motion.button>
            )
          })}
        </div>
      )}
    </Panel>
  )
}

/* ------------------------------ side ------------------------------ */

function VipCard({ xp }: { xp: number }) {
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  const next = TIERS[rank + 1]
  const pct = Math.max(2, Math.min(100, (lv.into / lv.need) * 100))
  return (
    <Panel>
      <span className="pointer-events-none absolute -right-16 -top-16 h-52 w-52 rounded-full blur-3xl" style={{ background: tier.color, opacity: 0.16 }} />
      <div className="relative flex items-center gap-4">
        <motion.span initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 240, damping: 14 }}>
          <TierBadge color={tier.color} rank={rank} size={60} />
        </motion.span>
        <span className="min-w-0">
          <span className="block text-[12px] font-bold uppercase tracking-wider text-dim">VIP tier</span>
          <span className="block text-[24px] font-black leading-tight tracking-tight" style={{ color: tier.color }}>
            {tier.name}
          </span>
          <span className="tnum block text-[13px] font-bold text-muted">Level {lv.level}</span>
        </span>
      </div>
      <div className="relative mt-4">
        <div className="flex justify-between text-[12px] font-semibold text-dim">
          <span>To level {lv.level + 1}</span>
          <span className="tnum">
            {fmtCompact(lv.into)} / {fmtCompact(lv.need)} XP
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stage">
          <motion.div className="h-full rounded-full" style={{ background: tier.color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-5 gap-1 rounded-xl bg-stage/60 px-1 py-2.5">
        {TIERS.map((t, i) => (
          <span key={t.name} className="flex flex-col items-center gap-1" title={`${t.name}: level ${t.min}+`}>
            <TierBadge color={t.color} rank={i} size={26} dim={i > rank} />
            <span className={`text-[10px] font-extrabold ${i === rank ? '' : 'text-dim'}`} style={i === rank ? { color: t.color } : undefined}>
              {t.name}
            </span>
          </span>
        ))}
      </div>
      <p className="relative mt-2.5 text-[12px] text-dim">{next ? `${next.name} at level ${next.min}.` : 'At the top tier.'} Every coin wagered is 1 XP.</p>
    </Panel>
  )
}

function Details({ p }: { p: PublicProfile }) {
  const now = useNow(60_000)
  const joined = Date.parse(p.createdAt)
  const rows: [ReactNode, string, ReactNode][] = [
    [<IconCalendar size={15} />, 'Member since', Number.isFinite(joined) ? new Date(joined).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown'],
    [
      <span className={`block h-2.5 w-2.5 rounded-full ${p.online ? 'bg-accent' : 'bg-dim'}`} />,
      'Status',
      <span className={p.online ? 'text-accent' : ''}>{p.online ? 'Online now' : seenText(p, now).replace(/^Last seen /, 'Seen ')}</span>,
    ],
    [<IconStar size={15} />, 'Showcase', `${p.look.badges.length} of 3 badges`],
  ]
  return (
    <Panel>
      <PanelTitle icon={<IconUsers size={17} />}>Player details</PanelTitle>
      <div className="flex flex-col divide-y divide-line/70">
        {rows.map(([icon, k, v]) => (
          <div key={k} className="flex items-center gap-3 py-2.5 text-[13.5px] first:pt-0 last:pb-0">
            <span className="flex w-5 shrink-0 justify-center text-dim">{icon}</span>
            <span className="font-semibold text-muted">{k}</span>
            <span className="tnum ml-auto truncate font-bold">{v}</span>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/* ------------------------------ other states ------------------------------ */

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <section className="overflow-hidden rounded-2xl bg-panel">
        <div className="h-[128px] animate-pulse bg-raised/35 sm:h-[210px]" />
        <div className="flex flex-col gap-3 px-4 pb-6 sm:flex-row sm:items-end sm:gap-5 sm:px-6">
          <span className="-mt-[52px] block h-[100px] w-[100px] shrink-0 animate-pulse rounded-full border-[6px] border-panel bg-raised sm:-mt-[76px] sm:h-[140px] sm:w-[140px]" />
          <div className="flex flex-1 flex-col gap-2.5 sm:pb-2">
            <Skel className="h-8 w-56 max-w-full" />
            <Skel className="h-4 w-72 max-w-full" />
          </div>
          <Skel className="h-10 w-40 rounded-lg" />
        </div>
      </section>
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} className="h-[74px] rounded-xl" />
            ))}
          </div>
          <Skel className="h-[220px] rounded-2xl" />
          <Skel className="h-[260px] rounded-2xl" />
        </div>
        <div className="flex flex-col gap-4">
          <Skel className="h-[250px] rounded-2xl" />
          <Skel className="h-[160px] rounded-2xl" />
        </div>
      </div>
    </div>
  )
}

/** an empty seat at the table, for a player who isn't there */
function EmptySeat() {
  return (
    <svg width="132" height="112" viewBox="0 0 132 112" aria-hidden>
      <defs>
        <radialGradient id="pe-felt" cx=".5" cy=".3" r=".8">
          <stop offset="0" stopColor="#1d6b45" />
          <stop offset="1" stopColor="#0b2a1c" />
        </radialGradient>
        <linearGradient id="pe-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7a4a22" />
          <stop offset="1" stopColor="#3e230d" />
        </linearGradient>
      </defs>
      <ellipse cx="66" cy="96" rx="62" ry="14" fill="url(#pe-rim)" />
      <ellipse cx="66" cy="93" rx="56" ry="11" fill="url(#pe-felt)" />
      <circle cx="66" cy="44" r="30" fill="#162b3a" stroke="#3a556b" strokeWidth="2.5" strokeDasharray="6 6" />
      <circle cx="66" cy="38" r="9" fill="#2b475c" />
      <path d="M50 62a16 13 0 0 1 32 0" fill="#2b475c" />
      <g transform="translate(92 14)">
        <circle r="13" fill="#f7c548" />
        <circle r="10" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeDasharray="3.2 3.2" />
        <text y="5.5" textAnchor="middle" fontSize="16" fontWeight="900" fill="#3a2600" fontFamily="Manrope, system-ui, sans-serif">
          ?
        </text>
      </g>
    </svg>
  )
}

function NotFound({ name }: { name: string }) {
  return (
    <Panel className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
        <EmptySeat />
      </motion.div>
      <h1 className="mt-4 max-w-full truncate text-[22px] font-black tracking-tight">{name ? `No player called “${name}”` : 'Which player?'}</h1>
      <p className="mt-1.5 max-w-[420px] text-[14px] leading-relaxed text-muted">They may have changed their name, deleted their account or chosen not to be listed. Guests have no public profile.</p>
      <div className="mt-5 flex w-full max-w-[360px] flex-col gap-2 sm:flex-row">
        <button onClick={() => navigate('/players')} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 text-[14px] font-extrabold text-[#032412] shadow-[inset_0_-2px_0_rgba(0,0,0,.16)] transition hover:brightness-110">
          <IconUsers size={17} /> Find players
        </button>
        <button onClick={() => navigate('/')} className="h-11 flex-1 rounded-lg bg-raised px-4 text-[14px] font-bold transition hover:bg-hover">
          Back to the lobby
        </button>
      </div>
    </Panel>
  )
}

/** a plug pulled out of its socket */
function Unplugged() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden>
      <defs>
        <linearGradient id="pu-plug" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b7389" />
          <stop offset="1" stopColor="#2b475c" />
        </linearGradient>
      </defs>
      <path d="M4 70c18 0 22-22 40-22" fill="none" stroke="#2b475c" strokeWidth="6" strokeLinecap="round" />
      <rect x="40" y="36" width="22" height="26" rx="6" fill="url(#pu-plug)" />
      <path d="M62 42h9M62 56h9" stroke="#90a4b8" strokeWidth="4" strokeLinecap="round" />
      <rect x="82" y="30" width="26" height="36" rx="7" fill="#162b3a" stroke="#3a556b" strokeWidth="2.5" />
      <circle cx="95" cy="42" r="2.6" fill="#0a1620" />
      <circle cx="95" cy="54" r="2.6" fill="#0a1620" />
      <path d="M74 22l4 6M80 18l1 7M86 20l-2 6" stroke="#ff4d61" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

function Offline({ onRetry }: { onRetry: () => void }) {
  return (
    <Panel className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
      <Unplugged />
      <h1 className="mt-4 text-[22px] font-black tracking-tight">Profiles can't be reached right now</h1>
      <p className="mt-1.5 max-w-[420px] text-[14px] leading-relaxed text-muted">Your games and coins are fine. Check your connection and try again in a moment.</p>
      <button onClick={onRetry} className="mt-5 h-11 rounded-lg bg-raised px-6 text-[14px] font-extrabold transition hover:bg-hover">
        Try again
      </button>
    </Panel>
  )
}
