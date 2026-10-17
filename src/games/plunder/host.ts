import * as THREE from 'three'
import { T, VKit, ellipsePts, type Ell, type P2, type P3 } from '../../lib/three/toon'
import { clipY, curve2 } from './kit'
import { INK, PUPIL, SHINE, SPARK, TAU, V, arc, domeEyes, ellSurf, happyEyes, joint, lathe, limb, oval, paint, path3, restOf, slab, sphere, stroke, toRest, tubeR, type Eye } from './kit'
import { castMaterial } from './mats'
import { BEAK, BEAK_LO, BRASS, BRASS_D, MACAW_B, RED, TONGUE_C, TOOTH_GOLD, along, bicorne, flatDecal, frameAt, jolly, macawWing, stripPts } from './pieces'

/*
  Captain Polly, the host: a scarlet macaw in a bicorne and an eyepatch who perches on top of the reel frame. She is
  built like the cast (VKit toon meshes, ink outline merged in) but in more detail, in the stage material (unclipped).
  The rig's origin is between her feet on the perch; she faces +z and stands 1 unit tall to the top of her hat.
  poseHost() runs her idle and her canned actions; every joint keeps its rest pose in userData.rest.
*/

export interface HostRig {
  /** origin between her feet on the perch, facing +z; 1 unit tall to the top of the hat */
  root: THREE.Group
  /** pivots at the hips: lean (rotation.x forward, .z sideways), bob and hop (position.y) */
  body: THREE.Group
  /** pivots at the neck: nod (rotation.x, + = down), tilt (rotation.z), turn (rotation.y) */
  head: THREE.Group
  /** the bicorne, pivoting at the crown: tip it (rotation.z / .x), lift it (position.y) */
  hat: THREE.Group
  /** the open eye: scale.y to blink */
  eye: THREE.Group
  /** the happy closed eye (^), hidden; show it instead of `eye` */
  joy: THREE.Object3D
  /** the startled eye (wide, tiny pupil), hidden; show it instead of `eye` */
  wow: THREE.Object3D
  /** the cocky brow over the open eye: raise it (position.y), knit it (rotation.z) */
  brow: THREE.Group
  /** the lower beak: rotation.x opens it (0.5 is wide) */
  jaw: THREE.Group
  /** wings at the shoulders, folded at rest; rotation.z raises them: wingR positive, wingL negative (about 2.6 is straight up) */
  wingL: THREE.Group
  wingR: THREE.Group
  /** tail feathers, pivoting at the rump: rotation.z wags */
  tail: THREE.Group
  /** props, hidden until an action needs them: a spyglass and a shovel in the right wing, a little map in the left */
  props: { spyglass: THREE.Object3D; shovel: THREE.Object3D; map: THREE.Object3D }
  /** where a speech bubble's tail should point (follows the head): just off the beak, up and to her left */
  bubble: THREE.Object3D
  /** the tip of the beak (follows the jaw's parent, the head), for squawk puffs */
  beakTip: THREE.Object3D
}

const HOST_INK = 0.014
const WING_L = 0.38

function hostWing(s: -1 | 1, mat: THREE.Material) {
  const sh: P3 = [s * 0.165, 0.47, 0.04]
  const k = new VKit(INK, HOST_INK)
  // folded down her side, the feathers spread a little
  macawWing(k, frameAt(sh, V(s * 0.42, -1, 0.12), s < 0, s * 0.35), WING_L, 0.11, 5)
  const mesh = k.mesh(s < 0 ? 'wingL' : 'wingR', mat)
  return { sh, mesh }
}

/** where a prop sits in a wing (in the body's frame): at the wing tip, along the folded wing */
function wingTip(s: -1 | 1, along = 0.88): P3 {
  const d = V(s * 0.42, -1, 0.12).normalize()
  return [s * 0.165 + d.x * WING_L * along, 0.47 + d.y * WING_L * along, 0.04 + d.z * WING_L * along + 0.05]
}

