import * as THREE from 'three'
import { Sparks } from '../../lib/three/fx'
import { BLAST_RADIUS, payoutFor, speciesOf, type FishId, type HitOutcome } from './rules'
import { CAST, hitShape } from './cast'
import { CoinBatch, NetBatch } from './gear'
import { Bolts, Booms, Rings } from './effects'
import { Bubbles } from './fx'
import type { Creature } from './swim'

/*
  What a hit looks like. The catch is already decided when a torpedo touches a creature (the screen ran rules.ts and
  paid it); this plays it out at once, on its own clock, while the reef carries on around it:

  - A miss: the net bursts open over the creature and fades; the creature flinches (a white flash, a shove away from
    the shot, a dash; the puffer puffs right up, the octopus jets) and swims on.
  - A catch: the net wraps it, it struggles with a dizzy face (longer for the big ones), flips belly up and pops into
    a burst of gold coins that hang a moment and arc home into the cannon; the payout number pops where it was. Small
    fry dissolve into the coins; the big ones (turtle and up) vanish in a white cartoon poof. The Golden Whale throws
    up fountain after fountain of coins.
  - The bomb crab: a short sizzle, then a cartoon explosion with shockwave rings, a bubble storm and a screen shake;
    the blast catches everything in it, a beat later the further away it was, each popping into its own coins.
  - The zap jelly: lightning jumps from it to each linked creature in order (a flash ring at each), they fry and
    flash, then all pop.
  - The treasure chest: it is netted, pops its lid, rises glowing and sparkling, and the screen's treasure wheel spins
    (an event with the drawn segment) for WHEEL_SPIN seconds; then it bursts into a fountain of coins.
  - Big catches shake and punch the camera, scaled by value; the Golden Whale most of all.

  Everything here is pooled (moments, coins, rings, poofs) so a busy reef allocates nothing while it plays. The scene
  gives it a MomentStage: projection for the payout anchors, where the cannon is, the camera's shake and punch, and
  its hooks; and it draws its own muzzle rings through ring().
*/

/** how long the screen's treasure wheel spins before it lands (and the chest bursts) */
export const WHEEL_SPIN = 3.6

/** a sound the screen can play, with a number that shapes it (see the scene's onCue) */
export type Cue = 'shot' | 'net' | 'flinch' | 'catch' | 'coin' | 'boom' | 'zap' | 'chest' | 'fizzle' | 'bounce' | 'lock'

/** how big a win is, for the size of its number: under 10×, 10–29×, 30–99×, 100× and up */
export type Tier = 0 | 1 | 2 | 3
export const tierOf = (mult: number): Tier => (mult >= 100 ? 3 : mult >= 30 ? 2 : mult >= 10 ? 1 : 0)

export interface CatchPart {
  id: FishId
  /** its own value (× the shot's cost) and what that pays */
  mult: number
  payout: number
  /** where it is on the stage (CSS px) */
  x: number
  y: number
}

/** a catch's payout moment, for the screen's floating number and catch feed */
export interface CatchFx {
  shot: number
  cost: number
  target: FishId
  /** the whole catch, × cost, and what it paid */
  mult: number
  payout: number
  /** where to pop the number (CSS px on the stage) */
  x: number
  y: number
  tier: Tier
  /** the target species' colour */
  color: string
  /** every creature caught in it, the target first (a bomb blast or a lightning chain catches several) */
  parts: CatchPart[]
}

export type MomentEvent =
  | { type: 'bomb'; x: number; y: number; count: number }
  | { type: 'zap'; x: number; y: number; count: number }
  | { type: 'chest'; shot: number; x: number; y: number }
  | { type: 'wheel'; shot: number; segment: number; mult: number; payout: number; spin: number; x: number; y: number }

