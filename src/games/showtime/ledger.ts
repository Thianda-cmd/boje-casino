import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import { SPOTS, boostOf, pickOf, settle, stakeTotal, type Round, type Spot, type Stakes } from './rules'

/*
  Showtime's stake ledger, the same scheme as Double's (src/games/double/ledger.ts). A chip leaves the wallet when its
  bet is sent, before the server answers, so every round this browser has paid into is written down here, spot by
  spot, until it settles: across reloads, other tabs and rounds missed while away from the game. One localStorage key
  per round, plus a marker once it is settled holding the outcome. Every credit runs under a Web Lock and checks the
  marker, so two tabs never pay a round twice. A round settles on what this browser paid and what the server holds
  (outcomeOf), so a chip the server never took, or took off again, comes back, and nothing is paid on a chip this
  browser didn't pay for.
*/

/** whose rounds: 'shared' for the database's, 'local' for the stand-in's (their ids never meet: see net.ts) */
export type Book = 'shared' | 'local'

interface Entry {
  stakes: Stakes
  at: number
  /** the round's published hash: a round id only names the same round while the database lives */
  hash: string
}
export interface Outcome {
  /** the stakes that reached the table: what this browser paid, capped by what the server holds */
  landed: Stakes
  bet: number
  payout: number
  /** paid but never on the table: goes back to the wallet */
  refund: number
  spot: Spot
  /** what the winning spot paid to 1, for this player's pick */
  win: number
  boosted: boolean
  /** the tile or flapper played in a Prize Wall or Mega Spin (null in the other rounds) */
  pick: number | null
}
export interface Settled {
  at: number
  outcome: Outcome
  hash: string
}

const cents = (n: number) => Math.round(n * 100)

/** Settles one round for this browser: only what it paid and the server holds is played, and the rest comes back. */
export function outcomeOf(paid: Stakes, held: Stakes, round: Round, pick: number | null): Outcome {
  const landed: Stakes = {}
  for (const s of SPOTS) {
    const v = Math.max(0, Math.min(cents(paid[s] ?? 0), cents(held[s] ?? 0))) / 100
    if (v > 0) landed[s] = v
  }
  const bet = stakeTotal(landed)
  const b = round.bonus
  const played = b && (b.kind === 'wall' || b.kind === 'mega') ? pickOf(b, pick) : null
  const r = settle(landed, round, played)
  return { landed, bet, payout: r.ret, refund: Math.max(0, cents(stakeTotal(paid)) - cents(bet)) / 100, spot: round.spot, win: r.win, boosted: boostOf(round) > 1, pick: played }
}

