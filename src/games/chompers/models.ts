import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Font } from 'three/examples/jsm/loaders/FontLoader.js'
import { glowTexture } from '../../lib/three/fx'
import { GLYPHS } from './glyphs'
import type { Sym } from './rules'
import { SYMBOL_COLOR, donutColor } from './meta'

/*
  The Chompers cast, modelled in code in a cartoon style: toon shading in four flat tones and a dark ink
  outline (an inverted hull) around every solid part. Faces are decals bent onto the body's curve.
  Each model fits a cell about 0.9 across, faces +z, and is built once; cells get light clones that share
  geometry and materials. Parts that move (eyes, pupils, mouth, arms, wings, stalks) are named groups.
*/

const INK = '#1d0f30'
const OUT = 0.017

/* ------------------------------------------------------------------ */
/*  Materials                                                           */
/* ------------------------------------------------------------------ */

let ramp: THREE.DataTexture | null = null
function toonRamp() {
  if (ramp) return ramp
  const d = new Uint8Array([88, 160, 222, 255])
  ramp = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat)
  ramp.minFilter = THREE.NearestFilter
  ramp.magFilter = THREE.NearestFilter
  ramp.generateMipmaps = false
  ramp.needsUpdate = true
  return ramp
}

const mats = new Map<string, THREE.Material>()
function toon(color: string, emissive = '#000000', ei = 0) {
  const k = `t${color}${emissive}${ei}`
  let m = mats.get(k)
  if (!m) mats.set(k, (m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), emissive, emissiveIntensity: ei })))
  return m
}
function flat(color: string | THREE.Color) {
  const c = new THREE.Color(color)
  const k = `b${c.getHexString()}${c.r > 1 || c.g > 1 || c.b > 1 ? c.toArray().join() : ''}`
  let m = mats.get(k)
  if (!m) mats.set(k, (m = new THREE.MeshBasicMaterial({ color: c })))
  return m
}
function inkHull() {
  let m = mats.get('ink')
  if (!m) mats.set('ink', (m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })))
  return m
}

/** every material in use, so the scene can clip them all to the reel window */
export function allMaterials() {
  return [...mats.values()]
}

/* ------------------------------------------------------------------ */
/*  Geometry kit                                                        */
/* ------------------------------------------------------------------ */

type Geo = THREE.BufferGeometry
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** position, rotation (radians) and scale as a matrix */
function T(p: [number, number, number], r: [number, number, number] = [0, 0, 0], s: number | [number, number, number] = 1) {
  const sc = typeof s === 'number' ? V(s, s, s) : V(...s)
  return new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sc)
}

/** non-indexed, position and normal only, so anything can be merged with anything */
function prep(g: Geo) {
  const x = g.index ? g.toNonIndexed() : g.clone()
  for (const k of Object.keys(x.attributes)) if (k !== 'position' && k !== 'normal') x.deleteAttribute(k)
  if (!x.getAttribute('normal')) x.computeVertexNormals()
  return x
}

/** the ink outline: the surface pushed out along its normals, drawn back faces only */
function shell(g: Geo, t: number) {
  const x = g.clone()
  const p = x.getAttribute('position') as THREE.BufferAttribute
  const n = x.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) + n.getX(i) * t, p.getY(i) + n.getY(i) * t, p.getZ(i) + n.getZ(i) * t)
  return x
}

class Kit {
  private parts: { geo: Geo; mat: THREE.Material; ink: number }[] = []

  /** adds a solid; `ink` is the outline thickness (0 for none) */
  add(geo: Geo, mat: THREE.Material, m?: THREE.Matrix4, ink = OUT) {
    const g = prep(geo)
    geo.dispose()
    if (m) g.applyMatrix4(m)
    this.parts.push({ geo: g, mat, ink })
    return this
  }

  /** one mesh per material, plus one for all the outlines */
  bake(name = '') {
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
    if (ink.length) {
      const m = new THREE.Mesh(mergeGeometries(ink), inkHull())
      group.add(m)
    }
    for (const [mat, gs] of by) group.add(new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs), mat))
    for (const p of this.parts) if (by.get(p.mat)!.length > 1) p.geo.dispose()
    for (const g of ink) g.dispose()
    return group
  }
}

/* ---------------- decals bent onto an ellipsoid ---------------- */

interface Ell {
  c: [number, number, number]
  r: [number, number, number]
}
type P2 = [number, number]

