import { CORE, CUBE_TURNS, HALF, REACH, ROUND, mulberry, qmul, restQuat, topFace, type Face, type Pose, type Q } from '../../lib/dice/cube'
import { AHEAD, DT, DiceWorld, EDGES, EVERY, FLOOR, HIT_V, RATE, WALL, settleFlat } from '../../lib/dice/solver'

export { HALF, REACH, ROUND, RATE, mulberry, topFace, type Pose, type Q }

/*
  The throw, worked out as real rigid-body physics before it is shown (no three.js here, so Node can test it:
  tools/craps-physics-test.ts). The dice and the solver are the house's (src/lib/dice); this file is the table.

  The table is a felt floor in a rectangular tub: plain padded walls along the sides and at the shooter's end, and at
  the far end the backboard, lined with rubber pyramids set as diamonds, the craps table's "diamonds". The pyramids
  are real geometry: the dice's corners and points along their edges meet the pyramids' facets, and each pyramid's tip
  meets the dice's faces, so a die glancing off the backboard is kicked off at whatever angle the facet it struck
  gives, which is what the rubber is for: no two throws come back alike.

  The shooter's hand is above the near rail. A throw starts there: the two dice leave the hand together, spinning,
  fly over the rail into the tub, bounce and tumble down the felt, strike the backboard and settle. The house rule
  that both dice must hit the back wall is kept: a throw is chosen in which both do.

  Which faces come up is chaotic, so it is never steered. The dice are relabelled instead, and where no one can see:
  a cube looks the same under any of its 24 rotations, so a die turned by one of them fills exactly the same space and
  moves exactly the same; only its pips are elsewhere. The shooter "sets" the dice in the hand (the record's first
  moment, before they come into view), each turned by the rotation that brings the drawn face up at the end. From the
  release on the dice move exactly as simulated, so no turn of the pips is ever shown, in flight or anywhere else.
  The throw starts from the dice's previous resting orientations, as a shooter picks them up.

  Frame: y up, the felt at y = 0, the shooter's end at +z, the backboard at -z, the table centred on x = 0.
  Units: a die's edge is 1. Time is in seconds of the show at normal speed.
*/

/** half the felt's width (between the side walls) */
export const HALF_W = 5.5
/** the near wall (the shooter's end) */
export const NEAR_Z = 12
/** the backboard's base plane; the pyramids stand PYR_D proud of it */
export const BACK_Z = -12
/** how high the walls rise above the felt to the padded rail */
export const WALL_H = 2.6
/** the pyramids: diamonds PYR_P across and PYR_P tall, their tips PYR_D proud of the backboard */
export const PYR_P = 0.8
export const PYR_D = 0.2
/** the rounding of a pyramid's tip (it meets the dice's faces as a small ball) */
const TIP_R = 0.02
const GRAV = 64
const N = 2

/** what each pair of surfaces does: bounce (restitution) and friction */
const FELT = { e: 0.32, mu: 0.3 }
const CUSHION = { e: 0.42, mu: 0.3 }
const RUBBER = { e: 0.55, mu: 0.6 }
const BONE = { e: 0.42, mu: 0.3 }
/** a die lying on the felt rolls against it: its spin dies away at this rate (1/s) */
const FELT_DRAG = 2.4
/** how many points along each edge of a die meet the pyramids (with the corners: points this close together) */
const EDGE_STEPS = 7

/* ---------------- the backboard ---------------- */

/*
  The pyramids, as a height field over the backboard: (x, y) on the board maps to the diamond lattice
  u = (x + y) / P, v = (x - y) / P, where each unit cell is one pyramid (its tip at the cell's middle, its base corners
  at the cell's corners). A pyramid is four triangular facets, each from the tip to two neighbouring base corners.
*/

/** how far proud of the backboard the pyramids stand at (x, y) */
export function pyramidHeight(x: number, y: number) {
  const u = (x + y) / PYR_P
  const v = (x - y) / PYR_P
  const a = u - Math.floor(u) - 0.5
  const b = v - Math.floor(v) - 0.5
  return PYR_D * (1 - 2 * Math.max(Math.abs(a), Math.abs(b)))
}

