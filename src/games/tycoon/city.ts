import * as THREE from 'three'
import type { FloorLook } from './floor'
import { palm } from './floor'
import { EDGE_H, HALF } from './layout'
import { C, T, TAU, TKit, box, cyl, gable, rbox, rng, slabXY, sphere, star, toonMaterial, type Rand } from './models'

/*
  The city round the casino, one of five looks that change as the player's Stars move it up: Boje Town (a sunny
  morning among red roofs and green hills, a windmill turning), Riverside (golden afternoon over a river, a brick
  waterfront and a paddle steamer), Desert Strip (sunset over mesas and the hotels of the strip), Neon Bay (a night
  of skyscrapers trimmed in neon round the bay, a lit Ferris wheel turning) and Monaco Heights (dusk over the sea,
  villas on the hills, yachts at anchor).

  The camera looks in from the front, so the city stands mostly behind the floor: a skyline on a strip of ground
  beyond the floor's back corner, lower blocks and trees off to the sides, only low things in front. The ground ends
  in a straight line across the screen; behind it a tall backdrop holds the sky (its gradient, the sun or the moon,
  stars at night), and the scene's fog is the sky's horizon colour, so the city fades into it towards the back.

  Places are given across and into the screen: l runs left to right (x − z), d from the back to the front (x + z).
  LOOKS[k] holds a city's colours and light; buildCity(k) makes its scenery (the scene adds `root`, ticks it, and
  disposes it when the city changes).
*/

export interface CityLook {
  name: string
  /** the sky from the top down to the horizon (also the fog) */
  sky: [string, string, string]
  sun: { color: string; intensity: number }
  ambient: { color: string; intensity: number }
  /** 0 by day .. 1 at night: lamps, windows and neon light up */
  night: number
  /** where the sun (or moon) sits on the backdrop, across and up, and how big */
  sunAt: [number, number, number]
  sunColor: string
  stars: number
  floor: FloorLook
  /** the people's shadows and the bloom */
  bloom: number
  /** the haze into the sky: from depth x to depth y (x + z, going back), up to z of the way (the shader's uHaze);
   *  the usual one when left out */
  haze?: [number, number, number]
}

/** the usual haze: the skyline fades all the way into the sky at the back */
export const HAZE: [number, number, number] = [27, 41, 1]

const L = (r: number, g: number, b: number) => new THREE.Color(r, g, b)

export const LOOKS: readonly CityLook[] = [
  {
    name: 'Boje Town',
    sky: ['#4fb2ff', '#9fd8ff', '#e2f6ff'],
    sun: { color: '#fff6e4', intensity: 2.1 },
    ambient: { color: '#e4f2ff', intensity: 1.15 },
    night: 0,
    sunAt: [-26, 30, 4.5],
    sunColor: '#fff8d8',
    stars: 0,
    floor: { carpet: '#14606b', lattice: '#e3b04a', accent: '#ffd76a', plinth: '#2c4f86', light: L(1, 1, 1) },
    bloom: 0.45,
  },
  {
    name: 'Riverside',
    sky: ['#5f9be0', '#ffc59a', '#ffe6c4'],
    sun: { color: '#ffd9a8', intensity: 2.0 },
    ambient: { color: '#ffe6d0', intensity: 1.1 },
    night: 0.1,
    sunAt: [22, 16, 5],
    sunColor: '#fff0c0',
    stars: 0,
    floor: { carpet: '#17583f', lattice: '#efcf8a', accent: '#fff0c4', plinth: '#2c5a46', light: L(1.02, 0.98, 0.92) },
    bloom: 0.5,
    // the brick waterfront stands just beyond the river: a light haze keeps it a town, not a pink fog
    haze: [33, 52, 0.45],
  },
  {
    name: 'Desert Strip',
    sky: ['#3b3f94', '#ff7a6a', '#ffc883'],
    sun: { color: '#ffb487', intensity: 1.8 },
    ambient: { color: '#ffc9c0', intensity: 1.05 },
    night: 0.45,
    sunAt: [-8, 9, 7],
    sunColor: '#ffe2a0',
    stars: 0.15,
    floor: { carpet: '#6e1830', lattice: '#f0b84a', accent: '#ffd86a', plinth: '#5e2236', light: L(1.02, 0.94, 0.9) },
    bloom: 0.6,
  },
  {
    name: 'Neon Bay',
    sky: ['#080a2a', '#24165a', '#4a2a7a'],
    sun: { color: '#a8b8ff', intensity: 1.15 },
    ambient: { color: '#8a78d0', intensity: 1.0 },
    night: 1,
    sunAt: [24, 26, 3.2],
    sunColor: '#f4f0ff',
    stars: 1,
    floor: { carpet: '#2a1f66', lattice: '#58c8e8', accent: '#ff6fd8', plinth: '#221a48', light: L(0.82, 0.8, 0.98) },
    bloom: 0.75,
  },
  {
    name: 'Monaco Heights',
    sky: ['#2a3070', '#c46aa8', '#ffb98e'],
    sun: { color: '#ffc6a6', intensity: 1.75 },
    ambient: { color: '#d0a8e0', intensity: 1.05 },
    night: 0.6,
    sunAt: [10, 7, 6],
    sunColor: '#ffd8a8',
    stars: 0.3,
    floor: { carpet: '#1a2558', lattice: '#e8c062', accent: '#ffe08a', plinth: '#1f2c5e', light: L(0.98, 0.93, 0.94) },
    bloom: 0.65,
  },
]

/* ---------------- placing things ---------------- */

