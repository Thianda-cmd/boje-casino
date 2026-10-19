import * as THREE from 'three'
import { ATTRACTIONS, fmtCash } from './engine'
import { CREAM, GOLD, GOLD_D, chipStack, flatRing, forSaleSign, popScale } from './attraction'
import { EDGE_H, FOUNTAIN, FOYER, HALF, LANE, PAD_H, PLOT, PLOTS, VAULT_R } from './layout'
import { Batch, C, T, TAU, TKit, along, box, bulbs, canvasTexture, cyl, fitText, glassMaterial, lathe, rbox, rng, roundRectPath, rrect, sphere, textPlane, tube, type P3, type Rand } from './models'

/*
  The casino floor itself: everything that stands still or nearly so.

  - The plinth: the floor is a thick slab with a carpet on top (its own shader: a gold diamond lattice with little
    stars over the city's carpet colour, a marble medallion round the vault and a red runner in from the entrance)
    and cream sides with a gold band; a chasing row of bulbs runs along its two front edges, a balustrade with lamps
    along the two back ones.
  - The ten plot pads; on a plot not yet bought, a velvet rope round it and a For sale sign with the attraction's name
    and price (it bounces when the player can afford it).
  - The plaza: the Coin Vault on its dais in the middle (a big steel safe with a round gold door: a ring of lamps
    round the door lights up as the vault fills, gold piles up round its base, it bounces and glows when full), lamp
    posts and potted palms.
  - The entrance arch at the front corner with its BOJE CASINO marquee, and the fountain garden at the back.
  - Soft blob shadows (Splats) under everything, and glowing halos round the lamps at night (Halos).

  buildFloor() returns a FloorSet: the scene adds its root, sets the city's colours (setLook), shows which plots are
  for sale and affordable (setPlots), the vault's fill (setVault), the selected plot (select), and ticks it.
*/

export interface FloorLook {
  /** the carpet's ground, its lattice and its stars */
  carpet: string
  lattice: string
  accent: string
  /** the plinth's sides and the light falling on the carpet */
  plinth: string
  light: THREE.Color
}

/* ---------------- the carpet ---------------- */

const CARPET_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vP = w.xz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`

const CARPET_FRAG = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLattice;
uniform vec3 uAccent;
uniform vec3 uLight;
uniform float uHalf;
uniform float uTime;
varying vec2 vP;
float aa(float d, float w) { float f = fwidth(d); return 1.0 - smoothstep(w - f, w + f, d); }
void main() {
  vec2 p = vP;
  vec3 col = uBase;
  // a soft tonal weave so the carpet isn't flat
  col *= 0.96 + 0.04 * sin(p.x * 3.1) * sin(p.y * 2.7);
  // the lattice: thin gold lines on the diagonals, a four-point star in each diamond
  vec2 q = vec2(p.x + p.y, p.x - p.y) * 0.7071;
  vec2 cell = fract(q / 1.6) - 0.5;
  vec2 g = abs(cell);
  float line = aa(min(0.5 - g.x, 0.5 - g.y), 0.025);
  col = mix(col, uLattice, line * 0.85);
  float st = abs(cell.x) + abs(cell.y) * 3.0;
  float st2 = abs(cell.y) + abs(cell.x) * 3.0;
  col = mix(col, uAccent, aa(min(st, st2), 0.13) * 0.9);
  // a dark border with a gold line round the edge of the floor
  float edge = uHalf - max(abs(p.x), abs(p.y));
  col = mix(col, uBase * 0.55, aa(edge, 0.55));
  col = mix(col, uLattice, aa(abs(edge - 0.68), 0.06));
  // the marble medallion round the vault: cream rings and a gold compass star
  float r = length(p);
  float ang = atan(p.y, p.x);
  vec3 marble = vec3(0.96, 0.92, 0.84) * (0.97 + 0.03 * sin(p.x * 1.7 + p.y * 2.3));
  float inside = aa(r, 5.2);
  col = mix(col, marble, inside);
  col = mix(col, vec3(0.86, 0.62, 0.2), aa(abs(r - 4.98), 0.11));
  col = mix(col, vec3(0.86, 0.62, 0.2), aa(abs(r - 3.15), 0.06) * inside);
  float star = r * (0.62 + 0.38 * abs(cos(ang * 4.0)));
  col = mix(col, vec3(0.93, 0.78, 0.45), aa(star, 4.6) * (1.0 - aa(r, 3.25)) * 0.55);
  // the red runner in from the entrance, edged in gold
  float off = abs(p.x - p.y) * 0.7071;
  float along = (p.x + p.y) * 0.7071;
  float run = aa(off, 1.05) * step(5.1, along);
  col = mix(col, vec3(0.72, 0.09, 0.16), run);
  col = mix(col, vec3(0.95, 0.72, 0.25), aa(abs(off - 0.95), 0.06) * step(5.1, along));
  gl_FragColor = vec4(col * uLight, 1.0);
  #include <colorspace_fragment>
}`

