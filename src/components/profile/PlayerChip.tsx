import type { ReactNode } from 'react'
import { FramedAvatar, NameTag, TitleChip } from '../../art/cosmetics'
import type { PlayerRow } from '../../lib/profiles'
import { PlayerName } from './PlayerName'
import { OnlineDot, Skel } from './ProfileCard'

/*
  A player in a row (the leaderboards, search results, the finder): their framed avatar with the online dot, their
  name in its colour, and their title (or whatever `sub` puts there). With `card`, the name itself opens the player's
  hover card (src/components/profile/PlayerName.tsx) while the rest of the row does what the row does.
*/

/** what a chip needs: a leaderboard row or a whole profile */
export type Who = Pick<PlayerRow, 'username' | 'avatar' | 'look' | 'xp' | 'online'>

export function PlayerChip({ who, size = 42, ring = 'border-panel', sub, nameClass = 'text-[14.5px]', card = false }: { who: Who; size?: number; ring?: string; sub?: ReactNode; nameClass?: string; card?: boolean }) {
  const name = <NameTag name={who.username} color={who.look.nameColor} className={`block truncate leading-tight ${nameClass}`} />
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="relative shrink-0">
        <FramedAvatar avatar={who.avatar} frame={who.look.frame} size={size} />
        {who.online && <OnlineDot size={Math.max(10, Math.round(size * 0.27))} ring={ring} />}
      </span>
      <span className="min-w-0">
        {card ? (
          <PlayerName name={who.username} acct className="block max-w-full truncate">
            {name}
          </PlayerName>
        ) : (
          name
        )}
        <span className="mt-1 flex min-w-0 items-center gap-1.5">{sub ?? <TitleChip id={who.look.title} className="truncate" />}</span>
      </span>
    </span>
  )
}

/** a chip-shaped skeleton, for lists that are loading */
export function PlayerChipSkeleton({ size = 42 }: { size?: number }) {
  return (
    <span className="flex min-w-0 items-center gap-3">
      <span className="block shrink-0 animate-pulse rounded-full bg-raised/70" style={{ width: size, height: size }} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skel className="h-3.5 w-28" />
        <Skel className="h-3 w-16" />
      </span>
    </span>
  )
}
