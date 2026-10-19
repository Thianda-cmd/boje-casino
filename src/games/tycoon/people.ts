import * as THREE from 'three'
import { Batch, C, T, TAU, TKit, box, cyl, lathe, limb, rbox, sphere, type P3 } from './models'

/*
  The people on the floor, all drawn by one set of instanced batches (People): guests walking between the
  attractions, the staff the attractions ask for (dealers, bartenders, performers, seated players), the managers
  standing by the attractions they run, and the whale, a big gentleman in a gold suit (buildWhale).

  A person is about 1 unit tall and chibi: a big round head, a bean of a body, stubby arms and legs. Each body part is
  its own batch (two legs, two arms, the body, the head, and one of four hair styles or a hat), so a person can walk,
  sit, cheer, deal or dance by turning its parts, and colours come per copy (shirt, trousers, skin, hair). The whole
  crowd is eight draw calls.
*/

export interface Outfit {
  shirt: THREE.Color
  pants: THREE.Color
  skin: THREE.Color
  hair: THREE.Color
  /** 0 short hair, 1 long hair, 2 a bun, 3 a hat (in the hair colour) */
  style: number
}

export const POSE = { stand: 0, walk: 1, sit: 2, cheer: 3, deal: 4, shake: 5, sing: 6, dance: 7 } as const
export type Pose = (typeof POSE)[keyof typeof POSE]

const SKINS = ['#ffd9b8', '#f6c39a', '#e0a476', '#b9784f', '#8d5434', '#ffe4cf'].map((c) => C(c))
const HAIRS = ['#3a2416', '#1d1620', '#7a4a22', '#e8c25a', '#c2552e', '#e9e2d8', '#5a3a8a', '#2a2a2a'].map((c) => C(c))
const SHIRTS = ['#ff5a76', '#3fb6ff', '#ffc93d', '#7ad35c', '#b07bff', '#ff8d3b', '#2fd4c0', '#ffffff', '#ff6fc8', '#5a7bff'].map((c) => C(c))
const PANTS = ['#2b3a67', '#3a3346', '#5c4033', '#1f2a3a', '#6a6f86', '#2f4f3a'].map((c) => C(c))

/** a random guest's clothes */
export function guestOutfit(r: () => number): Outfit {
  const p = <X,>(xs: X[]) => xs[Math.floor(r() * xs.length)]
  return { shirt: p(SHIRTS), pants: p(PANTS), skin: p(SKINS), hair: p(HAIRS), style: Math.floor(r() * 3) }
}

/** staff uniforms */
export const UNIFORM = {
  dealer: (r: () => number): Outfit => ({ shirt: C('#f4f1ea'), pants: C('#20212e'), skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[Math.floor(r() * 3)], style: Math.floor(r() * 3) }),
  manager: (r: () => number): Outfit => ({ shirt: C('#2a3150'), pants: C('#1d2236'), skin: SKINS[Math.floor(r() * SKINS.length)], hair: C('#1b1b22'), style: 3 }),
  bartender: (r: () => number): Outfit => ({ shirt: C('#ffffff'), pants: C('#1c1c24'), skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[Math.floor(r() * HAIRS.length)], style: 2 }),
  performer: (r: () => number): Outfit => ({ shirt: C('#ff3f8e'), pants: C('#ff3f8e'), skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[3 + Math.floor(r() * 3)], style: 1 }),
  vip: (r: () => number): Outfit => ({ shirt: [C('#8a2be2'), C('#e8b33a'), C('#d6264f'), C('#ffffff')][Math.floor(r() * 4)], pants: C('#1d1626'), skin: SKINS[Math.floor(r() * SKINS.length)], hair: HAIRS[Math.floor(r() * HAIRS.length)], style: Math.floor(r() * 3) }),
  bouncer: (): Outfit => ({ shirt: C('#141418'), pants: C('#141418'), skin: SKINS[3], hair: C('#141418'), style: 0 }),
}

/* ---------------- the body parts (each modelled about its own joint) ---------------- */

const HIP_Y = 0.36
const HIP_X = 0.085
const SHOULDER_Y = 0.62
const SHOULDER_X = 0.205
const NECK_Y = 0.68

