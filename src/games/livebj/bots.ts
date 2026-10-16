import { rand, randInt } from '../../lib/rng'
import { advance, bjAction, bjBet, bjLeave, bjReact, bjSit, bjTables, due, isBJ, total, val, view, type DB, type Rng } from './engine'
import { TIMING, type Act, type ReactionCode } from './types'

/*
  House bots for the local stand-in: up to three regulars at the open table. They bet, play basic strategy
  at a human pace, send a sticker now and then, and come and go between rounds. Every move goes through the
  same engine calls a person's would (heartbeats included), so the table keeps the shared rules.
*/

export interface Bot {
  id: string
  name: string
  avatar: number
  /** worn instead when the player's avatar is `avatar`: a different colour, and no other bot's */
  alt: number
}
export const BOTS: readonly Bot[] = [
  { id: 'bot_otis', name: 'Otis', avatar: 2, alt: 10 },
  { id: 'bot_hazel', name: 'Hazel', avatar: 5, alt: 13 },
  { id: 'bot_barnaby', name: 'Barnaby', avatar: 9, alt: 11 },
  { id: 'bot_juniper', name: 'Juniper', avatar: 12, alt: 4 },
]
export const isBot = (player: string) => BOTS.some((b) => b.id === player)

/* ---------- basic strategy ---------- */

/** Basic strategy for six decks, dealer stands on soft 17, double after split, no surrender. */
export function basic(cards: readonly number[], up: number, canDouble: boolean, canSplit: boolean): Act {
  const u = val(up) // 2..10, ace 11
  if (canSplit) {
    const p = val(cards[0])
    const split =
      p === 11 ||
      p === 8 ||
      (p === 9 && u !== 7 && u <= 9) ||
      (p === 7 && u <= 7) ||
      (p === 6 && u <= 6) ||
      (p === 4 && (u === 5 || u === 6)) ||
      ((p === 3 || p === 2) && u <= 7)
    if (split) return 'split'
  }
  const t = total(cards)
  const hard = cards.reduce((sum, c) => sum + (c % 13 === 0 ? 1 : val(c)), 0)
  const soft = hard !== t
  // "double, else ..." for when the hand has more than two cards
  const dbl = (yes: boolean, otherwise: Act): Act => (yes && canDouble ? 'double' : otherwise)
  if (soft) {
    if (t >= 19) return 'stand'
    if (t === 18) return u >= 3 && u <= 6 ? dbl(true, 'stand') : u <= 8 ? 'stand' : 'hit'
    if (t === 17) return dbl(u >= 3 && u <= 6, 'hit')
    if (t >= 15) return dbl(u >= 4 && u <= 6, 'hit')
    if (t >= 13) return dbl(u >= 5 && u <= 6, 'hit')
    return 'hit'
  }
  if (t >= 17) return 'stand'
  if (t >= 13) return u <= 6 ? 'stand' : 'hit'
  if (t === 12) return u >= 4 && u <= 6 ? 'stand' : 'hit'
  if (t === 11) return dbl(u <= 10, 'hit')
  if (t === 10) return dbl(u <= 9, 'hit')
  if (t === 9) return dbl(u >= 3 && u <= 6, 'hit')
  return 'hit'
}

/* ---------- pace and manners ---------- */

const between = (lo: number, hi: number) => lo + rand() * (hi - lo)
const chance = (p: number) => rand() < p
const pick = <T>(xs: readonly T[]) => xs[randInt(xs.length)]

/** 0.9 to 3.2 s, quicker for obvious hands and slower for the awkward ones; one decision in ten takes 5 to 8 s */
function think(cards: number[], up: number) {
  if (chance(0.1)) return between(5000, 8000)
  const t = total(cards)
  const easy = t >= 17 || t <= 8 || isBJ(cards)
  const awkward = !easy && t >= 12 && val(up) >= 7
  return 900 + 2300 * rand() ** (easy ? 1.8 : awkward ? 0.6 : 1)
}

/** opening bets in table minimums, weighted 50/30/15/5 */
const STAKES: [number, number][] = [
  [1, 50],
  [2, 30],
  [5, 15],
  [10, 5],
]

