import { CUBE_TURNS, FACE_AXIS, HALF, REACH, ROUND, axisAngle, mulberry, normQ, qmul, restQuat, rotate, smooth, topFace, type Pose, type Q, type V3 } from '../../lib/dice/cube'
import { AHEAD, DT, DiceWorld, EVERY, FLOOR, HIT_V, RATE, WALL, settleFlat } from '../../lib/dice/solver'
import type { Die } from './rules'

export { HALF, REACH, ROUND, mulberry, tiltOf, topFace, type Pose, type Q } from '../../lib/dice/cube'
export { RATE } from '../../lib/dice/solver'

/*
  The three dice under the glass dome, worked out as real rigid-body physics before they are shown (no three.js here,
  so Node can test it: tools/sicbo-physics-test.ts).

  The dice and the solver are the house's shared ones (src/lib/dice: rounded cubes, an impulse solver at 360 steps a
  second); this file is the dome. The dome is a felt floor that turns up in a steep cove at its edge, under a glass
  sphere centred on the middle of the floor. The pedestal shakes the dome with short hard kicks, up, sideways and
  rocking, for a second and a half or so, then lets the dice settle. Everything is worked out in the dome's own frame,
  where a kick is felt as a brief pseudo-force (which is all a moving floor does to what lies on it); the solver's
  contacts are made a step ahead when a gap is about to close (the kicks bring the floor up to meet falling dice at
  20 units a second and more).

  Which faces come up is chaotic, so it is never steered. The dice are relabelled instead: a cube looks the same under
  any of its 24 rotations, so while a die flies clear of everything (no contact, and far enough from the felt, the
  cove, the glass and the other dice that no turn of it could touch them), its pips can be turned within the body, a
  quarter, third or half turn blended in across that moment of flight, so that it lands showing the face that was
  drawn. The turn chosen is the smallest that does it, about the axis the die is already spinning on where that ties.
  The path is never touched, and every roll starts exactly from the dice's previous resting poses, so nothing snaps.

  Units: a die's edge is 1. Time is in seconds of the show at normal speed.
*/

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
const N = 3

/** what each pair of surfaces does: bounce (restitution) and friction */
const FELT = { e: 0.26, mu: 0.6 }
const GLASS = { e: 0.5, mu: 0.16 }
/** the cove: slick (its friction kept low, so a die cannot lean on it: it slides off and falls flat) */
const SLOPE = { e: 0.35, mu: 0.04 }
const BONE = { e: 0.42, mu: 0.3 }
/** how far clear of everything a die must be (beyond its reach) for its pips to be turned */
const CLEAR = 0.02
/** the shortest stretch of clear flight a turn is blended across, s */
const MIN_WINDOW = 0.1
/** a die lying on the floor rolls against the felt: its spin dies away at this rate (1/s) */
const FELT_DRAG = 2.4

/* ---------------- the shake ---------------- */

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

/* ---------------- the dome, for the solver ---------------- */

/** how far a point is above the cove's slope (along its normal; the slope extended below the floor inwards) */
export const coveGap = (x: number, y: number, z: number) => -(Math.hypot(x, z) - FLAT_R) * COVE_S + y * COVE_C

class World extends DiceWorld {
  // what touched last step, for telling new knocks from resting contact
  private readonly cornerWas = new Uint8Array(N * 8)
  private readonly cornerNow = new Uint8Array(N * 8)
  private readonly glassWas = new Uint8Array(N)
  private readonly glassNow = new Uint8Array(N)
  private readonly pairWas = new Uint8Array(3)
  private readonly lastHit = new Float64Array(N * 2 + 3).fill(-1)
  /** the hardest new knock this step per die on the floor and the glass, and per pair (speed, and where) */
  private readonly knock = new Float64Array((N * 2 + 3) * 4)
  readonly hits: Hit[] = []

  constructor(start: readonly Pose[]) {
    super(start, BONE)
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
    this.beginContacts()
    this.cornerNow.fill(0)
    this.glassNow.fill(0)
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
    this.pairContacts()
    for (let pi = 0; pi < this.pairs.length; pi++) {
      const [a, b] = this.pairs[pi]
      if (this.pairNow[pi] && !this.pairWas[pi]) this.noteKnock(2 * N + pi, this.pairSpeed[pi], (p[a * 3] + p[b * 3]) / 2, (p[a * 3 + 1] + p[b * 3 + 1]) / 2, (p[a * 3 + 2] + p[b * 3 + 2]) / 2)
    }
  }

  /** the knocks this step that are worth a sound (each surface at most every 40 ms) */
  hitsAt(t: number) {
    for (let key = 0; key < N * 2 + 3; key++) {
      const s = this.knock[key * 4]
      if (s < HIT_V || t - this.lastHit[key] < 0.04) continue
      this.lastHit[key] = t
      const on = key < N ? 'floor' : key < 2 * N ? 'glass' : 'die'
      const die = key < 2 * N ? key % N : this.pairs[key - 2 * N][0]
      this.hits.push({ t, v: s, die, on, x: this.knock[key * 4 + 1], y: this.knock[key * 4 + 2], z: this.knock[key * 4 + 3] })
    }
    this.cornerWas.set(this.cornerNow)
    this.glassWas.set(this.glassNow)
    this.pairWas.set(this.pairNow)
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
    W.integrate(FELT_DRAG)

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
      const final = settleFlat(pos, quat, n, N)
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