export interface MomentStage {
  /** a field point (lift above the swim plane) in CSS px on the stage, into out */
  screen(x: number, y: number, lift: number, out: { x: number; y: number }): void
  /** where coins fly home to (world) */
  home(out: THREE.Vector3): THREE.Vector3
  shake(k: number): void
  punch(k: number, x: number, y: number): void
  cue(c: Cue, k: number): void
  event(e: MomentEvent): void
  caught(c: CatchFx): void
  /** a creature's playback is over: let it go */
  release(c: Creature): void
  /** a coin reached the cannon */
  gulp(): void
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2)
const rand = (a: number, b: number) => a + Math.random() * (b - a)
/** how far up the value scale a catch is: 0 for 1×, 1 for the whale's 200× */
const weight = (mult: number) => clamp01(Math.log2(Math.max(1, mult)) / Math.log2(200))
const dist2 = (a: Creature, b: Creature) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2
/** how many coins burst out of a catch */
const coinsFor = (mult: number) => Math.round(Math.min(34, Math.max(5, 2 + 3.4 * Math.log2(mult + 1))))
/** creatures at least this big (reef units) vanish in a poof rather than dissolving (a big dissolve leaves shards) */
const POOF = 1.8
const isBig = (c: Creature) => CAST[c.id].size >= POOF

/** a short-lived effect in flight (a ring or a poof), in a fixed pool */
interface Timed {
  live: boolean
  x: number
  y: number
  z: number
  size: number
  t: number
  dur: number
  k: number
}
const timedPool = (n: number): Timed[] => Array.from({ length: n }, () => ({ live: false, x: 0, y: 0, z: 0, size: 1, t: 0, dur: 1, k: 1 }))
/** a free record from the pool, or the one nearest its end */
function claim(pool: Timed[]) {
  let best = pool[0]
  for (const p of pool) {
    if (!p.live) return p
    if (p.t / p.dur > best.t / best.dur) best = p
  }
  return best
}

/* ---------------- coins ---------------- */

interface Coin {
  live: boolean
  t: number
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  /** how long it hangs after the burst, and how long its flight home takes */
  hang: number
  fly: number
  /** where its flight home starts */
  ax: number
  ay: number
  az: number
  flying: boolean
  spin: number
  spinV: number
  tilt: number
  scale: number
}

const COINS = 420

class Coins {
  readonly batch = new CoinBatch(COINS)
  private readonly pool: Coin[] = Array.from({ length: COINS }, () => ({ live: false, t: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hang: 0, fly: 0, ax: 0, ay: 0, az: 0, flying: false, spin: 0, spinV: 0, tilt: 0, scale: 1 }))
  private next = 0
  private readonly home = new THREE.Vector3()

  /** n coins bursting out of world (x, y, z); `spread` throws them wider, `delay` holds them back, `hang` keeps them up longer */
  burst(x: number, y: number, z: number, n: number, scale: number, spread = 1, delay = 0, hang = 0) {
    for (let i = 0; i < n; i++) {
      const c = this.pool[this.next]
      this.next = (this.next + 1) % COINS
      const a = (i / n) * Math.PI * 2 + rand(-0.3, 0.3)
      const sp = rand(1.8, 3.6) * spread
      c.live = true
      c.t = -delay - i * 0.008
      c.x = x
      c.y = y
      c.z = z
      c.vx = Math.cos(a) * sp
      c.vz = Math.sin(a) * sp * 0.8
      c.vy = rand(1.6, 3.6)
      c.hang = hang + 0.12 + (i / n) * 0.3 + rand(0, 0.08)
      c.fly = rand(0.55, 0.72)
      c.flying = false
      c.spin = rand(0, 6)
      c.spinV = rand(9, 15) * (Math.random() < 0.5 ? -1 : 1)
      c.tilt = rand(0.3, 1.1)
      c.scale = scale * rand(0.9, 1.1)
    }
  }

  update(dt: number, stage: MomentStage) {
    const h = stage.home(this.home)
    const b = this.batch
    b.begin()
    for (let ci = 0; ci < this.pool.length; ci++) {
      const c = this.pool[ci]
      if (!c.live) continue
      c.t += dt
      if (c.t < 0) continue
      c.spin += c.spinV * dt
      const BURST = 0.42
      if (c.t < BURST + c.hang) {
        // out it bursts, the water slowing it, then it hangs there bobbing
        const k = Math.exp(-dt * 4.8)
        c.vx *= k
        c.vy *= k
        c.vz *= k
        c.x += c.vx * dt
        c.y += c.vy * dt + Math.sin(c.t * 9 + c.spin) * 0.002
        c.z += c.vz * dt
        const pop = Math.min(1, c.t / 0.12)
        b.put(c.x, c.y, c.z, c.spin, c.tilt, c.scale * (0.4 + 0.6 * pop) * (1 + 0.25 * Math.sin(Math.min(1, c.t / 0.25) * Math.PI)), 0)
        continue
      }
      if (!c.flying) {
        c.flying = true
        c.ax = c.x
        c.ay = c.y
        c.az = c.z
      }
      const u = (c.t - BURST - c.hang) / c.fly
      if (u >= 1) {
        c.live = false
        stage.gulp()
        continue
      }
      // home along an arc that lifts towards the camera, then drops into the cannon
      const e = easeInOut(u)
      const mx = (c.ax + h.x) / 2
      const my = Math.max(c.ay, h.y) + 1.6
      const mz = (c.az + h.z) / 2
      const i1 = 1 - e
      c.x = i1 * i1 * c.ax + 2 * i1 * e * mx + e * e * h.x
      c.y = i1 * i1 * c.ay + 2 * i1 * e * my + e * e * h.y
      c.z = i1 * i1 * c.az + 2 * i1 * e * mz + e * e * h.z
      b.put(c.x, c.y, c.z, c.spin, c.tilt, c.scale * (1 - 0.45 * e * e), 0)
    }
    b.end()
  }

