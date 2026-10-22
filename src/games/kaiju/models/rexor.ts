import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { applyBiped, bipedSkeleton, type BipedDims, type BipedFeel } from './biped'
import { E, both, clipsFor, keyed, set, type Clip, type Style } from './motion'
import { COLORS } from './palette'
import { Body, TAU, makeRig, oval, plate, stroke, tube, type Quality } from './rig'
import { conform, type Ell, type P2, type P3 } from '../../../lib/three/toon'

/*
  Rexor, the Atomic King: the classic upright atomic dinosaur. A pear of a body on two thick legs with big three-toed
  feet, a long heavy tail that drags behind and sways, little clawed arms, and a big head that is mostly jaw, under
  heavy brows with small glowing eyes. Three rows of jagged dorsal plates run from the back of the head to the tip of
  the tail and glow cyan; they are numbered from the tail tip to the head in the charge wave, so before the Atomic
  Breath the light climbs the plates up the tail and the back to the head, and the breath comes out of the mouth.
  Its heavy is a lunging bite with that jaw; its tail is a full spinning tail whip.
*/

const C = COLORS.rexor

const D: BipedDims = {
  footH: 0.62,
  thigh: 2.0,
  shin: 1.95,
  hipX: 1.05,
  spine: 1.25,
  chest: 1.45,
  neck: [1.0, 0.55],
  head: [0.72, 0.6],
  jaw: [-0.16, 0.05],
  shoulder: [1.3, 0.55, 0.5],
  upper: 1.15,
  fore: 0.95,
  tail: { at: [0.2, 1.15], seg: [[1.45, 0.5], [1.4, 0.72], [1.3, 0.8], [1.2, 0.8], [1.1, 0.7], [0.95, 0.5]] },
}

/** the jagged maple-leaf outline of a dorsal plate, base on y = 0, about 1 tall */
const LEAF: P2[] = [[-0.44, 0], [-0.52, 0.3], [-0.3, 0.38], [-0.38, 0.68], [-0.13, 0.7], [0, 1.08], [0.13, 0.7], [0.38, 0.68], [0.3, 0.38], [0.52, 0.3], [0.44, 0]]

