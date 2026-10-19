import * as THREE from 'three'
import { Attraction, CREAM, GOLD, GOLD_D, ROPES_AT, SIGN_AT, TROPHY_AT, WOOD, WOOD_D, chair, marqueeSign, popScale, stool, trophy, velvetRopes, type Drive } from './attraction'
import { C, T, TAU, TKit, along, box, bulbs, cyl, fitText, flatXZ, glassMaterial, lathe, rbox, rrect, slabXY, slabXZ, sphere, star, textPlane, toonMaterial, tube, type P2, type P3 } from './models'
import { POSE, UNIFORM } from './people'

/*
  The four big venues at the back of the floor: the VIP Lounge (velvet sofas on a purple dais behind a rope and a
  bouncer, a gold pergola with a chandelier at 25, a champagne tower at 100), the Sky Bar (a building with the bar
  on its roof deck: it gains storeys as it grows, the deck rising with it), the Grand Stage (a curtained stage with a
  singer; dancers and sweeping spotlights at 25, pyro columns at 100) and the Penthouse Suites (a hotel tower that
  gains floors at every step, a crown and a beacon on top).
*/

const _m = new THREE.Matrix4()
const _c = new THREE.Color()
const flare = (pay: number, len = 0.5) => (pay < len ? Math.sin((pay / len) * Math.PI) : 0)
const approach = (x: number, to: number, rate: number, dt: number) => x + (to - x) * Math.min(1, rate * dt)

/** a neon sign: glowing letters (and a cocktail glass) on a dark board, facing +z, standing on y = 0 */
function neonBoard(text: string, color: string, w: number, h: number, glass = false) {
  const plane = textPlane(w, h, 512, (c, cw, ch) => {
    c.lineJoin = 'round'
    c.shadowColor = color
    c.shadowBlur = ch * 0.18
    c.strokeStyle = color
    c.lineWidth = ch * 0.05
    const x0 = glass ? ch * 0.55 : 0
    if (glass) {
      // a martini glass with an olive
      c.beginPath()
      c.moveTo(ch * 0.12, ch * 0.2)
      c.lineTo(ch * 0.62, ch * 0.2)
      c.lineTo(ch * 0.37, ch * 0.52)
      c.closePath()
      c.moveTo(ch * 0.37, ch * 0.52)
      c.lineTo(ch * 0.37, ch * 0.78)
      c.moveTo(ch * 0.22, ch * 0.8)
      c.lineTo(ch * 0.52, ch * 0.8)
      c.stroke()
      c.fillStyle = '#7dff8a'
      c.beginPath()
      c.arc(ch * 0.42, ch * 0.3, ch * 0.06, 0, TAU)
      c.fill()
    }
    c.fillStyle = '#ffffff'
    fitText(c, text, x0 + (cw - x0) / 2, ch * 0.53, ch * 0.62, (cw - x0) * 0.92, 800, 0.05)
  }, 1.7)
  plane.userData.text = true
  return plane
}

/** a folded curtain w wide, h tall: a wavy ribbon stood up (front +z) */
function curtain(w: number, h: number, folds: number, color: THREE.ColorRepresentation) {
  const n = folds * 8
  const front: P2[] = []
  const back: P2[] = []
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (w * i) / n
    const z = Math.sin((i / n) * folds * TAU) * 0.08
    front.push([x, z + 0.03])
    back.push([x, z - 0.03])
  }
  const k = new TKit()
  k.add(slabXZ([...front, ...back.reverse()], h), color)
  return k.geometry()
}

let coneMat: THREE.ShaderMaterial | null = null
/** the spotlights' beams: additive, bright at the lamp and fading out (uv.y is 1 at a cone's tip) */
function beamMaterial() {
  return (coneMat ??= new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color('#fff2c0') }, uAlpha: { value: 0.25 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv; void main() { gl_FragColor = vec4(uColor * uAlpha * (0.25 + 0.75 * vUv.y * vUv.y), 1.0); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  }))
}
export const releaseVenues = () => {
  coneMat?.dispose()
  coneMat = null
}

/* ---------------- the VIP lounge ---------------- */

const VELVET = '#b3213f'
const PURPLE = '#5b2a86'

function sofa() {
  const k = new TKit()
  k.add(rbox(1.5, 0.2, 0.62, 0.07), VELVET, T([0, 0.3, 0]))
  for (const x of [-0.36, 0.36]) k.add(rbox(0.7, 0.12, 0.54, 0.06), '#d23a58', T([x, 0.45, 0.03]))
  k.add(rbox(1.5, 0.6, 0.2, 0.08), VELVET, T([0, 0.6, -0.24]))
  for (const s of [-1, 1]) k.add(rbox(0.2, 0.44, 0.64, 0.08), VELVET, T([s * 0.75, 0.42, 0]))
  // buttoned back and gold feet
  for (let i = 0; i < 5; i++) k.add(sphere(0.022, 6, 4), GOLD, T([-0.56 + i * 0.28, 0.72, -0.135]), 0)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(0.04, 0.2, 8), GOLD, T([sx * 0.7, 0, sz * 0.24]), 0, { shine: 1 })
  return k.geometry()
}

