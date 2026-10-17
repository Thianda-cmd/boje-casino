import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { T, VKit, centroid, conform, ellipsePts, fan, surfaceZ, toonRamp, vkMaterial, type Ell, type P2, type P3 } from '../../lib/three/toon'
import type { Difficulty } from './rules'

/*
  The Penalty Shootout cast, modelled in code in the site's toon style: flat shading in four tones through a ramp and
  an ink outline (an inverted hull) round every solid part. A player is a little rig of joints (hips, spine, neck,
  shoulders, elbows, hips, knees, ankles), each carrying one VKit mesh (colour per vertex, outline merged in), so the
  scene poses him by turning joints. The face is a set of small meshes on the head (eyes, brows and mouth in several
  shapes, pupils that can look about) switched on and off to make an expression.
  World units are metres. A player stands on y = 0 facing +z; the striker is turned round to face the goal.
*/

export const INK = '#1d0f30'
const RAMP = [92, 165, 224, 255]

let toon: THREE.MeshToonMaterial | null = null
/** the toon material every player, the goal frame and the ball's outline share */
export function toonMaterial() {
  return (toon ??= vkMaterial(toonRamp(RAMP)))
}
export function releaseModels() {
  toon?.dispose()
  toon = null
  toonRamp(RAMP).dispose()
}

/* ------------------------------------------------------------------ */
/*  Geometry kit                                                        */
/* ------------------------------------------------------------------ */

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const hex = (c: THREE.Color) => '#' + c.getHexString()
export const shade = (c: string, f: number) => hex(new THREE.Color(c).multiplyScalar(f))
export const tint = (c: string, to: string, f: number) => hex(new THREE.Color(c).lerp(new THREE.Color(to), f))
const SPARK = new THREE.Color('#ffffff').multiplyScalar(1.25)

const sphere = (w = 20, h = 14) => new THREE.SphereGeometry(1, w, h)
/** a matrix that stands a +y shape on the segment a-b, centred on it */
function aim(a: THREE.Vector3, b: THREE.Vector3, s: P3 = [1, 1, 1]) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(...s))
}
export function ell(k: VKit, e: Ell, color: THREE.ColorRepresentation, ink?: number, rot: P3 = [0, 0, 0], seg: [number, number] = [20, 14]) {
  k.add(sphere(...seg), color, T(e.c, rot, e.r), ink)
}
/** a capsule from a to b, radius r (r1 at b, for a tapered limb) */
export function limb(k: VKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink?: number, r1 = r) {
  const A = V(...a)
  const B = V(...b)
  const len = Math.max(0.001, A.distanceTo(B))
  if (Math.abs(r1 - r) < 1e-4) {
    k.add(new THREE.CapsuleGeometry(r, len, 4, 12), color, aim(A, B), ink)
    return
  }
  // a tapered capsule: a lathe of two half circles joined by a cone
  const pts: THREE.Vector2[] = []
  const n = 6
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.cos(t) * r, -len / 2 + Math.sin(t) * r))
  }
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * (Math.PI / 2)
    pts.push(new THREE.Vector2(Math.cos(t) * r1, len / 2 + Math.sin(t) * r1))
  }
  pts[0].x = 0
  pts[pts.length - 1].x = 0
  k.add(new THREE.LatheGeometry(pts, 12), color, aim(A, B), ink)
}
const rbox = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))

/** a ribbon of width w along a path, thinning to rounded points at both ends (a pen stroke); long segments are split
 *  so the stroke can follow the curve of whatever it is bent onto */
function strip(path0: P2[], w: number, taper = 0.3) {
  const path: P2[] = [path0[0]]
  for (let i = 1; i < path0.length; i++) {
    const [ax, ay] = path0[i - 1]
    const [bx, by] = path0[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.015))
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
    const half = (w / 2) * Math.sqrt(Math.min(1, Math.max(0.2, end)))
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
/** a pen stroke painted onto the front of an ellipsoid (m: then moved, e.g. round to the back) */
export function line(k: VKit, e: Ell, path: P2[], w: number, lift: number, color: THREE.ColorRepresentation = INK, taper = 0.3, m?: THREE.Matrix4) {
  k.add(conform(strip(path, w, taper), e, lift), color, m, 0, true)
}
/** a filled shape painted onto the front of an ellipsoid */
export function paint(k: VKit, e: Ell, pts: P2[], color: THREE.ColorRepresentation, lift: number, flat = false, m?: THREE.Matrix4) {
  const c = centroid(pts)
  const rings = Math.min(4, Math.max(2, Math.ceil(Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) / 0.025)))
  k.add(conform(fan(pts, c, rings), e, lift), color, m, 0, flat)
}
export const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 12): P2[] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * rx, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * ry])
export const oval = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 18): P2[] =>
  ellipsePts(0, 0, rx, ry, n).map(([x, y]): P2 => [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)])
/** half-turn about y: a decal drawn on the front of a centred ellipsoid lands on its back, reading the right way */
const BACK = new THREE.Matrix4().makeRotationY(Math.PI)

/* ------------------------------------------------------------------ */
/*  Players                                                             */
/* ------------------------------------------------------------------ */

export interface PlayerSpec {
  /** drawn this much bigger than the 1.95 m base */
  scale: number
  /** outline thickness, in metres at scale 1 (thicker for a player seen from far away) */
  ink: number
  skin: string
  hair: string
  hairStyle: 'quiff' | 'buzz' | 'cap' | 'band' | 'mohawk'
  beard?: boolean
  shirt: string
  trim: string
  shorts: string
  socks: string
  sockBand: string
  boots: string
  /** the number on his back, and the name over it */
  number?: number
  name?: string
  numberColor?: string
  /** a keeper: long sleeves, big gloves, padded shirt */
  keeper?: { palm: string; back: string; cap?: string; band?: string }
  /** eye colour */
  iris?: string
}

