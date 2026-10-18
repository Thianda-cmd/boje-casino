import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { PacedQuality } from '../../lib/three/fx'
import { COSTS, FIRE_RATE, MAX_BULLETS, speciesOf, type Cost, type FishId, type HitOutcome } from './rules'
import {
  CAST,
  CAST_IDS,
  CreatureBatch,
  FOV,
  Splats,
  Streaks,
  TorpedoBatch,
  WATER,
  Bubbles,
  buildCannon,
  buildReef,
  buildReticle,
  creatureMatrix,
  fitCamera,
  floorAt,
  hitRadius,
  pickLayout,
  releaseModels,
  renderPortraits,
  tickCast,
  warmUp,
  waterFog,
  type CannonRig,
  type Margins,
  type ReefSet,
} from './models'
import { LAYOUTS, crowdFor, type Layout, type LayoutId } from './field'
import { LEVEL_COLORS } from './looks'
import { CAPS, Swimmers, type Creature, type SwimEvent } from './swim'
import { Torpedoes, type Torpedo } from './shots'
import { Moments, type CatchFx, type Cue, type MomentEvent } from './moments'

export { WHEEL_SPIN, tierOf, type CatchFx, type CatchPart, type Cue, type Tier } from './moments'
export type { FormationName } from './swim'
export type { LayoutId } from './field'
export type { Margins } from './models'

/*
  The Reef Raid stage: the live reef in three.js. Looking steeply down into a sunlit sea, the field (field.ts: the
  layout that fills the stage best) lies in the swim plane with the cannon at the middle of its bottom edge; the
  creatures swim across it (swim.ts), torpedoes fly from the cannon and bounce off its edges (shots.ts), and each hit
  plays out at once (moments.ts).

  The scene never decides money. When the trigger wants a shot it asks the screen (onFire: charge it, or refuse);
  when a torpedo touches a creature it works out the extras (the ordinary creatures in a bomb crab's blast or a zap
  jelly's chain, nearest first) and hands the hit to the screen's resolver (onHit, synchronous: rules.resolveHit and
  the wallet), then plays whatever came back; a torpedo that touches nothing reports onFizzle. Every torpedo ends in
  exactly one onHit or onFizzle, unless the screen clears the water (clearBullets) or the scene is disposed.

  The rest is for the screen's overlay and sound: onCatch (where and how much to pop a payout number), onEvent (the
  whale, tides and formations, bomb and zap moments, the chest and its wheel, lock changes), onCue (sounds) and
  onLayout (where the field and the cannon sit on the stage). The scene handles the pointer on its own canvas: the
  cannon follows the mouse (or a finger), a press fires and holding keeps firing at FIRE_RATE; aimAt and trigger do
  the same from elsewhere (the space bar). Dev only: window.__reefForce = 'catch' | 'whale' | 'tide' | 'bomb' |
  'jelly' | 'chest' (see devForce).

  Frames: one render a frame through a gentle bloom and a light grade (a little more colour, the edges sinking into
  deeper water), PacedQuality trimming the resolution on slow devices (and the crowd too when even that isn't
  enough); every pool is allocated up front, so play allocates nothing per frame.
*/

/** a hit for the screen to resolve */
export interface HitReport {
  /** the torpedo's shot id (from onFire) and what it cost when fired */
  shot: number
  cost: number
  target: FishId
  /** the ordinary creatures in the blast (bomb crab) or chain (zap jelly), nearest first; empty for anything else */
  extras: FishId[]
  /** dev: __reefForce asked for this hit to catch */
  forced: boolean
}

export type ReefEvent = SwimEvent | MomentEvent | { type: 'lock'; target: FishId | null }

/** where things are on the stage, in CSS px, for the overlay */
export interface StageLayout {
  layout: LayoutId
  /** the field in reef units */
  field: { w: number; h: number }
  /** the cannon's spot (the middle of the field's bottom edge) */
  cannon: { x: number; y: number }
  /** the field's bounding box */
  rect: { left: number; top: number; right: number; bottom: number }
  /** CSS px per reef unit across the field's bottom edge */
  unit: number
}

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
/** the shortest turn from angle a to angle b */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
/** the cannon can aim this close to flat along the bottom edge */
const AIM_MIN = 0.14
/** torpedoes fly this high over the swim plane, each drawn where the camera's ray through its field point crosses it */
const TORP_Y = 0.3
/** a torpedo's wake: a tapered streak this long behind it */
const WAKE = 1.5
/** a locked creature is picked within this much of the pointer (reef units) */
const PICK_R = 0.45
const GLOWS: Partial<Record<FishId, string>> = { crab: '#ff5a3c', jelly: '#7ef0ff', chest: '#ffd23a', whale: '#ffc93c' }
const SHADOW = new THREE.Color('#0a2a4a')