  clear() {
    for (const c of this.pool) c.live = false
  }
}

/* ---------------- moments ---------------- */

type Kind = 'miss' | 'catch' | 'bomb' | 'zap' | 'chest'

/** the most creatures one hit can catch along (a bomb in a packed formation) */
const MAX_EXTRAS = 24

interface Moment {
  live: boolean
  kind: Kind
  t: number
  prev: number
  shot: number
  cost: number
  target: Creature
  uid: number
  mult: number
  wheel: number
  /** the creatures caught along with it, in order, and their own clocks */
  extras: Creature[]
  n: number
  hitAt: number[]
  popAt: number[]
  /** the net: its rim radius, its spin, and where it is */
  netR: number
  netSpin: number
  nx: number
  ny: number
  /** the timeline's marks (seconds into the moment) and when it is over */
  T1: number
  T2: number
  T3: number
  end: number
  /** the torpedo's direction, for the flinch's shove */
  dx: number
  dy: number
  /** how far up the value scale (0..1) */
  w: number
}

const POOL = 48

const V3 = () => new THREE.Vector3()
const NET_Y = 0.05

export class Moments {
  readonly group = new THREE.Group()
  private readonly list: Moment[]
  private readonly coins = new Coins()
  private readonly nets = new NetBatch(POOL)
  private readonly rings = new Rings(24)
  private readonly booms = new Booms(6)
  private readonly puffs = new Booms(10, 'puff')
  private readonly bolts = new Bolts(14)
  private readonly ringQ = timedPool(24)
  private readonly puffQ = timedPool(10)
  readonly sparks = new Sparks(500)
  private readonly pt = { x: 0, y: 0 }
  private readonly a = V3()
  private readonly b = V3()
  private readonly col = new THREE.Color()
  private clock = 0

  constructor(
    private readonly stage: MomentStage,
    /** the scene's bubble pool, for bursts */
    private readonly bubbles: Bubbles,
  ) {
    this.list = Array.from({ length: POOL }, () => ({
      live: false, kind: 'miss' as Kind, t: 0, prev: 0, shot: 0, cost: 0, target: null as unknown as Creature, uid: 0, mult: 0, wheel: -1,
      extras: new Array<Creature>(MAX_EXTRAS), n: 0, hitAt: new Array<number>(MAX_EXTRAS).fill(0), popAt: new Array<number>(MAX_EXTRAS).fill(0),
      netR: 1, netSpin: 0, nx: 0, ny: 0, T1: 0, T2: 0, T3: 0, end: 1, dx: 0, dy: 1, w: 0,
    }))
    this.group.add(this.nets.mesh, this.coins.batch.mesh, this.rings.mesh, this.booms.mesh, this.puffs.mesh, this.bolts.group, this.sparks.points)
  }

