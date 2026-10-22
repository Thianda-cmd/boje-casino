import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import type { Action, KaijuId, KaijuRig } from '../types'
import { buildKaiju, strikerFor } from '../models'
import { IMPACT, LOOPS, LOOP_S, NATURAL_S } from '../models/motion'
import type { Quality } from '../models/rig'
import { KaijuPortrait } from '../portraits'

/*
  The model lab (#/dev/model, dev server only): the eight kaiju on a turntable under the stage's kind of light, with
  bloom. Pick a kaiju (or the lineup of all eight), an action, scrub its progress or play it, switch quality, charge
  the glow, flash it, and put a foe in front to check that strikes reach. The markers behind a lone kaiju are the
  9, 11 and 13 unit heights the rigs are meant to stand between. tools/kaiju-models.mjs drives it through
  window.__modelLab to take its screenshots.
*/

const IDS: KaijuId[] = ['rexor', 'gorrath', 'titan', 'kraka', 'lumina', 'pincer', 'bedrock', 'voltra']
const ACTIONS: Action[] = ['idle', 'walk', 'circle', 'roar', 'taunt', 'jab', 'heavy', 'tail', 'charge', 'grab', 'throw', 'beam', 'stomp', 'block', 'dodge', 'hit', 'stagger', 'knockdown', 'down', 'getup', 'thrown', 'sink', 'victory']

interface Opts {
  id: KaijuId | 'all'
  action: Action
  t: number
  play: boolean
  speed: number
  quality: Quality
  spin: boolean
  angle: number
  charge: number
  foe: boolean
  /** a fixed scene clock (seconds) for repeatable shots; null runs the real one */
  time: number | null
  /** snap to the pose (no blending) */
  snap: boolean
}

const DEFAULTS: Opts = { id: 'rexor', action: 'idle', t: 0, play: true, speed: 1, quality: 'high', spin: true, angle: 25, charge: 0, foe: false, time: null, snap: false }

