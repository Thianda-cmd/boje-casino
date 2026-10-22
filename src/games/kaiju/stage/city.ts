import * as THREE from 'three'
import { glowTexture } from '../../../lib/three/fx'
import { T, VKit, vkMaterial } from '../../../lib/three/toon'
import { BUILDINGS, LIGHTHOUSE, PIER, PLAZA_R, SHORE_Z } from '../arena'
import { INK } from '../models/palette'
import { WATER_Y, WHEEL } from './director'
import { Kit, place, type PartLook, type SignSpec } from './kit'
import { RING_SIGNS, Ring } from './buildings'
import { GLINTS, groundMaterial, mountainMaterial, shaftGeometry, shaftMaterial, skyMaterial, waterMaterial } from './shaders'

/*
  Neon Bay, built in code. The plaza is a disc of wet asphalt on the waterfront with a neon ring round the fighting
  ground and the casino's emblem painted in the middle; the 24 buildings the kaiju can knock down stand round it
  (buildings.ts). Behind them the rest of the city climbs away inland, and across the bay the downtown skyline lines
  the far shore under a magenta glow: towers with lit windows and neon trims, rooftop signs in the site's colours
  (the green BOJE CASINO sign on the tallest), a needle tower with a lit pod, and a suspension bridge strung with
  lights crossing the mouth of the bay. Dark mountains stand behind, a big moon hangs over the water. On the bay: a
  pier with lamps and a Ferris wheel turning at its end, a lighthouse on a rock sweeping its beam, and a few lit
  boats crossing far out. Searchlights
  sweep the sky from the city (gold on a Main Event night) and cross over the plaza for the walkout; two news
  helicopters circle with their spotlights on the fight.

  Most of the city is the kit's instanced parts (kit.ts: six draw calls for every building), the sky, the water and
  the ground are one big shader each (shaders.ts), the shafts of light one instanced mesh. The water's reflections of
  the city are worked out once here from the buildings themselves: a band of light round the horizon, so every lit
  tower throws its own streak down the bay.
*/

export interface CityOpts {
  low: boolean
}

/** the light shafts, in the shafts mesh: searchlights, the lighthouse's two beams, the fighters' spots, the helicopters' */
const SEARCH = 5
const S_LIGHT = SEARCH
const S_SPOT = SEARCH + 2
const S_HELI = SEARCH + 4
const SHAFTS = SEARCH + 6

export const MOON_DIR = new THREE.Vector3(-0.42, 0.36, -1).normalize()

interface Boat {
  g: THREE.Group
  z: number
  speed: number
  x0: number
  bob: number
}

interface Heli {
  g: THREE.Group
  rotor: THREE.Object3D
  tailRotor: THREE.Object3D
  blink: THREE.Mesh[]
  r: number
  y: number
  w: number
  ph: number
  pos: THREE.Vector3
}

const rnd = (s: number) => {
  const x = Math.sin(s * 91.345 + 47.853) * 43758.5453
  return x - Math.floor(x)
}

export class City {
  readonly root = new THREE.Group()
  readonly kit = new Kit()
  readonly ring: Ring
  readonly sky: THREE.ShaderMaterial
  readonly water: THREE.ShaderMaterial
  readonly ground: THREE.ShaderMaterial
  readonly shafts: THREE.InstancedMesh
  private readonly shaftAttr: THREE.InstancedBufferAttribute
  private readonly own: { dispose: () => void }[] = []
  private readonly helis: Heli[] = []
  private readonly boats: Boat[] = []
  private wheel!: THREE.Group
  private cabins!: THREE.InstancedMesh
  private wheelLights!: THREE.Points
  private readonly lantern: THREE.MeshBasicMaterial
  /** the neon signs the plaza reflects: where, what colour, which building (-1: none) */
  readonly glints: { p: THREE.Vector3; col: THREE.Color; building: number }[] = []
  private readonly low: boolean
  private readonly m4 = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly v = new THREE.Vector3()
  private readonly v2 = new THREE.Vector3()
  private readonly down = new THREE.Vector3(0, -1, 0)
  private readonly a3 = new THREE.Vector3()
  private readonly b3 = new THREE.Vector3()
  private readonly c3 = new THREE.Vector3()
  private static readonly SEARCH_BLUE = new THREE.Color(0.62, 0.72, 1)
  private static readonly SEARCH_GOLD = new THREE.Color(1, 0.75, 0.32)
  private static readonly LIGHTHOUSE_C = new THREE.Color(1, 0.9, 0.6)
  private static readonly HELI_C = new THREE.Color(1, 0.96, 0.85)
  private static readonly LAMP_AT = new THREE.Vector3(LIGHTHOUSE.x, 13.75, LIGHTHOUSE.z)
  private static readonly BASES: readonly [number, number, number][] = [[-150, -2, -150], [-30, -2, -170], [110, -2, -160], [-80, 0, 70], [90, 0, 80]]

