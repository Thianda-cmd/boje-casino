import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { isBonus, type BotKind, type Sym } from './rules'
import { SYMBOL_COLOR, valueColor } from './meta'

/*
  The Robo Riot cast and machine: premium vinyl-toy robots, modelled in code and shaded physically (glossy plastic
  with a clear coat, chrome, rubber, glowing LEDs) under a generated workshop environment map.

  How a piece is drawn:
  - Body: every solid part of a model is one mesh in the shared body material. Colour, roughness, metalness,
    clear coat and glow are carried per vertex (attributes color, aSurf, aFx), so plastic, chrome and LEDs draw in
    one call. aFx makes LEDs blink, pulse, chase or flicker on the shared clock (tickModels), each piece out of step
    with its neighbours, so the board stays lively for free.
  - Screen: faces, value displays and anything that glows in a piece's own colour are one mesh per piece in the
    screen material, sampling one atlas (faces for four screen shapes, a glyph font and a solid block). Its red
    channel glows in the vertex colour, green in pink and blue in white. setFace() and setValue() only rewrite a
    few vertices of that piece's own copy of the screen geometry.
  - Glass and plasma: additive layers for the power cell's capsule and the wild's core.
  So a piece draws in 2 to 4 calls. Each model fits a 0.9 cell and faces +z; animated parts are groups that turn
  about their joint, with their rest pose in userData.rest (like Pop Party).
*/

type Geo = THREE.BufferGeometry
type P2 = [number, number]
type P3 = [number, number, number]

const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)

/** position, rotation (radians, XYZ) and scale as a matrix */
function T(p: P3 = [0, 0, 0], r: P3 = [0, 0, 0], s: number | P3 = 1) {
  const sc = typeof s === 'number' ? V(s, s, s) : V(...s)
  return new THREE.Matrix4().compose(V(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r)), sc)
}
/** matrices applied right to left, like a scene graph: mul(parent, child) */
const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.multiply(b), new THREE.Matrix4())

/** a matrix that stands a +y shape on the segment a-b, centred on it */
function aim(a: P3, b: P3) {
  const A = V(...a)
  const B = V(...b)
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), B.clone().sub(A).normalize())
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, V(1, 1, 1))
}
const dist = (a: P3, b: P3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

/* ------------------------------------------------------------------ */
/*  Palette and finishes                                                */
/* ------------------------------------------------------------------ */

const WHITE = '#f4f2ee'
const GRAPH = '#2a2f3b'
const INKY = '#15181f'
const CHROME_C = '#eef2f8'
const STEEL_C = '#a9b3c2'
const GOLD_C = '#ffc65a'
const COPPER_C = '#f08c5a'
const HAZARD = '#ffc21a'

/** how a surface catches the light: roughness, metalness, clear coat, glow (emissive gain on its colour), fx */
interface Finish {
  r: number
  m: number
  c: number
  g: number
  fx: number
}
const fin = (r: number, m: number, c: number, g = 0, fx = 0): Finish => ({ r, m, c, g, fx })
/** candy vinyl with a clear coat */
const GLOSS = fin(0.3, 0, 1)
const SATIN = fin(0.5, 0, 0.35)
/** painted sheet metal */
const PAINT = fin(0.42, 0.2, 0.55)
const RUBBER = fin(0.8, 0, 0.04)
const CHROME = fin(0.16, 1, 0)
const STEEL = fin(0.34, 1, 0)
/** anodised aluminium: tinted metal under a clear coat */
const ANOD = fin(0.4, 0.45, 0.35)
const GOLD = fin(0.2, 1, 0.5)
const COPPER = fin(0.24, 1, 0.3)
/** an LED or a lit panel: `g` is how hard it glows (bloom starts near 1), `fx` how it animates */
const lit = (g: number, fx = 0) => fin(0.35, 0, 0.3, g, fx)
/** LED animations (aFx = mode + phase, phase in 0..0.95) */
export const FX = { steady: 0, blink: 1, pulse: 2, chase: 3, flicker: 4, fill: 5 } as const

/* ------------------------------------------------------------------ */
/*  Materials                                                           */
/* ------------------------------------------------------------------ */

/** the clock every LED, plasma and screen runs on; tickModels() moves it */
const uTime = { value: 0 }
const uPink = { value: new THREE.Color('#ff5aa5') }
/** how strongly the body materials reflect the environment (the map itself is a dim night workshop) */
const ENV = 1

const BODY_VERT_PARS = /* glsl */ `
attribute vec4 aSurf;
attribute float aFx;
varying vec4 vSurf;
varying float vFx;
varying vec3 vWp;
varying float vSeed;`
const BODY_VERT = /* glsl */ `
vSurf = aSurf;
vFx = aFx;
{
  mat4 mw = modelMatrix;
  #ifdef USE_INSTANCING
  mw = modelMatrix * instanceMatrix;
  #endif
  vWp = (mw * vec4(transformed, 1.0)).xyz;
  vSeed = fract(sin(dot(mw[3].xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}`
const BODY_FRAG_PARS = /* glsl */ `
uniform float uTime;
uniform float uAlert;
varying vec4 vSurf;
varying float vFx;
varying vec3 vWp;
varying float vSeed;
float fxGain() {
  if (vFx < 0.5) return 1.0;
  float mode = floor(vFx + 0.001);
  float ph = vFx - mode;
  float t = uTime + vSeed * 9.0;
  if (mode < 1.5) return 0.1 + 0.9 * step(0.4, fract(t * 0.55 + ph));
  if (mode < 2.5) return 0.4 + 0.6 * (0.5 + 0.5 * sin(t * 3.2 + ph * 6.2832));
  if (mode < 3.5) return 0.15 + 0.85 * step(0.5, fract(vWp.x * 1.25 + vWp.y * 0.6 - uTime * 1.6 + ph));
  if (mode < 4.5) return 0.72 + 0.28 * sin(t * 23.0 + ph * 40.0) * sin(t * 7.3 + ph * 13.0);
  return 0.12 + 0.88 * step(ph, fract(t * 0.38));
}`

/**
 * A punctual light caught in polished chrome or a clear coat is physically a pin-point thousands of times brighter
 * than white; one such pixel blooms into a square. Highlights are clamped to a bright sparkle instead.
 */
const SPARKLE = '#include <lights_fragment_end>\nreflectedLight.directSpecular = min(reflectedLight.directSpecular, vec3(2.2));\nclearcoatSpecularDirect = min(clearcoatSpecularDirect, vec3(2.2));'

/**
 * The body material: colour, roughness, metalness, clear coat and glow per vertex. `physical` adds the clear coat
 * (the cast and Volt); the machine uses the cheaper standard model. `uAlert` (userData.alert) turns its LEDs red.
 */
function makeBody(physical: boolean) {
  const m = physical
    ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 1, metalness: 1, clearcoat: 1, clearcoatRoughness: 0.11 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 })
  m.envMapIntensity = ENV
  const alert = { value: 0 }
  m.userData.alert = alert
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = uTime
    s.uniforms.uAlert = alert
    s.vertexShader = s.vertexShader.replace('#include <common>', `#include <common>\n${BODY_VERT_PARS}`).replace('#include <begin_vertex>', `#include <begin_vertex>\n${BODY_VERT}`)
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\n${BODY_FRAG_PARS}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vSurf.y;')
      .replace('#include <lights_physical_fragment>', THREE.ShaderChunk.lights_physical_fragment.replace('material.clearcoat = clearcoat;', 'material.clearcoat = clearcoat * vSurf.z;'))
      .replace('#include <lights_fragment_end>', SPARKLE)
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
{
  vec3 glowCol = vColor.rgb;
  float lum = max(max(glowCol.r, glowCol.g), glowCol.b);
  glowCol = mix(glowCol, vec3(1.0, 0.09, 0.05) * lum, uAlert);
  totalEmissiveRadiance += glowCol * vSurf.w * fxGain();
}`,
      )
  }
  m.customProgramCacheKey = () => (physical ? 'rr-body-p' : 'rr-body-s')
  return m
}

/**
 * The screen material: dark glossy glass whose emission comes from the atlas: red glows in the vertex colour, green
 * in pink, blue in white (a face's cells carry a faint red backlight, so a screen glows softly in its tint).
 * userData.gain scales the glow.
 */
function makeScreen(map: THREE.Texture) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#04060a', roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, emissive: '#ffffff', emissiveMap: map, vertexColors: true })
  m.envMapIntensity = 0.45
  const gain = { value: 1.55 }
  m.userData.gain = gain
  m.onBeforeCompile = (s) => {
    s.uniforms.uPink = uPink
    s.uniforms.uGain = gain
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPink;\nuniform float uGain;')
      .replace('#include <color_fragment>', '')
      .replace('#include <lights_fragment_end>', SPARKLE)
      .replace(
        '#include <emissivemap_fragment>',
        `vec4 em = texture2D(emissiveMap, vEmissiveMapUv);
totalEmissiveRadiance = (vColor.rgb * em.r + uPink * em.g + vec3(em.b)) * uGain;`,
      )
  }
  m.customProgramCacheKey = () => 'rr-screen'
  return m
}

/** clear glass: only its reflections and a cool fresnel rim are added to what is behind it */
function makeGlass(rim: THREE.ColorRepresentation = '#3fd9ff', strength = 0.55) {
  const m = new THREE.MeshPhysicalMaterial({ color: '#000000', roughness: 0.05, metalness: 0, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
  m.envMapIntensity = 1.5
  const uRim = { value: C(rim, strength) }
  m.userData.rim = uRim
  m.onBeforeCompile = (s) => {
    s.uniforms.uRim = uRim
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
      .replace('#include <lights_fragment_end>', SPARKLE)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uRim * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);')
  }
  m.customProgramCacheKey = () => 'rr-glass'
  return m
}

/** the wild's plasma: an additive shell with a hot fresnel rim and tendrils that crawl on the clock */
function makePlasma(color: THREE.ColorRepresentation) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vN;\nvarying vec3 vVp;\nvarying vec3 vObj;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvN = normalize(normalMatrix * normal);\nvVp = -mvPosition.xyz;\nvObj = position;')
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nvarying vec3 vN;\nvarying vec3 vVp;\nvarying vec3 vObj;')
      .replace(
        '#include <opaque_fragment>',
        `{
  vec3 p = normalize(vObj);
  float fres = 1.0 - abs(dot(normalize(vN), normalize(vVp)));
  float a = atan(p.y, p.x);
  float w1 = sin(a * 5.0 + p.z * 7.0 + uTime * 2.1 + sin(p.y * 9.0 - uTime * 1.3) * 1.7);
  float w2 = sin(a * 3.0 - p.z * 9.0 - uTime * 1.7 + sin(p.x * 8.0 + uTime) * 2.0);
  float tendril = pow(smoothstep(0.82, 1.0, abs(w1)), 2.0) + pow(smoothstep(0.86, 1.0, abs(w2)), 2.0);
  outgoingLight = diffuseColor.rgb * (0.12 + 1.5 * pow(fres, 2.2) + 2.2 * tendril * (1.0 - 0.6 * fres));
}
#include <opaque_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'rr-plasma'
  return m
}

interface Mats {
  body: THREE.MeshPhysicalMaterial
  screen: THREE.MeshPhysicalMaterial
  glass: THREE.MeshPhysicalMaterial
  plasma: THREE.MeshBasicMaterial
}
let gridMats: Mats | null = null
let stageMats: { body: THREE.MeshPhysicalMaterial; frame: THREE.MeshStandardMaterial; glass: THREE.MeshPhysicalMaterial } | null = null
let envTex: THREE.Texture | null = null
let envRenderer: THREE.WebGLRenderer | null = null

const pbr = (m: THREE.Material): m is THREE.MeshStandardMaterial => m instanceof THREE.MeshStandardMaterial
/** gives the environment map (if made yet) to a new set of materials */
function withEnv<S extends object>(set: S): S {
  if (envTex) for (const m of Object.values(set) as THREE.Material[]) if (pbr(m)) m.envMap = envTex
  return set
}
function grid(): Mats {
  return (gridMats ??= withEnv({ body: makeBody(true) as THREE.MeshPhysicalMaterial, screen: makeScreen(atlas()), glass: makeGlass(), plasma: makePlasma(C(SYMBOL_COLOR.wild, 1.25)) }))
}
function stage() {
  return (stageMats ??= withEnv({
    body: makeBody(true) as THREE.MeshPhysicalMaterial,
    frame: makeBody(false) as THREE.MeshStandardMaterial,
    glass: makeGlass('#57e8ff', 0.35),
  }))
}
/** materials made outside the shared sets (Volt's screen, per-tube neon, the beacon...) that disposeModels() frees */
const extraMats = new Set<THREE.Material>()
const keep = <M extends THREE.Material>(m: M) => {
  extraMats.add(m)
  if (envTex && pbr(m)) m.envMap = envTex
  return m
}

/** every material the grid pieces use, for the scene to clip to the window (stage copies are left out) */
export function allMaterials(): THREE.Material[] {
  const g = grid()
  return [g.body, g.screen, g.glass, g.plasma]
}

/** the materials of one model */
export function symbolMaterials(o: THREE.Object3D) {
  const out = new Set<THREE.Material>()
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) for (const m of Array.isArray(x.material) ? x.material : [x.material]) out.add(m)
  })
  return [...out]
}

/** moves the shared clock (seconds): blinking LEDs, plasma, chase lights; call once per frame */
export function tickModels(t: number) {
  uTime.value = t
}

/** turns the stage LEDs (machine frame, Volt, lever) red for the Power Grid alarm, 0..1; sockets keep their colours */
export function setAlert(a: number) {
  const s = stage()
  s.body.userData.alert.value = a
  s.frame.userData.alert.value = a
}

/* ------------------------------------------------------------------ */
/*  The workshop environment                                            */
/* ------------------------------------------------------------------ */

/**
 * The reflection map: three's RoomEnvironment with neon strips added (magenta to the left, cyan to the right, a warm
 * work lamp overhead), through PMREM. Made once per renderer and given to every PBR material this module makes, so
 * the scene does not need to set scene.environment (it may, with the returned texture). Freed by disposeModels().
 */
export function useEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (envTex && envRenderer === renderer) return envTex
  envTex?.dispose()
  const room = new RoomEnvironment()
  // night in the workshop: the room's lamps turned well down (chrome reflects them without blooming everywhere)
  room.traverse((o) => {
    if (o instanceof THREE.PointLight) o.intensity *= 0.45
    // the panel behind the camera would mirror as a white sheet on every screen: it is nearly off
    if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) o.material.emissiveIntensity *= o.position.z > 10 ? 0.012 : 0.07
  })
  const box = new THREE.BoxGeometry()
  const neon = (color: string, power: number, p: P3, s: P3) => {
    const m = new THREE.Mesh(box, new THREE.MeshLambertMaterial({ color: 0x000000, emissive: color, emissiveIntensity: power }))
    m.position.set(...p)
    m.scale.set(...s)
    room.add(m)
  }
  neon('#ff3fd2', 3.2, [-15.6, 7, -4], [0.12, 1.4, 9])
  neon('#5cf2ff', 3.4, [14.4, 6, 3.5], [0.12, 1.6, 8])
  neon('#ffb45e', 3, [-3, 19.5, 5], [6, 0.1, 1.6])
  neon('#7a5cff', 2.5, [2, 3, -13.6], [9, 1, 0.1])
  const pm = new THREE.PMREMGenerator(renderer)
  envTex = pm.fromScene(room, 0.03).texture
  pm.dispose()
  room.dispose()
  envRenderer = renderer
  const all: THREE.Material[] = [...(gridMats ? Object.values(gridMats) : []), ...(stageMats ? Object.values(stageMats) : []), ...extraMats]
  for (const m of all)
    if (pbr(m)) {
      m.envMap = envTex
      m.needsUpdate = true
    }
  return envTex
}

/**
 * Lights that suit the cast: a warm key from the upper left, a cyan rim from behind on the right and a magenta one
 * on the left, and a little ambient. The scene may use them or its own.
 */
export function makeLights() {
  const g = new THREE.Group()
  const key = new THREE.DirectionalLight('#ffe7cc', 2.4)
  key.position.set(-4, 6, 8)
  const rim = new THREE.DirectionalLight('#5ce8ff', 3.2)
  rim.position.set(6, 3, -6)
  const rim2 = new THREE.DirectionalLight('#ff4fd8', 2.2)
  rim2.position.set(-6, 2, -5)
  const amb = new THREE.AmbientLight('#b8c8ff', 0.25)
  key.name = 'key'
  rim.name = 'rim'
  rim2.name = 'rim2'
  amb.name = 'ambient'
  g.add(key, rim, rim2, amb)
  return g
}

/* ------------------------------------------------------------------ */
/*  Geometry kit                                                        */
/* ------------------------------------------------------------------ */

/** a rounded box; small radii get fewer segments (they only ever cover a few pixels) */
const rbox = (w: number, h: number, d: number, r: number, seg = Math.max(1, Math.min(3, Math.floor(r / 0.035) + 1))) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
/**
 * Level of detail: round parts get segments by their size, so a bolt that covers four pixels is not a 300-triangle
 * sphere. The cast is built at 1 (a cell is ~45 to 140 px); Volt and the machine, much bigger on screen, at STAGE_LOD.
 */
let lod = 1
const STAGE_LOD = 2.4
const segs = (n: number, want: number, min: number) => Math.max(min, Math.min(n, Math.round(want * lod)))
const cyl = (rt: number, rb: number, h: number, n = 24, open = false) => new THREE.CylinderGeometry(rt, rb, h, segs(n, Math.max(rt, rb) * 170, 6), 1, open)
const sph = (r: number, w = 24, h = 16) => new THREE.SphereGeometry(r, segs(w, r * 115, 8), segs(h, r * 80, 6))
const tor = (R: number, r: number, rs = 10, ts = 32, arc = TAU) => new THREE.TorusGeometry(R, r, segs(rs, r * 330, 4), segs(ts, (R * 170 * arc) / TAU + 6, 8), arc)
const capsule = (r: number, len: number, cs = 4, rs = 12) => new THREE.CapsuleGeometry(r, len, segs(cs, r * 60, 2), segs(rs, r * 220, 6))
const lathe = (pts: P2[], n = 28) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), segs(n, Math.max(...pts.map((p) => p[0])) * 170 + 6, 12))
/** a +z facing dome (half sphere), flattened by `flat` */
const dome = (r: number, flat = 0.6, w = 12, h = 6) => new THREE.SphereGeometry(r, w, h, 0, TAU, 0, Math.PI / 2).applyMatrix4(T([0, 0, 0], [Math.PI / 2, 0, 0], [1, flat, 1]))

/** a shape pushed out along z by `depth`, centred on z = 0, with a rounded bevel */
function extrude(shape: THREE.Shape, depth: number, bevel = 0, curve = 10, bseg = lod > 1.5 ? 3 : 2) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bseg, curveSegments: curve })
  g.translate(0, 0, -depth / 2)
  return g
}

/** a rounded rectangle outline, counter-clockwise from the right edge, n points per corner */
function rrOutline(w: number, h: number, r: number, n = lod > 1.5 ? 7 : 4): P2[] {
  r = Math.min(r, w / 2, h / 2)
  const pts: P2[] = []
  const cs: P3[] = [
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
    [w / 2 - r, -h / 2 + r, Math.PI * 1.5],
  ]
  for (const [cx, cy, a0] of cs)
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2)
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
    }
  return pts
}
const circle = (r: number, n = 40, cx = 0, cy = 0): P2[] => Array.from({ length: n }, (_, i) => [cx + Math.cos((i / n) * TAU) * r, cy + Math.sin((i / n) * TAU) * r])
const shapeOf = (pts: P2[]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
const pathOf = (pts: P2[]) => new THREE.Path(pts.map(([x, y]) => new THREE.Vector2(x, y)).reverse())
/** a frame: the outer outline with the inner one cut out */
function frameShape(outer: P2[], inner: P2[]) {
  const s = shapeOf(outer)
  s.holes.push(pathOf(inner))
  return s
}

/**
 * A panel filling an outline: a centre vertex and rings out to the edge, raised by `z(x, y)` (for a gently domed
 * screen), with uv from the outline's bounding box. Indexed, smooth normals.
 */
function panel(outline: P2[], rings = 4, z: (x: number, y: number) => number = () => 0): Geo {
  const xs = outline.map((p) => p[0])
  const ys = outline.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const pos: number[] = []
  const uv: number[] = []
  const put = (x: number, y: number) => {
    pos.push(x, y, z(x, y))
    uv.push((x - x0) / (x1 - x0), (y - y0) / (y1 - y0))
  }
  put(cx, cy)
  const N = outline.length
  for (let k = 1; k <= rings; k++) for (const [x, y] of outline) put(cx + (x - cx) * (k / rings), cy + (y - cy) * (k / rings))
  const idx: number[] = []
  const at = (k: number, i: number) => 1 + (k - 1) * N + (i % N)
  for (let i = 0; i < N; i++) {
    idx.push(0, at(1, i), at(1, i + 1))
    for (let k = 1; k < rings; k++) idx.push(at(k, i), at(k + 1, i), at(k + 1, i + 1), at(k, i), at(k + 1, i + 1), at(k, i + 1))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}
/** a gentle pillow bulge over a w × h panel */
const bulge = (w: number, h: number, d: number) => (x: number, y: number) => d * Math.max(0, 1 - (2 * x / w) ** 2) * Math.max(0, 1 - (2 * y / h) ** 2)

/** a smooth tube through points, its corners rounded by `fillet` */
function pipe(pts: P3[], r: number, fillet = 0, radial = 10, closed = false) {
  const path: THREE.Vector3[] = []
  const P = pts.map((p) => V(...p))
  for (let i = 0; i < P.length; i++) {
    const p = P[i]
    if (fillet <= 0 || i === 0 || i === P.length - 1) {
      path.push(p)
      continue
    }
    const a = P[i - 1].clone().sub(p)
    const b = P[i + 1].clone().sub(p)
    const f = Math.min(fillet, a.length() / 2, b.length() / 2)
    const s = p.clone().addScaledVector(a.normalize(), f)
    const e = p.clone().addScaledVector(b.normalize(), f)
    for (let j = 0; j <= 4; j++) {
      const t = j / 4
      // a quadratic through the corner
      path.push(s.clone().multiplyScalar((1 - t) ** 2).addScaledVector(p, 2 * (1 - t) * t).addScaledVector(e, t * t))
    }
  }
  const curve = new THREE.CatmullRomCurve3(path, closed, 'centripetal')
  const len = curve.getLength()
  return new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(len * 40)), r, radial, closed)
}

