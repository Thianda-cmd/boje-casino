import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { conform, fan, toonRamp, type Ell, type P2, type P3 } from '../../../lib/three/toon'
import type { Action, KaijuId, KaijuRig } from '../types'
import { INK } from './palette'
import { CH, IMPACT, LOOPS, blank, strikeT, type Clip, type Mo } from './motion'

/*
  The kit every kaiju is built with. A kaiju is one skinned mesh: every part (a thigh, a dorsal plate, a tooth, an eye)
  is a primitive placed on one of the rig's joints (bones), in the toon style of the rest of the site: flat tones
  through a four-step ramp and an ink outline round every solid (an inverted hull, merged into the same geometry, so
  it bends with the part). Rigid parts are skinned wholly to their joint, so posing is just turning joints; tails,
  tentacles and the serpent's body are skinned along a chain of joints with the weights blended at each joint, so
  they bend in smooth curves. The whole kaiju, outline included, draws in a single call.

  Colour, light and glow are per vertex: `aFlat` shows a vertex in its exact colour, unlit (eyes, decals, the ink);
  `aGlow` marks the glowing parts (eyes, plates, scars, cracks, coils), with a number from 0 to 1 that is the part's
  place in the charge wave: as charge() rises the glow lights up in that order (Rexor's plates light from the tail tip
  to the head before the breath). Each rig has its own copy of the material (the program is shared), so its flash
  (a white hit flash that leaves the ink dark) and its charge are its own, and its glow pulses or crackles in its own
  way (`GlowStyle`: Bedrock's lava breathes, Voltra's lines crackle along its body).

  The pose machinery is in motion.ts (what each action looks like, as a set of channels: lean, twist, arms, legs,
  tail ...); each kaiju maps the channels onto its own joints (an `apply` function), so the same clips drive a biped,
  a kraken, a crab and a serpent. pose() eases between actions over `blend` seconds by blending the channels.
*/

export type Quality = 'high' | 'low'
export const TAU = Math.PI * 2
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => x * x * (3 - 2 * x)

/** the toon ramp: four flat tones, darkest first */
const RAMP = [70, 150, 220, 255]
/** a glowing part's colour is its glow colour this much over white, so it blooms */
const GLOW_GAIN = 1.75

/** position, rotation (radians, XYZ) and scale as a matrix */
export function T(p: P3 = [0, 0, 0], r: P3 = [0, 0, 0], s: number | P3 = 1) {
  const sc = typeof s === 'number' ? V(s, s, s) : V(...s)
  return new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sc)
}
/** a matrix that stands a +y shape on the segment a-b, centred on it (s scales it before) */
export function aim(a: P3, b: P3, s: P3 = [1, 1, 1]) {
  const A = V(...a)
  const B = V(...b)
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V(...s))
}
/** mirrors a point across x (the other side of the body) */
export const mx = (p: P3, s: number): P3 => [p[0] * s, p[1], p[2]]

/* ------------------------------------------------------------------ */
/*  Primitives                                                          */
/* ------------------------------------------------------------------ */

export const sphere = (q: Quality, w = 18, h = 12) => new THREE.SphereGeometry(1, q === 'low' ? Math.max(8, w >> 1) : w, q === 'low' ? Math.max(6, h >> 1) : h)

/** a capsule from a to b, radius r0 at a and r1 at b (a tapered limb): a lathe of two half circles joined by a cone */
export function capsule(a: P3, b: P3, r0: number, r1 = r0, q: Quality = 'high', radial = 14) {
  const A = V(...a)
  const B = V(...b)
  const len = Math.max(0.001, A.distanceTo(B))
  const pts: THREE.Vector2[] = []
  const n = q === 'low' ? 3 : 5
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.cos(t) * r0, -len / 2 + Math.sin(t) * r0))
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.cos(t) * r1, len / 2 + Math.sin(t) * r1))
  }
  pts[0].x = 0
  pts[pts.length - 1].x = 0
  const g = new THREE.LatheGeometry(pts, q === 'low' ? Math.max(7, radial >> 1) : radial)
  g.applyMatrix4(aim(a, b))
  return g
}

