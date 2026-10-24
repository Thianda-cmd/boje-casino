import { safeStorage } from '../../lib/storage'
import { cleanField } from './field'
import { ITEM_KINDS, type Feature, type Field, type ItemKind, type PusherMeta } from './types'

/*
  What Coin Cascade keeps on this device, per player (the guest, or each signed-in account): the machine's field, the
  last drops (for the history pills), a drop in play until it is paid, and a note of a drop paid as the page was left;
  and, for everyone on the device, the turbo switch and where the player last aimed.

  The field is the player's own machine: it is saved as the drop that moved it is paid (its `after`), so a reload, or
  a visit next week, finds the coins and prizes exactly where they came to rest.

  A drop is stored the moment it is staked (before anything moves: its result, its payout and the field it leaves are
  all known by then) and removed the moment it is paid, so it settles exactly once: when its last item lands in the
  tray, at once if the page is hidden, left or closed mid-drop (a note then tells the next visit what it paid), or on
  the next visit if the page died. While a drop plays, the page beats a heartbeat into its own small key every second,
  so Coin Cascade opened in a second tab leaves a live drop alone (it is only an unfinished one once the heartbeat
  stops) and won't start a drop of its own over it; and a page about to pay checks that the stored drop is still its
  own, so one another tab did take (a long-hidden tab's timers slow) is never paid twice. This is Sic Bo's and
  Bullseye's scheme, with an id on each drop.
*/

const TURBO = 'lumen.pusher.turbo'
const AIM = 'lumen.pusher.aim'
const who = (uid: string | null) => uid ?? 'guest'
export const fieldKey = (uid: string | null) => `lumen.pusher.field.${who(uid)}`
export const histKey = (uid: string | null) => `lumen.pusher.hist.${who(uid)}`
export const pendingKey = (uid: string | null) => `lumen.pusher.pending.${who(uid)}`
const beatKey = (pending: string) => pending.replace('.pending.', '.beat.')
const noticeKey = (uid: string | null) => `lumen.pusher.notice.${who(uid)}`
export const MAX_HIST = 40

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const isCounts = (w: unknown): w is Record<ItemKind, number> => !!w && typeof w === 'object' && ITEM_KINDS.every((k) => Number.isInteger((w as Record<string, unknown>)[k]) && (w as Record<ItemKind, number>)[k] >= 0 && (w as Record<ItemKind, number>)[k] <= 40)
const isFeature = (f: unknown): f is Feature => f === 'none' || f === 'shower' || f === 'quake'

/* ---------------- the field ---------------- */

/** the stored field as it is written (so a page can tell whether another tab has moved it since) and as a field */
export function readField(key: string): { raw: string; field: Field } | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const field = cleanField(JSON.parse(raw))
    return field ? { raw, field } : null
  } catch {
    return null
  }
}
/** saves the field; returns what was written */
export function saveField(key: string, f: Field): string {
  const raw = JSON.stringify(f)
  safeStorage.setItem(key, raw)
  return raw
}

/* ---------------- the history ---------------- */

/** a drop gone by */
export interface PastDrop {
  id: string
  /** when it was dropped (ms) */
  t: number
  bet: number
  payout: number
  mult: number
  wins: Record<ItemKind, number>
  feature: Feature
}

const isPast = (x: unknown): x is PastDrop => {
  const p = x as PastDrop
  return !!p && typeof p.id === 'string' && Number.isFinite(p.t) && Number.isFinite(p.bet) && Number.isFinite(p.payout) && Number.isFinite(p.mult) && isCounts(p.wins) && isFeature(p.feature)
}

/** the last drops, the newest first */
export function loadHistory(key: string): PastDrop[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter(isPast).slice(0, MAX_HIST) : []
  } catch {
    return []
  }
}
/** the history with a drop added (once: a drop already there is not added again), saved; returns it */
export function addHistory(key: string, d: PastDrop): PastDrop[] {
  const h = loadHistory(key)
  if (h.some((x) => x.id === d.id)) return h
  const next = [d, ...h].slice(0, MAX_HIST)
  safeStorage.setItem(key, JSON.stringify(next))
  return next
}

/* ---------------- choices ---------------- */

export const loadTurbo = () => safeStorage.getItem(TURBO) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO, on ? '1' : '0')
export function loadAim(): number {
  const v = Number(safeStorage.getItem(AIM))
  return Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0
}
export const saveAim = (a: number) => safeStorage.setItem(AIM, a.toFixed(3))

