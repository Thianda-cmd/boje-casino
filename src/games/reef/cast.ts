import * as THREE from 'three'
import { toonRamp } from '../../lib/three/toon'
import { buildCreature } from './creatures'
import { SPECIES, type FishId } from './rules'

/*
  How the cast is drawn. Each species is one InstancedMesh (CreatureBatch): its geometry carries the motion of every
  vertex (kit.ts), and each instance its own clock, pose, flash and mood (iAnim), so a whole school swims, blinks and
  flinches in one draw call, outlines included.

  The view: the reef is the plane y = 0 (field x = world x, field y = world -z) seen from a camera pitched PITCH
  down. creatureMatrix() stands each creature in the swim plane facing the camera the way it was modelled to be seen
  (CAST[id].view), pointing along its heading on screen. A fish swimming left shows its other flank: `bank` eases
  from +1 (heading right) to -1 (left) through 0, where it shows its back, like a fish rolling into a turn.

  Hit shapes are ellipses in the swim plane fitted to each silhouette as the camera sees it (CAST[id].hit, in model
  units, so they scale with the drawn size): each model, stood by creatureMatrix, was projected onto the plane along
  the view and rasterised, and the ellipse is the one with the same area moments, at 90%. Refit them if a model or
  its view changes. inHit() tests a torpedo against one.
*/

/** the camera looks down onto the reef this steeply (radians from the horizontal) */
export const PITCH = (64 * Math.PI) / 180
/** the swim plane's height, and the sea floor's base height under it (reefset's floorAt adds the dunes) */
export const SWIM_Y = 0
export const FLOOR_Y = -2.2

export type Orient = 'swim' | 'upright' | 'front'

/** an ellipse in the swim plane, in model units: centre (cx along the heading, cy across it) and half axes a, b */
export interface HitShape {
  cx: number
  cy: number
  a: number
  b: number
}

export interface CastSpec {
  /** drawn size in reef units (the model is about one unit long, or a manta one unit across) */
  size: number
  /** how far the camera looks down onto its flank (radians): 0 sees it side on, π/2 straight onto its back */
  view: number
  /** swim: turns with its heading; upright: keeps its back up and turns round (seahorse); front: always faces us */
  orient: Orient
  /** speeds of sway channels 1 and 2 and of the glow pulse, radians per second of its clock */
  beat: [number, number, number]
  /**
   * How far below the swim plane it swims: the bigger the deeper, so where bodies cross, the smaller one (easy to
   * lose behind a manta) is drawn on top; the whale passes under everything.
   */
  depth: number
  /** its hit ellipse (model units) */
  hit: HitShape
  /** front / upright creatures lean into their motion by up to this much (radians) */
  lean: number
}

