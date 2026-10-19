import { CORE, HALF, REACH, ROUND, fromTo, nearestAxis, nlerp, normQ, qconj, qmul, rotate, smooth, tiltOf, type Pose, type Q } from './cube'

/*
  The rigid-body solver the dice games share: a few rounded dice, worked out by an impulse solver at 360 steps a
  second. Each game subclasses DiceWorld with the surfaces its dice meet (Sic Bo's dome, the Craps table) and the
  forces on them; the dice against each other, the solving and the stepping are here.

  A die is a cube with rounded edges: a sharp inner cube grown by ROUND, so it touches the world through balls at its
  eight corners and, against another die, also at the point of each nearby edge that comes closest (so two dice
  meeting edge to edge are caught exactly). Contacts have friction and a little bounce, are made a step ahead when a
  gap is about to close (speculatively), and are solved a few times a step. That is cheap enough to try a few rolls
  in a few milliseconds each.

  Units: a die's edge is 1; mass 1. Time is in seconds of the show at normal speed.
*/

export const DT = 1 / 360
/** a roll is recorded at this rate (samples per second) */
export const RATE = 120
/** steps per recorded sample */
export const EVERY = Math.round(1 / (DT * RATE))
/** a die's mass is 1, and a cube's inertia is the same about every axis through its centre: edge² / 6 */
const INV_I = 6
const ITER = 8
/** how hard overlap is pushed out (a share of it per step), what is let be, and how fast at most */
const BETA = 0.22
const SLOP = 0.003
const MAX_PUSH = 4
/** slower than this, a contact does not bounce */
const BOUNCE_V = 1.1
/** a knock worth a sound: a new contact arriving faster than this */
export const HIT_V = 1.3
/**
 * Contacts are made this far ahead (speculatively): a corner closing a gap within the step is caught as it arrives
 * rather than after it has sunk in
 */
export const AHEAD = 0.09

/** what a pair of surfaces does: bounce (restitution) and friction */
export interface Surface {
  e: number
  mu: number
}

/** the corners of a die's inner cube in its own frame, and its edges (pairs of corners one bit apart) */
export const CORNER = new Float64Array(24)
for (let k = 0; k < 8; k++) CORNER.set([k & 1 ? CORE : -CORE, k & 2 ? CORE : -CORE, k & 4 ? CORE : -CORE], k * 3)
export const EDGES: [number, number][] = []
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

/** what a contact is with (kept with it, for the game's own bookkeeping) */
export const FLOOR = 0
export const WALL = 1
export const BODY = 2

// a contact's slots in the contact buffer: its bodies and kind; then for the normal (from b into a) and the two
// friction directions in turn: the direction (3 each), ra × it and rb × it (the lever arms), its effective mass and
// the impulse so far; the target normal velocity (a bounce, or a push out) and the friction coefficient
const CA = 0 // the die
const CB = 1 // the other die, or -1 for the world
const KIND = 2
const NX = 3
const RAN = 12
const RBN = 21
const KN = 30
const TGT = 33
const JN = 34
const MU = 37
const F = 38

export class DiceWorld {
  readonly p: Float64Array
  readonly v: Float64Array
  readonly q: Float64Array
  readonly w: Float64Array
  /** rotation matrices (row-major) and the corners' offsets from the centre, in the world's frame */
  readonly R: Float64Array
  readonly off: Float64Array
  readonly c: Float64Array
  nc = 0
  /** per die this step: contacts, and on the floor */
  readonly touching: Uint8Array
  readonly onFloor: Uint8Array
  /** every pair of dice, and per pair this step: whether they touch, and the speed they met at (the hardest) */
  readonly pairs: readonly [number, number][]
  readonly pairNow: Uint8Array
  readonly pairSpeed: Float64Array
  private readonly local = new Float64Array(24)
  private readonly hitK = new Uint8Array(8)
  private readonly bone: Surface
  private readonly maxContacts: number

