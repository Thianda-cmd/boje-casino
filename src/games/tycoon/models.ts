import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { T, toonRamp, type P2, type P3 } from '../../lib/three/toon'
import { glowTexture } from '../../lib/three/fx'

/*
  The Casino Tycoon model kit: what every model on the floor is built with (the attractions in machines.ts,
  tables.ts and venues.ts on attraction.ts; people.ts; floor.ts; city.ts) and the few materials they share.

  Models are made in code from primitives in the site's toon style (lib/three/toon.ts): colour per vertex, a stepped
  toon ramp and an ink outline baked into the same mesh as an inverted hull. One difference: the floor is seen
  through an orthographic camera at any zoom, so the outline keeps one width on screen. Every hull is baked at zero
  thickness together with the way to push each corner out (`aPush`: the corner's averaged normal, lengthened so every
  face around it moves out by one), and the shader pushes it by `U.uInk` world units, which the scene sets from the
  zoom (about 1.4 CSS px). Boxes keep crisp flat shading: only the hull uses the averaged direction.

  Each vertex also carries a look (`aFx`): x = flat (its colour as it is, unlit; above 1 it blooms), y = a band of
  gold shine sweeping across, z = a marquee bulb's place in its chase (0 = not a bulb), w = 1 a lamp that lights up
  at night, 2 a wall of windows (drawn by the shader from the world position: dark glass by day, lit at random by
  night). Shared uniforms drive them all: U.uTime, U.uNight (0 day .. 1 night), U.uBoost (a whale's boost: every
  bulb on), U.uInk, and the haze (U.uHaze, U.uHazeColor) that fades the city into the sky towards the back.

  World units: a guest is about 1 tall, a plot 4.6 across (layout.ts). Batch draws up to `cap` copies of a geometry
  in one call (begin / put / end each frame, nothing allocated); canvasTexture, fitText and textPlane draw lettering.
*/

export type { P2, P3 }
const INK = '#22153a'
export const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
export const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
export { T }
/** a seeded random source (mulberry32), so built scenery is the same every visit */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
export type Rand = ReturnType<typeof rng>

/* ---------------- shared uniforms and materials ---------------- */

export const U = {
  uInk: { value: 0.06 },
  uTime: { value: 0 },
  uNight: { value: 0 },
  uBoost: { value: 0 },
  /** the haze towards the back of the city: from depth x to depth y (in x + z, going back), up to z of the way */
  uHaze: { value: new THREE.Vector3(27, 41, 1) },
  uHazeColor: { value: new THREE.Color('#e2f6ff') },
}

const RAMP = [104, 172, 228, 255]

