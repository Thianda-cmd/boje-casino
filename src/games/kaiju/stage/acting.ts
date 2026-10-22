import { FIGHT_MS } from '../clock'
import { BUILDINGS, SHORE_Z, START } from '../arena'
import { IMPACT, actionAt, posAt } from '../fight'
import { LOOP_S } from '../models/motion'
import type { Action, Fight, FightEvent, KaijuId, Side, StageView } from '../types'
import { DEC_ROAR, FIGHT0, INTRO, WALK0, WATER_Y, cheersOf, replayOf, type Show } from './director'

/*
  How the two kaiju act at a moment of the show, as plain numbers for the rigs (no three.js): where each stands, which
  way it faces, what it is doing and how far through, its glow and hit flash, and how bright its spotlight is. Like
  the director, a pure function of the round and the clock, so a scrub, a reload or another screen shows the same.

  Before the bell the stage acts on its own: both idle on their marks while the bets are taken (each shows off once,
  when the camera visits it), and at the walkout each turns to the camera in its spotlight and roars when the
  announcer calls its corner. From the bell the script says everything: positions from fight.ts posAt, the action
  playing and its progress (one-shot actions by their progress, so a blow lands on the frame the script lands it;
  walks by the distance covered, so the feet keep pace with the ground), facing the other kaiju except where that
  would be wrong (smashing a building faces the building, a long walk away turns its back, a kaiju on the ground or
  in the air keeps the way it fell). Two corrections are the stage's own: a strike leans in or holds back a little so
  a short arm still connects and a long claw doesn't pass through its target (the rigs' reach varies from 5 to 13),
  and two bodies too close to fit are eased apart. After the script ends the winner celebrates under its spotlight.
*/

export interface Act {
  x: number
  z: number
  /** the group's height: the bay's surface for a kaiju in the water */
  y: number
  /** rotation.y: which way it faces */
  face: number
  action: Action
  /** progress for rig.pose (one-shots 0 to 1; loops count cycles) */
  t: number
  /** seconds to ease into a new action */
  blend: number
  /** the rig's clock, seconds (breathing, sway) */
  time: number
  charge: number
  flash: number
  /** its spotlight, 0 to 1 */
  spot: number
  /** how high its body is off the ground (the shadow shrinks) */
  air: number
  /** the script beat playing, and how far through */
  ev: FightEvent | null
  p: number
}

