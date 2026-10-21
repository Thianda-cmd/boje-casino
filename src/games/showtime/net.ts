import { backend, rpc } from '../../lib/backend'
import { guestId } from '../../lib/identity'
import { safeStorage } from '../../lib/storage'
import { BET_MS, phaseAt, stepsOf, timesOf, type Phase, type Times } from './clock'
import { drawFrom, keyOf, newSeed, sha256 } from './fair'
import { cleanStakes, type Book } from './ledger'
import { SPOTS, drawRound, pickOf, type Round, type Spot, type Stakes } from './rules'

export { defaultName, guestAvatar, guestId, saveName } from '../../lib/identity'

/* Where Showtime's rounds come from: the shared show in the database when it is reachable (st_state, st_bet, st_pick
   and st_round_info in api/_lib/schema.js), otherwise a stand-in with the same rules and timetable in the browser,
   where a few house bots put chips on the board. */

/** the most one player may have on a spot in a round */
export const SPOT_LIMIT = 10_000

export interface FeedRound extends Omit<Times, 'bonusAt' | 'playAt'> {
  id: number
  phase: Phase
  hash: string
  /** revealed when betting closes */
  key: string | null
  /** revealed once the picks are in, or when the show ends */
  seed: string | null
}
export interface Feed {
  /** server clock when the state was read */
  now: number
  round: FeedRound
  /** everyone's chips on each spot this round */
  spots: Record<Spot, { total: number; players: number }>
  players: number
  /** this player's stakes this round, or null with none */
  mine: Stakes | null
  /** this player's pick this round (Prize Wall, Mega Spin), as the server holds it */
  pick: number | null
  online: number
  /** the newest finished round */
  head: number | null
  /** the last 50 finished rounds, newest first; null when nothing has finished since the round the request named */
  history: { id: number; seed: string }[] | null
  /** this player's last finished rounds with a bet, for settling a round the browser missed */
  past: { round: number; seed: string; pick: number | null; stakes: Stakes }[]
  /** the unsettled rounds this request asked about (set by the client): every one of them that has finished with a
   *  bet of this player's is in `past`, so one that has finished and isn't there held no bet */
  asked: number[]
  /** offline stand-in: how many house bots are at the table */
  bots?: number
}
/** `past` always holds this player's latest finished rounds, up to this many, plus the asked ones */
export const PAST_LIMIT = 20
export const ASK_LIMIT = 50
/** How long a round can still be looked up (an hour short, for clocks that disagree): the database deletes rounds
 *  three days after they finish (_st_current), the stand-in forgets your bets 3,000 rounds on (writeBets). */
export const KEEP_MS: Record<Book, number> = { shared: 3 * 86400_000 - 3600_000, local: 3000 * 29_000 - 3600_000 }

export interface RoundInfo {
  id: number
  hash: string
  key: string
  seed: string
}

export type BetResult = { ok: true; round: number; held: Stakes } | { ok: false; error: string; round?: number }
export type PickResult = { ok: true; pick: number } | { ok: false; error: string }

export interface ShowtimeServer {
  online: boolean
  book: Book
  /** `hist` is the newest finished round the caller already has; `open` the rounds it has paid into and not settled */
  state(hist: number | null, open: number[]): Promise<Feed>
  /** changes this player's stakes in round `round` (amounts below zero take chips off); throws when the answer is lost */
  bet(round: number, bets: Stakes, name: string, avatar: number): Promise<BetResult>
  pick(round: number, pick: number): Promise<PickResult>
  roundInfo(round: number): Promise<RoundInfo | null>
}

/** a revealed round drawn from its seed: everything it does */
export const roundFromSeed = (seed: string) => drawRound(drawFrom(keyOf(seed)), drawFrom(seed))

/* ---------- the shared show ---------- */

const n = (v: unknown) => Number(v ?? 0)
const num = (v: unknown) => (v == null ? null : Number(v))

function normalise(raw: any, asked: number[]): Feed {
  if (!raw?.round) throw new Error('no round')
  const r = raw.round
  const spots = {} as Feed['spots']
  for (const s of SPOTS) spots[s] = { total: n(raw.spots?.[s]?.total), players: n(raw.spots?.[s]?.players) }
  return {
    now: Number(raw.now),
    round: {
      id: Number(r.id),
      phase: r.phase,
      startsAt: Number(r.startsAt),
      landsAt: Number(r.landsAt),
      picksUntil: num(r.picksUntil),
      endsAt: Number(r.endsAt),
      nextAt: Number(r.nextAt),
      hash: String(r.hash ?? ''),
      key: r.key ?? null,
      seed: r.seed ?? null,
    },
    spots,
    players: n(raw.players),
    mine: raw.mine ? cleanStakes(raw.mine) : null,
    pick: num(raw.pick),
    online: n(raw.online),
    head: num(raw.head),
    history: raw.history == null ? null : raw.history.map((h: any) => ({ id: Number(h.id), seed: String(h.seed) })),
    past: (raw.past ?? []).map((p: any) => ({ round: Number(p.round), seed: String(p.seed), pick: num(p.pick), stakes: cleanStakes(p.stakes) })),
    asked,
  }
}