const GROUND = -EDGE_H
/** world x, z of a place across (l) and into (d) the screen */
const at = (l: number, d: number): [number, number] => [(d + l) / 2, (d - l) / 2]
/** the ground ends, and the backdrop stands, this far back */
const BACK = -40
/**
 * The city is a miniature next to the casino: everything in it is built at S of its natural size, so the floor stays
 * the star (in an orthographic view nothing shrinks with distance, so a full-size town would loom over it).
 */
const S = 0.62
/** the floor's own footprint (and a margin for the road round it), kept clear */
const clearOfFloor = (x: number, z: number, m: number) => Math.abs(x) < HALF + m && Math.abs(z) < HALF + m

/** a building: a block with windows and a roof */
function building(k: TKit, x: number, z: number, w: number, d: number, h: number, wall: THREE.ColorRepresentation, roof: 'flat' | 'gable' | 'tank' | 'spire' | 'dome' | 'step', roofC: THREE.ColorRepresentation = '#8a8aa0', windows = true) {
  const y = GROUND
  w *= S
  d *= S
  h *= S
  k.add(rbox(w, h, d, Math.min(0.12, w * 0.05)), wall, T([x, y + h / 2, z]), 1, { windows })
  k.add(rbox(w + 0.1, 0.16, d + 0.1, 0.04), C(wall).multiplyScalar(0.82), T([x, y + h, z]))
  if (roof === 'gable') k.add(gable(w + 0.3, d + 0.3, Math.min(w, d) * 0.45), roofC, T([x, y + h + 0.08, z], [0, w < d ? Math.PI / 2 : 0, 0]))
  else if (roof === 'tank') {
    k.add(cyl(0.45 * S, 0.8 * S, 10), '#8a6a4a', T([x + w * 0.2, y + h + 0.6 * S, z - d * 0.15]))
    k.add(new THREE.ConeGeometry(0.5 * S, 0.35 * S, 10), '#6a5040', T([x + w * 0.2, y + h + 1.57 * S, z - d * 0.15]))
    for (const s of [-1, 1]) k.add(cyl(0.04, 0.6 * S, 4), '#5a4a3a', T([x + w * 0.2 + s * 0.3 * S, y + h, z - d * 0.15]), 0)
  } else if (roof === 'spire') {
    k.add(rbox(w * 0.6, h * 0.12, d * 0.6, 0.05), wall, T([x, y + h + h * 0.06, z]), 1, { windows })
    k.add(new THREE.ConeGeometry(Math.min(w, d) * 0.18, h * 0.3, 4), roofC, T([x, y + h * 1.27, z], [0, Math.PI / 4, 0]))
  } else if (roof === 'dome') k.add(new THREE.SphereGeometry(Math.min(w, d) * 0.42, 16, 8, 0, TAU, 0, Math.PI / 2), roofC, T([x, y + h + 0.1, z]), 1, { shine: 0.6 })
  else if (roof === 'step') {
    k.add(rbox(w * 0.7, h * 0.15, d * 0.7, 0.05), wall, T([x, y + h * 1.075, z]), 1, { windows })
    k.add(rbox(w * 0.4, h * 0.1, d * 0.4, 0.05), wall, T([x, y + h * 1.2, z]), 1, { windows })
  }
}

function roundTree(k: TKit, x: number, z: number, s: number, R: Rand, greens = ['#4fb85a', '#62c45e', '#3fa65a']) {
  const y = GROUND
  s *= S
  k.add(cyl(0.14 * s, 0.9 * s, 6), '#8a5a32', T([x, y, z]))
  const g = greens[Math.floor(R() * greens.length)]
  k.add(sphere(0.75 * s, 8, 6), g, T([x, y + 1.3 * s, z]))
  k.add(sphere(0.5 * s, 8, 6), C(g).multiplyScalar(1.1), T([x + 0.35 * s, y + 1.7 * s, z + 0.2 * s]))
}

function pine(k: TKit, x: number, z: number, s: number) {
  s *= S
  k.add(cyl(0.12 * s, 0.5 * s, 6), '#7a4a2a', T([x, GROUND, z]))
  for (let i = 0; i < 3; i++) k.add(new THREE.ConeGeometry((0.85 - i * 0.2) * s, 1.0 * s, 8), '#2f8a4a', T([x, GROUND + (0.9 + i * 0.6) * s, z]))
}

function cypress(k: TKit, x: number, z: number, s: number) {
  s *= S
  k.add(cyl(0.1 * s, 0.4 * s, 6), '#6a4a2a', T([x, GROUND, z]))
  k.add(sphere(1, 8, 8), '#2f6a3e', T([x, GROUND + 1.6 * s, z], [0, 0, 0], [0.45 * s, 1.45 * s, 0.45 * s]))
}

function cactus(k: TKit, x: number, z: number, s: number) {
  const g = '#4f9a4a'
  s *= S
  k.add(new THREE.CapsuleGeometry(0.22 * s, 1.6 * s, 3, 10), g, T([x, GROUND + 1.0 * s, z]))
  k.add(new THREE.CapsuleGeometry(0.14 * s, 0.6 * s, 3, 8), g, T([x + 0.42 * s, GROUND + 1.3 * s, z]))
  k.add(new THREE.CapsuleGeometry(0.14 * s, 0.3 * s, 3, 8), g, T([x + 0.26 * s, GROUND + 0.95 * s, z], [0, 0, Math.PI / 2]))
  k.add(new THREE.CapsuleGeometry(0.13 * s, 0.5 * s, 3, 8), g, T([x - 0.38 * s, GROUND + 1.6 * s, z]))
  k.add(new THREE.CapsuleGeometry(0.13 * s, 0.25 * s, 3, 8), g, T([x - 0.24 * s, GROUND + 1.3 * s, z], [0, 0, Math.PI / 2]))
}