/** a fan of rings from the centre out to the outline, so the decal can follow the curve of the body */
function fan(outline: P2[], center?: P2, rings = 6) {
  // counter-clockwise, so the triangles face the camera
  const area = outline.reduce((a, p, i) => a + p[0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * p[1], 0)
  const pts = area < 0 ? [...outline].reverse() : outline
  const c = center ?? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
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
function conform(g: Geo, e: Ell, lift: number) {
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

const ellipsePts = (cx: number, cy: number, rx: number, ry: number, n = 28): P2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry])

/** a decal with a dark rim: the shape, and a slightly fatter copy underneath it */
function decal(k: Kit, e: Ell, pts: P2[], mat: THREE.Material, lift: number, rim = 0.012, center?: P2) {
  if (rim > 0) {
    const c = center ?? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length]
    const fat = pts.map(([x, y]): P2 => {
      const dx = x - c[0]
      const dy = y - c[1]
      const d = Math.hypot(dx, dy) || 1
      return [x + (dx / d) * rim, y + (dy / d) * rim]
    })
    k.add(conform(fan(fat, center), e, lift - 0.002), flat(INK), undefined, 0)
  }
  k.add(conform(fan(pts, center), e, lift), mat, undefined, 0)
}

/** the surface point of an ellipsoid in front of (x, y) */
function surfaceZ(e: Ell, x: number, y: number) {
  const u = (x - e.c[0]) / e.r[0]
  const v = (y - e.c[1]) / e.r[1]
  return e.c[2] + e.r[2] * Math.sqrt(Math.max(0, 1 - u * u - v * v))
}

/* ---------------- faces ---------------- */

interface MouthOpts {
  x?: number
  y: number
  w: number
  h: number
  /** how much the corners turn up */
  smile?: number
  teeth?: number[]
  fangs?: number[]
  under?: number[]
  tongue?: boolean
}

/** an open cartoon mouth on the body: dark inside, a tongue, teeth along the top and fangs */
function mouth(e: Ell, o: MouthOpts, name = 'mouth') {
  const k = new Kit()
  const cx = o.x ?? 0
  const smile = o.smile ?? 0.35
  const top = (x: number) => o.y - smile * o.h * (1 - ((x - cx) / o.w) ** 2)
  const bot = (x: number) => top(x) - o.h * Math.max(0, 1 - ((x - cx) / o.w) ** 2) ** 0.62
  const N = 26
  const xs = Array.from({ length: N + 1 }, (_, i) => cx - o.w + (2 * o.w * i) / N)
  const outline: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, bot(x)])]
  const mid: P2 = [cx, (top(cx) + bot(cx)) / 2]
  decal(k, e, outline, flat('#3a0b22'), 0.006, 0.016, mid)
  if (o.tongue !== false) {
    const tw = o.w * 0.56
    const tx = Array.from({ length: 15 }, (_, i) => cx - tw + (2 * tw * i) / 14)
    const lo = (x: number) => top(x) + (bot(x) - top(x)) * 0.9
    const hi = (x: number) => top(x) + (bot(x) - top(x)) * 0.48 - o.h * 0.06 * Math.cos(((x - cx) / tw) * Math.PI * 0.5)
    const t: P2[] = [...tx.map((x): P2 => [x, lo(x)]), ...tx.slice(1, -1).reverse().map((x): P2 => [x, hi(x)])]
    decal(k, e, t, flat('#ff5f86'), 0.009, 0, [cx, (lo(cx) + hi(cx)) / 2])
  }
  const tooth = (x: number, w: number, h: number, up: boolean) => {
    const y0 = up ? bot(x) : top(x)
    const ya = up ? bot(x - w) : top(x - w)
    const yb = up ? bot(x + w) : top(x + w)
    const pts: P2[] = up
      ? [
          [x - w, ya - 0.004],
          [x + w, yb - 0.004],
          [x, y0 + h],
        ]
      : [
          [x - w, ya + 0.004],
          [x, y0 - h],
          [x + w, yb + 0.004],
        ]
    decal(k, e, pts, toon('#ffffff'), 0.012, 0.007, [x, y0 + (up ? h : -h) / 3])
  }
  for (const t of o.teeth ?? []) tooth(cx + t * o.w, o.w * 0.09, o.h * 0.22, false)
  for (const t of o.fangs ?? []) tooth(cx + t * o.w, o.w * 0.11, o.h * 0.5, false)
  for (const t of o.under ?? []) tooth(cx + t * o.w, o.w * 0.1, o.h * 0.5, true)
  const g = k.bake(name)
  // pivot on the top lip, so the mouth can open and shut
  g.userData.pivot = [cx, o.y]
  return g
}

