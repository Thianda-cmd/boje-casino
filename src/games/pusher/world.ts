import { BACK_Z, COIN_H, COIN_R, FIELD_W, FRONT_Z, GUTTER_Z0, LOWER_PUSH_MIN, PRIZE_SIZE, TRAY, UPPER_FRONT_Z, UPPER_PUSH_MIN, UPPER_Y } from './geom'
import type { ItemKind } from './types'

/*
  Coin Cascade's physics: the coins and prizes on the machine's two tiers, the pushers, the walls, the edges, the
  win tray and the gutters, stepped once a frame. No three.js and no React, so the simulation (sim.ts), the field
  (field.ts), the tests and the dev lab all run the same code, in the browser or in Node.

  It is a position-based simulation on a "two and a half D" model, which is what a coin pusher really is: things slide
  about on flat floors and pile up a little. Every body has a footprint on the floor (a disc for a coin, a box turned
  by its yaw for a prize), a height, and a bottom (y, measured under its centre). Each step moves everything by its
  velocity (friction bleeding the velocity away toward whatever it rests on, so coins riding the plate or another coin
  go along with it), then pushes overlapping bodies apart a few times over, together with the pushers (moving walls
  that never give), the walls, the shelf's front and the edge rules, and takes the new velocities from how far things
  actually moved. Boxes turn when they are pushed off centre; coins spin a little as they rub.

  Resting and piling up. Two bodies push each other sideways only when they overlap in height; one whose bottom is at
  or above another's top rests on it instead. A body rests on whatever is highest under its centre (its tier's floor,
  the lower pusher's plate, the coins below it); when the highest thing under its footprint is not under its centre,
  it leans: one side on that body's rim, the underside sloping down until it meets the floor or the next thing under
  that side, tilted (a coin propped on a coin, a prize on the coin bed), and it is clear of whatever its sloping
  underside passes over. A coin squeezed too hard to fit (the pusher shoving a row into the row in front) rides up onto
  a neighbour lying on the floor: that is how the second layer forms. Piles don't grow tall: a coin leaning steeply
  slides down its slope, and one on top of three others slides off. The upper tier's lip holds things back a little
  until they are pressed hard (so that tier fills up before it spills onto the lower one).

  The edges. A body whose centre passes the edge of what holds it tips over that edge (turning about it as it slides
  on, quickly for a coin, a prize sliding off more than it turns) and then falls, tumbling, until it lands on its
  lowest edge on whatever is below: the lower tier from the upper tier's lip, the floor from the lower pusher's plate,
  the tray from the front edge, out of sight down a gutter from the open sides at the front. A body landing still
  turned stands on that edge and settles flat. The front edge is where the payout is, so it has a rule: an invisible
  lip holds every body's centre a little behind it (a coin may hang over it by a third of itself, a prize sits further
  back) unless the simulation has let that one body go (Body.goAt: the drawn result's items, each from its moment), so
  nothing else ever goes over. The open sides hold every prize and every coin not allowed to fall there
  (Body.gutterOk).

  World units are geom.ts's (a coin's radius is 0.5); time is seconds. The pushers' positions are set from outside
  each step (World.step's zU and zL): the simulation runs them.
*/

/** the lower pusher is a plate this tall: things that fall onto it ride it until the shelf's front scrapes them off */
export const LOWER_TOP = 0.9
/** the upper pusher block's height above the upper tier (only the scene needs it: nothing goes on top) */
export const UPPER_PUSH_H = 1.1
/** gravity, units / s² (a coin's radius is about a centimetre: real gravity, a little slowed for the eye) */
export const G = 140
/** how far behind the front edge the lip holds a body's centre: a coin, a prize */
export const LIP = 0.16
export const LIP_PRIZE = 0.55
/** how far inside the open sides the side lip holds a body's centre */
export const SIDE_LIP = 0.08
/** below this a gutter's coin is out of sight */
export const GUTTER_GONE_Y = -2.6
const HALF_W = FIELD_W / 2

/** what a body is doing */
export const REST = 0 // on a floor or on other bodies (sliding, pushed, at rest)
export const AIR = 1 // falling
export const TIP = 2 // turning over an edge, about to fall
export const GONE = 3 // out of the machine (down a gutter)
/** where it is (and ends up) */
export const ON_FIELD = 0
export const IN_TRAY = 1
export const IN_GUTTER = 2

/** how heavy things are (an inverse mass: a coin is 1) */
const INV_MASS: Record<ItemKind, number> = { silver: 1, gold: 1, gem: 0.45, bar: 0.25, idol: 0.3, crown: 0.28 }
/** how quickly sliding stops, 1/s */
const FRICTION_COIN = 7
const FRICTION_PRIZE = 10
const SPIN_DAMP = 4
/** heights closer than this count as resting on (not beside) */
const BAND_EPS = 0.025
/** a body can rest on another whose top is up to this far above its bottom */
const CLIMB_EPS = 0.03
/** squeezed this far into a neighbour, a coin rides up onto it */
const CLIMB_PEN = 0.05
/** how far a leaning coin that is still squeezed rides up onto what it leans on, a step */
const MOUNT_STEP = 0.07
/** the fastest a resting body slides, units / s (a big correction must not fling it) */
const V_REST = 4
/** a resting body leaning more steeply than this slides down its slope, pulled this hard (units / s² per unit of slope) */
const SLIDE_SLOPE = 0.3
const SLIDE_PULL = 40
/** how far behind the upper tier's lip a body's centre is held until it is pressed this hard (then it goes over) */
const UPPER_LIP = 0.12
const SPILL = 0.03
/** how far a coin on top of a pile three high slides off it each step */
const SLUMP_STEP = 0.04
/** solver passes per step */
const ITERS = 6
/** how fast a resting body's tilt follows its lean, 1/s */
const TILT_RATE = 30

const TRAY_X = TRAY.w / 2
const TRAY_Z0 = TRAY.z - TRAY.d / 2
const TRAY_Z1 = TRAY.z + TRAY.d / 2

export interface Shape {
  coin: boolean
  /** half extents of the footprint in the body's own frame (a coin: its radius both ways) */
  hw: number
  hd: number
  h: number
  /** the footprint's radius (a coin) or bounding radius (a box) */
  r: number
}

export function shapeOf(kind: ItemKind): Shape {
  if (kind === 'silver' || kind === 'gold') return { coin: true, hw: COIN_R, hd: COIN_R, h: COIN_H, r: COIN_R }
  const s = PRIZE_SIZE[kind]
  return { coin: false, hw: s.w / 2, hd: s.d / 2, h: s.h, r: Math.hypot(s.w, s.d) / 2 }
}