/** Captain Polly at her perch; see HostRig */
export function buildHost(): HostRig {
  const mat = castMaterial(true)
  const root = new THREE.Group()
  root.name = 'polly'

  // legs and feet, gripping the perch (static, in the root)
  const f = new VKit(INK, HOST_INK)
  for (const s of [-1, 1]) {
    limb(f, [s * 0.07, 0.14, 0.0], [s * 0.08, 0.035, 0.03], 0.026, '#a693a8')
    for (const d of [-1, 0, 1]) limb(f, [s * 0.08, 0.03, 0.03], [s * 0.08 + d * 0.035, 0.0, 0.1], 0.017, '#a693a8', 0.011)
    limb(f, [s * 0.08, 0.03, 0.03], [s * 0.08, 0.005, -0.04], 0.016, '#a693a8', 0.011)
    for (const d of [-1, 0, 1]) f.add(new THREE.SphereGeometry(0.012, 6, 4), '#3b2a3f', T([s * 0.08 + d * 0.037, -0.006, 0.11]), 0)
  }
  root.add(f.mesh('feet', mat))

  // the body
  const b = new VKit(INK, HOST_INK)
  const torso: Ell = { c: [0, 0.33, 0], r: [0.2, 0.25, 0.18] }
  const tf = ellSurf(torso)
  b.add(sphere(22, 16), RED, T(torso.c, [0, 0, 0], torso.r))
  paint(b, tf, oval(0.0, 0.29, 0.12, 0.15), '#ff7a63', 0.003)
  for (const [x, y] of [
    [-0.05, 0.33],
    [0.05, 0.33],
    [0.0, 0.27],
    [-0.05, 0.21],
    [0.05, 0.21],
  ])
    stroke(b, tf, arc(x, y, 0.03, 0.02, Math.PI * 1.15, Math.PI * 1.85, 6), 0.008, 0.005, '#e5513f', 0.3, false)
  // a gold doubloon on a chain round her neck
  b.add(new THREE.TorusGeometry(0.13, 0.008, 4, 28, Math.PI * 0.9), '#ffcf4a', T([0, 0.515, 0.04], [Math.PI / 2 - 0.35, 0, Math.PI * 1.05]), 0.008)
  const coinAt: P3 = [0, 0.43, 0.175]
  b.add(new THREE.CylinderGeometry(0.048, 0.048, 0.018, 18), TOOTH_GOLD, T(coinAt, [Math.PI / 2 - 0.25, 0, 0]), 0.01)
  jolly(b, T(coinAt, [-0.25, 0, 0]), 0, 0.004, 0.017, 0.0105, '#a8660f', true)
  // the tail, behind
  const tl = new VKit(INK, HOST_INK)
  limb(tl, [0.0, 0.14, -0.12], [0.03, -0.24, -0.16], 0.04, MACAW_B)
  limb(tl, [-0.03, 0.14, -0.1], [-0.1, -0.2, -0.13], 0.034, RED)
  limb(tl, [0.03, 0.14, -0.1], [0.12, -0.2, -0.13], 0.034, RED)
  const tail = joint('tail', [0, 0.14, -0.11], tl.mesh('', mat))

  // the head
  const h = new VKit(INK, HOST_INK)
  const skull: Ell = { c: [0, 0.69, 0.02], r: [0.222, 0.205, 0.198] }
  const hf = ellSurf(skull)
  h.add(sphere(22, 16), RED, T(skull.c, [0, 0, 0], skull.r))
  for (const s of [-1, 1]) paint(h, hf, oval(s * 0.098, 0.7, 0.088, 0.08, s * 0.2), '#fff2ea', 0.002)
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) stroke(h, hf, [[s * (0.055 + i * 0.024), 0.645 - i * 0.004], [s * (0.06 + i * 0.024), 0.632 - i * 0.004]], 0.007, 0.004, '#e8877a', 0.3, false)
  paint(h, hf, oval(-0.1, 0.703, 0.066, 0.058, -0.15), INK, 0.004, true)
  paint(h, hf, oval(-0.117, 0.72, 0.02, 0.012, -0.5), '#51476d', 0.006, true)
  stroke(h, hf, [[-0.045, 0.745], [0.035, 0.79], [0.12, 0.83]], 0.016, 0.004, INK, 0.1)
  stroke(h, hf, [[-0.15, 0.69], [-0.198, 0.676]], 0.016, 0.004, INK, 0.1)
  paint(h, hf, oval(-0.13, 0.8, 0.035, 0.014, 0.6), SHINE, 0.004, true)
  // crest feathers peeking out under the hat at the back
  for (const [x, a] of [
    [-0.06, 0.5],
    [0.0, 0.15],
    [0.06, -0.25],
  ])
    limb(h, [x, 0.8, -0.1], [x - Math.sin(a) * 0.09, 0.8 + Math.cos(a) * 0.07, -0.17], 0.022, RED, 0.012)
  // the upper beak, a fat hook
  const up = tubeR(path3([[0, 0.665, 0.13], [0, 0.678, 0.2], [0, 0.645, 0.258], [0, 0.588, 0.27], [0, 0.545, 0.238]]), (t) => 0.074 * Math.pow(1 - t, 0.6) + 0.006, 16, 12)
  up.applyMatrix4(new THREE.Matrix4().makeScale(1.05, 1, 1))
  h.add(up, BEAK)
  h.add(new THREE.SphereGeometry(1, 6, 4), SHINE, T([-0.034, 0.69, 0.222], [0.7, 0.3, 0.25], [0.011, 0.028, 0.005]), 0, true)
  const headMesh = h.mesh('', mat)

  const eyes: Eye[] = [{ x: 0.1, y: 0.703, rx: 0.058, ry: 0.067, look: [-0.12, 0.02], pupil: 0.6 }]
  const e = new VKit(INK, HOST_INK)
  const ec = domeEyes(e, hf, eyes, 0.008)
  const eye = joint('eye', ec, e.mesh('', mat))
  const j = new VKit(INK, HOST_INK)
  happyEyes(j, hf, eyes, 0.008, 0.02)
  const joy = j.mesh('joy', mat)
  joy.visible = false
  const w = new VKit(INK, HOST_INK)
  const ball: Ell = { c: [eyes[0].x, eyes[0].y, hf(eyes[0].x, eyes[0].y) - 0.03], r: [0.066, 0.076, 0.05] }
  w.add(new THREE.SphereGeometry(1, 14, 6, 0, TAU, 0, Math.PI / 2), '#ffffff', T(ball.c, [Math.PI / 2, 0, 0], [ball.r[0], ball.r[2], ball.r[1]]), 0.008)
  w.decal(ball, ellipsePts(eyes[0].x - 0.004, eyes[0].y, 0.02, 0.022, 14), PUPIL, 0.003, 0)
  w.decal(ball, ellipsePts(eyes[0].x - 0.01, eyes[0].y + 0.008, 0.006, 0.006, 8), SPARK, 0.006, 0)
  const wow = w.mesh('wow', mat)
  wow.visible = false
  const br = new VKit(INK, HOST_INK)
  stroke(br, hf, [[0.052, 0.77], [0.102, 0.787], [0.15, 0.77]], 0.021, 0.007, INK, 0.25)
  const brow = joint('brow', [0.1, 0.78, 0.17], br.mesh('', mat))

  // the lower beak, which opens
  const lo = new VKit(INK, HOST_INK)
  const lb = tubeR(path3([[0, 0.615, 0.13], [0, 0.588, 0.19], [0, 0.574, 0.218]]), (t) => 0.052 * (1 - t) + 0.013, 10, 10)
  lb.applyMatrix4(new THREE.Matrix4().makeScale(1.15, 1, 1))
  lo.add(lb, BEAK_LO)
  lo.add(new THREE.SphereGeometry(0.032, 10, 8), TONGUE_C, T([0, 0.598, 0.18], [0, 0, 0], [1, 0.7, 1.1]), 0)
  const jaw = joint('jaw', [0, 0.628, 0.13], lo.mesh('', mat))

  // the hat, with a white plume
  const ht = new VKit(INK, HOST_INK)
  const hatM = T([0, 0.835, 0.0], [-0.1, 0, -0.12])
  bicorne(ht, hatM, 0.33, 0.2)
  plumeFeather(ht, T([0.17, 0.9, -0.05], [0, -0.5, 0.35]))
  const hat = joint('hat', [0, 0.88, 0.0], ht.mesh('', mat))

  const bubble = new THREE.Object3D()
  bubble.name = 'bubble'
  bubble.position.set(-0.32, 1.0, 0.1)
  const beakTip = new THREE.Object3D()
  beakTip.name = 'beakTip'
  beakTip.position.set(0, 0.55, 0.26)
  const head = joint('head', [0, 0.52, 0.02], headMesh, eye, joy, wow, brow, jaw, hat, bubble, beakTip)

  // wings and their props
  const wr = hostWing(1, mat)
  const wl = hostWing(-1, mat)
  const props = buildProps(mat)
  const tipR = wingTip(1)
  props.spyglass.position.set(...tipR)
  props.shovel.position.set(...tipR)
  props.map.position.set(...wingTip(-1))
  const wingR = joint('wingR', wr.sh, wr.mesh, props.spyglass, props.shovel)
  const wingL = joint('wingL', wl.sh, wl.mesh, props.map)
  for (const p of Object.values(props)) {
    p.userData.rest = restOf(p)
    p.visible = false
  }

  const bodyMesh = b.mesh('', mat)
  const body = joint('body', [0, 0.1, 0], bodyMesh, tail, head, wingL, wingR)
  root.add(body)
  return { root, body, head, hat, eye, joy, wow, brow, jaw, wingL, wingR, tail, props, bubble, beakTip }
}