function hill(k: TKit, x: number, z: number, r: number, h: number, color: THREE.ColorRepresentation) {
  k.add(sphere(1, 16, 8), color, T([x, GROUND, z], [0, 0, 0], [r * S, h * S, r * S * 0.8]), 1)
}

/** a flat patch of ground colour (water, sand, a road): a polygon given in (l, d) */
function patch(k: TKit, ld: [number, number][], color: THREE.ColorRepresentation, lift = 0.01, look = {}) {
  const pts = ld.map(([l, d]) => at(l, d))
  const s = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)))
  const g = new THREE.ShapeGeometry(s)
  g.rotateX(-Math.PI / 2)
  g.translate(0, GROUND + lift, 0)
  k.add(g, color, undefined, 0, look)
}

/** the ground: one big sheet in (l, d), ending at BACK */
function ground(k: TKit, color: THREE.ColorRepresentation) {
  patch(k, [[-140, BACK], [140, BACK], [140, 90], [-140, 90]], color, 0)
}

/** the road and pavement round the plinth */
function ringRoad(k: TKit, road: THREE.ColorRepresentation, walk: THREE.ColorRepresentation) {
  const sq = (m: number, c: THREE.ColorRepresentation, lift: number) => {
    const e = HALF + m
    const g = new THREE.PlaneGeometry(e * 2, e * 2)
    g.rotateX(-Math.PI / 2)
    g.translate(0, GROUND + lift, 0)
    k.add(g, c, undefined, 0)
  }
  sq(5.2, walk, 0.012)
  sq(4.6, road, 0.016)
  sq(1.1, walk, 0.02)
  // lane dashes
  const e = HALF + 2.85
  for (let i = -8; i <= 8; i++) {
    const p = i * 2.2
    for (const [x, z, rot] of [
      [e, p, 0],
      [-e, p, 0],
      [p, e, Math.PI / 2],
      [p, -e, Math.PI / 2],
    ] as const)
      k.add(box(0.12, 0.01, 0.9), '#f4f0d8', T([x, GROUND + 0.024, z], [0, rot, 0]), 0)
  }
}

/** a little toon car, facing +z (origin on the road) */
function car(color: THREE.ColorRepresentation, taxi: boolean) {
  const k = new TKit()
  k.add(rbox(0.62, 0.3, 1.25, 0.12), color, T([0, 0.27, 0]))
  k.add(rbox(0.56, 0.26, 0.66, 0.1), C(color).lerp(C('#ffffff'), 0.25), T([0, 0.5, -0.08]))
  k.add(box(0.5, 0.17, 0.02), '#2a3a5a', T([0, 0.5, 0.26]), 0)
  k.add(box(0.02, 0.15, 0.5), '#2a3a5a', T([0.285, 0.5, -0.08]), 0)
  k.add(box(0.02, 0.15, 0.5), '#2a3a5a', T([-0.285, 0.5, -0.08]), 0)
  for (const [x, z] of [
    [-0.3, 0.38],
    [0.3, 0.38],
    [-0.3, -0.4],
    [0.3, -0.4],
  ])
    k.add(cyl(0.13, 0.12, 10), '#1c1a24', T([x + (x > 0 ? -0.06 : 0.06), 0.13, z], [0, 0, Math.PI / 2]), 0.6)
  for (const x of [-0.2, 0.2]) k.add(sphere(0.06, 6, 4), C('#fff6d0', 1.4), T([x, 0.3, 0.63]), 0, { flat: true, lamp: true })
  if (taxi) k.add(rbox(0.22, 0.08, 0.12, 0.03), C('#fff6d0', 1.2), T([0, 0.67, -0.08]), 0.5, { lamp: true })
  const m = k.mesh('car')
  const g = new THREE.Group()
  g.add(m)
  return g
}

/** a few cars driving round the ring road, in both directions */
function traffic(root: THREE.Group, anims: Anim[], colors: string[]) {
  const mid = HALF + 2.85
  const r = 1.6
  const cars = colors.map((c, i) => {
    const g = car(c, i % 3 === 2)
    root.add(g)
    // two lanes: the outer one round one way, the inner one the other
    const lane = i % 2 ? mid - 0.62 : mid + 0.62
    return { g, e: lane, dir: i % 2 ? -1 : 1, s: i * 13.7, v: 2.6 + (i % 3) * 0.5 }
  })
  const pos: [number, number, number] = [0, 0, 0]
  anims.push((_t, dt) => {
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i]
      const len = 8 * (c.e - r) + TAU * r
      c.s = (((c.s + c.v * dt * c.dir) % len) + len) % len
      onLoop(c.e, r, c.s, pos)
      c.g.position.set(pos[0], GROUND, pos[1])
      c.g.rotation.y = pos[2] + (c.dir < 0 ? Math.PI : 0)
    }
  })
}

/** the point `s` along a rounded square loop of half size e (corner radius r), and the way along it: [x, z, yaw] */
function onLoop(e: number, r: number, s: number, out: [number, number, number]) {
  const side = 2 * (e - r)
  const arc = (Math.PI / 2) * r
  const k = e - r
  // the four corners' centres, going round: +x +z, −x +z, −x −z, +x −z
  const cs: [number, number][] = [
    [k, k],
    [-k, k],
    [-k, -k],
    [k, -k],
  ]
  for (let q = 0; q < 4; q++) {
    const a0 = (q * Math.PI) / 2
    // a straight side leading into corner q
    if (s < side) {
      const [cx, cz] = cs[q]
      const t = s - side
      // moving along the tangent of the corner's start (angle a0): direction (−sin a0, cos a0)
      out[0] = cx + r * Math.cos(a0) - Math.sin(a0) * t
      out[1] = cz + r * Math.sin(a0) + Math.cos(a0) * t
      out[2] = Math.atan2(-Math.sin(a0), Math.cos(a0))
      return out
    }
    s -= side
    if (s < arc) {
      const [cx, cz] = cs[q]
      const a = a0 + s / r
      out[0] = cx + r * Math.cos(a)
      out[1] = cz + r * Math.sin(a)
      out[2] = Math.atan2(-Math.sin(a), Math.cos(a))
      return out
    }
    s -= arc
  }
  out[0] = e
  out[1] = 0
  out[2] = 0
  return out
}

