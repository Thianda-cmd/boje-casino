import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import { winnings } from './rules'

/*
  Pot Luck's ledger, Double's scheme (src/games/double/ledger.ts). Coins leave the wallet when a payment is sent,
  before the server answers, so every round this browser has paid into is written down here until it settles: across
  reloads, other tabs, a page that died, and rounds that ended while the player was elsewhere (the page settles them
  on the next visit, and usePotPayouts in src/App.tsx while the player is anywhere else in the casino). One
  localStorage key per round per player, plus a marker once it has settled holding the outcome. Every credit runs
  under a Web Lock and checks the marker, so two tabs never pay a round twice.

  A round settles on what this browser paid and what the server holds in the player's name (outcomeOf): coins the
  server never took come back, and nothing is paid on coins this browser didn't pay. The winner's own browser pays
  itself the winnings; if the server holds more in the player's name than this browser paid (the same account
  playing on two devices), each device takes its share of the winnings, so between them they are paid once.
*/

/** whose rounds: 'shared' for the database's, 'local' for the stand-in's (its ids follow the clock, so they never meet) */
export type Book = 'shared' | 'local'

interface Entry {
  /** coins this browser paid into the round */
  amount: number
  /** how many payments */
  count: number
  at: number
  /** the round's published hash: a round id only names the same round while the database lives */
  hash: string
}

export interface Outcome {
  /** the coins that reached the pot: what this browser paid, capped by what the server holds */
  bet: number
  payout: number
  /** paid but never in the pot: goes back to the wallet */
  refund: number
  won: boolean
  pot: number
  /** this browser's coins as a share of the pot: the chance it had */
  share: number
}
export interface Settled {
  at: number
  outcome: Outcome
  hash: string
}

const cents = (n: number) => Math.round(n * 100)

/**
 * Settles one round for this browser: `paid` is what it paid, `held` what the server has in the player's name, `pot`
 * the round's pot and `won` whether the player's ticket was drawn.
 */
export function outcomeOf(paid: number, held: number, pot: number, won: boolean): Outcome {
  const bet = Math.max(0, Math.min(cents(paid), cents(held))) / 100
  // the whole winnings when this browser paid everything the server holds, else its share of them (rounded down)
  const payout = won && bet > 0 ? (cents(bet) >= cents(held) ? winnings(pot) : Math.floor((cents(winnings(pot)) * cents(bet)) / cents(held)) / 100) : 0
  return { bet, payout, refund: Math.max(0, cents(paid) - cents(bet)) / 100, won: won && bet > 0, pot, share: pot > 0 ? Math.round((bet / pot) * 10000) / 10000 : 0 }
}