/** cartoon eyes: white balls with a dark pupil and a shine painted on, outlined */
function eyes(list: { x: number; y: number; r: number }[], e: Ell | null, pupilColor = '#140a20', z0?: number) {
  const ball = new Kit()
  const pupil = new Kit()
  for (const { x, y, r } of list) {
    const ez = (z0 ?? (e ? surfaceZ(e, x, y) : 0)) - r * 0.42
    ball.add(new THREE.SphereGeometry(r, 26, 18), toon('#ffffff'), T([x, y, ez]))
    const ball3: Ell = { c: [x, y, ez], r: [r, r, r] }
    pupil.add(conform(fan(ellipsePts(x, y - r * 0.05, r * 0.5, r * 0.54, 24), undefined, 5), ball3, 0.004), flat(pupilColor), undefined, 0)
    pupil.add(conform(fan(ellipsePts(x + r * 0.17, y + r * 0.16, r * 0.17, r * 0.17, 14), undefined, 3), ball3, 0.008), flat('#ffffff'), undefined, 0)
  }
  const group = ball.bake('eyes')
  const p = pupil.bake('pupils')
  group.add(p)
  const ys = list.map((l) => l.y)
  group.userData.pivotY = ys.reduce((a, b) => a + b, 0) / ys.length
  group.userData.look = list[0].r * 0.2
  return group
}

/** wraps a group so it scales and turns about (px, py, pz) */
function pivot(g: THREE.Object3D, px: number, py: number, pz = 0) {
  const outer = new THREE.Group()
  outer.name = g.name
  g.name = ''
  outer.position.set(px, py, pz)
  g.position.set(-px, -py, -pz)
  outer.add(g)
  outer.userData = g.userData
  return outer
}

/* ---------------- shapes ---------------- */

/** a cone along +y with its base at the origin, bent sideways towards the tip */
function horn(r: number, h: number, bend: number) {
  const g = new THREE.ConeGeometry(r, h, 18, 8)
  g.translate(0, h / 2, 0)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h
    p.setX(i, p.getX(i) + bend * t * t * h)
  }
  g.computeVertexNormals()
  return g
}

/** a small arm: a capsule with a round hand, hanging from the origin at angle `a` (0 = down) */
function arm(k: Kit, color: string, x: number, y: number, z: number, a: number, len = 0.13, r = 0.05) {
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  k.add(new THREE.CapsuleGeometry(r, len, 6, 14), toon(color), T([x + dx * len * 0.5, y + dy * len * 0.5, z], [0, 0, a]))
  k.add(new THREE.SphereGeometry(r * 1.32, 16, 12), toon(color), T([x + dx * (len + r * 0.6), y + dy * (len + r * 0.6), z]))
}

function feet(k: Kit, color: string, xs: number[], y: number, z: number) {
  for (const x of xs) k.add(new THREE.SphereGeometry(0.075, 18, 12), toon(color), T([x, y, z], [0, 0, 0], [1.25, 0.62, 1.15]))
}

const shade = (c: string, f: number) => '#' + new THREE.Color(c).multiplyScalar(f).getHexString()
const lighten = (c: string, f: number) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), f).getHexString()

/* ------------------------------------------------------------------ */
/*  The cast                                                            */
/* ------------------------------------------------------------------ */

/** Grumbo: a round purple cyclops with curly horns and a huge grin, arms up */
function buildGrumbo() {
  const col = SYMBOL_COLOR.grumbo
  const e: Ell = { c: [0, -0.04, 0], r: [0.36, 0.33, 0.32] }
  const k = new Kit()
  k.add(new THREE.SphereGeometry(1, 44, 30), toon(col), T(e.c, [0, 0, 0], e.r))
  feet(k, shade(col, 0.8), [-0.15, 0.15], -0.36, 0.05)
  for (const s of [-1, 1]) {
    k.add(horn(0.07, 0.2, s * 0.55), toon('#fff1d6'), T([s * 0.17, 0.21, -0.02], [0, 0, -s * 0.55]))
    arm(k, col, s * 0.33, -0.02, 0.02, s * 2.35, 0.12, 0.048)
  }
  decal(k, e, ellipsePts(0, -0.2, 0.19, 0.12), toon(lighten(col, 0.35)), 0.003, 0)
  const root = new THREE.Group()
  root.add(k.bake())
  const ey = pivot(eyes([{ x: 0, y: 0.08, r: 0.135 }], e), 0, 0.08)
  root.add(ey)
  // brow
  const b = new Kit()
  decal(b, e, [[-0.13, 0.24], [0.13, 0.24], [0.11, 0.27], [-0.11, 0.27]], flat(shade(col, 0.45)), 0.004, 0)
  root.add(b.bake())
  const m = mouth(e, { y: -0.08, w: 0.19, h: 0.12, smile: 0.5, teeth: [-0.45, -0.15, 0.15, 0.45], fangs: [-0.72, 0.72] })
  root.add(pivot(m, 0, -0.08, 0.3))
  return root
}

