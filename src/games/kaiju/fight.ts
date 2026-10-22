/*
  Kaiju Clash's fight script: the fight as the stage plays it, blow for blow, written from the round's key so every
  browser sees the same fight, and always the fight the result says (rules.ts drawResult).

  How a script is written. The result comes first: who wins, how, in which round, who lands first, how many
  buildings fall. A health plan then says how much damage each kaiju takes in each round (the loser of a knockout
  takes exactly 100 by the final blow; the winner of a decision takes less than the loser, and less in at least two
  rounds, so the judges' cards agree), whether anyone is knocked down and gets up, and how many buildings each round
  flattens (the rounds' own building rolls from the key, nudged so the last round of an early finish has time for
  them). Each round is then planned as beats (strikes that land and how much they take, strikes that are blocked or
  missed, throws, stomps, kaiju knocked into buildings, specials), fitted to the time the round has, and acted out on
  a clock: every beat is a few events, each kaiju's events one after another and never overlapping, the defender's
  reaction (hit, stagger, block, dodge, knockdown) starting the moment the strike lands (IMPACT says where in a strike
  that is). Each round opens with the two walking out of their corners and closes with them walking back. A
  knockout's final blow lands at a moment picked inside its round (30% to 86% through); a Splash drives the loser to
  the shore over its last beats and throws it in. A building only falls next to a kaiju: the fight is moved there
  first (the kaiju being driven back ends at the building's stand point, arena.ts), and a kaiju sent crashing through
  one can stagger on through the next.

  Everything comes from the script's own stream of numbers (sfc32, seeded from sha256(key:script:A-B)) and is worked
  out with + − × ÷ and rounding only (directions from the table in arena.ts, distances as dot products), so the
  script is the same in every browser. Every script is checked (checkFight) before it is used; one that fails is
  written again from the next stream (tools/kaiju-test.ts writes tens of thousands and checks them all).

  Reading a script (the stage, the HUD, the ticker; helpers at the bottom):
    where       posAt(f, side, ms), between the events' `to` targets; facing is the stage's (toward the other kaiju)
    doing       actionAt(f, side, ms): the event playing and how far through it; strikes land at impactAt(e), the
                moment the defender's reaction event starts; LOOPING actions repeat
    strikes     jab, heavy, tail, charge (moves in with `to`), beam (the special, cue 'flash'; a stray one that misses
                carries the building it flattens), grab and throw (the defender is held ('hit') until the throw lets
                go, then 'thrown' flies to its `to` and lands 'down' then 'getup', or 'sink' in the bay for a Splash)
    buildings   f.collapses (when, which, who); the event during which one falls carries `building`: the kaiju
                staggering or thrown into it, the stomp, or the stray special
    health      healthAt(f, ms); f.endsAt the knockout blow, the Splash hitting the water, or the final bell
    cues        'wide' the walk out at a round's bell, 'close' a heavy or charge landing, 'shake' a big stagger or a
                building, 'flash' a special, 'slowmo' the finishing blow (or throw), 'splash' the loser hitting the bay
    words       callsUntil(f, ms), newest last
*/

import { FIGHT_MS, ROUND_MS, roundStart } from './clock'
import { BUILDINGS, DIRS, NDIRS, SHORE_MARGIN, SHORE_Z, SPLASH_X, SPLASH_Z, START, dirIndex, distToBuilding, inGround, inWater } from './arena'
import { sha256 } from './fair'
import { damageRolls, drawResult, fighter, other, sideId } from './rules'
import { makeCaller, type CallKind } from './words'
import type { Action, Collapse, Fight, FightEvent, KaijuId, Matchup, Result, Side } from './types'

/** a line of commentary at a moment of the fight */
export interface Call {
  t: number
  who: Side
  text: string
}

/** where in a strike (a fraction of its dur) the blow lands, the defender reacts, a stomp hits or a throw lets go */
export const IMPACT: Partial<Record<Action, number>> = { jab: 0.45, heavy: 0.62, tail: 0.55, charge: 0.7, beam: 0.5, grab: 0.6, throw: 0.55, stomp: 0.55 }
/** the moment a strike lands (or a stomp hits, or a throw lets go), ms from the first bell */
export const impactAt = (e: FightEvent) => e.t + Math.round(e.dur * (IMPACT[e.action] ?? 0))

/** the actions that loop for as long as they last (the rig repeats them each unit of t) */
export const LOOPING: readonly Action[] = ['idle', 'walk', 'circle', 'down', 'sink', 'victory']

type P = { x: number; z: number }
type Rand = () => number

/* ---------------- arithmetic on the ground ---------------- */

const r2 = (x: number) => Math.round(x * 100) / 100
const pt = (x: number, z: number): P => ({ x: r2(x), z: r2(z) })
const along = (p: P, k: number, d: number): P => pt(p.x + DIRS[k][0] * d, p.z + DIRS[k][1] * d)
const turn = (k: number, n: number) => (((k + n) % NDIRS) + NDIRS) % NDIRS
const BACK = NDIRS / 2
const dirFrom = (p: P, q: P) => dirIndex(q.x - p.x, q.z - p.z)
/** the distance between two points, near enough (within half a percent): the dot product with the nearest direction */
function dist(p: P, q: P) {
  const k = dirFrom(p, q)
  return DIRS[k][0] * (q.x - p.x) + DIRS[k][1] * (q.z - p.z)
}
const mid = (p: P, q: P) => pt((p.x + q.x) / 2, (p.z + q.z) / 2)
const lerp = (p: P, q: P, s: number) => pt(p.x + (q.x - p.x) * s, p.z + (q.z - p.z) * s)
const d2 = (p: P, q: P) => (q.x - p.x) * (q.x - p.x) + (q.z - p.z) * (q.z - p.z)
const xz = (p: P): [number, number] => [p.x, p.z]
/** the square of how near a walk from p to q passes a point c */
function segD2(p: P, q: P, c: P) {
  const vx = q.x - p.x
  const vz = q.z - p.z
  const l = vx * vx + vz * vz
  const s = l > 0 ? Math.max(0, Math.min(1, ((c.x - p.x) * vx + (c.z - p.z) * vz) / l)) : 0
  return d2(c, pt(p.x + vx * s, p.z + vz * s))
}

/** the farthest point toward `to` that a fighting kaiju may stand on, coming from `from` */
function ground(from: P, to: P): P {
  if (inGround(to.x, to.z)) return to
  if (!inGround(from.x, from.z)) {
    let p = to
    for (let i = 0; i < 80 && !inGround(p.x, p.z); i++) p = pt(p.x * 0.94, p.z * 0.94 + 0.3)
    return p
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 14; i++) {
    const s = (lo + hi) / 2
    if (inGround(...xz(lerp(from, to, s)))) lo = s
    else hi = s
  }
  let q = lerp(from, to, lo)
  // rounding to the cent can step just outside
  for (let i = 0; i < 6 && !inGround(q.x, q.z); i++) {
    lo *= 0.9
    q = lerp(from, to, lo)
  }
  return inGround(q.x, q.z) ? q : from
}

/* ---------------- the stream of numbers ---------------- */

/** sfc32, seeded from a hash: 32-bit integer steps only, so it runs the same everywhere */
function streamOf(root: string): Rand {
  const h = sha256(root)
  let a = parseInt(h.slice(0, 8), 16) | 0
  let b = parseInt(h.slice(8, 16), 16) | 0
  let c = parseInt(h.slice(16, 24), 16) | 0
  let d = parseInt(h.slice(24, 32), 16) | 0
  const next = () => {
    const t = (((a + b) | 0) + d) | 0
    d = (d + 1) | 0
    a = b ^ (b >>> 9)
    b = (c + (c << 3)) | 0
    c = (c << 21) | (c >>> 11)
    c = (c + t) | 0
    return (t >>> 0) / 4294967296
  }
  for (let i = 0; i < 15; i++) next()
  return next
}
const int = (rand: Rand, lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
function weighted<T>(rand: Rand, items: readonly (readonly [T, number])[]): T {
  let t = 0
  for (const [, w] of items) t += w
  let x = rand() * t
  for (const [v, w] of items) if ((x -= w) < 0) return v
  return items[items.length - 1][0]
}
function shuffle<T>(rand: Rand, xs: T[]): T[] {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = xs[i]
    xs[i] = xs[j]
    xs[j] = t
  }
  return xs
}

/* ---------------- the plan ---------------- */

type Move = 'jab' | 'heavy' | 'tail' | 'charge' | 'beam'
type Beat =
  /** a blow that lands for dmg; kd: the defender goes down and gets up (stompDown: the other smashes a building
   *  meanwhile); crash: it is knocked into a building, and on through `chain` more beside it */
  | { type: 'land'; att: Side; move: Move; dmg: number; kd?: boolean; stompDown?: boolean; crash?: boolean; chain?: number }
  /** a grab and a throw that lands for dmg; crash: thrown into a building (and on through `chain` more) */
  | { type: 'throw'; att: Side; dmg: number; crash?: boolean; chain?: number }
  /** a strike blocked or dodged; crash: a stray special (or a wild tail) flattens a building instead */
  | { type: 'miss'; att: Side; move: Move; outcome: 'block' | 'miss'; crash?: boolean }
  /** a kaiju smashes a building while the other has a breather */
  | { type: 'stomp'; att: Side }

const landsOf = (b: Beat) => b.type === 'land' || b.type === 'throw'
const crashesOf = (b: Beat) =>
  b.type === 'stomp' ? 1 : (b.crash ? 1 : 0) + (b.type !== 'miss' ? (b.chain ?? 0) : 0) + (b.type === 'land' && b.stompDown ? 1 : 0)

/** what a beat takes on the clock at full tempo, about (measured; the planner fits a round's beats to the round) */
const LAND_EST: Record<Move, number> = { jab: 1100, tail: 1400, heavy: 1750, charge: 1550, beam: 1500 }
const MISS_EST: Record<Move, number> = { jab: 1150, tail: 1350, heavy: 1600, charge: 1500, beam: 1400 }
function estOf(b: Beat): number {
  let t = 0
  if (b.type === 'land') t = LAND_EST[b.move] + (b.kd ? 2000 : 0) + (b.stompDown ? 1000 : 0) + (b.chain ?? 0) * 600
  else if (b.type === 'miss') t = MISS_EST[b.move]
  else if (b.type === 'throw') t = 4300 + (b.chain ?? 0) * 600
  else t = 2500
  if (b.type !== 'stomp' && b.crash) t += 1400
  return t
}