const pKey = (who: string, book: Book, round: number) => `lumen.showtime.p.${who}.${book}:${round}`
const sKey = (who: string, book: Book, round: number) => `lumen.showtime.s.${who}.${book}:${round}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's stakes
const durable = (() => {
  try {
    localStorage.setItem('lumen.showtime.probe', '1')
    localStorage.removeItem('lumen.showtime.probe')
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

/** stakes as stored: positive amounts on known spots */
export function cleanStakes(v: unknown): Stakes {
  const out: Stakes = {}
  if (v && typeof v === 'object') for (const s of SPOTS) if (typeof (v as Stakes)[s] === 'number' && (v as Stakes)[s]! > 0) out[s] = (v as Stakes)[s]
  return out
}

function read(who: string, book: Book, round: number): Entry | null {
  try {
    const v = JSON.parse(get(pKey(who, book, round)) ?? 'null')
    return v && typeof v.stakes === 'object' && typeof v.hash === 'string' ? { stakes: cleanStakes(v.stakes), at: Number(v.at) || 0, hash: v.hash } : null
  } catch {
    return null
  }
}
const write = (who: string, book: Book, round: number, e: Entry) =>
  stakeTotal(e.stakes) > 0 ? set(pKey(who, book, round), JSON.stringify(e)) : del(pKey(who, book, round))

/** The marker of a settled round, if it is this round's (`hash`, when known) and not a namesake's from an older database. */
export function settledOf(who: string, book: Book, round: number, hash?: string): Settled | null {
  try {
    const v = JSON.parse(get(sKey(who, book, round)) ?? 'null')
    return v && v.outcome && (!hash || !v.hash || v.hash === hash) ? v : null
  } catch {
    return null
  }
}

/** The published hash a stake was placed under ('' if unknown). */
export const hashOf = (who: string, book: Book, round: number) => read(who, book, round)?.hash ?? ''
/** When a stake was first placed (0 if unknown). */
export const ageOf = (who: string, book: Book, round: number) => read(who, book, round)?.at ?? 0

/** What this browser has on each spot in a round it hasn't settled. */
export const stakeOf = (who: string, book: Book, round: number): Stakes => read(who, book, round)?.stakes ?? {}

/** Rounds with stakes waiting to settle, oldest first. */
export function openRounds(who: string, book: Book): number[] {
  const prefix = `lumen.showtime.p.${who}.${book}:`
  return keysWith(prefix)
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
}

/** Records chips. Call it in the same task as the wallet deduction, before the request goes out. */
export function addStakes(who: string, book: Book, round: number, hash: string, adds: Stakes) {
  let e = read(who, book, round)
  if (e && e.hash && e.hash !== hash) {
    // a stake on a namesake round of a database that has since been reset: it can never settle, so it comes back
    const back = stakeTotal(e.stakes)
    if (back > 0) useWallet.getState().refund(back)
    e = null
  }
  if (get(sKey(who, book, round)) != null && !settledOf(who, book, round, hash)) del(sKey(who, book, round))
  const next = e ?? { stakes: {}, at: Date.now(), hash }
  for (const s of SPOTS) if ((adds[s] ?? 0) > 0) next.stakes[s] = (cents(next.stakes[s] ?? 0) + cents(adds[s]!)) / 100
  write(who, book, round, next)
}

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.showtime.ledger', () => fn())
  return document.hasFocus() ? fn() : undefined
}

/** The server refused chips: give them back (never more than this browser has on each spot). */
export async function refundStakes(who: string, book: Book, round: number, amounts: Stakes): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      let back = 0
      for (const s of SPOTS) {
        const b = Math.min(cents(amounts[s] ?? 0), cents(e.stakes[s] ?? 0))
        if (b <= 0) continue
        back += b
        e.stakes[s] = (cents(e.stakes[s]!) - b) / 100
        if (!(e.stakes[s]! > 0)) delete e.stakes[s]
      }
      if (back > 0) useWallet.getState().refund(back / 100)
      write(who, book, round, e)
      return back / 100
    })) ?? 0
  )
}

/**
 * The server took chips off (`removed`, spot by spot): what this browser paid beyond what the server now holds comes
 * back, up to what was taken off (chips sent after it may not have reached the server yet). Returns how much.
 */
export async function trimTo(who: string, book: Book, round: number, held: Stakes, removed: Stakes): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      let back = 0
      for (const s of SPOTS) {
        const over = Math.min(cents(removed[s] ?? 0), cents(e.stakes[s] ?? 0) - cents(held[s] ?? 0))
        if (over <= 0) continue
        back += over
        e.stakes[s] = (cents(e.stakes[s]!) - over) / 100
        if (!(e.stakes[s]! > 0)) delete e.stakes[s]
      }
      if (back > 0) useWallet.getState().refund(back / 100)
      write(who, book, round, e)
      return back / 100
    })) ?? 0
  )
}

/**
 * Settles a round once: `round` is the revealed round, `pick` this player's pick as the server holds it, `held` their
 * stakes there (null: nothing reached it). Returns the outcome, and whether this call paid it (false when another tab
 * or an earlier call already had).
 */
export async function settleRound(who: string, book: Book, id: number, round: Round, pick: number | null, held: Stakes | null): Promise<{ outcome: Outcome; paid: boolean } | null> {
  return (
    (await withLedger(() => {
      const e = read(who, book, id)
      const done = settledOf(who, book, id, e?.hash)
      if (done) {
        del(pKey(who, book, id))
        return { outcome: done.outcome, paid: false }
      }
      if (!e) return null
      const outcome = outcomeOf(e.stakes, held ?? {}, round, pick)
      const wallet = useWallet.getState()
      if (outcome.bet > 0) {
        wallet.settle({
          game: 'showtime',
          bet: outcome.bet,
          payout: outcome.payout,
          meta: { spot: outcome.spot, win: outcome.win, boosted: outcome.boosted, boost: boostOf(round), bonus: !!round.bonus, round: id },
        })
      }
      if (outcome.refund > 0) wallet.refund(outcome.refund)
      set(sKey(who, book, id), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, id))
      return { outcome, paid: true }
    })) ?? null
  )
}

/** The round can no longer be looked up: settle it as a loss so the stake shows in the history. */
export async function loseRound(who: string, book: Book, id: number): Promise<boolean> {
  return (
    (await withLedger(() => {
      const e = read(who, book, id)
      if (!e || settledOf(who, book, id, e.hash)) {
        del(pKey(who, book, id))
        return false
      }
      const bet = stakeTotal(e.stakes)
      if (bet > 0) useWallet.getState().settle({ game: 'showtime', bet, payout: 0, meta: { expired: true, round: id } })
      const outcome: Outcome = { landed: e.stakes, bet, payout: 0, refund: 0, spot: '1', win: 0, boosted: false, pick: null }
      set(sKey(who, book, id), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, id))
      return true
    })) ?? false
  )
}

/** Forgets settled markers after a week, by when no browser could still be waiting on those rounds. */
export function pruneSettled() {
  const now = Date.now()
  for (const k of keysWith('lumen.showtime.s.')) {
    try {
      const at = Number(JSON.parse(get(k) ?? 'null')?.at)
      if (!(now - at < SETTLED_TTL)) del(k)
    } catch {
      del(k)
    }
  }
}
