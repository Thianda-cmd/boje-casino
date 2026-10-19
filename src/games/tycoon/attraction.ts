import * as THREE from 'three'
import { Batch, C, FONT, T, TAU, TKit, along, box, bulbs, canvasTexture, cyl, disposeTextPlane, fitText, rbox, rng, roundRectPath, sphere, textPlane, toonMaterial, tube, type P2, type P3, type Rand } from './models'
import { PAD_H, PLOTS, USE, tierOf } from './layout'
import type { Outfit, Pose } from './people'

/*
  The frame every attraction on the floor is built on (machines.ts, tables.ts and venues.ts fill it in).

  An attraction stands on its plot (root: at the plot's centre on top of the pad, turned so local +z is its front,
  facing the camera's side of the floor). It shows `units`, the copies of its main piece (claw machines, tables,
  the tower's floors), laid out anew by arrange(tier) at each step of TIERS (1, 10, 25, 50, 100, 200 owned): more
  of them, bigger ones, and `extras` (a sign at 50, velvet ropes at 100, a trophy at 200, and its own touches) that
  appear at a tier. Repeated pieces are drawn through instanced batches, so a row of eight slot machines with all
  their reels is a handful of draw calls; draw() fills them every frame (a few dozen matrices), animating as it goes.

  Its life is driven by a Drive (see the scene): `cyc` counts visual cycles (the fractional part is how far through
  this one it is; it never runs faster than minCycle so a claw machine that pays 16 times a second still grabs at a
  readable pace), `on` whether it is running at all (a manual attraction waits for a tap), `pay` the seconds since its
  last pay moment (reels stop and the topper flashes, the wheel's ball drops, the stage lights flare).

  The staff it asks for (dealers, bartenders, a singer, seated players) are listed in `staff` in its own frame; the
  crowd draws them with everyone else. `popAt` is where coins jump out of it, `top` its height (for picking), and
  `managerAt` where its manager stands.
*/

export interface Drive {
  /** the scene clock (s) and this frame's step */
  t: number
  dt: number
  /** visual cycles so far: fract(cyc) is the progress through this one */
  cyc: number
  /** running (managed, or a manual cycle under way) */
  on: boolean
  /** seconds since the last pay moment (large when none yet) */
  pay: number
  /** a whale's boost, 0..1 */
  boost: number
}

/** a member of staff, in the attraction's frame */
export interface Staff {
  x: number
  y: number
  z: number
  yaw: number
  outfit: Outfit
  /** the pose while it works, and whether it cheers at a pay moment */
  pose: Pose
  cheers: boolean
  seed: number
}

interface Unit {
  x: number
  y: number
  z: number
  rot: number
  born: number
  seed: number
}

/** an extra piece shown from a tier on */
interface Extra {
  obj: THREE.Object3D
  from: number
  /** up to (and not including) this tier */
  until: number
  born: number
}

/** the size of a piece popping in, `age` seconds after it appeared: up from nothing with a springy overshoot */
export function popScale(age: number) {
  if (age <= 0) return 0
  if (age > 0.9) return 1
  return 1 - Math.exp(-8 * age) * Math.cos(13 * age)
}

const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _y = new THREE.Vector3(0, 1, 0)

export abstract class Attraction {
  readonly root = new THREE.Group()
  readonly units: Unit[] = []
  readonly staff: Staff[] = []
  tier = -1
  /** the height of its tallest part (local), for picking */
  top = 2
  /** coins jump out from here (local) */
  readonly popAt = new THREE.Vector3(0, 1.8, 0)
  /** its manager stands here (local x, z: just off the pad's front corner) facing yaw */
  readonly managerAt = { x: -1.95, z: 2.62, yaw: 0.35 }
  /** the visual cycle is never shorter than this (s) */
  minCycle = 2
  protected readonly batches: Batch[] = []
  private readonly extras: Extra[] = []
  private readonly owned: { dispose(): void }[] = []
  protected readonly rand: Rand
  /** the turn (local) that faces the camera squarely, for signs */
  protected readonly toCamera: number
  /** the pad's far corner from the camera (local x, z): where its sign stands, tall, over everything */
  protected readonly back: [number, number]
  /** when the current layout appeared (for the build-up) */
  built = 0