export type EyeShape = 'open' | 'blink' | 'happy' | 'wide' | 'squint'
export type BrowShape = 'flat' | 'angry' | 'worried' | 'up' | 'cheeky'
export type MouthShape = 'smile' | 'grin' | 'o' | 'frown' | 'teeth' | 'tongue' | 'flat'
export type Expr = 'neutral' | 'focus' | 'joy' | 'shock' | 'sad' | 'taunt' | 'cheer' | 'blink' | 'smug'

const EXPRS: Record<Expr, [EyeShape, BrowShape, MouthShape]> = {
  neutral: ['open', 'flat', 'smile'],
  focus: ['squint', 'angry', 'teeth'],
  joy: ['happy', 'up', 'grin'],
  cheer: ['open', 'up', 'grin'],
  shock: ['wide', 'up', 'o'],
  sad: ['open', 'worried', 'frown'],
  taunt: ['happy', 'cheeky', 'tongue'],
  smug: ['squint', 'cheeky', 'smile'],
  blink: ['blink', 'flat', 'smile'],
}

interface Limb {
  /** the shoulder (or hip) joint, the elbow (or knee) and the hand (or ankle) */
  a: THREE.Group
  b: THREE.Group
  c: THREE.Group
}

export interface Rig {
  root: THREE.Group
  hips: THREE.Group
  spine: THREE.Group
  neck: THREE.Group
  arms: [Limb, Limb]
  legs: [Limb, Limb]
  /** the hand points (gloves), for holding the ball */
  hands: [THREE.Object3D, THREE.Object3D]
  /** the hips' height at rest */
  hipH: number
  /** hips to fingertips with the arms straight up */
  reach: number
  scale: number
  /** sets the face */
  setExpr: (e: Expr, mouthOverride?: MouthShape) => void
  expr: Expr
  /** where the pupils look: -1 to 1 across and up */
  look: (x: number, y: number) => void
  /** every mesh of the rig, for warming up and disposal */
  meshes: THREE.Mesh[]
}

/** the base proportions (metres, at scale 1) */
const P = {
  hip: 0.9,
  thigh: 0.4,
  shin: 0.37,
  spine: 0.05,
  shoulderY: 0.43,
  shoulderX: 0.25,
  upper: 0.27,
  fore: 0.25,
  neckY: 0.54,
}
const HEAD: Ell = { c: [0, 0.23, 0.0], r: [0.25, 0.255, 0.235] }