export function buildRexor(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.1, q)
  const j = bipedSkeleton(b, D)
  const thin = { ink: 0.05 }
  const dot = (x: number, y: number, z: number, r: number) => [x, y, z, r] as const

  /* ---- legs and feet ---- */
  for (const l of j.legs) {
    const s = l.side
    // a big muscled thigh, a thick shin with a knobbly knee, dark scales
    b.ell(l.hip, [s * 0.14, -0.8, 0.08], [1.08, 1.45, 1.18], C.body, [0, 0, s * -0.12])
    b.cap(l.knee, [0, 0.1, 0], [0, -D.shin + 0.15, 0.05], 0.8, 0.62, C.body)
    b.ell(l.knee, [0, 0.05, 0.45], [0.52, 0.44, 0.42], C.dark, [0, 0, 0], { ink: 0.06 })
    for (const [x, y, z, r] of [dot(0.8, -0.2, 0.55, 0.24), dot(0.55, -0.9, 0.8, 0.2), dot(0.9, -1.2, 0.2, 0.22), dot(0.3, -0.45, 1.0, 0.16), dot(0.6, 0.0, -0.75, 0.2)]) b.ell(l.hip, [s * x, y, z], [r, r * 0.8, r], C.dark, [0, 0, 0], { ink: 0.045 })
    // the foot: a heavy pad, three toes with claws, a spur at the back
    b.ell(l.ankle, [0, -0.28, 0.38], [0.82, 0.44, 1.05], C.body)
    for (const k of [-1, 0, 1]) {
      const x = k * 0.44
      b.ell(l.ankle, [x, -0.38, 1.15 - Math.abs(k) * 0.12], [0.28, 0.25, 0.38], C.body, [0, k * 0.3, 0], { ink: 0.07 })
      b.spike(l.ankle, [x * 1.08, -0.42, 1.42 - Math.abs(k) * 0.12], [x * 1.2, -0.58, 1.78 - Math.abs(k) * 0.12], 0.14, C.light, thin, 0.4)
    }
    b.spike(l.ankle, [0, -0.3, -0.42], [0, -0.5, -0.86], 0.17, C.light, thin, 0.3)
  }

  /* ---- hips, belly, chest ---- */
  b.ell(j.hips, [0, 0.25, -0.2], [1.82, 1.32, 1.65], C.body)
  const belly: Ell = { c: [0, 0.5, 0.22], r: [1.55, 1.7, 1.38] }
  b.ell(j.spine, belly.c, belly.r, C.body)
  const chestE: Ell = { c: [0, 0.45, 0.08], r: [1.62, 1.68, 1.35] }
  b.ell(j.chest, chestE.c, chestE.r, C.body)
  // the pale belly, banded in scales, down the front from the throat to the hips
  b.paint(j.spine, belly, oval(0, 0.25, 1.0, 1.55, 0, 26), C.accent, 0.012, { flat: false })
  b.paint(j.chest, chestE, oval(0, 0.15, 0.92, 1.3, 0, 24), C.accent, 0.012, { flat: false })
  for (const y of [-0.95, -0.5, -0.05, 0.4, 0.85, 1.25]) b.add(j.spine, strokeOn(belly, y, 0.92 * Math.sqrt(Math.max(0.1, 1 - ((y - 0.25) / 1.6) ** 2))), C.extra, undefined, { flat: false, ink: 0 })
  for (const y of [-0.6, -0.15, 0.3, 0.75]) b.add(j.chest, strokeOn(chestE, y, 0.84 * Math.sqrt(Math.max(0.1, 1 - ((y - 0.15) / 1.35) ** 2))), C.extra, undefined, { flat: false, ink: 0 })
  // big shoulder humps, a ridge of muscle over the back, and scattered dark scales
  for (const s of [1, -1]) {
    b.ell(j.chest, [s * 1.12, 0.95, -0.2], [0.82, 0.68, 0.92], C.body)
    b.ell(j.spine, [s * 1.2, 0.1, -0.35], [0.6, 0.9, 0.8], C.body, [0, 0, s * 0.2])
  }
  for (const [x, y, z, r] of [dot(1.2, 0.4, -0.7, 0.24), dot(0.75, 1.25, -0.85, 0.22), dot(1.38, -0.25, -0.3, 0.2), dot(0.42, 0.65, -1.2, 0.22), dot(1.0, -0.65, -0.95, 0.2)]) for (const s of [1, -1]) b.ell(j.chest, [s * x, y, z], [r, r * 0.75, r], C.dark, [0, 0, 0], { ink: 0.045 })

  /* ---- neck and head ---- */
  b.cap(j.neck, [0, -0.5, -0.3], [0, 0.55, 0.32], 1.1, 0.92, C.body)
  b.paint(j.neck, { c: [0, 0, 0.12], r: [0.95, 1.0, 1.0] }, oval(0, -0.1, 0.58, 0.82, 0, 20), C.accent, 0.04, { flat: false })
  const skull: Ell = { c: [0, 0.28, 0.2], r: [1.0, 0.85, 1.1] }
  b.ell(j.head, skull.c, skull.r, C.body)
  const snout: Ell = { c: [0, 0.04, 1.28], r: [0.78, 0.55, 1.02] }
  b.ell(j.head, snout.c, snout.r, C.body)
  // the heavy brows over small, fierce glowing eyes
  for (const s of [1, -1]) {
    b.ell(j.head, [s * 0.5, 0.62, 0.95], [0.4, 0.19, 0.55], C.dark, [0.15, 0, s * -0.38])
    b.paint(j.head, skull, oval(s * 0.56, 0.42, 0.18, 0.09, s * -0.3, 14), C.glow, 0.02, { glow: 1 })
    b.paint(j.head, skull, oval(s * 0.58, 0.42, 0.04, 0.075, 0, 10), '#04131c', 0.035)
    // nostrils, a cheek ridge, and the spikes at the back of the skull
    b.paint(j.head, snout, oval(s * 0.24, 0.28, 0.08, 0.06, s * 0.4, 10), C.dark, 0.012)
    b.ell(j.head, [s * 0.72, 0.05, 0.55], [0.3, 0.22, 0.6], C.body, [0, s * 0.25, 0])
    b.spike(j.head, [s * 0.62, 0.55, -0.45], [s * 0.98, 0.78, -1.15], 0.24, C.dark, { ink: 0.06 }, 0.3)
    b.spike(j.head, [s * 0.85, 0.1, -0.3], [s * 1.3, 0.16, -0.85], 0.19, C.dark, { ink: 0.06 }, 0.3)
  }
  // the dark of the mouth (seen when the jaw drops) and the upper teeth along the snout's edge
  b.ell(j.head, [0, -0.3, 1.0], [0.62, 0.2, 0.95], '#3a0d1e', [0, 0, 0], { ink: 0, flat: true })
  for (let i = 0; i < 11; i++) {
    const a = 0.1 * Math.PI + (i / 10) * 0.8 * Math.PI
    const x = Math.cos(a) * 0.7
    const z = 1.2 + Math.sin(a) * 0.95
    b.spike(j.head, [x, -0.36, z], [x * 1.02, -0.66, z + 0.02], 0.09, C.light, { ink: 0.035 })
  }
  // the jaw: big, with its own teeth, a pale chin and a tongue
  const jaw = j.jaw!
  b.ell(jaw, [0, -0.36, 1.05], [0.7, 0.36, 1.12], C.body)
  b.ell(jaw, [0, -0.48, 0.95], [0.6, 0.24, 0.95], C.accent, [0, 0, 0], { ink: 0 })
  b.ell(jaw, [0, -0.2, 0.95], [0.48, 0.12, 0.78], '#ff6f86', [0, 0, 0], { ink: 0 })
  for (let i = 0; i < 9; i++) {
    const a = 0.16 * Math.PI + (i / 8) * 0.68 * Math.PI
    const x = Math.cos(a) * 0.6
    const z = 1.02 + Math.sin(a) * 0.98
    b.spike(jaw, [x, -0.14, z], [x, 0.16, z], 0.08, C.light, { ink: 0.035 })
  }

  /* ---- short, muscled arms with three claws ---- */
  for (const a of j.arms) {
    b.ell(a.sh, [0, -0.1, 0], [0.58, 0.58, 0.58], C.body)
    b.cap(a.sh, [0, -0.1, 0], [0, -D.upper + 0.05, 0.05], 0.5, 0.4, C.body)
    b.cap(a.el, [0, 0, 0], [0, -D.fore + 0.05, 0.08], 0.4, 0.33, C.body)
    b.ell(a.wr, [0, -0.15, 0.1], [0.36, 0.34, 0.3], C.body)
    for (const k of [-1, 0, 1]) b.spike(a.wr, [k * 0.17, -0.34, 0.22], [k * 0.25, -0.72, 0.48], 0.095, C.light, thin, 0.5)
  }

  /* ---- the tail: one tube bending along the chain ---- */
  const tailPts = j.tail.map((t) => b.at(t, [0, 0, 0]))
  const last = tailPts[tailPts.length - 1]
  const prev = tailPts[tailPts.length - 2]
  const tip: P3 = [last[0], last[1] + (last[1] - prev[1]) * 0.6, last[2] + (last[2] - prev[2]) * 0.6]
  const start: P3 = [0, tailPts[0][1] + 0.2, tailPts[0][2] + 0.8]
  const tailR = (u: number) => 1.32 * (1 - u) ** 0.8 + 0.12
  const tt = tube([start, ...tailPts, tip], tailR, q, 44, 16)
  b.bend(j.tail, tt.geo, C.body)
  b.bend(j.tail, tt.ends[1], C.body)
  tt.ends[0].dispose()
  // the pale underside of the tail
  const under = tube([start, ...tailPts.slice(0, -1)].map((p): P3 => [p[0], p[1] - 0.22, p[2]]), (u) => tailR(u * 0.85) * 0.88, q, 30, 12)
  b.bend(j.tail, under.geo, C.accent, undefined, { ink: 0 })
  under.ends.forEach((g) => g.dispose())

  /* ---- the dorsal plates: three rows, glowing; numbered tail tip (0) to head (1) for the charge wave ---- */
  const leaf = (size: number) => plate(LEAF, 0.18, 0.35, q).scale(size, size, size)
  const addPlate = (bones: THREE.Bone[], p: P3, size: number, slope: number, order: number) => {
    for (const s of [0, 1, -1]) {
      const k = s === 0 ? 1 : 0.64
      const m = new THREE.Matrix4()
        .makeTranslation(p[0] + s * 0.36 * size, p[1] - (s ? 0.1 * size : 0), p[2] + (s ? 0.12 * size : 0))
        .multiply(new THREE.Matrix4().makeRotationZ(-s * 0.3))
        .multiply(new THREE.Matrix4().makeRotationX(slope))
        .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2))
      b.bend(bones, leaf(size * k), C.glow, m, { glow: order, ink: 0.06, flat: true })
    }
  }
  // down the back of the head, the neck, the chest and the waist: pointing back, a little up
  const backPlates: [THREE.Bone, P3, number, number][] = [
    [j.head, [0, 0.95, -0.35], 0.6, -0.55],
    [j.neck, [0, 0.62, -0.62], 0.95, -0.85],
    [j.neck, [0, -0.15, -0.95], 1.15, -1.05],
    [j.chest, [0, 1.15, -1.05], 1.4, -1.2],
    [j.chest, [0, 0.3, -1.3], 1.55, -1.38],
    [j.spine, [0, 0.75, -1.35], 1.5, -1.45],
    [j.spine, [0, -0.05, -1.42], 1.4, -1.5],
  ]
  backPlates.forEach(([bone, p, size, slope], i) => addPlate([bone], b.at(bone, p), size, slope, 0.62 + 0.38 * (1 - i / (backPlates.length - 1))))
  // along the tail, shrinking to the tip
  const curve = tt.curve
  for (let i = 0; i < 10; i++) {
    const u = 0.05 + i * 0.094
    const p = curve.getPointAt(u)
    const tg = curve.getTangentAt(u)
    const r = tailR(u)
    addPlate(j.tail, [p.x, p.y + r * 0.8, p.z], 1.35 - u * 1.0, Math.atan2(tg.y, -tg.z), 0.6 * (1 - u))
  }

  /* ---- where the breath comes from and what strikes ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, -0.22, 2.3)
  j.head.add(mouth)
  const hand = (a: (typeof j.arms)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -0.6, 0.35)
    a.wr.add(o)
    return o
  }
  const tailTip = new THREE.Object3D()
  j.tail[j.tail.length - 1].add(tailTip)
  const bite = new THREE.Object3D()
  bite.position.set(0, -0.25, 2.1)
  j.head.add(bite)
  const stompFoot = new THREE.Object3D()
  stompFoot.position.set(0, -0.6, 0.5)
  j.legs[1].ankle.add(stompFoot)
  const strikers = [hand(j.arms[0]), hand(j.arms[1]), tailTip, bite, stompFoot]

  /* ---- how it moves ---- */
  const style: Style = {
    size: 1,
    mass: 0.7,
    lead: 'l',
    guard: { crouch: 0.16, lean: 0.12, ...both(0.45, 0.32, 1.1), nod: -0.04, tSide: 0.15 },
    lieH: 1.55,
    sinkY: -5.6,
    mid: 5.0,
  }
  const feel: BipedFeel = { size: 1, arm: { up: 0.15, out: 0.1, bend: 0.35 }, drop: 1.6, jawMax: 0.72, headK: 0.75, breath: 1, tailSway: 1, stretch: 0.15 }
  const base = clipsFor(style)
  const g = style.guard
  const c = g.crouch ?? 0
  // the heavy is a lunging bite: the head rears back with the jaw wide, then drives down and snaps shut
  const heavy = keyed(g, [
    [0, {}],
    [0.36, { lean: -0.3, nod: -0.55, jaw: 1, crouch: c + 0.2, ...both(1.0, 0.6, 1.0), tLift: 0.4, y: 0.1, squash: -0.05 }],
    [0.52, { lean: 0.62, nod: 0.3, jaw: 0.9, crouch: c + 0.3, z: 1.3, ...both(1.4, 0.4, 0.5), tLift: 0.55 }, E.in],
    [0.56, { lean: 0.66, nod: 0.36, jaw: 0, crouch: c + 0.34, z: 1.35, ...both(1.3, 0.35, 0.6), tLift: 0.55, squash: 0.08, shake: 0.6 }, E.in],
    [0.74, { lean: 0.52, nod: 0.22, jaw: 0.1, crouch: c + 0.3, z: 1.1, ...both(1.0, 0.35, 0.9), shake: 0.5 }, E.out],
    [1, {}],
  ])
  // the Atomic Breath: the light climbs the plates (glow 0 to 1 is the wave), then the head drives forward and fires
  const beam = keyed(g, [
    [0, {}],
    [0.08, { lean: -0.1, nod: -0.15, crouch: c + 0.1, glow: 0.15, tLift: 0.2 }],
    [0.3, { lean: -0.32, nod: -0.5, crouch: c + 0.3, jaw: 0.25, ...both(0.3, 0.7, 0.8), glow: 1, tLift: 0.6, tWave: 0.35, shake: 0.4, squash: -0.03 }],
    [0.38, { lean: 0.3, nod: 0.02, crouch: c + 0.36, jaw: 1, ...both(0.4, 0.75, 0.7), z: 0.35, glow: 1, shake: 0.7, squash: 0.03, tLift: 0.25 }, E.out],
    [0.86, { lean: 0.24, nod: 0.08, crouch: c + 0.36, jaw: 1, ...both(0.4, 0.75, 0.7), z: 0.15, glow: 1, shake: 0.85, tLift: 0.25 }, E.lin],
    [1, { glow: 0 }],
  ])
  // the taunt: a booming laugh with the head thrown back and two thumps of the tail
  const taunt = keyed(g, [
    [0, {}],
    [0.15, { lean: -0.25, nod: -0.4, jaw: 0.7, ...both(0.7, 0.8, 0.8), tLift: 0.7 }],
    [0.3, { lean: -0.15, nod: -0.25, jaw: 0.3, ...both(0.6, 0.7, 1.0), tLift: -0.3, squash: 0.04 }, E.in],
    [0.45, { lean: -0.28, nod: -0.45, jaw: 0.8, ...both(0.7, 0.8, 0.8), tLift: 0.7 }],
    [0.6, { lean: -0.15, nod: -0.25, jaw: 0.3, ...both(0.6, 0.7, 1.0), tLift: -0.3, squash: 0.04 }, E.in],
    [0.8, { lean: 0.05, nod: 0.1, jaw: 0.5, glow: 0.4 }],
    [1, {}],
  ])
  // the win: roaring at the sky, plates blazing, tail swishing
  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.lean = -0.3
    m.nod = -0.75 + 0.08 * Math.sin(2 * p)
    m.jaw = 0.65 + 0.35 * Math.max(0, Math.sin(p))
    m.lUp = 1.6 + 0.3 * Math.sin(2 * p)
    m.rUp = 1.6 - 0.3 * Math.sin(2 * p)
    m.lOut = 0.8
    m.rOut = 0.8
    m.lBend = 0.9
    m.rBend = 0.9
    m.crouch = 0.1
    m.glow = 0.55 + 0.45 * Math.max(0, Math.sin(p))
    m.shake = 0.6 * Math.max(0, Math.sin(p))
    m.tSide = 0.5 * Math.sin(p)
    m.tLift = 0.35
  }
  const clips = { ...base, heavy, beam, taunt, victory }

  return makeRig({
    id: 'rexor',
    body: b,
    scale: 1.15,
    height: 11.5,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 3, tail: 2, charge: 3, grab: 0, throw: 0, stomp: 4 },
    glow: { pulse: 1.6, depth: 0.18, crackle: 0, base: 1 },
    clips,
    apply: (m, time) => applyBiped(j, D, feel, m, time),
  })
}

/** a curved band across the front of an ellipsoid at height y, half width w (a belly scale) */
function strokeOn(e: Ell, y: number, w: number) {
  const n = 12
  const pts: P2[] = Array.from({ length: n + 1 }, (_, i) => {
    const x = -w + (2 * w * i) / n
    return [x, y - 0.06 * (1 - (x / w) ** 2)]
  })
  return conform(stroke(pts, 0.07, 0.15), e, 0.02)
}
