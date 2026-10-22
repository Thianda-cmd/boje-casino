import * as THREE from 'three'
import { Bits, Sparks, glowTexture, ringTexture, rnd } from '../../../lib/three/fx'
import type { FightEvent, KaijuId } from '../types'
import { FOG } from './shaders'

/*
  The stage's effects. The lasting things on stage (buildings falling, beams, the foam) are pure functions of the
  script time and live elsewhere or are drawn here from the beat that is playing; this file also holds the fleeting
  ones, which are started when the show passes a moment and then run on their own: sparks and a flash where a blow
  lands (in the striker's glow colour), dust where a body hits the ground, a shockwave ring under the heavy ones,
  debris, dust plumes and electric sparks for a building coming down, a column of spray for a kaiju hitting the
  bay, and fireworks over the water on a Main Event night. They run on the show's clock, so they freeze in the
  hit-stop and drift in the slow motion, and a jump of the clock (the replay, a scrub) clears them.

  Each kaiju's special (Special) is drawn from its beam beat and how far through it is, so it can be scrubbed:
    Rexor     the Atomic Breath: a thick cyan beam with a white core, crackling at the mouth and where it strikes
    Titan-X   twin red lasers from the visor, converging on the target, scorching
    Voltra    chain lightning: forked bolts redrawn many times a second, arcing on to the ground and the buildings
    Lumina    the Dust Storm: three wing claps, each a gust of glittering gold dust, with a shimmering wind cone
    Kraka     the Ink Cyclone: a spinning funnel of ink with glowing violet bands round its target
    Gorrath   the Ground Pound: three slams, each a shockwave ring racing out over the ground with dust and stone
    Pincer    the Shell Spin: a whirl of orange streaks round the spinning crab, throwing sparks
    Bedrock   the Boulder Hurl: a lava-cracked boulder torn up, raised overhead and hurled, bursting on impact
*/

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const FOG_PARS = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogDensity;
float fogOf(float d) { float k = uFogDensity * d; return 1.0 - exp(-k * k); }
`

/* ------------------------------------------------------------------ */
/*  Dust and smoke                                                      */
/* ------------------------------------------------------------------ */

interface Puff {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  life: number
  max: number
  s0: number
  s1: number
  a: number
  r: number
  g: number
  b: number
  drag: number
  rise: number
}

/** soft clouds that grow and fade (dust, smoke, spray), blended normally so they hide what is behind them */
export class Puffs {
  readonly points: THREE.Points
  readonly mat: THREE.ShaderMaterial
  private readonly list: Puff[] = []
  private readonly pos: Float32Array
  private readonly tint: Float32Array
  private readonly size: Float32Array
  private readonly alpha: Float32Array
  private readonly geo = new THREE.BufferGeometry()
  private readonly cap: number

  constructor(cap: number) {
    this.cap = cap
    this.pos = new Float32Array(cap * 3)
    this.tint = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    const dyn = (a: Float32Array, k: number) => new THREE.BufferAttribute(a, k).setUsage(THREE.DynamicDrawUsage)
    this.geo.setAttribute('position', dyn(this.pos, 3))
    this.geo.setAttribute('tint', dyn(this.tint, 3))
    this.geo.setAttribute('size', dyn(this.size, 1))
    this.geo.setAttribute('alpha', dyn(this.alpha, 1))
    this.geo.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 400 }, uFogColor: { value: FOG.color }, uFogDensity: { value: FOG.density } },
      vertexShader: /* glsl */ `
        attribute float size;
        attribute float alpha;
        attribute vec3 tint;
        uniform float scale;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vDist;
        void main() {
          vTint = tint;
          vAlpha = alpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vDist = -mv.z;
          gl_PointSize = min(size * scale / -mv.z, 512.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map;
        varying vec3 vTint;
        varying float vAlpha;
        varying float vDist;
        ${FOG_PARS}
        void main() {
          float a = texture2D(map, gl_PointCoord).a;
          a = smoothstep(0.0, 0.6, a) * vAlpha;
          gl_FragColor = vec4(mix(vTint, uFogColor, fogOf(vDist)), a);
        }`,
      transparent: true,
      depthWrite: false,
    })
    this.points = new THREE.Points(this.geo, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 8
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, s0: number, s1: number, life: number, a = 0.7, drag = 1.6, rise = 0) {
    if (this.list.length >= this.cap) this.list.shift()
    this.list.push({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, life, max: life, s0, s1, a, r: c.r, g: c.g, b: c.b, drag, rise })
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
      s.vy = s.vy * k + s.rise * dt
      s.vz *= k
      s.x += s.vx * dt
      s.y = Math.max(0.2, s.y + s.vy * dt)
      s.z += s.vz * dt
      const f = 1 - s.life / s.max
      L[n++] = s
      const j = n - 1
      this.pos[j * 3] = s.x
      this.pos[j * 3 + 1] = s.y
      this.pos[j * 3 + 2] = s.z
      this.tint[j * 3] = s.r
      this.tint[j * 3 + 1] = s.g
      this.tint[j * 3 + 2] = s.b
      this.size[j] = s.s0 + (s.s1 - s.s0) * (1 - (1 - f) * (1 - f))
      this.alpha[j] = s.a * Math.min(1, f * 8) * (1 - f) * (1 - f * 0.4)
    }
    L.length = n
    this.geo.setDrawRange(0, n)
    for (const name of ['position', 'tint', 'size', 'alpha']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true
  }

  clear() {
    this.list.length = 0
    this.geo.setDrawRange(0, 0)
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Shockwave rings                                                     */
/* ------------------------------------------------------------------ */

interface Ring {
  mesh: THREE.Mesh
  mat: THREE.MeshBasicMaterial
  t: number
  life: number
  r0: number
  r1: number
  k: number
}

class Rings {
  readonly group = new THREE.Group()
  private readonly pool: Ring[] = []
  private readonly geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)

  constructor(n: number) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: ringTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
      const mesh = new THREE.Mesh(this.geo, mat)
      mesh.visible = false
      mesh.renderOrder = 7
      this.group.add(mesh)
      this.pool.push({ mesh, mat, t: 1, life: 1, r0: 1, r1: 1, k: 0 })
    }
  }

  /** a ring racing out over the ground from p (or, upright, round a point: `up`) */
  add(p: THREE.Vector3, c: THREE.Color, r0: number, r1: number, life: number, k = 1, up?: THREE.Vector3) {
    const r = this.pool.reduce((a, b) => (b.t / b.life > a.t / a.life ? b : a))
    r.t = 0
    r.life = life
    r.r0 = r0
    r.r1 = r1
    r.k = k
    r.mat.color.copy(c)
    r.mesh.position.copy(p)
    r.mesh.position.y = Math.max(p.y, 0.08)
    if (up) r.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), up)
    else r.mesh.quaternion.identity()
    r.mesh.visible = true
  }

  update(dt: number) {
    for (const r of this.pool) {
      if (!r.mesh.visible) continue
      r.t += dt
      const u = r.t / r.life
      if (u >= 1) {
        r.mesh.visible = false
        continue
      }
      const e = 1 - (1 - u) * (1 - u)
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e)
      r.mat.opacity = r.k * (1 - u) * (1 - u)
    }
  }

  clear() {
    for (const r of this.pool) r.mesh.visible = false
  }

  dispose() {
    this.geo.dispose()
    for (const r of this.pool) r.mat.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Beams, bolts, funnels                                               */
/* ------------------------------------------------------------------ */

function beamMaterial(core: THREE.Color, edge: THREE.Color, scroll: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uCore: { value: core }, uEdge: { value: edge }, uTime: { value: 0 }, uK: { value: 0 }, uScroll: { value: scroll } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = cameraPosition - w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCore;
      uniform vec3 uEdge;
      uniform float uTime;
      uniform float uK;
      uniform float uScroll;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float edge = abs(dot(normalize(vN), normalize(vView)));
        float core = pow(edge, 4.0);
        float n = n2(vec2(vUv.x * 7.0, vUv.y * 26.0 - uTime * uScroll)) * 0.6 + n2(vec2(vUv.x * 13.0 + 3.0, vUv.y * 60.0 - uTime * uScroll * 1.7)) * 0.4;
        vec3 c = mix(uEdge * (0.35 + 0.9 * n), uCore, core) * (0.25 + 0.75 * edge);
        c *= smoothstep(0.0, 0.025, vUv.y) * (1.0 - 0.25 * smoothstep(0.9, 1.0, vUv.y));
        gl_FragColor = vec4(c * uK, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
}

/** a beam: an open cylinder from its base (origin) up +y, placed from a point to a point */
class Beam {
  readonly mesh: THREE.Mesh
  readonly mat: THREE.ShaderMaterial
  private static geo: THREE.CylinderGeometry | null = null

  constructor(core: THREE.Color, edge: THREE.Color, scroll = 9) {
    if (!Beam.geo) {
      Beam.geo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true)
      Beam.geo.translate(0, 0.5, 0)
    }
    this.mat = beamMaterial(core, edge, scroll)
    this.mesh = new THREE.Mesh(Beam.geo, this.mat)
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
  }

  set(from: THREE.Vector3, to: THREE.Vector3, r0: number, k: number, time: number) {
    const d = to.clone().sub(from)
    const len = d.length()
    if (k <= 0.001 || len < 0.1) {
      this.mesh.visible = false
      return
    }
    this.mesh.visible = true
    this.mesh.position.copy(from)
    this.mesh.quaternion.setFromUnitVectors(V(0, 1, 0), d.divideScalar(len))
    this.mesh.scale.set(r0, len, r0)
    this.mat.uniforms.uK.value = k
    this.mat.uniforms.uTime.value = time
  }

  hide() {
    this.mesh.visible = false
  }

  static dispose() {
    Beam.geo?.dispose()
    Beam.geo = null
  }
}

/** forked lightning: camera-facing ribbons along jagged paths, redrawn many times a second */
class Bolts {
  readonly mesh: THREE.Mesh
  private readonly mat: THREE.ShaderMaterial
  private readonly pos: Float32Array
  private readonly al: Float32Array
  private readonly geo = new THREE.BufferGeometry()
  private readonly cap = 360
  private n = 0

  constructor(color: THREE.Color) {
    this.pos = new Float32Array(this.cap * 6 * 3)
    this.al = new Float32Array(this.cap * 6)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.al, 1).setUsage(THREE.DynamicDrawUsage))
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color } },
      vertexShader: /* glsl */ `
        attribute float alpha;
        varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        varying float vA;
        void main() { gl_FragColor = vec4(mix(uColor, vec3(3.0), vA * vA * 0.5) * vA, 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
    this.mesh.visible = false
  }

  begin() {
    this.n = 0
  }

  /** one bolt from a to b: jagged by `rough`, `w` wide, branching `forks` times */
  bolt(a: THREE.Vector3, b: THREE.Vector3, w: number, rough: number, cam: THREE.Vector3, forks: number, k: number) {
    const segs = 18
    const pts: THREE.Vector3[] = [a.clone()]
    const d = b.clone().sub(a)
    const len = d.length()
    const side1 = V(-d.z, 0, d.x).normalize()
    const side2 = d.clone().cross(side1).normalize()
    for (let i = 1; i < segs; i++) {
      const u = i / segs
      const env = Math.sin(u * Math.PI)
      pts.push(a.clone().addScaledVector(d, u).addScaledVector(side1, (Math.random() - 0.5) * rough * len * env).addScaledVector(side2, (Math.random() - 0.5) * rough * len * env))
    }
    pts.push(b.clone())
    for (let i = 0; i < segs; i++) this.quad(pts[i], pts[i + 1], w * (1 - (i / segs) * 0.5), cam, k)
    for (let f = 0; f < forks; f++) {
      const i = 3 + Math.floor(Math.random() * (segs - 6))
      const from = pts[i]
      const dir = d.clone().normalize().add(V(rnd(-1, 1), rnd(-0.8, 0.6), rnd(-1, 1))).normalize()
      const to = from.clone().addScaledVector(dir, len * rnd(0.15, 0.35))
      this.bolt(from, to, w * 0.5, rough * 1.2, cam, 0, k * 0.7)
    }
  }

  private quad(a: THREE.Vector3, b: THREE.Vector3, w: number, cam: THREE.Vector3, k: number) {
    if (this.n >= this.cap) return
    const d = b.clone().sub(a)
    const toCam = cam.clone().sub(a)
    const s = d.cross(toCam).normalize().multiplyScalar(w / 2)
    const P = this.pos
    const o = this.n * 18
    const c = [a.clone().sub(s), a.clone().add(s), b.clone().add(s), b.clone().sub(s)]
    const idx = [0, 1, 2, 0, 2, 3]
    idx.forEach((q, j) => {
      P[o + j * 3] = c[q].x
      P[o + j * 3 + 1] = c[q].y
      P[o + j * 3 + 2] = c[q].z
      this.al[this.n * 6 + j] = k
    })
    this.n++
  }

  end() {
    this.geo.setDrawRange(0, this.n * 6)
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true
    this.mesh.visible = this.n > 0
  }

  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

/** Kraka's ink cyclone: a funnel of ink spinning round its target, with glowing violet bands */
function cycloneMesh() {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 16; i++) {
    const y = i / 16
    pts.push(new THREE.Vector2(0.28 + 0.72 * y * y + 0.06 * Math.sin(y * 9), y))
  }
  const geo = new THREE.LatheGeometry(pts, 32)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uGlow: { value: new THREE.Color(1.6, 0.8, 3.2) }, uInk: { value: new THREE.Color('#1a0c2a') } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uK;
      uniform vec3 uGlow;
      uniform vec3 uInk;
      varying vec2 vUv;
      void main() {
        float s = fract(vUv.x * 3.0 + vUv.y * 1.6 - uTime * 2.4);
        float band = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.12, 0.32, s));
        float s2 = fract(vUv.x * 5.0 - vUv.y * 0.8 - uTime * 3.7);
        float streak = smoothstep(0.45, 0.5, s2) * (1.0 - smoothstep(0.5, 0.58, s2));
        float a = (0.45 + 0.4 * band) * smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.75, 1.0, vUv.y)) * uK;
        vec3 c = mix(uInk, uGlow, band * 0.85 + streak * 0.6);
        gl_FragColor = vec4(c, a);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  mesh.renderOrder = 9
  mesh.frustumCulled = false
  return { mesh, mat, geo }
}

