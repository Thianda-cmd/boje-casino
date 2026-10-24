import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { PacedQuality, glowTexture } from '../../../lib/three/fx'
import { VALUE, type Field, type Item, type ItemKind, type Run, type RunEvent, type Track } from '../types'
import { BACK_Z, CAB, COIN_H, HOPPER, LOWER_PUSH_MIN, PRIZE_SIZE, SLOT_X, TRAY, UPPER_PUSH_MIN } from './layout'
import { TRAY_BOX, buildCabinet, type CabinetParts } from './cabinet'
import { KIND_COLOR, buildPrize, coinGeometry, makeMats, type Mats, type PrizeModel } from './models'
import { MachineFx, starTexture } from './fx'

/*
  The Coin Cascade machine on stage: the cabinet seen from the front and above in a dim arcade, the field of coins and
  prizes, and the drops the simulation plays.

  A drop is played as a pure function of the run's frame. The scene keeps one number, the frame on show (a fraction:
  it interpolates between the run's frames, so any speed is smooth), and from it alone it poses every body (a track's
  pose between its two nearest frames; a body without a track stays where the field has it), the pushers (the run's
  own numbers), the slot's carriage and its light, the hopper's tilt, the camera's push-in on a teetering prize and a
  Quake's shake. Turbo, slow motion and scrubbing only change how fast that number moves. Events fire once each, in
  order, as the frame passes them (onEvent), and onDone once the last frame is on show; the sparkles, flashes and
  lights that go with them are cosmetic and run on the clock.

  What the simulation's track leaves out is filled in the same way: a body going into the tray falls from where its
  track ends onto a spot in the tray's pile (unless its track already ends there), and one lost to a gutter drops out
  of sight down it. The pile stays until the next drop, which clears it.

  Coins are two instanced meshes (silver, gold): the field's still coins are copied in from a block computed once per
  drop, the moving ones posed each frame. Prizes come from a small pool of models per kind.

  It only draws while it is on screen and its tab is visible; scrolled off screen (the tab still visible) a drop keeps
  playing without drawing, so the page hears its events and onDone on time. Between drops it draws 30 frames a
  second for the chasing lights (none at all under reduced motion, which also drops the shake, the push-in and two
  thirds of the particles). The render resolution adapts to the frame rate (PacedQuality).
*/

type CoinKind = 'silver' | 'gold'
type PrizeKind = 'gem' | 'bar' | 'idol' | 'crown'
const PRIZE_KINDS: PrizeKind[] = ['gem', 'bar', 'idol', 'crown']
const isCoin = (k: ItemKind): k is CoinKind => k === 'silver' || k === 'gold'

export interface SceneOpts {
  /** a phone or a small screen: fewer particles, cheaper bloom */
  low: boolean
  calm: boolean
}
/** the display panel's rectangle on the stage, CSS px from its top left */
export interface DisplayRect {
  x: number
  y: number
  w: number
  h: number
}

interface Pose {
  x: number
  y: number
  z: number
  yaw: number
  tx: number
  tz: number
}
const pose0 = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, tx: 0, tz: 0 })
const copyPose = (o: Pose, a: Pose) => {
  o.x = a.x
  o.y = a.y
  o.z = a.z
  o.yaw = a.yaw
  o.tx = a.tx
  o.tz = a.tz
  return o
}
const itemPose = (i: Item): Pose => ({ x: i.x, y: i.y, z: i.z, yaw: i.yaw, tx: i.tiltX, tz: i.tiltZ })

/** where a body that goes into the tray comes to rest, and how many frames its fall there takes (0: its track ends there) */
interface Spot {
  pose: Pose
  end: Pose
  frames: number
  spin: number
}

/** a drop in play, with what the scene works out from it once */
interface Playing {
  run: Run
  key: string
  speed: number
  /** the frame on show */
  f: number
  /** the next event to tell the page about, and the next effect cue */
  next: number
  cue: number
  done: boolean
  tracks: Track[]
  statics: Item[]
  dropF: number
  dropX: number | null
  pour: { f0: number; f1: number; tip: number } | null
  quakeF: number
  focus: { f: number; x: number; y: number; z: number }[]
  spots: Map<number, Spot>
  ends: Map<number, Pose>
  cues: { f: number; e: RunEvent }[]
}

const FOV = 30
/** how far the camera looks down (radians) */
const PITCH = 0.5
const TARGET = new THREE.Vector3(0, 2.4, -1.4)
/** what the view must show: the marquee's top corners, the gantry's post tops, the tray and the foot of the side panels */
const FIT: [number, number, number][] = [
  [-7.2, 9.6, -9.4],
  [7.2, 9.6, -9.4],
  [-7.1, 9.0, 0.3],
  [7.1, 9.0, 0.3],
  [-7.1, -3.7, 6.3],
  [7.1, -3.7, 6.3],
  [-7.1, 4.8, 3.9],
  [7.1, 4.8, 3.9],
]
/** how far the hopper tips on its pins for a pour (radians; its mouth comes round towards the camera) */
const TIP = 0.45
const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t))
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const wrap = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU)
const lerpAngle = (a: number, b: number, t: number) => a + wrap(b - a) * t
/** a small seeded random in [0, 1) from two integers (the tray pile's layout is a function of the run) */
const hash = (a: number, b: number) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h ^= h >>> 13
  return ((h >>> 0) % 100000) / 100000
}
const COIN_CAP = 520
const WARM = new THREE.Color('#ffe2a0')
const PINK = new THREE.Color('#ff5fc4')
const TEAL = new THREE.Color('#5ff6ea')
const STREAM = new THREE.Color('#ffe08a').multiplyScalar(1.8)
const col = new THREE.Color()

/** a track's pose at frame f (between its own frames; clamped to them). The simulation keeps angles continuous
 *  (never wrapped), so they interpolate as they are. */
function trackPose(t: Track, f: number, out: Pose) {
  const n = Math.max(0, Math.min(t.to - t.from, t.data.length / 6 - 1))
  const x = Math.min(n, Math.max(0, f - t.from))
  const i = Math.floor(x)
  const j = Math.min(n, i + 1)
  const k = x - i
  const d = t.data
  const a = i * 6
  const b = j * 6
  out.x = d[a] + (d[b] - d[a]) * k
  out.y = d[a + 1] + (d[b + 1] - d[a + 1]) * k
  out.z = d[a + 2] + (d[b + 2] - d[a + 2]) * k
  out.yaw = d[a + 3] + (d[b + 3] - d[a + 3]) * k
  out.tx = d[a + 4] + (d[b + 4] - d[a + 4]) * k
  out.tz = d[a + 5] + (d[b + 5] - d[a + 5]) * k
  return out
}

const eul = new THREE.Euler(0, 0, 0, 'ZXY')
const quat = new THREE.Quaternion()
const vpos = new THREE.Vector3()
const vone = new THREE.Vector3(1, 1, 1)
/** a body's pose as a matrix, as the simulation means it: rotation (tiltX, yaw, tiltZ) in the order 'ZXY' */
function poseMatrix(p: Pose, out: THREE.Matrix4, s = 1) {
  eul.set(p.tx, p.yaw, p.tz, 'ZXY')
  quat.setFromEuler(eul)
  vpos.set(p.x, p.y, p.z)
  return out.compose(vpos, quat, s === 1 ? vone : V(s, s, s))
}

