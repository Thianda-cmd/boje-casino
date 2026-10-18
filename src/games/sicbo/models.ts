import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'
import { BOJE_B } from '../../art/brand'
import { COVE, DOME_R, FLAT_R, HALF, ROUND } from './physics'
import type { Die } from './rules'

/*
  The Sic Bo dome, built in code (no files). Premium and clean rather than toon: physically based materials lit by a
  studio environment generated here, a dark room with a broad softbox overhead, a cool strip to the left, a warm one
  behind to the right, a little warm fill from the front and a ruby glow from the table, prefiltered (PMREM) so the
  gold, the lacquer and the dice's gloss pick up the same lights the glass mirrors.

  - The dice: ivory cubes with rounded edges, glossy like cast resin, the pips drilled in (a normal map gives each a
    flat floor, a steep wall and a rounded lip) and inked, the 1 and the 4 in red as on Chinese dice. One atlas holds
    all six faces.
  - The glass: a clear hemisphere with a fresnel rim and the studio's softboxes mirrored in it (the same lights,
    worked out in its shader, so they can slide across it as it shakes), its far wall seen faintly through the near.
  - The pedestal: a gold collar holding the glass, on a gold plinth with a ruby lacquer band and the Boje gem on its
    front, a faceted emerald with a gold B.
  - The floor: jade felt with a gold ring printed round its edge and the gem's outline faint in the middle, turning
    up at the edge into a steep felt cove that meets the glass.

  Textures, materials and geometry are cached for the next visit; releaseModels() lets go of their GPU copies when the
  scene closes (as the other 3D games do). The environment belongs to its renderer and goes with the scene.
*/

/** the glass's outer surface stands this far outside the sphere the dice bounce off (its thickness) */
export const GLASS_T = 0.035
const INK = '#16131b'
const RED = '#b0122a'

/* ---------------- the studio ---------------- */

/** the studio's lights: direction (towards the light), half-size across and along (tangents), colour, strength */
const PANELS: { dir: [number, number, number]; size: [number, number]; color: [number, number, number]; k: number }[] = [
  // the broad softbox overhead, a little to the front
  { dir: [0, 1, 0.32], size: [0.62, 0.42], color: [1, 0.95, 0.88], k: 2.6 },
  // a tall cool strip to the left
  { dir: [-1, 0.32, 0.38], size: [0.13, 0.75], color: [0.86, 0.92, 1], k: 2.2 },
  // a warm strip behind to the right (the rim on the gold and the glass)
  { dir: [1, 0.36, -0.55], size: [0.11, 0.7], color: [1, 0.78, 0.5], k: 1.9 },
  // soft warm fill from behind the camera
  { dir: [0.15, 0.28, 1], size: [0.7, 0.24], color: [1, 0.86, 0.7], k: 0.9 },
]

const glslVec = (v: readonly number[]) => `vec3(${v.map((x) => x.toFixed(4)).join(', ')})`
function panelCode() {
  return PANELS.map((p) => {
    const d = new THREE.Vector3(...p.dir).normalize()
    const hint = Math.abs(d.y) > 0.9 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
    const e1 = new THREE.Vector3().crossVectors(hint, d).normalize()
    const e2 = new THREE.Vector3().crossVectors(d, e1).normalize()
    const tx = Math.tan(p.size[0]).toFixed(4)
    const ty = Math.tan(p.size[1]).toFixed(4)
    const col = glslVec(p.color.map((c) => c * p.k))
    return `  { float z = dot(r, ${glslVec(d.toArray())}); if (z > 0.0) { vec2 q = abs(vec2(dot(r, ${glslVec(e1.toArray())}), dot(r, ${glslVec(e2.toArray())})) / z) / vec2(${tx}, ${ty}); c += ${col} * (1.0 - smoothstep(0.9, 1.0, q.x)) * (1.0 - smoothstep(0.86, 1.0, q.y)); } }`
  }).join('\n')
}

/** `vec3 studio(vec3 r)`: the light arriving from direction r (a unit vector, world space) */
export const STUDIO_GLSL = /* glsl */ `
vec3 studio(vec3 r) {
  // the dark room: warm brown overhead, near black at the horizon, a ruby glow off the table below
  vec3 c = mix(vec3(0.05, 0.012, 0.018), vec3(0.03, 0.02, 0.018), smoothstep(-0.05, 0.7, r.y));
  c += vec3(0.16, 0.025, 0.035) * smoothstep(0.05, -0.5, r.y);
  c *= 0.8 + 0.2 * smoothstep(-1.0, 1.0, r.z);
${panelCode()}
  return c;
}`

