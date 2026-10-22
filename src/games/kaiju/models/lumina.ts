import * as THREE from 'three'
import type { KaijuRig } from '../types'
import { applyBiped, bipedSkeleton, type BipedDims, type BipedFeel } from './biped'
import { E, both, clipsFor, keyed, type Clip, type Mo, type Style } from './motion'
import { COLORS } from './palette'
import { Body, T, TAU, makeRig, oval, plate, sphere, stroke, tube, type Quality } from './rig'
import type { Ell, P2, P3 } from '../../../lib/three/toon'

/*
  Lumina, the Moth Queen: a giant moth standing upright, the fastest and the frailest. A fuzzy golden thorax with a
  cream ruff, a banded abdomen hanging below, thin legs with furry thighs, slender arms, a round fuzzy head with huge
  dark compound eyes and two feathery antennae. Its four wings are the show: broad gold forewings and rounded
  hindwings with a dark edge band, cream bars, veins, and big eyespots whose rings glow gold (they light first when it
  charges, the eyes and the antenna tips last). The wings live on their own joints: `wing` (0 folded back like a cloak,
  1 open, 2 raised), `flap` (a fast beat) and, for Lumina, `curl` sweeps them forward, which is how the Dust Storm is
  done: three hard forward strokes of the wings. Its heavy is a hopping double kick; its walk is light.
*/

const C = COLORS.lumina
const BAND = C.extra
const FUZZ = C.accent

const D: BipedDims = {
  footH: 0.4,
  thigh: 1.9,
  shin: 2.1,
  hipX: 0.7,
  spine: 0.9,
  chest: 1.3,
  neck: [1.45, 0.3],
  head: [0.55, 0.3],
  shoulder: [1.0, 0.65, 0.4],
  upper: 1.6,
  fore: 1.55,
  tail: { at: [-0.1, 0.35], seg: [[0.55, 0.95], [0.5, 0.85], [0.45, 0.7]] },
}

/** the forewing, root at the origin, reaching out along +x */
const FORE: P2[] = [[0, 0.35], [0.9, 1.25], [2.2, 2.25], [3.7, 3.05], [5.2, 3.55], [6.5, 3.55], [7.4, 3.0], [7.7, 2.1], [7.3, 1.1], [6.3, 0.25], [4.9, -0.45], [3.3, -0.85], [1.8, -0.8], [0.6, -0.45], [0, -0.15]]
/** the hindwing, a rounded lobe below */
const HIND: P2[] = [[0, 0.1], [1.4, -0.05], [2.9, -0.6], [4.3, -1.5], [5.1, -2.6], [5.0, -3.6], [4.2, -4.3], [2.9, -4.4], [1.7, -3.7], [0.8, -2.5], [0.2, -1.2], [0, -0.4]]
/** the dark band along the forewing's outer edge */
const FORE_BAND: P2[] = [[4.4, 3.3], [5.2, 3.55], [6.5, 3.55], [7.4, 3.0], [7.7, 2.1], [7.3, 1.1], [6.3, 0.25], [5.4, -0.25], [5.6, 0.5], [6.4, 1.2], [6.7, 2.0], [6.4, 2.7], [5.6, 3.0]]
const HIND_BAND: P2[] = [[4.5, -1.75], [5.1, -2.6], [5.0, -3.6], [4.2, -4.3], [2.9, -4.4], [1.9, -3.9], [2.9, -3.75], [3.9, -3.4], [4.35, -2.6]]

