import { BLAST_RADIUS, CHAIN_RANGE, isOrdinary, type FishId } from './rules'
import { CAST, hitRadius, inHit } from './cast'
import type { Layout } from './field'

/*
  Who swims on the reef, and how. Every creature on the field is a Creature from a fixed pool (nothing is allocated
  while playing). Most follow a Path: a smooth Catmull-Rom curve that enters the field from outside one edge, wanders
  across in a gentle arc or S and leaves past another edge; a school shares one curve, each member offset to the side
  and trailing a little behind the leader, wobbling on its own. Formations reuse the same pieces: rows are schools on
  straight lines, a conga line is a long school on a looping curve, and a ring orbits a centre that drifts across.

  The Director keeps the reef lively and varied: it tops the crowd up to a target (schools of small fish, pairs of
  middling ones, big ones alone), lets a special in now and then (at most one of each kind on the field), sends the
  Golden Whale across every couple of minutes and a tide every minute or so (everything speeds off, then a formation
  arrives). It reports what it does through `onEvent` so the screen can show banners and play stings. None of it
  touches money: what a catch pays is decided only by rules.ts when a torpedo lands.

  Readability matters more than realism: each new group gets the path (of a few tried) that runs into the fewest
  creatures already swimming over the next several seconds, and creatures that still meet swerve apart, never
  closer than most of their room, so the player can see what a shot will hit.

  A creature caught in a hit is `held`: it stops swimming and the playback (moments.ts) drives how it looks until it
  is released. Units are reef units in the field's plane: x right, y up the screen, (0, 0) the field's centre.
*/

const TAU = Math.PI * 2
const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const irand = (a: number, b: number) => Math.floor(rand(a, b + 1))
/** the shortest turn from angle a to angle b */
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

/* ---------------- paths ---------------- */

/** samples along a path (48 steps: a whole number of steps for 1, 2, 3, 4, 6 or 8 segments) */
const STEPS = 48
/** control points a path can have */
const MAX_CTRL = 9

/** control point i's coordinate c of a k-point curve, the ends extended straight on */
function cp(ctrl: Float32Array, k: number, i: number, c: number) {
  if (i < 0) return 2 * ctrl[c] - ctrl[2 + c]
  if (i >= k) return 2 * ctrl[(k - 1) * 2 + c] - ctrl[(k - 2) * 2 + c]
  return ctrl[i * 2 + c]
}

/** coordinate c of a uniform Catmull-Rom curve, t of the way along segment s */
function spline(ctrl: Float32Array, k: number, s: number, c: number, t: number) {
  const p0 = cp(ctrl, k, s - 1, c)
  const p1 = cp(ctrl, k, s, c)
  const p2 = cp(ctrl, k, s + 1, c)
  const p3 = cp(ctrl, k, s + 2, c)
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
}

/** where a path puts a creature: its position and the unit tangent there */
export interface PathPoint {
  x: number
  y: number
  tx: number
  ty: number
}

/** a smooth curve through up to MAX_CTRL control points, sampled by arc length */
export class Path {
  private readonly px = new Float32Array(STEPS + 1)
  private readonly py = new Float32Array(STEPS + 1)
  private readonly at0 = new Float32Array(STEPS + 1)
  private n = 0
  private hint = 0
  /** its length in reef units */
  length = 0

  /** a Catmull-Rom curve through the first k points of ctrl (x, y pairs), the ends extended straight on */
  set(ctrl: Float32Array, k: number) {
    const seg = k - 1
    const per = Math.floor(STEPS / seg)
    let j = 0
    for (let s = 0; s < seg; s++)
      for (let q = 0; q < per || (s === seg - 1 && q === per); q++) {
        const t = q / per
        this.px[j] = spline(ctrl, k, s, 0, t)
        this.py[j] = spline(ctrl, k, s, 1, t)
        j++
      }
    this.n = j
    this.at0[0] = 0
    for (let i = 1; i < j; i++) this.at0[i] = this.at0[i - 1] + Math.hypot(this.px[i] - this.px[i - 1], this.py[i] - this.py[i - 1])
    this.length = this.at0[j - 1]
    this.hint = 0
    return this
  }

  /** the point s units along it (before the start and past the end it carries straight on) */
  at(s: number, out: PathPoint) {
    const n = this.n
    let i: number
    if (s <= 0) i = 0
    else if (s >= this.length) i = n - 2
    else {
      i = Math.min(this.hint, n - 2)
      while (i > 0 && this.at0[i] > s) i--
      while (i < n - 2 && this.at0[i + 1] < s) i++
      this.hint = i
    }
    const dx = this.px[i + 1] - this.px[i]
    const dy = this.py[i + 1] - this.py[i]
    const d = Math.hypot(dx, dy) || 1
    out.tx = dx / d
    out.ty = dy / d
    const u = (s - this.at0[i]) / d
    out.x = this.px[i] + dx * u
    out.y = this.py[i] + dy * u
    return out
  }
}

/* ---------------- creatures ---------------- */

export type Mode = 'swim' | 'flee' | 'held'

