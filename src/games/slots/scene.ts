import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { COLS, ROWS, type Grid, type Sym } from './rules'
import { SYMBOL_COLOR, buildSymbol, createEnvironment, orbColor, symbolMaterials, warmUp } from './models'
import { Bits, POINT_FRAG, Sparks, WHITE_HOT, easeInOut, glowTexture, ring, rnd, roundRect } from '../../lib/three/fx'

/*
  The 3D stage: a 6 × 5 grid of symbols behind a gold frame, lit by a studio environment and bloom.
  Symbols fall in under gravity, bounce, glow and shatter when they win, and the rest tumble into the gaps.
  Every animation runs on the scene clock, so turbo and "hurry" speed the whole show up without the
  screen code having to know any timings; the screen just awaits each step.
*/

const SX = 1.04
const SY = 1
const HALF_W = (COLS * SX) / 2
const HALF_H = (ROWS * SY) / 2
const EDGE = 0.13
const IN_W = HALF_W + EDGE
const IN_H = HALF_H + EDGE
const RIM = 0.2
const CLIP_TOP = IN_H - 0.02
const CLIP_BOTTOM = -IN_H + 0.02
/** the frame is a deep box, so symbols near the top and bottom edge tuck in behind its lip */
const FRAME_BACK = -0.66
const FRAME_FRONT = 0.48
/** what the camera keeps in view, in world units */
const FIT_W = 7.55
const FIT_H = 7.25
const CAM_Y = 0.24
const FOV = 32

export const cellX = (c: number) => (c - (COLS - 1) / 2) * SX
export const cellY = (r: number) => ((ROWS - 1) / 2 - r) * SY

/** symbols are only drawn inside the frame, so they can fall in from above and out below */
const CLIP = [new THREE.Plane(new THREE.Vector3(0, -1, 0), CLIP_TOP), new THREE.Plane(new THREE.Vector3(0, 1, 0), -CLIP_BOTTOM)]

const G = 62
const REST = 0.16
/** a landing that would bounce slower than this just stops (judged on the bounce, so it settles at any frame rate) */
const SETTLE_V = 2.4


interface Piece {
  id: number
  sym: Sym
  mult?: number
  root: THREE.Group
  inner: THREE.Group
  col: number
  y: number
  vy: number
  ty: number
  wait: number
  moving: boolean
  leaving: boolean
  landed: boolean
  dead: boolean
  squash: number
  phase: number
  glow: number
  glowTo: number
  spinT: number
  halo: THREE.Sprite | null
  starHalo: THREE.Object3D | null
  orbSpin: THREE.Object3D | null
  orbRing: THREE.Object3D | null
  own: THREE.Material[]
}

const colorOf = (sym: Sym, mult?: number) => new THREE.Color(sym === 'orb' ? orbColor(mult ?? 2) : SYMBOL_COLOR[sym])

/* ------------------------------------------------------------------ */
/*  Backdrop and frame                                                  */
/* ------------------------------------------------------------------ */

