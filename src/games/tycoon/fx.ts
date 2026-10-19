import * as THREE from 'three'
import { glowTexture } from '../../lib/three/fx'
import { toonMaterial } from './models'

/*
  The floor's little effects, from fixed pools so nothing is allocated as they play: Tumblers (instanced solids that
  fly, tumble and shrink away: the coins that pop out of an attraction when it pays, confetti) and Glints (additive
  glowing points: sparkles and twinkles). Each has emit(), update(dt) once a frame and dispose().
*/

const _m = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()
const _a = new THREE.Vector3()
const _c = new THREE.Color()

/** up to `cap` copies of `geo` flying under gravity, tumbling, shrinking away at the end of their lives */
export class Tumblers {
  readonly mesh: THREE.InstancedMesh
  private n = 0
  private readonly st: Float32Array
  private readonly col: Float32Array
  /** per piece: x y z, vx vy vz, life, max, scale, spin, axis x y z, drag */
  private static readonly W = 14

  constructor(
    geo: THREE.BufferGeometry,
    readonly cap: number,
    private readonly grav = -14,
    /** the floor they land on (a bounce, then they lie there until they fade) */
    private readonly floor = 0.08,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, toonMaterial(), cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.st = new Float32Array(cap * Tumblers.W)
    this.col = new Float32Array(cap * 3).fill(1)
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, scale = 1, color?: THREE.Color, drag = 0) {
    // full: the oldest piece makes room
    let i = this.n
    if (i >= this.cap) {
      let oldest = 0
      for (let k = 1; k < this.n; k++) if (this.st[k * Tumblers.W + 6] < this.st[oldest * Tumblers.W + 6]) oldest = k
      i = oldest
    } else this.n++
    const s = this.st
    const o = i * Tumblers.W
    s[o] = x
    s[o + 1] = y
    s[o + 2] = z
    s[o + 3] = vx
    s[o + 4] = vy
    s[o + 5] = vz
    s[o + 6] = life
    s[o + 7] = life
    s[o + 8] = scale
    s[o + 9] = 4 + Math.random() * 9
    _a.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize()
    s[o + 10] = _a.x
    s[o + 11] = _a.y
    s[o + 12] = _a.z
    s[o + 13] = drag
    this.col[i * 3] = color ? color.r : 1
    this.col[i * 3 + 1] = color ? color.g : 1
    this.col[i * 3 + 2] = color ? color.b : 1
  }

