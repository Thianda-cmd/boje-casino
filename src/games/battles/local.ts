import { guestAvatar, guestId } from '../../lib/identity'
import { rand, randInt } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { TIERS, type Tier } from '../cases/rules'
import { BOTS, costOf, decide, drawResults } from './engine'
import { BattleGone, LIMITS, MODES, SEATS, TIMING, type BattleServer, type BattleView, type CbError, type CbRes, type CbResult, type ListFeed, type Mode } from './types'

/*
  Case Battles without the backend: the same rules in the browser, where the only other players are the house bots.
  Battles live in localStorage, so every tab of this browser sees the same ones and a reload picks a battle up where it
  was; like the server, nothing runs in the background, and each call first brings the battles up to date with the
  clock. To keep the lobby alive, the bots open battles of their own now and then, and fill them a little later; you
  can join those too.
*/

const KEY = 'lumen.battles.local.v1'
const DAY = 86400_000
/** the bots' own battles: how many may wait at once, and how long one waits before the bots fill it */
const BOT_OPEN = 4
const BOT_FILL_MS = [7000, 45000] as const
const BOT_SPAWN_MS = [9000, 26000] as const

interface LSeat {
  player: string
  name: string
  avatar: number
  bot: boolean
}
interface LBattle {
  id: number
  status: 'open' | 'running' | 'done' | 'cancelled'
  mode: Mode
  crazy: boolean
  unit: number
  cases: Tier[]
  seats: (LSeat | null)[]
  createdAt: number
  startAt: number | null
  endAt: number | null
  results: number[][] | null
  winners: number[] | null
  payouts: number[] | null
  pot: number | null
  /** a bot's battle: when the other bots take the empty seats */
  fillAt?: number
}
interface LState {
  seq: number
  nextSpawn: number
  battles: LBattle[]
}

const between = (r: readonly [number, number]) => r[0] + rand() * (r[1] - r[0])
const draw = () => randInt(100_000)

function load(): LState | null {
  try {
    const v = JSON.parse(safeStorage.getItem(KEY) ?? 'null')
    return v && Array.isArray(v.battles) && typeof v.seq === 'number' ? v : null
  } catch {
    return null
  }
}
// with storage blocked the battles still last as long as the page
let memo: LState | null = null
function save(s: LState) {
  memo = s
  safeStorage.setItem(KEY, JSON.stringify(s))
}

/** the battle's seats fill: draw the items, decide it, and start the clock */
function start(b: LBattle, now: number) {
  b.results = drawResults(b.mode, b.cases, draw)
  const o = decide(b.mode, b.crazy, b.unit, b.results)
  b.winners = o.winners
  b.payouts = o.payouts
  b.pot = o.pot
  b.status = 'running'
  b.startAt = now + TIMING.COUNTDOWN_MS
  b.endAt = b.startAt + b.cases.length * TIMING.ROUND_MS + TIMING.END_MS
  delete b.fillAt
}

function fillWithBots(b: LBattle) {
  const used = new Set(b.seats.filter(Boolean).map((s) => s!.name))
  const free = BOTS.filter((x) => !used.has(x.name))
  // a shuffled pick, so the same few bots don't always turn up
  for (let i = free.length - 1; i > 0; i--) {
    const j = randInt(i + 1)
    ;[free[i], free[j]] = [free[j], free[i]]
  }
  b.seats = b.seats.map((s) => {
    if (s) return s
    const bot = free.shift()!
    return { player: `bot_${bot.name.toLowerCase()}`, name: bot.name, avatar: bot.avatar, bot: true }
  })
}

/** a battle a bot opens: a few crates of a random mix, at a stake a bot might pick */
function botBattle(s: LState, now: number, ago = 0): LBattle {
  const mode = MODES[randInt(10) < 4 ? 0 : randInt(MODES.length)]
  const n = 1 + randInt(randInt(3) ? 4 : 8)
  const lean = randInt(TIERS.length)
  const cases = Array.from({ length: n }, () => TIERS[randInt(3) ? lean : randInt(TIERS.length)])
  const unit = [1, 2, 5, 5, 10, 10, 20, 25, 50, 100][randInt(10)]
  const host = BOTS[randInt(BOTS.length)]
  const b: LBattle = {
    id: ++s.seq,
    status: 'open',
    mode,
    crazy: randInt(5) === 0,
    unit,
    cases,
    seats: Array.from({ length: SEATS[mode] }, (_, i) => (i === 0 ? { player: `bot_${host.name.toLowerCase()}`, name: host.name, avatar: host.avatar, bot: true } : null)),
    createdAt: now - ago,
    startAt: null,
    endAt: null,
    results: null,
    winners: null,
    payouts: null,
    pot: null,
    fillAt: now - ago + between(BOT_FILL_MS),
  }
  return b
}