/** Fang: a fuzzy orange ball with spikes, cheeky brows and an underbite */
function buildFang() {
  const col = SYMBOL_COLOR.fang
  const e: Ell = { c: [0, -0.03, 0], r: [0.32, 0.31, 0.3] }
  const k = new Kit()
  k.add(new THREE.SphereGeometry(1, 44, 30), toon(col), T(e.c, [0, 0, 0], e.r))
  const spikes = 13
  for (let i = 0; i < spikes; i++) {
    const a = (-38 + (256 * i) / (spikes - 1)) * (Math.PI / 180)
    const dir = V(Math.cos(a), Math.sin(a), 0)
    const pos = V(e.c[0] + dir.x * 0.27, e.c[1] + dir.y * 0.26, -0.04)
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir)
    const g = new THREE.ConeGeometry(0.06, 0.13, 12, 3)
    g.translate(0, 0.065, 0)
    k.add(g, toon(shade(col, 0.88)), new THREE.Matrix4().compose(pos, q, V(1, 1, 0.8)))
  }
  feet(k, shade(col, 0.75), [-0.13, 0.13], -0.33, 0.05)
  for (const s of [-1, 1]) arm(k, col, s * 0.29, -0.1, 0.04, s * 0.5, 0.1, 0.045)
  decal(k, e, ellipsePts(0, -0.18, 0.16, 0.1), toon(lighten(col, 0.4)), 0.003, 0)
  const root = new THREE.Group()
  root.add(k.bake())
  root.add(pivot(eyes([{ x: -0.1, y: 0.07, r: 0.082 }, { x: 0.1, y: 0.07, r: 0.082 }], e), 0, 0.07))
  const b = new Kit()
  for (const s of [-1, 1]) decal(b, e, [[s * 0.05, 0.17], [s * 0.18, 0.21], [s * 0.18, 0.24], [s * 0.05, 0.2]], flat('#5a1d05'), 0.004, 0)
  root.add(b.bake())
  root.add(pivot(mouth(e, { y: -0.07, w: 0.15, h: 0.1, smile: 0.25, under: [-0.55, 0.55], tongue: true }), 0, -0.07, 0.28))
  return root
}

/** Blip: a tall blue bean with three eyes on stalks and a small smile */
function buildBlip() {
  const col = SYMBOL_COLOR.blip
  const prof: THREE.Vector2[] = []
  for (let i = 0; i <= 24; i++) {
    const t = i / 24
    const y = -0.36 + t * 0.6
    const r = Math.sin(Math.PI * Math.min(1, t * 1.02)) ** 0.55 * (0.27 - 0.07 * t)
    prof.push(new THREE.Vector2(Math.max(0.0001, r), y))
  }
  const k = new Kit()
  k.add(new THREE.LatheGeometry(prof, 40), toon(col))
  // a body-like ellipsoid for the face decals, matching the bean around the face
  const e: Ell = { c: [0, -0.08, 0], r: [0.25, 0.3, 0.255] }
  feet(k, shade(col, 0.75), [-0.12, 0.12], -0.36, 0.06)
  for (const s of [-1, 1]) arm(k, col, s * 0.22, -0.14, 0.03, s * 0.9, 0.1, 0.042)
  for (const [x, y, r] of [
    [-0.15, -0.2, 0.035],
    [0.16, -0.24, 0.028],
    [0.12, 0.04, 0.022],
  ])
    decal(k, e, ellipsePts(x, y, r, r), toon(shade(col, 0.78)), 0.003, 0)
  const root = new THREE.Group()
  root.add(k.bake())
  const stalks = new THREE.Group()
  stalks.name = 'stalks'
  for (const [x, h, a] of [
    [-0.1, 0.17, 0.35],
    [0, 0.21, 0],
    [0.1, 0.16, -0.35],
  ]) {
    const s = new Kit()
    s.add(new THREE.CylinderGeometry(0.022, 0.03, h, 10, 4), toon(shade(col, 0.92)), T([0, h / 2, 0]))
    const one = s.bake()
    const ey = eyes([{ x: 0, y: h + 0.045, r: 0.06 }], null, '#140a20', 0.02)
    one.add(pivot(ey, 0, h + 0.045))
    const holder = new THREE.Group()
    holder.position.set(x, 0.2, 0)
    holder.rotation.z = a
    holder.add(one)
    stalks.add(holder)
  }
  root.add(stalks)
  root.add(pivot(mouth(e, { y: -0.05, w: 0.1, h: 0.065, smile: 0.6, teeth: [0.25], tongue: true }), 0, -0.05, 0.25))
  return root
}