/** a cone from its base centre a to its tip b, base radius r (a horn, a claw, a spike) */
export function cone(a: P3, b: P3, r: number, q: Quality = 'high', radial = 10, curve = 0) {
  const A = V(...a)
  const B = V(...b)
  const len = Math.max(0.001, A.distanceTo(B))
  // a lathe so the cone can bow (curve > 0: fatter near the base, like a fang)
  const pts: THREE.Vector2[] = []
  const n = 5
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const rr = r * (1 - t) * (1 + curve * t)
    pts.push(new THREE.Vector2(i === n ? 0 : Math.max(0.0001, rr), -len / 2 + t * len))
  }
  pts.unshift(new THREE.Vector2(0, -len / 2))
  const g = new THREE.LatheGeometry(pts, q === 'low' ? Math.max(5, radial >> 1) : radial)
  g.applyMatrix4(aim(a, b))
  return g
}

/** a rounded box */
export const rbox = (w: number, h: number, d: number, r: number, q: Quality = 'high') => new RoundedBoxGeometry(w, h, d, q === 'low' ? 1 : 2, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))

/** a cheap deterministic hash, 0 to 1 */
export const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** a faceted rock: an icosahedron with its corners pushed in and out (the same rock for the same seed) */
export function rock(seed: number, rough = 0.22, q: Quality = 'high') {
  const g = new THREE.IcosahedronGeometry(1, q === 'low' ? 0 : 1)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  // corners shared by several faces must move together, so key the push on the position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const k = 1 + (hash(Math.round(x * 100) + seed * 7.3, Math.round(y * 100) * 1.7 + Math.round(z * 100) * 3.1) - 0.5) * 2 * rough
    p.setXYZ(i, x * k, y * k, z * k)
  }
  return g
}

/** a flat outline extruded to a plate of thickness d, centred on z = 0, with softly bevelled edges */
export function plate(pts: P2[], d: number, bevel = 0.3, q: Quality = 'high') {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  const b = d * bevel
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: q === 'low' ? 1 : 2, curveSegments: q === 'low' ? 4 : 8 })
  g.translate(0, 0, -(d - 2 * b) / 2)
  return g
}

/** a tube along a smooth curve through `pts`, its radius from r(0) to r(1) along it, closed with round ends */
export function tube(pts: P3[], r: (t: number) => number, q: Quality = 'high', seg = 24, radial = 12) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)))
  const S = q === 'low' ? Math.max(6, seg >> 1) : seg
  const R = q === 'low' ? Math.max(6, radial >> 1) : radial
  const g = new THREE.TubeGeometry(curve, S, 1, R, false)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const c = V()
  const v = V()
  for (let i = 0; i <= S; i++) {
    curve.getPointAt(i / S, c)
    const rr = r(i / S)
    for (let j = 0; j <= R; j++) {
      const k = i * (R + 1) + j
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(rr).add(c)
      p.setXYZ(k, v.x, v.y, v.z)
    }
  }
  g.deleteAttribute('normal')
  g.computeVertexNormals()
  const ends = [0, 1].map((t) => {
    const s = sphere(q, 12, 8)
    s.applyMatrix4(T(curve.getPointAt(t).toArray() as P3, [0, 0, 0], r(t)))
    return s
  })
  return { geo: g, ends, curve }
}

/** an arc of a torus (a coil, a ring), radius R, tube radius r, from angle a0 to a1 about z */
export const torusArc = (R: number, r: number, arc: number, q: Quality = 'high', seg = 32) => new THREE.TorusGeometry(R, r, q === 'low' ? 7 : 12, q === 'low' ? Math.max(10, seg >> 1) : seg, arc)

/** an ellipse outline, n points */
export const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 18): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * TAU
    const x = Math.cos(a) * rx
    const y = Math.sin(a) * ry
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]
  })