/** clips a convex polygon to an axis-aligned rectangle */
function clipRect(poly: P2[], x0: number, y0: number, x1: number, y1: number): P2[] {
  let out = poly
  const edges: [(p: P2) => number][] = [[(p) => p[0] - x0], [(p) => x1 - p[0]], [(p) => p[1] - y0], [(p) => y1 - p[1]]]
  for (const [f] of edges) {
    const inp = out
    out = []
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i]
      const b = inp[(i + 1) % inp.length]
      const fa = f(a)
      const fb = f(b)
      if (fa >= 0) out.push(a)
      if (fa >= 0 !== fb >= 0) {
        const t = fa / (fa - fb)
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
      }
    }
    if (!out.length) break
  }
  return out
}

/** black hazard stripes across a w × h band (centred), as thin raised slabs; add over a yellow band */
function hazard(k: Kit, w: number, h: number, m: THREE.Matrix4, pitch = 0.09, depth = 0.008) {
  for (let x = -w / 2 - h; x < w / 2 + h; x += pitch) {
    const poly = clipRect(
      [
        [x, -h / 2],
        [x + pitch / 2, -h / 2],
        [x + pitch / 2 + h, h / 2],
        [x + h, h / 2],
      ],
      -w / 2,
      -h / 2,
      w / 2,
      h / 2,
    )
    if (poly.length < 3) continue
    k.add(extrude(shapeOf(poly), depth, 0, 1), INKY, m, GLOSS)
  }
}

/**
 * Bakes a model's solids into one indexed geometry: position, normal, color (may exceed 1 for glow), aSurf
 * (roughness, metalness, clear coat, glow) and aFx.
 */
class Kit {
  private readonly parts: Geo[] = []

  add(geo: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4, f: Finish = GLOSS, phase = 0) {
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
    const g = geo.index ? geo : mergeVertices(geo, 1e-5)
    if (g !== geo) geo.dispose()
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    if (m) {
      g.applyMatrix4(m)
      // a mirroring matrix turns the triangles inside out: put their winding back
      if (m.determinant() < 0) {
        const ix = g.index!
        for (let i = 0; i < ix.count; i += 3) {
          const t = ix.getX(i + 1)
          ix.setX(i + 1, ix.getX(i + 2))
          ix.setX(i + 2, t)
        }
      }
    }
    const n = g.getAttribute('position').count
    const c = new THREE.Color(color)
    const col = new Float32Array(n * 3)
    const surf = new Float32Array(n * 4)
    const fx = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r
      col[i * 3 + 1] = c.g
      col[i * 3 + 2] = c.b
      surf[i * 4] = f.r
      surf[i * 4 + 1] = f.m
      surf[i * 4 + 2] = f.c
      surf[i * 4 + 3] = f.g
      fx[i] = f.fx ? f.fx + Math.min(0.95, phase) : 0
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSurf', new THREE.BufferAttribute(surf, 4))
    g.setAttribute('aFx', new THREE.BufferAttribute(fx, 1))
    this.parts.push(g)
    return this
  }

  get empty() {
    return this.parts.length === 0
  }

  geometry() {
    const g = mergeGeometries(this.parts)
    for (const p of this.parts) p.dispose()
    this.parts.length = 0
    return g
  }

  mesh(name: string, mat: THREE.Material) {
    const m = new THREE.Mesh(this.geometry(), mat)
    m.name = name
    return m
  }
}

interface Rest {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}
const restOf = (o: THREE.Object3D): Rest => ({ x: o.position.x, y: o.position.y, z: o.position.z, rx: o.rotation.x, ry: o.rotation.y, rz: o.rotation.z })

/** wraps a mesh (modelled in its parent's frame) in a group that turns about p, and records the rest pose */
function joint(name: string, p: P3, ...children: THREE.Object3D[]) {
  const outer = new THREE.Group()
  outer.name = name
  outer.position.set(...p)
  for (const c of children) {
    c.position.set(c.position.x - p[0], c.position.y - p[1], c.position.z - p[2])
    outer.add(c)
  }
  outer.userData.rest = restOf(outer)
  return outer
}

/* ------------------------------------------------------------------ */
/*  The atlas: faces, glyphs and a solid block                          */
/* ------------------------------------------------------------------ */

/** every expression a screen face can show */
export type Expr = 'idle' | 'blink' | 'happy' | 'wow' | 'love' | 'dizzy' | 'wink' | 'angry' | 'sleepy' | 'cheer' | 'sad' | 'alarm'
export const EXPRS: readonly Expr[] = ['idle', 'blink', 'happy', 'wow', 'love', 'dizzy', 'wink', 'angry', 'sleepy', 'cheer', 'sad', 'alarm']
/** screen shapes: box 1.52:1 (Rex, the bots, Volt), wide 2.18:1 (visors), round 1:1, eye (one big camera eye) */
type Variant = 'box' | 'wide' | 'round' | 'eye'

const ATLAS = 1024
const CELL: Record<Variant, { y: number; w: number; h: number; cols: number }> = {
  box: { y: 0, w: 128, h: 84, cols: 8 },
  wide: { y: 168, w: 170, h: 78, cols: 6 },
  round: { y: 324, w: 112, h: 112, cols: 9 },
  eye: { y: 548, w: 112, h: 112, cols: 9 },
}
/**
 * A block of pure red (glows evenly in the vertex colour) and a wide black area (dark glass, unused glyph slots),
 * both big enough that even the smallest mip levels keep them pure: x 880..1024 and 300..760 of y 944..1024.
 */
const SOLID_UV: P2 = [952 / ATLAS, 1 - 984 / ATLAS]
const BLACK_UV: P2 = [530 / ATLAS, 1 - 984 / ATLAS]
const GLYPH_Y = 776
const GLYPH_H = 82
const GLYPHS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ.,×+-$%!?:/'
const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'
const GLYPH_FONT = `800 66px ${FONT}`

interface Glyph {
  u0: number
  v0: number
  u1: number
  v1: number
  /** width over height */
  w: number
}
const glyphs = new Map<string, Glyph>()

function cellUV(v: Variant, e: Expr) {
  const c = CELL[v]
  const i = EXPRS.indexOf(e)
  const x = (i % c.cols) * c.w
  const y = c.y + Math.floor(i / c.cols) * c.h
  // half a texel in, so filtering never reaches the next cell
  return { u0: (x + 1) / ATLAS, v0: 1 - (y + c.h - 1) / ATLAS, du: (c.w - 2) / ATLAS, dv: (c.h - 2) / ATLAS }
}

const RC = '#ff0000'
const GC = '#00ff00'
const BC = '#0000ff'
const KC = '#000000'

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  g.beginPath()
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * TAU
    const x = 16 * Math.sin(t) ** 3
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
    const px = cx + (x / 34) * s
    const py = cy - (y / 34) * s + s * 0.06
    if (i) g.lineTo(px, py)
    else g.moveTo(px, py)
  }
  g.closePath()
}

function starPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.48) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * inner : r
    g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.closePath()
}

function spiral(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, lw: number) {
  // as many turns as fit with clear gaps between them
  const turns = Math.max(1.2, Math.min(2.2, r / (lw * 2.2)))
  g.beginPath()
  for (let i = 0; i <= 60; i++) {
    const t = i / 60
    const a = t * TAU * turns
    const rr = r * (0.12 + 0.88 * t)
    if (i) g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
    else g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr)
  }
  g.lineWidth = lw
  g.strokeStyle = RC
  g.stroke()
}

/** a face with two eyes (and a mouth unless it is a visor), in a w × h cell at the origin */
function twoEyes(g: CanvasRenderingContext2D, e: Expr, v: Variant, w: number, h: number) {
  const P =
    v === 'box'
      ? { ex: 0.225, ey: 0.42, ew: 0.155, eh: 0.46, my: 0.8, mw: 0.12, lw: 0.085 }
      : v === 'wide'
        ? { ex: 0.215, ey: 0.5, ew: 0.15, eh: 0.68, my: -1, mw: 0, lw: 0.105 }
        : { ex: 0.2, ey: 0.42, ew: 0.17, eh: 0.3, my: 0.74, mw: 0.15, lw: 0.075 }
  const EW = P.ew * w
  const EH = P.eh * h
  const LW = P.lw * h
  const MY = P.my * h
  const MW = P.mw * w
  const eyes: P2[] = [-1, 1].map((s) => [w / 2 + s * P.ex * w, P.ey * h])
  const mouth = P.my > 0
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const fill = (c: string) => {
    g.fillStyle = c
    g.fill()
  }
  const stroke = (c: string, lw = LW) => {
    g.strokeStyle = c
    g.lineWidth = lw
    g.stroke()
  }
  const pill = (cx: number, cy: number, ew = EW, eh = EH) => {
    roundRectPath(g, cx - ew / 2, cy - eh / 2, ew, eh, Math.min(ew, eh) / 2)
    fill(RC)
  }
  const glint = (cx: number, cy: number, s = 1) => {
    g.beginPath()
    g.ellipse(cx - EW * 0.18, cy - EH * 0.2, EW * 0.17 * s, EW * 0.17 * s, 0, 0, TAU)
    fill(BC)
  }
  const smile = (wide = 1, depth = 1) => {
    if (!mouth) return
    g.beginPath()
    g.ellipse(w / 2, MY - h * 0.1 * depth, MW * wide, h * 0.1 * depth, 0, Math.PI * 0.15, Math.PI * 0.85)
    stroke(RC, LW * 0.85)
  }
  const open = (wide = 1, tall = 1) => {
    if (!mouth) return
    const mw = MW * 1.05 * wide
    const mh = h * 0.15 * tall
    const top = MY - mh * 0.75
    g.beginPath()
    g.moveTo(w / 2 - mw, top)
    g.lineTo(w / 2 + mw, top)
    g.ellipse(w / 2, top, mw, mh, 0, 0, Math.PI)
    g.closePath()
    fill(RC)
    g.save()
    g.clip()
    g.beginPath()
    g.ellipse(w / 2, top + mh * 0.95, mw * 0.62, mh * 0.5, 0, 0, TAU)
    fill(GC)
    g.restore()
  }
  const cheeks = () => {
    if (!mouth) return
    for (const [x, y] of eyes) {
      g.beginPath()
      g.ellipse(x + (x < w / 2 ? -1 : 1) * EW * 0.35, y + EH * 0.62, EW * 0.42, EH * 0.13, 0, 0, TAU)
      fill(GC)
    }
  }
  const arcUp = (cx: number, cy: number, s = 1) => {
    g.beginPath()
    g.arc(cx, cy + EH * 0.22, EW * 0.62 * s, Math.PI * 1.12, Math.PI * 1.88)
    stroke(RC, LW * 1.15)
  }
  const cut = (pts: P2[]) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    fill(KC)
  }
  switch (e) {
    case 'idle':
      for (const [x, y] of eyes) {
        pill(x, y)
        glint(x, y)
      }
      smile()
      break
    case 'blink':
      for (const [x, y] of eyes) pill(x, y + EH * 0.18, EW * 1.1, LW * 0.95)
      smile()
      break
    case 'happy':
      for (const [x, y] of eyes) arcUp(x, y)
      open()
      cheeks()
      break
    case 'wow':
      for (const [x, y] of eyes) {
        g.beginPath()
        g.ellipse(x, y, EW * 0.56, Math.min(EH * 0.5, EW * 0.62), 0, 0, TAU)
        stroke(RC, LW * 0.95)
        g.beginPath()
        g.arc(x, y, LW * 0.55, 0, TAU)
        fill(BC)
      }
      if (mouth) {
        g.beginPath()
        g.ellipse(w / 2, MY - h * 0.03, MW * 0.32, h * 0.075, 0, 0, TAU)
        stroke(RC, LW * 0.8)
      }
      break
    case 'love':
      for (const [x, y] of eyes) {
        heartPath(g, x, y, EW * 1.32)
        fill(GC)
        g.beginPath()
        g.ellipse(x - EW * 0.28, y - EW * 0.22, EW * 0.13, EW * 0.1, -0.5, 0, TAU)
        fill(BC)
      }
      smile(1.1, 1.1)
      break
    case 'dizzy':
      for (const [x, y] of eyes) spiral(g, x, y, Math.min(EW * 0.62, EH * 0.5), LW * 0.62)
      if (mouth) {
        g.beginPath()
        for (let i = 0; i <= 24; i++) {
          const t = i / 24
          const x = w / 2 - MW + 2 * MW * t
          const y = MY - h * 0.05 + Math.sin(t * TAU * 1.5) * h * 0.035
          if (i) g.lineTo(x, y)
          else g.moveTo(x, y)
        }
        stroke(RC, LW * 0.7)
      }
      break
    case 'wink': {
      const [l, r] = eyes
      pill(l[0], l[1])
      glint(l[0], l[1])
      arcUp(r[0], r[1])
      smile(1.05)
      if (mouth) {
        g.beginPath()
        g.ellipse(w / 2 + MW * 0.35, MY + h * 0.005, MW * 0.28, h * 0.07, 0, 0, Math.PI)
        fill(GC)
      }
      break
    }
    case 'angry':
      for (const [x, y] of eyes) {
        pill(x, y + EH * 0.05)
        const s = x < w / 2 ? 1 : -1
        cut([
          [x - EW, y - EH * 0.75],
          [x + EW, y - EH * 0.75],
          [x + s * EW * 0.75, y - EH * 0.02],
          [x - s * EW * 0.75, y - EH * 0.5],
        ])
      }
      if (mouth) {
        g.beginPath()
        g.moveTo(w / 2 - MW * 0.85, MY - h * 0.02)
        g.lineTo(w / 2 - MW * 0.3, MY - h * 0.07)
        g.lineTo(w / 2 + MW * 0.3, MY - h * 0.02)
        g.lineTo(w / 2 + MW * 0.85, MY - h * 0.07)
        stroke(RC, LW * 0.75)
      }
      break
    case 'sleepy':
      for (const [x, y] of eyes) {
        pill(x, y)
        g.fillStyle = KC
        g.fillRect(x - EW, y - EH, EW * 2, EH * 1.05)
        g.beginPath()
        g.moveTo(x - EW * 0.6, y + EH * 0.04)
        g.lineTo(x + EW * 0.6, y + EH * 0.04)
        stroke(RC, LW * 0.6)
      }
      g.font = `800 ${Math.round(h * 0.26)}px ${FONT}`
      g.fillStyle = BC
      g.fillText('z', w * 0.86, h * 0.3)
      g.font = `800 ${Math.round(h * 0.18)}px ${FONT}`
      g.fillText('z', w * 0.78, h * 0.16)
      if (mouth) {
        g.beginPath()
        g.ellipse(w / 2, MY - h * 0.03, MW * 0.22, h * 0.05, 0, 0, TAU)
        stroke(RC, LW * 0.6)
      }
      break
    case 'cheer':
      for (const [x, y] of eyes) {
        starPath(g, x, y, Math.min(EW * 0.82, EH * 0.62))
        fill(RC)
        starPath(g, x, y, Math.min(EW * 0.82, EH * 0.62) * 0.42)
        fill(BC)
      }
      open(1.2, 1.15)
      cheeks()
      break
    case 'sad':
      for (const [x, y] of eyes) {
        pill(x, y + EH * 0.05)
        const s = x < w / 2 ? -1 : 1
        cut([
          [x - EW, y - EH * 0.75],
          [x + EW, y - EH * 0.75],
          [x + s * EW * 0.75, y - EH * 0.02],
          [x - s * EW * 0.75, y - EH * 0.5],
        ])
      }
      if (mouth) {
        g.beginPath()
        g.ellipse(w / 2, MY + h * 0.02, MW * 0.8, h * 0.08, 0, Math.PI * 1.15, Math.PI * 1.85)
        stroke(RC, LW * 0.8)
      }
      {
        const [x, y] = eyes[1]
        g.beginPath()
        g.moveTo(x + EW * 0.15, y + EH * 0.42)
        g.quadraticCurveTo(x + EW * 0.45, y + EH * 0.75, x + EW * 0.15, y + EH * 0.85)
        g.quadraticCurveTo(x - EW * 0.15, y + EH * 0.75, x + EW * 0.15, y + EH * 0.42)
        fill(BC)
      }
      break
    case 'alarm':
      for (const [x, y] of eyes) {
        roundRectPath(g, x - EW * 0.24, y - EH * 0.5, EW * 0.48, EH * 0.66, EW * 0.24)
        fill(RC)
        g.beginPath()
        g.arc(x, y + EH * 0.4, EW * 0.25, 0, TAU)
        fill(RC)
      }
      if (mouth) {
        g.beginPath()
        g.ellipse(w / 2, MY - h * 0.03, MW * 0.4, h * 0.085, 0, 0, TAU)
        fill(RC)
      }
      break
  }
}

/** one big camera eye: an iris ring, aperture blades and a pupil, in a w × h cell at the origin */
function cyclops(g: CanvasRenderingContext2D, e: Expr, w: number, h: number) {
  const cx = w / 2
  const cy = h / 2
  const R = h * 0.42
  const LW = h * 0.11
  g.lineCap = 'round'
  g.lineJoin = 'round'
  const iris = (pupil: number) => {
    // the ring
    g.beginPath()
    g.arc(cx, cy, R, 0, TAU)
    g.arc(cx, cy, R * 0.74, 0, TAU, true)
    g.fillStyle = RC
    g.fill()
    // the blades, half bright, with dark seams that spiral in
    g.beginPath()
    g.arc(cx, cy, R * 0.7, 0, TAU)
    g.arc(cx, cy, pupil, 0, TAU, true)
    g.fillStyle = '#8a0000'
    g.fill()
    g.strokeStyle = KC
    g.lineWidth = h * 0.022
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3
      g.beginPath()
      g.moveTo(cx + Math.cos(a) * pupil, cy + Math.sin(a) * pupil)
      g.lineTo(cx + Math.cos(a + 0.9) * R * 0.7, cy + Math.sin(a + 0.9) * R * 0.7)
      g.stroke()
    }
    // glints
    g.fillStyle = BC
    g.beginPath()
    g.ellipse(cx - R * 0.36, cy - R * 0.4, R * 0.17, R * 0.12, -0.6, 0, TAU)
    g.fill()
    g.beginPath()
    g.arc(cx + R * 0.32, cy + R * 0.34, R * 0.06, 0, TAU)
    g.fill()
  }
  const lid = (pts: P2[]) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    g.fillStyle = KC
    g.fill()
  }
  const line = (pts: P2[], lw = LW) => {
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.strokeStyle = RC
    g.lineWidth = lw
    g.stroke()
  }
  switch (e) {
    case 'idle':
      iris(R * 0.3)
      break
    case 'blink':
      g.beginPath()
      g.ellipse(cx, cy - R * 0.25, R * 0.95, R * 0.42, 0, Math.PI * 0.12, Math.PI * 0.88)
      g.strokeStyle = RC
      g.lineWidth = LW
      g.stroke()
      break
    case 'happy':
      g.beginPath()
      g.arc(cx, cy + R * 0.42, R * 0.82, Math.PI * 1.12, Math.PI * 1.88)
      g.strokeStyle = RC
      g.lineWidth = LW * 1.15
      g.stroke()
      break
    case 'wow':
      iris(R * 0.12)
      break
    case 'love':
      heartPath(g, cx, cy, R * 2.1)
      g.fillStyle = GC
      g.fill()
      g.beginPath()
      g.ellipse(cx - R * 0.42, cy - R * 0.32, R * 0.2, R * 0.14, -0.5, 0, TAU)
      g.fillStyle = BC
      g.fill()
      break
    case 'dizzy':
      spiral(g, cx, cy, R * 0.92, LW * 0.75)
      break
    case 'wink':
      line(
        [
          [cx - R * 0.7, cy - R * 0.45],
          [cx + R * 0.45, cy],
          [cx - R * 0.7, cy + R * 0.45],
        ],
        LW * 1.05,
      )
      break
    case 'angry':
      iris(R * 0.24)
      lid([
        [cx - R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy - R * 0.05],
        [cx - R * 1.2, cy - R * 0.75],
      ])
      line([
        [cx - R * 1.0, cy - R * 0.68],
        [cx + R * 1.0, cy - R * 0.12],
      ])
      break
    case 'sleepy':
      iris(R * 0.3)
      lid([
        [cx - R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy + R * 0.05],
        [cx - R * 1.2, cy + R * 0.05],
      ])
      line([
        [cx - R * 0.95, cy + R * 0.05],
        [cx + R * 0.95, cy + R * 0.05],
      ])
      break
    case 'cheer':
      starPath(g, cx, cy, R * 1.02)
      g.fillStyle = RC
      g.fill()
      starPath(g, cx, cy, R * 0.42)
      g.fillStyle = BC
      g.fill()
      break
    case 'sad':
      iris(R * 0.3)
      lid([
        [cx - R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy - R * 1.2],
        [cx + R * 1.2, cy - R * 0.75],
        [cx - R * 1.2, cy - R * 0.05],
      ])
      g.beginPath()
      g.moveTo(cx + R * 0.6, cy + R * 0.55)
      g.quadraticCurveTo(cx + R * 0.85, cy + R * 0.9, cx + R * 0.6, cy + R * 1.0)
      g.quadraticCurveTo(cx + R * 0.35, cy + R * 0.9, cx + R * 0.6, cy + R * 0.55)
      g.fillStyle = BC
      g.fill()
      break
    case 'alarm':
      g.fillStyle = RC
      roundRectPath(g, cx - R * 0.17, cy - R * 0.85, R * 0.34, R * 1.1, R * 0.17)
      g.fill()
      g.beginPath()
      g.arc(cx, cy + R * 0.62, R * 0.19, 0, TAU)
      g.fill()
      break
  }
}

/** draws one face into a w × h box at (x, y): black where nothing glows */
function drawFace(g: CanvasRenderingContext2D, e: Expr, v: Variant, x: number, y: number, w: number, h: number) {
  g.save()
  g.beginPath()
  g.rect(x, y, w, h)
  g.clip()
  g.translate(x, y)
  const back = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.62)
  back.addColorStop(0, 'rgb(24, 0, 0)')
  back.addColorStop(1, 'rgb(6, 0, 0)')
  g.fillStyle = back
  g.fillRect(0, 0, w, h)
  if (v === 'eye') cyclops(g, e, w, h)
  else twoEyes(g, e, v, w, h)
  g.restore()
}

