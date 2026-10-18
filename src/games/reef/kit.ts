import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { centroid, conform, ellipsePts, fan, fatten, shell, surfaceZ, type Ell, type Geo, type P2, type P3 } from '../../lib/three/toon'

/*
  The Reef Raid model kit. Creatures are built like the rest of the site's toon cast (colour per vertex, a stepped toon
  ramp and an inverted-hull ink outline merged into the same mesh, see lib/three/toon.ts), but every vertex also
  carries how it moves, so a whole school swims in one instanced draw with its animation done in the vertex shader:

  - aW1, aW2: two sway channels. xyz is how far the vertex moves at full swing and w its phase; the shader moves it by
    xyz · sin(clock · beat + w). Body waves, tail beats, fin flaps, wing strokes, tentacle ripples and bell pulses are
    all one of these, with the amplitude and phase painted onto each vertex by the species' rig.
  - aPose: where the vertex moves to at the instance's pose = 1 (the puffer puffing up, the octopus squeezing for a
    jet, the chest lid flying open), mixed in by a per-instance value.
  - aFx: x flat (shown unlit, like VKit's aFlat), y glow (lights up and pulses), z gold shine, w the face layer
    (FACE: always shown, the open eyes, the blink, the dizzy caught face, the calm face it replaces, the white of an
    eye shared by the open and dizzy looks).

  `RKit` builds such a geometry: add solids and decals like VKit, mark what they belong to with part(tag) and
  layer(face), build sub-assemblies in a frame of their own with push(matrix) / pop(), then bake(rig) runs the rig over
  every vertex and appends the ink hulls (which copy their solid's motion, so outlines bend with the body). The baked
  geometry is compact for the GPU: welded (corners shared by smooth surfaces become one indexed vertex, so each is
  shaded once) and stored in half floats but for its positions.
  The rest of the file is geometry helpers in the style of Plunder Bay's kit: surfaces to paint onto, pen strokes,
  toy eyes, mouths, tapered tubes.
*/

export type { Ell, Geo, P2, P3 }

/** the ink of every outline and drawn line: a deep sea-night indigo */
export const INK = '#171338'
export const TAU = Math.PI * 2
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
/** flat white above 1: the hard glint in an eye, the shine on a wet back */
export const SHINE = C('#ffffff', 1.45)
export const SPARK = C('#ffffff', 1.2)
export const PUPIL = '#140f2c'
export const MOUTH = '#4a1030'
export const TONGUE = '#ff6f8e'
export const BLUSH = '#ff8fb0'
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
export const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** which face parts a solid belongs to; the shader shows each layer only in its state */
export const FACE = {
  /** always shown */
  always: 0,
  /** the open eyes: hidden during a blink and once caught */
  open: 1,
  /** the closed lids of a blink */
  blink: 2,
  /** the dizzy face of a caught creature (swirly eyes, an O mouth) */
  dizzy: 3,
  /** shown until caught (the smile the O mouth replaces) */
  calm: 4,
  /** the white of an eye: shown open and caught alike, hidden only for a blink */
  white: 5,
} as const
export type FaceLayer = (typeof FACE)[keyof typeof FACE]

/** how a solid is lit: flat = its exact colour, unlit; glow = how much it lights up (pulsing); shine = gold sweep */
export interface Look {
  flat?: boolean
  glow?: number
  shine?: number
}

/** what a rig writes for one vertex: the two sway channels (xyz how far, w phase) and the pose offset */
export interface Motion {
  w1: THREE.Vector4
  w2: THREE.Vector4
  pose: THREE.Vector3
}
/** paints the motion of one vertex from its rest position, normal and part tag (the motion arrives zeroed) */
export type Rig = (p: THREE.Vector3, n: THREE.Vector3, tag: number, out: Motion) => void

interface Solid {
  geo: Geo
  ink: number
}

/** builds a model as one geometry carrying colour, look, face layer and motion per vertex (see the top of the file) */
export class RKit {
  private readonly solids: Solid[] = []
  private readonly stack: THREE.Matrix4[] = []
  private tagNow = 0
  private faceNow: number = FACE.always
  private readonly inkC: THREE.Color

  constructor(
    ink: THREE.ColorRepresentation = INK,
    /** the default outline thickness */
    readonly out = 0.03,
  ) {
    this.inkC = new THREE.Color(ink)
  }

  /** solids added from now on belong to part `tag` (the rig moves them by it) */
  part(tag: number) {
    this.tagNow = tag
    return this
  }

  /** ... and to face layer `face` */
  layer(face: FaceLayer) {
    this.faceNow = face
    return this
  }

  /** builds what follows in a frame of its own, placed by `m` (inside the current frame), until pop() */
  push(m: THREE.Matrix4) {
    const top = this.stack[this.stack.length - 1]
    this.stack.push(top ? top.clone().multiply(m) : m.clone())
    return this
  }

  pop() {
    this.stack.pop()
    return this
  }

  /** runs `build` twice: as it is, and mirrored across z = 0 (the creature's other side) */
  both(build: (side: 1 | -1) => void) {
    build(1)
    this.push(new THREE.Matrix4().makeScale(1, 1, -1))
    build(-1)
    this.pop()
    return this
  }

