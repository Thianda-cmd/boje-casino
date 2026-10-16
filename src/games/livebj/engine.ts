import { REACTIONS, TIMING } from './types'
import type { BjError, HandView, LobbyFeed, LobbyTable, Outcome, Phase, ReactionCode, RoundDetail, RoundResult, TableFeed } from './types'

/*
  Live Blackjack rules engine: a TypeScript copy of the database functions in api/_lib/schema.js. The local
  stand-in (local.ts) runs on it when the shared tables can't be reached. Each bj* function takes the same
  arguments as its SQL twin plus the database, a random source and the clock, and returns the same JSON, except
  that etag is '' and 'same' is never sent. Internals keep the SQL names (advance, deal, nextTurn, dealer, ...).

  Money is held in integer cents, so a 3:2 payout rounds exactly like numeric(14, 2). Nothing here reads the
  real clock or the DOM. tools/livebj-sql/crosscheck.mjs replays identical calls through both and compares
  every result and every row.
*/

const {
  BET_MS, ALL_IN_MS, CLOSE_EARLY_MS, SHUFFLE_MS, DEAL_LEAD_MS, CARD_MS, DEAL_SETTLE_MS, PEEK_MS, TURN_MS, HIT_TURN_MS,
  AWAY_TURN_MS, TURN_GRACE_MS, BUST_NEXT_MS, DOUBLE_NEXT_MS, SPLIT_CARD0_MS, SPLIT_CARD1_MS, SPLIT_TURN_MS, HOLE_MS,
  DRAW_MS, RESULT_LAG_MS, RESULT_MS, LOOK_MS, AWAY_MS, STALE_SEAT_MS, WAIT_SEAT_MS, IDLE_ROUNDS, HEARTBEAT_MS,
  REACTION_GAP_MS, REACTION_WINDOW_MS, REACTION_MAX,
} = TIMING

const SHOE_SIZE = 312
const MAX_STEPS = 25 // transitions one advance may apply
const IDLE_CAP = 100
const LEAVE_LOOK_MS = 25000 // bj_away backdates the heartbeat this far, so the seat frees ~5 s later
const WATCH_WINDOW_MS = 20000 // a viewer counts as watching this long after their last poll
const WATCH_WRITE_MS = 5000
const REACTION_LIST_MS = 8000
const CLEAN_MS = 60000 // watchers and reactions older than this go at the next advance
const CLEAN_DUE_MS = 120000 // ... and rows this old force one
const KEEP_ROUNDS_MS = 3 * 86400000

/* ---------- rows ---------- */

type Stored = 'waiting' | 'betting' | 'turns' | 'dealer'

export interface TableRow {
  id: number
  name: string
  minC: number
  maxC: number
  seats: number
  sort: number
  listed: boolean
  shoe: number[]
  pos: number
  cut: number
  shoeNo: number
  roundId: number | null
}
export interface RoundRow {
  id: number
  tableId: number
  phase: Stored
  ver: number
  openedAt: number
  betEndsAt: number | null
  dealEndsAt: number | null
  shuffled: boolean
  peek: boolean
  dealer: number[]
  dealerAt: number[]
  holeAt: number | null
  turnSeat: number | null
  turnHand: 0 | 1 | null
  turnAt: number | null
  turnEndsAt: number | null
  turnAway: boolean
  resultsAt: number | null
  nextAt: number | null
}
export interface SeatRow {
  tableId: number
  seat: number
  player: string
  dev: string | null
  name: string
  avatar: number
  sid: string
  seenAt: number
  joinedAt: number
  idle: number
  leaving: boolean
}
export interface HandRow {
  roundId: number
  seat: number
  idx: 0 | 1
  player: string
  dev: string | null
  name: string
  avatar: number
  sid: string
  betC: number
  cards: number[]
  cardAt: number[]
  doubled: boolean
  split: boolean
  done: boolean
  auto: boolean
  outcome: Outcome | null
  payoutC: number | null
}
export interface WatchRow {
  tableId: number
  viewer: string
  seenAt: number
}
export interface ReactionRow {
  id: number
  tableId: number
  seat: number
  player: string
  code: ReactionCode
  at: number
}
export interface DB {
  tables: TableRow[]
  rounds: RoundRow[]
  seats: SeatRow[]
  hands: HandRow[]
  watch: WatchRow[]
  reactions: ReactionRow[]
  /** identity sequences: the last round and reaction ids handed out */
  seq: { round: number; reaction: number }
}

/** shoe(): 312 card ids, six of each; cut(): 234..260; uuid(): a 32-hex seat token */
export interface Rng {
  shoe(): number[]
  cut(): number
  uuid(): string
}

/* ---------- replies (the JSON the database sends) ---------- */

/** a player's card: unlike dealer cards, hand cards carry no flip time */
export interface HandCard {
  c: number
  at: number
}
export type ViewHand = Omit<HandView, 'cards'> & { cards: HandCard[] }
/** _bj_view: a TableFeed without etag (bj_state adds it; action replies send the view as is) */
export type View = Omit<TableFeed, 'etag' | 'hands'> & { hands: ViewHand[] }
type Fail = { ok: false; error: BjError; state?: View; round?: number; bet?: number; table?: number; seat?: number }
export type Reply<T = unknown> = ({ ok: true; state?: View } & T) | Fail

/* ---------- the seeded tables ---------- */