export class Body {
  readonly id: number
  readonly kind: ItemKind
  readonly coin: boolean
  readonly hw: number
  readonly hd: number
  readonly h: number
  readonly r: number
  readonly im: number
  /** inverse moment of inertia about the vertical (boxes; coins don't turn by contact) */
  readonly ii: number
  /** index in World.bodies */
  i = 0
  // pose: x, z the footprint's centre; y the bottom under the centre; yaw about the vertical
  x = 0
  y = 0
  z = 0
  yaw = 0
  // where it was at the start of the step (for the velocities)
  ox = 0
  oz = 0
  oy = 0
  oyaw = 0
  vx = 0
  vy = 0
  vz = 0
  wy = 0
  /** its bottom for telling what it is beside from what it is on (lvl, kept for the step: the passes read it a lot) */
  yb = 0
  /** its lean: its underside slopes down this steeply along (leanUx, leanUz) from its centre (0 lying flat) */
  leanUx = 0
  leanUz = 0
  leanSlope = 0
  /** shown tilt about x and z: whole flips (a coin face down) plus its lean */
  tx = 0
  tz = 0
  flipX = 0
  flipZ = 0
  leanX = 0
  leanZ = 0
  /** tumbling rates while falling */
  wtx = 0
  wtz = 0
  state = REST
  fate = ON_FIELD
  /** the body it leans on (no sideways contact with it), and the one it rides (whose motion carries it) */
  sup: Body | null = null
  ride: Body | null = null
  onPlate = false
  /** half extents along world x and z (boxes: from the yaw) */
  ex = 0
  ez = 0
  /** the front lip lets it over from this time on (the result's items); Infinity for everything else */
  goAt = Infinity
  /** a coin that may slide off the open sides */
  gutterOk = false
  /** pressed hard at the upper tier's lip: it goes over */
  spill = false
  /** the simulation's push toward the edge for a planned body: a forward speed it keeps up at least, and sideways */
  steerZ = 0
  steerX = 0
  /**
    A chosen body that has made no headway for a while rides up over the bed: it rests on whatever it is over and
    passes over everything not chosen (a last resort that keeps the result exact; it is seldom needed)
  */
  rideOver = false
  stuckT = 0
  stuckZ = 0
  /** a prize in its way that it is going round, and which way */
  dodge: Body | null = null
  dodgeSide = 1
  /** set by the solver: how hard it is squeezed (the deepest overlap left after the passes) */
  squeeze = 0
  squeezeBy: Body | null = null
  // the support pass's working values
  cover = 0
  coverBody: Body | null = null
  leanTop = 0
  leanBody: Body | null = null
  // tipping over an edge: about an axis along x (front edge, lip) or along z (the sides)
  tipAxisX = true
  tipSign = 1
  tipPy = 0
  tipPq = 0
  tipU = 0
  tipV = 0
  tipAng = 0
  tipW = 0
  tipAcc = 0
  tipStop = 0
  tipSlide = 0
  tipT0 = 0
  tipX0 = 0
  tipZ0 = 0
  /** where its fall started (for the landing's size) and where a body bound for the tray is aimed */
  fallY = 0
  aimX = 0
  aimZ = 0
  /** it is tipping off the front of the lower pusher's plate */
  tipPlate = false
  /** it has landed in the tray (the tray moment is told once, whatever it does after) */
  trayed = false

  constructor(id: number, kind: ItemKind) {
    const s = shapeOf(kind)
    this.id = id
    this.kind = kind
    this.coin = s.coin
    this.hw = s.hw
    this.hd = s.hd
    this.h = s.h
    this.r = s.r
    this.im = INV_MASS[kind]
    this.ii = s.coin ? 0 : (12 * this.im) / (4 * s.hw * s.hw + 4 * s.hd * s.hd)
    this.ex = s.hw
    this.ez = s.hd
  }

  get top() {
    return this.y + this.h
  }
  /** how far a falling body's lowest edge hangs below its bottom, tilted as it is (it lands when that edge touches down) */
  get dip() {
    const unit = this.coin ? Math.PI : Math.PI * 2
    const dx = this.tx - Math.round(this.tx / unit) * unit
    const dz = this.tz - Math.round(this.tz / unit) * unit
    const a = Math.min(1.5, Math.sqrt(dx * dx + dz * dz))
    return this.r * Math.sin(a) - (this.h / 2) * (1 - Math.cos(a))
  }
  /** the centre's height */
  get cy() {
    return this.y + this.h / 2
  }
  /**
    The centre's height as shown: a resting body still turning flat after a landing (its shown tilt not yet its lean)
    stands on its edge, so its centre is lifted by as much as that tilt raises it.
  */
  get shownY() {
    if (this.state !== REST) return this.y + this.h / 2
    const dx = this.tx - this.flipX - this.leanX
    const dz = this.tz - this.flipZ - this.leanZ
    const a = Math.min(1.5, Math.sqrt(dx * dx + dz * dz))
    if (a < 1e-3) return this.y + this.h / 2
    // (a box tilts onto a corner: its bounding radius)
    return this.y + this.r * Math.sin(a) + (this.h / 2) * Math.cos(a)
  }
  /** its height for telling the tiers apart: a falling body counts from where it was at the start of the step */
  get lvl() {
    return this.state === AIR ? Math.max(this.y, this.oy) : this.y
  }
  /** a body on the upper tier (or hanging over its lip; falling, only while its centre is still over the tier) */
  get upper() {
    return this.lvl > UPPER_Y - 0.3 && (this.state === AIR ? this.z < UPPER_FRONT_Z : this.z - this.ez < UPPER_FRONT_Z)
  }
  extents() {
    if (this.coin) return
    const c = Math.abs(Math.cos(this.yaw))
    const s = Math.abs(Math.sin(this.yaw))
    this.ex = this.hw * c + this.hd * s
    this.ez = this.hw * s + this.hd * c
  }
}

export type WorldEvent = 'land' | 'edge' | 'tray' | 'gutter'

/* ---------------- footprints ---------------- */

/** whether point (px, pz) is inside body b's footprint, shrunk by m */
function covers(b: Body, px: number, pz: number, m: number) {
  const dx = px - b.x
  const dz = pz - b.z
  if (b.coin) return dx * dx + dz * dz < (b.r - m) * (b.r - m)
  const c = Math.cos(b.yaw)
  const s = Math.sin(b.yaw)
  return Math.abs(dx * c - dz * s) < b.hw - m && Math.abs(dx * s + dz * c) < b.hd - m
}

/** the distance from (px, pz) to the edge of b's footprint (0 inside) */
function distTo(b: Body, px: number, pz: number) {
  const dx = px - b.x
  const dz = pz - b.z
  if (b.coin) return Math.max(0, Math.sqrt(dx * dx + dz * dz) - b.r)
  const c = Math.cos(b.yaw)
  const s = Math.sin(b.yaw)
  const lx = Math.max(0, Math.abs(dx * c - dz * s) - b.hw)
  const lz = Math.max(0, Math.abs(dx * s + dz * c) - b.hd)
  return Math.sqrt(lx * lx + lz * lz)
}

/** how far body b's footprint reaches from its centre along unit (ux, uz) */
function reach(b: Body, ux: number, uz: number) {
  if (b.coin) return b.r
  const c = Math.cos(b.yaw)
  const s = Math.sin(b.yaw)
  return b.hw * Math.abs(ux * c - uz * s) + b.hd * Math.abs(ux * s + uz * c)
}

/* the overlap of two footprints: depth along normal (nx, nz) from a to b, and for a box the contact point; 0 when apart */
let nx = 0
let nz = 0
let cpx = 0
let cpz = 0

function overlapCoins(a: Body, b: Body) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const rr = a.r + b.r
  const d2 = dx * dx + dz * dz
  if (d2 >= rr * rr) return 0
  const d = Math.sqrt(d2)
  if (d < 1e-6) {
    // dead on top of each other: part them along a direction fixed by their ids
    const t = ((a.id * 7919 + b.id * 104729) % 628) / 100
    nx = Math.cos(t)
    nz = Math.sin(t)
  } else {
    nx = dx / d
    nz = dz / d
  }
  return rr - d
}

/** coin c against box p; the normal points from the box to the coin, the contact point is on the box */
function overlapCoinBox(c: Body, p: Body) {
  const dx = c.x - p.x
  const dz = c.z - p.z
  if (dx * dx + dz * dz >= (c.r + p.r) * (c.r + p.r)) return 0
  const cs = Math.cos(p.yaw)
  const sn = Math.sin(p.yaw)
  const lx = dx * cs - dz * sn
  const lz = dx * sn + dz * cs
  let qx = Math.max(-p.hw, Math.min(p.hw, lx))
  let qz = Math.max(-p.hd, Math.min(p.hd, lz))
  let lnx = 0
  let lnz = 0
  let pen = 0
  if (qx === lx && qz === lz) {
    // the coin's centre is inside the box: out through the nearest side
    const px = p.hw - Math.abs(lx)
    const pz = p.hd - Math.abs(lz)
    if (px < pz) {
      lnx = lx < 0 ? -1 : 1
      qx = lnx * p.hw
      pen = px + c.r
    } else {
      lnz = lz < 0 ? -1 : 1
      qz = lnz * p.hd
      pen = pz + c.r
    }
  } else {
    const ddx = lx - qx
    const ddz = lz - qz
    const d2 = ddx * ddx + ddz * ddz
    if (d2 >= c.r * c.r) return 0
    const d = Math.sqrt(d2)
    lnx = ddx / d
    lnz = ddz / d
    pen = c.r - d
  }
  nx = lnx * cs + lnz * sn
  nz = -lnx * sn + lnz * cs
  cpx = p.x + qx * cs + qz * sn
  cpz = p.z - qx * sn + qz * cs
  return pen
}

