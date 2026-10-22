import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import { revealAt } from './clock'
import { OPEN_PREFIX } from './open'
import { keyOf } from './fair'
import { drawFight } from './fight'
import { drawResult, hitsOf, matchupOf, metaOf, oddsOf, payoutOf } from './rules'
import { SELS, type Matchup, type Result, type Sel, type Stakes } from './types'

/*
  Kaiju Clash's stake ledger, the scheme of Showtime's (src/games/showtime/ledger.ts). A chip leaves the wallet when
  its bet is sent, before the server answers, so every round this browser has paid into is written down here,
  selection by selection, until it settles: across reloads, other tabs and rounds that ended while the player was
  away. One localStorage key per round per player and book, plus a marker once it is settled holding the outcome and
  the round's hash. Every credit runs under a Web Lock and checks the marker, so two tabs never pay a round twice.

  A round settles on what this browser paid and what the server holds (outcomeOf): a chip the server never took, or
  took off again, comes back, and nothing is paid on a chip this browser didn't pay for. The fight is drawn from the
  round's key (rules.ts drawResult), which is out from the moment betting closes, so the round on show settles as soon
  as the show has told how it ended (resultAt: the K.O. or SPLASH banner, or the judges' verdict); a round missed while away
  settles from the server's account of it (`past`: the seed and what it held), flagged recovered; one that can no
  longer be looked up (KEEP_MS) is settled as lost, so the stake still shows in the history.
*/

/** whose rounds: 'shared' for the database's, 'local' for the stand-in's (the same ids, kept apart by the book) */
export type Book = 'shared' | 'local'

/** How long a round can still be looked up (an hour short, for clocks that disagree): the database deletes rounds three
 *  days after they end (_kj_current), and the stand-in keeps your bets as long (net.ts). */
export const KEEP_MS: Record<Book, number> = { shared: 3 * 86400_000 - 3600_000, local: 3 * 86400_000 - 3600_000 }

interface Entry {
  stakes: Stakes
  at: number
  /** the round's published hash: a round id only names the same round while the database lives */
  hash: string
}

export interface Outcome {
  round: number
  matchup: Matchup
  /** the stakes that reached the fight: what this browser paid, capped by what the server holds */
  landed: Stakes
  bet: number
  /** paid back, stakes included (rules.ts payoutOf) */
  payout: number
  /** payout − bet */
  net: number
  /** paid but never on the board: goes back to the wallet */
  refund: number
  /** how the fight came out (null: none of the stakes reached it, or the round expired) */
  result: Result | null
  /** every selection that won in this fight (the board lights them) */
  hits: Sel[]
  /** the player's selections that won */
  won: Sel[]
  /** settled from the server's account of a round this browser didn't see end */
  recovered: boolean
  /** too old to look up: settled as lost */
  expired: boolean
}
export interface Settled {
  at: number
  outcome: Outcome
  hash: string
}

const cents = (n: number) => Math.round(n * 100)
/** the coins on a set of stakes, to the cent */
export const stakeTotal = (s: Stakes) => SELS.reduce((a, k) => a + cents(s[k] ?? 0), 0) / 100

/** stakes as stored: positive amounts on known selections */
export function cleanStakes(v: unknown): Stakes {
  const out: Stakes = {}
  if (v && typeof v === 'object')
    for (const s of SELS) {
      const n = Number((v as Record<string, unknown>)[s])
      if (Number.isFinite(n) && n > 0) out[s] = cents(n) / 100
    }
  return out
}

/** what reached the fight: each selection's stake as paid, capped by what the server holds */
export function capStakes(paid: Stakes, held: Stakes): Stakes {
  const out: Stakes = {}
  for (const s of SELS) {
    const v = Math.max(0, Math.min(cents(paid[s] ?? 0), cents(held[s] ?? 0))) / 100
    if (v > 0) out[s] = v
  }
  return out
}

/** Settles one round for this browser: only what it paid and the server holds is played, and the rest comes back. */
export function outcomeOf(id: number, paid: Stakes, held: Stakes, r: Result | null, recovered = false): Outcome {
  const m = matchupOf(id)
  const landed = r ? capStakes(paid, held) : {}
  const bet = stakeTotal(landed)
  const odds = oddsOf(m.a, m.b)
  const hits = r ? hitsOf(r, odds.line) : []
  const payout = r && bet > 0 ? payoutOf(landed, r, odds) : 0
  return {
    round: id,
    matchup: m,
    landed,
    bet,
    payout,
    net: (cents(payout) - cents(bet)) / 100,
    refund: Math.max(0, cents(stakeTotal(paid)) - cents(bet)) / 100,
    result: r,
    hits,
    won: hits.filter((s) => (landed[s] ?? 0) > 0),
    recovered,
    expired: false,
  }
}