/** Builds a player rig. Every joint is a group; every part a VKit mesh in the shared toon material. */
export function buildPlayer(s: PlayerSpec): Rig {
  const mat = toonMaterial()
  const ink = s.ink
  const meshes: THREE.Mesh[] = []
  const kit = () => new VKit(INK, ink)
  const put = (parent: THREE.Object3D, k: VKit, name: string) => {
    const m = k.mesh(name, mat)
    parent.add(m)
    meshes.push(m)
    return m
  }
  const G = (name: string, parent: THREE.Object3D | null, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group()
    g.name = name
    g.position.set(x, y, z)
    parent?.add(g)
    return g
  }
  const kp = s.keeper
  const root = G('player', null)
  const scaler = G('scale', root)
  scaler.scale.setScalar(s.scale)
  const hips = G('hips', scaler, 0, P.hip, 0)
  const spine = G('spine', hips, 0, P.spine, 0)
  const neck = G('neck', spine, 0, P.neckY, -0.01)

  /* ---- pelvis: the shorts ---- */
  {
    const k = kit()
    ell(k, { c: [0, -0.02, 0], r: [0.21, 0.13, 0.15] }, s.shorts)
    // a waistband and a stripe down each side
    k.add(new THREE.TorusGeometry(0.188, 0.02, 6, 26), shade(s.shorts, 0.82), T([0, 0.075, 0], [Math.PI / 2, 0, 0], [1, 0.78, 1]), 0)
    put(hips, k, 'pelvis')
  }

  /* ---- torso ---- */
  {
    const k = kit()
    const body: Ell = { c: [0, 0.26, 0], r: [kp ? 0.245 : 0.225, 0.29, kp ? 0.165 : 0.15] }
    ell(k, body, s.shirt, undefined, [0, 0, 0], [24, 18])
    // a v-neck collar in the trim colour
    const collar: P2[] = [...arc(0, 0.52, 0.11, 0.06, Math.PI, 2 * Math.PI, 10), [0.035, 0.47], [0, 0.43], [-0.035, 0.47]]
    paint(k, body, collar, s.trim, 0.004)
    paint(k, body, [[-0.05, 0.505], [0.05, 0.505], [0, 0.455]], s.skin, 0.006)
    // side panels
    for (const sx of [-1, 1]) {
      const pts: P2[] = [[sx * 0.15, 0.42], [sx * 0.2, 0.36], [sx * 0.205, 0.06], [sx * 0.17, 0.0]]
      line(k, body, pts, 0.03, 0.003, kp ? s.trim : shade(s.shirt, 0.78), 0.15)
    }
    // the hem
    k.add(new THREE.TorusGeometry(kp ? 0.2 : 0.185, 0.022, 6, 26), shade(s.shirt, 0.85), T([0, 0.02, 0], [Math.PI / 2, 0, 0], [1, 0.72, 1]), 0)
    if (kp) {
      // a keeper's padded chest: a big diamond badge
      paint(k, body, [[0, 0.4], [0.085, 0.3], [0, 0.2], [-0.085, 0.3]], s.trim, 0.004)
      paint(k, body, [[0, 0.37], [0.05, 0.3], [0, 0.23], [-0.05, 0.3]], shade(s.shirt, 0.8), 0.006)
    } else {
      // a little crest on the chest
      paint(k, body, oval(-0.09, 0.36, 0.026, 0.03, 0, 12), s.trim, 0.004)
      paint(k, body, oval(-0.09, 0.36, 0.014, 0.017, 0, 10), '#ffd23f', 0.006, true)
    }
    if (s.number != null) {
      // the number on the back, drawn in strokes
      const col = s.numberColor ?? '#ffffff'
      const digits = String(s.number).split('')
      const w = 0.085
      const gap = 0.025
      const x0 = -((digits.length * w + (digits.length - 1) * gap) / 2) + w / 2
      digits.forEach((d, i) => {
        const cx = x0 + i * (w + gap)
        for (const path of digitPaths(d, cx, 0.27, w, 0.18)) line(k, body, path, 0.044, 0.005, col, 0.0, BACK)
      })
      // the name across the shoulders, in strokes like the number
      if (s.name) {
        const lw = 0.044
        const lg = 0.016
        const letters = s.name.split('')
        const lx0 = -((letters.length * lw + (letters.length - 1) * lg) / 2) + lw / 2
        letters.forEach((ch, i) => {
          for (const path of letterPaths(ch, lx0 + i * (lw + lg), 0.425, lw, 0.058)) line(k, body, path, 0.017, 0.005, col, 0.0, BACK)
        })
      } else line(k, body, [[-0.08, 0.43], [0.08, 0.43]], 0.022, 0.005, col, 0.0, BACK)
    }
    put(spine, k, 'torso')
  }

  /* ---- head ---- */
  const faceParts = new Map<string, THREE.Mesh>()
  const pupils: THREE.Mesh[] = []
  {
    const k = kit()
    ell(k, HEAD, s.skin, undefined, [0, 0, 0], [26, 20])
    // the neck
    limb(k, [0, -0.08, -0.01], [0, 0.04, -0.01], 0.075, shade(s.skin, 0.92))
    // ears
    for (const sx of [-1, 1]) {
      ell(k, { c: [sx * 0.245, 0.21, -0.02], r: [0.04, 0.06, 0.04] }, s.skin)
      ell(k, { c: [sx * 0.255, 0.21, 0.0], r: [0.018, 0.034, 0.012] }, shade(s.skin, 0.82), 0)
    }
    // nose
    ell(k, { c: [0, 0.19, surfaceZ(HEAD, 0, 0.19) + 0.012], r: [0.035, 0.03, 0.03] }, shade(s.skin, 0.93), ink * 0.6)
    // cheeks
    for (const sx of [-1, 1]) paint(k, HEAD, oval(sx * 0.14, 0.15, 0.04, 0.022, 0, 12), tint(s.skin, '#ff7a8a', 0.35), 0.003)
    hair(k, s)
    if (s.beard) {
      // a short beard round the jaw and chin
      const beard: P2[] = [...arc(0, 0.125, 0.205, 0.165, Math.PI * 1.06, Math.PI * 1.94, 16)]
      const inner: P2[] = arc(0, 0.112, 0.09, 0.05, Math.PI * 1.92, Math.PI * 1.08, 10)
      paint(k, HEAD, [...beard, ...inner], s.hair, 0.004)
      // a moustache over the mouth
      line(k, HEAD, [[-0.075, 0.122], [-0.03, 0.142], [0, 0.136], [0.03, 0.142], [0.075, 0.122]], 0.026, 0.005, s.hair, 0.3)
    }
    put(neck, k, 'head')
    // the face parts
    const part = (name: string, build: (k: VKit) => void) => {
      const pk = kit()
      build(pk)
      const m = put(neck, pk, name)
      m.visible = false
      faceParts.set(name, m)
    }
    const eyeX = 0.088
    const eyeY = 0.255
    const er: [number, number] = [0.052, 0.066]
    const eyeWhite = (pk: VKit, sx: number, ry = er[1], rx = er[0]) => {
      const pts = oval(sx * eyeX, eyeY, rx, ry, 0, 22)
      paint(pk, HEAD, pts.map(([x, y]): P2 => [sx * eyeX + (x - sx * eyeX) * 1.22, eyeY + (y - eyeY) * 1.18]), INK, 0.004, true)
      paint(pk, HEAD, pts, '#ffffff', 0.006, true)
    }
    part('eyes-open', (pk) => [-1, 1].forEach((sx) => eyeWhite(pk, sx)))
    part('eyes-wide', (pk) => [-1, 1].forEach((sx) => eyeWhite(pk, sx, er[1] * 1.2, er[0] * 1.15)))
    part('eyes-squint', (pk) =>
      [-1, 1].forEach((sx) => {
        // the top lid comes down flat: a half eye
        const x = sx * eyeX
        const pts: P2[] = [...arc(x, eyeY, er[0], er[1], Math.PI, 2 * Math.PI, 14), [x + er[0], eyeY + er[1] * 0.25], [x - er[0], eyeY + er[1] * 0.25]]
        paint(pk, HEAD, pts.map(([px, py]): P2 => [x + (px - x) * 1.24, eyeY + (py - eyeY) * 1.22]), INK, 0.004, true)
        paint(pk, HEAD, pts, '#ffffff', 0.006, true)
      }),
    )
    part('eyes-blink', (pk) => [-1, 1].forEach((sx) => line(pk, HEAD, arc(sx * eyeX, eyeY + 0.01, er[0] * 1.05, er[1] * 0.45, Math.PI * 1.05, Math.PI * 1.95, 10), 0.022, 0.006)))
    part('eyes-happy', (pk) => [-1, 1].forEach((sx) => line(pk, HEAD, arc(sx * eyeX, eyeY - 0.025, er[0] * 1.05, er[1] * 0.85, Math.PI * 0.92, Math.PI * 0.08, 12), 0.026, 0.006)))
    // pupils: each its own mesh so it can look about
    for (const sx of [-1, 1]) {
      const pk = kit()
      const x = sx * eyeX
      const z = surfaceZ(HEAD, x, eyeY)
      const pe: Ell = { c: [0, 0, 0], r: [0.03, 0.038, 0.01] }
      pk.add(new THREE.CircleGeometry(1, 18), s.iris ?? '#3a2a1e', T([0, 0, 0], [0, 0, 0], [0.032, 0.04, 1]), 0, true)
      pk.add(new THREE.CircleGeometry(1, 16), INK, T([0, 0, 0.001], [0, 0, 0], [0.019, 0.024, 1]), 0, true)
      pk.decal(pe, ellipsePts(-0.009, 0.014, 0.009, 0.009, 10), SPARK, 0.004, 0)
      const m = put(neck, pk, `pupil${sx}`)
      const n = V(x / (HEAD.r[0] ** 2), (eyeY - HEAD.c[1]) / (HEAD.r[1] ** 2), (z - HEAD.c[2]) / (HEAD.r[2] ** 2)).normalize()
      m.position.set(x, eyeY, z + 0.009)
      m.quaternion.setFromUnitVectors(V(0, 0, 1), n)
      m.userData.base = m.position.clone()
      m.visible = false
      pupils.push(m)
    }
    const browY = eyeY + 0.118
    // brows a good deal darker than the hair, so a blond's still read
    const browColor = shade(s.hair, 0.55)
    const brow = (pk: VKit, inner: number, outer: number, mid = 0) =>
      [-1, 1].forEach((sx) => {
        const x0 = sx * (eyeX - 0.055)
        const x1 = sx * (eyeX + 0.055)
        line(pk, HEAD, [[x0, browY + inner], [(x0 + x1) / 2, browY + (inner + outer) / 2 + 0.012 + mid], [x1, browY + outer]], 0.03, 0.007, browColor, 0.25)
      })
    part('brows-flat', (pk) => brow(pk, 0, 0))
    part('brows-angry', (pk) => brow(pk, -0.035, 0.02, -0.006))
    part('brows-worried', (pk) => brow(pk, 0.03, -0.02))
    part('brows-up', (pk) => brow(pk, 0.04, 0.035, 0.008))
    part('brows-cheeky', (pk) => {
      // one up, one down
      const col = browColor
      line(pk, HEAD, [[-(eyeX - 0.055), browY + 0.03], [-eyeX, browY + 0.052], [-(eyeX + 0.055), browY + 0.035]], 0.03, 0.007, col, 0.25)
      line(pk, HEAD, [[eyeX - 0.055, browY - 0.025], [eyeX, browY - 0.01], [eyeX + 0.055, browY + 0.005]], 0.03, 0.007, col, 0.25)
    })
    const my = 0.105
    const mouthShape = (pk: VKit, out: P2[], inside = '#5a1428', tongue = true) => {
      const c = centroid(out)
      paint(pk, HEAD, out.map(([x, y]): P2 => [c[0] + (x - c[0]) * 1.16, c[1] + (y - c[1]) * 1.2]), INK, 0.004, true)
      paint(pk, HEAD, out, inside, 0.006, true)
      if (tongue) paint(pk, HEAD, oval(c[0], c[1] - (c[1] - Math.min(...out.map((p) => p[1]))) * 0.45, 0.035, 0.016, 0, 12), '#ff6f86', 0.008, true)
    }
    part('mouth-smile', (pk) => line(pk, HEAD, arc(0, my + 0.05, 0.065, 0.05, Math.PI * 1.15, Math.PI * 1.85, 12), 0.02, 0.006))
    part('mouth-flat', (pk) => line(pk, HEAD, [[-0.04, my], [0, my - 0.004], [0.04, my]], 0.02, 0.006))
    part('mouth-frown', (pk) => line(pk, HEAD, arc(0, my - 0.045, 0.06, 0.04, Math.PI * 0.15, Math.PI * 0.85, 12), 0.02, 0.006))
    part('mouth-grin', (pk) => {
      const w = 0.085
      const xs = Array.from({ length: 13 }, (_, i) => -w + (2 * w * i) / 12)
      const out: P2[] = [...xs.map((x): P2 => [x, my + 0.02 + 0.012 * (x / w) ** 2]), ...xs.slice(1, -1).reverse().map((x): P2 => [x, my + 0.02 - w * 0.95 * Math.sqrt(Math.max(0, 1 - (x / w) ** 2))])]
      mouthShape(pk, out)
      // the top teeth
      paint(pk, HEAD, [[-w * 0.72, my + 0.022], [w * 0.72, my + 0.022], [w * 0.6, my + 0.002], [-w * 0.6, my + 0.002]], '#ffffff', 0.009, true)
    })
    part('mouth-o', (pk) => mouthShape(pk, oval(0, my - 0.01, 0.034, 0.045, 0, 16), '#5a1428', false))
    part('mouth-teeth', (pk) => {
      // gritted teeth: a white bar with a line through it
      const pts: P2[] = [[-0.06, my + 0.018], [0.06, my + 0.018], [0.055, my - 0.018], [-0.055, my - 0.018]]
      const c = centroid(pts)
      paint(pk, HEAD, pts.map(([x, y]): P2 => [c[0] + (x - c[0]) * 1.2, c[1] + (y - c[1]) * 1.5]), INK, 0.004, true)
      paint(pk, HEAD, pts, '#ffffff', 0.006, true)
      line(pk, HEAD, [[-0.055, my], [0.055, my]], 0.008, 0.008, INK, 0)
      for (const x of [-0.025, 0.0, 0.025]) line(pk, HEAD, [[x, my + 0.016], [x, my - 0.016]], 0.006, 0.008, INK, 0)
    })
    part('mouth-tongue', (pk) => {
      // a cheeky grin with the tongue poking out
      const w = 0.06
      line(pk, HEAD, arc(0, my + 0.045, w, 0.05, Math.PI * 1.12, Math.PI * 1.88, 12), 0.02, 0.006)
      paint(pk, HEAD, [...arc(0.012, my - 0.012, 0.032, 0.05, Math.PI * 1.02, Math.PI * 1.98, 10), [0.044, my + 0.004], [-0.02, my + 0.004]], INK, 0.007, true)
      paint(pk, HEAD, [...arc(0.012, my - 0.012, 0.024, 0.042, Math.PI * 1.05, Math.PI * 1.95, 10), [0.036, my + 0.0], [-0.012, my + 0.0]], '#ff6f86', 0.009, true)
      line(pk, HEAD, [[0.012, my - 0.004], [0.012, my - 0.03]], 0.006, 0.01, '#d94a66', 0)
    })
  }

  /* ---- arms ---- */
  const arms = [-1, 1].map((sx) => {
    // sx = 1 is his left (+x when he faces +z)
    const a = G(sx > 0 ? 'shL' : 'shR', spine, sx * P.shoulderX, P.shoulderY, -0.01)
    const b = G('elbow', a, 0, -P.upper, 0)
    const c = G('hand', b, 0, -P.fore, 0)
    {
      const k = kit()
      ell(k, { c: [0, -0.01, 0], r: [0.085, 0.085, 0.085] }, s.shirt)
      if (kp) {
        limb(k, [0, -0.02, 0], [0, -P.upper + 0.02, 0], 0.068, s.shirt, undefined, 0.06)
        // padded elbows
        ell(k, { c: [0, -P.upper + 0.01, -0.02], r: [0.06, 0.05, 0.05] }, shade(s.shirt, 0.82), 0)
      } else {
        // a short sleeve with a trim band, then the bare arm
        limb(k, [0, -0.02, 0], [0, -0.12, 0], 0.075, s.shirt, undefined, 0.07)
        k.add(new THREE.TorusGeometry(0.069, 0.014, 6, 16), s.trim, T([0, -0.155, 0], [Math.PI / 2, 0, 0]), 0)
        limb(k, [0, -0.13, 0], [0, -P.upper + 0.02, 0], 0.05, s.skin, undefined, 0.045)
      }
      put(a, k, 'upper')
    }
    {
      const k = kit()
      limb(k, [0, 0.01, 0], [0, -P.fore + 0.03, 0], kp ? 0.058 : 0.045, kp ? s.shirt : s.skin, undefined, kp ? 0.052 : 0.04)
      if (kp) k.add(new THREE.TorusGeometry(0.052, 0.014, 6, 16), s.trim, T([0, -P.fore + 0.07, 0], [Math.PI / 2, 0, 0]), 0)
      put(b, k, 'fore')
    }
    {
      const k = kit()
      if (kp) {
        // a big goalkeeper glove: palm, a fat cuff, four fingers in a mitten and a thumb
        k.add(new THREE.CylinderGeometry(0.068, 0.072, 0.07, 16), kp.back, T([0, 0.01, 0]))
        ell(k, { c: [0, -0.07, 0], r: [0.085, 0.095, 0.06] }, kp.palm)
        ell(k, { c: [0, -0.15, 0.005], r: [0.08, 0.07, 0.055] }, kp.palm)
        ell(k, { c: [0, -0.07, -0.035], r: [0.07, 0.08, 0.03] }, kp.back, 0)
        limb(k, [sx * -0.065, -0.05, 0.03], [sx * -0.1, -0.12, 0.05], 0.03, kp.palm)
        // finger lines
        for (const dx of [-0.028, 0, 0.028]) limb(k, [dx, -0.12, 0.05], [dx, -0.19, 0.04], 0.006, shade(kp.palm, 0.72), 0)
      } else {
        ell(k, { c: [0, -0.055, 0.005], r: [0.05, 0.065, 0.04] }, s.skin)
        limb(k, [sx * -0.035, -0.035, 0.03], [sx * -0.055, -0.08, 0.04], 0.018, s.skin, ink * 0.7)
      }
      put(c, k, 'hand')
    }
    const tip = new THREE.Object3D()
    tip.position.set(0, kp ? -0.1 : -0.06, kp ? 0.02 : 0.01)
    c.add(tip)
    return { a, b, c, tip }
  })

  /* ---- legs ---- */
  const legs = [-1, 1].map((sx) => {
    const a = G(sx > 0 ? 'hipL' : 'hipR', hips, sx * 0.105, -0.05, 0)
    const b = G('knee', a, 0, -P.thigh, 0)
    const c = G('ankle', b, 0, -P.shin, 0)
    {
      const k = kit()
      // shorts leg, then the thigh
      limb(k, [0, 0.02, 0], [0, -0.17, 0.005], 0.1, s.shorts, undefined, 0.095)
      limb(k, [0, -0.16, 0.005], [0, -P.thigh + 0.02, 0.01], 0.07, s.skin, undefined, 0.06)
      if (kp) ell(k, { c: [0, -0.12, 0.01], r: [0.1, 0.06, 0.098] }, shade(s.shorts, 0.85), 0)
      put(a, k, 'thigh')
    }
    {
      const k = kit()
      // knee, then the sock pulled up over the shin pad
      ell(k, { c: [0, -0.005, 0.01], r: [0.062, 0.062, 0.062] }, s.skin)
      limb(k, [0, -0.06, 0.005], [0, -P.shin + 0.03, 0], 0.066, s.socks, undefined, 0.05)
      // the sock's turned-over top and its hoops
      k.add(new THREE.TorusGeometry(0.066, 0.02, 6, 16), shade(s.socks, 0.85), T([0, -0.062, 0.005], [Math.PI / 2, 0, 0]), 0)
      k.add(new THREE.TorusGeometry(0.063, 0.017, 6, 16), s.sockBand, T([0, -0.095, 0.005], [Math.PI / 2, 0, 0]), 0)
      k.add(new THREE.TorusGeometry(0.06, 0.017, 6, 16), s.sockBand, T([0, -0.14, 0.004], [Math.PI / 2, 0, 0]), 0)
      k.add(new THREE.TorusGeometry(0.057, 0.013, 6, 16), s.sockBand, T([0, -0.18, 0.003], [Math.PI / 2, 0, 0]), 0)
      put(b, k, 'shin')
    }
    {
      const k = kit()
      // the boot: a rounded toe-heavy shape, a sole and a stripe
      const boot = rbox(0.12, 0.09, 0.27, 0.045)
      k.add(boot, s.boots, T([0, -0.035, 0.055]))
      k.add(rbox(0.125, 0.025, 0.28, 0.012), shade(s.boots, 0.55), T([0, -0.082, 0.055]), ink * 0.6)
      limb(k, [sx * 0.062, -0.03, 0.0], [sx * 0.062, -0.045, 0.13], 0.012, '#ffffff', 0)
      put(c, k, 'foot')
    }
    return { a, b, c }
  }) as unknown as [Limb, Limb]

  const exprState = { e: 'neutral' as Expr }
  const setExpr = (e: Expr, mouthOverride?: MouthShape) => {
    const [eyes, brows, mouth] = EXPRS[e]
    const m = mouthOverride ?? mouth
    for (const [name, mesh] of faceParts) {
      const [kind, shape] = name.split('-')
      mesh.visible = kind === 'eyes' ? shape === eyes : kind === 'brows' ? shape === brows : shape === m
    }
    const showPupils = eyes === 'open' || eyes === 'wide' || eyes === 'squint'
    for (const p of pupils) {
      p.visible = showPupils
      p.scale.setScalar(eyes === 'wide' ? 0.72 : eyes === 'squint' ? 0.9 : 1)
    }
    exprState.e = e
    rig.expr = e
  }
  const lookAt = { x: 0, y: 0 }
  const look = (x: number, y: number) => {
    lookAt.x = Math.max(-1, Math.min(1, x))
    lookAt.y = Math.max(-1, Math.min(1, y))
    const eyes = EXPRS[exprState.e][0]
    // a squint only lets them look across, below the lid
    const yy = eyes === 'squint' ? -0.4 : lookAt.y
    for (const p of pupils) {
      const b = p.userData.base as THREE.Vector3
      p.position.set(b.x + lookAt.x * 0.017, b.y + yy * 0.02, b.z)
    }
  }

  const rig: Rig = {
    root,
    hips,
    spine,
    neck,
    arms: [arms[0], arms[1]],
    legs,
    hands: [arms[0].tip, arms[1].tip],
    hipH: P.hip,
    reach: (P.spine + P.shoulderY + P.upper + P.fore + 0.15) * s.scale,
    scale: s.scale,
    setExpr,
    expr: 'neutral',
    look,
    meshes,
  }
  setExpr('neutral')
  return rig
}

