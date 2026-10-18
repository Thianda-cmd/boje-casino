import type { Die } from './rules'

/*
  The three dice under the glass dome, worked out as real rigid-body physics before they are shown (no three.js here,
  so Node can test it: tools/sicbo-physics-test.ts).

  A die is a cube with rounded edges: a sharp inner cube grown by a small radius, so it touches the world through
  balls at its eight corners and, against another die, also at the point of each nearby edge that comes closest (so
  two dice meeting edge to edge are caught exactly). The dome is a felt floor that turns up in a steep cove at its
  edge, under a glass sphere centred on the middle of the floor. The pedestal shakes the dome with short hard kicks,
  up, sideways and rocking, for a second and a half or so, then lets the dice settle. Everything is worked out in the
  dome's own frame, where a kick is felt as a brief pseudo-force (which is all a moving floor does to what lies on
  it), by an impulse solver at 360 steps a second: contacts with friction and a little bounce, made a step ahead when
  a gap is about to close (the kicks bring the floor up to meet falling dice fast), solved a few times a step. That is
  cheap enough to try a few rolls in a few milliseconds each.

  Which faces come up is chaotic, so it is never steered. The dice are relabelled instead: a cube looks the same under
  any of its 24 rotations, so while a die flies clear of everything (no contact, and far enough from the felt, the
  cove, the glass and the other dice that no turn of it could touch them), its pips can be turned within the body, a
  quarter, third or half turn blended in across that moment of flight, so that it lands showing the face that was
  drawn. The turn chosen is the smallest that does it, about the axis the die is already spinning on where that ties.
  The path is never touched, and every roll starts exactly from the dice's previous resting poses, so nothing snaps.

  Units: a die's edge is 1. Time is in seconds of the show at normal speed.
*/

export type Q = [number, number, number, number]
export type V3 = [number, number, number]

/** half a die's edge */
export const HALF = 0.5
/** the radius its edges and corners are rounded to */
export const ROUND = 0.085
const CORE = HALF - ROUND
/** the farthest any point of a die is from its centre */
export const REACH = Math.sqrt(3) * CORE + ROUND
/** the glass: a sphere of this radius round the middle of the floor */
export const DOME_R = 3.4
/**
 * The felt is flat out to this radius, then turns up in a steep cove (a cone at COVE to the floor) to meet the glass:
 * a die cannot rest on so steep a slope, nor lean on it (it falls back flat), so the dice always settle flat and clear
 * of the edge, where the camera reads them well.
 */
export const FLAT_R = 3.05
export const COVE = (62 * Math.PI) / 180
const COVE_S = Math.sin(COVE)
const COVE_C = Math.cos(COVE)
const GRAV = 64
const DT = 1 / 360
/** the roll is recorded at this rate (samples per second) */
export const RATE = 120
const EVERY = Math.round(1 / (DT * RATE))
const N = 3
/** a die's mass is 1, and a cube's inertia is the same about every axis through its centre: edge² / 6 */
const INV_I = 6

/** what each pair of surfaces does: bounce (restitution) and friction */
const FELT = { e: 0.26, mu: 0.6 }
const GLASS = { e: 0.5, mu: 0.16 }
/** the cove: slick (its friction kept low, so a die cannot lean on it: it slides off and falls flat) */
const SLOPE = { e: 0.35, mu: 0.04 }
const BONE = { e: 0.42, mu: 0.3 }
const ITER = 8
/** how hard overlap is pushed out (a share of it per step), what is let be, and how fast at most */
const BETA = 0.22
const SLOP = 0.003
const MAX_PUSH = 4
/** slower than this, a contact does not bounce */
const BOUNCE_V = 1.1
/** a knock worth a sound: a new contact arriving faster than this */
const HIT_V = 1.3
/**
 * Contacts are made this far ahead (speculatively): a corner closing a gap within the step is caught as it arrives
 * rather than after it has sunk in (the kicks bring the floor up to meet falling dice at 20 units a second and more)
 */
const AHEAD = 0.09
/** how far clear of everything a die must be (beyond its reach) for its pips to be turned */
const CLEAR = 0.02
/** the shortest stretch of clear flight a turn is blended across, s */
const MIN_WINDOW = 0.1
/** a die lying on the floor rolls against the felt: its spin dies away at this rate (1/s) */
const FELT_DRAG = 2.4

/* ---------------- quaternions ---------------- */

export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]]
/** a turn of `a` radians about the unit axis (x, y, z) */
export const axisAngle = (x: number, y: number, z: number, a: number): Q => {
  const l = Math.hypot(x, y, z) || 1
  const s = Math.sin(a / 2) / l
  return [x * s, y * s, z * s, Math.cos(a / 2)]
}
/** a vector turned by a quaternion */
export const rotate = (q: Q, v: V3): V3 => {
  const [x, y, z, w] = q
  // t = 2 q.xyz × v; v' = v + w t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
const normQ = (q: Q): Q => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}

/* ---------------- the pips ---------------- */

/**
 * The body axis each face's pips are on. Opposite faces add up to 7 and 1, 2, 3 run anticlockwise round the corner
 * they share, as on a real die.
 */
export const FACE_AXIS: Readonly<Record<Die, V3>> = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0] }
const FACES: readonly Die[] = [1, 2, 3, 4, 5, 6]

/** the face of a body axis (a unit vector along one of them) */
const faceOfAxis = (v: V3): Die => FACES.find((f) => FACE_AXIS[f][0] * v[0] + FACE_AXIS[f][1] * v[1] + FACE_AXIS[f][2] * v[2] > 0.5)!

/** the body axis nearest a body-frame direction */
const nearestAxis = (v: V3): V3 => {
  const ax = Math.abs(v[0])
  const ay = Math.abs(v[1])
  const az = Math.abs(v[2])
  if (ax >= ay && ax >= az) return [Math.sign(v[0]), 0, 0]
  if (ay >= az) return [0, Math.sign(v[1]), 0]
  return [0, 0, Math.sign(v[2])]
}

/** the face showing on top of a die turned `q` (the body axis nearest straight up) */
export function topFace(q: Q): Die {
  return faceOfAxis(nearestAxis(rotate(qconj(q), [0, 1, 0])))
}

/** how far a die turned `q` is from lying flat, radians */
export function tiltOf(q: Q): number {
  const up = rotate(qconj(q), [0, 1, 0])
  return Math.acos(Math.min(1, Math.max(Math.abs(up[0]), Math.abs(up[1]), Math.abs(up[2]))))
}

/** a die lying flat with `face` on top, turned `yaw` radians about the vertical */
export function restQuat(face: Die, yaw: number): Q {
  const [x, y, z] = FACE_AXIS[face]
  // the turn that stands the face's axis straight up
  const base: Q = y > 0 ? [0, 0, 0, 1] : y < 0 ? axisAngle(1, 0, 0, Math.PI) : z !== 0 ? axisAngle(z, 0, 0, -Math.PI / 2) : axisAngle(0, 0, x, Math.PI / 2)
  return normQ(qmul(axisAngle(0, 1, 0, yaw), base))
}

