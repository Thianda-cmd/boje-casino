import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { PacedQuality, Sparks, easeInOut, glowTexture, ringTexture, rnd } from '../../lib/three/fx'
import { isMuted, sfx } from '../../lib/sound'
import { HALF, RADIUS, RATE, flatten, makeFlight, qmul, readableAt, restQuat, showTurn, yaw, type Flight, type Q } from './physics'
import { SMALL_HALF, chipStack, coinBodyGeometry, coinFaceGeometry, coinHullGeometry, coinMaterial, coinUniforms, faceSize, inkMaterial, releaseModels, smallCoinGeometry, tableRail } from './models'
import type { Side } from './rules'

/*
  The Coin Flip stage: a big gold coin on a round table of dark plum velvet in a pool of warm light, a padded rail far
  out in the dark, a shaft of light with dust in it and the room's lights blurred into bokeh all round. A flip is a
  real rigid-body flight worked out ahead (physics.ts): the wind-up and flick, the tumble through the air, the knocks
  on the velvet, the roll on its rim and the spin-down, each shown as it was simulated, only the disc turned within
  itself and the whole flight turned about the vertical (to be flicked from the camera's side), so it starts exactly
  as the coin lay and ends on the face that was drawn.

  The camera follows the coin up, drops low for a slow-motion landing on a long streak and, once the face can be read,
  rises to look down on it, circling round the resting coin until the emblem stands upright (the coin is never moved
  for that: the camera goes to it). The next flip is flicked from wherever the camera now stands.

  A streak sets the coin on fire, more with every win: a sheet of toon flame licking up behind it (a blue root from
  ten wins) and embers, a comet's tail in the air. A cash-out bursts coins out over the velvet; a jackpot rains them
  down to pile up round the coin, under sweeping beams, while the camera circles once. Everything runs on the scene
  clock, so turbo and "hurry" just play it faster.
*/

const FOV = 34
/** the spotlight, up and a little to the left and front */
const LAMP = new THREE.Vector3(-2.4, 17, 3.4)
const POOL = new THREE.Vector3(-0.2, 0, 0.1)
/** the table's rail, far out in the dark */
const TABLE_R = 9.6
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smooth = (t: number) => {
  const u = clamp01(t)
  return u * u * (3 - 2 * u)
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** frame-rate independent approach: covers 1 - e^(-k dt) of the way */
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt)
/** an angle brought within half a turn of zero */
const wrapPi = (a: number) => a - Math.PI * 2 * Math.round(a / (Math.PI * 2))
/** heat 0-1 for a streak of n wins */
export const heatOf = (n: number) => (n <= 0 ? 0 : Math.min(1, 0.1 + (n - 1) * 0.095))

export interface TossCues {
  /** the face can be read and can no longer change: the outcome is plain to see */
  result: () => void
  /** first touch on the velvet */
  landed?: () => void
}

interface Play {
  f: Flight
  /** the body's own turn that makes this flight start as the coin lay and end on the drawn face */
  b: Q
  /** the whole flight's turn about the vertical (the camera's side), and its cosine and sine */
  phi: number
  cphi: number
  sphi: number
  /** sim time; the flick's wind-up runs before it (pre, real seconds) */
  tau: number
  pre: number
  pre0: number
  offX: number
  offZ: number
  reveal: number
  revealed: boolean
  hit: number
  slowSaid: boolean
  streak: number
  win: boolean
  /** a quick flip: no slow motion or low camera (the first flips of a streak, and turbo) */
  quick: boolean
  end: Q
  endFace: Side
  endTurn: number
  cues: TossCues
  done: () => void
}

/* ---------------- fire: a sheet of toon flame behind the coin ---------------- */

const NOISE = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}`

const FIRE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const FIRE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHeat;
uniform float uHot;
uniform float uK;
uniform float uSpeed;
varying vec2 vUv;
${NOISE}
void main() {
  float y = vUv.y;
  float x = vUv.x * 2.0 - 1.0;
  float t = uTime;
  // the flames sway, more towards their tips, and lick upwards through rising noise
  x += (vnoise(vec2(y * 2.6 - t * 1.5, 3.1)) - 0.5) * 0.55 * y;
  #ifdef RING
  float n = fbm(vec2(x * 4.2, y * 2.2 - t * 2.4));
  float n2 = vnoise(vec2(x * 9.0, y * 4.0 - t * 4.2));
  #else
  float n = fbm(vec2(x * 2.1, y * 2.4 - t * (2.2 + uSpeed)));
  float n2 = vnoise(vec2(x * 5.5, y * 4.0 - t * 4.2));
  #endif
  #ifdef RING
  // round the back and sides of a coin lying still: a crown of tongues, lower towards the ends of the arc
  float shape = (1.0 - y) * 0.8 * (1.0 - 0.75 * pow(abs(x), 4.0)) - 0.1;
  #else
  // a comet's tail off a coin in the air (or rolling): wide at the root, tapering into tongues
  float shape = (1.0 - y) - x * x * (0.95 + 2.4 * y) * (1.15 - 0.3 * uHeat);
  #endif
  // tongues: a few licks across the width, wandering
  #ifdef RING
  float tongues = sin(x * 15.0 + n * 6.0 - t * 2.4) * 0.17 * smoothstep(0.05, 0.45, y);
  #else
  float tongues = sin(x * 7.0 + n * 5.0 - t * 2.0) * 0.12 * smoothstep(0.15, 0.6, y);
  #endif
  float v = shape + (n - 0.5) * (0.6 + 0.7 * y) + (n2 - 0.5) * 0.18 + tongues + (uHeat - 0.5) * 0.14;
  if (v <= 0.0) discard;
  // toon bands: a dark red lick at the edge, orange, yellow, a cream core
  float w = 0.025;
  vec3 col = vec3(0.78, 0.1, 0.06);
  col = mix(col, vec3(1.0, 0.4, 0.06), smoothstep(0.1 - w, 0.1 + w, v));
  col = mix(col, vec3(1.0, 0.72, 0.18), smoothstep(0.32 - w, 0.32 + w, v));
  col = mix(col, vec3(1.06, 0.95, 0.62), smoothstep(0.74 - w, 0.74 + w, v));
  // the hottest streaks burn blue at the root
  col = mix(col, vec3(0.42, 0.72, 1.12), uHot * smoothstep(0.24, 0.32, v) * (1.0 - smoothstep(0.06, 0.24, y)));
  #ifdef RING
  float a = smoothstep(0.0, 0.04, v) * smoothstep(0.0, 0.05, y) * (1.0 - smoothstep(0.8, 1.0, abs(x))) * uK;
  #else
  float a = smoothstep(0.0, 0.04, v) * smoothstep(0.17, 0.26, y) * uK;
  #endif
  gl_FragColor = vec4(col * a, a);
}`

/* ---------------- the trails: two ribbons of light (of fire, on a streak) swirling off the rim in the air ---------------- */

const TRAIL_VERT = /* glsl */ `
attribute float aU;
attribute float aV;
varying float vU;
varying float vV;
void main() {
  vU = aU;
  vV = aV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const TRAIL_FRAG = /* glsl */ `
uniform float uK;
uniform float uHeat;
uniform float uTime;
varying float vU;
varying float vV;
${NOISE}
void main() {
  float across = 1.0 - vV * vV;
  float along = pow(clamp(1.0 - vU, 0.0, 1.0), 1.6);
  // light: warm white at the coin, gold behind; fire: yellow, orange, red, flickering
  vec3 light = mix(vec3(1.0, 0.92, 0.7), vec3(1.0, 0.66, 0.25), vU);
  float fl = vnoise(vec2(vU * 9.0 - uTime * 7.0, vV * 2.0));
  vec3 fire = mix(vec3(1.0, 0.85, 0.4), vec3(1.0, 0.36, 0.06), smoothstep(0.1, 0.55, vU + fl * 0.3));
  fire = mix(fire, vec3(0.7, 0.08, 0.05), smoothstep(0.55, 0.95, vU));
  vec3 col = mix(light, fire, uHeat);
  float a = uK * along * across * mix(0.85, 1.0, uHeat) * (0.8 + 0.2 * fl);
  gl_FragColor = vec4(col * a * 1.25, a * 0.3);
}`

class Trail {
  readonly mesh: THREE.Mesh
  readonly mat: THREE.ShaderMaterial
  private readonly geo = new THREE.BufferGeometry()
  private readonly pos: Float32Array
  private readonly a = V3()
  private readonly b = V3()
  private n = 0
  constructor(private readonly cap = 32) {
    this.pos = new Float32Array(cap * 2 * 3)
    const u = new Float32Array(cap * 2)
    const v = new Float32Array(cap * 2)
    const idx: number[] = []
    for (let i = 0; i < cap; i++) {
      v[i * 2] = -1
      v[i * 2 + 1] = 1
      if (i < cap - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aU', new THREE.BufferAttribute(u, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aV', new THREE.BufferAttribute(v, 1))
    this.geo.setIndex(idx)
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 0 }, uHeat: { value: 0 }, uTime: { value: 0 } },
      vertexShader: TRAIL_VERT,
      fragmentShader: TRAIL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 4
  }
  get live() {
    return this.n > 1
  }
  /** rebuilds the ribbon through `pts` (the newest first), facing the camera, tapering to nothing at the tail */
  set(pts: THREE.Vector3[], cam: THREE.Vector3, width: number) {
    const n = Math.min(this.cap, pts.length)
    this.n = n
    if (n < 2) {
      this.geo.setDrawRange(0, 0)
      return
    }
    const u = this.geo.getAttribute('aU') as THREE.BufferAttribute
    for (let k = 0; k < n; k++) {
      const p = pts[k]
      this.a.subVectors(pts[Math.max(0, k - 1)], pts[Math.min(n - 1, k + 1)])
      if (this.a.lengthSq() < 1e-10) this.a.set(0, 1, 0)
      this.b.subVectors(cam, p)
      this.a.cross(this.b).normalize()
      const age = k / (n - 1)
      const w = width * (1 - age) ** 0.7
      this.pos.set([p.x + this.a.x * w, p.y + this.a.y * w, p.z + this.a.z * w, p.x - this.a.x * w, p.y - this.a.y * w, p.z - this.a.z * w], k * 6)
      u.setX(k * 2, age)
      u.setX(k * 2 + 1, age)
    }
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    u.needsUpdate = true
    this.geo.setDrawRange(0, (n - 1) * 6)
  }
  clear() {
    this.n = 0
    this.geo.setDrawRange(0, 0)
  }
  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/* ---------------- smoke: thin dark wisps that rise and curl away ---------------- */

const WISP_VERT = /* glsl */ `
attribute float aAge;
attribute float aSize;
attribute float aSeed;
uniform float uScale;
varying float vAge;
varying float vSeed;
void main() {
  vAge = aAge;
  vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (0.5 + aAge * 1.3) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
const WISP_FRAG = /* glsl */ `
uniform float uTime;
varying float vAge;
varying float vSeed;
${NOISE}
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float r = length(p) * 2.0;
  // a soft, torn wisp: noise eats into the puff, more as it ages
  float n = fbm(p * 3.0 + vec2(vSeed * 7.0, -uTime * 0.6 + vSeed));
  float m = (1.0 - smoothstep(0.35, 1.0, r)) * smoothstep(0.25 + vAge * 0.3, 0.75, n + 0.25);
  float a = m * (1.0 - smoothstep(0.35, 1.0, vAge)) * smoothstep(0.0, 0.12, vAge) * 0.72;
  gl_FragColor = vec4(vec3(0.1, 0.07, 0.11) * a, a);
}`

class Wisps {
  readonly points: THREE.Points
  readonly mat: THREE.ShaderMaterial
  private readonly list: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; seed: number }[] = []
  private readonly geo = new THREE.BufferGeometry()
  private readonly pos: Float32Array
  private readonly age: Float32Array
  private readonly size: Float32Array
  private readonly seed: Float32Array
  constructor(private readonly cap: number) {
    this.pos = new Float32Array(cap * 3)
    this.age = new Float32Array(cap)
    this.size = new Float32Array(cap)
    this.seed = new Float32Array(cap)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aAge', new THREE.BufferAttribute(this.age, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uTime: { value: 0 } },
      vertexShader: WISP_VERT,
      fragmentShader: WISP_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 8
  }
  get count() {
    return this.list.length
  }
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number) {
    if (this.list.length >= this.cap) this.list.shift()
    this.list.push({ x, y, z, vx, vy, vz, life, max: life, size, seed: Math.random() })
  }
  update(dt: number, t: number) {
    const L = this.list
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const w = L[i]
      w.life -= dt
      if (w.life <= 0) continue
      // rising, slowing, curling away
      const a = (1 - w.life / w.max) * 6 + w.seed * 20
      w.vx = w.vx * (1 - 1.2 * dt) + Math.sin(a + t) * 0.9 * dt
      w.vz = w.vz * (1 - 1.2 * dt) + Math.cos(a * 1.3 + t) * 0.9 * dt
      w.vy = w.vy * (1 - 0.6 * dt) + 0.3 * dt
      w.x += w.vx * dt
      w.y += w.vy * dt
      w.z += w.vz * dt
      L[n++] = w
      const j = n - 1
      this.pos[j * 3] = w.x
      this.pos[j * 3 + 1] = w.y
      this.pos[j * 3 + 2] = w.z
      this.age[j] = 1 - w.life / w.max
      this.size[j] = w.size
      this.seed[j] = w.seed
    }
    L.length = n
    this.geo.setDrawRange(0, n)
    for (const k of ['position', 'aAge', 'aSize', 'aSeed']) (this.geo.getAttribute(k) as THREE.BufferAttribute).needsUpdate = true
  }
  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/* ---------------- coins that fall, bounce and pile up on the velvet ---------------- */

