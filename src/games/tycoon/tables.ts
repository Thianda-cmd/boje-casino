import * as THREE from 'three'
import { Attraction, CHIP_COLORS, FELT, GOLD, GOLD_D, ROPES_AT, WOOD, WOOD_D, cardGeometry, chair, chipStack, flatRing, rail, stool, velvetRopes, type Drive } from './attraction'
import { C, T, TAU, TKit, box, bulbs, cyl, flatXZ, lathe, rbox, rrect, slabXY, slabXZ, sphere, star, tint, type P2, type P3 } from './models'
import { POSE, UNIFORM, guestOutfit } from './people'

/*
  The table games, each round a felt table with its dealer: the Dice Table (craps: two dice thrown the length of the
  table, bouncing off the far wall), Blackjack (a half-moon table where the cards fly out of the shoe to five seats
  and the dealer turns over the hole card), the Roulette Wheel (the wheel spins, the ball races round the other way
  and drops into a pocket; a giant wheel of fortune joins at 25) and the Poker Room (an oval table of seated players,
  the flop, turn and river turning over; a second table and panelled walls at 25).
*/

const _m = new THREE.Matrix4()
const _n = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _v = new THREE.Vector3()
const _s = new THREE.Vector3(1, 1, 1)
const _k = new THREE.Vector3()
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
/** the height of every table top */
const TH = 0.5

/** a wooden pedestal and body under a felt top of outline `pts` (its inset copy `inset` is the felt) */
function feltTable(k: TKit, pts: P2[], inset: P2[], felt: THREE.ColorRepresentation, pedestal: [number, number]) {
  k.add(rbox(pedestal[0], TH - 0.16, pedestal[1], 0.05), WOOD_D, T([0, (TH - 0.16) / 2, 0]))
  k.add(slabXZ(pts, 0.12, 0.02), WOOD, T([0, TH - 0.16, 0]))
  k.add(flatXZ(inset, TH + 0.003), felt, undefined, 0)
}

/* ---------------- the dice table ---------------- */

const DICE_W = 1.45

function crapsTable(L: number) {
  const k = new TKit()
  const W = DICE_W
  feltTable(k, rrect(0, 0, L, W, 0.6, 6), rrect(0, 0, L - 0.2, W - 0.2, 0.5, 6), FELT, [L * 0.55, W * 0.45])
  // the pass line loop, the come box and a row of number boxes along the back
  k.add(flatRing(rrect(0, 0, L - 0.5, W - 0.5, 0.36, 6), rrect(0, 0, L - 0.58, W - 0.58, 0.32, 6), TH + 0.006), '#f4fff4', undefined, 0)
  k.add(flatRing(rrect(0, 0.08, L * 0.42, 0.42, 0.06, 2), rrect(0, 0.08, L * 0.42 - 0.06, 0.36, 0.04, 2), TH + 0.006), '#f4fff4', undefined, 0)
  k.add(flatXZ(rrect(0, 0.08, L * 0.42 - 0.1, 0.32, 0.03, 2), TH + 0.005), '#c8233a', undefined, 0)
  const nb = 6
  for (let i = 0; i < nb; i++) {
    const x = (i - (nb - 1) / 2) * ((L * 0.5) / nb)
    k.add(flatRing(rrect(x, -0.38, 0.2, 0.17, 0.02, 2), rrect(x, -0.38, 0.16, 0.13, 0.02, 2), TH + 0.006), '#f4fff4', undefined, 0)
  }
  rail(k, rrect(0, 0, L - 0.08, W - 0.08, 0.56, 8), TH + 0.03, 0.07, '#6a1d2e')
  // the dealers' chip racks along the back
  for (let i = 0; i < 6; i++) chipStack(k, (i - 2.5) * 0.17, TH + 0.01, -W / 2 + 0.24, 3 + (i % 3), CHIP_COLORS[i % CHIP_COLORS.length], 0.06)
  return k.geometry()
}