/** the 24 turns that map a cube onto itself, each with its axis and angle (0 to π) */
const CUBE_TURNS: readonly { q: Q; axis: V3; angle: number }[] = (() => {
  const out: { q: Q; axis: V3; angle: number }[] = [{ q: [0, 0, 0, 1], axis: [0, 1, 0], angle: 0 }]
  const add = (x: number, y: number, z: number, a: number) => {
    const l = Math.hypot(x, y, z)
    out.push({ q: axisAngle(x, y, z, a), axis: [x / l, y / l, z / l], angle: a })
  }
  // quarter and half turns about the face axes (three quarters = a quarter the other way)
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) {
    add(ax[0], ax[1], ax[2], Math.PI / 2)
    add(-ax[0], -ax[1], -ax[2], Math.PI / 2)
    add(ax[0], ax[1], ax[2], Math.PI)
  }
  // thirds of a turn about the four long diagonals, each way
  for (const [x, y, z] of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]] as V3[]) {
    add(x, y, z, (Math.PI * 2) / 3)
    add(-x, -y, -z, (Math.PI * 2) / 3)
  }
  // half turns about the six edge diagonals
  for (const [x, y, z] of [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]] as V3[]) add(x, y, z, Math.PI)
  return out
})()

/* ---------------- the shake ---------------- */

/** a seeded random source, so a roll can be worked out again exactly */
export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * One kick of the pedestal: the dome jolts up (and a little sideways, and rocks about a level axis) and straight
 * back, a full sine of velocity over `dur`, so it ends where it started. What lies on the floor is thrown up at about
 * the peak speed; what is in the air is not touched (the floor comes up and goes back under it).
 */
export interface Kick {
  t: number
  dur: number
  /** peak dome velocity (units/s) */
  u: V3
  /** peak rocking rate about x and z (rad/s) */
  rx: number
  rz: number
  /** how hard, 0-1, for the sound and the camera */
  k: number
}

function makeKicks(r: () => number, quick: boolean): Kick[] {
  const out: Kick[] = []
  const n = quick ? 4 : 7 + Math.floor(r() * 2)
  let t = 0.05
  for (let i = 0; i < n; i++) {
    // the first throws the dice up off the felt; the last two are gentler and nearly straight up, so the dice settle
    // soon after and near where they fall rather than out at the glass
    const calm = i === n - 1 ? 0.25 : i === n - 2 ? 0.6 : 1
    const up = i === n - 1 ? 7.5 + r() * 2.5 : i === 0 ? 12 + r() * 2.5 : 9.5 + r() * 4.5
    const a = r() * Math.PI * 2
    const side = (1.2 + r() * 3.2) * calm
    const b = r() * Math.PI * 2
    const rock = (1.2 + r() * 2.6) * calm
    out.push({ t, dur: 0.042, u: [Math.cos(a) * side, up, Math.sin(a) * side], rx: Math.cos(b) * rock, rz: Math.sin(b) * rock, k: Math.min(1, up / 14.5) })
    t += quick ? 0.17 + r() * 0.04 : 0.2 + r() * 0.1
  }
  return out
}

/** the dome's offset (xyz) and tilt (about x and z, radians) at time t: what the kicks add up to */
function domeAt(kicks: readonly Kick[], t: number, out: Float64Array | Float32Array, o: number) {
  let dx = 0
  let dy = 0
  let dz = 0
  let tx = 0
  let tz = 0
  for (const k of kicks) {
    const tau = t - k.t
    if (tau <= 0 || tau >= k.dur) continue
    // ∫ U sin(2π τ / T) dτ
    const s = (k.dur / (Math.PI * 2)) * (1 - Math.cos((Math.PI * 2 * tau) / k.dur))
    dx += k.u[0] * s
    dy += k.u[1] * s
    dz += k.u[2] * s
    tx += k.rx * s
    tz += k.rz * s
  }
  out[o] = dx
  out[o + 1] = dy
  out[o + 2] = dz
  out[o + 3] = tx
  out[o + 4] = tz
}

/* ---------------- the record ---------------- */

/** a die lying at rest on the floor (its centre is HALF above it): where, and turned how */
export interface Pose {
  x: number
  z: number
  q: Q
}

export interface Hit {
  /** sim time of the knock */
  t: number
  /** how hard: the speed the surfaces met at */
  v: number
  die: number
  on: 'floor' | 'glass' | 'die'
  /** where, in the dome's frame */
  x: number
  y: number
  z: number
}

/** a stretch of a die's flight clear of everything */
export interface Window {
  t0: number
  t1: number
  /** how far it turned meanwhile (radians), and its spin in its own frame (rad/s, the mean) */
  spin: number
  w: V3
}

export interface Sim {
  /** samples (RATE per second) */
  n: number
  /** per sample, per die: position xyz in the dome's frame */
  pos: Float32Array
  /** per sample, per die: orientation xyzw as simulated (before any relabelling) */
  quat: Float32Array
  /** per sample: the dome's offset xyz and tilt about x and z */
  dome: Float32Array
  /** per sample, per die: 1 if it touched anything since the sample before */
  touch: Uint8Array
  hits: Hit[]
  kicks: Kick[]
  /** per die: its stretches of clear flight */
  windows: Window[][]
  /** at rest, s */
  end: number
  /** from here every die lies flat on the floor (it may still slide a touch): the faces can be read */
  readable: number
  /** the dice at rest, exactly flat */
  final: Pose[]
}

/* ---------------- the solver ---------------- */

/** the corners of a die's inner cube in its own frame, and its edges (pairs of corners one bit apart) */
const CORNER = new Float64Array(24)
for (let k = 0; k < 8; k++) CORNER.set([k & 1 ? CORE : -CORE, k & 2 ? CORE : -CORE, k & 4 ? CORE : -CORE], k * 3)
const EDGES: [number, number][] = []
for (let a = 0; a < 8; a++) for (const bit of [1, 2, 4]) if (!(a & bit)) EDGES.push([a, a | bit])
/** an edge's end in another die's frame can only matter within this far of its centre, along each axis */
const EDGE_BOX = CORE + 2 * ROUND + AHEAD

/** past the inner cube's face along one axis (signed), 0 within it */
const outside = (x: number) => (x > CORE ? x - CORE : x < -CORE ? x + CORE : 0)
/** half the slope of the squared distance to the inner cube, along a + s d */
const slope = (ax: number, ay: number, az: number, dx: number, dy: number, dz: number, s: number) => dx * outside(ax + s * dx) + dy * outside(ay + s * dy) + dz * outside(az + s * dz)
const brk = new Float64Array(8)

/**
 * Where on the segment a + s d (s from 0 to 1) it comes nearest the inner cube (local frame). The squared distance is
 * convex along the segment and its slope piecewise linear, changing only where a coordinate crosses a face's plane:
 * so the slope is checked at those breaks in order, and solved exactly between the two where it turns from falling
 * to rising.
 */