/** box against box (separating axes); the normal points from a to b */
function overlapBoxes(a: Body, b: Body) {
  const dx = b.x - a.x
  const dz = b.z - a.z
  if (dx * dx + dz * dz >= (a.r + b.r) * (a.r + b.r)) return 0
  const ca = Math.cos(a.yaw)
  const sa = Math.sin(a.yaw)
  const cb = Math.cos(b.yaw)
  const sb = Math.sin(b.yaw)
  // the four axes: each box's local x (cos, -sin) and z (sin, cos)
  const ax = [ca, sa, cb, sb]
  const az = [-sa, ca, -sb, cb]
  let best = Infinity
  let bx = 0
  let bz = 0
  for (let k = 0; k < 4; k++) {
    const ux = ax[k]
    const uz = az[k]
    const ra = a.hw * Math.abs(ux * ca - uz * sa) + a.hd * Math.abs(ux * sa + uz * ca)
    const rb = b.hw * Math.abs(ux * cb - uz * sb) + b.hd * Math.abs(ux * sb + uz * cb)
    const s = dx * ux + dz * uz
    const o = ra + rb - Math.abs(s)
    if (o <= 0) return 0
    if (o < best) {
      best = o
      bx = s < 0 ? -ux : ux
      bz = s < 0 ? -uz : uz
    }
  }
  nx = bx
  nz = bz
  return best
}

/**
  Whether two bodies are clear of each other in height, so they can't push each other sideways: one is above the
  other (resting on it), or a leaning one's sloping underside passes over the other. A falling body counts from where
  it was at the start of the step, so it lands on what it falls onto rather than being shoved aside by it.
*/
function clearV(a: Body, b: Body) {
  // a chosen body that has had to ride up over the bed passes over everything not chosen
  if ((a.rideOver && b.goAt === Infinity) || (b.rideOver && a.goAt === Infinity)) return true
  const ay = a.yb
  const by = b.yb
  if (a.leanSlope === 0 && b.leanSlope === 0) return Math.min(ay + a.h, by + b.h) - Math.max(ay, by) <= BAND_EPS
  span(a, ay, b)
  const alo = lo
  const ahi = hi
  span(b, by, a)
  return Math.min(ahi, hi) - Math.max(alo, lo) <= BAND_EPS
}

/** how low and how high body a (its bottom at y under its centre) reaches over the part of it where k is: into lo, hi */
let lo = 0
let hi = 0
function span(a: Body, y: number, k: Body) {
  if (a.leanSlope === 0) {
    lo = y
    hi = y + a.h
    return
  }
  // along its lean the underside drops by leanSlope per unit: lowest at k's far side, highest at k's near side
  const ux = a.leanUx
  const uz = a.leanUz
  const ra = reach(a, ux, uz)
  const pk = (k.x - a.x) * ux + (k.z - a.z) * uz
  const rk = reach(k, ux, uz)
  lo = y - a.leanSlope * Math.min(ra, pk + rk)
  hi = y + a.h - a.leanSlope * Math.max(-ra, pk - rk)
}

/** the height of body a's top surface over the point (px, pz) (a leaning body's slopes with it) */
function topAt(a: Body, px: number, pz: number) {
  if (a.leanSlope === 0) return a.y + a.h
  return a.y + a.h - a.leanSlope * ((px - a.x) * a.leanUx + (pz - a.z) * a.leanUz)
}

/** the footprints' overlap whatever the shapes, normal from a to b */
function overlap(a: Body, b: Body) {
  if (a.coin && b.coin) return overlapCoins(a, b)
  if (a.coin) {
    const p = overlapCoinBox(a, b)
    nx = -nx
    nz = -nz
    return p
  }
  if (b.coin) return overlapCoinBox(b, a)
  return overlapBoxes(a, b)
}

/* ---------------- the world ---------------- */

const CELL = 1.25
const GX0 = -7.5
const GZ0 = -10
const NX = 12
const NZ = 14

export class World {
  bodies: Body[] = []
  t = 0
  /** the pushers' front faces now (set before each step), and their speeds */
  zU = UPPER_PUSH_MIN
  zL = LOWER_PUSH_MIN
  vU = 0
  vL = 0
  /** a shake (the Quake): this strong (a velocity kick, units / s) while it lasts */
  shake = 0
  rng: () => number
  /** called when something lands (h: how far it fell), goes over the front edge, lands in the tray or goes down a gutter */
  hook: ((e: WorldEvent, b: Body, h: number) => void) | null = null
  private pa = new Int32Array(4096)
  private pb = new Int32Array(4096)
  /** each pair's overlap left after the passes */
  private pres = new Float32Array(4096)
  private np = 0
  /** the bodies in order of z (kept sorted step to step), and each body's place in it */
  private order: number[] = []
  private rank = new Int32Array(1024)
  /** each body's neighbours (from the pairs): nbList[nbStart[i] .. nbStart[i + 1]) */
  private nbStart = new Int32Array(1025)
  private nbList = new Int32Array(8192)
  private nbFill = new Int32Array(1024)
  private cellStart = new Int32Array(NX * NZ + 1)
  private cellFill = new Int32Array(NX * NZ)
  private cellItems = new Int32Array(1024)
  private coinCell = new Int32Array(1024)
  private prizes: Body[] = []

  constructor(rng: () => number) {
    this.rng = rng
  }

  add(b: Body) {
    b.i = this.bodies.length
    b.extents()
    this.bodies.push(b)
    return b
  }

