import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T, VKit, centroid, ellipsePts, fan, fatten, pivot, surfaceZ, type Ell, type Geo, type P2, type P3 } from '../../lib/three/toon'

/*
  Geometry helpers for the Plunder Bay models (the cast in models.ts, the host in host.ts, the ship and frame in
  ship.ts): surfaces to paint decals onto, pen strokes, toy eyes, mouths, ropes, planks and morph helpers. Everything
  goes through VKit (colour per vertex, ink outline merged in), so a model is one mesh per moving part.
*/

export type { Ell, Geo, P2, P3 }

/** the ink every outline and drawn line is in: a deep sea-night purple */
export const INK = '#1f1029'
export const TAU = Math.PI * 2
export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
/** flat white above 1, so it blooms: the hard shine where the key light catches a round surface */
export const SHINE = C('#ffffff', 1.6)
export const SPARK = C('#ffffff', 1.25)
export const PUPIL = '#170b22'
export const MOUTH = '#4a0d24'
export const TONGUE = '#ff6680'
export const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
/** matrices applied right to left, like a scene graph: mul(parent, child) */
export const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4())

/** a surface seen from the front, as z = f(x, y) */
export type Surf = (x: number, y: number) => number

/* ---------------- primitives ---------------- */

/** thin parts get fewer segments: they only ever cover a few pixels */
export function capsule(r: number, len: number) {
  return r >= 0.07 ? new THREE.CapsuleGeometry(r, len, 3, 12) : r >= 0.04 ? new THREE.CapsuleGeometry(r, len, 2, 9) : r >= 0.025 ? new THREE.CapsuleGeometry(r, len, 2, 7) : new THREE.CapsuleGeometry(r, len, 1, 6)
}
export const sphere = (w = 18, h = 12) => new THREE.SphereGeometry(1, w, h)

/** a matrix that stands a +y shape on the segment a-b, centred on it */
export function aim(a: THREE.Vector3 | P3, b: THREE.Vector3 | P3, s: P3 = [1, 1, 1]) {
  const A = Array.isArray(a) ? V(...a) : a
  const B = Array.isArray(b) ? V(...b) : b
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V(...s))
}

/** a capsule from a to b of radius r (its round ends centred on a and b) */
export function limb(k: VKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink?: number) {
  const len = Math.max(0.001, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]))
  k.add(capsule(r, len), color, aim(a, b), ink)
}

/** smooth normals across shared corners (keeping any colours), so the hull of a faceted shape stays closed */
export function smooth(g: Geo) {
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'color') g.deleteAttribute(key)
  const m = mergeVertices(g, 1e-5)
  m.computeVertexNormals()
  return m
}

/** a lathe from (radius, y) points, smooth shaded */
export function lathe(pts: P2[], n = 18) {
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y)),
    n,
  )
}

/** an outline pushed out along z by `depth` (centred on z = 0) with a rounded bevel, smooth shaded for a closed hull */
export function slab(outline: P2[], depth: number, bevel = 0.01, curve = 6, holes: P2[][] = [], bevelSegments = 1) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments, curveSegments: curve })
  g.translate(0, 0, -depth / 2)
  return smooth(g)
}

/** any simple polygon, flat, facing +z at z (earcut), for decals on flat faces */
export function flatShape(outline: P2[], z = 0) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y))))
  g.deleteAttribute('uv')
  g.translate(0, 0, z)
  return g
}

/** clips a polygon to y0 <= y <= y1 (Sutherland-Hodgman) */
export function clipY(poly: P2[], y0: number, y1: number): P2[] {
  const cut = (pts: P2[], keep: (p: P2) => boolean, yc: number) => {
    const out: P2[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      const ka = keep(a)
      const kb = keep(b)
      if (ka) out.push(a)
      if (ka !== kb) {
        const t = (yc - a[1]) / (b[1] - a[1])
        out.push([a[0] + (b[0] - a[0]) * t, yc])
      }
    }
    return out
  }
  return cut(
    cut(poly, (p) => p[1] >= y0, y0),
    (p) => p[1] <= y1,
    y1,
  )
}

/**
 * A convex polygon cut into upright slices `step` wide (each fanned from its first corner), flat at z: a decal that
 * can bend with cloth waving along x without the cloth poking through it.
 */