function nearestOnEdge(ax: number, ay: number, az: number, dx: number, dy: number, dz: number) {
  if (slope(ax, ay, az, dx, dy, dz, 0) >= 0) return 0
  if (slope(ax, ay, az, dx, dy, dz, 1) <= 0) return 1
  let n = 0
  brk[n++] = 0
  for (let k = 0; k < 3; k++) {
    const a = k === 0 ? ax : k === 1 ? ay : az
    const d = k === 0 ? dx : k === 1 ? dy : dz
    if (Math.abs(d) < 1e-12) continue
    for (let side = -1; side <= 1; side += 2) {
      const s = (side * CORE - a) / d
      if (s > 0 && s < 1) brk[n++] = s
    }
  }
  brk[n++] = 1
  // (a handful of breaks: insertion sort)
  for (let i = 1; i < n; i++) {
    const v = brk[i]
    let j = i - 1
    while (j >= 0 && brk[j] > v) {
      brk[j + 1] = brk[j]
      j--
    }
    brk[j + 1] = v
  }
  let s0 = 0
  let g0 = slope(ax, ay, az, dx, dy, dz, 0)
  for (let i = 1; i < n; i++) {
    const s1 = brk[i]
    const g1 = slope(ax, ay, az, dx, dy, dz, s1)
    if (g1 >= 0) return g1 - g0 > 1e-15 ? s0 - (g0 * (s1 - s0)) / (g1 - g0) : s1
    s0 = s1
    g0 = g1
  }
  return 1
}
/** a point on a die's inner cube can only touch another die within this distance of that die's centre */
const PT_R2 = (Math.sqrt(3) * CORE + 2 * ROUND + AHEAD) ** 2
const PAIR_R2 = (2 * REACH + AHEAD) ** 2
const PAIRS: readonly [number, number][] = [
  [0, 1],
  [0, 2],
  [1, 2],
]

const FLOOR = 0
const WALL = 1
const BODY = 2

/** how far a point is above the cove's slope (along its normal; the slope extended below the floor inwards) */
export const coveGap = (x: number, y: number, z: number) => -(Math.hypot(x, z) - FLAT_R) * COVE_S + y * COVE_C

// a contact's slots in the contact buffer: its bodies and kind; then for the normal (from b into a) and the two
// friction directions in turn: the direction (3 each), ra × it and rb × it (the lever arms), its effective mass and
// the impulse so far; the target normal velocity (a bounce, or a push out) and the friction coefficient
const CA = 0 // the die
const CB = 1 // the other die, or -1 for the dome
const KIND = 2
const NX = 3
const RAN = 12
const RBN = 21
const KN = 30
const TGT = 33
const JN = 34
const MU = 37
const F = 38
const MAXC = 160

class World {
  readonly p = new Float64Array(N * 3)
  readonly v = new Float64Array(N * 3)
  readonly q = new Float64Array(N * 4)
  readonly w = new Float64Array(N * 3)
  /** rotation matrices (row-major) and the corners' offsets from the centre, in the dome's frame */
  readonly R = new Float64Array(N * 9)
  readonly off = new Float64Array(N * 24)
  readonly c = new Float64Array(MAXC * F)
  nc = 0
  /** per die this step: contacts, and on the floor */
  readonly touching = new Uint8Array(N)
  readonly onFloor = new Uint8Array(N)
  // what touched last step, for telling new knocks from resting contact
  private readonly cornerWas = new Uint8Array(N * 8)
  private readonly cornerNow = new Uint8Array(N * 8)
  private readonly glassWas = new Uint8Array(N)
  private readonly glassNow = new Uint8Array(N)
  private readonly pairWas = new Uint8Array(3)
  private readonly pairNow = new Uint8Array(3)
  private readonly lastHit = new Float64Array(N * 2 + 3).fill(-1)
  /** the hardest new knock this step per die on the floor and the glass, and per pair (speed, and where) */
  private readonly knock = new Float64Array((N * 2 + 3) * 4)
  private readonly local = new Float64Array(24)
  private readonly hitK = new Uint8Array(8)
  readonly hits: Hit[] = []

  constructor(start: readonly Pose[]) {
    for (let i = 0; i < N; i++) {
      const s = start[i]
      this.p.set([s.x, HALF, s.z], i * 3)
      this.q.set(normQ(s.q), i * 4)
    }
  }

  /** rotation matrices and corner offsets from the orientations */
  frames() {
    const { q, R, off } = this
    for (let i = 0; i < N; i++) {
      const x = q[i * 4]
      const y = q[i * 4 + 1]
      const z = q[i * 4 + 2]
      const w = q[i * 4 + 3]
      const o = i * 9
      R[o] = 1 - 2 * (y * y + z * z)
      R[o + 1] = 2 * (x * y - w * z)
      R[o + 2] = 2 * (x * z + w * y)
      R[o + 3] = 2 * (x * y + w * z)
      R[o + 4] = 1 - 2 * (x * x + z * z)
      R[o + 5] = 2 * (y * z - w * x)
      R[o + 6] = 2 * (x * z - w * y)
      R[o + 7] = 2 * (y * z + w * x)
      R[o + 8] = 1 - 2 * (x * x + y * y)
      for (let k = 0; k < 8; k++) {
        const cx = CORNER[k * 3]
        const cy = CORNER[k * 3 + 1]
        const cz = CORNER[k * 3 + 2]
        off[i * 24 + k * 3] = R[o] * cx + R[o + 1] * cy + R[o + 2] * cz
        off[i * 24 + k * 3 + 1] = R[o + 3] * cx + R[o + 4] * cy + R[o + 5] * cz
        off[i * 24 + k * 3 + 2] = R[o + 6] * cx + R[o + 7] * cy + R[o + 8] * cz
      }
    }
  }