function die() {
  const k = new TKit()
  k.add(rbox(0.13, 0.13, 0.13, 0.025), '#ea2b45', undefined, 0.8)
  const pip = (p: P3) => k.add(sphere(0.017, 6, 4), '#ffffff', T(p), 0, { flat: true })
  pip([0, 0.066, 0])
  for (const s of [-1, 1]) {
    pip([s * 0.035, 0.035 * s, 0.066])
    pip([0.066, s * 0.03, s * 0.03])
    pip([-0.066, 0, 0])
    pip([s * 0.035, -0.035, -0.066])
  }
  return k.geometry()
}

export class DiceTables extends Attraction {
  private readonly small = this.batch(crapsTable(2.4), 1, undefined, 'craps-small')
  private readonly big = this.batch(crapsTable(3.1), 2, undefined, 'craps-big')
  private readonly dice = this.batch(die(), 4, undefined, 'dice')
  private len = 2.4

  constructor(i: number) {
    super(i)
    this.minCycle = 3
    this.top = 1.4
    this.popAt.set(0, 1.4, 0.8)
    this.sign('CRAPS', '#3fe08a', 1.7, 1.9)
    this.extra(velvetRopes(), ROPES_AT)
    this.award((k, y) => {
      k.add(rbox(0.42, 0.42, 0.42, 0.07), GOLD, T([0, y + 0.3, 0], [0.5, 0.6, 0.2]), 1, { shine: 1 })
    })
  }

  protected arrange(tier: number) {
    this.len = tier === 0 ? 2.4 : 3.1
    const zs = tier < 2 ? [0.5] : [-1.05, 1.05]
    for (const z of zs) {
      this.unit(0, z)
      for (const x of tier > 0 ? [-0.45, 0.45] : [0]) this.person(x, z - DICE_W / 2 - 0.32, 0, UNIFORM.dealer(this.rand), POSE.deal)
    }
  }

  protected draw(d: Drive) {
    const L = this.len
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m)
      ;(this.tier === 0 ? this.small : this.big).put(_m)
      const run = d.cyc + u.seed * 0.3
      const p = d.on ? run - Math.floor(run) : 0.05
      const round = Math.floor(run)
      for (let j = 0; j < 2; j++) {
        const hx = L / 2 - 0.42
        const fx = -L / 2 + 0.45 + j * 0.16
        const fz = (hash(round, j) - 0.5) * 0.5
        const sz = 0.1 + j * 0.16
        let x: number
        let y = TH + 0.068
        let z: number
        let spin = 0
        if (p < 0.3) {
          // the stickman pushes last throw's dice back to the shooter
          const a = ease(p / 0.3)
          const pz = (hash(round - 1, j) - 0.5) * 0.5
          x = fx + (hx - fx) * a
          z = pz + (sz - pz) * a
        } else if (p < 0.55) {
          x = hx
          z = sz
        } else if (p < 0.9) {
          // thrown: three bounces down the table, tumbling
          const a = (p - 0.55) / 0.35
          x = hx + (fx - hx) * (1 - (1 - a) ** 2)
          z = sz + (fz - sz) * a
          const b = a * 3
          y += Math.abs(Math.sin(b * Math.PI)) * 0.35 * (1 - a) ** 1.5
          spin = (1 - (1 - a) ** 2) * 14 + j
        } else {
          x = fx
          z = fz
          spin = 14 + j
        }
        _q.setFromEuler(_e.set(spin * 1.3, spin * 0.7 + j, spin * 0.4))
        _n.compose(_v.set(x, y, z), _q, _s)
        this.dice.put(_l.copy(_m).multiply(_n))
      }
    }
  }
}

/* ---------------- blackjack ---------------- */