  /** a solid in one colour (times the geometry's own `color` attribute, if it has one); ink = hull thickness (0 = none) */
  add(geo: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4, ink = this.out, look: Look = {}) {
    const src = geo.index ? geo.toNonIndexed() : geo.clone()
    geo.dispose()
    const own = src.getAttribute('color')
    if (!src.getAttribute('normal')) src.computeVertexNormals()
    const top = this.stack[this.stack.length - 1]
    const mm = top && m ? top.clone().multiply(m) : (top ?? m)
    if (mm) src.applyMatrix4(mm)
    const p = src.getAttribute('position')
    const n = src.getAttribute('normal')
    const c = new THREE.Color(color)
    // a mirroring matrix turns triangles inside out, so put their winding back
    const flip = mm !== undefined && mm.determinant() < 0
    // drop the zero-area triangles primitives leave at their poles
    const keep: number[] = []
    const a = V()
    const b = V()
    for (let i = 0; i < p.count; i += 3) {
      a.set(p.getX(i + 1) - p.getX(i), p.getY(i + 1) - p.getY(i), p.getZ(i + 1) - p.getZ(i))
      b.set(p.getX(i + 2) - p.getX(i), p.getY(i + 2) - p.getY(i), p.getZ(i + 2) - p.getZ(i))
      if (a.cross(b).lengthSq() > 1e-14) keep.push(...(flip ? [i, i + 2, i + 1] : [i, i + 1, i + 2]))
    }
    const N = keep.length
    const pos = new Float32Array(N * 3)
    const nrm = new Float32Array(N * 3)
    const col = new Float32Array(N * 3)
    const fx = new Float32Array(N * 4)
    const fxv = [look.flat ? 1 : 0, look.glow ?? 0, look.shine ?? 0, this.faceNow]
    keep.forEach((v, j) => {
      pos.set([p.getX(v), p.getY(v), p.getZ(v)], j * 3)
      nrm.set([n.getX(v), n.getY(v), n.getZ(v)], j * 3)
      col.set(own ? [own.getX(v) * c.r, own.getY(v) * c.g, own.getZ(v) * c.b] : [c.r, c.g, c.b], j * 3)
      fx.set(fxv, j * 4)
    })
    src.dispose()
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4))
    g.setAttribute('aTag', new THREE.BufferAttribute(new Float32Array(N).fill(this.tagNow), 1))
    this.solids.push({ geo: g, ink })
    return this
  }

  /** a decal bent onto the front (+z) of an ellipsoid, with an ink rim; flat by default */
  decal(e: Ell, pts: P2[], color: THREE.ColorRepresentation, lift: number, rim = 0.012, center?: P2, flat = true) {
    const c = center ?? centroid(pts)
    const rings = Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.02)))
    if (rim > 0) this.add(conform(fan(fatten(pts, rim, c), c, 1), e, lift - 0.002), this.inkC, undefined, 0, { flat: true })
    return this.add(conform(fan(pts, c, rings), e, lift), color, undefined, 0, { flat })
  }

  /**
   * The finished geometry: position, normal, color, aFx, aW1, aW2, aPose, indexed. `rig` paints each solid vertex's
   * motion; then every solid with ink > 0 gets its hull (pushed out along the normals, inside out, in ink, flat)
   * carrying the same motion and face layer as the solid under it.
   */
  bake(rig?: Rig) {
    const m: Motion = { w1: new THREE.Vector4(), w2: new THREE.Vector4(), pose: V() }
    const p = V()
    const n = V()
    const parts: Geo[] = []
    const hulls: Geo[] = []
    for (const s of this.solids) {
      const g = s.geo
      const P = g.getAttribute('position')
      const Nn = g.getAttribute('normal')
      const tag = g.getAttribute('aTag')
      const count = P.count
      const w1 = new Float32Array(count * 4)
      const w2 = new Float32Array(count * 4)
      const pose = new Float32Array(count * 3)
      if (rig)
        for (let i = 0; i < count; i++) {
          p.fromBufferAttribute(P, i)
          n.fromBufferAttribute(Nn, i)
          m.w1.set(0, 0, 0, 0)
          m.w2.set(0, 0, 0, 0)
          m.pose.set(0, 0, 0)
          rig(p, n, tag.getX(i), m)
          w1.set([m.w1.x, m.w1.y, m.w1.z, m.w1.w], i * 4)
          w2.set([m.w2.x, m.w2.y, m.w2.z, m.w2.w], i * 4)
          pose.set([m.pose.x, m.pose.y, m.pose.z], i * 3)
        }
      g.deleteAttribute('aTag')
      g.setAttribute('aW1', new THREE.BufferAttribute(w1, 4))
      g.setAttribute('aW2', new THREE.BufferAttribute(w2, 4))
      g.setAttribute('aPose', new THREE.BufferAttribute(pose, 3))
      parts.push(g)
      if (s.ink > 0) hulls.push(this.hull(g, s.ink))
    }
    const merged = mergeGeometries([...parts, ...hulls])
    for (const g of [...parts, ...hulls]) g.dispose()
    this.solids.length = 0
    const out = halve(weld(merged))
    merged.dispose()
    return out
  }

  /** a solid's ink outline: pushed out along its normals, triangles reversed, normals negated, in flat ink */
  private hull(g: Geo, t: number) {
    const h = shell(g, t)
    for (const name of Object.keys(h.attributes)) {
      const attr = h.getAttribute(name)
      const a = attr.array as Float32Array
      const k = attr.itemSize
      // swap the 2nd and 3rd corner of every triangle
      for (let i = 0; i < a.length; i += 3 * k) {
        const tmp = a.slice(i + k, i + 2 * k)
        a.copyWithin(i + k, i + 2 * k, i + 3 * k)
        a.set(tmp, i + 2 * k)
      }
    }
    const nn = h.getAttribute('normal').array as Float32Array
    for (let i = 0; i < nn.length; i++) nn[i] = -nn[i]
    const col = h.getAttribute('color').array as Float32Array
    for (let i = 0; i < col.length; i += 3) col.set([this.inkC.r, this.inkC.g, this.inkC.b], i)
    // flat ink, no glow or shine; the face layer stays, so a hidden part's outline hides with it
    const fx = h.getAttribute('aFx').array as Float32Array
    for (let i = 0; i < fx.length; i += 4) {
      fx[i] = 1
      fx[i + 1] = 0
      fx[i + 2] = 0
    }
    return h
  }
}