export interface Creature {
  /** unique for each creature that ever swam (a slot is reused, its uid is not) */
  uid: number
  id: FishId
  alive: boolean
  mode: Mode
  /** where it is in the field and which way it faces */
  x: number
  y: number
  heading: number
  /** +1 facing right, -1 left, easing through 0 as it turns */
  bank: number
  bankTo: number
  /** its swim clock (the shader's), and how fast it runs */
  clock: number
  rate: number
  /** along its path: distance, speed, side offset (and wobble) */
  path: Path
  s: number
  speed: number
  off: number
  wob: number
  /** a ring member: orbit radius (0: none), angle and spin */
  orbit: number
  theta: number
  spin: number
  /** seconds since it was spawned */
  age: number
  /** making room: how far it has swerved off its way for its neighbours (it drifts back once clear) */
  ax: number
  ay: number
  /** a flinch: a speed boost that fades, and a sideways shove (offset and velocity) that springs back */
  boost: number
  ox: number
  oy: number
  ovx: number
  ovy: number
  /** held: how many more seconds it swims on before it stops (a blast or a bolt hasn't reached it yet) */
  hold: number
  /** off its path (swept by a tide): it moves by its own velocity */
  free: boolean
  vx: number
  vy: number
  /** what it looks like this frame (the playback sets these while it is held) */
  pose: number
  flash: number
  mood: number
  roll: number
  scale: number
  lift: number
  fade: number
  /** a random phase, for its wobble and blinks */
  seed: number
  /** dev: the next hit on it catches */
  forced: boolean
  /** has it been on the field yet (once it has and is off again, it is on its way out) */
  seen: boolean
}

function blank(path: Path): Creature {
  return {
    uid: 0, id: 'clown', alive: false, mode: 'swim', x: 0, y: 0, heading: 0, bank: 1, bankTo: 1, clock: 0, rate: 1,
    path, s: 0, speed: 1, off: 0, wob: 0, orbit: 0, theta: 0, spin: 0, age: 0, ax: 0, ay: 0, boost: 0, ox: 0, oy: 0, ovx: 0, ovy: 0,
    hold: 0, free: false, vx: 0, vy: 0, pose: 0, flash: 0, mood: 0, roll: 0, scale: 1, lift: 0, fade: 0, seed: 0, forced: false, seen: false,
  }
}

/** how each species swims, and how the Director brings it in */
interface Habit {
  /** reef units a second */
  speed: number
  /** how many come together */
  group: [number, number]
  /** how often its group is picked to top the crowd up (specials and the whale come on their own schedule) */
  weight: number
  /** at most this many at once (the batch drawing it holds this many) */
  max: number
  /** how far its path may bend (× its length) */
  bend: number
}

const HABITS: Record<FishId, Habit> = {
  clown: { speed: 1.75, group: [3, 6], weight: 19, max: 36, bend: 0.22 },
  tang: { speed: 1.55, group: [3, 6], weight: 16, max: 30, bend: 0.2 },
  puffer: { speed: 0.95, group: [1, 3], weight: 12, max: 16, bend: 0.26 },
  angel: { speed: 0.9, group: [1, 2], weight: 11, max: 16, bend: 0.2 },
  seahorse: { speed: 0.7, group: [1, 2], weight: 8, max: 10, bend: 0.25 },
  turtle: { speed: 0.8, group: [1, 1], weight: 8, max: 4, bend: 0.16 },
  octopus: { speed: 1.05, group: [1, 1], weight: 7, max: 3, bend: 0.3 },
  manta: { speed: 1.1, group: [1, 1], weight: 6, max: 3, bend: 0.2 },
  shark: { speed: 1.2, group: [1, 1], weight: 4, max: 2, bend: 0.14 },
  whale: { speed: 1, group: [1, 1], weight: 0, max: 1, bend: 0.05 },
  crab: { speed: 0.85, group: [1, 1], weight: 0, max: 2, bend: 0.2 },
  jelly: { speed: 0.55, group: [1, 1], weight: 0, max: 2, bend: 0.25 },
  chest: { speed: 0.6, group: [1, 1], weight: 0, max: 2, bend: 0.12 },
}

/**
 * How much room each creature keeps round itself (reef units: most of its hit ellipse's mean radius, leaning towards
 * its long one), and how hard it is to shove.
 */
const ROOM = Object.fromEntries(
  Object.keys(HABITS).map((id) => {
    const { hit, size } = CAST[id as FishId]
    return [id, ((hit.a + hit.b) / 2 + Math.abs(hit.a - hit.b) * 0.2) * size * 0.95]
  }),
) as Record<FishId, number>
const MASS = Object.fromEntries(Object.keys(HABITS).map((id) => [id, CAST[id as FishId].size ** 2])) as Record<FishId, number>
/** the big ones (turtle and up) keep a wider berth from each other: two of them overlapping hide a lot of reef */
const BIG = Object.fromEntries(Object.keys(HABITS).map((id) => [id, CAST[id as FishId].size >= 1.8])) as Record<FishId, boolean>
/** creatures that meet are never closer than this share of their room (the soft swerve starts at all of it) */
const HARD = 0.88
/** paths tried for each new group; the one that runs into the fewest creatures wins */
const TRIES = 6

/** how much of a slant a creature's facing follows: the side-on fish face flatter than they move */
const TILT = Object.fromEntries(Object.keys(HABITS).map((id) => [id, CAST[id as FishId].view < 0.8 ? 0.55 : 1])) as Record<FishId, number>

/** the water round the cannon that creatures swerve out of (reef units from the middle of the bottom edge) */
const CANNON_ROOM = 1.7