/** a flat shape painted onto the front of an ellipsoid (an eye, a scar, a belly scale), `lift` above it */
export function decalGeo(e: Ell, pts: P2[], lift: number, rings = 3) {
  return conform(fan(pts, undefined, rings), e, lift)
}

/** a ribbon of width w along a path, thinning to points at both ends (a pen stroke, a crack, a vein) */
export function stroke(path0: P2[], w: number, taper = 0.3, step = 0.08) {
  const path: P2[] = [path0[0]]
  for (let i = 1; i < path0.length; i++) {
    const [ax, ay] = path0[i - 1]
    const [bx, by] = path0[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let j = 1; j <= n; j++) path.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n])
  }
  const pos: number[] = []
  const n = path.length
  const side = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(n - 1, i + 1)]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    const t = i / (n - 1)
    const end = taper > 0 ? Math.min(t, 1 - t) / taper : 1
    const half = (w / 2) * Math.sqrt(Math.min(1, Math.max(0.15, end)))
    return [p[0] - (ty / l) * half, p[1] + (tx / l) * half, p[0] + (ty / l) * half, p[1] - (tx / l) * half]
  })
  for (let i = 0; i < n - 1; i++) {
    const [lx, ly, rx, ry] = side[i]
    const [lx2, ly2, rx2, ry2] = side[i + 1]
    pos.push(rx, ry, 0, rx2, ry2, 0, lx, ly, 0, lx, ly, 0, rx2, ry2, 0, lx2, ly2, 0)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/* ------------------------------------------------------------------ */
/*  The body: joints and parts, baked into one skinned mesh            */
/* ------------------------------------------------------------------ */

/** how a part is drawn */
export interface Look {
  /** outline thickness in world units; 0 for none (default: the body's) */
  ink?: number
  /** shown in its exact colour, unlit */
  flat?: boolean
  /** a glowing part (flat, over-bright, lit up by charge()); the number is its place in the charge wave, 0 lights first */
  glow?: number
  /** faceted shading (rock): flat normals for the light, smooth ones for the outline */
  facet?: boolean
}

interface Part {
  pos: Float32Array
  nrm: Float32Array
  col: [number, number, number]
  flat: number
  glow: number
  ink: number
  si: Uint16Array
  sw: Float32Array
}

/** smooth normals for the outline: every corner at one place gets the average of the faces round it */
function smoothNormals(pos: Float32Array) {
  const acc = new Map<string, [number, number, number]>()
  const key = (i: number) => `${Math.round(pos[i] * 2000)},${Math.round(pos[i + 1] * 2000)},${Math.round(pos[i + 2] * 2000)}`
  const keys: string[] = []
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i]
    const ay = pos[i + 4] - pos[i + 1]
    const az = pos[i + 5] - pos[i + 2]
    const bx = pos[i + 6] - pos[i]
    const by = pos[i + 7] - pos[i + 1]
    const bz = pos[i + 8] - pos[i + 2]
    const nx = ay * bz - az * by
    const ny = az * bx - ax * bz
    const nz = ax * by - ay * bx
    for (let j = 0; j < 3; j++) {
      const k = key(i + j * 3)
      keys.push(k)
      const a = acc.get(k)
      if (a) {
        a[0] += nx
        a[1] += ny
        a[2] += nz
      } else acc.set(k, [nx, ny, nz])
    }
  }
  const out = new Float32Array(pos.length)
  keys.forEach((k, v) => {
    const a = acc.get(k)!
    const l = Math.hypot(a[0], a[1], a[2]) || 1
    out[v * 3] = a[0] / l
    out[v * 3 + 1] = a[1] / l
    out[v * 3 + 2] = a[2] / l
  })
  return out
}

/**
 * Welds the corners smooth surfaces share into one indexed vertex each, so the GPU skins and shades every corner once
 * instead of up to six times. Only corners inside one chunk (a part, or its outline) can merge, and only when their
 * place, normal and skinning match, so a part never sticks to its neighbour. A hash of the quantised values finds the
 * candidates, which is many times quicker than three's mergeVertices on a whole kaiju.
 */