function torsoGeo() {
  const k = new TKit()
  k.add(
    lathe([
      [0.0, 0.3],
      [0.15, 0.31],
      [0.18, 0.45],
      [0.185, 0.6],
      [0.12, 0.69],
      [0.0, 0.705],
    ], 10),
    '#ffffff',
  )
  // a darker belt and a collar, in the shirt's own colour, so every outfit reads as clothes
  k.add(new THREE.TorusGeometry(0.17, 0.018, 3, 12), '#a8a8a8', T([0, 0.37, 0], [Math.PI / 2, 0, 0]), 0)
  k.add(new THREE.ConeGeometry(0.07, 0.07, 3), '#d8d8d8', T([0, 0.645, 0.16], [Math.PI / 2 + 0.3, 0, Math.PI]), 0)
  return k.geometry()
}

function legGeo() {
  const k = new TKit()
  k.add(new THREE.CapsuleGeometry(0.068, 0.2, 1, 6), '#ffffff', T([0, -0.15, 0]))
  k.add(sphere(1, 6, 4), '#3a3036', T([0, -0.3, 0.035], [0, 0, 0], [0.07, 0.045, 0.1]))
  return k.geometry()
}

function armGeo() {
  const k = new TKit()
  k.add(new THREE.CapsuleGeometry(0.055, 0.2, 1, 6), '#ffffff', T([0, -0.13, 0]))
  return k.geometry()
}

const HEAD_C: P3 = [0, 0.2, 0]
const HEAD_R = 0.215

function headGeo() {
  const k = new TKit()
  k.add(sphere(HEAD_R, 14, 10), '#ffffff', T(HEAD_C))
  // eyes, a smile and rosy cheeks (all tinted by the skin, so dark stays dark and pink stays rosy)
  const front = (x: number, y: number) => HEAD_C[2] + Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - (y - HEAD_C[1]) ** 2))
  for (const s of [-1, 1]) {
    k.add(sphere(1, 6, 4), '#1c1426', T([s * 0.072, 0.215, front(s * 0.072, 0.215) - 0.012], [0, 0, 0], [0.03, 0.042, 0.02]), 0, { flat: true })
    k.add(sphere(1, 4, 3), '#ffffff', T([s * 0.072 - 0.01, 0.228, front(s * 0.072, 0.215) - 0.002], [0, 0, 0], [0.01, 0.012, 0.006]), 0, { flat: true })
    k.add(sphere(1, 6, 4), '#ff9c9c', T([s * 0.12, 0.15, front(s * 0.12, 0.15) - 0.016], [0, s * 0.5, 0], [0.04, 0.026, 0.012]), 0, { flat: true })
  }
  k.add(new THREE.TorusGeometry(0.04, 0.011, 3, 8, Math.PI), '#5a1f2a', T([0, 0.15, front(0, 0.15) - 0.006], [0, 0, Math.PI]), 0, { flat: true })
  return k.geometry()
}

function hairGeo(style: number) {
  const k = new TKit()
  const cap = (r: number, y: number, tilt: number) => k.add(new THREE.SphereGeometry(r, 14, 6, 0, TAU, 0, Math.PI * 0.55), '#ffffff', T([0, y, -0.012], [-tilt, 0, 0]))
  if (style === 0) {
    cap(HEAD_R + 0.018, 0.205, 0.42)
    k.add(sphere(0.06, 6, 4), '#ffffff', T([0.06, 0.39, 0.1], [0.4, 0, 0.3], [1.3, 0.7, 0.9]))
  } else if (style === 1) {
    cap(HEAD_R + 0.02, 0.205, 0.38)
    k.add(sphere(1, 10, 8), '#ffffff', T([0, 0.13, -0.075], [0, 0, 0], [0.235, 0.24, 0.17]))
  } else if (style === 2) {
    cap(HEAD_R + 0.016, 0.205, 0.4)
    k.add(sphere(0.095, 8, 6), '#ffffff', T([0, 0.43, -0.09]))
  } else {
    // a bowler hat
    k.add(cyl(0.27, 0.025, 14), '#ffffff', T([0, 0.33, 0]))
    k.add(new THREE.SphereGeometry(0.19, 12, 6, 0, TAU, 0, Math.PI / 2), '#ffffff', T([0, 0.34, 0], [0, 0, 0], [1, 1.05, 1]))
    k.add(cyl(0.192, 0.045, 14, 0.192, true), '#c9a13a', T([0, 0.345, 0]), 0)
  }
  return k.geometry()
}

