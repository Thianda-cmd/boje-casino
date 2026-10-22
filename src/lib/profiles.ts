import { backend, rpc } from './backend'
import { DEFAULT_LOOK, cleanLook, type AchievementSource, type Look } from '../store/cosmetics'
import { AVATAR_COUNT } from '../store/cosmetics'

/*
  Other players: their public profiles, player search and the leaderboards, read from the server.

  A signed-in player's public profile comes from their account (api/_lib/schema.js): the username, avatar and when
  they joined from the profile row, and the rest from the wallet saved with it: the look they wear, their bio and
  privacy (src/store/wallet.ts Privacy), and, if they share them, their stats and recent big wins. Guests have no
  public profile. The server functions are profile_view, players_search, players_top and presence_ping.

  Every call answers 'offline' when the server can't be reached. Dev builds with no backend at all (the plain local
  dev server) answer with made-up players instead, so the pages can be worked on without a database.
*/

export interface PublicStats {
  rounds: number
  wagered: number
  won: number
  biggestWin: number
  /** rounds of 25 coins or more by game (the wallet's gamesPlayed) */
  gamesPlayed: Record<string, number>
  /** what the achievements are worked out from (src/store/cosmetics.ts earnedAchievements) */
  source: AchievementSource
}

export interface PublicBet {
  game: string
  bet: number
  payout: number
  time: number
}

export interface PublicProfile {
  username: string
  avatar: number
  look: Look
  bio: string
  /** ISO dates */
  createdAt: string
  lastSeen: string | null
  /** seen in the last few minutes */
  online: boolean
  /** XP is always public (the level and VIP tier come from it) */
  xp: number
  /** stats, unless the player keeps them private */
  stats: PublicStats | null
  /** their biggest wins among their recent rounds, unless kept private */
  bigWins: PublicBet[] | null
}

export interface PlayerRow {
  username: string
  avatar: number
  look: Look
  xp: number
  online: boolean
  /** the leaderboard's figure: coins wagered, the biggest win; null for boards ranked otherwise */
  value: number | null
}

export type Board = 'level' | 'wagered' | 'biggest' | 'newest' | 'online'
export const BOARDS: { id: Board; name: string }[] = [
  { id: 'level', name: 'Top level' },
  { id: 'wagered', name: 'Most wagered' },
  { id: 'biggest', name: 'Biggest win' },
  { id: 'online', name: 'Online now' },
  { id: 'newest', name: 'Newest' },
]

/* ---------------- reading what the server sends ---------------- */

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0)
const avatarOf = (v: unknown) => {
  const a = Math.round(num(v))
  return a >= 0 && a < AVATAR_COUNT ? a : 0
}

/** a profile as the server sends it (profile_view), checked field by field */
export function readProfile(x: unknown): PublicProfile | null {
  const p = x as Record<string, unknown> | null
  if (!p || typeof p !== 'object' || typeof p.username !== 'string') return null
  const s = p.stats as Record<string, unknown> | null | undefined
  const stats: PublicStats | null =
    s && typeof s === 'object'
      ? {
          rounds: num(s.rounds),
          wagered: num(s.wagered),
          won: num(s.won),
          biggestWin: num(s.biggestWin),
          gamesPlayed: s.gamesPlayed && typeof s.gamesPlayed === 'object' ? Object.fromEntries(Object.entries(s.gamesPlayed as Record<string, unknown>).map(([k, v]) => [k, num(v)])) : {},
          source: {
            xp: num(p.xp),
            rounds: num(s.rounds),
            totalWagered: num(s.wagered),
            totalWon: num(s.won),
            biggestWin: num(s.biggestWin),
            dailyStreak: num(s.dailyStreak),
            heistBest: num(s.heistBest),
            claimed: Array.isArray(s.claimed) ? s.claimed.filter((c): c is string => typeof c === 'string') : [],
          },
        }
      : null
  const wins = Array.isArray(p.bigWins) ? p.bigWins : null
  return {
    username: p.username,
    avatar: avatarOf(p.avatar),
    look: cleanLook(p.look),
    bio: typeof p.bio === 'string' ? p.bio.slice(0, 160) : '',
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
    lastSeen: typeof p.lastSeen === 'string' ? p.lastSeen : null,
    online: p.online === true,
    xp: num(p.xp),
    stats,
    bigWins: wins ? wins.map((b) => b as Record<string, unknown>).map((b) => ({ game: String(b.game ?? ''), bet: num(b.bet), payout: num(b.payout), time: num(b.time) })) : null,
  }
}

export function readRow(x: unknown): PlayerRow | null {
  const r = x as Record<string, unknown> | null
  if (!r || typeof r !== 'object' || typeof r.username !== 'string') return null
  return { username: r.username, avatar: avatarOf(r.avatar), look: cleanLook(r.look), xp: num(r.xp), online: r.online === true, value: r.value == null ? null : num(r.value) }
}

/* ---------------- the calls ---------------- */

type Offline = 'offline'

async function server(): Promise<boolean | null> {
  // true: a backend; null: none in this build (the plain local dev server)
  const sb = await backend().catch(() => null)
  return sb ? true : null
}

/** a player's public profile; null if there is no such player */
export async function fetchProfile(username: string): Promise<PublicProfile | null | Offline> {
  if ((await server()) === null) return import.meta.env.DEV ? mockProfile(username) : 'offline'
  try {
    return readProfile(await rpc<unknown>('profile_view', { p_username: username }, 6000))
  } catch {
    return 'offline'
  }
}