  constructor(readonly index: number) {
    const p = PLOTS[index]
    this.root.name = `attraction-${index}`
    this.root.position.set(p.x, PAD_H, p.z)
    this.root.rotation.y = p.rot
    this.rand = rng(1000 + index * 77)
    this.toCamera = Math.PI / 4 - p.rot
    this.back = [p.rot === 0 ? -1.75 : 1.75, -1.75]
    this.root.visible = false
  }

  /** an instanced batch of `geo` drawn in this attraction's frame */
  protected batch(geo: THREE.BufferGeometry, cap: number, mat: THREE.Material = toonMaterial(), name = '') {
    const b = new Batch(geo, cap, mat, name)
    this.batches.push(b)
    this.root.add(b.mesh)
    this.owned.push(geo)
    return b
  }

  /** its marquee sign (from SIGN_AT), standing tall at the far corner and turned to the camera */
  protected sign(text: string, color: string, w = 1.8, postH = 2.5) {
    const s = marqueeSign(text, color, w, 0.5, postH)
    s.position.set(this.back[0], 0, this.back[1])
    s.rotation.y = this.toCamera
    return this.extra(s, SIGN_AT)
  }

  /** its trophy at 200 (see trophy()), on the pad's front corner away from the manager */
  protected award(top: (k: TKit, y: number) => void) {
    const t = trophy(top)
    t.position.set(1.72, 0, 1.72)
    return this.extra(t, TROPHY_AT)
  }

  /** a piece shown from tier `from` (up to `until`), popping in when it appears */
  protected extra(obj: THREE.Object3D, from: number, until = 99) {
    obj.visible = false
    this.root.add(obj)
    this.extras.push({ obj, from, until, born: -1 })
    return obj
  }

  /** something to free with the attraction */
  protected keep<X extends { dispose(): void }>(x: X) {
    this.owned.push(x)
    return x
  }

  /** shows `n` owned: lays out anew when the tier changes; true if it did */
  setCount(n: number, t: number) {
    const tier = tierOf(n)
    this.root.visible = tier >= 0
    if (tier === this.tier) return false
    this.tier = tier
    this.units.length = 0
    this.staff.length = 0
    this.built = t
    if (tier >= 0) this.arrange(tier)
    // the units appear one after another, a build-up
    this.units.forEach((u, k) => (u.born = t + 0.05 + k * 0.07))
    for (const e of this.extras) {
      const show = tier >= e.from && tier < e.until
      if (show && !e.obj.visible) e.born = t + 0.15 + this.units.length * 0.07
      e.obj.visible = show
    }
    return true
  }

  /** lays out the units, staff and extras for a tier */
  protected abstract arrange(tier: number): void
  /** fills the batches for this frame */
  protected abstract draw(d: Drive): void

  protected unit(x: number, z: number, rot = 0, y = 0) {
    this.units.push({ x, y, z, rot, born: 0, seed: this.units.length * 0.37 + this.rand() })
  }

  protected person(x: number, z: number, yaw: number, outfit: Outfit, pose: Pose, cheers = true, y = 0) {
    this.staff.push({ x, y, z, yaw, outfit, pose, cheers, seed: this.rand() * 10 })
  }

  /** a unit's matrix (its spot, turn and pop-in size) times `local`, into out */
  protected place(u: Unit, t: number, out: THREE.Matrix4, local?: THREE.Matrix4) {
    const s = popScale(t - u.born)
    out.compose(_p.set(u.x, u.y, u.z), _q.setFromAxisAngle(_y, u.rot), _s.set(s, s, s))
    if (local) out.multiply(local)
    return out
  }