/**
 * Indexes a non-indexed geometry, merging the vertices whose every attribute matches (to 1e-4). Smooth surfaces share
 * their corners, so this keeps about a third of the vertices. three's mergeVertices does the same through strings,
 * far too slowly for the reef's half a million; this hashes the numbers into an open-addressed table.
 */
function weld(g: THREE.BufferGeometry) {
  const names = Object.keys(g.attributes)
  const arrays = names.map((n) => g.getAttribute(n).array as Float32Array)
  const sizes = names.map((n) => g.getAttribute(n).itemSize)
  const count = g.getAttribute('position').count
  const q = (x: number) => Math.round(x * 1e4)
  const hashOf = (i: number) => {
    let h = 2166136261
    for (let a = 0; a < arrays.length; a++) {
      const arr = arrays[a]
      const s = sizes[a]
      for (let c = 0; c < s; c++) h = Math.imul(h ^ q(arr[i * s + c]), 16777619)
    }
    return h >>> 0
  }
  const same = (i: number, j: number) => {
    for (let a = 0; a < arrays.length; a++) {
      const arr = arrays[a]
      const s = sizes[a]
      for (let c = 0; c < s; c++) if (q(arr[i * s + c]) !== q(arr[j * s + c])) return false
    }
    return true
  }
  const cap = 2 ** Math.ceil(Math.log2(count * 2 + 2))
  const table = new Int32Array(cap).fill(-1)
  const first = new Uint32Array(count)
  const index = new Uint32Array(count)
  let n = 0
  for (let i = 0; i < count; i++) {
    for (let slot = hashOf(i) & (cap - 1); ; slot = (slot + 1) & (cap - 1)) {
      const u = table[slot]
      if (u < 0) {
        table[slot] = n
        first[n] = i
        index[i] = n++
        break
      }
      if (same(first[u], i)) {
        index[i] = u
        break
      }
    }
  }
  const out = new THREE.BufferGeometry()
  names.forEach((name, a) => {
    const s = sizes[a]
    const src = arrays[a]
    const dst = new Float32Array(n * s)
    for (let u = 0; u < n; u++) for (let c = 0; c < s; c++) dst[u * s + c] = src[first[u] * s + c]
    out.setAttribute(name, new THREE.BufferAttribute(dst, s))
  })
  out.setIndex(new THREE.BufferAttribute(n < 65536 ? Uint16Array.from(index) : index, 1))
  return out
}

/** every attribute but the position as half floats: plenty for normals, colours, looks and motion, at half the memory */
function halve(g: THREE.BufferGeometry) {
  for (const name of Object.keys(g.attributes)) {
    if (name === 'position') continue
    const a = g.getAttribute(name)
    const src = a.array as Float32Array
    const half = new Uint16Array(src.length)
    for (let i = 0; i < src.length; i++) half[i] = THREE.DataUtils.toHalfFloat(src[i])
    g.setAttribute(name, new THREE.Float16BufferAttribute(half, a.itemSize))
  }
  return g
}

/* ---------------- primitives ---------------- */

export const sphere = (w = 18, h = 12) => new THREE.SphereGeometry(1, w, h)

/** thin parts get fewer segments: they only ever cover a few pixels */
export function capsule(r: number, len: number) {
  return r >= 0.06 ? new THREE.CapsuleGeometry(r, len, 3, 12) : r >= 0.03 ? new THREE.CapsuleGeometry(r, len, 2, 9) : new THREE.CapsuleGeometry(r, len, 1, 6)
}

/** a matrix that stands a +y shape on the segment a-b, centred on it */
export function aim(a: THREE.Vector3 | P3, b: THREE.Vector3 | P3, s: P3 = [1, 1, 1]) {
  const A = Array.isArray(a) ? V(...a) : a
  const B = Array.isArray(b) ? V(...b) : b
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V(...s))
}

/** a capsule from a to b of radius r (its round ends centred on a and b) */
export function limb(k: RKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink?: number, look?: Look) {
  const len = Math.max(0.001, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  k.add(capsule(r, len), color, aim(a, b), ink, look)
}

/** an ellipsoid solid */
export function ell(k: RKit, e: Ell, color: THREE.ColorRepresentation, seg: [number, number] = [20, 14], ink?: number, rot: P3 = [0, 0, 0], look?: Look) {
  k.add(sphere(...seg), color, new THREE.Matrix4().compose(V(...e.c), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), V(...e.r)), ink, look)
}

/** a cone from its base centre to its tip */
export function horn(k: RKit, base: P3, tip: P3, r: number, color: THREE.ColorRepresentation, ink?: number, seg = 10, look?: Look) {
  const A = V(...base)
  const B = V(...tip)
  k.add(smooth(new THREE.ConeGeometry(r, A.distanceTo(B), seg, 2)), color, aim(A, B), ink, look)
}

