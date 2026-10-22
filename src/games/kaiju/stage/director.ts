import { BET_MS, CYCLE_MS, FIGHT_MS, ROUND_MS, WALKOUT_MS, roundStart } from '../clock'
import { BUILDINGS, LIGHTHOUSE, SHORE_Z, START } from '../arena'
import { fallenAt, impactAt, posAt } from '../fight'
import { other } from '../rules'
import type { Fight, FightEvent, KaijuId, Side, StageEvent, StageView } from '../types'

/*
  The stage's director: what Neon Bay shows at every moment of a round, worked out from the round's clock and its
  fight script alone, with no three.js, so the stage, its lab and any tool agree on it (and a page that wants to know
  when the replay runs can ask too).

  A round on stage (times from the round's opening, clock.ts): the betting minutes are a pre-fight show (a crane over
  the bay, each kaiju in turn, a slow orbit); the walkout puts each kaiju in its own spotlight to roar; then the
  fight plays from its script. The stage shows the script on the shared clock, beat for beat, except around a finish:
  the knockout blow or the Splash freezes for a hit-stop, plays on in slow motion, then the finishing beat is replayed
  from a second angle, slower still, before the stage goes back to the live clock for the winner's celebration. All of
  that is a pure function of the clock (show()), so it is the same on every screen and the lab can scrub it. The
  events the page hears (stageEvents) stay on the live clock: a knockout is called when it happens, not when the
  replay shows it.

  The camera is cut like a broadcast: a shot list (planShots) made once per fight from its beats. Big blows get a
  close shot over the striker's shoulder, specials a low side-on shot the beam crosses, a building coming down a shot
  of the building with the kaiju beside it, the finish a low angle; the gaps are two-shots from the camera side (the
  bay and the far skyline behind the fighters), each from a slightly different angle. Every shot is checked against
  the buildings standing at the time and turned to an angle that sees past them. shotPose() turns a shot into a camera
  position for the kaiju where they are now, so a shot follows the action; the stage smooths it and adds the shake.
*/

export type P = { x: number; z: number }
export type V3 = { x: number; y: number; z: number }

/** the bay's surface, below the plaza (the sea wall drops to it); a kaiju in the bay floats with its group here */
export const WATER_Y = -1.4
/** the walkout and the fight, from the round's opening */
export const WALK0 = BET_MS
export const FIGHT0 = BET_MS + WALKOUT_MS
/** a finish's hit-stop (real ms), the slow motion after it (real ms) and its rate */
export const HOLD_MS = 140
export const SLOW_MS = 1500
export const SLOW_RATE = 0.3
/** the replay: from this long before the finish to this long after it (script ms), at this rate */
const PRE_MS = 2100
const POST_MS = 1500
const REPLAY_RATE = 0.45
/** the walkout's roars (ms into the walkout): words.ts walkoutLines calls each corner at these moments */
export const INTRO = { a: 1000, b: 2900, len: 2000 }
/** the decision's winner roars this long after the final bell */
export const DEC_ROAR = 1600

/** the kaijus' standing heights (models/ rig.height) and how far their bodies reach round their centres */
export const HEIGHT: Record<KaijuId, number> = { rexor: 11.5, gorrath: 11.5, titan: 12.5, kraka: 10, lumina: 12, pincer: 11, bedrock: 13, voltra: 13 }
export const GIRTH: Record<KaijuId, number> = { rexor: 2.6, gorrath: 3.1, titan: 2.7, kraka: 3.3, lumina: 2.3, pincer: 3.4, bedrock: 3.2, voltra: 2.6 }

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

/* ------------------------------------------------------------------ */
/*  The show's clock                                                    */
/* ------------------------------------------------------------------ */

export type Stretch = 'bets' | 'walkout' | 'fight' | 'after'

/** when the finish's slow motion and replay run, in live fight ms (null for a decision) */
export interface ReplayPlan {
  /** the finish (fight.endsAt) */
  E: number
  /** the replay runs from r0 to r1 (live ms), showing script time from s0 at `rate` */
  r0: number
  r1: number
  s0: number
  rate: number
}

const replays = new WeakMap<Fight, ReplayPlan | null>()

export function replayOf(f: Fight): ReplayPlan | null {
  if (replays.has(f)) return replays.get(f)!
  let plan: ReplayPlan | null = null
  if (f.result.method !== 'dec') {
    const E = f.endsAt
    const r0 = E + HOLD_MS + SLOW_MS
    // it has to end with a little celebration left before the next round opens: a late finish gets a shorter, quicker one
    const limit = FIGHT_MS + (CYCLE_MS - FIGHT0 - FIGHT_MS) - 1400
    let pre = PRE_MS
    let rate = REPLAY_RATE
    for (let i = 0; i < 12 && r0 + (pre + POST_MS) / rate > limit; i++) {
      pre = Math.max(1300, pre - 150)
      rate = Math.min(0.8, rate + 0.04)
    }
    plan = { E, r0, r1: r0 + Math.round((pre + POST_MS) / rate), s0: E - pre, rate }
  }
  replays.set(f, plan)
  return plan
}

export interface Show {
  /** ms since the round opened */
  c: number
  stretch: Stretch
  /** live ms from the first bell (negative before it) */
  r: number
  /** the script time on show: r, except in a finish's hit-stop, slow motion and replay */
  st: number
  /** script ms per real ms right now (0 in the hit-stop) */
  rate: number
  replay: boolean
  /** a white flash at the finish, 0 to 1 */
  flash: number
  shot: Shot
  /** how far through its shot, 0 to 1 */
  u: number
  /** the shot's place in the list (a new one is a cut) */
  cut: number
}

