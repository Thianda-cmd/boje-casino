import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { applyBiped, bipedSkeleton, type BipedDims, type BipedFeel } from './biped'
import { E, arm, both, clipsFor, keyed, set, sweepClip, type Clip, type Style } from './motion'
import { COLORS } from './palette'
import { Body, T, TAU, hash, makeRig, rock, sphere, stroke, type Quality } from './rig'
import { conform, type Ell, type P2, type P3 } from '../../../lib/three/toon'

/*
  Bedrock, the Walking Mountain: a stone golem, the tallest and slowest of the eight. Every part is a faceted boulder
  (shaded flat per facet, outlined smooth) in two stone tones: a huge chest block, boulder shoulders, pillar legs on
  slab feet, and two great boulder fists. Lava glows in the cracks between the stones (glowing seams at every joint)
  and in zigzag cracks across the chest and the limbs; its small head is a rock with a brow ledge, two glowing eye
  slits and a glowing crack of a mouth. Moss grows in tufts on its shoulders, head and back. Its heavy is a double-fist
  smash, its sweep a slow backhand, and its special the Boulder Hurl: it stoops, tears a rock out of the ground with its
  right hand (the stage's boulder rides strikers[1]), heaves it overhead and throws it at 0.38.
*/

const C = COLORS.bedrock
const LAVA = C.glow
const MOSS = C.extra

const D: BipedDims = {
  footH: 0.7,
  thigh: 2.0,
  shin: 1.9,
  hipX: 1.3,
  spine: 1.35,
  chest: 1.9,
  neck: [1.75, 0.35],
  head: [0.45, 0.3],
  jaw: [-0.15, 0.25],
  shoulder: [2.45, 1.1, 0],
  upper: 2.1,
  fore: 2.1,
}