/** smooth normals across shared corners (keeping colours), so the hull of a faceted shape stays closed */
export function smooth(g: Geo) {
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'color') g.deleteAttribute(key)
  const m = mergeVertices(g, 1e-5)
  m.computeVertexNormals()
  return m
}

/** an outline pushed out along z by `depth` (centred on z = 0) with a rounded bevel, smooth shaded for a closed hull */
export function slab(outline: P2[], depth: number, bevel = 0.01, curve = 6, bevelSegments = 1) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments: curve })
  g.translate(0, 0, -depth / 2)
  return smooth(g)
}

/** an outline's flat face (earcut, then split so no edge is longer than `step`), counter-clockwise, as positions */
function faceTris(outline: P2[], step: number) {
  const face = subdivide(new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))), step)
  const pos = face.getAttribute('position').array as Float32Array
  face.dispose()
  return pos
}

/** both faces of an outline, `z` either side of the plane, facing out (no rim): the inset colour of an edged fin */
function faces(outline: P2[], z: number, step: number) {
  const pos = faceTris(outline, step)
  const out: number[] = []
  for (let i = 0; i < pos.length; i += 9) {
    out.push(pos[i], pos[i + 1], z, pos[i + 3], pos[i + 4], z, pos[i + 6], pos[i + 7], z)
    out.push(pos[i], pos[i + 1], -z, pos[i + 6], pos[i + 7], -z, pos[i + 3], pos[i + 4], -z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  g.computeVertexNormals()
  return g
}

/**
 * A thin fin from an outline in the xy plane: a slab whose faces are split into small triangles, so a sway can bend
 * it (an extruded shape alone is a few long slivers that only ever move as a whole).
 */
export function fin(outline: P2[], depth: number, step = 0.1) {
  const pos = faceTris(outline, step)
  const out: number[] = []
  // the two faces, a little apart
  for (let i = 0; i < pos.length; i += 9) {
    out.push(pos[i], pos[i + 1], depth / 2, pos[i + 3], pos[i + 4], depth / 2, pos[i + 6], pos[i + 7], depth / 2)
    out.push(pos[i], pos[i + 1], -depth / 2, pos[i + 6], pos[i + 7], -depth / 2, pos[i + 3], pos[i + 4], -depth / 2)
  }
  // the rim between them, along the face's own boundary edges (so it shares every vertex with the faces and the
  // smoothed normals, and with them the outline, stay closed); the face winds counter-clockwise, so each boundary
  // edge a→b has the inside on its left
  const key = (x: number, y: number) => `${Math.round(x * 1e5)},${Math.round(y * 1e5)}`
  const edges = new Map<string, { ax: number; ay: number; bx: number; by: number; n: number }>()
  for (let i = 0; i < pos.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const ax = pos[i + j * 3]
      const ay = pos[i + j * 3 + 1]
      const bx = pos[i + ((j + 1) % 3) * 3]
      const by = pos[i + ((j + 1) % 3) * 3 + 1]
      const ka = key(ax, ay)
      const kb = key(bx, by)
      const id = ka < kb ? ka + '|' + kb : kb + '|' + ka
      const e = edges.get(id)
      if (e) e.n++
      else edges.set(id, { ax, ay, bx, by, n: 1 })
    }
  for (const { ax, ay, bx, by, n } of edges.values()) {
    if (n !== 1) continue
    out.push(ax, ay, -depth / 2, bx, by, -depth / 2, bx, by, depth / 2, ax, ay, -depth / 2, bx, by, depth / 2, ax, ay, depth / 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3))
  return smooth(g)
}

/** a lathe from (radius, y) points round the y axis */
export function lathe(pts: P2[], n = 18) {
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y)),
    n,
  )
}

/** a curve through points (centripetal Catmull-Rom) */
export const path3 = (pts: P3[], closed = false) => new THREE.CatmullRomCurve3(
  pts.map((p) => V(...p)),
  closed,
  'centripetal',
)

/**
 * A tube along a curve whose radius is rf(t) (t 0..1 along it), with round caps at both ends, only its far end
 * (a branch growing out of another), or none.
 */
export function tubeR(path: THREE.Curve<THREE.Vector3>, rf: (t: number) => number, seg = 16, radial = 8, caps: 'both' | 'end' | 'none' = 'both') {
  const g = new THREE.TubeGeometry(path, seg, 1, radial, false)
  const p = g.getAttribute('position')
  const c = V()
  for (let i = 0; i <= seg; i++) {
    path.getPointAt(i / seg, c)
    const r = Math.max(1e-4, rf(i / seg))
    for (let j = 0; j <= radial; j++) {
      const v = i * (radial + 1) + j
      p.setXYZ(v, c.x + (p.getX(v) - c.x) * r, c.y + (p.getY(v) - c.y) * r, c.z + (p.getZ(v) - c.z) * r)
    }
  }
  g.computeVertexNormals()
  const ball = (t: number) => {
    const c = path.getPointAt(t)
    return new THREE.SphereGeometry(Math.max(1e-3, rf(t)), radial, Math.max(3, radial >> 1)).translate(c.x, c.y, c.z)
  }
  const ends = caps === 'both' ? [ball(0), ball(1)] : caps === 'end' ? [ball(1)] : []
  const parts = [g, ...ends].map((x) => {
    const y = x.toNonIndexed()
    x.dispose()
    for (const key of Object.keys(y.attributes)) if (key !== 'position' && key !== 'normal') y.deleteAttribute(key)
    return y
  })
  return mergeGeometries(parts)
}