/** how far a blow sends a kaiju crashing into a building */
const PUSH: Record<Move, number> = { jab: 3, tail: 4, heavy: 5, charge: 7, beam: 7 }
const STRIKE_RANGE: Record<Move, number> = { jab: 8.4, heavy: 8.6, tail: 9.2, charge: 13, beam: 13 }
const DUR: Record<string, number> = {
  jab: 620, heavy: 1150, tail: 1000, charge: 1200, beam: 1500, grab: 760, throw: 950, stomp: 1000, roar: 1250, taunt: 1100,
  hit: 460, stagger: 760, block: 520, dodge: 560, knockdown: 950, getup: 950, thrown: 1000, down: 650,
}
/** how much damage each move tends to do, relatively, when a round's damage is shared out */
const MOVE_WEIGHT: Record<Move, number> = { jab: 1, tail: 1.6, heavy: 2.4, charge: 2.2, beam: 3 }
const TAILED = new Set<KaijuId>(['rexor', 'voltra', 'kraka', 'lumina', 'pincer'])
const CHARGERS = new Set<KaijuId>(['gorrath', 'bedrock', 'titan', 'rexor'])

/** what a kaiju tends to throw, from its stats */
function moveWeights(id: KaijuId): [Move, number][] {
  const f = fighter(id)
  return [
    ['jab', 3 + f.speed / 2],
    ['heavy', 1 + f.power / 2],
    ['tail', TAILED.has(id) ? 2.5 : 1.2],
    ['charge', 0.4 + f.power / 4 + (CHARGERS.has(id) ? 1 : 0)],
    ['beam', 1.4],
  ]
}

interface RoundPlan {
  k: 1 | 2 | 3
  /** damage each kaiju takes this round (for a knockout's last round, the loser's includes the final blow) */
  take: Record<Side, number>
  /** someone knocked down (who gets up) this round */
  kd: Side | null
  builds: number
  finish: 'ko' | 'splash' | null
  /** the final blow's damage (a knockout's last round), and whether it sends the loser through a building */
  koBlow: number
  koCrash: boolean
  /** how many blows a finishing round has time for before the finish */
  room: number
  /** a later stream after the first ones didn't fit: fewer, bigger blows, no misses, every building on a blow */
  lean: boolean
}

/**
 * How the damage and the drama spread over the rounds (see the top). `room` is how many blows the last round of an
 * early finish has time for before the finish comes, so a quick knockout is a short last round and the rounds before
 * it carry the rest.
 */
function planHealth(res: Result, rand: Rand, room: number, lean: boolean): { take: Record<Side, number[]>; kd: (Side | null)[]; koBlow: number } {
  const W = res.winner
  const L = other(W)
  const R = res.round
  const take: Record<Side, number[]> = { a: [0, 0, 0, 0], b: [0, 0, 0, 0] }
  const kd: (Side | null)[] = [null, null, null, null]
  let koBlow = 0
  /** a total over rounds 1..n in random shares, each at least lo */
  const spread = (total: number, n: number, lo: number, w?: number[]) => {
    const out = [0, 0, 0, 0]
    if (n <= 0) return out
    const ws = w ?? Array.from({ length: n }, () => 1 + rand() * 2)
    const tw = ws.reduce((x, y) => x + y, 0)
    let left = Math.max(0, total - lo * n)
    const all = left
    for (let i = 0; i < n; i++) {
      const s = i === n - 1 ? left : Math.min(left, Math.floor((all * ws[i]) / tw))
      out[i + 1] = lo + s
      left -= s
    }
    return out
  }
  if (res.method === 'dec') {
    // who takes each round on damage: the winner two or all three of them (one perhaps close)
    const pattern = weighted(rand, [['sweep', 3], ['twoone', 4.5], ['split', 2.5]] as const)
    const rounds = shuffle(rand, pattern === 'sweep' ? ['W', 'W', 'w'] : pattern === 'twoone' ? ['W', 'W', 'L'] : ['W', 'w', 'L'])
    rounds.forEach((who, i) => {
      const lose = int(rand, 10, 24)
      const margin = who === 'w' ? int(rand, 1, 3) : int(rand, 5, 12)
      const rw = who === 'L' ? L : W
      take[other(rw)][i + 1] = lose
      take[rw][i + 1] = Math.max(3, lose - margin)
    })
    // the winner ends with more health: if the loser's big round outweighs the rest, the loser takes more in another
    const sum = (s: Side) => take[s][1] + take[s][2] + take[s][3]
    if (sum(W) >= sum(L)) take[L][1 + rounds.indexOf('W')] += sum(W) - sum(L) + int(rand, 3, 8)
    // a knockdown of the loser in a round the winner took clearly
    if (rand() < 0.28) {
      const i = 1 + rounds.indexOf('W')
      if (take[L][i] >= 14 && take[L][i] >= take[W][i] + 4) kd[i] = L
    }
    return { take, kd, koBlow }
  }
  // the loser's last round: the blows there's time for (and a knockout's final blow)
  let last = room >= 2 ? int(rand, 8, 22) : room >= 1 ? int(rand, 4, 13) : 0
  if (R === 1 && W === res.first && last < 3) last = int(rand, 3, 8)
  if (res.method === 'ko') {
    koBlow = R === 1 ? (lean ? int(rand, 28, 34) : int(rand, 20, 34)) : int(rand, 12, 30)
    if (R === 1) take[L][1] = 100
    else {
      // the rounds before carry the rest, at most 52 a round (any more goes on the last round's blows)
      let rest = 100 - koBlow - last
      if (rest > 52 * (R - 1)) {
        last += rest - 52 * (R - 1)
        rest = 52 * (R - 1)
      }
      if (R === 2) take[L][1] = rest
      else {
        const a = int(rand, Math.max(12, rest - 52), Math.min(52, rest - 12))
        take[L][1] = a
        take[L][2] = rest - a
      }
      take[L][R] = koBlow + last
    }
  } else {
    for (let k = 1; k < R; k++) take[L][k] = int(rand, 14, 36)
    take[L][R] = last
  }
  // the winner's night: mostly on top, sometimes a war, now and then a comeback from a bad start
  const story = weighted(rand, [['top', 5.5], ['war', 3.5], ['comeback', 1]] as const)
  const total = story === 'top' ? int(rand, 6, 30) : story === 'war' ? int(rand, 30, 60) : int(rand, 46, 76)
  const wLast = room >= 2 ? int(rand, 3, 12) : 0
  take[W] = spread(total - wLast, R - 1, 3, story === 'comeback' ? [3, 1].slice(0, R - 1) : undefined)
  take[W][R] = R === 1 ? (lean ? 0 : Math.min(total, room >= 2 ? 26 : 12)) : wLast
  // whoever lands first in the first round has to land something
  if (take[W][1] < 3 && L === res.first) take[W][1] = int(rand, 3, 8)
  // a knockdown along the way, of whoever came off worse in an earlier round
  if (R > 1 && rand() < 0.38) {
    const i = int(rand, 1, R - 1)
    const down: Side = take[W][i] > take[L][i] ? W : L
    if (take[down][i] >= 14 && take[down][i] >= take[other(down)][i] + 4) kd[i] = down
  }
  // or the loser down once in the last round before the end
  if (res.method === 'ko' && R > 1 && last >= 14 && room >= 3 && rand() < 0.3) kd[R] = L
  return { take, kd, koBlow }
}

/** the buildings each round flattens: the rolls, with what an early finish's last round has no time for moved into the
 *  rounds before (`cap` buildings fit in it) */
function planBuildings(res: Result, rolls: number[], cap: number): number[] {
  const out = [0, rolls[0], rolls[1], rolls[2]]
  for (let k = res.round + 1; k <= 3; k++) out[k] = 0
  const R = res.round
  if (res.method !== 'dec' && R > 1)
    while (out[R] > cap) {
      let room = 0
      for (let k = 1; k < R; k++) if (out[k] < 7 && (!room || out[k] < out[room])) room = k
      if (!room) break
      out[R]--
      out[room]++
    }
  return out
}

const OPEN_MS = 1500
const KO_LEAD = 900
const SPLASH_LEAD = 4300
/** how much a round's beats may take at full tempo: its time over the briskest tempo the clock allows (a finishing
 *  round: the time before its finish) */
function capacityOf(p: RoundPlan): number {
  if (p.finish === 'ko') return (0.86 * ROUND_MS - OPEN_MS - KO_LEAD) / 0.72
  if (p.finish === 'splash') return (0.95 * ROUND_MS - OPEN_MS - SPLASH_LEAD) / 0.72
  return (ROUND_MS - OPEN_MS - 350) / 0.8
}