  /**
   * Adds a contact on die a (against die b, or the dome when b < 0) at offset (rx, ry, rz) from a's centre, normal n
   * pointing from b into a, `depth` deep (negative: a gap, made only if it closes this step). Returns the speed the
   * two meet at (0 if they are parting), or -1 when no contact was made.
   */
  add(a: number, b: number, kind: number, nx: number, ny: number, nz: number, rx: number, ry: number, rz: number, depth: number, e: number, mu: number) {
    if (this.nc >= MAXC) return -1
    const { p, v, w, c } = this
    // the other body's lever arm to the same point
    let sx = 0
    let sy = 0
    let sz = 0
    if (b >= 0) {
      sx = p[a * 3] + rx - p[b * 3]
      sy = p[a * 3 + 1] + ry - p[b * 3 + 1]
      sz = p[a * 3 + 2] + rz - p[b * 3 + 2]
    }
    // relative velocity at the point
    let ux = v[a * 3] + (w[a * 3 + 1] * rz - w[a * 3 + 2] * ry)
    let uy = v[a * 3 + 1] + (w[a * 3 + 2] * rx - w[a * 3] * rz)
    let uz = v[a * 3 + 2] + (w[a * 3] * ry - w[a * 3 + 1] * rx)
    if (b >= 0) {
      ux -= v[b * 3] + (w[b * 3 + 1] * sz - w[b * 3 + 2] * sy)
      uy -= v[b * 3 + 1] + (w[b * 3 + 2] * sx - w[b * 3] * sz)
      uz -= v[b * 3 + 2] + (w[b * 3] * sy - w[b * 3 + 1] * sx)
    }
    const vn = ux * nx + uy * ny + uz * nz
    // a gap that cannot close this step needs no contact (one that might, if the step's other knocks speed it up, does)
    if (depth < 0 && vn * DT > depth + 0.5 * AHEAD) return -1
    const o = this.nc++ * F
    // friction acts along the slip, or any way across the normal when there is none
    let t1x = ux - vn * nx
    let t1y = uy - vn * ny
    let t1z = uz - vn * nz
    let tl = Math.hypot(t1x, t1y, t1z)
    if (tl < 1e-6) {
      if (Math.abs(nx) < 0.9) {
        t1x = 0
        t1y = nz
        t1z = -ny
      } else {
        t1x = -nz
        t1y = 0
        t1z = nx
      }
      tl = Math.hypot(t1x, t1y, t1z)
    }
    t1x /= tl
    t1y /= tl
    t1z /= tl
    const t2x = ny * t1z - nz * t1y
    const t2y = nz * t1x - nx * t1z
    const t2z = nx * t1y - ny * t1x
    c[o + CA] = a
    c[o + CB] = b
    c[o + KIND] = kind
    const inv = b >= 0 ? 2 : 1
    for (let d = 0; d < 3; d++) {
      const dx = d === 0 ? nx : d === 1 ? t1x : t2x
      const dy = d === 0 ? ny : d === 1 ? t1y : t2y
      const dz = d === 0 ? nz : d === 1 ? t1z : t2z
      c[o + NX + d * 3] = dx
      c[o + NX + d * 3 + 1] = dy
      c[o + NX + d * 3 + 2] = dz
      const ax = ry * dz - rz * dy
      const ay = rz * dx - rx * dz
      const az = rx * dy - ry * dx
      c[o + RAN + d * 3] = ax
      c[o + RAN + d * 3 + 1] = ay
      c[o + RAN + d * 3 + 2] = az
      let k = inv + INV_I * (ax * ax + ay * ay + az * az)
      if (b >= 0) {
        const bx = sy * dz - sz * dy
        const by = sz * dx - sx * dz
        const bz = sx * dy - sy * dx
        c[o + RBN + d * 3] = bx
        c[o + RBN + d * 3 + 1] = by
        c[o + RBN + d * 3 + 2] = bz
        k += INV_I * (bx * bx + by * by + bz * bz)
      }
      c[o + KN + d] = 1 / k
    }
    // a fast arrival (now, or within this step) bounces; otherwise overlap is pushed out, or a gap may close exactly
    const bounce = vn < -BOUNCE_V && vn * DT <= depth ? -e * vn : 0
    c[o + TGT] = depth < 0 ? bounce || depth / DT : Math.max(bounce, Math.min(MAX_PUSH, (BETA / DT) * Math.max(0, depth - SLOP)))
    c[o + JN] = c[o + JN + 1] = c[o + JN + 2] = 0
    c[o + MU] = mu
    this.touching[a] = 1
    if (b >= 0) this.touching[b] = 1
    return Math.max(0, -vn)
  }

  /** a point of die a (its inner cube's, at local (lx, ly, lz) in b's frame, offset (ox, oy, oz) from a) against die b */
  private pointBox(a: number, b: number, lx: number, ly: number, lz: number, ox: number, oy: number, oz: number) {
    if (lx * lx + ly * ly + lz * lz > PT_R2) return -1
    const cx = lx < -CORE ? -CORE : lx > CORE ? CORE : lx
    const cy = ly < -CORE ? -CORE : ly > CORE ? CORE : ly
    const cz = lz < -CORE ? -CORE : lz > CORE ? CORE : lz
    let dx = lx - cx
    let dy = ly - cy
    let dz = lz - cz
    const d2 = dx * dx + dy * dy + dz * dz
    let depth: number
    if (d2 > 1e-14) {
      if (d2 >= (2 * ROUND + AHEAD) ** 2) return -1
      const d = Math.sqrt(d2)
      dx /= d
      dy /= d
      dz /= d
      depth = 2 * ROUND - d
    } else {
      // inside b's inner cube: out through its nearest face
      const ex = CORE - Math.abs(lx)
      const ey = CORE - Math.abs(ly)
      const ez = CORE - Math.abs(lz)
      dx = dy = dz = 0
      if (ex <= ey && ex <= ez) dx = Math.sign(lx) || 1
      else if (ey <= ez) dy = Math.sign(ly) || 1
      else dz = Math.sign(lz) || 1
      depth = 2 * ROUND + Math.min(ex, ey, ez)
    }
    const R = this.R
    const o = b * 9
    const nx = R[o] * dx + R[o + 1] * dy + R[o + 2] * dz
    const ny = R[o + 3] * dx + R[o + 4] * dy + R[o + 5] * dz
    const nz = R[o + 6] * dx + R[o + 7] * dy + R[o + 8] * dz
    return this.add(a, b, BODY, nx, ny, nz, ox - nx * ROUND, oy - ny * ROUND, oz - nz * ROUND, depth, BONE.e, BONE.mu)
  }

  /** die a's corners, and the edges between corners that did not touch, against die b; the hardest knock */
  private pair(a: number, b: number) {
    const { p, R, off, local: L, hitK } = this
    const o = b * 9
    let knock = 0
    for (let k = 0; k < 8; k++) {
      const ox = off[a * 24 + k * 3]
      const oy = off[a * 24 + k * 3 + 1]
      const oz = off[a * 24 + k * 3 + 2]
      const rx = p[a * 3] + ox - p[b * 3]
      const ry = p[a * 3 + 1] + oy - p[b * 3 + 1]
      const rz = p[a * 3 + 2] + oz - p[b * 3 + 2]
      const lx = R[o] * rx + R[o + 3] * ry + R[o + 6] * rz
      const ly = R[o + 1] * rx + R[o + 4] * ry + R[o + 7] * rz
      const lz = R[o + 2] * rx + R[o + 5] * ry + R[o + 8] * rz
      L[k * 3] = lx
      L[k * 3 + 1] = ly
      L[k * 3 + 2] = lz
      const s = this.pointBox(a, b, lx, ly, lz, ox, oy, oz)
      hitK[k] = s >= 0 ? 1 : 0
      if (s > knock) knock = s
    }
    // two dice meeting edge to edge touch between their corners: each edge near b at its point nearest b's inner cube
    // (an edge lying on b with both ends touching is held up by its corners already)
    for (const [i, j] of EDGES) {
      if (hitK[i] && hitK[j]) continue
      const ax = L[i * 3]
      const ay = L[i * 3 + 1]
      const az = L[i * 3 + 2]
      const bx = L[j * 3]
      const by = L[j * 3 + 1]
      const bz = L[j * 3 + 2]
      if (Math.min(ax, bx) > EDGE_BOX || Math.max(ax, bx) < -EDGE_BOX || Math.min(ay, by) > EDGE_BOX || Math.max(ay, by) < -EDGE_BOX || Math.min(az, bz) > EDGE_BOX || Math.max(az, bz) < -EDGE_BOX) continue
      const f = nearestOnEdge(ax, ay, az, bx - ax, by - ay, bz - az)
      // at a touching corner: that corner's contact is the one
      if ((f < 0.02 && hitK[i]) || (f > 0.98 && hitK[j])) continue
      const g = 1 - f
      const s = this.pointBox(
        a,
        b,
        ax * g + bx * f,
        ay * g + by * f,
        az * g + bz * f,
        off[a * 24 + i * 3] * g + off[a * 24 + j * 3] * f,
        off[a * 24 + i * 3 + 1] * g + off[a * 24 + j * 3 + 1] * f,
        off[a * 24 + i * 3 + 2] * g + off[a * 24 + j * 3 + 2] * f,
      )
      if (s > knock) knock = s
    }
    return knock
  }