  tick(d: Drive) {
    if (this.tier < 0) return
    for (let i = 0; i < this.extras.length; i++) {
      const e = this.extras[i]
      if (e.obj.visible) e.obj.scale.setScalar(Math.max(1e-4, popScale(d.t - e.born)))
    }
    for (let i = 0; i < this.batches.length; i++) this.batches[i].begin()
    this.draw(d)
    for (let i = 0; i < this.batches.length; i++) this.batches[i].end()
  }

  /** frees everything it built (the shared materials stay) */
  dispose() {
    for (const b of this.batches) b.dispose()
    for (const x of this.owned) x.dispose()
    this.root.traverse((o) => {
      if (o instanceof THREE.InstancedMesh || !(o instanceof THREE.Mesh)) return
      if (o.userData.text) disposeTextPlane(o)
      else o.geometry.dispose()
    })
  }
}

/* ---------------- shared props ---------------- */

export const GOLD = '#ffc53a'
export const GOLD_D = '#d99a22'
export const CREAM = '#fff3dc'
export const WOOD = '#9a5f34'
export const WOOD_D = '#6a3d22'
export const FELT = '#1f9a55'

const CHIP_COLORS = ['#e8334f', '#2f7bff', '#1fbf6a', '#20212e', '#ffb02e', '#a35bff']

/** a stack of n casino chips standing on (x, y, z) */
export function chipStack(k: TKit, x: number, y: number, z: number, n: number, color = CHIP_COLORS[0], r = 0.075) {
  for (let i = 0; i < n; i++) k.add(cyl(r, 0.024, 8), i % 2 ? color : C(color).lerp(C('#ffffff'), 0.25), T([x, y + i * 0.026, z]), i === n - 1 ? 1 : 0)
}
export { CHIP_COLORS }

/** a playing card lying flat (face up: white with a pip; face down shows the red back underneath) */
export function cardGeometry() {
  const k = new TKit()
  k.add(box(0.13, 0.012, 0.18), '#ffffff', undefined, 1)
  k.add(box(0.11, 0.002, 0.16), '#d8213b', T([0, -0.0065, 0]), 0, { flat: true })
  k.add(sphere(1, 8, 4), '#e2263c', T([0, 0.0065, 0], [0, 0, 0], [0.03, 0.002, 0.04]), 0, { flat: true })
  return k.geometry()
}

/** a bar stool / player stool (seat top at 0.48) */
export function stool(k: TKit, x: number, z: number, seat: THREE.ColorRepresentation = '#c8213b') {
  k.add(cyl(0.16, 0.025, 12), '#3a3346', T([x, 0, z]), 0)
  k.add(cyl(0.025, 0.42, 6), GOLD_D, T([x, 0.02, z]), 0)
  k.add(rbox(0.32, 0.08, 0.32, 0.04), seat, T([x, 0.46, z]))
}

/** a chair facing +z at (x, z), turned `rot` (seat top at 0.46) */
export function chair(k: TKit, x: number, z: number, rot: number, color: THREE.ColorRepresentation = '#7a2440') {
  k.push(T([x, 0, z], [0, rot, 0]))
  k.add(rbox(0.4, 0.1, 0.38, 0.04), color, T([0, 0.42, 0]))
  k.add(rbox(0.4, 0.46, 0.09, 0.04), color, T([0, 0.68, -0.17]))
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    k.add(cyl(0.022, 0.38, 5), GOLD_D, T([sx * 0.16, 0, sz * 0.15]), 0)
  k.pop()
}

/** a flat outline ring on a tabletop (y), from an outline and its inset copy */
export function flatRing(outer: P2[], inner: P2[], y: number) {
  const s = new THREE.Shape(outer.map(([x, z]) => new THREE.Vector2(x, -z)))
  s.holes.push(new THREE.Path(inner.map(([x, z]) => new THREE.Vector2(x, -z))))
  const g = new THREE.ShapeGeometry(s)
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  g.deleteAttribute('uv')
  return g
}