/** the outward normal (into the tub) of the pyramid facet at (x, y) on the backboard, into nrm */
const nrm = new Float64Array(3)
function pyramidNormal(x: number, y: number) {
  const u = (x + y) / PYR_P
  const v = (x - y) / PYR_P
  const a = u - Math.floor(u) - 0.5
  const b = v - Math.floor(v) - 0.5
  // the height falls away from the tip at 2D/P along u or v, whichever the point is further out along
  const k = (2 * PYR_D) / PYR_P
  const hx = Math.abs(a) >= Math.abs(b) ? -k * Math.sign(a) : -k * Math.sign(b)
  const hy = Math.abs(a) >= Math.abs(b) ? -k * Math.sign(a) : k * Math.sign(b)
  const l = Math.hypot(hx, hy, 1)
  nrm[0] = -hx / l
  nrm[1] = -hy / l
  nrm[2] = 1 / l
}

/** a lattice point (u, v) on the backboard, in the table's frame */
const latticeX = (u: number, v: number) => (PYR_P * (u + v)) / 2
const latticeY = (u: number, v: number) => (PYR_P * (u - v)) / 2

// the closest point on a triangle to a point (Ericson, Real-Time Collision Detection 5.1.5), into cp
const cp = new Float64Array(3)
function put(x: number, y: number, z: number) {
  cp[0] = x
  cp[1] = y
  cp[2] = z
}
function closestOnTriangle(px: number, py: number, pz: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) {
  const abx = bx - ax
  const aby = by - ay
  const abz = bz - az
  const acx = cx - ax
  const acy = cy - ay
  const acz = cz - az
  const apx = px - ax
  const apy = py - ay
  const apz = pz - az
  const d1 = abx * apx + aby * apy + abz * apz
  const d2 = acx * apx + acy * apy + acz * apz
  if (d1 <= 0 && d2 <= 0) return put(ax, ay, az)
  const bpx = px - bx
  const bpy = py - by
  const bpz = pz - bz
  const d3 = abx * bpx + aby * bpy + abz * bpz
  const d4 = acx * bpx + acy * bpy + acz * bpz
  if (d3 >= 0 && d4 <= d3) return put(bx, by, bz)
  const vc = d1 * d4 - d3 * d2
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const t = d1 / (d1 - d3)
    return put(ax + abx * t, ay + aby * t, az + abz * t)
  }
  const cpx = px - cx
  const cpy = py - cy
  const cpz = pz - cz
  const d5 = abx * cpx + aby * cpy + abz * cpz
  const d6 = acx * cpx + acy * cpy + acz * cpz
  if (d6 >= 0 && d5 <= d6) return put(cx, cy, cz)
  const vb = d5 * d2 - d1 * d6
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const t = d2 / (d2 - d6)
    return put(ax + acx * t, ay + acy * t, az + acz * t)
  }
  const va = d3 * d6 - d5 * d4
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const t = (d4 - d3) / (d4 - d3 + (d5 - d6))
    return put(bx + (cx - bx) * t, by + (cy - by) * t, bz + (cz - bz) * t)
  }
  const den = 1 / (va + vb + vc)
  const v = vb * den
  const w = vc * den
  return put(ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w)
}

/** the four facets of a pyramid, as the two base corners (lattice offsets from the cell's corner) each runs to */
const FACETS: readonly [number, number, number, number][] = [
  [0, 0, 1, 0],
  [1, 0, 1, 1],
  [1, 1, 0, 1],
  [0, 1, 0, 0],
]

/**
 * The nearest point of the pyramids to a point (x, y, z) within `reach` of them, into near (xyz, and the distance in
 * near[3]); false if none is that close. The point must be in front of the pyramids (z above their surface).
 */