export interface Cast {
  id: Record<Side, KaijuId>
  h: Record<Side, number>
  reach: Record<Side, number>
  girth: Record<Side, number>
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const smooth = (x: number) => {
  const u = clamp(x, 0, 1)
  return u * u * (3 - 2 * u)
}
const angle = (dx: number, dz: number) => Math.atan2(dx, dz)
const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')
/** a blend between two angles the short way round */
export function mixAngle(a: number, b: number, k: number) {
  let d = b - a
  d -= Math.PI * 2 * Math.round(d / (Math.PI * 2))
  return a + d * k
}

const REACT = new Set<Action>(['hit', 'stagger', 'knockdown', 'block', 'dodge'])
const LYING = new Set<Action>(['knockdown', 'down', 'getup', 'thrown', 'sink'])
const LUNGE = new Set<Action>(['jab', 'heavy', 'grab'])

/** each side's beats, in order (cached per fight), to look back along */
const beats = new WeakMap<Fight, Record<Side, FightEvent[]>>()
function beatsOf(f: Fight, s: Side) {
  let b = beats.get(f)
  if (!b) {
    b = { a: f.events.filter((e) => e.who === 'a'), b: f.events.filter((e) => e.who === 'b') }
    beats.set(f, b)
  }
  return b[s]
}

/** the way a kaiju faces at a moment when nothing says otherwise: at the other one */
const faceAt = (f: Fight, s: Side, ms: number) => {
  const p = posAt(f, s, ms)
  const q = posAt(f, other(s), ms)
  return angle(q.x - p.x, q.z - p.z)
}

/** the walkout's facing for a hero: toward the camera side, a little toward the middle (where the hero shot stands) */
function heroFace(me: { x: number; z: number }, you: { x: number; z: number }) {
  const dx = you.x - me.x
  const dz = you.z - me.z
  const l = Math.hypot(dx, dz) || 1
  return angle((dx / l) * 0.5, (dz / l) * 0.5 + 1)
}

function idleAct(side: Side, x: number, z: number, face: number, time: number, spot: number): Act {
  return { x, z, y: 0, face, action: 'idle', t: time / (LOOP_S.idle ?? 3.4) + (side === 'b' ? 0.37 : 0), blend: 0.3, time, charge: 0, flash: 0, spot, air: 0, ev: null, p: 0 }
}

/** both kaiju at a moment of the show */
export function actAll(view: StageView, sh: Show, cast: Cast): Record<Side, Act> {
  const f = view.fight
  if (!f || sh.c < FIGHT0) return preFight(sh, f)
  const out = { a: scripted(f, 'a', sh, cast), b: scripted(f, 'b', sh, cast) }
  // two bodies too close to fit are eased apart (not one in the air or the water)
  const A = out.a
  const B = out.b
  if (A.action !== 'thrown' && B.action !== 'thrown' && A.action !== 'sink' && B.action !== 'sink') {
    const dx = B.x - A.x
    const dz = B.z - A.z
    const d = Math.hypot(dx, dz) || 1e-3
    const need = (cast.girth.a + cast.girth.b) * 0.92
    if (d < need) {
      const k = (need - d) / 2 / d
      A.x -= dx * k
      A.z -= dz * k
      B.x += dx * k
      B.z += dz * k
    }
  }
  return out
}

/** betting and the walkout: on the marks; showing off once while betting, roaring in turn at the walkout */
function preFight(sh: Show, f: Fight | null): Record<Side, Act> {
  const c = sh.c
  const time = c / 1000
  const res: Partial<Record<Side, Act>> = {}
  for (const s of ['a', 'b'] as const) {
    const me = START[s]
    const you = START[other(s)]
    const faceOpp = angle(you.x - me.x, you.z - me.z)
    let spot = 0.4
    const act = idleAct(s, me.x, me.z, faceOpp, time + (s === 'b' ? 1.3 : 0), spot)
    if (c < WALK0) {
      // while the camera visits it (director: the hero shots), a show-off
      const at = s === 'a' ? 6000 : 9500
      if (c >= at && c < at + 1600) Object.assign(act, { action: 'taunt', t: (c - at) / 1600, blend: 0.25 })
    } else if (c < FIGHT0 || !f) {
      const w = c - WALK0
      const at = INTRO[s]
      // the lights go down as the walkout starts, then each corner's spotlight comes up as it is called
      spot = w < 900 ? 0.4 - 0.3 * smooth(w / 500) : 0.1
      spot = Math.max(spot, smooth((w - at + 150) / 300) * (w < at + INTRO.len ? 1 : 0.75))
      if (w >= INTRO.b + INTRO.len) spot = Math.max(spot, 0.6)
      const k = smooth((w - at + 350) / 400) * (1 - smooth((w - at - INTRO.len + 150) / 450))
      act.face = mixAngle(faceOpp, heroFace(me, you), k)
      if (w >= at && w < at + INTRO.len) Object.assign(act, { action: 'roar', t: (w - at) / INTRO.len, blend: 0.22, charge: 0.25 })
      act.spot = spot
    }
    res[s] = act
  }
  return res as Record<Side, Act>
}

/** a kaiju from the script (and, past its end, the celebration) */
function scripted(f: Fight, s: Side, sh: Show, cast: Cast): Act {
  const st = Math.min(sh.st, FIGHT_MS)
  const time = (FIGHT0 + sh.st) / 1000
  const res = f.result
  const W = res.winner
  const plan = replayOf(f)
  const settled = plan ? sh.r >= plan.r0 && !sh.replay : sh.r >= FIGHT_MS + DEC_ROAR
  const spot = settled ? (s === W ? 1 : 0.2) : 0.5
  const now = actionAt(f, s, st)
  const pos = posAt(f, s, st)
  const opp = posAt(f, other(s), st)
  const toOpp = angle(opp.x - pos.x, opp.z - pos.z)
  if (!now) return idleAct(s, pos.x, pos.z, toOpp, time, spot)
  const e = now.e
  const p = now.p
  const act: Act = { x: pos.x, z: pos.z, y: 0, face: toOpp, action: e.action, t: p, blend: 0.18, time, charge: 0, flash: 0, spot, air: 0, ev: e, p }
  const h = cast.h[s]

  // past the script's end (the result on screen): the winner celebrates, the loser stays where it ended
  if (sh.st > FIGHT_MS) {
    const after = sh.st - FIGHT_MS
    if (res.method === 'dec') {
      if (s === W) {
        const face = angle(Math.sin(toOpp) * 0.35, Math.cos(toOpp) * 0.35 + 1)
        if (after < DEC_ROAR) Object.assign(act, { action: 'idle', t: time / (LOOP_S.idle ?? 3.4) })
        else if (after < DEC_ROAR + 2000) Object.assign(act, { action: 'roar', t: (after - DEC_ROAR) / 2000, face: mixAngle(toOpp, face, smooth((after - DEC_ROAR) / 500)), charge: 0.3 })
        else Object.assign(act, { action: 'victory', t: (after - DEC_ROAR - 2000) / 1000 / (LOOP_S.victory ?? 1.8), face })
      } else Object.assign(act, { action: 'idle', t: time / (LOOP_S.idle ?? 3.4) * 0.8 })
      act.ev = null
      return act
    }
    // a knockout or a Splash: the last beats (down, sink, victory) carry on
  }

  // the celebration's own roars, over the script's victory
  if (e.action === 'victory') {
    for (const t of cheersOf(f))
      if (sh.st >= t && sh.st < t + 2000) {
        Object.assign(act, { action: 'roar', t: (sh.st - t) / 2000, charge: 0.3, face: angle(Math.sin(toOpp) * 0.35, Math.cos(toOpp) * 0.35 + 1) })
        return act
      }
    act.face = mixAngle(toOpp, angle(Math.sin(toOpp) * 0.35, Math.cos(toOpp) * 0.35 + 1), smooth((sh.st - e.t) / 800))
  }

  // looping actions count cycles: walks by the ground covered, the rest by time
  const loopS = LOOP_S[e.action]
  if (loopS) {
    if (e.action === 'idle') act.t = time / loopS + (s === 'b' ? 0.37 : 0)
    else if ((e.action === 'walk' || e.action === 'circle') && e.to) {
      const from = posAt(f, s, e.t)
      const moved = Math.hypot(pos.x - from.x, pos.z - from.z)
      const stride = h * (e.action === 'walk' ? 0.85 : 0.6)
      // walking backwards (away from where it faces): the cycle runs the other way
      const mx = e.to.x - from.x
      const mz = e.to.z - from.z
      const len = Math.hypot(mx, mz)
      let face = toOpp
      let back = false
      if (e.action === 'walk' && len > 2.5) {
        const dot = (mx * Math.sin(toOpp) + mz * Math.cos(toOpp)) / len
        if (dot < -0.25) {
          if (len > 6) face = angle(mx, mz)
          else back = true
        }
      }
      act.face = face
      act.t = (moved / stride) * (back ? -1 : 1) + 0.15
    } else act.t = (sh.st - e.t) / 1000 / loopS
  }

  // facing: a building it smashes; the way it fell while it is down or flying
  if (e.action === 'stomp' && e.building !== undefined) {
    const b = BUILDINGS[e.building]
    act.face = angle(b.x - pos.x, b.z - pos.z)
  } else if (LYING.has(e.action)) {
    const list = beatsOf(f, s)
    let i = list.indexOf(e)
    while (i > 0 && LYING.has(list[i - 1].action) && list[i - 1].t + list[i - 1].dur >= list[i].t - 5) i--
    act.face = faceAt(f, s, list[i].t)
  }

  // a kaiju thrown into the bay comes down to the water and floats there
  if (e.action === 'thrown' && e.to && e.to.z < SHORE_Z) act.y = WATER_Y * smooth((p - 0.55) / 0.45)
  if (e.action === 'sink') act.y = WATER_Y
  if (e.action === 'thrown') act.air = 4 * 6.5 * (h / 11) * p * (1 - p)

  // reactions start on the frame the blow lands: in at once, with a white flash
  if (REACT.has(e.action)) {
    act.blend = 0.07
    if (e.action !== 'dodge') act.flash = Math.max(0, 1 - (st - e.t) / 120) * (e.action === 'block' ? 0.35 : e.action === 'knockdown' ? 0.7 : 0.85)
  }
  if (e.action === 'thrown') {
    act.blend = 0.05
    act.flash = Math.max(0, 1 - (st - e.t - e.dur) / 170)
    if (st < e.t + e.dur) act.flash = 0
  }
  // the special's glow charges up to the moment it fires
  if (e.action === 'beam') act.charge = p < 0.5 ? smooth((p - 0.1) / 0.4) : p < 0.86 ? 1 : 1 - smooth((p - 0.86) / 0.14)

  // a strike leans in or holds back so it meets its target (a pure offset along the line to the other)
  if (LUNGE.has(e.action) && e.outcome) {
    const imp = IMPACT[e.action] ?? 0.5
    const d = Math.hypot(opp.x - pos.x, opp.z - pos.z)
    const want = d - cast.girth[other(s)] * 0.8
    const reach = cast.reach[s] * (e.action === 'grab' ? 0.85 : 1)
    const sft = clamp(want - reach, -3.5, 2.8)
    const env = p < imp ? smooth(p / imp) : p < imp + 0.18 ? 1 : 1 - smooth((p - imp - 0.18) / Math.max(0.05, 1 - imp - 0.18))
    const k = (sft * env) / (d || 1)
    act.x += (opp.x - pos.x) * k
    act.z += (opp.z - pos.z) * k
  }
  return act
}