function drawAtlas(g: CanvasRenderingContext2D) {
  g.globalCompositeOperation = 'source-over'
  g.fillStyle = KC
  g.fillRect(0, 0, ATLAS, ATLAS)
  for (const v of Object.keys(CELL) as Variant[]) {
    const c = CELL[v]
    EXPRS.forEach((e, i) => drawFace(g, e, v, (i % c.cols) * c.w, c.y + Math.floor(i / c.cols) * c.h, c.w, c.h))
  }
  g.fillStyle = RC
  g.fillRect(880, 944, 144, 80)
  // the glyphs: a tinted body with a white core over it, each in a cell exactly its advance wide
  g.font = GLYPH_FONT
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'
  const cap = g.measureText('H').actualBoundingBoxAscent
  let x = 0
  let row = 0
  glyphs.clear()
  for (const ch of GLYPHS) {
    const m = g.measureText(ch)
    const w = Math.ceil(m.width) + 2
    if (x + w > ATLAS) {
      x = 0
      row++
    }
    const y = GLYPH_Y + row * GLYPH_H
    const base = y + GLYPH_H / 2 + cap / 2
    g.save()
    g.beginPath()
    g.rect(x, y, w, GLYPH_H)
    g.clip()
    g.fillStyle = RC
    g.fillText(ch, x + 1, base)
    g.globalCompositeOperation = 'lighter'
    g.fillStyle = 'rgba(0, 0, 255, 0.62)'
    g.fillText(ch, x + 1, base)
    g.restore()
    glyphs.set(ch, { u0: x / ATLAS, u1: (x + w) / ATLAS, v0: 1 - (y + GLYPH_H) / ATLAS, v1: 1 - y / ATLAS, w: w / GLYPH_H })
    x += w
  }
}

let atlasTex: THREE.CanvasTexture | null = null
/** the shared atlas (drawn again once the web font has loaded, if it had not yet) */
function atlas() {
  if (atlasTex) return atlasTex
  const c = document.createElement('canvas')
  c.width = c.height = ATLAS
  const g = c.getContext('2d')!
  drawAtlas(g)
  const t = new THREE.CanvasTexture(c)
  t.anisotropy = 4
  t.colorSpace = THREE.NoColorSpace
  atlasTex = t
  if (!document.fonts.check(GLYPH_FONT))
    document.fonts.load(GLYPH_FONT).then(
      () => {
        drawAtlas(g)
        t.needsUpdate = true
        relayoutAll()
      },
      () => {},
    )
  return t
}

/* ------------------------------------------------------------------ */
/*  Screens: faces and value displays                                   */
/* ------------------------------------------------------------------ */

interface FaceRegion {
  variant: Variant
  start: number
  count: number
  /** uv within the face, 0..1, per vertex */
  base: number[]
}
interface Display {
  start: number
  slots: number
  /** display frame: local x across, y up, z out */
  frame: number[]
  /** glyph cell height (the capitals are about 0.62 of it) and the widest the text may run */
  h: number
  maxW: number
  /** bends the line around a cylinder of this radius (0 = flat) */
  curve: number
}
interface Layout {
  faces: FaceRegion[]
  displays: Display[]
  /** fixed text: which display, what, in which colour (r, g, b) */
  labels: { display: number; text: string; color: number[] }[]
  /** the display setValue writes to, -1 if none */
  value: number
}
const layouts = new Map<string, Layout>()

class ScreenKit {
  private readonly parts: Geo[] = []
  private n = 0
  readonly layout: Layout = { faces: [], displays: [], labels: [], value: -1 }

  private push(g: Geo, color: THREE.Color) {
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k)
    if (!g.index) {
      const m = mergeVertices(g, 1e-6)
      g.dispose()
      g = m
    }
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    const n = g.getAttribute('position').count
    const col = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const start = this.n
    this.parts.push(g)
    this.n += n
    return { start, count: n, g }
  }

  /** a face screen: `g` carries uv 0..1 across the face; `tint` is what its red channel glows in */
  face(g: Geo, variant: Variant, tint: THREE.ColorRepresentation, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m)
    const r = this.push(g, C(tint))
    const uv = r.g.getAttribute('uv')
    const base: number[] = []
    for (let i = 0; i < r.count; i++) base.push(uv.getX(i), uv.getY(i))
    const reg = { variant, start: r.start, count: r.count, base }
    writeFaceUV(uv as THREE.BufferAttribute, reg, 'idle')
    this.layout.faces.push(reg)
    return this
  }

  /** something that glows evenly in `color` (the power cell's core); recoloured with the value by setValue */
  solid(g: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m)
    const n = g.getAttribute('position').count
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2).map((_, i) => SOLID_UV[i % 2]), 2))
    this.push(g, C(color))
    return this
  }

  /** a dark glass panel (no glow) */
  blank(g: Geo, m?: THREE.Matrix4) {
    if (m) g.applyMatrix4(m)
    const n = g.getAttribute('position').count
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2).map((_, i) => BLACK_UV[i % 2]), 2))
    this.push(g, C('#000000'))
    return this
  }

  /** a line of up to `slots` glyphs centred on the frame's origin, `h` tall and at most `maxW` wide */
  display(frame: THREE.Matrix4, h: number, maxW: number, slots = 7, curve = 0) {
    const pos = new Float32Array(slots * 12)
    const nrm = new Float32Array(slots * 12)
    const uv = new Float32Array(slots * 8)
    const idx: number[] = []
    const nz = V(0, 0, 1).transformDirection(frame)
    const o = V().applyMatrix4(frame)
    for (let s = 0; s < slots; s++) {
      for (let j = 0; j < 4; j++) {
        pos.set([o.x, o.y, o.z], (s * 4 + j) * 3)
        nrm.set([nz.x, nz.y, nz.z], (s * 4 + j) * 3)
        uv.set(BLACK_UV, (s * 4 + j) * 2)
      }
      idx.push(s * 4, s * 4 + 1, s * 4 + 2, s * 4, s * 4 + 2, s * 4 + 3)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.setIndex(idx)
    const r = this.push(g, C('#ffffff'))
    this.layout.displays.push({ start: r.start, slots, frame: frame.toArray(), h, maxW, curve })
    return this.layout.displays.length - 1
  }

  geometry() {
    const g = mergeGeometries(this.parts)
    for (const p of this.parts) p.dispose()
    return g
  }

  mesh(key: string, mat: THREE.Material) {
    layouts.set(key, this.layout)
    const m = new THREE.Mesh(this.geometry(), mat)
    m.name = 'screen'
    // fixed text is written into the prototype's geometry here (copies inherit it)
    writeLabels(m.geometry, this.layout)
    return m
  }

  /** the value display (setValue writes here) */
  valueDisplay(frame: THREE.Matrix4, h: number, maxW: number, slots = 7) {
    this.layout.value = this.display(frame, h, maxW, slots)
    return this
  }

  /** fixed text (WILD, GOLD) */
  label(text: string, color: THREE.ColorRepresentation, frame: THREE.Matrix4, h: number, maxW: number, curve = 0) {
    const i = this.display(frame, h, maxW, text.length, curve)
    this.layout.labels.push({ display: i, text, color: C(color).toArray() })
    return this
  }
}

function writeFaceUV(uv: THREE.BufferAttribute, reg: FaceRegion, e: Expr) {
  const c = cellUV(reg.variant, e)
  for (let i = 0; i < reg.count; i++) uv.setXY(reg.start + i, c.u0 + reg.base[i * 2] * c.du, c.v0 + reg.base[i * 2 + 1] * c.dv)
  uv.needsUpdate = true
}

const _m4 = new THREE.Matrix4()
const _v3 = new THREE.Vector3()
function writeText(geo: Geo, d: Display, text: string, color: THREE.Color) {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute
  const col = geo.getAttribute('color') as THREE.BufferAttribute
  _m4.fromArray(d.frame)
  const list = [...text.toUpperCase()].map((ch) => glyphs.get(ch === 'X' && /\d/.test(text) ? '×' : ch)).filter((g): g is Glyph => !!g).slice(0, d.slots)
  const total = list.reduce((a, g) => a + g.w, 0)
  const h = total * d.h > d.maxW ? d.maxW / total : d.h
  let x = (-total * h) / 2
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute
  const place = (i: number, lx: number, ly: number) => {
    if (d.curve > 0) _v3.set(Math.sin(lx / d.curve) * d.curve, ly, Math.cos(lx / d.curve) * d.curve - d.curve)
    else _v3.set(lx, ly, 0)
    _v3.applyMatrix4(_m4)
    pos.setXYZ(i, _v3.x, _v3.y, _v3.z)
    // on a curved band the glyphs face out of the cylinder like the glass under them
    if (d.curve > 0) {
      _v3.set(Math.sin(lx / d.curve), 0, Math.cos(lx / d.curve)).transformDirection(_m4)
      nrm.setXYZ(i, _v3.x, _v3.y, _v3.z)
      nrm.needsUpdate = true
    }
  }
  for (let s = 0; s < d.slots; s++) {
    const b = d.start + s * 4
    const g = list[s]
    if (!g) {
      _v3.set(0, 0, 0).applyMatrix4(_m4)
      for (let j = 0; j < 4; j++) {
        pos.setXYZ(b + j, _v3.x, _v3.y, _v3.z)
        uv.setXY(b + j, BLACK_UV[0], BLACK_UV[1])
      }
      continue
    }
    const w = g.w * h
    place(b, x, -h / 2)
    place(b + 1, x + w, -h / 2)
    place(b + 2, x + w, h / 2)
    place(b + 3, x, h / 2)
    uv.setXY(b, g.u0, g.v0)
    uv.setXY(b + 1, g.u1, g.v0)
    uv.setXY(b + 2, g.u1, g.v1)
    uv.setXY(b + 3, g.u0, g.v1)
    for (let j = 0; j < 4; j++) col.setXYZ(b + j, color.r, color.g, color.b)
    x += w
  }
  pos.needsUpdate = true
  uv.needsUpdate = true
  col.needsUpdate = true
}

/* ------------------------------------------------------------------ */
/*  The cast                                                            */
/* ------------------------------------------------------------------ */

/** how much the face colours glow (the tint is multiplied up in the shader by the screen gain) */
const FACE_TINT: Record<string, string> = {
  rex: '#8ff6ff',
  dot: '#ffffff',
  clank: '#7dff9a',
  zip: '#ffb444',
  nut: '#7cf1ff',
  gear: '#fff1d6',
  battery: '#eafff2',
  chip: '#9fe3ff',
  magnet: '#8ff6ff',
  zap: '#fff2a8',
  boost: '#b9ffcf',
  gold: '#ffe3a0',
}

/** Rex, the top pay: a chunky red toy robot with a big screen head, a blinking antenna and chrome cheek bolts */
function buildRex() {
  const red = SYMBOL_COLOR.rex
  const deep = '#c92a22'
  const m = grid()
  const k = new Kit()
  const HY = 0.085
  const HW = 0.6
  const HH = 0.42
  const HD = 0.36
  k.add(rbox(HW, HH, HD, 0.085, 3), red, T([0, HY, 0]))
  // a recessed screen in a glossy black bezel
  const SW = 0.44
  const SH = 0.285
  k.add(extrude(frameShape(rrOutline(SW + 0.06, SH + 0.06, 0.085), rrOutline(SW, SH, 0.06)), 0.024, 0.01), GRAPH, T([0, HY, HD / 2 + 0.002]), GLOSS)
  k.add(extrude(shapeOf(rrOutline(SW + 0.01, SH + 0.01, 0.065)), 0.01), INKY, T([0, HY, HD / 2 + 0.001]), GLOSS)
  // cheek bolts on the face plate, and big chrome ear bolts
  for (const s of [-1, 1]) {
    for (const y of [HY + 0.13, HY - 0.13]) k.add(dome(0.015), CHROME_C, T([s * 0.27, y, HD / 2 + 0.002]), CHROME)
    k.add(cyl(0.07, 0.075, 0.05, 28), CHROME_C, T([s * (HW / 2 + 0.018), HY, 0], [0, 0, Math.PI / 2]), CHROME)
    k.add(cyl(0.04, 0.04, 0.03, 6), STEEL_C, T([s * (HW / 2 + 0.05), HY, 0], [0, 0, Math.PI / 2]), STEEL)
    k.add(tor(0.07, 0.008, 6, 28), deep, T([s * (HW / 2 + 0.006), HY, 0], [0, Math.PI / 2, 0]), GLOSS)
  }
  // antenna: a chrome stalk with a blinking bulb
  const top = HY + HH / 2
  k.add(cyl(0.045, 0.055, 0.03, 20), CHROME_C, T([0, top + 0.012, 0]), CHROME)
  k.add(cyl(0.011, 0.011, 0.1, 10), CHROME_C, T([0, top + 0.07, 0]), CHROME)
  k.add(sph(0.036, 16, 12), C('#ffcf3a', 2.2), T([0, top + 0.13, 0]), lit(1, FX.blink))
  k.add(tor(0.02, 0.006, 6, 16), CHROME_C, T([0, top + 0.1, 0], [Math.PI / 2, 0, 0]), CHROME)
  // the neck and a small body with a white chest panel and three buttons
  k.add(cyl(0.075, 0.085, 0.05, 24), STEEL_C, T([0, HY - HH / 2 - 0.02, 0]), STEEL)
  const BY = -0.235
  k.add(rbox(0.38, 0.2, 0.28, 0.06), red, T([0, BY, 0]))
  k.add(rbox(0.25, 0.115, 0.03, 0.025), WHITE, T([0, BY + 0.005, 0.135]), GLOSS)
  ;['#5cf2ff', '#ffd23a', '#ff5aa5'].forEach((c, i) => k.add(dome(0.019, 0.7), C(c, 1.8), T([-0.07 + i * 0.07, BY + 0.005, 0.15]), lit(1, FX.pulse), i * 0.3))
  // stubby legs and rubber feet
  for (const s of [-1, 1]) {
    k.add(cyl(0.045, 0.05, 0.06, 16), STEEL_C, T([s * 0.1, -0.365, 0]), STEEL)
    k.add(rbox(0.15, 0.065, 0.2, 0.028), GRAPH, T([s * 0.1, -0.41, 0.02]), RUBBER)
    k.add(rbox(0.152, 0.03, 0.06, 0.014), deep, T([s * 0.1, -0.392, 0.105]), GLOSS)
  }
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  sk.face(panel(rrOutline(SW, SH, 0.06), 4, bulge(SW, SH, 0.012)), 'box', FACE_TINT.rex, T([0, HY, HD / 2 + 0.007]))
  root.add(sk.mesh('rex', m.screen))
  // arms, each its own part (they wave on wins)
  for (const s of [-1, 1]) {
    const a = new Kit()
    const sh: P3 = [s * 0.205, -0.19, 0]
    const hand: P3 = [s * 0.3, -0.31, 0.04]
    a.add(sph(0.05, 18, 12), CHROME_C, T(sh), CHROME)
    a.add(capsule(0.042, dist(sh, hand) - 0.03, 4, 14), red, aim(sh, hand))
    a.add(sph(0.055, 18, 12), WHITE, T(hand))
    a.add(tor(0.044, 0.01, 6, 18), GRAPH, mul(aim(sh, hand), T([0, -0.03 + dist(sh, hand) / 2 - 0.05, 0], [Math.PI / 2, 0, 0])), GLOSS)
    root.add(joint(s < 0 ? 'armL' : 'armR', sh, a.mesh('arm', m.body)))
  }
  return root
}

/** Dot: a round teal ball robot on one wheel, arms out for balance, a glass dome head with a screen face */
function buildDot() {
  const teal = SYMBOL_COLOR.dot
  const deep = '#0b9d92'
  const m = grid()
  const k = new Kit()
  const BY = -0.1
  const BR = 0.2
  k.add(sph(BR, 32, 22), teal, T([0, BY, 0]))
  k.add(tor(BR * 0.995, 0.012, 8, 48), CHROME_C, T([0, BY + 0.02, 0], [Math.PI / 2, 0, 0]), CHROME)
  // a round white power button on the belly, ringed with light
  const belly = T([0, BY - 0.045, 0], [-0.22, 0, 0])
  k.add(cyl(0.066, 0.066, 0.03, 28), WHITE, mul(belly, T([0, 0, BR - 0.008], [Math.PI / 2, 0, 0])))
  k.add(tor(0.068, 0.011, 8, 28), C('#7ffff0', 2.2), mul(belly, T([0, 0, BR + 0.004])), lit(1, FX.pulse))
  k.add(dome(0.034, 0.5), deep, mul(belly, T([0, 0, BR + 0.006])))
  // collar
  k.add(cyl(0.1, 0.13, 0.05, 32), STEEL_C, T([0, BY + BR - 0.01, 0]), STEEL)
  k.add(tor(0.105, 0.012, 8, 32), deep, T([0, BY + BR + 0.015, 0], [Math.PI / 2, 0, 0]), GLOSS)
  // ear muffs joined by a band over the head
  const HY = 0.205
  const HR = 0.165
  for (const s of [-1, 1]) {
    k.add(cyl(0.058, 0.058, 0.05, 28), teal, T([s * (HR + 0.012), HY, 0], [0, 0, Math.PI / 2]))
    k.add(tor(0.042, 0.01, 6, 24), C('#7ffff0', 2), T([s * (HR + 0.038), HY, 0], [0, Math.PI / 2, 0]), lit(1, FX.pulse), 0.5)
    k.add(dome(0.03, 0.5), CHROME_C, T([s * (HR + 0.04), HY, 0], [0, (s * Math.PI) / 2, 0]), CHROME)
  }
  k.add(tor(HR + 0.03, 0.017, 8, 40, Math.PI), deep, T([0, HY, -0.01]), GLOSS)
  // the fork the wheel turns in: a yoke under the ball and an arm down to the axle in front of the wheel
  k.add(rbox(0.13, 0.05, 0.12, 0.022), deep, T([0, -0.285, -0.01]))
  k.add(capsule(0.024, 0.07, 3, 10), deep, T([0, -0.33, 0.05]))
  k.add(cyl(0.03, 0.03, 0.02, 16), CHROME_C, T([0, -0.375, 0.064], [Math.PI / 2, 0, 0]), CHROME)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  // arms out to the sides, one mesh
  const a = new Kit()
  for (const s of [-1, 1]) {
    const sh: P3 = [s * 0.18, BY + 0.02, 0.02]
    const hand: P3 = [s * 0.31, BY + 0.1, 0.05]
    a.add(sph(0.032, 14, 10), CHROME_C, T(sh), CHROME)
    a.add(capsule(0.026, dist(sh, hand) - 0.02, 3, 12), teal, aim(sh, hand))
    a.add(sph(0.042, 16, 12), WHITE, T(hand))
  }
  root.add(joint('arms', [0, BY, 0], a.mesh('arms', m.body)))
  // the wheel (spins about z)
  const w = new Kit()
  const WY = -0.375
  w.add(tor(0.072, 0.034, 10, 36), GRAPH, T([0, WY, 0]), RUBBER)
  w.add(cyl(0.056, 0.056, 0.05, 28), CHROME_C, T([0, WY, 0], [Math.PI / 2, 0, 0]), CHROME)
  w.add(cyl(0.042, 0.042, 0.054, 24), teal, T([0, WY, 0], [Math.PI / 2, 0, 0]))
  for (let i = 0; i < 4; i++) w.add(box(0.012, 0.075, 0.01), CHROME_C, T([0, WY, 0.03], [0, 0, (i * TAU) / 8]), CHROME)
  root.add(joint('wheel', [0, WY, 0], w.mesh('wheel', m.body)))
  // the head: a dark glass dome, its face on the front
  const sk = new ScreenKit()
  const head = sph(HR, 32, 24)
  const p = head.getAttribute('position')
  const uv = head.getAttribute('uv')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const y = p.getY(i)
    const z = p.getZ(i)
    if (z < HR * 0.25) uv.setXY(i, 0.03, 0.03)
    else uv.setXY(i, Math.min(0.98, Math.max(0.02, 0.5 + x / (1.72 * HR))), Math.min(0.98, Math.max(0.02, 0.5 + y / (1.72 * HR))))
  }
  sk.face(head, 'round', FACE_TINT.dot, T([0, HY, 0]))
  root.add(joint('head', [0, HY - 0.06, 0], sk.mesh('dot', m.screen)))
  return root
}

/** Clank: a stout yellow worker bot on a caterpillar track, hazard stripes, claw hands and a visor face */
function buildClank() {
  const yel = SYMBOL_COLOR.clank
  const deep = '#e39a00'
  const m = grid()
  const k = new Kit()
  const BY = 0.04
  const BW = 0.6
  const BH = 0.38
  const BD = 0.38
  k.add(rbox(BW, BH, BD, 0.08, 3), yel, T([0, BY, 0]))
  // visor
  const VW = 0.43
  const VH = 0.195
  const VY = BY + 0.06
  k.add(extrude(frameShape(rrOutline(VW + 0.055, VH + 0.055, 0.09), rrOutline(VW, VH, 0.08)), 0.024, 0.01), GRAPH, T([0, VY, BD / 2 + 0.002]), GLOSS)
  k.add(extrude(shapeOf(rrOutline(VW + 0.01, VH + 0.01, 0.085)), 0.01), INKY, T([0, VY, BD / 2 + 0.001]), GLOSS)
  // hazard band across the bottom of the front
  const band = T([0, BY - 0.125, BD / 2 + 0.004])
  k.add(extrude(shapeOf(rrOutline(0.5, 0.075, 0.012)), 0.006), yel, band, GLOSS)
  hazard(k, 0.48, 0.062, mul(band, T([0, 0, 0.005])), 0.075, 0.006)
  // corner bolts
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.add(dome(0.016), CHROME_C, T([sx * 0.265, BY + sy * 0.15, BD / 2 + 0.002]), CHROME)
  // a blinking amber beacon on top
  const top = BY + BH / 2
  k.add(cyl(0.06, 0.07, 0.03, 24), GRAPH, T([0, top + 0.01, 0]), GLOSS)
  k.add(sph(0.05, 20, 14, ).applyMatrix4(T([0, 0, 0], [0, 0, 0], [1, 1.1, 1])), C('#ffa21f', 2.4), T([0, top + 0.05, 0]), lit(1, FX.blink))
  k.add(tor(0.052, 0.007, 6, 24), CHROME_C, T([0, top + 0.035, 0], [Math.PI / 2, 0, 0]), CHROME)
  // chassis and the track, broadside, with three chrome hubs
  const TY = -0.27
  k.add(rbox(0.42, 0.08, 0.26, 0.03), GRAPH, T([0, BY - BH / 2 - 0.02, 0]), SATIN)
  const TW = 0.64
  const TH = 0.16
  k.add(extrude(frameShape(rrOutline(TW, TH, TH / 2, 10), rrOutline(TW - 0.07, TH - 0.07, (TH - 0.07) / 2, 10)), 0.26, 0.012, 12, 2), GRAPH, T([0, TY, 0]), RUBBER)
  k.add(extrude(shapeOf(rrOutline(TW - 0.06, TH - 0.06, (TH - 0.06) / 2, 10)), 0.2), '#3b414e', T([0, TY, 0]), SATIN)
  for (const x of [-0.21, 0, 0.21]) {
    k.add(cyl(0.05, 0.05, 0.03, 24), CHROME_C, T([x, TY, 0.13], [Math.PI / 2, 0, 0]), CHROME)
    k.add(cyl(0.022, 0.022, 0.034, 16), yel, T([x, TY, 0.135], [Math.PI / 2, 0, 0]))
  }
  // cleats round the loop
  const loop = rrOutline(TW + 0.012, TH + 0.012, (TH + 0.012) / 2, 10)
  for (let i = 0; i < loop.length; i += 2) {
    const [x, y] = loop[i]
    const [nx, ny] = loop[(i + 1) % loop.length]
    const a = Math.atan2(ny - y, nx - x)
    k.add(box(0.034, 0.018, 0.27), '#1c2028', T([x, TY + y, 0], [0, 0, a]), RUBBER)
  }
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  sk.face(panel(rrOutline(VW, VH, 0.08), 4, bulge(VW, VH, 0.01)), 'wide', FACE_TINT.clank, T([0, VY, BD / 2 + 0.007]))
  root.add(sk.mesh('clank', m.screen))
  // claw arms
  for (const s of [-1, 1]) {
    const a = new Kit()
    const sh: P3 = [s * 0.3, BY - 0.04, 0]
    const wr: P3 = [s * 0.37, BY - 0.15, 0.05]
    a.add(sph(0.052, 18, 12), CHROME_C, T(sh), CHROME)
    a.add(capsule(0.034, dist(sh, wr) - 0.02, 3, 12), GRAPH, aim(sh, wr), SATIN)
    a.add(cyl(0.05, 0.045, 0.05, 20), deep, mul(T(wr), T([0, -0.01, 0])))
    // two pincers curling in, open, with rubber tips
    for (const f of [-1, 1]) {
      const q = (x: number, y: number): P3 => [wr[0] + f * x, wr[1] + y, wr[2]]
      const pts = [q(0.012, -0.03), q(0.05, -0.075), q(0.045, -0.125), q(0.016, -0.15)]
      for (let i = 0; i < pts.length - 1; i++) a.add(capsule(0.017 - i * 0.002, dist(pts[i], pts[i + 1]), 2, 8), i === 2 ? deep : CHROME_C, aim(pts[i], pts[i + 1]), i === 2 ? GLOSS : CHROME)
    }
    root.add(joint(s < 0 ? 'armL' : 'armR', sh, a.mesh('arm', m.body)))
  }
  return root
}

