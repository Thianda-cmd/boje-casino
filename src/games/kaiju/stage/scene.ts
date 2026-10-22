import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { PacedQuality, glowTexture, ringTexture } from '../../../lib/three/fx'
import { FIGHT_MS } from '../clock'
import { BUILDINGS, DIRS, SHORE_Z, START } from '../arena'
import { impactAt, posAt } from '../fight'
import { fighter, matchupOf, sideId } from '../rules'
import { buildKaiju, strikerFor } from '../models'
import type { Fight, FightEvent, KaijuId, KaijuRig, Side, StageEvent, StageView } from '../types'
import { actAll, type Act, type Cast } from './acting'
import { CamRig } from './camera'
import { City } from './city'
import { CRACKS, FOAMS, FOG } from './shaders'
import { FIGHT0, GIRTH, INTRO, WALK0, WATER_Y, heavyOf, isStrike, pullIn, replayOf, shakeAt, shotPose, show, stageEvents, type Show } from './director'
import { FIRE0, FIRE1, Fx, Special, type Aim } from './fx'

/*
  Kaiju Clash's 3D stage: Neon Bay at night with the round's two kaiju, played from the shared clock and the fight
  script. Everything on it is worked out from the moment on the clock (director.ts: which stretch of the show, which
  script time, which camera shot; acting.ts: where each kaiju is and what it is doing), so every screen shows the same
  fight, a page that joins late or comes back to its tab picks up at the right beat, and the lab can scrub. The
  fleeting effects (sparks, dust, spray) are started as the show passes their moments and run on the show's clock.

  Each frame: the show at the clock's moment, the two rigs posed and placed, the buildings as they stand (or fall,
  buildings.ts), the effects the moment calls for (a blow's sparks where the striker's fist meets the other, dust where
  a body hits the ground, the plume of a building coming down, a kaiju's special drawn from its beat, the spray of a
  Splash), the light on the ground and the water (spotlights, the kaijus' own glow, a beam's glow, cracks, foam), the
  city's life (searchlights, helicopters, the wheel), the camera, and what the page should hear (stageEvents, on the
  live clock, once each). Bloom makes the neon and the specials glow.

  Performance: one draw call per kaiju, six for every building in the city, the rest a few dozen; the render
  resolution adapts (PacedQuality), phones get the 'low' rigs, fewer particles and half-resolution bloom; rendering
  stops when the stage is hidden or scrolled away (setActive). Reduced motion: no shake, flashes, slow motion or
  camera moves (a steady wide shot per stretch), the city's ambient motion held still, and the stage redrawn a few
  times a second rather than animated.
*/

export interface StageOpts {
  low: boolean
  calm: boolean
}

interface Overlay {
  flash?: HTMLElement
  bars?: HTMLElement
  tag?: HTMLElement
}