/** a white plume feather with a red tip, curving up and back from its quill (at the origin of m) */
function plumeFeather(k: VKit, m: THREE.Matrix4) {
  const spine = curve2([[0, 0], [0.09, 0.07], [0.19, 0.11], [0.29, 0.09], [0.35, 0.03]], 14)
  const left: P2[] = []
  const right: P2[] = []
  spine.forEach((p, i) => {
    const a = spine[Math.max(0, i - 1)]
    const b = spine[Math.min(spine.length - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const t = i / (spine.length - 1)
    const w = 0.055 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.06 + t)), 0.7) + 0.006
    left.push([p[0] - ((b[1] - a[1]) / l) * w, p[1] + ((b[0] - a[0]) / l) * w])
    right.push([p[0] + ((b[1] - a[1]) / l) * w * 0.8, p[1] - ((b[0] - a[0]) / l) * w * 0.8])
  })
  const out = [...right, ...left.reverse()]
  k.add(slab(out, 0.012, 0.005, 2), '#fff6ec', m)
  const z = 0.0125
  flatDecal(k, m, stripPts(spine.slice(1, -1), 0.006), '#d9c9b8', z + 0.0008)
  // the red tip: the outline clipped to x > 0.26 (clipY on swapped axes)
  const tip = clipY(out.map(([x, y]): P2 => [y, x]), 0.26, 9).map(([y, x]): P2 => [x, y])
  if (tip.length > 2) flatDecal(k, m, tip, '#ff5a4e', z)
  for (let i = 3; i < spine.length - 3; i += 2) {
    const [x, y] = spine[i]
    flatDecal(k, m, stripPts([[x, y], [x - 0.02, y + 0.04]], 0.004), '#e6d6c4', z + 0.0004)
  }
}

