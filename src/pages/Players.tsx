import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { FramedAvatar, NameTag, ProfileBanner, TitleChip } from '../art/cosmetics'
import { Coin, IconBolt, IconChevron, IconSearch, IconStar, IconTrophy, IconUsers, IconX } from '../components/icons'
import { LevelPill, Skel } from '../components/profile/ProfileCard'
import { PlayerChip, PlayerChipSkeleton, type Who } from '../components/profile/PlayerChip'
import { profilePath, useBoard, useMedia, useMyLook, usePlayerSearch } from '../components/profile/data'
import { fmt, fmtCompact } from '../lib/format'
import { BOARDS, type Board, type PlayerRow } from '../lib/profiles'
import { navigate } from '../lib/router'
import { useAuth } from '../store/auth'
import { levelFromXp, tierOf } from '../store/levels'
import { useWallet } from '../store/wallet'

/*
  The Players page, at #/players: find a player by name, or browse the leaderboards (src/lib/profiles.ts BOARDS):
  the highest levels, the most coins wagered, the biggest single wins, who is online now and who joined last. The top
  three stand on a podium; everyone else is a row with their framed avatar, name in its colour, title, level, whether
  they are online and the board's figure. Every player opens their profile (src/pages/Player.tsx).

  Boards are kept for a minute (src/components/profile/data.ts), and the board you picked stays for the visit. Only
  signed-in players who choose to be listed are on the boards; the side card says how to get on them.
*/

let lastBoard: Board = 'level'

const MEDAL = ['#f7c548', '#c6d2de', '#d4925a'] as const

const LiveDot = ({ size = 8 }: { size?: number }) => (
  <span className="relative flex" style={{ width: size, height: size }}>
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
    <span className="relative inline-flex h-full w-full rounded-full bg-accent" />
  </span>
)

const BOARD_ICON: Record<Board, ReactNode> = {
  level: <IconStar size={15} />,
  wagered: <Coin size={15} />,
  biggest: <IconTrophy size={15} />,
  online: <LiveDot />,
  newest: <IconBolt size={15} />,
}
const BOARD_LINE: Record<Board, string> = {
  level: 'The highest levels in the casino. Every coin wagered is 1 XP.',
  wagered: 'The most coins wagered, all time.',
  biggest: 'The biggest win in a single round.',
  online: 'Players at the tables right now.',
  newest: 'The latest players to join. Say hello at the tables.',
}

export default function Players() {
  const [board, setBoardState] = useState<Board>(lastBoard)
  const [q, setQ] = useState('')
  const setBoard = (b: Board) => {
    lastBoard = b
    setBoardState(b)
  }
  const searching = q.trim().length > 0
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-[26px] font-black tracking-tight">Players</h1>
          <p className="text-[13px] text-muted">Find a player, see who's on top, and open anyone's profile.</p>
        </div>
        <label className="flex h-11 w-full items-center gap-2.5 rounded-xl bg-panel px-3.5 text-dim ring-1 ring-transparent transition focus-within:ring-raised sm:w-[340px]">
          <IconSearch size={17} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setQ('')}
            placeholder="Search players by name"
            aria-label="Search players"
            className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink outline-none placeholder:text-dim"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full hover:bg-raised hover:text-ink">
              <IconX size={14} />
            </button>
          )}
        </label>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-4">
          {searching ? (
            <SearchResults q={q} onClear={() => setQ('')} />
          ) : (
            <>
              <BoardTabs board={board} onPick={setBoard} />
              <BoardView key={board} board={board} />
            </>
          )}
        </div>
        <aside className="flex flex-col gap-4 lg:sticky lg:top-5">
          <YouCard />
          {!(board === 'online' && !searching) && <OnlineNow onAll={() => (setQ(''), setBoard('online'))} />}
        </aside>
      </div>
    </div>
  )
}

