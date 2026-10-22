import { backend, rpc } from '../../lib/backend'
import { guestId } from '../../lib/identity'
import { safeStorage } from '../../lib/storage'
import { BET_MS, CLOSE_MS, CYCLE_MS, phaseAt, roundAt, timesOf, type Phase, type Times } from './clock'
import { keyOf, newSeed, sha256 } from './fair'
import { fmt } from '../../lib/format'
import { cleanStakes, openRounds, settleFrom, type Book, type Settlement } from './ledger'
import { STAKE_LIMIT, drawResult, fighter, matchupOf, oddsOf } from './rules'
import { SELS, isSel, marketOf, type Market, type Matchup, type Method, type Sel, type Side, type Stakes } from './types'

export { defaultName, guestAvatar, guestId, saveName } from '../../lib/identity'
export { KEEP_MS } from './ledger'

/*
  Where Kaiju Clash's rounds come from: the shared fight night in the database when it is reachable (kj_state, kj_bet
  and kj_round_info in api/_lib/schema.js), otherwise a stand-in in the browser on the same timetable (clock.ts), where
  a few house bots put chips on the board. Either way a feed is the round in play as the server sees it: its
  timetable, its hash (and the next round's), the key once betting has closed and the seed after the final bell,
  everyone's chips on each selection, the biggest bettors, this player's stakes, the finished rounds and this
  player's own finished rounds with a bet (for settling one the browser missed). Nothing in it says who a player is.
*/

/** the most one player may have on a selection in a round (rules.ts STAKE_LIMIT; kj_bet holds the same) */
export const SEL_LIMIT = STAKE_LIMIT
/** `past` always holds this player's latest finished rounds, up to this many, plus the asked ones (up to ASK_LIMIT) */
export const PAST_LIMIT = 20
export const ASK_LIMIT = 50

export interface FeedRound extends Times {
  id: number
  /** where the round is on the server's clock (clock.ts phaseAt) */
  phase: Phase
  /** sha256(seed), published before betting opens */
  hash: string
  /** revealed when betting closes: it decides the fight */
  key: string | null
  /** revealed at the final bell */
  seed: string | null
}
/** one of the round's biggest players: their name, total and biggest selection (never their id) */
export interface Bettor {
  name: string
  avatar: number
  /** a signed-in player's (their name opens their profile) */
  acct: boolean
  /** this player's own row */
  me: boolean
  /** a house bot of the stand-in */
  bot?: boolean
  total: number
  sel: Sel
  amount: number
}
export interface Feed {
  /** server clock when the state was read */
  now: number
  round: FeedRound
  /** the next round and its hash, out before its betting opens */
  next: { id: number; hash: string } | null
  /** everyone's chips on each selection this round, and how many players back it */
  sels: Record<Sel, { total: number; players: number }>
  players: number
  /** this player's stakes this round as the server holds them, or null with none */
  mine: Stakes | null
  /** this round's 30 biggest players, biggest first */
  bettors: Bettor[]
  online: number
  /** the newest finished round */
  head: number | null
  /** the last 50 finished rounds, newest first; null when nothing has finished since the round the request named */
  history: { id: number; seed: string }[] | null
  /** this player's last finished rounds with a bet, for settling a round the browser missed */
  past: { round: number; seed: string; hash: string; stakes: Stakes }[]
  /** the unsettled rounds this request asked about: every one of them that has finished with a bet of this player's is
   *  in `past`, so one that has finished and isn't there held no bet */
  asked: number[]
  /** offline stand-in: how many house bots are betting */
  bots?: number
}

export interface RoundInfo {
  id: number
  hash: string
  /** once betting has closed */
  key: string | null
  /** once the final bell has rung */
  seed: string | null
}

/** why kj_bet (or the stand-in) refused: betting had closed, a selection would go over SEL_LIMIT, an unknown selection,
 *  a bad amount, or no player id */
