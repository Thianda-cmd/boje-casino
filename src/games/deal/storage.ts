import { safeStorage } from '../../lib/storage'
import { MAX_BET } from '../../store/wallet'
import { BOARDS, CASES, ROUNDS, isGame, unseen, type BoardId, type Game } from './rules'

/*
  What Banker's Deal keeps on this device: the game in play (one per player), the last game played (so a second tab
  can show how it ended), and the player's last games for the history strip.

  A game is a decision game, so it is not paid when the page goes: it waits. It is kept under the player's own key
  (lumen.deal.game.<uid|guest>), with the stake it took and a move count, and written synchronously after every move
  and before the move is shown, so a reload finds the game exactly where it was and can never re-roll a case or an
  offer (rules.ts draws each case only as it is opened, so the record never holds a prize the player has not seen).

  It is paid once, when it is over: the page that makes the last move takes the record out of storage (checking that
  it is still there and still the game it showed) and pays in the same moment, so a second tab can't pay it again. A
  tab re-reads the record before every move and acts only if it is the very state it shows (same game, same move
  count); otherwise it adopts what storage holds instead. It also follows the storage event, so a move made in one
  tab shows in the other. A record that has not moved for STALE_MS is played out on the next visit (every offer
  refused, the best expected value) and paid with a notice.

  A record is checked before it is trusted (isGame from rules.ts, and the course of the game: the step, the round,
  the cases opened and the offers must agree, and an offer can't be more than the unseen prizes' average). One that
  can't be read is removed and its stake handed back.
*/

const PROBE = 'lumen.deal.probe'
export const gameKey = (uid: string | null) => `lumen.deal.game.${uid ?? 'guest'}`
export const lastKey = (uid: string | null) => `lumen.deal.last.${uid ?? 'guest'}`
export const histKey = (uid: string | null) => `lumen.deal.hist.${uid ?? 'guest'}`
/** a game nobody has touched for this long is played out and paid on the next visit */
export const STALE_MS = 7 * 24 * 3600_000
export const MAX_HIST = 30

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const mean = (v: readonly number[]) => v.reduce((a, x) => a + x, 0) / v.length
const before = (r: number) => ROUNDS.slice(0, r).reduce((a, n) => a + n, 0)

/** whether localStorage works at all (a private window may refuse it): without it a game lives in the page only */
export function storageWorks(): boolean {
  try {
    localStorage.setItem(PROBE, '1')
    localStorage.removeItem(PROBE)
    return true
  } catch {
    return false
  }
}

/* ---------------- the game in play ---------------- */

export interface Saved {
  v: 1
  /** this game's own id */
  id: string
  /** the player whose stake it took */
  uid: string | null
  stake: number
  game: Game
  /** moves made: every write counts one, so a tab can tell the state it shows from a newer one */
  n: number
  /** started, and last moved (ms) */
  t: number
  at: number
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** whether a game in play agrees with itself: rules.ts's isGame, plus the course of the game */
export function sane(g: Game): boolean {
  if (!isGame(g)) return false
  const keys = Object.keys(g.opened)
  if (!keys.every((k) => /^\d+$/.test(k) && Number(k) < CASES)) return false
  if (!g.offers.every((o) => finite(o) && o >= 0)) return false
  if (g.dealt !== null || g.minePrize !== null || g.lastPrize !== null || g.result !== null) return false
  const n = keys.length
  if (g.step === 'pick') return g.mine === null && n === 0 && g.round === 0 && g.offer === null && g.offers.length === 0
  if (g.mine === null) return false
  if (g.step === 'open') return g.round < ROUNDS.length && n >= before(g.round) && n < before(g.round + 1) && g.offer === null && g.offers.length === g.round
  if (g.step === 'offer') {
    if (!finite(g.offer) || g.offer < 0 || g.offer > mean(unseen(g)) + 1e-9 || g.offers[g.offers.length - 1] !== g.offer) return false
    return g.round < ROUNDS.length ? n === before(g.round + 1) && g.offers.length === g.round + 1 : n === CASES - 2 && g.offers.length === ROUNDS.length + 1
  }
  // a finished game is never stored: it is paid and taken out in the same moment
  return false
}

const stakeOk = (s: unknown): s is number => finite(s) && s > 0 && s <= MAX_BET

export type Read = { kind: 'none' } | { kind: 'ok'; rec: Saved } | { kind: 'bad'; stake: number | null }

/** the game stored under key, checked */
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
    if (r.v !== 1 || typeof r.id !== 'string' || !stake || !Number.isInteger(r.n) || r.n < 0 || !finite(r.t) || !finite(r.at) || !sane(r.game)) return { kind: 'bad', stake }
    return { kind: 'ok', rec: { v: 1, id: r.id, uid: typeof r.uid === 'string' ? r.uid : null, stake, game: r.game, n: r.n, t: r.t, at: r.at } }
  } catch {
    return { kind: 'bad', stake: null }
  }
}

export const writeSaved = (key: string, rec: Saved) => safeStorage.setItem(key, JSON.stringify(rec))

/**
 * Takes the game out of storage so it can be paid: only if it is still there and still game `id` (another tab may
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

/* ---------------- the last game, and the history ---------------- */

/** a finished game, kept so the page (or another tab) can show how it ended */
export interface Last {
  id: string
  stake: number
  game: Game
  payout: number
  t: number
}
export const saveLast = (key: string, l: Last) => safeStorage.setItem(key, JSON.stringify(l))
export function loadLast(key: string): Last | null {
  try {
    const l = JSON.parse(safeStorage.getItem(key) ?? 'null') as Last | null
    if (!l || typeof l.id !== 'string' || !stakeOk(l.stake) || !finite(l.payout) || !finite(l.t) || !isGame(l.game) || l.game.step !== 'over') return null
    return l
  } catch {
    return null
  }
}

/** a game gone by, for the history strip */
export interface Past {
  id: string
  t: number
  board: BoardId
  stake: number
  payout: number
  /** the multiple it paid */
  result: number
  dealt: boolean
}
const isBoard = (b: unknown): b is BoardId => BOARDS.some((x) => x.id === b)
export function loadHistory(key: string): Past[] {
  try {
    const raw = JSON.parse(safeStorage.getItem(key) ?? '[]') as Past[]
    if (!Array.isArray(raw)) return []
    return raw.filter((p) => p && typeof p.id === 'string' && finite(p.t) && isBoard(p.board) && stakeOk(p.stake) && finite(p.payout) && finite(p.result) && typeof p.dealt === 'boolean').slice(-MAX_HIST)
  } catch {
    return []
  }
}
/** the history with a game in it (once), the newest last */
export function addHistory(key: string, p: Past): Past[] {
  const next = [...loadHistory(key).filter((x) => x.id !== p.id), p].slice(-MAX_HIST)
  safeStorage.setItem(key, JSON.stringify(next))
  return next
}