function BoardTabs({ board, onPick }: { board: Board; onPick: (b: Board) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="no-scrollbar -mx-3 flex max-w-[calc(100%+24px)] overflow-x-auto px-3 sm:mx-0 sm:max-w-full sm:px-0">
        <div className="flex gap-1 rounded-full bg-panel p-1">
          {BOARDS.map((b) => (
            <button
              key={b.id}
              onClick={() => onPick(b.id)}
              className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors ${board === b.id ? 'text-ink' : 'text-muted hover:text-ink'}`}
            >
              {board === b.id && <motion.span layoutId="players-tab" className="absolute inset-0 rounded-full bg-raised" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative flex items-center">{BOARD_ICON[b.id]}</span>
              <span className="relative">{b.name}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="px-1 text-[12.5px] text-dim">{BOARD_LINE[board]}</p>
    </div>
  )
}

/* ------------------------------ boards ------------------------------ */

function BoardView({ board }: { board: Board }) {
  const { rows, retry } = useBoard(board)
  if (rows === undefined)
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="grid grid-cols-3 items-end gap-2 sm:gap-3">
          {['h-[170px] sm:h-[250px]', 'h-[190px] sm:h-[282px]', 'h-[158px] sm:h-[234px]'].map((h) => (
            <div key={h} className={`animate-pulse rounded-2xl bg-panel ${h}`} />
          ))}
        </div>
        <ListShell>
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex h-[66px] items-center gap-3 border-b border-line/60 px-3 last:border-0 sm:px-4">
              <Skel className="h-4 w-6" />
              <PlayerChipSkeleton size={40} />
            </div>
          ))}
        </ListShell>
      </div>
    )
  if (rows === 'offline') return <OfflineBoards onRetry={retry} />
  if (!rows.length) return <EmptyBoard board={board} />
  return (
    <div className="flex flex-col gap-4">
      <Podium rows={rows.slice(0, 3)} board={board} />
      {rows.length > 3 && (
        <ListShell>
          {rows.slice(3).map((r, i) => (
            <Row key={r.username} r={r} rank={i + 4} board={board} i={i} />
          ))}
        </ListShell>
      )}
    </div>
  )
}

function ListShell({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">{children}</div>
}

/** the board's figure for a row: coins wagered, the biggest win, the XP, or that they are online */
function Figure({ r, board, big = false }: { r: PlayerRow; board: Board; big?: boolean }) {
  const size = big ? 'text-[17px] sm:text-[19px]' : 'text-[15px]'
  if ((board === 'wagered' || board === 'biggest') && r.value !== null)
    return (
      <span className={`tnum flex items-center justify-end gap-1.5 font-black ${size} ${board === 'biggest' ? 'text-gold' : ''}`} title={`${fmt(r.value, 0)} coins`}>
        <Coin size={big ? 17 : 15} />
        {fmtCompact(r.value)}
      </span>
    )
  if (board === 'online')
    return (
      <span className={`flex items-center justify-end gap-1.5 font-extrabold text-accent ${big ? 'text-[13px]' : 'text-[12.5px]'}`}>
        <LiveDot size={7} /> Online
      </span>
    )
  const lv = levelFromXp(r.xp).level
  return (
    <span className={`tnum flex items-center justify-end gap-1 font-black ${size}`} style={{ color: tierOf(lv).color }} title={`${fmt(r.xp, 0)} XP`}>
      {fmtCompact(r.xp)}
      <span className="text-[11px] font-extrabold opacity-70">XP</span>
    </span>
  )
}

/** a gold, silver or bronze medal with the place on it */
function Medal({ place, size = 30 }: { place: number; size?: number }) {
  const c = MEDAL[place]
  const id = `medal-${place}`
  return (
    <svg width={size} height={size * 1.2} viewBox="0 0 40 48" aria-hidden className="drop-shadow-[0_4px_8px_rgba(0,0,0,.5)]">
      <defs>
        <linearGradient id={`${id}-f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".85" />
          <stop offset=".35" stopColor={c} />
          <stop offset="1" stopColor={c} stopOpacity=".75" />
        </linearGradient>
      </defs>
      <path d="M10 0h8l4 16h-8Z" fill="#e8344e" />
      <path d="M30 0h-8l-4 16h8Z" fill="#c42a40" />
      <circle cx="20" cy="30" r="16" fill={c} />
      <circle cx="20" cy="30" r="16" fill={`url(#${id}-f)`} />
      <circle cx="20" cy="30" r="12" fill="none" stroke="#000" strokeOpacity=".18" strokeWidth="1.5" />
      <text x="20" y="35.5" textAnchor="middle" fontSize="15" fontWeight="900" fill="#2a1c00" fillOpacity=".85" fontFamily="Manrope, system-ui, sans-serif">
        {place + 1}
      </text>
    </svg>
  )
}

function Podium({ rows, board }: { rows: PlayerRow[]; board: Board }) {
  const wide = useMedia('(min-width: 640px)')
  // second, first, third: the winner in the middle, on the tallest step
  const order = [1, 0, 2].filter((i) => rows[i])
  const step = wide ? [64, 44, 30] : [40, 28, 18]
  return (
    <div className={`grid items-end gap-2 sm:gap-3 ${rows.length === 1 ? 'grid-cols-1 sm:mx-auto sm:w-[300px]' : rows.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
      {order.map((i) => {
        const r = rows[i]
        const first = i === 0
        return (
          <motion.button
            key={r.username}
            onClick={() => navigate(profilePath(r.username))}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 24, delay: first ? 0.05 : 0.14 + i * 0.04 }}
            className={`group relative flex min-w-0 flex-col items-center overflow-hidden rounded-2xl bg-panel text-center shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] transition-transform hover:-translate-y-1 ${first ? 'ring-1 ring-gold/40' : 'ring-1 ring-white/[.04]'}`}
            style={first ? { boxShadow: '0 24px 60px -24px rgba(247,197,72,.35)' } : undefined}
          >
            <ProfileBanner id={r.look.banner} className={`w-full shrink-0 ${wide ? 'h-[76px]' : 'h-[48px]'}`}>
              <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 to-[#112230]" />
            </ProfileBanner>
            <span className="absolute left-1.5 top-1 sm:left-2.5 sm:top-1.5">
              <Medal place={i} size={wide ? 30 : 20} />
            </span>
            <span className={`relative ${wide ? '-mt-11' : '-mt-7'}`}>
              <FramedAvatar avatar={r.avatar} frame={r.look.frame} aura={r.look.aura} size={wide ? (first ? 92 : 80) : first ? 60 : 52} className="drop-shadow-[0_10px_18px_rgba(0,0,0,.55)]" />
              {r.online && <span className="absolute bottom-[6%] right-[6%] h-3 w-3 rounded-full border-2 border-panel bg-accent sm:h-4 sm:w-4" />}
            </span>
            <span className="mt-2 w-full min-w-0 px-2 sm:px-3">
              <NameTag name={r.username} color={r.look.nameColor} className={`block truncate leading-tight ${wide ? 'text-[16px]' : 'text-[13px]'}`} />
              {wide && (
                <span className="mt-1 flex h-5 justify-center">
                  <TitleChip id={r.look.title} className="truncate" />
                </span>
              )}
              <span className="mt-1.5 flex justify-center">
                <LevelPill xp={r.xp} tier={wide} />
              </span>
            </span>
            <span className="mt-2.5 w-full px-2 pb-2.5 sm:px-3 sm:pb-3">
              <span className="flex justify-center rounded-lg bg-stage/70 px-2 py-1.5 sm:py-2">
                <Figure r={r} board={board} big={wide} />
              </span>
            </span>
            <span
              className="flex w-full items-center justify-center text-[15px] font-black sm:text-[20px]"
              style={{ height: step[i], background: `linear-gradient(180deg, ${MEDAL[i]}38, ${MEDAL[i]}12)`, color: MEDAL[i], boxShadow: `inset 0 1px 0 ${MEDAL[i]}55` }}
            >
              {wide && (i === 0 ? '1st' : i === 1 ? '2nd' : '3rd')}
            </span>
          </motion.button>
        )
      })}
    </div>
  )
}

function Row({ r, rank, board, i = 0 }: { r: PlayerRow; rank?: number; board: Board; i?: number }) {
  const open = () => navigate(profilePath(r.username))
  return (
    <motion.div
      role="link"
      tabIndex={0}
      aria-label={`${r.username}'s profile`}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      data-player-row={r.username}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 420, damping: 34, delay: Math.min(i, 14) * 0.018 }}
      className="group flex h-[66px] w-full min-w-0 cursor-pointer items-center gap-3 border-b border-line/60 px-3 text-left outline-none transition-colors last:border-0 hover:bg-panel2 focus-visible:bg-panel2 sm:gap-4 sm:px-4"
    >
      {rank !== undefined && <span className="tnum w-7 shrink-0 text-center text-[14px] font-black text-dim group-hover:text-muted">{rank}</span>}
      <span className="min-w-0 flex-1">
        <PlayerChip who={r} size={42} ring="border-panel group-hover:border-panel2" card />
      </span>
      <span className="hidden shrink-0 sm:block">
        <LevelPill xp={r.xp} tier />
      </span>
      <span className="w-[86px] shrink-0 sm:w-[104px]">
        <Figure r={r} board={board} />
      </span>
      <IconChevron size={16} className="hidden shrink-0 text-dim transition-transform group-hover:translate-x-0.5 group-hover:text-muted sm:block" />
    </motion.div>
  )
}

/** a trophy cabinet with nobody in it */
function EmptyCabinet() {
  return (
    <svg width="120" height="96" viewBox="0 0 120 96" aria-hidden>
      <defs>
        <linearGradient id="pc-cup" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a556b" />
          <stop offset="1" stopColor="#213a4c" />
        </linearGradient>
      </defs>
      <rect x="14" y="72" width="92" height="14" rx="4" fill="#162b3a" />
      <rect x="20" y="62" width="24" height="12" rx="3" fill="#1f3547" />
      <rect x="48" y="52" width="24" height="22" rx="3" fill="#213a4c" />
      <rect x="76" y="66" width="24" height="8" rx="3" fill="#1f3547" />
      <path d="M48 14h24v10a12 12 0 0 1-24 0Z" fill="url(#pc-cup)" />
      <path d="M48 17h-6a6 6 0 0 0 6 9M72 17h6a6 6 0 0 1-6 9" fill="none" stroke="#3a556b" strokeWidth="3" />
      <rect x="57" y="36" width="6" height="8" fill="#2b475c" />
      <rect x="52" y="43" width="16" height="5" rx="2" fill="#2b475c" />
      <path d="M86 20l2 5 5 .5-4 3.5 1 5-4-2.5-4 2.5 1-5-4-3.5 5-.5Z" fill="#f7c548" fillOpacity=".55" />
    </svg>
  )
}

function EmptyBoard({ board }: { board: Board }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-panel/50 px-6 py-12 text-center">
      <EmptyCabinet />
      <div className="mt-3 text-[17px] font-extrabold">{board === 'online' ? "Nobody's online right now" : 'No one on this board yet'}</div>
      <p className="mt-1 max-w-[380px] text-[13.5px] text-muted">{board === 'online' ? 'Check back in a little while, or start a round and be the first.' : 'Signed-in players who choose to be listed show up here.'}</p>
    </div>
  )
}

function OfflineBoards({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-2xl bg-panel px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-raised text-muted">
        <IconUsers size={26} />
      </span>
      <div className="mt-3 text-[17px] font-extrabold">The leaderboards can't be reached right now</div>
      <p className="mt-1 max-w-[380px] text-[13.5px] text-muted">Your games and coins are fine. Check your connection and try again.</p>
      <button onClick={onRetry} className="mt-4 h-10 rounded-lg bg-raised px-5 text-[14px] font-extrabold transition hover:bg-hover">
        Try again
      </button>
    </div>
  )
}

/* ------------------------------ search ------------------------------ */

function SearchResults({ q, onClear }: { q: string; onClear: () => void }) {
  const s = usePlayerSearch(q)
  const t = q.trim()
  let body: ReactNode
  if (s.state === 'idle') body = <Note>Type at least two letters of a name.</Note>
  else if (s.state === 'offline') body = <Note>Player search can't be reached right now. Try again in a moment.</Note>
  else if (s.state === 'loading' && !s.last?.length)
    body = (
      <ListShell>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex h-[66px] items-center border-b border-line/60 px-3 last:border-0 sm:px-4">
            <PlayerChipSkeleton size={42} />
          </div>
        ))}
      </ListShell>
    )
  else {
    const rows = s.state === 'ready' ? s.rows : (s.last ?? [])
    body = rows.length ? (
      <div className={s.state === 'loading' ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
        <ListShell>
          {rows.map((r, i) => (
            <Row key={r.username} r={r} board="level" i={i} />
          ))}
        </ListShell>
      </div>
    ) : (
      <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-10 text-center text-[14px] text-muted">
        No players match “{t}”.{' '}
        <button onClick={onClear} className="font-bold text-accent hover:underline">
          Clear the search
        </button>
      </div>
    )
  }
  return (
    <section>
      <div className="mb-3 flex min-h-8 items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-[17px] font-extrabold tracking-tight">
          <IconSearch size={17} className="shrink-0 text-muted" />
          <span className="truncate">Players matching “{t}”</span>
          {s.state === 'ready' && <span className="tnum rounded-full bg-panel px-2 py-0.5 text-[11px] font-bold text-dim">{s.rows.length}</span>}
        </h2>
      </div>
      {body}
    </section>
  )
}

