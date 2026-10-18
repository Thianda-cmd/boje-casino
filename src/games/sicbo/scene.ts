import * as THREE from 'three'
import { PacedQuality, glowTexture } from '../../lib/three/fx'
import { DOME_R, HALF, domePose, planRoll, poseAt, restPoses, topFace, type Hit, type Pose, type Roll } from './physics'
import { GLASS_T, PLINTH_H, collar, diceGeometry, diceMaterial, domeFloor, domeGlass, plinth, releaseModels, studioEnvironment, type GlassUniforms } from './models'
import PlanWorker from './plan.worker?worker&inline'
import type { PlanReply, PlanRequest } from './plan.worker'
import type { Dice, Die } from './rules'

/*
  The Sic Bo stage: a glass dome on a gold pedestal in a dark, softly lit room, three ivory dice lying on its jade
  felt. A roll is real rigid-body physics worked out ahead (physics.ts): the pedestal kicks the dome, the dice tumble,
  knock against the glass and each other, and settle; the dice's pips are turned within their bodies in clear flight
  so they land on the faces that were drawn. The dome is shown exactly as it was simulated (its jolts and rocking),
  with a small ring of the glass on every knock and a touch of camera shake on the hard ones.

  How the screen uses it:
    const sc = new SicBoScene(host)            // a canvas fills host; sc.onProgress(p) while it loads
    await sc.ready                             // rejects never; a missing WebGL throws from the constructor
    sc.resize(w, h); sc.setFrame(box, smooth)  // the canvas size, and where in it the dome should sit (CSS px)
    sc.plan(dice)                              // start working the roll out (in a worker), e.g. as strikes play
    await sc.shake(dice, cues)                 // the shake; cues: kick, hit (sounds), readable; resolves at rest
    sc.focus(false)                            // back from the close look at the dice, when betting reopens
  The camera eases in to read the faces by itself once they can be read (focus(true)); the next shake, or
  focus(false), takes it back. Everything runs on the scene clock; turbo plays a shorter shake a touch faster.

  Rolls are worked out in plan.worker.ts, so the search for a good shake never stalls a frame; where workers can't
  run (or one fails to answer) the same search runs here instead. At rest the scene draws only what still moves (the
  room's lights breathing, the camera's sway) and soon drops to a dozen frames a second; the shadows are drawn again
  only when something moved.
*/

const FOV = 30
/** the camera at rest: how high it looks down on the dome (radians) */
const IDLE_EL = 0.55
/** the close look at the dice */
const FOCUS_EL = 1.02
/** sim seconds per real second: normal and turbo (whose shake is shorter as well) */
const RATE_NORMAL = 1
const RATE_TURBO = 1.25
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
/** frame-rate independent approach: covers 1 - e^(-k dt) of the way */
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt)

export interface ShakeCues {
  /** the pedestal kicks the dome (k: 0-1, how hard) */
  kick?: (k: number) => void
  /** a die knocks the felt, the glass or another die (k: 0-1, how hard; h.on says which, h.v the speed) */
  hit?: (h: Hit, k: number) => void
  /** every die lies flat: the faces can be read (the camera starts to lean in) */
  readable?: () => void
}

interface Play {
  roll: Roll
  t: number
  rate: number
  hit: number
  kick: number
  readable: boolean
  cues: ShakeCues
  done: () => void
}

/** a roll being worked out: for which faces, from which resting dice; null once it can no longer be used */
interface Job {
  dice: Dice
  start: Pose[]
  roll: Promise<Roll | null>
}

/** how long a worker may take over a roll before the scene works it out itself (ms) */
const PLAN_PATIENCE = 3000

/** where in the canvas the dome is framed (CSS px); the whole canvas by default */
export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

