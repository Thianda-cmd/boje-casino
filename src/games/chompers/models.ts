import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glowTexture } from '../../lib/three/fx'
import { T, VKit, centroid, ellipsePts, fan, fatten, pivot, surfaceZ, toonRamp, vkMaterial, type Ell, type Geo, type P2, type P3 } from '../../lib/three/toon'
import type { Sym } from './rules'
import { SYMBOL_COLOR, donutColor } from './meta'

/*
  The Chompers cast, modelled in code in a cartoon style: toon shading in four flat tones and a dark ink outline
  (an inverted hull) around every solid part. Every part is a VKit mesh (colour per vertex, outline merged in), so a
  whole symbol draws in three or four calls with one shared material. Faces are decals bent onto the body's curve.
  Each model fits a cell about 0.9 across and faces +z; cells get light clones that share geometry and materials.
  Parts that move are named groups: eyes, pupils, mouth, joy (the win face), wings, stalks, crown, cherry, swirl,
  wrapL / wrapR. Big Mama Chomp, the host, is built here too, as a rig the scene poses.
*/

export const INK = '#1d0f30'
const RAMP = [88, 160, 222, 255]

/* ------------------------------------------------------------------ */
/*  Materials                                                           */
/* ------------------------------------------------------------------ */

let cast: THREE.MeshToonMaterial | null = null
let stageCast: THREE.MeshToonMaterial | null = null
let halo: THREE.SpriteMaterial | null = null
let plaque: THREE.MeshBasicMaterial | null = null

/** the one material of the whole cast; `stage` is a copy for Big Mama and the frame props, which stay unclipped */
export function castMaterial(stage = false) {
  if (stage) return (stageCast ??= vkMaterial(toonRamp(RAMP)))
  return (cast ??= vkMaterial(toonRamp(RAMP)))
}

function haloMaterial() {
  return (halo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: C('#ffcf3a', 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
}

function plaqueMaterial() {
  return (plaque ??= new THREE.MeshBasicMaterial({ map: wildTexture(), transparent: true, depthWrite: false }))
}

/** every material the reel pieces use, so the scene can clip them to the window (the stage copy is left out) */
export function allMaterials(): THREE.Material[] {
  return [cast, halo, plaque].filter((m): m is NonNullable<typeof m> => m !== null)
}

export function symbolMaterials(o: THREE.Object3D) {
  const out = new Set<THREE.Material>()
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) out.add(x.material as THREE.Material)
  })
  return [...out]
}

/* ------------------------------------------------------------------ */
/*  Geometry kit                                                        */
/* ------------------------------------------------------------------ */

/** a surface seen from the front, as z = f(x, y) */
type Surf = (x: number, y: number) => number

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
function C(c: THREE.ColorRepresentation, f = 1) {
  return new THREE.Color(c).multiplyScalar(f)
}
const SHINE = C('#ffffff', 1.3)
const SPARK = C('#ffffff', 1.25)
const PUPIL = '#140a20'
const MOUTH = '#3a0b22'
const TONGUE = '#ff5f86'

const sphere = (w = 32, h = 22) => new THREE.SphereGeometry(1, w, h)
const capsule = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 4, r > 0.05 ? 14 : 10)
const shade = (c: string, f: number) => '#' + new THREE.Color(c).multiplyScalar(f).getHexString()
const lighten = (c: string, f: number) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), f).getHexString()
const ellSurf = (e: Ell): Surf => (x, y) => surfaceZ(e, x, y)
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])

/** smooth normals across shared corners (keeping any colours), so the hull of a shape stays closed */
function smooth(g: Geo) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k)
  const m = mergeVertices(g)
  m.computeVertexNormals()
  g.dispose()
  return m
}

/** lifts a flat shape onto any surface, `lift` above it, facing outwards */
function onto(g: Geo, f: Surf, lift: number) {
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

const ringsFor = (pts: P2[], c: P2) => Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.02)))

/** a filled shape painted onto a surface; with `rim`, an ink edge under it */
function paint(k: VKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, flat = true, rim = 0, center?: P2) {
  const c = center ?? centroid(pts)
  if (rim > 0) k.add(onto(fan(fatten(pts, rim, c), c, 1), f, lift - 0.002), INK, undefined, 0, true)
  k.add(onto(fan(pts, c, ringsFor(pts, c)), f, lift), color, undefined, 0, flat)
}

/** a ribbon of width w along a path, thinning to rounded points at both ends (a pen stroke) */
function strip(path: P2[], w: number, taper = 0.35) {
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

/** a pen stroke painted onto a surface */
function stroke(k: VKit, f: Surf, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK) {
  k.add(onto(strip(path, w), f, lift), color, undefined, 0, true)
}

/** a non-indexed copy with one colour per triangle, picked from its middle and its (smooth) normal */
function triColors(g: Geo, color: (c: THREE.Vector3, n: THREE.Vector3) => THREE.Color) {
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const x = g.index ? g.toNonIndexed() : g.clone()
  g.dispose()
  const p = x.getAttribute('position')
  const n = x.getAttribute('normal')
  const col = new Float32Array(p.count * 3)
  const c = V()
  const m = V()
  for (let i = 0; i < p.count; i += 3) {
    c.set(0, 0, 0)
    m.set(0, 0, 0)
    for (let j = 0; j < 3; j++) {
      c.x += p.getX(i + j) / 3
      c.y += p.getY(i + j) / 3
      c.z += p.getZ(i + j) / 3
      m.x += n.getX(i + j)
      m.y += n.getY(i + j)
      m.z += n.getZ(i + j)
    }
    const k = color(c, m.normalize())
    for (let j = 0; j < 3; j++) col.set([k.r, k.g, k.b], (i + j) * 3)
  }
  x.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return x
}

/** a colour per vertex, from its position and normal */
function vColors(g: Geo, color: (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color) {
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const p = g.getAttribute('position')
  const n = g.getAttribute('normal')
  const col = new Float32Array(p.count * 3)
  const a = V()
  const b = V()
  for (let i = 0; i < p.count; i++) {
    const c = color(a.fromBufferAttribute(p, i), b.fromBufferAttribute(n, i))
    col.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** a softly lumpy unit ball, lighter on the lumps (fur, frosting) */
function lumpy(detail: number, amp: number, seed: number, light = 0.5) {
  const g = new THREE.IcosahedronGeometry(1, detail)
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  const v = V()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const l = Math.sin(v.x * 6.3 + seed) * Math.sin(v.y * 5.7 + seed * 1.7) * Math.sin(v.z * 6.9 + seed * 2.3)
    v.multiplyScalar(1 + amp * l)
    p.setXYZ(i, v.x, v.y, v.z)
    col.fill(1 + light * l, i * 3, i * 3 + 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return smooth(g)
}

/** a VKit mesh in a group that turns and scales about p */
function part(k: VKit, name: string, p: P3, mat: THREE.Material = castMaterial()) {
  const g = pivot(k.mesh(name, mat), ...p)
  g.userData.rest = { x: p[0], y: p[1], z: p[2] }
  return g
}

/** a cone along +y with its base at the origin, bent sideways towards the tip */
function horn(r: number, h: number, bend: number, seg = 14) {
  const g = new THREE.ConeGeometry(r, h, seg, 6)
  g.translate(0, h / 2, 0)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / h
    p.setX(i, p.getX(i) + bend * t * t * h)
  }
  g.computeVertexNormals()
  return g
}

/** a small arm: a capsule with a round hand, hanging from (x, y, z) at angle `a` (0 = down) */
function arm(k: VKit, color: string, x: number, y: number, z: number, a: number, len = 0.13, r = 0.05) {
  const dx = Math.sin(a)
  const dy = -Math.cos(a)
  k.add(capsule(r, len), color, T([x + dx * len * 0.5, y + dy * len * 0.5, z], [0, 0, a]))
  k.add(sphere(14, 10), color, T([x + dx * (len + r * 0.6), y + dy * (len + r * 0.6), z], [0, 0, 0], r * 1.32))
}

function feet(k: VKit, color: string, xs: number[], y: number, z: number, r = 0.075) {
  for (const x of xs) k.add(sphere(16, 10), color, T([x, y, z], [0, 0, 0], [r * 1.25, r * 0.62, r * 1.15]))
}

/* ---------------- faces ---------------- */

/** cartoon eyes for the monsters: white balls with a dark pupil and two glints; the pupils slide to look around */
function eyes(list: { x: number; y: number; r: number }[], e: Ell | null, z0?: number) {
  const ball = new VKit(INK, 0.016)
  const pup = new VKit(INK)
  for (const { x, y, r } of list) {
    const ez = (z0 ?? (e ? surfaceZ(e, x, y) : 0)) - r * 0.42
    ball.add(new THREE.SphereGeometry(r, 22, 16), '#ffffff', T([x, y, ez]))
    const b: Ell = { c: [x, y, ez], r: [r, r, r] }
    pup.decal(b, ellipsePts(x, y - r * 0.05, r * 0.5, r * 0.55, 20), PUPIL, 0.004, 0)
    pup.decal(b, ellipsePts(x + r * 0.17, y + r * 0.16, r * 0.17, r * 0.17, 12), SPARK, 0.008, 0)
    pup.decal(b, ellipsePts(x - r * 0.15, y - r * 0.2, r * 0.07, r * 0.07, 8), SPARK, 0.008, 0)
  }
  const g = new THREE.Group()
  g.name = 'eyes'
  g.add(ball.mesh('ball', castMaterial()))
  g.add(pup.mesh('pupils', castMaterial()))
  g.userData.look = list[0].r * 0.2
  const cy = list.reduce((a, l) => a + l.y, 0) / list.length
  return pivot(g, 0, cy)
}

interface Eye {
  x: number
  y: number
  rx: number
  ry: number
}

/** toy eyes for the snacks: glossy white domes set into the surface, big pupils with two glints */
function domeEyes(f: Surf, list: Eye[], look: P2 = [0.06, 0.02]) {
  const k = new VKit(INK, 0.011)
  let cz = 0
  for (const e of list) {
    const rz = Math.min(e.rx, e.ry) * 0.62
    const z = f(e.x, e.y) - rz * 0.38
    cz += z / list.length
    k.add(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', T([e.x, e.y, z], [Math.PI / 2, 0, 0], [e.rx, rz, e.ry]))
    const ball: Ell = { c: [e.x, e.y, z], r: [e.rx, e.ry, rz] }
    const px = e.x + look[0] * e.rx
    const py = e.y + look[1] * e.ry - e.ry * 0.06
    k.decal(ball, ellipsePts(px, py, e.rx * 0.6, e.ry * 0.64, 18), PUPIL, 0.003, 0)
    k.decal(ball, ellipsePts(px - e.rx * 0.2, py + e.ry * 0.25, e.rx * 0.22, e.ry * 0.2, 10), SPARK, 0.006, 0)
    k.decal(ball, ellipsePts(px + e.rx * 0.22, py - e.ry * 0.27, e.rx * 0.1, e.ry * 0.09, 8), SPARK, 0.006, 0)
  }
  const cx = list.reduce((a, e) => a + e.x, 0) / list.length
  const cy = list.reduce((a, e) => a + e.y, 0) / list.length
  return part(k, 'eyes', [cx, cy, cz])
}

interface MouthAt {
  x: number
  y: number
  /** half width */
  w: number
  /** depth below the corners */
  h: number
}

/** a closed smile: a pen stroke that curls up at the corners */
function smile(k: VKit, f: Surf, m: MouthAt, lift: number, thick = 0.014) {
  const pts: P2[] = Array.from({ length: 13 }, (_, i) => {
    const t = -1 + (2 * i) / 12
    return [m.x + t * m.w, m.y - m.h * (1 - t * t) + 0.25 * m.h * t ** 6]
  })
  stroke(k, f, pts, thick, lift)
}

/** an open laughing mouth: dark inside with a tongue, flat along the top */
function openMouth(k: VKit, f: Surf, m: MouthAt, lift: number) {
  const top = (x: number) => m.y - 0.18 * m.h * (1 - ((x - m.x) / m.w) ** 2)
  const xs = Array.from({ length: 15 }, (_, i) => m.x - m.w + (2 * m.w * i) / 14)
  const out: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, top(x) - m.h * Math.sqrt(Math.max(0, 1 - ((x - m.x) / m.w) ** 2))])]
  const mid: P2 = [m.x, m.y - m.h * 0.5]
  paint(k, f, out, MOUTH, lift, true, 0.008, mid)
  paint(k, f, oval(m.x, m.y - m.h * 0.72, m.w * 0.5, m.h * 0.3, 0, 14), TONGUE, lift + 0.002)
}

/** the win face: happy ^ ^ eyes and an open mouth over the smile; hidden until a win */
function joyFace(f: Surf, list: Eye[], m: MouthAt, lift: number, mf = f) {
  const k = new VKit(INK)
  for (const e of list) stroke(k, f, arc(e.x, e.y - e.ry * 0.35, e.rx * 0.95, e.ry * 0.85, Math.PI * 0.92, Math.PI * 0.08, 12), Math.max(0.016, e.rx * 0.34), lift + 0.01)
  openMouth(k, mf, m, lift + 0.006)
  const mesh = k.mesh('joy', castMaterial())
  mesh.visible = false
  return mesh
}

function blush(k: VKit, f: Surf, pts: P2[], rx: number, ry: number, color = '#ff9ccf', lift = 0.004) {
  for (const [x, y] of pts) paint(k, f, oval(x, y, rx, ry, 0, 14), color, lift, false)
}

interface MonsterMouth {
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

/** an open cartoon mouth on a monster: dark inside, a tongue, teeth along the top and fangs; pivots on the top lip */
function mouth(e: Ell, o: MonsterMouth) {
  const k = new VKit(INK)
  const cx = o.x ?? 0
  const sm = o.smile ?? 0.35
  const top = (x: number) => o.y - sm * o.h * (1 - ((x - cx) / o.w) ** 2)
  const bot = (x: number) => top(x) - o.h * Math.max(0, 1 - ((x - cx) / o.w) ** 2) ** 0.62
  const N = 26
  const xs = Array.from({ length: N + 1 }, (_, i) => cx - o.w + (2 * o.w * i) / N)
  const outline: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, bot(x)])]
  const mid: P2 = [cx, (top(cx) + bot(cx)) / 2]
  k.decal(e, outline, MOUTH, 0.006, 0.016, mid)
  if (o.tongue !== false) {
    const tw = o.w * 0.56
    const tx = Array.from({ length: 15 }, (_, i) => cx - tw + (2 * tw * i) / 14)
    const lo = (x: number) => top(x) + (bot(x) - top(x)) * 0.9
    const hi = (x: number) => top(x) + (bot(x) - top(x)) * 0.48 - o.h * 0.06 * Math.cos(((x - cx) / tw) * Math.PI * 0.5)
    const t: P2[] = [...tx.map((x): P2 => [x, lo(x)]), ...tx.slice(1, -1).reverse().map((x): P2 => [x, hi(x)])]
    k.decal(e, t, TONGUE, 0.009, 0, [cx, (lo(cx) + hi(cx)) / 2])
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
    k.decal(e, pts, '#ffffff', 0.012, 0.007, [x, y0 + (up ? h : -h) / 3], false)
  }
  for (const t of o.teeth ?? []) tooth(cx + t * o.w, o.w * 0.09, o.h * 0.22, false)
  for (const t of o.fangs ?? []) tooth(cx + t * o.w, o.w * 0.11, o.h * 0.5, false)
  for (const t of o.under ?? []) tooth(cx + t * o.w, o.w * 0.1, o.h * 0.5, true)
  return pivot(k.mesh('mouth', castMaterial()), cx, o.y, surfaceZ(e, cx, o.y) - 0.02)
}