/** what the stage shows at a moment (now: the shared clock) */
export function show(view: StageView, now: number): Show {
  const c = clamp(now - view.times.opensAt, 0, CYCLE_MS - 1)
  const r = c - FIGHT0
  const f = view.fight
  let st = r
  let rate = 1
  let replay = false
  let flash = 0
  const plan = f ? replayOf(f) : null
  if (plan) {
    const { E } = plan
    if (r >= E && r < E + HOLD_MS) {
      st = E
      rate = 0
    } else if (r >= E + HOLD_MS && r < plan.r0) {
      st = E + (r - E - HOLD_MS) * SLOW_RATE
      rate = SLOW_RATE
    } else if (r >= plan.r0 && r < plan.r1) {
      st = plan.s0 + (r - plan.r0) * plan.rate
      rate = plan.rate
      replay = true
    }
    if (r >= E) flash = Math.max(0, 1 - (r - E) / 300)
  }
  const stretch: Stretch = c < WALK0 ? 'bets' : c < FIGHT0 ? 'walkout' : f && r >= (plan ? plan.E : FIGHT_MS) ? 'after' : 'fight'
  const shots = planShots(view)
  let i = 0
  while (i < shots.length - 1 && c >= shots[i + 1].c0) i++
  const s = shots[i]
  return { c, stretch, r, st, rate, replay, flash, shot: s, u: clamp((c - s.c0) / Math.max(1, s.c1 - s.c0), 0, 1), cut: i }
}

/* ------------------------------------------------------------------ */
/*  What the page hears                                                 */
/* ------------------------------------------------------------------ */

const STRIKES = new Set(['jab', 'heavy', 'tail', 'charge', 'beam', 'grab', 'throw', 'stomp'])
export const isStrike = (e: FightEvent) => STRIKES.has(e.action)
/** a blow that counts as heavy for the sounds and the effects */
export const heavyOf = (e: FightEvent) => e.action === 'heavy' || e.action === 'charge' || e.action === 'beam' || e.action === 'throw' || (e.dmg ?? 0) >= 12

/** the moment a thrown kaiju lands, for a throw (the end of the other's 'thrown') */
function landingOf(f: Fight, th: FightEvent): FightEvent | null {
  const at = impactAt(th)
  return f.events.find((e) => e.who !== th.who && e.action === 'thrown' && Math.abs(e.t - at) <= 2) ?? null
}

export interface Cue {
  /** ms since the round opened */
  c: number
  e: StageEvent
}

const cues = new WeakMap<Fight, Cue[]>()
const bare = new Map<string, Cue[]>()

/**
 * Everything the stage tells the page in a round, on the live clock, in order. `who` is always the kaiju doing it:
 * the striker for 'land' and for 'block' (its blow was blocked), the winner for 'ko' and 'splash', the roarer for
 * 'roar'; 'collapse' names the building and who brought it down. 'final' is the final bell of a decision (a fight
 * that ends early ends with its 'ko' or 'splash').
 */
export function stageEvents(view: StageView): Cue[] {
  const f = view.fight
  const pre: Cue[] = [
    { c: WALK0 + INTRO.a, e: { kind: 'roar', who: 'a' } },
    { c: WALK0 + INTRO.b, e: { kind: 'roar', who: 'b' } },
  ]
  if (!f) {
    const k = `${view.id}`
    let hit = bare.get(k)
    if (!hit) {
      hit = pre
      if (bare.size > 8) bare.clear()
      bare.set(k, hit)
    }
    return hit
  }
  const memo = cues.get(f)
  if (memo) return memo
  const out: Cue[] = [...pre]
  const res = f.result
  const last = res.method === 'dec' ? 3 : res.round
  for (let k = 1; k <= last; k++) out.push({ c: FIGHT0 + roundStart(k), e: { kind: 'bell', round: k as 1 | 2 | 3 } })
  for (const e of f.events) {
    // (after an early finish the stage is in its slow motion and replay: the celebration's roars are cheersOf's)
    if (e.t >= f.endsAt && (e.action !== 'roar' || f.result.method !== 'dec')) continue
    if (e.action === 'roar') out.push({ c: FIGHT0 + e.t, e: { kind: 'roar', who: e.who } })
    if (!e.outcome || e.action === 'grab' || e.action === 'stomp') continue
    if (e.outcome === 'block') out.push({ c: FIGHT0 + impactAt(e), e: { kind: 'block', who: e.who } })
    if (e.outcome !== 'land') continue
    if (e.action === 'throw') {
      // the thud is the body hitting the ground (a Splash is its own sound)
      const l = landingOf(f, e)
      if (l && !(res.method === 'splash' && l.t + l.dur === f.endsAt)) out.push({ c: FIGHT0 + l.t + l.dur, e: { kind: 'land', who: e.who, heavy: true } })
      continue
    }
    out.push({ c: FIGHT0 + impactAt(e), e: { kind: 'land', who: e.who, heavy: heavyOf(e) } })
  }
  for (const col of f.collapses) out.push({ c: FIGHT0 + col.t, e: { kind: 'collapse', building: col.building, by: col.by } })
  if (res.method === 'ko') out.push({ c: FIGHT0 + f.endsAt, e: { kind: 'ko', who: res.winner } })
  else if (res.method === 'splash') out.push({ c: FIGHT0 + f.endsAt, e: { kind: 'splash', who: res.winner } })
  else {
    out.push({ c: FIGHT0 + FIGHT_MS, e: { kind: 'final' } })
    out.push({ c: FIGHT0 + FIGHT_MS + DEC_ROAR, e: { kind: 'roar', who: res.winner } })
  }
  // the celebration's roars (acting.ts) after a knockout or a Splash
  for (const t of cheersOf(f)) out.push({ c: FIGHT0 + t, e: { kind: 'roar', who: res.winner } })
  out.sort((x, y) => x.c - y.c)
  cues.set(f, out)
  return out
}