/** Zip: a purple drone with two rotors and one big camera eye */
function buildZip() {
  const pur = SYMBOL_COLOR.zip
  const deep = '#7436d9'
  const m = grid()
  const k = new Kit()
  const BY = -0.06
  k.add(sph(0.2, 32, 22).applyMatrix4(T([0, 0, 0], [0, 0, 0], [1.3, 0.92, 1.05])), pur, T([0, BY, 0]))
  k.add(new THREE.SphereGeometry(0.2, 32, 8, 0, TAU, Math.PI * 0.62, Math.PI * 0.38).applyMatrix4(T([0, 0, 0], [0, 0, 0], [1.31, 0.93, 1.06])), WHITE, T([0, BY, 0]))
  // the lens: a chrome barrel with a rubber grip ring
  const LY = BY + 0.0
  const LZ = 0.2
  k.add(cyl(0.135, 0.15, 0.09, 48), CHROME_C, T([0, LY, LZ - 0.035], [Math.PI / 2, 0, 0]), CHROME)
  k.add(tor(0.14, 0.02, 10, 48), GRAPH, T([0, LY, LZ + 0.01]), RUBBER)
  k.add(tor(0.118, 0.008, 8, 48), CHROME_C, T([0, LY, LZ + 0.012]), CHROME)
  // rotor struts and ducts, tipped towards the camera so they read from the front
  for (const s of [-1, 1]) {
    const hub: P3 = [s * 0.28, 0.24, 0.0]
    k.add(capsule(0.024, 0.15, 3, 10), GRAPH, aim([s * 0.13, 0.08, 0], hub), SATIN)
    const duct = T(hub, [0.42, 0, 0])
    k.add(tor(0.125, 0.017, 10, 40), pur, duct)
    k.add(tor(0.125, 0.006, 6, 40), CHROME_C, mul(duct, T([0, 0.016, 0], [Math.PI / 2, 0, 0])), CHROME)
    for (let i = 0; i < 3; i++) k.add(rbox(0.12, 0.012, 0.012, 0.005), GRAPH, mul(duct, T([0, -0.005, 0], [Math.PI / 2, 0, (i * TAU) / 3]), T([0.062, 0, 0])), SATIN)
    k.add(cyl(0.028, 0.034, 0.03, 16), CHROME_C, mul(duct, T([0, -0.01, 0], [0, 0, 0])), CHROME)
    // nav lights: red to the left, green to the right
    k.add(sph(0.016, 10, 8), C(s < 0 ? '#ff3b4a' : '#3bff7a', 2.4), mul(duct, T([s * 0.0, 0, 0.14])), lit(1, FX.blink), s < 0 ? 0 : 0.5)
  }
  // a hover jet underneath
  k.add(cyl(0.06, 0.075, 0.04, 24), GRAPH, T([0, BY - 0.19, 0]), SATIN)
  k.add(tor(0.05, 0.012, 8, 24), C('#d68bff', 2.4), T([0, BY - 0.212, 0], [Math.PI / 2, 0, 0]), lit(1, FX.pulse))
  // two little antennae
  for (const s of [-1, 1]) {
    k.add(cyl(0.007, 0.007, 0.07, 8), CHROME_C, T([s * 0.06, BY + 0.2, -0.02], [0, 0, -s * 0.3]), CHROME)
    k.add(sph(0.017, 10, 8), deep, T([s * 0.072, BY + 0.235, -0.02]))
  }
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  sk.face(panel(circle(0.118, 44), 4, (x, y) => 0.03 * Math.max(0, 1 - (x * x + y * y) / 0.118 ** 2)), 'eye', FACE_TINT.zip, T([0, LY, LZ + 0.012]))
  root.add(sk.mesh('zip', m.screen))
  for (const s of [-1, 1]) {
    const r = new Kit()
    const hub: P3 = [s * 0.28, 0.24, 0.0]
    for (const b of [0, Math.PI]) r.add(capsule(0.016, 0.09, 3, 8).applyMatrix4(T([0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 0.35])), '#e9e4ff', mul(T(hub, [0.42, 0, 0]), T([0, 0.018, 0], [0.18, b, 0]), T([0.06, 0, 0])), SATIN)
    r.add(sph(0.02, 12, 8), CHROME_C, mul(T(hub, [0.42, 0, 0]), T([0, 0.022, 0])), CHROME)
    const rotor = joint(s < 0 ? 'rotorL' : 'rotorR', hub, r.mesh('rotor', m.body))
    rotor.rotation.x = 0.42
    // rotors spin about their own (tipped) y axis: the mesh is modelled tipped, so undo it inside the joint
    rotor.children[0].applyMatrix4(new THREE.Matrix4().makeRotationX(-0.42))
    rotor.userData.rest = restOf(rotor)
    root.add(rotor)
  }
  return root
}

/** Hex nut: chrome, chamfered, with a little screen face looking out of its hole */
function buildNut() {
  const m = grid()
  const k = new Kit()
  const hex = Array.from({ length: 6 }, (_, i): P2 => [Math.cos((i / 6) * TAU) * 0.29, Math.sin((i / 6) * TAU) * 0.29])
  const tilt = T([0, 0, 0], [0.18, -0.42, 0])
  k.add(extrude(frameShape(hex, circle(0.135, 36)), 0.15, 0.035, 12, 2), SYMBOL_COLOR.nut, tilt, fin(0.2, 0.6, 0.9))
  k.add(tor(0.136, 0.014, 8, 40), STEEL_C, mul(tilt, T([0, 0, 0.11])), STEEL)
  k.add(tor(0.124, 0.006, 6, 40), C('#5cf2ff', 2.2), mul(tilt, T([0, 0, 0.1])), lit(1, FX.pulse))
  for (let z = -0.05; z < 0.06; z += 0.03) k.add(tor(0.138, 0.007, 6, 36), STEEL_C, mul(tilt, T([0, 0, z])), STEEL)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  sk.face(panel(circle(0.122, 40), 3, (x, y) => 0.018 * Math.max(0, 1 - (x * x + y * y) / 0.122 ** 2)), 'round', FACE_TINT.nut, mul(tilt, T([0, 0, 0.065])))
  root.add(sk.mesh('nut', m.screen))
  return root
}

/** a gear outline: `n` teeth with rounded tips between radius r0 (root) and r1 (tip) */
function gearOutline(n: number, r0: number, r1: number): P2[] {
  const pts: P2[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU
    const step = TAU / n
    const prof: [number, number][] = [
      [0, r0],
      [0.18, r0],
      [0.3, r1 * 0.97],
      [0.36, r1],
      [0.64, r1],
      [0.7, r1 * 0.97],
      [0.82, r0],
    ]
    for (const [t, r] of prof) pts.push([Math.cos(a + t * step) * r, Math.sin(a + t * step) * r])
  }
  return pts
}

/** Gear: orange anodised aluminium with lightening holes, turning around a chrome hub with a round screen face */
function buildGear() {
  const m = grid()
  const tilt = T([0, 0, 0], [0.12, -0.32, 0])
  const g = new Kit()
  const s = frameShape(gearOutline(10, 0.27, 0.34), circle(0.11, 36))
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + Math.PI / 2
    s.holes.push(pathOf(circle(0.046, 20, Math.cos(a) * 0.19, Math.sin(a) * 0.19)))
  }
  g.add(extrude(s, 0.085, 0.016, 10, 2), SYMBOL_COLOR.gear, undefined, ANOD)
  const gear = new THREE.Mesh(g.geometry(), m.body)
  gear.name = 'gearMesh'
  const k = new Kit()
  k.add(extrude(frameShape(circle(0.135, 44), circle(0.1, 40)), 0.05, 0.014, 12, 3), CHROME_C, mul(tilt, T([0, 0, 0.06])), CHROME)
  k.add(cyl(0.11, 0.11, 0.1, 36), GRAPH, mul(tilt, T([0, 0, 0.0], [Math.PI / 2, 0, 0])), SATIN)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4
    k.add(dome(0.011), STEEL_C, mul(tilt, T([Math.cos(a) * 0.118, Math.sin(a) * 0.118, 0.092])), STEEL)
  }
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  // the gear turns about z inside a holder that carries the tilt
  const spin = new THREE.Group()
  spin.name = 'gear'
  spin.add(gear)
  const holder = new THREE.Group()
  holder.applyMatrix4(tilt)
  holder.add(spin)
  spin.userData.rest = restOf(spin)
  root.add(holder)
  const sk = new ScreenKit()
  sk.face(panel(circle(0.1, 40), 3, (x, y) => 0.012 * Math.max(0, 1 - (x * x + y * y) / 0.01)), 'round', FACE_TINT.gear, mul(tilt, T([0, 0, 0.07])))
  root.add(sk.mesh('gear', m.screen))
  return root
}

/** Battery: an upright cell in glossy black-green with chrome caps, a face and charge bars that fill */
function buildBattery() {
  const m = grid()
  const k = new Kit()
  const lean = T([0, -0.01, 0], [0, -0.25, -0.12])
  const R = 0.17
  const green = SYMBOL_COLOR.battery
  k.add(cyl(R, R, 0.5, 48), '#103a26', mul(lean, T([0, -0.03, 0])), GLOSS)
  // chrome caps with a rolled edge, the + nub on top
  k.add(lathe([[0, 0.25], [R * 0.98, 0.25], [R + 0.008, 0.235], [R + 0.01, 0.2], [R - 0.004, 0.19]], 48), CHROME_C, lean, CHROME)
  k.add(lathe([[R - 0.004, -0.25], [R + 0.01, -0.26], [R + 0.008, -0.295], [R * 0.98, -0.31], [0, -0.31]], 48), CHROME_C, lean, CHROME)
  k.add(cyl(0.06, 0.065, 0.045, 32), CHROME_C, mul(lean, T([0, 0.27, 0])), CHROME)
  k.add(tor(0.06, 0.008, 8, 32), CHROME_C, mul(lean, T([0, 0.292, 0], [Math.PI / 2, 0, 0])), CHROME)
  // a glowing green stripe down each side
  for (const a of [-1.05, 1.05]) k.add(rbox(0.024, 0.4, 0.024, 0.01), C(green, 1.6), mul(lean, T([Math.sin(a) * R, -0.03, Math.cos(a) * R], [0, a, 0])), lit(1, FX.pulse), a > 0 ? 0.5 : 0)
  // charge bars: three curved segments that fill bottom to top
  for (let i = 0; i < 3; i++) {
    const g = cyl(R + 0.004, R + 0.004, 0.05, 24, true)
    const keepFront = new THREE.CylinderGeometry(R + 0.006, R + 0.006, 0.048, 20, 1, false, -0.62, 1.24)
    g.dispose()
    k.add(keepFront, C(green, 2.2), mul(lean, T([0, -0.2 + i * 0.068, 0])), lit(1, FX.fill), 0.15 + i * 0.25)
  }
  // a bolt emblem between face and bars
  const bolt = shapeOf([
    [0.012, 0.05],
    [-0.03, -0.006],
    [-0.002, -0.006],
    [-0.014, -0.05],
    [0.03, 0.008],
    [0.002, 0.008],
  ])
  k.add(extrude(bolt, 0.012, 0.004, 1, 1), C('#ffd23a', 1.4), mul(lean, T([0, -0.0, R + 0.002])), lit(0.6))
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  const scr = new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.13, 28, 4, true, -0.78, 1.56)
  sk.face(scr, 'wide', FACE_TINT.battery, mul(lean, T([0, 0.115, 0])))
  root.add(sk.mesh('battery', m.screen))
  return root
}

/** Microchip: a glossy blue package with gold pins, glowing traces and a face on the die */
function buildChip() {
  const m = grid()
  const k = new Kit()
  const tilt = T([0, 0, 0], [0.3, -0.28, 0])
  const S = 0.44
  const blue = '#2c7dff'
  k.add(rbox(S, S, 0.075, 0.03, 2), blue, tilt)
  // gold pins, five a side, bent down out of the package
  for (let side = 0; side < 4; side++) {
    const rot = T([0, 0, 0], [0, 0, (side * Math.PI) / 2])
    for (let i = 0; i < 5; i++) {
      const x = -0.16 + i * 0.08
      k.add(box(0.04, 0.06, 0.016), GOLD_C, mul(tilt, rot, T([x, S / 2 + 0.024, -0.01])), GOLD)
      k.add(box(0.04, 0.016, 0.05), GOLD_C, mul(tilt, rot, T([x, S / 2 + 0.048, -0.035])), GOLD)
    }
  }
  // traces: from the die out to every pin, with pads
  const trace = (pts: P2[]) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]
      const b = pts[i + 1]
      const len = Math.hypot(b[0] - a[0], b[1] - a[1])
      k.add(box(len + 0.01, 0.011, 0.006), C('#7fd8ff', 1.7), mul(tilt, T([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, 0.04], [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])])), lit(1, FX.pulse), (i * 0.13 + Math.abs(a[0] * 3)) % 0.9)
    }
    const e = pts[pts.length - 1]
    k.add(cyl(0.014, 0.014, 0.006, 12), C('#bff0ff', 2), mul(tilt, T([e[0], e[1], 0.04], [Math.PI / 2, 0, 0])), lit(1, FX.pulse), 0.5)
  }
  for (let side = 0; side < 4; side++) {
    const r = (p: P2): P2 => {
      const a = (side * Math.PI) / 2
      return [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)]
    }
    trace([r([-0.16, 0.2]), r([-0.16, 0.16]), r([-0.1, 0.12])])
    trace([r([0.0, 0.2]), r([0.0, 0.12])])
    trace([r([0.16, 0.2]), r([0.16, 0.16]), r([0.1, 0.12])])
  }
  // the die in a dark frame, and a pin-one dot
  k.add(rbox(0.21, 0.21, 0.03, 0.02), GRAPH, mul(tilt, T([0, 0, 0.035])), GLOSS)
  k.add(cyl(0.016, 0.016, 0.006, 14), C('#ffd23a', 2), mul(tilt, T([-0.17, 0.17, 0.04], [Math.PI / 2, 0, 0])), lit(1, FX.blink))
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const sk = new ScreenKit()
  sk.face(panel(rrOutline(0.18, 0.18, 0.03), 3, bulge(0.18, 0.18, 0.006)), 'round', FACE_TINT.chip, mul(tilt, T([0, 0, 0.052])))
  root.add(sk.mesh('chip', m.screen))
  return root
}

/** Wild: a plasma core crackling in a spinning chrome cage, with a WILD band across its middle */
function buildWild() {
  const mag = SYMBOL_COLOR.wild
  const m = grid()
  const k = new Kit()
  // the hot core inside the plasma
  k.add(sph(0.085, 24, 16), C('#ffd0f4', 2.6), undefined, lit(1, FX.flicker))
  // caps top and bottom with a magenta light ring
  for (const s of [-1, 1]) {
    const cap = lathe(
      [
        [0.0, 0.3],
        [0.07, 0.3],
        [0.1, 0.285],
        [0.13, 0.255],
        [0.16, 0.235],
        [0.165, 0.215],
        [0.12, 0.205],
      ].map(([x, y]): P2 => [x, y]),
      40,
    )
    k.add(cap, CHROME_C, T([0, 0, 0], [0, 0, 0], [1, s, 1]), CHROME)
    k.add(tor(0.15, 0.01, 8, 40), C(mag, 2.2), T([0, s * 0.22, 0], [Math.PI / 2, 0, 0]), lit(1, FX.pulse), s > 0 ? 0 : 0.5)
    k.add(sph(0.03, 16, 10), C(mag, 2.4), T([0, s * 0.31, 0]), lit(1, FX.pulse))
  }
  // the band: chrome rails round a dark screen
  for (const y of [-0.085, 0.085]) {
    k.add(new THREE.CylinderGeometry(0.25, 0.25, 0.018, 48, 1, true, -1.35, 2.7), CHROME_C, T([0, y + Math.sign(y) * 0.006, 0]), CHROME)
    k.add(new THREE.CylinderGeometry(0.252, 0.252, 0.008, 48, 1, true, -1.32, 2.64), C(mag, 2), T([0, y - Math.sign(y) * 0.004, 0]), lit(1, FX.pulse))
  }
  for (const s of [-1, 1]) k.add(cyl(0.012, 0.012, 0.19, 10), CHROME_C, T([Math.sin(s * 1.35) * 0.248, 0, Math.cos(s * 1.35) * 0.248]), CHROME)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  const plasma = new THREE.Mesh(sph(0.17, 36, 24), m.plasma)
  plasma.name = 'plasma'
  root.add(plasma)
  const c = new Kit()
  for (let i = 0; i < 4; i++) c.add(tor(0.205, 0.011, 8, 56), CHROME_C, T([0, 0, 0], [0, (i * Math.PI) / 4, 0]), CHROME)
  c.add(tor(0.205, 0.011, 8, 56), CHROME_C, T([0, 0, 0], [Math.PI / 2, 0, 0]), CHROME)
  root.add(joint('cage', [0, 0, 0], c.mesh('cage', m.body)))
  const sk = new ScreenKit()
  sk.blank(new THREE.CylinderGeometry(0.244, 0.244, 0.155, 48, 1, true, -1.35, 2.7))
  sk.label('WILD', C(mag, 1.4), T([0, -0.002, 0.258]), 0.15, 0.4, 0.258)
  root.add(sk.mesh('wild', m.screen))
  return root
}

/* ---------------- bonus symbols ---------------- */

const BOT_COLOR: Record<BotKind, string> = { magnet: '#ff3b4f', zap: '#ffd21f', boost: '#3fe46a' }
/** where a bot's value display sits: a wide dark plate across the lower part of the cell */
const DISPLAY = { y: -0.25, w: 0.84, h: 0.3, z: 0.13 }
/** the power cell: a fat glass capsule lying across the cell, its value written over the middle */
const CELL_Y = 0.01
const CELL_R = 0.255
const CELL_L = 0.56

/**
 * Where the scene writes each bonus symbol's value (the numbers are drawn by ValueLabels, not in the model):
 * the centre of the text in model units, its cap height and the widest it may run.
 */
export function valueAnchor(sym: Sym): { y: number; z: number; size: number; maxW: number } {
  return sym === 'cell' ? { y: CELL_Y, z: CELL_R + 0.12, size: 0.27, maxW: 0.86 } : { y: DISPLAY.y + 0.004, z: DISPLAY.z + 0.16, size: 0.215, maxW: DISPLAY.w + 0.04 }
}

/** the value plate every bot carries: a chrome (or gold) bezel round dark glass; the number goes over it */
function valuePlate(k: Kit, sk: ScreenKit, gold: boolean) {
  const { y, w, h, z } = DISPLAY
  const rim = gold ? GOLD_C : CHROME_C
  k.add(extrude(frameShape(rrOutline(w, h, 0.08), rrOutline(w - 0.05, h - 0.05, 0.06)), 0.05, 0.012), rim, T([0, y, z]), gold ? GOLD : CHROME)
  k.add(rbox(w - 0.03, h - 0.03, 0.06, 0.05), INKY, T([0, y, z - 0.03]), GLOSS)
  sk.blank(panel(rrOutline(w - 0.05, h - 0.05, 0.06), 2), T([0, y, z + 0.02]))
}

/**
 * Power cell: a fat glass capsule lying across the cell between chrome end caps (a + terminal on the right), a
 * glowing core and rings inside in the value's colour, held in a cradle. The value is written across its middle.
 */