/* ------------------------------------------------------------------ */
/*  The monsters                                                        */
/* ------------------------------------------------------------------ */

/** a white shine on the upper left of a body, where the key light catches it */
function shine(k: VKit, e: Ell, x: number, y: number, s = 1) {
  k.decal(e, oval(x, y, 0.055 * s, 0.024 * s, 0.65), SHINE, 0.004, 0)
  k.decal(e, ellipsePts(x + 0.05 * s, y - 0.04 * s, 0.012 * s, 0.012 * s, 8), SHINE, 0.004, 0)
}

/** Grumbo: a round purple cyclops with curly horns and a huge grin, arms up */
function buildGrumbo() {
  const col = SYMBOL_COLOR.grumbo
  const e: Ell = { c: [0, -0.04, 0], r: [0.36, 0.33, 0.32] }
  const k = new VKit(INK)
  k.add(sphere(), col, T(e.c, [0, 0, 0], e.r))
  feet(k, shade(col, 0.8), [-0.15, 0.15], -0.36, 0.05)
  for (const s of [-1, 1]) {
    k.add(horn(0.07, 0.2, s * 0.55), '#fff1d6', T([s * 0.17, 0.21, -0.02], [0, 0, -s * 0.55]))
    arm(k, col, s * 0.33, -0.02, 0.02, s * 2.35, 0.12, 0.048)
  }
  k.decal(e, ellipsePts(0, -0.2, 0.19, 0.12), lighten(col, 0.35), 0.003, 0, undefined, false)
  k.decal(e, [[-0.13, 0.24], [0.13, 0.24], [0.11, 0.27], [-0.11, 0.27]], shade(col, 0.45), 0.004, 0)
  shine(k, e, -0.22, 0.13)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  root.add(eyes([{ x: 0, y: 0.08, r: 0.135 }], e))
  root.add(mouth(e, { y: -0.08, w: 0.19, h: 0.12, smile: 0.5, teeth: [-0.45, -0.15, 0.15, 0.45], fangs: [-0.72, 0.72] }))
  return root
}

/** Fang: a fuzzy orange ball with spikes, cheeky brows and an underbite */
function buildFang() {
  const col = SYMBOL_COLOR.fang
  const e: Ell = { c: [0, -0.03, 0], r: [0.32, 0.31, 0.3] }
  const k = new VKit(INK)
  k.add(sphere(), col, T(e.c, [0, 0, 0], e.r))
  const spikes = 13
  for (let i = 0; i < spikes; i++) {
    const a = (-38 + (256 * i) / (spikes - 1)) * (Math.PI / 180)
    const dir = V(Math.cos(a), Math.sin(a), 0)
    const pos = V(e.c[0] + dir.x * 0.27, e.c[1] + dir.y * 0.26, -0.04)
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir)
    const g = new THREE.ConeGeometry(0.06, 0.13, 10, 2)
    g.translate(0, 0.065, 0)
    k.add(g, shade(col, 0.88), new THREE.Matrix4().compose(pos, q, V(1, 1, 0.8)))
  }
  feet(k, shade(col, 0.75), [-0.13, 0.13], -0.33, 0.05)
  for (const s of [-1, 1]) arm(k, col, s * 0.29, -0.1, 0.04, s * 0.5, 0.1, 0.045)
  k.decal(e, ellipsePts(0, -0.18, 0.16, 0.1), lighten(col, 0.4), 0.003, 0, undefined, false)
  for (const s of [-1, 1]) k.decal(e, [[s * 0.05, 0.17], [s * 0.18, 0.21], [s * 0.18, 0.24], [s * 0.05, 0.2]], '#5a1d05', 0.004, 0)
  shine(k, e, -0.2, 0.15, 0.9)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  root.add(eyes([{ x: -0.1, y: 0.07, r: 0.082 }, { x: 0.1, y: 0.07, r: 0.082 }], e))
  root.add(mouth(e, { y: -0.07, w: 0.15, h: 0.1, smile: 0.25, under: [-0.55, 0.55], tongue: true }))
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
  const k = new VKit(INK)
  k.add(new THREE.LatheGeometry(prof, 36), col)
  // a body-like ellipsoid for the face decals, matching the bean around the face
  const e: Ell = { c: [0, -0.08, 0], r: [0.25, 0.3, 0.255] }
  feet(k, shade(col, 0.75), [-0.12, 0.12], -0.36, 0.06)
  for (const s of [-1, 1]) arm(k, col, s * 0.22, -0.14, 0.03, s * 0.9, 0.1, 0.042)
  for (const [x, y, r] of [
    [-0.15, -0.2, 0.035],
    [0.16, -0.24, 0.028],
    [0.12, 0.04, 0.022],
  ])
    k.decal(e, ellipsePts(x, y, r, r), shade(col, 0.78), 0.003, 0, undefined, false)
  shine(k, e, -0.14, 0.08, 0.8)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  const stalks = new THREE.Group()
  stalks.name = 'stalks'
  for (const [x, h, a] of [
    [-0.1, 0.17, 0.35],
    [0, 0.21, 0],
    [0.1, 0.16, -0.35],
  ]) {
    const s = new VKit(INK)
    s.add(new THREE.CylinderGeometry(0.022, 0.03, h, 10, 3), shade(col, 0.92), T([0, h / 2, 0]))
    const one = new THREE.Group()
    one.add(s.mesh('stalk', castMaterial()))
    one.add(eyes([{ x: 0, y: h + 0.045, r: 0.06 }], null, 0.02))
    const holder = new THREE.Group()
    holder.position.set(x, 0.2, 0)
    holder.rotation.z = a
    holder.add(one)
    stalks.add(holder)
  }
  root.add(stalks)
  root.add(mouth(e, { y: -0.05, w: 0.1, h: 0.065, smile: 0.6, teeth: [0.25], tongue: true }))
  return root
}

