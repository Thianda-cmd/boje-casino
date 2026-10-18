import * as THREE from 'three'
import { T, type Ell, type P2, type P3 } from '../../lib/three/toon'
import {
  C,
  FACE,
  INK,
  MOUTH,
  PUPIL,
  RKit,
  SHINE,
  SPARK,
  Spindle,
  TAU,
  V,
  arc,
  belt,
  blush,
  clamp01,
  curve2,
  edgedFin,
  ell,
  ellSurf,
  eye,
  fin,
  flatSurf,
  frameAt,
  horn,
  inked,
  limb,
  ohMouth,
  onEll,
  oval,
  paint,
  path3,
  rrect,
  shade,
  slab,
  smile,
  smoothstep,
  sphere,
  spiral,
  star,
  stroke,
  surfOf,
  tint,
  tubeR,
  warp,
  type EyeSpec,
  type Motion,
  type Surf,
} from './kit'
import type { FishId } from './rules'

/*
  The Reef Raid cast, modelled in code in the site's toon style (see kit.ts for how a model carries its motion).
  Every creature is built about one unit long (its length, or a manta's span) and drawn CAST[id].size reef units big,
  so outlines and pen lines are given in reef units and divided by the size here: a clownfish and the Golden Whale
  get the same ink on screen.

  The model frame: +x is forward (where it swims), +y its back, ±z its flanks. Each one is built to be seen from
  (0, sin view, cos view), its CAST view: side-on fish (view near 0) show a flank with a big eye; the turtle, manta and
  hammerhead are seen mostly from above. The crab, the jelly and the chest face +z (they never turn round), the
  seahorse stands upright along +y. Both flanks are modelled (a fish swimming left shows its other side).

  Each builder paints its own rig: the body wave and tail beat in channel 1, fins and flippers in channel 2, the
  pose (the puffer's puff, the octopus's jet squeeze, the chest lid) in aPose, glow on the jelly, the crab's fuse
  and the chest's seam, gold shine on the whale and the gold trim.
*/

/** outline and pen widths, in reef units (divided by each creature's size) */
const INK_W = 0.034
const PEN_W = 0.042

/* ---------------- part tags (what each rig moves) ---------------- */

const BODY = 0
const FLAP = 1
const TAIL = 2
const LID = 3
const SPIKE = 4
const HEAD = 5
const FLIP_F = 6
const FLIP_R = 7
const WING = 8
const TENT = 9
const CLAW = 11
const STALK = 12
const FUSE = 13
const BELL = 14
const FAN = 15
const TALL = 16
const LOOT = 17
const ARM = 20
const LEG = 40

/* ---------------- shared bits ---------------- */

const viewDir = (view: number) => V(0, Math.sin(view), Math.cos(view))

/** an eye on an ellipsoid, in direction `dir` from its centre, turned a share `toView` towards the camera */
function bodyEye(k: RKit, e: Ell, dir: P3, view: number, toView: number, s: EyeSpec) {
  const { p, n } = onEll(e, V(...dir))
  eye(k, frameAt(p, n.lerp(viewDir(view), toView).normalize()), s)
}

/** a toy eyeball on a stalk: a whole ball (white, or the lid colour for a blink) with the pupil facing `toward` */
function ballEye(k: RKit, c: P3, r: number, toward: THREE.Vector3, s: Omit<EyeSpec, 'r'>, ink: number) {
  const m = frameAt(c, toward)
  k.layer(FACE.white)
  k.add(sphere(12, 8), '#ffffff', T(c, [0, 0, 0], r), ink)
  k.layer(FACE.blink)
  k.add(sphere(12, 8), s.lid, T(c, [0, 0, 0], r * 1.03), ink)
  k.layer(FACE.always)
  // the pupil, glints, lash line and swirl as a flat eye on the front of the ball
  k.push(m)
  const front: Ell = { c: [0, 0, 0], r: [r, r, r] }
  const f = ellSurf(front)
  const look = s.look ?? [0.15, 0.05]
  const ps = s.pupil ?? 0.62
  const px = look[0] * r
  const py = look[1] * r
  k.layer(FACE.open)
  paint(k, f, oval(px, py, r * ps, r * ps * 1.06, 0, 18), PUPIL, 0.003, true)
  paint(k, f, oval(px - r * ps * 0.3, py + r * ps * 0.36, r * ps * 0.34, r * ps * 0.3, 0, 10), SPARK, 0.006, true)
  paint(k, f, oval(px + r * ps * 0.36, py - r * ps * 0.38, r * ps * 0.14, r * ps * 0.12, 0, 8), SPARK, 0.006, true)
  k.layer(FACE.blink)
  stroke(k, ellSurf({ c: [0, 0, 0], r: [r * 1.03, r * 1.03, r * 1.03] }), arc(0, r * 0.1, r * 0.85, r * 0.45, Math.PI * 1.1, Math.PI * 1.9, 10), Math.max(ink * 1.6, r * 0.16), 0.004)
  k.layer(FACE.dizzy)
  stroke(k, f, spiral(0, 0, r * 0.72, 2, 30), Math.max(ink * 1.3, r * 0.14), 0.004, INK, 0.08)
  k.layer(FACE.always)
  k.pop()
}

/** a frame whose +z is the model's +y, for painting onto a creature's back: local (x, y) = model (x, -z) */
const TOP = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
/** an ellipsoid given in model space, in the TOP frame */
const topEll = (e: Ell): Ell => ({ c: [e.c[0], -e.c[2], e.c[1]], r: [e.r[0], e.r[2], e.r[1]] })
/** a frame whose +z is the model's +x, for painting onto its front: local (x, y) = model (-z, y) */
const FRONT = new THREE.Matrix4().makeRotationY(Math.PI / 2)
const frontEll = (e: Ell): Ell => ({ c: [-e.c[2], e.c[1], e.c[0]], r: [e.r[2], e.r[1], e.r[0]] })

/**
 * The swim of a fish: a wave down the body (lateral, along z; or vertical, along y, for the whale's flukes) that
 * grows from nothing at x0 to `amp` at the tail tip, while the head swings a little against it.
 */
function swim(p: THREE.Vector3, o: { x0: number; tail: number; amp: number; k: number; head?: number; axis?: 'y' | 'z' }, m: Motion) {
  const u = clamp01((o.x0 - p.x) / (o.x0 - o.tail))
  const a = p.x > o.x0 ? -(o.head ?? 0.2) * o.amp * (p.x - o.x0) * 2 : o.amp * u * u
  if (o.axis === 'y') m.w1.set(0, a, 0, -o.k * u)
  else m.w1.set(0, 0, a, -o.k * u)
}

/**
 * A pair of fins flapping about their roots (channel 2): each vertex moves along `dir` (its z mirrored to the
 * vertex's side, so the pair opens and closes together) by its distance from the root.
 */
function flap(p: THREE.Vector3, root: THREE.Vector3, dir: P3, amp: number, m: Motion) {
  const s = Math.sign(p.z) || 1
  const d = Math.hypot(p.x - root.x, p.y - root.y, Math.abs(p.z) - Math.abs(root.z))
  m.w2.set(dir[0] * amp * d, dir[1] * amp * d, dir[2] * s * amp * d, 0)
}

/* ------------------------------------------------------------------ */
/*  Clownfish                                                           */
/* ------------------------------------------------------------------ */

