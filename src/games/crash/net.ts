import { backend, rpc } from '../../lib/backend'
import { rand } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { crashFromSeed, newSeed, sha256Hex } from './fair'

/* Where Crash rounds come from: the shared rounds in the database when it is reachable, otherwise
   a local stand-in with the same rules, so the game still works offline and in the preview. */

export const GROWTH = 0.08 // multiplier = e^(GROWTH * seconds)
export const multAt = (ms: number) => Math.exp((GROWTH * Math.max(0, ms)) / 1000)
export const timeAt = (m: number) => (Math.log(Math.max(1, m)) / GROWTH) * 1000
export const BET_MS = 7000
export const PAUSE_MS = 3000

export type Phase = 'betting' | 'running' | 'crashed'

export interface Feed {
  /** server clock when the state was read */
  now: number
  round: { id: number; phase: Phase; startsAt: number; hash: string; crash: number | null; seed: string | null }
  /** the 50 biggest bets of this round */
  bets: { name: string; bet: number; cashed: number | null; me: boolean }[]
  players: number
  total: number
  mine: { bet: number; auto: number | null; cashed: number | null } | null
  history: { id: number; crash: number }[]
  /** this player's recently finished bets, for settling a round the client missed */
  past: { round: number; bet: number; crash: number; cashed: number | null }[]
}

export interface RoundInfo {
  id: number
  hash: string
  crash: number
  seed: string
}

export type BetResult = { ok: true; round: number } | { ok: false; error: string }
export type CashResult = { ok: true; cashed: number } | { ok: false; error: string; crash?: number }

export interface CrashServer {
  online: boolean
  state(): Promise<Feed>
  bet(bet: number, auto: number | null, name: string): Promise<BetResult>
  cashout(round: number): Promise<CashResult>
  roundInfo(round: number): Promise<RoundInfo | null>
}

/* ---------- identity ---------- */

function stored(key: string, make: () => string, valid: (v: string) => boolean = () => true) {
  const v = safeStorage.getItem(key)
  if (v && valid(v)) return v
  const n = make()
  safeStorage.setItem(key, n)
  return n
}
/** Guests are told apart by a random id kept on this device; signed-in players by their account. */
export const guestId = stored(
  'lumen.crash.gid',
  () => 'g_' + Array.from({ length: 20 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rand() * 36)]).join(''),
  (v) => /^g_[a-z0-9]{12,40}$/.test(v),
)
export const defaultName = () => stored('lumen.crash.name', () => `Player${Math.floor(1000 + rand() * 9000)}`)
export const saveName = (n: string) => safeStorage.setItem('lumen.crash.name', n)

/* ---------- shared rounds ---------- */

const num = (v: unknown) => (v == null ? null : Number(v))

function normalise(raw: any): Feed {
  if (!raw?.round) throw new Error('no round')
  return {
    now: Number(raw.now),
    round: {
      id: Number(raw.round.id),
      phase: raw.round.phase,
      startsAt: Number(raw.round.startsAt),
      hash: String(raw.round.hash ?? ''),
      crash: num(raw.round.crash),
      seed: raw.round.seed ?? null,
    },
    bets: (raw.bets ?? []).map((b: any) => ({ name: String(b.name), bet: Number(b.bet), cashed: num(b.cashed), me: !!b.me })),
    players: Number(raw.players ?? 0),
    total: Number(raw.total ?? 0),
    mine: raw.mine ? { bet: Number(raw.mine.bet), auto: num(raw.mine.auto), cashed: num(raw.mine.cashed) } : null,
    history: (raw.history ?? []).map((h: any) => ({ id: Number(h.id), crash: Number(h.crash) })),
    past: (raw.past ?? []).map((p: any) => ({ round: Number(p.round), bet: Number(p.bet), crash: Number(p.crash), cashed: num(p.cashed) })),
  }
}

const shared: CrashServer = {
  online: true,
  state: async () => normalise(await rpc('crash_state', { p_player: guestId }, 4500)),
  bet: async (bet, auto, name) => {
    const r = await rpc<any>('crash_bet', { p_player: guestId, p_name: name, p_bet: bet, p_auto: auto }, 6000)
    return r?.ok ? { ok: true, round: Number(r.round) } : { ok: false, error: String(r?.error ?? 'error') }
  },
  cashout: async (round) => {
    const r = await rpc<any>('crash_cashout', { p_player: guestId, p_round: round }, 6000)
    return r?.ok ? { ok: true, cashed: Number(r.cashed) } : { ok: false, error: String(r?.error ?? 'error'), crash: num(r?.crash) ?? undefined }
  },
  roundInfo: async (round) => {
    const r = await rpc<any>('crash_round_info', { p_round: round })
    return r ? { id: Number(r.id), hash: String(r.hash), crash: Number(r.crash), seed: String(r.seed) } : null
  },
}