interface Drop {
  age: number
  tint: THREE.Color
  p: THREE.Vector3
  v: THREE.Vector3
  q: THREE.Quaternion
  axis: THREE.Vector3
  w: number
  s: number
  life: number
  landed: boolean
  bounced: number
  lift: number
}

class CoinRain {
  readonly mesh: THREE.InstancedMesh
  readonly list: Drop[] = []
  private readonly m = new THREE.Matrix4()
  private readonly dq = new THREE.Quaternion()
  private readonly sv = V3()
  private readonly up = V3()
  private seq = 0
  /** called when a coin knocks the table or the big coin hard enough to be heard (how hard, 0-1) */
  onClink?: (k: number) => void
  /** the big coin, which falling coins glance off rather than land on */
  coin = V3()
  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private readonly cap: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }
  emit(p: THREE.Vector3, v: THREE.Vector3, s: number, life: number) {
    if (this.list.length >= this.cap) this.list.shift()
    const axis = V3(rnd(-1, 1), rnd(-0.4, 0.4), rnd(-1, 1)).normalize()
    const q = new THREE.Quaternion().setFromAxisAngle(V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), rnd(0, Math.PI * 2))
    // gold, a touch deeper than the big coin (the little ones are seen face on, where the gold is palest)
    const k = rnd(0.8, 0.95)
    const tint = new THREE.Color(k, k * rnd(0.72, 0.8), k * rnd(0.42, 0.52))
    this.list.push({ age: 0, tint, p: p.clone(), v: v.clone(), q, axis, w: rnd(7, 16), s, life, landed: false, bounced: 0, lift: (this.seq++ % 9) * 0.0035 })
  }
  /** every coin lying on the velvet goes in `t` seconds or less */
  fade(t = 0.35) {
    for (const d of this.list) d.life = Math.min(d.life, t)
  }
  update(dt: number) {
    const L = this.list
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const d = L[i]
      d.life -= dt
      d.age += dt
      if (d.life <= 0) continue
      if (!d.landed) {
        d.v.y -= 22 * dt
        d.p.addScaledVector(d.v, dt)
        this.dq.setFromAxisAngle(d.axis, d.w * dt)
        d.q.premultiply(this.dq)
        // glancing off the big coin's face
        const dx = d.p.x - this.coin.x
        const dz = d.p.z - this.coin.z
        const r2 = dx * dx + dz * dz
        if (r2 < RADIUS * RADIUS * 1.05 && d.p.y < this.coin.y + HALF + 0.08 && d.p.y > this.coin.y - 0.1 && d.v.y < 0) {
          const r = Math.sqrt(r2) || 1
          d.v.set((dx / r) * rnd(1.6, 2.6), Math.max(1.8, -d.v.y * 0.35), (dz / r) * rnd(1.6, 2.6))
          d.w *= 1.3
          this.onClink?.(0.7)
        }
        const floor = SMALL_HALF * d.s + d.lift
        if (d.p.y <= floor && d.v.y < 0) {
          d.p.y = floor
          if (d.v.y < -3.2 && d.bounced < 1) {
            d.v.y = -d.v.y * 0.24
            d.v.x *= 0.45
            d.v.z *= 0.45
            d.w *= 0.45
            d.bounced++
            this.onClink?.(Math.min(1, -d.v.y / 4))
          } else {
            // lies flat where it fell, whichever way up it came down, turned however it was turned
            d.landed = true
            this.up.set(0, 1, 0).applyQuaternion(d.q)
            const e = new THREE.Euler().setFromQuaternion(d.q, 'YXZ')
            d.q.setFromEuler(new THREE.Euler(this.up.y >= 0 ? 0 : Math.PI, e.y, 0, 'YXZ'))
            d.v.set(0, 0, 0)
          }
        }
      }
      const s = d.s * Math.min(1, d.life / 0.3, d.age / 0.12)
      this.sv.set(s, s, s)
      this.m.compose(d.p, d.q, this.sv)
      L[n++] = d
      this.mesh.setMatrixAt(n - 1, this.m)
      this.mesh.setColorAt(n - 1, d.tint)
    }
    L.length = n
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
  dispose() {
    this.mesh.dispose()
  }
}

/* ---------------- the scene ---------------- */