  /**
   * Plays a resolved hit. `extras` are the creatures the scene found in the blast or chain (nearest first), of which
   * the outcome's first `out.extras.length` were caught; target and those are already held (no torpedo can touch
   * them again). (dx, dy) is the torpedo's direction.
   */
  play(shot: number, cost: number, target: Creature, extras: readonly Creature[], out: HitOutcome, dx: number, dy: number) {
    let m: Moment | null = null
    for (const x of this.list)
      if (!x.live) {
        m = x
        break
      }
    if (!m) {
      // never in practice (more hits in play than torpedoes can make); finish the oldest at once
      m = this.list[0]
      this.finish(m)
    }
    const kind = speciesOf(target.id).kind
    m.live = true
    m.kind = !out.caught ? 'miss' : kind === 'bomb' ? 'bomb' : kind === 'chain' ? 'zap' : kind === 'chest' ? 'chest' : 'catch'
    m.t = m.prev = 0
    m.shot = shot
    m.cost = cost
    m.target = target
    m.uid = target.uid
    m.mult = out.mult
    m.wheel = out.wheel ?? -1
    m.n = out.caught ? Math.min(out.extras.length, MAX_EXTRAS, extras.length) : 0
    for (let i = 0; i < m.n; i++) m.extras[i] = extras[i]
    // a round net over the body: sized by its girth rather than its length, so a long shark's net isn't huge
    const h = hitShape(target.id, target.scale)
    m.netR = Math.sqrt(h.a * h.b) * 1.35 + 0.2
    m.netSpin = rand(0, Math.PI * 2)
    m.nx = target.x
    m.ny = target.y
    m.dx = dx
    m.dy = dy
    m.w = weight(out.caught ? out.mult : speciesOf(target.id).mult)
    this.stage.cue('net', speciesOf(target.id).mult)
    this.bubbles.burst(target.x, 0.25, -target.y, 10 + Math.round(m.w * 14), 2 + m.w * 1.5, 0.1, 0.8)
    if (m.kind === 'miss') {
      m.end = 0.6
      this.flinch(target, dx, dy)
      return
    }
    target.hold = 0
    if (m.kind === 'catch') {
      m.T1 = 0.55 + 0.85 * m.w
      m.T2 = m.T1 + 0.3
      m.T3 = m.T2 + (isBig(target) ? 0.34 : 0.24)
      m.end = m.T3 + 0.05
    } else if (m.kind === 'bomb') {
      m.T1 = 0.42
      let last = m.T1 + 0.85
      for (let i = 0; i < m.n; i++) {
        const e = m.extras[i]
        const d = Math.hypot(e.x - target.x, e.y - target.y)
        m.hitAt[i] = m.T1 + 0.06 + Math.min(1, d / BLAST_RADIUS) * 0.28
        m.popAt[i] = m.hitAt[i] + 0.8
        e.hold = m.hitAt[i]
        last = Math.max(last, m.popAt[i])
      }
      m.end = last + 0.3
    } else if (m.kind === 'zap') {
      m.T1 = 0.35
      m.T2 = m.T1 + Math.max(1, m.n) * 0.14 + 0.5
      // the lightning hops from each link to the nearest one not yet lit, so it reads as one chain
      for (let i = 0; i < m.n; i++) {
        const from = i === 0 ? target : m.extras[i - 1]
        let best = i
        for (let j = i + 1; j < m.n; j++) if (dist2(from, m.extras[j]) < dist2(from, m.extras[best])) best = j
        const e = m.extras[best]
        m.extras[best] = m.extras[i]
        m.extras[i] = e
      }
      for (let i = 0; i < m.n; i++) {
        m.hitAt[i] = m.T1 + i * 0.14
        m.popAt[i] = m.T2 + 0.25 + i * 0.05
        m.extras[i].hold = m.hitAt[i]
      }
      m.end = m.T2 + 0.25 + m.n * 0.05 + 0.3
    } else {
      m.T1 = 0.32
      m.T2 = m.T1 + 0.45 + WHEEL_SPIN
      m.end = m.T2 + 0.4
    }
  }

  /** a creature dodging a net that missed it */
  private flinch(c: Creature, dx: number, dy: number) {
    c.flash = 0.9
    c.boost = c.id === 'octopus' ? 1.4 : 1
    if (c.id === 'puffer' || c.id === 'octopus') c.pose = 1
    c.ovx += dx * 2.4
    c.ovy += dy * 2.4
    this.stage.cue('flinch', speciesOf(c.id).mult)
  }

  /* ---------------- each frame ---------------- */