/** Mimi: a pink round bat with big lashy eyes, flapping wings and one tiny fang */
function buildMimi() {
  const col = SYMBOL_COLOR.mimi
  const e: Ell = { c: [0, -0.05, 0], r: [0.3, 0.29, 0.29] }
  const k = new VKit(INK)
  k.add(sphere(), col, T(e.c, [0, 0, 0], e.r))
  for (const s of [-1, 1]) k.add(horn(0.045, 0.09, s * 0.3), shade(col, 0.8), T([s * 0.13, 0.2, 0.02], [0, 0, -s * 0.35]))
  feet(k, shade(col, 0.78), [-0.12, 0.12], -0.33, 0.05)
  k.decal(e, ellipsePts(0, -0.2, 0.15, 0.09), lighten(col, 0.45), 0.003, 0, undefined, false)
  for (const s of [-1, 1]) k.decal(e, ellipsePts(s * 0.18, -0.07, 0.045, 0.03), '#ff9cc8', 0.003, 0)
  // lashes
  for (const s of [-1, 1])
    for (const [dx, dy, len] of [
      [0.07, 0.07, 0.045],
      [0.1, 0.03, 0.04],
    ]) {
      const x0 = s * (0.1 + dx * 0.9)
      const y0 = 0.05 + dy
      k.decal(e, [[x0, y0], [x0 + s * len, y0 + len * 0.55], [x0 + s * len * 0.9, y0 + len * 0.75], [x0 - s * 0.006, y0 + 0.016]], INK, 0.006, 0)
    }
  shine(k, e, -0.2, 0.12, 0.85)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
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
    const w = new VKit(INK, 0.012)
    const g = new THREE.ExtrudeGeometry(wing, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 10 })
    w.add(smooth(g), '#9b3fd6', T([0, 0, -0.01], [0, 0, 0], [s, 1, 1]))
    const holder = new THREE.Group()
    holder.name = s < 0 ? 'wingL' : 'wingR'
    holder.position.set(s * 0.22, 0.02, -0.08)
    holder.add(w.mesh('wing', castMaterial()))
    root.add(holder)
  }
  root.add(eyes([{ x: -0.1, y: 0.05, r: 0.092 }, { x: 0.1, y: 0.05, r: 0.092 }], e))
  root.add(mouth(e, { y: -0.11, w: 0.075, h: 0.045, smile: 0.7, fangs: [0.45], tongue: false }))
  return root
}

/** The wild: a big Boje-green chomper in a gold crown, with the widest mouth in town */
function buildWild() {
  const col = SYMBOL_COLOR.wild
  const e: Ell = { c: [0, -0.02, 0], r: [0.37, 0.35, 0.33] }
  const k = new VKit(INK)
  k.add(sphere(), col, T(e.c, [0, 0, 0], e.r))
  feet(k, shade(col, 0.75), [-0.16, 0.16], -0.36, 0.06)
  for (const s of [-1, 1]) arm(k, col, s * 0.35, -0.05, 0.02, s * 2.1, 0.11, 0.05)
  k.decal(e, ellipsePts(0, -0.22, 0.2, 0.1), lighten(col, 0.45), 0.003, 0, undefined, false)
  // tuft of hair
  for (const [x, a, h] of [
    [-0.05, 0.4, 0.1],
    [0, 0, 0.13],
    [0.05, -0.4, 0.1],
  ])
    k.add(horn(0.035, h, -a * 0.4, 10), shade(col, 0.8), T([x, 0.3, -0.06], [0, 0, a]))
  for (const s of [-1, 1]) k.decal(e, [[s * 0.05, 0.24], [s * 0.2, 0.255], [s * 0.2, 0.285], [s * 0.05, 0.27]], '#0b4d28', 0.004, 0)
  shine(k, e, -0.25, 0.1)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  // crown
  const c = new VKit(INK)
  const gold = '#ffc93d'
  c.add(new THREE.CylinderGeometry(0.15, 0.165, 0.08, 30, 1), gold)
  for (let i = 0; i < 5; i++) {
    const a = ((i - 2) / 2) * 1.05
    const p = V(Math.sin(a) * 0.155, 0.04, Math.cos(a) * 0.155)
    c.add(new THREE.ConeGeometry(0.038, 0.1, 10, 1), gold, T([p.x, p.y + 0.05, p.z], [Math.cos(a) * 0.12, 0, -Math.sin(a) * 0.12]))
    c.add(new THREE.SphereGeometry(0.02, 10, 8), '#fff6d8', T([p.x * 1.02, p.y + 0.105, p.z * 1.02]), 0.008)
  }
  c.add(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 6, 1), C('#2ee87f', 1.25), T([0, 0, 0.165], [Math.PI / 2, 0, 0]), 0.01, true)
  c.add(new THREE.SphereGeometry(0.012, 6, 4), SPARK, T([-0.012, 0.012, 0.183]), 0, true)
  const crown = new THREE.Group()
  crown.name = 'crown'
  crown.add(c.mesh('crownMesh', castMaterial()))
  crown.position.set(0.02, 0.37, -0.02)
  crown.rotation.set(0.32, 0, -0.14)
  root.add(crown)
  root.add(eyes([{ x: -0.12, y: 0.12, r: 0.092 }, { x: 0.12, y: 0.12, r: 0.092 }], e))
  root.add(mouth(e, { y: -0.03, w: 0.23, h: 0.17, smile: 0.4, teeth: [-0.62, -0.3, 0, 0.3, 0.62], fangs: [-0.85, 0.85], under: [-0.4, 0.4] }))
  // the WILD plaque
  const pl = new THREE.Mesh(planeGeo(), plaqueMaterial())
  pl.scale.set(0.66, 0.215, 1)
  pl.position.set(0, -0.37, 0.36)
  pl.renderOrder = 3
  pl.name = 'plaque'
  root.add(pl)
  return root
}

/** The scatter: a cream monster egg with spots, a glowing crack and a little nest */
function buildEgg() {
  const k = new VKit(INK)
  const prof: THREE.Vector2[] = []
  const R = (t: number) => Math.sin(t) * 0.235 * (1 + 0.13 * Math.cos(t))
  const Y = (t: number) => -Math.cos(t) * 0.31 - 0.02
  for (let i = 0; i <= 28; i++) {
    const t = (i / 28) * Math.PI
    prof.push(new THREE.Vector2(Math.max(0.0001, R(t)), Y(t)))
  }
  k.add(new THREE.LatheGeometry(prof, 40), '#fff4dc')
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
    k.add(new THREE.SphereGeometry(r, 14, 8), c, new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), n), V(1, 1, 0.25)), 0)
  }
  // a shine on the shell
  k.add(new THREE.SphereGeometry(1, 10, 6), SHINE, new THREE.Matrix4().compose(surf(0.95 * 1.9, -0.55, 0.003), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(-0.5, 0.35, 0.8).normalize()), V(0.022, 0.05, 0.006)), 0, true)
  // a nest of straw round its foot: a lumpy bowl with twigs sticking out
  k.add(lumpy(3, 0.12, 5, 0.35), '#c4823f', T([0, -0.31, 0.01], [0, 0, 0], [0.25, 0.075, 0.17]))
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + 0.2
    const c = Math.cos(a)
    const s = Math.sin(a)
    if (s < -0.3) continue
    k.add(new THREE.CapsuleGeometry(0.011, 0.11, 2, 5), i % 2 ? '#e0a45c' : '#a8682e', T([c * 0.22, -0.29 + 0.02 * (i % 3), s * 0.14], [0.2 * (i % 3), 0, c * 1.1 + (i % 2 ? 0.3 : -0.3)]), 0.006)
  }
  // the crack, glowing
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 10; i++) {
    const a = -1.05 + (2.1 * i) / 10
    const t = 1.62 + (i % 2 ? 0.12 : -0.08)
    pts.push(surf(t, a, 0.004))
  }
  const path = new THREE.CurvePath<THREE.Vector3>()
  for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]))
  k.add(new THREE.TubeGeometry(path, 50, 0.012, 5, false), C('#ffe14d', 1.8), undefined, 0, true)
  // a hole broken in the shell above the crack, glowing round its edge, with someone peeking out
  const ef: Surf = (x, y) => {
    const t = Math.acos(Math.max(-1, Math.min(1, -(y + 0.02) / 0.31)))
    const r = R(t)
    return Math.sqrt(Math.max(0, r * r - x * x))
  }
  const hole: P2[] = Array.from({ length: 18 }, (_, i) => {
    const a = (i / 18) * Math.PI * 2
    const r = i % 2 ? 0.8 : 1
    return [Math.cos(a) * 0.1 * r, 0.078 + Math.sin(a) * 0.066 * r]
  })
  paint(k, ef, fatten(hole, 0.016, [0, 0.078]), C('#ffe14d', 1.7), 0.004, true, 0, [0, 0.078])
  paint(k, ef, hole, '#22082e', 0.006, true, 0, [0, 0.078])
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  const pk = new VKit(INK)
  for (const s of [-1, 1]) {
    paint(pk, ef, ellipsePts(s * 0.036, 0.074, 0.024, 0.029, 14), '#ffffff', 0.009, true)
    paint(pk, ef, ellipsePts(s * 0.034 + 0.004, 0.07, 0.012, 0.015, 10), PUPIL, 0.011, true)
    paint(pk, ef, ellipsePts(s * 0.034 + 0.009, 0.077, 0.005, 0.005, 8), SPARK, 0.013, true)
  }
  root.add(part(pk, 'eyes', [0, 0.074, ef(0, 0.074)]))
  const h = new THREE.Sprite(haloMaterial())
  h.scale.set(1.1, 1.1, 1)
  h.position.z = -0.3
  h.name = 'halo'
  root.add(h)
  return root
}

