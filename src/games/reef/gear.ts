import * as THREE from 'three'
import { T, type P2 } from '../../lib/three/toon'
import { glowTexture } from '../../lib/three/fx'
import { COSTS, MAX_BULLETS } from './rules'
import { disposeSway, swayInstances, swayMaterial, swayMesh } from './cast'
import { C, INK, RKit, SHINE, TAU, V, curve2, ell, ellSurf, fin, flatSurf, horn, lathe, limb, oval, paint, star, stroke, tint } from './kit'
import { LEVEL_COLORS, LOOKS, type Look } from './looks'

/*
  The player's kit, in the cast's toon style and sway shader (all instanced, so each is one draw):

  - The cannon: a chunky brass-and-teal bubble cannon in a domed turret. A glass bubble chamber feeds a flared
    barrel; each of the seven cost levels (COSTS) has its own look (looks.ts): the barrel grows longer and fatter, changes
    colour (teal, green, blue, purple, pink, orange, gold) and gains brass bands, fins, gems, side pods and at the top
    level a crown round the muzzle. Seven pips on the turret ring light up to the level.
  - Torpedoes: a little torpedo in a glossy bubble with a glow in its level's colour (TorpedoBatch). The scene trails
    bubbles behind them from a Bubbles pool.
  - The net: a rope dome with knots and red and white floats round its rim (NetBatch); the scene grows it over a
    creature, its pose pinches the rim in round the catch, and fade dissolves it.
  - Coins: fat gold coins with a star on each face and a sweeping shine (CoinBatch), for the catch showers.

  Batches are drawn by begin(), put() each item, end(), every frame; nothing is allocated per frame.
*/

export const BRASS = '#ffcf5a'
export { LEVEL_COLORS }

/** the barrel's axis height above the cannon's spot, and how far forward of the pivot the glass chamber sits */
export const BARREL_Y = 0.46
const CHAMBER_Z = 0.12
const INK_G = 0.032

/* ---------------- the cannon ---------------- */

