import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { glowTexture } from '../../lib/three/fx'
import { T, VKit, centroid, conform, ellipsePts, fan, fatten, pivot, surfaceZ, toonRamp, vkMaterial, type Ell, type Geo, type P2, type P3 } from '../../lib/three/toon'
import type { Sym } from './rules'
import { LEVEL_COLOR, SYMBOL_COLOR } from './meta'

/*
  The Pop Party cast: twisted-balloon animals, foil balloons and a disco ball, modelled in code and toon shaded
  with an ink outline. Every part is a VKit mesh (colour per vertex, outline merged in), so a whole animal draws
  in three or four calls with one shared material. Bubbles pinch at their twists and carry a streak of shine
  where the key light catches the latex. Faces are decals bent onto the surface under them.
  Each model fits a 0.9 cell and faces +z; cells get light clones that share geometry and materials.
*/

export const INK = '#1d0f30'
const RAMP = [92, 165, 225, 255]

/* ------------------------------------------------------------------ */
/*  Materials                                                           */
/* ------------------------------------------------------------------ */

let cast: THREE.MeshToonMaterial | null = null
let stageCast: THREE.MeshToonMaterial | null = null
let disco: THREE.MeshToonMaterial | null = null
let stageDisco: THREE.MeshToonMaterial | null = null
let halo: THREE.SpriteMaterial | null = null
const uTime = { value: 0 }

/** the one material of the whole cast; `stage` is a copy for the host, arch and mirror ball, which stay unclipped */
export function castMaterial(stage = false) {
  if (stage) return (stageCast ??= vkMaterial(toonRamp(RAMP)))
  return (cast ??= vkMaterial(toonRamp(RAMP)))
}

/** cast shading plus facets that twinkle (and bloom) in turn; `userData.uTime` is the shared time uniform */
function makeDisco() {
  const m = vkMaterial(toonRamp(RAMP))
  const vk = m.onBeforeCompile
  m.userData.uTime = uTime
  m.onBeforeCompile = (s, r) => {
    vk.call(m, s, r)
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFace;\nvarying float vFace;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFace = aFace;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying float vFace;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0) * pow(max(0.0, sin(uTime * 3.0 + vFace * 40.0)), 24.0) * 1.4;')
  }
  m.customProgramCacheKey = () => 'vk-disco'
  return m
}

/** the disco ball facets; `stage` is the unclipped copy for the mirror ball (both share `userData.uTime`) */
export function discoMaterial(stage = false) {
  if (stage) return (stageDisco ??= makeDisco())
  return (disco ??= makeDisco())
}

function haloMaterial() {
  return (halo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: C('#ffd1ff', 0.7), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
}

/** every material the grid pieces use, so the scene can clip them to the window (the stage copies are left out) */
export function allMaterials(): THREE.Material[] {
  return [cast, disco, halo].filter((m): m is NonNullable<typeof m> => m !== null)
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
const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
const SHINE = C('#ffffff', 1.6)
const SPARK = C('#ffffff', 1.2)
const PUPIL = '#170a26'
const MOUTH = '#3a0b22'
const TONGUE = '#ff5f86'
/** the way a surface faces where its shine sits: up and to the left, towards the key light */
const GLINT = V(-0.55, 0.55, 0.63).normalize()
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** thin parts get fewer segments: they only ever cover a few pixels */
function capsule(r: number, len: number) {
  return r >= 0.07 ? new THREE.CapsuleGeometry(r, len, 3, 12) : r >= 0.06 ? new THREE.CapsuleGeometry(r, len, 2, 10) : new THREE.CapsuleGeometry(r, len, 2, 8)
}

const sphere = (w = 18, h = 12) => new THREE.SphereGeometry(1, w, h)

/** a matrix that stands a +y shape on the segment a-b, centred on it */
function aim(a: THREE.Vector3, b: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1))
}

/** smooth normals across shared corners (keeping any colours), so the hull of a faceted shape stays closed */
function smooth(g: Geo) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k)
  const m = mergeVertices(g)
  m.computeVertexNormals()
  return m
}

/**
 * One twisted-balloon bubble from a to b: a capsule whose round ends meet the neighbours at the joints, so they
 * pinch together; a twist knot at each tied joint (`tie`), and a streak of shine on the upper-left front.
 */
function sausage(k: VKit, a: P3, b: P3, r: number, color: string, tie: '' | 'a' | 'b' | 'ab' = 'ab', shine = true) {
  const A = V(...a)
  const B = V(...b)
  const d = B.clone().sub(A)
  const len = Math.max(0, d.length() - 2 * r)
  k.add(capsule(r, len), color, aim(A, B))
  const knot = C(color, 0.85)
  if (tie.includes('a')) k.add(new THREE.SphereGeometry(r * 0.55, 5, 3), knot, T(a), 0)
  if (tie.includes('b')) k.add(new THREE.SphereGeometry(r * 0.55, 5, 3), knot, T(b), 0)
  if (!shine) return
  // a tapered streak towards the lit end, and a dot past it on the longer bubbles
  d.normalize()
  const n = GLINT.clone().addScaledVector(d, -GLINT.dot(d)).normalize()
  const side = V().crossVectors(d, n)
  const lit = Math.sign(GLINT.dot(d)) || 1
  const L = Math.max(len, r * 0.5)
  const at = (u: number, s: P3) => new THREE.Matrix4().makeBasis(side, d, n).scale(V(...s)).setPosition(A.clone().add(B).multiplyScalar(0.5).addScaledVector(d, u * lit).addScaledVector(n, r * 0.98))
  k.add(new THREE.SphereGeometry(1, 6, 4), SHINE, at(L * 0.08, [r * 0.17, L * 0.36, r * 0.05]), 0, true)
  if (len > r * 2 && r >= 0.05) k.add(new THREE.SphereGeometry(1, 5, 3), SHINE, at(-L * 0.4, [r * 0.12, r * 0.12, r * 0.04]), 0, true)
}

/** a fluffy pom-pom: a softly lumpy ball, lighter on the tufts and darker between them */
function pom(k: VKit, c: P3, r: number, color: string, seed = 0) {
  const g = new THREE.IcosahedronGeometry(1, 1)
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  const v = V()
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize()
    const lump = Math.sin(v.x * 5.3 + seed) * Math.sin(v.y * 5.9 + seed * 1.7) * Math.sin(v.z * 6.7 + seed * 2.3)
    v.multiplyScalar(r * (1 + 0.07 * lump))
    p.setXYZ(i, v.x, v.y, v.z)
    col.fill(1 + 0.6 * lump, i * 3, i * 3 + 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  k.add(smooth(g), color, T(c))
}

/** the front of a capsule (points within r of the segment a-b) as a surface */
function capSurf(a: P3, b: P3, r: number): Surf {
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
    // the distance to the segment is convex along z: find its nearest point, then the front crossing above it
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

const ellSurf = (e: Ell): Surf => (x, y) => surfaceZ(e, x, y)

/** lifts a flat decal onto any surface, `lift` above it, facing outwards */
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

/** enough rings for the decal to follow the curve under it, and no more */
const ringsFor = (pts: P2[], c: P2) => Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.02)))

/** a filled shape painted onto a surface (no rim); `rings` = 1 suits an edge that something covers in the middle */
function paint(k: VKit, f: Surf, pts: P2[], color: THREE.ColorRepresentation, lift: number, flat = false, center?: P2, rings?: number) {
  const c = center ?? centroid(pts)
  k.add(onto(fan(pts, c, rings ?? ringsFor(pts, c)), f, lift), color, undefined, 0, flat)
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

/** a pen stroke in ink painted onto a surface */
function stroke(k: VKit, f: Surf, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK) {
  k.add(onto(strip(path, w), f, lift), color, undefined, 0, true)
}

const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 16): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])

/** a VKit mesh in a group that turns and scales about p, with its rest pose for the scene */
function part(k: VKit, name: string, p: P3, mat: THREE.Material = castMaterial()) {
  const g = pivot(k.mesh(name, mat), ...p)
  g.userData.rest = { x: p[0], y: p[1], z: p[2], rx: 0, ry: 0, rz: 0 }
  return g
}

/* ---------------- faces ---------------- */

interface Eye {
  x: number
  y: number
  rx: number
  ry: number
  /** which side the lashes sweep to (-1 left, 1 right); none when unset */
  lash?: number
  /** number of lashes */
  lashes?: number
}