const VERT_HEAD = /* glsl */ `
attribute vec4 aFx;
attribute vec3 aPush;
uniform float uInk;
varying vec4 vFx;
varying vec3 vW;
varying vec3 vNw;
`
const FRAG_HEAD = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform float uBoost;
uniform vec3 uHaze;
uniform vec3 uHazeColor;
varying vec4 vFx;
varying vec3 vW;
varying vec3 vNw;
float tyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`
const FRAG_BODY = /* glsl */ `
vec3 tyCol = diffuseColor.rgb;
// a marquee bulb: on and off in a chase along its row; all on and brighter in a boost
float tyBulb = 1.0;
if (vFx.z > 0.0) tyBulb = mix(0.32 + 0.68 * step(fract(uTime * 0.9 - vFx.z), 0.5), 1.3, uBoost);
outgoingLight = mix(outgoingLight, tyCol * tyBulb, vFx.x);
// a lamp lights up at night
if (vFx.w > 0.5 && vFx.w < 1.5) outgoingLight = mix(outgoingLight, tyCol * 1.7, uNight);
// a wall of windows (vertical faces only)
if (vFx.w > 1.5) {
  vec3 n = normalize(vNw);
  if (abs(n.y) < 0.5) {
    vec2 t = normalize(vec2(-n.z, n.x));
    vec2 cell = vec2(dot(vW.xz, t) / 0.9, vW.y / 1.15);
    vec2 f = fract(cell);
    float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.26, f.y) * step(f.y, 0.74);
    float lit = step(0.42, tyHash(floor(cell) + floor(vW.xz * 0.07) * 7.0));
    vec3 day = tyCol * 0.42 + vec3(0.1, 0.16, 0.24);
    vec3 night = mix(tyCol * 0.22, vec3(1.55, 1.18, 0.62), lit);
    outgoingLight = mix(outgoingLight, mix(day, night, uNight), win);
  }
}
// a band of shine sweeping across gold
if (vFx.y > 0.0) {
  float band = fract((vW.x - vW.z) * 0.045 + vW.y * 0.07 - uTime * 0.28);
  outgoingLight += tyCol * vFx.y * smoothstep(0.0, 0.025, band) * (1.0 - smoothstep(0.025, 0.075, band)) * 1.25;
}
// the city fades into the sky's horizon colour towards the back
outgoingLight = mix(outgoingLight, uHazeColor, smoothstep(uHaze.x, uHaze.y, -(vW.x + vW.z)) * uHaze.z);
`

let toon: THREE.MeshToonMaterial | null = null
/** the toon material of every opaque model (instanced or not): see the top of the file */
export function toonMaterial() {
  if (toon) return toon
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(RAMP), fog: false })
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, U)
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', 'vec3 transformed = position + aPush * uInk;\nvFx = aFx;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          mat4 tyM = modelMatrix;
          #ifdef USE_INSTANCING
          tyM = tyM * instanceMatrix;
          #endif
          vW = (tyM * vec4(transformed, 1.0)).xyz;
          vNw = normalize(mat3(tyM) * objectNormal);
        }`,
      )
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD).replace('#include <opaque_fragment>', FRAG_BODY + '#include <opaque_fragment>')
  }
  m.customProgramCacheKey = () => 'tycoon-toon'
  return (toon = m)
}

let glass: THREE.MeshBasicMaterial | null = null
/** see-through glass (claw machine fronts, the bar's windows) */
export function glassMaterial() {
  return (glass ??= new THREE.MeshBasicMaterial({ color: '#cdf3ff', transparent: true, opacity: 0.2, depthWrite: false }))
}