export class PusherScene {
  readonly ready: Promise<void>
  onEvent?: (e: RunEvent) => void
  onDone?: (key: string) => void
  onDisplay?: (r: DisplayRect | null) => void
  onFail?: () => void
  /** for the lab and the screenshots: smoothed frame rate and cost, draw calls, triangles */
  readonly stats = { fps: 0, ms: 0, calls: 0, tris: 0, dpr: 1, frames: 0 }
  started = false

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly backMat: THREE.ShaderMaterial
  private readonly own: { dispose: () => void }[] = []
  private readonly low: boolean
  private calm: boolean
  private mats!: Mats
  private cab!: CabinetParts
  private fx!: MachineFx
  private coinMesh!: Record<CoinKind, THREE.InstancedMesh>
  private readonly pool: Record<PrizeKind, PrizeModel[]> = { gem: [], bar: [], idol: [], crown: [] }
  private readonly signs: THREE.Mesh[] = []
  private readonly neon: THREE.MeshBasicMaterial[] = []

  private field: Field | null = null
  private statics: Item[] = []
  private staticBlock: Record<CoinKind, Float32Array> = { silver: new Float32Array(0), gold: new Float32Array(0) }
  private staticGold: number[] = []
  private aim = 0
  private carX = 0
  private play: Playing | null = null
  private queued: { run: Run; speed: number; key: string } | null = null
  /** the tray's pile from the last drop (kept until the next), and the one being cleared away */
  private restPile: { kind: ItemKind; pose: Pose }[] = []
  private clearing: { kind: ItemKind; pose: Pose }[] = []
  private clearT = 1
  private trayFlash = 0
  private party = 0
  private flashLed = 0
  private held = false
  private twinkleAt = 0
  private glitterAt = 0

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private readonly quality = new PacedQuality()
  private locked: number | null = null
  private drewLast = false
  private raf = 0
  private timer = 0
  private last = 0
  private acc = 0
  private clock = 0
  private onScreen = true
  private tabVisible = true
  private dirty = true
  private disposed = false
  private displayKey = ''
  private readonly camBase = new THREE.Vector3()
  private readonly m4 = new THREE.Matrix4()
  private readonly tp = pose0()

