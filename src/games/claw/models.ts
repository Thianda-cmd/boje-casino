import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { glowTexture } from '../../lib/three/fx'
import { T, VKit, centroid, conform, ellipsePts, fan, surfaceZ, toonRamp, vkMaterial, type Ell, type Geo, type P2, type P3 } from '../../lib/three/toon'
import { PRIZES, type PrizeId } from './rules'

/*
  The Lucky Claw plushies, modelled in code in the site's toon style: flat shading in four tones through a ramp and a
  dark ink outline (an inverted hull) round every solid part. Each plushie is a few VKit meshes (colour per vertex,
  outline merged in) sharing one material: the body (with its mouth), the button eyes, the closed eyes of a blink and
  the joy face of a win. Its multiplier hangs on a tag in front of its tummy, cut from one shared atlas.
  Every plushie sits with its base on y = 0, faces +z and stands about 0.9 tall. The filler plushies of the heap are
  simpler blobs in pastel felt, merged into one mesh.
*/

export const INK = '#1d0f30'
const RAMP = [96, 168, 226, 255]

/* ------------------------------------------------------------------ */
/*  Materials                                                           */
/* ------------------------------------------------------------------ */

let felt: THREE.MeshToonMaterial | null = null
let gold: THREE.MeshToonMaterial | null = null
let tagMat: THREE.MeshBasicMaterial | null = null
let tagTex: THREE.CanvasTexture | null = null
let haloMat: THREE.SpriteMaterial | null = null
const uTime = { value: 0 }

/** the toon material every plushie, the heap and the cabinet share */
export function feltMaterial() {
  return (felt ??= vkMaterial(toonRamp(RAMP)))
}