/** the most of each species on the field at once: what the scene sizes each species' batch for */
export const CAPS: Record<FishId, number> = Object.fromEntries(Object.entries(HABITS).map(([k, h]) => [k, h.max])) as Record<FishId, number>
/** the creature pool */
const POOL = 80

const ORDINARY_GROUPS = (Object.keys(HABITS) as FishId[]).filter((id) => HABITS[id].weight > 0)

/* ---------------- the director's events ---------------- */

export type FormationName = 'ring' | 'rows' | 'conga' | 'arrow'
export type SpecialId = 'crab' | 'jelly' | 'chest'
const SPECIALS: readonly SpecialId[] = ['crab', 'jelly', 'chest']

export type SwimEvent =
  | { type: 'whale-incoming'; eta: number }
  | { type: 'whale-arrived' }
  | { type: 'whale-gone'; caught: boolean }
  | { type: 'tide'; dir: 1 | -1 }
  | { type: 'formation'; name: FormationName }

/** the Golden Whale crosses in about this many seconds */
const WHALE_CROSS = 20
/** the whale banner comes up this long before it enters */
const WHALE_WARN = 3.5
/** the tide's sweep lasts this long; its formation starts coming in behind the current after TIDE_FORM */
const TIDE_SWEEP = 1.9
const TIDE_FORM = 1.0

/* ---------------- the reef's population ---------------- */

const pt: PathPoint = { x: 0, y: 0, tx: 1, ty: 0 }
const other: PathPoint = { x: 0, y: 0, tx: 1, ty: 0 }
const ctrl = new Float32Array(MAX_CTRL * 2)
/** the best path found so far for a new group, and a path to try candidates on */
const best = new Float32Array(MAX_CTRL * 2)
const probe = new Path()
/** a shoal's members: (lag behind the leader, offset to the side) pairs */
const slots = new Float32Array(16 * 2)
/** where along its path a scattered group's leader starts (clearPath's second answer) */
const startAt = { s: 0 }

export class Swimmers {
  /** every slot; draw and test only the alive ones */
  readonly list: Creature[]
  onEvent?: (e: SwimEvent) => void
  /** how many creatures to keep on the field (the scene sets it from the layout and the device) */
  crowd = 30
  private layout: Layout
  private uid = 0
  private count: Record<FishId, number> = { clown: 0, tang: 0, puffer: 0, angel: 0, seahorse: 0, turtle: 0, octopus: 0, manta: 0, shark: 0, whale: 0, crab: 0, jelly: 0, chest: 0 }
  private alive = 0
  // the director's clocks (seconds)
  private nextGroup = 0
  private nextSpecial: Record<SpecialId, number> = { crab: rand(10, 25), jelly: rand(16, 32), chest: rand(28, 48) }
  private specialGap = 0
  private whaleIn = rand(60, 100)
  private whaleEta = -1
  private whale: Creature | null = null
  private whaleArrived = false
  /** creatures on the field or still on their way in (not those on their way out): what the crowd is kept to */
  private present = 0
  private tideIn = rand(55, 75)
  private tide = { on: false, t: 0, dir: 1 as 1 | -1, formed: false }
  private lastFormation: FormationName | null = null

  constructor(layout: Layout) {
    this.layout = layout
    this.list = Array.from({ length: POOL }, () => blank(new Path()))
  }

  /** is the whale on the field (the camera leans in) */
  get whaleOn() {
    return !!this.whale && this.whaleArrived && this.whale.mode !== 'held'
  }

  /** is a tide sweeping the reef right now */
  get tideOn() {
    return this.tide.on && this.tide.t < TIDE_SWEEP
  }

  /**
   * A new field: the ordinary creatures still swimming go (held ones finish their playback; fill() the field afresh
   * after), but the Golden Whale and the specials carry on across it from where they are, scaled into its bounds.
   */
  setLayout(layout: Layout) {
    const sx = layout.w / this.layout.w
    const sy = layout.h / this.layout.h
    this.layout = layout
    for (const c of this.list) {
      if (!c.alive || c.mode === 'held') continue
      if (c.mode === 'swim' && !isOrdinary(c.id)) this.carryOver(c, sx, sy)
      else if (c === this.whale && c.mode === 'swim') this.carryOver(c, sx, sy)
      else this.remove(c)
    }
  }

  /** a creature kept through a layout change: a fresh path from its spot (scaled) on out past the side it was heading for */
  private carryOver(c: Creature, sx: number, sy: number) {
    const { w, h } = this.layout
    const hw = w / 2
    const x = clamp(c.x * sx, -hw - 1, hw + 1)
    const y = clamp(c.y * sy, -h / 2 + 1.4, h / 2 - 0.8)
    const dir = Math.cos(c.heading) >= 0 ? 1 : -1
    const end = dir * (hw + hitRadius(c.id) + 0.5)
    ctrl.set([x, y, (x + end) / 2, y + rand(-0.3, 0.3), end, y + rand(-0.4, 0.4)])
    c.path.set(ctrl, 3)
    c.s = 0
    c.off = c.ax = c.ay = c.ox = c.oy = c.ovx = c.ovy = 0
    this.place(c)
  }

  /** fills the field at once, creatures scattered along their paths, so the reef is busy from the first frame */
  fill() {
    let guard = 0
    while (this.countPresent() < this.crowd * (this.whale ? 0.75 : 1) && guard++ < 40) this.group(this.pickGroup(), true)
  }

