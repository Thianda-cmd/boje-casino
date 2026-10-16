/*
  Duck Derby race scene: one canvas, drawn every frame from the race plan.

  The river is seen from the side and a little above. Lane 1 is the far lane and lane 6 the near one; things lying on
  the water (the water itself, lane ropes, the finish line, the whirlpool, the falls) get an oblique shear, so a line
  across the river leans like it would in perspective, while upright things (ducks, posts, the crowd) stay upright.
  World x is progress along the course in pixels at zoom 1; world y is depth into the river, 0 at the far bank. After
  the waterfall everything sits D lower. The camera follows the leader, pulls back when the field spreads out, drops
  with the river at the falls and closes in on the line for the photo finish.

  Everything that only depends on the stage size (sky, hills, the tree line, the banks, buoys, critters) is drawn
  once into offscreen canvases when the stage is sized; a frame is mostly drawImage calls, a few fills for the water
  and the ducks' own shapes (art.tsx). Positions are a pure function of the race clock, so slow motion, turbo and
  "tap to hurry" only change how fast the clock runs.
*/
import { sfx } from '../../lib/sound'
import { DUCK_LEN, INK, NOSE_X, drawDuck, duckSprite, type DuckPose, type DuckSprite, type Expr } from './art'
import { COURSE, COURSE_DL, T_END, progAt, ranking, speedAt, type Caption, type Plan } from './race'
import { DUCKS, LANES } from './rules'

export const SHEAR = 0.075
/** seconds of race per unit of the race clock */
export const PACE = { normal: 16, turbo: 6 }
const HURRY = 2.6

export interface Layout {
  W: number
  H: number
  phone: boolean
  /** lane height and duck length at zoom 1 */
  L: number
  DL: number
  /** the screen y the camera centres the river on */
  ay: number
  /** the world y the camera centres on (the middle of the lanes) */
  midY: number
  /** screen x of the start rope at the far edge of the river */
  gateX: number
}

export function stageLayout(W: number, H: number): Layout {
  const phone = W < 560
  const L = Math.round(Math.max(32, Math.min(74, H * (phone ? 0.094 : 0.087))))
  const DL = L * 1.3
  return { W, H, phone, L, DL, ay: H * (phone ? 0.585 : 0.575), midY: 3.15 * L, gateX: (phone ? 12 : 26) + DL * 0.95 }
}

/** the waterline of a lane, in world y */
export const laneY = (lay: Layout, lane: number) => (lane + 0.64) * lay.L
/** how much smaller the far lanes draw */
export const depth = (lane: number) => 0.86 + 0.028 * lane

/** screen position of a lane's row at the start, for the race card laid over the water */
export function laneRow(lay: Layout, lane: number) {
  const top = lay.ay + (lane * lay.L - lay.midY)
  return { top, h: lay.L, left: lay.gateX + (lane + 0.5) * lay.L * SHEAR }
}

export interface SceneEvents {
  /** the order changed */
  rank: (order: number[]) => void
  caption: (c: Caption) => void
  /** a duck crossed the line in `place` (0 = winner) */
  cross: (lane: number, place: number) => void
  /** the winner crossed: a copy of the finish-line camera's frame */
  photo: (shot: HTMLCanvasElement, finishX: number) => void
  /** the whole field is home */
  end: () => void
  /** every frame while racing: progress of each lane */
  progress: (p: number[]) => void
  tapDuck: (lane: number) => void
}

type Phase = 'idle' | 'ready' | 'race' | 'done'

interface Particle {
  kind: 'drop' | 'ring' | 'foam' | 'star' | 'confetti' | 'spark'
  x: number
  y: number
  vx: number
  vy: number
  /** world y of the water under it: drops die when they reach it */
  floor: number
  life: number
  max: number
  size: number
  color: string
  rot: number
  vr: number
  lane: number
}

interface DuckView {
  x: number
  y: number
  rot: number
  sx: number
  sy: number
  flip: number
  pose: DuckPose
  /** shown on the water: wake strength */
  speed: number
  /** under the surface after the drop, 0..1 */
  dunk: number
  stars: number
}