/** a barrel along +y from the glass chamber (at the origin) to its flared muzzle at y = len */
function barrelGeometry(L: Look, lvl: number) {
  const k = new RKit(INK, INK_G)
  const r = L.r
  const len = L.len
  const body = C(L.body)
  const trim = L.trim ?? BRASS
  // the barrel: a tapered tube flaring into a bell, lighter on top
  const prof: P2[] = curve2([[r * 1.04, 0.18], [r, 0.34], [r * 0.9, len * 0.7], [r * 0.95, len * 0.8], [r * 1.2, len * 0.92], [r * 1.42, len], [r * 1.2, len + 0.012], [r * 0.98, len - 0.03]], 22)
  const g = lathe(prof, 22)
  k.add(tint(g, (_x, _y, z) => (z > r * 0.35 ? body.clone().lerp(C('#ffffff'), 0.22) : body)), '#ffffff')
  k.add(new THREE.CircleGeometry(r * 0.98, 20), '#14102c', T([0, len - 0.03, 0], [-Math.PI / 2, 0, 0]), 0, { flat: true })
  // brass: bands, the muzzle rim and the collar into the chamber
  for (let i = 0; i < L.bands; i++) {
    const y = len * (0.36 + (0.42 * (i + 0.5)) / L.bands)
    const rr = r * (1 - 0.1 * ((y - 0.34) / (len * 0.7 - 0.34))) + 0.02
    k.add(new THREE.TorusGeometry(rr, 0.035, 8, 22), trim, T([0, y, 0], [Math.PI / 2, 0, 0]), undefined, { shine: 1 })
  }
  k.add(new THREE.TorusGeometry(r * 1.38, 0.05, 8, 24), BRASS, T([0, len - 0.005, 0], [Math.PI / 2, 0, 0]), undefined, { shine: 1 })
  k.add(new THREE.CylinderGeometry(r * 1.2, r * 1.3, 0.12, 20), trim, T([0, 0.22, 0]), undefined, { shine: 1 })
  // fins along the barrel: at the sides, then on top too
  const finOut: P2[] = [[0, 0], [0.26, 0], [0.24, 0.05], [0.04, 0.17]]
  for (let i = 0; i < L.fins; i++) {
    const a = i === 2 ? 0 : i === 0 ? Math.PI / 2 : -Math.PI / 2
    const m = new THREE.Matrix4().makeRotationY(a).multiply(T([0, 0.36, r * 0.85], [0, -Math.PI / 2, 0]))
    m.multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
    k.add(fin(finOut, 0.04, 1), BRASS, m, undefined, { shine: 0.8 })
  }
  // gems set into the bands, on top where they show
  const GEMS = ['#ff3f6a', '#3fd7ff', '#7cff6b', '#ffe14a']
  for (let i = 0; i < L.gems; i++) {
    const y = len * (0.3 + (0.5 * (i + 0.5)) / L.gems)
    const rr = r * (1 - 0.1 * ((y - 0.34) / (len * 0.7 - 0.34)))
    ell(k, { c: [0, y, rr + 0.012], r: [0.045, 0.055, 0.03] }, GEMS[(i + lvl) % GEMS.length], [10, 8], 0.012, [0, 0, 0], { glow: 0.35 })
  }
  // side pods: little bubble launchers along each side
  if (L.pods)
    for (const s of [-1, 1]) {
      limb(k, [s * (r + 0.1), 0.3, -0.02], [s * (r + 0.1), len * 0.62, -0.02], 0.07, body.clone().multiplyScalar(0.85))
      k.add(new THREE.TorusGeometry(0.075, 0.02, 6, 14), trim, T([s * (r + 0.1), len * 0.62 + 0.04, -0.02], [Math.PI / 2, 0, 0]), undefined, { shine: 1 })
    }
  // the crown round the muzzle
  if (L.crown)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + TAU / 16
      const base = V(Math.cos(a) * r * 1.38, len - 0.01, Math.sin(a) * r * 1.38)
      const tip = base.clone().add(V(Math.cos(a) * 0.08, 0.16, Math.sin(a) * 0.08))
      horn(k, [base.x, base.y, base.z], [tip.x, tip.y, tip.z], 0.045, BRASS, undefined, 6, { shine: 1 })
      ell(k, { c: [tip.x, tip.y + 0.01, tip.z], r: [0.028, 0.028, 0.028] }, i % 2 ? '#ff3f6a' : '#3fd7ff', [8, 6], 0.01, [0, 0, 0], { glow: 0.4 })
    }
  // the glass bubble chamber: pale aqua glass with a glint and bubbles inside
  const glass = { c: [0, 0, 0] as [number, number, number], r: [0.3, 0.3, 0.3] as [number, number, number] }
  ell(k, glass, '#8fe3f5', [22, 16], undefined, [0, 0, 0], { glow: 0.08 })
  k.push(new THREE.Matrix4().makeRotationX(Math.PI / 2))
  const gs = ellSurf(glass)
  paint(k, gs, oval(-0.1, 0.11, 0.07, 0.04, 0.7, 12), SHINE, 0.004, true)
  for (const [x, y, rr] of [[0.05, -0.04, 0.045], [-0.04, -0.11, 0.032], [0.11, 0.07, 0.028], [-0.12, -0.02, 0.022]] as const) {
    stroke(k, gs, Array.from({ length: 13 }, (_, i): P2 => [x + Math.cos((i / 12) * TAU) * rr, y + Math.sin((i / 12) * TAU) * rr]), 0.012, 0.004, '#ffffff', 0, true)
  }
  k.pop()
  k.add(new THREE.TorusGeometry(0.29, 0.04, 8, 26), BRASS, T([0, 0, 0], [0, 0, 0]), undefined, { shine: 1 })
  return k.bake((p, _n, _tag, m) => {
    // the chamber's bubbles jiggle a touch; the barrel stands still
    if (p.y < 0.2) m.w1.set(0, 0.004, 0, p.x * 9)
  })
}

