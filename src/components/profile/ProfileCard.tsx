import { motion } from 'framer-motion'
import { BadgeIcon, FramedAvatar, NameTag, ProfileBanner, TitleChip } from '../../art/cosmetics'
import { TierBadge } from '../../art/TierBadge'
import { TIERS, levelFromXp, tierOf } from '../../store/levels'
import { achievement } from '../../store/cosmetics'
import type { PublicProfile } from '../../lib/profiles'
import { fmtCompact } from '../../lib/format'
import { navigate } from '../../lib/router'
import { IconChevron, IconLock } from '../icons'
import { profilePath, seenText } from './data'

/*
  The pieces a player is shown with wherever other players are listed: the card a name opens on hover or tap
  (src/components/profile/PlayerName.tsx), the level pill, the online dot and the grey skeletons shown while they
  load (the row chip is src/components/profile/PlayerChip.tsx). The cosmetics themselves are drawn in
  src/art/cosmetics.tsx; these only arrange them.
*/

/** a green dot on an avatar's corner for a player online now; `ring` matches what it sits on */
export function OnlineDot({ size = 12, ring = 'border-panel', className = 'absolute bottom-0 right-0' }: { size?: number; ring?: string; className?: string }) {
  return (
    <span className={`block rounded-full border-2 bg-accent shadow-[0_0_10px_rgba(34,211,111,.7)] ${ring} ${className}`} style={{ width: size, height: size }} title="Online now">
      <span className="block h-full w-full animate-ping rounded-full bg-accent opacity-40" />
    </span>
  )
}

/** the level, in a pill of the VIP tier's colour with its shield */
export function LevelPill({ xp, tier: withTier = false, className = '' }: { xp: number; tier?: boolean; className?: string }) {
  const lv = levelFromXp(xp).level
  const t = tierOf(lv)
  return (
    <span className={`tnum inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full pl-1 pr-2 text-[11.5px] font-extrabold ${className}`} style={{ color: t.color, background: `${t.color}1c`, boxShadow: `inset 0 0 0 1px ${t.color}26` }}>
      <TierBadge color={t.color} rank={TIERS.findIndex((x) => x.name === t.name)} size={13} />
      {withTier ? `${t.name} · Lv ${lv}` : `Lv ${lv}`}
    </span>
  )
}

/** a grey placeholder block that breathes while something loads */
export function Skel({ className = '' }: { className?: string }) {
  return <span className={`block animate-pulse rounded-md bg-raised/70 ${className}`} />
}

/**
 * The card a player's name opens: their banner, framed avatar, name, title, level and tier with the way to the next
 * level, whether they are online, a few numbers (when they share them), their showcase badges, and View profile.
 */
export function ProfileCard({ p, onOpen }: { p: PublicProfile; onOpen?: () => void }) {
  const lv = levelFromXp(p.xp)
  const tier = tierOf(lv.level)
  const pct = Math.max(3, Math.min(100, (lv.into / lv.need) * 100))
  const stats: [string, string][] | null = p.stats
    ? [
        ['Rounds', fmtCompact(p.stats.rounds)],
        ['Wagered', fmtCompact(p.stats.wagered)],
        ['Best win', fmtCompact(p.stats.biggestWin)],
      ]
    : null
  const open = () => {
    onOpen?.()
    navigate(profilePath(p.username))
  }
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-panel ring-1 ring-white/[.07]">
      <ProfileBanner id={p.look.banner} className="h-[84px]">
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 via-black/10 to-[#112230]" />
        <span className={`absolute right-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-extrabold backdrop-blur-sm ${p.online ? 'text-accent' : 'text-white/70'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${p.online ? 'bg-accent' : 'bg-white/40'}`} />
          {seenText(p)}
        </span>
      </ProfileBanner>
      <div className="relative px-4 pb-4">
        <div className="-mt-10 flex items-end justify-between gap-3">
          <FramedAvatar avatar={p.avatar} frame={p.look.frame} size={72} className="drop-shadow-[0_8px_16px_rgba(0,0,0,.6)]" />
          {p.look.badges.length > 0 && (
            <span className="mb-1 flex gap-1">
              {p.look.badges.map((b) => (
                <BadgeIcon key={b} id={b} size={26} />
              ))}
            </span>
          )}
        </div>
        <NameTag name={p.username} color={p.look.nameColor} className="mt-2 block truncate text-[19px] leading-tight tracking-tight" />
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <LevelPill xp={p.xp} tier />
          <TitleChip id={p.look.title} />
        </div>
        <div className="mt-3">
          <div className="flex justify-between text-[10.5px] font-bold text-dim">
            <span>Level {lv.level + 1}</span>
            <span className="tnum">{Math.floor(pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stage">
            <motion.div className="h-full rounded-full" style={{ background: tier.color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 120, damping: 22 }} />
          </div>
        </div>
        {stats ? (
          <div className="mt-3 grid grid-cols-3 gap-1.5">
            {stats.map(([k, v]) => (
              <div key={k} className="rounded-lg bg-stage/70 px-2 py-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wide text-dim">{k}</div>
                <div className="tnum truncate text-[13.5px] font-extrabold">{v}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-stage/70 px-2.5 py-2 text-[11.5px] font-semibold text-dim">
            <IconLock size={13} /> Stats are private
          </div>
        )}
        <button
          type="button"
          onClick={open}
          className="group mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-raised text-[13.5px] font-extrabold text-ink shadow-[inset_0_1px_0_rgba(255,255,255,.06)] transition hover:bg-hover"
        >
          View profile <IconChevron size={15} className="transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    </div>
  )
}

/** the hover card while the profile loads */
export function ProfileCardSkeleton({ name }: { name: string }) {
  return (
    <div className="w-full overflow-hidden rounded-2xl bg-panel ring-1 ring-white/[.07]">
      <div className="h-[84px] animate-pulse bg-raised/40" />
      <div className="px-4 pb-4">
        <div className="-mt-10 h-[72px] w-[72px] animate-pulse rounded-full border-4 border-panel bg-raised" />
        <div className="mt-2 truncate text-[19px] font-extrabold leading-tight text-muted">{name}</div>
        <Skel className="mt-2 h-[22px] w-32 rounded-full" />
        <Skel className="mt-3 h-1.5 w-full rounded-full" />
        <div className="mt-3 grid grid-cols-3 gap-1.5">
          {[0, 1, 2].map((i) => (
            <Skel key={i} className="h-[42px] rounded-lg" />
          ))}
        </div>
        <Skel className="mt-3 h-10 w-full rounded-lg" />
      </div>
    </div>
  )
}

/** a short line for an achievement badge's tooltip */
export const badgeTitle = (id: string) => {
  const a = achievement(id)
  return a ? `${a.name}: ${a.line}` : ''
}