let halo: THREE.SpriteMaterial | null = null
/** a soft additive glow (lamps at night, the golden chip, the vault when full) */
export function haloMaterial() {
  return (halo ??= new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd77a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
}

/** frees the shared materials (made again on the next visit) */
export function releaseMaterials() {
  toon?.dispose()
  glass?.dispose()
  halo?.dispose()
  toon = glass = halo = null
  toonRamp(RAMP).dispose()
  glowTexture().dispose()
}

/* ---------------- the kit ---------------- */

/** how a solid is lit: flat = its exact colour; shine = gold sweep; bulb = chase phase (0..1, not 0); lamp; windows */
export interface Look {
  flat?: boolean
  shine?: number
  bulb?: number
  lamp?: boolean
  windows?: boolean
}

interface Solid {
  pos: Float32Array
  nrm: Float32Array
  col: Float32Array
  fx: [number, number, number, number]
  ink: number
}

/**
 * Builds a model as one geometry (position, normal, color, aFx, aPush): add solids in a frame of your own with
 * push(matrix) / pop(), then geometry() or mesh(). `ink` is the outline weight (1 the usual width, 0 none).
 */
export class TKit {
  private readonly solids: Solid[] = []
  private readonly stack: THREE.Matrix4[] = []
  private readonly inkC: THREE.Color

  constructor(ink: THREE.ColorRepresentation = INK) {
    this.inkC = new THREE.Color(ink)
  }

  push(m: THREE.Matrix4) {
    const top = this.stack[this.stack.length - 1]
    this.stack.push(top ? top.clone().multiply(m) : m.clone())
    return this
  }

  pop() {
    this.stack.pop()
    return this
  }

  /** a solid in one colour (times the geometry's own `color` attribute, if it has one) */
  add(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, ink = 1, look: Look = {}) {
    const src = geo.index ? geo.toNonIndexed() : geo.clone()
    geo.dispose()
    if (!src.getAttribute('normal')) src.computeVertexNormals()
    const top = this.stack[this.stack.length - 1]
    const mm = top && m ? top.clone().multiply(m) : (top ?? m)
    if (mm) src.applyMatrix4(mm)
    const p = src.getAttribute('position')
    const n = src.getAttribute('normal')
    const own = src.getAttribute('color')
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
    keep.forEach((v, j) => {
      pos[j * 3] = p.getX(v)
      pos[j * 3 + 1] = p.getY(v)
      pos[j * 3 + 2] = p.getZ(v)
      nrm[j * 3] = n.getX(v)
      nrm[j * 3 + 1] = n.getY(v)
      nrm[j * 3 + 2] = n.getZ(v)
      col[j * 3] = own ? own.getX(v) * c.r : c.r
      col[j * 3 + 1] = own ? own.getY(v) * c.g : c.g
      col[j * 3 + 2] = own ? own.getZ(v) * c.b : c.b
    })
    src.dispose()
    const fx: Solid['fx'] = [look.flat ? 1 : 0, look.shine ?? 0, look.bulb ?? 0, look.windows ? 2 : look.lamp ? 1 : 0]
    this.solids.push({ pos, nrm, col, fx, ink })
    return this
  }

  /** everything added, with the ink hulls, as one non-indexed geometry */
  geometry() {
    let total = 0
    for (const s of this.solids) total += (s.pos.length / 3) * (s.ink > 0 ? 2 : 1)
    const pos = new Float32Array(total * 3)
    const nrm = new Float32Array(total * 3)
    const col = new Float32Array(total * 3)
    const fx = new Float32Array(total * 4)
    const push = new Float32Array(total * 3)
    let o = 0
    for (const s of this.solids) {
      const n = s.pos.length / 3
      pos.set(s.pos, o * 3)
      nrm.set(s.nrm, o * 3)
      col.set(s.col, o * 3)
      for (let i = 0; i < n; i++) fx.set(s.fx, (o + i) * 4)
      o += n
    }
    for (const s of this.solids) {
      if (s.ink <= 0) continue
      const n = s.pos.length / 3
      const dir = pushDirections(s.pos)
      for (let i = 0; i < n; i += 3) {
        // the hull: the same triangles turned inside out (2nd and 3rd corner swapped), in flat ink
        for (const [k, src] of [
          [0, i],
          [1, i + 2],
          [2, i + 1],
        ] as const) {
          const d = (o + i + k) * 3
          pos[d] = s.pos[src * 3]
          pos[d + 1] = s.pos[src * 3 + 1]
          pos[d + 2] = s.pos[src * 3 + 2]
          nrm[d] = -s.nrm[src * 3]
          nrm[d + 1] = -s.nrm[src * 3 + 1]
          nrm[d + 2] = -s.nrm[src * 3 + 2]
          col[d] = this.inkC.r
          col[d + 1] = this.inkC.g
          col[d + 2] = this.inkC.b
          push[d] = dir[src * 3] * s.ink
          push[d + 1] = dir[src * 3 + 1] * s.ink
          push[d + 2] = dir[src * 3 + 2] * s.ink
          fx[(o + i + k) * 4] = 1
        }
      }
      o += n
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 4))
    g.setAttribute('aPush', new THREE.BufferAttribute(push, 3))
    g.computeBoundingSphere()
    g.computeBoundingBox()
    this.solids.length = 0
    return g
  }

  mesh(name: string, mat: THREE.Material = toonMaterial()) {
    const m = new THREE.Mesh(this.geometry(), mat)
    m.name = name
    return m
  }
}

/**
 * Where to push each corner of a solid for its outline: the angle-weighted average of the faces meeting there,
 * lengthened so each of those faces moves out by one (capped, so sharp tips don't spike).
 */
