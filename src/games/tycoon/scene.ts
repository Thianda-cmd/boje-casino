import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { PacedQuality } from '../../lib/three/fx'
import { releaseProps, tapTexture, type Attraction, type Drive } from './attraction'
import { ClawMachines, SlotMachines } from './machines'
import { BlackjackTables, DiceTables, PokerTables, RouletteTables } from './tables'
import { GrandStage, PenthouseSuites, SkyBar, VipLounge, releaseVenues } from './venues'
import { Splats, buildFloor, type FloorSet } from './floor'
import { HAZE, LOOKS, buildCity, type CitySet } from './city'
import { Crowd, Whale } from './crowd'
import { Glints, Tumblers } from './fx'
import { chipGeometry, coinGeometry, confettiGeometry, releasePeople } from './people'
import { U, haloMaterial, releaseMaterials, toonMaterial } from './models'
import { EDGE_H, HALF, PAD_H, PLOT, PLOTS } from './layout'

/*
  The Casino Tycoon floor in three.js: a toon diorama of the player's casino seen through an orthographic isometric
  camera. The screen owns the game (the engine and the wallet); the scene only shows what it is told and reports
  what the player taps.

  THE API (everything the screen needs)

    const sc = new TycoonScene(host)   host: an empty, positioned element; the canvas fills it. Throws if WebGL can't
                                        start: show the panel alone (TycoonScene.supported() asks first).
    sc.onProgress = (p) => …            loading, 0..1, while `ready` is pending
    await sc.ready                      everything built and its shaders compiled; it is drawing. Rejects if setup failed.
    sc.resize(w, h)                     the host's size in CSS px (call from a ResizeObserver)
    sc.setState(view)                   what the floor shows (FloorView below). Call it on every engine tick (4-10 Hz)
                                        and after every action; before `ready` is fine (it applies once built). The
                                        scene works out the moments itself from one view to the next:
                                          · owned 0 → n: the For sale sign goes, the attraction pops in with confetti;
                                          · n up within a step: the plot boings with a sparkle; up past a step of TIERS
                                            (10, 25, 50, 100, 200): a bigger layout builds up with confetti;
                                          · managers[i] turning on: the manager appears by the plot with a sparkle;
                                          · a cycle paying (a managed progress going round from one view to the next,
                                            or a manual run ending): coins pop out of it, its guests and staff cheer,
                                            and onCycle(i) fires. (Only the views' own progress counts: what the floor
                                            draws in between runs on its own clock, which drifts from the engine's.)
                                          · city changing: the new city is built round the floor (a moment's work).
    sc.onPick = (i) => …                a plot (0..9) was tapped (select it; tap() it if it has no manager)
    sc.onCycle = (i) => …               attraction i just paid on the floor (coins popped): for the cycle-pay sound.
                                        At most once per POP_GAP s per attraction (so all ten at full speed is still
                                        up to ~9 a second: thin them further for sound).
    sc.onVault = () => …                the Coin Vault in the middle of the plaza was tapped
    sc.onLost = () => …                 the WebGL context was lost (show the panel alone, or remount)
    sc.cycle(i)                         plays attraction i's pay moment now (coins, cheers, onCycle), same rate limit
    sc.spawnWhale({ stay, onTip, onMiss })   the whale walks in from the entrance and waits `stay` ms (default 20 s,
                                        counted from when he reaches his spot in front of the vault; he can be tipped
                                        on the way in too); onTip fires once if he is clicked in time (then call
                                        engine.whale), onMiss once if not. Returns false if he is already about.
                                        sc.clearWhale() sends him off at once, without a callback. sc.whaleLeft() is
                                        the ms he still waits (0: not waiting); sc.focusWhale() glides the camera to him.
    sc.spawnChip({ stay, onCatch, onMiss })  a golden chip appears on the open plaza where the camera is looking, for
                                        `stay` ms (default 12 s); onCatch once if clicked (pay chipCoins), onMiss once if
                                        not. Returns false if one is already out. sc.clearChip() removes it silently.
    sc.select(i)                        rings plot i (-1: none): the plot the panel shows
    sc.focus(i, zoom = true)            glides the camera to plot i (and zooms in if it is far out)
    sc.overview()                       glides back out to the whole floor. (A young casino, nothing past the slot
                                        machines, first opens closer in on its front, until the player moves the camera.)
    sc.front()                          glides to that young casino's view: its front corner, closer in (a sale's new
                                        casino starts there)
    sc.setCity(k)                       the city look 0..4 (setState does this too, from view.city)
    sc.project(i, out)                  where plot i's coins pop, in CSS px of the host, into out {x, y}: for HTML pops
    sc.setInput(on)                     stop/start taking pointer input (a modal over the floor)
    sc.stats()                          the last frame's draw calls and triangles, the quality level and zoom (checks)
    sc.dispose()                        stops and frees everything (the canvas is removed)

  The camera: drag to pan, wheel (desktop) or pinch (touch) to zoom about the pointer, always within the floor's
  bounds; a tap (under 8 px of movement) picks, the whale and the chip first, then the vault, then the plots. The
  canvas takes touch-action: none, so panning the floor never scrolls the page.

  Inside: the floor and plaza (floor.ts), the ten attractions (machines.ts, tables.ts, venues.ts on attraction.ts),
  the people (crowd.ts), the city (city.ts) and pooled effects (fx.ts), all in the toon kit (models.ts). Every
  attraction's animation runs on its own visual cycle (Drive), kept in step with its real progress when its cycle
  is slow enough to watch. One render a frame through a gentle bloom; PacedQuality trims the resolution on slow
  devices; pools are allocated up front, so a frame allocates nothing.

  An idle game is left open for hours, so the floor spends frames only when they show something: at the display's
  full rate while the player is handling it (and for a moment after, or while a celebration, the whale or a golden
  chip is on), otherwise at 30 frames a second (a phone always, but while the camera moves), and at 15 while the
  window doesn't have the focus. A hidden page draws nothing at all (the browser stops the frames).
*/