/** a round's beats: the blows that land (sharing out its damage), the knockdown, the buildings, a few misses */
function planBeats(p: RoundPlan, m: Matchup, res: Result, rand: Rand, first: Side | null): Beat[] {
  const beats: Beat[] = []
  const cap = capacityOf(p)
  const finishing = p.finish !== null
  for (const def of ['a', 'b'] as const) {
    const att = other(def)
    const D = p.take[def] - (p.finish === 'ko' && def !== res.winner ? p.koBlow : 0)
    if (D <= 0) continue
    const id = sideId(m, att)
    const f = fighter(id)
    // (a first-round knockout is a blitz: a few huge blows)
    const n =
      p.finish === 'ko' && p.k === 1 && def !== res.winner
        ? Math.max(2, Math.ceil(D / (p.lean ? 38 : 36)))
        : Math.max(1, Math.min(D, p.lean ? 2 : 4, Math.round(D / (p.lean ? 20 : 15)) + (rand() < 0.3 ? 1 : 0)))
    const moves: (Move | 'throw')[] = []
    // grapplers throw now and then (a throw is long: one a round at most, and not in a rushed last round)
    if (f.grapple >= 6 && n >= 2 && D >= 10 && !finishing && !p.lean && rand() < (f.grapple - 4) * 0.09) moves.push('throw')
    let beams = 0
    while (moves.length < n) {
      let mv = weighted(rand, moveWeights(id))
      if (mv === 'beam' && beams) mv = 'heavy'
      if (mv === 'beam') beams++
      moves.push(mv)
    }
    const w = moves.map((mv) => (mv === 'throw' ? 2.2 : MOVE_WEIGHT[mv]))
    const tw = w.reduce((x, y) => x + y, 0)
    const dmgs = w.map((x) => Math.floor((D * x) / tw))
    let rest = D - dmgs.reduce((x, y) => x + y, 0)
    for (let i = 0; rest > 0; i = (i + 1) % dmgs.length, rest--) dmgs[i]++
    // no single blow over 38: the excess goes to the lightest
    for (let guard = 0; guard < 40 && Math.max(...dmgs) > 38; guard++) {
      const hi = dmgs.indexOf(Math.max(...dmgs))
      const lo = dmgs.indexOf(Math.min(...dmgs))
      const x = Math.min(dmgs[hi] - 38, 38 - dmgs[lo])
      if (x <= 0) break
      dmgs[hi] -= x
      dmgs[lo] += x
    }
    moves.forEach((mv, i) => {
      if (dmgs[i] <= 0) return
      if (mv === 'throw') beats.push({ type: 'throw', att, dmg: dmgs[i] })
      else beats.push({ type: 'land', att, move: nameFor(mv, dmgs[i]), dmg: dmgs[i] })
    })
  }
  // a few strikes that don't land
  const misses = p.lean ? 0 : finishing ? (p.room >= 2 ? int(rand, 0, 1) : 0) : int(rand, 1, 2)
  for (let i = 0; i < misses; i++) {
    const att: Side = rand() < 0.5 ? 'a' : 'b'
    const def = fighter(sideId(m, other(att)))
    const outcome: 'block' | 'miss' = rand() * (def.tough + def.speed) < def.tough ? 'block' : 'miss'
    beats.push({ type: 'miss', att, move: weighted(rand, [['jab', 5], ['heavy', 3], ['tail', 2], ['beam', 1]] as const), outcome })
  }
  // the knockdown rides on the biggest blow the downed kaiju takes this round
  if (p.kd) {
    let best: (Beat & { type: 'land' }) | null = null
    for (const b of beats) if (b.type === 'land' && b.att !== p.kd && (!best || b.dmg > best.dmg)) best = b
    if (best) {
      best.kd = true
      if (best.move === 'jab') best.move = 'heavy'
    }
  }
  // the buildings: on blows that knock a kaiju back and on throws, a stomp while the other is down, stray specials
  let c = p.builds
  for (const b of beats) if (c > 0 && b.type === 'land' && b.kd && rand() < 0.6) {
    b.stompDown = true
    c--
  }
  // (the big blows first; a jab that sends a kaiju into a building becomes a shoulder charge)
  const knockers = shuffle(rand, beats.filter((b) => b.type === 'throw' || b.type === 'land'))
  knockers.sort((x, y) => (x.type === 'land' && x.move === 'jab' ? 1 : 0) - (y.type === 'land' && y.move === 'jab' ? 1 : 0))
  for (const b of knockers) {
    if (c <= 0) break
    if ((b.type === 'land' || b.type === 'throw') && (p.lean || rand() < 0.85)) {
      b.crash = true
      if (b.type === 'land' && b.move === 'jab') b.move = 'charge'
      c--
    }
  }
  while (c > 0) {
    const att: Side = weighted(rand, [['a', fighter(m.a).chaos], ['b', fighter(m.b).chaos]] as const)
    const r = rand()
    beats.push(r < 0.4 ? { type: 'miss', att, move: 'beam', outcome: 'miss', crash: true } : r < 0.6 ? { type: 'miss', att, move: 'tail', outcome: 'miss', crash: true } : { type: 'stomp', att })
    c--
  }
  fit(beats, p.lean ? cap * 0.8 : cap)
  // (fitting moves buildings between beats but never loses one)
  for (let n = beats.reduce((x, b) => x + crashesOf(b), 0); n < p.builds; n++) beats.push({ type: 'stomp', att: rand() < 0.5 ? 'a' : 'b' })
  // the beats that bring buildings down come in a run, so the fight goes to the buildings once a round, not each time
  const wreck = shuffle(rand, beats.filter((b) => crashesOf(b) > 0 && !(b.type === 'land' && b.kd && !b.crash)))
  const rest = shuffle(rand, beats.filter((b) => !wreck.includes(b)))
  rest.splice(int(rand, 0, rest.length), 0, ...wreck)
  beats.length = 0
  beats.push(...rest)
  // round 1: the first blow to land is the first strike's
  if (first) {
    const i = beats.findIndex(landsOf)
    const j = beats.findIndex((b) => landsOf(b) && b.att === first)
    if (i >= 0 && j > i) {
      const t = beats[i]
      beats[i] = beats[j]
      beats[j] = t
    }
  }
  return beats
}

/** the name follows the damage: a big jab is a heavy, a feeble heavy a jab */
function nameFor(mv: Move, dmg: number): Move {
  if ((mv === 'jab' && dmg > 9) || (mv === 'tail' && dmg > 18)) return 'heavy'
  if ((mv === 'heavy' || mv === 'charge' || mv === 'beam') && dmg < 5) return 'jab'
  return mv
}

/** squeeze a round's beats into its time: drop the misses, fold stray buildings into chains, merge small blows */
function fit(beats: Beat[], cap: number) {
  const sum = () => beats.reduce((x, b) => x + estOf(b), 0)
  for (let i = beats.length - 1; i >= 0 && sum() > cap; i--) {
    const b = beats[i]
    if (b.type === 'miss' && !b.crash) beats.splice(i, 1)
  }
  // a stomp or a stray special becomes one more building on a crash that's happening anyway (with none, the first
  // blow that lands becomes one)
  if (sum() > cap && !beats.some((b) => b.type !== 'miss' && b.type !== 'stomp' && b.crash)) {
    const extra = beats.findIndex((b) => b.type === 'stomp' || (b.type === 'miss' && b.crash))
    const host = beats.find((b) => b.type === 'land' || b.type === 'throw')
    if (extra >= 0 && host && (host.type === 'land' || host.type === 'throw')) {
      host.crash = true
      if (host.type === 'land' && host.move === 'jab') host.move = 'charge'
      beats.splice(extra, 1)
    }
  }
  while (sum() > cap) {
    const extra = beats.findIndex((b) => b.type === 'stomp' || (b.type === 'miss' && b.crash))
    const host = beats.find((b) => (b.type === 'land' || b.type === 'throw') && b.crash && (b.chain ?? 0) < 4)
    if (extra < 0 || !host || host.type === 'miss' || host.type === 'stomp') break
    host.chain = (host.chain ?? 0) + 1
    beats.splice(extra, 1)
  }
  // a throw becomes a heavy
  for (const b of beats)
    if (sum() > cap && b.type === 'throw') Object.assign(b, { type: 'land', move: 'heavy' })
  // two blows by the same kaiju become one bigger one (their buildings carried over)
  for (let guard = 0; guard < 12 && sum() > cap; guard++) {
    let merged = false
    for (const att of ['a', 'b'] as const) {
      const plain = beats.filter((b): b is Beat & { type: 'land' } => b.type === 'land' && b.att === att && !b.kd)
      if (plain.length < 2) continue
      plain.sort((x, y) => x.dmg - y.dmg)
      const [x, y] = plain
      // (never one monster blow: two that would make more than 40 stay two)
      if (x.dmg + y.dmg > 40) continue
      x.dmg += y.dmg
      x.move = nameFor(x.move === 'jab' ? 'heavy' : x.move, x.dmg)
      const crashes = (x.crash ? 1 + (x.chain ?? 0) : 0) + (y.crash ? 1 + (y.chain ?? 0) : 0)
      if (crashes) {
        x.crash = true
        x.chain = crashes - 1
      }
      beats.splice(beats.indexOf(y), 1)
      merged = true
      break
    }
    if (!merged) break
  }
}

/* ---------------- acting it out ---------------- */

type Say = ReturnType<typeof makeCaller>
const isStrike = (a: Action) => a === 'jab' || a === 'heavy' || a === 'tail' || a === 'charge' || a === 'beam' || a === 'grab' || a === 'throw' || a === 'stomp'

class Script {
  ev: FightEvent[] = []
  col: Collapse[] = []
  health: [number, number, number][] = [[0, 100, 100]]
  hp: Record<Side, number> = { a: 100, b: 100 }
  /** where each kaiju is when it is next free, and when that is */
  pos: Record<Side, P> = { a: { ...START.a }, b: { ...START.b } }
  cur: Record<Side, number> = { a: 0, b: 0 }
  fallen = new Set<number>()
  /** buildings still to fall this round that a beat couldn't place */
  owed = 0
  /** this round ends in a Splash */
  toShore = false
  landed = false
  lastCall = -1e9
  /** how briskly the current beats are played (the time left over the time they'd like), and the round's pace: a
   *  round that overruns is played again a little faster */
  tempo = 1
  speed = 1
  k: 1 | 2 | 3 = 1
  taken: Record<Side, number[]> = { a: [0, 0, 0, 0], b: [0, 0, 0, 0] }
  kds: Record<Side, number[]> = { a: [0, 0, 0, 0], b: [0, 0, 0, 0] }
  low: Record<Side, boolean> = { a: false, b: false }
  endsAt = FIGHT_MS
  m: Matchup
  res: Result
  rand: Rand
  say: Say
  constructor(m: Matchup, res: Result, rand: Rand, say: Say) {
    this.m = m
    this.res = res
    this.rand = rand
    this.say = say
  }

  id = (s: Side) => sideId(this.m, s)

  /** a duration at the current tempo and pace (never below floor of the base), a little varied, to the 10 ms */
  dur(base: number, floor = 0.6) {
    const d = base * Math.max(floor * (this.speed < 1 ? 0.88 : 1), this.tempo * this.speed) * (0.9 + this.rand() * 0.2)
    return Math.max(60, Math.round(d / 10) * 10)
  }