  constructor(host: HTMLElement, o: SceneOpts) {
    this.low = o.low
    this.calm = o.calm
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.info.autoReset = false
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, o.low ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor('#070b22')
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    cv.addEventListener('webglcontextlost', this.onLost)
    host.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: o.low ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.5, 0.92)
    if (o.low) {
      const size = this.bloom.setSize.bind(this.bloom)
      this.bloom.setSize = (w: number, h: number) => size(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    }
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    const key = new THREE.DirectionalLight('#fff4ea', 2.2)
    key.position.set(-5, 12, 14)
    const rim = new THREE.DirectionalLight('#7ff0ff', 0.6)
    rim.position.set(8, 6, -6)
    this.scene.add(key, rim, new THREE.AmbientLight('#dfe4ff', 1.0))

    // the arcade behind: a dim wall with drifting neon glows
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uAspect: { value: 1 }, uParty: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
      fragmentShader: BACK_FRAG,
      depthWrite: false,
      depthTest: false,
    })
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.backMat)
    back.frustumCulled = false
    back.renderOrder = -10
    this.scene.add(back)
    this.own.push(back.geometry, this.backMat)
    const floorMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: FLOOR_FRAG,
      transparent: true,
      depthWrite: false,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, CAB.base, 4)
    this.scene.add(floor)
    this.own.push(floor.geometry, floorMat)
    // a teal glow behind the cabinet
    const bgm = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#1fd6c8').multiplyScalar(0.35), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const bgs = new THREE.Sprite(bgm)
    bgs.scale.set(30, 22, 1)
    bgs.position.set(0, 3, -16)
    this.scene.add(bgs)
    this.own.push(bgm)
    // neon signs on the wall either side (only a wide stage shows them)
    for (const [kind, x] of [['coin', -11], ['crown', 11]] as const) {
      const t = neonTexture(kind)
      const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(1.2, 1.2, 1.2) })
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), m)
      sign.position.set(x, 4, -10)
      this.neon.push(m)
      this.signs.push(sign)
      this.scene.add(sign)
      this.own.push(t, m, sign.geometry)
    }

    const r0 = host.getBoundingClientRect()
    this.resize(r0.width || 800, r0.height || 500)
    this.ready = this.init()
  }

  private onLost = (e: Event) => {
    e.preventDefault()
    this.onFail?.()
  }

  /* ---------------- setup ---------------- */

  private async init() {
    const step = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)))
    try {
      await Promise.race([Promise.all([document.fonts.load('900 100px Manrope'), document.fonts.load('800 100px Manrope')]), new Promise((r) => setTimeout(r, 1500))])
    } catch {
      /* the fallback font will do */
    }
    if (this.disposed) return
    this.mats = makeMats()
    this.own.push(...this.mats.own)
    this.cab = buildCabinet(this.mats)
    this.own.push(...this.cab.own)
    this.scene.add(this.cab.root)
    await step()
    if (this.disposed) return
    this.coinMesh = {
      silver: this.coinInstances('silver'),
      gold: this.coinInstances('gold'),
    }
    for (const k of PRIZE_KINDS) for (let i = 0; i < (k === 'gem' ? 4 : 3); i++) this.prizeModel(k)
    this.fx = new MachineFx(this.low)
    this.fx.calm = this.calm
    this.scene.add(this.fx.root)
    this.own.push(this.fx)
    this.setScale()
    this.fit()
    this.setStatics(this.field?.items ?? [])
    await step()
    if (this.disposed) return
    // every shader once before the first frame shows (the prizes and the effects included)
    for (const k of PRIZE_KINDS) for (const m of this.pool[k]) m.root.visible = true
    this.fx.glow.emit(0, -50, 0, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.fx.stars.emit(0, -50, 0, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.fx.update(0)
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      await compiled
    } catch {
      this.renderer.setRenderTarget(null)
      /* compiles on the first draw instead */
    }
    if (this.disposed) return
    for (const k of PRIZE_KINDS) for (const m of this.pool[k]) m.root.visible = false
    this.started = true
    this.carX = this.aim * SLOT_X
    if (this.queued) {
      const q = this.queued
      this.queued = null
      this.setPlay(q.run, q.speed, q.key)
    }
    this.dirty = true
    this.last = performance.now()
    this.schedule()
  }

  private coinInstances(kind: CoinKind) {
    const geo = coinGeometry(this.low ? 22 : 28)
    const m = new THREE.InstancedMesh(geo, this.mats.coin[kind], COIN_CAP)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.count = 0
    m.frustumCulled = false
    m.name = kind + 'Coins'
    this.scene.add(m)
    this.own.push(geo)
    return m
  }

  private prizeModel(kind: PrizeKind) {
    const p = buildPrize(kind, this.mats, glowTexture())
    p.root.visible = false
    this.scene.add(p.root)
    this.own.push(...p.own)
    this.pool[kind].push(p)
    return p
  }

  /* ---------------- the page's side ---------------- */

  /** the field to show while waiting (a drop in play keeps the field it started from until it is over) */
  setField(f: Field) {
    if (f === this.field) return
    this.field = f
    if (!this.started) return
    if (this.play && !this.play.done) return
    // a finished drop gives way to the field it left (its tray pile stays until the next drop)
    if (this.play) this.retire()
    this.setStatics(f.items)
  }

  setAim(a: number) {
    this.aim = Math.max(-1, Math.min(1, a))
    this.dirty = true
    this.schedule()
  }

  /**
   * Plays a drop (a new key), or changes the speed of the one in play (the same key). A new key replaces the drop in
   * play at once, its remaining events unheard. `null` ends the drop in play where it ends and shows the field.
   */
  setPlay(run: Run | null, speed = 1, key = '') {
    if (!this.started) {
      this.queued = run ? { run, speed, key } : null
      return
    }
    if (!run) {
      // the drop in play ends where it ends: the field it leaves (the page's own, once it passes it) and its pile
      const p = this.play
      if (p) {
        p.f = p.run.frames - 1
        this.retire()
        this.setStatics(p.run.after.items)
      }
      return
    }
    if (this.play && this.play.key === key) {
      this.play.speed = speed
      return
    }
    // the pile in the tray clears as the new drop starts
    this.clearing = this.play ? this.pileOf(this.play, Infinity) : this.restPile
    this.restPile = []
    this.clearT = 0
    this.play = this.prepare(run, key, speed)
    this.statics = this.play.statics
    this.bakeStatics()
    this.dirty = true
    this.last = performance.now()
    this.schedule()
  }

  /** the drop has finished and the page has moved on: its pile stays in the tray, its bodies become the field */
  private retire() {
    const p = this.play
    if (!p) return
    this.restPile = this.pileOf(p, Infinity)
    this.play = null
    this.dirty = true
  }

  setCalm(calm: boolean) {
    this.calm = calm
    if (this.fx) this.fx.calm = calm
    this.dirty = true
  }

  /** on screen and its tab visible: draws; off screen with its tab visible: a drop in play goes on without drawing */
  setVisibility(onScreen: boolean, tabVisible: boolean) {
    if (onScreen === this.onScreen && tabVisible === this.tabVisible) return
    this.onScreen = onScreen
    this.tabVisible = tabVisible
    this.last = performance.now()
    this.drewLast = false
    this.dirty = true
    this.schedule()
  }

  resize(w: number, h: number, draw = true) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.backMat.uniforms.uAspect.value = w / h
    this.fit()
    this.setScale()
    this.displayKey = ''
    this.dirty = true
    if (draw && this.started && this.onScreen && this.tabVisible) this.draw()
  }

  private setScale() {
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    this.fx?.setScale((this.h * this.dpr) / (2 * tan))
  }

  /** holds the render resolution at q times the device's (null: adapt to the frame rate again), for screenshots */
  lockQuality(q: number | null) {
    this.locked = q
    this.dpr = this.baseDpr * (q ?? this.quality.q)
    this.bloom.enabled = (q ?? this.quality.q) >= 0.6
    this.resize(this.w, this.h)
  }

  /* ---------------- the lab's side ---------------- */

  /** pauses or resumes the drop in play (the lab's scrubber) */
  hold(on: boolean) {
    this.held = on
    this.last = performance.now()
    this.schedule()
  }
  /** jumps the drop in play to frame f; the events on the way are skipped (not told), those after it are told as usual */
  seek(f: number) {
    const p = this.play
    if (!p || !Number.isFinite(f)) return
    p.f = Math.max(0, Math.min(p.run.frames - 1, f))
    p.next = p.run.events.findIndex((e) => e.f > p.f)
    if (p.next < 0) p.next = p.run.events.length
    p.cue = p.cues.findIndex((c) => c.f > p.f)
    if (p.cue < 0) p.cue = p.cues.length
    p.done = p.f >= p.run.frames - 1
    this.dirty = true
    this.schedule()
    if (this.onScreen && this.tabVisible) this.draw()
  }
  /** the frame on show, and the drop's length */
  frame() {
    return this.play ? { f: this.play.f, frames: this.play.run.frames, key: this.play.key, done: this.play.done } : null
  }

  /* ---------------- a drop, worked out once ---------------- */

  private prepare(run: Run, key: string, speed: number): Playing {
    const tracks = run.tracks
    const ids = new Set(tracks.map((t) => t.id))
    const statics = (this.field?.items ?? []).filter((i) => !ids.has(i.id))
    const step = run.step
    const events = run.events
    const drop = events.find((e) => e.kind === 'drop') as Extract<RunEvent, { kind: 'drop' }> | undefined
    // the hopper's pour: the bodies that appear part-way near the hopper (not the player's coin at the slot)
    const fromHopper = tracks.filter((t) => t.from > 0 && t.data.length >= 6 && t.data[1] > HOPPER.y - 1.8 && t.data[2] > BACK_Z + 3)
    const shower = events.find((e) => e.kind === 'shower')
    let pour: Playing['pour'] = null
    if (fromHopper.length || shower) {
      const f0 = Math.min(shower ? shower.f : Infinity, ...fromHopper.map((t) => t.from))
      const f1 = Math.max(f0 + 0.6 / step, ...fromHopper.map((t) => t.from))
      pour = { f0, f1, tip: shower ? TIP : TIP * 0.5 }
    }
    const quake = events.find((e) => e.kind === 'quake')
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const focus: Playing['focus'] = []
    for (const e of events) {
      if (e.kind !== 'edge' || isCoin(e.item)) continue
      const t = byId.get(e.id)
      if (!t) continue
      const at = trackPose(t, e.f, pose0())
      focus.push({ f: e.f, x: at.x, y: at.y, z: at.z })
    }
    // the tray's pile: each body that goes in, in the order it ends, falls onto the heap (a height map over the tray)
    const ends = new Map<number, Pose>()
    const spots = new Map<number, Spot>()
    const cell = 0.25
    const nx = Math.ceil((TRAY.w + 0.4) / cell)
    const nz = Math.ceil((TRAY_BOX.z1 - TRAY_BOX.z0 + 1.6) / cell)
    const hm = new Float32Array(nx * nz).fill(TRAY.y)
    const gx0 = -TRAY.w / 2 - 0.2
    const gz0 = TRAY_BOX.z0 - 0.8
    const footprint = (x: number, z: number, hw: number, hd: number, fn: (i: number) => void) => {
      for (let ix = Math.max(0, Math.floor((x - hw - gx0) / cell)); ix <= Math.min(nx - 1, Math.floor((x + hw - gx0) / cell)); ix++)
        for (let iz = Math.max(0, Math.floor((z - hd - gz0) / cell)); iz <= Math.min(nz - 1, Math.floor((z + hd - gz0) / cell)); iz++) fn(iz * nx + ix)
    }
    const into = tracks.filter((t) => t.fate === 'tray').sort((a, b) => a.to - b.to)
    // prizes first, in the middle of the tray, so the coins heap round them rather than under them
    const order = [...into.filter((t) => !isCoin(t.kind)), ...into.filter((t) => isCoin(t.kind))]
    for (const t of order) {
      const end = trackPose(t, t.to, pose0())
      ends.set(t.id, end)
      const inTray = end.y < TRAY.y + 0.9 && Math.abs(end.x) < TRAY.w / 2 && end.z > CAB.edge + 0.1 && end.z < TRAY.z + TRAY.d / 2 + 0.2
      if (inTray) {
        spots.set(t.id, { pose: copyPose(pose0(), end), end, frames: 0, spin: 0 })
        continue
      }
      const prize = !isCoin(t.kind)
      const s = prize ? PRIZE_SIZE[t.kind as PrizeKind] : null
      const hw = s ? Math.max(s.w, s.d) / 2 : 0.48
      const x = Math.max(TRAY_BOX.x0 + hw - 0.3, Math.min(TRAY_BOX.x1 - hw + 0.3, end.x * (prize ? 0.5 : 0.9) + (hash(t.id, 1) - 0.5) * (prize ? 1.2 : 1.6)))
      const z = prize ? (TRAY_BOX.z0 + TRAY_BOX.z1) / 2 + (hash(t.id, 2) - 0.5) * 0.4 : lerp(TRAY_BOX.z0, TRAY_BOX.z1, hash(t.id, 2))
      let top = TRAY.y
      footprint(x, z, hw * 0.8, hw * 0.8, (i) => (top = Math.max(top, hm[i])))
      const hh = s ? s.h / 2 : COIN_H / 2
      const y = top + hh
      footprint(x, z, hw * 0.8, hw * 0.8, (i) => (hm[i] = Math.max(hm[i], y + hh * 0.9)))
      const stacked = top > TRAY.y + 0.01
      const pose: Pose = {
        x,
        y,
        z,
        yaw: hash(t.id, 3) * TAU,
        tx: !prize && stacked ? (hash(t.id, 4) - 0.5) * 0.3 : 0,
        tz: !prize && stacked ? (hash(t.id, 5) - 0.5) * 0.3 : 0,
      }
      const drop = Math.max(0.2, end.y - y)
      const frames = Math.max(4, Math.round(Math.sqrt((2 * drop) / 26) / step + 0.12 / step))
      spots.set(t.id, { pose, end, frames, spin: prize ? (hash(t.id, 6) < 0.5 ? -1 : 1) * 0.6 : (hash(t.id, 6) < 0.5 ? -1 : 1) * TAU })
    }
    for (const t of tracks) if (t.fate === 'gutter') ends.set(t.id, trackPose(t, t.to, pose0()))
    // effect cues: as the events, but a body's tray landing waits for its fall onto the pile
    const cues = events
      .map((e) => {
        if (e.kind === 'tray') {
          const s = spots.get(e.id)
          const t = byId.get(e.id)
          if (s && t && s.frames) return { f: Math.max(e.f, t.to + s.frames), e }
        }
        return { f: e.f, e }
      })
      .sort((a, b) => a.f - b.f)
    return {
      run,
      key,
      speed,
      f: 0,
      next: 0,
      cue: 0,
      done: false,
      tracks,
      statics,
      dropF: drop ? drop.f : -1,
      dropX: drop ? drop.x : null,
      pour,
      quakeF: quake ? quake.f : -1,
      focus,
      spots,
      ends,
      cues,
    }
  }

  /** a body's pose at frame f, or false when it is not on show */
  private bodyPose(p: Playing, t: Track, f: number, out: Pose) {
    if (f < t.from) return false
    if (f <= t.to) {
      trackPose(t, f, out)
      return true
    }
    if (t.fate === 'field') {
      trackPose(t, t.to, out)
      return true
    }
    const end = p.ends.get(t.id)
    if (!end) return false
    if (t.fate === 'gutter') {
      // it drops out of sight down the gutter, drifting outwards
      const s = (f - t.to) * p.run.step
      if (s > 0.6 || end.y < -1.5) return false
      copyPose(out, end)
      out.x += Math.sign(end.x || 1) * s * 0.6
      out.y -= 13 * s * s
      out.tz += Math.sign(end.x || 1) * s * 6
      return true
    }
    const sp = p.spots.get(t.id)
    if (!sp) return false
    const u = sp.frames ? clamp01((f - t.to) / sp.frames) : 1
    if (u >= 1) {
      copyPose(out, sp.pose)
      return true
    }
    // the fall onto the pile: easing across, accelerating down, tumbling
    const k = smooth(u)
    out.x = lerp(end.x, sp.pose.x, k)
    out.z = lerp(end.z, sp.pose.z, k)
    out.y = lerp(end.y, sp.pose.y, u * u)
    out.yaw = lerpAngle(end.yaw, sp.pose.yaw, k)
    out.tx = end.tx + (sp.pose.tx + sp.spin - end.tx) * u
    out.tz = lerp(end.tz, sp.pose.tz, k)
    return true
  }

  /** the tray's pile as the drop has it at frame f (Infinity: once it is over) */
  private pileOf(p: Playing, f: number) {
    const out: { kind: ItemKind; pose: Pose }[] = []
    for (const t of p.tracks) {
      if (t.fate !== 'tray') continue
      const sp = p.spots.get(t.id)
      if (!sp) continue
      if (f === Infinity || f > t.to + sp.frames) out.push({ kind: t.kind, pose: copyPose(pose0(), sp.pose) })
    }
    return out
  }

  /* ---------------- the still field ---------------- */

  private setStatics(items: Item[]) {
    this.statics = items
    this.bakeStatics()
    this.dirty = true
    this.schedule()
  }

  /** the still coins' matrices, once, so each frame copies them in a block */
  private bakeStatics() {
    if (!this.coinMesh) return
    const cnt = { silver: 0, gold: 0 }
    for (const i of this.statics) if (isCoin(i.kind)) cnt[i.kind]++
    const blocks = { silver: new Float32Array(Math.min(COIN_CAP, cnt.silver) * 16), gold: new Float32Array(Math.min(COIN_CAP, cnt.gold) * 16) }
    const n = { silver: 0, gold: 0 }
    this.staticGold = []
    this.statics.forEach((i, ix) => {
      if (!isCoin(i.kind) || n[i.kind] >= COIN_CAP) return
      poseMatrix(itemPose(i), this.m4).toArray(blocks[i.kind], n[i.kind] * 16)
      if (i.kind === 'gold') this.staticGold.push(ix)
      n[i.kind]++
    })
    this.staticBlock = blocks
  }

  /* ---------------- the clock ---------------- */

  /** draws on animation frames while it can be seen; off screen with a drop in play, ticks the drop along on a timer */
  private schedule() {
    if (!this.started || this.disposed) return
    cancelAnimationFrame(this.raf)
    clearTimeout(this.timer)
    this.raf = 0
    this.timer = 0
    if (this.onScreen && this.tabVisible) this.raf = requestAnimationFrame(this.tick)
    else if (this.tabVisible && this.play && !this.play.done && !this.held) this.timer = window.setTimeout(this.offTick, 100)
  }

  private offTick = () => {
    this.timer = 0
    if (this.disposed) return
    const now = performance.now()
    const real = Math.min(0.25, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.advance(real, false)
    this.schedule()
  }

  private tick = (now: number) => {
    if (this.disposed || !this.onScreen || !this.tabVisible) return
    this.raf = requestAnimationFrame(this.tick)
    const real = Math.min(0.1, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.acc += real
    const playing = !!this.play && !this.play.done && !this.held
    this.advance(real, true)
    const lively = playing || this.fx.busy || this.clearT < 1 || this.trayFlash > 0.01 || this.party > 0.01 || Math.abs(this.carX - this.aim * SLOT_X) > 0.002 || this.dirty
    // between drops only the lights chase: 30 frames a second is plenty, and under reduced motion nothing moves at all
    if (!lively && (this.calm || this.acc < 1 / 31)) {
      this.drewLast = false
      return
    }
    const dt = Math.min(0.1, this.acc)
    this.acc = 0
    const t0 = performance.now()
    this.update(dt)
    if (this.locked === null && this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h, false)
    }
    this.drewLast = true
    this.render()
    const cost = performance.now() - t0
    this.stats.ms = this.stats.ms ? this.stats.ms * 0.92 + cost * 0.08 : cost
    this.stats.fps = dt > 0 ? (this.stats.fps ? this.stats.fps * 0.92 + (1 / dt) * 0.08 : 1 / dt) : this.stats.fps
  }

  /** one frame now, outside the loop (a resize, a seek) */
  private draw() {
    this.update(0)
    this.render()
  }

  private render() {
    const info = this.renderer.info
    info.reset()
    this.composer.render()
    this.stats.calls = info.render.calls
    this.stats.tris = info.render.triangles
    this.stats.dpr = this.dpr
    this.stats.frames++
    this.dirty = false
  }

  /** moves the drop in play along by `real` seconds: tells the events passed, and onDone at the end */
  private advance(real: number, drawing: boolean) {
    const p = this.play
    if (!p || p.done || this.held) return
    p.f = Math.min(p.run.frames - 1, p.f + (real * p.speed) / p.run.step)
    const ev = p.run.events
    while (p.next < ev.length && ev[p.next].f <= p.f) {
      const e = ev[p.next++]
      try {
        this.onEvent?.(e)
      } catch (err) {
        if (import.meta.env.DEV) console.error(err)
      }
    }
    while (p.cue < p.cues.length && p.cues[p.cue].f <= p.f) {
      const c = p.cues[p.cue++]
      if (drawing) this.effect(p, c.e)
    }
    if (p.f >= p.run.frames - 1) {
      p.done = true
      this.dirty = true
      this.onDone?.(p.key)
    }
  }

  /* ---------------- effects for the events ---------------- */

  private effect(p: Playing, e: RunEvent) {
    const fx = this.fx
    const at = V()
    const poseOf = (id: number, f: number) => {
      const t = p.tracks.find((x) => x.id === id)
      if (!t) return null
      const q = pose0()
      return this.bodyPose(p, t, f, q) ? at.set(q.x, q.y, q.z) : null
    }
    switch (e.kind) {
      case 'drop':
        fx.burst(V(e.x, 6.2, BACK_Z + 0.9), new THREE.Color('#ff6fd0'), 10, 1.2, 0.18, 0.5)
        break
      case 'land': {
        const q = poseOf(e.id, e.f)
        if (!q) break
        if (isCoin(e.item)) {
          fx.twinkle(q.clone().add(V(0, 0.1, 0)), new THREE.Color(KIND_COLOR[e.item]).multiplyScalar(1.6), 0.45, 0.3)
          fx.dust(q, 3, new THREE.Color('#dfe9ff'), 0.6)
        } else fx.dust(q, 14, new THREE.Color('#ffe9b0'), 1.4)
        break
      }
      case 'edge': {
        const q = poseOf(e.id, e.f)
        if (!q) break
        const c = new THREE.Color(KIND_COLOR[e.item])
        if (isCoin(e.item)) fx.burst(q, c, e.item === 'gold' ? 6 : 3, 1.2, 0.16, 0.5)
        else {
          // a prize goes over: sparkles, a light burst, the lights party
          fx.burst(q, c, 46, 3.2, 0.3, 1.1)
          fx.flash(q.clone().add(V(0, 0.4, 0.3)), c.clone().multiplyScalar(2), 5 + Math.min(4, VALUE[e.item] * 0.03), 0.8, 2.2)
          this.party = Math.max(this.party, e.item === 'gem' ? 0.7 : 1)
        }
        break
      }
      case 'tray': {
        const v = VALUE[e.item]
        this.trayFlash = Math.min(1.6, this.trayFlash + 0.12 + Math.min(1, v / 25))
        const q = poseOf(e.id, Infinity) ?? at.set(0, TRAY.y + 0.2, TRAY.z)
        const c = new THREE.Color(KIND_COLOR[e.item])
        if (isCoin(e.item)) fx.glitter(q, 0.6, 0.6, c.multiplyScalar(1.6), e.item === 'gold' ? 4 : 2)
        else {
          fx.burst(q, c, 40, 2.6, 0.28, 1)
          fx.flash(q.clone().add(V(0, 0.3, 0.2)), c.clone().multiplyScalar(1.8), 6, 0.9, 2.4)
          this.party = Math.max(this.party, 1)
        }
        break
      }
      case 'gutter': {
        const q = poseOf(e.id, e.f)
        if (q) fx.dust(q, 4, new THREE.Color('#7f88b8'), 0.5)
        break
      }
      case 'shower':
        this.party = Math.max(this.party, 0.8)
        fx.flash(V(HOPPER.x, HOPPER.y + 0.5, HOPPER.z + 0.4), new THREE.Color('#ffe08a'), 5, 0.6, 1.6)
        break
      case 'feed':
        fx.burst(V(HOPPER.x, HOPPER.y - 0.1, HOPPER.z + 0.2), new THREE.Color('#ff7ad0'), 8, 1, 0.16, 0.5)
        break
      case 'restock': {
        // a new prize drops in at the back of the upper tier: a flash where it appears
        const q = poseOf(e.id, e.f)
        if (!q) break
        const c = new THREE.Color(KIND_COLOR[e.item])
        fx.flash(q.clone().add(V(0, 0, 0.4)), c.clone().multiplyScalar(1.2), 3.5, 0.6, 1.8)
        fx.burst(q, c, 24, 2, 0.24, 0.8)
        break
      }
      case 'quake':
        this.flashLed = 1
        fx.flash(V(0, 2, 0), new THREE.Color('#ffffff').multiplyScalar(0.8), 16, 0.45, 1.2)
        for (const [x, y, z] of [[-4, 0.1, 1.5], [-1.5, 0.1, 2.4], [1.5, 0.1, 2.4], [4, 0.1, 1.5], [0, 0.1, 0], [-3, 1.7, -5], [0, 1.7, -4], [3, 1.7, -5]] as const) fx.dust(V(x, y, z), 12, new THREE.Color('#cfd8ff'), 2.6, 2.4)
        break
    }
  }

  /* ---------------- one frame ---------------- */

  private update(dt: number) {
    const p = this.play
    const f = p ? p.f : 0
    const step = p ? p.run.step : 1 / 60
    const fxDt = dt * (p && !p.done ? p.speed : 1)
    this.clock += dt
    const clock = this.calm ? 0 : this.clock
    this.mats.uTime.value = clock
    this.backMat.uniforms.uTime.value = clock
    this.backMat.uniforms.uParty.value = this.party
    this.party = Math.max(0, this.party - dt * 0.6)
    this.flashLed = Math.max(0, this.flashLed - dt * 2.5)
    this.trayFlash = Math.max(0, this.trayFlash - dt * 1.1)
    this.clearT = Math.min(1, this.clearT + dt * 2.2)

    /* ---- the cabinet's moving parts ---- */
    const cab = this.cab
    let uz = UPPER_PUSH_MIN
    let lz = LOWER_PUSH_MIN
    if (p && p.run.pushers.length >= 2) {
      const n = Math.floor(p.run.pushers.length / 2) - 1
      const x = Math.min(n, Math.max(0, f))
      const i = Math.floor(x)
      const j = Math.min(n, i + 1)
      const k = x - i
      const P = p.run.pushers
      uz = lerp(P[i * 2], P[j * 2], k)
      lz = lerp(P[i * 2 + 1], P[j * 2 + 1], k)
    }
    cab.upper.group.position.z = uz
    cab.lower.group.position.z = lz
    // the carriage glides to the aim (or to where the coin drops) and lights up as the coin goes in
    const carTo = p && p.dropX !== null ? p.dropX : this.aim * SLOT_X
    this.carX += (carTo - this.carX) * Math.min(1, (dt || 0.016) * 9)
    if (Math.abs(carTo - this.carX) < 0.002) this.carX = carTo
    cab.carriage.position.x = this.carX
    let lit = 0.9 + (this.calm ? 0 : 0.35 * Math.sin(this.clock * 3.2))
    if (p && p.dropF >= 0) {
      const s = (f - p.dropF) * step
      if (s > -0.45 && s < 0) lit += 1.8 * smooth((s + 0.45) / 0.45)
      else if (s >= 0) lit += 1.8 * Math.exp(-s * 3.5)
    }
    cab.carriageLight.color.setRGB(1.0 * lit, 0.25 * lit, 0.7 * lit)
    // the hopper tips for a pour, holds while it pours, and swings back
    let tilt = 0
    let left = 1
    if (p && p.pour) {
      const { f0, f1, tip } = p.pour
      const lead = Math.max(1, Math.min(0.35 / step, f0))
      const hold = 0.25 / step
      const back = 0.7 / step
      if (f >= f0 - lead && f < f0) tilt = tip * smooth((f - (f0 - lead)) / lead)
      else if (f >= f0 && f <= f1 + hold) {
        tilt = tip + (this.calm ? 0 : 0.035 * Math.sin((f - f0) * step * 26))
        left = 1 - 0.75 * clamp01((f - f0) / Math.max(1, f1 - f0))
      } else if (f > f1 + hold && f < f1 + hold + back) {
        const u = (f - f1 - hold) / back
        tilt = tip * (1 - smooth(u)) - (this.calm ? 0 : 0.12 * Math.sin(u * Math.PI) * (1 - u))
        left = 0.25
      }
    }
    cab.hopper.pivot.rotation.x = tilt
    cab.hopper.pivot.updateMatrixWorld(true)
    const pouring = tilt / TIP
    cab.hopper.light.color.setRGB(1, 0.25, 0.7).multiplyScalar(1.1 + pouring * 2 + (this.calm ? 0 : 0.25 * Math.sin(this.clock * 2.4)))

    /* ---- the bodies ---- */
    this.compose(p, f, left)

    /* ---- lights ---- */
    const busy = !!p && !p.done
    // a Quake strobes every light white while the machine shudders (steady and dimmer under reduced motion)
    let strobe = 0
    if (p && p.quakeF >= 0 && f >= p.quakeF) {
      const s = (f - p.quakeF) * step
      if (s < 2.2) strobe = (1 - s / 2.2) * (this.calm ? 0.35 : Math.sin(s * 30) > 0 ? 0.9 : 0.15)
    }
    const flash = Math.max(this.flashLed, strobe)
    for (const l of cab.leds) {
      const u = l.mat.uniforms
      u.uTime.value = clock
      u.uSpeed.value = this.calm ? 0 : busy ? l.busy : l.idle
      u.uParty.value = this.calm ? 0 : Math.min(1, this.party)
      u.uFlash.value = flash
    }
    const nb = cab.bulbAt.length
    const speed = busy ? 10 : 3.2
    for (let i = 0; i < nb; i++) {
      const side = i >= cab.marqueeBulbs
      const chase = this.calm ? i % 2 === 0 : (Math.floor(this.clock * speed) + (side ? i * 2 : i)) % 3 === 0
      let k = chase ? 1.9 : 0.5
      let c = side ? (i % 2 ? TEAL : WARM) : i % 2 ? WARM : PINK
      if (this.party > 0.01 && !this.calm) {
        const on = Math.floor(this.clock * 9) % 2 === i % 2
        k = lerp(k, on ? 2.7 : 0.35, Math.min(1, this.party * 2))
        c = on ? WARM : PINK
      }
      if (strobe > 0.01) c = (i + Math.floor(clock * 12)) % 2 ? WARM : PINK
      col.copy(c).multiplyScalar(k * (1 + flash))
      cab.bulbs.setColorAt(i, col)
    }
    if (cab.bulbs.instanceColor) cab.bulbs.instanceColor.needsUpdate = true
    ;(cab.trayGlow.material as THREE.MeshBasicMaterial).opacity = Math.min(1, this.trayFlash) * 0.85
    this.neon.forEach((m, i) => {
      const flick = !this.calm && Math.sin(this.clock * 23 + i * 7) > 0.97 && Math.sin(this.clock * 0.7 + i * 2) > 0.6 ? 0.45 : 1
      m.color.setScalar((1.1 + (this.calm ? 0 : 0.08 * Math.sin(this.clock * 2 + i))) * flick * (1 + this.party * 0.4))
    })

    /* ---- glints: a gold coin catches the light now and then; the pile glitters ---- */
    if (!this.calm && this.clock > this.twinkleAt && this.staticGold.length) {
      this.twinkleAt = this.clock + 0.18 + Math.random() * 0.35
      const it = this.statics[this.staticGold[Math.floor(Math.random() * this.staticGold.length)]]
      if (it) this.fx.twinkle(V(it.x + (Math.random() - 0.5) * 0.5, it.y + 0.08, it.z + (Math.random() - 0.5) * 0.4), new THREE.Color('#fff2b0').multiplyScalar(1.7), 0.38 + Math.random() * 0.3, 0.45)
    }
    // glitter along the hopper's stream while it pours
    if (p && p.pour && !p.done && f >= p.pour.f0 && f <= p.pour.f1 + 0.3 / step && dt > 0) {
      for (let i = 0, n = this.calm || p.pour.tip < TIP ? 2 : 6; i < n; i++) {
        const y = HOPPER.y - 0.6 - Math.random() * (HOPPER.y - 1.2)
        this.fx.stars.emit(HOPPER.x + (Math.random() - 0.5) * 1.2, y, HOPPER.z + 0.3 + (Math.random() - 0.5) * 0.6, 0, -2.5, 0.3, STREAM, 0.3 + Math.random() * 0.3, 0.35, -4, 0.5, 0.8)
      }
    }
    const pileNow = p ? this.pileCount : this.restPile.length
    if (!this.calm && pileNow > 0 && this.clock > this.glitterAt) {
      this.glitterAt = this.clock + 0.12
      this.fx.glitter(V(0, TRAY.y + 0.15, (TRAY_BOX.z0 + TRAY_BOX.z1) / 2), TRAY.w - 1.4, TRAY_BOX.z1 - TRAY_BOX.z0, new THREE.Color('#ffe6a0').multiplyScalar(1.6), Math.min(3, 1 + Math.floor(pileNow / 6)))
    }
    this.fx.update(fxDt)

    this.placeCamera(p, f, step)
    this.updateDisplay()
  }

  private pileCount = 0

  /** poses every coin and prize for frame f of the drop in play (or the still field) */
  private compose(p: Playing | null, f: number, hopperLeft: number) {
    const cm = this.coinMesh
    const arr = { silver: cm.silver.instanceMatrix.array as Float32Array, gold: cm.gold.instanceMatrix.array as Float32Array }
    arr.silver.set(this.staticBlock.silver)
    arr.gold.set(this.staticBlock.gold)
    const n = { silver: this.staticBlock.silver.length / 16, gold: this.staticBlock.gold.length / 16 }
    const used = { gem: 0, bar: 0, idol: 0, crown: 0 }
    const m4 = this.m4
    const halo = this.calm ? 0.45 : 0.38 + 0.12 * Math.sin(this.clock * 2.2)
    const put = (kind: ItemKind, q: Pose, s = 1, glow = halo) => {
      if (isCoin(kind)) {
        if (n[kind] >= COIN_CAP) return
        poseMatrix(q, m4, s).toArray(arr[kind], n[kind]++ * 16)
        return
      }
      const pool = this.pool[kind]
      const m = pool[used[kind]] ?? this.prizeModel(kind)
      used[kind]++
      m.root.visible = s > 0.02
      poseMatrix(q, m.root.matrix, s)
      m.root.matrixAutoUpdate = false
      m.root.matrixWorldNeedsUpdate = true
      ;(m.halo.material as THREE.SpriteMaterial).opacity = glow
    }
    for (const i of this.statics) if (!isCoin(i.kind)) put(i.kind, itemPose(i))
    const q = this.tp
    let pile = 0
    if (p) {
      for (const t of p.tracks) {
        if (!this.bodyPose(p, t, f, q)) continue
        if (t.fate === 'tray' && f > t.to) pile++
        put(t.kind, q, 1, isCoin(t.kind) ? halo : f >= t.from && f <= t.to ? 0.7 : t.fate === 'tray' ? 0.8 : halo)
      }
    } else for (const b of this.restPile) put(b.kind, b.pose, 1, 0.8)
    this.pileCount = pile
    // the pile from the drop before sinks away through the tray's floor as this one starts
    if (this.clearT < 1)
      for (const b of this.clearing) {
        const k = smooth(this.clearT)
        copyPose(q, b.pose)
        q.y -= k * 0.6
        put(b.kind, q, 1 - k, 0.5 * (1 - k))
      }
    // the hopper's coins, brimming (fewer while it pours)
    const hc = this.cab.hopper.coins
    const keep = Math.round(hc.length * hopperLeft)
    const hw = this.cab.hopper.pivot.matrixWorld
    for (let i = 0; i < keep; i++) {
      const c = hc[i]
      const kind = c.gold ? 'gold' : 'silver'
      if (n[kind] >= COIN_CAP) continue
      m4.multiplyMatrices(hw, c.m).toArray(arr[kind], n[kind]++ * 16)
    }
    cm.silver.count = n.silver
    cm.gold.count = n.gold
    cm.silver.instanceMatrix.needsUpdate = true
    cm.gold.instanceMatrix.needsUpdate = true
    for (const k of PRIZE_KINDS) for (let i = used[k]; i < this.pool[k].length; i++) this.pool[k][i].root.visible = false
  }

  /* ---------------- the camera ---------------- */

  /**
   * Frames the cabinet: the camera keeps its pitch and backs off until every FIT corner is on screen with a margin,
   * then shifts the lens so the machine sits centred between the margins.
   */
  private fit() {
    const cam = this.camera
    cam.clearViewOffset()
    const narrow = this.w / this.h < 0.9
    const mTop = (narrow ? 8 : 10) / this.h
    const mBot = 6 / this.h
    const mSide = (narrow ? 4 : 14) / this.w
    const dir = V(0, Math.sin(PITCH), Math.cos(PITCH))
    const pt = V()
    const span = (d: number) => {
      cam.position.copy(TARGET).addScaledVector(dir, d)
      cam.lookAt(TARGET)
      cam.updateMatrixWorld()
      cam.updateProjectionMatrix()
      let x0 = 1
      let x1 = -1
      let y0 = 1
      let y1 = -1
      for (const c of FIT) {
        pt.set(...c).project(cam)
        x0 = Math.min(x0, pt.x)
        x1 = Math.max(x1, pt.x)
        y0 = Math.min(y0, pt.y)
        y1 = Math.max(y1, pt.y)
      }
      return { x0, x1, y0, y1 }
    }
    let lo = 8
    let hi = 160
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2
      const s = span(d)
      const okX = (s.x1 - s.x0) / 2 <= 1 - mSide * 2 && Math.max(-s.x0, s.x1) <= 1 - mSide * 2
      const okY = (s.y1 - s.y0) / 2 <= 1 - (mTop + mBot)
      if (okX && okY) hi = d
      else lo = d
    }
    const s = span(hi)
    const topNdc = 1 - mTop * 2
    const botNdc = -1 + mBot * 2
    const shiftNdc = (topNdc + botNdc) / 2 - (s.y1 + s.y0) / 2
    const shiftX = -(s.x1 + s.x0) / 2
    cam.setViewOffset(this.w, this.h, (-shiftX * this.w) / 2, (shiftNdc * this.h) / 2, this.w, this.h)
    cam.updateProjectionMatrix()
    this.camBase.copy(cam.position)
    this.placeSigns()
  }

  /** the neon signs go in the room the cabinet leaves at either side of the stage, sized to it (or hidden) */
  private placeSigns() {
    const z = -10
    const cam = this.camera
    cam.position.copy(this.camBase)
    cam.lookAt(TARGET)
    cam.updateMatrixWorld()
    const at = (nx: number, ny: number) => {
      const p = V(nx, ny, 0.5).unproject(cam)
      const d = p.sub(cam.position).normalize()
      const t = (z - cam.position.z) / d.z
      return cam.position.clone().addScaledVector(d, t)
    }
    const top = V(0, 6.5, -2).project(cam)
    this.signs.forEach((sign, i) => {
      const side = i === 0 ? -1 : 1
      const edge = V(side * 7.4, 6.5, -2).project(cam)
      const inner = at(edge.x, top.y)
      const outer = at(side, top.y)
      const room = Math.abs(outer.x - inner.x)
      const w = Math.min(5, room * 0.8)
      sign.visible = w > 2.2
      sign.scale.setScalar(w / 4)
      sign.position.set((inner.x + outer.x) / 2, inner.y, z)
    })
  }

  /** the framed camera, pushed in gently on a teetering prize and shaken by a Quake (neither under reduced motion) */
  private placeCamera(p: Playing | null, f: number, step: number) {
    const cam = this.camera
    cam.position.copy(this.camBase)
    const look = TARGET.clone()
    let roll = 0
    if (p && !this.calm) {
      let w = 0
      let fx = 0
      let fz = 0
      let fy = 0
      for (const c of p.focus) {
        const s = (f - c.f) * step
        const k = smooth((s + 1.7) / 1.4) * (1 - smooth((s - 0.5) / 1.1))
        if (k > w) {
          w = k
          fx = c.x
          fy = c.y
          fz = c.z
        }
      }
      if (w > 0) {
        const to = V(fx, fy, fz)
        // (a phone stage has little room at the sides: it leans in less)
        const shift = to.clone().sub(TARGET).multiplyScalar((this.w / this.h < 0.9 ? 0.12 : 0.22) * w)
        look.add(shift)
        cam.position.add(shift)
        cam.position.lerp(look, 0.1 * w)
      }
      if (p.quakeF >= 0 && f >= p.quakeF) {
        const s = (f - p.quakeF) * step
        if (s < 2.6) {
          // a jolt that dies away: the camera jumps about and rolls a little
          const a = 0.34 * Math.exp(-s * 1.6)
          const ox = a * (Math.sin(s * 47) * 0.6 + Math.sin(s * 31 + 1) * 0.4)
          const oy = a * 0.7 * (Math.sin(s * 53 + 2) * 0.6 + Math.sin(s * 23) * 0.4)
          cam.position.x += ox
          cam.position.y += oy
          look.x += ox * 0.6
          look.y += oy * 0.6
          roll = 0.03 * Math.exp(-s * 1.9) * Math.sin(s * 37 + 0.5)
        }
      }
    }
    cam.lookAt(look)
    if (roll) cam.rotateZ(roll)
    cam.updateMatrixWorld()
  }

  /** tells the page where the display panel is on the stage, when that changes */
  private updateDisplay() {
    if (!this.onDisplay) return
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    const v = V()
    for (const c of this.cab.display) {
      v.copy(c).project(this.camera)
      const x = ((v.x + 1) / 2) * this.w
      const y = ((1 - v.y) / 2) * this.h
      x0 = Math.min(x0, x)
      x1 = Math.max(x1, x)
      y0 = Math.min(y0, y)
      y1 = Math.max(y1, y)
    }
    const r = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) }
    const key = `${r.x},${r.y},${r.w},${r.h}`
    if (key === this.displayKey) return
    this.displayKey = key
    this.onDisplay(r)
  }

  /** where the display panel is now (CSS px), for a page that asks rather than listens */
  displayRect() {
    this.displayKey = ''
    let out: DisplayRect | null = null
    const keep = this.onDisplay
    this.onDisplay = (r) => (out = r)
    this.updateDisplay()
    this.onDisplay = keep
    this.displayKey = ''
    return out
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    clearTimeout(this.timer)
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost)
    for (const o of this.own) o.dispose()
    for (const k of ['silver', 'gold'] as const) this.coinMesh?.[k].dispose()
    this.cab?.bulbs.dispose()
    glowTexture().dispose()
    starTexture().dispose()
    new THREE.Sprite().geometry.dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }
}