/** colours a geometry per vertex with f(position) (it is made non-indexed) */
export function shade(geo: Geo, f: (x: number, y: number, z: number) => THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const c = f(p.getX(i), p.getY(i), p.getZ(i))
    col.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** colours a geometry per triangle with f(centroid) (crisp edges; it is made non-indexed) */
export function tint(geo: Geo, f: (x: number, y: number, z: number) => THREE.Color) {
  const g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i += 3) {
    const c = f((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3)
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** bends a geometry: every point is moved by f(point) (in place; normals recomputed) */
export function warp(geo: Geo, f: (v: THREE.Vector3) => void) {
  const p = geo.getAttribute('position')
  const v = V()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    f(v)
    p.setXYZ(i, v.x, v.y, v.z)
  }
  geo.computeVertexNormals()
  return geo
}

/**
 * A band of an ellipsoid between x0 and x1 (a stripe round a fish), a hair outside the body so it shows over it.
 * Built from a sphere whose pole points along x, so the band's edges are clean rings.
 */
export function belt(e: Ell, x0: number, x1: number, grow = 1.012, seg = 22) {
  const t0 = Math.acos(Math.min(1, Math.max(-1, (x1 - e.c[0]) / e.r[0])))
  const t1 = Math.acos(Math.min(1, Math.max(-1, (x0 - e.c[0]) / e.r[0])))
  const rows = Math.max(2, Math.ceil(((t1 - t0) / Math.PI) * 24))
  const g = new THREE.SphereGeometry(1, seg, rows, 0, TAU, t0, t1 - t0)
  g.rotateZ(-Math.PI / 2)
  g.scale(e.r[0] * grow, e.r[1] * grow, e.r[2] * grow)
  g.translate(...e.c)
  return g
}

/**
 * A body of revolution along x (a whale, a shark): a profile of (radius, x) points turned round the x axis and
 * squashed to `zs` across. Its vertex columns sit every 360 / seg degrees round it, counted from the +z flank
 * (φ = 0; π/2 underneath, -π/2 on top), so colours split at those angles come out crisp.
 */
export class Spindle {
  constructor(
    readonly prof: P2[],
    readonly zs = 1,
    readonly seg = 32,
  ) {}

  /** the radius at x (0 off the ends) */
  radius(x: number) {
    const p = this.prof
    for (let i = 0; i < p.length - 1; i++) {
      const [r0, x0] = p[i]
      const [r1, x1] = p[i + 1]
      if (x >= x0 && x <= x1) return r0 + ((r1 - r0) * (x - x0)) / (x1 - x0 || 1)
    }
    return 0
  }

  /** the geometry, coloured per triangle by color(x, φ) */
  geometry(color: (x: number, phi: number) => THREE.Color) {
    const g = lathe(this.prof, this.seg)
    g.rotateZ(-Math.PI / 2)
    g.scale(1, 1, this.zs)
    return tint(g, (x, y, z) => color(x, Math.atan2(-y, z / this.zs)))
  }

  /** the surface point at x, φ round the body, and its normal */
  at(x: number, phi: number) {
    const r = this.radius(x)
    const dr = (this.radius(x + 0.004) - this.radius(x - 0.004)) / 0.008
    return { p: V(x, -r * Math.sin(phi), this.zs * r * Math.cos(phi)), n: V(-dr, -Math.sin(phi), Math.cos(phi) / this.zs).normalize() }
  }

  /** the +z flank, as a surface for decals */
  readonly flank: Surf = (x, y) => this.zs * Math.sqrt(Math.max(0, this.radius(x) ** 2 - y * y))
  /** the back, as a surface in a TOP frame (local x, y = model x, -z) */
  readonly back: Surf = (x, y) => Math.sqrt(Math.max(0, this.radius(x) ** 2 - (y / this.zs) ** 2))
}

/* ---------------- surfaces and decals ---------------- */

/** a surface seen from the front (+z), as z = f(x, y) */
export type Surf = (x: number, y: number) => number

export const ellSurf =
  (e: Ell): Surf =>
  (x, y) =>
    surfaceZ(e, x, y)
export const flatSurf =
  (z: number): Surf =>
  () =>
    z

/**
 * The front of any geometry as a surface: its +z-facing triangles rasterised into a height grid over its outline
 * (highest wins), read back bilinearly. For painting onto shapes that are no ellipsoid (a manta's wings, a shell).
 */
export function surfOf(geo: Geo, res = 96): Surf {
  const p = geo.getAttribute('position')
  geo.computeBoundingBox()
  const bb = geo.boundingBox!
  const x0 = bb.min.x
  const y0 = bb.min.y
  const sx = (bb.max.x - x0) / (res - 1)
  const sy = (bb.max.y - y0) / (res - 1)
  const H = new Float32Array(res * res).fill(-Infinity)
  const tri = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)] as const
  const count = geo.index ? geo.index.count : p.count
  const idx = (k: number) => (geo.index ? geo.index.getX(k) : k)
  for (let k = 0; k < count; k += 3) {
    const [ax, ay, az] = tri(idx(k))
    const [bx, by, bz] = tri(idx(k + 1))
    const [cx, cy, cz] = tri(idx(k + 2))
    const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(den) < 1e-12) continue
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / sx))
    const i1 = Math.min(res - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / sx))
    const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / sy))
    const j1 = Math.min(res - 1, Math.ceil((Math.max(ay, by, cy) - y0) / sy))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * sx
        const y = y0 + j * sy
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / den
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / den
        const w = 1 - u - v
        if (u < -1e-3 || v < -1e-3 || w < -1e-3) continue
        const z = u * az + v * bz + w * cz
        if (z > H[j * res + i]) H[j * res + i] = z
      }
  }
  // cells no triangle covered take their neighbours' height, so decals near the rim don't fall off a cliff
  for (let pass = 0; pass < 3; pass++)
    for (let j = 0; j < res; j++)
      for (let i = 0; i < res; i++) {
        if (H[j * res + i] > -Infinity) continue
        let s = 0
        let c = 0
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di
          const jj = j + dj
          if (ii < 0 || jj < 0 || ii >= res || jj >= res) continue
          const h = H[jj * res + ii]
          if (h > -Infinity) {
            s += h
            c++
          }
        }
        if (c) H[j * res + i] = s / c
      }
  return (x, y) => {
    const fx = Math.min(res - 1.001, Math.max(0, (x - x0) / sx))
    const fy = Math.min(res - 1.001, Math.max(0, (y - y0) / sy))
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const tx = fx - i
    const ty = fy - j
    const h = (a: number, b: number) => {
      const v = H[b * res + a]
      return v > -Infinity ? v : bb.min.z
    }
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - ty) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * ty
  }
}

