import { carried } from '../../lib/account'
import { safeStorage } from '../../lib/storage'
import { round2 } from '../../lib/format'
import { HAND_ORDER, MAX_ANTE, MAX_TRIPS, MIN_ANTE, parseHand, shuffledDeck, type Card, type Hand, type HandRank } from './rules'

/*
  What Hold'em Showdown keeps in localStorage.

  The hand in play is plain data (rules.ts: the whole shuffled deck, the bets and how far it has got), saved under the
  player's key after every step and before anything shows it, so a reload resumes it exactly. A finished hand stays
  saved until it is settled, and is settled then (by the page that played it, or by the next visit). Saves go through
  safeStorage.setItem, which first writes the held wallet: storage never shows a hand a step ahead of the coins taken
  for it.

  A guest who signs up takes their wallet into the new account (lib/account.ts), with the stake of a hand they had open
  already taken from it: that hand goes with it (takeCarried), so the account finishes it and is paid for it.

  Also here: the history of recent hands with the player's stats, the last bets, the remembered switches (chip, turbo,
  advice), the notice a hand settled as the page closed leaves for that player's next visit, and the dev hook's
  stacked deck.
*/

export const handKey = (uid: string | null) => `lumen.holdem.hand.${uid ?? 'guest'}`
export const histKey = (uid: string | null) => `lumen.holdem.hist.${uid ?? 'guest'}`
/** the Web Lock one tab holds while it plays for a player */
export const lockName = (uid: string | null) => `lumen.holdem.${uid ?? 'guest'}`
/** what a hand settled as the page closed came to, for the player's next visit to say */
const noticeKey = (uid: string | null) => `lumen.holdem.notice.${uid ?? 'guest'}`
/** a guest's hand that a sign-up carried into an account, waiting there for the account's next visit */
const carriedKey = (uid: string) => `lumen.holdem.carried.${uid}`
const BETS_KEY = 'lumen.holdem.bets'
const CHIP_KEY = 'lumen.holdem.chip'
const TURBO_KEY = 'lumen.holdem.turbo'
const ADVICE_KEY = 'lumen.holdem.advice'

