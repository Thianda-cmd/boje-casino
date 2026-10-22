import { backend, rpc } from '../../lib/backend'
import { guestId } from '../../lib/identity'
import { safeStorage } from '../../lib/storage'
import { newSeed, rollFromSeed, sha256Hex } from './fair'
import type { Book } from './ledger'
import { BET_MS, COLORS, CYCLE_MS, MAX_STAKE, MIN_STAKE, SPIN_MS, noStakes, phaseAt, type Color, type Phase, type Stakes } from './rules'

export { defaultName, guestAvatar, guestId, saveName } from '../../lib/identity'

/* Where Double's rounds come from: the shared rounds in the database when it is reachable (dbl_state, dbl_bet and
   dbl_round_info in api/_lib/schema.js), otherwise a stand-in with the same rules in the browser, where a few house
   bots keep the columns busy. */

export interface Bettor {
  name: string
  avatar: number
  amount: number
  me: boolean
  /** a signed-in player's bet: their name opens their public profile (the stand-in marks nobody) */
  acct?: boolean
  /** a house bot (offline stand-in only) */
  bot?: boolean
}
export interface Column {
  total: number
  players: number
  /** the 30 biggest bets, biggest first */
  bets: Bettor[]
}
export interface Feed {
  /** server clock when the state was read */
  now: number
  round: { id: number; phase: Phase; startsAt: number; endsAt: number; hash: string; roll: number | null; seed: string | null }
  colors: Record<Color, Column>
  /** this player's bets this round, or null with none */
  mine: Stakes | null
  online: number
  /** the newest round that has landed */
  head: number | null
  /** the last 100 rolls, newest first; null when nothing has landed since the round the request named */
  history: { id: number; roll: number }[] | null
  /** this player's last landed rounds with a bet, for settling a round the browser missed */
  past: ({ round: number; roll: number } & Stakes)[]
  /** the unsettled rounds this request asked about (set by the client, not the server): every one of them that has
   *  landed with a bet of this player's is in `past`, so one that has landed and isn't held no bet */
  asked: number[]
  /** offline stand-in: how many house bots are at the table */
  bots?: number
}
/** `past` always holds this player's latest landed rounds, up to this many, plus the asked ones */
export const PAST_LIMIT = 20
/** at most this many unsettled rounds are asked about in one request (the oldest first) */
export const ASK_LIMIT = 50
/** How long a round can still be looked up (an hour short, for clocks that disagree): the database deletes rounds
 *  three days after they land (_dbl_current), the stand-in forgets your bets 2,000 rounds on (writeBets). */
export const KEEP_MS: Record<Book, number> = { shared: 3 * 86400_000 - 3600_000, local: 2000 * CYCLE_MS - 3600_000 }

export interface RoundInfo {
  id: number
  hash: string
  roll: number
  seed: string
}

export type BetResult = { ok: true; round: number; amount: number } | { ok: false; error: string; round?: number }

export interface DoubleServer {
  online: boolean
  book: Book
  /** `hist` is the newest landed round the caller already has; `open` the rounds it has paid into and not settled */
  state(hist: number | null, open: number[]): Promise<Feed>
  /** adds `amount` to this player's bet on `color` in round `round`; throws when the answer is lost */
  bet(round: number, color: Color, amount: number, name: string, avatar: number): Promise<BetResult>
  roundInfo(round: number): Promise<RoundInfo | null>
}

/* ---------- shared rounds ---------- */

const n = (v: unknown) => Number(v ?? 0)
const stakes = (v: any): Stakes => ({ red: n(v?.red), green: n(v?.green), black: n(v?.black) })

function normalise(raw: any, asked: number[]): Feed {
  if (!raw?.round) throw new Error('no round')
  const colors = {} as Record<Color, Column>
  for (const c of COLORS) {
    const col = raw.colors?.[c]
    colors[c] = {
      total: n(col?.total),
      players: n(col?.players),
      bets: (col?.bets ?? []).map((b: any) => ({ name: String(b.name), avatar: n(b.avatar), amount: n(b.amount), me: !!b.me, acct: !!b.acct })),
    }
  }
  return {
    now: Number(raw.now),
    round: {
      id: Number(raw.round.id),
      phase: raw.round.phase,
      startsAt: Number(raw.round.startsAt),
      endsAt: Number(raw.round.endsAt),
      hash: String(raw.round.hash ?? ''),
      roll: raw.round.roll == null ? null : Number(raw.round.roll),
      seed: raw.round.seed ?? null,
    },
    colors,
    mine: raw.mine ? stakes(raw.mine) : null,
    online: n(raw.online),
    head: raw.head == null ? null : Number(raw.head),
    history: raw.history == null ? null : raw.history.map((h: any) => ({ id: Number(h.id), roll: Number(h.roll) })),
    past: (raw.past ?? []).map((p: any) => ({ round: Number(p.round), roll: Number(p.roll), ...stakes(p) })),
    asked,
  }
}