/** spots on a strip of the city in (l, d), kept off the floor and apart */
function scatter(R: Rand, l0: number, l1: number, d0: number, d1: number, n: number, gap: number, out: [number, number][] = []) {
  const mine: [number, number][] = []
  for (let tries = 0; mine.length < n && tries < n * 40; tries++) {
    const [x, z] = at(l0 + R() * (l1 - l0), d0 + R() * (d1 - d0))
    if (clearOfFloor(x, z, 6)) continue
    if ([...out, ...mine].some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 < gap * gap)) continue
    mine.push([x, z])
  }
  out.push(...mine)
  return mine
}

/* ---------------- the cities ---------------- */

export interface CitySet {
  root: THREE.Group
  tick(t: number, dt: number): void
  dispose(): void
}

type Anim = (t: number, dt: number) => void

function bojeTown(k: TKit, root: THREE.Group, anims: Anim[]) {
  const R = rng(11)
  ground(k, '#86cf62')
  ringRoad(k, '#6a6f86', '#e8e0cc')
  traffic(root, anims, ['#e8574a', '#4a7fd8', '#ffc93d', '#7ad35c'])
  // rolling hills at the back
  for (let i = 0; i < 9; i++) {
    const [x, z] = at(-64 + i * 16 + R() * 5, BACK - 1 - R() * 2)
    hill(k, x, z, 7 + R() * 4, 3.5 + R() * 3.5, i % 2 ? '#7cc45a' : '#6fb852')
  }
  const used: [number, number][] = []
  const walls = ['#fff3dc', '#ffe8a8', '#ffd0d8', '#d8ecff', '#e8ffd8']
  const roofs = ['#e8574a', '#4a7fd8', '#f08a3c', '#c84a6a']
  for (const [x, z] of scatter(R, -44, 44, -38, -26, 30, 2.5, used)) building(k, x, z, 2.2 + R() * 1.4, 2.2 + R() * 1.4, 1.8 + R() * 1.8, walls[Math.floor(R() * walls.length)], 'gable', roofs[Math.floor(R() * roofs.length)])
  for (const [x, z] of scatter(R, -46, 46, -26, 6, 16, 2.6, used)) building(k, x, z, 2.2 + R() * 1.2, 2.2 + R() * 1.2, 1.6 + R() * 1.4, walls[Math.floor(R() * walls.length)], 'gable', roofs[Math.floor(R() * roofs.length)])
  for (const [x, z] of scatter(R, -50, 50, -39, 36, 60, 1.6, used)) roundTree(k, x, z, 0.85 + R() * 0.5, R)
  for (const [x, z] of scatter(R, -50, 50, -40, -34, 20, 1.5, used)) pine(k, x, z, 0.9 + R() * 0.5)
  // the clock tower and the water tower
  const [tx, tz] = at(-12, -30)
  k.push(T([tx, GROUND, tz], [0, 0, 0], S))
  k.add(rbox(2.2, 6.5, 2.2, 0.08), '#f4e2c4', T([0, 3.25, 0]))
  k.add(rbox(2.4, 0.2, 2.4, 0.05), '#d8c4a4', T([0, 6.5, 0]))
  k.add(new THREE.ConeGeometry(1.4, 2.6, 4), '#4a7fd8', T([0, 7.9, 0], [0, Math.PI / 4, 0]))
  k.add(cyl(0.6, 0.1, 20), '#ffffff', T([0, 5.4, 1.12], [Math.PI / 2, 0, 0]), 0)
  k.add(cyl(0.6, 0.1, 20), '#ffffff', T([1.12, 5.4, 0], [0, 0, -Math.PI / 2]), 0)
  for (const r of [0, Math.PI / 2]) k.add(box(0.06, 0.45, 0.02), '#22153a', T([r ? 1.18 : 0, 5.5, r ? 0 : 1.18], [0, r, 0.6]), 0, { flat: true })
  k.pop()
  const [wx, wz] = at(16, -33)
  k.push(T([wx, GROUND, wz], [0, 0, 0], S))
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.add(cyl(0.12, 6, 6), '#c8c8d8', T([sx * 1.1, 0, sz * 1.1]))
  k.add(cyl(1.9, 2.4, 20), '#f4f0e8', T([0, 6, 0]))
  k.add(new THREE.ConeGeometry(2.05, 1.2, 20), '#e8574a', T([0, 9, 0]))
  k.add(cyl(1.92, 0.5, 20, 1.92, true), '#e8574a', T([0, 7, 0]), 0)
  k.pop()
  // a windmill with turning sails
  const [mx, mz] = at(30, -24)
  k.push(T([mx, GROUND, mz], [0, 0, 0], S))
  k.add(cyl(1.1, 6, 12, 1.6), '#fff3dc', T([0, 0, 0]))
  k.add(new THREE.ConeGeometry(1.3, 1.4, 12), '#e8574a', T([0, 6.7, 0]))
  k.pop()
  windmillSails(root, anims, mx + 0.9 * S, GROUND + 6.2 * S, mz + 0.9 * S)
  clouds(root, anims, ['#ffffff', '#f4fbff'], 7)
}

