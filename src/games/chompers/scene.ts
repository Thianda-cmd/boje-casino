import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, glowTexture, ring, ringTexture, rnd } from '../../lib/three/fx'
import { COLS, ROWS, fillerSym, type Cell, type Grid, type Sym } from './rules'
import { SYMBOL_COLOR, donutColor } from './meta'
import { MAMA, allMaterials, buildMama, buildSymbol, castMaterial, feastTexture, labelMesh, labelTexture, stampTexture, symbolMaterials, warmUp, type FeastKind, type MamaRig } from './models'

export type { FeastKind } from './models'

/*
  The Chompers stage: five reels on a drum behind a cartoon frame dripping with slime, under a night sky (a sunset
  in free spins), and Big Mama Chomp, a huge furry monster peering over the top of the machine with her hands on its
  corners. Reels spin, slow down and settle with a little bounce; anticipation reels glow and hold on while Mama
  gasps. Winners hop forward while the rest dim, wilds open wide and chomp the donuts (Mama chomps along), eggs hatch
  into free spins, and three big eggs rise for the Feast Pick.
  Everything runs on the scene clock, so turbo and "hurry" speed the whole show up.
*/

/** Big Mama's gestures; fire and forget. 'cover' holds until the reels next come to rest. */
export type HostAction = 'lick' | 'gasp' | 'wow' | 'cheer' | 'clap' | 'chomp' | 'cover' | 'yawn' | 'dance' | 'laugh'

const SX = 1.1
const SY = 1
const HALF_W = (COLS * SX) / 2
/** the reels sit on a drum: rows further from the middle curve away from the camera */
const DRUM = 3.4
const uY = (u: number) => DRUM * Math.sin((u * SY) / DRUM)
const uZ = (u: number) => DRUM * (Math.cos((u * SY) / DRUM) - 1)
const WIN_H = uY(ROWS / 2)
const IN_W = HALF_W + 0.1
const IN_H = WIN_H + 0.04
const RIM = 0.26
const FRAME_BACK = -0.75
const FRAME_FRONT = 0.42
/** the frame's top edge, where Big Mama's chin rests */
const TOP = IN_H + RIM
const MAMA_Z = -1.3
/** the composition: the frame, Mama above it (hat included) and room for the counters under it */
const FIT_W = 7.25
const FIT_H = 7.45
const CAM_Y = 0.8
const FOV = 30
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), IN_H - 0.01), new THREE.Plane(new THREE.Vector3(0, 1, 0), IN_H - 0.01)]
/** the cast is modelled for a 0.9 cell; on the reels it stands a little bigger */
const CAST = 1.13

export const cellX = (c: number) => (c - (COLS - 1) / 2) * SX
/** row r (0 at the top) as an offset from the middle, in rows */
const rowU = (r: number) => (ROWS - 1) / 2 - r

const KICK = 0.13
const SPEED = 27
const BACK = 0.9
const easeOutBack = (t: number) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2
const smooth = (t: number) => t * t * (3 - 2 * t)
/** 0 → 1 → 0 over u in [0, 1], easing in over `a` and out over `r` */
const env = (u: number, a = 0.2, r = 0.25) => (u <= 0 || u >= 1 ? 0 : smooth(Math.min(1, u / a, (1 - u) / r)))
const TAU = Math.PI * 2
const Y = new THREE.Vector3(0, 1, 0)
/** the stage's night and sunset (free spins) tints, blended every frame without allocating */
const TINT = {
  lip: new THREE.Color('#ff7ad1'),
  lipFree: new THREE.Color('#ffcf3a'),
  frame: new THREE.Color('#7d45e8'),
  frameFree: new THREE.Color('#e8457d'),
  ambient: new THREE.Color('#b9a8ff'),
  ambientFree: new THREE.Color('#ffc2a8'),
  key: new THREE.Color('#ffffff'),
  keyFree: new THREE.Color('#ffe2c8'),
  bed: new THREE.Color('#ffffff'),
  bedFree: new THREE.Color('#ffd6e6'),
  segDark: new THREE.Color('#0b4d28'),
  segLit: new THREE.Color('#d8ff4f'),
}
const _v = new THREE.Vector3()
const _v2 = new THREE.Vector2()
const _c = new THREE.Color()
/** coins keep the colour they are given (Bits stores it): one shared white */
const WHITE = new THREE.Color(1, 1, 1)

interface Piece {
  key: string
  sym: Sym
  value: number
  id: number
  root: THREE.Group
  inner: THREE.Group
  model: THREE.Group
  eyes: THREE.Object3D[]
  pupils: THREE.Object3D[]
  look: number
  mouth: THREE.Object3D | null
  joy: THREE.Object3D | null
  wings: THREE.Object3D[]
  stalks: THREE.Object3D | null
  crown: THREE.Object3D | null
  halo: THREE.Sprite | null
  cherry: THREE.Object3D | null
  swirl: THREE.Object3D | null
  wraps: THREE.Object3D[]
  label: THREE.Mesh | null
  glow: THREE.Sprite
  col: number
  k: number
  u: number
  phase: number
  blinkAt: number
  blink: number
  win: number
  winTo: number
  open: number
  openTo: number
  chompT: number
  shake: number
  pop: number
  fall: { y: number; vy: number; bounces: number } | null
  dying: number
  /** a wild's bites this collect (its belly grows), the bounce of the last one, and a donut's squish as it is eaten */
  bites: number
  gulp: number
  squish: number
}

interface Reel {
  col: number
  pos: number
  v: number
  state: 'idle' | 'kick' | 'spin' | 'stop'
  t: number
  from: number
  to: number
  dur: number
  stopAt: number
  speed: number
  tease: boolean
  slots: Map<number, Piece>
  targets: Map<number, Cell>
  /** the cells this spin lands, top to bottom */
  land: Cell[]
  free: boolean
  done: (() => void) | null
}

interface Flight {
  from: THREE.Vector3
  ctrl: THREE.Vector3
  to: THREE.Vector3
  t: number
  dur: number
  obj: THREE.Object3D
  color: THREE.Color
  stamp: THREE.Sprite | null
  done: () => void
}

interface FeastEgg {
  obj: THREE.Group
  x: number
  /** 0 → 1 as it rises into place */
  k: number
  delay: number
  shake: number
  burst: number
  card: THREE.Sprite | null
  cardK: number
  dimmed: boolean
}

/* ------------------------------------------------------------------ */
/*  Backdrop: a cartoon night (sunset in free spins) over rolling hills */
/* ------------------------------------------------------------------ */