export class SicBoScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200)
  private readonly own: { dispose: () => void }[] = []
  private readonly quality = new PacedQuality()
  private env: THREE.WebGLRenderTarget | null = null
  private readonly key: THREE.DirectionalLight
  private readonly keyK: number
  /** the dome: the felt, the collar, the glass and the dice move with it; the plinth stays put */
  private readonly dome = new THREE.Group()
  private readonly dice: THREE.Mesh[] = []
  private readonly blobs: THREE.Mesh[] = []
  private readonly backMat: THREE.ShaderMaterial
  private readonly tableMat: THREE.ShaderMaterial
  private readonly glass: GlassUniforms = { uK: { value: 1 }, uFar: { value: 0.55 }, uTurn: { value: new THREE.Matrix3() }, uFlash: { value: new THREE.Color(0, 0, 0) } }

  // the dice at rest; the roll being worked out, the one worked out, the one in play
  private rest: Pose[]
  private planning: Job | null = null
  private planned: { dice: Dice; start: Pose[]; roll: Roll } | null = null
  private play: Play | null = null
  private planner: Worker | null = null
  private jobs = 0
  private readonly waiting = new Map<number, (roll: Roll | null) => void>

  // the camera's rig (it stands in front, +z): what it looks at, how high (radians), how far; and where it is going
  private readonly camT = V3(0, 1, 0)
  private camEl = IDLE_EL
  private camD = 18
  private readonly goalT = V3(0, 1, 0)
  private goalEl = IDLE_EL
  private goalD = 18
  private focused = false
  /** the idle view, worked out for the frame: what it looks at, and from how far */
  private readonly idleT = V3(0, 1, 0)
  private idleD = 18
  /** camera shake, world units */
  private jolt = 0
  private readonly look = new THREE.Vector2()
  private readonly lookTo = new THREE.Vector2()
  /** the frame as shown, and the one it is easing to (a smooth setFrame) */
  private box: FrameBox | null = null
  private boxTo: FrameBox | null = null

  // the glass's ring after a knock: a damped spring tilting the dome about two level axes
  private wobX = 0
  private wobZ = 0
  private wobVX = 0
  private wobVZ = 0
  private flashK = 0

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private raf = 0
  private last = 0
  private acc = 0
  private clock = 0
  /** seconds since anything last moved (the idle frame rate drops after a few) */
  private calm = 0
  /** the shadows want drawing again (something moved since) */
  private shadowDirty = true
  private drewLast = false
  private disposed = false
  private paused = false
  private turbo = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  // scratch, so a frame allocates nothing
  private readonly pose = new Float32Array(7)
  private readonly dp = new Float32Array(5)
  private readonly te = new THREE.Euler()
  private readonly tm = new THREE.Matrix4()
  private readonly tv = V3()

  constructor(el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.6 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setClearColor('#070204')
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    // drawn again only when something moved (see tick)
    this.renderer.shadowMap.autoUpdate = false
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:manipulation'
    el.appendChild(cv)

    // the room: deep ruby fading to black, warmer behind the dome, its lights far off and out of focus
    this.backMat = new THREE.ShaderMaterial({
      uniforms: { uAspect: { value: 1 }, uFlash: { value: 0 }, uTime: { value: 0 }, uCenter: { value: new THREE.Vector2(0.5, 0.55) }, uSize: { value: 1 } },
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
    // the table the pedestal stands on: dark lacquer in a pool of warm light, melting into the room at its edge
    this.tableMat = new THREE.ShaderMaterial({
      uniforms: { uFlash: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: TABLE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    const table = new THREE.Mesh(new THREE.CircleGeometry(14, 96).rotateX(-Math.PI / 2), this.tableMat)
    table.renderOrder = -5
    table.position.y = -PLINTH_H
    this.scene.add(table)
    this.own.push(table.geometry, this.tableMat)

    // the key light, from above and to the front left, casting the dice's shadows on the felt
    this.keyK = 2.3
    this.key = new THREE.DirectionalLight('#fff1dc', this.keyK)
    this.key.position.set(-3.2, 11, 5.2)
    this.key.castShadow = true
    const sc = this.key.shadow.camera
    sc.left = sc.bottom = -DOME_R - 0.6
    sc.right = sc.top = DOME_R + 0.6
    sc.near = 4
    sc.far = 22
    this.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    this.key.shadow.bias = -0.0004
    this.key.shadow.normalBias = 0.015
    this.key.shadow.radius = 3
    this.scene.add(this.key, this.key.target)
    // a warm rim from behind on the right
    const rim = new THREE.DirectionalLight('#ffc98a', 0.7)
    rim.position.set(6, 5, -7)
    this.scene.add(rim)

    // soft dark blots under the dice where they meet the felt (the shadow map's light is from one side only)
    const blobGeo = new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2)
    this.own.push(blobGeo)
    for (let i = 0; i < 3; i++) {
      const b = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#000000', transparent: true, opacity: 0.5, depthWrite: false }))
      b.renderOrder = 2
      this.blobs.push(b)
      this.dome.add(b)
      this.own.push(b.material as THREE.Material)
    }
    this.scene.add(this.dome)

    this.rest = restPoses([randDie(), randDie(), randDie()])
    // started now, so it is warm by the first roll
    try {
      this.planner = new PlanWorker()
      this.planner.onmessage = (e: MessageEvent<PlanReply>) => {
        const r = e.data
        this.waiting.get(r.id)?.('roll' in r ? r.roll : null)
      }
      this.planner.onerror = () => this.dropPlanner()
    } catch {
      this.planner = null
    }

    this.onMove = (e) => {
      if (e.pointerType === 'touch') return
      const r = cv.getBoundingClientRect()
      this.lookTo.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    }
    this.onLeave = () => this.lookTo.set(0, 0)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerleave', this.onLeave)

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
    await step(0.05)
    if (this.disposed) return
    // the studio, prefiltered for this renderer: what the gold, the lacquer and the dice's gloss reflect
    this.env = studioEnvironment(this.renderer)
    this.scene.environment = this.env.texture
    await step(0.25)
    if (this.disposed) return
    // the dice's faces are painted pixel by pixel (the heaviest step), cached for the next visit
    const diceMat = diceMaterial()
    await step(0.55)
    if (this.disposed) return
    this.scene.add(plinth())
    this.dome.add(...domeFloor(), collar(), ...domeGlass(this.glass))
    const geo = diceGeometry()
    for (let i = 0; i < 3; i++) {
      const d = new THREE.Mesh(geo, diceMat)
      d.castShadow = true
      d.receiveShadow = true
      this.dice.push(d)
      this.dome.add(d)
    }
    this.placeRest()
    await step(0.75)
    if (this.disposed) return
    // every shader once, so nothing compiles mid-roll
    try {
      await this.renderer.compileAsync(this.scene, this.camera)
    } catch {
      /* compiles on first draw instead */
    }
    if (this.disposed) return
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
    await step(1)
    if (this.disposed) return
    this.snapCamera()
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.backMat.uniforms.uAspect.value = w / h
    this.applyFrame()
  }

  /**
   * Where the dome should sit in the canvas (CSS px): the camera centres it in that box and fits it to it (the rest
   * of the canvas still shows the room). Null: the whole canvas. `smooth` glides there (the stage making room for
   * the dome, say) instead of cutting.
   */
  setFrame(box: FrameBox | null, smooth = false) {
    if (smooth && box && this.box) {
      this.boxTo = { ...box }
      return
    }
    this.box = box && { ...box }
    this.boxTo = null
    this.applyFrame()
  }

  setTurbo(on: boolean) {
    this.turbo = on
  }

  /** the faces the dice show as they lie */
  get faces(): Dice {
    return this.rest.map((p) => topFace(p.q)) as unknown as Dice
  }

  get playing() {
    return !!this.play
  }

  /** lays the dice out afresh showing `dice` (between rounds only: say, the last roll on a return visit) */
  setRest(dice: Dice) {
    if (this.play) return
    this.rest = restPoses(dice)
    this.planning = null
    this.planned = null
    this.placeRest()
  }

  /* ---------------- a roll ---------------- */

  /**
   * Starts working out the next roll, from the dice as they lie to rest on `dice`, off the main thread: call it as
   * early as possible, say as the lucky strikes begin. Resolves with how long the shake will take to play (seconds),
   * or 0 if the scene went away first.
   */
  plan(dice: Dice): Promise<number> {
    return this.job(dice).roll.then((r) => (r ? r.sim.end / this.rate() : 0))
  }

  /**
   * Shakes the dome: the dice tumble and land on `dice` (worked out now, if plan() was not called for them; the dice
   * wait still until it is). Resolves when they are at rest; the cues fire on the kicks, on each knock and when the
   * faces can be read.
   */
  shake(dice: Dice, cues: ShakeCues = {}) {
    return new Promise<void>((done) => {
      if (this.disposed) return done()
      this.focus(false)
      const start = (roll: Roll | null) => {
        if (!roll || this.disposed) return done()
        this.planning = null
        this.planned = null
        this.focus(false)
        this.play = { roll, t: 0, rate: this.rate(), hit: 0, kick: 0, readable: false, cues, done }
      }
      // a roll already worked out starts at once (a test stepping the clock relies on that); else when it is ready
      const p = this.planned
      if (p && sameDice(p.dice, dice) && p.start === this.rest) start(p.roll)
      else void this.job(dice).roll.then(start)
    })
  }

  /** the roll for `dice` from the dice as they lie: the one being worked out, if it is that one, or a new one */
  private job(dice: Dice): Job {
    const j = this.planning
    if (j && sameDice(j.dice, dice) && j.start === this.rest) return j
    const start = this.rest
    const quick = this.turbo
    const roll = this.solve(start, [...dice], quick).then((r) => {
      // kept for shake() unless the dice were laid out afresh meanwhile
      if (r && this.planning === job) this.planned = { dice: [...dice] as unknown as Dice, start, roll: r }
      return r
    })
    const job: Job = { dice: [...dice] as unknown as Dice, start, roll }
    this.planning = job
    return job
  }

  /** a roll from the worker, or worked out here if there is none or it fails to answer in time; null once disposed */
  private solve(start: Pose[], faces: Die[], quick: boolean): Promise<Roll | null> {
    const here = () => {
      if (this.disposed) return null
      try {
        return planRoll(start, faces, { quick })
      } catch {
        // never expected; the dice then stay as they lie and the screen still shows the roll
        return null
      }
    }
    const w = this.planner
    if (!w) return Promise.resolve().then(here)
    return new Promise((resolve) => {
      const id = ++this.jobs
      const timer = window.setTimeout(() => this.waiting.get(id)?.(null), PLAN_PATIENCE)
      this.waiting.set(id, (roll) => {
        this.waiting.delete(id)
        clearTimeout(timer)
        resolve(roll ?? here())
      })
      const req: PlanRequest = { id, start, faces, quick }
      w.postMessage(req)
    })
  }

  /** the worker failed: every roll it owes is worked out here, and so is every one after */
  private dropPlanner() {
    this.planner?.terminate()
    this.planner = null
    for (const answer of [...this.waiting.values()]) answer(null)
  }

  /** the close look at the dice (on), or back to the whole dome (off) */
  focus(on: boolean) {
    this.focused = on
    this.goals()
  }

  /** a flash of light over the dome (a lightning strike's), 0-1 */
  flash(k: number) {
    this.flashK = Math.max(this.flashK, Math.min(1.5, k))
  }

  private rate() {
    return this.turbo ? RATE_TURBO : RATE_NORMAL
  }

  /* ---------------- the clock ---------------- */

  /** dev only: holds the clock, so a test can step it exactly (debugStep) and capture what it sees */
  debugPause(on: boolean) {
    this.paused = on
    this.last = performance.now()
  }

  debugStep(seconds: number, fps = 60) {
    for (let t = 0; t < seconds - 1e-6; t += 1 / fps) {
      this.clock += 1 / fps
      this.update(1 / fps)
    }
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    if (this.paused) return
    const gap = Math.max(0, (now - this.last) / 1000)
    this.acc += Math.min(0.1, gap)
    this.last = now
    const lively =
      !!this.play ||
      !!this.boxTo ||
      this.flashK > 0.002 ||
      this.jolt > 0.001 ||
      Math.abs(this.wobX) + Math.abs(this.wobZ) + Math.abs(this.wobVX) + Math.abs(this.wobVZ) > 1e-4 ||
      this.camT.distanceToSquared(this.goalT) > 1e-5 ||
      Math.abs(this.camD - this.goalD) > 1e-3 ||
      Math.abs(this.camEl - this.goalEl) > 1e-4 ||
      this.look.distanceToSquared(this.lookTo) > 1e-5
    this.calm = lively ? 0 : this.calm + gap
    // at rest only the room's lights breathe and the camera sways, slowly: 30 frames a second while things settle,
    // then a dozen (a sway that slow moves less than a pixel a frame), which spares a phone's battery
    if (!lively && this.acc < (this.calm > 3 ? 1 / 12 : 1 / 31)) {
      this.drewLast = false
      return
    }
    const dt = Math.min(lively ? 0.05 : 0.1, this.acc)
    this.acc = 0
    this.clock += dt
    this.update(dt)
    if (this.quality.frame(now, this.drewLast && lively) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    // the shadows only change when the dice or the dome move
    this.renderer.shadowMap.needsUpdate = lively || this.shadowDirty
    this.shadowDirty = false
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number) {
    if (this.play) this.advance(dt)
    if (this.boxTo) this.glideFrame(dt)
    this.wobble(dt)
    this.moveCamera(dt)
    this.updateLights(dt)
  }

  /** a smooth setFrame on its way: the box eases to its goal (and the camera, easing after it, follows) */
  private glideFrame(dt: number) {
    const b = this.box!
    const to = this.boxTo!
    const k = ease(6, dt)
    b.x = lerp(b.x, to.x, k)
    b.y = lerp(b.y, to.y, k)
    b.w = lerp(b.w, to.w, k)
    b.h = lerp(b.h, to.h, k)
    if (Math.abs(b.x - to.x) + Math.abs(b.y - to.y) + Math.abs(b.w - to.w) + Math.abs(b.h - to.h) < 0.5) {
      this.box = to
      this.boxTo = null
    }
    this.applyFrame()
  }

  /** the roll in play, on: the dome and the dice where the record has them, the cues as their moments pass */
  private advance(dt: number) {
    const p = this.play!
    const s = p.roll.sim
    p.t = Math.min(s.end, p.t + dt * p.rate)
    this.placeRoll(p.roll, p.t)
    while (p.kick < s.kicks.length && s.kicks[p.kick].t <= p.t) {
      const k = s.kicks[p.kick++].k
      this.jolt = Math.max(this.jolt, 0.025 * k)
      p.cues.kick?.(k)
    }
    while (p.hit < s.hits.length && s.hits[p.hit].t <= p.t) {
      const h = s.hits[p.hit++]
      const k = clamp01(h.v / 14)
      // the glass rings when a die knocks it, a little when they knock the felt or each other
      const push = (h.on === 'glass' ? 0.0045 : 0.0012) * k
      const r = Math.hypot(h.x, h.z) || 1
      this.wobVX += (h.z / r) * push * 60
      this.wobVZ -= (h.x / r) * push * 60
      if (h.on === 'glass' && k > 0.5) this.jolt = Math.max(this.jolt, 0.012 * k)
      p.cues.hit?.(h, k)
    }
    if (!p.readable && p.t >= s.readable) {
      p.readable = true
      this.focus(true)
      p.cues.readable?.()
    }
    if (p.t >= s.end) {
      this.rest = p.roll.final
      this.play = null
      this.placeRest()
      if (!p.readable) {
        this.focus(true)
        p.cues.readable?.()
      }
      p.done()
    }
  }

  /** the dome and the dice at time t of a roll */
  private placeRoll(roll: Roll, t: number) {
    const d = this.dp
    domePose(roll, t, d)
    this.dome.position.set(d[0], d[1], d[2])
    this.te.set(d[3] + this.wobX, 0, d[4] + this.wobZ)
    this.dome.quaternion.setFromEuler(this.te)
    for (let i = 0; i < 3; i++) {
      poseAt(roll, i, t, this.pose)
      this.placeDie(i)
    }
  }

  /** the dice lying still, the dome at home */
  private placeRest() {
    this.shadowDirty = true
    this.dome.position.set(0, 0, 0)
    this.te.set(this.wobX, 0, this.wobZ)
    this.dome.quaternion.setFromEuler(this.te)
    for (let i = 0; i < this.dice.length; i++) {
      const r = this.rest[i]
      const o = this.pose
      o[0] = r.x
      o[1] = HALF
      o[2] = r.z
      o[3] = r.q[0]
      o[4] = r.q[1]
      o[5] = r.q[2]
      o[6] = r.q[3]
      this.placeDie(i)
    }
  }

  /** die i from the pose in scratch, and its blot on the felt (darker and tighter the nearer the felt it is) */
  private placeDie(i: number) {
    const o = this.pose
    const d = this.dice[i]
    if (!d) return
    d.position.set(o[0], o[1], o[2])
    d.quaternion.set(o[3], o[4], o[5], o[6])
    const b = this.blobs[i]
    const up = Math.max(0, o[1] - HALF)
    b.position.set(o[0] + 0.05, 0.004, o[2] + 0.04)
    b.scale.setScalar(1 + up * 0.35)
    ;(b.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.exp(-up * 1.3)
  }

  /** the glass's ring: a spring, quick and lightly damped */
  private wobble(dt: number) {
    const w0 = Math.PI * 2 * 6.5
    const z = 0.16
    const n = Math.max(1, Math.ceil(dt / (1 / 240)))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      this.wobVX += (-w0 * w0 * this.wobX - 2 * z * w0 * this.wobVX) * h
      this.wobVZ += (-w0 * w0 * this.wobZ - 2 * z * w0 * this.wobVZ) * h
      this.wobX += this.wobVX * h
      this.wobZ += this.wobVZ * h
    }
    if (!this.play) {
      this.te.set(this.wobX, 0, this.wobZ)
      this.dome.quaternion.setFromEuler(this.te)
    }
  }

  /* ---------------- camera ---------------- */

  /** the camera's goals for the state the stage is in: the whole dome, or close over the dice */
  private goals() {
    if (!this.focused) {
      this.goalT.copy(this.idleT)
      this.goalEl = IDLE_EL
      this.goalD = this.idleD
      return
    }
    // close over the dice as they lie (or will lie), looking well down so their tops read
    const r = this.play?.roll.final ?? this.rest
    let cx = 0
    let cz = 0
    for (const p of r) {
      cx += p.x / 3
      cz += p.z / 3
    }
    this.goalEl = FOCUS_EL
    const pts: THREE.Vector3[] = []
    for (const p of r) for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) pts.push(V3(p.x + dx, HALF + 0.5, p.z + dz), V3(p.x + dx, 0, p.z + dz))
    // (closer on a small frame, where the dice would otherwise read small; never so close that the glass's rim
    // leaves a desktop frame, since the screen's readout shows the faces as well)
    const b = this.box ?? { x: 0, y: 0, w: this.w, h: this.h }
    const f = this.frameOn(pts, FOCUS_EL, Math.min(b.w, b.h) < 300 ? 0.62 : 0.48, V3(cx, HALF, cz))
    // never closer than the glass allows, never farther than the whole-dome view
    this.goalT.copy(f.target)
    this.goalD = Math.min(this.idleD * 0.92, Math.max(DOME_R + GLASS_T + 1.2, f.d))
  }

  private snapCamera() {
    this.goals()
    this.camT.copy(this.goalT)
    this.camEl = this.goalEl
    this.camD = this.goalD
    this.moveCamera(0)
  }

  /** the frame: where the dome sits in the canvas (the camera's centre is shifted there), and the idle distance */
  private applyFrame() {
    const W = this.w
    const H = this.h
    const b = this.box ?? { x: 0, y: 0, w: W, h: H }
    const cx = b.x + b.w / 2
    const cy = b.y + b.h / 2
    const FW = 2 * Math.max(cx, W - cx)
    const FH = 2 * Math.max(cy, H - cy)
    const cam = this.camera
    cam.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * (FH / H)))
    cam.aspect = FW / FH
    cam.setViewOffset(FW, FH, FW / 2 - cx, FH / 2 - cy, W, H)
    cam.updateProjectionMatrix()
    // the whole dome and its collar, and the gem on the plinth, in the box (the plinth's foot may run out below)
    const pts: THREE.Vector3[] = [V3(0, DOME_R + GLASS_T + 0.1, 0), V3(0, -PLINTH_H + 0.12, DOME_R + 0.75)]
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      pts.push(V3(Math.sin(a) * (DOME_R + 0.62), 0.2, Math.cos(a) * (DOME_R + 0.62)))
      pts.push(V3(Math.sin(a) * (DOME_R + GLASS_T) * 0.72, (DOME_R + GLASS_T) * 0.7, Math.cos(a) * (DOME_R + GLASS_T) * 0.72))
    }
    const f = this.frameOn(pts, IDLE_EL, 0.88, V3(0, 1, 0))
    this.idleT.copy(f.target)
    this.idleD = f.d
    const bc = this.box ?? { x: 0, y: 0, w: W, h: H }
    this.backMat.uniforms.uCenter.value.set((bc.x + bc.w / 2) / W, 1 - (bc.y + bc.h * 0.46) / H)
    this.backMat.uniforms.uSize.value = Math.min(bc.w, bc.h) / H
    this.goals()
  }

  /**
   * The view that frames `pts` in the box from height angle `el`: a target and distance with the points' projection
   * centred in the box and filling `fill` of it (the target starts at `guess` and is walked to the centre).
   */
  private frameOn(pts: readonly THREE.Vector3[], el: number, fill: number, guess: THREE.Vector3) {
    const target = guess.clone()
    const f = this.h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const dir = V3(0, Math.sin(el), Math.cos(el))
    const fwd = dir.clone().negate()
    const right = V3(1, 0, 0)
    const up = V3().crossVectors(right, fwd)
    const q = V3()
    let d = 18
    for (let it = 0; it < 4; it++) {
      d = this.fitDistance(target, el, pts, fill)
      const cam = target.clone().addScaledVector(dir, d)
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const p of pts) {
        q.subVectors(p, cam)
        const z = q.dot(fwd)
        const x = (f * q.dot(right)) / z
        const y = (f * q.dot(up)) / z
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      // move the target by what the off-centre amounts to at the target's depth
      target.addScaledVector(right, (((x0 + x1) / 2) * d) / f).addScaledVector(up, (((y0 + y1) / 2) * d) / f)
    }
    return { target, d: this.fitDistance(target, el, pts, fill) }
  }

  /**
   * How far the camera must stand (looking at `target` from the front, from height angle `el`) for every point to sit
   * within `fill` of the frame box around its centre (a binary search on the projections).
   */
  private fitDistance(target: THREE.Vector3, el: number, pts: readonly THREE.Vector3[], fill: number) {
    const b = this.box ?? { x: 0, y: 0, w: this.w, h: this.h }
    const f = this.h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    const dir = V3(0, Math.sin(el), Math.cos(el))
    const fwd = dir.clone().negate()
    const right = V3(1, 0, 0)
    const up = V3().crossVectors(right, fwd)
    const q = V3()
    const fits = (d: number) => {
      const cam = target.clone().addScaledVector(dir, d)
      for (const p of pts) {
        q.subVectors(p, cam)
        const z = q.dot(fwd)
        if (z <= 0.1) return false
        if (Math.abs((f * q.dot(right)) / z) > (b.w / 2) * fill || Math.abs((f * q.dot(up)) / z) > (b.h / 2) * fill) return false
      }
      return true
    }
    let lo = 1
    let hi = 120
    for (let i = 0; i < 28; i++) {
      const m = (lo + hi) / 2
      if (fits(m)) hi = m
      else lo = m
    }
    return hi
  }

  private moveCamera(dt: number) {
    const k = ease(this.focused ? 2.2 : 2.6, dt)
    this.camT.lerp(this.goalT, k)
    this.camEl = lerp(this.camEl, this.goalEl, k)
    this.camD = lerp(this.camD, this.goalD, k)
    this.look.lerp(this.lookTo, ease(2.5, dt))
    // a slow sway at rest, a touch of the pointer
    const sway = this.play ? 0 : Math.sin(this.clock * 0.11) * 0.035
    const az = sway + this.look.x * 0.05
    const el = this.camEl + this.look.y * 0.025 + Math.sin(this.clock * 0.083) * 0.008
    const cam = this.camera
    cam.position.set(this.camT.x + Math.sin(az) * Math.cos(el) * this.camD, this.camT.y + Math.sin(el) * this.camD, this.camT.z + Math.cos(az) * Math.cos(el) * this.camD)
    if (this.jolt > 0.0005) {
      const s = this.jolt
      cam.position.x += (Math.random() - 0.5) * s
      cam.position.y += (Math.random() - 0.5) * s
      this.jolt *= Math.exp(-dt * 14)
    }
    cam.lookAt(this.camT)
    cam.updateMatrixWorld()
  }

  /* ---------------- light ---------------- */

  private updateLights(dt: number) {
    this.flashK = Math.max(0, this.flashK - dt * 3.2)
    const fk = this.flashK
    this.key.intensity = this.keyK * (1 + fk * 1.6)
    this.glass.uFlash.value.setRGB(1, 0.82, 0.45).multiplyScalar(fk * 0.5)
    this.backMat.uniforms.uFlash.value = fk
    this.tableMat.uniforms.uFlash.value = fk
    // the glass reads clearer when the camera leans in over the dice
    const close = clamp01((this.camEl - IDLE_EL) / (FOCUS_EL - IDLE_EL))
    this.glass.uK.value = 1 - 0.5 * close
    this.glass.uFar.value = 0.55 - 0.25 * close
    // the mirrored studio drifts a little at rest and slides as the dome tilts and rings
    const tilt = this.dome.rotation
    this.te.set(tilt.x * 5 + Math.sin(this.clock * 0.21) * 0.025, Math.sin(this.clock * 0.13) * 0.05, tilt.z * 5)
    this.glass.uTurn.value.setFromMatrix4(this.tm.makeRotationFromEuler(this.te))
    this.backMat.uniforms.uTime.value = this.clock
    // the key light's shadow box follows the dome
    this.tv.copy(this.dome.position)
    this.key.target.position.copy(this.tv)
    this.key.position.set(this.tv.x - 3.2, this.tv.y + 11, this.tv.z + 5.2)
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const cv = this.renderer.domElement
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerleave', this.onLeave)
    // a roll in play, or waiting to be worked out, ends at once so the screen code can unwind (and no cue fires as
    // the page leaves: a settle chime would ring over the next page)
    this.play?.done()
    this.play = null
    this.planner?.terminate()
    this.planner = null
    for (const answer of [...this.waiting.values()]) answer(null)
    for (const o of this.own) o.dispose()
    this.env?.dispose()
    this.key.shadow.map?.dispose()
    // the cached models (they come back next visit)
    releaseModels()
    glowTexture().dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}

const randDie = () => (1 + Math.floor(Math.random() * 6)) as Die
const sameDice = (a: readonly Die[], b: readonly Die[]) => a.every((f, i) => f === b[i])

/* ------------------------------------------------------------------ */
/*  Shaders and textures                                                */
/* ------------------------------------------------------------------ */

const BACK_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uAspect;
uniform float uFlash;
uniform float uTime;
uniform vec2 uCenter;
uniform float uSize;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // deep ruby round the dome, a warm glow just behind it, near black at the edges
  vec2 p = (vUv - uCenter) * vec2(uAspect, 1.0) / uSize;
  float d = length(p * vec2(0.85, 1.0));
  vec3 col = mix(vec3(0.2, 0.035, 0.055), vec3(0.02, 0.004, 0.009), smoothstep(0.0, 1.05, d));
  col += vec3(0.16, 0.07, 0.035) * pow(1.0 - smoothstep(0.0, 0.62, d), 2.0);
  // a soft fall of light from above
  col += vec3(0.05, 0.02, 0.02) * smoothstep(0.3, 1.0, vUv.y) * (1.0 - smoothstep(0.0, 0.9, abs(p.x)));
  // the room's lights, out of focus: soft discs, one in some cells of a loose grid, breathing slowly
  vec2 q = vec2(vUv.x * uAspect, vUv.y) * 7.0;
  vec2 cell = floor(q);
  float h = hash(cell);
  if (h > 0.62) {
    vec2 c = cell + 0.5 + (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.5;
    float r = 0.16 + 0.22 * hash(cell + 1.3);
    float disc = 1.0 - smoothstep(r * 0.82, r, length(q - c));
    float rim = smoothstep(r * 0.55, r * 0.9, length(q - c)) * disc;
    vec3 tint = mix(vec3(1.0, 0.62, 0.25), vec3(1.0, 0.3, 0.32), hash(cell + 5.0));
    float k = (0.35 + 0.65 * hash(cell + 9.0)) * (0.8 + 0.2 * sin(uTime * 0.7 + h * 40.0));
    // fewer near the dome, where they would only clutter it
    k *= smoothstep(0.35, 0.9, d);
    col += tint * (disc * 0.05 + rim * 0.03) * k;
  }
  col += vec3(0.1, 0.065, 0.03) * uFlash * (1.0 - smoothstep(0.0, 1.0, d));
  gl_FragColor = vec4(col, 1.0);
}`

const TABLE_FRAG = /* glsl */ `
varying vec3 vW;
uniform float uFlash;
void main() {
  float r = length(vW.xz);
  // a pool of warm light round the pedestal, the plinth's soft shadow at its foot; it melts into the room
  vec3 col = mix(vec3(0.16, 0.04, 0.045), vec3(0.05, 0.012, 0.016), smoothstep(4.0, 10.0, r));
  col *= 0.3 + 0.7 * smoothstep(4.0, 5.4, r);
  col += vec3(0.06, 0.04, 0.015) * uFlash * (1.0 - smoothstep(4.0, 12.0, r));
  float a = 1.0 - smoothstep(6.0, 13.5, r);
  gl_FragColor = vec4(col * a, a);
}`
