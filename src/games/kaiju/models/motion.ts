import type { Action } from '../types'
import { IMPACT } from '../fight'

/*
  How the kaiju move, as numbers. A pose is a set of channels (`Mo`): where the whole body is and how it is turned,
  how far it crouches and leans and twists, where the head looks and how wide the jaw opens, each arm's raise, spread,
  bend and stretch, each leg's step and lift, the tail's curve, the wings, the tentacles' curl, how bright the glow
  is. Every kaiju's rig maps the same channels onto its own joints (models/*.ts `apply`): an arm is an arm on Rexor,
  a striking tentacle on Kraka, a claw on Pincer, a fin on Voltra; the legs are legs, tentacles or coils. So one set
  of clips (here) moves all eight, and each kaiju overrides the few actions that are its own (Rexor's breath,
  Gorrath's ground pound, Pincer's shell spin ...). Pure maths, no three.js: the stage and the fight script can import
  the timings below without the 3D bundle.

  A clip is mostly keyframes (`keyed`): poses at moments of the action, eased between, each one the kaiju's guard
  with a few channels changed; the walk cycle, the flight of a thrown kaiju and the loops add a little motion in code.
  Channel units: offsets in world units (scaled by the kaiju's size), angles in radians. Arms: up 0 hangs at the side,
  about 1.57 points forward, about 3.1 straight up; out spreads it sideways; bend is the elbow; ext stretches the
  forearm for a punch (0 to 1). Legs: step swings the foot forward (in leg lengths), lift raises it. Positive lean
  leans forward, positive nod looks down, positive twist turns the chest to the kaiju's left (+x).
*/

export const CH = [
  'x', 'y', 'z', 'pitch', 'roll', 'yaw', 'squash',
  'crouch', 'lean', 'twist', 'bend', 'breath',
  'nod', 'look', 'jaw', 'shake',
  'lUp', 'lOut', 'lBend', 'lTwist', 'lExt',
  'rUp', 'rOut', 'rBend', 'rTwist', 'rExt', 'grip',
  'lStep', 'lLift', 'rStep', 'rLift', 'spread',
  'tSide', 'tLift', 'tWave', 'sway',
  'wing', 'flap', 'curl', 'glow',
] as const
export type Ch = (typeof CH)[number]
export type Mo = Record<Ch, number>
/** sets the channels for an action at progress t (0 to 1; loops get the fraction), `time` the scene clock in seconds */
export type Clip = (m: Mo, t: number, time?: number) => void

/** the resting pose: everything at rest, breathing and swaying */
const REST: Mo = Object.fromEntries(CH.map((c) => [c, c === 'breath' || c === 'sway' ? 1 : 0])) as Mo
export const blank = (): Mo => ({ ...REST })
export const set = (m: Mo, p: Partial<Mo>) => {
  for (const c of CH) m[c] = REST[c]
  Object.assign(m, p)
  return m
}

/** the actions that loop (t counts cycles) */
export const LOOPS: ReadonlySet<Action> = new Set<Action>(['idle', 'walk', 'circle', 'down', 'sink', 'victory'])

/** seconds per cycle of each looping action, so the stage can turn seconds into t (t = seconds / LOOP_S) */
export const LOOP_S: Partial<Record<Action, number>> = { idle: 3.4, walk: 1.5, circle: 1.4, down: 2.8, sink: 1.6, victory: 1.8 }

/*
  When a blow lands. The fight script decides where in a strike the blow connects (fight.ts IMPACT: the defender's
  reaction starts there); the clips below were keyed with their own contact moments (POSE_IMPACT). pose() re-times a
  strike so the two meet: the stage passes the event's plain progress and the fist, claw, jaws or beam arrive exactly
  when the script says. IMPACT is re-exported here for the stage's effects; knockdown and thrown, which the script
  doesn't time, keep their own (the body hits the ground at 0.66, the water at 1).
*/
export { IMPACT }
/** the contact moment inside each clip as keyed: a strike connects, a grab closes, a throw lets go, a stomp lands, a
 *  breath or beam starts to fire (it keeps firing to about 0.86 of the clip) */