const TAU = Math.PI * 2
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => {
  x = clamp01(x)
  return x * x * (3 - 2 * x)
}
const bump = (x: number) => (x <= 0 || x >= 1 ? 0 : Math.sin(Math.PI * x))
/** a hash of an integer to [0, 1) */
const hash = (n: number) => {
  let h = (n | 0) * 374761393 + 668265263
  h = (h ^ (h >>> 13)) * 1274126177
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const DEG = Math.PI / 180

const WATER_TOP = '#86e3f2'
const WATER_DEEP = '#239ccf'
const PENNANT = DUCKS.map((d) => d.color)

export class DerbyScene {
  private host: HTMLDivElement
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  /** the backdrop, in DOM layers behind the canvas: moved by the compositor, never repainted */
  private back: { sky: HTMLDivElement; rays: HTMLCanvasElement; sun: HTMLCanvasElement; clouds: HTMLCanvasElement[]; hills: HTMLCanvasElement; trees: HTMLCanvasElement }
  private tiles = { hills: 1, hillsH: 1, trees: 1 }
  private cloudW = 100
  private ev: SceneEvents
  private dpr = 1
  lay: Layout = stageLayout(800, 600)
  private raf = 0
  private last = 0
  private time = 0
  private phase: Phase = 'idle'
  private plan: Plan | null = null
  private tau = 0
  private turbo = false
  private hurried = false
  private sm = 1
  private crossed: boolean[] = []
  private crossCount = 0
  private ended = false
  private secondAt = 0
  private rank: number[] = [0, 1, 2, 3, 4, 5]
  private rankCand: number[] = []
  private rankSince = 0
  private capIdx = 0
  private ropeDrop = -1
  private stopRiver: (() => void) | null = null
  private crowdLevel = 0
  private frozen = false
  /** development only: per-stage drawing times (see draw) */
  prof: Record<string, number> | null = null

  // camera
  private cx = 0
  private cy = 0
  private z = 1
  private shake = 0

  private ducks: DuckView[] = []
  private blinkAt: number[] = []
  private quackAt: number[] = []
  private beakUntil: number[] = []
  private lastQuack = 0
  private parts: Particle[] = []

  // sprites, rebuilt with the stage size
  private spr: Record<string, HTMLCanvasElement> = {}
  private pat: { water?: CanvasPattern } = {}

  constructor(host: HTMLDivElement, ev: SceneEvents) {
    this.host = host
    this.ev = ev
    const add = <K extends 'div' | 'canvas'>(tag: K, css: string) => {
      const e = document.createElement(tag)
      e.style.cssText = css
      host.appendChild(e)
      return e as K extends 'div' ? HTMLDivElement : HTMLCanvasElement
    }
    const layer = 'position:absolute;left:0;top:0;pointer-events:none;transform-origin:0 0;will-change:transform;'
    const rays = add('canvas', layer)
    rays.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 120000, iterations: Infinity })
    rays.style.transformOrigin = '50% 50%'
    this.back = {
      sky: add('div', 'position:absolute;inset:0;pointer-events:none;background:linear-gradient(#5cc7ff,#c9f1ff 50%,#c9f1ff)'),
      rays,
      sun: add('canvas', layer),
      clouds: [0, 1, 2, 3].map(() => add('canvas', layer + 'opacity:.95')),
      hills: add('canvas', layer),
      trees: add('canvas', layer),
    }
    host.insertBefore(this.back.sky, host.firstChild)
    const canvas = add('canvas', 'position:absolute;left:0;top:0;display:block;touch-action:manipulation')
    add('div', 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 80% 75% at 50% 55%,rgba(0,20,40,0) 60%,rgba(0,20,40,.26) 100%)')
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    for (let i = 0; i < LANES; i++) {
      this.blinkAt.push(1 + Math.random() * 3)
      this.quackAt.push(2 + Math.random() * 5)
      this.beakUntil.push(0)
      this.crossed.push(false)
    }
    this.ducks = DUCKS.map(() => ({ x: 0, y: 0, rot: 0, sx: 1, sy: 1, flip: 1, pose: { expr: 'happy', beak: 0, wing: 0, head: 0, spin: 0, flutter: 0 }, speed: 0, dunk: 0, stars: 0 }))
    canvas.addEventListener('pointerdown', this.onPointer)
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
  }

  /* ---------------- sizing ---------------- */

  resize(w: number, h: number) {
    if (w < 10 || h < 10) return
    this.dpr = Math.min(2, window.devicePixelRatio || 1)
    this.canvas.width = Math.round(w * this.dpr)
    this.canvas.height = Math.round(h * this.dpr)
    this.canvas.style.width = `${w}px`
    this.canvas.style.height = `${h}px`
    this.lay = stageLayout(w, h)
    this.sprites.clear()
    this.buildSprites()
    this.buildBackdrop()
    if (this.phase === 'idle' || this.phase === 'ready') this.homeCamera()
  }

  private X(p: number) {
    return p * COURSE_DL * this.lay.DL
  }

  private homeCamera() {
    this.z = 1
    this.cx = this.lay.W / 2 - this.lay.gateX
    this.cy = this.lay.midY
  }

  /* ---------------- control ---------------- */

  /** back to the start gate for the next race */
  reset() {
    this.phase = 'idle'
    this.plan = null
    this.tau = 0
    this.hurried = false
    this.sm = 1
    this.crossed = this.crossed.map(() => false)
    this.crossCount = 0
    this.ended = false
    this.ropeDrop = -1
    this.capIdx = 0
    this.parts = []
    this.rank = [0, 1, 2, 3, 4, 5]
    this.crowdLevel = 0
    this.stopRiver?.()
    this.stopRiver = null
    this.homeCamera()
  }

  /** the countdown: ducks lean in at the rope */
  ready() {
    this.phase = 'ready'
  }

  race(plan: Plan, turbo: boolean) {
    this.plan = plan
    this.turbo = turbo
    this.tau = 0
    this.sm = 1
    this.phase = 'race'
    this.ropeDrop = this.time
    this.rank = ranking(plan, 0)
    this.rankCand = this.rank
    this.stopRiver?.()
    this.stopRiver = sfx.derby.river()
    for (let i = 0; i < LANES; i++) this.quackAt[i] = this.time + 0.4 + Math.random() * 2.5
    this.splashLine()
  }

  setTurbo(t: boolean) {
    this.turbo = t
  }

  hurry() {
    if (this.phase !== 'race' || this.hurried) return false
    this.hurried = true
    return true
  }

  /** development only: hold the race clock at t (for screenshots of a given moment); a negative t lets it run */
  seek(t: number) {
    if (!this.plan) return
    if (t < 0) {
      this.frozen = false
      return
    }
    this.frozen = true
    this.tau = t
    this.rank = ranking(this.plan, t)
  }
  get debug() {
    return { plan: this.plan, tau: this.tau }
  }

  get racing() {
    return this.phase === 'race'
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.canvas.removeEventListener('pointerdown', this.onPointer)
    this.stopRiver?.()
    this.stopRiver = null
    this.host.replaceChildren()
  }

  private onPointer = (e: PointerEvent) => {
    if (this.phase !== 'idle') return
    const r = this.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const { L, DL } = this.lay
    for (let lane = LANES - 1; lane >= 0; lane--) {
      const d = this.ducks[lane]
      const sx = this.sx(d.x, laneY(this.lay, lane))
      const sy = this.sy(d.y)
      if (x > sx - DL * 1.05 && x < sx + DL * 0.1 && y > sy - L * 1.25 && y < sy + L * 0.25) {
        this.ev.tapDuck(lane)
        return
      }
    }
  }

  /* ---------------- coordinates ---------------- */

  private sx(wx: number, wy: number) {
    return (wx + wy * SHEAR - this.cx) * this.z + this.lay.W / 2
  }
  private sy(wy: number) {
    return (wy - this.cy) * this.z + this.lay.ay
  }
  /** the sheared world transform, for things lying on the water */
  private world() {
    const { dpr, z } = this
    this.ctx.setTransform(dpr * z, 0, dpr * z * SHEAR, dpr * z, dpr * (this.lay.W / 2 - this.cx * z), dpr * (this.lay.ay - this.cy * z))
  }
  /** an upright transform at a world point, scaled by zoom × k */
  private upright(wx: number, wy: number, k = 1) {
    const s = this.dpr * this.z * k
    this.ctx.setTransform(s, 0, 0, s, this.dpr * this.sx(wx, wy), this.dpr * this.sy(wy))
  }
  /** world x range on screen at depth wy, with a margin */
  private span(wy: number, m = 0) {
    const half = this.lay.W / 2 / this.z
    return [this.cx - half - wy * SHEAR - m, this.cx + half - wy * SHEAR + m] as const
  }

  private get D() {
    return this.lay.L * 1.3
  }
  private get WB() {
    return this.lay.L * 6.3
  }
  private get XF() {
    return this.X(COURSE.falls)
  }
  private get FW() {
    return this.lay.DL * 0.85
  }
  /** the ground's drop under world x: 0 above the falls, D below */
  private ground(x: number) {
    return x < this.XF ? 0 : this.D
  }

  /* ---------------- the loop ---------------- */

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.time += dt
    if (this.phase === 'race' || this.phase === 'done') this.advance(dt)
    this.updateDucks(dt)
    this.updateCamera(dt)
    this.updateParticles(dt)
    this.draw()
  }

  private advance(dt: number) {
    const plan = this.plan!
    if (this.frozen) return
    const base = 1 / (this.turbo ? PACE.turbo : PACE.normal)
    const lead = Math.max(...plan.prog.map((_, l) => progAt(plan, l, this.tau)))
    const secondHome = this.tau >= plan.finish[plan.order[1]]
    const fast = this.turbo || this.hurried
    const target = lead >= 0.962 && !secondHome ? (fast ? 0.45 : 0.24) : 1
    this.sm += (target - this.sm) * (1 - Math.exp(-dt * (target < this.sm ? 9 : 4)))
    const prev = this.tau
    const k = this.phase === 'done' ? 0.8 : (this.hurried ? HURRY : 1) * this.sm
    this.tau = Math.min(T_END, this.tau + dt * base * k)
    this.events(prev, this.tau)
  }

  private events(t0: number, t1: number) {
    const plan = this.plan!
    const { DL } = this.lay
    // commentary
    while (this.capIdx < plan.captions.length && plan.captions[this.capIdx].t <= t1) this.ev.caption(plan.captions[this.capIdx++])
    // the order, held for a moment so a nose-to-nose wobble doesn't flicker the strip
    const r = ranking(plan, t1)
    if (r.join() !== this.rankCand.join()) {
      this.rankCand = r
      this.rankSince = this.time
    }
    if (this.rankCand.join() !== this.rank.join() && (this.time - this.rankSince > 0.14 || t1 >= 1)) {
      this.rank = this.rankCand
      this.ev.rank(this.rank)
    }
    this.ev.progress(plan.prog.map((_, l) => progAt(plan, l, t1)))

    const lead = this.rank[0]
    const pl = progAt(plan, lead, t1)
    // the log
    if (t0 < plan.log.t + 0.008 && t1 >= plan.log.t + 0.008) {
      sfx.derby.bonk()
      this.shake = Math.max(this.shake, 0.35)
      this.ducks[plan.log.lane].stars = 1
      this.quack(plan.log.lane, true)
      this.burst(this.ducks[plan.log.lane].x + DL * 0.1, laneY(this.lay, plan.log.lane) + this.ground(this.ducks[plan.log.lane].x), 8, 'drop')
    }
    if (t0 < plan.whirl.t0 && t1 >= plan.whirl.t0) {
      sfx.derby.whirl()
      this.quack(plan.whirl.lane, true)
    }
    if (t0 < plan.wave.t0 && t1 >= plan.wave.t0) {
      sfx.derby.wave()
      this.quack(plan.wave.lane, true)
    }
    // the rapids, when the leader reaches them
    const tr = COURSE.rapids[0]
    if (progAt(plan, lead, t0) < tr && pl >= tr) sfx.derby.rapids()
    // the falls: each duck lands with a splash
    for (let lane = 0; lane < LANES; lane++) {
      const land = COURSE.falls + (DL * 1.45) / this.X(1)
      const a = progAt(plan, lane, t0)
      const b = progAt(plan, lane, t1)
      if (a < COURSE.falls && b >= COURSE.falls && lane === lead) sfx.derby.falls()
      if (a < land && b >= land) {
        const x = this.X(b) - DL * 0.5
        const y = laneY(this.lay, lane) + this.D
        this.burst(x, y, 16, 'drop')
        this.ring(x, y)
        sfx.derby.splash(0.6 + Math.random() * 0.4)
        if (lane === lead) this.shake = Math.max(this.shake, 0.5)
      }
    }
    // the crowd warms up down the stretch
    if (pl > 0.84 && this.crowdLevel < 1) {
      this.crowdLevel = 1
      sfx.derby.crowd(0.55, 3.2)
    }
    // the line
    for (let lane = 0; lane < LANES; lane++) {
      if (this.crossed[lane] || t1 < plan.finish[lane]) continue
      this.crossed[lane] = true
      const place = plan.order.indexOf(lane)
      this.crossCount++
      this.ev.cross(lane, place)
      if (place === 0) {
        this.photo()
        sfx.derby.shutter()
        sfx.derby.crowd(1, 3.6)
        this.confetti(70)
      }
      if (place === 1) this.secondAt = this.time
      if (place <= 2) this.quack(lane, true)
    }
    if (!this.ended && this.crossCount === LANES && this.time - this.secondAt > (this.turbo || this.hurried ? 1.4 : 2)) {
      this.ended = true
      this.phase = 'done'
      this.stopRiver?.()
      this.stopRiver = null
      this.ev.end()
    }
  }

  /** a quack: the beak always opens; it is only heard during a race (or when `force`d), never while bets go on */
  private quack(lane: number, force = false) {
    if (!force && this.time - this.lastQuack < 1.3) return
    this.lastQuack = this.time
    this.beakUntil[lane] = this.time + 0.18
    this.quackAt[lane] = this.time + (this.phase === 'race' ? 4 + Math.random() * 6 : 6 + Math.random() * 10)
    if (force || this.phase === 'race') sfx.derby.quack(lane)
  }

  /** a duck tapped on the start line answers */
  poke(lane: number) {
    this.quack(lane, true)
  }

  /** the winner's nose is on the line: copy the finish-line camera's view of the first two (the canvas still holds the
   *  frame just drawn, a moment before the line) */
  private photo() {
    const { L, W, H } = this.lay
    const plan = this.plan!
    const z = this.z
    const ys = [plan.order[0], plan.order[1]].map((l) => laneY(this.lay, l) + this.D)
    const mid = (Math.min(...ys) + Math.max(...ys)) / 2
    const fx = this.sx(this.X(1), mid)
    let y0 = this.sy(Math.min(...ys) - L * 1.45)
    let y1 = this.sy(Math.max(...ys) + L * 0.5)
    const minH = L * 2.6 * z
    if (y1 - y0 < minH) {
      const c = (y0 + y1) / 2
      y0 = c - minH / 2
      y1 = c + minH / 2
    }
    y0 = Math.max(0, y0)
    y1 = Math.min(H, y1)
    const h = y1 - y0
    // the line and a duck length or two either side; a tall shot (the two far apart) stays close to square
    const w = Math.min(W, Math.max(L * 3.4 * z, Math.min(h * 1.3, L * 4.6 * z)))
    let x0 = fx - w * 0.6
    x0 = Math.max(0, Math.min(W - w, x0))
    const c = document.createElement('canvas')
    const k = Math.min(2, 440 / w)
    c.width = Math.max(2, Math.round(w * k))
    c.height = Math.max(2, Math.round(h * k))
    const g = c.getContext('2d')!
    g.fillStyle = '#9fdcf5'
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(this.canvas, x0 * this.dpr, y0 * this.dpr, w * this.dpr, h * this.dpr, 0, 0, c.width, c.height)
    this.ev.photo(c, (fx - x0) / w)
  }

  /* ---------------- ducks ---------------- */

  private updateDucks(dt: number) {
    const { L, DL } = this.lay
    const plan = this.plan
    const t = this.tau
    const racing = plan && (this.phase === 'race' || this.phase === 'done')
    for (let lane = 0; lane < LANES; lane++) {
      const d = this.ducks[lane]
      let p = -0.0022
      let v = 0
      if (racing) {
        p = progAt(plan, lane, t)
        v = speedAt(plan, lane, t)
      }
      let x = this.X(p)
      let y = laneY(this.lay, lane)
      let rot = 0
      let sx = 1
      let sy = 1
      let flip = 1
      let dunk = 0
      let expr: Expr = 'happy'
      let wing = 0
      let head = 0
      const ph = this.time * (2.3 + lane * 0.17) + lane * 1.9
      const bob = Math.sin(ph)
      y += bob * 0.045 * L
      sy = 1 + 0.035 * bob
      sx = 1 - 0.03 * bob
      head = Math.sin(ph + 0.8) * 3
      const sp = Math.min(1.6, v)
      if (racing) {
        rot += Math.sin(this.time * 10 + lane * 2.1) * 2.2 * Math.min(1, sp)
        wing = 0
      } else if (this.phase === 'ready') {
        // leaning in, wings twitching
        rot = 6 + Math.sin(this.time * 20 + lane) * 1.5
        expr = 'grit'
        wing = 8 + Math.sin(this.time * 24 + lane) * 6
      }

      // the rapids: everything bounces
      const px = p
      if (px > COURSE.rapids[0] && px < COURSE.rapids[1]) {
        const e = smooth((px - COURSE.rapids[0]) / 0.015) * smooth((COURSE.rapids[1] - px) / 0.015)
        y += Math.sin(this.time * 12 + lane * 1.3) * 0.11 * L * e
        rot += Math.sin(this.time * 8.5 + lane * 2.7) * 9 * e
        if (Math.random() < dt * 5 * e) this.burst(x - DL * 0.2, laneY(this.lay, lane), 3, 'drop')
      }

      if (racing) {
        // the log: a bonk and a scramble over it
        if (lane === plan.log.lane || lane === plan.log.hop) {
          const lx = this.X(plan.log.x)
          const start = lane === plan.log.lane ? lx - DL * 0.36 : lx - DL * 0.55
          const u = (x - start) / (DL * 1.15)
          if (u > 0 && u < 1) {
            y -= bump(u) * L * 0.62
            rot -= Math.cos(Math.PI * u) * 22
            expr = 'wow'
          }
          if (lane === plan.log.lane) {
            const b = (t - plan.log.t) / 0.024
            if (b > 0 && b < 1) {
              x -= bump(b) * DL * 0.2
              rot += bump(b) * 12
              sx *= 1 - 0.12 * bump(b * 2)
              sy *= 1 + 0.1 * bump(b * 2)
              expr = 'wow'
            }
            if (t > plan.log.t + 0.016 && t < plan.log.t + 0.07) expr = 'dizzy'
          }
        }
        // the whirlpool: round and round, dizzy
        if (lane === plan.whirl.lane) {
          const { t0, t1 } = plan.whirl
          const w = smooth((t - t0) / 0.012) * smooth((t1 - t) / 0.012)
          if (w > 0) {
            const u = clamp01((t - t0) / (t1 - t0))
            const a = smooth(u) * TAU * 2.6
            const R = DL * 0.34 * w
            const cxw = this.X(plan.whirl.x) - DL * 0.1
            x = x + (cxw + Math.cos(a + Math.PI) * R + DL * 0.45 - x) * w
            y += Math.sin(a + Math.PI) * R * 0.32
            const f = Math.max(-1, Math.min(1, Math.sin(a + Math.PI) * -2.2))
            flip = (Math.sign(f) || 1) * (0.5 + 0.5 * Math.abs(f)) * w + (1 - w)
            rot += Math.sin(a * 1.5) * 18 * w
            expr = 'dizzy'
          }
          if (t > t1 && t < t1 + 0.05) expr = 'dizzy'
        }
        // riding a wave
        if (lane === plan.wave.lane) {
          const { t0, t1 } = plan.wave
          const w = smooth((t - t0) / 0.014) * smooth((t1 - t) / 0.02)
          if (w > 0) {
            y -= w * L * 0.42
            rot -= w * 13 + Math.sin(this.time * 6) * 3 * w
            expr = 'joy'
            wing = 18 + Math.sin(this.time * 20) * 16 * w
            if (Math.random() < dt * 22 * w) this.burst(x - DL * 0.8, y + L * 0.3, 2, 'drop')
          }
        }
        // over the falls: a little hop at the lip, a drop, a dunk and a bob back up
        const fx = this.XF
        const bx = x - DL * 0.45
        if (bx > fx - DL * 0.1) {
          const u = (bx - fx) / (DL * 1.0)
          if (u < 0) {
            y -= bump((u + 0.1) / 0.1) * L * 0.12
          } else if (u < 1) {
            y += this.D * u * u - bump(u) * L * 0.18
            rot += 10 + u * 30
            expr = 'wow'
            wing = 30 + Math.sin(this.time * 30) * 18
          } else {
            y += this.D
            const s = (u - 1) / 0.7
            if (s < 1) {
              dunk = bump(s)
              y += bump(s) * L * 0.28
              rot -= bump(s) * 14
              sy *= 1 - 0.12 * bump(s * 1.4)
              sx *= 1 + 0.08 * bump(s * 1.4)
            }
          }
        }
        // the stretch and the line
        if (p > 0.86 && p < 1 && this.rank.indexOf(lane) <= 2 && expr === 'happy') expr = 'grit'
        if (this.crossed[lane]) {
          const place = plan.order.indexOf(lane)
          if (place <= 1) {
            expr = 'joy'
            wing = 22 + Math.sin(this.time * 18 + lane) * 20
          }
        }
      }

      // blinks and quacks
      if (this.time > this.blinkAt[lane]) {
        if (this.time > this.blinkAt[lane] + 0.13) this.blinkAt[lane] = this.time + 1.8 + Math.random() * 3.2
        else if (expr === 'happy' || expr === 'grit') expr = 'blink'
      }
      if ((this.phase === 'race' || this.phase === 'idle') && this.time > this.quackAt[lane]) this.quack(lane, false)
      const beakOpen = this.time < this.beakUntil[lane] ? 24 * bump((this.beakUntil[lane] - this.time) / 0.18) : expr === 'wow' || expr === 'joy' ? 14 : 0

      d.x = x
      d.y = y
      d.rot = rot
      d.sx = sx
      d.sy = sy
      d.flip = flip
      d.dunk = dunk
      d.speed = racing ? Math.min(1.4, v) * (this.crossed[lane] ? 0.5 : 1) : 0
      d.stars = Math.max(0, d.stars - dt * 0.8)
      d.pose = {
        expr,
        beak: beakOpen,
        wing,
        head,
        spin: this.time * (16 + sp * 18) + lane,
        flutter: this.time * (8 + sp * 8),
      }
    }
  }

  /* ---------------- camera ---------------- */

  private updateCamera(dt: number) {
    const { W, DL, midY, phone } = this.lay
    if (!(this.phase === 'race' || this.phase === 'done') || !this.plan) {
      const k = 1 - Math.exp(-dt * 3)
      this.z += (1 - this.z) * k
      this.cx += (W / 2 - this.lay.gateX - this.cx) * k
      this.cy += (midY - this.cy) * k
      return
    }
    const plan = this.plan
    const xs = this.ducks.map((d) => d.x)
    const lead = Math.max(...xs)
    const last = Math.min(...xs)
    const pl = progAt(plan, this.rank[0], this.tau)
    // pull back to fit the field, close in for the line
    const fit = (W * 0.8) / Math.max(1, lead - last + DL * 1.7)
    let zt = Math.max(phone ? 0.6 : 0.68, Math.min(1, fit))
    const fin = smooth((pl - 0.955) / 0.035)
    const after = this.crossCount >= 2 ? smooth((this.time - this.secondAt) / 1.4) : 0
    zt = zt + ((phone ? 1.12 : 1.22) - zt) * fin * (1 - after) + (Math.max(phone ? 0.7 : 0.8, zt) - zt) * after
    const lineX = this.X(1) + midY * SHEAR
    // follow the leader until the line is three quarters across the screen, then hold it there; once the field is
    // home, ease over to show the line and the ducks coasting past it
    let xt = Math.min(lead - (0.12 * W) / this.z, lineX - (0.26 * W) / this.z)
    xt = xt + (lineX + (0.14 * W) / this.z - xt) * after
    // vertical: follow the leaders down the falls
    const top = this.rank.slice(0, 3)
    let lv = 0
    for (const l of top) lv += smooth((this.ducks[l].x - DL * 0.45 - this.XF) / (DL * 1.2)) * this.D
    const yt = midY + lv / top.length
    const fast = this.turbo || this.hurried
    const kx = 1 - Math.exp(-dt * (fast ? 7 : 5))
    this.cx += (xt - this.cx) * kx
    this.cy += (yt - this.cy) * (1 - Math.exp(-dt * 3.2))
    this.z += (zt - this.z) * (1 - Math.exp(-dt * (fin > 0 ? 2.2 : 1.6)))
    this.shake = Math.max(0, this.shake - dt * 1.6)
  }

  /* ---------------- particles ---------------- */

  private burst(x: number, y: number, n: number, kind: 'drop' | 'foam') {
    const { L } = this.lay
    for (let i = 0; i < n && this.parts.length < 260; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2
      const s = L * (1.6 + Math.random() * 2.8)
      this.parts.push({ kind, x: x + (Math.random() - 0.5) * L * 0.6, y, vx: Math.cos(a) * s * 0.6, vy: Math.sin(a) * s, floor: y, life: 0, max: 0.5 + Math.random() * 0.5, size: L * (0.04 + Math.random() * 0.06), color: Math.random() < 0.3 ? '#ffffff' : '#c9f6ff', rot: 0, vr: 0, lane: 0 })
    }
  }

  private ring(x: number, y: number) {
    this.parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, floor: y, life: 0, max: 0.9, size: this.lay.DL * 0.5, color: '#ffffff', rot: 0, vr: 0, lane: 0 })
  }

  /** the start: a line of splashes as the field leaves the rope */
  private splashLine() {
    for (let lane = 0; lane < LANES; lane++) this.burst(this.X(0) - this.lay.DL * 0.3, laneY(this.lay, lane), 5, 'drop')
  }

  private confetti(n: number) {
    const { W } = this.lay
    for (let i = 0; i < n; i++) {
      this.parts.push({ kind: 'confetti', x: Math.random() * W, y: -20 - Math.random() * 120, vx: (Math.random() - 0.5) * 80, vy: 80 + Math.random() * 120, floor: 0, life: 0, max: 3 + Math.random() * 1.5, size: 5 + Math.random() * 5, color: PENNANT[i % PENNANT.length], rot: Math.random() * TAU, vr: (Math.random() - 0.5) * 12, lane: 0 })
    }
  }

  private updateParticles(dt: number) {
    const g = this.lay.L * 9
    let n = 0
    for (const p of this.parts) {
      p.life += dt
      if (p.life >= p.max) continue
      if (p.kind === 'drop') {
        p.vy += g * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        if (p.y > p.floor && p.vy > 0) continue
      } else if (p.kind === 'confetti') {
        p.vy = Math.min(p.vy + 60 * dt, 140)
        p.x += (p.vx + Math.sin(p.life * 5 + p.rot) * 40) * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        if (p.y > this.lay.H + 20) continue
      }
      this.parts[n++] = p
    }
    this.parts.length = n
  }

  /* ---------------- drawing ---------------- */

  private draw() {
    const ctx = this.ctx
    if (!this.spr.far) return
    let sxk = 0
    let syk = 0
    if (this.shake > 0) {
      sxk = (Math.random() - 0.5) * this.shake * 6
      syk = (Math.random() - 0.5) * this.shake * 6
    }
    const cx0 = this.cx
    const cy0 = this.cy
    this.cx -= sxk / this.z
    this.cy -= syk / this.z
    const prof = this.prof
    // a pixel read forces the canvas to finish each stage, so the profile shows where the time goes (dev tools only)
    const mark = prof
      ? (k: string) => {
          ctx.getImageData(0, 0, 1, 1)
          const t = performance.now()
          prof[k] = (prof[k] ?? 0) + t - (prof._t ?? t)
          prof._t = t
        }
      : null
    if (prof) prof._t = performance.now()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.updateBackdrop()
    mark?.('clear')
    this.drawFarBank()
    mark?.('far')
    this.drawWater()
    mark?.('water')
    this.drawLanes()
    mark?.('lanes')
    this.drawNearBank()
    mark?.('near')
    this.drawParticles()
    mark?.('parts')
    if (prof) prof._n = (prof._n ?? 0) + 1
    this.cx = cx0
    this.cy = cy0
  }

  /** the backdrop lives in DOM layers the compositor moves: this only sets their transforms */
  private updateBackdrop() {
    const { W, H, L, midY, ay } = this.lay
    const b = this.back
    if (!b) return
    const cw = this.cloudW
    for (let i = 0; i < b.clouds.length; i++) {
      const span = W + cw * 2
      const x = ((((i * 0.31 + 0.07) * span - this.cx * 0.04 * (0.6 + i * 0.2) + this.time * (4 + i * 2)) % span) + span) % span - cw
      const y = H * 0.02 + ((i * 37) % 60) * (H / 900) + (i % 2) * L * 0.5
      const s = 0.55 + ((i * 0.37) % 0.5)
      b.clouds[i].style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(3)})`
    }
    const horizon = ay - (1.5 * L + midY) * this.z
    // a strip slides by its parallax share of the camera, wrapping every tile (the layer holds two)
    const strip = (el: HTMLCanvasElement, tile: number, par: number, y: number, s: number) => {
      const w = tile * s
      const x = -((((this.cx * this.z * par) % w) + w) % w)
      el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) scale(${s.toFixed(4)})`
    }
    const hs = 0.85 + 0.15 * this.z
    strip(b.hills, this.tiles.hills, 0.1, horizon - this.tiles.hillsH + L * 0.8, hs)
    const ts = 0.7 + 0.3 * this.z
    strip(b.trees, this.tiles.trees, 0.32, horizon - L * 1.55 * ts, ts)
  }

  private tileStrip(img: HTMLCanvasElement, par: number, y: number, s: number) {
    const ctx = this.ctx
    const w = (img.width / this.dpr) * s
    const h = (img.height / this.dpr) * s
    let x = -((((this.cx * this.z * par) % w) + w) % w)
    for (; x < this.lay.W; x += w) ctx.drawImage(img, x, y, w + 0.5, h)
  }

  /** copies the backdrop sprites into the DOM layers (the strips twice over, so a shift of one tile never shows an edge) */
  private buildBackdrop() {
    const b = this.back
    const { W } = this.lay
    const dpr = this.dpr
    const put = (el: HTMLCanvasElement, img: HTMLCanvasElement, copies = 1) => {
      el.width = img.width * copies
      el.height = img.height
      el.style.width = `${(img.width * copies) / dpr}px`
      el.style.height = `${img.height / dpr}px`
      const g = el.getContext('2d')!
      for (let i = 0; i < copies; i++) g.drawImage(img, i * img.width, 0)
    }
    put(b.sun, this.spr.sun)
    put(b.rays, this.spr.rays)
    const ss = this.spr.sun.width / dpr
    b.sun.style.transform = `translate3d(${W - ss * 0.92}px,${-ss * 0.14}px,0)`
    b.rays.style.left = `${W - ss * 0.92}px`
    b.rays.style.top = `${-ss * 0.14}px`
    for (const c of b.clouds) put(c, this.spr.cloud)
    put(b.hills, this.spr.hills, 2)
    put(b.trees, this.spr.trees, 2)
    this.tiles = { hills: this.spr.hills.width / dpr, hillsH: this.spr.hills.height / dpr, trees: this.spr.trees.width / dpr }
    this.cloudW = this.spr.cloud.width / dpr
    // the sprites now live in the layers
    delete this.spr.sun
    delete this.spr.rays
    delete this.spr.cloud
    delete this.spr.hills
    delete this.spr.trees
  }

  private drawFarBank() {
    const ctx = this.ctx
    const { L } = this.lay
    const img = this.spr.far
    const tw = img.width / this.dpr
    const th = img.height / this.dpr
    const XF = this.XF
    const [x0, x1] = this.span(0, tw)
    const segs: [number, number, number][] = [
      [x0, Math.min(x1, XF), 0],
      [Math.max(x0, XF), x1, this.D],
    ]
    for (const [a, b, lv] of segs) {
      if (b <= a) continue
      ctx.save()
      this.world()
      ctx.beginPath()
      ctx.rect(a, -th - 4 + lv, b - a, th + 6 + L * 0.3)
      ctx.clip()
      ctx.setTransform(this.dpr * this.z, 0, 0, this.dpr * this.z, this.dpr * (this.lay.W / 2 - this.cx * this.z), this.dpr * (this.lay.ay - this.cy * this.z))
      const k0 = Math.floor(a / tw)
      for (let k = k0; k * tw < b; k++) ctx.drawImage(img, k * tw, -th + L * 0.12 + lv, tw + 1, th)
      ctx.restore()
    }
    // the start and finish on the far bank
    this.farProps()
    // the cliff at the falls
    this.cliff(L * 0.05, -1)
  }

  /** rocks where a bank steps down at the falls: `y` is the bank's edge above the falls, `dir` -1 for the far bank */
  private cliff(y: number, dir: number) {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const XF = this.XF
    const [a, b] = this.span(y, DL * 3)
    if (XF + this.FW + DL < a || XF - DL > b) return
    const D = this.D
    const rocks: [number, number, number][] =
      dir < 0
        ? [
            [XF - DL * 0.2, y - L * 0.55, 0.85],
            [XF + DL * 0.28, y - L * 0.2 + D * 0.45, 0.95],
            [XF + DL * 0.05, y + L * 0.05, 0.6],
            [XF + DL * 0.8, y - L * 0.1 + D, 0.8],
            [XF + DL * 0.55, y + L * 0.15 + D * 0.7, 0.55],
          ]
        : [
            [XF - DL * 0.15, y + L * 0.25, 0.75],
            [XF + DL * 0.35, y + L * 0.45 + D * 0.5, 1],
            [XF + DL * 0.85, y + L * 0.35 + D, 0.8],
            [XF + DL * 0.05, y + L * 0.75 + D * 0.4, 0.7],
            [XF + DL * 0.6, y + L * 0.95 + D, 0.65],
          ]
    for (const [x, ry, k] of rocks) {
      this.upright(x, ry, 1)
      const r = L * 0.62 * k
      ctx.beginPath()
      ctx.moveTo(-r * 1.15, r * 0.55)
      ctx.bezierCurveTo(-r * 1.25, -r * 0.5, -r * 0.4, -r * 1.05, r * 0.25, -r * 0.95)
      ctx.bezierCurveTo(r * 1.0, -r * 0.85, r * 1.3, -r * 0.1, r * 1.15, r * 0.55)
      ctx.closePath()
      ctx.fillStyle = '#9b8b7c'
      ctx.fill()
      ctx.lineWidth = 2.4
      ctx.strokeStyle = INK
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(-r * 1.1, r * 0.5)
      ctx.bezierCurveTo(-r * 0.6, r * 0.1, r * 0.4, r * 0.25, r * 1.12, r * 0.5)
      ctx.closePath()
      ctx.fillStyle = '#7d6d60'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(-r * 0.25, -r * 0.55, r * 0.42, r * 0.16, -0.3, 0, TAU)
      ctx.fillStyle = 'rgba(255,255,255,.35)'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(r * 0.15, -r * 0.88, r * 0.55, r * 0.17, 0.1, 0, TAU)
      ctx.fillStyle = '#62c25c'
      ctx.fill()
    }
  }

  private drawWater() {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const WB = this.WB
    const D = this.D
    const XF = this.XF
    const FW = this.FW
    const [a0, b0] = this.span(0, DL)
    const [a1, b1] = this.span(WB + D, DL)
    const x0 = Math.min(a0, a1)
    const x1 = Math.max(b0, b1)
    const dpr = this.dpr
    const parts: [number, number, number][] = [
      [x0, Math.min(x1, XF), 0],
      [Math.max(x0, XF + FW), x1, D],
    ]
    // anchored to the world, so the ripples travel with the river
    const ox = (this.lay.W / 2 - this.cx * this.z) * dpr
    for (const [a, b, lv] of parts) {
      if (b <= a) continue
      // the region is traced in the world's sheared space, then filled in plain device pixels, where gradients and
      // translation-only patterns are cheap
      this.world()
      ctx.beginPath()
      ctx.rect(a, lv, b - a, WB)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const y0 = this.sy(lv) * dpr
      const y1 = this.sy(lv + WB) * dpr
      const g = ctx.createLinearGradient(0, y0, 0, y1)
      g.addColorStop(0, WATER_TOP)
      g.addColorStop(0.55, '#4fc3e3')
      g.addColorStop(1, WATER_DEEP)
      ctx.fillStyle = g
      ctx.fill()
      // ripples drifting downstream (the glints twinkle on top)
      const pw = this.pat.water!
      pw.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(ox + this.time * L * 0.6 * dpr), Math.round(y0)]))
      ctx.fillStyle = pw
      ctx.globalAlpha = 0.6
      ctx.fill()
      ctx.globalAlpha = 1
      // the far bank's shadow on the water
      this.world()
      ctx.beginPath()
      ctx.rect(a, lv, b - a, L * 0.5)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const sh = ctx.createLinearGradient(0, y0, 0, y0 + L * 0.5 * this.z * dpr)
      sh.addColorStop(0, 'rgba(10,70,100,.45)')
      sh.addColorStop(1, 'rgba(10,70,100,0)')
      ctx.fillStyle = sh
      ctx.fill()
    }
    // the rapids: white water
    const ra = this.X(COURSE.rapids[0])
    const rb = this.X(COURSE.rapids[1])
    if (rb > x0 && ra < x1) this.drawRapids(ra, rb)
    // the falls
    if (XF + FW + DL * 2 > x0 && XF - DL < x1) this.drawFalls()
    // the start rope and the finish line
    this.drawStartRope()
    this.drawFinishLine()
    // glints
    this.drawGlints(x0, x1)
  }

  private drawGlints(x0: number, x1: number) {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const s = this.spr.spark
    const sw = s.width / this.dpr
    const step = DL * 0.9
    for (let k = Math.floor(x0 / step); k * step < x1; k++) {
      const h = hash(k)
      const x = k * step + h * step
      if (x > this.XF - DL * 0.2 && x < this.XF + this.FW + DL * 0.4) continue
      const y = (0.3 + hash(k + 999) * 5.8) * L + this.ground(x)
      const tw = Math.sin(this.time * (2 + h * 3) + h * 20)
      if (tw < 0.4) continue
      ctx.globalAlpha = (tw - 0.4) * 1.4
      const k2 = (0.5 + h * 0.6) * (tw - 0.2)
      this.upright(x, y, k2)
      ctx.drawImage(s, -sw / 2, -sw / 2, sw, sw)
    }
    ctx.globalAlpha = 1
  }

  private drawRapids(ra: number, rb: number) {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const WB = this.WB
    this.world()
    // churned, paler water with darker troughs between the waves
    const g = ctx.createLinearGradient(ra, 0, rb, 0)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.06, 'rgba(235,252,255,.3)')
    g.addColorStop(0.94, 'rgba(235,252,255,.3)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(ra, 0, rb - ra, WB)
    const [v0, v1] = this.span(WB / 2, DL * 1.5)
    const lo = Math.max(ra, v0)
    const hi = Math.min(rb, v1)
    if (hi <= lo) return
    // standing waves: white crests that heave in place, all shapes and sizes
    const step = DL * 0.55
    for (let row = 0; row < 12; row++) {
      const y = (row + 0.25) * L * 0.52
      for (let k = Math.floor(lo / step) - 1; k * step < hi; k++) {
        const h = hash(k * 7 + row * 131)
        if (h < 0.3) continue
        const x = k * step + hash(k * 3 + row * 17) * step
        if (x < ra + DL * 0.25 || x > rb - DL * 0.25) continue
        const ph = this.time * (3.2 + h * 2.5) + h * 12
        const w = DL * (0.12 + h * 0.2)
        const lift = L * (0.08 + h * 0.1) * (0.75 + 0.25 * Math.sin(ph))
        ctx.beginPath()
        ctx.moveTo(x - w, y)
        ctx.quadraticCurveTo(x - w * 0.1, y - lift * 2, x + w, y)
        ctx.quadraticCurveTo(x, y - lift * 0.7, x - w, y)
        ctx.fillStyle = `rgba(255,255,255,${0.6 + 0.3 * Math.sin(ph * 1.3)})`
        ctx.fill()
        // a fleck of foam riding the crest
        if (h > 0.75) {
          ctx.beginPath()
          ctx.ellipse(x + w * 0.4, y - lift * 0.9 - Math.abs(Math.sin(ph)) * L * 0.1, L * 0.05, L * 0.035, 0, 0, TAU)
          ctx.fill()
        }
      }
    }
    // boulders in the stream near each bank, each with its collar of foam
    const rs = DL * 1.15
    for (let k = Math.floor(lo / rs) - 1; k * rs < hi; k++) {
      const h = hash(k * 13 + 1)
      const x = k * rs + h * rs * 0.6
      if (x < ra + DL * 0.4 || x > rb - DL * 0.4) continue
      const far = hash(k * 29) < 0.5
      const y = far ? L * (0.12 + h * 0.2) : WB - L * (0.05 + h * 0.15)
      const s = 0.55 + hash(k * 31) * 0.6
      this.world()
      ctx.beginPath()
      ctx.ellipse(x, y + L * 0.04, DL * 0.32 * s, L * 0.13 * s, 0, 0, TAU)
      ctx.fillStyle = `rgba(255,255,255,${0.75 + 0.2 * Math.sin(this.time * 5 + k)})`
      ctx.fill()
      this.upright(x, y, s)
      const r = this.spr[hash(k * 37) < 0.5 ? 'rock' : 'rock2']
      const rw = r.width / this.dpr
      const rh = r.height / this.dpr
      ctx.drawImage(r, -rw / 2, -rh * 0.82, rw, rh)
    }
  }

  private drawFalls() {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const XF = this.XF
    const FW = this.FW
    const WB = this.WB
    const D = this.D
    this.world()
    // the falling sheet, glassy at the lip and churning white at the bottom
    const g = ctx.createLinearGradient(0, 0, 0, WB + D)
    g.addColorStop(0, '#9fe9f7')
    g.addColorStop(0.5, '#6fd3ee')
    g.addColorStop(1, '#e9fbff')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.moveTo(XF, 0)
    ctx.bezierCurveTo(XF + FW * 0.55, 0, XF + FW * 0.8, D * 0.5, XF + FW, D)
    ctx.lineTo(XF + FW, WB + D)
    ctx.bezierCurveTo(XF + FW * 0.8, WB + D * 0.5, XF + FW * 0.55, WB, XF, WB)
    ctx.closePath()
    ctx.fill()
    // streaks pouring over
    ctx.save()
    ctx.clip()
    ctx.lineCap = 'round'
    const n = 9
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) / n
      const off = (this.time * L * 5 + hash(i) * L * 3) % (L * 1.4)
      ctx.strokeStyle = i % 3 ? 'rgba(255,255,255,.75)' : 'rgba(255,255,255,.45)'
      ctx.lineWidth = L * (0.05 + hash(i + 7) * 0.05)
      for (let y = -L * 1.4 + off; y < WB + D; y += L * 1.4) {
        const x = XF + FW * (0.2 + u * 0.8)
        ctx.beginPath()
        ctx.moveTo(x - FW * 0.12, y)
        ctx.lineTo(x, y + L * 0.75)
        ctx.stroke()
      }
    }
    ctx.restore()
    // the lip: a bright rolling edge
    ctx.beginPath()
    ctx.moveTo(XF, L * 0.05)
    ctx.lineTo(XF, WB - L * 0.05)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = L * 0.18
    ctx.lineCap = 'round'
    ctx.stroke()
    ctx.strokeStyle = 'rgba(30,140,190,.35)'
    ctx.lineWidth = L * 0.05
    ctx.beginPath()
    ctx.moveTo(XF - L * 0.18, L * 0.1)
    ctx.lineTo(XF - L * 0.18, WB - L * 0.1)
    ctx.stroke()
    // foam boiling where it lands, all the way across
    for (let i = 0; i < 16; i++) {
      const h = hash(i * 13 + 5)
      const y = D + (i / 15) * WB
      for (let j = 0; j < 3; j++) {
        const x = XF + FW + DL * (j * 0.32 - 0.12 + h * 0.12)
        const r = L * (0.34 + 0.08 * Math.sin(this.time * (3 + h * 2) + i + j * 2) + h * 0.1) * (1 - j * 0.24)
        ctx.beginPath()
        ctx.ellipse(x, y, r * 1.35, r * 0.85, 0, 0, TAU)
        ctx.fillStyle = j === 0 ? '#ffffff' : `rgba(255,255,255,${0.8 - j * 0.22})`
        ctx.fill()
      }
    }
    // spray hanging in the air
    const mist = ctx.createRadialGradient(XF + FW + DL * 0.3, D + WB * 0.5, 0, XF + FW + DL * 0.3, D + WB * 0.5, WB * 0.7)
    mist.addColorStop(0, 'rgba(255,255,255,.45)')
    mist.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = mist
    ctx.fillRect(XF - DL, D - WB * 0.2, FW + DL * 3, WB * 1.4)
  }

  private drawStartRope() {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const x = this.X(0)
    const [a, b] = this.span(0, DL * 2)
    if (x < a || x > b) return
    let drop = 0
    let alpha = 1
    if (this.ropeDrop >= 0) {
      const u = (this.time - this.ropeDrop) / 0.5
      drop = smooth(u) * L * 0.3
      alpha = 1 - smooth(u)
      if (alpha <= 0) return
    }
    this.world()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(x, L * 0.05 + drop)
    ctx.lineTo(x, this.WB - L * 0.05 + drop)
    ctx.strokeStyle = '#f8f1e2'
    ctx.lineWidth = L * 0.07
    ctx.stroke()
    for (let i = 0; i <= LANES; i++) {
      this.upright(x, i * L + L * 0.02 + drop, 1)
      const f = this.spr.floatRed
      const fw = f.width / this.dpr
      ctx.drawImage(f, -fw / 2, -fw / 2, fw, fw)
      this.world()
    }
    ctx.globalAlpha = 1
  }

  private drawFinishLine() {
    const ctx = this.ctx
    const { DL } = this.lay
    const x = this.X(1)
    const [a, b] = this.span(this.WB, DL * 3)
    if (x < a - DL * 2 || x > b + DL) return
    this.world()
    const D = this.D
    const w = DL * 0.11
    const n = 14
    const h = this.WB / n
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? 'rgba(255,255,255,.92)' : 'rgba(28,24,40,.85)'
        ctx.fillRect(x - w + j * w, D + i * h, w, h)
      }
    }
  }

  /** the lane ropes, the course features in each lane and the ducks, far lane first */
  private drawLanes() {
    const plan = this.plan
    const { L } = this.lay
    for (let lane = 0; lane < LANES; lane++) {
      if (lane > 0) this.drawRope(lane * L)
      if (plan) {
        if (lane === plan.whirl.lane) this.drawWhirl()
        if (lane === Math.min(plan.log.lane, plan.log.hop)) this.drawLog()
        if (lane === plan.wave.lane) this.drawWave()
      }
      this.drawDuck(lane)
    }
  }

  private drawRope(y: number) {
    const ctx = this.ctx
    const { DL, L } = this.lay
    const step = DL * 0.62
    const XF = this.XF
    const segs: [number, number, number][] = [
      [-Infinity, XF, 0],
      [XF + this.FW, Infinity, this.D],
    ]
    const [v0, v1] = this.span(y, step)
    for (const [a, b, lv] of segs) {
      const s0 = Math.max(a, v0, this.X(-0.06))
      const s1 = Math.min(b, v1, this.X(1.16))
      if (s1 <= s0) continue
      this.world()
      ctx.beginPath()
      ctx.moveTo(s0, y + lv)
      ctx.lineTo(s1, y + lv)
      ctx.strokeStyle = 'rgba(255,255,255,.42)'
      ctx.lineWidth = L * 0.03
      ctx.stroke()
      const red = this.spr.floatRed
      const wht = this.spr.floatWhite
      const fw = red.width / this.dpr
      for (let k = Math.ceil(s0 / step); k * step < s1; k++) {
        const x = k * step
        const inR = x > this.X(COURSE.rapids[0]) && x < this.X(COURSE.rapids[1])
        const bob = Math.sin(this.time * (inR ? 9 : 2.4) + k * 0.9 + y) * L * (inR ? 0.07 : 0.025)
        this.upright(x, y + lv + bob, 0.78)
        ctx.drawImage(k % 2 ? wht : red, -fw / 2, -fw / 2, fw, fw)
      }
    }
  }

  private drawWhirl() {
    const ctx = this.ctx
    const plan = this.plan!
    const { L, DL } = this.lay
    const x = this.X(plan.whirl.x) + DL * 0.35
    const y = laneY(this.lay, plan.whirl.lane) + this.ground(x)
    const [a, b] = this.span(y, DL * 2)
    if (x < a || x > b) return
    this.world()
    const R = DL * 0.82
    ctx.save()
    ctx.translate(x, y + L * 0.05)
    ctx.scale(1, 0.36)
    // a funnel of darker water
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R)
    g.addColorStop(0, 'rgba(10,52,92,.9)')
    g.addColorStop(0.35, 'rgba(22,96,150,.6)')
    g.addColorStop(0.75, 'rgba(50,160,205,.25)')
    g.addColorStop(1, 'rgba(60,180,220,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(0, 0, R, 0, TAU)
    ctx.fill()
    // spiral arms of foam turning inwards
    ctx.lineCap = 'round'
    const spin = this.time * 3.6
    for (let arm = 0; arm < 3; arm++) {
      ctx.beginPath()
      for (let k = 0; k <= 24; k++) {
        const u = k / 24
        const r = R * (0.95 - u * 0.85)
        const ang = spin + (arm * TAU) / 3 + u * 4.2
        const px = Math.cos(ang) * r
        const py = Math.sin(ang) * r
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.85 - arm * 0.12})`
      ctx.lineWidth = (L * 0.11) / 0.36
      ctx.stroke()
    }
    // the eye
    ctx.beginPath()
    ctx.arc(0, 0, R * 0.12, 0, TAU)
    ctx.fillStyle = 'rgba(6,30,60,.85)'
    ctx.fill()
    ctx.restore()
  }

  private drawLog() {
    const ctx = this.ctx
    const plan = this.plan!
    const { L, DL } = this.lay
    const x = this.X(plan.log.x)
    const top = Math.min(plan.log.lane, plan.log.hop)
    const [a, b] = this.span(top * L, DL * 2)
    if (x < a || x > b) return
    const y0 = (top + 0.3) * L
    const y1 = (top + 1.9) * L
    const r = DL * 0.2
    const bob = Math.sin(this.time * 2) * L * 0.03
    this.world()
    // the log's side, lying across two lanes
    ctx.beginPath()
    ctx.moveTo(x - r, y0 + bob)
    ctx.lineTo(x - r, y1 + bob)
    ctx.lineTo(x + r, y1 + bob)
    ctx.lineTo(x + r, y0 + bob)
    ctx.closePath()
    const g = ctx.createLinearGradient(x - r, 0, x + r, 0)
    g.addColorStop(0, '#8a5a32')
    g.addColorStop(0.45, '#b77d47')
    g.addColorStop(1, '#6e4426')
    ctx.fillStyle = g
    ctx.fill()
    ctx.lineWidth = 2.4 / this.z
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.beginPath()
    for (let i = 0; i < 4; i++) {
      const yy = y0 + ((y1 - y0) * (i + 0.6)) / 4.5 + bob
      ctx.moveTo(x - r * 0.6, yy)
      ctx.lineTo(x + r * 0.2, yy + L * 0.12)
    }
    ctx.strokeStyle = '#5b381f'
    ctx.lineWidth = 2 / this.z
    ctx.stroke()
    // the near end: rings
    this.upright(x, y1 + bob, 1)
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 1.02, r * 1.02, 0, 0, TAU)
    ctx.fillStyle = '#e2b77c'
    ctx.fill()
    ctx.lineWidth = 2.4
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.62, r * 0.62, 0, 0, TAU)
    ctx.moveTo(r * 0.28, 0)
    ctx.ellipse(0, 0, r * 0.28, r * 0.28, 0, 0, TAU)
    ctx.strokeStyle = '#a8763f'
    ctx.lineWidth = 1.6
    ctx.stroke()
    // a little frog sits on it
    this.upright(x + r * 0.2, y0 + bob + L * 0.15, 0.62)
    const fr = this.spr.frog
    const fw = fr.width / this.dpr
    ctx.drawImage(fr, -fw / 2, -fw * 0.9, fw, fw)
  }

  private drawWave() {
    const ctx = this.ctx
    const plan = this.plan!
    const { L, DL } = this.lay
    const { t0, t1 } = plan.wave
    const t = this.tau
    const w = smooth((t - t0 + 0.012) / 0.022) * smooth((t1 + 0.025 - t) / 0.035)
    if (w <= 0) return
    const d = this.ducks[plan.wave.lane]
    const x = d.x - DL * 0.55
    const y = laneY(this.lay, plan.wave.lane) + this.ground(x)
    this.upright(x, y, 1)
    const h = L * 1.15 * w
    const back = DL * 1.9
    // its shadow on the river
    ctx.beginPath()
    ctx.ellipse(-DL * 0.5, L * 0.16, DL * 1.4, L * 0.16, 0, 0, TAU)
    ctx.fillStyle = 'rgba(8,60,95,.25)'
    ctx.fill()
    const front = DL * 0.75
    const wob = Math.sin(this.time * 7) * L * 0.03
    // the body of the wave: a long back slope, the crest under the duck and a curl falling forwards
    ctx.beginPath()
    ctx.moveTo(-back, L * 0.14)
    ctx.bezierCurveTo(-back * 0.55, L * 0.12, -DL * 0.75, -h * 0.95, -DL * 0.05, -h + wob)
    ctx.bezierCurveTo(DL * 0.38, -h * 1.02, DL * 0.62, -h * 0.72, DL * 0.56, -h * 0.42)
    ctx.bezierCurveTo(DL * 0.5, -h * 0.2, DL * 0.36, -h * 0.3, DL * 0.34, -h * 0.12)
    ctx.bezierCurveTo(DL * 0.36, L * 0.02, DL * 0.55, L * 0.12, front, L * 0.14)
    ctx.closePath()
    const g = ctx.createLinearGradient(0, -h, 0, L * 0.14)
    g.addColorStop(0, '#d4f8ff')
    g.addColorStop(0.22, '#45c0e6')
    g.addColorStop(0.7, '#1e93c8')
    g.addColorStop(1, '#2aa4d6')
    ctx.fillStyle = g
    ctx.fill()
    // ink only along the top, so the wave rises out of the river
    ctx.beginPath()
    ctx.moveTo(-DL * 0.62, -h * 0.72)
    ctx.bezierCurveTo(-DL * 0.45, -h * 0.92, -DL * 0.25, -h * 1.0, -DL * 0.05, -h + wob)
    ctx.bezierCurveTo(DL * 0.38, -h * 1.02, DL * 0.62, -h * 0.72, DL * 0.56, -h * 0.42)
    ctx.bezierCurveTo(DL * 0.5, -h * 0.2, DL * 0.36, -h * 0.3, DL * 0.34, -h * 0.12)
    ctx.lineWidth = 2.4
    ctx.strokeStyle = INK
    ctx.lineCap = 'round'
    ctx.stroke()
    // foam on the crest and the curl
    ctx.beginPath()
    ctx.moveTo(-DL * 0.6, -h * 0.72)
    ctx.bezierCurveTo(-DL * 0.3, -h * 1.0, DL * 0.3, -h * 1.05, DL * 0.5, -h * 0.6)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = L * 0.15
    ctx.stroke()
    // streaks down the back slope
    ctx.strokeStyle = 'rgba(255,255,255,.55)'
    ctx.lineWidth = L * 0.05
    for (let i = 0; i < 3; i++) {
      const u = 0.25 + i * 0.22
      ctx.beginPath()
      ctx.moveTo(-back * u - DL * 0.1, -h * (0.55 - i * 0.14))
      ctx.lineTo(-back * u - DL * 0.45, -h * (0.4 - i * 0.12))
      ctx.stroke()
    }
    // spray off the lip
    for (let i = 0; i < 5; i++) {
      const ph = (this.time * 3 + i * 0.37) % 1
      ctx.globalAlpha = 1 - ph
      ctx.beginPath()
      ctx.arc(DL * (0.5 + ph * 0.5) - i * L * 0.05, -h * 0.75 - Math.sin(ph * Math.PI) * L * 0.4 + i * L * 0.06, L * (0.07 - i * 0.008), 0, TAU)
      ctx.fillStyle = '#ffffff'
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private drawDuck(lane: number) {
    const ctx = this.ctx
    const d = this.ducks[lane]
    const { L, DL } = this.lay
    const wy = laneY(this.lay, lane)
    const k = (DL / DUCK_LEN) * depth(lane)
    // the duck's model origin sits NOSE_X behind its nose
    const ox = d.x - NOSE_X * k * d.flip
    const [a, b] = this.span(wy, DL * 2)
    if (ox < a || ox > b) return
    const ground = d.y - wy
    // wake and shadow on the water, at the water's level under the duck
    const waterY = wy + (d.x - DL * 0.45 > this.XF + this.FW * 0.6 ? this.D : 0)
    const sitting = Math.abs(d.y - waterY) < L * 0.2
    if (d.speed > 0.05 && sitting) {
      this.upright(ox, waterY, 1)
      ctx.globalAlpha = Math.min(0.75, d.speed * 0.6)
      ctx.strokeStyle = '#ffffff'
      ctx.lineCap = 'round'
      ctx.lineWidth = L * 0.06
      const tail = -DL * 0.4
      const len = DL * (0.28 + d.speed * 0.34)
      const wob = Math.sin(this.time * 9 + lane) * L * 0.02
      ctx.beginPath()
      ctx.moveTo(tail + DL * 0.05, -L * 0.03)
      ctx.quadraticCurveTo(tail - len * 0.45, -L * 0.04 + wob, tail - len, -L * 0.17)
      ctx.moveTo(tail + DL * 0.05, L * 0.05)
      ctx.quadraticCurveTo(tail - len * 0.45, L * 0.07 - wob, tail - len, L * 0.2)
      ctx.stroke()
      // a trail of foam bubbles
      ctx.fillStyle = '#ffffff'
      for (let i = 0; i < 4; i++) {
        const ph = (this.time * (1.6 + d.speed) + i * 0.25 + lane * 0.13) % 1
        ctx.globalAlpha = Math.min(0.8, d.speed * 0.7) * (1 - ph)
        ctx.beginPath()
        ctx.arc(tail - ph * len * 1.1, Math.sin(i * 2.3 + lane) * L * 0.06, L * (0.05 - ph * 0.03), 0, TAU)
        ctx.fill()
      }
      ctx.globalAlpha = 1
    }
    // its shadow on the water, fading as it lifts off (a hop, a wave); none over the falls
    const lift = Math.max(0, waterY - d.y)
    const overFalls = d.x - DL * 0.45 > this.XF - DL * 0.1 && d.x - DL * 0.45 < this.XF + DL * 1.05
    if (!overFalls && lift < L * 0.9) {
      this.upright(ox, waterY, 1)
      ctx.globalAlpha = 1 - lift / (L * 0.9)
      ctx.beginPath()
      ctx.ellipse(0, L * 0.02, DL * 0.42 * depth(lane) * (1 - lift / (L * 2)), L * 0.14, 0, 0, TAU)
      ctx.fillStyle = 'rgba(8,60,90,.28)'
      ctx.fill()
      ctx.globalAlpha = 1
    }
    // the duck: squash and stretch about its waterline, rotation about its middle
    const s = this.dpr * this.z * k
    const px = this.dpr * this.sx(ox, wy)
    const py = this.dpr * this.sy(wy + ground)
    ctx.setTransform(s * d.sx * d.flip, 0, 0, s * d.sy, px, py)
    ctx.translate(0, -30)
    ctx.rotate(d.rot * DEG * d.flip)
    ctx.translate(0, 30)
    // at rest the duck is stamped from a sprite, with only its propeller or scarf drawn live; a quack, a flap or a
    // nod draws every shape
    const p = d.pose
    if (p.beak < 1 && Math.abs(p.wing) < 7) {
      const spr = this.duckSprite(lane, p.expr)
      // Dash's scarf streams out behind the body; Nugget's propeller turns on top
      if (lane === 4) drawDuck(ctx, lane, p, 'moving')
      ctx.drawImage(spr.img, spr.x, spr.y, spr.w, spr.h)
      if (lane === 5) drawDuck(ctx, lane, p, 'moving')
    } else drawDuck(ctx, lane, p)
    // the waterline: foam hugging the duck
    if (sitting) {
      ctx.beginPath()
      ctx.ellipse(0, 1, 50, 7, 0, 0, Math.PI)
      ctx.fillStyle = 'rgba(79,195,227,.55)'
      ctx.fill()
      ctx.beginPath()
      ctx.ellipse(0, 0, 52, 6.5, 0, 0.1, Math.PI - 0.1)
      ctx.strokeStyle = 'rgba(255,255,255,.85)'
      ctx.lineWidth = 3.4
      ctx.stroke()
    }
    if (d.dunk > 0) {
      ctx.globalAlpha = d.dunk * 0.6
      ctx.beginPath()
      ctx.ellipse(0, -10, 58, 16, 0, 0, TAU)
      ctx.fillStyle = '#e8fbff'
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (d.stars > 0) {
      for (let i = 0; i < 3; i++) {
        const a = this.time * 6 + (i * TAU) / 3
        ctx.globalAlpha = Math.min(1, d.stars * 2)
        this.star(22 + Math.cos(a) * 26, -96 + Math.sin(a) * 7, 7)
      }
      ctx.globalAlpha = 1
    }
  }

  private sprites = new Map<string, DuckSprite>()
  private duckSprite(lane: number, expr: Expr) {
    const key = `${lane}:${expr}`
    let s = this.sprites.get(key)
    if (!s) {
      // sharp up to the photo-finish close-up
      s = duckSprite(lane, expr, (this.lay.DL / DUCK_LEN) * depth(lane) * this.dpr * 1.3)
      this.sprites.set(key, s)
    }
    return s
  }

  private star(x: number, y: number, r: number) {
    const ctx = this.ctx
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5
      const rr = i % 2 ? r * 0.45 : r
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fillStyle = '#ffd23f'
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = INK
    ctx.stroke()
  }

  /** the bank in front: sand, grass and flowers, the crowd at the finish */
  private drawNearBank() {
    const ctx = this.ctx
    const { L, H } = this.lay
    const img = this.spr.near
    const tw = img.width / this.dpr
    const th = img.height / this.dpr
    const WB = this.WB
    const XF = this.XF
    const [x0, x1] = this.span(WB, tw)
    const segs: [number, number, number][] = [
      [x0, Math.min(x1, XF), 0],
      [Math.max(x0, XF), x1, this.D],
    ]
    const sh = WB * SHEAR
    for (const [a, b, lv] of segs) {
      if (b <= a) continue
      ctx.save()
      ctx.setTransform(this.dpr * this.z, 0, 0, this.dpr * this.z, this.dpr * (this.lay.W / 2 - (this.cx - sh) * this.z), this.dpr * (this.lay.ay - this.cy * this.z))
      ctx.beginPath()
      ctx.rect(a, WB - L * 0.12 + lv, b - a, H / this.z + L * 4)
      ctx.clip()
      for (let k = Math.floor(a / tw); k * tw < b; k++) ctx.drawImage(img, k * tw, WB - L * 0.12 + lv, tw + 1, th)
      // below the tile: plain grass down to the bottom of the screen
      ctx.fillStyle = '#3f9a4c'
      ctx.fillRect(a, WB - L * 0.12 + lv + th - 1, b - a, H / this.z + L * 6)
      ctx.restore()
    }
    this.cliff(WB, 1)
    this.nearProps()
    // reeds in the foreground
    this.tileStrip(this.spr.reeds, 1.25, this.lay.H - (this.spr.reeds.height / this.dpr) * 0.92, 1)
  }

  /** start and finish furniture on the far bank: posts, the grandstand and its crowd */
  private farProps() {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const [a, b] = this.span(0, DL * 4)
    const xs = this.X(0)
    if (xs > a && xs < b) {
      this.upright(xs - L * 0.1, L * 0.02, 1)
      this.post('START', '#22d36f')
    }
    const xf = this.X(1)
    if (xf > a - DL * 3 && xf < b + DL * 3) {
      // grandstand
      const gs = this.spr.stand
      const gw = gs.width / this.dpr
      const gh = gs.height / this.dpr
      this.upright(xf - DL * 1.8, -L * 0.25 + this.D, 1)
      ctx.drawImage(gs, -gw / 2, -gh, gw, gh)
      this.crowd(xf - DL * 3.1, xf - DL * 0.6, -L * 0.62 + this.D, 0.55, 17)
      this.upright(xf - L * 0.1, L * 0.02 + this.D, 1)
      this.post('FINISH', '#ff4d61', true)
    }
    // a board for the last stretch, warnings before the rapids and the falls
    const boards: [number, string, number][] = [
      [0.85, 'FINAL STRETCH', this.D],
      [COURSE.rapids[0] - 0.025, 'RAPIDS!', 0],
      [COURSE.falls - 0.04, 'FALLS AHEAD!', 0],
    ]
    for (const [p, text, lv] of boards) {
      const x = this.X(p)
      if (x > a && x < b) {
        this.upright(x, -L * 0.1 + lv, 1)
        this.board(text)
      }
    }
    // little knots of spectators along the way
    const step = DL * 6.5
    for (let k = Math.max(1, Math.floor(a / step)); k * step < Math.min(b, this.X(0.83)); k++) {
      const x = k * step + hash(k * 41) * step * 0.4
      if (Math.abs(x - this.XF) < DL * 2.2 || Math.abs(x - this.X(COURSE.rapids[0] - 0.025)) < DL * 1.6 || Math.abs(x - this.X(COURSE.falls - 0.04)) < DL * 1.6) continue
      const lv = this.ground(x)
      this.crowd(x, x + DL * (0.9 + hash(k * 43) * 0.8), -L * 0.32 + lv, 0.5, k * 7, true)
    }
  }

  private nearProps() {
    const ctx = this.ctx
    const { L, DL } = this.lay
    const WB = this.WB
    const [a, b] = this.span(WB, DL * 4)
    const xs = this.X(0)
    if (xs > a - DL * 2 && xs < b + DL) {
      // the starter frog with his horn
      this.upright(xs - DL * 0.9, WB + L * 0.75, 1.15)
      const fr = this.spr.starter
      const fw = fr.width / this.dpr
      const jump = this.phase === 'ready' ? Math.abs(Math.sin(this.time * 8)) * L * 0.1 : 0
      ctx.drawImage(fr, -fw / 2, -fw * 0.92 - jump, fw, fw)
    }
    const xf = this.X(1)
    if (xf > a - DL * 6 && xf < b + DL * 4) {
      this.crowd(xf - DL * 5, xf + DL * 3.2, WB + L * 0.95 + this.D, 1, 3)
      // the photo-finish camera
      this.upright(xf + DL * 0.55, WB + L * 1.25 + this.D, 0.85)
      const c = this.spr.camera
      const cw = c.width / this.dpr
      ctx.drawImage(c, -cw * 0.3, -cw * 1.15, cw, cw * 1.2)
    }
  }

  private post(text: string, color: string, checker = false) {
    const ctx = this.ctx
    const { L } = this.lay
    const h = L * 2.3
    ctx.fillStyle = '#f2ead8'
    ctx.strokeStyle = INK
    ctx.lineWidth = 2.4
    ctx.beginPath()
    ctx.rect(-L * 0.06, -h, L * 0.12, h)
    ctx.fill()
    ctx.stroke()
    // flag
    const fw = L * 1.1
    const fh = L * 0.7
    const wave = Math.sin(this.time * 4) * L * 0.06
    ctx.beginPath()
    ctx.moveTo(L * 0.06, -h + L * 0.05)
    ctx.quadraticCurveTo(fw * 0.5, -h - wave, fw, -h + L * 0.05 + wave)
    ctx.lineTo(fw, -h + fh + wave)
    ctx.quadraticCurveTo(fw * 0.5, -h + fh - wave, L * 0.06, -h + fh)
    ctx.closePath()
    if (checker) {
      ctx.save()
      ctx.clip()
      const s = fh / 3
      for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#fff' : '#1c1828'
        ctx.fillRect(L * 0.06 + i * s, -h - L * 0.1 + j * s, s, s)
      }
      ctx.restore()
    } else {
      ctx.fillStyle = color
      ctx.fill()
    }
    ctx.stroke()
    // sign
    const tw = L * 1.5
    const th = L * 0.42
    ctx.beginPath()
    ctx.roundRect(-tw / 2, -h * 0.55, tw, th, th * 0.3)
    ctx.fillStyle = color
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#fff'
    ctx.font = `900 ${Math.round(th * 0.62)}px Manrope, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 0, -h * 0.55 + th * 0.54)
  }

  private board(text: string) {
    const ctx = this.ctx
    const { L } = this.lay
    const w = L * 2.6
    const h = L * 0.5
    ctx.fillStyle = '#8a5a32'
    ctx.fillRect(-w * 0.35, -h * 1.9, L * 0.08, h * 2)
    ctx.fillRect(w * 0.3, -h * 1.9, L * 0.08, h * 2)
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h * 2.2, w, h, h * 0.25)
    ctx.fillStyle = '#ffd23f'
    ctx.fill()
    ctx.lineWidth = 2.4
    ctx.strokeStyle = INK
    ctx.stroke()
    ctx.fillStyle = INK
    ctx.font = `900 ${Math.round(h * 0.5)}px Manrope, system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 0, -h * 1.68)
  }

  /** critters along a bank between x0 and x1, cheering harder as the ducks come home */
  private crowd(x0: number, x1: number, y: number, k: number, seed: number, local = false) {
    const ctx = this.ctx
    const { DL, L } = this.lay
    const [a, b] = this.span(y, DL)
    const step = DL * 0.48 * k
    const plan = this.plan
    let cheer = 0
    if (local) {
      // they jump as the leaders go by
      if (this.phase === 'race') {
        const lead = Math.max(...this.ducks.map((d) => d.x))
        cheer = smooth(1 - Math.abs(lead - (x0 + x1) / 2) / (DL * 3.5))
      }
    } else cheer = this.phase === 'done' ? 0.8 : plan ? smooth((progAt(plan, this.rank[0], this.tau) - 0.9) / 0.08) : 0
    const kinds = ['frog', 'chick', 'bunny', 'turtle', 'bear']
    for (let i = 0; x0 + i * step < x1; i++) {
      const x = x0 + i * step + hash(i + seed) * step * 0.4
      if (x < a || x > b) continue
      const h = hash(i * 3 + seed)
      const s = this.spr[kinds[Math.floor(h * kinds.length)]]
      const sw = s.width / this.dpr
      const jump = Math.max(0, Math.sin(this.time * (7 + h * 4) + h * 20)) * L * 0.22 * cheer + Math.sin(this.time * 2 + i) * L * 0.02
      this.upright(x, y + (i % 2) * L * 0.18 * k, k)
      ctx.drawImage(s, -sw / 2, -sw - jump, sw, sw)
      // a pennant in a duck's colour
      if (h > 0.45) {
        const px = sw * 0.32
        const py = -sw * 0.8 - jump
        const wv = Math.sin(this.time * (5 + h * 3) + i) * L * 0.05
        ctx.strokeStyle = INK
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(px, py + L * 0.3)
        ctx.lineTo(px, py - L * 0.45)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(px, py - L * 0.45)
        ctx.lineTo(px + L * 0.5, py - L * 0.32 + wv)
        ctx.lineTo(px, py - L * 0.18)
        ctx.closePath()
        ctx.fillStyle = PENNANT[Math.floor(hash(i * 7 + seed) * 6)]
        ctx.fill()
        ctx.stroke()
      }
    }
  }

  private drawParticles() {
    const ctx = this.ctx
    for (const p of this.parts) {
      const f = 1 - p.life / p.max
      if (p.kind === 'drop') {
        this.upright(p.x, p.y, 1)
        ctx.globalAlpha = Math.min(1, f * 2)
        ctx.beginPath()
        ctx.arc(0, 0, p.size, 0, TAU)
        ctx.fillStyle = p.color
        ctx.fill()
      } else if (p.kind === 'ring') {
        this.world()
        ctx.globalAlpha = f * 0.8
        ctx.beginPath()
        const r = p.size * (0.4 + (1 - f) * 1.4)
        ctx.ellipse(p.x, p.y, r, r * 0.3, 0, 0, TAU)
        ctx.strokeStyle = p.color
        ctx.lineWidth = this.lay.L * 0.05
        ctx.stroke()
      } else if (p.kind === 'confetti') {
        ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * p.x, this.dpr * p.y)
        ctx.rotate(p.rot)
        ctx.globalAlpha = Math.min(1, f * 3)
        ctx.fillStyle = p.color
        ctx.fillRect(-p.size / 2, -p.size * 0.3, p.size, p.size * 0.6 * Math.abs(Math.cos(p.rot * 1.7)) + 1)
      }
    }
    ctx.globalAlpha = 1
  }

  /* ---------------- sprites ---------------- */

  private buildSprites() {
    const { W, H, L, DL } = this.lay
    const dpr = this.dpr
    const mk = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(w * dpr))
      c.height = Math.max(1, Math.round(h * dpr))
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.lineCap = 'round'
      g.lineJoin = 'round'
      draw(g)
      return c
    }
    const ss = Math.max(90, Math.min(200, H * 0.26))
    this.spr.sun = mk(ss, ss, (g) => {
      const r = ss * 0.2
      const glow = g.createRadialGradient(ss / 2, ss / 2, r * 0.8, ss / 2, ss / 2, ss / 2)
      glow.addColorStop(0, 'rgba(255,244,190,.75)')
      glow.addColorStop(1, 'rgba(255,244,190,0)')
      g.fillStyle = glow
      g.fillRect(0, 0, ss, ss)
      g.beginPath()
      g.arc(ss / 2, ss / 2, r, 0, TAU)
      g.fillStyle = '#ffe066'
      g.fill()
      g.lineWidth = 2.4
      g.strokeStyle = '#f2a91d'
      g.stroke()
      // a sleepy smile
      g.strokeStyle = '#c9781a'
      g.lineWidth = 2
      g.beginPath()
      g.arc(ss / 2 - r * 0.35, ss / 2 - r * 0.1, r * 0.14, Math.PI * 0.15, Math.PI * 0.85)
      g.moveTo(ss / 2 + r * 0.49, ss / 2 - r * 0.1)
      g.arc(ss / 2 + r * 0.35, ss / 2 - r * 0.1, r * 0.14, Math.PI * 0.15, Math.PI * 0.85)
      g.moveTo(ss / 2 - r * 0.3, ss / 2 + r * 0.3)
      g.quadraticCurveTo(ss / 2, ss / 2 + r * 0.55, ss / 2 + r * 0.3, ss / 2 + r * 0.3)
      g.stroke()
      g.fillStyle = 'rgba(255,140,120,.45)'
      g.beginPath()
      g.ellipse(ss / 2 - r * 0.55, ss / 2 + r * 0.22, r * 0.14, r * 0.09, 0, 0, TAU)
      g.ellipse(ss / 2 + r * 0.55, ss / 2 + r * 0.22, r * 0.14, r * 0.09, 0, 0, TAU)
      g.fill()
    })
    this.spr.rays = mk(ss, ss, (g) => {
      g.translate(ss / 2, ss / 2)
      g.fillStyle = 'rgba(255,248,200,.35)'
      for (let i = 0; i < 12; i++) {
        g.rotate(TAU / 12)
        g.beginPath()
        g.moveTo(-ss * 0.03, ss * 0.24)
        g.lineTo(0, ss * 0.48)
        g.lineTo(ss * 0.03, ss * 0.24)
        g.fill()
      }
    })
    const cw = Math.max(120, W * 0.2)
    this.spr.cloud = mk(cw, cw * 0.45, (g) => {
      const puffs = [
        [0.22, 0.62, 0.17],
        [0.42, 0.45, 0.24],
        [0.64, 0.5, 0.2],
        [0.8, 0.66, 0.14],
        [0.5, 0.7, 0.2],
      ]
      g.fillStyle = '#d3eefc'
      for (const [x, y, r] of puffs) {
        g.beginPath()
        g.arc(x * cw, y * cw * 0.45 + 4, r * cw * 0.45 * 1.45, 0, TAU)
        g.fill()
      }
      g.fillStyle = '#ffffff'
      for (const [x, y, r] of puffs) {
        g.beginPath()
        g.arc(x * cw, y * cw * 0.45, r * cw * 0.45 * 1.4, 0, TAU)
        g.fill()
      }
    })
    // rolling hills, tiled
    const hw = Math.max(600, W * 1.3)
    const hh = L * 3.2
    this.spr.hills = mk(hw, hh, (g) => {
      const layer = (color: string, base: number, amp: number, n: number, ph: number) => {
        g.beginPath()
        g.moveTo(0, hh)
        for (let i = 0; i <= 64; i++) {
          const x = (i / 64) * hw
          const y = hh * base - amp * (0.5 + 0.5 * Math.sin((i / 64) * TAU * n + ph)) - amp * 0.4 * (0.5 + 0.5 * Math.sin((i / 64) * TAU * (n * 2 + 1) + ph * 2))
          g.lineTo(x, y)
        }
        g.lineTo(hw, hh)
        g.closePath()
        g.fillStyle = color
        g.fill()
      }
      layer('#a9dfe0', 0.55, hh * 0.35, 2, 0.5)
      layer('#86cfae', 0.75, hh * 0.3, 3, 2.1)
    })
    // a line of round cartoon trees, with forest floor below so a step in the bank never shows sky
    const tw = Math.max(700, W * 1.2)
    const th = L * 4.6
    this.spr.trees = mk(tw, th, (g) => {
      const base = L * 2.0
      g.fillStyle = '#3d8f4b'
      g.fillRect(0, base, tw, th - base)
      const n = Math.round(tw / (L * 0.9))
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < n; i++) {
          const h0 = hash(i * 17 + pass * 5)
          const x = ((i + (pass ? 0.5 : 0)) / n) * tw
          const r = L * (0.55 + h0 * 0.35) * (pass ? 1 : 0.85)
          const y = base - r * (pass ? 0.5 : 0.95)
          for (const dx of [-tw, 0, tw]) {
            g.fillStyle = '#6b4a2e'
            g.fillRect(x + dx - r * 0.1, y, r * 0.2, base - y + 2)
            g.beginPath()
            g.arc(x + dx, y, r, 0, TAU)
            g.fillStyle = pass ? ['#4fb65a', '#5cc463', '#46a852'][Math.floor(h0 * 3)] : ['#3f9a55', '#48a65c'][Math.floor(h0 * 2)]
            g.fill()
            g.beginPath()
            g.arc(x + dx - r * 0.3, y - r * 0.3, r * 0.45, 0, TAU)
            g.fillStyle = 'rgba(255,255,255,.12)'
            g.fill()
          }
        }
      }
    })
    // the far bank: a hedge along the top, grass, then a sandy edge into the water
    const fw = Math.max(800, W * 1.4)
    const fh = L * 1.7
    this.spr.far = mk(fw, fh, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, fh)
      gr.addColorStop(0, '#7fd474')
      gr.addColorStop(1, '#58b85c')
      g.fillStyle = gr
      g.fillRect(0, L * 0.25, fw, fh)
      // hedge bumps
      const n = Math.round(fw / (L * 0.5))
      for (let i = 0; i < n; i++) {
        const x = (i / n) * fw
        const r = L * (0.3 + hash(i * 3) * 0.16)
        for (const dx of [-fw, 0, fw]) {
          g.beginPath()
          g.arc(x + dx, L * 0.36, r, 0, TAU)
          g.fillStyle = '#4fae55'
          g.fill()
        }
      }
      // flowers and tufts
      for (let i = 0; i < n * 1.4; i++) {
        const x = hash(i * 5 + 1) * fw
        const y = L * (0.75 + hash(i * 5 + 2) * 0.6)
        if (hash(i * 5 + 3) < 0.45) {
          g.fillStyle = ['#ffffff', '#ffd23f', '#ff86c8', '#ffb35c'][Math.floor(hash(i * 5 + 4) * 4)]
          g.beginPath()
          g.arc(x, y, L * 0.06, 0, TAU)
          g.fill()
        } else {
          g.strokeStyle = '#3f9a4c'
          g.lineWidth = 1.6
          g.beginPath()
          g.moveTo(x - 3, y)
          g.lineTo(x - 5, y - 6)
          g.moveTo(x, y)
          g.lineTo(x, y - 8)
          g.moveTo(x + 3, y)
          g.lineTo(x + 5, y - 6)
          g.stroke()
        }
      }
      // sandy edge
      g.fillStyle = '#e3c78e'
      g.fillRect(0, fh - L * 0.24, fw, L * 0.24)
      g.fillStyle = '#cfae70'
      g.fillRect(0, fh - L * 0.07, fw, L * 0.07)
      for (let i = 0; i < n; i++) {
        g.fillStyle = '#b89a62'
        g.beginPath()
        g.ellipse(hash(i * 9) * fw, fh - L * (0.08 + hash(i * 9 + 1) * 0.12), L * 0.05, L * 0.03, 0, 0, TAU)
        g.fill()
      }
    })
    // the near bank: wet sand, then grass with flowers
    const nw = Math.max(800, W * 1.4)
    const nh = L * 2.2
    this.spr.near = mk(nw, nh, (g) => {
      g.fillStyle = '#d9bb7f'
      g.fillRect(0, 0, nw, L * 0.4)
      g.fillStyle = '#c6a466'
      g.fillRect(0, 0, nw, L * 0.1)
      const gr = g.createLinearGradient(0, L * 0.3, 0, nh)
      gr.addColorStop(0, '#6fcd6a')
      gr.addColorStop(1, '#3f9a4c')
      g.fillStyle = gr
      g.beginPath()
      g.moveTo(0, nh)
      const n = Math.round(nw / (L * 0.3))
      for (let i = 0; i <= n; i++) g.lineTo((i / n) * nw, L * (0.36 + (i % 2) * 0.08))
      g.lineTo(nw, nh)
      g.closePath()
      g.fill()
      for (let i = 0; i < n; i++) {
        const x = hash(i * 7 + 3) * nw
        const y = L * (0.7 + hash(i * 7 + 4) * 1.2)
        if (hash(i * 7 + 5) < 0.4) {
          const c = ['#ffffff', '#ffd23f', '#ff86c8', '#b28cff'][Math.floor(hash(i * 7 + 6) * 4)]
          for (let p = 0; p < 5; p++) {
            g.beginPath()
            g.arc(x + Math.cos((p * TAU) / 5) * L * 0.07, y + Math.sin((p * TAU) / 5) * L * 0.07, L * 0.055, 0, TAU)
            g.fillStyle = c
            g.fill()
          }
          g.beginPath()
          g.arc(x, y, L * 0.045, 0, TAU)
          g.fillStyle = '#ffb02e'
          g.fill()
        } else {
          g.strokeStyle = '#358a42'
          g.lineWidth = 2
          g.beginPath()
          g.moveTo(x - 4, y)
          g.lineTo(x - 7, y - 9)
          g.moveTo(x, y)
          g.lineTo(x + 1, y - 11)
          g.moveTo(x + 4, y)
          g.lineTo(x + 8, y - 8)
          g.stroke()
        }
      }
      for (let i = 0; i < n * 0.5; i++) {
        g.fillStyle = '#b39058'
        g.beginPath()
        g.ellipse(hash(i * 11) * nw, L * (0.12 + hash(i * 11 + 1) * 0.16), L * 0.06, L * 0.035, 0, 0, TAU)
        g.fill()
      }
    })
    // reeds and cattails in the foreground
    const rw = Math.max(700, W * 1.1)
    const rh = L * 1.5
    this.spr.reeds = mk(rw, rh, (g) => {
      const n = Math.round(rw / (L * 0.22))
      for (let i = 0; i < n; i++) {
        const h0 = hash(i * 23)
        if (h0 < 0.45) continue
        const x = (i / n) * rw
        const top = rh * (0.15 + hash(i * 23 + 1) * 0.5)
        const lean = (hash(i * 23 + 2) - 0.5) * L * 0.5
        g.strokeStyle = h0 > 0.8 ? '#2f7a3a' : '#3b8f45'
        g.lineWidth = L * 0.07
        g.beginPath()
        g.moveTo(x, rh)
        g.quadraticCurveTo(x, (rh + top) / 2, x + lean, top)
        g.stroke()
        if (h0 > 0.85) {
          g.fillStyle = '#7a4a2a'
          g.beginPath()
          g.ellipse(x + lean * 0.92, top + L * 0.18, L * 0.07, L * 0.2, lean / L, 0, TAU)
          g.fill()
        }
      }
    })
    // buoys
    const bs = Math.max(8, L * 0.24)
    const buoy = (c1: string) =>
      mk(bs, bs, (g) => {
        g.beginPath()
        g.arc(bs / 2, bs / 2, bs * 0.38, 0, TAU)
        g.fillStyle = c1
        g.fill()
        g.lineWidth = Math.max(1, bs * 0.09)
        g.strokeStyle = INK
        g.stroke()
        g.beginPath()
        g.arc(bs * 0.4, bs * 0.38, bs * 0.11, 0, TAU)
        g.fillStyle = 'rgba(255,255,255,.75)'
        g.fill()
      })
    this.spr.floatRed = buoy('#ff4d61')
    this.spr.floatWhite = buoy('#ffffff')
    // a glint on the water
    const gs = Math.max(10, L * 0.32)
    this.spr.spark = mk(gs, gs, (g) => {
      g.translate(gs / 2, gs / 2)
      g.fillStyle = '#ffffff'
      g.beginPath()
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4
        const r = i % 2 ? gs * 0.08 : gs * 0.48
        g.lineTo(Math.cos(a) * r, Math.sin(a) * r)
      }
      g.closePath()
      g.fill()
    })
    // a rock
    this.spr.rock = mk(L * 0.9, L * 0.6, (g) => {
      g.beginPath()
      g.moveTo(L * 0.05, L * 0.55)
      g.quadraticCurveTo(L * 0.05, L * 0.12, L * 0.4, L * 0.08)
      g.quadraticCurveTo(L * 0.85, L * 0.08, L * 0.85, L * 0.55)
      g.closePath()
      g.fillStyle = '#9aa3ad'
      g.fill()
      g.lineWidth = 2.2
      g.strokeStyle = INK
      g.stroke()
      g.beginPath()
      g.ellipse(L * 0.35, L * 0.22, L * 0.12, L * 0.05, -0.4, 0, TAU)
      g.fillStyle = 'rgba(255,255,255,.45)'
      g.fill()
    })
    this.spr.rock2 = mk(L * 1.1, L * 0.7, (g) => {
      g.beginPath()
      g.moveTo(L * 0.05, L * 0.66)
      g.bezierCurveTo(L * 0.0, L * 0.3, L * 0.25, L * 0.12, L * 0.5, L * 0.16)
      g.bezierCurveTo(L * 0.62, L * 0.02, L * 0.98, L * 0.1, L * 1.04, L * 0.66)
      g.closePath()
      g.fillStyle = '#a3998e'
      g.fill()
      g.lineWidth = 2.2
      g.strokeStyle = INK
      g.stroke()
      g.beginPath()
      g.ellipse(L * 0.72, L * 0.18, L * 0.14, L * 0.05, 0.2, 0, TAU)
      g.fillStyle = 'rgba(255,255,255,.45)'
      g.fill()
      g.beginPath()
      g.ellipse(L * 0.28, L * 0.3, L * 0.1, L * 0.04, -0.5, 0, TAU)
      g.fill()
    })
    this.buildWaterPatterns()
    this.buildCritters()
    // the grandstand at the finish
    this.spr.stand = mk(DL * 3.2, L * 2.3, (g) => {
      const w = DL * 3.2
      const h = L * 2.3
      g.fillStyle = '#e9e1cf'
      g.strokeStyle = INK
      g.lineWidth = 2.4
      g.beginPath()
      g.rect(w * 0.05, h * 0.36, w * 0.9, h * 0.62)
      g.fill()
      g.stroke()
      // striped roof
      g.save()
      g.beginPath()
      g.moveTo(0, h * 0.4)
      g.lineTo(w * 0.08, h * 0.08)
      g.lineTo(w * 0.92, h * 0.08)
      g.lineTo(w, h * 0.4)
      g.closePath()
      g.clip()
      const n = 10
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? '#ffffff' : '#ff4d61'
        g.fillRect((i / n) * w, 0, w / n + 1, h)
      }
      g.restore()
      g.beginPath()
      g.moveTo(0, h * 0.4)
      g.lineTo(w * 0.08, h * 0.08)
      g.lineTo(w * 0.92, h * 0.08)
      g.lineTo(w, h * 0.4)
      g.closePath()
      g.stroke()
      // scallops
      for (let i = 0; i < n; i++) {
        g.beginPath()
        g.arc(((i + 0.5) / n) * w, h * 0.4, w / n / 2, 0, Math.PI)
        g.fillStyle = i % 2 ? '#ffffff' : '#ff4d61'
        g.fill()
        g.stroke()
      }
      // flags on top
      for (const fx of [0.08, 0.5, 0.92]) {
        g.beginPath()
        g.moveTo(w * fx, h * 0.08)
        g.lineTo(w * fx, 0)
        g.stroke()
        g.beginPath()
        g.moveTo(w * fx, 0)
        g.lineTo(w * fx + L * 0.4, L * 0.1)
        g.lineTo(w * fx, L * 0.2)
        g.closePath()
        g.fillStyle = '#ffd23f'
        g.fill()
        g.stroke()
      }
    })
    // the photo-finish camera on its pole
    const cs = L * 1.6
    this.spr.camera = mk(cs, cs * 1.2, (g) => {
      g.strokeStyle = INK
      g.lineWidth = 2.4
      g.fillStyle = '#5b5f6e'
      g.fillRect(cs * 0.26, cs * 0.5, cs * 0.08, cs * 0.7)
      g.strokeRect(cs * 0.26, cs * 0.5, cs * 0.08, cs * 0.7)
      g.beginPath()
      g.roundRect(cs * 0.05, cs * 0.18, cs * 0.6, cs * 0.36, cs * 0.06)
      g.fillStyle = '#2f3242'
      g.fill()
      g.stroke()
      g.beginPath()
      g.arc(cs * 0.35, cs * 0.36, cs * 0.12, 0, TAU)
      g.fillStyle = '#7fd9ff'
      g.fill()
      g.stroke()
      g.beginPath()
      g.arc(cs * 0.32, cs * 0.33, cs * 0.035, 0, TAU)
      g.fillStyle = '#fff'
      g.fill()
      g.beginPath()
      g.roundRect(cs * 0.12, cs * 0.1, cs * 0.16, cs * 0.1, 2)
      g.fillStyle = '#ffd23f'
      g.fill()
      g.stroke()
      g.beginPath()
      g.arc(cs * 0.56, cs * 0.25, cs * 0.03, 0, TAU)
      g.fillStyle = '#ff4d61'
      g.fill()
    })
  }

  private buildWaterPatterns() {
    // drawn at the size they show, so the fill needs no scaling
    const k = this.dpr * (this.lay.L / 44)
    const mk = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = Math.round(w * k)
      c.height = Math.round(h * k)
      const g = c.getContext('2d')!
      g.scale(c.width / w, c.height / h)
      draw(g)
      return c
    }
    // ripples: short bright arcs, scattered, tileable
    const rip = mk(220, 120, (g) => {
      g.lineCap = 'round'
      for (let i = 0; i < 26; i++) {
        const x = hash(i * 3 + 1) * 220
        const y = hash(i * 3 + 2) * 120
        const w = 10 + hash(i * 3 + 3) * 22
        g.strokeStyle = i % 3 ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.85)'
        g.lineWidth = 2
        for (const dx of [-220, 0, 220]) {
          for (const dy of [-120, 0, 120]) {
            g.beginPath()
            g.moveTo(x + dx - w / 2, y + dy)
            g.quadraticCurveTo(x + dx, y + dy - 3.5, x + dx + w / 2, y + dy)
            g.stroke()
          }
        }
      }
    })
    const glint = mk(170, 90, (g) => {
      g.lineCap = 'round'
      for (let i = 0; i < 16; i++) {
        const x = hash(i * 5 + 11) * 170
        const y = hash(i * 5 + 12) * 90
        const w = 6 + hash(i * 5 + 13) * 14
        g.strokeStyle = 'rgba(255,255,255,.6)'
        g.lineWidth = 1.6
        for (const dx of [-170, 0, 170]) {
          for (const dy of [-90, 0, 90]) {
            g.beginPath()
            g.moveTo(x + dx - w / 2, y + dy)
            g.lineTo(x + dx + w / 2, y + dy)
            g.stroke()
          }
        }
      }
    })
    rip.getContext('2d')!.drawImage(glint, 0, 0, glint.width, glint.height, rip.width * 0.1, rip.height * 0.2, glint.width, glint.height)
    this.pat.water = this.ctx.createPattern(rip, 'repeat')!
  }

  /** the crowd: little critters drawn once each */
  private buildCritters() {
    const { L } = this.lay
    const dpr = this.dpr
    const s = L * 0.95
    const mk = (draw: (g: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas')
      c.width = Math.round(s * dpr)
      c.height = Math.round(s * dpr)
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.scale(s / 100, s / 100)
      g.lineJoin = 'round'
      g.lineCap = 'round'
      g.lineWidth = 4.5
      g.strokeStyle = INK
      draw(g)
      return c
    }
    const eyes = (g: CanvasRenderingContext2D, x1: number, x2: number, y: number, r = 7) => {
      for (const x of [x1, x2]) {
        g.beginPath()
        g.arc(x, y, r, 0, TAU)
        g.fillStyle = '#fff'
        g.fill()
        g.stroke()
        g.beginPath()
        g.arc(x + 1.5, y + 1, r * 0.5, 0, TAU)
        g.fillStyle = INK
        g.fill()
      }
    }
    const smile = (g: CanvasRenderingContext2D, x: number, y: number, w: number) => {
      g.beginPath()
      g.moveTo(x - w, y)
      g.quadraticCurveTo(x, y + w * 0.9, x + w, y)
      g.stroke()
    }
    const blob = (g: CanvasRenderingContext2D, color: string, rx = 34, ry = 30, cy = 70) => {
      g.beginPath()
      g.ellipse(50, cy, rx, ry, 0, 0, TAU)
      g.fillStyle = color
      g.fill()
      g.stroke()
    }
    this.spr.frog = mk((g) => {
      blob(g, '#5fd36a')
      eyes(g, 36, 64, 42, 10)
      smile(g, 50, 74, 14)
      g.fillStyle = 'rgba(255,120,140,.5)'
      g.beginPath()
      g.ellipse(28, 72, 6, 4, 0, 0, TAU)
      g.ellipse(72, 72, 6, 4, 0, 0, TAU)
      g.fill()
    })
    this.spr.chick = mk((g) => {
      blob(g, '#ffe14d', 30, 30)
      g.beginPath()
      g.moveTo(48, 36)
      g.quadraticCurveTo(44, 26, 52, 24)
      g.stroke()
      eyes(g, 40, 60, 62, 6)
      g.beginPath()
      g.moveTo(44, 72)
      g.lineTo(56, 72)
      g.lineTo(50, 80)
      g.closePath()
      g.fillStyle = '#ff8f1f'
      g.fill()
      g.stroke()
    })
    this.spr.bunny = mk((g) => {
      for (const x of [38, 62]) {
        g.beginPath()
        g.ellipse(x, 28, 8, 22, 0, 0, TAU)
        g.fillStyle = '#f4f0ff'
        g.fill()
        g.stroke()
        g.beginPath()
        g.ellipse(x, 30, 3.5, 14, 0, 0, TAU)
        g.fillStyle = '#ffb3cf'
        g.fill()
      }
      blob(g, '#f4f0ff', 30, 28, 72)
      eyes(g, 40, 60, 66, 6)
      smile(g, 50, 80, 7)
    })
    this.spr.turtle = mk((g) => {
      g.beginPath()
      g.arc(50, 50, 18, 0, TAU)
      g.fillStyle = '#9be27a'
      g.fill()
      g.stroke()
      g.beginPath()
      g.ellipse(50, 82, 38, 20, 0, Math.PI, 0)
      g.closePath()
      g.fillStyle = '#7a5a34'
      g.fill()
      g.stroke()
      g.beginPath()
      g.moveTo(36, 70)
      g.lineTo(50, 64)
      g.lineTo(64, 70)
      g.stroke()
      eyes(g, 43, 57, 47, 5.5)
      smile(g, 50, 57, 6)
    })
    this.spr.bear = mk((g) => {
      for (const x of [28, 72]) {
        g.beginPath()
        g.arc(x, 40, 11, 0, TAU)
        g.fillStyle = '#b07a4a'
        g.fill()
        g.stroke()
      }
      blob(g, '#b07a4a', 33, 30, 66)
      g.beginPath()
      g.ellipse(50, 76, 13, 9, 0, 0, TAU)
      g.fillStyle = '#e8c69c'
      g.fill()
      eyes(g, 38, 62, 58, 6)
      g.beginPath()
      g.arc(50, 72, 4, 0, TAU)
      g.fillStyle = INK
      g.fill()
    })
    // the starter: a frog in a cap with a horn
    const st = L * 1.25
    this.spr.starter = (() => {
      const c = document.createElement('canvas')
      c.width = Math.round(st * dpr)
      c.height = Math.round(st * dpr)
      const g = c.getContext('2d')!
      g.scale(dpr, dpr)
      g.scale(st / 100, st / 100)
      g.lineJoin = 'round'
      g.lineCap = 'round'
      g.lineWidth = 4
      g.strokeStyle = INK
      g.beginPath()
      g.ellipse(46, 72, 30, 26, 0, 0, TAU)
      g.fillStyle = '#5fd36a'
      g.fill()
      g.stroke()
      for (const x of [34, 58]) {
        g.beginPath()
        g.arc(x, 46, 9, 0, TAU)
        g.fillStyle = '#fff'
        g.fill()
        g.stroke()
        g.beginPath()
        g.arc(x + 2, 47, 4.5, 0, TAU)
        g.fillStyle = INK
        g.fill()
      }
      // cap
      g.beginPath()
      g.moveTo(26, 38)
      g.quadraticCurveTo(46, 14, 66, 38)
      g.closePath()
      g.fillStyle = '#ff4d61'
      g.fill()
      g.stroke()
      g.beginPath()
      g.moveTo(60, 37)
      g.lineTo(80, 39)
      g.stroke()
      // horn
      g.beginPath()
      g.moveTo(66, 70)
      g.lineTo(84, 60)
      g.lineTo(96, 50)
      g.lineTo(98, 74)
      g.lineTo(86, 70)
      g.closePath()
      g.fillStyle = '#ffd23f'
      g.fill()
      g.stroke()
      g.beginPath()
      g.moveTo(40, 80)
      g.quadraticCurveTo(48, 86, 56, 80)
      g.stroke()
      return c
    })()
  }
}

export type { Caption }