const near = new Float64Array(4)
function nearestPyramid(x: number, y: number, z: number, reach: number) {
  // the cells whose pyramids could be within reach: the lattice cells under a disc of that radius
  const u = (x + y) / PYR_P
  const v = (x - y) / PYR_P
  const r = (reach * Math.SQRT2) / PYR_P
  let best = reach * reach
  let found = false
  const tz = BACK_Z + PYR_D
  for (let iu = Math.floor(u - r); iu <= Math.floor(u + r); iu++)
    for (let iv = Math.floor(v - r); iv <= Math.floor(v + r); iv++) {
      const ax = latticeX(iu + 0.5, iv + 0.5)
      const ay = latticeY(iu + 0.5, iv + 0.5)
      for (const [u0, v0, u1, v1] of FACETS) {
        closestOnTriangle(x, y, z, ax, ay, tz, latticeX(iu + u0, iv + v0), latticeY(iu + u0, iv + v0), BACK_Z, latticeX(iu + u1, iv + v1), latticeY(iu + u1, iv + v1), BACK_Z)
        const dx = x - cp[0]
        const dy = y - cp[1]
        const dz = z - cp[2]
        const d2 = dx * dx + dy * dy + dz * dz
        if (d2 < best) {
          best = d2
          found = true
          near[0] = cp[0]
          near[1] = cp[1]
          near[2] = cp[2]
        }
      }
    }
  near[3] = Math.sqrt(best)
  return found
}

/* ---------------- the record ---------------- */

export type HitOn = 'felt' | 'wall' | 'back' | 'die'

export interface Hit {
  /** sim time of the knock */
  t: number
  /** how hard: the speed the surfaces met at */
  v: number
  die: number
  on: HitOn
  /** where, in the table's frame */
  x: number
  y: number
  z: number
}

export interface Sim {
  /** samples (RATE per second) */
  n: number
  /** per sample, per die: position xyz */
  pos: Float32Array
  /** per sample, per die: orientation xyzw as simulated (before the dice are set) */
  quat: Float32Array
  hits: Hit[]
  /** per die: when it first struck the backboard (s), or -1 if it never did */
  backAt: number[]
  /** at rest, s */
  end: number
  /** from here both dice lie flat on the felt (they may still slide a touch): the faces can be read */
  readable: number
  /** the dice at rest, exactly flat */
  final: Pose[]
}

/* ---------------- the table, for the solver ---------------- */

class TableWorld extends DiceWorld {
  // what touched last step, for telling new knocks from resting contact: each corner on the felt; each die on the
  // walls, on the backboard; the pair
  private readonly cornerWas = new Uint8Array(N * 8)
  private readonly cornerNow = new Uint8Array(N * 8)
  private readonly wallWas = new Uint8Array(N * 2)
  private readonly wallNow = new Uint8Array(N * 2)
  private pairWas = 0
  /** per die: the felt, the walls, the backboard; then the pair. The hardest new knock this step (speed, where) */
  private readonly knock = new Float64Array((N * 3 + 1) * 4)
  private readonly lastHit = new Float64Array(N * 3 + 1).fill(-1)
  readonly hits: Hit[] = []
  /** per die: on the backboard this step */
  readonly onBack = new Uint8Array(N)
  /** a die's corners and the points along its edges (offsets from its centre), for the pyramids */
  private readonly pts = new Float64Array((8 + 12 * EDGE_STEPS) * 3)

  constructor(start: readonly Pose[]) {
    super(start, BONE, 320)
  }

  private noteKnock(key: number, speed: number, x: number, y: number, z: number) {
    const o = key * 4
    if (speed <= this.knock[o]) return
    this.knock[o] = speed
    this.knock[o + 1] = x
    this.knock[o + 2] = y
    this.knock[o + 3] = z
  }