export type BetError = 'closed' | 'limit' | 'sel' | 'amount' | 'player' | 'error'
export type BetResult = { ok: true; round: number; held: Stakes } | { ok: false; error: BetError; round?: number }

export interface KaijuServer {
  online: boolean
  book: Book
  /** `hist` is the newest finished round the caller already has; `open` the rounds it has paid into and not settled */
  state(hist: number | null, open: number[]): Promise<Feed>
  /** changes this player's stakes in round `round` (amounts below zero take chips off); throws when the answer is lost */
  bet(round: number, bets: Stakes, name: string, avatar: number): Promise<BetResult>
  roundInfo(round: number): Promise<RoundInfo | null>
}

/* ---------- the shared fight night ---------- */

const n = (v: unknown) => Number(v ?? 0)
const num = (v: unknown) => (v == null ? null : Number(v))
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
const ERRORS: readonly BetError[] = ['closed', 'limit', 'sel', 'amount', 'player']

/** changes as sent: amounts to the cent on known selections, below zero to take off */
function deltas(v: Stakes): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of SELS) if (v[s]) out[s] = Math.round(v[s]! * 100) / 100
  return out
}

/** the sels map, every selection present */
function selMap(raw: any): Feed['sels'] {
  const out = {} as Feed['sels']
  for (const s of SELS) out[s] = { total: n(raw?.[s]?.total), players: n(raw?.[s]?.players) }
  return out
}

export function normalise(raw: any, asked: number[]): Feed {
  if (!raw?.round) throw new Error('no round')
  const r = raw.round
  const id = Number(r.id)
  const t = timesOf(id)
  return {
    now: Number(raw.now),
    round: {
      id,
      phase: r.phase,
      // the timetable is the same everywhere; the server's copy wins should they ever differ
      opensAt: num(r.opensAt) ?? t.opensAt,
      closesAt: num(r.closesAt) ?? t.closesAt,
      showAt: num(r.showAt) ?? t.showAt,
      fightAt: num(r.fightAt) ?? t.fightAt,
      endsAt: num(r.endsAt) ?? t.endsAt,
      nextAt: num(r.nextAt) ?? t.nextAt,
      hash: String(r.hash ?? ''),
      key: str(r.key),
      seed: str(r.seed),
    },
    next: raw.next?.hash ? { id: Number(raw.next.id), hash: String(raw.next.hash) } : null,
    sels: selMap(raw.sels),
    players: n(raw.players),
    mine: raw.mine ? cleanStakes(raw.mine) : null,
    bettors: (raw.bettors ?? [])
      .filter((b: any) => isSel(b?.sel))
      .map((b: any) => ({ name: String(b.name ?? 'Player'), avatar: n(b.avatar), acct: !!b.acct, me: !!b.me, total: n(b.total), sel: b.sel as Sel, amount: n(b.amount) })),
    online: n(raw.online),
    head: num(raw.head),
    history: raw.history == null ? null : raw.history.map((h: any) => ({ id: Number(h.id), seed: String(h.seed) })),
    past: (raw.past ?? []).map((p: any) => ({ round: Number(p.round), seed: String(p.seed), hash: String(p.hash ?? ''), stakes: cleanStakes(p.stakes) })),
    asked: Array.isArray(raw.asked) ? raw.asked.map(Number) : asked,
  }
}

const shared: KaijuServer = {
  online: true,
  book: 'shared',
  state: async (hist, open) => {
    const asked = open.slice(0, ASK_LIMIT)
    const args: Record<string, unknown> = { p_player: guestId, p_hist: hist }
    if (asked.length) args.p_open = asked
    return normalise(await rpc('kj_state', args, 4500), asked)
  },
  bet: async (round, bets, name, avatar) => {
    const r = await rpc<any>('kj_bet', { p_player: guestId, p_name: name, p_round: round, p_bets: deltas(bets), p_avatar: avatar }, 6000)
    if (r?.ok) return { ok: true, round: Number(r.round), held: cleanStakes(r.held) }
    const error = ERRORS.includes(r?.error) ? (r.error as BetError) : 'error'
    return { ok: false, error, round: r?.round == null ? undefined : Number(r.round) }
  },
  roundInfo: async (round) => {
    const r = await rpc<any>('kj_round_info', { p_round: round })
    return r ? { id: Number(r.id), hash: String(r.hash), key: str(r.key), seed: str(r.seed) } : null
  },
}