/** Pincer's whirl: a band of streaks round it */
function whirlMesh() {
  const geo = new THREE.CylinderGeometry(1, 1.15, 1, 40, 1, true)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 0 }, uColor: { value: new THREE.Color(2.6, 1.3, 0.4) } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uK;
      uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float s = fract(vUv.x * 4.0 - uTime * 3.5 + vUv.y * 0.3);
        float streak = pow(s, 6.0);
        float a = streak * sin(vUv.y * 3.14159) * uK;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.visible = false
  mesh.renderOrder = 9
  mesh.frustumCulled = false
  return { mesh, mat, geo }
}

/* ------------------------------------------------------------------ */
/*  The effects                                                         */
/* ------------------------------------------------------------------ */

const WHITE = new THREE.Color(2.2, 2.2, 2.2)
const DUST = new THREE.Color('#6d6478')
const SMOKE = new THREE.Color('#3b3346')
const SPRAY = new THREE.Color('#c8d6ec')

interface Rocket {
  p: THREE.Vector3
  v: THREE.Vector3
  t: number
  burst: number
  c: THREE.Color
}

export class Fx {
  readonly root = new THREE.Group()
  readonly sparks: Sparks
  readonly glitter: Sparks
  readonly puffs: Puffs
  readonly debris: Bits
  readonly rings = new Rings(10)
  private readonly rockets: Rocket[] = []
  readonly low: boolean