function windmillSails(root: THREE.Group, anims: Anim[], x: number, y: number, z: number) {
  const k = new TKit()
  k.add(cyl(0.25, 0.4, 10), '#8a5a32', T([0, 0, 0], [Math.PI / 2, 0, 0]))
  for (let i = 0; i < 4; i++) {
    k.push(T([0, 0, 0.3], [0, 0, (i / 4) * TAU]))
    k.add(box(0.16, 3.4, 0.08), '#8a5a32', T([0, 1.8, 0]))
    k.add(box(0.8, 2.6, 0.04), '#fff8ec', T([0.45, 2.0, 0]))
    k.pop()
  }
  const m = k.mesh('sails')
  m.position.set(x, y, z)
  m.rotation.y = Math.PI / 4
  m.scale.setScalar(S)
  root.add(m)
  anims.push((t) => (m.rotation.z = -t * 0.6))
}

/** puffy clouds drifting slowly across the back */
function clouds(root: THREE.Group, anims: Anim[], tones: string[], n: number) {
  const R = rng(5)
  const list: { m: THREE.Mesh; l: number; d: number; y: number; v: number }[] = []
  for (let i = 0; i < n; i++) {
    const k = new TKit('#8aa8c8')
    for (let j = 0; j < 5; j++) k.add(sphere(1, 10, 7), tones[j % tones.length], T([(j - 2) * 0.85, Math.sin(j * 1.7) * 0.26 + (j % 2) * 0.32, Math.cos(j) * 0.26], [0, 0, 0], 0.72 + ((j * 0.37) % 0.4)), 0.8)
    const m = k.mesh('cloud')
    root.add(m)
    list.push({ m, l: -60 + R() * 120, d: BACK + 1 + R() * 4, y: 9 + R() * 6, v: 0.4 + R() * 0.6 })
  }
  anims.push((_t, dt) => {
    for (let i = 0; i < list.length; i++) {
      const c = list[i]
      c.l += c.v * dt
      if (c.l > 64) c.l = -64
      const [x, z] = at(c.l, c.d)
      c.m.position.set(x, c.y, z)
    }
  })
}

function riverside(k: TKit, root: THREE.Group, anims: Anim[]) {
  const R = rng(22)
  ground(k, '#97cc5c')
  ringRoad(k, '#6a6f86', '#ead9bc')
  traffic(root, anims, ['#2f6a8a', '#d8574a', '#ffc93d', '#f4f0e8'])
  // the river across the back, its banks paved
  patch(k, [[-140, -33], [140, -33], [140, -28.5], [-140, -28.5]], '#3fa6d8', 0.02)
  for (let i = 0; i < 18; i++) patch(k, [[-120 + i * 14, -31.2], [-114 + i * 14, -31.2], [-114 + i * 14, -30.9], [-120 + i * 14, -30.9]], '#9fe0ff', 0.03, { flat: true })
  patch(k, [[-140, -34], [140, -34], [140, -33], [-140, -33]], '#c8b08a', 0.025)
  patch(k, [[-140, -28.5], [140, -28.5], [140, -27.5], [-140, -27.5]], '#c8b08a', 0.025)
  const used: [number, number][] = []
  const bricks = ['#b8553a', '#c96a45', '#9a4a3a', '#d8845a', '#e8d0b0']
  for (const [x, z] of scatter(R, -44, 44, -40, -34.5, 20, 2.7, used)) building(k, x, z, 2.8 + R() * 2, 2.8 + R() * 1.6, 3.2 + R() * 4.5, bricks[Math.floor(R() * bricks.length)], R() > 0.5 ? 'tank' : 'flat')
  for (const [x, z] of scatter(R, -46, 46, -27, 6, 16, 2.7, used)) building(k, x, z, 2.4 + R() * 1.6, 2.4 + R() * 1.6, 2.2 + R() * 2.4, bricks[Math.floor(R() * bricks.length)], R() > 0.6 ? 'tank' : 'flat')
  for (const [x, z] of scatter(R, -50, 50, -27, 36, 52, 1.6, used)) roundTree(k, x, z, 0.85 + R() * 0.5, R, ['#5cae4a', '#7cc04f', '#d8a040'])
  // a paddle steamer working up the river
  const boat = steamer()
  root.add(boat)
  let l = -50
  anims.push((t, dt) => {
    l += dt * 1.6
    if (l > 56) l = -56
    const [x, z] = at(l, -30.6)
    boat.position.set(x, GROUND + 0.05 + Math.sin(t * 1.5) * 0.04, z)
    ;(boat.userData.wheel as THREE.Object3D).rotation.x = -t * 2
  })
  clouds(root, anims, ['#fff4e8', '#ffe6d0'], 6)
}

function steamer() {
  const g = new THREE.Group()
  const k = new TKit()
  k.add(rbox(4.2, 0.6, 1.4, 0.2), '#ffffff', T([0, 0.3, 0]))
  k.add(rbox(4.3, 0.12, 1.5, 0.05), '#d8213b', T([0, 0.62, 0]))
  k.add(rbox(2.6, 0.6, 1.1, 0.08), '#fff3dc', T([-0.2, 0.98, 0]), 1, { windows: true })
  k.add(rbox(1.4, 0.45, 0.9, 0.06), '#fff3dc', T([-0.4, 1.5, 0]))
  for (const x of [0.2, 0.8]) {
    k.add(cyl(0.14, 1.0, 10), '#2a2238', T([x - 0.5, 1.6, 0]))
    k.add(cyl(0.17, 0.12, 10), '#d8213b', T([x - 0.5, 2.5, 0]))
  }
  g.add(k.mesh('steamer'))
  const w = new TKit()
  w.add(cyl(0.6, 0.3, 14), '#d8213b', T([0, -0.15, 0], [0, 0, Math.PI / 2]))
  for (let i = 0; i < 6; i++) w.add(box(0.32, 1.2, 0.08), '#8a5a32', T([0, 0, 0], [(i / 6) * Math.PI, 0, 0]), 0.6)
  const wheel = w.mesh('paddle')
  wheel.position.set(2.2, 0.6, 0)
  g.add(wheel)
  g.userData.wheel = wheel
  g.rotation.y = Math.PI / 4
  g.scale.setScalar(S)
  return g
}