  /** one step of dt seconds; the pushers must already be where they are at the end of it */
  step(dt: number, zU: number, zL: number) {
    this.vU = (zU - this.zU) / dt
    this.vL = (zL - this.zL) / dt
    this.zU = zU
    this.zL = zL
    this.t += dt
    const bs = this.bodies
    const fr = Math.exp(-FRICTION_COIN * dt)
    const frp = Math.exp(-FRICTION_PRIZE * dt)
    const spin = Math.exp(-SPIN_DAMP * dt)
    const tilt = 1 - Math.exp(-TILT_RATE * dt)

    // 1. move everything by its velocity
    for (const b of bs) {
      if (b.state === GONE) continue
      b.ox = b.x
      b.oz = b.z
      b.oy = b.y
      b.oyaw = b.yaw
      if (b.state === TIP) {
        this.tip(b, dt)
        continue
      }
      if (b.state === AIR) {
        b.vy -= G * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        b.z += b.vz * dt
        b.yaw += b.wy * dt
        b.tx += b.wtx * dt
        b.tz += b.wtz * dt
        // down the chute or the gutter: clear of the floor's edge on the way down
        if (b.fate === IN_GUTTER) {
          const m = HALF_W + 0.35
          if (b.y < 0.05 && Math.abs(b.x) < m) b.x = b.x < 0 ? -m : m
          if (b.z > FRONT_Z - 0.1) b.z = FRONT_Z - 0.1
          if (b.y < GUTTER_GONE_Y) b.state = GONE
        } else if (b.fate === IN_TRAY && b.y < 0.05 && b.z < FRONT_Z + 0.35) b.z = FRONT_Z + 0.35
        continue
      }
      // resting: friction toward what it stands on
      let sx = 0
      let sz = 0
      if (b.ride) {
        sx = b.ride.vx
        sz = b.ride.vz
      } else if (b.onPlate) sz = this.vL
      const f = b.coin ? fr : frp
      b.vx = sx + (b.vx - sx) * f
      b.vz = sz + (b.vz - sz) * f
      b.wy *= spin
      if (this.shake > 0 && b.fate === ON_FIELD) {
        b.vx += (this.rng() - 0.5) * this.shake * (b.coin ? 1 : 0.4)
        b.vz += (this.rng() - 0.5) * this.shake * (b.coin ? 1 : 0.4)
      }
      // a coin leaning steeply slides down its slope (off the top of a pile, into a gap beside it)
      if (b.leanSlope > SLIDE_SLOPE) {
        const k = (b.leanSlope - SLIDE_SLOPE) * SLIDE_PULL * dt
        b.vx += b.leanUx * k
        b.vz += b.leanUz * k
      }
      if (b.steerZ > 0 && b.vz < b.steerZ) b.vz = b.steerZ
      if (b.steerX !== 0) b.vx += (b.steerX - b.vx) * 0.5
      b.x += b.vx * dt
      b.z += b.vz * dt
      b.yaw += b.wy * dt
    }

    for (const b of bs) b.yb = b.state === AIR ? Math.max(b.y, b.oy) : b.y

    // 2. who is near whom
    this.pairs()

    // 3. push apart, a few passes (back to front, then front to back), with the pushers, walls and edges
    for (let it = 0; it < ITERS; it++) {
      if (it & 1) for (let p = this.np - 1; p >= 0; p--) this.contact(bs[this.pa[p]], bs[this.pb[p]])
      else for (let p = 0; p < this.np; p++) this.contact(bs[this.pa[p]], bs[this.pb[p]])
      for (const b of bs) if (b.state === REST || b.state === AIR) this.bounds(b)
    }
    // what is left over: how hard each body is squeezed (and coins rubbing each other turn a little)
    this.squeezes()

    // 4. what everything rests on: landing, leaning, dropping off
    this.support(tilt)
    for (const b of bs) b.yb = b.state === AIR ? Math.max(b.y, b.oy) : b.y

    // 5. squeezed coins ride up; planned bodies climb over what blocks them
    this.climb()
    this.unblock(dt)
    // (and the machine has the last word: nothing that moved on its supports ends up in a wall or a pusher)
    for (const b of bs) if (b.state === REST) this.bounds(b)

    // 6. velocities from how far things actually moved (a body knocked hard by a big correction doesn't fly off)
    const inv = 1 / dt
    for (const b of bs) {
      if (b.state !== REST) continue
      b.vx = (b.x - b.ox) * inv
      b.vz = (b.z - b.oz) * inv
      const v2 = b.vx * b.vx + b.vz * b.vz
      if (v2 > V_REST * V_REST) {
        const k = V_REST / Math.sqrt(v2)
        b.vx *= k
        b.vz *= k
      }
      if (!b.coin) b.wy = (b.yaw - b.oyaw) * inv
    }
  }

  /**
    Before the first step of a drop: works out what everything stands and leans on, as the field was saved (the leans
    aren't saved: a body a little lower than the top of one under it is leaning on it), without moving anything.
  */
  prime() {
    for (const b of this.bodies) b.yb = b.y
    this.pairs()
    this.squeezes()
    this.support(1, true)
    for (const b of this.bodies) {
      b.vx = 0
      b.vz = 0
      b.wy = 0
    }
  }

  /* -------- broad phase: candidate pairs from a grid (coins) plus the few prizes -------- */

  private pairs() {
    const bs = this.bodies
    const n = bs.length
    if (this.cellItems.length < n) {
      this.cellItems = new Int32Array(n * 2)
      this.coinCell = new Int32Array(n * 2)
      this.rank = new Int32Array(n * 2)
      this.nbStart = new Int32Array(n * 2 + 1)
      this.nbFill = new Int32Array(n * 2)
    }
    // keep the bodies sorted back to front (nearly sorted already, so an insertion sort is quick): the passes then
    // push through a whole row in one sweep
    const order = this.order
    for (let i = order.length; i < n; i++) order.push(i)
    for (let i = 1; i < n; i++) {
      const k = order[i]
      const z = bs[k].z
      let j = i - 1
      while (j >= 0 && bs[order[j]].z > z) {
        order[j + 1] = order[j]
        j--
      }
      order[j + 1] = k
    }
    const rank = this.rank
    for (let i = 0; i < n; i++) rank[order[i]] = i
    const fill = this.cellFill
    fill.fill(0)
    const prizes = this.prizes
    prizes.length = 0
    for (let i = 0; i < n; i++) {
      const b = bs[i]
      // (falling down a gutter, out of the way of everything)
      if (b.state === GONE || b.state === TIP || b.fate === IN_GUTTER) {
        this.coinCell[i] = -1
        continue
      }
      if (!b.coin) {
        prizes.push(b)
        this.coinCell[i] = -1
        continue
      }
      const cx = Math.max(0, Math.min(NX - 1, Math.floor((b.x - GX0) / CELL)))
      const cz = Math.max(0, Math.min(NZ - 1, Math.floor((b.z - GZ0) / CELL)))
      const c = cz * NX + cx
      this.coinCell[i] = c
      fill[c]++
    }
    const start = this.cellStart
    start[0] = 0
    for (let c = 0; c < NX * NZ; c++) start[c + 1] = start[c] + fill[c]
    fill.fill(0)
    for (let i = 0; i < n; i++) {
      const c = this.coinCell[i]
      if (c < 0) continue
      this.cellItems[start[c] + fill[c]++] = i
    }
    this.np = 0
    const M = 0.12
    // coin with coin: each coin against the coins in its own and the neighbouring cells further forward
    for (let oi = 0; oi < n; oi++) {
      const i = order[oi]
      const c = this.coinCell[i]
      if (c < 0) continue
      const a = bs[i]
      const cx = c % NX
      const cz = (c - cx) / NX
      for (let gz = Math.max(0, cz - 1); gz <= Math.min(NZ - 1, cz + 1); gz++)
        for (let gx = Math.max(0, cx - 1); gx <= Math.min(NX - 1, cx + 1); gx++) {
          const k = gz * NX + gx
          for (let q = start[k]; q < start[k + 1]; q++) {
            const j = this.cellItems[q]
            if (rank[j] <= oi) continue
            const b = bs[j]
            const dx = b.x - a.x
            const dz = b.z - a.z
            const rr = a.r + b.r + M
            if (dx * dx + dz * dz < rr * rr) this.pushPair(i, j)
          }
        }
    }
    // a prize against the coins near it and the other prizes
    for (let pi = 0; pi < prizes.length; pi++) {
      const p = prizes[pi]
      const reachR = p.r + COIN_R + M
      const x0 = Math.max(0, Math.floor((p.x - reachR - GX0) / CELL))
      const x1 = Math.min(NX - 1, Math.floor((p.x + reachR - GX0) / CELL))
      const z0 = Math.max(0, Math.floor((p.z - reachR - GZ0) / CELL))
      const z1 = Math.min(NZ - 1, Math.floor((p.z + reachR - GZ0) / CELL))
      for (let gz = z0; gz <= z1; gz++)
        for (let gx = x0; gx <= x1; gx++) {
          const k = gz * NX + gx
          for (let q = start[k]; q < start[k + 1]; q++) {
            const j = this.cellItems[q]
            const b = bs[j]
            const dx = b.x - p.x
            const dz = b.z - p.z
            if (dx * dx + dz * dz < reachR * reachR) this.pushPair(j, p.i)
          }
        }
      for (let pj = pi + 1; pj < prizes.length; pj++) {
        const b = prizes[pj]
        const dx = b.x - p.x
        const dz = b.z - p.z
        const rr = p.r + b.r + M
        if (dx * dx + dz * dz < rr * rr) this.pushPair(p.i, b.i)
      }
    }
  }