function buildCell() {
  const m = grid()
  const k = new Kit()
  const sk = new ScreenKit()
  const Y = CELL_Y
  const R = CELL_R
  const L = CELL_L
  // things modelled along y, laid along x
  const along = (x: number, y = Y, z = 0) => T([x, y, z], [0, 0, -Math.PI / 2])
  for (const s of [-1, 1]) {
    const x = s * (L / 2 + 0.035)
    // the end cap: a chrome collar, a rolled edge and a domed end
    k.add(cyl(R + 0.018, R + 0.018, 0.08, 36), CHROME_C, along(x), CHROME)
    k.add(tor(R + 0.016, 0.015, 6, 36), CHROME_C, T([x - s * 0.04, Y, 0], [0, Math.PI / 2, 0]), CHROME)
    k.add(tor(R + 0.012, 0.011, 6, 36), STEEL_C, T([x + s * 0.012, Y, 0], [0, Math.PI / 2, 0]), STEEL)
    k.add(dome(R + 0.01, 0.3, 28, 6), CHROME_C, T([x + s * 0.04, Y, 0], [0, (s * Math.PI) / 2, 0]), CHROME)
  }
  // the + terminal on the right, a flat - pad on the left
  k.add(cyl(0.072, 0.082, 0.04, 24), STEEL_C, along(L / 2 + 0.12), STEEL)
  k.add(cyl(0.048, 0.048, 0.018, 20), C('#ffd23a', 1.4), along(L / 2 + 0.146), lit(0.7))
  k.add(cyl(0.09, 0.09, 0.018, 24), STEEL_C, along(-L / 2 - 0.12), STEEL)
  // four chrome rods along the glass
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4
    k.add(cyl(0.01, 0.01, L, 8), CHROME_C, along(0, Y + Math.cos(a) * (R - 0.02), Math.sin(a) * (R - 0.02)), CHROME)
  }
  // the cradle under it: two graphite saddles on a rubber foot
  for (const s of [-1, 1]) k.add(rbox(0.1, 0.12, 0.22, 0.03), GRAPH, T([s * 0.2, Y - R - 0.01, -0.02]), SATIN)
  k.add(rbox(0.6, 0.05, 0.24, 0.022), '#1d222c', T([0, Y - R - 0.075, -0.02]), RUBBER)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  // the core: a fat column of light filling the glass, ringed near each end, recoloured with the value (calm in the
  // middle, where the number sits)
  sk.solid(cyl(0.155, 0.155, L - 0.05, 24), C('#5cf2ff', 1), along(0))
  for (const s of [-1, 1]) sk.solid(tor(0.19, 0.012, 6, 28), C('#5cf2ff', 1), T([s * 0.235, Y, 0], [0, Math.PI / 2, 0]))
  root.add(sk.mesh('cell', m.screen))
  const glass = new THREE.Mesh(cyl(R, R, L, 36, true), m.glass)
  glass.name = 'glass'
  glass.position.y = Y
  glass.rotation.z = -Math.PI / 2
  root.add(glass)
  return root
}

/** the head every ability bot has: a rounded box with a screen face; returns its centre */
function botHead(k: Kit, sk: ScreenKit, color: string, gold: boolean, tint: string, y = 0.05) {
  const W = 0.4
  const H = 0.29
  const D = 0.28
  k.add(rbox(W, H, D, 0.075, 3), color, T([0, y, -0.02]), gold ? GOLD : GLOSS)
  const SW = 0.31
  const SH = 0.205
  k.add(extrude(frameShape(rrOutline(SW + 0.04, SH + 0.04, 0.07), rrOutline(SW, SH, 0.055)), 0.02, 0.008), gold ? '#7a4a12' : GRAPH, T([0, y, D / 2 - 0.01]), GLOSS)
  sk.face(panel(rrOutline(SW, SH, 0.055), 4, bulge(SW, SH, 0.008)), 'box', tint, T([0, y, D / 2 - 0.013]))
  // ear studs
  for (const s of [-1, 1]) k.add(cyl(0.045, 0.045, 0.03, 20), gold ? '#fff0c0' : CHROME_C, T([s * (W / 2 + 0.01), y, -0.02], [0, 0, Math.PI / 2]), CHROME)
  return y
}

/** the body behind the value plate, in the bot's colour (gold for gold bots), with little feet */
function botBody(k: Kit, color: string, gold: boolean) {
  k.add(rbox(0.86, 0.31, 0.24, 0.08, 2), color, T([0, DISPLAY.y, 0]), gold ? GOLD : GLOSS)
  for (const s of [-1, 1]) {
    k.add(rbox(0.13, 0.05, 0.16, 0.022), GRAPH, T([s * 0.25, DISPLAY.y - 0.175, 0.02]), RUBBER)
    // side LEDs
    k.add(sph(0.018, 10, 8), C(gold ? '#fff3c4' : '#ffffff', 2.2), T([s * 0.425, DISPLAY.y + 0.06, 0.04]), lit(1, FX.blink), s > 0 ? 0.5 : 0)
  }
  // the neck up to the head
  k.add(cyl(0.07, 0.085, 0.07, 24), gold ? '#e7b04a' : STEEL_C, T([0, -0.1, -0.02]), gold ? GOLD : STEEL)
}

/** the gold bots' halo: a glowing ring behind the bot */
function halo(k: Kit) {
  k.add(tor(0.335, 0.014, 6, 64), C('#ffc94a', 1.5), T([0, 0.1, -0.17]), lit(1, FX.pulse))
  k.add(tor(0.335, 0.005, 4, 64), C('#fff3cf', 1.9), T([0, 0.1, -0.158]), lit(1))
  // sparkles on the ring
  for (let i = 0; i < 4; i++) {
    const a = 0.5 + (i * TAU) / 4
    k.add(sph(0.018, 8, 6), C('#fff6dc', 2.6), T([Math.cos(a) * 0.335, 0.1 + Math.sin(a) * 0.335, -0.15]), lit(1, FX.blink), i * 0.25)
  }
}

/** the gold bots' badge: GOLD on a dark plate with a gold rim, at the top of the head */
function goldTag(k: Kit, sk: ScreenKit, hy: number) {
  const y = hy + 0.17
  k.add(extrude(frameShape(rrOutline(0.2, 0.075, 0.03), rrOutline(0.176, 0.052, 0.022)), 0.02, 0.006, 6, 2), GOLD_C, T([0, y, 0.122]), GOLD)
  sk.blank(panel(rrOutline(0.18, 0.056, 0.024), 1), T([0, y, 0.124]))
  sk.label('GOLD', C('#ffd56a', 1.5), T([0, y, 0.13]), 0.07, 0.15)
}

/** Magnet bot: a red horseshoe magnet arching over its head, sparking between its poles */
function buildMagnet(gold: boolean) {
  const m = grid()
  const k = new Kit()
  const sk = new ScreenKit()
  const col = BOT_COLOR.magnet
  const shell = gold ? GOLD_C : col
  botBody(k, shell, gold)
  const hy = botHead(k, sk, gold ? GOLD_C : WHITE, gold, gold ? FACE_TINT.gold : FACE_TINT.magnet)
  // the horseshoe: a half torus and two legs, silver poles at the ends
  const R = 0.2
  const AY = hy + 0.17
  k.add(tor(R, 0.058, 14, 40, Math.PI), col, T([0, AY, -0.02]), gold ? GOLD : GLOSS)
  for (const s of [-1, 1]) {
    k.add(cyl(0.058, 0.058, 0.08, 24), col, T([s * R, AY - 0.04, -0.02]), gold ? GOLD : GLOSS)
    k.add(cyl(0.06, 0.06, 0.07, 24), CHROME_C, T([s * R, AY - 0.11, -0.02]), CHROME)
    k.add(tor(0.06, 0.006, 6, 24), GRAPH, T([s * R, AY - 0.077, -0.02], [Math.PI / 2, 0, 0]), GLOSS)
  }
  // field sparks at the poles
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const a = -0.5 + i * 0.5
      k.add(capsule(0.006, 0.035, 2, 6), C('#8fe8ff', 2.6), T([s * (R + 0.075), AY - 0.12 + i * 0.03, 0.0], [0, 0, s * (0.9 + a)]), lit(1, FX.flicker), i * 0.3)
    }
  if (gold) halo(k)
  valuePlate(k, sk, gold)
  if (gold) goldTag(k, sk, hy)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  root.add(sk.mesh(gold ? 'magnet-gold' : 'magnet', m.screen))
  return root
}

/** Zap bot: a tesla coil on its head, crackling */
function buildZap(gold: boolean) {
  const m = grid()
  const k = new Kit()
  const sk = new ScreenKit()
  const col = BOT_COLOR.zap
  botBody(k, gold ? GOLD_C : col, gold)
  const hy = botHead(k, sk, gold ? GOLD_C : col, gold, gold ? FACE_TINT.gold : FACE_TINT.zap)
  const base = hy + 0.145
  k.add(cyl(0.05, 0.07, 0.04, 24), GRAPH, T([0, base + 0.02, -0.02]), GLOSS)
  // the coil: copper wound round a white former
  k.add(cyl(0.03, 0.03, 0.14, 16), WHITE, T([0, base + 0.1, -0.02]), GLOSS)
  const helix: P3[] = Array.from({ length: 80 }, (_, i) => {
    const t = i / 79
    const a = t * TAU * 7
    return [Math.cos(a) * 0.036, base + 0.04 + t * 0.12, -0.02 + Math.sin(a) * 0.036]
  })
  k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helix.map((p) => V(...p))), 96, 0.008, 5), COPPER_C, undefined, COPPER)
  // the top load: a chrome toroid and a glowing ball
  k.add(tor(0.075, 0.03, 14, 40), CHROME_C, T([0, base + 0.18, -0.02], [Math.PI / 2, 0, 0]), CHROME)
  k.add(sph(0.04, 18, 12), C('#fff6a8', 2.6), T([0, base + 0.2, -0.02]), lit(1, FX.flicker))
  // little bolts arcing off the toroid
  const zig = (a: number, ph: number) => {
    const pts: P3[] = []
    for (let i = 0; i < 5; i++) {
      const r = 0.11 + i * 0.03
      const j = i % 2 ? 0.18 : -0.18
      pts.push([Math.cos(a + j * 0.4) * r, base + 0.18 + Math.sin(a + j) * 0.035 + i * 0.006, -0.02 + 0.03])
    }
    for (let i = 0; i < pts.length - 1; i++) k.add(capsule(0.006, dist(pts[i], pts[i + 1]), 2, 6), C('#fff7b0', 2.8), aim(pts[i], pts[i + 1]), lit(1, FX.flicker), ph)
  }
  zig(0.35, 0.1)
  zig(Math.PI - 0.35, 0.6)
  if (gold) halo(k)
  valuePlate(k, sk, gold)
  if (gold) goldTag(k, sk, hy)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  root.add(sk.mesh(gold ? 'zap-gold' : 'zap', m.screen))
  return root
}

/** Boost bot: a battery pack with an amplifier dish on top that pulses */
function buildBoost(gold: boolean) {
  const m = grid()
  const k = new Kit()
  const sk = new ScreenKit()
  const col = BOT_COLOR.boost
  botBody(k, gold ? GOLD_C : col, gold)
  // battery cells on the sides of the pack
  for (const s of [-1, 1]) {
    k.add(cyl(0.05, 0.05, 0.24, 24), gold ? '#7a4a12' : '#103a26', T([s * 0.43, DISPLAY.y, -0.03], [0, 0, 0]), GLOSS)
    for (const e of [-1, 1]) k.add(cyl(0.052, 0.052, 0.03, 24), CHROME_C, T([s * 0.43, DISPLAY.y + e * 0.12, -0.03]), CHROME)
    k.add(rbox(0.02, 0.15, 0.02, 0.008), C('#7dffa0', 2.2), T([s * 0.43, DISPLAY.y, 0.02]), lit(1, FX.fill), 0.3)
  }
  const hy = botHead(k, sk, gold ? GOLD_C : WHITE, gold, gold ? FACE_TINT.gold : FACE_TINT.boost)
  // the dish, tipped towards the camera, on a short mast
  const base = hy + 0.145
  k.add(cyl(0.022, 0.03, 0.1, 14), CHROME_C, T([0, base + 0.04, -0.07]), CHROME)
  const dishM = T([0, base + (gold ? 0.135 : 0.115), -0.08], [0.95, 0, 0])
  const prof: P2[] = Array.from({ length: 9 }, (_, i) => {
    const r = (i / 8) * 0.17
    return [r, (r * r) / 0.17 * 0.55]
  })
  // the outside in the bot's colour (a lathe from the middle out faces outwards), the inside chrome (reversed)
  k.add(lathe(prof, 44), gold ? GOLD_C : col, dishM, gold ? GOLD : GLOSS)
  k.add(lathe(prof.map(([x, y]): P2 => [x * 0.97, y + 0.007]).reverse(), 44), CHROME_C, dishM, CHROME)
  k.add(tor(0.17, 0.012, 6, 40), gold ? GOLD_C : col, mul(dishM, T([0, 0.096, 0], [Math.PI / 2, 0, 0])), gold ? GOLD : GLOSS)
  for (const r of [0.07, 0.12]) k.add(tor(r, 0.006, 6, 40), C('#7dffa0', 2.4), mul(dishM, T([0, (r * r) / 0.17 * 0.55 + 0.008, 0], [Math.PI / 2, 0, 0])), lit(1, FX.pulse), r * 4)
  k.add(cyl(0.008, 0.008, 0.11, 8), CHROME_C, mul(dishM, T([0, 0.055, 0])), CHROME)
  k.add(sph(0.026, 14, 10), C('#b6ffc9', 2.8), mul(dishM, T([0, 0.115, 0])), lit(1, FX.pulse))
  if (gold) halo(k)
  valuePlate(k, sk, gold)
  if (gold) goldTag(k, sk, hy)
  const root = new THREE.Group()
  root.add(k.mesh('body', m.body))
  root.add(sk.mesh(gold ? 'boost-gold' : 'boost', m.screen))
  return root
}

/* ------------------------------------------------------------------ */
/*  Building and sharing                                                */
/* ------------------------------------------------------------------ */

const BUILD: Record<string, () => THREE.Group> = {
  rex: buildRex,
  dot: buildDot,
  clank: buildClank,
  zip: buildZip,
  nut: buildNut,
  gear: buildGear,
  battery: buildBattery,
  chip: buildChip,
  wild: buildWild,
  cell: buildCell,
  magnet: () => buildMagnet(false),
  zap: () => buildZap(false),
  boost: () => buildBoost(false),
  'magnet-gold': () => buildMagnet(true),
  'zap-gold': () => buildZap(true),
  'boost-gold': () => buildBoost(true),
}

/**
 * How much bigger than modelled each piece is drawn, so that every one fills its cell about as fully (the robots
 * already do; the little tech objects and the wild were well under it).
 */
const FIT: Record<string, number> = { nut: 1.3, gear: 1.22, battery: 1.36, chip: 1.44, wild: 1.24, zip: 1.04, clank: 1.02 }

const protos = new Map<string, THREE.Group>()
function proto(key: string) {
  let p = protos.get(key)
  if (!p) {
    lod = 1
    p = BUILD[key]()
    const fit = FIT[key]
    if (fit) {
      // scaled inside a group, so the scene can still scale the root and parts keep their rest poses
      const g = new THREE.Group()
      g.name = 'fit'
      g.scale.setScalar(fit)
      g.add(...p.children)
      p.add(g)
    }
    p.userData.key = key
    protos.set(key, p)
  }
  return p
}

const isBot = (s: Sym): s is BotKind => s === 'magnet' || s === 'zap' || s === 'boost'
/** each piece's own screen mesh */
const screens = new WeakMap<THREE.Object3D, THREE.Mesh>()
/** per-piece screen geometries still alive, for disposeModels() */
const owned = new Set<Geo>()

/**
 * A fresh copy of a symbol, sharing geometry and materials with every other copy except its screen (faces and
 * value). Bonus symbols take their value (number: formatted with formatValue and coloured by valueColor; string:
 * shown as given). `gold` only applies to the bots. root.userData: { sym, key, gold, face, value }.
 */
export function buildSymbol(sym: Sym, value?: number | string, gold = false): THREE.Group {
  const key = gold && isBot(sym) ? `${sym}-gold` : sym
  const o = proto(key).clone()
  o.userData = { sym, key, gold: gold && isBot(sym), face: 'idle', value: '' }
  const screen = o.getObjectByName('screen') as THREE.Mesh | undefined
  if (screen) {
    screen.geometry = screen.geometry.clone()
    owned.add(screen.geometry)
    screens.set(o, screen)
    live.add(new WeakRef(o))
  }
  if (isBonus(sym)) setValue(o, value ?? 1)
  return o
}

/** frees a piece's own screen geometry (the rest is shared); the piece must not be drawn again */
export function releaseSymbol(o: THREE.Object3D) {
  const s = screenOf(o)
  if (s && owned.has(s.geometry)) {
    owned.delete(s.geometry)
    s.geometry.dispose()
  }
}

function screenOf(o: THREE.Object3D) {
  let s = screens.get(o)
  if (!s) {
    s = o.getObjectByName('screen') as THREE.Mesh | undefined
    if (s) screens.set(o, s)
  }
  return s
}
function rootOf(o: THREE.Object3D) {
  let r: THREE.Object3D | null = o
  while (r && !r.userData.key) r = r.parent
  return r ?? o
}

/**
 * The animated parts of each model: groups under the piece that turn about their joint, rest pose in
 * userData.rest. Every piece also has a 'body' mesh and a 'screen' mesh; the power cell has 'glass', the wild
 * 'plasma'. Spin: wheel and gear about z, cage about y, rotors about their own y (rotation.y); arms rock about z.
 */
export const PARTS: Record<Sym, readonly string[]> = {
  rex: ['armL', 'armR'],
  dot: ['head', 'arms', 'wheel'],
  clank: ['armL', 'armR'],
  zip: ['rotorL', 'rotorR'],
  nut: [],
  gear: ['gear'],
  battery: [],
  chip: [],
  wild: ['cage'],
  cell: [],
  magnet: [],
  zap: [],
  boost: [],
}

/** which symbols have a face that setFace changes (the wild and the power cell have none) */
export function hasFace(sym: Sym) {
  return sym !== 'wild' && sym !== 'cell'
}

/** shows an expression on a piece's screen (no-op for pieces without a face) */
export function setFace(o: THREE.Object3D, e: Expr) {
  const root = rootOf(o)
  const s = screenOf(root)
  const L = layouts.get(root.userData.key as string)
  if (!s || !L || !L.faces.length) return
  root.userData.face = e
  for (const f of L.faces) writeFaceUV(s.geometry.getAttribute('uv') as THREE.BufferAttribute, f, e)
}

/** the expression a piece shows */
export const faceOf = (o: THREE.Object3D): Expr => (rootOf(o).userData.face as Expr) ?? 'idle'

/** a value as it fits on a cell: 1, 25, 150, 1.25K, 12.5K, 120K, 1.2M */
export function formatValue(v: number) {
  const trim = (s: string) => s.replace(/\.0+$|(\.\d*?)0+$/, '$1')
  if (v < 1000) return trim(v.toFixed(v < 10 && v % 1 ? 2 : v % 1 ? 1 : 0))
  if (v < 1e6) return trim((v / 1000).toFixed(v < 1e4 ? 2 : v < 1e5 ? 1 : 0)) + 'K'
  return trim((v / 1e6).toFixed(v < 1e7 ? 2 : 1)) + 'M'
}

/** a value as the cells show it: formatValue with a × after it, so it never reads as coins next to coin totals */
export const valueText = (v: number) => `${formatValue(v)}×`

/**
 * Sets a bonus symbol's value colour (the power cell's core glows in it) and, on a model that has a glyph display,
 * its text. A number is a multiple of the bet, formatted with valueText and coloured by valueColor; a string is
 * shown as it is, in `color` or the value's colour. The bonus symbols here carry no glyph display: the scene writes
 * their numbers big with ValueLabels.
 */
export function setValue(o: THREE.Object3D, v: number | string, color?: THREE.ColorRepresentation) {
  const root = rootOf(o)
  const s = screenOf(root)
  const L = layouts.get(root.userData.key as string)
  if (!s || !L) return
  const text = typeof v === 'number' ? valueText(v) : v
  const base = C(color ?? valueColor(typeof v === 'number' ? v : parseFloat(v) || 1))
  const c = base.clone().multiplyScalar(1.35)
  root.userData.value = text
  root.userData.valueColor = '#' + base.getHexString()
  if (L.value >= 0) writeText(s.geometry, L.displays[L.value], text, c)
  // the core of a power cell glows in the value's colour
  if (root.userData.sym === 'cell') {
    const col = s.geometry.getAttribute('color') as THREE.BufferAttribute
    const uv = s.geometry.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < col.count; i++)
      if (Math.abs(uv.getX(i) - SOLID_UV[0]) < 1e-4 && Math.abs(uv.getY(i) - SOLID_UV[1]) < 1e-4) col.setXYZ(i, base.r * 0.62, base.g * 0.62, base.b * 0.62)
    col.needsUpdate = true
  }
}

/** rewrites a screen's fixed labels (WILD, GOLD) */
function writeLabels(geo: Geo, L: Layout) {
  for (const l of L.labels) writeText(geo, L.displays[l.display], l.text, new THREE.Color().fromArray(l.color))
}

/** pieces built so far, so their text can be laid out again once the web font has arrived */
const live = new Set<WeakRef<THREE.Object3D>>()

/** after the web font arrives the glyph widths change: lay every label and value out again */
function relayoutAll() {
  for (const p of protos.values()) {
    const L = layouts.get(p.userData.key as string)
    const s = p.getObjectByName('screen') as THREE.Mesh | undefined
    if (L && s) writeLabels(s.geometry, L)
  }
  for (const ref of live) {
    const o = ref.deref()
    if (!o) {
      live.delete(ref)
      continue
    }
    const L = layouts.get(o.userData.key as string)
    const s = screenOf(o)
    if (!L || !s) continue
    writeLabels(s.geometry, L)
    if (L.value >= 0 && o.userData.value) setValue(o, o.userData.value as string, o.userData.valueColor as string)
  }
}

/** builds every model ahead of time */
export function warmUp() {
  atlas()
  for (const key of Object.keys(BUILD)) proto(key)
}

/** a static model for paytables and previews, posed with the given face */
export function previewSymbol(sym: Sym, e: Expr = 'happy', value?: number | string, gold = false) {
  const o = buildSymbol(sym, value, gold)
  setFace(o, e)
  return o
}

/* ------------------------------------------------------------------ */
/*  Value labels: the big numbers on the bonus symbols                  */
/* ------------------------------------------------------------------ */

/*
  In a hold-and-win the numbers are the game, so they are not left to the little screens in the models: every value
  is drawn as big bold numerals with a dark outline and a soft shadow, coloured by valueColor (white at the top),
  always facing the camera and always on top, from one atlas of pre-drawn glyphs. All the labels on the board are two
  instanced draws: the outlines and shadows first, then the fills, so a glyph's outline never cuts into the one
  beside it.
*/

const VL_W = 1024
const VL_H = 512
const VL_PX = 104
const VL_CHARS = '0123456789.,KM×+-'

interface ValueGlyph {
  /** atlas rect: u across, v from the top of the glyph's cell to its bottom */
  u0: number
  u1: number
  vTop: number
  vBot: number
  /** in cap heights: advance, quad width and the quad's left edge from the pen */
  adv: number
  w: number
  left: number
}

let vlTex: THREE.DataTexture | null = null
const vlGlyphs = new Map<string, ValueGlyph>()
/** the glyph cell's height in cap heights, and where the cap sits in it (0 at the bottom) */
let vlCellH = 2
let vlCapLo = 0.25

