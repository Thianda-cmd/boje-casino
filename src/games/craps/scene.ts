import * as THREE from 'three'
import { PacedQuality, glowTexture } from '../../lib/three/fx'
import { CUT_V, FELT_L, FELT_W, puckSpot } from './layout'
import { BACK_Z, HALF, HALF_W, HAND_BOX, NEAR_Z, WALL_H, homePoses, planThrow, poseAt, restOrientations, type Hit, type Pose, type Roll } from './physics'
import { diceGeometry } from '../../lib/dice/mesh'
import { HOOK_R, PUCK_T, ROOM_GLSL, backboard, crapsDiceMaterial, crapsEnvironment, felt, feltFonts, floor, puck, releaseModels, stick, tub } from './models'
import PlanWorker from './plan.worker?worker&inline'
import type { PlanReply, PlanRequest } from './plan.worker'
import type { Die, Num, Roll as Dice } from './rules'

/*
  The Craps stage: a casino table seen from the shooter's end, in a warm dark room under the table's lamp, two red
  casino dice on the felt. A throw is real rigid-body physics worked out ahead (physics.ts, in plan.worker.ts): the
  stickman's dice come back to the shooter, are shaken and thrown, fly over the rail, tumble down the felt, strike the
  backboard's pyramids and settle on the faces that were drawn. The camera rides along behind the throw, leans in
  over the dice so their faces read (a hard way and a seven-out get their own beats), and, when the screen collects
  the dice for the next roll, eases back to the view of the whole table for betting.

  How the screen uses it:
    const sc = new CrapsScene(host)              // a canvas fills host; sc.onProgress(p) while it loads
    await sc.ready                               // never rejects; no WebGL throws from the constructor (play flat)
    sc.resize(w, h); sc.setFrame(box, smooth)    // the canvas size, and where in it the table should sit (CSS px)
    sc.setPuck(point)                            // the puck: ON on the point's number, or OFF
    await sc.roll(dice, cues, beat)              // the throw (worked out in a worker first); cues: collect, shake,
                                                 // release, hit, back, readable, landed (the stickman's call);
                                                 // resolves with the dice at rest
    sc.collect(sweep?)                           // the camera returns for betting; the stick sends the dice back
                                                 // (or, sweep false, leaves them lying until the next roll)
    sc.project(x, y, z, out) / sc.diceOnScreen(out)  // where table points / the dice are on the canvas (CSS px)
  The felt is printed with the layout (layout.ts) for the table's sake; the screen's own betting board goes below the
  table (the camera moves, the dice roll over the felt, and a board laid over it would hide them). In a wide frame the
  betting view's foot cuts the felt on the plain strip between the props and the number boxes (layout.CUT_V), where
  the screen's board begins, and the puck (under the board there) is put away. Everything runs on the scene clock;
  turbo plays the throw a touch faster and cuts the stickman's return short.

  At rest the scene draws only what moves (the camera's slow sway, a touch of the pointer) and soon drops to a dozen
  frames a second; the shadows are drawn again only when something moved.
*/

const FOV = 32
/** sim seconds per real second: normal and turbo */
const RATE_NORMAL = 1
const RATE_TURBO = 1.35
/** how long the stick takes to bring the dice back (s, normal and turbo), and the shooter's shake */
const COLLECT = [0.95, 0.55]
const SHAKE = [0.42, 0.2]
/** the camera's elevation over the table for betting (in an upright frame: lower in a wide one) and reading the dice */
const BET_EL = 1.1
const READ_EL = 1.1
/** the room kept clear over the dice as they are read, for the stickman's call (CSS px: a small frame, a large one) */
const READ_ROOM = [52, 68]
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const smooth = (t: number) => {
  const u = clamp01(t)
  return u * u * (3 - 2 * u)
}
/** frame-rate independent approach: covers 1 - e^(-k dt) of the way */
const ease = (k: number, dt: number) => 1 - Math.exp(-k * dt)

export interface ThrowCues {
  /** the stick pushes the dice back to the shooter (they were left where the last throw stopped) */
  collect?: () => void
  /** the shooter shakes the dice in the hand */
  shake?: () => void
  /** the dice leave the hand */
  release?: () => void
  /** a die knocks the felt, a wall, the backboard or the other die (k: 0-1, how hard; h.on says which, h.v the speed) */
  hit?: (h: Hit, k: number) => void
  /** the first die strikes the backboard */
  back?: () => void
  /** both dice lie flat: the faces can be read (the camera leans in) */
  readable?: () => void
  /** the dice are at rest: the stickman's call */
  landed?: () => void
}

/** the camera's own beat as it reads the dice: a pair (the hard way) pushes in slowly, a seven-out pulls back */
export type Beat = 'hard' | 'seven-out' | null

/** where in the canvas the table is framed (CSS px); the whole canvas by default */
export interface FrameBox {
  x: number
  y: number
  w: number
  h: number
}

interface Throw {
  roll: Roll
  phase: 'collect' | 'shake' | 'fly'
  /** time into the phase (scene seconds), and into the record (sim seconds) */
  t: number
  sim: number
  rate: number
  shakeFor: number
  hit: number
  back: boolean
  readable: boolean
  cues: ThrowCues
  beat: Beat
  done: () => void
}

/** a throw being worked out: for which faces, from which poses; null once it can no longer be used */
interface Job {
  dice: Dice
  start: Pose[]
  roll: Promise<Roll | null>
}

/**
 * The stick bringing the dice back to the shooter: it reaches in behind them, gathers them side by side, pushes them
 * home and lifts away. From where they lay, by the gathering spots, to home, over this long.
 */
interface Sweep {
  from: Pose[]
  gather: { x: number; z: number }[]
  to: Pose[]
  t: number
  dur: number
}

