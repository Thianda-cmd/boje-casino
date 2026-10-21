import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, glowTexture, ringTexture, rnd } from '../../lib/three/fx'
import { isMuted } from '../../lib/sound'
import { penaltySfx } from './sound'
import { BALL_R, buildBall, buildPlayer, keeperLook, releaseModels, strikerSpec, type Expr, type PlayerSpec, type Rig } from './models'
import { BOARD_Z, GOAL, NET, buildStadium, type Stadium } from './stadium'
import { LEVELS, zoneCol, zoneRow, type Difficulty, type Shot, type Zone } from './rules'

/*
  The Penalty Shootout stage: a night stadium seen from behind the striker, the keeper bouncing on his line, the
  crowd packed behind the goal. A shot is decided before the striker moves (rules.ts); this scene only acts it out:
  the run-up and the kick, the ball curling into its corner with a trail, the keeper's dive (planned so his gloves
  meet the ball on a save, or reach for the zone he read on a goal, sometimes just a fingertip short, in slow motion),
  the net bulging, the crowd going up or groaning, and the reactions. Everything runs on the scene clock, so turbo,
  "hurry" and slow motion only change how fast it runs.
*/

const FOV0 = 20
const CAM = new THREE.Vector3(-0.55, 4.25, 25.5)
/** a tall stage: a touch further left, so the striker stands in the picture rather than at its edge */
const CAM_NARROW = new THREE.Vector3(-0.95, 4.25, 25.5)
const LOOK = new THREE.Vector3(0, 1.0, 0)
const SPOT = new THREE.Vector3(0, BALL_R, 11)
const KEEPER_Z = 0.42
/** the keeper's gloves meet the ball this far out from the goal line */
const SAVE_Z = KEEPER_Z + 0.2
/** the ball is drawn this much bigger in flight, so it reads all the way to the goal */
const FLIGHT_SCALE = 1.22
/** the ball's radius as it is drawn arriving at the goal, ink outline included */
const BALL_SEEN = (BALL_R + 0.022) * FLIGHT_SCALE
const RUN_START = new THREE.Vector3(-1.75, 0, 13.7)
const COLS = [-2.44, 0, 2.44]
const ROW_Y = [1.83, 0.61]
const TAU = Math.PI * 2

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const smooth = (t: number) => t * t * (3 - 2 * t)
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t * t
/** the angle a, brought within π of b, so a turn takes the short way round */
const near = (a: number, b: number) => a + Math.round((b - a) / TAU) * TAU

export const zoneCenter = (z: Zone) => V(COLS[zoneCol(z)], ROW_Y[zoneRow(z)], 0)

/* ------------------------------------------------------------------ */
/*  Poses                                                               */
/* ------------------------------------------------------------------ */

const KEYS = ['y', 'x', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz', 'nx', 'ny', 'nz', 'lsx', 'lsy', 'lsz', 'le', 'rsx', 'rsy', 'rsz', 're', 'lhx', 'lhy', 'lhz', 'lk', 'la', 'rhx', 'rhy', 'rhz', 'rk', 'ra'] as const
type Key = (typeof KEYS)[number]
type Pose = Record<Key, number>
const pose = (p: Partial<Pose> = {}): Pose => {
  const o = {} as Pose
  for (const k of KEYS) o[k] = p[k] ?? 0
  return o
}
const mixPose = (a: Pose, b: Pose, t: number, out: Pose = pose()) => {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t
  return out
}
const with_ = (a: Pose, b: Partial<Pose>) => {
  const o = { ...a }
  for (const k in b) o[k as Key] += b[k as Key] ?? 0
  return o
}

function applyPose(r: Rig, p: Pose) {
  r.hips.position.set(p.x, r.hipH + p.y, 0)
  r.hips.rotation.set(p.rx, p.ry, p.rz)
  r.spine.rotation.set(p.sx, p.sy, p.sz)
  r.neck.rotation.set(p.nx, p.ny, p.nz)
  // arms[0] / legs[0] are his right side, [1] his left
  const [ra, la] = r.arms
  la.a.rotation.set(p.lsx, p.lsy, p.lsz)
  la.b.rotation.set(p.le, 0, 0)
  ra.a.rotation.set(p.rsx, p.rsy, p.rsz)
  ra.b.rotation.set(p.re, 0, 0)
  const [rl, ll] = r.legs
  ll.a.rotation.set(p.lhx, p.lhy, p.lhz)
  ll.b.rotation.set(p.lk, 0, 0)
  ll.c.rotation.set(p.la, 0, 0)
  rl.a.rotation.set(p.rhx, p.rhy, p.rhz)
  rl.b.rotation.set(p.rk, 0, 0)
  rl.c.rotation.set(p.ra, 0, 0)
}

const STAND = pose({ lsz: 0.14, rsz: -0.14, le: -0.2, re: -0.2, lhz: 0.04, rhz: -0.04, lk: 0.05, rk: 0.05 })
/** the keeper's crouch on his line: knees bent, weight forward, arms out */
const READY = pose({ y: -0.13, sx: 0.32, nx: -0.28, lsx: -0.45, rsx: -0.45, lsz: 0.8, rsz: -0.8, le: -0.75, re: -0.75, lhx: -0.5, rhx: -0.5, lhz: 0.16, rhz: -0.16, lk: 0.95, rk: 0.95, la: -0.42, ra: -0.42 })
/** flying through the air at full stretch, arms overhead */
const DIVE = pose({ sx: -0.08, nx: -0.15, lsx: -2.95, rsx: -2.95, lsz: 0.22, rsz: -0.22, le: -0.08, re: -0.08, lhx: 0.12, rhx: -0.06, lk: 0.35, rk: 0.6, la: 0.4, ra: 0.4, lhz: 0.05, rhz: -0.12 })
/** lying on the grass after a dive */
const LIE = pose({ sx: -0.05, nx: 0.1, lsx: -2.7, rsx: -2.5, lsz: 0.35, rsz: -0.1, le: -0.4, re: -0.25, lhx: -0.3, rhx: 0.1, lk: 0.9, rk: 0.5, la: 0.3, ra: 0.3 })
/** a low block: down on his knees, legs splayed, gloves out low */
const SPREAD = pose({ y: -0.42, sx: 0.28, nx: -0.2, lsx: -1.05, rsx: -1.05, lsz: 0.55, rsz: -0.55, le: -0.25, re: -0.25, lhx: -0.25, rhx: -0.25, lhz: 0.75, rhz: -0.75, lk: 1.55, rk: 1.55, la: 0.6, ra: 0.6 })
/** a block at chest height: knees bent, gloves out in front */
const BLOCK = pose({ y: -0.1, sx: 0.18, nx: -0.15, lsx: -1.45, rsx: -1.45, lsz: 0.2, rsz: -0.2, le: -0.35, re: -0.35, lhx: -0.35, rhx: -0.35, lhz: 0.14, rhz: -0.14, lk: 0.6, rk: 0.6, la: -0.25, ra: -0.25 })
/** sitting on the grass, beaten */
const SIT = pose({ y: -0.74, sx: 0.32, nx: 0.42, lsx: 0.55, rsx: 0.55, lsz: 0.45, rsz: -0.45, le: -0.3, re: -0.3, lhx: -1.35, rhx: -1.25, lhz: 0.2, rhz: -0.15, lk: 1.25, rk: 1.05, la: -0.1, ra: -0.1 })

/** the striker's run: a stride cycle at phase φ (radians) */
function runPose(phi: number, k = 1): Pose {
  const s = Math.sin(phi)
  const c = Math.cos(phi)
  return pose({
    y: -0.035 + 0.05 * Math.abs(c) * k,
    sx: 0.2 * k,
    nx: -0.12 * k,
    ry: 0.1 * s * k,
    sy: -0.16 * s * k,
    lhx: -0.8 * s * k,
    rhx: 0.8 * s * k,
    lk: (0.25 + 1.15 * Math.max(0, Math.sin(phi + 1.1))) * k,
    rk: (0.25 + 1.15 * Math.max(0, Math.sin(phi + 1.1 + Math.PI))) * k,
    la: 0.15 * k,
    ra: 0.15 * k,
    lsx: 0.75 * s * k,
    rsx: -0.75 * s * k,
    lsz: 0.16,
    rsz: -0.16,
    le: -0.4 - 0.9 * k,
    re: -0.4 - 0.9 * k,
  })
}

/** the kick, t seconds after the plant (contact at KICK_AT) */
const KICK_AT = 0.17
function kickPose(t: number): Pose {
  // the right leg draws back, whips through the ball and follows through; the left arm flies out for balance
  const keys: [number, Partial<Pose>][] = [
    [0, { y: -0.04, sx: 0.12, lhx: -0.35, lk: 0.35, rhx: 0.35, rk: 0.9, lsz: 0.5, rsz: -0.3, lsx: -0.2, rsx: 0.3, le: -0.6, re: -0.6, sy: 0.1 }],
    [0.1, { y: -0.07, sx: -0.06, sy: 0.32, ry: 0.15, lhx: -0.3, lk: 0.42, la: -0.2, rhx: 0.95, rk: 1.75, ra: 0.5, lsz: 1.25, lsx: -0.35, le: -0.35, rsx: 0.6, rsz: -0.45, re: -0.5, nx: 0.25 }],
    [KICK_AT, { y: -0.05, sx: 0.12, sy: -0.15, ry: -0.1, lhx: -0.25, lk: 0.38, la: -0.15, rhx: -1.05, rk: 0.12, ra: 0.75, lsz: 1.1, lsx: 0.25, le: -0.3, rsx: -0.55, rsz: -0.35, re: -0.6, nx: 0.3 }],
    [0.32, { y: 0.03, sx: 0.08, sy: -0.3, ry: -0.2, lhx: -0.1, lk: 0.15, la: 0.35, rhx: -1.55, rk: 0.3, ra: 0.6, lsz: 0.85, lsx: 0.45, le: -0.4, rsx: -0.8, rsz: -0.4, re: -0.8, nx: 0.05 }],
    [0.62, { y: 0.0, sx: 0.04, sy: -0.15, ry: -0.1, lhx: -0.05, lk: 0.1, la: 0.1, rhx: -0.35, rk: 0.35, ra: 0.2, lsz: 0.4, lsx: 0.1, le: -0.3, rsx: -0.2, rsz: -0.25, re: -0.4, nx: -0.08 }],
  ]
  let i = 1
  while (i < keys.length - 1 && t > keys[i][0]) i++
  const [t0, a] = keys[i - 1]
  const [t1, b] = keys[i]
  const u = clamp01((t - t0) / (t1 - t0))
  // the strike itself is a whip: fast through the middle
  const k = i === 2 ? easeIn(u) : smooth(u)
  return mixPose(pose(a), pose(b), k)
}

/* ------------------------------------------------------------------ */
/*  Actors                                                              */
/* ------------------------------------------------------------------ */

type Gen = (t: number) => Pose

class Actor {
  gen: Gen = () => STAND
  t0 = 0
  from: Pose | null = null
  fade = 0
  fadeDur = 0.2
  last = pose()
  /** extra on top of the generated pose (a look round, a lean) */
  constructor(readonly rig: Rig) {}
  play(gen: Gen, now: number, fade = 0.2) {
    this.from = { ...this.last }
    this.fade = 0
    this.fadeDur = Math.max(0.001, fade)
    this.gen = gen
    this.t0 = now
  }
  update(now: number, dt: number) {
    let p = this.gen(now - this.t0)
    if (this.from && this.fade < this.fadeDur) {
      this.fade += dt
      p = mixPose(this.from, p, smooth(clamp01(this.fade / this.fadeDur)))
    }
    applyPose(this.rig, p)
    this.last = p
  }
}

/* ------------------------------------------------------------------ */
/*  Effects                                                             */
/* ------------------------------------------------------------------ */

const TRAIL_N = 30
/** a ribbon behind the ball that always faces the camera: a hot white core at the ball cooling to gold along the
 *  tail, opaque enough to read on the green and bright enough to catch the bloom */
class Trail {
  readonly mesh: THREE.Mesh
  private readonly pts: THREE.Vector3[] = []
  private readonly pos = new Float32Array(TRAIL_N * 2 * 3)
  private readonly alpha = new Float32Array(TRAIL_N * 2)
  private readonly across = new Float32Array(TRAIL_N * 2)
  private readonly geo = new THREE.BufferGeometry()
  readonly mat: THREE.ShaderMaterial
  on = false
  fadeOut = 0
  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage))
    this.geo.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage))
    for (let i = 0; i < TRAIL_N; i++) this.across.set([1, -1], i * 2)
    this.geo.setAttribute('across', new THREE.BufferAttribute(this.across, 1))
    const idx: number[] = []
    for (let i = 0; i < TRAIL_N - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    this.geo.setIndex(idx)
    this.mat = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: 'attribute float alpha; attribute float across; varying float vA; varying float vX; void main() { vA = alpha; vX = across; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */ `
        varying float vA; varying float vX;
        void main() {
          // vA runs from 1 at the ball to 0 at the tip of the tail; the core is white-hot, the edges and the tail gold
          float edge = 1.0 - abs(vX);
          float core = smoothstep(0.35, 0.95, edge) * smoothstep(0.35, 0.9, vA);
          vec3 gold = vec3(1.9, 1.25, 0.32);
          vec3 c = mix(gold, vec3(2.2, 2.15, 1.9), core);
          float a = vA * (0.35 + 0.65 * smoothstep(0.0, 0.6, edge));
          gl_FragColor = vec4(c, a * 0.95);
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 9
  }
  reset() {
    this.pts.length = 0
    this.on = false
    this.fadeOut = 0
    this.geo.setDrawRange(0, 0)
  }
  /** a stub of a trail, so its shader is built during the warm-up */
  warm(at: THREE.Vector3) {
    this.reset()
    this.on = true
    this.pts.push(at.clone().add(V(0, 0, 0.3)), at.clone().add(V(0, 0, 0.6)))
    this.update(at, V(0, 4, 25), 0)
  }
  update(ball: THREE.Vector3, cam: THREE.Vector3, dt: number) {
    if (this.on) {
      this.pts.unshift(ball.clone())
      if (this.pts.length > TRAIL_N) this.pts.length = TRAIL_N
    } else if (this.pts.length) {
      // the tail catches up with the ball and fades
      this.fadeOut += dt * 3
      if (this.fadeOut >= 1) {
        this.reset()
        return
      }
      this.pts.pop()
    }
    const n = this.pts.length
    if (n < 2) {
      this.geo.setDrawRange(0, 0)
      return
    }
    const side = V()
    const dir = V()
    const toCam = V()
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      const q = this.pts[Math.min(n - 1, i + 1)]
      const o = this.pts[Math.max(0, i - 1)]
      dir.subVectors(o, q).normalize()
      toCam.subVectors(cam, p).normalize()
      side.crossVectors(dir, toCam).normalize()
      const f = i / (TRAIL_N - 1)
      const w = BALL_R * 0.95 * (1 - f) ** 0.7
      this.pos.set([p.x + side.x * w, p.y + side.y * w, p.z + side.z * w], i * 6)
      this.pos.set([p.x - side.x * w, p.y - side.y * w, p.z - side.z * w], i * 6 + 3)
      const a = (1 - f) ** 1.3 * (1 - this.fadeOut)
      this.alpha[i * 2] = a
      this.alpha[i * 2 + 1] = a
    }
    this.geo.setDrawRange(0, (n - 1) * 6)
    ;(this.geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true
    ;(this.geo.getAttribute('alpha') as THREE.BufferAttribute).needsUpdate = true
  }
  dispose() {
    this.geo.dispose()
    this.mat.dispose()
  }
}