/**
 * The studio as a prefiltered environment for this renderer: a big sphere painted by studio() from inside, captured
 * by PMREMGenerator. The caller owns the render target (its texture is the environment) and disposes it.
 */
export function studioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget {
  const scene = new THREE.Scene()
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vD;\n${STUDIO_GLSL}\nvoid main() { gl_FragColor = vec4(studio(normalize(vD)), 1.0); }`,
    side: THREE.BackSide,
    depthWrite: false,
  })
  const geo = new THREE.SphereGeometry(40, 64, 32)
  scene.add(new THREE.Mesh(geo, mat))
  const pmrem = new THREE.PMREMGenerator(renderer)
  const rt = pmrem.fromScene(scene, 0.02, 0.1, 100)
  pmrem.dispose()
  geo.dispose()
  mat.dispose()
  return rt
}

/* ---------------- the dice ---------------- */

/** where the pips sit on each face, in units of half the face (up is +) */
const PIPS: Readonly<Record<Die, readonly [number, number][]>> = {
  1: [[0, 0]],
  2: [
    [0.5, 0.5],
    [-0.5, -0.5],
  ],
  3: [
    [0.5, 0.5],
    [0, 0],
    [-0.5, -0.5],
  ],
  4: [
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ],
  5: [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0, 0],
    [-0.5, -0.5],
    [0.5, -0.5],
  ],
  6: [
    [-0.5, 0.56],
    [0.5, 0.56],
    [-0.5, 0],
    [0.5, 0],
    [-0.5, -0.56],
    [0.5, -0.56],
  ],
}
/** a pip's radius (the 1 is the big red one) and its ink */
const pipR = (f: Die) => (f === 1 ? 0.3 : 0.165)
const pipInk = (f: Die) => (f === 1 || f === 4 ? RED : INK)
/** each face's cell in the atlas (3 across, 2 down) */
const cellOf = (f: Die) => [(f - 1) % 3, Math.floor((f - 1) / 3)] as const

/**
 * Each face's own axes on the die (u to the right, v up as you look at it), outward normal = u × v; matching
 * physics.ts's FACE_AXIS (1 up, 6 down, 2 front, 5 back, 3 right, 4 left).
 */
const FACE_FRAME: Readonly<Record<Die, readonly [THREE.Vector3Tuple, THREE.Vector3Tuple, THREE.Vector3Tuple]>> = {
  1: [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  6: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  2: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  5: [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  3: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  4: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
}

let diceGeo: THREE.BufferGeometry | null = null
/**
 * A die: the cube's surface pushed out round its edges and corners onto the rounded shape (each point of the
 * squared-off cube is moved onto the ball of radius ROUND round its nearest point of the inner cube), dense along the
 * edges and plain across the faces, each face mapped onto its cell of the atlas.
 */
export function diceGeometry() {
  if (diceGeo) return diceGeo
  const core = HALF - ROUND
  // along an edge of a face: the rounded band in even steps of angle, the flat between in two
  const K = 5
  const ticks: number[] = []
  for (let k = K; k >= 1; k--) ticks.push(-(core + ROUND * Math.tan(((Math.PI / 4) * k) / K)))
  ticks.push(-core, 0, core)
  for (let k = 1; k <= K; k++) ticks.push(core + ROUND * Math.tan(((Math.PI / 4) * k) / K))
  const M = ticks.length
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const v = new THREE.Vector3()
  const inner = new THREE.Vector3()
  for (const f of [1, 2, 3, 4, 5, 6] as Die[]) {
    const [n, a, b] = FACE_FRAME[f].map((x) => new THREE.Vector3(...x))
    const [cx, cy] = cellOf(f)
    const base = pos.length / 3
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        v.copy(n).multiplyScalar(HALF).addScaledVector(a, ticks[i]).addScaledVector(b, ticks[j])
        inner.set(THREE.MathUtils.clamp(v.x, -core, core), THREE.MathUtils.clamp(v.y, -core, core), THREE.MathUtils.clamp(v.z, -core, core))
        const d = v.clone().sub(inner).normalize()
        const p = inner.clone().addScaledVector(d, ROUND)
        pos.push(p.x, p.y, p.z)
        nor.push(d.x, d.y, d.z)
        // the face's own (u, v) in 0-1, into its cell (the canvas's rows run down, the texture's v up)
        const fu = (ticks[i] + HALF) / (2 * HALF)
        const fv = (ticks[j] + HALF) / (2 * HALF)
        uv.push((cx + fu) / 3, 1 - (cy + 1 - fv) / 2)
      }
    for (let j = 0; j < M - 1; j++)
      for (let i = 0; i < M - 1; i++) {
        const p0 = base + j * M + i
        idx.push(p0, p0 + 1, p0 + M + 1, p0, p0 + M + 1, p0 + M)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  diceGeo = g
  return g
}

let diceMaps: { color: THREE.CanvasTexture; normal: THREE.CanvasTexture; size: number } | null = null
let diceMat: THREE.MeshPhysicalMaterial | null = null

const hexRgb = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

/**
 * Paints the atlas, pixel by pixel: ivory with the faintest warm mottling, each pip a drilled dimple (its normal
 * tilting in towards the middle, steepest at the rim, a soft lip round it) inked red or near black, darker down its
 * walls where less light reaches.
 */
function paintDice(S: number) {
  const W = S * 3
  const H = S * 2
  const mk = () => {
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    return c
  }
  const cc = mk()
  const nc = mk()
  const ci = new ImageData(W, H)
  const ni = new ImageData(W, H)
  const ivory = [243, 235, 219]
  const aa = 2.2 / S
  // a little smooth value noise for the ivory's mottle
  const hash = (x: number, y: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x)
    const iy = Math.floor(y)
    const fx = x - ix
    const fy = y - iy
    const ux = fx * fx * (3 - 2 * fx)
    const uy = fy * fy * (3 - 2 * fy)
    const a = hash(ix, iy) + (hash(ix + 1, iy) - hash(ix, iy)) * ux
    const b = hash(ix, iy + 1) + (hash(ix + 1, iy + 1) - hash(ix, iy + 1)) * ux
    return a + (b - a) * uy
  }
  for (const f of [1, 2, 3, 4, 5, 6] as Die[]) {
    const [cx, cy] = cellOf(f)
    const pr = pipR(f)
    const ink = hexRgb(pipInk(f))
    const pips = PIPS[f]
    for (let py = 0; py < S; py++)
      for (let px = 0; px < S; px++) {
        const u = ((px + 0.5) / S) * 2 - 1
        const v = 1 - ((py + 0.5) / S) * 2
        const o = ((cy * S + py) * W + cx * S + px) * 4
        const m = 0.985 + 0.03 * noise(u * 5 + f * 9, v * 5) + 0.012 * noise(u * 23, v * 23 + f)
        let r = ivory[0] * m
        let g = ivory[1] * m
        let b = ivory[2] * m * 0.995
        let nx = 0
        let ny = 0
        for (const [qx, qy] of pips) {
          const dx = u - qx
          const dy = v - qy
          const d = Math.hypot(dx, dy)
          if (d > pr * 1.25) continue
          // a drilled hole: a flat floor of paint, a steep wall round it (in shadow, darker), a rounded lip at the rim
          // (a bowl would read as a bead under a light from the front)
          const inside = 1 - Math.min(1, Math.max(0, (d - pr + aa) / (2 * aa)))
          const wall = Math.min(1, Math.max(0, (d - pr * 0.6) / (pr * 0.4)))
          const shade = 1 - 0.42 * wall * wall
          r = r * (1 - inside) + ink[0] * shade * inside
          g = g * (1 - inside) + ink[1] * shade * inside
          b = b * (1 - inside) + ink[2] * shade * inside
          const lip = Math.max(0, 1 - Math.abs(d - pr * 1.06) / (pr * 0.1))
          r *= 1 - 0.1 * lip * (1 - inside)
          g *= 1 - 0.1 * lip * (1 - inside)
          b *= 1 - 0.1 * lip * (1 - inside)
          // the slope, its normal leaning in towards the middle: nothing on the floor, steepest down the wall, easing
          // out over the lip
          const x = (d - pr * 0.58) / (pr * 0.6)
          const slope = x <= 0 || x >= 1 ? 0 : 2.6 * Math.sin(Math.PI * x) ** 1.5
          if (d > 1e-6) {
            nx -= (dx / d) * slope
            ny -= (dy / d) * slope
          }
        }
        ci.data[o] = Math.min(255, r)
        ci.data[o + 1] = Math.min(255, g)
        ci.data[o + 2] = Math.min(255, b)
        ci.data[o + 3] = 255
        const l = Math.hypot(nx, ny, 1)
        ni.data[o] = ((nx / l) * 0.5 + 0.5) * 255
        ni.data[o + 1] = ((ny / l) * 0.5 + 0.5) * 255
        ni.data[o + 2] = ((1 / l) * 0.5 + 0.5) * 255
        ni.data[o + 3] = 255
      }
  }
  cc.getContext('2d')!.putImageData(ci, 0, 0)
  nc.getContext('2d')!.putImageData(ni, 0, 0)
  const color = new THREE.CanvasTexture(cc)
  color.colorSpace = THREE.SRGBColorSpace
  color.anisotropy = 4
  const normal = new THREE.CanvasTexture(nc)
  normal.anisotropy = 4
  return { color, normal, size: S }
}

/** the size of a face in the dice atlas for this device */
export const faceSize = () => (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 256 : 512)

/** the dice's material: ivory resin under a clear gloss */
export function diceMaterial() {
  const S = faceSize()
  if (!diceMaps || diceMaps.size !== S) {
    diceMaps?.color.dispose()
    diceMaps?.normal.dispose()
    diceMaps = paintDice(S)
    diceMat?.dispose()
    diceMat = null
  }
  return (diceMat ??= new THREE.MeshPhysicalMaterial({
    map: diceMaps.color,
    normalMap: diceMaps.normal,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 0.36,
    clearcoat: 0.85,
    clearcoatRoughness: 0.1,
    envMapIntensity: 0.9,
  }))
}

/* ---------------- the glass ---------------- */

const GLASS_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const GLASS_FRAG = /* glsl */ `
uniform float uK;
uniform float uFar;
uniform mat3 uTurn;
uniform vec3 uFlash;
varying vec3 vN;
varying vec3 vW;
${STUDIO_GLSL}
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(cameraPosition - vW);
  // the far wall is seen from inside: its surface faces the camera the other way
  if (dot(N, V) < 0.0) N = -N;
  float nv = clamp(dot(N, V), 0.0, 1.0);
  float F = 0.04 + 0.96 * pow(1.0 - nv, 5.0);
  // the studio mirrored, turned a touch as the dome rattles (its highlights slide over the glass)
  vec3 R = uTurn * reflect(-V, N);
  vec3 env = studio(R);
  // the glass's own thin rim: brighter (it is seen through more glass), faintly warm, a fine bright line at the very
  // edge of the silhouette
  float edge = pow(1.0 - nv, 2.5);
  vec3 col = env * F * 1.8 + vec3(0.09, 0.075, 0.06) * edge + vec3(0.5, 0.44, 0.36) * pow(1.0 - nv, 12.0) + uFlash * (0.25 + edge);
  col *= uK * mix(1.0, uFar, step(0.5, float(gl_FrontFacing == false)));
  // it darkens what is behind it a little at grazing angles, almost not at all face on
  float a = clamp(F * 0.7 + edge * 0.18, 0.0, 0.85) * uK;
  gl_FragColor = vec4(col, a);
}`

export interface GlassUniforms {
  /** how much of the glass shows (1 normally; less when the camera leans in to read the dice) */
  uK: { value: number }
  /** the far wall's share of that */
  uFar: { value: number }
  /** a turn of the mirrored studio (the highlights' slide as the dome shakes) */
  uTurn: { value: THREE.Matrix3 }
  /** light thrown on the glass (a lightning strike's) */
  uFlash: { value: THREE.Color }
}

let glassGeo: THREE.BufferGeometry | null = null
/**
 * The glass: one hemisphere drawn twice, the far wall (back faces) first and faint, then the near one, each adding
 * its reflections over what lies behind (premultiplied: the rim darkens the view a touch, the face barely).
 */
export function domeGlass(u: GlassUniforms) {
  glassGeo ??= new THREE.SphereGeometry(DOME_R + GLASS_T, 96, 40, 0, Math.PI * 2, 0, Math.PI / 2)
  const make = (side: THREE.Side, order: number) => {
    const m = new THREE.ShaderMaterial({
      uniforms: u as unknown as Record<string, THREE.IUniform>,
      vertexShader: GLASS_VERT,
      fragmentShader: GLASS_FRAG,
      transparent: true,
      depthWrite: false,
      side,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    const mesh = new THREE.Mesh(glassGeo!, m)
    mesh.renderOrder = order
    return mesh
  }
  return [make(THREE.BackSide, 6), make(THREE.FrontSide, 7)] as const
}

/* ---------------- the pedestal ---------------- */

let goldMat: THREE.MeshPhysicalMaterial | null = null
let rubyMat: THREE.MeshPhysicalMaterial | null = null
let gemMat: THREE.MeshPhysicalMaterial | null = null
export function goldMaterial() {
  return (goldMat ??= new THREE.MeshPhysicalMaterial({ color: '#f4d48a', metalness: 1, roughness: 0.27, envMapIntensity: 1.15 }))
}
function rubyMaterial() {
  return (rubyMat ??= new THREE.MeshPhysicalMaterial({ color: '#7d0a1d', roughness: 0.42, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1 }))
}
function gemMaterial() {
  return (gemMat ??= new THREE.MeshPhysicalMaterial({ color: '#1fcf73', emissive: '#04361b', roughness: 0.06, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.8, flatShading: true }))
}

/**
 * A lathe profile with rounded corners: points (radius, height) with the radius of the round at each; traced
 * anticlockwise in the (radius, height) plane, so the lathe's normals face out.
 */
function profile(pts: readonly [number, number, number][], seg = 6) {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < pts.length; i++) {
    const [x, y, r] = pts[i]
    if (!r || i === 0 || i === pts.length - 1) {
      out.push(new THREE.Vector2(x, y))
      continue
    }
    const p = new THREE.Vector2(x, y)
    const a = new THREE.Vector2(pts[i - 1][0], pts[i - 1][1]).sub(p)
    const b = new THREE.Vector2(pts[i + 1][0], pts[i + 1][1]).sub(p)
    const ra = Math.min(r, a.length() / 2)
    const rb = Math.min(r, b.length() / 2)
    const p0 = p.clone().addScaledVector(a.normalize(), ra)
    const p1 = p.clone().addScaledVector(b.normalize(), rb)
    // a quadratic curve from p0 to p1 with its control at the corner
    for (let s = 0; s <= seg; s++) {
      const t = s / seg
      out.push(new THREE.Vector2((1 - t) ** 2 * p0.x + 2 * (1 - t) * t * p.x + t * t * p1.x, (1 - t) ** 2 * p0.y + 2 * (1 - t) * t * p.y + t * t * p1.y))
    }
  }
  return out
}

let collarGeo: THREE.BufferGeometry | null = null
/** the gold collar the glass stands in (it moves with the dome) */
export function collar() {
  collarGeo ??= new THREE.LatheGeometry(
    profile([
      [DOME_R + 0.42, -0.14, 0],
      [DOME_R + 0.44, 0.04, 0.06],
      [DOME_R + 0.24, 0.17, 0.09],
      [DOME_R + 0.08, 0.15, 0.04],
      [DOME_R + 0.01, 0.09, 0.02],
      [DOME_R + 0.01, -0.06, 0],
    ]),
    160,
  )
  const m = new THREE.Mesh(collarGeo, goldMaterial())
  m.receiveShadow = true
  return m
}

/** the plinth's height below the felt, to the table */
export const PLINTH_H = 1.3
let plinthGeo: THREE.BufferGeometry | null = null
let bandGeo: THREE.BufferGeometry | null = null
let emblemGeos: THREE.BufferGeometry[] | null = null

/** the Boje gem: a hexagon (point up) cut into six facets rising to a flat table, in a gold bezel, a gold B on top */
function emblemGeometries() {
  if (emblemGeos) return emblemGeos
  const R = 0.36
  // (anticlockwise as seen from the front, so the facets face out)
  const hex = (r: number, z: number) => Array.from({ length: 6 }, (_, i) => new THREE.Vector3(-Math.sin((i * Math.PI) / 3) * r, Math.cos((i * Math.PI) / 3) * r, z))
  // the stone: facets from the girdle up to the table, and the table
  const girdle = hex(R, 0.02)
  const table = hex(R * 0.5, 0.15)
  const pts: number[] = []
  for (let i = 0; i < 6; i++) {
    const a = girdle[i]
    const b = girdle[(i + 1) % 6]
    const c = table[(i + 1) % 6]
    const d = table[i]
    pts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...a.toArray(), ...c.toArray(), ...d.toArray())
    pts.push(0, 0, 0.15, ...d.toArray(), ...c.toArray())
  }
  const stone = new THREE.BufferGeometry()
  stone.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  stone.computeVertexNormals()
  // the bezel: a hexagonal ring round it, and a plate behind
  const ring = new THREE.Shape()
  hex(R + 0.09, 0).forEach((p, i) => (i ? ring.lineTo(p.x, p.y) : ring.moveTo(p.x, p.y)))
  ring.closePath()
  const hole = new THREE.Path()
  hex(R - 0.01, 0).forEach((p, i) => (i ? hole.lineTo(p.x, p.y) : hole.moveTo(p.x, p.y)))
  hole.closePath()
  ring.holes.push(hole)
  const bezel = new THREE.ExtrudeGeometry(ring, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.02, bevelSegments: 3, curveSegments: 1 })
  bezel.translate(0, 0, -0.04)
  // the B, from the brand's path (a 32 box, y down), standing on the table
  const svg = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="${BOJE_B}"/></svg>`)
  const shapes = svg.paths.flatMap((p) => SVGLoader.createShapes(p))
  const b = new THREE.ExtrudeGeometry(shapes, { depth: 0.6, bevelEnabled: true, bevelThickness: 0.25, bevelSize: 0.22, bevelSegments: 2, curveSegments: 6 })
  // (mirrored in y and z: a half turn, so the faces keep their winding and the B reads the right way round)
  const k = 0.0175
  b.translate(-15.7, -16, 0)
  b.scale(k, -k, -k)
  b.translate(0, 0, 0.16 + (0.6 + 0.25) * k)
  emblemGeos = [stone, bezel, b]
  return emblemGeos
}