export const CAST: Record<FishId, CastSpec> = {
  clown: { size: 1.05, view: 0.6, orient: 'swim', beat: [9, 13, 0], depth: 0, hit: { cx: -0.12, cy: 0.01, a: 0.51, b: 0.32 }, lean: 0 },
  tang: { size: 1.15, view: 0.5, orient: 'swim', beat: [8, 11, 0], depth: 0, hit: { cx: -0.1, cy: 0.01, a: 0.5, b: 0.32 }, lean: 0 },
  puffer: { size: 1.1, view: 0.75, orient: 'swim', beat: [7, 15, 0], depth: 0, hit: { cx: -0.04, cy: 0, a: 0.39, b: 0.33 }, lean: 0 },
  angel: { size: 1.3, view: 0.3, orient: 'swim', beat: [4.5, 7, 0], depth: 0, hit: { cx: -0.1, cy: -0.01, a: 0.36, b: 0.63 }, lean: 0 },
  seahorse: { size: 1.25, view: 0.2, orient: 'upright', beat: [2.4, 22, 0], depth: 0, hit: { cx: 0.02, cy: 0.03, a: 0.22, b: 0.52 }, lean: 0.35 },
  turtle: { size: 1.8, view: 1.15, orient: 'swim', beat: [2.6, 2.6, 0], depth: 0.12, hit: { cx: 0.04, cy: -0.02, a: 0.41, b: 0.48 }, lean: 0 },
  octopus: { size: 1.8, view: 1.0, orient: 'swim', beat: [3.2, 2, 0], depth: 0.12, hit: { cx: -0.04, cy: -0.02, a: 0.41, b: 0.43 }, lean: 0 },
  manta: { size: 2.8, view: 1.25, orient: 'swim', beat: [2.2, 3, 0], depth: 0.28, hit: { cx: -0.03, cy: -0.03, a: 0.34, b: 0.41 }, lean: 0 },
  shark: { size: 3.1, view: 0.95, orient: 'swim', beat: [3, 2, 0], depth: 0.34, hit: { cx: 0.05, cy: -0.04, a: 0.52, b: 0.24 }, lean: 0 },
  whale: { size: 5.6, view: 0.5, orient: 'swim', beat: [1.6, 1.6, 0], depth: 0.6, hit: { cx: 0.05, cy: -0.06, a: 0.5, b: 0.31 }, lean: 0 },
  crab: { size: 1.5, view: 1.1, orient: 'front', beat: [10, 10, 24], depth: 0, hit: { cx: 0, cy: 0, a: 0.51, b: 0.3 }, lean: 0.14 },
  jelly: { size: 1.45, view: 0.45, orient: 'front', beat: [2.6, 1.3, 2.6], depth: 0, hit: { cx: 0, cy: -0.05, a: 0.31, b: 0.48 }, lean: 0.2 },
  chest: { size: 1.45, view: 0.8, orient: 'front', beat: [16, 1.8, 3], depth: 0, hit: { cx: 0, cy: 0.07, a: 0.43, b: 0.53 }, lean: 0.06 },
}

/** every species, in paytable order */
export const CAST_IDS: readonly FishId[] = SPECIES.map((s) => s.id)

/* ---------------- the material ---------------- */

export const RAMP = [92, 165, 225, 255]
const uTime = { value: 0 }

/** moves the shared clock (seconds) that sweeps the gold shine; call once a frame */
export function tickCast(t: number) {
  uTime.value = t
}

const VERT_HEAD = /* glsl */ `
attribute vec4 aW1;
attribute vec4 aW2;
attribute vec3 aPose;
attribute vec4 aFx;
attribute vec4 iAnim;
attribute float iFade;
uniform vec4 uBeat;
varying float vFlat;
varying vec3 vFx;
varying vec3 vWorld;
varying float vFade;
`

const VERT_BODY = /* glsl */ `
float clk = iAnim.x;
vec3 transformed = position + aW1.xyz * sin(clk * uBeat.x + aW1.w) + aW2.xyz * sin(clk * uBeat.y + aW2.w) + aPose * iAnim.y;
// face layers (kit.ts FACE): the open eyes hide for a blink (a short beat every uBeat.w seconds of its clock) and
// once caught; the white of an eye only for a blink
float mood = step(0.5, iAnim.w);
float blink = step(0.955, fract(clk / uBeat.w + 0.31));
float L = aFx.w;
float shut = (1.0 - mood) * blink;
float show = L < 0.5 ? 1.0 : L < 1.5 ? (1.0 - mood) * (1.0 - blink) : L < 2.5 ? shut : L < 3.5 ? mood : L < 4.5 ? 1.0 - mood : 1.0 - shut;
// a hidden part collapses to a point and draws nothing
transformed *= show;
vFlat = aFx.x;
vFx = vec3(aFx.y * (0.55 + 0.45 * sin(clk * uBeat.z)), aFx.z, iAnim.z);
vFade = iFade;
`

const FRAG_HEAD = /* glsl */ `
uniform float uTime;
varying float vFlat;
varying vec3 vFx;
varying vec3 vWorld;
varying float vFade;
`