/** Donuts: dough, a wavy icing in the colour of the value, sprinkles. The value label is added per cell. */
function buildDonut(icing: string) {
  const k = new VKit(INK)
  k.add(new THREE.TorusGeometry(0.235, 0.118, 20, 44), '#e9a656')
  const ice = new THREE.TorusGeometry(0.236, 0.124, 20, 44).toNonIndexed()
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
  k.add(kept, icing, undefined, 0)
  const cols = ['#ffffff', '#ffe14d', '#3dd9ff', '#2ee87f', '#ff4d61', '#b06bff']
  let seed = 7
  const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2
    const b = 0.15 + r() * 1.1
    const ring = 0.236 + Math.cos(b) * 0.124
    const pos = V(Math.cos(a) * ring, Math.sin(a) * ring, Math.sin(b) * 0.127)
    if (pos.z < 0.05) continue
    k.add(new THREE.CapsuleGeometry(0.011, 0.038, 2, 5), cols[i % cols.length], T([pos.x, pos.y, pos.z], [r() * 3, r() * 3, r() * 3]), 0)
  }
  // a shine on the icing
  k.add(new THREE.SphereGeometry(1, 8, 5), SHINE, new THREE.Matrix4().compose(V(-0.17, 0.2, 0.12), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), V(-0.4, 0.4, 0.8).normalize()), V(0.05, 0.016, 0.004).applyAxisAngle(V(0, 0, 1), 0)), 0, true)
  const root = new THREE.Group()
  const body = k.mesh('body', castMaterial())
  body.rotation.x = -0.28
  root.add(body)
  return root
}

/* ------------------------------------------------------------------ */
/*  The snacks (the low symbols)                                        */
/* ------------------------------------------------------------------ */

/** the face every snack wears: dome eyes, a smile and cheeks, plus the hidden win face */
function snackFace(root: THREE.Group, k: VKit, f: Surf, cx: number, cy: number, s = 1, cheeks = '#ff8fb5') {
  const list: Eye[] = [
    { x: cx - 0.07 * s, y: cy, rx: 0.05 * s, ry: 0.06 * s },
    { x: cx + 0.07 * s, y: cy, rx: 0.05 * s, ry: 0.06 * s },
  ]
  const m: MouthAt = { x: cx, y: cy - 0.075 * s, w: 0.04 * s, h: 0.024 * s }
  smile(k, f, m, 0.008, 0.014 * s)
  blush(k, f, [
    [cx - 0.13 * s, cy - 0.065 * s],
    [cx + 0.13 * s, cy - 0.065 * s],
  ], 0.028 * s, 0.017 * s, cheeks)
  root.add(domeEyes(f, list))
  root.add(joyFace(f, list, { ...m, y: m.y + 0.008 * s, w: 0.046 * s, h: 0.045 * s }, 0.01))
}

/** a fluted cone: the radius rises and falls `n` times round */
function flute(g: Geo, n: number, amp: number) {
  const p = g.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    if (Math.hypot(x, z) < 1e-5) continue
    const s = 1 + amp * Math.cos(n * Math.atan2(x, z))
    p.setX(i, x * s)
    p.setZ(i, z * s)
  }
  return g
}

/** the front of a cone, radius rB at yB to rT at yT */
function coneSurf(rT: number, rB: number, yT: number, yB: number): Surf {
  return (x, y) => {
    const t = Math.min(1, Math.max(0, (y - yB) / (yT - yB)))
    const r = rB + (rT - rB) * t
    return Math.sqrt(Math.max(0, r * r - x * x))
  }
}

/** Cupcake: a pink frosting swirl with sprinkles and a cherry, in a golden paper cup with a face */
function buildCupcake() {
  const frost = SYMBOL_COLOR.cupcake
  const k = new VKit(INK)
  const yT = -0.1
  const yB = -0.37
  const rT = 0.28
  const rB = 0.2
  // the paper cup: fluted, pleats catching the light on one side
  const cup = smooth(flute(new THREE.CylinderGeometry(rT, rB, yT - yB, 40, 3, false, Math.PI), 20, 0.035))
  const lightP = C('#ffd84d')
  const darkP = C('#ffad2e')
  k.add(triColors(cup, (c) => (Math.floor(((Math.atan2(c.x, c.z) + Math.PI) / (2 * Math.PI)) * 40) % 2 ? lightP : darkP)), '#ffffff', T([0, (yT + yB) / 2, 0]))
  // the frosting: a piped swirl round a core, a skirt over the cup's rim
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= 90; i++) {
    const t = i / 90
    const a = Math.PI + t * Math.PI * 2 * 2.3
    const R = 0.205 * (1 - t) ** 0.85 + 0.022
    pts.push(V(Math.sin(a) * R, -0.07 + t * 0.26, Math.cos(a) * R))
  }
  const curve = new THREE.CatmullRomCurve3(pts)
  k.add(new THREE.TubeGeometry(curve, 130, 0.08, 12, false), frost)
  k.add(sphere(18, 12), frost, T([0, 0.0, 0], [0, 0, 0], [0.2, 0.15, 0.2]))
  k.add(new THREE.TorusGeometry(0.235, 0.07, 10, 40), frost, T([0, -0.085, 0], [Math.PI / 2, 0, 0]))
  const end = curve.getPoint(1)
  k.add(sphere(12, 8), frost, T([end.x, end.y, end.z], [0, 0, 0], 0.08))
  k.add(horn(0.06, 0.11, 0.35, 12), frost, T([end.x, end.y + 0.04, end.z], [0, 0, -0.2]))
  // sprinkles on the front of the swirl
  const sp = ['#ffffff', '#ffe14d', '#3dd9ff', '#2ee87f', '#b06bff', '#ff8a2a']
  let seed = 3
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  for (let i = 0; i < 26; i++) {
    const t = 0.04 + rnd() * 0.88
    const c = curve.getPoint(t)
    const out = V(c.x, 0, c.z).normalize().multiplyScalar(0.75).add(V(0, 0.65, 0)).normalize()
    const at = c.clone().addScaledVector(out, 0.078)
    if (at.z < 0.03) continue
    k.add(capsule(0.011, 0.034), sp[i % sp.length], new THREE.Matrix4().compose(at, new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), V(1, 1, 1)), 0)
  }
  k.decal({ c: [0, 0, 0], r: [0.2, 0.15, 0.2] }, oval(-0.09, 0.09, 0.05, 0.02, 0.5), SHINE, 0.09, 0)
  const root = new THREE.Group()
  const f = coneSurf(rT * 1.035, rB * 1.035, yT, yB)
  snackFace(root, k, f, 0, -0.195, 1, '#ff7a9c')
  root.add(k.mesh('body', castMaterial()))
  // the cherry, on a stalk, bobbing on its own
  const ch = new VKit(INK)
  const cc: P3 = [0.01, 0.31, 0.02]
  ch.add(sphere(16, 12), '#ff2b4e', T(cc, [0, 0, 0], 0.075))
  ch.decal({ c: cc, r: [0.075, 0.075, 0.075] }, oval(cc[0] - 0.026, cc[1] + 0.026, 0.02, 0.011, 0.7), SHINE, 0.003, 0)
  const stem = new THREE.CatmullRomCurve3([V(cc[0], cc[1] + 0.06, cc[2]), V(cc[0] + 0.02, cc[1] + 0.12, cc[2] - 0.01), V(cc[0] + 0.07, cc[1] + 0.16, cc[2] - 0.02)])
  ch.add(new THREE.TubeGeometry(stem, 10, 0.012, 6, false), '#4f8f2c', undefined, 0.01)
  ch.add(sphere(8, 6), '#4f8f2c', T([cc[0] + 0.07, cc[1] + 0.16, cc[2] - 0.02], [0, 0, 0], 0.013), 0.01)
  root.add(part(ch, 'cherry', [cc[0], cc[1] - 0.07, cc[2]]))
  const holder = new THREE.Group()
  holder.position.y = -0.03
  holder.add(root)
  return holder
}

/** Lolly: a rainbow swirl lollipop on a stick with a pink bow; the swirl turns, the face stays put on its cream middle */
function buildLolly() {
  const R = 0.285
  const D = 0.072
  const cy = 0.12
  const k = new VKit(INK)
  k.add(capsule(0.027, 0.2), '#fff4ea', T([0, cy - R - 0.1, -0.03]))
  // the bow at the top of the stick
  const bow = '#ff4fb8'
  for (const s of [-1, 1]) {
    k.add(sphere(12, 8), bow, T([s * 0.065, cy - R - 0.005, 0.045], [0, 0, s * 0.45], [0.07, 0.042, 0.03]))
    k.add(capsule(0.017, 0.06), shade(bow, 0.85), T([s * 0.033, cy - R - 0.065, 0.045], [0, 0, s * 0.35]), 0.012)
  }
  k.add(sphere(10, 8), shade(bow, 0.85), T([0, cy - R - 0.005, 0.055], [0, 0, 0], 0.028))
  const root = new THREE.Group()
  // the swirl: a lens, striped in a rainbow spiral round a cream middle, drawn in rings so the bands stay crisp
  const s = new VKit(INK)
  const lens = new THREE.SphereGeometry(1, 72, 48)
  lens.rotateX(Math.PI / 2)
  const RAIN = ['#ff3b5c', '#ff9a1f', '#ffe03a', '#47e06a', '#36b8ff', '#9a5cff'].map((c) => C(c))
  const CREAM = C('#fff6ec')
  const rim = C('#ffd1ea')
  // the outline comes from a plainer lens just inside the striped one, which needs no hull of its own
  s.add(sphere(32, 16), CREAM, T([0, cy, 0], [0, 0, 0], [R * 0.995, R * 0.995, D * 0.98]))
  s.add(
    triColors(lens, (c) => {
      const r = Math.hypot(c.x, c.y)
      if (r > 0.97) return rim
      if (r < 0.5) return CREAM
      const a = Math.atan2(c.y, c.x) / (Math.PI * 2)
      const u = ((((a + r * 1.1) % 1) + 1) % 1) * 6
      return u % 1 < 0.2 ? CREAM : RAIN[Math.floor(u) % 6]
    }),
    '#ffffff',
    T([0, cy, 0], [0, 0, 0], [R, R, D]),
    0,
  )
  root.add(part(s, 'swirl', [0, cy, 0]))
  // the gloss and the face sit in front of the swirl and do not turn with it
  const e: Ell = { c: [0, cy, 0], r: [R, R, D] }
  const f = ellSurf(e)
  k.decal(e, oval(-0.15, cy + 0.14, 0.06, 0.024, 0.75), C('#ffffff', 1.15), 0.006, 0)
  k.decal(e, ellipsePts(-0.08, cy + 0.2, 0.013, 0.013, 8), C('#ffffff', 1.15), 0.006, 0)
  snackFace(root, k, f, 0, cy + 0.025, 0.95, '#ff8fc0')
  root.add(k.mesh('body', castMaterial()))
  return root
}