const shared: ShowtimeServer = {
  online: true,
  book: 'shared',
  state: async (hist, open) => {
    const asked = open.slice(0, ASK_LIMIT)
    const args: Record<string, unknown> = { p_player: guestId, p_hist: hist }
    if (asked.length) args.p_open = asked
    return normalise(await rpc('st_state', args, 4500), asked)
  },
  bet: async (round, bets, name, avatar) => {
    const r = await rpc<any>('st_bet', { p_player: guestId, p_name: name, p_round: round, p_bets: bets, p_avatar: avatar }, 6000)
    return r?.ok ? { ok: true, round: Number(r.round), held: cleanStakes(r.held) } : { ok: false, error: String(r?.error ?? 'error'), round: r?.round == null ? undefined : Number(r.round) }
  },
  pick: async (round, pick) => {
    const r = await rpc<any>('st_pick', { p_player: guestId, p_round: round, p_pick: pick }, 6000)
    return r?.ok ? { ok: true, pick: Number(r.pick) } : { ok: false, error: String(r?.error ?? 'error') }
  },
  roundInfo: async (round) => {
    const r = await rpc<any>('st_round_info', { p_round: round })
    return r ? { id: Number(r.id), hash: String(r.hash), key: String(r.key), seed: String(r.seed) } : null
  },
}

/* ---------- the stand-in ---------- */

/*
  The same rules and timetable without the backend. Round k's seed is sha256(secret + ':' + k) for a secret kept on
  this device, committed to by its hash when the round opens and revealed on the same schedule as online. Each round
  opens when the one before has shown its result, so the rounds are a chain: an anchor in localStorage holds where it
  stands, so every tab of this browser, and the same tab after a reload, sees the same round at the same moment. After
  a long time away a new chain starts (its ids keep counting up, so they never meet an old one's). Your bets and picks
  live in localStorage; the house bots' chips follow from the round's published hash, so they never depend on the
  result.
*/

const EPOCH = Date.UTC(2026, 9, 1)
const SECRET_KEY = 'lumen.showtime.local.secret'
const ANCHOR_KEY = 'lumen.showtime.local.anchor'
const BETS_KEY = 'lumen.showtime.local.bets'
const FORCE_KEY = 'lumen.showtime.local.force'
/** a chain walked further than this from its anchor starts afresh */
const MAX_WALK = 400

interface Anchor {
  /** the chain's first round, and a round of it with when it opened */
  start: number
  id: number
  opensAt: number
}
type LocalBet = { stakes: Stakes; name: string; avatar: number; at: number; pick?: number }
interface LocalRound {
  id: number
  seed: string
  key: string
  hash: string
  round: Round
  times: Times
}

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
]
const BOT_STAKES = [5, 10, 10, 20, 25, 25, 50, 50, 100, 100, 250]
/** where the bots like to put their chips */
const BOT_SPOTS: [Spot, number][] = [
  ['1', 30],
  ['2', 22],
  ['5', 14],
  ['10', 10],
  ['coin', 9],
  ['peg', 6],
  ['wall', 5],
  ['mega', 4],
]

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The house bots' chips for a round, from its hash: three to eight bots, one to three spots each. */
export function botChips(hash: string): { bot: number; spot: Spot; amount: number; at: number }[] {
  const rnd = mulberry32(parseInt(hash.slice(0, 8), 16) || 1)
  const order = BOTS.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const out: { bot: number; spot: Spot; amount: number; at: number }[] = []
  const total = BOT_SPOTS.reduce((a, [, w]) => a + w, 0)
  for (const bot of order.slice(0, 3 + Math.floor(rnd() * 6))) {
    const stake = BOT_STAKES[Math.floor(rnd() * BOT_STAKES.length)]
    const spots = 1 + Math.floor(rnd() * 3)
    for (let k = 0; k < spots; k++) {
      let x = rnd() * total
      const spot = BOT_SPOTS.find(([, w]) => (x -= w) < 0)?.[0] ?? '1'
      out.push({ bot, spot, amount: k ? Math.max(1, Math.round(stake / 2)) : stake, at: 500 + rnd() * (BET_MS - 3000) })
    }
  }
  return out
}