const BJ_R = 1.08
const BJ_BACK = -0.4
const SEATS = 5
const BJ_FELT = '#13806e'
/** a point on the half-moon at angle a (0 = right end, π = left end), radius r */
const moon = (a: number, r: number): P2 => [Math.cos(a) * r, BJ_BACK + Math.sin(a) * r * 0.82]
const moonArc = (r: number, a0 = 0, a1 = Math.PI, n = 26): P2[] => Array.from({ length: n + 1 }, (_, i) => moon(a0 + ((a1 - a0) * i) / n, r))
const seatAngle = (j: number) => Math.PI * (0.18 + 0.16 * j)
const SHOE: P3 = [0.62, TH + 0.12, BJ_BACK + 0.17]

function bjTable() {
  const k = new TKit()
  feltTable(k, moonArc(BJ_R), moonArc(BJ_R - 0.1), BJ_FELT, [1.2, 0.5])
  // the gold arc of lettering and five betting rings
  k.add(flatXZ([...moonArc(0.5, 0.22 * Math.PI, 0.78 * Math.PI, 16), ...moonArc(0.46, 0.22 * Math.PI, 0.78 * Math.PI, 16).reverse()], TH + 0.006), GOLD, undefined, 0, { shine: 0.6 })
  for (let j = 0; j < SEATS; j++) {
    const [x, z] = moon(seatAngle(j), 0.8)
    k.add(new THREE.RingGeometry(0.07, 0.095, 20), '#f4fff8', T([x, TH + 0.006, z], [-Math.PI / 2, 0, 0]), 0)
  }
  rail(k, moonArc(BJ_R - 0.03, 0.02, Math.PI - 0.02), TH + 0.03, 0.065, '#2a1f2e', false)
  // the dealer's chip tray and the card shoe
  k.add(rbox(0.62, 0.05, 0.18, 0.02), '#2a2238', T([-0.05, TH + 0.025, BJ_BACK + 0.13]))
  for (let i = 0; i < 6; i++) chipStack(k, -0.3 + i * 0.1, TH + 0.04, BJ_BACK + 0.13, 2, CHIP_COLORS[i], 0.04)
  k.add(rbox(0.18, 0.1, 0.26, 0.03), '#c8213b', T([SHOE[0], TH + 0.05, SHOE[2]], [0, -0.4, 0]))
  // the stools round the curve
  for (let j = 0; j < SEATS; j++) {
    const [x, z] = moon(seatAngle(j), BJ_R + 0.28)
    stool(k, x, z, '#1f6fd6')
  }
  return k.geometry()
}

/** where card c of the round lands: seats' two cards, then the dealer's two */
function cardSpot(c: number, out: P3) {
  if (c < SEATS * 2) {
    const j = c % SEATS
    const [x, z] = moon(seatAngle(j), 0.58)
    out[0] = x + (c >= SEATS ? 0.05 : -0.03)
    out[1] = TH + 0.012 + (c >= SEATS ? 0.012 : 0)
    out[2] = z + (c >= SEATS ? 0.03 : 0)
  } else {
    out[0] = (c - SEATS * 2) * 0.16 - 0.08
    out[1] = TH + 0.012
    out[2] = BJ_BACK + 0.36
  }
  return out
}
const _spot: P3 = [0, 0, 0]

export class BlackjackTables extends Attraction {
  private readonly table = this.batch(bjTable(), 3, undefined, 'bj-table')
  private readonly cards = this.batch(cardGeometry(), 3 * (SEATS * 2 + 2), undefined, 'bj-cards')

  constructor(i: number) {
    super(i)
    this.minCycle = 3.2
    this.top = 1.3
    this.popAt.set(0, 1.3, 0.5)
    this.sign('BLACKJACK', '#4fc3ff', 1.9, 1.9)
    this.extra(velvetRopes(), ROPES_AT)
    this.award((k, y) => {
      k.add(rbox(0.36, 0.5, 0.05, 0.04), GOLD, T([0, y + 0.34, 0], [0, 0.4, 0.15]), 1, { shine: 1 })
      k.add(slabXY(star(0, 0, 0.1, 0.05), 0.02), '#fff4c8', T([0.006, y + 0.34, 0.03], [0, 0.4, 0.15]), 0)
    })
  }