function desertStrip(k: TKit, root: THREE.Group, anims: Anim[]) {
  const R = rng(33)
  ground(k, '#efc07a')
  ringRoad(k, '#4a4a5e', '#f4dcb0')
  traffic(root, anims, ['#ff4f6e', '#ffffff', '#ffc93d', '#7ad7d0', '#c77dff'])
  // mesas on the horizon
  for (let i = 0; i < 7; i++) {
    const [x, z] = at(-60 + i * 19 + R() * 5, BACK - 1 - R() * 2)
    const w = (5 + R() * 5) * S
    const h = (2.5 + R() * 3) * S
    k.add(rbox(w, h, w * 0.7, 0.3), '#c8643a', T([x, GROUND + h / 2, z]))
    k.add(rbox(w * 0.7, h * 0.5, w * 0.5, 0.3), '#d8784a', T([x - w * 0.1, GROUND + h + h * 0.25, z]))
  }
  // the strip's hotels: tall slabs, a black pyramid with a beam, a needle tower
  const used: [number, number][] = []
  const tones = ['#ffffff', '#ffe8b8', '#7ad7d0', '#ffd0a0', '#e8c8ff']
  for (const [x, z] of scatter(R, -44, 44, -38, -28, 12, 4, used)) building(k, x, z, 2.6 + R() * 2.4, 2.4 + R() * 2, 5.5 + R() * 6.5, tones[Math.floor(R() * tones.length)], R() > 0.5 ? 'step' : 'flat', GOLD_ROOF)
  const [px, pz] = at(-25, -31)
  k.add(new THREE.ConeGeometry(4.6 * S, 5.4 * S, 4), '#2a2238', T([px, GROUND + 2.7 * S, pz], [0, Math.PI / 4, 0]), 1, { shine: 0.4 })
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: C('#fff6d0', 1.4), transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }))
  beam.position.set(px, GROUND + 5.4 * S + 30, pz)
  beam.userData.own = true
  root.add(beam)
  const [nx, nz] = at(22, -33)
  k.push(T([nx, GROUND, nz], [0, 0, 0], S))
  k.add(cyl(0.5, 12, 10, 1.0), '#f4f0e8', T([0, 0, 0]))
  k.add(cyl(1.7, 1.2, 16, 1.2), '#ffffff', T([0, 11.6, 0]), 1, { windows: true })
  k.add(new THREE.ConeGeometry(0.26, 2.6, 8), '#ff4f6e', T([0, 14.1, 0]))
  k.pop()
  for (const [x, z] of scatter(R, -46, 46, -27, 6, 14, 2.6, used)) building(k, x, z, 2.4 + R() * 1.6, 2.4 + R() * 1.6, 2.2 + R() * 2.4, tones[Math.floor(R() * tones.length)], 'flat')
  for (const [x, z] of scatter(R, -50, 50, -39, 36, 26, 2, used)) cactus(k, x, z, 0.8 + R() * 0.5)
  for (const [x, z] of scatter(R, -50, 50, -27, 36, 14, 2, used)) palm(k, x, z, 1.3 * S, R, GROUND)
  // a billboard of bulbs
  const [sx, sz] = at(30, -16)
  k.push(T([sx, GROUND, sz], [0, Math.PI / 4, 0], S))
  for (const s of [-1, 1]) k.add(cyl(0.2, 4, 8), '#5a5a6e', T([s * 2.2, 0, 0]))
  k.add(rbox(6, 2.6, 0.4, 0.1), '#2a1d4a', T([0, 5.2, 0]))
  for (let i = 0; i < 26; i++) {
    const a = i / 26
    const x = -2.8 + a * 5.6
    k.add(sphere(0.1, 6, 4), C('#ffe9a8', 1.6), T([x, 6.4, 0.22]), 0, { flat: true, bulb: 0.01 + (i % 6) / 6 })
    k.add(sphere(0.1, 6, 4), C('#ffe9a8', 1.6), T([x, 4.0, 0.22]), 0, { flat: true, bulb: 0.01 + ((i + 3) % 6) / 6 })
  }
  k.add(slabXY(star(0, 0, 0.9, 0.4), 0.1), C('#ffd23f', 1.4), T([0, 5.2, 0.22]), 0, { flat: true })
  k.pop()
  clouds(root, anims, ['#ffd0b8', '#ffb8a8'], 5)
}
const GOLD_ROOF = '#ffc53a'

