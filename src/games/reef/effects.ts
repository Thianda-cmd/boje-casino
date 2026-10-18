import * as THREE from 'three'
import { glowTexture } from '../../lib/three/fx'
import { gearMaterial } from './gear'
import { disposeSway, swayMesh } from './cast'
import { C, INK, RKit, TAU, V, ell } from './kit'

/*
  The big moments' effects, toon style (crisp bands and ink, not soft glow):

  - Rings: the shockwave of the bomb crab's blast (and any catch's splash): a ring lying in the swim plane that races
    out, white with a cyan edge, thinning as it goes.
  - Booms: a cartoon explosion, a cluster of puffy balls (white-hot core, yellow, orange) with ink outlines that the
    scene swells and shrinks away; or, in white and pale aqua, the poof a big catch vanishes in.
  - Bolts: lightning for the zap jelly's chain: jagged ribbons facing the camera, a pale core in an electric blue
    edge inside an ink outline, flickering to new shapes many times a second, with little side forks.
  - Splats: textured quads lying flat (a soft shadow on the sand under each creature, a glow under a special).
  - Streaks: cartoon swoosh lines racing across the reef when a tide sweeps through, and the tapered wake behind
    each torpedo.
  - The reticle: the lock-on marker that sits on a locked creature.
  Each is begin(), put() per item, end() a frame (Bolts: set and update), drawn in one call.
*/

/* ---------------- rings ---------------- */

const RING_VERT = /* glsl */ `
attribute vec2 iRing;
varying vec2 vUv;
varying vec2 vRing;
void main() {
  vUv = uv * 2.0 - 1.0;
  vRing = iRing;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`
const RING_FRAG = /* glsl */ `
uniform vec3 uCore;
uniform vec3 uEdge;
uniform vec3 uInk;
varying vec2 vUv;
varying vec2 vRing;
void main() {
  // vRing.x: how far out (0..1), vRing.y: its strength
  float t = vRing.x;
  float r = length(vUv);
  float R = 0.15 + 0.85 * (1.0 - pow(1.0 - t, 2.4));
  float w = mix(0.1, 0.03, t);
  float d = abs(r - R);
  if (d > w + 0.03) discard;
  vec3 col = d < w * 0.45 ? uCore : d < w ? uEdge : uInk;
  float a = (1.0 - smoothstep(0.6, 1.0, t)) * vRing.y;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`

/** shockwave rings in the swim plane: put(world x, y, z, full radius, progress 0..1, strength 0..1) */
export class Rings {
  readonly mesh: THREE.InstancedMesh
  private readonly mat: THREE.ShaderMaterial
  private readonly ring: THREE.InstancedBufferAttribute
  private readonly m = new THREE.Matrix4()
  private n = 0

  constructor(private readonly cap = 16) {
    const g = new THREE.PlaneGeometry(2, 2)
    g.rotateX(-Math.PI / 2)
    this.ring = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iRing', this.ring)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uCore: { value: C('#ffffff', 1.25) }, uEdge: { value: C('#8ff3ff') }, uInk: { value: C('#1b5f86') } },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
    })
    this.mesh = new THREE.InstancedMesh(g, this.mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
    this.mesh.count = 0
  }

  begin() {
    this.n = 0
  }

  put(x: number, y: number, z: number, radius: number, t: number, strength = 1) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.m.makeScale(radius, 1, radius).setPosition(x, y, z)
    this.mesh.setMatrixAt(i, this.m)
    this.ring.setXY(i, t, strength)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.ring.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.mat.dispose()
  }
}

/* ---------------- booms ---------------- */

