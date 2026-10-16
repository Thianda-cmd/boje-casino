import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { Bits, PacedQuality, Sparks, glowTexture, rnd } from '../../lib/three/fx'
import { sfx } from '../../lib/sound'
import { TAG_H, buildPlush, feltMaterial, heapGeometry, releaseModels, setModelTime, warmUp, type PlushRig } from './models'
import {
  BOX,
  CHUTE,
  CHUTE_C,
  CLAW_S,
  COIN,
  FACE_Z,
  FLAP,
  GROUND,
  HOME_Y,
  NEIGHBOUR,
  OPEN,
  PIVOT_Y,
  SHUT,
  SLOTS,
  buildCabinet,
  buildClaw,
  heapSpots,
  heapY,
  inChute,
  setProngs,
  slotPos,
  type CabinetParts,
  type ClawRig,
} from './cabinet'
import { PRIZES, type Plan, type PrizeId } from './rules'

/*
  The Lucky Claw stage: the cabinet seen from the front, a little from above, in a dim arcade. The grab is decided
  before the claw moves (rules.ts); this scene only acts it out. The claw glides on its gantry, sways on its cable
  as it starts and stops, drops, closes and lifts; a held plushie hangs from the hub and swings with it. Wins go
  down the chute and out through the prize door; losses play the failure the plan names, and a plushie that ends
  up off its spot hops back home. Everything runs on the scene clock, so turbo and "hurry" just make it run faster.
*/

const FOV = 30
/** the camera looks down this much (radians) at the box */
const PITCH = 0.27
const TARGET = new THREE.Vector3(0, 2.2, 0.4)
/** the corners the view has to show: the cabinet from the arcade floor to the crown on its marquee */
const FIT: [number, number, number][] = [
  [-2.95, GROUND, 2.6],
  [2.95, GROUND, 2.6],
  [-2.95, GROUND, -1.7],
  [2.95, GROUND, -1.7],
  [-2.95, 5.8, 1.5],
  [2.95, 5.8, 1.5],
  [0, 6.1, 1.3],
]
/** the claw's hub sits this far below the carriage's pivot plus the cable */
const HUB_DROP = 0.24 * CLAW_S
/** the hub stops this far above the top of a plushie's head, so the prongs close round its head */
const OVER = 0.12
/** the prong angle that hugs a plushie's head, and a filler's body */
const HUG = 0.2
const HUG_SMALL = 0.1
/** a loose filler hangs this far under the hub when the prongs close round its lower half */
const SMALL_HANG = 0.69
const HOME = { x: CHUTE_C.x, z: CHUTE_C.z }
/** how far the tag's eyelet sits above the tag's centre (its pill is drawn with the eyelet 42 px down a 256 px slot) */
const TAG_EYELET = TAG_H * (0.5 - 42 / 256)
/** where a won plushie is shown off, in front of the glass */
const PRESENT = new THREE.Vector3(0, 1.55, 3.3)

const smooth = (t: number) => t * t * (3 - 2 * t)
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeIn = (t: number) => t * t
const clamp01 = (t: number) => Math.min(1, Math.max(0, t))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
/** a plushie's squeak pitch: the little ones squeak high, the big prizes a touch lower */
const voice = (mult: number) => Math.max(0.78, Math.min(1.35, 1.35 - 0.085 * Math.log2(mult)))

interface Tween {
  t: number
  dur: number
  fn: (u: number) => void
  done: () => void
}

/** a plushie's life on the pile: idle breathing and blinks, a springy squash, and what it is up to */
interface Plush {
  rig: PlushRig
  slot: THREE.Vector3
  /** squash spring (positive squashes), velocity */
  sq: number
  sqv: number
  blinkAt: number
  blinkEnd: number
  wiggle: number
  phase: number
  /** on its spot (idle anims play), held by the claw, flying through the air, or shown off */
  mode: 'rest' | 'held' | 'air' | 'show'
  hover: number
  joy: boolean
}

export interface DropCues {
  /** the outcome is plain to see: the plushie is through the prize door, or the claw has lost it */
  result: () => void
  /** a moment worth a caption: 'slip', 'wriggle', 'edge', 'neighbour', 'scare' */
  moment?: (what: string) => void
}

export class ClawScene {
  readonly ready: Promise<void>
  onProgress?: (p: number) => void
  /** a prize was tapped in the scene */
  onPick?: (index: number) => void
  /** where the selected plushie's head is on screen (CSS px), or null while it is busy */
  onMarker?: (at: { x: number; y: number } | null) => void
  thumbs: Partial<Record<PrizeId, string>> = {}

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly own: { dispose: () => void }[] = []
  private cab!: CabinetParts
  private claw!: ClawRig
  private readonly plush: Plush[] = []
  private readonly backMat: THREE.ShaderMaterial
  private readonly floorMat: THREE.ShaderMaterial
  private readonly glowSel: THREE.Sprite
  private readonly rays: THREE.Sprite
  private readonly raysMat: THREE.SpriteMaterial
  private readonly sparks = new Sparks(900)
  private readonly confetti: Bits
  private readonly coin: THREE.Mesh
  private readonly neon: THREE.MeshBasicMaterial[] = []
  private readonly signs: THREE.Mesh[] = []
  /** the camera's framed position, and a small drift towards the pointer on top of it */
  private readonly camBase = new THREE.Vector3()
  private readonly look = new THREE.Vector2()
  private readonly lookTo = new THREE.Vector2()

  // the claw's state
  private cx = HOME.x
  private cz = HOME.z
  private pvx = 0
  private pvz = 0
  private vx = 0
  private vz = 0
  private L = PIVOT_Y - HUB_DROP - HOME_Y
  private prong = 0.05
  private swX = 0
  private swXv = 0
  private swZ = 0
  private swZv = 0
  private sway = 0
  /** the held plushie's own swing under the hub (radians about z and x) and how far it has slid down the prongs */
  private holdRz = 0
  private holdRx = 0
  private holdSag = 0
  private wob = 0
  private wobPhase = 0
  private wobRate = 9

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
  private time = 0
  private clock = 0
  private speed = 1
  private turbo = false
  private hurried = false
  private busy = false
  private restocking = false
  private selected = 0
  private hovered = -1
  private flapA = 0
  private flapV = 0
  private press = 0
  private coinGlow = 0
  private party = 0
  private markerKey = ''
  private disposed = false
  private readonly ray = new THREE.Raycaster()
  private readonly onMove: (e: PointerEvent) => void
  private readonly onLeave: () => void
  private readonly onDown: (e: PointerEvent) => void
  private readonly onUp: (e: PointerEvent) => void
  private readonly onCancel: () => void
  private press0: { id: number; x: number; y: number } | null = null
  private motorStop: (() => void) | null = null
  /** the claw's sounds, silent once the scene is gone (a grab cut short by leaving still unwinds, quietly) */
  private readonly sound = new Proxy(sfx.claw, {
    get: (t, k) => (this.disposed ? () => () => {} : t[k as keyof typeof t]),
  })

  constructor(el: HTMLElement) {
    const mobile = matchMedia('(pointer: coarse)').matches
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, mobile ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor('#1a0b33')
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none;touch-action:manipulation'
    el.appendChild(cv)

    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: mobile ? 2 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 0.9)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    const key = new THREE.DirectionalLight('#fff2e6', 2.1)
    key.position.set(-4, 7, 9)
    this.scene.add(key, new THREE.AmbientLight('#e6dcff', 1.0))