let geos: { torso: THREE.BufferGeometry; leg: THREE.BufferGeometry; arm: THREE.BufferGeometry; head: THREE.BufferGeometry; hair: THREE.BufferGeometry[] } | null = null
function partGeos() {
  return (geos ??= { torso: torsoGeo(), leg: legGeo(), arm: armGeo(), head: headGeo(), hair: [0, 1, 2, 3].map(hairGeo) })
}

/* ---------------- the batches ---------------- */

const _root = new THREE.Matrix4()
const _m = new THREE.Matrix4()
const _r = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** a person in the world this frame (see People.put) */
export interface PersonPose {
  x: number
  y: number
  z: number
  /** facing (radians about y; 0 faces +z) */
  yaw: number
  pose: Pose
  /** its own clock (s): walk cycles, idle sway */
  clock: number
  /** 0..1 how much the pose shows (cheers come and go) */
  k: number
  /** a size factor (pop-in) */
  scale: number
}

/** Draws up to `cap` people a frame: begin(), put() each one, end(). */
export class People {
  private readonly legs: Batch
  private readonly arms: Batch
  private readonly torso: Batch
  private readonly head: Batch
  private readonly hair: Batch[]
  private readonly all: Batch[]
  readonly group = new THREE.Group()

  constructor(readonly cap: number) {
    const g = partGeos()
    this.legs = new Batch(g.leg, cap * 2, undefined, 'legs')
    this.arms = new Batch(g.arm, cap * 2, undefined, 'arms')
    this.torso = new Batch(g.torso, cap, undefined, 'torso')
    this.head = new Batch(g.head, cap, undefined, 'head')
    this.hair = g.hair.map((h, i) => new Batch(h, cap, undefined, `hair${i}`))
    this.all = [this.legs, this.arms, this.torso, this.head, ...this.hair]
    this.group.name = 'people'
    for (const b of this.all) this.group.add(b.mesh)
  }

  begin() {
    for (let i = 0; i < this.all.length; i++) this.all[i].begin()
  }

  end() {
    for (let i = 0; i < this.all.length; i++) this.all[i].end()
  }