/* ---------- the stand-in ---------- */

/*
  The same timetable without the backend: round k is the one in play at k × CYCLE_MS on this device's clock, and its
  seed is sha256(secret + ':kaiju:' + k) for a secret kept on this device, so every tab of this browser, and the same
  tab after a reload, sees the same fight at the same moment. The hash is shown as the round opens, the key when
  betting closes and the seed at the final bell, as online. Your bets live in localStorage for three days (as long
  as the database keeps a round); the house bots' chips follow from the round's published hash and the fight card,
  so they never depend on the result.
*/

// dev builds only (and never under Node, where the tools run this file without Vite's env)
const DEV = !!import.meta.env?.DEV
const SECRET_KEY = 'lumen.kaiju.local.secret'
const BETS_KEY = 'lumen.kaiju.local.bets'
const FORCE_KEY = 'lumen.kaiju.local.force'
/** the stand-in keeps bets (and so `past`) this many rounds back: three days */
const KEEP_ROUNDS = Math.ceil((3 * 86400_000) / CYCLE_MS)

export const BOTS: readonly { name: string; avatar: number }[] = [
  { name: 'Tess', avatar: 2 },
  { name: 'Big Gus', avatar: 9 },
  { name: 'Kelpie', avatar: 5 },
  { name: 'Neon Nina', avatar: 14 },
  { name: 'Stomper', avatar: 10 },
  { name: 'Lava Lou', avatar: 7 },
  { name: 'Harbour Hal', avatar: 1 },
  { name: 'Rooftop Ray', avatar: 12 },
  { name: 'Moth Mo', avatar: 6 },
  { name: 'Pip', avatar: 3 },
  { name: 'Zed', avatar: 15 },
  { name: 'Bertha', avatar: 11 },
]
const BOT_STAKES = [5, 10, 10, 20, 25, 25, 50, 50, 100, 100, 250, 500]
/** how much of their money the bots put on each market */
const BOT_MARKETS: [Market, number][] = [
  ['win', 40],
  ['how', 13],
  ['exact', 15],
  ['rnd', 12],
  ['first', 9],
  ['dmg', 11],
]