const UP = V(0, 1, 0)
type BoomLook = 'boom' | 'puff'
/** a boom's colours, toon lit; a poof's, flat (a cartoon cloud is paper white, pale blue in its folds) */
const PALETTE: Record<BoomLook, { ring: [string, string]; inner: string; heart: THREE.Color; flat: boolean }> = {
  boom: { ring: ['#ff8a2a', '#ffb02e'], inner: '#ffd84a', heart: C('#fff6d0', 1.4), flat: false },
  puff: { ring: ['#ffffff', '#d6f1ff'], inner: '#ffffff', heart: C('#ffffff', 1.1), flat: true },
}
const boomGeos: Partial<Record<BoomLook, THREE.BufferGeometry>> = {}
/** a cartoon cloud about one unit across, inked: puffs round a white-hot heart (a boom) or all white (a poof) */
function boomGeometry(look: BoomLook) {
  const done = boomGeos[look]
  if (done) return done
  const pal = PALETTE[look]
  const k = new RKit(INK, 0.03)
  const puffs: [number, number, number, number, string][] = []
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU
    puffs.push([Math.cos(a) * 0.36, 0.05 + Math.sin(i * 2.3) * 0.08, Math.sin(a) * 0.36, 0.2 + (i % 3) * 0.04, pal.ring[i % 2]])
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.4
    puffs.push([Math.cos(a) * 0.18, 0.2, Math.sin(a) * 0.18, 0.2, pal.inner])
  }
  for (const [x, y, z, r, c] of puffs) ell(k, { c: [x, y, z], r: [r, r, r] }, c, [12, 9], undefined, [0, 0, 0], { flat: pal.flat })
  ell(k, { c: [0, 0.28, 0], r: [0.24, 0.2, 0.24] }, pal.heart, [14, 10], undefined, [0, 0, 0], { flat: true })
  const g = k.bake((p, _n, _tag, m) => {
    // the puffs churn as it swells
    m.w1.set(p.x * 0.08, 0.04, p.z * 0.08, Math.atan2(p.z, p.x) * 2 + p.y * 6)
  })
  boomGeos[look] = g
  return g
}

/**
 * Cartoon explosions (or poofs): put(world x, y, z, size, progress 0..1). They pop out past full size, swell a little
 * more, then shrink away whole (dissolving, their ink outlines would leave dark flecks over the reef).
 */
export class Booms {
  readonly mesh: THREE.InstancedMesh
  private readonly s: ReturnType<typeof swayMesh>
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private n = 0

  constructor(
    private readonly cap = 8,
    look: BoomLook = 'boom',
  ) {
    this.s = swayMesh(boomGeometry(look), gearMaterial(), cap)
    this.mesh = this.s.mesh
    this.mesh.count = 0
    this.mesh.renderOrder = 9
  }

  begin() {
    this.n = 0
  }

  put(x: number, y: number, z: number, size: number, t: number) {
    if (this.n >= this.cap) return
    const i = this.n++
    // a pop that overshoots, a slow swell, then it shrinks to nothing
    const grow = t < 0.18 ? (t / 0.18) * 1.15 : t < 0.55 ? 1.15 + (t - 0.18) * 0.2 : 1.22 * (1 - ((t - 0.55) / 0.45) ** 2)
    this.q.setFromAxisAngle(UP, t * 1.5)
    this.m.compose(this.p.set(x, y, z), this.q, this.sc.setScalar(size * Math.max(1e-3, grow)))
    this.mesh.setMatrixAt(i, this.m)
    this.s.anim.setXYZW(i, t * 6, 0, 0, 0)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.s.anim.needsUpdate = true
  }

  dispose() {
    disposeSway(this.mesh)
  }
}

/* ---------------- lightning ---------------- */

const BOLT_SEGS = 10
const FORKS = 2
const FORK_SEGS = 3
/** points per bolt: the main zigzag and its forks, each a ribbon of quads */
const QUADS = BOLT_SEGS + FORKS * FORK_SEGS

/**
 * Lightning bolts between points. set(i, a, b, strength) a bolt (strength 0 hides it), update(dt) once a frame:
 * the zigzags re-roll ~20 times a second. `view` is the direction towards the camera, so the ribbons face it. Three
 * ribbons per bolt, widest first: the ink outline, the blue edge, the pale core.
 */
export class Bolts {
  readonly group = new THREE.Group()
  private readonly layers: { geo: THREE.BufferGeometry; pos: Float32Array; mat: THREE.MeshBasicMaterial; width: number }[]
  private readonly bolts: { a: THREE.Vector3; b: THREE.Vector3; k: number; seed: number }[]
  private clock = 0
  private roll = 0
  private readonly tmp = { d: V(), side: V(), p: V(), q: V(), j: V() }