export interface TableDef {
  id: number
  name: string
  min: number
  max: number
  seats: number
  sort: number
  listed: boolean
}
/** the rows inserted into bj_table */
export const TABLES: TableDef[] = [
  { id: 1, name: 'Emerald', min: 1, max: 100, seats: 5, sort: 1, listed: true },
  { id: 2, name: 'Jade', min: 1, max: 100, seats: 5, sort: 2, listed: true },
  { id: 3, name: 'Sapphire', min: 5, max: 500, seats: 5, sort: 3, listed: true },
  { id: 4, name: 'Cobalt', min: 5, max: 500, seats: 5, sort: 4, listed: true },
  { id: 5, name: 'Ruby Room', min: 25, max: 2500, seats: 5, sort: 5, listed: true },
  { id: 6, name: 'High Roller', min: 100, max: 10000, seats: 5, sort: 6, listed: true },
  { id: 99, name: 'Test Table', min: 1, max: 100, seats: 5, sort: 99, listed: false },
]

/* ---------- helpers ---------- */

const GUEST = /^g_[a-z0-9]{12,40}$/
const BOT = /^bot_[a-z]{2,20}$/

/** _bj_player. Local mode has no accounts, so house bots take the place of signed-in players (guest: false). */
export const playerOf = (p: string | null | undefined) => (p != null && (GUEST.test(p) || BOT.test(p)) ? p : null)
const devOf = (p: string | null | undefined) => (p != null && GUEST.test(p) ? p : null)

/** _bj_name: letters, digits, space, _ . - only, trimmed, 16 characters */
const nameOf = (p: string | null | undefined) =>
  Array.from((p ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/^ +| +$/g, ''))
    .slice(0, 16)
    .join('') || 'Player'
const avatarOf = (p: number | null | undefined) => ((Math.trunc(Number(p) || 0) % 16) + 16) % 16

/** numeric round(x, 2) in cents, worked on the decimal text of x: that text is what PostgREST receives */
export function cents(x: number | null | undefined): number | null {
  if (x == null || !Number.isFinite(x)) return null
  const s = String(Math.abs(x))
  if (s.includes('e')) return Math.sign(x) * Math.round(Math.abs(x) * 100)
  const [i, f = ''] = s.split('.')
  const c = Number(i) * 100 + Number((f + '00').slice(0, 2)) + (f.charCodeAt(2) >= 53 ? 1 : 0)
  return x < 0 ? -c : c
}
const money = (c: number) => c / 100

/** comparisons against a nullable column, false on null as in SQL */
const ge = (a: number, b: number | null) => b != null && a >= b
const lt = (a: number, b: number | null) => b != null && a < b

export const val = (c: number) => (c % 13 === 0 ? 11 : c % 13 >= 9 ? 10 : (c % 13) + 1)
export function total(cards: readonly number[]) {
  let t = 0
  let a = 0
  for (const c of cards) {
    t += val(c)
    if (c % 13 === 0) a++
  }
  while (t > 21 && a > 0) {
    t -= 10
    a--
  }
  return t
}
export const isBJ = (cards: readonly number[]) => cards.length === 2 && total(cards) === 21
const natural = (h: HandRow) => isBJ(h.cards) && !h.split

const tableOf = (db: DB, id: number) => db.tables.find((t) => t.id === id)
function roundOf(db: DB, id: number | null) {
  // newest last, and nearly every lookup is the current round
  for (let i = db.rounds.length - 1; i >= 0; i--) if (db.rounds[i].id === id) return db.rounds[i]
}
const handsOf = (db: DB, rid: number) => db.hands.filter((h) => h.roundId === rid).sort((a, b) => a.seat - b.seat || a.idx - b.idx)
const patch = <T extends object>(row: T, v: Partial<T>) => Object.assign(row, v)
const bump = (db: DB, rid: number | null) => {
  const r = roundOf(db, rid)
  if (r) r.ver++
}
const fail = (error: BjError): Fail => ({ ok: false, error })

/** next card from the table's shoe; an emergency reshuffle if a freak round empties it */
function draw(rng: Rng, t: TableRow) {
  if (t.pos >= t.shoe.length) {
    t.shoe = rng.shoe()
    t.pos = 1
  } else t.pos++
  return t.shoe[t.pos - 1]
}

/** 15 s for a present player, 4 s when away (no heartbeat for 10 s) or leaving */
const turnLen = (db: DB, tid: number, seat: number, now: number) =>
  db.seats.some((s) => s.tableId === tid && s.seat === seat && !s.leaving && s.seenAt >= now - AWAY_MS) ? TURN_MS : AWAY_TURN_MS

/** does this seat hold a hand in a round whose results are not out yet? */
function live(db: DB, tid: number, seat: number, now: number) {
  const r = roundOf(db, tableOf(db, tid)?.roundId ?? null)
  return !!r && db.hands.some((h) => h.roundId === r.id && h.seat === seat) && (r.phase !== 'dealer' || lt(now, r.resultsAt))
}

/** betting closes early once every present seated player has bet */
function allIn(db: DB, rid: number, tid: number, now: number) {
  const r = roundOf(db, rid)
  if (!r || r.phase !== 'betting' || r.betEndsAt == null || r.betEndsAt <= now + ALL_IN_MS) return
  const waitingFor = db.seats.some(
    (s) => s.tableId === tid && !s.leaving && s.seenAt >= now - AWAY_MS && !db.hands.some((h) => h.roundId === rid && h.seat === s.seat),
  )
  if (waitingFor) return
  r.betEndsAt = now + ALL_IN_MS
  r.ver++
}

/** seats that may go: no hand this round, and leaving, unseen for 30 s, or past the waiting-room deadline */
const removable = (db: DB, s: SeatRow, r: RoundRow | undefined, now: number) =>
  (s.leaving || s.seenAt < now - STALE_SEAT_MS || (r?.phase === 'waiting' && Math.max(s.joinedAt, r.openedAt) <= now - WAIT_SEAT_MS)) &&
  !db.hands.some((h) => h.roundId === r?.id && h.seat === s.seat)

