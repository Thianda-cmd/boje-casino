/*
  The coin's flight, worked out as real rigid-body physics before it is shown (no three.js here, so Node can test
  it). A thin gold disc is flicked up off the table from its near edge, tumbles through the air (torque-free, so it
  wobbles the way a real coin does), lands, bounces, rolls on its rim and spins down like Euler's disk until it lies
  flat. The table is a stiff damped spring under the lowest point of each rim (found exactly, so the coin rolls on a
  true circle, not a polygon) plus a ring of points that hold it up once it is flat; friction is Coulomb, softened.

  Which face ends up is chaotic, so flights are simulated ahead from one canonical start (flat, heads up, at the
  origin) and sorted by whether they end the other way up. The coin is symmetric under turning it over and under
  turning it about its own axis, so one flight can be shown from any rest pose to land on either face: `pose()` turns
  the body (never the path) so the flight starts exactly as the coin lies and ends on the face that was drawn.

  Units: the coin's radius is 1. Time is in seconds of the show at normal speed.
*/

export const RADIUS = 1
/** half the coin's thickness */
export const HALF = 0.09
const G = 46
const DT = 1 / 2400
/** the flight is recorded at this rate (samples per second) */
export const RATE = 120
const EVERY = Math.round(1 / (DT * RATE))

// mass 1; a disc about its axis (body y) and about a diameter
const IA = 0.5
const ID = 0.25 + (2 * HALF) ** 2 / 12

/** the velvet: spring and damping under the rim, friction, rolling drag (per unit of load), air drag on spin */
export const TABLE = { k: 52000, cn: 200, mu: 0.3, ct: 260, roll: 0.0006, spinAir: 0 }
const RING = 10

export interface Hit {
  /** sim time of the knock */
  t: number
  /** how hard: the speed the rim met the table with */
  v: number
}

export interface Flight {
  /** samples (RATE per second): position xyz and orientation xyzw (body y is the heads axis) */
  n: number
  pos: Float32Array
  quat: Float32Array
  /** the first touchdown after the flick, s */
  land: number
  /** the highest point of the flight, its time */
  apex: number
  apexT: number
  /** knocks on the table after the flick */
  hits: Hit[]
  /** how fast the point of contact runs round the rim while it spins down (rad/s), per sample, 0 when not rolling */
  whirl: Float32Array
  /** the last moment the coin stood past upright: from here its face is decided */
  committed: number
  /** at rest, s */
  end: number
  /** it ends the other way up from how it started */
  flips: boolean
}

export interface Launch {
  /** apex height above the table */
  height: number
  /** spin about the flick axis, rad/s */
  spin: number
  /** a little spin about the coin's own axis and about the other diameter (the wobble in the air) */
  twist: number
  wobble: number
  /** horizontal drift, units/s */
  vx: number
  vz: number
}

/** a random launch for the show (Math.random: nothing here touches the outcome) */
export function randomLaunch(r: () => number = Math.random): Launch {
  return {
    height: 6.2 + r() * 1.6,
    spin: 25 + r() * 11,
    twist: (r() - 0.5) * 14,
    wobble: (r() - 0.5) * 3.2,
    vx: (r() - 0.5) * 0.9,
    vz: (r() - 0.5) * 0.7 - 0.25,
  }
}

/**
 * Simulates one flick from the canonical start: flat, heads up, at the origin, flicked up from its near edge (+z,
 * towards the camera), so it flips away over the x axis. Gives up (null) on a flight that runs too long.
 */