/** Cookie: a puffy choc-chip cookie with a bite out of it */
function buildCookie() {
  const R = 0.31
  const TH = 0.08
  const bites: [number, number, number][] = (
    [
      [38, 0.095],
      [60, 0.078],
      [18, 0.07],
    ] as const
  ).map(([deg, r]) => [Math.cos((deg * Math.PI) / 180) * R * 1.02, Math.sin((deg * Math.PI) / 180) * R * 1.02, r])
  const outline = (a: number) => {
    let r = R * (1 + 0.016 * Math.sin(a * 9 + 1) + 0.01 * Math.sin(a * 23))
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    for (const [bx, by, br] of bites) {
      const p = dx * bx + dy * by
      const q = bx * bx + by * by - p * p
      if (q < br * br) {
        const t = p - Math.sqrt(br * br - q)
        if (t > 0) r = Math.min(r, t)
      }
    }
    return r
  }
  // a lens with its rim pulled in to the bitten outline and its faces flattened into a puffy disc
  const g = smooth(new THREE.SphereGeometry(1, 64, 26).rotateX(Math.PI / 2))
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const bitten = new Float32Array(p.count)
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    const rho = Math.min(1, Math.hypot(x, y))
    const a = Math.atan2(y, x)
    const ro = outline(a)
    bitten[i] = ro < R * 0.95 ? 1 : 0
    const front = z >= 0 ? 1 : -1
    const h = TH * Math.pow(Math.max(0, 1 - rho * rho), 0.32) + (front > 0 ? 0.018 * (1 - rho * rho) : 0)
    p.setXYZ(i, x * ro, y * ro, front * h)
  }
  g.computeVertexNormals()
  const top = C('#efb566')
  const mid = C('#dd9a4c')
  const side = C('#b8722f')
  const crumb = C('#f7d7a0')
  let vi = 0
  vColors(g, (q, n) => {
    const i = vi++
    const rho = Math.hypot(q.x, q.y) / R
    const c = side.clone().lerp(mid, Math.min(1, Math.max(0, n.z * 1.6)))
    if (n.z > 0.5) c.lerp(top, Math.min(1, (1 - rho) * 1.4))
    if (bitten[i] && rho > 0.62 && n.z < 0.85) c.lerp(crumb, 0.85)
    return c
  })
  const k = new VKit(INK)
  k.add(g, '#ffffff')
  const f: Surf = (x, y) => {
    const rho = Math.min(1, Math.hypot(x, y) / R)
    return TH * Math.pow(Math.max(0, 1 - rho * rho), 0.32) + 0.018 * (1 - rho * rho)
  }
  // chocolate chips and a few darker specks
  const chips: [number, number, number][] = [
    [-0.15, 0.13, 1],
    [0.02, 0.2, 0.85],
    [-0.21, -0.07, 0.9],
    [0.17, -0.15, 1],
    [-0.05, -0.21, 0.8],
    [0.2, 0.04, 0.75],
    [-0.1, 0.24, 0.7],
    [0.08, -0.25, 0.65],
  ]
  for (const [x, y, s] of chips) {
    const z = f(x, y)
    k.add(new THREE.SphereGeometry(1, 10, 7), '#5a2c14', T([x, y, z - 0.004], [0.3 * s, 0.5, s], [0.04 * s, 0.033 * s, 0.022]), 0.008)
  }
  for (const [x, y] of [
    [0.12, 0.2],
    [-0.24, 0.1],
    [0.24, -0.09],
    [-0.16, -0.18],
    [0.05, 0.1],
  ])
    paint(k, f, ellipsePts(x, y, 0.009, 0.007, 8), '#a8642a', 0.003, false)
  for (const [x, y] of [
    [0.27, 0.23],
    [0.2, 0.3],
    [0.3, 0.12],
  ])
    k.add(new THREE.DodecahedronGeometry(0.016, 0), '#e2a55b', T([x, y, 0.01]), 0.007)
  paint(k, f, oval(-0.13, 0.17, 0.05, 0.018, 0.6), C('#fff2d6', 1.1), 0.004, true)
  const root = new THREE.Group()
  snackFace(root, k, f, -0.02, -0.02, 1, '#ff8f8f')
  root.add(k.mesh('body', castMaterial()))
  return root
}

/** colours a gummy part so it reads as jelly: deep at the edges, glowing where it faces the light, unlit */
function jelly(g: Geo, base: string) {
  const b = C(base)
  const light = C(base).lerp(C('#ffffff'), 0.5)
  const deep = C(base).multiplyScalar(0.5)
  const L = V(-0.45, 0.6, 0.66).normalize()
  return vColors(g, (_, n) => {
    const d = Math.max(0, n.dot(L))
    const face = Math.max(0, n.z)
    const c = deep.clone().lerp(b, Math.min(1, 0.3 + face))
    return c.lerp(light, d ** 5 * 0.75 + face ** 6 * 0.2)
  })
}

/** Gummy: a translucent-looking raspberry gummy bear */
function buildGummy() {
  const col = SYMBOL_COLOR.gummy
  const k = new VKit(INK)
  const add = (sx: number, sy: number, sz: number, p: P3, r: P3 = [0, 0, 0]) => k.add(jelly(sphere(24, 16), col), '#ffffff', T(p, r, [sx, sy, sz]), 0.017, true)
  const body: Ell = { c: [0, -0.09, 0], r: [0.19, 0.2, 0.15] }
  const head: Ell = { c: [0, 0.165, 0.012], r: [0.165, 0.145, 0.135] }
  add(...body.r, body.c)
  for (const s of [-1, 1]) {
    add(0.075, 0.085, 0.072, [s * 0.105, -0.29, 0.03])
    add(0.06, 0.095, 0.06, [s * 0.175, -0.035, 0.035], [0, 0, s * 0.65])
    add(0.058, 0.055, 0.05, [s * 0.118, 0.285, -0.01])
  }
  add(...head.r, head.c)
  const muz: Ell = { c: [0, 0.115, 0.115], r: [0.075, 0.052, 0.05] }
  k.add(jelly(sphere(16, 10), lighten(col, 0.25)), '#ffffff', T(muz.c, [0, 0, 0], muz.r), 0.012, true)
  // gloss
  k.decal(head, oval(-0.08, 0.235, 0.045, 0.018, 0.65), SHINE, 0.004, 0)
  k.decal(body, oval(-0.1, 0.0, 0.05, 0.022, 0.9), SHINE, 0.004, 0)
  k.decal(body, ellipsePts(-0.05, -0.05, 0.012, 0.012, 8), SHINE, 0.004, 0)
  k.decal(muz, ellipsePts(0, 0.138, 0.022, 0.015, 12), '#4a0b1c', 0.004, 0)
  smile(k, ellSurf(muz), { x: 0, y: 0.112, w: 0.03, h: 0.02 }, 0.004, 0.011)
  const root = new THREE.Group()
  const list: Eye[] = [
    { x: -0.066, y: 0.19, rx: 0.042, ry: 0.05 },
    { x: 0.066, y: 0.19, rx: 0.042, ry: 0.05 },
  ]
  root.add(domeEyes(ellSurf(head), list))
  root.add(joyFace(ellSurf(head), list, { x: 0, y: 0.115, w: 0.035, h: 0.035 }, 0.008, ellSurf(muz)))
  root.add(k.mesh('body', castMaterial()))
  return root
}