/** a hair style on the head kit */
function hair(k: VKit, s: PlayerSpec) {
  const col = s.hair
  const dark = shade(col, 0.82)
  if (s.hairStyle === 'cap' && s.keeper?.cap) {
    // a peaked cap, peak to the front
    const cap = s.keeper.cap
    // the crown tilted back, so its rim runs above the brows at the front and low at the back
    k.add(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), cap, T([0, 0.305, -0.01], [-0.38, 0, 0], [0.27, 0.25, 0.262]))
    // the peak, out over the eyes
    k.add(new THREE.CylinderGeometry(0.2, 0.2, 0.026, 22, 1, false, -Math.PI * 0.45, Math.PI * 0.9), shade(cap, 0.82), T([0, 0.395, 0.13], [0.22, 0, 0], [1.05, 1, 1]))
    ell(k, { c: [0, 0.555, -0.03], r: [0.03, 0.022, 0.03] }, shade(cap, 0.75), 0)
    // a white badge on the front, and hair poking out at the back and sides
    ell(k, { c: [0, 0.47, 0.19], r: [0.05, 0.04, 0.02] }, '#ffffff', 0, [-0.55, 0, 0])
    ell(k, { c: [0, 0.17, -0.14], r: [0.2, 0.1, 0.12] }, col, undefined, [0.25, 0, 0])
    for (const sx of [-1, 1]) ell(k, { c: [sx * 0.215, 0.27, -0.05], r: [0.05, 0.07, 0.07] }, col, 0)
    return
  }
  if (s.hairStyle === 'buzz' || s.hairStyle === 'band') {
    // close cropped: a cap of hair over the top and back
    k.add(new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.47), col, T([0, 0.25, -0.025], [-0.32, 0, 0], [0.262, 0.262, 0.248]))
    if (s.hairStyle === 'band' && s.keeper?.band) k.add(new THREE.TorusGeometry(0.245, 0.03, 8, 30), s.keeper.band, T([0, 0.36, -0.01], [Math.PI / 2 - 0.3, 0, 0], [1, 1.02, 1]), s.ink * 0.8)
    return
  }
  if (s.hairStyle === 'mohawk') {
    k.add(new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), dark, T([0, 0.25, -0.03], [-0.3, 0, 0], [0.258, 0.258, 0.246]), 0)
    for (let i = 0; i < 6; i++) {
      const a = -0.5 + i * 0.32
      const y = 0.23 + Math.cos(a) * 0.24
      const z = Math.sin(a) * 0.24 * -1
      limb(k, [0, y - 0.02, z], [0, y + 0.1 - Math.abs(a) * 0.05, z - 0.02], 0.04, col, undefined, 0.012)
    }
    return
  }
  // a big quiff: hair over the top and back, swept up at the front
  k.add(new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), col, T([0, 0.25, -0.03], [-0.36, 0, 0], [0.27, 0.272, 0.258]))
  // the quiff swept up off the forehead, and a few tufts on the crown (the back of his head is most of what we see)
  for (const [x, y, z, rx, ry, rz, a, b] of [
    [0.02, 0.475, 0.12, 0.14, 0.085, 0.11, -0.65, 0.1],
    [-0.09, 0.49, 0.06, 0.1, 0.075, 0.12, -0.45, 0.25],
    [0.11, 0.48, 0.05, 0.09, 0.07, 0.11, -0.55, -0.3],
    [0.0, 0.52, -0.02, 0.11, 0.07, 0.12, -0.2, 0],
    [0.0, 0.45, -0.17, 0.1, 0.06, 0.08, 0.7, 0],
    [0.1, 0.38, -0.21, 0.08, 0.055, 0.07, 0.9, -0.4],
    [-0.1, 0.38, -0.21, 0.08, 0.055, 0.07, 0.9, 0.4],
  ] as const)
    ell(k, { c: [x, y, z], r: [rx, ry, rz] }, col, undefined, [a, 0, b])
  // sideburns
  for (const sx of [-1, 1]) ell(k, { c: [sx * 0.225, 0.22, 0.02], r: [0.03, 0.06, 0.04] }, col, 0)
  // the back of his head is what we see most: strands swept down to a neat nape, and the floodlights catching them
  const light = tint(col, '#ffe2b8', 0.42)
  for (const [x, y, z, rx, ry, rz, a, b] of [
    [-0.13, 0.33, -0.2, 0.06, 0.09, 0.05, 0.5, 0.45],
    [0.13, 0.33, -0.2, 0.06, 0.09, 0.05, 0.5, -0.45],
    [0.0, 0.3, -0.245, 0.07, 0.1, 0.045, 0.35, 0],
    [-0.07, 0.2, -0.235, 0.05, 0.07, 0.04, 0.2, 0.2],
    [0.07, 0.2, -0.235, 0.05, 0.07, 0.04, 0.2, -0.2],
  ] as const)
    ell(k, { c: [x, y, z], r: [rx, ry, rz] }, dark, s.ink * 0.6, [a, 0, b])
  for (const [x, y, z, rx, ry, rz, a, b] of [
    [-0.06, 0.43, -0.17, 0.05, 0.02, 0.03, 0.9, 0.35],
    [0.06, 0.45, -0.15, 0.045, 0.018, 0.028, 0.9, -0.3],
    [0.0, 0.36, -0.235, 0.05, 0.016, 0.02, 0.5, 0],
  ] as const)
    ell(k, { c: [x, y, z], r: [rx, ry, rz] }, light, 0, [a, 0, b])
}