/* ---------------- a drop in play ---------------- */

export interface PendingDrop {
  v: 1
  id: string
  bet: number
  payout: number
  meta: PusherMeta
  mult: number
  wins: Record<ItemKind, number>
  feature: Feature
  /** the field the drop leaves: the player's field once the drop is paid */
  after: Field
  t: number
}

export const pastOf = (p: Pick<PendingDrop, 'id' | 't' | 'bet' | 'payout' | 'mult' | 'wins' | 'feature'>): PastDrop => ({ id: p.id, t: p.t, bet: p.bet, payout: p.payout, mult: p.mult, wins: { ...p.wins }, feature: p.feature })

/** a heartbeat younger than this means a page is still showing the drop */
export const LIVE_MS = 4000

/** stores the drop and its first heartbeat */
export function savePending(key: string, p: PendingDrop) {
  safeStorage.setItem(key, JSON.stringify(p))
  beat(key, p.id)
}
/** the page showing drop `id` is still there */
export const beat = (key: string, id: string) => safeStorage.setItem(beatKey(key), JSON.stringify({ id, at: Date.now() }))

function storedId(key: string): string | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    const id = (JSON.parse(raw) as PendingDrop)?.id
    return typeof id === 'string' ? id : ''
  } catch {
    return ''
  }
}

/** whether drop `id` is the one stored under key */
export const holdsPending = (key: string, id: string) => storedId(key) === id

/** how long ago the page showing the stored drop last beat (ms): Infinity if no page is beating for it, null if none is stored */
export function pendingAge(key: string): number | null {
  const id = storedId(key)
  if (id == null) return null
  try {
    const b = JSON.parse(safeStorage.getItem(beatKey(key)) ?? 'null') as { id?: string; at?: number } | null
    return b && b.id === id && typeof b.at === 'number' ? Math.max(0, Date.now() - b.at) : Infinity
  } catch {
    return Infinity
  }
}

/** whether storage works at all (in a private window it may not: a drop then lives only in the page) */
function storageWorks() {
  try {
    localStorage.setItem('lumen.pusher.probe', '1')
    localStorage.removeItem('lumen.pusher.probe')
    return true
  } catch {
    return false
  }
}

/**
 * Removes drop `id` from storage if it is still there, as its page pays it: true if this page may pay it, false if
 * another page took it first (storage holds no drop, or another one, and storage works).
 */
export function releasePending(key: string, id: string): boolean {
  const cur = storedId(key)
  if (cur === id) {
    safeStorage.removeItem(key)
    safeStorage.removeItem(beatKey(key))
    return true
  }
  return !storageWorks()
}

/** the drop a page left unpaid, removed as it is read so it can only be paid once (null if none, or it can't be read) */
export function takePending(key: string): (Omit<PendingDrop, 'after'> & { after: Field | null }) | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  safeStorage.removeItem(beatKey(key))
  try {
    const p = JSON.parse(raw) as PendingDrop
    if (typeof p?.bet !== 'number' || typeof p.payout !== 'number' || !(p.bet > 0) || !(p.payout >= 0) || !Number.isFinite(p.payout)) return null
    const wins = isCounts(p.wins) ? p.wins : { silver: 0, gold: 0, gem: 0, bar: 0, idol: 0, crown: 0 }
    const feature = isFeature(p.feature) ? p.feature : 'none'
    const mult = Number.isFinite(p.mult) ? p.mult : p.payout / p.bet
    return { v: 1, id: typeof p.id === 'string' ? p.id : newId(), bet: p.bet, payout: p.payout, meta: p.meta ?? { ...wins, mult, feature }, mult, wins, feature, after: cleanField(p.after), t: Number(p.t) || Date.now() }
  } catch {
    return null
  }
}

/* ---------------- a drop paid as the page was left: the next visit says what it came to ---------------- */

export interface Notice {
  amount: number
  mult: number
}
export const saveNotice = (uid: string | null, n: Notice) => safeStorage.setItem(noticeKey(uid), JSON.stringify(n))
export const clearNotice = (uid: string | null) => safeStorage.removeItem(noticeKey(uid))
export function takeNotice(uid: string | null): Notice | null {
  const key = noticeKey(uid)
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  try {
    const n = JSON.parse(raw) as Notice
    return Number.isFinite(n?.amount) && Number.isFinite(n.mult) ? n : null
  } catch {
    return null
  }
}
