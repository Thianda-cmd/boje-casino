import { backend, rpc } from '../../lib/backend'
import { guestId } from '../../lib/identity'
import { safeStorage } from '../../lib/storage'
import { CYCLE_MS, phaseAt, timesFrom, type Phase } from './clock'
import { botsOf, drawOf, newSeed, sha256 } from './fair'
import type { Book } from './ledger'
import { MAX_DEPOSIT, MAX_DEPOSITS, MAX_PER_PLAYER, MIN_DEPOSIT, potOf, ticketsOf, winnerIndex, winningTicket, type Deposit } from './rules'

export { defaultName, guestAvatar, guestId, saveName } from '../../lib/identity'

/* Where Pot Luck's rounds come from: the shared pot in the database when it is reachable (pot_state, pot_bet and
   pot_round_info in api/_lib/schema.js), otherwise a stand-in with the same rules, timetable and house bots in the
   browser, so the game always plays. */

/** a deposit as the feed shows it: `p` numbers the round's players in the order they first paid in */
export interface Dep {
  p: number
  name: string
  avatar: number
  amount: number
  bot: boolean
  me: boolean
  /** server clock when it went in */
  at: number
  /** a signed-in player's: their name opens their public profile (the stand-in marks nobody) */
  acct?: boolean
}
export interface FeedRound {
  id: number
  phase: Phase
  opensAt: number
  startsAt: number
  endsAt: number
  hash: string
  /** the winning ticket, once betting has closed (null for an empty pot) */
  ticket: number | null
  /** revealed once the wheel has landed */
  seed: string | null
}
/** a finished round, for the recent winners */
export interface Winner {
  id: number
  pot: number
  name: string
  avatar: number
  bot: boolean
  /** the winner's coins in the pot */
  amount: number
  players: number
}
export interface Feed {
  /** server clock when the state was read */
  now: number
  round: FeedRound
  /** the deposits so far, in the order paid (a house bot's shows once it is due) */
  deposits: Dep[]
  /** what the server holds of this player's in the round, or null with nothing */
  mine: { amount: number; count: number } | null
  online: number
  /** the newest finished round */
  head: number | null
  /** the last 30 finished rounds, newest first; null when nothing has finished since the round the request named */
  history: Winner[] | null
  /** this player's latest finished rounds with a deposit, for settling a round the browser missed */
  past: { round: number; pot: number; held: number; won: boolean }[]
  /** the unsettled rounds this request asked about (set by the client): every one of them that has finished with a
   *  deposit of this player's is in `past`, so one that has finished and isn't there held nothing of theirs */
  asked: number[]
  /** offline stand-in: how many house bots are in the round */
  bots?: number
}
/** `past` always holds this player's latest finished rounds, up to this many, plus the asked ones */
export const PAST_LIMIT = 20
export const ASK_LIMIT = 50
/** How long a round can still be looked up (an hour short, for clocks that disagree): the database deletes rounds
 *  three days after they finish (_pot_current), the stand-in forgets your deposits 3,000 rounds on (writeBets). */
export const KEEP_MS: Record<Book, number> = { shared: 3 * 86400_000 - 3600_000, local: 3000 * CYCLE_MS - 3600_000 }

export interface RoundInfo {
  id: number
  hash: string
  seed: string
  opensAt: number
  tickets: number
  ticket: number | null
  deposits: Dep[]
}

export type PayResult = { ok: true; round: number; total: number; count: number } | { ok: false; error: string; round?: number }

export interface PotServer {
  online: boolean
  book: Book
  /** `hist` is the newest finished round the caller already has; `open` the rounds it has paid into and not settled */
  state(hist: number | null, open: number[]): Promise<Feed>
  /** pays `amount` into round `round`; throws when the answer is lost */
  pay(round: number, amount: number, name: string, avatar: number): Promise<PayResult>
  roundInfo(round: number): Promise<RoundInfo | null>
}

/** the deposits in the rules' terms: a player is told apart by their number in the round */
export const asDeposits = (ds: readonly Dep[]): (Deposit & { at: number; me: boolean; p: number })[] =>
  ds.map((d) => ({ who: d.me ? 'me' : `p${d.p}`, name: d.name, avatar: d.avatar, amount: d.amount, bot: d.bot, at: d.at, me: d.me, p: d.p }))

/* ---------- the shared pot ---------- */

const n = (v: unknown) => Number(v ?? 0)
const num = (v: unknown) => (v == null ? null : Number(v))
const dep = (d: any): Dep => ({ p: n(d.p), name: String(d.name ?? ''), avatar: n(d.avatar), amount: n(d.amount), bot: !!d.bot, me: !!d.me, at: n(d.at), acct: !!d.acct })