/** the strokes of a capital letter (enough of the alphabet for the shirts) in a w × h box centred on (cx, cy) */
function letterPaths(ch: string, cx: number, cy: number, w: number, h: number): P2[][] {
  const l = cx - w / 2
  const r = cx + w / 2
  const t = cy + h / 2
  const b = cy - h / 2
  const m = cy
  switch (ch) {
    case 'B':
      return [
        [[l, b], [l, t], [r - w * 0.25, t], ...arc(r - w * 0.25, m + h * 0.25, w * 0.25, h * 0.25, Math.PI / 2, -Math.PI / 2, 6), [l, m]],
        [[l, m], [r - w * 0.2, m], ...arc(r - w * 0.2, m - h * 0.25, w * 0.2, h * 0.25, Math.PI / 2, -Math.PI / 2, 6), [l, b]],
      ]
    case 'O':
      return [[...arc(cx, cy, w / 2, h / 2, 0, Math.PI * 2, 18)]]
    case 'J':
      return [[[l + w * 0.2, t], [r, t]], [[r - w * 0.15, t], [r - w * 0.15, b + h * 0.28], ...arc(cx - w * 0.07, b + h * 0.28, w * 0.43, h * 0.28, 0, -Math.PI, 8)]]
    case 'E':
      return [[[r, t], [l, t], [l, b], [r, b]], [[l, m], [r - w * 0.12, m]]]
    default:
      return [[[l, b], [l, t]], [[r, b], [r, t]], [[l, m], [r, m]]]
  }
}