export function createDB(tables: TableDef[] = TABLES): DB {
  return seed({ tables: [], rounds: [], seats: [], hands: [], watch: [], reactions: [], seq: { round: 0, reaction: 0 } }, tables)
}

/** insert ... on conflict (id) do update: new tables appear, existing ones take the new name and limits */
export function seed(db: DB, tables: TableDef[] = TABLES): DB {
  for (const d of tables) {
    const def = { name: d.name, minC: cents(d.min)!, maxC: cents(d.max)!, seats: d.seats, sort: d.sort, listed: d.listed }
    const t = tableOf(db, d.id)
    if (t) patch(t, def)
    else db.tables.push({ id: d.id, ...def, shoe: [], pos: 0, cut: 0, shoeNo: 0, roundId: null })
  }
  return db
}

/* ---------- state machine ---------- */

/** dealer plays from base: the hole flips at base + 500 and draws follow every 850 ms; outcomes are fixed now */
function dealer(db: DB, rng: Rng, rid: number, base: number) {
  const r = roundOf(db, rid)!
  const t = tableOf(db, r.tableId)!
  const d = [...r.dealer]
  const dat = [...r.dealerAt]
  const flip = base + HOLE_MS
  const hands = handsOf(db, rid)
  const dbj = isBJ(d)
  let j = 0
  if (!dbj && hands.some((h) => total(h.cards) <= 21 && !natural(h))) {
    while (total(d) < 17) {
      j++
      d.push(draw(rng, t))
      dat.push(flip + j * DRAW_MS)
    }
  }
  const dt = total(d)
  for (const h of hands) {
    const ht = total(h.cards)
    h.done = true
    h.outcome =
      ht > 21 ? 'bust'
      : natural(h) && !dbj ? 'blackjack'
      : dbj && !natural(h) ? 'lose'
      : dbj ? 'push'
      : dt > 21 || ht > dt ? 'win'
      : ht === dt ? 'push'
      : 'lose'
    h.payoutC =
      h.outcome === 'blackjack' ? Math.round((h.betC * 5) / 2)
      : h.outcome === 'win' ? h.betC * 2
      : h.outcome === 'push' ? h.betC
      : 0
  }
  patch(r, {
    phase: 'dealer',
    dealer: d,
    dealerAt: dat,
    holeAt: flip,
    turnSeat: null,
    turnHand: null,
    turnAt: null,
    turnEndsAt: null,
    turnAway: false,
    resultsAt: flip + j * DRAW_MS + RESULT_LAG_MS,
    nextAt: flip + j * DRAW_MS + RESULT_LAG_MS + RESULT_MS,
  })
  r.ver++
}

/** the next undecided hand after (aSeat, aIdx), or the dealer if there is none */
function nextTurn(db: DB, rng: Rng, rid: number, aSeat: number, aIdx: number, base: number, now: number) {
  const r = roundOf(db, rid)!
  const st = Math.max(base, now)
  const after = (h: HandRow) => h.seat > aSeat || (h.seat === aSeat && h.idx > aIdx)
  // hands of players who have left stand as the turn passes them
  for (const x of handsOf(db, rid)) {
    if (!x.done && after(x) && db.seats.some((s) => s.tableId === r.tableId && s.seat === x.seat && s.player === x.player && s.leaving)) {
      x.done = true
      x.auto = true
    }
  }
  const h = handsOf(db, rid).find((x) => !x.done && after(x))
  if (!h) return dealer(db, rng, rid, st)
  const len = turnLen(db, r.tableId, h.seat, now)
  patch(r, { phase: 'turns', turnSeat: h.seat, turnHand: h.idx, turnAt: st, turnEndsAt: st + len, turnAway: len < TURN_MS })
  r.ver++
}

/** betting is over: deal everything now, reveal it on a schedule */
function deal(db: DB, rng: Rng, rid: number, now: number) {
  const r = roundOf(db, rid)!
  const t = tableOf(db, r.tableId)!
  let st = Math.max(r.betEndsAt ?? now, now)
  let shuffled = false
  if (t.pos >= t.cut || t.shoe.length !== SHOE_SIZE) {
    t.shoe = rng.shoe()
    t.pos = 0
    t.cut = rng.cut()
    t.shoeNo++
    shuffled = true
    st += SHUFFLE_MS
  }
  st += DEAL_LEAD_MS
  const openers = handsOf(db, rid).filter((h) => h.idx === 0)
  const d: number[] = []
  const dat: number[] = []
  let k = 0
  for (let n = 0; n < 2; n++) {
    for (const h of openers) {
      h.cards.push(draw(rng, t))
      h.cardAt.push(st + k * CARD_MS)
      k++
    }
    d.push(draw(rng, t))
    dat.push(st + k * CARD_MS)
    k++
  }
  const peek = val(d[0]) >= 10
  const dend = st + (k - 1) * CARD_MS + DEAL_SETTLE_MS + (peek ? PEEK_MS : 0)
  for (const h of handsOf(db, rid)) if (isBJ(h.cards)) h.done = true
  for (const s of db.seats) {
    if (s.tableId === t.id) s.idle = db.hands.some((x) => x.roundId === rid && x.seat === s.seat) ? 0 : Math.min(s.idle + 1, IDLE_CAP)
  }
  patch(r, { phase: 'turns', dealEndsAt: dend, dealer: d, dealerAt: dat, shuffled, peek })
  r.ver++
  if (peek && isBJ(d)) dealer(db, rng, rid, dend - HOLE_MS) // the hole flips as the peek ends
  else nextTurn(db, rng, rid, 0, 0, dend, now)
}