export class CoinScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private readonly quality = new PacedQuality()
  private readonly tableMat: THREE.ShaderMaterial
  private readonly coneMat: THREE.ShaderMaterial
  private readonly motesMat: THREE.ShaderMaterial
  private readonly coin = new THREE.Group()
  private ghost: { g: THREE.Group; mats: THREE.ShaderMaterial[] } | null = null
  private readonly sparks = new Sparks(700)
  private readonly embers = new Sparks(400)
  private readonly wisps = new Wisps(90)
  /** the light off the coin in the air: its near and far edges (they braid as it flips end over end), and a soft streak down its middle */
  private readonly trails = [new Trail(), new Trail(), new Trail()]
  private readonly trailPts = [0, 1, 2].map(() => Array.from({ length: 22 }, () => V3()))
  private readonly edgeDir = V3()
  private readonly fire: THREE.Mesh
  private readonly fireMat: THREE.ShaderMaterial
  private readonly ring: THREE.Mesh
  private readonly ringMat: THREE.ShaderMaterial
  private rain!: CoinRain
  private readonly beams: { m: THREE.Mesh; mat: THREE.ShaderMaterial; a: number }[] = []
  private readonly rays: THREE.Mesh
  private readonly raysMat: THREE.MeshBasicMaterial
  private readonly flash: THREE.Mesh
  private readonly flashMat: THREE.MeshBasicMaterial
  private readonly halo: THREE.Mesh
  private readonly haloMat: THREE.MeshBasicMaterial
  private readonly u = coinUniforms()

  // the coin at rest: where it lies, which face is up, how far it is turned
  private rest = { x: 0, z: 0, face: 'heads' as Side, turn: 0 }
  private play: Play | null = null
  private readonly pool = new Map<string, Flight[]>()
  private poolTimer = 0
  private poolGen = 0

  // the camera's rig: what it looks at, how high it stands (radians), how far, which side (azimuth, a spring)
  private readonly camT = V3(0, 0.2, 0)
  private camEl = 0.9
  private camD = 12
  private camAz = 0
  private azV = 0
  private readonly goalT = V3(0, 0.2, 0)
  private goalEl = 0.9
  private goalD = 12
  private goalAz = 0
  private D0 = 12
  private shake = 0
  private look = new THREE.Vector2()
  private lookTo = new THREE.Vector2()
  private hold = 0
  /** a jackpot's lap round the coin (0-1 of it, its length in seconds, the side it starts and ends on) */
  private lap = 0
  private lapDur = 0
  private lapBase = 0

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private raf = 0
  private last = 0
  private acc = 0
  private clock = 0
  private drewLast = false
  private disposed = false
  private turbo = false
  private auto = false
  private hurried = false

  // a streak's fire and the show's lights
  private heat = 0
  private heatGoal = 0
  private streak = 0
  private shine = 0
  private dim = 0
  private lossK = 0
  /** how deep in slow motion the show is (0-1), and the lens's kick at a hard landing */
  private slowK = 0
  private punch = 0
  private flashK = 0
  private raysK = 0
  private haloK = 0
  private beamK = 0
  private legend = false
  private haloColor = new THREE.Color()
  private star!: THREE.Sprite
  private starMat!: THREE.SpriteMaterial
  private starK = 0
  private fireOn: ReturnType<typeof sfx.coinflip.fire> = null
  private whirr: ReturnType<typeof sfx.coinflip.whirr> = null
  private spinSnd: ReturnType<typeof sfx.coinflip.spin> = null
  private readonly tmpQ = new THREE.Quaternion()
  private readonly prevPos = V3()
  private readonly vel = V3()
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void
  /** the coin's sounds, silent once the scene is gone */
  private readonly sound = new Proxy(sfx.coinflip, {
    get: (t, k) => (this.disposed ? () => null : t[k as keyof typeof t]),
  })

  constructor(el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.6 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setClearColor('#07030b')
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:manipulation'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    // the threshold sits above lit gold, so only the sparks, flashes and the fire's core bloom
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.02)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // the room behind everything: deep plum, a little lighter where the lamp's glow reaches
    const backMat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), backMat)
    back.frustumCulled = false
    back.renderOrder = -10
    this.scene.add(back)
    this.own.push(back.geometry, backMat)

    // the velvet
    this.tableMat = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: V3() },
        uTime: { value: 0 },
        uPool: { value: new THREE.Color(1, 0.86, 0.66) },
        uPoolC: { value: new THREE.Vector2(POOL.x, POOL.z) },
        uCoin: { value: new THREE.Vector2() },
        uShadowC: { value: new THREE.Vector2() },
        uShadowQ: { value: V3(1, 0, 1) },
        uShadowSoft: { value: 0.1 },
        uShadowDark: { value: 0.8 },
        uFire: { value: 0 },
        uFlash: { value: 0 },
        uDim: { value: 0 },
        uRail: { value: TABLE_R },
      },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: TABLE_FRAG,
    })
    const table = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), this.tableMat)
    table.rotation.x = -Math.PI / 2
    this.scene.add(table)
    this.own.push(table.geometry, this.tableMat)

    // the shaft of light, and dust drifting in it
    const coneH = LAMP.clone().sub(POOL).length()
    const coneGeo = new THREE.ConeGeometry(5.4, coneH, 48, 1, true)
    coneGeo.translate(0, -coneH / 2, 0)
    this.coneMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uK: { value: 1 }, uColor: { value: new THREE.Color(1, 0.86, 0.66) }, uGain: { value: 0.05 } },
      vertexShader: CONE_VERT,
      fragmentShader: CONE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
    const cone = new THREE.Mesh(coneGeo, this.coneMat)
    cone.position.copy(LAMP)
    cone.quaternion.setFromUnitVectors(V3(0, -1, 0), POOL.clone().sub(LAMP).normalize())
    cone.renderOrder = 5
    this.scene.add(cone)
    this.own.push(coneGeo, this.coneMat)
    {
      const n = mobile ? 90 : 160
      const p = new Float32Array(n * 3)
      const ph = new Float32Array(n)
      const axis = POOL.clone().sub(LAMP)
      for (let i = 0; i < n; i++) {
        const t = 0.25 + Math.random() * 0.72
        const c = LAMP.clone().addScaledVector(axis, t)
        const r = Math.sqrt(Math.random()) * 5.0 * t
        const a = Math.random() * Math.PI * 2
        p.set([c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r], i * 3)
        ph[i] = Math.random() * 100
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(p, 3))
      g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1))
      this.motesMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uScale: { value: 400 }, map: { value: glowTexture() } },
        vertexShader: MOTES_VERT,
        fragmentShader: MOTES_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const motes = new THREE.Points(g, this.motesMat)
      motes.frustumCulled = false
      motes.renderOrder = 6
      this.scene.add(motes)
      this.own.push(g, this.motesMat)
    }
    // the room's lights, far off and out of focus, all the way round (the camera may stand on any side)
    {
      const tex = bokehTexture()
      this.own.push(tex)
      const COLS = ['#ffb347', '#ff6a3d', '#c04bff', '#ffd27a', '#ff4f8b', '#7f6bff']
      let seed = 7
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
      const N = 40
      for (let i = 0; i < N; i++) {
        const m = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(COLS[i % COLS.length]).multiplyScalar(0.35 + r() * 0.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 })
        const s = new THREE.Sprite(m)
        const a = ((i + r() * 0.8) / N) * Math.PI * 2
        const d = 34 + r() * 22
        s.position.set(Math.sin(a) * d, 4 + r() * 20, -Math.cos(a) * d)
        s.scale.setScalar(2 + r() * 4.5)
        this.scene.add(s)
        this.own.push(m)
      }
    }

    // effects on the velvet: a sunburst under a winner, a ring of light where the coin lands, a halo
    const raysTex = raysTexture()
    this.raysMat = new THREE.MeshBasicMaterial({ map: raysTex, color: new THREE.Color('#ffd98a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false })
    this.rays = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), this.raysMat)
    this.rays.rotation.x = -Math.PI / 2
    this.rays.position.y = 0.006
    this.rays.renderOrder = 2
    this.scene.add(this.rays)
    this.own.push(raysTex, this.raysMat, this.rays.geometry)
    this.flashMat = new THREE.MeshBasicMaterial({ map: ringTexture(), color: new THREE.Color('#ffc46b'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false })
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.flashMat)
    this.flash.rotation.x = -Math.PI / 2
    this.flash.position.y = 0.008
    this.flash.renderOrder = 3
    this.scene.add(this.flash)
    this.own.push(this.flashMat, this.flash.geometry)
    this.haloMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color('#ffcf6b'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0, toneMapped: false })
    this.halo = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), this.haloMat)
    this.halo.rotation.x = -Math.PI / 2
    this.halo.renderOrder = 1
    this.scene.add(this.halo)
    this.own.push(this.haloMat, this.halo.geometry)

    // the fire: one sheet behind the coin, turned to the camera every frame
    const fireGeo = new THREE.PlaneGeometry(1, 1)
    fireGeo.translate(0, 0.32, 0)
    this.fireMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uHot: { value: 0 }, uK: { value: 0 }, uSpeed: { value: 0 } },
      vertexShader: FIRE_VERT,
      fragmentShader: FIRE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    this.fire = new THREE.Mesh(fireGeo, this.fireMat)
    this.fire.frustumCulled = false
    this.fire.renderOrder = 7
    this.fire.visible = false
    this.scene.add(this.fire)
    this.own.push(fireGeo, this.fireMat)
    // and round a coin lying still: an arc of flame standing on the velvet round the back and sides of its rim,
    // turned to the camera (open towards it, so the face is never covered)
    const ringGeo = new THREE.CylinderGeometry(1, 1, 1, 48, 1, true, Math.PI - 1.9, 3.8)
    ringGeo.translate(0, 0.5, 0)
    this.ringMat = this.fireMat.clone()
    this.ringMat.defines = { RING: '' }
    this.ring = new THREE.Mesh(ringGeo, this.ringMat)
    this.ring.frustumCulled = false
    this.ring.renderOrder = 7
    this.ring.visible = false
    this.scene.add(this.ring)
    this.own.push(ringGeo, this.ringMat)

    // the jackpot's beams, sweeping over the table from high up
    {
      const bh = 22
      const g = new THREE.ConeGeometry(1.5, bh, 24, 1, true)
      g.translate(0, -bh / 2, 0)
      this.own.push(g)
      for (let i = 0; i < 4; i++) {
        const mat = new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uColor: { value: new THREE.Color('#ffd98a') }, uGain: { value: 0.16 } },
          vertexShader: CONE_VERT,
          fragmentShader: CONE_FRAG,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
        })
        const m = new THREE.Mesh(g, mat)
        m.visible = false
        m.renderOrder = 5
        this.scene.add(m)
        this.beams.push({ m, mat, a: (i / 4) * Math.PI * 2 })
        this.own.push(mat)
      }
    }

    // a four-pointed twinkle for the rim
    const starTex = starTexture()
    this.starMat = new THREE.SpriteMaterial({ map: starTex, color: new THREE.Color(1.6, 1.4, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0 })
    this.star = new THREE.Sprite(this.starMat)
    this.star.renderOrder = 12
    this.scene.add(this.star)
    this.own.push(starTex, this.starMat)

    this.scene.add(this.sparks.points, this.embers.points, this.wisps.points, ...this.trails.map((t) => t.mesh))
    this.own.push(this.sparks, this.embers, this.wisps, ...this.trails)

    this.onMove = (e) => {
      if (e.pointerType === 'touch') return
      const r = cv.getBoundingClientRect()
      this.lookTo.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    }
    this.onLeave = () => this.lookTo.set(0, 0)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerleave', this.onLeave)

    const r0 = el.getBoundingClientRect()
    this.resize(r0.width || 800, r0.height || 600)
    this.ready = this.init()
  }

  /* ---------------- setup ---------------- */

  private async init() {
    const step = (p: number) => {
      this.onProgress?.(p)
      return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    }
    await step(0.05)
    if (this.disposed) return
    // the lettering on the faces is Manrope: wait (briefly) for the font
    try {
      await Promise.race([document.fonts.load('800 40px Manrope'), new Promise((r) => setTimeout(r, 1500))])
    } catch {
      /* the fallback font will do */
    }
    if (this.disposed) return
    const size = faceSize()
    await step(0.2)
    // the two faces are painted one at a time (the heaviest step), each cached for the next visit
    const heads = coinMaterial({ side: 'heads', size })
    await step(0.45)
    if (this.disposed) return
    const tails = coinMaterial({ side: 'tails', size })
    await step(0.65)
    if (this.disposed) return
    const [topGeo, botGeo] = coinFaceGeometry()
    const body = coinBodyGeometry()
    const build = (g: THREE.Group, mats: THREE.ShaderMaterial[], hull: boolean) => {
      g.add(new THREE.Mesh(body, mats[0]), new THREE.Mesh(topGeo, mats[1]), new THREE.Mesh(botGeo, mats[2]))
      if (hull) g.add(new THREE.Mesh(coinHullGeometry(), inkMaterial()))
    }
    build(this.coin, [coinMaterial('body'), heads, tails], true)
    this.scene.add(this.coin)
    // one faint motion-blur ghost: the same coin, see-through, a moment behind
    {
      const mats = [coinMaterial('body', 0.2), coinMaterial({ side: 'heads', size }, 0.2), coinMaterial({ side: 'tails', size }, 0.2)]
      const g = new THREE.Group()
      build(g, mats, false)
      g.visible = false
      this.ghost = { g, mats }
      this.scene.add(g)
    }
    // the lamp and the room to light the chips and the rail
    const key = new THREE.DirectionalLight('#ffd6a0', 0.95)
    key.position.copy(LAMP)
    this.scene.add(key, new THREE.AmbientLight('#8a4f9e', 0.42))
    // the table's rail, and chips stacked here and there round the edge of the light, each with its soft shadow
    this.scene.add(tableRail(TABLE_R))
    const shadowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#000000', transparent: true, opacity: 0.6, depthWrite: false })
    const shadowGeo = new THREE.PlaneGeometry(2.4, 2.4)
    this.own.push(shadowMat, shadowGeo)
    for (const [a, d, n, c, seed] of [
      [-0.62, 6.9, 7, 0, 3],
      [-0.42, 7.6, 4, 1, 7],
      [0.55, 7.3, 9, 2, 11],
      [1.7, 6.8, 5, 3, 5],
      [2.6, 7.4, 6, 1, 13],
      [3.55, 7.0, 8, 0, 17],
      [4.55, 7.2, 3, 2, 19],
      [5.4, 6.9, 6, 3, 23],
    ] as const) {
      const x = Math.sin(a) * d
      const z = -Math.cos(a) * d
      const st = chipStack(n, c, seed)
      st.position.set(x, 0, z)
      this.scene.add(st)
      const sh = new THREE.Mesh(shadowGeo, shadowMat)
      sh.rotation.x = -Math.PI / 2
      sh.position.set(x + 0.15, 0.003, z + 0.12)
      this.scene.add(sh)
    }
    this.rain = new CoinRain(smallCoinGeometry(), coinMaterial('body'), 900)
    this.rain.onClink = (k) => this.sound.clink(k)
    this.scene.add(this.rain.mesh)
    this.own.push(this.rain)
    this.placeCoin()
    // the flights are worked out ahead, a few of each kind
    this.fillPool(true)
    await step(0.8)
    if (this.disposed) return
    // every material and effect once, so every shader compiles before the first flip
    if (this.ghost) this.ghost.g.visible = true
    this.fire.visible = true
    this.ring.visible = true
    for (const b of this.beams) b.m.visible = true
    this.sparks.emit(0, -5, 0, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    this.embers.emit(0, -5, 0, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.embers.update(0)
    this.wisps.emit(0, -5, 0, 0, 0, 0, 0.1, 0.01)
    this.wisps.update(0, 0)
    this.rain.emit(V3(0, -5, 0), V3(), 1, 0.01)
    this.rain.update(0)
    for (const t of this.trails) t.set([V3(0, -5, 0), V3(0, -6, 0)], V3(0, 5, 5), 0.1)
    this.raysMat.opacity = this.flashMat.opacity = this.haloMat.opacity = 0.01
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      await compiled
    } catch {
      this.renderer.setRenderTarget(null)
      /* compiles on first draw instead */
    }
    if (this.disposed) return
    this.composer.render()
    if (this.ghost) this.ghost.g.visible = false
    this.fire.visible = false
    this.ring.visible = false
    for (const b of this.beams) b.m.visible = false
    for (const t of this.trails) t.clear()
    this.raysMat.opacity = this.flashMat.opacity = this.haloMat.opacity = 0
    await step(1)
    if (this.disposed) return
    this.snapCamera()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /**
   * Keeps three flights of each kind ready (lively or not, ending each way up), worked out one at a time while the
   * coin lies still (never during a flip: each takes a few milliseconds). Before the first frame, one of each will do.
   */
  private fillPool(now = false) {
    clearTimeout(this.poolTimer)
    // one chain of work at a time: a newer call takes over from an older one still waiting for an idle moment
    const gen = ++this.poolGen
    const missing = (want = 3) => {
      for (const lively of [true, false])
        for (const flips of [true, false]) {
          const k = `${lively}:${flips}`
          if ((this.pool.get(k)?.length ?? 0) < want) return { lively, flips, k }
        }
      return null
    }
    const idle = (fn: () => void) => {
      const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback
      if (ric) ric(fn, { timeout: 400 })
      else fn()
    }
    const work = () => {
      if (this.disposed || gen !== this.poolGen) return
      if (this.play) {
        this.poolTimer = window.setTimeout(work, 300)
        return
      }
      const m = missing()
      if (!m) return
      const f = makeFlight(m.lively)
      if (f) {
        const k = `${m.lively}:${f.flips}`
        const list = this.pool.get(k) ?? []
        if (list.length < 3) list.push(f)
        this.pool.set(k, list)
      }
      this.poolTimer = window.setTimeout(() => idle(work), 40)
    }
    if (now) {
      for (let i = 0; i < 40 && missing(1); i++) {
        const m = missing(1)!
        const f = makeFlight(m.lively)
        if (!f) continue
        const k = `${m.lively}:${f.flips}`
        const list = this.pool.get(k) ?? []
        list.push(f)
        this.pool.set(k, list)
      }
      this.poolTimer = window.setTimeout(() => idle(work), 200)
    } else this.poolTimer = window.setTimeout(() => idle(work), 60)
  }

  /** a flight that ends the other way up (or not), lively most of the time: chosen before the parity is looked at */
  private takeFlight(flips: boolean): Flight {
    const lively = Math.random() < 0.72
    const k = `${lively}:${flips}`
    const list = this.pool.get(k)
    const f = list?.shift()
    this.fillPool()
    if (f) return f
    for (let i = 0; i < 80; i++) {
      const g = makeFlight(lively, Math.random, 30)
      if (g && g.flips === flips) return g
      if (g) {
        const kk = `${lively}:${g.flips}`
        const l = this.pool.get(kk) ?? []
        if (l.length < 3) l.push(g)
        this.pool.set(kk, l)
      }
    }
    // never expected: take whatever ends right
    for (const [kk, l] of this.pool) if (kk.endsWith(String(flips)) && l.length) return l.shift()!
    throw new Error('no flight')
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const scale = (h * this.dpr) / (2 * tan)
    this.sparks.mat.uniforms.scale.value = scale
    this.embers.mat.uniforms.scale.value = scale
    this.wisps.mat.uniforms.uScale.value = scale
    this.motesMat.uniforms.uScale.value = scale
    // the coin's width: about a third of a wide stage, half a phone's
    const aspect = w / h
    const frac = aspect > 1.25 ? 0.3 : aspect > 0.9 ? 0.36 : 0.52
    const byW = RADIUS / (frac * tan * aspect)
    const byH = (RADIUS * 1.55) / (0.44 * 2 * tan)
    this.D0 = Math.max(byW, byH)
    if (!this.play) this.idleGoals()
  }

  setTurbo(on: boolean) {
    this.turbo = on
  }

  /** auto mode: with turbo on, the flips go quicker still */
  setAuto(on: boolean) {
    this.auto = on
  }

  /** speeds the rest of the flip up (and skips its slow motion) */
  hurry() {
    if (this.play) this.hurried = true
  }

  get playing() {
    return !!this.play
  }

  /** the streak burning on the coin: 0 puts the fire out */
  setStreak(n: number, quiet = false) {
    const prev = this.streak
    this.streak = n
    this.heatGoal = heatOf(n)
    if (n > prev && n >= 2 && !quiet && [2, 4, 7, 10, 13].includes(n)) this.sound.ignite(Math.min(5, Math.ceil(n / 3)))
  }

  /** whether a point on screen (CSS px within the stage) is over the coin as it lies */
  onCoin(x: number, y: number) {
    if (this.play) return false
    const right = V3(1, 0, 0).applyQuaternion(this.camera.quaternion).setY(0).normalize()
    const c = this.coin.position.clone().project(this.camera)
    const e = this.coin.position.clone().addScaledVector(right, RADIUS * 1.1).project(this.camera)
    const cx = ((c.x + 1) / 2) * this.w
    const cy = ((1 - c.y) / 2) * this.h
    const rx = Math.hypot(((e.x + 1) / 2) * this.w - cx, ((1 - e.y) / 2) * this.h - cy)
    // seen from above at an angle the coin is an ellipse a little flatter than it is wide
    return ((x - cx) / rx) ** 2 + ((y - cy) / (rx * 0.9)) ** 2 <= 1
  }

  /** the face showing as the coin lies now */
  get face() {
    return this.rest.face
  }

  /* ---------------- a flip ---------------- */

  /**
   * Flips the coin to land on `face`. Resolves once it lies still (the result cue fires before, as soon as the face
   * is decided and can be read). `streak` is the wins so far (the fire), `win` whether the call comes up.
   */
  toss(face: Side, o: { streak: number; win: boolean }, cues: TossCues) {
    return new Promise<void>((done) => {
      if (this.disposed) return done()
      const flips = face !== this.rest.face
      const f = this.takeFlight(flips)
      // flicked from the camera's side: the whole flight turned about the vertical to where the camera stands
      const phi = this.camAz
      const b = showTurn(f, this.rest.face, this.rest.turn, face, phi)!
      const L = (f.n - 1) * 4
      const endShow = qmul(yaw(phi), qmul([f.quat[L], f.quat[L + 1], f.quat[L + 2], f.quat[L + 3]], b))
      const flat = flatten(endShow)
      if (import.meta.env.DEV && flat.face !== face) console.error('coinflip: a flight would end on the wrong face')
      const quick = this.turbo || o.streak < 3
      this.hurried = false
      this.hold = 0
      this.lap = 0
      const pre = this.turbo ? 0.1 : quick ? 0.16 : 0.22
      this.play = {
        f,
        b,
        phi,
        cphi: Math.cos(phi),
        sphi: Math.sin(phi),
        tau: 0,
        pre,
        pre0: pre,
        offX: this.rest.x,
        offZ: this.rest.z,
        reveal: readableAt(f, 30),
        revealed: false,
        hit: 0,
        slowSaid: false,
        streak: o.streak,
        win: o.win,
        quick,
        end: restQuat(flat.face, flat.turn),
        endFace: flat.face,
        endTurn: flat.turn,
        cues,
        done,
      }
      this.shine = 0
      this.raysK = 0
      this.haloK = 0
      this.beamK = 0
      this.lossK = 0
      this.rainLeft = 0
      this.legend = false
      this.u.uDull.value = 0
      this.rain.fade(0.4)
    })
  }

  /** a cash-out on the coin: a sunburst on the velvet, gold bursting out of the coin to land round it (more for more) */
  cashout(mult: number) {
    const p = this.coin.position
    this.raysK = Math.min(1, 0.55 + Math.log2(mult) * 0.08)
    this.haloK = 1
    this.haloColor.set('#ffcf6b')
    this.shine = 0.8
    const n = Math.min(90, 12 + Math.round(Math.log2(mult) * 7))
    this.burstCoins(p, n, 1)
    this.sparks.burst(p.clone().add(V3(0, 0.3, 0)), new THREE.Color('#ffd25a'), 40, 6, 0.3, 0.9)
    // the fire bursts into sparks and settles
    if (this.heat > 0.05) for (let i = 0; i < 60; i++) this.embers.emit(p.x + rnd(-1, 1), 0.3, p.z + rnd(-1, 1), rnd(-2, 2), rnd(3, 7), rnd(-2, 2), new THREE.Color(2, 0.8, 0.2), rnd(0.12, 0.26), rnd(0.6, 1.2), -4, 1.2)
  }

  /** a jackpot: coins rain down over the whole view and pile up, beams sweep the table, the camera circles once */
  jackpot(tier: number) {
    const p = this.coin.position
    this.raysK = 1
    this.haloK = 1.4
    this.shine = 0.9
    this.beamK = 1
    this.legend = tier >= 3
    this.rainLeft = 2.2 + tier * 0.7
    this.rainRate = 40 + tier * 20
    this.lap = 0.0001
    this.lapDur = 6 + tier * 1.2
    this.lapBase = this.upright(this.rest.turn)
    this.burstCoins(p, 50 + tier * 15, 1.3)
  }

  private rainLeft = 0
  private rainRate = 0
  private fireworkAt = 0
  private twinkleAt = 2
  private rainDrops(dt: number) {
    if (this.rainLeft <= 0) return
    this.rainLeft -= dt
    const p = this.coin.position
    const cam = this.camera.position
    const n = this.rainRate * dt
    let k = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0)
    while (k-- > 0) {
      // over the part of the table the camera sees (a disc round the coin), from well below the lens, never close to
      // it, so they fall through the frame rather than past the camera
      const a = Math.random() * Math.PI * 2
      const r = Math.sqrt(Math.random()) * 4.4
      const at = V3(p.x + Math.cos(a) * r, Math.min(cam.y - 2.2, rnd(3.6, 5.6)), p.z + Math.sin(a) * r)
      if (Math.hypot(at.x - cam.x, at.z - cam.z) < 3) continue
      const v = V3(rnd(-0.5, 0.5), rnd(-3, -0.5), rnd(-0.5, 0.5))
      this.rain.emit(at, v, rnd(0.8, 1.15), rnd(4, 6.5))
    }
    // a legendary streak also lets off fireworks over the table
    if (this.legend) {
      this.fireworkAt -= dt
      if (this.fireworkAt <= 0) {
        this.fireworkAt = rnd(0.25, 0.5)
        const c = new THREE.Color().setHSL(Math.random(), 1, 0.6)
        this.sparks.burst(V3(p.x + rnd(-3.5, 3.5), rnd(3.5, 6), p.z + rnd(-3.5, 1)), c, 46, 7, 0.26, 1.1)
        this.sound.firework()
      }
    }
  }

  /** at rest, now and then a point of the rim catches the light and twinkles */
  private twinkle(dt: number) {
    if (this.play) return
    this.twinkleAt -= dt
    if (this.twinkleAt > 0) return
    this.twinkleAt = rnd(1.6, 3.6)
    // somewhere along the far half of the rim, as the camera sees it
    const a = this.camAz + Math.PI + rnd(-1.2, 1.2)
    const c = this.coin.position
    this.star.position.set(c.x + Math.sin(a) * RADIUS, c.y + HALF + 0.05, c.z + Math.cos(a) * RADIUS)
    this.starK = 1
  }

  private burstCoins(p: THREE.Vector3, n: number, k: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = rnd(1.2, 3.0) * k
      const v = V3(Math.cos(a) * s, rnd(4.5, 7.5) * k, Math.sin(a) * s)
      // from the coin's rim, so they spill out over the velvet rather than land on its face
      this.rain.emit(V3(p.x + Math.cos(a) * RADIUS * 0.95, 0.35, p.z + Math.sin(a) * RADIUS * 0.95), v, rnd(0.75, 1.1), rnd(3.5, 5.5))
    }
  }

  /** a lost call: the fire collapses into embers and thin smoke, the light dips, the camera leans in */
  lost(wins: number) {
    this.dim = 1
    this.lossK = 1
    this.u.uDull.value = 1
    const p = this.coin.position
    if (this.heat > 0.08) {
      this.sound.douse(Math.min(1, wins / 8))
      for (let i = 0; i < 26; i++) {
        const a = Math.random() * Math.PI * 2
        const r = rnd(0.5, 1.05)
        this.wisps.emit(p.x + Math.cos(a) * r, 0.2 + rnd(0, 0.3), p.z + Math.sin(a) * r, Math.cos(a) * 0.2, rnd(0.6, 1.3), Math.sin(a) * 0.2, rnd(0.5, 0.9), rnd(1.6, 2.6))
      }
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2
        const r = rnd(0.6, 1.1)
        this.embers.emit(p.x + Math.cos(a) * r, 0.2, p.z + Math.sin(a) * r, Math.cos(a) * rnd(0.2, 0.8), rnd(0.8, 2.4), Math.sin(a) * rnd(0.2, 0.8), new THREE.Color(2.2, 0.75, 0.18), rnd(0.06, 0.12), rnd(0.8, 1.8), -0.4, 0.6)
      }
    } else {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2
        this.wisps.emit(p.x + Math.cos(a) * 0.9, 0.15, p.z + Math.sin(a) * 0.9, Math.cos(a) * 0.15, rnd(0.4, 0.8), Math.sin(a) * 0.15, rnd(0.35, 0.55), rnd(1.1, 1.7))
      }
    }
    this.heat *= 0.2
  }

  /* ---------------- the clock ---------------- */

  /** dev only: holds the clock, so a test can step it exactly (debugStep) and capture what it sees */
  private paused = false
  debugPause(on: boolean) {
    this.paused = on
    this.last = performance.now()
  }
  debugStep(seconds: number, fps = 60) {
    for (let t = 0; t < seconds - 1e-6; t += 1 / fps) {
      this.clock += 1 / fps
      this.update(1 / fps)
    }
    this.composer.render()
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    if (this.paused) return
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // at rest with nothing burning only the dust drifts: 30 frames a second is plenty
    const lively =
      !!this.play ||
      this.heat > 0.02 ||
      this.heatGoal > 0 ||
      this.hold > 0 ||
      this.shine > 0.01 ||
      this.raysK > 0.01 ||
      this.beamK > 0.01 ||
      this.rain.list.length > 0 ||
      this.rainLeft > 0 ||
      this.wisps.count > 0 ||
      this.trails[0].live ||
      this.starK > 0 ||
      this.lossK > 0.01 ||
      Math.abs(this.azV) > 1e-3 ||
      Math.abs(this.goalAz - this.camAz) > 1e-3 ||
      this.look.distanceToSquared(this.lookTo) > 1e-5 ||
      this.sparks.list.length > 0 ||
      this.embers.list.length > 0
    if (!lively && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const dt = Math.min(0.05, this.acc)
    this.acc = 0
    this.clock += dt
    this.update(dt)
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.composer.render()
  }

  private update(dt: number) {
    const muted = isMuted()
    this.prevPos.copy(this.coin.position)
    if (this.play) this.advance(dt)
    else this.placeCoin()
    if (dt > 0) this.vel.subVectors(this.coin.position, this.prevPos).divideScalar(dt)
    this.camGoals(dt)
    this.moveCamera(dt)
    this.updateFire(dt, muted)
    this.updateTrail()
    this.updateLights(dt)
    this.rainDrops(dt)
    this.twinkle(dt)
    this.starK = Math.max(0, this.starK - dt * 1.8)
    const sk = Math.sin(Math.min(1, this.starK) * Math.PI)
    this.starMat.opacity = sk
    this.star.scale.setScalar(0.25 + sk * 0.55)
    this.starMat.rotation = this.clock * 1.5
    this.sparks.update(dt)
    this.embers.update(dt)
    this.wisps.update(dt, this.clock)
    this.rain.coin.copy(this.coin.position)
    this.rain.update(dt)
  }

  /** the show's rate: sim seconds per real second, before slow motion */
  private rate(p: Play) {
    const base = this.turbo ? (this.auto ? 2.9 : 2.25) : p.quick ? 1.32 : 1.06
    return base * (this.hurried ? 2.6 : 1)
  }

  /** plays the flight on: the wind-up, then sim time at the show's rate */
  private advance(dt: number) {
    const p = this.play!
    const f = p.f
    if (p.pre > 0) {
      // the wind-up: the thumb under the near edge tips it up off the velvet, then lets fly
      p.pre -= dt * (this.hurried ? 3 : 1)
      const u = clamp01(1 - p.pre / p.pre0)
      this.placeCoin(-0.11 * Math.sin(u * Math.PI * 0.5) ** 2)
      if (p.pre <= 0) this.launch(p)
      return
    }
    const base = this.rate(p)
    // slow motion for the last moment of the fall and the first knock, on a long streak (deeper for a longer one)
    let slow = 1
    if (!this.hurried && !this.turbo) {
      const min = p.quick ? 0.66 : Math.max(0.2, 0.34 - p.streak * 0.012)
      const a = smooth((p.tau - (f.land - (p.quick ? 0.06 : 0.13))) / 0.06)
      const b = 1 - smooth((p.tau - (f.land + (p.quick ? 0.02 : 0.06))) / (p.quick ? 0.1 : 0.2))
      slow = lerp(1, min, Math.min(a, b))
      this.slowK = p.quick ? 0 : Math.min(a, b)
      if (!p.quick && !p.slowSaid && p.tau > f.land - 0.14) {
        p.slowSaid = true
        this.sound.slowmo(0.6 + Math.min(0.4, p.streak * 0.05))
      }
    }
    // after the landing the coin rolls a touch quicker than life, and quicker still once its face is plain
    const tail = p.tau > p.reveal ? 1.7 : p.tau > f.land + 0.25 ? 1.22 : 1
    const dtau = dt * base * slow * tail
    p.tau = Math.min(f.end, p.tau + dtau)
    this.poseAt(p.tau)
    this.ghostAt(p, dtau)

    // knocks on the velvet
    while (p.hit < f.hits.length && f.hits[p.hit].t <= p.tau) {
      const h = f.hits[p.hit]
      const first = p.hit === 0
      this.sound.knock(h.v, first)
      if (first) {
        this.punch = Math.min(1, h.v / 24)
        p.cues.landed?.()
        this.whirr?.stop()
        this.whirr = null
      }
      if (h.v > 4) {
        this.shake = Math.max(this.shake, Math.min(0.09, h.v * 0.0028))
        const c = this.coin.position
        this.flash.position.set(c.x, 0.008, c.z)
        this.flashK = Math.max(this.flashK, Math.min(1, h.v / 28))
        this.sparks.burst(V3(c.x, 0.1, c.z), new THREE.Color('#ffcf6b'), Math.round(4 + h.v * 0.6), 2 + h.v * 0.08, 0.14, 0.45)
      }
      p.hit++
    }
    // the flutter in the air, then the rattle of the spin-down
    if (this.whirr) {
      const i = Math.min(f.n - 2, Math.floor(p.tau * RATE))
      const w = this.angularSpeed(f, i)
      this.whirr.set((w / (Math.PI * 2)) * 2, p.tau < f.land ? 1 : 0)
    }
    const i = Math.min(f.n - 1, Math.floor(p.tau * RATE))
    const whirl = f.whirl[i]
    if (whirl > 6 && p.tau > f.land + 0.05) {
      if (!this.spinSnd && !isMuted()) this.spinSnd = this.sound.spin()
      // a little quieter as it gets quicker and lower
      const rate = (whirl / (Math.PI * 2)) * 2
      this.spinSnd?.set(rate, 0.35 + 0.65 * clamp01(1 - rate / 70))
    } else if (this.spinSnd && (whirl <= 2 || p.tau >= f.end)) {
      this.spinSnd.stop()
      this.spinSnd = null
    }
    // the glints flying off the rim in the air
    if (p.tau < f.land && p.tau > 0.08 && Math.random() < dt * 30) {
      const r = this.rimPoint(Math.random() * Math.PI * 2)
      this.sparks.emit(r.x, r.y, r.z, rnd(-0.3, 0.3), rnd(-0.2, 0.4), rnd(-0.3, 0.3), new THREE.Color(2.2, 1.6, 0.7), rnd(0.07, 0.13), rnd(0.18, 0.36), -1, 1.5)
    }

    if (!p.revealed && p.tau >= p.reveal) {
      p.revealed = true
      p.cues.result()
      if (p.win) {
        this.shine = 0.85
        this.haloK = 0.75
        this.haloColor.set('#ffd77a')
        const c = this.coin.position
        for (let i = 0; i < 26; i++) {
          const a = Math.random() * Math.PI * 2
          const r = rnd(0.4, 1.1)
          this.sparks.emit(c.x + Math.cos(a) * r, 0.15, c.z + Math.sin(a) * r, Math.cos(a) * 0.3, rnd(1.6, 3.4), Math.sin(a) * 0.3, new THREE.Color(2.2, 1.7, 0.8), rnd(0.08, 0.16), rnd(0.7, 1.2), -0.6, 0.8)
        }
        this.flash.position.set(c.x, 0.008, c.z)
        this.flashK = 1
      }
    }
    if (p.tau >= f.end) {
      this.rest = { x: this.coin.position.x, z: this.coin.position.z, face: p.endFace, turn: p.endTurn }
      this.placeCoin()
      if (this.ghost) this.ghost.g.visible = false
      this.spinSnd?.stop()
      this.spinSnd = null
      this.whirr?.stop()
      this.whirr = null
      this.sound.settle()
      if (!p.revealed) {
        p.revealed = true
        p.cues.result()
      }
      this.play = null
      this.hold = 1.4
      this.fillPool()
      p.done()
    }
  }

  /** the flick: the coin leaves the velvet with a puff and a ring, the lens kicks */
  private launch(p: Play) {
    this.sound.flick()
    // a streak of three or more: the tension rises under the flight
    if (p.streak >= 3) this.sound.riser(Math.min(1, (p.streak - 2) / 8), p.f.land / this.rate(p))
    if (!isMuted()) this.whirr = this.sound.whirr()
    const at = this.coin.position
    const near = V3(Math.sin(p.phi), 0, Math.cos(p.phi))
    const edge = at.clone().addScaledVector(near, RADIUS * 0.9).setY(0.06)
    this.sparks.burst(edge.clone().setY(0.2), new THREE.Color('#ffd98a'), 12, 2.6, 0.16, 0.4)
    // the velvet's nap kicked up as dust in the light
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * Math.PI * 2
      this.embers.emit(edge.x + Math.cos(a) * 0.3, 0.05, edge.z + Math.sin(a) * 0.3, Math.cos(a) * rnd(0.3, 1), rnd(0.3, 1.1), Math.sin(a) * rnd(0.3, 1), new THREE.Color(0.9, 0.62, 0.7), rnd(0.05, 0.09), rnd(0.4, 0.8), -1.2, 2)
    }
    this.flash.position.set(at.x, 0.008, at.z)
    this.flashK = Math.max(this.flashK, 0.55)
    this.punch = Math.max(this.punch, 0.35)
    this.shake = Math.max(this.shake, 0.035)
  }

  /** the coin at sim time `tau` of the flight in play, turned within itself and about the vertical, drifted from where it lay */
  private poseAt(tau: number) {
    this.poseInto(this.play!, tau, this.coin.position, this.coin.quaternion)
  }

  private readonly pq = new THREE.Quaternion()
  private readonly pq2 = new THREE.Quaternion()
  private readonly pq3 = new THREE.Quaternion()
  private poseInto(p: Play, tau: number, pos: THREE.Vector3, quat: THREE.Quaternion) {
    const f = p.f
    const x = Math.max(0, tau) * RATE
    const i = Math.min(f.n - 2, Math.floor(x))
    const k = clamp01(x - i)
    const P = f.pos
    const fx = lerp(P[i * 3], P[(i + 1) * 3], k)
    let py = lerp(P[i * 3 + 1], P[(i + 1) * 3 + 1], k)
    const fz = lerp(P[i * 3 + 2], P[(i + 1) * 3 + 2], k)
    // the path turned about the vertical by phi
    let px = fx * p.cphi + fz * p.sphi
    let pz = -fx * p.sphi + fz * p.cphi
    const Qa = f.quat
    const q = this.pq.set(Qa[i * 4], Qa[i * 4 + 1], Qa[i * 4 + 2], Qa[i * 4 + 3])
    q.slerp(this.pq2.set(Qa[(i + 1) * 4], Qa[(i + 1) * 4 + 1], Qa[(i + 1) * 4 + 2], Qa[(i + 1) * 4 + 3]), k)
    q.multiply(this.pq2.set(p.b[0], p.b[1], p.b[2], p.b[3]))
    q.premultiply(this.pq3.set(0, Math.sin(p.phi / 2), 0, Math.cos(p.phi / 2)))
    // the drift from where it lay to where this flight started fades out over the flight
    const off = 1 - smooth(tau / Math.max(0.2, f.land))
    px += p.offX * off
    pz += p.offZ * off
    // the last moments settle exactly flat
    const s = smooth((tau - (f.end - 0.3)) / 0.3)
    if (s > 0) {
      q.slerp(this.pq2.set(p.end[0], p.end[1], p.end[2], p.end[3]), s)
      py = lerp(py, HALF, s)
    }
    pos.set(px, py, pz)
    quat.copy(q)
  }

  /** the ghost trails the coin by a fraction of the frame's step, only while it spins fast high up */
  private ghostAt(p: Play, dtau: number) {
    const gh = this.ghost
    if (!gh) return
    const f = p.f
    const i = Math.min(f.n - 2, Math.floor(p.tau * RATE))
    const w = this.angularSpeed(f, i)
    const up = clamp01((this.coin.position.y - 1.4) / 1.4)
    const k = p.tau < f.land ? clamp01((w - 14) / 14) * up : 0
    if (k <= 0.01) {
      gh.g.visible = false
      return
    }
    const lag = Math.min(0.24 / Math.max(1, w), dtau / 2)
    this.poseInto(p, Math.max(0, p.tau - lag), gh.g.position, gh.g.quaternion)
    gh.g.visible = true
    for (const m of gh.mats) m.uniforms.uOpacity.value = k * 0.18
  }

  /** how fast the coin turns around sample i (rad/s) */
  private angularSpeed(f: Flight, i: number) {
    const a = f.quat
    const j = Math.min(f.n - 1, i + 1)
    const d = Math.abs(a[i * 4] * a[j * 4] + a[i * 4 + 1] * a[j * 4 + 1] + a[i * 4 + 2] * a[j * 4 + 2] + a[i * 4 + 3] * a[j * 4 + 3])
    return 2 * Math.acos(Math.min(1, d)) * RATE
  }

  /** a point on the rim of the coin as it is now, in the world */
  private rimPoint(a: number) {
    const v = V3(Math.cos(a) * RADIUS, 0, Math.sin(a) * RADIUS)
    return v.applyQuaternion(this.coin.quaternion).add(this.coin.position)
  }

  /** the coin as it lies (tip: lifted on its near edge by the thumb, pivoting on the far edge, radians) */
  private placeCoin(tip = 0) {
    const r = this.rest
    const q = restQuat(r.face, r.turn)
    this.coin.quaternion.set(q[0], q[1], q[2], q[3])
    this.coin.position.set(r.x, HALF, r.z)
    if (tip) {
      const az = this.play ? this.play.phi : this.camAz
      const pivot = V3(r.x - Math.sin(az) * RADIUS, 0, r.z - Math.cos(az) * RADIUS)
      const rot = new THREE.Quaternion().setFromAxisAngle(V3(Math.cos(az), 0, -Math.sin(az)), tip)
      this.coin.position.sub(pivot).applyQuaternion(rot).add(pivot)
      this.coin.quaternion.premultiply(rot)
    }
  }

  /* ---------------- camera ---------------- */

  /** the nearest azimuth to the camera's that shows a coin turned `turn` with its emblem upright */
  private upright(turn: number) {
    return this.camAz + wrapPi(turn - this.camAz)
  }

  private idleGoals() {
    this.goalT.set(this.rest.x * 0.55, 0.15, this.rest.z * 0.55)
    this.goalEl = 0.9
    this.goalD = this.D0
    this.goalAz = this.upright(this.rest.turn)
  }

  private camGoals(dt: number) {
    const p = this.play
    const c = this.coin.position
    const narrow = this.w / this.h < 0.9
    if (p && p.pre > 0) {
      // the wind-up: the camera already starts to stand back for the flight it knows is coming
      this.airGoals(p, 0.4 * clamp01(1 - p.pre / p.pre0), narrow)
      this.goalT.x = c.x * 0.5
      this.goalT.z = c.z * 0.5
      this.goalAz = p.phi
      return
    }
    if (!p) {
      if (this.hold > 0 || this.lossK > 0.01 || this.lap > 0) this.readGoals(this.rest.turn)
      else this.idleGoals()
      this.lapGoal(dt)
      return
    }
    const f = p.f
    this.goalAz = p.phi
    if (p.revealed) this.readGoals(p.endTurn)
    else if (p.tau < f.land) {
      // in the air: stand back to frame the whole arc (it is known ahead), the velvet and its light in view, so the
      // coin climbs and falls within the frame; a long streak drops low for a slow-motion landing
      const up = 0.5 + 0.5 * smooth(clamp01(p.tau / Math.max(0.2, f.apexT * 0.45)))
      const fall = clamp01((p.tau - f.apexT) / Math.max(0.1, f.land - f.apexT))
      if (p.quick) this.airGoals(p, up * (1 - 0.6 * smooth(fall)), narrow)
      else {
        this.airGoals(p, up, narrow)
        const d = smooth(fall * fall)
        this.goalT.y = lerp(this.goalT.y, 0.35, d)
        this.goalEl = lerp(this.goalEl, 0.26, smooth(fall))
        this.goalD = lerp(this.goalD, this.D0 * 0.8, smooth(fall))
      }
      this.goalT.x = c.x * 0.55
      this.goalT.z = c.z * 0.55
    } else if (p.quick) {
      this.goalT.set(c.x * 0.8, 0.25, c.z * 0.8)
      this.goalEl = 0.68
      this.goalD = this.D0 * 0.95
    } else {
      this.goalT.set(c.x * 0.85, 0.3, c.z * 0.85)
      this.goalEl = 0.62
      this.goalD = this.D0 * 0.84
    }
  }

  /** the flight's framing, w of the way from the view at rest (0) to the whole arc in the frame, the coin high in it (1) */
  private airGoals(p: Play, w: number, narrow: boolean) {
    this.goalT.y = lerp(0.2, p.f.apex * (narrow ? 0.76 : 0.72), w)
    this.goalEl = lerp(0.88, 0.22, w)
    this.goalD = this.D0 * lerp(1, narrow ? 1.75 : 1.65, w)
  }

  /** a jackpot's lap: the camera circles the coin once and comes back to the emblem upright */
  private lapGoal(dt: number) {
    if (this.lap <= 0) return
    this.lap = Math.min(1, this.lap + dt / this.lapDur)
    this.goalAz = this.lapBase + Math.PI * 2 * easeInOut(this.lap)
    this.goalEl -= 0.18 * Math.sin(this.lap * Math.PI)
    if (this.lap >= 1) {
      this.lap = 0
      // the same view, a full turn on
      this.camAz -= Math.PI * 2
      this.goalAz = this.lapBase
    }
  }

  /** the face from above, to read it, the camera round on the side that shows the emblem upright */
  private readGoals(turn: number) {
    const c = this.coin.position
    const narrow = this.w / this.h < 0.9
    const az = this.upright(turn)
    // the target a little beyond the coin, so the coin sits low in the frame, clear of the headline
    const off = narrow ? 0.7 : 0.45
    this.goalT.set(c.x * 0.8 - Math.sin(az) * off, 0.1, c.z * 0.8 - Math.cos(az) * off)
    this.goalEl = 1.04 - this.lossK * 0.1
    this.goalD = this.D0 * (narrow ? 0.98 : 0.9) * (1 - this.lossK * 0.12)
    this.goalAz = az
  }

  private snapCamera() {
    this.camGoals(0)
    this.camT.copy(this.goalT)
    this.camEl = this.goalEl
    this.camD = this.goalD
    this.camAz = this.goalAz
    this.azV = 0
    this.moveCamera(0)
  }

  private moveCamera(dt: number) {
    const p = this.play
    const air = p && p.pre <= 0 && !p.revealed
    const fast = air ? (p.tau < p.f.apexT ? 7 : p.tau < p.f.land ? 5.2 : 4.5) : p && p.pre > 0 ? 5 : 2.6
    const k = ease(fast * (this.turbo ? 1.5 : 1), dt)
    this.camT.lerp(this.goalT, k)
    this.camEl = lerp(this.camEl, this.goalEl, k)
    this.camD = lerp(this.camD, this.goalD, k)
    // the side the camera stands on moves on a critically damped spring: it starts and stops gently
    const wz = this.lap > 0 ? 5 : this.turbo ? 4.6 : 3.4
    this.azV += (wz * wz * (this.goalAz - this.camAz) - 2 * wz * this.azV) * dt
    this.camAz += this.azV * dt
    this.look.lerp(this.lookTo, ease(2.5, dt))
    this.hold = Math.max(0, this.hold - dt)
    this.lossK = Math.max(0, this.lossK - dt * 0.55)
    const az = this.camAz + this.look.x * 0.05
    const el = this.camEl + this.look.y * 0.03
    const cam = this.camera
    cam.position.set(this.camT.x + Math.sin(az) * Math.cos(el) * this.camD, this.camT.y + Math.sin(el) * this.camD, this.camT.z + Math.cos(az) * Math.cos(el) * this.camD)
    if (this.shake > 0.0005) {
      const s = this.shake
      cam.position.x += (Math.random() - 0.5) * s
      cam.position.y += (Math.random() - 0.5) * s
      this.shake *= Math.exp(-dt * 12)
    }
    cam.lookAt(this.camT)
    // the lens kicks in a touch at a hard landing, and eases back
    this.punch = Math.max(0, this.punch - dt * 2.4)
    const fov = FOV - 2.6 * Math.sin(Math.min(1, this.punch) * Math.PI * 0.5) * this.punch
    if (Math.abs(cam.fov - fov) > 1e-3) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
    cam.updateMatrixWorld()
  }

  /* ---------------- fire and light ---------------- */

  private updateFire(dt: number, muted: boolean) {
    this.heat = lerp(this.heat, this.heatGoal, ease(this.heatGoal > this.heat ? 1.6 : 3, dt))
    if (this.heat < 0.002 && this.heatGoal === 0) this.heat = 0
    this.u.uHeat.value = this.heat * 0.55
    const h = this.heat
    const c = this.coin.position
    const p = this.play
    const flying = !!p && p.pre <= 0 && p.tau < p.f.land && c.y > 0.5
    // the flames, from the second win: an arc round the back of the rim while the coin lies flat, a sheet streaming
    // off it in the air and while it rolls
    // (it catches quickly and grows with the streak, rather than fading in see-through)
    const fk = smooth((h - 0.14) / 0.04)
    const grow = 0.5 + 0.5 * smooth((h - 0.15) / 0.2)
    const up = Math.abs(V3(0, 1, 0).applyQuaternion(this.coin.quaternion).y)
    const flat = flying ? 0 : smooth((up - 0.9) / 0.08)
    this.ring.visible = fk * flat > 0.01
    if (this.ring.visible) {
      const cam = this.camera
      const az = Math.atan2(cam.position.x - c.x, cam.position.z - c.z)
      const el = Math.atan2(cam.position.y - c.y, Math.hypot(cam.position.x - c.x, cam.position.z - c.z))
      this.ring.rotation.set(0, az, 0)
      this.ring.position.set(c.x, Math.max(0, c.y - HALF), c.z)
      // seen from above, flames standing on the table look short: they stand taller the higher the camera
      const rr = RADIUS * (1.04 + 0.1 * h)
      this.ring.scale.set(rr, RADIUS * (0.8 + 0.95 * h) * grow * (1 + 0.85 * Math.sin(Math.max(0, el))), rr)
      this.ringMat.uniforms.uK.value = fk * flat
      this.ringMat.uniforms.uHeat.value = h
      this.ringMat.uniforms.uHot.value = smooth((this.streak - 9.5) / 1)
      this.ringMat.uniforms.uSpeed.value = 0
      this.ringMat.uniforms.uTime.value = this.clock
    }
    this.fire.visible = fk * (1 - flat) > 0.01
    if (this.fire.visible) {
      const cam = this.camera
      const toCam = V3().subVectors(cam.position, c).normalize()
      // in the air it streams off behind like a comet's tail: rolled against the coin's motion on screen
      let roll = 0
      let stretch = 1
      if (flying) {
        const a = c.clone().project(cam)
        const b = c.clone().addScaledVector(this.vel, 0.05).project(cam)
        const sx = (b.x - a.x) * this.w
        const sy = (b.y - a.y) * this.h
        const sp = Math.hypot(sx, sy)
        // the sheet's up turned to point back along the motion on screen, as far as the coin is moving
        if (sp > 2) roll = Math.atan2(sx, -sy) * Math.min(1, sp / 12)
        stretch = 1 + Math.min(0.8, sp / 70)
      }
      this.fire.quaternion.copy(cam.quaternion)
      if (roll) this.fire.quaternion.multiply(this.tmpQ.setFromAxisAngle(V3(0, 0, 1), roll))
      const back = flying ? 0.15 : 0.35
      this.fire.position.copy(c).addScaledVector(toCam, -back * RADIUS)
      if (!flying) this.fire.position.y = Math.max(this.fire.position.y, HALF * 0.5)
      const hh = RADIUS * (1.7 + 1.9 * h) * (flying ? 0.62 : 1) * stretch
      const ww = RADIUS * (2.7 + 0.5 * h) * (flying ? 0.7 : 1)
      this.fire.scale.set(ww, hh * grow, 1)
      this.fireMat.uniforms.uK.value = fk * (1 - flat) * (flying ? 0.85 : 1)
      this.fireMat.uniforms.uHeat.value = h
      this.fireMat.uniforms.uHot.value = smooth((this.streak - 9.5) / 1)
      this.fireMat.uniforms.uSpeed.value = flying ? 2.5 : 0
      this.fireMat.uniforms.uTime.value = this.clock
    }
    // embers rise off the rim from the first win
    if (h > 0.06 && Math.random() < dt * (4 + h * 30)) {
      const r = this.rimPoint(Math.random() * Math.PI * 2)
      this.embers.emit(r.x, r.y, r.z, rnd(-0.5, 0.5) + this.vel.x * 0.3, rnd(1.5, 3.5), rnd(-0.5, 0.5) + this.vel.z * 0.3, new THREE.Color(2.2, 0.9, 0.25), rnd(0.07, 0.14), rnd(0.8, 1.6), 0.4, 0.6)
    }
    // the fire's own sound
    if (h > 0.15 && !muted) {
      this.fireOn ??= this.sound.fire()
      this.fireOn?.level(h)
    } else if (this.fireOn && (h <= 0.12 || muted)) {
      this.fireOn.stop()
      this.fireOn = null
    }
  }

  /** the two ribbons of light swirling off opposite points of the rim in the air: fire-coloured on a streak */
  private readonly tp = V3()
  private readonly tq = new THREE.Quaternion()
  private readonly rim = V3()
  private updateTrail() {
    const p = this.play
    const air = !!p && p.pre <= 0 && p.tau < p.f.land + 0.04
    if (!air) {
      if (this.trails[0].live) for (const t of this.trails) t.clear()
      return
    }
    const f = p.f
    const k = clamp01((this.coin.position.y - 0.35) / 0.9) * clamp01(p.tau / 0.06)
    const heat = smooth((this.heat - 0.12) / 0.3)
    // the edges that swing round the flick's axis: the near edge as the coin lay, in the coin's own frame
    const r0 = restQuat(this.rest.face, this.rest.turn)
    this.tq.set(r0[0], r0[1], r0[2], r0[3]).invert()
    this.edgeDir.set(Math.sin(p.phi), 0, Math.cos(p.phi)).applyQuaternion(this.tq)
    // built from the flight itself (known ahead), so the braid is smooth however few frames are drawn
    const len = 0.09
    const M = this.trailPts[0].length
    for (let j = 0; j < M; j++) {
      const t = Math.max(0, p.tau - (len * j) / (M - 1))
      this.poseInto(p, t, this.tp, this.tq)
      for (let side = 0; side < 2; side++) {
        this.rim.copy(this.edgeDir).multiplyScalar(side ? -RADIUS : RADIUS).applyQuaternion(this.tq)
        this.trailPts[side][j].copy(this.tp).add(this.rim)
      }
      this.trailPts[2][j].copy(this.tp)
    }
    const fade = k * (p.tau < f.land ? 1 : 1 - (p.tau - f.land) / 0.04)
    for (let i = 0; i < 3; i++) {
      const tr = this.trails[i]
      tr.mat.uniforms.uK.value = fade * (i === 2 ? 0.4 : 1)
      tr.mat.uniforms.uHeat.value = heat
      tr.mat.uniforms.uTime.value = this.clock
      tr.set(this.trailPts[i], this.camera.position, i === 2 ? RADIUS * (0.36 + heat * 0.2) : 0.055 + heat * 0.04)
    }
  }

  private updateLights(dt: number) {
    const c = this.coin.position
    const t = this.tableMat.uniforms
    t.uCam.value.copy(this.camera.position)
    t.uTime.value = this.clock
    t.uCoin.value.set(c.x, c.z)
    t.uFire.value = this.heat * (0.8 + 0.2 * Math.sin(this.clock * 17) * Math.sin(this.clock * 7.3))
    this.flashK = Math.max(0, this.flashK - dt * 2.2)
    t.uFlash.value = this.flashK
    this.dim = Math.max(0, this.dim - dt * 0.7)
    if (!this.play) this.slowK = Math.max(0, this.slowK - dt * 3)
    t.uDim.value = Math.max(smooth(this.dim), this.slowK * 0.55)
    this.updateShadow()
    // the coin's light: the lamp, seen from the camera
    const L = LAMP.clone().sub(c).normalize().transformDirection(this.camera.matrixWorldInverse)
    this.u.uLight.value.copy(L)
    this.u.uTime.value = this.clock
    this.shine = Math.max(0, this.shine - dt * 0.55)
    this.u.uShine.value = smooth(this.shine)
    this.u.uDull.value = Math.max(0, this.u.uDull.value - dt * 0.45)
    this.coneMat.uniforms.uTime.value = this.clock
    this.coneMat.uniforms.uK.value = 1 - smooth(this.dim) * 0.45
    this.motesMat.uniforms.uTime.value = this.clock
    // the sunburst, the landing ring and the halo
    this.raysK = Math.max(0, this.raysK - dt * 0.35)
    this.raysMat.opacity = smooth(this.raysK) * 0.42
    this.rays.position.set(c.x, 0.006, c.z)
    this.rays.rotation.z += dt * 0.25
    const fk = this.flashK
    this.flashMat.opacity = fk * 0.32
    this.flash.scale.setScalar(2.1 + (1 - fk) * 2.4)
    this.haloK = Math.max(0, this.haloK - dt * 0.6)
    this.haloMat.opacity = smooth(Math.min(1, this.haloK)) * 0.5
    this.haloMat.color.copy(this.haloColor)
    this.halo.position.set(c.x, 0.004, c.z)
    // the jackpot's beams sweep round the coin, fading in and out
    this.beamK = Math.max(0, this.beamK - dt * (this.legend ? 0.1 : 0.14))
    const bk = smooth(Math.min(1, this.beamK * 1.6))
    for (let i = 0; i < this.beams.length; i++) {
      const b = this.beams[i]
      b.m.visible = bk > 0.01
      if (!b.m.visible) continue
      b.a += dt * (0.5 + i * 0.07)
      const top = V3(c.x + Math.sin(b.a) * 8, 18, c.z + Math.cos(b.a) * 8)
      const aim = V3(c.x + Math.sin(b.a * 1.7 + i) * 2.2, 0, c.z + Math.cos(b.a * 1.3 + i) * 2.2)
      b.m.position.copy(top)
      b.m.quaternion.setFromUnitVectors(V3(0, -1, 0), aim.sub(top).normalize())
      b.mat.uniforms.uK.value = bk
      b.mat.uniforms.uTime.value = this.clock
      if (this.legend) b.mat.uniforms.uColor.value.setHSL((this.clock * 0.15 + i / 4) % 1, 0.9, 0.65)
      else b.mat.uniforms.uColor.value.set('#ffd98a')
    }
  }

  /** the coin's shadow on the velvet: its disc cast along the lamp's light, softer and fainter the higher it is */
  private updateShadow() {
    const c = this.coin.position
    const q = this.coin.quaternion
    const L = LAMP.clone().sub(c).normalize()
    const u = V3(1, 0, 0).applyQuaternion(q)
    const w = V3(0, 0, 1).applyQuaternion(q)
    const proj = (v: THREE.Vector3) => v.clone().addScaledVector(L, -v.y / L.y)
    const C = proj(c)
    const a = proj(u)
    const b = proj(w)
    // M = R [a b] in xz; the ellipse is x^T (M M^T)^-1 x <= 1, widened by the coin's thickness
    const R = RADIUS * 1.02
    const t = (HALF * 1.4) ** 2
    const m00 = R * R * (a.x * a.x + b.x * b.x) + t
    const m01 = R * R * (a.x * a.z + b.x * b.z)
    const m11 = R * R * (a.z * a.z + b.z * b.z) + t
    const det = m00 * m11 - m01 * m01
    const T = this.tableMat.uniforms
    T.uShadowC.value.set(C.x, C.z)
    T.uShadowQ.value.set(m11 / det, -m01 / det, m00 / det)
    const hgt = Math.max(0, c.y - HALF)
    T.uShadowSoft.value = 0.08 + Math.min(0.6, hgt * 0.09)
    T.uShadowDark.value = 0.82 * Math.exp(-hgt * 0.16)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    clearTimeout(this.poolTimer)
    this.whirr?.stop()
    this.spinSnd?.stop()
    this.fireOn?.stop()
    const cv = this.renderer.domElement
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerleave', this.onLeave)
    // let a flip in play finish at once, so the screen code can unwind
    const p = this.play
    this.play = null
    if (p) {
      if (!p.revealed) p.cues.result()
      p.done()
    }
    for (const o of this.own) o.dispose()
    // the cached coin geometry, materials and textures (they come back next visit)
    releaseModels()
    glowTexture().dispose()
    ringTexture().dispose()
    new THREE.Sprite().geometry.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}