function carpet() {
  const g = new THREE.PlaneGeometry(HALF * 2, HALF * 2)
  g.rotateX(-Math.PI / 2)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color() },
      uLattice: { value: new THREE.Color() },
      uAccent: { value: new THREE.Color() },
      uLight: { value: new THREE.Color(1, 1, 1) },
      uHalf: { value: HALF },
      uTime: { value: 0 },
    },
    vertexShader: CARPET_VERT,
    fragmentShader: CARPET_FRAG,
  })
  const m = new THREE.Mesh(g, mat)
  m.name = 'carpet'
  return m
}

/* ---------------- the plinth, its bulbs and the balustrade ---------------- */

function plinth() {
  const k = new TKit()
  k.add(rbox(HALF * 2, EDGE_H, HALF * 2, 0.12), '#ffffff', T([0, -EDGE_H / 2 - 0.004, 0]))
  k.add(box(HALF * 2 + 0.04, 0.14, HALF * 2 + 0.04), GOLD, T([0, -0.16, 0]), 0, { shine: 0.5 })
  k.add(box(HALF * 2 + 0.04, 0.08, HALF * 2 + 0.04), GOLD_D, T([0, -EDGE_H + 0.1, 0]), 0)
  return k.mesh('plinth')
}

/** bulbs along the two front edges (the +x and +z sides) */
function frontBulbs() {
  const k = new TKit()
  const h = -0.6
  const e = HALF + 0.04
  bulbs(k, along([[e, h, -e + 0.4], [e, h, e - 0.15]], 30), 0.12)
  bulbs(k, along([[e - 0.15, h, e], [-e + 0.4, h, e]], 30), 0.12, undefined, 0.5)
  return k
}

/** the balustrade along the back edges with lamp posts, and potted palms at the corners */
function backEdge(k: TKit, lamps: THREE.Vector3[]) {
  const e = HALF - 0.25
  const H = 0.62
  for (const [ax, az, bx, bz] of [
    [-e, e - 0.6, -e, -e],
    [-e, -e, e - 0.6, -e],
  ]) {
    const len = Math.hypot(bx - ax, bz - az)
    const along2 = ax === bx
    k.add(rbox(along2 ? 0.34 : len, 0.12, along2 ? len : 0.34, 0.04), CREAM, T([(ax + bx) / 2, 0.06, (az + bz) / 2]))
    k.add(rbox(along2 ? 0.38 : len, 0.1, along2 ? len : 0.38, 0.04), CREAM, T([(ax + bx) / 2, H, (az + bz) / 2]))
    const n = Math.round(len / 0.42)
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const x = ax + (bx - ax) * t
      const z = az + (bz - az) * t
      if (i % 8 === 0) {
        k.add(rbox(0.36, H + 0.12, 0.36, 0.05), CREAM, T([x, (H + 0.12) / 2, z]))
        k.add(rbox(0.42, 0.08, 0.42, 0.03), GOLD, T([x, H + 0.14, z]), 1, { shine: 0.6 })
      } else k.add(cyl(0.075, 0.5, 6, 0.1), CREAM, T([x, 0.1, z]), 0.6)
    }
    // lamp posts along it
    for (let i = 1; i < 6; i++) {
      const t = i / 6
      const x = ax + (bx - ax) * t + (along2 ? 0.45 : 0)
      const z = az + (bz - az) * t + (along2 ? 0 : 0.45)
      lampPost(k, x, z, 2.2)
      lamps.push(new THREE.Vector3(x, 2.25, z))
    }
  }
}

function lampPost(k: TKit, x: number, z: number, h: number) {
  k.add(cyl(0.16, 0.12, 10), '#2a2238', T([x, 0, z]))
  k.add(cyl(0.045, h, 8), '#2a2238', T([x, 0.1, z]))
  k.add(sphere(0.2, 12, 10), C('#fff1c8', 1.05), T([x, h + 0.1, z]), 1, { lamp: true })
  k.add(cyl(0.12, 0.06, 10), GOLD, T([x, h - 0.08, z]), 0.6, { shine: 1 })
}