  private pushPair(i: number, j: number) {
    if (this.np >= this.pa.length) {
      const a = new Int32Array(this.pa.length * 2)
      a.set(this.pa)
      this.pa = a
      const b = new Int32Array(this.pb.length * 2)
      b.set(this.pb)
      this.pb = b
      this.pres = new Float32Array(this.pa.length)
    }
    this.pa[this.np] = i
    this.pb[this.np] = j
    this.np++
  }

  /* -------- narrow phase: push two overlapping bodies apart -------- */

  /** how deep two bodies overlap side by side (0 when apart, or when one rests or leans on the other); sets the normal */
  side(a: Body, b: Body) {
    if (a.state > AIR || b.state > AIR || a.fate !== b.fate) return 0
    if (a.sup === b || b.sup === a || clearV(a, b)) return 0
    return overlap(a, b)
  }

  private contact(a: Body, b: Body) {
    if (a.state > AIR || b.state > AIR) return
    // two bodies at rest, settled with each other last step and not moved since: nothing to do
    if (a.squeeze === 0 && b.squeeze === 0 && a.state === REST && b.state === REST && a.x === a.ox && a.z === a.oz && a.y === a.oy && b.x === b.ox && b.z === b.oz && b.y === b.oy) return
    if (a.fate !== b.fate) return
    if (a.sup === b || b.sup === a) return
    // side by side only when their heights overlap
    if (clearV(a, b)) return
    let pen = 0
    if (a.coin && b.coin) {
      // (overlapCoins, spelled out: the commonest case by far)
      const dx = b.x - a.x
      const dz = b.z - a.z
      const rr = a.r + b.r
      const d2 = dx * dx + dz * dz
      if (d2 >= rr * rr) return
      pen = overlapCoins(a, b)
      if (pen <= 0) return
      const w = a.im + b.im
      const da = (pen * a.im) / w
      const db = (pen * b.im) / w
      a.x -= nx * da
      a.z -= nz * da
      b.x += nx * db
      b.z += nz * db
    } else if (a.coin || b.coin) {
      const c = a.coin ? a : b
      const p = a.coin ? b : a
      pen = overlapCoinBox(c, p)
      if (pen <= 0) return
      // normal from the box to the coin, contact point on the box
      const rx = cpx - p.x
      const rz = cpz - p.z
      const k = nx * rz - nz * rx
      const w = c.im + p.im + p.ii * k * k
      const d = pen / w
      c.x += nx * d * c.im
      c.z += nz * d * c.im
      p.x -= nx * d * p.im
      p.z -= nz * d * p.im
      p.yaw -= p.ii * k * d
      p.extents()
    } else {
      pen = overlapBoxes(a, b)
      if (pen <= 0) return
      const w = a.im + b.im
      a.x -= (nx * pen * a.im) / w
      a.z -= (nz * pen * a.im) / w
      b.x += (nx * pen * b.im) / w
      b.z += (nz * pen * b.im) / w
    }
  }

  /** after the passes: each pair's overlap left over, each body's worst squeeze and by whom, the neighbour lists */
  private squeezes() {
    const bs = this.bodies
    const n = bs.length
    for (const b of bs) {
      b.squeeze = 0
      b.squeezeBy = null
    }
    const start = this.nbStart
    start.fill(0, 0, n + 1)
    for (let p = 0; p < this.np; p++) {
      const a = bs[this.pa[p]]
      const b = bs[this.pb[p]]
      start[a.i + 1]++
      start[b.i + 1]++
      const pen = this.side(a, b)
      this.pres[p] = pen
      if (pen <= 0) continue
      if (pen > a.squeeze) {
        a.squeeze = pen
        a.squeezeBy = b
      }
      if (pen > b.squeeze) {
        b.squeeze = pen
        b.squeezeBy = a
      }
      if (a.coin && b.coin && a.state === REST && b.state === REST) {
        // rubbing makes coins turn a little
        const tv = (b.vx - a.vx) * -nz + (b.vz - a.vz) * nx
        a.wy += tv * 0.05
        b.wy -= tv * 0.05
      }
    }
    for (const b of bs) if (b.squeeze > SPILL && b.state === REST && b.z > UPPER_FRONT_Z - UPPER_LIP - 0.03 && b.upper) b.spill = true
    for (let i = 0; i < n; i++) start[i + 1] += start[i]
    if (this.nbList.length < this.np * 2) this.nbList = new Int32Array(this.np * 4)
    const fill = this.nbFill
    fill.fill(0, 0, n)
    for (let p = 0; p < this.np; p++) {
      const i = this.pa[p]
      const j = this.pb[p]
      this.nbList[start[i] + fill[i]++] = j
      this.nbList[start[j] + fill[j]++] = i
    }
  }

  /* -------- the machine around them -------- */

  /** keep b on the plane n·p >= d (n a unit vector along x or z): a coin by its centre and radius, a box by its corners */
  private plane(b: Body, ux: number, uz: number, d: number) {
    if (b.coin) {
      const s = ux * b.x + uz * b.z - b.r
      if (s < d) {
        b.x += ux * (d - s)
        b.z += uz * (d - s)
      }
      return
    }
    const c = Math.cos(b.yaw)
    const s = Math.sin(b.yaw)
    // the corner furthest into the plane
    let min = Infinity
    let rx = 0
    let rz = 0
    for (let k = 0; k < 4; k++) {
      const lx = k & 1 ? b.hw : -b.hw
      const lz = k & 2 ? b.hd : -b.hd
      const ox = lx * c + lz * s
      const oz = -lx * s + lz * c
      const v = ux * (b.x + ox) + uz * (b.z + oz)
      if (v < min) {
        min = v
        rx = ox
        rz = oz
      }
    }
    if (min >= d) return
    const pen = d - min
    // turn it toward lying flat against the plane, then slide the rest
    const k = ux * rz - uz * rx
    const w = b.im + b.ii * k * k
    const dd = pen / w
    b.yaw += b.ii * k * dd
    b.extents()
    const cc = Math.cos(b.yaw)
    const ss = Math.sin(b.yaw)
    let min2 = Infinity
    for (let q = 0; q < 4; q++) {
      const lx = q & 1 ? b.hw : -b.hw
      const lz = q & 2 ? b.hd : -b.hd
      const v = ux * (b.x + lx * cc + lz * ss) + uz * (b.z - lx * ss + lz * cc)
      if (v < min2) min2 = v
    }
    if (min2 < d) {
      b.x += ux * (d - min2)
      b.z += uz * (d - min2)
    }
  }

  /** a wall for a resting body is a plane against its footprint; a falling one is tumbling, so only its turned extent counts */
  private wall(b: Body, ux: number, uz: number, d: number) {
    if (b.state === REST) return this.plane(b, ux, uz, d)
    const t = ux !== 0 ? b.tz : b.tx
    const m = (ux !== 0 ? b.ex : b.ez) * Math.abs(Math.cos(t)) + (b.h / 2) * Math.abs(Math.sin(t))
    const s = ux * b.x + uz * b.z - m
    if (s < d) {
      b.x += ux * (d - s)
      b.z += uz * (d - s)
    }
  }