  /** every contact this step: corners on the felt and the walls, the dice against the pyramids, die against die */
  contacts() {
    const { p, off } = this
    this.beginContacts()
    this.cornerNow.fill(0)
    this.wallNow.fill(0)
    this.onBack.fill(0)
    this.knock.fill(0)
    for (let i = 0; i < N; i++) {
      const px = p[i * 3]
      const py = p[i * 3 + 1]
      const pz = p[i * 3 + 2]
      const reach = REACH + AHEAD
      // nothing of the die can reach the felt or a wall from here
      if (py > reach && px > -HALF_W + reach && px < HALF_W - reach && pz < NEAR_Z - reach && pz > BACK_Z + PYR_D + reach) continue
      const inside = pz < NEAR_Z
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
        // the side walls (they rise as high as a die can fly), and the near wall up to the rail (the dice come in
        // over it from the shooter's hand)
        for (let side = -1; side <= 1; side += 2) {
          const gap = HALF_W - side * cx
          if (gap < ROUND + AHEAD) this.wall(i, side, 0, ox + side * ROUND, oy, oz, ROUND - gap, cx + side * ROUND, cy, cz)
        }
        const gapN = NEAR_Z - cz
        if (inside && cy < WALL_H && gapN < ROUND + AHEAD) this.wall(i, 0, 1, ox, oy, oz + ROUND, ROUND - gapN, cx, cy, cz + ROUND)
      }
      if (pz - REACH - AHEAD < BACK_Z + PYR_D) this.backboard(i)
    }
    this.pairContacts()
    if (this.pairNow[0] && !this.pairWas) this.noteKnock(N * 3, this.pairSpeed[0], (p[0] + p[3]) / 2, (p[1] + p[4]) / 2, (p[2] + p[5]) / 2)
  }

  /** a corner of die i against a plain wall: normal (-sx, 0, -sz) into the table, the contact at offset o */
  private wall(i: number, sx: number, sz: number, ox: number, oy: number, oz: number, depth: number, hx: number, hy: number, hz: number) {
    const s = this.add(i, -1, WALL, -sx, 0, -sz, ox, oy, oz, depth, CUSHION.e, CUSHION.mu)
    if (s < 0) return
    this.wallNow[i * 2] = 1
    if (!this.wallWas[i * 2]) this.noteKnock(N + i, s, hx, hy, hz)
  }

  /**
   * Die i against the pyramids: its corners and points along its edges against their facets, and their tips against
   * its faces (a die is convex and so is a pyramid, so between them these catch every way the two can meet).
   */
  private backboard(i: number) {
    const { p, R, off, pts } = this
    const px = p[i * 3]
    const py = p[i * 3 + 1]
    const pz = p[i * 3 + 2]
    // the die's corners, and its edges' inner points, as offsets from its centre
    let m = 0
    for (let k = 0; k < 8; k++) {
      pts[m++] = off[i * 24 + k * 3]
      pts[m++] = off[i * 24 + k * 3 + 1]
      pts[m++] = off[i * 24 + k * 3 + 2]
    }
    for (const [a, b] of EDGES)
      for (let s = 1; s <= EDGE_STEPS; s++) {
        const f = s / (EDGE_STEPS + 1)
        for (let d = 0; d < 3; d++) pts[m++] = off[i * 24 + a * 3 + d] * (1 - f) + off[i * 24 + b * 3 + d] * f
      }
    let knock = 0
    let kx = 0
    let ky = 0
    let kz = 0
    const reach = ROUND + AHEAD
    for (let j = 0; j < m; j += 3) {
      const ox = pts[j]
      const oy = pts[j + 1]
      const oz = pts[j + 2]
      const x = px + ox
      const y = py + oy
      const z = pz + oz
      if (z - BACK_Z > PYR_D + reach) continue
      const sunk = BACK_Z + pyramidHeight(x, y) - z
      let nx: number
      let ny: number
      let nz: number
      let depth: number
      if (sunk > 0) {
        // (never expected: a point already past the surface) straight back out of the facet it is under
        pyramidNormal(x, y)
        nx = nrm[0]
        ny = nrm[1]
        nz = nrm[2]
        depth = ROUND + sunk * nz
        near[0] = x
        near[1] = y
        near[2] = z + sunk
      } else {
        if (!nearestPyramid(x, y, z, reach)) continue
        const d = near[3]
        nx = (x - near[0]) / d
        ny = (y - near[1]) / d
        nz = (z - near[2]) / d
        depth = ROUND - d
      }
      const s = this.add(i, -1, WALL, nx, ny, nz, ox - nx * ROUND, oy - ny * ROUND, oz - nz * ROUND, depth, RUBBER.e, RUBBER.mu)
      if (s >= 0) {
        this.onBack[i] = 1
        if (s > knock) {
          knock = s
          kx = near[0]
          ky = near[1]
          kz = near[2]
        }
      }
    }
    // the tips near the die, against its faces (in its own frame)
    const r = ((REACH + TIP_R + AHEAD) * Math.SQRT2) / PYR_P
    const u = (px + py) / PYR_P
    const v = (px - py) / PYR_P
    const o = i * 9
    const tz = BACK_Z + PYR_D
    for (let iu = Math.floor(u - r); iu <= Math.floor(u + r); iu++)
      for (let iv = Math.floor(v - r); iv <= Math.floor(v + r); iv++) {
        const ax = latticeX(iu + 0.5, iv + 0.5)
        const ay = latticeY(iu + 0.5, iv + 0.5)
        if (ay < 0 || ay > WALL_H || Math.abs(ax) > HALF_W) continue
        const rx = ax - px
        const ry = ay - py
        const rz = tz - pz
        const lx = R[o] * rx + R[o + 3] * ry + R[o + 6] * rz
        const ly = R[o + 1] * rx + R[o + 4] * ry + R[o + 7] * rz
        const lz = R[o + 2] * rx + R[o + 5] * ry + R[o + 8] * rz
        const s = this.pointBox(-1, i, lx, ly, lz, rx, ry, rz, TIP_R, RUBBER)
        if (s >= 0) {
          this.onBack[i] = 1
          if (s > knock) {
            knock = s
            kx = ax
            ky = ay
            kz = tz
          }
        }
      }
    if (this.onBack[i]) {
      this.wallNow[i * 2 + 1] = 1
      if (!this.wallWas[i * 2 + 1]) this.noteKnock(2 * N + i, knock, kx, ky, kz)
    }
  }

  /** the knocks this step that are worth a sound (each surface at most every 40 ms) */
  hitsAt(t: number) {
    for (let key = 0; key < N * 3 + 1; key++) {
      const s = this.knock[key * 4]
      if (s < HIT_V || t - this.lastHit[key] < 0.04) continue
      this.lastHit[key] = t
      const on: HitOn = key < N ? 'felt' : key < 2 * N ? 'wall' : key < 3 * N ? 'back' : 'die'
      this.hits.push({ t, v: s, die: key < 3 * N ? key % N : 0, on, x: this.knock[key * 4 + 1], y: this.knock[key * 4 + 2], z: this.knock[key * 4 + 3] })
    }
    this.cornerWas.set(this.cornerNow)
    this.wallWas.set(this.wallNow)
    this.pairWas = this.pairNow[0]
  }

  gravity() {
    for (let i = 0; i < N; i++) this.v[i * 3 + 1] -= GRAV * DT
  }
}