class LabScene {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600)
  private readonly composer: EffectComposer
  private readonly bloom: UnrealBloomPass
  private rigs: KaijuRig[] = []
  private foe: KaijuRig | null = null
  private key = ''
  private readonly turn = new THREE.Group()
  private readonly marks: THREE.Group
  private raf = 0
  private last = performance.now()
  private clock = 0
  private flashK = 0
  frames = 0
  stats = { calls: 0, tris: 0, vertices: 0, height: 0, reach: 0 }
  o: Opts = { ...DEFAULTS }
  onTick: ((t: number) => void) | null = null

  constructor(private readonly el: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.05
    this.renderer.setClearColor('#0a1620')
    this.renderer.info.autoReset = false
    el.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })
    this.composer = new EffectComposer(this.renderer, rt)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.75, 0.55, 1.0)
    this.composer.addPass(this.bloom)
    this.composer.addPass(new OutputPass())

    // the stage's kind of night: a cool moon from behind, a warm key from the front, a neon fill
    const key = new THREE.DirectionalLight('#ffeedd', 2.6)
    key.position.set(18, 26, 26)
    const rim = new THREE.DirectionalLight('#7fb8ff', 1.5)
    rim.position.set(-20, 18, -26)
    const fill = new THREE.DirectionalLight('#ff5fa2', 0.4)
    fill.position.set(-26, 6, 14)
    this.scene.add(key, rim, fill, new THREE.AmbientLight('#b8c8ff', 0.5))
    this.scene.fog = new THREE.Fog('#0a1620', 140, 420)

    const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64).rotateX(-Math.PI / 2), new THREE.MeshToonMaterial({ color: '#13283a' }))
    ground.position.y = -0.02
    const ring = new THREE.Mesh(new THREE.RingGeometry(9.6, 10, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#22d36f', transparent: true, opacity: 0.5 }))
    ring.position.y = 0.01
    this.scene.add(ground, ring, this.turn)

    // a height ruler beside a lone kaiju, level with it: ticks at 9, 11 and 13 units
    this.marks = new THREE.Group()
    const pole = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-8, 0, 0), new THREE.Vector3(-8, 13, 0)])
    this.marks.add(new THREE.Line(pole, new THREE.LineBasicMaterial({ color: '#5d7488' })))
    for (const [h, c] of [[9, '#4cb4ff'], [11, '#22d36f'], [13, '#ff5fa2']] as const) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-9.2, h, 0), new THREE.Vector3(-6.8, h, 0)])
      this.marks.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: c })))
    }
    this.scene.add(this.marks)
    this.resize()
    this.loop()
  }

  resize() {
    const w = this.el.clientWidth || 1
    const h = this.el.clientHeight || 1
    this.renderer.setSize(w, h, false)
    this.composer.setSize(w, h)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }

  private rebuild() {
    const key = `${this.o.id}:${this.o.quality}:${this.o.foe}`
    if (key === this.key) return
    this.key = key
    for (const r of this.rigs) {
      this.turn.remove(r.group)
      r.dispose()
    }
    if (this.foe) {
      this.turn.remove(this.foe.group)
      this.foe.dispose()
      this.foe = null
    }
    const ids = this.o.id === 'all' ? IDS : [this.o.id]
    this.rigs = ids.map((id) => buildKaiju(id, this.o.quality))
    // a lone kaiju in the middle, the lineup side by side
    this.rigs.forEach((r, i) => {
      r.group.position.set((i - (this.rigs.length - 1) / 2) * 15, 0, 0)
      this.turn.add(r.group)
    })
    if (this.o.foe && this.o.id !== 'all') {
      const other = IDS[(IDS.indexOf(this.o.id) + 1) % IDS.length]
      this.foe = buildKaiju(other, this.o.quality)
      this.turn.add(this.foe.group)
    }
    this.marks.visible = ids.length === 1
    const r = this.rigs[0]
    this.stats.height = r.height
    this.stats.reach = r.reach
    this.stats.vertices = (r as unknown as { vertices: number }).vertices ?? 0
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop)
    if (document.hidden) return
    const now = performance.now()
    const dt = Math.min(0.05, (now - this.last) / 1000)
    this.last = now
    this.clock += dt
    this.rebuild()
    const o = this.o
    const loop = LOOPS.has(o.action)
    const len = (loop ? LOOP_S[o.action] : NATURAL_S[o.action]) ?? 1
    if (o.play) {
      o.t += (dt * o.speed) / len
      if (!loop && o.t > 1.35) o.t = 0
      this.onTick?.(o.t)
    }
    const time = o.time ?? this.clock
    const tt = loop ? o.t : Math.min(1, o.t)
    for (const r of this.rigs) {
      r.pose(o.action, tt, time, o.snap ? 0 : 0.2)
      r.charge(o.charge)
      r.flash(this.flashK)
    }
    // the foe stands at the striker's reach and flinches when the blow lands
    if (this.foe) {
      const r = this.rigs[0]
      const imp = IMPACT[o.action]
      const gap = r.reach + this.foe.reach * 0.55
      this.foe.group.position.set(0, 0, gap)
      this.foe.group.rotation.y = Math.PI
      const hitAt = imp ?? 2
      const k = tt - hitAt
      if (k >= 0 && k < 0.5) this.foe.pose('hit', k * 1.6, time, 0.08)
      else this.foe.pose('idle', time / 3.4, time, 0.25)
      this.foe.flash(k >= 0 && k < 0.08 ? 1 - k / 0.08 : 0)
    }
    this.flashK = Math.max(0, this.flashK - dt * 4)
    const lineup = this.rigs.length > 1
    if (o.spin && !lineup) o.angle = (o.angle + dt * 18) % 360
    this.turn.rotation.y = lineup ? 0 : (o.angle * Math.PI) / 180
    if (lineup) {
      // far enough back for all eight across the width
      // far enough back for all eight across the width (a wide window shows them biggest)
      const half = Math.tan((16 * Math.PI) / 180)
      const d = Math.max(62 / (half * this.camera.aspect), 8 / half)
      this.camera.position.set(0, 9, d)
      this.camera.lookAt(0, 6.2, 0)
      this.camera.fov = 32
    } else {
      const d = this.foe ? 62 : 40
      this.camera.position.set(0, 9, d)
      this.camera.lookAt(0, 5.8, this.foe ? this.foe.group.position.z / 2 : 0)
      this.camera.fov = 32
    }
    this.camera.updateProjectionMatrix()
    this.renderer.info.reset()
    this.composer.render()
    this.stats.calls = this.renderer.info.render.calls
    this.stats.tris = this.renderer.info.render.triangles
    this.frames++
  }

  flash() {
    this.flashK = 1
  }

  /** where an attack's striker is, in the turntable's frame (to check the hit tables) */
  striker() {
    const r = this.rigs[0]
    const p = strikerFor(r, this.o.action).getWorldPosition(new THREE.Vector3())
    return this.turn.worldToLocal(p).toArray().map((v) => Math.round(v * 100) / 100)
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    for (const r of this.rigs) r.dispose()
    this.foe?.dispose()
    this.composer.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

declare global {
  interface Window {
    __modelLab?: { set: (o: Partial<Opts>) => void; frames: () => number; stats: () => LabScene['stats']; striker: () => number[] }
  }
}

export default function ModelLab() {
  const box = useRef<HTMLDivElement>(null)
  const lab = useRef<LabScene | null>(null)
  const [o, setO] = useState<Opts>(DEFAULTS)
  const [t, setT] = useState(0)
  const [stats, setStats] = useState({ calls: 0, tris: 0, vertices: 0, height: 0, reach: 0 })

  useEffect(() => {
    const s = new LabScene(box.current!)
    lab.current = s
    let n = 0
    s.onTick = (v) => {
      if (++n % 6 === 0) {
        setT(v)
        setStats({ ...s.stats })
      }
    }
    const ro = new ResizeObserver(() => s.resize())
    ro.observe(box.current!)
    window.__modelLab = {
      set: (p) => {
        Object.assign(s.o, p)
        setO({ ...s.o })
      },
      frames: () => s.frames,
      stats: () => s.stats,
      striker: () => s.striker(),
    }
    return () => {
      ro.disconnect()
      s.dispose()
      delete window.__modelLab
    }
  }, [])

  const up = (p: Partial<Opts>) => {
    const s = lab.current
    if (!s) return
    Object.assign(s.o, p)
    setO({ ...s.o })
    if (p.t !== undefined) setT(p.t)
  }

  const lone = o.id !== 'all'
  return (
    <div className="flex h-[calc(100vh-64px)] min-h-[560px] flex-col gap-3 p-3 lg:flex-row">
      <div className="flex w-full shrink-0 flex-col gap-3 overflow-y-auto rounded-2xl bg-panel p-4 text-[13px] lg:w-80">
        <h1 className="text-[20px] font-black text-ink">Kaiju models</h1>
        <div className="grid grid-cols-3 gap-1.5">
          {(['all', ...IDS] as const).map((id) => (
            <button key={id} onClick={() => up({ id })} className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] font-bold capitalize ${o.id === id ? 'bg-raised text-ink ring-1 ring-accent' : 'bg-panel2 text-muted hover:bg-hover'}`}>
              {id === 'all' ? <span className="grid h-10 w-10 place-items-center text-[18px]">8</span> : <KaijuPortrait id={id} size={40} />}
              {id === 'all' ? 'lineup' : id}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1">
          {ACTIONS.map((a) => (
            <button key={a} onClick={() => up({ action: a, t: 0 })} className={`rounded-lg px-2 py-1 text-[11px] font-bold ${o.action === a ? 'bg-accent text-bg' : 'bg-panel2 text-muted hover:bg-hover'}`}>
              {a}
            </button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-muted">
          <span>
            t <b className="text-ink">{t.toFixed(2)}</b>
            {IMPACT[o.action] !== undefined && <span className="ml-2 text-dim">lands at {IMPACT[o.action]}</span>}
          </span>
          <input type="range" min={0} max={LOOPS.has(o.action) ? 2 : 1} step={0.005} value={Math.min(t, LOOPS.has(o.action) ? 2 : 1)} onChange={(e) => up({ t: Number(e.target.value), play: false })} />
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => up({ play: !o.play })} className="rounded-lg bg-raised px-3 py-1.5 font-bold text-ink hover:bg-hover">{o.play ? 'Pause' : 'Play'}</button>
          {[0.25, 0.5, 1, 2].map((v) => (
            <button key={v} onClick={() => up({ speed: v })} className={`rounded-lg px-2 py-1.5 font-bold ${o.speed === v ? 'bg-raised text-ink' : 'bg-panel2 text-muted'}`}>{v}×</button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => up({ quality: o.quality === 'high' ? 'low' : 'high' })} className="rounded-lg bg-panel2 px-3 py-1.5 font-bold text-muted hover:bg-hover">Quality: <b className="text-ink">{o.quality}</b></button>
          <button onClick={() => up({ spin: !o.spin })} className="rounded-lg bg-panel2 px-3 py-1.5 font-bold text-muted hover:bg-hover">Turntable: <b className="text-ink">{o.spin ? 'on' : 'off'}</b></button>
          <button onClick={() => up({ foe: !o.foe })} disabled={!lone} className="rounded-lg bg-panel2 px-3 py-1.5 font-bold text-muted hover:bg-hover disabled:opacity-40">Foe: <b className="text-ink">{o.foe ? 'on' : 'off'}</b></button>
          <button onClick={() => lab.current?.flash()} className="rounded-lg bg-panel2 px-3 py-1.5 font-bold text-muted hover:bg-hover">Flash</button>
        </div>
        <label className="flex flex-col gap-1 text-muted">
          <span>angle {Math.round(o.angle)}°</span>
          <input type="range" min={0} max={360} value={o.angle} onChange={(e) => up({ angle: Number(e.target.value), spin: false })} />
        </label>
        <label className="flex flex-col gap-1 text-muted">
          <span>charge {o.charge.toFixed(2)}</span>
          <input type="range" min={0} max={1} step={0.01} value={o.charge} onChange={(e) => up({ charge: Number(e.target.value) })} />
        </label>
        <div className="rounded-xl bg-panel2 p-3 text-[12px] text-muted">
          <div>height <b className="text-ink">{stats.height}</b> · reach <b className="text-ink">{stats.reach}</b></div>
          <div>draw calls <b className="text-ink">{stats.calls}</b> · triangles <b className="text-ink">{stats.tris.toLocaleString()}</b></div>
          <div>vertices (one kaiju) <b className="text-ink">{stats.vertices.toLocaleString()}</b></div>
          {lone && <div className="mt-1 text-dim">marks: 9 (blue), 11 (green), 13 (pink)</div>}
        </div>
      </div>
      <div ref={box} className="relative min-h-[320px] flex-1 overflow-hidden rounded-2xl bg-stage" />
    </div>
  )
}
