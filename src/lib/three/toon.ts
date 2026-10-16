import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/*
  The toon kit shared by the cartoon slots: models are built in code from primitives, shaded in a few flat tones
  through a ramp texture, and outlined in ink by an inverted hull (the surface pushed out along its normals and
  seen from behind). Faces are flat decals bent onto the curve of the body.
  `Kit` bakes one mesh per material plus one for all the outlines. `VKit` carries colour per vertex instead, so a
  whole model, outline included, is a single mesh drawn with `vkMaterial` in one call.
*/

export type Geo = THREE.BufferGeometry
export type P2 = [number, number]
export type P3 = [number, number, number]
/** an ellipsoid, for bending decals onto */
export interface Ell {
  c: P3
  r: P3
}

const OUT = 0.017
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
/** the middle of an outline (the average of its points) */
export const centroid = (pts: P2[]): P2 => [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]

/** position, rotation (radians) and scale as a matrix */
export function T(p: P3, r: P3 = [0, 0, 0], s: number | P3 = 1) {
  const sc = typeof s === 'number' ? V(s, s, s) : V(...s)
  return new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sc)
}

/** non-indexed, position and normal only, so anything can be merged with anything */
export function prep(g: Geo) {
  const x = g.index ? g.toNonIndexed() : g.clone()
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k)
  if (!x.getAttribute('normal')) x.computeVertexNormals()
  return x
}

/** the ink outline: the surface pushed out along its normals, drawn back faces only */
export function shell(g: Geo, t: number) {
  const x = g.clone()
  const p = x.getAttribute('position') as THREE.BufferAttribute
  const n = x.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t)
  return x
}

const ramps = new Map<string, THREE.DataTexture>()
/** the toon gradient: one brightness per tone, darkest first */
export function toonRamp(levels: readonly number[] = [88, 160, 222, 255]) {
  const key = levels.join()
  let t = ramps.get(key)
  if (t) return t
  const d = new Uint8Array(levels)
  t = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat)
  t.minFilter = THREE.NearestFilter
  t.magFilter = THREE.NearestFilter
  t.generateMipmaps = false
  t.needsUpdate = true
  ramps.set(key, t)
  return t
}

export class Kit {
  private parts: { geo: Geo; mat: THREE.Material; ink: number }[] = []

  /** adds a solid; `ink` is the outline thickness (0 for none) */
  add(geo: Geo, mat: THREE.Material, m?: THREE.Matrix4, ink = OUT) {
    const g = prep(geo)
    geo.dispose()
    if (m) g.applyMatrix4(m)
    this.parts.push({ geo: g, mat, ink })
    return this
  }

  /** one mesh per material, plus one in `inkMat` for all the outlines */
  bake(name: string, inkMat: THREE.Material) {
    const group = new THREE.Group()
    group.name = name
    const by = new Map<THREE.Material, Geo[]>()
    const ink: Geo[] = []
    for (const p of this.parts) {
      let list = by.get(p.mat)
      if (!list) by.set(p.mat, (list = []))
      list.push(p.geo)
      if (p.ink) ink.push(shell(p.geo, p.ink))
    }
    if (ink.length) group.add(new THREE.Mesh(mergeGeometries(ink), inkMat))
    for (const [mat, gs] of by) group.add(new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs), mat))
    for (const p of this.parts) if (by.get(p.mat)!.length > 1) p.geo.dispose()
    for (const g of ink) g.dispose()
    return group
  }
}

/* ---------------- decals bent onto an ellipsoid ---------------- */