/** the props, each centred on where the wing tip holds it */
function buildProps(mat: THREE.Material) {
  // a brass spyglass, held out along the wing
  const s = new VKit(INK, HOST_INK)
  const m = along(V(-0.25, 1, 0.2), [0, 0, 0])
  s.add(lathe([[0, -0.12], [0.03, -0.12], [0.03, 0.02], [0.04, 0.02], [0.04, 0.14], [0.052, 0.17], [0.0, 0.17]], 14), BRASS, m)
  s.add(new THREE.TorusGeometry(0.043, 0.01, 5, 14), BRASS_D, new THREE.Matrix4().multiplyMatrices(m, T([0, 0.06, 0], [Math.PI / 2, 0, 0])))
  s.add(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 14, 1, true), '#a678ff', new THREE.Matrix4().multiplyMatrices(m, T([0, 0.1, 0])))
  const spyglass = s.mesh('spyglass', mat)
  // a little shovel: wooden handle with a grip, an iron blade
  const v = new VKit(INK, HOST_INK)
  limb(v, [0, 0.2, 0], [0, -0.26, 0.02], 0.02, '#9a6236')
  v.add(new THREE.TorusGeometry(0.036, 0.012, 5, 12), '#7a4a26', T([0, 0.235, 0]))
  v.add(slab([[-0.075, 0.0], [0.075, 0.0], [0.08, -0.11], [0.0, -0.19], [-0.08, -0.11]], 0.016, 0.007, 2), '#a9b9d0', T([0, -0.26, 0.03], [-0.15, 0, 0]))
  v.add(new THREE.CylinderGeometry(0.024, 0.03, 0.05, 8), '#7f8ea8', T([0, -0.255, 0.03]), 0.01)
  const shovel = v.mesh('shovel', mat)
  // a small open map: parchment between two rolls with a red X
  const p = new VKit(INK, HOST_INK)
  p.add(new THREE.BoxGeometry(0.2, 0.14, 0.006), '#f4dca0', T([0, 0, 0.02], [0.2, 0, 0]))
  for (const sd of [-1, 1]) p.add(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 10), '#e8c27e', T([sd * 0.1, 0, 0.02], [0.2, 0, 0]))
  const pm = T([0, 0, 0.0245], [0.2, 0, 0])
  for (const dd of [-1, 1]) flatDecal(p, pm, stripPts([[0.03, -0.01 - 0.02 * dd], [0.07, -0.01 + 0.02 * dd]], 0.012), '#e8343c', 0)
  flatDecal(p, pm, stripPts([[-0.07, 0.03], [-0.03, 0.04], [0.0, 0.01], [0.03, -0.01]], 0.006), '#a0402c', 0)
  const map = p.mesh('map', mat)
  return { spyglass, shovel, map }
}