const Note = ({ children }: { children: ReactNode }) => <div className="rounded-2xl bg-panel px-5 py-8 text-center text-[14px] text-muted">{children}</div>

/* ------------------------------ side ------------------------------ */

/** you: your card and the way to your profile, or for a guest how to get on the boards */
function YouCard() {
  const profile = useAuth((s) => s.profile)
  const status = useAuth((s) => s.status)
  const available = useAuth((s) => s.available)
  const open = useAuth((s) => s.open)
  const look = useMyLook()
  const xp = useWallet((s) => s.xp)
  if (status === 'user' && profile) {
    const me: Who = { username: profile.username, avatar: profile.avatar, look, xp, online: true }
    return (
      <div className="overflow-hidden rounded-2xl bg-panel shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
        <ProfileBanner id={look.banner} className="h-[72px]">
          <span className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/0 to-[#112230]" />
          <span className="absolute left-4 top-3 text-[11px] font-extrabold uppercase tracking-wider text-white/80">You</span>
        </ProfileBanner>
        <div className="px-4 pb-4">
          <div className="-mt-8 flex items-end gap-3">
            <FramedAvatar avatar={me.avatar} frame={look.frame} size={64} className="shrink-0 drop-shadow-[0_8px_16px_rgba(0,0,0,.6)]" />
            <span className="min-w-0 pb-1">
              <NameTag key={look.nameColor} name={me.username} color={look.nameColor} className="block truncate text-[17px] leading-tight" />
              <span className="mt-1 flex">
                <LevelPill xp={xp} tier />
              </span>
            </span>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button onClick={() => navigate(profilePath(me.username))} className="h-10 rounded-lg bg-raised text-[13.5px] font-extrabold transition hover:bg-hover">
              My profile
            </button>
            <button onClick={() => navigate('/account')} className="h-10 rounded-lg bg-stage/70 text-[13.5px] font-bold text-muted transition hover:text-ink">
              Edit look
            </button>
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[linear-gradient(140deg,#16352a,#112230_60%)] p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] ring-1 ring-accent/15">
      <span className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-accent/15 blur-3xl" />
      <div className="relative flex items-center gap-3">
        <span className="flex -space-x-3">
          {[18, 21, 25].map((a, i) => (
            <FramedAvatar key={a} avatar={a} frame={['frame:gold', 'frame:diamond', 'frame:neon'][i]} size={40} className="rounded-full ring-2 ring-[#14302a]" />
          ))}
        </span>
        <span className="min-w-0 text-[15px] font-extrabold leading-tight">Get on the boards</span>
      </div>
      <p className="relative mt-2.5 text-[13px] leading-relaxed text-muted">A free account gives you a public profile with your frame, banner and badges, and a place on the leaderboards.</p>
      {available ? (
        <button onClick={() => open('register')} className="relative mt-3.5 h-10 w-full rounded-lg bg-accent text-[14px] font-extrabold text-[#032412] shadow-[inset_0_-2px_0_rgba(0,0,0,.16)] transition hover:brightness-110">
          Create account
        </button>
      ) : (
        <p className="relative mt-3 rounded-lg bg-black/20 px-3 py-2 text-[12px] font-semibold text-dim">Accounts are unavailable in this preview.</p>
      )}
    </div>
  )
}

/** who is online now, a few of them, with the way to the whole board */
function OnlineNow({ onAll }: { onAll: () => void }) {
  const { rows } = useBoard('online')
  const list = Array.isArray(rows) ? rows.slice(0, 6) : []
  return (
    <div className="rounded-2xl bg-panel p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[15px] font-extrabold">
          <LiveDot /> Online now
          {Array.isArray(rows) && <span className="tnum rounded-full bg-stage px-2 py-0.5 text-[11px] font-bold text-dim">{rows.length}</span>}
        </span>
        {list.length > 0 && (
          <button onClick={onAll} className="flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] font-bold text-muted transition hover:bg-panel2 hover:text-ink">
            See all <IconChevron size={13} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {rows === undefined ? (
          <motion.div key="skel" exit={{ opacity: 0 }} className="flex flex-col gap-3 py-1">
            {[0, 1, 2].map((i) => (
              <PlayerChipSkeleton key={i} size={36} />
            ))}
          </motion.div>
        ) : list.length ? (
          <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="-mx-2 flex flex-col">
            {list.map((r) => (
              <button key={r.username} onClick={() => navigate(profilePath(r.username))} className="group flex h-[52px] min-w-0 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-panel2">
                <span className="min-w-0 flex-1">
                  <PlayerChip who={r} size={36} ring="border-panel group-hover:border-panel2" nameClass="text-[13.5px]" />
                </span>
                <LevelPill xp={r.xp} />
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.p key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-2 text-[13px] text-muted">
            {rows === 'offline' ? "Can't be reached right now." : 'Nobody right now.'}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  )
}