  /** one person: where and how it stands, and its clothes */
  put(p: PersonPose, o: Outfit) {
    const t = p.clock
    const k = p.k
    let bob = 0
    let lean = 0
    let sway = 0
    let legL = 0
    let legR = 0
    // arms: [forward swing, out to the side] for left and right
    let aLf = 0.08
    let aLs = 0.12
    let aRf = 0.08
    let aRs = 0.12
    let nod = 0
    let lift = 0
    switch (p.pose) {
      case POSE.walk: {
        const w = Math.sin(t * 9)
        legL = w * 0.55
        legR = -w * 0.55
        aLf = -w * 0.45
        aRf = w * 0.45
        bob = Math.abs(Math.cos(t * 9)) * 0.05
        sway = Math.sin(t * 9) * 0.05
        break
      }
      case POSE.sit:
        // seated (k > 0 throws the arms up: a seated cheer)
        legL = legR = -1.45
        lift = 0.07
        aLf = aRf = -0.5 * (1 - k)
        aLs = aRs = 0.1 + 2.4 * k + Math.sin(t * 14) * 0.15 * k
        nod = Math.sin(t * 1.3) * 0.05
        break
      case POSE.cheer: {
        const j = Math.abs(Math.sin(t * 7))
        bob = j * 0.16 * k
        aLs = aRs = 0.12 + 2.5 * k
        aLf = aRf = -0.2 * k + Math.sin(t * 14) * 0.15 * k
        legL = legR = -0.25 * j * k
        break
      }
      case POSE.deal:
        aLf = -1.0 - Math.max(0, Math.sin(t * 5)) * 0.35
        aRf = -1.0 - Math.max(0, Math.sin(t * 5 + 2)) * 0.35
        aLs = aRs = 0.05
        nod = 0.1 + Math.sin(t * 2.5) * 0.06
        sway = Math.sin(t * 2.5) * 0.03
        break
      case POSE.shake: {
        const s = Math.sin(t * 22) * 0.25 * k
        aLf = aRf = -1.9 + s
        aLs = aRs = 0.32
        bob = Math.abs(Math.sin(t * 11)) * 0.03 * k
        sway = Math.sin(t * 11) * 0.06 * k
        break
      }
      case POSE.sing:
        aRf = -2.3
        aRs = 0.4
        aLs = 0.5 + Math.sin(t * 3) * 0.6 * k
        aLf = -0.6
        sway = Math.sin(t * 2.2) * 0.1
        bob = Math.abs(Math.sin(t * 4.4)) * 0.04 * k
        break
      case POSE.dance: {
        const d = Math.sin(t * 6)
        aLs = 1.6 + d * 0.9
        aRs = 1.6 - d * 0.9
        aLf = aRf = -0.3
        legL = d * 0.4
        legR = -d * 0.4
        bob = Math.abs(Math.cos(t * 6)) * 0.08
        sway = d * 0.12
        break
      }
      default:
        aLs = aRs = 0.12 + Math.sin(t * 1.7) * 0.03
        aLf = aRf = 0.06 + Math.sin(t * 1.1) * 0.04
        nod = Math.sin(t * 0.9) * 0.05
        lean = Math.sin(t * 0.7) * 0.02
    }
    const s = p.scale
    _q.setFromEuler(_e.set(lean, p.yaw, sway))
    _root.compose(_p.set(p.x, p.y + (bob + lift) * s, p.z), _q, _s.set(s, s, s))
    this.torso.put(_root, o.shirt)
    // legs about the hips
    this.legs.put(_m.copy(_root).multiply(_r.makeTranslation(-HIP_X, HIP_Y, 0)).multiply(_r.makeRotationX(legL)), o.pants)
    this.legs.put(_m.copy(_root).multiply(_r.makeTranslation(HIP_X, HIP_Y, 0)).multiply(_r.makeRotationX(legR)), o.pants)
    // arms about the shoulders: swung forward (−x turn) and out to the side
    this.arms.put(_m.copy(_root).multiply(_r.makeTranslation(-SHOULDER_X, SHOULDER_Y, 0)).multiply(_r.makeRotationZ(-aLs)).multiply(_r.makeRotationX(aLf)), o.shirt)
    this.arms.put(_m.copy(_root).multiply(_r.makeTranslation(SHOULDER_X, SHOULDER_Y, 0)).multiply(_r.makeRotationZ(aRs)).multiply(_r.makeRotationX(aRf)), o.shirt)
    _m.copy(_root).multiply(_r.makeTranslation(0, NECK_Y, 0)).multiply(_r.makeRotationX(nod))
    this.head.put(_m, o.skin)
    this.hair[o.style].put(_m, o.hair)
  }

  dispose() {
    for (const b of this.all) b.dispose()
  }
}

/* ---------------- the whale ---------------- */

const GOLD = '#ffc53a'
const GOLD_D = '#e09a1c'

export interface WhaleRig {
  root: THREE.Group
  /** the body (turned and bobbed as a whole), the legs and arms (swung about their joints) */
  body: THREE.Object3D
  legs: [THREE.Object3D, THREE.Object3D]
  arms: [THREE.Object3D, THREE.Object3D]
  dispose(): void
}