/** a potted palm standing at (x, y, z), s times its size */
export function palm(k: TKit, x: number, z: number, s: number, R: Rand, y = 0) {
  k.push(T([x, y, z], [0, R() * TAU, 0], s))
  k.add(cyl(0.34, 0.5, 12, 0.26), CREAM, T([0, 0, 0]))
  k.add(cyl(0.36, 0.06, 12), GOLD, T([0, 0.48, 0]), 0.6, { shine: 0.6 })
  k.add(cyl(0.3, 0.04, 12), '#5a3a22', T([0, 0.47, 0]), 0)
  const lean = (R() - 0.5) * 0.3
  const pts: P3[] = Array.from({ length: 6 }, (_, i) => [lean * i * i * 0.04, 0.5 + i * 0.36, 0])
  k.add(tube(pts, 0.085, 10, 7), '#a9773f')
  for (let i = 0; i < 5; i++) {
    const p = pts[Math.min(5, i + 1)]
    k.add(new THREE.TorusGeometry(0.09, 0.022, 4, 10), '#8a5a2c', T([p[0], p[1] - 0.12, 0], [Math.PI / 2, 0, 0]), 0)
  }
  const top = pts[5]
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU
    const leaf: P3[] = [
      [top[0], top[1], top[2]],
      [top[0] + Math.cos(a) * 0.45, top[1] + 0.22, top[2] + Math.sin(a) * 0.45],
      [top[0] + Math.cos(a) * 0.9, top[1] - 0.12, top[2] + Math.sin(a) * 0.9],
      [top[0] + Math.cos(a) * 1.15, top[1] - 0.5, top[2] + Math.sin(a) * 1.15],
    ]
    k.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(leaf.map((p) => new THREE.Vector3(...p))), 8, 0.11, 3), i % 2 ? '#3fae5a' : '#52c46a', T([0, 0, 0], [0, 0, 0], [1, 0.55, 1]))
  }
  k.add(sphere(0.09, 8, 6), '#8a5a2c', T([top[0] + 0.08, top[1] - 0.1, 0.05]), 0.6)
  k.pop()
}

function topiary(k: TKit, x: number, z: number) {
  k.add(cyl(0.26, 0.34, 12, 0.2), CREAM, T([x, 0, z]))
  k.add(sphere(0.34, 12, 10), '#3fae5a', T([x, 0.62, z]))
  for (let i = 0; i < 4; i++) k.add(sphere(0.05, 6, 4), ['#ff6f9a', '#ffd23f', '#ffffff', '#ff8d3b'][i], T([x + Math.cos(i * 1.7) * 0.28, 0.72 + (i % 2) * 0.1, z + Math.sin(i * 1.7) * 0.28]), 0)
}

/* ---------------- the entrance and the fountain ---------------- */

function entrance(lamps: THREE.Vector3[]) {
  const g = new THREE.Group()
  const k = new TKit()
  const W = 3.5
  const H = 3.0
  for (const s of [-1, 1]) {
    k.add(rbox(0.86, 0.3, 0.86, 0.05), CREAM, T([s * W / 2, 0.15, 0]))
    k.add(cyl(0.3, H, 16), CREAM, T([s * W / 2, 0.3, 0]))
    for (let i = 0; i < 8; i++) k.add(box(0.03, H - 0.2, 0.03), '#e4d4b8', T([s * W / 2 + Math.cos((i / 8) * TAU) * 0.3, 0.3 + H / 2, Math.sin((i / 8) * TAU) * 0.3]), 0)
    k.add(rbox(0.8, 0.22, 0.8, 0.05), GOLD, T([s * W / 2, H + 0.4, 0]), 1, { shine: 1 })
  }
  // the marquee: a deep board with a gold frame, ringed with bulbs, a star on top
  k.add(rbox(W + 1.2, 1.25, 0.3, 0.12), '#2a1d4a', T([0, H + 1.15, 0]))
  k.add(rbox(W + 1.36, 0.12, 0.38, 0.05), GOLD, T([0, H + 1.8, 0]), 1, { shine: 1 })
  k.add(rbox(W + 1.36, 0.12, 0.38, 0.05), GOLD, T([0, H + 0.52, 0]), 1, { shine: 1 })
  const bw = (W + 1.0) / 2
  bulbs(k, along([[-bw, H + 0.65, 0.17], [bw, H + 0.65, 0.17], [bw, H + 1.65, 0.17], [-bw, H + 1.65, 0.17], [-bw, H + 0.65, 0.17]], 40), 0.05)
  const pts = Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? 0.2 : 0.46
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r)
  })
  const starG = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: 0.14, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 1 })
  k.add(starG, GOLD, T([0, H + 2.35, -0.07]), 1, { shine: 1 })
  const mesh = k.mesh('entrance')
  g.add(mesh)
  const txt = textPlane(W + 0.75, 0.85, 1024, (c, cw, ch) => {
    const grad = c.createLinearGradient(0, ch * 0.2, 0, ch * 0.8)
    grad.addColorStop(0, '#fff6c8')
    grad.addColorStop(0.5, '#ffd23f')
    grad.addColorStop(1, '#ff9a1f')
    c.shadowColor = 'rgba(255, 180, 40, 0.9)'
    c.shadowBlur = ch * 0.12
    c.fillStyle = grad
    fitText(c, 'BOJE CASINO', cw / 2, ch * 0.55, ch * 0.72, cw * 0.94, 800, 0.08)
  }, 1.5)
  txt.userData.text = true
  txt.position.set(0, H + 1.15, 0.16)
  g.add(txt)
  g.position.set(FOYER.x + 1.6, 0, FOYER.z + 1.6)
  g.rotation.y = Math.PI / 4
  lamps.push(new THREE.Vector3(FOYER.x + 1.6, H + 1.2, FOYER.z + 1.6))
  return g
}