/** draws the glyphs: R the fill, G the outline (fill included), B a soft shadow round it */
function drawValueAtlas(data: Uint8Array) {
  const font = `800 ${VL_PX}px ${FONT}`
  const ctx = () => {
    const c = document.createElement('canvas')
    c.width = VL_W
    c.height = VL_H
    const g = c.getContext('2d', { willReadFrequently: true })!
    g.font = font
    g.textBaseline = 'alphabetic'
    g.textAlign = 'left'
    g.lineJoin = 'round'
    g.miterLimit = 2
    return g
  }
  const fill = ctx()
  const line = ctx()
  const shade = ctx()
  const cap = Math.ceil(fill.measureText('0').actualBoundingBoxAscent)
  const ow = Math.round(VL_PX * 0.14)
  const sw = Math.round(VL_PX * 0.11)
  const pad = ow + sw + 3
  const cellH = cap + 2 * pad
  vlCellH = cellH / cap
  vlCapLo = pad / cellH
  vlGlyphs.clear()
  let x = 2
  let y = 2
  for (const ch of VL_CHARS) {
    const m = fill.measureText(ch)
    const l = Math.ceil(m.actualBoundingBoxLeft)
    const r = Math.ceil(m.actualBoundingBoxRight)
    const w = l + r + 2 * pad
    if (x + w > VL_W - 2) {
      x = 2
      y += cellH + 4
    }
    const px = x + pad + l
    const base = y + pad + cap
    fill.fillStyle = '#fff'
    fill.fillText(ch, px, base)
    line.strokeStyle = line.fillStyle = '#fff'
    line.lineWidth = ow * 2
    line.strokeText(ch, px, base)
    line.fillText(ch, px, base)
    // the shadow: wide translucent strokes rather than a canvas blur (slow, and not everywhere)
    shade.strokeStyle = '#fff'
    for (const [lw, a] of [
      [(ow + sw) * 2, 0.35],
      [(ow + sw * 0.55) * 2, 0.45],
      [(ow + sw * 0.2) * 2, 0.6],
    ]) {
      shade.globalAlpha = a
      shade.lineWidth = lw
      shade.strokeText(ch, px, base)
    }
    shade.globalAlpha = 1
    vlGlyphs.set(ch, { u0: x / VL_W, u1: (x + w) / VL_W, vTop: y / VL_H, vBot: (y + cellH) / VL_H, adv: m.width / cap, w: w / cap, left: -(pad + l) / cap })
    x += w + 4
  }
  const a = fill.getImageData(0, 0, VL_W, VL_H).data
  const b = line.getImageData(0, 0, VL_W, VL_H).data
  const c = shade.getImageData(0, 0, VL_W, VL_H).data
  for (let i = 0; i < VL_W * VL_H; i++) {
    data[i * 4] = a[i * 4 + 3]
    data[i * 4 + 1] = b[i * 4 + 3]
    data[i * 4 + 2] = Math.min(255, c[i * 4 + 3] + b[i * 4 + 3])
    data[i * 4 + 3] = 255
  }
}

function valueAtlas() {
  if (vlTex) return vlTex
  const data = new Uint8Array(VL_W * VL_H * 4)
  drawValueAtlas(data)
  const t = new THREE.DataTexture(data, VL_W, VL_H, THREE.RGBAFormat)
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.magFilter = THREE.LinearFilter
  t.colorSpace = THREE.NoColorSpace
  t.needsUpdate = true
  vlTex = t
  const font = `800 ${VL_PX}px ${FONT}`
  if (!document.fonts.check(font))
    document.fonts.load(font).then(
      () => {
        if (vlTex !== t) return
        drawValueAtlas(data)
        t.needsUpdate = true
      },
      () => {},
    )
  return t
}

const VL_VERT = /* glsl */ `
attribute vec4 aRect;
attribute vec4 aTint;
attribute float aFlash;
varying vec2 vSt;
varying float vY;
varying vec4 vTint;
varying float vFlash;
varying float vWy;
void main() {
  vSt = vec2(mix(aRect.x, aRect.z, uv.x), mix(aRect.w, aRect.y, uv.y));
  vY = uv.y;
  vTint = aTint;
  vFlash = aFlash;
  vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWy = w.y;
  gl_Position = projectionMatrix * viewMatrix * w;
}`
const VL_FILL = /* glsl */ `
uniform sampler2D map;
uniform float uClip;
uniform float uCapLo;
varying vec2 vSt;
varying float vY;
varying vec4 vTint;
varying float vFlash;
varying float vWy;
void main() {
  if (abs(vWy) > uClip) discard;
  float a = texture2D(map, vSt).r * vTint.a;
  if (a < 0.004) discard;
  // the value's colour, lifting to white towards the top of the cap, and a white flash when it changes
  float hi = clamp((vY - uCapLo) / (1.0 - 2.0 * uCapLo), 0.0, 1.0);
  vec3 col = mix(vTint.rgb, vec3(1.0), 0.16 + 0.74 * hi * hi) * 1.14;
  col = mix(col, vec3(1.0), vFlash) * (1.0 + 0.5 * vFlash);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`