/** A first visit: a lobby with a few battles waiting, one or two under way and a handful just finished. */
function seed(now: number): LState {
  const s: LState = { seq: 1000 + randInt(9000), nextSpawn: now + between(BOT_SPAWN_MS), battles: [] }
  // started this long ago: two still being played, the rest finished over the last few minutes
  for (const took of [6000 + rand() * 6000, 14_000 + rand() * 8000, 70_000, 140_000, 210_000, 300_000, 420_000, 560_000]) {
    const b = botBattle(s, now, 0)
    b.createdAt = now - took - 20_000 - rand() * 30_000
    fillWithBots(b)
    start(b, now - took - TIMING.COUNTDOWN_MS)
    if (b.endAt! <= now) b.status = 'done'
    s.battles.push(b)
  }
  for (let i = 0; i < 3; i++) {
    const b = botBattle(s, now, 2000 + rand() * 20_000)
    b.fillAt = now + 6000 + i * 9000 + rand() * 8000
    s.battles.push(b)
  }
  return s
}

const isMe = (x: LSeat | null) => !!x && x.player === guestId

/** Brings every battle up to the clock: expiries, the bots' fills, finished battles, the bots' new battles, tidying. */
function advance(s: LState, now: number) {
  for (const b of s.battles) {
    if (b.status === 'open' && b.fillAt != null && b.fillAt <= now) {
      fillWithBots(b)
      start(b, b.fillAt)
    }
    if (b.status === 'open' && b.createdAt + TIMING.OPEN_MS <= now) b.status = 'cancelled'
    if (b.status === 'running' && b.endAt != null && b.endAt <= now) b.status = 'done'
  }
  if (now >= s.nextSpawn) {
    if (s.battles.filter((b) => b.status === 'open' && b.fillAt != null).length < BOT_OPEN) s.battles.push(botBattle(s, now))
    s.nextSpawn = now + between(BOT_SPAWN_MS)
  }
  // finished battles stay a week (yours, like the server's) or until there are plenty of newer ones (the bots')
  const done = s.battles.filter((b) => b.status === 'done' || b.status === 'cancelled').sort((a, b) => (b.endAt ?? b.createdAt) - (a.endAt ?? a.createdAt))
  const keep = new Set(done.filter((b, i) => (b.seats.some(isMe) ? now - (b.endAt ?? b.createdAt) < 7 * DAY : i < 16)).map((b) => b.id))
  s.battles = s.battles.filter((b) => (b.status !== 'done' && b.status !== 'cancelled') || keep.has(b.id))
}

function view(b: LBattle, now: number): BattleView {
  return {
    now,
    id: b.id,
    status: b.status,
    mode: b.mode,
    crazy: b.crazy,
    unit: b.unit,
    cases: [...b.cases],
    cost: costOf(b.unit, b.cases),
    seats: b.seats.map((x, i) => (x ? { seat: i + 1, name: x.name, avatar: x.avatar, guest: !x.bot, bot: x.bot, me: isMe(x) } : null)),
    createdAt: b.createdAt,
    expiresAt: b.createdAt + TIMING.OPEN_MS,
    startAt: b.startAt,
    roundMs: TIMING.ROUND_MS,
    endAt: b.endAt,
    results: b.results ? b.results.map((r) => [...r]) : null,
    winners: b.winners ? [...b.winners] : null,
    payouts: b.payouts ? [...b.payouts] : null,
    pot: b.pot,
  }
}

/** list feeds leave the items out of battles still being played, like the server */
function listed(b: LBattle, now: number, withResults: boolean): BattleView {
  const v = view(b, now)
  return withResults ? v : { ...v, results: null }
}

const openSeats = (s: LState) => s.battles.filter((b) => b.status === 'open' && b.seats.some(isMe)).length

/** Runs one operation on the stored battles: load, bring up to date, act, save. */
function tx<T>(fn: (s: LState, now: number) => T): T {
  const now = Date.now()
  const s = load() ?? memo ?? seed(now)
  advance(s, now)
  const out = fn(s, now)
  save(s)
  return out
}

const fail = (error: CbError) => ({ ok: false as const, error })
const cleanName = (n: string) => n.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player'