/* ---------------- a throw, simulated ---------------- */

/** a die in the shooter's hand as it is let go: where, how fast, spinning how */
interface Release {
  p: [number, number, number]
  v: [number, number, number]
  w: [number, number, number]
}

/** the shooter's hand at the release: how far either side of the middle, how high over the rail and how far behind
 * the near wall it may be (ranges), how far apart it holds the two dice and how far it may be turned (radians) */
const HAND_X = 1.2
const HAND_Y = [0.95, 1.4]
const HAND_Z = [0.75, 1.05]
const HAND_SPREAD = 0.76
const HAND_YAW = 0.3

/** every point of a die in the shooter's hand at the release: the scene keeps it all out of sight */
export const HAND_BOX = {
  x: HAND_X + HAND_SPREAD + REACH,
  y0: WALL_H + HAND_Y[0] - 0.1 - REACH,
  y1: WALL_H + HAND_Y[1] + 0.1 + REACH,
  z0: NEAR_Z + HAND_Z[0] - HAND_SPREAD * Math.sin(HAND_YAW) - REACH,
  z1: NEAR_Z + HAND_Z[1] + HAND_SPREAD * Math.sin(HAND_YAW) + REACH,
}

/**
 * How the shooter lets go of the dice (seeded): both from a hand above the near rail, together, a little apart,
 * thrown hard down the table with a touch of aim towards the middle and a lively spin each.
 */