/** a fan of rings from the centre out to the outline, so the decal can follow the curve of the body */
export function fan(outline: P2[], center?: P2, rings = 6) {
  // counter-clockwise, so the triangles face the camera
  const area = outline.reduce((a, p, i) => a + p[0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * p[1], 0)
  const pts = area < 0 ? [...outline].reverse() : outline
  const c = center ?? centroid(pts)
  const pos: number[] = []
  const at = (i: number, k: number): P2 => [c[0] + (pts[i % pts.length][0] - c[0]) * (k / rings), c[1] + (pts[i % pts.length][1] - c[1]) * (k / rings)]
  for (let k = 0; k < rings; k++)
    for (let i = 0; i < pts.length; i++) {
      const a0 = at(i, k)
      const a1 = at(i + 1, k)
      const b0 = at(i, k + 1)
      const b1 = at(i + 1, k + 1)
      if (k > 0) pos.push(a0[0], a0[1], 0, b0[0], b0[1], 0, a1[0], a1[1], 0)
      pos.push(a1[0], a1[1], 0, b0[0], b0[1], 0, b1[0], b1[1], 0)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** lifts a flat decal (x, y) onto the front of an ellipsoid, `lift` above its surface, and faces it outwards */
export function conform(g: Geo, e: Ell, lift: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const nrm = new Float32Array(p.count * 3)
  const [cx, cy, cz] = e.c
  const [rx, ry, rz] = e.r
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const u = (x - cx) / rx
    const v = (y - cy) / ry
    const w = Math.sqrt(Math.max(0, 1 - u * u - v * v))
    const z = cz + rz * w
    const n = V((x - cx) / (rx * rx), (y - cy) / (ry * ry), (z - cz) / (rz * rz)).normalize()
    p.setXYZ(i, x + n.x * lift, y + n.y * lift, z + n.z * lift)
    nrm.set([n.x, n.y, n.z], i * 3)
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return g
}

export const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 28): P2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry])

/** the outline pushed out by `rim` from the centre, for a decal's dark edge */
export function fatten(pts: P2[], rim: number, center?: P2) {
  const c = center ?? centroid(pts)
  return pts.map(([x, y]): P2 => {
    const dx = x - c[0]
    const dy = y - c[1]
    const d = Math.hypot(dx, dy) || 1
    return [x + (dx / d) * rim, y + (dy / d) * rim]
  })
}

/** a decal with a dark rim: the shape, and a slightly fatter copy in `rimMat` underneath it (no rim without one) */
export function decal(k: Kit, e: Ell, pts: P2[], mat: THREE.Material, lift: number, rim = 0.012, center?: P2, rimMat?: THREE.Material) {
  if (rim > 0 && rimMat) k.add(conform(fan(fatten(pts, rim, center), center), e, lift - 0.002), rimMat, undefined, 0)
  k.add(conform(fan(pts, center), e, lift), mat, undefined, 0)
}

/** the surface point of an ellipsoid in front of (x, y) */
export function surfaceZ(e: Ell, x: number, y: number) {
  const u = (x - e.c[0]) / e.r[0]
  const v = (y - e.c[1]) / e.r[1]
  return e.c[2] + e.r[2] * Math.sqrt(Math.max(0, 1 - u * u - v * v))
}

/** wraps a group so it scales and turns about (px, py, pz) */
export function pivot(g: THREE.Object3D, px: number, py: number, pz = 0) {
  const outer = new THREE.Group()
  outer.name = g.name
  g.name = ''
  outer.position.set(px, py, pz)
  g.position.set(-px, -py, -pz)
  outer.add(g)
  outer.userData = g.userData
  return outer
}

/* ---------------- one mesh per model: colour per vertex ---------------- */

interface Solid {
  geo: Geo
  ink: number
}

/** Builds a model as one geometry with colour per vertex, so body and outline draw together in one call. */
export class VKit {
  private readonly solids: Solid[] = []
  private readonly ink: THREE.Color

  constructor(
    ink: THREE.ColorRepresentation = '#1d0f30',
    private readonly out = OUT,
  ) {
    this.ink = new THREE.Color(ink)
  }