/** Mimi: a pink round bat with big lashy eyes, flapping wings and one tiny fang */
function buildMimi() {
  const col = SYMBOL_COLOR.mimi
  const e: Ell = { c: [0, -0.05, 0], r: [0.3, 0.29, 0.29] }
  const k = new Kit()
  k.add(new THREE.SphereGeometry(1, 44, 30), toon(col), T(e.c, [0, 0, 0], e.r))
  for (const s of [-1, 1]) k.add(horn(0.045, 0.09, s * 0.3), toon(shade(col, 0.8)), T([s * 0.13, 0.2, 0.02], [0, 0, -s * 0.35]))
  feet(k, shade(col, 0.78), [-0.12, 0.12], -0.33, 0.05)
  decal(k, e, ellipsePts(0, -0.2, 0.15, 0.09), toon(lighten(col, 0.45)), 0.003, 0)
  for (const s of [-1, 1]) decal(k, e, ellipsePts(s * 0.18, -0.07, 0.045, 0.03), flat('#ff9cc8'), 0.003, 0)
  const root = new THREE.Group()
  root.add(k.bake())
  // wings: a scalloped bat wing, extruded thin, each its own group so it can flap
  const wing = new THREE.Shape()
  wing.moveTo(0, 0.05)
  wing.quadraticCurveTo(0.12, 0.2, 0.3, 0.16)
  wing.quadraticCurveTo(0.27, 0.09, 0.29, 0.02)
  wing.quadraticCurveTo(0.23, 0.05, 0.2, -0.02)
  wing.quadraticCurveTo(0.15, 0.03, 0.1, -0.05)
  wing.quadraticCurveTo(0.06, 0.0, 0, -0.04)
  wing.closePath()
  for (const s of [-1, 1]) {
    const w = new Kit()
    const g = new THREE.ExtrudeGeometry(wing, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 })
    w.add(g, toon('#9b3fd6'), T([0, 0, -0.01], [0, 0, 0], [s, 1, 1]), 0)
    const ink = new THREE.ExtrudeGeometry(wing, { depth: 0.01, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.022, bevelSegments: 1, curveSegments: 10 })
    w.add(ink, flat(INK), T([0, 0, -0.03], [0, 0, 0], [s, 1, 1]), 0)
    const wg = w.bake(s < 0 ? 'wingL' : 'wingR')
    const holder = new THREE.Group()
    holder.name = s < 0 ? 'wingL' : 'wingR'
    wg.name = ''
    holder.position.set(s * 0.22, 0.02, -0.08)
    holder.add(wg)
    root.add(holder)
  }
  root.add(pivot(eyes([{ x: -0.1, y: 0.05, r: 0.092 }, { x: 0.1, y: 0.05, r: 0.092 }], e), 0, 0.05))
  const l = new Kit()
  for (const s of [-1, 1])
    for (const [dx, dy, len] of [
      [0.07, 0.07, 0.045],
      [0.1, 0.03, 0.04],
    ]) {
      const x0 = s * (0.1 + dx * 0.9)
      const y0 = 0.05 + dy
      decal(l, e, [[x0, y0], [x0 + s * len, y0 + len * 0.55], [x0 + s * len * 0.9, y0 + len * 0.75], [x0 - s * 0.006, y0 + 0.016]], flat(INK), 0.006, 0)
    }
  root.add(l.bake())
  root.add(pivot(mouth(e, { y: -0.11, w: 0.075, h: 0.045, smile: 0.7, fangs: [0.45], tongue: false }), 0, -0.11, 0.27))
  return root
}