/**
 * Splits a flat decal's triangles until no edge is longer than `maxEdge`, so it can follow a curved surface or a
 * sway under it (non-indexed, position only). Each edge is split or not as a whole, and every triangle is cut by how
 * many of its edges were, so neighbours always meet vertex to vertex (no T-junctions to tear the outline).
 */
export function subdivide(geo: Geo, maxEdge: number, maxPasses = 8) {
  const src = geo.index ? geo.toNonIndexed() : geo
  let pos = Array.from(src.getAttribute('position').array as Float32Array)
  if (src !== geo) src.dispose()
  const m2 = maxEdge * maxEdge
  const long = (p: number[], q: number[]) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2 > m2
  const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
  for (let pass = 0; pass < maxPasses; pass++) {
    // an edge's fate depends only on its two ends, so both triangles that share it agree
    const out: number[] = []
    let split = false
    for (let i = 0; i < pos.length; i += 9) {
      const a = pos.slice(i, i + 3)
      const b = pos.slice(i + 3, i + 6)
      const c = pos.slice(i + 6, i + 9)
      const sab = long(a, b)
      const sbc = long(b, c)
      const sca = long(c, a)
      if (!sab && !sbc && !sca) {
        out.push(...a, ...b, ...c)
        continue
      }
      split = true
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      if (sab && sbc && sca) out.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca)
      else if (sab && sbc) out.push(...ab, ...b, ...bc, ...a, ...ab, ...bc, ...a, ...bc, ...c)
      else if (sbc && sca) out.push(...bc, ...c, ...ca, ...a, ...b, ...bc, ...a, ...bc, ...ca)
      else if (sca && sab) out.push(...a, ...ab, ...ca, ...ab, ...b, ...c, ...ab, ...c, ...ca)
      else if (sab) out.push(...a, ...ab, ...c, ...ab, ...b, ...c)
      else if (sbc) out.push(...a, ...b, ...bc, ...a, ...bc, ...c)
      else out.push(...a, ...b, ...ca, ...ca, ...b, ...c)
    }
    pos = out
    if (!split) break
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** lifts a flat decal onto any surface, `lift` above it, facing outwards */
export function onto(g: Geo, f: Surf, lift: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const nrm = new Float32Array(p.count * 3)
  const h = 0.002
  const n = V()
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    n.set(-(f(x + h, y) - f(x - h, y)) / (2 * h), -(f(x, y + h) - f(x, y - h)) / (2 * h), 1).normalize()
    const z = f(x, y)
    p.setXYZ(i, x + n.x * lift, y + n.y * lift, z + n.z * lift)
    nrm.set([n.x, n.y, n.z], i * 3)
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return g
}

/** enough rings for a decal to follow the curve under it, and no more */
const ringsFor = (pts: P2[], c: P2) => Math.min(5, Math.max(1, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.03)))

/** a filled shape painted onto a surface; `flatLit` shows its colour unlit; `edge` splits it finer (for swaying parts) */
export function paint(k: RKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, flatLit = false, center?: P2, rings?: number, edge = Infinity, look: Look = {}) {
  const c = center ?? centroid(pts)
  const g = fan(pts, c, rings ?? ringsFor(pts, c))
  k.add(onto(Number.isFinite(edge) ? subdivide(g, edge) : g, f, lift), color, undefined, 0, { ...look, flat: flatLit })
}

/** a shape with an ink rim, painted onto a surface */
export function inked(k: RKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, rim = 0.012, flatLit = false, center?: P2, edge = Infinity) {
  const c = center ?? centroid(pts)
  paint(k, f, fatten(pts, rim, c), INK, lift - 0.0015, true, c, undefined, edge)
  paint(k, f, pts, color, lift, flatLit, c, undefined, edge)
}