function weld(a: { pos: Float32Array; nrm: Float32Array; col: Float32Array; flat: Float32Array; glow: Float32Array; si: Uint16Array; sw: Float32Array }, chunks: [number, number][]) {
  const n = a.pos.length / 3
  const index = new Uint32Array(n)
  const src = new Int32Array(n)
  const q = (x: number, k: number) => Math.round(x * k)
  const same = (u: number, v: number) => {
    for (let k = 0; k < 3; k++) if (q(a.pos[u * 3 + k], 1e4) !== q(a.pos[v * 3 + k], 1e4) || q(a.nrm[u * 3 + k], 1e3) !== q(a.nrm[v * 3 + k], 1e3)) return false
    return a.si[u * 4] === a.si[v * 4] && a.si[u * 4 + 1] === a.si[v * 4 + 1] && q(a.sw[u * 4], 1e3) === q(a.sw[v * 4], 1e3)
  }
  let out = 0
  for (const [lo, hi] of chunks) {
    const map = new Map<number, number[]>()
    for (let v = lo; v < hi; v++) {
      const h =
        Math.imul(q(a.pos[v * 3], 1e4), 73856093) ^
        Math.imul(q(a.pos[v * 3 + 1], 1e4), 19349663) ^
        Math.imul(q(a.pos[v * 3 + 2], 1e4), 83492791) ^
        Math.imul(q(a.nrm[v * 3], 1e3) + q(a.nrm[v * 3 + 1], 1e3) * 3 + q(a.nrm[v * 3 + 2], 1e3) * 7, 2654435761 | 0) ^
        Math.imul(a.si[v * 4] + 1, 40503)
      let bucket = map.get(h)
      let hit = -1
      if (bucket) {
        for (const o of bucket)
          if (same(src[o], v)) {
            hit = o
            break
          }
      } else map.set(h, (bucket = []))
      if (hit < 0) {
        hit = out++
        src[hit] = v
        bucket.push(hit)
      }
      index[v] = hit
    }
  }
  const pick = <A extends Float32Array | Uint16Array>(arr: A, w: number, make: (len: number) => A) => {
    const r = make(out * w)
    for (let o = 0; o < out; o++) for (let k = 0; k < w; k++) r[o * w + k] = arr[src[o] * w + k]
    return r
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pick(a.pos, 3, (l) => new Float32Array(l)), 3))
  g.setAttribute('normal', new THREE.BufferAttribute(pick(a.nrm, 3, (l) => new Float32Array(l)), 3))
  g.setAttribute('color', new THREE.BufferAttribute(pick(a.col, 3, (l) => new Float32Array(l)), 3))
  g.setAttribute('aFlat', new THREE.BufferAttribute(pick(a.flat, 1, (l) => new Float32Array(l)), 1))
  g.setAttribute('aGlow', new THREE.BufferAttribute(pick(a.glow, 1, (l) => new Float32Array(l)), 1))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(pick(a.si, 4, (l) => new Uint16Array(l)), 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(pick(a.sw, 4, (l) => new Float32Array(l)), 4))
  g.setIndex(new THREE.BufferAttribute(out > 65535 ? index : Uint16Array.from(index), 1))
  return g
}

export class Body {
  readonly root: THREE.Bone
  readonly bones: THREE.Bone[] = []
  private readonly parts: Part[] = []
  private readonly inkColor = new THREE.Color(INK)

  constructor(
    /** the default outline thickness */
    readonly ink: number,
    readonly q: Quality,
  ) {
    this.root = this.joint('root', null, 0, 0, 0)
  }

  /** a joint at (x, y, z) in its parent's frame (the root's when parent is null) */
  joint(name: string, parent: THREE.Bone | null, x: number, y: number, z: number) {
    const b = new THREE.Bone()
    b.name = name
    b.position.set(x, y, z)
    b.userData.rest = b.position.clone()
    if (parent) parent.add(b)
    else if (this.root) this.root.add(b)
    this.bones.push(b)
    return b
  }

  /** the joint's frame in the model, at rest */
  frame(j: THREE.Bone) {
    j.updateWorldMatrix(true, false)
    return j.matrixWorld.clone()
  }