function buildClown(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const O = '#ff8a2a'
  const body: Ell = { c: [0, 0, 0], r: [0.4, 0.27, 0.2] }
  const bs = ellSurf(body)
  k.part(BODY).add(sphere(18, 12), O, T(body.c, [0, 0, 0], body.r))
  // three white bands, each with a black edge
  for (const [x0, x1] of [[0.09, 0.19], [-0.12, 0.0], [-0.34, -0.27]] as const) {
    k.add(belt(body, x0 - 0.026, x1 + 0.026, 1.006), INK, undefined, 0, { flat: true })
    k.add(belt(body, x0, x1, 1.014), '#ffffff', undefined, 0)
  }
  // fins: orange with black margins
  const tail = curve2([[-0.33, 0.07], [-0.46, 0.21], [-0.58, 0.23], [-0.65, 0.12], [-0.61, 0], [-0.65, -0.12], [-0.58, -0.23], [-0.46, -0.21], [-0.33, -0.07]], 16)
  edgedFin(k, tail, 0.03, O, INK, 0.035, T([0, 0, 0]))
  const dorsal = curve2([[0.17, 0.19], [0.12, 0.31], [0.04, 0.35], [-0.04, 0.3], [-0.1, 0.36], [-0.2, 0.39], [-0.29, 0.32], [-0.32, 0.12], [-0.12, 0.16], [0.05, 0.18]], 16)
  edgedFin(k, dorsal, 0.03, O, INK, 0.032, T([0, 0, 0]))
  const anal = curve2([[-0.06, -0.18], [-0.12, -0.32], [-0.22, -0.35], [-0.3, -0.27], [-0.3, -0.12], [-0.16, -0.14]], 16)
  edgedFin(k, anal, 0.03, O, INK, 0.03, T([0, 0, 0]))
  // pelvic fins under the belly, splayed
  k.both(() => edgedFin(k, curve2([[0.0, 0.0], [0.05, -0.04], [0.03, -0.13], [-0.05, -0.15], [-0.07, -0.05], [-0.03, 0.0]], 12), 0.025, O, INK, 0.028, T([0.12, -0.2, 0.06], [0.45, 0, 0])))
  // pectoral fins on the flanks, facing up and out
  k.part(FLAP)
  const pecRoot = onEll(body, V(0.35, -0.25, 0.9)).p
  k.both(() => edgedFin(k, curve2([[0.02, 0.035], [-0.1, 0.075], [-0.2, 0.045], [-0.21, -0.03], [-0.1, -0.055], [0.02, -0.03]], 14), 0.024, O, INK, 0.03, frameAt(pecRoot.clone().add(V(0, 0, 0.01)), V(0, 0.6, 0.8))))
  k.part(BODY)
  // the face, on both flanks
  k.both(() => {
    bodyEye(k, body, [0.9, 0.32, 0.42], view, 0.35, { r: 0.1, lid: O, look: [0.25, 0.06] })
    blush(k, bs, 0.27, -0.07, 0.045, 0.024)
    k.layer(FACE.calm)
    stroke(k, bs, [[0.395, -0.02], [0.375, -0.06], [0.34, -0.08], [0.31, -0.072]], pen, 0.004)
    k.layer(FACE.dizzy)
    ohMouth(k, bs, 0.36, -0.05, 0.03, 0.035, 0.005)
    k.layer(FACE.always)
  })
  return k.bake((p, _n, tag, m) => {
    swim(p, { x0: 0.12, tail: -0.65, amp: 0.1, k: 2.4, head: 0.25 }, m)
    if (tag === FLAP) flap(p, pecRoot, [0, 0.6, 0.8], 0.9, m)
  })
}

/* ------------------------------------------------------------------ */
/*  Blue tang                                                           */
/* ------------------------------------------------------------------ */

function buildTang(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const B = '#2f7cff'
  const NAVY = '#14205a'
  const Y = '#ffd23a'
  const body: Ell = { c: [0, 0, 0], r: [0.4, 0.29, 0.13] }
  const bs = ellSurf(body)
  k.part(BODY)
  k.add(tint(sphere(20, 14), (_x, y) => C(y < -0.17 ? '#6fb0ff' : B)), '#ffffff', T(body.c, [0, 0, 0], body.r))
  // the black palette marking on each flank, with its blue window
  k.both(() => {
    const mark = curve2([[0.2, 0.14], [0.1, 0.22], [-0.08, 0.235], [-0.24, 0.19], [-0.36, 0.06], [-0.34, -0.02], [-0.22, 0.0], [-0.06, 0.03], [0.1, 0.05], [0.2, 0.08]], 26)
    paint(k, bs, mark, NAVY, 0.003, false)
    paint(k, bs, oval(-0.17, 0.12, 0.085, 0.045, -0.15, 16), B, 0.005, false)
    // a yellow flash by the tail
    paint(k, bs, oval(-0.33, 0.0, 0.035, 0.05, 0, 12), Y, 0.005, false)
  })
  // tail: a yellow crescent with dark edges
  const tail = curve2([[-0.34, 0.06], [-0.48, 0.21], [-0.6, 0.27], [-0.56, 0.11], [-0.53, 0], [-0.56, -0.11], [-0.6, -0.27], [-0.48, -0.21], [-0.34, -0.06]], 16)
  edgedFin(k, tail, 0.03, Y, NAVY, 0.03, T([0, 0, 0]))
  // long dorsal and anal fins: navy with a pale blue rim
  edgedFin(k, curve2([[0.22, 0.2], [0.12, 0.31], [-0.06, 0.34], [-0.24, 0.29], [-0.35, 0.16], [-0.3, 0.1], [-0.05, 0.2]], 16), 0.026, NAVY, '#7ec4ff', 0.024, T([0, 0, 0]))
  edgedFin(k, curve2([[0.08, -0.22], [-0.06, -0.31], [-0.24, -0.27], [-0.35, -0.15], [-0.3, -0.1], [-0.05, -0.2]], 18), 0.026, NAVY, '#7ec4ff', 0.024, T([0, 0, 0]))
  k.part(FLAP)
  const pecRoot = onEll(body, V(0.4, -0.12, 0.9)).p
  k.both(() => edgedFin(k, curve2([[0.02, 0.03], [-0.1, 0.07], [-0.19, 0.04], [-0.2, -0.03], [-0.1, -0.05], [0.02, -0.03]], 14), 0.022, Y, '#e09a10', 0.022, frameAt(pecRoot.clone().add(V(0, 0, 0.01)), V(0, 0.55, 0.83))))
  k.part(BODY)
  k.both(() => {
    bodyEye(k, body, [0.9, 0.22, 0.3], view, 0.3, { r: 0.105, lid: B, look: [0.3, 0.22], pupil: 0.64 })
    blush(k, bs, 0.26, -0.09, 0.045, 0.024)
    k.layer(FACE.calm)
    smile(k, bs, 0.345, -0.07, 0.04, 0.02, 0.004, pen)
    k.layer(FACE.dizzy)
    ohMouth(k, bs, 0.35, -0.07, 0.03, 0.034, 0.005)
    k.layer(FACE.always)
  })
  return k.bake((p, _n, tag, m) => {
    swim(p, { x0: 0.1, tail: -0.6, amp: 0.085, k: 2.2, head: 0.22 }, m)
    if (tag === FLAP) flap(p, pecRoot, [0, 0.55, 0.83], 0.9, m)
  })
}

/* ------------------------------------------------------------------ */
/*  Pufferfish                                                          */
/* ------------------------------------------------------------------ */

function buildPuffer(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const Y = '#f6d24e'
  const body: Ell = { c: [0, 0, 0], r: [0.34, 0.3, 0.3] }
  const bs = ellSurf(body)
  k.part(BODY)
  k.add(tint(sphere(22, 16), (_x, y) => C(y < -0.1 ? '#fff6dc' : Y)), '#ffffff', T(body.c, [0, 0, 0], body.r))
  // olive spots over the back
  k.both(() => {
    for (const [x, y, r] of [[-0.14, 0.12, 0.04], [0.02, 0.2, 0.034], [-0.22, -0.02, 0.03], [-0.04, 0.05, 0.026], [0.12, 0.12, 0.022]] as const) paint(k, bs, oval(x, y, r, r * 0.9, 0, 12), '#a7862a', 0.003)
  })
  k.push(TOP)
  for (const [x, y, r] of [[-0.06, 0, 0.04], [0.1, 0.03, 0.03], [-0.2, 0.06, 0.03], [-0.2, -0.07, 0.028]] as const) paint(k, ellSurf(topEll(body)), oval(x, y, r, r * 0.9, 0, 12), '#a7862a', 0.003)
  k.pop()
  // spikes all over, short until it puffs
  k.part(SPIKE)
  const n = 46
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n
    const a = i * 2.39996
    const d = V(Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y))
    // leave the face and the tail clear
    if (d.x > 0.55 || d.x < -0.8) continue
    const { p, n: nn } = onEll(body, d)
    horn(k, [p.x - nn.x * 0.01, p.y - nn.y * 0.01, p.z - nn.z * 0.01], [p.x + nn.x * 0.055, p.y + nn.y * 0.055, p.z + nn.z * 0.055], 0.02, '#fff1b8', INK_W * u * 0.6, 6)
  }
  // a little tail fan and fins
  k.part(TAIL)
  edgedFin(k, curve2([[-0.28, 0.05], [-0.4, 0.13], [-0.49, 0.1], [-0.47, 0], [-0.49, -0.1], [-0.4, -0.13], [-0.28, -0.05]], 16), 0.03, '#ffe07a', '#d9a520', 0.025, T([0, 0, 0]))
  k.part(BODY)
  edgedFin(k, curve2([[-0.16, 0.25], [-0.24, 0.33], [-0.31, 0.27], [-0.28, 0.18]], 10), 0.025, '#ffe07a', '#d9a520', 0.02, T([0, 0, 0]))
  edgedFin(k, curve2([[-0.16, -0.25], [-0.24, -0.33], [-0.31, -0.27], [-0.28, -0.18]], 10), 0.025, '#ffe07a', '#d9a520', 0.02, T([0, 0, 0]))
  k.part(FLAP)
  const pecRoot = onEll(body, V(0.15, -0.15, 1)).p
  k.both(() => edgedFin(k, curve2([[0.02, 0.04], [-0.07, 0.08], [-0.13, 0.04], [-0.13, -0.04], [-0.07, -0.07], [0.02, -0.03]], 12), 0.02, '#ffe07a', '#d9a520', 0.022, frameAt(pecRoot.clone().add(V(0, 0, 0.012)), V(0, 0.5, 0.86))))
  k.part(BODY)
  // the face: big eyes up top, grumpy little brows, a pout
  k.both(() => {
    bodyEye(k, body, [0.6, 0.55, 0.42], view, 0.35, { r: 0.1, lid: Y, look: [0.25, 0.0] })
    const ep = onEll(body, V(0.6, 0.55, 0.42)).p
    stroke(k, bs, [[ep.x - 0.08, ep.y + 0.13], [ep.x + 0.01, ep.y + 0.11], [ep.x + 0.08, ep.y + 0.06]], pen * 1.1, 0.006, INK, 0.3)
    blush(k, bs, 0.22, -0.06, 0.045, 0.025, '#ff9a8a')
  })
  // the pout: pink lips round a dark mouth, facing forward
  k.layer(FACE.calm)
  k.push(FRONT)
  const fe = frontEll(body)
  inked(k, ellSurf(fe), oval(0, -0.05, 0.05, 0.04, 0, 14), '#ff7f9a', 0.004, pen * 0.5, false)
  paint(k, ellSurf(fe), oval(0, -0.05, 0.022, 0.017, 0, 10), MOUTH, 0.008, true)
  k.layer(FACE.dizzy)
  ohMouth(k, ellSurf(fe), 0, -0.05, 0.05, 0.055, 0.006)
  k.pop()
  k.layer(FACE.always)
  return k.bake((p, _n, tag, m) => {
    // a stubby swim: only the tail fan swings
    if (tag === TAIL) m.w1.set(0, 0, 0.09 * clamp01((-0.25 - p.x) / 0.24), -1.2 * clamp01((-0.25 - p.x) / 0.24))
    else swim(p, { x0: -0.1, tail: -0.5, amp: 0.03, k: 1, head: 0.05 }, m)
    if (tag === FLAP) flap(p, pecRoot, [0, 0.5, 0.86], 1.1, m)
    // the puff: everything swells round the middle, the spikes stand up long
    const r = p.length()
    m.pose.copy(p).multiplyScalar(0.45)
    if (tag === SPIKE) m.pose.addScaledVector(p, (0.9 * clamp01((r - 0.28) / 0.08)) / Math.max(r, 1e-3) * 0.12)
  })
}

