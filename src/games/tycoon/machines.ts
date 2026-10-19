import * as THREE from 'three'
import { Attraction, CREAM, GOLD, GOLD_D, ROPES_AT, stool, velvetRopes, type Drive } from './attraction'
import { C, T, TAU, TKit, along, box, bulbs, cyl, glassMaterial, rbox, slabXY, sphere, star, tint, type P3 } from './models'

/*
  The two arcade pieces: the Claw Machine (a pink cabinet whose claw roams, drops, grabs a plush and drops it down
  the prize chute) and the Slot Machine (a red cabinet with three spinning reels, a lever that pulls before they spin
  and a topper light that flashes when it pays). Both stand in a row facing the front, 1 to 4 of them, then two rows
  (the claws) or a carousel round a spinning 777 drum (the slots).
*/

const _m = new THREE.Matrix4()
const _n = new THREE.Matrix4()
const _l = new THREE.Matrix4()
const _c = new THREE.Color()
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x))
const hash = (a: number, b: number) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453
  return s - Math.floor(s)
}
/** 0 → 1 → 0 over `len` seconds after a pay moment */
const flare = (pay: number, len = 0.5) => (pay < len ? Math.sin((pay / len) * Math.PI) : 0)

/* ---------------- the claw machine ---------------- */

const PINK = '#ff5fa2'
const MINT = '#47e0c8'
const PLUSH = ['#ffb3c7', '#9fd8ff', '#ffe08a', '#b9f5a5', '#d2b3ff', '#ffc59a'].map((c) => C(c))
/** the cabinet is modelled a bit big and shrunk by S; the claw moves in the cabinet's units */
const S = 0.9
const GANTRY = 1.64
const CLAW_TOP = 1.5
const CLAW_LOW = 1.04
const CHUTE: [number, number] = [-0.28, 0.2]

function clawCabinet() {
  const k = new TKit()
  k.push(T([0, 0, 0], [0, 0, 0], S))
  // the base: a mint stripe, the prize flap and the coin door
  k.add(rbox(1.0, 0.8, 0.92, 0.09), PINK, T([0, 0.4, 0]))
  k.add(box(1.006, 0.09, 0.926), MINT, T([0, 0.62, 0]), 0)
  k.add(rbox(0.32, 0.26, 0.03, 0.05), '#6a1f45', T([-0.22, 0.27, 0.462]), 0)
  k.add(rbox(0.28, 0.05, 0.03, 0.02), '#ffd1e6', T([-0.22, 0.39, 0.47]), 0)
  k.add(rbox(0.13, 0.22, 0.03, 0.03), '#ffd84a', T([0.26, 0.3, 0.462]), 0)
  k.add(box(0.03, 0.09, 0.02), '#3a1630', T([0.26, 0.33, 0.48]), 0)
  // the control ledge: a joystick and a big button
  k.add(rbox(1.02, 0.09, 0.28, 0.035), CREAM, T([0, 0.84, 0.5]))
  k.add(cyl(0.018, 0.12, 6), '#3a3346', T([0.24, 0.88, 0.54]), 0)
  k.add(sphere(0.055, 10, 8), '#ff3b4f', T([0.24, 1.01, 0.54]))
  k.add(cyl(0.065, 0.035, 14), '#ffd84a', T([-0.1, 0.885, 0.54]))
  // the glass case: corner posts and a floor of plushies (bears) round the prize chute
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(box(0.07, 0.84, 0.07), CREAM, T([sx * 0.465, 1.29, sz * 0.415]))
  k.add(box(0.93, 0.05, 0.85), '#ffd1e6', T([0, 0.86, 0]), 0)
  const pile: [number, number, number][] = [
    [0.14, -0.22, 0],
    [0.33, 0.06, 1],
    [-0.04, 0.02, 2],
    [0.32, -0.27, 3],
    [-0.27, -0.24, 4],
    [0.1, 0.24, 5],
    [-0.05, -0.3, 1],
    [0.2, -0.04, 4],
  ]
  pile.forEach(([x, z, c], i) => {
    const y = 0.95 + (i % 3) * 0.035
    k.add(sphere(0.1, 8, 6), PLUSH[c], T([x, y, z]))
    for (const s of [-1, 1]) k.add(sphere(0.042, 6, 4), PLUSH[c], T([x + s * 0.075, y + 0.075, z - 0.01]), 0)
    k.add(sphere(0.038, 6, 4), '#fff6ee', T([x, y - 0.02, z + 0.085]), 0)
  })
  // the chute: a cream-walled hole in the front left
  k.add(box(0.3, 0.14, 0.03), CREAM, T([CHUTE[0], 0.93, CHUTE[1] - 0.15]), 0.6)
  k.add(box(0.03, 0.14, 0.3), CREAM, T([CHUTE[0] + 0.15, 0.93, CHUTE[1]]), 0.6)
  k.add(box(0.27, 0.01, 0.27), '#3a1630', T([CHUTE[0], 0.89, CHUTE[1]]), 0)
  // the roof: a glowing name band, bulbs, the gantry the claw hangs from and a star on top
  k.add(rbox(1.08, 0.3, 0.98, 0.09), PINK, T([0, 1.85, 0]))
  k.add(rbox(0.82, 0.16, 0.03, 0.05), C('#fff2a8', 1.25), T([0, 1.86, 0.49]), 0, { flat: true })
  bulbs(k, along([[-0.5, 1.72, 0.5], [0.5, 1.72, 0.5]], 8), 0.028)
  bulbs(k, along([[-0.5, 1.99, 0.5], [0.5, 1.99, 0.5]], 8), 0.028, undefined, 0.5)
  k.add(box(0.9, 0.035, 0.05), '#cfd3e6', T([0, GANTRY + 0.03, 0]), 0)
  k.add(slabXY(star(0, 0, 0.18, 0.085), 0.07, 0.015), '#ffd84a', T([0, 2.16, 0.035]))
  k.pop()
  return k.geometry()
}