function newRound(db: DB, tid: number, now: number) {
  const id = ++db.seq.round
  db.rounds.push({
    id,
    tableId: tid,
    phase: 'waiting',
    ver: 0,
    openedAt: now,
    betEndsAt: null,
    dealEndsAt: null,
    shuffled: false,
    peek: false,
    dealer: [],
    dealerAt: [],
    holeAt: null,
    turnSeat: null,
    turnHand: null,
    turnAt: null,
    turnEndsAt: null,
    turnAway: false,
    resultsAt: null,
    nextAt: null,
  })
  tableOf(db, tid)!.roundId = id
  db.seats = db.seats.filter((s) => !(s.tableId === tid && (s.leaving || s.idle >= IDLE_ROUNDS)))
  if (id % 100 === 0) {
    const live = new Set(db.tables.map((t) => t.roundId))
    const old = new Set(db.rounds.filter((r) => (r.nextAt ?? r.openedAt) < now - KEEP_ROUNDS_MS && !live.has(r.id)).map((r) => r.id))
    db.rounds = db.rounds.filter((r) => !old.has(r.id))
    db.hands = db.hands.filter((h) => !old.has(h.roundId))
  }
}

/** seats that may go, then stale watchers and reactions */
function housekeep(db: DB, tid: number, now: number) {
  const r = roundOf(db, tableOf(db, tid)!.roundId)
  const n = db.seats.length
  db.seats = db.seats.filter((s) => !(s.tableId === tid && removable(db, s, r, now)))
  if (db.seats.length < n && r) r.ver++
  db.watch = db.watch.filter((w) => !(w.tableId === tid && w.seenAt < now - CLEAN_MS))
  db.reactions = db.reactions.filter((x) => !(x.tableId === tid && x.at < now - CLEAN_MS))
}

/** does anything need advancing or cleaning? */
export function due(db: DB, tid: number, now: number) {
  const t = tableOf(db, tid)
  if (!t) return false
  const r = roundOf(db, t.roundId)
  if (!r) return true
  return (
    (r.phase === 'betting' && ge(now, r.betEndsAt)) ||
    (r.phase === 'turns' && r.turnEndsAt != null && now >= r.turnEndsAt + TURN_GRACE_MS) ||
    (r.phase === 'turns' && ge(now, r.dealEndsAt) && db.seats.some((s) => s.tableId === tid && s.seat === r.turnSeat && s.leaving)) ||
    (r.phase === 'dealer' && ge(now, r.nextAt)) ||
    db.seats.some((s) => s.tableId === tid && removable(db, s, r, now)) ||
    db.watch.some((w) => w.tableId === tid && w.seenAt < now - CLEAN_DUE_MS) ||
    db.reactions.some((x) => x.tableId === tid && x.at < now - CLEAN_DUE_MS)
  )
}

/** applies every transition that is due; a second call at the same now does nothing */
export function advance(db: DB, rng: Rng, tid: number, now: number) {
  for (let n = 0; n < MAX_STEPS; n++) {
    const r = roundOf(db, tableOf(db, tid)!.roundId)
    if (!r) newRound(db, tid, now)
    else if (r.phase === 'betting' && ge(now, r.betEndsAt)) deal(db, rng, r.id, now)
    else if (
      r.phase === 'turns' &&
      ((r.turnEndsAt != null && now >= r.turnEndsAt + TURN_GRACE_MS) ||
        (ge(now, r.dealEndsAt) && db.seats.some((s) => s.tableId === tid && s.seat === r.turnSeat && s.leaving)))
    ) {
      for (const h of db.hands) {
        if (h.roundId === r.id && h.seat === r.turnSeat && h.idx === r.turnHand) {
          h.done = true
          h.auto = true
        }
      }
      nextTurn(db, rng, r.id, r.turnSeat!, r.turnHand!, now, now)
    } else if (r.phase === 'dealer' && ge(now, r.nextAt)) newRound(db, tid, now)
    else break
  }
  housekeep(db, tid, now)
}

/* ---------- what a client sees ---------- */

const watchers = (db: DB, tid: number, now: number) =>
  Math.min(
    99,
    db.watch.filter((w) => w.tableId === tid && w.seenAt > now - WATCH_WINDOW_MS && !db.seats.some((s) => s.tableId === tid && s.player === w.viewer)).length,
  )