export const POSE_IMPACT: Partial<Record<Action, number>> = { jab: 0.42, heavy: 0.55, tail: 0.5, charge: 0.78, grab: 0.5, throw: 0.55, stomp: 0.52, beam: 0.38, knockdown: 0.66, thrown: 1 }

/** how long each one-shot action looks best, in seconds (they stretch to any length) */
export const NATURAL_S: Partial<Record<Action, number>> = {
  roar: 2.2, taunt: 1.6, jab: 0.6, heavy: 1.2, tail: 1.2, charge: 1.3, grab: 0.9, throw: 1.1, beam: 2.2, stomp: 1.0,
  block: 0.7, dodge: 0.6, hit: 0.5, stagger: 1.1, knockdown: 1.5, getup: 1.6, thrown: 1.3,
}

/**
 * Re-times a strike so its contact lands at `land` (a fraction of the event): the t to key the clip with, so the clip's
 * own contact moment (POSE_IMPACT) falls exactly there. pose() does this with the script's IMPACT on its own; this is
 * for a stage that times a blow some other way.
 */
export function strikeT(action: Action, t: number, land = IMPACT[action] ?? -1) {
  const k = POSE_IMPACT[action]
  if (k === undefined || land <= 0 || land >= 1) return t
  return t < land ? (t / land) * k : k + ((t - land) / (1 - land)) * (1 - k)
}

/* ------------------------------------------------------------------ */
/*  Easing and keyframes                                                */
/* ------------------------------------------------------------------ */

export type Ease = (u: number) => number
export const E = {
  lin: (u: number) => u,
  io: (u: number) => u * u * (3 - 2 * u),
  in: (u: number) => u * u,
  in3: (u: number) => u * u * u,
  out: (u: number) => 1 - (1 - u) * (1 - u),
  out3: (u: number) => 1 - (1 - u) * (1 - u) * (1 - u),
  /** overshoots a little and settles: a snappy recovery */
  back: (u: number) => 1 + 2.2 * (u - 1) ** 3 + 1.2 * (u - 1) ** 2,
} satisfies Record<string, Ease>

/** a key: the moment, the pose there (the base with these channels changed), the easing of the move into it */
export type Key = [number, Partial<Mo>, Ease?]

/** a clip from keyframes over a base pose; `rel` is added to the channels a key sets itself (so clips written for an
 *  upright guard keep a hunched kaiju hunched) */
export function keyed(base: Partial<Mo>, list: Key[], rel?: Partial<Mo>) {
  const full = list.map(([t, p, e]) => {
    const m = { ...REST, ...base, ...p } as Mo
    if (rel) for (const c of Object.keys(rel) as Ch[]) if (c in p) m[c] += rel[c] ?? 0
    return { t, m, e: e ?? E.io }
  })
  return (m: Mo, t: number) => {
    let i = 0
    while (i < full.length - 2 && t > full[i + 1].t) i++
    const a = full[i]
    const b = full[Math.min(i + 1, full.length - 1)]
    const u = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 1
    const e = b.e(u)
    for (const c of CH) m[c] = a.m[c] + (b.m[c] - a.m[c]) * e
    return m
  }
}

/* ------------------------------------------------------------------ */
/*  The shared clips                                                    */
/* ------------------------------------------------------------------ */

/** what a kaiju is like to animate */
export interface Style {
  /** its height over 11: offsets scale with it */
  size: number
  /** 0 nimble to 1 ponderous: deeper crouches, bigger squash */
  mass: number
  /** the arm that jabs (strikers[0]); the other throws the heavies (strikers[1]) */
  lead: 'l' | 'r'
  /** its fighting stance */
  guard: Partial<Mo>
  /** how high its root sits when it lies on its back */
  lieH: number
  /** where its root floats in the bay (below the surface) */
  sinkY: number
  /** the height of its middle (what it tumbles about when thrown); about half its height */
  mid?: number
}