  private bounds(b: Body) {
    if (b.fate === IN_TRAY) {
      if (b.state !== REST) return
      this.plane(b, 1, 0, -TRAY_X)
      this.plane(b, -1, 0, -TRAY_X)
      this.plane(b, 0, 1, TRAY_Z0)
      this.plane(b, 0, -1, -TRAY_Z1)
      return
    }
    if (b.fate === IN_GUTTER) return
    // (b.upper, spelled out: this runs many times a step)
    if (b.yb > UPPER_Y - 0.3 && (b.state === AIR ? b.z < UPPER_FRONT_Z : b.z - b.ez < UPPER_FRONT_Z)) {
      this.wall(b, 1, 0, -HALF_W)
      this.wall(b, -1, 0, -HALF_W)
      this.wall(b, 0, 1, Math.max(BACK_Z, this.zU))
      // the upper tier's lip holds a body back a little until it is pressed hard enough to go (so the tier fills up)
      if (!b.spill && b.goAt === Infinity && b.state === REST) {
        const m = UPPER_FRONT_Z - UPPER_LIP
        if (b.z > m) b.z = m
      }
      return
    }
    if (b.state === AIR && b.y - b.dip > UPPER_Y) {
      // falling in front of the upper tier: only the side walls (they go all the way up)
      if (b.z < GUTTER_Z0) {
        this.wall(b, 1, 0, -HALF_W)
        this.wall(b, -1, 0, -HALF_W)
      }
      return
    }
    // the lower tier: the shelf's front and the plate
    // (one falling past the plate's top keeps clear of its front face, unless it is coming down onto the plate)
    const low = b.state === AIR ? b.y - b.dip : b.y
    const belowPlate = low < LOWER_TOP - 0.02 && (b.state !== AIR || b.oy < LOWER_TOP - 0.02 || b.z >= this.zL)
    this.wall(b, 0, 1, belowPlate ? this.zL : UPPER_FRONT_Z)
    // the side walls, then the open sides at the front (a coin rounds the wall's end; a box keeps clear of it)
    if (b.z < GUTTER_Z0 || (!b.coin && b.z - b.ez < GUTTER_Z0)) {
      this.wall(b, 1, 0, -HALF_W)
      this.wall(b, -1, 0, -HALF_W)
    } else {
      const s = b.x < 0 ? -1 : 1
      const dx = b.x - s * HALF_W
      const dz = b.z - GUTTER_Z0
      const r = b.state === REST ? b.r : b.r * Math.abs(Math.cos(b.tz)) + (b.h / 2) * Math.abs(Math.sin(b.tz))
      const d2 = dx * dx + dz * dz
      if (d2 < r * r && dz < r) {
        const d = Math.sqrt(d2) || 1e-6
        b.x = s * HALF_W + (dx / d) * r
        b.z = GUTTER_Z0 + (dz / d) * r
      }
      if (!b.gutterOk) {
        const m = HALF_W - SIDE_LIP
        if (b.x > m) b.x = m
        else if (b.x < -m) b.x = -m
      }
    }
    // the front lip
    if (this.t < b.goAt) {
      const m = FRONT_Z - (b.coin ? LIP : LIP_PRIZE)
      if (b.z > m) b.z = m
    }
  }

  /** the floor under b's centre: the upper tier, the plate, the lower tier, the tray, or nothing (past an edge) */
  floorAt(b: Body) {
    if (b.fate === IN_TRAY) return TRAY.y
    if (b.fate === IN_GUTTER) return -Infinity
    const y = b.lvl
    if (b.z < UPPER_FRONT_Z && y > UPPER_Y - 0.3) return UPPER_Y
    if (b.z < this.zL && b.z >= UPPER_FRONT_Z - 0.01 && y > LOWER_TOP - 0.3) return LOWER_TOP
    if (b.z <= FRONT_Z && Math.abs(b.x) <= HALF_W && y > -0.6) return 0
    return -Infinity
  }

  /* -------- support: what each body rests on -------- */

  private support(tilt: number, first = false) {
    const bs = this.bodies
    for (const b of bs) {
      b.cover = -Infinity
      b.coverBody = null
      b.leanTop = -Infinity
      b.leanBody = null
    }
    for (let p = 0; p < this.np; p++) {
      const a = bs[this.pa[p]]
      const b = bs[this.pb[p]]
      if (a.state > AIR || b.state > AIR || a.fate !== b.fate) continue
      const aUnder = a.top <= (b.state === AIR ? b.oy : b.y) + CLIMB_EPS || b.sup === a || (first && a.y < b.y - 0.01 && a.top <= b.y + 0.14) || (b.rideOver && a.goAt === Infinity)
      const bUnder = !aUnder && (b.top <= (a.state === AIR ? a.oy : a.y) + CLIMB_EPS || a.sup === b || (first && b.y < a.y - 0.01 && b.top <= a.y + 0.14) || (a.rideOver && b.goAt === Infinity))
      if (!aUnder && !bUnder) continue
      if (overlap(a, b) <= 0.01) continue
      if (aUnder) this.under(a, b)
      else this.under(b, a)
    }
    for (const b of bs) {
      if (b.state !== REST && b.state !== AIR) continue
      // past the front edge or an open side nothing holds it up, not even the coins hanging over beside it
      const off = b.fate === ON_FIELD && !b.upper && (b.z > FRONT_Z || (b.z > GUTTER_Z0 && Math.abs(b.x) > HALF_W))
      const base = off ? -Infinity : Math.max(this.floorAt(b), b.cover)
      let y = base
      let sup: Body | null = null
      let lx = 0
      let lz = 0
      const lb = b.leanBody
      // (not over an edge down to another tier: that is too far to lean, it tips over instead)
      if (lb && b.leanTop > base + 0.004 && b.leanTop - base < 0.5 && base > -Infinity) {
        // leaning: the far side down at the base, the near side on the supporter's rim
        let ux = b.x - lb.x
        let uz = b.z - lb.z
        const d = Math.sqrt(ux * ux + uz * uz) || 1
        ux /= d
        uz /= d
        const rb = reach(b, ux, uz)
        const dc = Math.max(0.02, distTo(lb, b.x, b.z))
        // the plane through the rim it leans on, down toward the far side until it meets the base there, or sooner
        // something else under that side (it rests on the steepest of these it can't sink below)
        let slope = (b.leanTop - base) / (rb + dc)
        const ref = b.state === AIR ? b.oy : b.y
        for (let q = this.nbStart[b.i]; q < this.nbStart[b.i + 1]; q++) {
          const k = bs[this.nbList[q]]
          if (k === lb || k.state !== REST || k.fate !== b.fate || k.top <= base + 0.004) continue
          // anything lower down under its footprint: what it rests on, and what it leans over
          if (!(k.top <= ref + CLIMB_EPS || b.sup === k || k.y < ref - 0.005) || overlap(b, k) <= 0.01) continue
          const s = Math.min(rb, (k.x - b.x) * ux + (k.z - b.z) * uz + reach(k, ux, uz))
          if (s <= -dc + 0.02) continue
          const kt = topAt(k, b.x + ux * s, b.z + uz * s)
          if (kt > b.leanTop) continue
          slope = Math.max(0, Math.min(slope, (b.leanTop - kt) / (s + dc)))
        }
        y = b.leanTop - slope * dc
        const th = Math.atan(slope)
        const st = Math.sin(th)
        lx = Math.asin(Math.max(-1, Math.min(1, uz * st)))
        lz = Math.asin(Math.max(-1, Math.min(1, (-ux * st) / Math.cos(lx))))
        sup = lb
        b.leanUx = ux
        b.leanUz = uz
        b.leanSlope = slope
      } else b.leanSlope = 0
      if (b.state === REST) {
        if (base === -Infinity) {
          this.startFall(b)
          continue
        }
        if (y < b.y - 0.03 && !first) {
          // what held it has gone: it drops (a long way: it tips off an edge)
          // (off a tier's edge it always tips: part of it is still over the edge)
          if (b.y - y > 0.3 || (b.y > UPPER_Y - 0.05 && b.z > UPPER_FRONT_Z) || b.y - y > 0.1 && b.y > LOWER_TOP - 0.05 && b.z > this.zL && b.z - b.ez < this.zL) this.startFall(b)
          else {
            // (still settling from a landing it stood on an edge: it falls from as high as it was shown)
            b.y = b.shownY - b.h / 2
            b.state = AIR
            b.vy = 0
            b.fallY = b.y
          }
          continue
        }
        if (sup && b.squeeze > 0.015 && this.grounded(sup)) {
          // leaning and still squeezed: it rides on up, onto the top of what it leans on
          const dx = sup.x - b.x
          const dz = sup.z - b.z
          const d = Math.sqrt(dx * dx + dz * dz) || 1
          const k = Math.min(MOUNT_STEP, d * 0.5) / d
          b.x += dx * k
          b.z += dz * k
        } else if (b.coin && b.coverBody && base - this.floorAt(b) > 0.3) {
          // on top of a pile three coins high: it slides off the top (a pile that high doesn't stand)
          const c = b.coverBody
          let dx = b.x - c.x
          let dz = b.z - c.z
          const d = Math.sqrt(dx * dx + dz * dz)
          if (d < 1e-3) {
            dx = Math.cos(b.id)
            dz = Math.sin(b.id)
          }
          const k = SLUMP_STEP / (d || 1)
          b.x += dx * k
          b.z += dz * k
        }
        b.y = y
        b.sup = sup
        b.ride = sup ?? b.coverBody
        b.onPlate = !b.ride && base === LOWER_TOP && b.fate === ON_FIELD
        b.leanX = lx
        b.leanZ = lz
        b.tx += (b.flipX + lx - b.tx) * tilt
        b.tz += (b.flipZ + lz - b.tz) * tilt
      } else if (base === -Infinity) {
        // falling past an edge without tipping (off a stack, or slid off the open side in the air)
        if (b.fate === ON_FIELD) this.leave(b)
      } else if (b.fate === ON_FIELD && b.oy >= UPPER_Y - 0.05 && b.y < UPPER_Y - 0.02 && b.z > UPPER_FRONT_Z && b.z - b.ez < UPPER_FRONT_Z) {
        // dropping past the upper tier's lip with part of it still over the tier: it catches on the lip and tips off
        b.y = UPPER_Y
        b.state = REST
        b.tx = b.flipX = Math.round(b.tx / Math.PI) * Math.PI * (b.coin ? 1 : 0)
        b.tz = b.flipZ = 0
        this.startFall(b)
      } else if (b.fate === ON_FIELD && b.oy >= LOWER_TOP - 0.02 && b.y < LOWER_TOP - 0.02 && y < LOWER_TOP - 0.02 && b.z >= this.zL && b.z - b.ez < this.zL && !b.upper) {
        // it comes down on the plate's front edge: it catches there, flat, and tips off it forward
        this.land(b, LOWER_TOP, null, 0, 0)
        b.tx = b.flipX
        b.tz = b.flipZ
      } else if (b.y - b.dip <= y) {
        // (a body falling tilted comes down on its lowest edge)
        this.land(b, y, sup, lx, lz)
      }
    }
  }