export function buildLumina(q: Quality = 'high'): KaijuRig {
  const b = new Body(0.085, q)
  const j = bipedSkeleton(b, D)

  /* ---- thin legs with furry thighs and two-clawed feet ---- */
  for (const l of j.legs) {
    const s = l.side
    b.ell(l.hip, [s * 0.05, -0.75, 0.05], [0.62, 1.05, 0.62], FUZZ)
    for (const k of [0, 1, 2]) b.ell(l.hip, [s * 0.35, -0.3 - k * 0.5, 0.3 - k * 0.05], [0.28, 0.25, 0.28], FUZZ, [0, 0, 0], { ink: 0.05 })
    b.cap(l.knee, [0, 0.05, 0], [0, -D.shin + 0.1, 0.1], 0.26, 0.2, C.dark)
    b.ell(l.knee, [0, -0.1, 0], [0.36, 0.3, 0.36], C.body)
    b.ell(l.ankle, [0, -0.15, 0.2], [0.32, 0.2, 0.5], C.dark)
    for (const k of [-1, 1]) b.spike(l.ankle, [k * 0.18, -0.25, 0.6], [k * 0.26, -0.38, 1.05], 0.11, C.light, { ink: 0.04 }, 0.4)
  }

  /* ---- the fuzzy thorax and its cream ruff, the banded abdomen ---- */
  b.ell(j.hips, [0, 0.1, -0.05], [0.95, 0.8, 0.85], C.body)
  b.ell(j.spine, [0, 0.4, 0.0], [1.1, 0.95, 0.95], C.body)
  const thorax: Ell = { c: [0, 0.6, 0.05], r: [1.4, 1.5, 1.2] }
  b.ell(j.chest, thorax.c, thorax.r, C.body)
  b.paint(j.chest, thorax, oval(0, 0.35, 0.8, 1.05, 0, 22), FUZZ, 0.015, { flat: false })
  // the ruff: a ring of fluffy lumps round the neck, and tufts down the chest
  const n = q === 'low' ? 10 : 16
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    b.ell(j.chest, [Math.sin(a) * 1.05, 1.75 + Math.cos(a * 2) * 0.06, Math.cos(a) * 0.85], [0.42, 0.36, 0.42], i % 2 ? FUZZ : C.light, [0, 0, 0], { ink: 0.05 })
  }
  for (const [x, y] of [[-0.35, 1.1], [0.35, 1.05], [0, 0.65], [-0.4, 0.2], [0.4, 0.2]] as const) b.ell(j.chest, [x, y, 1.12], [0.32, 0.28, 0.22], FUZZ, [0, 0, 0], { ink: 0.04 })
  // the abdomen hangs from the hips, banded gold and dark
  const ab = j.tail.map((t) => b.at(t, [0, 0, 0]))
  const abStart: P3 = [0, ab[0][1] + 0.5, ab[0][2] + 0.35]
  const abR = (u: number) => 0.62 + 0.25 * Math.sin(Math.min(1, u * 1.3) * Math.PI) - 0.45 * u * u
  const abT = tube([abStart, ...ab], abR, q, 24, 12)
  b.bend(j.tail, abT.geo, C.body)
  b.bend(j.tail, abT.ends[1], C.body)
  abT.ends[0].dispose()
  for (const u of [0.22, 0.4, 0.58, 0.76]) {
    const p = abT.curve.getPointAt(u)
    const tg = abT.curve.getTangentAt(u)
    const ring = new THREE.TorusGeometry(abR(u) * 0.98, 0.08, 6, q === 'low' ? 12 : 22)
    const m = new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).multiply(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), tg)))
    b.bend(j.tail, ring, BAND, m, { ink: 0 })
  }

  /* ---- the head: round and fuzzy, huge compound eyes, feathery antennae ---- */
  const headE: Ell = { c: [0, 0.4, 0.15], r: [0.78, 0.72, 0.72] }
  b.ell(j.head, headE.c, headE.r, C.body)
  b.ell(j.head, [0, 0.0, 0.55], [0.38, 0.28, 0.3], FUZZ)
  for (const s of [1, -1]) {
    b.ell(j.head, [s * 0.5, 0.45, 0.42], [0.42, 0.5, 0.4], '#1c1230', [0, s * 0.35, 0], { ink: 0.06 })
    b.paint(j.head, { c: [s * 0.5, 0.45, 0.42], r: [0.42, 0.5, 0.4] }, oval(s * 0.42, 0.62, 0.11, 0.08, 0, 10), '#ffffff', 0.01, { glow: 1 })
    b.paint(j.head, { c: [s * 0.5, 0.45, 0.42], r: [0.42, 0.5, 0.4] }, oval(s * 0.56, 0.3, 0.06, 0.05, 0, 8), C.glow, 0.01, { glow: 1 })
  }
  b.ell(j.head, [0, -0.2, 0.62], [0.12, 0.2, 0.1], C.dark, [0.4, 0, 0], { ink: 0.03 })
  const ant = ([1, -1] as const).map((s) => {
    const a = b.joint(s > 0 ? 'antL' : 'antR', j.head, s * 0.3, 0.95, 0.45)
    b.add(a, tube([[0, 0, 0], [s * 0.35, 0.9, 0.3], [s * 0.9, 1.75, 0.15], [s * 1.5, 2.3, -0.2]], (u) => 0.08 - 0.04 * u, q, 12, 6).geo, C.dark, undefined, { ink: 0.04 })
    // the feather: a long comb on each side of the stalk
    const comb: P2[] = []
    for (let i = 0; i <= 8; i++) comb.push([i * 0.28, 0.06 + (i % 2 ? 0.32 : 0.12) * Math.sin((i / 8) * Math.PI)])
    for (let i = 8; i >= 0; i--) comb.push([i * 0.28, -0.06 - (i % 2 ? 0.32 : 0.12) * Math.sin((i / 8) * Math.PI)])
    const m = new THREE.Matrix4().makeTranslation(s * 0.2, 0.45, 0.25).multiply(new THREE.Matrix4().makeRotationZ(s > 0 ? 0.95 : Math.PI - 0.95)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2 - 0.25))
    b.add(a, plate(comb, 0.06, 0.3, q), FUZZ, m, { ink: 0.035 })
    b.add(a, sphere(q, 10, 8), C.glow, T([s * 1.5, 2.3, -0.2], [0, 0, 0], 0.14), { glow: 0.9 })
    return a
  })

  /* ---- slender arms with fuzzy cuffs and hooked claws ---- */
  for (const a of j.arms) {
    b.ell(a.sh, [0, -0.05, 0], [0.42, 0.42, 0.42], FUZZ)
    b.cap(a.sh, [0, -0.1, 0], [0, -D.upper + 0.05, 0], 0.24, 0.2, C.dark)
    b.cap(a.el, [0, 0, 0], [0, -D.fore + 0.05, 0.05], 0.2, 0.16, C.dark)
    b.ell(a.el, [0, -0.1, 0], [0.3, 0.25, 0.3], FUZZ, [0, 0, 0], { ink: 0.05 })
    b.ell(a.wr, [0, -0.1, 0.05], [0.22, 0.2, 0.2], C.dark)
    for (const k of [-1, 1]) b.spike(a.wr, [k * 0.1, -0.2, 0.15], [k * 0.12, -0.6, 0.35], 0.08, C.light, { ink: 0.035 }, 0.6)
  }

  /* ---- four wings on their own joints ---- */
  const wings = ([1, -1] as const).flatMap((s) => {
    const f = b.joint(s > 0 ? 'foreL' : 'foreR', j.chest, s * 0.55, 1.1, -0.95)
    const h = b.joint(s > 0 ? 'hindL' : 'hindR', j.chest, s * 0.5, 0.35, -1.0)
    const mir = new THREE.Matrix4().makeScale(s, 1, 1)
    const wing = (bone: THREE.Bone, shape: P2[], band: P2[], spot: P2, spotR: number, veins: P2[][], bar: P2[] | null, order: number) => {
      b.add(bone, plate(shape, 0.14, 0.3, q), C.body, mir.clone(), { ink: 0.07 })
      for (const z of [1, -1]) {
        const face = new THREE.Matrix4().multiplyMatrices(mir, new THREE.Matrix4().makeTranslation(0, 0, z * 0.075)).multiply(new THREE.Matrix4().makeScale(1, 1, z))
        const flat = (pts: P2[], color: string, dz: number, glow?: number) => {
          const g = new THREE.ShapeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))))
          g.translate(0, 0, dz)
          b.add(bone, g, color, face.clone(), glow === undefined ? { flat: true, ink: 0 } : { glow, ink: 0 })
        }
        flat(band, BAND, 0.004)
        if (bar) flat(bar, FUZZ, 0.004)
        for (const v of veins) {
          const g = stroke(v, 0.07, 0.15, 0.3)
          g.translate(0, 0, 0.008)
          b.add(bone, g, BAND, face.clone(), { flat: true, ink: 0 })
        }
        // the eyespot: a dark ring, a glowing gold ring, a dark pupil with a white glint
        flat(oval(spot[0], spot[1], spotR, spotR, 0, 24), BAND, 0.012)
        flat(oval(spot[0], spot[1], spotR * 0.74, spotR * 0.74, 0, 24), C.glow, 0.016, order)
        flat(oval(spot[0], spot[1], spotR * 0.42, spotR * 0.42, 0, 20), '#2a1a0c', 0.02)
        flat(oval(spot[0] - spotR * 0.12, spot[1] + spotR * 0.12, spotR * 0.14, spotR * 0.14, 0, 12), '#ffffff', 0.024, order + 0.05)
      }
    }
    wing(f, FORE, FORE_BAND, [4.55, 1.55], 0.95, [[[0.3, 0], [3.0, 1.9], [5.6, 2.9]], [[0.3, -0.1], [3.4, 0.4], [6.6, 0.9]], [[0.3, -0.2], [2.6, -0.6], [4.6, -0.3]]], [[1.6, -0.55], [2.4, 1.7], [2.9, 1.95], [2.2, -0.75]], 0.3)
    wing(h, HIND, HIND_BAND, [3.0, -2.35], 0.72, [[[0.2, -0.2], [2.4, -1.4], [4.2, -2.4]], [[0.2, -0.4], [1.6, -2.4], [2.6, -3.9]]], null, 0.4)
    return [{ f, h, s }]
  })

  /* ---- strikers ---- */
  const mouth = new THREE.Object3D()
  mouth.position.set(0, 0.7, 1.3)
  j.chest.add(mouth)
  const hand = (a: (typeof j.arms)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -0.45, 0.25)
    a.wr.add(o)
    return o
  }
  const foot = (l: (typeof j.legs)[number]) => {
    const o = new THREE.Object3D()
    o.position.set(0, -0.3, 0.8)
    l.ankle.add(o)
    return o
  }
  const strikers = [hand(j.arms[0]), hand(j.arms[1]), foot(j.legs[0]), foot(j.legs[1])]

  /* ---- how it moves: light, quick, the wings always alive ---- */
  const g = { crouch: 0.12, lean: 0.1, lUp: 0.8, lOut: 0.35, lBend: 1.2, rUp: 0.8, rOut: 0.35, rBend: 1.2, nod: -0.05, wing: 1 }
  const style: Style = { size: 1, mass: 0.2, lead: 'l', guard: g, lieH: 1.2, sinkY: -4.6, mid: 5.0 }
  const feel: BipedFeel = { size: 1, arm: { up: 0.1, out: 0.15, bend: 0.2 }, drop: 1.5, jawMax: 0, headK: 0.75, breath: 0.8, tailSway: 0.6, stretch: 0.15 }
  const base = clipsFor(style)
  const c = g.crouch
  // the heavy: a hop on beating wings into a double kick
  const heavy = keyed(g, [
    [0, {}],
    [0.32, { y: 1.0, crouch: c + 0.25, lean: 0.05, wing: 2, flap: 0.7, lStep: -0.2, rStep: -0.2, lLift: 0.5, rLift: 0.5, ...both(1.2, 0.6, 1.0) }],
    [0.55, { y: 2.0, lean: -0.55, wing: 1.7, flap: 0.4, lStep: 1.0, rStep: 0.85, lLift: 0.25, rLift: 0.2, z: 1.3, ...both(0.6, 0.9, 0.6), squash: -0.05 }, E.in],
    [0.72, { y: 1.2, lean: -0.3, wing: 1.8, flap: 0.6, lStep: 0.5, rStep: 0.45, z: 1.0 }, E.out],
    [1, {}],
  ])
  // the Dust Storm: three hard forward strokes of the wings, eyespots blazing
  const back = { wing: 1.9, curl: -0.45, lean: -0.15, glow: 1, ...both(1.0, 0.7, 0.8), crouch: c + 0.05 }
  const clap = { wing: 1.15, curl: 1.25, lean: 0.25, glow: 1, ...both(0.7, 0.5, 1.0), crouch: c + 0.2, z: 0.3, shake: 0.4 }
  const beam = keyed(g, [
    [0, {}],
    [0.26, back],
    [0.38, clap, E.in],
    [0.5, back, E.out],
    [0.62, clap, E.in],
    [0.74, back, E.out],
    [0.86, clap, E.in],
    [1, {}],
  ])
  const dodge: Clip = (m, t) => {
    base.dodge(m, t)
    const k = Math.sin(Math.min(1, t / 0.7) * Math.PI)
    m.y += 1.1 * k
    m.wing = 1 + 0.8 * k
    m.flap = 0.6 * k
  }
  const victory: Clip = (m, t) => {
    base.victory(m, t)
    const p = t * TAU
    m.y = 1.4 + 0.35 * Math.sin(p)
    m.wing = 1.5
    m.flap = 1
    m.crouch = 0.05
    m.lLift = 0.3
    m.rLift = 0.25
    m.glow = 0.5 + 0.5 * Math.max(0, Math.sin(p))
  }
  const clips = { ...base, heavy, beam, dodge, victory }

  /* ---- the wings and antennae, on top of the biped ---- */
  const apply = (m: Mo, time: number) => {
    applyBiped(j, D, feel, m, time)
    const w = m.wing
    const sweep0 = w < 1 ? 1.35 + (0.45 - 1.35) * w : 0.45 + (0.62 - 0.45) * (w - 1)
    const raise0 = w < 1 ? -0.25 + 0.35 * w : 0.1 + 0.85 * (w - 1)
    const flapA = m.flap * 0.55 * Math.sin(time * 10)
    const flutter = m.sway * (0.06 * Math.sin(time * 2.2) + 0.03 * Math.sin(time * 5.3))
    for (const { f, h, s } of wings) {
      const sweep = sweep0 - m.curl * 0.95 + 0.05 * Math.sin(time * 1.4) * m.sway
      f.rotation.set(0, s * sweep, s * (raise0 + flapA + flutter), 'YZX')
      const flapB = m.flap * 0.5 * Math.sin(time * 10 - 0.6)
      h.rotation.set(0, s * (sweep * 0.9 + 0.1), s * (raise0 * 0.7 - 0.12 + flapB + flutter * 0.8), 'YZX')
    }
    ant.forEach((a, i) => {
      const s = i ? -1 : 1
      a.rotation.set(-0.1 + 0.08 * Math.sin(time * 3.1 + i) + m.nod * -0.2, 0, s * (0.06 * Math.sin(time * 2.3 + i * 2) + 0.1 * m.shake * Math.sin(time * 30)))
    })
  }

  return makeRig({
    id: 'lumina',
    body: b,
    scale: 1.05,
    height: 12,
    mouth,
    strikers,
    hits: { jab: 0, heavy: 2, tail: 1, charge: 0, grab: 0, throw: 0, stomp: 3 },
    glow: { pulse: 1.3, depth: 0.3, crackle: 0.25, base: 1 },
    clips,
    apply,
  })
}