  constructor(
    cap = 8,
    private readonly view = V(0, 0.9, 0.44).normalize(),
  ) {
    this.bolts = Array.from({ length: cap }, () => ({ a: V(), b: V(), k: 0, seed: Math.random() * 100 }))
    const verts = cap * QUADS * 6
    const layer = (color: THREE.Color, width: number, order: number) => {
      const pos = new Float32Array(verts * 3)
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage))
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.frustumCulled = false
      mesh.renderOrder = order
      this.group.add(mesh)
      return { geo, pos, mat, width }
    }
    this.layers = [layer(C(INK), 1.45, 10), layer(C('#2f8cff'), 1, 11), layer(C('#f6ffd8', 1.6), 0.42, 12)]
  }

  /** bolt i from a to b at strength k (0 hides it; it also sets how wide it flares) */
  set(i: number, a: THREE.Vector3, b: THREE.Vector3, k: number) {
    const bo = this.bolts[i]
    if (!bo) return
    bo.a.copy(a)
    bo.b.copy(b)
    bo.k = k
  }

  clear() {
    for (const b of this.bolts) b.k = 0
  }

  update(dt: number) {
    this.clock += dt
    if (this.clock - this.roll > 0.05) {
      this.roll = this.clock
      for (let i = 0; i < this.bolts.length; i++) this.bolts[i].seed = Math.random() * 1000
    }
    let n = 0
    for (let bi = 0; bi < this.bolts.length; bi++) {
      const b = this.bolts[bi]
      if (b.k <= 0) continue
      n = this.ribbon(b, n)
    }
    for (const l of this.layers) {
      l.geo.setDrawRange(0, n * 6)
      l.geo.getAttribute('position').needsUpdate = true
    }
  }

  /** a repeatable jitter in -0.5..0.5 for point i of a bolt with this seed */
  private rand(seed: number, i: number) {
    const s = Math.sin(seed + i * 12.9898) * 43758.5453
    return s - Math.floor(s) - 0.5
  }

  /** the point t of the way along bolt b, jittered sideways (d: its span, len: its length), into out */
  private at(b: { a: THREE.Vector3; seed: number }, len: number, t: number, out: THREE.Vector3, i: number) {
    const { d, side } = this.tmp
    out.copy(b.a).addScaledVector(d, t)
    return out.addScaledVector(side, this.rand(b.seed, i) * Math.sin(t * Math.PI) * len * 0.24)
  }

  /** writes one bolt's quads from quad index n; returns the next free index */
  private ribbon(b: { a: THREE.Vector3; b: THREE.Vector3; k: number; seed: number }, n: number) {
    const { d, side, p, q, j } = this.tmp
    d.subVectors(b.b, b.a)
    const len = d.length()
    side.crossVectors(d, this.view).normalize()
    const w = 0.2 * b.k
    // the main zigzag
    for (let i = 0; i < BOLT_SEGS; i++) {
      this.at(b, len, i / BOLT_SEGS, p, i)
      this.at(b, len, (i + 1) / BOLT_SEGS, q, i + 1)
      if (i === 0) p.copy(b.a)
      if (i === BOLT_SEGS - 1) q.copy(b.b)
      this.quad(n++, p, q, w)
    }
    // forks off the middle
    for (let f = 0; f < FORKS; f++) {
      const t0 = 0.3 + 0.35 * f + this.rand(b.seed, 50 + f) * 0.1
      this.at(b, len, t0, p, 60 + f)
      j.copy(d).normalize().multiplyScalar(len * 0.07).addScaledVector(side, (f ? 1 : -1) * len * 0.09)
      for (let s = 0; s < FORK_SEGS; s++) {
        q.copy(p).add(j).addScaledVector(side, this.rand(b.seed, 70 + f * 9 + s) * len * 0.05)
        this.quad(n++, p, q, w * 0.55 * (1 - s / FORK_SEGS))
        p.copy(q)
      }
    }
    return n
  }

  private quad(n: number, a: THREE.Vector3, b: THREE.Vector3, w: number) {
    for (const l of this.layers) this.write(l.pos, n, a, b, w * l.width)
  }

  /** quad n of a ribbon from a to b, half width ww, as two triangles (a-, b-, b+ and a-, b+, a+) */
  private write(arr: Float32Array, n: number, a: THREE.Vector3, b: THREE.Vector3, ww: number) {
    const { side } = this.tmp
    const o = n * 18
    for (let k = 0; k < 3; k++) {
      const s = (k === 0 ? side.x : k === 1 ? side.y : side.z) * ww
      const ak = k === 0 ? a.x : k === 1 ? a.y : a.z
      const bk = k === 0 ? b.x : k === 1 ? b.y : b.z
      arr[o + k] = ak - s
      arr[o + 3 + k] = bk - s
      arr[o + 6 + k] = bk + s
      arr[o + 9 + k] = ak - s
      arr[o + 12 + k] = bk + s
      arr[o + 15 + k] = ak + s
    }
  }

  dispose() {
    for (const l of this.layers) {
      l.geo.dispose()
      l.mat.dispose()
    }
  }
}

