import { safeStorage } from '../../lib/storage'
import { MAX_TOTAL, REGIONS, TARGETS, THROWERS, regionScore, type Region, type TargetId, type ThrowerId } from './rules'

/*
  What Bullseye keeps on this device: the last rounds (for the history pills, and so the board still holds the last
  round's darts on a later visit), the player's target, thrower and turbo choices, and a round in play until it is
  paid.

  A round is stored the moment it is drawn and removed the moment it is paid, so it settles exactly once: when its
  three darts have landed, as the page is left (and a notice says so on the next visit), or on the next visit if the
  page died. While the darts fly, the page beats a heartbeat into the stored round every second, so Bullseye opened
  in a second tab leaves a live round alone (it is only an unfinished one once the heartbeat stops); and a page about
  to pay checks the round is still there, so one another tab did take (a long-hidden tab's heartbeat slows) is never
  paid twice. This is Sic Bo's scheme (src/games/sicbo/storage.ts), with Bullseye's own keys.
*/

const HIST = 'lumen.darts.hist'
const TARGET = 'lumen.darts.target'
const THROWER = 'lumen.darts.thrower'
const TURBO = 'lumen.darts.turbo'
const NOTICE = 'lumen.darts.notice'
export const MAX_HIST = 40

/** a dart as it is kept: its region and where it stuck (mm, x right and y up from the centre) */
export interface KeptDart {
  r: Region
  x: number
  y: number
}

/** a round gone by */
export interface PastRound {
  /** when it was thrown (ms), which also keys it on screen */
  t: number
  target: TargetId
  thrower: ThrowerId
  darts: KeptDart[]
  total: number
  mult: number
  bet: number
  payout: number
}

const isTarget = (v: unknown): v is TargetId => TARGETS.some((t) => t.id === v)
const isThrower = (v: unknown): v is ThrowerId => THROWERS.some((t) => t.id === v)
const isDart = (d: unknown): d is KeptDart => {
  const x = d as KeptDart
  return !!x && Number.isInteger(x.r) && x.r >= 0 && x.r < REGIONS && Number.isFinite(x.x) && Number.isFinite(x.y) && Math.hypot(x.x, x.y) < 600
}
export const isDarts = (d: unknown): d is KeptDart[] => Array.isArray(d) && d.length === 3 && d.every(isDart)
const isPast = (r: unknown): r is PastRound => {
  const x = r as PastRound
  return (
    !!x &&
    Number.isFinite(x.t) &&
    isTarget(x.target) &&
    isThrower(x.thrower) &&
    isDarts(x.darts) &&
    Number.isInteger(x.total) &&
    x.total >= 0 &&
    x.total <= MAX_TOTAL &&
    x.total === x.darts.reduce((a, d) => a + regionScore(d.r), 0) &&
    Number.isFinite(x.mult) &&
    Number.isFinite(x.bet) &&
    Number.isFinite(x.payout)
  )
}

export function loadHistory(): PastRound[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(HIST) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter(isPast).slice(-MAX_HIST)
  } catch {
    return []
  }
}
export const saveHistory = (h: readonly PastRound[]) => safeStorage.setItem(HIST, JSON.stringify(h.slice(-MAX_HIST)))
/** the history with a round in it (once: a round already there is replaced), the newest last */
export const withRound = (h: readonly PastRound[], r: PastRound) => [...h.filter((x) => x.t !== r.t), r].slice(-MAX_HIST)

export const loadTarget = (): TargetId => {
  const v = safeStorage.getItem(TARGET)
  return isTarget(v) ? v : 't20'
}
export const saveTarget = (v: TargetId) => safeStorage.setItem(TARGET, v)
export const loadThrower = (): ThrowerId => {
  const v = safeStorage.getItem(THROWER)
  return isThrower(v) ? v : 'regular'
}
export const saveThrower = (v: ThrowerId) => safeStorage.setItem(THROWER, v)
export const loadTurbo = () => safeStorage.getItem(TURBO) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO, on ? '1' : '0')

/* ---------------- a round in play ---------------- */

export type Meta = Record<string, string | number | boolean>
export interface PendingRound {
  bet: number
  payout: number
  meta: Meta
  /** the round itself, for the history and the board */
  past: PastRound
  t: number
  /** the heartbeat of the page showing it (ms) */
  at?: number
}
export const pendingKey = (uid: string | null) => `lumen.darts.pending.${uid ?? 'guest'}`
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
    localStorage.setItem('lumen.darts.probe', '1')
    localStorage.removeItem('lumen.darts.probe')
    return true
  } catch {
    // no storage at all (a private window, say): it was only ever in this page's memory
    return false
  }
}

/** the round a page left unpaid, removed as it is read so it can only be paid once (its darts, if they still read) */
export function takePending(key: string): (Omit<PendingRound, 'past'> & { past: PastRound | null }) | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  try {
    const p = JSON.parse(raw) as PendingRound
    if (typeof p?.bet !== 'number' || typeof p.payout !== 'number' || !(p.bet > 0) || !(p.payout >= 0)) return null
    return { bet: p.bet, payout: p.payout, meta: p.meta ?? {}, past: isPast(p.past) ? p.past : null, t: Number(p.t) || Date.now() }
  } catch {
    return null
  }
}

/* A round paid as the page was left: the next visit says what it came to. */
export interface Notice {
  amount: number
  total: number
}
export const saveNotice = (n: Notice) => safeStorage.setItem(NOTICE, JSON.stringify(n))
export const clearNotice = () => safeStorage.removeItem(NOTICE)
export function takeNotice(): Notice | null {
  const raw = safeStorage.getItem(NOTICE)
  if (raw == null) return null
  safeStorage.removeItem(NOTICE)
  try {
    const n = JSON.parse(raw) as Notice
    return Number.isFinite(n?.amount) && Number.isInteger(n.total) ? n : null
  } catch {
    return null
  }
}