  /** how many are on the field or still on their way in */
  private countPresent() {
    let n = 0
    for (const c of this.list) if (c.alive && (this.onField(c, 0.3) || c.s <= 0)) n++
    return n
  }

  /* ---------------- spawning ---------------- */

  private take(id: FishId) {
    if (this.count[id] >= HABITS[id].max) return null
    let c: Creature | null = null
    for (const x of this.list)
      if (!x.alive) {
        c = x
        break
      }
    if (!c) return null
    Object.assign(c, blank(c.path))
    c.uid = ++this.uid
    c.id = id
    c.alive = true
    c.seed = Math.random() * 100
    c.clock = Math.random() * 10
    c.speed = HABITS[id].speed * rand(0.88, 1.12)
    this.count[id]++
    this.alive++
    return c
  }

  /** lets a creature go (it has left the field, or its catch has played out) */
  remove(c: Creature) {
    if (!c.alive) return
    c.alive = false
    this.count[c.id]--
    this.alive--
    if (c === this.whale) {
      this.whale = null
      this.whaleArrived = false
      this.whaleIn = rand(90, 150)
      this.onEvent?.({ type: 'whale-gone', caught: c.mode === 'held' })
    }
    const sp = c.id as SpecialId
    if (sp in this.nextSpecial) this.nextSpecial[sp] = sp === 'chest' ? rand(40, 70) : rand(22, 42)
  }

  private pickGroup(): FishId {
    let total = 0
    for (const id of ORDINARY_GROUPS) total += this.count[id] < HABITS[id].max ? HABITS[id].weight : 0
    let r = Math.random() * total
    for (const id of ORDINARY_GROUPS) {
      if (this.count[id] >= HABITS[id].max) continue
      r -= HABITS[id].weight
      if (r <= 0) return id
    }
    return 'clown'
  }

  /** a point just outside an edge (0 left, 1 right, 2 top, 3 bottom), written to ctrl[i] */
  private edgePoint(edge: number, margin: number, i: number) {
    const { w, h } = this.layout
    const hw = w / 2
    const hh = h / 2
    let x: number
    let y: number
    if (edge < 2) {
      x = (edge === 0 ? -1 : 1) * (hw + margin)
      y = rand(-hh + 1.5, hh - 0.6)
    } else if (edge === 2) {
      x = rand(-hw + 0.8, hw - 0.8)
      y = hh + margin
    } else {
      x = (Math.random() < 0.5 ? -1 : 1) * rand(2.9, hw - 0.5)
      y = -hh - margin
    }
    ctrl[i * 2] = x
    ctrl[i * 2 + 1] = y
  }

  /** a wandering path across the field for a creature of hit radius `rad`, into ctrl; returns its point count */
  private wander(id: FishId, rad: number) {
    const { w, h } = this.layout
    const hw = w / 2
    const hh = h / 2
    const margin = rad + 0.5
    // entry: the sides by their length, the top a little less, the bottom corners now and then (clear of the cannon)
    const bottom = hw - 0.5 > 3.4
    const ew = [h, h, w * 0.5, bottom ? w * 0.1 : 0]
    // the creatures are drawn side on, so they cross at a slant rather than diving down the screen (a tall field
    // allows a steeper slant, or they would cross its narrow width too soon)
    const slope = w < h ? 0.95 : 0.62
    for (let tries = 0; ; tries++) {
      let r = Math.random() * (ew[0] + ew[1] + ew[2] + ew[3])
      let entry = 0
      while (entry < 3 && r > ew[entry]) r -= ew[entry++]
      // exit: mostly across, sometimes out of the top or a bottom corner, never where it came in
      const xw = entry === 0 ? [0, 0.68, 0.22, 0.1] : entry === 1 ? [0.68, 0, 0.22, 0.1] : entry === 2 ? [0.5, 0.5, 0, 0] : [0.3, 0.3, 0.4, 0]
      if (!bottom) xw[3] = 0
      r = Math.random() * (xw[0] + xw[1] + xw[2] + xw[3])
      let exit = 0
      while (exit < 3 && r > xw[exit]) r -= xw[exit++]
      this.edgePoint(entry, margin, 0)
      this.edgePoint(exit, margin, 3)
      if (Math.abs(ctrl[7] - ctrl[1]) <= slope * Math.abs(ctrl[6] - ctrl[0]) || tries >= 12) break
    }
    const x0 = ctrl[0]
    const y0 = ctrl[1]
    const dx = ctrl[6] - x0
    const dy = ctrl[7] - y0
    const D = Math.hypot(dx, dy)
    const nx = -dy / D
    const ny = dx / D
    const bend = HABITS[id].bend
    const a1 = rand(-bend, bend)
    // an arc (both bends one way) or an S (opposite ways)
    const a2 = Math.random() < 0.5 ? a1 * rand(0.6, 1) : -a1 * rand(0.5, 1)
    for (const [i, t, a] of [[1, 0.33, a1], [2, 0.67, a2]] as const) {
      ctrl[i * 2] = clamp(x0 + dx * t + nx * D * a, -hw + 1, hw - 1)
      ctrl[i * 2 + 1] = clamp(y0 + dy * t + ny * D * a, -hh + 1.7, hh - 0.8)
    }
    return 4
  }