  constructor(o: CityOpts) {
    this.low = o.low
    const kit = this.kit
    const skySigns: SignSpec[] = [{ text: 'BOJE', box: true }, { text: 'CASINO' }, { text: '777' }, { text: 'KAIJU' }, { text: 'NEON BAY' }, { text: 'HOTEL' }, { text: 'LUCKY' }, { text: 'RAMEN', vertical: true }, { text: 'BAR', vertical: true }, { text: 'OPEN 24H' }]
    kit.prepareSigns([...RING_SIGNS, ...skySigns])
    this.ring = new Ring(kit, o.low)

    // the sky, the moon, the mountains
    this.sky = skyMaterial(MOON_DIR)
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1700, 32, 16), this.sky)
    dome.renderOrder = -10
    dome.frustumCulled = false
    this.root.add(dome)
    this.own.push(dome.geometry, this.sky)
    this.moon()
    this.mountains()

    // the water and the ground
    const refl = this.skyline(skySigns)
    this.water = waterMaterial(MOON_DIR, refl, SHORE_Z)
    const wg = new THREE.PlaneGeometry(1600, 1000, 1, 1).rotateX(-Math.PI / 2)
    wg.translate(0, 0, SHORE_Z - 500)
    const water = new THREE.Mesh(wg, this.water)
    water.position.y = WATER_Y
    this.root.add(water)
    this.own.push(wg, this.water, refl)
    const logo = logoTexture()
    this.ground = groundMaterial(logo, PLAZA_R, SHORE_Z)
    const gg = new THREE.PlaneGeometry(900, 460, 1, 1).rotateX(-Math.PI / 2)
    gg.translate(0, 0, SHORE_Z + 230)
    this.root.add(new THREE.Mesh(gg, this.ground))
    this.own.push(gg, this.ground, logo)
    this.seawall()
    this.pier()
    this.lighthouse()
    this.lantern = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.6, 1.6), fog: false })
    this.own.push(this.lantern)
    this.lighthouseLamp()
    kit.build(this.root)
    this.wheelLights.material = kit.lampMat
    this.own.push(kit)

    // the shafts of light
    const sg = shaftGeometry()
    this.shaftAttr = new THREE.InstancedBufferAttribute(new Float32Array(SHAFTS * 4), 4)
    this.shaftAttr.setUsage(THREE.DynamicDrawUsage)
    sg.setAttribute('aShaft', this.shaftAttr)
    const sm = shaftMaterial()
    this.shafts = new THREE.InstancedMesh(sg, sm, SHAFTS)
    this.shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.shafts.frustumCulled = false
    this.shafts.renderOrder = 6
    this.root.add(this.shafts)
    this.own.push(sg, sm)
    this.helicopters()
    this.harbour()

    // the signs the plaza reflects: the ring's own, nearest the ground
    const ringSigns = this.ring.ruins.flatMap((r, bi) => r.pieces.filter((p) => p.shape === 'sign').map((p) => ({ bi, idx: p.idx })))
    for (const { bi, idx } of ringSigns.slice(0, GLINTS)) {
      const s = kit.signs[idx]
      const p = new THREE.Vector3().setFromMatrixPosition(s.m)
      this.glints.push({ p, col: s.tint.clone().multiplyScalar(0.55), building: bi })
    }
    const g = this.ground.uniforms
    this.glints.forEach((gl, i) => {
      ;(g.uGlint.value as THREE.Vector3[])[i].copy(gl.p)
      ;(g.uGlintCol.value as THREE.Color[])[i].copy(gl.col)
    })
  }

  /* ---------------- the sky ---------------- */

  private moon() {
    const c = document.createElement('canvas')
    c.width = c.height = 256
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(118, 112, 10, 128, 128, 120)
    grad.addColorStop(0, '#fffbea')
    grad.addColorStop(0.8, '#f1ead2')
    grad.addColorStop(1, '#d9cfb0')
    g.fillStyle = grad
    g.beginPath()
    g.arc(128, 128, 118, 0, Math.PI * 2)
    g.fill()
    // a few soft craters
    for (const [x, y, r] of [[92, 96, 22], [160, 150, 28], [150, 80, 13], [100, 170, 16], [185, 112, 10]]) {
      g.fillStyle = 'rgba(190,178,150,0.45)'
      g.beginPath()
      g.arc(x, y, r, 0, Math.PI * 2)
      g.fill()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const mm = new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.35, 1.32, 1.25), fog: false, depthWrite: false })
    const moon = new THREE.Sprite(mm)
    moon.position.copy(MOON_DIR).multiplyScalar(1500)
    moon.scale.setScalar(120)
    moon.renderOrder = -9
    const gm = new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.42, 0.36, 0.7), fog: false, depthWrite: false, blending: THREE.AdditiveBlending, transparent: true })
    const glow = new THREE.Sprite(gm)
    glow.position.copy(moon.position)
    glow.scale.setScalar(520)
    glow.renderOrder = -9
    this.root.add(glow, moon)
    this.own.push(tex, mm, gm)
  }

  private mountains() {
    const mat = mountainMaterial()
    this.own.push(mat)
    for (const [R, base, amp, seed] of [[1150, 40, 110, 1], [900, 20, 70, 2]] as const) {
      const n = 240
      const pos: number[] = []
      const h: number[] = []
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2
        const k = Math.sin(a * 3 + seed) * 0.35 + Math.sin(a * 7.3 + seed * 2) * 0.25 + Math.sin(a * 17.1 + seed * 5) * 0.12 + Math.sin(a * 41 + seed) * 0.05
        // lower inland behind the camera, higher behind the far shore
        const far = 0.55 + 0.45 * Math.max(0, -Math.cos(a))
        const top = base + amp * far * (0.55 + k)
        const x = Math.sin(a) * R
        const z = -Math.cos(a) * R
        pos.push(x, -30, z, x, top, z)
        h.push(0, 1)
      }
      const idx: number[] = []
      for (let i = 0; i < n; i++) {
        const a = i * 2
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
      g.setAttribute('aH', new THREE.Float32BufferAttribute(h, 1))
      g.setIndex(idx)
      const m = new THREE.Mesh(g, mat)
      m.renderOrder = -8
      m.frustumCulled = false
      mat.side = THREE.DoubleSide
      this.root.add(m)
      this.own.push(g)
    }
  }

  /* ---------------- the skyline ---------------- */

  /** the city beyond the ring, near and across the bay; returns the water's reflection band of it */
  private skyline(signs: SignSpec[]) {
    const kit = this.kit
    const low = this.low
    const lights: { x: number; z: number; w: number; h: number; c: [number, number, number] }[] = []
    const winOf = (s: number): [number, number, number, number] => {
      const t = rnd(s * 3.1)
      const c = t < 0.55 ? [1.5, 1.05, 0.6] : t < 0.85 ? [0.85, 1.05, 1.5] : t < 0.93 ? [1.6, 0.6, 1.2] : [0.7, 1.5, 1.0]
      return [c[0], c[1], c[2], 0.3 + rnd(s * 5.7) * 0.45]
    }
    const trims: [number, number, number][] = [[2.6, 0.6, 1.6], [0.5, 1.6, 2.8], [0.4, 2.6, 1.2], [2.6, 1.9, 0.6]]
    const tower = (x: number, z: number, w: number, d: number, h: number, s: number, near: boolean) => {
      const win = winOf(s)
      const wall = new THREE.Color().setHSL(0.6 + rnd(s * 9) * 0.12, 0.25 + rnd(s * 4) * 0.2, 0.1 + rnd(s * 2) * 0.08)
      const look: PartLook = { color: wall, win, grid: [1.2 + rnd(s) * 0.6, 1.1 + rnd(s * 2) * 0.4, rnd(s * 8) < 0.45 ? 2 : rnd(s * 8) < 0.7 ? 3 : 1], ink: near ? 0.12 : 0 }
      const ry = Math.atan2(x, z) + (rnd(s * 6) - 0.5) * 0.3
      const trim = rnd(s * 12) < (near ? 0.25 : 0.4) ? trims[Math.floor(rnd(s * 13) * 4)] : null
      // a few set back in steps toward the top
      if (h > 30 && rnd(s * 14) < 0.5) {
        kit.part('box', place(x, h * 0.35, z, w, h * 0.7, d, ry), look)
        kit.part('box', place(x, h * 0.85, z, w * 0.72, h * 0.3, d * 0.72, ry), trim ? { ...look, trim: [...trim, 0.5] as [number, number, number, number] } : look)
      } else kit.part('box', place(x, h / 2, z, w, h, d, ry), trim ? { ...look, trim: [...trim, 0.5] as [number, number, number, number] } : look)
      if (h > 26 && rnd(s * 15) < 0.4) {
        kit.part('cyl', place(x, h + 3, z, 0.4, 6, 0.4, ry), { color: '#6a7080', ink: 0 })
        kit.lamp({ p: new THREE.Vector3(x, h + 6.2, z), color: new THREE.Color(3, 0.4, 0.5), size: 2.6, rate: 0.6 + rnd(s) * 0.4, phase: rnd(s * 2) })
      }
      lights.push({ x, z, w: Math.max(w, d), h, c: [win[0] * win[3], win[1] * win[3], win[2] * win[3]] })
    }
    // inland, behind the ring
    let s = 1
    const rings = low ? [48, 62, 80, 104] : [46, 56, 68, 82, 100, 124]
    for (const R of rings) {
      const n = Math.round((R * Math.PI * 2) / (low ? 15 : 11))
      for (let i = 0; i < n; i++) {
        s++
        const a = (i / n) * Math.PI * 2 + rnd(s) * 0.05
        const x = Math.sin(a) * (R + (rnd(s * 2) - 0.5) * 5)
        const z = Math.cos(a) * (R + (rnd(s * 2) - 0.5) * 5)
        if (z < SHORE_Z + 6) continue
        // an avenue of low buildings in front of the plaza, where the wide shots stand, so the inland city never
        // stands between them and the action
        const avenue = Math.abs(Math.atan2(x, z)) < 0.62 && R < 110
        const h = avenue ? 3 + rnd(s * 3) * 4 : 6 + rnd(s * 3) * (R < 60 ? 9 : R < 90 ? 15 : 24) + (R > 90 ? rnd(s * 4) * 14 : 0)
        tower(x, z, 5 + rnd(s * 5) * 5, 5 + rnd(s * 6) * 5, h, s, R < 70)
      }
    }
    // the near shore either side of the plaza, along the waterfront
    for (let i = 0; i < (low ? 8 : 14); i++) {
      s++
      const sx = i % 2 ? 1 : -1
      const x = sx * (40 + Math.floor(i / 2) * 11 + rnd(s) * 3)
      const z = SHORE_Z + 6 + rnd(s * 2) * 14
      tower(x, z, 6 + rnd(s * 3) * 4, 6 + rnd(s * 4) * 4, 7 + rnd(s * 5) * 12, s, true)
    }
    // the far shore: downtown, tallest left of centre
    const rows = low ? 4 : 6
    for (let row = 0; row < rows; row++) {
      const z = -215 - row * 32
      const n = low ? 26 : 40
      for (let i = 0; i < n; i++) {
        s++
        const x = -420 + (i / (n - 1)) * 840 + (rnd(s) - 0.5) * 14
        const centre = Math.exp(-(((x + 30) / 150) ** 2))
        const h = 10 + rnd(s * 2) * 18 + centre * (18 + rnd(s * 3) * 42) + row * 7
        tower(x, z + (rnd(s * 4) - 0.5) * 12, 9 + rnd(s * 5) * 9, 9 + rnd(s * 6) * 9, h, s, false)
      }
    }
    // landmarks: the BOJE tower with its sign, the needle and its pod
    const bx = 40
    const bz = -205
    kit.part('box', place(bx, 45, bz, 16, 90, 16), { color: '#1d2a40', win: [0.9, 1.1, 1.5, 0.6], grid: [1.6, 1.4, 2], trim: [0.4, 2.6, 1.2, 0.8], ink: 0 })
    kit.part('box', place(bx, 95, bz, 11, 10, 11), { color: '#1d2a40', win: [0.9, 1.1, 1.5, 0.5], grid: [1.6, 1.4, 2], trim: [0.4, 2.6, 1.2, 1.2], ink: 0 })
    kit.part('cyl', place(bx, 112, bz, 0.8, 24, 0.8), { color: '#7a8090', ink: 0 })
    kit.lamp({ p: new THREE.Vector3(bx, 124.5, bz), color: new THREE.Color(3, 0.4, 0.5), size: 5, rate: 0.7, phase: 0 })
    const boje = signs[0]
    kit.sign(place(bx, 82, bz + 8.2, 24, 24 / kit.aspect(boje), 1), boje, '#22d36f', 3.2)
    kit.sign(place(bx, 69, bz + 8.2, 13, 13 / kit.aspect(signs[1]), 1), signs[1], '#ffffff', 1.6)
    lights.push({ x: bx, z: bz, w: 16, h: 100, c: [0.5, 1.6, 0.9] })
    const nx = -95
    const nz = -240
    kit.part('cyl', place(nx, 50, nz, 5, 100, 5), { color: '#3a4458', ink: 0 })
    kit.part('cyl', place(nx, 84, nz, 22, 7, 22), { color: '#2a3248', win: [1.6, 0.8, 1.3, 0.8], grid: [1.2, 1.2, 2], trim: [2.6, 0.6, 1.6, 0.8], ink: 0 })
    kit.part('cone', place(nx, 90, nz, 22, 5, 22), { color: '#2a3248', ink: 0 })
    kit.part('cyl', place(nx, 108, nz, 0.9, 32, 0.9), { color: '#8a90a0', ink: 0 })
    kit.lamp({ p: new THREE.Vector3(nx, 124.5, nz), color: new THREE.Color(3, 0.4, 0.5), size: 5, rate: 0.5, phase: 0.5 })
    lights.push({ x: nx, z: nz, w: 22, h: 92, c: [1.2, 0.5, 1.0] })
    // rooftop signs across the bay, facing the plaza
    const roof: [number, number, number, number, string, number][] = [
      [-150, -208, 34, 14, '#ffd36b', 2], [-10, -210, 40, 13, '#ff4fa3', 3], [120, -206, 28, 12, '#4cc3ff', 4], [-240, -206, 24, 11, '#ff4fa3', 5],
      [210, -208, 26, 11, '#ffd36b', 6], [-62, -206, 22, 18, '#ff4fa3', 7], [82, -208, 20, 16, '#4cc3ff', 8], [290, -206, 22, 11, '#22d36f', 9],
    ]
    for (const [x, z, h, size, tint, si] of roof) {
      const spec = signs[si]
      const vert = !!spec.vertical
      const w = vert ? size * kit.aspect(spec) : size
      const hh = vert ? size : size / kit.aspect(spec)
      kit.part('box', place(x, h / 2, z - 6, 14, h, 12), { color: '#161c2c', win: winOf(x), grid: [1.4, 1.3, 1], ink: 0 })
      kit.sign(place(x, h + hh / 2 + 0.5, z, w, hh, 1), spec, tint, 2.6, si === 7 ? 0.4 : 0)
      lights.push({ x, z, w: w, h: h + hh, c: new THREE.Color(tint).multiplyScalar(1.4).toArray() as [number, number, number] })
    }
    this.bridge(lights)
    // the ring's buildings light the water too
    for (const b of BUILDINGS) lights.push({ x: b.x, z: b.z, w: b.w, h: b.h, c: b.kind === 'casino' || b.kind === 'neon' ? [1.6, 1.2, 0.6] : [0.7, 0.6, 0.5] })
    return reflectionBand(lights)
  }

  /** the suspension bridge across the mouth of the bay: towers, deck, and its cables strung with lights */
  private bridge(lights: { x: number; z: number; w: number; h: number; c: [number, number, number] }[]) {
    const kit = this.kit
    const A = new THREE.Vector3(118, 0, -24)
    const B = new THREE.Vector3(300, 0, -240)
    const dir = B.clone().sub(A)
    const len = dir.length()
    dir.normalize()
    const ry = Math.atan2(dir.x, dir.z)
    const side = new THREE.Vector3(dir.z, 0, -dir.x)
    const deckY = 11
    const mid = A.clone().add(B).multiplyScalar(0.5)
    kit.part('box', place(mid.x, deckY, mid.z, 7, 1.2, len, ry), { color: '#2a3040', trim: [1.6, 0.4, 0.4, 0.3], ink: 0 })
    const towers = [0.27, 0.73].map((u) => A.clone().addScaledVector(dir, len * u))
    const TH = 52
    for (const t of towers) {
      for (const sgn of [-1, 1]) kit.part('box', place(t.x + side.x * 3.6 * sgn, (TH + WATER_Y) / 2, t.z + side.z * 3.6 * sgn, 1.6, TH - WATER_Y, 1.6, ry), { color: '#7a3a3a', ink: 0 })
      kit.part('box', place(t.x, TH - 4, t.z, 9, 1.4, 1.6, ry), { color: '#7a3a3a', ink: 0 })
      kit.part('box', place(t.x, deckY - 6, t.z, 9, 1.2, 1.6, ry), { color: '#7a3a3a', ink: 0 })
      kit.lamp({ p: new THREE.Vector3(t.x, TH + 0.8, t.z), color: new THREE.Color(3, 0.4, 0.5), size: 3.5, rate: 0.6, phase: t.x })
      lights.push({ x: t.x, z: t.z, w: 9, h: TH, c: [0.9, 0.6, 0.4] })
    }
    // the main cables: from the anchors up over the towers, sagging between them, lit every few metres
    const n = this.low ? 70 : 130
    const cablePt = (u: number) => {
      const p = A.clone().addScaledVector(dir, len * u)
      const [u0, u1] = [0.27, 0.73]
      let y: number
      if (u < u0) y = deckY + (TH - deckY) * Math.pow(u / u0, 1.6)
      else if (u > u1) y = deckY + (TH - deckY) * Math.pow((1 - u) / (1 - u1), 1.6)
      else {
        const k = (u - u0) / (u1 - u0)
        y = deckY + 2 + (TH - deckY - 2) * (2 * k - 1) * (2 * k - 1)
      }
      return p.setY(y)
    }
    for (let i = 0; i <= n; i++) {
      const p = cablePt(i / n)
      for (const sgn of [-1, 1]) kit.lamp({ p: p.clone().addScaledVector(side, 3.6 * sgn), color: new THREE.Color(1.8, 1.5, 0.9), size: 1.5 })
    }
    for (let i = 0; i <= n / 2; i++) {
      const p = A.clone().addScaledVector(dir, (len * i) / (n / 2)).setY(deckY + 0.9)
      for (const sgn of [-1, 1]) kit.lamp({ p: p.clone().addScaledVector(side, 3 * sgn), color: new THREE.Color(sgn > 0 ? 2.2 : 2.4, sgn > 0 ? 0.5 : 1.8, sgn > 0 ? 0.4 : 1.0), size: 1.1 })
    }
  }

  /* ---------------- the waterfront ---------------- */

  private seawall() {
    const kit = this.kit
    // the wall dropping to the water, the promenade's rail and its lamps
    kit.part('box', place(0, (WATER_Y - 3) / 2, SHORE_Z - 0.3, 900, -WATER_Y + 3, 0.6), { color: '#3a3f4e', ink: 0.08 })
    kit.part('box', place(0, 0.06, SHORE_Z + 0.6, 900, 0.12, 1.6), { color: '#4a4f5e', ink: 0 })
    for (const sgn of [-1, 1]) kit.part('box', place(sgn * 110 + (sgn > 0 ? 11 : 0), 0.95, SHORE_Z + 0.25, 196, 0.12, 0.12), { color: '#9aa3ad', ink: 0.04 })
    const span = this.low ? 70 : 110
    for (let x = -span; x <= span; x += 3) {
      if (x > PIER.x - PIER.w / 2 - 1 && x < PIER.x + PIER.w / 2 + 1) continue
      kit.part('box', place(x, 0.5, SHORE_Z + 0.25, 0.1, 1, 0.1), { color: '#9aa3ad', ink: 0 })
    }
    for (let x = -span + 4; x <= span; x += 12) {
      if (Math.abs(x - PIER.x) < 4) continue
      kit.part('cyl', place(x, 1.7, SHORE_Z + 0.9, 0.16, 3.4, 0.16), { color: '#2a2f3c', ink: 0.04 })
      kit.lamp({ p: new THREE.Vector3(x, 3.5, SHORE_Z + 0.9), color: new THREE.Color(2.2, 1.6, 0.9), size: 1.3 })
    }
  }

  private pier() {
    const kit = this.kit
    const { x, z0, z1, w } = PIER
    const len = z0 - z1
    kit.part('box', place(x, -0.15, (z0 + z1) / 2 - 2, w, 0.5, len + 4), { color: '#5a4a3c', ink: 0.08 })
    for (let z = z0 - 2; z >= z1 - 3; z -= 4)
      for (const dx of [-1.8, 1.8]) kit.part('cyl', place(x + dx, (WATER_Y - 3 - 0.4) / 2, z, 0.5, 3 - WATER_Y, 0.5), { color: '#3a3028', ink: 0.05 })
    for (let z = z0 - 3; z >= z1 - 2; z -= 6)
      for (const dx of [-2.1, 2.1]) {
        kit.part('cyl', place(x + dx, 1.2, z, 0.12, 2.4, 0.12), { color: '#2a2f3c', ink: 0.03 })
        kit.lamp({ p: new THREE.Vector3(x + dx, 2.5, z), color: new THREE.Color(2.4, 1.7, 0.9), size: 1.0 })
      }
    // a ticket booth at the wheel
    kit.part('box', place(x - 1, 1.1, z1 + 2, 1.8, 2.2, 1.6), { color: '#8a2f6a', win: [1.6, 1.2, 0.7, 1], grid: [1, 1, 4], ink: 0.06 })
    // the Ferris wheel: its frame turns as one mesh; the cabins stay upright; its lights chase round the rim
    const vk = new VKit(INK, 0.07)
    const R = WHEEL.r
    vk.add(new THREE.TorusGeometry(R, 0.22, 8, 64), '#e8e3d8')
    vk.add(new THREE.TorusGeometry(R * 0.86, 0.12, 6, 64), '#ff4fa3', undefined, 0.04)
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2
      vk.add(new THREE.BoxGeometry(0.14, R, 0.14), '#d8d2c4', T([Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0], [0, 0, a - Math.PI / 2]), 0.03)
    }
    vk.add(new THREE.CylinderGeometry(0.6, 0.6, 1.4, 16), '#c9a227', T([0, 0, 0], [Math.PI / 2, 0, 0]))
    const mat = vkMaterial(this.kit.ramp)
    const frame = vk.mesh('wheel', mat)
    this.wheel = new THREE.Group()
    this.wheel.position.set(WHEEL.x, WHEEL.y, WHEEL.z)
    this.wheel.add(frame)
    const legs = new VKit(INK, 0.07)
    for (const dz of [-1.1, 1.1])
      for (const dx of [-1, 1]) {
        const g = new THREE.BoxGeometry(0.35, WHEEL.y + 0.4, 0.35)
        legs.add(g, '#9aa3ad', T([WHEEL.x + dx * 2.2, (WHEEL.y + 0.4) / 2 - 0.2, WHEEL.z + dz], [0, 0, -dx * 0.24]))
      }
    const legMesh = legs.mesh('wheel-legs', mat)
    const cg = new THREE.BoxGeometry(1.1, 1.0, 0.9)
    const cm = new THREE.MeshToonMaterial({ gradientMap: this.kit.ramp })
    this.cabins = new THREE.InstancedMesh(cg, cm, 12)
    this.cabins.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12 * 3), 3)
    const cc = ['#ff4fa3', '#4cc3ff', '#ffd36b', '#22d36f']
    for (let k = 0; k < 12; k++) this.cabins.setColorAt(k, new THREE.Color(cc[k % 4]))
    this.cabins.frustumCulled = false
    // the rim's lights
    const n = this.low ? 24 : 48
    const lp = new Float32Array(n * 3)
    const lc = new Float32Array(n * 3)
    const ll = new Float32Array(n * 3)
    const colors = [new THREE.Color(2.6, 0.7, 1.6), new THREE.Color(0.6, 1.8, 2.8), new THREE.Color(2.6, 2.0, 0.7)]
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2
      lp.set([Math.cos(a) * R, Math.sin(a) * R, 0.3], k * 3)
      const c = colors[k % 3]
      lc.set([c.r, c.g, c.b], k * 3)
      ll.set([0.9, 0.7, (k % 3) / 3], k * 3)
    }
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3))
    lg.setAttribute('aColor', new THREE.BufferAttribute(lc, 3))
    lg.setAttribute('aLamp', new THREE.BufferAttribute(ll, 3))
    lg.setAttribute('aOn', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1))
    this.wheelLights = new THREE.Points(lg)
    this.wheelLights.frustumCulled = false
    this.wheelLights.renderOrder = 5
    this.wheel.add(this.wheelLights)
    this.root.add(this.wheel, legMesh, this.cabins)
    this.own.push(frame.geometry, legMesh.geometry, mat, cg, cm, lg)
  }

  private lighthouse() {
    const { x, z } = LIGHTHOUSE
    const vk = new VKit(INK, 0.08)
    // the rock it stands on, a striped tower, the gallery and the lantern's roof
    const rock = new THREE.IcosahedronGeometry(1, 1)
    const p = rock.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < p.count; i++) {
      const k = 1 + (rnd(Math.round(p.getX(i) * 50) + Math.round(p.getY(i) * 70) * 3 + Math.round(p.getZ(i) * 90) * 7) - 0.5) * 0.35
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k)
    }
    rock.deleteAttribute('normal')
    rock.computeVertexNormals()
    vk.add(rock, '#3a3d4a', T([x, WATER_Y - 0.6, z], [0, 0.4, 0], [6, 3.4, 5]))
    for (let k = 0; k < 4; k++) {
      const y0 = 1.6 + k * 2.8
      const r0 = 1.6 - k * 0.14
      vk.add(new THREE.CylinderGeometry(r0 - 0.14, r0, 2.8, 18), k % 2 ? '#d0482f' : '#efe9dc', T([x, y0 + 1.4, z]))
    }
    vk.add(new THREE.CylinderGeometry(1.5, 1.5, 0.25, 18), '#2a2f3c', T([x, 12.95, z]))
    vk.add(new THREE.ConeGeometry(1.15, 1.3, 18), '#d0482f', T([x, 15.1, z]))
    const mat = vkMaterial(this.kit.ramp)
    const m = vk.mesh('lighthouse', mat)
    this.root.add(m)
    this.own.push(m.geometry, mat)
  }

  private lighthouseLamp() {
    const g = new THREE.CylinderGeometry(0.9, 0.9, 1.3, 14)
    const m = new THREE.Mesh(g, this.lantern)
    m.position.set(LIGHTHOUSE.x, 13.75, LIGHTHOUSE.z)
    this.root.add(m)
    this.own.push(g)
  }

  /* ---------------- boats ---------------- */

  /** a few boats crossing the bay far out, their cabins lit, with running lights */
  private harbour() {
    const mat = vkMaterial(this.kit.ramp)
    this.own.push(mat)
    const lights = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.2, 1.4) })
    const red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.5, 0.4, 0.4) })
    const green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 3.5, 0.7) })
    const bulb = new THREE.SphereGeometry(0.22, 6, 4)
    this.own.push(lights, red, green, bulb)
    const kinds: [number, number, string, string][] = [[9, 3, '#e8e3d8', '#2a3f6a'], [5, 2.2, '#c0392b', '#eceae4'], [14, 4, '#2a3040', '#ffd36b']]
    kinds.forEach(([len, wid, hull, cabin], i) => {
      const vk = new VKit(INK, 0.06)
      vk.add(new THREE.BoxGeometry(wid, 1.1, len), hull, T([0, 0.2, 0]))
      vk.add(new THREE.ConeGeometry(wid * 0.72, 2.2, 4), hull, T([0, 0.2, len / 2 + 0.9], [Math.PI / 2, Math.PI / 4, 0], [1, 1, 0.5]))
      vk.add(new THREE.BoxGeometry(wid * 0.75, 1.3, len * 0.42), cabin, T([0, 1.35, -len * 0.08]))
      // its windows, lit
      vk.add(new THREE.BoxGeometry(wid * 0.77, 0.38, len * 0.36), new THREE.Color(2.2, 1.7, 1.0), T([0, 1.45, -len * 0.08]), 0, true)
      const m = vk.mesh(`boat-${i}`, mat)
      const g = new THREE.Group()
      g.add(m)
      for (const [mm, x, z] of [[red, -wid / 2, len * 0.2], [green, wid / 2, len * 0.2], [lights, 0, -len * 0.35]] as const) {
        const b = new THREE.Mesh(bulb, mm)
        b.position.set(x, mm === lights ? 2.6 : 0.9, z)
        g.add(b)
      }
      this.root.add(g)
      this.own.push(m.geometry)
      this.boats.push({ g, z: [-78, -112, -140][i], speed: [3.2, -4.4, 2.1][i], x0: [-40, 60, 120][i], bob: i * 1.7 })
    })
  }

  /* ---------------- the helicopters ---------------- */

  private helicopters() {
    const mat = vkMaterial(this.kit.ramp)
    this.own.push(mat)
    const liveries: [string, string][] = [['#eceae4', '#d0482f'], ['#2a3f6a', '#ffd36b']]
    liveries.forEach(([body, stripe], i) => {
      const vk = new VKit(INK, 0.05)
      vk.add(new THREE.SphereGeometry(1, 16, 12), body, T([0, 0, 0], [0, 0, 0], [0.95, 0.85, 1.7]))
      vk.add(new THREE.SphereGeometry(1, 14, 10), '#16243a', T([0, 0.15, 0.95], [0, 0, 0], [0.75, 0.6, 0.85]), 0.03)
      vk.add(new THREE.BoxGeometry(1.95, 0.22, 2.2), stripe, T([0, -0.25, 0]), 0)
      vk.add(new THREE.CylinderGeometry(0.16, 0.24, 3.4, 8), body, T([0, 0.25, -2.9], [Math.PI / 2, 0, 0]))
      vk.add(new THREE.BoxGeometry(0.12, 1.0, 0.7), stripe, T([0, 0.65, -4.4]))
      for (const sx of [-0.75, 0.75]) vk.add(new THREE.BoxGeometry(0.1, 0.1, 2.6), '#3a3f4a', T([sx, -1.05, 0.1]), 0.03)
      vk.add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 6), '#3a3f4a', T([0, 0.95, 0]))
      const body3 = vk.mesh(`heli-${i}`, mat)
      const rotor = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.05, 0.28), new THREE.MeshBasicMaterial({ color: '#1a1d26' }))
      rotor.position.y = 1.22
      const r2 = rotor.clone()
      r2.rotation.y = Math.PI / 2
      rotor.add(r2)
      r2.position.set(0, 0, 0)
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.5, 0.14), rotor.material)
      tail.position.set(0.12, 0.7, -4.5)
      const red = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.3, 0.3) }))
      red.position.set(-0.95, -0.2, 0.2)
      const green = new THREE.Mesh(red.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 4, 0.6) }))
      green.position.set(0.95, -0.2, 0.2)
      const strobe = new THREE.Mesh(red.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 5, 5) }))
      strobe.position.set(0, 0.9, -4.5)
      const g = new THREE.Group()
      g.add(body3, rotor, tail, red, green, strobe)
      this.root.add(g)
      this.own.push(body3.geometry, rotor.geometry, rotor.material as THREE.Material, tail.geometry, red.geometry, red.material as THREE.Material, green.material as THREE.Material, strobe.material as THREE.Material)
      this.helis.push({ g, rotor, tailRotor: tail, blink: [strobe, red], r: i ? 50 : 40, y: i ? 37 : 31, w: i ? -0.085 : 0.11, ph: i ? 2.4 : 0, pos: new THREE.Vector3() })
    })
  }

  /* ---------------- every frame ---------------- */

  /**
   * The city's life at a moment: `time` the ambient clock (seconds), `focus` where the fight is (the helicopters'
   * spotlights), `spots` the two fighters' spotlights (where and how bright), `main` a Main Event night, `cross` the
   * searchlights crossing over the plaza (the walkout), `calm` (reduced motion) holds the ambient motion still.
   */
  update(time: number, o: { focus: THREE.Vector3; spots: { p: THREE.Vector3; k: number; color: THREE.Color }[]; main: boolean; cross: number; calm: boolean }) {
    const t = o.calm ? 0 : time
    this.sky.uniforms.uTime.value = t
    this.water.uniforms.uTime.value = t
    this.ground.uniforms.uTime.value = t
    this.kit.matU.uTime.value = t
    this.kit.signMat.uniforms.uTime.value = t
    this.kit.lampMat.uniforms.uTime.value = t
    // the wheel turns; its cabins hang straight
    this.wheel.rotation.z = t * 0.12
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2 + t * 0.12
      this.m4.makeTranslation(WHEEL.x + Math.cos(a) * WHEEL.r, WHEEL.y + Math.sin(a) * WHEEL.r - 0.75, WHEEL.z + 0.6)
      this.cabins.setMatrixAt(k, this.m4)
    }
    this.cabins.instanceMatrix.needsUpdate = true
    // the boats, crossing the bay and coming round again
    for (const b of this.boats) {
      const span = 360
      const x = ((((b.x0 + t * b.speed + span / 2) % span) + span) % span) - span / 2
      b.g.position.set(x, WATER_Y + 0.25 + Math.sin(t * 1.3 + b.bob) * 0.12, b.z)
      b.g.rotation.set(Math.sin(t * 0.9 + b.bob) * 0.03, b.speed > 0 ? Math.PI / 2 : -Math.PI / 2, Math.sin(t * 1.1 + b.bob) * 0.04)
    }
    // the shafts
    const A = this.shaftAttr.array as Float32Array
    const shaft = (i: number, from: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, c: THREE.Color, k: number, fall = 1.2) => {
      this.q.setFromUnitVectors(this.down, dir)
      this.m4.compose(this.v.copy(from), this.q, this.v2.set(rad, len, rad))
      this.shafts.setMatrixAt(i, this.m4)
      A.set([c.r * k, c.g * k, c.b * k, fall], i * 4)
    }
    const searchCol = o.main ? City.SEARCH_GOLD : City.SEARCH_BLUE
    City.BASES.forEach(([x, y, z], i) => {
      const from = this.a3.set(x, y, z)
      // sweeping the sky, or (the walkout) crossing over the plaza
      const a = Math.sin(t * (0.13 + i * 0.023) + i * 1.7) * 0.6 + (i % 2 ? 0.3 : -0.3)
      const tilt = 0.32 + 0.16 * Math.sin(t * 0.09 + i)
      const sweep = this.b3.set(Math.sin(a) * Math.sin(tilt), Math.cos(tilt), -Math.cos(a) * Math.sin(tilt) * (z > 0 ? -1 : 1))
      const over = this.c3.set(Math.sin(t * 0.6 + i) * 18, 95, Math.cos(t * 0.5 + i) * 12).sub(from).normalize()
      shaft(i, from, sweep.lerp(over, o.cross).normalize(), 320, 15, searchCol, o.main ? 0.2 : 0.13, 1.4)
    })
    // the lighthouse's two beams, turning
    const la = t * 0.7
    for (let k = 0; k < 2; k++) {
      const d = this.b3.set(Math.cos(la + k * Math.PI), 0.025, Math.sin(la + k * Math.PI)).normalize()
      shaft(S_LIGHT + k, City.LAMP_AT, d, 90, 6, City.LIGHTHOUSE_C, 0.09, 1.6)
    }
    // the fighters' spotlights, from high above
    o.spots.forEach((sp, k) => {
      const from = this.a3.set(sp.p.x * 0.6, 46, sp.p.z * 0.6 + 14)
      const d = this.b3.copy(sp.p).sub(from)
      const len = d.length() + 1
      // the beam itself only shows when the spotlight is turned right up (the walkout, the winner)
      const lit = Math.max(0, sp.k - 0.5) * 2
      shaft(S_SPOT + k, from, d.normalize(), len, 7.5, sp.color, 0.1 * lit * lit, 0.6)
    })
    // the helicopters circle, banking, their spotlights on the fight (and their pools of light on the plaza)
    const g = this.ground.uniforms
    this.helis.forEach((h, k) => {
      const a = h.ph + t * h.w
      h.pos.set(Math.cos(a) * h.r, h.y + Math.sin(t * 0.4 + k) * 1.5, Math.sin(a) * h.r * 0.8 + 6)
      h.g.position.copy(h.pos)
      const tx = -Math.sin(a) * Math.sign(h.w)
      const tz = Math.cos(a) * Math.sign(h.w) * 0.8
      h.g.rotation.set(0.12, Math.atan2(tx, tz), -0.22 * Math.sign(h.w), 'YXZ')
      h.rotor.rotation.y = time * 31
      h.tailRotor.rotation.x = time * 40
      h.blink[0].visible = (time * 1.1 + k * 0.4) % 1 < 0.08
      h.blink[1].visible = (time * 0.9 + k * 0.3) % 1 < 0.5
      const aimAt = this.c3.copy(o.focus)
      aimAt.x += Math.sin(time * 0.7 + k) * 3
      aimAt.z += Math.cos(time * 0.6 + k) * 3
      ;(g.uPool.value as THREE.Vector4[])[4 + k].set(aimAt.x, aimAt.z, 6.5, 0.35)
      ;(g.uPoolCol.value as THREE.Color[])[4 + k].setRGB(0.32, 0.31, 0.28)
      const from = this.a3.copy(h.pos)
      from.y -= 1
      const d = this.b3.copy(aimAt).sub(from)
      const len = d.length()
      shaft(S_HELI + k, from, d.normalize(), len, 4.2, City.HELI_C, 0.07, 0.9)
    })
    this.shafts.instanceMatrix.needsUpdate = true
    this.shaftAttr.needsUpdate = true
    // the plaza stops reflecting the signs of buildings that have fallen
    this.glints.forEach((gl, i) => {
      const fallen = gl.building >= 0 && this.ring.ruins[gl.building].shown >= 0
      ;(g.uGlintCol.value as THREE.Color[])[i].copy(gl.col).multiplyScalar(fallen ? 0 : 1)
    })
  }

  /** where the helicopters are (the camera keeps clear) */
  heliPos(k: number) {
    return this.helis[k]?.pos
  }

  dispose() {
    for (const o of this.own) o.dispose()
    this.shafts.dispose()
    this.cabins.dispose()
    // the sprites' shared quad
    new THREE.Sprite().geometry.dispose()
  }
}