/** the whale: a jolly round gentleman in a gold suit and top hat, with a monocle and a bag of money; about 2 tall */
export function buildWhale(): WhaleRig {
  const k = new TKit()
  // the gold suit: a round belly with a white shirt front, a bow tie and buttons
  const belly: P3 = [0, 0.78, 0]
  k.add(sphere(1, 20, 16), GOLD, T(belly, [0, 0, 0], [0.46, 0.5, 0.42]), 1, { shine: 0.8 })
  k.add(new THREE.ConeGeometry(0.2, 0.42, 3, 1), '#fffaf0', T([0, 0.98, 0.33], [-0.35, 0, Math.PI]), 0)
  k.add(sphere(1, 8, 6), '#c8213b', T([-0.07, 1.16, 0.32], [0, 0, 0.5], [0.08, 0.05, 0.04]))
  k.add(sphere(1, 8, 6), '#c8213b', T([0.07, 1.16, 0.32], [0, 0, -0.5], [0.08, 0.05, 0.04]))
  k.add(sphere(0.035, 8, 6), '#9a1028', T([0, 1.16, 0.355]))
  for (const y of [0.85, 0.7, 0.55]) k.add(sphere(0.03, 8, 6), GOLD_D, T([0, y, 0.41 - Math.abs(y - 0.78) * 0.25]), 0, { shine: 1 })
  // lapels and a red pocket square
  for (const s of [-1, 1]) k.add(box(0.06, 0.32, 0.03), GOLD_D, T([s * 0.17, 0.98, 0.33], [-0.3, s * 0.35, s * -0.25]), 0)
  k.add(box(0.1, 0.06, 0.02), '#e8334f', T([0.24, 0.98, 0.35], [-0.2, 0.5, 0.15]), 0)
  // the head: rosy, a curled moustache, a monocle
  const head: P3 = [0, 1.48, 0.02]
  const hr = 0.3
  k.add(sphere(hr, 20, 14), '#ffd0ac', T(head))
  const fz = (x: number, y: number) => head[2] + Math.sqrt(Math.max(0, hr * hr - x * x - (y - head[1]) ** 2))
  for (const s of [-1, 1]) {
    k.add(sphere(1, 10, 8), '#1c1426', T([s * 0.1, 1.53, fz(s * 0.1, 1.53) - 0.014], [0, 0, 0], [0.034, 0.05, 0.02]), 0, { flat: true })
    k.add(sphere(1, 8, 6), '#ff8f8f', T([s * 0.17, 1.42, fz(s * 0.17, 1.42) - 0.02], [0, s * 0.5, 0], [0.06, 0.04, 0.02]), 0, { flat: true })
    // the moustache: two curls
    k.add(new THREE.TorusGeometry(0.075, 0.03, 6, 12, Math.PI * 1.3), '#6a3b1c', T([s * 0.08, 1.4, fz(s * 0.08, 1.4) + 0.01], [0, s * 0.3, s > 0 ? 3.6 : -0.45]), 1)
  }
  k.add(sphere(0.06, 10, 8), '#ffb68f', T([0, 1.46, fz(0, 1.46) + 0.02]))
  // a wide grin under the moustache
  k.add(new THREE.TorusGeometry(0.07, 0.016, 4, 12, Math.PI), '#5a1f2a', T([0, 1.35, fz(0, 1.35) - 0.008], [0, 0, Math.PI]), 0, { flat: true })
  k.add(new THREE.TorusGeometry(0.06, 0.012, 6, 16), GOLD, T([0.1, 1.53, fz(0.1, 1.53) + 0.012]), 0, { shine: 1 })
  k.add(new THREE.CircleGeometry(0.055, 14), C('#dff6ff', 1.2), T([0.1, 1.53, fz(0.1, 1.53) + 0.01]), 0, { flat: true })
  k.add(new THREE.CylinderGeometry(0.004, 0.004, 0.22), GOLD_D, T([0.17, 1.42, fz(0.15, 1.45) - 0.01], [0, 0, 0.5]), 0)
  // the top hat: black, a gold band
  k.add(cyl(0.36, 0.04, 22), '#1b1622', T([0, 1.7, 0.01]))
  k.add(cyl(0.22, 0.4, 20, 0.24), '#1b1622', T([0, 1.72, 0.01]))
  k.add(cyl(0.243, 0.08, 20, 0.243, true), GOLD, T([0, 1.74, 0.01]), 0, { shine: 1 })
  const body = k.mesh('whale-body')

  // legs (black trousers, shiny shoes) and arms (gold sleeves, white gloves), each about its own joint
  const legK = new TKit()
  legK.add(new THREE.CapsuleGeometry(0.11, 0.16, 2, 10), '#26202e', T([0, -0.12, 0]))
  legK.add(rbox(0.2, 0.12, 0.3, 0.06), '#141018', T([0, -0.29, 0.05]))
  const legGeo = legK.geometry()
  const armGeoL = armWith('cane')
  const armGeoR = armWith('bag')
  const mat = body.material as THREE.Material
  const legs: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(legGeo, mat), new THREE.Mesh(legGeo, mat)]
  legs[0].position.set(-0.17, 0.36, 0)
  legs[1].position.set(0.17, 0.36, 0)
  const arms: [THREE.Mesh, THREE.Mesh] = [new THREE.Mesh(armGeoL, mat), new THREE.Mesh(armGeoR, mat)]
  arms[0].position.set(-0.43, 1.0, 0)
  arms[1].position.set(0.43, 1.0, 0)
  const root = new THREE.Group()
  root.name = 'whale'
  root.add(body, ...legs, ...arms)
  return {
    root,
    body,
    legs,
    arms,
    dispose() {
      body.geometry.dispose()
      legGeo.dispose()
      armGeoL.dispose()
      armGeoR.dispose()
    },
  }
}

