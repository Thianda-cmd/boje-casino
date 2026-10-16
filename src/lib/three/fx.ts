import * as THREE from 'three'

/*
  Effects shared by the 3D games: additive glowing points (sparks, flashes, trails), tumbling instanced
  solids (shards, coins, crumbs), the soft glow texture they use, and rounded-rectangle outlines.
*/

export const rnd = (a: number, b: number) => a + Math.random() * (b - a)
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)

let glowTex: THREE.CanvasTexture | null = null
/** A soft round glow, used for halos and sparkles. */
/** a soft round dot, white, for sprites and points */
export function glowTexture() {
  if (glowTex) return glowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.6, 'rgba(255,255,255,0.12)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  glowTex = new THREE.CanvasTexture(c)
  return glowTex
}

/* ------------------------------------------------------------------ */
/*  Glowing points: sparks, flashes and comet trails                    */
/* ------------------------------------------------------------------ */

interface Spark {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  size: number
  r: number
  g: number
  b: number
  grav: number
  drag: number
  grow: number
}

const POINT_VERT = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float scale;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vTint = tint;
  vAlpha = alpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
export const POINT_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec3 vTint;
varying float vAlpha;
void main() {
  float a = texture2D(map, gl_PointCoord).a * vAlpha;
  gl_FragColor = vec4(vTint, a);
}`

export class Sparks {
  readonly points: THREE.Points
  readonly list: Spark[] = []
  private readonly pos: Float32Array
  private readonly tint: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly geo: THREE.BufferGeometry
  readonly mat: THREE.ShaderMaterial

  constructor(private readonly cap: number) {
    this.pos = new Float32Array(cap * 3)
    this.tint = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    this.geo = new THREE.BufferGeometry()
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 400 } },
      vertexShader: POINT_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 10
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, c: THREE.Color, size: number, life: number, grav = 0, drag = 0, grow = 0) {
    if (this.list.length >= this.cap) this.list.shift()
    this.list.push({ x, y, z, vx, vy, vz, life, max: life, size, r: c.r, g: c.g, b: c.b, grav, drag, grow })
  }

  /** a ring of sparks flying out from a point */
  burst(p: THREE.Vector3, c: THREE.Color, n: number, speed: number, size = 0.22, life = 0.7) {
    const hot = c.clone().multiplyScalar(2.2)
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = speed * rnd(0.35, 1)
      this.emit(p.x, p.y, p.z, Math.cos(a) * s, Math.sin(a) * s + 0.6, rnd(-1, 2), i % 3 ? hot : WHITE_HOT, size * rnd(0.5, 1.2), life * rnd(0.6, 1.1), -3.5, 2.2)
    }
  }

  update(dt: number) {
    const L = this.list
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const s = L[i]
      s.life -= dt
      if (s.life <= 0) continue
      const k = Math.max(0, 1 - s.drag * dt)
      s.vx *= k
      s.vy = s.vy * k + s.grav * dt
      s.vz *= k
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.z += s.vz * dt
      const f = s.life / s.max
      L[n++] = s
      const j = n - 1
      this.pos[j * 3] = s.x
      this.pos[j * 3 + 1] = s.y
      this.pos[j * 3 + 2] = s.z
      this.tint[j * 3] = s.r
      this.tint[j * 3 + 1] = s.g
      this.tint[j * 3 + 2] = s.b
      this.size[j] = s.size * (1 + s.grow * (1 - f))
      this.alpha[j] = Math.min(1, f * 2.2) * (s.grow ? f : 1)
    }
    L.length = n
    this.geo.setDrawRange(0, n)
    for (const name of ['position', 'tint', 'size', 'alpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

export const WHITE_HOT = new THREE.Color(2.4, 2.4, 2.4)

/* ------------------------------------------------------------------ */
/*  Tumbling solids: gem shards and falling coins                       */
/* ------------------------------------------------------------------ */

interface Bit {
  p: THREE.Vector3
  v: THREE.Vector3
  q: THREE.Quaternion
  axis: THREE.Vector3
  spin: number
  scale: number
  life: number
  max: number
  grav: number
  color: THREE.Color
}

export class Bits {
  readonly mesh: THREE.InstancedMesh
  readonly list: Bit[] = []
  private readonly m = new THREE.Matrix4()
  private readonly dq = new THREE.Quaternion()
  private readonly sv = new THREE.Vector3()

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    private readonly cap: number,
    private readonly shrink: boolean,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, color: THREE.Color, scale: number, life: number, grav: number, spin = rnd(4, 12)) {
    if (this.list.length >= this.cap) this.list.shift()
    const axis = new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize()
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize(), rnd(0, Math.PI * 2))
    this.list.push({ p: p.clone(), v, q, axis, spin, scale, life, max: life, grav, color })
  }

  update(dt: number) {
    const L = this.list
    let n = 0
    for (let i = 0; i < L.length; i++) {
      const b = L[i]
      b.life -= dt
      if (b.life <= 0) continue
      b.v.y += b.grav * dt
      b.p.addScaledVector(b.v, dt)
      this.dq.setFromAxisAngle(b.axis, b.spin * dt)
      b.q.premultiply(this.dq)
      const f = b.life / b.max
      const s = b.scale * (this.shrink ? Math.min(1, f * 3) : 1)
      this.sv.set(s, s, s)
      this.m.compose(b.p, b.q, this.sv)
      L[n++] = b
      this.mesh.setMatrixAt(n - 1, this.m)
      this.mesh.setColorAt(n - 1, b.color)
    }
    L.length = n
    this.mesh.count = n
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

export function roundRect(hw: number, hh: number, r: number, path: THREE.Path = new THREE.Shape()) {
  path.moveTo(-hw + r, -hh)
  path.lineTo(hw - r, -hh)
  path.quadraticCurveTo(hw, -hh, hw, -hh + r)
  path.lineTo(hw, hh - r)
  path.quadraticCurveTo(hw, hh, hw - r, hh)
  path.lineTo(-hw + r, hh)
  path.quadraticCurveTo(-hw, hh, -hw, hh - r)
  path.lineTo(-hw, -hh + r)
  path.quadraticCurveTo(-hw, -hh, -hw + r, -hh)
  return path
}

export function ring(ow: number, oh: number, or: number, iw: number, ih: number, ir: number) {
  const s = roundRect(ow, oh, or) as THREE.Shape
  s.holes.push(roundRect(iw, ih, ir, new THREE.Path()))
  return s
}


/* ------------------------------------------------------------------ */

/**
 * Keeps a 3D scene smooth on slower devices. While the scene draws every frame it watches the time between frames,
 * steps the render resolution down when frames run long, and creeps back up (never to a level that was too slow)
 * when there is headroom; `q` multiplies the device pixel ratio. It judges each window of 40 frames by its median
 * gap, so a GC pause or a late shader compile costs no resolution. And when two steps down in a row buy no faster
 * frames, the gap is not the GPU's doing but a cap (iOS Low Power Mode or a browser's energy saver: 30 Hz) or the
 * CPU: it gives the resolution back and from then on judges against the gap it gets anyway.
 */
export class PacedQuality {
  q = 1
  private ceil = 1
  private prev = 0
  private n = 0
  private readonly gaps = new Float32Array(40)
  private good = 0
  /** the frame gap the browser delivers whatever the resolution, once a run of steps down has shown it; 0 until then */
  private cadence = 0
  /** during a run of steps down: the median gap before it, the q to go back to, and how many steps bought nothing */
  private before = 0
  private restoreTo = 1
  private noGain = 0
  constructor(private readonly min = 0.5) {}

  /** Call on every drawn frame with the frame timestamp; `chained` says the frame before was drawn too.
   *  Returns true when `q` changed. */
  frame(now: number, chained: boolean) {
    const gap = now - this.prev
    this.prev = now
    if (!chained || gap > 1000 || document.hidden) return false
    this.gaps[this.n] = gap
    if (++this.n < this.gaps.length) return false
    this.n = 0
    const med = this.gaps.slice().sort()[this.gaps.length >> 1]
    const slow = this.cadence ? med > this.cadence * 1.35 : med > 23
    if (slow && (this.q > this.min || this.before)) {
      if (!this.before || med < this.before * 0.9) {
        // the first step of a run, or the last step helped: carry on from here
        this.before = med
        this.restoreTo = this.q
        this.noGain = 0
      } else if (++this.noGain >= 2 || this.q <= this.min) {
        // fewer pixels made frames no faster: give them back, and take the gap as the cadence from now on
        this.cadence = this.before
        this.q = this.ceil = this.restoreTo
        this.before = this.noGain = this.good = 0
        return true
      }
      this.ceil = this.q
      this.q = Math.max(this.min, this.q * 0.78)
      this.good = 0
      return true
    }
    this.before = this.noGain = 0
    if (med < (this.cadence ? this.cadence * 1.1 : 18.5) && this.q < this.ceil * 0.9) {
      if (++this.good < 6) return false
      this.good = 0
      this.q = Math.min(this.ceil * 0.9, this.q * 1.12)
      return true
    }
    this.good = 0
    return false
  }
}

let ringTex: THREE.CanvasTexture | null = null
/** a soft white ring (inner radius 0.72, outer 0.92 of the half size), for ring bursts */
export function ringTexture() {
  if (ringTex) return ringTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0.68, 'rgba(255,255,255,0)')
  grad.addColorStop(0.76, 'rgba(255,255,255,1)')
  grad.addColorStop(0.88, 'rgba(255,255,255,1)')
  grad.addColorStop(0.96, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  ringTex = new THREE.CanvasTexture(c)
  return ringTex
}