  /** a solid in one colour (times the geometry's own `color` attribute, if it has one); ink = hull thickness
   *  (0 = none); flat = unlit (exact colour, may exceed 1 for bloom) */
  add(geo: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4, ink = this.out, flat = false) {
    const src = geo.index ? geo.toNonIndexed() : geo.clone()
    geo.dispose()
    const own = src.getAttribute('color')
    if (!src.getAttribute('normal')) src.computeVertexNormals()
    if (m) src.applyMatrix4(m)
    const p = src.getAttribute('position')
    const n = src.getAttribute('normal')
    const c = new THREE.Color(color)
    // a mirroring matrix turns triangles inside out, so put their winding back
    const flip = m !== undefined && m.determinant() < 0
    // drop the zero-area triangles primitives leave at their poles
    const keep: number[] = []
    const a = V()
    const b = V()
    for (let i = 0; i < p.count; i += 3) {
      a.set(p.getX(i + 1) - p.getX(i), p.getY(i + 1) - p.getY(i), p.getZ(i + 1) - p.getZ(i))
      b.set(p.getX(i + 2) - p.getX(i), p.getY(i + 2) - p.getY(i), p.getZ(i + 2) - p.getZ(i))
      if (a.cross(b).lengthSq() > 1e-14) keep.push(...(flip ? [i, i + 2, i + 1] : [i, i + 1, i + 2]))
    }
    const pos = new Float32Array(keep.length * 3)
    const nrm = new Float32Array(keep.length * 3)
    const col = new Float32Array(keep.length * 3)
    keep.forEach((v, j) => {
      pos.set([p.getX(v), p.getY(v), p.getZ(v)], j * 3)
      nrm.set([n.getX(v), n.getY(v), n.getZ(v)], j * 3)
      col.set(own ? [own.getX(v) * c.r, own.getY(v) * c.g, own.getZ(v) * c.b] : [c.r, c.g, c.b], j * 3)
    })
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aFlat', new THREE.BufferAttribute(new Float32Array(keep.length).fill(flat ? 1 : 0), 1))
    this.solids.push({ geo: g, ink })
    return this
  }

  /** a decal bent onto an ellipsoid with an ink rim, like Chompers' decal(); flat by default */
  decal(e: Ell, pts: P2[], color: THREE.ColorRepresentation, lift: number, rim = 0.012, center?: P2, flat = true) {
    const c = center ?? centroid(pts)
    // enough rings to follow the curve, fewer for small decals; the rim only shows at its edge, so one ring does
    const rings = Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.02)))
    if (rim > 0) this.add(conform(fan(fatten(pts, rim, c), c, 1), e, lift - 0.002), this.ink, undefined, 0, true)
    return this.add(conform(fan(pts, c, rings), e, lift), color, undefined, 0, flat)
  }

  /** one non-indexed geometry: position, normal, color (Float32, may exceed 1), aFlat (0|1). For every solid with
   *  ink > 0, its shell() is appended with triangle winding reversed, normals negated, color = ink, aFlat = 1. */
  geometry() {
    const hulls: Geo[] = []
    for (const s of this.solids) {
      if (s.ink <= 0) continue
      const h = shell(s.geo, s.ink)
      for (const name of ['position', 'normal']) {
        const a = h.getAttribute(name).array as Float32Array
        // swap the 2nd and 3rd corner of every triangle
        for (let i = 0; i < a.length; i += 9) {
          const t = a.slice(i + 3, i + 6)
          a.copyWithin(i + 3, i + 6, i + 9)
          a.set(t, i + 6)
        }
      }
      const n = h.getAttribute('normal').array as Float32Array
      for (let i = 0; i < n.length; i++) n[i] = -n[i]
      const col = h.getAttribute('color').array as Float32Array
      for (let i = 0; i < col.length; i += 3) col.set([this.ink.r, this.ink.g, this.ink.b], i)
      ;(h.getAttribute('aFlat').array as Float32Array).fill(1)
      hulls.push(h)
    }
    return mergeGeometries([...this.solids.map((s) => s.geo), ...hulls])
  }

  mesh(name: string, mat: THREE.Material) {
    const m = new THREE.Mesh(this.geometry(), mat)
    m.name = name
    return m
  }
}

/** The material for VKit meshes: toon shading on the vertex colours, where `aFlat` = 1 shows the colour as it is. */
export function vkMaterial(gradientMap: THREE.Texture) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap })
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlat;\nvarying float vFlat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlat = aFlat;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlat;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb, vFlat);\n#include <opaque_fragment>')
  }
  m.customProgramCacheKey = () => 'vk'
  return m
}
