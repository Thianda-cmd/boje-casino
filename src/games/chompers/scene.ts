import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { AutoQuality, Bits, Sparks, glowTexture, ring, rnd } from '../../lib/three/fx'
import { COLS, ROWS, fillerSym, type Cell, type Grid, type Sym } from './rules'
import { SYMBOL_COLOR, donutColor } from './meta'
import { allMaterials, buildSymbol, labelMesh, symbolMaterials, warmUp } from './models'

/*
  The Chompers stage: five reels on a drum behind a cartoon frame dripping with slime, under a night sky.
  Reels spin, slow down and settle with a little bounce; anticipation reels glow and hold on. Winners hop
  forward while the rest dim, wilds open wide and chomp the donuts, eggs hatch into free spins.
  Like the gem slot, everything runs on the scene clock, so turbo and "hurry" speed the whole show up.
*/

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
const FIT_W = 7.2
const FIT_H = 6.5
const CAM_Y = 0.32
const FOV = 30
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), IN_H - 0.01), new THREE.Plane(new THREE.Vector3(0, 1, 0), IN_H - 0.01)]

export const cellX = (c: number) => (c - (COLS - 1) / 2) * SX
/** row r (0 at the top) as an offset from the middle, in rows */
const rowU = (r: number) => (ROWS - 1) / 2 - r

