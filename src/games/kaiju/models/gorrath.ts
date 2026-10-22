import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { applyBiped, bipedSkeleton, type BipedDims, type BipedFeel } from './biped'
import { E, arm, both, clipsFor, keyed, set, sweepClip, type Clip, type Key, type Style } from './motion'
import { COLORS } from './palette'
import { Body, TAU, makeRig, oval, stroke, type Quality } from './rig'
import { conform, type Ell, type P2 } from '../../../lib/three/toon'

/*
  Gorrath, Ape of the Ashlands: a huge ape in a knuckle stance. A barrel chest and a mountain of shoulders on short
  legs, arms longer than the legs ending in boulder fists that rest on the ground, a head sunk low between the
  shoulders with a crest of fur, a heavy brow, a pale face and muzzle, fangs, and eyes that glow like embers. Three
  claw scars across its chest smoulder in the same ember orange. Tufts of fur spike off its shoulders, back, elbows
  and forearms so its outline bristles. It walks on its knuckles, beats its chest to taunt, hammers with both fists,
  swats a backhand for its sweeping attack, and its special is the Ground Pound: it rears up and drives both fists
  into the ground, three times.
*/

const C = COLORS.gorrath

const D: BipedDims = {
  footH: 0.45,
  thigh: 1.4,
  shin: 1.3,
  hipX: 0.95,
  spine: 1.3,
  chest: 1.5,
  neck: [1.5, 0.55],
  head: [0.45, 0.85],
  jaw: [-0.2, 0.35],
  shoulder: [2.0, 1.05, 0.15],
  upper: 2.85,
  fore: 2.65,
}