  /** how far die i's centre is from die j's surface (as j is, unturned) */
  gap(i: number, j: number) {
    const { p, R } = this
    const o = j * 9
    const rx = p[i * 3] - p[j * 3]
    const ry = p[i * 3 + 1] - p[j * 3 + 1]
    const rz = p[i * 3 + 2] - p[j * 3 + 2]
    const lx = Math.abs(R[o] * rx + R[o + 3] * ry + R[o + 6] * rz)
    const ly = Math.abs(R[o + 1] * rx + R[o + 4] * ry + R[o + 7] * rz)
    const lz = Math.abs(R[o + 2] * rx + R[o + 5] * ry + R[o + 8] * rz)
    return Math.hypot(Math.max(0, lx - CORE), Math.max(0, ly - CORE), Math.max(0, lz - CORE)) - ROUND
  }

  private noteKnock(key: number, speed: number, x: number, y: number, z: number) {
    const o = key * 4
    if (speed <= this.knock[o]) return
    this.knock[o] = speed
    this.knock[o + 1] = x
    this.knock[o + 2] = y
    this.knock[o + 3] = z
  }

  /** every contact this step: corners on the felt and against the glass, then die against die */
  contacts() {
    const { p, off } = this
    this.nc = 0
    this.touching.fill(0)
    this.onFloor.fill(0)
    this.cornerNow.fill(0)
    this.glassNow.fill(0)
    this.pairNow.fill(0)
    this.knock.fill(0)
    for (let i = 0; i < N; i++) {
      const px = p[i * 3]
      const py = p[i * 3 + 1]
      const pz = p[i * 3 + 2]
      // nothing of the die can reach the floor, the cove or the glass from here
      const far = py > REACH + AHEAD && Math.hypot(px, py, pz) < DOME_R - REACH - AHEAD && coveGap(px, py, pz) > REACH + AHEAD
      if (far) continue
      for (let k = 0; k < 8; k++) {
        const ox = off[i * 24 + k * 3]
        const oy = off[i * 24 + k * 3 + 1]
        const oz = off[i * 24 + k * 3 + 2]
        const cx = px + ox
        const cy = py + oy
        const cz = pz + oz
        if (cy < ROUND + AHEAD) {
          const s = this.add(i, -1, FLOOR, 0, 1, 0, ox, oy - ROUND, oz, ROUND - cy, FELT.e, FELT.mu)
          if (s >= 0) {
            this.onFloor[i] = 1
            this.cornerNow[i * 8 + k] = 1
            if (!this.cornerWas[i * 8 + k]) this.noteKnock(i, s, cx, 0, cz)
          }
        }
        const cg = coveGap(cx, cy, cz)
        if (cg < ROUND + AHEAD) {
          // the cove's normal: up and in
          const r = Math.hypot(cx, cz) || 1
          const nx = (-COVE_S * cx) / r
          const nz = (-COVE_S * cz) / r
          const s = this.add(i, -1, FLOOR, nx, COVE_C, nz, ox - nx * ROUND, oy - COVE_C * ROUND, oz - nz * ROUND, ROUND - cg, SLOPE.e, SLOPE.mu)
          if (s >= 0) {
            this.cornerNow[i * 8 + k] = 1
            if (!this.cornerWas[i * 8 + k]) this.noteKnock(i, s, cx - nx * ROUND, cy - COVE_C * ROUND, cz - nz * ROUND)
          }
        }
        const d = Math.hypot(cx, cy, cz)
        if (d + ROUND + AHEAD > DOME_R) {
          const ux = cx / d
          const uy = cy / d
          const uz = cz / d
          const s = this.add(i, -1, WALL, -ux, -uy, -uz, ox + ux * ROUND, oy + uy * ROUND, oz + uz * ROUND, d + ROUND - DOME_R, GLASS.e, GLASS.mu)
          if (s >= 0) {
            this.glassNow[i] = 1
            if (!this.glassWas[i]) this.noteKnock(N + i, s, cx + ux * ROUND, cy + uy * ROUND, cz + uz * ROUND)
          }
        }
      }
    }
    for (let pi = 0; pi < PAIRS.length; pi++) {
      const [a, b] = PAIRS[pi]
      const dx = p[a * 3] - p[b * 3]
      const dy = p[a * 3 + 1] - p[b * 3 + 1]
      const dz = p[a * 3 + 2] - p[b * 3 + 2]
      if (dx * dx + dy * dy + dz * dz > PAIR_R2) continue
      const before = this.nc
      const s = Math.max(this.pair(a, b), this.pair(b, a))
      if (this.nc > before) {
        this.pairNow[pi] = 1
        if (!this.pairWas[pi]) this.noteKnock(2 * N + pi, s, (p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2)
      }
    }
  }

  /** the knocks this step that are worth a sound (each surface at most every 40 ms) */
  hitsAt(t: number) {
    for (let key = 0; key < N * 2 + 3; key++) {
      const s = this.knock[key * 4]
      if (s < HIT_V || t - this.lastHit[key] < 0.04) continue
      this.lastHit[key] = t
      const on = key < N ? 'floor' : key < 2 * N ? 'glass' : 'die'
      const die = key < 2 * N ? key % N : PAIRS[key - 2 * N][0]
      this.hits.push({ t, v: s, die, on, x: this.knock[key * 4 + 1], y: this.knock[key * 4 + 2], z: this.knock[key * 4 + 3] })
    }
    this.cornerWas.set(this.cornerNow)
    this.glassWas.set(this.glassNow)
    this.pairWas.set(this.pairNow)
  }

  /** sequential impulses: each contact in turn pushes its bodies apart and holds them by friction */
  solve() {
    const { v, w, c } = this
    const nc = this.nc
    for (let it = 0; it < ITER; it++)
      for (let n = 0; n < nc; n++) {
        const o = n * F
        const a = c[o + CA]
        const b = c[o + CB]
        for (let d = 0; d < 3; d++) {
          const dx = c[o + NX + d * 3]
          const dy = c[o + NX + d * 3 + 1]
          const dz = c[o + NX + d * 3 + 2]
          const ax = c[o + RAN + d * 3]
          const ay = c[o + RAN + d * 3 + 1]
          const az = c[o + RAN + d * 3 + 2]
          let u = dx * v[a * 3] + dy * v[a * 3 + 1] + dz * v[a * 3 + 2] + ax * w[a * 3] + ay * w[a * 3 + 1] + az * w[a * 3 + 2]
          let bx = 0
          let by = 0
          let bz = 0
          if (b >= 0) {
            bx = c[o + RBN + d * 3]
            by = c[o + RBN + d * 3 + 1]
            bz = c[o + RBN + d * 3 + 2]
            u -= dx * v[b * 3] + dy * v[b * 3 + 1] + dz * v[b * 3 + 2] + bx * w[b * 3] + by * w[b * 3 + 1] + bz * w[b * 3 + 2]
          }
          let j: number
          if (d === 0) {
            // the normal: never pulls
            const acc = c[o + JN]
            const nj = Math.max(0, acc + (c[o + TGT] - u) * c[o + KN])
            j = nj - acc
            c[o + JN] = nj
          } else {
            // friction: no more than mu times the push
            const slot = o + JN + d
            const lim = c[o + MU] * c[o + JN]
            const acc = c[slot]
            let nj = acc - u * c[o + KN + d]
            nj = nj < -lim ? -lim : nj > lim ? lim : nj
            j = nj - acc
            c[slot] = nj
          }
          if (j === 0) continue
          v[a * 3] += j * dx
          v[a * 3 + 1] += j * dy
          v[a * 3 + 2] += j * dz
          w[a * 3] += INV_I * j * ax
          w[a * 3 + 1] += INV_I * j * ay
          w[a * 3 + 2] += INV_I * j * az
          if (b >= 0) {
            v[b * 3] -= j * dx
            v[b * 3 + 1] -= j * dy
            v[b * 3 + 2] -= j * dz
            w[b * 3] -= INV_I * j * bx
            w[b * 3 + 1] -= INV_I * j * by
            w[b * 3 + 2] -= INV_I * j * bz
          }
        }
      }
  }

  /** gravity and the kick's pseudo-forces (the floor's push up and sideways, its rocking), before the contacts */
  forces(ax: number, ay: number, az: number, alx: number, alz: number) {
    const { p, v, w } = this
    for (let i = 0; i < N; i++) {
      const px = p[i * 3]
      const py = p[i * 3 + 1]
      const pz = p[i * 3 + 2]
      // in the dome's frame: g - a - α × r, and the dome's own angular acceleration taken off the die's spin
      v[i * 3] += (-ax + alz * py) * DT
      v[i * 3 + 1] += (-GRAV - ay - (alz * px - alx * pz)) * DT
      v[i * 3 + 2] += (-az - alx * py) * DT
      w[i * 3] -= alx * DT
      w[i * 3 + 2] -= alz * DT
    }
  }

  integrate() {
    const { p, v, q, w } = this
    for (let i = 0; i < N; i++) {
      p[i * 3] += v[i * 3] * DT
      p[i * 3 + 1] += v[i * 3 + 1] * DT
      p[i * 3 + 2] += v[i * 3 + 2] * DT
      if (this.onFloor[i]) {
        const k = 1 - FELT_DRAG * DT
        w[i * 3] *= k
        w[i * 3 + 1] *= k
        w[i * 3 + 2] *= k
      }
      const wx = w[i * 3]
      const wy = w[i * 3 + 1]
      const wz = w[i * 3 + 2]
      let qx = q[i * 4]
      let qy = q[i * 4 + 1]
      let qz = q[i * 4 + 2]
      let qw = q[i * 4 + 3]
      const h = 0.5 * DT
      const dx = h * (wx * qw + wy * qz - wz * qy)
      const dy = h * (wy * qw + wz * qx - wx * qz)
      const dz = h * (wz * qw + wx * qy - wy * qx)
      const dw = h * (-wx * qx - wy * qy - wz * qz)
      qx += dx
      qy += dy
      qz += dz
      qw += dw
      const l = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
      q[i * 4] = qx * l
      q[i * 4 + 1] = qy * l
      q[i * 4 + 2] = qz * l
      q[i * 4 + 3] = qw * l
    }
  }
}

/* ---------------- a roll, simulated ---------------- */

/**
 * Shakes the dome with the dice lying at `start` (seeded, so the same seed shakes the same way) until they are at
 * rest. Gives up (null) on a roll that does not settle in time, or ends with a die not lying flat on the floor (on
 * another die, or leaning on one).
 */
export function simulate(start: readonly Pose[], seed: number, quick = false, maxT = 6): Sim | null {
  const r = mulberry(seed)
  const kicks = makeKicks(r, quick)
  const lastKick = kicks[kicks.length - 1]
  const kickEnd = lastKick.t + lastKick.dur
  const W = new World(start)
  const cap = Math.ceil(maxT * RATE) + 2
  const pos = new Float32Array(cap * N * 3)
  const quat = new Float32Array(cap * N * 4)
  const dome = new Float32Array(cap * 5)
  const touch = new Uint8Array(cap * N)
  const touched = new Uint8Array(N)
  const windows: Window[][] = [[], [], []]
  const run = Array.from({ length: N }, () => ({ on: false, t0: 0, spin: 0, wx: 0, wy: 0, wz: 0 }))
  let n = 0
  let still = 0
  let readable = 0
  const steps = Math.ceil(maxT / DT)
  const { p, v, q, w, R } = W

  for (let s = 0; s <= steps; s++) {
    const t = s * DT
    W.frames()
    if (s % EVERY === 0 && n < cap) {
      pos.set(p, n * N * 3)
      quat.set(q, n * N * 4)
      touch.set(touched, n * N)
      touched.fill(0)
      domeAt(kicks, t, dome, n * 5)
      n++
    }

    // the kicks' pseudo-forces: the dome's acceleration and its rocking's
    let ax = 0
    let ay = 0
    let az = 0
    let alx = 0
    let alz = 0
    for (const k of kicks) {
      const tau = t - k.t
      if (tau <= 0 || tau >= k.dur) continue
      const c = ((Math.PI * 2) / k.dur) * Math.cos((Math.PI * 2 * tau) / k.dur)
      ax += k.u[0] * c
      ay += k.u[1] * c
      az += k.u[2] * c
      alx += k.rx * c
      alz += k.rz * c
    }
    W.forces(ax, ay, az, alx, alz)
    W.contacts()
    W.hitsAt(t)
    for (let i = 0; i < N; i++) if (W.touching[i]) touched[i] = 1

    // stretches of clear flight, where a die's pips may be turned (as the dice are now, before this step)
    for (let i = 0; i < N; i++) {
      const px = p[i * 3]
      const py = p[i * 3 + 1]
      const pz = p[i * 3 + 2]
      let clear = !W.touching[i] && py >= REACH + CLEAR && Math.hypot(px, py, pz) <= DOME_R - REACH - CLEAR && coveGap(px, py, pz) >= REACH + CLEAR
      for (let j = 0; j < N && clear; j++) if (j !== i && W.gap(i, j) < REACH + CLEAR) clear = false
      const ru = run[i]
      if (clear) {
        if (!ru.on) {
          ru.on = true
          ru.t0 = t
          ru.spin = ru.wx = ru.wy = ru.wz = 0
        }
        const wx = w[i * 3]
        const wy = w[i * 3 + 1]
        const wz = w[i * 3 + 2]
        ru.spin += Math.hypot(wx, wy, wz) * DT
        // the spin in the die's own frame (Rᵀ w), which stays put while it flies free
        const o = i * 9
        ru.wx += (R[o] * wx + R[o + 3] * wy + R[o + 6] * wz) * DT
        ru.wy += (R[o + 1] * wx + R[o + 4] * wy + R[o + 7] * wz) * DT
        ru.wz += (R[o + 2] * wx + R[o + 5] * wy + R[o + 8] * wz) * DT
      } else if (ru.on) {
        ru.on = false
        const d = t - ru.t0
        if (d >= MIN_WINDOW) windows[i].push({ t0: ru.t0, t1: t, spin: ru.spin, w: [ru.wx / d, ru.wy / d, ru.wz / d] })
      }
    }
    W.solve()
    W.integrate()

    // flat on the felt: the faces can be read from here; and at rest, a little after the last kick
    let allFlat = true
    let allStill = t > kickEnd + 0.1
    for (let i = 0; i < N; i++) {
      const o = i * 9
      const up = Math.max(Math.abs(R[o + 3]), Math.abs(R[o + 4]), Math.abs(R[o + 5]))
      const flat = W.onFloor[i] && up > 0.9986 && p[i * 3 + 1] < HALF + 0.02
      if (!flat) allFlat = false
      const vv = v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2
      const ww = w[i * 3] ** 2 + w[i * 3 + 1] ** 2 + w[i * 3 + 2] ** 2
      if (!flat || vv > 0.006 || ww > 0.02) allStill = false
    }
    if (!allFlat || t < kickEnd) readable = t + DT
    still = allStill ? still + DT : 0
    if (still >= 0.15) {
      const end = (n - 1) / RATE
      const final = settleFlat(pos, quat, n)
      if (!final) return null
      return {
        n,
        pos: pos.slice(0, n * N * 3),
        quat: quat.slice(0, n * N * 4),
        dome: dome.slice(0, n * 5),
        touch: touch.slice(0, n * N),
        hits: W.hits,
        kicks,
        windows,
        end,
        readable: Math.min(end, readable),
        final,
      }
    }
  }
  return null
}

/**
 * The dice at the end, set exactly flat on the felt: the last tenth of a second of samples eased onto the flat poses
 * (a hair's correction: they are already still). Null if one is not lying flat on the floor.
 */
function settleFlat(pos: Float32Array, quat: Float32Array, n: number): Pose[] | null {
  const out: Pose[] = []
  const K = Math.min(n - 1, Math.round(0.1 * RATE))
  for (let i = 0; i < N; i++) {
    const L = ((n - 1) * N + i) * 4
    const q: Q = normQ([quat[L], quat[L + 1], quat[L + 2], quat[L + 3]])
    const y = pos[((n - 1) * N + i) * 3 + 1]
    if (tiltOf(q) > 0.03 || Math.abs(y - HALF) > 0.012) return null
    // the small turn that stands its upper face exactly level
    const upB = nearestAxis(rotate(qconj(q), [0, 1, 0]))
    const now = rotate(q, upB)
    const fix = fromTo(now, [0, 1, 0])
    const flat = normQ(qmul(fix, q))
    for (let j = 0; j < K; j++) {
      const s = j + 1 === K ? 1 : smooth((j + 1) / K)
      const at = n - K + j
      const o = (at * N + i) * 4
      const a: Q = [quat[o], quat[o + 1], quat[o + 2], quat[o + 3]]
      quat.set(nlerp(a, flat, s), o)
      const po = (at * N + i) * 3
      pos[po + 1] += (HALF - pos[po + 1]) * s
    }
    const po = ((n - 1) * N + i) * 3
    out.push({ x: pos[po], z: pos[po + 2], q: flat })
  }
  return out
}

/** the shortest turn taking unit vector a to unit vector b */
function fromTo(a: V3, b: V3): Q {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cx = a[1] * b[2] - a[2] * b[1]
  const cy = a[2] * b[0] - a[0] * b[2]
  const cz = a[0] * b[1] - a[1] * b[0]
  return normQ([cx, cy, cz, 1 + d])
}

const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

/** the normalised blend of two orientations, the short way round */
function nlerp(a: Q, b: Q, t: number): Q {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1
  return normQ([a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t])
}

/* ---------------- landing on the drawn faces ---------------- */

/** the turn blended into a die's pips across a stretch of clear flight: about `axis` (its own frame) by `angle` */
export interface Turn {
  t0: number
  t1: number
  axis: V3
  angle: number
  /** the whole turn */
  q: Q
}

export interface Roll {
  sim: Sim
  /** the dice as they lay before the shake (the roll starts exactly from them) */
  start: Pose[]
  /** the dice at rest after it, showing the drawn faces */
  final: Pose[]
  faces: Die[]
  /** per die: the turn of its pips, or null when the face that physics gives is already the drawn one */
  turns: (Turn | null)[]
  /** how many rolls were simulated to find this one, and how long that took (ms) */
  tries: number
  ms: number
}

/**
 * The turn that makes a die that physics leaves `phys` up show `want` instead, blended across one of its windows of
 * clear flight; null if no window will do. Of the four turns that map the faces, the smallest is taken, about the
 * axis the die already spins on where that ties (a turn along the spin just reads as a little more spin), in the
 * window where it hides best.
 */
function chooseTurn(phys: Die, want: Die, windows: readonly Window[], free: (w: Window) => boolean): Turn | null {
  const mE = FACE_AXIS[phys]
  const mD = FACE_AXIS[want]
  let best: Turn | null = null
  let bestCost = Infinity
  for (const c of CUBE_TURNS) {
    const m = rotate(c.q, mD)
    if (m[0] * mE[0] + m[1] * mE[1] + m[2] * mE[2] < 0.99) continue
    for (const win of windows) {
      if (!free(win)) continue
      const dur = win.t1 - win.t0
      const wl = Math.hypot(win.w[0], win.w[1], win.w[2]) || 1
      let axis = c.axis
      let along = (axis[0] * win.w[0] + axis[1] * win.w[1] + axis[2] * win.w[2]) / wl
      // a half turn goes either way round: the way the die spins
      if (c.angle > 3 && along < 0) {
        axis = [-axis[0], -axis[1], -axis[2]]
        along = -along
      }
      // what of the turn the spin does not hide, as a share of how far the die turns anyway, and how quick it is
      const shown = c.angle * (1 - 0.75 * Math.max(0, along))
      const cost = shown / (win.spin + 0.5) + shown / dur / 25 + c.angle * 0.05
      if (shown / dur > 16) continue
      if (cost < bestCost) {
        bestCost = cost
        best = { t0: win.t0, t1: win.t1, axis, angle: c.angle, q: axisAngle(axis[0], axis[1], axis[2], c.angle) }
      }
    }
  }
  return best
}

/**
 * Works out a roll from the dice lying at `start` to rest showing `faces` (in order: die 0, 1, 2). Simulates shakes
 * until one settles well and every die that needs its pips turned has a clear moment to turn them in; each try takes
 * a few milliseconds. `quick` is turbo's shorter shake.
 */
export function planRoll(start: readonly Pose[], faces: readonly Die[], o: { quick?: boolean; rnd?: () => number; tries?: number } = {}): Roll {
  const rnd = o.rnd ?? Math.random
  const t0 = performance.now()
  let fallback: { sim: Sim; turns: (Turn | null)[] } | null = null
  const tries = o.tries ?? 60
  for (let k = 1; k <= tries; k++) {
    const sim = simulate(start, Math.floor(rnd() * 2 ** 32), !!o.quick)
    const turns = sim && assignTurns(sim, faces)
    if (!sim || !turns) continue
    // a shake of the usual length, the dice ending where the camera reads them well (off the very edge of the floor)
    if (sim.end <= (o.quick ? 2.3 : 3.6) && sim.final.every((f) => Math.hypot(f.x, f.z) < DOME_R - 0.8)) return finish(sim, turns, start, faces, k, t0)
    fallback ??= { sim, turns }
  }
  if (fallback) return finish(fallback.sim, fallback.turns, start, faces, tries, t0)
  // never expected: try on, letting the shake settle for longer
  for (let k = 1; k <= 500; k++) {
    const sim = simulate(start, Math.floor(rnd() * 2 ** 32), !!o.quick, 9)
    const turns = sim && assignTurns(sim, faces)
    if (sim && turns) return finish(sim, turns, start, faces, tries + k, t0)
  }
  throw new Error('sicbo: no roll found')
}

/**
 * The turns that make a simulated roll show `faces`, or null if some die that needs one has no window for it. Two
 * dice may be turned at the same moment only while they stay far enough apart that neither turn could reach the
 * other (each window is clear of the other die as it is, unturned).
 */
function assignTurns(sim: Sim, faces: readonly Die[]): (Turn | null)[] | null {
  const turns: (Turn | null)[] = []
  for (let i = 0; i < N; i++) {
    const phys = topFace(sim.final[i].q)
    if (phys === faces[i]) {
      turns.push(null)
      continue
    }
    const free = (w: Window) => turns.every((t, j) => !t || apartWhile(sim, i, j, Math.max(w.t0, t.t0), Math.min(w.t1, t.t1)))
    const t = chooseTurn(phys, faces[i], sim.windows[i], free)
    if (!t) return null
    turns.push(t)
  }
  return turns
}

/** whether dice i and j stay more than two reaches apart (and a margin, for the motion between samples) from t0 to t1 */
function apartWhile(sim: Sim, i: number, j: number, t0: number, t1: number) {
  for (let k = Math.floor(t0 * RATE); k <= Math.ceil(t1 * RATE) && k < sim.n; k++) {
    const a = (k * N + i) * 3
    const b = (k * N + j) * 3
    if (Math.hypot(sim.pos[a] - sim.pos[b], sim.pos[a + 1] - sim.pos[b + 1], sim.pos[a + 2] - sim.pos[b + 2]) < 2 * REACH + 0.1) return false
  }
  return true
}

function finish(sim: Sim, turns: (Turn | null)[], start: readonly Pose[], faces: readonly Die[], tries: number, t0: number): Roll {
  const final = sim.final.map((f, i) => ({ x: f.x, z: f.z, q: turns[i] ? normQ(qmul(f.q, turns[i]!.q)) : f.q }))
  return { sim, start: start.map((s) => ({ x: s.x, z: s.z, q: [...s.q] as Q })), final, faces: [...faces], turns, tries, ms: performance.now() - t0 }
}

/* ---------------- playing a roll back ---------------- */

/**
 * Die i's pose at time t of a roll, as shown: the simulated path and orientation, its pips turned within the body
 * by its turn (blended in across the turn's window), written into out as position xyz (dome frame) then
 * orientation xyzw. Exactly the start pose at t <= 0 and the final pose at the end.
 */
export function poseAt(roll: Roll, i: number, t: number, out: Float32Array | Float64Array | number[]) {
  const s = roll.sim
  if (t <= 0 || t >= s.end) {
    const p = t <= 0 ? roll.start[i] : roll.final[i]
    out[0] = p.x
    out[1] = HALF
    out[2] = p.z
    out[3] = p.q[0]
    out[4] = p.q[1]
    out[5] = p.q[2]
    out[6] = p.q[3]
    return
  }
  const x = t * RATE
  const j = Math.min(s.n - 2, Math.floor(x))
  const f = x - j
  const a = (j * N + i) * 3
  const b = ((j + 1) * N + i) * 3
  out[0] = s.pos[a] + (s.pos[b] - s.pos[a]) * f
  out[1] = s.pos[a + 1] + (s.pos[b + 1] - s.pos[a + 1]) * f
  out[2] = s.pos[a + 2] + (s.pos[b + 2] - s.pos[a + 2]) * f
  const qa = (j * N + i) * 4
  const qb = ((j + 1) * N + i) * 4
  const Qd = s.quat
  const sg = Qd[qa] * Qd[qb] + Qd[qa + 1] * Qd[qb + 1] + Qd[qa + 2] * Qd[qb + 2] + Qd[qa + 3] * Qd[qb + 3] < 0 ? -1 : 1
  let qx = Qd[qa] + (Qd[qb] * sg - Qd[qa]) * f
  let qy = Qd[qa + 1] + (Qd[qb + 1] * sg - Qd[qa + 1]) * f
  let qz = Qd[qa + 2] + (Qd[qb + 2] * sg - Qd[qa + 2]) * f
  let qw = Qd[qa + 3] + (Qd[qb + 3] * sg - Qd[qa + 3]) * f
  const l = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
  qx *= l
  qy *= l
  qz *= l
  qw *= l
  const turn = roll.turns[i]
  if (turn && t > turn.t0) {
    // q · turn(s): the pips turned within the body, s of the way
    const k = t >= turn.t1 ? 1 : smooth((t - turn.t0) / (turn.t1 - turn.t0))
    const h = Math.sin((turn.angle * k) / 2)
    const bx = turn.axis[0] * h
    const by = turn.axis[1] * h
    const bz = turn.axis[2] * h
    const bw = Math.cos((turn.angle * k) / 2)
    const rx = qw * bx + qx * bw + qy * bz - qz * by
    const ry = qw * by - qx * bz + qy * bw + qz * bx
    const rz = qw * bz + qx * by - qy * bx + qz * bw
    const rw = qw * bw - qx * bx - qy * by - qz * bz
    qx = rx
    qy = ry
    qz = rz
    qw = rw
  }
  out[3] = qx
  out[4] = qy
  out[5] = qz
  out[6] = qw
}

/** the dome's offset xyz and tilt about x and z at time t of a roll (still at the start and the end) */
export function domePose(roll: Roll, t: number, out: Float32Array | Float64Array | number[]) {
  const s = roll.sim
  const x = Math.max(0, Math.min(s.n - 1, t * RATE))
  const j = Math.min(s.n - 2, Math.floor(x))
  const f = x - j
  for (let k = 0; k < 5; k++) out[k] = s.dome[j * 5 + k] + (s.dome[(j + 1) * 5 + k] - s.dome[j * 5 + k]) * f
}

/**
 * Three dice lying apart near the middle of the floor showing `faces`, each turned its own way: where a first roll
 * starts from. They make a loose triangle with a corner pointing away from the front (+z, where the camera stands),
 * so none hides another.
 */
export function restPoses(faces: readonly Die[], rnd: () => number = Math.random): Pose[] {
  return faces.map((f, i) => {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / 3 + (rnd() - 0.5) * 0.35
    const d = 1.35 + rnd() * 0.25
    return { x: Math.cos(a) * d, z: Math.sin(a) * d, q: restQuat(f, rnd() * Math.PI * 2) }
  })
}
