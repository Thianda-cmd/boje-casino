import { safeStorage } from '../../lib/storage'
import { shuffle } from '../../lib/rng'
import { CUT_MAX, CUT_MIN, SHOE_SIZE, decodeCards, encodeCards, type RoadEntry, type Shoe } from './rules'

/*
  The shoe in play and its scoreboard, kept on this device. Only which cards are left is stored, never their order:
  a reload shuffles the unseen cards again, which changes nothing about what can come (their order was unknown
  anyway) and keeps the next cards out of storage.
*/

const KEY = 'lumen.baccarat.table'
const TURBO = 'lumen.baccarat.turbo'
const MAX_HIST = 120

interface Saved {
  v: 1
  left: string
  cutAt: number
  cutOut: boolean
  finished?: boolean
  hist: RoadEntry[]
}

const isDigit = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 9
const validEntry = (e: unknown): e is RoadEntry => {
  const x = e as RoadEntry
  return !!x && (x.w === 'P' || x.w === 'B' || x.w === 'T') && isDigit(x.p) && isDigit(x.b)
}

export function loadTable(): { shoe: Shoe | null; hist: RoadEntry[] } {
  try {
    const s = JSON.parse(safeStorage.getItem(KEY) ?? 'null') as Saved | null
    if (!s || s.v !== 1 || typeof s.left !== 'string') return { shoe: null, hist: [] }
    const cards = decodeCards(s.left)
    // past the cut card a shoe can be down to a few cards (the last hand, or the one before it): keep it and its road
    if (!cards || !cards.length || cards.length > SHOE_SIZE) return { shoe: null, hist: [] }
    const cutAt = Number(s.cutAt)
    if (!(cutAt >= CUT_MIN && cutAt <= CUT_MAX)) return { shoe: null, hist: [] }
    const hist = Array.isArray(s.hist) ? s.hist.filter(validEntry).slice(-MAX_HIST) : []
    const cutOut = !!s.cutOut || cards.length <= cutAt
    return { shoe: { cards: shuffle(cards), cutAt, cutOut, finished: !!s.finished || cards.length < 6, burn: null }, hist }
  } catch {
    return { shoe: null, hist: [] }
  }
}

export function saveTable(shoe: Shoe, hist: RoadEntry[]) {
  const s: Saved = { v: 1, left: encodeCards(shoe.cards), cutAt: shoe.cutAt, cutOut: shoe.cutOut, finished: shoe.finished, hist: hist.slice(-MAX_HIST) }
  safeStorage.setItem(KEY, JSON.stringify(s))
}

export const loadTurbo = () => safeStorage.getItem(TURBO) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO, on ? '1' : '0')

/* A round in play: stored when it is dealt, removed when it is paid. One the page never got to pay (a dropped tab, a
   crash) is paid on the next visit, into the wallet of whoever dealt it. */
export type Meta = Record<string, string | number | boolean>
export interface PendingRound {
  bet: number
  payout: number
  meta: Meta
}
export const pendingKey = (uid: string | null) => `lumen.baccarat.pending.${uid ?? 'guest'}`
export const savePending = (key: string, p: PendingRound) => safeStorage.setItem(key, JSON.stringify(p))
export const clearPending = (key: string) => safeStorage.removeItem(key)
export function takePending(key: string): PendingRound | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  safeStorage.removeItem(key)
  try {
    const p = JSON.parse(raw) as PendingRound
    return typeof p?.bet === 'number' && typeof p.payout === 'number' && p.bet > 0 && p.payout >= 0 ? { bet: p.bet, payout: p.payout, meta: p.meta ?? {} } : null
  } catch {
    return null
  }
}