export function slicedX(poly: P2[], step: number, z = 0) {
  const xs = poly.map((p) => p[0])
  const x0 = Math.min(...xs)
  const x1 = Math.max(...xs)
  const n = Math.max(1, Math.ceil((x1 - x0) / step))
  const pos: number[] = []
  const cut = (pts: P2[], keep: (p: P2) => boolean, xc: number) => {
    const out: P2[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (keep(a)) out.push(a)
      if (keep(a) !== keep(b)) out.push([xc, a[1] + ((b[1] - a[1]) * (xc - a[0])) / (b[0] - a[0])])
    }
    return out
  }
  // counter-clockwise, so the slices face +z
  const area = poly.reduce((a, p, i) => a + p[0] * poly[(i + 1) % poly.length][1] - poly[(i + 1) % poly.length][0] * p[1], 0)
  const src = area < 0 ? [...poly].reverse() : poly
  for (let i = 0; i < n; i++) {
    const a = x0 + ((x1 - x0) * i) / n
    const b = x0 + ((x1 - x0) * (i + 1)) / n
    const piece = cut(
      cut(src, (p) => p[0] >= a - 1e-9, a),
      (p) => p[0] <= b + 1e-9,
      b,
    )
    for (let j = 1; j < piece.length - 1; j++) pos.push(piece[0][0], piece[0][1], z, piece[j][0], piece[j][1], z, piece[j + 1][0], piece[j + 1][1], z)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return g
}

/** a flat outline facing +z (no thickness), for decals laid on flat faces */
export function flat(outline: P2[], z = 0) {
  const c = centroid(outline)
  const g = fan(outline, c, 1)
  g.translate(0, 0, z)
  g.computeVertexNormals()
  return g
}

/* ---------------- surfaces and decals ---------------- */

/** the front of a capsule (points within r of the segment a-b) as a surface */
export function capSurf(a: P3, b: P3, r: number): Surf {
  const A = V(...a)
  const AB = V(...b).sub(A)
  const L2 = AB.lengthSq() || 1
  const P = V()
  const dist = (x: number, y: number, z: number) => {
    P.set(x, y, z).sub(A)
    const t = Math.max(0, Math.min(1, P.dot(AB) / L2))
    return P.addScaledVector(AB, -t).length()
  }
  const top = Math.max(a[2], b[2]) + r
  const bottom = Math.min(a[2], b[2]) - r
  return (x, y) => {
    let lo = bottom
    let hi = top
    for (let i = 0; i < 28; i++) {
      const m1 = lo + (hi - lo) / 3
      const m2 = hi - (hi - lo) / 3
      if (dist(x, y, m1) < dist(x, y, m2)) hi = m2
      else lo = m1
    }
    const near = (lo + hi) / 2
    if (dist(x, y, near) >= r) return near
    lo = near
    hi = top
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2
      if (dist(x, y, m) < r) lo = m
      else hi = m
    }
    return lo
  }
}

export const ellSurf =
  (e: Ell): Surf =>
  (x, y) =>
    surfaceZ(e, x, y)
export const flatSurf =
  (z: number): Surf =>
  () =>
    z

/**
 * Splits a flat (z = const) decal's triangles in four until no edge is longer than `maxEdge`, so it can follow a
 * curved or waving surface under it (non-indexed, position only).
 */
export function subdivide(geo: Geo, maxEdge: number, maxPasses = 4) {
  const src = geo.index ? geo.toNonIndexed() : geo
  let pos = Array.from(src.getAttribute('position').array as Float32Array)
  if (src !== geo) src.dispose()
  const m2 = maxEdge * maxEdge
  for (let pass = 0; pass < maxPasses; pass++) {
    const out: number[] = []
    let split = false
    for (let i = 0; i < pos.length; i += 9) {
      const a = pos.slice(i, i + 3)
      const b = pos.slice(i + 3, i + 6)
      const c = pos.slice(i + 6, i + 9)
      const d2 = (p: number[], q: number[]) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2
      if (Math.max(d2(a, b), d2(b, c), d2(c, a)) <= m2) {
        out.push(...a, ...b, ...c)
        continue
      }
      split = true
      const mid = (p: number[], q: number[]) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2]
      const ab = mid(a, b)
      const bc = mid(b, c)
      const ca = mid(c, a)
      out.push(...a, ...ab, ...ca, ...ab, ...b, ...bc, ...ca, ...bc, ...c, ...ab, ...bc, ...ca)
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

/** a filled shape painted onto a surface; `flatLit` shows its colour unlit */
export function paint(k: VKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, flatLit = false, center?: P2, rings?: number, edge = Infinity) {
  const c = center ?? centroid(pts)
  // a fan of rings from the middle that follows the curve under it; `edge` splits it finer still (for waving cloth)
  const g = fan(pts, c, rings ?? ringsFor(pts, c))
  k.add(onto(Number.isFinite(edge) ? subdivide(g, edge) : g, f, lift), color, undefined, 0, flatLit)
}

/** enough rings for a decal to follow the curve under it, and no more */
export const ringsFor = (pts: P2[], c: P2) => Math.min(4, Math.max(1, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.03)))

/** a shape with an ink rim, painted onto a surface */
export function inked(k: VKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, rim = 0.01, flatLit = false, center?: P2) {
  const c = center ?? centroid(pts)
  paint(k, f, fatten(pts, rim, c), INK, lift - 0.0015, true, c)
  paint(k, f, pts, color, lift, flatLit, c)
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
export function stroke(k: VKit, f: Surf, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK, taper = 0.35, flatLit = true) {
  k.add(onto(strip(path, w, taper), f, lift), color, undefined, 0, flatLit)
}

export const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
export const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
/** a polyline through points, smoothed (Catmull-Rom) to n points */
export function curve2(pts: P2[], n = 16): P2[] {
  const c = new THREE.SplineCurve(pts.map(([x, y]) => new THREE.Vector2(x, y)))
  return c.getPoints(n - 1).map((p): P2 => [p.x, p.y])
}

/** n points spaced evenly along a closed outline */
export function resample(pts: P2[], n: number): P2[] {
  const seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]))
  const total = seg.reduce((a, b) => a + b, 0)
  const out: P2[] = []
  let i = 0
  let acc = 0
  for (let k = 0; k < n; k++) {
    const want = (k / n) * total
    while (acc + seg[i] < want) acc += seg[i++]
    const t = (want - acc) / (seg[i] || 1)
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
  }
  return out
}