/** the grade, in linear light before tone mapping: colour lifted a touch, and the stage's edges cooler and darker */
const GRADE = {
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.3 }, uEdge: { value: new THREE.Vector3(0.52, 0.74, 0.94) } },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uSat;
uniform vec3 uEdge;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 col = max(mix(vec3(l), c.rgb, uSat), 0.0);
  float edge = smoothstep(0.38, 0.85, length((vUv - 0.5) * vec2(1.0, 1.15)));
  gl_FragColor = vec4(col * mix(vec3(1.0), uEdge, edge), c.a);
}`,
}
const WHITE = new THREE.Color(1, 1, 1)

interface Streak {
  live: boolean
  x: number
  y: number
  len: number
  speed: number
  life: number
  max: number
}

export class ReefScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** the trigger wants a shot of `cost`: take the coins and return true, or false to refuse (the trigger then waits for a new press) */
  onFire?: (shot: number, cost: number) => boolean
  /** a torpedo touched a creature: resolve it now (rules.resolveHit, the wallet) and return the outcome */
  onHit?: (hit: HitReport) => HitOutcome | null
  /** a torpedo touched nothing: give its cost back */
  onFizzle?: (shot: number, cost: number) => void
  /** a catch is popping into coins: show its payout here */
  onCatch?: (c: CatchFx) => void
  onEvent?: (e: ReefEvent) => void
  /** a sound; k shapes it (shot: cannon level; net, flinch, catch: value ×; coin: index; boom: creatures caught; zap: link index) */
  onCue?: (cue: Cue, k: number) => void
  /** the field or the cannon moved on the stage */
  onLayout?: (l: StageLayout) => void
  /** the paytable's pictures of each creature (once ready) */
  portraits: Partial<Record<FishId, string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 220)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly grade: ShaderPass
  private readonly quality = new PacedQuality(0.5)
  private readonly lite: boolean
  private dpr = 1
  private baseDpr = 1
  private drewLast = false
  private w = 1
  private h = 1
  private margins: Margins = { top: 8, bottom: 8, side: 8 }
  private layout: Layout = LAYOUTS.wide
  /** the camera's resting place for this stage and what it looks at */
  private readonly restPos = new THREE.Vector3()
  private readonly restAt = new THREE.Vector3()
  private reef: ReefSet | null = null
  private cannon: CannonRig | null = null
  private readonly batches = {} as Record<FishId, CreatureBatch>
  private readonly shadows = new Splats(96, false)
  private readonly glows = new Splats(12, true)
  private readonly torpBatch = new TorpedoBatch(MAX_BULLETS)
  private readonly trails: Bubbles
  private readonly streaks = new Streaks(32)
  private readonly wakes = new Streaks(MAX_BULLETS, 'wake')
  private readonly streakList: Streak[] = Array.from({ length: 32 }, () => ({ live: false, x: 0, y: 0, len: 1, speed: 1, life: 0, max: 1 }))
  private readonly reticle = buildReticle()
  private readonly swim: Swimmers
  private readonly torps = new Torpedoes()
  private readonly moments: Moments
  /** the hit's extras, found fresh for each hit */
  private readonly extras: Creature[] = []
  private raf = 0
  private last = 0
  private time = 0
  private disposed = false
  // the cannon and the trigger
  private cost: Cost = COSTS[0]
  private level = 0
  private aim = Math.PI / 2
  private aimTo = Math.PI / 2
  private recoil = 0
  private cooldown = 0
  private shotSeq = 0
  private pressed = false
  private keyHeld = false
  private auto = false
  private refused = false
  private input = true
  private lockMode = false
  private lock: Creature | null = null
  private lockUid = 0
  /**
   * Where the pointer is on the stage (CSS px) and whether it has been seen; every frame it is read back onto the
   * field (`pointer`, for the aim and the camera's lean), so the aim stays under a cursor held still while the camera
   * drifts, leans and pushes in.
   */
  private readonly pointerPx = new THREE.Vector2(0, 0)
  private readonly pointer = new THREE.Vector2(0, 0)
  private pointerSeen = false
  private readonly pick = new THREE.Vector2()
  private pointerId = -1
  private gulp = 0
  private coinGap = 0
  private bounceGap = 0
  // the camera's moods
  private trauma = 0
  private punchX = 0
  private punchV = 0
  private readonly punchAt = new THREE.Vector2()
  private push = 0
  private tideLean = 0
  /** the player asked for less motion: no shake or punch (the slow drift and the whale's gentle push stay) */
  private readonly calm = matchMedia('(prefers-reduced-motion: reduce)')
  /** the way the current tide runs */
  private swimDir: 1 | -1 = 1
  private forceNext = false
  // scratch
  private readonly m4 = new THREE.Matrix4()
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly tp = new THREE.Vector3()
  private readonly ray = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly ndc = new THREE.Vector2()
  private readonly tint = new THREE.Color()
  private readonly onDown: (e: PointerEvent) => void
  private readonly onMove: (e: PointerEvent) => void
  private readonly onUp: (e: PointerEvent) => void
  private readonly onBlur: () => void

  constructor(private readonly host: HTMLElement) {
    // phones and very small machines get the lighter reef (PacedQuality looks after the rest as it plays)
    this.lite = matchMedia('(pointer: coarse)').matches || (navigator.hardwareConcurrency || 8) <= 2
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, this.lite ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor(WATER)
    // count a whole frame (every pass) for stats()
    this.renderer.info.autoReset = false
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:none;cursor:crosshair'
    host.appendChild(cv)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.lite ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.4, 0.92)
    this.composer.addPass(this.bloom)
    this.grade = new ShaderPass(GRADE)
    this.composer.addPass(this.grade)
    this.composer.addPass(new OutputPass())
    const sun = new THREE.DirectionalLight('#fff4dc', 2.1)
    sun.position.set(-3, 10, 5)
    this.scene.add(sun, new THREE.AmbientLight('#d4f1ff', 1.05))

    this.trails = new Bubbles(this.lite ? 360 : 600)
    this.swim = new Swimmers(this.layout)
    this.swim.onEvent = (e) => this.swimEvent(e)
    this.moments = new Moments(
      {
        screen: (x, y, lift, out) => this.screen(x, y, lift, out),
        home: (out) => (this.cannon ? out.copy(this.cannon.root.position).setY(0.55) : out.set(0, 0.55, this.layout.h / 2)),
        shake: (k) => {
          if (!this.calm.matches) this.trauma = Math.min(1, this.trauma + k)
        },
        punch: (k, x, y) => {
          if (this.calm.matches) return
          this.punchV += k * 7
          this.punchAt.set(x, y)
        },
        cue: (c, k) => this.cue(c, k),
        event: (e) => this.emit(e),
        caught: (c) => !this.disposed && this.onCatch?.(c),
        release: (c) => this.swim.remove(c),
        gulp: () => {
          this.gulp = Math.min(1, this.gulp + 0.3)
          if (this.coinGap <= 0) {
            this.coinGap = 0.045
            this.cue('coin', 0)
          }
        },
      },
      this.trails,
    )
    this.scene.add(this.shadows.mesh, this.glows.mesh, this.torpBatch.group, this.trails.points, this.streaks.mesh, this.wakes.mesh, this.reticle, this.moments.group)

    this.onDown = (e) => this.down(e)
    this.onMove = (e) => this.move(e)
    this.onUp = (e) => this.up(e)
    this.onBlur = () => {
      this.pressed = false
      this.keyHeld = false
    }
    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointercancel', this.onUp)
    cv.addEventListener('lostpointercapture', this.onUp)
    window.addEventListener('blur', this.onBlur)

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
    warmUp()
    await step(0.45)
    if (this.disposed) return
    for (const id of CAST_IDS) {
      const b = new CreatureBatch(id, CAPS[id])
      this.batches[id] = b
      this.scene.add(b.mesh)
    }
    this.cannon = buildCannon()
    this.cannon.setLevel(this.level)
    this.scene.add(this.cannon.root)
    this.buildReef()
    await step(0.7)
    if (this.disposed) return
    // every material compiles before the first frame (hidden ones included), for the render target it draws into
    this.reticle.visible = true
    try {
      this.renderer.setRenderTarget(this.composer.readBuffer)
      const compiled = this.renderer.compileAsync(this.scene, this.camera)
      this.renderer.setRenderTarget(null)
      await compiled
    } catch {
      this.renderer.setRenderTarget(null)
      /* compiles on first draw instead */
    }
    this.reticle.visible = false
    if (this.disposed) return
    await step(0.88)
    if (this.disposed) return
    this.composer.render()
    try {
      this.portraits = renderPortraits(this.renderer, 160)
    } catch {
      this.portraits = {}
    }
    this.swim.fill()
    await step(1)
    if (this.disposed) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  /** the reef for the current layout (built again when the layout changes) */
  private buildReef() {
    if (this.reef) {
      this.scene.remove(this.reef.root)
      this.reef.dispose()
    }
    this.reef = buildReef({ lite: this.lite, field: this.layout })
    this.scene.add(this.reef.root)
    this.reef.resize(this.pointScale())
    this.cannon?.root.position.set(0, 0, this.layout.h / 2)
  }

  /* ---------------- the stage ---------------- */

  /** the stage's size in CSS px (call from a ResizeObserver) */
  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    const next = LAYOUTS[pickLayout(w, h, this.margins, this.layout.id)]
    if (next !== this.layout) {
      this.layout = next
      this.swim.setLayout(next)
      this.swim.crowd = this.crowd()
      // once playing, the reef is laid out again round the new field and filled afresh (the whale and the specials
      // swim on across it; a lock on anything else lets go as it leaves)
      if (this.reef) {
        this.buildReef()
        this.swim.fill()
      }
    }
    this.swim.crowd = this.crowd()
    this.applySize()
  }

  /** room to keep clear round the field (CSS px): the overlay's cost badge under the cannon, a banner on top */
  setMargins(m: Partial<Margins>) {
    this.margins = { ...this.margins, ...m }
    this.resize(this.w, this.h)
  }

  private crowd() {
    return Math.round(crowdFor(this.layout) * (this.lite ? 0.82 : 1) * (this.quality.q < 0.6 ? 0.8 : 1))
  }

  /** (canvas height in device px) / (2 tan(fov / 2)): the point sprites' size factor */
  private pointScale() {
    return (this.h * this.dpr) / (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
  }

  private applySize() {
    const { w, h } = this
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.restAt.copy(fitCamera(this.camera, w, h, this.margins, 'bottom', this.layout))
    this.restPos.copy(this.camera.position)
    this.scene.fog = waterFog(this.restPos.distanceTo(this.restAt))
    const s = this.pointScale()
    this.reef?.resize(s)
    this.torpBatch.resize(s)
    this.trails.mat.uniforms.scale.value = s
    this.moments.sparks.mat.uniforms.scale.value = s
    this.cannon?.root.position.set(0, 0, this.layout.h / 2)
    this.reportLayout()
  }

  private reportLayout() {
    if (!this.onLayout) return
    const { w, h } = this.layout
    const p = { x: 0, y: 0 }
    const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      this.screen((sx * w) / 2, (sy * h) / 2, 0, p)
      box.left = Math.min(box.left, p.x)
      box.right = Math.max(box.right, p.x)
      box.top = Math.min(box.top, p.y)
      box.bottom = Math.max(box.bottom, p.y)
    }
    const a = { x: 0, y: 0 }
    const b = { x: 0, y: 0 }
    this.screen(-w / 2, -h / 2, 0, a)
    this.screen(w / 2, -h / 2, 0, b)
    const cannon = { x: 0, y: 0 }
    this.screen(0, -h / 2, 0, cannon)
    this.onLayout({ layout: this.layout.id, field: { w, h }, cannon, rect: box, unit: (b.x - a.x) / w })
  }

  /** a field point (lift above the swim plane) on the stage in CSS px */
  private screen(x: number, y: number, lift: number, out: { x: number; y: number }) {
    this.v.set(x, lift, -y).project(this.camera)
    out.x = ((this.v.x + 1) / 2) * this.w
    out.y = ((1 - this.v.y) / 2) * this.h
  }

  /** a stage point (CSS px) on the field, into out; false if it misses the swim plane */
  private toField(px: number, py: number, out: THREE.Vector2) {
    this.ndc.set((px / this.w) * 2 - 1, -(py / this.h) * 2 + 1)
    this.ray.setFromCamera(this.ndc, this.camera)
    if (!this.ray.ray.intersectPlane(this.plane, this.v)) return false
    out.set(this.v.x, -this.v.z)
    return true
  }

  /* ---------------- the player's controls ---------------- */

  /** the cannon level's cost: the look of the cannon and the cost of the next shots (torpedoes in flight keep theirs) */
  setCost(cost: Cost) {
    const i = COSTS.indexOf(cost)
    if (i < 0) return
    this.cost = cost
    this.level = i
    this.cannon?.setLevel(i)
    this.refused = false
  }

  /** auto fire: shoots at FIRE_RATE at the pointer, or at the locked creature */
  setAuto(on: boolean) {
    this.auto = on
    this.refused = false
  }

  /** lock mode: a press on a creature locks it; locked torpedoes home on it and only hit it. Off releases the lock */
  setLock(on: boolean) {
    this.lockMode = on
    if (!on) this.releaseLock()
  }

  /** locks the creature under a stage point (CSS px), if any; returns its species, or null */
  lockAt(x: number, y: number): FishId | null {
    if (!this.toField(x, y, this.pick)) return null
    const c = this.swim.touching(this.pick.x, this.pick.y, PICK_R)
    if (!c) return null
    this.lock = c
    this.lockUid = c.uid
    this.cue('lock', speciesOf(c.id).mult)
    this.emit({ type: 'lock', target: c.id })
    return c.id
  }

  releaseLock() {
    if (!this.lock) return
    this.lock = null
    this.emit({ type: 'lock', target: null })
  }

  /** where the locked creature is on the stage (CSS px, into out) and what it is; null when nothing is locked */
  lockedAt(out: { x: number; y: number }): FishId | null {
    const c = this.lock
    if (!c) return null
    this.screen(c.x, c.y, 0, out)
    return c.id
  }

  /** aims the cannon at a stage point (CSS px); it stays aimed at that point of the stage */
  aimAt(x: number, y: number) {
    this.pointerPx.set(x, y)
    this.pointerSeen = true
  }

  /** holds the trigger (the space bar): fires now and at FIRE_RATE while held */
  trigger(on: boolean) {
    this.keyHeld = on
    if (!on) this.refused = false
  }

  /** stops the scene taking pointer input (a modal over the stage) and lets go of the trigger */
  setInput(on: boolean) {
    this.input = on
    if (!on) this.pressed = false
  }

  /** every torpedo leaves the water at once, reporting nothing: the screen has squared them up (a cancelled leave) */
  clearBullets() {
    this.torps.clear()
  }

  private down(e: PointerEvent) {
    if (!this.input || (e.pointerType === 'mouse' && e.button !== 0) || !e.isPrimary) return
    const r = this.host.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId)
    } catch {
      /* already released */
    }
    this.pointerId = e.pointerId
    this.aimAt(x, y)
    if (this.lockMode) this.lockAt(x, y)
    this.pressed = true
    this.refused = false
    e.preventDefault()
  }

  private move(e: PointerEvent) {
    if (!e.isPrimary) return
    // a mouse aims as it hovers; a finger only while it is down
    if (e.pointerType !== 'mouse' && !this.pressed) return
    const r = this.host.getBoundingClientRect()
    this.aimAt(e.clientX - r.left, e.clientY - r.top)
  }

  private up(e: PointerEvent) {
    if (e.pointerId !== this.pointerId) return
    this.pointerId = -1
    this.pressed = false
    this.refused = false
  }

  /* ---------------- the frame ---------------- */

  private readonly tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    const t = this.time
    if (import.meta.env.DEV) this.devForce()
    this.coinGap -= dt
    this.bounceGap -= dt
    this.swim.update(dt)
    this.fireControl(dt)
    this.torps.update(dt, this.layout, this.swim, this.contact, this.fizzle, this.bounce)
    this.moments.update(dt)
    this.reef!.tick(t, dt)
    tickCast(t)
    this.placeCannon(dt, t)
    this.placeCamera(dt, t)
    this.draw(dt, t)
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.swim.crowd = this.crowd()
      this.applySize()
    }
    this.drewLast = true
    this.renderer.info.reset()
    this.composer.render()
  }

  /** what the last frame drew and what is in play, for checking the budget */
  stats() {
    const r = this.renderer.info.render
    let creatures = 0
    for (const c of this.swim.list) if (c.alive) creatures++
    return { calls: r.calls, triangles: r.triangles, creatures, torpedoes: this.torps.count, layout: this.layout.id, quality: this.quality.q }
  }

  /** the trigger: aim, and a shot whenever it is held (or auto is on) and the cannon is ready */
  private fireControl(dt: number) {
    const lock = this.lock
    if (lock && (!lock.alive || lock.uid !== this.lockUid || lock.mode === 'held' || !this.swim.onField(lock, 0))) this.releaseLock()
    // the pointer's stage point onto the field as the camera is now
    if (this.pointerSeen) this.toField(this.pointerPx.x, this.pointerPx.y, this.pointer)
    if (this.lock) this.aimTo = this.aimFor(this.lock.x, this.lock.y)
    else if (this.pointerSeen) this.aimTo = this.aimFor(this.pointer.x, this.pointer.y)
    this.aim += turn(this.aim, this.aimTo) * Math.min(1, dt * 14)
    this.cooldown = Math.max(-0.05, this.cooldown - dt)
    const want = ((this.pressed || this.keyHeld) && this.input) || this.auto
    if (want && !this.refused && this.cooldown <= 0) this.shoot()
  }

  /** the cannon's heading to a field point (it can't aim below flat) */
  private aimFor(x: number, y: number) {
    const dy = y + this.layout.h / 2
    let a = Math.atan2(dy, x)
    if (a < 0) a = x >= 0 ? AIM_MIN : Math.PI - AIM_MIN
    return clamp(a, AIM_MIN, Math.PI - AIM_MIN)
  }

  private shoot() {
    const cannon = this.cannon
    if (!cannon || this.torps.count >= MAX_BULLETS) return false
    const shot = ++this.shotSeq
    if (this.onFire && !this.onFire(shot, this.cost)) {
      this.refused = true
      return false
    }
    // the barrel snaps onto the aim as it fires, so the torpedo leaves exactly where the player pointed
    this.aim = this.aimTo
    cannon.setAim(this.aim)
    cannon.setRecoil(0)
    cannon.root.updateMatrixWorld(true)
    const mz = cannon.muzzle(this.v)
    this.torps.fire(shot, this.cost, this.level, mz.x, -mz.z, this.aim, this.lock)
    this.cooldown += 1 / FIRE_RATE
    this.recoil = 1
    // a puff of bubbles out of the muzzle and a quick pressure ring round it
    this.trails.burst(mz.x, mz.y, mz.z, 10, 1.5, 0.1, 0.55)
    this.moments.ring(mz.x, -mz.z, 0.5 + this.level * 0.04, 0.24, 0.5, mz.y)
    this.cue('shot', this.level)
    return true
  }

  /** where a torpedo at field (x, y) is drawn: on the camera's ray through that point, TORP_Y over the swim plane */
  private overField(x: number, y: number, out: THREE.Vector3) {
    const c = this.camera.position
    const k = (c.y - TORP_Y) / c.y
    return out.set(c.x + (x - c.x) * k, TORP_Y, c.z + (-y - c.z) * k)
  }

  private readonly contact = (t: Torpedo, c: Creature) => {
    const kind = speciesOf(c.id).kind
    const ex = this.extras
    ex.length = 0
    if (kind === 'bomb') this.swim.reach(c, 'bomb', ex)
    else if (kind === 'chain') this.swim.reach(c, 'chain', ex)
    const forced = this.forceNext || c.forced
    this.forceNext = false
    // the screen's resolver decides it; should it ever throw, the reef plays a miss and carries on
    let out: HitOutcome | null = null
    try {
      out = this.onHit?.({ shot: t.shot, cost: t.cost, target: c.id, extras: ex.map((e) => e.id), forced }) ?? null
    } catch (err) {
      console.error(err)
    }
    const res: HitOutcome = out ?? { caught: false, value: 0, mult: 0, extras: [] }
    if (res.caught) {
      // the catch and everything caught along with it are out of play from this instant
      c.mode = 'held'
      for (let i = 0; i < res.extras.length && i < ex.length; i++) ex[i].mode = 'held'
    }
    this.moments.play(t.shot, t.cost, c, ex, res, t.dx, t.dy)
  }

  private readonly fizzle = (t: Torpedo) => {
    const p = this.overField(t.x, t.y, this.tp)
    this.trails.burst(p.x, p.y, p.z, 7, 1.4, 0.09, 0.6)
    this.cue('fizzle', 0)
    if (!this.disposed) this.onFizzle?.(t.shot, t.cost)
  }

  private readonly bounce = (t: Torpedo) => {
    const p = this.overField(t.x, t.y, this.tp)
    this.trails.burst(p.x, p.y, p.z, 4, 1, 0.07, 0.4)
    if (this.bounceGap <= 0) {
      this.bounceGap = 0.08
      this.cue('bounce', 0)
    }
  }

  private placeCannon(dt: number, t: number) {
    const c = this.cannon!
    this.recoil = Math.max(0, this.recoil - dt * 6)
    this.gulp = Math.max(0, this.gulp - dt * 3)
    c.setAim(this.aim)
    c.setRecoil(this.recoil * this.recoil)
    c.root.scale.setScalar(1 + 0.07 * Math.sin(this.gulp * Math.PI))
    c.tick(t)
  }

  /** the camera at rest, plus its moods: a slow drift, a lean towards the pointer, the whale push, punches and shake */
  private placeCamera(dt: number, t: number) {
    const cam = this.camera
    const L = this.layout
    this.trauma = Math.max(0, this.trauma - dt * 1.5)
    // the punch: a spring kicked by big catches
    this.punchV += (-this.punchX * 60 - this.punchV * 9) * dt
    this.punchX += this.punchV * dt
    this.push += ((this.swim.whaleOn ? 1 : 0) - this.push) * Math.min(1, dt * 0.5)
    this.tideLean += ((this.swim.tideOn ? 1 : 0) - this.tideLean) * Math.min(1, dt * 1.5)
    const dist = this.restPos.distanceTo(this.restAt)
    // look a touch towards the pointer and the punch, drift slowly
    const lx = (this.pointerSeen ? clamp(this.pointer.x / (L.w / 2), -1, 1) * 0.12 : 0) + Math.sin(t * 0.13) * 0.1 + this.punchX * 0.04 * this.punchAt.x
    const ly = Math.sin(t * 0.11 + 1) * 0.07 + this.punchX * 0.04 * this.punchAt.y
    const zoom = this.push * 0.055 * dist + this.punchX * 0.5
    this.v2.copy(this.restPos).sub(this.restAt).normalize()
    const s = this.trauma * this.trauma
    const sx = s * 0.35 * (Math.sin(t * 47) + Math.sin(t * 31 + 1.7) * 0.6)
    const sz = s * 0.3 * (Math.sin(t * 53 + 0.4) + Math.sin(t * 29 + 2.2) * 0.6)
    this.v.set(this.restAt.x + lx + sx + this.tideLean * 0.2, this.restAt.y, this.restAt.z - ly + sz)
    cam.position.copy(this.v).addScaledVector(this.v2, dist - zoom)
    cam.lookAt(this.v)
    cam.updateMatrixWorld()
  }

  private draw(dt: number, t: number) {
    const { shadows, glows, torpBatch, streaks, wakes } = this
    for (let i = 0; i < CAST_IDS.length; i++) this.batches[CAST_IDS[i]].begin()
    shadows.begin()
    glows.begin()
    torpBatch.begin()
    streaks.begin()
    wakes.begin()
    for (let ci = 0; ci < this.swim.list.length; ci++) {
      const c = this.swim.list[ci]
      if (!c.alive) continue
      creatureMatrix(this.m4, c.id, c.x, c.y, c.heading, c.bank, c.scale, c.roll, c.lift)
      this.batches[c.id].put(this.m4, c.clock, c.pose, c.flash, c.mood, c.fade)
      if (c.fade >= 1) continue
      // a soft shadow on the sand, down and right of it (the sun is up at the top left)
      const hs = CAST[c.id].hit
      const k = CAST[c.id].size * c.scale
      const z = -c.y
      const turnY = CAST[c.id].orient === 'swim' ? c.heading : 0
      shadows.put(c.x + 0.35, floorAt(c.x, z) + 0.02, z + 0.55, hs.a * k * 2.2, hs.b * k * 2.4, turnY, SHADOW, 0.32 * (1 - c.fade) * (1 - c.lift * 0.6))
      const glow = GLOWS[c.id]
      if (glow) {
        const big = c.id === 'chest' && c.mode === 'held' ? 1.5 : 1
        glows.put(c.x, -0.35, z, hs.a * k * 3.4 * big, hs.a * k * 3.4 * big, 0, this.tint.set(glow), (0.5 + 0.2 * Math.sin(t * 3 + c.seed)) * (1 - c.fade) * (big > 1 ? 1.5 : 1))
      }
    }
    for (let k = 0; k < this.torps.list.length; k++) {
      const tp = this.torps.list[k]
      if (!tp.live) continue
      const heading = Math.atan2(tp.dy, tp.dx)
      const p = this.overField(tp.x, tp.y, this.tp)
      torpBatch.put(p.x, p.y, p.z, heading, tp.level, t + tp.shot)
      // its wake: a streak in its level's colour stretching out behind as it gets going, and a string of bubbles
      const len = WAKE * Math.min(1, tp.age * 6)
      const w = this.overField(tp.x - tp.dx * len * 0.5, tp.y - tp.dy * len * 0.5, this.v2)
      wakes.put(w.x, w.y - 0.04, w.z, len, 0.36, heading, 0.75, this.tint.set(LEVEL_COLORS[tp.level]).lerp(WHITE, 0.45))
      tp.trail -= dt
      if (tp.trail <= 0) {
        tp.trail = 0.035
        const b = this.overField(tp.x - tp.dx * 0.32, tp.y - tp.dy * 0.32, this.v2)
        this.trails.emit(b.x + (Math.random() - 0.5) * 0.08, b.y, b.z + (Math.random() - 0.5) * 0.08, 0, 0.2, 0, 0.07 + Math.random() * 0.06, 0.6 + Math.random() * 0.3, 0.04)
      }
    }
    this.drawStreaks(dt)
    for (let i = 0; i < CAST_IDS.length; i++) this.batches[CAST_IDS[i]].end()
    shadows.end()
    glows.end()
    torpBatch.end()
    streaks.end()
    wakes.end()
    this.trails.update(dt)
    // the lock marker spins on its creature
    const lock = this.lock
    this.reticle.visible = !!lock
    if (lock) {
      this.reticle.position.set(lock.x, 0.45, -lock.y)
      this.reticle.scale.setScalar(hitRadius(lock.id) * 1.9 * (1 + 0.06 * Math.sin(t * 6)))
      this.reticle.rotation.y = t * 1.3
    }
  }

  /** the tide's swoosh lines racing across the reef while it sweeps */
  private drawStreaks(dt: number) {
    const L = this.layout
    const dir = this.swimDir
    if (this.swim.tideOn && Math.random() < dt * 22) {
      let s: Streak | null = null
      for (const q of this.streakList)
        if (!q.live) {
          s = q
          break
        }
      if (s) {
        s.live = true
        s.len = 2.2 + Math.random() * 2.6
        s.x = -dir * (L.w / 2 + s.len)
        s.y = (Math.random() - 0.5) * L.h * 0.95
        s.speed = 9 + Math.random() * 5
        s.life = s.max = (L.w + s.len * 2) / s.speed
      }
    }
    for (let si = 0; si < this.streakList.length; si++) {
      const s = this.streakList[si]
      if (!s.live) continue
      s.life -= dt
      if (s.life <= 0) {
        s.live = false
        continue
      }
      s.x += dir * s.speed * dt
      const u = 1 - s.life / s.max
      this.streaks.put(s.x, 0.5, -s.y, s.len, 0.5 + s.len * 0.12, dir > 0 ? 0 : Math.PI, Math.min(1, u * 6, (1 - u) * 4))
    }
  }

  /* ---------------- events ---------------- */

  private swimEvent(e: SwimEvent) {
    if (e.type === 'tide') this.swimDir = e.dir
    this.emit(e)
  }

  private emit(e: ReefEvent) {
    if (!this.disposed) this.onEvent?.(e)
  }

  private cue(c: Cue, k: number) {
    if (!this.disposed) this.onCue?.(c, k)
  }

  /**
   * Dev only: window.__reefForce = 'catch' (the next hit catches), 'whale' (the whale now), 'tide' (a tide now),
   * 'bomb' | 'jelly' | 'chest' (that special swims in near the middle, and the next hit on it catches).
   */
  private devForce() {
    const w = window as unknown as { __reefForce?: string }
    const f = w.__reefForce
    if (!f) return
    delete w.__reefForce
    if (f === 'catch') this.forceNext = true
    else if (f === 'whale') this.swim.whaleNow()
    else if (f === 'tide') this.swim.tideNow()
    else if (f === 'bomb' || f === 'jelly' || f === 'chest') {
      const c = this.swim.spawnSpecial(f === 'bomb' ? 'crab' : f, true)
      if (c) c.forced = true
    }
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
    window.removeEventListener('blur', this.onBlur)
    this.torps.clear()
    this.moments.clear()
    for (const id of CAST_IDS) this.batches[id]?.dispose()
    this.cannon?.dispose()
    this.reef?.dispose()
    this.moments.dispose()
    this.shadows.dispose()
    this.glows.dispose()
    this.torpBatch.dispose()
    this.trails.dispose()
    this.streaks.dispose()
    this.wakes.dispose()
    this.reticle.geometry.dispose()
    ;(this.reticle.material as THREE.Material).dispose()
    releaseModels()
    this.bloom.dispose()
    this.grade.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}