function neonBay(k: TKit, root: THREE.Group, anims: Anim[]) {
  const R = rng(44)
  ground(k, '#2a2d48')
  ringRoad(k, '#1c1e30', '#3a3c58')
  traffic(root, anims, ['#ff4fd8', '#3ff0ff', '#ffc93d', '#7c5cff', '#ffffff'])
  // the bay across the back, neon reflections in it
  patch(k, [[-140, -40], [140, -40], [140, -25.5], [-140, -25.5]], '#14264a', 0.02)
  const neon = ['#ff4fd8', '#3ff0ff', '#ffd23f', '#7cff6a']
  for (let i = 0; i < 26; i++) {
    const l = -56 + i * 4.4 + R() * 2
    const d = -34 + R() * 7
    patch(k, [[l, d], [l + 1.4, d], [l + 1.4, d + 0.25], [l, d + 0.25]], C(neon[i % neon.length], 0.9), 0.03, { flat: true })
  }
  // skyscrapers on the far shore, neon on their tops
  const used: [number, number][] = []
  const dark = ['#2b3a6e', '#3a2f6e', '#1f4060', '#2a2a55']
  for (const [x, z] of scatter(R, -44, 44, -40, -35, 22, 2.6, used)) {
    const w = (2.4 + R() * 2) * S
    const d = (2.4 + R() * 1.6) * S
    const h = (7 + R() * 11) * S
    building(k, x, z, w / S, d / S, h / S, dark[Math.floor(R() * dark.length)], R() > 0.6 ? 'spire' : 'flat', '#9ab0ff')
    const c = C(neon[Math.floor(R() * neon.length)], 1.6)
    k.add(box(w + 0.16, 0.14, 0.14), c, T([x, GROUND + h - 0.3, z + d / 2 + 0.05]), 0, { flat: true })
    k.add(box(0.14, 0.14, d + 0.16), c, T([x + w / 2 + 0.05, GROUND + h - 0.3, z]), 0, { flat: true })
    k.add(box(0.12, h * 0.7, 0.12), c, T([x + w / 2 + 0.05, GROUND + h * 0.4, z + d / 2 + 0.05]), 0, { flat: true })
  }
  for (const [x, z] of scatter(R, -46, 46, -25, 6, 16, 2.8, used)) building(k, x, z, 2.4 + R() * 1.6, 2.4 + R() * 1.6, 2.6 + R() * 3.4, dark[Math.floor(R() * dark.length)], 'flat')
  for (const [x, z] of scatter(R, -50, 50, -25, 36, 22, 2.6, used)) {
    k.add(cyl(0.05, 1.6, 6), '#3a3c58', T([x, GROUND, z]))
    k.add(sphere(0.13, 8, 6), C(neon[Math.floor(R() * neon.length)], 1.5), T([x, GROUND + 1.68, z]), 0, { flat: true })
  }
  // a lit Ferris wheel on the shore
  const [fx, fz] = at(29, -19)
  for (const s of [-1, 1]) k.add(box(0.2, 5.6, 0.2), '#c8c8e8', T([fx + s * 1.0, GROUND + 2.6, fz - s * 1.0], [0, 0, 0]))
  const wheel = ferris()
  wheel.root.position.set(fx, GROUND + 8.6 * S, fz)
  wheel.root.scale.setScalar(S)
  root.add(wheel.root)
  anims.push((t) => {
    wheel.inner.rotation.z = t * 0.15
    for (let i = 0; i < wheel.cars.length; i++) wheel.cars[i].rotation.z = -wheel.inner.rotation.z
  })
}

/** the Ferris wheel: upright and square to the camera; `inner` turns, its cars hang level */
function ferris() {
  const root = new THREE.Group()
  const inner = new THREE.Group()
  const k = new TKit()
  const R = 6
  k.add(new THREE.TorusGeometry(R, 0.12, 6, 48), C('#ff4fd8', 1.5), undefined, 0, { flat: true })
  k.add(new THREE.TorusGeometry(R * 0.55, 0.08, 6, 36), C('#3ff0ff', 1.5), undefined, 0, { flat: true })
  for (let i = 0; i < 16; i++) k.add(box(0.07, R * 2, 0.07), C('#ffffff', 1.2), T([0, 0, 0], [0, 0, (i / 16) * Math.PI]), 0, { flat: true })
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU
    k.add(sphere(0.14, 6, 4), C('#ffe9a8', 1.7), T([Math.cos(a) * R, Math.sin(a) * R, 0.1]), 0, { flat: true, bulb: 0.01 + (i % 6) / 6 })
  }
  k.add(cyl(0.6, 0.6, 14), '#c8c8e8', T([0, 0, -0.3], [Math.PI / 2, 0, 0]))
  inner.add(k.mesh('ferris'))
  const cars: THREE.Object3D[] = []
  const carGeos = ['#ff4fd8', '#3ff0ff', '#ffd23f', '#7cff6a'].map((c) => {
    const cg = new TKit()
    cg.add(rbox(0.9, 0.7, 0.7, 0.15), c, T([0, -0.45, 0]), 1, { lamp: true })
    cg.add(box(0.04, 0.3, 0.04), '#c8c8e8', T([0, -0.05, 0]), 0)
    return cg.geometry()
  })
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU
    const c = new THREE.Mesh(carGeos[i % carGeos.length], toonMaterial())
    c.position.set(Math.cos(a) * R, Math.sin(a) * R, 0.2)
    cars.push(c)
    inner.add(c)
  }
  root.add(inner)
  root.rotation.y = Math.PI / 4
  return { root, inner, cars }
}