/** when the winner throws its head back in the celebration after an early finish (live ms; acting.ts plays them) */
export function cheersOf(f: Fight): number[] {
  if (f.result.method === 'dec') return []
  const plan = replayOf(f)!
  const out: number[] = []
  // one as the replay ends, then every 7 s or so while there is time
  for (let t = plan.r1 + 600; t + 2000 < CYCLE_MS - FIGHT0 - 600; t += 7200) out.push(t)
  return out
}

/* ------------------------------------------------------------------ */
/*  The shot list                                                       */
/* ------------------------------------------------------------------ */

export type ShotKind = 'establish' | 'orbit' | 'hero' | 'pair' | 'ots' | 'side' | 'building' | 'low' | 'finish' | 'splash' | 'replay' | 'victory' | 'break' | 'crane'

export interface Shot {
  /** ms since the round opened */
  c0: number
  c1: number
  kind: ShotKind
  /** the kaiju it is about: the striker, the hero, the winner */
  who?: Side
  building?: number
  /** the angle off the shot's own line (radians), its elevation (radians) and how much farther than it needs to be */
  az: number
  el: number
  k: number
  fov: number
  /** raised this much higher (radians of elevation) when the low angles are all blocked (aim) */
  lift?: number
}

/** the kaiju where they are, for framing */
export interface Frame {
  a: P
  b: P
  ha: number
  hb: number
  aspect: number
  /** how far their bodies reach round their centres (GIRTH), for keeping both in sight */
  ga?: number
  gb?: number
}

interface Cand {
  s: number
  e: number
  kind: ShotKind
  who?: Side
  building?: number
  prio: number
  el?: number
}

const plans = new WeakMap<Fight, Shot[]>()
const prePlans = new Map<string, Shot[]>()