export function view(db: DB, tid: number, me: string | null, sid: string | null, now: number): View {
  const t = tableOf(db, tid)!
  const r = roundOf(db, t.roundId)!
  const look = now + LOOK_MS // cards may be sent up to 1 s before they land
  const ph: Phase =
    r.phase === 'waiting' || r.phase === 'betting' ? r.phase
    : lt(now, r.dealEndsAt) ? 'dealing'
    : r.phase === 'turns' ? 'turns'
    : lt(now, r.resultsAt) ? 'dealer'
    : 'done'
  const dealing = ph === 'dealing'
  const open = r.phase === 'dealer' && !dealing
  const results = (ph === 'dealer' || ph === 'done') && r.resultsAt != null && r.resultsAt <= look
  const started = ph !== 'waiting' && ph !== 'betting'
  const ms = me == null ? undefined : db.seats.find((s) => s.player === me)
  const mq = ms && roundOf(db, tableOf(db, ms.tableId)!.roundId)

  const past = new Map<number, { round: number; table: number; bet: number; payout: number }>()
  if (me != null) {
    const rounds = new Map(db.rounds.map((q) => [q.id, q]))
    for (const h of db.hands) {
      if (h.player !== me) continue
      const q = rounds.get(h.roundId)
      if (!q || q.phase !== 'dealer' || q.resultsAt == null || q.resultsAt > now) continue
      const p = past.get(q.id) ?? { round: q.id, table: q.tableId, bet: 0, payout: 0 }
      p.bet += h.betC
      p.payout += h.payoutC ?? 0
      past.set(q.id, p)
    }
  }

  return {
    now,
    table: {
      id: t.id,
      name: t.name,
      min: money(t.minC),
      max: money(t.maxC),
      seats: t.seats,
      // dealer cards drawn but not shown yet still count as in the shoe
      cardsLeft: Math.max(t.shoe.length - t.pos, 0) + r.dealerAt.filter((at, i) => i >= 2 && at > look).length,
      shoeNo: t.shoeNo,
      watchers: watchers(db, t.id, now),
    },
    round: {
      id: r.id,
      ver: r.ver,
      phase: ph,
      openedAt: r.openedAt,
      betEndsAt: r.betEndsAt,
      dealEndsAt: started ? r.dealEndsAt : null,
      shuffle: started && r.shuffled,
      peek: started && r.peek,
      turn: ph === 'turns' ? { seat: r.turnSeat!, hand: r.turnHand!, at: r.turnAt!, endsAt: r.turnEndsAt!, away: r.turnAway } : null,
      resultsAt: ph === 'dealer' || ph === 'done' ? r.resultsAt : null,
      nextAt: ph === 'dealer' || ph === 'done' ? r.nextAt : null,
    },
    dealer: r.dealer.flatMap((c, i) =>
      r.dealerAt[i] <= look && (i < 2 || open)
        ? [{ c: i === 1 && !open ? null : c, at: r.dealerAt[i], flip: i === 1 && open ? r.holeAt : null }]
        : [],
    ),
    seats: Array.from({ length: t.seats }, (_, i) => {
      const s = db.seats.find((x) => x.tableId === t.id && x.seat === i + 1)
      return s
        ? { seat: i + 1, name: s.name, avatar: s.avatar, guest: s.player.startsWith('g_'), me: s.player === me, away: s.seenAt < now - AWAY_MS, idle: s.idle, leaving: s.leaving }
        : null
    }),
    hands: handsOf(db, r.id).map((h) => ({
      seat: h.seat,
      idx: h.idx,
      name: h.name,
      avatar: h.avatar,
      guest: h.player.startsWith('g_'),
      mine: h.player === me,
      ctl: h.player === me && h.sid === sid,
      bet: money(h.betC),
      doubled: h.doubled,
      split: h.split,
      done: dealing ? false : h.done,
      auto: dealing ? false : h.auto,
      cards: h.cards.flatMap((c, i) => (h.cardAt[i] <= look ? [{ c, at: h.cardAt[i] }] : [])),
      outcome: results ? h.outcome : null,
      payout: results && h.payoutC != null ? money(h.payoutC) : null,
    })),
    mine: ms
      ? {
          table: ms.tableId,
          seat: ms.seat,
          active: ms.sid === sid,
          idle: ms.idle,
          leaving: ms.leaving,
          expiresAt: mq?.phase === 'waiting' ? Math.max(ms.joinedAt, mq.openedAt) + WAIT_SEAT_MS : null,
        }
      : null,
    reactions: db.reactions
      .filter((x) => x.tableId === t.id && x.at > now - REACTION_LIST_MS)
      .sort((a, b) => a.id - b.id)
      .map((x) => ({ id: x.id, seat: x.seat, code: x.code, at: x.at })),
    history: db.rounds
      .filter((q) => q.tableId === t.id && q.phase === 'dealer' && q.resultsAt != null && q.resultsAt <= now)
      .sort((a, b) => b.id - a.id)
      .slice(0, 12)
      .map((q) => ({ id: q.id, total: total(q.dealer), bj: isBJ(q.dealer) })),
    past: [...past.values()]
      .sort((a, b) => b.round - a.round)
      .slice(0, 8)
      .map((p) => ({ ...p, bet: money(p.bet), payout: money(p.payout) })),
  }
}

/* ---------- public functions ---------- */

export function bjState(
  db: DB,
  rng: Rng,
  now: number,
  a: { table: number; player: string | null; sid: string | null },
): (View & { etag: string }) | { error: 'table' } {
  const t = tableOf(db, a.table)
  if (!t) return { error: 'table' }
  const me = playerOf(a.player)
  // the owner of a short (away) turn is back: give them the full 15 s
  const backFromAway = () => {
    const r = roundOf(db, t.roundId)
    return (
      !!r &&
      r.phase === 'turns' &&
      r.turnAway &&
      ge(now, r.dealEndsAt) &&
      r.turnEndsAt != null &&
      now < r.turnEndsAt + TURN_GRACE_MS &&
      db.hands.some((h) => h.roundId === r.id && h.seat === r.turnSeat && h.idx === r.turnHand && h.player === me && h.sid === a.sid)
    )
  }
  const ext = me != null && a.sid != null && backFromAway()
  if (ext || due(db, t.id, now)) {
    advance(db, rng, t.id, now)
    if (ext && backFromAway()) {
      const r = roundOf(db, t.roundId)!
      r.turnEndsAt = r.turnAt! + TURN_MS
      r.turnAway = false
      r.ver++
    }
  }
  if (me != null) {
    // heartbeat at most every 3 s; only the tab that controls the seat keeps it alive
    for (const s of db.seats) if (s.player === me && s.tableId === t.id && s.sid === a.sid && s.seenAt < now - HEARTBEAT_MS) s.seenAt = now
    const w = db.watch.find((x) => x.tableId === t.id && x.viewer === me)
    if (!w) db.watch.push({ tableId: t.id, viewer: me, seenAt: now })
    else if (w.seenAt < now - WATCH_WRITE_MS) w.seenAt = now
  }
  return { ...view(db, t.id, me, a.sid, now), etag: '' }
}