/** toy eyes for the animals: glossy white domes set into the head, big pupils with two glints, and lashes */
function domeEyes(f: Surf, list: Eye[], look: P2 = [0.08, 0.04]) {
  const k = new VKit()
  let cz = 0
  for (const e of list) {
    const rz = Math.min(e.rx, e.ry) * 0.62
    const z = f(e.x, e.y) - rz * 0.38
    cz += z / list.length
    // only the front half: the back is inside the head
    k.add(new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), '#ffffff', T([e.x, e.y, z], [Math.PI / 2, 0, 0], [e.rx, rz, e.ry]), 0.009)
    const ball: Ell = { c: [e.x, e.y, z], r: [e.rx, e.ry, rz] }
    const px = e.x + look[0] * e.rx
    const py = e.y + look[1] * e.ry - e.ry * 0.06
    k.decal(ball, ellipsePts(px, py, e.rx * 0.58, e.ry * 0.62, 18), PUPIL, 0.003, 0)
    k.decal(ball, ellipsePts(px - e.rx * 0.2, py + e.ry * 0.24, e.rx * 0.21, e.ry * 0.19, 10), SPARK, 0.006, 0)
    k.decal(ball, ellipsePts(px + e.rx * 0.22, py - e.ry * 0.26, e.rx * 0.09, e.ry * 0.08, 8), SPARK, 0.006, 0)
    if (e.lash) {
      const n = e.lashes ?? 2
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 - e.lash * (0.5 + (0.75 * i) / Math.max(1, n - 1))
        const bx = e.x + Math.cos(a) * e.rx * 0.98
        const by = e.y + Math.sin(a) * e.ry * 0.98
        const len = Math.max(e.rx, e.ry) * (0.62 - 0.08 * i)
        const ox = Math.cos(a) * len
        const oy = Math.sin(a) * len
        stroke(k, f, [[bx, by], [bx + ox * 0.55 + e.lash * len * 0.12, by + oy * 0.55], [bx + ox + e.lash * len * 0.3, by + oy * 0.9]], e.rx * 0.2, 0.004)
      }
    }
  }
  const cx = list.reduce((a, e) => a + e.x, 0) / list.length
  const cy = list.reduce((a, e) => a + e.y, 0) / list.length
  return part(k, 'eyes', [cx, cy, cz])
}

/** marker-drawn eyes for the balloons: dark dots with a glint */
function dotEyes(f: Surf, list: Eye[], lift = 0.004) {
  const k = new VKit()
  let cz = 0
  for (const e of list) {
    cz += f(e.x, e.y) / list.length
    paint(k, f, ellipsePts(e.x, e.y, e.rx, e.ry, 16), PUPIL, lift, true)
    paint(k, f, ellipsePts(e.x - e.rx * 0.28, e.y + e.ry * 0.3, e.rx * 0.34, e.ry * 0.3, 10), SPARK, lift + 0.002, true)
    paint(k, f, ellipsePts(e.x + e.rx * 0.3, e.y - e.ry * 0.32, e.rx * 0.14, e.ry * 0.12, 8), SPARK, lift + 0.002, true)
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
function smile(k: VKit, f: Surf, m: MouthAt, lift: number, thick = 0.012) {
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
  paint(k, f, fatten(out, 0.008, mid), INK, lift - 0.001, true, mid, 1)
  paint(k, f, out, MOUTH, lift, true, mid)
  paint(k, f, oval(m.x, m.y - m.h * 0.72, m.w * 0.5, m.h * 0.3, 0, 14), TONGUE, lift + 0.002, true)
}

/** the win face: happy ^ ^ eyes and an open mouth over the smile (on `mf` when it sits elsewhere); hidden until a win */
function joyFace(f: Surf, eyes: Eye[], m: MouthAt, lift: number, mf = f) {
  const k = new VKit()
  for (const e of eyes) stroke(k, f, arc(e.x, e.y - e.ry * 0.35, e.rx * 0.95, e.ry * 0.85, Math.PI * 0.92, Math.PI * 0.08, 12), Math.max(0.014, e.rx * 0.32), lift)
  openMouth(k, mf, m, lift + 0.004)
  const mesh = k.mesh('joy', castMaterial())
  mesh.visible = false
  return mesh
}

/** cheeks */
function blush(k: VKit, f: Surf, pts: P2[], rx: number, ry: number, color = '#ff9ccf', lift = 0.003) {
  for (const [x, y] of pts) paint(k, f, oval(x, y, rx, ry, 0, 14), color, lift)
}

/** a curly ribbon hanging from (x, y, z): a tube along a loosening three-turn helix */
function ribbon(k: VKit, x: number, y: number, z: number, drop = 0.18) {
  const pts = Array.from({ length: 49 }, (_, i) => {
    const t = i / 48
    const a = t * Math.PI * 6
    const r = 0.018 + 0.014 * t
    return V(x + Math.sin(a) * r, y - t * drop, z + (Math.cos(a) - 1) * r * 0.6)
  })
  k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 36, 0.01, 5, false), '#f4eefc', undefined, 0)
}

/* ------------------------------------------------------------------ */
/*  The cast                                                            */
/* ------------------------------------------------------------------ */

/** Fifi: a hot pink balloon poodle seen three-quarters on, pom-poms everywhere and a lime bow */
function buildPoodle() {
  const col = SYMBOL_COLOR.poodle
  const fluff = '#ff9fdc'
  const turn = new THREE.Matrix4().makeRotationY(-0.45)
  const q = (x: number, y: number, z = 0) => V(x, y, z).applyMatrix4(turn).toArray() as P3
  const k = new VKit()
  const back = q(-0.17, -0.06)
  const front = q(0.12, -0.06)
  sausage(k, back, front, 0.075, col)
  for (const s of [-1, 1]) {
    for (const [top, x] of [
      [front, 0.14],
      [back, -0.19],
    ] as const) {
      const foot = q(x, -0.31, s * 0.05)
      sausage(k, top, foot, 0.048, col, '')
      pom(k, foot, 0.045, fluff, x * 9 + s)
    }
  }
  const hc = q(0.15, 0.2)
  const head: Ell = { c: hc, r: [0.11, 0.1, 0.1] }
  const hf = ellSurf(head)
  sausage(k, front, q(0.155, 0.13), 0.055, col, '')
  k.add(sphere(14, 10), col, T(hc, [0, 0, 0], head.r))
  const nose = q(0.31, 0.16)
  sausage(k, q(0.2, 0.17), nose, 0.05, col, '')
  k.add(new THREE.SphereGeometry(0.03, 8, 6), '#2a1630', T(nose), 0)
  k.add(new THREE.SphereGeometry(0.008, 5, 3), SPARK, T([nose[0] - 0.012, nose[1] + 0.014, nose[2] + 0.024]), 0, true)
  const top: P3 = [hc[0] - 0.01, hc[1] + 0.1, hc[2] - 0.01]
  pom(k, top, 0.062, fluff, 3)
  for (const s of [-1, 1]) pom(k, [hc[0] + s * 0.105, hc[1] - 0.04, hc[2] - 0.02], 0.06, fluff, 5 + s)
  // the bow, tied on the front of the topknot
  const wing = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.056, 0.032), new THREE.Vector2(0.05, -0.034)])
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(wing, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 1 })
    k.add(smooth(g), '#b6ff3b', T([top[0] + 0.02, top[1] + 0.035, top[2] + 0.045], [0, 0, -0.35], [s, 1, 1]), 0.012)
  }
  k.add(new THREE.SphereGeometry(0.016, 8, 6), '#8ee01f', T([top[0] + 0.02, top[1] + 0.035, top[2] + 0.056]), 0.01)
  blush(k, hf, [
    [hc[0] - 0.062, hc[1] - 0.035],
    [hc[0] + 0.06, hc[1] - 0.04],
  ], 0.022, 0.014)
  paint(k, hf, oval(hc[0] - 0.048, hc[1] + 0.058, 0.026, 0.011, 0.55), SHINE, 0.003, true)
  const mouth: MouthAt = { x: hc[0] - 0.005, y: hc[1] - 0.048, w: 0.026, h: 0.018 }
  smile(k, hf, mouth, 0.004)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  const eyes: Eye[] = [
    { x: hc[0] - 0.034, y: hc[1] + 0.012, rx: 0.033, ry: 0.04, lash: -1 },
    { x: hc[0] + 0.04, y: hc[1] + 0.016, rx: 0.033, ry: 0.04, lash: 1 },
  ]
  root.add(domeEyes(hf, eyes))
  root.add(joyFace(hf, eyes, { ...mouth, w: 0.03, h: 0.034 }, 0.006))
  const t = new VKit()
  const tip = q(-0.25, 0.1)
  sausage(t, back, tip, 0.038, col, '')
  pom(t, tip, 0.058, fluff, 11)
  root.add(part(t, 'wag', q(-0.17, -0.04)))
  return root
}

