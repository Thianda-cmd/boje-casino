import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { E, both, clipsFor, keyed, set, sweepClip, type Clip, type Key, type Mo, type Style } from './motion'
import { COLORS } from './palette'
import { Body, T, TAU, makeRig, oval, sphere, type Quality } from './rig'
import type { Ell } from '../../../lib/three/toon'

/*
  Pincer, the Living Fortress: a giant crab. A wide armoured carapace with a ring of spikes round its rim and a few
  on top, a pale underside, two eyes on stalks with glowing orange tips, mandibles over a glowing mouth, six pointed
  walking legs (three a side) and two great claws, the right one a good deal bigger (the crusher). Glowing orange
  seams run inside the claws.

  Its own skeleton: the body (carapace) on the root; each claw an arm of shoulder → elbow → claw → movable finger;
  each leg a root → knee pair solved as two-bone IK so the tips stay on the ground as the body rises and falls. The
  channels map like this: the arms are the claws (up 1.2 points a claw straight ahead, more raises it; bend folds it
  inward; grip closes the finger), the legs walk in two alternating tripods (lStep/lLift drive one, rStep/rLift the
  other), the head channels move the eye stalks and the jaw the mandibles. Its special is the Shell Spin: claws
  tucked, it spins like a top. Knocked down, it flips onto its back with its legs in the air.
*/

const C = COLORS.pincer
const SHELL = C.body
const UNDER = C.accent
const DARK = C.dark
const TIP = C.extra

/** the legs: where each meets the shell (z), and its fan angle for the left side */
const LEGS = [
  { z: 1.05, fan: -0.6 },
  { z: -0.05, fan: -0.05 },
  { z: -1.15, fan: 0.55 },
]
const FEMUR: [number, number] = [2.5, 1.45]
const TIBIA: [number, number] = [2.3, -4.0]
const BODY_Y = 2.75
const BASE_Y = -0.15