export function bjTables(db: DB, rng: Rng, now: number, a: { player: string | null; sid: string | null }): LobbyFeed {
  const me = playerOf(a.player)
  const listed = db.tables.filter((t) => t.listed)
  for (const t of [...listed].sort((x, y) => x.id - y.id)) if (due(db, t.id, now)) advance(db, rng, t.id, now)
  if (me != null && a.sid != null) {
    // the lobby keeps your seat alive too
    for (const s of db.seats) if (s.player === me && s.sid === a.sid && s.seenAt < now - HEARTBEAT_MS) s.seenAt = now
  }
  const ms = me == null ? undefined : db.seats.find((s) => s.player === me)
  return {
    now,
    tables: [...listed]
      .sort((x, y) => x.sort - y.sort || x.id - y.id)
      .map((b): LobbyTable => {
        const r = roundOf(db, b.roundId)
        return {
          id: b.id,
          name: b.name,
          min: money(b.minC),
          max: money(b.maxC),
          seats: b.seats,
          players: db.seats
            .filter((s) => s.tableId === b.id)
            .sort((x, y) => x.seat - y.seat)
            .map((s) => ({ seat: s.seat, name: s.name, avatar: s.avatar, guest: s.player.startsWith('g_') })),
          watchers: watchers(db, b.id, now),
          phase:
            !r || r.phase === 'waiting' ? 'waiting'
            : r.phase === 'betting' ? 'betting'
            : r.phase === 'turns' || lt(now, r.resultsAt) ? 'playing'
            : 'done',
          betEndsAt: r?.betEndsAt ?? null,
        }
      }),
    mine: ms ? { table: ms.tableId, seat: ms.seat, active: ms.sid === a.sid } : null,
  }
}

/** sit down, move seats, rename (same sid), or take the seat over from another tab (new sid) */
export function bjSit(
  db: DB,
  rng: Rng,
  now: number,
  a: { table: number; seat: number | null; player: string | null; sid: string | null; name: string | null; avatar: number | null },
): Reply<{ seat: number; sid: string }> {
  const me = playerOf(a.player)
  const dv = devOf(a.player)
  const nm = nameOf(a.name)
  const av = avatarOf(a.avatar)
  if (me == null) return fail('player')
  const t = tableOf(db, a.table)
  if (!t) return fail('table')
  const seat = a.seat
  if (seat == null || seat < 1 || seat > t.seats) return fail('seat')
  advance(db, rng, t.id, now)
  const rid = t.roundId
  const s = db.seats.find((x) => x.player === me)
  if (s && s.tableId === t.id && s.seat === seat) {
    let sid = s.sid
    if (a.sid != null && s.sid === a.sid) {
      // same tab: rename / refresh, control unchanged
      patch(s, { name: nm, avatar: av, seenAt: now, leaving: false, dev: dv ?? s.dev })
    } else {
      sid = rng.uuid()
      patch(s, { sid, dev: dv, name: nm, avatar: av, seenAt: now, leaving: false })
      // same browser: this round's hands follow the seat to the new tab
      if (dv != null) for (const h of db.hands) if (h.roundId === rid && h.player === me && h.dev === dv) h.sid = sid
    }
    bump(db, rid)
    return { ok: true, seat, sid, state: view(db, t.id, me, sid, now) }
  }
  if (s && live(db, s.tableId, s.seat, now)) return { ok: false, error: 'busy', table: s.tableId, seat: s.seat }
  // someone sits there, or holds this round's hand there
  if (db.seats.some((x) => x.tableId === t.id && x.seat === seat) || db.hands.some((x) => x.roundId === rid && x.seat === seat && x.player !== me)) {
    return fail('taken')
  }
  if (s) {
    db.seats = db.seats.filter((x) => x !== s)
    const old = tableOf(db, s.tableId)!.roundId
    bump(db, old)
    // moving to another table is leaving this one: everyone still sitting there may have bet by now
    if (s.tableId !== t.id && old != null) allIn(db, old, s.tableId, now)
  }
  const sid = rng.uuid()
  db.seats.push({ tableId: t.id, seat, player: me, dev: dv, name: nm, avatar: av, sid, seenAt: now, joinedAt: now, idle: 0, leaving: false })
  bump(db, rid)
  return { ok: true, seat, sid, state: view(db, t.id, me, sid, now) }
}

/** the page is going away: look away now, so the seat frees in ~5 s unless this tab polls again */
export function bjAway(db: DB, now: number, a: { table: number; player: string | null; sid: string | null }): { ok: true; away: boolean } {
  const me = playerOf(a.player)
  const s = db.seats.find((x) => x.tableId === a.table && x.player === me && x.sid === a.sid)
  if (s) s.seenAt = Math.min(s.seenAt, now - LEAVE_LOOK_MS)
  return { ok: true, away: !!s }
}