/** Stretch: a sunshine giraffe with orange spots and a long neck that sways on its own */
function buildGiraffe() {
  const col = SYMBOL_COLOR.giraffe
  const spot = '#ff8a1c'
  const hoof = '#c66a14'
  const k = new VKit()
  const back: P3 = [-0.15, -0.1, 0]
  const front: P3 = [0.1, -0.1, 0]
  sausage(k, back, front, 0.07, col)
  for (const s of [-1, 1])
    for (const [top, x] of [
      [front, 0.115],
      [back, -0.165],
    ] as const) {
      sausage(k, top, [x, -0.3, s * 0.045], 0.042, col, '')
      k.add(new THREE.CylinderGeometry(0.04, 0.046, 0.042, 10), hoof, T([x, -0.311, s * 0.045]))
    }
  sausage(k, [-0.15, -0.095, -0.01], [-0.235, -0.2, -0.01], 0.014, col, '')
  k.add(sphere(8, 6), hoof, T([-0.245, -0.218, -0.01], [0, 0, 0.6], [0.022, 0.034, 0.022]))
  const torso = capSurf(back, front, 0.07)
  for (const [x, y, r, sd] of [
    [-0.095, -0.07, 0.026, 1],
    [-0.02, -0.125, 0.024, 2],
    [0.05, -0.068, 0.022, 3],
    [-0.13, -0.135, 0.018, 4],
  ])
    paint(k, torso, blob(x, y, r, sd), spot, 0.003)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))

  const n = new VKit()
  const mid: P3 = [0.13, 0.12, 0]
  sausage(n, front, mid, 0.045, col, 'b')
  sausage(n, mid, [0.15, 0.27, 0], 0.045, col, '')
  // the head: a round crown for the eyes and a long muzzle sticking out to the right
  const crown: Ell = { c: [0.13, 0.315, 0], r: [0.082, 0.076, 0.07] }
  const hf = ellSurf(crown)
  n.add(sphere(14, 10), col, T(crown.c, [0, 0, 0], crown.r))
  const ma: P3 = [0.17, 0.296, 0.005]
  const mb: P3 = [0.3, 0.284, 0.01]
  sausage(n, ma, mb, 0.054, col, '', false)
  for (const [x, z, lean] of [
    [0.105, -0.02, 0.2],
    [0.145, 0.02, -0.1],
  ]) {
    const base: P3 = [x, 0.37, z]
    const tip: P3 = [x - lean * 0.3, 0.435, z]
    n.add(new THREE.CylinderGeometry(0.012, 0.014, 0.07, 8), col, aim(V(...base), V(...tip)))
    n.add(new THREE.SphereGeometry(0.022, 10, 8), '#b25a12', T(tip))
  }
  for (const s of [-1, 1]) {
    const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), V(-0.75, 0.42, s * 0.5).normalize())
    n.add(sphere(10, 8), C(col, 0.92), new THREE.Matrix4().compose(V(0.04, 0.36, s * 0.05), q, V(0.04, 0.015, 0.022)))
  }
  const neck1 = capSurf(front, mid, 0.045)
  const neck2 = capSurf(mid, [0.15, 0.27, 0], 0.045)
  const muzzle = capSurf(ma, mb, 0.054)
  paint(n, neck1, blob(0.115, 0.02, 0.02, 5), spot, 0.003)
  paint(n, neck2, blob(0.142, 0.19, 0.018, 6), spot, 0.003)
  paint(n, hf, blob(0.075, 0.29, 0.016, 7), spot, 0.003)
  paint(n, muzzle, oval(0.27, 0.288, 0.04, 0.042), '#ffe9a6', 0.002)
  paint(n, hf, oval(0.1, 0.37, 0.024, 0.008, 0.35), SHINE, 0.003, true)
  for (const [x, y] of [
    [0.282, 0.304],
    [0.304, 0.296],
  ])
    paint(n, muzzle, ellipsePts(x, y, 0.007, 0.006, 8), INK, 0.004, true)
  const mouth: MouthAt = { x: 0.262, y: 0.262, w: 0.032, h: 0.014 }
  smile(n, muzzle, mouth, 0.004, 0.011)
  const neck = part(n, 'neck', [0.1, -0.06, 0])
  const eyes: Eye[] = [
    { x: 0.1, y: 0.33, rx: 0.032, ry: 0.04, lash: -1, lashes: 3 },
    { x: 0.162, y: 0.334, rx: 0.032, ry: 0.04, lash: 1, lashes: 3 },
  ]
  const inner = neck.children[0]
  inner.add(domeEyes(hf, eyes))
  inner.add(joyFace(hf, eyes, { ...mouth, w: 0.034, h: 0.034 }, 0.006, muzzle))
  root.add(neck)
  return root
}

/** an irregular giraffe spot */
function blob(x: number, y: number, r: number, seed: number): P2[] {
  return Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2 + seed
    const rr = r * (0.75 + 0.5 * hash(seed, i))
    return [x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9]
  })
}

/** Hopper: a sky-blue bunny with buck teeth and one ear that flops */
function buildBunny() {
  const col = SYMBOL_COLOR.bunny
  const k = new VKit()
  const head: Ell = { c: [0, 0.06, 0], r: [0.148, 0.14, 0.135] }
  const hf = ellSurf(head)
  k.add(sphere(16, 12), col, T(head.c, [0, 0, 0], head.r))
  ear(k, [-0.05, 0.18, -0.01], [-0.09, 0.42, -0.02])
  const body: Ell = { c: [0, -0.165, -0.01], r: [0.128, 0.115, 0.105] }
  k.add(sphere(14, 10), col, T(body.c, [0, 0, 0], body.r))
  for (const s of [-1, 1]) {
    sausage(k, [s * 0.075, -0.255, 0.0], [s * 0.092, -0.29, 0.115], 0.045, col, '')
    sausage(k, [s * 0.09, -0.1, 0.045], [s * 0.052, -0.18, 0.1], 0.032, col, '')
  }
  pom(k, [0.122, -0.215, -0.07], 0.052, '#ffffff', 2)
  paint(k, ellSurf(body), oval(-0.062, -0.1, 0.026, 0.011, 0.75), SHINE, 0.003, true)
  // face
  paint(k, hf, oval(-0.06, 0.13, 0.03, 0.013, 0.6), SHINE, 0.003, true)
  blush(k, hf, [
    [-0.085, 0.0],
    [0.085, 0.0],
  ], 0.028, 0.017)
  const nosePts: P2[] = [...arc(0, 0.032, 0.024, 0.012, Math.PI * 0.05, Math.PI * 0.95, 6), ...arc(0, 0.034, 0.016, 0.024, Math.PI * 1.15, Math.PI * 1.85, 6)]
  paint(k, hf, nosePts, INK, 0.003, true, [0, 0.03])
  paint(k, hf, nosePts.map(([x, y]): P2 => [x * 0.72, 0.03 + (y - 0.03) * 0.72]), '#ff6fa8', 0.005, false, [0, 0.03])
  const teeth: P2[] = [...arc(0, -0.022, 0.024, 0.012, Math.PI, Math.PI * 2, 8), [0.024, 0.0], [-0.024, 0.0]]
  paint(k, hf, teeth.map(([x, y]): P2 => [x * 1.35, -0.009 + (y + 0.009) * 1.35]), INK, 0.003, true, [0, -0.012])
  paint(k, hf, teeth, '#ffffff', 0.005, false, [0, -0.012])
  stroke(k, hf, [
    [0, 0.002],
    [0, -0.033],
  ], 0.005, 0.007)
  stroke(k, hf, arc(0, 0.012, 0.035, 0.012, Math.PI * 1.05, Math.PI * 1.95, 10), 0.007, 0.006)
  for (const s of [-1, 1])
    for (const [dy, tilt] of [
      [0.01, 0.12],
      [0.0, 0.0],
      [-0.01, -0.12],
    ])
      stroke(k, hf, [
        [s * 0.045, 0.012 + dy],
        [s * 0.085, 0.016 + dy + tilt * 0.12],
        [s * 0.122, 0.018 + dy + tilt * 0.3],
      ], 0.0055, 0.004)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  const r = new VKit()
  ear(r, [0.05, 0.18, -0.01], [0.09, 0.42, -0.02])
  root.add(part(r, 'earR', [0.05, 0.18, -0.01]))
  const eyes: Eye[] = [
    { x: -0.058, y: 0.1, rx: 0.042, ry: 0.049 },
    { x: 0.058, y: 0.1, rx: 0.042, ry: 0.049 },
  ]
  root.add(domeEyes(hf, eyes, [0.05, 0.02]))
  root.add(joyFace(hf, eyes, { x: 0, y: -0.04, w: 0.036, h: 0.04 }, 0.01))
  return root
}

/** a bunny ear: a bubble that narrows towards the tip, pink inside */
function ear(k: VKit, a: P3, b: P3) {
  const r = 0.045
  const A = V(...a)
  const B = V(...b)
  const len = A.distanceTo(B) - 2 * r
  const g = capsule(r, len)
  const p = g.getAttribute('position')
  const half = len / 2 + r
  for (let i = 0; i < p.count; i++) {
    const s = 1 - 0.2 * Math.max(0, p.getY(i) / half)
    p.setXYZ(i, p.getX(i) * s, p.getY(i), p.getZ(i) * s)
  }
  k.add(g, SYMBOL_COLOR.bunny, aim(A, B))
  const dir = B.clone().sub(A).normalize()
  const ang = Math.atan2(dir.y, dir.x) - Math.PI / 2
  const m = A.clone().lerp(B, 0.47)
  paint(k, capSurf(a, b, r * 0.9), oval(m.x, m.y, 0.021, 0.085, ang, 18), '#ffb3d9', 0.003)
}

