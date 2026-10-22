import { safeStorage } from '../../lib/storage'
import { MAX_BET } from '../../store/wallet'
import { PITCHES, ROUTES, isClimb, type Climb, type RouteId } from './rules'

/*
  What Summit keeps on this device: the climb in progress (one per player), the last climb finished (so a second tab
  can show how it ended), and the player's last climbs for the history strip. This is Banker's Deal's scheme
  (src/games/deal/storage.ts) with Summit's own keys.

  A climb is a decision game, so it is not paid when the page goes: it waits on its ledge. It is kept under the
  player's own key (lumen.summit.climb.<uid|guest>), with the stake it took and a move count, and written
  synchronously after every pitch and before the pitch is shown, so a reload finds the climber exactly where they
  were and can never re-roll a pitch (rules.ts draws each pitch only when the route is chosen, so the record never
  holds a pitch the player has not committed to).

  It is paid once, when it ends (a fall, a bank, or the summit): the page that makes the last move takes the record
  out of storage (checking that it is still there and still the climb it showed) and pays in the same moment, so a
  second tab can't pay it again. A tab re-reads the record before every move and acts only if it is the very state
  it shows (same climb, same move count); otherwise it adopts what storage holds instead. It also follows the storage
  event, so a pitch climbed in one tab shows in the other. A climb that has not moved for STALE_MS is finished on the
  next visit: banked where it stands if it has a pitch, its stake handed back if it never left base camp.

  A record is checked before it is trusted (isClimb from rules.ts, plus: a stored climb is always one still going).
  One that can't be read is removed and its stake handed back.
*/

const PROBE = 'lumen.summit.probe'
export const climbKey = (uid: string | null) => `lumen.summit.climb.${uid ?? 'guest'}`
export const lastKey = (uid: string | null) => `lumen.summit.last.${uid ?? 'guest'}`
export const histKey = (uid: string | null) => `lumen.summit.hist.${uid ?? 'guest'}`
/** a climb nobody has touched for this long is finished on the next visit */
export const STALE_MS = 7 * 24 * 3600_000
export const MAX_HIST = 30

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const isRoute = (r: unknown): r is RouteId => ROUTES.some((x) => x.id === r)

/** whether localStorage works at all (a private window may refuse it): without it a climb lives in the page only */
export function storageWorks(): boolean {
  try {
    localStorage.setItem(PROBE, '1')
    localStorage.removeItem(PROBE)
    return true
  } catch {
    return false
  }
}

/* ---------------- the climb in progress ---------------- */

export interface Saved {
  v: 1
  /** this climb's own id */
  id: string
  /** the player whose stake it took */
  uid: string | null
  stake: number
  climb: Climb
  /** moves made: every write counts one, so a tab can tell the state it shows from a newer one */
  n: number
  /** started, and last moved (ms) */
  t: number
  at: number
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** a climb still going: rules.ts's isClimb, and never a finished one (those are paid and taken out at once) */
export const sane = (c: Climb) => isClimb(c) && c.state === 'up' && c.fellOn === null && c.path.length < PITCHES

const stakeOk = (s: unknown): s is number => finite(s) && s > 0 && s <= MAX_BET

export type Read = { kind: 'none' } | { kind: 'ok'; rec: Saved } | { kind: 'bad'; stake: number | null }

/** the climb stored under key, checked */
export function readSaved(key: string): Read {
  const raw = safeStorage.getItem(key)
  if (raw == null) return { kind: 'none' }
  return parseSaved(raw)
}

export function parseSaved(raw: string): Read {
  try {
    const r = JSON.parse(raw) as Saved
    if (!r || typeof r !== 'object') return { kind: 'bad', stake: null }
    const stake = stakeOk(r.stake) ? r.stake : null
    if (r.v !== 1 || typeof r.id !== 'string' || !stake || !Number.isInteger(r.n) || r.n < 0 || !finite(r.t) || !finite(r.at) || !sane(r.climb)) return { kind: 'bad', stake }
    const climb: Climb = { path: [...r.climb.path], state: 'up', fellOn: null }
    return { kind: 'ok', rec: { v: 1, id: r.id, uid: typeof r.uid === 'string' ? r.uid : null, stake, climb, n: r.n, t: r.t, at: r.at } }
  } catch {
    return { kind: 'bad', stake: null }
  }
}

export const writeSaved = (key: string, rec: Saved) => safeStorage.setItem(key, JSON.stringify(rec))

/**
 * Takes the climb out of storage so it can be paid: only if it is still there and still climb `id` (another tab may
 * have paid it a moment ago). Returns whether it was taken.
 */
export function takeSaved(key: string, id: string): boolean {
  const raw = safeStorage.getItem(key)
  if (raw == null) return false
  try {
    if ((JSON.parse(raw) as Saved)?.id !== id) return false
  } catch {
    return false
  }
  safeStorage.removeItem(key)
  return true
}

/** removes whatever is stored under key (a record that can't be read), returning whether there was one */
export function dropSaved(key: string): boolean {
  if (safeStorage.getItem(key) == null) return false
  safeStorage.removeItem(key)
  return true
}

/* ---------------- the last climb, and the history ---------------- */

/** how a climb ended: banked by the player, at the summit, a fall, or banked for them after a week away */
export type How = 'bank' | 'summit' | 'fell' | 'stale'
const HOWS: How[] = ['bank', 'summit', 'fell', 'stale']

/** a finished climb, kept so the page (or another tab) can show how it ended */
export interface Last {
  id: string
  stake: number
  climb: Climb
  payout: number
  how: How
  t: number
}
export const saveLast = (key: string, l: Last) => safeStorage.setItem(key, JSON.stringify(l))
export function loadLast(key: string): Last | null {
  try {
    const l = JSON.parse(safeStorage.getItem(key) ?? 'null') as Last | null
    if (!l || typeof l.id !== 'string' || !stakeOk(l.stake) || !finite(l.payout) || !finite(l.t) || !HOWS.includes(l.how) || !isClimb(l.climb) || l.climb.state === 'up') return null
    return l
  } catch {
    return null
  }
}

/** a climb gone by, for the history strip */
export interface Past {
  id: string
  t: number
  stake: number
  payout: number
  /** the multiple it paid (0 for a fall) */
  mult: number
  /** the routes climbed, and the one that gave way */
  path: RouteId[]
  fellOn: RouteId | null
  how: How
}
export function loadHistory(key: string): Past[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(key) ?? '[]') as Past[]
    if (!Array.isArray(raw)) return []
    return raw
      .filter((p) => p && typeof p.id === 'string' && finite(p.t) && stakeOk(p.stake) && finite(p.payout) && finite(p.mult) && Array.isArray(p.path) && p.path.length <= PITCHES && p.path.every(isRoute) && (p.fellOn === null || isRoute(p.fellOn)) && HOWS.includes(p.how))
      .slice(-MAX_HIST)
  } catch {
    return []
  }
}
/** the history with a climb in it (once), the newest last */
export function addHistory(key: string, p: Past): Past[] {
  const next = [...loadHistory(key).filter((x) => x.id !== p.id), p].slice(-MAX_HIST)
  safeStorage.setItem(key, JSON.stringify(next))
  return next
}