/** works from any tab: betting -> bet cancelled and seat freed; mid-round -> hands stand, seat frees at round end */
export function bjLeave(
  db: DB,
  rng: Rng,
  now: number,
  a: { table: number; player: string | null; sid: string | null },
): Reply<{ cancelled?: number; leaving?: boolean; gone?: boolean; round?: number }> {
  const me = playerOf(a.player)
  if (me == null) return fail('player')
  const t = tableOf(db, a.table)
  if (!t) return fail('table')
  advance(db, rng, t.id, now)
  const s = db.seats.find((x) => x.tableId === t.id && x.player === me)
  if (!s) return { ok: true, gone: true }
  const r = roundOf(db, t.roundId)!
  const drop = () => (db.seats = db.seats.filter((x) => x !== s))
  if (r.phase === 'waiting' || r.phase === 'betting') {
    const mine = (h: HandRow) => h.roundId === r.id && h.seat === s.seat
    const cancelled = db.hands.filter(mine).reduce((sum, h) => sum + h.betC, 0)
    db.hands = db.hands.filter((h) => !mine(h))
    drop()
    if (r.phase === 'betting' && !db.hands.some((h) => h.roundId === r.id)) {
      // the last bet is gone: the round waits again, with a fresh waiting-room clock
      patch(r, { phase: 'waiting', betEndsAt: null, openedAt: now, ver: r.ver + 1 })
    } else {
      r.ver++
      allIn(db, r.id, t.id, now)
    }
    return { ok: true, cancelled: money(cancelled), round: r.id }
  }
  if (live(db, t.id, s.seat, now)) {
    s.leaving = true
    if (r.phase === 'turns' && r.turnSeat === s.seat && ge(now, r.dealEndsAt)) {
      for (const h of db.hands) {
        if (h.roundId === r.id && h.seat === s.seat && !h.done) {
          h.done = true
          h.auto = true
        }
      }
      nextTurn(db, rng, r.id, s.seat, 1, now, now)
    }
    r.ver++
    return { ok: true, leaving: true, round: r.id }
  }
  drop()
  r.ver++
  return { ok: true, round: r.id }
}

export function bjBet(
  db: DB,
  rng: Rng,
  now: number,
  a: { table: number; round: number | null; player: string | null; sid: string | null; amount: number | null },
): Reply<{ round: number; bet: number }> {
  const me = playerOf(a.player)
  const amt = cents(a.amount)
  if (me == null) return fail('player')
  const t = tableOf(db, a.table)
  if (!t) return fail('table')
  advance(db, rng, t.id, now)
  const s = db.seats.find((x) => x.tableId === t.id && x.player === me)
  if (!s) return fail('not-seated')
  if (s.sid !== a.sid) return fail('other-tab')
  if (s.leaving) return fail('leaving')
  const r = roundOf(db, t.roundId)!
  const had = db.hands.find((h) => h.roundId === r.id && h.seat === s.seat && h.idx === 0)
  if (had) {
    // a retry of a bet that already landed
    if (r.id === a.round && had.betC === amt) return { ok: true, round: r.id, bet: money(had.betC), state: view(db, t.id, me, a.sid, now) }
    return { ok: false, error: 'already', round: r.id, bet: money(had.betC) }
  }
  if (r.id !== a.round) return { ok: false, error: 'stale', round: r.id }
  if ((r.phase !== 'waiting' && r.phase !== 'betting') || (r.phase === 'betting' && r.betEndsAt != null && now >= r.betEndsAt - CLOSE_EARLY_MS)) {
    return { ok: false, error: 'closed', round: r.id }
  }
  if (amt == null || amt < t.minC) return fail('min')
  if (amt > t.maxC) return fail('max')
  db.hands.push({
    roundId: r.id,
    seat: s.seat,
    idx: 0,
    player: me,
    dev: s.dev,
    name: s.name,
    avatar: s.avatar,
    sid: s.sid,
    betC: amt,
    cards: [],
    cardAt: [],
    doubled: false,
    split: false,
    done: false,
    auto: false,
    outcome: null,
    payoutC: null,
  })
  s.seenAt = now
  s.idle = 0
  r.phase = 'betting'
  r.betEndsAt ??= now + BET_MS
  r.ver++
  allIn(db, r.id, t.id, now)
  return { ok: true, round: r.id, bet: money(amt), state: view(db, t.id, me, a.sid, now) }
}