/** the dais: a purple carpet with a gold edge, a coffee table with champagne, and the rope at the door */
function loungeDais() {
  const k = new TKit()
  k.add(slabXZ(rrect(0, 0, 4.4, 4.4, 0.4, 5), 0.08, 0.02), GOLD_D, T([0, -0.02, 0]))
  k.add(flatXZ(rrect(0, 0, 4.2, 4.2, 0.32, 5), 0.105), PURPLE, undefined, 0)
  k.add(flatXZ(rrect(0, 0, 3.4, 3.4, 0.28, 5), 0.107), '#6c35a0', undefined, 0)
  // the coffee table, an ice bucket with a bottle, two glasses
  k.add(cyl(0.48, 0.05, 24), GOLD, T([0, 0.36, 0]), 1, { shine: 1 })
  k.add(cyl(0.44, 0.02, 24), '#2a2238', T([0, 0.41, 0]), 0)
  k.add(cyl(0.08, 0.26, 10), GOLD_D, T([0, 0.1, 0]))
  k.add(cyl(0.12, 0.17, 14, 0.09), '#c9d0e0', T([0.12, 0.42, -0.06]))
  k.add(cyl(0.045, 0.28, 10), '#1f5a32', T([0.12, 0.5, -0.06]))
  k.add(cyl(0.02, 0.08, 6), GOLD, T([0.12, 0.78, -0.06]), 0)
  for (const [x, z] of [
    [-0.18, 0.12],
    [-0.05, 0.2],
  ]) {
    k.add(cyl(0.008, 0.1, 5), '#e8f6ff', T([x, 0.43, z]), 0)
    k.add(lathe([[0.0, 0], [0.05, 0.05], [0.055, 0.08], [0.0, 0.03]], 10), C('#fff2a8', 1.1), T([x, 0.52, z]), 0.5)
  }
  // the rope at the door: two stanchions each side of the way in
  for (const s of [-1, 1]) {
    for (const x of [s * 0.6, s * 1.65]) {
      k.add(cyl(0.1, 0.04, 12), GOLD_D, T([x, 0.1, 1.95]))
      k.add(cyl(0.03, 0.6, 6), GOLD, T([x, 0.13, 1.95]), 1, { shine: 1 })
      k.add(sphere(0.05, 8, 6), GOLD, T([x, 0.76, 1.95]), 1, { shine: 1 })
    }
    k.add(tube([[s * 0.6, 0.68, 1.95], [s * 1.12, 0.5, 1.95], [s * 1.65, 0.68, 1.95]], 0.028, 10, 6), '#c41d3c')
  }
  return k.mesh('lounge-dais')
}

/** the pergola at 25: gold posts and beams, a curtain along the back and a chandelier in the middle */
function pergola() {
  const k = new TKit()
  const e = 1.85
  const H = 2.5
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.add(cyl(0.07, H, 10), GOLD, T([sx * e, 0.1, sz * e]), 1, { shine: 0.8 })
  for (const s of [-1, 1]) {
    k.add(rbox(2 * e + 0.2, 0.12, 0.12, 0.04), GOLD, T([0, H + 0.1, s * e]), 1, { shine: 0.8 })
    k.add(rbox(0.12, 0.12, 2 * e + 0.2, 0.04), GOLD, T([s * e, H + 0.1, 0]), 1, { shine: 0.8 })
  }
  k.add(rbox(0.06, 0.06, 2 * e, 0.02), GOLD_D, T([0, H + 0.14, 0]), 0)
  k.add(rbox(2 * e, 0.06, 0.06, 0.02), GOLD_D, T([0, H + 0.14, 0]), 0)
  // the chandelier: a gold ring of glowing crystals on a chain
  k.add(cyl(0.012, 0.5, 4), GOLD_D, T([0, H - 0.36, 0]), 0)
  k.add(new THREE.TorusGeometry(0.34, 0.03, 6, 24), GOLD, T([0, H - 0.4, 0], [Math.PI / 2, 0, 0]), 1, { shine: 1 })
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU
    k.add(new THREE.OctahedronGeometry(0.05), C('#e8f8ff', 1.5), T([Math.cos(a) * 0.34, H - 0.5, Math.sin(a) * 0.34]), 0, { flat: true })
  }
  k.add(new THREE.OctahedronGeometry(0.09), C('#e8f8ff', 1.6), T([0, H - 0.62, 0]), 0, { flat: true })
  // a hanging curtain along the back beam, and string lights along the front
  const g = new THREE.Group()
  g.add(k.mesh('pergola'))
  const back = new THREE.Mesh(curtain(2 * e, 2.3, 6, '#7a1f6a'), toonMaterial())
  back.position.set(0, 0.15, -e - 0.04)
  g.add(back)
  const lights = new TKit()
  const sag: P3[] = []
  for (let i = 0; i <= 12; i++) {
    const x = -e + (2 * e * i) / 12
    sag.push([x, H - 0.05 - Math.sin((i / 12) * Math.PI) * 0.35, e])
  }
  bulbs(lights, sag, 0.04, C('#ffe9a8', 1.7))
  g.add(lights.mesh('pergola-lights'))
  return g
}