/** how a regular answers the player's sticker */
const REPLIES: Record<ReactionCode, ReactionCode[]> = {
  thumbs: ['thumbs', 'cool'],
  haha: ['haha'],
  wow: ['wow', 'fire'],
  cry: ['cry', 'ouch'],
  fire: ['fire', 'hot'],
  clap: ['clap', 'ty'],
  clover: ['clover', 'gl'],
  cool: ['cool', 'thumbs'],
  nice: ['ty', 'thumbs'],
  gl: ['gl', 'ty'],
  hitme: ['haha', 'gl'],
  ouch: ['cry', 'ouch'],
  hot: ['fire', 'wow'],
  gg: ['gg', 'clap'],
  ty: ['thumbs', 'cool'],
  hurry: ['ty', 'haha'],
}

interface Mind {
  /** this round's bet: when, and how much (null: sitting this one out) */
  plan: { round: number; at: number; amount: number | null; placed: boolean } | null
  /** the decision being thought over */
  move: { key: string; at: number } | null
  leaveAt: number | null
  lastBet: number | null
  /** rounds dealt while seated */
  rounds: number
  /** the last round after which getting up was weighed */
  rolled: number
}

const LEAVE_AFTER = 6 // rounds before a regular may get up
const LEAVE_CHANCE = 0.08
const MAX_BOTS = 3
const SAY_GAP_MS = 1800 // between two bots' stickers, so they don't talk over each other

/** A bot's avatar, so that it never looks like the player at the table. */
export const botAvatar = (b: Bot, player: number | null) => (b.avatar === player ? b.alt : b.avatar)