function normalise(raw: any, asked: number[]): Feed {
  if (!raw?.round) throw new Error('no round')
  const r = raw.round
  return {
    now: Number(raw.now),
    round: {
      id: Number(r.id),
      phase: r.phase,
      opensAt: Number(r.opensAt),
      startsAt: Number(r.startsAt),
      endsAt: Number(r.endsAt),
      hash: String(r.hash ?? ''),
      ticket: num(r.ticket),
      seed: r.seed ?? null,
    },
    deposits: (raw.deposits ?? []).map(dep),
    mine: raw.mine ? { amount: n(raw.mine.amount), count: n(raw.mine.count) } : null,
    online: n(raw.online),
    head: num(raw.head),
    history:
      raw.history == null
        ? null
        : raw.history.map((h: any) => ({ id: Number(h.id), pot: n(h.pot), name: String(h.name ?? ''), avatar: n(h.avatar), bot: !!h.bot, amount: n(h.amount), players: n(h.players) })),
    past: (raw.past ?? []).map((p: any) => ({ round: Number(p.round), pot: n(p.pot), held: n(p.held), won: !!p.won })),
    asked,
  }
}

const shared: PotServer = {
  online: true,
  book: 'shared',
  state: async (hist, open) => {
    const asked = open.slice(0, ASK_LIMIT)
    const args: Record<string, unknown> = { p_player: guestId, p_hist: hist }
    if (asked.length) args.p_open = asked
    return normalise(await rpc('pot_state', args, 4500), asked)
  },
  pay: async (round, amount, name, avatar) => {
    const r = await rpc<any>('pot_bet', { p_player: guestId, p_name: name, p_round: round, p_amount: amount, p_avatar: avatar }, 6000)
    return r?.ok ? { ok: true, round: Number(r.round), total: n(r.total), count: n(r.count) } : { ok: false, error: String(r?.error ?? 'error'), round: num(r?.round) ?? undefined }
  },
  roundInfo: async (round) => {
    const r = await rpc<any>('pot_round_info', { p_round: round })
    return r ? { id: Number(r.id), hash: String(r.hash), seed: String(r.seed), opensAt: n(r.opensAt), tickets: n(r.tickets), ticket: num(r.ticket), deposits: (r.deposits ?? []).map(dep) } : null
  },
}

/* ---------- the stand-in ---------- */

/*
  The same rules without the backend. Rounds follow the wall clock (round k opens at EPOCH + k × CYCLE_MS), so every
  tab of this browser, and the same tab after a reload, sees the same round at the same moment. Round k's seed is
  sha256(secret + ':' + k) for a secret kept on this device: committed to by its hash when the round opens and
  revealed once the wheel lands, as online. The house bots follow from the hash (fair.ts botsOf), as online; your
  deposits live in localStorage.

  Dev builds: window.__potForce = 'me' | 'bot' makes the round taking bets draw your ticket (or a bot's) when betting
  closes, by giving it a seed found for that. The round keeps the hash it opened with (so its bots, and the ledger's
  record of it, stay the same), and only its seed check in the fairness panel fails.
*/

const EPOCH = Date.UTC(2026, 9, 1)
const SECRET_KEY = 'lumen.pot.local.secret'
const BETS_KEY = 'lumen.pot.local.bets'
const FORCE_KEY = 'lumen.pot.local.force'

type LocalBet = { name: string; avatar: number; deps: { amount: number; at: number }[] }

/** why a payment can't go in, as the database answers it (rules.ts refuse says it in words) */
export function refuseCode(mine: readonly { amount: number }[], amount: number): string | null {
  if (!(amount >= MIN_DEPOSIT) || amount > MAX_DEPOSIT || Math.round(amount * 100) !== amount * 100) return 'invalid'
  if (mine.length >= MAX_DEPOSITS) return 'count'
  if (mine.reduce((a, d) => a + ticketsOf(d.amount), 0) + ticketsOf(amount) > MAX_PER_PLAYER * 100) return 'limit'
  return null
}