/** Candy: a striped sweet in a crinkly wrapper twisted at both ends; the ends flutter */
function buildCandy() {
  const col = SYMBOL_COLOR.candy
  const e: Ell = { c: [0, 0, 0], r: [0.2, 0.16, 0.15] }
  const k = new VKit(INK)
  const teal = C(col)
  const white = C('#f2fffd')
  k.add(
    triColors(sphere(40, 26), (c) => (((c.x * 0.75 + c.y * 0.66) * 3.4 + 10) % 1 < 0.34 ? white : teal)),
    '#ffffff',
    T(e.c, [0, 0, 0], e.r),
  )
  k.decal(e, oval(-0.09, 0.09, 0.05, 0.02, 0.5), SHINE, 0.004, 0)
  k.decal(e, ellipsePts(-0.04, 0.115, 0.01, 0.01, 8), SHINE, 0.004, 0)
  const knot = shade(col, 0.72)
  for (const s of [-1, 1]) k.add(sphere(14, 10), knot, T([s * 0.2, 0, 0], [0, 0, 0], [0.045, 0.06, 0.06]))
  const root = new THREE.Group()
  snackFace(root, k, ellSurf(e), 0, 0.02, 0.95, '#ff8fc8')
  root.add(k.mesh('body', castMaterial()))
  // the wrapper ends: ruffled cones, pleated light and dark
  const pl = C(lighten(col, 0.55))
  const pd = C(lighten(col, 0.25))
  for (const s of [-1, 1]) {
    const w = new VKit(INK, 0.014)
    const g = new THREE.ConeGeometry(0.14, 0.17, 20, 2)
    const p = g.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > -0.08) continue
      const a = Math.atan2(p.getX(i), p.getZ(i))
      const f = 1 + 0.2 * Math.sin(a * 8)
      p.setXYZ(i, p.getX(i) * f, p.getY(i) + 0.022 * Math.cos(a * 8), p.getZ(i) * f)
    }
    const sm = smooth(g)
    w.add(triColors(sm, (c) => (Math.floor(((Math.atan2(c.x, c.z) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? pl : pd)), '#ffffff', T([s * 0.29, 0, 0], [0, 0, s * (Math.PI / 2)]))
    root.add(part(w, s < 0 ? 'wrapL' : 'wrapR', [s * 0.21, 0, 0]))
  }
  const holder = new THREE.Group()
  holder.rotation.z = 0.32
  holder.scale.setScalar(1.08)
  holder.add(root)
  return holder
}

/* ------------------------------------------------------------------ */
/*  Big Mama Chomp                                                      */
/* ------------------------------------------------------------------ */

export const MAMA_FUR = '#ff4fa3'
const FUR_LIGHT = '#ff8cc8'
const FUR_DEEP = '#d4317e'
const HORN = '#fff1d6'
/** how far her head rises over the frame's top edge (where her chin hides behind the slime) */
const HY = 0.9

/** where Big Mama's features are, in her root's frame (the frame's top edge at y 0, her head's centre at z 0) */
export const MAMA = {
  head: { c: [0, HY, 0] as P3, r: [1.28, 0.95, 0.84] as P3 },
  eyeY: HY + 0.47,
  eyeX: 0.44,
  eyeR: 0.255,
  /** the top lip, the mouth's half width and its depth wide open */
  mouthY: HY + 0.1,
  mouthW: 0.5,
  mouthH: 0.38,
  /** the shoulders, hidden behind the frame */
  shoulder: [-2.95, -0.95, -0.1] as P3,
  /** how far the bottom of the mouth (by the lower fangs) moves between shut and wide open */
  jaw: 0.38 * 0.84 ** 0.6,
}

export interface MamaEye {
  /** the eyeball and lids; scale for wide eyes */
  root: THREE.Group
  /** iris and pupil; rotation.x / rotation.y aim them */
  iris: THREE.Group
  /** upper lid: rotation.x -1.15 open, 0 half, 1.5 shut */
  lid: THREE.Group
  /** lower lid: rotation.x 1.2 down (rest), 0.35 a happy squint */
  low: THREE.Group
}

export interface MamaRig {
  root: THREE.Group
  /** pivots at the neck, on the frame's top edge */
  head: THREE.Group
  eyes: MamaEye[]
  brows: THREE.Group[]
  /** the inside of the mouth: scale.x narrows it (pivoting on the middle of the top lip) */
  mouth: THREE.Group
  /** the mouth mesh: morph target 0 shuts it (influence 1 = shut, 0 = wide open), keeping the curve of the lips */
  mouthMesh: THREE.Mesh
  /** the lower fangs: position.y follows the bottom of the mouth (0 when wide open) */
  jaw: THREE.Group
  /** a tongue that comes out to lick her lips; hidden */
  tongue: THREE.Group
  /** a drop of drool at the corner of her mouth; hidden */
  drool: THREE.Group
  /** her big mitts (left, right): origin at the palm, fingers along +y */
  hands: THREE.Group[]
  /** furry arms (left, right): upper arm and forearm are unit length along +y and are aimed and stretched by the
   *  scene, the upper arm from the shoulder (hidden behind the frame) to the elbow ball, the forearm on to the hand */
  arms: { upper: THREE.Mesh; fore: THREE.Mesh; elbow: THREE.Mesh }[]
  /** a party hat for free spins; hidden */
  hat: THREE.Group
}

/** a furry tuft: a bent cone */
function tuft(r: number, h: number, bend: number) {
  return horn(r, h, bend, 8)
}

/** a mitt: a palm, three fat fingers with claws and a thumb on the inner side; `s` -1 for the left hand */
function mitt(s: number) {
  const k = new VKit(INK, 0.022)
  const mirror = new THREE.Matrix4().makeScale(s, 1, 1)
  const M = (p: P3, r: P3 = [0, 0, 0], sc: number | P3 = 1) => new THREE.Matrix4().multiplyMatrices(mirror, T(p, r, sc))
  const palm: Ell = { c: [0, 0, 0], r: [0.3, 0.25, 0.22] }
  k.add(lumpy(7, 0.03, 4, 0.25), MAMA_FUR, M(palm.c, [0, 0, 0], palm.r))
  for (const [x, a, l] of [
    [-0.17, 0.24, 0.15],
    [0, 0.03, 0.18],
    [0.17, -0.2, 0.15],
  ]) {
    const c: P3 = [x - Math.sin(a) * (l * 0.5 + 0.06), 0.18 + Math.cos(a) * (l * 0.5 + 0.06), 0.03]
    const tip: P3 = [x - Math.sin(a) * (l + 0.17), 0.18 + Math.cos(a) * (l + 0.17), 0.05]
    k.add(capsule(0.092, l), MAMA_FUR, M(c, [0, 0, a]))
    k.add(new THREE.ConeGeometry(0.034, 0.09, 8), HORN, M(tip, [0.45, 0, a]), 0.012)
  }
  k.add(capsule(0.085, 0.11), MAMA_FUR, M([0.28, 0.05, 0.07], [0, 0, -0.95]))
  k.add(onto(fan(oval(0, -0.02, 0.15, 0.11, 0, 18), [0, -0.02], 3), ellSurf(palm), 0.012), FUR_LIGHT, mirror, 0)
  const g = new THREE.Group()
  g.add(k.mesh(s < 0 ? 'handL' : 'handR', castMaterial(true)))
  return g
}

/** Big Mama Chomp: a huge furry magenta monster who peers over the top of the machine and grips its corners */
export function buildMama(): MamaRig {
  const mat = castMaterial(true)
  const H: Ell = { c: MAMA.head.c, r: MAMA.head.r }
  const hf = ellSurf(H)
  const root = new THREE.Group()
  root.name = 'mama'
  const head = new THREE.Group()
  head.name = 'head'
  root.add(head)

  // her shoulders, behind the head, so no sky shows between her chin and the frame
  const bk = new VKit(INK, 0.024)
  bk.add(lumpy(10, 0.03, 2.1, 0.22), MAMA_FUR, T([0, -0.55, -0.45], [0, 0, 0], [2.5, 0.95, 0.7]))
  root.add(bk.mesh('body', mat))

  const k = new VKit(INK, 0.024)
  k.add(lumpy(16, 0.035, 1.3, 0.28), MAMA_FUR, T(H.c, [0, 0, 0], H.r))
  // tufts round the silhouette and a curl on top
  const N = 24
  for (let i = 0; i < N; i++) {
    const a = THREE.MathUtils.degToRad(-28 + (236 * i) / (N - 1))
    if (Math.abs(a - 1.14) < 0.16 || Math.abs(a - 2.0) < 0.16) continue
    const d = V(Math.cos(a) / H.r[0], Math.sin(a) / H.r[1], 0).normalize()
    const at = V(H.c[0] + Math.cos(a) * H.r[0] * 0.93, H.c[1] + Math.sin(a) * H.r[1] * 0.93, -0.05 - 0.1 * (i % 2))
    const big = i % 3 === 0 ? 1.2 : i % 3 === 1 ? 0.9 : 1
    const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d)
    k.add(tuft(0.13 * big, 0.3 * big, (i % 2 ? 0.35 : -0.35) * big), i % 2 ? MAMA_FUR : FUR_DEEP, new THREE.Matrix4().compose(at, q, V(1, 1, 0.8)))
  }
  for (const [x, a, h] of [
    [-0.08, 0.35, 0.3],
    [0.04, -0.1, 0.38],
    [0.14, -0.55, 0.28],
  ])
    k.add(tuft(0.1, h, -0.5), FUR_DEEP, T([x, H.c[1] + H.r[1] * 0.9, 0.12], [0.25, 0, a]))
  // horns
  for (const s of [-1, 1]) {
    k.add(horn(0.14, 0.44, s * 0.55, 16), HORN, T([s * 0.62, HY + 0.68, -0.12], [0, 0, -s * 0.5]))
    k.add(new THREE.TorusGeometry(0.125, 0.03, 6, 18), '#e7cfa8', T([s * 0.645, HY + 0.76, -0.12], [Math.PI / 2 + 0.1, s * 0.5, 0]), 0.012)
  }
  // spots, cheeks, a lighter muzzle round the mouth
  for (const [x, y, rx, ry] of [
    [-1.0, 0.36, 0.13, 0.1],
    [-0.82, 0.68, 0.08, 0.065],
    [1.02, 0.5, 0.12, 0.09],
    [0.38, 0.84, 0.09, 0.07],
    [1.08, 0.06, 0.07, 0.06],
    [-1.12, -0.1, 0.08, 0.06],
  ])
    paint(k, hf, oval(x, HY + y, rx, ry, 0.3, 18), '#b44ad6', 0.006, false)
  paint(k, hf, oval(0, MAMA.mouthY - 0.12, MAMA.mouthW + 0.2, MAMA.mouthH * 0.95, 0, 28), '#ff76ba', 0.005, false)
  for (const s of [-1, 1]) paint(k, hf, oval(s * 0.82, MAMA.mouthY + 0.06, 0.17, 0.1, 0, 18), '#ffb0d6', 0.008, false)
  // the nose
  const ny = MAMA.mouthY + 0.17
  k.add(sphere(14, 10), FUR_DEEP, T([0, ny, surfaceZ(H, 0, ny) - 0.02], [0, 0, 0], [0.085, 0.06, 0.06]), 0.016)
  k.add(sphere(6, 4), SPARK, T([-0.03, ny + 0.025, surfaceZ(H, 0, ny) + 0.035], [0, 0, 0], [0.018, 0.011, 0.006]), 0, true)
  // the upper fangs, which show even with the mouth shut
  const top = (x: number) => MAMA.mouthY - 0.09 * (1 - (x / MAMA.mouthW) ** 2)
  for (const s of [-1, 1]) {
    const x = s * 0.27
    const pts: P2[] = [
      [x - 0.055, top(x - 0.055) + 0.01],
      [x + s * 0.01, top(x) - 0.13],
      [x + 0.055, top(x + 0.055) + 0.01],
    ]
    k.decal(H, pts, '#ffffff', 0.03, 0.012, [x, top(x) - 0.04], false)
  }
  head.add(k.mesh('head', mat))

  // the mouth: dark inside with blunt teeth along the top and a tongue at the bottom; pivots on the top lip
  const m = new VKit(INK)
  const MW = MAMA.mouthW
  const MH = MAMA.mouthH
  const bot = (x: number) => top(x) - MH * Math.max(0, 1 - (x / MW) ** 2) ** 0.6
  const xs = Array.from({ length: 31 }, (_, i) => -MW + (2 * MW * i) / 30)
  const out: P2[] = [...xs.map((x): P2 => [x, top(x)]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, bot(x)])]
  m.decal(H, out, MOUTH, 0.01, 0.028, [0, top(0) - MH * 0.5])
  m.decal(H, oval(0, top(0) - MH * 0.32, MW * 0.42, MH * 0.2, 0, 18), '#22040f', 0.013, 0)
  m.decal(H, oval(0, top(0) - MH * 0.78, MW * 0.55, MH * 0.22, 0, 20), TONGUE, 0.016, 0)
  for (const t of [-0.56, -0.18, 0.18, 0.56]) {
    const x = t * MW
    const w = 0.065
    const y0 = top(x)
    m.decal(H, [[x - w, y0 + 0.01], [x + w, y0 + 0.01], [x + w * 0.85, y0 - 0.075], [x, y0 - 0.095], [x - w * 0.85, y0 - 0.075]], '#ffffff', 0.019, 0.01, [x, y0 - 0.04], false)
  }
  const mouthMesh = m.mesh('mouth', mat)
  // the shut mouth as a morph target: every point pulled up towards the top lip above it, still on the head
  {
    const g = mouthMesh.geometry
    const pos = g.getAttribute('position')
    const shut = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const t = top(Math.max(-MW, Math.min(MW, x)))
      const y2 = t + (y - t) * 0.1
      shut.set([x, y2, pos.getZ(i) - surfaceZ(H, x, y) + surfaceZ(H, x, y2)], i * 3)
    }
    g.morphAttributes.position = [new THREE.BufferAttribute(shut, 3)]
    mouthMesh.updateMorphTargets()
    mouthMesh.morphTargetInfluences![0] = 0.9
  }
  const zTop = surfaceZ(H, 0, top(0))
  const mouthG = pivot(mouthMesh, 0, top(0), zTop)
  head.add(mouthG)

  // the lower fangs, built where they sit with the mouth wide open
  const j = new VKit(INK)
  for (const s of [-1, 1]) {
    const x = s * 0.2
    const y0 = bot(x)
    j.decal(H, [[x - 0.045, y0 - 0.01], [x + 0.045, y0 - 0.01], [x, y0 + 0.1]], '#ffffff', 0.04, 0.01, [x, y0 + 0.03], false)
  }
  const jaw = new THREE.Group()
  jaw.name = 'jaw'
  jaw.add(j.mesh('jaw', mat))
  head.add(jaw)

  // the tongue that licks her lips, and a drop of drool
  const tk = new VKit(INK, 0.016)
  tk.add(sphere(20, 14), TONGUE, T([0, 0, 0], [0, 0, 0], [0.2, 0.085, 0.14]))
  tk.decal({ c: [0, 0, 0], r: [0.2, 0.085, 0.14] }, oval(0, 0.04, 0.012, 0.06, Math.PI / 2, 10), '#d93a64', 0.004, 0)
  const tongue = new THREE.Group()
  tongue.name = 'tongue'
  tongue.add(tk.mesh('tongue', mat))
  const ty = top(0) - MH * 0.5
  tongue.position.set(0, ty, surfaceZ(H, 0, ty) + 0.04)
  tongue.userData.rest = tongue.position.clone()
  tongue.visible = false
  head.add(tongue)
  const dk = new VKit(INK, 0.012)
  dk.add(sphere(12, 8), '#c8f4ff', T([0, -0.06, 0], [0, 0, 0], [0.045, 0.055, 0.045]))
  dk.add(new THREE.ConeGeometry(0.04, 0.08, 10), '#c8f4ff', T([0, 0, 0]))
  dk.add(sphere(6, 4), SPARK, T([-0.015, -0.05, 0.04], [0, 0, 0], 0.012), 0, true)
  const drool = new THREE.Group()
  drool.name = 'drool'
  drool.add(dk.mesh('drool', mat))
  const dx = MW * 0.78
  drool.position.set(dx, top(dx) - 0.04, surfaceZ(H, dx, top(dx) - 0.04) + 0.02)
  drool.userData.rest = drool.position.clone()
  drool.visible = false
  head.add(drool)

  // the eyes: big balls with a green iris that turns, lids above and below
  const eyes: MamaEye[] = []
  const brows: THREE.Group[] = []
  const R = MAMA.eyeR
  for (const s of [-1, 1]) {
    const ex = s * MAMA.eyeX
    const ey = MAMA.eyeY
    const ez = surfaceZ(H, ex, ey) - R * 0.32
    const eye = new THREE.Group()
    eye.position.set(ex, ey, ez)
    const b = new VKit(INK, 0.022)
    b.add(new THREE.SphereGeometry(R, 28, 20), '#ffffff')
    eye.add(b.mesh('eyeball', mat))
    const ik = new VKit(INK)
    ik.add(new THREE.SphereGeometry(R * 0.6, 22, 14), '#2fdc7c', T([0, 0, R - R * 0.6 * 0.3 + 0.004], [0, 0, 0], [1, 1, 0.3]), 0)
    ik.add(new THREE.SphereGeometry(R * 0.6 * 0.72, 18, 10), '#1fae5c', T([0, 0, R - R * 0.6 * 0.3 + 0.012], [0, 0, 0], [1, 1, 0.3]), 0)
    ik.add(new THREE.SphereGeometry(R * 0.34, 18, 10), PUPIL, T([0, 0, R + 0.002], [0, 0, 0], [1, 1, 0.3]), 0, true)
    ik.add(new THREE.SphereGeometry(R * 0.12, 10, 6), SPARK, T([-R * 0.2, R * 0.22, R + 0.016], [0, 0, 0], [1, 1, 0.3]), 0, true)
    ik.add(new THREE.SphereGeometry(R * 0.055, 8, 5), SPARK, T([R * 0.18, -R * 0.2, R + 0.016], [0, 0, 0], [1, 1, 0.3]), 0, true)
    const iris = new THREE.Group()
    iris.add(ik.mesh('iris', mat))
    eye.add(iris)
    // lids: domes a little bigger than the ball; lashes on the upper one, at the outer corner
    const lk = new VKit(INK, 0.016)
    lk.add(new THREE.SphereGeometry(R * 1.16, 26, 9, 0, Math.PI * 2, 0, Math.PI / 2), MAMA_FUR)
    for (const [phi, len] of [
      [0.62, 0.15],
      [0.76, 0.18],
      [0.9, 0.15],
    ]) {
      const a = s < 0 ? Math.PI * phi : Math.PI * (1 - phi)
      const base = V(Math.cos(a) * R * 1.14, 0, Math.sin(a) * R * 1.14)
      const dir = V(Math.cos(a), -0.15, Math.sin(a) * 0.9).normalize()
      lk.add(horn(0.022, len, 0.05, 6), INK, new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir), V(1, 1, 1)), 0)
    }
    const lid = new THREE.Group()
    lid.add(lk.mesh('lid', mat))
    lid.rotation.x = -1.15
    eye.add(lid)
    const wk = new VKit(INK, 0.014)
    wk.add(new THREE.SphereGeometry(R * 1.13, 26, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), MAMA_FUR)
    const low = new THREE.Group()
    low.add(wk.mesh('lowlid', mat))
    low.rotation.x = 1.2
    eye.add(low)
    head.add(eye)
    eyes.push({ root: eye, iris, lid, low })
    const brk = new VKit(INK, 0.016)
    brk.add(capsule(0.055, 0.2), FUR_DEEP, T([0, 0, 0], [0, 0, Math.PI / 2 - s * 0.18]))
    const brow = new THREE.Group()
    brow.add(brk.mesh('brow', mat))
    brow.position.set(ex + s * 0.03, ey + 0.36, surfaceZ(H, ex, ey + 0.36) + 0.01)
    brow.userData.rest = brow.position.clone()
    head.add(brow)
    brows.push(brow)
  }

  // the arms and hands
  const arms: MamaRig['arms'] = []
  const hands: THREE.Group[] = []
  const limb = (r0: number, r1: number, name: string) => {
    const ak = new VKit(INK, 0.022)
    const ag = new THREE.CylinderGeometry(r1, r0, 1, 16, 3, true)
    ag.translate(0, 0.5, 0)
    ak.add(ag, MAMA_FUR)
    const a = ak.mesh(name, mat)
    root.add(a)
    return a
  }
  for (const s of [-1, 1]) {
    const upper = limb(0.24, 0.21, 'upperArm')
    const fore = limb(0.2, 0.165, 'foreArm')
    const ek = new VKit(INK, 0.022)
    ek.add(lumpy(5, 0.03, 3, 0.2), MAMA_FUR, T([0, 0, 0], [0, 0, 0], 0.215))
    const elbow = ek.mesh('elbow', mat)
    root.add(elbow)
    arms.push({ upper, fore, elbow })
    const h = mitt(s)
    root.add(h)
    hands.push(h)
  }

  // the party hat: striped, with a pom and a fluffy trim
  const hk = new VKit(INK, 0.018)
  const cone = new THREE.ConeGeometry(0.24, 0.44, 28, 6)
  const pink = C('#ff3fae')
  const yellow = C('#ffe03a')
  hk.add(
    triColors(cone, (c) => ((((Math.atan2(c.x, c.z) / (Math.PI * 2)) * 4 + c.y * 3 + 10) % 1) < 0.5 ? pink : yellow)),
    '#ffffff',
    T([0, 0.22, 0]),
  )
  hk.add(lumpy(3, 0.08, 2, 0.4), '#7ff3ff', T([0, 0.46, 0], [0, 0, 0], 0.085))
  hk.add(new THREE.TorusGeometry(0.235, 0.05, 8, 28), '#ffffff', T([0, 0.01, 0], [Math.PI / 2, 0, 0]))
  const hat = new THREE.Group()
  hat.name = 'hat'
  hat.add(hk.mesh('hat', mat))
  hat.position.set(0.08, H.c[1] + H.r[1] * 0.8, 0.14)
  hat.rotation.set(0.12, 0, -0.22)
  hat.userData.rest = { y: hat.position.y }
  hat.visible = false
  head.add(hat)

  return { root, head, eyes, brows, mouth: mouthG, mouthMesh, jaw, tongue, drool, hands, arms, hat }
}