const FRAG_BODY = /* glsl */ `
// a dissolve (a net fading away, a creature popping into coins, a boom clearing): holes open in blobs, following
// a smooth noise over the world, so it erodes like a cartoon puff rather than a sorted fade
if (vFade > 0.0) {
  vec3 q = vWorld * 3.1;
  vec3 i = floor(q);
  vec3 f = fract(q);
  f = f * f * (3.0 - 2.0 * f);
  #define H(o) fract(sin(dot(i + o, vec3(127.1, 311.7, 74.7))) * 43758.5453)
  float n = mix(mix(mix(H(vec3(0, 0, 0)), H(vec3(1, 0, 0)), f.x), mix(H(vec3(0, 1, 0)), H(vec3(1, 1, 0)), f.x), f.y), mix(mix(H(vec3(0, 0, 1)), H(vec3(1, 0, 1)), f.x), mix(H(vec3(0, 1, 1)), H(vec3(1, 1, 1)), f.x), f.y), f.z);
  #undef H
  if (n < vFade * 1.05) discard;
}
outgoingLight = mix(outgoingLight, diffuseColor.rgb, vFlat);
// glow (the jelly, the fuse, the chest's seam) pulses with the creature's clock
outgoingLight += diffuseColor.rgb * vFx.x * 0.9;
// a band of gold shine sweeping across
float band = fract((vWorld.x * 0.32 - vWorld.z * 0.21) * 0.5 - uTime * 0.22);
outgoingLight += diffuseColor.rgb * vFx.y * (smoothstep(0.0, 0.04, band) * (1.0 - smoothstep(0.04, 0.12, band))) * 1.15 * (1.0 - vFlat);
// the hit flash: lit parts go white, the eyes and ink stay
outgoingLight = mix(outgoingLight, vec3(1.3, 1.25, 1.15), vFx.z * (1.0 - vFlat));
`

/**
 * The toon material of an instanced swaying model (the cast, the reef's decor, the cannon, nets and coins). Every
 * one shares one program; the beat speeds are per material: x and y the sway channels, z the glow pulse, w the blink
 * period. A mesh drawn with it carries the per-instance attributes iAnim (vec4: clock, pose, flash, mood) and iFade
 * (float: 0 solid .. 1 gone): swayMesh() makes such a mesh.
 */
export function swayMaterial(beat: [number, number, number], blinkEvery = 3.4) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonRamp(RAMP) })
  const uBeat = { value: new THREE.Vector4(beat[0], beat[1], beat[2], blinkEvery) }
  m.onBeforeCompile = (s) => {
    s.uniforms.uBeat = uBeat
    s.uniforms.uTime = uTime
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_HEAD)
      .replace('#include <begin_vertex>', VERT_BODY)
      .replace('#include <project_vertex>', '#include <project_vertex>\n#ifdef USE_INSTANCING\nvWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\n#else\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\n#endif')
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_HEAD).replace('#include <opaque_fragment>', FRAG_BODY + '#include <opaque_fragment>')
  }
  m.customProgramCacheKey = () => 'reef-sway'
  m.userData.beat = uBeat
  return m
}

/**
 * The per-instance attributes a sway mesh needs, for `cap` instances (still props can share one set between several
 * meshes and tick only the clock).
 */
export function swayInstances(cap: number) {
  return {
    anim: new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage),
    fade: new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage),
  }
}

/** an InstancedMesh of a sway geometry: its base attributes and index shared with `base`, its instance attributes `inst` */
export function swayMesh(base: THREE.BufferGeometry, mat: THREE.Material, cap: number, inst = swayInstances(cap)) {
  const g = new THREE.BufferGeometry()
  for (const [name, attr] of Object.entries(base.attributes)) g.setAttribute(name, attr)
  g.setIndex(base.index)
  g.setAttribute('iAnim', inst.anim)
  g.setAttribute('iFade', inst.fade)
  const mesh = new THREE.InstancedMesh(g, mat, cap)
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage)
  mesh.frustumCulled = false
  return { mesh, ...inst }
}