/** The wild: a big Boje-green chomper in a gold crown, with the widest mouth in town */
function buildWild() {
  const col = SYMBOL_COLOR.wild
  const e: Ell = { c: [0, -0.02, 0], r: [0.37, 0.35, 0.33] }
  const k = new Kit()
  k.add(new THREE.SphereGeometry(1, 48, 32), toon(col), T(e.c, [0, 0, 0], e.r))
  feet(k, shade(col, 0.75), [-0.16, 0.16], -0.36, 0.06)
  for (const s of [-1, 1]) arm(k, col, s * 0.35, -0.05, 0.02, s * 2.1, 0.11, 0.05)
  decal(k, e, ellipsePts(0, -0.22, 0.2, 0.1), toon(lighten(col, 0.45)), 0.003, 0)
  // tuft of hair
  for (const [x, a, h] of [
    [-0.05, 0.4, 0.1],
    [0, 0, 0.13],
    [0.05, -0.4, 0.1],
  ])
    k.add(horn(0.035, h, -a * 0.4), toon(shade(col, 0.8)), T([x, 0.3, -0.06], [0, 0, a]))
  const root = new THREE.Group()
  root.add(k.bake())
  // crown
  const c = new Kit()
  const gold = toon('#ffc93d', '#7a4a00', 0.25)
  c.add(new THREE.CylinderGeometry(0.15, 0.165, 0.08, 36, 1), gold, T([0, 0, 0]))
  for (let i = 0; i < 5; i++) {
    const a = ((i - 2) / 2) * 1.05
    const p = V(Math.sin(a) * 0.155, 0.04, Math.cos(a) * 0.155)
    c.add(new THREE.ConeGeometry(0.038, 0.1, 12, 2), gold, T([p.x, p.y + 0.05, p.z], [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12]))
    c.add(new THREE.SphereGeometry(0.02, 10, 8), toon('#fff6d8'), T([p.x * 1.02, p.y + 0.105, p.z * 1.02]), 0.008)
  }
  c.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 6, 1), toon('#2ee87f', '#0b6b38', 0.6), T([0, 0, 0.165], [Math.PI / 2, 0, 0]), 0.01)
  const crown = c.bake('crown')
  crown.position.set(0.02, 0.37, -0.02)
  crown.rotation.set(0.32, 0, -0.14)
  root.add(crown)
  root.add(pivot(eyes([{ x: -0.12, y: 0.12, r: 0.092 }, { x: 0.12, y: 0.12, r: 0.092 }], e), 0, 0.12))
  const b = new Kit()
  for (const s of [-1, 1]) decal(b, e, [[s * 0.05, 0.24], [s * 0.2, 0.255], [s * 0.2, 0.285], [s * 0.05, 0.27]], flat('#0b4d28'), 0.004, 0)
  root.add(b.bake())
  root.add(pivot(mouth(e, { y: -0.03, w: 0.23, h: 0.17, smile: 0.4, teeth: [-0.62, -0.3, 0, 0.3, 0.62], fangs: [-0.85, 0.85], under: [-0.4, 0.4] }), 0, -0.03, 0.3))
  // the WILD plaque
  const plaque = new THREE.Mesh(planeGeo(), new THREE.MeshBasicMaterial({ map: wildTexture(), transparent: true, depthWrite: false }))
  plaque.scale.set(0.62, 0.2, 1)
  plaque.position.set(0, -0.36, 0.36)
  plaque.renderOrder = 3
  plaque.name = 'plaque'
  root.add(plaque)
  return root
}

/** The scatter: a cream monster egg with spots, a glowing crack and a little nest */
function buildEgg() {
  const k = new Kit()
  const prof: THREE.Vector2[] = []
  const R = (t: number) => Math.sin(t) * 0.235 * (1 + 0.13 * Math.cos(t))
  const Y = (t: number) => -Math.cos(t) * 0.31 - 0.02
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI
    prof.push(new THREE.Vector2(Math.max(0.0001, R(t)), Y(t)))
  }
  k.add(new THREE.LatheGeometry(prof, 44), toon('#fff4dc'))
  const surf = (t: number, a: number, out = 0) => V(Math.sin(a) * (R(t) + out), Y(t), Math.cos(a) * (R(t) + out))
  const spots: [number, number, number, string][] = [
    [0.55, -0.55, 0.06, '#a55bff'],
    [0.75, 0.45, 0.05, '#2ee87f'],
    [1.25, -0.2, 0.045, '#ff5fa2'],
    [1.95, 0.5, 0.06, '#a55bff'],
    [2.2, -0.6, 0.05, '#2ee87f'],
    [1.0, 1.1, 0.04, '#ff5fa2'],
    [2.05, -0.05, 0.035, '#ffb627'],
    [0.4, 0.15, 0.035, '#ffb627'],
  ]
  for (const [t, a, r, c] of spots) {
    const p = surf(t, a, -0.004)
    const n = V(Math.sin(a), 0.25 * -Math.cos(t), Math.cos(a)).normalize()
    k.add(new THREE.SphereGeometry(r, 16, 10), toon(c), new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n), V(1, 1, 0.25)), 0)
  }
  // nest
  k.add(new THREE.TorusGeometry(0.19, 0.055, 12, 36), toon('#b5733a'), T([0, -0.3, 0], [Math.PI / 2 - 0.25, 0, 0], [1, 1, 0.75]))
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    k.add(new THREE.CapsuleGeometry(0.012, 0.12, 4, 6), toon('#d69a52'), T([Math.cos(a) * 0.19, -0.3 + Math.sin(a) * 0.03, Math.sin(a) * 0.12], [0.3, a, 1.2 + (i % 3) * 0.4]), 0.006)
  }
  const root = new THREE.Group()
  root.add(k.bake())
  // the crack
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 10; i++) {
    const a = -1.05 + (2.1 * i) / 10
    const t = 1.62 + (i % 2 ? 0.12 : -0.08)
    pts.push(surf(t, a, 0.004))
  }
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  const crack = new THREE.Mesh(new THREE.TubeGeometry(path, 60, 0.012, 6, false), flat(new THREE.Color('#ffe14d').multiplyScalar(1.8)))
  crack.name = 'crack'
  root.add(crack)
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffcf3a').multiplyScalar(0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  halo.scale.set(1.1, 1.1, 1)
  halo.position.z = -0.3
  halo.name = 'halo'
  root.add(halo)
  return root
}