/**
 * When round `id`'s result is shown on stage, on the server clock (clock.ts revealAt): the K.O. or SPLASH banner after the
 * finish, or the judges' verdict after the final bell. Its result can be known earlier (from the key, as betting closes),
 * but nobody is paid, and no balance moves, ahead of the show.
 */
export function resultAt(fightAt: number, endsAt: number, id: number, key: string): number {
  try {
    return revealAt(fightAt, Math.min(endsAt - fightAt, drawFight(key, matchupOf(id)).endsAt))
  } catch {
    return revealAt(fightAt, endsAt - fightAt)
  }
}

const P = OPEN_PREFIX
const S = 'lumen.kaiju.s.'
const pKey = (who: string, book: Book, round: number) => `${P}${who}.${book}:${round}`
const sKey = (who: string, book: Book, round: number) => `${S}${who}.${book}:${round}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's stakes
const durable = (() => {
  try {
    localStorage.setItem('lumen.kaiju.probe', '1')
    localStorage.removeItem('lumen.kaiju.probe')
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
    return v && typeof v.stakes === 'object' && typeof v.hash === 'string' ? { stakes: cleanStakes(v.stakes), at: Number(v.at) || 0, hash: v.hash } : null
  } catch {
    return null
  }
}
const write = (who: string, book: Book, round: number, e: Entry) => (stakeTotal(e.stakes) > 0 ? set(pKey(who, book, round), JSON.stringify(e)) : del(pKey(who, book, round)))

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
/** What this browser has on each selection in a round it hasn't settled. */
export const stakeOf = (who: string, book: Book, round: number): Stakes => read(who, book, round)?.stakes ?? {}

/** Rounds with stakes waiting to settle, oldest first. */
export function openRounds(who: string, book: Book): number[] {
  const prefix = `${P}${who}.${book}:`
  return keysWith(prefix)
    .map((k) => Number(k.slice(prefix.length)))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
}
/** Whether this player has a stake waiting anywhere (for a background settler such as App.tsx's). */
export const hasOpen = (who: string) => openRounds(who, 'shared').length > 0 || openRounds(who, 'local').length > 0

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
  for (const s of SELS) if ((adds[s] ?? 0) > 0) next.stakes[s] = (cents(next.stakes[s] ?? 0) + cents(adds[s]!)) / 100
  write(who, book, round, next)
}

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.kaiju.ledger', () => fn())
  return typeof document !== 'undefined' && document.hasFocus() ? fn() : undefined
}

/** The server refused chips: give them back (never more than this browser has on each selection). Returns how much. */
export async function refundStakes(who: string, book: Book, round: number, amounts: Stakes): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      let back = 0
      for (const s of SELS) {
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
 * The server took chips off (`removed`, selection by selection): what this browser paid beyond what the server now
 * holds comes back, up to what was taken off (chips sent after it may not have reached the server yet). Returns how much.
 */
export async function trimTo(who: string, book: Book, round: number, held: Stakes, removed: Stakes): Promise<number> {
  return (
    (await withLedger(() => {
      const e = read(who, book, round)
      if (!e || settledOf(who, book, round, e.hash)) return 0
      let back = 0
      for (const s of SELS) {
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
 * Settles a round once: `r` is how its fight came out (null: none of the stakes can have reached it, so they all come
 * back), `held` the player's stakes as the server holds them. Returns the outcome, and whether this call paid it
 * (false when another tab or an earlier call already had); null when there is nothing of this browser's to settle.
 */
export async function settleRound(who: string, book: Book, id: number, r: Result | null, held: Stakes | null, recovered = false): Promise<{ outcome: Outcome; paid: boolean } | null> {
  return (
    (await withLedger(() => {
      const e = read(who, book, id)
      const done = settledOf(who, book, id, e?.hash)
      if (done) {
        del(pKey(who, book, id))
        return { outcome: done.outcome, paid: false }
      }
      if (!e) return null
      const outcome = outcomeOf(id, e.stakes, held ?? {}, r, recovered)
      const wallet = useWallet.getState()
      if (outcome.bet > 0 && r) {
        const meta = metaOf(id, outcome.matchup, r, oddsOf(outcome.matchup.a, outcome.matchup.b), outcome.landed)
        wallet.settle({ game: 'kaiju', bet: outcome.bet, payout: outcome.payout, meta: recovered ? { ...meta, recovered: true } : { ...meta } })
      }
      if (outcome.refund > 0) wallet.refund(outcome.refund)
      set(sKey(who, book, id), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, id))
      return { outcome, paid: true }
    })) ?? null
  )
}

/** The round can no longer be looked up: settle it as lost so the stake shows in the history. True if this call did. */
export async function loseRound(who: string, book: Book, id: number): Promise<Outcome | null> {
  return (
    (await withLedger(() => {
      const e = read(who, book, id)
      if (!e || settledOf(who, book, id, e.hash)) {
        del(pKey(who, book, id))
        return null
      }
      const bet = stakeTotal(e.stakes)
      if (bet > 0) useWallet.getState().settle({ game: 'kaiju', bet, payout: 0, meta: { expired: true, round: id } })
      const outcome: Outcome = { ...outcomeOf(id, e.stakes, e.stakes, null), landed: e.stakes, bet, net: -bet, refund: 0, expired: true }
      set(sKey(who, book, id), JSON.stringify({ at: Date.now(), outcome, hash: e.hash } satisfies Settled))
      del(pKey(who, book, id))
      return outcome
    })) ?? null
  )
}

/**
 * A guest signed up and the account took the guest's wallet over (lib/account.ts carried): the stakes the guest still
 * had waiting were paid from that wallet, which is the account's now. The server holds them in the guest's name, which
 * the account can't ask about, so they come back to it (call this with the account's wallet loaded). Returns how much.
 */
export async function refundGuest(before: number): Promise<number> {
  return (
    (await withLedger(() => {
      let back = 0
      for (const book of ['shared', 'local'] as const)
        for (const id of openRounds('guest', book)) {
          const e = read('guest', book, id)
          if (!e || e.at > before) continue
          if (!settledOf('guest', book, id, e.hash)) back += cents(stakeTotal(e.stakes))
          del(pKey('guest', book, id))
        }
      if (back > 0) useWallet.getState().refund(back / 100)
      return back / 100
    })) ?? 0
  )
}

/** Forgets settled markers after a week, by when no browser could still be waiting on those rounds. */
export function pruneSettled() {
  const now = Date.now()
  for (const k of keysWith(S)) {
    try {
      const at = Number(JSON.parse(get(k) ?? 'null')?.at)
      if (!(now - at < SETTLED_TTL)) del(k)
    } catch {
      del(k)
    }
  }
}

/* ---------------- settling from a feed ---------------- */

/** what settling needs of a feed (net.ts Feed) */
export interface FeedView {
  /** server clock when the state was read */
  now: number
  round: { id: number; hash: string; key: string | null; closesAt: number; fightAt: number; endsAt: number }
  /** the player's stakes in this round as the server holds them */
  mine: Stakes | null
  past: { round: number; seed: string; hash: string; stakes: Stakes }[]
  asked: number[]
}
export type Settlement = { book: Book; round: number; outcome: Outcome; paid: boolean; live: boolean }

/**
 * Settles what `f` can tell about this player's open rounds in `book`; `est` is the server clock now. The round on show
 * settles once its stakes are final (the feed is from after the close) and the stage has shown its result; an
 * older one from `past`; one the server was asked about and holds nothing of the player's gives the coins back; one
 * too old to look up is lost; one ahead of the server's (a clock far off, or a database reset) comes back after ten
 * minutes. Safe to call any time, from any tab.
 */
export async function settleFrom(who: string, book: Book, f: FeedView, est: number): Promise<Settlement[]> {
  const out: Settlement[] = []
  for (const id of openRounds(who, book)) {
    let res: { outcome: Outcome; paid: boolean } | null = null
    let live = false
    if (id === f.round.id) {
      const r = f.round
      if (!r.key || f.now < r.closesAt || est < resultAt(r.fightAt, r.endsAt, id, r.key)) continue
      const h = hashOf(who, book, id)
      const m = matchupOf(id)
      res = h && h !== r.hash ? await settleRound(who, book, id, null, null) : await settleRound(who, book, id, drawResult(r.key, m.a, m.b), f.mine ?? {})
      live = true
    } else if (id < f.round.id) {
      const p = f.past.find((x) => x.round === id)
      const h = hashOf(who, book, id)
      if (p) {
        const m = matchupOf(id)
        res = h && p.hash && h !== p.hash ? await settleRound(who, book, id, null, null) : await settleRound(who, book, id, drawResult(keyOf(p.seed), m.a, m.b), p.stakes, true)
      } else if (Date.now() - ageOf(who, book, id) > KEEP_MS[book]) {
        // so old the round may have been cleared away: there is no telling what happened
        const o = await loseRound(who, book, id)
        if (o) out.push({ book, round: id, outcome: o, paid: true, live: false })
        continue
      }
      // asked about, finished, and holding nothing of the player's: none of it reached the fight (a round this request
      // didn't ask about is asked about on the next one)
      else if (f.asked.includes(id)) res = await settleRound(who, book, id, null, null)
    } else if (Date.now() - ageOf(who, book, id) > 10 * 60_000) res = await settleRound(who, book, id, null, null)
    if (res) out.push({ book, round: id, ...res, live })
  }
  return out
}