/** dev builds: window.__stForce = spot | { spot, boost } makes the stand-in's next round land there */
function forcedSeed(): string | null {
  if (!import.meta.env.DEV || typeof window === 'undefined') return null
  const w = (window as unknown as { __stForce?: Spot | { spot: Spot; boost?: number } }).__stForce
  if (!w) return null
  ;(window as unknown as { __stForce?: unknown }).__stForce = undefined
  const want = typeof w === 'string' ? { spot: w, boost: 0 } : { spot: w.spot, boost: w.boost ?? 0 }
  for (let i = 0; i < 3_000_000; i++) {
    const s = newSeed()
    const open = drawRound(drawFrom(keyOf(s)), null)
    if (open.spot === want.spot && (!want.boost || (open.booster?.spot === want.spot && open.booster.mult === want.boost))) return s
  }
  return null
}

function localServer(): ShowtimeServer {
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
  const cache = new Map<string, LocalRound>()
  /** round k, opening at opensAt */
  const roundOf = (k: number, opensAt: number): LocalRound => {
    const seed = forced()[k] ?? sha256(`${key}:${k}`)
    const ck = `${k}:${opensAt}:${seed}`
    let r = cache.get(ck)
    if (!r) {
      const round = drawRound(drawFrom(keyOf(seed)), drawFrom(seed))
      r = { id: k, seed, key: keyOf(seed), hash: sha256(seed), round, times: timesOf(round.spot, stepsOf(round), opensAt + BET_MS) }
      cache.set(ck, r)
      if (cache.size > 200) cache.delete(cache.keys().next().value!)
    }
    return r
  }
  /** a fresh chain from now: its ids follow the clock, so they are always past an older chain's */
  const fresh = (now: number, after = 0): Anchor => {
    const id = Math.max(after + 1, Math.floor((now - EPOCH) / 1000))
    return { start: id, id, opensAt: Math.floor(now / 5000) * 5000 }
  }
  /** the round in play at `now`, walking the chain on from its anchor */
  const current = (now: number) => {
    let a = readJson<Anchor | null>(ANCHOR_KEY, null)
    if (!a || !Number.isInteger(a.id) || !Number.isFinite(a.opensAt) || !Number.isInteger(a.start) || a.opensAt > now + 60_000) a = fresh(now, a?.id)
    let r = roundOf(a.id, a.opensAt)
    for (let steps = 0; now >= r.times.nextAt; steps++) {
      if (steps >= MAX_WALK) {
        a = fresh(now, r.id)
        r = roundOf(a.id, a.opensAt)
        break
      }
      r = roundOf(r.id + 1, r.times.nextAt)
    }
    if (r.id !== a.id || r.times.startsAt - BET_MS !== a.opensAt) a = { start: a.start, id: r.id, opensAt: r.times.startsAt - BET_MS }
    safeStorage.setItem(ANCHOR_KEY, JSON.stringify(a))
    return { r, start: a.start }
  }
  const revealAt = (t: Times) => t.picksUntil ?? t.endsAt

  // with storage blocked the bets still last as long as the page
  let memo: Record<string, LocalBet> | null = null
  const readBets = (): Record<string, LocalBet> => {
    const v = readJson<Record<string, LocalBet> | null>(BETS_KEY, null)
    return v ?? memo ?? {}
  }
  const writeBets = (b: Record<string, LocalBet>, k: number) => {
    for (const id of Object.keys(b)) if (Number(id) < k - 3000) delete b[id]
    memo = b
    safeStorage.setItem(BETS_KEY, JSON.stringify(b))
  }

  return {
    online: false,
    book: 'local',
    state: async (hist, open) => {
      const now = Date.now()
      const asked = open.slice(0, ASK_LIMIT)
      let { r, start } = current(now)
      const f = phaseAt(r.times, now) === 'betting' ? forcedSeed() : null
      if (f) {
        // the round taking bets is redrawn (dev builds only)
        const map: Record<string, string> = { ...forced(), [r.id]: f }
        for (const id of Object.keys(map)) if (Number(id) < r.id - 3000) delete map[id]
        safeStorage.setItem(FORCE_KEY, JSON.stringify(map))
        ;({ r, start } = current(now))
      }
      const t = r.times
      const phase = phaseAt(t, now) as Phase
      const bets = readBets()
      const mineBet = bets[r.id]
      const spots = Object.fromEntries(SPOTS.map((s) => [s, { total: 0, players: 0 }])) as Feed['spots']
      const chips = botChips(r.hash)
      const seen = new Set<string>()
      const bettors = new Set<number>()
      for (const ch of chips) {
        if (t.startsAt - BET_MS + ch.at > now) continue
        spots[ch.spot].total += ch.amount
        bettors.add(ch.bot)
        if (!seen.has(`${ch.bot}:${ch.spot}`)) spots[ch.spot].players++
        seen.add(`${ch.bot}:${ch.spot}`)
      }
      const mine = mineBet && Object.keys(mineBet.stakes).length ? cleanStakes(mineBet.stakes) : null
      if (mine)
        for (const s of SPOTS)
          if (mine[s]) {
            spots[s].total = Math.round((spots[s].total + mine[s]!) * 100) / 100
            spots[s].players++
          }
      const done = now >= t.endsAt
      const head = done ? r.id : r.id > start ? r.id - 1 : null
      const history = hist === head || head == null ? (head == null ? [] : null) : Array.from({ length: Math.min(50, head - start + 1) }, (_, i) => ({ id: head - i, seed: sha256(`${key}:${head - i}`) }))
      if (history) for (const h of history) h.seed = forced()[h.id] ?? h.seed
      // as online: the latest finished rounds with a bet, and any asked ones
      const finished = Object.keys(bets)
        .map(Number)
        .filter((id) => (id < r.id || (id === r.id && done)) && Object.keys(bets[id].stakes ?? {}).length)
        .sort((a, b) => b - a)
      const past = finished
        .filter((id, i) => i < PAST_LIMIT || asked.includes(id))
        .map((id) => ({ round: id, seed: forced()[id] ?? sha256(`${key}:${id}`), pick: bets[id].pick ?? null, stakes: cleanStakes(bets[id].stakes) }))
      return {
        now,
        round: { id: r.id, phase, startsAt: t.startsAt, landsAt: t.landsAt, picksUntil: t.picksUntil, endsAt: t.endsAt, nextAt: t.nextAt, hash: r.hash, key: phase === 'betting' ? null : r.key, seed: now >= revealAt(t) ? r.seed : null },
        spots,
        players: bettors.size + (mine ? 1 : 0),
        mine,
        pick: mineBet?.pick ?? null,
        online: 1 + new Set(chips.map((c) => c.bot)).size,
        head,
        history,
        past,
        asked,
        bots: new Set(chips.map((c) => c.bot)).size,
      }
    },
    bet: async (round, adds, name, avatar) => {
      const now = Date.now()
      const { r } = current(now)
      const entries = Object.entries(adds) as [Spot, number][]
      if (!entries.length || entries.some(([s, v]) => !SPOTS.includes(s) || !Number.isFinite(v) || v === 0 || Math.abs(v) > SPOT_LIMIT || Math.round(v * 100) !== v * 100)) return { ok: false, error: 'invalid' }
      if (round !== r.id || phaseAt(r.times, now) !== 'betting') return { ok: false, error: 'closed', round: r.id }
      const bets = readBets()
      const b = bets[r.id] ?? { stakes: {}, name, avatar, at: now }
      const next: Stakes = { ...b.stakes }
      for (const [s, v] of entries) {
        const total = Math.max(0, Math.round(((next[s] ?? 0) + v) * 100) / 100)
        if (total > SPOT_LIMIT) return { ok: false, error: 'limit' }
        if (total > 0) next[s] = total
        else delete next[s]
      }
      bets[r.id] = { ...b, stakes: next, name, avatar }
      writeBets(bets, r.id)
      return { ok: true, round: r.id, held: next }
    },
    pick: async (round, pick) => {
      const now = Date.now()
      const { r } = current(now)
      if (round !== r.id || phaseAt(r.times, now) === 'betting') return { ok: false, error: 'closed' }
      const b = r.round.bonus
      if (!b || (b.kind !== 'wall' && b.kind !== 'mega') || pickOf(b, pick) !== pick) return { ok: false, error: 'invalid' }
      if (now >= r.times.picksUntil!) return { ok: false, error: 'closed' }
      const bets = readBets()
      if (!(bets[r.id]?.stakes?.[r.round.spot]! > 0)) return { ok: false, error: 'none' }
      bets[r.id] = { ...bets[r.id], pick }
      writeBets(bets, r.id)
      return { ok: true, pick }
    },
    roundInfo: async (id) => {
      const now = Date.now()
      const { r, start } = current(now)
      if (!Number.isInteger(id) || id < start || id > r.id || (id === r.id && now < r.times.endsAt)) return null
      const seed = forced()[id] ?? sha256(`${key}:${id}`)
      return { id, hash: sha256(seed), key: keyOf(seed), seed }
    },
  }
}

let standIn: ShowtimeServer | null = null
/** The stand-in, made once: it also settles stakes from an offline session after the shared show comes back. */
export const localStandIn = () => (standIn ??= localServer())

/** The shared show if the database answers, otherwise the stand-in. */
export async function connect(): Promise<ShowtimeServer> {
  return (await tryShared()) ?? localStandIn()
}

/** Try the shared show again (the Retry button when playing solo). */
export async function tryShared(): Promise<ShowtimeServer | null> {
  try {
    if (!(await backend())) return null
    await shared.state(null, [])
    return shared
  } catch {
    return null
  }
}