function clawGlass() {
  const g = new THREE.BoxGeometry(0.88, 0.8, 0.8)
  g.translate(0, 1.29, 0)
  g.scale(S, S, S)
  return g
}

/** the claw: a gold hub with three silver prongs (origin at the hub) */
function clawHead() {
  const k = new TKit()
  k.push(T([0, 0, 0], [0, 0, 0], S))
  k.add(cyl(0.06, 0.07, 12), GOLD, T([0, -0.035, 0]), 1, { shine: 1 })
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5
    const c = Math.cos(a)
    const s = Math.sin(a)
    const pts: P3[] = [
      [c * 0.04, -0.03, s * 0.04],
      [c * 0.12, -0.12, s * 0.12],
      [c * 0.07, -0.21, s * 0.07],
    ]
    k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 6, 0.016, 5), '#dfe3f0', undefined, 0.7)
  }
  k.pop()
  return k.geometry()
}

function cable() {
  const g = new THREE.CylinderGeometry(0.008, 0.008, 1, 4, 1, true)
  g.translate(0, -0.5, 0)
  const k = new TKit()
  k.add(g, '#7c8094', undefined, 0)
  return k.geometry()
}

function plush() {
  const k = new TKit()
  k.push(T([0, 0, 0], [0, 0, 0], S))
  k.add(sphere(0.1, 10, 8), '#ffffff')
  for (const s of [-1, 1]) k.add(sphere(0.042, 8, 6), '#ffffff', T([s * 0.075, 0.075, -0.01]), 0.6)
  k.add(sphere(0.04, 8, 6), '#fff6ee', T([0, -0.02, 0.085]), 0)
  k.pop()
  return k.geometry()
}

export class ClawMachines extends Attraction {
  private readonly cab = this.batch(clawCabinet(), 8, undefined, 'claw-cab')
  private readonly glass = this.batch(clawGlass(), 8, glassMaterial(), 'claw-glass')
  private readonly claw = this.batch(clawHead(), 8, undefined, 'claw-head')
  private readonly cables = this.batch(cable(), 8, undefined, 'claw-cable')
  private readonly prize = this.batch(plush(), 8, undefined, 'claw-plush')

  constructor(i: number) {
    super(i)
    this.minCycle = 2.6
    this.top = 2.2
    this.popAt.set(0, 2.3, 0.6)
    this.sign('CLAW', '#ff5fa2', 1.6)
    this.extra(velvetRopes(), ROPES_AT)
    this.award((k, y) => {
      // a golden teddy bear
      k.add(sphere(0.2, 14, 10), GOLD, T([0, y + 0.2, 0]), 1, { shine: 1 })
      k.add(sphere(0.16, 14, 10), GOLD, T([0, y + 0.5, 0.02]), 1, { shine: 1 })
      for (const s of [-1, 1]) k.add(sphere(0.065, 10, 8), GOLD, T([s * 0.12, y + 0.63, 0]), 1, { shine: 1 })
      k.add(sphere(0.06, 10, 8), C('#ffe9a8'), T([0, y + 0.46, 0.15]), 0)
    })
  }