/** a rounded rectangle outline, counter-clockwise, n points per corner */
export function rrect(cx: number, cy: number, w: number, h: number, r: number, n = 5): P2[] {
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

/** a five-point star outline (sharp), centred on (cx, cy) */
export function star(cx: number, cy: number, outer: number, inner: number, points = 5, rot = Math.PI / 2): P2[] {
  return Array.from({ length: points * 2 }, (_, i): P2 => {
    const a = rot + (i * Math.PI) / points
    const r = i % 2 ? inner : outer
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}

/* ---------------- parts ---------------- */

/** a part's rest pose (position, rotation, scale), kept in userData.rest */
export interface Rest {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
}
export const restOf = (o: THREE.Object3D): Rest => ({ x: o.position.x, y: o.position.y, z: o.position.z, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z, sx: o.scale.x, sy: o.scale.y, sz: o.scale.z })
/** puts a part back to the pose it was built in */
export function toRest(o: THREE.Object3D) {
  const r = o.userData.rest as Rest | undefined
  if (!r) return
  o.position.set(r.x, r.y, r.z)
  o.rotation.set(r.rx, r.ry, r.rz)
  o.scale.set(r.sx, r.sy, r.sz)
}

/** a VKit mesh (modelled in its parent's frame) in a group that turns and scales about p, with its rest pose */
export function part(k: VKit, name: string, p: P3, mat: THREE.Material) {
  const g = pivot(k.mesh(name, mat), ...p)
  g.userData.rest = restOf(g)
  return g
}
/** wraps objects (modelled in the parent's frame) in a named group that turns about p, recording the rest pose */
export function joint(name: string, p: P3, ...children: THREE.Object3D[]) {
  const outer = new THREE.Group()
  outer.name = name
  outer.position.set(...p)
  const inner = new THREE.Group()
  inner.position.set(-p[0], -p[1], -p[2])
  inner.add(...children)
  outer.add(inner)
  outer.userData.rest = restOf(outer)
  return outer
}

/* ---------------- faces ---------------- */

export interface Eye {
  x: number
  y: number
  rx: number
  ry: number
  /** pupil offset as a share of the eye (look direction) */
  look?: P2
  /** pupil size as a share of the eye */
  pupil?: number
}

/** toy eyes: glossy white domes set into the surface, big pupils with two glints */
export function domeEyes(k: VKit, f: Surf, list: Eye[], ink = 0.009) {
  let cz = 0
  for (const e of list) {
    const rz = Math.min(e.rx, e.ry) * 0.62
    const z = f(e.x, e.y) - rz * 0.38
    cz += z / list.length
    k.add(new THREE.SphereGeometry(1, 12, 5, 0, TAU, 0, Math.PI / 2), '#ffffff', T([e.x, e.y, z], [Math.PI / 2, 0, 0], [e.rx, rz, e.ry]), ink)
    const ball: Ell = { c: [e.x, e.y, z], r: [e.rx, e.ry, rz] }
    const look = e.look ?? [0.1, 0.02]
    const ps = e.pupil ?? 0.6
    const px = e.x + look[0] * e.rx
    const py = e.y + look[1] * e.ry - e.ry * 0.04
    k.decal(ball, ellipsePts(px, py, e.rx * ps, e.ry * ps * 1.06, 18), PUPIL, 0.003, 0)
    k.decal(ball, ellipsePts(px - e.rx * ps * 0.32, py + e.ry * ps * 0.38, e.rx * ps * 0.36, e.ry * ps * 0.32, 10), SPARK, 0.006, 0)
    k.decal(ball, ellipsePts(px + e.rx * ps * 0.36, py - e.ry * ps * 0.4, e.rx * ps * 0.15, e.ry * ps * 0.13, 8), SPARK, 0.006, 0)
  }
  const cx = list.reduce((a, e) => a + e.x, 0) / list.length
  const cy = list.reduce((a, e) => a + e.y, 0) / list.length
  return [cx, cy, cz] as P3
}

/** round eyeballs (whole spheres, for eyes on stalks and peeking out) */
export function ballEye(k: VKit, c: P3, r: number, look: P2 = [0.1, 0.05], pupil = 0.58) {
  k.add(new THREE.SphereGeometry(1, 10, 7), '#ffffff', T(c, [0, 0, 0], r), 0.009)
  const ball: Ell = { c, r: [r, r, r] }
  const px = c[0] + look[0] * r
  const py = c[1] + look[1] * r
  k.decal(ball, ellipsePts(px, py, r * pupil, r * pupil * 1.06, 18), PUPIL, 0.003, 0)
  k.decal(ball, ellipsePts(px - r * pupil * 0.32, py + r * pupil * 0.38, r * pupil * 0.36, r * pupil * 0.32, 10), SPARK, 0.006, 0)
  k.decal(ball, ellipsePts(px + r * pupil * 0.36, py - r * pupil * 0.4, r * pupil * 0.15, r * pupil * 0.13, 8), SPARK, 0.006, 0)
}

export interface MouthAt {
  x: number
  y: number
  /** half width */
  w: number
  /** depth below the corners */
  h: number
}

/** a closed smile: a pen stroke that curls up at the corners */
export function smile(k: VKit, f: Surf, m: MouthAt, lift: number, thick = 0.012) {
  const pts: P2[] = Array.from({ length: 13 }, (_, i) => {
    const t = -1 + (2 * i) / 12
    return [m.x + t * m.w, m.y - m.h * (1 - t * t) + 0.25 * m.h * t ** 6]
  })
  stroke(k, f, pts, thick, lift)
}

/** an open laughing mouth: dark inside with a tongue, flat along the top; `teeth` adds a white top row */
export function openMouth(k: VKit, f: Surf, m: MouthAt, lift: number, teeth = false) {
  const top = (x: number) => m.y - 0.18 * m.h * (1 - ((x - m.x) / m.w) ** 2)
  const xs = Array.from({ length: 15 }, (_, i) => m.x - m.w + (2 * m.w * i) / 14)
  const out: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, top(x) - m.h * Math.sqrt(Math.max(0, 1 - ((x - m.x) / m.w) ** 2))])]
  const mid: P2 = [m.x, m.y - m.h * 0.5]
  paint(k, f, fatten(out, 0.008, mid), INK, lift - 0.001, true, mid, 1)
  paint(k, f, out, MOUTH, lift, true, mid)
  paint(k, f, oval(m.x, m.y - m.h * 0.74, m.w * 0.52, m.h * 0.28, 0, 14), TONGUE, lift + 0.002, true)
  if (teeth) paint(k, f, [...xs.slice(2, -2).map((x): P2 => [x, top(x) - 0.002]), ...xs.slice(2, -2).reverse().map((x): P2 => [x, top(x) - m.h * 0.24])], '#ffffff', lift + 0.003, true)
}