/** the golden unicorn's: felt shading plus a band of shine that sweeps over it (and blooms); `uTime` drives it */
export function goldMaterial() {
  if (gold) return gold
  const m = vkMaterial(toonRamp(RAMP))
  const vk = m.onBeforeCompile
  m.onBeforeCompile = (s, r) => {
    vk.call(m, s, r)
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorld;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vWorld;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float band = fract((vWorld.x * 0.9 + vWorld.y * 1.4) * 0.5 - uTime * 0.35);
        totalEmissiveRadiance += diffuseColor.rgb * (smoothstep(0.0, 0.05, band) * (1.0 - smoothstep(0.05, 0.13, band))) * 1.1 * (1.0 - vFlat);`,
      )
  }
  m.customProgramCacheKey = () => 'vk-gold'
  return (gold = m)
}

/** shared shader time for the gold shine */
export const setModelTime = (t: number) => void (uTime.value = t)

export function haloMaterial() {
  return (haloMat ??= new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffd76a').multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
}

/* ------------------------------------------------------------------ */
/*  Geometry kit                                                        */
/* ------------------------------------------------------------------ */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
const SPARK = C('#ffffff', 1.35)
const BUTTON = '#1b1024'
const MOUTH = '#4a1530'
const TONGUE = '#ff6f91'
const BLUSH = '#ff8fb5'

const sphere = (w = 22, h = 16) => new THREE.SphereGeometry(1, w, h)
const hex = (c: THREE.Color) => '#' + c.getHexString()
const shade = (c: string, f: number) => hex(new THREE.Color(c).multiplyScalar(f))
const tint = (c: string, to: string, f: number) => hex(new THREE.Color(c).lerp(new THREE.Color(to), f))

/** a matrix that stands a +y shape on the segment a-b, centred on it */
function aim(a: THREE.Vector3, b: THREE.Vector3, s: P3 = [1, 1, 1]) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(...s))
}

/** an ellipsoid solid */
function ell(k: VKit, e: Ell, color: THREE.ColorRepresentation, ink?: number, rot: P3 = [0, 0, 0], seg: [number, number] = [22, 16]) {
  k.add(sphere(...seg), color, T(e.c, rot, e.r), ink)
}

/** a capsule from a to b */
function limb(k: VKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink?: number) {
  const A = V(...a)
  const B = V(...b)
  k.add(new THREE.CapsuleGeometry(r, Math.max(0.001, A.distanceTo(B)), 4, 12), color, aim(A, B), ink)
}

/** a cone from its base centre to its tip */
function horn(k: VKit, base: P3, tip: P3, r: number, color: THREE.ColorRepresentation, ink?: number, seg = 14) {
  const A = V(...base)
  const B = V(...tip)
  k.add(smooth(new THREE.ConeGeometry(r, A.distanceTo(B), seg, 1)), color, aim(A, B), ink)
}

/** smooth normals across shared corners, so the hull of a faceted shape stays closed */
function smooth(g: Geo) {
  for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'color') g.deleteAttribute(key)
  const m = mergeVertices(g)
  m.computeVertexNormals()
  return m
}

/** a ribbon of width w along a path, thinning to rounded points at both ends (a pen stroke) */
function strip(path: P2[], w: number, taper = 0.3) {
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

/** a pen stroke painted onto the front of an ellipsoid */
function line(k: VKit, e: Ell, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK, taper = 0.3) {
  k.add(conform(strip(path, w, taper), e, lift), color, undefined, 0, true)
}

/** a filled shape painted onto the front of an ellipsoid, no rim */
function paint(k: VKit, e: Ell, pts: P2[], color: THREE.ColorRepresentation, lift: number, flat = false) {
  const c = centroid(pts)
  const rings = Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.025)))
  k.add(conform(fan(pts, c, rings), e, lift), color, undefined, 0, flat)
}

const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 18): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])

/** a five-point star outline */
function starPts(cx: number, cy: number, r: number): P2[] {
  return Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * 0.45 : r
    return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as P2
  })
}

/** a tube along a curve whose radius runs from r0 to r1 (a tentacle, a tail) */
function taperTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number, seg = 24, radial = 10) {
  const g = new THREE.TubeGeometry(curve, seg, 1, radial, false)
  const p = g.getAttribute('position') as THREE.BufferAttribute
  const c = new THREE.Vector3()
  const v = new THREE.Vector3()
  for (let i = 0; i <= seg; i++) {
    const t = i / seg
    curve.getPointAt(t, c)
    const r = r0 + (r1 - r0) * t
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j
      v.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c)
      p.setXYZ(k, v.x, v.y, v.z)
    }
  }
  // a round cap on the thin end
  return mergeGeometries([g.toNonIndexed(), new THREE.SphereGeometry(r1, 8, 6).translate(...curve.getPointAt(1).toArray()).toNonIndexed()].map((x) => {
    for (const key of Object.keys(x.attributes)) if (key !== 'position' && key !== 'normal') x.deleteAttribute(key)
    return x
  }))
}

/* ---------------- faces ---------------- */

interface FaceSpec {
  /** the ellipsoid the eyes sit on */
  head: Ell
  eyeX: number
  eyeY: number
  eyeR: [number, number]
  /** the ellipsoid the mouth is drawn on (a muzzle), the head by default */
  muzzle?: Ell
  mouthY: number
  mouthW: number
  mouth?: 'smile' | 'w' | 'grin'
  blushX?: number
  blushY?: number
  lashes?: boolean
  /** where the pupils look */
  look?: P2
}

/** the button eyes: glossy black half-domes set into the head, with two glints each */
function buttonEyes(f: FaceSpec) {
  const k = new VKit(INK)
  const look = f.look ?? [0.12, 0.06]
  for (const s of [-1, 1]) {
    const x = s * f.eyeX
    const [rx, ry] = f.eyeR
    const rz = Math.min(rx, ry) * 0.7
    const z = surfaceZ(f.head, x, f.eyeY) - rz * 0.4
    k.add(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), BUTTON, T([x, f.eyeY, z], [Math.PI / 2, 0, 0], [rx, rz, ry]), 0.008)
    const ball: Ell = { c: [x, f.eyeY, z], r: [rx, ry, rz] }
    const gx = x + look[0] * rx - rx * 0.28
    const gy = f.eyeY + look[1] * ry + ry * 0.3
    k.decal(ball, ellipsePts(gx, gy, rx * 0.3, ry * 0.26, 12), SPARK, 0.004, 0)
    k.decal(ball, ellipsePts(x + rx * 0.3, f.eyeY - ry * 0.32, rx * 0.12, ry * 0.11, 8), SPARK, 0.004, 0)
    if (f.lashes) {
      for (let i = 0; i < 3; i++) {
        const a = Math.PI / 2 + s * (0.25 + i * 0.32)
        const bx = x + Math.cos(a) * rx * 0.95
        const by = f.eyeY + Math.sin(a) * ry * 0.95
        const len = ry * (0.7 - i * 0.12)
        line(k, f.head, [[bx, by], [bx + Math.cos(a) * len * 0.6 + s * len * 0.15, by + Math.sin(a) * len * 0.7], [bx + Math.cos(a) * len + s * len * 0.35, by + Math.sin(a) * len]], rx * 0.28, 0.004)
      }
    }
  }
  return k
}

/** the closed eyes of a blink: two little arcs */
function blinkEyes(f: FaceSpec) {
  const k = new VKit(INK)
  for (const s of [-1, 1]) {
    const x = s * f.eyeX
    line(k, f.head, arc(x, f.eyeY + f.eyeR[1] * 0.1, f.eyeR[0] * 1.05, f.eyeR[1] * 0.55, Math.PI * 1.05, Math.PI * 1.95, 10), f.eyeR[0] * 0.5, 0.006)
  }
  return k
}

/** the mouth, drawn on the muzzle */
function mouth(k: VKit, f: FaceSpec) {
  const m = f.muzzle ?? f.head
  const w = f.mouthW
  const y = f.mouthY
  const kind = f.mouth ?? 'smile'
  const thick = Math.max(0.011, w * 0.16)
  if (kind === 'w') {
    line(k, m, arc(-w * 0.5, y, w * 0.5, w * 0.42, Math.PI * 1.05, Math.PI * 1.95, 8), thick, 0.004)
    line(k, m, arc(w * 0.5, y, w * 0.5, w * 0.42, Math.PI * 1.05, Math.PI * 1.95, 8), thick, 0.004)
  } else if (kind === 'grin') {
    // a wide open smile: dark inside with a tongue
    const pts: P2[] = [...arc(0, y + w * 0.12, w, w * 0.75, Math.PI * 1.02, Math.PI * 1.98, 14)].reverse()
    const top: P2[] = Array.from({ length: 9 }, (_, i) => [-w + (2 * w * i) / 8, y + w * 0.12 - Math.sin((i / 8) * Math.PI) * w * 0.08] as P2)
    const out = [...top, ...pts.slice(1, -1)]
    paint(k, m, out.map(([x, yy]): P2 => [x * 1.12, y + (yy - y) * 1.12 - w * 0.01]), INK, 0.003, true)
    paint(k, m, out, MOUTH, 0.005, true)
    paint(k, m, oval(0, y - w * 0.42, w * 0.45, w * 0.2, 0, 12), TONGUE, 0.007, true)
  } else {
    line(k, m, arc(0, y + w * 0.55, w, w * 0.62, Math.PI * 1.12, Math.PI * 1.88, 12), thick, 0.004)
  }
}

/** the win face: happy ^ ^ eyes (on a VKit of their own, shown instead of the button eyes) and an open mouth over the smile */
function joyFace(f: FaceSpec) {
  const k = new VKit(INK)
  for (const s of [-1, 1]) {
    const x = s * f.eyeX
    line(k, f.head, arc(x, f.eyeY - f.eyeR[1] * 0.35, f.eyeR[0] * 1.05, f.eyeR[1] * 0.85, Math.PI * 0.92, Math.PI * 0.08, 12), f.eyeR[0] * 0.55, 0.007)
  }
  const m = f.muzzle ?? f.head
  const w = f.mouthW * 1.05
  const y = f.mouthY + f.mouthW * 0.25
  const xs = Array.from({ length: 13 }, (_, i) => -w + (2 * w * i) / 12)
  const out: P2[] = [...xs.map((x): P2 => [x, y]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, y - w * 1.05 * Math.sqrt(Math.max(0, 1 - (x / w) ** 2))])]
  paint(k, m, out.map(([x, yy]): P2 => [x * 1.14, y + (yy - y) * 1.14 + w * 0.04]), INK, 0.008, true)
  paint(k, m, out, MOUTH, 0.01, true)
  paint(k, m, oval(0, y - w * 0.72, w * 0.52, w * 0.3, 0, 12), TONGUE, 0.012, true)
  return k
}

function blush(k: VKit, f: FaceSpec, color = BLUSH) {
  if (f.blushX == null) return
  const y = f.blushY ?? f.eyeY - f.eyeR[1] * 1.6
  for (const s of [-1, 1]) paint(k, f.head, oval(s * f.blushX, y, f.eyeR[0] * 1.25, f.eyeR[1] * 0.62, 0, 14), color, 0.003)
}

/* ---------------- felt details ---------------- */

/** a row of little stitches along a path on a surface, the seams that make a plushie */
function stitches(k: VKit, e: Ell, path: P2[], color: string, len = 0.022, gap = 0.016, w = 0.009) {
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1]
    const [bx, by] = path[i]
    const d = Math.hypot(bx - ax, by - ay)
    let t = 0
    while (t < d) {
      const s0 = (acc + t) % (len + gap)
      if (s0 < len) {
        const u0 = t / d
        const u1 = Math.min(1, (t + Math.min(len - s0, d - t)) / d)
        line(k, e, [[ax + (bx - ax) * u0, ay + (by - ay) * u0], [ax + (bx - ax) * u1, ay + (by - ay) * u1]], w, 0.004, color, 0)
        t += Math.min(len - s0, d - t) + 1e-4
      } else t += len + gap - s0
    }
    acc += d
  }
}

/** a sitting plushie's lower half: tummy, feet with paw pads and stubby arms */
interface BodySpec {
  color: string
  belly?: string
  pad?: string
  body?: Ell
  arms?: boolean
  feet?: boolean
  armColor?: string
}
function sitBody(k: VKit, b: BodySpec) {
  const body: Ell = b.body ?? { c: [0, 0.25, 0], r: [0.25, 0.25, 0.22] }
  ell(k, body, b.color)
  if (b.belly) paint(k, body, oval(0, body.c[1] - 0.03, body.r[0] * 0.6, body.r[1] * 0.56, 0, 20), b.belly, 0.003)
  if (b.feet !== false)
    for (const s of [-1, 1]) {
      const foot: Ell = { c: [s * 0.125, 0.065, 0.13], r: [0.085, 0.068, 0.105] }
      ell(k, foot, b.color)
      // the sole faces the front, with a paw pad
      const sole: Ell = { c: [foot.c[0], foot.c[1], foot.c[2]], r: [foot.r[0], foot.r[1], foot.r[2]] }
      if (b.pad) {
        paint(k, sole, oval(foot.c[0], foot.c[1] - 0.004, 0.044, 0.036, 0, 14), b.pad, 0.003)
        for (const t of [-1, 0, 1]) paint(k, sole, oval(foot.c[0] + t * 0.03, foot.c[1] + 0.04, 0.013, 0.011, 0, 8), b.pad, 0.003)
      }
    }
  if (b.arms !== false)
    for (const s of [-1, 1]) limb(k, [s * 0.18, 0.34, 0.06], [s * 0.255, 0.2, 0.12], 0.06, b.armColor ?? b.color)
  return body
}

/** the string the tag hangs from: round the neck and down to the tag's eyelet */
function tagString(k: VKit, neckY: number, neckZ: number, tagY: number, tagZ: number, color = '#ff4f7b') {
  const pts = [V(-0.11, neckY, neckZ - 0.02), V(-0.05, neckY - 0.03, neckZ + 0.03), V(0, tagY + 0.075, tagZ + 0.012), V(0.05, neckY - 0.03, neckZ + 0.03), V(0.11, neckY, neckZ - 0.02)]
  k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.009, 5, false), color, undefined, 0)
}

/* ------------------------------------------------------------------ */
/*  The prize cast                                                      */
/* ------------------------------------------------------------------ */

export interface PlushModel {
  body: VKit
  eyes: VKit
  blink: VKit
  joy: VKit
  /** the height of the top of its head (where the claw closes) and of its tag */
  top: number
  tagY: number
  tagZ: number
  /** a golden one */
  gold?: boolean
}

function finish(body: VKit, f: FaceSpec, top: number, tagY: number, tagZ: number, gold = false): PlushModel {
  mouth(body, f)
  blush(body, f)
  return { body, eyes: buttonEyes(f), blink: blinkEyes(f), joy: joyFace(f), top, tagY, tagZ, gold }
}

/** Biscuit, a caramel teddy with a red bow tie */
function buildBear(): PlushModel {
  const col = '#c98a4b'
  const light = '#f5d9ac'
  const k = new VKit(INK)
  sitBody(k, { color: col, belly: light, pad: light })
  const head: Ell = { c: [0, 0.6, 0.02], r: [0.27, 0.235, 0.23] }
  ell(k, head, col)
  for (const s of [-1, 1]) {
    ell(k, { c: [s * 0.2, 0.79, -0.02], r: [0.088, 0.088, 0.06] }, col)
    ell(k, { c: [s * 0.2, 0.788, 0.012], r: [0.05, 0.05, 0.035] }, light, 0)
  }
  const muzzle: Ell = { c: [0, 0.535, 0.195], r: [0.11, 0.08, 0.07] }
  ell(k, muzzle, light, 0.012)
  ell(k, { c: [0, 0.57, 0.258], r: [0.042, 0.03, 0.026] }, '#4a2a1a', 0.008)
  k.add(new THREE.SphereGeometry(0.009, 6, 4), SPARK, T([-0.014, 0.582, 0.282]), 0, true)
  line(k, muzzle, [[0, 0.545], [0, 0.515]], 0.012, 0.004)
  // the bow tie
  for (const s of [-1, 1]) horn(k, [s * 0.1, 0.405, 0.215], [s * 0.012, 0.405, 0.225], 0.05, '#ff3d5e', 0.01, 10)
  ell(k, { c: [0, 0.405, 0.228], r: [0.03, 0.03, 0.022] }, '#e02848', 0.008)
  stitches(k, head, [[0, 0.82], [0, 0.73]], shade(col, 0.72))
  const f: FaceSpec = { head, eyeX: 0.1, eyeY: 0.64, eyeR: [0.034, 0.042], muzzle, mouthY: 0.508, mouthW: 0.04, mouth: 'w', blushX: 0.165, blushY: 0.565 }
  return finish(k, f, 0.86, 0.22, 0.255)
}

/** Clover, a cream bunny with one floppy ear */
function buildBunny(): PlushModel {
  const col = '#f7eef3'
  const pink = '#ffb3cf'
  const k = new VKit(INK)
  sitBody(k, { color: col, belly: '#ffffff', pad: pink })
  const head: Ell = { c: [0, 0.6, 0.02], r: [0.26, 0.235, 0.225] }
  ell(k, head, col)
  // the left ear stands up, the right one flops over at the middle
  limb(k, [-0.1, 0.78, -0.02], [-0.13, 1.08, -0.05], 0.058, col)
  ell(k, { c: [-0.118, 0.94, 0.012], r: [0.032, 0.12, 0.012] }, pink, 0, [0, 0, 0.1])
  limb(k, [0.1, 0.78, -0.02], [0.13, 0.95, -0.04], 0.058, col)
  limb(k, [0.135, 0.96, -0.04], [0.28, 0.9, -0.02], 0.056, col)
  ell(k, { c: [0.116, 0.875, 0.014], r: [0.03, 0.07, 0.012] }, pink, 0, [0, 0, -0.15])
  const nose: Ell = { c: [0, 0.575, 0.245], r: [0.03, 0.022, 0.016] }
  ell(k, nose, '#ff7fa8', 0.008)
  line(k, head, [[0, 0.555], [0, 0.535]], 0.011, 0.004)
  // two buck teeth
  k.add(new THREE.BoxGeometry(0.022, 0.026, 0.008), '#ffffff', T([-0.0125, 0.505, surfaceZ(head, 0, 0.505) + 0.002], [-0.5, 0, 0]), 0.006)
  k.add(new THREE.BoxGeometry(0.022, 0.026, 0.008), '#ffffff', T([0.0125, 0.505, surfaceZ(head, 0, 0.505) + 0.002], [-0.5, 0, 0]), 0.006)
  const f: FaceSpec = { head, eyeX: 0.098, eyeY: 0.635, eyeR: [0.033, 0.042], mouthY: 0.524, mouthW: 0.034, mouth: 'w', blushX: 0.16, blushY: 0.57, lashes: true }
  return finish(k, f, 0.86, 0.22, 0.255)
}

/** Pickle, a frog with big eyes on top of his head and a wide grin */
function buildFrog(): PlushModel {
  const col = '#6cd35b'
  const belly = '#d8f59c'
  const k = new VKit(INK)
  sitBody(k, { color: col, belly, pad: belly, body: { c: [0, 0.24, 0], r: [0.26, 0.24, 0.22] } })
  const head: Ell = { c: [0, 0.56, 0.02], r: [0.3, 0.2, 0.235] }
  ell(k, head, col)
  // eye bumps
  const bumps: Ell[] = [-1, 1].map((s) => ({ c: [s * 0.135, 0.71, 0.06], r: [0.1, 0.095, 0.09] }))
  for (const b of bumps) ell(k, b, col)
  // spots
  for (const [x, y, r] of [[-0.2, 0.6, 0.026], [0.21, 0.63, 0.02], [0.17, 0.52, 0.016]] as const) paint(k, head, oval(x, y, r, r * 0.85, 0, 10), shade(col, 0.78), 0.003)
  paint(k, { c: [0, 0.24, 0], r: [0.26, 0.24, 0.22] }, oval(-0.17, 0.33, 0.02, 0.018, 0, 10), shade(col, 0.78), 0.003)
  // the eyes sit on the bumps, so they get a face of their own
  const eyesK = new VKit(INK)
  const blinkK = new VKit(INK)
  const joyK = new VKit(INK)
  for (const [i, s] of [-1, 1].entries()) {
    const b = bumps[i]
    const x = s * 0.135
    const y = 0.715
    // the white of the eye is part of the body, the pupil the eye
    paint(k, b, oval(x, y, 0.062, 0.066, 0, 18), '#ffffff', 0.003)
    const pupil: Ell = { c: [x + 0.008, y - 0.004, surfaceZ(b, x, y) - 0.01], r: [0.036, 0.042, 0.025] }
    eyesK.add(new THREE.SphereGeometry(1, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2), BUTTON, T(pupil.c, [Math.PI / 2, 0, 0], [pupil.r[0], pupil.r[2], pupil.r[1]]), 0.007)
    eyesK.decal(pupil, ellipsePts(pupil.c[0] - 0.012, pupil.c[1] + 0.014, 0.011, 0.01, 10), SPARK, 0.004, 0)
    paint(blinkK, b, oval(x, y, 0.066, 0.07, 0, 18), col, 0.006)
    line(blinkK, b, arc(x, y + 0.005, 0.05, 0.03, Math.PI * 1.05, Math.PI * 1.95, 10), 0.016, 0.008)
    paint(joyK, b, oval(x, y, 0.066, 0.07, 0, 18), col, 0.006)
    line(joyK, b, arc(x, y - 0.02, 0.048, 0.042, Math.PI * 0.92, Math.PI * 0.08, 10), 0.018, 0.008)
  }
  const f: FaceSpec = { head, eyeX: 0.135, eyeY: 0.715, eyeR: [0.04, 0.045], mouthY: 0.5, mouthW: 0.15, mouth: 'smile', blushX: 0.205, blushY: 0.535 }
  // a wide smile across the whole head
  line(k, head, arc(0, 0.6, 0.17, 0.1, Math.PI * 1.15, Math.PI * 1.85, 14), 0.016, 0.004)
  blush(k, f)
  // the frog's joy: the grin opens
  const jw = 0.12
  const jy = 0.525
  const xs = Array.from({ length: 13 }, (_, i) => -jw + (2 * jw * i) / 12)
  const out: P2[] = [...xs.map((x): P2 => [x, jy]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, jy - jw * 0.7 * Math.sqrt(Math.max(0, 1 - (x / jw) ** 2))])]
  paint(joyK, head, out.map(([x, yy]): P2 => [x * 1.1, jy + (yy - jy) * 1.14 + 0.004]), INK, 0.008, true)
  paint(joyK, head, out, MOUTH, 0.01, true)
  paint(joyK, head, oval(0, jy - 0.06, 0.05, 0.024, 0, 12), TONGUE, 0.012, true)
  return { body: k, eyes: eyesK, blink: blinkK, joy: joyK, top: 0.8, tagY: 0.21, tagZ: 0.255 }
}

/** Pip, a navy penguin in a striped red scarf */
function buildPenguin(): PlushModel {
  const col = '#33497e'
  const white = '#fbf7ef'
  const orange = '#ffa62b'
  const k = new VKit(INK)
  const body: Ell = { c: [0, 0.4, 0], r: [0.28, 0.4, 0.25] }
  ell(k, body, col, undefined, [0, 0, 0], [26, 20])
  // the white face and tummy
  const mask: P2[] = []
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2
    // a heart-ish mask: two lobes for the eyes, a point between them on top
    const r = 0.165 + 0.035 * Math.cos(2 * t) - 0.03 * Math.max(0, Math.sin(t)) ** 8
    mask.push([Math.cos(t) * r * 1.05, 0.56 + Math.sin(t) * r * 0.78])
  }
  paint(k, body, mask, white, 0.003)
  paint(k, body, oval(0, 0.22, 0.17, 0.18, 0, 22), white, 0.003)
  // flippers
  for (const s of [-1, 1]) ell(k, { c: [s * 0.27, 0.3, 0.02], r: [0.05, 0.16, 0.09] }, shade(col, 0.9), undefined, [0, 0, s * 0.45])
  // feet
  for (const s of [-1, 1]) ell(k, { c: [s * 0.11, 0.035, 0.15], r: [0.08, 0.035, 0.09] }, orange)
  // beak
  horn(k, [0, 0.505, 0.21], [0, 0.49, 0.32], 0.045, orange, 0.01, 12)
  // the scarf: a band round the neck and a tail hanging down the front
  k.add(new THREE.TorusGeometry(0.235, 0.045, 10, 30), '#ff3d5e', T([0, 0.42, 0.0], [Math.PI / 2, 0, 0], [1, 1.02, 1]), 0.012)
  for (const a of [-0.9, -0.3, 0.3, 0.9]) k.add(new THREE.TorusGeometry(0.046, 0.012, 6, 12), '#ffffff', T([Math.sin(a) * 0.235, 0.42, Math.cos(a) * 0.235], [0, a, 0]), 0)
  limb(k, [0.12, 0.42, 0.21], [0.16, 0.25, 0.245], 0.042, '#ff3d5e', 0.012)
  for (const y of [0.37, 0.3]) k.add(new THREE.TorusGeometry(0.043, 0.01, 6, 12), '#ffffff', T([0.12 + (0.42 - y) * 0.24, y, 0.215 + (0.42 - y) * 0.2], [Math.PI / 2 - 0.25, 0, 0.2]), 0)
  const f: FaceSpec = { head: body, eyeX: 0.08, eyeY: 0.59, eyeR: [0.032, 0.04], mouthY: 0.46, mouthW: 0.03, mouth: 'smile', blushX: 0.15, blushY: 0.52 }
  // no mouth line under the beak
  const eyes = buttonEyes(f)
  blush(k, f)
  return { body: k, eyes, blink: blinkEyes(f), joy: penguinJoy(f), top: 0.8, tagY: 0.2, tagZ: 0.262 }
}

function penguinJoy(f: FaceSpec) {
  const k = new VKit(INK)
  for (const s of [-1, 1]) {
    const x = s * f.eyeX
    line(k, f.head, arc(x, f.eyeY - f.eyeR[1] * 0.35, f.eyeR[0] * 1.05, f.eyeR[1] * 0.85, Math.PI * 0.92, Math.PI * 0.08, 12), f.eyeR[0] * 0.55, 0.007)
  }
  return k
}

/** Mochi, a ginger cat with forehead stripes, whiskers and a curly tail */
function buildCat(): PlushModel {
  const col = '#ff9b4a'
  const cream = '#fff0d9'
  const stripe = '#e26d22'
  const k = new VKit(INK)
  const body = sitBody(k, { color: col, belly: cream, pad: '#ffb3c6' })
  const head: Ell = { c: [0, 0.6, 0.02], r: [0.27, 0.235, 0.23] }
  ell(k, head, col)
  for (const s of [-1, 1]) {
    horn(k, [s * 0.16, 0.74, -0.01], [s * 0.24, 0.93, -0.02], 0.085, col, undefined, 14)
    horn(k, [s * 0.165, 0.765, 0.035], [s * 0.225, 0.89, 0.025], 0.045, '#ffb3c6', 0, 12)
  }
  // forehead stripes
  for (const [x, l] of [[-0.05, 0.07], [0, 0.085], [0.05, 0.07]] as const) line(k, head, [[x, 0.8], [x * 0.9, 0.8 - l]], 0.022, 0.003, stripe, 0.45)
  for (const s of [-1, 1]) line(k, head, [[s * 0.255, 0.62], [s * 0.2, 0.615]], 0.018, 0.003, stripe, 0.45)
  // arm stripes
  for (const s of [-1, 1]) for (const y of [0.29, 0.25]) k.add(new THREE.TorusGeometry(0.058, 0.008, 5, 14), stripe, T([s * (0.18 + (0.34 - y) * 0.53), y, 0.06 + (0.34 - y) * 0.43], [Math.PI / 2 - 0.6, 0, s * 0.5]), 0)
  const muzzle: Ell = { c: [0, 0.535, 0.19], r: [0.1, 0.07, 0.065] }
  ell(k, muzzle, cream, 0.01)
  paint(k, muzzle, [[-0.022, 0.572], [0.022, 0.572], [0, 0.55]], '#ff7fa8', 0.004, false)
  line(k, muzzle, [[0, 0.552], [0, 0.535]], 0.011, 0.004)
  // whiskers
  for (const s of [-1, 1])
    for (const [dy, a] of [[0.012, 0.12], [-0.012, -0.1]] as const) line(k, head, [[s * 0.11, 0.53 + dy], [s * 0.2, 0.53 + dy + a * 0.12 + 0.006], [s * 0.25, 0.53 + dy + a * 0.2 + 0.01]], 0.007, 0.004, INK, 0.2)
  // the tail curls up behind the right side
  const tail = new THREE.CatmullRomCurve3([V(0.12, 0.08, -0.18), V(0.3, 0.12, -0.12), V(0.36, 0.3, -0.04), V(0.31, 0.45, 0.02), V(0.36, 0.53, 0.06)])
  k.add(new THREE.TubeGeometry(tail, 24, 0.045, 10, false), col)
  ell(k, { c: [0.36, 0.535, 0.06], r: [0.05, 0.05, 0.05] }, cream)
  void body
  const f: FaceSpec = { head, eyeX: 0.1, eyeY: 0.64, eyeR: [0.034, 0.044], muzzle, mouthY: 0.522, mouthW: 0.035, mouth: 'w', blushX: 0.17, blushY: 0.57 }
  return finish(k, f, 0.86, 0.22, 0.255)
}

/** Rex, a mint dino with an orange crest down his back and a little tail */
function buildDino(): PlushModel {
  const col = '#4fd6b0'
  const belly = '#fff1b0'
  const spike = '#ffb43c'
  const k = new VKit(INK)
  const body = sitBody(k, { color: col, belly, pad: belly })
  // belly stripes
  for (const y of [0.17, 0.24, 0.31]) line(k, body, [[-0.1 + Math.abs(y - 0.24) * 0.6, y], [0.1 - Math.abs(y - 0.24) * 0.6, y]], 0.008, 0.005, shade(belly, 0.82), 0.2)
  const head: Ell = { c: [0, 0.61, 0.0], r: [0.26, 0.23, 0.23] }
  ell(k, head, col)
  const snout: Ell = { c: [0, 0.54, 0.15], r: [0.2, 0.12, 0.12] }
  ell(k, snout, col)
  for (const s of [-1, 1]) paint(k, snout, oval(s * 0.045, 0.575, 0.013, 0.009, 0, 10), shade(col, 0.6), 0.004)
  // the crest: spikes over the head and down the back
  const crest: [number, number, number, number][] = [
    [0.85, -0.06, 0.06, 0.1],
    [0.8, -0.16, 0.055, 0.1],
    [0.7, -0.22, 0.05, 0.09],
    [0.52, -0.24, 0.05, 0.085],
    [0.34, -0.22, 0.045, 0.075],
  ]
  for (const [y, z, r, h] of crest) {
    const n = V(0, y - 0.45, z).normalize()
    horn(k, [0, y, z], [0, y + n.y * h, z + n.z * h], r, spike, undefined, 10)
  }
  horn(k, [0, 0.83, 0.05], [0, 0.93, 0.08], 0.05, spike, undefined, 10)
  // the tail pokes out to the right
  horn(k, [0.16, 0.1, -0.12], [0.44, 0.06, -0.06], 0.1, col, undefined, 14)
  for (const [x, y] of [[0.3, 0.13], [0.38, 0.1]] as const) horn(k, [x, y + 0.02, -0.08], [x + 0.01, y + 0.08, -0.08], 0.025, spike, 0.01, 8)
  const f: FaceSpec = { head, eyeX: 0.1, eyeY: 0.68, eyeR: [0.034, 0.044], muzzle: snout, mouthY: 0.515, mouthW: 0.085, mouth: 'smile', blushX: 0.17, blushY: 0.6 }
  // two little teeth hang off the smile
  for (const s of [-1, 1]) paint(k, snout, [[s * 0.03 - 0.011, 0.497], [s * 0.03 + 0.011, 0.497], [s * 0.03, 0.478]], '#ffffff', 0.006, true)
  return finish(k, f, 0.86, 0.22, 0.255)
}

/** Inky, a pink octopus with a polka-dot dome, curly arms and a sailor bow */
function buildOctopus(): PlushModel {
  const col = '#ff5fa8'
  const dot = '#ffa3cf'
  const k = new VKit(INK)
  const dome: Ell = { c: [0, 0.5, 0], r: [0.3, 0.33, 0.27] }
  ell(k, dome, col, undefined, [0, 0, 0], [26, 20])
  for (const [x, y, r] of [[-0.18, 0.7, 0.035], [0.15, 0.76, 0.03], [0.21, 0.6, 0.022], [-0.06, 0.8, 0.022], [-0.22, 0.52, 0.02]] as const)
    paint(k, dome, oval(x, y, r, r * 0.9, 0, 12), dot, 0.003)
  // six chubby arms spreading out from under the dome, thinning to tips that curl up and out
  for (let i = 0; i < 6; i++) {
    const a = ((i + 0.5) / 6) * Math.PI * 2
    const dx = Math.sin(a)
    const dz = Math.cos(a)
    const front = dz > 0
    const curve = new THREE.CatmullRomCurve3([
      V(dx * 0.13, 0.2, dz * 0.12),
      V(dx * 0.25, 0.07, dz * 0.23),
      V(dx * 0.37, 0.045, dz * 0.33),
      V(dx * 0.46, 0.09, dz * 0.41),
      V(dx * 0.47, 0.16, dz * 0.42),
    ])
    k.add(taperTube(curve, front ? 0.075 : 0.065, 0.026, 26, 12), col)
    if (front)
      for (const t of [0.42, 0.62, 0.8]) {
        const p = curve.getPoint(t)
        k.add(new THREE.SphereGeometry(0.014 - t * 0.006, 6, 4), dot, T([p.x, p.y - 0.035 + t * 0.012, p.z + 0.03]), 0)
      }
  }
  // a sailor bow on top
  for (const s of [-1, 1]) ell(k, { c: [0.13 + s * 0.06, 0.8, 0.06], r: [0.06, 0.04, 0.03] }, '#7b5cff', 0.01, [0, 0, s * 0.35])
  ell(k, { c: [0.13, 0.8, 0.075], r: [0.024, 0.024, 0.02] }, '#5b3fe0', 0.008)
  const f: FaceSpec = { head: dome, eyeX: 0.105, eyeY: 0.53, eyeR: [0.04, 0.05], mouthY: 0.43, mouthW: 0.035, mouth: 'smile', blushX: 0.19, blushY: 0.46, lashes: true }
  return finish(k, f, 0.83, 0.235, 0.27)
}

/** Goldie, the golden unicorn: rainbow mane, a spiral horn and hearts on her hooves */
function buildUnicorn(): PlushModel {
  const col = '#ffcc33'
  const cream = '#fff4d9'
  const k = new VKit(INK)
  sitBody(k, { color: col, belly: cream, pad: '#ff8fc4' })
  const head: Ell = { c: [0, 0.62, -0.01], r: [0.25, 0.235, 0.22] }
  ell(k, head, col)
  const muzzle: Ell = { c: [0, 0.535, 0.16], r: [0.15, 0.1, 0.1] }
  ell(k, muzzle, cream)
  for (const s of [-1, 1]) paint(k, muzzle, oval(s * 0.05, 0.55, 0.014, 0.01, 0, 10), '#e6a25a', 0.004)
  for (const s of [-1, 1]) {
    horn(k, [s * 0.15, 0.78, -0.04], [s * 0.2, 0.92, -0.05], 0.055, col, undefined, 12)
    horn(k, [s * 0.153, 0.79, -0.012], [s * 0.19, 0.885, -0.02], 0.028, '#ff9fd0', 0, 10)
  }
  // the horn: a pearly cone with a gold spiral round it
  horn(k, [0, 0.8, 0.05], [0, 1.04, 0.1], 0.052, '#fff8e8', undefined, 16)
  const spiral = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32
    const a = t * Math.PI * 6
    const r = 0.054 * (1 - t) + 0.006
    return V(Math.cos(a) * r, 0.8 + t * 0.235, 0.05 + t * 0.05 + Math.sin(a) * r)
  })
  k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(spiral), 48, 0.009, 5, false), '#ffb300', undefined, 0)
  // the mane: rainbow curls from the brow over the head and down the back, peeking out at both sides
  const mane = ['#ff5f8f', '#ff9a3c', '#ffe04a', '#5fe08c', '#4fb8ff', '#a77dff']
  const maneAt: [number, number, number, number][] = [
    [0.0, 0.86, 0.02, 0.065],
    [0.02, 0.88, -0.07, 0.07],
    [-0.02, 0.84, -0.15, 0.072],
    [0.0, 0.76, -0.21, 0.074],
    [0.0, 0.65, -0.24, 0.072],
    [0.0, 0.54, -0.24, 0.068],
  ]
  maneAt.forEach(([x, y, z, r], i) => ell(k, { c: [x, y, z], r: [r * 1.15, r, r] }, mane[i], undefined, [0, 0, 0], [14, 10]))
  for (const sx of [-1, 1])
    for (const [x, y, z, r, c] of [[0.2, 0.8, -0.06, 0.062, 1], [0.25, 0.7, -0.07, 0.062, 3], [0.26, 0.59, -0.08, 0.058, 5], [0.24, 0.49, -0.1, 0.052, 2]] as const)
      ell(k, { c: [sx * x, y, z], r: [r, r, r] }, mane[(c + (sx > 0 ? 1 : 0)) % 6], undefined, [0, 0, 0], [12, 8])
  // a forelock over the brow
  ell(k, { c: [-0.07, 0.8, 0.1], r: [0.055, 0.045, 0.04] }, mane[0], undefined, [0, 0, 0.4], [14, 10])
  ell(k, { c: [0.07, 0.805, 0.095], r: [0.05, 0.042, 0.038] }, mane[4], undefined, [0, 0, -0.4], [14, 10])
  // the tail: a rainbow plume sweeping up behind the left side
  for (let i = 0; i < 5; i++) ell(k, { c: [-0.26 - i * 0.03, 0.08 + i * 0.075, -0.14 + i * 0.01], r: [0.07 - i * 0.004, 0.07 - i * 0.004, 0.07] }, mane[(i + 1) % 6], undefined, [0, 0, 0], [14, 10])
  // little sparkles on the hooves and the cheeks: gold stars
  for (const sx of [-1, 1]) paint(k, head, starPts(sx * 0.165, 0.6, 0.026), '#ff9fd0', 0.004)
  // star cheeks
  const f: FaceSpec = { head, eyeX: 0.1, eyeY: 0.665, eyeR: [0.036, 0.046], muzzle, mouthY: 0.505, mouthW: 0.04, mouth: 'smile', lashes: true }
  return finish(k, f, 0.86, 0.22, 0.255, true)
}

const BUILD: Record<PrizeId, () => PlushModel> = {
  bear: buildBear,
  bunny: buildBunny,
  frog: buildFrog,
  penguin: buildPenguin,
  cat: buildCat,
  dino: buildDino,
  octopus: buildOctopus,
  unicorn: buildUnicorn,
}

/* ------------------------------------------------------------------ */
/*  Tags                                                                */
/* ------------------------------------------------------------------ */

export const TAG_W = 0.46
export const TAG_H = 0.23
/** the plushies are modelled about 0.9 tall and drawn this much bigger in the machine */
export const PLUSH_SCALE = 1.15
const SLOT_W = 512
const SLOT_H = 256

/** draws every prize's tag into one 1024 × 1024 atlas: two columns of four 512 × 256 pills */
export function tagTexture() {
  if (tagTex) return tagTex
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const g = c.getContext('2d')!
  PRIZES.forEach((p, i) => {
    const x0 = (i % 2) * SLOT_W
    const y0 = Math.floor(i / 2) * SLOT_H
    const pad = 14
    const w = SLOT_W - pad * 2
    const h = SLOT_H - pad * 2
    const r = h / 2
    const pill = () => {
      g.beginPath()
      g.roundRect(x0 + pad, y0 + pad, w, h, r)
    }
    const golden = p.id === 'unicorn'
    const grad = g.createLinearGradient(0, y0 + pad, 0, y0 + pad + h)
    if (golden) {
      grad.addColorStop(0, '#fff3b0')
      grad.addColorStop(0.45, '#ffcf3a')
      grad.addColorStop(1, '#f09a10')
    } else {
      grad.addColorStop(0, tint(p.tag, '#ffffff', 0.35))
      grad.addColorStop(0.55, p.tag)
      grad.addColorStop(1, shade(p.tag, 0.82))
    }
    pill()
    g.fillStyle = grad
    g.fill()
    if (golden) {
      // a rainbow inner ring
      const rg = g.createLinearGradient(x0, 0, x0 + SLOT_W, 0)
      ;['#ff5f8f', '#ffe04a', '#5fe08c', '#4fb8ff', '#a77dff'].forEach((col, j, a) => rg.addColorStop(j / (a.length - 1), col))
      g.beginPath()
      g.roundRect(x0 + pad + 16, y0 + pad + 16, w - 32, h - 32, r - 16)
      g.lineWidth = 9
      g.strokeStyle = rg
      g.stroke()
    }
    // a soft shine along the top
    g.save()
    pill()
    g.clip()
    g.fillStyle = 'rgba(255,255,255,0.32)'
    g.beginPath()
    g.ellipse(x0 + SLOT_W / 2, y0 + pad + 26, w * 0.38, 26, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
    pill()
    g.lineWidth = 16
    g.strokeStyle = INK
    g.stroke()
    // the eyelet the string goes through
    g.beginPath()
    g.arc(x0 + SLOT_W / 2, y0 + pad + 28, 13, 0, Math.PI * 2)
    g.fillStyle = INK
    g.fill()
    g.beginPath()
    g.arc(x0 + SLOT_W / 2, y0 + pad + 28, 6, 0, Math.PI * 2)
    g.fillStyle = shade(p.tag, 0.6)
    g.fill()
    // the multiplier
    const text = `${p.mult}×`
    let size = 156
    g.font = `800 ${size}px Manrope, ui-rounded, system-ui, sans-serif`
    while (g.measureText(text).width > w - 70 && size > 80) g.font = `800 ${(size -= 6)}px Manrope, ui-rounded, system-ui, sans-serif`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    const ty = y0 + SLOT_H / 2 + 14
    g.lineWidth = 26
    g.strokeStyle = INK
    g.strokeText(text, x0 + SLOT_W / 2, ty)
    g.fillStyle = '#ffffff'
    g.fillText(text, x0 + SLOT_W / 2, ty)
  })
  tagTex = new THREE.CanvasTexture(c)
  tagTex.colorSpace = THREE.SRGBColorSpace
  tagTex.anisotropy = 4
  return tagTex
}

function tagMaterial() {
  return (tagMat ??= new THREE.MeshBasicMaterial({ map: tagTexture(), transparent: true, alphaTest: 0.5 }))
}

/** a tag for prize i: a plane cut from its slot of the atlas, hanging a little tilted back */
function tagMesh(i: number) {
  const g = new THREE.PlaneGeometry(TAG_W, TAG_H)
  const uv = g.getAttribute('uv') as THREE.BufferAttribute
  const u0 = (i % 2) * 0.5
  const v1 = 1 - Math.floor(i / 2) * 0.25
  for (let j = 0; j < uv.count; j++) uv.setXY(j, u0 + uv.getX(j) * 0.5, v1 - 0.25 + uv.getY(j) * 0.25)
  const m = new THREE.Mesh(g, tagMaterial())
  m.name = 'tag'
  return m
}

/* ------------------------------------------------------------------ */
/*  Rigs                                                                */
/* ------------------------------------------------------------------ */

/** a plushie the scene animates: `root` sits on the pile, `body` squashes about the base, and the face parts swap */
export interface PlushRig {
  id: PrizeId
  root: THREE.Group
  body: THREE.Group
  eyes: THREE.Object3D
  blink: THREE.Object3D
  joy: THREE.Object3D
  tag: THREE.Object3D
  halo: THREE.Sprite | null
  top: number
}

const protos = new Map<PrizeId, THREE.Group>()
function proto(id: PrizeId) {
  let p = protos.get(id)
  if (p) return p
  const m = BUILD[id]()
  const mat = m.gold ? goldMaterial() : feltMaterial()
  p = new THREE.Group()
  p.name = id
  const body = new THREE.Group()
  body.name = 'body'
  body.add(m.body.mesh('felt', mat))
  const eyes = m.eyes.mesh('eyes', feltMaterial())
  const blink = m.blink.mesh('blink', feltMaterial())
  const joy = m.joy.mesh('joy', feltMaterial())
  blink.visible = false
  joy.visible = false
  body.add(eyes, blink, joy)
  // the tag hangs on a string round the neck
  const k = new VKit(INK)
  tagString(k, m.top * 0.48 + 0.02, 0.14, m.tagY, m.tagZ)
  body.add(k.mesh('string', feltMaterial()))
  const tag = tagMesh(PRIZES.findIndex((x) => x.id === id))
  tag.position.set(0, m.tagY, m.tagZ)
  tag.rotation.x = -0.12
  body.add(tag)
  if (m.gold) {
    const halo = new THREE.Sprite(haloMaterial())
    halo.name = 'halo'
    halo.scale.setScalar(1.5)
    halo.position.set(0, 0.48, -0.25)
    body.add(halo)
  }
  const size = new THREE.Group()
  size.name = 'size'
  size.scale.setScalar(PLUSH_SCALE)
  size.add(body)
  p.add(size)
  p.userData.top = m.top * PLUSH_SCALE
  protos.set(id, p)
  return p
}

/** a fresh copy of a prize plushie, sharing geometry and materials with every other copy */
export function buildPlush(id: PrizeId): PlushRig {
  const root = proto(id).clone()
  const body = root.getObjectByName('body') as THREE.Group
  return {
    id,
    root,
    body,
    eyes: body.getObjectByName('eyes')!,
    blink: body.getObjectByName('blink')!,
    joy: body.getObjectByName('joy')!,
    tag: body.getObjectByName('tag')!,
    halo: (body.getObjectByName('halo') as THREE.Sprite) ?? null,
    top: root.userData.top as number,
  }
}

/* ------------------------------------------------------------------ */
/*  Filler plushies and the heap                                       */
/* ------------------------------------------------------------------ */

export const FILLER_COLORS = ['#ffb3d1', '#a8e6ff', '#c9b8ff', '#ffe08a', '#b8f2c8', '#ffc8a8', '#ff9ec4', '#9fd8ff']
/** round ears, bunny ears, a tuft, a star pillow or a heart pillow */
export type FillerKind = 0 | 1 | 2 | 3 | 4

const fillerGeos = new Map<string, Geo>()
/** a puffy pillow in the shape of `shape`, about 0.42 across, with a little face */
function pillow(k: VKit, shape: THREE.Shape, color: string) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 3, curveSegments: 10 })
  g.translate(0, 0, -0.03)
  k.add(smooth(g), color)
  const face: Ell = { c: [0, 0, 0.1 - 0.6], r: [3, 3, 0.6] }
  for (const s of [-1, 1]) paint(k, face, oval(s * 0.06, 0.02, 0.016, 0.022, 0, 10), BUTTON, 0.006, true)
  line(k, face, arc(0, -0.01, 0.028, 0.02, Math.PI * 1.15, Math.PI * 1.85, 8), 0.011, 0.006)
  for (const s of [-1, 1]) paint(k, face, oval(s * 0.1, -0.025, 0.022, 0.012, 0, 10), BLUSH, 0.005)
}

/** a little blob buddy (round ears, bunny ears or a tuft) or a star or heart pillow; about 0.4 across, centred */
export function fillerGeometry(color: string, kind: FillerKind) {
  const key = `${color}${kind}`
  let g = fillerGeos.get(key)
  if (g) return g
  const k = new VKit(INK)
  if (kind === 3 || kind === 4) {
    const sh = new THREE.Shape()
    if (kind === 3)
      for (let i = 0; i < 10; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? 0.085 : 0.19
        if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r)
        else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r)
      }
    else {
      sh.moveTo(0, -0.15)
      sh.bezierCurveTo(-0.22, 0.0, -0.17, 0.17, 0, 0.08)
      sh.bezierCurveTo(0.17, 0.17, 0.22, 0.0, 0, -0.15)
    }
    pillow(k, sh, color)
    g = k.geometry()
    fillerGeos.set(key, g)
    return g
  }
  const body: Ell = { c: [0, 0, 0], r: [0.2, 0.18, 0.18] }
  ell(k, body, color, undefined, [0, 0, 0], [14, 10])
  const light = tint(color, '#ffffff', 0.55)
  if (kind === 0) for (const s of [-1, 1]) ell(k, { c: [s * 0.14, 0.14, -0.02], r: [0.065, 0.065, 0.045] }, color, undefined, [0, 0, 0], [10, 7])
  else if (kind === 1) for (const s of [-1, 1]) limb(k, [s * 0.07, 0.12, -0.02], [s * 0.1, 0.3, -0.04], 0.042, color)
  else ell(k, { c: [0, 0.18, 0], r: [0.05, 0.05, 0.05] }, light, undefined, [0, 0, 0], [8, 6])
  paint(k, body, oval(0, -0.04, 0.09, 0.07, 0, 14), light, 0.003)
  for (const s of [-1, 1]) paint(k, body, oval(s * 0.07, 0.03, 0.018, 0.024, 0, 10), BUTTON, 0.004, true)
  line(k, body, arc(0, 0.0, 0.03, 0.022, Math.PI * 1.15, Math.PI * 1.85, 8), 0.011, 0.004)
  g = k.geometry()
  fillerGeos.set(key, g)
  return g
}

let heapGeo: Geo | null = null
export interface FillerSpot {
  p: P3
  r: P3
  s: number
  color: string
  kind: FillerKind
}

/** one mesh of filler plushies, piled at the given spots (built once and kept) */
export function heapGeometry(spots: FillerSpot[]) {
  if (heapGeo) return heapGeo
  const parts = spots.map((f) => {
    const g = fillerGeometry(f.color, f.kind).clone()
    g.applyMatrix4(T(f.p, f.r, f.s))
    return g
  })
  heapGeo = mergeGeometries(parts)
  for (const g of parts) g.dispose()
  return heapGeo
}

/** builds every model ahead of time */
export function warmUp() {
  for (const p of PRIZES) proto(p.id)
}

/**
 * Lets go of a renderer that is closing (like Pop Party's releaseModels): every material, texture and geometry cached
 * here holds a 'dispose' listener from each renderer that drew it, and through it the whole renderer. Disposing them
 * drops those listeners and the GPU copies; the objects stay cached for the next visit.
 */
export function releaseModels() {
  for (const m of [felt, gold, tagMat, haloMat]) m?.dispose()
  tagTex?.dispose()
  for (const p of protos.values())
    p.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  for (const g of fillerGeos.values()) g.dispose()
  heapGeo?.dispose()
  toonRamp(RAMP).dispose()
  glowTexture().dispose()
  new THREE.Sprite().geometry.dispose()
}