/** a moment the effects must catch as the show passes it */
interface Beat {
  t: number
  kind: 'land' | 'block' | 'grab' | 'thud' | 'fall' | 'stomp' | 'collapse' | 'splash' | 'water'
  e?: FightEvent
  building?: number
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const TAU = Math.PI * 2
const GLOW: Record<KaijuId, string> = { rexor: '#5fe0ff', gorrath: '#ff8a3d', titan: '#ff3b4f', kraka: '#b06bff', lumina: '#ffe36b', pincer: '#ffb04f', bedrock: '#ff7a2f', voltra: '#7df9ff' }
const HEAVY_FEET = new Set<KaijuId>(['bedrock', 'gorrath', 'titan', 'rexor'])
const SPOT_COL: Record<Side, THREE.Color> = { a: new THREE.Color('#ffd6b8'), b: new THREE.Color('#c4dcff') }
const WIN_COL = new THREE.Color('#ffd98a')
const GLOW_C = Object.fromEntries(Object.entries(GLOW).map(([k, v]) => [k, new THREE.Color(v)])) as Record<KaijuId, THREE.Color>
const PYRO: Record<Side, THREE.Color[]> = { a: [new THREE.Color(3, 1.4, 0.4), new THREE.Color(3, 2.4, 1.2)], b: [new THREE.Color(0.6, 1.6, 3), new THREE.Color(2, 2.6, 3)] }
const FIREWORK = [new THREE.Color('#ffd36b'), new THREE.Color('#22d36f'), new THREE.Color('#ff4fa3'), new THREE.Color('#4cc3ff')]

const beatsOf = new WeakMap<Fight, Beat[]>()
function fxBeats(f: Fight): Beat[] {
  const hit = beatsOf.get(f)
  if (hit) return hit
  const out: Beat[] = []
  for (const e of f.events) {
    if (isStrike(e) && e.outcome && e.action !== 'beam' && e.action !== 'stomp' && e.action !== 'throw') {
      if (e.action === 'grab') out.push({ t: impactAt(e), kind: 'grab', e })
      else if (e.outcome === 'land') out.push({ t: impactAt(e), kind: 'land', e })
      else if (e.outcome === 'block') out.push({ t: impactAt(e), kind: 'block', e })
    }
    if (e.action === 'stomp') out.push({ t: impactAt(e), kind: 'stomp', e })
    if (e.action === 'knockdown') out.push({ t: e.t + Math.round(e.dur * 0.66), kind: 'fall', e })
    if (e.action === 'thrown') out.push({ t: e.t + e.dur, kind: e.to && e.to.z < SHORE_Z ? 'splash' : 'thud', e })
    if (e.action === 'sink') out.push({ t: e.t, kind: 'water', e })
  }
  for (const c of f.collapses) out.push({ t: c.t, kind: 'collapse', building: c.building })
  out.sort((x, y) => x.t - y.t)
  beatsOf.set(f, out)
  return out
}

/** cracks and scorch marks on the ground: where and when, how big, what colour (pure, from the script) */
interface Mark {
  t: number
  x: number
  z: number
  r: number
  c: THREE.Color
}
const marksOf = new WeakMap<Fight, Mark[]>()

export class KaijuStage {
  readonly ready: Promise<void>
  onEvent: ((e: StageEvent) => void) | null = null
  onFail: (() => void) | null = null
  overlay: Overlay = {}
  /** the shared clock (server ms) */
  now: () => number = () => Date.now()
  /** frame cost, for the lab and the screenshot tool */
  readonly stats = { ms: 0, fps: 0, calls: 0, tris: 0, dpr: 1, frames: 0, bloom: true }

  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly rig: CamRig
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private readonly quality = new PacedQuality(0.5)
  private city!: City
  private fx!: Fx
  private readonly spots: THREE.SpotLight[] = []
  private readonly low: boolean
  private calm: boolean
  private view: StageView | null = null
  private readonly pool = new Map<KaijuId, KaijuRig>()
  private cast: (Cast & { rig: Record<Side, KaijuRig> }) | null = null
  private specials: Partial<Record<Side, Special>> = {}
  private readonly face: Record<Side, number> = { a: Math.PI / 2, b: -Math.PI / 2 }
  private readonly stepPhase: Record<Side, number> = { a: 0, b: 0 }
  private w = 1
  private h = 1
  private dpr = 1
  private baseDpr = 1
  private raf = 0
  private active = true
  private disposed = false
  private started = false
  private drewLast = false
  private lastReal = 0
  private lastDraw = 0
  /** the show last drawn: round, script time and stretch (a jump clears the effects) */
  private lastId = -1
  private lastSt = -Infinity
  private lastC = -1
  private lastCut = -1
  private beatIx = 0
  /** the events the page has heard: round and clock */
  private heard = { id: -1, c: -1 }
  private lastFire = -1
  private prepNext = -1
  private prepping = false
  private replayOn = false
  private locked: number | null = null
  private pyroOwed: Record<string, number> = {}
  private readonly tmp = V()
  private readonly tmp2 = V()