/** happy ^ ^ eyes */
export function happyEyes(k: VKit, f: Surf, eyes: Eye[], lift: number, w = 0) {
  for (const e of eyes) stroke(k, f, arc(e.x, e.y - e.ry * 0.3, e.rx * 0.95, e.ry * 0.8, Math.PI * 0.94, Math.PI * 0.06, 12), w || Math.max(0.014, e.rx * 0.34), lift)
}

/** cheeks */
export function blush(k: VKit, f: Surf, pts: P2[], rx: number, ry: number, color = '#ff8fa8', lift = 0.003) {
  for (const [x, y] of pts) paint(k, f, oval(x, y, rx, ry, 0, 14), color, lift)
}

/** a shine streak (a tapered white stroke) and a dot, on the upper left of a round surface */
export function shine(k: VKit, f: Surf, path: P2[], w: number, dot?: [number, number, number], lift = 0.003) {
  stroke(k, f, path, w, lift, SHINE)
  if (dot) paint(k, f, ellipsePts(dot[0], dot[1], dot[2], dot[2], 10), SHINE, lift, true)
}

/* ---------------- tubes and ropes ---------------- */

/** a tube along a curve whose radius goes from r0 to r1 (closed, rounded ends) */
export function taperTube(path: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 16, radial = 8, ends = true) {
  const g = new THREE.TubeGeometry(path, seg, 1, radial, false)
  const p = g.getAttribute('position')
  const c = V()
  for (let i = 0; i <= seg; i++) {
    path.getPointAt(i / seg, c)
    const t = i / seg
    const r = r0 + (r1 - r0) * t
    for (let j = 0; j <= radial; j++) {
      const v = i * (radial + 1) + j
      p.setXYZ(v, c.x + (p.getX(v) - c.x) * r, c.y + (p.getY(v) - c.y) * r, c.z + (p.getZ(v) - c.z) * r)
    }
  }
  g.computeVertexNormals()
  if (!ends) return g
  const a = path.getPointAt(0)
  const b = path.getPointAt(1)
  const parts = [g.toNonIndexed(), new THREE.SphereGeometry(r0, radial, Math.max(4, radial / 2)).translate(a.x, a.y, a.z).toNonIndexed(), new THREE.SphereGeometry(Math.max(1e-3, r1), radial, Math.max(4, radial / 2)).translate(b.x, b.y, b.z).toNonIndexed()]
  for (const x of parts) for (const key of Object.keys(x.attributes)) if (key !== 'position' && key !== 'normal') x.deleteAttribute(key)
  return mergeGeometries(parts)
}