const KICK = 0.13
const SPEED = 27
const BACK = 0.9
const easeOutBack = (t: number) => 1 + (BACK + 1) * (t - 1) ** 3 + BACK * (t - 1) ** 2

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
  wings: THREE.Object3D[]
  stalks: THREE.Object3D | null
  crown: THREE.Object3D | null
  halo: THREE.Sprite | null
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
  done: () => void
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
  // moon up on the left, or a low sun in free spins
  vec2 mc = vec2(-0.3 * uAspect, 0.33 - uFree * 0.1);
  float md = length(p - mc);
  vec3 moon = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.82, 0.45), uFree);
  col += moon * 0.3 * exp(-md * md * 14.0);
  col = mix(col, moon, smoothstep(0.072, 0.069, md));
  col = mix(col, moon * 0.86, smoothstep(0.018, 0.015, length(p - mc - vec2(-0.02, 0.018))) * (1.0 - uFree));
  col = mix(col, moon * 0.88, smoothstep(0.012, 0.009, length(p - mc - vec2(0.025, -0.02))) * (1.0 - uFree));
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
  // glowing mushrooms along the middle hill
  for (int i = 0; i < 6; i++) {
    // only out to the sides, where the frame does not hide them
    float fi = float(i);
    float side = i < 3 ? -1.0 : 1.0;
    float mx = side * (0.47 + mod(fi, 3.0) * 0.16) * uAspect + 0.04 * sin(fi * 2.3);
    float sz = 0.022 + 0.012 * hash(vec2(fi, 3.1));
    float my = hill(mx, -0.29, 0.045, 4.3, 0.02, 9.1, t * 0.035 + 2.0);
    vec2 q = p - vec2(mx, my);
    vec3 mcol = mod(fi, 3.0) < 1.0 ? vec3(0.35, 0.95, 1.0) : (mod(fi, 3.0) < 2.0 ? vec3(1.0, 0.45, 0.85) : vec3(0.55, 1.0, 0.5));
    float stem = step(abs(q.x), sz * 0.28) * step(-0.01, q.y) * step(q.y, sz * 1.5);
    vec2 cq = (q - vec2(0.0, sz * 1.5)) / vec2(sz * 1.15, sz * 0.8);
    float cap = step(length(cq), 1.0) * step(0.0, cq.y);
    float glow = exp(-dot(cq, cq) * 0.55) * (0.75 + 0.25 * sin(t * 2.0 + fi * 1.7));
    col += mcol * glow * 0.22;
    col = mix(col, mix(vec3(0.3, 0.2, 0.45), vec3(0.6, 0.35, 0.45), uFree), stem);
    col = mix(col, mcol * (0.7 + 0.35 * cq.y), cap);
    float spots = step(length(cq - vec2(-0.4, 0.4)), 0.17) + step(length(cq - vec2(0.3, 0.55)), 0.13) + step(length(cq - vec2(0.05, 0.2)), 0.1);
    col = mix(col, vec3(1.0, 0.97, 1.0), cap * min(1.0, spots) * 0.85);
  }
  col = layer(col, p, hill(x, -0.39, 0.04, 5.2, 0.018, 11.0, t * 0.05 + 4.0), mix(vec3(0.07, 0.03, 0.17), vec3(0.25, 0.07, 0.2), uFree), mix(vec3(0.2, 0.09, 0.36), vec3(0.5, 0.18, 0.3), uFree));
  col *= 1.0 - 0.35 * smoothstep(0.45, 1.0, length(p * vec2(0.7, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`

/** the reel bed: one column per reel, darker towards the top and bottom like a drum */
function reelTexture() {
  const PX = 140
  const c = document.createElement('canvas')
  c.width = Math.round(IN_W * 2 * PX)
  c.height = Math.round(IN_H * 2 * PX)
  const g = c.getContext('2d')!
  g.fillStyle = '#1a0a33'
  g.fillRect(0, 0, c.width, c.height)
  for (let col = 0; col < COLS; col++) {
    const cx = (cellX(col) + IN_W) * PX
    const w = SX * PX - 10
    const grad = g.createLinearGradient(0, 0, 0, c.height)
    grad.addColorStop(0, '#24104a')
    grad.addColorStop(0.5, '#4a2690')
    grad.addColorStop(1, '#24104a')
    g.beginPath()
    g.roundRect(cx - w / 2, 6, w, c.height - 12, 18)
    g.fillStyle = grad
    g.fill()
    g.strokeStyle = 'rgba(255,255,255,0.06)'
    g.lineWidth = 3
    g.stroke()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/* ------------------------------------------------------------------ */
/*  The scene                                                           */
/* ------------------------------------------------------------------ */

const PREVIEW: Sym[] = ['grumbo', 'fang', 'blip', 'mimi', 'A', 'K', 'Q', 'J', 'T', 'wild', 'egg', 'donut']

export class ChompScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** a reel came to rest, showing these symbols top to bottom */
  onReelStop?: (col: number, syms: Sym[]) => void
  onCoin?: () => void
  /** what a donut worth `value` times the bet says on its label */
  donutText: (value: number) => string = (v) => `${v}×`
  thumbs: Partial<Record<Sym, string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
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
  private flights: Flight[] = []
  private beams: { col: number; sprite: THREE.Sprite; on: number }[] = []
  private timers: { at: number; fn: () => void }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []

  private readonly backMat: THREE.ShaderMaterial
  private readonly dimMat: THREE.MeshBasicMaterial
  private readonly lip: THREE.MeshBasicMaterial
  private readonly frameMat: THREE.MeshToonMaterial
  private readonly slime: THREE.Group
  /** the frame is a monster too: two big eyes peering over the top at the reels */
  private readonly peepers: Peeper[]
  private peepAt = new THREE.Vector2(0, -0.5)
  private peepWatch: THREE.Vector3 | null = null
  private peepBlink = 0
  private peepBlinkAt = 2
  private peepPop = 0
  private peepDart = new THREE.Vector2()
  private peepDartAt = 0

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new AutoQuality()
  private drewLast = false
  private dist = 14
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

  constructor(private readonly host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.08
    this.renderer.localClippingEnabled = true
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    host.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.45, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    const key = new THREE.DirectionalLight('#ffffff', 2.2)
    key.position.set(-3, 5, 6)
    this.ambient = new THREE.AmbientLight('#b9a8ff', 0.95)
    this.scene.add(key, this.ambient)

    // sky
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uFree: { value: 0 }, uAspect: { value: 1 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    const backGeo = new THREE.PlaneGeometry(2, 2)
    const back = new THREE.Mesh(backGeo, this.backMat)
    back.frustumCulled = false
    back.renderOrder = -10
    this.scene.add(back)
    this.own.push(backGeo, this.backMat)

    // reel bed
    const bedTex = reelTexture()
    const bedMat = new THREE.MeshBasicMaterial({ map: bedTex })
    const bedGeo = new THREE.PlaneGeometry(IN_W * 2, IN_H * 2)
    const bed = new THREE.Mesh(bedGeo, bedMat)
    bed.position.z = FRAME_BACK + 0.02
    this.scene.add(bed)
    this.own.push(bedTex, bedMat, bedGeo)

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

    // slime on top of the frame, horns on the corners, bolts
    this.slime = buildSlime()
    this.slime.position.set(0, IN_H + RIM - 0.02, FRAME_FRONT + 0.06)
    this.scene.add(this.slime)
    const deco = buildDeco()
    this.scene.add(deco)
    const peep = buildPeepers(this.frameMat)
    this.peepers = peep.eyes
    this.scene.add(peep.group)
    for (const g of [this.slime, deco, peep.group])
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) this.own.push(o.geometry, o.material as THREE.Material)
      })

    // crumbs, coins, confetti
    const crumbGeo = new THREE.DodecahedronGeometry(0.05, 0)
    const crumbMat = new THREE.MeshToonMaterial({ gradientMap: toonRampFrame() })
    this.crumbs = new Bits(crumbGeo, crumbMat, 300, true)
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

    for (let c = 0; c < COLS; c++) this.reels.push({ col: c, pos: 0, v: 0, state: 'idle', t: 0, from: 0, to: 0, dur: 1, stopAt: 0, speed: SPEED, tease: false, slots: new Map(), targets: new Map(), land: [], free: false, done: null })

    this.onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const r = cv.getBoundingClientRect()
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1)
    }
    this.onLeave = () => this.pointer.set(0, 0)
    host.addEventListener('pointermove', this.onMove)
    host.addEventListener('pointerleave', this.onLeave)

    const r0 = host.getBoundingClientRect()
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
    // one of everything, out of sight, so every shader is compiled before the first spin
    const warm = new THREE.Group()
    const temp: Piece[] = []
    for (const s of PREVIEW)
      for (const v of s === 'donut' ? [2, 10, 20, 50, 100] : [0]) {
        const p = this.acquire(s, v, -1)
        temp.push(p)
        this.scene.remove(p.root)
        warm.add(p.root)
      }
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    this.crumbs.emit(new THREE.Vector3(0, 0, -30), new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
    this.coins.emit(new THREE.Vector3(0, 0, -30), new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
    this.confetti.emit(new THREE.Vector3(0, 0, -30), new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.crumbs.update(0)
    this.coins.update(0)
    this.confetti.update(0)
    this.sparks.update(0)
    try {
      await this.renderer.compileAsync(this.scene, this.camera)
    } catch {
      /* compiles on first draw instead */
    }
    if (this.disposed) return
    await step(0.8)
    if (this.disposed) return
    this.composer.render()
    this.scene.remove(warm)
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

  /** small transparent pictures of each symbol, for the paytable */
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
    cam.position.set(0, 0, 2.6)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')!
    const css = size / this.dpr
    const res: Partial<Record<Sym, string>> = {}
    const clear = r.getClearColor(new THREE.Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setScissorTest(true)
    r.setViewport(0, 0, css, css)
    r.setScissor(0, 0, css, css)
    for (const s of PREVIEW) {
      const o = buildSymbol(s, 25)
      o.traverse((x) => x.name === 'halo' && (x.visible = false))
      ts.add(o)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[s] = out.toDataURL('image/png')
      ts.remove(o)
    }
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
    this.placeCamera()
    const scale = (h * this.dpr) / (2 * tan)
    this.sparks.mat.uniforms.scale.value = scale
    this.backMat.uniforms.uAspect.value = w / h
    if (this.raf) this.composer.render()
  }

  private placeCamera() {
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    const sy = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.12 : 0
    this.camera.position.set(this.look.x * 0.3 + sx, CAM_Y - this.look.y * 0.2 + sy, this.dist)
    this.camera.lookAt(sx * 0.5, CAM_Y + sy * 0.5, 0)
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

  wait(s: number) {
    return new Promise<void>((r) => this.timers.push({ at: this.time + s, fn: r }))
  }

  private until(test: () => boolean) {
    return new Promise<void>((r) => this.conds.push({ test, fn: r }))
  }

  setFree(on: boolean) {
    this.freeTo = on ? 1 : 0
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
    p.phase = Math.random() * 10
    p.blinkAt = this.clock + rnd(0.5, 4)
    p.root.visible = true
    p.inner.scale.setScalar(1)
    p.inner.position.set(0, 0, 0)
    p.inner.rotation.set(0, 0, 0)
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
      wings: [...named('wingL'), ...named('wingR')],
      stalks: named('stalks')[0] ?? null,
      crown: named('crown')[0] ?? null,
      halo: (named('halo')[0] as THREE.Sprite) ?? null,
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
    let list = this.pool.get(p.key)
    if (!list) this.pool.set(p.key, (list = []))
    list.push(p)
  }

  /** where a piece sits on its reel: u rows from the middle, on the drum */
  private place(p: Piece, u: number) {
    p.u = u
    p.root.position.set(cellX(p.col), uY(u), uZ(u))
    p.root.rotation.x = -(u * SY) / DRUM
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
   * Spins all reels and lands `grid`. Reels from `teaseFrom` on hold back and glow, one after another.
   * Resolves when every reel is at rest.
   */
  async spin(grid: Grid, free: boolean, teaseFrom = -1) {
    this.dimTo = 0
    for (const p of this.live) p.winTo = 0
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
        const syms = Array.from({ length: ROWS }, (_, row) => r.slots.get(r.to + ROWS - 1 - row)?.sym ?? 'A')
        for (const p of r.slots.values()) {
          p.shake = 1
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
      this.place(p, k - r.pos - (ROWS - 1) / 2)
    }
    // motion blur: stretch while fast
    const stretch = 1 + Math.min(0.3, Math.abs(r.v) / 90) * (r.state === 'spin' ? 1 : Math.max(0, 1 - r.t / Math.max(0.01, r.dur * 0.5)))
    for (const p of r.slots.values()) p.inner.scale.y = stretch
  }

  /** the piece showing a cell, by id */
  private piece(id: number) {
    return this.byId.get(id) ?? null
  }

  /* ---------------- features ---------------- */

  /** winners hop forward and dance while everything else dims */
  async highlight(ids: number[], dur = 1.1) {
    this.dimTo = 1
    this.watch(ids)
    for (const id of ids) {
      const p = this.piece(id)
      if (p) p.winTo = 1
    }
    await this.wait(dur)
  }

  clearHighlight() {
    this.dimTo = 0
    this.peepWatch = null
    for (const p of this.live) p.winTo = 0
  }

  /** eggs glow and shake; with `hatch` they burst open */
  async eggs(ids: number[], hatch: boolean) {
    const ps = ids.map((id) => this.piece(id)).filter((p): p is Piece => !!p)
    this.dimTo = 1
    this.watch(ids)
    for (const p of ps) p.winTo = 1
    await this.wait(hatch ? 1.1 : 0.9)
    if (hatch) {
      for (const p of ps) {
        const at = this.worldOf(p)
        this.sparks.emit(at.x, at.y, at.z + 0.4, 0, 0, 0, new THREE.Color('#ffd96a').multiplyScalar(2.6), 1.8, 0.35, 0, 0, 0.9)
        this.sparks.burst(at, new THREE.Color('#ffd96a'), 22, 5)
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2
          const s = rnd(2, 6)
          this.crumbs.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 2, rnd(1, 4)), new THREE.Color(i % 3 ? '#fff4dc' : '#a55bff'), rnd(1, 1.8), rnd(0.8, 1.2), -14)
        }
        p.pop = 1
      }
      this.confettiBurst(60)
      this.shake = 0.5
      await this.wait(0.5)
    }
    this.clearHighlight()
  }

  /** a hungry wild drops in from above onto a cell, knocking out what was there */
  async sneak(col: number, row: number, cell: Cell, replaced: Cell) {
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
    await this.until(() => !p.fall)
    if (old) {
      r.slots.delete(k)
      this.release(old)
    }
    r.slots.set(k, p)
    this.shake = 0.6
    this.peepPop = 1
    const at = this.worldOf(p)
    this.sparks.burst(at, new THREE.Color(SYMBOL_COLOR.wild), 18, 4)
    await this.wait(0.3)
  }

  /**
   * The wild opens wide and every donut sends a copy of itself flying into its mouth, one after another.
   * `hit` is called as each one lands; `mult` shows on the way in when it is above 1.
   */
  async collect(wildId: number, donutIds: number[], hit: (i: number) => void) {
    const w = this.piece(wildId)
    if (!w) return
    this.dimTo = 1
    this.watch([wildId])
    w.winTo = 1
    w.openTo = 1
    const ds = donutIds.map((id) => this.piece(id)).filter((p): p is Piece => !!p)
    for (const d of ds) d.winTo = 1
    await this.wait(0.45)
    const mouth = this.worldOf(w).add(new THREE.Vector3(0, -0.08, 0.7))
    const flights: Promise<void>[] = []
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i]
      const from = this.worldOf(d).add(new THREE.Vector3(0, 0, 0.6))
      const ghost = buildSymbol('donut', d.value)
      const l = labelMesh(this.donutText(d.value), donutColor(d.value))
      l.position.set(0, -0.24, 0.32)
      ghost.add(l)
      ghost.position.copy(from)
      ghost.scale.setScalar(0.9)
      ghost.renderOrder = 12
      this.scene.add(ghost)
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
            dur: 0.5,
            obj: ghost,
            color,
            done: () => {
              this.scene.remove(ghost)
              ;(l.material as THREE.Material).dispose()
              w.chompT = 0
              const at = mouth.clone()
              this.sparks.burst(at, color, 12, 3.5, 0.2, 0.6)
              for (let j = 0; j < 9; j++) {
                const a = Math.random() * Math.PI * 2
                const s = rnd(1.5, 4.5)
                this.crumbs.emit(at, new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + 1.5, rnd(1, 3)), new THREE.Color(j % 2 ? '#e9a656' : donutColor(d.value)), rnd(0.6, 1.1), rnd(0.6, 1), -12)
              }
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
    this.clearHighlight()
    await this.wait(0.2)
  }

  /** the meter filled: flash, confetti */
  async levelUp() {
    this.peepPop = 1
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
      this.confetti.emit(new THREE.Vector3(rnd(-hw, hw), CAM_Y + tan * depth + rnd(0, 1.5), z), new THREE.Vector3(rnd(-1, 1), rnd(-3, -0.5), 0), new THREE.Color(pal[i % pal.length]), rnd(0.8, 1.4), rnd(2.5, 3.5), -3, rnd(4, 10))
    }
  }

  /** gold coins rain down in front of the machine */
  coinShower(seconds = 2.5) {
    this.shower = Math.max(this.shower, seconds)
  }

  stopShower() {
    this.shower = 0
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

  /** the frame's eyes turn to look at these symbols */
  private watch(ids: number[]) {
    const at = new THREE.Vector3()
    let n = 0
    for (const id of ids) {
      const p = this.piece(id)
      if (!p) continue
      at.add(this.worldOf(p))
      n++
    }
    if (!n) return
    this.peepWatch = at.divideScalar(n)
    this.peepPop = Math.max(this.peepPop, 0.6)
  }

  private updatePeepers(real: number) {
    const T = this.clock
    const spinning = this.reels.some((r) => r.state !== 'idle')
    const target = new THREE.Vector2()
    if (this.peepWatch) {
      // turn towards the symbols: right/left by where they are, down by how far below the eyes
      target.set(THREE.MathUtils.clamp(this.peepWatch.x / 2.6, -1, 1), THREE.MathUtils.clamp((this.peepWatch.y - IN_H) / 3.2, -1, -0.15))
    } else if (spinning) {
      // following the reels round and round
      target.set(Math.cos(T * 7) * 0.75, -0.35 + Math.sin(T * 7) * 0.45)
    } else {
      if (T > this.peepDartAt) {
        this.peepDart.set(rnd(-0.75, 0.75), rnd(-0.55, 0.15))
        this.peepDartAt = T + rnd(0.8, 2.6)
      }
      target.set(this.look.x * 0.8, -this.look.y * 0.6 - 0.15)
      if (this.pointer.lengthSq() === 0) target.copy(this.peepDart)
    }
    this.peepAt.lerp(target, Math.min(1, real * (spinning ? 14 : 9)))
    if (T > this.peepBlinkAt) {
      this.peepBlink = 1
      this.peepBlinkAt = T + rnd(2.2, 5.5)
    }
    this.peepBlink = Math.max(0, this.peepBlink - real * 6.5)
    this.peepPop = Math.max(0, this.peepPop - real * 2.2)
    const lid = this.peepBlink > 0 ? Math.max(0.06, Math.abs(this.peepBlink * 2 - 1)) : 1
    const pop = 1 + Math.sin(this.peepPop * Math.PI) * 0.16
    for (const e of this.peepers) {
      e.ball.scale.set(pop, pop * lid, pop)
      e.iris.rotation.set(-this.peepAt.y * 0.62, this.peepAt.x * 0.62, 0)
      e.root.position.y = e.y + Math.sin(T * 1.7 + e.phase) * 0.02 + (this.peepWatch ? Math.abs(Math.sin(T * 6)) * 0.03 : 0)
    }
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
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.composer.render()
  }

  private update(dt: number, real: number) {
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time)
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.time)
        for (const t of due) t.fn()
      }
    }

    // mood
    this.free += (this.freeTo - this.free) * Math.min(1, real * 2)
    if (Math.abs(this.free - this.freeTo) < 0.002) this.free = this.freeTo
    this.dim += (this.dimTo - this.dim) * Math.min(1, dt * 8)
    if (Math.abs(this.dim - this.dimTo) < 0.003) this.dim = this.dimTo
    this.backMat.uniforms.uTime.value = this.clock
    this.backMat.uniforms.uFree.value = this.free
    this.dimMat.opacity = this.dim * 0.55
    this.lip.color.set('#ff7ad1').lerp(new THREE.Color('#ffcf3a'), this.free).multiplyScalar(1.5 + 0.25 * Math.sin(this.clock * 2.6))
    this.frameMat.color.set('#7d45e8').lerp(new THREE.Color('#e8457d'), this.free * 0.55)
    this.ambient.color.set('#b9a8ff').lerp(new THREE.Color('#ffc2a8'), this.free)
    this.slime.children.forEach((d, i) => {
      if (d.name === 'drip') d.scale.y = 1 + 0.08 * Math.sin(this.clock * 1.6 + i * 1.3)
    })

    this.updatePeepers(real)

    // camera: drifts towards the mouse, shakes on big hits
    this.shake = Math.max(0, this.shake - real * 2.2)
    this.look.lerp(this.pointer, Math.min(1, real * 3))
    this.placeCamera()

    for (const r of this.reels) this.updateReel(r, dt)

    // pieces
    const T = this.clock
    for (const p of this.live) this.animate(p, dt, real, T)

    // anticipation beams fade once their reel stops
    if (this.beams.length) {
      for (const b of this.beams) {
        const r = this.reels[b.col]
        if (r.state === 'idle') b.on -= dt * 3
        b.sprite.material.opacity = Math.max(0, b.on) * (0.5 + 0.25 * Math.sin(this.clock * 12))
        if (r.state !== 'idle' && Math.random() < dt * 30) this.sparks.emit(cellX(b.col) + rnd(-0.5, 0.5), -IN_H, 0.3, 0, rnd(2, 4), 0, new THREE.Color('#ffcf3a').multiplyScalar(2), rnd(0.12, 0.25), rnd(0.6, 1), 0, 0.5)
        if (b.on <= 0) {
          this.scene.remove(b.sprite)
          b.sprite.material.dispose()
        }
      }
      this.beams = this.beams.filter((b) => b.on > 0)
    }

    // donuts flying into a mouth
    if (this.flights.length) {
      const pos = new THREE.Vector3()
      for (const f of this.flights) {
        f.t = Math.min(1, f.t + dt / f.dur)
        const e = f.t * f.t * (3 - 2 * f.t)
        const a = 1 - e
        pos.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * e).addScaledVector(f.to, e * e)
        f.obj.position.copy(pos)
        f.obj.rotation.z += dt * 9
        f.obj.scale.setScalar(0.9 * (1 - 0.65 * e))
        if (Math.random() < 0.8) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0, f.color.clone().multiplyScalar(2), rnd(0.15, 0.3), rnd(0.25, 0.45), 0, 1)
        if (f.t >= 1) f.done()
      }
      this.flights = this.flights.filter((f) => f.t < 1)
    }

    // coin shower
    if (this.shower > 0) {
      this.shower -= real
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
      const n = Math.random() < (real * 80) % 1 ? Math.ceil(real * 80) : Math.floor(real * 80)
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const depth = this.camera.position.z - z
        const hw = tan * depth * this.camera.aspect
        const top = CAM_Y + tan * depth
        this.coins.emit(new THREE.Vector3(rnd(-hw, hw), top + 0.4, z), new THREE.Vector3(rnd(-0.6, 0.6), rnd(-4, -1), 0), new THREE.Color(1, 1, 1), rnd(0.8, 1.2), 2.6, -7, rnd(5, 13))
      }
      if (this.onCoin && this.clock - this.coinAt > 0.11) {
        this.coinAt = this.clock
        this.onCoin()
      }
    }

    if (this.flies.list.length < 26 && Math.random() < real * 5) {
      const side = Math.random() < 0.5 ? -1 : 1
      const c = new THREE.Color(Math.random() < 0.6 ? '#d9ff7a' : '#7affe1').multiplyScalar(1.6 + this.free)
      this.flies.emit(side * rnd(IN_W + 0.4, IN_W + 3), rnd(-3.2, 0.5), -1.2, rnd(-0.15, 0.15), rnd(0.05, 0.25), 0, c, rnd(0.1, 0.2), rnd(3, 6), 0, 0, 0)
    }
    this.flies.update(real)
    this.sparks.update(dt)
    this.crumbs.update(dt)
    this.coins.update(real)
    this.confetti.update(real)

    if (this.conds.length) {
      const done = this.conds.filter((c) => c.test())
      if (done.length) {
        this.conds = this.conds.filter((c) => !done.includes(c))
        for (const c of done) c.fn()
      }
    }
  }

  private animate(p: Piece, dt: number, real: number, T: number) {
    const t = T + p.phase
    p.win += (p.winTo - p.win) * Math.min(1, dt * 9)
    if (p.win < 0.002 && p.winTo === 0) p.win = 0
    p.open += (p.openTo - p.open) * Math.min(1, dt * 10)
    p.shake = Math.max(0, p.shake - dt * 4)
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
      p.inner.scale.setScalar(Math.max(0.001, k))
      return
    }

    // breathing, a little bob, and a squash when the reel lands
    const lift = p.win * 0.45
    const hop = p.win * Math.abs(Math.sin(t * 6.5)) * 0.07
    const squash = p.shake * Math.sin(p.shake * Math.PI * 3) * 0.12
    if (!p.fall) p.inner.position.set(0, Math.sin(t * 1.6) * 0.012 + hop, lift)
    if (!spinning) {
      const breathe = Math.sin(t * 2.1) * 0.02
      const s = 1 + p.win * 0.12
      p.inner.scale.set(s * (1 - breathe * 0.5 + squash * 0.6), s * (1 + breathe - squash), s)
    }
    const wiggle = p.win * Math.sin(t * 11) * 0.09
    p.inner.rotation.z = wiggle + (p.sym === 'donut' ? Math.sin(t * 0.9) * 0.12 : 0) + (p.sym === 'egg' ? Math.sin(t * (p.win > 0.5 ? 26 : 3)) * (0.03 + p.win * 0.1) : 0)
    p.inner.rotation.y = p.sym.length === 1 ? Math.sin(t * 0.8) * 0.18 : Math.sin(t * 0.7) * 0.1

    // glow behind winners
    p.glow.material.opacity = p.win * (0.45 + 0.15 * Math.sin(T * 9))
    const gs = 1.4 + p.win * 0.25
    p.glow.scale.set(gs, gs, 1)
    if (p.win > 0.5 && Math.random() < dt * 10) {
      const c = new THREE.Color(SYMBOL_COLOR[p.sym]).multiplyScalar(2)
      const at = this.worldOf(p)
      this.sparks.emit(at.x + rnd(-0.4, 0.4), at.y + rnd(-0.4, 0.4), at.z + 0.7, rnd(-0.3, 0.3), rnd(0.3, 1.2), 0, c, rnd(0.1, 0.22), rnd(0.4, 0.8), 0, 1)
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
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.host.removeEventListener('pointermove', this.onMove)
    this.host.removeEventListener('pointerleave', this.onLeave)
    for (const p of [...this.live]) this.release(p)
    for (const list of this.pool.values()) for (const p of list) p.glow.material.dispose()
    // let anything awaiting the scene finish, so the screen code can unwind
    for (const t of this.timers) t.fn()
    for (const c of this.conds) c.fn()
    for (const f of this.flights) f.done()
    for (const r of this.reels) r.done?.()
    this.timers = []
    this.conds = []
    this.flights = []
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
  const bandGeo = new THREE.ExtrudeGeometry(band, opts)
  const bandMesh = new THREE.Mesh(bandGeo, green)
  g.add(bandMesh)
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
    const ink = new THREE.Mesh(inkGeo, new THREE.MeshBasicMaterial({ color: '#1d0f30', side: THREE.BackSide }))
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
  return g
}

/** horns on the top corners and bolts round the frame */
function buildDeco() {
  const g = new THREE.Group()
  const cream = new THREE.MeshToonMaterial({ color: '#fff1d6', gradientMap: toonRampFrame() })
  const inkMat = new THREE.MeshBasicMaterial({ color: '#1d0f30', side: THREE.BackSide })
  for (const s of [-1, 1]) {
    const h = 0.72
    const geo = new THREE.ConeGeometry(0.19, h, 20, 10)
    geo.translate(0, h / 2, 0)
    const p = geo.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const t = p.getY(i) / h
      p.setX(i, p.getX(i) + s * 0.55 * t * t * h)
    }
    geo.computeVertexNormals()
    const horn = new THREE.Mesh(geo, cream)
    const inkGeo = geo.clone()
    const ip = inkGeo.getAttribute('position') as THREE.BufferAttribute
    const n = inkGeo.getAttribute('normal') as THREE.BufferAttribute
    for (let i = 0; i < ip.count; i++) ip.setXYZ(i, ip.getX(i) + n.getX(i) * 0.025, ip.getY(i) + n.getY(i) * 0.025, ip.getZ(i) + n.getZ(i) * 0.025)
    const ink = new THREE.Mesh(inkGeo, inkMat)
    const holder = new THREE.Group()
    holder.add(ink, horn)
    holder.position.set(s * (IN_W + RIM - 0.32), IN_H + RIM + 0.04, -0.05)
    holder.rotation.z = -s * 0.35
    g.add(holder)
  }
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


interface Peeper {
  root: THREE.Group
  ball: THREE.Group
  iris: THREE.Group
  y: number
  phase: number
}

/** two googly eyes sitting on the top of the frame in bumps of the frame's own purple */
function buildPeepers(skin: THREE.Material) {
  const group = new THREE.Group()
  const white = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: toonRampFrame() })
  const iris = new THREE.MeshToonMaterial({ color: '#35e07f', gradientMap: toonRampFrame(), emissive: '#0b5a2c', emissiveIntensity: 0.35 })
  const dark = new THREE.MeshBasicMaterial({ color: '#1d0f30' })
  const ink = new THREE.MeshBasicMaterial({ color: '#1d0f30', side: THREE.BackSide })
  const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' })
  const R = 0.38
  const ballGeo = new THREE.SphereGeometry(R, 32, 22)
  const ballInk = new THREE.SphereGeometry(R + 0.03, 28, 18)
  const bumpGeo = new THREE.SphereGeometry(R + 0.1, 28, 18, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7)
  const bumpInk = new THREE.SphereGeometry(R + 0.13, 24, 16, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.7)
  // iris and pupil: flattened spheres sitting proud of the eyeball, so they slide over it as the eye turns
  const irisGeo = new THREE.SphereGeometry(0.17, 24, 14)
  irisGeo.scale(1, 1, 0.32)
  const pupilGeo = new THREE.SphereGeometry(0.095, 20, 12)
  pupilGeo.scale(1, 1, 0.3)
  const shineGeo = new THREE.SphereGeometry(0.035, 12, 8)
  shineGeo.scale(1, 1, 0.4)
  const eyes: Peeper[] = []
  const y = IN_H + RIM + 0.4
  for (const s of [-1, 1]) {
    const root = new THREE.Group()
    root.position.set(s * 0.68, y, FRAME_FRONT - 0.16)
    const bump = new THREE.Mesh(bumpGeo, skin)
    bump.position.set(0, -0.1, -0.08)
    bump.scale.set(1.05, 0.9, 0.85)
    const bInk = new THREE.Mesh(bumpInk, ink)
    bInk.position.copy(bump.position)
    bInk.scale.copy(bump.scale)
    const ball = new THREE.Group()
    ball.add(new THREE.Mesh(ballGeo, white), new THREE.Mesh(ballInk, ink))
    const holder = new THREE.Group()
    const ir = new THREE.Mesh(irisGeo, iris)
    ir.position.z = R - 0.02
    const pu = new THREE.Mesh(pupilGeo, dark)
    pu.position.z = R + 0.035
    const sh = new THREE.Mesh(shineGeo, shine)
    sh.position.set(-0.05, 0.06, R + 0.07)
    holder.add(ir, pu, sh)
    ball.add(holder)
    root.add(bInk, bump, ball)
    group.add(root)
    eyes.push({ root, ball, iris: holder, y, phase: s * 1.3 })
  }
  return { group, eyes }
}