function champagneTower() {
  const k = new TKit()
  k.add(cyl(0.42, 0.05, 20), CREAM, T([0, 0.5, 0]))
  k.add(cyl(0.06, 0.5, 10), GOLD_D, T([0, 0, 0]))
  k.add(cyl(0.24, 0.04, 14), GOLD_D, T([0, 0, 0]))
  const coupe = (x: number, y: number, z: number) => {
    k.add(cyl(0.008, 0.06, 5), '#e8f6ff', T([x, y, z]), 0)
    k.add(lathe([[0.0, 0], [0.07, 0.02], [0.08, 0.05], [0.0, 0.03]], 10), C('#fff0a0', 1.15), T([x, y + 0.06, z]), 0.4, { flat: true })
  }
  const rows = [3, 2, 1]
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) coupe((i - (n - 1) / 2) * 0.16, 0.55 + r * 0.11, (j - (n - 1) / 2) * 0.16)
  })
  k.add(cyl(0.05, 0.3, 10), '#1f5a32', T([0, 0.9, 0]))
  k.add(cyl(0.022, 0.1, 6), GOLD, T([0, 1.2, 0]), 0)
  return k.mesh('champagne')
}

export class VipLounge extends Attraction {
  private readonly sofas = this.batch(sofa(), 3, undefined, 'sofa')

  constructor(i: number) {
    super(i)
    this.minCycle = 5
    this.top = 1.4
    this.popAt.set(0.12, 1.1, -0.06)
    this.extra(loungeDais(), 0)
    this.extra(pergola(), 2)
    const tower = champagneTower()
    tower.position.set(1.45, 0.1, 1.35)
    this.extra(tower, ROPES_AT)
    this.sign('VIP', '#c77dff', 1.2, 2.9)
    const prize = trophy((k, y) => {
      k.add(lathe([[0, 0], [0.18, 0.02], [0.2, 0.12], [0.08, 0.2], [0.03, 0.3], [0.15, 0.5], [0.0, 0.45]], 16), GOLD, T([0, y, 0]), 1, { shine: 1 })
    })
    prize.position.set(-1.5, 0.1, 1.4)
    this.extra(prize, TROPHY_AT)
  }

  protected arrange(tier: number) {
    const spots: [number, number, number][] = [
      [0, -1.15, 0],
      [-1.2, 0.05, Math.PI / 2],
      [1.2, 0.05, -Math.PI / 2],
    ]
    const n = Math.min(3, tier + 1)
    for (let k = 0; k < n; k++) {
      const [x, z, rot] = spots[k]
      this.unit(x, z, rot, 0.1)
      // one or two VIPs on each sofa
      const c = Math.cos(rot)
      const s = Math.sin(rot)
      for (const off of tier > 1 ? [-0.36, 0.36] : [0.3]) this.person(x + off * c + 0.06 * s, z - off * s + 0.06 * c, rot, UNIFORM.vip(this.rand), POSE.sit, true, 0.12)
    }
    this.person(0.0, 2.1, 0, UNIFORM.bouncer(), POSE.stand, false, 0.1)
    this.top = tier >= 2 ? 2.8 : 1.4
  }

  protected draw(d: Drive) {
    for (let i = 0; i < this.units.length; i++) this.sofas.put(this.place(this.units[i], d.t, _m))
  }
}

/* ---------------- the sky bar ---------------- */

const STOREY = 1.45
const BAR_TEAL = '#1fb5b0'

function storey(ground: boolean) {
  const k = new TKit()
  k.add(rbox(3.8, STOREY - 0.12, 3.1, 0.06), '#e9d8bd', T([0, (STOREY - 0.12) / 2, 0]), 1, { windows: true })
  k.add(rbox(3.94, 0.12, 3.24, 0.04), CREAM, T([0, STOREY - 0.06, 0]))
  if (ground) {
    // the door under a striped awning, with lamps
    k.add(rbox(0.9, 1.0, 0.06, 0.03), '#2a2238', T([0, 0.5, 1.56]), 0)
    k.add(rbox(0.8, 0.92, 0.04, 0.03), C('#ffd27a', 1.1), T([0, 0.47, 1.58]), 0, { lamp: true })
    for (let i = 0; i < 6; i++) k.add(box(0.24, 0.05, 0.6), i % 2 ? '#ffffff' : BAR_TEAL, T([-0.6 + i * 0.24, 1.15, 1.8], [0.35, 0, 0]), 0.5)
    for (const s of [-1, 1]) k.add(sphere(0.07, 8, 6), C('#ffe2a8', 1.2), T([s * 0.65, 0.85, 1.6]), 0.5, { lamp: true, flat: true })
  }
  return k.geometry()
}