const shared: DoubleServer = {
  online: true,
  book: 'shared',
  state: async (hist, open) => {
    const asked = open.slice(0, ASK_LIMIT)
    const args: Record<string, unknown> = { p_player: guestId, p_hist: hist }
    if (asked.length) args.p_open = asked
    return normalise(await rpc('dbl_state', args, 4500), asked)
  },
  bet: async (round, color, amount, name, avatar) => {
    const r = await rpc<any>('dbl_bet', { p_player: guestId, p_name: name, p_color: color, p_amount: amount, p_round: round, p_avatar: avatar }, 6000)
    return r?.ok ? { ok: true, round: Number(r.round), amount: Number(r.amount) } : { ok: false, error: String(r?.error ?? 'error'), round: r?.round == null ? undefined : Number(r.round) }
  },
  roundInfo: async (round) => {
    const r = await rpc<any>('dbl_round_info', { p_round: round })
    return r ? { id: Number(r.id), hash: String(r.hash), roll: Number(r.roll), seed: String(r.seed) } : null
  },
}

/* ---------- the stand-in ---------- */

/*
  The same rules without the backend. Rounds follow the wall clock (round k opens at EPOCH + k × 24 s), so every tab of
  this browser, and the same tab after a reload, sees the same round at the same moment. Each round's seed is
  sha256(secret + ':' + k) for a secret kept on this device: it is committed to by its hash when the round opens and
  revealed once the strip lands, as online. Your bets live in localStorage; the house bots' bets follow from the
  round's published hash, so they never depend on the roll.
*/

const EPOCH = Date.UTC(2026, 9, 1)
const SECRET_KEY = 'lumen.double.local.secret'
const BETS_KEY = 'lumen.double.local.bets'

type LocalBet = Stakes & { name: string; avatar: number; at: number }

export const BOTS: readonly { name: string; avatar: number }[] = [
  { name: 'Otis', avatar: 2 },
  { name: 'Hazel', avatar: 5 },
  { name: 'Barnaby', avatar: 9 },
  { name: 'Juniper', avatar: 12 },
  { name: 'Mabel', avatar: 7 },
  { name: 'Pip', avatar: 3 },
  { name: 'Nova', avatar: 14 },
  { name: 'Rocco', avatar: 10 },
  { name: 'Ivy', avatar: 6 },
  { name: 'Felix', avatar: 1 },
  { name: 'Luna', avatar: 13 },
  { name: 'Ziggy', avatar: 15 },
]
const BOT_STAKES = [5, 10, 10, 15, 20, 25, 25, 40, 50, 50, 75, 100, 100, 150, 250, 500]

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface BotChip {
  bot: number
  color: Color
  amount: number
  /** ms after the round opened */
  at: number
}

/** The house bots' chips for a round, from its hash: four to nine bots, mostly on red or black, now and then green. */
export function botChips(hash: string): BotChip[] {
  const rnd = mulberry32(parseInt(hash.slice(0, 8), 16) || 1)
  const order = BOTS.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const count = 4 + Math.floor(rnd() * 6)
  const out: BotChip[] = []
  const last = BET_MS - 1600
  for (const bot of order.slice(0, count)) {
    const stake = BOT_STAKES[Math.floor(rnd() * BOT_STAKES.length)]
    const at = 600 + rnd() * (last - 2400)
    const style = rnd()
    const side: Color = rnd() < 0.5 ? 'red' : 'black'
    if (style < 0.9) out.push({ bot, color: side, amount: stake, at })
    if (style >= 0.78) out.push({ bot, color: 'green', amount: Math.max(1, Math.round(stake / (style >= 0.9 ? 2 : 6))), at: Math.min(last, at + 400 + rnd() * 1800) })
    if (style < 0.9 && rnd() < 0.22) out.push({ bot, color: side, amount: Math.max(1, Math.round(stake / 2)), at: Math.min(last, at + 1500 + rnd() * 5000) })
  }
  return out
}