  /**
   * How much a group of `id` along `path`, its leader starting `s0` along it at `speed`, with its shoal trailing up to
   * `long` behind and `wide` to the side, would run into the creatures already swimming over the next eight seconds
   * (the sooner, the worse; 0: a clear run).
   */
  private clash(id: FishId, path: Path, s0: number, speed: number, long: number, wide: number) {
    const room = ROOM[id] + wide * 0.6
    let score = 0
    for (let k = 0; k <= 10; k++) {
      const t = k * 0.8
      const weight = Math.exp(-t / 5)
      for (let end = 0; end < 2; end++) {
        path.at(s0 + speed * t - end * long * 0.6, pt)
        for (let ci = 0; ci < this.list.length; ci++) {
          const c = this.list[ci]
          if (!c.alive || c.mode !== 'swim' || c.id === 'whale') continue
          // where it will be: along its own path (a ring member: about where it is now, plus its ring's drift)
          c.path.at(c.s + c.speed * t, other)
          const R = room + ROOM[c.id] * (BIG[id] && BIG[c.id] ? 1.25 : 1)
          const dx = pt.x - other.x - (c.orbit ? 0 : c.off * -other.ty)
          const dy = pt.y - other.y - (c.orbit ? 0 : c.off * other.tx)
          if (dx * dx + dy * dy < R * R) score += weight
        }
      }
    }
    return score
  }

  /**
   * A path across the field for a group of `id` (into ctrl, returning its point count): the one of TRIES wandering
   * paths that runs into the fewest creatures. `scatter` also picks where along it the leader starts (the first fill),
   * written to `start.s`.
   */
  private clearPath(id: FishId, rad: number, speed: number, long: number, wide: number, scatter: boolean, start: { s: number }) {
    let bestK = 0
    let bestScore = Infinity
    for (let i = 0; i < TRIES && bestScore > 0; i++) {
      const k = this.wander(id, rad)
      probe.set(ctrl, k)
      const s0 = scatter ? rand(0.05, 0.85) * probe.length : 0
      const score = this.clash(id, probe, s0, speed, long, wide)
      if (score < bestScore) {
        bestScore = score
        bestK = k
        best.set(ctrl)
        start.s = s0
      }
    }
    ctrl.set(best)
    return bestK
  }

  /** a group of one species along one wandering path; `scatter` drops it somewhere along the way (the first fill) */
  private group(id: FishId, scatter = false) {
    const [lo, hi] = HABITS[id].group
    const n = Math.min(irand(lo, hi), HABITS[id].max - this.count[id])
    if (n <= 0) return
    const rad = hitRadius(id)
    const size = CAST[id].size
    const long = size * Math.sqrt(n) * 1.25
    const wide = size * (0.5 + Math.sqrt(n) * 0.38)
    const lead = this.take(id)
    if (!lead) return
    const k = this.clearPath(id, rad, lead.speed, n > 1 ? long : 0, n > 1 ? wide : 0, scatter, startAt)
    lead.path.set(ctrl, k)
    const start = scatter ? startAt.s : 0
    lead.s = start
    const speed = lead.speed
    // members gather behind the leader in a loose shoal: a spot is taken only if it leaves a body length along the
    // way and most of a body's height across to every fish already placed
    slots[0] = 0
    slots[1] = 0
    let placed = 1
    for (let tries = 0; placed < n && tries < 60; tries++) {
      const lag = rand(0.9 * size, long)
      const off = rand(-wide, wide)
      let ok = true
      for (let j = 0; j < placed && ok; j++) ok = ((lag - slots[j * 2]) / (1.12 * size)) ** 2 + ((off - slots[j * 2 + 1]) / (0.78 * size)) ** 2 >= 1
      if (!ok) continue
      slots[placed * 2] = lag
      slots[placed * 2 + 1] = off
      placed++
    }
    for (let i = 1; i < placed; i++) {
      const c = this.take(id)
      if (!c) break
      c.path.set(ctrl, k)
      c.speed = speed
      c.s = start - slots[i * 2]
      c.off = slots[i * 2 + 1]
      c.wob = rand(0.04, 0.1)
    }
    this.place(lead)
  }

  /** a special (or the whale) on its own path; near = through the middle of the field, slowly (the dev force) */
  spawnSpecial(id: SpecialId | 'whale', near = false) {
    const c = this.take(id)
    if (!c) return null
    const { w, h } = this.layout
    const hw = w / 2
    const rad = hitRadius(id)
    if (id === 'whale' || near) {
      const dir = Math.random() < 0.5 ? 1 : -1
      const y = id === 'whale' ? rand(-0.05, 0.2) * h : rand(-0.05, 0.15) * h
      const m = rad + 0.4
      ctrl.set([-dir * (hw + m), y + rand(-0.4, 0.4), -dir * hw * 0.3, y + rand(-0.3, 0.3), dir * hw * 0.3, y + rand(-0.3, 0.3), dir * (hw + m), y + rand(-0.4, 0.4)])
      c.path.set(ctrl, 4)
      if (id === 'whale') {
        c.speed = c.path.length / WHALE_CROSS
        this.whale = c
      } else {
        c.speed *= 0.7
        // start just inside the edge so it is on the field at once
        c.s = c.path.length * 0.3
      }
    } else c.path.set(ctrl, this.clearPath(id, rad, c.speed, 0, 0, false, startAt))
    this.place(c)
    return c
  }

  /* ---------------- formations (after a tide) ---------------- */