export function buildBedrock(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.11, q)
  const j = bipedSkeleton(b, D)
  let seed = 1
  /** a faceted stone on a joint: centre, radii, turn, tone */
  const stone = (bone: THREE.Bone, c: P3, r: P3, color = C.body, rot: P3 = [0, 0, 0], rough = 0.2) => b.add(bone, rock(seed++, rough, q), color, T(c, rot, r), { facet: true })
  /** lava showing in a seam: a flattened glowing lens */
  const seam = (bone: THREE.Bone, c: P3, r: P3, order: number, rot: P3 = [0, 0, 0]) => b.add(bone, sphere(q, 12, 8), LAVA, T(c, rot, [r[0] * 0.92, r[1] * 0.6, r[2] * 0.92]), { glow: order })
  /** a clump of moss: a few green lumps */
  const moss = (bone: THREE.Bone, c: P3, r: number) => {
    for (let i = 0; i < 4; i++) {
      const a = hash(seed, i) * TAU
      const d = r * 0.5 * hash(i, seed)
      b.ell(bone, [c[0] + Math.cos(a) * d, c[1] + hash(seed + i, 3) * r * 0.3, c[2] + Math.sin(a) * d], [r * 0.55, r * 0.4, r * 0.55], i % 2 ? MOSS : '#8cc45a', [0, 0, 0], { ink: 0.06 })
    }
    seed++
  }
  /** a zigzag lava crack across the front of an ellipsoid hugging a stone */
  const crack = (bone: THREE.Bone, e: Ell, path: P2[], w: number, order: number) => b.add(bone, conform(stroke(path, w, 0.2), e, 0.04), LAVA, undefined, { glow: order })

  /* ---- pillar legs on slab feet ---- */
  for (const l of j.legs) {
    const s = l.side
    seam(l.hip, [0, 0.05, 0], [0.7, 0.45, 0.7], 0.2)
    stone(l.hip, [s * 0.1, -1.0, 0.05], [1.05, 1.25, 1.1], C.body, [0.1, s * 0.4, 0])
    seam(l.knee, [0, 0, 0.1], [0.75, 0.35, 0.75], 0.15)
    stone(l.knee, [0, -0.95, 0.05], [0.95, 1.15, 1.0], C.accent, [0, s * 0.7, 0.05])
    stone(l.knee, [s * 0.35, -0.5, 0.55], [0.45, 0.4, 0.4], C.body, [0.3, 0, 0])
    seam(l.ankle, [0, 0.05, 0.1], [0.65, 0.3, 0.65], 0.1)
    stone(l.ankle, [0, -0.42, 0.35], [1.0, 0.5, 1.35], C.body, [0, s * 0.3, 0], 0.15)
    crack(l.hip, { c: [s * 0.1, -1.0, 0.25], r: [0.95, 1.1, 0.95] }, [[s * -0.2, -0.4], [s * 0.1, -0.8], [s * -0.1, -1.2], [s * 0.15, -1.6]], 0.1, 0.18)
  }

  /* ---- hips, belly, the chest block, the shoulders ---- */
  stone(j.hips, [0, 0.1, -0.05], [1.85, 1.0, 1.4], C.body, [0, 0.3, 0])
  seam(j.spine, [0, 0.0, 0.05], [1.35, 0.45, 1.05], 0.3)
  stone(j.spine, [0, 0.75, 0.1], [1.65, 1.05, 1.3], C.accent, [0, 0.8, 0.05])
  seam(j.chest, [0, -0.1, 0.1], [1.7, 0.45, 1.25], 0.35)
  const chestE: Ell = { c: [0, 0.75, 0.15], r: [2.2, 1.65, 1.55] }
  stone(j.chest, [0, 0.8, 0.0], [2.55, 1.85, 1.75], C.body, [0, 0.4, 0], 0.16)
  stone(j.chest, [0, 1.75, -0.65], [1.8, 0.9, 1.1], C.accent, [0.3, 0.2, 0])
  // lava cracks across the chest: they light first in the charge
  crack(j.chest, chestE, [[-1.4, 1.4], [-0.9, 0.9], [-1.1, 0.4], [-0.5, 0.0], [-0.7, -0.5]], 0.17, 0.25)
  crack(j.chest, chestE, [[1.3, 1.5], [0.8, 1.1], [1.0, 0.6], [0.35, 0.3], [0.55, -0.3]], 0.15, 0.3)
  crack(j.chest, chestE, [[-0.3, 1.6], [0.0, 1.2], [-0.15, 0.85]], 0.12, 0.35)
  for (const s of [1, -1]) {
    stone(j.chest, [s * 2.2, 1.35, 0], [1.35, 1.15, 1.3], C.accent, [0.2, s * 0.6, s * 0.2])
    moss(j.chest, [s * 2.2, 2.35, -0.1], 0.75)
    moss(j.chest, [s * 1.0, 2.45, -0.75], 0.6)
  }
  moss(j.spine, [0.9, 1.4, -1.0], 0.5)

  /* ---- the head: a rock with a brow ledge, eye slits and a glowing mouth crack ---- */
  seam(j.neck, [0, -0.25, 0.1], [0.9, 0.4, 0.85], 0.5)
  stone(j.head, [0, 0.55, 0], [1.05, 0.95, 1.0], C.body, [0, 0.5, 0])
  stone(j.head, [0, 0.95, 0.35], [1.1, 0.35, 0.75], C.accent, [-0.2, 0, 0], 0.12)
  const face: Ell = { c: [0, 0.55, 0.15], r: [0.95, 0.85, 0.9] }
  for (const s of [1, -1]) {
    b.paint(j.head, face, [[s * 0.15, 0.68], [s * 0.6, 0.72], [s * 0.58, 0.58], [s * 0.18, 0.56]], LAVA, 0.1, { glow: 1 })
  }
  moss(j.head, [0.3, 1.25, -0.2], 0.55)
  const jaw = j.jaw!
  stone(jaw, [0, -0.2, 0.3], [0.85, 0.42, 0.75], C.accent, [0, 0.3, 0], 0.15)
  b.paint(j.head, face, [[-0.42, 0.22], [-0.15, 0.3], [0.1, 0.18], [0.4, 0.27], [0.38, 0.18], [0.1, 0.08], [-0.15, 0.2], [-0.42, 0.13]], LAVA, 0.06, { glow: 0.95 })

  /* ---- arms: stacked stones and boulder fists ---- */
  for (const a of j.arms) {
    const s = a.side
    seam(a.sh, [0, -0.1, 0], [0.75, 0.75, 0.75], 0.4)
    stone(a.sh, [s * 0.1, -1.05, 0], [0.9, 1.15, 0.9], C.body, [0, s * 0.5, 0.1])
    seam(a.el, [0, 0, 0], [0.62, 0.4, 0.62], 0.45)
    stone(a.el, [0, -1.0, 0.05], [0.85, 1.1, 0.85], C.accent, [0.1, s * 0.9, 0])
    crack(a.el, { c: [0, -1.0, 0.25], r: [0.75, 1.0, 0.75] }, [[0, -0.4], [0.2, -0.85], [-0.1, -1.3]], 0.1, 0.5)
    seam(a.wr, [0, 0, 0], [0.6, 0.35, 0.6], 0.5)
    // the boulder fist, with knuckle stones
    stone(a.wr, [0, -0.85, 0.1], [1.25, 1.1, 1.2], C.body, [0.3, s * 0.4, 0], 0.18)
    for (const k of [-1, 0, 1]) stone(a.wr, [k * 0.5, -1.5, 0.6], [0.38, 0.32, 0.36], C.accent, [k, 0.5, 0], 0.25)
    moss(a.sh, [s * 0.4, -0.2, -0.3], 0.45)
  }

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, 0.25, 1.0)
  j.head.add(mouth)
  const fist = (a: (typeof j.arms)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -1.55, 0.4)
    a.wr.add(o)
    return o
  }
  const foot = new THREE.Object3D()
  foot.position.set(0, -0.8, 0.7)
  j.legs[1].ankle.add(foot)
  const strikers = [fist(j.arms[0]), fist(j.arms[1]), foot]

  /* ---- how it moves: slow, heavy, every blow a landslide ---- */
  const g = { crouch: 0.14, lean: 0.1, lUp: 0.5, lOut: 0.2, lBend: 1.0, rUp: 0.5, rOut: 0.2, rBend: 1.0, nod: 0.02 }
  const style: Style = { size: 1, mass: 1, lead: 'l', guard: g, lieH: 1.7, sinkY: -5.6, mid: 5.5 }
  const feel: BipedFeel = { size: 1, arm: { up: 0.06, out: 0.18, bend: 0.12 }, drop: 1.4, jawMax: 0.5, headK: 0.7, breath: 0.6, tailSway: 0, stretch: 0.08 }
  const base = clipsFor(style)
  const c = g.crouch
  // the heavy: both fists raised high and brought down together
  const heavy = keyed(g, [
    [0, {}],
    [0.4, { lean: -0.25, crouch: c + 0.05, ...both(2.9, 0.1, 0.5), nod: -0.35, jaw: 0.8, y: 0.15, squash: -0.07, glow: 0.4 }],
    [0.55, { lean: 0.6, crouch: c + 0.38, ...both(1.05, 0.0, 0.1, 1), nod: 0.1, jaw: 1, z: 1.0, squash: 0.15, shake: 1 }, E.in],
    [0.74, { lean: 0.65, crouch: c + 0.42, ...both(0.75, 0.05, 0.2, 0.4), nod: 0.15, jaw: 0.6, z: 0.95, squash: 0.05 }, E.out],
    [1, {}],
  ])
  // the Boulder Hurl: stoop and tear up a rock with the right hand, heave it overhead, throw it at 0.38
  const beam = keyed(g, [
    [0, {}],
    [0.12, { lean: 0.75, crouch: c + 0.45, ...arm('r', 0.75, 0.25, 0.2), ...arm('l', 0.6, 0.35, 0.8), nod: -0.3, glow: 0.3, squash: 0.05 }],
    [0.18, { lean: 0.65, crouch: c + 0.4, ...arm('r', 0.9, 0.25, 0.5), ...arm('l', 0.6, 0.35, 0.8), nod: -0.3, glow: 0.5, shake: 0.6 }],
    [0.32, { lean: -0.3, crouch: c + 0.1, twist: -0.5, ...arm('r', 3.0, 0.3, 1.2), ...arm('l', 1.4, 0.5, 0.6), nod: -0.25, glow: 1, jaw: 0.6, y: 0.1, squash: -0.06 }],
    [0.38, { lean: 0.45, crouch: c + 0.3, twist: 0.55, ...arm('r', 1.4, 0.1, 0.1, 1), ...arm('l', 0.4, 0.5, 1.0), nod: 0.0, glow: 1, jaw: 1, z: 0.8, squash: 0.08, shake: 0.8 }, E.in],
    [0.6, { lean: 0.5, crouch: c + 0.32, twist: 0.6, ...arm('r', 0.9, 0.2, 0.3), ...arm('l', 0.5, 0.45, 1.0), nod: -0.05, glow: 0.7, jaw: 0.5, z: 0.6 }, E.out],
    [0.86, { lean: 0.3, crouch: c + 0.2, twist: 0.3, glow: 0.5 }],
    [1, {}],
  ])
  // the taunt: the boulder fists ground together, dust and sparks
  const taunt = keyed(g, [
    [0, {}],
    [0.18, { ...both(1.35, -0.05, 1.3), lean: -0.05, nod: -0.15, crouch: c + 0.05 }],
    [0.3, { ...both(1.35, -0.42, 1.25), lean: 0.0, nod: -0.1, crouch: c + 0.1, squash: 0.04, shake: 0.5, glow: 0.3 }, E.in],
    [0.45, { ...both(1.35, -0.05, 1.3), lean: -0.05, nod: -0.15, crouch: c + 0.05 }],
    [0.57, { ...both(1.35, -0.42, 1.25), lean: 0.0, nod: -0.1, crouch: c + 0.1, squash: 0.04, shake: 0.5, glow: 0.45 }, E.in],
    [0.8, { ...both(1.0, 0.6, 0.6), lean: -0.15, nod: -0.3, jaw: 0.8, glow: 0.55 }],
    [1, {}],
  ])
  // the win: arms up, stamping the ground in turn
  const victory: Clip = (m, t) => {
    base.victory(m, t)
    const p = t * TAU
    m.lLift = 0.35 * Math.max(0, Math.sin(p))
    m.rLift = 0.35 * Math.max(0, -Math.sin(p))
    m.squash = 0.05 * Math.max(0, Math.cos(p * 2)) ** 4
    m.y *= 0.3
    m.jaw = 0.4 + 0.4 * Math.max(0, Math.sin(p))
  }
  // a slower, heavier idle: barely moving, the lava breathing
  const idle: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.x += 0.06 * Math.sin(p)
    m.bend += 0.02 * Math.sin(p)
    m.look += 0.05 * Math.sin(p + 1.3)
    m.glow = 0.08 + 0.08 * Math.sin(p * 2)
  }
  const clips = { ...base, idle, heavy, beam, taunt, victory, tail: sweepClip(style) }

  return makeRig({
    id: 'bedrock',
    body: b,
    scale: 1.14,
    height: 13,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 1, tail: 1, charge: 0, grab: 0, throw: 1, stomp: 2, beam: 1 },
    glow: { pulse: 1.1, depth: 0.35, crackle: 0.12, base: 1, boost: 0.75 },
    clips,
    apply: (m, time) => applyBiped(j, D, feel, m, time),
  })
}