const VL_LINE = /* glsl */ `
uniform sampler2D map;
uniform float uClip;
varying vec2 vSt;
varying vec4 vTint;
varying float vWy;
void main() {
  if (abs(vWy) > uClip) discard;
  vec4 t = texture2D(map, vSt);
  float a = max(t.g, t.b * 0.72) * vTint.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vec3(0.006, 0.008, 0.024), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** glyphs drawn smaller than the digits (the × after a value, and the K and M) */
const VL_SMALL: Record<string, number> = { '×': 0.7, K: 0.86, M: 0.86 }
const VL_TRACK = -0.04
const _vm = new THREE.Matrix4()

/**
 * The big value numbers: call begin(), add() each label for this frame, then end(). One label is a line of text
 * centred on a point, `size` its cap height in world units (shrunk to fit `maxW`). The two meshes (outlines, then
 * fills) draw on top of the scene in renderOrder; `clip` hides any part beyond |y| (the tubes' window).
 */
export class ValueLabels {
  readonly group = new THREE.Group()
  readonly outline: THREE.InstancedMesh
  readonly fill: THREE.InstancedMesh
  private readonly geo: THREE.PlaneGeometry
  private readonly rect: THREE.InstancedBufferAttribute
  private readonly tint: THREE.InstancedBufferAttribute
  private readonly flash: THREE.InstancedBufferAttribute
  private readonly uClip = { value: 1e4 }
  private n = 0

  constructor(private readonly cap = 192, order = 13) {
    const map = valueAtlas()
    this.geo = new THREE.PlaneGeometry(1, 1)
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage)
    this.flash = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('aRect', this.rect)
    this.geo.setAttribute('aTint', this.tint)
    this.geo.setAttribute('aFlash', this.flash)
    const common = { vertexShader: VL_VERT, transparent: true, depthTest: false, depthWrite: false }
    const lineMat = new THREE.ShaderMaterial({ ...common, fragmentShader: VL_LINE, uniforms: { map: { value: map }, uClip: this.uClip } })
    const fillMat = new THREE.ShaderMaterial({ ...common, fragmentShader: VL_FILL, uniforms: { map: { value: map }, uClip: this.uClip, uCapLo: { value: vlCapLo } } })
    this.outline = new THREE.InstancedMesh(this.geo, lineMat, cap)
    this.fill = new THREE.InstancedMesh(this.geo, fillMat, cap)
    // one set of instance matrices for both passes
    this.fill.instanceMatrix = this.outline.instanceMatrix
    this.outline.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    for (const m of [this.outline, this.fill]) {
      m.count = 0
      m.frustumCulled = false
      m.visible = false
    }
    this.outline.renderOrder = order
    this.fill.renderOrder = order + 0.5
    this.group.add(this.outline, this.fill)
  }

  /** hide whatever is further than `y` from the middle (Infinity: nothing) */
  set clip(y: number) {
    this.uClip.value = Math.min(1e4, y)
  }

  begin() {
    this.n = 0
  }

  /** the width `text` takes at cap height 1 */
  static width(text: string) {
    let w = 0
    let k = 0
    for (let i = 0; i < text.length; i++) {
      const g = vlGlyphs.get(text[i])
      if (!g) continue
      w += g.adv * (VL_SMALL[text[i]] ?? 1) + (k++ ? VL_TRACK : 0)
    }
    return w
  }

  /** a line of text centred on (x, y, z), in `color`; `alpha` fades it, `flash` (0..1) whitens it */
  add(text: string, x: number, y: number, z: number, size: number, maxW: number, color: THREE.Color, alpha = 1, flash = 0) {
    if (alpha < 0.004 || size <= 0) return
    const total = ValueLabels.width(text)
    if (total <= 0) return
    const s = Math.min(size, maxW / total)
    let pen = -total / 2
    let k = 0
    for (let j = 0; j < text.length; j++) {
      const ch = text[j]
      const g = vlGlyphs.get(ch)
      if (!g || this.n >= this.cap) continue
      if (k++) pen += VL_TRACK
      const sc = VL_SMALL[ch] ?? 1
      const i = this.n++
      const cx = x + (pen + (g.left + g.w / 2) * sc) * s
      _vm.makeScale(g.w * sc * s, vlCellH * sc * s, 1).setPosition(cx, y, z)
      this.outline.setMatrixAt(i, _vm)
      this.rect.setXYZW(i, g.u0, g.vTop, g.u1, g.vBot)
      this.tint.setXYZW(i, color.r, color.g, color.b, alpha)
      this.flash.setX(i, flash)
      pen += g.adv * sc
    }
  }

  end() {
    const n = this.n
    this.outline.count = this.fill.count = n
    this.outline.visible = this.fill.visible = n > 0
    if (n) {
      this.outline.instanceMatrix.needsUpdate = true
      this.rect.needsUpdate = true
      this.tint.needsUpdate = true
      this.flash.needsUpdate = true
    }
  }

  dispose() {
    this.geo.dispose()
    ;(this.outline.material as THREE.Material).dispose()
    ;(this.fill.material as THREE.Material).dispose()
    this.outline.dispose()
    this.fill.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Volt, the host                                                      */
/* ------------------------------------------------------------------ */

const PEARL = '#eef1f6'
const VOLT_CYAN = '#22cfe9'
const ORANGE = '#ff8a2a'

export interface HostRig {
  /** origin at Volt's waist; he is about 2.3 tall above it (antenna tips) and 2.1 wide across the shoulders */
  root: THREE.Group
  /** pivots at the waist (sway, bounce, dance) */
  torso: THREE.Group
  /** pivots at the neck (nod = rotation.x, tilt = rotation.z) */
  head: THREE.Group
  /** the face screen: setHostFace / setHostTint */
  screen: THREE.Mesh
  /** the alarm beacon on his head: spin it about y; its lamp's material (lamp.material) is his own, colour it */
  beacon: THREE.Group
  lamp: THREE.Mesh
  /** shoulder joints; each arm hangs along -y in its own frame, the rest pose turns it out a little */
  armL: THREE.Group
  armR: THREE.Group
  /** elbow joints (rotation.x < 0 swings the forearm forward) */
  foreL: THREE.Group
  foreR: THREE.Group
  /** wrist joints */
  clawL: THREE.Group
  clawR: THREE.Group
  /** the two jaws of each claw, [inner, outer]: rotation.z opens them (see openClaw) */
  jawsL: [THREE.Group, THREE.Group]
  jawsR: [THREE.Group, THREE.Group]
  /** a big horseshoe magnet held in the right claw, hidden */
  magnet: THREE.Group
  /** the glowing core in his chest (part of the body; its world position, for zaps to leave from) */
  core: THREE.Object3D
  /** the mouths of his two exhaust stacks (steam puffs, sparks), left and right */
  exhausts: THREE.Object3D[]
}

let hostFace: { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; expr: Expr } | null = null
const HOST_FACE_W = 512
const HOST_FACE_H = 336

function hostFaceTexture() {
  if (hostFace) return hostFace
  const canvas = document.createElement('canvas')
  canvas.width = HOST_FACE_W
  canvas.height = HOST_FACE_H
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.NoColorSpace
  tex.anisotropy = 4
  hostFace = { canvas, tex, expr: 'idle' }
  drawHostFace('idle')
  return hostFace
}
function drawHostFace(e: Expr) {
  const h = hostFace!
  h.expr = e
  const g = h.canvas.getContext('2d')!
  drawFace(g, e, 'box', 0, 0, HOST_FACE_W, HOST_FACE_H)
  h.tex.needsUpdate = true
}

/** a claw's jaw: a curved chrome finger with an orange rubber tip, hanging from its pivot, curling to +x */
function jaw(k: Kit, s: number) {
  const pts: P3[] = [
    [0, 0, 0],
    [s * 0.05, -0.1, 0],
    [s * 0.035, -0.2, 0],
    [s * -0.025, -0.26, 0],
  ]
  for (let i = 0; i < pts.length - 1; i++) {
    k.add(capsule(0.035 - i * 0.006, dist(pts[i], pts[i + 1]), 4, 12), i === 2 ? ORANGE : CHROME_C, aim(pts[i], pts[i + 1]), i === 2 ? RUBBER : CHROME)
    k.add(sph(0.036 - i * 0.006, 14, 10), GRAPH, T(pts[i]), SATIN)
  }
}

/** Volt: a big friendly pearl-and-cyan robot with a screen face, a power core in his chest and two claw arms */
export function buildHost(): HostRig {
  lod = STAGE_LOD
  try {
    return hostRig()
  } finally {
    lod = 1
  }
}

function hostRig(): HostRig {
  const s = stage()
  const root = new THREE.Group()
  root.name = 'volt'

  const torso = new THREE.Group()
  torso.name = 'torso'
  const t = new Kit()
  t.add(rbox(1.22, 0.86, 0.72, 0.22, 4), PEARL, T([0, 0.47, 0]))
  // the chest: a cyan plate holding the power core, a bolt across it, vents under it
  t.add(rbox(0.7, 0.5, 0.08, 0.1, 4), VOLT_CYAN, T([0, 0.5, 0.33]))
  t.add(tor(0.155, 0.032, 14, 48), CHROME_C, T([0, 0.53, 0.38]), CHROME)
  t.add(cyl(0.14, 0.14, 0.04, 40), C('#7ff6ff', 2.2), T([0, 0.53, 0.37], [Math.PI / 2, 0, 0]), lit(1, FX.pulse))
  for (let i = 0; i < 8; i++) t.add(rbox(0.018, 0.12, 0.02, 0.008), STEEL_C, T([0, 0.53, 0.395], [0, 0, (i * TAU) / 8]).multiply(T([0, 0.105, 0])), STEEL)
  const bolt = shapeOf([
    [0.03, 0.12],
    [-0.07, -0.015],
    [-0.006, -0.015],
    [-0.035, -0.12],
    [0.07, 0.02],
    [0.006, 0.02],
  ])
  t.add(extrude(bolt, 0.025, 0.008, 1, 2), C('#ffd23a', 1.2), T([0, 0.53, 0.41]), lit(0.8))
  for (const s2 of [-1, 1]) for (let i = 0; i < 3; i++) t.add(rbox(0.12, 0.024, 0.03, 0.012), GRAPH, T([s2 * 0.24, 0.38 - i * 0.05, 0.37]), SATIN)
  // a row of status LEDs above the plate
  for (let i = 0; i < 5; i++) t.add(dome(0.02, 0.6), C(['#5cf2ff', '#59ff7a', '#ffe14a', '#ff8a2a', '#ff3fd2'][i], 2.2), T([-0.16 + i * 0.08, 0.8, 0.355]), lit(1, FX.chase), i * 0.18)
  // the belt and a chrome buckle at the waist
  t.add(cyl(0.44, 0.44, 0.14, 40), GRAPH, T([0, 0.02, 0]), SATIN)
  t.add(rbox(0.22, 0.12, 0.05, 0.03), CHROME_C, T([0, 0.02, 0.43]), CHROME)
  t.add(rbox(0.14, 0.05, 0.02, 0.015), C('#5cf2ff', 2), T([0, 0.02, 0.457]), lit(1, FX.pulse))
  // neck
  t.add(cyl(0.16, 0.2, 0.08, 32), STEEL_C, T([0, 0.92, 0]), STEEL)
  t.add(cyl(0.13, 0.13, 0.08, 32), CHROME_C, T([0, 0.99, 0]), CHROME)
  t.add(tor(0.14, 0.012, 8, 32), VOLT_CYAN, T([0, 0.955, 0], [Math.PI / 2, 0, 0]))
  // screws
  for (const sx of [-1, 1]) for (const sy of [0.2, 0.78]) t.add(dome(0.02), CHROME_C, T([sx * 0.5, sy, 0.36]), CHROME)
  // panel seams down the sides of the chest
  for (const sx of [-1, 1]) t.add(box(0.012, 0.62, 0.012), '#b9c2d0', T([sx * 0.43, 0.47, 0.362]), SATIN)
  // exhaust stacks behind the shoulders
  // stacks leaning out from behind the shoulders, their mouths in the gap between ear and shoulder
  const stack = (sx: number) => T([sx * 0.5, 0.86, -0.24], [0, 0, -sx * 0.38])
  for (const sx of [-1, 1]) {
    t.add(cyl(0.06, 0.07, 0.42, 24), CHROME_C, stack(sx), CHROME)
    t.add(tor(0.064, 0.016, 8, 24), GRAPH, mul(stack(sx), T([0, 0.2, 0], [Math.PI / 2, 0, 0])), SATIN)
    t.add(cyl(0.048, 0.048, 0.02, 20), INKY, mul(stack(sx), T([0, 0.205, 0])), SATIN)
    t.add(tor(0.07, 0.012, 8, 24), VOLT_CYAN, mul(stack(sx), T([0, 0.02, 0], [Math.PI / 2, 0, 0])))
  }
  torso.add(t.mesh('body', s.body))
  const exhausts = [-1, 1].map((sx) => {
    const e = new THREE.Object3D()
    e.name = sx < 0 ? 'exhaustL' : 'exhaustR'
    e.position.setFromMatrixPosition(mul(T([sx * 0.5, 0.86, -0.24], [0, 0, -sx * 0.38]), T([0, 0.22, 0])))
    torso.add(e)
    return e
  })
  const core = new THREE.Object3D()
  core.name = 'core'
  core.position.set(0, 0.53, 0.42)
  torso.add(core)

  // the head
  const head = new THREE.Group()
  head.name = 'head'
  head.position.set(0, 1.02, 0)
  const h = new Kit()
  const HY = 0.4
  h.add(rbox(1.06, 0.76, 0.68, 0.2, 4), PEARL, T([0, HY, 0]))
  const SW = 0.82
  const SH = 0.54
  h.add(extrude(frameShape(rrOutline(SW + 0.08, SH + 0.08, 0.14), rrOutline(SW, SH, 0.11)), 0.04, 0.014), GRAPH, T([0, HY - 0.01, 0.352]), GLOSS)
  h.add(extrude(shapeOf(rrOutline(SW + 0.02, SH + 0.02, 0.12)), 0.012), INKY, T([0, HY - 0.01, 0.343]), GLOSS)
  // a cyan brow strip, ear modules with light rings, and antennae
  h.add(rbox(0.36, 0.035, 0.04, 0.017), VOLT_CYAN, T([0, HY + 0.33, 0.33]))
  for (const sx of [-1, 1]) {
    h.add(cyl(0.16, 0.16, 0.12, 40), VOLT_CYAN, T([sx * 0.56, HY, 0], [0, 0, Math.PI / 2]))
    h.add(cyl(0.11, 0.11, 0.05, 36), CHROME_C, T([sx * 0.63, HY, 0], [0, 0, Math.PI / 2]), CHROME)
    h.add(tor(0.13, 0.014, 8, 40), C('#7ff6ff', 2.2), T([sx * 0.622, HY, 0], [0, Math.PI / 2, 0]), lit(1, FX.pulse), sx > 0 ? 0.5 : 0)
    const a: P3 = [sx * 0.6, HY + 0.12, 0]
    const b: P3 = [sx * 0.72, HY + 0.52, -0.02]
    h.add(cyl(0.016, 0.02, dist(a, b), 10), CHROME_C, aim(a, b), CHROME)
    h.add(sph(0.05, 16, 12), C('#7ff6ff', 2.4), T(b), lit(1, FX.pulse), sx > 0 ? 0.3 : 0.8)
    h.add(tor(0.035, 0.009, 6, 18), CHROME_C, mul(aim(a, b), T([0, dist(a, b) / 2 - 0.04, 0], [Math.PI / 2, 0, 0])), CHROME)
  }
  // screws round the bezel
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) h.add(dome(0.018), CHROME_C, T([sx * 0.47, HY + sy * 0.3, 0.335]), CHROME)
  // the beacon's base
  h.add(cyl(0.11, 0.13, 0.05, 32), GRAPH, T([0, HY + 0.4, 0]), GLOSS)
  head.add(h.mesh('head', s.body))

  const hf = hostFaceTexture()
  const faceMat = keep(makeScreen(hf.tex))
  faceMat.userData.gain.value = 1.45
  const sk = new ScreenKit()
  sk.face(panel(rrOutline(SW, SH, 0.11), 5, bulge(SW, SH, 0.018)), 'box', FACE_TINT.rex, T([0, HY - 0.01, 0.352]))
  const screen = sk.mesh('volt', faceMat)
  // Volt's face has its own texture: its uv is the whole canvas
  const uv = screen.geometry.getAttribute('uv') as THREE.BufferAttribute
  const base = layouts.get('volt')!.faces[0].base
  for (let i = 0; i < uv.count; i++) uv.setXY(i, base[i * 2], base[i * 2 + 1])
  head.add(screen)

  const beacon = new THREE.Group()
  beacon.name = 'beacon'
  beacon.position.set(0, HY + 0.43, 0)
  const lampMat = keep(new THREE.MeshBasicMaterial({ color: C('#ff2a1f', 0.6) }))
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 12, 0, TAU, 0, Math.PI / 2).applyMatrix4(T([0, 0, 0], [0, 0, 0], [1, 1.2, 1])), lampMat)
  lamp.name = 'lamp'
  const bc = new Kit()
  bc.add(tor(0.103, 0.01, 6, 28), CHROME_C, T([0, 0.005, 0], [Math.PI / 2, 0, 0]), CHROME)
  for (let i = 0; i < 4; i++) bc.add(tor(0.106, 0.007, 6, 20, Math.PI / 2), CHROME_C, T([0, 0, 0], [0, (i * Math.PI) / 2, 0]).multiply(T([0, 0, 0], [0, 0, 0], [1, 1.2, 1])), CHROME)
  bc.add(sph(0.016, 10, 8), CHROME_C, T([0, 0.125, 0]), CHROME)
  beacon.add(lamp, bc.mesh('cage', s.body))
  beacon.userData.rest = restOf(beacon)
  head.add(beacon)
  head.userData.rest = restOf(head)
  torso.add(head)

  // the arms: shoulder, elbow and wrist joints, each segment hanging along -y in its joint's frame
  const arms = [-1, 1].map((sx) => {
    const a = new Kit()
    a.add(sph(0.17, 28, 20), GRAPH, T([0, 0, 0]), SATIN)
    a.add(new THREE.SphereGeometry(0.21, 28, 12, 0, TAU, 0, Math.PI * 0.42), VOLT_CYAN, T([0, 0.02, 0], [0, 0, -sx * 0.25]))
    a.add(tor(0.175, 0.016, 8, 36), CHROME_C, T([0, -0.05, 0], [Math.PI / 2, 0, 0]), CHROME)
    a.add(capsule(0.115, 0.3, 6, 20), PEARL, T([0, -0.27, 0]))
    a.add(tor(0.118, 0.018, 8, 32), VOLT_CYAN, T([0, -0.3, 0], [Math.PI / 2, 0, 0]))
    const arm = new THREE.Group()
    arm.name = sx < 0 ? 'armL' : 'armR'
    arm.position.set(sx * 0.7, 0.66, 0)
    arm.add(a.mesh('upper', s.body))
    const f = new Kit()
    f.add(sph(0.115, 24, 16), GRAPH, T([0, 0, 0]), SATIN)
    f.add(capsule(0.13, 0.3, 6, 20), PEARL, T([0, -0.25, 0]))
    f.add(tor(0.132, 0.022, 8, 32), VOLT_CYAN, T([0, -0.36, 0], [Math.PI / 2, 0, 0]))
    f.add(cyl(0.11, 0.1, 0.07, 28), CHROME_C, T([0, -0.47, 0]), CHROME)
    f.add(rbox(0.1, 0.05, 0.03, 0.015), C('#7ff6ff', 2), T([0, -0.2, 0.125]), lit(1, FX.pulse), sx > 0 ? 0.5 : 0)
    const fore = new THREE.Group()
    fore.name = sx < 0 ? 'foreL' : 'foreR'
    fore.position.set(0, -0.48, 0)
    fore.add(f.mesh('fore', s.body))
    const c = new Kit()
    c.add(rbox(0.24, 0.14, 0.2, 0.06, 4), GRAPH, T([0, -0.07, 0]), SATIN)
    c.add(cyl(0.035, 0.035, 0.22, 16), CHROME_C, T([0, -0.13, 0], [Math.PI / 2, 0, 0]), CHROME)
    const claw = new THREE.Group()
    claw.name = sx < 0 ? 'clawL' : 'clawR'
    claw.position.set(0, -0.52, 0)
    claw.add(c.mesh('palm', s.body))
    const jaws = [-1, 1].map((js) => {
      const j = new Kit()
      jaw(j, js)
      const g = new THREE.Group()
      g.name = js < 0 ? 'jawIn' : 'jawOut'
      g.position.set(js * 0.07, -0.13, 0)
      g.add(j.mesh('jaw', s.body))
      g.userData.rest = restOf(g)
      claw.add(g)
      return g
    }) as [THREE.Group, THREE.Group]
    // the rest pose: arms out a little, forearms forward, claws tipped down
    arm.rotation.set(0.12, 0, sx * 0.22)
    fore.rotation.set(-1.15, 0, -sx * 0.05)
    claw.rotation.set(0.35, 0, 0)
    for (const o of [arm, fore, claw]) o.userData.rest = restOf(o)
    fore.add(claw)
    arm.add(fore)
    torso.add(arm)
    return { arm, fore, claw, jaws }
  })

  // the magnet prop: grip at the origin, the horseshoe below it
  const magnet = new THREE.Group()
  magnet.name = 'magnet'
  const mk = new Kit()
  mk.add(cyl(0.04, 0.04, 0.2, 16), GRAPH, T([0, -0.05, 0]), RUBBER)
  mk.add(tor(0.22, 0.085, 16, 40, Math.PI), '#ff3b4f', T([0, -0.38, 0], [0, 0, 0]))
  for (const sx of [-1, 1]) {
    mk.add(cyl(0.085, 0.085, 0.12, 28), '#ff3b4f', T([sx * 0.22, -0.44, 0]))
    mk.add(cyl(0.088, 0.088, 0.13, 28), CHROME_C, T([sx * 0.22, -0.56, 0]), CHROME)
  }
  magnet.add(mk.mesh('magnet', s.body))
  magnet.position.set(0, -0.2, 0)
  magnet.rotation.set(0, 0, 0)
  magnet.visible = false
  magnet.userData.rest = restOf(magnet)
  arms[1].claw.add(magnet)

  torso.userData.rest = restOf(torso)
  root.add(torso)
  return {
    root,
    torso,
    head,
    screen,
    beacon,
    lamp,
    armL: arms[0].arm,
    armR: arms[1].arm,
    foreL: arms[0].fore,
    foreR: arms[1].fore,
    clawL: arms[0].claw,
    clawR: arms[1].claw,
    jawsL: arms[0].jaws,
    jawsR: arms[1].jaws,
    magnet,
    core,
    exhausts,
  }
}

/** Volt's expression (redraws his screen; cheap, call only on change) */
export function setHostFace(e: Expr) {
  if (hostFace?.expr !== e) drawHostFace(e)
}
/** the colour Volt's face glows in (cyan by default; red in an alarm) */
export function setHostTint(rig: HostRig, color: THREE.ColorRepresentation) {
  const c = C(color)
  const col = rig.screen.geometry.getAttribute('color') as THREE.BufferAttribute
  for (let i = 0; i < col.count; i++) col.setXYZ(i, c.r, c.g, c.b)
  col.needsUpdate = true
}
/** opens (1) or closes (0) one of Volt's claws */
export function openClaw(jaws: [THREE.Group, THREE.Group], t: number) {
  jaws[0].rotation.z = -0.15 - 0.5 * t
  jaws[1].rotation.z = 0.15 + 0.5 * t
}

/* ------------------------------------------------------------------ */
/*  The machine: glass tubes, frame, marquee                            */
/* ------------------------------------------------------------------ */

/** neon letters, cap height 1: strokes as polylines (corners get rounded) */
function letterStrokes(ch: string): { w: number; strokes: P2[][] } {
  const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n = 10): P2[] => Array.from({ length: n + 1 }, (_, i) => [cx + Math.cos(a0 + ((a1 - a0) * i) / n) * r, cy + Math.sin(a0 + ((a1 - a0) * i) / n) * r])
  switch (ch) {
    case 'R':
      return {
        w: 0.64,
        strokes: [
          [[0, 0], [0, 1], [0.34, 1], ...arcPts(0.34, 0.75, 0.25, Math.PI / 2, -Math.PI / 2).slice(1), [0.02, 0.5]],
          [
            [0.3, 0.5],
            [0.62, 0],
          ],
        ],
      }
    case 'O': {
      // a closed loop: the outline once round, overlapping its start a little
      const o = rrOutline(0.66, 1, 0.33, 8).map(([x, y]): P2 => [x + 0.33, y + 0.5])
      return { w: 0.66, strokes: [[...o, o[0], o[1]]] }
    }
    case 'B':
      return {
        w: 0.62,
        strokes: [
          [[0, 0.02], [0, 1], [0.3, 1], ...arcPts(0.3, 0.76, 0.24, Math.PI / 2, -Math.PI / 2).slice(1), [0.04, 0.52]],
          [[0.04, 0.52], [0.34, 0.52], ...arcPts(0.34, 0.26, 0.26, Math.PI / 2, -Math.PI / 2).slice(1), [0, 0]],
        ],
      }
    case 'I':
      return {
        w: 0.3,
        strokes: [
          [
            [0.15, 0],
            [0.15, 1],
          ],
          [
            [0, 1],
            [0.3, 1],
          ],
          [
            [0, 0],
            [0.3, 0],
          ],
        ],
      }
    case 'T':
      return {
        w: 0.64,
        strokes: [
          [
            [0, 1],
            [0.64, 1],
          ],
          [
            [0.32, 1],
            [0.32, 0],
          ],
        ],
      }
    default:
      return { w: 0.4, strokes: [] }
  }
}

/** neon tubing spelling `text` (centred on the origin), cap height `size`, in vertex colours by word */
function neonText(text: string, size: number, r: number, colors: string[]) {
  const words = text.split(' ')
  const gap = 0.2
  const space = 0.55
  const widthOf = (w: string) => [...w].reduce((a, ch) => a + letterStrokes(ch).w, 0) + gap * (w.length - 1)
  const total = words.reduce((a, w) => a + widthOf(w), 0) + space * (words.length - 1)
  const k = new Kit()
  const posts = new Kit()
  let x = -total / 2
  words.forEach((w, wi) => {
    for (const ch of w) {
      const L = letterStrokes(ch)
      for (const st of L.strokes) {
        const pts = st.map(([px, py]): P3 => [(x + px) * size, (py - 0.5) * size, 0])
        k.add(pipe(pts, r, r * 2.2, 8), C(colors[wi % colors.length], 2.3), undefined, lit(1))
        // electrodes at both ends, and standoffs holding the tube off the backing
        for (const e of [pts[0], pts[pts.length - 1]]) posts.add(cyl(r * 1.15, r * 1.15, r * 2.4, 10), GRAPH, T([e[0], e[1], -r * 0.6], [Math.PI / 2, 0, 0]), SATIN)
        const mid = pts[Math.floor(pts.length / 2)]
        posts.add(cyl(r * 0.45, r * 0.45, r * 5, 8), CHROME_C, T([mid[0], mid[1], -r * 2.5], [Math.PI / 2, 0, 0]), CHROME)
      }
      x += L.w + gap
    }
    x += space - gap
  })
  return { tubes: k, posts }
}

export interface TubeRig {
  root: THREE.Group
  /** the glass (open at the front) */
  glass: THREE.Mesh
  /** the neon rings at the top and bottom; the material is this tube's own: set its color (HDR) to light it */
  neon: THREE.Mesh
}

export interface MachineRig {
  root: THREE.Group
  /** left to right; tube c is centred on x = (c - (cols - 1) / 2) * cell, y = 0 */
  tubes: TubeRig[]
  /** the sign above the frame */
  marquee: THREE.Group
  /** ROBO RIOT in neon: its material is the machine's own; scale material.color to flicker it (vertex colours carry the hues) */
  letters: THREE.Mesh
  /** gauge needles (rotation.z: 0 points straight up, about ±2.2 at the ends of the dial) */
  needles: THREE.Group[]
  /** steam vent mouths, +z pointing out of the vent */
  vents: THREE.Object3D[]
  /** the arcade buttons under the tubes: one instanced mesh, instanceColor per tube */
  buttons: THREE.InstancedMesh
  /** overall extent: half width, top (marquee) and bottom (base) */
  size: { halfW: number; top: number; bottom: number; boardTop: number; boardBottom: number }
}

/**
 * The arcade machine around a cols × rows board of `cell` units centred on the origin: five glass tubes with chrome
 * caps, painted steel pillars with rivets, pipes and steam vents, a header with hazard trim and two gauges, a base
 * with arcade buttons, and the marquee with ROBO RIOT in neon and chasing bulbs. Built in the stage materials
 * (unclipped). About 12 draw calls.
 */
export function buildMachine(o: { cols?: number; rows?: number; cell?: number } = {}): MachineRig {
  lod = STAGE_LOD
  try {
    return machineRig(o)
  } finally {
    lod = 1
  }
}

function machineRig(o: { cols?: number; rows?: number; cell?: number }): MachineRig {
  const cols = o.cols ?? 5
  const rows = o.rows ?? 5
  const cell = o.cell ?? 1
  const s = stage()
  const W = cols * cell
  const H = rows * cell
  const root = new THREE.Group()
  root.name = 'machine'
  const f = new Kit()
  const NAVY = '#1c2640'
  const NAVY2 = '#243152'
  const TR = cell * 0.47
  const TH = H + 0.24 * cell
  const OPEN = 0.95

  // tubes: back panels, chrome caps and edge rails go in the frame; glass and neon are their own meshes
  const tubes: TubeRig[] = []
  const glassGeo = new THREE.CylinderGeometry(TR, TR, TH, 48, 1, true, OPEN, TAU - 2 * OPEN)
  for (let c = 0; c < cols; c++) {
    const x = (c - (cols - 1) / 2) * cell
    f.add(new THREE.CylinderGeometry(TR * 0.985, TR * 0.985, TH, 40, 1, true, Math.PI / 2, Math.PI), '#121828', T([x, 0, 0]), SATIN)
    for (const sy of [-1, 1]) {
      const y = sy * (TH / 2)
      f.add(lathe([[TR * 0.9, -0.06], [TR + 0.05, -0.06], [TR + 0.07, -0.03], [TR + 0.07, 0.04], [TR + 0.04, 0.08], [TR * 0.9, 0.08]], 48), CHROME_C, T([x, y + sy * 0.03, 0], [0, 0, 0], [1, sy, 1]), CHROME)
    }
    for (const a of [OPEN, -OPEN]) f.add(cyl(0.022, 0.022, TH, 10), CHROME_C, T([x + Math.sin(a) * TR, 0, Math.cos(a) * TR]), CHROME)
    const tube = new THREE.Group()
    tube.name = `tube${c}`
    tube.position.x = x
    const glass = new THREE.Mesh(glassGeo, s.glass)
    glass.name = 'glass'
    const nk = new Kit()
    for (const sy of [-1, 1]) nk.add(tor(TR + 0.035, 0.016, 8, 48), '#ffffff', T([0, sy * (TH / 2 - 0.05), 0], [Math.PI / 2, 0, 0]), lit(1))
    const neon = new THREE.Mesh(nk.geometry(), keep(new THREE.MeshBasicMaterial({ color: C('#5cf2ff', 1.6), vertexColors: true })))
    neon.name = 'neon'
    tube.add(glass, neon)
    root.add(tube)
    tubes.push({ root: tube, glass, neon })
  }

  // pillars: slim, so the tubes get the width
  const PW = 0.44 * cell
  const PX = W / 2 + 0.05 * cell + PW / 2
  const PH = H + 0.8 * cell
  for (const sx of [-1, 1]) {
    const x = sx * PX
    f.add(rbox(PW, PH, 0.9, 0.07, 3), NAVY, T([x, 0, -0.1]), PAINT)
    f.add(rbox(PW - 0.1, PH - 0.5, 0.04, 0.035, 2), NAVY2, T([x, 0.05, 0.36]), PAINT)
    // rivets down both edges of the inset
    for (let y = -PH / 2 + 0.4; y < PH / 2 - 0.2; y += 0.32) for (const dx of [-1, 1]) f.add(dome(0.019), CHROME_C, T([x + dx * (PW / 2 - 0.036), y, 0.352]), CHROME)
    // a neon strip on the inner edge
    f.add(rbox(0.026, PH - 0.6, 0.03, 0.011), C('#5cf2ff', 1.8), T([x - sx * (PW / 2 - 0.016), 0.05, 0.37]), lit(1))
    // hazard panel low on the pillar
    const hz = T([x, -PH / 2 + 0.72, 0.39])
    f.add(rbox(PW - 0.14, 0.46, 0.025, 0.03, 2), HAZARD, hz, GLOSS)
    hazard(f, PW - 0.16, 0.44, mul(hz, T([0, 0, 0.014])), 0.12, 0.008)
    // a steam vent: a grille with slats
    const vy = 0.75 * cell
    f.add(rbox(PW - 0.14, 0.4, 0.06, 0.035, 2), GRAPH, T([x, vy, 0.38]), SATIN)
    for (let i = 0; i < 5; i++) f.add(rbox(PW - 0.21, 0.032, 0.04, 0.014), INKY, T([x, vy - 0.136 + i * 0.068, 0.4]), SATIN)
    for (const dy of [-1, 1]) for (const dx of [-1, 1]) f.add(dome(0.014), CHROME_C, T([x + dx * (PW / 2 - 0.1), vy + dy * 0.17, 0.415]), CHROME)
  }
  const vents = [-1, 1].map((sx, i) => {
    const v = new THREE.Object3D()
    v.name = `vent${i}`
    v.position.set(sx * PX, 0.75 * cell, 0.45)
    root.add(v)
    return v
  })

  // pipes: copper up the left pillar, chrome up the right, both into the header
  const top = H / 2 + 0.3 * cell
  // hugging the pillars' sides, so they add little to the width
  const PO = PX + PW / 2 + 0.022
  f.add(pipe([[-PO, -H / 2 - 0.3, 0.1], [-PO, top - 0.05, 0.1], [-PO + 0.24, top + 0.12, 0.1]], 0.046, 0.16, 12), COPPER_C, undefined, COPPER)
  f.add(pipe([[PO, -H / 2 - 0.3, 0.05], [PO, top - 0.05, 0.05], [PO - 0.24, top + 0.12, 0.05]], 0.042, 0.16, 12), CHROME_C, undefined, CHROME)
  for (const [x, y, c2] of [
    [-PO, -0.8, COPPER_C],
    [-PO, 1.6, COPPER_C],
    [PO, -0.3, CHROME_C],
    [PO, 2.0, CHROME_C],
  ] as [number, number, string][])
    f.add(cyl(0.064, 0.064, 0.06, 16), c2, T([x, y, x < 0 ? 0.1 : 0.05]), c2 === COPPER_C ? COPPER : CHROME)
  // a red valve wheel on the copper pipe
  const vw = T([-PO, 0.4, 0.2], [0, 0, 0])
  f.add(cyl(0.025, 0.025, 0.12, 10), STEEL_C, mul(vw, T([0, 0, -0.05], [Math.PI / 2, 0, 0])), STEEL)
  f.add(tor(0.09, 0.017, 8, 28), '#e8323c', vw)
  for (let i = 0; i < 3; i++) f.add(cyl(0.01, 0.01, 0.18, 6), '#e8323c', mul(vw, T([0, 0, 0], [0, 0, (i * Math.PI) / 3])))

  // header and base: slim bars, so the board gets the height
  const HW = W + 2 * PW + 0.22
  const HH = 0.32 * cell
  f.add(rbox(HW, HH, 0.95, 0.07, 3), NAVY, T([0, top, -0.08]), PAINT)
  const trim = T([0, top - 0.055 * cell, 0.405])
  f.add(rbox(HW - 0.1, 0.1, 0.03, 0.02, 2), HAZARD, trim, GLOSS)
  hazard(f, HW - 0.12, 0.09, mul(trim, T([0, 0, 0.016])), 0.12, 0.008)
  for (let x = -HW / 2 + 0.3; x < HW / 2 - 0.2; x += 0.4) f.add(dome(0.018), CHROME_C, T([x, top + 0.1, 0.39]), CHROME)
  const BH = 0.44 * cell
  const bottom = -H / 2 - 0.08 * cell - BH / 2
  f.add(rbox(HW, BH, 1.0, 0.07, 3), NAVY, T([0, bottom, -0.05]), PAINT)
  f.add(rbox(HW - 0.3, 0.24, 0.05, 0.05, 2), NAVY2, T([0, bottom + 0.03, 0.46]), PAINT)
  const btrim = T([0, bottom - 0.165 * cell, 0.455])
  f.add(rbox(HW - 0.1, 0.075, 0.03, 0.02, 2), HAZARD, btrim, GLOSS)
  hazard(f, HW - 0.12, 0.065, mul(btrim, T([0, 0, 0.016])), 0.11, 0.008)
  for (let c = 0; c < cols; c++) f.add(cyl(0.125, 0.135, 0.06, 32), CHROME_C, T([(c - (cols - 1) / 2) * cell, bottom + 0.04, 0.49], [Math.PI / 2, 0, 0]), CHROME)
  const bk = new Kit()
  bk.add(sph(0.1, 24, 12, ).applyMatrix4(T([0, 0, 0], [Math.PI / 2, 0, 0], [1, 0.55, 1])), '#ffffff', undefined, lit(1.6, FX.pulse))
  const buttons = new THREE.InstancedMesh(bk.geometry(), s.frame, cols)
  buttons.name = 'buttons'
  for (let c = 0; c < cols; c++) {
    buttons.setMatrixAt(c, T([(c - (cols - 1) / 2) * cell, bottom + 0.04, 0.52], [Math.PI / 2, 0, 0]))
    buttons.setColorAt(c, C(['#ff3b4f', '#ffd21f', '#3fe46a', '#3ea2ff', '#ff3fd2'][c % 5]))
  }
  root.add(buttons)

  // gauges on the header ends, over the pillars
  const needles: THREE.Group[] = []
  for (const sx of [-1, 1]) {
    const gx = sx * PX
    const gy = top + 0.02
    const gz = 0.43
    const G = 0.86
    const gm = (m: THREE.Matrix4) => mul(T([gx, gy, gz], [0, 0, 0], G), T([-gx, -gy, -gz]), m)
    f.add(cyl(0.26, 0.27, 0.08, 40), CHROME_C, gm(T([gx, gy, gz - 0.02], [Math.PI / 2, 0, 0])), CHROME)
    f.add(tor(0.245, 0.022, 10, 40), CHROME_C, gm(T([gx, gy, gz + 0.02])), CHROME)
    f.add(cyl(0.23, 0.23, 0.02, 40), '#f3efe4', gm(T([gx, gy, gz + 0.012], [Math.PI / 2, 0, 0])), SATIN)
    for (let i = 0; i <= 10; i++) {
      const a = -2.2 + (i / 10) * 4.4
      const zone = i < 6 ? '#2fbf5a' : i < 8 ? '#ffb21f' : '#ff3b3b'
      f.add(rbox(0.016, i % 5 ? 0.04 : 0.06, 0.01, 0.004), i % 5 ? GRAPH : zone, gm(mul(T([gx, gy, gz + 0.025], [0, 0, -a]), T([0, 0.17, 0]))), SATIN)
      if (i < 10) f.add(new THREE.RingGeometry(0.19, 0.21, 4, 1, Math.PI / 2 - a - 0.44, 0.44), zone, gm(T([gx, gy, gz + 0.023])), SATIN)
    }
    f.add(cyl(0.03, 0.03, 0.03, 16), CHROME_C, gm(T([gx, gy, gz + 0.04], [Math.PI / 2, 0, 0])), CHROME)
    const nk = new Kit()
    nk.add(rbox(0.016, 0.2 * G, 0.01, 0.006), '#e8282f', T([0, 0.07 * G, 0]), GLOSS)
    nk.add(cyl(0.022, 0.022, 0.012, 14), '#e8282f', T([0, 0, 0], [Math.PI / 2, 0, 0]), GLOSS)
    const n = new THREE.Group()
    n.name = `needle${needles.length}`
    n.position.set(gx, gy, gz + 0.032)
    n.add(nk.mesh('needle', s.frame))
    n.rotation.z = sx * 0.9
    n.userData.rest = restOf(n)
    root.add(n)
    needles.push(n)
  }

  root.add(f.mesh('frame', s.frame))

  // the marquee: an arched sign with chasing bulbs and the name in neon
  const marquee = new THREE.Group()
  marquee.name = 'marquee'
  const MW = W + 0.9
  const MH = 0.88 * cell
  // sitting right on the header, so the board gets the height
  const my = top + HH / 2 - 0.02 + MH / 2
  marquee.position.set(0, my, 0.05)
  const arch: P2[] = []
  const N = 28
  for (let i = 0; i <= N; i++) {
    const t2 = i / N
    const x = MW / 2 - t2 * MW
    arch.push([x, MH / 2 - 0.2 + 0.2 * Math.sqrt(Math.max(0, 1 - (2 * x / MW) ** 2))])
  }
  const outline: P2[] = [...arch, [-MW / 2, -MH / 2 + 0.12], [-MW / 2 + 0.12, -MH / 2], [MW / 2 - 0.12, -MH / 2], [MW / 2, -MH / 2 + 0.12]]
  const mk = new Kit()
  mk.add(extrude(shapeOf(outline), 0.3, 0.04, 8, 3), '#121a2e', undefined, PAINT)
  const inset = outline.map(([x, y]): P2 => [x * 0.955, y * 0.9 - 0.01])
  mk.add(extrude(frameShape(outline.map(([x, y]): P2 => [x * 0.985, y * 0.97]), inset), 0.05, 0.012, 8, 2), CHROME_C, T([0, 0, 0.17]), CHROME)
  // bulbs round the edge
  const edge = outline.map(([x, y]): P2 => [x * 0.968, y * 0.935])
  const perim: P2[] = []
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i]
    const b = edge[(i + 1) % edge.length]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    const n = Math.max(1, Math.round(len / 0.2))
    for (let j = 0; j < n; j++) perim.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
  }
  const spaced: P2[] = []
  let acc = 1
  for (let i = 0; i < perim.length; i++) {
    const p = perim[i]
    const prev = spaced[spaced.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= 0.19) spaced.push(p)
    acc++
  }
  void acc
  spaced.forEach(([x, y]) => {
    mk.add(cyl(0.03, 0.035, 0.03, 10), STEEL_C, T([x, y, 0.19], [Math.PI / 2, 0, 0]), STEEL)
    mk.add(sph(0.04, 12, 8), C('#ffd88a', 2.2), T([x, y, 0.215]), lit(1, FX.chase))
  })
  // the name
  const nt = neonText('ROBO RIOT', 0.47 * cell, 0.03 * cell, ['#5cf2ff', '#ff3fd2'])
  for (const g of [nt.posts]) {
    const geo = g.geometry()
    geo.translate(0, -0.02, 0.2)
    const pm = new THREE.Mesh(geo, s.frame)
    marquee.add(pm)
  }
  const lg = nt.tubes.geometry()
  lg.translate(0, -0.02, 0.24)
  const letters = new THREE.Mesh(lg, keep(new THREE.MeshBasicMaterial({ vertexColors: true, color: '#ffffff' })))
  letters.name = 'letters'
  marquee.add(mk.mesh('sign', s.frame), letters)
  // little rivets along the bottom
  root.add(marquee)

  return {
    root,
    tubes,
    marquee,
    letters,
    needles,
    vents,
    buttons,
    size: { halfW: PO + 0.06, top: my + MH / 2, bottom: bottom - BH / 2, boardTop: H / 2, boardBottom: -H / 2 },
  }
}

/* ------------------------------------------------------------------ */
/*  The lever                                                           */
/* ------------------------------------------------------------------ */

export interface LeverRig {
  /** origin at the pivot; mount it on the side of the machine */
  root: THREE.Group
  /** the arm: rotation.z tips it (negative = down and out to the right); about -1.1 is fully pulled */
  arm: THREE.Group
}

/** a big arcade lever: a chrome housing on a plate, a chrome arm and a red ball knob */
export function buildLever(): LeverRig {
  lod = STAGE_LOD
  try {
    return leverRig()
  } finally {
    lod = 1
  }
}

function leverRig(): LeverRig {
  const s = stage()
  const root = new THREE.Group()
  root.name = 'lever'
  const b = new Kit()
  b.add(rbox(0.3, 0.5, 0.1, 0.04, 3), '#1c2640', T([0, -0.05, -0.12]), PAINT)
  b.add(cyl(0.13, 0.15, 0.18, 32), CHROME_C, T([0, 0, -0.02], [Math.PI / 2, 0, 0]), CHROME)
  b.add(tor(0.13, 0.016, 8, 32), GRAPH, T([0, 0, 0.07]), GLOSS)
  for (const dy of [-0.24, 0.14]) b.add(dome(0.02), CHROME_C, T([0, dy, -0.065]), CHROME)
  root.add(b.mesh('housing', s.body))
  const a = new Kit()
  a.add(cyl(0.07, 0.07, 0.08, 24), GRAPH, T([0, 0, 0.1], [Math.PI / 2, 0, 0]), SATIN)
  a.add(cyl(0.032, 0.036, 0.9, 16), CHROME_C, T([0, 0.45, 0.12]), CHROME)
  a.add(tor(0.04, 0.012, 6, 16), GRAPH, T([0, 0.18, 0.12], [Math.PI / 2, 0, 0]), RUBBER)
  a.add(sph(0.13, 32, 24), '#ff3141', T([0, 0.95, 0.12]))
  a.add(tor(0.05, 0.014, 8, 20), CHROME_C, T([0, 0.835, 0.12], [Math.PI / 2, 0, 0]), CHROME)
  const arm = new THREE.Group()
  arm.name = 'arm'
  arm.add(a.mesh('arm', s.body))
  arm.userData.rest = restOf(arm)
  root.add(arm)
  return { root, arm }
}

/* ------------------------------------------------------------------ */
/*  Charging sockets for the Power Grid                                 */
/* ------------------------------------------------------------------ */

let socketMat: THREE.Material | null = null
let socketGlowTex: THREE.CanvasTexture | null = null

/** a soft rounded square of light, brightest a little in from its edge: the backlight of a lit socket */
function glowSquare() {
  if (socketGlowTex) return socketGlowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.55, 'rgba(255,255,255,0.42)')
  grad.addColorStop(0.82, 'rgba(255,255,255,0.16)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  roundRectPath(g, 2, 2, 124, 124, 30)
  g.fill()
  socketGlowTex = new THREE.CanvasTexture(c)
  return socketGlowTex
}

/**
 * The 25 charging sockets of the Power Grid, in four instanced draws. Housings: a dark gunmetal frame with a slim
 * steel lip round a deep black well (setTint dims an empty one right down). Rims: a light pipe round the well
 * (setColor). Glows: a backlight in the well behind the cell (setGlow, off when empty). Latches: four clamps that
 * hide in the frame while open and bite in when clamped (setLatch 0..1). Positions are socket centres; each socket
 * is `size` across.
 */
export class SocketField {
  readonly root = new THREE.Group()
  readonly housings: THREE.InstancedMesh
  readonly rims: THREE.InstancedMesh
  readonly glows: THREE.InstancedMesh
  readonly latches: THREE.InstancedMesh
  private readonly at: THREE.Vector3[]
  private readonly shown: boolean[]
  private readonly latch: number[]
  private readonly scale: number
  private readonly tmp = new THREE.Color()

  constructor(positions: THREE.Vector3[], size = 1) {
    lod = 1.4
    // their own material, so the alarm (setAlert) leaves the rim colours to setColor
    const mat = (socketMat ??= keep(withEnv({ m: makeBody(false) }).m))
    this.at = positions.map((p) => p.clone())
    this.scale = size
    this.shown = positions.map(() => true)
    this.latch = positions.map(() => 0)
    const n = positions.length
    const h = new Kit()
    const O = 0.96
    const I = 0.8
    h.add(extrude(frameShape(rrOutline(O, O, 0.17, 6), rrOutline(I, I, 0.11, 6)), 0.1, 0.016, 8, 2), '#262d3c', T([0, 0, 0]), fin(0.4, 0.55, 0.35))
    h.add(extrude(frameShape(rrOutline(I + 0.016, I + 0.016, 0.118, 6), rrOutline(I - 0.02, I - 0.02, 0.1, 6)), 0.024, 0.005, 6, 2), '#7c879c', T([0, 0, 0.042]), STEEL)
    h.add(rbox(I, I, 0.04, 0.1, 2), '#05070b', T([0, 0, -0.06]), SATIN)
    // a faint charging pad at the back of the well
    h.add(tor(0.25, 0.006, 6, 40), '#1d2331', T([0, 0, -0.038]), STEEL)
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) h.add(dome(0.016), '#8a93a6', T([sx * 0.4, sy * 0.4, 0.066]), STEEL)
    this.housings = new THREE.InstancedMesh(h.geometry(), mat, n)
    this.housings.name = 'housings'
    const r = new Kit()
    r.add(pipe([...rrOutline(I - 0.05, I - 0.05, 0.09, 5).map(([x, y]): P3 => [x, y, 0])], 0.011, 0, 6, true), '#ffffff', T([0, 0, 0.03]), lit(1))
    this.rims = new THREE.InstancedMesh(r.geometry(), mat, n)
    this.rims.name = 'rims'
    const glowMat = keep(new THREE.MeshBasicMaterial({ map: glowSquare(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    this.glows = new THREE.InstancedMesh(new THREE.PlaneGeometry(I - 0.02, I - 0.02), glowMat, n)
    this.glows.name = 'glows'
    const l = new Kit()
    for (let i = 0; i < 4; i++) {
      const m = T([0, 0, 0], [0, 0, (i * Math.PI) / 2])
      l.add(rbox(0.2, 0.075, 0.05, 0.02, 2), CHROME_C, mul(m, T([0, I / 2 + 0.005, 0.075])), CHROME)
      l.add(rbox(0.14, 0.035, 0.052, 0.012, 2), HAZARD, mul(m, T([0, I / 2 - 0.04, 0.076])), GLOSS)
    }
    this.latches = new THREE.InstancedMesh(l.geometry(), mat, n)
    this.latches.name = 'latches'
    for (let i = 0; i < n; i++) {
      this.housings.setMatrixAt(i, this.matrix(i, 1))
      this.housings.setColorAt(i, this.tmp.setScalar(1))
      this.rims.setColorAt(i, C('#5cf2ff', 1.4))
      this.glows.setColorAt(i, this.tmp.setScalar(0))
      this.place(i)
    }
    this.root.add(this.housings, this.glows, this.rims, this.latches)
    lod = 1
  }

  private matrix(i: number, s: number, dz = 0) {
    const p = this.at[i]
    return T([p.x, p.y, p.z + dz], [0, 0, 0], this.shown[i] ? s * this.scale : 0)
  }

  private place(i: number) {
    this.rims.setMatrixAt(i, this.matrix(i, 1))
    this.glows.setMatrixAt(i, this.matrix(i, 1, -0.034))
    const t = this.latch[i]
    // open latches sink back into the frame out of sight; clamped ones come out over the cell and bite
    this.latches.setMatrixAt(i, this.matrix(i, 1 + 0.12 * (1 - t), -0.09 * (1 - t)))
    this.rims.instanceMatrix.needsUpdate = true
    this.glows.instanceMatrix.needsUpdate = true
    this.latches.instanceMatrix.needsUpdate = true
  }

  /** the rim light's colour (HDR: intensity multiplies it) */
  setColor(i: number, color: THREE.ColorRepresentation, intensity = 1.4) {
    this.rims.setColorAt(i, this.tmp.set(color).multiplyScalar(intensity))
    this.rims.instanceColor!.needsUpdate = true
  }
  /** the backlight in the well behind the cell (0: off) */
  setGlow(i: number, color: THREE.ColorRepresentation, intensity: number) {
    this.glows.setColorAt(i, this.tmp.set(color).multiplyScalar(intensity))
    this.glows.instanceColor!.needsUpdate = true
  }
  /** how bright the housing is: about 0.5 for an empty socket, 1 for a full one */
  setTint(i: number, k: number) {
    this.housings.setColorAt(i, this.tmp.setScalar(k))
    this.housings.instanceColor!.needsUpdate = true
  }
  /** 0 open, 1 clamped */
  setLatch(i: number, t: number) {
    this.latch[i] = Math.min(1, Math.max(0, t))
    this.place(i)
  }
  setVisible(i: number, on: boolean) {
    this.shown[i] = on
    this.housings.setMatrixAt(i, this.matrix(i, 1))
    this.housings.instanceMatrix.needsUpdate = true
    this.place(i)
  }
  dispose() {
    for (const m of [this.housings, this.rims, this.glows, this.latches]) {
      m.geometry.dispose()
      m.dispose()
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Confetti of bolts and gears, and coins                              */
/* ------------------------------------------------------------------ */

let bitMat: THREE.MeshStandardMaterial | null = null
/** shiny metal for the bits below, tinted per instance (instanceColor) or per mesh (color) */
export function bitMaterial() {
  if (bitMat) return bitMat
  bitMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.85, roughness: 0.28 })
  bitMat.envMapIntensity = 1.2
  if (envTex) bitMat.envMap = envTex
  extraMats.add(bitMat)
  return bitMat
}

/**
 * Small solids for confetti and showers, each about 0.1 across, white (tint them with instanceColor, e.g. through
 * the Bits class in lib/three/fx with bitMaterial()): a gear, a hex bolt, a nut and a coin stamped with a bolt.
 */
export function bitGeometries() {
  lod = 1
  const one = (f: (k: Kit) => void) => {
    const k = new Kit()
    f(k)
    const g = k.geometry()
    for (const a of ['color', 'aSurf', 'aFx']) g.deleteAttribute(a)
    return g
  }
  const gear = one((k) => k.add(extrude(frameShape(gearOutline(8, 0.04, 0.052), circle(0.016, 12)), 0.016, 0.004, 4, 1), '#fff', undefined, GLOSS))
  const bolt = one((k) => {
    k.add(cyl(0.028, 0.028, 0.018, 6), '#fff', T([0, 0.035, 0]))
    k.add(cyl(0.012, 0.012, 0.07, 10), '#fff')
    for (let i = 0; i < 4; i++) k.add(tor(0.013, 0.003, 4, 10), '#fff', T([0, -0.02 + i * 0.012, 0], [Math.PI / 2, 0, 0]))
  })
  const nut = one((k) => k.add(extrude(frameShape(circle(0.034, 6), circle(0.015, 12)), 0.02, 0.004, 4, 1), '#fff', undefined, GLOSS))
  const coin = one((k) => {
    k.add(cyl(0.05, 0.05, 0.012, 28), '#fff', T([0, 0, 0], [Math.PI / 2, 0, 0]))
    for (const sz of [-1, 1]) {
      k.add(tor(0.044, 0.004, 4, 28), '#fff', T([0, 0, sz * 0.006]))
      const b = shapeOf([
        [0.006, 0.026],
        [-0.016, -0.004],
        [-0.002, -0.004],
        [-0.008, -0.026],
        [0.016, 0.004],
        [0.002, 0.004],
      ])
      k.add(extrude(b, 0.004, 0, 1), '#fff', T([0, 0, sz * 0.007], [0, sz < 0 ? Math.PI : 0, 0]))
    }
  })
  return { gear, bolt, nut, coin }
}

/* ------------------------------------------------------------------ */
/*  Contact shadows and electric arcs                                   */
/* ------------------------------------------------------------------ */

let shadowTex: THREE.CanvasTexture | null = null
let shadowMat: THREE.MeshBasicMaterial | null = null
/** a soft dark ellipse, 1 × 1, for a contact shadow under or behind a piece (instance it for a whole board) */
export function shadowMaterial() {
  if (shadowMat) return shadowMat
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(0,0,0,0.85)')
  grad.addColorStop(0.5, 'rgba(0,0,0,0.45)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  shadowTex = new THREE.CanvasTexture(c)
  shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, color: '#05030c' })
  return shadowMat
}

interface Arc {
  a: THREE.Vector3
  b: THREE.Vector3
  color: THREE.Color
  life: number
  max: number
  width: number
  jag: number
  bow: number
  seed: number
  next: number
  pts: THREE.Vector3[]
}

const ARC_VERT = /* glsl */ `
attribute vec3 tint;
attribute float alpha;
varying vec3 vTint;
varying float vAlpha;
varying float vAcross;
void main() {
  vTint = tint;
  vAlpha = alpha;
  vAcross = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const ARC_FRAG = /* glsl */ `
varying vec3 vTint;
varying float vAlpha;
varying float vAcross;
void main() {
  // clamped: pow() of a negative number is NaN, and one NaN pixel blooms the whole frame black
  float d = clamp(abs(vAcross * 2.0 - 1.0), 0.0, 1.0);
  float core = 1.0 - smoothstep(0.0, 0.32, d);
  float glow = pow(1.0 - d, 2.2);
  gl_FragColor = vec4((vTint * glow * 1.3 + vec3(core) * 1.6) * vAlpha, 1.0);
}`

/**
 * Electric arcs and lightning: jagged ribbons from a to b that re-strike every few frames, a white-hot core in a
 * coloured glow, all in one additive draw. `bow` sags the arc sideways (magnet field lines), `jag` is how wild it
 * is. Ribbons face +z (the scene looks along -z). Call update(dt) every frame.
 */
export class Arcs {
  readonly mesh: THREE.Mesh
  private readonly list: Arc[] = []
  private readonly geo = new THREE.BufferGeometry()
  private readonly mat: THREE.ShaderMaterial
  private readonly pos: Float32Array
  private readonly tint: Float32Array
  private readonly alpha: Float32Array

  constructor(
    private readonly cap = 24,
    private readonly segs = 18,
  ) {
    const verts = cap * (segs + 1) * 2
    this.pos = new Float32Array(verts * 3)
    this.tint = new Float32Array(verts * 3)
    this.alpha = new Float32Array(verts)
    const uv = new Float32Array(verts * 2)
    const idx: number[] = []
    for (let a = 0; a < cap; a++)
      for (let i = 0; i <= segs; i++) {
        const v = (a * (segs + 1) + i) * 2
        uv.set([i / segs, 0, i / segs, 1], v * 2)
        if (i < segs) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3)
      }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    this.geo.setIndex(idx)
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({ vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 11
  }

  emit(a: THREE.Vector3, b: THREE.Vector3, color: THREE.ColorRepresentation, o: { life?: number; width?: number; jag?: number; bow?: number } = {}) {
    if (this.list.length >= this.cap) this.list.shift()
    const life = o.life ?? 0.35
    this.list.push({ a: a.clone(), b: b.clone(), color: C(color), life, max: life, width: o.width ?? 0.09, jag: o.jag ?? 0.22, bow: o.bow ?? 0, seed: Math.random() * 100, next: 0, pts: [] })
  }

  /** arcs still alive */
  get count() {
    return this.list.length
  }

  update(dt: number) {
    const L = this.list
    let n = 0
    const side = V()
    const dir = V()
    const p = V()
    for (let k = 0; k < L.length; k++) {
      const arc = L[k]
      arc.life -= dt
      if (arc.life <= 0) continue
      L[n++] = arc
      arc.next -= dt
      dir.subVectors(arc.b, arc.a)
      const len = dir.length()
      dir.normalize()
      side.set(-dir.y, dir.x, 0).normalize()
      if (arc.next <= 0 || !arc.pts.length) {
        // strike again: a fresh jagged path
        arc.next = 0.045
        arc.pts = []
        for (let i = 0; i <= this.segs; i++) {
          const t = i / this.segs
          const env = Math.sin(t * Math.PI)
          // big zigs that alternate sides, plus fine crackle
          const zig = (i % 2 ? 1 : -1) * (0.4 + 0.6 * Math.random())
          const off = (zig * 0.6 + (Math.random() * 2 - 1) * 0.4) * arc.jag * len * 0.3 * env + arc.bow * len * env
          arc.pts.push(arc.a.clone().lerp(arc.b, t).addScaledVector(side, off).add(V(0, 0, (Math.random() - 0.5) * 0.05 * env)))
        }
      }
      const f = arc.life / arc.max
      const a = Math.min(1, f * 3) * (0.75 + 0.25 * Math.random())
      const base = (n - 1) * (this.segs + 1) * 2
      for (let i = 0; i <= this.segs; i++) {
        const q = arc.pts[i]
        const nx = arc.pts[Math.min(this.segs, i + 1)]
        const pv = arc.pts[Math.max(0, i - 1)]
        p.subVectors(nx, pv)
        const sx = -p.y
        const sy = p.x
        const sl = Math.hypot(sx, sy) || 1
        const w = (arc.width / 2) * (0.6 + 0.4 * Math.sin((i / this.segs) * Math.PI))
        const v = base + i * 2
        this.pos.set([q.x - (sx / sl) * w, q.y - (sy / sl) * w, q.z, q.x + (sx / sl) * w, q.y + (sy / sl) * w, q.z], v * 3)
        this.tint.set([arc.color.r, arc.color.g, arc.color.b, arc.color.r, arc.color.g, arc.color.b], v * 3)
        this.alpha[v] = this.alpha[v + 1] = a
      }
    }
    L.length = n
    this.geo.setDrawRange(0, n * this.segs * 6)
    for (const name of ['position', 'tint', 'alpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Disposal                                                            */
/* ------------------------------------------------------------------ */

/**
 * Frees everything this module made: prototypes, live pieces' screens, materials, the atlas, Volt's face, the
 * environment map. Meshes from buildHost / buildMachine / buildLever share materials that this frees but own their
 * geometry: the scene disposes those geometries (or traverses and disposes them) itself; SocketField and Arcs
 * have their own dispose().
 */
export function disposeModels() {
  for (const p of protos.values())
    p.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
  protos.clear()
  for (const g of owned) g.dispose()
  owned.clear()
  live.clear()
  layouts.clear()
  for (const m of [...(gridMats ? Object.values(gridMats) : []), ...(stageMats ? Object.values(stageMats) : []), ...extraMats]) m.dispose()
  gridMats = null
  stageMats = null
  extraMats.clear()
  atlasTex?.dispose()
  atlasTex = null
  vlTex?.dispose()
  vlTex = null
  socketGlowTex?.dispose()
  socketGlowTex = null
  hostFace?.tex.dispose()
  hostFace = null
  bitMat = null
  socketMat = null
  shadowTex?.dispose()
  shadowMat?.dispose()
  shadowTex = null
  shadowMat = null
  envTex?.dispose()
  envTex = null
  envRenderer = null
}

/** disposes the geometry of every mesh under `o` (for the host, machine and lever rigs) */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh) x.geometry.dispose()
  })
}