function localServer(): PotServer {
  let secret = safeStorage.getItem(SECRET_KEY)
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    secret = newSeed()
    safeStorage.setItem(SECRET_KEY, secret)
  }
  const key = secret
  const readJson = <T>(k: string, fallback: T): T => {
    try {
      const v = JSON.parse(safeStorage.getItem(k) ?? 'null')
      return v && typeof v === 'object' ? v : fallback
    } catch {
      return fallback
    }
  }
  const forced = (): Record<string, string> => (import.meta.env.DEV ? readJson<Record<string, string>>(FORCE_KEY, {}) : {})
  const natural = (k: number) => sha256(`${key}:${k}`)
  const seedOf = (k: number) => forced()[k] ?? natural(k)
  // the bots follow the hash the round opened with
  const botCache = new Map<number, ReturnType<typeof botsOf>>()
  const botsFor = (k: number) => {
    let b = botCache.get(k)
    if (!b) {
      b = botsOf(sha256(natural(k)))
      botCache.set(k, b)
      if (botCache.size > 200) botCache.delete(botCache.keys().next().value!)
    }
    return b
  }
  const indexAt = (now: number) => Math.floor((now - EPOCH) / CYCLE_MS)
  const timesOf = (k: number) => timesFrom(EPOCH + k * CYCLE_MS)

  // with storage blocked the deposits still last as long as the page
  let memo: Record<string, LocalBet> | null = null
  const readBets = (): Record<string, LocalBet> => readJson<Record<string, LocalBet> | null>(BETS_KEY, null) ?? memo ?? {}
  const writeBets = (b: Record<string, LocalBet>, k: number) => {
    for (const id of Object.keys(b)) if (Number(id) < k - 3000) delete b[id]
    memo = b
    safeStorage.setItem(BETS_KEY, JSON.stringify(b))
  }

  /** round k's deposits up to `now`, in the order paid: the bots as they come due, and yours */
  const depositsOf = (k: number, now: number, bets: Record<string, LocalBet>): Dep[] => {
    const t = timesOf(k)
    const rows: Omit<Dep, 'p'>[] = []
    for (const m of botsFor(k)) if (t.opensAt + m.at <= now) rows.push({ name: m.name, avatar: m.avatar, amount: m.amount, bot: true, me: false, at: t.opensAt + m.at })
    const mine = bets[k]
    if (mine) for (const d of mine.deps) if (d.at <= now) rows.push({ name: mine.name, avatar: mine.avatar, amount: d.amount, bot: false, me: true, at: d.at })
    // in time order, a bot before you in the same millisecond (as its row would have been made first)
    rows.sort((a, b) => a.at - b.at || Number(b.bot) - Number(a.bot))
    const order: string[] = []
    return rows.map((r) => {
      const who = r.me ? 'me' : r.name
      if (!order.includes(who)) order.push(who)
      return { ...r, p: order.indexOf(who) + 1 }
    })
  }
  /** what round k drew, once betting has closed: the pot, the winning ticket and the deposit holding it */
  const drawn = (k: number, bets: Record<string, LocalBet>) => {
    const ds = depositsOf(k, timesOf(k).startsAt, bets)
    const rs = ds.map((d) => ({ who: d.me ? 'me' : `p${d.p}`, name: d.name, avatar: d.avatar, amount: d.amount, bot: d.bot }))
    const total = rs.reduce((a, d) => a + ticketsOf(d.amount), 0)
    const u = drawOf(seedOf(k))
    const index = winnerIndex(rs, u)
    return { ds, pot: potOf(rs), ticket: total ? winningTicket(total, u) : null, index }
  }
  /** dev builds: a seed for round k that draws your ticket ('me') or a bot's */
  const force = (k: number, bets: Record<string, LocalBet>) => {
    if (!import.meta.env.DEV || typeof window === 'undefined') return
    const want = (window as unknown as { __potForce?: 'me' | 'bot' }).__potForce
    if (!want) return
    ;(window as unknown as { __potForce?: unknown }).__potForce = undefined
    const rs = depositsOf(k, timesOf(k).startsAt, bets).map((d) => ({ who: d.me ? 'me' : `p${d.p}`, name: d.name, avatar: d.avatar, amount: d.amount, bot: d.bot }))
    if (!rs.some((d) => (want === 'me' ? d.who === 'me' : d.bot))) return
    for (let i = 0; i < 20000; i++) {
      const s = newSeed()
      const w = rs[winnerIndex(rs, drawOf(s))]
      if (want === 'me' ? w.who === 'me' : w.bot) {
        const map: Record<string, string> = { ...forced(), [k]: s }
        for (const id of Object.keys(map)) if (Number(id) < k - 3000) delete map[id]
        safeStorage.setItem(FORCE_KEY, JSON.stringify(map))
        return
      }
    }
  }
  const winnerCache = new Map<string, Winner>()
  const winnerOf = (k: number, bets: Record<string, LocalBet>): Winner | null => {
    const ck = `${k}:${seedOf(k)}:${bets[k]?.deps.length ?? 0}`
    let w = winnerCache.get(ck)
    if (!w) {
      const d = drawn(k, bets)
      if (d.index < 0) return null
      const win = d.ds[d.index]
      const amount = d.ds.filter((x) => x.p === win.p).reduce((a, x) => a + ticketsOf(x.amount), 0) / 100
      w = { id: k, pot: d.pot, name: win.name, avatar: win.avatar, bot: win.bot, amount, players: new Set(d.ds.map((x) => x.p)).size }
      winnerCache.set(ck, w)
      if (winnerCache.size > 300) winnerCache.delete(winnerCache.keys().next().value!)
    }
    return w
  }

  return {
    online: false,
    book: 'local',
    state: async (hist, open) => {
      const now = Date.now()
      const asked = open.slice(0, ASK_LIMIT)
      const k = indexAt(now)
      const t = timesOf(k)
      const bets = readBets()
      const phase = phaseAt(t, now) as Phase
      if (phase !== 'betting' && !forced()[k]) force(k, bets)
      const deposits = depositsOf(k, now, bets)
      const d = phase === 'betting' ? null : drawn(k, bets)
      const mine = bets[k]?.deps.length ? { amount: bets[k].deps.reduce((a, x) => a + ticketsOf(x.amount), 0) / 100, count: bets[k].deps.length } : null
      const head = phase === 'done' ? k : k - 1
      const history = hist === head ? null : (Array.from({ length: 30 }, (_, i) => winnerOf(head - i, bets)).filter(Boolean) as Winner[])
      // as online: the latest finished rounds with a deposit, and any asked ones
      const finished = Object.keys(bets)
        .map(Number)
        .filter((id) => id <= head && bets[id].deps.length)
        .sort((a, b) => b - a)
      const past = finished
        .filter((id, i) => i < PAST_LIMIT || asked.includes(id))
        .map((id) => {
          const r = drawn(id, bets)
          return { round: id, pot: r.pot, held: bets[id].deps.reduce((a, x) => a + ticketsOf(x.amount), 0) / 100, won: r.index >= 0 && r.ds[r.index].me }
        })
      return {
        now,
        round: { id: k, phase, opensAt: t.opensAt, startsAt: t.startsAt, endsAt: t.endsAt, hash: sha256(natural(k)), ticket: d ? d.ticket : null, seed: phase === 'done' ? seedOf(k) : null },
        deposits,
        mine,
        online: 1 + botsFor(k).length,
        head,
        history,
        past,
        asked,
        bots: botsFor(k).length,
      }
    },
    pay: async (round, amount, name, avatar) => {
      const now = Date.now()
      const k = indexAt(now)
      const amt = Math.round(amount * 100) / 100
      if (round !== k || phaseAt(timesOf(k), now) !== 'betting') return { ok: false, error: 'closed', round: k }
      const bets = readBets()
      const b = bets[k] ?? { name, avatar, deps: [] }
      const why = refuseCode(b.deps, amt)
      if (why) return { ok: false, error: why }
      bets[k] = { name, avatar, deps: [...b.deps, { amount: amt, at: now }] }
      writeBets(bets, k)
      const total = bets[k].deps.reduce((a, x) => a + ticketsOf(x.amount), 0) / 100
      return { ok: true, round: k, total, count: bets[k].deps.length }
    },
    roundInfo: async (id) => {
      if (!Number.isInteger(id) || timesOf(id).endsAt > Date.now()) return null
      const bets = readBets()
      const d = drawn(id, bets)
      const seed = seedOf(id)
      return { id, hash: sha256(natural(id)), seed, opensAt: timesOf(id).opensAt, tickets: d.ds.reduce((a, x) => a + ticketsOf(x.amount), 0), ticket: d.ticket, deposits: d.ds }
    },
  }
}

let standIn: PotServer | null = null
/** The stand-in, made once: it also settles payments from an offline session after the shared pot comes back. */
export const localStandIn = () => (standIn ??= localServer())

/** The shared pot if the database answers, otherwise the stand-in. */
export async function connect(): Promise<PotServer> {
  return (await tryShared()) ?? localStandIn()
}

/** Try the shared pot again (the Retry button when playing solo). */
export async function tryShared(): Promise<PotServer | null> {
  try {
    if (!(await backend())) return null
    await shared.state(null, [])
    return shared
  } catch {
    return null
  }
}