/** the roof deck: planks, a glass rail, the bar with its shelf of bottles and neon sign, stools */
function barDeck() {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(rbox(3.94, 0.1, 3.24, 0.03), '#c08a58', T([0, 0.05, 0]))
  for (let i = 0; i < 9; i++) k.add(box(0.02, 0.005, 3.1), '#9a6a40', T([-1.8 + i * 0.45, 0.103, 0]), 0)
  // the bar: a teal counter with a gold top, the bottle shelf behind
  k.add(rbox(2.7, 0.5, 0.45, 0.06), BAR_TEAL, T([0, 0.35, -0.35]))
  k.add(rbox(2.8, 0.06, 0.55, 0.03), GOLD, T([0, 0.62, -0.35]), 1, { shine: 1 })
  k.add(rbox(2.6, 0.95, 0.3, 0.04), WOOD_D, T([0, 0.57, -1.45]))
  const bottle = ['#3fe08a', '#ff5a76', '#ffd23f', '#4fc3ff', '#c77dff', '#ff8d3b']
  for (let r = 0; r < 2; r++)
    for (let i = 0; i < 9; i++) {
      const x = -1.1 + i * 0.27
      k.add(cyl(0.05, 0.2, 8), C(bottle[(i + r * 2) % bottle.length], 1.1), T([x, 0.62 + r * 0.38, -1.38]), 0.5)
      k.add(cyl(0.02, 0.07, 6), C(bottle[(i + r * 2) % bottle.length], 1.1), T([x, 0.82 + r * 0.38, -1.38]), 0)
    }
  for (const x of [-0.8, 0, 0.8]) stool(k, x, 0.15, '#ff5a76')
  // cocktails on the counter
  for (const x of [-0.6, 0.35]) k.add(lathe([[0, 0], [0.07, 0.08], [0.0, 0.08]], 10), C('#ff6fc8', 1.2), T([x, 0.72, -0.3]), 0.4, { flat: true })
  g.add(k.mesh('deck'))
  // a glass rail round the deck
  const rail = new THREE.Mesh(railGeo(), glassMaterial())
  g.add(rail)
  const sign = neonBoard('SKY BAR', '#ff4fb8', 2.3, 0.7, true)
  sign.position.set(0, 1.45, -1.58)
  g.add(sign)
  return g
}

function railGeo() {
  const parts: THREE.BufferGeometry[] = []
  const add = (w: number, d: number, x: number, z: number) => {
    const b = new THREE.BoxGeometry(w, 0.5, d)
    b.translate(x, 0.35, z)
    parts.push(b.toNonIndexed())
  }
  add(3.9, 0.04, 0, 1.6)
  add(0.04, 3.2, 1.95, 0)
  add(0.04, 3.2, -1.95, 0)
  const g = new THREE.BufferGeometry()
  const pos = parts.flatMap((p) => Array.from(p.getAttribute('position').array as Float32Array))
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  for (const p of parts) p.dispose()
  return g
}

function umbrellas() {
  const k = new TKit()
  for (const x of [-1.35, 1.35]) {
    k.add(cyl(0.025, 1.5, 6), '#ffffff', T([x, 0.1, 0.95]), 0.6)
    const cone = new THREE.ConeGeometry(0.75, 0.35, 12, 1, true)
    k.add(cone, '#ffffff', T([x, 1.55, 0.95]))
    for (let i = 0; i < 12; i += 2) {
      const a = (i / 12) * TAU + Math.PI / 12
      k.add(new THREE.ConeGeometry(0.75, 0.35, 2, 1, true, a, TAU / 12), BAR_TEAL, T([x, 1.551, 0.95]), 0)
    }
    chair(k, x - 0.35, 1.3, Math.PI, '#ffffff')
  }
  return k.mesh('umbrellas')
}

function stringLights() {
  const k = new TKit()
  const corners: P3[] = [
    [-1.9, 1.6, 1.55],
    [1.9, 1.6, 1.55],
    [1.9, 1.6, -1.55],
  ]
  for (const p of corners) k.add(cyl(0.035, 1.6, 6), WOOD, T([p[0], 0, p[2]]))
  const sag = (a: P3, b: P3): P3[] => Array.from({ length: 11 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 10, a[1] - Math.sin((i / 10) * Math.PI) * 0.3, a[2] + ((b[2] - a[2]) * i) / 10])
  bulbs(k, [...sag(corners[0], corners[1]), ...sag(corners[1], corners[2])], 0.045, C('#fff0b0', 1.7))
  return k.mesh('string-lights')
}

export class SkyBar extends Attraction {
  private readonly ground = this.batch(storey(true), 1, undefined, 'bar-ground')
  private readonly upper = this.batch(storey(false), 2, undefined, 'bar-upper')
  private readonly deck = new THREE.Group()
  private deckY = STOREY
  private storeys = 1