/** the octopus' party hat, centred on the origin: striped cone, pom on top */
function hat(k: VKit, m: THREE.Matrix4) {
  const g = new THREE.ConeGeometry(0.07, 0.17, 14, 4).toNonIndexed()
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  const pink = C('#ff4fb8')
  const yellow = C('#ffcc29')
  for (let i = 0; i < p.count; i += 3) {
    const y = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3
    const c = Math.floor((y / 0.17 + 0.5) * 4 + 0.001) % 2 ? yellow : pink
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  k.add(smooth(g), '#ffffff', new THREE.Matrix4().multiplyMatrices(m, T([0, -0.02, 0])))
  const top = new THREE.Matrix4().multiplyMatrices(m, T([0, 0.075, 0]))
  pom(k, V().setFromMatrixPosition(top).toArray() as P3, 0.032, '#ffffff', 4)
}

const HAT_POS: P3 = [0.06, 0.355, 0.02]
const HAT_ROT: P3 = [0, 0, -0.38]

/** Squiggs: a violet octopus in a party hat, whistling, three tentacles a side */
function buildOcto() {
  const col = SYMBOL_COLOR.octo
  const k = new VKit()
  const head: Ell = { c: [0, 0.08, 0], r: [0.2, 0.2, 0.18] }
  const hf = ellSurf(head)
  k.add(sphere(18, 12), col, T(head.c, [0, 0, 0], head.r))
  hat(k, T(HAT_POS, HAT_ROT))
  paint(k, hf, oval(-0.1, 0.19, 0.045, 0.018, 0.6), SHINE, 0.003, true)
  for (const [x, y, r] of [
    [-0.12, 0.13, 0.016],
    [-0.05, 0.22, 0.012],
    [0.13, 0.16, 0.014],
  ])
    paint(k, hf, ellipsePts(x, y, r, r, 10), C(col, 0.82), 0.002)
  blush(k, hf, [
    [-0.125, 0.025],
    [0.125, 0.025],
  ], 0.032, 0.02)
  paint(k, hf, ellipsePts(0, -0.005, 0.034, 0.036, 16), INK, 0.003, true)
  paint(k, hf, ellipsePts(0, -0.005, 0.025, 0.027, 16), MOUTH, 0.005, true)
  paint(k, hf, ellipsePts(0, -0.013, 0.015, 0.013, 12), TONGUE, 0.007, true)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  for (const s of [-1, 1]) {
    const t = new VKit()
    const mirror = T([0, 0, 0], [0, 0, 0], [s, 1, 1])
    const legs: P3[][] = [
      [
        [0.03, -0.04, -0.07],
        [0.04, -0.2, -0.08],
        [0.06, -0.31, -0.08],
        [0.11, -0.355, -0.08],
        [0.145, -0.32, -0.08],
      ],
      [
        [0.09, -0.03, 0],
        [0.15, -0.15, 0],
        [0.21, -0.23, 0],
        [0.27, -0.235, 0],
        [0.29, -0.18, 0],
      ],
      [
        [0.05, -0.04, 0.07],
        [0.075, -0.18, 0.095],
        [0.1, -0.29, 0.1],
        [0.16, -0.335, 0.1],
        [0.2, -0.29, 0.09],
      ],
    ]
    legs.forEach((pts, i) => tentacle(t, pts, mirror, i === 2))
    root.add(part(t, s < 0 ? 'tentL' : 'tentR', [s * 0.06, -0.06, 0]))
  }
  const eyes: Eye[] = [
    { x: -0.074, y: 0.105, rx: 0.052, ry: 0.06 },
    { x: 0.074, y: 0.105, rx: 0.052, ry: 0.06 },
  ]
  root.add(domeEyes(hf, eyes, [0.04, 0.06]))
  root.add(joyFace(hf, eyes, { x: 0, y: 0.0, w: 0.045, h: 0.048 }, 0.01))
  return root
}

/** a tentacle: a tube that tapers from the root to a closed, curled tip; suckers on the front ones */
function tentacle(k: VKit, pts: P3[], m: THREE.Matrix4, suckers: boolean) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => V(...p)))
  const seg = 9
  const rad = 6
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false)
  const p = g.getAttribute('position')
  const c = V()
  const radius = (t: number) => 0.038 + (0.015 - 0.038) * t
  for (let i = 0; i <= seg; i++) {
    curve.getPointAt(i / seg, c)
    const r = i === seg ? 0.002 : radius(i / seg)
    for (let j = 0; j <= rad; j++) {
      const v = i * (rad + 1) + j
      p.setXYZ(v, c.x + (p.getX(v) - c.x) * r, c.y + (p.getY(v) - c.y) * r, c.z + (p.getZ(v) - c.z) * r)
    }
  }
  k.add(g, SYMBOL_COLOR.octo, m)
  if (!suckers) return
  const a = V()
  const b = V()
  for (const t of [0.42, 0.58, 0.73, 0.86]) {
    curve.getPointAt(t - 0.04, a).applyMatrix4(m)
    curve.getPointAt(t + 0.04, b).applyMatrix4(m)
    const r = radius(t)
    const mid = a.clone().lerp(b, 0.5)
    paint(k, capSurf(a.toArray() as P3, b.toArray() as P3, r), ellipsePts(mid.x, mid.y, r * 0.5, r * 0.5, 8), '#c9b2ff', 0.002)
  }
}

/** a five-point star with rounded points, as an outline */
function starOutline(outer: number, inner: number): P2[] {
  const corners = Array.from({ length: 10 }, (_, i): P2 => {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? inner : outer
    return [Math.cos(a) * r, Math.sin(a) * r]
  })
  const out: P2[] = []
  corners.forEach((v, i) => {
    const prev = corners[(i + 9) % 10]
    const next = corners[(i + 1) % 10]
    const f = i % 2 ? 0.14 : 0.32
    const n = i % 2 ? 3 : 6
    const p1: P2 = [v[0] + (prev[0] - v[0]) * f, v[1] + (prev[1] - v[1]) * f]
    const p2: P2 = [v[0] + (next[0] - v[0]) * f, v[1] + (next[1] - v[1]) * f]
    for (let j = 0; j < n; j++) {
      const t = j / (n - 1)
      const u = 1 - t
      out.push([u * u * p1[0] + 2 * u * t * v[0] + t * t * p2[0], u * u * p1[1] + 2 * u * t * v[1] + t * t * p2[1]])
    }
  })
  return out
}

/** a heart outline from the classic heart curve, `w` wide, resampled evenly */
function heartOutline(w: number, n: number, dy = 0): P2[] {
  const raw: P2[] = Array.from({ length: 240 }, (_, i) => {
    const t = (i / 240) * Math.PI * 2
    return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]
  })
  const s = w / 32
  return resample(raw, n).map(([x, y]): P2 => [x * s, y * s + dy])
}