  /** where a point given in a joint's frame is in the model, at rest */
  at(j: THREE.Bone, p: P3): P3 {
    return V(...p).applyMatrix4(this.frame(j)).toArray() as P3
  }

  private push(g0: THREE.BufferGeometry, color: THREE.ColorRepresentation, look: Look | undefined, weights: (x: number, y: number, z: number, si: Uint16Array, sw: Float32Array, o: number) => void, flip: boolean) {
    const g = g0.index ? g0.toNonIndexed() : g0
    if (look?.facet || !g.getAttribute('normal')) {
      g.deleteAttribute('normal')
      g.computeVertexNormals()
    }
    const p = g.getAttribute('position') as THREE.BufferAttribute
    const n = g.getAttribute('normal') as THREE.BufferAttribute
    // drop the zero-area triangles primitives leave at their poles, and put back the winding a mirror turned over
    const keep: number[] = []
    for (let i = 0; i < p.count; i += 3) {
      const ax = p.getX(i + 1) - p.getX(i)
      const ay = p.getY(i + 1) - p.getY(i)
      const az = p.getZ(i + 1) - p.getZ(i)
      const bx = p.getX(i + 2) - p.getX(i)
      const by = p.getY(i + 2) - p.getY(i)
      const bz = p.getZ(i + 2) - p.getZ(i)
      const cx = ay * bz - az * by
      const cy = az * bx - ax * bz
      const cz = ax * by - ay * bx
      if (cx * cx + cy * cy + cz * cz > 1e-16) keep.push(...(flip ? [i, i + 2, i + 1] : [i, i + 1, i + 2]))
    }
    const N = keep.length
    const pos = new Float32Array(N * 3)
    const nrm = new Float32Array(N * 3)
    const si = new Uint16Array(N * 4)
    const sw = new Float32Array(N * 4)
    keep.forEach((v, j) => {
      const x = p.getX(v)
      const y = p.getY(v)
      const z = p.getZ(v)
      pos[j * 3] = x
      pos[j * 3 + 1] = y
      pos[j * 3 + 2] = z
      nrm[j * 3] = n.getX(v)
      nrm[j * 3 + 1] = n.getY(v)
      nrm[j * 3 + 2] = n.getZ(v)
      weights(x, y, z, si, sw, j * 4)
    })
    g.dispose()
    if (g !== g0) g0.dispose()
    const glow = look?.glow ?? -1
    const c = new THREE.Color(color)
    if (glow >= 0) c.multiplyScalar(GLOW_GAIN)
    this.parts.push({ pos, nrm, col: [c.r, c.g, c.b], flat: look?.flat || glow >= 0 ? 1 : 0, glow, ink: look?.ink ?? (look?.flat || glow >= 0 ? 0 : this.ink), si, sw })
  }

  /** a rigid part on a joint, given in that joint's frame (m places it there) */
  add(j: THREE.Bone, geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, look?: Look) {
    const M = this.frame(j)
    if (m) M.multiply(m)
    geo.applyMatrix4(M)
    const idx = this.bones.indexOf(j)
    this.push(geo, color, look, (_x, _y, _z, si, sw, o) => {
      si[o] = idx
      sw[o] = 1
    }, M.determinant() < 0)
    return this
  }

  /** an ellipsoid on a joint: centre c, radii r, turned by rot */
  ell(j: THREE.Bone, c: P3, r: P3, color: THREE.ColorRepresentation, rot: P3 = [0, 0, 0], look?: Look, seg: [number, number] = [18, 12]) {
    return this.add(j, sphere(this.q, ...seg), color, T(c, rot, r), look)
  }

  /** a tapered capsule on a joint from a to b */
  cap(j: THREE.Bone, a: P3, b: P3, r0: number, r1: number, color: THREE.ColorRepresentation, look?: Look) {
    return this.add(j, capsule(a, b, r0, r1, this.q), color, undefined, look)
  }