  update(dt: number) {
    this.clock += dt
    const t = this.clock
    this.nets.begin()
    this.rings.begin()
    this.booms.begin()
    this.puffs.begin()
    this.bolts.clear()
    let bolt = 0
    for (let mi = 0; mi < this.list.length; mi++) {
      const m = this.list[mi]
      if (!m.live) continue
      m.prev = m.t
      m.t += dt
      const c = m.target
      // a creature whose playback was cut short (the scene let it go) ends its moment
      if (c.uid !== m.uid && m.kind !== 'miss') {
        m.live = false
        continue
      }
      if (m.kind === 'miss') this.miss(m, t)
      else if (m.kind === 'catch') this.catch(m, t)
      else if (m.kind === 'bomb') this.bomb(m, t)
      else if (m.kind === 'zap') bolt = this.zap(m, t, bolt)
      else this.chest(m, t)
      if (m.t >= m.end) this.finish(m)
    }
    this.drawTimed(dt)
    this.nets.end()
    this.rings.end()
    this.booms.end()
    this.puffs.end()
    this.bolts.update(dt)
    this.coins.update(dt, this.stage)
    this.sparks.update(dt)
  }

  /** the moment passed `at` seconds this frame */
  private at(m: Moment, at: number) {
    return m.prev < at && m.t >= at
  }

  private net(m: Moment, open: number, fade: number, grow: number, t: number) {
    if (fade >= 1) return
    const r = m.netR * grow
    this.nets.put(m.nx, NET_Y, -m.ny, r, r * 0.62, m.netSpin + m.t * 0.5, open, fade, t)
  }

  /** the net's burst: it pops out past full size and settles */
  private grow(m: Moment) {
    const u = clamp01(m.t / 0.16)
    return easeOut(u) * 1.16 - 0.16 * clamp01((m.t - 0.16) / 0.14)
  }

  private miss(m: Moment, t: number) {
    const c = m.target
    // the net bursts where the creature was and stays there as it dashes off, quickly gone (a held trigger makes
    // five a second)
    if (m.t < 0.12 && c.uid === m.uid) {
      m.nx = c.x
      m.ny = c.y
    }
    this.net(m, 0, clamp01((m.t - 0.2) / 0.38), this.grow(m) * 0.92, t)
  }

  /** a caught creature fighting the net: shaking, flashing, dizzy */
  private struggle(c: Creature, t: number, k: number) {
    c.mood = 1
    c.rate = 3.4
    c.roll = Math.sin(t * 26 + c.seed) * 0.3 * k
    c.flash = 0.7 * Math.max(0, Math.sin(t * 17 + c.seed)) ** 2 * k
  }

  /** turning belly up and lifting out of the water, u 0..1 */
  private flip(c: Creature, u: number) {
    const e = easeOut(u)
    c.roll = Math.PI * e
    c.scale = 1 + 0.2 * e
    c.lift = 0.35 * e
    c.flash = 0
  }

  /**
   * Popping into coins, u 0..1: the small fry dissolve; a big one swells, then shrinks away inside its poof (pop()
   * starts the poof as this begins).
   */
  private vanish(c: Creature, u: number) {
    if (!isBig(c)) {
      c.fade = u
      c.scale = 1.2 + 0.35 * u
      return
    }
    c.fade = 0
    c.scale = u < 0.3 ? 1.2 + u : 1.5 * (1 - (u - 0.3) / 0.7) ** 2
  }

  /** the coins and sparkle of one creature popping, with value mult */
  private pop(c: Creature, mult: number, extra = 1) {
    const w = weight(mult)
    const x = c.x
    const z = -c.y
    this.coins.burst(x, 0.45 + c.lift, z, Math.round(coinsFor(mult) * extra), 1.55 + 0.5 * w, 1 + w * 0.7)
    this.sparks.burst(this.a.set(x, 0.6, z), this.col.set(speciesOf(c.id).color), 10 + Math.round(w * 24), 2.6 + w * 3, 0.18 + w * 0.12, 0.6)
    this.bubbles.burst(x, 0.3, z, 8 + Math.round(w * 16), 2.2, 0.09, 0.9)
    // a splash ring round the bigger catches (kept modest: the big ones are big enough already)
    if (w > 0.3) this.ring(c.x, c.y, Math.min(CAST[c.id].size, 2.6) * (0.75 + w * 0.5), 0.6, 0.55)
    if (isBig(c)) {
      // the poof it vanishes in, with a twinkle of white stars
      const size = CAST[c.id].size * (c.id === 'whale' ? 0.62 : 0.85)
      this.poof(c.x, c.y, size, 0.25 + c.lift, c.id === 'whale' ? 0.9 : 0.65)
      this.sparks.burst(this.a.set(x, 0.7 + c.lift, z), this.col.set('#ffffff'), 14 + Math.round(size * 5), 2.4 + size, 0.2, 0.7)
    }
    if (c.id === 'whale') {
      // the top prize: a wide splash, and three fountains of coins that hang high before they stream home
      this.ring(c.x, c.y, 4.2, 1.0, 0.6)
      for (let i = 0; i < 3; i++) this.coins.burst(x + (i - 1) * 1.4, 0.6, z + rand(-0.4, 0.4), 22, 2.1, 3 + i * 0.4, 0.3 + i * 0.4, 0.5)
    }
  }