/**
 * Frees a mesh made by swayMesh(): its own instance buffers and the object. The base geometry it shares (a cached
 * creature or prop) is left alone, so other meshes of it keep drawing without uploading it again.
 */
export function disposeSway(mesh: THREE.InstancedMesh) {
  const g = mesh.geometry
  for (const name of Object.keys(g.attributes)) if (name !== 'iAnim' && name !== 'iFade') g.deleteAttribute(name)
  g.setIndex(null)
  g.dispose()
  mesh.dispose()
}

const mats = new Map<FishId, THREE.MeshToonMaterial>()
/** a species' material (shared by every batch of it) */
export function castMaterial(id: FishId) {
  let m = mats.get(id)
  if (!m) mats.set(id, (m = swayMaterial(CAST[id].beat)))
  return m
}

const geos = new Map<FishId, THREE.BufferGeometry>()
/** a species' geometry (built once and kept) */
export function creatureGeometry(id: FishId) {
  let g = geos.get(id)
  if (!g) {
    g = buildCreature(id, CAST[id].size, CAST[id].view)
    g.computeBoundingSphere()
    geos.set(id, g)
  }
  return g
}

/* ---------------- a batch: every creature of one kind, one draw ---------------- */

const WHITE = new THREE.Color(1, 1, 1)

/**
 * Draws up to `cap` creatures of one species in one call. Each frame: begin(), put() each creature on show (its
 * matrix from creatureMatrix, its clock and state), end(). Nothing is allocated per frame.
 */
export class CreatureBatch {
  readonly mesh: THREE.InstancedMesh
  private readonly anim: THREE.InstancedBufferAttribute
  private readonly fade: THREE.InstancedBufferAttribute
  private n = 0

  constructor(
    readonly id: FishId,
    readonly cap: number,
  ) {
    const s = swayMesh(creatureGeometry(id), castMaterial(id), cap)
    this.mesh = s.mesh
    this.anim = s.anim
    this.fade = s.fade
    this.mesh.name = id
    this.mesh.count = 0
  }

  begin() {
    this.n = 0
  }

  /**
   * One creature this frame. clock: its own swim clock in seconds (advance it by dt × its swim rate: faster when it
   * flees or struggles); pose 0..1 (puffer puff, octopus jet, chest lid); flash 0..1 (white hit flash); mood 1 shows
   * the dizzy caught face; fade 0..1 dissolves it (popping into coins); tint multiplies its colours. Returns false when
   * the batch is full.
   */
  put(m: THREE.Matrix4, clock: number, pose = 0, flash = 0, mood = 0, fade = 0, tint: THREE.Color = WHITE) {
    if (this.n >= this.cap) return false
    const i = this.n++
    this.mesh.setMatrixAt(i, m)
    this.anim.setXYZW(i, clock, pose, flash, mood)
    this.fade.setX(i, fade)
    this.mesh.setColorAt(i, tint)
    return true
  }

  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
    this.anim.needsUpdate = true
    this.fade.needsUpdate = true
    this.mesh.instanceColor!.needsUpdate = true
  }

  /** frees this batch (the species' geometry and material stay cached; see releaseCast) */
  dispose() {
    disposeSway(this.mesh)
  }
}

/* ---------------- standing a creature in the swim plane ---------------- */

const SP = Math.sin(PITCH)
const CP = Math.cos(PITCH)
/** screen right, screen up and towards the camera, in world space */
const VX = new THREE.Vector3(1, 0, 0)
const VY = new THREE.Vector3(0, CP, -SP)
const VZ = new THREE.Vector3(0, SP, CP)
const _h = new THREE.Vector3()
const _n = new THREE.Vector3()
const _y = new THREE.Vector3()
const _z = new THREE.Vector3()
const _r = new THREE.Matrix4()
const _s = new THREE.Vector3()

/**
 * A creature's instance matrix. (x, y): its field position; heading: the direction it swims in the field (radians,
 * 0 = right, π/2 = up the screen); bank: +1 when it swims right, -1 left, easing between the two when it turns
 * (for front-facing creatures it just picks the lean); scale: on top of its drawn size (a pop, a phone boost); roll:
 * a turn about its own length (a caught fish going belly up); lift: height above its swim depth.
 */