function makeRelease(r: () => number, quick: boolean): Release[] {
  const x0 = (r() - 0.5) * 2 * HAND_X
  const y0 = WALL_H + HAND_Y[0] + r() * (HAND_Y[1] - HAND_Y[0])
  const z0 = NEAR_Z + HAND_Z[0] + r() * (HAND_Z[1] - HAND_Z[0])
  const speed = (quick ? 31 : 28) + r() * 8
  const lift = 1 + r() * 3
  const aim = -x0 * 0.35 + (r() - 0.5) * 2.2
  const yaw = (r() - 0.5) * 2 * HAND_YAW
  return [-1, 1].map((side) => {
    // the two dice side by side across the hand (turned with it), not quite level, clear of each other however turned
    const sx = Math.cos(yaw) * HAND_SPREAD * side
    const sz = Math.sin(yaw) * HAND_SPREAD * side
    const a = r() * Math.PI * 2
    const b = Math.acos(2 * r() - 1)
    const spin = 11 + r() * 16
    return {
      p: [x0 + sx, y0 + (r() - 0.5) * 0.2, z0 + sz],
      v: [aim + (r() - 0.5) * 1.6, lift + (r() - 0.5) * 1.2, -speed + (r() - 0.5) * 2],
      w: [Math.sin(b) * Math.cos(a) * spin, Math.cos(b) * spin, Math.sin(b) * Math.sin(a) * spin],
    }
  })
}

const inFootprint = (x: number, z: number) => Math.abs(x) <= HALF_W && z <= NEAR_Z && z >= BACK_Z

/**
 * Throws the dice from the hand (seeded, so the same seed throws the same way), turned as `start` (their previous
 * resting orientations), until they are at rest. Gives up (null) on a throw that does not settle in time, ends with
 * a die not lying flat on the felt (on the other die, or leaning on it or a wall), or would show a die where it
 * cannot be: outside the tub below the rail's height, or flying above a wall's top near it (over the padded rail).
 */