  /** a is under b: it may hold b's centre up, or prop it from the side */
  private under(a: Body, b: Body) {
    if (covers(a, b.x, b.z, 0.02)) {
      // its top under b's centre (a leaning one slopes)
      const top = topAt(a, b.x, b.z)
      if (top > b.cover) {
        b.cover = top
        b.coverBody = a
      }
    } else {
      // its top at its rim nearest b, where b would rest on it
      let ux = b.x - a.x
      let uz = b.z - a.z
      const d = Math.sqrt(ux * ux + uz * uz) || 1
      ux /= d
      uz /= d
      const r = reach(a, ux, uz)
      const top = topAt(a, a.x + ux * r, a.z + uz * r)
      // (between near-equal ones it keeps leaning on the one it leant on, or has just climbed onto)
      if (b.sup === a ? top > b.leanTop - 0.01 : top > b.leanTop + (b.leanBody && b.leanBody === b.sup ? 0.01 : 0)) {
        b.leanTop = top
        b.leanBody = a
      }
    }
  }

  private land(b: Body, y: number, sup: Body | null, lx: number, lz: number) {
    const h = b.fallY - y
    b.y = y
    b.vy = 0
    b.state = REST
    b.sup = sup
    b.ride = sup ?? b.coverBody
    b.leanX = lx
    b.leanZ = lz
    // it comes to rest on the nearest flat face (a coin may land face down; a prize lands on its base)
    const unit = b.coin ? Math.PI : Math.PI * 2
    b.flipX = Math.round(b.tx / unit) * unit
    b.flipZ = Math.round(b.tz / unit) * unit
    b.wtx = 0
    b.wtz = 0
    // landing kills most of the fall's sideways speed
    b.vx *= 0.35
    b.vz *= 0.35
    b.wy *= 0.5
    if (b.fate === IN_TRAY) {
      if (!b.trayed) this.hook?.('tray', b, h)
      b.trayed = true
    }
    else if (h > 0.2) this.hook?.('land', b, h)
  }

  /* -------- falling off an edge -------- */

  /** a body that left the field by falling, not tipping: past the front (the tray) or off an open side (a gutter) */
  private leave(b: Body) {
    if (b.z > FRONT_Z - 0.05 && !b.upper) {
      b.fate = IN_TRAY
      this.hook?.('edge', b, 0)
      this.aimTray(b)
    } else if (Math.abs(b.x) > HALF_W - 0.05) {
      b.fate = IN_GUTTER
      b.vz = Math.min(0, b.vz)
      b.z = Math.min(b.z, FRONT_Z - 0.1)
      this.hook?.('gutter', b, 0)
    }
  }

  /** b's centre has passed the edge of what holds it: it tips over that edge, or just drops if nothing is in the way */
  private startFall(b: Body) {
    const front = b.z > FRONT_Z - 0.05 && b.y > -0.6 && b.fate === ON_FIELD && !b.upper
    const side = Math.abs(b.x) > HALF_W - 0.05 && b.fate === ON_FIELD && !b.upper && b.z > GUTTER_Z0 - 0.5
    b.fallY = b.y
    b.state = TIP
    b.tipT0 = this.t
    if (front) {
      b.fate = IN_TRAY
      this.hook?.('edge', b, 0)
    } else if (side && !front) {
      b.fate = IN_GUTTER
      this.hook?.('gutter', b, 0)
    }
    // turn about the edge just behind (or beside) the centre, sliding on over it, until the back of it is clear of the
    // edge: a coin flips over quickly, a prize slides off more than it turns (between the tiers it lands near upright)
    const heavy = !b.coin
    const between = heavy && b.fate === ON_FIELD
    b.tipAxisX = !side || front
    b.tipSign = b.tipAxisX ? 1 : b.x > 0 ? 1 : -1
    b.tipPy = b.y
    b.tipU = 0.03
    b.tipV = b.h / 2
    if (b.tipAxisX) b.tipPq = b.z - 0.03
    else b.tipPq = b.x - b.tipSign * 0.03
    // tipping off the lower pusher's plate: the edge it turns about is the plate's, and moves with it
    b.tipPlate = b.tipAxisX && !front && b.fate === ON_FIELD && Math.abs(b.y - LOWER_TOP) < 0.05 && Math.abs(b.tipPq - this.zL) < 0.6
    // tipping into a gutter: it goes down beside the lower tier, not past its front
    if (side && !front) {
      b.vz = Math.min(0, b.vz)
      b.z = Math.min(b.z, FRONT_Z - 0.1)
    }
    b.tipAng = 0
    // it turns on from how it lies, but never from tilted back against the way it tips (it was just landing: it settles flat)
    const unit = b.coin ? Math.PI : Math.PI * 2
    const fx = Math.round(b.tx / unit) * unit
    const fz = Math.round(b.tz / unit) * unit
    b.tipX0 = b.tipAxisX ? fx + Math.max(0, b.tx - fx) : b.tx
    b.tipZ0 = b.tipAxisX ? b.tz : fz + (b.tipSign > 0 ? Math.min(0, b.tz - fz) : Math.max(0, b.tz - fz))
    b.tx = b.tipX0
    b.tz = b.tipZ0
    b.tipW = heavy ? 0.5 : 1.5
    b.tipAcc = between ? 2.5 + this.rng() * 2 : heavy ? 8 + this.rng() * 5 : 40 + this.rng() * 30
    b.tipStop = between ? 0.2 : heavy ? 0.7 : 0.7 + this.rng() * 0.5
    b.tipSlide = Math.max(heavy ? 1.2 : 0.4, b.tipAxisX ? b.vz : Math.abs(b.vx))
    b.ox = b.x
    b.oz = b.z
  }