export const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2
const sin = Math.sin
const cos = Math.cos
const pos = (x: number) => Math.max(0, x)

/** one arm's channels */
export const arm = (side: 'l' | 'r', up: number, out: number, bend: number, ext = 0, twist = 0): Partial<Mo> =>
  side === 'l' ? { lUp: up, lOut: out, lBend: bend, lExt: ext, lTwist: twist } : { rUp: up, rOut: out, rBend: bend, rExt: ext, rTwist: twist }
/** both arms alike */
export const both = (up: number, out: number, bend: number, ext = 0): Partial<Mo> => ({ ...arm('l', up, out, bend, ext), ...arm('r', up, out, bend, ext) })

/** lying on its back after a knockdown (the first frame of 'down') */
export const downPose = (s: Style): Partial<Mo> => ({
  pitch: -HALF_PI, y: s.lieH, nod: 0.3, jaw: 0.35, ...both(1.45, 1.15, 0.5), lStep: 0.55, rStep: 0.32, lLift: 0.25, rLift: 0.1,
  glow: -0.6, tSide: 1.1, tLift: 0.2, breath: 0.45, sway: 0.15, wing: 0.9, curl: 0.5,
})

/** holding what it grabbed (the end of 'grab', the start of 'throw') */
export const holdPose = (s: Style): Partial<Mo> => ({ ...both(1.25, -0.12, 1.05), grip: 1, lean: 0.1, crouch: (s.guard.crouch ?? 0) + 0.15, jaw: 0.3 })

/** a big backhand sweep with the rear arm, for the kaiju with no tail to whip ('tail'): the chest winds one way with the
 *  arm across it, then unwinds with the arm flung out flat, landing at 0.5 */
export function sweepClip(s: Style): Clip {
  const g = s.guard
  const c = g.crouch ?? 0
  const R = s.lead === 'l' ? 'r' : 'l'
  const sg = s.lead === 'l' ? 1 : -1
  return keyed(g, [
    [0, {}],
    [0.3, { twist: 0.75 * sg, ...arm(R, 1.5, -0.75, 1.5), lean: (g.lean ?? 0) + 0.05, crouch: c + 0.2, nod: (g.nod ?? 0) + 0.05, look: 0.2 * sg }],
    [0.5, { twist: -0.8 * sg, ...arm(R, 1.45, 0.95, 0.1, 1), lean: (g.lean ?? 0) + 0.18, z: 0.45 * s.size, crouch: c + 0.26, jaw: 0.7, squash: -0.03 }, E.in],
    [0.68, { twist: -1.05 * sg, ...arm(R, 1.2, 1.3, 0.25, 0.4), lean: (g.lean ?? 0) + 0.15, z: 0.35 * s.size, crouch: c + 0.24, jaw: 0.4 }, E.out],
    [1, {}],
  ])
}