  protected arrange(tier: number) {
    const n = [1, 2, 3, 4, 6, 8][tier]
    const front = Math.min(4, n)
    const back = n - front
    for (let k = 0; k < back; k++) this.unit((k - (back - 1) / 2) * 1.02, -0.95)
    for (let k = 0; k < front; k++) this.unit((k - (front - 1) / 2) * 1.0, back ? 0.72 : 0.35)
  }

  protected draw(d: Drive) {
    const e = flare(d.pay, 0.4)
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m)
      // a little boing when it pays
      _m.multiply(_l.makeScale(1 - 0.03 * e, 1 + 0.06 * e, 1 - 0.03 * e))
      this.cab.put(_m)
      this.glass.put(_m)
      const run = d.cyc + u.seed
      const p = run - Math.floor(run)
      const round = Math.floor(run)
      // where the claw is in the cabinet: out to a spot, down, grab, up, back over the chute and let go
      const tx = (hash(round, i) - 0.5) * 0.55
      const tz = (hash(i, round) - 0.5) * 0.4 - 0.05
      let x = CHUTE[0]
      let z = CHUTE[1]
      let y = CLAW_TOP
      let held = false
      let drop = -1
      if (d.on) {
        if (p < 0.3) {
          const a = ease(p / 0.3)
          x = CHUTE[0] + (tx - CHUTE[0]) * a
          z = CHUTE[1] + (tz - CHUTE[1]) * a
        } else if (p < 0.78) {
          x = tx
          z = tz
          const down = p < 0.48 ? ease((p - 0.3) / 0.18) : p < 0.56 ? 1 : 1 - ease((p - 0.56) / 0.22)
          y = CLAW_TOP - (CLAW_TOP - CLAW_LOW) * down
          held = p >= 0.53
        } else if (p < 0.94) {
          const a = ease((p - 0.78) / 0.16)
          x = tx + (CHUTE[0] - tx) * a
          z = tz + (CHUTE[1] - tz) * a
          held = true
        } else drop = (p - 0.94) / 0.06
      } else x += Math.sin(d.t * 1.3 + u.seed * 9) * 0.03
      _n.copy(_m).multiply(_l.makeTranslation(x * S, y * S, z * S))
      this.claw.put(_n)
      _n.copy(_m).multiply(_l.makeTranslation(x * S, GANTRY * S, z * S)).multiply(_l.makeScale(1, Math.max(0.01, (GANTRY - y) * S), 1))
      this.cables.put(_n)
      const col = PLUSH[(round + i) % PLUSH.length]
      if (held) this.prize.put(_n.copy(_m).multiply(_l.makeTranslation(x * S, (y - 0.24) * S, z * S)), col)
      else if (drop >= 0) {
        const s = 1 - drop
        this.prize.put(_n.copy(_m).multiply(_l.makeTranslation(x * S, (CLAW_TOP - 0.24 - drop * 0.55) * S, z * S)).multiply(_l.makeScale(s, s, s)), col)
      }
    }
  }
}

/* ---------------- the slot machine ---------------- */

const RED = '#e2364f'
const RED_D = '#b81f3a'
const REEL_R = 0.105
const REEL_Y = 1.0
const REEL_Z = 0.17
const REEL_X = [-0.17, 0, 0.17]
const SYMBOLS = ['#e8233a', '#ffc53a', '#2f7bff', '#8a3bff', '#1fbf6a', '#ff8d3b', '#e8233a', '#20212e'].map((c) => C(c))
const TOPPERS = ['#ff4f6e', '#4fc3ff', '#ffd23f', '#7cff6a', '#c77dff'].map((c) => C(c, 1.25))
const SPIN_STOP = [0.78, 0.84, 0.9]
/** the slot cabinet is drawn this much bigger than modelled */
const SS = 1.12
const HOT = new THREE.Color(2.2, 2.1, 1.9)