function readJson(key: string): unknown {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/* ---------------- the hand ---------------- */

export interface Saved {
  /** when the hand was dealt: its id in the history */
  id: number
  hand: Hand
}

export function loadHand(key: string): Saved | null {
  const o = readJson(key) as { id?: unknown; hand?: unknown } | null
  if (!o) return null
  const hand = parseHand(o.hand)
  if (!hand) return null
  return { id: Number.isFinite(o.id) ? Number(o.id) : Date.now(), hand }
}

export const saveHand = (key: string, s: Saved) => safeStorage.setItem(key, JSON.stringify(s))
export const clearHand = (key: string) => safeStorage.removeItem(key)

/**
 * The guest's hand that the last sign-up on this device carried into an account (one dealt before the sign-up: a
 * later guest's own hands are dealt after it). On that account's page: returned, and out of storage before anything
 * is paid on it, so it can only ever be paid once. On any other page (the next guest, say): moved aside for the
 * account's next visit, so nobody else resumes it or deals over it; null.
 */
export function takeCarried(uid: string | null): Saved | null {
  const c = carried()
  if (!c) return null
  const gk = handKey(null)
  const g = loadHand(gk)
  const ours = g && g.id < c.at ? g : null
  if (uid !== c.to) {
    if (ours) {
      saveHand(carriedKey(c.to), ours)
      clearHand(gk)
    }
    return null
  }
  const parked = loadHand(carriedKey(c.to))
  if (parked) {
    clearHand(carriedKey(c.to))
    return parked
  }
  if (ours) clearHand(gk)
  return ours
}

/* ---------------- history and stats ---------------- */

export type Outcome = 'win' | 'lose' | 'push' | 'fold'

export interface PastHand {
  id: number
  stake: number
  ret: number
  /** the player's final hand */
  rank: HandRank
  outcome: Outcome
}

export interface Stats {
  hands: number
  won: number
  /** the best final hand the player has made */
  best: HandRank | null
  /** the biggest win over the stake */
  top: number
}

export interface History {
  list: PastHand[]
  stats: Stats
}

export const MAX_HIST = 24
const NO_STATS: Stats = { hands: 0, won: 0, best: null, top: 0 }

const isRank = (x: unknown): x is HandRank => typeof x === 'string' && (HAND_ORDER as readonly string[]).includes(x)

export function loadHistory(key: string): History {
  const o = readJson(key) as { list?: unknown; stats?: Partial<Stats> } | null
  const list = Array.isArray(o?.list)
    ? (o.list as Partial<PastHand>[]).filter(
        (x): x is PastHand => !!x && Number.isFinite(x.id) && Number.isFinite(x.stake) && Number.isFinite(x.ret) && isRank(x.rank) && ['win', 'lose', 'push', 'fold'].includes(x.outcome as string),
      )
    : []
  const s = o?.stats
  const stats: Stats = s
    ? { hands: Number(s.hands) || 0, won: Number(s.won) || 0, best: isRank(s.best) ? s.best : null, top: Number(s.top) || 0 }
    : NO_STATS
  return { list: list.slice(0, MAX_HIST), stats }
}

/** the history with a settled hand added (once: a hand already there is left as it is) */
export function withHand(h: History, p: PastHand): History {
  if (h.list.some((x) => x.id === p.id)) return h
  const s = h.stats
  const better = !s.best || HAND_ORDER.indexOf(p.rank) > HAND_ORDER.indexOf(s.best)
  return {
    list: [p, ...h.list].slice(0, MAX_HIST),
    stats: {
      hands: s.hands + 1,
      won: s.won + (p.outcome === 'win' ? 1 : 0),
      // a folded hand never counts as the best made
      best: better && p.outcome !== 'fold' ? p.rank : s.best,
      top: Math.max(s.top, round2(p.ret - p.stake)),
    },
  }
}

export const saveHistory = (key: string, h: History) => safeStorage.setItem(key, JSON.stringify(h))

/* ---------------- notice ---------------- */

export interface Notice {
  stake: number
  ret: number
  rank: HandRank
  outcome: Outcome
}

export function takeNotice(uid: string | null): Notice | null {
  const key = noticeKey(uid)
  const o = readJson(key) as Partial<Notice> | null
  if (o) safeStorage.removeItem(key)
  if (!o || !Number.isFinite(o.ret) || !Number.isFinite(o.stake) || !isRank(o.rank)) return null
  return { stake: Number(o.stake), ret: Number(o.ret), rank: o.rank, outcome: (o.outcome as Outcome) ?? 'lose' }
}
export const saveNotice = (uid: string | null, n: Notice) => safeStorage.setItem(noticeKey(uid), JSON.stringify(n))
export const clearNotice = (uid: string | null) => safeStorage.removeItem(noticeKey(uid))

/* ---------------- bets and switches ---------------- */

export interface Bets {
  ante: number
  trips: number
}

const clampBet = (v: unknown, min: number, max: number) => {
  const n = Number(v)
  return Number.isFinite(n) && n >= min ? round2(Math.min(max, n)) : 0
}

export function loadBets(): Bets {
  const o = readJson(BETS_KEY) as Partial<Bets> | null
  return { ante: clampBet(o?.ante, MIN_ANTE, MAX_ANTE) || 10, trips: clampBet(o?.trips, 1, MAX_TRIPS) }
}
export const saveBets = (b: Bets) => safeStorage.setItem(BETS_KEY, JSON.stringify(b))

export function loadChip(chips: readonly number[], fallback: number) {
  const v = Number(safeStorage.getItem(CHIP_KEY))
  return chips.includes(v) ? v : fallback
}
export const saveChip = (v: number) => safeStorage.setItem(CHIP_KEY, String(v))
export const loadTurbo = () => safeStorage.getItem(TURBO_KEY) === '1'
export const saveTurbo = (on: boolean) => safeStorage.setItem(TURBO_KEY, on ? '1' : '0')
/** advice is on until the player turns it off: newcomers see what to do */
export const loadAdvice = () => safeStorage.getItem(ADVICE_KEY) !== '0'
export const saveAdvice = (on: boolean) => safeStorage.setItem(ADVICE_KEY, on ? '1' : '0')

/* ---------------- dev: window.__holdemForce ---------------- */

/** "As", "Td", "10h", "Q♠" → a card (rank chars 2-9, T or 10, J, Q, K, A; suits c d h s or the symbols) */
export function parseCard(s: string): Card | null {
  const m = /^(10|[2-9TJQKA])([cdhs♣♦♥♠])$/i.exec(s.trim())
  if (!m) return null
  const rank = '23456789TJQKA'.indexOf(m[1] === '10' ? 'T' : m[1].toUpperCase())
  const suit = 'cdhs'.includes(m[2].toLowerCase()) ? 'cdhs'.indexOf(m[2].toLowerCase()) : '♣♦♥♠'.indexOf(m[2])
  return suit * 13 + rank
}

type Spec = { player?: string[]; dealer?: string[]; board?: string[] }

/** the named scenarios: the cards each one needs (anything left out is shuffled in) */
export const SCENARIOS: Record<string, Spec> = {
  // a royal flush in spades for the player; the dealer qualifies with eights
  royal: { player: ['As', 'Ks'], dealer: ['8h', '8d'], board: ['Qs', 'Js', 'Ts', '4d', '2c'] },
  // the player's ace-high flush in hearts beats the dealer's queens: the Blind pays 3 to 2
  flushWin: { player: ['Ah', '7h'], dealer: ['Qd', 'Qc'], board: ['Kh', '9h', '2h', '5c', 'Jd'] },
  // the dealer has only jack high: the Ante comes back, the Play wins
  dealerNoQualify: { player: ['Ac', 'Kd'], dealer: ['3s', '5d'], board: ['2h', '7s', '9d', 'Jc', '4h'] },
  // the board plays for both: a straight to the ace, everything returned
  tie: { player: ['2c', '3d'], dealer: ['4s', '5h'], board: ['Ah', 'Kh', 'Qd', 'Jc', 'Ts'] },
  // nothing to show at the river: the advice is to fold
  riverFold: { player: ['2c', '7d'], dealer: ['8h', '6s'], board: ['Kh', 'Qs', '9c', '4d', 'Js'] },
}

/**
 * The deck for the next deal as `force` asks: a scenario's name or explicit cards { player, dealer, board } (any part
 * may be left out). Null when it asks for nothing usable. Positions: player 0-1, dealer 2-3, board 4-8.
 */
export function forcedDeck(force: unknown, rng: () => number): Card[] | null {
  const spec: Spec | undefined = typeof force === 'string' ? SCENARIOS[force] : force && typeof force === 'object' ? (force as Spec) : undefined
  if (!spec) return null
  const want = new Map<number, Card>()
  const put = (cards: unknown, at: number, n: number) => {
    if (!Array.isArray(cards)) return
    cards.slice(0, n).forEach((s, i) => {
      const c = typeof s === 'string' ? parseCard(s) : null
      if (c != null && ![...want.values()].includes(c)) want.set(at + i, c)
    })
  }
  put(spec.player, 0, 2)
  put(spec.dealer, 2, 2)
  put(spec.board, 4, 5)
  if (!want.size) return null
  const taken = new Set(want.values())
  const rest = shuffledDeck(rng).filter((c) => !taken.has(c))
  return Array.from({ length: 52 }, (_, i) => want.get(i) ?? rest.shift()!)
}