/** the domed turret with its brass ring, rivets and a rock pedestal under it */
function turretGeometry() {
  const k = new RKit(INK, INK_G)
  // the pedestal: a column of rock down to the floor
  k.add(tint(new THREE.CylinderGeometry(0.85, 1.25, 2.3, 14, 3), (_x, y) => C(y < -0.8 ? '#8f99c2' : '#a3a9cf')), '#ffffff', T([0, -1.32, 0]))
  // the ring, the dome and its rivets
  k.add(new THREE.TorusGeometry(0.98, 0.14, 10, 40), BRASS, T([0, -0.12, 0], [Math.PI / 2, 0, 0]), undefined, { shine: 1 })
  k.add(new THREE.SphereGeometry(1, 30, 12, 0, TAU, 0, Math.PI / 2), '#1f8fa0', T([0, -0.12, 0], [0, 0, 0], [0.9, 0.46, 0.9]))
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU
    ell(k, { c: [Math.cos(a) * 0.86, -0.04, Math.sin(a) * 0.86], r: [0.04, 0.04, 0.04] }, BRASS, [6, 4], 0.012, [0, 0, 0], { shine: 1 })
  }
  // a swivel collar on top
  k.add(new THREE.CylinderGeometry(0.42, 0.48, 0.14, 24), '#167a8a', T([0, 0.3, 0]))
  return k.bake()
}

/** where the level pips sit on the ring (the far arc, which shows over the turret) */
function pipSpot(i: number) {
  const a = Math.PI * (0.22 + (0.56 * i) / 6)
  return V(Math.cos(a) * 0.98, 0.02, -Math.sin(a) * 0.98)
}
const PIP_ON = new THREE.Color(2.2, 1.85, 0.7)
const PIP_OFF = new THREE.Color(0.28, 0.24, 0.36)

export interface CannonRig {
  /** place it at the cannon's spot: world (0, 0, field height / 2), the middle of the field's bottom edge */
  root: THREE.Group
  /** turns with the aim */
  turret: THREE.Group
  /** the barrel assembly of each level (only the current one shows); slides back on recoil */
  barrels: THREE.Group[]
  /** the current level (index into COSTS) */
  readonly level: number
  setLevel(i: number): void
  /** points the barrel along a field heading (radians: 0 right, π/2 straight up the screen) */
  setAim(heading: number): void
  /** recoil 0..1: the barrel kicks back and squashes */
  setRecoil(k: number): void
  /** the muzzle's world position, where torpedoes leave */
  muzzle(out: THREE.Vector3): THREE.Vector3
  /** every frame with the scene clock: the shine and the glowing pips */
  tick(t: number): void
  /** its meshes and materials (the cached geometry stays; see releaseGear) */
  dispose(): void
}

const barrelGeos: THREE.BufferGeometry[] = []
let turretGeo: THREE.BufferGeometry | null = null
let pipGeo: THREE.BufferGeometry | null = null
let gearMat: THREE.MeshToonMaterial | null = null

/** the toon material of the kit (cannon, nets, coins, torpedo cores) */
export function gearMaterial() {
  return (gearMat ??= swayMaterial([3, 2.4, 3]))
}

function cannonGeometries() {
  if (!barrelGeos.length) LOOKS.forEach((L, i) => barrelGeos.push(barrelGeometry(L, i)))
  turretGeo ??= turretGeometry()
  if (!pipGeo) {
    const k = new RKit(INK, 0.02)
    k.add(new THREE.SphereGeometry(0.075, 10, 8), '#ffffff', undefined, undefined, { flat: true })
    pipGeo = k.bake()
  }
  return { barrels: barrelGeos, turret: turretGeo, pip: pipGeo }
}