/* ------------------------------------------------------------------ */
/*  Poses                                                               */
/* ------------------------------------------------------------------ */

export type HostAction = 'idle' | 'squawk' | 'point' | 'cheer' | 'dig' | 'spyglass' | 'gasp'

const ease = (x: number) => x * x * (3 - 2 * x)

/**
 * Poses Captain Polly for this frame. `t` is the scene clock (s) for her idle (breathing, head bob, blinks, tail),
 * `action` blends over the idle by `k` (0..1, ease it in and out yourself), and `phase` is the action's own clock
 * (seconds since it started) for its beats: squawk (beak flapping, wings flared), point (right wing out at the reels,
 * head turned to it), cheer (both wings up, hopping, happy eye), dig (leans in and shovels), spyglass (looks out
 * through it), gasp (startled: wide eye, hat jumps).
 */
export function poseHost(rig: HostRig, t: number, action: HostAction = 'idle', k = 1, phase = 0) {
  for (const o of [rig.body, rig.head, rig.hat, rig.eye, rig.brow, rig.jaw, rig.wingL, rig.wingR, rig.tail, ...Object.values(rig.props)]) toRest(o)
  const a = action === 'idle' ? 0 : ease(Math.min(1, Math.max(0, k)))
  const i = 1 - a * 0.7
  // the idle: breathing, a little head bob, tail sway, wings settling, a blink now and then
  rig.body.position.y += 0.008 * Math.sin(t * 2.2) * i
  rig.body.rotation.z += 0.025 * Math.sin(t * 0.8) * i
  rig.head.rotation.z += 0.07 * Math.sin(t * 0.9 + 0.5) * i
  rig.head.rotation.x += 0.04 * Math.sin(t * 1.7) * i
  rig.tail.rotation.z += 0.12 * Math.sin(t * 1.3) * i
  rig.wingL.rotation.z -= 0.03 * (1 + Math.sin(t * 2.2)) * i
  rig.wingR.rotation.z += 0.03 * (1 + Math.sin(t * 2.2 + 0.3)) * i
  const bl = (t * 1.0) % 3.7
  let open = bl < 0.14 ? 0.1 + 0.9 * Math.abs(bl / 0.07 - 1) : 1
  let face: 'eye' | 'joy' | 'wow' = 'eye'
  const p = phase
  switch (action) {
    case 'squawk': {
      rig.head.rotation.x -= 0.3 * a
      rig.jaw.rotation.x += a * (0.25 + 0.25 * Math.abs(Math.sin(p * 16)))
      const fl = 0.7 + 0.25 * Math.sin(p * 22)
      rig.wingL.rotation.z -= fl * a
      rig.wingR.rotation.z += fl * a
      rig.body.position.y += 0.02 * Math.abs(Math.sin(p * 11)) * a
      rig.brow.position.y += 0.02 * a
      rig.hat.position.y += 0.015 * Math.abs(Math.sin(p * 11)) * a
      face = a > 0.5 ? 'joy' : 'eye'
      break
    }
    case 'point': {
      rig.wingR.rotation.z += 1.35 * a + 0.06 * Math.sin(p * 6) * a
      rig.body.rotation.z -= 0.12 * a
      rig.head.rotation.z -= 0.18 * a
      rig.head.rotation.y += 0.35 * a
      rig.head.rotation.x += 0.15 * a
      rig.jaw.rotation.x += 0.12 * a * Math.max(0, Math.sin(p * 9))
      rig.brow.position.y += 0.012 * a
      break
    }
    case 'cheer': {
      const f = 0.3 * Math.sin(p * 14)
      rig.wingL.rotation.z -= (2.4 + f) * a
      rig.wingR.rotation.z += (2.4 - f) * a
      rig.body.position.y += 0.07 * Math.abs(Math.sin(p * 7)) * a
      rig.head.rotation.x -= 0.15 * a
      rig.jaw.rotation.x += 0.4 * a
      rig.tail.rotation.z += 0.3 * Math.sin(p * 14) * a
      rig.hat.position.y += 0.03 * Math.abs(Math.sin(p * 7 + 0.4)) * a
      rig.hat.rotation.z += 0.12 * Math.sin(p * 7) * a
      face = a > 0.4 ? 'joy' : 'eye'
      break
    }
    case 'dig': {
      const s = Math.sin(p * 6)
      rig.props.shovel.visible = a > 0.3
      rig.props.map.visible = a > 0.3
      rig.body.rotation.x += 0.22 * a
      rig.head.rotation.x += 0.3 * a
      rig.wingR.rotation.z += (0.55 + 0.45 * s) * a
      rig.wingR.rotation.x -= (0.5 + 0.3 * s) * a
      rig.props.shovel.rotation.z += (0.3 * s - 0.4) * a
      rig.wingL.rotation.z -= 0.9 * a
      rig.wingL.rotation.x -= 0.6 * a
      rig.body.position.y += 0.012 * Math.max(0, -s) * a
      rig.brow.rotation.z -= 0.15 * a
      break
    }
    case 'spyglass': {
      rig.props.spyglass.visible = a > 0.3
      rig.wingR.rotation.z += 2.15 * a
      rig.wingR.rotation.x -= 0.55 * a
      rig.props.spyglass.rotation.z -= 1.2 * a
      rig.head.rotation.y -= 0.25 * a + 0.2 * Math.sin(p * 0.9) * a
      rig.head.rotation.z += 0.1 * a
      rig.brow.position.y -= 0.01 * a
      rig.brow.rotation.z += 0.2 * a
      break
    }
    case 'gasp': {
      rig.head.rotation.x -= 0.22 * a
      rig.body.position.y += 0.03 * a
      rig.wingL.rotation.z -= 0.55 * a
      rig.wingR.rotation.z += 0.55 * a
      rig.jaw.rotation.x += 0.32 * a
      rig.hat.position.y += 0.07 * a * Math.max(0, Math.sin(Math.min(p * 5, Math.PI)))
      rig.hat.rotation.z -= 0.25 * a * Math.max(0, Math.sin(Math.min(p * 5, Math.PI)))
      rig.brow.position.y += 0.03 * a
      face = a > 0.3 ? 'wow' : 'eye'
      open = 1
      break
    }
  }
  rig.eye.visible = face === 'eye'
  rig.joy.visible = face === 'joy'
  rig.wow.visible = face === 'wow'
  rig.eye.scale.y *= open
}

