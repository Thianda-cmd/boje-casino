import { safeStorage } from '../../lib/storage'
import { isBetKey, type BetKey, type Bets, type Dice, type Die, type Lucky } from './rules'

/*
  What Sic Bo keeps on this device: the last hundred rolls (for the history strip and the stats), the player's last
  table (for Rebet on a later visit), the chip and turbo choices, and a round in play until it is paid.

  A round is stored the moment it is drawn and removed the moment it is paid, so it settles exactly once: when its
  show ends, as the page is left (and a notice says so on the next visit), or on the next visit if the page died.
  While its show plays, the page beats a heartbeat into it every second, so Sic Bo opened in a second tab leaves a
  live round alone (it is only an unfinished one once the heartbeat stops); and a page about to pay checks the round
  is still there, so one another tab did take (a long-hidden tab's heartbeat slows) is never paid twice.
*/

const HIST = 'lumen.sicbo.hist'
const LAST = 'lumen.sicbo.last'
const CHIP = 'lumen.sicbo.chip'
const TURBO = 'lumen.sicbo.turbo'
const NOTICE = 'lumen.sicbo.notice'
export const MAX_HIST = 100

/** a roll gone by: its dice as they landed and the spots struck that round */
export interface PastRoll {
  /** when it was rolled (ms), which also keys it on screen */
  t: number
  dice: Dice
  lucky: Lucky[]
}

const isDie = (n: unknown): n is Die => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 6
export const isDice = (d: unknown): d is Dice => Array.isArray(d) && d.length === 3 && d.every(isDie)
const isLucky = (l: unknown): l is Lucky => {
  const x = l as Lucky
  return !!x && isBetKey(x.key) && Number.isInteger(x.mult) && x.mult >= 2 && x.mult <= 25
}

export function loadHistory(): PastRoll[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(HIST) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is PastRoll => !!r && Number.isFinite(r.t) && isDice(r.dice) && Array.isArray(r.lucky) && r.lucky.every(isLucky)).slice(-MAX_HIST)
  } catch {
    return []
  }
}
export const saveHistory = (h: readonly PastRoll[]) => safeStorage.setItem(HIST, JSON.stringify(h.slice(-MAX_HIST)))

/** the table the player last rolled, if it still makes sense */
export function loadLast(): Bets | null {
  try {
    const raw = JSON.parse(safeStorage.getItem(LAST) ?? 'null') as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    const out: Bets = {}
    for (const [k, v] of Object.entries(raw)) if (isBetKey(k) && typeof v === 'number' && v > 0) out[k as BetKey] = v
    return Object.keys(out).length ? out : null
  } catch {
    return null
  }
}
export const saveLast = (b: Bets) => safeStorage.setItem(LAST, JSON.stringify(b))

export const loadChip = (values: readonly number[], fallback: number) => {
  const v = Number(safeStorage.getItem(CHIP))
  return values.includes(v) ? v : fallback
}
export const saveChip = (v: number) => safeStorage.setItem(CHIP, String(v))
export const loadTurbo = () => safeStorage.getItem(TURBO) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO, on ? '1' : '0')

/* ---------------- a round in play ---------------- */

export type Meta = Record<string, string | number | boolean>
export interface PendingRound {
  bet: number
  payout: number
  meta: Meta
  dice: Dice
  lucky: Lucky[]
  t: number
  /** the heartbeat of the page showing it (ms) */
  at?: number
}
export const pendingKey = (uid: string | null) => `lumen.sicbo.pending.${uid ?? 'guest'}`
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
    localStorage.setItem('lumen.sicbo.probe', '1')
    localStorage.removeItem('lumen.sicbo.probe')
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
    return { bet: p.bet, payout: p.payout, meta: p.meta ?? {}, dice: isDice(p.dice) ? p.dice : [1, 1, 1], lucky: Array.isArray(p.lucky) ? p.lucky.filter(isLucky) : [], t: Number(p.t) || Date.now() }
  } catch {
    return null
  }
}

/* A round paid as the page was left: the next visit says what it came to. */
export interface Notice {
  amount: number
  dice: Dice
}
export const saveNotice = (n: Notice) => safeStorage.setItem(NOTICE, JSON.stringify(n))
export const clearNotice = () => safeStorage.removeItem(NOTICE)
export function takeNotice(): Notice | null {
  const raw = safeStorage.getItem(NOTICE)
  if (raw == null) return null
  safeStorage.removeItem(NOTICE)
  try {
    const n = JSON.parse(raw) as Notice
    return isDice(n?.dice) && Number.isFinite(n.amount) ? n : null
  } catch {
    return null
  }
}