/** a small seeded stream for the variety in the angles (deterministic per round) */
function stream(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

export function planShots(view: StageView): Shot[] {
  const f = view.fight
  if (f) {
    const hit = plans.get(f)
    if (hit) return hit
  } else {
    const k = `${view.id}:${view.matchup.a}-${view.matchup.b}`
    const hit = prePlans.get(k)
    if (hit) return hit
  }
  const rand = stream(view.id + 7)
  const ha = HEIGHT[view.matchup.a]
  const hb = HEIGHT[view.matchup.b]
  const shots: Shot[] = []
  const add = (c0: number, c1: number, kind: ShotKind, o: Partial<Shot> = {}) => shots.push({ c0, c1, kind, az: 0, el: 0.2, k: 1, fov: 36, ...o })
  // the betting show and the walkout
  add(0, 5200, 'establish', { az: -0.22 + rand() * 0.14 })
  add(5200, 8600, 'hero', { who: 'a' })
  add(8600, 12000, 'hero', { who: 'b' })
  add(12000, WALK0, 'orbit', { az: -0.45 + rand() * 0.1 })
  add(WALK0, WALK0 + 900, 'establish', { az: 0.1 })
  add(WALK0 + 900, WALK0 + INTRO.b - 50, 'hero', { who: 'a', el: 1 })
  add(WALK0 + INTRO.b - 50, WALK0 + INTRO.b + INTRO.len - 100, 'hero', { who: 'b', el: 1 })
  add(WALK0 + INTRO.b + INTRO.len - 100, FIGHT0, 'pair', { el: 0.12, k: 1.1 })
  if (!f) {
    // no fight yet (betting, or a key that is late): the pair at their marks to the end
    add(FIGHT0, CYCLE_MS, 'orbit', { az: -0.2 })
    const k = `${view.id}:${view.matchup.a}-${view.matchup.b}`
    if (prePlans.size > 8) prePlans.clear()
    prePlans.set(k, shots)
    return shots
  }

  const res = f.result
  const plan = replayOf(f)
  const E = f.endsAt
  const lastRound = res.method === 'dec' ? 3 : res.round
  // the fight up to the finish (or the final bell): candidates by priority, placed greedily, gaps filled with two-shots
  const cands: Cand[] = []
  for (let k = 1; k <= lastRound; k++) cands.push({ s: roundStart(k), e: roundStart(k) + 2300, kind: 'crane', prio: 2 })
  for (let k = 1; k < lastRound; k++) cands.push({ s: roundStart(k) + ROUND_MS + 250, e: roundStart(k + 1), kind: 'break', prio: 1.5 })
  const finishAt = res.method === 'splash' ? (f.events.find((e) => e.who === res.winner && e.action === 'grab' && e.t > E - 4000)?.t ?? E - 1500) - 500 : E - 1500
  for (const e of f.events) {
    if (e.t >= finishAt) continue
    if (e.cue === 'flash') cands.push({ s: e.t + 0.12 * e.dur, e: e.t + e.dur + 350, kind: 'side', who: e.who, prio: 4 })
    else if (e.cue === 'close' && e.outcome === 'land') cands.push({ s: impactAt(e) - 750, e: impactAt(e) + 950, kind: 'ots', who: e.who, prio: 3 })
    else if (e.action === 'grab' && e.outcome === 'land') {
      const th = f.events.find((x) => x.who === e.who && x.action === 'throw' && x.t >= e.t && x.t < e.t + 3000)
      const fl = th && landingOf(f, th)
      if (fl) cands.push({ s: e.t - 250, e: fl.t + fl.dur + 650, kind: 'low', who: e.who, prio: 3.5 })
    } else if (e.action === 'knockdown') cands.push({ s: e.t - 350, e: e.t + e.dur + 700, kind: 'low', who: other(e.who), prio: 3.2 })
  }
  for (const col of f.collapses) if (col.t < finishAt + 600) cands.push({ s: col.t - 1000, e: col.t + 1700, kind: 'building', building: col.building, who: col.by, prio: 5 })
  const end = res.method === 'dec' ? FIGHT_MS : finishAt
  const placed: Cand[] = []
  for (const cd of [...cands].sort((x, y) => y.prio - x.prio || x.s - y.s)) {
    let s = Math.max(0, cd.s)
    let e = Math.min(end, cd.e)
    if (e - s < 900) continue
    let ok = true
    for (const p of placed) {
      const over = Math.min(e, p.e) - Math.max(s, p.s)
      if (over <= 0) continue
      if (over > 0.3 * (e - s)) {
        ok = false
        break
      }
      // trim it off the one already there
      if (p.s <= s) s = p.e
      else e = p.s
    }
    if (ok && e - s >= 900) placed.push({ ...cd, s, e })
  }
  placed.sort((x, y) => x.s - y.s)
  // the gaps: two-shots from varied angles, 2.4 to 4 s each (a short gap stretches the shot before it)
  const VAR: [number, number, number][] = [[-0.22, 0.2, 1.05], [0.32, 0.28, 1.12], [0.05, 0.14, 0.98], [-0.42, 0.3, 1.1], [0.45, 0.17, 1.02], [-0.08, 0.36, 1.18]]
  let vi = Math.floor(rand() * VAR.length)
  const fight: Cand[] = []
  let t = 0
  const fill = (to: number) => {
    const gap = to - t
    if (gap <= 0) return
    if (gap < 700 && fight.length) {
      fight[fight.length - 1].e = to
      t = to
      return
    }
    const n = Math.max(1, Math.round(gap / 3200))
    for (let i = 0; i < n; i++) {
      fight.push({ s: t + (gap * i) / n, e: t + (gap * (i + 1)) / n, kind: 'pair', prio: 0, el: vi++ })
    }
    t = to
  }
  for (const p of placed) {
    fill(p.s)
    fight.push(p)
    t = p.e
  }
  fill(end)
  for (const cd of fight) {
    const v = VAR[(cd.el ?? 0) % VAR.length]
    add(FIGHT0 + cd.s, FIGHT0 + cd.e, cd.kind, {
      who: cd.who,
      building: cd.building,
      ...(cd.kind === 'pair' ? { az: v[0], el: v[1], k: v[2] } : {}),
      ...(cd.kind === 'crane' ? { az: (rand() - 0.5) * 0.5, el: 0.42, k: 1.25 } : {}),
      ...(cd.kind === 'side' ? { el: 0.05, k: 0.88, fov: 40 } : {}),
      ...(cd.kind === 'ots' ? { fov: 38 } : {}),
      ...(cd.kind === 'building' ? { az: 0.95 } : {}),
      ...(cd.kind === 'low' ? { el: 0.06, k: 0.92 } : {}),
      ...(cd.kind === 'break' ? { az: (rand() - 0.5) * 0.8, el: 0.55, k: 1.35 } : {}),
    })
  }
  // after the finish (or the final bell)
  const W = res.winner
  if (plan) {
    add(FIGHT0 + finishAt, FIGHT0 + plan.r0, res.method === 'splash' ? 'splash' : 'finish', { who: W, fov: res.method === 'splash' ? 42 : 34 })
    add(FIGHT0 + plan.r0, FIGHT0 + plan.r1, 'replay', { who: W, el: 0.1, k: 0.92, fov: 34 })
    afterShots(add, FIGHT0 + plan.r1, CYCLE_MS, W, rand)
  } else {
    add(FIGHT0 + FIGHT_MS, FIGHT0 + FIGHT_MS + DEC_ROAR, 'pair', { el: 0.26, k: 1.15 })
    afterShots(add, FIGHT0 + FIGHT_MS + DEC_ROAR, CYCLE_MS, W, rand)
  }
  shots.sort((x, y) => x.c0 - y.c0)
  aim(shots, f, ha, hb, GIRTH[view.matchup.a], GIRTH[view.matchup.b])
  plans.set(f, shots)
  return shots
}

/** the celebration: an orbit round the winner, then wider shots in turn while there is time */
function afterShots(add: (c0: number, c1: number, kind: ShotKind, o?: Partial<Shot>) => void, c0: number, c1: number, W: Side, rand: () => number) {
  const order: [ShotKind, Partial<Shot>][] = [
    ['victory', { who: W, az: rand() * 0.6 - 0.3 }],
    ['pair', { el: 0.3, k: 1.25, az: 0.25 }],
    ['hero', { who: W, el: 1 }],
    ['crane', { el: 0.5, k: 1.3, az: -0.2 }],
    ['victory', { who: W, az: 0.9 }],
  ]
  let t = c0
  let i = 0
  while (t < c1) {
    const len = i === 0 ? 6200 : 5200
    const e = c1 - (t + len) < 2500 ? c1 : t + len
    const [kind, o] = order[i % order.length]
    add(t, e, kind, o)
    t = e
    i++
  }
}

/* ------------------------------------------------------------------ */
/*  Seeing past the buildings                                           */
/* ------------------------------------------------------------------ */

interface Box {
  x: number
  z: number
  c: number
  s: number
  w: number
  d: number
  h: number
}
const BOXES: Box[] = BUILDINGS.map((b) => ({ x: b.x, z: b.z, c: Math.cos(b.rot), s: Math.sin(b.rot), w: b.w / 2, d: b.d / 2, h: b.h }))
/** the bay's landmarks the camera must not fly through or look through: the lighthouse and the pier's wheel */
export const WHEEL = { x: 21, z: -44, r: 7.5, y: 9 }
const EXTRA: Box[] = [
  { x: LIGHTHOUSE.x, z: LIGHTHOUSE.z, c: 1, s: 0, w: 2.6, d: 2.6, h: 17 },
  { x: WHEEL.x, z: WHEEL.z, c: 1, s: 0, w: WHEEL.r + 0.5, d: 1.5, h: WHEEL.y + WHEEL.r + 1 },
]

/** whether the segment p→q passes through a box (in its own frame: a slab test) */
function crosses(b: Box, p: V3, q: V3, grow = 0) {
  const lp = [(p.x - b.x) * b.c - (p.z - b.z) * b.s, p.y, (p.x - b.x) * b.s + (p.z - b.z) * b.c]
  const lq = [(q.x - b.x) * b.c - (q.z - b.z) * b.s, q.y, (q.x - b.x) * b.s + (q.z - b.z) * b.c]
  const lo = [-b.w - grow, -1, -b.d - grow]
  const hi = [b.w + grow, b.h + grow, b.d + grow]
  let t0 = 0
  let t1 = 1
  for (let k = 0; k < 3; k++) {
    const d = lq[k] - lp[k]
    if (Math.abs(d) < 1e-9) {
      if (lp[k] < lo[k] || lp[k] > hi[k]) return false
      continue
    }
    let a = (lo[k] - lp[k]) / d
    let c = (hi[k] - lp[k]) / d
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
    if (t0 > t1) return false
  }
  return true
}

/** where along p→q (0 to 1) the segment first enters a box, or null */
function entry(b: Box, p: V3, q: V3, grow: number): number | null {
  const lp = [(p.x - b.x) * b.c - (p.z - b.z) * b.s, p.y, (p.x - b.x) * b.s + (p.z - b.z) * b.c]
  const lq = [(q.x - b.x) * b.c - (q.z - b.z) * b.s, q.y, (q.x - b.x) * b.s + (q.z - b.z) * b.c]
  const lo = [-b.w - grow, -1, -b.d - grow]
  const hi = [b.w + grow, b.h + grow, b.d + grow]
  let t0 = 0
  let t1 = 1
  for (let k = 0; k < 3; k++) {
    const d = lq[k] - lp[k]
    if (Math.abs(d) < 1e-9) {
      if (lp[k] < lo[k] || lp[k] > hi[k]) return null
      continue
    }
    let a = (lo[k] - lp[k]) / d
    let c = (hi[k] - lp[k]) / d
    if (a > c) [a, c] = [c, a]
    t0 = Math.max(t0, a)
    t1 = Math.min(t1, c)
    if (t0 > t1) return null
  }
  return t0
}

/**
 * The camera's collision: if a standing building (or the lighthouse, or the wheel) stands between what the camera
 * looks at and where it would be, it comes in to just in front of it. The shots are planned for a 16:9 stage; a
 * taller one (a phone) stands farther back to fit the same width, and this keeps it out of the buildings.
 */
export function pullIn(eye: V3, target: V3, standing: (i: number) => boolean): V3 {
  const len = Math.hypot(eye.x - target.x, eye.y - target.y, eye.z - target.z)
  if (len < 1) return eye
  let t = 1
  BOXES.forEach((b, i) => {
    if (!standing(i)) return
    const e = entry(b, target, eye, 1.2)
    if (e !== null && e > 0.02) t = Math.min(t, e)
  })
  for (const b of EXTRA) {
    const e = entry(b, target, eye, 1.2)
    if (e !== null && e > 0.02) t = Math.min(t, e)
  }
  if (t >= 1) return eye
  const k = Math.max(0.2, t - 0.6 / len)
  return { x: target.x + (eye.x - target.x) * k, y: target.y + (eye.y - target.y) * k, z: target.z + (eye.z - target.z) * k }
}

/** how far a point is from a box's sides (0 inside), in the ground plane, and whether it is under its roof */
function boxDist(b: Box, p: V3) {
  const lx = (p.x - b.x) * b.c - (p.z - b.z) * b.s
  const lz = (p.x - b.x) * b.s + (p.z - b.z) * b.c
  const dx = Math.max(0, Math.abs(lx) - b.w)
  const dz = Math.max(0, Math.abs(lz) - b.d)
  return p.y > b.h + 1 ? Infinity : Math.hypot(dx, dz)
}

/**
 * How badly a camera position is placed: inside, beside or behind standing buildings, off the ground, too far out,
 * one kaiju hiding the other, or a kaiju right up against the lens.
 */
function badness(eye: V3, looks: V3[], standing: Set<number>, fr?: Frame): number {
  let bad = 0
  const onLand = eye.z > SHORE_Z - 1
  const r = Math.hypot(eye.x, eye.z)
  // a low camera stays on the plaza (or over the water): beyond the ring it would look through buildings and rubble;
  // only over the low shops at the front, or high up, may it stand farther out
  const front = Math.abs(Math.atan2(eye.x, eye.z)) < 0.42 && eye.y > 7.2
  if (onLand && r > 26.5 && eye.y < 18 && !front) bad += 6 + (r - 26.5) * 0.4
  if (onLand && r > 42 && eye.y < 34) bad += 6
  if (eye.z < -60 || Math.abs(eye.x) > 60) bad += 6
  if (eye.y < (onLand ? 1.2 : 2.5)) bad += 6
  // a fallen building leaves a heap that still blocks a low view
  const all = [...BOXES.map((b, i) => (standing.has(i) ? b : { ...b, h: 3 })), ...EXTRA]
  for (const b of all) {
    const d = boxDist(b, eye)
    if (d < 1.2) bad += 8
    else if (d < 6) bad += (6 - d) * 0.7
    for (const q of looks) if (crosses(b, eye, q, -0.4)) bad += 3
  }
  if (fr) {
    const ga = fr.ga ?? 3
    const gb = fr.gb ?? 3
    const A = { x: fr.a.x - eye.x, y: fr.ha * 0.5 - eye.y, z: fr.a.z - eye.z }
    const B = { x: fr.b.x - eye.x, y: fr.hb * 0.5 - eye.y, z: fr.b.z - eye.z }
    const la = Math.hypot(A.x, A.y, A.z)
    const lb = Math.hypot(B.x, B.y, B.z)
    // the angle between them against the angles their bodies take up: too small and the nearer hides the farther
    const sep = Math.acos(Math.max(-1, Math.min(1, (A.x * B.x + A.y * B.y + A.z * B.z) / (la * lb))))
    const need = (ga / la + gb / lb) * 0.85
    if (sep < need) bad += 5 * (1 - sep / need) + 1
    if (la < ga * 1.5 + 6 || lb < gb * 1.5 + 6) bad += 4
  }
  return bad
}

/** how much the kaiju stand in the way of a look from the eye to a point (a building that is the shot's subject) */
function blockedByKaiju(eye: V3, q: V3, fr: Frame) {
  let bad = 0
  for (const [k, h, g] of [[fr.a, fr.ha, fr.ga ?? 3], [fr.b, fr.hb, fr.gb ?? 3]] as const) {
    const vx = q.x - eye.x
    const vz = q.z - eye.z
    const l = vx * vx + vz * vz || 1
    const s = Math.max(0, Math.min(1, ((k.x - eye.x) * vx + (k.z - eye.z) * vz) / l))
    const d = Math.hypot(eye.x + vx * s - k.x, eye.z + vz * s - k.z)
    const y = eye.y + (q.y - eye.y) * s
    if (s > 0.05 && s < 0.95 && d < g * 1.4 && y < h) bad += 4
  }
  return bad
}

/** turns each shot that can be turned to the angle that sees its subjects best over its length */
function aim(shots: Shot[], f: Fight, ha: number, hb: number, ga: number, gb: number) {
  for (const s of shots) {
    if (s.kind === 'establish' || s.kind === 'orbit' || s.kind === 'crane' || s.kind === 'break') continue
    const tries =
      s.kind === 'hero' || s.kind === 'victory'
        ? [0, 0.35, -0.35, 0.7, -0.7, 1.2, -1.2]
        : s.kind === 'building'
          ? [0, -1.9, 0.3, -0.3, -1.6, -2.2, 0.6, -2.5]
          : [0, 0.25, -0.25, 0.5, -0.5, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, Math.PI]
    const frames = [0.1, 0.5, 0.9].map((u) => ({ ...frameAt(f, s.c0 + (s.c1 - s.c0) * u, ha, hb), ga, gb }))
    const st = stAt(f, s.c0)
    const standing = new Set(BUILDINGS.map((_, i) => i).filter((i) => !fallenAt(f, st).includes(i)))
    let best = s.az
    let bestLift = 0
    let top = Infinity
    const lifts = s.kind === 'hero' || s.kind === 'victory' ? [0] : s.kind === 'building' ? [0, 0.38] : [0, 0.32]
    for (const [lift, d] of lifts.flatMap((l) => tries.map((t) => [l, t] as const))) {
      const trial: Shot = { ...s, az: s.az + d, lift }
      // turning away from the shot's own line costs a little (the reverse angle, over the water, no more than a quarter turn)
      let bad = Math.min(1, Math.abs(s.kind === 'building' ? (Math.abs(d) > 1.2 ? Math.abs(d) - 1.9 : d) : d)) * 1.2 + lift * 4
      frames.forEach((fr, j) => {
        const p = shotPose(trial, [0.1, 0.5, 0.9][j], fr)
        const looks: V3[] = [p.target, { x: fr.a.x, y: fr.ha * 0.7, z: fr.a.z }, { x: fr.b.x, y: fr.hb * 0.7, z: fr.b.z }]
        // a close-up of one kaiju needn't keep the other in sight
        const solo = s.kind === 'hero' || s.kind === 'victory'
        bad += badness(p.eye, solo ? [p.target] : looks, standing, solo ? undefined : fr)
        if (s.kind === 'building') {
          const B = BUILDINGS[s.building ?? 0]
          bad += blockedByKaiju(p.eye, { x: B.x, y: B.h * 0.6, z: B.z }, fr)
        }
      })
      if (bad < top) {
        top = bad
        best = trial.az
        bestLift = lift
      }
    }
    s.az = best
    if (bestLift) s.lift = bestLift
  }
}

/** the script time on show at a moment of the round (for planning: the replay's own time inside it) */
function stAt(f: Fight, c: number) {
  const r = c - FIGHT0
  const plan = replayOf(f)
  if (plan && r >= plan.r0 && r < plan.r1) return plan.s0 + (r - plan.r0) * plan.rate
  if (plan && r >= plan.E && r < plan.r0) return plan.E
  return clamp(r, 0, FIGHT_MS)
}

/** where the two are at a moment of the round, for planning (the script's positions; the marks before the bell) */
function frameAt(f: Fight | null, c: number, ha: number, hb: number): Frame {
  if (!f || c < FIGHT0) return { a: START.a, b: START.b, ha, hb, aspect: 16 / 9 }
  const st = stAt(f, c)
  return { a: posAt(f, 'a', st), b: posAt(f, 'b', st), ha, hb, aspect: 16 / 9, ga: 3, gb: 3 }
}

/* ------------------------------------------------------------------ */
/*  Shots as camera positions                                           */
/* ------------------------------------------------------------------ */

export interface Pose {
  eye: V3
  target: V3
  fov: number
}

const rot = (x: number, z: number, a: number): P => ({ x: x * Math.cos(a) - z * Math.sin(a), z: x * Math.sin(a) + z * Math.cos(a) })
const norm = (x: number, z: number): P => {
  const l = Math.hypot(x, z) || 1
  return { x: x / l, z: z / l }
}

/** the side of a line from p to q that looks from the camera's side of the plaza (+z), as a unit vector */
function camSide(p: P, q: P): P {
  const d = norm(q.x - p.x, q.z - p.z)
  const n = { x: -d.z, z: d.x }
  return n.z >= 0 ? n : { x: -n.x, z: -n.z }
}

/** something a shot must keep in frame: where, how far it reaches round its centre, how tall */
interface Subj {
  x: number
  z: number
  r: number
  h: number
}

/**
 * Frames subjects for a camera looking along -n (on the ground): the point to look at, centred across the frame between
 * the subjects' outer edges, and how far back the camera must stand for all of them to fit, each with its reach and
 * height (a subject nearer the camera needs more room than one farther off).
 */
function fit(subs: Subj[], n: P, fov: number, aspect: number, minD: number) {
  const R = { x: n.z, z: -n.x }
  let rx = 0
  let rz = 0
  for (const q of subs) {
    rx += q.x / subs.length
    rz += q.z / subs.length
  }
  let lo = Infinity
  let hi = -Infinity
  for (const q of subs) {
    const x = (q.x - rx) * R.x + (q.z - rz) * R.z
    lo = Math.min(lo, x - q.r)
    hi = Math.max(hi, x + q.r)
  }
  const c = { x: rx + R.x * ((lo + hi) / 2), z: rz + R.z * ((lo + hi) / 2) }
  const th = Math.tan(((fov * Math.PI) / 180) / 2)
  const tw = th * aspect
  let D = minD
  let top = 0
  for (const q of subs) {
    const x = (q.x - c.x) * R.x + (q.z - c.z) * R.z
    const toward = (q.x - c.x) * n.x + (q.z - c.z) * n.z
    D = Math.max(D, (Math.abs(x) + q.r) / tw + toward + q.r * 0.5, (q.h * 0.64) / th + toward)
    top = Math.max(top, q.h)
  }
  return { c, D, top }
}

/** where the camera stands and looks for a shot, u through it, with the kaiju where they are */
export function shotPose(s: Shot, u: number, fr: Frame): Pose {
  const { a, b, ha, hb, aspect } = fr
  const H = Math.max(ha, hb)
  const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }
  const me = s.who === 'b' ? b : a
  const you = s.who === 'b' ? a : b
  const hMe = s.who === 'b' ? hb : ha
  const fov = s.fov
  // the two kaiju as subjects: their bodies, arms, wings and claws reach a good way past their girth
  const pair: Subj[] = [
    { x: a.x, z: a.z, r: (fr.ga ?? 3) * 1.35 + 1, h: ha },
    { x: b.x, z: b.z, r: (fr.gb ?? 3) * 1.35 + 1, h: hb },
  ]
  const at = (c: P, n: P, D: number, y: number, ty: number, el = 0): Pose => ({
    eye: { x: c.x + n.x * D * Math.cos(el), y: y + D * Math.sin(el), z: c.z + n.z * D * Math.cos(el) },
    target: { x: c.x, y: ty, z: c.z },
    fov,
  })
  switch (s.kind) {
    case 'establish': {
      // high over the avenue in front of the plaza (city.ts keeps it low), the bay and the far shore beyond
      const az = s.az + u * 0.16
      return { eye: { x: Math.sin(az) * 64, y: 27 - u * 4, z: Math.cos(az) * 64 }, target: { x: mid.x * 0.4, y: 9, z: -38 }, fov: 40 }
    }
    case 'orbit': {
      // a slow arc over the low shops at the front (the towers either side would block a wider one)
      const az = clamp(s.az + u * 0.4, -0.5, 0.5)
      return { eye: { x: mid.x * 0.4 + Math.sin(az) * 44, y: 14, z: mid.z * 0.4 + Math.cos(az) * 44 }, target: { x: mid.x * 0.6, y: 6, z: mid.z * 0.6 - 2 }, fov: 38 }
    }
    case 'crane':
    case 'break': {
      const n = rot(0, 1, s.az + (u - 0.5) * 0.25)
      const f = fit(pair, n, 38, aspect, 20)
      const el = s.el + (s.kind === 'crane' ? (1 - u) * 0.18 : 0)
      return { ...at(f.c, n, f.D * s.k + 6, 4, H * 0.4, el), fov: 38 }
    }
    case 'hero': {
      // in front of the kaiju, toward the camera side and the middle, low, pushing in; at a walkout (el 1) closer
      const tw = norm(you.x - me.x, you.z - me.z)
      const d = rot(tw.x * 0.5, tw.z * 0.5 + 1, s.az)
      const n = norm(d.x, d.z)
      const D = hMe * (s.el >= 1 ? 2.25 - u * 0.35 : 2.6 - u * 0.45)
      return { eye: { x: me.x + n.x * D, y: hMe * 0.3, z: me.z + n.z * D }, target: { x: me.x + n.x * 0.5, y: hMe * 0.62, z: me.z + n.z * 0.5 }, fov: 34 }
    }
    case 'victory': {
      const tw = norm(you.x - me.x, you.z - me.z)
      const base = norm(tw.x * 0.3, tw.z * 0.3 + 1)
      const n = rot(base.x, base.z, s.az + (u - 0.5) * 0.9)
      const D = hMe * 2.15
      return { eye: { x: me.x + n.x * D, y: hMe * 0.28, z: me.z + n.z * D }, target: { x: me.x, y: hMe * 0.6, z: me.z }, fov: 36 }
    }
    case 'ots': {
      // a big blow: three-quarters behind the striker, so its shoulder frames the one it hits
      const d = norm(you.x - me.x, you.z - me.z)
      const n0 = camSide(a, b)
      const toBack = rot(n0.x, n0.z, 0.55)
      const sg = toBack.x * -d.x + toBack.z * -d.z > n0.x * -d.x + n0.z * -d.z ? 1 : -1
      const n = rot(n0.x, n0.z, sg * 0.55 + s.az)
      const f = fit(pair, n, fov, aspect, 14)
      return at(f.c, n, f.D * 0.95, H * 0.5, H * 0.5, s.lift ?? 0)
    }
    case 'building': {
      // a building coming down: from inside the plaza, well off the line from its middle, so the building, the kaiju
      // knocked into it and the one that did it stand side by side
      const B = BUILDINGS[s.building ?? 0]
      const toB = norm(B.x, B.z)
      const n = rot(-toB.x, -toB.z, s.az)
      const f = fit([...pair, { x: B.x, z: B.z, r: Math.max(B.w, B.d) / 2 + 0.5, h: B.h }], n, 40, aspect, 20)
      const tall = Math.max(B.h, H)
      // a low building is looked down on a little, so the kaiju in front of it don't hide it
      const y = Math.max(B.h * 0.45, H * (B.h < 9 ? 0.75 : 0.45)) + 1.5
      return { ...at(f.c, n, f.D, y, tall * 0.42, s.lift ?? 0), fov: 40 }
    }
    case 'finish':
    case 'low':
    case 'replay': {
      // low and to the side of the pair (the replay from the other side)
      const side = camSide(a, b)
      const n = s.kind === 'replay' ? rot(-side.x, -side.z, s.az) : rot(side.x, side.z, s.az)
      const f = fit(pair, n, fov, aspect, 15)
      const dolly = s.kind === 'finish' ? 1.06 - u * 0.1 : s.kind === 'replay' ? 1.1 - u * 0.14 : 1.02
      return at(f.c, n, f.D * dolly * (s.kind === 'replay' ? s.k : 1), s.kind === 'replay' ? 2.8 + H * 0.15 : 2.2 + H * 0.08, H * 0.46, s.lift ?? 0)
    }
    case 'splash': {
      // from the land behind the thrower, out to the bay where the loser comes down
      const w = me
      const side = rot(1, 0, s.az)
      const eye = { x: w.x + side.x * 15, y: 9.5, z: Math.max(w.z + 15, -4) }
      return { eye, target: { x: w.x * 0.5 + you.x * 0.5, y: 3.5, z: Math.min(w.z, you.z) - 6 }, fov }
    }
    case 'side':
    case 'pair':
    default: {
      const n = rot(camSide(a, b).x, camSide(a, b).z, s.az)
      const f = fit(pair, n, fov, aspect, 16)
      return at(f.c, n, f.D * s.k, s.kind === 'side' ? 2.4 : H * 0.32, H * (s.kind === 'side' ? 0.5 : 0.46), s.el + (s.lift ?? 0))
    }
  }
}