/** a ribbon of width w along a path, thinning to rounded points at both ends (a pen stroke) */
export function strip(path: P2[], w: number, taper = 0.35) {
  const pos: number[] = []
  const n = path.length
  const side = path.map((p, i) => {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(n - 1, i + 1)]
    const tx = b[0] - a[0]
    const ty = b[1] - a[1]
    const l = Math.hypot(tx, ty) || 1
    const t = i / (n - 1)
    const end = Math.min(t, 1 - t) / taper
    const half = (w / 2) * (taper > 0 ? Math.sqrt(Math.min(1, Math.max(0.12, end))) : 1)
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

/** a pen stroke painted onto a surface (ink by default, unlit) */
export function stroke(k: RKit, f: Surf, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK, taper = 0.35, flatLit = true, look: Look = {}) {
  k.add(onto(strip(path, w, taper), f, lift), color, undefined, 0, { ...look, flat: flatLit })
}

export const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
export const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
/** a polyline through points, smoothed (Catmull-Rom) to n points */
export function curve2(pts: P2[], n = 16, closed = false): P2[] {
  if (closed) {
    const c = new THREE.CatmullRomCurve3(
      pts.map(([x, y]) => V(x, y, 0)),
      true,
      'centripetal',
    )
    return c.getPoints(n).slice(0, n).map((p): P2 => [p.x, p.y])
  }
  const c = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  return c.getPoints(n - 1).map((p): P2 => [p.x, p.y])
}
/** a star outline (sharp), centred on (cx, cy) */
export function star(cx: number, cy: number, outer: number, inner: number, points = 5, rot = Math.PI / 2): P2[] {
  return Array.from({ length: points * 2 }, (_, i): P2 => {
    const a = rot + (i * Math.PI) / points
    const r = i % 2 ? inner : outer
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}
/** a rounded rectangle outline, counter-clockwise, n points per corner */
export function rrect(cx: number, cy: number, w: number, h: number, r: number, n = 4): P2[] {
  const out: P2[] = []
  const rr = Math.min(r, w / 2, h / 2)
  const corners: [number, number, number][] = [
    [cx + w / 2 - rr, cy - h / 2 + rr, -Math.PI / 2],
    [cx + w / 2 - rr, cy + h / 2 - rr, 0],
    [cx - w / 2 + rr, cy + h / 2 - rr, Math.PI / 2],
    [cx - w / 2 + rr, cy - h / 2 + rr, Math.PI],
  ]
  for (const [x, y, a0] of corners) for (let i = 0; i <= n; i++) out.push([x + Math.cos(a0 + (i / n) * (Math.PI / 2)) * rr, y + Math.sin(a0 + (i / n) * (Math.PI / 2)) * rr])
  return out
}

/** a spiral from the centre out (the swirly eyes of a dizzy fish) */
export const spiral = (cx: number, cy: number, r: number, turns = 2.2, n = 30): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1)
    const a = t * turns * TAU
    return [cx + Math.cos(a) * r * (0.12 + 0.88 * t), cy + Math.sin(a) * r * (0.12 + 0.88 * t)] as P2
  })

/* ---------------- frames ---------------- */

/** a frame at p whose +z points along `normal` and whose +x leans towards `forward` (for eyes and decals on a flank) */
export function frameAt(p: THREE.Vector3 | P3, normal: THREE.Vector3, forward = V(1, 0, 0), scale = 1) {
  const z = normal.clone().normalize()
  const x = forward.clone().addScaledVector(z, -forward.dot(z))
  if (x.lengthSq() < 1e-6) x.set(0, 1, 0).addScaledVector(z, -z.y)
  x.normalize()
  const y = z.clone().cross(x)
  const m = new THREE.Matrix4().makeBasis(x, y, z)
  m.scale(V(scale, scale, scale))
  m.setPosition(Array.isArray(p) ? V(...p) : p)
  return m
}

/** the point on an ellipsoid's surface in direction `dir` from its centre, and the surface normal there */
export function onEll(e: Ell, dir: THREE.Vector3) {
  const d = dir.clone().normalize()
  const s = 1 / Math.sqrt((d.x / e.r[0]) ** 2 + (d.y / e.r[1]) ** 2 + (d.z / e.r[2]) ** 2)
  const p = V(e.c[0] + d.x * s, e.c[1] + d.y * s, e.c[2] + d.z * s)
  const n = V((p.x - e.c[0]) / e.r[0] ** 2, (p.y - e.c[1]) / e.r[1] ** 2, (p.z - e.c[2]) / e.r[2] ** 2).normalize()
  return { p, n }
}

/* ---------------- faces ---------------- */

export interface EyeSpec {
  /** the eye's radius across, and its height as a share of that */
  r: number
  tall?: number
  /** where the pupil looks, as a share of the eye (x forward, y up) */
  look?: P2
  pupil?: number
  /** the colour of the closed lid (the skin round the eye) */
  lid: THREE.ColorRepresentation
  /** a heavy upper lid over the open eye (the turtle's sleepy look), 0..1 of the eye */
  droop?: number
  lashes?: boolean
  /** the iris colour (a ring round the pupil), if any */
  iris?: THREE.ColorRepresentation
  ink?: number
}

/**
 * A toy eye in the frame `m` (built facing +z, its forward along +x): a glossy white dome (layer white) with a big
 * pupil and two glints (open) or a swirl (dizzy), and for a blink the closed lid, a low bulge in skin with its lash line.
 */
export function eye(k: RKit, m: THREE.Matrix4, s: EyeSpec) {
  const r = s.r
  const ry = r * (s.tall ?? 1.12)
  const rz = r * 0.62
  const ink = s.ink ?? Math.max(0.006, r * 0.11)
  const ball: Ell = { c: [0, 0, -rz * 0.36], r: [r, ry, rz] }
  const domeAt = new THREE.Matrix4().compose(V(0, 0, -rz * 0.36), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)), V(r, rz, ry))
  const dome = () => new THREE.SphereGeometry(1, 13, 6, 0, TAU, 0, Math.PI / 2)
  k.push(m)
  k.layer(FACE.white)
  k.add(dome(), '#ffffff', domeAt, ink)
  k.layer(FACE.open)
  const look = s.look ?? [0.22, 0.04]
  const ps = s.pupil ?? 0.6
  const px = look[0] * r
  const py = look[1] * ry - ry * 0.02
  if (s.iris) k.decal(ball, ellipsePts(px, py, r * ps * 1.12, ry * ps * 1.12, 14), s.iris, 0.002, 0)
  k.decal(ball, ellipsePts(px, py, r * ps * (s.iris ? 0.72 : 1), ry * ps * (s.iris ? 0.75 : 1.04), 14), PUPIL, 0.003, 0)
  k.decal(ball, ellipsePts(px - r * ps * 0.3, py + ry * ps * 0.36, r * ps * 0.36, ry * ps * 0.32, 8), SPARK, 0.006, 0)
  k.decal(ball, ellipsePts(px + r * ps * 0.36, py - ry * ps * 0.4, r * ps * 0.15, ry * ps * 0.13, 6), SPARK, 0.006, 0)
  if (s.droop) {
    // a heavy upper lid: the top of the dome in skin down to a lash line
    const cut = 1 - 2 * s.droop
    const a0 = Math.asin(cut)
    paint(k, ellSurf(ball), arc(0, 0, r * 1.04, ry * 1.04, a0, Math.PI - a0, 14), s.lid, 0.008, false, [0, ry * (cut + 1) * 0.5])
    const w = r * Math.cos(a0)
    stroke(k, ellSurf(ball), [[w, ry * cut], [0, ry * cut - ry * 0.05], [-w, ry * cut]], ink * 1.7, 0.01, INK, 0.12)
  }
  if (s.lashes) for (const [a, l] of [[0.62, 0.55], [0.86, 0.62], [1.1, 0.5]] as const) stroke(k, flatSurf(-rz * 0.2), [[Math.cos(a) * r * 0.92, Math.sin(a) * ry * 0.92], [Math.cos(a) * r * (1 + l * 0.55), Math.sin(a) * ry * (1 + l * 0.6)]], r * 0.2, 0.002, INK, 0.2)
  // blink: the lid closed over the eye, a lash line across it
  k.layer(FACE.blink)
  const lidE: Ell = { c: [0, 0, -rz * 0.36], r: [r * 1.04, ry * 1.04, rz * 0.5] }
  k.decal(lidE, ellipsePts(0, 0, r * 1.04, ry * 1.04, 16), s.lid, 0.004, ink, undefined, false)
  stroke(k, ellSurf(lidE), arc(0, ry * 0.1, r * 0.9, ry * 0.5, Math.PI * 1.08, Math.PI * 1.92, 10), Math.max(ink * 1.8, r * 0.16), 0.008, INK, 0.25)
  // dizzy: a swirl on the white
  k.layer(FACE.dizzy)
  stroke(k, ellSurf(ball), spiral(0, 0, r * 0.78, 2.1, 24), Math.max(ink * 1.4, r * 0.15), 0.004, INK, 0.08)
  k.layer(FACE.always)
  k.pop()
}

