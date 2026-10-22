/*
  The player's profile as others see it, in two sizes. ProfileHeader is the wide one at the top of the Overview: the
  banner across the top, the framed avatar breaking over its lower edge, the name in its colour with the title, the
  three showcase badges, the VIP tier with the level bar on the right, and a row of account details under a rule.
  ProfileCard is the narrow one: the wardrobe's live preview and the shop's try-on, which draw whatever look they are
  handed (one being tried on included).
*/
import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { BadgeIcon, FramedAvatar, NameTag, ProfileBanner, TitleChip } from '../../art/cosmetics'
import { TierBadge } from '../../art/TierBadge'
import { fmt } from '../../lib/format'
import { TIERS, levelFromXp, tierIndexOf } from '../../store/wallet'
import { SHOWCASE, achievement, type Look } from '../../store/cosmetics'
import { Bar, useMedia } from './kit'

/** the VIP tier's shield, the level and the bar to the next one */
export function LevelBlock({ xp, className = '', compact = false }: { xp: number; className?: string; compact?: boolean }) {
  const lv = levelFromXp(xp)
  const t = tierIndexOf(lv.level)
  const tier = TIERS[t]
  const pct = (lv.into / lv.need) * 100
  return (
    <div className={`flex items-center gap-3 rounded-xl bg-stage/70 ring-1 ring-white/[.05] ${compact ? 'px-3 py-2.5' : 'px-3.5 py-3'} ${className}`}>
      <TierBadge color={tier.color} rank={t} size={compact ? 32 : 40} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate text-[14px] font-extrabold" style={{ color: tier.color }}>
            {tier.name} · Level {lv.level}
          </span>
          <span className="tnum shrink-0 text-[11.5px] font-bold text-dim">{Math.floor(pct)}%</span>
        </div>
        <Bar pct={pct} color={tier.color} className="mt-1.5 h-1.5" track="bg-black/35" label="Progress to the next level" />
        {!compact && <div className="tnum mt-1.5 truncate text-[11.5px] font-semibold text-dim">{fmt(Math.max(0, lv.need - lv.into), 0)} XP to level {lv.level + 1}</div>}
      </div>
    </div>
  )
}

/** the three showcase slots: badges, and empty slots (a press on one opens the achievements, when given) */
export function Showcase({ badges, size = 34, onEmpty }: { badges: string[]; size?: number; onEmpty?: () => void }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: SHOWCASE }, (_, i) => {
        const id = badges[i]
        if (id)
          return (
            <motion.span key={id} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 22 }} title={achievement(id)?.name}>
              <BadgeIcon id={id} size={size} />
            </motion.span>
          )
        const slot = <span className="block rounded-full border-2 border-dashed border-white/12" style={{ width: size - 6, height: size - 6, margin: 3 }} />
        return onEmpty ? (
          <button key={`e${i}`} onClick={onEmpty} aria-label="Choose a badge to show" className="rounded-full transition hover:brightness-150">
            {slot}
          </button>
        ) : (
          <span key={`e${i}`}>{slot}</span>
        )
      })}
    </div>
  )
}

export function ProfileHeader({ look, avatar, name, xp, meta, actions, onBadges }: { look: Look; avatar: number; name: string; xp: number; meta?: ReactNode; actions?: ReactNode; onBadges?: () => void }) {
  const wide = useMedia('(min-width: 640px)')
  return (
    <div className="relative overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-white/[.04]" data-profile-header>
      <ProfileBanner id={look.banner} className="h-[124px] sm:h-[188px]">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-panel/85 to-transparent" />
      </ProfileBanner>
      <div className="relative px-4 pb-4 sm:px-6 sm:pb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-5">
          <div className="-mt-[56px] w-fit shrink-0 sm:-mt-[74px]">
            <FramedAvatar avatar={avatar} frame={look.frame} size={wide ? 140 : 104} />
          </div>
          <div className="min-w-0 flex-1 sm:pb-1">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
              <NameTag name={name} color={look.nameColor} className="max-w-full truncate text-[27px] leading-[1.1] tracking-tight sm:text-[33px]" />
              <TitleChip id={look.title} />
            </div>
            <div className="mt-2.5">
              <Showcase badges={look.badges} onEmpty={onBadges} />
            </div>
          </div>
          <LevelBlock xp={xp} className="w-full sm:mb-1 sm:w-[290px]" />
        </div>
        {(meta || actions) && (
          <div className="mt-4 flex flex-col gap-3 border-t border-line pt-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] font-semibold text-muted">{meta}</div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
          </div>
        )}
      </div>
    </div>
  )
}

/** the narrow profile: the live preview in the wardrobe and the shop's try-on */
export function ProfileCard({ look, avatar, name, xp, ribbon, className = '' }: { look: Look; avatar: number; name: string; xp: number; ribbon?: ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.85)] ring-1 ring-white/[.06] ${className}`} data-profile-card>
      <ProfileBanner id={look.banner} className="h-[112px]">
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-panel/80 to-transparent" />
      </ProfileBanner>
      {ribbon && <div className="absolute right-3 top-3">{ribbon}</div>}
      <div className="relative px-4 pb-4">
        <div className="-mt-12 flex items-end justify-between gap-3">
          <FramedAvatar avatar={avatar} frame={look.frame} size={96} />
          <div className="pb-1">
            <Showcase badges={look.badges} size={28} />
          </div>
        </div>
        <div className="mt-2 flex min-w-0 flex-col items-start gap-1.5">
          <NameTag name={name} color={look.nameColor} className="max-w-full truncate text-[23px] leading-tight tracking-tight" />
          <TitleChip id={look.title} />
        </div>
        <LevelBlock xp={xp} compact className="mt-3" />
      </div>
    </div>
  )
}