function pushDirections(pos: Float32Array) {
  const n = pos.length / 3
  const key = (i: number) => `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`
  const keys: string[] = new Array(n)
  for (let i = 0; i < n; i++) keys[i] = key(i)
  const acc = new Map<string, THREE.Vector3>()
  const faces = new Map<string, THREE.Vector3[]>()
  const a = V()
  const b = V()
  const c = V()
  const e1 = V()
  const e2 = V()
  for (let i = 0; i < n; i += 3) {
    a.fromArray(pos, i * 3)
    b.fromArray(pos, i * 3 + 3)
    c.fromArray(pos, i * 3 + 6)
    const fn = e1.subVectors(b, a).cross(e2.subVectors(c, a)).clone()
    if (fn.lengthSq() < 1e-20) continue
    fn.normalize()
    const corners = [a, b, c]
    for (let k = 0; k < 3; k++) {
      const p = corners[k]
      const q = corners[(k + 1) % 3]
      const r = corners[(k + 2) % 3]
      const ang = e1.subVectors(q, p).angleTo(e2.subVectors(r, p))
      const kk = keys[i + k]
      let v = acc.get(kk)
      if (!v) acc.set(kk, (v = V()))
      v.addScaledVector(fn, ang)
      let list = faces.get(kk)
      if (!list) faces.set(kk, (list = []))
      if (!list.some((x) => x.dot(fn) > 0.999)) list.push(fn)
    }
  }
  const out = new Float32Array(n * 3)
  const done = new Map<string, THREE.Vector3>()
  for (let i = 0; i < n; i++) {
    const kk = keys[i]
    let d = done.get(kk)
    if (!d) {
      d = (acc.get(kk) ?? V(0, 1, 0)).clone()
      if (d.lengthSq() < 1e-12) d.set(0, 1, 0)
      d.normalize()
      let lo = 1
      for (const f of faces.get(kk) ?? []) lo = Math.min(lo, d.dot(f))
      d.multiplyScalar(1 / Math.max(0.45, lo))
      done.set(kk, d)
    }
    out[i * 3] = d.x
    out[i * 3 + 1] = d.y
    out[i * 3 + 2] = d.z
  }
  return out
}

/* ---------------- primitives ---------------- */