/* ------------------------------------------------------------------ */
/*  Shaders and textures                                                */
/* ------------------------------------------------------------------ */

const TABLE_FRAG = /* glsl */ `
varying vec3 vW;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uPool;
uniform vec2 uPoolC;
uniform vec2 uCoin;
uniform vec2 uShadowC;
uniform vec3 uShadowQ;
uniform float uShadowSoft;
uniform float uShadowDark;
uniform float uFire;
uniform float uFlash;
uniform float uDim;
uniform float uRail;
${NOISE}
void main() {
  vec2 p = vW.xz;
  float r = length(p - uPoolC);
  // the pool of light: a warm core, a soft edge, then the dark of the table and the room
  float pool = 1.0 - smoothstep(1.2, 6.6, r);
  pool *= pool;
  float core = 1.0 - smoothstep(0.0, 3.6, r);
  // crushed velvet: a slow domain-warped pattern and a fine pile
  vec2 q = p * 0.5 + vec2(fbm(p * 0.3), fbm(p * 0.3 + 7.3)) * 1.6;
  float crush = fbm(q);
  float pile = vnoise(p * 36.0) * 0.6 + vnoise(p * 83.0) * 0.4;
  vec3 V = normalize(uCam - vW);
  float graze = 1.0 - clamp(V.y, 0.0, 1.0);
  // the nap catches the light where it is brushed one way: a sheen that moves with the eye
  float nap = fbm(p * 1.1 + vec2(crush * 2.0, 0.0));
  float sheen = pow(graze, 1.8) * (0.25 + crush * 1.2) + smoothstep(0.55, 0.85, nap) * 0.25 * (0.4 + graze);
  vec3 deep = vec3(0.008, 0.002, 0.012);
  vec3 velvet = vec3(0.17, 0.034, 0.13);
  vec3 col = mix(deep, velvet * uPool, pool * (0.5 + 0.9 * crush));
  col += sheen * vec3(0.32, 0.09, 0.3) * (0.05 + pool * 0.75);
  col *= 0.84 + 0.32 * pile;
  col += core * core * vec3(0.21, 0.095, 0.026) * uPool * (0.6 + 0.8 * crush);
  // the coin's shadow
  vec2 d = p - uShadowC;
  float e = sqrt(max(0.0, uShadowQ.x * d.x * d.x + 2.0 * uShadowQ.y * d.x * d.y + uShadowQ.z * d.y * d.y));
  float sh = 1.0 - smoothstep(1.0 - uShadowSoft, 1.0 + uShadowSoft * 1.6, e);
  col *= 1.0 - sh * uShadowDark;
  // a burning coin lights the velvet round it; a landing flashes
  float fd = length(p - uCoin);
  col += uFire * vec3(1.0, 0.33, 0.07) * 0.22 / (1.0 + fd * fd * 0.7);
  col += uFlash * vec3(1.0, 0.8, 0.45) * 0.2 / (1.0 + fd * fd * 1.4);
  col *= 1.0 - uDim * 0.4;
  // the table ends at its rail; beyond is the dark floor
  float rt = length(p);
  col *= 1.0 - smoothstep(uRail - 1.0, uRail - 0.2, rt) * 0.55;
  col = mix(col, vec3(0.004, 0.001, 0.006), smoothstep(uRail - 0.2, uRail + 0.3, rt));
  gl_FragColor = vec4(col, 1.0);
}`