  /** a reaction's duration: it squeezes less than a strike */
  rdur(base: number) {
    return this.dur(base, 0.75)
  }

  /** everything a round changes, to play it again */
  save() {
    const copy = (r: Record<Side, number[]>) => ({ a: [...r.a], b: [...r.b] })
    return {
      ev: this.ev.length, col: this.col.length, health: this.health.length, hp: { ...this.hp }, pos: { a: this.pos.a, b: this.pos.b }, cur: { ...this.cur },
      fallen: new Set(this.fallen), owed: this.owed, landed: this.landed, lastCall: this.lastCall, taken: copy(this.taken), kds: copy(this.kds),
      low: { ...this.low }, endsAt: this.endsAt,
    }
  }
  load(x: ReturnType<Script['save']>) {
    this.ev.length = x.ev
    this.col.length = x.col
    this.health.length = x.health
    this.hp = { ...x.hp }
    this.pos = { a: x.pos.a, b: x.pos.b }
    this.cur = { ...x.cur }
    this.fallen = new Set(x.fallen)
    this.owed = x.owed
    this.landed = x.landed
    this.lastCall = x.lastCall
    this.taken = { a: [...x.taken.a], b: [...x.taken.b] }
    this.kds = { a: [...x.kds.a], b: [...x.kds.b] }
    this.low = { ...x.low }
    this.endsAt = x.endsAt
  }

  act(who: Side, action: Action, dur: number, extra: Partial<FightEvent> = {}, at = 0): FightEvent {
    const t = Math.max(this.cur[who], at)
    const e: FightEvent = { t, dur: Math.max(0, Math.round(dur)), who, action }
    if (extra.outcome) e.outcome = extra.outcome
    if (extra.dmg !== undefined) e.dmg = extra.dmg
    if (extra.to) {
      e.to = pt(extra.to.x, extra.to.z)
      this.pos[who] = e.to
    }
    if (extra.cue) e.cue = extra.cue
    this.ev.push(e)
    this.cur[who] = t + e.dur
    return e
  }

  /** a line of commentary on an event: prio 0 lines speak now and then, 1 unless one was just said, 2+ always */
  call(e: FightEvent, kind: CallKind, side: Side, prio = 1, bld?: number) {
    const gap = e.t - this.lastCall
    if (prio < 2 && gap < (prio === 0 ? 2200 : 900)) return
    // (a quiet stretch always gets its line)
    if (prio === 0 && gap < 3000 && this.rand() < 0.45) return
    e.call = this.say(kind, { a: this.id(side), b: this.id(other(side)), r: this.k, bld: bld === undefined ? undefined : BUILDINGS[bld].name })
    this.lastCall = e.t
  }

  /** fill a kaiju's time until a moment: a breath, a few steps round the other, or a roar or a taunt */
  pad(who: Side, until: number, mood: 'free' | 'brace' = 'free') {
    const gap = until - this.cur[who]
    if (gap < 80) return
    const opp = other(who)
    if (mood === 'free' && gap >= 1100 && this.rand() < 0.4) {
      const action: Action = this.rand() < 0.5 ? 'taunt' : 'roar'
      const e = this.act(who, action, Math.min(gap, DUR[action]))
      this.call(e, action === 'roar' ? 'roar' : 'taunt', who, 0)
      this.pad(who, until, 'brace')
      return
    }
    // (circling only round a kaiju that is standing still: one still on the move would be circled where it ends up)
    if (mood === 'free' && gap >= 450 && this.cur[opp] <= this.cur[who] + 200) {
      const k = dirFrom(this.pos[opp], this.pos[who])
      const g = Math.max(7, dist(this.pos[opp], this.pos[who]))
      const to = ground(this.pos[who], along(this.pos[opp], turn(k, this.rand() < 0.5 ? 1 : -1), g))
      this.act(who, 'circle', gap, { to })
      return
    }
    this.act(who, 'idle', gap)
  }

  /** both kaiju free at the same moment */
  sync(): number {
    const t = Math.max(this.cur.a, this.cur.b)
    this.pad('a', t)
    this.pad('b', t)
    return t
  }

  hurt(def: Side, dmg: number, at: number) {
    this.hp[def] -= dmg
    this.taken[def][this.k] += dmg
    this.health.push([at, this.hp.a, this.hp.b])
  }

  fall(b: number, by: Side, at: number, e: FightEvent) {
    this.fallen.add(b)
    this.col.push({ t: Math.round(at), building: b, by })
    e.building = b
    if (!e.cue) e.cue = 'shake'
  }

  /** an unfallen building near a point (one of the nearest three); with `avoid`, one whose stand point can be walked
   *  to from `near` without passing through the kaiju at `avoid` */
  building(near: P, avoid?: P, clear = 6): number {
    const cands: [number, number][] = []
    BUILDINGS.forEach((b, i) => {
      if (!this.fallen.has(i)) cands.push([i, d2(near, b.stand) + (avoid && segD2(near, b.stand, avoid) < clear * clear ? 1e4 : 0)])
    })
    cands.sort((x, y) => x[1] - y[1] || x[0] - y[0])
    // (none but through the other kaiju: none for now)
    if (!cands.length || cands[0][1] >= 1e4) return -1
    const near3 = cands.slice(0, 3).filter((c) => c[1] < 1e4)
    return weighted(this.rand, near3.map(([i], j) => [i, 3 - j] as const))
  }

  /**
   * The building a crash goes into: the one the fight reaches soonest, `outer` (the kaiju that ends against it) walking
   * to `pre` in front of it, and the pair turning first if `outer` is on the wrong side (one of the best two).
   */
  target(outer: Side, pre: number): number {
    const axis = dirFrom(this.pos[other(outer)], this.pos[outer])
    const cands: [number, number][] = []
    BUILDINGS.forEach((b, i) => {
      if (this.fallen.has(i)) return
      const spot = along(b.stand, turn(b.out, BACK), pre)
      const diff = Math.abs(((((b.out - axis) % NDIRS) + NDIRS + BACK) % NDIRS) - BACK)
      // (in a round that ends in a Splash, the buildings toward the water, so the drive to the shore is short)
      const shore = this.toShore ? Math.max(0, b.stand.z + 6) * 60 : 0
      cands.push([i, dist(this.pos[outer], spot) * 72 + (diff <= 2 ? 0 : diff <= 8 ? 650 : 1300) + shore])
    })
    if (!cands.length) return -1
    cands.sort((x, y) => x[1] - y[1] || x[0] - y[0])
    return weighted(this.rand, cands.slice(0, 2).map(([i], j) => [i, 2 - j] as const))
  }

  /** how long a walk of some distance takes: brisker at a higher tempo, but never faster than a kaiju can stride */
  walkDur(far: number, lo = 420, hi = 2000) {
    return Math.max(Math.round(far * (this.speed < 1 ? 56 : 72)), this.dur(Math.min(hi, Math.max(lo, 320 + far * 80))))
  }

  /** turn the pair round its middle, a quarter turn at most a move, until `outer` stands out along DIRS[k] from the other */
  rotate(outer: Side, k: number) {
    const inner = other(outer)
    for (let guard = 0; guard < 3; guard++) {
      const now = dirFrom(this.pos[inner], this.pos[outer])
      const diff = ((((k - now) % NDIRS) + NDIRS + BACK) % NDIRS) - BACK
      if (Math.abs(diff) <= 2) return
      const step = Math.max(-8, Math.min(8, diff))
      const t = this.sync()
      const g = Math.max(7.5, Math.min(12, dist(this.pos.a, this.pos.b)))
      const nk = turn(now, step)
      let c = mid(this.pos.a, this.pos.b)
      let O = along(c, nk, g / 2)
      let I = along(c, turn(nk, BACK), g / 2)
      for (let i = 0; i < 12 && (!inGround(O.x, O.z) || !inGround(I.x, I.z)); i++) {
        c = pt(c.x * 0.85, c.z * 0.85 + 0.2)
        O = along(c, nk, g / 2)
        I = along(c, turn(nk, BACK), g / 2)
      }
      const far = Math.max(dist(this.pos[outer], O), dist(this.pos[inner], I))
      const d = this.walkDur(far, 600, 1300)
      this.act(outer, 'circle', d, { to: O }, t)
      this.act(inner, 'circle', d, { to: I }, t)
    }
  }