/** the strokes of a digit in a w × h box centred on (cx, cy) */
function digitPaths(d: string, cx: number, cy: number, w: number, h: number): P2[][] {
  const l = cx - w / 2
  const r = cx + w / 2
  const t = cy + h / 2
  const b = cy - h / 2
  const m = cy
  switch (d) {
    case '1':
      return [[[cx - w * 0.32, t - h * 0.22], [cx + w * 0.08, t], [cx + w * 0.08, b]]]
    case '0':
      return [[...arc(cx, cy, w / 2, h / 2, 0, Math.PI * 2, 20)]]
    case '7':
      return [[[l, t], [r, t], [cx - w * 0.1, b]]]
    case '9':
      return [[...arc(cx, cy + h * 0.2, w / 2, h * 0.3, 0, Math.PI * 2, 18)], [[r, cy + h * 0.2], [r, b + h * 0.15], [cx, b]]]
    default:
      return [[[l, t], [r, t], [r, m], [l, m], [l, b], [r, b]]]
  }
}

/* ------------------------------------------------------------------ */
/*  The cast                                                            */
/* ------------------------------------------------------------------ */

/** our striker: red shirt, white shorts, number 10 */
export function strikerSpec(): PlayerSpec {
  return {
    scale: 0.96,
    ink: 0.017,
    skin: '#e9b48a',
    hair: '#4a2c18',
    hairStyle: 'quiff',
    shirt: '#ff3b4e',
    trim: '#ffffff',
    shorts: '#ffffff',
    socks: '#ff3b4e',
    sockBand: '#ffffff',
    boots: '#2ef08c',
    number: 10,
    name: 'BOJE',
    iris: '#4a3020',
  }
}