/** Donuts: dough, a wavy icing in the colour of the value, sprinkles. The value label is added per cell. */
function buildDonut(icing: string) {
  const k = new Kit()
  k.add(new THREE.TorusGeometry(0.235, 0.118, 22, 48), toon('#e9a656'))
  const ice = new THREE.TorusGeometry(0.236, 0.124, 22, 48).toNonIndexed()
  const p = ice.getAttribute('position') as THREE.BufferAttribute
  const keep: number[] = []
  for (let i = 0; i < p.count; i += 3) {
    let z = 0
    let a = 0
    for (let j = 0; j < 3; j++) {
      z += p.getZ(i + j) / 3
      a += Math.atan2(p.getY(i + j), p.getX(i + j)) / 3
    }
    if (z > 0.03 + 0.028 * Math.sin(a * 7)) keep.push(i, i + 1, i + 2)
  }
  const kept = new THREE.BufferGeometry()
  const n = ice.getAttribute('normal') as THREE.BufferAttribute
  kept.setAttribute('position', new THREE.Float32BufferAttribute(keep.flatMap((i) => [p.getX(i), p.getY(i), p.getZ(i)]), 3))
  kept.setAttribute('normal', new THREE.Float32BufferAttribute(keep.flatMap((i) => [n.getX(i), n.getY(i), n.getZ(i)]), 3))
  ice.dispose()
  k.add(kept, toon(icing), undefined, 0)
  const cols = ['#ffffff', '#ffe14d', '#3dd9ff', '#2ee87f', '#ff4d61', '#b06bff']
  let seed = 7
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const b = 0.15 + r() * 1.1
    const ring = 0.236 + Math.cos(b) * 0.124
    const pos = V(Math.cos(a) * ring, Math.sin(a) * ring, Math.sin(b) * 0.127)
    if (pos.z < 0.05) continue
    k.add(new THREE.CapsuleGeometry(0.011, 0.038, 3, 6), toon(cols[i % cols.length]), T([pos.x, pos.y, pos.z], [r() * 3, r() * 3, r() * 3]), 0)
  }
  const root = new THREE.Group()
  const body = k.bake()
  body.rotation.x = -0.28
  root.add(body)
  return root
}

/* ---------------- letters ---------------- */

let font: Font | null = null
const glyphFont = () => (font ??= new Font(GLYPHS as unknown as ConstructorParameters<typeof Font>[0]))

/** a chunky letter with googly eyes */
function buildLetter(sym: 'A' | 'K' | 'Q' | 'J' | 'T') {
  const text = sym === 'T' ? '10' : sym
  const col = SYMBOL_COLOR[sym]
  const shapes = glyphFont().generateShapes(text, 0.58)
  const k = new Kit()
  const opts = { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 3, curveSegments: 10 }
  const g = new THREE.ExtrudeGeometry(shapes, opts)
  g.computeBoundingBox()
  const bb = g.boundingBox!
  const cx = (bb.max.x + bb.min.x) / 2
  const cy = (bb.max.y + bb.min.y) / 2
  const front = 0.1 + 0.03
  // the faces in the colour, the sides a shade darker
  const faces = new THREE.ExtrudeGeometry(shapes, opts)
  faces.translate(-cx, -cy - 0.03, -0.05)
  const idx = faces.groups
  const side = faces.clone()
  // split by material group: group 0 is the caps, group 1 the sides
  // ExtrudeGeometry adds a caps group (material 0) and a sides group (material 1) for every shape
  const pick = (geo: THREE.BufferGeometry, mi: number) => {
    const src = geo.index ? geo.toNonIndexed() : geo
    const out = new THREE.BufferGeometry()
    for (const name of ['position', 'normal']) {
      const a = (src.getAttribute(name) as THREE.BufferAttribute).array as Float32Array
      const parts: number[] = []
      for (const gr of idx) if (gr.materialIndex === mi) parts.push(...a.slice(gr.start * 3, (gr.start + gr.count) * 3))
      out.setAttribute(name, new THREE.Float32BufferAttribute(parts, 3))
    }
    return out
  }
  k.add(pick(faces, 0), toon(col), undefined, 0)
  k.add(pick(side, 1), toon(shade(col, 0.62)), undefined, 0)
  faces.dispose()
  side.dispose()
  g.dispose()
  const ink = new THREE.ExtrudeGeometry(shapes, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.046, bevelSegments: 2, curveSegments: 10 })
  k.add(ink, flat(INK), T([-cx, -cy - 0.03, -0.08]), 0)
  const root = new THREE.Group()
  root.add(k.bake())
  const top = bb.max.y - cy - 0.03
  const ex = sym === 'T' ? 0.12 : sym === 'J' ? 0.05 : 0
  const ey = top - (sym === 'A' ? 0.16 : 0.1)
  root.add(pivot(eyes([{ x: ex - 0.065, y: ey, r: 0.058 }, { x: ex + 0.065, y: ey, r: 0.058 }], null, '#140a20', front - 0.05 + 0.06), 0, ey))
  return root
}