/**
 * A tube along a curve whose radius is rf(t) (t 0..1 along it), scaled by `sx` across (x) for flattened shapes; a
 * round cap at the start when `cap` (the end should taper to a point).
 */
export function tubeR(path: THREE.Curve<THREE.Vector3>, rf: (t: number) => number, seg = 12, radial = 8, cap = false) {
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
  if (!cap) return g
  const a = path.getPointAt(0)
  const parts = [g.toNonIndexed(), new THREE.SphereGeometry(rf(0), radial, Math.max(3, Math.round(radial / 2))).translate(a.x, a.y, a.z).toNonIndexed()]
  for (const x of parts) for (const key of Object.keys(x.attributes)) if (key !== 'position' && key !== 'normal') x.deleteAttribute(key)
  return mergeGeometries(parts)
}

/** a curve through points (centripetal Catmull-Rom) */
export const path3 = (pts: P3[], closed = false) => new THREE.CatmullRomCurve3(
  pts.map((p) => V(...p)),
  closed,
  'centripetal',
)

/**
 * A twisted rope along a curve: a tube coloured in helical strands (per triangle, so the stripes stay crisp), the
 * two tones `a` and `b`. `twists` is turns per unit length.
 */
export function rope(path: THREE.Curve<THREE.Vector3>, r: number, a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, twists = 9, seg?: number, radial = 7, closed = false) {
  const len = path.getLength()
  const n = seg ?? Math.max(8, Math.round(len * 60))
  const g = new THREE.TubeGeometry(path, n, r, radial, closed).toNonIndexed()
  const uv = g.getAttribute('uv')
  const col = new Float32Array(uv.count * 3)
  const ca = C(a)
  const cb = C(b)
  for (let i = 0; i < uv.count; i += 3) {
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3
    const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3
    const c = Math.floor((v + u * len * twists) * 3) % 2 ? ca : cb
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** colours a geometry per triangle with f(centroid) (it is made non-indexed) */
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

/** colours a geometry per vertex with f(position) (smooth gradients) */
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

/* ---------------- morph targets ---------------- */

/**
 * Adds one absolute morph target to a VKit geometry: each vertex moves to `to(position)`. Clones of a mesh share the
 * geometry but each keeps its own `morphTargetInfluences`, so one shared shape can be posed per copy.
 */
export function morphTo(g: Geo, to: (v: THREE.Vector3) => void) {
  const p = g.getAttribute('position')
  const out = new Float32Array(p.count * 3)
  const v = V()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    to(v)
    out.set([v.x, v.y, v.z], i * 3)
  }
  // the normals stay as they are (the poses only slide and swing parts a little)
  g.morphAttributes.position = [new THREE.BufferAttribute(out, 3)]
  return g
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