  /** the formation that follows a tide: it starts coming in behind the current while the last stragglers go */
  private formation() {
    const names: FormationName[] = ['ring', 'rows', 'conga', 'arrow']
    let name = names[Math.floor(Math.random() * names.length)]
    if (name === this.lastFormation) name = names[(names.indexOf(name) + 1) % names.length]
    this.lastFormation = name
    const { w, h } = this.layout
    const hw = w / 2
    const dir = this.tide.dir
    if (name === 'ring') {
      // a carousel of small fish round a turtle, or round a zap jelly (a chain waiting to happen)
      const R = Math.min(w, h) * 0.27
      const y = h * 0.08
      const m = R + 0.8
      ctrl.set([-dir * (hw + m), y, dir * (hw + m), y])
      const hub = this.count.jelly === 0 && Math.random() < 0.4 ? this.take('jelly') : this.take('turtle')
      if (hub) {
        hub.path.set(ctrl, 2)
        hub.speed = 1.15
      }
      const n = w < 10 ? 10 : 14
      for (let i = 0; i < n; i++) {
        const c = this.take(i % 2 ? 'tang' : 'clown')
        if (!c) continue
        c.path.set(ctrl, 2)
        c.speed = 1.15
        c.orbit = R
        c.theta = (i / n) * TAU
        c.spin = 0.55 * dir
      }
    } else if (name === 'rows') {
      // three ranks marching across, the middle one the other way
      const rows: FishId[] = ['tang', 'clown', 'angel']
      rows.forEach((id, r) => {
        const y = h * (0.28 - r * 0.24)
        const d = r === 1 ? -dir : dir
        const m = 1
        ctrl.set([-d * (hw + m), y, d * (hw + m), y])
        const gap = CAST[id].size * 1.25
        const n = Math.min(Math.floor((w * 0.85) / gap), 9)
        for (let i = 0; i < n; i++) {
          const c = this.take(id)
          if (!c) continue
          c.path.set(ctrl, 2)
          c.speed = 1.6
          // the leaders are already a little way in, so the field is never long empty
          c.s = m + 1.6 - i * gap
          c.wob = 0.05
        }
      })
    } else if (name === 'conga') {
      // a long line looping the loop in the middle of the field
      const s = dir
      const P = [[-1.2 - hw, -0.12], [-0.55 * hw, -0.18], [0.1 * hw, -0.08], [0.3 * hw, 0.16], [0, 0.32], [-0.3 * hw, 0.16], [-0.1 * hw, -0.08], [0.55 * hw, -0.18], [1.2 + hw, -0.05]]
      P.forEach(([x, y], i) => {
        ctrl[i * 2] = s * x
        ctrl[i * 2 + 1] = y * h
      })
      const ids: FishId[] = ['clown', 'clown', 'tang', 'clown', 'puffer', 'tang', 'clown', 'tang', 'clown', 'puffer', 'clown', 'tang', 'clown', 'tang', 'puffer', 'clown']
      const n = w < 10 ? 12 : 16
      for (let i = 0; i < n; i++) {
        const c = this.take(ids[i])
        if (!c) continue
        c.path.set(ctrl, 9)
        c.speed = 1.9
        c.s = 4.2 - i * 1.2
        c.wob = 0.04
      }
    } else {
      // a flight of angelfish in a V, a manta at its point
      const y = h * rand(-0.02, 0.18)
      ctrl.set([-dir * (hw + 1.6), y, dir * (hw + 2.4), y + rand(-0.6, 0.6)])
      const lead = this.take('manta')
      if (lead) {
        lead.path.set(ctrl, 2)
        lead.speed = 1.3
        lead.s = 2.4
      }
      const n = w < 10 ? 6 : 8
      for (let i = 0; i < n; i++) {
        const c = this.take('angel')
        if (!c) continue
        const rank = Math.floor(i / 2) + 1
        c.path.set(ctrl, 2)
        c.speed = 1.3
        c.s = 2.4 - rank * 1.25
        c.off = (i % 2 ? 1 : -1) * rank * 0.95
      }
    }
    this.onEvent?.({ type: 'formation', name })
  }

  /* ---------------- the director ---------------- */

  /** dev: the whale right now (its banner, then in it comes) */
  whaleNow() {
    if (this.whale || this.whaleEta >= 0) return
    this.whaleIn = 0
  }

  /** dev: a tide right now */
  tideNow() {
    if (!this.tide.on) this.tideIn = 0
  }

  private startTide() {
    const dir = Math.random() < 0.5 ? 1 : -1
    this.tide = { on: true, t: 0, dir, formed: false }
    for (let ci = 0; ci < this.list.length; ci++) {
      const c = this.list[ci]
      if (!c.alive || c.mode !== 'swim') continue
      c.mode = 'flee'
      c.free = true
      // carry on the way it was going, then the current takes it
      c.vx = Math.cos(c.heading) * c.speed
      c.vy = Math.sin(c.heading) * c.speed
    }
    this.onEvent?.({ type: 'tide', dir })
  }