  constructor(low: boolean) {
    this.low = low
    this.sparks = new Sparks(low ? 900 : 1800)
    this.glitter = new Sparks(low ? 400 : 900)
    this.puffs = new Puffs(low ? 260 : 520)
    const dg = new THREE.BoxGeometry(1, 0.7, 0.85)
    const dm = new THREE.MeshToonMaterial({ color: '#ffffff' })
    this.debris = new Bits(dg, dm, low ? 140 : 300, true)
    this.root.add(this.sparks.points, this.glitter.points, this.puffs.points, this.debris.mesh, this.rings.group)
  }

  /** how big a point of a given world size is on screen (the canvas height in pixels over the view's height at 1 unit) */
  setScale(px: number) {
    this.sparks.mat.uniforms.scale.value = px
    this.glitter.mat.uniforms.scale.value = px
    this.puffs.mat.uniforms.scale.value = px
  }

  update(dt: number) {
    this.sparks.update(dt)
    this.glitter.update(dt)
    this.puffs.update(dt)
    this.debris.update(dt)
    this.rings.update(dt)
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i]
      r.t += dt
      r.v.y -= 9 * dt
      r.p.addScaledVector(r.v, dt)
      if (Math.random() < 0.8) this.sparks.emit(r.p.x, r.p.y, r.p.z, rnd(-1, 1), rnd(-2, 0), rnd(-1, 1), r.c.clone().multiplyScalar(0.6), 0.5, 0.35, -2, 1)
      if (r.t >= r.burst) {
        this.rockets.splice(i, 1)
        const n = this.low ? 70 : 140
        const hot = r.c.clone().multiplyScalar(2.6)
        for (let k = 0; k < n; k++) {
          const u = rnd(-1, 1)
          const a = rnd(0, Math.PI * 2)
          const s = Math.sqrt(1 - u * u)
          const sp = rnd(15, 21)
          this.sparks.emit(r.p.x, r.p.y, r.p.z, Math.cos(a) * s * sp, u * sp, Math.sin(a) * s * sp, k % 7 ? hot : WHITE, rnd(0.9, 1.5), rnd(1.3, 2.0), -5, 1.1)
        }
        this.sparks.emit(r.p.x, r.p.y, r.p.z, 0, 0, 0, hot, 14, 0.25)
      }
    }
  }

  clear() {
    this.sparks.list.length = 0
    this.sparks.update(0)
    this.glitter.list.length = 0
    this.glitter.update(0)
    this.puffs.clear()
    this.debris.list.length = 0
    this.debris.update(0)
    this.rings.clear()
    this.rockets.length = 0
  }

  /** a blow landing (or blocked) at p, coming along `dir`, in the striker's colour */
  impact(p: THREE.Vector3, dir: THREE.Vector3, c: THREE.Color, heavy: boolean, blocked: boolean) {
    const hot = c.clone().multiplyScalar(2.4)
    const n = (blocked ? 22 : heavy ? 56 : 28) * (this.low ? 0.6 : 1)
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(rnd(4, heavy ? 22 : 14)).add(V(rnd(-1, 1), rnd(-0.4, 1), rnd(-1, 1)).multiplyScalar(heavy ? 14 : 9))
      this.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, blocked ? (i % 2 ? WHITE : new THREE.Color(1.4, 1.8, 2.6)) : i % 3 ? hot : WHITE, rnd(0.35, heavy ? 0.9 : 0.6), rnd(0.25, 0.6), -14, 2.4)
    }
    // the flash
    this.sparks.emit(p.x, p.y, p.z, 0, 0, 0, blocked ? WHITE : hot, heavy ? 9 : 5.5, heavy ? 0.16 : 0.11)
    this.sparks.emit(p.x, p.y, p.z, 0, 0, 0, WHITE, heavy ? 4.5 : 2.6, 0.08)
    if (heavy && !blocked) {
      this.rings.add(p, c.clone().multiplyScalar(1.6), 0.6, 7, 0.4, 1, dir.clone().negate())
      for (let i = 0; i < 6; i++) this.debris.emit(p, V(rnd(-6, 6), rnd(2, 9), rnd(-6, 6)), new THREE.Color('#8a8070'), rnd(0.25, 0.5), rnd(0.8, 1.4), -30)
    }
  }

  /** a body (or a foot, a boulder) hitting the ground: a ring of dust and a few stones */
  slam(p: THREE.Vector3, size: number, ring?: THREE.Color) {
    const n = Math.round((this.low ? 10 : 20) * size)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.2, 0.2)
      const sp = rnd(5, 10) * size
      this.puffs.emit(V(p.x + Math.cos(a) * 1.5 * size, 0.6, p.z + Math.sin(a) * 1.5 * size), V(Math.cos(a) * sp, rnd(0.5, 2.5), Math.sin(a) * sp), DUST, 2.2 * size, 5.5 * size, rnd(1.0, 1.8), 0.55, 2.4, 0.4)
    }
    for (let i = 0; i < 8 * size; i++) this.debris.emit(V(p.x, 0.5, p.z), V(rnd(-7, 7), rnd(4, 11), rnd(-7, 7)), new THREE.Color('#5d5868'), rnd(0.2, 0.5), rnd(0.8, 1.5), -30)
    if (ring) this.rings.add(V(p.x, 0.1, p.z), ring, 1, 9 * size, 0.6, 0.8)
  }

  /** a building coming down: debris, a plume of dust rising and spreading, electric sparks from inside */
  collapse(c: THREE.Vector3, w: number, h: number, wall: THREE.Color, away: THREE.Vector3) {
    const k = this.low ? 0.55 : 1
    for (let i = 0; i < 46 * k; i++) {
      const p = V(c.x + rnd(-w, w) * 0.5, rnd(0.5, h), c.z + rnd(-w, w) * 0.5)
      this.debris.emit(p, V(rnd(-6, 6) + away.x * 5, rnd(2, 10), rnd(-6, 6) + away.z * 5), wall.clone().multiplyScalar(rnd(0.6, 1)), rnd(0.35, 1.0), rnd(1.4, 2.4), -26)
    }
    // the plume billows up well past where the building stood, so it shows over the kaiju beside it
    for (let i = 0; i < 44 * k; i++) {
      const y = rnd(0.5, h * 0.9)
      const p = V(c.x + rnd(-w, w) * 0.6, y, c.z + rnd(-w, w) * 0.6)
      this.puffs.emit(p, V(rnd(-3, 3), rnd(2, 6) + h * 0.12, rnd(-3, 3)), i % 3 ? DUST : SMOKE, 3.5 + h * 0.15, 10 + h * 0.4, rnd(2.4, 3.8), 0.66, 0.7, 0.9)
    }
    // the dust rolling out along the ground
    for (let i = 0; i < 18 * k; i++) {
      const a = rnd(0, Math.PI * 2)
      this.puffs.emit(V(c.x, 0.8, c.z), V(Math.cos(a) * rnd(6, 12), rnd(0, 1), Math.sin(a) * rnd(6, 12)), DUST, 3, 8, rnd(1.6, 2.6), 0.5, 1.6, 0.2)
    }
    for (let i = 0; i < 30 * k; i++) {
      const p = V(c.x + rnd(-w, w) * 0.5, rnd(1, h), c.z + rnd(-w, w) * 0.5)
      this.sparks.emit(p.x, p.y, p.z, rnd(-6, 6), rnd(0, 8), rnd(-6, 6), i % 2 ? new THREE.Color(1.2, 1.8, 3) : new THREE.Color(3, 1.8, 0.6), rnd(0.3, 0.6), rnd(0.4, 1.0), -14, 1.2)
    }
    // embers drifting up from the heap
    for (let i = 0; i < 24 * k; i++) this.sparks.emit(c.x + rnd(-w, w) * 0.5, rnd(0.5, 3), c.z + rnd(-w, w) * 0.5, rnd(-1, 1), rnd(1.5, 4), rnd(-1, 1), new THREE.Color(3, 1.1, 0.3), rnd(0.25, 0.45), rnd(1.8, 3.4), 0.4, 0.4)
  }

  /** a kaiju hitting the bay: a column of spray, droplets, a ring of white water */
  splash(p: THREE.Vector3, big: boolean, waterY: number) {
    const k = (big ? 1 : 0.55) * (this.low ? 0.6 : 1)
    for (let i = 0; i < 60 * k; i++) {
      const a = rnd(0, Math.PI * 2)
      const r = rnd(0, 3)
      this.puffs.emit(V(p.x + Math.cos(a) * r, waterY + 0.5, p.z + Math.sin(a) * r), V(Math.cos(a) * rnd(1, 6), rnd(14, big ? 40 : 22), Math.sin(a) * rnd(1, 6)), SPRAY, 3, big ? 10 : 6, rnd(1.4, 2.6), 0.8, 1.0, -11)
    }
    for (let i = 0; i < 140 * k; i++) {
      const a = rnd(0, Math.PI * 2)
      const sp = rnd(4, 16)
      this.sparks.emit(p.x, waterY + 1, p.z, Math.cos(a) * sp, rnd(16, big ? 42 : 24), Math.sin(a) * sp, new THREE.Color(1.3, 1.5, 1.9), rnd(0.35, 0.8), rnd(1.0, 2.0), -26, 0.4)
    }
    // the white water spreading
    for (let i = 0; i < 26 * k; i++) {
      const a = (i / (26 * k)) * Math.PI * 2
      this.puffs.emit(V(p.x, waterY + 0.4, p.z), V(Math.cos(a) * rnd(7, 13), 0.5, Math.sin(a) * rnd(7, 13)), SPRAY, 3, 7, rnd(1.5, 2.4), 0.6, 1.4, 0)
    }
    this.rings.add(V(p.x, waterY + 0.15, p.z), new THREE.Color(1.1, 1.3, 1.6), 2, big ? 22 : 13, 1.4, 0.9)
  }

  /** a firework rising from the bay and bursting */
  firework(p: THREE.Vector3, c: THREE.Color) {
    this.rockets.push({ p: p.clone(), v: V(rnd(-3, 3), rnd(36, 44), rnd(-3, 3)), t: 0, burst: rnd(1.3, 1.7), c })
  }

  /** small dust at a foot coming down */
  step(p: THREE.Vector3, size: number) {
    for (let i = 0; i < 4; i++) this.puffs.emit(V(p.x + rnd(-1, 1), 0.4, p.z + rnd(-1, 1)), V(rnd(-2, 2), rnd(0.2, 1), rnd(-2, 2)), DUST, 1.2 * size, 3 * size, rnd(0.8, 1.3), 0.35, 2, 0.2)
  }

  dispose() {
    this.sparks.dispose()
    this.glitter.dispose()
    this.puffs.dispose()
    this.debris.dispose()
    this.rings.dispose()
    Beam.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Specials                                                            */
/* ------------------------------------------------------------------ */

/** where a special starts and ends this frame, and how it went */
export interface Aim {
  from: THREE.Vector3
  to: THREE.Vector3
  /** the striker's position (the kaiju's centre on the ground) and the target's */
  base: THREE.Vector3
  outcome: 'land' | 'block' | 'miss'
  cam: THREE.Vector3
  /** for the ground: where the special's light falls (the scene draws it) */
  glow?: { a: THREE.Vector3; b: THREE.Vector3; c: THREE.Color }
}

/** when, through a beam beat, a special fires: from its impact (IMPACT.beam) to where the clip stops firing */
export const FIRE0 = 0.5
export const FIRE1 = 0.89
/** Gorrath's slams and Lumina's claps, as fractions of the beat (the clips' contact moments, re-timed) */
const SLAMS = [0.5, 0.645, 0.79]
const CLAPS = [0.5, 0.69, 0.89]

export class Special {
  readonly root = new THREE.Group()
  private readonly beams: Beam[] = []
  private bolts: Bolts | null = null
  private cyclone: ReturnType<typeof cycloneMesh> | null = null
  private whirl: ReturnType<typeof whirlMesh> | null = null
  private boulder: THREE.Mesh | null = null
  private boulderMat: THREE.Material | null = null
  private readonly own: { dispose: () => void }[] = []
  private lastP = -1
  private lastE: FightEvent | null = null
  private boltClock = 0
  /** what is owed of each steady stream of particles (a rate a second times the step, carried over) */
  private owed: Record<string, number> = {}
  private readonly fx: Fx
  private readonly color: THREE.Color

  constructor(
    readonly id: KaijuId,
    fx: Fx,
    glow: string,
  ) {
    this.fx = fx
    this.color = new THREE.Color(glow)
    switch (id) {
      case 'rexor': {
        this.beams.push(new Beam(new THREE.Color(3.2, 3.6, 3.8), new THREE.Color(0.4, 1.9, 3.6), 11), new Beam(new THREE.Color(0.6, 1.6, 2.4), new THREE.Color(0.1, 0.5, 1.4), 6))
        break
      }
      case 'titan': {
        this.beams.push(new Beam(new THREE.Color(4, 2.2, 2.2), new THREE.Color(3, 0.25, 0.4), 14), new Beam(new THREE.Color(4, 2.2, 2.2), new THREE.Color(3, 0.25, 0.4), 14))
        break
      }
      case 'voltra':
        this.bolts = new Bolts(new THREE.Color(0.8, 2.6, 3.2))
        this.root.add(this.bolts.mesh)
        this.own.push(this.bolts)
        break
      case 'lumina':
        this.beams.push(new Beam(new THREE.Color(1.4, 1.2, 0.5), new THREE.Color(0.9, 0.7, 0.2), 20))
        break
      case 'kraka':
        this.cyclone = cycloneMesh()
        this.root.add(this.cyclone.mesh)
        this.own.push(this.cyclone.geo, this.cyclone.mat)
        break
      case 'pincer':
        this.whirl = whirlMesh()
        this.root.add(this.whirl.mesh)
        this.own.push(this.whirl.geo, this.whirl.mat)
        break
      case 'bedrock': {
        const g = new THREE.IcosahedronGeometry(1, 1)
        const p = g.getAttribute('position') as THREE.BufferAttribute
        for (let i = 0; i < p.count; i++) {
          const k = 1 + (Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3) * 0.5 + Math.sin(p.getZ(i) * 5.7) * 0.5) * 0.18
          p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
        }
        g.deleteAttribute('normal')
        g.computeVertexNormals()
        this.boulderMat = new THREE.MeshToonMaterial({ color: '#6b6358', emissive: new THREE.Color('#ff5a1f'), emissiveIntensity: 0.55 })
        this.boulder = new THREE.Mesh(g, this.boulderMat)
        this.boulder.scale.setScalar(1.7)
        this.boulder.visible = false
        this.root.add(this.boulder)
        this.own.push(g, this.boulderMat)
        break
      }
    }
    for (const b of this.beams) {
      this.root.add(b.mesh)
      this.own.push(b.mat)
    }
  }

  /**
   * Draws the special for a beam beat `e` at progress p (null: none playing). `dt` the show's step (0 when frozen),
   * `time` its clock in seconds. Bursts fire when p passes their moment going forward.
   */
  update(e: FightEvent | null, p: number, aim: Aim | null, dt: number, time: number) {
    const fresh = e !== this.lastE
    const prev = fresh ? -1 : this.lastP
    this.lastE = e
    this.lastP = p
    const crossed = (at: number) => prev < at && p >= at && p - prev < 0.5
    if (!e || !aim) {
      this.hide()
      return
    }
    const fire = p >= FIRE0 && p < FIRE1
    const k = fire ? clamp01((p - FIRE0) / 0.025) * clamp01((FIRE1 - p) / 0.05) : 0
    const fx = this.fx
    const { from, to } = aim
    const dir = to.clone().sub(from).normalize()
    aim.glow = undefined
    // a charge gathering at the mouth before it fires
    if (p > 0.15 && p < FIRE0 && (this.id === 'rexor' || this.id === 'titan' || this.id === 'voltra')) {
      for (let i = this.due('charge', 120, dt); i > 0; i--) {
        const o = V(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).normalize().multiplyScalar(rnd(2, 4))
        const s = from.clone().add(o)
        fx.sparks.emit(s.x, s.y, s.z, -o.x * 5, -o.y * 5, -o.z * 5, this.color.clone().multiplyScalar(2.4), rnd(0.25, 0.45), 0.2, 0, 0)
      }
    }
    switch (this.id) {
      case 'rexor': {
        const wob = 1 + 0.12 * Math.sin(time * 40)
        this.beams[0].set(from, to, 0.5 * wob * k, k, time)
        this.beams[1].set(from, to, 1.25 * wob * k, k * 0.32, time)
        if (k > 0) {
          aim.glow = { a: from, b: to, c: new THREE.Color(0.1, 0.4, 0.75).multiplyScalar(k) }
          this.burstAt(to, dir, this.color, this.due('hit', 140, dt), this.due('flash', 14, dt))
          if (this.due('mouth', 12, dt)) fx.sparks.emit(from.x, from.y, from.z, 0, 0, 0, new THREE.Color(0.8, 1.6, 2.0), 2.6 * wob, 0.09)
        }
        break
      }
      case 'titan': {
        // the two lasers from either side of the visor, converging
        const side = V(-dir.z, 0, dir.x).normalize().multiplyScalar(0.45)
        const wob = 1 + 0.2 * Math.sin(time * 60)
        this.beams[0].set(from.clone().add(side), to, 0.22 * wob * k, k, time)
        this.beams[1].set(from.clone().sub(side), to, 0.22 * wob * k, k, time)
        if (k > 0) {
          aim.glow = { a: from, b: to, c: new THREE.Color(0.8, 0.08, 0.1).multiplyScalar(k) }
          this.burstAt(to, dir, new THREE.Color('#ff3b4f'), this.due('hit', 110, dt), this.due('flash', 12, dt))
          if (this.due('mouth', 10, dt)) fx.sparks.emit(from.x, from.y, from.z, 0, 0, 0, new THREE.Color(2.4, 0.4, 0.5), 2.0, 0.08)
        }
        break
      }
      case 'voltra': {
        const bolts = this.bolts!
        if (k > 0) {
          this.boltClock -= dt
          if (this.boltClock <= 0 || fresh) {
            this.boltClock = 0.045
            bolts.begin()
            bolts.bolt(from, to, 0.34, 0.16, aim.cam, 3, 0.85)
            bolts.bolt(from, to, 0.18, 0.24, aim.cam, 1, 0.55)
            // the chain: on from the target to the ground round it
            for (let i = 0; i < 3; i++) {
              const g = to.clone().add(V(rnd(-7, 7), 0, rnd(-7, 7)))
              g.y = 0.2
              bolts.bolt(to, g, 0.16, 0.3, aim.cam, 1, 0.6)
            }
            bolts.end()
          }
          aim.glow = { a: from, b: to, c: new THREE.Color(0.15, 0.55, 0.7).multiplyScalar(k * (0.6 + Math.random() * 0.6)) }
          this.burstAt(to, dir, this.color, this.due('hit', 90, dt), this.due('flash', 10, dt))
        } else {
          bolts.begin()
          bolts.end()
        }
        break
      }
      case 'lumina': {
        // three claps, each a gust of glitter; a shimmering cone of wind between
        const cone = clamp01((p - 0.45) / 0.05) * clamp01((0.93 - p) / 0.05)
        const len = from.distanceTo(to) + 4
        this.beams[0].set(from, from.clone().addScaledVector(dir, len), 2.6 * cone, cone * 0.32, time)
        for (const c of CLAPS)
          if (crossed(c)) {
            const n = this.fx.low ? 40 : 90
            for (let i = 0; i < n; i++) {
              const v = dir.clone().multiplyScalar(rnd(18, 42)).add(V(rnd(-1, 1), rnd(-0.6, 1), rnd(-1, 1)).multiplyScalar(8))
              fx.glitter.emit(from.x, from.y, from.z, v.x, v.y, v.z, i % 4 ? new THREE.Color(2.8, 2.3, 0.9) : WHITE, rnd(0.2, 0.5), rnd(0.6, 1.1), -1, 1.6)
            }
            fx.rings.add(from.clone(), new THREE.Color(1.8, 1.5, 0.6), 1, 6, 0.35, 0.8, dir.clone())
          }
        if (cone > 0) {
          for (let i = this.due('dust', 160, dt); i > 0; i--) {
            const s = from.clone().addScaledVector(dir, rnd(0, len)).add(V(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2)))
            fx.glitter.emit(s.x, s.y, s.z, dir.x * 10, dir.y * 10 + 1, dir.z * 10, new THREE.Color(2.4, 2.1, 1.0), rnd(0.15, 0.35), 0.5, 0, 1)
          }
        }
        break
      }
      case 'kraka': {
        const cy = this.cyclone!
        const grow = clamp01((p - 0.42) / 0.08) * clamp01((0.94 - p) / 0.08)
        if (grow > 0) {
          cy.mesh.visible = true
          const base = aim.outcome === 'miss' ? to : aim.base
          cy.mesh.position.set(base.x, 0, base.z)
          cy.mesh.scale.set(7 * grow, 15 * (0.4 + 0.6 * grow), 7 * grow)
          cy.mesh.rotation.y = time * 5
          cy.mat.uniforms.uTime.value = time
          cy.mat.uniforms.uK.value = grow
          for (let i = this.due('ink', 120, dt); i > 0; i--) {
              const a = rnd(0, Math.PI * 2)
              const r = rnd(2, 6) * grow
              fx.puffs.emit(V(base.x + Math.cos(a) * r, rnd(0.5, 12) * grow, base.z + Math.sin(a) * r), V(-Math.sin(a) * 9, rnd(1, 4), Math.cos(a) * 9), new THREE.Color('#2a1238'), 1.5, 4, rnd(0.6, 1.0), 0.6, 1.5, 1)
            }
        } else cy.mesh.visible = false
        if (crossed(0.9)) {
          for (let i = 0; i < 40; i++) fx.puffs.emit(aim.base.clone().setY(rnd(1, 9)), V(rnd(-9, 9), rnd(-1, 5), rnd(-9, 9)), new THREE.Color('#2a1238'), 1.5, 5, rnd(0.8, 1.4), 0.7, 1.8, -4)
        }
        break
      }
      case 'gorrath': {
        for (const s of SLAMS)
          if (crossed(s)) {
            const at = from.clone().setY(0.1)
            fx.rings.add(at, new THREE.Color(2.4, 1.0, 0.3), 1, 18, 0.75, 1)
            fx.rings.add(at, new THREE.Color(1.6, 1.4, 1.2), 0.5, 10, 0.5, 0.7)
            fx.slam(at, 1.3)
            for (let i = 0; i < 20; i++) fx.sparks.emit(at.x, 0.5, at.z, rnd(-10, 10), rnd(3, 12), rnd(-10, 10), new THREE.Color(3, 1.3, 0.4), rnd(0.3, 0.6), rnd(0.4, 0.8), -20, 1)
          }
        break
      }
      case 'pincer': {
        const wh = this.whirl!
        const spin = clamp01((p - 0.42) / 0.06) * clamp01((0.92 - p) / 0.06)
        if (spin > 0) {
          wh.mesh.visible = true
          wh.mesh.position.set(aim.base.x, 2.2, aim.base.z)
          wh.mesh.scale.set(6.2, 3.2, 6.2)
          wh.mesh.rotation.y = -time * 9
          wh.mat.uniforms.uTime.value = time
          wh.mat.uniforms.uK.value = spin
          {
            for (let i = this.due('spin', 150, dt); i > 0; i--) {
              const a = rnd(0, Math.PI * 2)
              fx.sparks.emit(aim.base.x + Math.cos(a) * 5.5, rnd(0.8, 3.5), aim.base.z + Math.sin(a) * 5.5, -Math.sin(a) * 16, rnd(1, 4), Math.cos(a) * 16, new THREE.Color(3, 1.5, 0.4), rnd(0.25, 0.5), rnd(0.3, 0.6), -10, 1)
            }
            if (this.due('step', 14, dt)) fx.step(aim.base, 1.4)
          }
        } else wh.mesh.visible = false
        break
      }
      case 'bedrock': {
        const b = this.boulder!
        // torn up and lifted with the fist (0.12 to 0.42), hurled to the target (to 0.5), then gone in a burst
        const T0 = 0.12
        const REL = 0.42
        if (p >= T0 && p < REL) {
          b.visible = true
          b.position.copy(from).add(V(0, 0.8, 0))
          b.rotation.set(time * 0.8, time * 0.6, 0)
          b.scale.setScalar(1.7 * clamp01((p - T0) / 0.06))
          if (crossed(T0 + 0.01)) fx.slam(aim.base.clone().addScaledVector(dir.clone().setY(0).normalize(), 3), 0.7)
        } else if (p >= REL && p < 0.5 + (aim.outcome === 'miss' ? 0.12 : 0)) {
          b.visible = true
          const end = aim.outcome === 'miss' ? 0.62 : 0.5
          const u = (p - REL) / (end - REL)
          const pos = from.clone().lerp(to, u)
          pos.y += Math.sin(u * Math.PI) * 4
          b.position.copy(pos)
          b.rotation.set(time * 9, time * 7, 0)
          b.scale.setScalar(1.7)
          for (let i = this.due('trail', 60, dt); i > 0; i--) fx.sparks.emit(pos.x, pos.y, pos.z, 0, 0, 0, new THREE.Color(2.6, 1.0, 0.3), 1.8, 0.2)
        } else b.visible = false
        const hitAt = aim.outcome === 'miss' ? 0.62 : 0.5
        if (crossed(hitAt)) {
          for (let i = 0; i < 26; i++) fx.debris.emit(to.clone(), V(rnd(-10, 10), rnd(2, 12), rnd(-10, 10)), new THREE.Color('#6b6358'), rnd(0.4, 1.0), rnd(1, 1.8), -30)
          for (let i = 0; i < 26; i++) fx.sparks.emit(to.x, to.y, to.z, rnd(-12, 12), rnd(-2, 12), rnd(-12, 12), new THREE.Color(3, 1.2, 0.3), rnd(0.3, 0.7), rnd(0.4, 0.9), -16, 1)
          for (let i = 0; i < 14; i++) fx.puffs.emit(to.clone(), V(rnd(-5, 5), rnd(0, 4), rnd(-5, 5)), DUST, 3, 8, rnd(1.2, 2), 0.6, 1.4, 0.5)
        }
        break
      }
    }
  }

  /** how many of a stream of `rate` a second are due this step */
  private due(name: string, rate: number, dt: number) {
    const o = (this.owed[name] ?? 0) + rate * dt
    const n = Math.floor(o)
    this.owed[name] = o - n
    return n
  }

  /** sparks splashing off where a beam strikes */
  private burstAt(p: THREE.Vector3, dir: THREE.Vector3, c: THREE.Color, n: number, flashes: number) {
    const hot = c.clone().multiplyScalar(2.2)
    for (let i = 0; i < n; i++) {
      const v = dir.clone().multiplyScalar(-rnd(2, 8)).add(V(rnd(-1, 1), rnd(-0.2, 1), rnd(-1, 1)).multiplyScalar(10))
      this.fx.sparks.emit(p.x, p.y, p.z, v.x, v.y, v.z, i % 2 ? hot : WHITE, rnd(0.3, 0.6), rnd(0.25, 0.5), -12, 2)
    }
    for (let i = 0; i < flashes; i++) this.fx.sparks.emit(p.x, p.y, p.z, 0, 0, 0, c.clone().multiplyScalar(1.2), rnd(2.5, 3.5), 0.1)
  }

  hide() {
    for (const b of this.beams) b.hide()
    if (this.bolts) {
      this.bolts.begin()
      this.bolts.end()
    }
    if (this.cyclone) this.cyclone.mesh.visible = false
    if (this.whirl) this.whirl.mesh.visible = false
    if (this.boulder) this.boulder.visible = false
  }

  /** forget what was drawn (after a jump of the clock, so bursts don't fire twice or get skipped wrongly) */
  reset() {
    this.lastE = null
    this.lastP = -1
    this.owed = {}
    this.hide()
  }

  dispose() {
    for (const o of this.own) o.dispose()
    this.root.clear()
  }
}