function localServer(): DoubleServer {
  let secret = safeStorage.getItem(SECRET_KEY)
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    secret = newSeed()
    safeStorage.setItem(SECRET_KEY, secret)
  }
  const key = secret
  const cache = new Map<number, Promise<{ seed: string; hash: string; roll: number }>>()
  const roundOf = (k: number) => {
    let p = cache.get(k)
    if (!p) {
      p = (async () => {
        const seed = await sha256Hex(`${key}:${k}`)
        const [hash, roll] = await Promise.all([sha256Hex(seed), rollFromSeed(seed)])
        return { seed, hash, roll }
      })()
      cache.set(k, p)
      if (cache.size > 360) cache.delete(cache.keys().next().value!)
    }
    return p
  }
  const times = (k: number) => {
    const opens = EPOCH + k * CYCLE_MS
    return { opens, startsAt: opens + BET_MS, endsAt: opens + BET_MS + SPIN_MS }
  }
  const indexAt = (now: number) => Math.floor((now - EPOCH) / CYCLE_MS)

  // with storage blocked the bets still last as long as the page
  let memo: Record<string, LocalBet> | null = null
  const readBets = (): Record<string, LocalBet> => {
    try {
      const v = JSON.parse(safeStorage.getItem(BETS_KEY) ?? 'null')
      if (v && typeof v === 'object') return v
    } catch {
      /* fall through */
    }
    return memo ?? {}
  }
  const writeBets = (b: Record<string, LocalBet>, k: number) => {
    for (const id of Object.keys(b)) if (Number(id) < k - 2000) delete b[id]
    memo = b
    safeStorage.setItem(BETS_KEY, JSON.stringify(b))
  }

  return {
    online: false,
    book: 'local',
    state: async (hist, open) => {
      const now = Date.now()
      const asked = open.slice(0, ASK_LIMIT)
      const k = indexAt(now)
      const t = times(k)
      const cur = await roundOf(k)
      const phase = phaseAt(t, now) as Phase
      const bets = readBets()
      const mineBet = bets[k]
      const colors = {} as Record<Color, Column>
      const chips = botChips(cur.hash)
      for (const c of COLORS) {
        const rows = new Map<number, Bettor & { first: number }>()
        for (const ch of chips) {
          if (ch.color !== c || t.opens + ch.at > now) continue
          const row = rows.get(ch.bot)
          if (row) row.amount += ch.amount
          else rows.set(ch.bot, { name: BOTS[ch.bot].name, avatar: BOTS[ch.bot].avatar, amount: ch.amount, me: false, bot: true, first: ch.at })
        }
        const list: (Bettor & { first: number })[] = [...rows.values()]
        if (mineBet?.[c]) list.push({ name: mineBet.name, avatar: mineBet.avatar, amount: mineBet[c], me: true, first: mineBet.at - t.opens })
        list.sort((a, b) => b.amount - a.amount || a.first - b.first)
        colors[c] = {
          total: Math.round(list.reduce((a, b) => a + b.amount * 100, 0)) / 100,
          players: list.length,
          bets: list.slice(0, 30).map(({ first: _, ...b }) => b),
        }
      }
      const head = phase === 'done' ? k : k - 1
      const history =
        hist === head ? null : await Promise.all(Array.from({ length: 100 }, async (_, i) => ({ id: head - i, roll: (await roundOf(head - i)).roll })))
      // as online: the latest landed rounds with a bet, and any asked ones
      const landed = Object.keys(bets)
        .map(Number)
        .filter((id) => id <= head && COLORS.some((c) => bets[id][c] > 0))
        .sort((a, b) => b - a)
      const pastIds = landed.filter((id, i) => i < PAST_LIMIT || asked.includes(id))
      const past = await Promise.all(pastIds.map(async (id) => ({ round: id, roll: (await roundOf(id)).roll, red: bets[id].red, green: bets[id].green, black: bets[id].black })))
      const botsHere = new Set(chips.map((c) => c.bot)).size
      return {
        now,
        round: { id: k, phase, startsAt: t.startsAt, endsAt: t.endsAt, hash: cur.hash, roll: phase === 'betting' ? null : cur.roll, seed: phase === 'done' ? cur.seed : null },
        colors,
        mine: mineBet && COLORS.some((c) => mineBet[c] > 0) ? { red: mineBet.red, green: mineBet.green, black: mineBet.black } : null,
        online: 1 + botsHere,
        head,
        history,
        past,
        asked,
        bots: botsHere,
      }
    },
    bet: async (round, color, amount, name, avatar) => {
      const now = Date.now()
      const k = indexAt(now)
      const amt = Math.round(amount * 100) / 100
      if (!COLORS.includes(color) || !(amt >= MIN_STAKE && amt <= MAX_STAKE)) return { ok: false, error: 'invalid' }
      if (round !== k || phaseAt(times(k), now) !== 'betting') return { ok: false, error: 'closed', round: k }
      const bets = readBets()
      const b = bets[k] ?? { ...noStakes(), name, avatar, at: now }
      const total = Math.round((b[color] + amt) * 100) / 100
      if (total > MAX_STAKE) return { ok: false, error: 'limit' }
      bets[k] = { ...b, [color]: total, name, avatar }
      writeBets(bets, k)
      return { ok: true, round: k, amount: total }
    },
    roundInfo: async (id) => {
      if (!Number.isInteger(id) || times(id).endsAt > Date.now()) return null
      const r = await roundOf(id)
      return { id, hash: r.hash, roll: r.roll, seed: r.seed }
    },
  }
}

let standIn: DoubleServer | null = null
/** The stand-in, made once: it also settles stakes from an offline session after the shared rounds come back. */
export const localStandIn = () => (standIn ??= localServer())

/** The shared rounds if the database answers, otherwise the stand-in. */
export async function connect(): Promise<DoubleServer> {
  return (await tryShared()) ?? localStandIn()
}

/** Try the shared rounds again (the Retry button when playing solo). */
export async function tryShared(): Promise<DoubleServer | null> {
  try {
    if (!(await backend())) return null
    await shared.state(null, [])
    return shared
  } catch {
    return null
  }
}