    // the arcade behind: a dim wall with neon glows and a starry print
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
    // the carpet
    this.floorMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
      fragmentShader: FLOOR_FRAG,
    })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), this.floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.set(0, GROUND, 2)
    this.scene.add(floor)
    this.own.push(floor.geometry, this.floorMat)
    // a soft shadow under the cabinet and a pink glow behind it
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(9, 5.2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: '#05010c', transparent: true, opacity: 0.85, depthWrite: false }))
    shadow.rotation.x = -Math.PI / 2
    shadow.position.set(0, GROUND + 0.01, 0.4)
    this.scene.add(shadow)
    this.own.push(shadow.geometry, shadow.material as THREE.Material)
    const backGlowMat = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ff4fb8').multiplyScalar(0.55), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })
    const backGlow = new THREE.Sprite(backGlowMat)
    backGlow.scale.set(15, 13, 1)
    backGlow.position.set(0, 2.6, -4)
    this.scene.add(backGlow)
    this.own.push(backGlowMat)
    // neon signs on the wall either side (only a wide stage shows them)
    for (const [kind, x] of [['prizes', -5.3], ['star', 5.3]] as const) {
      const t = neonTexture(kind)
      const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: new THREE.Color(1.25, 1.25, 1.25) })
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.7), m)
      sign.position.set(x, 3.6, -3.4)
      sign.rotation.y = -Math.sign(x) * 0.12
      this.neon.push(m)
      this.signs.push(sign)
      this.scene.add(sign)
      this.own.push(t, m, sign.geometry)
    }

    // the selected prize glows from behind; a won one is shown off in front of turning rays
    this.glowSel = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color('#ff7ac8').multiplyScalar(0.8), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
    this.glowSel.scale.setScalar(1.7)
    this.scene.add(this.glowSel)
    this.own.push(this.glowSel.material)
    const raysTex = raysTexture()
    this.raysMat = new THREE.SpriteMaterial({ map: raysTex, color: new THREE.Color('#ffe9a8'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 })
    this.rays = new THREE.Sprite(this.raysMat)
    this.rays.scale.setScalar(4.2)
    this.rays.position.copy(PRESENT).add(V(0, 0.75, -0.4))
    this.rays.renderOrder = 8
    this.scene.add(this.rays)
    this.own.push(raysTex, this.raysMat)

    // effects
    this.scene.add(this.sparks.points)
    this.own.push(this.sparks)
    const confGeo = new THREE.PlaneGeometry(0.09, 0.05)
    const confMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false })
    this.confetti = new Bits(confGeo, confMat, 260, true)
    this.scene.add(this.confetti.mesh)
    this.own.push(this.confetti)
    const coinMat = new THREE.MeshToonMaterial({ color: '#ffcf3a', emissive: '#6b4500', gradientMap: null })
    this.coin = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.025, 20), coinMat)
    this.coin.visible = false
    this.scene.add(this.coin)
    this.own.push(this.coin.geometry, coinMat)

    this.onMove = (e) => this.hover(e)
    this.onLeave = () => {
      this.setHover(-1)
      this.lookTo.set(0, 0)
    }
    // a prize is picked on a tap, not on the press: a finger that starts a scroll over the machine (the browser then
    // cancels the pointer) or a drag picks nothing
    this.onDown = (e) => {
      this.press0 = e.isPrimary ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null
    }
    this.onUp = (e) => {
      const d = this.press0
      this.press0 = null
      if (!d || d.id !== e.pointerId || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 10) return
      const i = this.pickAt(e)
      if (i >= 0 && !this.busy) this.onPick?.(i)
    }
    this.onCancel = () => (this.press0 = null)
    cv.addEventListener('pointermove', this.onMove)
    cv.addEventListener('pointerleave', this.onLeave)
    cv.addEventListener('pointerdown', this.onDown)
    cv.addEventListener('pointerup', this.onUp)
    cv.addEventListener('pointercancel', this.onCancel)

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
    await step(0.08)
    if (this.disposed) return
    // the tags and the marquee are lettered in Manrope: wait (briefly) for the font
    try {
      await Promise.race([document.fonts.load('800 100px Manrope'), new Promise((r) => setTimeout(r, 1500))])
    } catch {
      /* the fallback font will do */
    }
    if (this.disposed) return
    warmUp()
    await step(0.3)
    if (this.disposed) return
    const spots = heapSpots()
    this.cab = buildCabinet(spots, heapGeometry(spots))
    this.own.push(...this.cab.own)
    this.scene.add(this.cab.root)
    this.claw = buildClaw(feltMaterial())
    this.scene.add(this.claw.swing)
    await step(0.5)
    if (this.disposed) return
    for (const p of PRIZES) {
      const rig = buildPlush(p.id)
      const slot = slotPos(p.id)
      rig.root.position.copy(slot)
      this.scene.add(rig.root)
      this.plush.push({ rig, slot, sq: 0, sqv: 0, blinkAt: 1 + Math.random() * 4, blinkEnd: 0, wiggle: 0, phase: Math.random() * TAU, mode: 'rest', hover: 0, joy: false })
    }
    this.scaleTags()
    this.placeClaw(0)
    // every face and every effect once, so every shader compiles before the first grab
    for (const p of this.plush) p.rig.blink.visible = p.rig.joy.visible = true
    this.coin.visible = true
    this.raysMat.opacity = 0.01
    this.sparks.emit(0, 0, -30, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
    this.sparks.update(0)
    this.confetti.emit(V(0, 0, -30), V(), new THREE.Color(), 1, 0.01, 0)
    this.confetti.update(0)
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
    await step(0.85)
    if (this.disposed) return
    this.composer.render()
    for (const p of this.plush) p.rig.blink.visible = p.rig.joy.visible = false
    this.coin.visible = false
    this.raysMat.opacity = 0
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

  /** small transparent pictures of each plushie (no tag), for the panel and the history */
  private makeThumbs() {
    const r = this.renderer
    const cv = r.domElement
    const size = Math.floor(Math.min(160, cv.width / 4, cv.height / 3))
    if (size < 40) return {}
    const ts = new THREE.Scene()
    const key = new THREE.DirectionalLight('#fff2e6', 2.1)
    key.position.set(-4, 7, 9)
    ts.add(key, new THREE.AmbientLight('#e6dcff', 1.0))
    const cam = new THREE.PerspectiveCamera(24, 1, 0.1, 20)
    cam.position.set(0, 0.78, 3.35)
    cam.lookAt(0, 0.63, 0)
    const out = document.createElement('canvas')
    out.width = out.height = size
    const g = out.getContext('2d')!
    const css = size / this.dpr
    const res: Partial<Record<PrizeId, string>> = {}
    const clear = r.getClearColor(new THREE.Color())
    const alpha = r.getClearAlpha()
    r.setClearColor(0x000000, 0)
    r.setScissorTest(true)
    r.setViewport(0, 0, css, css)
    r.setScissor(0, 0, css, css)
    for (const p of PRIZES) {
      const rig = buildPlush(p.id)
      rig.tag.visible = false
      const str = rig.body.getObjectByName('string')
      if (str) str.visible = false
      if (rig.halo) rig.halo.visible = false
      ts.add(rig.root)
      r.clear()
      r.render(ts, cam)
      g.clearRect(0, 0, size, size)
      g.drawImage(cv, 0, cv.height - size, size, size, 0, 0, size, size)
      res[p.id] = out.toDataURL('image/png')
      ts.remove(rig.root)
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
    this.backMat.uniforms.uAspect.value = w / h
    this.fit()
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
    this.sparks.mat.uniforms.scale.value = (h * this.dpr) / (2 * tan)
    this.markerKey = ''
  }

  /**
   * Frames the cabinet: the camera keeps its pitch and backs off until every FIT corner is on screen with a margin
   * (more on top when the stage is narrow, where the history pills sit over the marquee), then shifts the lens so the
   * cabinet sits centred between the margins.
   */
  private fit() {
    const cam = this.camera
    cam.clearViewOffset()
    const narrow = this.w / this.h < 0.9
    const mTop = (narrow ? 46 : 14) / this.h
    const mBot = 6 / this.h
    const mSide = (narrow ? 4 : 16) / this.w
    const dir = V(0, Math.sin(PITCH), Math.cos(PITCH))
    const p = V()
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
        p.set(...c).project(cam)
        x0 = Math.min(x0, p.x)
        x1 = Math.max(x1, p.x)
        y0 = Math.min(y0, p.y)
        y1 = Math.max(y1, p.y)
      }
      return { x0, x1, y0, y1 }
    }
    let lo = 4
    let hi = 80
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2
      const s = span(d)
      const okX = (s.x1 - s.x0) / 2 <= 1 - mSide * 2 && Math.max(-s.x0, s.x1) <= 1 - mSide * 2
      const okY = (s.y1 - s.y0) / 2 <= 1 - (mTop + mBot)
      if (okX && okY) hi = d
      else lo = d
    }
    const s = span(hi)
    // shift the lens so the box sits between the margins (in NDC the free space is split above and below)
    const topNdc = 1 - mTop * 2
    const botNdc = -1 + mBot * 2
    const shiftNdc = (topNdc + botNdc) / 2 - (s.y1 + s.y0) / 2
    const shiftX = -(s.x1 + s.x0) / 2
    cam.setViewOffset(this.w, this.h, (-shiftX * this.w) / 2, (shiftNdc * this.h) / 2, this.w, this.h)
    cam.updateProjectionMatrix()
    this.camBase.copy(cam.position)
    this.placeCamera()
    this.placeSigns()
    // on a phone the machine is small: the multiplier tags grow so they stay readable
    this.tagScale = this.w < 520 ? 1.3 : this.w < 760 ? 1.15 : 1
    this.scaleTags()
  }

  private tagScale = 1
  /** sizes every tag about its eyelet, so it keeps hanging from its string */
  private scaleTags() {
    for (const p of this.plush) {
      const t = p.rig.tag
      const y0 = (t.userData.y0 ??= t.position.y) as number
      t.scale.setScalar(this.tagScale)
      t.position.y = y0 - TAG_EYELET * (this.tagScale - 1)
    }
  }

  /** the neon signs go in the room the cabinet leaves at either side of the stage, sized to it (or hidden) */
  private placeSigns() {
    const z = -3.4
    const at = (nx: number, ny: number) => {
      const p = V(nx, ny, 0.5).unproject(this.camera)
      const d = p.sub(this.camera.position).normalize()
      const t = (z - this.camera.position.z) / d.z
      return this.camera.position.clone().addScaledVector(d, t)
    }
    const top = V(0, 3.9, 1.5).project(this.camera)
    this.signs.forEach((sign, i) => {
      const side = i === 0 ? -1 : 1
      const edge = V(side * 2.95, 3.9, 1.5).project(this.camera)
      const inner = at(edge.x, top.y)
      const outer = at(side, top.y)
      const room = Math.abs(outer.x - inner.x)
      const w = Math.min(3.4, room * 0.84)
      sign.visible = w > 1.5
      sign.scale.setScalar(w / 3.4)
      sign.position.set((inner.x + outer.x) / 2, inner.y + 0.2, z)
    })
  }

  /** the framed camera, drifted a touch towards the pointer: the cabinet turns ever so slightly as you look round it */
  private placeCamera() {
    const cam = this.camera
    cam.position.copy(this.camBase)
    cam.position.x += this.look.x * 0.35
    cam.position.y += this.look.y * 0.18
    cam.lookAt(TARGET)
    cam.updateMatrixWorld()
  }

  setTurbo(on: boolean) {
    this.turbo = on
  }

  /** speeds the rest of the current grab (or the show of a won prize) up */
  hurry() {
    if (this.busy || this.restocking) this.hurried = true
  }

  /** picks a prize: it squeaks and bounces (unless `quiet`, for the first pick before anyone has touched the page) */
  select(i: number, quiet = false) {
    if (i === this.selected) return
    this.selected = i
    this.markerKey = ''
    const p = this.plush[i]
    if (p && p.mode === 'rest' && !quiet) {
      p.sqv -= 2.2
      this.sound.squeak(voice(PRIZES[i].mult))
    }
  }

  /* ---------------- pointer ---------------- */

  private rayFrom(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect()
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1
    this.ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera)
    return this.ray.ray
  }

  /** the prize under the pointer: the nearest plushie whose body the ray passes through */
  private pickAt(e: PointerEvent) {
    if (!this.plush.length) return -1
    const ray = this.rayFrom(e)
    let best = -1
    let bestT = Infinity
    const c = V()
    this.plush.forEach((p, i) => {
      if (p.mode !== 'rest') return
      c.copy(p.rig.root.position).add(V(0, p.rig.top * 0.5, 0))
      const t = c.clone().sub(ray.origin).dot(ray.direction)
      const d = ray.distanceSqToPoint(c)
      if (d < 0.44 * 0.44 && t < bestT) {
        bestT = t
        best = i
      }
    })
    return best
  }

  private hover(e: PointerEvent) {
    if (e.pointerType === 'touch') return
    const r = this.renderer.domElement.getBoundingClientRect()
    this.lookTo.set(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1))
    this.setHover(this.busy ? -1 : this.pickAt(e))
  }

  private setHover(i: number) {
    if (i === this.hovered) return
    this.hovered = i
    this.renderer.domElement.style.cursor = i >= 0 ? 'pointer' : ''
  }

  /** where a plushie's head is on screen, in CSS px */
  screenOf(i: number) {
    const p = this.plush[i]
    if (!p) return null
    const v = p.rig.root.position.clone().add(V(0, p.rig.top + 0.12, 0)).project(this.camera)
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h }
  }

  /** the screen rectangle of the shown-off spot, for the win banner (CSS px) */
  presentRect() {
    const a = PRESENT.clone().add(V(0, -0.15, 0)).project(this.camera)
    return { x: ((a.x + 1) / 2) * this.w, y: ((1 - a.y) / 2) * this.h }
  }

  /* ---------------- the clock ---------------- */

  private tween(dur: number, fn: (u: number) => void) {
    return new Promise<void>((done) => {
      if (this.disposed) return done()
      fn(0)
      this.tweens.push({ t: 0, dur: Math.max(1e-3, dur), fn, done })
    })
  }
  private wait(s: number) {
    return this.tween(s, () => {})
  }

  private tick = (now: number) => {
    this.raf = requestAnimationFrame(this.tick)
    this.acc += Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    // between grabs only the lights chase and the plushies breathe: 30 frames a second is plenty
    const lively = this.busy || this.party > 0.01 || this.tweens.length > 0 || Math.abs(this.swX) + Math.abs(this.swZ) > 0.002 || this.look.distanceToSquared(this.lookTo) > 1e-5
    if (!lively && this.acc < 1 / 31) {
      this.drewLast = false
      return
    }
    const real = Math.min(0.05, this.acc)
    this.acc = 0
    this.speed = (this.turbo ? 1.9 : 1) * (this.hurried ? 2.4 : 1)
    const dt = real * this.speed
    this.time += dt
    this.clock += real
    this.update(dt, real)
    if (this.quality.frame(now, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.resize(this.w, this.h)
    }
    this.drewLast = true
    this.composer.render()
  }

  private update(dt: number, real: number) {
    if (this.tweens.length) {
      const list = this.tweens
      this.tweens = []
      const keep: Tween[] = []
      for (const t of list) {
        t.t += dt
        const u = Math.min(1, t.t / t.dur)
        t.fn(u)
        if (u >= 1) t.done()
        else keep.push(t)
      }
      // tweens started by a finishing tween's continuation land in this.tweens meanwhile
      this.tweens = keep.concat(this.tweens)
    }
    setModelTime(this.clock)
    this.backMat.uniforms.uTime.value = this.clock
    this.backMat.uniforms.uParty.value = this.party
    this.floorMat.uniforms.uTime.value = this.clock
    this.party = Math.max(0, this.party - real * 0.25)
    this.placeClaw(dt)
    this.updatePlush(dt, real)
    this.updateCabinet(dt, real)
    this.sparks.update(dt)
    this.confetti.update(dt)
    this.rays.material.rotation += real * 0.35
    if (this.look.distanceToSquared(this.lookTo) > 1e-6) {
      this.look.lerp(this.lookTo, Math.min(1, real * 2.5))
      this.placeCamera()
    }
    // the neon hums, and now and then a tube flickers
    this.neon.forEach((m, i) => {
      const flick = Math.sin(this.clock * 23 + i * 7) > 0.97 && Math.sin(this.clock * 0.7 + i * 2) > 0.6 ? 0.45 : 1
      m.color.setScalar((1.15 + 0.08 * Math.sin(this.clock * 2 + i)) * flick * (1 + this.party * 0.4))
    })
    this.updateMarker()
  }

  /** carriage, bridge, cable, swing and prongs from the claw's state; the swing is a damped pendulum driven by the carriage */
  private placeClaw(dt: number) {
    const c = this.claw
    if (!c) return
    if (dt > 0) {
      this.vx = (this.cx - this.pvx) / dt
      this.vz = (this.cz - this.pvz) / dt
    }
    const ax = dt > 0 ? (this.vx - (this.prevVx ?? 0)) / dt : 0
    const az = dt > 0 ? (this.vz - (this.prevVz ?? 0)) / dt : 0
    this.prevVx = this.vx
    this.prevVz = this.vz
    this.pvx = this.cx
    this.pvz = this.cz
    const le = Math.min(3, Math.max(0.7, this.L + 0.5))
    const w2 = 15 / le
    const n = dt > 0 ? Math.ceil(dt / 0.008) : 0
    const h = dt / Math.max(1, n)
    for (let i = 0; i < n; i++) {
      this.swXv += (-w2 * this.swX - 2.6 * this.swXv - (Math.max(-30, Math.min(30, ax)) * 0.3) / le) * h
      this.swX += this.swXv * h
      this.swZv += (-w2 * this.swZ - 2.6 * this.swZv + (Math.max(-30, Math.min(30, az)) * 0.3) / le) * h
      this.swZ += this.swZv * h
    }
    this.sway = Math.max(0, this.sway - dt * 0.6)
    const s = this.sway * Math.sin(this.time * 4.2)
    const s2 = this.sway * 0.6 * Math.sin(this.time * 3.1 + 1)
    this.cab.bridge.position.x = this.cx
    this.cab.carriage.position.set(this.cx, this.cab.carriage.position.y, this.cz)
    c.swing.position.set(this.cx, PIVOT_Y, this.cz)
    // parked, it drifts ever so gently on its cable
    const idle = this.busy ? 0 : 0.012
    c.swing.rotation.set(this.swZ + s2 * 0.06 + idle * Math.sin(this.clock * 0.9 + 1.3), 0, this.swX + s * 0.06 + idle * Math.sin(this.clock * 1.17))
    c.cable.scale.y = Math.max(0.05, this.L)
    c.hub.position.y = -this.L - HUB_DROP
    setProngs(c, this.prong)
    // the held plushie: slid down by holdSag and swinging on its own
    this.wobPhase += dt * this.wobRate
    c.hold.position.y = -this.L - HUB_DROP - this.holdSag
    c.hold.rotation.set(this.holdRx + this.wob * 0.5 * Math.sin(this.wobPhase * 0.8 + 1), 0, this.holdRz + this.wob * Math.sin(this.wobPhase))
  }
  private prevVx = 0
  private prevVz = 0

  private updatePlush(dt: number, real: number) {
    const sel = this.plush[this.selected]
    this.plush.forEach((p, i) => {
      const r = p.rig
      // squash spring
      p.sqv += (-90 * p.sq - 9 * p.sqv) * dt
      p.sq += p.sqv * dt
      p.hover += ((i === this.hovered && !this.busy ? 1 : 0) - p.hover) * Math.min(1, real * 12)
      let y = 0
      let rz = 0
      let breathe = 0
      if (p.mode === 'rest') {
        breathe = 0.018 * Math.sin(this.clock * 2.1 + p.phase)
        if (i === this.selected && !this.busy) {
          // the selected prize bounces now and then, happy to be picked
          const u = (this.clock * 0.7 + p.phase * 0.1) % 1
          if (u < 0.22) {
            const k = u / 0.22
            y = Math.sin(k * Math.PI) * 0.07
            if (k > 0.9 && p.sq > -0.02) p.sqv += 0.4
          }
        }
        if (this.clock > p.blinkAt) {
          p.blinkEnd = this.clock + 0.13
          p.blinkAt = this.clock + 2 + Math.random() * 4.5
          if (Math.random() < 0.18) p.wiggle = 1
        }
        p.wiggle = Math.max(0, p.wiggle - real * 1.6)
        rz = p.wiggle * 0.1 * Math.sin(p.wiggle * 18)
      }
      const blinking = this.clock < p.blinkEnd && !p.joy
      r.eyes.visible = !blinking && !p.joy
      r.blink.visible = blinking
      r.joy.visible = p.joy
      const sq = p.sq + breathe
      const hov = 1 + p.hover * 0.06
      r.body.scale.set((1 + sq * 0.6) * hov, (1 - sq) * hov, (1 + sq * 0.6) * hov)
      r.body.position.y = y
      r.body.rotation.z = rz
    })
    // the glow behind the selected prize
    const on = sel && sel.mode === 'rest' && !this.busy
    const g = this.glowSel
    const m = g.material as THREE.SpriteMaterial
    m.opacity += ((on ? 0.85 + 0.15 * Math.sin(this.clock * 3) : 0) - m.opacity) * Math.min(1, real * 8)
    if (sel) g.position.copy(sel.rig.root.position).add(V(0, sel.rig.top * 0.52, -0.32))
  }

  private updateCabinet(dt: number, real: number) {
    const cab = this.cab
    // the prize door swings on a spring
    this.flapV += (-60 * this.flapA - 5 * this.flapV) * dt
    this.flapA += this.flapV * dt
    cab.flap.rotation.x = -Math.max(0, this.flapA)
    // the joystick leans the way the claw goes; the button sinks when pressed
    cab.stick.rotation.z += (-this.vx * 0.22 - cab.stick.rotation.z) * Math.min(1, real * 10)
    cab.stick.rotation.x += (0.12 + this.vz * 0.22 - cab.stick.rotation.x) * Math.min(1, real * 10)
    this.press = Math.max(0, this.press - dt * 3)
    cab.button.position.y = -0.06 * Math.min(1, this.press * 2)
    const glow = cab.buttonGlow.material as THREE.MeshBasicMaterial
    glow.opacity = this.busy ? 0.35 + 0.35 * Math.sin(this.clock * 10) : 0.5 + 0.5 * Math.sin(this.clock * 3.2)
    this.coinGlow = Math.max(0, this.coinGlow - real * 1.5)
    const cm = cab.coinLight.material as THREE.MeshBasicMaterial
    const blink = this.busy ? 0.75 : Math.sin(this.clock * 4) > 0 ? 1.15 : 0.55
    cm.color.setScalar(blink + this.coinGlow * 1.5)
    // the bulbs: a slow chase between grabs, a quick one during a grab, all flashing in a party
    const n = cab.bulbAt.length
    const col = new THREE.Color()
    const warm = new THREE.Color('#ffe2a0')
    const pink = new THREE.Color('#ff6fc4')
    const speed = this.busy ? 9 : 3.5
    for (let i = 0; i < n; i++) {
      const chase = (Math.floor(this.clock * speed) + i) % 3 === 0
      let k = chase ? 1.9 : 0.55
      let c = i % 2 ? warm : pink
      if (this.party > 0.01) {
        const on = Math.floor(this.clock * 8) % 2 === i % 2
        k = lerp(k, on ? 2.6 : 0.4, Math.min(1, this.party * 2))
        c = on ? warm : pink
      }
      col.copy(c).multiplyScalar(k)
      cab.bulbs.setColorAt(i, col)
    }
    if (cab.bulbs.instanceColor) cab.bulbs.instanceColor.needsUpdate = true
    cab.stripMat.color.setRGB(1.6, 1.5, 1.35).multiplyScalar(1 + this.party * 0.5)
  }

  private updateMarker() {
    if (!this.onMarker || !this.plush.length) return
    const p = this.plush[this.selected]
    if (this.busy || !p || p.mode !== 'rest') {
      if (this.markerKey !== 'off') {
        this.markerKey = 'off'
        this.onMarker(null)
      }
      return
    }
    const at = this.screenOf(this.selected)!
    const key = `${Math.round(at.x)},${Math.round(at.y)}`
    if (key === this.markerKey) return
    this.markerKey = key
    this.onMarker(at)
  }

  /* ---------------- moving the claw ---------------- */

  /** the carriage glides to (x, z), easing in and out; the motor hums while it moves */
  private async glide(x: number, z: number, minDur = 0.55) {
    const x0 = this.cx
    const z0 = this.cz
    const d = Math.hypot(x - x0, z - z0)
    if (d < 0.01) return
    const dur = Math.max(minDur, 0.42 + d * 0.3)
    this.motorStop?.()
    this.motorStop = this.sound.motor(this.turbo || this.hurried ? 1.25 : 1)
    await this.tween(dur, (u) => {
      const k = ease(u)
      this.cx = lerp(x0, x, k)
      this.cz = lerp(z0, z, k)
    })
    this.motorStop?.()
    this.motorStop = null
    this.sound.stop()
  }

  /** the claw's hub to height y, the cable paying out or winding in */
  private async lower(y: number, dur: number, fn?: (u: number) => void) {
    const L0 = this.L
    const L1 = PIVOT_Y - HUB_DROP - y
    const stop = this.sound.winch(L1 > L0)
    await this.tween(dur, (u) => {
      this.L = lerp(L0, L1, smooth(u))
      fn?.(u)
    })
    stop()
  }

  private hubY() {
    return PIVOT_Y - HUB_DROP - this.L
  }

  private prongTo(a: number, dur: number) {
    const a0 = this.prong
    return this.tween(dur, (u) => (this.prong = lerp(a0, a, easeOut(u))))
  }

  /* ---------------- plushies in the air ---------------- */

  /** takes a plushie off the pile into the claw (keeping where it is), and eases it into the prongs' grip */
  private grabPlush(p: Plush, top: number) {
    p.mode = 'held'
    this.claw.hold.attach(p.rig.root)
    const from = p.rig.root.position.clone()
    const q0 = p.rig.root.quaternion.clone()
    const to = V(0, -(top + OVER), 0)
    this.holdSag = 0
    this.holdRx = this.holdRz = 0
    void this.tween(0.25, (u) => {
      p.rig.root.position.lerpVectors(from, to, easeOut(u))
      p.rig.root.quaternion.slerpQuaternions(q0, new THREE.Quaternion(), easeOut(u))
    })
  }

  /** lets go of whatever the claw holds, keeping it where it is in the world */
  private letGo(p: Plush) {
    this.scene.attach(p.rig.root)
    p.mode = 'air'
    this.wob = 0
    this.holdSag = 0
    this.holdRx = this.holdRz = 0
  }

  /**
   * Drops an object from where it is to `to`, as if thrown with velocity v: a parabola that ends exactly there, its
   * time set by how far it falls. Spins by `spin` (radians about z) on the way.
   */
  private fall(o: THREE.Object3D, to: THREE.Vector3, opts: { v?: THREE.Vector3; spin?: number; spinX?: number; minDur?: number; rot?: THREE.Euler } = {}) {
    const from = o.position.clone()
    const drop = Math.max(0.05, from.y - to.y)
    const dur = Math.max(opts.minDur ?? 0.22, Math.sqrt((2 * drop) / 14) + 0.06)
    const v = opts.v ?? V()
    // horizontal: start with the thrown velocity and bend onto the target
    const r0 = o.rotation.clone()
    const r1 = opts.rot ?? new THREE.Euler(r0.x + (opts.spinX ?? 0), r0.y, r0.z + (opts.spin ?? 0))
    return this.tween(dur, (u) => {
      const t = u * dur
      const hx = lerp(from.x + v.x * t, to.x, smooth(u))
      const hz = lerp(from.z + v.z * t, to.z, smooth(u))
      const y = from.y + (v.y ?? 0) * t * (1 - u) - (from.y - to.y) * easeIn(u)
      o.position.set(hx, Math.max(to.y, y), hz)
      o.rotation.set(lerp(r0.x, r1.x, u), lerp(r0.y, r1.y, u), lerp(r0.z, r1.z, u))
    })
  }

  /** a hop along an arc to `to` (height h), turning to `rot`, with a squash on landing */
  private hop(p: Plush, to: THREE.Vector3, h: number, dur: number, rot = new THREE.Euler()) {
    const o = p.rig.root
    const from = o.position.clone()
    const r0 = o.rotation.clone()
    p.sqv += 2.5
    return this.tween(dur, (u) => {
      o.position.lerpVectors(from, to, u)
      o.position.y += Math.sin(u * Math.PI) * h
      o.rotation.set(lerp(r0.x, rot.x, smooth(u)), lerp(r0.y, rot.y, smooth(u)), lerp(r0.z, rot.z, smooth(u)))
    }).then(() => {
      p.sqv += 4.5
      this.sound.thud(0.4)
      this.dust(o.position, 6)
    })
  }

  /** hops a plushie home from wherever it landed, two little hops if it is far */
  private async hopHome(p: Plush) {
    const o = p.rig.root
    const d = Math.hypot(o.position.x - p.slot.x, o.position.z - p.slot.z)
    await this.wait(0.25)
    if (d > 1.2) {
      const mid = o.position.clone().lerp(p.slot, 0.5)
      mid.y = heapY(mid.x, mid.z) - 0.04
      this.sound.hop()
      await this.hop(p, mid, 0.42, 0.4, new THREE.Euler(0, 0, o.rotation.z * 0.3))
      await this.wait(0.06)
    }
    if (d > 0.02 || Math.abs(o.rotation.z) + Math.abs(o.rotation.x) > 0.01) {
      this.sound.hop()
      await this.hop(p, p.slot, 0.36, 0.4)
    }
    o.position.copy(p.slot)
    o.rotation.set(0, 0, 0)
    p.mode = 'rest'
  }

  /** a place on the pile near (x, z) that is clear of the chute and of the other prizes */
  private clearSpot(x: number, z: number, self: number) {
    let px = Math.max(-BOX.x + 0.35, Math.min(BOX.x - 0.35, x))
    let pz = Math.max(BOX.back + 0.35, Math.min(BOX.front - 0.3, z))
    for (let k = 0; k < 6; k++) {
      if (inChute(px, pz, 0.32)) {
        // out of the chute's corner the shortest way
        const dx = CHUTE.x1 + 0.34 - px
        const dz = CHUTE.z0 - 0.34 - pz
        if (Math.abs(dx) < Math.abs(dz)) px += dx
        else pz += dz
      }
      this.plush.forEach((q, i) => {
        if (i === self) return
        const ddx = px - q.slot.x
        const ddz = pz - q.slot.z
        const d = Math.hypot(ddx, ddz)
        if (d < 0.62) {
          const push = (0.62 - d) / (d || 1)
          px += ddx * push
          pz += ddz * push
        }
      })
    }
    return V(px, heapY(px, pz) - 0.04, pz)
  }

  private dust(at: THREE.Vector3, n: number) {
    const c = new THREE.Color('#fff4fb')
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      this.sparks.emit(at.x, at.y + 0.08, at.z, Math.cos(a) * rnd(0.4, 1), rnd(0.2, 0.8), Math.sin(a) * rnd(0.4, 1), c, rnd(0.12, 0.22), rnd(0.35, 0.6), -1.5, 2)
    }
  }

  private hearts(at: THREE.Vector3, n: number, colors = ['#ff6fc4', '#ffe36b', '#7fe3ff', '#b78cff']) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU
      const c = new THREE.Color(colors[i % colors.length]).multiplyScalar(1.6)
      this.sparks.emit(at.x, at.y, at.z, Math.cos(a) * rnd(0.6, 2.4), rnd(0.8, 3), Math.sin(a) * rnd(0.3, 1.2), c, rnd(0.15, 0.32), rnd(0.6, 1.2), -3.2, 1.2)
    }
  }

  private confettiBurst(n: number) {
    const cols = ['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4', '#ffffff'].map((c) => new THREE.Color(c).multiplyScalar(1.15))
    for (let i = 0; i < n; i++) {
      const x = rnd(-3.4, 3.4)
      this.confetti.emit(V(x, 6.8 + rnd(0, 1.5), rnd(1.6, 3.4)), V(rnd(-0.4, 0.4), rnd(-1.5, -0.4), rnd(-0.2, 0.3)), cols[i % cols.length], rnd(0.8, 1.3), rnd(2.8, 4.2), -1.6, rnd(4, 10))
    }
  }

  /* ---------------- a grab ---------------- */

  /**
   * Plays one grab for the prize at `index` as the plan has it, and resolves once everything is back in place. `cues`
   * hears when the outcome becomes plain and about the moments worth a caption.
   */
  async drop(index: number, plan: Plan, cues: DropCues) {
    if (this.busy || !this.claw) {
      // never happens from the screen (it waits for both), but a round must never be left unpaid
      cues.result()
      return
    }
    this.busy = true
    this.hurried = false
    this.setHover(-1)
    const p = this.plush[index]
    const id = PRIZES[index].id
    const top = p.rig.top
    let told = false
    const tell = () => {
      if (told) return
      told = true
      cues.result()
    }
    try {
      // the coin goes in and the big button is pressed
      this.press = 1
      this.coinGlow = 1
      void this.flyCoin()
      this.sound.coin()
      await this.wait(0.22)
      this.sound.button()
      await this.wait(0.12)

      // a neighbour grab aims a little off, at the loose plushie beside the prize
      const near = plan.failure === 'neighbour'
      const [sx, sz] = SLOTS[id]
      const [nx, nz] = NEIGHBOUR[id]
      const aimX = near ? sx + nx * 0.78 : sx
      const aimZ = near ? sz + nz * 0.78 : sz
      // the claw opens as it sets off
      void this.prongTo(OPEN, 0.5)
      await this.glide(aimX, aimZ)
      await this.wait(0.12)

      // down it goes, with a little sway
      const loose = this.cab.loose[id]
      const grabY = near ? this.cab.looseAt[id].y + SMALL_HANG : p.slot.y + top + OVER
      this.sway = 0.55
      await this.lower(grabY, 0.55 + (this.hubY() - grabY) * 0.22, (u) => {
        if (near && u > 0.75) {
          // the prize gets nudged aside by the prongs
          const k = (u - 0.75) / 0.25
          const dir = Math.sign(nx) || 1
          p.rig.root.rotation.z = dir * 0.36 * Math.sin(k * Math.PI * 0.5)
          p.rig.root.position.x = p.slot.x - dir * 0.1 * k
        }
      })
      // squeeze: the prongs close on the head (or on the neighbour's body)
      this.sound.clunk()
      await this.prongTo(near ? HUG_SMALL : HUG, 0.3)
      if (near) {
        // the prize rocks back to its spot; the neighbour is caught instead
        const dir = Math.sign(nx) || 1
        void this.tween(0.5, (u) => {
          p.rig.root.rotation.z = dir * 0.36 * (1 - u) * Math.cos(u * Math.PI * 2.5)
          p.rig.root.position.x = p.slot.x - dir * 0.1 * (1 - u)
        })
        this.sound.squeak(1.6)
        cues.moment?.('neighbour')
      } else {
        this.sound.squeak(voice(PRIZES[index].mult))
        p.sqv += 3.5
        this.grabPlush(p, top)
      }
      let looseHeld: THREE.Object3D | null = null
      if (near) {
        looseHeld = loose
        // how it lay on the pile, so every fall can put it back the same way (not a little more askew each time)
        loose.userData.rest ??= loose.rotation.clone()
        this.claw.hold.attach(loose)
        const from = loose.position.clone()
        const to = V(0, -SMALL_HANG, 0)
        void this.tween(0.25, (u) => loose.position.lerpVectors(from, to, easeOut(u)))
      }
      await this.wait(0.22)

      // up
      const liftDur = 0.55 + (HOME_Y - this.hubY()) * 0.22
      if (plan.failure === 'slip') {
        await this.liftSlip(p, plan, liftDur, tell, cues)
      } else if (near && looseHeld) {
        await this.liftNeighbour(id, looseHeld, plan, liftDur, tell)
      } else {
        await this.lower(HOME_Y, liftDur, (u) => {
          if (plan.scare === 'lift' && u >= plan.at && this.holdSag === 0) this.scare(p, 0.09, 0.3)
        })
      }
      await this.wait(0.1)

      // carry it home over the chute
      if (plan.failure === 'wriggle') {
        await this.carryWriggle(p, index, plan, tell, cues)
      } else if (plan.failure === 'edge') {
        await this.carryEdge(p, index, tell, cues)
      } else if (p.mode === 'held') {
        const scareAt = plan.scare === 'carry' ? plan.at : 2
        let scared = false
        const x0 = this.cx
        const z0 = this.cz
        const d = Math.hypot(HOME.x - x0, HOME.z - z0)
        const dur = Math.max(0.6, 0.42 + d * 0.3)
        this.motorStop = this.sound.motor(this.turbo || this.hurried ? 1.25 : 1)
        await this.tween(dur, (u) => {
          const k = ease(u)
          this.cx = lerp(x0, HOME.x, k)
          this.cz = lerp(z0, HOME.z, k)
          if (!scared && u >= scareAt) {
            scared = true
            this.scare(p, 0.06, 0.42)
            cues.moment?.('scare')
          }
        })
        this.motorStop?.()
        this.motorStop = null
        this.sound.stop()
      } else {
        await this.glide(HOME.x, HOME.z)
      }

      if (plan.won && p.mode === 'held') {
        await this.wait(0.15)
        await this.winDrop(p, tell, cues)
      } else {
        // the claw opens over the chute anyway, then shuts
        await this.wait(0.1)
        await this.prongTo(OPEN * 0.8, 0.25)
        await this.wait(0.15)
        tell()
      }
      await this.prongTo(0.04, 0.3)
      // whatever ended up off its spot hops home; a won prize is replaced
      const homeJobs: Promise<void>[] = []
      if (!plan.won && p.mode !== 'rest') homeJobs.push(this.hopHome(p))
      await Promise.all(homeJobs)
    } finally {
      this.motorStop?.()
      this.motorStop = null
      this.busy = false
      this.hurried = false
      tell()
    }
  }

  /** a heart-stopping moment that holds: the plushie slides down the prongs a little and swings */
  private scare(p: Plush, sag: number, wob: number) {
    this.sound.slip()
    this.sound.squeak(0.8)
    p.sqv -= 2
    const s0 = this.holdSag
    void this.tween(0.16, (u) => (this.holdSag = lerp(s0, s0 + sag, easeOut(u))))
    this.wob = wob
    this.wobRate = 10
    void this.tween(1.1, (u) => (this.wob = wob * (1 - u) * (1 - u)))
  }

  /** the lift for a 'slip': partway up, the plushie slides out of the prongs and drops back onto its spot */
  private async liftSlip(p: Plush, plan: Plan, liftDur: number, tell: () => void, cues: DropCues) {
    const y0 = this.hubY()
    const yAt = lerp(y0, HOME_Y, plan.at)
    await this.lower(yAt, liftDur * plan.at + 0.05)
    // it starts to slide: a jerk, a squeak, a wobble...
    this.sound.slip()
    this.wob = 0.18
    this.wobRate = 14
    const s0 = this.holdSag
    await this.tween(0.32, (u) => {
      this.holdSag = s0 + 0.14 * easeIn(u)
      this.prong = lerp(HUG, HUG + 0.12, u)
    })
    // ...and it is gone
    this.letGo(p)
    cues.moment?.('slip')
    this.sound.squeak(1.3)
    const land = p.slot.clone()
    const fall = this.fall(p.rig.root, land, { rot: new THREE.Euler(0, 0, plan.side * 0.5) })
    // the claw springs up, lighter
    const up = this.lower(HOME_Y, liftDur * (1 - plan.at) + 0.1)
    void this.prongTo(SHUT * 0.4, 0.3)
    await fall
    p.sqv += 6
    this.sound.thud(0.8)
    this.dust(land, 9)
    tell()
    await this.tween(0.35, (u) => (p.rig.root.rotation.z = plan.side * 0.5 * (1 - easeOut(u))))
    p.rig.root.position.copy(p.slot)
    p.rig.root.rotation.set(0, 0, 0)
    p.mode = 'rest'
    await up
  }

  /** the lift for a 'neighbour': the loose plushie comes up, then drops off back onto its spot */
  private async liftNeighbour(id: PrizeId, loose: THREE.Object3D, plan: Plan, liftDur: number, tell: () => void) {
    const y0 = this.hubY()
    const yAt = lerp(y0, HOME_Y, Math.min(0.9, 0.35 + plan.at * 0.6))
    await this.lower(yAt, liftDur * plan.at + 0.1)
    this.sound.slip()
    this.wob = 0.25
    this.wobRate = 13
    await this.wait(0.22)
    this.scene.attach(loose)
    this.wob = 0
    const home = this.cab.looseAt[id]
    // it tumbles a full turn on the way down and lands as it lay before
    const rest = (loose.userData.rest as THREE.Euler | undefined) ?? loose.rotation.clone()
    const fall = this.fall(loose, home, { rot: new THREE.Euler(rest.x, rest.y + plan.side * TAU, rest.z) })
    const up = this.lower(HOME_Y, liftDur * 0.5 + 0.1)
    void this.prongTo(SHUT * 0.4, 0.3)
    await fall
    loose.rotation.copy(rest)
    loose.position.copy(home)
    this.sound.thud(0.6)
    this.dust(home, 7)
    tell()
    // it settles back with a little bounce
    const s = loose.scale.x
    await this.tween(0.3, (u) => loose.scale.set(s * (1 + 0.15 * Math.sin(u * Math.PI)), s * (1 - 0.18 * Math.sin(u * Math.PI)), s * (1 + 0.15 * Math.sin(u * Math.PI))))
    loose.scale.setScalar(s)
    await up
  }

  /** the carry for a 'wriggle': it starts swinging harder and harder, then wriggles out and tumbles onto the pile */
  private async carryWriggle(p: Plush, index: number, plan: Plan, tell: () => void, cues: DropCues) {
    const x0 = this.cx
    const z0 = this.cz
    const d = Math.hypot(HOME.x - x0, HOME.z - z0)
    const dur = Math.max(0.6, 0.42 + d * 0.3)
    // it must fall short of the chute: stop the wriggle early on short carries
    const at = Math.min(plan.at, 0.55)
    this.motorStop = this.sound.motor(this.turbo || this.hurried ? 1.25 : 1)
    let gone = false
    let fallJob: Promise<void> | null = null
    this.wobRate = 11 + plan.flavour * 3
    await this.tween(dur, (u) => {
      const k = ease(u)
      this.cx = lerp(x0, HOME.x, k)
      this.cz = lerp(z0, HOME.z, k)
      if (gone) return
      const start = Math.max(0, at - 0.3)
      if (u > start) {
        if (this.wob === 0) {
          this.sound.squeak(1.2)
          cues.moment?.('wriggle')
        }
        this.wob = Math.max(this.wob, 0.06 + 0.5 * clamp01((u - start) / Math.max(0.05, at - start)))
      }
      if (u >= at && Math.cos(this.wobPhase) > 0.85) {
        gone = true
        const world = new THREE.Vector3()
        p.rig.root.getWorldPosition(world)
        this.letGo(p)
        p.rig.root.position.copy(world)
        this.sound.slip()
        const ahead = V(this.vx, 0, this.vz).multiplyScalar(0.25)
        const land = this.clearSpot(world.x + ahead.x + plan.side * 0.15, world.z + ahead.z, index)
        fallJob = this.fall(p.rig.root, land, { v: V(this.vx * 0.6, 0.6, this.vz * 0.6), spin: plan.side * (1.2 + plan.flavour), spinX: -0.4 }).then(() => {
          p.sqv += 6
          this.sound.thud(1)
          this.dust(land, 10)
          tell()
        })
      }
    })
    this.motorStop?.()
    this.motorStop = null
    this.sound.stop()
    if (!gone) {
      // a very short carry ran out before the swing let go: it drops off right at the end
      const world = new THREE.Vector3()
      p.rig.root.getWorldPosition(world)
      this.letGo(p)
      p.rig.root.position.copy(world)
      const land = this.clearSpot(world.x + 0.6, world.z - 0.4, index)
      fallJob = this.fall(p.rig.root, land, { spin: plan.side * 1.4 }).then(() => {
        p.sqv += 6
        this.sound.thud(1)
        tell()
      })
    }
    this.wob = 0
    if (fallJob) await fallJob
  }

  /** the carry for an 'edge': it slips just short of the chute, lands on its rim, teeters... and topples back in */
  private async carryEdge(p: Plush, index: number, tell: () => void, cues: DropCues) {
    const x0 = this.cx
    const z0 = this.cz
    // which rim it comes over: the side one from the right, the back one from behind
    const fromBack = Math.abs(z0 - HOME.z) > Math.abs(x0 - HOME.x) * 1.2
    const rim = fromBack ? V(lerp(CHUTE.x0, CHUTE.x1, 0.55), CHUTE.rim, CHUTE.z0) : V(CHUTE.x1, CHUTE.rim, lerp(CHUTE.z0, CHUTE.z1, 0.5))
    // the point on the way where it slips: a little before the rim line
    const d = Math.hypot(HOME.x - x0, HOME.z - z0)
    const dur = Math.max(0.6, 0.42 + d * 0.3)
    const cross = fromBack ? (rim.z - 0.28 - z0) / (HOME.z - z0) : (rim.x + 0.28 - x0) / (HOME.x - x0)
    const slipU = clamp01(Number.isFinite(cross) ? cross : 0.8)
    this.motorStop = this.sound.motor(this.turbo || this.hurried ? 1.25 : 1)
    let gone = false
    let job: Promise<void> | null = null
    await this.tween(dur, (u) => {
      const k = ease(u)
      this.cx = lerp(x0, HOME.x, k)
      this.cz = lerp(z0, HOME.z, k)
      if (gone || k < slipU) return
      gone = true
      job = this.edgeFall(p, index, rim, fromBack, tell, cues)
    })
    this.motorStop?.()
    this.motorStop = null
    this.sound.stop()
    if (!gone) job = this.edgeFall(p, index, rim, fromBack, tell, cues)
    if (job) await job
  }

  private async edgeFall(p: Plush, index: number, rim: THREE.Vector3, fromBack: boolean, tell: () => void, cues: DropCues) {
    const world = new THREE.Vector3()
    p.rig.root.getWorldPosition(world)
    this.letGo(p)
    p.rig.root.position.copy(world)
    this.sound.slip()
    // it lands with its middle right on the rim, balanced on the edge
    const o = p.rig.root
    const out = fromBack ? V(0, 0, -1) : V(1, 0, 0)
    const perch = rim.clone()
    perch.y = CHUTE.rim + 0.03
    if (fromBack) perch.x = Math.max(CHUTE.x0 + 0.4, Math.min(CHUTE.x1 - 0.35, world.x))
    else perch.z = Math.max(CHUTE.z0 + 0.35, Math.min(CHUTE.z1 - 0.35, world.z))
    await this.fall(o, perch, { v: V(this.vx * 0.4, 0.3, this.vz * 0.4), rot: new THREE.Euler(0, 0, 0) })
    this.sound.rim()
    p.sqv += 5
    cues.moment?.('edge')
    // teeter: it rocks towards the chute, back, then leans right over it... and hangs there a heartbeat
    const axis = fromBack ? 'x' : 'z'
    const keys: [number, number][] = [
      [0, 0],
      [0.2, 0.3],
      [0.38, -0.16],
      [0.62, 0.44],
      [0.85, 0.4],
      [1, 0.16],
    ]
    let squeaked = false
    await this.tween(1.25, (u) => {
      let i = 1
      while (i < keys.length - 1 && u > keys[i][0]) i++
      const [u0, a0] = keys[i - 1]
      const [u1, a1] = keys[i]
      o.rotation[axis] = lerp(a0, a1, smooth(clamp01((u - u0) / (u1 - u0))))
      if (!squeaked && u > 0.55) {
        squeaked = true
        this.sound.squeak(1.25)
      }
    })
    // ...and over it goes, back into the cabinet
    this.sound.slip()
    const land = this.clearSpot(perch.x + out.x * 0.6, perch.z + out.z * 0.6, index)
    const r = new THREE.Euler(fromBack ? -1.1 : 0, 0, fromBack ? 0 : -1.1)
    await this.fall(o, land, { v: V(out.x * 0.9, 1.0, out.z * 0.9), rot: r, minDur: 0.4 })
    p.sqv += 5
    this.sound.thud(0.9)
    this.dust(land, 9)
    tell()
  }

  /** the win: it drops down the chute, out through the prize door and up into the light */
  private async winDrop(p: Plush, tell: () => void, cues: DropCues) {
    const o = p.rig.root
    this.sound.clunk()
    void this.prongTo(OPEN, 0.22)
    await this.wait(0.06)
    const world = new THREE.Vector3()
    o.getWorldPosition(world)
    this.letGo(p)
    o.position.copy(world)
    this.sound.whoosh()
    await this.fall(o, V(world.x, -1.2, world.z), { spin: 0.3 })
    this.sound.thud(0.5)
    // through the door: it pops out of the opening, the flap swinging up
    o.visible = false
    await this.wait(0.12)
    o.position.set(FLAP.x, FLAP.y - 0.3, FACE_Z - 0.35)
    o.rotation.set(0.2, 0, 0)
    o.visible = true
    this.flapV += 9
    this.sound.flap()
    tell()
    p.joy = true
    const out = V(FLAP.x + 0.2, GROUND + 0.02, FACE_Z + 0.85)
    await this.tween(0.32, (u) => {
      o.position.set(lerp(FLAP.x, out.x, u), lerp(FLAP.y - 0.3, out.y, u) + Math.sin(u * Math.PI) * 0.35, lerp(FACE_Z - 0.35, out.z, u))
      o.rotation.x = lerp(0.2, -0.2, u)
    })
    p.sqv += 5
    this.sound.thud(0.6)
    this.dust(out, 8)
    // up into the spotlight, turning once
    p.mode = 'show'
    this.party = 1
    this.sound.whoosh()
    const s0 = o.scale.x
    const from = o.position.clone()
    void this.tween(0.65, (u) => (this.raysMat.opacity = 0.75 * smooth(u)))
    await this.tween(0.6, (u) => {
      const k = easeOut(u)
      o.position.lerpVectors(from, PRESENT, k)
      o.position.y += Math.sin(u * Math.PI) * 0.8
      o.rotation.set(lerp(-0.2, 0, k), k * TAU, 0)
      o.scale.setScalar(lerp(s0, 1.75, k))
    })
    o.rotation.set(0, 0, 0)
    p.sqv += 4
    const mult = PRIZES[this.plush.indexOf(p)].mult
    cues.moment?.('present')
    this.sound.fanfare(mult)
    this.hearts(PRESENT.clone().add(V(0, 0.8, 0.3)), 40 + Math.min(80, mult * 2))
    this.confettiBurst(Math.min(240, 60 + mult * 2))
    if (mult >= 25) {
      // the top prizes get a second wave from both sides
      void this.wait(0.45).then(() => {
        this.confettiBurst(Math.min(200, mult * 2))
        this.hearts(PRESENT.clone().add(V(-1.6, 0.4, 0.2)), 30, ['#ffe36b', '#ffffff', '#ffcf3a'])
        this.hearts(PRESENT.clone().add(V(1.6, 0.4, 0.2)), 30, ['#ffe36b', '#ffffff', '#ffcf3a'])
      })
    }
  }

  /** the won plushie bows out and a fresh one drops in onto the empty spot */
  async restock(index: number, hold: number, onGone?: () => void) {
    const p = this.plush[index]
    if (!p || p.mode !== 'show') return
    this.restocking = true
    try {
      await this.restockPlush(p, index, hold, onGone)
    } finally {
      this.restocking = false
      this.hurried = false
    }
  }

  private async restockPlush(p: Plush, index: number, hold: number, onGone?: () => void) {
    const o = p.rig.root
    // it bounces happily while it is shown off; the top prizes glitter
    const t0 = this.time
    const mult = PRIZES[index].mult
    let glitter = 0
    const gold = [new THREE.Color('#ffe36b').multiplyScalar(1.8), new THREE.Color('#ffffff').multiplyScalar(1.8)]
    await this.tween(hold, () => {
      const t = this.time - t0
      o.position.y = PRESENT.y + Math.abs(Math.sin(t * 5)) * 0.12
      o.rotation.z = Math.sin(t * 5) * 0.08
      if (mult >= 10 && t > glitter) {
        glitter = t + (mult >= 50 ? 0.05 : 0.12)
        const a = Math.random() * TAU
        const r = rnd(0.7, 1.3)
        this.sparks.emit(PRESENT.x + Math.cos(a) * r, PRESENT.y + 0.8 + Math.sin(a) * r * 0.9, PRESENT.z + 0.2, 0, rnd(0.1, 0.4), 0, gold[Math.random() < 0.6 ? 0 : 1], rnd(0.12, 0.26), rnd(0.4, 0.8), 0, 0, 1.5)
      }
    })
    // a sparkle, and it is gone
    onGone?.()
    this.sound.poof()
    this.hearts(o.position.clone().add(V(0, 0.8, 0)), 24)
    const s0 = o.scale.x
    void this.tween(0.4, (u) => (this.raysMat.opacity = 0.75 * (1 - u)))
    await this.tween(0.22, (u) => o.scale.setScalar(s0 * (1 - easeIn(u))))
    p.joy = false
    o.scale.setScalar(1)
    o.rotation.set(0, 0, 0)
    // the new one falls in from under the header onto the spot
    o.position.set(p.slot.x, BOX.ceil + 0.3, p.slot.z)
    p.mode = 'air'
    await this.wait(0.15)
    this.sound.restock()
    await this.fall(o, p.slot, { minDur: 0.5 })
    p.sqv += 7
    this.sound.thud(1)
    this.dust(p.slot, 12)
    o.position.copy(p.slot)
    p.mode = 'rest'
  }

  /** the coin flies into the slot */
  private async flyCoin() {
    const c = this.coin
    const to = V(COIN.x, COIN.y, FACE_Z + 0.16)
    const from = to.clone().add(V(0.5, -0.9, 1.4))
    c.visible = true
    await this.tween(0.32, (u) => {
      const k = easeOut(u)
      c.position.lerpVectors(from, to, k)
      c.position.y += Math.sin(u * Math.PI) * 0.4
      c.rotation.set(Math.PI / 2, 0, u * TAU * 1.5)
      c.scale.setScalar(1 - 0.5 * easeIn(u))
    })
    c.visible = false
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    this.motorStop?.()
    const cv = this.renderer.domElement
    cv.removeEventListener('pointermove', this.onMove)
    cv.removeEventListener('pointerleave', this.onLeave)
    cv.removeEventListener('pointerdown', this.onDown)
    cv.removeEventListener('pointerup', this.onUp)
    cv.removeEventListener('pointercancel', this.onCancel)
    // let anything awaiting the scene finish, so the screen code can unwind
    const left = this.tweens
    this.tweens = []
    for (const t of left) t.done()
    for (const o of this.own) o.dispose()
    // every geometry in the scene (the cached ones are only let go of on the GPU, and come back next visit)
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose()
    })
    // the shared caches would otherwise keep this renderer alive after the game closes (see releaseModels)
    releaseModels()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
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
  // a deep purple wall, lighter towards the middle
  vec3 col = mix(vec3(0.07, 0.02, 0.16), vec3(0.2, 0.06, 0.32), smoothstep(1.2, 0.0, length(p - vec2(0.0, 0.55))));
  // a faint print of diamonds
  vec2 g = p * 9.0;
  vec2 c = fract(g) - 0.5;
  float d = abs(c.x) + abs(c.y);
  col += vec3(0.5, 0.25, 0.7) * 0.05 * smoothstep(0.12, 0.08, abs(d - 0.32));
  // soft neon glows drifting at the sides
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 at = vec2((hash(vec2(fi, 1.0)) - 0.5) * uAspect * 1.6, 0.25 + hash(vec2(fi, 2.0)) * 0.7);
    at.y += sin(uTime * 0.2 + fi) * 0.03;
    vec3 tint = mod(fi, 3.0) < 1.0 ? vec3(1.0, 0.3, 0.75) : mod(fi, 3.0) < 2.0 ? vec3(0.25, 0.8, 1.0) : vec3(0.75, 0.45, 1.0);
    float r = 0.1 + hash(vec2(fi, 3.0)) * 0.16;
    col += tint * 0.22 * exp(-pow(length(p - at) / r, 2.0)) * (0.8 + 0.2 * sin(uTime * 0.8 + fi * 2.0));
  }
  col *= 1.0 + uParty * 0.35 * (0.5 + 0.5 * sin(uTime * 12.0));
  gl_FragColor = vec4(col, 1.0);
}`

const FLOOR_FRAG = /* glsl */ `
varying vec3 vW;
uniform float uTime;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  // arcade carpet: deep navy, with neon squiggles and dots in cells
  vec2 g = vW.xz * 1.3;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash(id);
  vec3 col = vec3(0.06, 0.03, 0.14);
  vec3 tint = h < 0.33 ? vec3(1.0, 0.35, 0.7) : h < 0.66 ? vec3(0.3, 0.85, 1.0) : vec3(1.0, 0.85, 0.3);
  vec2 o = vec2(hash(id + 3.1), hash(id + 7.7)) - 0.5;
  float dot1 = smoothstep(0.09, 0.06, length(f - o * 0.5));
  float ring = smoothstep(0.03, 0.0, abs(length(f + o * 0.4) - 0.16)) * step(0.5, hash(id + 1.3));
  col += tint * (dot1 + ring) * 0.55;
  // fade into the dark away from the cabinet
  float fade = smoothstep(9.0, 2.0, length(vW.xz - vec2(0.0, 1.5)));
  gl_FragColor = vec4(col * (0.35 + 0.65 * fade), 1.0);
}`

/** a neon sign: glowing tubes on a dark backing, drawn as soft wide strokes under a bright core */
function neonTexture(kind: 'prizes' | 'star') {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  const tube = (draw: () => void, color: string) => {
    for (const [w, a, blur] of [[22, 0.18, 26], [12, 0.45, 12], [6, 1, 4]] as const) {
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
    g.lineWidth = 2.4
    g.lineCap = 'round'
    g.lineJoin = 'round'
    draw()
    g.restore()
  }
  if (kind === 'prizes') {
    g.font = '800 104px Manrope, ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    tube(() => g.strokeText('PRIZES', 256, 150), '#ff4fb8')
    tube(() => {
      g.beginPath()
      const x = 256
      const y = 62
      const s = 26
      g.moveTo(x, y + s * 0.4)
      g.bezierCurveTo(x - s * 1.3, y - s * 0.4, x - s * 0.5, y - s * 1.2, x, y - s * 0.5)
      g.bezierCurveTo(x + s * 0.5, y - s * 1.2, x + s * 1.3, y - s * 0.4, x, y + s * 0.4)
      g.stroke()
    }, '#ffd23f')
  } else {
    tube(() => {
      g.beginPath()
      for (let i = 0; i <= 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const r = i % 2 ? 34 : 78
        const x = 150 + Math.cos(a) * r
        const y = 128 + Math.sin(a) * r
        if (i) g.lineTo(x, y)
        else g.moveTo(x, y)
      }
      g.stroke()
    }, '#ffd23f')
    g.font = '800 92px Manrope, ui-rounded, system-ui, sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    tube(() => g.strokeText('WIN!', 340, 134), '#2fd3ff')
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function raysTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  g.translate(128, 128)
  for (let i = 0; i < 16; i++) {
    g.rotate((Math.PI * 2) / 16)
    const grad = g.createLinearGradient(0, 0, 128, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0.9)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(128, -14)
    g.lineTo(128, 14)
    g.closePath()
    g.fill()
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