const ZONE_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'
const ZONE_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAim;
uniform float uHover;
uniform float uGrid;
uniform float uTime;
uniform float uLock;
void main() {
  vec2 g = vec2(vUv.x * 3.0, vUv.y * 2.0);
  vec2 cell = floor(g);
  vec2 f = fract(g);
  float z = (1.0 - cell.y) * 3.0 + cell.x;
  // the mouth is shaded darker while you aim, so the zones read over the boards behind the net
  vec4 col = vec4(0.01, 0.02, 0.08, 0.34 * uGrid);
  // the grid between zones: soft dashed lines
  vec2 fw = fwidth(g);
  vec2 d = abs(fract(g + 0.5) - 0.5);
  float dash = step(0.42, fract((vUv.x * 3.0 + vUv.y * 2.0) * 7.0));
  float grid = max(1.0 - smoothstep(fw.x * 0.9, fw.x * 2.2, d.x), 1.0 - smoothstep(fw.y * 0.9, fw.y * 2.2, d.y));
  float inner = step(0.004, vUv.x) * step(vUv.x, 0.996) * step(0.006, vUv.y) * step(vUv.y, 0.994);
  float gl = grid * dash * uGrid * inner;
  col = mix(col, vec4(1.0, 1.0, 1.0, 0.8), gl * 0.8);
  // a cell's own coordinates, square (cells are about twice as wide as tall)
  vec2 p = (f - 0.5) * vec2(2.0, 1.0);
  float r = length(p);
  float edge = min(min(f.x, 1.0 - f.x) * 2.0, min(f.y, 1.0 - f.y));
  float border = 1.0 - smoothstep(0.035, 0.07, edge);
  if (z == uHover && uAim != uHover) {
    // under the pointer: a bright fill and rim
    col = mix(col, vec4(1.0, 1.0, 1.0, 0.24), uGrid);
    col = mix(col, vec4(1.0, 1.0, 1.0, 0.85), border * uGrid);
  }
  if (z == uAim) {
    // the aim: a gold wash, a rim and a pulsing target ring with ticks; on the strike it flashes and tightens
    float k = max(uGrid, uLock);
    float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
    float rr = mix(0.27 + 0.02 * pulse, 0.16, uLock);
    float ring = 1.0 - smoothstep(0.02, 0.045, abs(r - rr));
    float dot_ = 1.0 - smoothstep(0.035, 0.06, r);
    float ticks = (1.0 - smoothstep(0.012, 0.028, abs(p.x))) * step(0.33, abs(p.y)) * step(abs(p.y), 0.45) + (1.0 - smoothstep(0.012, 0.028, abs(p.y))) * step(0.33, abs(p.x)) * step(abs(p.x), 0.45);
    vec3 c = vec3(1.0, 0.84, 0.25);
    float mark = max(ring, max(dot_, ticks));
    col = mix(col, vec4(c, 0.3), k);
    col = mix(col, vec4(c * 1.15, 0.98), max(mark, border) * k);
    col = mix(col, vec4(1.6, 1.5, 1.1, 0.75), uLock * (1.0 - r) * 0.8);
  }
  if (col.a < 0.01) discard;
  gl_FragColor = col;
}`

/** an icon drawn on a canvas for the keeper's-read markers: a glove, or the ball in a ring */
function iconTexture(kind: 'glove' | 'ball', palm = '#ffffff', back = '#2f7d32', ring = '#2ef08c') {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.lineJoin = 'round'
  g.lineCap = 'round'
  if (kind === 'glove') {
    // a soft disc in his colour behind it, so it reads on the net and the boards
    const halo = g.createRadialGradient(64, 64, 10, 64, 64, 62)
    halo.addColorStop(0, back + 'ee')
    halo.addColorStop(0.72, back + 'aa')
    halo.addColorStop(1, back + '00')
    g.fillStyle = halo
    g.fillRect(0, 0, 128, 128)
    // a fat goalkeeper's glove, fingers up, thumb out, with a cuff in his colour
    g.translate(64, 70)
    g.scale(0.82, 0.82)
    g.beginPath()
    g.moveTo(-26, 34)
    g.lineTo(-30, 2)
    g.quadraticCurveTo(-46, -6, -42, -22)
    g.quadraticCurveTo(-38, -32, -27, -22)
    g.lineTo(-24, -14)
    g.lineTo(-26, -40)
    g.quadraticCurveTo(-26, -52, -15, -52)
    g.quadraticCurveTo(-4, -52, -4, -40)
    g.lineTo(-4, -48)
    g.quadraticCurveTo(-4, -58, 7, -58)
    g.quadraticCurveTo(17, -58, 17, -47)
    g.lineTo(17, -40)
    g.quadraticCurveTo(18, -50, 28, -48)
    g.quadraticCurveTo(37, -46, 36, -34)
    g.lineTo(34, 2)
    g.lineTo(30, 34)
    g.closePath()
    g.fillStyle = palm
    g.strokeStyle = '#1d0f30'
    g.lineWidth = 7
    g.stroke()
    g.fill()
    g.lineWidth = 3.5
    for (const x of [-15, 6, 26]) {
      g.beginPath()
      g.moveTo(x, -30)
      g.lineTo(x * 0.92, -6)
      g.stroke()
    }
    g.fillStyle = back
    g.beginPath()
    g.roundRect(-31, 18, 64, 26, 9)
    g.fill()
    g.lineWidth = 6
    g.stroke()
  } else {
    g.translate(64, 64)
    // a ring round it: green where it went in, red where he kept it out
    g.strokeStyle = '#1d0f30'
    g.lineWidth = 16
    g.beginPath()
    g.arc(0, 0, 52, 0, Math.PI * 2)
    g.stroke()
    g.strokeStyle = ring
    g.lineWidth = 9
    g.stroke()
    g.fillStyle = '#ffffff'
    g.strokeStyle = '#1d0f30'
    g.lineWidth = 7
    g.beginPath()
    g.arc(0, 0, 34, 0, Math.PI * 2)
    g.fill()
    g.stroke()
    g.fillStyle = '#1d0f30'
    g.beginPath()
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
      g.lineTo(Math.cos(a) * 12, Math.sin(a) * 12)
    }
    g.fill()
    g.lineWidth = 4
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 5
      g.beginPath()
      g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12)
      g.lineTo(Math.cos(a) * 31, Math.sin(a) * 31)
      g.stroke()
    }
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export interface ShotCues {
  /** the ball is struck */
  kick?: () => void
  /** the outcome is plain to see: in the net, or held / pushed away by the keeper */
  result: () => void
  /** moments worth a caption: 'close' (fingertips), 'post', 'bar', 'chip', 'catch', 'parry', 'tip' */
  moment?: (what: string) => void
  /** a replay of the shot from the side starts (true) or ends (false) */
  replay?: (on: boolean) => void
  /** the camera has cut away from the usual view (a close-up, a replay) or come back to it */
  away?: (on: boolean) => void
}

/** what is riding on a shot, for the build-up */
export interface Stakes {
  /** this shot's number, 1 to 10 */
  shot: number
  /** 0 to 1: how tense the build-up is (rises with the goals so far) */
  tension: number
  /** what the boards say while he sets himself, e.g. "SHOT 8 · 24.86×" */
  board?: string
  /** the shot for a Perfect 10 */
  last?: boolean
}

/** 0 normal, 1 turbo, 2 super turbo (straight to the strike, no ceremony) */
export type Speed = 0 | 1 | 2
const SPEEDS = [1, 1.85, 2.7]

export interface ZoneRect {
  x: number
  y: number
  w: number
  h: number
}

interface Free {
  v: THREE.Vector3
  /** stay inside the goal (it is in the net) */
  inGoal: boolean
  roofHit: boolean
}

interface Tween {
  t: number
  dur: number
  fn: (u: number) => void
  done: () => void
  stop?: () => boolean
}

/** one frame of the shot as it happened, for the replay */
interface RecFrame {
  dt: number
  ball: THREE.Vector3
  spin: THREE.Quaternion
  shown: boolean
  scale: number
  kPos: THREE.Vector3
  kRot: THREE.Euler
  pose: Pose
  /** the ball hit the net here on this frame */
  net?: THREE.Vector3
}

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

export class PenaltyScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** the six zones' screen rectangles (CSS px) at rest, for the tap targets */
  onZones?: (rects: ZoneRect[]) => void

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV0, 1, 0.1, 400)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private stadium!: Stadium
  private striker!: Actor
  private readonly keepers = new Map<Difficulty, Actor>()
  private keeper!: Actor
  private diff: Difficulty
  private ball!: THREE.Group
  private ballSpin!: THREE.Mesh
  private readonly ballPos = SPOT.clone()
  private ballMode: 'spot' | 'path' | 'free' | 'held' | 'hidden' = 'spot'
  private free: Free | null = null
  private readonly ballShadow: THREE.Mesh
  private readonly shadows: THREE.Mesh[] = []
  private readonly trail = new Trail()
  private readonly sparks = new Sparks(1400)
  private readonly confetti: Bits
  private readonly turf: Bits
  private readonly zoneMat: THREE.ShaderMaterial
  /** the keeper's read after a shot: a glove on each zone he covered, the ball on the zone you hit */
  private readonly marks: THREE.Sprite[] = []
  private readonly gloveTex: Map<Difficulty, THREE.CanvasTexture> = new Map()
  private readonly ballIcon: THREE.CanvasTexture
  private readonly ballSaved: THREE.CanvasTexture
  private markAlpha = 0
  private markTo = 0
  /** a ring that flashes where the ball meets the net or the gloves */
  private readonly ring: THREE.Sprite
  private ringT = -1

  private readonly renderPass: RenderPass
  /** the camera for cut-aways: the keeper's close-up, the replay, the Perfect 10 orbit */
  private readonly closeCam = new THREE.PerspectiveCamera(30, 1, 0.1, 400)
  private cutaway = false

  private tweens: Tween[] = []
  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private drewLast = false
  private raf = 0
  private last = 0
  private acc = 0
  /** the scene clock (runs with turbo, hurry and slow motion) and the wall clock */
  private time = 0
  private clock = 0
  private speed: Speed = 0
  private hurried = false
  /** a new run is waiting: everything left of this shot plays out at a dash */
  private rushing = false
  private slow = 1
  /** a hit-stop: the scene clock stands still for this many more real seconds */
  private freeze = 0
  private busy = false
  private disposed = false
  /** full frame rate until then (wall clock), after any input */
  private liveUntil = 0
  private current: Promise<void> | null = null

  // camera
  private readonly camBase = new THREE.Vector3()
  private zoom = 1
  private zoomTo = 1
  /** where the camera looks, eased: LOOK, or pulled towards something worth a closer look */
  private readonly focus = LOOK.clone()
  private readonly focusTo = LOOK.clone()
  /** a tall stage, where the goal already fills the width */
  private narrow = false
  private shake = 0
  private readonly look = new THREE.Vector2()
  private readonly lookTo = new THREE.Vector2()

  // the crowd
  private cheer = 0
  private groan = 0
  private wave = -1
  private waveDir = 1
  private flash = 0
  private nextFlash = 0
  private nextWave = 25
  private boardsShow: 'normal' | 'goal' | 'saved' | 'perfect' | 'custom' = 'normal'
  private boardsUntil = 0
  /** the boards flare white for a moment when the ball hits the net */
  private boardFlash = 0
  private netT = -1
  private netAmp = 0
  private stopAmbience: (() => void) | null = null
  private nextMuteCheck = 0
  private setAmbience: ((level: number) => void) | null = null
  /** the stand's drum and chant, louder and quicker the longer the run (0 off) */
  private chantLevel = 0
  /** the hush before a big shot (0 to 1) */
  private hush = 0
  private chant: { set: (goals: number, level: number) => void; stop: () => void } | null = null
  /** the run's goals so far, for the drum's tempo */
  private runGoals = 0
  /** the team-mates who run on for a Perfect 10, built once the scene is up */
  private mates: Actor[] = []
  private party = false
  /** the shot replayed from the side: what the keeper and the ball did, frame by frame */
  private recording: RecFrame[] | null = null
  private replaying = false

  // the keeper between shots
  private keeperX = 0
  private keeperXTo = 0
  private nextShuffle = 1
  private nextTaunt = 4
  private idleKeeper = true
  private aimZone: Zone | null = null
  /** the striker's glance at the aimed zone (head turn, tilt), eased */
  private readonly aimLook = new THREE.Vector2()
  private gridAlpha = 1
  private gridTo = 1
  private lock = 0
  private zonesKey = ''

  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void
  private readonly stageEl: HTMLElement
  private readonly sound = new Proxy(penaltySfx, {
    get: (t, k) => (this.disposed ? () => () => {} : t[k as keyof typeof t]),
  })

  constructor(el: HTMLElement, difficulty: Difficulty) {
    this.diff = difficulty
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.info.autoReset = false
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor('#070b1f')
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:manipulation'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.renderPass = new RenderPass(this.scene, this.camera)
    this.composer.addPass(this.renderPass)
    // only what really glows blooms (lamps, flashes, sparks, the trail): the lit kits stay crisp
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 1.08)
    if (mobile) {
      // on a phone the glow is worked out at half the resolution (a quarter of the pixels): it is soft anyway
      const size = this.bloom.setSize.bind(this.bloom)
      this.bloom.setSize = (w: number, h: number) => size(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    }
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // floodlit from behind the camera and above, with a cool fill from the sky
    const key = new THREE.DirectionalLight('#fff4e0', 2.2)
    key.position.set(4, 14, 16)
    const rim = new THREE.DirectionalLight('#9fb8ff', 0.9)
    rim.position.set(-6, 10, -12)
    this.scene.add(key, rim, new THREE.AmbientLight('#cdd6ff', 0.95))

    // soft round shadows under the players and the ball
    const shadowMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#020510', transparent: true, opacity: 0.6, depthWrite: false })
    const shadowGeo = new THREE.PlaneGeometry(1, 1)
    shadowGeo.rotateX(-Math.PI / 2)
    this.own.push(shadowMat, shadowGeo)
    this.ballShadow = new THREE.Mesh(shadowGeo, shadowMat)
    this.ballShadow.renderOrder = 1
    this.scene.add(this.ballShadow)
    for (let i = 0; i < 2; i++) {
      const s = new THREE.Mesh(shadowGeo, shadowMat)
      s.renderOrder = 1
      this.shadows.push(s)
      this.scene.add(s)
    }

    // the zones of the goal mouth: a plane just in front of the line, drawn in the shader
    this.zoneMat = new THREE.ShaderMaterial({
      uniforms: { uAim: { value: -1 }, uHover: { value: -1 }, uGrid: { value: 1 }, uTime: { value: 0 }, uLock: { value: 0 } },
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    })
    const zones = new THREE.Mesh(new THREE.PlaneGeometry(GOAL.hw * 2 - GOAL.post * 2, GOAL.h - GOAL.post), this.zoneMat)
    zones.position.set(0, (GOAL.h - GOAL.post) / 2, 0.02)
    zones.renderOrder = 3
    this.scene.add(zones)
    this.own.push(zones.geometry, this.zoneMat)

    // the read markers: six sprites standing just in front of the zones, drawn over everything
    this.ballIcon = iconTexture('ball')
    this.ballSaved = iconTexture('ball', '', '', '#ff4d61')
    this.own.push(this.ballIcon, this.ballSaved)
    for (let i = 0; i < 7; i++) {
      const m = new THREE.SpriteMaterial({ map: this.ballIcon, transparent: true, depthTest: false, depthWrite: false, opacity: 0 })
      const s = new THREE.Sprite(m)
      const c = zoneCenter((i % 6) as Zone)
      s.position.set(c.x, c.y, 0.6)
      s.scale.setScalar(0.62)
      s.renderOrder = 12
      s.visible = false
      this.marks.push(s)
      this.scene.add(s)
      this.own.push(m)
    }
    // the impact ring
    const ringMat = new THREE.SpriteMaterial({ map: ringTexture(), color: new THREE.Color(2.2, 1.8, 0.8), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, opacity: 0 })
    this.ring = new THREE.Sprite(ringMat)
    this.ring.visible = false
    this.ring.renderOrder = 11
    this.scene.add(this.ring)
    this.own.push(ringMat)

    // effects
    this.scene.add(this.sparks.points)
    this.own.push(this.sparks)
    this.scene.add(this.trail.mesh)
    this.own.push(this.trail)
    const confGeo = new THREE.PlaneGeometry(0.16, 0.09)
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })
    this.confetti = new Bits(confGeo, confMat, 420, true)
    this.scene.add(this.confetti.mesh)
    this.own.push(this.confetti)
    const turfGeo = new THREE.BoxGeometry(0.07, 0.025, 0.05)
    const turfMat = new THREE.MeshLambertMaterial({ color: '#ffffff' })
    this.turf = new Bits(turfGeo, turfMat, 60, true)
    this.scene.add(this.turf.mesh)
    this.own.push(this.turf)

    this.onMove = (e) => {
      this.poke()
      if (e.pointerType === 'touch') return
      const r = el.getBoundingClientRect()
      this.lookTo.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    }
    this.onLeave = () => this.lookTo.set(0, 0)
    // the zone buttons sit over the canvas, so listen on the whole stage
    const stage = el.parentElement ?? el
    stage.addEventListener('pointermove', this.onMove)
    stage.addEventListener('pointerdown', this.onMove)
    stage.addEventListener('pointerleave', this.onLeave)
    this.stageEl = stage

    const r0 = el.getBoundingClientRect()
    this.resize(r0.width || 800, r0.height || 600)
    this.ready = this.init(mobile)
  }

  /* ---------------- setup ---------------- */

  private async init(mobile: boolean) {
    const step = (p: number) => {
      this.onProgress?.(p)
      return new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    }
    await step(0.06)
    if (this.disposed) return
    try {
      await Promise.race([document.fonts.load('900 60px Manrope'), new Promise((r) => setTimeout(r, 1500))])
    } catch {
      /* the fallback font will do */
    }
    if (this.disposed) return
    this.stadium = buildStadium({ mobile })
    this.scene.add(this.stadium.root)
    this.own.push(...this.stadium.own)
    await step(0.3)
    if (this.disposed) return
    // the striker, seen from behind at the top of his run-up
    this.striker = new Actor(buildPlayer(strikerSpec()))
    this.scene.add(this.striker.rig.root)
    this.placeStriker(RUN_START, this.faceBall(RUN_START))
    this.striker.play((t) => this.strikerIdle(t), 0, 0.01)
    await step(0.45)
    if (this.disposed) return
    // all four keepers (only one is on his line at a time)
    for (const L of LEVELS) {
      const look = keeperLook(L.id)
      const gt = iconTexture('glove', look.spec.keeper!.palm, look.spec.keeper!.back)
      this.gloveTex.set(L.id, gt)
      this.own.push(gt)
      const a = new Actor(buildPlayer(look.spec))
      a.rig.root.position.set(0, 0, KEEPER_Z)
      a.rig.root.visible = L.id === this.diff
      a.play((t) => this.keeperIdle(t), 0, 0.01)
      this.keepers.set(L.id, a)
      this.scene.add(a.rig.root)
      await step(0.45 + 0.07 * (LEVELS.indexOf(L) + 1))
      if (this.disposed) return
    }
    this.keeper = this.keepers.get(this.diff)!
    const b = buildBall()
    this.ball = b.group
    this.ballSpin = b.spin
    this.scene.add(this.ball)
    this.own.push(...b.materials, ...b.geometries.map((g) => ({ dispose: () => g.dispose() })))
    this.ball.position.copy(SPOT)
    await step(0.8)
    if (this.disposed) return
    // every face, keeper and effect once, so every shader compiles before the first shot
    const faces: THREE.Mesh[] = []
    for (const a of [this.striker, ...this.keepers.values()]) {
      a.rig.root.visible = true
      for (const m of a.rig.meshes) if (!m.visible) (faces.push(m), (m.visible = true))
    }
    this.sparks.emit(0, 0, 50, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    this.confetti.emit(V(0, -5, 50), V(), new THREE.Color(), 1, 0.01, 0)
    this.confetti.update(0)
    this.turf.emit(V(0, -5, 50), V(), new THREE.Color(), 1, 0.01, 0)
    this.turf.update(0)
    for (const m of this.marks) m.visible = true
    this.ring.visible = true
    this.trail.warm(this.ballPos)
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
    this.update(0, 0)
    this.composer.render()
    for (const m of faces) m.visible = false
    for (const m of this.marks) m.visible = false
    this.ring.visible = false
    this.trail.reset()
    for (const a of this.keepers.values()) a.rig.root.visible = a === this.keeper
    this.striker.rig.setExpr('focus')
    this.keeper.rig.setExpr('smug')
    this.portraits = this.paintPortraits()
    await step(1)
    if (this.disposed) return
    this.syncAmbience()
    this.emitZones(true)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
    // the team-mates for a Perfect 10, built in the background a moment later (they share every shader already built)
    window.setTimeout(() => this.buildMates(), 1800)
    // the keepers' thinned shapes for planning a dive that misses the ball, one at a time in the background
    LEVELS.forEach((L, i) => window.setTimeout(() => this.disposed || hullOf(this.keepers.get(L.id)!.rig), 2400 + i * 250))
  }

  /** the four keepers' faces (data URLs, smug), for the difficulty picker */
  portraits: Partial<Record<Difficulty, string>> = {}

  private paintPortraits() {
    const out: Partial<Record<Difficulty, string>> = {}
    const size = 112
    const cv = this.renderer.domElement
    const c2 = document.createElement('canvas')
    c2.width = c2.height = size
    const g = c2.getContext('2d')
    if (!g) return out
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 50)
    const hidden: THREE.Object3D[] = [this.stadium.root, this.striker.rig.root, this.ball, ...this.marks]
    const was = hidden.map((o) => o.visible)
    for (const o of hidden) o.visible = false
    const clear = new THREE.Color()
    this.renderer.getClearColor(clear)
    const dpr = this.renderer.getPixelRatio()
    try {
      for (const L of LEVELS) {
        const a = this.keepers.get(L.id)!
        for (const k of this.keepers.values()) k.rig.root.visible = k === a
        const keep = { p: a.rig.root.position.clone(), r: a.rig.root.rotation.clone(), e: a.rig.expr }
        a.rig.root.position.set(0, 0, KEEPER_Z)
        a.rig.root.rotation.set(0, 0, 0)
        applyPose(a.rig, with_(STAND, { nx: -0.08, nz: 0.08 }))
        a.rig.setExpr('smug')
        a.rig.look(0.15, 0.1)
        a.rig.root.updateMatrixWorld(true)
        const head = a.rig.neck.getWorldPosition(V()).add(V(0, 0.2 * a.rig.scale, 0))
        cam.position.copy(head).add(V(0.32 * a.rig.scale, 0.08, 1.95 * a.rig.scale))
        cam.lookAt(head.x, head.y + 0.02 * a.rig.scale, head.z)
        this.renderer.setClearColor(new THREE.Color(keeperLook(L.id).accent).multiplyScalar(0.22))
        this.renderer.setViewport(0, 0, size / dpr, size / dpr)
        this.renderer.setScissor(0, 0, size / dpr, size / dpr)
        this.renderer.setScissorTest(true)
        this.renderer.render(this.scene, cam)
        g.clearRect(0, 0, size, size)
        g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
        out[L.id] = c2.toDataURL('image/png')
        a.rig.root.position.copy(keep.p)
        a.rig.root.rotation.copy(keep.r)
        a.rig.setExpr(keep.e)
      }
    } catch {
      /* no portraits: the picker falls back to its drawn icons */
    }
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, this.w, this.h)
    this.renderer.setClearColor(clear)
    hidden.forEach((o, i) => (o.visible = was[i]))
    for (const k of this.keepers.values()) k.rig.root.visible = k === this.keeper
    return out
  }

  /** three team-mates in the same kit, waiting off camera for a Perfect 10 */
  private buildMates() {
    if (this.disposed || this.mates.length) return
    const looks: Partial<PlayerSpec>[] = [
      { skin: '#9c6440', hair: '#1c1310', hairStyle: 'buzz', number: 7 },
      { skin: '#f2c7a2', hair: '#e8c35a', hairStyle: 'quiff', number: 9 },
      { skin: '#c98d62', hair: '#2a1b14', hairStyle: 'mohawk', number: 4 },
    ]
    for (const l of looks) {
      const a = new Actor(buildPlayer({ ...strikerSpec(), ...l }))
      a.rig.root.visible = false
      a.rig.setExpr('joy')
      this.scene.add(a.rig.root)
      this.mates.push(a)
    }
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
    this.closeCam.aspect = w / h
    this.closeCam.updateProjectionMatrix()
    this.fit()
    const tan = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    if (this.stadium) this.stadium.sky.uniforms.uAspect.value = w / h
    this.emitZones(true)
  }

  /**
   * Frames the shot. The camera stays put behind the striker and looks at the goal; the lens is chosen so the goal
   * and the ball on the spot fit (the goal no smaller than most of a narrow stage's width), with the roof's
   * floodlights in view too when there is room; then the view is shifted so the ball sits just above the bottom
   * margin (the ladder) and the goal is centred across.
   */
  private fit() {
    const cam = this.camera
    cam.clearViewOffset()
    cam.zoom = 1
    const narrow = this.w / this.h < 1.05
    this.narrow = narrow
    // a long lens from well behind the spot: the goal fills the picture, the crowd packs in behind it and the striker
    // stays small enough at the bottom left not to hide anything
    cam.position.copy(narrow ? CAM_NARROW : CAM)
    cam.lookAt(LOOK)
    // the goal across most of the stage, its bar about 30% down, the ball above the ladder at the bottom
    const goalW = narrow ? 0.9 : this.w / this.h > 1.75 ? 0.56 : 0.62
    const topFrac = narrow ? 0.28 : 0.3
    const topMin = narrow ? 0.17 : 0.16
    const mBot = (narrow ? 84 : 92) / this.h
    const goalPts = [V(-GOAL.hw - GOAL.post, 0, 0), V(GOAL.hw + GOAL.post, 0, 0), V(-GOAL.hw, GOAL.h + GOAL.post, 0), V(GOAL.hw, GOAL.h + GOAL.post, 0)]
    const bottom = V(0, 0, SPOT.z + 0.35)
    const p = V()
    const span = (fov: number) => {
      cam.fov = fov
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()
      let x0 = 1
      let x1 = -1
      let y1 = -1
      for (const g of goalPts) {
        p.copy(g).project(cam)
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        y1 = Math.max(y1, p.y)
      }
      const yBot = p.copy(bottom).project(cam).y
      return { x0, x1, y0: yBot, y1, gw: (x1 - x0) / 2 }
    }
    const solve = (ok: (fov: number) => boolean) => {
      let lo = 3
      let hi = 80
      for (let i = 0; i < 36; i++) {
        const f = (lo + hi) / 2
        if (ok(f)) hi = f
        else lo = f
      }
      return hi
    }
    // the lens that makes the goal that wide, unless the bar and the spot would then not both fit
    const room = 1 - topMin - mBot
    const fovW = solve((f) => span(f).gw <= goalW)
    const fovV = solve((f) => {
      const s = span(f)
      return (s.y1 - s.y0) / 2 <= room
    })
    const fov = Math.max(fovW, fovV)
    const s = span(fov)
    // shift the lens: the bar at topFrac (higher if the spot would sink into the ladder), the goal centred across
    const barNdc = 1 - topFrac * 2
    const botNdc = -1 + mBot * 2
    let shiftY = barNdc - s.y1
    if (s.y0 + shiftY < botNdc) shiftY = botNdc - s.y0
    const shiftX = -(s.x1 + s.x0) / 2
    cam.setViewOffset(this.w, this.h, (-shiftX * this.w) / 2, (shiftY * this.h) / 2, this.w, this.h)
    cam.updateProjectionMatrix()
    this.camBase.copy(cam.position)
    this.placeCamera()
  }

  private placeCamera() {
    const cam = this.camera
    cam.position.copy(this.camBase)
    cam.position.x += this.look.x * 0.7
    cam.position.y += this.look.y * 0.3
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.16
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.1
    }
    cam.lookAt(this.focus)
    cam.zoom = this.zoom
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
  }

  /** the zones' screen rectangles at rest */
  zoneRects(): ZoneRect[] {
    const cam = this.camera.clone()
    cam.position.copy(this.camBase)
    cam.lookAt(LOOK)
    cam.zoom = 1
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    const xs = [-GOAL.hw + GOAL.post, -1.22, 1.22, GOAL.hw - GOAL.post]
    const ys = [GOAL.h - GOAL.post, 1.22, 0]
    const at = (x: number, y: number) => {
      const v = V(x, y, 0.02).project(cam)
      return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h }
    }
    const out: ZoneRect[] = []
    for (let r = 0; r < 2; r++)
      for (let c = 0; c < 3; c++) {
        const a = at(xs[c], ys[r])
        const b = at(xs[c + 1], ys[r + 1])
        out.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y })
      }
    return out
  }

  private emitZones(force = false) {
    if (!this.onZones) return
    const rects = this.zoneRects()
    const key = rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.w)}`).join('|')
    if (!force && key === this.zonesKey) return
    this.zonesKey = key
    this.onZones(rects)
  }

  setSpeed(s: Speed) {
    this.speed = s
  }

  /** speeds the rest of the current shot up (a cut-away is cut short) */
  hurry() {
    if (!this.busy) return
    this.hurried = true
    this.hurriedAt = this.clock
    this.poke()
  }
  private hurriedAt = -1
  /** when the last result showed (wall clock) */
  private resultAt = 0

  /** the next run is waiting: play out whatever is left of this shot at a dash; resolves when the players are set */
  rush() {
    if (this.busy) this.rushing = true
    this.poke()
    return this.current ?? Promise.resolve()
  }

  /** whether a shot is still playing out */
  get playing() {
    return this.busy
  }

  /** something happened (a tap, a hover): draw every frame for a moment */
  poke() {
    this.liveUntil = this.clock + 2.5
  }

  /** the zone the player is aiming at (a target in the goal mouth), or null */
  aim(z: Zone | null, quiet = false) {
    if (z !== this.aimZone && z != null && this.aimZone != null && !quiet) this.sound.aim()
    this.aimZone = z
    this.zoneMat.uniforms.uAim.value = z ?? -1
    this.poke()
  }

  /** the zone under the pointer (desktop) */
  hover(z: number) {
    this.zoneMat.uniforms.uHover.value = z
    this.poke()
  }

  /** puts a different keeper on the line: a puff, and he pops in with a taunt */
  setDifficulty(d: Difficulty) {
    if (d === this.diff) return
    this.diff = d
    if (!this.keeper) return
    const old = this.keeper
    const next = this.keepers.get(d)!
    const at = V(old.rig.root.position.x, 1.1, KEEPER_Z + 0.2)
    this.puff(at, 26)
    old.rig.root.visible = false
    next.rig.root.visible = true
    next.rig.root.position.set(this.keeperX, 0, KEEPER_Z)
    next.rig.root.rotation.set(0, 0, 0)
    next.rig.root.scale.setScalar(0.01)
    this.keeper = next
    this.idleKeeper = true
    next.rig.setExpr('taunt')
    next.play((t) => this.keeperTaunt(t, 1), this.time, 0.05)
    this.sound.pop()
    void this.tween(0.35, (u) => next.rig.root.scale.setScalar(Math.max(0.01, easeOut(u) * (1 + 0.25 * Math.sin(u * Math.PI)))))
    this.nextTaunt = this.clock + 1.6
    void this.wait(1.4).then(() => {
      if (this.keeper !== next || this.busy) return
      next.rig.setExpr('smug')
      next.play((t) => this.keeperIdle(t), this.time, 0.3)
    })
  }

  /* ---------------- the clock ---------------- */

  /** runs fn(0 → 1) over dur seconds of scene time; `stop` cuts it short (fn is left where it got to) */
  private tween(dur: number, fn: (u: number) => void, stop?: () => boolean) {
    return new Promise<void>((done) => {
      if (this.disposed) return done()
      fn(0)
      this.tweens.push({ t: 0, dur: Math.max(1e-3, dur), fn, done, stop })
    })
  }
  private wait(s: number) {
    return this.tween(s, () => {})
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // between shots only the crowd sways and the keeper bounces: 30 frames a second is plenty, unless someone has just
    // touched the page (then every frame, so the aim and the hover answer smoothly)
    const lively =
      this.busy || this.clock < this.liveUntil || this.cheer > 0.02 || this.groan > 0.02 || this.wave >= 0 || this.tweens.length > 0 || this.netT >= 0 || this.shake > 0.01 || this.markAlpha !== this.markTo || this.look.distanceToSquared(this.lookTo) > 1e-5 || Math.abs(this.zoom - this.zoomTo) > 1e-3
    if (!lively && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    const speed = SPEEDS[this.speed] * (this.hurried ? 2.3 : 1) * (this.rushing ? 7 : 1) * (this.rushing || this.hurried ? 1 : this.slow)
    let dt = real * speed
    if (this.freeze > 0) {
      // a hit-stop: the world holds its breath for a beat
      this.freeze -= real
      dt = 0
    }
    this.time += dt
    this.clock += real
    this.update(dt, real)
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.renderPass.camera = this.cutaway ? this.closeCam : this.camera
    const info = this.renderer.info
    info.reset()
    this.composer.render()
    this.frameStats = { calls: info.render.calls, triangles: info.render.triangles, dpr: this.dpr, bloom: this.bloom.enabled }
  }

  /** what the last frame cost (draw calls and triangles over every pass), for the perf checks */
  frameStats = { calls: 0, triangles: 0, dpr: 1, bloom: true }

  private update(dt: number, real: number) {
    if (this.tweens.length) {
      const list = this.tweens
      this.tweens = []
      const keep: Tween[] = []
      for (const t of list) {
        if (t.stop?.()) {
          t.done()
          continue
        }
        t.t += dt
        const u = Math.min(1, t.t / t.dur)
        t.fn(u)
        if (u >= 1) t.done()
        else keep.push(t)
      }
      this.tweens = keep.concat(this.tweens)
    }
    const st = this.stadium
    if (!st || !this.keeper) return
    // the crowd: excitement decays, the wave goes round now and then, flashes pop
    this.cheer = Math.max(0, this.cheer - real * 0.35)
    this.groan = Math.max(0, this.groan - real * 0.45)
    this.flash = Math.max(0, this.flash - real * 2.5)
    this.shake = Math.max(0, this.shake - real * 3)
    if (this.wave < 0 && this.clock > this.nextWave && !this.busy) {
      this.wave = 0
      this.waveDir = Math.random() < 0.5 ? 1 : -1
    }
    let waveX = -100
    let waveAmp = 0
    if (this.wave >= 0) {
      this.wave += real / 5.5
      waveX = this.waveDir * lerp(-36, 36, this.wave)
      waveAmp = Math.sin(Math.min(1, this.wave) * Math.PI) ** 0.3
      if (this.wave >= 1) {
        this.wave = -1
        this.nextWave = this.clock + 30 + Math.random() * 30
      }
    }
    const cu = st.crowd.uniforms
    cu.uTime.value = this.clock
    cu.uCheer.value = Math.min(1, this.cheer)
    cu.uGroan.value = Math.min(1, this.groan)
    cu.uWaveX.value = waveX
    cu.uWaveAmp.value = waveAmp
    cu.uFlash.value = this.flash
    st.flags.uniforms.uTime.value = this.clock
    st.flags.uniforms.uCheer.value = Math.min(1, this.cheer + waveAmp * 0.5)
    st.sky.uniforms.uTime.value = this.clock
    st.sky.uniforms.uFlash.value = this.flash * 0.4
    st.pitch.uniforms.uFlash.value = this.flash
    st.net.uniforms.uTime.value = this.clock
    if (this.netT >= 0) {
      this.netT += dt
      st.net.uniforms.uT.value = this.netT
      st.net.uniforms.uAmp.value = this.netAmp
      if (this.netT > 3) {
        this.netT = -1
        st.net.uniforms.uT.value = -1
      }
    }
    // camera flashes in the stand: a few at rest, a storm when they score
    if (this.clock > this.nextFlash) {
      this.cameraFlash()
      this.nextFlash = this.clock + (this.cheer > 0.3 ? 0.03 + Math.random() * 0.06 : 0.25 + Math.random() * 0.9)
    }
    // the boards scroll, and show the news for a while
    const b = st.boards
    if (this.boardsShow !== 'normal' && this.clock > this.boardsUntil) this.setBoards('normal')
    b.normal.offset.x = (this.clock * 0.04) % 1
    this.boardFlash = Math.max(0, this.boardFlash - real * 2.2)
    const bl = this.boardsShow === 'normal' || this.boardsShow === 'custom' ? 0.95 : Math.sin(this.clock * 14) > -0.2 ? 1.25 : 0.55
    b.mat.color.setScalar(bl + this.boardFlash * 1.6)
    st.lamps.color.setRGB(2.4, 2.35, 2.1).multiplyScalar(1 + this.flash * 0.4)
    if (this.clock > this.nextMuteCheck) {
      this.nextMuteCheck = this.clock + 0.5
      this.syncAmbience()
    }
    this.setAmbience?.(this.hush > 0 ? 0.5 - this.hush * 0.42 : 0.5 + this.cheer * 0.4)
    this.chant?.set(this.runGoals, this.hush > 0.3 ? 0 : this.chantLevel)

    // the zone plane and the read markers
    this.gridAlpha += (this.gridTo - this.gridAlpha) * Math.min(1, real * 8)
    this.lock = Math.max(0, this.lock - real * 1.6)
    this.zoneMat.uniforms.uGrid.value = this.gridAlpha
    this.zoneMat.uniforms.uTime.value = this.clock
    this.zoneMat.uniforms.uLock.value = this.lock
    if (this.markAlpha !== this.markTo) {
      this.markAlpha = this.markTo > this.markAlpha ? Math.min(this.markTo, this.markAlpha + real * 5) : Math.max(this.markTo, this.markAlpha - real * 4)
      this.marks.forEach((m, i) => {
        const pop = this.markTo > 0 ? easeOut(clamp01(this.markAlpha * 1.4 - i * 0.06)) : 1
        ;(m.material as THREE.SpriteMaterial).opacity = this.markAlpha
        m.scale.setScalar((m.userData.size ?? 0.62) * (0.6 + 0.4 * pop))
        m.visible = this.markAlpha > 0.01 && !!m.userData.on
      })
    }
    if (this.ringT >= 0) {
      this.ringT += dt / 0.45
      const u = clamp01(this.ringT)
      this.ring.scale.setScalar(lerp(0.3, 2.3, easeOut(u)))
      ;(this.ring.material as THREE.SpriteMaterial).opacity = (1 - u) ** 1.5
      if (this.ringT >= 1) {
        this.ringT = -1
        this.ring.visible = false
      }
    }

    const az = this.aimZone
    this.aimLook.lerp(new THREE.Vector2(az == null ? 0 : -COLS[zoneCol(az)] * 0.075, az == null ? 0 : zoneRow(az) === 0 ? -0.1 : 0.03), Math.min(1, real * 4))
    this.updateKeeperIdle(real)
    this.striker.update(this.time, dt)
    if (!this.replaying) this.keeper.update(this.time, dt)
    for (const m of this.mates) if (m.rig.root.visible) m.update(this.time, dt)
    if (!this.replaying) this.updateBall(dt)
    this.updateShadows()
    // the keeper's eyes follow the ball
    if (!this.replaying) this.lookAtBall(this.keeper.rig, this.keeper.rig.root)
    if (this.recording && dt > 0) {
      this.recording.push({ dt, ball: this.ballPos.clone(), spin: this.ballSpin.quaternion.clone(), shown: this.ball.visible, scale: this.ball.scale.x, kPos: this.keeper.rig.root.position.clone(), kRot: this.keeper.rig.root.rotation.clone(), pose: { ...this.keeper.last }, net: this.recNet ?? undefined })
      this.recNet = null
      if (this.recording.length > 400) this.recording.shift()
    }
    this.sparks.update(dt)
    this.confetti.update(dt)
    this.turf.update(dt)
    this.trail.update(this.ballPos, this.cutaway ? this.closeCam.position : this.camera.position, dt)
    // camera: a drift towards the pointer, the push-in during a shot, and a shake
    this.look.lerp(this.lookTo, Math.min(1, real * 2.5))
    this.zoom += (this.zoomTo - this.zoom) * Math.min(1, real * (this.zoomTo > this.zoom + 0.15 ? 7 : 3.2))
    this.focus.lerp(this.focusTo, Math.min(1, real * 4.5))
    this.placeCamera()
  }

  /** the crowd's murmur follows the mute switch: it starts when sound is on and stops the moment it goes off */
  private syncAmbience() {
    const muted = isMuted()
    if (muted && this.stopAmbience) {
      this.stopAmbience()
      this.stopAmbience = this.setAmbience = null
      this.chant?.stop()
      this.chant = null
    } else if (!muted && !this.stopAmbience && !this.disposed) {
      const amb = this.sound.ambience()
      if (amb) {
        this.stopAmbience = amb.stop
        this.setAmbience = amb.level
      }
      this.chant = this.sound.chant() ?? null
    }
  }

  /** the run's state, for the stand: its drum and chant pick up with every goal and stop when the run does */
  setRun(goals: number, on: boolean) {
    this.runGoals = goals
    this.chantLevel = on && goals > 0 ? Math.min(1, 0.45 + goals * 0.07) : 0
  }

  private setBoards(kind: 'normal' | 'goal' | 'saved' | 'perfect' | 'custom', secs = 3, text?: string) {
    const b = this.stadium.boards
    if (kind === 'custom' && text) b.write(text)
    this.boardsShow = kind
    this.boardsUntil = this.clock + secs
    b.mat.map = b[kind]
    b.mat.needsUpdate = true
  }

  /* ---------------- idle life ---------------- */

  private strikerIdle(t: number): Pose {
    const b = Math.sin(t * 2.3)
    // every few seconds a bit of business: a bounce on his toes, then a roll of the shoulders and a shake of the arms
    const cyc = t % 9
    const env = (a: number, d: number) => (cyc > a && cyc < a + d ? Math.sin(((cyc - a) / d) * Math.PI) : 0)
    const hop = env(3, 1.3)
    const bounce = hop * Math.abs(Math.sin((cyc - 3) * Math.PI * 3.4))
    const roll = env(6.4, 1.2)
    const shake = roll * Math.sin(t * 22) * 0.12
    // and he sizes up the corner being aimed at
    return with_(STAND, {
      y: -0.02 + 0.012 * b + 0.045 * bounce,
      sx: 0.06,
      lsz: 0.05 + 0.18 * roll + shake,
      rsz: -0.05 - 0.18 * roll - shake,
      lsx: -0.2 * roll,
      rsx: -0.2 * roll,
      rz: 0.025 * Math.sin(t * 1.1),
      sy: 0.08 * roll * Math.sin(t * 5),
      lk: 0.1 + 0.04 * b - 0.08 * bounce,
      rk: 0.1 - 0.04 * b - 0.08 * bounce,
      la: 0.22 * bounce,
      ra: 0.22 * bounce,
      nx: -0.06 + 0.03 * Math.sin(t * 0.7) + this.aimLook.y,
      ny: 0.04 * Math.sin(t * 0.45) + this.aimLook.x,
    })
  }

  private keeperIdle(t: number): Pose {
    // bouncing on his toes, arms out, shuffling along the line
    const bounce = Math.abs(Math.sin(t * 5.4))
    const flap = Math.sin(t * 3.1)
    return with_(READY, { y: 0.06 * bounce, lsz: 0.15 * flap, rsz: 0.15 * flap, lk: -0.15 * bounce, rk: -0.15 * bounce, la: 0.12 * bounce, ra: 0.12 * bounce, rz: 0.04 * Math.sin(t * 1.7), nx: 0.05 * Math.sin(t * 0.9) })
  }

  /** a taunt: 0 jelly arms, 1 big clap, 2 finger wag, 3 jump to the bar */
  private keeperTaunt(t: number, kind: number): Pose {
    if (kind === 0) {
      const w = Math.sin(t * 13)
      return pose({ y: -0.05 + 0.04 * Math.abs(Math.sin(t * 6.5)), sx: 0.05, rz: 0.1 * Math.sin(t * 6.5), lsz: 2.2 + 0.45 * w, rsz: -(2.2 - 0.45 * w), le: -0.6 + 0.5 * w, re: -0.6 - 0.5 * w, lhz: 0.15, rhz: -0.15, lk: 0.3, rk: 0.3, nz: 0.12 * Math.sin(t * 6.5) })
    }
    if (kind === 1) {
      const c = 0.5 + 0.5 * Math.cos(t * 9)
      return pose({ y: -0.04, sx: -0.05, nx: -0.2, lsx: -2.7, rsx: -2.7, lsz: 0.08 + 0.4 * c, rsz: -(0.08 + 0.4 * c), le: -0.25, re: -0.25, lhz: 0.12, rhz: -0.12, lk: 0.15, rk: 0.15 })
    }
    if (kind === 2) {
      const wag = Math.sin(t * 11) * 0.35
      return pose({ y: -0.03, sx: 0.04, ny: 0.1, nz: -wag * 0.3, rsx: -1.55, rsz: -0.25, rsy: wag, re: -1.1, lsz: 0.55, lsx: 0.25, le: -1.9, lhz: 0.12, rhz: -0.12, lk: 0.12, rk: 0.12 })
    }
    // a hop up to slap the bar
    const u = (t % 1.2) / 1.2
    const up = Math.max(0, Math.sin(u * Math.PI * 1.25))
    return pose({ y: 0.55 * up - 0.12 * (1 - up), lsx: -2.95 * up - 0.4, rsx: -2.95 * up - 0.4, lsz: 0.2, rsz: -0.2, lk: 0.9 * (1 - up), rk: 0.9 * (1 - up), lhx: -0.5 * (1 - up), rhx: -0.5 * (1 - up), sx: 0.2 * (1 - up) })
  }

  private updateKeeperIdle(real: number) {
    const k = this.keeper
    if (!this.idleKeeper || this.busy) return
    // shuffle along the line now and then
    if (this.clock > this.nextShuffle) {
      this.keeperXTo = (Math.random() - 0.5) * 1.3
      this.nextShuffle = this.clock + 0.8 + Math.random() * 1.6
    }
    this.keeperX += (this.keeperXTo - this.keeperX) * Math.min(1, real * 3)
    k.rig.root.position.x = this.keeperX
    if (this.clock > this.nextTaunt) {
      this.nextTaunt = this.clock + 5 + Math.random() * 5
      const kind = Math.floor(Math.random() * 4)
      k.rig.setExpr(kind === 1 ? 'smug' : 'taunt')
      k.play((t) => this.keeperTaunt(t, kind), this.time, 0.25)
      if (kind === 0 || kind === 2) this.sound.taunt()
      const back = kind === 3 ? 1.2 : 1.6
      void this.wait(back).then(() => {
        if (this.busy || !this.idleKeeper || this.keeper !== k) return
        k.rig.setExpr('smug')
        k.play((t) => this.keeperIdle(t), this.time, 0.3)
      })
    }
  }

  private lookAtBall(r: Rig, root: THREE.Object3D) {
    const head = r.neck.getWorldPosition(V())
    const d = this.ballPos.clone().sub(head)
    // into the keeper's own frame (he faces +z, turned by his root)
    d.applyAxisAngle(V(0, 1, 0), -root.rotation.y)
    const x = Math.atan2(d.x, Math.max(0.3, d.z)) / 0.9
    const y = Math.atan2(d.y + 0.3, Math.hypot(d.x, d.z)) / 0.7
    r.look(x, y)
  }

  /* ---------------- placing things ---------------- */

  private placeStriker(at: THREE.Vector3, yaw: number) {
    this.striker.rig.root.position.copy(at)
    this.striker.rig.root.rotation.y = yaw
  }

  /** the yaw that faces from `at` towards the ball's spot */
  private faceBall(at: THREE.Vector3) {
    return Math.atan2(SPOT.x - at.x, SPOT.z - at.z)
  }

  private updateShadows() {
    const sh = (m: THREE.Mesh, p: THREE.Vector3, size: number, k = 1) => {
      m.position.set(p.x, 0.012, p.z)
      m.scale.set(size, 1, size * 0.8)
      ;(m.material as THREE.MeshBasicMaterial).opacity = 0.6 * k
    }
    const lift = Math.max(0, this.ballPos.y - BALL_R)
    this.ballShadow.position.set(this.ballPos.x, 0.011, this.ballPos.z)
    this.ballShadow.scale.setScalar(Math.max(0.2, 0.75 - lift * 0.12))
    this.ballShadow.visible = this.ballMode !== 'hidden' && this.ball.visible
    const hs = this.striker.rig.hips.getWorldPosition(V())
    sh(this.shadows[0], hs, 1.5 * this.striker.rig.scale)
    const hk = this.keeper.rig.hips.getWorldPosition(V())
    sh(this.shadows[1], hk, 1.7 * this.keeper.rig.scale, Math.max(0.3, 1 - Math.max(0, hk.y - 1) * 0.6))
  }

  /* ---------------- the ball ---------------- */

  private updateBall(dt: number) {
    const b = this.ball
    if (!b) return
    if (this.ballMode === 'free' && this.free && dt > 0) {
      const f = this.free
      const n = Math.ceil(dt / 0.008)
      const h = dt / n
      for (let i = 0; i < n; i++) {
        f.v.y -= 9.8 * h
        const prev = this.ballPos.clone()
        this.ballPos.addScaledVector(f.v, h)
        // the roof of the net: a ball coming down on it bounces off and rolls back
        if (!f.inGoal && !f.roofHit && Math.abs(this.ballPos.x) < GOAL.hw && this.ballPos.z < 0 && this.ballPos.z > NET.topBackZ) {
          const roofY = lerp(GOAL.h, NET.topBackY, this.ballPos.z / NET.topBackZ) + BALL_R
          if (prev.y >= roofY && this.ballPos.y < roofY && f.v.y < 0) {
            this.ballPos.y = roofY
            f.v.y = -f.v.y * 0.35
            f.v.z -= 1.2
            f.roofHit = true
            this.netHit(V(this.ballPos.x, roofY - BALL_R, this.ballPos.z), 0.18)
          }
        }
        if (this.ballPos.y < BALL_R) {
          this.ballPos.y = BALL_R
          if (Math.abs(f.v.y) > 0.8) {
            this.sound.bounce(Math.min(1, Math.abs(f.v.y) / 6))
            this.puffGrass(this.ballPos, 3)
          }
          f.v.y = Math.abs(f.v.y) * 0.45
          f.v.x *= 0.82
          f.v.z *= 0.82
          if (f.v.y < 0.4) f.v.y = 0
        }
        if (this.ballPos.y <= BALL_R + 1e-3) {
          // rolling: grass drags it to a stop
          f.v.x *= 1 - 1.6 * h
          f.v.z *= 1 - 1.6 * h
        }
        if (f.inGoal) {
          // the net holds it in
          const back = lerp(NET.bottomBackZ, NET.topBackZ, clamp01(this.ballPos.y / NET.topBackY)) + BALL_R
          if (this.ballPos.z < back) {
            this.ballPos.z = back
            f.v.z = Math.abs(f.v.z) * 0.2
          }
          if (this.ballPos.z > -BALL_R) {
            this.ballPos.z = -BALL_R
            f.v.z = -Math.abs(f.v.z) * 0.3
          }
          const side = GOAL.hw - GOAL.post - BALL_R
          if (Math.abs(this.ballPos.x) > side) {
            this.ballPos.x = Math.sign(this.ballPos.x) * side
            f.v.x *= -0.3
          }
          if (this.ballPos.y > GOAL.h - BALL_R) {
            this.ballPos.y = GOAL.h - BALL_R
            f.v.y = -Math.abs(f.v.y) * 0.3
          }
        }
      }
      // it rolls, spinning the way it goes
      const sp = Math.hypot(f.v.x, f.v.z)
      if (sp > 0.05) this.ballSpin.rotateOnWorldAxis(V(f.v.z, 0, -f.v.x).normalize(), (sp / BALL_R) * dt)
    } else if (this.ballMode === 'held') {
      const r = this.keeper.rig
      const a = r.hands[0].getWorldPosition(V())
      const c = r.hands[1].getWorldPosition(V())
      this.ballPos.copy(a).add(c).multiplyScalar(0.5)
      // in front of the gloves, towards the camera side of his body
      const fwd = V(0, 0, 1).applyQuaternion(r.hips.getWorldQuaternion(new THREE.Quaternion()))
      this.ballPos.addScaledVector(fwd, BALL_R * 0.6)
    }
    b.position.copy(this.ballPos)
    b.visible = this.ballMode !== 'hidden'
  }

  /** where a ball crossing the line at p, going along v, meets the back of the net */
  private netPoint(p: THREE.Vector3, v: THREE.Vector3) {
    const dir = v.clone().normalize()
    // step along until behind the back wall of the net
    const q = p.clone()
    for (let i = 0; i < 80; i++) {
      q.addScaledVector(dir, 0.05)
      const back = lerp(NET.bottomBackZ, NET.topBackZ, clamp01(q.y / NET.topBackY))
      if (q.z <= back + BALL_R || Math.abs(q.x) > GOAL.hw - BALL_R - 0.05 || q.y > GOAL.h - 0.25) break
    }
    q.x = Math.max(-GOAL.hw + BALL_R + 0.1, Math.min(GOAL.hw - BALL_R - 0.1, q.x))
    q.y = Math.max(BALL_R, Math.min(GOAL.h - 0.25, q.y))
    return q
  }

  private netHit(at: THREE.Vector3, amp: number) {
    this.netT = 0
    this.netAmp = amp
    this.stadium.net.uniforms.uHit.value.copy(at)
    if (this.recording) this.recNet = at.clone()
  }
  private recNet: THREE.Vector3 | null = null

  /* ---------------- effects ---------------- */

  private cameraFlash(n = 1) {
    const seats = this.stadium.seats
    if (!seats.length) return
    for (let i = 0; i < n; i++) {
      const s = seats[Math.floor(Math.random() * seats.length)]
      this.sparks.emit(s.x, s.y, s.z + 0.3, 0, 0, 0, new THREE.Color(3, 3, 3.2), rnd(0.7, 1.2), rnd(0.06, 0.12))
    }
  }

  private puff(at: THREE.Vector3, n: number) {
    const c = new THREE.Color('#ffffff')
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      this.sparks.emit(at.x, at.y + rnd(-0.6, 0.6), at.z, Math.cos(a) * rnd(0.6, 1.8), rnd(0, 1.5), Math.sin(a) * rnd(0.3, 1), c, rnd(0.35, 0.6), rnd(0.35, 0.6), -1, 2.5)
    }
  }

  private puffGrass(at: THREE.Vector3, n: number, kick = false) {
    const dust = new THREE.Color('#d9f2c4')
    for (let i = 0; i < n * 2; i++) {
      const a = Math.random() * TAU
      this.sparks.emit(at.x, 0.06, at.z, Math.cos(a) * rnd(0.3, 1.2), rnd(0.2, 0.9), Math.sin(a) * rnd(0.3, 1.2), dust, rnd(0.18, 0.32), rnd(0.25, 0.5), -2, 3)
    }
    const greens = ['#3aa64f', '#2f8f44', '#5cc46a'].map((c) => new THREE.Color(c))
    for (let i = 0; i < (kick ? n * 3 : n); i++) {
      this.turf.emit(V(at.x + rnd(-0.08, 0.08), 0.04, at.z + rnd(-0.08, 0.08)), V(rnd(-0.8, 0.8), rnd(1.2, 2.8), kick ? rnd(-2.6, -0.6) : rnd(-0.8, 0.8)), greens[i % 3], rnd(0.7, 1.3), rnd(0.6, 1), -9.8)
    }
  }

  private confettiBurst(n: number, gold = false) {
    const cols = (gold ? ['#ffd23f', '#fff1a8', '#ffb02e', '#ffffff'] : ['#ff3b4e', '#ffffff', '#ffd23f', '#2ef08c', '#5cc8ff', '#ff6fc4']).map((c) => new THREE.Color(c).multiplyScalar(1.1))
    for (let i = 0; i < n; i++) {
      // over the goal mouth and in front of it, falling towards the camera's view
      const x = rnd(-9, 9)
      const z = rnd(-2, 9)
      this.confetti.emit(V(x, rnd(6, 10), z), V(rnd(-0.6, 0.6), rnd(-2.2, -0.6), rnd(-0.3, 0.6)), cols[i % cols.length], rnd(0.8, 1.4), rnd(3, 4.5), -1.2, rnd(4, 11))
    }
  }

  /** a rocket off the stand's roof that bursts at `at` */
  private firework(at: THREE.Vector3, color: string) {
    const c = new THREE.Color(color).multiplyScalar(2.2)
    const white = new THREE.Color(2.6, 2.6, 2.6)
    const ember = new THREE.Color(2, 1.6, 1.1)
    // up from the front of the stand, bursting over the heads of the crowd
    const from = V(at.x + rnd(-1.5, 1.5), 1.4, BOARD_Z - 0.6)
    const p = V()
    this.sound.firework()
    void this.tween(0.45, (u) => {
      p.lerpVectors(from, at, easeOut(u))
      this.sparks.emit(p.x, p.y, p.z, rnd(-0.2, 0.2), rnd(-0.8, -0.2), 0, ember, rnd(0.22, 0.36), rnd(0.25, 0.45), -1, 1)
    }).then(() => {
      for (let i = 0; i < 80; i++) {
        const u = Math.random() * 2 - 1
        const a = Math.random() * TAU
        const r = Math.sqrt(1 - u * u)
        const sp = rnd(2.3, 3.3)
        this.sparks.emit(at.x, at.y, at.z, Math.cos(a) * r * sp, u * sp, Math.sin(a) * r * sp * 0.4, i % 4 ? c : white, rnd(0.38, 0.7), rnd(0.9, 1.4), -2.4, 1.2)
      }
      this.flash = Math.max(this.flash, 0.35)
    })
  }

  /* ---------------- a shot ---------------- */

  /**
   * Plays one penalty as the shot has it, and resolves once the players are back in place for the next one. `goals`
   * is the run's tally after this shot. `cues.result` fires the moment the outcome is plain to see.
   */
  async shoot(shot: Shot, goals: number, cues: ShotCues, stakes: Stakes = { shot: 1, tension: 0 }) {
    if (this.busy || !this.keeper) {
      cues.result()
      return
    }
    let finished!: () => void
    this.current = new Promise<void>((r) => (finished = r))
    this.busy = true
    this.hurried = false
    this.rushing = false
    this.idleKeeper = false
    this.poke()
    let told = false
    const tell = () => {
      if (told) return
      told = true
      cues.result()
    }
    const k = this.keeper
    const s = this.striker
    const sup = this.speed === 2
    const tension = sup ? 0 : clamp01(stakes.tension)
    try {
      // the aimed zone flashes as he commits to it; the rest of the grid and the last read go
      this.lock = 1
      this.gridTo = 0
      this.markTo = 0
      this.focusTo.copy(LOOK)
      k.rig.root.rotation.set(0, 0, 0)
      const kx0 = k.rig.root.position.x
      // the striker sets himself (breathing hard when it matters)
      s.rig.setExpr('focus')
      s.play((t) => with_(STAND, { y: -0.06 + 0.014 * Math.sin(t * 3.4) * tension, sx: 0.2 + 0.03 * Math.sin(t * 3.4) * tension, nx: -0.15, lsz: 0.25, rsz: -0.25, lk: 0.25, rk: 0.25, sy: 0.04 * Math.sin(t * 1.3) }), this.time, 0.25)
      if (stakes.board && !sup) this.setBoards('custom', 30, stakes.board)
      const setDur = sup ? 0.06 : 0.42 + 0.6 * tension
      if (tension > 0.05) {
        // a big one: the stand goes quiet, a heartbeat, the camera creeps in, and the keeper tries to get in his head
        this.hush = tension
        this.sound.heartbeat(tension)
        const z0 = this.zoomTo
        const taunt = tension >= 0.3 ? 0.95 : 0
        void this.tween(setDur + taunt, (u) => (this.zoomTo = z0 + 0.07 * tension * smooth(u)))
        if (taunt) {
          const kind = stakes.last ? 3 : shot.flavour < 0.5 ? 0 : 2
          k.rig.setExpr('taunt')
          k.play((t) => this.keeperTaunt(t, kind), this.time, 0.2)
          this.sound.taunt(true)
          await this.wait(taunt)
        }
      }
      // the keeper crouches in the middle of his line
      k.rig.setExpr('focus')
      k.play((t) => with_(READY, { y: 0.03 * Math.abs(Math.sin(t * 4)), rz: 0.02 * Math.sin(t * 2) }), this.time, 0.25)
      const kxTo = lerp(kx0, 0, 0.7) + (shot.flavour - 0.5) * 0.3
      void this.tween(sup ? 0.25 : 0.5, (u) => (k.rig.root.position.x = lerp(kx0, kxTo, smooth(u))))
      this.keeperX = kxTo
      if (!sup) this.sound.whistle(stakes.shot)
      if (!tension) this.setAmbience?.(0.35)
      await this.wait(setDur)

      // the run-up: from the top of the run to a plant beside the ball
      const start = s.rig.root.position.clone()
      const yaw = this.faceBall(start)
      const fwd = V(Math.sin(yaw), 0, Math.cos(yaw))
      // his right hip (local -x), turned by the yaw
      const rhip = V(-0.105, 0, 0).applyAxisAngle(V(0, 1, 0), yaw).multiplyScalar(s.rig.scale)
      const plant = SPOT.clone().setY(0).sub(rhip).addScaledVector(fwd, -0.36 * s.rig.scale)
      const runDur = 0.82
      s.play((t) => runPose(t * TAU * 1.95, 0.6 + 0.4 * clamp01(t / 0.3)), this.time, 0.18)
      let stepN = 0
      const z1 = this.zoomTo
      await this.tween(runDur, (u) => {
        // accelerating, so the last strides are the quickest
        const k2 = u * u * (1.7 - 0.7 * u)
        s.rig.root.position.lerpVectors(start, plant, k2)
        s.rig.root.rotation.y = lerp(s.rig.root.rotation.y, near(yaw, s.rig.root.rotation.y), 0.2)
        const n = Math.floor(u * 3.6)
        if (n > stepN) {
          stepN = n
          this.sound.step()
        }
        this.zoomTo = z1 + 0.04 * u
      })
      // the plant and the strike
      s.play((t) => kickPose(t), this.time, 0.06)
      this.sound.step()
      // the keeper's split step just before the strike
      k.play((t) => with_(READY, { y: 0.1 * Math.sin(Math.min(1, t / 0.22) * Math.PI), lk: -0.3 * Math.sin(Math.min(1, t / 0.22) * Math.PI), rk: -0.3 * Math.sin(Math.min(1, t / 0.22) * Math.PI) }), this.time, 0.08)
      await this.wait(KICK_AT)

      // the ball's flight
      const plan = this.planFlight(shot)
      cues.kick?.()
      this.hush = 0
      this.sound.kick(plan.chip ? 0.6 : 1)
      this.shake = 0.6
      this.puffGrass(SPOT, 4, true)
      this.ballMode = 'path'
      this.trail.reset()
      this.trail.on = true
      this.recording = []
      // the keeper goes when the dive must start to meet the ball on time
      const diveAt = Math.max(0.02, plan.dur - plan.dive.dur)
      let dove = false
      let slowed = false
      const spinAxis = V(1, 0, 0)
      const p0 = SPOT.clone()
      const z2 = this.zoomTo
      await this.tween(plan.dur, (u) => {
        const t = u * plan.dur
        bez(p0, plan.ctrl, plan.end, u, this.ballPos)
        const d = bezD(p0, plan.ctrl, plan.end, u, V())
        spinAxis.set(d.z, 0, -d.x).normalize()
        this.ballSpin.rotateOnWorldAxis(spinAxis, 0.35)
        // a touch bigger in flight, so it reads all the way to the goal
        this.ball.scale.setScalar(1 + (FLIGHT_SCALE - 1) * smooth(Math.min(1, u * 2)))
        if (!dove && t >= diveAt) {
          dove = true
          this.dive(plan.dive)
        }
        // the zoom follows the ball in
        this.zoomTo = z2 + 0.1 * u
        // slow motion for the fingertip moments
        if (plan.slowmo && !slowed && t >= plan.dur - 0.2) {
          slowed = true
          this.slowMo(plan.slowmo)
        }
      })
      if (!dove) this.dive(plan.dive)
      this.trail.on = false

      if (shot.goal) await this.goalFinish(shot, plan, goals, tell, cues)
      else await this.saveFinish(shot, plan, tell, cues)
      await this.resetForNext(shot.goal)
    } finally {
      this.endCutaway(cues)
      this.slow = 1
      this.zoomTo = 1
      this.focusTo.copy(LOOK)
      this.hush = 0
      this.busy = false
      this.hurried = false
      this.rushing = false
      this.recording = null
      this.replaying = false
      this.party = false
      this.trail.on = false
      for (const m of this.mates) m.rig.root.visible = false
      tell()
      this.current = null
      finished()
    }
  }

  private cutTo(cues: ShotCues) {
    this.cutaway = true
    cues.away?.(true)
  }
  private endCutaway(cues: ShotCues) {
    if (!this.cutaway) return
    this.cutaway = false
    cues.away?.(false)
  }

  private slowMo(how: { k: number; hold: number }) {
    if (this.hurried || this.rushing) return
    this.sound.slowmo()
    const k0 = this.slow
    void this.tween(0.06, (u) => (this.slow = lerp(k0, how.k, u))).then(() =>
      this.tween(how.hold * how.k, () => {}).then(() => this.tween(0.3 * how.k, (u) => (this.slow = lerp(how.k, 1, smooth(u))))),
    )
    this.zoomTo = 1.2
  }

  /** a ring of light where the ball meets the net (gold) or the gloves (white) */
  private ringFlash(at: THREE.Vector3, goal: boolean) {
    this.ring.position.copy(at).add(V(0, 0, 0.35))
    ;(this.ring.material as THREE.SpriteMaterial).color.copy(goal ? new THREE.Color(2.4, 1.85, 0.6) : new THREE.Color(2.3, 2.4, 2.7))
    this.ring.visible = true
    this.ringT = 0
  }

  /** where the ball goes and how it gets there, and the keeper's dive to match */
  private planFlight(shot: Shot) {
    const c = zoneCenter(shot.zone)
    const side = zoneCol(shot.zone) !== 1
    let x = c.x + shot.dx * (side ? 0.62 : 0.55)
    let y = c.y + shot.dy * 0.34
    x = Math.max(-GOAL.hw + GOAL.post + BALL_R + 0.14, Math.min(GOAL.hw - GOAL.post - BALL_R - 0.14, x))
    y = Math.max(BALL_R + 0.04, Math.min(GOAL.h - GOAL.post - BALL_R - 0.1, y))
    if (shot.goal && shot.finish === 'post') x = Math.sign(c.x) * (GOAL.hw - GOAL.post - BALL_R * 0.45)
    if (shot.goal && shot.finish === 'bar') y = GOAL.h - GOAL.post - BALL_R * 0.45
    const target = V(x, y, 0)
    // a save is met by the gloves in front of the line; a goal flies to the line
    const end = shot.goal ? target.clone() : V(x, y, SAVE_Z)
    // a chip down the middle when the keeper has gone to a side
    const chip = shot.goal && zoneCol(shot.zone) === 1 && zoneCol(shot.dive) !== 1 && shot.flavour < 0.4
    // a chip is shown as one, with the keeper committed to his side: a fingertip finish would put him under the ball
    // as it drops
    const close = shot.close && !chip
    const dur = chip ? 1.0 : 0.6 + (shot.goal ? 0 : -0.02)
    const mid = SPOT.clone().add(end).multiplyScalar(0.5)
    const curl = side ? Math.sign(x) * (0.35 + shot.flavour * 0.8) : (shot.flavour - 0.5) * 0.7
    const lift = chip ? 3.6 : 0.2 + y * 0.42
    const ctrl = mid.clone().add(V(curl, lift, 0))
    // the keeper
    const dz = shot.dive
    const dc = zoneCenter(dz)
    let hands: THREE.Vector3
    if (!shot.goal) hands = end.clone()
    else if (close) {
      // he gets there, just a fingertip short of the ball
      const ball = V(x, y, SAVE_Z)
      const toward = V(dc.x + (shot.flavour - 0.5) * 0.4, dc.y, SAVE_Z).sub(ball).normalize()
      hands = ball.addScaledVector(toward, BALL_R + 0.3)
    } else hands = V(dc.x + (shot.flavour - 0.5) * 0.8, dc.y + (shot.flavour - 0.5) * 0.3, SAVE_Z)
    // on a goal, the ball's last stretch, from well in front of the keeper to the line: where it is and when (its depth
    // falls evenly from the spot to the line along the path, so u follows from z)
    let pass: { at: THREE.Vector3; t: number }[] | undefined
    if (shot.goal) {
      pass = []
      for (let z = KEEPER_Z + 1.3; z >= Math.max(end.z, KEEPER_Z - 0.45); z -= 0.09) {
        const u = 1 - (z - end.z) / (SPOT.z - end.z)
        pass.push({ at: bez(SPOT, ctrl, end, u, V()), t: u * dur })
      }
    }
    const dive = this.planDive(hands, shot, chip, pass && { pass, flight: dur })
    // a keeper who had to be moved well clear of the ball is no longer a fingertip away: no slow motion, no caption
    const near = close && Math.abs(dive.moved) < 0.45
    const slowmo = shot.goal && near ? { k: 0.18, hold: 0.42 } : !shot.goal && shot.save === 'tip' ? { k: 0.3, hold: 0.32 } : shot.goal && shot.finish !== 'clean' ? { k: 0.35, hold: 0.25 } : null
    return { target, end, ctrl, dur, chip, close: near, dive, slowmo }
  }

  /**
   * Works out where the keeper's hips must be for his gloves to reach `hands`. On a goal (`goal.pass` is the ball's
   * last stretch past him, and when) all of him must miss the ball, not just his gloves: a trailing boot, a hand or his
   * head in the ball's path would read as a save, so the dive slides along the line until his whole silhouette clears
   * the ball at every point of that stretch, wherever his dive has got him to by then (clearX).
   */
  private planDive(hands: THREE.Vector3, shot: Shot, chip: boolean, goal?: { pass: { at: THREE.Vector3; t: number }[]; flight: number }) {
    const r = this.keeper.rig
    const sideways = Math.abs(hands.x) > 0.95
    const high = hands.y > 1.25
    const kind: 'side' | 'up' | 'low' = sideways ? 'side' : high ? 'up' : 'low'
    const roll = kind === 'side' ? -Math.sign(hands.x) * lerp(1.62, 0.9, clamp01((hands.y - 0.25) / 1.8)) : kind === 'up' ? -hands.x * 0.35 : 0
    const p = kind === 'low' ? (hands.y < 0.55 ? SPREAD : BLOCK) : DIVE
    // pose the rig at the moment of contact (hips at the origin of its root) and measure where its gloves are
    const root = r.root
    const keep = { pos: root.position.clone(), rot: root.rotation.clone() }
    const start = { ...this.keeper.last }
    root.position.set(0, 0, 0)
    root.rotation.set(0, 0, 0)
    applyPose(r, with_(p, { rz: roll }))
    root.updateMatrixWorld(true)
    const a = r.hands[0].getWorldPosition(V())
    const b = r.hands[1].getWorldPosition(V())
    // with the root at the origin, the gloves' position is exactly where they sit relative to the root
    const gloves = a.add(b).multiplyScalar(0.5)
    const rootAt = hands.clone().sub(gloves)
    // a block or a jump keeps his feet on (or above) the grass; a dive can put the root anywhere, the body is flying
    if (kind === 'low') rootAt.y = Math.min(p === BLOCK ? 0.35 : 0.08, Math.max(0, rootAt.y))
    if (kind === 'up') rootAt.y = Math.max(0, rootAt.y)
    rootAt.z = KEEPER_Z
    // when he guesses wrong on a chip he is already on his way down; otherwise the dive takes this long
    const dur = (kind === 'side' ? 0.44 : kind === 'up' ? 0.34 : 0.26) * (chip ? 0.85 : 1)
    let passing: Passing[] | null = null
    let moved = 0
    if (goal) {
      // where he is and how he is shaped as the ball goes by, as dive() moves him: his hips from where he stands (he
      // holds his line until he goes) towards rootAt on an arc, his pose blending from the split step into the dive
      const body = silhouette(r)
      const from = keep.pos
      const diveAt = Math.max(0.02, goal.flight - dur)
      const arc = kind === 'side' ? 0.22 : kind === 'up' ? 0.12 : 0
      passing = []
      for (const { at, t } of goal.pass) {
        const u = clamp01((t - diveAt) / dur)
        if (u < 0.55) continue
        let pts = body
        if (u < 0.8) {
          applyPose(r, mixPose(start, with_(p, { rz: roll * easeOut(u) }), smooth(Math.min(1, u * 1.25))))
          root.updateMatrixWorld(true)
          pts = silhouette(r)
        }
        const e = kind === 'low' ? smooth(u) : easeOut(u)
        passing.push({ pts, ball: at, e, x0: from.x * (1 - e), y: lerp(from.y, rootAt.y, e) + arc * 4 * u * (1 - u) })
      }
    }
    root.position.copy(keep.pos)
    root.rotation.copy(keep.rot)
    applyPose(r, this.keeper.last)
    root.updateMatrixWorld(true)
    if (passing && goal) {
      const cross = goal.pass[goal.pass.length - 1].at
      const x = clearX(passing, rootAt.x, Math.sign(hands.x - cross.x) || (shot.flavour < 0.5 ? -1 : 1), this.camBase)
      moved = x - rootAt.x
      hands.x += moved
      rootAt.x = x
    }
    return { kind, roll, hands, rootAt, base: p, dur, save: !shot.goal, moved }
  }

  /** the keeper's dive, timed by plan.dur so the gloves arrive when the ball does */
  private dive(d: ReturnType<PenaltyScene['planDive']>) {
    const k = this.keeper
    const root = k.rig.root
    const from = root.position.clone()
    const roll = d.roll
    this.sound.dive()
    const base = d.base
    const start = { ...k.last }
    k.rig.setExpr(d.save ? 'focus' : 'shock')
    // the pose stretches out on the way; the hips fly to their spot on an arc
    k.play((t) => {
      const u = clamp01(t / d.dur)
      return mixPose(start, with_(base, { rz: roll * easeOut(u) }), smooth(Math.min(1, u * 1.25)))
    }, this.time, 0.01)
    const arc = d.kind === 'side' ? 0.22 : d.kind === 'up' ? 0.12 : 0
    void this.tween(d.dur, (u) => {
      const e = d.kind === 'low' ? smooth(u) : easeOut(u)
      root.position.x = lerp(from.x, d.rootAt.x, e)
      root.position.y = lerp(from.y, d.rootAt.y, e) + arc * 4 * u * (1 - u)
      root.position.z = from.z
    })
  }

  /** after the contact: the keeper comes down (on his side, on his feet, or stays down in his block) */
  private async keeperLand(d: ReturnType<PenaltyScene['planDive']>, holding: boolean, ballX?: number) {
    const k = this.keeper
    const root = k.rig.root
    const restH = k.rig.hipH * k.rig.scale
    if (d.kind === 'side') {
      const dir = Math.sign(d.hands.x) || 1
      // a ball that beat him on his own side (in off the post) is going in right behind him: he comes down short of it
      // rather than sliding into its path
      const reach = ballX != null && Math.sign(ballX - root.position.x) === dir ? 0.2 : 1
      const from = root.position.clone()
      const start = { ...k.last }
      const endRoll = -dir * 1.5
      // he falls on to his side, the ball tucked in if he holds it
      const lie = holding ? with_(LIE, { lsx: 1.4, rsx: 1.2, le: -1.0, re: -1.0, rz: endRoll }) : with_(LIE, { rz: endRoll })
      k.play((t) => mixPose(start, lie, smooth(clamp01(t / 0.36))), this.time, 0.01)
      // lying, the hips are about a hip's width off the grass
      const lieY = 0.2 * k.rig.scale - restH
      await this.tween(0.36, (u) => {
        root.position.x = from.x + dir * 0.6 * reach * easeOut(u)
        root.position.y = lerp(from.y, lieY, easeIn(u))
      })
      this.sound.land()
      this.puffGrass(V(root.position.x, 0, KEEPER_Z), 5)
      this.shake = Math.max(this.shake, 0.25)
      // a short slide
      const x0 = root.position.x
      await this.tween(0.22, (u) => (root.position.x = x0 + dir * 0.25 * reach * easeOut(u)))
    } else if (d.kind === 'up') {
      // back down on his feet
      const from = root.position.clone()
      const start = { ...k.last }
      k.play((t) => mixPose(start, holding ? with_(READY, { lsx: -1.2, rsx: -1.2, le: -1.2, re: -1.2, lsz: 0.25, rsz: -0.25 }) : READY, smooth(clamp01(t / 0.3))), this.time, 0.01)
      await this.tween(0.3, (u) => {
        root.position.y = lerp(from.y, 0, easeIn(u))
      })
      this.sound.land()
    } else {
      await this.wait(0.15)
    }
  }

  /** a goal: into the net (or off the post or bar first), the net bulges, the crowd erupts */
  private async goalFinish(shot: Shot, plan: ReturnType<PenaltyScene['planFlight']>, goals: number, tell: () => void, cues: ShotCues) {
    const k = this.keeper
    const s = this.striker
    const sup = this.speed === 2
    let v = bezD(SPOT, plan.ctrl, plan.end, 1, V()).divideScalar(plan.dur)
    const landing = this.keeperLand(plan.dive, false, plan.target.x)
    if (plan.close) cues.moment?.('close')
    else if (plan.chip) cues.moment?.('chip')
    if (shot.finish === 'post' || shot.finish === 'bar') {
      // clang, and in it goes (the caption waits until it is in)
      this.sound.post(shot.finish === 'bar')
      this.shake = 0.5
      const at = this.ballPos.clone()
      const spark = new THREE.Color(2.5, 2.5, 2.5)
      for (let i = 0; i < 14; i++) this.sparks.emit(at.x, at.y, at.z, rnd(-2, 2), rnd(-2, 2), rnd(0, 2), spark, rnd(0.15, 0.3), rnd(0.2, 0.4), -3, 2)
      if (shot.finish === 'post') v = V(-Math.sign(at.x) * 5.5, v.y * 0.3, -8)
      else {
        // down off the bar, a bounce behind the line, up into the net
        v = V(v.x * 0.4, -7, -3)
        const bounce = V(at.x + v.x * 0.25, BALL_R, -0.75)
        const from = at.clone()
        this.trail.on = true
        await this.tween(0.16, (u) => this.ballPos.lerpVectors(from, bounce, u))
        this.puffGrass(bounce, 3)
        this.sound.bounce(0.8)
        v = V(v.x, 4.5, -7)
      }
    }
    // into the back of the net
    const p = this.ballPos.clone()
    const hit = this.netPoint(p, v)
    const t = Math.max(0.06, p.distanceTo(hit) / Math.max(8, v.length()))
    this.trail.on = true
    await this.tween(t, (u) => this.ballPos.lerpVectors(p, hit, u))
    this.trail.on = false
    // the net takes it: a beat of hit-stop, a big bulge, the boards flare, a ring where it struck and a punch in on it
    this.netHit(hit, 1.25)
    this.sound.net()
    this.boardFlash = 1
    this.ringFlash(hit, true)
    if (!sup && !this.rushing) {
      this.freeze = this.hurried ? 0.05 : 0.13
      this.focusTo.copy(LOOK).lerp(hit, 0.8)
      this.zoomTo = this.narrow ? 1.3 : 1.48
    }
    // the ball rides the bulge out, then drops inside the goal
    const out = V(0, 0.4, -0.92).multiplyScalar(0.55)
    const deep = hit.clone().add(out)
    await this.tween(0.12, (u) => this.ballPos.lerpVectors(hit, deep, easeOut(u)))
    if (shot.finish === 'post' || shot.finish === 'bar') cues.moment?.(shot.finish)
    this.resultAt = this.clock
    tell()
    this.celebrateGoal(goals)
    this.ballMode = 'free'
    this.free = { v: V(v.x * 0.05, -0.5, 1.6), inGoal: true, roofHit: true }
    s.rig.setExpr('joy')
    // a moment on the bulging net, then back out so the celebration stays in the picture
    await this.wait(sup ? 0.05 : 0.42)
    const rec = this.recording
    this.recording = null
    this.focusTo.copy(LOOK)
    this.zoomTo = goals >= 10 ? 0.84 : 0.9
    const replay = !sup && this.speed === 0 && !this.hurried && !this.rushing && goals < 10 && !!rec && (plan.close || shot.finish !== 'clean')
    if (!replay) {
      this.showRead(shot)
    }
    const kind = goals >= 10 ? 2 : sup ? 1 : Math.floor(shot.flavour * 3)
    const celebrate = this.strikerCelebrate(kind, sup)
    await landing
    k.rig.setExpr(plan.close ? 'shock' : 'sad')
    const kStart = { ...k.last }
    const root = k.rig.root
    if (plan.dive.kind === 'side') {
      // the keeper thumps the grass, then sits up, gutted
      k.play((t) => with_(kStart, { rsx: -0.9 * Math.max(0, Math.sin(t * 10)), re: -0.7 * Math.max(0, Math.sin(t * 10)) }), this.time, 0.08)
      this.sound.thump()
      await this.wait(sup ? 0.15 : 0.5)
      const s0 = { ...k.last }
      const y0 = root.position.y
      k.rig.setExpr('sad')
      k.play((t) => mixPose(s0, SIT, smooth(clamp01(t / 0.45))), this.time, 0.01)
      await this.tween(sup ? 0.25 : 0.45, (u) => (root.position.y = lerp(y0, 0, smooth(u))))
    } else {
      // hands on his knees, head down
      k.play((t) => mixPose(kStart, with_(STAND, { y: -0.08, sx: 0.55, nx: 0.25, lsx: -0.75, rsx: -0.75, lsz: 0.15, rsz: -0.15, le: -0.25, re: -0.25, lhx: -0.25, rhx: -0.25, lk: 0.45, rk: 0.45, la: -0.2, ra: -0.2 }), smooth(clamp01(t / 0.5))), this.time, 0.05)
      await this.tween(0.3, (u) => (root.position.y = root.position.y * (1 - u)))
    }
    // the near things again, from the side
    if (replay && rec) {
      await this.replay(rec, shot, cues)
      this.showRead(shot)
    }
    await celebrate
    if (goals >= 10) await this.perfect(cues)
  }

  /** the last moments of the shot again, slowed down, from beside the post */
  private async replay(rec: RecFrame[], shot: Shot, cues: ShotCues) {
    let hitI = rec.findIndex((f) => f.net)
    if (hitI < 0) hitI = rec.length - 1
    let i0 = hitI
    let acc = 0
    while (i0 > 0 && acc < 0.75) acc += rec[--i0].dt
    let i1 = hitI
    acc = 0
    while (i1 < rec.length - 1 && acc < 0.28) acc += rec[++i1].dt
    const frames = rec.slice(i0, i1 + 1)
    if (frames.length < 4) return
    const side = Math.sign(rec[hitI].ball.x) || (shot.flavour < 0.5 ? -1 : 1)
    const cam = this.closeCam
    cam.fov = this.narrow ? 44 : 34
    cam.position.set(side * 7.6, 1.25, 3.6)
    cam.lookAt(side * 1.1, 1.0, -0.5)
    cam.updateProjectionMatrix()
    const k = this.keeper
    const root = k.rig.root
    const keep = { pos: root.position.clone(), rot: root.rotation.clone(), ball: this.ballPos.clone(), spin: this.ballSpin.quaternion.clone(), scale: this.ball.scale.x, vis: this.ball.visible, marks: this.markTo }
    this.markTo = 0
    this.replaying = true
    this.trail.reset()
    this.trail.on = true
    this.cutTo(cues)
    cues.replay?.(true)
    this.sound.replay()
    const total = frames.reduce((a, f) => a + f.dt, 0)
    let netted = false
    const cam0 = cam.position.clone()
    await this.tween(total / 0.62, (u) => {
      let t = u * total
      let j = 0
      while (j < frames.length - 1 && t > frames[j].dt) {
        t -= frames[j].dt
        j++
      }
      const f = frames[j]
      this.ballPos.copy(f.ball)
      this.ball.position.copy(f.ball)
      this.ballSpin.quaternion.copy(f.spin)
      this.ball.scale.setScalar(f.scale)
      this.ball.visible = f.shown
      root.position.copy(f.kPos)
      root.rotation.copy(f.kRot)
      applyPose(k.rig, f.pose)
      if (f.net && !netted) {
        netted = true
        this.netHit(f.net, 1.1)
        this.trail.on = false
      }
      // the camera drifts along with it
      cam.position.copy(cam0).add(V(-side * 0.6 * u, 0, -0.4 * u))
      cam.lookAt(side * 1.1 - side * 0.4 * u, 1.0, -0.5)
    })
    await this.wait(0.12)
    this.replaying = false
    this.trail.reset()
    root.position.copy(keep.pos)
    root.rotation.copy(keep.rot)
    this.ballPos.copy(keep.ball)
    this.ballSpin.quaternion.copy(keep.spin)
    this.ball.scale.setScalar(keep.scale)
    this.ball.visible = keep.vis
    this.markTo = keep.marks
    cues.replay?.(false)
    this.endCutaway(cues)
  }

  /** a save: held, pushed wide or tipped over; the keeper celebrates, the striker holds his head */
  private async saveFinish(shot: Shot, plan: ReturnType<PenaltyScene['planFlight']>, tell: () => void, cues: ShotCues) {
    const k = this.keeper
    const s = this.striker
    const sup = this.speed === 2
    const v = bezD(SPOT, plan.ctrl, plan.end, 1, V()).divideScalar(plan.dur)
    this.sound.glove(shot.save === 'catch')
    this.shake = 0.4
    const at = this.ballPos.clone()
    const glow = new THREE.Color(2.2, 2.2, 2.4)
    for (let i = 0; i < 14; i++) this.sparks.emit(at.x, at.y, at.z, rnd(-1.8, 1.8), rnd(-1, 2.2), rnd(0, 2), glow, rnd(0.18, 0.34), rnd(0.15, 0.32), -2, 3)
    this.ringFlash(at, false)
    if (!sup && !this.rushing) this.freeze = this.hurried ? 0.04 : 0.1
    const holding = shot.save === 'catch'
    if (holding) {
      this.ballMode = 'held'
    } else {
      this.ballMode = 'free'
      const side = Math.sign(at.x) || (shot.flavour < 0.5 ? -1 : 1)
      this.free = shot.save === 'tip' ? { v: V(side * 1.2, 5.6, -3.6), inGoal: false, roofHit: false } : { v: V(side * (3.2 + Math.abs(at.x) * 0.6), 1.2 + Math.random(), 4.8 + v.z * -0.05), inGoal: false, roofHit: true }
    }
    this.recording = null
    cues.moment?.(shot.save)
    if (shot.save === 'tip') this.sound.ooh()
    tell()
    this.celebrateSave()
    // in on the keeper's moment
    if (!sup) {
      this.focusTo.copy(LOOK).lerp(V(at.x, Math.max(0.6, at.y), 0), 0.55)
      this.zoomTo = this.narrow ? 1.15 : 1.3
    }
    s.rig.setExpr('sad')
    s.play((t) => this.strikerDejected(t), this.time, 0.35)
    await this.keeperLand(plan.dive, holding)
    // up he gets, and lets everyone know
    k.rig.setExpr(holding ? 'joy' : 'taunt')
    const from = k.rig.root.position.clone()
    const start = { ...k.last }
    k.play((t) => mixPose(start, holding ? with_(STAND, { lsx: -1.1, rsx: -1.1, le: -1.4, re: -1.4, lsz: 0.2, rsz: -0.2 }) : STAND, smooth(clamp01(t / 0.45))), this.time, 0.01)
    await this.tween(sup ? 0.25 : 0.45, (u) => {
      k.rig.root.position.y = lerp(from.y, 0, smooth(u))
    })
    if (!sup && !this.hurried && !this.rushing) await this.keeperCloseUp(holding, cues)
    this.focusTo.copy(LOOK)
    this.zoomTo = 1
    k.rig.setExpr(holding ? 'joy' : 'taunt')
    k.play((t) => this.keeperCelebrate(t, holding ? 0 : 1), this.time, 0.2)
    if (sup || this.hurried) this.sound.keeperCheer()
    this.showRead(shot)
    await this.wait(sup ? 0.25 : 0.7)
  }

  /** a cut to the keeper, full of himself: the ball held up and a roar, or a fist pump and a finger wagged at us */
  private async keeperCloseUp(holding: boolean, cues: ShotCues) {
    const k = this.keeper
    const root = k.rig.root
    const kx = root.position.x
    const side = kx > 0.3 ? -1 : kx < -0.3 ? 1 : Math.random() < 0.5 ? -1 : 1
    const sc = k.rig.scale
    const cam = this.closeCam
    // a little below his eyes, far enough back for the raised gloves: his face sits just under the headline
    cam.fov = this.narrow ? 34 : 30
    const p0 = V(kx + side * 1.35 * sc, 1.42 * sc, KEEPER_Z + 4.7 * sc)
    const p1 = V(kx + side * 1.05 * sc, 1.48 * sc, KEEPER_Z + 4.05 * sc)
    cam.position.copy(p0)
    cam.lookAt(kx, 1.5 * sc, KEEPER_Z)
    cam.updateProjectionMatrix()
    const yaw = Math.atan2(p1.x - kx, p1.z - KEEPER_Z)
    this.cutTo(cues)
    k.rig.setExpr(holding ? 'joy' : 'taunt')
    k.play((t) => this.keeperCelebrate(t, holding ? 0 : 2), this.time, 0.12)
    this.sound.keeperCheer()
    const dur = this.speed === 1 ? 0.75 : 1.2
    await this.tween(dur, (u) => {
      root.rotation.y = lerp(0, yaw, smooth(Math.min(1, u * 4)))
      cam.position.lerpVectors(p0, p1, smooth(u))
      cam.lookAt(kx, 1.5 * sc + 0.03 * u, KEEPER_Z)
    }, () => this.hurried || this.rushing)
    this.endCutaway(cues)
  }

  /** 0 roar holding the ball, 1 fist pumps, 2 a fist pump then a finger wagged at the camera */
  private keeperCelebrate(t: number, kind: number): Pose {
    if (kind === 0) {
      // the ball held up over his head in both gloves, bouncing
      const b = Math.abs(Math.sin(t * 6))
      return pose({ y: 0.08 * b, sx: -0.12, nx: -0.3, lsx: -2.9, rsx: -2.9, lsz: 0.18, rsz: -0.18, le: -0.35, re: -0.35, lk: 0.2 - 0.15 * b, rk: 0.2 - 0.15 * b, lhz: 0.12, rhz: -0.12 })
    }
    if (kind === 2 && t > 0.5) {
      // "not in my goal": the finger wagged, a lean towards us and a shake of the head
      const wag = Math.sin((t - 0.5) * 12) * 0.38
      return pose({ y: -0.04, sx: 0.12, nx: -0.05, ny: wag * 0.25, nz: -wag * 0.2, rsx: -1.6, rsz: -0.15, rsy: wag, re: -1.25, lsz: 0.6, lsx: 0.3, le: -1.9, lhz: 0.14, rhz: -0.14, lk: 0.18, rk: 0.18 })
    }
    const pump = Math.max(0, Math.sin(t * 8))
    return pose({ y: 0.05 * pump, sx: 0.12 - 0.1 * pump, nx: -0.2, rsx: -0.4 - 1.9 * pump, rsz: -0.3, re: -1.9 + 1.2 * pump, lsz: 0.4, lsx: 0.2, le: -1.6, lhz: 0.14, rhz: -0.14, lk: 0.25, rk: 0.25 })
  }

  private strikerDejected(t: number): Pose {
    const sway = Math.sin(t * 1.4) * 0.05
    return pose({ y: -0.03, sx: 0.28, nx: 0.32, rz: sway, lsx: -2.35, rsx: -2.35, lsz: 0.85, rsz: -0.85, le: -2.05, re: -2.05, lhz: 0.06, rhz: -0.06, lk: 0.12, rk: 0.12 })
  }

  /** a team-mate (or the striker) bouncing with joy, arms up */
  private jumpPose(t: number, i: number): Pose {
    const ph = t * (6.6 + i * 0.7) + i * 1.3
    const j = Math.abs(Math.sin(ph))
    const w = Math.sin(ph * 2)
    return pose({ y: 0.3 * j - 0.06, sx: -0.12, nx: -0.32, rz: 0.06 * w, lsx: -2.75 + 0.25 * w, rsx: -2.75 - 0.25 * w, lsz: 0.4, rsz: -0.4, le: -0.25, re: -0.25, lk: 0.85 * (1 - j), rk: 0.85 * (1 - j), lhx: -0.55 * (1 - j), rhx: -0.55 * (1 - j), la: 0.3 * j, ra: 0.3 * j })
  }

  /** the striker turns to the crowd behind the camera and celebrates: 0 the aeroplane, 1 fist pump, 2 knee slide */
  private async strikerCelebrate(kind: number, short = false) {
    const s = this.striker
    const root = s.rig.root
    const yaw0 = root.rotation.y
    const toward = near(0.15 * (Math.random() - 0.5), yaw0)
    const from = root.position.clone()
    this.sound.cheer(kind === 2 ? 1 : 0.8)
    if (kind === 1) {
      // a jump and a fist pump, facing us
      s.play((t) => {
        const j = Math.max(0, Math.sin(Math.min(1, t / 0.5) * Math.PI))
        const pump = t > 0.5 ? Math.max(0, Math.sin((t - 0.5) * 9)) : 0
        return pose({ y: 0.35 * j, sx: -0.1, nx: -0.25, lhx: -0.6 * j, lk: 1.2 * j, rhx: 0.2 * j, rk: 0.8 * j, rsx: -0.3, rsz: -2.6 + 0.3 * pump, re: -0.3 - 1.2 * pump, lsz: 0.6, lsx: 0.4, le: -1.5 })
      }, this.time, 0.15)
      await this.tween(short ? 0.2 : 0.35, (u) => (root.rotation.y = lerp(yaw0, toward, smooth(u))))
      await this.wait(short ? 0.45 : 0.95)
      return
    }
    if (kind === 2) {
      // runs at us and drops into a knee slide, arms out wide
      s.play((t) => with_(runPose(t * TAU * 1.9, 1), { lsz: 0.8, rsz: -0.8 }), this.time, 0.15)
      await this.tween(0.3, (u) => (root.rotation.y = lerp(yaw0, toward, smooth(u))))
      const p0 = root.position.clone()
      const side = p0.x < 0 ? 1 : -1
      const p1 = p0.clone().add(V(side * 0.7, 0, 0.45))
      await this.tween(0.32, (u) => root.position.lerpVectors(p0, p1, u))
      s.play(() => pose({ y: -0.46, sx: -0.38, nx: -0.4, lhx: 0.15, rhx: 0.15, lhz: 0.1, rhz: -0.1, lk: 1.6, rk: 1.6, la: 0.8, ra: 0.8, lsz: 2.3, rsz: -2.3, lsx: 0.2, rsx: 0.2, le: -0.2, re: -0.2 }), this.time, 0.15)
      const p2 = p1.clone().add(V(side * 0.75, 0, 0.35))
      this.sound.slide()
      await this.tween(0.55, (u) => {
        root.position.lerpVectors(p1, p2, easeOut(u))
        if (u < 0.6 && Math.random() < 0.5) this.puffGrass(root.position, 1)
      })
      await this.wait(0.7)
      return
    }
    // the aeroplane: arms out, banking left and right as he runs at us
    s.play((t) => with_(runPose(t * TAU * 1.8, 0.85), { lsz: 1.35, rsz: -1.35, lsx: -0.75 * Math.sin(t * TAU * 1.8), rsx: 0.75 * Math.sin(t * TAU * 1.8), le: 1.2, re: 1.2, rz: 0.28 * Math.sin(t * 3.2), sx: -0.05 }), this.time, 0.15)
    await this.tween(0.3, (u) => (root.rotation.y = lerp(yaw0, toward, smooth(u))))
    const p0 = root.position.clone()
    const dir = from.x < 0 ? 1 : -1
    const p1 = p0.clone().add(V(dir * 1.1, 0, 0.9))
    await this.tween(1.25, (u) => {
      root.position.lerpVectors(p0, p1, smooth(u))
      root.position.x += Math.sin(u * Math.PI * 2) * 0.25
      root.rotation.y = toward + Math.sin(u * Math.PI * 2) * 0.3
    })
  }

  /**
   * A Perfect 10: the team-mates come running and pile in, ticker tape, fireworks, and the camera circles the lot.
   * A tap (hurry) cuts straight back.
   */
  private async perfect(cues: ShotCues) {
    const s = this.striker
    const c = s.rig.root.position.clone().setY(0)
    this.party = true
    if (!this.mates.length) this.buildMates()
    const homes = [V(-1.05, 0, 0.55), V(1.0, 0, 0.45), V(0.15, 0, -0.95)]
    const starts = [V(-7.5, 0, 3.5), V(7.5, 0, 2.5), V(-3, 0, -7)]
    this.mates.forEach((m, i) => {
      const r = m.rig.root
      const from = c.clone().add(starts[i])
      const to = c.clone().add(homes[i])
      r.position.copy(from)
      r.rotation.set(0, Math.atan2(to.x - from.x, to.z - from.z), 0)
      r.visible = true
      m.rig.setExpr('joy')
      m.play((t) => with_(runPose(t * TAU * 2.1, 1), { lsz: 0.6, rsz: -0.6 }), this.time, 0.01)
      void this.tween(0.9 + i * 0.18, (u) => r.position.lerpVectors(from, to, smooth(u))).then(() => {
        r.rotation.y = Math.atan2(c.x - to.x + 0.0001, c.z - to.z)
        m.play((t) => this.jumpPose(t, i), this.time, 0.15)
      })
    })
    s.rig.setExpr('joy')
    s.play((t) => this.jumpPose(t, 3), this.time, 0.3)
    const sr = s.rig.root
    const y0 = sr.rotation.y
    void this.tween(0.3, (u) => (sr.rotation.y = lerp(y0, near(0, y0), u)))
    this.setBoards('perfect', 8)
    this.wave = 0
    this.waveDir = 1
    for (let i = 0; i < 6; i++) void this.wait(0.3 + i * 0.55).then(() => this.party && this.confettiBurst(150, i % 2 === 0))
    for (let i = 0; i < 8; i++) void this.wait(0.2 + i * 0.45).then(() => this.party && this.firework(V(rnd(-10, 10), rnd(4.4, 5.9), rnd(-8.5, -6)), ['#ffd23f', '#ffffff', '#ff4fd8', '#5cc8ff'][i % 4]))
    // the camera circles them, in front, from low to a little higher
    // the camera circles them from in front, rising as it goes; the pile-up sits in the lower half of the picture,
    // under the Perfect 10 card
    const cam = this.closeCam
    cam.fov = this.narrow ? 44 : 34
    cam.updateProjectionMatrix()
    const R = this.narrow ? 8.6 : 7.4
    this.cutTo(cues)
    // a tap since the goal went in means "skip the party"; one from before it only hurried the shot along
    if (this.hurriedAt < this.resultAt) this.hurried = false
    await this.tween(4.4, (u) => {
      const a = lerp(-0.95, 0.95, smooth(u))
      cam.position.set(c.x + Math.sin(a) * R, lerp(1.5, 2.7, u), c.z + Math.cos(a) * R)
      cam.lookAt(c.x, this.narrow ? 1.75 : 1.6, c.z)
    }, () => this.hurried || this.rushing)
    this.endCutaway(cues)
    for (const m of this.mates) m.rig.root.visible = false
    this.party = false
  }

  private celebrateGoal(goals: number) {
    this.cheer = 1.4
    this.flash = 1
    this.shake = Math.max(this.shake, 0.4)
    this.setBoards(goals >= 10 ? 'perfect' : 'goal', goals >= 10 ? 6 : 3)
    this.confettiBurst(goals >= 10 ? 380 : 140 + goals * 12, goals >= 10)
    this.cameraFlash(30)
    this.sound.roar(Math.min(1, 0.6 + goals * 0.05))
    this.sound.goal(goals)
    for (let i = 0; i < 4; i++) void this.wait(0.15 + i * 0.12).then(() => this.cameraFlash(20))
    if (goals >= 5) {
      // fireworks over the stand for a long run
      const n = goals >= 10 ? 6 : goals >= 8 ? 4 : goals >= 6 ? 2 : 1
      const cols = ['#ffd23f', '#ff4fd8', '#5cc8ff', '#2ef08c', '#ff7a3d']
      for (let i = 0; i < n; i++) void this.wait(0.2 + i * 0.32).then(() => this.firework(V(rnd(-10, 10), rnd(4.4, 5.9), rnd(-8.5, -6)), cols[i % cols.length]))
    }
  }

  private celebrateSave() {
    this.groan = 1.3
    this.setBoards('saved', 2.6)
    this.sound.groan()
  }

  /** a cash-out: the crowd cheers and the flashes go (more for more) */
  cashout(mult: number) {
    this.cheer = Math.max(this.cheer, 0.7 + Math.min(0.6, mult / 40))
    this.cameraFlash(24)
    if (mult >= 10) this.confettiBurst(mult >= 100 ? 260 : 140, true)
    if (mult >= 100) for (let i = 0; i < 4; i++) void this.wait(0.15 + i * 0.4).then(() => this.firework(V(rnd(-10, 10), rnd(4.4, 5.9), rnd(-8.5, -6)), ['#ffd23f', '#ffffff'][i % 2]))
  }

  /** the keeper's read: a glove on each zone he covered, the ball (ringed) on the zone you hit */
  private showRead(shot: Shot) {
    const tex = this.gloveTex.get(this.diff) ?? null
    for (let i = 0; i < 6; i++) {
      const m = this.marks[i]
      const mat = m.material as THREE.SpriteMaterial
      const c = zoneCenter(i as Zone)
      m.userData.on = shot.read.includes(i as Zone)
      m.userData.size = 0.98
      mat.map = tex
      mat.needsUpdate = true
      // where the ball went too, the glove steps aside for it
      m.position.set(c.x - (i === shot.zone ? 0.42 : 0), c.y, 0.6)
    }
    const b = this.marks[6]
    const c = zoneCenter(shot.zone)
    const bm = b.material as THREE.SpriteMaterial
    b.userData.on = true
    b.userData.size = 0.82
    b.position.set(c.x + (shot.read.includes(shot.zone) ? 0.42 : 0), c.y, 0.62)
    bm.map = shot.goal ? this.ballIcon : this.ballSaved
    bm.needsUpdate = true
    this.markTo = 1
    this.markAlpha = Math.min(this.markAlpha, 0.01)
    this.onRead?.(shot)
  }

  /** the read markers came up (for the screen's caption) */
  onRead?: (shot: Shot) => void

  /** hides the read (the next aim clears it) */
  clearRead() {
    this.markTo = 0
  }

  /** both players and the ball back in place */
  private async resetForNext(scored: boolean) {
    const s = this.striker
    const k = this.keeper
    const root = s.rig.root
    const sup = this.speed === 2
    // the striker jogs back to the top of his run while the keeper picks himself up and gets back on his line
    const striker = (async () => {
      const back = RUN_START.clone()
      const from = root.position.clone()
      const yawBack = near(Math.atan2(back.x - from.x, back.z - from.z), root.rotation.y)
      const dist = from.distanceTo(back)
      s.rig.setExpr(scored ? 'cheer' : 'sad')
      if (dist > 0.3) {
        s.play((t) => runPose(t * TAU * 1.6, 0.5), this.time, 0.2)
        const y0 = root.rotation.y
        await this.tween(sup ? 0.3 : Math.min(0.75, 0.3 + dist * 0.1), (u) => {
          root.position.lerpVectors(from, back, smooth(u))
          root.rotation.y = lerp(y0, yawBack, smooth(Math.min(1, u * 3)))
        })
      }
      const yaw = near(this.faceBall(back), root.rotation.y)
      const y1 = root.rotation.y
      s.play((t) => this.strikerIdle(t), this.time, 0.25)
      void this.tween(0.3, (u) => (root.rotation.y = lerp(y1, yaw, smooth(u))))
      s.rig.setExpr('focus')
    })()
    const kFrom = k.rig.root.position.clone()
    const kStart = { ...k.last }
    k.rig.setExpr('smug')
    const kr = k.rig.root
    const r0 = kr.rotation.clone()
    k.play((t) => mixPose(kStart, READY, smooth(clamp01(t / 0.4))), this.time, 0.01)
    // the ball is placed back on the spot
    this.ballMode = 'hidden'
    this.free = null
    this.trail.reset()
    await this.tween(sup ? 0.25 : 0.45, (u) => {
      kr.position.x = lerp(kFrom.x, 0, smooth(u))
      kr.position.y = lerp(kFrom.y, 0, smooth(u))
      kr.position.z = KEEPER_Z
      kr.rotation.set(lerp(r0.x, 0, u), lerp(r0.y, 0, u), lerp(r0.z, 0, u))
    })
    this.keeperX = 0
    this.keeperXTo = 0
    k.play((t) => this.keeperIdle(t), this.time, 0.2)
    this.idleKeeper = true
    this.nextTaunt = this.clock + 2.5 + Math.random() * 3
    this.ballPos.copy(SPOT)
    this.ballSpin.rotation.set(0, 0, 0)
    this.ballMode = 'spot'
    this.ball.scale.setScalar(0.01)
    this.sound.place()
    await this.tween(sup ? 0.14 : 0.26, (u) => this.ball.scale.setScalar(Math.max(0.01, easeOut(u) * (1 + 0.2 * Math.sin(u * Math.PI)))))
    this.ball.scale.setScalar(1)
    await striker
    this.gridTo = 1
    this.zoomTo = 1
    this.emitZones()
    // the read stays up a little longer, then makes way
    const shown = this.markTo
    if (shown) void this.wait(sup ? 0.6 : 1.4).then(() => !this.busy && (this.markTo = 0))
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.stopAmbience?.()
    const cv = this.renderer.domElement
    this.stageEl.removeEventListener('pointermove', this.onMove)
    this.stageEl.removeEventListener('pointerdown', this.onMove)
    this.stageEl.removeEventListener('pointerleave', this.onLeave)
    this.chant?.stop()
    this.chant = null
    // let anything awaiting the scene finish, so the screen code can unwind
    const left = this.tweens
    this.tweens = []
    for (const t of left) t.done()
    for (const o of this.own) o.dispose()
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
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

/**
 * A rig's shape as it is posed now: x, y, z of every third vertex of its visible meshes (world space, so with the root
 * at the origin, relative to the hips).
 */
function silhouette(r: Rig) {
  const pts: number[] = []
  const v = V()
  for (const { mesh, local } of hullOf(r)) {
    let shown = true
    for (let o: THREE.Object3D | null = mesh; o && o !== r.root; o = o.parent) if (!o.visible) shown = false
    if (!shown) continue
    for (let i = 0; i < local.length; i += 3) {
      v.set(local[i], local[i + 1], local[i + 2]).applyMatrix4(mesh.matrixWorld)
      pts.push(v.x, v.y, v.z)
    }
  }
  return pts
}

/** each rig's meshes thinned to one vertex per 4 cm cell (in each mesh's own space), worked out once per rig */
const hulls = new WeakMap<Rig, { mesh: THREE.Mesh; local: Float32Array }[]>()
function hullOf(r: Rig) {
  let h = hulls.get(r)
  if (h) return h
  const CELL = 0.04
  const v = V()
  const w = V()
  r.root.updateMatrixWorld(true)
  const toRig = r.root.matrixWorld.clone().invert()
  const rel = new THREE.Matrix4()
  h = r.meshes.map((mesh) => {
    const pos = mesh.geometry.attributes.position
    const seen = new Set<number>()
    const out: number[] = []
    // cells measured in the rig's own space, whatever his root is doing (as he is posed now: every part is rigid, so
    // any pose thins it the same)
    rel.multiplyMatrices(toRig, mesh.matrixWorld)
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i)
      w.copy(v).applyMatrix4(rel)
      const key = (Math.round(w.x / CELL) + 512) * 1048576 + (Math.round(w.y / CELL) + 512) * 1024 + (Math.round(w.z / CELL) + 512)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(v.x, v.y, v.z)
    }
    return { mesh, local: new Float32Array(out) }
  })
  hulls.set(r, h)
  return h
}