function fountain(k: TKit) {
  const { x, z } = FOUNTAIN
  // hedges round the garden, flower beds, a round basin with a gold rim
  for (const [hx, hz, w, d] of [
    [x - 2.1, z, 0.5, 4.2],
    [x + 2.1, z - 1.4, 0.5, 1.4],
    [x, z - 2.1, 4.2, 0.5],
  ] as const) {
    k.add(rbox(w, 0.55, d, 0.2), '#3f9e52', T([hx, 0.28, hz]))
    for (let i = 0; i < Math.round((w + d) * 2); i++) k.add(sphere(0.06, 6, 4), ['#ff6f9a', '#ffd23f', '#ffffff'][i % 3], T([hx + (((i * 0.37) % 1) - 0.5) * w * 0.9, 0.56, hz + (((i * 0.61) % 1) - 0.5) * d * 0.9]), 0)
  }
  k.add(cyl(1.75, 0.5, 32), CREAM, T([x, 0, z]))
  k.add(new THREE.TorusGeometry(1.75, 0.1, 8, 40), GOLD, T([x, 0.5, z], [Math.PI / 2, 0, 0]), 1, { shine: 0.8 })
  k.add(cyl(1.62, 0.02, 32), '#5ec8e8', T([x, 0.42, z]), 0)
  for (const r of [0.8, 1.25]) k.add(new THREE.RingGeometry(r, r + 0.05, 32), '#bff0ff', T([x, 0.445, z], [-Math.PI / 2, 0, 0]), 0, { flat: true })
  // a pedestal holding a big gold coin
  k.add(lathe([[0.5, 0], [0.42, 0.2], [0.22, 0.4], [0.18, 1.0], [0.4, 1.12], [0.36, 1.2], [0.0, 1.2]], 18), CREAM, T([x, 0.42, z]))
  k.add(cyl(0.62, 0.16, 28), GOLD, T([x, 2.35, z], [Math.PI / 2, Math.PI / 4, 0]), 1, { shine: 1 })
  k.add(cyl(0.42, 0.18, 24), C('#ffe596'), T([x, 2.35, z], [Math.PI / 2, Math.PI / 4, 0]), 0, { shine: 1 })
}

/** the fountain's water: a bell of falling water round the coin's pedestal (see-through) */
function waterBell() {
  const g = lathe([[0.15, 0.95], [0.6, 0.85], [1.1, 0.45], [1.3, 0.0]], 24)
  g.translate(FOUNTAIN.x, 0.42 + 0.9, FOUNTAIN.z)
  const m = new THREE.Mesh(g, glassMaterial())
  m.renderOrder = 2
  return m
}

/* ---------------- the coin vault ---------------- */

/** the safe is modelled small and drawn this much bigger; its gold mound lies to one side of the door */
const SAFE_S = 1.22
const MOUND_A = Math.PI / 4 + 0.8
const STEEL = '#647aa3'
const STEEL_D = '#465a80'
const VAULT_LAMPS = 14

export interface VaultRig {
  root: THREE.Group
  safe: THREE.Group
  wheel: THREE.Object3D
  lamps: Batch
  stacks: Batch
  mound: THREE.Object3D
}