  /** the unfallen building beside another, if one is close enough to stagger into */
  neighbour(b: number): number {
    let best = -1
    let bd = 12 * 12
    BUILDINGS.forEach((x, i) => {
      if (this.fallen.has(i) || i === b) return
      const d = d2(BUILDINGS[b].stand, x.stand)
      if (d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  /**
   * Take the fight to a building: the pair turns (round its middle, so nobody walks through anybody) until `who` is
   * on the building's side, then both walk over: `who` ends `pre` in front of the stand point, the other `gap` in.
   */
  approach(b: number, who: Side, pre: number, gap: number) {
    const B = BUILDINGS[b]
    const opp = other(who)
    const inward = turn(B.out, BACK)
    const tWho = ground(B.stand, along(B.stand, inward, pre))
    const tOpp = ground(tWho, along(tWho, inward, gap))
    if (Math.max(dist(this.pos[who], tWho), dist(this.pos[opp], tOpp)) < 0.8) return
    this.rotate(who, B.out)
    const t = this.sync()
    const far = Math.max(dist(this.pos[who], tWho), dist(this.pos[opp], tOpp))
    if (far < 0.8) return
    const d = this.walkDur(far, 600)
    const e = this.act(who, 'walk', d, { to: tWho }, t)
    this.act(opp, 'walk', d, { to: tOpp }, t)
    if (far > 5) this.call(e, 'toward', opp, 0, b)
  }

  /** close to within a strike's range */
  engage(att: Side, range: number) {
    const def = other(att)
    const g = dist(this.pos[att], this.pos[def])
    if (g <= range + 1.2) return
    const k = dirFrom(this.pos[att], this.pos[def])
    const to = ground(this.pos[att], along(this.pos[def], turn(k, BACK), range))
    this.act(att, 'walk', this.walkDur(g - range, 380, 1600), { to })
  }

  /** a crashed-into kaiju staggers on into the buildings beside; what it can't reach is owed by a stomp later */
  chain(from: number, victim: Side, by: Side, n: number) {
    let b = from
    for (let i = 0; i < n; i++) {
      const nb = this.neighbour(b)
      if (nb < 0) {
        this.owed += n - i
        return
      }
      const d = Math.max(this.rdur(640), Math.round(dist(this.pos[victim], BUILDINGS[nb].stand) * 60))
      const e = this.act(victim, 'stagger', d, { to: BUILDINGS[nb].stand })
      this.fall(nb, by, e.t + d * 0.8, e)
      this.call(e, 'knockInto', by, 2, nb)
      b = nb
    }
  }

  /**
   * One strike and the defender's answer: the strike starts when the attacker is free (and late enough that the
   * defender is free when it lands); the reaction starts as it lands.
   */
  strike(att: Side, move: Move, outcome: 'land' | 'block' | 'miss', o: { dmg?: number; react?: Action; pushTo?: P; crash?: number; stray?: number } = {}) {
    const def = other(att)
    const d = this.dur(DUR[move])
    const off = Math.round(d * IMPACT[move]!)
    const start = Math.max(this.cur[att], this.cur[def] - off + 40)
    this.pad(att, start)
    const k = dirFrom(this.pos[att], this.pos[def])
    const extra: Partial<FightEvent> = { outcome }
    if (outcome === 'land') extra.dmg = o.dmg
    if (move === 'charge') extra.to = ground(this.pos[att], along(this.pos[def], turn(k, BACK), outcome === 'miss' ? 3.5 : 5.6))
    extra.cue = move === 'beam' ? 'flash' : outcome === 'land' && (move === 'heavy' || move === 'charge') ? 'close' : undefined
    const e = this.act(att, move, d, extra, start)
    const at = start + off
    this.pad(def, at, 'brace')
    if (move === 'beam' && outcome === 'land') this.call(e, 'special', att, 2)
    if (outcome === 'land') {
      const dmg = o.dmg ?? 0
      const crashed = o.crash !== undefined && o.crash >= 0
      const react: Action = o.react ?? (!crashed && (move === 'jab' || (move === 'tail' && dmg < 8)) ? 'hit' : 'stagger')
      const push = react === 'hit' ? 0.7 : move === 'charge' ? 3.6 : react === 'knockdown' ? 2.6 : 2.2
      const to = o.pushTo ?? ground(this.pos[def], along(this.pos[def], k, push))
      const r = this.act(def, react, Math.max(this.rdur(DUR[react]), Math.round(dist(this.pos[def], to) * 60)), { to, cue: react === 'stagger' && dmg >= 10 ? 'shake' : undefined }, at)
      this.hurt(def, dmg, at)
      if (crashed) this.fall(o.crash!, att, r.t + r.dur * 0.8, r)
      if (!this.landed) this.call(r, 'first', att, 2)
      else if (crashed) this.call(r, 'knockInto', att, 2, o.crash)
      else if (react === 'knockdown') this.call(r, 'knockdown', att, 2)
      else if (move !== 'jab' && this.hp[att] + 20 < this.hp[def] + dmg) this.call(r, 'comeback', att, 1)
      else if (this.hp[def] < 25 && !this.low[def]) {
        this.low[def] = true
        this.call(r, 'low', att, 1)
      } else if (move !== 'beam') this.call(r, move, att, move === 'jab' ? 0 : 1)
      this.landed = true
      return r
    }
    if (outcome === 'block') {
      const r = this.act(def, 'block', this.rdur(DUR.block), {}, at)
      this.call(r, move === 'beam' ? 'specialBlock' : 'block', att, move === 'beam' ? 1 : 0)
      return r
    }
    // a sway to the side, unless something behind it is about to come down
    const strayed = o.stray !== undefined && o.stray >= 0
    const to = strayed ? undefined : ground(this.pos[def], along(this.pos[def], turn(k, this.rand() < 0.5 ? NDIRS / 4 : -NDIRS / 4), 1.4))
    const r = this.act(def, 'dodge', this.rdur(DUR.dodge), to ? { to } : {}, at)
    if (strayed) {
      this.fall(o.stray!, att, at + (move === 'beam' ? 120 : 0), e)
      this.call(e, move === 'beam' ? 'missInto' : 'tailInto', att, 2, o.stray)
    } else this.call(r, move === 'beam' ? 'specialMiss' : 'dodge', att, move === 'beam' ? 1 : 0)
    return r
  }

  /** after a knockdown: down for a count (the other perhaps smashing a building meanwhile), then up again */
  getUp(downed: Side, stomp: boolean) {
    const att = other(downed)
    const t = this.cur[downed]
    if (stomp) {
      const b = this.building(this.pos[att], this.pos[downed])
      if (b >= 0) this.stomp(att, b)
      else this.owed++
    } else if (this.cur[att] < t + 600) {
      const e = this.act(att, this.rand() < 0.5 ? 'roar' : 'taunt', this.dur(1150))
      this.call(e, e.action === 'roar' ? 'roar' : 'taunt', att, 0)
    }
    const until = Math.max(t + this.dur(DUR.down), this.cur[att] - 450)
    this.act(downed, 'down', until - this.cur[downed])
    const g = this.act(downed, 'getup', this.rdur(DUR.getup))
    this.call(g, 'getup', att, 2)
    this.kds[downed][this.k]++
  }

  /** a kaiju smashes a building: walks to it if it must, and stomps */
  stomp(who: Side, b: number) {
    const st = BUILDINGS[b].stand
    const far = dist(this.pos[who], st)
    if (far > 0.8) this.act(who, 'walk', this.walkDur(far, 420, 1700), { to: st })
    const d = this.dur(DUR.stomp)
    const e = this.act(who, 'stomp', d)
    this.fall(b, who, e.t + Math.round(d * IMPACT.stomp!), e)
    this.call(e, 'stomp', who, 2, b)
  }

  /** a grab and a throw that lands for dmg, at `to` (a building's stand point) or a few strides off */
  grabThrow(att: Side, dmg: number, crash: number) {
    const def = other(att)
    this.engage(att, 6.8)
    const gd = this.dur(DUR.grab)
    const gOff = Math.round(gd * IMPACT.grab!)
    const start = Math.max(this.cur[att], this.cur[def] - gOff + 40)
    this.pad(att, start)
    const k = dirFrom(this.pos[att], this.pos[def])
    const g = this.act(att, 'grab', gd, { outcome: 'land' }, start)
    this.call(g, 'grab', att, 1)
    const held = start + gOff
    this.pad(def, held, 'brace')
    const td = this.dur(DUR.throw)
    const release = this.cur[att] + Math.round(td * IMPACT.throw!)
    this.act(def, 'hit', release - held)
    const th = this.act(att, 'throw', td, { outcome: 'land', dmg })
    const fly = this.rdur(DUR.thrown)
    const to = crash >= 0 ? BUILDINGS[crash].stand : ground(this.pos[def], along(this.pos[def], k, 9))
    const f = this.act(def, 'thrown', fly, { to, cue: 'shake' }, release)
    this.hurt(def, dmg, release + fly)
    if (crash >= 0) {
      this.fall(crash, att, release + fly, f)
      this.call(f, 'thrownInto', att, 2, crash)
    } else this.call(th, 'throw', att, 1)
    this.landed = true
    this.act(def, 'down', this.dur(450))
    this.act(def, 'getup', this.rdur(DUR.getup))
  }

  /** a filler between beats: circling, a roar or a taunt, or a flurry nobody lands */
  filler(kind: 'circle' | 'roar' | 'flurry') {
    if (kind === 'flurry') {
      const a: Side = this.rand() < 0.5 ? 'a' : 'b'
      this.engage(a, 8.4)
      const r = this.strike(a, 'jab', this.rand() < 0.5 ? 'block' : 'miss')
      this.call(r, 'flurry', a, 0)
      this.strike(other(a), this.rand() < 0.6 ? 'jab' : 'heavy', this.rand() < 0.5 ? 'block' : 'miss')
      return
    }
    const t = this.sync()
    if (kind === 'roar') {
      const who: Side = this.rand() < 0.5 ? 'a' : 'b'
      const e = this.act(who, this.rand() < 0.6 ? 'roar' : 'taunt', this.dur(1200), {}, t)
      this.call(e, e.action === 'roar' ? 'roar' : 'taunt', who, 0)
      this.pad(other(who), this.cur[who])
      return
    }
    // circling: the pair turns round its middle, a little toward the centre of the plaza
    let c = mid(this.pos.a, this.pos.b)
    c = pt(c.x * 0.85, c.z * 0.85)
    const k = turn(dirFrom(this.pos.a, this.pos.b), (this.rand() < 0.5 ? 1 : -1) * int(this.rand, 2, 3))
    const g = 8.6 + this.rand() * 2.6
    let A = along(c, turn(k, BACK), g / 2)
    let B = along(c, k, g / 2)
    for (let i = 0; i < 12 && (!inGround(A.x, A.z) || !inGround(B.x, B.z)); i++) {
      c = pt(c.x * 0.8, c.z * 0.8)
      A = along(c, turn(k, BACK), g / 2)
      B = along(c, k, g / 2)
    }
    const d = this.dur(1150)
    const e = this.act('a', 'circle', d, { to: A }, t)
    this.act('b', 'circle', d, { to: B }, t)
    this.call(e, 'circle', 'a', 0)
  }

  /** the round's opening: both out of their corners to meet near the middle (or nearer the buildings it will wreck) */
  opening(p: RoundPlan) {
    const t0 = roundStart(this.k)
    this.pad('a', t0, 'brace')
    this.pad('b', t0, 'brace')
    if (this.k > 1) this.health.push([t0, this.hp.a, this.hp.b])
    let c = pt(int(this.rand, -3, 3), int(this.rand, -2, 4))
    if (p.builds >= 2) {
      // a busy round starts toward a block of buildings (by the water, when it ends in a Splash)
      const ok = BUILDINGS.map((_, i) => i).filter((i) => !this.fallen.has(i) && (p.finish !== 'splash' || BUILDINGS[i].stand.z < 0))
      if (ok.length) {
        // (not so far over that one walks out past the other's mark)
        const st = BUILDINGS[ok[Math.floor(this.rand() * ok.length)]].stand
        c = pt(Math.max(-4, Math.min(4, st.x * 0.4 + c.x * 0.6)), st.z * 0.5 + c.z * 0.5)
      }
    }
    const k = turn(this.pos.a.x <= this.pos.b.x ? 0 : BACK, int(this.rand, -1, 1))
    const g = 10 + this.rand() * 2.5
    const to = { a: along(c, turn(k, BACK), g / 2), b: along(c, k, g / 2) }
    // in the first round one of them may roar before it sets off
    const roarer: Side | null = this.k === 1 && this.rand() < 0.55 ? (this.rand() < 0.5 ? 'a' : 'b') : null
    const d = this.dur(1350, 0.8)
    let opener: FightEvent | null = null
    for (const s of ['a', 'b'] as const) {
      if (s === roarer) {
        const r = this.act(s, 'roar', this.dur(900, 0.8), {}, t0)
        this.act(s, 'walk', Math.max(t0 + d - this.cur[s], this.walkDur(dist(this.pos[s], to[s]), 300)), { to: to[s] })
        opener ??= r
      } else {
        const e = this.act(s, 'walk', d, { to: to[s], cue: 'wide' }, t0)
        opener ??= e
      }
    }
    this.call(opener!, this.k === 1 ? 'open1' : this.k === 3 ? 'open3' : 'openN', roarer ?? (this.rand() < 0.5 ? 'a' : 'b'), 2)
  }

  /** a beat of the plan */
  play(b: Beat) {
    if (b.type === 'stomp') {
      const bi = this.building(this.pos[b.att], this.pos[other(b.att)])
      if (bi < 0) {
        this.owed++
        return
      }
      this.sync()
      this.stomp(b.att, bi)
      // the other has a breather (or a few steps) while the building comes down
      this.pad(other(b.att), this.cur[b.att] - 200)
      return
    }
    const att = b.att
    const def = other(att)
    if (b.type === 'throw') {
      let crash = -1
      if (b.crash) {
        crash = this.target(def, 9)
        if (crash >= 0) this.approach(crash, def, 9, 6.8)
        else this.owed += 1 + (b.chain ?? 0)
      }
      this.grabThrow(att, b.dmg, crash)
      // the chain comes after it hits the ground and before it gets up: stumbling on through the rubble
      if (crash >= 0 && b.chain) this.chain(crash, def, att, b.chain)
      return
    }
    if (b.type === 'miss') {
      let stray = -1
      if (b.crash) {
        // a stray special flattens the building behind the one who dodged it; a wild tail, one beside the swinger
        const near = b.move === 'beam' ? def : att
        stray = this.target(near, 0)
        if (stray >= 0) this.approach(stray, near, 0, b.move === 'beam' ? 12 : 8.6)
        else this.owed++
      }
      if (b.move !== 'beam') this.engage(att, STRIKE_RANGE[b.move])
      this.strike(att, b.move, stray >= 0 ? 'miss' : b.outcome, { stray })
      return
    }
    // a blow that lands
    let crash = -1
    if (b.crash) {
      // the harder the blow, the farther it sends the kaiju into the building
      const pre = PUSH[b.move]
      crash = this.target(def, pre)
      if (crash >= 0) this.approach(crash, def, pre, b.move === 'beam' ? 12 : b.move === 'charge' ? 11 : 8.4)
      else this.owed += 1 + (b.chain ?? 0)
    }
    if (b.move === 'charge') this.engage(att, 13)
    else if (b.move === 'beam') {
      if (dist(this.pos[att], this.pos[def]) > 20) this.engage(att, 14)
    } else this.engage(att, STRIKE_RANGE[b.move])
    this.strike(att, b.move, 'land', { dmg: b.dmg, react: b.kd ? 'knockdown' : undefined, pushTo: crash >= 0 ? BUILDINGS[crash].stand : undefined, crash })
    if (crash >= 0 && b.chain) this.chain(crash, def, att, b.chain)
    if (b.kd) this.getUp(def, !!b.stompDown)
  }

  /** what the plan couldn't place: stomps, one after another */
  payOwed() {
    while (this.owed > 0) {
      this.owed--
      // whichever of the two has a building it can get to (round the other), or the nearest at all
      let who: Side = this.rand() < 0.5 ? 'a' : 'b'
      let b = -1
      for (const clear of [6, 4.5]) {
        if (b < 0) b = this.building(this.pos[who], this.pos[other(who)], clear)
        if (b < 0) b = this.building(this.pos[(who = other(who))], this.pos[other(who)], clear)
      }
      if (b < 0) b = this.building(this.pos[who])
      if (b < 0) return
      this.sync()
      this.stomp(who, b)
      this.pad(other(who), this.cur[who] - 200)
    }
  }

  /** the final blow, landing at `at` (or as soon after as the two are free), perhaps sending the loser through a building */
  knockout(at: number, move: Move, dmg: number, crash: boolean) {
    const W = this.res.winner
    const L = other(W)
    // through a building: the loser ends up 2.5 in front of one, so it is next to it the moment the blow lands
    const bi = crash ? this.target(L, 2.5) : -1
    if (bi >= 0) this.approach(bi, L, 2.5, move === 'beam' ? 12 : move === 'charge' ? 11 : 8.4)
    else if (crash) this.owed++
    this.payOwed()
    this.engage(W, move === 'beam' || move === 'charge' ? 13 : STRIKE_RANGE[move])
    let d = this.dur(DUR[move], 0.85)
    let off = Math.round(d * IMPACT[move]!)
    // (late in the round, a quicker swing, so it lands inside the window)
    const late = roundStart(this.k) + 0.88 * ROUND_MS
    if (Math.max(at - off, this.cur[W], this.cur[L] - off + 40) + off > late) {
      d = Math.round(d * 0.7)
      off = Math.round(d * IMPACT[move]!)
    }
    const start = Math.max(at - off, this.cur[W], this.cur[L] - off + 40)
    const hit = start + off
    this.pad(W, start)
    this.pad(L, hit, 'brace')
    const k = dirFrom(this.pos[W], this.pos[L])
    const extra: Partial<FightEvent> = { outcome: 'land', dmg, cue: 'slowmo' }
    if (move === 'charge') extra.to = ground(this.pos[W], along(this.pos[L], turn(k, BACK), 5.6))
    this.act(W, move, d, extra, start)
    const to = bi >= 0 ? BUILDINGS[bi].stand : ground(this.pos[L], along(this.pos[L], k, 3))
    const kd = this.act(L, 'knockdown', this.dur(1000, 0.9), { to, cue: 'shake' }, hit)
    this.hurt(L, dmg, hit)
    if (bi >= 0) this.fall(bi, W, hit, kd)
    this.call(kd, bi >= 0 ? 'koInto' : move === 'beam' ? 'koSpecial' : 'ko', W, 3, bi >= 0 ? bi : undefined)
    this.act(L, 'down', FIGHT_MS - this.cur[L])
    this.endsAt = hit
    this.celebrate(W)
  }

  /** the Splash: the loser driven to the water's edge, grabbed and thrown in, landing in the bay at `at` */
  splash(at: number) {
    const W = this.res.winner
    const L = other(W)
    // timed back from the moment it hits the water (the turn and the drive are what they are, so near enough)
    const bay = dirIndex(0, -1)
    const turnFirst = this.pos[L].z > this.pos[W].z - 3
    let fly = this.dur(1150, 0.95)
    let td = this.dur(DUR.throw, 0.9)
    let gd = this.dur(DUR.grab, 0.9)
    let hold = 160
    const guess = Math.max(dist(this.pos[L], pt(this.pos[L].x, SHORE_Z)), 8)
    const lead = (turnFirst ? 1300 : 0) + this.walkDur(guess, 700, 1700) + gd + hold + Math.round(td * IMPACT.throw!) + fly
    const t0 = Math.max(at - lead, this.sync())
    this.pad('a', t0, 'brace')
    this.pad('b', t0, 'brace')
    // the loser must be on the water side: if it isn't, the pair turns first (round its middle)
    if (turnFirst) this.rotate(L, bay)
    const t = this.sync()
    const sx = Math.max(-SPLASH_X, Math.min(SPLASH_X, this.pos[L].x))
    const edge = pt(sx, SHORE_Z + SHORE_MARGIN + 0.4)
    const wPos = pt(sx + (this.rand() - 0.5) * 2, edge.z + 6.8)
    const far = Math.max(dist(this.pos[L], edge), dist(this.pos[W], wPos))
    let dd = this.walkDur(far, 700, 1700)
    // late in the round: the same moves, quicker, so it still lands before the bell
    const room = roundStart(this.k) + ROUND_MS - 60 - t
    const need = dd + gd + hold + Math.round(td * IMPACT.throw!) + fly
    if (need > room) {
      const q = Math.max(0.6, room / need)
      dd = Math.max(Math.round(far * 45), Math.round(dd * q))
      gd = Math.round(gd * q)
      td = Math.round(td * q)
      fly = Math.round(fly * q)
      hold = Math.round(hold * q)
    }
    const e = this.act(L, 'walk', dd, { to: edge }, t)
    this.act(W, 'walk', dd, { to: wPos }, t)
    this.call(e, 'drive', W, 2)
    const gStart = t + dd
    const g = this.act(W, 'grab', gd, { outcome: 'land' }, gStart)
    this.call(g, 'grab', W, 1)
    const held = gStart + Math.round(gd * IMPACT.grab!)
    this.pad(L, held, 'brace')
    const tStart = gStart + gd + hold
    const release = tStart + Math.round(td * IMPACT.throw!)
    this.act(L, 'hit', release - held)
    this.pad(W, tStart, 'brace')
    this.act(W, 'throw', td, { outcome: 'land', cue: 'slowmo' }, tStart)
    const water = pt(sx + (this.rand() - 0.5) * 6, SPLASH_Z + (this.rand() - 0.5) * 4)
    this.act(L, 'thrown', fly, { to: water }, release)
    const s = this.act(L, 'sink', FIGHT_MS - (release + fly), { cue: 'splash' }, release + fly)
    this.call(s, 'splash', W, 3)
    this.endsAt = release + fly
    this.celebrate(W)
  }

  /** the winner's roar and celebration to the end of the slot */
  celebrate(W: Side) {
    if (FIGHT_MS - this.cur[W] > 1500) {
      const r = this.act(W, 'roar', this.dur(1300, 0.9))
      this.call(r, 'victory', W, 1)
    }
    if (FIGHT_MS > this.cur[W]) this.act(W, 'victory', FIGHT_MS - this.cur[W])
  }

  /** the break: back to the corners */
  toCorners() {
    const t = Math.max(roundStart(this.k) + ROUND_MS + 120, this.cur.a, this.cur.b)
    // each to the corner on its side of the other (A's mark is the left one, but after a round of brawling it may
    // have ended up on the right)
    const swapped = this.pos.a.x > this.pos.b.x
    const corner = { a: swapped ? START.b : START.a, b: swapped ? START.a : START.b }
    const far = Math.max(dist(this.pos.a, corner.a), dist(this.pos.b, corner.b))
    const d = Math.max(Math.round(far * 50), Math.min(roundStart(this.k + 1) - t - 200, Math.max(1700, Math.round(far * 72))))
    for (const s of ['a', 'b'] as const) {
      this.pad(s, t, 'brace')
      const e = this.act(s, 'walk', d, { to: corner[s] }, t)
      if (s === 'a') this.call(e, 'endRound', 'a', 2)
    }
  }

  /** a round: the opening, the planned beats at the tempo the time left allows, then the bell (or the finish) */
  round(p: RoundPlan, beats: Beat[], finishAt: number): number {
    this.k = p.k
    this.toShore = p.finish === 'splash'
    this.opening(p)
    const endAt = p.finish === 'ko' ? finishAt - KO_LEAD : p.finish === 'splash' ? finishAt - SPLASH_LEAD : roundStart(p.k) + ROUND_MS - 350
    for (let i = 0; i < beats.length; i++) {
      const need = beats.slice(i).reduce((x, b) => x + estOf(b), 0)
      this.tempo = Math.max(0.6, Math.min(1, (endAt - Math.max(this.cur.a, this.cur.b)) / need))
      this.play(beats[i])
    }
    this.tempo = 0.75
    this.payOwed()
    this.tempo = 1
    const busy = Math.max(this.cur.a, this.cur.b)
    if (p.finish) return busy
    // fill to the bell with circling, roars and flurries
    for (let guard = 0; guard < 8 && endAt - Math.max(this.cur.a, this.cur.b) >= 1500; guard++)
      this.filler(weighted(this.rand, [['circle', 3], ['roar', 1.5], ['flurry', 2]] as const))
    const bell = p.k === 3 ? FIGHT_MS - 300 : roundStart(p.k) + ROUND_MS
    this.pad('a', bell)
    this.pad('b', bell)
    if (p.k === 3) {
      const e = this.act('a', 'idle', FIGHT_MS - this.cur.a)
      this.act('b', 'idle', FIGHT_MS - this.cur.b)
      this.call(e, 'bell', 'a', 3)
    }
    return busy
  }
}

/** the judges' cards from the damage each kaiju took each round and the knockdowns, with a little judge-to-judge
 *  variety on close rounds (but the winner always ahead on at least two of them) */
function scoreCards(s: Script, winner: Side, rand: Rand): [number, number][] {
  const judge = (vary: boolean): [number, number] => {
    let a = 0
    let b = 0
    for (let k = 1; k <= 3; k++) {
      const ta = s.taken.a[k]
      const tb = s.taken.b[k]
      let ra = 10
      let rb = 10
      if (s.kds.a[k] && !s.kds.b[k]) ra = 8
      else if (s.kds.b[k] && !s.kds.a[k]) rb = 8
      else if (Math.abs(ta - tb) >= 4 || (!vary && ta !== tb)) {
        if (ta < tb) rb = 9
        else ra = 9
      } else if (ta !== tb) {
        // a close round: most judges give it to the kaiju that took less, not all
        if (rand() < 0.7 === ta < tb) rb = 9
        else ra = 9
      } else if (vary && rand() < 0.5) {
        if (rand() < 0.5) rb = 9
        else ra = 9
      }
      a += ra
      b += rb
    }
    return [a, b]
  }
  const w = winner === 'a' ? 0 : 1
  for (let tries = 0; tries < 6; tries++) {
    const cards = [judge(true), judge(true), judge(true)]
    if (cards.filter((c) => c[w] > c[1 - w]).length >= 2) return cards
  }
  return [judge(false), judge(false), judge(false)]
}

/** write the script from a stream (attempt 0, then the next streams if a check fails) */
function write(key: string, m: Matchup, res: Result, attempt: number): Fight {
  const rand = streamOf(`${key}:script:${m.a}-${m.b}${attempt ? `:${attempt}` : ''}`)
  const s = new Script(m, res, rand, makeCaller(rand))
  const R = res.round
  // an early finish: when in its round it comes, and so how much the last round has time for
  const early = res.method !== 'dec'
  let frac = early ? (res.method === 'ko' ? 0.3 + rand() * 0.56 : 0.5 + rand() * 0.45) : 1
  const budget = early ? frac * ROUND_MS - OPEN_MS - (res.method === 'ko' ? KO_LEAD : SPLASH_LEAD) : 0
  const room = early ? Math.max(0, Math.floor(budget / 1500)) : 9
  const hp = planHealth(res, rand, room, attempt >= 3)
  const lastCap = early ? Math.max(0, Math.floor((budget - 1300 * Math.min(room, 2)) / 2200)) + (res.method === 'ko' ? 1 : 0) : 9
  const builds = planBuildings(res, damageRolls(key, m.a, m.b), lastCap)
  for (let k = 1 as 1 | 2 | 3; k <= R; k = (k + 1) as 1 | 2 | 3) {
    const finish = k === R && res.method !== 'dec' ? res.method : null
    // a knockout often sends the loser through a building on the way down
    const koCrash = finish === 'ko' && builds[k] > 0 && (room >= 1 || R === 1) && rand() < 0.55
    const p: RoundPlan = { k, take: { a: hp.take.a[k], b: hp.take.b[k] }, kd: hp.kd[k], builds: builds[k] - (koCrash ? 1 : 0), finish, koBlow: finish === 'ko' ? hp.koBlow : 0, koCrash, room: finish ? room : 9, lean: attempt >= 3 }
    const beats = planBeats(p, m, res, rand, k === 1 ? res.first : null)
    // when the finish comes: as picked, or later if the round's beats need it (inside the round's window)
    let finishAt = 0
    let koMove: Move = 'heavy'
    if (finish) {
      const sum = beats.reduce((x, b) => x + estOf(b), 0)
      const W = sideId(m, res.winner)
      koMove = weighted(rand, [['heavy', 3 + (W === 'bedrock' || W === 'gorrath' ? 2 : 0)], ['beam', 3], ['charge', CHARGERS.has(W) ? 2 : 0.8], ['tail', TAILED.has(W) ? 2 : 0.6]] as const)
      const lead = finish === 'ko' ? KO_LEAD + (koCrash ? 1200 : 0) : SPLASH_LEAD
      frac = Math.min(finish === 'ko' ? 0.86 : 0.95, Math.max(frac, (OPEN_MS + sum * 0.74 + lead) / ROUND_MS))
      finishAt = roundStart(k) + Math.round(frac * ROUND_MS)
    }
    // play the round; if it runs over (the beats past the bell, the finish past its window), again a little faster
    const snap = s.save()
    const t0 = roundStart(k)
    const speeds = attempt >= 3 ? [0.86, 0.74, 0.64, 0.56] : [1, 0.86, 0.74, 0.64]
    for (const speed of speeds) {
      s.speed = speed
      const busy = s.round(p, beats, finishAt)
      let over = false
      if (finish === 'ko') {
        s.knockout(finishAt, koMove, hp.koBlow, koCrash)
        over = s.endsAt > t0 + 0.88 * ROUND_MS
      } else if (finish === 'splash') {
        s.splash(finishAt)
        over = s.endsAt > t0 + 0.97 * ROUND_MS
      } else over = busy > (k === 3 ? FIGHT_MS - 300 : t0 + ROUND_MS)
      if (!over || speed === speeds[speeds.length - 1]) break
      s.load(snap)
    }
    s.speed = 1
    if (!finish && k < R) s.toCorners()
  }
  return {
    result: res,
    events: s.ev.slice().sort((x, y) => x.t - y.t || (x.who === y.who ? 0 : x.who === 'a' ? -1 : 1)),
    collapses: s.col.slice().sort((x, y) => x.t - y.t),
    health: s.health.slice().sort((x, y) => x[0] - y[0]),
    endsAt: s.endsAt,
    cards: res.method === 'dec' ? scoreCards(s, res.winner, rand) : null,
    start: { a: { ...START.a }, b: { ...START.b } },
  }
}

const memo = new Map<string, Fight>()

/** the fight a key gives a matchup (the same every time it is asked, in every browser) */
export function drawFight(key: string, m: Matchup): Fight {
  const mk = `${key}:${m.a}-${m.b}`
  const hit = memo.get(mk)
  if (hit) return hit
  const f = freshFight(key, m).fight
  if (memo.size > 64) memo.clear()
  memo.set(mk, f)
  return f
}

/** one stream's script, checked or not (for the tests) */
export const scriptOf = (key: string, m: Matchup, attempt = 0): Fight => write(key, m, drawResult(key, m.a, m.b), attempt)

/** drawFight without the memo, and how many streams it took (the tests count the scripts written again) */
export function freshFight(key: string, m: Matchup): { fight: Fight; attempts: number } {
  const res = drawResult(key, m.a, m.b)
  let best: Fight | null = null
  let worst = Infinity
  for (let attempt = 0; attempt < 8; attempt++) {
    const f = write(key, m, res, attempt)
    const bad = checkFight(f).length
    if (!bad) return { fight: f, attempts: attempt + 1 }
    // (none passing, which the tests never see: the one with the least wrong, still the right result)
    if (bad < worst) {
      worst = bad
      best = f
    }
  }
  return { fight: best!, attempts: 9 }
}

/* ---------------- reading a script ---------------- */

/** each kaiju's health at a moment (ms from the first bell) */
export function healthAt(f: Fight, ms: number): [number, number] {
  let h: [number, number] = [100, 100]
  for (const [t, a, b] of f.health) {
    if (t > ms) break
    h = [a, b]
  }
  return h
}

/** the events starting in [fromMs, toMs) */
export function eventsBetween(f: Fight, fromMs: number, toMs: number): FightEvent[] {
  const out: FightEvent[] = []
  for (const e of f.events) {
    if (e.t >= toMs) break
    if (e.t >= fromMs) out.push(e)
  }
  return out
}

/** how many buildings have fallen by a moment */
export function fallenBy(f: Fight, ms: number): number {
  let n = 0
  for (const c of f.collapses) if (c.t <= ms) n++
  return n
}

/** the buildings fallen by a moment (indexes into arena.ts BUILDINGS) */
export const fallenAt = (f: Fight, ms: number): number[] => f.collapses.filter((c) => c.t <= ms).map((c) => c.building)

interface Track {
  /** a side's moves: from t0 to t1 it goes from `from` to `to` */
  moves: { t0: number; t1: number; from: P; to: P; ease: 'stride' | 'smooth' | 'linear' }[]
  /** its events in order */
  events: FightEvent[]
}
const tracks = new WeakMap<Fight, Record<Side, Track>>()

function trackOf(f: Fight, side: Side): Track {
  let t = tracks.get(f)
  if (!t) {
    const mk = (s: Side): Track => {
      const events = f.events.filter((e) => e.who === s)
      const moves: Track['moves'] = []
      let at: P = f.start[s]
      for (const e of events)
        if (e.to) {
          moves.push({ t0: e.t, t1: e.t + e.dur, from: at, to: e.to, ease: e.action === 'thrown' ? 'linear' : e.action === 'walk' || e.action === 'circle' ? 'stride' : 'smooth' })
          at = e.to
        }
      return { moves, events }
    }
    t = { a: mk('a'), b: mk('b') }
    tracks.set(f, t)
  }
  return t[side]
}

/** where a kaiju is at a moment, along each move to the events' `to` targets: walking and circling at an even pace
 *  after a short speed-up (and before a short slow-down), knockbacks and charges eased in and out, a thrown kaiju
 *  flying straight at an even speed (the stage adds the arc) */
export function posAt(f: Fight, side: Side, ms: number): { x: number; z: number } {
  let p: P = f.start[side]
  for (const mv of trackOf(f, side).moves) {
    if (ms >= mv.t1) {
      p = mv.to
      continue
    }
    if (ms <= mv.t0) break
    const u = (ms - mv.t0) / Math.max(1, mv.t1 - mv.t0)
    const s = mv.ease === 'linear' ? u : mv.ease === 'stride' ? stride(u) : u * u * (3 - 2 * u)
    return { x: mv.from.x + (mv.to.x - mv.from.x) * s, z: mv.from.z + (mv.to.z - mv.from.z) * s }
  }
  return { x: p.x, z: p.z }
}

/** an even pace with a fifth of the time to speed up and a fifth to slow down (top speed 1.25 times the average) */
function stride(u: number) {
  const r = 0.2
  const v = 1 / (1 - r)
  if (u < r) return (v * u * u) / (2 * r)
  if (u > 1 - r) return 1 - (v * (1 - u) * (1 - u)) / (2 * r)
  return v * (u - r / 2)
}

/** what a kaiju is doing at a moment and how far through it (0 to 1); null before its first event */
export function actionAt(f: Fight, side: Side, ms: number): { e: FightEvent; p: number } | null {
  let cur: FightEvent | null = null
  for (const e of trackOf(f, side).events) {
    if (e.t > ms) break
    cur = e
  }
  if (!cur) return null
  return { e: cur, p: cur.dur > 0 ? Math.min(1, Math.max(0, (ms - cur.t) / cur.dur)) : 1 }
}

/** the commentary so far, newest last */
export function callsUntil(f: Fight, ms: number): Call[] {
  const out: Call[] = []
  for (const e of f.events) {
    if (e.t > ms) break
    if (e.call) out.push({ t: e.t, who: e.who, text: e.call })
  }
  return out
}

/* ---------------- the checks ---------------- */

/** everything a script must be, as a list of what is wrong with it (empty when it is right) */
export function checkFight(f: Fight): string[] {
  const bad: string[] = []
  const r = f.result
  const W = r.winner
  const L = other(W)
  const ev = f.events
  for (let i = 1; i < ev.length; i++) if (ev[i].t < ev[i - 1].t) bad.push('events out of order')
  for (const e of ev) if (!(e.t >= 0 && e.dur >= 0 && e.t + e.dur <= FIGHT_MS)) bad.push(`event outside the fight: ${e.action} at ${e.t}+${e.dur}`)
  for (const s of ['a', 'b'] as const) {
    const mine = ev.filter((e) => e.who === s)
    for (let i = 1; i < mine.length; i++)
      if (mine[i - 1].t + mine[i - 1].dur > mine[i].t) bad.push(`${s} overlaps itself at ${mine[i].t} (${mine[i - 1].action} then ${mine[i].action})`)
  }
  const firstLand = ev.find((e) => e.outcome === 'land')
  if (!firstLand || firstLand.who !== r.first) bad.push('the first strike to land is not result.first')
  const late = ev.find((e) => e.t >= f.endsAt && isStrike(e.action))
  if (late) bad.push(`a strike after the end (${late.action} at ${late.t})`)
  // and none in a break between rounds
  const broke = ev.find((e) => isStrike(e.action) && [1, 2].some((k) => e.t + e.dur > roundStart(k) + ROUND_MS && e.t < roundStart(k + 1)))
  if (broke) bad.push(`a strike in a break (${broke.action} at ${broke.t})`)
  // health
  for (let i = 1; i < f.health.length; i++) if (f.health[i][0] < f.health[i - 1][0]) bad.push('health out of order')
  const end = healthAt(f, FIGHT_MS)
  const li = L === 'a' ? 0 : 1
  const wi = 1 - li
  if (f.health.some(([t, a, b]) => (a <= 0 || b <= 0) && !(r.method === 'ko' && t === f.endsAt))) bad.push('health reaches 0 before the knockout')
  const t0 = roundStart(r.round)
  if (r.method === 'ko') {
    const at = f.health.find(([, a, b]) => (li === 0 ? a : b) === 0)
    if (!at || at[0] !== f.endsAt) bad.push('the loser does not reach 0 at the knockout')
    if (end[li] !== 0 || end[wi] <= 0) bad.push('knockout health wrong at the end')
    if (f.endsAt < t0 + 0.25 * ROUND_MS || f.endsAt > t0 + 0.9 * ROUND_MS) bad.push(`knockout ${f.endsAt - t0} ms into round ${r.round}`)
    const last = ev.filter((e) => e.who === L).pop()
    if (!last || last.action !== 'down') bad.push('the knocked-out kaiju does not end down')
  } else if (r.method === 'splash') {
    if (end[li] <= 0 || end[wi] <= 0) bad.push('a Splash with a kaiju at 0')
    const last = ev.filter((e) => e.who === L).pop()
    if (!last || last.action !== 'sink' || last.t !== f.endsAt) bad.push('the Splash loser does not end sinking at the end')
    const p = posAt(f, L, FIGHT_MS)
    if (!inWater(p.x, p.z)) bad.push('the Splash loser is not in the water')
    if (f.endsAt < t0 + 0.25 * ROUND_MS || f.endsAt > t0 + ROUND_MS) bad.push(`Splash ${f.endsAt - t0} ms into round ${r.round}`)
  } else {
    if (f.endsAt !== FIGHT_MS) bad.push('a decision ends before the final bell')
    if (end[0] <= 0 || end[1] <= 0 || end[wi] <= end[li]) bad.push(`decision health wrong (${end})`)
    if (!f.cards || f.cards.length !== 3 || f.cards.filter((c) => c[wi] > c[li]).length < 2) bad.push(`the cards do not give it to the winner (${JSON.stringify(f.cards)})`)
  }
  if (r.method !== 'dec') {
    const w = ev.filter((e) => e.who === W).pop()
    if (!w || w.action !== 'victory') bad.push('the winner does not celebrate')
  }
  // buildings
  if (f.collapses.length !== r.damage) bad.push(`${f.collapses.length} buildings fall, not ${r.damage}`)
  const seen = new Set<number>()
  for (const c of f.collapses) {
    if (seen.has(c.building)) bad.push(`building ${c.building} falls twice`)
    seen.add(c.building)
    if (c.t > f.endsAt) bad.push('a building falls after the end')
    if (ev.filter((e) => e.building === c.building).length !== 1) bad.push(`building ${c.building} is not on exactly one event`)
    const b = BUILDINGS[c.building]
    if (!b) {
      bad.push(`no building ${c.building}`)
      continue
    }
    const near = Math.min(...(['a', 'b'] as const).map((s) => distToBuilding(b, ...xz(posAt(f, s, c.t)))))
    if (near > 6) bad.push(`nobody near building ${c.building} when it falls (${near.toFixed(1)})`)
  }
  // the ground: on the plaza throughout, but for the Splash
  const thrown = r.method === 'splash' ? (ev.find((e) => e.who === L && e.action === 'thrown' && e.t + e.dur === f.endsAt)?.t ?? f.endsAt) : Infinity
  outer: for (let t = 0; t <= FIGHT_MS; t += 100)
    for (const s of ['a', 'b'] as const) {
      if (s === L && t > thrown) continue
      const p = posAt(f, s, t)
      if (!inGround(p.x, p.z)) {
        bad.push(`${s} off the plaza at ${t} (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
        break outer
      }
    }
  return [...new Set(bad)]
}