function armWith(prop: 'cane' | 'bag') {
  const k = new TKit()
  k.add(new THREE.CapsuleGeometry(0.1, 0.2, 2, 10), GOLD, T([0, -0.16, 0]), 1, { shine: 0.6 })
  k.add(sphere(0.11, 10, 8), '#ffffff', T([0, -0.36, 0.02]))
  if (prop === 'cane') {
    limb(k, [0, -0.3, 0.12], [0, -0.92, 0.18], 0.03, '#1b1622')
    k.add(sphere(0.06, 10, 8), GOLD, T([0, -0.28, 0.12]), 1, { shine: 1 })
  } else {
    // a bulging bag of money with a gold coin badge
    k.add(sphere(1, 14, 12), '#d9b98a', T([0, -0.62, 0.08], [0, 0, 0], [0.2, 0.22, 0.18]))
    k.add(cyl(0.07, 0.08, 10, 0.1), '#c9a675', T([0, -0.42, 0.08]))
    k.add(new THREE.TorusGeometry(0.075, 0.018, 6, 12), '#8a5a2a', T([0, -0.4, 0.08], [Math.PI / 2, 0, 0]), 0)
    k.add(cyl(0.08, 0.02, 14), GOLD, T([0, -0.62, 0.27], [Math.PI / 2, 0, 0]), 1, { shine: 1 })
  }
  return k.geometry()
}

/* ---------------- the golden chip ---------------- */

/** a big golden casino chip, standing on its edge and facing +z, centred on the origin (about 1 across) */
export function chipGeometry() {
  const k = new TKit()
  const R = 0.5
  const H = 0.13
  k.add(new THREE.CylinderGeometry(R, R, H, 32), GOLD, T([0, 0, 0], [Math.PI / 2, 0, 0]), 1, { shine: 1 })
  // the edge inserts: cream blocks round the rim
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    k.add(box(0.13, 0.05, H + 0.012), '#fff6dc', T([Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02), 0], [0, 0, a + Math.PI / 2]), 0)
  }
  // both faces: a darker ring, an inner disc and a star
  for (const s of [-1, 1]) {
    const z = s * (H / 2 + 0.003)
    const rot: P3 = [0, s > 0 ? 0 : Math.PI, 0]
    k.add(new THREE.RingGeometry(0.33, 0.37, 32), GOLD_D, T([0, 0, z], rot), 0)
    k.add(new THREE.CircleGeometry(0.31, 32), C('#ffe08a'), T([0, 0, z], rot), 0, { shine: 1 })
    const pts: THREE.Vector2[] = []
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 ? 0.09 : 0.22
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r))
    }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts))
    k.add(g, C('#fff4c8', 1.3), T([0, 0, z + s * 0.002], rot), 0, { flat: true })
  }
  return k.geometry()
}

/** a coin for the pops: a small gold disc lying flat (centred on the origin) */
export function coinGeometry() {
  const k = new TKit()
  k.add(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 18), GOLD, undefined, 1, { shine: 1 })
  for (const s of [-1, 1]) k.add(new THREE.CircleGeometry(0.11, 16), C('#ffe596'), T([0, s * 0.027, 0], [-s * Math.PI / 2, 0, 0]), 0)
  return k.geometry()
}

/** a scrap of confetti (instance colour sets its colour) */
export function confettiGeometry() {
  const k = new TKit()
  k.add(box(0.14, 0.012, 0.08), '#ffffff', undefined, 0, { flat: true })
  return k.geometry()
}

export function releasePeople() {
  if (!geos) return
  for (const g of [geos.torso, geos.leg, geos.arm, geos.head, ...geos.hair]) g.dispose()
  geos = null
}
