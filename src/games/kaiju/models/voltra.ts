import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { E, both, clipsFor, keyed, set, type Clip, type Mo, type Style } from './motion'
import { COLORS } from './palette'
import { Body, T, TAU, makeRig, oval, plate, sphere, tube, type Quality } from './rig'
import type { Ell, P2, P3 } from '../../../lib/three/toon'

/*
  Voltra, the Storm Serpent: a sea serpent rising from its coils. A spiral of thick body lies coiled on the ground
  (its tail end trailing out from the bottom with a fin on the tip), and from the top of the coil the body rises in an
  S, deep blue with a pale belly band, to a horned, dragonish head: a long snout, a jaw full of teeth, two great
  swept-back horns, finned cheek frills and glowing cyan eyes. Sail fins run down its back, two pectoral fins flare at
  its neck, and two glowing cyan lines run the length of its body: they are cut into pieces numbered from the tail to
  the head, so the crackle in the material runs up them like current and the charge wave lights them from the coils
  to the head before the Chain Lightning leaves its jaws.

  Skeleton: the coil (rigid, on the root), a short tail chain off its outer end, the rising body as a chain of nine
  joints with the head on top, pectoral fins on the neck. The channels map: crouch compresses the S (the head comes
  down; below 0 it rises high), lean bends the upper body forward (so a jab is a striking lunge of the head), twist
  and bend spread along the chain, the arms are the pectoral fins, the legs make the coils shimmy, the tail channels
  move the tail, and the idle sway keeps the whole body slowly weaving.
*/

const C = COLORS.voltra
const SKIN = C.body
const BELLY = C.accent
const FIN = C.extra
const HORN = C.light

/** the rising body's joints, each from the last: [up, forward] */
const RISE: [number, number][] = [[1.2, 0.2], [1.15, -0.1], [1.1, -0.3], [1.05, -0.25], [1.0, 0.0], [0.95, 0.3], [0.85, 0.5], [0.65, 0.65]]