/** the plinth under the dome (it stays put while the dome rattles): gold, a ruby band, the gem on the front */
export function plinth() {
  const g = new THREE.Group()
  const top = DOME_R + 0.36
  plinthGeo ??= new THREE.LatheGeometry(
    profile([
      [0.01, -PLINTH_H, 0],
      [top + 0.62, -PLINTH_H, 0.04],
      [top + 0.64, -PLINTH_H + 0.1, 0.04],
      [top + 0.42, -PLINTH_H + 0.26, 0.18],
      [top + 0.26, -PLINTH_H + 0.36, 0.06],
      [top + 0.3, -PLINTH_H + 0.44, 0.04],
      [top + 0.22, -PLINTH_H + 0.47, 0],
      [top + 0.22, -0.36, 0],
      [top + 0.3, -0.32, 0.04],
      [top + 0.26, -0.22, 0.06],
      [top + 0.06, -0.15, 0.08],
      [top - 0.02, -0.14, 0.02],
      [0.01, -0.14, 0],
    ]),
    160,
  )
  const gold = new THREE.Mesh(plinthGeo, goldMaterial())
  gold.receiveShadow = true
  g.add(gold)
  // the ruby band between the mouldings
  const bandTop = 0.36
  const bandBottom = PLINTH_H - 0.47
  bandGeo ??= new THREE.CylinderGeometry(top + 0.26, top + 0.26, bandBottom - bandTop, 160, 1, true).translate(0, -(bandTop + bandBottom) / 2, 0)
  g.add(new THREE.Mesh(bandGeo, rubyMaterial()))
  // the gem, on the front of the band
  const [stone, bezel, b] = emblemGeometries()
  const emblem = new THREE.Group()
  emblem.add(new THREE.Mesh(bezel, goldMaterial()), new THREE.Mesh(stone, gemMaterial()), new THREE.Mesh(b, goldMaterial()))
  emblem.position.set(0, -(bandTop + bandBottom) / 2, top + 0.26)
  emblem.scale.setScalar(0.92)
  g.add(emblem)
  return g
}