const BACK_FRAG = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vUv - vec2(0.5, 0.42);
  float d = length(p * vec2(1.0, 1.4));
  vec3 col = mix(vec3(0.05, 0.012, 0.06), vec3(0.008, 0.002, 0.014), smoothstep(0.0, 0.75, d));
  gl_FragColor = vec4(col, 1.0);
}`

const CONE_VERT = 'varying vec3 vN; varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }'
const CONE_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vW;
uniform float uTime;
uniform float uK;
uniform float uGain;
uniform vec3 uColor;
${NOISE}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  float facing = abs(dot(normalize(vN), V));
  float a = pow(facing, 2.4);
  // brighter towards the lamp, gone before it meets the velvet
  a *= smoothstep(0.0, 3.0, vW.y) * (0.45 + 0.55 * smoothstep(0.0, 16.0, vW.y));
  // slow drifting haze in the beam
  a *= 0.6 + 0.6 * fbm(vec2(vW.x * 0.35 + uTime * 0.05, vW.y * 0.22 - uTime * 0.03));
  gl_FragColor = vec4(uColor * a * uGain * uK, 1.0);
}`

const MOTES_VERT = /* glsl */ `
attribute float aPhase;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  vec3 p = position;
  float t = uTime * 0.18 + aPhase;
  p += vec3(sin(t * 1.3) * 0.35, sin(t * 0.7 + aPhase) * 0.5, cos(t * 1.1) * 0.35);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vA = (0.4 + 0.6 * sin(uTime * 1.7 + aPhase * 3.0) * 0.5 + 0.3) * smoothstep(0.5, 3.0, p.y);
  gl_PointSize = 0.07 * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
const MOTES_FRAG = /* glsl */ `
uniform sampler2D map;
varying float vA;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vA;
  gl_FragColor = vec4(vec3(1.0, 0.85, 0.6) * a * 0.9, a);
}`

/** a four-pointed glint: two thin crossed rays and a soft core */
function starTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const core = g.createRadialGradient(64, 64, 0, 64, 64, 22)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = core
  g.fillRect(0, 0, 128, 128)
  for (const [w, h] of [
    [128, 5],
    [5, 128],
  ]) {
    const gr = w > h ? g.createLinearGradient(0, 0, 128, 0) : g.createLinearGradient(0, 0, 0, 128)
    gr.addColorStop(0, 'rgba(255,255,255,0)')
    gr.addColorStop(0.5, 'rgba(255,255,255,1)')
    gr.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = gr
    g.beginPath()
    if (w > h) g.ellipse(64, 64, 64, 3, 0, 0, Math.PI * 2)
    else g.ellipse(64, 64, 3, 64, 0, 0, Math.PI * 2)
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** a soft disc with a brighter rim, like a light far out of focus */
function bokehTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60)
  gr.addColorStop(0, 'rgba(255,255,255,0.35)')
  gr.addColorStop(0.78, 'rgba(255,255,255,0.5)')
  gr.addColorStop(0.92, 'rgba(255,255,255,0.75)')
  gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr
  g.beginPath()
  g.arc(64, 64, 60, 0, Math.PI * 2)
  g.fill()
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function raysTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.translate(128, 128)
  for (let i = 0; i < 18; i++) {
    g.rotate((Math.PI * 2) / 18)
    const grad = g.createLinearGradient(0, 0, 128, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.2, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(128, -12)
    g.lineTo(128, 12)
    g.closePath()
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