/** A crowd of house bots. step() runs them up to `now` at one table, the one the player has open (whose avatar they avoid). */
export function createHouse(playerAvatar: number | null = null) {
  const minds = new Map<string, Mind>()
  const seen = new Map<string, number>() // events already weighed for a reaction, and when
  let queue: { bot: string; code: ReactionCode; at: number }[] = []
  let lastSaid = 0
  let target = rollTarget()
  let arriveAt: number | null = null
  let waitRounds = 0
  let rounds = 0
  let lastRound = 0
  let filled = 0 // the table that already got its opening crowd

  function rollTarget() {
    const x = rand()
    return x < 0.25 ? 1 : x < 0.7 ? 2 : 3
  }
  const mindOf = (bot: string) => {
    let m = minds.get(bot)
    if (!m) minds.set(bot, (m = { plan: null, move: null, leaveAt: null, lastBet: null, rounds: 0, rolled: 0 }))
    return m
  }
  const once = (key: string, now: number, fn: () => void) => {
    if (seen.has(key)) return
    seen.set(key, now)
    fn()
  }
  const say = (bot: string, code: ReactionCode, at: number) => queue.push({ bot, code, at })

  function stake(m: Mind, min: number, max: number) {
    if (m.lastBet != null && m.lastBet >= min && m.lastBet <= max && chance(0.5)) return m.lastBet
    let x = rand() * 100
    for (const [units, weight] of STAKES) if ((x -= weight) < 0) return Math.min(max, min * units)
    return min
  }

  function step(db: DB, rng: Rng, now: number, table: number) {
    const here = () => db.seats.filter((s) => s.tableId === table && isBot(s.player))

    // regulars still sitting where the player was before get up; that table keeps running until their hands are done
    for (const s of db.seats.filter((x) => isBot(x.player) && x.tableId !== table)) {
      if (due(db, s.tableId, now)) advance(db, rng, s.tableId, now)
      if (s.leaving) continue
      bjLeave(db, rng, now, { table: s.tableId, player: s.player, sid: s.sid })
      minds.delete(s.player)
    }
    // keep their seats alive the way a lobby poll does
    for (const s of here()) if (s.seenAt < now - TIMING.HEARTBEAT_MS) bjTables(db, rng, now, { player: s.player, sid: s.sid })
    if (due(db, table, now)) advance(db, rng, table, now)

    let v = view(db, table, null, null, now)
    const r = v.round
    const t = v.table

    if (r.id !== lastRound && r.phase !== 'waiting' && r.phase !== 'betting') {
      lastRound = r.id
      rounds++
      if (chance(0.06)) target = rollTarget() // the crowd drifts over time
      for (const s of here()) if (!s.leaving) mindOf(s.player).rounds++
    }

    for (const s of here()) {
      const m = mindOf(s.player)
      const sid = s.sid

      // betting
      const open = r.phase === 'waiting' || r.phase === 'betting'
      if (open && !s.leaving && m.leaveAt == null && !v.hands.some((h) => h.seat === s.seat)) {
        // in an empty waiting round, someone sitting out thinks again after a while: a round only starts with a bet
        const rethink = m.plan?.round === r.id && m.plan.amount == null && r.phase === 'waiting' && now > m.plan.at + 6000
        if (!m.plan || m.plan.round !== r.id || rethink) {
          m.plan = { round: r.id, at: now + between(600, 2500), amount: rethink || chance(0.85) ? stake(m, t.min, t.max) : null, placed: false }
        }
        const latest = r.betEndsAt != null ? r.betEndsAt - 600 : Infinity
        if (m.plan.amount != null && !m.plan.placed && now >= Math.min(m.plan.at, latest)) {
          m.plan.placed = true
          const res = bjBet(db, rng, now, { table, round: r.id, player: s.player, sid, amount: m.plan.amount })
          if (res.ok) m.lastBet = m.plan.amount
        }
      }

      // playing
      const turn = r.turn
      const up = v.dealer[0]?.c
      if (r.phase === 'turns' && turn && turn.seat === s.seat && now >= turn.at && up != null) {
        const h = v.hands.find((x) => x.seat === s.seat && x.idx === turn.hand)
        if (h) {
          const cards = h.cards.map((c) => c.c)
          const key = `${r.id}:${turn.hand}:${cards.length}:${turn.at}`
          if (m.move?.key !== key) m.move = { key, at: Math.min(turn.endsAt - 500, Math.max(now, turn.at) + think(cards, up)) }
          if (now >= m.move.at) {
            m.move.at = Infinity
            const pair = h.idx === 0 && cards.length === 2 && val(cards[0]) === val(cards[1]) && !v.hands.some((x) => x.seat === s.seat && x.idx === 1)
            const action = basic(cards, up, cards.length === 2 && !h.doubled, pair)
            bjAction(db, rng, now, { table, round: r.id, player: s.player, sid, hand: turn.hand, n: cards.length, action })
            v = view(db, table, null, null, now)
          }
        }
      }

      // getting up: after a few rounds, now and then, between rounds
      if (r.phase === 'done' && m.rolled !== r.id) {
        m.rolled = r.id
        const staying = here().filter((x) => !x.leaving && mindOf(x.player).leaveAt == null).length
        if (m.rounds >= LEAVE_AFTER && staying > 1 && chance(LEAVE_CHANCE)) {
          m.leaveAt = Math.max(now, r.resultsAt ?? now) + between(1200, 3500)
          if (chance(0.3)) say(s.player, pick(['gg', 'ty'] as const), m.leaveAt - between(400, 900))
        }
      }
      if (m.leaveAt != null && now >= m.leaveAt) {
        bjLeave(db, rng, now, { table, player: s.player, sid })
        minds.delete(s.player)
        waitRounds = rounds + 2 + randInt(4)
        if (chance(0.3)) target = rollTarget()
      }
    }

    // reactions, weighed once per event
    const bots = here()
    const botAt = (seat: number) => bots.find((s) => s.seat === seat)
    if (bots.length) {
      if (r.resultsAt != null && now >= r.resultsAt) {
        const soon = () => r.resultsAt! + between(700, 2200)
        for (const h of v.hands) {
          const b = botAt(h.seat)
          if (h.outcome === 'blackjack') {
            once(`bj:${r.id}:${h.seat}:${h.idx}`, now, () => {
              const others = bots.filter((s) => s.seat !== h.seat)
              if (others.length && chance(0.25)) say(pick(others).player, 'nice', soon())
            })
          } else if (b && h.doubled && h.outcome === 'win') {
            once(`dbl:${r.id}:${h.seat}:${h.idx}`, now, () => {
              if (chance(0.2)) say(b.player, pick(['clap', 'fire'] as const), soon())
            })
          }
        }
        const d = v.dealer.map((c) => c.c ?? 0)
        const played = bots.filter((s) => v.hands.some((h) => h.seat === s.seat))
        once(`dealer:${r.id}`, now, () => {
          if (!played.length) return
          if (isBJ(d) && chance(0.1)) say(pick(played).player, pick(['cry', 'ouch'] as const), soon())
          else if (total(d) > 21 && chance(0.08)) say(pick(played).player, pick(['thumbs', 'cool'] as const), soon())
        })
      }
      for (const h of v.hands) {
        const b = botAt(h.seat)
        if (!b || total(h.cards.map((c) => c.c)) <= 21) continue
        once(`bust:${r.id}:${h.seat}:${h.idx}`, now, () => {
          if (chance(0.15)) say(b.player, 'ouch', h.cards[h.cards.length - 1].at + between(500, 1600))
        })
      }
      for (const x of v.reactions) {
        if (botAt(x.seat)) continue
        once(`re:${x.id}`, now, () => {
          if (chance(0.1)) say(pick(bots).player, pick(REPLIES[x.code]), x.at + between(1000, 2600))
        })
      }
      for (const s of db.seats) {
        if (s.tableId !== table || isBot(s.player)) continue
        once(`hi:${s.player}:${s.joinedAt}`, now, () => {
          if (chance(0.2)) say(pick(bots).player, 'gl', now + between(1200, 3000))
        })
      }
      if (r.phase === 'turns' && r.turn && !botAt(r.turn.seat) && now > r.turn.at + 9000) {
        const { seat, hand, at } = r.turn
        once(`hurry:${r.id}:${seat}:${hand}:${at}`, now, () => {
          if (chance(0.12)) say(pick(bots).player, 'hurry', now + between(300, 1200))
        })
      }
    }
    const later: typeof queue = []
    for (const q of queue) {
      if (q.at > now) later.push(q)
      else if (now - q.at > 15000 || !here().some((s) => s.player === q.bot)) continue
      else if (now - lastSaid < SAY_GAP_MS) later.push({ ...q, at: lastSaid + between(SAY_GAP_MS, SAY_GAP_MS + 1200) })
      else {
        bjReact(db, now, { table, player: q.bot, code: q.code })
        lastSaid = now
      }
    }
    queue = later
    for (const [k, at] of seen) if (now - at > 300000) seen.delete(k)

    // comings and goings: one to three regulars, never the last free seats
    const sitting = here().filter((s) => !s.leaving).length
    const sitDown = () => {
      const busy = new Set(db.seats.map((s) => s.player))
      const free = BOTS.filter((b) => !busy.has(b.id))
      const taken = new Set([...db.seats.filter((s) => s.tableId === table).map((s) => s.seat), ...v.hands.map((h) => h.seat)])
      const open = Array.from({ length: t.seats }, (_, i) => i + 1).filter((n) => !taken.has(n))
      const player = db.seats.some((s) => s.tableId === table && !isBot(s.player))
      if (!free.length || open.length <= (player ? 0 : 1)) return
      const b = pick(free)
      bjSit(db, rng, now, { table, seat: pick(open), player: b.id, sid: null, name: b.name, avatar: botAvatar(b, playerAvatar) })
      v = view(db, table, null, null, now)
    }
    // a table the bots have just come to gets its crowd at once (after a reload they are already there)
    if (filled !== table) {
      filled = table
      if (!sitting) for (let i = 0; i < target; i++) sitDown()
      return
    }
    if (arriveAt == null && (sitting === 0 || (sitting < target && rounds >= waitRounds))) {
      arriveAt = now + (sitting === 0 ? between(1500, 4000) : between(1500, 6000))
    }
    if (arriveAt != null && now >= arriveAt) {
      arriveAt = null
      if (sitting < MAX_BOTS) sitDown()
      waitRounds = rounds + 2 + randInt(4)
    }
  }

  return { step }
}