export function buildGorrath(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.1, q)
  const j = bipedSkeleton(b, D)
  const fur = (bone: THREE.Bone, at: [number, number, number], to: [number, number, number], r: number) => b.spike(bone, at, to, r, C.extra, { ink: 0.07 }, 0.5)

  /* ---- short, thick legs and ape feet ---- */
  for (const l of j.legs) {
    const s = l.side
    b.ell(l.hip, [s * 0.1, -0.6, 0.05], [0.9, 1.1, 0.95], C.body)
    b.cap(l.knee, [0, 0.05, 0], [0, -D.shin + 0.1, 0.05], 0.72, 0.6, C.body)
    fur(l.knee, [s * 0.5, -0.1, -0.35], [s * 0.85, -0.25, -0.9], 0.3)
    b.ell(l.ankle, [s * 0.05, -0.25, 0.35], [0.7, 0.36, 0.95], C.accent)
    for (const k of [-1, 0, 1]) b.ell(l.ankle, [s * 0.05 + k * 0.32, -0.3, 1.15], [0.2, 0.2, 0.26], C.accent, [0, 0, 0], { ink: 0.06 })
    // the big toe, set apart like an ape's
    b.ell(l.ankle, [-s * 0.6, -0.28, 0.75], [0.24, 0.22, 0.3], C.accent, [0, -s * 0.6, 0], { ink: 0.06 })
  }

  /* ---- hips, belly, the barrel chest, the shoulders and the hump of the back ---- */
  b.ell(j.hips, [0, 0.15, -0.1], [1.6, 1.05, 1.3], C.body)
  b.ell(j.spine, [0, 0.55, 0.12], [1.8, 1.5, 1.45], C.body)
  b.ell(j.chest, [0, 0.55, 0.0], [2.15, 1.9, 1.6], C.body)
  b.ell(j.chest, [0, 1.45, -0.75], [1.7, 1.05, 1.2], C.body)
  for (const s of [1, -1]) b.ell(j.chest, [s * 1.85, 1.1, 0.0], [1.08, 1.02, 1.08], C.body)
  // the bare chest: a great slab of pale skin split into two, raked by three ember claw scars (they light first)
  const skin: Ell = { c: [0, 0.5, 0.78], r: [1.6, 1.2, 0.95] }
  b.ell(j.chest, skin.c, skin.r, C.accent)
  b.add(j.chest, conform(stroke([[0, 1.35], [0.05, 0.6], [0, -0.3]], 0.09, 0.3), skin, 0.02), C.extra, undefined, { flat: true, ink: 0 })
  for (const s of [1, -1]) b.add(j.chest, conform(stroke([[s * 0.2, 0.05], [s * 0.8, -0.1], [s * 1.3, 0.15]], 0.08, 0.3), skin, 0.02), C.extra, undefined, { flat: true, ink: 0 })
  for (let i = 0; i < 3; i++) {
    const y0 = 1.2 - i * 0.36
    const path: P2[] = [[-1.2, y0], [-0.4, y0 - 0.2], [0.4, y0 - 0.42], [1.1, y0 - 0.68]]
    b.add(j.chest, conform(stroke(path, 0.17, 0.25), skin, 0.035), C.glow, undefined, { glow: 0.2 + i * 0.1 })
  }
  // fur spiking off the shoulders and the back
  for (const s of [1, -1]) {
    for (const [x, y, z, dx, dy, dz, r] of [
      [1.8, 1.9, -0.2, 0.5, 0.8, -0.4, 0.38],
      [2.4, 1.5, -0.3, 0.75, 0.4, -0.5, 0.34],
      [1.2, 2.25, -0.6, 0.3, 0.8, -0.6, 0.36],
      [0.55, 2.35, -1.0, 0.15, 0.7, -0.8, 0.34],
      [1.4, 1.2, -1.2, 0.5, 0.3, -0.8, 0.32],
    ] as const)
      fur(j.chest, [s * x, y, z], [s * (x + dx), y + dy, z + dz], r)
    fur(j.spine, [s * 1.4, 0.4, -0.8], [s * 1.9, 0.3, -1.4], 0.32)
  }
  fur(j.chest, [0, 2.2, -1.2], [0, 2.8, -1.9], 0.4)
  fur(j.spine, [0, 1.0, -1.25], [0, 1.2, -2.0], 0.36)

  /* ---- the head: crest, brow, pale face and muzzle, ember eyes, fangs ---- */
  b.ell(j.head, [0, 0.35, -0.15], [1.05, 1.0, 1.0], C.body)
  b.ell(j.head, [0, 1.12, -0.35], [0.42, 0.5, 0.85], C.dark, [0.3, 0, 0])
  const face: Ell = { c: [0, 0.12, 0.5], r: [0.82, 0.78, 0.62] }
  b.ell(j.head, face.c, face.r, C.accent)
  b.ell(j.head, [0, 0.62, 0.68], [0.98, 0.3, 0.42], C.dark, [-0.1, 0, 0])
  const muzzle: Ell = { c: [0, -0.18, 0.95], r: [0.64, 0.46, 0.46] }
  b.ell(j.head, muzzle.c, muzzle.r, C.accent)
  for (const s of [1, -1]) {
    b.paint(j.head, face, oval(s * 0.34, 0.36, 0.17, 0.11, s * -0.2, 14), C.glow, 0.02, { glow: 1 })
    b.paint(j.head, face, oval(s * 0.36, 0.35, 0.06, 0.06, 0, 10), '#2a0a00', 0.035)
    b.paint(j.head, muzzle, oval(s * 0.17, 0.0, 0.1, 0.07, s * 0.5, 10), C.dark, 0.012)
    // ears, and fangs down from the muzzle
    b.ell(j.head, [s * 1.0, 0.3, 0.05], [0.22, 0.32, 0.2], C.accent)
    b.spike(j.head, [s * 0.32, -0.45, 1.1], [s * 0.33, -0.85, 1.15], 0.1, C.light, { ink: 0.04 })
    // fur at the cheeks
    fur(j.head, [s * 0.95, -0.05, -0.1], [s * 1.45, -0.3, -0.4], 0.3)
  }
  b.ell(j.head, [0, -0.45, 0.85], [0.5, 0.16, 0.36], '#3a0d12', [0, 0, 0], { ink: 0, flat: true })
  const jaw = j.jaw!
  b.ell(jaw, [0, -0.35, 0.55], [0.58, 0.3, 0.5], C.accent)
  b.ell(jaw, [0, -0.15, 0.55], [0.4, 0.1, 0.36], '#ff6f86', [0, 0, 0], { ink: 0 })
  for (const s of [1, -1]) b.spike(jaw, [s * 0.32, -0.15, 0.85], [s * 0.34, 0.25, 0.88], 0.11, C.light, { ink: 0.04 })

  /* ---- long arms, big forearms, boulder fists ---- */
  for (const a of j.arms) {
    const s = a.side
    b.cap(a.sh, [0, 0, 0], [0, -D.upper + 0.1, 0], 1.08, 0.78, C.body)
    fur(a.sh, [s * 0.4, -D.upper + 0.4, -0.55], [s * 0.6, -D.upper + 0.1, -1.15], 0.32)
    b.cap(a.el, [0, 0.05, 0], [0, -D.fore + 0.2, 0.05], 0.95, 0.8, C.body)
    for (const k of [0.6, 1.3, 2.0]) fur(a.el, [s * 0.55, -k, -0.35], [s * 1.0, -k - 0.25, -0.7], 0.28)
    // the fist: pale knuckles in front, a thumb
    b.ell(a.wr, [0, -0.55, 0.05], [0.88, 0.78, 0.82], C.extra)
    for (const k of [-1.5, -0.5, 0.5, 1.5]) b.ell(a.wr, [k * 0.3, -1.0, 0.45], [0.2, 0.2, 0.26], C.accent, [0, 0, 0], { ink: 0.05 })
    b.ell(a.wr, [-s * 0.6, -0.55, 0.45], [0.26, 0.34, 0.26], C.accent, [0, 0, -s * 0.5], { ink: 0.05 })
    b.ell(a.wr, [0, -0.6, 0.62], [0.62, 0.42, 0.32], C.accent, [0, 0, 0], { ink: 0 })
  }

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, -0.35, 1.2)
  j.head.add(mouth)
  const fist = (a: (typeof j.arms)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -1.1, 0.2)
    a.wr.add(o)
    return o
  }
  const foot = new THREE.Object3D()
  foot.position.set(0, -0.5, 0.6)
  j.legs[1].ankle.add(foot)
  const strikers = [fist(j.arms[0]), fist(j.arms[1]), foot]

  /* ---- how it moves ---- */
  const g = { lean: 0.8, crouch: 0.22, lUp: 0.48, lOut: 0.22, lBend: 0.5, rUp: 0.48, rOut: 0.22, rBend: 0.5, nod: -0.7 }
  const style: Style = { size: 1, mass: 0.85, lead: 'l', guard: g, lieH: 1.7, sinkY: -5.4, mid: 4.0 }
  const feel: BipedFeel = { size: 1, arm: { up: 0.06, out: 0.12, bend: 0.12 }, drop: 1.2, jawMax: 0.7, headK: 0.5, breath: 1.4, tailSway: 0, stretch: 0.1 }
  const base = clipsFor(style)
  const c = g.crouch

  // knuckle-walking: the arms swing like front legs, the body rolls
  const walk: Clip = (m, t) => {
    base.walk(m, t)
    const p = t * TAU
    m.lUp = g.lUp + 0.45 * Math.sin(p + 0.3)
    m.rUp = g.rUp - 0.45 * Math.sin(p + 0.3)
    m.lBend = g.lBend + 0.3 * Math.max(0, Math.cos(p))
    m.rBend = g.rBend + 0.3 * Math.max(0, -Math.cos(p))
    m.bend += 0.08 * Math.sin(p)
    m.twist += 0.1 * Math.sin(p)
  }
  // the heavy: both fists raised over the head, then hammered down
  const heavy = keyed(g, [
    [0, {}],
    [0.4, { lean: -0.15, crouch: 0.1, ...both(2.95, 0.15, 0.6), nod: -0.5, jaw: 0.8, y: 0.2, squash: -0.06, glow: 0.3 }],
    [0.55, { lean: 0.75, crouch: c + 0.3, ...both(0.95, 0.05, 0.05, 1), nod: -0.2, jaw: 1, z: 1.2, squash: 0.12, shake: 0.8 }, E.in],
    [0.72, { lean: 0.8, crouch: c + 0.34, ...both(0.7, 0.1, 0.15, 0.4), nod: -0.3, jaw: 0.6, z: 1.1, squash: 0.04 }, E.out],
    [1, {}],
  ])
  // the Ground Pound: it rears up tall, then drives both fists into the ground, three times
  const up = { lean: -0.3, crouch: 0.0, ...both(3.0, 0.3, 0.5), nod: -0.6, jaw: 1, y: 0.3, squash: -0.08, glow: 1, shake: 0.4 }
  const slam = (k: number) => ({ lean: 0.85, crouch: c + 0.45, ...both(0.62, 0.15, 0.0, 1), nod: -0.15, jaw: 1, z: 0.6, squash: 0.16 * k, shake: 1, glow: 1 })
  const half = { lean: 0.35, crouch: c + 0.2, ...both(2.2, 0.25, 0.6), nod: -0.45, jaw: 0.9, y: 0.1, glow: 1, shake: 0.5 }
  const beam = keyed(g, [
    [0, {}],
    [0.3, up],
    [0.38, slam(1), E.in],
    [0.48, half, E.out],
    [0.56, slam(0.8), E.in],
    [0.66, half, E.out],
    [0.74, slam(1), E.in],
    [0.88, { ...slam(0.3), glow: 0.6, shake: 0.4 }],
    [1, {}],
  ])
  // the taunt: standing up to beat its chest with both fists in turn, roaring
  const beat = (side: 'l' | 'r', k: number) => ({ ...arm(side, 0.75, 0.35, 2.0 - 0.3 * k, 0, -1.3), ...arm(side === 'l' ? 'r' : 'l', 0.6, 0.45, 1.5, 0, -1.1) })
  const stand = { lean: -0.05, crouch: 0.08, nod: -0.3, jaw: 1, glow: 0.5 }
  const taunt = keyed(g, [
    [0, {}],
    [0.14, { ...stand, ...beat('l', 0), jaw: 0.5 }],
    ...[0.24, 0.34, 0.44, 0.54, 0.64, 0.74].map((t, i): Key => [t, { ...stand, ...beat(i % 2 ? 'r' : 'l', 1), squash: 0.02 }, E.in]),
    [0.86, { ...stand, ...both(1.0, 0.6, 0.6), jaw: 1, shake: 0.8 }],
    [1, {}],
  ])
  // the win: chest beating and roaring at the sky, stood tall
  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU * 2
    const k = Math.sin(p)
    m.lean = -0.15
    m.crouch = 0.05
    m.nod = -0.6
    m.jaw = 0.7 + 0.3 * Math.abs(k)
    m.lUp = 0.75
    m.lOut = 0.35
    m.lTwist = -1.3
    m.lBend = 1.7 + 0.3 * Math.max(0, k)
    m.rUp = 0.75
    m.rOut = 0.35
    m.rTwist = -1.3
    m.rBend = 1.7 + 0.3 * Math.max(0, -k)
    m.glow = 0.6 + 0.4 * Math.abs(k)
    m.shake = 0.5
    m.y = 0.1 * Math.abs(k)
  }
  const clips = { ...base, walk, heavy, beam, taunt, victory, tail: sweepClip(style) }

  return makeRig({
    id: 'gorrath',
    body: b,
    scale: 1.3,
    height: 11.5,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 1, tail: 1, charge: 0, grab: 0, throw: 1, stomp: 2, beam: 1 },
    glow: { pulse: 2.4, depth: 0.25, crackle: 0.35, base: 1 },
    clips,
    apply: (m, time) => applyBiped(j, D, feel, m, time),
  })
}