  /** a ring racing out over the swim plane (or `lift` above it) round field (x, y) */
  ring(x: number, y: number, radius: number, dur: number, strength: number, lift = 0.02) {
    const r = claim(this.ringQ)
    r.live = true
    r.x = x
    r.y = lift
    r.z = -y
    r.size = radius
    r.t = 0
    r.dur = dur
    r.k = strength
  }

  /** a white cartoon poof swelling over field (x, y) */
  private poof(x: number, y: number, size: number, lift: number, dur: number) {
    const p = claim(this.puffQ)
    p.live = true
    p.x = x
    p.y = lift
    p.z = -y
    p.size = size
    p.t = 0
    p.dur = dur
  }

  /** the payout number's moment: tells the screen where and how much */
  private payout(m: Moment, x: number, y: number, lift: number) {
    const c = m.target
    this.stage.screen(x, y, lift, this.pt)
    const parts: CatchPart[] = []
    const part = (cr: Creature) => {
      const sm = m.kind === 'chest' ? m.mult : speciesOf(cr.id).mult
      const p = { x: 0, y: 0 }
      this.stage.screen(cr.x, cr.y, cr.lift, p)
      parts.push({ id: cr.id, mult: sm, payout: payoutFor(m.cost, sm), x: p.x, y: p.y })
    }
    part(c)
    for (let i = 0; i < m.n; i++) part(m.extras[i])
    const tier = tierOf(m.mult)
    this.stage.caught({ shot: m.shot, cost: m.cost, target: c.id, mult: m.mult, payout: payoutFor(m.cost, m.mult), x: this.pt.x, y: this.pt.y, tier, color: speciesOf(c.id).color, parts })
    this.stage.cue('catch', m.mult)
    // the camera answers the size of the win
    if (tier >= 1) this.stage.shake(tier === 1 ? 0.14 : tier === 2 ? 0.32 : 0.7)
    if (tier >= 2) this.stage.punch(tier === 2 ? 0.45 : 1, x, y)
  }

  private catch(m: Moment, t: number) {
    const c = m.target
    m.nx = c.x
    m.ny = c.y
    if (m.t < m.T1) this.struggle(c, t, 1)
    else if (m.t < m.T2) this.flip(c, (m.t - m.T1) / (m.T2 - m.T1))
    else this.vanish(c, clamp01((m.t - m.T2) / (m.T3 - m.T2)))
    if (this.at(m, m.T2)) {
      this.pop(c, m.mult, c.id === 'whale' ? 1.6 : 1)
      this.payout(m, c.x, c.y, c.lift)
    }
    this.net(m, easeOut(clamp01(m.t / 0.35)), c.fade, this.grow(m), t)
  }