  /** a cone on a joint, base a to tip b (a claw, a horn, a tooth, a spike) */
  spike(j: THREE.Bone, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, look?: Look, curve = 0) {
    return this.add(j, cone(a, b, r, this.q, 9, curve), color, undefined, look)
  }

  /** a flat shape painted onto an ellipsoid that sits on joint j (both in j's frame) */
  paint(j: THREE.Bone, e: Ell, pts: P2[], color: THREE.ColorRepresentation, lift: number, look: Look = { flat: true }, m?: THREE.Matrix4) {
    return this.add(j, decalGeo(e, pts, lift), color, m, { ink: 0, ...look })
  }

  /** a part that bends along a chain of joints: given in the model at rest (m places it), skinned along the chain */
  bend(chain: THREE.Bone[], geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, look?: Look) {
    if (m) geo.applyMatrix4(m)
    const P = chain.map((b) => V().setFromMatrixPosition(this.frame(b)))
    const idx = chain.map((b) => this.bones.indexOf(b))
    const n = chain.length - 1
    const v = V()
    const d = V()
    const w = (x: number, y: number, z: number, si: Uint16Array, sw: Float32Array, o: number) => {
      // where along the chain the point lies: segment i from joint i to i + 1 belongs to joint i
      let best = Infinity
      let s = 0
      for (let i = 0; i < n; i++) {
        d.subVectors(P[i + 1], P[i])
        const l2 = d.lengthSq() || 1e-9
        v.set(x, y, z).sub(P[i])
        const f = v.dot(d) / l2
        const fc = Math.min(1, Math.max(0, f))
        const dist = v.addScaledVector(d, -fc).lengthSq()
        if (dist < best - 1e-9) {
          best = dist
          // past the last joint is the tip joint's own
          s = i === n - 1 && f > 1 ? n - 1 + f : i + fc
        }
      }
      if (n === 0) s = 0
      // blend between neighbouring joints over a band either side of each joint
      const bw = 0.42
      const b = Math.min(n, Math.max(0, Math.floor(s)))
      const f = s - b
      si[o] = idx[b]
      sw[o] = 1
      if (f < bw && b > 0) {
        const k = smooth(clamp01((f + bw) / (2 * bw)))
        sw[o] = k
        si[o + 1] = idx[b - 1]
        sw[o + 1] = 1 - k
      } else if (f > 1 - bw && b < n) {
        const k = smooth(clamp01((f - (1 - bw)) / (2 * bw)))
        sw[o] = 1 - k
        si[o + 1] = idx[b + 1]
        sw[o + 1] = k
      }
    }
    this.push(geo, color, look, w, m !== undefined && m.determinant() < 0)
    return this
  }