/* ------------------------------------------------------------------ */

/** the band of city light round the horizon for the water: each building's lit windows spread over the angle it
 *  takes up as seen from the middle of the bay (rgb, a third of its strength), and how high it stands (a, half) */
function reflectionBand(lights: { x: number; z: number; w: number; h: number; c: [number, number, number] }[]) {
  const N = 1024
  const rgb = new Float32Array(N * 3)
  const top = new Float32Array(N)
  const O = { x: 0, z: -30 }
  for (const l of lights) {
    const dx = l.x - O.x
    const dz = l.z - O.z
    const dist = Math.hypot(dx, dz)
    if (dist < 4) continue
    const az = Math.atan2(dx, -dz)
    const half = Math.atan2(l.w / 2, dist)
    const el = l.h / dist
    const k = Math.min(1.5, 30 / Math.max(30, dist * 0.35))
    const i0 = Math.floor(((az - half) / (Math.PI * 2) + 0.5) * N)
    const i1 = Math.ceil(((az + half) / (Math.PI * 2) + 0.5) * N)
    for (let i = i0; i <= i1; i++) {
      const j = ((i % N) + N) % N
      rgb[j * 3] += l.c[0] * k * 0.5
      rgb[j * 3 + 1] += l.c[1] * k * 0.5
      rgb[j * 3 + 2] += l.c[2] * k * 0.5
      top[j] = Math.max(top[j], el)
    }
  }
  const data = new Uint8Array(N * 4)
  for (let i = 0; i < N; i++) {
    // a little blur so neighbouring towers run together
    let r = 0
    let g = 0
    let b = 0
    for (let d = -2; d <= 2; d++) {
      const j = (((i + d) % N) + N) % N
      const w = d === 0 ? 0.4 : Math.abs(d) === 1 ? 0.2 : 0.1
      r += rgb[j * 3] * w
      g += rgb[j * 3 + 1] * w
      b += rgb[j * 3 + 2] * w
    }
    data[i * 4] = Math.min(255, Math.round((r / 3) * 255))
    data[i * 4 + 1] = Math.min(255, Math.round((g / 3) * 255))
    data[i * 4 + 2] = Math.min(255, Math.round((b / 3) * 255))
    data[i * 4 + 3] = Math.min(255, Math.round(Math.min(1, top[i] * 2) * 255))
  }
  const tex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat)
  tex.wrapS = THREE.RepeatWrapping
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** the emblem painted in the middle of the plaza: a ring, the casino's name and its B */
function logoTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 512
  const g = c.getContext('2d')!
  g.translate(256, 256)
  g.strokeStyle = '#22d36f'
  g.lineWidth = 16
  g.beginPath()
  g.arc(0, 0, 236, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 5
  g.beginPath()
  g.arc(0, 0, 208, 0, Math.PI * 2)
  g.stroke()
  g.fillStyle = '#ffffff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.font = '900 230px Manrope, system-ui, sans-serif'
  g.fillText('B', 0, 6)
  g.font = '900 44px Manrope, system-ui, sans-serif'
  g.fillStyle = '#22d36f'
  g.fillText('NEON BAY', 0, -160)
  g.fillText('KAIJU CLASH', 0, 164)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 4
  return tex
}