function monaco(k: TKit, root: THREE.Group, anims: Anim[]) {
  const R = rng(55)
  ground(k, '#8fae6a')
  ringRoad(k, '#5a5a6e', '#efe0c8')
  traffic(root, anims, ['#d8213b', '#f4f0e8', '#1f2c5e', '#ffc93d'])
  // the sea across the back, with a beach in front of it
  patch(k, [[-140, -40], [140, -40], [140, -30], [-140, -30]], '#2aa6b8', 0.02)
  for (let i = 0; i < 20; i++) patch(k, [[-110 + i * 12, -35], [-104 + i * 12, -35], [-104 + i * 12, -34.7], [-110 + i * 12, -34.7]], '#9ff0f0', 0.03, { flat: true })
  patch(k, [[-140, -30], [140, -30], [140, -28], [-140, -28]], '#f4dcb0', 0.025)
  // hills on both sides with villas and cypresses
  const used: [number, number][] = []
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const [x, z] = at(side * (32 + i * 5), -22 + i * 7)
      hill(k, x, z, 8, 4 + i, '#9cb874')
    }
  }
  const pastel = ['#fff1dc', '#ffe0c8', '#ffd8e0', '#fff6c8', '#e8f0ff']
  for (const [x, z] of scatter(R, -46, 46, -28, -24, 14, 2.4, used)) building(k, x, z, 2.2 + R() * 1.4, 2.2 + R() * 1.4, 1.8 + R() * 2, pastel[Math.floor(R() * pastel.length)], 'gable', '#d8643a')
  for (const [x, z] of scatter(R, -46, 46, -24, 8, 18, 2.6, used)) building(k, x, z, 2.2 + R() * 1.4, 2.2 + R() * 1.4, 1.8 + R() * 2, pastel[Math.floor(R() * pastel.length)], 'gable', '#d8643a')
  for (const [x, z] of scatter(R, -50, 50, -28, 36, 40, 1.6, used)) cypress(k, x, z, 0.85 + R() * 0.45)
  // the palace with gold domes
  const [px, pz] = at(-26, -26)
  building(k, px, pz, 7, 3.6, 4, '#fff6e8', 'flat')
  for (const s of [-1, 0, 1]) building(k, px + s * 2.6 * S, pz, 1.6, 1.6, 4 + (s === 0 ? 3 : 1.6), '#fff6e8', 'dome', '#ffc53a')
  // yachts at anchor
  const yachts: THREE.Object3D[] = []
  for (let i = 0; i < 4; i++) {
    const y = yacht()
    const [x, z] = at(-36 + i * 22 + R() * 6, -36 + R() * 4)
    y.position.set(x, GROUND + 0.04, z)
    root.add(y)
    yachts.push(y)
  }
  anims.push((t) => {
    for (let i = 0; i < yachts.length; i++) yachts[i].rotation.z = Math.sin(t * 1.1 + i) * 0.03
  })
  clouds(root, anims, ['#ffd8e8', '#ffc8d8'], 5)
}

function yacht() {
  const k = new TKit()
  k.add(rbox(3.4, 0.5, 1.1, 0.22), '#ffffff', T([0, 0.25, 0]))
  k.add(rbox(1.8, 0.4, 0.8, 0.12), '#f4f0e8', T([-0.2, 0.68, 0]), 1, { windows: true })
  k.add(rbox(1.0, 0.3, 0.6, 0.1), '#2a3a6a', T([-0.3, 1.0, 0]))
  k.add(cyl(0.04, 2.2, 6), '#c8c8d8', T([0.4, 0.5, 0]), 0)
  const m = k.mesh('yacht')
  m.rotation.y = Math.PI / 4 + 0.4
  m.scale.setScalar(S)
  const g = new THREE.Group()
  g.add(m)
  return g
}

/* ---------------- the sky ---------------- */

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uLow;
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform float uStars;
uniform float uTime;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float h = clamp((vP.y + 1.0) / 46.0, 0.0, 1.0);
  vec3 col = mix(uLow, uMid, smoothstep(0.0, 0.38, h));
  col = mix(col, uTop, smoothstep(0.32, 1.0, h));
  // the sun or moon: a disc with a soft glow round it
  float d = length(vP - uSun.xy);
  col += uSunColor * 0.35 * exp(-d / (uSun.z * 3.0));
  col = mix(col, uSunColor * 1.25, 1.0 - smoothstep(uSun.z - 0.15, uSun.z + 0.15, d));
  // stars, twinkling
  vec2 cell = floor(vP * 0.9);
  float r = hash(cell);
  vec2 f = fract(vP * 0.9) - 0.5 - (vec2(hash(cell + 3.1), hash(cell + 7.7)) - 0.5) * 0.6;
  float star = step(0.93, r) * (1.0 - smoothstep(0.02, 0.07, length(f))) * (0.6 + 0.4 * sin(uTime * 2.0 + r * 40.0));
  col += vec3(1.0, 0.97, 0.9) * star * uStars * smoothstep(0.15, 0.5, h);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`

function sky(look: CityLook) {
  const g = new THREE.PlaneGeometry(320, 110)
  g.translate(0, 110 / 2 - 2, 0)
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color(look.sky[0]) },
      uMid: { value: new THREE.Color(look.sky[1]) },
      uLow: { value: new THREE.Color(look.sky[2]) },
      uSun: { value: new THREE.Vector3(...look.sunAt) },
      uSunColor: { value: new THREE.Color(look.sunColor) },
      uStars: { value: look.stars },
      uTime: { value: 0 },
    },
    vertexShader: 'varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = vec2((w.x - w.z) * 0.7071, w.y); gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: SKY_FRAG,
    depthWrite: false,
  })
  const m = new THREE.Mesh(g, mat)
  const [x, z] = at(0, BACK - 2)
  m.position.set(x, GROUND, z)
  m.rotation.y = Math.PI / 4
  m.renderOrder = -10
  m.frustumCulled = false
  m.name = 'sky'
  return m
}

/* ---------------- the set ---------------- */

export function buildCity(index: number): CitySet {
  const look = LOOKS[index]
  const root = new THREE.Group()
  root.name = `city-${index}`
  const anims: Anim[] = []
  const k = new TKit()
  ;[bojeTown, riverside, desertStrip, neonBay, monaco][index](k, root, anims)
  const scenery = k.mesh('scenery')
  root.add(scenery)
  const skyMesh = sky(look)
  root.add(skyMesh)
  return {
    root,
    tick(t, dt) {
      ;(skyMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = t
      for (let i = 0; i < anims.length; i++) anims[i](t, dt)
    },
    dispose() {
      const geos = new Set<THREE.BufferGeometry>()
      root.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry)
          if (o.userData.own || o === skyMesh) (o.material as THREE.Material).dispose()
        }
      })
      for (const g of geos) g.dispose()
    },
  }
}