export function simulate(l: Launch, maxT = 7, cut?: { after: number; dist: number }): Flight | null {
  const { k: K, cn: C_N, mu: MU, ct: C_T, roll: ROLL, spinAir } = TABLE
  // state: position, velocity, orientation (x y z w), angular momentum (world)
  let px = 0
  let py = HALF
  let pz = 0
  let vx = l.vx
  let vy = Math.sqrt(2 * G * l.height)
  let vz = l.vz
  let qx = 0
  let qy = 0
  let qz = 0
  let qw = 1
  // the flick: about -x (lifts the near edge), plus the coin's own twist and a wobble about z
  let wx = -l.spin
  let wy = l.twist
  let wz = l.wobble
  // L = I w, with the coin flat (axis = world y)
  let Lx = ID * wx
  let Ly = IA * wy
  let Lz = ID * wz

  const cap = Math.ceil(maxT * RATE) + 2
  const pos = new Float32Array(cap * 3)
  const quat = new Float32Array(cap * 4)
  const whirl = new Float32Array(cap)
  const hits: Hit[] = []
  let n = 0
  let land = -1
  let apex = 0
  let apexT = 0
  let committed = 0
  let restFor = 0
  let lastAz = NaN
  let azRate = 0
  let touching = false
  let lastHitT = -1
  let prevSide = 1
  const ringC = Array.from({ length: RING }, (_, i) => Math.cos((i / RING) * Math.PI * 2))
  const ringS = Array.from({ length: RING }, (_, i) => Math.sin((i / RING) * Math.PI * 2))

  const steps = Math.ceil(maxT / DT)
  for (let s = 0; s <= steps; s++) {
    const t = s * DT
    // rotation matrix columns from the quaternion
    const xx = qx * qx
    const yy = qy * qy
    const zz = qz * qz
    const xy = qx * qy
    const xz = qx * qz
    const yz = qy * qz
    const wxq = qw * qx
    const wyq = qw * qy
    const wzq = qw * qz
    // body x, y (the axis), z in world
    const ax = 1 - 2 * (yy + zz)
    const ay = 2 * (xy + wzq)
    const az = 2 * (xz - wyq)
    const nx = 2 * (xy - wzq)
    const ny = 1 - 2 * (xx + zz)
    const nz = 2 * (yz + wxq)
    const bx = 2 * (xz + wyq)
    const by = 2 * (yz - wxq)
    const bz = 1 - 2 * (xx + yy)
    // angular velocity from momentum: w = L/ID + (1/IA - 1/ID)(n.L) n
    const nL = nx * Lx + ny * Ly + nz * Lz
    const kk = (1 / IA - 1 / ID) * nL
    wx = Lx / ID + kk * nx
    wy = Ly / ID + kk * ny
    wz = Lz / ID + kk * nz

    if (s % EVERY === 0 && n < cap) {
      pos[n * 3] = px
      pos[n * 3 + 1] = py
      pos[n * 3 + 2] = pz
      quat[n * 4] = qx
      quat[n * 4 + 1] = qy
      quat[n * 4 + 2] = qz
      quat[n * 4 + 3] = qw
      whirl[n] = touching && Math.abs(ny) > 0.05 && Math.abs(ny) < 0.995 ? azRate : 0
      n++
    }

    let fx = 0
    let fy = -G
    let fz = 0
    let tx = 0
    let ty = 0
    let tz = 0
    let load = 0
    let maxVn = 0
    // the lowest point of the coin could only be near the table if the centre is within a radius of it
    if (py < RADIUS + HALF + 0.02) {
      const contact = (rx: number, ry: number, rz: number) => {
        const cy = py + ry
        if (cy >= 0) return
        const pen = -cy
        // velocity of the material point
        const pvx = vx + (wy * rz - wz * ry)
        const pvy = vy + (wz * rx - wx * rz)
        const pvz = vz + (wx * ry - wy * rx)
        if (-pvy > maxVn) maxVn = -pvy
        let fn = K * pen - C_N * pvy
        if (fn <= 0) return
        load += fn
        let ftx = -C_T * pvx
        let ftz = -C_T * pvz
        const ft = Math.hypot(ftx, ftz)
        const lim = MU * fn
        if (ft > lim) {
          ftx *= lim / ft
          ftz *= lim / ft
        }
        fx += ftx
        fy += fn
        fz += ftz
        tx += ry * ftz - rz * fn
        ty += rz * ftx - rx * ftz
        tz += rx * fn - ry * ftx
      }
      // the lowest point of each rim, found exactly: d = -up + (up.n) n, scaled to the radius
      const dx = ny * nx
      const dy = -1 + ny * ny
      const dz = ny * nz
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (dl > 1e-6) {
        const k = RADIUS / dl
        for (const sgn of [1, -1]) contact(sgn * HALF * nx + dx * k, sgn * HALF * ny + dy * k, sgn * HALF * nz + dz * k)
        // the azimuth of the contact point, for the spin-down's whirr
        const a = Math.atan2(dz, dx)
        if (!Number.isNaN(lastAz)) {
          let da = a - lastAz
          if (da > Math.PI) da -= Math.PI * 2
          if (da < -Math.PI) da += Math.PI * 2
          azRate += (Math.abs(da) / DT - azRate) * 0.02
        }
        lastAz = a
      }
      // nearly flat: the ring of the lower face holds it up
      if (Math.abs(ny) > 0.97) {
        const sgn = ny > 0 ? -1 : 1
        for (let i = 0; i < RING; i++) {
          const c = ringC[i] * RADIUS
          const sn = ringS[i] * RADIUS
          contact(c * ax + sn * bx + sgn * HALF * nx, c * ay + sn * by + sgn * HALF * ny, c * az + sn * bz + sgn * HALF * nz)
        }
      }
    }
    const wasTouching = touching
    touching = load > 0
    if (touching && t > 0.06) {
      if (land < 0) land = t
      // a knock: the rim arriving fast after time off the table (or a hard slap while sliding)
      if ((!wasTouching || maxVn > 2.2) && maxVn > 0.8 && t - lastHitT > 0.05) {
        hits.push({ t, v: maxVn })
        lastHitT = t
      }
    }
    if (py > apex) {
      apex = py
      apexT = t
    }
    // a flight that is already running too long or rolling out of the light is given up early (makeFlight)
    if (cut && land >= 0 && s % 240 === 0 && (t - land > cut.after || px * px + pz * pz > cut.dist * cut.dist)) return null
    // which way up it is: the moment it last passed upright is when its face was decided
    const side = ny >= 0 ? 1 : -1
    if (side !== prevSide && land >= 0) committed = t
    prevSide = side

    // velvet drag on rolling and spinning while it touches
    if (touching) {
      const d = Math.min(1, ROLL * load * DT * 60)
      Lx -= Lx * d
      Ly -= Ly * d
      Lz -= Lz * d
    }
    // a little air
    const air = 1 - 0.03 * DT
    if (spinAir) {
      const sa = 1 - spinAir * DT
      Lx *= sa
      Ly *= sa
      Lz *= sa
    }
    vx = (vx + fx * DT) * air
    vy = vy + fy * DT
    vz = (vz + fz * DT) * air
    px += vx * DT
    py += vy * DT
    pz += vz * DT
    Lx += tx * DT
    Ly += ty * DT
    Lz += tz * DT
    // q += 0.5 (w, 0) q dt
    const hx = 0.5 * DT
    const dqx = hx * (wx * qw + wy * qz - wz * qy)
    const dqy = hx * (wy * qw + wz * qx - wx * qz)
    const dqz = hx * (wz * qw + wx * qy - wy * qx)
    const dqw = hx * (-wx * qx - wy * qy - wz * qz)
    qx += dqx
    qy += dqy
    qz += dqz
    qw += dqw
    const ql = 1 / Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw)
    qx *= ql
    qy *= ql
    qz *= ql
    qw *= ql

    // at rest: flat, still, for a moment
    const still = Math.abs(ny) > 0.9995 && vx * vx + vy * vy + vz * vz < 0.004 && wx * wx + wy * wy + wz * wz < 0.02
    restFor = still && land >= 0 ? restFor + DT : 0
    if (restFor > 0.12) {
      if (n < cap) {
        pos[n * 3] = px
        pos[n * 3 + 1] = py
        pos[n * 3 + 2] = pz
        quat.set([qx, qy, qz, qw], n * 4)
        whirl[n] = 0
        n++
      }
      return {
        n,
        pos: pos.slice(0, n * 3),
        quat: quat.slice(0, n * 4),
        land,
        apex,
        apexT,
        hits,
        whirl: whirl.slice(0, n),
        committed: Math.max(committed, land),
        end: (n - 1) / RATE,
        flips: ny < 0,
      }
    }
  }
  return null
}