/** a padded rail along a closed outline at height y */
export function rail(k: TKit, pts: P2[], y: number, r: number, color: THREE.ColorRepresentation, closed = true) {
  k.add(tube(pts.map(([x, z]) => [x, y, z] as P3), r, pts.length * 3, 8, closed), color)
}

/* ---------------- the sign at 50 ---------------- */

/**
 * A marquee sign on two posts: a dark board ringed with chasing bulbs and the attraction's name in glowing letters.
 * Faces +z (turn it towards the camera); stands on y = 0, `w` wide.
 */
export function marqueeSign(text: string, color: string, w = 2.1, h = 0.62, postH = 1.5) {
  const g = new THREE.Group()
  const k = new TKit()
  for (const s of [-1, 1]) k.add(cyl(0.05, postH, 8), GOLD_D, T([s * (w / 2 - 0.25), 0, -0.05]))
  k.add(rbox(w, h, 0.12, 0.08), '#221a3a', T([0, postH + h / 2, -0.04]))
  k.add(rbox(w + 0.08, 0.06, 0.16, 0.03), GOLD, T([0, postH + h + 0.01, -0.04]), 1, { shine: 1 })
  const ring: P3[] = [
    [-w / 2 + 0.07, postH + 0.07, 0.03],
    [w / 2 - 0.07, postH + 0.07, 0.03],
    [w / 2 - 0.07, postH + h - 0.07, 0.03],
    [-w / 2 + 0.07, postH + h - 0.07, 0.03],
    [-w / 2 + 0.07, postH + 0.07, 0.03],
  ]
  bulbs(k, along(ring, Math.round((w + h) * 7)), 0.028)
  const mesh = k.mesh('sign')
  g.add(mesh)
  const txt = textPlane(w - 0.26, h - 0.2, 512, (c, cw, ch) => {
    c.shadowColor = color
    c.shadowBlur = ch * 0.25
    c.fillStyle = '#ffffff'
    fitText(c, text, cw / 2, ch / 2 + ch * 0.04, ch * 0.8, cw * 0.94, 800, 0.06)
    c.shadowBlur = 0
    c.fillStyle = color
    c.globalAlpha = 0.35
    fitText(c, text, cw / 2, ch / 2 + ch * 0.04, ch * 0.8, cw * 0.94, 800, 0.06)
  }, 1.6)
  txt.userData.text = true
  txt.position.set(0, postH + h / 2, 0.025)
  g.add(txt)
  return g
}

/** velvet ropes on gold stanchions round a plot's sides and back (its front left open), at 100 owned */
export function velvetRopes(open = 1.6) {
  const k = new TKit()
  const e = USE + 0.1
  const posts: P2[] = [
    [-open / 2, e],
    [-e, e],
    [-e, 0],
    [-e, -e],
    [0, -e],
    [e, -e],
    [e, 0],
    [e, e],
    [open / 2, e],
  ]
  for (const [x, z] of posts) {
    k.add(cyl(0.11, 0.04, 8), GOLD_D, T([x, 0, z]))
    k.add(cyl(0.03, 0.62, 5), GOLD, T([x, 0.03, z]), 1, { shine: 1 })
    k.add(sphere(0.055, 6, 4), GOLD, T([x, 0.68, z]), 1, { shine: 1 })
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const [ax, az] = posts[i]
    const [bx, bz] = posts[i + 1]
    k.add(
      tube(
        [
          [ax, 0.6, az],
          [(ax + bx) / 2, 0.44, (az + bz) / 2],
          [bx, 0.6, bz],
        ],
        0.028,
        6,
        5,
      ),
      '#c41d3c',
    )
  }
  return k.mesh('ropes')
}