export interface KeeperLook {
  name: string
  spec: PlayerSpec
  /** his glove colour, for the HUD */
  accent: string
}

/** the four keepers, one per difficulty: bigger and tougher as it gets harder */
export function keeperLook(d: Difficulty): KeeperLook {
  const base = { ink: 0.034, number: undefined }
  switch (d) {
    case 'easy':
      return {
        name: 'Rookie Rudi',
        accent: '#c6f03c',
        spec: { ...base, scale: 1.05, skin: '#f2c7a2', hair: '#e8a33c', hairStyle: 'cap', shirt: '#9ee34f', trim: '#2f7d32', shorts: '#2f7d32', socks: '#9ee34f', sockBand: '#2f7d32', boots: '#ffffff', keeper: { palm: '#ffffff', back: '#2f7d32', cap: '#2f7d32' }, iris: '#3b6fd1' },
      }
    case 'medium':
      return {
        name: 'Steady Sven',
        accent: '#ffb02e',
        spec: { ...base, scale: 1.14, skin: '#f0c09a', hair: '#f4e3a1', hairStyle: 'quiff', shirt: '#ff9f1c', trim: '#1d2a5a', shorts: '#1d2a5a', socks: '#ff9f1c', sockBand: '#1d2a5a', boots: '#1d2a5a', keeper: { palm: '#ffffff', back: '#ff9f1c' }, iris: '#4aa3df' },
      }
    case 'hard':
      return {
        name: 'Big Bruno',
        accent: '#b48cff',
        spec: { ...base, scale: 1.23, skin: '#b9784e', hair: '#1c1310', hairStyle: 'band', shirt: '#8a5cff', trim: '#ffd23f', shorts: '#2b1a5c', socks: '#8a5cff', sockBand: '#ffd23f', boots: '#ffd23f', keeper: { palm: '#ffd23f', back: '#2b1a5c', band: '#ffd23f' }, iris: '#3a2412' },
      }
    case 'expert':
      return {
        name: 'The Wall',
        accent: '#ffd23f',
        spec: { ...base, scale: 1.34, skin: '#d9a07a', hair: '#2a1b14', hairStyle: 'mohawk', beard: true, shirt: '#22202e', trim: '#ffcf3a', shorts: '#22202e', socks: '#22202e', sockBand: '#ffcf3a', boots: '#ffcf3a', keeper: { palm: '#ffcf3a', back: '#22202e' }, iris: '#2b1a10' },
      }
  }
}