export function simulate(start: readonly Pose[], seed: number, quick = false, maxT = 7): Sim | null {
  const r = mulberry(seed)
  const rel = makeRelease(r, quick)
  const W = new TableWorld(rel.map((d, i) => ({ x: d.p[0], z: d.p[2], q: start[i].q })))
  const { p, v, q, w, R } = W
  for (let i = 0; i < N; i++) {
    p.set(rel[i].p, i * 3)
    v.set(rel[i].v, i * 3)
    w.set(rel[i].w, i * 3)
  }
  const cap = Math.ceil(maxT * RATE) + 2
  const pos = new Float32Array(cap * N * 3)
  const quat = new Float32Array(cap * N * 4)
  const backAt = [-1, -1]
  /** per die: over the near wall into the tub; down on the felt at least once */
  const entered = [false, false]
  const landed = [false, false]
  let n = 0
  let still = 0
  let readable = 0
  const steps = Math.ceil(maxT / DT)

  for (let s = 0; s <= steps; s++) {
    const t = s * DT
    W.frames()
    if (s % EVERY === 0 && n < cap) {
      pos.set(p, n * N * 3)
      quat.set(q, n * N * 4)
      n++
    }
    // where a die may be: once over the near wall it stays in the tub, below the rail's top where it is near a wall
    for (let i = 0; i < N; i++) {
      const x = p[i * 3]
      const y = p[i * 3 + 1]
      const z = p[i * 3 + 2]
      if (!entered[i]) {
        if (z < NEAR_Z - REACH) entered[i] = true
        else if (y < WALL_H + REACH) return null
      } else {
        if (!inFootprint(x, z)) return null
        // (the near wall only once it has come down: it flies in over it)
        const nearWall = Math.min(HALF_W - Math.abs(x), z - BACK_Z, landed[i] ? NEAR_Z - z : Infinity) < REACH + 0.4
        if (nearWall && y > WALL_H - HALF) return null
      }
    }
    W.gravity()
    W.contacts()
    W.hitsAt(t)
    for (let i = 0; i < N; i++) {
      if (W.onBack[i] && backAt[i] < 0) backAt[i] = t
      if (W.onFloor[i]) landed[i] = true
    }
    W.solve()
    W.integrate(FELT_DRAG)

    // flat on the felt: the faces can be read from here; and at rest
    let allFlat = true
    let allStill = entered[0] && entered[1]
    for (let i = 0; i < N; i++) {
      const o = i * 9
      const up = Math.max(Math.abs(R[o + 3]), Math.abs(R[o + 4]), Math.abs(R[o + 5]))
      const flat = W.onFloor[i] && up > 0.9986 && p[i * 3 + 1] < HALF + 0.02
      if (!flat) allFlat = false
      const vv = v[i * 3] ** 2 + v[i * 3 + 1] ** 2 + v[i * 3 + 2] ** 2
      const ww = w[i * 3] ** 2 + w[i * 3 + 1] ** 2 + w[i * 3 + 2] ** 2
      if (!flat || vv > 0.006 || ww > 0.02) allStill = false
    }
    if (!allFlat) readable = t + DT
    still = allStill ? still + DT : 0
    if (still >= 0.15) {
      const end = (n - 1) / RATE
      const final = settleFlat(pos, quat, n, N)
      if (!final) return null
      return { n, pos: pos.slice(0, n * N * 3), quat: quat.slice(0, n * N * 4), hits: W.hits, backAt, end, readable: Math.min(end, readable), final }
    }
  }
  return null
}

/* ---------------- a throw that shows the drawn faces ---------------- */

export interface Roll {
  sim: Sim
  /** the dice as they lay before the throw (their orientations are the hand's at the release) */
  start: Pose[]
  /** per die: the turn of the cube it was set in the hand with (applied to the simulated orientation throughout) */
  set: Q[]
  /** the dice at rest after it, showing the drawn faces */
  final: Pose[]
  faces: Face[]
  /** how many throws were simulated to find this one, and how long that took (ms) */
  tries: number
  ms: number
}

/** the turn of the cube that makes a die physics leaves turned `q` show `want` on top instead */
export function setFor(q: Q, want: Face): Q {
  for (const c of CUBE_TURNS) if (topFace(qmul(q, c.q)) === want) return c.q
  throw new Error('craps: no turn shows that face')
}

/** the dice are apart at rest (neither touches the other), and off the walls by a hair */
function wellPlaced(final: readonly Pose[]) {
  const clear = CORE + ROUND * 2
  return apart(final) > 1.55 && final.every((f) => Math.abs(f.x) < HALF_W - clear && f.z < NEAR_Z - clear && f.z > BACK_Z + PYR_D + clear)
}
const apart = (final: readonly Pose[]) => Math.hypot(final[0].x - final[1].x, final[0].z - final[1].z)

/**
 * Works out a throw from the dice lying at `start` to rest showing `faces` (die 0, die 1). Throws until one settles
 * well with both dice striking the backboard, in the usual time, the dice near enough together for a close look at
 * both; each try takes a few milliseconds. `quick` is turbo's harder, shorter throw.
 */