/** a closed smile: a pen stroke that curls up at the corners */
export function smile(k: RKit, f: Surf, x: number, y: number, w: number, h: number, lift: number, thick: number) {
  const pts: P2[] = Array.from({ length: 13 }, (_, i) => {
    const t = -1 + (2 * i) / 12
    return [x + t * w, y - h * (1 - t * t) + 0.25 * h * t ** 6]
  })
  stroke(k, f, pts, thick, lift)
}

/** the O mouth of a dizzy fish: a dark oval with an ink rim and a little tongue */
export function ohMouth(k: RKit, f: Surf, x: number, y: number, rx: number, ry: number, lift: number) {
  inked(k, f, oval(x, y, rx, ry, 0, 16), MOUTH, lift, Math.max(0.008, rx * 0.25), true)
  paint(k, f, oval(x, y - ry * 0.45, rx * 0.6, ry * 0.32, 0, 12), TONGUE, lift + 0.002, true)
}

/** cheeks */
export function blush(k: RKit, f: Surf, x: number, y: number, rx: number, ry: number, color: THREE.ColorRepresentation = BLUSH, lift = 0.003) {
  paint(k, f, oval(x, y, rx, ry, 0, 14), color, lift)
}

/* ---------------- fish parts ---------------- */

/** a fin with a dark margin: the outline in `edge`, and the colour inset by `margin` a hair proud of it on both faces */
export function edgedFin(k: RKit, outline: P2[], depth: number, color: THREE.ColorRepresentation, edge: THREE.ColorRepresentation, margin: number, m: THREE.Matrix4, step = 0.1, ink?: number) {
  k.add(fin(outline, depth, step), edge, m, ink)
  const c = centroid(outline)
  const inner = outline.map(([x, y]): P2 => {
    const dx = x - c[0]
    const dy = y - c[1]
    const d = Math.hypot(dx, dy) || 1
    const s = Math.max(0, d - margin) / d
    return [c[0] + dx * s, c[1] + dy * s]
  })
  k.add(faces(inner, depth / 2 + 0.003, step), color, m, 0)
}