/** a gold trophy on a marble plinth (the 200 owned prize); `top` builds the attraction's own emblem on it at y */
export function trophy(top: (k: TKit, y: number) => void) {
  const k = new TKit()
  k.add(rbox(0.7, 0.5, 0.7, 0.06), CREAM, T([0, 0.25, 0]))
  k.add(rbox(0.78, 0.08, 0.78, 0.03), GOLD, T([0, 0.52, 0]), 1, { shine: 1 })
  top(k, 0.56)
  return k.mesh('trophy')
}

/* ---------------- a tap bubble (manual attractions waiting for a tap) ---------------- */

let tapTex: THREE.CanvasTexture | null = null
/** the round "tap me" bubble shown over an attraction that waits for a tap to run */
export function tapTexture() {
  return (tapTex ??= canvasTexture(256, 256, (g) => {
    g.fillStyle = 'rgba(20, 12, 40, 0.35)'
    g.beginPath()
    g.arc(128, 136, 108, 0, TAU)
    g.fill()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#22153a'
    g.lineWidth = 12
    g.beginPath()
    g.arc(128, 124, 100, 0, TAU)
    g.fill()
    g.stroke()
    // a play triangle in gold
    g.fillStyle = '#ffb81f'
    g.strokeStyle = '#22153a'
    g.lineWidth = 10
    g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(98, 72)
    g.lineTo(178, 124)
    g.lineTo(98, 176)
    g.closePath()
    g.fill()
    g.stroke()
  }))
}

/* ---------------- the For sale sign ---------------- */

/** a For sale sign for plot `name` at `price` (already formatted): a big board on a post, facing +z */
export function forSaleSign(name: string, price: string) {
  const g = new THREE.Group()
  const k = new TKit()
  const W = 3.1
  const H = 1.85
  const Y = 1.05 + H / 2
  k.add(cyl(0.07, 1.1, 8), WOOD, T([0, 0, -0.07]))
  k.add(rbox(W, H, 0.14, 0.12), '#fff8ea', T([0, Y, -0.06]))
  k.add(rbox(W + 0.14, 0.14, 0.2, 0.06), WOOD, T([0, Y + H / 2 + 0.02, -0.06]))
  g.add(k.mesh('sale-board'))
  const face = textPlane(W - 0.16, H - 0.14, 640, (c, cw, ch) => {
    // a red banner across the top, the name small, the price big with a green note
    c.fillStyle = '#e8334f'
    roundRectPath(c, cw * 0.03, ch * 0.04, cw * 0.94, ch * 0.3, ch * 0.07)
    c.fill()
    c.fillStyle = '#ffffff'
    fitText(c, 'FOR SALE', cw / 2, ch * 0.195, ch * 0.23, cw * 0.86, 800, 0.1)
    c.fillStyle = '#6a5a7e'
    fitText(c, name.toUpperCase(), cw / 2, ch * 0.46, ch * 0.135, cw * 0.9, 800, 0.05)
    c.font = `800 ${ch * 0.32}px ${FONT}`
    const pw = c.measureText(price).width
    const nw = ch * 0.34
    const x0 = cw / 2 - (pw + nw + ch * 0.06) / 2
    c.fillStyle = '#2fbf62'
    roundRectPath(c, x0, ch * 0.63, nw, ch * 0.23, ch * 0.035)
    c.fill()
    c.strokeStyle = '#1d7a3e'
    c.lineWidth = ch * 0.018
    c.stroke()
    c.fillStyle = '#d6ffe2'
    c.beginPath()
    c.arc(x0 + nw / 2, ch * 0.745, ch * 0.06, 0, TAU)
    c.fill()
    c.fillStyle = '#22153a'
    c.textAlign = 'left'
    c.textBaseline = 'middle'
    c.fillText(price, x0 + nw + ch * 0.06, ch * 0.755)
  })
  face.userData.text = true
  face.position.set(0, Y, 0.02)
  g.add(face)
  return g
}

export const releaseProps = () => {
  tapTex?.dispose()
  tapTex = null
}

/** the tier an attraction shows its sign, ropes and trophy at */
export const SIGN_AT = 3
export const ROPES_AT = 4
export const TROPHY_AT = 5