const BACK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFree;
uniform float uAspect;
varying vec2 vUv;
vec3 blob(vec2 p, vec2 c, float r, vec3 col) {
  vec2 d = p - c;
  return col * exp(-dot(d, d) / (r * r));
}
void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;
  vec3 top = mix(vec3(0.05, 0.032, 0.13), vec3(0.1, 0.022, 0.085), uFree);
  vec3 bot = mix(vec3(0.012, 0.01, 0.035), vec3(0.03, 0.008, 0.028), uFree);
  vec3 col = mix(bot, top, smoothstep(-0.55, 0.6, p.y));
  float t = uTime * 0.07;
  col += blob(p, vec2(sin(t * 1.3) * 0.5 * uAspect, 0.22 + cos(t) * 0.12), 0.5, mix(vec3(0.11, 0.045, 0.24), vec3(0.2, 0.045, 0.11), uFree));
  col += blob(p, vec2(cos(t * 0.9 + 2.0) * 0.55 * uAspect, -0.22 + sin(t * 1.1) * 0.1), 0.42, mix(vec3(0.0, 0.08, 0.1), vec3(0.18, 0.1, 0.0), uFree));
  col += blob(p, vec2(sin(t * 0.7 + 4.0) * 0.45 * uAspect, sin(t * 0.5) * 0.2), 0.36, vec3(0.06, 0.02, 0.09));
  vec2 q = p - vec2(0.0, 0.95);
  float a = atan(q.x, -q.y);
  float rays = pow(0.5 + 0.5 * sin(a * 9.0 + uTime * 0.12), 6.0) + 0.6 * pow(0.5 + 0.5 * sin(a * 14.0 - uTime * 0.09 + 1.0), 8.0);
  col += rays * 0.04 * smoothstep(1.7, 0.2, length(q)) * mix(vec3(0.55, 0.45, 1.0), vec3(1.0, 0.72, 0.4), uFree);
  col *= 1.0 - 0.5 * smoothstep(0.35, 1.05, length(p * vec2(0.75, 1.0)));
  gl_FragColor = vec4(col, 1.0);
}`

const MOTE_VERT = /* glsl */ `
attribute vec4 seed;
attribute vec3 tint;
attribute float size;
uniform float uTime;
uniform float scale;
varying vec3 vTint;
varying float vAlpha;
void main() {
  vec3 p = position;
  float t = uTime;
  p.y = mod(p.y + t * (0.06 + seed.x * 0.14) + 7.0, 14.0) - 7.0;
  p.x += sin(t * 0.25 + seed.y * 6.283) * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * scale / -mv.z;
  vAlpha = (0.3 + 0.7 * (0.5 + 0.5 * sin(t * (0.5 + seed.z) + seed.w * 6.283))) * smoothstep(7.0, 5.0, abs(p.y));
  vTint = tint;
  gl_Position = projectionMatrix * mv;
}`

/** the dark glass behind the symbols, with a faint tile for every cell */
function panelTexture() {
  const PX = 160
  const c = document.createElement('canvas')
  c.width = Math.round((IN_W + RIM) * 2 * PX)
  c.height = Math.round((IN_H + RIM) * 2 * PX)
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 0, c.height)
  grad.addColorStop(0, 'rgba(40,22,84,0.86)')
  grad.addColorStop(0.5, 'rgba(18,10,44,0.9)')
  grad.addColorStop(1, 'rgba(10,6,28,0.94)')
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  const tile = (x: number, y: number, w: number, h: number, r: number) => {
    g.beginPath()
    g.roundRect(x, y, w, h, r)
  }
  for (let col = 0; col < COLS; col++)
    for (let row = 0; row < ROWS; row++) {
      const cx = (cellX(col) + IN_W + RIM) * PX
      const cy = (IN_H + RIM - cellY(row)) * PX
      const w = SX * PX - 10
      const h = SY * PX - 10
      tile(cx - w / 2, cy - h / 2, w, h, 22)
      const tg = g.createRadialGradient(cx, cy - h * 0.15, 4, cx, cy, w * 0.7)
      tg.addColorStop(0, 'rgba(160,130,255,0.075)')
      tg.addColorStop(1, 'rgba(160,130,255,0.02)')
      g.fillStyle = tg
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.045)'
      g.lineWidth = 2
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

interface Flight {
  from: THREE.Vector3
  ctrl: THREE.Vector3
  to: THREE.Vector3
  t: number
  dur: number
  sprite: THREE.Sprite
  color: THREE.Color
  done: () => void
}

const PREVIEW: Sym[] = ['crown', 'heart', 'diamond', 'coin', 'emerald', 'sapphire', 'amethyst', 'topaz', 'aqua', 'star', 'orb']

export class SlotScene {
  readonly ready: Promise<void>
  /** 0..1 while loading */
  onProgress?: (p: number) => void
  /** a symbol hit the floor; throttled */
  onLand?: (heavy: boolean) => void
  /** a coin of the shower went past; throttled */
  onCoin?: () => void
  thumbs: Partial<Record<Sym, string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 60)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private env: THREE.WebGLRenderTarget | null = null
  private readonly own: { dispose: () => void }[] = []

  private readonly pieces = new Map<number, Piece>()
  private all: Piece[] = []
  private readonly sparks = new Sparks(1400)
  private readonly shards: Bits
  private readonly coins: Bits
  private flights: Flight[] = []
  private beams: { col: number; sprite: THREE.Sprite; on: number }[] = []
  private timers: { at: number; fn: () => void }[] = []
  private conds: { test: () => boolean; fn: () => void }[] = []

  private readonly backMat: THREE.ShaderMaterial
  private readonly moteMat: THREE.ShaderMaterial
  private readonly lip: THREE.MeshBasicMaterial
  private readonly panelMat: THREE.MeshBasicMaterial
  private readonly glowUnder: THREE.Sprite

  private w = 1
  private h = 1
  private dpr = 1
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
  private shower = 0
  private landAt = 0
  private coinAt = 0
  private pointer = new THREE.Vector2()
  private look = new THREE.Vector2()
  private disposed = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  constructor(private readonly host: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' })
    this.dpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.localClippingEnabled = true
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    host.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.42, 0.82)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // lights: the environment does most of the work; a key light adds a crisp highlight on top
    const key = new THREE.DirectionalLight('#ffffff', 1.4)
    key.position.set(2, 4, 6)
    this.scene.add(key, new THREE.AmbientLight('#8070ff', 0.35))

    // backdrop
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

    // floating motes far behind the machine
    const N = 70
    const mg = new THREE.BufferGeometry()
    const mp = new Float32Array(N * 3)
    const ms = new Float32Array(N * 4)
    const mt = new Float32Array(N * 3)
    const mz = new Float32Array(N)
    const pal = ['#b05cff', '#3d7dff', '#25d9f0', '#ff2e6a', '#ffc83d', '#12c86c'].map((c) => new THREE.Color(c))
    for (let i = 0; i < N; i++) {
      mp.set([rnd(-10, 10), rnd(-7, 7), rnd(-9, -2.5)], i * 3)
      ms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4)
      const c = pal[i % pal.length].clone().multiplyScalar(Math.random() < 0.15 ? 1.6 : 0.55)
      mt.set([c.r, c.g, c.b], i * 3)
      mz[i] = rnd(0.12, 0.55)
    }
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3))
    mg.setAttribute('seed', new THREE.BufferAttribute(ms, 4))
    mg.setAttribute('tint', new THREE.BufferAttribute(mt, 3))
    mg.setAttribute('size', new THREE.BufferAttribute(mz, 1))
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, scale: { value: 400 }, map: { value: glowTexture() } },
      vertexShader: MOTE_VERT,
      fragmentShader: POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    const motes = new THREE.Points(mg, this.moteMat)
    motes.frustumCulled = false
    motes.renderOrder = -5
    this.scene.add(motes)
    this.own.push(mg, this.moteMat)

    // soft light pooling behind the machine
    const underMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#5a2fd0').multiplyScalar(0.5), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    this.glowUnder = new THREE.Sprite(underMat)
    this.glowUnder.scale.set(13, 10, 1)
    this.glowUnder.position.set(0, 0, -2.4)
    this.glowUnder.renderOrder = -4
    this.scene.add(this.glowUnder)
    this.own.push(underMat)

    // glass panel
    const panelTex = panelTexture()
    this.panelMat = new THREE.MeshBasicMaterial({ map: panelTex, transparent: true, depthWrite: false })
    const PW = IN_W + RIM
    const PH = IN_H + RIM
    const panelGeo = new THREE.ShapeGeometry(roundRect(PW, PH, 0.36) as THREE.Shape, 10)
    // ShapeGeometry's uvs are the raw x/y; map them to 0..1 over the panel
    const uv = panelGeo.getAttribute('uv') as THREE.BufferAttribute
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) + PW) / (PW * 2), (uv.getY(i) + PH) / (PH * 2))
    const panel = new THREE.Mesh(panelGeo, this.panelMat)
    panel.position.z = FRAME_BACK + 0.02
    panel.renderOrder = -2
    this.scene.add(panel)
    this.own.push(panelGeo, this.panelMat, panelTex)

    // gold frame
    const BEVEL = 0.07
    const frameGeo = new THREE.ExtrudeGeometry(ring(IN_W + RIM, IN_H + RIM, 0.36, IN_W + 0.06, IN_H + 0.06, 0.26), {
      depth: FRAME_FRONT - FRAME_BACK - BEVEL * 2,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: 0.06,
      bevelSegments: 4,
      curveSegments: 14,
    })
    // front face polished gold, the walls of the window a deeper, softer gold so it reads as depth
    const frameMat = new THREE.MeshStandardMaterial({ color: '#f0bb52', metalness: 1, roughness: 0.24, envMapIntensity: 1.5 })
    const wallMat = new THREE.MeshStandardMaterial({ color: '#9c6a22', metalness: 1, roughness: 0.38, envMapIntensity: 1.2 })
    const frame = new THREE.Mesh(frameGeo, [frameMat, wallMat])
    frame.position.z = FRAME_BACK + BEVEL
    this.scene.add(frame)
    this.own.push(frameGeo, frameMat, wallMat)

    // a thin neon lip just inside the frame
    const lipGeo = new THREE.ShapeGeometry(ring(IN_W + 0.005, IN_H + 0.005, 0.225, IN_W - 0.025, IN_H - 0.025, 0.2), 14)
    this.lip = new THREE.MeshBasicMaterial({ color: new THREE.Color('#9b6bff').multiplyScalar(1.9), transparent: true, opacity: 0.9, depthWrite: false })
    const lip = new THREE.Mesh(lipGeo, this.lip)
    lip.position.z = FRAME_FRONT + 0.01
    this.scene.add(lip)
    this.own.push(lipGeo, this.lip)

    // gem studs on the corners
    const studGeo = new THREE.OctahedronGeometry(0.15, 0)
    const studMat = new THREE.MeshPhysicalMaterial({ color: '#ff3d8a', roughness: 0.03, clearcoat: 1, ior: 2.2, envMapIntensity: 2.4, flatShading: true, emissive: '#ff2e6a', emissiveIntensity: 0.25 })
    for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const stud = new THREE.Mesh(studGeo, studMat)
      stud.position.set(sx * (IN_W + RIM * 0.42), sy * (IN_H + RIM * 0.42), FRAME_FRONT + 0.06)
      stud.rotation.set(0.6, 0.4, 0)
      stud.name = 'stud'
      this.scene.add(stud)
    }
    this.own.push(studGeo, studMat)

    // shards and coins
    const shardGeo = new THREE.OctahedronGeometry(0.1, 0)
    shardGeo.scale(0.8, 1.5, 0.55)
    const shardMat = new THREE.MeshPhysicalMaterial({ roughness: 0.04, metalness: 0.05, clearcoat: 1, envMapIntensity: 2.6, flatShading: true, emissive: '#ffffff', emissiveIntensity: 0.08 })
    this.shards = new Bits(shardGeo, shardMat, 420, true)
    this.shards.mesh.renderOrder = 8
    const coinGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.045, 28)
    coinGeo.rotateX(Math.PI / 2)
    const coinMat = new THREE.MeshStandardMaterial({ color: '#ffcf5a', metalness: 1, roughness: 0.26, envMapIntensity: 2.2, emissive: '#b87512', emissiveIntensity: 0.55 })
    this.coins = new Bits(coinGeo, coinMat, 260, false)
    this.coins.mesh.renderOrder = 9
    this.scene.add(this.shards.mesh, this.coins.mesh, this.sparks.points)
    this.own.push(this.shards, this.coins, this.sparks)

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
    await step(0.08)
    if (this.disposed) return
    this.env = createEnvironment(this.renderer)
    this.scene.environment = this.env.texture
    await step(0.3)
    if (this.disposed) return
    warmUp()
    await step(0.5)
    if (this.disposed) return
    // one of everything, out of sight, so every shader is compiled before the first spin
    const warm = new THREE.Group()
    const labels: THREE.Material[] = []
    for (const s of PREVIEW)
      for (const m of s === 'orb' ? [2, 6, 12, 50, 100] : [0]) {
        const o = this.prepare(buildSymbol(s, m))
        if (s === 'orb') o.traverse((x) => x instanceof THREE.Sprite && labels.push(x.material))
        warm.add(o)
      }
    warm.position.set(0, 0, -30)
    this.scene.add(warm)
    this.shards.emit(new THREE.Vector3(0, 0, -30), new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
    this.coins.emit(new THREE.Vector3(0, 0, -30), new THREE.Vector3(), new THREE.Color(), 1, 0.01, 0)
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.shards.update(0)
    this.coins.update(0)
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
    for (const m of labels) m.dispose()
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

  /** small transparent pictures of each symbol, for the paytable */
  private makeThumbs() {
    const r = this.renderer
    const cv = r.domElement
    const size = Math.floor(Math.min(160, cv.width / 4, cv.height / 3))
    if (size < 40) return {}
    const ts = new THREE.Scene()
    ts.environment = this.scene.environment
    const key = new THREE.DirectionalLight('#ffffff', 1.4)
    key.position.set(2, 4, 6)
    ts.add(key, new THREE.AmbientLight('#8070ff', 0.35))
    const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20)
    cam.position.set(0, 0, 2.55)
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
      const o = this.prepare(buildSymbol(s, 25))
      ts.add(o)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[s] = out.toDataURL('image/png')
      ts.remove(o)
      if (s === 'orb') o.traverse((x) => x instanceof THREE.Sprite && x.material.dispose())
    }
    r.setScissorTest(false)
    r.setViewport(0, 0, this.w, this.h)
    r.setClearColor(clear, alpha)
    return res
  }

  /** clip a symbol's materials to the frame window */
  private prepare(o: THREE.Object3D) {
    for (const m of symbolMaterials(o))
      if (m.clippingPlanes !== CLIP) {
        m.clippingPlanes = CLIP
        m.needsUpdate = true
      }
    return o
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const dist = Math.max(FIT_H / 2 / tan, FIT_W / 2 / (tan * this.camera.aspect))
    this.dist = dist
    this.camera.position.set(this.look.x * 0.32, CAM_Y - this.look.y * 0.22, dist)
    this.camera.lookAt(0, CAM_Y, 0)
    const scale = (h * this.dpr) / (2 * tan)
    this.sparks.mat.uniforms.scale.value = scale
    this.moteMat.uniforms.scale.value = scale
    this.backMat.uniforms.uAspect.value = w / h
    if (this.raf) this.composer.render()
  }

  /* ---------------- clock ---------------- */

  private get speed() {
    return this.base * this.boost
  }

  setTurbo(on: boolean) {
    this.base = on ? 1.75 : 1
  }

  /** the player is impatient: run the rest of this round faster */
  hurry() {
    this.boost = 2.6
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

  private add(cell: { id: number; sym: Sym; mult?: number }, col: number, y: number): Piece {
    const model = this.prepare(buildSymbol(cell.sym, cell.mult))
    const inner = new THREE.Group()
    inner.add(model)
    const root = new THREE.Group()
    root.add(inner)
    root.position.set(cellX(col), y, 0)
    this.scene.add(root)
    const own: THREE.Material[] = []
    if (cell.sym === 'orb') model.traverse((o) => o instanceof THREE.Sprite && own.push(o.material))
    const p: Piece = {
      id: cell.id,
      sym: cell.sym,
      mult: cell.mult,
      root,
      inner,
      col,
      y,
      vy: 0,
      ty: y,
      wait: 0,
      moving: false,
      leaving: false,
      landed: true,
      dead: false,
      squash: 0,
      phase: Math.random() * 10,
      glow: 0,
      glowTo: 0,
      spinT: 1,
      halo: null,
      starHalo: model.getObjectByName('halo') ?? null,
      orbSpin: model.getObjectByName('spin') ?? null,
      orbRing: model.getObjectByName('ring') ?? null,
      own,
    }
    this.all.push(p)
    this.pieces.set(cell.id, p)
    return p
  }

  private remove(p: Piece) {
    p.dead = true
    this.scene.remove(p.root)
    for (const m of p.own) m.dispose()
    if (p.halo) p.halo.material.dispose()
    if (this.pieces.get(p.id) === p) this.pieces.delete(p.id)
  }

  private haloFor(p: Piece) {
    if (!p.halo) {
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: colorOf(p.sym, p.mult).multiplyScalar(1.4), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
      p.halo = new THREE.Sprite(mat)
      p.halo.position.z = -0.35
      p.halo.renderOrder = 1
      p.root.add(p.halo)
    }
    return p.halo
  }

  /** places a grid at rest, no animation */
  show(grid: Grid) {
    for (const p of this.all) this.remove(p)
    this.all = []
    grid.forEach((col, c) => col.forEach((cell, r) => this.add(cell, c, cellY(r))))
  }

  /**
   * The old symbols drop out of the bottom and the new grid falls in, column by column, bottom row first.
   * Columns from `teaseFrom` on hold back and glow (two or three stars are already showing).
   */
  async drop(grid: Grid, teaseFrom = -1) {
    for (const p of this.all) {
      if (p.dead || p.leaving) continue
      p.leaving = true
      p.moving = true
      p.vy = rnd(0.5, 1.5)
      p.wait = p.col * 0.045 + (ROWS - 1 - Math.round((cellY(0) - p.y) / SY)) * 0.012
      p.glowTo = 0
      this.pieces.delete(p.id)
    }
    const fresh: Piece[] = []
    const teaseDelay = (c: number) => (teaseFrom >= 0 && c >= teaseFrom ? 0.75 * (c - teaseFrom + 1) : 0)
    grid.forEach((col, c) =>
      col.forEach((cell, r) => {
        const p = this.add(cell, c, cellY(r) + HALF_H * 2 + 0.7)
        p.ty = cellY(r)
        p.moving = true
        p.landed = false
        p.wait = 0.16 + c * 0.075 + (ROWS - 1 - r) * 0.034 + teaseDelay(c)
        fresh.push(p)
      }),
    )
    if (teaseFrom >= 0)
      for (let c = teaseFrom; c < COLS; c++) {
        const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ffc83d').multiplyScalar(1.3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
        const s = new THREE.Sprite(mat)
        s.scale.set(1.5, HALF_H * 2.6, 1)
        s.position.set(cellX(c), 0, -0.4)
        s.renderOrder = -1
        this.scene.add(s)
        this.beams.push({ col: c, sprite: s, on: 1 })
      }
    await this.until(() => fresh.every((p) => !p.moving) && this.all.every((p) => !p.leaving || p.dead))
  }

  /** winners glow, pulse and spin */
  async highlight(ids: number[], dur = 0.8) {
    for (const id of ids) {
      const p = this.pieces.get(id)
      if (!p) continue
      p.glowTo = 1
      p.spinT = 0
      this.haloFor(p)
    }
    await this.wait(dur)
  }

  /** winners burst into shards and sparks and are gone */
  async shatter(ids: number[]) {
    const at = new THREE.Vector3()
    for (const id of ids) {
      const p = this.pieces.get(id)
      if (!p) continue
      at.set(cellX(p.col), p.y, 0.1)
      this.explode(at, colorOf(p.sym, p.mult), p.sym === 'crown' || p.sym === 'coin' || p.sym === 'star')
      this.remove(p)
    }
    await this.wait(0.2)
  }

  private explode(at: THREE.Vector3, c: THREE.Color, gold: boolean) {
    this.sparks.emit(at.x, at.y, at.z + 0.3, 0, 0, 0, c.clone().multiplyScalar(2.6), 1.5, 0.3, 0, 0, 0.9)
    this.sparks.emit(at.x, at.y, at.z + 0.35, 0, 0, 0, WHITE_HOT, 0.7, 0.18)
    this.sparks.burst(at, c, 14, 5.5)
    const sc = c.clone()
    const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.45)
    for (let i = 0; i < 11; i++) {
      const a = Math.random() * Math.PI * 2
      const s = rnd(2.2, 6.5)
      const v = new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s + rnd(1, 3.5), rnd(0.5, 4.5))
      this.shards.emit(at, v, gold ? (i % 2 ? sc : light) : i % 3 ? sc : light, rnd(0.55, 1.25), rnd(0.75, 1.15), -16, rnd(6, 16))
    }
  }

  /** survivors fall into the gaps and new symbols drop in from above */
  async tumble(grid: Grid) {
    const moving: Piece[] = []
    grid.forEach((col, c) => {
      const fresh = col.filter((cell) => !this.pieces.has(cell.id)).length
      col.forEach((cell, r) => {
        let p = this.pieces.get(cell.id)
        const ty = cellY(r)
        if (!p) {
          p = this.add(cell, c, ty + fresh * SY + 0.35)
          p.wait = 0.04 + c * 0.035 + (fresh - 1 - r) * 0.03
        } else if (p.y > ty + 0.001) p.wait = c * 0.03
        else return
        p.ty = ty
        p.vy = 0
        p.moving = true
        p.landed = false
        moving.push(p)
      })
    })
    await this.until(() => moving.every((p) => !p.moving))
  }

  /** stars light up, spin and fizz */
  async celebrate(ids: number[], dur = 1.4) {
    const ps = ids.map((id) => this.pieces.get(id)).filter((p): p is Piece => !!p)
    for (const p of ps) {
      p.glowTo = 1
      p.spinT = 0
      this.haloFor(p)
      this.sparks.burst(new THREE.Vector3(cellX(p.col), p.y, 0.3), colorOf('star'), 26, 4.5, 0.26, 0.9)
    }
    await this.wait(dur)
    for (const p of ps) p.glowTo = 0
  }

  /**
   * Each orb glows, bursts and sends a comet to `target` (a point on screen, in CSS pixels).
   * `hit` is called as each one arrives.
   */
  async collect(ids: number[], target: { x: number; y: number }, hit: (i: number) => void) {
    const to = this.screenToWorld(target.x, target.y, 1.2)
    const ps = ids.map((id) => this.pieces.get(id)).filter((p): p is Piece => !!p)
    const flights: Promise<void>[] = []
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]
      p.glowTo = 1
      p.spinT = 0
      this.haloFor(p)
      await this.wait(0.32)
      const from = new THREE.Vector3(cellX(p.col), p.y, 0.4)
      const color = colorOf('orb', p.mult)
      this.explode(from, color, false)
      this.remove(p)
      const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: color.clone().multiplyScalar(3), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
      const sprite = new THREE.Sprite(mat)
      sprite.scale.set(0.8, 0.8, 1)
      sprite.renderOrder = 12
      sprite.position.copy(from)
      this.scene.add(sprite)
      const ctrl = from.clone().lerp(to, 0.5)
      ctrl.x += rnd(-1.5, 1.5)
      ctrl.y += 1.6
      ctrl.z += 1.5
      flights.push(new Promise<void>((done) => this.flights.push({ from, ctrl, to, t: 0, dur: 0.55, sprite, color, done: () => (hit(i), done()) })))
      await this.wait(0.12)
    }
    await Promise.all(flights)
    await this.wait(0.25)
  }

  /** gold coins rain down in front of the machine */
  coinShower(seconds = 2.5) {
    this.shower = Math.max(this.shower, seconds)
  }

  stopShower() {
    this.shower = 0
  }

  /* ---------------- coordinates ---------------- */

  private project(x: number, y: number, z = 0) {
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h }
  }

  /** where a cell's centre is on screen, in CSS pixels */
  cellToScreen(col: number, row: number) {
    return this.project(cellX(col), cellY(row))
  }

  /** the average screen position of some symbols */
  screenOf(ids: number[]) {
    let x = 0
    let y = 0
    let n = 0
    for (const id of ids) {
      const p = this.pieces.get(id)
      if (!p) continue
      x += cellX(p.col)
      y += p.ty
      n++
    }
    return n ? this.project(x / n, y / n, 0.4) : null
  }

  /** the frame's top edge on screen, for laying out the overlay */
  frameRect() {
    const a = this.project(-IN_W - RIM, IN_H + RIM)
    const b = this.project(IN_W + RIM, -IN_H - RIM)
    return { left: a.x, top: a.y, right: b.x, bottom: b.y }
  }

  private screenToWorld(x: number, y: number, z: number) {
    const ndc = new THREE.Vector3((x / this.w) * 2 - 1, -((y / this.h) * 2 - 1), 0.5).unproject(this.camera)
    const dir = ndc.sub(this.camera.position).normalize()
    const t = (z - this.camera.position.z) / dir.z
    return this.camera.position.clone().addScaledVector(dir, t)
  }

  /* ---------------- frame loop ---------------- */

  private busy() {
    return (
      this.timers.length > 0 ||
      this.conds.length > 0 ||
      this.flights.length > 0 ||
      this.sparks.list.length > 0 ||
      this.shards.list.length > 0 ||
      this.coins.list.length > 0 ||
      this.beams.length > 0 ||
      this.shower > 0 ||
      Math.abs(this.free - this.freeTo) > 0.001 ||
      this.all.some((p) => p.moving || p.glow > 0.01 || p.glowTo > 0 || p.squash > 0 || p.spinT < 1)
    )
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // when nothing is happening, 30 frames a second is plenty for the idle sway
    if (!this.busy() && this.acc < 1 / 31) return
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    const dt = real * this.speed
    this.time += dt
    this.clock += real
    this.update(dt, real)
    this.composer.render()
  }

  private update(dt: number, real: number) {
    // timers and waits
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time)
      if (due.length) {
        this.timers = this.timers.filter((t) => t.at > this.time)
        for (const t of due) t.fn()
      }
    }

    // free spins mood
    this.free += (this.freeTo - this.free) * Math.min(1, real * 2.2)
    if (Math.abs(this.free - this.freeTo) < 0.002) this.free = this.freeTo
    this.backMat.uniforms.uTime.value = this.clock
    this.backMat.uniforms.uFree.value = this.free
    this.moteMat.uniforms.uTime.value = this.clock
    this.lip.color.set('#9b6bff').lerp(new THREE.Color('#ffc14d'), this.free).multiplyScalar(1.9 + 0.25 * Math.sin(this.clock * 2.4))
    this.panelMat.color.set('#ffffff').lerp(new THREE.Color('#ffc6e8'), this.free * 0.6)
    this.glowUnder.material.color.set('#5a2fd0').lerp(new THREE.Color('#d0482f'), this.free).multiplyScalar(0.45 + 0.06 * Math.sin(this.clock * 0.9))

    // corner studs turn slowly
    for (const o of this.scene.children) if (o.name === 'stud') o.rotation.y += real * 0.8

    // camera drifts towards the mouse a little, for depth
    this.look.lerp(this.pointer, Math.min(1, real * 3))
    this.camera.position.set(this.look.x * 0.32, CAM_Y - this.look.y * 0.22, this.dist)
    this.camera.lookAt(0, CAM_Y, 0)

    // symbols
    let heavy = false
    let landed = false
    for (const p of this.all) {
      if (p.dead) continue
      if (p.wait > 0) p.wait -= dt
      else if (p.moving) {
        p.vy -= G * dt
        p.y += p.vy * dt
        if (p.leaving) {
          if (p.y < CLIP_BOTTOM - 0.9) {
            this.remove(p)
            continue
          }
        } else if (p.y <= p.ty) {
          p.y = p.ty
          if (!p.landed) {
            p.landed = true
            landed = true
            if (-p.vy > 18) heavy = true
          }
          if (-p.vy * REST > SETTLE_V) {
            p.vy = -p.vy * REST
            p.squash = 1
          } else {
            p.vy = 0
            p.moving = false
          }
        }
      }
      p.squash = Math.max(0, p.squash - dt * 6)
      p.glow += (p.glowTo - p.glow) * Math.min(1, dt * 10)
      if (p.glow < 0.002 && p.glowTo === 0) p.glow = 0
      if (p.spinT < 1) p.spinT = Math.min(1, p.spinT + dt / 0.75)

      p.root.position.set(cellX(p.col), p.y, 0)
      const t = this.clock + p.phase
      const sway = p.sym === 'coin' ? Math.sin(t * 0.7) * 0.5 : Math.sin(t * 0.8) * 0.2
      p.inner.rotation.y = sway + easeInOut(p.spinT) * Math.PI * 2
      p.inner.position.y = Math.sin(t * 1.25) * 0.02
      const pulse = p.glow * (0.08 + 0.06 * Math.sin(this.time * 10))
      const s = 1 + pulse
      p.inner.scale.set(s * (1 + p.squash * 0.07), s * (1 - p.squash * 0.09), s)
      if (p.halo) {
        p.halo.material.opacity = p.glow * (0.42 + 0.12 * Math.sin(this.time * 9))
        const hs = 1.3 + p.glow * 0.2 + 0.08 * Math.sin(this.time * 7)
        p.halo.scale.set(hs, hs, 1)
      }
      if (p.starHalo) {
        const hs = 1 + 0.12 * Math.sin(t * 2.2) + p.glow * 0.5
        p.starHalo.scale.setScalar(hs * 1.6)
      }
      if (p.orbSpin) {
        p.orbSpin.rotation.x += real * 0.9
        p.orbSpin.rotation.y += real * 1.4
      }
      if (p.orbRing) p.orbRing.rotation.z += real * 0.7
      if (p.glow > 0.5 && Math.random() < dt * 14) {
        const c = colorOf(p.sym, p.mult)
        this.sparks.emit(cellX(p.col) + rnd(-0.4, 0.4), p.y + rnd(-0.4, 0.4), 0.5, rnd(-0.3, 0.3), rnd(0.2, 1), 0, c.multiplyScalar(2), rnd(0.1, 0.22), rnd(0.4, 0.8), 0, 1)
      }
    }
    if (this.all.some((p) => p.dead)) this.all = this.all.filter((p) => !p.dead)
    if (landed && this.onLand && this.clock - this.landAt > 0.05) {
      this.landAt = this.clock
      this.onLand(heavy)
    }

    // anticipation beams fade once their column has landed
    if (this.beams.length) {
      for (const b of this.beams) {
        const waiting = this.all.some((p) => !p.leaving && p.col === b.col && p.moving)
        if (!waiting) b.on -= dt * 3
        b.sprite.material.opacity = Math.max(0, b.on) * (0.55 + 0.25 * Math.sin(this.clock * 12))
        if (b.on <= 0) {
          this.scene.remove(b.sprite)
          b.sprite.material.dispose()
        }
      }
      this.beams = this.beams.filter((b) => b.on > 0)
    }

    // orb comets
    if (this.flights.length) {
      const pos = new THREE.Vector3()
      for (const f of this.flights) {
        f.t = Math.min(1, f.t + dt / f.dur)
        const e = f.t * f.t * (3 - 2 * f.t)
        const a = 1 - e
        pos.set(0, 0, 0).addScaledVector(f.from, a * a).addScaledVector(f.ctrl, 2 * a * e).addScaledVector(f.to, e * e)
        f.sprite.position.copy(pos)
        for (let i = 0; i < 3; i++) this.sparks.emit(pos.x, pos.y, pos.z, rnd(-0.4, 0.4), rnd(-0.4, 0.4), rnd(-0.4, 0.4), f.color.clone().multiplyScalar(2.2), rnd(0.18, 0.36), rnd(0.25, 0.45), 0, 1)
        if (f.t >= 1) {
          this.scene.remove(f.sprite)
          f.sprite.material.dispose()
          this.sparks.emit(f.to.x, f.to.y, f.to.z, 0, 0, 0, f.color.clone().multiplyScalar(3), 1.6, 0.35, 0, 0, 1)
          this.sparks.burst(f.to, f.color, 16, 4)
          f.done()
        }
      }
      this.flights = this.flights.filter((f) => f.t < 1)
    }

    // coin shower
    if (this.shower > 0) {
      this.shower -= real
      const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
      const n = Math.random() < (real * 90) % 1 ? Math.ceil(real * 90) : Math.floor(real * 90)
      for (let i = 0; i < n; i++) {
        const z = rnd(0.6, 3.2)
        const depth = this.camera.position.z - z
        const hw = tan * depth * this.camera.aspect
        const top = CAM_Y + tan * depth
        this.coins.emit(new THREE.Vector3(rnd(-hw, hw), top + 0.4, z), new THREE.Vector3(rnd(-0.6, 0.6), rnd(-4, -1), 0), new THREE.Color(1, 1, 1), rnd(0.8, 1.25), 2.6, -7, rnd(5, 13))
      }
      if (this.onCoin && this.clock - this.coinAt > 0.11) {
        this.coinAt = this.clock
        this.onCoin()
      }
    }

    this.sparks.update(dt)
    this.shards.update(dt)
    this.coins.update(real)

    // conditions last, so they see this frame's state
    if (this.conds.length) {
      const done = this.conds.filter((c) => c.test())
      if (done.length) {
        this.conds = this.conds.filter((c) => !done.includes(c))
        for (const c of done) c.fn()
      }
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.host.removeEventListener('pointermove', this.onMove)
    this.host.removeEventListener('pointerleave', this.onLeave)
    for (const p of this.all) this.remove(p)
    this.all = []
    // let anything awaiting the scene finish, so the screen code can unwind
    for (const t of this.timers) t.fn()
    for (const c of this.conds) c.fn()
    for (const f of this.flights) f.done()
    this.timers = []
    this.conds = []
    this.flights = []
    for (const o of this.own) o.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.env?.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}