/* ------------------------------------------------------------------ */
/*  Angelfish                                                           */
/* ------------------------------------------------------------------ */

function buildAngel(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const Y = '#ffd84a'
  const NAVY = '#26306a'
  const BLUE = '#2f9bff'
  const body: Ell = { c: [0.05, 0, 0], r: [0.28, 0.28, 0.08] }
  const bs = ellSurf(body)
  k.part(BODY)
  k.add(sphere(20, 14), Y, T(body.c, [0, 0, 0], body.r))
  ell(k, { c: [0.28, 0.01, 0], r: [0.09, 0.075, 0.055] }, Y, [12, 8])
  // stripes
  for (const [x0, x1] of [[0.13, 0.2], [-0.04, 0.04], [-0.18, -0.12]] as const) k.add(belt(body, x0, x1, 1.02), NAVY, undefined, 0)
  // the tall swept fins, yellow with a blue margin
  k.part(TALL)
  const dorsal = curve2([[0.14, 0.2], [0.04, 0.4], [-0.12, 0.57], [-0.33, 0.74], [-0.29, 0.52], [-0.22, 0.3], [-0.16, 0.16], [0.0, 0.2]], 16)
  edgedFin(k, dorsal, 0.026, Y, BLUE, 0.03, T([0, 0, 0]), 0.13)
  const anal = dorsal.map(([x, y]): P2 => [x, -y])
  edgedFin(k, anal, 0.026, Y, BLUE, 0.03, T([0, 0, 0]), 0.13)
  k.part(TAIL)
  edgedFin(k, curve2([[-0.18, 0.06], [-0.32, 0.2], [-0.47, 0.33], [-0.43, 0.13], [-0.41, 0], [-0.43, -0.13], [-0.47, -0.33], [-0.32, -0.2], [-0.18, -0.06]], 16), 0.026, Y, BLUE, 0.028, T([0, 0, 0]))
  // long pelvic streamers
  k.part(TALL)
  k.both(() => k.add(tubeR(path3([[0.12, -0.2, 0.04], [0.06, -0.38, 0.05], [-0.02, -0.52, 0.04], [-0.08, -0.62, 0.03]]), (t) => 0.018 * (1 - t) + 0.006, 14, 6), BLUE, undefined, INK_W * u * 0.6))
  k.part(FLAP)
  const pecRoot = onEll(body, V(0.35, -0.2, 0.9)).p
  k.both(() => edgedFin(k, curve2([[0.02, 0.03], [-0.08, 0.06], [-0.15, 0.03], [-0.15, -0.02], [-0.08, -0.04], [0.02, -0.025]], 12), 0.018, '#fff3b0', '#e8b020', 0.016, frameAt(pecRoot.clone().add(V(0, 0, 0.01)), V(0, 0.4, 0.92))))
  k.part(BODY)
  k.both(() => {
    bodyEye(k, body, [0.75, 0.25, 0.25], view, 0.3, { r: 0.085, lid: Y, look: [0.28, 0.05], lashes: true })
    blush(k, bs, 0.2, -0.08, 0.04, 0.022)
  })
  // kissy lips on the snout
  k.layer(FACE.calm)
  k.push(FRONT)
  const lip = frontEll({ c: [0.28, 0.01, 0], r: [0.09, 0.075, 0.055] })
  inked(k, ellSurf(lip), oval(0, -0.015, 0.026, 0.02, 0, 12), '#ff6f9e', 0.004, pen * 0.4)
  k.layer(FACE.dizzy)
  ohMouth(k, ellSurf(lip), 0, -0.015, 0.028, 0.032, 0.005)
  k.pop()
  k.layer(FACE.always)
  return k.bake((p, _n, tag, m) => {
    swim(p, { x0: 0.05, tail: -0.48, amp: 0.05, k: 1.6, head: 0.15 }, m)
    // the long fin tips trail and wave more than the body
    if (tag === TALL) m.w1.z += 0.07 * clamp01((Math.abs(p.y) - 0.22) / 0.5)
    if (tag === FLAP) flap(p, pecRoot, [0, 0.4, 0.92], 1.0, m)
  })
}

/* ------------------------------------------------------------------ */
/*  Seahorse                                                            */
/* ------------------------------------------------------------------ */

