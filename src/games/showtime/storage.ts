import { safeStorage } from '../../lib/storage'
import { isSpot, type Spot, type Stakes } from './rules'

/*
  What Showtime keeps on this device: the last results (for the history strip), the player's last stakes (for
  Repeat), the chip, and a round in play until it is paid.

  A round is stored the moment it is drawn and removed the moment it is paid, so it settles exactly once: when its
  show ends, as the page is left (the next visit says what it came to), or on the next visit if the page died. While
  its show plays the page beats a heartbeat into it every second, so Showtime opened in a second tab leaves a live
  round alone; and a page about to pay checks the round is still there, so one another tab took is never paid twice.
  (The same scheme as Sic Bo's.)
*/

const HIST = 'lumen.showtime.hist'
const LAST = 'lumen.showtime.last'
const CHIP = 'lumen.showtime.chip'
const NOTICE = 'lumen.showtime.notice'
export const MAX_HIST = 60

/** a result gone by: the spot the wheel stopped on, what it paid to 1, and whether the Booster was on it */
export interface Past {
  t: number
  spot: Spot
  win: number
  boosted: boolean
}

export function loadHistory(): Past[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(HIST) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is Past => !!r && Number.isFinite(r.t) && isSpot(r.spot) && Number.isFinite(r.win)).slice(-MAX_HIST)
  } catch {
    return []
  }
}
export const saveHistory = (h: readonly Past[]) => safeStorage.setItem(HIST, JSON.stringify(h.slice(-MAX_HIST)))
export const withPast = (h: readonly Past[], p: Past) => [...h.filter((x) => x.t !== p.t), p].slice(-MAX_HIST)

export function loadLast(): Stakes | null {
  try {
    const raw = JSON.parse(safeStorage.getItem(LAST) ?? 'null') as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    const out: Stakes = {}
    for (const [k, v] of Object.entries(raw)) if (isSpot(k) && typeof v === 'number' && v > 0) out[k] = v
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
export const saveLast = (s: Stakes) => safeStorage.setItem(LAST, JSON.stringify(s))

export const loadChip = (values: readonly number[], fallback: number) => {
  const v = Number(safeStorage.getItem(CHIP))
  return values.includes(v) ? v : fallback
}
export const saveChip = (v: number) => safeStorage.setItem(CHIP, String(v))

/* ---------------- a round in play ---------------- */

export type Meta = Record<string, string | number | boolean>
export interface PendingRound {
  bet: number
  payout: number
  meta: Meta
  spot: Spot
  win: number
  boosted: boolean
  t: number
  /** the heartbeat of the page showing it (ms) */
  at?: number
}
export const pendingKey = (uid: string | null) => `lumen.showtime.pending.${uid ?? 'guest'}`
export const savePending = (key: string, p: PendingRound) => safeStorage.setItem(key, JSON.stringify(p))
export const clearPending = (key: string) => safeStorage.removeItem(key)
/** a heartbeat younger than this means a page is still showing the round */
export const LIVE_MS = 4000

/** how long ago the page showing the stored round last beat (ms): Infinity if it never did, null if none is stored */
export function pendingAge(key: string): number | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const at = (JSON.parse(raw) as PendingRound)?.at
    return typeof at === 'number' ? Math.max(0, Date.now() - at) : Infinity
  } catch {
    return Infinity
  }
}

/** whether the round stored under key was taken by another page: it is gone, from storage that works */
export function pendingTaken(key: string): boolean {
  if (safeStorage.getItem(key) != null) return false
  try {
    localStorage.setItem('lumen.showtime.probe', '1')
    localStorage.removeItem('lumen.showtime.probe')
    return true
  } catch {
    // no storage at all (a private window, say): it was only ever in this page's memory
    return false
  }
}

/** the round a page left unpaid, removed as it is read so it can only be paid once */
export function takePending(key: string): PendingRound | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  try {
    const p = JSON.parse(raw) as PendingRound
    if (typeof p?.bet !== 'number' || typeof p.payout !== 'number' || !(p.bet > 0) || !(p.payout >= 0)) return null
    return { bet: p.bet, payout: p.payout, meta: p.meta ?? {}, spot: isSpot(p.spot) ? p.spot : '1', win: Number(p.win) || 0, boosted: !!p.boosted, t: Number(p.t) || Date.now() }
  } catch {
    return null
  }
}

/* A round paid as the page was left: the next visit says what it came to. */
export interface Notice {
  amount: number
  spot: Spot
}
export const saveNotice = (n: Notice) => safeStorage.setItem(NOTICE, JSON.stringify(n))
export function takeNotice(): Notice | null {
  const raw = safeStorage.getItem(NOTICE)
  if (raw == null) return null
  safeStorage.removeItem(NOTICE)
  try {
    const n = JSON.parse(raw) as Notice
    return isSpot(n?.spot) && Number.isFinite(n.amount) ? n : null
  } catch {
    return null
  }
}
