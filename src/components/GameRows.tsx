import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CATEGORIES, GAMES, gameInfo, type GameId, type GameInfo } from '../store/games'
import { navigate } from '../lib/router'
import { GameCover } from './covers'
import { IconChevron, IconFire } from './icons'

/* The game tiles the lobby and the game pages share: a cover card, and a row of them that scrolls sideways with arrow
   buttons and a "View all" link. */

export function GameCard({ g, i = 0, below }: { g: GameInfo; i?: number; below?: ReactNode }) {
  return (
    <button onClick={() => navigate(`/game/${g.id}`)} className="card-in group block w-full text-left" style={{ animationDelay: `${0.03 * Math.min(i, 12)}s` }}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-panel2 shadow-[0_14px_30px_-16px_rgba(0,0,0,.9)] ring-1 ring-white/5 transition-transform duration-200 will-change-transform group-hover:-translate-y-1.5 group-active:translate-y-0 group-active:scale-[.98]">
        <GameCover id={g.id} />
        {g.tag && <Tag tag={g.tag} />}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-14">
          <div className="text-[16px] font-black leading-tight tracking-tight text-white drop-shadow sm:text-[18px]">{g.name}</div>
        </div>
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity will-change-[opacity] group-hover:opacity-100">
          <span className="rounded-full bg-white px-5 py-2.5 text-[14px] font-extrabold text-[#0b1520] shadow-lg">Play</span>
        </div>
      </div>
      {below}
    </button>
  )
}

export function Tag({ tag }: { tag: 'new' | 'live' | 'hot' }) {
  if (tag === 'live')
    return (
      <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        Live
      </span>
    )
  return (
    <span
      className={`absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
        tag === 'new' ? 'bg-accent text-[#032412]' : 'bg-gold text-[#2a1c00]'
      }`}
    >
      {tag === 'hot' && <IconFire size={11} strokeWidth={3} />}
      {tag}
    </span>
  )
}

/** a section heading: an icon, the title, a count, and whatever goes on the right */
export function RowTitle({ icon, children, count, right }: { icon?: ReactNode; children: ReactNode; count?: number; right?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
      <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-extrabold tracking-tight">
        {icon && <span className="shrink-0 text-muted">{icon}</span>}
        <span className="truncate">{children}</span>
        {count !== undefined && <span className="tnum rounded-full bg-panel px-2 py-0.5 text-[11px] font-bold text-dim">{count}</span>}
      </h2>
      {right}
    </div>
  )
}

/**
 * A row of games that scrolls sideways: two and a bit tiles on a phone, up to six on a wide screen. The arrows page
 * it by what's in view and grey out at either end (on a phone it is swiped instead); `onAll` adds a "View all" link.
 */
export function GameRow({
  title,
  icon,
  games,
  onAll,
  below,
}: {
  title: ReactNode
  icon?: ReactNode
  games: (GameInfo | GameId)[]
  onAll?: () => void
  below?: (g: GameInfo) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [ends, setEnds] = useState<[boolean, boolean]>([true, true])
  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const next: [boolean, boolean] = [el.scrollLeft <= 2, el.scrollLeft + el.clientWidth >= el.scrollWidth - 2]
    setEnds((e) => (e[0] === next[0] && e[1] === next[1] ? e : next))
  }, [])
  useEffect(() => {
    measure()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, games.length])
  const page = (dir: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }
  const list = games.map((g) => (typeof g === 'string' ? gameInfo(g) : g))
  const arrow = (dir: 1 | -1, off: boolean) => (
    <button
      onClick={() => page(dir)}
      disabled={off}
      aria-label={dir < 0 ? 'Scroll left' : 'Scroll right'}
      className="flex h-8 w-8 items-center justify-center rounded-lg bg-panel text-muted transition hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-35"
    >
      <IconChevron size={16} className={dir < 0 ? 'rotate-180' : ''} />
    </button>
  )
  return (
    <section>
      <RowTitle
        icon={icon}
        count={onAll ? list.length : undefined}
        right={
          <div className="flex shrink-0 items-center gap-1.5">
            {onAll && (
              <button onClick={onAll} className="h-8 rounded-lg px-2.5 text-[13px] font-bold text-muted transition hover:bg-panel hover:text-ink">
                View all
              </button>
            )}
            {!(ends[0] && ends[1]) && (
              <span className="hidden gap-1.5 sm:flex">
                {arrow(-1, ends[0])}
                {arrow(1, ends[1])}
              </span>
            )}
          </div>
        }
      >
        {title}
      </RowTitle>
      <div
        ref={ref}
        onScroll={measure}
        className="no-scrollbar -mx-3 grid snap-x snap-mandatory scroll-px-3 auto-cols-[40%] grid-flow-col gap-3 overflow-x-auto px-3 pb-1 sm:-mx-5 sm:scroll-px-5 sm:auto-cols-[calc((100%-24px)/3.3)] sm:px-5 md:auto-cols-[calc((100%-36px)/4.3)] lg:mx-0 lg:scroll-px-0 lg:auto-cols-[calc((100%-48px)/5)] lg:px-0 xl:auto-cols-[calc((100%-60px)/6)]"
      >
        {list.map((g, i) => (
          <div key={g.id} className="snap-start">
            <GameCard g={g} i={i} below={below?.(g)} />
          </div>
        ))}
      </div>
    </section>
  )
}

/** every game in a list, as a wrapping grid */
export function GameGridView({ games }: { games: GameInfo[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {games.map((g, i) => (
        <GameCard key={g.id} g={g} i={i} />
      ))}
    </div>
  )
}

/** under a game: the other games of its kind */
export function MoreGames({ id }: { id: GameId }) {
  const g = gameInfo(id)
  const kind = CATEGORIES.find((c) => c.id === g.category)
  const same = GAMES.filter((x) => x.category === g.category && x.id !== id)
  return (
    <div className="mt-8">
      <GameRow title={`More ${kind ? kind.name.toLowerCase() : 'games'}`} games={same} />
    </div>
  )
}