  update(dt: number) {
    const s = this.st
    const W = Tumblers.W
    let live = 0
    for (let i = 0; i < this.n; i++) {
      const o = i * W
      s[o + 6] -= dt
      if (s[o + 6] <= 0) continue
      // pack the live ones to the front
      if (live !== i) {
        s.copyWithin(live * W, o, o + W)
        this.col.copyWithin(live * 3, i * 3, i * 3 + 3)
      }
      const p = live * W
      const k = Math.max(0, 1 - s[p + 13] * dt)
      s[p + 3] *= k
      s[p + 5] *= k
      s[p + 4] = s[p + 4] * k + this.grav * dt
      s[p] += s[p + 3] * dt
      s[p + 1] += s[p + 4] * dt
      s[p + 2] += s[p + 5] * dt
      if (s[p + 1] < this.floor && s[p + 4] < 0) {
        s[p + 1] = this.floor
        s[p + 4] = s[p + 4] < -2.5 ? -s[p + 4] * 0.35 : 0
        s[p + 3] *= 0.5
        s[p + 5] *= 0.5
        s[p + 9] *= 0.5
      }
      const age = s[p + 7] - s[p + 6]
      const f = s[p + 6] / s[p + 7]
      const sc = s[p + 8] * Math.min(1, f * 4) * Math.min(1, age * 12 + 0.3)
      _q.setFromAxisAngle(_a.set(s[p + 10], s[p + 11], s[p + 12]), s[p + 9] * age)
      this.mesh.setMatrixAt(live, _m.compose(_p.set(s[p], s[p + 1], s[p + 2]), _q, _s.set(sc, sc, sc)))
      this.mesh.setColorAt(live, _c.setRGB(this.col[live * 3], this.col[live * 3 + 1], this.col[live * 3 + 2]))
      live++
    }
    this.n = live
    this.mesh.count = live
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  clear() {
    this.n = 0
    this.mesh.count = 0
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
  }
}

const GLINT_VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float uScale;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vTint = tint;
  vAlpha = alpha;
  gl_PointSize = size * uScale;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const GLINT_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec3 vTint;
varying float vAlpha;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha;
  gl_FragColor = vec4(vTint * a, a);
}`

/** additive glowing points (`size` world units across): sparkles that fly, fall and fade */
export class Glints {
  readonly points: THREE.Points
  private n = 0
  private readonly pos: Float32Array
  private readonly tint: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  /** per glint: vx vy vz, life, max, grav, drag, size */
  private readonly st: Float32Array
  private readonly geo = new THREE.BufferGeometry()
  private readonly attrs: THREE.BufferAttribute[]
  readonly mat: THREE.ShaderMaterial

  constructor(readonly cap: number) {
    this.pos = new Float32Array(cap * 3)
    this.tint = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    this.st = new Float32Array(cap * 8)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.attrs = ['position', 'tint', 'size', 'alpha'].map((n) => this.geo.getAttribute(n) as THREE.BufferAttribute)
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, uScale: { value: 20 } },
      vertexShader: GLINT_VERT,
      fragmentShader: GLINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number, grav = 0, drag = 0) {
    const i = this.n < this.cap ? this.n++ : Math.floor(Math.random() * this.cap)
    this.pos[i * 3] = x
    this.pos[i * 3 + 1] = y
    this.pos[i * 3 + 2] = z
    this.tint[i * 3] = c.r
    this.tint[i * 3 + 1] = c.g
    this.tint[i * 3 + 2] = c.b
    const o = i * 8
    this.st[o] = vx
    this.st[o + 1] = vy
    this.st[o + 2] = vz
    this.st[o + 3] = life
    this.st[o + 4] = life
    this.st[o + 5] = grav
    this.st[o + 6] = drag
    this.st[o + 7] = size
  }

  /** a puff of sparkles flying out from a point */
  burst(x: number, y: number, z: number, c: THREE.Color, n: number, speed: number, size = 0.35, life = 0.8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const up = Math.random()
      const sp = speed * (0.35 + Math.random() * 0.65)
      this.emit(x, y, z, Math.cos(a) * sp, sp * (0.4 + up), Math.sin(a) * sp, c, size * (0.6 + Math.random() * 0.7), life * (0.6 + Math.random() * 0.6), -4, 2)
    }
  }

  update(dt: number) {
    let live = 0
    for (let i = 0; i < this.n; i++) {
      const o = i * 8
      this.st[o + 3] -= dt
      if (this.st[o + 3] <= 0) continue
      if (live !== i) {
        this.st.copyWithin(live * 8, o, o + 8)
        this.pos.copyWithin(live * 3, i * 3, i * 3 + 3)
        this.tint.copyWithin(live * 3, i * 3, i * 3 + 3)
      }
      const s = live * 8
      const k = Math.max(0, 1 - this.st[s + 6] * dt)
      this.st[s] *= k
      this.st[s + 2] *= k
      this.st[s + 1] = this.st[s + 1] * k + this.st[s + 5] * dt
      this.pos[live * 3] += this.st[s] * dt
      this.pos[live * 3 + 1] += this.st[s + 1] * dt
      this.pos[live * 3 + 2] += this.st[s + 2] * dt
      const f = this.st[s + 3] / this.st[s + 4]
      this.size[live] = this.st[s + 7] * (0.4 + 0.6 * f)
      this.alpha[live] = Math.min(1, f * 2.5)
      live++
    }
    this.n = live
    this.geo.setDrawRange(0, live)
    for (let i = 0; i < this.attrs.length; i++) this.attrs[i].needsUpdate = true
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