  protected arrange(tier: number) {
    const spots: [number, number][] = tier === 0 ? [[0, 0.45]] : tier === 1 ? [[-1.06, 0.45], [1.06, 0.45]] : [[-1.06, 0.85], [1.06, 0.85], [0, -0.95]]
    for (const [x, z] of spots) {
      this.unit(x, z)
      this.person(x, z + BJ_BACK - 0.3, 0, UNIFORM.dealer(this.rand), POSE.deal)
    }
  }

  protected draw(d: Drive) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m)
      this.table.put(_m)
      if (!d.on) continue
      const run = d.cyc + u.seed * 0.4
      const p = run - Math.floor(run)
      const total = SEATS * 2 + 2
      for (let c = 0; c < total; c++) {
        const start = 0.03 + c * 0.024
        if (p < start) continue
        cardSpot(c, _spot)
        const f = Math.min(1, (p - start) / 0.07)
        const a = ease(f)
        let x = SHOE[0] + (_spot[0] - SHOE[0]) * a
        let y = SHOE[1] + (_spot[1] - SHOE[1]) * a + Math.sin(f * Math.PI) * 0.18
        let z = SHOE[2] + (_spot[2] - SHOE[2]) * a
        // every card but the dealer's hole card turns face up as it lands; the hole card turns over at 0.7
        const hole = c === total - 1
        let flip = hole ? (p > 0.7 ? ease((p - 0.7) / 0.06) : 0) : a
        let s = 1
        if (p > 0.93) {
          // swept away to the discard tray
          const w = ease((p - 0.93) / 0.07)
          x += (-0.6 - x) * w
          z += (BJ_BACK + 0.16 - z) * w
          y += 0.05 * w
          s = 1 - w
          flip = 1
        }
        _q.setFromEuler(_e.set(0, 0.25 * (1 - a), Math.PI * (1 - flip)))
        _n.compose(_v.set(x, y, z), _q, _k.setScalar(Math.max(0.001, s)))
        this.cards.put(_l.copy(_m).multiply(_n))
      }
    }
  }
}

/* ---------------- roulette ---------------- */

const RL_L = 2.7
const RL_W = 1.25
const WHEEL_X = -0.86
const POCKETS = 37

function rouletteTable() {
  const k = new TKit()
  feltTable(k, rrect(0, 0, RL_L, RL_W, 0.22, 4), rrect(0, 0, RL_L - 0.16, RL_W - 0.16, 0.16, 4), '#178a4c', [RL_L * 0.6, RL_W * 0.45])
  rail(k, rrect(0, 0, RL_L - 0.05, RL_W - 0.05, 0.2, 4), TH + 0.02, 0.055, '#4a1222')
  // the betting layout: a white board of red and black numbers, a green zero
  const gx0 = -0.24
  const cols = 12
  const cw = 0.115
  const rh = 0.21
  k.add(flatXZ(rrect(gx0 + (cols * cw) / 2 + 0.02, 0, cols * cw + 0.2, rh * 3 + 0.06, 0.03, 2), TH + 0.005), '#f4fff4', undefined, 0)
  k.add(flatXZ(rrect(gx0 - 0.05, 0, 0.1, rh * 3 - 0.02, 0.03, 2), TH + 0.007), '#1fbf6a', undefined, 0)
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < 3; r++) {
      const red = (c + r) % 2 === 0
      k.add(flatXZ(rrect(gx0 + 0.06 + c * cw + cw / 2, (r - 1) * rh, cw - 0.022, rh - 0.03, 0.015, 2), TH + 0.007), red ? '#d6213e' : '#20212e', undefined, 0)
    }
  // the wheel's bowl: a wooden rim round a sloping cream track
  k.add(
    lathe(
      [
        [0.38, 0.0],
        [0.56, 0.0],
        [0.6, 0.1],
        [0.57, 0.16],
        [0.52, 0.15],
        [0.44, 0.08],
        [0.4, 0.06],
      ],
      36,
    ),
    WOOD,
    T([WHEEL_X, TH, 0]),
  )
  k.add(new THREE.RingGeometry(0.41, 0.53, 36), '#f2e6cc', T([WHEEL_X, TH + 0.1, 0], [-Math.PI / 2, 0, 0]), 0)
  // a few chips on the numbers
  chipStack(k, 0.3, TH + 0.01, -0.2, 3, CHIP_COLORS[1], 0.045)
  chipStack(k, 0.72, TH + 0.01, 0.2, 2, CHIP_COLORS[4], 0.045)
  return k.geometry()
}