function slotCabinet() {
  const k = new TKit()
  // the base, a gold band and the button deck
  k.add(rbox(0.78, 0.56, 0.66, 0.06), RED_D, T([0, 0.28, 0]))
  k.add(box(0.784, 0.05, 0.664), GOLD, T([0, 0.5, 0]), 0, { shine: 1 })
  k.add(rbox(0.78, 0.08, 0.3, 0.03), '#2a2238', T([0, 0.6, 0.2], [0.25, 0, 0]))
  ;['#ff4f6e', '#ffd23f', '#4fc3ff'].forEach((c, i) => k.add(rbox(0.12, 0.04, 0.08, 0.02), C(c, 1.15), T([-0.2 + i * 0.2, 0.65, 0.22], [0.25, 0, 0]), 0, { flat: true }))
  // the body: a gold bezel round the dark reel window, with a payline across it
  k.add(rbox(0.76, 0.78, 0.5, 0.06), RED, T([0, 1.03, -0.07]))
  k.add(box(0.6, 0.05, 0.05), GOLD, T([0, REEL_Y + 0.18, 0.19]), 1, { shine: 1 })
  k.add(box(0.6, 0.05, 0.05), GOLD, T([0, REEL_Y - 0.18, 0.19]), 1, { shine: 1 })
  for (const s of [-1, 1]) k.add(box(0.05, 0.41, 0.05), GOLD, T([s * 0.28, REEL_Y, 0.19]), 1, { shine: 1 })
  k.add(box(0.52, 0.32, 0.02), '#1a1426', T([0, REEL_Y, 0.18]), 0)
  k.add(box(0.54, 0.012, 0.01), C('#ff3b4f', 1.3), T([0, REEL_Y, 0.29]), 0, { flat: true })
  // the arched top with a gold plate, three sevens and a ring of bulbs
  k.add(new THREE.CylinderGeometry(0.38, 0.38, 0.5, 22, 1, false, Math.PI / 2, Math.PI), RED, T([0, 1.42, -0.07], [Math.PI / 2, 0, 0]))
  k.add(new THREE.CircleGeometry(0.29, 20, 0, Math.PI), GOLD, T([0, 1.43, 0.185]), 0, { shine: 1 })
  for (const x of [-0.13, 0, 0.13]) k.add(slabXY([[-0.045, 0.1], [0.045, 0.1], [0.045, 0.07], [-0.005, -0.08], [-0.04, -0.08], [0.005, 0.07], [-0.045, 0.07]], 0.02), '#d6213e', T([x, 1.53, 0.205]), 0)
  bulbs(k, Array.from({ length: 9 }, (_, i): P3 => [Math.cos((i / 8) * Math.PI) * 0.355, 1.43 + Math.sin((i / 8) * Math.PI) * 0.355, 0.19]), 0.026)
  // the topper's socket and the lever's
  k.add(cyl(0.08, 0.05, 12), GOLD_D, T([0, 1.8, -0.07]))
  k.add(cyl(0.045, 0.1, 10), '#bfc4d6', T([0.385, 0.95, -0.05], [0, 0, -Math.PI / 2]))
  // its stool
  stool(k, 0, 0.72)
  return k.geometry()
}

function reel() {
  const g = tint(new THREE.CylinderGeometry(REEL_R, REEL_R, 0.13, 24, 1), (x, y, z) => {
    if (Math.abs(y) > 0.06) return C('#c9c9d6')
    const a = (Math.atan2(x, z) / TAU + 1) % 1
    const f = (a * SYMBOLS.length) % 1
    return f > 0.22 && f < 0.78 ? SYMBOLS[Math.floor(a * SYMBOLS.length)] : C('#fffaf0')
  })
  g.rotateZ(Math.PI / 2)
  const k = new TKit()
  k.add(g, '#ffffff', undefined, 0.6)
  return k.geometry()
}

function lever() {
  const k = new TKit()
  k.add(cyl(0.022, 0.36, 8), '#d8dce8', T([0, 0, 0]))
  k.add(sphere(0.06, 12, 10), '#ff3b4f', T([0, 0.38, 0]))
  return k.geometry()
}

function topper() {
  const k = new TKit()
  k.add(new THREE.SphereGeometry(0.13, 16, 8, 0, TAU, 0, Math.PI / 2), '#ffffff', undefined, 1, { flat: true })
  return k.geometry()
}

/** the carousel's middle: a round plinth with a 777 drum turning on top (origin on the floor) */
function slotDrum() {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(cyl(0.78, 0.9, 28), RED_D, T([0, 0, 0]))
  k.add(cyl(0.8, 0.06, 28), GOLD, T([0, 0.9, 0]), 1, { shine: 1 })
  k.add(cyl(0.1, 0.8, 10), GOLD_D, T([0, 0.96, 0]))
  g.add(k.mesh('drum-base'))
  const d = new TKit()
  d.add(cyl(0.62, 0.55, 28), '#221a3a', T([0, 0, 0]))
  for (const y of [0, 0.55]) d.add(cyl(0.65, 0.06, 28), GOLD, T([0, y - 0.03, 0]), 1, { shine: 1 })
  // three gold sevens round the drum and a ring of bulbs above and below them
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    d.add(slabXY([[-0.09, 0.16], [0.09, 0.16], [0.09, 0.11], [-0.01, -0.16], [-0.08, -0.16], [0.01, 0.11], [-0.09, 0.11]], 0.04), i % 2 ? C('#ff3b4f', 1.2) : C('#ffd23f', 1.2), T([Math.sin(a) * 0.62, 0.28, Math.cos(a) * 0.62], [0, a, 0]), 0, { flat: true })
  }
  for (const y of [0.07, 0.48]) bulbs(d, Array.from({ length: 18 }, (_, i): P3 => [Math.sin((i / 18) * TAU) * 0.63, y, Math.cos((i / 18) * TAU) * 0.63]), 0.03)
  const drum = d.mesh('drum')
  drum.position.y = 1.7
  g.add(drum)
  g.userData.drum = drum
  return g
}