/** the sweep's beats, as shares of its length: the stick reaches in, gathers the dice, pushes them home, lifts away */
const REACH_END = 0.26
const GATHER_END = 0.48
const PUSH_END = 0.86
/** the stickman's hand (he stands at the middle of the right rail), and where the hook waits when not in use */
const HAND = new THREE.Vector3(HALF_W + 4.2, WALL_H + 4.4, 1.4)
const HOOK_REST = new THREE.Vector3(HALF_W + 0.9, WALL_H + 1.3, 1)

/** how long a worker may take over a throw before the scene works it out itself (ms) */
const PLAN_PATIENCE = 3000

type View = 'bet' | 'start' | 'follow' | 'read'

export class CrapsScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 400)
  private readonly own: { dispose: () => void }[] = []
  private readonly quality = new PacedQuality()
  private env: THREE.WebGLRenderTarget | null = null
  private readonly key: THREE.DirectionalLight
  private readonly backdrop: THREE.Mesh
  private readonly backMat: THREE.ShaderMaterial
  private readonly table = new THREE.Group()
  private readonly dice: THREE.Mesh[] = []
  private readonly blobs: THREE.Mesh[] = []
  private readonly glints: THREE.Mesh[] = []
  private puckObj: THREE.Group | null = null
  private stickRod: THREE.Mesh | null = null
  private stickHook: THREE.Mesh | null = null

  // the dice: where they lie, and where the stick leaves them for the shooter (where the next throw starts from)
  private rest: Pose[]
  private home: Pose[]
  private atHome = true
  private sweep: Sweep | null = null
  private planning: Job | null = null
  private planned: { dice: Dice; start: Pose[]; roll: Roll } | null = null
  private play: Throw | null = null
  private planner: Worker | null = null
  private jobs = 0
  private readonly waiting = new Map<number, (roll: Roll | null) => void>()

  // the puck: where it stands and which side is up (0 OFF, 1 ON), and where it is going
  private readonly puckAt = V3()
  private readonly puckTo = V3()
  private puckOn = 0
  private puckOnTo = 0
  private puckHop = 1

  // the camera's rig: what it looks at, how high (radians), round which way (radians, 0 = from the shooter's end),
  // how far; and its goals
  private view: View = 'bet'
  private readonly camT = V3(0, 0, 0)
  private camEl = BET_EL
  private camAz = 0
  private camD = 30
  private readonly goalT = V3(0, 0, 0)
  private goalEl = BET_EL
  private goalAz = 0
  private goalD = 30
  /** a move to a fixed view under way: how far through it, how long it takes, its easing, and where it began */
  private move: { t: number; dur: number; outOnly: boolean; T: THREE.Vector3; el: number; az: number; d: number } | null = null
  /** the betting view, the throw's start, worked out for the frame */
  private readonly betT = V3()
  private betEl = BET_EL
  private betD = 30
  private readonly startT = V3()
  private startEl = 0.42
  private startD = 21
  private readonly look = new THREE.Vector2()
  private readonly lookTo = new THREE.Vector2()
  private box: FrameBox | null = null
  private boxTo: FrameBox | null = null
  /** whether the betting view's foot cuts the felt at CUT_V (a wide frame: the screen's board covers the rest) */
  private betCut = false

  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private raf = 0
  private last = 0
  private acc = 0
  private clock = 0
  private calm = 0
  private shadowDirty = true
  private drewLast = false
  private disposed = false
  private paused = false
  private turbo = false
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void

  // scratch, so a frame allocates nothing
  private readonly pose = new Float32Array(7)
  private readonly shown = [new Float32Array(7), new Float32Array(7)]
  private readonly tv = V3()
  private readonly tv2 = V3()
  private readonly up = V3(0, 1, 0)
  private readonly tq = new THREE.Quaternion()
  private readonly tq2 = new THREE.Quaternion()
  // scratch for fitting views (frameOn, fitDistance, handHidden): the view's axes, a camera, a point
  private readonly fDir = V3()
  private readonly fFwd = V3()
  private readonly fUp = V3()
  private readonly fRight = V3(1, 0, 0)
  private readonly fCam = V3()
  private readonly fQ = V3()

  constructor(el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.6 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setClearColor('#0b0806')
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:manipulation'
    el.appendChild(cv)

    // the room round the table, as far off as the sky (it moves with the camera)
    this.backMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 vD;\n${ROOM_GLSL}\nvoid main() {\n  gl_FragColor = vec4(room(normalize(vD)), 1.0);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    })
    this.backdrop = new THREE.Mesh(new THREE.SphereGeometry(300, 48, 24), this.backMat)
    this.backdrop.renderOrder = -10
    this.backdrop.frustumCulled = false
    this.scene.add(this.backdrop)
    this.own.push(this.backdrop.geometry, this.backMat)

    // the lamp over the table: the key light, from above and a little in front, its shadow box following the dice
    this.key = new THREE.DirectionalLight('#fff0d8', 1.25)
    this.key.castShadow = true
    this.key.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048)
    this.key.shadow.bias = -0.0005
    this.key.shadow.normalBias = 0.02
    this.key.shadow.radius = 4
    // translucent dice let light through: their shadows are lighter than a solid's
    this.key.shadow.intensity = 0.72
    const sc = this.key.shadow.camera
    sc.near = 2
    sc.far = 40
    this.scene.add(this.key, this.key.target)
    this.scene.add(new THREE.HemisphereLight('#ffe6c4', '#0b3a26', 0.3))
    // the pendant lamps down the table: soft pools of light along the felt, falling off over the rail into the room
    for (const z of [-7.5, 0, 7.5]) {
      const lamp = new THREE.SpotLight('#ffe4bd', 1.7, 0, 0.4, 1, 0)
      lamp.position.set(0, 15, z + 1)
      lamp.target.position.set(0, 0, z)
      this.scene.add(lamp, lamp.target)
    }

    // soft dark blots where the dice meet the felt, and the red light they let through, beside them
    const blobGeo = new THREE.PlaneGeometry(1.75, 1.75).rotateX(-Math.PI / 2)
    this.own.push(blobGeo)
    for (let i = 0; i < 2; i++) {
      const b = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#000000', transparent: true, opacity: 0.5, depthWrite: false }))
      b.renderOrder = 2
      const g = new THREE.Mesh(blobGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#ff2a1a', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending }))
      g.renderOrder = 3
      this.blobs.push(b)
      this.glints.push(g)
      this.scene.add(b, g)
      this.own.push(b.material as THREE.Material, g.material as THREE.Material)
    }
    this.scene.add(this.table)

    this.home = this.rest = homePoses(restOrientations([randDie(), randDie()]))
    // started now, so it is warm by the first throw
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
    this.env = crapsEnvironment(this.renderer)
    this.scene.environment = this.env.texture
    await step(0.2)
    if (this.disposed) return
    // the felt's print wants the house font
    await feltFonts()
    if (this.disposed) return
    this.table.add(felt(), ...tub(), backboard(), floor())
    await step(0.45)
    if (this.disposed) return
    const diceMat = crapsDiceMaterial()
    const geo = diceGeometry()
    for (let i = 0; i < 2; i++) {
      const d = new THREE.Mesh(geo, diceMat)
      d.castShadow = true
      d.receiveShadow = true
      this.dice.push(d)
      this.scene.add(d)
    }
    this.puckObj = puck()
    this.table.add(this.puckObj)
    const st = stick()
    this.stickRod = st.rod
    this.stickHook = st.hook
    st.rod.visible = st.hook.visible = false
    this.scene.add(st.rod, st.hook)
    this.placePuck()
    this.placeRest(this.rest)
    await step(0.7)
    if (this.disposed) return
    // every shader once, so nothing compiles mid-throw (the stick shown for it: only what is visible is compiled)
    st.rod.visible = st.hook.visible = true
    try {
      await this.renderer.compileAsync(this.scene, this.camera)
    } catch {
      /* compiles on first draw instead */
    }
    st.rod.visible = st.hook.visible = false
    if (this.disposed) return
    this.snapCamera()
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.render(this.scene, this.camera)
    await step(1)
    if (this.disposed) return
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.tick)
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    const sized = w !== this.w || h !== this.h
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.applyOffset()
    // (the quality pacer resizes the drawing buffer alone: the views stay as they are)
    if (sized) this.fitViews()
  }

  /**
   * Where the table should sit in the canvas (CSS px): the camera centres it in that box and fits it to it (the rest
   * of the canvas still shows the room). Null: the whole canvas. `smooth` glides there instead of cutting: the views
   * are fitted to the new box at once (the camera eases over to them) and only the camera's centre glides.
   */
  setFrame(box: FrameBox | null, smooth = false) {
    if (smooth && box && this.box) {
      this.boxTo = { ...box }
      this.fitViews()
      return
    }
    this.box = box && { ...box }
    this.boxTo = null
    this.applyOffset()
    this.fitViews()
  }

  setTurbo(on: boolean) {
    this.turbo = on
  }

  /** lays the dice out afresh at the shooter's end showing `dice` (between throws only: say, on a return visit) */
  setRest(dice: Dice) {
    if (this.play) return
    this.home = this.rest = homePoses(restOrientations(dice))
    this.atHome = true
    this.endSweep()
    this.planning = null
    this.planned = null
    this.placeRest(this.rest)
  }

  /** the puck: ON on the point's number box, or OFF (in the Don't Come bar); it hops over when it moves */
  setPuck(point: Num | null, animate = true) {
    const s = puckSpot(point)
    this.puckTo.set(s.u - FELT_W / 2, 0, s.v - FELT_L / 2)
    this.puckOnTo = point === null ? 0 : 1
    if (!animate) {
      this.puckAt.copy(this.puckTo)
      this.puckOn = this.puckOnTo
      this.puckHop = 1
    } else this.puckHop = 0
    this.placePuck()
  }

  /* ---------------- a throw ---------------- */

  /**
   * Throws the dice: the stick brings them back to the shooter if they lie where the last throw left them, the
   * shooter shakes and throws, and they land on `dice` (the throw is worked out first, in the worker: a few
   * milliseconds, before anything moves). Resolves when they are at rest; the cues fire on the way. `beat`: the
   * camera's moment as it reads the dice.
   */
  roll(dice: Dice, cues: ThrowCues = {}, beat: Beat = null) {
    return new Promise<void>((done) => {
      // (one throw at a time)
      if (this.disposed || this.play) return done()
      const begin = (roll: Roll | null) => {
        if (!roll || this.disposed) return done()
        this.planning = null
        this.planned = null
        const k = this.turbo ? 1 : 0
        // the dice come back from wherever they are now: where they lay, or part way back already
        const back = !this.atHome
        if (back) this.startSweep(roll.start, COLLECT[k])
        this.play = { roll, phase: back ? 'collect' : 'shake', t: 0, sim: 0, rate: this.rate(), shakeFor: SHAKE[k], hit: 0, back: false, readable: false, cues, beat, done }
        this.setView('start')
        if (back) cues.collect?.()
        else cues.shake?.()
      }
      // a throw already worked out starts at once (a test stepping the clock relies on that); else when it is ready
      const p = this.planned
      if (p && sameDice(p.dice, dice) && p.start === this.home) begin(p.roll)
      else void this.job(dice).roll.then(begin)
    })
  }

  /**
   * The camera returns to the table for betting (if it isn't there already) and, unless `sweep` is false, the stick
   * sends the dice back to the shooter (left where they lie, they are brought back as the next roll starts). True if
   * the stick moves (the dice were not home already: the moment for its sound).
   */
  collect(sweep = true) {
    if (this.play) return false
    const moves = sweep && !this.atHome && !this.sweep
    if (moves) this.startSweep(this.home, COLLECT[this.turbo ? 1 : 0] * 1.25)
    if (this.view !== 'bet') this.setView('bet')
    return moves
  }

  /** the throw for `dice` from the shooter's end: the one being worked out, if it is that one, or a new one */
  private job(dice: Dice): Job {
    const j = this.planning
    if (j && sameDice(j.dice, dice) && j.start === this.home) return j
    const start = this.home
    const quick = this.turbo
    const roll = this.solve(start, [...dice], quick).then((r) => {
      if (r && this.planning === job) this.planned = { dice: [...dice] as unknown as Dice, start, roll: r }
      return r
    })
    const job: Job = { dice: [...dice] as unknown as Dice, start, roll }
    this.planning = job
    return job
  }

  /** a throw from the worker, or worked out here if there is none or it fails to answer in time; null once disposed */
  private solve(start: Pose[], faces: Die[], quick: boolean): Promise<Roll | null> {
    const here = () => {
      if (this.disposed) return null
      try {
        return planThrow(start, faces, { quick })
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

  /** the worker failed: every throw it owes is worked out here, and so is every one after */
  private dropPlanner() {
    this.planner?.terminate()
    this.planner = null
    for (const answer of [...this.waiting.values()]) answer(null)
  }

  private rate() {
    return this.turbo ? RATE_TURBO : RATE_NORMAL
  }

  /* ---------------- where things are on the canvas ---------------- */

  /** a point of the table's frame on the canvas (CSS px), into out; z < 0 behind the camera */
  project(x: number, y: number, z: number, out: { x: number; y: number }) {
    this.tv.set(x, y, z).project(this.camera)
    out.x = ((this.tv.x + 1) / 2) * this.w
    out.y = ((1 - this.tv.y) / 2) * this.h
    return out
  }

  /**
   * Where the dice are on the canvas (CSS px), into out: across, the middle between them; down, the top of the higher
   * one (the stickman's bubble stands over them, clear of both)
   */
  diceOnScreen(out: { x: number; y: number }) {
    const a = this.dice[0]?.position
    const b = this.dice[1]?.position
    if (!a || !b) return this.project(0, 0, 0, out)
    this.project(a.x, HALF * 2, a.z, out)
    const ax = out.x
    const ay = out.y
    this.project(b.x, HALF * 2, b.z, out)
    out.x = (ax + out.x) / 2
    out.y = Math.min(ay, out.y)
    return out
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
      !!this.sweep ||
      !!this.move ||
      !!this.boxTo ||
      this.puckHop < 1 ||
      this.camT.distanceToSquared(this.goalT) > 1e-5 ||
      Math.abs(this.camD - this.goalD) > 1e-3 ||
      Math.abs(this.camEl - this.goalEl) > 1e-4 ||
      Math.abs(this.camAz - this.goalAz) > 1e-4 ||
      this.look.distanceToSquared(this.lookTo) > 1e-5
    this.calm = lively ? 0 : this.calm + gap
    // at rest only the camera sways, slowly: 30 frames a second while things settle, then a dozen
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
    this.renderer.shadowMap.needsUpdate = lively || this.shadowDirty
    this.shadowDirty = false
    this.renderer.render(this.scene, this.camera)
  }

  private update(dt: number) {
    if (this.play) this.advance(dt)
    else if (this.sweep && this.advanceSweep(dt)) this.atHome = true
    if (this.puckHop < 1) this.advancePuck(dt)
    if (this.boxTo) this.glideFrame(dt)
    this.moveCamera(dt)
    this.updateLight()
    // settled in a betting view whose foot the screen's board covers, the puck (under the board) is put away
    const puckShown = !(this.view === 'bet' && this.betCut && !this.move)
    if (this.puckObj && this.puckObj.visible !== puckShown) {
      this.puckObj.visible = puckShown
      this.shadowDirty = true
    }
  }

  /** a smooth setFrame on its way: the box eases to its goal, and the camera's centre with it */
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
    this.applyOffset()
  }

  /** the throw in play, on: the stick's return, the shake, the flight; the cues as their moments pass */
  private advance(dt: number) {
    const p = this.play!
    const s = p.roll.sim
    p.t += dt
    if (p.phase === 'collect') {
      if (!this.advanceSweep(dt)) return
      p.phase = 'shake'
      p.t = 0
      p.cues.shake?.()
    }
    if (p.phase === 'shake') {
      // picked up off the felt: a quick lift towards the hand, then out of sight in it until the throw
      const k = clamp01(p.t / 0.16)
      for (let i = 0; i < 2; i++) {
        const st = p.roll.start[i]
        const o = this.pose
        o[0] = st.x
        o[1] = HALF + k * k * 1.6
        o[2] = st.z + k * k * 1.2
        o[3] = st.q[0]
        o[4] = st.q[1]
        o[5] = st.q[2]
        o[6] = st.q[3]
        this.placeDie(i)
        this.dice[i].visible = k < 1
        this.blobs[i].visible = this.glints[i].visible = k < 1
      }
      // (the throw waits for the camera to be in place, so the dice come into its view from below)
      if (p.t >= p.shakeFor && !this.move) {
        p.phase = 'fly'
        p.t = 0
        this.setView('follow')
        p.cues.release?.()
        for (let i = 0; i < 2; i++) this.dice[i].visible = this.blobs[i].visible = this.glints[i].visible = true
      } else return
    }
    p.sim = Math.min(s.end, p.sim + dt * p.rate)
    for (let i = 0; i < 2; i++) {
      poseAt(p.roll, i, p.sim, this.pose)
      this.placeDie(i)
    }
    while (p.hit < s.hits.length && s.hits[p.hit].t <= p.sim) {
      const h = s.hits[p.hit++]
      p.cues.hit?.(h, clamp01(h.v / 26))
    }
    if (!p.back && p.sim >= Math.min(s.backAt[0] < 0 ? Infinity : s.backAt[0], s.backAt[1] < 0 ? Infinity : s.backAt[1])) {
      p.back = true
      p.cues.back?.()
    }
    if (!p.readable && p.sim >= s.readable) {
      p.readable = true
      this.setView('read')
      p.cues.readable?.()
    }
    if (p.sim >= s.end) {
      this.rest = p.roll.final
      this.home = homePoses(this.rest.map((r) => r.q))
      this.atHome = false
      this.play = null
      this.placeRest(this.rest)
      if (!p.readable) {
        this.setView('read')
        p.cues.readable?.()
      }
      p.cues.landed?.()
      p.done()
    }
  }

  /* ---------------- the stick ---------------- */

  /** the stick sets off to bring the dice from where they are shown now to `to` (home), over `dur` */
  private startSweep(to: Pose[], dur: number) {
    const from = [0, 1].map((i): Pose => {
      const o = this.shown[i]
      return { x: o[0], z: o[2], q: [o[3], o[4], o[5], o[6]] }
    })
    // gathered side by side where they lay, a little nearer home, in the order they will lie at home (and clear of
    // the walls, with the hook round them)
    const mx = Math.max(-HALF_W + HOOK_R + 0.2, Math.min(HALF_W - HOOK_R - 0.2, (from[0].x + from[1].x) / 2))
    const mz = Math.min(NEAR_Z - 3, (from[0].z + from[1].z) / 2 + 0.8)
    const hx = (to[0].x + to[1].x) / 2
    const hz = (to[0].z + to[1].z) / 2
    const gather = to.map((t) => ({ x: mx + t.x - hx, z: mz + t.z - hz }))
    this.sweep = { from, gather, to, t: 0, dur }
  }

  /** the stick's sweep, on: the dice where it has them, the stick itself; true once it is done (the dice home) */
  private advanceSweep(dt: number) {
    const sw = this.sweep!
    sw.t = Math.min(sw.dur, sw.t + dt)
    const u = sw.t / sw.dur
    const g = smooth((u - REACH_END) / (GATHER_END - REACH_END))
    const h = smooth((u - GATHER_END) / (PUSH_END - GATHER_END))
    const turn = smooth((u - REACH_END) / (PUSH_END - REACH_END))
    for (let i = 0; i < 2; i++) {
      const a = sw.from[i]
      const m = sw.gather[i]
      const b = sw.to[i]
      const q = this.tq.set(a.q[0], a.q[1], a.q[2], a.q[3]).slerp(this.tq2.set(b.q[0], b.q[1], b.q[2], b.q[3]), turn)
      const o = this.pose
      o[0] = lerp(lerp(a.x, m.x, g), b.x, h)
      o[1] = HALF
      o[2] = lerp(lerp(a.z, m.z, g), b.z, h)
      o[3] = q.x
      o[4] = q.y
      o[5] = q.z
      o[6] = q.w
      this.placeDie(i)
    }
    this.placeStick(sw, u)
    if (sw.t < sw.dur) return false
    this.endSweep()
    this.rest = sw.to
    this.placeRest(this.rest)
    return true
  }

  /** the sweep is over (or cut short): the stick goes */
  private endSweep() {
    this.sweep = null
    if (this.stickRod && this.stickHook) this.stickRod.visible = this.stickHook.visible = false
  }

  /**
   * The stick at share u of a sweep: the hook behind the dice (on the far side from home, opening towards it), on
   * the way in and out lifted over the felt from where it waits by the rail; the rod from the hook to the hand.
   */
  private placeStick(sw: Sweep, u: number) {
    const rod = this.stickRod
    const hook = this.stickHook
    if (!rod || !hook) return
    rod.visible = hook.visible = true
    const a = this.shown[0]
    const b = this.shown[1]
    // behind the pair, towards home
    let dx = (sw.to[0].x + sw.to[1].x) / 2 - (a[0] + b[0]) / 2
    let dz = (sw.to[0].z + sw.to[1].z) / 2 - (a[2] + b[2]) / 2
    const l = Math.hypot(dx, dz)
    if (l < 0.5) {
      dx = 0
      dz = 1
    } else {
      dx /= l
      dz /= l
    }
    // (the hook's back, HOOK_R * 0.8 behind its middle, just touching the dice)
    const behind = HALF + 0.06 - HOOK_R * 0.8
    const tip = this.tv.set((a[0] + b[0]) / 2 - dx * behind, 0.06, (a[2] + b[2]) / 2 - dz * behind)
    // reaching in from where it waits, and lifting away again
    const inK = smooth(u / REACH_END)
    const outK = smooth((u - PUSH_END) / (1 - PUSH_END))
    if (u < REACH_END) tip.lerpVectors(HOOK_REST, tip, inK)
    else if (u > PUSH_END) tip.lerp(HOOK_REST, outK)
    tip.y += Math.sin(Math.PI * inK) * 1.2 + Math.sin(Math.PI * outK) * 1.2
    hook.position.copy(tip)
    const yaw = Math.atan2(dx, dz)
    hook.rotation.set(0, yaw, 0)
    // the rod meets the hook at its +x end, beside the dice, and runs up to the hand (the stickman leans along the
    // rail towards the dice)
    const ax = tip.x + Math.cos(yaw) * HOOK_R
    const az = tip.z - Math.sin(yaw) * HOOK_R
    rod.position.set(ax, tip.y, az)
    const vx = HAND.x - ax
    const vy = HAND.y - tip.y
    const vz = lerp(HAND.z, tip.z, 0.45) - az
    const len = Math.hypot(vx, vy, vz)
    rod.quaternion.setFromUnitVectors(this.up, this.tv2.set(vx / len, vy / len, vz / len))
    rod.scale.set(1, len, 1)
    this.shadowDirty = true
  }

  /** the dice lying still */
  private placeRest(r: readonly Pose[]) {
    this.shadowDirty = true
    for (let i = 0; i < this.dice.length; i++) this.placePose(i, r[i])
  }

  private placePose(i: number, p: Pose) {
    const o = this.pose
    o[0] = p.x
    o[1] = HALF
    o[2] = p.z
    o[3] = p.q[0]
    o[4] = p.q[1]
    o[5] = p.q[2]
    o[6] = p.q[3]
    this.placeDie(i)
  }

  /** die i from the pose in scratch, its blot on the felt (darker and tighter the nearer it is) and its red glint */
  private placeDie(i: number) {
    const o = this.pose
    const d = this.dice[i]
    if (!d) return
    d.position.set(o[0], o[1], o[2])
    d.quaternion.set(o[3], o[4], o[5], o[6])
    this.shown[i].set(o)
    const up = Math.max(0, o[1] - HALF)
    const b = this.blobs[i]
    b.position.set(o[0] + 0.07, 0.004, o[2] - 0.05)
    b.scale.setScalar(1 + up * 0.35)
    ;(b.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.exp(-up * 1.3)
    // the light the red die lets through lands just beyond its shadow, away from the lamp
    const g = this.glints[i]
    g.position.set(o[0] + 0.28, 0.006, o[2] - 0.42)
    g.scale.setScalar(0.72 + up * 0.2)
    ;(g.material as THREE.MeshBasicMaterial).opacity = 0.32 * Math.exp(-up * 2.2)
  }

  /* ---------------- the puck ---------------- */

  private advancePuck(dt: number) {
    this.puckHop = Math.min(1, this.puckHop + dt / 0.55)
    if (this.puckHop >= 1) {
      this.puckAt.copy(this.puckTo)
      this.puckOn = this.puckOnTo
    }
    this.placePuck()
  }

  /** the puck where it stands, or hopping over (lifted, sliding, turning over if its side changes) */
  private placePuck() {
    const pk = this.puckObj
    if (!pk) return
    const k = smooth(this.puckHop)
    const lift = Math.sin(Math.PI * this.puckHop) * 1.1
    pk.position.set(lerp(this.puckAt.x, this.puckTo.x, k), PUCK_T / 2 + 0.002 + lift, lerp(this.puckAt.z, this.puckTo.z, k))
    const side = lerp(this.puckOn, this.puckOnTo, k)
    pk.rotation.set((1 - side) * Math.PI, 0, 0)
    this.shadowDirty = true
  }

  /* ---------------- camera ---------------- */

  /**
   * Moves the camera to a view: a deliberate move of its own length to a fixed view (eased in and out, or for the
   * look at the dice, eased out of the follow's motion), or, for the follow, chasing the throw from here on.
   */
  private setView(v: View) {
    this.view = v
    this.goals()
    if (v === 'follow') {
      this.move = null
      return
    }
    this.move = { t: 0, dur: this.moveFor(v), outOnly: v === 'read', T: this.camT.clone(), el: this.camEl, az: this.camAz, d: this.camD }
  }

  /** how long the camera's move to a fixed view takes (s): quicker in turbo; slow onto a hard way */
  private moveFor(v: View) {
    return (v === 'start' ? 0.55 : v === 'read' ? (this.play?.beat === 'hard' ? 1.5 : 1.05) : 1.15) * (this.turbo ? 0.7 : 1)
  }

  /** the camera's goals for the view: the whole table, the throw's start, the throw, the dice */
  private goals() {
    this.goalAz = 0
    if (this.view === 'bet') {
      this.goalT.copy(this.betT)
      this.goalEl = this.betEl
      this.goalD = this.betD
    } else if (this.view === 'start') {
      this.goalT.copy(this.startT)
      this.goalEl = this.startEl
      this.goalD = this.startD
    } else if (this.view === 'read') {
      // over the dice as they lie (or will lie), both well in frame, looking down so their tops read
      const r = this.play?.roll.final ?? this.rest
      const beat = this.play?.beat ?? null
      const el = beat === 'hard' ? 1.24 : beat === 'seven-out' ? 0.95 : READ_EL
      const b = this.fitBox()
      const pts: THREE.Vector3[] = []
      for (const p of r) for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) pts.push(V3(p.x + dx, 1, p.z + dz), V3(p.x + dx, 0, p.z + dz))
      const small = Math.min(b.w, b.h) < 360
      const f = this.frameOn(pts, el, small ? 0.74 : 0.64, V3((r[0].x + r[1].x) / 2, HALF, (r[0].z + r[1].z) / 2), { inset: READ_ROOM[small ? 0 : 1] })
      this.goalT.copy(f.target)
      this.goalEl = el
      this.goalAz = beat === 'seven-out' ? 0.14 : 0
      // a hard way comes in close and slow; a seven-out stands back
      this.goalD = Math.max(beat === 'hard' ? 6.2 : 7.4, f.d) * (beat === 'hard' ? 0.86 : beat === 'seven-out' ? 1.22 : 1)
    }
  }

  /**
   * The follow camera, per frame: behind the throw and above it, leaning further over as it nears the backboard, and
   * standing back as far as it takes to keep both dice in the frame.
   */
  private followGoals() {
    const a = this.shown[0]
    const b = this.shown[1]
    const cx = (a[0] + b[0]) / 2
    const cz = (a[2] + b[2]) / 2
    const p = smooth(clamp01((NEAR_Z - cz) / (NEAR_Z - BACK_Z)))
    const el = lerp(0.55, 0.9, p)
    const box = this.fitBox()
    const f = this.focal()
    const wide = (f * (Math.abs(a[0] - b[0]) / 2 + 1.4)) / (box.w * 0.36)
    const deep = (f * ((Math.abs(a[2] - b[2]) / 2) * Math.sin(el) + 1.2)) / (box.h * 0.32)
    this.goalT.set(cx * 0.6, HALF, cz - 1.2)
    this.goalEl = el
    this.goalAz = 0
    this.goalD = Math.max(lerp(15, 12, p), wide, deep)
  }

  private snapCamera() {
    this.goals()
    this.camT.copy(this.goalT)
    this.camEl = this.goalEl
    this.camAz = this.goalAz
    this.camD = this.goalD
    this.moveCamera(0)
  }

  /** the box the views are fitted to: where a gliding frame is going, else where it is (the whole canvas if none) */
  private fitBox(): FrameBox {
    return this.boxTo ?? this.box ?? { x: 0, y: 0, w: this.w, h: this.h }
  }

  /** the camera's focal length in CSS px (the same whatever the frame: the frame only shifts the centre) */
  private focal() {
    return this.h / 2 / Math.tan(THREE.MathUtils.degToRad(FOV / 2))
  }

  /** the frame's centre: the camera's projection is shifted so the view's middle falls in the middle of the box */
  private applyOffset() {
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
  }

  /** the views fitted to the frame's box (once per frame change, not per frame of a glide) */
  private fitViews() {
    const b = this.fitBox()
    // for betting: in an upright frame, the whole table, rail and all, from high over the shooter's end; in a wider
    // one (a long table won't fill it end on), lower and closer, the table's width across the frame and the felt
    // running away to the backboard, the shooter's end cut off at the foot of the frame (the screen's betting board
    // is drawn below it); from about 4:3 on (every stage the screen lays out, a phone's too), only the far half: the
    // landing zone and the props down to the plain strip before the number boxes (CUT_V), where the dice come to rest
    const ratio = b.w / b.h
    const wide = smooth((ratio - 0.8) / 0.5)
    const band = smooth((ratio - 0.95) / 0.4)
    const pts: THREE.Vector3[] = []
    const ox = HALF_W + 2.2
    const near = lerp(lerp(NEAR_Z + 2.2, NEAR_Z - 5, wide), CUT_V - FELT_L / 2, band)
    for (const z of [near, BACK_Z - 2.2]) for (const x of [-ox, ox]) pts.push(V3(x, WALL_H + 0.8, z), V3(x, z === near && wide > 0.5 ? 0 : WALL_H - 0.4, z))
    this.betEl = lerp(lerp(BET_EL, 0.66, wide), 0.5, band)
    this.betCut = band > 0.5
    const f = this.frameOn(pts, this.betEl, 0.96, V3(0, 0, 0), { foot: wide > 0.5 })
    this.betT.copy(f.target)
    this.betD = f.d
    // the throw's start: above and behind the shooter, down the length of the felt, and steep enough that the dice
    // leave the hand below the canvas (they fly into view)
    this.startT.set(0, 0, -3)
    this.startD = 21
    this.startEl = 0.42
    while (this.startEl < 1.1 && !this.handHidden(b)) this.startEl += 0.02
    this.goals()
  }

  /** points the view axes (fDir: towards the camera, fFwd, fUp; fRight is fixed) for height angle `el` */
  private axes(el: number) {
    this.fDir.set(0, Math.sin(el), Math.cos(el))
    this.fFwd.copy(this.fDir).negate()
    this.fUp.crossVectors(this.fRight, this.fFwd)
  }

  /**
   * Whether, from the throw's start view framed in box `b`, the dice in the shooter's hand are out of sight below
   * the canvas (every point of a die in the hand at the release, with a little margin)
   */
  private handHidden(b: FrameBox) {
    this.axes(this.startEl)
    const f = this.focal()
    const cam = this.fCam.copy(this.startT).addScaledVector(this.fDir, this.startD)
    // the canvas's foot, from the box's middle (px, up positive)
    const foot = -(this.h - (b.y + b.h / 2)) - this.h * 0.015
    const hb = HAND_BOX
    for (const x of [-hb.x, hb.x])
      for (const y of [hb.y0, hb.y1])
        for (const z of [hb.z0, hb.z1]) {
          const q = this.fQ.set(x, y, z).sub(cam)
          const d = q.dot(this.fFwd)
          if (d > 0.1 && (f * q.dot(this.fUp)) / d > foot) return false
        }
    return true
  }

  /**
   * The view that frames `pts` in the box from height angle `el` (from the shooter's end): a target and distance with
   * the points' projection centred in the box and filling `fill` of it (the target starts at `guess`, walked to the
   * centre). `inset`: px at the top of the box kept clear (the points are framed in the rest). `foot`: the lowest
   * point then sits on the box's foot instead (what is below it is the screen's board).
   */
  private frameOn(pts: readonly THREE.Vector3[], el: number, fill: number, guess: THREE.Vector3, { foot = false, inset = 0 } = {}) {
    const b = this.fitBox()
    const target = guess.clone()
    const f = this.focal()
    let d = 30
    for (let it = 0; it < (foot ? 7 : 4); it++) {
      // (the distance is fitted centred; the last walks then set the lowest point down on the foot)
      const settled = foot && it >= 4
      if (!settled) d = this.fitDistance(target, el, pts, fill, inset)
      this.axes(el)
      const cam = this.fCam.copy(target).addScaledVector(this.fDir, d)
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      for (const p of pts) {
        const q = this.fQ.subVectors(p, cam)
        const z = q.dot(this.fFwd)
        const x = (f * q.dot(this.fRight)) / z
        const y = (f * q.dot(this.fUp)) / z
        x0 = Math.min(x0, x)
        x1 = Math.max(x1, x)
        y0 = Math.min(y0, y)
        y1 = Math.max(y1, y)
      }
      // (the points' middle goes to the middle of the box below the inset: inset / 2 under the box's)
      const sy = settled ? y0 + b.h / 2 : (y0 + y1) / 2 + inset / 2
      target.addScaledVector(this.fRight, (((x0 + x1) / 2) * d) / f).addScaledVector(this.fUp, (sy * d) / f)
    }
    return { target, d: foot ? d : this.fitDistance(target, el, pts, fill, inset) }
  }

  /**
   * How far the camera must stand for every point to sit within `fill` of the frame box, below an `inset` kept clear
   * at its top (a binary search)
   */
  private fitDistance(target: THREE.Vector3, el: number, pts: readonly THREE.Vector3[], fill: number, inset = 0) {
    const b = this.fitBox()
    const f = this.focal()
    const halfH = ((b.h - inset) / 2) * fill
    this.axes(el)
    const fits = (d: number) => {
      const cam = this.fCam.copy(target).addScaledVector(this.fDir, d)
      for (const p of pts) {
        const q = this.fQ.subVectors(p, cam)
        const z = q.dot(this.fFwd)
        if (z <= 0.1) return false
        if (Math.abs((f * q.dot(this.fRight)) / z) > (b.w / 2) * fill || Math.abs((f * q.dot(this.fUp)) / z + inset / 2) > halfH) return false
      }
      return true
    }
    let lo = 1
    let hi = 200
    for (let i = 0; i < 28; i++) {
      const m = (lo + hi) / 2
      if (fits(m)) hi = m
      else lo = m
    }
    return hi
  }

  private moveCamera(dt: number) {
    const m = this.move
    if (this.view === 'follow') {
      // chasing the throw: a smooth lag behind goals that move every frame
      if (this.play?.phase === 'fly') this.followGoals()
      const k = ease(3.2, dt)
      this.camT.lerp(this.goalT, k)
      this.camEl = lerp(this.camEl, this.goalEl, k)
      this.camAz = lerp(this.camAz, this.goalAz, k)
      this.camD = lerp(this.camD, this.goalD, k)
    } else if (m) {
      m.t = Math.min(m.dur, m.t + dt)
      const x = m.t / m.dur
      const u = m.outOnly ? 1 - (1 - x) ** 3 : x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
      this.camT.lerpVectors(m.T, this.goalT, u)
      this.camEl = lerp(m.el, this.goalEl, u)
      this.camAz = lerp(m.az, this.goalAz, u)
      this.camD = lerp(m.d, this.goalD, u)
      if (m.t >= m.dur) this.move = null
    } else {
      // settled: only follows the goals if the frame changes
      const k = ease(4, dt)
      this.camT.lerp(this.goalT, k)
      this.camEl = lerp(this.camEl, this.goalEl, k)
      this.camAz = lerp(this.camAz, this.goalAz, k)
      this.camD = lerp(this.camD, this.goalD, k)
    }
    this.look.lerp(this.lookTo, ease(2.5, dt))
    // a slow sway at rest, a touch of the pointer
    const still = !this.play
    const az = this.camAz + (still ? Math.sin(this.clock * 0.1) * 0.025 + this.look.x * 0.04 : 0)
    const el = this.camEl + (still ? this.look.y * 0.02 + Math.sin(this.clock * 0.077) * 0.006 : 0)
    const cam = this.camera
    cam.position.set(this.camT.x + Math.sin(az) * Math.cos(el) * this.camD, this.camT.y + Math.sin(el) * this.camD, this.camT.z + Math.cos(az) * Math.cos(el) * this.camD)
    cam.lookAt(this.camT)
    cam.updateMatrixWorld()
    this.backdrop.position.copy(cam.position)
  }

  /* ---------------- light ---------------- */

  /** the lamp's shadow box follows the dice (it only needs to hold them: they are all that casts) */
  private updateLight() {
    const a = this.shown[0]
    const b = this.shown[1]
    const cx = (a[0] + b[0]) / 2
    const cz = (a[2] + b[2]) / 2
    const half = Math.max(3, Math.hypot(a[0] - b[0], a[2] - b[2]) / 2 + 2.2)
    this.key.target.position.set(cx, 0, cz)
    this.key.position.set(cx - 4, 16, cz + 7)
    const sc = this.key.shadow.camera
    if (sc.right !== half) {
      sc.left = sc.bottom = -half
      sc.right = sc.top = half
      sc.updateProjectionMatrix()
    }
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const cv = this.renderer.domElement
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerleave', this.onLeave)
    // a throw in play, or waiting to be worked out, ends at once so the screen code can unwind (and no cue fires as
    // the page leaves)
    this.play?.done()
    this.play = null
    this.planner?.terminate()
    this.planner = null
    for (const answer of [...this.waiting.values()]) answer(null)
    for (const o of this.own) o.dispose()
    this.env?.dispose()
    this.key.shadow.map?.dispose()
    releaseModels()
    glowTexture().dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}

const randDie = () => (1 + Math.floor(Math.random() * 6)) as Die
const sameDice = (a: readonly Die[], b: readonly Die[]) => a.every((f, i) => f === b[i])