  private tip(b: Body, dt: number) {
    if (b.tipPlate) b.tipPq = Math.max(b.tipPq, this.zL)
    b.tipW += b.tipAcc * dt
    b.tipAng += b.tipW * dt
    b.tipU += b.tipSlide * dt
    const a = Math.min(b.tipAng, !b.coin && b.fate === ON_FIELD ? 0.6 : 1.45)
    const c = Math.cos(a)
    const s = Math.sin(a)
    // the centre, turned about the edge: up (v) and outward (u) from the pivot
    const v = b.tipV * c - b.tipU * s
    const u = b.tipV * s + b.tipU * c
    b.y = b.tipPy + v - b.h / 2
    if (b.tipAxisX) {
      b.z = b.tipPq + u
      b.tx = b.tipX0 + a
    } else {
      b.x = b.tipPq + b.tipSign * u
      b.tz = b.tipZ0 - b.tipSign * a
    }
    // the pushers still push it while it turns (the edge it turns about moves with what pushes it), and the front lip
    // still holds it (it only ever tips toward the front edge off something else, never over it)
    if (b.tipAxisX && b.fate === ON_FIELD) {
      const ez = b.ez * Math.abs(c) + (b.h / 2) * Math.abs(s)
      const face = b.upper ? Math.max(BACK_Z, this.zU) : b.y < LOWER_TOP - 0.02 ? this.zL : UPPER_FRONT_Z
      if (b.z - ez < face) {
        b.tipPq += face - (b.z - ez)
        b.z = face + ez
      }
      const lip = FRONT_Z - (b.coin ? LIP : LIP_PRIZE)
      if (this.t < b.goAt && b.z > lip) {
        b.tipPq -= b.z - lip
        b.z = lip
      }
    }
    // it lets go once it has turned enough and its back is past the edge (or it has turned right over)
    const cleared = b.tipU - (b.tipAxisX ? b.ez : b.ex) * c > -0.02
    if (b.tipAng >= b.tipStop && (cleared || b.tipAng > 1.45 || this.t - b.tipT0 > 0.9)) {
      // let go: it falls with the speed the turn gave it
      const w = b.tipW
      const vu = (b.tipV * c - b.tipU * s) * w + b.tipSlide
      const vv = (-b.tipV * s - b.tipU * c) * w
      b.state = AIR
      b.vy = Math.min(0, vv)
      if (b.tipAxisX) {
        b.vz = vu
        b.wtx = w * (b.coin ? 1 : 0.5)
      } else {
        b.vx = b.tipSign * Math.abs(vu)
        b.wtz = -b.tipSign * w * (b.coin ? 1 : 0.5)
      }
      // a prize falling between the tiers stays more or less upright
      if (!b.coin && b.fate === ON_FIELD) b.wtx *= 0.3
      if (b.fate === IN_TRAY) this.aimTray(b)
    }
  }

  /** a body over the front edge falls down the chute: aim it at a spot in the tray */
  private aimTray(b: Body) {
    const tx = Math.max(-TRAY_X + 0.7, Math.min(TRAY_X - 0.7, b.x * 0.85 + (this.rng() - 0.5) * 0.8))
    const tz = TRAY_Z0 + 0.6 + this.rng() * 0.9
    // the time to fall to the tray floor
    const h = b.y - TRAY.y
    const t = (b.vy + Math.sqrt(b.vy * b.vy + 2 * G * Math.max(0.1, h))) / G
    b.vx = (tx - b.x) / t
    b.vz = (tz - b.z) / t
    b.aimX = tx
    b.aimZ = tz
  }

  /* -------- riding up -------- */

  private climb() {
    const bs = this.bodies
    for (let p = 0; p < this.np; p++) {
      const pen = this.pres[p]
      if (pen < 0.004) continue
      const a = bs[this.pa[p]]
      const b = bs[this.pb[p]]
      if (a.state !== REST || b.state !== REST || a.sup === b || b.sup === a) continue
      const pa = a.goAt < Infinity && a.steerZ > 0
      const pb = b.goAt < Infinity && b.steerZ > 0
      let up: Body | null = null
      let on: Body | null = null
      if (pa !== pb) {
        // a chosen body pressing on a coin that blocks its way to the edge climbs over it: onto the highest of the
        // coins in its way, so that nothing is left to stop it
        const c = pa ? a : b
        const o = pa ? b : a
        if (o.coin && o.goAt === Infinity && o.z > c.z + 0.05) {
          up = c
          on = o
          for (let q = this.nbStart[c.i]; q < this.nbStart[c.i + 1]; q++) {
            const k = bs[this.nbList[q]]
            if (k.coin && k.state === REST && k.fate === c.fate && k.goAt === Infinity && k.z > c.z + 0.05 && k.top > on.top && overlap(c, k) > 0.01) on = k
          }
        }
      } else if (pen >= CLIMB_PEN && a.coin && b.coin) {
        // a squeezed coin rides up onto its neighbour: the one squeezed harder, or else the one further back
        const first = a.squeeze > b.squeeze + 0.02 || (Math.abs(a.squeeze - b.squeeze) <= 0.02 && a.z < b.z)
        up = first ? a : b
        on = first ? b : a
        // two layers is plenty: not onto a coin that is itself on top of others, unless squeezed very hard
        if (!this.grounded(on) && !this.grounded(up)) continue
        if (!this.grounded(on)) {
          const t = up
          up = on
          on = t
        }
      }
      if (!up || !on) continue
      if (this.roomAbove(up, on)) {
        up.sup = on
        this.pres[p] = 0
      } else if (!pa && !pb && this.grounded(up) && this.roomAbove(on, up)) {
        on.sup = up
        this.pres[p] = 0
      }
    }
  }

  /**
    A chosen body helped toward the edge that hardly moved this step is held up by coins in front of it (held back by
    the lip, they give no more than it pushes): it climbs onto the highest of the coins just ahead of it.
  */
  private unblock(dt: number) {
    const bs = this.bodies
    for (const c of bs) {
      if (c.state !== REST || c.goAt === Infinity || c.steerZ < 0.05 || c.z - c.oz > c.steerZ * dt * 0.4) continue
      let on: Body | null = null
      c.z += 0.06
      for (let q = this.nbStart[c.i]; q < this.nbStart[c.i + 1]; q++) {
        const k = bs[this.nbList[q]]
        if (!k.coin || k.state !== REST || k.fate !== c.fate || k.goAt < Infinity || k.z < c.z - 0.06 || k === c.sup) continue
        if (clearV(c, k) || overlap(c, k) <= 0.01) continue
        if (!on || k.top > on.top) on = k
      }
      c.z -= 0.06
      if (on && on.sup !== c && this.roomAbove(c, on)) c.sup = on
    }
  }

  /** whether b lies on the floor (or the plate) itself, not on other coins: only those are climbed onto */
  private grounded(b: Body) {
    return b.y <= this.floorAt(b) + 0.05
  }

  /** whether b fits on top of o where it is now */
  private roomAbove(b: Body, o: Body) {
    const y0 = o.top
    const y1 = y0 + b.h
    const bs = this.bodies
    for (let q = this.nbStart[b.i]; q < this.nbStart[b.i + 1]; q++) {
      const k = bs[this.nbList[q]]
      if (k === o || k.state !== REST || k.fate !== b.fate) continue
      if (Math.min(y1, k.top) - Math.max(y0, k.y) <= BAND_EPS) continue
      if (overlap(b, k) > 0.12) return false
    }
    return true
  }
}