function vault(): VaultRig {
  const root = new THREE.Group()
  root.name = 'vault'
  const k = new TKit()
  k.add(cyl(VAULT_R, 0.14, 40), CREAM, T([0, 0, 0]))
  k.add(cyl(VAULT_R + 0.04, 0.05, 40, VAULT_R + 0.04, true), GOLD, T([0, 0.1, 0]), 0, { shine: 0.6 })
  k.add(cyl(VAULT_R - 0.5, 0.14, 40), CREAM, T([0, 0.14, 0]))
  k.add(cyl(VAULT_R - 0.46, 0.05, 40, VAULT_R - 0.46, true), GOLD, T([0, 0.24, 0]), 0, { shine: 0.6 })
  root.add(k.mesh('dais'))
  // the safe: a chunky steel box turned to face the camera, a gold sign on top (safe bounces, body is its size)
  const safe = new THREE.Group()
  safe.position.y = 0.28
  safe.rotation.y = Math.PI / 4
  const body = new THREE.Group()
  body.scale.setScalar(SAFE_S)
  safe.add(body)
  const s = new TKit()
  s.add(rbox(2.3, 2.1, 1.7, 0.16), STEEL, T([0, 1.05, -0.1]))
  s.add(rbox(2.42, 0.16, 1.82, 0.06), STEEL_D, T([0, 0.08, -0.1]))
  s.add(rbox(2.42, 0.16, 1.82, 0.06), STEEL_D, T([0, 2.06, -0.1]))
  for (const sx of [-1, 1]) for (const sy of [0.35, 1.75]) s.add(sphere(0.06, 8, 6), '#c9d0e0', T([sx * 0.98, sy, 0.76]), 0)
  // the round door: a gold rim, a ring of bolts and the hinge
  s.add(cyl(0.86, 0.12, 36), GOLD, T([0, 1.08, 0.74], [Math.PI / 2, 0, 0]), 1, { shine: 1 })
  s.add(cyl(0.72, 0.16, 36), '#8b9cc0', T([0, 1.08, 0.76], [Math.PI / 2, 0, 0]))
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    s.add(cyl(0.05, 0.05, 8), GOLD_D, T([Math.cos(a) * 0.6, 1.08 + Math.sin(a) * 0.6, 0.92], [Math.PI / 2, 0, 0]), 0)
  }
  s.add(rbox(0.18, 0.7, 0.14, 0.05), GOLD_D, T([-0.92, 1.08, 0.74]))
  body.add(s.mesh('safe'))
  // the spoked wheel that opens it
  const w = new TKit()
  w.add(new THREE.TorusGeometry(0.32, 0.045, 8, 28), GOLD, undefined, 1, { shine: 1 })
  for (let i = 0; i < 3; i++) w.add(new THREE.CapsuleGeometry(0.03, 0.62, 2, 6), GOLD, T([0, 0, 0], [0, 0, (i / 3) * Math.PI]), 0.7, { shine: 1 })
  w.add(cyl(0.1, 0.14, 14), GOLD_D, T([0, 0, -0.04], [Math.PI / 2, 0, 0]), 1)
  const wheel = w.mesh('vault-wheel')
  wheel.position.set(0, 1.08, 0.98)
  body.add(wheel)
  // the fill lamps round the door
  const lampK = new TKit()
  lampK.add(sphere(0.075, 10, 8), '#ffffff', undefined, 0.7, { flat: true })
  const lamps = new Batch(lampK.geometry(), VAULT_LAMPS, undefined, 'vault-lamps')
  body.add(lamps.mesh)
  // the sign on top
  const sign = textPlane(2.2, 0.55, 512, (c, cw, ch) => {
    c.fillStyle = '#2a1d4a'
    roundRectPath(c, 4, 4, cw - 8, ch - 8, ch * 0.3)
    c.fill()
    c.strokeStyle = '#ffc53a'
    c.lineWidth = ch * 0.07
    c.stroke()
    c.fillStyle = '#ffd23f'
    fitText(c, 'COIN VAULT', cw / 2, ch * 0.54, ch * 0.5, cw * 0.84, 800, 0.08)
  }, 1.25)
  sign.userData.text = true
  sign.position.set(0, 2.5, 0.1)
  body.add(sign)
  root.add(safe)
  // the gold: a mound in front and stacks round the base, shown by the fill
  // a heap of coins: rings of them, each smaller and higher, at a tumble of angles over a gold core
  const m = new TKit()
  m.add(sphere(1, 14, 8), GOLD_D, T([0, -0.05, 0], [0, 0, 0], [0.62, 0.34, 0.5]), 0)
  const R = rng(9)
  for (const [r, y, n] of [
    [0.6, 0.02, 11],
    [0.44, 0.15, 8],
    [0.27, 0.27, 6],
    [0.08, 0.36, 2],
  ]) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + R()
      m.add(cyl(0.12, 0.035, 12), i % 3 ? GOLD : C('#ffe08a'), T([Math.cos(a) * r, y + R() * 0.04, Math.sin(a) * r * 0.85], [(R() - 0.5) * 1.2, R() * 3, (R() - 0.5) * 1.2]), 0.6, { shine: 1 })
    }
  }
  const mound = m.mesh('vault-gold')
  mound.position.set(Math.cos(MOUND_A) * 1.95, 0.28, Math.sin(MOUND_A) * 1.95)
  mound.rotation.y = -MOUND_A
  root.add(mound)
  const st = new TKit()
  chipStack(st, 0, 0, 0, 6, GOLD, 0.11)
  const stacks = new Batch(st.geometry(), 16, undefined, 'vault-stacks')
  root.add(stacks.mesh)
  return { root, safe, wheel, lamps, stacks, mound }
}

/* ---------------- shadows and halos ---------------- */

let shadowTex: THREE.CanvasTexture | null = null
function shadowTexture() {
  return (shadowTex ??= canvasTexture(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    grad.addColorStop(0, 'rgba(0,0,0,1)')
    grad.addColorStop(0.55, 'rgba(0,0,0,0.6)')
    grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, 128, 128)
  }))
}

const _sm = new THREE.Matrix4()
const _sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const _sp = new THREE.Vector3()
const _ss = new THREE.Vector3()