/** n points spaced evenly along a closed outline */
function resample(pts: P2[], n: number): P2[] {
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

/**
 * A foil balloon: the outline inflated into a soft pillow, domed at the front, flatter at the back, coloured from
 * `rim` at the seam to `light` towards the upper left. Returns the solid and its front surface for decals.
 */
function pillow(outline: P2[], c: P2, front: number, back: number, rim: string, light: string) {
  const area = outline.reduce((a, p, i) => a + p[0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * p[1], 0)
  const pts = area < 0 ? [...outline].reverse() : outline
  const N = pts.length
  const R = 6
  const ring = (k: number) => Math.sin(((k / R) * Math.PI) / 2)
  const puff = (s: number) => Math.sqrt(Math.max(0, 1 - Math.min(1, s) ** 3))
  const pos: number[] = []
  const col: number[] = []
  const cRim = C(rim)
  const cLight = C(light)
  const size = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))
  const tint = new THREE.Color()
  const vert = (x: number, y: number, z: number, s: number, lit: boolean) => {
    pos.push(x, y, z)
    const ul = ((c[0] - x) * 0.6 + (y - c[1]) * 0.8) / size
    tint.copy(cRim).lerp(cLight, lit ? Math.max(0, Math.min(1, 0.55 * (1 - s) + 0.75 * ul)) : 0)
    col.push(tint.r, tint.g, tint.b)
  }
  // front centre, front rings, the seam, back rings, back centre
  vert(c[0], c[1], front, 0, true)
  for (let k = 1; k < R; k++) for (const p of pts) vert(c[0] + (p[0] - c[0]) * ring(k), c[1] + (p[1] - c[1]) * ring(k), front * puff(ring(k)), ring(k), true)
  for (const p of pts) vert(p[0], p[1], 0, 1, true)
  for (let k = R - 1; k >= 1; k--) for (const p of pts) vert(c[0] + (p[0] - c[0]) * ring(k), c[1] + (p[1] - c[1]) * ring(k), -back * puff(ring(k)), ring(k), false)
  vert(c[0], c[1], -back, 0, false)
  const idx: number[] = []
  const rows = 2 * R - 1
  const at = (row: number, i: number) => 1 + row * N + (i % N)
  const last = 1 + rows * N
  for (let i = 0; i < N; i++) {
    idx.push(0, at(0, i), at(0, i + 1))
    for (let row = 0; row < rows - 1; row++) idx.push(at(row, i), at(row + 1, i), at(row + 1, i + 1), at(row, i), at(row + 1, i + 1), at(row, i + 1))
    idx.push(last, at(rows - 1, i + 1), at(rows - 1, i))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  // the front surface for decals: how far out a point sits towards the outline in its direction
  const polar = pts.map((p) => ({ a: Math.atan2(p[1] - c[1], p[0] - c[0]), r: Math.hypot(p[0] - c[0], p[1] - c[1]) })).sort((u, v) => u.a - v.a)
  const radiusAt = (a: number) => {
    const j = polar.findIndex((p) => p.a >= a)
    const hi = polar[j < 0 ? 0 : j]
    const lo = polar[j <= 0 ? polar.length - 1 : j - 1]
    let span = hi.a - lo.a
    if (span <= 0) span += Math.PI * 2
    let t = a - lo.a
    if (t < 0) t += Math.PI * 2
    return lo.r + (hi.r - lo.r) * (t / span)
  }
  const surf: Surf = (x, y) => front * puff(Math.hypot(x - c[0], y - c[1]) / radiusAt(Math.atan2(y - c[1], x - c[0])))
  return { geo: g, surf }
}

/** how the two foil balloons differ */
const FOILS = {
  // the heart puffs from just under its dip, which keeps the crease down the middle short
  heart: { outline: () => heartOutline(0.54, 48, 0.055), c: [0, 0.035] as P2, front: 0.1, light: '#ff7f92', nozzle: -0.236, eye: [0.068, 0.03, 0.025, 0.031], cheek: [0.12, -0.02], blush: '#ff9db0', mouth: { x: 0, y: -0.035, w: 0.042, h: 0.024 } },
  star: { outline: () => starOutline(0.31, 0.15), c: [0, 0] as P2, front: 0.085, light: '#9dfab0', nozzle: -0.15, eye: [0.05, 0.035, 0.023, 0.029], cheek: [0.095, -0.015], blush: '#ff9ccf', mouth: { x: 0, y: -0.025, w: 0.04, h: 0.036 } },
}

/** Heart and Star: puffy foil balloons with a tied nozzle and a curly ribbon; the heart smiles, the star grins */
function buildFoil(kind: 'heart' | 'star') {
  const col = SYMBOL_COLOR[kind]
  const o = FOILS[kind]
  const { geo, surf } = pillow(o.outline(), o.c, o.front, 0.06, col, o.light)
  const k = new VKit()
  k.add(geo, '#ffffff')
  k.add(sphere(10, 8), C(col, 0.85), T([0, o.nozzle - 0.012, 0], [0, 0, 0], [0.02, 0.026, 0.02]))
  k.add(new THREE.TorusGeometry(0.015, 0.007, 6, 12), C(col, 0.7), T([0, o.nozzle - 0.036, 0], [Math.PI / 2, 0, 0]))
  ribbon(k, 0, o.nozzle - 0.04, 0)
  // the shine: a streak along the upper-left shoulder and a dot
  const streak: P2[] =
    kind === 'heart'
      ? arc(-0.125, 0.085, 0.085, 0.08, Math.PI * 0.55, Math.PI * 1.02, 10)
      : [
          [-0.1, 0.06],
          [-0.035, 0.155],
          [-0.012, 0.215],
        ]
  stroke(k, surf, streak, 0.03, 0.004, SHINE)
  paint(k, surf, kind === 'heart' ? ellipsePts(-0.06, 0.15, 0.014, 0.014, 10) : ellipsePts(-0.135, 0.03, 0.013, 0.013, 10), SHINE, 0.004, true)
  const [ex, ey, erx, ery] = o.eye
  const eyes: Eye[] = [-1, 1].map((s) => ({ x: s * ex, y: ey, rx: erx, ry: ery }))
  blush(k, surf, [-1, 1].map((s): P2 => [s * o.cheek[0], o.cheek[1]]), 0.026, 0.016, o.blush)
  if (kind === 'heart') smile(k, surf, o.mouth, 0.004)
  else openMouth(k, surf, o.mouth, 0.004)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  root.add(dotEyes(surf, eyes))
  root.add(joyFace(surf, eyes, { ...o.mouth, w: o.mouth.w * 1.1, h: kind === 'heart' ? 0.04 : 0.045 }, 0.006))
  return root
}

/** Party balloon: a classic orange latex balloon with its knot, a big shine and a wide grin */
function buildRound() {
  const col = SYMBOL_COLOR.round
  // a full lower body that tucks into a short neck at the knot, then a round top
  const prof: THREE.Vector2[] = [new THREE.Vector2(0.03, -0.22)]
  for (let i = 1; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2)
    prof.push(new THREE.Vector2(Math.max(0.03, 0.2 * Math.cos(a) ** 0.85), 0.06 + 0.27 * Math.sin(a)))
  }
  for (let i = 1; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2)
    prof.push(new THREE.Vector2(Math.max(0.0001, 0.2 * Math.cos(a)), 0.06 + 0.22 * Math.sin(a)))
  }
  const k = new VKit()
  k.add(new THREE.LatheGeometry(prof, 20), col)
  const knot = '#c75f12'
  k.add(new THREE.TorusGeometry(0.026, 0.012, 6, 14), knot, T([0, -0.226, 0], [Math.PI / 2, 0, 0]))
  k.add(new THREE.ConeGeometry(0.034, 0.042, 12), knot, T([0, -0.255, 0], [Math.PI, 0, 0]))
  ribbon(k, 0, -0.272, 0)
  // the front surface: the profile's radius at each height
  const radiusAt = (y: number) => {
    for (let i = 1; i < prof.length; i++)
      if (prof[i].y >= y) {
        const t = (y - prof[i - 1].y) / (prof[i].y - prof[i - 1].y || 1)
        return prof[i - 1].x + (prof[i].x - prof[i - 1].x) * t
      }
    return 0
  }
  const f: Surf = (x, y) => Math.sqrt(Math.max(0, radiusAt(y) ** 2 - x * x))
  paint(k, f, oval(-0.092, 0.15, 0.026, 0.06, -0.45), SHINE, 0.003, true)
  paint(k, f, ellipsePts(-0.045, 0.215, 0.012, 0.012, 10), SHINE, 0.003, true)
  blush(k, f, [
    [-0.11, 0.01],
    [0.11, 0.01],
  ], 0.026, 0.016, '#ffb38a')
  const mouth: MouthAt = { x: 0, y: 0.015, w: 0.07, h: 0.04 }
  smile(k, f, mouth, 0.004, 0.013)
  for (const s of [-1, 1]) stroke(k, f, arc(s * 0.074, 0.03, 0.012, 0.012, s < 0 ? Math.PI * 0.2 : Math.PI * 0.8, s < 0 ? -Math.PI * 0.5 : Math.PI * 1.5, 6), 0.008, 0.004)
  const root = new THREE.Group()
  root.add(k.mesh('body', castMaterial()))
  const eyes: Eye[] = [
    { x: -0.06, y: 0.1, rx: 0.022, ry: 0.032 },
    { x: 0.06, y: 0.1, rx: 0.022, ry: 0.032 },
  ]
  root.add(dotEyes(f, eyes))
  root.add(joyFace(f, eyes, { x: 0, y: 0.03, w: 0.07, h: 0.06 }, 0.006))
  return root
}

let discoGeo: Geo | null = null
/** the disco ball: silver facets in four shades, each with its own twinkle phase (`aFace`), outlined */
function discoGeometry() {
  if (discoGeo) return discoGeo
  const silver = ['#f4f7ff', '#c9d1e8', '#9aa3c2', '#ffffff'].map((c) => C(c))
  const quad = (x: number, y: number, z: number) => {
    const l = Math.hypot(x, y, z)
    let phi = Math.atan2(z, -x)
    if (phi < 0) phi += Math.PI * 2
    return [Math.floor((phi / (Math.PI * 2)) * 16) % 16, Math.min(11, Math.floor((Math.acos(y / l) / Math.PI) * 12))]
  }
  const ball = new THREE.SphereGeometry(0.26, 16, 12).toNonIndexed()
  ball.computeVertexNormals()
  const p = ball.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  const corner = (u: number, v: number) => {
    const phi = (u / 16) * Math.PI * 2
    const th = (Math.min(12, v) / 12) * Math.PI
    return V(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th)).multiplyScalar(0.26)
  }
  const mid = V()
  for (let i = 0; i < p.count; i += 3) {
    const [u, v] = quad((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3)
    const c = silver[Math.floor(hash(u, v) * 4)]
    // shrink each mirror tile a little about its middle, so dark grout shows between the tiles
    mid.copy(corner(u, v)).add(corner(u + 1, v)).add(corner(u, v + 1)).add(corner(u + 1, v + 1)).multiplyScalar(0.25)
    for (let j = 0; j < 3; j++) {
      col.set([c.r, c.g, c.b], (i + j) * 3)
      p.setXYZ(i + j, mid.x + (p.getX(i + j) - mid.x) * 0.88, mid.y + (p.getY(i + j) - mid.y) * 0.88, mid.z + (p.getZ(i + j) - mid.z) * 0.88)
    }
  }
  ball.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const k = new VKit()
  k.add(ball, '#ffffff', undefined, 0)
  // the grout, and the outline: a smooth ball just inside the tiles, so the hull has no cracks
  k.add(new THREE.SphereGeometry(0.247, 16, 10), '#3b3f63', undefined, 0.022)
  const g = k.geometry()
  const q = g.getAttribute('position')
  const face = new Float32Array(q.count)
  for (let i = 0; i < q.count; i += 3) {
    const [u, v] = quad((q.getX(i) + q.getX(i + 1) + q.getX(i + 2)) / 3, (q.getY(i) + q.getY(i + 1) + q.getY(i + 2)) / 3, (q.getZ(i) + q.getZ(i + 1) + q.getZ(i + 2)) / 3)
    face.fill(hash(v + 3.1, u + 7.7), i, i + 3)
  }
  g.setAttribute('aFace', new THREE.BufferAttribute(face, 1))
  return (discoGeo = g)
}

/** The scatter: a spinning disco ball with a hot pink bow, glowing softly */
function buildDisco() {
  const root = new THREE.Group()
  const ball = new THREE.Mesh(discoGeometry(), discoMaterial())
  ball.name = 'ball'
  ball.position.y = -0.04
  ball.userData.rest = { x: 0, y: -0.04, z: 0, rx: 0, ry: 0, rz: 0 }
  root.add(ball)
  const k = new VKit()
  const pink = '#ff4fb8'
  k.add(new THREE.CylinderGeometry(0.007, 0.007, 0.07, 6), '#c9d1e8', T([0, 0.245, 0]), 0.008)
  k.add(new THREE.CylinderGeometry(0.028, 0.032, 0.03, 12), '#9aa3c2', T([0, 0.225, 0]), 0.01)
  for (const s of [-1, 1]) {
    k.add(new THREE.TorusGeometry(0.04, 0.021, 6, 12), pink, T([s * 0.047, 0.302, 0.02], [0, s * 0.3, s * 0.3], [1, 0.7, 0.6]))
    k.add(capsule(0.016, 0.045), C(pink, 0.9), T([s * 0.03, 0.258, 0.035], [0.25, 0, s * 0.55]))
  }
  k.add(new THREE.SphereGeometry(0.024, 8, 6), C(pink, 0.85), T([0, 0.3, 0.035]))
  const bow = k.mesh('bow', castMaterial())
  root.add(bow)
  const h = new THREE.Sprite(haloMaterial())
  h.name = 'halo'
  h.scale.set(1.1, 1.1, 1)
  h.position.z = -0.3
  root.add(h)
  return root
}