  private direct(dt: number) {
    const L = this.layout
    // the whale: a banner, then it comes
    if (!this.whale && this.whaleEta < 0) {
      this.whaleIn -= this.tide.on ? 0 : dt
      if (this.whaleIn <= 0) {
        this.whaleEta = WHALE_WARN
        this.onEvent?.({ type: 'whale-incoming', eta: WHALE_WARN })
      }
    } else if (this.whaleEta >= 0) {
      this.whaleEta -= dt
      if (this.whaleEta < 0) {
        this.whaleEta = -1
        if (!this.spawnSpecial('whale')) this.whaleIn = 20
      }
    }
    // the whale is in when it is well onto the field
    const wh = this.whale
    if (wh && !this.whaleArrived && Math.abs(wh.x) < L.w / 2 - 1) {
      this.whaleArrived = true
      this.onEvent?.({ type: 'whale-arrived' })
    }
    // the tide: not while the whale is about
    if (!this.tide.on) {
      if (!this.whale && this.whaleEta < 0) this.tideIn -= dt
      if (this.tideIn <= 0) this.startTide()
    } else {
      this.tide.t += dt
      if (!this.tide.formed && this.tide.t > TIDE_FORM) {
        this.tide.formed = true
        this.formation()
      }
      if (this.tide.t > TIDE_SWEEP + 4) {
        this.tide.on = false
        this.tideIn = rand(60, 80)
        this.nextGroup = 0
      }
    }
    if (this.tide.on) return
    // specials: one of a kind at a time, a few seconds apart
    this.specialGap -= dt
    for (let si = 0; si < SPECIALS.length; si++) {
      const id = SPECIALS[si]
      if (this.count[id] > 0) continue
      this.nextSpecial[id] -= dt
      if (this.nextSpecial[id] <= 0 && this.specialGap <= 0) {
        this.spawnSpecial(id)
        this.specialGap = 6
      }
    }
    // top the crowd up (a little less while the whale takes up the room), quicker the emptier it is
    this.nextGroup -= dt
    const want = this.crowd * (this.whale ? 0.75 : 1)
    if (this.nextGroup <= 0 && this.present < want) {
      this.group(this.pickGroup())
      this.nextGroup = rand(0.4, 1.1) * (this.present < want * 0.75 ? 0.45 : 1)
    }
  }

  /* ---------------- moving ---------------- */

  /** where a path-following creature is now (no change to its state but x, y) */
  private place(c: Creature) {
    c.path.at(c.s, pt)
    let x = pt.x - pt.ty * c.off
    let y = pt.y + pt.tx * c.off
    if (c.orbit) {
      x += Math.cos(c.theta) * c.orbit
      y += Math.sin(c.theta) * c.orbit
    }
    if (c.wob) {
      const w = Math.sin(c.age * 1.7 + c.seed) * c.wob
      x -= pt.ty * w
      y += pt.tx * w
    }
    c.x = x + c.ox + c.ax
    c.y = y + c.oy + c.ay
    if (c.age === 0) {
      // facing its way from the start, flank and all
      c.heading = Math.atan2(pt.ty, pt.tx)
      c.bank = c.bankTo = pt.tx < 0 ? -1 : 1
    }
  }

  update(dt: number) {
    this.direct(dt)
    const { w, h } = this.layout
    const tideDir = this.tide.dir
    let present = 0
    for (let ci = 0; ci < this.list.length; ci++) {
      const c = this.list[ci]
      if (!c.alive) continue
      const on = this.onField(c, 0.3)
      if (on) c.seen = true
      if (on || !c.seen) present++
      const px = c.x
      const py = c.y
      const id = c.id
      // what its own way of swimming does to its speed and pose
      let pace = 1
      let rest = 0
      if (id === 'octopus') {
        // jets: squeeze, then shoot forward
        rest = Math.max(0, Math.sin(c.clock * 1.5)) ** 3
        pace = 0.35 + 1.7 * rest
      } else if (id === 'jelly') pace = 0.45 + 1.1 * Math.max(0, Math.sin(c.clock * CAST.jelly.beat[0])) ** 2
      if (c.mode !== 'held') {
        // a flinch wears off: the flash fast, a puffed puffer slowly
        c.flash *= Math.exp(-dt * 9)
        c.pose = Math.max(rest, c.pose * Math.exp(-dt * (id === 'octopus' ? 4 : 1.4)))
      }
      c.age += dt
      c.boost = Math.max(0, c.boost - dt * 1.4)
      // the flinch shove springs back
      c.ovx += (-c.ox * 30 - c.ovx * 9) * dt
      c.ovy += (-c.oy * 30 - c.ovy * 9) * dt
      c.ox += c.ovx * dt
      c.oy += c.ovy * dt
      const back = Math.exp(-dt * 0.8)
      c.ax *= back
      c.ay *= back
      if (c.mode === 'swim') {
        c.s += c.speed * pace * (1 + c.boost * 1.6) * dt
        c.theta += c.spin * dt
        this.place(c)
        c.rate = 0.8 + 0.2 * pace + c.boost * 1.5
        if (c.s > c.path.length + 0.3 || c.age > 120) {
          this.remove(c)
          continue
        }
      } else if (c.mode === 'flee') {
        // the current: it builds up behind them and sweeps everything off the side
        const k = Math.min(1, dt * 1.6)
        c.vx = lerp(c.vx, tideDir * 6.5, k)
        c.vy *= 1 - k * 0.5
        c.x += c.vx * dt
        c.y += c.vy * dt
        c.rate = 2.6
        const out = hitRadius(id) + 0.6
        if (Math.abs(c.x) > w / 2 + out || Math.abs(c.y) > h / 2 + out) {
          this.remove(c)
          continue
        }
      } else if (c.hold > 0) {
        // held, but what caught it hasn't reached it yet: it swims on unawares
        c.hold -= dt
        if (c.free) {
          c.x += c.vx * dt
          c.y += c.vy * dt
        } else {
          c.s += c.speed * pace * dt
          this.place(c)
        }
      } else if (c.free) {
        // held while the tide had it: it coasts to a stop
        const k = Math.exp(-dt * 7)
        c.vx *= k
        c.vy *= k
        c.x += c.vx * dt
        c.y += c.vy * dt
      } else {
        // held: it slows to a stop where it was netted, still nudged by its shove
        c.speed *= Math.exp(-dt * 7)
        c.s += c.speed * dt
        this.place(c)
      }
      c.clock += dt * c.rate
      // face the way it moves (smoothly), and roll through 0 as it turns round
      const vx = c.x - px
      const vy = c.y - py
      if (vx * vx + vy * vy > 1e-8 && c.mode !== 'held') c.heading += turn(c.heading, Math.atan2(vy * TILT[id], vx)) * Math.min(1, dt * 7)
      const cx = Math.cos(c.heading)
      if (cx > 0.2) c.bankTo = 1
      else if (cx < -0.2) c.bankTo = -1
      const db = c.bankTo - c.bank
      c.bank += Math.sign(db) * Math.min(Math.abs(db), dt * 2.6)
    }
    this.present = present
    this.makeRoom(dt)
  }