/** soft round shadows on the floor: begin(), put(x, y, z, rx, rz), end() */
export class Splats {
  readonly mesh: THREE.InstancedMesh
  private n = 0
  constructor(readonly cap: number, opacity = 0.32) {
    const g = new THREE.PlaneGeometry(1, 1)
    const mat = new THREE.MeshBasicMaterial({ map: shadowTexture(), color: '#1a0e30', transparent: true, opacity, depthWrite: false })
    this.mesh = new THREE.InstancedMesh(g, mat, cap)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.count = 0
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 1
  }
  begin() {
    this.n = 0
  }
  put(x: number, y: number, z: number, rx: number, rz = rx) {
    if (this.n >= this.cap) return
    this.mesh.setMatrixAt(this.n++, _sm.compose(_sp.set(x, y, z), _sq, _ss.set(rx * 2, rz * 2, 1)))
  }
  end() {
    this.mesh.count = this.n
    this.mesh.instanceMatrix.needsUpdate = true
  }
  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

/** glowing halos (additive points `size` world units across), for lamps at night; set uScale to px per unit */
export function halos(points: THREE.Vector3[], size: number, color: THREE.ColorRepresentation) {
  const g = new THREE.BufferGeometry().setFromPoints(points)
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 20 }, uSize: { value: size }, uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, map: { value: shadowTexture() } },
    vertexShader: 'uniform float uScale; uniform float uSize; void main() { gl_PointSize = uSize * uScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 uColor; uniform float uAlpha; uniform sampler2D map; void main() { float a = texture2D(map, gl_PointCoord).a; gl_FragColor = vec4(uColor * a * a * uAlpha, 1.0); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const p = new THREE.Points(g, mat)
  p.frustumCulled = false
  p.renderOrder = 8
  return p
}

/* ---------------- the set ---------------- */

/** how long a sold sign takes to leap away (s) */
const SOLD_S = 0.5

export interface FloorSet {
  root: THREE.Group
  vault: VaultRig
  /** the lamps' night halos (the scene sets uScale and uAlpha) */
  halos: THREE.Points
  /** static shadows under the decor */
  shadows: Splats
  setLook(l: FloorLook): void
  /** which plots are for sale (owned = 0), and which of those the player can afford */
  setPlots(owned: readonly number[], afford: readonly boolean[] | undefined, t: number): void
  /** the plot to ring (-1 for none) */
  select(i: number): void
  /** the vault's fill 0..1 */
  setVault(fill: number, t: number): void
  tick(t: number, dt: number): void
  dispose(): void
}