  constructor(host: HTMLElement, o: StageOpts) {
    this.low = o.low
    this.calm = o.calm
    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' })
    this.renderer.info.autoReset = false
    this.dpr = this.baseDpr = Math.min(devicePixelRatio || 1, o.low ? 1.5 : 1.75)
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.setClearColor('#0c0820')
    const cv = this.renderer.domElement
    cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;outline:none'
    cv.addEventListener('webglcontextlost', this.onLost)
    host.appendChild(cv)
    this.rig = new CamRig(16 / 9)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: o.low ? 0 : 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.rig.cam))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.45, 1.0)
    if (o.low) {
      const size = this.bloom.setSize.bind(this.bloom)
      this.bloom.setSize = (w: number, h: number) => size(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)))
    }
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // the night's light: the moon behind the fighters (a cool rim), a warm key from the camera side, neon fills, and
    // the two fighters' spotlights from high above
    this.scene.fog = new THREE.FogExp2(FOG.color, FOG.density)
    const moon = new THREE.DirectionalLight('#9ab8ff', 1.6)
    moon.position.set(-40, 50, -90)
    const key = new THREE.DirectionalLight('#ffe6d2', 2.2)
    key.position.set(26, 34, 46)
    const pink = new THREE.DirectionalLight('#ff4fa3', 0.45)
    pink.position.set(-50, 12, 24)
    const sky = new THREE.DirectionalLight('#4cc3ff', 0.35)
    sky.position.set(50, 10, 10)
    this.scene.add(moon, key, pink, sky, new THREE.HemisphereLight('#6a5aa8', '#1a1030', 0.75))
    for (const s of ['a', 'b'] as const) {
      const sp = new THREE.SpotLight(SPOT_COL[s], 0, 0, 0.3, 0.65, 0)
      sp.position.set(START[s].x * 0.6, 46, 14)
      sp.target.position.set(START[s].x, 0, START[s].z)
      this.scene.add(sp, sp.target)
      this.spots.push(sp)
    }
    const r0 = host.getBoundingClientRect()
    this.resize(r0.width || 800, r0.height || 450)
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
      await Promise.race([document.fonts.load('900 60px Manrope'), new Promise((r) => setTimeout(r, 1200))])
    } catch {
      /* the fallback font will do for the signs */
    }
    if (this.disposed) return
    this.city = new City({ low: this.low })
    this.scene.add(this.city.root)
    await step()
    if (this.disposed) return
    this.fx = new Fx(this.low)
    this.scene.add(this.fx.root)
    if (this.view) this.castFor(this.view)
    await step()
    if (this.disposed) return
    // every shader once before the first frame shows (each kaiju's special, the bursts and the dust included), so
    // nothing stutters the first time it appears
    const warm = (['rexor', 'voltra', 'kraka', 'pincer', 'bedrock'] as const).map((id) => new Special(id, this.fx, '#ffffff'))
    try {
      for (const sp of warm) {
        this.scene.add(sp.root)
        sp.root.traverse((o) => (o.visible = true))
      }
      this.fx.sparks.emit(0, -50, 0, 0, 0, 0, new THREE.Color(), 0.1, 0.01)
      this.fx.puffs.emit(V(0, -50, 0), V(), new THREE.Color(), 0.1, 0.1, 0.01)
      this.fx.debris.emit(V(0, -50, 0), V(), new THREE.Color(), 0.1, 0.01, 0)
      this.fx.update(0)
      await this.renderer.compileAsync(this.scene, this.rig.cam)
    } catch {
      /* compiles on the first frame instead */
    }
    for (const sp of warm) {
      this.scene.remove(sp.root)
      sp.dispose()
    }
    if (this.disposed) return
    this.started = true
    this.lastReal = performance.now()
    this.loop()
  }

  /* ---------------- the page's side ---------------- */

  setView(v: StageView | null) {
    const prev = this.view
    this.view = v
    if (!v) return
    if (!prev || prev.id !== v.id || prev.matchup.a !== v.matchup.a || prev.matchup.b !== v.matchup.b) {
      if (this.fx) this.castFor(v)
    }
  }

  setCalm(calm: boolean) {
    this.calm = calm
  }

  /** the stage is on screen and its tab visible: draw; otherwise stop drawing altogether */
  setActive(on: boolean) {
    if (on === this.active) return
    this.active = on
    if (on && this.started && !this.disposed) {
      this.lastReal = performance.now()
      this.drewLast = false
      cancelAnimationFrame(this.raf)
      this.loop()
    } else cancelAnimationFrame(this.raf)
  }

  resize(w: number, h: number) {
    if (w < 2 || h < 2) return
    this.w = w
    this.h = h
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(w, h, false)
    this.composer.setPixelRatio(this.dpr)
    this.composer.setSize(w, h)
    this.rig.setAspect(w / h)
    this.stats.dpr = this.dpr
  }

  /* ---------------- the two kaiju ---------------- */

  private rigOf(id: KaijuId) {
    let r = this.pool.get(id)
    if (!r) {
      r = buildKaiju(id, this.low ? 'low' : 'high')
      this.pool.set(id, r)
    }
    return r
  }

  private castFor(v: StageView) {
    const { a, b } = v.matchup
    const ra = this.rigOf(a)
    const rb = this.rigOf(b)
    for (const [id, r] of this.pool) {
      if (id !== a && id !== b) this.scene.remove(r.group)
    }
    this.scene.add(ra.group, rb.group)
    // keep a few rigs ready (the next fights' are built ahead); let the rest go
    if (this.pool.size > 5) {
      const next = matchupOf(v.id + 1)
      for (const [id, r] of [...this.pool]) {
        if (this.pool.size <= 4) break
        if (id === a || id === b || id === next.a || id === next.b) continue
        r.dispose()
        this.pool.delete(id)
      }
    }
    this.cast = {
      id: { a, b },
      h: { a: ra.height, b: rb.height },
      reach: { a: ra.reach, b: rb.reach },
      girth: { a: GIRTH[a], b: GIRTH[b] },
      rig: { a: ra, b: rb },
    }
    for (const s of ['a', 'b'] as const) {
      this.specials[s]?.dispose()
      if (this.specials[s]) this.fx.root.remove(this.specials[s]!.root)
      const sp = new Special(sideId(v.matchup, s), this.fx, fighter(sideId(v.matchup, s)).colors.glow)
      this.fx.root.add(sp.root)
      this.specials[s] = sp
    }
    this.face.a = Math.PI / 2
    this.face.b = -Math.PI / 2
    this.lastSt = -Infinity
  }

  /** builds the next fight's rigs ahead while the result shows, one at a time when the browser is idle */
  private prepare(id: number) {
    if (this.prepNext === id || this.prepping) return
    const m = matchupOf(id)
    const k = [m.a, m.b].find((x) => !this.pool.has(x))
    if (!k) {
      this.prepNext = id
      return
    }
    this.prepping = true
    const build = () => {
      this.prepping = false
      if (!this.disposed) this.rigOf(k)
    }
    if ('requestIdleCallback' in window) requestIdleCallback(build, { timeout: 1500 })
    else setTimeout(build, 0)
  }

  /* ---------------- the loop ---------------- */

  private loop = () => {
    if (this.disposed || !this.active) return
    this.raf = requestAnimationFrame(this.loop)
    const nowReal = performance.now()
    // reduced motion: a still now and then rather than animation
    if (this.calm && nowReal - this.lastDraw < 700) return
    const real = Math.min(0.1, Math.max(0, (nowReal - this.lastReal) / 1000))
    this.lastReal = nowReal
    const t0 = performance.now()
    try {
      this.frame(real)
    } catch (err) {
      if (import.meta.env.DEV) console.error(err)
    }
    if (this.locked === null && this.quality.frame(nowReal, this.drewLast) && this.w > 1) {
      this.dpr = this.baseDpr * this.quality.q
      this.bloom.enabled = this.quality.q >= 0.6
      this.stats.bloom = this.bloom.enabled
      this.resize(this.w, this.h)
    }
    this.drewLast = !this.calm
    const info = this.renderer.info
    info.reset()
    this.composer.render()
    this.lastDraw = nowReal
    const cost = performance.now() - t0
    this.stats.ms = this.stats.ms ? this.stats.ms * 0.92 + cost * 0.08 : cost
    this.stats.fps = real > 0 ? (this.stats.fps ? this.stats.fps * 0.92 + (1 / real) * 0.08 : 1 / real) : this.stats.fps
    this.stats.calls = info.render.calls
    this.stats.tris = info.render.triangles
    this.stats.frames++
  }

  /** holds the render resolution at q times the device's (null: adapt to the frame rate again), for screenshots */
  lockQuality(q: number | null) {
    this.locked = q
    this.dpr = this.baseDpr * (q ?? this.quality.q)
    this.bloom.enabled = (q ?? this.quality.q) >= 0.6
    this.stats.bloom = this.bloom.enabled
    this.resize(this.w, this.h)
  }

  /** draws one frame now, whatever the loop is doing (a still on demand) */
  drawNow() {
    if (!this.started) return
    this.frame(0)
    this.composer.render()
    this.stats.frames++
  }

  private frame(real: number) {
    const v = this.view
    const city = this.city
    const fx = this.fx
    if (!v || !this.cast) {
      // no round yet: the city on its own, a slow drift over the bay
      const time = performance.now() / 1000
      city.update(time, { focus: V(), spots: [], main: false, cross: 0, calm: this.calm })
      const a = -0.25 + Math.sin(time * 0.05) * 0.2
      this.rig.apply({ eye: { x: Math.sin(a) * 70, y: 26, z: Math.cos(a) * 70 }, target: { x: 0, y: 6, z: -10 }, fov: 38 }, -1, real, 0, 0, false)
      fx.update(real)
      return
    }
    const sh0 = show(v, this.now())
    // reduced motion: the live clock throughout (no hit-stop, slow motion or replay)
    const sh: Show = this.calm ? { ...sh0, st: sh0.r, rate: 1, replay: false, flash: 0 } : sh0
    const f = v.fight
    const fighting = !!f && sh.c >= FIGHT0
    // a jump of the clock (a new round, the replay, a scrub, a tab come back) clears what was flying
    const jumped = v.id !== this.lastId || sh.c < this.lastC - 1 || sh.c - this.lastC > 1500 || sh.replay !== this.replayOn || (fighting && this.lastSt > -Infinity && (sh.st < this.lastSt - 1 || sh.st - this.lastSt > 1200))
    // the effects run on the show's own clock: frozen in the hit-stop, slow in the slow motion (and in the lab's)
    const dt = this.calm || jumped ? 0 : fighting && this.lastSt > -Infinity ? Math.max(0, sh.st - this.lastSt) / 1000 : Math.max(0, sh.c - this.lastC) / 1000
    if (jumped) {
      fx.clear()
      for (const s of ['a', 'b'] as const) this.specials[s]?.reset()
      if (f) {
        const list = fxBeats(f)
        let i = 0
        while (i < list.length && list[i].t <= sh.st) i++
        this.beatIx = i
      }
      if (v.id !== this.lastId) city.ring.reset()
    }
    const snap = jumped
    this.lastId = v.id
    this.lastC = sh.c
    this.replayOn = sh.replay
    // the kaiju
    const acts = actAll(v, sh, this.cast)
    for (const s of ['a', 'b'] as const) this.place(s, acts[s], real, snap)
    // the buildings
    if (fighting) {
      const at = fallTimes(f!)
      city.ring.update(Math.min(sh.st, FIGHT_MS + 60000), (i) => at.get(i) ?? Infinity)
    } else city.ring.update(-1, () => Infinity)
    // the moments the show passes: sparks, dust, collapses, spray
    if (fighting && !jumped) this.beats(f!, sh, acts)
    if (fighting) this.lastSt = sh.st
    else this.lastSt = -Infinity
    // the specials
    for (const s of ['a', 'b'] as const) this.special(s, acts, sh, dt)
    // footsteps of the heavy ones
    if (!this.calm) for (const s of ['a', 'b'] as const) this.steps(s, acts[s])
    fx.update(dt)
    // the light on the ground and the water
    this.light(v, sh, acts)
    // the city's life
    const mid = V((acts.a.x + acts.b.x) / 2, 0, (acts.a.z + acts.b.z) / 2)
    const cross = sh.stretch === 'walkout' ? Math.min(1, (sh.c - WALK0) / 800) * Math.min(1, (FIGHT0 - sh.c) / 900) : 0
    const settled = sh.stretch === 'after' && !sh.replay
    city.update(this.calm ? 0 : (this.now() / 1000) % 3600, {
      focus: mid,
      spots: (['a', 'b'] as const).map((s) => ({ p: V(acts[s].x, 0, acts[s].z), k: acts[s].spot, color: settled && f && f.result.winner === s ? WIN_COL : SPOT_COL[s] })),
      main: v.matchup.main,
      cross: Math.max(cross, settled && v.matchup.main ? 0.5 : 0),
      calm: this.calm,
    })
    // fireworks for a Main Event; at every walkout, fountains of sparks behind each kaiju as its corner is called
    if (v.matchup.main && !this.calm) this.fireworks(sh, f)
    if (!this.calm && sh.stretch === 'walkout') this.pyro(sh, acts, dt)
    // the next fight's rigs, built ahead while the result shows
    if (sh.c > FIGHT0 + FIGHT_MS + 1500) this.prepare(v.id + 1)
    // the camera
    this.camera(v, sh, acts, real, snap)
    // what the page hears
    this.hear(v, sh)
    // the overlays: the finish's flash, the replay's letterbox
    this.overlays(sh)
    this.lastCut = sh.cut
  }

  /** puts a kaiju where the acting says, turning smoothly */
  private place(s: Side, a: Act, real: number, snap: boolean) {
    const rig = this.cast!.rig[s]
    let f = this.face[s]
    if (snap || real === 0) f = a.face
    else {
      // turning toward where it should face, briskly but never in a snap
      let d = a.face - f
      d -= TAU * Math.round(d / TAU)
      const max = 8 * real
      f += Math.max(-max, Math.min(max, d * (1 - Math.exp(-real * 9))))
    }
    this.face[s] = f
    rig.group.position.set(a.x, a.y, a.z)
    rig.group.rotation.y = f
    rig.pose(a.action, a.t, a.time, a.blend)
    rig.charge(a.charge)
    rig.flash(a.flash)
    rig.group.updateMatrixWorld(true)
  }

  /** a point on the defender's body facing the striker, at a height */
  private bodyPoint(def: Side, from: THREE.Vector3, y: number, out = this.tmp) {
    const c = this.cast!
    const g = c.rig[def].group.position
    out.set(g.x, 0, g.z)
    const d = this.tmp2.set(from.x - g.x, 0, from.z - g.z)
    const l = d.length() || 1
    out.addScaledVector(d, (c.girth[def] * 0.75) / l)
    out.y = y
    return out
  }

  private beats(f: Fight, sh: Show, acts: Record<Side, Act>) {
    const list = fxBeats(f)
    const fx = this.fx
    const c = this.cast!
    while (this.beatIx < list.length && list[this.beatIx].t <= sh.st) {
      const b = list[this.beatIx++]
      if (b.t <= this.lastSt) continue
      const e = b.e
      switch (b.kind) {
        case 'land':
        case 'block':
        case 'grab': {
          const att = e!.who
          const def: Side = att === 'a' ? 'b' : 'a'
          const P = strikerFor(c.rig[att], e!.action).getWorldPosition(V())
          const body = this.bodyPoint(def, P, Math.min(Math.max(P.y, 2), c.h[def] * 0.8)).clone()
          const at = P.distanceTo(body) < 3.5 ? P : body
          const dir = body.clone().sub(V(acts[att].x, body.y, acts[att].z)).normalize()
          if (b.kind === 'grab') fx.impact(at, dir, new THREE.Color(GLOW[c.id[att]]), false, true)
          else fx.impact(at, dir, new THREE.Color(GLOW[c.id[att]]), heavyOf(e!), b.kind === 'block')
          if (b.kind === 'land' && heavyOf(e!)) fx.slam(V(acts[def].x, 0, acts[def].z), 0.5)
          break
        }
        case 'stomp': {
          const s = e!.who
          const fwd = V(Math.sin(this.face[s]), 0, Math.cos(this.face[s]))
          fx.slam(V(acts[s].x, 0, acts[s].z).addScaledVector(fwd, 3), 0.9, new THREE.Color(1.2, 1.1, 1))
          break
        }
        case 'fall': {
          const s = e!.who
          const back = V(-Math.sin(this.face[s]), 0, -Math.cos(this.face[s]))
          fx.slam(V(acts[s].x, 0, acts[s].z).addScaledVector(back, c.h[s] * 0.35), 1.1 * (c.h[s] / 11), new THREE.Color(1.1, 1.0, 0.9))
          break
        }
        case 'thud':
          fx.slam(V(e!.to!.x, 0, e!.to!.z), 1.3, new THREE.Color(1.2, 1.1, 1))
          break
        case 'splash':
          fx.splash(V(e!.to!.x, WATER_Y, e!.to!.z), true, WATER_Y)
          break
        case 'water':
          break
        case 'collapse': {
          const i = b.building!
          const B = BUILDINGS[i]
          const ruin = this.city.ring.ruins[i]
          const wall = ruin.pieces.find((p) => p.shape === 'box' && !p.chunk)
          const col = wall ? new THREE.Color().fromArray(this.city.kit.batches.box.col, wall.idx * 3) : new THREE.Color('#555')
          fx.collapse(V(B.x, 0, B.z), Math.max(B.w, B.d), B.h, col, V(DIRS[B.out][0], 0, DIRS[B.out][1]))
          break
        }
      }
    }
  }

  /** a kaiju's special, drawn from its beam beat */
  private special(s: Side, acts: Record<Side, Act>, sh: Show, dt: number) {
    const sp = this.specials[s]
    if (!sp) return
    const a = acts[s]
    const e = a.ev && a.ev.action === 'beam' && a.ev.outcome ? a.ev : null
    if (!e || this.calm) {
      sp.update(null, 0, null, dt, sh.c / 1000)
      return
    }
    const c = this.cast!
    const def: Side = s === 'a' ? 'b' : 'a'
    const id = c.id[s]
    const rig = c.rig[s]
    const fromObj = id === 'gorrath' || id === 'pincer' || id === 'bedrock' ? strikerFor(rig, 'beam') : rig.mouth
    const from = fromObj.getWorldPosition(V())
    let to: THREE.Vector3
    if (e.outcome === 'miss' && e.building !== undefined) {
      const B = BUILDINGS[e.building]
      to = V(B.x, Math.min(B.h * 0.5, 8), B.z)
    } else if (e.outcome === 'miss') {
      const d = V(acts[def].x - a.x, 0, acts[def].z - a.z)
      const l = d.length() || 1
      to = V(a.x, 0, a.z).addScaledVector(d, (l + 14) / l)
      to.y = 0.5
    } else to = this.bodyPoint(def, from, c.h[def] * 0.55).clone()
    const aim: Aim = { from, to, base: id === 'kraka' ? V(acts[def].x, 0, acts[def].z) : V(a.x, 0, a.z), outcome: e.outcome!, cam: this.rig.cam.position }
    sp.update(e, a.p, aim, dt, (FIGHT0 + sh.st) / 1000)
    const g = this.city.ground.uniforms
    const k = s === 'a' ? 0 : 1
    if (aim.glow && a.p >= FIRE0 && a.p < FIRE1) {
      ;(g.uBeam.value as THREE.Vector4[])[k].set(aim.glow.a.x, aim.glow.a.z, aim.glow.b.x, aim.glow.b.z)
      ;(g.uBeamCol.value as THREE.Color[])[k].copy(aim.glow.c)
    } else (g.uBeamCol.value as THREE.Color[])[k].setRGB(0, 0, 0)
  }

  /** a puff of dust as a heavy kaiju's foot comes down */
  private steps(s: Side, a: Act) {
    const c = this.cast!
    if (!HEAVY_FEET.has(c.id[s]) || (a.action !== 'walk' && a.action !== 'circle')) return
    const ph = Math.floor(a.t * 2)
    if (ph !== this.stepPhase[s]) {
      this.stepPhase[s] = ph
      this.fx.step(V(a.x, 0, a.z), c.h[s] / 11)
    }
  }

  /** spotlight pools, the kaijus' glow, shadows, cracks on the ground; foam and glow on the water */
  private light(v: StageView, sh: Show, acts: Record<Side, Act>) {
    const c = this.cast!
    const g = this.city.ground.uniforms
    const pools = g.uPool.value as THREE.Vector4[]
    const pcol = g.uPoolCol.value as THREE.Color[]
    const f = v.fight
    const settled = sh.stretch === 'after' && !sh.replay
    ;(['a', 'b'] as const).forEach((s, i) => {
      const a = acts[s]
      const sp = this.spots[i]
      const winner = settled && f && f.result.winner === s
      sp.color.copy(winner ? WIN_COL : SPOT_COL[s])
      sp.intensity = 0.6 + 3.2 * a.spot * a.spot
      sp.position.set(a.x * 0.6, 46, a.z * 0.6 + 14)
      sp.target.position.set(a.x, a.y, a.z)
      sp.target.updateMatrixWorld()
      pools[i].set(a.x, a.z, 8.5, 0.1 + 0.7 * a.spot * a.spot)
      pcol[i].copy(sp.color).multiplyScalar(0.55)
      const glow = GLOW_C[c.id[s]]
      pools[2 + i].set(a.x, a.z, 6 + a.charge * 4, a.y < 0 ? 0 : 0.14 + a.charge * 0.35)
      pcol[2 + i].copy(glow).multiplyScalar(0.5)
      const shrink = 1 / (1 + a.air * 0.12)
      ;(g.uShadow.value as THREE.Vector4[])[i].set(a.x, a.z, c.girth[s] * 1.7 * (0.7 + 0.3 * shrink), a.y < 0 ? 0 : 0.62 * shrink)
    })
    // the ring: gold on a Main Event night, brighter at the walkout
    const ringK = sh.stretch === 'walkout' ? 1.3 + 0.3 * Math.sin(sh.c / 160) : 1
    g.uRingK.value = ringK
    ;(g.uRing.value as THREE.Color).set(v.matchup.main ? '#ffc94a' : '#22d36f')
    // cracks and scorch marks up to the moment on show
    const cr = g.uCrack.value as THREE.Vector4[]
    const cc = g.uCrackCol.value as THREE.Color[]
    for (const q of cr) q.w = -1
    if (f && sh.c >= FIGHT0) {
      const marks = this.marks(f).filter((m) => m.t <= sh.st)
      marks.slice(-CRACKS).forEach((m, i) => {
        cr[i].set(m.x, m.z, m.r, (sh.st - m.t) / 1000)
        cc[i].copy(m.c)
      })
    }
    // the water: foam where a kaiju came down, the loser floundering; the kaijus' glow on the water near the shore
    const w = this.city.water.uniforms
    const foam = w.uFoam.value as THREE.Vector4[]
    for (const q of foam) q.z = -1
    if (f && sh.c >= FIGHT0) {
      let i = 0
      for (const e of f.events) {
        if (i >= FOAMS - 1) break
        if (e.action === 'thrown' && e.to && e.to.z < SHORE_Z && sh.st >= e.t + e.dur) foam[i++].set(e.to.x, e.to.z, (sh.st - e.t - e.dur) / 1000, 1.3)
      }
      for (const s of ['a', 'b'] as const) {
        const a = acts[s]
        if (a.action === 'sink' && i < FOAMS) foam[i++].set(a.x, a.z, ((sh.st / 1000) % 2.2) + 0.5, 0.45)
      }
    }
    const wg = w.uGlow.value as THREE.Vector4[]
    const wc = w.uGlowCol.value as THREE.Color[]
    ;(['a', 'b'] as const).forEach((s, i) => {
      const a = acts[s]
      wg[i].set(a.x, a.z, 10, a.z < SHORE_Z + 8 ? 0.12 + a.charge * 0.3 : 0)
      wc[i].set(GLOW[c.id[s]])
    })
  }

  /** the ground's marks for a fight: Gorrath's slams, the boulder's impact, the beams' scorch, bodies hitting the ground */
  private marks(f: Fight): Mark[] {
    const hit = marksOf.get(f)
    if (hit) return hit
    const out: Mark[] = []
    const c = this.cast!
    const orange = new THREE.Color(1.6, 0.55, 0.12)
    for (const e of f.events) {
      const id = c.id[e.who]
      if (e.action === 'beam' && e.outcome) {
        const me = posAt(f, e.who, e.t + e.dur * 0.5)
        const you = posAt(f, e.who === 'a' ? 'b' : 'a', e.t + e.dur * 0.5)
        const dx = you.x - me.x
        const dz = you.z - me.z
        const l = Math.hypot(dx, dz) || 1
        if (id === 'gorrath') for (const k of [0.5, 0.645, 0.79]) out.push({ t: e.t + e.dur * k, x: me.x + (dx / l) * 3.5, z: me.z + (dz / l) * 3.5, r: 8, c: orange })
        else if (id === 'bedrock') out.push({ t: e.t + e.dur * (e.outcome === 'miss' ? 0.62 : 0.5), x: you.x, z: you.z, r: 5, c: orange })
        else if (id === 'titan') out.push({ t: e.t + e.dur * 0.55, x: you.x - (dx / l) * 2, z: you.z - (dz / l) * 2, r: 4, c: new THREE.Color(1.6, 0.1, 0.15) })
        else if (id === 'rexor') out.push({ t: e.t + e.dur * 0.55, x: you.x - (dx / l) * 2, z: you.z - (dz / l) * 2, r: 4.5, c: new THREE.Color(0.2, 0.9, 1.6) })
        else if (id === 'voltra') out.push({ t: e.t + e.dur * 0.55, x: you.x, z: you.z, r: 5, c: new THREE.Color(0.5, 1.4, 1.8) })
      }
      if (e.action === 'thrown' && e.to && e.to.z >= SHORE_Z) out.push({ t: e.t + e.dur, x: e.to.x, z: e.to.z, r: 5, c: new THREE.Color(0.5, 0.35, 0.2) })
      // the knockout: the loser hitting the ground cracks it
      if (e.action === 'knockdown' && f.result.method === 'ko' && e.t === f.endsAt && e.to) out.push({ t: e.t + e.dur * 0.66, x: e.to.x, z: e.to.z, r: 6.5, c: orange })
    }
    out.sort((x, y) => x.t - y.t)
    marksOf.set(f, out)
    return out
  }

  /** a pair of spark fountains behind a kaiju while it is introduced, in its corner's colours */
  private pyro(sh: Show, acts: Record<Side, Act>, dt: number) {
    const w = sh.c - WALK0
    for (const s of ['a', 'b'] as const) {
      const at = INTRO[s] - 150
      if (w < at || w > at + 1700) continue
      const a = acts[s]
      // behind it as the camera sees it at its introduction: away from the camera side, either side of it
      const back = V(-Math.sin(a.face), 0, -Math.cos(a.face))
      const side = V(back.z, 0, -back.x)
      const hot = PYRO[s]
      const fade = Math.min(1, (at + 1700 - w) / 400)
      for (const k of [-1, 1]) {
        const o = V(a.x, 0.3, a.z).addScaledVector(back, 5).addScaledVector(side, k * 6.5)
        const key = `${s}${k}`
        const due = (this.pyroOwed[key] ?? 0) + 260 * fade * dt
        const n = Math.floor(due)
        this.pyroOwed[key] = due - n
        for (let i = 0; i < n; i++)
          this.fx.sparks.emit(o.x, o.y, o.z, (Math.random() - 0.5) * 4, 24 + Math.random() * 12, (Math.random() - 0.5) * 4, hot[i % 2], 0.35 + Math.random() * 0.35, 0.9 + Math.random() * 0.5, -22, 0.6)
      }
    }
  }

  private fireworks(sh: Show, f: Fight | null) {
    // a burst every second or so at the walkout and after the finish, now and then while the bets are taken
    const c = sh.c
    const plan = f ? replayOf(f) : null
    const after = f && sh.stretch === 'after' && !sh.replay && (!plan || sh.r >= plan.r1)
    const every = sh.stretch === 'walkout' ? 900 : after ? 1300 : sh.stretch === 'bets' ? 4200 : 0
    if (!every) return
    const slot = Math.floor(c / every)
    if (slot === this.lastFire) return
    this.lastFire = slot
    const r = Math.sin(slot * 12.9898) * 43758.5453
    const u = r - Math.floor(r)
    this.fx.firework(V(-60 + u * 120, WATER_Y, -70 - u * 40), FIREWORK[slot % 4])
  }

  private camera(v: StageView, sh: Show, acts: Record<Side, Act>, real: number, snap: boolean) {
    const c = this.cast!
    const fr = { a: { x: acts.a.x, z: acts.a.z }, b: { x: acts.b.x, z: acts.b.z }, ha: c.h.a, hb: c.h.b, aspect: this.w / this.h, ga: c.girth.a, gb: c.girth.b }
    if (this.calm) {
      // reduced motion: one steady wide shot per stretch of the show
      const k = sh.stretch === 'bets' ? 0 : sh.stretch === 'walkout' ? 1 : sh.stretch === 'fight' ? 2 : 3
      const pose = shotPose({ c0: 0, c1: 1, kind: 'crane', az: 0, el: 0.32, k: 1.3, fov: 38 }, 0.5, fr)
      pose.eye = pullIn(pose.eye, pose.target, (i) => this.city.ring.ruins[i].shown < 0)
      this.rig.apply(pose, k, real, 0, 0, snap || this.lastCut === -1, 2)
      return
    }
    const pose = shotPose(sh.shot, sh.u, fr)
    // never inside or behind a building (a taller stage stands farther back than the shot was planned for)
    const ruins = this.city.ring.ruins
    pose.eye = pullIn(pose.eye, pose.target, (i) => ruins[i].shown < 0)
    const shake = v.fight ? shakeAt(v.fight, sh.st) * (sh.replay ? 0.6 : 1) : 0
    this.rig.apply(pose, sh.cut, real, shake, FIGHT0 + sh.st, snap)
    // the effects' points are sized for this view
    const tan = Math.tan(THREE.MathUtils.degToRad(this.rig.cam.fov / 2))
    const px = (this.h * this.dpr) / (2 * tan)
    this.fx.setScale(px)
    this.city.kit.lampMat.uniforms.uScale.value = px
  }

  /** tells the page what happened since the last frame, on the live clock, once each */
  private hear(v: StageView, sh: Show) {
    const c = sh.c
    if (v.id !== this.heard.id || c < this.heard.c || c - this.heard.c > 1500) {
      // a new round, a jump or a long gap (a hidden tab): no backlog, just carry on from here
      this.heard = { id: v.id, c }
      return
    }
    if (!this.onEvent) {
      this.heard.c = c
      return
    }
    for (const q of stageEvents(v)) if (q.c > this.heard.c && q.c <= c) this.onEvent(q.e)
    this.heard.c = c
  }

  private overlays(sh: Show) {
    const o = this.overlay
    if (o.flash) {
      const k = this.calm ? 0 : sh.flash * sh.flash * 0.38
      const s = k > 0.01 ? String(Math.round(k * 100) / 100) : '0'
      if (o.flash.style.opacity !== s) o.flash.style.opacity = s
    }
    const r = sh.replay && !this.calm ? '1' : '0'
    if (o.bars && o.bars.style.opacity !== r) o.bars.style.opacity = r
    if (o.tag && o.tag.style.opacity !== r) o.tag.style.opacity = r
  }

  dispose() {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    const cv = this.renderer.domElement
    cv.removeEventListener('webglcontextlost', this.onLost)
    for (const r of this.pool.values()) r.dispose()
    this.pool.clear()
    for (const s of ['a', 'b'] as const) this.specials[s]?.dispose()
    this.city?.dispose()
    this.fx?.dispose()
    glowTexture().dispose()
    ringTexture().dispose()
    this.bloom.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    cv.remove()
  }
}

/** when each building falls in a fight */
const falls = new WeakMap<Fight, Map<number, number>>()
function fallTimes(f: Fight) {
  let m = falls.get(f)
  if (!m) {
    m = new Map(f.collapses.map((c) => [c.building, c.t]))
    falls.set(f, m)
  }
  return m
}