  /** bakes every part and its outline into one geometry and makes the skinned mesh, in `group` */
  bake(name: string, mat: THREE.Material, group: THREE.Object3D) {
    let count = 0
    for (const p of this.parts) count += (p.pos.length / 3) * (p.ink > 0 ? 2 : 1)
    const pos = new Float32Array(count * 3)
    const nrm = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const flat = new Float32Array(count)
    const glow = new Float32Array(count)
    const si = new Uint16Array(count * 4)
    const sw = new Float32Array(count * 4)
    let o = 0
    const ink = this.inkColor
    const chunks: [number, number][] = []
    for (const p of this.parts) {
      const nv = p.pos.length / 3
      chunks.push([o, o + nv])
      pos.set(p.pos, o * 3)
      nrm.set(p.nrm, o * 3)
      si.set(p.si, o * 4)
      sw.set(p.sw, o * 4)
      for (let i = 0; i < nv; i++) {
        col[(o + i) * 3] = p.col[0]
        col[(o + i) * 3 + 1] = p.col[1]
        col[(o + i) * 3 + 2] = p.col[2]
        flat[o + i] = p.flat
        glow[o + i] = p.glow
      }
      o += nv
    }
    for (const p of this.parts) {
      if (p.ink <= 0) continue
      // the outline: the surface pushed out along smoothed normals, triangles turned inside out, in ink
      const hn = smoothNormals(p.pos)
      const nv = p.pos.length / 3
      for (let i = 0; i < nv; i++) {
        // swap the 2nd and 3rd corner of every triangle
        const r = i % 3
        const src = r === 1 ? i + 1 : r === 2 ? i - 1 : i
        const d = o + i
        pos[d * 3] = p.pos[src * 3] + hn[src * 3] * p.ink
        pos[d * 3 + 1] = p.pos[src * 3 + 1] + hn[src * 3 + 1] * p.ink
        pos[d * 3 + 2] = p.pos[src * 3 + 2] + hn[src * 3 + 2] * p.ink
        nrm[d * 3] = -hn[src * 3]
        nrm[d * 3 + 1] = -hn[src * 3 + 1]
        nrm[d * 3 + 2] = -hn[src * 3 + 2]
        col[d * 3] = ink.r
        col[d * 3 + 1] = ink.g
        col[d * 3 + 2] = ink.b
        flat[d] = 1
        glow[d] = -1
        for (let k = 0; k < 4; k++) {
          si[d * 4 + k] = p.si[src * 4 + k]
          sw[d * 4 + k] = p.sw[src * 4 + k]
        }
      }
      chunks.push([o, o + nv])
      o += nv
    }
    this.parts.length = 0
    const welded = weld({ pos, nrm, col, flat, glow, si, sw }, chunks)
    const mesh = new THREE.SkinnedMesh(welded, mat)
    mesh.name = name
    mesh.frustumCulled = false
    group.add(mesh, this.root)
    group.updateMatrixWorld(true)
    const skeleton = new THREE.Skeleton(this.bones)
    mesh.bind(skeleton)
    return { mesh, skeleton, vertices: welded.getAttribute('position').count }
  }
}

/* ------------------------------------------------------------------ */
/*  The material                                                        */
/* ------------------------------------------------------------------ */

/** how a kaiju's glow lives: pulse speed (rad/s) and depth, a crackle running along it, its resting brightness, and
 *  how much brighter a part burns once the charge reaches it (1.5 by default; less for a kaiju that glows all over) */
export interface GlowStyle {
  pulse: number
  depth: number
  crackle: number
  base: number
  boost?: number
}