/* ---------------- splats: shadows and glows on the floor ---------------- */

/**
 * Soft round quads lying flat: put(world x, y, z, size across, size along, turn, colour, opacity). `glow` adds light
 * (glows under specials); otherwise they darken (shadows on the sand). renderOrder puts glows over the reef, under the
 * cast.
 */
export class Splats {
  readonly mesh: THREE.InstancedMesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly alpha: THREE.InstancedBufferAttribute
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private readonly c = new THREE.Color()
  private n = 0

  constructor(
    private readonly cap: number,
    glow: boolean,
  ) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iAlpha', this.alpha)
    this.mat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: glow ? THREE.AdditiveBlending : THREE.NormalBlending })
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = iAlpha;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\noutgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>')
    }
    this.mat.customProgramCacheKey = () => 'reef-splat'
    this.mesh = new THREE.InstancedMesh(g, this.mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = glow ? 3 : 1
    this.mesh.count = 0
  }

  begin() {
    this.n = 0
  }

  put(x: number, y: number, z: number, w: number, h: number, turn: number, color: THREE.ColorRepresentation, alpha: number) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, turn, 0)), this.s.set(w, 1, h))
    this.mesh.setMatrixAt(i, this.m)
    this.mesh.setColorAt(i, this.c.set(color))
    this.alpha.setX(i, alpha)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.mat.dispose()
  }
}

/* ---------------- streaks: the tide's swoosh lines ---------------- */

let streakTex: THREE.CanvasTexture | null = null
/** a swoosh: a stroke tapering from a round head (right) to a fine tail, fading out behind */
function streakTexture() {
  if (streakTex) return streakTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  const line = (y0: number, thick: number, bow: number, alpha: number) => {
    const top: [number, number][] = []
    const bot: [number, number][] = []
    for (let i = 0; i <= 32; i++) {
      const u = i / 32
      const x = 8 + u * 236
      const y = y0 - Math.sin(u * Math.PI) * bow
      const w = thick * Math.pow(u, 0.8) * (u > 0.94 ? Math.sqrt(Math.max(0, 1 - ((u - 0.94) / 0.06) ** 2)) : 1)
      top.push([x, y - w])
      bot.push([x, y + w])
    }
    g.beginPath()
    top.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    bot.reverse().forEach(([x, y]) => g.lineTo(x, y))
    g.closePath()
    const grad = g.createLinearGradient(8, 0, 244, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.55, `rgba(235,252,255,${alpha * 0.6})`)
    grad.addColorStop(1, `rgba(255,255,255,${alpha})`)
    g.fillStyle = grad
    g.fill()
  }
  line(30, 7, 8, 1)
  line(48, 3.5, 4, 0.75)
  streakTex = new THREE.CanvasTexture(c)
  streakTex.colorSpace = THREE.SRGBColorSpace
  return streakTex
}