/* ------------------------------------------------------------------ */
/*  Shaders and textures                                                */
/* ------------------------------------------------------------------ */

const BACK_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uAspect;
uniform float uParty;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  vec2 p = vec2((uv.x - 0.5) * uAspect, uv.y);
  // a deep navy wall, lighter behind the machine
  vec3 col = mix(vec3(0.02, 0.03, 0.1), vec3(0.06, 0.1, 0.26), smoothstep(1.3, 0.0, length(p - vec2(0.0, 0.6))));
  // a faint print of coins in rows
  vec2 g = p * vec2(7.0, 7.0);
  g.x += floor(g.y) * 0.5;
  vec2 c = fract(g) - 0.5;
  col += vec3(0.25, 0.6, 0.8) * 0.045 * smoothstep(0.05, 0.0, abs(length(c) - 0.28));
  // soft neon glows drifting at the sides
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 at = vec2((hash(vec2(fi, 1.0)) - 0.5) * uAspect * 1.7, 0.2 + hash(vec2(fi, 2.0)) * 0.75);
    at.y += sin(uTime * 0.2 + fi) * 0.03;
    vec3 tint = mod(fi, 3.0) < 1.0 ? vec3(1.0, 0.25, 0.7) : mod(fi, 3.0) < 2.0 ? vec3(0.1, 0.9, 0.85) : vec3(0.5, 0.4, 1.0);
    float r = 0.1 + hash(vec2(fi, 3.0)) * 0.16;
    col += tint * 0.2 * exp(-pow(length(p - at) / r, 2.0)) * (0.8 + 0.2 * sin(uTime * 0.8 + fi * 2.0));
  }
  col *= 1.0 + uParty * 0.3 * (0.5 + 0.5 * sin(uTime * 12.0));
  gl_FragColor = vec4(col, 1.0);
}`

const FLOOR_FRAG = /* glsl */ `
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // arcade carpet: deep navy with neon dots and rings
  vec2 g = vW.xz * 0.9;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  vec3 col = vec3(0.03, 0.03, 0.1);
  vec3 tint = h < 0.33 ? vec3(1.0, 0.3, 0.7) : h < 0.66 ? vec3(0.2, 0.9, 0.85) : vec3(1.0, 0.85, 0.3);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float dot1 = smoothstep(0.09, 0.06, length(f - o * 0.5));
  float ring = smoothstep(0.03, 0.0, abs(length(f + o * 0.4) - 0.16)) * step(0.5, hash(id + 1.3));
  col += tint * (dot1 + ring) * 0.35;
  // it fades into the dark wall behind, so the floor has no far edge
  float fade = smoothstep(13.0, 4.0, length((vW.xz - vec2(0.0, 3.0)) * vec2(0.8, 1.0)));
  gl_FragColor = vec4(col, fade);
}`

/** a neon sign: glowing tubes on the dark wall, soft wide strokes under a bright core */
function neonTexture(kind: 'coin' | 'crown') {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  const tube = (draw: () => void, color: string) => {
    for (const [w, a, blur] of [[26, 0.18, 30], [14, 0.45, 14], [7, 1, 4]] as const) {
      g.save()
      g.globalAlpha = a
      g.shadowColor = color
      g.shadowBlur = blur
      g.strokeStyle = color
      g.lineWidth = w
      g.lineCap = 'round'
      g.lineJoin = 'round'
      draw()
      g.restore()
    }
    g.save()
    g.strokeStyle = 'rgba(255,255,255,0.9)'
    g.lineWidth = 2.6
    g.lineCap = 'round'
    g.lineJoin = 'round'
    draw()
    g.restore()
  }
  if (kind === 'coin') {
    tube(() => {
      g.beginPath()
      g.arc(256, 236, 140, 0, TAU)
      g.stroke()
    }, '#ffd23a')
    tube(() => {
      g.beginPath()
      g.arc(256, 236, 106, 0, TAU)
      g.stroke()
    }, '#ffb42a')
    g.font = '900 150px Manrope, ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    tube(() => g.strokeText('B', 258, 246), '#ffe36b')
    tube(() => {
      g.beginPath()
      for (const [x, y] of [[90, 420], [256, 440], [420, 420]]) {
        g.moveTo(x - 18, y)
        g.lineTo(x + 18, y)
        g.moveTo(x, y - 18)
        g.lineTo(x, y + 18)
      }
      g.stroke()
    }, '#2ff0e0')
  } else {
    tube(() => {
      g.beginPath()
      g.moveTo(110, 330)
      g.lineTo(90, 150)
      g.lineTo(180, 240)
      g.lineTo(256, 110)
      g.lineTo(332, 240)
      g.lineTo(422, 150)
      g.lineTo(402, 330)
      g.closePath()
      g.stroke()
    }, '#ff3fb4')
    tube(() => {
      g.beginPath()
      g.moveTo(110, 378)
      g.lineTo(402, 378)
      g.stroke()
    }, '#ff7ad0')
    tube(() => {
      g.beginPath()
      for (const [x, y] of [[90, 130], [256, 88], [422, 130]]) {
        g.moveTo(x + 14, y)
        g.arc(x, y, 14, 0, TAU)
      }
      g.stroke()
    }, '#ffd23a')
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