  constructor(i: number) {
    super(i)
    this.minCycle = 5
    this.deck.add(barDeck())
    this.deck.add(this.extra(umbrellas(), 1))
    this.deck.add(this.extra(stringLights(), SIGN_AT))
    const prize = trophy((k, y) => {
      k.add(lathe([[0, 0], [0.16, 0.02], [0.03, 0.05], [0.03, 0.3], [0.28, 0.55], [0.0, 0.55]], 14), GOLD, T([0, y, 0]), 1, { shine: 1 })
    })
    prize.position.set(1.6, 0.1, -0.9)
    prize.scale.setScalar(0.7)
    this.deck.add(this.extra(prize, TROPHY_AT))
    this.root.add(this.deck)
    this.extra(velvetRopes(1.6), ROPES_AT)
  }

  protected arrange(tier: number) {
    this.storeys = [1, 1, 2, 2, 3, 3][tier]
    for (let k = 0; k < this.storeys; k++) this.unit(0, -0.4, 0, k * STOREY)
    const top = this.storeys * STOREY
    this.person(0, -0.95, 0, UNIFORM.bartender(this.rand), POSE.shake, true, top)
    for (const x of [-0.8, 0.8]) this.person(x, 0.15, Math.PI, UNIFORM.vip(this.rand), POSE.sit, true, top + 0.06)
    this.person(-1.2, 1.2, 2.4, UNIFORM.vip(this.rand), POSE.stand, true, top)
    this.top = top + 2.2
    this.popAt.set(0, top + 1.4, -0.3)
  }

  protected draw(d: Drive) {
    const top = this.storeys * STOREY
    this.deckY = approach(this.deckY, top, 5, d.dt)
    this.deck.position.set(0, this.deckY, -0.4)
    // the deck's people ride up with it
    for (let i = 0; i < this.staff.length; i++) this.staff[i].y = this.deckY + (this.staff[i].pose === POSE.sit ? 0.06 : 0)
    for (let k = 0; k < this.units.length; k++) (k === 0 ? this.ground : this.upper).put(this.place(this.units[k], d.t, _m))
  }
}

/* ---------------- the grand stage ---------------- */

const STAGE_Z = -1.2
const STAGE_D = 2.0
const STAGE_H = 0.55

/** the stage of width w: planks, gold trim and footlights, a starry backdrop, curtains and the proscenium */
function stageSet(w: number) {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(rbox(w, STAGE_H, STAGE_D, 0.05), '#7a3b2a', T([0, STAGE_H / 2, STAGE_Z]))
  k.add(rbox(w - 0.1, 0.03, STAGE_D - 0.1, 0.01), '#c98d55', T([0, STAGE_H + 0.005, STAGE_Z]), 0)
  for (let i = 1; i < 10; i++) k.add(box(0.015, 0.006, STAGE_D - 0.12), '#a06a3c', T([-w / 2 + (w * i) / 10, STAGE_H + 0.022, STAGE_Z]), 0)
  k.add(box(w + 0.02, 0.08, 0.06), GOLD, T([0, STAGE_H - 0.04, STAGE_Z + STAGE_D / 2]), 0, { shine: 1 })
  bulbs(k, along([[-w / 2 + 0.15, STAGE_H + 0.05, STAGE_Z + STAGE_D / 2 - 0.04], [w / 2 - 0.15, STAGE_H + 0.05, STAGE_Z + STAGE_D / 2 - 0.04]], Math.round(w * 3)), 0.04)
  // steps up at the front
  k.add(rbox(0.9, 0.18, 0.35, 0.03), '#7a3b2a', T([0, 0.09, STAGE_Z + STAGE_D / 2 + 0.17]))
  k.add(rbox(0.9, 0.36, 0.3, 0.03), '#7a3b2a', T([0, 0.18, STAGE_Z + STAGE_D / 2 + 0.0]))
  // the backdrop: deep purple, gold stars
  const H = 2.8
  k.add(rbox(w + 0.4, H, 0.12, 0.03), '#2a1a4a', T([0, STAGE_H + H / 2, STAGE_Z - STAGE_D / 2 + 0.06]))
  for (let i = 0; i < 9; i++) {
    const x = -w / 2 + 0.4 + ((i * 0.618) % 1) * (w - 0.8)
    const y = STAGE_H + 0.8 + ((i * 0.37) % 1) * (H - 1.2)
    k.add(slabXY(star(0, 0, 0.12 + (i % 3) * 0.05, 0.05 + (i % 3) * 0.02), 0.02), C('#ffd77a', 1.25), T([x, y, STAGE_Z - STAGE_D / 2 + 0.14]), 0, { flat: true })
  }
  // the proscenium: two red towers trimmed in gold and a beam across the top
  for (const s of [-1, 1]) {
    k.add(rbox(0.45, H + 0.7, 0.5, 0.06), '#b3213f', T([s * (w / 2 + 0.2), (H + 0.7) / 2 + 0.0, STAGE_Z + STAGE_D / 2 - 0.25]))
    k.add(rbox(0.5, 0.12, 0.56, 0.04), GOLD, T([s * (w / 2 + 0.2), H + 0.7, STAGE_Z + STAGE_D / 2 - 0.25]), 1, { shine: 1 })
    k.add(rbox(0.5, 0.12, 0.56, 0.04), GOLD, T([s * (w / 2 + 0.2), 0.06, STAGE_Z + STAGE_D / 2 - 0.25]), 1, { shine: 1 })
  }
  k.add(rbox(w + 0.9, 0.5, 0.5, 0.06), '#b3213f', T([0, H + 0.95, STAGE_Z + STAGE_D / 2 - 0.25]))
  k.add(rbox(w + 0.96, 0.08, 0.56, 0.03), GOLD, T([0, H + 1.2, STAGE_Z + STAGE_D / 2 - 0.25]), 1, { shine: 1 })
  bulbs(k, along([[-w / 2 - 0.3, H + 0.95, STAGE_Z + STAGE_D / 2 + 0.0], [w / 2 + 0.3, H + 0.95, STAGE_Z + STAGE_D / 2 + 0.0]], Math.round(w * 3.5)), 0.045)
  const mesh = k.mesh('stage')
  g.add(mesh)
  // the curtains, drawn back to each side, and a valance across the top
  for (const s of [-1, 1]) {
    const c = new THREE.Mesh(curtain(0.9, H, 4, '#d42a4a'), mesh.material)
    c.position.set(s * (w / 2 - 0.4), STAGE_H, STAGE_Z + STAGE_D / 2 - 0.45)
    g.add(c)
  }
  const v = new THREE.Mesh(curtain(w + 0.1, 0.5, Math.round(w * 2), '#d42a4a'), mesh.material)
  v.position.set(0, H + 0.15, STAGE_Z + STAGE_D / 2 - 0.45)
  g.add(v)
  // a mic stand at the front of the stage
  const mic = new TKit()
  mic.add(cyl(0.12, 0.03, 12), '#2a2238', T([0, STAGE_H, STAGE_Z + 0.55]), 0)
  mic.add(cyl(0.015, 0.9, 6), '#c9d0e0', T([0, STAGE_H, STAGE_Z + 0.55]), 0)
  mic.add(sphere(0.05, 8, 6), '#2a2238', T([0, STAGE_H + 0.93, STAGE_Z + 0.55]), 0.6)
  g.add(mic.mesh('mic'))
  return g
}