/* ------------------------------------------------------------------ */
/*  Labels                                                              */
/* ------------------------------------------------------------------ */

let plane: THREE.PlaneGeometry | null = null
const planeGeo = () => (plane ??= new THREE.PlaneGeometry(1, 1))
const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'

let wildTex: THREE.CanvasTexture | null = null
function wildTexture() {
  if (wildTex) return wildTex
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 166
  const g = c.getContext('2d')!
  g.beginPath()
  g.roundRect(14, 14, 484, 138, 60)
  g.fillStyle = INK
  g.fill()
  g.beginPath()
  g.roundRect(24, 22, 464, 120, 52)
  const grad = g.createLinearGradient(0, 22, 0, 142)
  grad.addColorStop(0, '#fff2a8')
  grad.addColorStop(0.5, '#ffc93d')
  grad.addColorStop(1, '#f08a12')
  g.fillStyle = grad
  g.fill()
  g.font = `900 104px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 14
  g.strokeStyle = '#ffffff'
  g.strokeText('WILD', 256, 88)
  g.fillStyle = '#4a137a'
  g.fillText('WILD', 256, 88)
  wildTex = new THREE.CanvasTexture(c)
  wildTex.colorSpace = THREE.SRGBColorSpace
  wildTex.anisotropy = 4
  return wildTex
}

const labelCache = new Map<string, THREE.CanvasTexture>()
/** a value label: chunky white numbers with a dark edge and a coloured glow */
export function labelTexture(text: string, color: string) {
  const key = text + color
  let t = labelCache.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 160
  const g = c.getContext('2d')!
  const size = text.length > 7 ? 92 : text.length > 5 ? 104 : 116
  g.font = `900 ${size}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.shadowColor = color
  g.shadowBlur = 26
  g.lineWidth = 26
  g.strokeStyle = INK
  g.strokeText(text, 256, 86)
  g.shadowBlur = 0
  g.lineWidth = 10
  g.strokeStyle = color
  g.strokeText(text, 256, 86)
  const grad = g.createLinearGradient(0, 40, 0, 132)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(1, '#fff0b8')
  g.fillStyle = grad
  g.fillText(text, 256, 86)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  labelCache.set(key, t)
  return t
}

/** a flat label mesh in front of a symbol; its material is the caller's to dispose */
export function labelMesh(text: string, color: string, w = 0.86) {
  const m = new THREE.Mesh(planeGeo(), new THREE.MeshBasicMaterial({ map: labelTexture(text, color), transparent: true, depthWrite: false }))
  m.scale.set(w, w * (160 / 512), 1)
  m.renderOrder = 4
  m.name = 'label'
  return m
}

/* ------------------------------------------------------------------ */
/*  Building and sharing                                                */
/* ------------------------------------------------------------------ */

const BUILD: Record<Exclude<Sym, 'donut'>, () => THREE.Group> = {
  grumbo: buildGrumbo,
  fang: buildFang,
  blip: buildBlip,
  mimi: buildMimi,
  wild: buildWild,
  egg: buildEgg,
  A: () => buildLetter('A'),
  K: () => buildLetter('K'),
  Q: () => buildLetter('Q'),
  J: () => buildLetter('J'),
  T: () => buildLetter('T'),
}

const protos = new Map<string, THREE.Group>()
function proto(key: string, make: () => THREE.Group) {
  let p = protos.get(key)
  if (!p) protos.set(key, (p = make()))
  return p
}

/** a fresh copy of a symbol; for donuts, `value` picks the icing colour */
export function buildSymbol(sym: Sym, value = 2): THREE.Group {
  if (sym === 'donut') {
    const c = donutColor(value)
    return proto('donut' + c, () => buildDonut(c)).clone()
  }
  return proto(sym, BUILD[sym]).clone()
}

/** builds every model ahead of time */
export function warmUp() {
  for (const s of Object.keys(BUILD) as Exclude<Sym, 'donut'>[]) proto(s, BUILD[s])
  for (const v of [2, 10, 20, 50, 100]) buildSymbol('donut', v)
}

export function symbolMaterials(o: THREE.Object3D) {
  const out: THREE.Material[] = []
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) out.push(x.material as THREE.Material)
  })
  return out
}