let wakeTex: THREE.CanvasTexture | null = null
/** a torpedo's wake: a stroke swelling from a fine tail (left) to a round head (right), a brighter core down it */
function wakeTexture() {
  if (wakeTex) return wakeTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  const stroke = (thick: number, alpha: number) => {
    g.beginPath()
    g.moveTo(6, 32)
    for (let i = 0; i <= 32; i++) {
      const u = i / 32
      g.lineTo(6 + u * 220, 32 - thick * u ** 0.7)
    }
    g.arc(226, 32, thick, -Math.PI / 2, Math.PI / 2)
    for (let i = 32; i >= 0; i--) {
      const u = i / 32
      g.lineTo(6 + u * 220, 32 + thick * u ** 0.7)
    }
    g.closePath()
    const grad = g.createLinearGradient(6, 0, 250, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.55})`)
    grad.addColorStop(1, `rgba(255,255,255,${alpha})`)
    g.fillStyle = grad
    g.fill()
  }
  stroke(22, 0.6)
  stroke(9, 1)
  wakeTex = new THREE.CanvasTexture(c)
  wakeTex.colorSpace = THREE.SRGBColorSpace
  return wakeTex
}

const WHITE = new THREE.Color(1, 1, 1)

/**
 * Streaks lying flat over the reef: put(world x, y, z, length, width, turn, opacity, colour) each frame, the head of
 * the stroke pointing along `turn`. 'swoosh': the tide's lines, drawn over the reef and under the cast; 'wake': the
 * torpedoes' wakes, over the cast's shadows and under the torpedoes. One call each.
 */
export class Streaks {
  readonly mesh: THREE.InstancedMesh
  private readonly mat: THREE.MeshBasicMaterial
  private readonly alpha: THREE.InstancedBufferAttribute
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()
  private n = 0

  constructor(
    private readonly cap = 32,
    look: 'swoosh' | 'wake' = 'swoosh',
  ) {
    const g = new THREE.PlaneGeometry(1, 1)
    g.rotateX(-Math.PI / 2)
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('iAlpha', this.alpha)
    this.mat = new THREE.MeshBasicMaterial({ map: look === 'wake' ? wakeTexture() : streakTexture(), transparent: true, depthWrite: false })
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float iAlpha;\nvarying float vAlpha;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = iAlpha;')
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAlpha;').replace('#include <opaque_fragment>', 'diffuseColor.a *= vAlpha;\noutgoingLight = diffuseColor.rgb;\n#include <opaque_fragment>')
    }
    this.mat.customProgramCacheKey = () => 'reef-streak'
    this.mesh = new THREE.InstancedMesh(g, this.mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = look === 'wake' ? 5 : 4
    this.mesh.count = 0
  }

  begin() {
    this.n = 0
  }

  put(x: number, y: number, z: number, len: number, width: number, turn: number, alpha: number, color: THREE.Color = WHITE) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, turn, 0)), this.s.set(len, 1, width))
    this.mesh.setMatrixAt(i, this.m)
    this.mesh.setColorAt(i, color)
    this.alpha.setX(i, alpha)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
    this.alpha.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    this.mesh.dispose()
    this.mat.dispose()
  }
}

/* ---------------- the lock-on reticle ---------------- */

let reticleTex: THREE.CanvasTexture | null = null
function reticleTexture() {
  if (reticleTex) return reticleTex
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.translate(128, 128)
  const ring = (stroke: string, w: number) => {
    g.beginPath()
    for (let i = 0; i < 4; i++) {
      const a0 = (i / 4) * Math.PI * 2 + 0.22
      g.moveTo(Math.cos(a0) * 92, Math.sin(a0) * 92)
      g.arc(0, 0, 92, a0, a0 + Math.PI / 2 - 0.44)
    }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2
      g.moveTo(Math.cos(a) * 70, Math.sin(a) * 70)
      g.lineTo(Math.cos(a) * 118, Math.sin(a) * 118)
    }
    g.lineCap = 'round'
    g.lineWidth = w
    g.strokeStyle = stroke
    g.stroke()
  }
  ring(INK, 26)
  ring('#ff3f6a', 13)
  g.beginPath()
  g.arc(0, 0, 9, 0, Math.PI * 2)
  g.fillStyle = '#ff3f6a'
  g.fill()
  reticleTex = new THREE.CanvasTexture(c)
  reticleTex.colorSpace = THREE.SRGBColorSpace
  return reticleTex
}

/** the lock-on marker: a red crosshair ring lying in the swim plane; scale it to the creature and spin it */
export function buildReticle() {
  const mat = new THREE.MeshBasicMaterial({ map: reticleTexture(), transparent: true, depthWrite: false, depthTest: false })
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
  m.geometry.rotateX(-Math.PI / 2)
  m.name = 'reticle'
  m.renderOrder = 12
  m.visible = false
  return m
}

/** frees the cached effect geometry and textures' GPU copies */
export function releaseEffects() {
  for (const g of Object.values(boomGeos)) g.dispose()
  reticleTex?.dispose()
  streakTex?.dispose()
  wakeTex?.dispose()
}