/** players whose names start with (or contain) the query, best matches first */
export async function searchPlayers(query: string): Promise<PlayerRow[] | Offline> {
  const q = query.trim()
  if (!q) return []
  if ((await server()) === null) return import.meta.env.DEV ? mockRows('search', q) : 'offline'
  try {
    const rows = await rpc<unknown[]>('players_search', { p_query: q, p_limit: 20 }, 6000)
    return (rows ?? []).map(readRow).filter((r): r is PlayerRow => !!r)
  } catch {
    return 'offline'
  }
}

/** a leaderboard */
export async function leaderboard(board: Board): Promise<PlayerRow[] | Offline> {
  if ((await server()) === null) return import.meta.env.DEV ? mockRows(board) : 'offline'
  try {
    const rows = await rpc<unknown[]>('players_top', { p_board: board, p_limit: 50 }, 6000)
    return (rows ?? []).map(readRow).filter((r): r is PlayerRow => !!r)
  } catch {
    return 'offline'
  }
}

/** tells the server this signed-in player is here (for "online"); quiet when it can't */
export async function presencePing(): Promise<void> {
  try {
    if (await server()) await rpc<unknown>('presence_ping', {}, 5000)
  } catch {
    /* next time */
  }
}

/* ---------------- dev builds without a backend ---------------- */

const NAMES = ['LuckyLuna', 'AceHigh', 'ChipStacker', 'NeonNate', 'VaultQueen', 'ReefRider', 'DartMaster', 'BullRunner', 'CrashKid', 'Ziggurat', 'MidasTouch', 'NightOwl', 'PotHunter', 'GoldenGoose', 'SpinDoctor']
const hash = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
// some made-up players wear the animated cosmetics (auras, backdrops, the crates' Mythics), so the pages show them
const LOOKS: Partial<Look>[] = [
  { frame: 'frame:gold', aura: 'aura:coins', banner: 'banner:gold', backdrop: 'backdrop:coins', nameColor: 'name:gold', title: 'title:high-roller' },
  { frame: 'frame:neon', banner: 'banner:matrix', backdrop: 'backdrop:matrix', nameColor: 'name:ice', title: 'title:night-owl' },
  { frame: 'frame:flame', aura: 'aura:embers', banner: 'banner:volcano', backdrop: 'backdrop:embers', nameColor: 'name:fire', title: 'title:big-fish' },
  { frame: 'frame:prism', aura: 'aura:prism', banner: 'banner:singularity', backdrop: 'backdrop:prism', nameColor: 'name:prism', title: 'title:immortal' },
  { frame: 'frame:diamond', aura: 'aura:sparkles', banner: 'banner:sakura', backdrop: 'backdrop:sakura', nameColor: 'name:diamond', title: 'title:legend' },
  { frame: 'frame:crown', aura: 'aura:halo', banner: 'banner:aurora', backdrop: 'backdrop:aurora', nameColor: 'name:rainbow', title: 'title:tycoon' },
  { frame: 'frame:kaiju', aura: 'aura:atomic', banner: 'banner:kaiju', backdrop: 'backdrop:storm', nameColor: 'name:electric', title: 'title:kaiju-king' },
  {},
]

function mockProfile(username: string): PublicProfile | null {
  if (/^nobody/i.test(username)) return null
  const h = hash(username.toLowerCase())
  const xp = (h % 900_000) + 2000
  const rounds = 50 + (h % 4000)
  const wagered = xp
  const look = { ...DEFAULT_LOOK, ...LOOKS[h % LOOKS.length], badges: ['first-win', 'rounds-100', 'wagered-10k'].slice(0, 1 + (h % 3)) }
  const hidden = h % 7 === 0
  return {
    username,
    avatar: h % AVATAR_COUNT,
    look,
    bio: h % 3 ? 'Here for the 180s and the big multipliers.' : '',
    createdAt: new Date(Date.now() - (h % 300) * 86400_000).toISOString(),
    lastSeen: new Date(Date.now() - (h % 5) * 3600_000).toISOString(),
    online: h % 2 === 0,
    xp,
    stats: hidden
      ? null
      : {
          rounds,
          wagered,
          won: Math.round(wagered * 0.96),
          biggestWin: 50 + (h % 20_000),
          gamesPlayed: { darts: 40 + (h % 90), plinko: 20 + (h % 60), crash: 10 + (h % 50), showtime: h % 30 },
          source: { xp, rounds, totalWagered: wagered, totalWon: Math.round(wagered * 0.96), biggestWin: 50 + (h % 20_000), dailyStreak: h % 9, heistBest: h % 9, claimed: ['explorer', 'road-warrior'].slice(0, h % 3) },
        },
    bigWins: hidden ? null : [0, 1, 2].map((i) => ({ game: ['darts', 'plinko', 'crash'][i], bet: 10 * (i + 1), payout: 10 * (i + 1) * (5 + ((h >> i) % 40)), time: Date.now() - i * 3600_000 })),
  }
}

function mockRows(board: Board | 'search', q = ''): PlayerRow[] {
  const names = board === 'search' ? NAMES.filter((n) => n.toLowerCase().includes(q.toLowerCase())) : NAMES
  return names
    .map((n) => {
      const p = mockProfile(n)!
      const value = board === 'wagered' ? (p.stats?.wagered ?? 0) : board === 'biggest' ? (p.stats?.biggestWin ?? 0) : null
      return { username: n, avatar: p.avatar, look: p.look, xp: p.xp, online: board === 'online' ? true : p.online, value }
    })
    .sort((a, b) => (board === 'level' ? b.xp - a.xp : (b.value ?? 0) - (a.value ?? 0)))
}