/**
 * One moment of the ball going past a diving keeper: the ball, his shape then (silhouette(), relative to his hips),
 * how far his hips have got from where he stood to where they are headed (e, 0 to 1; x0 = where he stood × (1 - e)) and
 * how high they are then.
 */
interface Passing {
  pts: number[]
  ball: THREE.Vector3
  e: number
  x0: number
  y: number
}

/**
 * Where the hips should be headed (x along the line) so that a keeper of this shape misses the ball (as big as it is
 * drawn in flight) by a clear gap at every moment of `passing`, as the camera sees it (depth cannot be seen there, so
 * a ball passing in front of or behind any part of him reads as a touch: he is measured as he looks from the camera,
 * projected on to the ball's depth, which keeps him clear of it in 3D too): `target` if he already does, else the nearest clear spot
 * on the `away` side (the way he is diving), or on the other side if that would take him past the post. At a moment
 * with progress e his hips are at x0 + e·X for a target X (his height and depth do not depend on X), so each point of
 * him rules out a stretch of targets.
 */
function clearX(passing: Passing[], target: number, away: number, cam: THREE.Vector3) {
  const need = BALL_SEEN + 0.06
  const bad: [number, number][] = []
  for (const m of passing) {
    const b = m.ball
    const pts = m.pts
    for (let i = 0; i < pts.length; i += 3) {
      const px = pts[i]
      const py = pts[i + 1] + m.y
      const pz = pts[i + 2] + KEEPER_Z
      // the point as the camera sees it, slid along its line of sight to the ball's depth: p' = cam + (p - cam)·t
      const t = (b.z - cam.z) / (pz - cam.z)
      const dy = cam.y + (py - cam.y) * t - b.y
      if (Math.abs(dy) >= need) continue
      const w = Math.sqrt(need * need - dy * dy)
      // p'x = cam.x + (hipX + px - cam.x)·t lies within w of the ball while hipX is in this stretch
      const s0 = (b.x - w - cam.x) / t + cam.x - px
      const s1 = (b.x + w - cam.x) / t + cam.x - px
      bad.push([(s0 - m.x0) / m.e, (s1 - m.x0) / m.e])
    }
  }
  // the blocked stretch around target: grown by every stretch that overlaps it until nothing more does
  let lo = target
  let hi = target
  for (let grew = true; grew; ) {
    grew = false
    for (const [a, b] of bad) {
      if (a >= hi || b <= lo) continue
      if (a < lo) (lo = a), (grew = true)
      if (b > hi) (hi = b), (grew = true)
    }
  }
  if (lo === target && hi === target) return target
  const lim = GOAL.hw + 0.3
  const toward = away < 0 ? lo - 0.01 : hi + 0.01
  const back = away < 0 ? hi + 0.01 : lo - 0.01
  return Math.abs(toward) <= lim ? toward : Math.abs(back) <= lim ? back : target
}

/** a point on the quadratic Bézier a-c-b at t */
function bez(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t
  return out.set(u * u * a.x + 2 * u * t * c.x + t * t * b.x, u * u * a.y + 2 * u * t * c.y + t * t * b.y, u * u * a.z + 2 * u * t * c.z + t * t * b.z)
}
/** its derivative with respect to t */
function bezD(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, t: number, out: THREE.Vector3) {
  const u = 1 - t
  return out.set(2 * u * (c.x - a.x) + 2 * t * (b.x - c.x), 2 * u * (c.y - a.y) + 2 * t * (b.y - c.y), 2 * u * (c.z - a.z) + 2 * t * (b.z - c.z))
}

export type { Expr }