export function buildPincer(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.1, q)
  const body = b.joint('body', null, 0, BODY_Y, 0)

  /* ---- the carapace ---- */
  const shell: Ell = { c: [0, 0.3, 0], r: [3.0, 1.35, 2.45] }
  b.ell(body, shell.c, shell.r, SHELL, [0, 0, 0], undefined, [28, 16])
  b.ell(body, [0, -0.35, 0.05], [2.75, 0.8, 2.2], UNDER)
  // a lighter crown on top and dark speckles
  b.ell(body, [0, 0.95, -0.15], [2.0, 0.75, 1.6], '#e05a3e', [0, 0, 0], { ink: 0 })
  for (const [x, z, r] of [[1.2, 0.6, 0.22], [-1.0, 0.9, 0.18], [0.4, -0.9, 0.24], [-1.4, -0.5, 0.2], [1.7, -0.8, 0.16]] as const) b.ell(body, [x, 1.25 - Math.abs(x) * 0.18, z], [r, r * 0.5, r], DARK, [0, 0, 0], { ink: 0 })
  // the spiked rim
  const rim = q === 'low' ? 12 : 18
  for (let i = 0; i < rim; i++) {
    const a = (i / rim) * TAU
    const x = Math.sin(a) * 2.95
    const z = Math.cos(a) * 2.4
    if (Math.abs(a - Math.PI) < 0.5) continue
    const out = 0.65 + (i % 2) * 0.25
    b.spike(body, [x * 0.97, 0.25, z * 0.97], [x * (1 + out / 3), 0.4 + (i % 2) * 0.15, z * (1 + out / 2.4)], 0.26, DARK, { ink: 0.06 }, 0.2)
  }
  // spikes on the crown
  for (const [x, z, h] of [[0, 0.5, 0.9], [0.9, -0.2, 0.7], [-0.9, -0.2, 0.7], [0.5, -1.2, 0.6], [-0.5, -1.2, 0.6]] as const) b.spike(body, [x, 1.45 - Math.abs(x) * 0.15, z], [x * 1.15, 1.45 + h, z - 0.2], 0.28, DARK, { ink: 0.06 }, 0.2)
  // glowing gems set in the shell (they light first)
  for (const [x, z] of [[0.55, 1.2], [-0.55, 1.2], [0, -0.6]] as const) b.add(body, sphere(q, 10, 8), C.glow, T([x, 1.38, z], [0, 0, 0], [0.2, 0.1, 0.2]), { glow: 0.2 })
  // the face: mandibles over a glowing mouth
  const face: Ell = { c: [0, -0.1, 1.9], r: [1.2, 0.7, 0.6] }
  b.ell(body, face.c, face.r, UNDER)
  b.paint(body, face, oval(0, -0.1, 0.55, 0.16, 0, 16), C.glow, 0.02, { glow: 0.6 })
  const jaw = b.joint('jaw', body, 0, -0.15, 2.35)
  for (const s of [1, -1]) b.ell(jaw, [s * 0.3, 0, 0.1], [0.32, 0.2, 0.32], TIP, [0, s * 0.4, 0], { ink: 0.05 })

  /* ---- eye stalks with glowing tips ---- */
  const eyes = ([1, -1] as const).map((s) => {
    const e = b.joint(s > 0 ? 'eyeL' : 'eyeR', body, s * 0.6, 1.0, 1.8)
    b.cap(e, [0, 0, 0], [s * 0.15, 1.45, 0.15], 0.2, 0.17, SHELL)
    b.ell(e, [s * 0.15, 1.65, 0.12], [0.4, 0.42, 0.4], UNDER)
    b.add(e, sphere(q, 12, 8), C.glow, T([s * 0.17, 1.72, 0.42], [0, 0, 0], [0.3, 0.32, 0.12]), { glow: 1 })
    b.add(e, sphere(q, 8, 6), '#2a0d04', T([s * 0.18, 1.74, 0.53], [0, 0, 0], [0.09, 0.17, 0.03]), { flat: true, ink: 0 })
    return e
  })

  /* ---- the claws: shoulder → elbow → claw → finger; the right one is the crusher ---- */
  const arms = ([1, -1] as const).map((s) => {
    const k = s < 0 ? 1.75 : 1.3
    const sh = b.joint(s > 0 ? 'shL' : 'shR', body, s * 2.2, 0.05, 1.5)
    const el = b.joint('elbow', sh, s * 0.35, 0, 1.75)
    const wr = b.joint('claw', el, s * 0.1, 0, 1.35)
    const fin = b.joint('finger', wr, s * 0.1, 0.35 * k, 1.25 * k)
    b.ell(sh, [0, 0, 0], [0.55, 0.55, 0.55], SHELL)
    b.cap(sh, [0, 0, 0.1], [s * 0.35, 0, 1.75], 0.55 * k * 0.85, 0.48 * k * 0.85, SHELL)
    b.spike(sh, [s * 0.4, 0.3, 0.9], [s * 0.7, 0.75, 0.9], 0.18, DARK, { ink: 0.05 })
    b.ell(el, [0, 0, 0], [0.55 * k * 0.8, 0.55 * k * 0.8, 0.55 * k * 0.8], SHELL)
    b.cap(el, [0, 0, 0.1], [s * 0.1, 0, 1.3], 0.5 * k, 0.55 * k, SHELL)
    b.spike(el, [s * 0.45 * k, 0.25, 0.6], [s * 0.8 * k, 0.5, 0.75], 0.16, DARK, { ink: 0.05 })
    // the claw: a big swollen palm, the fixed finger below, spikes on top, a glowing seam inside
    const palm: Ell = { c: [s * 0.05, 0, 0.55 * k], r: [0.78 * k, 0.72 * k, 1.05 * k] }
    b.ell(wr, palm.c, palm.r, SHELL)
    b.ell(wr, [s * 0.05, -0.32 * k, 0.6 * k], [0.62 * k, 0.4 * k, 0.9 * k], UNDER, [0, 0, 0], { ink: 0 })
    b.spike(wr, [s * 0.05, -0.22 * k, 1.35 * k], [s * 0.05, -0.12 * k, 2.55 * k], 0.36 * k, SHELL, undefined, 0.15)
    b.spike(wr, [s * 0.05, -0.15 * k, 2.4 * k], [s * 0.05, 0.12 * k, 2.75 * k], 0.14 * k, TIP, { ink: 0.05 })
    for (const [y, z] of [[0.62, 0.2], [0.68, 0.7], [0.5, 1.15]] as const) b.spike(wr, [s * 0.1, y * k, z * k], [s * 0.15, (y + 0.35) * k, (z - 0.1) * k], 0.14 * k, DARK, { ink: 0.05 })
    b.paint(wr, { c: [s * 0.05, -0.05 * k, 0.6 * k], r: [0.8 * k, 0.6 * k, 1.07 * k] }, oval(s * 0.05, -0.05 * k, 0.12 * k, 0.5 * k, 0, 12), C.glow, 0.02, { glow: 0.45 })
    // the movable finger, on its hinge at the top of the claw
    b.ell(fin, [0, 0, 0], [0.3 * k, 0.28 * k, 0.3 * k], SHELL)
    b.spike(fin, [0, 0, 0.1 * k], [0, -0.25 * k, 1.45 * k], 0.3 * k, SHELL, undefined, 0.2)
    b.spike(fin, [0, -0.2 * k, 1.3 * k], [0, -0.42 * k, 1.65 * k], 0.12 * k, TIP, { ink: 0.05 })
    const tip = new THREE.Object3D()
    tip.position.set(s * 0.05, 0, 2.2 * k)
    wr.add(tip)
    return { sh, el, wr, fin, s, tip }
  })

  /* ---- six walking legs, fanned, each a root and a knee ---- */
  const legs = ([1, -1] as const).flatMap((s) =>
    LEGS.map((L, i) => {
      const root = b.joint(`leg${s > 0 ? 'L' : 'R'}${i}`, body, s * 2.3, BASE_Y, L.z)
      const fan = L.fan * s
      root.rotation.set(0, fan, 0, 'YZX')
      const knee = b.joint('knee', root, s * FEMUR[0], FEMUR[1], 0)
      b.ell(root, [0, 0, 0], [0.38, 0.38, 0.38], SHELL)
      b.cap(root, [0, 0, 0], [s * FEMUR[0], FEMUR[1], 0], 0.5, 0.42, SHELL)
      b.spike(root, [s * FEMUR[0] * 0.55, FEMUR[1] * 0.55 + 0.35, 0], [s * FEMUR[0] * 0.62, FEMUR[1] * 0.62 + 0.85, -0.1], 0.14, DARK, { ink: 0.045 })
      b.ell(knee, [0, 0, 0], [0.44, 0.44, 0.44], DARK)
      b.cap(knee, [0, 0, 0], [s * TIBIA[0] * 0.72, TIBIA[1] * 0.72, 0], 0.4, 0.28, '#b83a25')
      b.spike(knee, [s * TIBIA[0] * 0.68, TIBIA[1] * 0.68, 0], [s * TIBIA[0], TIBIA[1], 0], 0.28, TIP, { ink: 0.05 })
      // A tripod: front and back on one side with the middle on the other
      const group = (i === 1) === s > 0 ? 'b' : 'a'
      return { root, knee, s, fan, group, i }
    }),
  )

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, 0.2, 2.6)
  body.add(mouth)
  const front = new THREE.Object3D()
  front.position.set(0, 0.3, 2.5)
  body.add(front)
  const strikers = [arms[0].tip, arms[1].tip, front]

  /* ---- how it moves ---- */
  const g = { crouch: 0.1, lean: 0.06, lUp: 1.95, lOut: 0.25, lBend: 1.0, rUp: 1.8, rOut: 0.3, rBend: 0.85, grip: 0.45, nod: 0 }
  const style: Style = { size: 1, mass: 0.75, lead: 'l', guard: g, lieH: 4.7, sinkY: -3.4, mid: 3.0 }
  const base = clipsFor(style)
  const c = g.crouch
  // the jab: the small claw snaps forward and shut
  const jab = keyed(g, [
    [0, {}],
    [0.26, { twist: 0.2, lUp: 1.6, lOut: 0.45, lBend: 1.5, grip: 0, crouch: c + 0.1 }],
    [0.42, { twist: -0.35, lUp: 1.35, lOut: 0.05, lBend: 0.05, lExt: 1, grip: 1, lean: 0.2, z: 0.8, crouch: c + 0.12, squash: -0.03 }, E.in],
    [0.58, { twist: -0.3, lUp: 1.4, lOut: 0.1, lBend: 0.3, lExt: 0.5, grip: 0.9, lean: 0.15, z: 0.6 }, E.out],
    [1, {}],
  ])
  // the heavy: the crusher raised high, open, and brought down shut
  const heavy = keyed(g, [
    [0, {}],
    [0.38, { twist: -0.45, rUp: 3.1, rOut: 0.35, rBend: 0.4, grip: 0, lean: -0.2, crouch: c + 0.05, y: 0.25, squash: -0.05, glow: 0.4 }],
    [0.55, { twist: 0.4, rUp: 0.95, rOut: 0.05, rBend: 0.1, rExt: 1, grip: 1, lean: 0.45, crouch: c + 0.35, z: 0.9, squash: 0.12, shake: 0.8 }, E.in],
    [0.72, { twist: 0.45, rUp: 0.85, rOut: 0.1, rBend: 0.2, rExt: 0.5, grip: 1, lean: 0.45, crouch: c + 0.35, z: 0.8, squash: 0.03 }, E.out],
    [1, {}],
  ])
  // the Shell Spin: claws tucked, three turns like a top
  const tuck = { ...both(1.25, -0.5, 2.2), grip: 1, crouch: c + 0.4 }
  const beamK = keyed(g, [
    [0, {}],
    [0.26, { ...tuck, yaw: -0.5, glow: 0.7, squash: 0.06 }],
    [0.38, { ...tuck, yaw: 0.9, glow: 1, z: 0.4 }, E.in],
    [0.86, { ...tuck, yaw: 3 * TAU - 0.4, glow: 1, z: 0.3 }, E.lin],
    [1, { yaw: 3 * TAU }, E.out],
  ])
  const beam: Clip = (m, t) => {
    beamK(m, t)
    if (t > 0.3 && t < 0.9) {
      m.roll = 0.12 * Math.sin(t * 40)
      m.y = 0.25 * Math.abs(Math.sin(t * 25))
    }
  }
  // the taunt: both claws up, snapping in turn
  const taunt = keyed(g, [
    [0, {}],
    ...[0.15, 0.27, 0.39, 0.51, 0.63, 0.75].map((t, i): Key => [t, { lUp: 2.6, rUp: 2.5, lOut: 0.5, rOut: 0.5, lBend: 0.5, rBend: 0.5, grip: i % 2, x: (i % 2 ? 0.3 : -0.3), bend: i % 2 ? 0.08 : -0.08, crouch: c + 0.05 }, E.in]),
    [1, {}],
  ])
  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.lUp = 2.8 + 0.2 * Math.sin(p * 2)
    m.rUp = 2.7 - 0.2 * Math.sin(p * 2)
    m.lOut = 0.6
    m.rOut = 0.6
    m.lBend = 0.4
    m.rBend = 0.4
    m.grip = Math.sin(p * 4) > 0 ? 1 : 0
    m.x = 0.6 * Math.sin(p)
    m.bend = 0.1 * Math.sin(p)
    m.lLift = 0.3 * Math.max(0, Math.sin(p * 2))
    m.rLift = 0.3 * Math.max(0, -Math.sin(p * 2))
    m.glow = 0.5 + 0.5 * Math.max(0, Math.sin(p * 2))
  }
  // knocked down it flips onto its back, legs in the air; it rocks and flips back over to get up
  const flipped: Partial<Mo> = { pitch: -Math.PI, y: style.lieH, ...both(1.6, 0.6, 0.6), grip: 0.2, glow: -0.6, breath: 0.4 }
  const knockdown = keyed(g, [
    [0, {}],
    [0.12, { lean: -0.4, z: -0.4, ...both(2.4, 0.7, 0.4), grip: 0, shake: 0.6 }, E.out],
    [0.45, { pitch: -1.7, y: 3.6, ...both(2.2, 0.8, 0.4), grip: 0, lStep: 0.4, rStep: -0.4 }, E.in],
    [0.66, { ...flipped, squash: 0.12, shake: 1, glow: 0 }, E.in],
    [0.8, { ...flipped, y: style.lieH + 0.6 }, E.out],
    [0.92, { ...flipped, squash: 0.04 }, E.in],
    [1, flipped],
  ])
  const down: Clip = (m, t) => {
    set(m, { ...g, ...flipped })
    const p = t * TAU
    m.lStep = 0.35 * Math.sin(p * 3)
    m.rStep = -0.35 * Math.sin(p * 3 + 0.5)
    m.lLift = 0.3 + 0.3 * Math.sin(p * 2)
    m.rLift = 0.3 - 0.3 * Math.sin(p * 2)
    m.grip = 0.5 + 0.5 * Math.sin(p * 2)
    m.roll = 0.08 * Math.sin(p)
  }
  const getup = keyed(g, [
    [0, flipped],
    [0.25, { ...flipped, roll: 0.35 }],
    [0.4, { ...flipped, roll: -0.35 }],
    [0.65, { pitch: -1.55 * Math.PI, y: 5.2, ...both(2.4, 0.6, 0.5), grip: 0 }, E.io],
    [0.82, { pitch: -TAU, y: 0, squash: 0.12, shake: 0.5 }, E.in],
    [1, { pitch: -TAU }],
  ])
  const stomp = keyed(g, [
    [0, {}],
    [0.35, { ...both(3.0, 0.35, 0.3), grip: 0, lean: -0.25, y: 0.3, squash: -0.05 }],
    [0.52, { ...both(0.8, 0.15, 0.1, 1), grip: 1, lean: 0.5, crouch: c + 0.4, squash: 0.14, shake: 1 }, E.in],
    [0.72, { ...both(0.85, 0.2, 0.2), grip: 1, lean: 0.45, crouch: c + 0.38 }, E.out],
    [1, {}],
  ])
  const clips = { ...base, jab, heavy, beam, taunt, victory, knockdown, down, getup, stomp, tail: sweepClip(style) }

  /* ---- the channels on the crab's joints ---- */
  const bodyRest = (body.userData.rest as THREE.Vector3).clone()
  const Lf = Math.hypot(FEMUR[0], FEMUR[1])
  const Lt = Math.hypot(TIBIA[0], TIBIA[1])
  const af0 = Math.atan2(FEMUR[1], FEMUR[0])
  const at0 = Math.atan2(TIBIA[1], TIBIA[0])
  const reach0 = FEMUR[0] + TIBIA[0]
  const finRest = arms.map((a) => (a.wr.userData.rest as THREE.Vector3).clone())
  const apply = (m: Mo, time: number) => {
    const r = b.root
    r.position.set(m.x + m.shake * 0.05 * Math.sin(time * 53), m.y, m.z)
    r.rotation.set(m.pitch, m.yaw, m.roll, 'YXZ')
    r.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6)
    const breathe = Math.sin(time * 1.5) * m.breath
    const drop = m.crouch * 1.3
    body.position.set(bodyRest.x, bodyRest.y - drop + breathe * 0.04, bodyRest.z)
    body.rotation.set(m.lean * 0.45, m.twist * 0.55, m.bend * 0.4)
    body.scale.set(1 + breathe * 0.012, 1 + breathe * 0.02, 1 + breathe * 0.012)
    jaw.rotation.set(0, 0, 0)
    jaw.scale.set(1 + m.jaw * 0.35 + 0.08 * Math.sin(time * 6) * m.breath, 1, 1)
    eyes.forEach((e, i) => {
      const s = i ? -1 : 1
      e.rotation.set(-m.nod * 0.6 + 0.08 * Math.sin(time * 1.9 + i * 2), m.look * 0.6 + 0.1 * Math.sin(time * 1.3 + i), s * (0.1 + 0.06 * Math.sin(time * 2.4 + i)) + m.shake * 0.2 * Math.sin(time * 37))
    })
    arms.forEach((a, i) => {
      const L = a.s > 0
      const up = (L ? m.lUp : m.rUp) - 1.2
      const out = L ? m.lOut : m.rOut
      const bend = L ? m.lBend : m.rBend
      const ext = L ? m.lExt : m.rExt
      const tw = L ? m.lTwist : m.rTwist
      a.sh.rotation.set(-up * 0.75, a.s * (out * 0.8 - 0.15), 0, 'YXZ')
      a.el.rotation.set(-up * 0.25, -a.s * bend * 0.75, 0, 'YXZ')
      const fr = finRest[i]
      a.wr.position.set(fr.x, fr.y, fr.z + Math.max(0, ext) * 0.7)
      a.wr.rotation.set(0.15 * Math.sin(time * 1.7 + i) * m.breath, a.s * bend * 0.35, tw)
      const open = (1 - m.grip) * 0.75 + 0.06 * Math.sin(time * 2.6 + i * 1.7) * m.breath
      a.fin.rotation.set(-open, 0, 0)
    })
    // the legs: two-bone IK so the tips stay on the ground (in the body's frame) as it crouches and steps
    const h = BODY_Y + BASE_Y - drop + breathe * 0.04
    for (const l of legs) {
      const A = l.group === 'a'
      const step = A ? m.lStep : m.rStep
      const lift = A ? m.lLift : m.rLift
      const reach = reach0 + m.spread * 2.2 - 0.15 * Math.abs(step)
      const ty = -h + 0.22 + Math.max(0, lift) * 1.8
      const d = Math.min(Lf + Lt - 0.01, Math.hypot(reach, ty))
      const af = Math.atan2(ty, reach) + Math.acos(Math.min(1, Math.max(-1, (Lf * Lf + d * d - Lt * Lt) / (2 * Lf * d))))
      const kx = Math.cos(af) * Lf
      const ky = Math.sin(af) * Lf
      const at = Math.atan2(ty - ky, reach - kx)
      const sway = m.sway * 0.04 * Math.sin(time * 1.8 + l.i * 1.3 + (l.s > 0 ? 0 : 2))
      l.root.rotation.set(0, l.fan - l.s * step * 0.55 + sway, l.s * (af - af0), 'YZX')
      l.knee.rotation.set(0, 0, l.s * (at - af - (at0 - af0)))
    }
  }

  return makeRig({
    id: 'pincer',
    body: b,
    scale: 1.42,
    height: 11,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 1, tail: 1, charge: 2, grab: 0, throw: 1, stomp: 1, beam: 2 },
    glow: { pulse: 2.0, depth: 0.2, crackle: 0, base: 1 },
    clips,
    apply,
  })
}