/** what makes a flight worth showing: lands in the light, some life after landing, not too long */
export function goodFlight(f: Flight | null): f is Flight {
  if (!f) return false
  const last = f.n - 1
  const ex = f.pos[last * 3]
  const ez = f.pos[last * 3 + 2]
  const after = f.end - f.land
  return Math.hypot(ex, ez) < 1.7 && after > 0.9 && after < 2.7 && f.hits.length >= 2
}

/** how long a flight rolls on its rim and spins down after landing, s (what makes the end worth watching) */
export function liveliness(f: Flight) {
  let edge = 0
  let spin = 0
  for (let j = Math.ceil((f.land + 0.08) * RATE); j < f.n; j++) {
    const y = f.pos[j * 3 + 1]
    const qx = f.quat[j * 4]
    const qz = f.quat[j * 4 + 2]
    const ny = Math.abs(1 - 2 * (qx * qx + qz * qz))
    const tilt = Math.acos(Math.min(1, ny))
    if (y < Math.sin(tilt) * RADIUS + ny * HALF + 0.03 && tilt > 0.35) edge += 1 / RATE
    if (f.whirl[j] > 20) spin += 1 / RATE
  }
  return { edge, spin }
}

/**
 * A flight worth showing (tries up to `tries` launches; null if none was). Most of the time it holds out for one
 * that rolls on its rim or spins down for a while, the coin's best moment; `lively` says whether to.
 */
export function makeFlight(lively: boolean, r: () => number = Math.random, tries = 60): Flight | null {
  let fallback: Flight | null = null
  for (let i = 0; i < tries; i++) {
    const f = simulate(randomLaunch(r), 7, { after: 2.7, dist: 2.6 })
    if (!goodFlight(f)) continue
    if (!lively) return f
    const l = liveliness(f)
    if (l.spin >= 0.35 || l.edge >= 0.3) return f
    fallback ??= f
  }
  return fallback
}