export function buildCannon(): CannonRig {
  const geos = cannonGeometries()
  const mat = gearMaterial()
  const root = new THREE.Group()
  root.name = 'cannon'
  const inst = swayInstances(1)
  const own: THREE.InstancedMesh[] = []
  const solo = (g: THREE.BufferGeometry) => {
    const { mesh } = swayMesh(g, mat, 1, inst)
    mesh.setMatrixAt(0, new THREE.Matrix4())
    own.push(mesh)
    return mesh
  }
  root.add(solo(geos.turret))
  const pips = swayMesh(geos.pip, mat, 7)
  own.push(pips.mesh)
  for (let i = 0; i < 7; i++) pips.mesh.setMatrixAt(i, new THREE.Matrix4().setPosition(pipSpot(i)))
  root.add(pips.mesh)
  const turret = new THREE.Group()
  turret.name = 'turret'
  root.add(turret)
  const barrels = geos.barrels.map((g, i) => {
    const holder = new THREE.Group()
    holder.name = `barrel${i + 1}`
    const mesh = solo(g)
    // the barrel geometry runs along +y; lay it forward (-z), the chamber over the pivot
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(0, BARREL_Y, CHAMBER_Z)
    holder.add(mesh)
    holder.visible = false
    turret.add(holder)
    return holder
  })
  let level = 0
  const setLevel = (i: number) => {
    level = Math.max(0, Math.min(COSTS.length - 1, i))
    barrels.forEach((b, j) => (b.visible = j === level))
    for (let j = 0; j < 7; j++) pips.mesh.setColorAt(j, j <= level ? PIP_ON : PIP_OFF)
    pips.mesh.instanceColor!.needsUpdate = true
  }
  setLevel(0)
  return {
    root,
    turret,
    barrels,
    get level() {
      return level
    },
    setLevel,
    setAim(heading) {
      turret.rotation.y = heading - Math.PI / 2
    },
    setRecoil(k) {
      const b = barrels[level]
      b.position.z = 0.24 * k
      b.scale.set(1 + 0.08 * k, 1 - 0.06 * k, 1 - 0.1 * k)
    },
    muzzle(out) {
      out.set(0, BARREL_Y, CHAMBER_Z - LOOKS[level].len - 0.08)
      return barrels[level].localToWorld(out)
    },
    tick(t) {
      inst.anim.setX(0, t)
      inst.anim.needsUpdate = true
      pips.anim.needsUpdate = true
      for (let j = 0; j < 7; j++) pips.anim.setX(j, t + j * 0.3)
    },
    dispose() {
      for (const m of own) disposeSway(m)
    },
  }
}

/* ---------------- torpedoes ---------------- */

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
void main() {
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  vTint = instanceColor;
  gl_Position = projectionMatrix * mv;
}`
const SHELL_FRAG = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying vec3 vTint;
void main() {
  float rim = 1.0 - max(0.0, dot(normalize(vN), vV));
  // a crisp bright rim, a faint body and a hard glint up at the top left
  float edge = smoothstep(0.55, 0.75, rim);
  float glint = smoothstep(0.86, 0.95, dot(normalize(vN), normalize(vec3(-0.5, 0.6, 0.6))));
  vec3 col = mix(vTint * 0.7 + 0.3, vec3(1.0), edge * 0.7) + glint * 0.9;
  gl_FragColor = vec4(col, 0.16 + edge * 0.72 + glint * 0.6);
  #include <colorspace_fragment>
}`

let coreGeo: THREE.BufferGeometry | null = null
function torpedoCore() {
  if (coreGeo) return coreGeo
  const k = new RKit(INK, 0.016)
  // a little torpedo along +x: a white body (tinted to its level), a brass nose, fins and a propeller
  limb(k, [-0.1, 0, 0], [0.08, 0, 0], 0.075, '#ffffff')
  horn(k, [0.11, 0, 0], [0.21, 0, 0], 0.068, BRASS, undefined, 10, { shine: 1 })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + Math.PI / 2
    k.add(fin([[0, 0], [0.09, 0], [0.0, 0.085]], 0.018, 1), '#ffffff', new THREE.Matrix4().makeRotationX(a).multiply(T([-0.19, 0.05, 0])), 0.014)
  }
  k.add(new THREE.TorusGeometry(0.045, 0.013, 5, 12), BRASS, T([-0.195, 0, 0], [0, Math.PI / 2, 0]), 0.01, { shine: 1 })
  coreGeo = k.bake()
  return coreGeo
}