const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFree;
uniform float uAspect;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hill(float x, float base, float a1, float f1, float a2, float f2, float ph) {
  return base + a1 * sin(x * f1 + ph) + a2 * sin(x * f2 + ph * 1.7 + 1.3);
}
vec3 layer(vec3 col, vec2 p, float h, vec3 fill, vec3 rim) {
  float d = p.y - h;
  float inside = 1.0 - smoothstep(-0.002, 0.002, d);
  float edge = 1.0 - smoothstep(0.0, 0.006, abs(d + 0.004));
  col = mix(col, fill, inside);
  return mix(col, rim, edge * inside);
}
// a bat seen from below, flapping: q in units of its wingspan / 2
float bat(vec2 q, float flap) {
  float body = step(length(q * vec2(2.2, 1.3)), 0.42);
  float ears = step(abs(abs(q.x) - 0.11), 0.06 - (q.y - 0.3) * 0.5) * step(0.24, q.y) * step(q.y, 0.44);
  float ax = abs(q.x);
  float w = clamp((ax - 0.12) / 0.88, 0.0, 1.0);
  float top = 0.12 + flap * 0.55 * w - 0.12 * w * w;
  float low = top - 0.42 * (1.0 - w) - 0.05 + 0.14 * abs(sin(w * 9.4));
  float wing = step(0.12, ax) * step(ax, 1.0) * step(low, q.y) * step(q.y, top);
  return clamp(body + ears + wing, 0.0, 1.0);
}
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  float t = uTime;
  vec3 topN = vec3(0.09, 0.04, 0.24), midN = vec3(0.27, 0.11, 0.48), lowN = vec3(0.62, 0.26, 0.62);
  vec3 topF = vec3(0.24, 0.07, 0.34), midF = vec3(0.68, 0.24, 0.45), lowF = vec3(1.0, 0.56, 0.36);
  vec3 top = mix(topN, topF, uFree), mid = mix(midN, midF, uFree), low = mix(lowN, lowF, uFree);
  vec3 col = mix(low, mid, smoothstep(-0.25, 0.08, p.y));
  col = mix(col, top, smoothstep(0.05, 0.5, p.y));
  // stars: a fine field plus a few big four-point twinklers
  vec2 g = floor((p + 2.0) * 60.0);
  float s = hash(g);
  float tw = 0.5 + 0.5 * sin(t * (1.5 + s * 3.0) + s * 40.0);
  vec2 f = fract((p + 2.0) * 60.0) - 0.5;
  float sky = smoothstep(-0.12, 0.25, p.y) * (1.0 - uFree * 0.75);
  col += step(0.972, s) * tw * smoothstep(0.2, 0.0, length(f)) * sky * vec3(1.0, 0.95, 1.2);
  vec2 g2 = floor((p + 2.0) * 9.0);
  float s2 = hash(g2 + 7.0);
  vec2 f2 = fract((p + 2.0) * 9.0) - 0.5 - (vec2(hash(g2 + 1.3), hash(g2 + 2.9)) - 0.5) * 0.5;
  float tw2 = 0.55 + 0.45 * sin(t * (1.0 + s2 * 2.0) + s2 * 30.0);
  float cr = max(smoothstep(0.012, 0.0, abs(f2.x)) * smoothstep(0.22, 0.0, abs(f2.y)), smoothstep(0.012, 0.0, abs(f2.y)) * smoothstep(0.22, 0.0, abs(f2.x)));
  col += step(0.86, s2) * tw2 * (cr * 0.9 + smoothstep(0.08, 0.0, length(f2)) * 0.8) * sky * vec3(1.0, 0.92, 1.15);
  // a shooting star now and then
  float cyc = floor(t / 6.5);
  float st = fract(t / 6.5) * 6.5;
  if (st < 0.8 && uFree < 0.5) {
    vec2 s0 = vec2((hash(vec2(cyc, 1.0)) - 0.2) * uAspect * 0.9, 0.32 + hash(vec2(cyc, 2.0)) * 0.14);
    vec2 dir = normalize(vec2(-0.85, -0.42));
    vec2 head = s0 + dir * st * 0.55;
    vec2 d = p - head;
    float along = dot(d, -dir);
    float across = abs(dot(d, vec2(-dir.y, dir.x)));
    float tail = 0.2 * smoothstep(0.0, 0.25, st);
    float k = step(0.0, along) * smoothstep(tail, 0.0, along) * smoothstep(0.004, 0.0, across) * smoothstep(0.8, 0.5, st);
    col += vec3(1.0, 0.95, 1.1) * k * 1.4 + vec3(1.0) * smoothstep(0.012, 0.0, length(d)) * smoothstep(0.8, 0.5, st);
  }
  // moon up on the left, or a low sun in free spins
  vec2 mc = vec2(-0.3 * uAspect, 0.33 - uFree * 0.1);
  float md = length(p - mc);
  vec3 moon = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.82, 0.45), uFree);
  col += moon * 0.3 * exp(-md * md * 14.0);
  col = mix(col, moon, smoothstep(0.072, 0.069, md));
  col = mix(col, moon * 0.86, smoothstep(0.018, 0.015, length(p - mc - vec2(-0.02, 0.018))) * (1.0 - uFree));
  col = mix(col, moon * 0.88, smoothstep(0.012, 0.009, length(p - mc - vec2(0.025, -0.02))) * (1.0 - uFree));
  // bats crossing the moon
  vec3 batCol = mix(vec3(0.07, 0.03, 0.14), vec3(0.22, 0.06, 0.18), uFree);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float per = 11.0 + fi * 5.0;
    float u = fract(t / per + fi * 0.37) / 0.45;
    if (u < 1.0) {
      float dirX = mod(fi, 2.0) < 1.0 ? 1.0 : -1.0;
      vec2 c = mc + vec2(dirX * (u - 0.5) * 0.9 * uAspect * 0.55, -0.05 + 0.08 * fi + 0.06 * sin(u * 6.0 + fi) + 0.015 * sin(u * 40.0));
      float size = 0.026 - 0.005 * fi;
      vec2 q = (p - c) / size;
      q.x *= dirX;
      col = mix(col, batCol, bat(q, sin(t * (15.0 + fi * 3.0) + fi)));
    }
  }
  // clouds
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(mod(t * (0.012 + fi * 0.006) + fi * 0.9, 2.4 * uAspect) - 1.2 * uAspect, 0.18 + fi * 0.09);
    vec2 q = (p - c) * vec2(1.0, 2.6);
    float cl = smoothstep(0.1, 0.06, length(q)) + smoothstep(0.075, 0.04, length(q - vec2(0.07, 0.05))) + smoothstep(0.08, 0.05, length(q + vec2(0.08, -0.02)));
    col = mix(col, mix(vec3(0.42, 0.28, 0.66), vec3(1.0, 0.72, 0.68), uFree), clamp(cl, 0.0, 1.0) * 0.55);
  }
  // hills, back to front
  float x = p.x;
  col = layer(col, p, hill(x, -0.2, 0.05, 3.1, 0.025, 7.3, t * 0.02), mix(vec3(0.2, 0.09, 0.4), vec3(0.55, 0.2, 0.42), uFree), mix(vec3(0.38, 0.2, 0.62), vec3(0.85, 0.42, 0.5), uFree));
  col = layer(col, p, hill(x, -0.29, 0.045, 4.3, 0.02, 9.1, t * 0.035 + 2.0), mix(vec3(0.12, 0.06, 0.28), vec3(0.4, 0.13, 0.32), uFree), mix(vec3(0.3, 0.14, 0.5), vec3(0.7, 0.3, 0.42), uFree));
  // glowing mushrooms along the middle hill, swaying
  for (int i = 0; i < 6; i++) {
    // only out to the sides, where the frame does not hide them
    float fi = float(i);
    float side = i < 3 ? -1.0 : 1.0;
    float mx = side * (0.47 + mod(fi, 3.0) * 0.16) * uAspect + 0.04 * sin(fi * 2.3);
    float sz = 0.022 + 0.012 * hash(vec2(fi, 3.1));
    float my = hill(mx, -0.29, 0.045, 4.3, 0.02, 9.1, t * 0.035 + 2.0);
    vec2 q = p - vec2(mx, my);
    q.x -= 0.22 * sin(t * 1.3 + fi * 1.7) * max(q.y, 0.0);
    vec3 mcol = mod(fi, 3.0) < 1.0 ? vec3(0.35, 0.95, 1.0) : (mod(fi, 3.0) < 2.0 ? vec3(1.0, 0.45, 0.85) : vec3(0.55, 1.0, 0.5));
    float stem = step(abs(q.x), sz * 0.28) * step(-0.01, q.y) * step(q.y, sz * 1.5);
    vec2 cq = (q - vec2(0.0, sz * 1.5)) / vec2(sz * 1.15, sz * 0.8);
    float cap = step(length(cq), 1.0) * step(0.0, cq.y);
    float glow = exp(-dot(cq, cq) * 0.55) * (0.7 + 0.3 * sin(t * 2.0 + fi * 1.7));
    col += mcol * glow * 0.24;
    col = mix(col, mix(vec3(0.3, 0.2, 0.45), vec3(0.6, 0.35, 0.45), uFree), stem);
    col = mix(col, mcol * (0.7 + 0.35 * cq.y), cap);
    float spots = step(length(cq - vec2(-0.4, 0.4)), 0.17) + step(length(cq - vec2(0.3, 0.55)), 0.13) + step(length(cq - vec2(0.05, 0.2)), 0.1);
    col = mix(col, vec3(1.0, 0.97, 1.0), cap * min(1.0, spots) * 0.85);
  }
  col = layer(col, p, hill(x, -0.39, 0.04, 5.2, 0.018, 11.0, t * 0.05 + 4.0), mix(vec3(0.07, 0.03, 0.17), vec3(0.25, 0.07, 0.2), uFree), mix(vec3(0.2, 0.09, 0.36), vec3(0.5, 0.18, 0.3), uFree));
  col *= 1.0 - 0.35 * smoothstep(0.45, 1.0, length(p * vec2(0.7, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`

/** the reel bed: one column per reel, darker towards the top and bottom like a drum, each with a hint of its own colour */
function reelTexture() {
  const PX = 140
  const c = document.createElement('canvas')
  c.width = Math.round(IN_W * 2 * PX)
  c.height = Math.round(IN_H * 2 * PX)
  const g = c.getContext('2d')!
  g.fillStyle = '#170830'
  g.fillRect(0, 0, c.width, c.height)
  const tints = ['#ff5fa2', '#3db4ff', '#2ee87f', '#ffae2b', '#b06bff']
  for (let col = 0; col < COLS; col++) {
    const cx = (cellX(col) + IN_W) * PX
    const w = SX * PX - 10
    const grad = g.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, '#220f46')
    grad.addColorStop(0.5, '#47258c')
    grad.addColorStop(1, '#220f46')
    g.beginPath()
    g.roundRect(cx - w / 2, 6, w, c.height - 12, 18)
    g.fillStyle = grad
    g.fill()
    g.save()
    g.clip()
    // the reel's own tint, strongest in the middle
    const tg = g.createLinearGradient(0, 0, 0, c.height)
    tg.addColorStop(0, 'rgba(0,0,0,0)')
    tg.addColorStop(0.5, tints[col])
    tg.addColorStop(1, 'rgba(0,0,0,0)')
    g.globalAlpha = 0.09
    g.fillStyle = tg
    g.fillRect(cx - w / 2, 0, w, c.height)
    // monster spots
    g.globalAlpha = 0.06
    g.fillStyle = '#ffffff'
    for (let i = 0; i < 9; i++) {
      const x = cx - w / 2 + ((i * 37 + col * 53) % 100) / 100 * w
      const y = ((i * 71 + col * 29) % 100) / 100 * c.height
      g.beginPath()
      g.arc(x, y, 6 + ((i * 13) % 9), 0, Math.PI * 2)
      g.fill()
    }
    g.globalAlpha = 1
    // a soft highlight down the left side of the reel
    const hl = g.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0)
    hl.addColorStop(0, 'rgba(255,255,255,0.07)')
    hl.addColorStop(0.25, 'rgba(255,255,255,0)')
    hl.addColorStop(0.85, 'rgba(0,0,0,0)')
    hl.addColorStop(1, 'rgba(0,0,0,0.18)')
    g.fillStyle = hl
    g.fillRect(cx - w / 2, 0, w, c.height)
    g.restore()
    g.strokeStyle = 'rgba(255,255,255,0.07)'
    g.lineWidth = 3
    g.stroke()
  }
  // a soft vignette over the whole window
  const v = g.createRadialGradient(c.width / 2, c.height / 2, Math.min(c.width, c.height) * 0.3, c.width / 2, c.height / 2, Math.hypot(c.width, c.height) * 0.55)
  v.addColorStop(0, 'rgba(10,3,25,0)')
  v.addColorStop(1, 'rgba(10,3,25,0.6)')
  g.fillStyle = v
  g.fillRect(0, 0, c.width, c.height)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/* ------------------------------------------------------------------ */
/*  Big Mama's poses                                                    */
/* ------------------------------------------------------------------ */

const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
/** a hand pose for both sides, given for the left hand (the right one mirrors it) */
const pose2 = (p: [number, number, number], r: [number, number, number]) => ({
  p: [new THREE.Vector3(...p), new THREE.Vector3(-p[0], p[1], p[2])],
  q: [q(...r), q(r[0], -r[1], -r[2])],
})
/** hands on the frame's top corners, fingers over the front; the rest are placed by her face */
const GRIP = pose2([-2.96, 0.1, 1.72], [2.45, 0, 0.32])
const FY = MAMA.head.c[1] - 0.66
const CHEEK = pose2([-1.2, 0.6 + FY, 0.95], [0.15, 1.35, -0.2])
const EYES = pose2([-0.47, MAMA.eyeY - 0.02, 1.08], [0.05, Math.PI, 0.12])
const UP = pose2([-1.95, 1.3 + FY, 0.25], [0, 0, 0.55])
const CLAP_OPEN = pose2([-0.7, 0.26, 1.0], [0.2, Math.PI / 2, 0.15])
const CLAP_SHUT = pose2([-0.21, 0.26, 1.0], [0.2, Math.PI / 2, 0.15])
const MOUTH_R = { p: new THREE.Vector3(0.18, MAMA.mouthY - 0.26, 1.1), q: q(0.25, -Math.PI * 0.92, -0.35) }
const SHOULDER = [new THREE.Vector3(...MAMA.shoulder), new THREE.Vector3(-MAMA.shoulder[0], MAMA.shoulder[1], MAMA.shoulder[2])]
const ACT_DUR: Record<HostAction, number> = { lick: 1.4, gasp: 1.2, wow: 1.1, cheer: 1.7, clap: 1.5, chomp: 0.7, cover: 2.2, yawn: 2.2, dance: 3.2, laugh: 1.2 }
/** how far the lower fangs travel between a shut mouth and a wide open one */
const JAW = MAMA.jaw
const _dir = new THREE.Vector3()
/** stretches a unit limb along +y from a to b */
function limb(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3) {
  _dir.copy(b).sub(a)
  const len = Math.max(0.01, _dir.length())
  m.position.copy(a)
  m.quaternion.setFromUnitVectors(Y, _dir.divideScalar(len))
  m.scale.set(1, len, 1)
}

interface MamaPose {
  handP: THREE.Vector3[]
  handQ: THREE.Quaternion[]
  tilt: number
  nod: number
  lunge: number
  bob: number
  open: number
  narrow: number
  lid: number
  low: number
  wide: number
  brow: number
  browTilt: number
  tongue: number
  tongueX: number
}
/** the pose's numbers that ease towards their target each frame (the mouth has its own, faster rate) */
const EASED = ['tilt', 'nod', 'lunge', 'bob', 'narrow', 'lid', 'low', 'wide', 'brow', 'browTilt', 'tongue', 'tongueX'] as const
const mamaPose = (): MamaPose => ({
  handP: [GRIP.p[0].clone(), GRIP.p[1].clone()],
  handQ: [GRIP.q[0].clone(), GRIP.q[1].clone()],
  tilt: 0,
  nod: 0,
  lunge: 0,
  bob: 0,
  open: 0.16,
  narrow: 0,
  lid: -1.15,
  low: 1.2,
  wide: 1,
  brow: 0,
  browTilt: 0,
  tongue: 0,
  tongueX: 0,
})

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

const PREVIEW: Sym[] = ['grumbo', 'fang', 'blip', 'mimi', 'cupcake', 'lolly', 'cookie', 'gummy', 'candy', 'wild', 'egg', 'donut']
const FEAST_X = [-1.8, 0, 1.8]
const FEAST_Y = -0.12
const FEAST_Z = 1.0
const FEAST_S = 1.75
/** where Mama looks while the Feast eggs are up */
const FEAST_LOOK = new THREE.Vector3(0, FEAST_Y, 0)

export class ChompScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** a reel came to rest, showing these symbols top to bottom */
  onReelStop?: (col: number, syms: Sym[]) => void
  onCoin?: () => void
  /** what a donut worth `value` times the bet says on its label */
  donutText: (value: number) => string = (v) => `${v}×`
  /** paytable pictures of every symbol, and of Big Mama ('host') */
  thumbs: Partial<Record<Sym | 'host', string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private readonly key: THREE.DirectionalLight
  private readonly ambient: THREE.AmbientLight

  private readonly reels: Reel[] = []
  private readonly pool = new Map<string, Piece[]>()
  private live = new Set<Piece>()
  private byId = new Map<number, Piece>()
  private readonly sparks = new Sparks(1400)
  /** fireflies drifting over the hills; kept apart from the effect sparks so they never stop the idle frame rate dropping */
  private readonly flies = new Sparks(90)
  private readonly crumbs: Bits
  private readonly coins: Bits
  private readonly confetti: Bits
  private readonly ringPool: { s: THREE.Sprite; t: number; life: number; r0: number; r1: number }[] = []
  private flights: Flight[] = []
  private beams: { col: number; sprite: THREE.Sprite; on: number }[] = []
  /** scene-time timers: promises from wait(), and jobs from after(), which are dropped on dispose */
  private timers: { at: number; fn: () => void; job: boolean }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []
  private readonly stampMats = new Map<number, THREE.SpriteMaterial>()

  private readonly backMat: THREE.ShaderMaterial
  private readonly bedMat: THREE.MeshBasicMaterial
  private readonly dimMat: THREE.MeshBasicMaterial
  private readonly lip: THREE.MeshBasicMaterial
  private readonly frameMat: THREE.MeshToonMaterial
  private readonly slime: THREE.Group
  private readonly slimeMat: THREE.MeshToonMaterial
  private readonly flashMat: THREE.ShaderMaterial
  private readonly flashMesh: THREE.Mesh
  private flashA = 0

  // Big Mama
  private readonly mama: MamaRig
  private readonly mp = mamaPose()
  private readonly elbow = new THREE.Vector3()
  private readonly ms = mamaPose()
  private act: { kind: HostAction; t: number; dur: number } | null = null
  private coverHold = false
  private lookAt = new THREE.Vector2(0, -0.5)
  private watchAt: THREE.Vector3 | null = null
  private blink = 0
  private blinkAt = 2
  private dart = new THREE.Vector2()
  private dartAt = 0
  private teaseK = 0
  private teaseCol = -1
  private hatK = 0
  private hatTo = 0
  private droolT = -1
  private clapWas = 1
  private licked = false
  private dead = 0
  private spinWon = true
  private happy = 0
  /** when Mama next fidgets if nothing happens, and when one of the cast next does a little hop */
  private idleAt = 9
  private hopAt = 3

  // the slime meter on the band: glowing segments and the multiplier medallion
  private readonly meter: THREE.Group
  private readonly segs: { mesh: THREE.Mesh; ink: THREE.Mesh; mat: THREE.MeshBasicMaterial; k: number; to: number }[] = []
  private readonly medal: THREE.Group
  private readonly medalText: THREE.Mesh
  private meterOn = 0
  private meterTo = 0
  private meterMult = 0
  private medalPop = 0

  // the Feast Pick
  private feast: FeastEgg[] = []
  private feastOut = false

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private drewLast = false
  private dist = 14
  private camY = CAM_Y
  private raf = 0
  private last = 0
  private acc = 0
  private time = 0
  private clock = 0
  private base = 1
  private boost = 1
  private free = 0
  private freeTo = 0
  private dim = 0
  private dimTo = 0
  private shake = 0
  private shower = 0
  private coinAt = 0
  private pointer = new THREE.Vector2()
  private look = new THREE.Vector2()
  private disposed = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  constructor(private readonly el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.localClippingEnabled = true
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    this.key = new THREE.DirectionalLight('#ffffff', 2.2)
    this.key.position.set(-3, 5, 6)
    this.ambient = new THREE.AmbientLight('#b9a8ff', 0.95)
    this.scene.add(this.key, this.ambient)

    // sky
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFree: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    const quad = new THREE.PlaneGeometry(2, 2)
    const back = new THREE.Mesh(quad, this.backMat)
    back.frustumCulled = false
    back.renderOrder = -10
    this.scene.add(back)
    this.own.push(quad, this.backMat)

    // reel bed
    const bedTex = reelTexture()
    this.bedMat = new THREE.MeshBasicMaterial({ map: bedTex })
    const bedGeo = new THREE.PlaneGeometry(IN_W * 2, IN_H * 2)
    const bed = new THREE.Mesh(bedGeo, this.bedMat)
    bed.position.z = FRAME_BACK + 0.02
    this.scene.add(bed)
    this.own.push(bedTex, this.bedMat, bedGeo)

    // shade at the top and bottom of the window (the drum turning away), and the dimmer used for wins
    const shadeGeo = new THREE.PlaneGeometry(IN_W * 2, IN_H * 2)
    const shadeMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; void main() { float e = abs(vUv.y - 0.5) * 2.0; gl_FragColor = vec4(0.06, 0.02, 0.14, smoothstep(0.62, 1.0, e) * 0.72); }',
      transparent: true,
      depthWrite: false,
    })
    const shadeMesh = new THREE.Mesh(shadeGeo, shadeMat)
    shadeMesh.position.z = 0.4
    shadeMesh.renderOrder = 2
    this.dimMat = new THREE.MeshBasicMaterial({ color: '#0b0420', transparent: true, opacity: 0, depthWrite: false })
    const dimMesh = new THREE.Mesh(shadeGeo, this.dimMat)
    dimMesh.position.z = 0.44
    dimMesh.renderOrder = 2
    this.scene.add(shadeMesh, dimMesh)
    this.own.push(shadeGeo, shadeMat, this.dimMat)

    // frame: a chunky purple toon frame with a dark outline
    const BEVEL = 0.09
    const frameGeo = new THREE.ExtrudeGeometry(ring(IN_W + RIM, IN_H + RIM, 0.42, IN_W + 0.02, IN_H + 0.02, 0.24), {
      depth: FRAME_FRONT - FRAME_BACK - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: 0.08,
      bevelSegments: 4,
      curveSegments: 16,
    })
    this.frameMat = new THREE.MeshToonMaterial({ color: '#7d45e8', gradientMap: toonRampFrame() })
    const wallMat = new THREE.MeshToonMaterial({ color: '#3d1d82', gradientMap: toonRampFrame() })
    const frame = new THREE.Mesh(frameGeo, [this.frameMat, wallMat])
    frame.position.z = FRAME_BACK + BEVEL
    this.scene.add(frame)
    const inkGeo = new THREE.ShapeGeometry(ring(IN_W + RIM + 0.13, IN_H + RIM + 0.13, 0.52, IN_W + 0.02, IN_H + 0.02, 0.24), 16)
    const inkMat = new THREE.MeshBasicMaterial({ color: '#1d0f30' })
    const ink = new THREE.Mesh(inkGeo, inkMat)
    ink.position.z = FRAME_BACK + 0.04
    this.scene.add(ink)
    this.own.push(frameGeo, this.frameMat, wallMat, inkGeo, inkMat)

    // a glowing lip just inside the frame
    const lipGeo = new THREE.ShapeGeometry(ring(IN_W + 0.035, IN_H + 0.035, 0.26, IN_W - 0.005, IN_H - 0.005, 0.23), 16)
    this.lip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7ad1').multiplyScalar(1.6), transparent: true, opacity: 0.95, depthWrite: false })
    const lip = new THREE.Mesh(lipGeo, this.lip)
    lip.position.z = FRAME_FRONT + 0.012
    this.scene.add(lip)
    this.own.push(lipGeo, this.lip)

    // reel dividers
    const divGeo = new THREE.BoxGeometry(0.035, IN_H * 2, 0.05)
    const divMat = new THREE.MeshBasicMaterial({ color: '#12062a' })
    for (let c = 1; c < COLS; c++) {
      const d = new THREE.Mesh(divGeo, divMat)
      d.position.set(cellX(c) - SX / 2, 0, FRAME_BACK + 0.05)
      this.scene.add(d)
    }
    this.own.push(divGeo, divMat)

    // slime on top of the frame, bolts round it
    const sl = buildSlime()
    this.slime = sl.group
    this.slimeMat = sl.green
    this.slime.position.set(0, IN_H + RIM - 0.02, FRAME_FRONT + 0.06)
    this.scene.add(this.slime)
    const deco = buildBolts()
    this.scene.add(deco)
    for (const g of [this.slime, deco])
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) this.own.push(o.geometry, o.material as THREE.Material)
      })

    // the slime meter for free spins: segments along the band and a medallion in the middle
    this.meter = new THREE.Group()
    this.meter.position.set(0, 0.055, 0.14)
    this.meter.visible = false
    const segGeo = new THREE.CapsuleGeometry(0.045, 0.9, 4, 10)
    segGeo.rotateZ(Math.PI / 2)
    const segInk = new THREE.CapsuleGeometry(0.068, 0.93, 4, 10)
    segInk.rotateZ(Math.PI / 2)
    const inkSeg = new THREE.MeshBasicMaterial({ color: '#1d0f30' })
    this.own.push(segGeo, segInk, inkSeg)
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: '#0b4d28' })
      const mesh = new THREE.Mesh(segGeo, mat)
      const ink = new THREE.Mesh(segInk, inkSeg)
      ink.position.z = -0.02
      ink.scale.z = 0.5
      mesh.position.z = 0.03
      this.meter.add(ink, mesh)
      this.segs.push({ mesh, ink, mat, k: 0, to: 0 })
      this.own.push(mat)
    }
    this.medal = new THREE.Group()
    const coinGeo2 = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 32)
    coinGeo2.rotateX(Math.PI / 2)
    const coinInk = new THREE.CylinderGeometry(0.225, 0.225, 0.04, 32)
    coinInk.rotateX(Math.PI / 2)
    const coinMat2 = new THREE.MeshToonMaterial({ color: '#2ee87f', gradientMap: toonRampFrame(), emissive: '#0d6b36', emissiveIntensity: 0.4 })
    const coin = new THREE.Mesh(coinGeo2, coinMat2)
    const cink = new THREE.Mesh(coinInk, inkSeg)
    cink.position.z = -0.03
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.16, 32), new THREE.MeshBasicMaterial({ color: '#0b3d22' }))
    face.position.z = 0.032
    this.medalText = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: labelTexture('×1', '#2ee87f'), transparent: true, depthWrite: false }))
    // the label art leaves wide margins round its text: this size fills the medallion's face with the ×n
    this.medalText.scale.set(0.86, 0.86 * (160 / 512), 1)
    this.medalText.position.z = 0.04
    this.medal.add(cink, coin, face, this.medalText)
    this.medal.position.set(0, -0.005, 0.03)
    this.meter.add(this.medal)
    this.slime.add(this.meter)
    this.own.push(coinGeo2, coinInk, coinMat2, face.geometry, face.material, this.medalText.geometry, this.medalText.material as THREE.Material)

    // Big Mama Chomp, behind the frame
    this.mama = buildMama()
    this.mama.root.position.set(0, TOP, MAMA_Z)
    this.scene.add(this.mama.root)
    this.mama.root.traverse((o) => {
      if (o instanceof THREE.Mesh) this.own.push(o.geometry)
    })
    this.own.push(castMaterial(true))

    // crumbs, coins, confetti, ring bursts
    const crumbGeo = new THREE.DodecahedronGeometry(0.05, 0)
    const crumbMat = new THREE.MeshToonMaterial({ gradientMap: toonRampFrame() })
    this.crumbs = new Bits(crumbGeo, crumbMat, 360, true)
    const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24)
    coinGeo.rotateX(Math.PI / 2)
    const coinMat = new THREE.MeshToonMaterial({ color: '#ffc93d', gradientMap: toonRampFrame(), emissive: '#7a4a00', emissiveIntensity: 0.3 })
    this.coins = new Bits(coinGeo, coinMat, 220, false)
    const confGeo = new THREE.PlaneGeometry(0.09, 0.05)
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    this.confetti = new Bits(confGeo, confMat, 400, false)
    this.crumbs.mesh.renderOrder = 8
    this.coins.mesh.renderOrder = 9
    this.confetti.mesh.renderOrder = 9
    this.scene.add(this.crumbs.mesh, this.coins.mesh, this.confetti.mesh, this.sparks.points, this.flies.points)
    this.own.push(this.crumbs, this.coins, this.confetti, this.sparks, this.flies)
    const ringMat = new THREE.SpriteMaterial({ map: ringTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true })
    this.own.push(ringMat)
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Sprite(ringMat.clone())
      s.visible = false
      s.renderOrder = 11
      this.scene.add(s)
      this.ringPool.push({ s, t: 1, life: 1, r0: 0, r1: 0 })
      this.own.push(s.material)
    }

    // the white flash of big moments, over everything
    this.flashMat = new THREE.ShaderMaterial({
      uniforms: { uA: { value: 0 } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform float uA; void main() { gl_FragColor = vec4(1.0, 0.97, 0.9, uA); }',
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    this.flashMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.flashMat)
    this.flashMesh.frustumCulled = false
    this.flashMesh.renderOrder = 30
    this.flashMesh.visible = false
    this.scene.add(this.flashMesh)
    this.own.push(this.flashMat, this.flashMesh.geometry)

    for (let c = 0; c < COLS; c++) this.reels.push({ col: c, pos: 0, v: 0, state: 'idle', t: 0, from: 0, to: 0, dur: 1, stopAt: 0, speed: SPEED, tease: false, slots: new Map(), targets: new Map(), land: [], free: false, done: null })

    this.onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = cv.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    this.onLeave = () => this.pointer.set(0, 0)
    el.addEventListener('pointermove', this.onMove)
    el.addEventListener('pointerleave', this.onLeave)

    this.poseMama(0, 1)
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
    await step(0.1)
    if (this.disposed) return
    warmUp()
    for (const m of allMaterials()) this.clip(m)
    await step(0.45)
    if (this.disposed) return
    // one of everything, out of sight and showing every face, so every shader is compiled before the first spin
    const warm = new THREE.Group()
    const temp: Piece[] = []
    for (const s of PREVIEW)
      for (const v of s === 'donut' ? [2, 10, 20, 50, 100] : [0]) {
        const p = this.acquire(s, v, -1)
        if (p.joy) p.joy.visible = true
        p.glow.visible = true
        temp.push(p)
        this.scene.remove(p.root)
        warm.add(p.root)
      }
    const stamp = new THREE.Sprite(this.stampMat(2))
    const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: feastTexture('hungry'), transparent: true, depthTest: false, depthWrite: false }))
    warm.add(stamp, card)
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    const M = this.mama
    const hidden: THREE.Object3D[] = [M.hat, M.tongue, M.drool, this.flashMesh, this.meter, ...this.ringPool.map((r) => r.s)]
    for (const o of hidden) o.visible = true
    const far = new THREE.Vector3(0, 0, -30)
    for (const b of [this.crumbs, this.coins, this.confetti]) {
      b.emit(far, new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
      b.update(0)
    }
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    // for the target the scene is drawn into (the composer's linear, untoned buffer), not the canvas
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
    await step(0.8)
    if (this.disposed) return
    this.composer.render()
    for (const o of hidden) o.visible = false
    this.scene.remove(warm)
    card.material.dispose()
    for (const p of temp) {
      warm.remove(p.root)
      this.release(p)
    }
    try {
      this.thumbs = this.makeThumbs()
    } catch {
      this.thumbs = {}
    }
    await step(1)
    if (this.disposed) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private clip(m: THREE.Material) {
    if (m.clippingPlanes !== CLIP) {
      m.clippingPlanes = CLIP
      m.needsUpdate = true
    }
  }

  private stampMat(mult: number) {
    let m = this.stampMats.get(mult)
    if (!m) {
      m = new THREE.SpriteMaterial({ map: stampTexture(mult), transparent: true, depthTest: false, depthWrite: false })
      this.stampMats.set(mult, m)
      this.own.push(m)
    }
    return m
  }

  /** small transparent pictures of each symbol (smiling) and of Big Mama, for the paytable */
  private makeThumbs() {
    const r = this.renderer
    const cv = r.domElement
    const size = Math.floor(Math.min(160, cv.width / 4, cv.height / 3))
    if (size < 40) return {}
    const ts = new THREE.Scene()
    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(-3, 5, 6)
    ts.add(key, new THREE.AmbientLight('#b9a8ff', 0.95))
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')!
    const css = size / this.dpr
    const res: Partial<Record<Sym | 'host', string>> = {}
    const clear = r.getClearColor(new THREE.Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setScissorTest(true)
    r.setViewport(0, 0, css, css)
    r.setScissor(0, 0, css, css)
    const shoot = (o: THREE.Object3D, name: Sym | 'host') => {
      ts.add(o)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[name] = out.toDataURL('image/png')
      ts.remove(o)
    }
    cam.position.set(0, 0, 2.6)
    cam.lookAt(0, 0, 0)
    for (const s of PREVIEW) {
      const o = buildSymbol(s, 25)
      o.traverse((x) => {
        if (x.name === 'halo') x.visible = false
        if (x.name === 'joy') x.visible = true
      })
      // the snacks show their win face (their eyes give way to it)
      if (o.getObjectByName('joy')) o.traverse((x) => x.name === 'eyes' && (x.visible = false))
      shoot(o, s)
    }
    // Big Mama's head, borrowed from the stage for a moment
    const head = this.mama.head
    const parent = head.parent!
    const keep = { p: head.position.clone(), r: head.rotation.clone() }
    head.position.set(0, 0, 0)
    head.rotation.set(0, 0, 0)
    cam.position.set(0, MAMA.head.c[1] + 0.15, 6.9)
    cam.lookAt(0, MAMA.head.c[1] + 0.15, 0)
    shoot(head, 'host')
    head.position.copy(keep.p)
    head.rotation.copy(keep.r)
    parent.add(head)
    r.setScissorTest(false)
    r.setViewport(0, 0, this.w, this.h)
    r.setClearColor(clear, alpha)
    return res
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
    this.dist = Math.max(FIT_H / 2 / tan, FIT_W / 2 / (tan * this.camera.aspect))
    // a narrow screen has height to spare: a little goes over Mama, most to the counters under the frame
    this.camY = CAM_Y - (2 * tan * this.dist - FIT_H) * 0.32
    this.placeCamera()
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.flies.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.backMat.uniforms.uAspect.value = w / h
    if (this.raf) this.composer.render()
  }

  private placeCamera() {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    this.camera.position.set(this.look.x * 0.3 + sx, this.camY - this.look.y * 0.2 + sy, this.dist)
    this.camera.lookAt(sx * 0.5, this.camY + sy * 0.5, 0)
  }

  /* ---------------- clock ---------------- */

  private get speed() {
    return this.base * this.boost
  }

  setTurbo(on: boolean) {
    this.base = on ? 1.75 : 1
  }

  /** the player is impatient: stop the reels now and run the rest of the round faster */
  hurry() {
    this.boost = 2.6
    let n = 0
    for (const r of this.reels)
      if (r.state === 'kick' || r.state === 'spin') {
        r.stopAt = Math.min(r.stopAt, this.time + 0.04 + n++ * 0.05)
        r.tease = false
      }
  }

  calm() {
    this.boost = 1
  }

  /** scene seconds */
  wait(s: number) {
    return new Promise<void>((r) => (this.disposed ? r() : this.timers.push({ at: this.time + s, fn: r, job: false })))
  }

  private until(test: () => boolean) {
    return new Promise<void>((r) => (this.disposed ? r() : this.conds.push({ test, fn: r })))
  }

  /** runs `fn` after `s` scene seconds */
  private after(s: number, fn: () => void) {
    if (this.disposed) return
    if (s <= 0) fn()
    else this.timers.push({ at: this.time + s, fn, job: true })
  }

  /** the sunset mood of free spins; Big Mama puts her party hat on (or takes it off) */
  setFree(on: boolean) {
    this.freeTo = on ? 1 : 0
    this.hatTo = on ? 1 : 0
    if (on) this.host('cheer')
  }

  /* ---------------- pieces ---------------- */

  private keyOf(sym: Sym, value: number) {
    return sym === 'donut' ? 'donut' + donutColor(value) : sym
  }

  private acquire(sym: Sym, value: number, id: number): Piece {
    const key = this.keyOf(sym, value)
    let p = this.pool.get(key)?.pop()
    if (!p) p = this.make(sym, value, key)
    p.id = id
    p.value = value
    p.win = 0
    p.winTo = 0
    p.open = 0
    p.openTo = 0
    p.chompT = 1
    p.shake = 0
    p.pop = 0
    p.fall = null
    p.dying = 0
    p.bites = 0
    p.gulp = 0
    p.squish = 0
    p.phase = Math.random() * 10
    p.blinkAt = this.clock + rnd(0.5, 4)
    p.root.visible = true
    p.inner.scale.setScalar(CAST)
    p.inner.position.set(0, 0, 0)
    p.inner.rotation.set(0, 0, 0)
    p.glow.visible = false
    if (p.joy) p.joy.visible = false
    for (const e of p.eyes) e.visible = true
    if (sym === 'donut') {
      const l = labelMesh(this.donutText(value), donutColor(value))
      this.clip(l.material as THREE.Material)
      l.position.set(0, -0.24, 0.32)
      p.inner.add(l)
      p.label = l
    }
    this.scene.add(p.root)
    this.live.add(p)
    if (id >= 0) this.byId.set(id, p)
    return p
  }

  private make(sym: Sym, value: number, key: string): Piece {
    const model = buildSymbol(sym, value)
    for (const m of symbolMaterials(model)) this.clip(m)
    const inner = new THREE.Group()
    inner.add(model)
    const root = new THREE.Group()
    root.add(inner)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(SYMBOL_COLOR[sym]).multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    this.clip(glow.material)
    glow.scale.set(1.5, 1.5, 1)
    glow.position.z = -0.35
    glow.renderOrder = 1
    glow.visible = false
    root.add(glow)
    const named = (n: string) => {
      const out: THREE.Object3D[] = []
      model.traverse((o) => o.name === n && out.push(o))
      return out
    }
    const eyes = named('eyes')
    return {
      key,
      sym,
      value,
      id: -1,
      root,
      inner,
      model,
      eyes,
      pupils: named('pupils'),
      look: (eyes[0]?.userData.look as number) ?? 0.02,
      mouth: named('mouth')[0] ?? null,
      joy: named('joy')[0] ?? null,
      wings: [...named('wingL'), ...named('wingR')],
      stalks: named('stalks')[0] ?? null,
      crown: named('crown')[0] ?? null,
      halo: (named('halo')[0] as THREE.Sprite) ?? null,
      cherry: named('cherry')[0] ?? null,
      swirl: named('swirl')[0] ?? null,
      wraps: [...named('wrapL'), ...named('wrapR')],
      label: null,
      glow,
      col: 0,
      k: 0,
      u: 0,
      phase: 0,
      blinkAt: 0,
      blink: 0,
      win: 0,
      winTo: 0,
      open: 0,
      openTo: 0,
      chompT: 1,
      shake: 0,
      pop: 0,
      fall: null,
      dying: 0,
      bites: 0,
      gulp: 0,
      squish: 0,
    }
  }

  private release(p: Piece) {
    this.scene.remove(p.root)
    this.live.delete(p)
    if (this.byId.get(p.id) === p) this.byId.delete(p.id)
    if (p.label) {
      p.inner.remove(p.label)
      ;(p.label.material as THREE.Material).dispose()
      p.label = null
    }
    p.glow.material.opacity = 0
    p.glow.visible = false
    let list = this.pool.get(p.key)
    if (!list) this.pool.set(p.key, (list = []))
    list.push(p)
  }

  /**
   * where a piece sits on its reel: u rows from the middle, on the drum. One that reaches (`reach` rows from its middle)
   * no further than the window's edge is clipped away whole, so it is not drawn at all: a reel at rest keeps a spare
   * piece above and below its four rows, a third of the cast's draw calls and triangles.
   */
  private place(p: Piece, u: number, reach = 0.52) {
    p.u = u
    p.root.position.set(cellX(p.col), uY(u), uZ(u))
    p.root.rotation.x = -(u * SY) / DRUM
    p.root.visible = Math.abs(u) - reach < ROWS / 2 - 0.02
  }

  /** the bet changed: donuts on show get new labels */
  relabel() {
    for (const p of this.live)
      if (p.label) {
        const old = p.label.material as THREE.MeshBasicMaterial
        const l = labelMesh(this.donutText(p.value), donutColor(p.value))
        this.clip(l.material as THREE.Material)
        l.position.copy(p.label.position)
        p.inner.remove(p.label)
        old.dispose()
        p.inner.add(l)
        p.label = l
      }
  }

  /* ---------------- reels ---------------- */

  /** places a grid at rest, no animation */
  show(grid: Grid) {
    for (const r of this.reels) {
      for (const p of r.slots.values()) this.release(p)
      r.slots.clear()
      r.pos = 0
      r.to = 0
      r.state = 'idle'
      grid[r.col].forEach((cell, row) => {
        const k = ROWS - 1 - row
        const p = this.acquire(cell.sym, cell.value ?? 0, cell.id)
        p.col = r.col
        p.k = k
        r.slots.set(k, p)
        this.place(p, rowU(row))
      })
    }
  }

  /**
   * Spins all reels and lands `grid`. Reels from `teaseFrom` on hold back and glow, one after another, while Big Mama
   * gasps. Resolves when every reel is at rest.
   */
  async spin(grid: Grid, free: boolean, teaseFrom = -1) {
    // a disposed scene has no frames left to land the reels: never wait on them
    if (this.disposed) return
    this.dimTo = 0
    for (const p of this.live) p.winTo = 0
    // a long run of spins without anything to show makes Mama yawn
    if (!free) this.dead = this.spinWon ? 0 : this.dead + 1
    this.spinWon = false
    this.idleAt = this.clock + rnd(9, 14)
    this.licked = false
    this.teaseCol = teaseFrom
    const all: Promise<void>[] = []
    let at = 0.5
    for (const r of this.reels) {
      const tease = teaseFrom >= 0 && r.col >= teaseFrom
      if (tease) at += 0.95
      r.tease = tease
      r.free = free
      r.state = 'kick'
      r.t = 0
      r.v = 0
      r.from = r.pos
      r.speed = SPEED
      r.stopAt = this.time + at
      // the landing cells are given their slots when the reel starts to stop
      r.targets.clear()
      r.land = grid[r.col]
      all.push(new Promise<void>((done) => (r.done = done)))
      at += 0.16
      if (tease) {
        const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffcf3a').multiplyScalar(1.1), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
        const s = new THREE.Sprite(mat)
        s.scale.set(1.7, IN_H * 2.6, 1)
        s.position.set(cellX(r.col), 0, -0.3)
        s.renderOrder = -1
        this.scene.add(s)
        this.beams.push({ col: r.col, sprite: s, on: 1 })
      }
    }
    await Promise.all(all)
    this.teaseCol = -1
    if (this.coverHold) {
      // the last free spin is over: Mama peeks out from behind her hands
      this.coverHold = false
      if (this.act?.kind === 'cover') this.act.t = Math.max(this.act.t, this.act.dur - 0.4)
    }
    if (!free && this.dead >= 6)
      this.after(0.9, () => {
        if (this.spinWon || this.act || this.reels.some((r) => r.state !== 'idle')) return
        this.dead = 0
        this.host('yawn')
      })
  }

  private updateReel(r: Reel, dt: number) {
    if (r.state === 'idle') return
    r.t += dt
    if (r.state === 'kick') {
      r.pos = r.from - 0.2 * Math.sin(Math.PI * Math.min(1, r.t / KICK))
      if (r.t >= KICK) {
        r.pos = r.from
        r.state = 'spin'
      }
    } else if (r.state === 'spin') {
      const want = r.tease && this.time > r.stopAt - 0.9 ? r.speed * 0.7 : r.speed
      r.v += (want - r.v) * (1 - Math.exp(-dt * 7))
      r.pos += r.v * dt
      if (this.time >= r.stopAt && r.v > 4) this.beginStop(r)
    } else if (r.state === 'stop') {
      const k = Math.min(1, r.t / r.dur)
      r.pos = r.from + (r.to - r.from) * easeOutBack(k)
      if (k >= 1) {
        r.pos = r.to
        r.state = 'idle'
        // the landed slots are renumbered to rows
        const fresh = new Map<number, Piece>()
        for (const [k2, p] of r.slots) {
          const row = ROWS - 1 - (k2 - r.to)
          if (row < 0 || row >= ROWS) this.release(p)
          else fresh.set(k2, p)
        }
        r.slots = fresh
        const syms = Array.from({ length: ROWS }, (_, row) => r.slots.get(r.to + ROWS - 1 - row)?.sym ?? 'candy')
        for (const p of r.slots.values()) p.shake = 1
        // donuts landing make Mama's mouth water (now and then in free spins, where they land all the time)
        if (syms.includes('donut') && !this.licked && (!r.free || Math.random() < 0.3)) {
          this.licked = true
          this.after(0.12, () => (!this.act || this.act.kind === 'dance') && this.host('lick'))
        }
        this.onReelStop?.(r.col, syms)
        const d = r.done
        r.done = null
        d?.()
      }
    }
    this.syncSlots(r)
  }

  private beginStop(r: Reel) {
    const maxK = Math.max(...r.slots.keys(), Math.ceil(r.pos) + ROWS)
    const to = maxK + 1
    r.targets.clear()
    r.land.forEach((cell, row) => r.targets.set(to + ROWS - 1 - row, cell))
    r.state = 'stop'
    r.t = 0
    r.from = r.pos
    r.to = to
    r.dur = Math.max(0.28, ((BACK + 3) * (to - r.pos)) / Math.max(8, r.v))
  }

  /** creates the pieces coming into view, recycles the ones that have left it */
  private syncSlots(r: Reel) {
    const lo = Math.floor(r.pos) - 1
    const hi = Math.ceil(r.pos) + ROWS
    // motion blur: stretch while fast
    const stretch = 1 + Math.min(0.3, Math.abs(r.v) / 90) * (r.state === 'spin' ? 1 : Math.max(0, 1 - r.t / Math.max(0.01, r.dur * 0.5)))
    for (const [k, p] of r.slots)
      if (k < lo) {
        this.release(p)
        r.slots.delete(k)
      }
    for (let k = lo; k <= hi; k++) {
      let p = r.slots.get(k)
      if (!p) {
        const cell = r.targets.get(k)
        if (cell) p = this.acquire(cell.sym, cell.value ?? 0, cell.id)
        else {
          const sym = fillerSym(Math.random, r.col, r.free)
          p = this.acquire(sym, sym === 'donut' ? [2, 5, 10, 15, 25][Math.floor(Math.random() * 5)] : 0, -1)
        }
        p.col = r.col
        p.k = k
        r.slots.set(k, p)
      }
      this.place(p, k - r.pos - (ROWS - 1) / 2, 0.52 * stretch)
    }
    for (const p of r.slots.values()) p.inner.scale.set(CAST, CAST * stretch, CAST)
  }

  /** the piece showing a cell, by id */
  private piece(id: number) {
    return this.byId.get(id) ?? null
  }

  /* ---------------- features ---------------- */

  /** winners hop forward and dance while everything else dims; Mama is pleased (a big line gets a round of applause) */
  async highlight(ids: number[], dur = 1.1) {
    this.spinWon = true
    this.dimTo = 1
    this.watch(ids)
    for (const id of ids) {
      const p = this.piece(id)
      if (p) p.winTo = 1
    }
    if (ids.length >= 9) this.host('clap')
    else if (!this.act && Math.random() < 0.45) this.host('laugh')
    await this.wait(dur)
  }

  clearHighlight() {
    this.dimTo = 0
    this.watchAt = null
    for (const p of this.live) p.winTo = 0
  }

  /** eggs glow and shake; with `hatch` they burst open and Mama cheers */
  async eggs(ids: number[], hatch: boolean) {
    this.spinWon = true
    const ps = ids.map((id) => this.piece(id)).filter((p): p is Piece => !!p)
    this.dimTo = 1
    this.watch(ids)
    this.host('gasp')
    for (const p of ps) p.winTo = 1
    await this.wait(hatch ? 1.1 : 0.9)
    if (hatch) {
      for (const p of ps) {
        const at = this.worldOf(p)
        this.sparks.emit(at.x, at.y, at.z + 0.4, 0, 0, 0, new THREE.Color('#ffd96a').multiplyScalar(2.6), 1.8, 0.35, 0, 0, 0.9)
        this.sparks.burst(at, new THREE.Color('#ffd96a'), 22, 5)
        this.ringBurst(at, '#ffd96a', 0.3, 1.6, 0.5)
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2
          const s = rnd(2, 6)
          this.crumbs.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 2, rnd(1, 4)), new THREE.Color(i % 3 ? '#fff4dc' : '#a55bff'), rnd(1, 1.8), rnd(0.8, 1.2), -14)
        }
        p.pop = 1
      }
      this.host('cheer')
      this.confettiBurst(60)
      this.shake = 0.5
      await this.wait(0.5)
    }
    this.clearHighlight()
  }

  /** a hungry wild drops in from above onto a cell, knocking out what was there */
  async sneak(col: number, row: number, cell: Cell, replaced: Cell) {
    this.spinWon = true
    const r = this.reels[col]
    const k = r.to + ROWS - 1 - row
    const old = this.piece(replaced.id)
    if (old) {
      const at = this.worldOf(old)
      this.sparks.burst(at, new THREE.Color('#ffffff'), 12, 3.5, 0.2, 0.5)
      old.dying = 1
    }
    const p = this.acquire(cell.sym, 0, cell.id)
    p.col = col
    p.k = k
    this.place(p, rowU(row))
    p.fall = { y: IN_H * 2 + 1.2, vy: 0, bounces: 0 }
    p.inner.position.y = p.fall.y
    this.watchAt = this.worldOf(p)
    this.host('wow')
    await this.until(() => !p.fall)
    if (old) {
      r.slots.delete(k)
      this.release(old)
    }
    r.slots.set(k, p)
    this.shake = 0.6
    const at = this.worldOf(p)
    this.sparks.burst(at, new THREE.Color(SYMBOL_COLOR.wild), 18, 4)
    this.ringBurst(at, SYMBOL_COLOR.wild, 0.3, 1.3, 0.45)
    await this.wait(0.3)
    this.watchAt = null
  }

  /**
   * The wild opens wide and every donut sends a copy of itself flying into its mouth, one after another; its belly
   * swells with every bite and Mama chomps along. `hit` is called as each one lands; with `mult` above 1 each copy is
   * stamped with the multiplier as it leaves.
   */
  async collect(wildId: number, donutIds: number[], hit: (i: number) => void, mult = 1) {
    const w = this.piece(wildId)
    if (!w) return
    this.spinWon = true
    this.dimTo = 1
    this.watch([wildId])
    w.winTo = 1
    w.openTo = 1
    w.bites = 0
    const ds = donutIds.map((id) => this.piece(id)).filter((p): p is Piece => !!p)
    for (const d of ds) d.winTo = 1
    await this.wait(0.45)
    const mouth = this.worldOf(w).add(new THREE.Vector3(0, -0.06, 0.75))
    const flights: Promise<void>[] = []
    for (let i = 0; i < ds.length; i++) {
      // disposed mid-collect: no frame will ever land another flight, so launch none (the waits resolve at once)
      if (this.disposed) break
      const d = ds[i]
      const from = this.worldOf(d).add(new THREE.Vector3(0, 0, 0.6))
      const ghost = buildSymbol('donut', d.value)
      const l = labelMesh(this.donutText(d.value), donutColor(d.value))
      this.clip(l.material as THREE.Material)
      l.position.set(0, -0.24, 0.32)
      ghost.add(l)
      ghost.position.copy(from)
      ghost.scale.setScalar(CAST)
      ghost.renderOrder = 12
      let stamp: THREE.Sprite | null = null
      if (mult > 1) {
        stamp = new THREE.Sprite(this.stampMat(mult))
        stamp.position.set(0.24, 0.2, 0.45)
        stamp.renderOrder = 13
        ghost.add(stamp)
        this.ringBurst(from, '#ffc93d', 0.2, 0.9, 0.35)
      }
      this.scene.add(ghost)
      d.squish = 1
      // the arc stays inside the window, where the symbols are drawn
      const ctrl = from.clone().lerp(mouth, 0.5)
      ctrl.y = Math.min(IN_H - 0.45, Math.max(from.y, mouth.y) + 0.5 + Math.random() * 0.4)
      ctrl.z += 1.2
      const color = new THREE.Color(donutColor(d.value))
      flights.push(
        new Promise<void>((done) =>
          this.flights.push({
            from,
            ctrl,
            to: mouth,
            t: 0,
            dur: 0.52,
            obj: ghost,
            color,
            stamp,
            done: () => {
              this.scene.remove(ghost)
              ;(l.material as THREE.Material).dispose()
              w.chompT = 0
              w.bites++
              w.gulp = 1
              const at = mouth.clone()
              this.sparks.burst(at, color, 14, 3.8, 0.22, 0.6)
              this.ringBurst(at, donutColor(d.value), 0.15, 0.9 + w.bites * 0.08, 0.35)
              for (let j = 0; j < 10; j++) {
                const a = Math.random() * Math.PI * 2
                const s = rnd(1.5, 4.5)
                this.crumbs.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 1.5, rnd(1, 3)), new THREE.Color(j % 2 ? '#e9a656' : donutColor(d.value)), rnd(0.6, 1.1), rnd(0.6, 1), -12)
              }
              this.host('chomp')
              hit(i)
              done()
            },
          }),
        ),
      )
      await this.wait(0.22)
    }
    await Promise.all(flights)
    await this.wait(0.45)
    w.openTo = 0
    this.host('clap')
    this.clearHighlight()
    await this.wait(0.2)
  }

  /**
   * The free-spins wild meter on the slime band: `filled` of `of` segments glow (up to 6) and the medallion in the middle
   * shows ×`mult` (it pops when the multiplier changes); null slides it away. The band stays plain in the base game.
   */
  setMeter(m: { filled: number; of: number; mult: number } | null) {
    if (!m) {
      this.meterTo = 0
      return
    }
    const of = Math.max(1, Math.min(6, Math.round(m.of)))
    this.meterTo = 1
    // segments either side of the medallion, inside Mama's hands at the band's ends
    const half = Math.ceil(of / 2)
    const span = 2.3
    const len = span / half
    this.segs.forEach((g, i) => {
      g.mesh.visible = g.ink.visible = i < of
      if (i >= of) return
      const side = i < half ? -1 : 1
      const j = side < 0 ? half - 1 - i : i - half
      const x = side * (0.32 + len * (j + 0.5))
      g.mesh.position.x = g.ink.position.x = x
      g.mesh.scale.x = g.ink.scale.x = (len - 0.12) / 0.99
      g.to = i < m.filled ? 1 : 0
    })
    if (m.mult !== this.meterMult) {
      const old = this.medalText.material as THREE.MeshBasicMaterial
      old.map = labelTexture(`×${m.mult}`, m.mult >= 10 ? '#ffcf3a' : '#2ee87f')
      old.needsUpdate = true
      if (this.meterMult) {
        this.medalPop = 1
        const at = this.medal.getWorldPosition(new THREE.Vector3())
        this.sparks.burst(at, new THREE.Color('#2ee87f'), 18, 3.5)
        this.ringBurst(at, '#2ee87f', 0.2, 1.0, 0.45)
      }
      this.meterMult = m.mult
    }
  }

  /** the meter filled: flash, confetti, Mama cheers; the band's segments flare */
  async levelUp() {
    for (const g of this.segs) g.k = 1.6
    this.host('cheer')
    this.flash(0.5)
    this.confettiBurst(90)
    this.shake = 0.4
    await this.wait(0.3)
  }

  confettiBurst(n: number) {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const pal = ['#2ee87f', '#ff5fa2', '#ffcf3a', '#3db4ff', '#b06bff', '#ff8a2a']
    for (let i = 0; i < n; i++) {
      const z = rnd(0.8, 2.5)
      const depth = this.camera.position.z - z
      const hw = tan * depth * this.camera.aspect
      this.confetti.emit(new THREE.Vector3(rnd(-hw, hw), this.camY + tan * depth + rnd(0, 1.5), z), new THREE.Vector3(rnd(-1, 1), rnd(-3, -0.5), 0), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.5, 3.5), -3, rnd(4, 10))
    }
  }

  /** gold coins rain down in front of the machine, and Mama applauds */
  coinShower(seconds = 2.5) {
    this.shower = Math.max(this.shower, seconds)
    if (!this.act || (this.act.kind !== 'cheer' && this.act.kind !== 'clap')) this.host('clap')
  }

  stopShower() {
    this.shower = 0
  }

  /** a white flash over the whole stage */
  flash(strength = 1) {
    this.flashA = Math.max(this.flashA, strength)
  }

  /** a ring of light growing out from a point */
  private ringBurst(at: THREE.Vector3, color: string, r0: number, r1: number, life: number) {
    const r = this.ringPool.reduce((a, b) => (b.t / b.life > a.t / a.life ? b : a))
    r.t = 0
    r.life = life
    r.r0 = r0
    r.r1 = r1
    r.s.position.copy(at)
    r.s.material.color.set(color).multiplyScalar(1.6)
    r.s.visible = true
  }

  /* ---------------- Big Mama ---------------- */

  /** a gesture from Big Mama; fire and forget. 'cover' (hands over her eyes) holds until the reels next come to rest. */
  host(action: HostAction) {
    if (this.disposed) return
    this.act = { kind: action, t: 0, dur: ACT_DUR[action] }
    this.coverHold = action === 'cover'
    // no spin to wait for: peek out after a moment anyway
    if (action === 'cover')
      this.after(1.2, () => {
        if (!this.coverHold || this.reels.some((r) => r.state !== 'idle')) return
        this.coverHold = false
        if (this.act?.kind === 'cover') this.act.t = Math.max(this.act.t, this.act.dur - 0.4)
      })
    if (action === 'lick') this.after(0.35, () => (this.droolT = 0))
  }

  /** Big Mama's head on screen, in CSS pixels, for laying out the overlay (speech, captions) */
  hostRect() {
    const [hx, hy] = [MAMA.head.r[0] + 0.15, MAMA.head.c[1]]
    const a = this.project(new THREE.Vector3(-hx, TOP + hy + MAMA.head.r[1] + 0.1, MAMA_Z))
    const b = this.project(new THREE.Vector3(hx, TOP + 0.25, MAMA_Z))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  private poseMama(dt: number, real: number) {
    const M = this.mama
    const P = this.mp
    for (let s = 0; s < 2; s++) {
      P.handP[s].copy(GRIP.p[s])
      P.handQ[s].copy(GRIP.q[s])
    }
    P.tilt = Math.sin(this.clock * 0.7) * 0.025
    P.nod = 0
    P.lunge = 0
    P.bob = Math.sin(this.clock * 1.6) * 0.015
    P.open = 0.16
    P.narrow = 0
    P.lid = -1.15
    P.low = 1.2
    P.wide = 1
    P.brow = 0
    P.browTilt = 0
    P.tongue = 0
    P.tongueX = 0
    const T = this.clock
    const spinning = this.reels.some((r) => r.state !== 'idle')
    const hand = (s: number, to: { p: THREE.Vector3[]; q: THREE.Quaternion[] }, k: number) => {
      P.handP[s].lerp(to.p[s], k)
      P.handQ[s].slerp(to.q[s], k)
    }

    // waiting on the reels: drumming her fingers on the frame
    if (spinning) for (let s = 0; s < 2; s++) P.handP[s].y += Math.max(0, Math.sin(T * 13 + s * Math.PI)) * 0.05
    // free spins: grooving between the moments
    if (this.free > 0.5 && !spinning) {
      const b = T * Math.PI * 2
      P.tilt += Math.sin(b) * 0.06
      P.bob += Math.abs(Math.sin(b)) * 0.04
      P.low = 0.75
    }
    // winners on show: a pleased squint
    this.happy += ((this.dim > 0.5 ? 1 : 0) - this.happy) * Math.min(1, real * 5)
    P.low += (0.55 - P.low) * this.happy
    P.open += (0.32 - P.open) * this.happy

    // a held tease: hands to her cheeks, mouth an O, eyes wide on the reel
    const tz = this.teaseK
    if (tz > 0.01) {
      hand(0, CHEEK, tz)
      hand(1, CHEEK, tz)
      P.open += (0.6 - P.open) * tz
      P.narrow = 0.75 * tz
      P.wide = 1 + 0.12 * tz
      P.brow = tz
      P.lid += (-1.35 - P.lid) * tz
      P.low += (1.3 - P.low) * tz
      P.nod = -0.04 * tz
    }

    const a = this.act
    if (a) {
      a.t += dt
      const u = Math.min(1, a.t / a.dur)
      const e = env(u, 0.15, 0.25)
      switch (a.kind) {
        case 'lick':
          P.tongue = env(u, 0.18, 0.22)
          P.tongueX = Math.sin(u * Math.PI * 2.4) * 0.9
          P.open += (0.55 - P.open) * e
          P.low += (0.6 - P.low) * e
          P.lid += (-0.55 - P.lid) * e
          P.tilt += 0.06 * Math.sin(u * Math.PI * 2) * e
          break
        case 'gasp':
          hand(0, CHEEK, e)
          hand(1, CHEEK, e)
          P.open += (0.75 - P.open) * e
          P.narrow = 0.8 * e
          P.wide = 1 + 0.16 * e
          P.brow = e
          P.lid += (-1.4 - P.lid) * e
          P.low += (1.3 - P.low) * e
          P.nod = -0.07 * e
          break
        case 'wow': {
          const first = u < 0.45
          P.wide = 1 + (first ? 0.2 : 0.06) * e
          P.brow = (first ? 1 : 0.5) * e
          P.open += ((first ? 0.7 : 0.5) - P.open) * e
          P.narrow = first ? 0.75 * e : 0
          P.low += ((first ? 1.3 : 0.5) - P.low) * e
          P.lid += (-1.4 - P.lid) * e
          for (let s = 0; s < 2; s++) P.handP[s].y += 0.12 * e
          P.lunge = 0.08 * e
          break
        }
        case 'cheer': {
          hand(0, UP, e)
          hand(1, UP, e)
          for (let s = 0; s < 2; s++) P.handP[s].x += Math.sin(a.t * 19 + s) * 0.07 * e
          P.open += (0.9 - P.open) * e
          P.low += (0.42 - P.low) * e
          P.brow = 0.6 * e
          P.bob += Math.abs(Math.sin(u * Math.PI * 4)) * 0.08 * e
          P.tilt += Math.sin(u * Math.PI * 4) * 0.06 * e
          break
        }
        case 'clap': {
          const c = 0.5 + 0.5 * Math.cos(a.t * TAU * 3.2)
          for (let s = 0; s < 2; s++) {
            P.handP[s].lerp(_v.copy(CLAP_SHUT.p[s]).lerp(CLAP_OPEN.p[s], c), e)
            P.handQ[s].slerp(CLAP_OPEN.q[s], e)
          }
          P.open += (0.7 - P.open) * e
          P.low += (0.45 - P.low) * e
          P.bob += (1 - c) * 0.03 * e
          if (c < 0.12 && this.clapWas >= 0.12 && e > 0.5) {
            // the clap: a pop of sparks between her hands
            const at = M.root.localToWorld(P.handP[0].clone().add(P.handP[1]).multiplyScalar(0.5))
            this.sparks.burst(at, new THREE.Color('#ffe7a8'), 7, 2.2, 0.16, 0.35)
          }
          this.clapWas = c
          break
        }
        case 'chomp': {
          P.lunge = 0.22 * e
          P.nod = 0.07 * e
          P.open = 0.12 + 0.88 * Math.abs(Math.sin(u * Math.PI * 2)) * e
          P.brow = -0.6 * e
          for (let s = 0; s < 2; s++) P.handP[s].y -= 0.04 * e
          break
        }
        case 'cover': {
          const k = this.coverHold ? smooth(Math.min(1, a.t / 0.25)) : e
          hand(0, EYES, k)
          hand(1, EYES, k)
          // a peek between her fingers now and then
          if (a.t > 0.9) P.handP[1].y -= 0.2 * Math.max(0, Math.sin((a.t - 0.9) * 2.2)) * k
          P.nod = 0.07 * k
          P.tilt += Math.sin(a.t * 31) * 0.012 * k
          P.open += (0.3 - P.open) * k
          P.narrow = 0.4 * k
          P.brow = 0.8 * k
          if (this.coverHold) a.t = Math.min(a.t, a.dur * 0.5)
          break
        }
        case 'yawn': {
          const o = env(u, 0.35, 0.3)
          P.open += (1 - P.open) * o
          P.narrow = -0.1 * o
          P.lid += (0.45 - P.lid) * e
          P.nod = -0.13 * o
          P.tilt += 0.05 * o
          P.brow = 0.4 * o
          P.handP[1].lerp(MOUTH_R.p, o)
          P.handQ[1].slerp(MOUTH_R.q, o)
          P.handP[1].y += Math.sin(a.t * 11) * 0.03 * o
          break
        }
        case 'dance': {
          const b = a.t * Math.PI * 2.2
          P.tilt += Math.sin(b) * 0.12 * e
          P.bob += Math.abs(Math.sin(b)) * 0.08 * e
          const up = Math.sin(b) > 0 ? 0 : 1
          hand(up, UP, 0.75 * e * Math.abs(Math.sin(b)))
          P.open += (0.55 - P.open) * e
          P.low += (0.5 - P.low) * e
          P.brow = 0.4 * e
          break
        }
        case 'laugh':
          P.open = P.open + (0.3 + 0.45 * Math.abs(Math.sin(a.t * 15)) - P.open) * e
          P.low += (0.45 - P.low) * e
          P.lid += (-0.6 - P.lid) * e
          P.nod += 0.04 * Math.sin(a.t * 15) * e
          P.tilt += 0.05 * Math.sin(a.t * 5) * e
          break
      }
      if (a.t >= a.dur) this.act = null
    }

    // blinks
    if (T > this.blinkAt) {
      this.blink = 1
      this.blinkAt = T + rnd(2.2, 5.5)
    }
    this.blink = Math.max(0, this.blink - real * 7)
    const shut = this.blink > 0 ? 1 - Math.abs(this.blink * 2 - 1) : 0

    // ease into the pose
    const S = this.ms
    const k = Math.min(1, real * 16)
    const kh = Math.min(1, real * 12)
    for (let s = 0; s < 2; s++) {
      S.handP[s].lerp(P.handP[s], kh)
      S.handQ[s].slerp(P.handQ[s], kh)
    }
    for (const f of EASED) S[f] += (P[f] - S[f]) * k
    S.open += (P.open - S.open) * Math.min(1, real * 26)

    // apply
    const head = M.head
    head.rotation.set(S.nod, 0, S.tilt)
    head.position.set(0, S.bob, S.lunge)
    const breathe = Math.sin(T * 1.6) * 0.008
    head.scale.set(1 + breathe, 1 - breathe * 0.5, 1)
    const lid = S.lid + (1.55 - S.lid) * shut
    for (const [i, e] of M.eyes.entries()) {
      e.lid.rotation.x = lid
      e.low.rotation.x = S.low
      e.root.scale.setScalar(S.wide)
      e.iris.rotation.set(-this.lookAt.y * 0.55, this.lookAt.x * 0.55 + (i ? -0.04 : 0.04), 0)
    }
    for (const [i, b] of M.brows.entries()) {
      const rest = b.userData.rest as THREE.Vector3
      const side = i ? 1 : -1
      b.position.set(rest.x, rest.y + S.brow * 0.08, rest.z)
      b.rotation.z = side * (S.brow * 0.12 - S.browTilt * 0.25 + (S.brow < 0 ? S.brow * 0.3 : 0))
    }
    const open = Math.min(1, Math.max(0.1, S.open))
    const nx = 1 - S.narrow * 0.42
    M.mouth.scale.set(nx, 1, 1)
    M.mouthMesh.morphTargetInfluences![0] = (1 - open) / 0.9
    M.jaw.position.y = JAW * (1 - open)
    M.jaw.scale.x = nx
    const tg = M.tongue
    tg.visible = S.tongue > 0.03
    if (tg.visible) {
      const rest = tg.userData.rest as THREE.Vector3
      tg.position.set(rest.x + S.tongueX * 0.28, rest.y - 0.05 * S.tongue - Math.abs(S.tongueX) * 0.03, rest.z + 0.07 * S.tongue)
      tg.rotation.z = S.tongueX * 0.35
      tg.scale.setScalar(Math.max(0.01, S.tongue))
    }
    // drool: a drop swells at the corner of her mouth, stretches and falls
    const dr = M.drool
    if (this.droolT >= 0) {
      this.droolT += dt
      const t = this.droolT
      const rest = dr.userData.rest as THREE.Vector3
      dr.visible = true
      if (t < 0.5) {
        dr.position.copy(rest)
        dr.scale.setScalar(smooth(t / 0.5))
      } else if (t < 0.9) {
        dr.position.copy(rest)
        dr.scale.set(1, 1 + (t - 0.5) * 2.2, 1)
      } else {
        const f = t - 0.9
        dr.position.set(rest.x, rest.y - 0.15 - 4 * f * f, rest.z)
        dr.scale.set(1, 1.6, 1)
      }
      if (t > 1.5) {
        this.droolT = -1
        dr.visible = false
      }
    }

    // the party hat
    this.hatK = this.hatTo > this.hatK ? Math.min(1, this.hatK + dt / 0.45) : Math.max(0, this.hatK - dt / 0.3)
    M.hat.visible = this.hatK > 0.01
    if (M.hat.visible) {
      M.hat.scale.setScalar(Math.max(0.01, this.hatTo ? easeOutBack(this.hatK) : this.hatK))
      M.hat.position.y = (M.hat.userData.rest as { y: number }).y + Math.abs(Math.sin(T * Math.PI * 2)) * 0.03 * this.free
    }

    // hands, and the arms that reach them from behind the frame: the elbow stays behind the frame's top edge, so
    // only the forearm crosses over it
    for (let s = 0; s < 2; s++) {
      const h = M.hands[s]
      const hp = S.handP[s]
      h.position.copy(hp)
      h.quaternion.copy(S.handQ[s])
      const side = s ? 1 : -1
      const el = this.elbow.set(side * Math.min(2.95, Math.max(1.9, Math.abs(hp.x) + 0.55)), Math.min(1.1, Math.max(0.24, hp.y - 0.5)), 0.38)
      const { upper, fore, elbow } = M.arms[s]
      limb(upper, SHOULDER[s], el)
      limb(fore, el, hp)
      elbow.position.copy(el)
    }
  }

  /** where Mama's eyes look: at the symbols being watched, round with the spinning reels, at a held reel, or about */
  private updateLook(real: number) {
    const T = this.clock
    const spinning = this.reels.some((r) => r.state !== 'idle')
    const target = _v2.set(0, 0)
    const eyeY = TOP + MAMA.eyeY
    const at = this.feast.length ? FEAST_LOOK : this.watchAt
    if (this.teaseCol >= 0 && spinning) target.set(THREE.MathUtils.clamp(cellX(this.teaseCol) / 2.6, -1, 1), -0.7)
    else if (at) target.set(THREE.MathUtils.clamp(at.x / 2.6, -1, 1), THREE.MathUtils.clamp((at.y - eyeY) / 3.2, -1, -0.15))
    else if (spinning) target.set(Math.cos(T * 7) * 0.7, -0.45 + Math.sin(T * 7) * 0.4)
    else {
      if (T > this.dartAt) {
        this.dart.set(rnd(-0.75, 0.75), rnd(-0.6, 0.1))
        this.dartAt = T + rnd(0.8, 2.6)
      }
      target.set(this.look.x * 0.8, -this.look.y * 0.6 - 0.2)
      if (this.pointer.lengthSq() === 0) target.copy(this.dart)
    }
    this.lookAt.lerp(target, Math.min(1, real * (spinning ? 14 : 9)))
  }

  /** Mama's eyes turn to the middle of these symbols */
  private watch(ids: number[]) {
    const at = new THREE.Vector3()
    let n = 0
    for (const id of ids) {
      const p = this.piece(id)
      if (!p) continue
      at.add(this.worldOf(p))
      n++
    }
    if (n) this.watchAt = at.divideScalar(n)
  }

  /* ---------------- the Feast Pick ---------------- */

  /** Three big eggs rise in front of the dimmed reels for the Feast Pick, Mama leaning in; resolves once they are up */
  async feastShow() {
    this.feastClear()
    this.feastOut = false
    this.dimTo = 1
    for (let i = 0; i < 3; i++) {
      const obj = buildSymbol('egg')
      obj.scale.setScalar(FEAST_S)
      obj.position.set(FEAST_X[i], -IN_H - 1.4, FEAST_Z)
      obj.renderOrder = 6
      this.scene.add(obj)
      this.feast.push({ obj, x: FEAST_X[i], k: 0, delay: i * 0.14, shake: 0, burst: 0, card: null, cardK: 0, dimmed: false })
    }
    this.host('gasp')
    await this.until(() => this.feast.every((e) => e.k >= 1))
  }

  /** the eggs on screen, left to right, in CSS pixels: centre and radius (for tap targets); empty when none show */
  feastSpots() {
    return this.feast.map((e) => {
      const c = this.project(new THREE.Vector3(e.x, FEAST_Y, FEAST_Z))
      const t = this.project(new THREE.Vector3(e.x, FEAST_Y + 0.33 * FEAST_S, FEAST_Z))
      return { x: c.x, y: c.y, r: Math.abs(c.y - t.y) }
    })
  }

  /** which egg (0-2) a tap at (x, y) in CSS pixels lands on, or -1 */
  feastHit(x: number, y: number) {
    const spots = this.feastSpots()
    let best = -1
    let bd = Infinity
    spots.forEach((s, i) => {
      const d = Math.hypot(x - s.x, (y - s.y) * 0.8)
      if (d < s.r * 1.15 && d < bd) {
        bd = d
        best = i
      }
    })
    return best
  }

  /** an egg wobbles harder while it is pointed at; -1 for none */
  feastHover(i: number) {
    this.feast.forEach((e, j) => (e.shake = j === i ? Math.max(e.shake, 0.35) : e.shake))
  }

  /**
   * Hatches egg `pick` (it shakes, cracks and bursts, showing the card for `kinds[pick]`, and Mama cheers), then the
   * other two crack open and show theirs, dimmed. Resolves once the reveal has had time to be read.
   */
  async feastReveal(pick: number, kinds: [FeastKind, FeastKind, FeastKind]) {
    const e = this.feast[pick]
    if (!e) return
    this.host('wow')
    e.shake = 1
    await this.wait(0.55)
    this.hatchEgg(e, kinds[pick], false)
    this.host('cheer')
    this.flash(0.35)
    this.shake = 0.4
    this.confettiBurst(50)
    await this.wait(0.9)
    this.feast.forEach((o, i) => {
      if (i !== pick) this.after(i * 0.12, () => this.hatchEgg(o, kinds[i], true))
    })
    await this.wait(1.1)
  }

  private hatchEgg(e: FeastEgg, kind: FeastKind, dim: boolean) {
    e.burst = 0.0001
    e.dimmed = dim
    const at = new THREE.Vector3(e.x, FEAST_Y, FEAST_Z + 0.3)
    this.sparks.burst(at, new THREE.Color(dim ? '#b9a8ff' : '#ffd96a'), dim ? 10 : 26, dim ? 3 : 5.5)
    if (!dim) {
      this.sparks.emit(at.x, at.y, at.z + 0.2, 0, 0, 0, new THREE.Color('#ffd96a').multiplyScalar(2.6), 2.4, 0.35, 0, 0, 0.9)
      this.ringBurst(at, '#ffd96a', 0.4, 2.2, 0.55)
    }
    for (let i = 0; i < (dim ? 10 : 22); i++) {
      const a = Math.random() * Math.PI * 2
      const s = rnd(2, dim ? 4 : 7)
      this.crumbs.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 2.5, rnd(1, 4)), new THREE.Color(i % 3 ? '#fff4dc' : ['#a55bff', '#2ee87f', '#ff5fa2'][i % 3]), rnd(1.4, 2.4), rnd(0.8, 1.3), -14)
    }
    const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: feastTexture(kind), transparent: true, depthTest: false, depthWrite: false }))
    card.position.copy(at).add(new THREE.Vector3(0, 0.15, 0.2))
    card.renderOrder = 14
    card.scale.set(0.01, 0.01, 1)
    // the eggs nobody picked show what they held, clearly in the shade of the one that was
    if (dim) card.material.color.setScalar(0.3)
    this.scene.add(card)
    e.card = card
    e.cardK = 0
  }

  /** the eggs and cards clear away; resolves once they are gone */
  async feastHide() {
    if (!this.feast.length) return
    this.feastOut = true
    this.dimTo = 0
    await this.wait(0.35)
    this.feastClear()
  }

  private feastClear() {
    for (const e of this.feast) {
      this.scene.remove(e.obj)
      if (e.card) {
        this.scene.remove(e.card)
        e.card.material.dispose()
      }
    }
    this.feast = []
  }

  private updateFeast(dt: number) {
    const T = this.clock
    const leaving = this.feastOut
    for (const [i, e] of this.feast.entries()) {
      if (e.delay > 0) e.delay -= dt
      else if (e.k < 1) e.k = Math.min(1, e.k + dt / 0.55)
      const rise = easeOutBack(e.k)
      const y = -IN_H - 1.4 + (FEAST_Y + IN_H + 1.4) * rise
      e.shake = Math.max(0, e.shake - dt * (e.burst ? 0 : 0.6))
      const wob = Math.sin(T * 2.4 + i * 1.7) * 0.06 + (e.shake > 0 ? Math.sin(T * 38) * 0.2 * e.shake : 0)
      e.obj.position.set(e.x + (e.shake > 0.5 ? Math.sin(T * 47) * 0.03 : 0), y + Math.abs(Math.sin(T * 2.4 + i * 1.7)) * 0.04, FEAST_Z)
      e.obj.rotation.z = wob
      if (e.burst > 0) {
        e.burst = Math.min(1, e.burst + dt / 0.18)
        e.obj.scale.setScalar(FEAST_S * (1 + 0.25 * e.burst) * (1 - e.burst) + 0.0001)
        e.obj.visible = e.burst < 1
      }
      if (e.card) {
        e.cardK = Math.min(1, e.cardK + dt / 0.45)
        const s = (e.dimmed ? 0.85 : 1.25) * easeOutBack(e.cardK) * (leaving ? 0 : 1)
        e.card.scale.set(1.25 * s, 1.5625 * s, 1)
        e.card.position.y = FEAST_Y + 0.25 + (e.dimmed ? 0 : 0.18) + Math.sin(T * 2 + i) * 0.04
        e.card.material.rotation = Math.sin(T * 1.6 + i) * 0.04
        if (!e.dimmed && Math.random() < dt * 12) {
          const c = e.card.position
          this.sparks.emit(c.x + rnd(-0.7, 0.7), c.y + rnd(-0.8, 0.8), c.z + 0.2, 0, rnd(0.2, 0.8), 0, new THREE.Color('#ffe7a8').multiplyScalar(2), rnd(0.12, 0.24), rnd(0.4, 0.8), 0, 1)
        }
      }
      if (leaving && e.k >= 1) {
        e.obj.scale.multiplyScalar(Math.max(0, 1 - dt * 8))
      }
    }
  }

  /* ---------------- coordinates ---------------- */

  private worldOf(p: Piece) {
    return new THREE.Vector3(cellX(p.col), uY(p.u), uZ(p.u))
  }

  private project(v: THREE.Vector3) {
    const q = v.clone().project(this.camera)
    return { x: ((q.x + 1) / 2) * this.w, y: ((1 - q.y) / 2) * this.h }
  }

  /** the average screen position of some symbols, in CSS pixels */
  screenOf(ids: number[]) {
    const s = new THREE.Vector3()
    let n = 0
    for (const id of ids) {
      const p = this.piece(id)
      if (!p) continue
      s.add(this.worldOf(p))
      n++
    }
    return n ? this.project(s.divideScalar(n).add(new THREE.Vector3(0, 0, 0.5))) : null
  }

  /** the frame on screen, for laying out the overlay */
  frameRect() {
    const a = this.project(new THREE.Vector3(-IN_W - RIM, IN_H + RIM, FRAME_FRONT))
    const b = this.project(new THREE.Vector3(IN_W + RIM, -IN_H - RIM, FRAME_FRONT))
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  /* ---------------- frame loop ---------------- */

  private busy() {
    return (
      this.timers.length > 0 ||
      this.conds.length > 0 ||
      this.flights.length > 0 ||
      this.sparks.list.length > 0 ||
      this.crumbs.list.length > 0 ||
      this.coins.list.length > 0 ||
      this.confetti.list.length > 0 ||
      this.beams.length > 0 ||
      this.feast.length > 0 ||
      this.meterOn !== this.meterTo ||
      this.medalPop > 0 ||
      this.act !== null ||
      this.droolT >= 0 ||
      this.teaseK > 0.002 ||
      this.hatK !== this.hatTo ||
      this.flashA > 0 ||
      this.ringPool.some((r) => r.s.visible) ||
      this.shower > 0 ||
      this.shake > 0 ||
      Math.abs(this.free - this.freeTo) > 0.001 ||
      Math.abs(this.dim - this.dimTo) > 0.002 ||
      this.reels.some((r) => r.state !== 'idle')
    )
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // idle characters only breathe and blink; 30 frames a second is plenty for that
    if (!this.busy() && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    const dt = real * this.speed
    this.time += dt
    this.clock += real
    this.update(dt, real)
    // slow device: draw fewer pixels rather than drop frames
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.composer.render()
  }

  private update(dt: number, real: number) {
    // (only builds new lists on the frames something is due)
    if (this.timers.some((t) => t.at <= this.time)) {
      const due = this.timers.filter((t) => t.at <= this.time)
      this.timers = this.timers.filter((t) => t.at > this.time)
      for (const t of due) t.fn()
    }

    // mood
    this.free += (this.freeTo - this.free) * Math.min(1, real * 2)
    if (Math.abs(this.free - this.freeTo) < 0.002) this.free = this.freeTo
    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 8)
    if (Math.abs(this.dim - this.dimTo) < 0.003) this.dim = this.dimTo
    this.backMat.uniforms.uTime.value = this.clock
    this.backMat.uniforms.uFree.value = this.free
    this.dimMat.opacity = this.dim * (this.feast.length && !this.feastOut ? 0.72 : 0.55)
    this.bloom.strength = 0.42 * (1 - 0.5 * this.dim)
    this.lip.color.copy(TINT.lip).lerp(TINT.lipFree, this.free).multiplyScalar(1.5 + 0.25 * Math.sin(this.clock * 2.6))
    this.frameMat.color.copy(TINT.frame).lerp(TINT.frameFree, this.free * 0.3)
    this.ambient.color.copy(TINT.ambient).lerp(TINT.ambientFree, this.free)
    this.key.color.copy(TINT.key).lerp(TINT.keyFree, this.free)
    this.bedMat.color.copy(TINT.bed).lerp(TINT.bedFree, this.free * 0.6)
    this.slimeMat.emissiveIntensity = 0.25 + 0.15 * Math.sin(this.clock * 2.2) * this.free + 0.1 * this.free
    this.slime.children.forEach((d, i) => {
      if (d.name === 'drip') d.scale.y = 1 + 0.08 * Math.sin(this.clock * 1.6 + i * 1.3)
    })
    if (this.meterTo || this.meterOn) {
      this.meterOn = this.meterTo > this.meterOn ? Math.min(1, this.meterOn + real * 3) : Math.max(0, this.meterOn - real * 3)
      this.meter.visible = this.meterOn > 0.01
      this.meter.scale.set(1, Math.max(0.01, easeOutBack(this.meterOn)), 1)
      this.medalPop = Math.max(0, this.medalPop - real * 2.5)
      const pop = 1 + Math.sin(this.medalPop * Math.PI) * 0.35
      this.medal.scale.setScalar(Math.max(0.01, easeOutBack(this.meterOn)) * pop)
      this.medal.rotation.z = Math.sin(this.clock * 2) * 0.06
      for (let i = 0; i < this.segs.length; i++) {
        const g = this.segs[i]
        g.k += (g.to - g.k) * Math.min(1, real * 6)
        const glow = Math.min(1.6, g.k)
        g.mat.color.copy(TINT.segDark).lerp(TINT.segLit, Math.min(1, glow)).multiplyScalar(1 + 0.6 * Math.max(0, glow - 0.3) * (0.8 + 0.2 * Math.sin(this.clock * 6 + i)))
        if (g.k > 0.6 && g.mesh.visible && Math.random() < real * 3) {
          const at = g.mesh.getWorldPosition(_v)
          this.sparks.emit(at.x + rnd(-0.4, 0.4), at.y, at.z + 0.05, 0, rnd(0.3, 0.7), 0, _c.set('#9dffc8').multiplyScalar(1.6), rnd(0.08, 0.14), rnd(0.4, 0.7), 0, 1)
        }
      }
    }
    this.flashA = Math.max(0, this.flashA - real * 2.6)
    this.flashMat.uniforms.uA.value = this.flashA * 0.6
    this.flashMesh.visible = this.flashA > 0.003

    // tease: Mama holds her breath while a held reel spins
    const teasing = this.reels.some((r) => r.tease && r.state !== 'idle')
    this.teaseK += ((teasing ? 1 : 0) - this.teaseK) * Math.min(1, real * 6)
    if (this.teaseK < 0.002) this.teaseK = 0
    this.updateLook(real)
    this.poseMama(dt, real)

    // camera: drifts towards the mouse, shakes on big hits
    this.shake = Math.max(0, this.shake - real * 2.2)
    this.look.lerp(this.pointer, Math.min(1, real * 3))
    this.placeCamera()

    for (const r of this.reels) this.updateReel(r, dt)

    // pieces
    const T = this.clock
    const still = this.reels.every((r) => r.state === 'idle') && this.dim === 0 && !this.feast.length
    if (still && T > this.hopAt) {
      // now and then one of the cast gives a little hop
      this.hopAt = T + rnd(1.8, 3.2)
      const idle = [...this.live].filter((p) => p.winTo === 0 && !p.fall && p.dying === 0 && p.root.visible)
      const p = idle[Math.floor(Math.random() * idle.length)]
      if (p) p.shake = 0.75
    }
    if (still && !this.act && T > this.idleAt) {
      // and Mama fidgets while she waits for the next spin
      this.idleAt = T + rnd(8, 13)
      this.host((['lick', 'dance', 'laugh'] as const)[Math.floor(Math.random() * 3)])
    }
    for (const p of this.live) this.animate(p, dt, real, T)

    // anticipation beams fade once their reel stops
    if (this.beams.length) {
      for (const b of this.beams) {
        const r = this.reels[b.col]
        if (r.state === 'idle') b.on -= dt * 3
        b.sprite.material.opacity = Math.max(0, b.on) * (0.5 + 0.25 * Math.sin(this.clock * 12))
        if (r.state !== 'idle' && Math.random() < dt * 30) this.sparks.emit(cellX(b.col) + rnd(-0.5, 0.5), -IN_H, 0.3, 0, rnd(2, 4), 0, _c.set('#ffcf3a').multiplyScalar(2), rnd(0.12, 0.25), rnd(0.6, 1), 0, 0.5)
        if (b.on <= 0) {
          this.scene.remove(b.sprite)
          b.sprite.material.dispose()
        }
      }
      this.beams = this.beams.filter((b) => b.on > 0)
    }

    // donuts flying into a mouth, the multiplier stamp slamming onto them as they leave
    if (this.flights.length) {
      const pos = _v
      for (const f of this.flights) {
        f.t = Math.min(1, f.t + dt / f.dur)
        const e = f.t * f.t * (3 - 2 * f.t)
        const a = 1 - e
        pos.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * e).addScaledVector(f.to, e * e)
        f.obj.position.copy(pos)
        f.obj.rotation.z += dt * 9
        f.obj.scale.setScalar(CAST * (1 - 0.62 * e))
        if (f.stamp) {
          const k = Math.min(1, f.t / 0.22)
          const s = 0.62 + 1.6 * (1 - k) ** 2
          f.stamp.scale.set(s, s, 1)
          f.stamp.material.rotation = -f.obj.rotation.z
        }
        if (Math.random() < 0.8) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0, _c.copy(f.color).multiplyScalar(2), rnd(0.15, 0.3), rnd(0.25, 0.45), 0, 1)
        if (f.t >= 1) f.done()
      }
      this.flights = this.flights.filter((f) => f.t < 1)
    }

    // ring bursts
    for (const r of this.ringPool) {
      if (!r.s.visible) continue
      r.t += dt
      const k = r.t / r.life
      if (k >= 1) {
        r.s.visible = false
        continue
      }
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) ** 2)
      r.s.scale.set(s * 2, s * 2, 1)
      r.s.material.opacity = (1 - k) ** 1.5
    }

    if (this.feast.length) this.updateFeast(dt)

    // coin shower
    if (this.shower > 0) {
      this.shower -= real
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
      const n = Math.random() < (real * 80) % 1 ? Math.ceil(real * 80) : Math.floor(real * 80)
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const depth = this.camera.position.z - z
        const hw = tan * depth * this.camera.aspect
        const top = this.camY + tan * depth
        this.coins.emit(new THREE.Vector3(rnd(-hw, hw), top + 0.4, z), new THREE.Vector3(rnd(-0.6, 0.6), rnd(-4, -1), 0), WHITE, rnd(0.8, 1.2), 2.6, -7, rnd(5, 13))
      }
      if (this.onCoin && this.clock - this.coinAt > 0.11) {
        this.coinAt = this.clock
        this.onCoin()
      }
    }

    if (this.flies.list.length < 26 && Math.random() < real * 5) {
      const side = Math.random() < 0.5 ? -1 : 1
      const c = _c.set(Math.random() < 0.6 ? '#d9ff7a' : '#7affe1').multiplyScalar(1.6 + this.free)
      this.flies.emit(side * rnd(IN_W + 0.4, IN_W + 3), rnd(-3.2, 0.5), -1.2, rnd(-0.15, 0.15), rnd(0.05, 0.25), 0, c, rnd(0.1, 0.2), rnd(3, 6), 0, 0, 0)
    }
    this.flies.update(real)
    this.sparks.update(dt)
    this.crumbs.update(dt)
    this.coins.update(real)
    this.confetti.update(real)

    if (this.conds.some((c) => c.test())) {
      const done = this.conds.filter((c) => c.test())
      this.conds = this.conds.filter((c) => !done.includes(c))
      for (const c of done) c.fn()
    }
  }

  private animate(p: Piece, dt: number, real: number, T: number) {
    const t = T + p.phase
    p.win += (p.winTo - p.win) * Math.min(1, dt * 9)
    if (p.win < 0.002 && p.winTo === 0) p.win = 0
    p.open += (p.openTo - p.open) * Math.min(1, dt * 10)
    p.shake = Math.max(0, p.shake - dt * 4)
    p.gulp = Math.max(0, p.gulp - dt * 3.2)
    p.squish = Math.max(0, p.squish - dt * 3)
    if (p.openTo === 0 && p.bites > 0) p.bites = Math.max(0, p.bites - dt * 6)
    const spinning = this.reels[p.col]?.state !== 'idle' && !p.fall

    // a wild dropping in
    if (p.fall) {
      p.fall.vy -= 40 * dt
      p.fall.y += p.fall.vy * dt
      if (p.fall.y <= 0) {
        p.fall.y = 0
        if (-p.fall.vy * 0.3 > 1.5 && p.fall.bounces < 3) {
          p.fall.vy = -p.fall.vy * 0.3
          p.fall.bounces++
          p.shake = 1
        } else p.fall = null
      }
      p.inner.position.y = p.fall ? p.fall.y : 0
    }

    // knocked out by a sneaking wild, or hatched
    if (p.dying > 0 || p.pop > 0) {
      const k = p.dying > 0 ? (p.dying = Math.max(0, p.dying - dt * 3)) : (p.pop = Math.max(0.0001, p.pop - dt * 3))
      p.inner.scale.setScalar(Math.max(0.001, k) * CAST)
      p.glow.visible = false
      return
    }

    // breathing, a little bob, and a squash when the reel lands
    const lift = p.win * 0.45
    const hop = p.win * Math.abs(Math.sin(t * 6.5)) * 0.07
    const squash = p.shake * Math.sin(p.shake * Math.PI * 3) * 0.12
    if (!p.fall) p.inner.position.set(0, Math.sin(t * 1.6) * 0.012 + hop, lift)
    if (!spinning) {
      const breathe = Math.sin(t * 2.1) * 0.02
      let sx = 1 + p.win * 0.12
      let sy = sx
      // a wild's belly swells with every bite and bounces as it swallows
      if (p.bites > 0 || p.gulp > 0) {
        const belly = Math.min(0.24, p.bites * 0.05)
        const bounce = p.gulp * Math.sin(p.gulp * Math.PI * 3) * (0.1 + Math.min(0.12, p.bites * 0.025))
        sx *= 1 + belly + bounce
        sy *= 1 + belly * 0.45 - bounce * 0.6
      }
      // a donut being eaten squishes
      if (p.squish > 0) {
        const s = Math.sin(p.squish * Math.PI * 2) * p.squish * 0.18
        sx *= 1 + s
        sy *= 1 - s
      }
      // a gummy wobbles like jelly
      if (p.sym === 'gummy') {
        const j = Math.sin(t * (4.5 + p.win * 7)) * (0.03 + p.win * 0.07)
        sx *= 1 + j
        sy *= 1 - j
      }
      p.inner.scale.set(CAST * sx * (1 - breathe * 0.5 + squash * 0.6), CAST * sy * (1 + breathe - squash), CAST * sx)
    }
    const wiggle = p.win * Math.sin(t * 11) * 0.09
    p.inner.rotation.z = wiggle + (p.sym === 'donut' ? Math.sin(t * 0.9) * 0.12 : 0) + (p.sym === 'egg' ? Math.sin(t * (p.win > 0.5 ? 26 : 3)) * (0.03 + p.win * 0.1) : 0)
    p.inner.rotation.y = p.sym === 'cookie' ? Math.sin(t * 0.8) * 0.15 + p.win * Math.sin(t * 6.5) * 0.5 : Math.sin(t * 0.7) * 0.1

    // glow behind winners
    const ga = p.win * (0.45 + 0.15 * Math.sin(T * 9))
    p.glow.material.opacity = ga
    p.glow.visible = ga > 0.004
    const gs = 1.4 + p.win * 0.25
    p.glow.scale.set(gs, gs, 1)
    if (p.win > 0.5 && Math.random() < dt * 10) {
      const c = _c.set(SYMBOL_COLOR[p.sym]).multiplyScalar(2)
      const at = this.worldOf(p)
      this.sparks.emit(at.x + rnd(-0.4, 0.4), at.y + rnd(-0.4, 0.4), at.z + 0.7, rnd(-0.3, 0.3), rnd(0.3, 1.2), 0, c, rnd(0.1, 0.22), rnd(0.4, 0.8), 0, 1)
    }

    // the snacks' win face
    if (p.joy) {
      const on = p.win > 0.45
      if (p.joy.visible !== on) {
        p.joy.visible = on
        for (const e of p.eyes) e.visible = !on
      }
    }

    // eyes: blink now and then, look towards the mouse
    if (T > p.blinkAt) {
      p.blink = 1
      p.blinkAt = T + rnd(1.8, 5.5)
    }
    p.blink = Math.max(0, p.blink - real * 7)
    const lid = p.blink > 0 ? Math.max(0.08, Math.abs(p.blink * 2 - 1)) : 1
    for (const e of p.eyes) e.scale.y = lid
    const lx = this.look.x * p.look
    const ly = -this.look.y * p.look
    for (const pu of p.pupils) pu.position.set(lx, ly, 0)

    // mouth: opens when winning or eating, snaps shut for each bite
    if (p.mouth) {
      p.chompT = Math.min(1, p.chompT + dt * 5)
      const bite = p.chompT < 1 ? Math.sin(p.chompT * Math.PI) : 0
      const open = 1 + p.win * 0.25 + p.open * 0.55
      p.mouth.scale.set(1 + p.open * 0.12, Math.max(0.12, open * (1 - bite * 0.85)), 1)
    }
    for (const w of p.wings) {
      const s = w.name === 'wingL' ? 1 : -1
      w.rotation.y = s * (0.25 + 0.3 * Math.sin(t * (7 + p.win * 9)))
    }
    if (p.stalks) p.stalks.children.forEach((c, i) => (c.rotation.z = (i - 1) * -0.35 + Math.sin(t * 2.2 + i) * (0.08 + p.win * 0.15)))
    if (p.crown) p.crown.position.y = 0.37 + Math.abs(Math.sin(t * 3)) * 0.015 + p.win * Math.abs(Math.sin(t * 6.5)) * 0.04
    if (p.halo) p.halo.scale.setScalar(1.1 + 0.1 * Math.sin(t * 2.4) + p.win * 0.6)
    // the snacks' own little moves
    if (p.cherry) {
      const rest = p.cherry.userData.rest as { y: number }
      p.cherry.rotation.z = Math.sin(t * 2.3) * 0.14
      p.cherry.position.y = rest.y + p.win * Math.abs(Math.sin(t * 7)) * 0.07
    }
    if (p.swirl) p.swirl.rotation.z -= dt * (0.5 + p.win * 7)
    for (const w of p.wraps) {
      const s = w.name === 'wrapL' ? -1 : 1
      w.rotation.x = Math.sin(t * 3.1 + s) * 0.3 + p.win * Math.sin(t * 15) * 0.45
      w.rotation.z = s * Math.sin(t * 2.3) * 0.08
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerleave', this.onLeave)
    for (const p of [...this.live]) this.release(p)
    for (const list of this.pool.values()) for (const p of list) p.glow.material.dispose()
    // let anything awaiting the scene finish, so the screen code can unwind
    for (const t of this.timers) if (!t.job) t.fn()
    for (const c of this.conds) c.fn()
    for (const f of this.flights) f.done()
    for (const r of this.reels) r.done?.()
    this.timers = []
    this.conds = []
    this.flights = []
    this.feastClear()
    for (const b of this.beams) b.sprite.material.dispose()
    for (const o of this.own) o.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/* ------------------------------------------------------------------ */
/*  Frame decoration                                                    */
/* ------------------------------------------------------------------ */

let frameRamp: THREE.DataTexture | null = null
function toonRampFrame() {
  if (frameRamp) return frameRamp
  const d = new Uint8Array([96, 168, 226, 255])
  frameRamp = new THREE.DataTexture(d, d.length, 1, THREE.RedFormat)
  frameRamp.minFilter = THREE.NearestFilter
  frameRamp.magFilter = THREE.NearestFilter
  frameRamp.generateMipmaps = false
  frameRamp.needsUpdate = true
  return frameRamp
}

/** green slime over the top bar of the frame, with drips that sway */
function buildSlime() {
  const g = new THREE.Group()
  const W = IN_W + RIM + 0.06
  const green = new THREE.MeshToonMaterial({ color: '#35e07f', gradientMap: toonRampFrame(), emissive: '#0d6b36', emissiveIntensity: 0.25 })
  const inkMat = new THREE.MeshBasicMaterial({ color: '#1d0f30' })
  const dripInk = new THREE.MeshBasicMaterial({ color: '#1d0f30', side: THREE.BackSide })
  const shine = new THREE.MeshBasicMaterial({ color: '#d8ffe9' })
  // the band: a rounded bar along the top
  const band = new THREE.Shape()
  band.moveTo(-W, 0.06)
  band.quadraticCurveTo(-W, 0.17, -W + 0.12, 0.17)
  band.lineTo(W - 0.12, 0.17)
  band.quadraticCurveTo(W, 0.17, W, 0.06)
  // a wavy underside
  const N = 22
  for (let i = 0; i <= N; i++) {
    const x = W - (2 * W * i) / N
    band.lineTo(x, -0.06 + 0.035 * Math.sin(i * 1.9))
  }
  band.closePath()
  const opts = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 3, curveSegments: 10 }
  g.add(new THREE.Mesh(new THREE.ExtrudeGeometry(band, opts), green))
  const bandInk = new THREE.Mesh(new THREE.ExtrudeGeometry(band, { ...opts, depth: 0.02, bevelSize: 0.06 }), inkMat)
  bandInk.position.z = -0.04
  g.add(bandInk)
  // drips
  const drips: [number, number][] = [
    [-2.55, 0.18],
    [-1.9, 0.3],
    [-1.25, 0.14],
    [-0.45, 0.24],
    [0.3, 0.34],
    [1.0, 0.16],
    [1.7, 0.27],
    [2.45, 0.2],
  ]
  for (const [x, len] of drips) {
    const d = new THREE.Group()
    d.name = 'drip'
    d.position.set(x, -0.02, 0.05)
    const body = new THREE.CapsuleGeometry(0.05, len, 6, 14)
    body.translate(0, -len / 2, 0)
    const m = new THREE.Mesh(body, green)
    const inkGeo = new THREE.CapsuleGeometry(0.068, len, 6, 14)
    inkGeo.translate(0, -len / 2, -0.02)
    const ink = new THREE.Mesh(inkGeo, dripInk)
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), shine)
    sp.position.set(-0.02, -len * 0.55, 0.045)
    d.add(ink, m, sp)
    g.add(d)
  }
  // highlights on the band
  for (let i = 0; i < 7; i++) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), shine)
    s.scale.set(2.2, 0.8, 0.5)
    s.position.set(-2.6 + i * 0.85 + (i % 2) * 0.2, 0.1, 0.11)
    g.add(s)
  }
  return { group: g, green }
}

/** gold bolts round the frame */
function buildBolts() {
  const g = new THREE.Group()
  const bolt = new THREE.MeshToonMaterial({ color: '#ffc93d', gradientMap: toonRampFrame() })
  const boltGeo = new THREE.SphereGeometry(0.07, 16, 10)
  boltGeo.scale(1, 1, 0.5)
  const spots: [number, number][] = [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
  ]
  for (const [sx, sy] of spots) {
    const b = new THREE.Mesh(boltGeo, bolt)
    b.position.set(sx * (IN_W + RIM * 0.5), sy * (IN_H + RIM * 0.5), FRAME_FRONT + 0.03)
    g.add(b)
  }
  return g
}