/** a spotlight on a stand at the front, its beam aimed back at the stage */
function spotlight(x: number, color: string) {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(cyl(0.22, 0.05, 12), '#2a2238', T([0, 0, 0]))
  k.add(cyl(0.035, 2.4, 6), '#3a3346', T([0, 0.05, 0]))
  g.add(k.mesh('spot-stand'))
  const head = new THREE.Group()
  head.position.set(0, 2.5, 0)
  const h = new TKit()
  h.add(cyl(0.16, 0.36, 14, 0.12), '#2a2238', T([0, -0.18, 0], [Math.PI / 2, 0, 0]))
  h.add(new THREE.CircleGeometry(0.14, 14), C(color, 1.8), T([0, 0, -0.19], [0, Math.PI, 0]), 0, { flat: true })
  head.add(h.mesh('spot-head'))
  const beam = new THREE.Mesh(new THREE.ConeGeometry(0.75, 3.6, 20, 1, true), beamMaterial().clone())
  ;(beam.material as THREE.ShaderMaterial).uniforms.uColor.value = new THREE.Color(color)
  beam.position.set(0, 0, -1.8)
  beam.rotation.x = Math.PI / 2
  beam.userData.beam = true
  head.add(beam)
  g.add(head)
  g.position.set(x, 0, 1.75)
  g.userData.head = head
  return g
}

function pyro() {
  const k = new TKit()
  for (const s of [-1, 1]) {
    k.add(cyl(0.18, 0.75, 14), '#2a2238', T([s * 1.95, 0, 0.0]))
    k.add(cyl(0.2, 0.08, 14), GOLD, T([s * 1.95, 0.72, 0.0]), 1, { shine: 1 })
  }
  const g = new THREE.Group()
  g.add(k.mesh('pyro'))
  const f = new TKit()
  f.add(new THREE.ConeGeometry(0.16, 0.7, 10), C('#ffb02e', 1.7), T([0, 0.35, 0]), 0, { flat: true })
  f.add(new THREE.ConeGeometry(0.09, 0.45, 8), C('#fff2a8', 2), T([0, 0.25, 0]), 0, { flat: true })
  const geo = f.geometry()
  for (const s of [-1, 1]) {
    const flame = new THREE.Mesh(geo, toonMaterial())
    flame.position.set(s * 1.95, 0.8, 0)
    flame.userData.flame = true
    g.add(flame)
  }
  g.position.z = STAGE_Z + STAGE_D / 2 + 0.25
  return g
}

export class GrandStage extends Attraction {
  private readonly spots: THREE.Group[]
  private readonly beams: THREE.ShaderMaterial[] = []
  private readonly flames: THREE.Object3D[] = []
  private readonly star: THREE.Object3D