/** what the floor shows: arrays are per attraction, in the engine's order */
export interface FloorView {
  /** how many of each the player owns */
  owned: readonly number[]
  /** each attraction's cycle progress 0..1 (engine save.progress) */
  progress: readonly number[]
  /** seconds per cycle (engine cycleTime) */
  cycle: readonly number[]
  /** a manual cycle is running (engine save.running) */
  running: readonly boolean[]
  managers: readonly boolean[]
  /** plots the player can afford to open now (their For sale signs bounce); optional */
  afford?: readonly boolean[]
  /** the city look 0..4 */
  city: number
  /** Cash per second: the crowd grows with it */
  income: number
  /** a whale's boost is on */
  boost: boolean
  /** the Coin Vault's fill 0..1 (1 = full: it glows and bounces); optional */
  vault?: number
}

export interface SpawnOpts {
  /** how long it stays clickable (ms) */
  stay?: number
}

/** at most one pay moment (coins, the onCycle sound) per attraction this often (s): a fast attraction's coins come
 *  as a steady trickle, not a fountain */
export const POP_GAP = 1.1

/** the floor draws at full rate this long after the player last handled it (ms) */
const IDLE_MS = 8_000
/** frame gaps when it eases off: no one handling it, and the window without the focus (ms) */
const CALM_GAP = 1000 / 30
const AWAY_GAP = 1000 / 15

const N = PLOTS.length
const AZ = Math.PI / 4
const EL = THREE.MathUtils.degToRad(36)
/** from what the camera looks at towards the camera; screen right; screen up */
const DIR = new THREE.Vector3(Math.cos(EL) * Math.sin(AZ), Math.sin(EL), Math.cos(EL) * Math.cos(AZ))
const RIGHT = new THREE.Vector3(Math.cos(AZ), 0, -Math.sin(AZ))
const UP = new THREE.Vector3().crossVectors(DIR, RIGHT)
/** the camera sits this far along DIR from the screen plane through the origin */
const D0 = 140
const INK_PX = 1.35
const GOLD_HOT = new THREE.Color(2.2, 1.7, 0.6)
const WHITE_HOT = new THREE.Color(2, 2, 1.8)
const BOOST_GOLD = new THREE.Color(2.4, 1.5, 0.25)
const CONFETTI = ['#ff4f6e', '#ffd23f', '#4fc3ff', '#7cdc5a', '#c77dff', '#ff8d3b', '#ffffff'].map((c) => new THREE.Color(c))

const u = (x: number, y: number, z: number) => x * RIGHT.x + y * RIGHT.y + z * RIGHT.z
const v = (x: number, y: number, z: number) => x * UP.x + y * UP.y + z * UP.z

interface Rect {
  u0: number
  u1: number
  v0: number
  v1: number
}

function rectOf(pts: [number, number, number][], margin: number): Rect {
  const r = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity }
  for (const [x, y, z] of pts) {
    r.u0 = Math.min(r.u0, u(x, y, z))
    r.u1 = Math.max(r.u1, u(x, y, z))
    r.v0 = Math.min(r.v0, v(x, y, z))
    r.v1 = Math.max(r.v1, v(x, y, z))
  }
  r.u0 -= margin
  r.u1 += margin
  r.v0 -= margin
  r.v1 += margin
  return r
}

/** what a whole-floor view must hold (the plinth and a little of what stands at its back corner: the Penthouse
 *  tower may crop, so the floor reads bigger), and how far the camera may roam (screen units) */
const FIT = rectOf(
  [
    [HALF, 0, -HALF],
    [-HALF, 0, HALF],
    [HALF, -EDGE_H, HALF],
    [-HALF, 2.6, -HALF],
  ],
  0.5,
)
const ROAM = rectOf(
  [
    [HALF + 3, 0, -HALF - 3],
    [-HALF - 3, 0, HALF + 3],
    [HALF + 2, -EDGE_H, HALF + 2],
    [PLOTS[9].x, 18, PLOTS[9].z],
  ],
  1,
)

/**
 * The golden chip's spots: on the open plaza in front of the vault (towards the camera), between its dais and the
 * lamp posts and clear of them (at 0° and 90°). Nothing stands between them and the camera; the walks before the
 * attractions are no good, the front ones meeting under the entrance arch.
 */
const CHIP_SPOTS: [number, number][] = [-32, -14, 14, 30, 45, 60, 76, 104, 122].map((deg) => {
  const a = (deg * Math.PI) / 180
  const r = Math.abs(deg - 45) < 20 ? 3.75 : 3.45
  return [Math.cos(a) * r, Math.sin(a) * r]
})