  /**
   * `start`: the dice lying at rest (HALF above the floor); `bone`: what two dice do where they meet; `maxContacts`:
   * room for this many contacts a step.
   */
  constructor(start: readonly Pose[], bone: Surface, maxContacts = 160) {
    const n = start.length
    this.bone = bone
    this.maxContacts = maxContacts
    this.p = new Float64Array(n * 3)
    this.v = new Float64Array(n * 3)
    this.q = new Float64Array(n * 4)
    this.w = new Float64Array(n * 3)
    this.R = new Float64Array(n * 9)
    this.off = new Float64Array(n * 24)
    this.c = new Float64Array(maxContacts * F)
    this.touching = new Uint8Array(n)
    this.onFloor = new Uint8Array(n)
    const pairs: [number, number][] = []
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) pairs.push([a, b])
    this.pairs = pairs
    this.pairNow = new Uint8Array(pairs.length)
    this.pairSpeed = new Float64Array(pairs.length)
    for (let i = 0; i < n; i++) {
      const s = start[i]
      this.p.set([s.x, HALF, s.z], i * 3)
      this.q.set(normQ(s.q), i * 4)
    }
  }

  get n() {
    return this.touching.length
  }

  /** rotation matrices and corner offsets from the orientations */
  frames() {
    const { q, R, off } = this
    for (let i = 0; i < this.n; i++) {
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

  /** a new step's contacts begin: none yet */
  beginContacts() {
    this.nc = 0
    this.touching.fill(0)
    this.onFloor.fill(0)
  }

  /**
   * Adds a contact on die a (against die b, or the world when b < 0) at offset (rx, ry, rz) from a's centre, normal n
   * pointing from b into a, `depth` deep (negative: a gap, made only if it closes this step). Returns the speed the
   * two meet at (0 if they are parting), or -1 when no contact was made.
   */
  add(a: number, b: number, kind: number, nx: number, ny: number, nz: number, rx: number, ry: number, rz: number, depth: number, e: number, mu: number) {
    if (this.nc >= this.maxContacts) return -1
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

  /**
   * A point (lx, ly, lz) in die b's own frame against die b's rounded box: a contact on die a when a is a die (the
   * point is one of a's, at offset (ox, oy, oz) from a's centre), or on b itself when a < 0 (the point is the world's,
   * fixed, and (ox, oy, oz) is its offset from b's centre). `r` is the point's own rounding (a die's ROUND, or a
   * world point's). Returns the speed they meet at, or -1 when no contact was made.
   */
  pointBox(a: number, b: number, lx: number, ly: number, lz: number, ox: number, oy: number, oz: number, r = ROUND, surf: Surface = this.bone) {
    if (lx * lx + ly * ly + lz * lz > (a >= 0 ? PT_R2 : (Math.sqrt(3) * CORE + ROUND + r + AHEAD) ** 2)) return -1
    const cx = lx < -CORE ? -CORE : lx > CORE ? CORE : lx
    const cy = ly < -CORE ? -CORE : ly > CORE ? CORE : ly
    const cz = lz < -CORE ? -CORE : lz > CORE ? CORE : lz
    let dx = lx - cx
    let dy = ly - cy
    let dz = lz - cz
    const d2 = dx * dx + dy * dy + dz * dz
    let depth: number
    if (d2 > 1e-14) {
      if (d2 >= (ROUND + r + AHEAD) ** 2) return -1
      const d = Math.sqrt(d2)
      dx /= d
      dy /= d
      dz /= d
      depth = ROUND + r - d
    } else {
      // inside b's inner cube: out through its nearest face
      const ex = CORE - Math.abs(lx)
      const ey = CORE - Math.abs(ly)
      const ez = CORE - Math.abs(lz)
      dx = dy = dz = 0
      if (ex <= ey && ex <= ez) dx = Math.sign(lx) || 1
      else if (ey <= ez) dy = Math.sign(ly) || 1
      else dz = Math.sign(lz) || 1
      depth = ROUND + r + Math.min(ex, ey, ez)
    }
    const R = this.R
    const o = b * 9
    const nx = R[o] * dx + R[o + 1] * dy + R[o + 2] * dz
    const ny = R[o + 3] * dx + R[o + 4] * dy + R[o + 5] * dz
    const nz = R[o + 6] * dx + R[o + 7] * dy + R[o + 8] * dz
    // a world point pushes die b out along -n, at the point of b's surface nearest it
    if (a < 0) return this.add(b, -1, WALL, -nx, -ny, -nz, ox - nx * r, oy - ny * r, oz - nz * r, depth, surf.e, surf.mu)
    return this.add(a, b, BODY, nx, ny, nz, ox - nx * ROUND, oy - ny * ROUND, oz - nz * ROUND, depth, surf.e, surf.mu)
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

  /** the dice against each other: per pair, whether they touch and how hard they met (pairNow, pairSpeed) */
  pairContacts() {
    const p = this.p
    this.pairNow.fill(0)
    this.pairSpeed.fill(0)
    for (let pi = 0; pi < this.pairs.length; pi++) {
      const [a, b] = this.pairs[pi]
      const dx = p[a * 3] - p[b * 3]
      const dy = p[a * 3 + 1] - p[b * 3 + 1]
      const dz = p[a * 3 + 2] - p[b * 3 + 2]
      if (dx * dx + dy * dy + dz * dz > PAIR_R2) continue
      const before = this.nc
      const s = Math.max(this.pair(a, b), this.pair(b, a))
      if (this.nc > before) {
        this.pairNow[pi] = 1
        this.pairSpeed[pi] = s
      }
    }
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

  /** a step's motion; a die lying on the floor rolls against the felt, its spin dying away at `drag` (1/s) */
  integrate(drag: number) {
    const { p, v, q, w } = this
    for (let i = 0; i < this.n; i++) {
      p[i * 3] += v[i * 3] * DT
      p[i * 3 + 1] += v[i * 3 + 1] * DT
      p[i * 3 + 2] += v[i * 3 + 2] * DT
      if (this.onFloor[i]) {
        const k = 1 - drag * DT
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

/**
 * The dice at the end of a record (`n` samples of `dice` dice, at RATE), set exactly flat on the felt: the last tenth
 * of a second of samples eased onto the flat poses (a hair's correction: they are already still). Null if one is not
 * lying flat on the floor.
 */
export function settleFlat(pos: Float32Array, quat: Float32Array, n: number, dice: number): Pose[] | null {
  const out: Pose[] = []
  const K = Math.min(n - 1, Math.round(0.1 * RATE))
  for (let i = 0; i < dice; i++) {
    const L = ((n - 1) * dice + i) * 4
    const q: Q = normQ([quat[L], quat[L + 1], quat[L + 2], quat[L + 3]])
    const y = pos[((n - 1) * dice + i) * 3 + 1]
    if (tiltOf(q) > 0.03 || Math.abs(y - HALF) > 0.012) return null
    // the small turn that stands its upper face exactly level
    const upB = nearestAxis(rotate(qconj(q), [0, 1, 0]))
    const now = rotate(q, upB)
    const fix = fromTo(now, [0, 1, 0])
    const flat = normQ(qmul(fix, q))
    for (let j = 0; j < K; j++) {
      const s = j + 1 === K ? 1 : smooth((j + 1) / K)
      const at = n - K + j
      const o = (at * dice + i) * 4
      const a: Q = [quat[o], quat[o + 1], quat[o + 2], quat[o + 3]]
      quat.set(nlerp(a, flat, s), o)
      const po = (at * dice + i) * 3
      pos[po + 1] += (HALF - pos[po + 1]) * s
    }
    const po = ((n - 1) * dice + i) * 3
    out.push({ x: pos[po], z: pos[po + 2], q: flat })
  }
  return out
}