  constructor(i: number) {
    super(i)
    this.minCycle = 6
    this.top = 4.5
    this.popAt.set(0, 2.6, -0.8)
    this.extra(stageSet(2.9), 0, 1)
    this.extra(stageSet(3.8), 1)
    this.spots = [spotlight(-1.85, '#ff7ad9'), spotlight(1.85, '#7ad7ff')]
    for (const s of this.spots) {
      this.extra(s, 2)
      s.traverse((o) => o.userData.beam && this.beams.push(this.keep((o as THREE.Mesh).material as THREE.ShaderMaterial)))
    }
    const p = this.extra(pyro(), ROPES_AT)
    p.traverse((o) => o.userData.flame && this.flames.push(o))
    const sign = marqueeSign('GRAND STAGE', '#ffd23f', 2.6, 0.5, 0)
    sign.position.set(0, 3.48, STAGE_Z + STAGE_D / 2 + 0.03)
    this.extra(sign, SIGN_AT)
    const k = new TKit()
    k.add(slabXY(star(0, 0, 0.55, 0.24), 0.18, 0.04), GOLD, undefined, 1, { shine: 1 })
    this.star = this.extra(k.mesh('star'), TROPHY_AT)
    this.star.position.set(0, 4.75, STAGE_Z + STAGE_D / 2 - 0.25)
  }

  protected arrange(tier: number) {
    this.person(0, STAGE_Z + 0.3, 0, UNIFORM.performer(this.rand), POSE.sing, true, STAGE_H)
    if (tier >= 2) for (const x of [-1.2, 1.2]) this.person(x, STAGE_Z - 0.1, 0, { ...UNIFORM.performer(this.rand), shirt: C('#ffd23f'), pants: C('#ffd23f') }, POSE.dance, true, STAGE_H)
    this.top = tier >= 5 ? 5.3 : 4.5
  }

  protected draw(d: Drive) {
    const e = flare(d.pay, 1.2)
    // the spotlights sweep across the stage and flare when it pays
    for (let k = 0; k < this.spots.length; k++) {
      const head = this.spots[k].userData.head as THREE.Object3D
      head.rotation.set(-0.42 + Math.sin(d.t * 0.9 + k) * 0.08, (k ? 0.45 : -0.45) + Math.sin(d.t * 0.7 + k * 2) * 0.3, 0)
      this.beams[k].uniforms.uAlpha.value = (d.on ? 0.14 : 0.08) + e * 0.3
    }
    for (let i = 0; i < this.flames.length; i++) this.flames[i].scale.set(1, Math.max(0.001, e * 1.4 + (d.boost > 0 ? 0.3 : 0)), 1)
    this.star.rotation.y = d.t * 0.8
  }
}

/* ---------------- the penthouse suites ---------------- */

const LOBBY_H = 1.4
const FLOOR_H = 1.12

function lobby(rot: number) {
  const k = new TKit()
  k.add(rbox(3.8, LOBBY_H, 3.8, 0.06), '#f6ead6', T([0, LOBBY_H / 2, 0]))
  k.add(rbox(3.9, 0.14, 3.9, 0.04), GOLD, T([0, LOBBY_H, 0]), 1, { shine: 0.8 })
  // glass fronts on the two sides the camera sees, gold doors, a red canopy on gold poles
  const side = rot === 0 ? -1 : 1
  k.add(rbox(3.1, 1.0, 0.06, 0.02), '#5aa9c8', T([0, 0.6, 1.91]), 0, { windows: true })
  k.add(rbox(0.06, 1.0, 3.1, 0.02), '#5aa9c8', T([-side * 1.91, 0.6, 0]), 0, { windows: true })
  k.add(rbox(0.9, 1.05, 0.08, 0.03), GOLD, T([0, 0.53, 1.95]), 1, { shine: 1 })
  k.add(box(0.03, 0.95, 0.09), '#8a5a1a', T([0, 0.53, 1.97]), 0)
  k.add(rbox(1.6, 0.1, 1.0, 0.04), '#c8213b', T([0, 1.22, 2.35]))
  for (const s of [-1, 1]) k.add(cyl(0.035, 1.18, 6), GOLD, T([s * 0.72, 0, 2.78]), 0.8, { shine: 1 })
  // topiaries in pots by the door
  for (const s of [-1, 1]) {
    k.add(cyl(0.2, 0.32, 12, 0.15), CREAM, T([s * 1.3, 0, 2.2]))
    k.add(sphere(0.3, 12, 10), '#3fae5a', T([s * 1.3, 0.6, 2.2]))
    k.add(sphere(0.2, 10, 8), '#4fc46a', T([s * 1.3, 0.98, 2.2]))
  }
  return k.mesh('lobby')
}