/* ------------------------------------------------------------------ */
/*  The shake                                                           */
/* ------------------------------------------------------------------ */

const shakes = new WeakMap<Fight, [number, number, number][]>()

/** what shakes the camera: [script ms, strength, how long] */
function shakeList(f: Fight): [number, number, number][] {
  const hit = shakes.get(f)
  if (hit) return hit
  const out: [number, number, number][] = []
  for (const e of f.events) {
    if (e.outcome === 'land' && isStrike(e) && e.action !== 'grab') out.push([impactAt(e), heavyOf(e) ? 0.55 : 0.18, heavyOf(e) ? 700 : 350])
    if (e.cue === 'shake' && !isStrike(e)) out.push([e.t + (e.action === 'thrown' ? e.dur : 0), 0.6, 800])
    if (e.action === 'stomp') out.push([impactAt(e), 0.7, 800])
    if (e.action === 'knockdown') out.push([e.t + e.dur * 0.66, 0.65, 800])
    if (e.action === 'beam') out.push([impactAt(e), 0.3, Math.round(e.dur * 0.4)])
  }
  for (const c of f.collapses) out.push([c.t, 1, 1400])
  if (f.result.method !== 'dec') out.push([f.endsAt, 1.2, 1600])
  out.sort((x, y) => x[0] - y[0])
  shakes.set(f, out)
  return out
}

/** the camera's shake at a moment of the script: strength 0 to about 1.5 */
export function shakeAt(f: Fight | null, st: number): number {
  if (!f) return 0
  let k = 0
  for (const [t, w, d] of shakeList(f)) {
    if (t > st) break
    const u = (st - t) / d
    if (u < 1) k += w * (1 - u) * (1 - u)
  }
  return Math.min(1.6, k)
}

/** a smooth wobble in -1..1 (for the shake), from a few sines */
export const wobble = (t: number, seed: number) => Math.sin(t * 0.0371 + seed) * 0.5 + Math.sin(t * 0.0173 + seed * 2.1) * 0.3 + Math.sin(t * 0.0611 + seed * 0.7) * 0.2