function mulberry32(a: number) {
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface BotChip {
  bot: number
  sel: Sel
  amount: number
  /** ms after betting opens */
  at: number
}

/**
 * The house bots' chips for a round, from its hash and its fight card: three to eight bots (two more on a Main Event),
 * one to three selections each, mostly on the likelier outcomes (the crowd backs the favourite), now and then a long shot.
 */
export function botChips(hash: string, m: Matchup): BotChip[] {
  const rnd = mulberry32(parseInt(hash.slice(0, 8), 16) || 1)
  const p = oddsOf(m.a, m.b).p
  const order = BOTS.map((_, i) => i)
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  const pick = <T>(list: [T, number][]): T => {
    let x = rnd() * list.reduce((a, [, w]) => a + w, 0)
    return list.find(([, w]) => (x -= w) < 0)?.[0] ?? list[0][0]
  }
  const out: BotChip[] = []
  const count = 3 + Math.floor(rnd() * 6) + (m.main ? 2 : 0)
  for (const bot of order.slice(0, count)) {
    const stake = BOT_STAKES[Math.floor(rnd() * BOT_STAKES.length)]
    const picks = 1 + Math.floor(rnd() * 3)
    // some bots chase long shots: they weigh every selection alike
    const wild = rnd() < 0.2
    const start = 400 + rnd() * (BET_MS - CLOSE_MS - 4000)
    for (let k = 0; k < picks; k++) {
      const market = pick(BOT_MARKETS)
      const sel = pick(SELS.filter((s) => marketOf(s) === market).map((s): [Sel, number] => [s, wild ? 1 : p[s] + 0.04]))
      const amount = k ? Math.max(1, Math.round(stake / 2)) : stake
      const at = Math.min(BET_MS - CLOSE_MS - 600, start + k * (600 + rnd() * 2400))
      const same = out.find((c) => c.bot === bot && c.sel === sel)
      if (same) same.amount += amount
      else out.push({ bot, sel, amount, at })
    }
  }
  return out
}

/** what a dev build can ask the stand-in to make the round taking bets come out as (window.__kjForce) */
export interface Force {
  winner?: Side
  method?: Method
  round?: 1 | 2 | 3
  first?: Side
  /** more buildings fall than the line */
  over?: boolean
}

/** dev builds: window.__kjForce = { winner: 'b', method: 'splash', round: 2 } redraws the stand-in's round taking bets */
function forcedSeed(m: Matchup): string | null {
  if (!DEV || typeof window === 'undefined') return null
  const w = (window as unknown as { __kjForce?: Force }).__kjForce
  if (!w) return null
  ;(window as unknown as { __kjForce?: Force }).__kjForce = undefined
  const line = oddsOf(m.a, m.b).line
  for (let i = 0; i < 400_000; i++) {
    const s = newSeed()
    const r = drawResult(keyOf(s), m.a, m.b)
    if ((w.winner == null || r.winner === w.winner) && (w.method == null || r.method === w.method) && (w.round == null || r.round === w.round) && (w.first == null || r.first === w.first) && (w.over == null || r.damage > line === w.over)) return s
  }
  return null
}

type LocalBet = { stakes: Stakes; name: string; avatar: number; at: number }

function localServer(): KaijuServer {
  let secret = safeStorage.getItem(SECRET_KEY)
  if (!secret || !/^[0-9a-f]{64}$/.test(secret)) {
    secret = newSeed()
    safeStorage.setItem(SECRET_KEY, secret)
  }
  const root = secret
  const readJson = <T>(k: string, fallback: T): T => {
    try {
      const v = JSON.parse(safeStorage.getItem(k) ?? 'null')
      return v && typeof v === 'object' ? v : fallback
    } catch {
      return fallback
    }
  }
  const forced = (): Record<string, string> => (DEV ? readJson<Record<string, string>>(FORCE_KEY, {}) : {})
  const seedOf = (k: number) => forced()[k] ?? sha256(`${root}:kaiju:${k}`)
  const hashCache = new Map<string, string>()
  const hashOf = (seed: string) => {
    let h = hashCache.get(seed)
    if (!h) {
      h = sha256(seed)
      hashCache.set(seed, h)
      if (hashCache.size > 400) hashCache.delete(hashCache.keys().next().value!)
    }
    return h
  }

  // with storage blocked the bets still last as long as the page
  let memo: Record<string, LocalBet> | null = null
  const readBets = (): Record<string, LocalBet> => readJson<Record<string, LocalBet> | null>(BETS_KEY, null) ?? memo ?? {}
  const writeBets = (b: Record<string, LocalBet>, k: number) => {
    for (const id of Object.keys(b)) if (Number(id) < k - KEEP_ROUNDS) delete b[id]
    memo = b
    safeStorage.setItem(BETS_KEY, JSON.stringify(b))
  }

  return {
    online: false,
    book: 'local',
    state: async (hist, open) => {
      const now = Date.now()
      const asked = open.slice(0, ASK_LIMIT)
      const id = roundAt(now)
      const t = timesOf(id)
      const phase = phaseAt(t, now)
      const m = matchupOf(id)
      if (phase === 'bets') {
        const f = forcedSeed(m)
        if (f) {
          // the round taking bets is redrawn (dev builds only)
          const map: Record<string, string> = { ...forced(), [id]: f }
          for (const k of Object.keys(map)) if (Number(k) < id - KEEP_ROUNDS) delete map[k]
          safeStorage.setItem(FORCE_KEY, JSON.stringify(map))
        }
      }
      const seed = seedOf(id)
      const hash = hashOf(seed)
      const bets = readBets()
      const mineBet = bets[id]
      const mine = mineBet && Object.keys(mineBet.stakes ?? {}).length ? cleanStakes(mineBet.stakes) : null
      // the bots' chips that are down by now, and mine
      const sels = Object.fromEntries(SELS.map((s) => [s, { total: 0, players: 0 }])) as Feed['sels']
      const per = new Map<number, Stakes>()
      for (const c of botChips(hash, m)) {
        if (t.opensAt + c.at > now) continue
        sels[c.sel].total += c.amount
        sels[c.sel].players++
        const s = per.get(c.bot) ?? {}
        s[c.sel] = (s[c.sel] ?? 0) + c.amount
        per.set(c.bot, s)
      }
      if (mine)
        for (const s of SELS)
          if (mine[s]) {
            sels[s].total = Math.round((sels[s].total + mine[s]!) * 100) / 100
            sels[s].players++
          }
      const row = (stakes: Stakes): { total: number; sel: Sel; amount: number } => {
        let top: Sel = SELS[0]
        let total = 0
        for (const s of SELS) {
          total += stakes[s] ?? 0
          if ((stakes[s] ?? 0) > (stakes[top] ?? 0)) top = s
        }
        return { total: Math.round(total * 100) / 100, sel: top, amount: stakes[top] ?? 0 }
      }
      const bettors: Bettor[] = [...per].map(([b, s]) => ({ name: BOTS[b].name, avatar: BOTS[b].avatar, acct: false, me: false, bot: true, ...row(s) }))
      if (mine) bettors.push({ name: mineBet.name, avatar: mineBet.avatar, acct: false, me: true, ...row(mine) })
      bettors.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      // every round of the timetable happens here, so the history is always the last 50
      const done = now >= t.endsAt
      const head = done ? id : id - 1
      const history = hist === head ? null : Array.from({ length: 50 }, (_, i) => ({ id: head - i, seed: seedOf(head - i) }))
      const finished = Object.keys(bets)
        .map(Number)
        .filter((k) => (k < id || (k === id && done)) && Object.keys(bets[k].stakes ?? {}).length)
        .sort((a, b) => b - a)
      const past = finished
        .filter((k, i) => i < PAST_LIMIT || asked.includes(k))
        .map((k) => ({ round: k, seed: seedOf(k), hash: hashOf(seedOf(k)), stakes: cleanStakes(bets[k].stakes) }))
      return {
        now,
        round: { id, phase, ...t, hash, key: now >= t.closesAt ? keyOf(seed) : null, seed: done ? seed : null },
        next: { id: id + 1, hash: hashOf(seedOf(id + 1)) },
        sels,
        players: per.size + (mine ? 1 : 0),
        mine,
        bettors: bettors.slice(0, 30),
        online: 1 + per.size,
        head,
        history,
        past,
        asked,
        bots: per.size,
      }
    },
    bet: async (round, adds, name, avatar) => {
      const now = Date.now()
      const id = roundAt(now)
      const entries = Object.entries(adds) as [string, number][]
      if (entries.some(([s]) => !isSel(s))) return { ok: false, error: 'sel' }
      if (!entries.length || entries.some(([, v]) => !Number.isFinite(v) || Math.round(v * 100) === 0 || Math.abs(v) > SEL_LIMIT)) return { ok: false, error: 'amount' }
      if (round !== id || now >= timesOf(id).closesAt) return { ok: false, error: 'closed', round: id }
      const bets = readBets()
      const b = bets[id] ?? { stakes: {}, name, avatar, at: now }
      const next: Stakes = { ...b.stakes }
      for (const [s, v] of entries as [Sel, number][]) {
        const total = Math.max(0, Math.round((next[s] ?? 0) * 100 + Math.round(v * 100)) / 100)
        if (total > SEL_LIMIT) return { ok: false, error: 'limit' }
        if (total > 0) next[s] = total
        else delete next[s]
      }
      bets[id] = { ...b, stakes: next, name, avatar }
      writeBets(bets, id)
      return { ok: true, round: id, held: cleanStakes(next) }
    },
    roundInfo: async (k) => {
      const now = Date.now()
      const id = roundAt(now)
      if (!Number.isInteger(k) || k > id + 1 || k < id - KEEP_ROUNDS) return null
      const seed = seedOf(k)
      const t = timesOf(k)
      return { id: k, hash: hashOf(seed), key: now >= t.closesAt ? keyOf(seed) : null, seed: now >= t.endsAt ? seed : null }
    },
  }
}

let standIn: KaijuServer | null = null
/** The stand-in, made once: it also settles stakes from an offline session after the shared show comes back. */
export const localStandIn = () => (standIn ??= localServer())

/** The shared fight night if the database answers, otherwise the stand-in. */
export async function connect(): Promise<KaijuServer> {
  return (await tryShared()) ?? localStandIn()
}

/** Try the shared fight night again (the Retry button when playing solo). */
export async function tryShared(): Promise<KaijuServer | null> {
  try {
    if (!(await backend())) return null
    await shared.state(null, [])
    return shared
  } catch {
    return null
  }
}

/* ---------- rounds settled away from the page ---------- */

const vs = (m: Matchup) => `${fighter(m.a).name} vs ${fighter(m.b).name}`

/** what to tell the player about a round settled while they weren't watching it end (null: nothing to say) */
export function awayToast(x: Settlement): { kind: 'win' | 'loss' | 'info'; title: string; amount?: number } | null {
  const o = x.outcome
  if (!x.paid) return null
  const name = `Kaiju Clash #${x.round} (${vs(o.matchup)})`
  if (o.expired) return o.bet > 0 ? { kind: 'loss', title: `${name} could no longer be looked up, so its ${fmt(o.bet)} was settled as lost` } : null
  if (o.bet > 0) {
    const extra = o.refund > 0 ? ` (${fmt(o.refund)} that never reached the fight came back)` : ''
    if (o.payout > o.bet) return { kind: 'win', title: `${name} settled while you were away: you won ${fmt(o.payout)}${extra}`, amount: o.payout }
    if (o.payout > 0) return { kind: 'info', title: `${name} settled while you were away: ${fmt(o.payout)} of ${fmt(o.bet)} back${extra}` }
    return { kind: 'loss', title: `${name} settled while you were away: no win on ${fmt(o.bet)}${extra}` }
  }
  return o.refund > 0 ? { kind: 'info', title: `Your bets on ${name} never reached the fight, so ${fmt(o.refund)} came back.` } : null
}

/**
 * Settles every round this player has paid into that can be told now, wherever they are: the stand-in's (an offline
 * session's) and the shared ones. One call for a background settler while the player is elsewhere in the casino (like
 * usePotPayouts in src/App.tsx; pair it with ledger.ts hasOpen so it only polls while a stake waits). Each settlement
 * comes back for a toast (awayToast); the ledger's lock and markers keep every round to once.
 */
export async function settleMissed(server: KaijuServer | null, who: string): Promise<Settlement[]> {
  const out: Settlement[] = []
  if (openRounds(who, 'local').length) {
    const lf = await localStandIn().state(null, openRounds(who, 'local'))
    out.push(...(await settleFrom(who, 'local', lf, lf.now)))
  }
  if (server?.online && openRounds(who, 'shared').length) {
    const f = await server.state(null, openRounds(who, 'shared'))
    out.push(...(await settleFrom(who, 'shared', f, f.now)))
  }
  return out.map((x) => ({ ...x, live: false }))
}