function suiteFloor(rot: number) {
  const k = new TKit()
  k.add(rbox(3.4, FLOOR_H - 0.1, 3.4, 0.05), '#f1e4cf', T([0, (FLOOR_H - 0.1) / 2, 0]), 1, { windows: true })
  k.add(rbox(3.56, 0.1, 3.56, 0.03), CREAM, T([0, FLOOR_H - 0.05, 0]))
  // balconies on the two sides the camera sees: a slab and a gold rail
  const side = rot === 0 ? -1 : 1
  k.add(rbox(2.0, 0.08, 0.45, 0.03), CREAM, T([0, 0.04, 1.9]))
  k.add(rbox(2.0, 0.05, 0.05, 0.02), GOLD, T([0, 0.42, 2.1]), 0.6, { shine: 0.6 })
  k.add(rbox(0.45, 0.08, 2.0, 0.03), CREAM, T([-side * 1.9, 0.04, 0]))
  k.add(rbox(0.05, 0.05, 2.0, 0.02), GOLD, T([-side * 2.1, 0.42, 0]), 0.6, { shine: 0.6 })
  for (let i = 0; i < 5; i++) {
    k.add(cyl(0.015, 0.38, 4), GOLD_D, T([-0.9 + i * 0.45, 0.06, 2.1]), 0)
    k.add(cyl(0.015, 0.38, 4), GOLD_D, T([-side * 2.1, 0.06, -0.9 + i * 0.45]), 0)
  }
  return k.geometry()
}

function crown() {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(rbox(2.8, 0.7, 2.8, 0.06), '#f6ead6', T([0, 0.35, 0]))
  k.add(rbox(2.92, 0.12, 2.92, 0.04), GOLD, T([0, 0.72, 0]), 1, { shine: 1 })
  k.add(rbox(1.8, 0.5, 1.8, 0.05), GOLD, T([0, 1.0, 0]), 1, { shine: 1 })
  k.add(new THREE.ConeGeometry(0.55, 1.2, 4), GOLD, T([0, 1.85, 0], [0, Math.PI / 4, 0]), 1, { shine: 1 })
  k.add(cyl(0.03, 0.6, 6), GOLD_D, T([0, 2.4, 0]), 0)
  bulbs(k, along([[-1.4, 0.74, 1.42], [1.4, 0.74, 1.42], [1.42, 0.74, -1.4]], 18), 0.04)
  g.add(k.mesh('crown'))
  const b = new TKit()
  b.add(sphere(0.1, 10, 8), C('#ff4f4f', 1.8), undefined, 0.6, { flat: true })
  const beacon = b.mesh('beacon')
  beacon.position.y = 3.05
  g.add(beacon)
  g.userData.beacon = beacon
  return g
}

export class PenthouseSuites extends Attraction {
  private readonly floors = this.batch(suiteFloor(this.root.rotation.y), 10, undefined, 'suite-floor')
  private readonly crown: THREE.Group
  private crownY = LOBBY_H
  private wave = 9
  private readonly floorTint = new THREE.Color()

  constructor(i: number) {
    super(i)
    this.minCycle = 7
    this.extra(lobby(this.root.rotation.y), 0)
    this.crown = crown()
    this.root.add(this.crown)
    const sign = marqueeSign('SUITES', '#ffd23f', 1.9, 0.55, 0)
    sign.position.set(0, 0.95, 0)
    sign.rotation.y = this.toCamera
    sign.translateZ(1.5)
    this.crown.add(this.extra(sign, SIGN_AT))
    const k = new TKit()
    k.add(slabXY(star(0, 0, 0.42, 0.18), 0.14, 0.03), GOLD, undefined, 1, { shine: 1 })
    const top = this.extra(k.mesh('crown-star'), TROPHY_AT)
    top.position.y = 3.35
    this.crown.add(top)
    this.extra(velvetRopes(1.8), ROPES_AT)
  }

  protected arrange(tier: number) {
    const n = [2, 3, 4, 6, 8, 10][tier]
    for (let k = 0; k < n; k++) this.unit(0, 0, 0, LOBBY_H + k * FLOOR_H)
    // a doorman under the canopy
    this.person(0.72, 2.45, 0, UNIFORM.dealer(this.rand), POSE.stand, true)
    const top = LOBBY_H + n * FLOOR_H
    this.top = top + 3.2
    this.popAt.set(0, top + 2.2, 0)
  }

  protected draw(d: Drive) {
    const n = this.units.length
    const top = LOBBY_H + n * FLOOR_H
    this.crownY = this.crownY + (top - this.crownY) * Math.min(1, d.dt * 4)
    this.crown.position.y = this.crownY
    // a wave of light runs up the tower when it pays
    if (d.pay < 0.05) this.wave = 0
    this.wave += d.dt
    for (let k = 0; k < n; k++) {
      const u = this.units[k]
      const w = Math.max(0, 1 - Math.abs(this.wave * 9 - k) / 1.5)
      this.floorTint.setScalar(1 + w * 0.45)
      if (k % 2) this.floorTint.multiply(_c.set(0.94, 0.97, 1.04))
      this.floors.put(this.place(u, d.t, _m), this.floorTint)
    }
    const beacon = this.crown.userData.beacon as THREE.Object3D
    beacon.scale.setScalar(0.6 + 0.5 * Math.max(0, Math.sin(d.t * 3)) + (d.pay < 0.6 ? 0.6 : 0))
    // a new crown position pops with the floors under it
    this.crown.scale.setScalar(Math.max(0.001, popScale(d.t - this.built)))
  }
}
