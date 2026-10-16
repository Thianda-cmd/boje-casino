import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import { COLORS, noStakes, outcomeOf, type Color, type Outcome, type Stakes } from './rules'

/*
  Double's stake ledger. A chip leaves the wallet when its bet is sent, before the server answers, so every round this
  browser has paid into is written down here, per colour, until it is settled: across reloads, other tabs and rounds
  missed while away from the game. One localStorage key per round, plus a marker once it is settled holding the
  outcome. Every credit runs under a Web Lock and checks the marker, so two tabs never pay a round twice. A round
  settles on what this browser paid and the server holds (rules.ts outcomeOf), so a chip the server never took comes
  back, and nothing is paid on a chip this browser didn't pay for.
*/

/** whose rounds: 'shared' for the database's, 'local' for the stand-in's (its ids follow the clock, so they never meet) */
export type Book = 'shared' | 'local'

interface Entry extends Stakes {
  at: number
  /** the round's published hash: a round id only names the same round while the database lives */
  hash: string
}
export interface Settled {
  at: number
  outcome: Outcome
  roll: number
  hash: string
}

const pKey = (who: string, book: Book, round: number) => `lumen.double.p.${who}.${book}:${round}`
const sKey = (who: string, book: Book, round: number) => `lumen.double.s.${who}.${book}:${round}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's stakes
const durable = (() => {
  try {
    localStorage.setItem('lumen.double.probe', '1')
    localStorage.removeItem('lumen.double.probe')
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
    return v && COLORS.every((c) => typeof v[c] === 'number') ? v : null
  } catch {
    return null
  }
}

/** The marker of a settled round, if it is this round's (`hash`, when known) and not a namesake's from an older database. */
export function settledOf(who: string, book: Book, round: number, hash?: string): Settled | null {
  try {
    const v = JSON.parse(get(sKey(who, book, round)) ?? 'null')
    return v && v.outcome && typeof v.roll === 'number' && (!hash || !v.hash || v.hash === hash) ? v : null
  } catch {
    return null
  }
}

/** The published hash a stake was placed under ('' if unknown). */
export const hashOf = (who: string, book: Book, round: number) => read(who, book, round)?.hash ?? ''
/** When a stake was first placed (0 if unknown). */
export const ageOf = (who: string, book: Book, round: number) => read(who, book, round)?.at ?? 0

/** What this browser has on each colour in a round it hasn't settled. */
export function stakeOf(who: string, book: Book, round: number): Stakes {
  const e = read(who, book, round)
  return e ? { red: e.red, green: e.green, black: e.black } : noStakes()
}

/** Rounds with stakes waiting to settle, oldest first. */
export function openRounds(who: string, book: Book): number[] {
  const prefix = `lumen.double.p.${who}.${book}:`
  return keysWith(prefix)
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
}

/** Records a chip. Call it in the same task as the wallet deduction, before the request goes out. */
export function addStake(who: string, book: Book, round: number, hash: string, color: Color, amount: number) {
  let e = read(who, book, round)
  if (e && e.hash && e.hash !== hash) {
    // a stake on a namesake round of a database that has since been reset: it can never settle, so it comes back
    const back = Math.round((e.red + e.green + e.black) * 100) / 100
    if (back > 0) useWallet.getState().refund(back)
    e = null
  }
  if (get(sKey(who, book, round)) != null && !settledOf(who, book, round, hash)) del(sKey(who, book, round))
  const next = e ?? { ...noStakes(), at: Date.now(), hash }
  next[color] = Math.round((next[color] + amount) * 100) / 100
  set(pKey(who, book, round), JSON.stringify(next))
}

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.double.ledger', () => fn())
  return document.hasFocus() ? fn() : undefined
}

/** The server refused a chip: give it back (never more than this browser staked on that colour). */
export async function refundChip(who: string, book: Book, round: number, color: Color, amount: number): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      const back = Math.min(Math.round(amount * 100), Math.round(e[color] * 100)) / 100
      if (back <= 0) return 0
      useWallet.getState().refund(back)
      e[color] = Math.round((e[color] - back) * 100) / 100
      if (COLORS.some((c) => e[c] > 0)) set(pKey(who, book, round), JSON.stringify(e))
      else del(pKey(who, book, round))
      return back
    })) ?? 0
  )
}

/**
 * Settles a round once: `held` is what the server has on this player's name (null: nothing reached it). Returns the
 * outcome, and whether this call paid it (false when another tab or an earlier call already had).
 */
export async function settleRound(who: string, book: Book, round: number, roll: number, held: Stakes | null): Promise<{ outcome: Outcome; paid: boolean } | null> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      const done = settledOf(who, book, round, e?.hash)
      if (done) {
        del(pKey(who, book, round))
        return { outcome: done.outcome, paid: false }
      }
      if (!e) return null
      const outcome = outcomeOf(e, held ?? noStakes(), roll)
      const wallet = useWallet.getState()
      if (outcome.bet > 0) {
        wallet.settle({
          game: 'double',
          bet: outcome.bet,
          payout: outcome.payout,
          meta: { green: outcome.green, colors: COLORS.filter((c) => outcome.landed[c] > 0).join('+'), roll },
        })
      }
      if (outcome.refund > 0) wallet.refund(outcome.refund)
      set(sKey(who, book, round), JSON.stringify({ at: Date.now(), outcome, roll, hash: e.hash } satisfies Settled))
      del(pKey(who, book, round))
      return { outcome, paid: true }
    })) ?? null
  )
}

/** The round can no longer be looked up: settle it as a loss so the stake shows in the history. */
export async function loseRound(who: string, book: Book, round: number): Promise<boolean> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) {
        del(pKey(who, book, round))
        return false
      }
      const bet = Math.round((e.red + e.green + e.black) * 100) / 100
      const wallet = useWallet.getState()
      if (bet > 0) wallet.settle({ game: 'double', bet, payout: 0, meta: { expired: true } })
      const outcome: Outcome = { landed: { red: e.red, green: e.green, black: e.black }, bet, payout: 0, refund: 0, color: 'red', green: false }
      set(sKey(who, book, round), JSON.stringify({ at: Date.now(), roll: -1, outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, round))
      return true
    })) ?? false
  )
}

/** Forgets settled markers after a week, by when no browser could still be waiting on those rounds. */
export function pruneSettled() {
  const now = Date.now()
  for (const k of keysWith('lumen.double.s.')) {
    try {
      const at = Number(JSON.parse(get(k) ?? 'null')?.at)
      if (!(now - at < SETTLED_TTL)) del(k)
    } catch {
      del(k)
    }
  }
}