const pKey = (who: string, book: Book, round: number) => `lumen.pot.p.${who}.${book}:${round}`
const sKey = (who: string, book: Book, round: number) => `lumen.pot.s.${who}.${book}:${round}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's payments
const durable = (() => {
  try {
    localStorage.setItem('lumen.pot.probe', '1')
    localStorage.removeItem('lumen.pot.probe')
    return true
  } catch {
    return false
  }
})()
const mem = new Map<string, string>()
const get = (k: string) => (durable ? safeStorage.getItem(k) : (mem.get(k) ?? null))
const set = (k: string, v: string) => (durable ? safeStorage.setItem(k, v) : void mem.set(k, v))
const del = (k: string) => (durable ? safeStorage.removeItem(k) : void mem.delete(k))

function keysWith(prefix: string): string[] {
  if (!durable) return [...mem.keys()].filter((k) => k.startsWith(prefix))
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) out.push(k)
    }
  } catch {
    /* storage went away */
  }
  return out
}

function read(who: string, book: Book, round: number): Entry | null {
  try {
    const v = JSON.parse(get(pKey(who, book, round)) ?? 'null')
    return v && typeof v.amount === 'number' && v.amount > 0 && typeof v.hash === 'string' ? { amount: v.amount, count: Number(v.count) || 1, at: Number(v.at) || 0, hash: v.hash } : null
  } catch {
    return null
  }
}

/** The marker of a settled round, if it is this round's (`hash`, when known) and not a namesake's from an older database. */
export function settledOf(who: string, book: Book, round: number, hash?: string): Settled | null {
  try {
    const v = JSON.parse(get(sKey(who, book, round)) ?? 'null')
    return v && v.outcome && (!hash || !v.hash || v.hash === hash) ? v : null
  } catch {
    return null
  }
}

/** The published hash a payment was made under ('' if unknown). */
export const hashOf = (who: string, book: Book, round: number) => read(who, book, round)?.hash ?? ''
/** When the first payment was made (0 if unknown). */
export const ageOf = (who: string, book: Book, round: number) => read(who, book, round)?.at ?? 0
/** What this browser has paid into a round it hasn't settled. */
export const paidOf = (who: string, book: Book, round: number) => read(who, book, round)?.amount ?? 0
/** How many payments this browser has made into a round it hasn't settled. */
export const countOf = (who: string, book: Book, round: number) => read(who, book, round)?.count ?? 0

/** Rounds with payments waiting to settle, oldest first. */
export function openRounds(who: string, book: Book): number[] {
  const prefix = `lumen.pot.p.${who}.${book}:`
  return keysWith(prefix)
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
}

/** Whether any round of this player's is waiting to settle, in either book (cheap: for the background payouts). */
export const hasOpen = (who: string) => keysWith(`lumen.pot.p.${who}.`).length > 0

/** Records a payment. Call it in the same task as the wallet deduction, before the request goes out. */
export function addPayment(who: string, book: Book, round: number, hash: string, amount: number) {
  let e = read(who, book, round)
  if (e && e.hash && e.hash !== hash) {
    // a payment into a namesake round of a database that has since been reset: it can never settle, so it comes back
    useWallet.getState().refund(e.amount)
    e = null
  }
  if (get(sKey(who, book, round)) != null && !settledOf(who, book, round, hash)) del(sKey(who, book, round))
  const next = e ?? { amount: 0, count: 0, at: Date.now(), hash }
  next.amount = (cents(next.amount) + cents(amount)) / 100
  next.count += 1
  set(pKey(who, book, round), JSON.stringify(next))
}

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.pot.ledger', () => fn())
  return document.hasFocus() ? fn() : undefined
}

/** The server refused a payment: give it back (never more than this browser paid into the round). */
export async function refundPayment(who: string, book: Book, round: number, amount: number): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      const back = Math.min(cents(amount), cents(e.amount)) / 100
      if (back <= 0) return 0
      useWallet.getState().refund(back)
      e.amount = (cents(e.amount) - cents(back)) / 100
      e.count = Math.max(0, e.count - 1)
      if (e.amount > 0) set(pKey(who, book, round), JSON.stringify(e))
      else del(pKey(who, book, round))
      return back
    })) ?? 0
  )
}

/**
 * Settles a round once: `result` is the round's pot, what the server holds in the player's name and whether their
 * ticket was drawn (null: none of the payments reached it). Returns the outcome, and whether this call paid it (false
 * when another tab or an earlier call already had).
 */
export async function settleRound(who: string, book: Book, round: number, result: { pot: number; held: number; won: boolean } | null): Promise<{ outcome: Outcome; paid: boolean } | null> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      const done = settledOf(who, book, round, e?.hash)
      if (done) {
        del(pKey(who, book, round))
        return { outcome: done.outcome, paid: false }
      }
      if (!e) return null
      const outcome = outcomeOf(e.amount, result?.held ?? 0, result?.pot ?? 0, result?.won ?? false)
      const wallet = useWallet.getState()
      if (outcome.bet > 0) wallet.settle({ game: 'pot', bet: outcome.bet, payout: outcome.payout, meta: { pot: outcome.pot, share: outcome.share, won: outcome.won } })
      if (outcome.refund > 0) wallet.refund(outcome.refund)
      set(sKey(who, book, round), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, round))
      return { outcome, paid: true }
    })) ?? null
  )
}

/** The round can no longer be looked up: settle it as a loss so the coins show in the history. */
export async function loseRound(who: string, book: Book, round: number): Promise<boolean> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) {
        del(pKey(who, book, round))
        return false
      }
      useWallet.getState().settle({ game: 'pot', bet: e.amount, payout: 0, meta: { expired: true } })
      const outcome: Outcome = { bet: e.amount, payout: 0, refund: 0, won: false, pot: 0, share: 0 }
      set(sKey(who, book, round), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, round))
      return true
    })) ?? false
  )
}

/** Forgets settled markers after a week, by when no browser could still be waiting on those rounds. */
export function pruneSettled() {
  const now = Date.now()
  for (const k of keysWith('lumen.pot.s.')) {
    try {
      const at = Number(JSON.parse(get(k) ?? 'null')?.at)
      if (!(now - at < SETTLED_TTL)) del(k)
    } catch {
      del(k)
    }
  }
}