/* ---------------- the felt ---------------- */

let feltTex: THREE.CanvasTexture | null = null
let feltMat: THREE.MeshStandardMaterial | null = null
let feltGeo: THREE.BufferGeometry | null = null

/** jade felt: a soft pool of colour, a fine nap, a gold ring printed round the edge, the gem faint in the middle */
function paintFelt(S: number) {
  const c = document.createElement('canvas')
  c.width = c.height = S
  const g = c.getContext('2d')!
  const C = S / 2
  const gr = g.createRadialGradient(C, C * 0.92, 0, C, C, C)
  gr.addColorStop(0, '#13684f')
  gr.addColorStop(0.6, '#0d533f')
  gr.addColorStop(1, '#083a2c')
  g.fillStyle = gr
  g.fillRect(0, 0, S, S)
  // the nap: fine fibres of lighter and darker green
  const img = g.getImageData(0, 0, S, S)
  for (let i = 0; i < S * S; i++) {
    const n = (Math.random() - 0.5) * 16 + (Math.random() < 0.02 ? 10 : 0)
    img.data[i * 4] += n * 0.5
    img.data[i * 4 + 1] += n
    img.data[i * 4 + 2] += n * 0.8
  }
  g.putImageData(img, 0, 0)
  // the printed gold: a double ring with beads between, the gem's outline in the middle
  const k = S / (2 * FLAT_R)
  g.strokeStyle = 'rgba(232, 190, 96, 0.8)'
  g.lineWidth = Math.max(1.5, S / 420)
  for (const r of [FLAT_R - 0.1, FLAT_R - 0.3]) {
    g.beginPath()
    g.arc(C, C, r * k, 0, Math.PI * 2)
    g.stroke()
  }
  g.fillStyle = 'rgba(232, 190, 96, 0.75)'
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2
    g.beginPath()
    g.arc(C + Math.cos(a) * (FLAT_R - 0.2) * k, C + Math.sin(a) * (FLAT_R - 0.2) * k, S / 400, 0, Math.PI * 2)
    g.fill()
  }
  g.strokeStyle = 'rgba(232, 190, 96, 0.16)'
  g.lineWidth = S / 300
  g.lineJoin = 'round'
  g.beginPath()
  for (let i = 0; i <= 6; i++) {
    const a = (i * Math.PI) / 3
    const x = C + Math.sin(a) * 0.95 * k
    const y = C - Math.cos(a) * 0.95 * k
    if (i) g.lineTo(x, y)
    else g.moveTo(x, y)
  }
  g.stroke()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