export class SlotMachines extends Attraction {
  private readonly cab = this.batch(slotCabinet(), 8, undefined, 'slot-cab')
  private readonly reels = this.batch(reel(), 24, undefined, 'slot-reel')
  private readonly levers = this.batch(lever(), 8, undefined, 'slot-lever')
  private readonly toppers = this.batch(topper(), 8, undefined, 'slot-topper')
  private readonly drum: THREE.Group

  constructor(i: number) {
    super(i)
    this.minCycle = 2.4
    this.top = 2.2
    this.popAt.set(0, 2.2, 0.6)
    this.drum = slotDrum()
    this.drum.position.set(0, 0, -0.25)
    this.extra(this.drum, 4)
    this.sign('SLOTS', '#ff3b4f', 1.7, 2.6)
    this.extra(velvetRopes(), ROPES_AT)
    this.award((k, y) => {
      k.add(slabXY([[-0.2, 0.36], [0.2, 0.36], [0.2, 0.25], [-0.01, -0.36], [-0.17, -0.36], [0.03, 0.25], [-0.2, 0.25]], 0.12, 0.02), GOLD, T([0, y + 0.42, 0.06]), 1, { shine: 1 })
    })
  }

  protected arrange(tier: number) {
    if (tier < 4) {
      const n = tier + 1
      for (let k = 0; k < n; k++) this.unit((k - (n - 1) / 2) * 0.98, 0.25)
      return
    }
    // a carousel round the drum, facing out
    const n = tier === 4 ? 6 : 8
    for (let k = 0; k < n; k++) {
      const a = ((k + 0.5) / n) * TAU
      this.unit(Math.sin(a) * 1.22, Math.cos(a) * 1.22 - 0.25, a)
    }
  }

  protected draw(d: Drive) {
    const e = flare(d.pay, 0.9)
    const drum = this.drum.userData.drum as THREE.Object3D
    drum.rotation.y = d.t * (0.5 + e * 3)
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i]
      this.place(u, d.t, _m).multiply(_l.makeScale(SS, SS, SS))
      this.cab.put(_m)
      const run = d.cyc + u.seed * 0.35
      const p = d.on ? run - Math.floor(run) : 0
      const round = Math.floor(run)
      // the lever pulls, then the reels spin and stop one by one on this round's symbols
      const pull = d.on && p > 0.46 && p < 0.62 ? Math.sin(((p - 0.46) / 0.16) * Math.PI) : 0
      this.levers.put(_n.copy(_m).multiply(_l.makeTranslation(0.43, 0.95, -0.05)).multiply(_l.makeRotationX(pull * 1.15)))
      for (let j = 0; j < 3; j++) {
        const from = Math.floor(hash(round - 1, j + i * 3) * 8)
        const to = Math.floor(hash(round, j + i * 3) * 8)
        // symbol s faces the front at a turn of (s + ½) eighths; the reels roll downwards
        const a0 = (from + 0.5) * (TAU / 8)
        let a = a0
        if (d.on && p > 0.5) {
          const turn = TAU * 5 + ((((to - from) * TAU) / 8) % TAU + TAU) % TAU
          const u2 = Math.min(1, (p - 0.5) / (SPIN_STOP[j] - 0.5))
          a = a0 + turn * (1 - (1 - u2) ** 3)
        }
        this.reels.put(_n.copy(_m).multiply(_l.makeTranslation(REEL_X[j], REEL_Y, REEL_Z)).multiply(_l.makeRotationX(a)))
      }
      // the topper: its own colour, flashing white-hot when it pays
      const strobe = e > 0 ? 0.5 + 0.5 * Math.sign(Math.sin(d.t * 30 + i)) : 0
      _c.copy(TOPPERS[i % TOPPERS.length]).lerp(HOT, e * strobe)
      this.toppers.put(_n.copy(_m).multiply(_l.makeTranslation(0, 1.85, -0.07)), _c)
    }
  }
}