  private bomb(m: Moment, t: number) {
    const crab = m.target
    m.nx = crab.x
    m.ny = crab.y
    if (m.t < m.T1) {
      // the fuse races down: a fast flicker, a shiver
      crab.mood = 1
      crab.rate = 5
      crab.roll = Math.sin(t * 40) * 0.12
      crab.flash = Math.sin(t * 44) > 0 ? 0.85 : 0.1
      this.net(m, easeOut(clamp01(m.t / 0.3)), 0, this.grow(m), t)
    } else crab.fade = 1
    const bt = m.t - m.T1
    if (bt >= 0 && bt < 1.1) this.booms.put(crab.x, 0.25, -crab.y, 2.9, bt / 1.1)
    if (this.at(m, m.T1)) {
      this.ring(crab.x, crab.y, BLAST_RADIUS + 0.5, 0.8, 1)
      this.ring(crab.x, crab.y, (BLAST_RADIUS + 0.5) * 1.55, 1.1, 0.5)
      this.bubbles.burst(crab.x, 0.2, -crab.y, 46, 5, 0.16, 1.4)
      this.sparks.burst(this.a.set(crab.x, 0.6, -crab.y), this.col.set('#ffb02e'), 44, 6.5, 0.3, 0.8)
      this.coins.burst(crab.x, 0.5, -crab.y, coinsFor(speciesOf('crab').mult), 1.8, 1.6)
      this.stage.cue('boom', m.n)
      this.stage.shake(0.6)
      this.stage.punch(0.6, crab.x, crab.y)
      this.stage.event({ type: 'bomb', x: this.screenX(crab), y: this.pt.y, count: m.n })
    }
    if (this.at(m, m.T1 + 0.22)) this.payout(m, crab.x, crab.y, 0.4)
    for (let i = 0; i < m.n; i++) {
      const e = m.extras[i]
      const et = m.t - m.hitAt[i]
      if (et < 0) continue
      if (this.at(m, m.hitAt[i])) {
        // the shockwave shoves it away from the crab
        const dx = e.x - crab.x
        const dy = e.y - crab.y
        const d = Math.hypot(dx, dy) || 1
        e.ovx += (dx / d) * 3
        e.ovy += (dy / d) * 3
      }
      const p = m.popAt[i]
      if (m.t < p - 0.3) {
        this.struggle(e, t, 1)
        e.flash = Math.max(e.flash, 1 - et * 3)
      } else if (m.t < p) this.flip(e, (m.t - (p - 0.3)) / 0.3)
      else this.vanish(e, clamp01((m.t - p) / 0.24))
      if (this.at(m, p)) {
        this.pop(e, speciesOf(e.id).mult)
        this.stage.cue('coin', i)
      }
    }
  }

  /** the x of a creature on the stage, leaving its y in this.pt */
  private screenX(c: Creature) {
    this.stage.screen(c.x, c.y, 0.3, this.pt)
    return this.pt.x
  }

  /** a creature frying in the lightning: a fast white flicker and a jitter */
  private fry(c: Creature, t: number) {
    c.mood = 1
    c.rate = 4
    c.roll = Math.sin(t * 30 + c.seed) * 0.22
    c.flash = 0.45 + 0.45 * Math.sin(t * 60 + c.seed)
  }

  private zap(m: Moment, t: number, bolt: number) {
    const jelly = m.target
    m.nx = jelly.x
    m.ny = jelly.y
    if (m.t < m.T1) this.struggle(jelly, t, 1)
    else if (m.t < m.T2) this.fry(jelly, t)
    else if (m.t < m.T2 + 0.25) this.flip(jelly, (m.t - m.T2) / 0.25)
    else this.vanish(jelly, clamp01((m.t - m.T2 - 0.25) / 0.24))
    this.net(m, easeOut(clamp01(m.t / 0.3)), clamp01((m.t - m.T1) / 0.3), this.grow(m), t)
    if (this.at(m, m.T1)) {
      this.stage.event({ type: 'zap', x: this.screenX(jelly), y: this.pt.y, count: m.n })
      this.stage.shake(0.2)
    }
    // the bolts: jelly to the first link, each link to the next, lit in turn and crackling till they all pop
    const lit = m.t >= m.T1 && m.t < m.T2
    if (lit && m.n === 0) {
      // nothing to jump to: it crackles round itself
      for (let k = 0; k < 3; k++) {
        const a = k * 2.1 + m.netSpin
        this.bolts.set(bolt++, this.a.set(jelly.x, 0.3, -jelly.y), this.b.set(jelly.x + Math.cos(a) * 1.4, 0.3, -jelly.y - Math.sin(a) * 1.1), 0.7)
      }
    }
    for (let i = 0; i < m.n; i++) {
      const e = m.extras[i]
      const from = i === 0 ? jelly : m.extras[i - 1]
      if (this.at(m, m.hitAt[i])) {
        this.stage.cue('zap', i)
        this.sparks.burst(this.a.set(e.x, 0.5, -e.y), this.col.set('#bff8ff'), 10, 3, 0.18, 0.4)
        this.ring(e.x, e.y, 0.55 + CAST[e.id].size * 0.35, 0.32, 0.85, 0.3)
      }
      if (lit && m.t >= m.hitAt[i]) this.bolts.set(bolt++, this.a.set(from.x, 0.3, -from.y), this.b.set(e.x, 0.3, -e.y), 1)
      const p = m.popAt[i]
      if (m.t < m.hitAt[i]) continue
      if (m.t < m.T2) this.fry(e, t)
      else if (m.t < p) this.flip(e, clamp01((m.t - m.T2) / (p - m.T2)))
      else this.vanish(e, clamp01((m.t - p) / 0.24))
      if (this.at(m, p)) this.pop(e, speciesOf(e.id).mult)
    }
    if (this.at(m, m.T2 + 0.25)) {
      this.pop(jelly, speciesOf('jelly').mult)
      this.payout(m, jelly.x, jelly.y, 0.4)
    }
    return bolt
  }