/** the turning part of the wheel: 37 pockets round a gold turret (origin at its centre on the table) */
function rouletteWheel() {
  const k = new TKit()
  const disc = tint(new THREE.CylinderGeometry(0.405, 0.42, 0.06, POCKETS, 1), (x, y, z) => {
    if (y < 0.02 && Math.hypot(x, z) > 0.39) return C('#7a4a22')
    const a = (Math.atan2(x, z) / TAU + 1) % 1
    const n = Math.floor(a * POCKETS)
    if (Math.hypot(x, z) < 0.26) return C('#8a5530')
    return n === 0 ? C('#1fbf6a') : n % 2 ? C('#d6213e') : C('#1c1a24')
  })
  k.add(disc, '#ffffff', T([0, 0.06, 0]), 0.8)
  k.add(lathe([[0, 0.24], [0.06, 0.22], [0.08, 0.12], [0.14, 0.09], [0.0, 0.09]], 16), GOLD, undefined, 1, { shine: 1 })
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU
    k.add(new THREE.CapsuleGeometry(0.014, 0.16, 2, 6), GOLD, T([Math.cos(a) * 0.12, 0.2, Math.sin(a) * 0.12], [0, -a, Math.PI / 2]), 0.6, { shine: 1 })
  }
  return k.geometry()
}

function ball() {
  const k = new TKit()
  k.add(sphere(0.032, 10, 8), '#ffffff', undefined, 0.6)
  return k.geometry()
}

/** the wheel of fortune that joins at 25: a big upright wheel of coloured wedges ringed with bulbs (origin on the floor) */
function fortuneWheel() {
  const g = new THREE.Group()
  const k = new TKit()
  // the stand: an A-frame on a base
  k.add(rbox(1.6, 0.18, 0.7, 0.06), '#3a2b55', T([0, 0.09, 0]))
  for (const s of [-1, 1]) k.add(rbox(0.12, 1.75, 0.12, 0.04), GOLD_D, T([s * 0.45, 0.95, -0.12], [0, 0, s * 0.2]))
  k.add(slabXY([[0, -0.22], [0.13, 0.05], [-0.13, 0.05]], 0.08, 0.015), '#ff3b4f', T([0, 2.95, 0.12]))
  g.add(k.mesh('fortune-stand'))
  const w = new TKit()
  const R = 1.05
  const colors = ['#ff4f6e', '#ffd23f', '#4fc3ff', '#7cdc5a', '#c77dff', '#ff8d3b'].map((c) => C(c))
  const face = tint(new THREE.CylinderGeometry(R, R, 0.1, 48, 1), (x, y, z) => {
    if (Math.abs(y) < 0.04) return C(GOLD)
    const a = (Math.atan2(x, z) / TAU + 1) % 1
    return colors[Math.floor(a * 12) % colors.length]
  })
  w.add(face, '#ffffff', T([0, 0, 0], [Math.PI / 2, 0, 0]))
  w.add(new THREE.TorusGeometry(R, 0.07, 8, 48), GOLD, undefined, 1, { shine: 1 })
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    w.add(new THREE.CylinderGeometry(0.015, 0.015, R * 2, 4), C('#fff4c8'), T([0, 0, 0.055], [0, 0, a]), 0)
  }
  bulbs(
    w,
    Array.from({ length: 24 }, (_, i): P3 => [Math.cos((i / 24) * TAU) * (R + 0.02), Math.sin((i / 24) * TAU) * (R + 0.02), 0.08]),
    0.04,
  )
  w.add(cyl(0.16, 0.16, 16), GOLD, T([0, 0, 0.0], [Math.PI / 2, 0, 0]), 1, { shine: 1 })
  const wheel = w.mesh('fortune-wheel')
  wheel.position.set(0, 1.75, 0)
  g.add(wheel)
  g.userData.wheel = wheel
  return g
}