/* ------------------------------------------------------------------ */
/*  DJ Bop and his booth                                                */
/* ------------------------------------------------------------------ */

export interface HostRig {
  /** origin at the booth top centre (the booth's middle is at z 0); DJ Bop stands 0.3 behind it, about 1.2 tall */
  root: THREE.Group
  /** shoulder sway, jump; pivots at the waist */
  torso: THREE.Group
  /** pivots at the neck (nod = rotation.x) */
  head: THREE.Group
  /** children 'heart' (visible) and 'star' (hidden); lifts for 'shades' */
  glasses: THREE.Group
  /** swapped by visibility */
  mouth: { smile: THREE.Object3D; open: THREE.Object3D }
  /** shoulder pivots */
  armL: THREE.Group
  armR: THREE.Group
  /** hand pump prop, hidden; parent armR */
  pump: THREE.Object3D
  /** fan of 3 pins, hidden; parent armL */
  pins: THREE.Object3D
  /** giant pink balloon for Big Pop, hidden; parent torso; grows from its knot at DJ Bop's snout */
  balloon: THREE.Object3D
  booth: THREE.Group
  /** 2 records, rotate about their local y */
  platters: THREE.Object3D[]
  /** 6 booth lights, instanceColor animated */
  lights: THREE.InstancedMesh
}

const TEAL = '#29d8c4'
const GOLD = '#ffc93d'
/** the turntables lean towards the camera, which looks up at the booth */
const DECK_TILT = 0.36

/** DJ Bop: a teal balloon dog in gold headphones and heart shades, at his decks */
export function buildHost(): HostRig {
  const mat = castMaterial(true)
  const root = new THREE.Group()

  // the booth: a rounded desk with neon trim, two turntables and six lights
  const booth = new THREE.Group()
  booth.name = 'booth'
  const b = new VKit()
  b.add(new RoundedBoxGeometry(2.4, 0.5, 0.6, 2, 0.07), '#1e1b3a', T([0, -0.25, 0]))
  for (const y of [-0.05, -0.45]) b.add(new THREE.CapsuleGeometry(0.013, 2.2, 2, 6), C('#ff7ad1', 1.6), T([0, y, 0.3], [0, 0, Math.PI / 2], [1, 1, 0.5]), 0, true)
  const deckAt = (x: number) => T([x, 0.07, -0.02], [DECK_TILT, 0, 0])
  for (const s of [-1, 1]) {
    const deck = deckAt(s * 0.62)
    b.add(new RoundedBoxGeometry(0.78, 0.07, 0.76, 1, 0.03), '#2d2858', new THREE.Matrix4().multiplyMatrices(deck, T([0, -0.05, 0])))
    b.add(new THREE.CylinderGeometry(0.03, 0.035, 0.04, 10), '#c9d1e8', new THREE.Matrix4().multiplyMatrices(deck, T([s * 0.3, 0, -0.28])), 0.01)
    b.add(new THREE.CapsuleGeometry(0.011, 0.3, 2, 6), '#dfe6ff', new THREE.Matrix4().multiplyMatrices(deck, T([s * 0.24, 0.035, -0.14], [Math.PI / 2, 0, s * 0.5])), 0.01)
  }
  booth.add(b.mesh('booth', mat))
  const platters = (['#ff4fb8', '#ffcc29'] as const).map((label, i) => {
    const m = new THREE.Mesh(platterGeometry(label), mat)
    m.name = 'platter'
    m.position.set(i ? 0.62 : -0.62, 0.075, -0.02)
    m.rotation.x = DECK_TILT
    m.userData.rest = { x: m.position.x, y: m.position.y, z: m.position.z, rx: DECK_TILT, ry: 0, rz: 0 }
    booth.add(m)
    return m
  })
  const l = new VKit()
  l.add(new RoundedBoxGeometry(0.11, 0.11, 0.06, 1, 0.025), C('#ffffff', 1.5), undefined, 0.012, true)
  const lights = new THREE.InstancedMesh(l.geometry(), mat, 6)
  lights.name = 'lights'
  ;['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4', '#ff8a2a'].forEach((c, i) => {
    lights.setMatrixAt(i, T([-0.95 + i * 0.38, -0.25, 0.31]))
    lights.setColorAt(i, C(c))
  })
  booth.add(lights)
  root.add(booth)

  // DJ Bop, built in the torso's frame: its origin is his waist, level with the booth top
  const torso = new THREE.Group()
  torso.name = 'torso'
  torso.position.set(0, 0, -0.3)
  torso.userData.rest = { x: 0, y: 0, z: -0.3, rx: 0, ry: 0, rz: 0 }
  const NECK = 0.7
  const t = new VKit()
  sausage(t, [0, -0.3, 0], [0, NECK, 0], 0.135, TEAL, 'b')
  const tie = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.075, 0.042), new THREE.Vector2(0.072, -0.044)])
  for (const s of [-1, 1]) t.add(smooth(new THREE.ExtrudeGeometry(tie, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1, curveSegments: 1 })), '#ff4fb8', T([0, NECK - 0.07, 0.12], [-0.25, 0, 0], [s, 1, 1]), 0.012)
  t.add(new THREE.SphereGeometry(0.024, 8, 6), '#e0379d', T([0, NECK - 0.07, 0.145]), 0.01)
  torso.add(t.mesh('body', mat))

  // the head, in its own frame from the neck; the face turns a little to his left, so the snout shows in profile
  const h = new VKit()
  const skull: Ell = { c: [0, 0.22, 0.02], r: [0.2, 0.19, 0.18] }
  const hf = ellSurf(skull)
  h.add(sphere(18, 12), TEAL, T(skull.c, [0, 0, 0], skull.r))
  const snoutA: P3 = [0, 0.15, 0.12]
  const snoutB: P3 = [0, 0.1, 0.33]
  sausage(h, snoutA, snoutB, 0.088, TEAL, '')
  h.add(new THREE.SphereGeometry(0.05, 10, 8), '#2a1630', T([0, 0.135, 0.405], [0, 0, 0], [1, 0.78, 0.8]), 0)
  h.add(new THREE.SphereGeometry(0.013, 5, 3), SPARK, T([-0.018, 0.155, 0.438]), 0, true)
  for (const s of [-1, 1]) {
    sausage(h, [s * 0.15, 0.31, -0.03], [s * 0.26, 0.02, 0.03], 0.07, TEAL, 'a')
    h.add(new THREE.CylinderGeometry(0.085, 0.085, 0.075, 18), GOLD, T([s * 0.205, 0.21, 0], [0, 0, Math.PI / 2]))
    h.add(new THREE.CylinderGeometry(0.055, 0.055, 0.02, 16), '#ff4fb8', T([s * 0.248, 0.21, 0], [0, 0, Math.PI / 2]), 0.01)
  }
  h.add(new THREE.TorusGeometry(0.222, 0.03, 8, 30, Math.PI), GOLD, T([0, 0.21, -0.01], [-0.22, 0, 0]))
  // eyes under the shades, for when he lifts them
  for (const s of [-1, 1]) {
    h.decal(skull, oval(s * 0.07, 0.255, 0.042, 0.05), '#ffffff', 0.003, 0.01, undefined, false)
    h.decal(skull, oval(s * 0.066, 0.266, 0.024, 0.03), PUPIL, 0.005, 0)
    h.decal(skull, oval(s * 0.066 - 0.008, 0.278, 0.008, 0.009), SPARK, 0.007, 0)
  }
  paint(h, hf, oval(-0.105, 0.34, 0.042, 0.016, 0.6), SHINE, 0.003, true)
  blush(h, hf, [
    [-0.125, 0.15],
    [0.125, 0.15],
  ], 0.034, 0.02, '#7ff0e2')
  const head = new THREE.Group()
  head.name = 'head'
  head.position.set(0, NECK, 0)
  head.userData.rest = { x: 0, y: NECK, z: 0, rx: 0, ry: 0, rz: 0 }
  const face = new THREE.Group()
  face.rotation.y = 0.32
  face.add(h.mesh('head', mat))
  head.add(face)

  const glasses = new THREE.Group()
  glasses.name = 'glasses'
  glasses.position.set(0, 0.255, 0.215)
  glasses.userData.rest = { x: 0, y: 0.255, z: 0.215, rx: 0, ry: 0, rz: 0 }
  const heartG = shades(heartOutline(0.155, 28), '#ff4fb8', '#2a0d3a', mat)
  heartG.name = 'heart'
  const starG = shades(starOutline(0.088, 0.044), '#ffe23d', '#c4168a', mat)
  starG.name = 'star'
  starG.visible = false
  glasses.add(heartG, starG)
  face.add(glasses)

  const snout = capSurf(snoutA, snoutB, 0.088)
  const sm = new VKit()
  smile(sm, snout, { x: 0, y: 0.075, w: 0.046, h: 0.022 }, 0.004, 0.013)
  const smileMesh = sm.mesh('smile', mat)
  const om = new VKit()
  openMouth(om, snout, { x: 0, y: 0.085, w: 0.05, h: 0.05 }, 0.005)
  const openMesh = om.mesh('open', mat)
  openMesh.visible = false
  face.add(smileMesh, openMesh)
  torso.add(head)

  const arms = [-1, 1].map((s) => {
    const a = new VKit()
    const shoulder: P3 = [s * 0.13, 0.52, 0.02]
    const elbow: P3 = [s * 0.3, 0.27, 0.16]
    sausage(a, shoulder, elbow, 0.074, TEAL, 'ab')
    sausage(a, elbow, [s * 0.45, 0.17, 0.3], 0.068, TEAL, '')
    a.add(sphere(12, 9), '#ffffff', T([s * 0.475, 0.18, 0.315], [0, 0, 0], [0.08, 0.072, 0.072]))
    const arm = part(a, s < 0 ? 'armL' : 'armR', shoulder, mat)
    torso.add(arm)
    return arm
  })

  // props, hidden until the scene needs them
  const p = new VKit()
  p.add(new THREE.CylinderGeometry(0.045, 0.045, 0.22, 14), '#3fc4ff', T([0, 0.12, 0]))
  p.add(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 14), '#2a8fd0', T([0, 0.235, 0]))
  p.add(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 6), '#dfe6ff', T([0, 0.29, 0]), 0.008)
  p.add(capsule(0.02, 0.14), '#ffcc29', T([0, 0.345, 0], [0, 0, Math.PI / 2]))
  p.add(new THREE.ConeGeometry(0.03, 0.06, 10), '#ff4fb8', T([0, -0.015, 0], [Math.PI, 0, 0]))
  const pump = p.mesh('pump', mat)
  pump.position.set(0.475, 0.2, 0.34)
  pump.visible = false
  arms[1].children[0].add(pump)

  const n = new VKit()
  ;['#ff3b55', '#ffcc29', '#3fc4ff'].forEach((c, i) => {
    const m = T([0, 0, 0], [0, 0, (i - 1) * 0.42])
    n.add(new THREE.CylinderGeometry(0.006, 0.002, 0.17, 6), '#dfe6ff', new THREE.Matrix4().multiplyMatrices(m, T([0, 0.06, 0])), 0.006)
    n.add(new THREE.SphereGeometry(0.026, 10, 8), c, new THREE.Matrix4().multiplyMatrices(m, T([0, 0.15, 0])), 0.01)
  })
  const pins = n.mesh('pins', mat)
  pins.position.set(-0.475, 0.23, 0.34)
  pins.visible = false
  arms[0].children[0].add(pins)

  // the Big Pop balloon stands on its knot at the tip of his snout
  const balloon = new THREE.Group()
  balloon.name = 'balloon'
  balloon.add(giantBalloon(mat))
  balloon.position.set(0.13, NECK + 0.08, 0.45)
  balloon.visible = false
  torso.add(balloon)
  root.add(torso)

  return {
    root,
    torso,
    head,
    glasses,
    mouth: { smile: smileMesh, open: openMesh },
    armL: arms[0],
    armR: arms[1],
    pump,
    pins,
    balloon,
    booth,
    platters,
    lights,
  }
}