  private chest(m: Moment, t: number) {
    const c = m.target
    m.nx = c.x
    m.ny = c.y
    const open = m.T1
    if (m.t < open) {
      c.rate = 3
      c.roll = Math.sin(t * 24) * 0.12
      c.flash = 0.4 * Math.max(0, Math.sin(t * 20)) ** 2
    } else if (m.t < m.T2) {
      // the lid flies open, the chest rises glowing, and sparkles stream up while the wheel spins
      const u = clamp01((m.t - open) / 0.5)
      c.pose = easeOut(u)
      c.roll = Math.sin(m.t * 3) * 0.05
      c.flash = 0
      c.lift = 0.5 * easeOut(clamp01((m.t - open) / 0.6))
      c.scale = 1 + 0.3 * easeOut(clamp01((m.t - open) / 0.6))
      if (Math.floor(m.t / 0.07) !== Math.floor(m.prev / 0.07) && m.t > open + 0.3) this.sparks.emit(c.x + rand(-0.5, 0.5), 0.6 + c.lift, -c.y + rand(-0.3, 0.3), rand(-0.3, 0.3), rand(1.2, 2.2), rand(-0.3, 0.3), this.col.set('#ffd84a').multiplyScalar(2), rand(0.14, 0.26), rand(0.6, 1), 0.5, 0.5)
    } else this.vanish(c, clamp01((m.t - m.T2) / 0.3))
    this.net(m, easeOut(clamp01(m.t / 0.3)), clamp01((m.t - open) / 0.3), this.grow(m), t)
    if (this.at(m, open)) {
      this.stage.cue('chest', 0)
      this.stage.event({ type: 'chest', shot: m.shot, x: this.screenX(c), y: this.pt.y })
      this.sparks.burst(this.a.set(c.x, 0.7, -c.y), this.col.set('#ffd84a'), 26, 3.5, 0.24, 0.8)
    }
    if (this.at(m, open + 0.45)) this.stage.event({ type: 'wheel', shot: m.shot, segment: m.wheel, mult: m.mult, payout: payoutFor(m.cost, m.mult), spin: WHEEL_SPIN, x: this.screenX(c), y: this.pt.y })
    if (this.at(m, m.T2)) {
      this.pop(c, m.mult, 1.2)
      this.coins.burst(c.x, 0.9, -c.y, 16, 1.9, 1.4, 0.25)
      this.payout(m, c.x, c.y, c.lift)
    }
  }

  private finish(m: Moment) {
    m.live = false
    if (m.kind === 'miss') return
    const c = m.target
    if (c.uid === m.uid) this.stage.release(c)
    for (let i = 0; i < m.n; i++) if (m.extras[i].mode === 'held') this.stage.release(m.extras[i])
  }

  /** the rings and poofs in flight (drawn after the moments start them) */
  private drawTimed(dt: number) {
    for (const r of this.ringQ) {
      if (!r.live) continue
      r.t += dt
      if (r.t >= r.dur) r.live = false
      else this.rings.put(r.x, r.y, r.z, r.size, r.t / r.dur, r.k)
    }
    for (const p of this.puffQ) {
      if (!p.live) continue
      p.t += dt
      if (p.t >= p.dur) p.live = false
      else this.puffs.put(p.x, p.y, p.z, p.size, p.t / p.dur)
    }
  }

  /** every effect gone (the scene is leaving or starting over) */
  clear() {
    for (const m of this.list) m.live = false
    this.coins.clear()
    for (const r of this.ringQ) r.live = false
    for (const p of this.puffQ) p.live = false
  }

  dispose() {
    this.nets.dispose()
    this.coins.batch.dispose()
    this.rings.dispose()
    this.booms.dispose()
    this.puffs.dispose()
    this.bolts.dispose()
    this.sparks.dispose()
  }
}