export function localServer(): BattleServer {
  return {
    online: false,
    list: async (): Promise<ListFeed> =>
      tx((s, now) => {
        const by = (k: (b: LBattle) => number) => (a: LBattle, b: LBattle) => k(b) - k(a)
        const open = s.battles.filter((b) => b.status === 'open').sort(by((b) => b.createdAt))
        const live = s.battles.filter((b) => b.status === 'running').sort(by((b) => b.startAt ?? 0))
        const recent = s.battles.filter((b) => b.status === 'done').sort(by((b) => b.endAt ?? 0))
        const mine = s.battles
          .filter((b) => b.seats.some(isMe) && (b.status === 'open' || b.status === 'running' || (b.status === 'done' && now - (b.endAt ?? 0) < 10 * 60_000)))
          .sort(by((b) => b.createdAt))
        return {
          now,
          open: open.slice(0, 30).map((b) => listed(b, now, false)),
          live: live.slice(0, 20).map((b) => listed(b, now, false)),
          recent: recent.slice(0, 12).map((b) => listed(b, now, true)),
          mine: mine.map((b) => listed(b, now, b.status === 'done')),
        }
      }),
    state: async (id) =>
      tx((s, now) => {
        const b = s.battles.find((x) => x.id === id)
        if (!b) throw new BattleGone()
        return view(b, now)
      }),
    create: async (a): Promise<CbRes<{ battle: BattleView }>> =>
      tx((s, now) => {
        const unit = Math.round(a.unit * 100) / 100
        if (!MODES.includes(a.mode) || !(unit >= LIMITS.MIN_UNIT && unit <= LIMITS.MAX_UNIT) || !a.cases.length || a.cases.length > LIMITS.MAX_CASES || a.cases.some((t) => !TIERS.includes(t)))
          return fail('invalid')
        if (costOf(unit, a.cases) > LIMITS.MAX_COST) return fail('invalid')
        if (openSeats(s) >= LIMITS.MAX_OPEN) return fail('limit')
        const b: LBattle = {
          id: ++s.seq,
          status: 'open',
          mode: a.mode,
          crazy: !!a.crazy,
          unit,
          cases: [...a.cases],
          seats: Array.from({ length: SEATS[a.mode] }, (_, i) => (i === 0 ? { player: guestId, name: cleanName(a.name), avatar: guestAvatar(), bot: false } : null)),
          createdAt: now,
          startAt: null,
          endAt: null,
          results: null,
          winners: null,
          payouts: null,
          pot: null,
        }
        s.battles.push(b)
        return { ok: true as const, battle: view(b, now) }
      }),
    join: async (id, seat, name): Promise<CbRes<{ battle: BattleView }>> =>
      tx((s, now) => {
        const b = s.battles.find((x) => x.id === id)
        if (!b) return fail('gone')
        if (b.status !== 'open') return fail('started')
        if (b.seats.some(isMe)) return fail('already')
        const free = b.seats.findIndex((x) => !x)
        if (free < 0) return fail('full')
        const at = seat == null ? free : seat - 1
        if (at < 0 || at >= b.seats.length) return fail('invalid')
        if (b.seats[at]) return fail('taken')
        if (openSeats(s) >= LIMITS.MAX_OPEN) return fail('limit')
        b.seats[at] = { player: guestId, name: cleanName(name), avatar: guestAvatar(), bot: false }
        if (b.seats.every(Boolean)) start(b, now)
        return { ok: true as const, battle: view(b, now) }
      }),
    bots: async (id): Promise<CbRes<{ battle: BattleView }>> =>
      tx((s, now) => {
        const b = s.battles.find((x) => x.id === id)
        if (!b) return fail('gone')
        if (b.status !== 'open') return fail('started')
        if (!b.seats.some(isMe)) return fail('not-seated')
        fillWithBots(b)
        start(b, now)
        return { ok: true as const, battle: view(b, now) }
      }),
    leave: async (id): Promise<CbRes<{ cancelled: boolean }>> =>
      tx((s) => {
        const b = s.battles.find((x) => x.id === id)
        if (!b) return fail('gone')
        if (b.status !== 'open') return fail('started')
        const at = b.seats.findIndex(isMe)
        if (at < 0) return fail('not-seated')
        if (at === 0) {
          b.status = 'cancelled'
          return { ok: true as const, cancelled: true }
        }
        b.seats[at] = null
        return { ok: true as const, cancelled: false }
      }),
    result: async (id): Promise<CbResult> =>
      tx((s) => {
        const b = s.battles.find((x) => x.id === id)
        if (!b) return { state: 'gone' as const }
        const at = b.seats.findIndex(isMe)
        if (at < 0) return { state: 'none' as const }
        if (b.status === 'done') return { state: 'done' as const, cost: costOf(b.unit, b.cases), payout: b.payouts?.[at] ?? 0 }
        return { state: b.status }
      }),
  }
}
