import * as THREE from 'three'
import { glowTexture } from '../../lib/three/fx'

/*
  Reef Raid's particles. Bubbles are toon bubbles (a white ring with a glint, drawn as point sprites with normal
  blending, so they read on the bright sand as well as the deep blue): torpedo trails, muzzle puffs, explosions and
  the streams rising from the reef all come out of one Bubbles pool. Motes are the plankton drifting in the light:
  fixed points the vertex shader sets drifting, so they cost nothing per frame.
*/

let bubbleTex: THREE.CanvasTexture | null = null
/** a toon bubble: a crisp white rim, a faint fill and a glint at the top left */
export function bubbleTexture() {
  if (bubbleTex) return bubbleTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  g.beginPath()
  g.arc(32, 32, 26, 0, Math.PI * 2)
  g.fillStyle = 'rgba(210,245,255,0.22)'
  g.fill()
  g.lineWidth = 5
  g.strokeStyle = 'rgba(255,255,255,0.95)'
  g.stroke()
  g.beginPath()
  g.ellipse(22, 21, 8, 5, -0.7, 0, Math.PI * 2)
  g.fillStyle = 'rgba(255,255,255,1)'
  g.fill()
  bubbleTex = new THREE.CanvasTexture(c)
  bubbleTex.colorSpace = THREE.SRGBColorSpace
  return bubbleTex
}

const BUBBLE_VERT = /* glsl */ `
attribute float size;
attribute float alpha;
uniform float scale;
varying float vAlpha;
void main() {
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
const BUBBLE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 tint;
varying float vAlpha;
void main() {
  vec4 t = texture2D(map, gl_PointCoord);
  gl_FragColor = vec4(t.rgb * tint, t.a * vAlpha);
  #include <colorspace_fragment>
}`

interface Bubble {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  wob: number
  seed: number
}

/**
 * A pool of bubbles. emit() one (world position, velocity, size in world units, life in seconds); every frame
 * update(dt). They rise (towards the camera, growing), wobble and pop when their life runs out. Set the `scale`
 * uniform on resize: (canvas height in device px) / (2 · tan(fov / 2)). The bubbles are a fixed set of records
 * reused over and over (torpedo trails emit every frame), and a full pool recycles a live one.
 */
export class Bubbles {
  readonly points: THREE.Points
  readonly mat: THREE.ShaderMaterial
  private readonly pool: Bubble[]
  private n = 0
  private recycle = 0
  private readonly pos: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly geo = new THREE.BufferGeometry()
  /** what update() marks for upload each frame */
  private readonly attrs: THREE.BufferAttribute[]
  private t = 0

  constructor(private readonly cap: number) {
    this.pool = Array.from({ length: cap }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, wob: 0, seed: 0 }))
    this.pos = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setDrawRange(0, 0)
    this.attrs = ['position', 'size', 'alpha'].map((name) => this.geo.getAttribute(name) as THREE.BufferAttribute)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: bubbleTexture() }, scale: { value: 500 }, tint: { value: new THREE.Color(1, 1, 1) } },
      vertexShader: BUBBLE_VERT,
      fragmentShader: BUBBLE_FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 6
  }

  /** a bubble; `wob` is how far it wanders side to side as it rises */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, wob = 0.15) {
    const b = this.n < this.cap ? this.pool[this.n++] : this.pool[this.recycle++ % this.cap]
    b.x = x
    b.y = y
    b.z = z
    b.vx = vx
    b.vy = vy
    b.vz = vz
    b.life = b.max = life
    b.size = size
    b.wob = wob
    b.seed = Math.random() * 100
  }

  /** a puff of `n` bubbles bursting out of a point */
  burst(x: number, y: number, z: number, n: number, speed: number, size = 0.12, life = 1.1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.7)
      this.emit(x, y, z, Math.cos(a) * s, 0.6 + Math.random() * speed * 0.5, Math.sin(a) * s, size * (0.5 + Math.random()), life * (0.6 + Math.random() * 0.6))
    }
  }

  update(dt: number) {
    this.t += dt
    const P = this.pool
    let n = 0
    for (let i = 0; i < this.n; i++) {
      const b = P[i]
      b.life -= dt
      if (b.life <= 0) continue
      // water drag on the burst, buoyancy lifting it
      const k = Math.max(0, 1 - 2.5 * dt)
      b.vx *= k
      b.vz *= k
      b.vy = b.vy * Math.max(0, 1 - 0.8 * dt) + 1.6 * dt
      b.x += b.vx * dt
      b.y += b.vy * dt
      b.z += b.vz * dt
      const f = b.life / b.max
      const w = Math.sin(this.t * 5 + b.seed) * b.wob
      // keep the live ones at the front, swapping the record rather than dropping it
      P[i] = P[n]
      P[n++] = b
      const j = n - 1
      this.pos[j * 3] = b.x + w
      this.pos[j * 3 + 1] = b.y
      this.pos[j * 3 + 2] = b.z + Math.cos(this.t * 4 + b.seed) * b.wob * 0.5
      this.size[j] = b.size * (1 + (1 - f) * 0.35)
      this.alpha[j] = Math.min(1, f * 4, (1 - f) * 12)
    }
    this.n = n
    this.geo.setDrawRange(0, n)
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true
  }

  /** every bubble gone at once */
  clear() {
    this.n = 0
    this.geo.setDrawRange(0, 0)
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float scale;
varying float vAlpha;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.21 + seed.x) * 0.6, sin(uTime * 0.17 + seed.y) * 0.25, cos(uTime * 0.19 + seed.z) * 0.6);
  vAlpha = (0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.3 + seed.w * 6.0))) * seed.w;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (0.05 + 0.05 * seed.w) * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
const MOTE_FRAG = /* glsl */ `
uniform sampler2D map;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(vec3(0.85, 1.0, 0.95), texture2D(map, gl_PointCoord).a * vAlpha * 0.8);
}`

/** plankton motes drifting through a box (min, max), twinkling in the light; tick the `uTime` uniform */
export function buildMotes(count: number, min: THREE.Vector3, max: THREE.Vector3) {
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    pos.set([min.x + Math.random() * (max.x - min.x), min.y + Math.random() * (max.y - min.y), min.z + Math.random() * (max.z - min.z)], i * 3)
    seed.set([Math.random() * 100, Math.random() * 100, Math.random() * 100, 0.3 + Math.random() * 0.7], i * 4)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('seed', new THREE.BufferAttribute(seed, 4))
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: glowTexture() }, uTime: { value: 0 }, scale: { value: 500 } },
    vertexShader: MOTE_VERT,
    fragmentShader: MOTE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const pts = new THREE.Points(g, mat)
  pts.frustumCulled = false
  pts.renderOrder = 5
  return pts
}