export class RouletteTables extends Attraction {
  private readonly table = this.batch(rouletteTable(), 2, undefined, 'rl-table')
  private readonly wheels = this.batch(rouletteWheel(), 2, undefined, 'rl-wheel')
  private readonly balls = this.batch(ball(), 2, undefined, 'rl-ball')
  private readonly spin = new Float32Array(2)
  private readonly fortune: THREE.Group
  private fortuneAngle = 0
  private fortuneSpeed = 0.3

  constructor(i: number) {
    super(i)
    this.minCycle = 4
    this.top = 1.2
    this.popAt.set(-0.8, 1.3, 0.6)
    this.fortune = fortuneWheel()
    this.fortune.position.set(-0.35, 0, -1.85)
    this.extra(this.fortune, 2)
    this.sign('ROULETTE', '#ffd23f', 1.9, 2.4)
    this.extra(velvetRopes(), ROPES_AT)
    this.award((k, y) => {
      k.add(new THREE.TorusGeometry(0.22, 0.06, 8, 24), GOLD, T([0, y + 0.32, 0], [0, 0.6, 0]), 1, { shine: 1 })
      k.add(sphere(0.07, 10, 8), '#fffaf0', T([0, y + 0.32, 0]))
    })
  }

  protected arrange(tier: number) {
    const zs = tier === 0 ? [0.55] : [1.05, -0.55]
    for (const z of zs) {
      this.unit(0, z)
      this.person(WHEEL_X + 0.1, z - RL_W / 2 - 0.3, 0, UNIFORM.dealer(this.rand), POSE.deal)
    }
    this.top = tier >= 2 ? 3.0 : 1.2
  }

  protected draw(d: Drive) {
    // the wheel of fortune spins up whenever the tables pay
    const want = d.pay < 0.3 ? 9 : 0.3
    this.fortuneSpeed += (want - this.fortuneSpeed) * Math.min(1, d.dt * (want > this.fortuneSpeed ? 6 : 0.5))
    this.fortuneAngle += this.fortuneSpeed * d.dt
    ;(this.fortune.userData.wheel as THREE.Object3D).rotation.z = this.fortuneAngle
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m)
      this.table.put(_m)
      const run = d.cyc + u.seed * 0.5
      const p = d.on ? run - Math.floor(run) : 0
      // the wheel: turning slowly, sped up for each spin
      const fast = d.on && p > 0.2 && p < 0.92 ? 5.5 * (1 - (p - 0.2) / 0.72) ** 1.5 : 0
      this.spin[i] += (0.5 + fast) * d.dt
      const w = this.spin[i]
      this.wheels.put(_n.copy(_m).multiply(_l.makeTranslation(WHEEL_X, TH, 0)).multiply(_l.makeRotationY(w)))
      // the ball: races round the track the other way, slows, drops in and rides its pocket
      const round = Math.floor(run)
      const pocket = (Math.floor(hash(round, i) * POCKETS) / POCKETS) * TAU
      let a: number
      let r: number
      let y: number
      if (d.on && p > 0.25 && p < 0.86) {
        const k = (p - 0.25) / 0.61
        a = -(1 - (1 - k) ** 2) * 40 + pocket + w
        r = k < 0.8 ? 0.47 : 0.47 - (k - 0.8) * 0.75
        y = TH + 0.13 + (k > 0.8 ? Math.abs(Math.sin((k - 0.8) * 50)) * 0.04 * (1 - k) * 5 : 0)
      } else {
        a = pocket + w
        r = 0.33
        y = TH + 0.1
      }
      _n.copy(_m).multiply(_l.makeTranslation(WHEEL_X + Math.sin(a) * r, y, Math.cos(a) * r))
      this.balls.put(_n)
    }
  }
}