export function buildVoltra(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.095, q)

  /* ---- the coil: a thick spiral on the ground ---- */
  const coil = b.joint('coil', null, 0, 0, -0.4)
  const helix: P3[] = []
  const turns = 1.7
  const N = 22
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const a = -Math.PI * 0.5 + u * turns * TAU
    const R = 3.1 - 1.3 * u
    helix.push([Math.cos(a) * R, 1.0 + u * 2.0, -0.4 + Math.sin(a) * R * 0.95])
  }
  // the coil ends at the top, in front, where the body rises
  const top = helix[helix.length - 1]
  const coilR = (u: number) => 1.05 - 0.05 * u
  const ht = tube(helix, coilR, q, 64, 14)
  b.bend([coil], ht.geo, SKIN)
  ht.ends.forEach((g) => g.dispose())
  // the pale belly shows along the underside and the inner side of the coil
  const inner = helix.map((p): P3 => {
    const k = 1 - 0.3 / Math.hypot(p[0], p[2] + 0.4)
    return [p[0] * k, p[1] - 0.32, -0.4 + (p[2] + 0.4) * k]
  })
  b.bend([coil], tube(inner, (u) => coilR(u) * 0.78, q, 64, 10).geo, BELLY, undefined, { ink: 0 })

  /* ---- the tail: out of the bottom of the coil, a fin on the tip ---- */
  const tail: THREE.Bone[] = []
  {
    const start = helix[0]
    let parent = b.joint('tail0', b.root, start[0] + 0.4, start[1] - 0.1, start[2] - 0.3)
    tail.push(parent)
    for (const [dx, dz] of [[1.1, -1.0], [1.0, -1.1], [0.8, -1.0]]) {
      parent = b.joint(`tail${tail.length}`, parent, dx, -0.05, dz)
      tail.push(parent)
    }
    const pts = tail.map((t) => b.at(t, [0, 0, 0]))
    const tt = tube([[start[0] - 0.2, start[1], start[2] + 0.6], ...pts], (u) => 0.95 - 0.7 * u, q, 20, 10)
    b.bend(tail, tt.geo, SKIN)
    b.bend(tail, tt.ends[1], SKIN)
    tt.ends[0].dispose()
    const end = tail[tail.length - 1]
    const finPts: P2[] = [[0, 0], [0.9, 0.9], [1.9, 1.3], [1.4, 0.2], [2.0, -0.9], [0.9, -0.6]]
    b.add(end, plate(finPts, 0.14, 0.3, q), FIN, new THREE.Matrix4().makeRotationY(-Math.PI / 2 + 0.75).multiply(new THREE.Matrix4().makeRotationX(0)), { ink: 0.06 })
  }

  /* ---- the rising body: a chain from the top of the coil up to the head ---- */
  const chain: THREE.Bone[] = []
  let parent = b.joint('b0', b.root, top[0], top[1] + 0.2, top[2])
  chain.push(parent)
  for (const [dy, dz] of RISE) {
    parent = b.joint(`b${chain.length}`, parent, 0, dy, dz)
    chain.push(parent)
  }
  const head = b.joint('head', chain[chain.length - 1], 0, 0.45, 0.45)
  const pts = chain.map((c) => b.at(c, [0, 0, 0]))
  const neckTop = b.at(head, [0, 0, -0.1])
  const bodyR = (u: number) => 1.08 - 0.36 * u
  const body = tube([[top[0], top[1] - 0.6, top[2] - 0.3], ...pts, neckTop], bodyR, q, 48, 14)
  b.bend(chain, body.geo, SKIN)
  b.bend(chain, body.ends[0], SKIN)
  body.ends[1].dispose()
  // the pale belly band down the front, the glowing lines down each side (cut in pieces so the current can run up
  // them), the sail fins down the back
  const curve = body.curve
  const v = new THREE.Vector3()
  const tg = new THREE.Vector3()
  const front = new THREE.Vector3()
  const along = (u: number, off: (r: number, f: THREE.Vector3, t: THREE.Vector3) => THREE.Vector3) => {
    curve.getPointAt(u, v)
    curve.getTangentAt(u, tg)
    front.set(0, 0, 1).addScaledVector(tg, -tg.z).normalize()
    return v.clone().add(off(bodyR(u), front, tg))
  }
  const bellyPts: P3[] = []
  for (let i = 0; i <= 16; i++) bellyPts.push(along(0.02 + (i / 16) * 0.94, (r, f) => f.clone().multiplyScalar(r * 0.42)).toArray() as P3)
  b.bend(chain, tube(bellyPts, (u) => bodyR(u) * 0.66, q, 40, 10).geo, BELLY, undefined, { ink: 0 })
  const pieces = q === 'low' ? 8 : 14
  for (const s of [1, -1]) {
    for (let k = 0; k < pieces; k++) {
      const u0 = 0.03 + (k / pieces) * 0.92
      const u1 = u0 + 0.92 / pieces - 0.01
      const seg: P3[] = [0, 0.5, 1].map((f) => along(u0 + (u1 - u0) * f, (r, fr, t) => new THREE.Vector3().crossVectors(t, fr).normalize().multiplyScalar(s * r * 0.97).addScaledVector(fr, r * 0.18)).toArray() as P3)
      const g = tube(seg, () => 0.12, q, 4, 6)
      b.bend(chain, g.geo, C.glow, undefined, { glow: 0.05 + (k / pieces) * 0.85 })
      g.ends.forEach((e) => e.dispose())
    }
  }
  const sail: P2[] = [[-0.55, 0], [-0.35, 0.75], [0.15, 1.25], [0.25, 0.7], [0.6, 0]]
  for (let k = 0; k < 9; k++) {
    const u = 0.08 + k * 0.1
    const p = along(u, (r, f) => f.clone().multiplyScalar(-r * 0.85))
    curve.getTangentAt(u, tg)
    const size = 1.15 - u * 0.5
    const back = new THREE.Vector3(0, 0, -1).addScaledVector(tg, tg.z).normalize()
    const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(tg.clone(), back, new THREE.Vector3().crossVectors(tg, back).normalize())), new THREE.Vector3(size, size, 1))
    b.bend(chain, plate(sail, 0.12, 0.3, q), FIN, m, { ink: 0.055 })
  }

  /* ---- the head: horned and dragonish, finned cheeks, glowing eyes ---- */
  const skull: Ell = { c: [0, 0.2, 0.2], r: [0.88, 0.72, 0.98] }
  b.ell(head, skull.c, skull.r, SKIN)
  const snout: Ell = { c: [0, 0.02, 1.15], r: [0.6, 0.42, 0.9] }
  b.ell(head, snout.c, snout.r, SKIN)
  b.ell(head, [0, -0.22, 0.95], [0.5, 0.14, 0.8], '#0a1a2a', [0, 0, 0], { ink: 0, flat: true })
  for (const s of [1, -1]) {
    b.ell(head, [s * 0.45, 0.55, 0.65], [0.36, 0.17, 0.5], C.dark, [0.15, 0, s * -0.3])
    b.paint(head, skull, oval(s * 0.52, 0.36, 0.2, 0.09, s * -0.25, 14), C.glow, 0.02, { glow: 1 })
    b.paint(head, skull, oval(s * 0.55, 0.36, 0.04, 0.075, 0, 10), '#021018', 0.035)
    b.paint(head, snout, oval(s * 0.2, 0.28, 0.07, 0.05, s * 0.4, 10), C.dark, 0.012)
    // the horns: a great pair swept back, a small pair below
    b.add(head, tube([[s * 0.45, 0.55, -0.1], [s * 0.7, 1.05, -0.65], [s * 0.85, 1.35, -1.35], [s * 0.8, 1.45, -2.0]], (u) => 0.26 * (1 - u) + 0.03, q, 12, 8).geo, HORN, undefined, { ink: 0.05 })
    b.add(head, tube([[s * 0.65, 0.15, -0.2], [s * 0.95, 0.25, -0.65], [s * 1.1, 0.2, -1.05]], (u) => 0.15 * (1 - u) + 0.02, q, 10, 6).geo, HORN, undefined, { ink: 0.045 })
    // the cheek frills: finned plates fanned behind the jaw
    const frill: P2[] = [[0, 0], [0.4, 0.75], [0.75, 0.35], [1.15, 0.6], [1.25, 0.0], [0.95, -0.45], [0.35, -0.35]]
    b.add(head, plate(frill, 0.1, 0.3, q), FIN, new THREE.Matrix4().makeTranslation(s * 0.75, -0.05, -0.05).multiply(new THREE.Matrix4().makeRotationY(s > 0 ? -0.35 : Math.PI + 0.35)), { ink: 0.05 })
  }
  for (let i = 0; i < 9; i++) {
    const a = 0.12 * Math.PI + (i / 8) * 0.76 * Math.PI
    b.spike(head, [Math.cos(a) * 0.52, -0.3, 1.1 + Math.sin(a) * 0.78], [Math.cos(a) * 0.53, -0.52, 1.12 + Math.sin(a) * 0.78], 0.07, HORN, { ink: 0.03 })
  }
  const jaw = b.joint('jaw', head, 0, -0.25, 0.2)
  b.ell(jaw, [0, -0.15, 0.85], [0.54, 0.24, 0.85], BELLY)
  b.ell(jaw, [0, -0.02, 0.8], [0.4, 0.09, 0.66], '#ff6f9a', [0, 0, 0], { ink: 0 })
  for (let i = 0; i < 7; i++) {
    const a = 0.18 * Math.PI + (i / 6) * 0.64 * Math.PI
    b.spike(jaw, [Math.cos(a) * 0.44, -0.04, 0.85 + Math.sin(a) * 0.74], [Math.cos(a) * 0.44, 0.16, 0.86 + Math.sin(a) * 0.74], 0.065, HORN, { ink: 0.03 })
  }
  // a glowing streak along the crown, between the horns
  b.add(head, sphere(q, 12, 8), C.glow, T([0, 0.86, 0.15], [0.2, 0, 0], [0.12, 0.08, 0.55]), { glow: 0.95 })

  /* ---- pectoral fins at the neck ---- */
  const fins = ([1, -1] as const).map((s) => {
    const f = b.joint(s > 0 ? 'finL' : 'finR', chain[6], s * 0.75, 0.1, 0.15)
    const shape: P2[] = [[0, 0.15], [0.9, 0.55], [1.9, 0.6], [2.4, 0.0], [1.7, -0.45], [0.8, -0.35], [0, -0.15]]
    b.add(f, plate(shape, 0.12, 0.3, q), FIN, new THREE.Matrix4().makeScale(s, 1, 1).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.3)), { ink: 0.055 })
    return { f, s }
  })

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, -0.15, 1.95)
  head.add(mouth)
  const tailTip = new THREE.Object3D()
  tail[tail.length - 1].add(tailTip)
  const chestPt = new THREE.Object3D()
  chestPt.position.set(0, 0, 1.0)
  chain[4].add(chestPt)
  const strikers = [mouth, tailTip, chestPt]

  /* ---- how it moves ---- */
  const g = { crouch: 0, lean: 0.25, nod: 0.05, lUp: 0.3, lOut: 0.45, lBend: 0, rUp: 0.3, rOut: 0.45, rBend: 0 }
  const style: Style = { size: 1, mass: 0.6, lead: 'l', guard: g, lieH: 0.6, sinkY: -4.2, mid: 5.5 }
  const base = clipsFor(style)
  // the jab: a striking lunge of the head, the jaws snapping shut on the blow
  const jab = keyed(g, [
    [0, {}],
    [0.25, { lean: -0.3, crouch: 0.15, jaw: 0.45, nod: -0.25 }],
    [0.42, { lean: 1.05, crouch: -0.15, jaw: 0.9, nod: 0.2, z: 0.6, squash: -0.04, lOut: 1.0, rOut: 1.0 }, E.in],
    [0.5, { lean: 1.05, crouch: -0.12, jaw: 0.05, nod: 0.22, z: 0.6 }, E.in],
    [0.64, { lean: 0.75, crouch: -0.05, jaw: 0.1, nod: 0.15, z: 0.4 }, E.out],
    [1, {}],
  ])
  // the heavy: rears up high and comes crashing down
  const heavy = keyed(g, [
    [0, {}],
    [0.4, { crouch: -0.55, lean: -0.5, nod: -0.4, jaw: 1, glow: 0.4, lOut: 1.2, rOut: 1.2, lUp: 1, rUp: 1, squash: -0.05 }],
    [0.56, { crouch: 0.3, lean: 1.45, nod: 0.35, jaw: 0.3, z: 1.2, squash: 0.1, shake: 1 }, E.in],
    [0.74, { crouch: 0.32, lean: 1.3, nod: 0.3, jaw: 0.2, z: 1.0 }, E.out],
    [1, {}],
  ])
  const hold = { lean: 0.7, crouch: 0.0, jaw: 0.25, nod: 0.15, z: 0.3 }
  const grab = keyed(g, [
    [0, {}],
    [0.3, { lean: -0.1, crouch: 0.1, jaw: 1, nod: -0.2 }],
    [0.5, { lean: 1.0, crouch: -0.15, jaw: 0.2, nod: 0.25, z: 0.6 }, E.in],
    [1, hold],
  ])
  const throwK = keyed(g, [
    [0, hold],
    [0.34, { ...hold, twist: -0.9, bend: -0.4, lean: 0.4, crouch: 0.2 }],
    [0.55, { twist: 1.0, bend: 0.5, lean: 0.2, crouch: -0.3, jaw: 1, nod: -0.2, y: 0.2 }, E.in],
    [0.75, { twist: 0.6, bend: 0.3, lean: 0.35, jaw: 0.6 }, E.out],
    [1, {}],
  ])
  // the Chain Lightning: it rises, flares its fins, the current climbs it, then it fires from the jaws
  const beam = keyed(g, [
    [0, {}],
    [0.28, { crouch: -0.45, lean: -0.3, nod: -0.35, ...both(1.0, 1.45, 0), jaw: 0.5, glow: 1, shake: 0.5 }],
    [0.38, { crouch: -0.35, lean: 0.45, nod: 0.08, ...both(1.0, 1.5, 0), jaw: 1, z: 0.3, glow: 1, shake: 0.8 }, E.out],
    [0.86, { crouch: -0.35, lean: 0.4, nod: 0.1, ...both(1.0, 1.5, 0), jaw: 1, z: 0.15, glow: 1, shake: 0.9 }, E.lin],
    [1, {}],
  ])
  const stomp = keyed(g, [
    [0, {}],
    [0.35, { crouch: -0.5, lean: -0.4, nod: -0.3, jaw: 0.8, lOut: 1.2, rOut: 1.2 }],
    [0.52, { crouch: 0.4, lean: 1.55, nod: 0.4, jaw: 0.4, z: 1.0, squash: 0.12, shake: 1 }, E.in],
    [0.72, { crouch: 0.4, lean: 1.4, nod: 0.35, z: 0.9 }, E.out],
    [1, {}],
  ])
  const taunt = keyed(g, [
    [0, {}],
    [0.2, { lean: -0.35, crouch: 0.15, nod: -0.3, jaw: 1, ...both(1.2, 1.4, 0), tWave: 1, glow: 0.5 }],
    [0.6, { lean: -0.3, crouch: 0.12, nod: -0.25, jaw: 0.85, ...both(1.2, 1.4, 0), tWave: 1, glow: 0.7, shake: 0.6 }],
    [0.8, { lean: 0.1, nod: 0.05, jaw: 0.3, tWave: 0.4 }],
    [1, {}],
  ])
  // knocked down, the body slumps over sideways onto the ground beside its coils
  const slump: Partial<Mo> = { crouch: 0.75, lean: -0.5, bend: 1.55, nod: 0.5, jaw: 0.45, look: 0.4, glow: -0.6, breath: 0.4, sway: 0.15, lUp: 0.2, rUp: 0.2, lOut: 0.2, rOut: 0.2 }
  const knockdown = keyed(g, [
    [0, {}],
    [0.12, { lean: -0.65, nod: -0.6, jaw: 1, crouch: -0.1, shake: 0.6, lOut: 1.2, rOut: 1.2 }, E.out],
    [0.5, { crouch: 0.4, lean: -0.7, bend: 0.9, nod: 0.1, jaw: 0.8 }, E.in],
    [0.66, { ...slump, squash: 0.08, shake: 1, glow: 0 }, E.in],
    [0.8, { ...slump, bend: 1.35, squash: -0.03 }, E.out],
    [0.92, { ...slump, squash: 0.03 }, E.in],
    [1, slump],
  ])
  const down: Clip = (m, t) => {
    set(m, { ...g, ...slump })
    const p = t * TAU
    m.jaw += 0.12 * Math.sin(p)
    m.nod += 0.05 * Math.sin(p)
    m.tWave = 0.2 + 0.2 * Math.sin(p * 2)
  }
  const getup = keyed(g, [
    [0, slump],
    [0.35, { ...slump, bend: 1.1, crouch: 0.6, nod: 0.2 }],
    [0.65, { crouch: 0.2, lean: 0.4, bend: 0.3, nod: -0.1, jaw: 0.3 }],
    [0.82, { look: 0.35, shake: 0.5 }],
    [1, {}],
  ])
  const sink: Clip = (m, t) => {
    base.sink(m, t)
    m.sway = 2.2
    m.tWave = 1
    m.lean = 0.3 * Math.sin(t * TAU * 2)
    m.bend = 0.3 * Math.sin(t * TAU)
  }
  const victory: Clip = (m, t) => {
    set(m, g)
    const p = t * TAU
    m.crouch = -0.55
    m.lean = 0.05
    m.bend = 0.3 * Math.sin(p)
    m.twist = 0.2 * Math.sin(p)
    m.nod = -0.5
    m.jaw = 0.6 + 0.4 * Math.max(0, Math.sin(p * 2))
    m.lOut = 1.4
    m.rOut = 1.4
    m.lUp = 1.0
    m.rUp = 1.0
    m.glow = 0.6 + 0.4 * Math.max(0, Math.sin(p * 2))
    m.shake = 0.5 * Math.max(0, Math.sin(p * 2))
    m.tWave = 0.8
  }
  const clips = { ...base, jab, heavy, grab, throw: throwK, beam, stomp, taunt, knockdown, down, getup, sink, victory }

  /* ---- the channels on the serpent ---- */
  const rest = chain.map((c) => (c.userData.rest as THREE.Vector3).clone())
  const tailRest = tail.map((c) => c.rotation.clone())
  const n = chain.length
  const apply = (m: Mo, time: number) => {
    const r = b.root
    r.position.set(m.x + m.shake * 0.04 * Math.sin(time * 53), m.y, m.z)
    r.rotation.set(m.pitch, m.yaw, m.roll, 'YXZ')
    r.scale.set(1 + m.squash * 0.6, 1 - m.squash, 1 + m.squash * 0.6)
    const breathe = Math.sin(time * 1.5) * m.breath
    // the coils shimmy as it moves
    coil.position.set(m.lStep * 0.35, 0, -0.4 + m.rStep * 0.2)
    coil.rotation.set(0, m.lStep * 0.12 + 0.02 * Math.sin(time * 0.9) * m.sway, m.bend * 0.04)
    coil.scale.set(1 + breathe * 0.02 + Math.abs(m.lLift - m.rLift) * 0.05, 1 - breathe * 0.02 - m.crouch * 0.12, 1 + breathe * 0.02)
    // the rising body: compressed by the crouch, bent forward by the lean, weaving with the sway
    for (let i = 0; i < n; i++) {
      const k = i / (n - 1)
      const up = Math.max(0, (k - 0.25) / 0.75)
      const lower = 1 - up
      const weave = m.sway * Math.sin(time * 1.25 - i * 0.55)
      const x = m.lean * up * 0.36 - m.crouch * (lower * 0.22 - up * 0.3) + 0.025 * weave + breathe * 0.01
      const y = m.twist * 0.14 + 0.03 * m.sway * Math.sin(time * 0.9 - i * 0.4)
      const z = m.bend * 0.13 + 0.05 * weave
      chain[i].rotation.set(x, y, z, 'YXZ')
      const sq = 1 - Math.max(-0.4, Math.min(0.5, m.crouch)) * 0.22
      chain[i].position.set(rest[i].x, rest[i].y * sq, rest[i].z)
    }
    head.rotation.set(m.nod * 0.8 - m.lean * 0.25 + m.crouch * 0.2, m.look * 0.6 + m.shake * 0.08 * Math.sin(time * 41), 0.03 * Math.sin(time * 0.7) * m.breath)
    jaw.rotation.x = m.jaw * 0.75
    for (const { f, s } of fins) {
      const out = s > 0 ? m.lOut : m.rOut
      const up = s > 0 ? m.lUp : m.rUp
      const bend = s > 0 ? m.lBend : m.rBend
      f.rotation.set(0.15 * Math.sin(time * 2 + s) * m.breath - up * 0.25, s * (0.5 - out * 0.4 + bend * 0.3), s * (0.25 + out * 0.35 + 0.08 * Math.sin(time * 3.1 + s)), 'YXZ')
    }
    tail.forEach((t, i) => {
      const k = (i + 1) / tail.length
      t.rotation.set(tailRest[i].x + m.tLift * 0.3 * k, tailRest[i].y + m.tSide * 0.35 + m.tWave * 0.4 * Math.sin(time * 7 - i) + m.sway * 0.12 * Math.sin(time * 1.4 - i * 0.7) * k, 0)
    })
  }

  return makeRig({
    id: 'voltra',
    body: b,
    scale: 1.02,
    height: 13,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 0, tail: 1, charge: 2, grab: 0, throw: 0, stomp: 2 },
    glow: { pulse: 2.6, depth: 0.2, crackle: 1.1, base: 1 },
    clips,
    apply,
  })
}