export function buildFloor(): FloorSet {
  const root = new THREE.Group()
  root.name = 'floor'
  const R = rng(42)
  const top = carpet()
  root.add(top)
  const plinthMesh = plinth()
  root.add(plinthMesh)
  const lamps: THREE.Vector3[] = []
  // the decor, merged into one mesh
  const k = frontBulbs()
  backEdge(k, lamps)
  const shadowSpots: [number, number, number][] = []
  // palms at the plaza's corners (not the front one, where the runner comes in) and the floor's side corners
  for (const [x, z, sc] of [
    [-4.45, -4.45, 1.05],
    [4.45, -4.45, 1.05],
    [-4.45, 4.45, 1.05],
    [-HALF + 0.9, HALF - 0.9, 1.25],
    [HALF - 0.9, -HALF + 0.9, 1.25],
  ]) {
    palm(k, x, z, sc, R)
    shadowSpots.push([x, z, 0.75])
  }
  // lamp posts round the vault
  for (const [x, z] of [
    [4.9, 0],
    [-4.9, 0],
    [0, 4.9],
    [0, -4.9],
  ]) {
    lampPost(k, x, z, 2.3)
    lamps.push(new THREE.Vector3(x, 2.35, z))
    shadowSpots.push([x, z, 0.35])
  }
  // little topiaries where the corridors meet the front edges
  for (const c of [-LANE, 0]) {
    topiary(k, HALF - 0.5, c)
    topiary(k, c, HALF - 0.5)
  }
  fountain(k)
  shadowSpots.push([FOUNTAIN.x, FOUNTAIN.z, 2.1])
  const decor = k.mesh('decor')
  root.add(decor)
  root.add(waterBell())
  root.add(entrance(lamps))

  // the plot pads, the ropes round plots for sale and their signs
  const padK = new TKit()
  padK.add(rbox(PLOT, PAD_H, PLOT, 0.12), '#efe2c8', T([0, PAD_H / 2, 0]))
  padK.add(flatRing(rrect(0, 0, PLOT - 0.2, PLOT - 0.2, 0.3, 5), rrect(0, 0, PLOT - 0.34, PLOT - 0.34, 0.24, 5), PAD_H + 0.004), GOLD, undefined, 0, { shine: 0.4 })
  const pads = new Batch(padK.geometry(), PLOTS.length, undefined, 'pads')
  // an open plot's pad takes a soft tint of its attraction's colours; one for sale is grey
  const PAD_TINT = ['#ffd6e8', '#ffd2cc', '#d2f2dc', '#cdeeed', '#fff0c4', '#e2dcff', '#ead8ff', '#cdf2ee', '#ffe0cc', '#fff4e0'].map((c) => C(c))
  const SALE_TINT = C('#cfcad8')
  root.add(pads.mesh)
  const ropeK = new TKit()
  // (low-poly: ten of these can be on show)
  const e = PLOT / 2 - 0.2
  const corners: [number, number][] = [
    [-e, -e],
    [e, -e],
    [e, e],
    [-e, e],
  ]
  for (const [x, z] of corners) {
    ropeK.add(cyl(0.1, 0.04, 8), GOLD_D, T([x, 0, z]))
    ropeK.add(cyl(0.028, 0.6, 5), GOLD, T([x, 0.03, z]), 1, { shine: 1 })
    ropeK.add(sphere(0.05, 6, 4), GOLD, T([x, 0.66, z]), 1, { shine: 1 })
  }
  for (let i = 0; i < 4; i++) {
    const [ax, az] = corners[i]
    const [bx, bz] = corners[(i + 1) % 4]
    ropeK.add(tube([[ax, 0.58, az], [(ax + bx) / 2, 0.4, (az + bz) / 2], [bx, 0.58, bz]], 0.026, 8, 5), '#c41d3c')
  }
  const ropes = new Batch(ropeK.geometry(), PLOTS.length, undefined, 'sale-ropes')
  root.add(ropes.mesh)
  const signs = PLOTS.map((p, i) => {
    const s = forSaleSign(ATTRACTIONS[i].name, fmtCash(ATTRACTIONS[i].cost))
    s.position.set(p.x, PAD_H, p.z)
    s.rotation.y = Math.PI / 4
    s.visible = false
    root.add(s)
    return s
  })
  const forSale = new Array<boolean>(PLOTS.length).fill(false)
  const affordable = new Array<boolean>(PLOTS.length).fill(false)
  /** signs more than a step past the next plot to open stand smaller: a new floor isn't a forest of boards */
  const far = new Array<boolean>(PLOTS.length).fill(false)
  const shown = new Float32Array(PLOTS.length).fill(-1)
  /** when each plot was bought: its sign leaps up and away */
  const sold = new Float32Array(PLOTS.length).fill(-9)

  // the selection ring
  const ringMat = new THREE.MeshBasicMaterial({ color: C('#ffd23f', 1.6), transparent: true, depthWrite: false })
  const ring = new THREE.Mesh(flatRing(rrect(0, 0, PLOT + 0.5, PLOT + 0.5, 0.5, 6), rrect(0, 0, PLOT + 0.18, PLOT + 0.18, 0.38, 6), 0), ringMat)
  ring.position.y = PAD_H + 0.02
  ring.renderOrder = 3
  ring.visible = false
  root.add(ring)
  let selected = -1

  const v = vault()
  root.add(v.root)
  let fill = 0
  let fillShown = 0
  let full = false
  const _m = new THREE.Matrix4()
  const _c = new THREE.Color()
  const LIT = C('#ffd23f', 1.6)
  const DIM = C('#3a3150')

  const halo = halos(lamps, 2.6, '#ffc870')
  root.add(halo)
  const shadows = new Splats(48, 0.28)
  shadows.begin()
  for (const [x, z, r] of shadowSpots) shadows.put(x, 0.012, z, r)
  shadows.put(0, 0.012, 0, VAULT_R + 0.3)
  shadows.end()
  root.add(shadows.mesh)

  const lookPlinth = new THREE.Color()

  return {
    root,
    vault: v,
    halos: halo,
    shadows,
    setLook(l) {
      const u = (top.material as THREE.ShaderMaterial).uniforms
      u.uBase.value.set(l.carpet)
      u.uLattice.value.set(l.lattice)
      u.uAccent.value.set(l.accent)
      u.uLight.value.copy(l.light)
      // the plinth is white in its geometry: its colour comes from the city
      lookPlinth.set(l.plinth)
      const col = plinthMesh.geometry.getAttribute('color') as THREE.BufferAttribute
      const base = plinthMesh.userData.base as Float32Array | undefined
      const src = base ?? (plinthMesh.userData.base = Float32Array.from(col.array as Float32Array))
      const arr = col.array as Float32Array
      for (let i = 0; i < arr.length; i += 3) {
        // only the white body takes the colour; the gold band, the dark foot and the ink keep theirs
        if (src[i] > 0.99 && src[i + 1] > 0.99 && src[i + 2] > 0.99) {
          arr[i] = lookPlinth.r
          arr[i + 1] = lookPlinth.g
          arr[i + 2] = lookPlinth.b
        }
      }
      col.needsUpdate = true
    },
    setPlots(owned, afford, t) {
      pads.begin()
      ropes.begin()
      const next = owned.indexOf(0)
      for (let i = 0; i < PLOTS.length; i++) {
        const p = PLOTS[i]
        const sale = owned[i] === 0
        _m.makeTranslation(p.x, 0, p.z)
        pads.put(_m, sale ? SALE_TINT : PAD_TINT[i])
        if (sale) ropes.put(_m.makeTranslation(p.x, PAD_H, p.z))
        if (sale && !forSale[i]) shown[i] = t
        if (!sale && forSale[i] && shown[i] >= 0) sold[i] = t
        forSale[i] = sale
        affordable[i] = sale && !!afford?.[i]
        far[i] = sale && !affordable[i] && i > next + 1
        signs[i].visible = sale || t - sold[i] < SOLD_S
      }
      pads.end()
      ropes.end()
    },
    select(i) {
      selected = i
      ring.visible = i >= 0
      if (i >= 0) ring.position.set(PLOTS[i].x, PAD_H + 0.02, PLOTS[i].z)
    },
    setVault(f, t) {
      const was = full
      fill = Math.max(0, Math.min(1, f))
      full = fill >= 1
      if (full && !was) v.root.userData.fullAt = t
    },
    tick(t, dt) {
      // the signs: a sign that's just gone up pops in; an affordable one bounces; a sold one leaps up and away
      for (let i = 0; i < PLOTS.length; i++) {
        const s = signs[i]
        if (!forSale[i]) {
          const u = (t - sold[i]) / SOLD_S
          s.visible = u < 1
          if (s.visible) {
            s.scale.setScalar(Math.max(0.001, (1 + 0.5 * u) * (1 - u) ** 2))
            s.position.y = PAD_H + u * 2.2
            s.rotation.z = u * 0.6
          }
          continue
        }
        const pop = popScale(t - shown[i])
        const bob = affordable[i] ? Math.abs(Math.sin(t * 3.2 + i)) * 0.22 : 0
        s.scale.setScalar(Math.max(0.001, pop * (affordable[i] ? 1.06 : far[i] ? 0.7 : 1)))
        s.position.y = PAD_H + bob
        s.rotation.z = affordable[i] ? Math.sin(t * 3.2 + i) * 0.04 : 0
      }
      if (selected >= 0) {
        ringMat.opacity = 0.65 + 0.35 * Math.sin(t * 4)
        const sc = 1 + 0.015 * Math.sin(t * 4)
        ring.scale.set(sc, 1, sc)
      }
      // the vault: lamps light up round the door as it fills; the gold piles up; full, it bounces and flashes
      fillShown += (fill - fillShown) * Math.min(1, dt * 3)
      const lit = fillShown * VAULT_LAMPS
      v.lamps.begin()
      for (let i = 0; i < VAULT_LAMPS; i++) {
        const a = Math.PI / 2 - (i / VAULT_LAMPS) * TAU
        _m.makeTranslation(Math.cos(a) * 1.0, 1.08 + Math.sin(a) * 1.0, 0.8)
        const on = Math.min(1, Math.max(0, lit - i))
        _c.copy(DIM).lerp(LIT, on)
        if (full) _c.multiplyScalar(0.75 + 0.45 * Math.max(0, Math.sin(t * 6 - i * 0.6)))
        v.lamps.put(_m, _c)
      }
      v.lamps.end()
      v.wheel.rotation.z = t * (full ? 1.6 : 0.25)
      const ms = Math.max(0.001, fillShown)
      v.mound.scale.set(0.5 + ms * 0.5, ms, 0.5 + ms * 0.5)
      v.mound.visible = fillShown > 0.02
      v.stacks.begin()
      const nStacks = Math.round(fillShown * 16)
      for (let i = 0; i < nStacks; i++) {
        const a = Math.PI / 4 + ((i % 2 ? 1 : -1) * (0.62 + Math.floor(i / 2) * 0.16))
        const r = 1.95 + (i % 3) * 0.17
        _m.makeTranslation(Math.cos(a) * r, 0.28, Math.sin(a) * r)
        v.stacks.put(_m)
      }
      v.stacks.end()
      const since = t - ((v.root.userData.fullAt as number | undefined) ?? -9)
      const b = full ? Math.abs(Math.sin(t * 2.6)) * 0.05 + (since < 0.8 ? Math.sin(since * Math.PI * 2.5) * 0.08 * (1 - since / 0.8) : 0) : 0
      v.safe.scale.set(1 - b * 0.5, 1 + b, 1 - b * 0.5)
    },
    dispose() {
      root.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) return
        if (o instanceof THREE.Mesh || o instanceof THREE.Points) {
          o.geometry.dispose()
          if (o.userData.text) {
            const mat = o.material as THREE.MeshBasicMaterial
            mat.map?.dispose()
            mat.dispose()
          }
        }
      })
      ;(top.material as THREE.Material).dispose()
      ringMat.dispose()
      ;(halo.material as THREE.Material).dispose()
      for (const b of [pads, ropes, v.lamps, v.stacks]) {
        b.mesh.geometry.dispose()
        b.dispose()
      }
      shadows.dispose()
      shadowTex?.dispose()
      shadowTex = null
    },
  }
}