function buildSeahorse(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const P = '#ff6fa8'
  const PL = '#ffb7d4'
  const spine = path3([[-0.02, 0.33, 0], [0.04, 0.2, 0], [0.09, 0.06, 0], [0.08, -0.1, 0], [-0.01, -0.23, 0], [-0.07, -0.33, 0], [-0.04, -0.43, 0], [0.04, -0.45, 0], [0.08, -0.39, 0], [0.04, -0.34, 0]])
  const r = (t: number) => (t < 0.08 ? 0.075 + t * 0.2 : t < 0.32 ? 0.09 + (t - 0.08) * 0.22 : Math.max(0.018, 0.143 - (t - 0.32) * 0.2))
  k.part(BODY)
  k.add(tubeR(spine, r, 34, 10), P)
  /** the tube's front near t along the spine, as a surface (locally a ball round that point of the spine) */
  const tubeAt = (t: number): Surf => {
    const c = spine.getPointAt(t)
    const rr = r(t)
    return (x, y) => Math.sqrt(Math.max(0, rr * rr - (x - c.x) ** 2 - (y - c.y) ** 2)) * 0.98
  }
  k.both(() => {
    // belly plates: pale arcs across the front of the belly
    for (let i = 0; i < 6; i++) {
      const t = 0.1 + i * 0.045
      const c = spine.getPointAt(t)
      const d = spine.getTangentAt(t)
      const nx = d.y
      const ny = -d.x
      const rr = r(t)
      const a = V(c.x + nx * rr * 0.95, c.y + ny * rr * 0.95)
      stroke(k, tubeAt(t), [[a.x - d.x * 0.02 - nx * 0.05, a.y - d.y * 0.02 - ny * 0.05], [a.x, a.y], [a.x + d.x * 0.02 - nx * 0.05, a.y + d.y * 0.02 - ny * 0.05]], pen * 0.9, 0.006, PL, 0.2, false)
    }
    // darker spots down its back
    for (const t of [0.06, 0.2, 0.34, 0.46]) {
      const c = spine.getPointAt(t)
      const d = spine.getTangentAt(t)
      paint(k, tubeAt(t), oval(c.x - d.y * r(t) * 0.4, c.y + d.x * r(t) * 0.4, 0.02, 0.018, 0, 10), '#e0508c', 0.004)
    }
  })
  // the head and snout
  const head: Ell = { c: [0.0, 0.36, 0], r: [0.115, 0.1, 0.085] }
  ell(k, head, P, [16, 12])
  k.add(tubeR(path3([[0.06, 0.35, 0], [0.16, 0.335, 0], [0.25, 0.32, 0]]), (t) => 0.036 + t * 0.006, 6, 8), P)
  ell(k, { c: [0.255, 0.32, 0], r: [0.025, 0.04, 0.038] }, '#e04f8a', [10, 8])
  // the coronet: little knobs on top
  for (const [x, y, rr] of [[-0.04, 0.47, 0.03], [0.0, 0.48, 0.034], [0.04, 0.46, 0.026], [-0.08, 0.43, 0.024]] as const) ell(k, { c: [x, y, 0], r: [rr, rr, rr] }, PL, [8, 6])
  // the back fin, fluttering
  k.part(FAN)
  const fanRoot: P3 = [-0.05, 0.02, 0]
  k.add(tint(fin(curve2([[0.0, 0.1], [-0.11, 0.13], [-0.18, 0.04], [-0.17, -0.06], [-0.1, -0.12], [0.0, -0.09]], 12), 0.02, 0.06), (x, y) => C((Math.round(Math.atan2(y, x + 0.02) * 4) & 1) ? '#ffe4f1' : '#ffc8e0')), '#ffffff', T(fanRoot), INK_W * u * 0.7)
  k.part(BODY)
  k.both(() => {
    bodyEye(k, head, [0.25, 0.25, 0.95], view, 0.3, { r: 0.075, lid: P, look: [0.3, 0.05], lashes: true })
    blush(k, ellSurf(head), 0.05, 0.3, 0.035, 0.02)
  })
  k.layer(FACE.dizzy)
  k.both(() => ohMouth(k, ellSurf({ c: [0.255, 0.32, 0], r: [0.025, 0.04, 0.038] }), 0.255, 0.31, 0.014, 0.02, 0.004))
  k.layer(FACE.always)
  return k.bake((p, _n, tag, m) => {
    // the whole body bobs, the tail curl sways
    const tail = clamp01((-0.18 - p.y) / 0.28)
    m.w1.set(0.02 * tail, 0.035, 0.05 * tail, -1.2 * tail)
    if (tag === FAN) {
      const d = Math.hypot(p.x - fanRoot[0], p.y - fanRoot[1])
      m.w2.set(0, 0, 0.35 * d, -6 * d)
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Sea turtle                                                          */
/* ------------------------------------------------------------------ */

function buildTurtle(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const SHELL = '#3fb871'
  const PLATE = '#2a8f57'
  const SKIN = '#b9e36f'
  const SPOT = '#7fb447'
  const shell: Ell = { c: [0, 0, 0], r: [0.36, 0.16, 0.3] }
  k.part(BODY)
  const sh = warp(sphere(30, 20), (v) => {
    if (v.y < -0.25) v.y = -0.25 - (v.y + 0.25) * 0.3
  })
  k.add(tint(sh, (_x, y) => C(y < -0.3 ? '#f2e3a0' : SHELL)), '#ffffff', T(shell.c, [0, 0, 0], shell.r))
  // the scutes: darker plates with pale seams between them, painted on top
  k.push(TOP)
  const ts = ellSurf(topEll(shell))
  const plates: P2[][] = []
  const hexAt = (cx: number, cy: number, rx: number, ry: number) => Array.from({ length: 6 }, (_, i) => [cx + Math.cos((i / 6) * TAU) * rx, cy + Math.sin((i / 6) * TAU) * ry] as P2)
  for (const x of [0.17, 0.0, -0.17]) plates.push(hexAt(x, 0, 0.085, 0.085))
  for (const s of [1, -1]) for (const x of [0.12, -0.06, -0.21]) plates.push(hexAt(x + 0.02, s * 0.165, 0.075, 0.07))
  for (const pl of plates) paint(k, ts, pl, PLATE, 0.004, false)
  // a rim of little marginal plates
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU
    const x = Math.cos(a) * 0.33
    const y = Math.sin(a) * 0.27
    paint(k, ts, oval(x, y, 0.035, 0.03, a, 8), PLATE, 0.004, false)
  }
  // a wet shine
  paint(k, ts, oval(0.1, 0.12, 0.08, 0.025, 0.4, 12), C('#e8fff0'), 0.007, true)
  k.pop()
  // the head on its neck
  k.part(HEAD)
  limb(k, [0.28, -0.01, 0], [0.42, 0.01, 0], 0.075, SKIN)
  const head: Ell = { c: [0.47, 0.03, 0], r: [0.13, 0.1, 0.11] }
  ell(k, head, SKIN, [20, 14])
  k.push(TOP)
  for (const [x, y, r] of [[0.44, 0.0, 0.022], [0.4, 0.05, 0.015], [0.4, -0.05, 0.015]] as const) paint(k, ellSurf(topEll(head)), oval(x, y, r, r, 0, 8), SPOT, 0.004)
  k.pop()
  k.both(() => bodyEye(k, head, [0.4, 0.6, 0.62], view, 0.25, { r: 0.055, lid: SKIN, look: [0.3, 0.0], droop: 0.32 }))
  // a gentle smile round the front of the beak
  k.push(FRONT)
  const hf = ellSurf(frontEll(head))
  k.layer(FACE.calm)
  smile(k, hf, 0, 0.0, 0.065, 0.03, 0.004, pen)
  k.layer(FACE.dizzy)
  ohMouth(k, hf, 0, -0.01, 0.03, 0.03, 0.005)
  k.layer(FACE.always)
  k.pop()
  // flippers: big front ones that row, little back ones
  k.part(FLIP_F)
  const fRoot: P3 = [0.17, -0.03, 0.24]
  const fAt = frameAt(V(...fRoot), V(0.05, 1, 0.12).normalize(), V(-0.35, -0.08, 1))
  k.both(() => {
    // a long paddle swept out and back, its leading edge forward
    const out: P2[] = curve2([[-0.02, 0.05], [0.1, 0.085], [0.24, 0.07], [0.4, 0.0], [0.44, -0.05], [0.36, -0.07], [0.18, -0.06], [-0.02, -0.05]], 22)
    k.add(fin(out, 0.04), SKIN, fAt)
    k.push(fAt)
    for (const [x, y, r] of [[0.12, 0.01, 0.022], [0.24, 0.0, 0.019], [0.34, -0.02, 0.015]] as const) paint(k, flatSurf(0.022), oval(x, y, r, r * 0.8, 0, 8), SPOT, 0.002)
    k.pop()
  })
  k.part(FLIP_R)
  const rRoot: P3 = [-0.25, -0.03, 0.18]
  k.both(() => k.add(fin(curve2([[-0.01, 0.04], [0.08, 0.05], [0.16, 0.0], [0.15, -0.05], [0.06, -0.05], [-0.01, -0.03]], 10), 0.034), SKIN, frameAt(V(...rRoot), V(0, 1, 0.1).normalize(), V(-0.8, -0.1, 0.7))))
  k.part(BODY)
  horn(k, [-0.32, -0.04, 0], [-0.45, -0.05, 0], 0.04, SKIN, undefined, 8)
  return k.bake((p, _n, tag, m) => {
    m.w1.set(0, 0.006, 0, 0)
    if (tag === FLIP_F) {
      const d = Math.hypot(p.x - fRoot[0], Math.abs(p.z) - fRoot[2])
      m.w1.set(0.32 * d, 0, 0, 0)
      m.w2.set(0, 0.3 * d, 0, Math.PI / 2)
    } else if (tag === FLIP_R) {
      const d = Math.hypot(p.x - rRoot[0], Math.abs(p.z) - rRoot[2])
      m.w1.set(0.1 * d, 0.15 * d, 0, Math.PI)
    } else if (tag === HEAD) m.w2.set(0, 0.012, 0, Math.PI)
  })
}

/* ------------------------------------------------------------------ */
/*  Octopus                                                             */
/* ------------------------------------------------------------------ */

function buildOctopus(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const P = '#c46bff'
  const PL = '#e6b8ff'
  const head: Ell = { c: [0.15, 0.05, 0], r: [0.27, 0.23, 0.25] }
  k.part(HEAD)
  ell(k, head, P, [20, 14])
  k.both(() => {
    for (const [x, y, r] of [[-0.02, 0.2, 0.035], [0.06, 0.12, 0.024], [-0.06, 0.08, 0.026]] as const) paint(k, ellSurf(head), oval(x, y, r, r * 0.9, 0, 10), PL, 0.003)
  })
  k.push(TOP)
  for (const [x, y, r] of [[-0.02, 0.0, 0.04], [0.08, 0.06, 0.028], [-0.08, -0.08, 0.03]] as const) paint(k, ellSurf(topEll(head)), oval(x, y, r, r * 0.9, 0, 10), PL, 0.003)
  paint(k, ellSurf(topEll(head)), oval(0.12, 0.1, 0.07, 0.025, 0.5, 12), C('#fbefff'), 0.006, true)
  k.pop()
  // eight arms fanning out behind like a skirt, the outer ones wide, every tip curling up and out
  for (let i = 0; i < 8; i++) {
    const f = (i - 3.5) / 3.5
    const a = f * 1.3
    const d = V(-Math.cos(a), 0, Math.sin(a))
    const side = V(d.z, 0, -d.x).multiplyScalar(Math.sign(f))
    const len = 0.58 - Math.abs(f) * 0.08
    const dip = i % 2 ? 0.015 : -0.015
    const base = V(0.1, -0.08, 0).addScaledVector(d, 0.05)
    const at = (t: number, up: number, out: number) => base.clone().addScaledVector(d, len * t).addScaledVector(side, out).add(V(0, up + dip, 0))
    const pts = [at(0, 0, 0), at(0.3, -0.05, 0.02), at(0.6, -0.04, -0.01), at(0.85, 0.0, 0.04), at(0.95, 0.06, 0.09), at(0.88, 0.1, 0.12)]
    k.part(ARM + i)
    const arm = new THREE.CatmullRomCurve3(pts, false, 'centripetal')
    k.add(tubeR(arm, (t) => 0.064 * (1 - t) ** 0.85 + 0.014, 14, 6), P)
    // suckers on the curl, where they show
    for (const t of [0.74, 0.86]) {
      const c = arm.getPointAt(t)
      k.add(sphere(6, 3), PL, T([c.x, c.y + 0.022 - t * 0.008, c.z], [0, 0, 0], 0.016 - t * 0.007), 0)
    }
  }
  k.part(HEAD)
  k.both(() => {
    bodyEye(k, head, [0.75, 0.32, 0.5], view, 0.4, { r: 0.08, lid: P, look: [0.2, 0.05], lashes: true })
  })
  // a cheeky smile on the front of the head, under the eyes
  k.push(FRONT)
  const hf = ellSurf(frontEll(head))
  k.layer(FACE.calm)
  smile(k, hf, 0, -0.04, 0.07, 0.04, 0.004, pen)
  k.layer(FACE.dizzy)
  ohMouth(k, hf, 0, -0.05, 0.035, 0.04, 0.005)
  k.layer(FACE.always)
  blush(k, hf, 0.13, -0.02, 0.04, 0.022)
  blush(k, hf, -0.13, -0.02, 0.04, 0.022)
  k.pop()
  return k.bake((p, _n, tag, m) => {
    if (tag >= ARM) {
      const i = tag - ARM
      const t = clamp01(Math.hypot(p.x - 0.1, p.z) / 0.58)
      m.w1.set(0, 0.03 * t, 0.06 * t, -3.2 * t + i * 0.8)
      // the jet: arms squeeze together and stream back
      m.pose.set(-0.14 * t, 0.02 * t, -0.55 * p.z * t)
    } else {
      m.w2.set(0.012 * (p.x - head.c[0]), 0.012 * (p.y - head.c[1]), 0.012 * p.z, 0)
      m.pose.set(0.05 + 0.15 * (p.x - head.c[0]), -0.03 * (p.y - head.c[1]), -0.12 * p.z)
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Manta ray                                                           */
/* ------------------------------------------------------------------ */

function buildManta(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const TOPC = '#3a5f9e'
  const EDGE = '#26447a'
  const BELLY = '#f4f8ff'
  // the wings: a flat disc swept back into pointed tips, white underneath
  const wing = warp(sphere(40, 16), (v) => {
    const t = Math.min(1, Math.abs(v.z))
    v.x = v.x * (1 - 0.72 * t ** 1.4) - 0.55 * t ** 1.7 + 0.12 * (1 - t) ** 2
    v.y = v.y * (1 - 0.7 * t)
  })
  wing.scale(0.3, 0.055, 0.5)
  k.part(WING)
  k.add(tint(wing, (x, y, z) => C(y < -0.004 ? BELLY : Math.abs(z) > 0.43 || x < -0.05 - 0.4 * Math.abs(z) ? EDGE : TOPC)), '#ffffff')
  // the body hump and the head
  k.part(BODY)
  const hump: Ell = { c: [0.03, 0.03, 0], r: [0.25, 0.07, 0.13] }
  ell(k, hump, TOPC, [22, 12])
  // shoulder chevrons and spots, painted on the back
  k.push(TOP)
  const back = surfOf(new THREE.SphereGeometry(1, 24, 12).applyMatrix4(T(topEll(hump).c, [0, 0, 0], topEll(hump).r)), 64)
  const wingTop = surfOf(wing.clone().applyMatrix4(TOP.clone().invert()), 96)
  const topS: Surf = (x, y) => Math.max(back(x, y), wingTop(x, y))
  k.both(() => {
    paint(k, topS, curve2([[0.12, -0.12], [0.02, -0.2], [-0.12, -0.3], [-0.06, -0.19], [0.04, -0.12]], 16), '#e9f2ff', 0.006, false)
  })
  for (const [x, y, r] of [[-0.08, 0.05, 0.016], [-0.12, -0.04, 0.013], [-0.03, -0.02, 0.012]] as const) paint(k, topS, oval(x, y, r, r, 0, 8), EDGE, 0.006)
  paint(k, topS, oval(0.12, 0.04, 0.07, 0.02, 0.2, 12), C('#cfe0ff'), 0.008, true)
  // the smile along the front edge
  k.layer(FACE.calm)
  stroke(k, topS, arc(0.2, 0, 0.06, 0.08, -Math.PI * 0.42, Math.PI * 0.42, 12), pen, 0.008)
  k.layer(FACE.dizzy)
  ohMouth(k, topS, 0.23, 0, 0.03, 0.035, 0.009)
  k.layer(FACE.always)
  k.pop()
  // the horns: two cephalic fins curling in at the front
  k.part(FLAP)
  k.both(() => k.add(tubeR(path3([[0.2, 0.01, 0.12], [0.3, 0.015, 0.125], [0.36, 0.01, 0.1], [0.36, 0.0, 0.07]]), (t) => 0.03 - t * 0.012, 12, 8), EDGE))
  // eyes on the sides of the head, looking up
  k.part(BODY)
  k.both(() => bodyEye(k, hump, [0.55, 0.5, 0.75], view, 0.5, { r: 0.045, lid: TOPC, look: [0.25, 0.1] }))
  // the tail
  k.part(TAIL)
  k.add(tubeR(path3([[-0.2, 0.0, 0], [-0.45, 0.005, 0], [-0.75, 0.01, 0]]), (t) => 0.02 * (1 - t) + 0.005, 18, 6), EDGE, undefined, INK_W * u * 0.6)
  k.add(fin(curve2([[-0.14, 0.0], [-0.2, 0.05], [-0.25, 0.0]], 8), 0.012, 1), EDGE, T([0, 0.06, 0]))
  return k.bake((p, _n, tag, m) => {
    const az = Math.abs(p.z)
    if (tag === WING || tag === BODY || tag === FLAP) {
      const w = smoothstep(0.08, 0.5, az)
      m.w1.set(-0.03 * w, 0.17 * w ** 1.3, 0, -2.6 * az)
    }
    if (tag === TAIL) {
      const t = clamp01((-0.2 - p.x) / 0.55)
      m.w2.set(0, 0.01 * t, 0.06 * t * t, -2.5 * t)
    }
    if (tag === FLAP) m.w2.set(0, 0.012, 0.01 * Math.sign(p.z), 0)
  })
}

/* ------------------------------------------------------------------ */
/*  Hammerhead                                                          */
/* ------------------------------------------------------------------ */

function buildShark(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const G = '#7f97ad'
  const GD = '#56708f'
  const W = '#f3f7fb'
  const body = new Spindle(curve2([[0, -0.44], [0.026, -0.42], [0.044, -0.34], [0.074, -0.2], [0.104, -0.03], [0.116, 0.1], [0.108, 0.22], [0.088, 0.31], [0.056, 0.36], [0, 0.385]], 22), 0.85, 24)
  // three crisp tones: a dark back, grey flanks, a white belly
  const tone = (phi: number) => C(phi > 0.5 && phi < Math.PI - 0.5 ? W : phi < -0.5 && phi > 0.5 - Math.PI ? GD : G)
  k.part(BODY)
  k.add(body.geometry((_x, phi) => tone(phi)), '#ffffff')
  // the hammer, its front edge sweeping back to the eyes at its tips
  const hammer = warp(sphere(26, 10), (v) => {
    v.x -= 0.55 * v.z * v.z
  })
  hammer.scale(0.08, 0.056, 0.3)
  hammer.translate(0.39, 0.012, 0)
  k.part(HEAD)
  // its top a shade lighter than the back, so the brows and eyes stand out on it
  k.add(tint(hammer, (_x, y) => C(y < -0.012 ? W : G)), '#ffffff')
  // fins
  k.part(BODY)
  edgedFin(k, curve2([[0.12, 0.08], [0.04, 0.28], [-0.06, 0.32], [-0.04, 0.2], [-0.1, 0.07]], 16), 0.032, G, GD, 0.028, T([0, 0, 0]))
  k.add(fin(curve2([[-0.25, 0.03], [-0.3, 0.1], [-0.33, 0.03]], 8), 0.02, 1), GD, T([0, 0, 0]))
  k.add(fin(curve2([[-0.23, -0.03], [-0.28, -0.09], [-0.31, -0.03]], 8), 0.02, 1), GD, T([0, 0, 0]))
  k.part(TAIL)
  edgedFin(k, curve2([[-0.37, 0.02], [-0.47, 0.14], [-0.57, 0.29], [-0.56, 0.11], [-0.51, 0.0], [-0.55, -0.11], [-0.5, -0.13], [-0.39, -0.03]], 18), 0.032, G, GD, 0.03, T([0, 0, 0]))
  k.part(FLAP)
  const pec = body.at(0.12, 0.85)
  k.both(() => edgedFin(k, curve2([[0, 0.05], [0.14, 0.035], [0.27, -0.04], [0.25, -0.085], [0.1, -0.065], [0, -0.04]], 16), 0.026, G, GD, 0.026, frameAt(pec.p, V(0.1, 1, 0.3).normalize(), V(-0.5, -0.2, 1))))
  k.part(BODY)
  // gill slits on both flanks
  k.both(() => {
    for (let i = 0; i < 3; i++) stroke(k, body.flank, arc(0.21 - i * 0.032, 0.0, 0.016, 0.045, -0.9, 0.9, 6), pen * 0.7, 0.003, '#3a5172', 0.3)
  })
  // big eyes on the hammer's tips, cross brows above them
  k.part(HEAD)
  const tip = 0.93
  const tipP = V(0.39 - 0.55 * tip * tip * 0.08, 0.03, 0.3 * tip)
  k.both(() => eye(k, frameAt(tipP, V(0.3, 1, 0.45).normalize().lerp(viewDir(view), 0.3).normalize()), { r: 0.064, lid: G, look: [0.32, 0.0], pupil: 0.6, ink: INK_W * u * 0.6 }))
  k.push(TOP)
  const hs: Surf = (x, y) => 0.056 * Math.sqrt(Math.max(0, 1 - ((x - 0.39 + 0.55 * (y / 0.3) ** 2 * 0.08) / 0.08) ** 2 - (y / 0.3) ** 2)) + 0.012
  // the bully's brows: thick, slanting in towards the snout
  for (const s of [1, -1]) stroke(k, hs, [[0.432, s * -0.158], [0.402, s * -0.19], [0.366, s * -0.206]], pen * 2.2, 0.006, INK, 0.3)
  k.pop()
  return k.bake((p, _n, tag, m) => {
    swim(p, { x0: 0.12, tail: -0.58, amp: 0.08, k: 2, head: 0.18 }, m)
    if (tag === FLAP) m.w2.set(0, 0.12 * Math.hypot(p.x - pec.p.x, Math.abs(p.z) - pec.p.z), 0, 0)
  })
}

/* ------------------------------------------------------------------ */
/*  The Golden Whale                                                    */
/* ------------------------------------------------------------------ */

function buildWhale(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const GOLD = '#ffc93c'
  const DEEP = '#f4a722'
  const CREAM = '#fff1bd'
  const body = new Spindle(curve2([[0, -0.44], [0.04, -0.41], [0.075, -0.31], [0.14, -0.16], [0.21, 0.0], [0.25, 0.14], [0.256, 0.25], [0.235, 0.35], [0.18, 0.43], [0.09, 0.47], [0, 0.48]], 28), 0.92, 28)
  const belly = (x: number, phi: number) => phi > 0.55 && phi < Math.PI - 0.55 && x > -0.24
  k.part(BODY)
  k.add(body.geometry((x, phi) => C(belly(x, phi) ? CREAM : GOLD)), '#ffffff', undefined, undefined, { shine: 1 })
  const bs = body.flank
  const flankY = (x: number, phi: number) => -body.radius(x) * Math.sin(phi)
  // grooves along the cream throat, on both sides
  k.both(() => {
    for (let i = 0; i < 4; i++) {
      const phi = 0.8 + i * 0.2
      stroke(k, bs, Array.from({ length: 12 }, (_, j): P2 => {
        const x = 0.42 - j * 0.05
        return [x, flankY(x, phi)]
      }), pen * 0.6, 0.003, '#e9bd5c', 0.15)
    }
  })
  // flukes and flippers
  k.part(TAIL)
  const fluke = curve2([[-0.38, 0.0], [-0.46, 0.1], [-0.56, 0.23], [-0.62, 0.18], [-0.58, 0.07], [-0.61, 0.0], [-0.58, -0.07], [-0.62, -0.18], [-0.56, -0.23], [-0.46, -0.1]], 26)
  k.add(fin(fluke, 0.035), DEEP, T([0, 0, 0], [-Math.PI / 2, 0, 0]), undefined, { shine: 0.6 })
  k.part(FLAP)
  const pec = body.at(0.14, 0.62)
  k.both(() => k.add(fin(curve2([[0, 0.05], [0.12, 0.07], [0.25, 0.05], [0.31, 0.0], [0.28, -0.05], [0.12, -0.06], [0, -0.04]], 14), 0.032), DEEP, frameAt(pec.p, V(0, 1, 0.35).normalize(), V(-0.4, -0.4, 1)), undefined, { shine: 0.6 }))
  k.part(BODY)
  // the face: big gentle eyes, a wide happy smile round the front of the head, rosy cheeks
  k.both(() => {
    const e = body.at(0.33, -0.32)
    eye(k, frameAt(e.p, e.n.lerp(viewDir(view), 0.3).normalize()), { r: 0.07, lid: GOLD, look: [0.32, 0.1], lashes: true })
    blush(k, bs, 0.36, flankY(0.36, 0.05), 0.038, 0.02, '#ff9d7a')
    const mouth: P2[] = [[0.462, -0.05], [0.448, 0.12], [0.415, 0.24], [0.36, 0.28], [0.305, 0.22], [0.275, 0.08]].map(([x, phi]): P2 => [x, flankY(x, phi)])
    k.layer(FACE.calm)
    stroke(k, bs, curve2(mouth, 18), pen * 1.4, 0.005)
    k.layer(FACE.dizzy)
    ohMouth(k, bs, 0.41, flankY(0.41, 0.2), 0.03, 0.034, 0.006)
    k.layer(FACE.always)
  })
  // the blowhole and sparkles on its back
  k.push(TOP)
  paint(k, body.back, oval(0.12, 0, 0.018, 0.03, 0, 10), '#a5600f', 0.004, true)
  for (const [x, y, r] of [[0.0, 0.1, 0.034], [-0.1, -0.07, 0.028], [0.06, -0.13, 0.022], [-0.22, 0.04, 0.024]] as const) paint(k, body.back, star(x, y, r, r * 0.3, 4), C('#fffbe8', 1.3), 0.005, true, undefined, 1, Infinity, { glow: 0.3 })
  k.pop()
  // a little gold crown set at a jaunty tilt on its brow, its gems facing us
  k.push(T([0.27, body.radius(0.27) - 0.028, 0], [0.18, 0, -0.38], 1.35))
  k.add(new THREE.CylinderGeometry(0.075, 0.068, 0.05, 22), '#ffd84a', undefined, undefined, { shine: 1 })
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + Math.PI / 2
    horn(k, [Math.cos(a) * 0.066, 0.02, Math.sin(a) * 0.066], [Math.cos(a) * 0.076, 0.09, Math.sin(a) * 0.076], 0.03, '#ffd84a', undefined, 6, { shine: 1 })
    ell(k, { c: [Math.cos(a) * 0.077, 0.095, Math.sin(a) * 0.077], r: [0.014, 0.014, 0.014] }, '#fff4c0', [8, 6], undefined, [0, 0, 0], { shine: 1 })
  }
  for (const [a, c] of [[Math.PI / 2, '#ff3f6a'], [Math.PI / 2 + 0.75, '#3fd7ff'], [Math.PI / 2 - 0.75, '#3fd7ff']] as const) ell(k, { c: [Math.cos(a) * 0.077, 0.0, Math.sin(a) * 0.077], r: [0.016, 0.018, 0.01] }, c, [8, 6], 0.004, [0, -a + Math.PI / 2, 0])
  k.pop()
  return k.bake((p, _n, tag, m) => {
    swim(p, { x0: 0.05, tail: -0.62, amp: 0.06, k: 1.8, head: 0.12, axis: 'y' }, m)
    if (tag === FLAP) m.w2.set(0.05, 0.25 * Math.hypot(p.x - pec.p.x, p.y - pec.p.y, Math.abs(p.z) - pec.p.z), 0, 0)
  })
}

/* ------------------------------------------------------------------ */
/*  Bomb crab                                                           */
/* ------------------------------------------------------------------ */

function buildCrab(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const R = '#ff4b3e'
  const RD = '#d9332a'
  const RL = '#ff8b70'
  const shell: Ell = { c: [0, 0, 0], r: [0.3, 0.13, 0.22] }
  const ss = ellSurf(shell)
  k.part(BODY)
  ell(k, shell, R, [22, 14])
  k.push(TOP)
  for (const [x, y, r] of [[-0.16, 0.06, 0.03], [0.17, 0.04, 0.026], [0.12, -0.1, 0.02], [-0.12, -0.11, 0.022]] as const) paint(k, ellSurf(topEll(shell)), oval(x, y, r, r * 0.8, 0, 10), RL, 0.003)
  k.pop()
  // legs: three a side, bent down to points
  for (const s of [1, -1])
    for (let i = 0; i < 3; i++) {
      const z = 0.06 - i * 0.1
      k.part(LEG + i * 2 + (s > 0 ? 0 : 1))
      k.add(tubeR(path3([[s * 0.24, -0.02, z], [s * 0.38, 0.04, z * 1.2], [s * 0.47, -0.04, z * 1.35], [s * 0.5, -0.14, z * 1.4]]), (t) => 0.034 * (1 - t) + 0.01, 6, 5), i === 1 ? R : RD)
    }
  // claws: raised in front, ready to snap
  k.part(CLAW)
  for (const s of [1, -1]) {
    limb(k, [s * 0.22, 0.0, 0.12], [s * 0.32, 0.06, 0.24], 0.04, RD)
    const c: P3 = [s * 0.33, 0.12, 0.31]
    ell(k, { c, r: [0.09, 0.075, 0.065] }, R, [12, 9], undefined, [0, 0, s * 0.3])
    for (const sd of [-1, 1]) {
      const g = tubeR(path3([[c[0] + sd * 0.04, c[1] + 0.04, c[2]], [c[0] + sd * 0.065, c[1] + 0.11, c[2] + 0.01], [c[0] + sd * 0.03, c[1] + 0.17, c[2] + 0.02], [c[0] + sd * 0.008, c[1] + 0.175, c[2] + 0.02]]), (t) => (0.04 * (1 - t) ** 0.8 + 0.008) * (sd === s ? 1 : 0.85), 6, 6)
      k.add(tint(g, (_x, y) => C(y > c[1] + 0.14 ? '#9c2a1c' : sd === s ? R : RD)), '#ffffff')
    }
    paint(k, ellSurf({ c, r: [0.09, 0.075, 0.065] }), oval(c[0] - 0.03, c[1] + 0.025, 0.018, 0.03, -0.3, 10), SHINE, 0.003, true, undefined, 1)
  }
  // the bomb on its back: a black ball with a brass cap and a lit fuse
  k.part(BODY)
  const bomb: Ell = { c: [0, 0.2, -0.05], r: [0.16, 0.16, 0.16] }
  ell(k, bomb, '#2a2740', [18, 12])
  k.push(frameAt(V(...bomb.c), viewDir(view)))
  paint(k, ellSurf({ c: [0, 0, 0], r: [0.16, 0.16, 0.16] }), oval(-0.06, 0.06, 0.04, 0.022, 0.7, 12), C('#9a9ac8'), 0.004, true)
  paint(k, ellSurf({ c: [0, 0, 0], r: [0.16, 0.16, 0.16] }), oval(-0.085, 0.03, 0.012, 0.012, 0, 8), C('#d8d8ff'), 0.005, true)
  k.pop()
  k.add(new THREE.CylinderGeometry(0.05, 0.055, 0.05, 14), '#d9a640', T([0.04, 0.35, -0.03], [0, 0, -0.25]), undefined, { shine: 0.8 })
  k.part(FUSE)
  k.add(tubeR(path3([[0.05, 0.37, -0.03], [0.09, 0.43, -0.02], [0.08, 0.49, 0.0], [0.12, 0.53, 0.02]]), () => 0.014, 10, 6), '#c7a46a', undefined, INK_W * u * 0.6)
  // the spark: a flickering star
  k.push(frameAt(V(0.125, 0.545, 0.025), viewDir(view)))
  k.add(fin(star(0, 0, 0.065, 0.028, 6), 0.01, 1), C('#ffb43c', 1.25), undefined, 0, { flat: true, glow: 1 })
  k.add(fin(star(0, 0, 0.038, 0.017, 6, 0.3), 0.016, 1), C('#fff4b0', 1.4), undefined, 0, { flat: true, glow: 1 })
  k.pop()
  // eyes on stalks
  k.part(STALK)
  for (const s of [1, -1]) limb(k, [s * 0.07, 0.06, 0.14], [s * 0.1, 0.22, 0.19], 0.022, R)
  for (const s of [1, -1]) ballEye(k, [s * 0.105, 0.27, 0.205], 0.07, viewDir(view).add(V(0, 0, 0.2)), { lid: R, look: [0.0, -0.1] }, INK_W * u * 0.7)
  // a mischievous grin on the front
  k.part(BODY)
  k.layer(FACE.calm)
  const grin: P2[] = [...arc(0, 0.0, 0.085, 0.06, Math.PI * 1.05, Math.PI * 1.95, 14)]
  inked(k, ss, grin, MOUTH, 0.004, pen * 0.4, true, [0, -0.03])
  paint(k, ss, [[0.03, -0.012], [0.06, -0.012], [0.045, -0.035]], '#ffffff', 0.007, true, undefined, 1)
  k.layer(FACE.dizzy)
  ohMouth(k, ss, 0, -0.03, 0.04, 0.035, 0.005)
  k.layer(FACE.always)
  blush(k, ss, -0.15, -0.02, 0.04, 0.02, '#ff8a9a')
  blush(k, ss, 0.15, -0.02, 0.04, 0.02, '#ff8a9a')
  return k.bake((p, _n, tag, m) => {
    m.w1.set(0, 0.008, 0, 0)
    if (tag >= LEG) {
      const i = tag - LEG
      const d = clamp01((Math.abs(p.x) - 0.24) / 0.26)
      const ph = (i >> 1) * Math.PI * 0.66 + (i & 1) * Math.PI
      m.w1.set(0, 0.06 * d, 0, ph)
      m.w2.set(0.05 * d * Math.sign(p.x), 0, 0, ph + Math.PI / 2)
    } else if (tag === CLAW) m.w2.set(0, 0.02 * clamp01((p.y + 0.0) / 0.25), 0.01, Math.sign(p.x) * 0.8)
    else if (tag === STALK) m.w2.set(0.015 * clamp01((p.y - 0.08) / 0.2), 0, 0, Math.sign(p.x) * 1.4)
    else if (tag === FUSE) m.w2.set(0.01 * clamp01((p.y - 0.36) / 0.2), 0, 0.008, 0)
  })
}

/* ------------------------------------------------------------------ */
/*  Zap jelly                                                           */
/* ------------------------------------------------------------------ */

function buildJelly(u: number, view: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const CY = '#7ef0ff'
  const CD = '#33bde0'
  const bellE: Ell = { c: [0, 0.1, 0], r: [0.3, 0.28, 0.3] }
  // the bell: a dome lit from within, scalloped round the rim
  k.part(BELL)
  const dome = new THREE.SphereGeometry(1, 20, 8, 0, TAU, 0, Math.PI / 2)
  k.add(shade(dome, (_x, y) => C(CY).lerp(C('#d8fbff'), y * 0.8)), '#ffffff', T(bellE.c, [0, 0, 0], bellE.r), undefined, { glow: 0.35 })
  k.add(new THREE.CircleGeometry(0.29, 24), '#2a9fc8', T([0, 0.1, 0], [Math.PI / 2, 0, 0]), 0, { glow: 0.5 })
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU
    ell(k, { c: [Math.cos(a) * 0.285, 0.095, Math.sin(a) * 0.285], r: [0.05, 0.035, 0.05] }, CD, [8, 5], undefined, [0, -a, 0], { glow: 0.2 })
  }
  // a lightning bolt on the crown, and a glowing heart
  k.push(TOP)
  const crown = ellSurf(topEll(bellE))
  const bolt: P2[] = [[-0.02, 0.11], [0.06, 0.11], [0.0, 0.02], [0.06, 0.02], [-0.06, -0.12], [-0.01, -0.02], [-0.06, -0.02]]
  inked(k, crown, bolt, C('#ffe14a', 1.15), 0.006, pen * 0.4, true)
  k.pop()
  // trailing arms and tentacles
  k.part(TENT)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4
    const x = Math.cos(a) * 0.08
    const z = Math.sin(a) * 0.08
    k.add(tubeR(path3([[x, 0.1, z], [x * 1.4 + 0.03, -0.08, z * 1.4], [x * 1.2 - 0.04, -0.26, z * 1.2], [x * 1.5 + 0.02, -0.42, z * 1.5]]), (t) => 0.04 * (1 - t) + 0.015 + 0.012 * Math.sin(t * 20), 14, 5), '#c9a8ff', undefined, undefined, { glow: 0.15 })
  }
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.2
    const x = Math.cos(a) * 0.25
    const z = Math.sin(a) * 0.25
    k.add(tubeR(path3([[x, 0.09, z], [x * 1.05, -0.1, z * 1.05], [x * 0.95 + 0.03, -0.3, z * 0.95], [x * 1.1, -0.52, z * 1.1]]), (t) => 0.013 * (1 - t) + 0.006, 12, 4), '#a6f4ff', undefined, INK_W * u * 0.55, { glow: 0.25 })
  }
  // the face on the front of the bell
  k.part(BELL)
  const bs = ellSurf(bellE)
  for (const s of [1, -1]) eye(k, frameAt(onEll(bellE, V(s * 0.3, 0.35, 0.9)).p, onEll(bellE, V(s * 0.3, 0.35, 0.9)).n.lerp(viewDir(view), 0.3).normalize()), { r: 0.07, lid: CY, look: [0, 0.05] })
  blush(k, bs, -0.17, 0.19, 0.04, 0.022, '#ff9ad0')
  blush(k, bs, 0.17, 0.19, 0.04, 0.022, '#ff9ad0')
  k.layer(FACE.calm)
  smile(k, bs, 0, 0.19, 0.05, 0.03, 0.004, pen)
  k.layer(FACE.dizzy)
  ohMouth(k, bs, 0, 0.17, 0.03, 0.035, 0.005)
  k.layer(FACE.always)
  return k.bake((p, _n, tag, m) => {
    if (tag === BELL) {
      // the pulse: the rim squeezes in, the crown rises
      const rim = 1 - clamp01((p.y - 0.1) / 0.28)
      m.w1.set(-p.x * 0.16 * rim, 0.025, -p.z * 0.16 * rim, 0)
    } else {
      const d = clamp01((0.1 - p.y) / 0.62)
      m.w1.set(-p.x * 0.1 * (1 - d), 0.02, -p.z * 0.1 * (1 - d), -2.6 * d)
      m.w2.set(0.07 * d, 0, 0.03 * d, -3 * d + Math.atan2(p.z, p.x))
    }
  })
}

/* ------------------------------------------------------------------ */
/*  Treasure chest                                                      */
/* ------------------------------------------------------------------ */

function buildChest(u: number) {
  const k = new RKit(INK, INK_W * u)
  const pen = PEN_W * u
  const WOOD = '#c27a34'
  const WOODL = '#d98f45'
  const GRAIN = '#8a4f22'
  const GOLD = '#ffcf3a'
  const W = 0.72
  const H = 0.32
  const D = 0.46
  const top = 0.06
  const front = D / 2 + 0.03
  // the box: rounded planks with grain lines, gold straps and corner caps
  k.part(BODY)
  k.add(slab(rrect(0, top - H / 2, W, H, 0.05), D, 0.03, 4, 2), WOOD)
  for (const y of [top - 0.11, top - 0.21]) stroke(k, flatSurf(front), [[-W / 2 + 0.03, y], [W / 2 - 0.03, y]], pen * 0.8, 0.002, GRAIN, 0.05)
  for (const x of [-0.24, 0.24]) k.add(slab(rrect(x, top - H / 2, 0.08, H + 0.02, 0.02), D + 0.04, 0.012, 3), GOLD, undefined, undefined, { shine: 1 })
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ell(k, { c: [sx * (W / 2 + 0.005), top - H + 0.04, sz * (D / 2 + 0.005)], r: [0.05, 0.05, 0.05] }, GOLD, [10, 8], undefined, [0, 0, 0], { shine: 1 })
  // the lock: a gold shield with a keyhole and a star
  const shield: P2[] = curve2([[-0.075, 0.07], [0.075, 0.07], [0.075, -0.02], [0.0, -0.1], [-0.075, -0.02]], 16)
  k.add(slab(shield, 0.03, 0.01, 3), GOLD, T([0, top - 0.06, front - 0.005]), undefined, { shine: 1 })
  paint(k, flatSurf(front + 0.022), oval(0, top - 0.045, 0.018, 0.018, 0, 10), INK, 0, true)
  paint(k, flatSurf(front + 0.022), [[-0.01, top - 0.055], [0.01, top - 0.055], [0.007, top - 0.1], [-0.007, top - 0.1]], INK, 0, true)
  // the loot inside: a heap of gold and gems, glowing (it rises a little when the lid flies open)
  k.part(LOOT)
  for (let i = 0; i < 10; i++) {
    const x = -0.27 + (i % 5) * 0.135
    const z = (i < 5 ? -0.06 : 0.08) + Math.sin(i * 1.7) * 0.03
    ell(k, { c: [x, top + 0.01 + Math.sin(i * 2.3) * 0.015, z], r: [0.09, 0.05, 0.08] }, GOLD, [8, 5], undefined, [0, 0, 0], { shine: 1 })
  }
  for (const [x, z, c] of [[0.1, 0.06, '#3fd7ff'], [-0.15, 0.1, '#ff3f7a'], [0.24, 0.0, '#7cff6b']] as const) ell(k, { c: [x, top + 0.06, z], r: [0.04, 0.045, 0.04] }, c, [8, 6], undefined, [0, 0, 0], { glow: 0.5 })
  // the light glowing up out of it
  k.add(new THREE.BoxGeometry(W - 0.08, 0.02, D - 0.06), C('#fff0a0', 1.35), T([0, top - 0.005, 0]), 0, { flat: true, glow: 1 })
  // coins spilling over the front edge
  k.part(BODY)
  for (const [x, y, a] of [[-0.14, top + 0.01, 0.35], [0.06, top + 0.0, -0.3], [0.2, top - 0.02, 0.6]] as const) k.add(new THREE.CylinderGeometry(0.05, 0.05, 0.016, 16), GOLD, T([x, y, D / 2 + 0.02], [Math.PI / 2 - 0.35, a, 0]), undefined, { shine: 1 })
  // the lid: a solid half barrel hinged at the back, standing open so the treasure shows from above
  k.part(LID)
  const hinge = V(0, top + 0.012, -D / 2)
  const turn = (a: number) => new THREE.Matrix4().makeTranslation(hinge.x, hinge.y, hinge.z).multiply(new THREE.Matrix4().makeRotationX(a)).multiply(new THREE.Matrix4().makeTranslation(-hinge.x, -hinge.y, -hinge.z))
  // a half disc in (z, y), pushed out along x
  const arch = (r: number): P2[] => Array.from({ length: 17 }, (_, i): P2 => [Math.cos((i / 16) * Math.PI) * r, Math.sin((i / 16) * Math.PI) * r])
  const along = (x: number) => new THREE.Matrix4().makeTranslation(x, top + 0.012, 0).multiply(new THREE.Matrix4().makeRotationY(-Math.PI / 2))
  k.push(turn(-0.95))
  k.add(slab(arch(D / 2), W, 0.02, 4, 2), WOODL, along(0))
  for (const x of [-0.24, 0.24]) k.add(slab(arch(D / 2 + 0.016), 0.08, 0.01, 3), GOLD, along(x), undefined, { shine: 1 })
  k.add(slab(rrect(0, 0, 0.12, 0.05, 0.02), 0.03, 0.008, 3), GOLD, T([0, top + 0.012 + D / 2 + 0.01, 0], [Math.PI / 2, 0, 0]), undefined, { shine: 1 })
  k.pop()
  // a barnacle or two and a strand of weed
  k.part(BODY)
  for (const [x, y, z] of [[-0.33, top - 0.22, 0.2], [0.34, top - 0.26, -0.1], [-0.3, top - 0.27, -0.2]] as const) horn(k, [x, y, z], [x * 1.08, y + 0.02, z * 1.08], 0.03, '#e8e1d0', undefined, 7)
  k.add(tubeR(path3([[0.3, top + 0.02, 0.2], [0.36, top - 0.06, 0.25], [0.33, top - 0.16, 0.27], [0.38, top - 0.26, 0.26]]), (t) => 0.018 * (1 - t) + 0.008, 12, 6), '#4fbf6a')
  // the pose flings the lid the rest of the way open
  const open = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -0.95)
  const tmp = V()
  return k.bake((p, _n, tag, m) => {
    m.w2.set(0, 0.03, 0, 0)
    if (tag === LID) {
      m.w1.set(0, 0.008 * clamp01((p.z + D / 2) / D), 0, 0)
      tmp.copy(p).sub(hinge).applyQuaternion(open).add(hinge)
      m.pose.copy(tmp).sub(p)
    } else if (tag === LOOT) m.pose.set(0, 0.06, 0)
  })
}

/* ------------------------------------------------------------------ */

const BUILD: Record<FishId, (u: number, view: number) => THREE.BufferGeometry> = {
  clown: buildClown,
  tang: buildTang,
  puffer: buildPuffer,
  angel: buildAngel,
  seahorse: buildSeahorse,
  turtle: buildTurtle,
  octopus: buildOctopus,
  manta: buildManta,
  shark: buildShark,
  whale: buildWhale,
  crab: buildCrab,
  jelly: buildJelly,
  chest: buildChest,
}

/** builds a creature's geometry for drawing `size` reef units big (outlines and pens sized to match), seen from `view` */
export function buildCreature(id: FishId, size: number, view: number) {
  return BUILD[id](1 / size, view)
}