/* ---------------- showing a flight from any rest pose ---------------- */

export type Q = [number, number, number, number]
export type V3 = [number, number, number]

export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
/** a turn of `a` radians about the body's own axis (y) */
export const yaw = (a: number): Q => [0, Math.sin(a / 2), 0, Math.cos(a / 2)]
/** turned over: half a turn about the body's x axis */
export const OVER: Q = [1, 0, 0, 0]

/** the world direction of the heads axis for an orientation */
export const axisOf = (q: Q): V3 => {
  const [x, y, z, w] = q
  return [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)]
}

/**
 * A rest pose: the coin flat, `face` up, turned `turn` radians about its axis. Heads up is the identity (body y
 * up); tails up is turned over first.
 */
export function restQuat(face: 'heads' | 'tails', turn: number): Q {
  return face === 'heads' ? yaw(turn) : qmul(yaw(turn), OVER)
}

/**
 * The flat pose nearest an orientation: which face is up and how far it is turned (so the next flight can start
 * exactly from it).
 */
export function flatten(q: Q): { face: 'heads' | 'tails'; turn: number } {
  const ax = axisOf(q)
  const face = ax[1] >= 0 ? 'heads' : 'tails'
  // body x in world, its heading on the table
  const [x, y, z, w] = q
  const bx = 1 - 2 * (y * y + z * z)
  const bz = 2 * (x * z - w * y)
  // for heads up, yaw(a) sends body x to (cos a, 0, -sin a); turned over, body x still goes to the same heading
  const turn = Math.atan2(-bz, bx)
  return { face, turn }
}

/**
 * The body-frame turn that shows `f` from a coin lying `startFace` up turned `turn`, ending `endFace` up. Possible
 * exactly when f.flips says the faces differ the way they must; the flight's path is untouched, only the disc is
 * turned within itself (it is the same disc either way up and at any turn about its axis).
 */
export function bodyTurn(f: Flight, startFace: 'heads' | 'tails', turn: number, endFace: 'heads' | 'tails'): Q | null {
  if (f.flips !== (startFace !== endFace)) return null
  // the flight starts at the identity (heads up, no turn): the body turn is the rest pose itself
  return restQuat(startFace, turn)
}

/** the orientation at sample i of a flight, turned within the body by `b` */
export function sampleQuat(f: Flight, i: number, b: Q): Q {
  const q: Q = [f.quat[i * 4], f.quat[i * 4 + 1], f.quat[i * 4 + 2], f.quat[i * 4 + 3]]
  return qmul(q, b)
}

/**
 * The same, for a flight also turned as a whole about the vertical by `phi` (so it is flicked from whichever side the
 * camera stands): the table, gravity and the disc are all the same under that turn, so this is the same flight seen
 * from another side. Shown as W(phi) q(t) b with b = the rest pose turned back by phi, it still starts exactly as the
 * coin lies (W b = the rest pose) and, like bodyTurn, never touches which face comes up. Null when the parity is wrong.
 */
export function showTurn(f: Flight, startFace: 'heads' | 'tails', turn: number, endFace: 'heads' | 'tails', phi: number): Q | null {
  if (f.flips !== (startFace !== endFace)) return null
  return restQuat(startFace, turn - phi)
}

/** the shown orientation at sample i: the flight's sample, turned within the body by b and as a whole by phi */
export function showQuat(f: Flight, i: number, b: Q, phi: number): Q {
  return qmul(yaw(phi), sampleQuat(f, i, b))
}

/** the shown position at sample i: the flight's own path turned about the vertical by phi */
export function showPos(f: Flight, i: number, phi: number): V3 {
  const x = f.pos[i * 3]
  const z = f.pos[i * 3 + 2]
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  return [x * c + z * s, f.pos[i * 3 + 1], -x * s + z * c]
}

/** the tilt of the coin's axis from the vertical at sample i (radians) */
export function tiltAt(f: Flight, i: number) {
  const ax = axisOf([f.quat[i * 4], f.quat[i * 4 + 1], f.quat[i * 4 + 2], f.quat[i * 4 + 3]])
  return Math.acos(Math.min(1, Math.abs(ax[1])))
}

/**
 * When the outcome can be read: the face is decided (it never passes upright again) and the coin stays within
 * `deg` degrees of flat from then on, so its face is plain to see while it rolls and wobbles out. Sim time, s.
 */
export function readableAt(f: Flight, deg = 30) {
  const lim = (deg * Math.PI) / 180
  let at = 0
  for (let i = f.n - 1; i >= 0; i--)
    if (tiltAt(f, i) >= lim) {
      at = (i + 1) / RATE
      break
    }
  return Math.min(f.end, Math.max(at, f.committed + 0.08, f.land + 0.22))
}