/** a pair of novelty sunglasses: puffy frames in the outline's shape, dark lenses with a glint */
function shades(outline: P2[], frame: string, lens: string, mat: THREE.Material) {
  const k = new VKit()
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  const inner = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x * 0.74, y * 0.74)))
  // centre each lens on its middle
  const cy = (Math.max(...outline.map((p) => p[1])) + Math.min(...outline.map((p) => p[1]))) / 2
  for (const s of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 4 })
    k.add(smooth(g), frame, T([s * 0.088, -cy, -0.01]))
    k.add(new THREE.ShapeGeometry(inner), lens, T([s * 0.088, -cy, 0.0125]), 0)
    k.add(strip(arc(s * 0.088 - 0.012, 0.005, 0.03, 0.026, Math.PI * 0.62, Math.PI * 0.95, 6), 0.012, 0.3), SPARK, T([0, 0, 0.0135]), 0, true)
    k.add(capsule(0.009, 0.16), frame, T([s * 0.165, 0.01, -0.09], [Math.PI / 2, 0, 0]), 0.008)
  }
  k.add(capsule(0.012, 0.03), frame, T([0, 0.012, 0], [0, 0, Math.PI / 2]), 0.01)
  return k.mesh('shades', mat)
}

/** the record on a turntable: vinyl with grooves, a coloured label and a mark so the spin shows */
function platterGeometry(label: string) {
  const k = new VKit(INK, 0.012)
  k.add(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 28, 1, true), '#141120')
  k.add(disc(0.32, 28, 6, (r) => (r < 0.107 ? label : r > 0.3 ? '#141120' : Math.floor(r / 0.053) % 2 ? '#221d33' : '#181425')), '#ffffff', T([0, 0.025, 0], [-Math.PI / 2, 0, 0]), 0)
  k.add(strip(arc(0, 0, 0.22, 0.22, Math.PI * 0.62, Math.PI * 0.88, 8), 0.045, 0.3), C('#ffffff', 0.35), T([0, 0.027, 0], [-Math.PI / 2, 0, 0]), 0, true)
  k.add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 10), '#ffffff', T([0.065, 0.028, 0]), 0, true)
  k.add(new THREE.CylinderGeometry(0.012, 0.012, 0.04, 8), '#dfe6ff', T([0, 0.04, 0]), 0.006)
  return k.geometry()
}

/** a flat disc in rings, coloured per ring by its radius */
function disc(r: number, n: number, rings: number, color: (r: number) => string) {
  const g = fan(ellipsePts(0, 0, r, r, n), [0, 0], rings)
  const p = g.getAttribute('position')
  const col = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i += 3) {
    const c = C(color(Math.hypot((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3)))
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

/** the Big Pop balloon: a big pink party balloon standing on its knot at the origin */
function giantBalloon(mat: THREE.Material) {
  const prof: THREE.Vector2[] = []
  for (let i = 0; i <= 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI
    const w = 0.42 * Math.cos(a) * (1 - 0.18 * Math.max(0, -Math.sin(a)))
    prof.push(new THREE.Vector2(Math.max(0.03, w), 0.5 + 0.5 * Math.sin(a) * (a < 0 ? 0.92 : 1)))
  }
  prof[prof.length - 1].x = 0.0001
  const k = new VKit()
  k.add(new THREE.LatheGeometry(prof, 24), '#ff4fb8')
  k.add(new THREE.TorusGeometry(0.035, 0.016, 6, 12), '#c22a86', T([0, 0.03, 0], [Math.PI / 2, 0, 0]))
  k.add(new THREE.ConeGeometry(0.045, 0.06, 10), '#c22a86', T([0, -0.01, 0], [Math.PI, 0, 0]))
  k.decal({ c: [0, 0.52, 0], r: [0.42, 0.5, 0.42] }, oval(-0.17, 0.72, 0.05, 0.12, -0.5), SHINE, 0.004, 0)
  k.decal({ c: [0, 0.52, 0], r: [0.42, 0.5, 0.42] }, ellipsePts(-0.08, 0.86, 0.024, 0.024, 10), SHINE, 0.004, 0)
  return k.mesh('balloon', mat)
}

/* ------------------------------------------------------------------ */
/*  Stage props                                                         */
/* ------------------------------------------------------------------ */

/** the big mirror ball of Disco Night: the disco ball at 2.5×, hanging from a chain 3 units long */
export function buildMirrorBall(): THREE.Group {
  const g = new THREE.Group()
  const ball = new THREE.Mesh(discoGeometry(), discoMaterial(true))
  ball.name = 'ball'
  ball.scale.setScalar(2.5)
  g.add(ball)
  const k = new VKit()
  k.add(new THREE.CylinderGeometry(0.07, 0.09, 0.08, 12), '#9aa3c2', T([0, 0.67, 0]), 0.02)
  for (let i = 0; i < 8; i++) k.add(new THREE.TorusGeometry(0.1, 0.026, 6, 14), '#c9d1e8', T([0, 0.86 + i * 0.36, 0], [0, i % 2 ? Math.PI / 2 : 0, 0], [1, 1.5, 1]), 0.02)
  const geo = k.geometry()
  geo.setAttribute('aFace', new THREE.BufferAttribute(new Float32Array(geo.getAttribute('position').count), 1))
  const chain = new THREE.Mesh(geo, discoMaterial(true))
  chain.name = 'chain'
  g.add(chain)
  return g
}

let garland: Geo | null = null
/**
 * One balloon of the arch, unit size, white so instanceColor tints it; ink hull 0.09 (about 0.017 in the arch). A 12 × 8
 * sphere is plenty at its size on screen (under 1 px off round) and keeps the ~180-balloon arch near 70k triangles.
 */
export function garlandGeometry() {
  if (garland) return garland
  const k = new VKit(INK, 0.09)
  const e: Ell = { c: [0, 0, 0], r: [1, 1.12, 1] }
  k.add(sphere(12, 8), '#ffffff', T(e.c, [0, 0, 0], e.r))
  k.add(new THREE.ConeGeometry(0.2, 0.24, 8), '#ffffff', T([0, -1.18, 0]))
  const streak = oval(-0.4, 0.48, 0.13, 0.3, -0.55, 12)
  k.add(conform(fan(streak, centroid(streak), 2), e, 0.012), C('#ffffff', 1.8), undefined, 0, true)
  return (garland = k.geometry())
}

/** a latex shred for the pop bursts: a small irregular triangle, white both sides for instanceColor */
export function shredGeometry() {
  const g = new THREE.BufferGeometry()
  const a = [-0.045, -0.025, 0]
  const b = [0.045, -0.03, 0]
  const c = [0.008, 0.032, 0]
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...b], 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1], 3))
  return new VKit().add(g, '#ffffff', undefined, 0).geometry()
}