/* ---------------- poker ---------------- */

const PK_L = 2.3
const PK_W = 1.25
/** the seats round the oval (x, z, facing); the dealer stands at the middle of the back */
const PK_SEATS: [number, number, number][] = [
  [-0.62, PK_W / 2 + 0.34, Math.PI],
  [0.62, PK_W / 2 + 0.34, Math.PI],
  [PK_L / 2 + 0.34, 0, -Math.PI / 2],
  [0.72, -PK_W / 2 - 0.34, 0],
  [-0.72, -PK_W / 2 - 0.34, 0],
  [-PK_L / 2 - 0.34, 0, Math.PI / 2],
]

function pokerTable() {
  const k = new TKit()
  feltTable(k, rrect(0, 0, PK_L, PK_W, 0.62, 8), rrect(0, 0, PK_L - 0.22, PK_W - 0.22, 0.52, 8), '#1a8a4a', [PK_L * 0.45, PK_W * 0.4])
  rail(k, rrect(0, 0, PK_L - 0.06, PK_W - 0.06, 0.6, 8), TH + 0.035, 0.08, '#1c1a26')
  k.add(flatRing(rrect(0, 0, PK_L - 0.6, PK_W - 0.6, 0.36, 8), rrect(0, 0, PK_L - 0.64, PK_W - 0.64, 0.34, 8), TH + 0.006), '#3fb873', undefined, 0)
  // each player's chips and the chairs round the table
  PK_SEATS.forEach(([x, z, a], j) => {
    const cx = x * 0.62
    const cz = z * 0.55
    chipStack(k, cx + Math.cos(a) * 0.08, TH + 0.01, cz, 2 + (j % 3), CHIP_COLORS[j % CHIP_COLORS.length], 0.045)
    chipStack(k, cx - Math.cos(a) * 0.06, TH + 0.01, cz + 0.06, 1 + (j % 2), CHIP_COLORS[(j + 2) % CHIP_COLORS.length], 0.045)
    chair(k, x, z, a)
  })
  return k.geometry()
}

function pot() {
  const k = new TKit()
  chipStack(k, -0.07, 0, 0, 4, CHIP_COLORS[0], 0.05)
  chipStack(k, 0.06, 0, 0.04, 3, CHIP_COLORS[1], 0.05)
  chipStack(k, 0.0, 0, -0.08, 5, CHIP_COLORS[4], 0.05)
  return k.geometry()
}

/** panelled walls on the plot's two far sides (the camera looks over them), with lamps */
function backWalls(rot: number, color = '#5a2f4a') {
  const k = new TKit()
  const e = 2.24
  const H = 1.35
  // the far sides in this plot's frame: always local −z, and −x or +x whichever lies away from the camera
  const side = rot === 0 ? -1 : 1
  const walls: [number, number, number, number][] = [
    [0, -e, 2 * e + 0.16, 0.16],
    [side * e, 0, 0.16, 2 * e + 0.16],
  ]
  for (const [x, z, w, d] of walls) {
    k.add(rbox(w, H, d, 0.04), color, T([x, H / 2, z]))
    k.add(rbox(w + 0.04, 0.1, d + 0.06, 0.03), GOLD, T([x, H, z]), 1, { shine: 0.6 })
    k.add(box(w - 0.1, 0.06, d + 0.02), '#3a1d30', T([x, 0.35, z]), 0)
  }
  // wall lamps
  for (const t of [-1.2, 0, 1.2]) {
    k.add(sphere(0.09, 10, 8), C('#ffe2a8', 1.2), T([t, 1.0, -e + 0.12]), 0.6, { lamp: true, flat: true })
    k.add(sphere(0.09, 10, 8), C('#ffe2a8', 1.2), T([side * (e - 0.12), 1.0, t]), 0.6, { lamp: true, flat: true })
  }
  return k.mesh('walls')
}