export function kaijuMaterial(style: GlowStyle) {
  const u = {
    uFlash: { value: 0 },
    uCharge: { value: 0 },
    uTime: { value: 0 },
    uBase: { value: 1 },
    uBoost: { value: style.boost ?? 1.5 },
    uStyle: { value: new THREE.Vector4(style.pulse, style.depth, style.crackle, style.base) },
  }
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(RAMP) })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, u)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlat;\nattribute float aGlow;\nvarying float vFlat;\nvarying float vGlow;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlat = aFlat;\nvGlow = aGlow;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFlash;\nuniform float uCharge;\nuniform float uTime;\nuniform float uBase;\nuniform float uBoost;\nuniform vec4 uStyle;\nvarying float vFlat;\nvarying float vGlow;')
      .replace(
        '#include <opaque_fragment>',
        `outgoingLight = mix(outgoingLight, diffuseColor.rgb, vFlat);
        if (vGlow > -0.5) {
          // the charge wave: each glowing part lights up in turn as the charge rises
          float lit = smoothstep(vGlow * 0.7 - 0.05, vGlow * 0.7 + 0.25, uCharge);
          float pulse = 1.0 - uStyle.y * (0.5 + 0.5 * sin(uTime * uStyle.x + vGlow * 11.0));
          float crack = uStyle.z * pow(max(0.0, sin(vGlow * 37.0 - uTime * 9.0)), 14.0);
          outgoingLight *= uStyle.w * uBase * pulse + crack + lit * uBoost;
        }
        // a hit flashes the body white; the ink stays dark
        float isInk = vFlat * step(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 0.03);
        outgoingLight = mix(outgoingLight, vec3(0.92, 0.9, 0.86), uFlash * 0.9 * (1.0 - isInk));
        #include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'kaiju-rig'
  return { mat: m, u }
}

/* ------------------------------------------------------------------ */
/*  The rig                                                             */
/* ------------------------------------------------------------------ */

const WRAP = new Set(['pitch', 'roll', 'yaw'])
const wrapA = (a: number) => a - TAU * Math.round(a / TAU)

export interface RigSpec {
  id: KaijuId
  body: Body
  /** the model is built in its own units and drawn this much bigger */
  scale?: number
  height: number
  mouth: THREE.Object3D
  strikers: THREE.Object3D[]
  glow: GlowStyle
  /** which striker each attack strikes with (an index into strikers) */
  hits: Partial<Record<Action, number>>
  clips: Record<Action, Clip>
  /** sets the joints from the blended channels; `time` drives the idle life (breathing, sway) */
  apply: (m: Mo, time: number) => void
}

/** Puts a built kaiju together: the skinned mesh, the material, and pose() blending the clips' channels. */
export function makeRig(s: RigSpec): KaijuRig & { mesh: THREE.SkinnedMesh; vertices: number; channels: Mo } {
  const group = new THREE.Group()
  group.name = `kaiju-${s.id}`
  group.userData.hits = s.hits
  // the model's own scale lives on a holder inside the group, so the stage owns the group's transform outright
  const holder = new THREE.Group()
  holder.scale.setScalar(s.scale ?? 1)
  group.add(holder)
  const { mat, u } = kaijuMaterial(s.glow)
  const { mesh, skeleton, vertices } = s.body.bake(s.id, mat, holder)
  const cur = blank()
  const from = blank()
  const target = blank()
  let last: Action | null = null
  let lastT = 0
  let lastTime = -Infinity
  let t0 = -Infinity
  let blendS = 0
  let charged = 0

  const pose = (action: Action, t: number, time: number, blend = 0.18) => {
    const loop = LOOPS.has(action)
    if (time < lastTime - 0.25) t0 = -Infinity
    const restart = action !== last || (!loop && t < lastT - 0.2)
    if (restart) {
      if (last !== null && blend > 0) {
        for (const c of CH) from[c] = WRAP.has(c) ? wrapA(cur[c]) : cur[c]
        t0 = time
        blendS = blend
      } else blendS = 0
    }
    last = action
    lastT = t
    lastTime = time
    // a strike is re-timed so its blow lands where the fight script lands it (motion.ts IMPACT)
    s.clips[action](target, loop ? t - Math.floor(t) : strikeT(action, clamp01(t)), time)
    const w = blendS > 0 && time - t0 < blendS ? smooth(clamp01((time - t0) / blendS)) : 1
    if (w >= 1) for (const c of CH) cur[c] = target[c]
    else
      for (const c of CH) {
        const a = from[c]
        const d = WRAP.has(c) ? wrapA(target[c] - a) : target[c] - a
        cur[c] = a + d * w
      }
    s.apply(cur, time)
    u.uTime.value = time
    u.uCharge.value = Math.max(charged, cur.glow)
    u.uBase.value = 1 + Math.min(0, cur.glow) * 0.75
  }

  const rig = {
    id: s.id,
    group,
    height: s.height,
    reach: 0,
    mouth: s.mouth,
    strikers: s.strikers,
    pose,
    charge(k: number) {
      charged = clamp01(k)
      u.uCharge.value = Math.max(charged, cur.glow)
    },
    flash(k: number) {
      u.uFlash.value = clamp01(k)
    },
    dispose() {
      mesh.geometry.dispose()
      mat.dispose()
      skeleton.dispose()
      group.clear()
    },
    mesh,
    vertices,
    channels: cur,
  }
  // how far the jab reaches: pose it at the moment it lands and measure the fist from the centre
  pose('jab', IMPACT.jab ?? 0.42, 0, 0)
  group.updateMatrixWorld(true)
  const p = group.worldToLocal(s.strikers[0].getWorldPosition(V()))
  rig.reach = Math.round(Math.hypot(p.x, p.z) * 100) / 100
  last = null
  pose('idle', 0, 0, 0)
  return rig
}