/** a small vinyl record for DJ Bop to throw: black disc, pink label */
export function recordGeometry() {
  const k = new VKit(INK, 0.006)
  k.add(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 20, 1, true), '#17141f')
  for (const s of [1, -1]) k.add(disc(0.12, 20, 3, (r) => (r < 0.04 ? '#ff4fb8' : r < 0.08 ? '#1b1726' : '#2a2536')), '#ffffff', T([0, s * 0.006, 0], [-s * (Math.PI / 2), 0, 0]), 0)
  return k.geometry()
}

/* ------------------------------------------------------------------ */
/*  Textures                                                            */
/* ------------------------------------------------------------------ */

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

/** each badge's pill as a share of its square atlas slot: BADGE_H tall and BADGE_W[slot] wide, wider for longer numbers */
export const BADGE_H = 0.5
export const BADGE_W = [0.62, 0.62, 0.62, 0.76, 0.76, 0.76, 0.9]
const RAINBOW = ['#ff4a5a', '#ff9a2e', '#ffe23d', '#6dff5a', '#2fd3ff', '#9a6bff', '#ff4fd8']
/** a CSS colour a share t of the way from a to b */
const mixCss = (a: string, b: string, t: number) => `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`

let badges: THREE.CanvasTexture | null = null
/**
 * The multiplier badges: a 4 × 2 atlas of 256 × 256 slots; slot k reads ×2^(k+1), the badge for level k + 2. Each is a
 * pill centred in its slot: an ink edge, a rim in the level's colour, a dark face and big white numerals, so it reads
 * on any tile at phone size.
 */
export function badgeAtlas() {
  return (badges ??= canvasTexture(1024, 512, `800 100px ${FONT}`, (g) => {
    const S = 256
    const RIM = 7
    const FACE = 19
    for (let k = 0; k < 7; k++) {
      const cx = (k % 4) * S + S / 2
      const cy = Math.floor(k / 4) * S + S / 2
      const w = BADGE_W[k] * S
      const h = BADGE_H * S
      const top = cy - h / 2
      const pill = (inset: number) => {
        g.beginPath()
        g.roundRect(cx - w / 2 + inset, top + inset, w - 2 * inset, h - 2 * inset, h / 2 - inset)
      }
      const level = LEVEL_COLOR[k + 2]
      // the ink edge, with a soft shadow under the badge
      g.save()
      g.shadowColor = 'rgba(8, 2, 20, 0.7)'
      g.shadowBlur = 12
      g.shadowOffsetY = 6
      pill(0)
      g.fillStyle = INK
      g.fill()
      g.restore()
      // the rim in the level's colour, bright at the top (a rainbow at ×128)
      pill(RIM)
      if (k === 6) {
        const r = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
        RAINBOW.forEach((c, i) => r.addColorStop(i / 6, c))
        g.fillStyle = r
      } else {
        const r = g.createLinearGradient(0, top, 0, top + h)
        r.addColorStop(0, mixCss(level, '#ffffff', 0.5))
        r.addColorStop(0.5, level)
        r.addColorStop(1, mixCss(level, INK, 0.3))
        g.fillStyle = r
      }
      g.fill()
      // the dark face, with a gloss over its top half
      pill(FACE)
      const f = g.createLinearGradient(0, top + FACE, 0, top + h - FACE)
      f.addColorStop(0, '#3d2366')
      f.addColorStop(1, '#130826')
      g.fillStyle = f
      g.fill()
      g.save()
      pill(FACE)
      g.clip()
      g.fillStyle = 'rgba(255, 255, 255, 0.1)'
      g.beginPath()
      g.ellipse(cx, top + FACE, w / 2 - FACE - 6, (h - 2 * FACE) * 0.45, 0, 0, Math.PI * 2)
      g.fill()
      g.restore()
      // the numerals: a smaller × in the level's colour, then the number in white, as big as the face allows
      const num = String(2 ** (k + 1))
      const room = w - 2 * FACE - 16
      let size = 100
      const measure = () => {
        g.font = `800 ${size * 0.74}px ${FONT}`
        const x = g.measureText('×')
        g.font = `800 ${size}px ${FONT}`
        const n = g.measureText(num)
        return { x, n, w: x.width + n.width - size * 0.05 }
      }
      let m = measure()
      if (m.w > room) {
        size *= room / m.w
        m = measure()
      }
      const x0 = cx - m.w / 2
      g.textAlign = 'left'
      g.textBaseline = 'alphabetic'
      // both centred on the face's middle line
      g.font = `800 ${size * 0.74}px ${FONT}`
      g.fillStyle = k === 6 ? '#ffd23f' : mixCss(level, '#ffffff', 0.35)
      g.fillText('×', x0, cy + (m.x.actualBoundingBoxAscent - m.x.actualBoundingBoxDescent) / 2)
      g.font = `800 ${size}px ${FONT}`
      g.fillStyle = '#ffffff'
      g.fillText(num, x0 + m.x.width - size * 0.05, cy + (m.n.actualBoundingBoxAscent - m.n.actualBoundingBoxDescent) / 2)
    }
  }))
}

let popCard: THREE.CanvasTexture | null = null
/** the comic POP! card: a yellow starburst with the word in red */
export function popCardTexture() {
  return (popCard ??= canvasTexture(512, 512, `900 150px ${FONT}`, (g) => {
    g.beginPath()
    for (let i = 0; i < 28; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 14
      const r = i % 2 ? 172 + 16 * hash(i, 1) : 238 - 14 * hash(i, 2)
      g.lineTo(256 + Math.cos(a) * r, 256 + Math.sin(a) * r)
    }
    g.closePath()
    g.fillStyle = '#ffe23d'
    g.fill()
    g.lineJoin = 'round'
    g.lineWidth = 14
    g.strokeStyle = INK
    g.stroke()
    g.save()
    g.translate(256, 262)
    g.rotate((-8 * Math.PI) / 180)
    g.font = `900 150px ${FONT}`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineWidth = 34
    g.strokeStyle = INK
    g.strokeText('POP!', 0, 0)
    g.lineWidth = 18
    g.strokeStyle = '#ffffff'
    g.strokeText('POP!', 0, 0)
    g.fillStyle = '#ff3b55'
    g.fillText('POP!', 0, 0)
    g.restore()
  }))
}

/* ------------------------------------------------------------------ */
/*  Building and sharing                                                */
/* ------------------------------------------------------------------ */

const BUILD: Record<Sym, () => THREE.Group> = {
  poodle: buildPoodle,
  giraffe: buildGiraffe,
  bunny: buildBunny,
  octo: buildOcto,
  heart: () => buildFoil('heart'),
  star: () => buildFoil('star'),
  round: buildRound,
  disco: buildDisco,
}

const protos = new Map<string, THREE.Group>()
function proto(key: string, make: () => THREE.Group) {
  let p = protos.get(key)
  if (!p) protos.set(key, (p = make()))
  return p
}

/** a fresh copy of a symbol, sharing geometry and materials with every other copy */
export function buildSymbol(sym: Sym): THREE.Group {
  return proto(sym, BUILD[sym]).clone()
}

/** the octopus' hat on its own, for the scene to throw off when an octopus pops; it starts where it sits on the head */
export function buildOctoHat(): THREE.Group {
  return proto('octoHat', () => {
    const k = new VKit()
    hat(k, new THREE.Matrix4())
    const g = new THREE.Group()
    g.add(k.mesh('hat', castMaterial()))
    g.position.set(...HAT_POS)
    g.rotation.set(...HAT_ROT)
    g.userData.rest = { x: HAT_POS[0], y: HAT_POS[1], z: HAT_POS[2], rx: HAT_ROT[0], ry: HAT_ROT[1], rz: HAT_ROT[2] }
    return g
  }).clone()
}

/** builds every model ahead of time */
export function warmUp() {
  for (const s of Object.keys(BUILD) as Sym[]) proto(s, BUILD[s])
  buildOctoHat()
}

/**
 * Lets go of a renderer that is closing. Every material, texture and geometry cached here (and the shared toon ramp,
 * glow texture and sprite quad) holds a 'dispose' listener from each renderer that drew it, and through it the whole
 * renderer, so every visit used to leave one behind. Disposing them drops those listeners and the GPU copies; the
 * objects themselves stay cached, and the next scene uploads them again without rebuilding a single model.
 */
export function releaseModels() {
  for (const m of [cast, stageCast, disco, stageDisco, halo]) m?.dispose()
  badges?.dispose()
  popCard?.dispose()
  discoGeo?.dispose()
  garland?.dispose()
  for (const p of protos.values())
    p.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  toonRamp(RAMP).dispose()
  glowTexture().dispose()
  // three's sprites all share one quad
  new THREE.Sprite().geometry.dispose()
}