/* ------------------------------------------------------------------ */
/*  Labels and cards                                                    */
/* ------------------------------------------------------------------ */

let plane: THREE.PlaneGeometry | null = null
export const planeGeo = () => (plane ??= new THREE.PlaneGeometry(1, 1))
const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'

/** a canvas texture; drawn again once the web font arrives if it had not loaded yet */
function canvasTexture(w: number, h: number, font: string, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (!document.fonts.check(font))
    document.fonts.load(font).then(
      () => {
        g.clearRect(0, 0, w, h)
        draw(g)
        t.needsUpdate = true
      },
      () => {},
    )
  return t
}

let wildTex: THREE.CanvasTexture | null = null
function wildTexture() {
  return (wildTex ??= canvasTexture(512, 166, `900 104px ${FONT}`, (g) => {
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
    g.fillStyle = 'rgba(255,255,255,0.35)'
    g.beginPath()
    g.roundRect(44, 30, 424, 34, 17)
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
  }))
}

/**
 * Value labels, most recently used last. Every bet makes its own set of donut amounts, so the cache keeps only the
 * last LABELS_KEPT: an evicted texture is disposed (if a mesh still shows it, three.js simply uploads it again).
 */
const labelCache = new Map<string, THREE.CanvasTexture>()
const LABELS_KEPT = 40
/** a value label: chunky white numbers with a dark edge and a coloured glow */
export function labelTexture(text: string, color: string) {
  const key = text + color
  let t = labelCache.get(key)
  if (t) {
    labelCache.delete(key)
    labelCache.set(key, t)
    return t
  }
  const size = text.length > 7 ? 92 : text.length > 5 ? 104 : 116
  t = canvasTexture(512, 160, `900 ${size}px ${FONT}`, (g) => {
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
  })
  labelCache.set(key, t)
  if (labelCache.size > LABELS_KEPT) {
    const [oldest, old] = labelCache.entries().next().value!
    labelCache.delete(oldest)
    old.dispose()
  }
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

const stampCache = new Map<number, THREE.CanvasTexture>()
/** the collect multiplier stamp, ×2 to ×10: a gold starburst seal with the number in red */
export function stampTexture(mult: number) {
  let t = stampCache.get(mult)
  if (t) return t
  t = canvasTexture(256, 256, `900 110px ${FONT}`, (g) => {
    g.save()
    g.translate(128, 128)
    g.rotate(-0.18)
    g.beginPath()
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16
      const r = i % 2 ? 100 : 120
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    for (let i = 0; i < 32; i++) {
      const a = (i * Math.PI) / 16
      const r = i % 2 ? 90 : 108
      g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    g.closePath()
    const grad = g.createLinearGradient(0, -110, 0, 110)
    grad.addColorStop(0, '#fff3a8')
    grad.addColorStop(0.5, '#ffc93d')
    grad.addColorStop(1, '#f08a12')
    g.fillStyle = grad
    g.fill()
    const text = `×${mult}`
    const size = text.length > 2 ? 84 : 104
    g.font = `900 ${size}px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    g.lineWidth = 16
    g.strokeStyle = '#ffffff'
    g.strokeText(text, 0, 6)
    g.fillStyle = '#e8173f'
    g.fillText(text, 0, 6)
    g.restore()
  })
  stampCache.set(mult, t)
  return t
}

/** the Feast Pick modifiers the scene can show on a hatched egg */
export type FeastKind = 'hungry' | 'rain' | 'crowd' | 'extra'
const FEAST: Record<FeastKind, { title: string; top: string; bottom: string; ring: string }> = {
  hungry: { title: 'HUNGRY', top: '#9dffc8', bottom: '#14a854', ring: '#2ee87f' },
  rain: { title: 'DONUT RAIN', top: '#ffb3e1', bottom: '#d6338f', ring: '#ff7ac8' },
  crowd: { title: 'WILD CROWD', top: '#ffe69a', bottom: '#e8870c', ring: '#ffc93d' },
  extra: { title: '+5 SPINS', top: '#a8e4ff', bottom: '#1f7fd6', ring: '#3db4ff' },
}

const feastCache = new Map<FeastKind, THREE.CanvasTexture>()
/** a Feast Pick card: a round badge with the modifier's picture and its name on a ribbon (512 × 640) */
export function feastTexture(kind: FeastKind) {
  let t = feastCache.get(kind)
  if (t) return t
  const d = FEAST[kind]
  t = canvasTexture(512, 640, `900 60px ${FONT}`, (g) => {
    const cx = 256
    const cy = 250
    g.beginPath()
    g.arc(cx, cy, 228, 0, Math.PI * 2)
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    g.arc(cx, cy, 214, 0, Math.PI * 2)
    g.fillStyle = d.ring
    g.fill()
    g.beginPath()
    g.arc(cx, cy, 190, 0, Math.PI * 2)
    const grad = g.createLinearGradient(0, cy - 190, 0, cy + 190)
    grad.addColorStop(0, d.top)
    grad.addColorStop(1, d.bottom)
    g.fillStyle = grad
    g.fill()
    // rays
    g.save()
    g.beginPath()
    g.arc(cx, cy, 190, 0, Math.PI * 2)
    g.clip()
    g.fillStyle = 'rgba(255,255,255,0.13)'
    for (let i = 0; i < 12; i++) {
      const a = (i * Math.PI) / 6
      g.beginPath()
      g.moveTo(cx, cy)
      g.arc(cx, cy, 200, a, a + Math.PI / 12)
      g.fill()
    }
    g.fillStyle = 'rgba(255,255,255,0.18)'
    g.beginPath()
    g.ellipse(cx, cy - 120, 150, 60, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
    g.lineJoin = 'round'
    g.lineCap = 'round'
    const donut = (x: number, y: number, r: number, icing: string, rot = 0) => {
      g.save()
      g.translate(x, y)
      g.rotate(rot)
      g.beginPath()
      g.arc(0, 0, r, 0, Math.PI * 2)
      g.fillStyle = '#e9a656'
      g.fill()
      g.lineWidth = r * 0.16
      g.strokeStyle = INK
      g.stroke()
      g.beginPath()
      for (let i = 0; i <= 24; i++) {
        const a = Math.PI + (i / 24) * Math.PI
        const rr = r * (0.86 + 0.08 * Math.sin(i * 1.9))
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr * 1.0 + r * 0.12)
      }
      g.arc(0, 0, r * 0.86, 0, Math.PI, false)
      g.closePath()
      g.fillStyle = icing
      g.beginPath()
      g.arc(0, 0, r * 0.84, 0, Math.PI * 2)
      g.fill()
      g.beginPath()
      g.arc(0, 0, r * 0.32, 0, Math.PI * 2)
      g.fillStyle = INK
      g.fill()
      const sp = ['#ffffff', '#ffe14d', '#3dd9ff', '#2ee87f']
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.3
        const rr = r * 0.6
        g.save()
        g.translate(Math.cos(a) * rr, Math.sin(a) * rr)
        g.rotate(a * 2)
        g.fillStyle = sp[i % sp.length]
        g.fillRect(-r * 0.12, -r * 0.04, r * 0.24, r * 0.08)
        g.restore()
      }
      g.restore()
    }
    const text = (s: string, x: number, y: number, size: number, fill = '#ffffff') => {
      g.font = `900 ${size}px ${FONT}`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.lineWidth = size * 0.24
      g.strokeStyle = INK
      g.strokeText(s, x, y)
      g.fillStyle = fill
      g.fillText(s, x, y)
    }
    const monster = (x: number, y: number, r: number, col: string) => {
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fillStyle = col
      g.fill()
      g.lineWidth = r * 0.14
      g.strokeStyle = INK
      g.stroke()
      for (const s of [-1, 1]) {
        g.beginPath()
        g.arc(x + s * r * 0.36, y - r * 0.2, r * 0.26, 0, Math.PI * 2)
        g.fillStyle = '#ffffff'
        g.fill()
        g.lineWidth = r * 0.07
        g.stroke()
        g.beginPath()
        g.arc(x + s * r * 0.36, y - r * 0.18, r * 0.13, 0, Math.PI * 2)
        g.fillStyle = INK
        g.fill()
      }
      g.beginPath()
      g.moveTo(x - r * 0.55, y + r * 0.18)
      g.quadraticCurveTo(x, y + r * 0.95, x + r * 0.55, y + r * 0.18)
      g.closePath()
      g.fillStyle = '#3a0b22'
      g.fill()
      g.lineWidth = r * 0.07
      g.stroke()
      g.fillStyle = '#ffffff'
      for (const s of [-1, 1]) {
        g.beginPath()
        g.moveTo(x + s * r * 0.36, y + r * 0.2)
        g.lineTo(x + s * r * 0.22, y + r * 0.2)
        g.lineTo(x + s * r * 0.29, y + r * 0.42)
        g.closePath()
        g.fill()
      }
    }
    if (kind === 'hungry') {
      monster(cx, cy + 30, 120, '#ff4fa3')
      text('2×', cx, cy - 112, 104, '#ffffff')
    } else if (kind === 'rain') {
      g.strokeStyle = 'rgba(255,255,255,0.55)'
      g.lineWidth = 10
      for (const [x, y] of [
        [150, 120],
        [300, 90],
        [380, 180],
        [190, 260],
        [330, 300],
      ]) {
        g.beginPath()
        g.moveTo(x + 18, y - 40)
        g.lineTo(x - 8, y + 20)
        g.stroke()
      }
      donut(170, 190, 62, '#59c8ff', -0.3)
      donut(340, 165, 54, '#b77bff', 0.4)
      donut(255, 330, 74, '#ff8ad0', 0.1)
    } else if (kind === 'crowd') {
      monster(150, 285, 72, '#2ee87f')
      monster(362, 285, 72, '#2ee87f')
      monster(256, 220, 92, '#2ee87f')
    } else {
      text('+5', cx, cy, 190, '#ffffff')
    }
    // the ribbon
    const ry = 556
    g.beginPath()
    g.moveTo(40, ry - 46)
    g.lineTo(472, ry - 46)
    g.lineTo(450, ry)
    g.lineTo(472, ry + 46)
    g.lineTo(40, ry + 46)
    g.lineTo(62, ry)
    g.closePath()
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    g.moveTo(52, ry - 36)
    g.lineTo(460, ry - 36)
    g.lineTo(440, ry)
    g.lineTo(460, ry + 36)
    g.lineTo(52, ry + 36)
    g.lineTo(72, ry)
    g.closePath()
    g.fillStyle = d.bottom
    g.fill()
    text(d.title, cx, ry + 3, d.title.length > 8 ? 52 : 60)
  })
  feastCache.set(kind, t)
  return t
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
  cupcake: buildCupcake,
  lolly: buildLolly,
  cookie: buildCookie,
  gummy: buildGummy,
  candy: buildCandy,
}

const protos = new Map<string, THREE.Group>()
function proto(key: string, make: () => THREE.Group) {
  let p = protos.get(key)
  if (!p) protos.set(key, (p = make()))
  return p
}

/** a fresh copy of a symbol, sharing geometry and materials with every other copy; for donuts, `value` picks the icing */
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