/** a rounded box, centred on the origin (one segment per corner: a soft bevel, cheap) */
export const rbox = (w: number, h: number, d: number, r = 0.06, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2) * 0.999)
/** a plain box */
export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
/** a cylinder standing on y = 0 (not centred), radius r (rb at the bottom) and height h */
export function cyl(r: number, h: number, seg = 16, rb = r, open = false) {
  const g = new THREE.CylinderGeometry(r, rb, h, seg, 1, open)
  g.translate(0, h / 2, 0)
  return g
}
export const sphere = (r: number, w = 12, h = 8) => new THREE.SphereGeometry(r, w, h)
/** a lathe from (radius, y) points */
export const lathe = (pts: P2[], n = 18) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(Math.max(1e-4, x), y)), n)
/** a flat outline pushed up along +y by `depth` (lying on y = 0), with a bevel */
export function slabXZ(outline: P2[], depth: number, bevel = 0, curve = 6) {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve })
  g.rotateX(-Math.PI / 2)
  g.translate(0, bevel, 0)
  return g
}
/** a flat outline standing up facing +z, pushed `depth` back from z = 0 */
export function slabXY(outline: P2[], depth: number, bevel = 0, holes: P2[][] = [], curve = 6) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, y]) => new THREE.Vector2(x, y))))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: curve })
  g.translate(0, 0, -depth)
  return g
}
/** a flat shape facing +y at height y (no thickness): decals on tops */
export function flatXZ(outline: P2[], y = 0) {
  const g = new THREE.ShapeGeometry(new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z))))
  g.rotateX(-Math.PI / 2)
  g.translate(0, y, 0)
  g.deleteAttribute('uv')
  return g
}
/** a gable roof: a triangular prism w wide (along x), d deep, h high, its eaves at y = 0 */
export function gable(w: number, d: number, h: number) {
  const g = slabXY(
    [
      [-w / 2, 0],
      [w / 2, 0],
      [0, h],
    ],
    d,
  )
  g.translate(0, 0, d / 2)
  return g
}
/** a tube along points (CatmullRom), radius r */
export function tube(pts: P3[], r: number, seg = 12, radial = 6, closed = false) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => V(...p)), closed), seg, r, radial, closed)
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
/** a star outline */
export function star(cx: number, cy: number, outer: number, inner: number, points = 5, rot = Math.PI / 2): P2[] {
  return Array.from({ length: points * 2 }, (_, i): P2 => {
    const a = rot + (i * Math.PI) / points
    const r = i % 2 ? inner : outer
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]
  })
}
/** colours a geometry per triangle with f(centroid) (made non-indexed) */
export function tint(geo: THREE.BufferGeometry, f: (x: number, y: number, z: number) => THREE.Color) {
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
/** a capsule from a to b (radius r) */
export function limb(k: TKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink = 1, look?: Look) {
  const A = V(...a)
  const B = V(...b)
  const len = Math.max(0.001, A.distanceTo(B))
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())
  k.add(new THREE.CapsuleGeometry(r, len, 2, r > 0.06 ? 10 : 7), color, new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V(1, 1, 1)), ink, look)
}
/** a row of marquee bulbs along a path (flat, blooming, chasing) */
export function bulbs(k: TKit, pts: P3[], r: number, color: THREE.ColorRepresentation = C('#ffe9a8', 1.6), phase0 = 0) {
  pts.forEach((p, i) => k.add(sphere(r, 6, 4), color, T(p), 0, { flat: true, bulb: phase0 + 0.01 + ((i % 6) / 6) * 0.98 }))
}
/** n points spaced along a polyline */
export function along(pts: P3[], n: number): P3[] {
  const segs = pts.slice(1).map((p, i) => V(...p).distanceTo(V(...pts[i])))
  const total = segs.reduce((a, b) => a + b, 0)
  const out: P3[] = []
  for (let k = 0; k < n; k++) {
    let want = (n === 1 ? 0.5 : k / (n - 1)) * total
    let i = 0
    while (i < segs.length - 1 && want > segs[i]) want -= segs[i++]
    const t = segs[i] ? want / segs[i] : 0
    const a = pts[i]
    const b = pts[i + 1]
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
  return out
}

/* ---------------- an instanced batch ---------------- */

const WHITE = new THREE.Color(1, 1, 1)

/**
 * Up to `cap` copies of one geometry in one draw: each frame begin(), put() each copy, end(). Nothing is allocated
 * per frame. The geometry is the caller's (dispose() frees only the instance buffers).
 */
export class Batch {
  readonly mesh: THREE.InstancedMesh
  private n = 0

  constructor(
    geo: THREE.BufferGeometry,
    readonly cap: number,
    mat: THREE.Material = toonMaterial(),
    name = '',
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.name = name
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  begin() {
    this.n = 0
  }

  put(m: THREE.Matrix4, color: THREE.Color = WHITE) {
    if (this.n >= this.cap) return false
    this.mesh.setMatrixAt(this.n, m)
    this.mesh.setColorAt(this.n, color)
    this.n++
    return true
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  dispose() {
    this.mesh.dispose()
  }
}

/* ---------------- canvas text ---------------- */

export const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'

/** a canvas texture; drawn again once the web font has loaded if it was not ready yet */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, font = `800 40px ${FONT}`) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  draw(g)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (document.fonts && !document.fonts.check(font))
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

/** text centred on (x, y), shrunk to fit maxW; returns the size used */
export function fitText(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, maxW: number, weight = 800, track = 0) {
  let s = size
  g.font = `${weight} ${s}px ${FONT}`
  const w0 = g.measureText(text).width + track * s * (text.length - 1)
  if (w0 > maxW) {
    s *= maxW / w0
    g.font = `${weight} ${s}px ${FONT}`
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${track * s}px`
  g.fillText(text, x, y)
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = '0px'
  return s
}

/** a rounded rectangle path on a canvas */
export function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/** a plane of text (a canvas texture) w × h world units, facing +z, unlit; `glow` > 1 makes it bloom */
export function textPlane(w: number, h: number, px: number, draw: (g: CanvasRenderingContext2D, cw: number, ch: number) => void, glow = 1) {
  const cw = Math.round(px)
  const ch = Math.round((px * h) / w)
  const tex = canvasTexture(cw, ch, (g) => draw(g, cw, ch))
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.04, depthWrite: true })
  mat.color.setScalar(glow)
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat)
  return m
}

/** frees a textPlane's texture, material and geometry */
export function disposeTextPlane(m: THREE.Mesh) {
  const mat = m.material as THREE.MeshBasicMaterial
  mat.map?.dispose()
  mat.dispose()
  m.geometry.dispose()
}