export function bjAction(
  db: DB,
  rng: Rng,
  now: number,
  a: { table: number; round: number | null; player: string | null; sid: string | null; hand: number | null; n: number | null; action: string | null },
): Reply {
  const me = playerOf(a.player)
  if (me == null) return fail('player')
  const act = a.action
  if (act !== 'hit' && act !== 'stand' && act !== 'double' && act !== 'split') return fail('invalid')
  const t = tableOf(db, a.table)
  if (!t) return fail('table')
  advance(db, rng, t.id, now)
  const s = db.seats.find((x) => x.tableId === t.id && x.player === me)
  if (!s) return fail('not-seated')
  const r = roundOf(db, t.roundId)!
  const no = (error: BjError): Fail => ({ ok: false, error, state: view(db, t.id, me, a.sid, now) })
  if (r.id !== a.round) return no('stale')
  // checked before the phase, so a dealer blackjack and a normal deal answer alike
  if ((r.phase === 'turns' || r.phase === 'dealer') && lt(now, r.dealEndsAt)) return no('dealing')
  if (r.phase !== 'turns' || r.turnSeat !== s.seat || r.turnHand !== a.hand) return no('turn')
  const h = db.hands.find((x) => x.roundId === r.id && x.seat === s.seat && x.idx === a.hand)
  if (!h || h.done || h.player !== me) return no('turn')
  if (h.sid !== a.sid) return no('other-tab')
  if (h.cards.length !== a.n) return no('stale')

  if (act === 'hit') {
    h.cards.push(draw(rng, t))
    h.cardAt.push(now)
    const tot = total(h.cards)
    h.done = tot >= 21
    if (h.done) nextTurn(db, rng, r.id, s.seat, h.idx, now + BUST_NEXT_MS, now)
    else {
      patch(r, { turnAt: now, turnEndsAt: now + HIT_TURN_MS, turnAway: false })
      r.ver++
    }
  } else if (act === 'stand') {
    h.done = true
    nextTurn(db, rng, r.id, s.seat, h.idx, now, now)
  } else if (act === 'double') {
    if (h.cards.length !== 2 || h.doubled) return no('invalid')
    h.betC *= 2
    h.doubled = true
    h.cards.push(draw(rng, t))
    h.cardAt.push(now)
    h.done = true
    nextTurn(db, rng, r.id, s.seat, h.idx, now + DOUBLE_NEXT_MS, now)
  } else {
    if (h.idx !== 0 || h.cards.length !== 2 || val(h.cards[0]) !== val(h.cards[1]) || db.hands.some((x) => x.roundId === r.id && x.seat === s.seat && x.idx === 1)) {
      return no('invalid')
    }
    const aces = h.cards[0] % 13 === 0
    const c0 = draw(rng, t) // hand 0 first, then hand 1, as in single-player
    const c1 = draw(rng, t)
    const h1: HandRow = {
      ...h,
      idx: 1,
      player: me,
      cards: [h.cards[1], c1],
      cardAt: [h.cardAt[1], now + SPLIT_CARD1_MS],
      doubled: false,
      split: true,
      done: false,
      auto: false,
      outcome: null,
      payoutC: null,
    }
    patch(h, { cards: [h.cards[0], c0], cardAt: [h.cardAt[0], now + SPLIT_CARD0_MS], split: true })
    db.hands.push(h1)
    for (const x of [h, h1]) x.done = aces || total(x.cards) === 21
    if (h.done) nextTurn(db, rng, r.id, s.seat, 0, now + SPLIT_TURN_MS, now)
    else {
      patch(r, { turnHand: 0, turnAt: now + SPLIT_TURN_MS, turnEndsAt: now + SPLIT_TURN_MS + TURN_MS, turnAway: false })
      r.ver++
    }
  }
  return { ok: true, state: view(db, t.id, me, a.sid, now) }
}

export function bjReact(db: DB, now: number, a: { table: number; player: string | null; code: string | null }): Reply<{ id: number; at: number }> {
  const me = playerOf(a.player)
  if (me == null) return fail('player')
  const code = REACTIONS.find((c) => c === a.code)
  if (!code) return fail('invalid')
  const s = db.seats.find((x) => x.tableId === a.table && x.player === me)
  if (!s) return fail('not-seated')
  const mine = db.reactions.filter((x) => x.player === me)
  if (mine.some((x) => x.at > now - REACTION_GAP_MS) || mine.filter((x) => x.at > now - REACTION_WINDOW_MS).length >= REACTION_MAX) return fail('rate')
  const id = ++db.seq.reaction
  db.reactions.push({ id, tableId: a.table, seat: s.seat, player: me, code, at: now })
  return { ok: true, id, at: now }
}

/** settles a round the client missed; guest lets a just-signed-up player resolve rounds played as a guest */
export function bjResult(db: DB, now: number, a: { round: number | null; player: string | null; guest: string | null }): RoundResult {
  const me = playerOf(a.player)
  const g = devOf(a.guest)
  if (me == null && g == null) return { state: 'none' }
  const r = roundOf(db, a.round)
  if (!r) return { state: 'gone' }
  if (r.phase !== 'dealer' || lt(now, r.resultsAt)) return { state: 'live' }
  const hs = db.hands.filter((h) => h.roundId === r.id && (h.player === me || h.player === g))
  if (!hs.length) return { state: 'none' }
  return {
    state: 'done',
    table: r.tableId,
    bet: money(hs.reduce((sum, h) => sum + h.betC, 0)),
    payout: money(hs.reduce((sum, h) => sum + (h.payoutC ?? 0), 0)),
  }
}

/** everything about a finished round, for the history modal */
export function bjRoundInfo(db: DB, now: number, a: { round: number | null }): RoundDetail | null {
  const r = roundOf(db, a.round)
  if (!r || r.phase !== 'dealer' || r.resultsAt == null || r.resultsAt > now) return null
  return {
    id: r.id,
    table: r.tableId,
    at: r.resultsAt,
    dealer: [...r.dealer],
    hands: handsOf(db, r.id).map((h) => ({
      seat: h.seat,
      idx: h.idx,
      name: h.name,
      avatar: h.avatar,
      guest: h.player.startsWith('g_'),
      bet: money(h.betC),
      cards: [...h.cards],
      doubled: h.doubled,
      split: h.split,
      auto: h.auto,
      outcome: h.outcome!,
      payout: money(h.payoutC ?? 0),
    })),
  }
}

/** Local only (the database keeps rounds for three days): drop all but each table's newest `keep` rounds. */
export function pruneRounds(db: DB, keep: number) {
  const current = new Set(db.tables.map((t) => t.roundId))
  const old = new Set<number>()
  for (const t of db.tables) {
    const ids = db.rounds.filter((r) => r.tableId === t.id && !current.has(r.id)).map((r) => r.id)
    for (const id of ids.sort((x, y) => y - x).slice(keep)) old.add(id)
  }
  if (!old.size) return
  db.rounds = db.rounds.filter((r) => !old.has(r.id))
  db.hands = db.hands.filter((h) => !old.has(h.roundId))
}