/* ---------- local stand-in (same rules, one player) ---------- */

function localServer(): CrashServer {
  type R = { id: number; startsAt: number; crashesAt: number; crash: number; seed: string; hash: string }
  let round: R | null = null
  let making: Promise<R> | null = null
  let mine: { bet: number; auto: number | null; cashed: number | null; name: string } | null = null
  const rounds: R[] = []
  const past: Feed['past'] = []
  const floor2 = (m: number) => Math.floor(m * 100) / 100

  const current = async (now: number): Promise<R> => {
    if (round && now < round.crashesAt + PAUSE_MS) return round
    if (making) return making
    making = (async () => {
      if (round) {
        rounds.unshift(round)
        rounds.splice(20)
        if (mine) past.unshift({ round: round.id, bet: mine.bet, crash: round.crash, cashed: effective('crashed', round.crash) })
        past.splice(5)
      }
      const seed = newSeed()
      const [crash, hash] = await Promise.all([crashFromSeed(seed), sha256Hex(seed)])
      const startsAt = Date.now() + BET_MS
      round = { id: (round?.id ?? 0) + 1, startsAt, crashesAt: startsAt + Math.round(timeAt(crash)), crash, seed, hash }
      mine = null
      making = null
      return round
    })()
    return making
  }
  const phaseOf = (r: R, now: number): Phase => (now < r.startsAt ? 'betting' : now < r.crashesAt ? 'running' : 'crashed')
  const multOf = (r: R, phase: Phase, now: number) => (phase === 'running' ? Math.min(floor2(multAt(now - r.startsAt)), r.crash) : phase === 'crashed' ? r.crash : 1)
  const effective = (phase: Phase, m: number) => {
    if (!mine) return null
    if (mine.cashed != null) return mine.cashed
    if (mine.auto != null && phase !== 'betting' && mine.auto <= m) return mine.auto
    return null
  }

  return {
    online: false,
    state: async () => {
      const r = await current(Date.now())
      const now = Date.now()
      const phase = phaseOf(r, now)
      const cashed = effective(phase, multOf(r, phase, now))
      const done = phase === 'crashed'
      return {
        now,
        round: { id: r.id, phase, startsAt: r.startsAt, hash: r.hash, crash: done ? r.crash : null, seed: done ? r.seed : null },
        bets: mine ? [{ name: mine.name, bet: mine.bet, cashed, me: true }] : [],
        players: mine ? 1 : 0,
        total: mine?.bet ?? 0,
        mine: mine ? { bet: mine.bet, auto: mine.auto, cashed } : null,
        history: (done ? [r, ...rounds] : rounds).slice(0, 20).map((x) => ({ id: x.id, crash: x.crash })),
        past: [...past],
      }
    },
    bet: async (bet, auto, name) => {
      const r = await current(Date.now())
      if (Date.now() >= r.startsAt - 150) return { ok: false, error: 'closed' }
      if (mine) return { ok: false, error: 'already' }
      mine = { bet, auto, cashed: null, name }
      return { ok: true, round: r.id }
    },
    cashout: async (id) => {
      const r = await current(Date.now())
      const now = Date.now()
      if (r.id !== id || !mine) return { ok: false, error: 'no-bet' }
      const phase = phaseOf(r, now)
      const m = multOf(r, phase, now)
      const won = effective(phase, m)
      if (won != null) return { ok: true, cashed: won }
      if (phase !== 'running') return { ok: false, error: phase === 'crashed' ? 'crashed' : 'not-started', crash: r.crash }
      mine.cashed = m
      return { ok: true, cashed: m }
    },
    roundInfo: async (id) => {
      const r = [round, ...rounds].find((x) => x?.id === id)
      if (!r || Date.now() < r.crashesAt) return null
      return { id: r.id, hash: r.hash, crash: r.crash, seed: r.seed }
    },
  }
}

/** The shared rounds if the database answers, otherwise the local stand-in. */
export async function connect(): Promise<CrashServer> {
  try {
    if (await backend()) {
      await shared.state()
      return shared
    }
  } catch {
    /* fall through to solo */
  }
  return localServer()
}

/** Try the shared rounds again (used by the Retry button in solo mode). */
export async function tryShared(): Promise<CrashServer | null> {
  try {
    if (!(await backend())) return null
    await shared.state()
    return shared
  } catch {
    return null
  }
}