  /**
   * Creatures that overlap swerve apart (the bigger one gives way less) and drift back to their way once they have
   * passed, so shoals crossing stay readable; any that still close in are shoved apart outright at HARD of their
   * room. The whale glides deep under everything.
   */
  private makeRoom(dt: number) {
    const L = this.list
    const cy = -this.layout.h / 2
    for (let i = 0; i < L.length; i++) {
      const a = L[i]
      if (!a.alive || a.mode !== 'swim' || a.id === 'whale') continue
      const ra = ROOM[a.id]
      // swerving round the cannon, so nothing hides it or swims down its barrel
      const ex = a.x
      const ey = a.y - cy
      const er = ra + CANNON_ROOM
      if (ex * ex + ey * ey < er * er) {
        const d = Math.hypot(ex, ey) || 1
        const f = ((er - d) / er) * 4 * dt
        a.ax += (ex / d) * f
        a.ay += (ey / d) * f
      }
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j]
        if (!b.alive || b.mode !== 'swim' || b.id === 'whale') continue
        const R = (ra + ROOM[b.id]) * (BIG[a.id] && BIG[b.id] ? 1.25 : 1)
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= R * R || d2 < 1e-6) continue
        const d = Math.sqrt(d2)
        const ma = MASS[a.id]
        const mb = MASS[b.id]
        // the swerve, plus the shove that keeps them at least HARD × R apart
        const f = ((R - d) / R) * 4.5 * dt + Math.max(0, HARD * R - d)
        const ka = ((f / d) * mb) / (ma + mb)
        const kb = ((f / d) * ma) / (ma + mb)
        a.ax -= dx * ka
        a.ay -= dy * ka
        a.x -= dx * ka
        a.y -= dy * ka
        b.ax += dx * kb
        b.ay += dy * kb
        b.x += dx * kb
        b.y += dy * kb
      }
    }
  }

  /* ---------------- questions the scene asks ---------------- */

  /** is a creature on the field (its middle inside, give or take `pad`) */
  onField(c: Creature, pad = 0.2) {
    const { w, h } = this.layout
    return Math.abs(c.x) < w / 2 + pad && Math.abs(c.y) < h / 2 + pad
  }

  /**
   * The creature a torpedo of radius r at (px, py) touches: the one nearest its middle if it touches several. Only
   * `only` when given (a locked torpedo). Creatures being caught can't be hit again.
   */
  touching(px: number, py: number, r: number, only: Creature | null = null): Creature | null {
    let best: Creature | null = null
    let bestD = Infinity
    for (let ci = 0; ci < this.list.length; ci++) {
      const c = this.list[ci]
      if (!c.alive || c.mode === 'held' || (only && c !== only)) continue
      const dx = px - c.x
      const dy = py - c.y
      const d = dx * dx + dy * dy
      const reach = hitRadius(c.id, c.scale) + r
      if (d > reach * reach || d >= bestD) continue
      if (!inHit(c.id, c.x, c.y, c.heading, c.bank, c.scale, px, py, r)) continue
      best = c
      bestD = d
    }
    return best
  }

  /**
   * The ordinary creatures a bomb blast (BLAST_RADIUS) or a lightning chain (CHAIN_RANGE) from `from` reaches, nearest
   * first, into `out`: any part of them inside the circle, their middle on the field, not already being caught.
   */
  reach(from: Creature, kind: 'bomb' | 'chain', out: Creature[]) {
    out.length = 0
    const R = kind === 'bomb' ? BLAST_RADIUS : CHAIN_RANGE
    for (let ci = 0; ci < this.list.length; ci++) {
      const c = this.list[ci]
      if (!c.alive || c === from || c.mode === 'held' || !isOrdinary(c.id) || !this.onField(c)) continue
      if (inHit(c.id, c.x, c.y, c.heading, c.bank, c.scale, from.x, from.y, R)) out.push(c)
    }
    out.sort((a, b) => (a.x - from.x) ** 2 + (a.y - from.y) ** 2 - ((b.x - from.x) ** 2 + (b.y - from.y) ** 2))
    return out
  }
}