let coveGeo: THREE.BufferGeometry | null = null
let coveMat: THREE.MeshStandardMaterial | null = null
/** the floor of the dome (it moves with it): the felt disc, and the cove rising from it to the glass */
export function domeFloor() {
  feltTex ??= paintFelt(faceSize() >= 512 ? 2048 : 1024)
  feltMat ??= new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.94, envMapIntensity: 0.5 })
  feltGeo ??= new THREE.CircleGeometry(FLAT_R + 0.005, 160).rotateX(-Math.PI / 2)
  const felt = new THREE.Mesh(feltGeo, feltMat)
  felt.receiveShadow = true
  if (!coveGeo) {
    // up the slope from the felt's edge to where it meets the glass (and a little past, behind it)
    const t = Math.tan(COVE)
    let y = 0
    while ((FLAT_R + y / t) ** 2 + y * y < (DOME_R + GLASS_T) ** 2) y += 0.002
    coveGeo = new THREE.LatheGeometry(
      [new THREE.Vector2(DOME_R + GLASS_T + 0.02, y + 0.01), new THREE.Vector2(FLAT_R + 0.02, 0.02), new THREE.Vector2(FLAT_R, 0.002), new THREE.Vector2(FLAT_R - 0.02, 0)],
      160,
    )
  }
  coveMat ??= new THREE.MeshStandardMaterial({ color: '#072e24', roughness: 0.95, envMapIntensity: 0.4 })
  const cove = new THREE.Mesh(coveGeo, coveMat)
  cove.receiveShadow = true
  return [felt, cove] as const
}

/**
 * Lets go of a renderer that is closing: every cached material, texture and geometry holds a 'dispose' listener from
 * each renderer that drew it, and through it the whole renderer. Disposing them drops those listeners and the GPU
 * copies; the objects stay cached for the next visit.
 */
export function releaseModels() {
  diceGeo?.dispose()
  diceMaps?.color.dispose()
  diceMaps?.normal.dispose()
  diceMat?.dispose()
  glassGeo?.dispose()
  goldMat?.dispose()
  rubyMat?.dispose()
  gemMat?.dispose()
  collarGeo?.dispose()
  plinthGeo?.dispose()
  bandGeo?.dispose()
  for (const g of emblemGeos ?? []) g.dispose()
  feltTex?.dispose()
  feltMat?.dispose()
  feltGeo?.dispose()
  coveGeo?.dispose()
  coveMat?.dispose()
}