export class PokerTables extends Attraction {
  private readonly table = this.batch(pokerTable(), 2, undefined, 'pk-table')
  private readonly cards = this.batch(cardGeometry(), 2 * 5, undefined, 'pk-cards')
  private readonly pots = this.batch(pot(), 2, undefined, 'pk-pot')

  constructor(i: number) {
    super(i)
    this.minCycle = 5
    this.top = 1.4
    this.popAt.set(0, 1.4, 0.4)
    // panelled walls instead of velvet ropes
    this.extra(backWalls(this.root.rotation.y), 2)
    this.sign('POKER', '#3fe08a', 1.7, 2.0)
    this.award((k, y) => {
      for (let i = 0; i < 5; i++) k.add(cyl(0.16, 0.06, 18), i % 2 ? GOLD : '#fff0c0', T([0, y + i * 0.065, 0]), i === 4 ? 1 : 0, { shine: 1 })
    })
  }

  protected arrange(tier: number) {
    const tables: [number, number, number][] = tier < 2 ? [[0, 0.3, 0]] : [[-1.08, 0.05, Math.PI / 2], [1.08, 0.05, Math.PI / 2]]
    const players = tier === 0 ? 4 : 5
    for (const [x, z, rot] of tables) {
      this.unit(x, z, rot)
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c]
      // the dealer at the middle of the far long side, players in the chairs
      const [dx, dz] = at(0, -PK_W / 2 - 0.36)
      this.person(dx, dz, rot, UNIFORM.dealer(this.rand), POSE.deal)
      const order = [0, 1, 2, 5, 3, 4]
      for (let j = 0; j < players; j++) {
        const [sx, sz, a] = PK_SEATS[order[j]]
        const [px, pz] = at(sx * 0.93, sz * 0.9)
        this.person(px, pz, a + rot, guestOutfit(this.rand), POSE.sit, true, 0.04)
      }
    }
  }

  protected draw(d: Drive) {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m)
      this.table.put(_m)
      if (!d.on) continue
      const run = d.cyc + u.seed * 0.3
      const p = run - Math.floor(run)
      const round = Math.floor(run)
      // the flop, the turn and the river turn over; then the pot slides to the winner
      for (let c = 0; c < 5; c++) {
        const show = c < 3 ? 0.18 : c === 3 ? 0.4 : 0.6
        const dealt = 0.05 + c * 0.02
        if (p < dealt || p > 0.95) continue
        const flip = ease((p - show) / 0.05)
        _q.setFromEuler(_e.set(0, 0, Math.PI * (1 - flip)))
        _n.compose(_v.set((c - 2) * 0.17, TH + 0.012 + Math.sin(flip * Math.PI) * 0.06, 0.02), _q, _s)
        this.cards.put(_l.copy(_m).multiply(_n))
      }
      // the pot grows in front of the dealer as the hand goes on, then slides to the winner's seat
      const seat = PK_SEATS[Math.floor(hash(round, i) * PK_SEATS.length)]
      const go = p > 0.8 ? ease((p - 0.8) / 0.15) : 0
      const s = (1 - Math.max(0, (p - 0.95) / 0.05)) * (0.4 + 0.6 * ease(p / 0.7))
      _n.compose(_v.set(seat[0] * 0.55 * go, TH + 0.01, -0.3 + (seat[1] * 0.5 + 0.3) * go), _q.identity(), _k.setScalar(Math.max(0.001, s)))
      this.pots.put(_l.copy(_m).multiply(_n))
    }
  }
}