const GLOW_VERT = /* glsl */ `
attribute vec3 tint;
attribute float size;
uniform float scale;
varying vec3 vTint;
void main() {
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * scale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`
const GLOW_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec3 vTint;
void main() {
  gl_FragColor = vec4(vTint, texture2D(map, gl_PointCoord).a * 0.85);
}`

/**
 * Torpedoes in flight, up to `cap` (MAX_BULLETS): each frame begin(), put() each one, end(). Three draws: the cores,
 * their bubbles and their glows. Call resize(scale) when the canvas changes (see Bubbles).
 */
export class TorpedoBatch {
  readonly group = new THREE.Group()
  private readonly core: ReturnType<typeof swayMesh>
  private readonly shell: THREE.InstancedMesh
  private readonly shellMat: THREE.ShaderMaterial
  private readonly glowGeo = new THREE.BufferGeometry()
  private readonly glowMat: THREE.ShaderMaterial
  private readonly gPos: Float32Array
  private readonly gTint: Float32Array
  private readonly gSize: Float32Array
  /** what end() marks for upload each frame */
  private readonly meshes: THREE.InstancedMesh[]
  private readonly glowAttrs: THREE.BufferAttribute[]
  private readonly colors = LEVEL_COLORS.map((c) => new THREE.Color(c))
  private readonly glows = LEVEL_COLORS.map((c) => new THREE.Color(c).multiplyScalar(1.4))
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3(1, 1, 1)
  private n = 0

  constructor(private readonly cap = MAX_BULLETS) {
    this.core = swayMesh(torpedoCore(), gearMaterial(), cap)
    this.core.mesh.count = 0
    this.shellMat = new THREE.ShaderMaterial({ vertexShader: SHELL_VERT, fragmentShader: SHELL_FRAG, transparent: true, depthWrite: false })
    this.shell = new THREE.InstancedMesh(new THREE.SphereGeometry(0.27, 18, 14), this.shellMat, cap)
    this.shell.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.shell.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage)
    this.shell.frustumCulled = false
    this.shell.renderOrder = 7
    this.shell.count = 0
    this.gPos = new Float32Array(cap * 3)
    this.gTint = new Float32Array(cap * 3)
    this.gSize = new Float32Array(cap)
    this.glowGeo.setAttribute('position', new THREE.BufferAttribute(this.gPos, 3).setUsage(THREE.DynamicDrawUsage))
    this.glowGeo.setAttribute('tint', new THREE.BufferAttribute(this.gTint, 3).setUsage(THREE.DynamicDrawUsage))
    this.glowGeo.setAttribute('size', new THREE.BufferAttribute(this.gSize, 1).setUsage(THREE.DynamicDrawUsage))
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: { map: { value: glowTexture() }, scale: { value: 500 } },
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const glow = new THREE.Points(this.glowGeo, this.glowMat)
    glow.frustumCulled = false
    glow.renderOrder = 6
    this.group.add(glow, this.core.mesh, this.shell)
    this.meshes = [this.core.mesh, this.shell]
    this.glowAttrs = ['position', 'tint', 'size'].map((name) => this.glowGeo.getAttribute(name) as THREE.BufferAttribute)
  }

  begin() {
    this.n = 0
  }

  /** a torpedo at world (x, y, z), heading along a field heading (radians), of cost level `level`; t spins it */
  put(x: number, y: number, z: number, heading: number, level: number, t: number) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.q.setFromEuler(this.e.set(t * 9, heading, 0, 'YXZ'))
    this.m.compose(this.p.set(x, y, z), this.q, this.s)
    this.core.mesh.setMatrixAt(i, this.m)
    this.core.mesh.setColorAt(i, this.colors[level])
    this.core.anim.setXYZW(i, t, 0, 0, 0)
    this.shell.setMatrixAt(i, this.m)
    this.shell.setColorAt(i, this.colors[level])
    this.gPos[i * 3] = x
    this.gPos[i * 3 + 1] = y - 0.05
    this.gPos[i * 3 + 2] = z
    const g = this.glows[level]
    this.gTint[i * 3] = g.r
    this.gTint[i * 3 + 1] = g.g
    this.gTint[i * 3 + 2] = g.b
    this.gSize[i] = 1.0 + 0.08 * Math.sin(t * 20 + i)
  }

  end() {
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const m = this.meshes[mi]
      m.count = this.n
      m.instanceMatrix.needsUpdate = true
      m.instanceColor!.needsUpdate = true
    }
    this.core.anim.needsUpdate = true
    this.glowGeo.setDrawRange(0, this.n)
    for (let i = 0; i < this.glowAttrs.length; i++) this.glowAttrs[i].needsUpdate = true
  }

  resize(scale: number) {
    this.glowMat.uniforms.scale.value = scale
  }

  dispose() {
    disposeSway(this.core.mesh)
    this.shell.geometry.dispose()
    this.shell.dispose()
    this.shellMat.dispose()
    this.glowGeo.dispose()
    this.glowMat.dispose()
  }
}

/* ---------------- the net ---------------- */

const ROPE_A = C('#e9c98a')
const ROPE_B = C('#a97a3e')

/** a rope along a curve, its strands twisting in two tones */
function rope(path: THREE.Curve<THREE.Vector3>, r: number, seg: number) {
  const g = new THREE.TubeGeometry(path, seg, r, 5, false).toNonIndexed()
  const uv = g.getAttribute('uv')
  const col = new Float32Array(uv.count * 3)
  for (let i = 0; i < uv.count; i += 3) {
    const u = (uv.getX(i) + uv.getX(i + 1) + uv.getX(i + 2)) / 3
    const v = (uv.getY(i) + uv.getY(i + 1) + uv.getY(i + 2)) / 3
    const c = Math.floor((v + u * seg * 0.6) * 2) % 2 ? ROPE_A : ROPE_B
    for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return g
}

let netGeo: THREE.BufferGeometry | null = null
function netGeometry() {
  if (netGeo) return netGeo
  const k = new RKit(INK, 0.03)
  const MER = 10
  const PAR = [0.36, 0.7]
  const onDome = (a: number, y: number) => V(Math.cos(a) * Math.sqrt(1 - y * y), y, Math.sin(a) * Math.sqrt(1 - y * y))
  // meridians from the crown down to the rim
  for (let i = 0; i < MER; i++) {
    const a = (i / MER) * TAU
    k.add(rope(new THREE.CatmullRomCurve3(Array.from({ length: 7 }, (_, j) => onDome(a, 1 - j / 6))), 0.04, 14), '#ffffff')
  }
  // rings round it, and the thicker rim
  for (const y of PAR) k.add(rope(new THREE.CatmullRomCurve3(Array.from({ length: 24 }, (_, j) => onDome((j / 24) * TAU, y)), true), 0.038, 40), '#ffffff')
  k.add(rope(new THREE.CatmullRomCurve3(Array.from({ length: 28 }, (_, j) => onDome((j / 28) * TAU, 0)), true), 0.06, 56), '#ffffff')
  // knots where they cross
  for (let i = 0; i < MER; i++) for (const y of PAR) ell(k, { c: onDome((i / MER) * TAU, y).toArray() as [number, number, number], r: [0.06, 0.06, 0.06] }, '#8f6232', [6, 5], 0.02)
  // floats round the rim, red and white
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * TAU
    const p = onDome(a, 0)
    ell(k, { c: [p.x * 1.03, 0.0, p.z * 1.03], r: [0.11, 0.08, 0.11] }, i % 2 ? '#ffffff' : '#ff4b4b', [10, 6], 0.022, [0, -a, 0])
  }
  netGeo = k.bake((p, _n, _tag, m) => {
    // the net breathes as it billows, and its rim pinches in round the catch
    const a = Math.atan2(p.z, p.x)
    m.w1.set(p.x * 0.05, 0.02, p.z * 0.05, a * 3)
    const low = 1 - Math.max(0, Math.min(1, p.y))
    m.pose.set(-p.x * 0.5 * low, -0.2 * low, -p.z * 0.5 * low)
  })
  return netGeo
}

/**
 * Nets bursting over creatures: begin(), put() each, end(). The net is a dome one unit across its rim (radius 1);
 * scale it to the creature. open 0..1 pinches the rim in (wrapping the catch); fade 0..1 dissolves it.
 */
export class NetBatch {
  readonly mesh: THREE.InstancedMesh
  private readonly s: ReturnType<typeof swayMesh>
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private n = 0

  constructor(private readonly cap = MAX_BULLETS) {
    this.s = swayMesh(netGeometry(), gearMaterial(), cap)
    this.mesh = this.s.mesh
    this.mesh.count = 0
    this.mesh.renderOrder = 3
  }

  begin() {
    this.n = 0
  }

  /** a net centred at world (x, y, z), `radius` across its rim, squashed to `height`, turned `spin`, at time t */
  put(x: number, y: number, z: number, radius: number, height: number, spin: number, open: number, fade: number, t: number) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(0, spin, 0)), this.sc.set(radius, height, radius))
    this.mesh.setMatrixAt(i, this.m)
    this.s.anim.setXYZW(i, t, open, 0, 0)
    this.s.fade.setX(i, fade)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.s.anim.needsUpdate = true
    this.s.fade.needsUpdate = true
  }

  dispose() {
    disposeSway(this.mesh)
  }
}

/* ---------------- coins ---------------- */

let coinGeo: THREE.BufferGeometry | null = null
/** the coin (cached) */
export function coinGeometry() {
  if (coinGeo) return coinGeo
  const k = new RKit(INK, 0.018)
  // bottom to top, so the lathe's faces point outwards
  const prof: P2[] = [[0, -0.018], [0.118, -0.018], [0.13, -0.027], [0.15, -0.022], [0.158, 0], [0.15, 0.022], [0.13, 0.027], [0.118, 0.018], [0, 0.018]]
  k.add(tint(lathe(prof, 24), (x, y, z) => C(Math.hypot(x, z) > 0.125 || Math.abs(y) < 0.015 ? '#f0a51e' : '#ffc93c')), '#ffffff', undefined, undefined, { shine: 1 })
  for (const s of [1, -1]) {
    const m = new THREE.Matrix4().makeRotationX(s * -Math.PI / 2)
    k.push(m)
    paint(k, flatSurf(0.0195), star(0, 0, 0.075, 0.032, 5), C('#ffe68a', 1.1), 0, false, undefined, 2, Infinity, { shine: 1 })
    k.pop()
  }
  coinGeo = k.bake()
  return coinGeo
}

/** gold coins in flight: begin(), put() each, end() */
export class CoinBatch {
  readonly mesh: THREE.InstancedMesh
  private readonly s: ReturnType<typeof swayMesh>
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly p = new THREE.Vector3()
  private readonly sc = new THREE.Vector3()
  private n = 0

  constructor(private readonly cap = 400) {
    this.s = swayMesh(coinGeometry(), gearMaterial(), cap)
    this.mesh = this.s.mesh
    this.mesh.count = 0
    this.mesh.renderOrder = 8
  }

  begin() {
    this.n = 0
  }

  /** a coin at world (x, y, z), face up at rest: `spin` flips it end over end (radians), `tilt` tips that flip about x; fade dissolves */
  put(x: number, y: number, z: number, spin: number, tilt: number, scale = 1, fade = 0) {
    if (this.n >= this.cap) return
    const i = this.n++
    this.m.compose(this.p.set(x, y, z), this.q.setFromEuler(this.e.set(tilt, 0, spin, 'XZY')), this.sc.setScalar(scale))
    this.mesh.setMatrixAt(i, this.m)
    this.s.fade.setX(i, fade)
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.s.fade.needsUpdate = true
  }

  dispose() {
    disposeSway(this.mesh)
  }
}

/** the cached kit geometry and material, built ahead of time */
export function warmGear() {
  cannonGeometries()
  torpedoCore()
  netGeometry()
  coinGeometry()
  gearMaterial()
}

/** lets go of the GPU copies of the kit's cached geometry and material (they stay built) */
export function releaseGear() {
  for (const g of [...barrelGeos, turretGeo, pipGeo, coreGeo, netGeo, coinGeo]) g?.dispose()
  gearMat?.dispose()
}