export class TycoonScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  onPick?: (i: number) => void
  onCycle?: (i: number) => void
  onVault?: () => void
  onLost?: () => void

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly quality = new PacedQuality(0.5)
  private readonly sun = new THREE.DirectionalLight('#ffffff', 2)
  private readonly amb = new THREE.AmbientLight('#ffffff', 1)
  private readonly lite: boolean
  private dpr = 1
  private baseDpr = 1
  private drewLast = false
  /** when the player last handled the floor, the last frame drawn, and until when a moment needs every frame */
  private lastInput = 0
  private lastDraw = 0
  private busyUntil = 0
  private w = 1
  private h = 1
  private raf = 0
  private last = 0
  private time = 0
  private disposed = false
  private built = false

  // what is on the floor
  private floor: FloorSet | null = null
  private city: CitySet | null = null
  private cityIndex = -1
  private readonly atts: Attraction[] = []
  private crowd: Crowd | null = null
  private whale: Whale | null = null
  private coins: Tumblers | null = null
  private confetti: Tumblers | null = null
  private glints: Glints | null = null
  private shadows: Splats | null = null
  private readonly taps: THREE.Sprite[] = []
  private chip: { root: THREE.Group; mesh: THREE.Mesh; halo: THREE.Sprite; ring: THREE.Mesh } | null = null
  private chipState: 'off' | 'on' | 'caught' | 'gone' = 'off'
  private chipAt = 0
  private chipUntil = 0
  private readonly chipPos = new THREE.Vector3()
  private onChipCatch?: () => void
  private onChipMiss?: () => void

  // the last view, and each attraction's visual cycle
  private view: FloorView | null = null
  private readonly owned = new Array<number>(N).fill(0)
  private readonly managed = new Array<boolean>(N).fill(false)
  private readonly runningNow = new Array<boolean>(N).fill(false)
  private readonly cycleT = new Array<number>(N).fill(1)
  /** each round's progress as the floor draws it (run on between views), and as the last view had it */
  private readonly prog = new Float64Array(N)
  private readonly engineProg = new Float64Array(N)
  private readonly vis = new Float64Array(N)
  private readonly stopAt = new Float64Array(N)
  private readonly payAt = new Float64Array(N).fill(-99)
  private readonly bounceAt = new Float64Array(N).fill(-99)
  private readonly drive: Drive = { t: 0, dt: 0, cyc: 0, on: false, pay: 99, boost: 0 }
  private boost = 0
  private wantBoost = false
  private vaultFull = false
  private boostGap = 0
  private selected = -1

  // the camera, in screen units (see u() and v()): the view's centre and px per unit
  private cu = 0
  private cv = 0
  private scale = 20
  private zoomTo = 20
  private fit = 20
  private anchorX = 0
  private anchorY = 0
  private velU = 0
  private velV = 0
  private glide: { u: number; v: number } | null = null
  private framed = false
  // the pointer
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private downX = 0
  private downY = 0
  private downAt = 0
  private moved = false
  /** the player has moved the camera (so it is left where they put it) */
  private touched = false
  private lastMoveAt = 0
  private pinch = 0
  private input = true
  private readonly onDown: (e: PointerEvent) => void
  private readonly onMove: (e: PointerEvent) => void
  private readonly onUp: (e: PointerEvent) => void
  private readonly onWheel: (e: WheelEvent) => void
  private readonly onLostCtx: (e: Event) => void
  // scratch
  private readonly ray = new THREE.Ray()
  private readonly box = new THREE.Box3()
  private readonly hit = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()
  private readonly px = { x: 0, y: 0 }

  /** whether this browser can draw the floor at all */
  static supported() {
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      // (the probe's context is let go at once: a browser holds only so many)
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
      return !!gl
    } catch {
      return false
    }
  }

  constructor(private readonly host: HTMLElement) {
    this.lite = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 2
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, this.lite ? 1.6 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.info.autoReset = false
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;cursor:grab'
    host.appendChild(cv)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.lite ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.45, 1.05)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())
    this.sun.position.set(-0.6, 1.45, 1.0).multiplyScalar(30)
    this.scene.add(this.sun, this.amb)
    this.camera.up.copy(UP)

    this.onDown = (e) => this.down(e)
    this.onMove = (e) => this.move(e)
    this.onUp = (e) => this.up(e)
    this.onWheel = (e) => this.wheel(e)
    this.onLostCtx = (e) => {
      e.preventDefault()
      if (!this.disposed) this.onLost?.()
    }
    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointercancel', this.onUp)
    cv.addEventListener('lostpointercapture', this.onUp)
    cv.addEventListener('wheel', this.onWheel, { passive: false })
    cv.addEventListener('webglcontextlost', this.onLostCtx)

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
    await step(0.05)
    if (this.disposed) return
    this.floor = buildFloor()
    this.scene.add(this.floor.root)
    await step(0.25)
    if (this.disposed) return
    const kinds = [ClawMachines, SlotMachines, DiceTables, BlackjackTables, RouletteTables, PokerTables, VipLounge, SkyBar, GrandStage, PenthouseSuites]
    for (let i = 0; i < N; i++) {
      const a = new kinds[i](i)
      this.atts.push(a)
      this.scene.add(a.root)
      if (i === 4) await step(0.4)
      if (this.disposed) return
    }
    await step(0.55)
    if (this.disposed) return
    this.crowd = new Crowd(this.lite ? 34 : 54, 60)
    this.scene.add(this.crowd.people.group)
    this.whale = new Whale()
    this.scene.add(this.whale.rig.root, this.whale.ring, this.whale.bubble)
    this.coins = new Tumblers(coinGeometry(), 160)
    this.confetti = new Tumblers(confettiGeometry(), 220, -3.2, 0.04)
    this.glints = new Glints(this.lite ? 260 : 420)
    this.shadows = new Splats(170)
    this.scene.add(this.coins.mesh, this.confetti.mesh, this.glints.points, this.shadows.mesh)
    for (let i = 0; i < N; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tapTexture(), depthWrite: false, transparent: true }))
      s.scale.set(0.95, 0.95, 1)
      s.visible = false
      s.renderOrder = 9
      this.taps.push(s)
      this.scene.add(s)
    }
    this.buildChip()
    this.setCity(this.view?.city ?? 0)
    await step(0.7)
    if (this.disposed) return
    // every material compiles before the first frame (hidden things included), for the target it draws into
    const hidden: THREE.Object3D[] = []
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o)
        o.visible = true
      }
    })
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      await compiled
    } catch {
      this.renderer.setRenderTarget(null)
      /* compiles on first draw instead */
    }
    for (const o of hidden) o.visible = false
    if (this.disposed) return
    this.built = true
    if (this.view) this.apply(this.view, true)
    await step(0.9)
    if (this.disposed) return
    this.composer.render()
    await step(1)
    if (this.disposed) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  private buildChip() {
    const root = new THREE.Group()
    const mesh = new THREE.Mesh(chipGeometry(), toonMaterial())
    root.add(mesh)
    mesh.scale.setScalar(1.35)
    // its glow and the ring under it show through whatever stands in front, so a chip is never lost behind a palm
    const glow = haloMaterial().clone()
    glow.depthTest = false
    const halo = new THREE.Sprite(glow)
    halo.scale.setScalar(3)
    halo.renderOrder = 12
    root.add(halo)
    root.visible = false
    this.scene.add(root)
    // a gold ring pulsing on the floor under it, like the whale's
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.8, 36), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc53a').multiplyScalar(1.5), transparent: true, depthWrite: false, depthTest: false, opacity: 0.85 }))
    ring.rotation.x = -Math.PI / 2
    ring.renderOrder = 11
    ring.visible = false
    this.scene.add(ring)
    this.chip = { root, mesh, halo, ring }
  }

  /* ---------------- the stage ---------------- */

  /** the host's size in CSS px */
  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    const ratio = this.fit ? this.scale / this.fit : 1
    this.w = w
    this.h = h
    this.fit = Math.min(w / (FIT.u1 - FIT.u0), h / (FIT.v1 - FIT.v0))
    if (!this.framed) {
      // first frame: the whole floor on a wide stage; on a narrow one, closer in on the front, where it starts
      this.framed = true
      if (w < 640) {
        this.scale = this.zoomTo = this.fit * 1.6
        this.cu = u(4.5, 0, 4.5)
        this.cv = v(4.5, 0, 4.5)
      } else {
        this.scale = this.zoomTo = this.fit
        this.cu = (FIT.u0 + FIT.u1) / 2
        this.cv = (FIT.v0 + FIT.v1) / 2
      }
    } else this.scale = this.zoomTo = this.clampZoom(this.fit * ratio)
    this.clampView()
    this.applySize()
  }

  private applySize() {
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.w, this.h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(this.w, this.h)
    this.placeCamera()
  }

  private clampZoom(s: number) {
    return Math.min(Math.max(this.fit * 3.2, 40), Math.max(this.fit * 0.9, s))
  }

  /** keeps the view inside the roaming rectangle (centred on it when the view is wider) */
  private clampView() {
    const hw = this.w / (2 * this.scale)
    const hh = this.h / (2 * this.scale)
    const fitIn = (c: number, a: number, b: number, half: number) => (b - a < 2 * half ? (a + b) / 2 : Math.min(b - half, Math.max(a + half, c)))
    this.cu = fitIn(this.cu, ROAM.u0, ROAM.u1, hw)
    this.cv = fitIn(this.cv, ROAM.v0, ROAM.v1, hh)
  }

  private placeCamera() {
    const c = this.camera
    const hw = this.w / (2 * this.scale)
    const hh = this.h / (2 * this.scale)
    c.left = -hw
    c.right = hw
    c.top = hh
    c.bottom = -hh
    c.position.copy(RIGHT).multiplyScalar(this.cu).addScaledVector(UP, this.cv).addScaledVector(DIR, D0)
    c.lookAt(this.tmp.copy(c.position).sub(DIR))
    c.updateProjectionMatrix()
    c.updateMatrixWorld()
    U.uInk.value = INK_PX / this.scale
    const pxPerUnit = this.scale * this.dpr
    if (this.glints) this.glints.mat.uniforms.uScale.value = pxPerUnit
    if (this.floor) (this.floor.halos.material as THREE.ShaderMaterial).uniforms.uScale.value = pxPerUnit
  }

  /** a world point in CSS px of the host, into out */
  private toScreen(x: number, y: number, z: number, out: { x: number; y: number }) {
    out.x = this.w / 2 + (u(x, y, z) - this.cu) * this.scale
    out.y = this.h / 2 - (v(x, y, z) - this.cv) * this.scale
    return out
  }

  /** the camera's ray through a host point (CSS px), into this.ray */
  private rayAt(px: number, py: number) {
    const su = this.cu + (px - this.w / 2) / this.scale
    const sv = this.cv - (py - this.h / 2) / this.scale
    this.ray.origin.copy(RIGHT).multiplyScalar(su).addScaledVector(UP, sv).addScaledVector(DIR, D0)
    this.ray.direction.copy(DIR).negate()
    return this.ray
  }

  /* ---------------- what the screen tells it ---------------- */

  /** what the floor shows (see FloorView) */
  setState(view: FloorView) {
    this.view = view
    if (this.built) this.apply(view, false)
  }

  private apply(view: FloorView, first: boolean) {
    const t = this.time
    if (view.city !== this.cityIndex) this.setCity(view.city)
    let ownedChanged = first
    for (let i = 0; i < N; i++) {
      const n = Math.max(0, view.owned[i] | 0)
      const a = this.atts[i]
      const was = this.owned[i]
      if (n !== was) {
        ownedChanged = true
        this.lastInput = performance.now()
        const tierUp = a.setCount(n, t)
        if (!first && n > was) {
          this.bounceAt[i] = t
          const p = PLOTS[i]
          if (was === 0) this.celebrate(p.x, 1.2, p.z, 60)
          else if (tierUp) this.celebrate(p.x, a.top * 0.6 + 0.5, p.z, 34)
          else this.glints!.burst(p.x, 1.2, p.z, GOLD_HOT, 10, 3.5, 0.45, 0.7)
        }
        this.owned[i] = n
      }
      const managed = !!view.managers[i] && n > 0
      if (managed !== this.managed[i]) {
        ownedChanged = true
        if (managed && !first) {
          const m = a.managerAt
          const c = Math.cos(PLOTS[i].rot)
          const s = Math.sin(PLOTS[i].rot)
          this.glints!.burst(PLOTS[i].x + m.x * c + m.z * s, 0.8, PLOTS[i].z - m.x * s + m.z * c, GOLD_HOT, 16, 3, 0.4, 0.8)
        }
        this.managed[i] = managed
      }
      const running = !!view.running[i]
      const on = managed || running
      const wasOn = this.managed[i] || this.runningNow[i]
      // a cycle paid: the progress went round from the last view to this one (managed), or a manual cycle finished.
      // Against the last view's progress, never the drawn one: that runs on the frame clock, a little ahead or behind.
      // (A count gone down is a sale: its progress starts over without paying.)
      const p = Math.min(1, Math.max(0, view.progress[i] || 0))
      if (!first && n > 0 && n >= was) {
        if ((managed && p < this.engineProg[i] - 1e-6) || (this.runningNow[i] && !running && !managed)) this.cycle(i)
      }
      this.engineProg[i] = p
      // a manual cycle starting begins a fresh visual cycle; one ending lets the current one finish
      if (running && !this.runningNow[i]) this.vis[i] = Math.ceil(this.vis[i])
      if (wasOn && !on) this.stopAt[i] = Math.ceil(this.vis[i])
      this.runningNow[i] = running
      this.prog[i] = p
      this.cycleT[i] = Math.max(0.01, view.cycle[i] || 1)
    }
    if (ownedChanged) {
      this.floor!.setPlots(this.owned, view.afford, t)
      this.crowd!.setOwned(this.owned, this.managed, t)
    } else if (view.afford) this.floor!.setPlots(this.owned, view.afford, t)
    // a young casino (nothing past the slot machines yet) opens closer in, on its front, where it all is
    if (first && !this.touched && !this.owned.slice(2).some((n) => n > 0)) this.front()
    // the crowd: a few for each attraction open, more as the income climbs
    let open = 0
    for (let i = 0; i < N; i++) if (this.owned[i] > 0) open++
    this.crowd!.setTarget(open ? 3 + open * 2.6 + Math.log10(1 + Math.max(0, view.income)) * 1.6 : 2)
    this.wantBoost = view.boost
    this.vaultFull = (view.vault ?? 0) >= 1
    this.floor!.setVault(view.vault ?? 0, t)
  }

  /** plays attraction i's pay moment now (coins and cheers), rate-limited to one per POP_GAP */
  cycle(i: number) {
    if (!this.built || i < 0 || i >= N || this.owned[i] <= 0) return
    const t = this.time
    if (t - this.payAt[i] < POP_GAP) return
    this.payAt[i] = t
    const a = this.atts[i]
    a.root.updateMatrixWorld()
    const p = this.tmp.copy(a.popAt).applyMatrix4(a.root.matrixWorld)
    // a slow, big payer throws more coins than a fast little one
    const n = (this.cycleT[i] < 2 ? 2 : 3 + Math.floor(i / 3)) + (this.boost > 0.5 ? 2 : 0)
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2
      const sp = 0.8 + Math.random() * 1.3
      this.coins!.emit(p.x, p.y, p.z, Math.cos(ang) * sp, 5 + Math.random() * 2.5, Math.sin(ang) * sp, 0.85 + Math.random() * 0.25, this.boost > 0.5 ? 1.25 : 1)
    }
    this.glints!.burst(p.x, p.y, p.z, this.boost > 0.5 ? GOLD_HOT : WHITE_HOT, 6, 2.2, 0.32, 0.5)
    // the big venues throw a party
    if (i === 8) for (let k = 0; k < 26; k++) this.confettiAt(p.x, p.y + 0.6, p.z, 3.5)
    if (i === 6 || i === 7) this.glints!.burst(p.x, p.y, p.z, GOLD_HOT, 14, 2.6, 0.4, 0.9)
    this.crowd!.cheer(i, t)
    this.onCycle?.(i)
  }

  private confettiAt(x: number, y: number, z: number, speed: number) {
    const a = Math.random() * Math.PI * 2
    const s = speed * (0.4 + Math.random() * 0.8)
    this.confetti!.emit(x, y, z, Math.cos(a) * s, 3 + Math.random() * 4, Math.sin(a) * s, 1.6 + Math.random() * 0.9, 1, CONFETTI[Math.floor(Math.random() * CONFETTI.length)], 1.4)
  }

  /** a burst of confetti and sparkles (a plot opens, a step is reached) */
  private celebrate(x: number, y: number, z: number, n: number) {
    this.busyUntil = this.time + 3
    for (let k = 0; k < n; k++) this.confettiAt(x, y, z, 4)
    this.glints!.burst(x, y, z, GOLD_HOT, Math.round(n / 2), 4.5, 0.5, 1)
  }

  /** the city look 0..4 */
  setCity(k: number) {
    k = Math.max(0, Math.min(LOOKS.length - 1, k | 0))
    if (k === this.cityIndex || !this.floor) return
    const fresh = this.cityIndex >= 0
    if (this.city) {
      this.scene.remove(this.city.root)
      this.city.dispose()
    }
    this.city = buildCity(k)
    this.scene.add(this.city.root)
    const L = LOOKS[k]
    this.sun.color.set(L.sun.color)
    this.sun.intensity = L.sun.intensity
    this.amb.color.set(L.ambient.color)
    this.amb.intensity = L.ambient.intensity
    U.uNight.value = L.night
    U.uHazeColor.value.set(L.sky[2])
    U.uHaze.value.set(...(L.haze ?? HAZE))
    this.renderer.setClearColor(L.sky[0])
    this.floor.setLook(L.floor)
    this.bloom.strength = L.bloom * 0.5
    this.cityIndex = k
    // a new city: sparkles all over the floor
    if (fresh && this.glints) for (let i = 0; i < 40; i++) this.glints.emit((Math.random() - 0.5) * HALF * 2, 0.3 + Math.random() * 2, (Math.random() - 0.5) * HALF * 2, 0, 1.2, 0, GOLD_HOT, 0.5, 1.2 + Math.random())
  }

  /** rings plot i (-1: none) */
  select(i: number) {
    this.selected = i
    this.floor?.select(i)
  }

  /** glides the camera to plot i, zooming in if it is far out */
  focus(i: number, zoom = true) {
    if (i < 0 || i >= N) return
    this.lastInput = performance.now()
    const p = PLOTS[i]
    const a = this.atts[i]
    const y = a && a.tier >= 0 ? Math.min(a.top, 6) * 0.45 : 0.8
    this.glide = { u: u(p.x, y, p.z), v: v(p.x, y, p.z) }
    if (zoom) {
      this.zoomTo = this.clampZoom(Math.max(this.scale, this.fit * 1.7))
      this.anchorX = this.w / 2
      this.anchorY = this.h / 2
    }
  }

  /** glides the camera to the front corner, closer in: where a young casino has all it owns */
  front() {
    this.lastInput = performance.now()
    this.glide = { u: u(6.2, 0.6, 6.2), v: v(6.2, 0.6, 6.2) }
    this.zoomTo = this.clampZoom(this.fit * (this.w < 640 ? 1.75 : 1.6))
    this.anchorX = this.w / 2
    this.anchorY = this.h / 2
  }

  /** glides the camera back to the whole floor */
  overview() {
    this.lastInput = performance.now()
    this.glide = { u: (FIT.u0 + FIT.u1) / 2, v: (FIT.v0 + FIT.v1) / 2 }
    this.zoomTo = this.clampZoom(this.fit)
    this.anchorX = this.w / 2
    this.anchorY = this.h / 2
  }

  /** where plot i's coins pop out, in CSS px of the host */
  project(i: number, out: { x: number; y: number }) {
    const a = this.atts[i]
    if (!a) return this.toScreen(PLOTS[i].x, 1, PLOTS[i].z, out)
    a.root.updateMatrixWorld()
    const p = this.tmp.copy(a.popAt).applyMatrix4(a.root.matrixWorld)
    return this.toScreen(p.x, p.y, p.z, out)
  }

  setInput(on: boolean) {
    this.input = on
    if (!on) this.pointers.clear()
  }

  /* ---------------- the whale and the golden chip ---------------- */

  /** the whale walks in and waits by the vault; see the API at the top */
  spawnWhale(o: SpawnOpts & { onTip?: () => void; onMiss?: () => void } = {}) {
    if (!this.whale) return false
    return this.whale.spawn(this.time, o.stay ?? 20_000, o.onTip, o.onMiss)
  }

  clearWhale() {
    this.whale?.clear()
  }

  /** the ms the whale still waits for his tip (his full stay while he walks in); 0 when he isn't waiting */
  whaleLeft() {
    return this.whale ? this.whale.left(this.time) : 0
  }

  /** glides the camera to the whale (to his spot, if he is still on his way to it) and closer in */
  focusWhale() {
    const w = this.whale
    if (!w || !w.clickable) return
    const [x, z] = w.spot()
    this.lastInput = performance.now()
    this.touched = true
    // (framed on the top of his hat: he stands a little below the middle, his bubble clear of the HUD at the top)
    this.glide = { u: u(x, 3.2, z), v: v(x, 3.2, z) }
    this.zoomTo = this.clampZoom(Math.max(this.scale, this.fit * 1.8))
    this.anchorX = this.w / 2
    this.anchorY = this.h / 2
  }

  /** a golden chip appears where the camera is looking; see the API at the top */
  spawnChip(o: SpawnOpts & { onCatch?: () => void; onMiss?: () => void } = {}) {
    if (!this.chip || this.chipState !== 'off') return false
    // a spot on the plaza (CHIP_SPOTS), one inside the current view if there is one: clear of the page's HUD over
    // the floor's edges too (on a narrow floor, the Cash and the vault take the whole top row)
    const top = this.w < 640 ? 130 : 70
    const inView = CHIP_SPOTS.filter(([x, z]) => {
      this.toScreen(x, 1, z, this.px)
      return this.px.x > 50 && this.px.x < this.w - 50 && this.px.y > top && this.px.y < this.h - 60
    })
    const pool = inView.length ? inView : CHIP_SPOTS
    const [x, z] = pool[Math.floor(Math.random() * pool.length)]
    this.chipPos.set(x, 1.1, z)
    this.chipState = 'on'
    this.chipAt = this.time
    this.chipUntil = this.time + (o.stay ?? 12_000) / 1000
    this.onChipCatch = o.onCatch
    this.onChipMiss = o.onMiss
    this.chip.root.visible = true
    this.glints?.burst(x, 1.1, z, GOLD_HOT, 14, 2.5, 0.4, 0.8)
    return true
  }

  clearChip() {
    this.chipState = 'off'
    this.onChipCatch = this.onChipMiss = undefined
    if (this.chip) this.chip.root.visible = this.chip.ring.visible = false
  }

  private catchChip() {
    if (this.chipState !== 'on') return false
    this.chipState = 'caught'
    this.chipAt = this.time
    const p = this.chipPos
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2
      this.coins!.emit(p.x, p.y, p.z, Math.cos(a) * 2.2, 4 + Math.random() * 2, Math.sin(a) * 2.2, 0.9, 1.2)
    }
    this.glints!.burst(p.x, p.y, p.z, GOLD_HOT, 30, 5, 0.6, 1)
    const cb = this.onChipCatch
    this.onChipCatch = this.onChipMiss = undefined
    cb?.()
    return true
  }

  private tickChip(t: number) {
    const c = this.chip
    if (!c || this.chipState === 'off') return
    const age = t - this.chipAt
    let s = 1
    if (this.chipState === 'on') {
      s = THREE.MathUtils.clamp(1 - Math.exp(-8 * age) * Math.cos(13 * age), 0.001, 2)
      if (t > this.chipUntil) {
        this.chipState = 'gone'
        this.chipAt = t
        const cb = this.onChipMiss
        this.onChipCatch = this.onChipMiss = undefined
        cb?.()
      }
      // a twinkle now and then
      if (Math.random() < 0.15) this.glints!.emit(this.chipPos.x + (Math.random() - 0.5), this.chipPos.y + (Math.random() - 0.3), this.chipPos.z + (Math.random() - 0.5), 0, 0.6, 0, GOLD_HOT, 0.3, 0.7)
    } else {
      // caught: it zips up and away; missed: it shrinks away
      s = Math.max(0.001, 1 - age * (this.chipState === 'caught' ? 3 : 1.6))
      if (s <= 0.001) this.clearChip()
    }
    const lift = this.chipState === 'caught' ? age * 4 : 0
    c.root.position.set(this.chipPos.x, this.chipPos.y + 0.25 + Math.sin(t * 2.6) * 0.14 + lift, this.chipPos.z)
    c.mesh.rotation.y = t * 2.2
    c.root.scale.setScalar(s)
    c.halo.material.opacity = 0.55 + 0.25 * Math.sin(t * 4)
    c.ring.visible = this.chipState === 'on'
    c.ring.position.set(this.chipPos.x, 0.03, this.chipPos.z)
    c.ring.scale.setScalar(s * (1 + 0.1 * Math.sin(t * 5)))
    this.shadows!.put(this.chipPos.x, 0.012, this.chipPos.z, 0.55 * s)
  }

  /* ---------------- the pointer ---------------- */

  private local(e: PointerEvent | WheelEvent) {
    const r = this.host.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private down(e: PointerEvent) {
    if (!this.input || (e.pointerType === 'mouse' && e.button !== 0)) return
    const p = this.local(e)
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    this.pointers.set(e.pointerId, p)
    this.glide = null
    this.touched = true
    this.lastInput = performance.now()
    this.velU = this.velV = 0
    if (this.pointers.size === 1) {
      this.downX = p.x
      this.downY = p.y
      this.downAt = performance.now()
      this.lastMoveAt = e.timeStamp
      this.moved = false
    } else this.pinch = this.spread()
    this.renderer.domElement.style.cursor = 'grabbing'
    e.preventDefault()
  }

  private spread() {
    const [a, b] = [...this.pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  private move(e: PointerEvent) {
    const p = this.local(e)
    const was = this.pointers.get(e.pointerId)
    if (!was) {
      // hovering with a mouse: a hand over anything that can be tapped
      if (e.pointerType === 'mouse' && this.input) this.renderer.domElement.style.cursor = this.pickAt(p.x, p.y) ? 'pointer' : 'grab'
      return
    }
    this.lastInput = performance.now()
    if (this.pointers.size === 1) {
      const dx = p.x - was.x
      const dy = p.y - was.y
      if (Math.hypot(p.x - this.downX, p.y - this.downY) > 8) this.moved = true
      if (this.moved) {
        this.cu -= dx / this.scale
        this.cv += dy / this.scale
        // a running estimate of the drag's speed, for a glide after letting go
        const dt = Math.max(1, e.timeStamp - this.lastMoveAt) / 1000
        this.velU = this.velU * 0.6 + (-dx / this.scale / dt) * 0.4
        this.velV = this.velV * 0.6 + (dy / this.scale / dt) * 0.4
        this.clampView()
      }
      this.lastMoveAt = e.timeStamp
      this.pointers.set(e.pointerId, p)
    } else if (this.pointers.size === 2) {
      const before = [...this.pointers.values()]
      const mx0 = (before[0].x + before[1].x) / 2
      const my0 = (before[0].y + before[1].y) / 2
      this.pointers.set(e.pointerId, p)
      const after = [...this.pointers.values()]
      const mx = (after[0].x + after[1].x) / 2
      const my = (after[0].y + after[1].y) / 2
      const d = this.spread()
      this.moved = true
      // pan with the midpoint, zoom about it
      this.cu -= (mx - mx0) / this.scale
      this.cv += (my - my0) / this.scale
      if (this.pinch > 0) this.zoomAbout(mx, my, this.clampZoom(this.scale * (d / this.pinch)))
      this.pinch = d
      this.zoomTo = this.scale
    }
  }

  private up(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return
    this.pointers.delete(e.pointerId)
    if (this.pointers.size === 1) {
      // one finger left after a pinch: carry on dragging from where it is, without a tap
      const [p] = [...this.pointers.values()]
      this.downX = p.x
      this.downY = p.y
      this.moved = true
      this.pinch = 0
      return
    }
    if (this.pointers.size) return
    this.renderer.domElement.style.cursor = 'grab'
    const p = this.local(e)
    if (!this.moved && performance.now() - this.downAt < 700 && e.type === 'pointerup') {
      this.velU = this.velV = 0
      this.tap(p.x, p.y)
    }
  }

  private wheel(e: WheelEvent) {
    if (!this.input) return
    e.preventDefault()
    const p = this.local(e)
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY
    this.lastInput = performance.now()
    this.zoomTo = this.clampZoom(this.zoomTo * Math.exp(-dy * 0.0016))
    this.anchorX = p.x
    this.anchorY = p.y
    this.glide = null
    this.touched = true
  }

  /** sets the zoom, keeping the world point under (px, py) where it is */
  private zoomAbout(px: number, py: number, s: number) {
    const au = this.cu + (px - this.w / 2) / this.scale
    const av = this.cv - (py - this.h / 2) / this.scale
    this.scale = s
    this.cu = au - (px - this.w / 2) / s
    this.cv = av + (py - this.h / 2) / s
    this.clampView()
  }

  /** what is under a host point: the whale, the chip, the vault or a plot */
  private pickAt(px: number, py: number): { kind: 'whale' | 'chip' | 'vault' | 'plot'; i: number } | null {
    if (!this.built) return null
    const w = this.whale
    if (w && w.clickable) {
      this.toScreen(w.x, 1.4, w.z, this.px)
      if (Math.hypot(this.px.x - px, this.px.y - py) < Math.max(this.lite ? 44 : 34, this.scale * 1.6)) return { kind: 'whale', i: -1 }
    }
    if (this.chipState === 'on') {
      this.toScreen(this.chipPos.x, this.chipPos.y + 0.25, this.chipPos.z, this.px)
      // (a finger gets a bigger target than a mouse)
      if (Math.hypot(this.px.x - px, this.px.y - py) < Math.max(this.lite ? 44 : 34, this.scale * 1.0)) return { kind: 'chip', i: -1 }
    }
    const ray = this.rayAt(px, py)
    let best = Infinity
    let pick: { kind: 'vault' | 'plot'; i: number } | null = null
    this.box.min.set(-1.9, 0, -1.9)
    this.box.max.set(1.9, 3.6, 1.9)
    if (ray.intersectBox(this.box, this.hit)) {
      best = this.hit.distanceTo(ray.origin)
      pick = { kind: 'vault', i: -1 }
    }
    for (let i = 0; i < N; i++) {
      const p = PLOTS[i]
      const a = this.atts[i]
      const top = a.tier >= 0 ? a.top : 2.4
      this.box.min.set(p.x - PLOT / 2, 0, p.z - PLOT / 2)
      this.box.max.set(p.x + PLOT / 2, PAD_H + top, p.z + PLOT / 2)
      if (!ray.intersectBox(this.box, this.hit)) continue
      const d = this.hit.distanceTo(ray.origin)
      if (d < best) {
        best = d
        pick = { kind: 'plot', i }
      }
    }
    return pick
  }

  private tap(px: number, py: number) {
    const p = this.pickAt(px, py)
    if (!p) return
    if (p.kind === 'whale') {
      if (this.whale!.tip(this.time)) this.celebrate(this.whale!.x, 2.6, this.whale!.z, 50)
    } else if (p.kind === 'chip') this.catchChip()
    else if (p.kind === 'vault') this.onVault?.()
    else this.onPick?.(p.i)
  }

  /* ---------------- the frame ---------------- */

  /** how long to leave between frames now (ms; 0: every frame the display gives) */
  private frameGap(now: number) {
    if (!document.hasFocus()) return AWAY_GAP
    if (this.pointers.size) return 0
    const moving = this.glide !== null || Math.abs(this.zoomTo - this.scale) > this.scale * 1e-3 || Math.abs(this.velU) + Math.abs(this.velV) > 0.05
    if (this.lite) return moving ? 0 : CALM_GAP
    const busy = moving || this.time < this.busyUntil || (this.whale?.state ?? 'off') !== 'off' || this.chipState !== 'off'
    return busy || now - this.lastInput < IDLE_MS ? 0 : CALM_GAP
  }

  private readonly tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const gap = this.frameGap(now)
    // (a few ms of slack: the display's frames come a little early or late)
    if (gap && now - this.lastDraw < gap - 4) return
    this.lastDraw = now
    const dt = Math.min(gap ? 0.1 : 0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    const t = this.time
    U.uTime.value = t
    this.moveCamera(dt)
    // the whale's boost: every bulb on, gold sparkles rising over the floor
    this.boost += ((this.wantBoost ? 1 : 0) - this.boost) * Math.min(1, dt * 3)
    U.uBoost.value = this.boost
    const shadows = this.shadows!
    shadows.begin()
    const d = this.drive
    d.t = t
    d.dt = dt
    d.boost = this.boost
    for (let i = 0; i < N; i++) {
      const a = this.atts[i]
      if (this.owned[i] <= 0) {
        this.taps[i].visible = false
        continue
      }
      const on = this.managed[i] || this.runningNow[i]
      const T = this.cycleT[i]
      const vt = Math.max(a.minCycle, T)
      // the visual cycle runs at its own pace, nudged into step with the real progress when that is slow enough
      if (on || this.vis[i] < this.stopAt[i]) {
        this.vis[i] += dt / vt
        if (on) {
          this.prog[i] = Math.min(1, this.prog[i] + dt / T)
          if (T >= a.minCycle) {
            const f = this.vis[i] - Math.floor(this.vis[i])
            let diff = this.prog[i] - f
            diff -= Math.round(diff)
            this.vis[i] += diff * Math.min(1, dt * 3)
          }
        }
      }
      d.cyc = this.vis[i]
      d.on = on || this.vis[i] < this.stopAt[i]
      d.pay = t - this.payAt[i]
      a.tick(d)
      // a buy: the whole plot boings
      const age = t - this.bounceAt[i]
      const b = age < 0.8 ? Math.sin(age * 16) * Math.exp(-age * 6) : 0
      a.root.scale.set(1 - b * 0.06, 1 + b * 0.12, 1 - b * 0.06)
      const p = PLOTS[i]
      shadows.put(p.x, PAD_H + 0.012, p.z, 2.0)
      // the tap bubble over an attraction waiting for a tap
      const tap = this.taps[i]
      tap.visible = !on
      if (!on) {
        tap.position.set(p.x, PAD_H + Math.min(a.top, 3.2) + 0.65 + Math.abs(Math.sin(t * 3 + i)) * 0.2, p.z)
        tap.scale.setScalar(0.95 + 0.05 * Math.sin(t * 6))
      }
      if (this.boost > 0.3) {
        this.boostGap -= dt
        if (this.boostGap <= 0) {
          this.boostGap = 0.03
          this.glints!.emit(p.x + (Math.random() - 0.5) * 4.2, 0.3, p.z + (Math.random() - 0.5) * 4.2, 0, 1.4 + Math.random(), 0, BOOST_GOLD, 0.55, 1.4)
        }
      }
    }
    this.floor!.tick(t, dt)
    if (this.vaultFull && Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2
      const r = 1 + Math.random() * 1.6
      this.glints!.emit(Math.cos(a) * r, 0.6 + Math.random() * 2.6, Math.sin(a) * r, 0, 0.9, 0, GOLD_HOT, 0.4, 1)
    }
    this.crowd!.update(t, dt, this.atts, shadows)
    this.whale!.update(t, dt, shadows)
    this.tickChip(t)
    shadows.end()
    this.coins!.update(dt)
    this.confetti!.update(dt)
    this.glints!.update(dt)
    this.city?.tick(t, dt)
    // the lamps' halos come out at night (and in a boost)
    ;(this.floor!.halos.material as THREE.ShaderMaterial).uniforms.uAlpha.value = Math.max(U.uNight.value * 0.9, this.boost * 0.5)
    this.sun.intensity = LOOKS[this.cityIndex].sun.intensity * (1 + this.boost * 0.1)
    // (frames left out on purpose say nothing of the device's speed: only a run of full-rate ones is measured)
    if (this.quality.frame(now, this.drewLast && !gap) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.applySize()
    }
    this.drewLast = !gap
    this.renderer.info.reset()
    this.composer.render()
  }

  private moveCamera(dt: number) {
    let changed = false
    if (Math.abs(this.zoomTo - this.scale) > this.scale * 1e-4) {
      this.zoomAbout(this.anchorX, this.anchorY, this.scale + (this.zoomTo - this.scale) * Math.min(1, dt * 12))
      changed = true
    }
    if (this.glide) {
      const k = Math.min(1, dt * 5)
      this.cu += (this.glide.u - this.cu) * k
      this.cv += (this.glide.v - this.cv) * k
      if (Math.abs(this.glide.u - this.cu) + Math.abs(this.glide.v - this.cv) < 0.01) this.glide = null
      this.clampView()
      changed = true
    } else if (!this.pointers.size && Math.abs(this.velU) + Math.abs(this.velV) > 0.05) {
      this.cu += this.velU * dt
      this.cv += this.velV * dt
      const k = Math.exp(-dt * 5)
      this.velU *= k
      this.velV *= k
      this.clampView()
      changed = true
    }
    if (changed || this.pointers.size) this.placeCamera()
  }

  /** what the last frame drew, for checking the budget */
  stats() {
    const r = this.renderer.info.render
    return { calls: r.calls, triangles: r.triangles, quality: this.quality.q, scale: this.scale, fit: this.fit, city: this.cityIndex, selected: this.selected }
  }

  /* ---------------- the end ---------------- */

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const cv = this.renderer.domElement
    cv.removeEventListener('pointerdown', this.onDown)
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerup', this.onUp)
    cv.removeEventListener('pointercancel', this.onUp)
    cv.removeEventListener('lostpointercapture', this.onUp)
    cv.removeEventListener('wheel', this.onWheel)
    cv.removeEventListener('webglcontextlost', this.onLostCtx)
    for (const a of this.atts) a.dispose()
    this.floor?.dispose()
    this.city?.dispose()
    this.crowd?.dispose()
    this.whale?.dispose()
    this.coins?.dispose()
    this.confetti?.dispose()
    this.glints?.dispose()
    this.shadows?.dispose()
    for (const s of this.taps) s.material.dispose()
    if (this.chip) {
      this.chip.mesh.geometry.dispose()
      this.chip.ring.geometry.dispose()
      ;(this.chip.ring.material as THREE.Material).dispose()
      this.chip.halo.material.dispose()
    }
    releaseProps()
    releaseVenues()
    releasePeople()
    releaseMaterials()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}
