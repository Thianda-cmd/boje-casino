import { safeStorage } from '../../lib/storage'
import { isSpot, type Spot, type Stakes } from './rules'

/*
  What Showtime keeps on this device besides its stake ledger (ledger.ts): the player's last stakes (for Repeat) and
  the chip. Also the rounds of the single-player Showtime that came before the shared show: one of those left
  unpaid by a page that died is still paid on the next visit, once (its page beat a heartbeat into it while it
  played, so one still showing in an old tab is left alone).
*/

const LAST = 'lumen.showtime.last'
const CHIP = 'lumen.showtime.chip'
const NOTICE = 'lumen.showtime.notice'

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

/* ---------------- a round of the single-player Showtime ---------------- */

export type Meta = Record<string, string | number | boolean>
export interface PendingRound {
  bet: number
  payout: number
  meta: Meta
  spot: Spot
}
export const pendingKey = (uid: string | null) => `lumen.showtime.pending.${uid ?? 'guest'}`
/** a heartbeat younger than this means a page is still showing the round */
export const LIVE_MS = 4000

/** how long ago the page showing the stored round last beat (ms): Infinity if it never did, null if none is stored */
export function pendingAge(key: string): number | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const at = (JSON.parse(raw) as { at?: unknown })?.at
    return typeof at === 'number' ? Math.max(0, Date.now() - at) : Infinity
  } catch {
    return Infinity
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
    return { bet: p.bet, payout: p.payout, meta: p.meta ?? {}, spot: isSpot(p.spot) ? p.spot : '1' }
  } catch {
    return null
  }
}

/* A round the single-player Showtime paid as its page was left: the next visit says what it came to. */
export function takeNotice(): { amount: number; spot: Spot } | null {
  const raw = safeStorage.getItem(NOTICE)
  if (raw == null) return null
  safeStorage.removeItem(NOTICE)
  try {
    const n = JSON.parse(raw) as { amount: number; spot: Spot }
    return isSpot(n?.spot) && Number.isFinite(n.amount) ? n : null
  } catch {
    return null
  }
}