export function creatureMatrix(out: THREE.Matrix4, id: FishId, x: number, y: number, heading: number, bank: number, scale = 1, roll = 0, lift = 0) {
  const c = CAST[id]
  const rho = c.view
  // the heading as it looks on screen (the far side is foreshortened)
  const hx = Math.cos(heading)
  const hy = Math.sin(heading) * SP
  const hl = Math.hypot(hx, hy) || 1
  const cx = hx / hl
  const cy = hy / hl
  if (c.orient === 'swim') {
    _h.copy(VX).multiplyScalar(cx).addScaledVector(VY, cy)
    _n.copy(VX).multiplyScalar(-cy).addScaledVector(VY, cx)
    _y.copy(_n).multiplyScalar(bank * Math.cos(rho)).addScaledVector(VZ, Math.sin(rho)).normalize()
    _z.crossVectors(_h, _y)
    out.makeBasis(_h, _y, _z)
  } else {
    // facing screen right with its back up; then it turns round about its own up (upright) and leans into its way
    _y.copy(VY).multiplyScalar(Math.cos(rho)).addScaledVector(VZ, Math.sin(rho))
    _z.copy(VY).multiplyScalar(-Math.sin(rho)).addScaledVector(VZ, Math.cos(rho))
    out.makeBasis(VX, _y, _z)
    if (c.orient === 'upright') {
      out.multiply(_r.makeRotationY(((1 - bank) / 2) * Math.PI))
      out.multiply(_r.makeRotationZ(Math.max(-1, Math.min(1, cy)) * c.lean))
    } else out.multiply(_r.makeRotationZ(-bank * c.lean))
  }
  if (roll) out.multiply(_r.makeRotationX(roll))
  out.scale(_s.setScalar(c.size * scale))
  return out.setPosition(x, SWIM_Y + lift - c.depth, -y)
}

/** the creature's hit ellipse in reef units, centred where the scene should test it */
export function hitShape(id: FishId, scale = 1): HitShape {
  const h = CAST[id].hit
  const s = CAST[id].size * scale
  return { cx: h.cx * s, cy: h.cy * s, a: h.a * s, b: h.b * s }
}

/** a radius that holds the whole hit ellipse, for a quick first test */
export function hitRadius(id: FishId, scale = 1) {
  const h = CAST[id].hit
  return (Math.hypot(h.cx, h.cy) + Math.max(h.a, h.b)) * CAST[id].size * scale
}

/**
 * Does a torpedo of radius r at field point (px, py) touch the creature at (x, y)? heading and bank as given to
 * creatureMatrix; the ellipse turns with a swimming creature and stays square to the screen for the others.
 */
export function inHit(id: FishId, x: number, y: number, heading: number, bank: number, scale: number, px: number, py: number, r: number) {
  const c = CAST[id]
  const h = c.hit
  const s = c.size * scale
  const ang = c.orient === 'swim' ? heading : 0
  const dx = px - x
  const dy = py - y
  const ca = Math.cos(ang)
  const sa = Math.sin(ang)
  // into the creature's frame: u along its heading, v across (towards its back's side of the screen)
  let u = dx * ca + dy * sa
  let v = -dx * sa + dy * ca
  if (c.orient === 'swim' && bank < 0) v = -v
  if (c.orient === 'upright' && bank < 0) u = -u
  u -= h.cx * s
  v -= h.cy * s
  const A = h.a * s + r
  const B = h.b * s + r
  return (u * u) / (A * A) + (v * v) / (B * B) <= 1
}

/** lets go of the GPU copies of every cached geometry and material (they stay built for the next visit) */
export function releaseCast() {
  for (const m of mats.values()) m.dispose()
  for (const g of geos.values()) g.dispose()
  toonRamp(RAMP).dispose()
}