/** the clips every kaiju starts from */
export function clipsFor(s: Style): Record<Action, Clip> {
  const g = s.guard
  const S = s.size
  const c = g.crouch ?? 0
  const L = s.lead
  const R = L === 'l' ? 'r' : 'l'
  // twisting the chest this way brings the lead shoulder back
  const sg = L === 'l' ? 1 : -1
  const gUp = (side: 'l' | 'r') => (side === 'l' ? g.lUp : g.rUp) ?? 0
  const hold = holdPose(s)
  const down0 = downPose(s)
  // the clips are written for an upright guard (lean 0.12, nod -0.04): a kaiju that stands hunched keeps its hunch
  const rel: Partial<Mo> = { lean: (g.lean ?? 0.12) - 0.12, nod: (g.nod ?? -0.04) + 0.04 }

  const idle: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.x += 0.12 * S * sin(p)
    m.bend += 0.035 * sin(p)
    m.crouch += 0.03 * sin(2 * p)
    m.look += 0.07 * sin(p + 1.3)
    m.nod += 0.03 * sin(2 * p + 0.5)
    m.lUp += 0.06 * sin(p + 0.3)
    m.rUp += 0.06 * sin(p + 2.1)
    m.tSide += 0.1 * sin(p)
  }

  const walk: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.lStep = 0.42 * sin(p)
    m.rStep = -m.lStep
    m.lLift = 0.3 * pos(cos(p))
    m.rLift = 0.3 * pos(-cos(p))
    m.y = 0.1 * S * cos(2 * p) - 0.04 * S
    m.twist += -0.14 * sin(p)
    m.bend += 0.07 * sin(p)
    m.lUp = gUp('l') - 0.3 * sin(p)
    m.rUp = gUp('r') + 0.3 * sin(p)
    m.tSide += 0.2 * sin(p)
    m.squash = 0.04 * s.mass * pos(-cos(2 * p)) ** 3
    m.nod += 0.04 * cos(2 * p)
  }

  const circle: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.spread = 0.12 + 0.12 * sin(p)
    m.lLift = 0.26 * pos(sin(p))
    m.rLift = 0.26 * pos(-sin(p))
    m.lStep = 0.1 * cos(p)
    m.rStep = -0.1 * cos(p)
    m.y = -0.06 * S * Math.abs(sin(p))
    m.bend += 0.06 * sin(p)
    m.lUp += 0.12
    m.rUp += 0.12
    m.look += 0.05 * sin(p)
    m.tSide += 0.15 * cos(p)
  }

  const roar = keyed(g, [
    [0, {}],
    [0.16, { lean: -0.38, nod: -0.55, jaw: 0.25, crouch: c + 0.1, ...both(0.55, 0.65, 1.2), y: 0.05 * S, squash: -0.04, glow: 0.35, tLift: 0.3 }],
    [0.3, { lean: 0.28, nod: -0.25, jaw: 1, crouch: c + 0.2, ...both(0.95, 0.95, 0.55), squash: 0.05, shake: 1, glow: 0.5, tLift: 0.45, tWave: 0.6, curl: 0.5, wing: 1.3 }, E.out],
    [0.8, { lean: 0.32, nod: -0.2, jaw: 1, crouch: c + 0.22, ...both(1.0, 1.05, 0.5), shake: 1, glow: 0.6, tLift: 0.45, tWave: 0.6, curl: 0.5, wing: 1.3 }, E.lin],
    [1, {}],
  ], rel)

  const taunt = keyed(g, [
    [0, {}],
    [0.15, { lean: -0.18, nod: -0.25, ...arm(L, 1.4, 0.5, 0.4), ...arm(R, 0.4, 0.25, 0.9), jaw: 0.35, twist: 0.15 * sg }],
    [0.3, { lean: -0.18, nod: -0.2, ...arm(L, 1.45, 0.5, 1.9), ...arm(R, 0.4, 0.25, 0.9), jaw: 0.35, twist: 0.15 * sg }],
    [0.45, { lean: -0.18, nod: -0.25, ...arm(L, 1.4, 0.5, 0.4), ...arm(R, 0.4, 0.25, 0.9), jaw: 0.4, twist: 0.15 * sg }],
    [0.6, { lean: -0.18, nod: -0.2, ...arm(L, 1.45, 0.5, 1.9), ...arm(R, 0.4, 0.25, 0.9), jaw: 0.4, twist: 0.15 * sg }],
    [0.78, { lean: -0.06, nod: 0.18, ...arm(L, 1.2, 0.5, 0.7), jaw: 0.7, glow: 0.3 }],
    [1, {}],
  ], rel)

  const jab = keyed(g, [
    [0, {}],
    [0.26, { twist: 0.22 * sg, ...arm(L, 0.85, 0.12, 1.75), lean: (g.lean ?? 0) - 0.04, crouch: c + 0.1, nod: 0.05 }],
    [0.42, { twist: -0.42 * sg, ...arm(L, 1.55, 0.02, 0.05, 1), lean: 0.26, z: 0.7 * S, crouch: c + 0.12, jaw: 0.55, squash: -0.03, ...(L === 'l' ? { lStep: 0.12 } : { rStep: 0.12 }) }, E.in],
    [0.56, { twist: -0.36 * sg, ...arm(L, 1.5, 0.05, 0.25, 0.6), lean: 0.22, z: 0.6 * S, crouch: c + 0.1, jaw: 0.4 }, E.out],
    [1, {}],
  ], rel)

  const heavy = keyed(g, [
    [0, {}],
    [0.36, { twist: -0.6 * sg, ...arm(R, 2.5, 0.35, 1.5), ...arm(L, 0.9, 0.3, 1.3), lean: -0.28, crouch: c + 0.18, nod: -0.12, y: 0.12 * S, squash: -0.06 * (1 + s.mass), glow: 0.2, tLift: 0.3, jaw: 0.3 }],
    [0.55, { twist: 0.6 * sg, ...arm(R, 1.15, 0.05, 0.12, 1), ...arm(L, 0.5, 0.4, 1.4), lean: 0.5, crouch: c + 0.32, z: 1.1 * S, squash: 0.1 + 0.06 * s.mass, jaw: 0.9, nod: 0.12, shake: 0.6, tLift: -0.1 }, E.in],
    [0.72, { twist: 0.72 * sg, ...arm(R, 0.6, 0.15, 0.3, 0.4), ...arm(L, 0.5, 0.4, 1.4), lean: 0.52, crouch: c + 0.36, z: 1.0 * S, squash: 0.04, jaw: 0.6 }, E.out],
    [1, {}],
  ], rel)

  // a spin: the tail sweeps through the front at the half-way point, when the back is turned to the foe
  const tail = keyed(g, [
    [0, {}],
    [0.2, { yaw: -0.55 * sg, crouch: c + 0.18, lean: 0.12, tSide: 0.55 * sg, ...both(0.6, 0.3, 1.6) }],
    [0.5, { yaw: Math.PI * sg, crouch: c + 0.28, lean: 0.2, tSide: -0.5 * sg, tLift: 0.4, tWave: 0.3, ...both(0.5, 0.7, 1.2), squash: -0.02 }, E.in],
    [0.74, { yaw: 1.75 * Math.PI * sg, crouch: c + 0.22, lean: 0.15, tSide: -0.25 * sg, tLift: 0.2 }, E.out],
    [1, { yaw: TAU * sg }],
  ], rel)

  const chargeK = keyed(g, [
    [0, {}],
    [0.2, { crouch: c + 0.35, lean: 0.5, nod: -0.25, ...both(0.2, 0.35, 1.2), squash: 0.06, tLift: 0.25 }],
    [0.72, { crouch: c + 0.28, lean: 0.62, nod: -0.25, twist: 0.3 * sg, ...arm(R, 0.6, 0.5, 1.4), ...arm(L, 0.3, 0.2, 1.2), tLift: 0.3 }, E.lin],
    [0.78, { crouch: c + 0.35, lean: 0.72, nod: -0.1, twist: 0.42 * sg, ...arm(R, 0.7, 0.6, 1.3), ...arm(L, 0.3, 0.2, 1.2), z: 0.9 * S, squash: 0.14, jaw: 0.8, shake: 1, tLift: 0.3 }, E.in],
    [1, {}],
  ], rel)
  const charge: Clip = (m, t) => {
    chargeK(m, t)
    // running in: a quick heavy-footed cycle under the lean
    const run = Math.min(1, Math.max(0, (t - 0.2) / 0.05)) * Math.min(1, Math.max(0, (0.76 - t) / 0.05))
    if (run > 0) {
      const p = (t - 0.2) * TAU * 4.5
      m.lStep += run * 0.5 * sin(p)
      m.rStep -= run * 0.5 * sin(p)
      m.lLift += run * 0.35 * pos(cos(p))
      m.rLift += run * 0.35 * pos(-cos(p))
      m.y += run * 0.12 * S * Math.abs(cos(p))
      m.bend += run * 0.06 * sin(p)
      m.lUp -= run * 0.35 * sin(p)
      m.rUp += run * 0.35 * sin(p)
    }
  }

  const grab = keyed(g, [
    [0, {}],
    [0.32, { ...both(1.55, 0.55, 0.15, 0.6), lean: 0.38, z: 0.6 * S, jaw: 0.75, crouch: c + 0.12, nod: -0.05, curl: -0.3 }],
    [0.5, { ...both(1.35, -0.18, 1.0), grip: 1, lean: 0.25, z: 0.45 * S, jaw: 0.5, crouch: c + 0.2, curl: 0.8 }, E.in],
    [1, { ...hold, curl: 0.7 }],
  ], rel)

  const throwK = keyed(g, [
    [0, { ...hold, curl: 0.7 }],
    [0.34, { ...hold, twist: -0.75 * sg, ...both(1.55, 0.05, 0.75), lean: -0.28, crouch: c + 0.38, nod: -0.22, jaw: 0.5, curl: 0.7 }],
    [0.55, { twist: 0.85 * sg, ...both(2.35, 0.45, 0.15, 0.6), lean: 0.42, crouch: c + 0.18, y: 0.15 * S, jaw: 1, squash: -0.05, nod: -0.1, curl: -0.4 }, E.in],
    [0.75, { twist: 0.6 * sg, ...both(1.3, 0.4, 0.4), lean: 0.48, crouch: c + 0.25, jaw: 0.7 }, E.out],
    [1, {}],
  ], rel)

  const beam = keyed(g, [
    [0, {}],
    [0.3, { lean: -0.3, nod: -0.4, crouch: c + 0.28, jaw: 0.2, ...both(0.25, 0.65, 0.9), glow: 1, tLift: 0.55, tWave: 0.3, shake: 0.35, squash: -0.03, wing: 1.4 }],
    [0.38, { lean: 0.28, nod: 0.02, crouch: c + 0.34, jaw: 1, ...both(0.35, 0.75, 0.7), z: 0.35 * S, glow: 1, shake: 0.7, squash: 0.03, tLift: 0.2, wing: 1.4 }, E.out],
    [0.86, { lean: 0.22, nod: 0.06, crouch: c + 0.34, jaw: 1, ...both(0.35, 0.75, 0.7), z: 0.15 * S, glow: 1, shake: 0.8, tLift: 0.2, wing: 1.4 }, E.lin],
    [1, {}],
  ], rel)

  const stomp = keyed(g, [
    [0, {}],
    [0.34, { rLift: 0.95, rStep: 0.4, lean: -0.22, bend: 0.14, ...both(1.9, 0.55, 0.7), crouch: 0.05, y: 0.15 * S, jaw: 0.5, nod: -0.25, tLift: 0.3 }],
    [0.52, { rLift: 0, rStep: 0.42, lean: 0.38, bend: -0.05, ...both(0.4, 0.5, 0.8), crouch: c + 0.45, squash: 0.16, jaw: 1, shake: 1, nod: 0.25, tLift: -0.2 }, E.in],
    [0.72, { rStep: 0.4, lean: 0.3, crouch: c + 0.4, ...both(0.5, 0.45, 0.9), jaw: 0.6, squash: 0.03 }, E.out],
    [1, {}],
  ], rel)

  const guardUp: Partial<Mo> = { ...both(1.75, -0.5, 1.85), crouch: c + 0.28, lean: 0.06, nod: 0.3, twist: 0.08, curl: 0.6, wing: 0.4 }
  const block = keyed(g, [
    [0, {}],
    [0.22, guardUp, E.out],
    [0.42, { ...guardUp, z: -0.35 * S, squash: 0.06 }, E.out],
    [0.75, guardUp],
    [1, {}],
  ], rel)

  const dodge = keyed(g, [
    [0, {}],
    [0.28, { x: 1.1 * S, z: -0.7 * S, lean: -0.32, bend: 0.38, crouch: c + 0.4, nod: 0.1, look: -0.35, ...both(0.9, 0.55, 1.3), squash: 0.04, wing: 1.1 }, E.out],
    [0.62, { x: 1.0 * S, z: -0.6 * S, lean: -0.25, bend: 0.3, crouch: c + 0.35, look: -0.25, ...both(0.85, 0.5, 1.3), wing: 0.9 }, E.lin],
    [1, {}],
  ], rel)

  const hit = keyed(g, [
    [0, {}],
    [0.14, { nod: -0.5, look: 0.35, lean: -0.38, twist: 0.3, z: -0.55 * S, ...both(0.35, 0.6, 0.7), jaw: 0.85, squash: 0.07, crouch: c + 0.15, shake: 0.4 }, E.out],
    [0.45, { nod: -0.2, look: 0.15, lean: -0.15, twist: 0.12, z: -0.35 * S, jaw: 0.4, crouch: c + 0.1 }],
    [1, {}],
  ], rel)

  const stagger = keyed(g, [
    [0, {}],
    [0.14, { lean: -0.48, nod: -0.45, z: -0.6 * S, ...arm('l', 1.1, 0.95, 0.5), ...arm('r', 0.6, 1.05, 0.4), jaw: 0.7, bend: 0.32, crouch: c + 0.25, rStep: -0.35, squash: 0.06, shake: 0.4 }, E.out],
    [0.42, { lean: -0.32, nod: 0.25, look: -0.35, z: -0.4 * S, bend: -0.3, lStep: -0.4, rLift: 0.2, ...arm('l', 0.5, 0.9, 0.6), ...arm('r', 1.1, 0.8, 0.5), jaw: 0.5, crouch: c + 0.3 }],
    [0.7, { lean: -0.12, nod: 0.15, look: 0.2, bend: 0.18, z: -0.15 * S, jaw: 0.3 }],
    [1, {}],
  ], rel)

  const knockdown = keyed(g, [
    [0, {}],
    [0.12, { lean: -0.55, nod: -0.6, jaw: 1, z: -0.35 * S, ...both(1.6, 0.9, 0.5), crouch: c + 0.2, squash: 0.05, shake: 0.6 }, E.out],
    [0.5, { pitch: -1.15, lean: -0.15, nod: -0.3, jaw: 0.8, ...both(2.4, 0.8, 0.4), lStep: 0.5, rStep: 0.3, lLift: 0.3, y: 0.2 * s.lieH, wing: 1.2, curl: -0.3 }, E.in],
    [0.66, { ...down0, nod: 0.35, jaw: 0.7, ...both(1.6, 1.25, 0.4), lStep: 0.9, rStep: 0.6, squash: 0.12, shake: 1, glow: 0, breath: 1 }, E.in],
    [0.8, { ...down0, y: s.lieH + 0.45 * S, nod: 0.1, ...both(1.9, 1.1, 0.6), lStep: 0.75, rStep: 0.55, squash: -0.04, glow: -0.3 }, E.out],
    [0.92, { ...down0, squash: 0.04 }, E.in],
    [1, down0],
  ])

  const down: Clip = (m, t) => {
    set(m, { ...g, ...down0 })
    const p = t * TAU
    m.jaw += 0.12 * sin(p)
    m.lBend += 0.3 * pos(sin(2 * p)) ** 6
    m.nod += 0.06 * sin(p)
    m.lStep += 0.05 * sin(p + 1)
    m.look = 0.12 * sin(p * 0.5)
  }

  const getup = keyed(g, [
    [0, down0],
    [0.28, { pitch: -1.2, roll: 0.7, y: 0.8 * s.lieH, ...arm('l', 0.4, 0.6, 1.4), ...arm('r', 1.8, 0.6, 0.8), lStep: 0.45, rStep: 0.2, crouch: 0.3, nod: 0.25, jaw: 0.3, tSide: 0.8, glow: -0.4 }],
    [0.55, { pitch: -0.35, roll: 0.25, crouch: 0.85, lean: 0.75, ...both(0.6, 0.3, 0.3), nod: -0.2, jaw: 0.4, tSide: 0.3, glow: -0.2 }],
    [0.78, { crouch: c + 0.15, lean: 0.12, nod: 0.1, look: 0.35, shake: 0.4 }],
    [0.88, { look: -0.35, nod: 0.05, shake: 0.4 }],
    [1, {}],
  ])

  const thrown: Clip = (m, t) => {
    set(m, g)
    const H = 6.5 * S
    // the root is at the feet: shift it so the tumble turns about the middle, not the feet
    const mid = s.mid ?? 4.5 * S
    const a = -t * 1.25 * Math.PI
    m.pitch = a
    m.y = 4 * H * t * (1 - t) - 1.5 * S * t * t + mid * (1 - cos(a))
    m.z = -mid * sin(a)
    const f = t * TAU
    m.lUp = 2.2 + 0.6 * sin(f * 3)
    m.rUp = 2.0 - 0.6 * sin(f * 3 + 1)
    m.lOut = 0.9
    m.rOut = 0.9
    m.lBend = 0.5 + 0.3 * sin(f * 3)
    m.rBend = 0.5 - 0.3 * sin(f * 3)
    m.lStep = 0.5 * sin(f * 2.5)
    m.rStep = -m.lStep
    m.lLift = 0.4
    m.rLift = 0.4
    m.jaw = 0.9
    m.nod = -0.4
    m.tWave = 1
    m.tLift = 0.4
    m.curl = 0.6
    m.wing = 1.4
    m.flap = 1
    m.shake = 0.3
  }

  const sink: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.y = s.sinkY + 0.18 * S * sin(p)
    m.pitch = -0.25
    m.roll = 0.1 * sin(p + 0.7)
    m.lUp = 2.3 + 0.5 * sin(2 * p)
    m.rUp = 2.3 - 0.5 * sin(2 * p)
    m.lOut = 0.7
    m.rOut = 0.7
    m.lBend = 0.6 + 0.3 * sin(2 * p)
    m.rBend = 0.6 - 0.3 * sin(2 * p)
    m.nod = -0.45
    m.jaw = 0.5 + 0.4 * sin(2 * p + 1)
    m.shake = 0.25
    m.crouch = 0.3
    m.lean = -0.2
    m.lStep = 0.4 * sin(2 * p)
    m.rStep = -m.lStep
    m.glow = -0.3
    m.tWave = 0.8
    m.curl = 0.5
    m.wing = 0.6
    m.flap = 0.8
  }

  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.lUp = 2.75 + 0.25 * sin(2 * p)
    m.rUp = 2.75 - 0.25 * sin(2 * p)
    m.lOut = 0.45
    m.rOut = 0.45
    m.lBend = 0.55 + 0.25 * sin(2 * p)
    m.rBend = 0.55 - 0.25 * sin(2 * p)
    m.lean = -0.25
    m.nod = -0.45 + 0.1 * sin(2 * p)
    m.jaw = 0.55 + 0.45 * pos(sin(p))
    m.crouch = 0.12 + 0.1 * pos(sin(2 * p))
    m.y = 0.25 * S * pos(sin(2 * p))
    m.glow = 0.3 + 0.3 * pos(sin(p))
    m.tWave = 0.5
    m.tLift = 0.4
    m.shake = 0.5 * pos(sin(p))
    m.wing = 1.2
    m.flap = 0.6
  }

  return { idle, walk, circle, roar, taunt, jab, heavy, tail, charge, grab, throw: throwK, beam, stomp, block, dodge, hit, stagger, knockdown, down, getup, thrown, sink, victory }
}