export function planThrow(start: readonly Pose[], faces: readonly Face[], o: { quick?: boolean; rnd?: () => number; tries?: number } = {}): Roll {
  const rnd = o.rnd ?? Math.random
  const t0 = performance.now()
  const tries = o.tries ?? 80
  // the best seen so far: both dice on the backboard (only far apart, or long); one of them
  let good: Sim | null = null
  let fair: Sim | null = null
  for (let k = 1; k <= tries; k++) {
    const sim = simulate(start, Math.floor(rnd() * 2 ** 32), !!o.quick)
    if (!sim || !wellPlaced(sim.final)) continue
    const both = sim.backAt[0] >= 0 && sim.backAt[1] >= 0
    if (both && apart(sim.final) < 6 && sim.end <= (o.quick ? 3 : 3.8)) return finish(sim, start, faces, k, t0)
    if (both) good ??= sim
    else if (sim.backAt[0] >= 0 || sim.backAt[1] >= 0) fair ??= sim
  }
  const best = good ?? fair
  if (best) return finish(best, start, faces, tries, t0)
  // never expected: try on, letting the throw settle for longer
  for (let k = 1; k <= 500; k++) {
    const sim = simulate(start, Math.floor(rnd() * 2 ** 32), !!o.quick, 10)
    if (sim) return finish(sim, start, faces, tries + k, t0)
  }
  throw new Error('craps: no throw found')
}

function finish(sim: Sim, start: readonly Pose[], faces: readonly Face[], tries: number, t0: number): Roll {
  const set = sim.final.map((f, i) => setFor(f.q, faces[i]))
  const final = sim.final.map((f, i) => ({ x: f.x, z: f.z, q: qmul(f.q, set[i]) }))
  return { sim, start: start.map((s) => ({ x: s.x, z: s.z, q: [...s.q] as Q })), set, final, faces: [...faces], tries, ms: performance.now() - t0 }
}

/* ---------------- playing a throw back ---------------- */

/**
 * Die i's pose at time t of a throw, as shown: the simulated path and orientation, set in the hand (turned by its
 * cube turn throughout), written into out as position xyz then orientation xyzw. The release at t <= 0, exactly the
 * final pose at the end.
 */
export function poseAt(roll: Roll, i: number, t: number, out: Float32Array | Float64Array | number[]) {
  const s = roll.sim
  if (t >= s.end) {
    const f = roll.final[i]
    out[0] = f.x
    out[1] = HALF
    out[2] = f.z
    out[3] = f.q[0]
    out[4] = f.q[1]
    out[5] = f.q[2]
    out[6] = f.q[3]
    return
  }
  const x = Math.max(0, t) * RATE
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
  // q · set: the pips as the shooter set them
  const [bx, by, bz, bw] = roll.set[i]
  out[3] = qw * bx + qx * bw + qy * bz - qz * by
  out[4] = qw * by - qx * bz + qy * bw + qz * bx
  out[5] = qw * bz + qx * by - qy * bx + qz * bw
  out[6] = qw * bw - qx * bx - qy * by - qz * bz
}

/* ---------------- the dice between throws ---------------- */

/**
 * Where the stickman leaves the dice for the shooter: on the Pass Line by the near rail, side by side to the right of
 * its lettering, each turned on the spot by a little from `qs` (how they lay where they came to rest: the stick slides
 * them, it does not turn them over).
 */
export function homePoses(qs: readonly Q[], rnd: () => number = Math.random): Pose[] {
  return qs.map((q, i) => {
    const yaw = (rnd() - 0.5) * 0.9
    return { x: (i ? 4.62 : 3.32) + (rnd() - 0.5) * 0.1, z: NEAR_Z - 1.4 + (rnd() - 0.5) * 0.2, q: qmul([0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], q) }
  })
}

/** two dice lying flat showing `faces`, each squared to the table and turned a little its own way */
export const restOrientations = (faces: readonly Face[], rnd: () => number = Math.random): Q[] => faces.map((f) => restQuat(f, (rnd() - 0.5) * 0.8))