/* ------------------------------------------------------------------ */
/*  The ball                                                            */
/* ------------------------------------------------------------------ */

export const BALL_R = 0.17

/** the 32 face centres of a classic ball (12 pentagons, 20 hexagons): icosahedron vertices and face centres */
function ballCentres() {
  const ico = new THREE.IcosahedronGeometry(1, 0)
  const p = ico.getAttribute('position')
  const verts: THREE.Vector3[] = []
  const faces: THREE.Vector3[] = []
  for (let i = 0; i < p.count; i += 3) {
    const tri = [0, 1, 2].map((j) => V(p.getX(i + j), p.getY(i + j), p.getZ(i + j)).normalize())
    faces.push(tri[0].clone().add(tri[1]).add(tri[2]).normalize())
    for (const v of tri) if (!verts.some((u) => u.distanceToSquared(v) < 1e-6)) verts.push(v)
  }
  ico.dispose()
  return { pent: verts, hex: faces }
}

/** the ball: white leather with black pentagons and seams, worked out per pixel, and an ink outline */
export function buildBall() {
  const { pent, hex: hexes } = ballCentres()
  const mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonRamp(RAMP) })
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uPent = { value: pent }
    sh.uniforms.uHex = { value: hexes }
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjN;').replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvObjN = objectNormal;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjN;\nuniform vec3 uPent[12];\nuniform vec3 uHex[20];')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec3 n = normalize(vObjN);
        float b1 = -2.0; float b2 = -2.0; float isP = 0.0;
        for (int i = 0; i < 12; i++) { float d = dot(n, uPent[i]); if (d > b1) { b2 = b1; b1 = d; isP = 1.0; } else if (d > b2) { b2 = d; } }
        for (int i = 0; i < 20; i++) { float d = dot(n, uHex[i]); if (d > b1) { b2 = b1; b1 = d; isP = 0.0; } else if (d > b2) { b2 = d; } }
        float seam = 1.0 - smoothstep(0.006, 0.014, b1 - b2);
        vec3 leather = mix(vec3(0.97, 0.96, 0.93), vec3(0.11, 0.09, 0.16), isP);
        diffuseColor.rgb = mix(leather, vec3(0.11, 0.09, 0.16), seam * (1.0 - isP) * 0.85);`,
      )
  }
  mat.customProgramCacheKey = () => 'penalty-ball'
  const geo = new THREE.SphereGeometry(BALL_R, 32, 24)
  const ball = new THREE.Mesh(geo, mat)
  ball.name = 'ball'
  const inkMat = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide })
  const outline = new THREE.Mesh(new THREE.SphereGeometry(BALL_R + 0.022, 24, 16), inkMat)
  outline.name = 'ball-ink'
  const group = new THREE.Group()
  group.add(outline, ball)
  return { group, spin: ball, materials: [mat, inkMat] as THREE.Material[], geometries: [geo, outline.geometry] }
}
