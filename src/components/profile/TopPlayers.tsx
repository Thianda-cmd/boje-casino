import { motion } from 'framer-motion'
import { FramedAvatar, NameTag, ProfileBanner } from '../../art/cosmetics'
import { navigate } from '../../lib/router'
import { RowTitle } from '../GameRows'
import { IconChevron, IconTrophy } from '../icons'
import { LevelPill, OnlineDot } from './ProfileCard'
import { profilePath, useBoard } from './data'

/*
  The lobby's Top players: the five highest levels in the casino, each on their own banner with their framed avatar,
  name and level, and the way to the whole Players page. It loads after the lobby (src/components/profile/data.ts
  keeps the board for a minute) and stays out of the way when the boards can't be reached or are empty.
*/

const PLACE = ['#f7c548', '#c6d2de', '#d4925a', '#90a4b8', '#90a4b8'] as const

export function TopPlayers() {
  const { rows } = useBoard('level')
  if (rows === 'offline' || (Array.isArray(rows) && !rows.length)) return null
  const top = Array.isArray(rows) ? rows.slice(0, 5) : null
  return (
    <section>
      <RowTitle
        icon={<IconTrophy size={18} />}
        right={
          <button onClick={() => navigate('/players')} className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[13px] font-bold text-muted transition hover:bg-panel hover:text-ink">
            View all <IconChevron size={14} />
          </button>
        }
      >
        Top players
      </RowTitle>
      <div className="no-scrollbar -mx-3 flex snap-x snap-mandatory scroll-px-3 gap-2.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-5">
        {top
          ? top.map((r, i) => (
              <motion.button
                key={r.username}
                onClick={() => navigate(profilePath(r.username))}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 360, damping: 28, delay: i * 0.05 }}
                className={`group w-[210px] shrink-0 snap-start text-left sm:w-auto ${i >= 3 ? 'sm:hidden lg:block' : ''}`}
              >
                <ProfileBanner id={r.look.banner} className="h-[76px] rounded-xl ring-1 ring-white/[.06] transition-transform duration-200 group-hover:-translate-y-1">
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/75 via-black/50 to-black/15" />
                  <span className="relative flex h-full min-w-0 items-center gap-3 px-3">
                    <span className="tnum w-4 shrink-0 text-center text-[15px] font-black" style={{ color: PLACE[i] }}>
                      {i + 1}
                    </span>
                    <span className="relative shrink-0">
                      <FramedAvatar avatar={r.avatar} frame={r.look.frame} size={48} />
                      {r.online && <OnlineDot size={12} ring="border-black/60" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <NameTag name={r.username} color={r.look.nameColor} className="block truncate text-[14.5px] leading-tight drop-shadow" />
                      <span className="mt-1 flex">
                        <LevelPill xp={r.xp} />
                      </span>
                    </span>
                  </span>
                </ProfileBanner>
              </motion.button>
            ))
          : Array.from({ length: 5 }, (_, i) => <span key={i} className={`block h-[76px] w-[210px] shrink-0 animate-pulse rounded-xl bg-panel sm:w-auto ${i >= 3 ? 'sm:hidden lg:block' : ''}`} />)}
      </div>
    </section>
  )
}
