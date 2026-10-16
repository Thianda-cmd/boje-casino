import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { T, VKit, type P3 } from '../../lib/three/toon'
import { INK, feltMaterial, fillerGeometry, FILLER_COLORS, type FillerKind, type FillerSpot } from './models'
import { PRIZES, type PrizeId } from './rules'

/*
  The Lucky Claw cabinet, built in code in the same toon style as the plushies: a pink cabinet with a glass box on top
  of the prize door and the control deck, the marquee sign above it ringed with bulbs, the gantry and the claw inside,
  and the heap of plushies with the eight prizes on top. World units: the glass box is 5 wide, 3 deep and 3.8 tall,
  its floor at y = 0; a plushie stands about an unit tall. The camera looks at the front (+z), a little from above.
*/

/** the inside of the glass box */
export const BOX = { x: 2.5, back: -1.5, front: 1.5, ceil: 3.8 }
/** the prize chute: an open box of clear acrylic in the front left corner, its rim this high */
export const CHUTE = { x0: -2.5, x1: -1.42, z0: 0.38, z1: 1.5, rim: 0.9 }
export const CHUTE_C = { x: (CHUTE.x0 + CHUTE.x1) / 2, z: (CHUTE.z0 + CHUTE.z1) / 2 }
/** the lower cabinet's front face, the floor of the arcade, and where the prize door is */
export const FACE_Z = 1.76
export const GROUND = -1.85
export const FLAP = { x: CHUTE_C.x, y: -1.1, w: 0.98, h: 0.68 }
/** the coin door's slot */
export const COIN = { x: 1.55, y: -0.92 }
/** the claw is modelled small and drawn this much bigger */
export const CLAW_S = 1.2
/** the gantry: the carriage runs at this height, the claw hangs from this pivot, and its hub parks this high */
export const RAIL_Y = 3.58
export const PIVOT_Y = 3.46
export const HOME_Y = 2.98

/** the top of the heap at (x, z): it slopes up towards the back and a little towards the side walls */
export function heapY(x: number, z: number) {
  const t = Math.min(1, Math.max(0, (z - 1.0) / -2.4))
  const back = t * t * (3 - 2 * t)
  return 0.3 + 0.74 * back + 0.08 * (x / BOX.x) ** 2
}
export const inChute = (x: number, z: number, m = 0) => x < CHUTE.x1 + m && z > CHUTE.z0 - m

/** the eight prize spots on top of the heap (x, z): four up the back of the pile, four in front, staggered */
export const SLOTS: Record<PrizeId, [number, number]> = {
  bear: [-0.88, 0.58],
  bunny: [0.1, 0.62],
  frog: [1.08, 0.58],
  penguin: [2.02, 0.5],
  cat: [-1.86, -0.92],
  unicorn: [-0.6, -1.0],
  octopus: [0.66, -0.98],
  dino: [1.88, -0.9],
}
export const slotPos = (id: PrizeId) => {
  const [x, z] = SLOTS[id]
  return new THREE.Vector3(x, heapY(x, z) - 0.05, z)
}
/** the loose plushie beside each prize (the one a "neighbour" grab closes on), as an offset from the prize */
export const NEIGHBOUR: Record<PrizeId, [number, number]> = {
  bear: [0.46, 0.5],
  bunny: [0.5, 0.48],
  frog: [0.46, 0.5],
  penguin: [-0.3, 0.6],
  cat: [0.62, 0.55],
  unicorn: [0.62, 0.6],
  octopus: [0.62, 0.6],
  dino: [-0.62, 0.62],
}

/* ------------------------------------------------------------------ */
/*  Small kit                                                           */
/* ------------------------------------------------------------------ */

const OUT = 0.026
const box = (w: number, h: number, d: number, r = 0.06, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
const cyl = (r0: number, r1: number, h: number, seg = 24) => new THREE.CylinderGeometry(r0, r1, h, seg, 1)
const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)

/** a rounded cylinder (a bevelled lathe), smooth all round so its outline closes */
function puck(r: number, h: number, bevel = 0.02, seg = 28) {
  const b = Math.min(bevel, r * 0.5, h * 0.5)
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -h / 2)]
  for (let i = 0; i <= 4; i++) {
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2)
    pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, -h / 2 + b + Math.sin(a) * b))
  }
  for (let i = 0; i <= 4; i++) {
    const a = (i / 4) * (Math.PI / 2)
    pts.push(new THREE.Vector2(r - b + Math.cos(a) * b, h / 2 - b + Math.sin(a) * b))
  }
  pts.push(new THREE.Vector2(0, h / 2))
  return new THREE.LatheGeometry(pts, seg)
}

/** a matrix that stands a +y shape on the segment a-b */
function aim(a: THREE.Vector3, b: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1))
}
function rod(k: VKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation, ink = OUT * 0.6, seg = 10) {
  const A = V(...a)
  const B = V(...b)
  k.add(new THREE.CapsuleGeometry(r, A.distanceTo(B), 3, seg), color, aim(A, B), ink)
}

/* ------------------------------------------------------------------ */
/*  Canvas art                                                          */
/* ------------------------------------------------------------------ */

const FONT = 'Manrope, ui-rounded, system-ui, sans-serif'

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')!] as const
}
function tex(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2
    const rr = i % 2 ? r * 0.46 : r
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  g.closePath()
}
function heart(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.beginPath()
  g.moveTo(x, y + s * 0.35)
  g.bezierCurveTo(x - s * 1.1, y - s * 0.35, x - s * 0.45, y - s * 1.05, x, y - s * 0.45)
  g.bezierCurveTo(x + s * 0.45, y - s * 1.05, x + s * 1.1, y - s * 0.35, x, y + s * 0.35)
  g.closePath()
}

/** the marquee: "LUCKY CLAW" in fat candy letters on a starry purple board */
export function marqueeTexture() {
  const [c, g] = canvas(1024, 256)
  const bg = g.createLinearGradient(0, 0, 0, 256)
  bg.addColorStop(0, '#4b22b0')
  bg.addColorStop(1, '#2a0f72')
  g.fillStyle = bg
  g.fillRect(0, 0, 1024, 256)
  // a burst of rays behind the words
  g.save()
  g.translate(512, 150)
  for (let i = 0; i < 24; i++) {
    g.rotate((Math.PI * 2) / 24)
    g.fillStyle = i % 2 ? 'rgba(255,111,174,0.16)' : 'rgba(255,207,77,0.1)'
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(700, -60)
    g.lineTo(700, 60)
    g.closePath()
    g.fill()
  }
  g.restore()
  for (const [x, y, r] of [[60, 60, 16], [960, 70, 18], [110, 200, 11], [920, 196, 12], [200, 46, 8], [830, 40, 9]] as const) {
    star(g, x, y, r, 0.2)
    g.fillStyle = '#ffe36b'
    g.fill()
  }
  const text = 'LUCKY CLAW'
  let size = 150
  g.font = `800 ${size}px ${FONT}`
  while (g.measureText(text).width > 860 && size > 60) g.font = `800 ${(size -= 4)}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const y = 136
  // a deep drop, the ink outline, then a candy gradient and a shine line
  g.fillStyle = '#1d0f30'
  g.lineWidth = 34
  g.strokeStyle = '#1d0f30'
  g.strokeText(text, 512, y + 12)
  g.fillText(text, 512, y + 12)
  g.lineWidth = 24
  g.strokeText(text, 512, y)
  const fill = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.45)
  fill.addColorStop(0, '#fff6b8')
  fill.addColorStop(0.42, '#ffcf3a')
  fill.addColorStop(0.43, '#ff9f2e')
  fill.addColorStop(1, '#ff5f9e')
  g.fillStyle = fill
  g.fillText(text, 512, y)
  // a shine across the top of the letters only: the words again, clipped to a thin band
  g.save()
  g.beginPath()
  g.rect(0, y - size * 0.42, 1024, size * 0.13)
  g.clip()
  g.fillStyle = 'rgba(255,255,255,0.45)'
  g.fillText(text, 512, y)
  g.restore()
  return tex(c)
}

/** the back wall inside the box: deep blue-violet felt with a scatter of stars and hearts (it tiles) */
export function wallTexture() {
  const [c, g] = canvas(512, 512)
  g.fillStyle = '#4b36b8'
  g.fillRect(0, 0, 512, 512)
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 26; i++) {
    const x = rnd() * 512
    const y = rnd() * 512
    const s = 10 + rnd() * 16
    for (const dx of [-512, 0, 512])
      for (const dy of [-512, 0, 512]) {
        if (i % 2) star(g, x + dx, y + dy, s, rnd() * 0)
        else heart(g, x + dx, y + dy, s * 0.8)
        g.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.22)' : i % 3 === 1 ? 'rgba(255,216,107,0.45)' : 'rgba(255,143,200,0.42)'
        g.fill()
      }
  }
  const t = tex(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}

/** light streaking across the glass */
export function glassTexture() {
  const [c, g] = canvas(256, 512)
  g.clearRect(0, 0, 256, 512)
  const streak = (x: number, w: number, a: number) => {
    const grad = g.createLinearGradient(x - w, 0, x + w, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.save()
    g.translate(0, 256)
    g.transform(1, 0, -0.55, 1, 0, 0)
    g.fillStyle = grad
    g.fillRect(x - w, -400, w * 2, 800)
    g.restore()
  }
  streak(34, 20, 0.5)
  streak(64, 7, 0.4)
  streak(236, 14, 0.28)
  return tex(c)
}

/** the sticker in the chute: a yellow arrow and PRIZE */
export function chuteTexture() {
  const [c, g] = canvas(256, 128)
  g.clearRect(0, 0, 256, 128)
  g.fillStyle = '#ffe36b'
  g.strokeStyle = '#1d0f30'
  g.lineWidth = 8
  g.lineJoin = 'round'
  g.beginPath()
  g.roundRect(6, 6, 244, 116, 28)
  g.fill()
  g.stroke()
  g.font = `800 50px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#1d0f30'
  g.fillText('PRIZE', 108, 66)
  g.beginPath()
  g.moveTo(196, 40)
  g.lineTo(226, 40)
  g.lineTo(226, 62)
  g.lineTo(240, 62)
  g.lineTo(211, 96)
  g.lineTo(182, 62)
  g.lineTo(196, 62)
  g.closePath()
  g.fillStyle = '#ff4f9e'
  g.fill()
  g.lineWidth = 5
  g.stroke()
  return tex(c)
}

/** the prize door: smoky acrylic with PRIZE in white */
export function flapTexture() {
  const [c, g] = canvas(256, 192)
  g.fillStyle = 'rgba(40,16,70,0.78)'
  g.fillRect(0, 0, 256, 192)
  const sh = g.createLinearGradient(0, 0, 256, 192)
  sh.addColorStop(0, 'rgba(255,255,255,0.22)')
  sh.addColorStop(0.35, 'rgba(255,255,255,0)')
  g.fillStyle = sh
  g.fillRect(0, 0, 256, 192)
  g.font = `800 54px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 10
  g.strokeStyle = '#1d0f30'
  g.strokeText('PRIZE', 128, 92)
  g.fillStyle = '#ffe36b'
  g.fillText('PRIZE', 128, 92)
  // a push arrow
  g.beginPath()
  g.moveTo(108, 132)
  g.lineTo(148, 132)
  g.lineTo(128, 158)
  g.closePath()
  g.fillStyle = '#ff6fae'
  g.fill()
  return tex(c)
}

/** the coin door's label: a glowing INSERT COIN */
export function coinTexture() {
  const [c, g] = canvas(256, 96)
  g.fillStyle = '#1d0f30'
  g.beginPath()
  g.roundRect(4, 4, 248, 88, 22)
  g.fill()
  g.font = `800 34px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffb02e'
  g.fillText('INSERT COIN', 128, 50)
  return tex(c)
}

/* ------------------------------------------------------------------ */
/*  The claw                                                            */
/* ------------------------------------------------------------------ */

export const PRONGS = 3
/** where a prong's pivot sits on the hub, and how long it is from pivot to tip */
export const PRONG_R = 0.15
export const PRONG_Y = -0.07
export const PRONG_L = 0.58
/** the angle a prong swings out to when open, and in to when shut on nothing */
export const OPEN = 0.62
export const SHUT = -0.2

export interface ClawRig {
  /** swings about the carriage: the cable and the claw hang from it */
  swing: THREE.Group
  cable: THREE.Mesh
  /** the hub, at the cable's end; the held plushie hangs from `hold` */
  hub: THREE.Group
  hold: THREE.Group
  prongs: THREE.Group[]
}

const CHROME = '#d9e2f2'
const GOLD = '#ffcf4d'

export function buildClaw(mat: THREE.Material): ClawRig {
  const swing = new THREE.Group()
  swing.name = 'swing'
  const ck = new VKit(INK)
  ck.add(cyl(0.022, 0.022, 1, 8), '#4b4f63', undefined, 0.012)
  const cable = ck.mesh('cable', mat)
  cable.geometry.translate(0, -0.5, 0)
  swing.add(cable)

  const hub = new THREE.Group()
  hub.name = 'hub'
  const hk = new VKit(INK)
  hk.add(puck(0.18, 0.2, 0.05), GOLD, undefined, 0.02)
  hk.add(puck(0.185, 0.06, 0.02), '#ff5f9e', T([0, -0.02, 0]), 0.012)
  hk.add(cyl(0.05, 0.1, 0.12, 16), GOLD, T([0, 0.15, 0]), 0.016)
  hk.add(new THREE.SphereGeometry(0.045, 12, 8), CHROME, T([0, 0.22, 0]), 0.012)
  hk.add(new THREE.SphereGeometry(0.07, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), '#b5bfd4', T([0, -0.095, 0]), 0.014)
  // little rivets round the band
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    hk.add(new THREE.SphereGeometry(0.014, 6, 4), C('#ffffff', 1.2), T([Math.sin(a) * 0.188, -0.02, Math.cos(a) * 0.188]), 0, true)
  }
  hub.add(hk.mesh('hubMesh', mat))

  const prongs: THREE.Group[] = []
  // one prong, built along +x outwards and down from its pivot: an upper bar, a knuckle and a hooked finger
  const pk = new VKit(INK)
  const knee = V(0.15, -0.27, 0)
  const tip = V(0.0, -PRONG_L, 0)
  rod(pk, [0, 0, 0], [knee.x, knee.y, 0], 0.032, CHROME, 0.014)
  pk.add(new THREE.SphereGeometry(0.048, 12, 8), GOLD, T([knee.x, knee.y, 0]), 0.014)
  rod(pk, [knee.x, knee.y, 0], [0.035, -0.5, 0], 0.03, CHROME, 0.014)
  // the hook at the end, curling in
  const hook = new THREE.CatmullRomCurve3([V(0.035, -0.5, 0), V(0.012, -0.56, 0), V(-0.035, -0.585, 0)])
  pk.add(new THREE.TubeGeometry(hook, 8, 0.028, 8, false), CHROME, undefined, 0.014)
  pk.add(new THREE.SphereGeometry(0.03, 10, 6), '#ff5f9e', T([-0.035, -0.585, 0]), 0.012)
  pk.add(new THREE.SphereGeometry(0.036, 10, 6), CHROME, T([0, 0, 0]), 0.012)
  void tip
  const prongMesh = pk.mesh('prong', mat)
  for (let i = 0; i < PRONGS; i++) {
    // one at the back and two towards the front corners, so the plushie's face shows between them
    const az = Math.PI + (i * Math.PI * 2) / PRONGS
    const arm = new THREE.Group()
    arm.rotation.y = az - Math.PI / 2
    const pivot = new THREE.Group()
    pivot.position.set(PRONG_R, PRONG_Y, 0)
    pivot.add(i === 0 ? prongMesh : prongMesh.clone())
    arm.add(pivot)
    hub.add(arm)
    prongs.push(pivot)
  }
  hub.scale.setScalar(CLAW_S)
  // the held plushie hangs from here, beside the hub rather than in it, so it keeps its own size
  const hold = new THREE.Group()
  hold.name = 'hold'
  swing.add(hub, hold)
  return { swing, cable, hub, hold, prongs }
}

/** sets the prongs: positive swings them out */
export function setProngs(c: ClawRig, angle: number) {
  // the pivot's local x points outwards; turning about its local z by -angle swings the finger out
  for (const p of c.prongs) p.rotation.z = angle
}

/* ------------------------------------------------------------------ */
/*  The cabinet                                                         */
/* ------------------------------------------------------------------ */

export interface CabinetParts {
  /** everything that never moves, one mesh per material */
  root: THREE.Group
  bridge: THREE.Object3D
  carriage: THREE.Object3D
  flap: THREE.Group
  stick: THREE.Group
  button: THREE.Group
  buttonGlow: THREE.Mesh
  coinLight: THREE.Mesh
  bulbs: THREE.InstancedMesh
  bulbAt: THREE.Vector3[]
  stripMat: THREE.MeshBasicMaterial
  heapMesh: THREE.Mesh
  loose: Record<PrizeId, THREE.Mesh>
  looseAt: Record<PrizeId, THREE.Vector3>
  /** materials and textures the scene owns and disposes */
  own: { dispose: () => void }[]
}

const PINK = '#ff6fae'
const PINK_L = '#ffa3cf'
const PURPLE = '#6a3fe0'
const PURPLE_D = '#3d1d99'
const PANEL = '#2a1666'

export function buildCabinet(heapSpots: FillerSpot[], heapGeo: THREE.BufferGeometry): CabinetParts {
  const mat = feltMaterial()
  const own: { dispose: () => void }[] = []
  const root = new THREE.Group()
  const k = new VKit(INK, OUT)
  const W = BOX.x
  const top = BOX.ceil

  /* ---- lower cabinet ---- */
  const lowH = -GROUND
  k.add(box(W * 2 + 0.5, lowH, 3.5, 0.12), PINK, T([0, GROUND + lowH / 2, 0.02]))
  // a lighter panel inset on the front, a gold kick plate, and a purple band under the glass
  k.add(box(W * 2 + 0.1, lowH - 0.62, 0.06, 0.03), PINK_L, T([0, GROUND + 0.28 + (lowH - 0.62) / 2, FACE_Z + 0.0]), 0.018)
  k.add(box(W * 2 + 0.54, 0.22, 3.56, 0.08), GOLD, T([0, GROUND + 0.11, 0.02]))
  k.add(box(W * 2 + 0.6, 0.2, 3.62, 0.08), PURPLE, T([0, -0.1, 0.02]))
  // the prize door's frame and its dark opening
  k.add(box(FLAP.w + 0.24, FLAP.h + 0.24, 0.1, 0.06), GOLD, T([FLAP.x, FLAP.y, FACE_Z + 0.04]), 0.02)
  k.add(box(FLAP.w, FLAP.h, 0.06, 0.03), '#160a2e', T([FLAP.x, FLAP.y, FACE_Z + 0.07]), 0)
  // the coin door
  const coinX = COIN.x
  const coinY = COIN.y - 0.18
  k.add(box(0.9, 0.95, 0.1, 0.06), '#c9d1e8', T([coinX, coinY, FACE_Z + 0.04]), 0.02)
  k.add(box(0.7, 0.3, 0.05, 0.03), '#8f99b8', T([coinX, coinY + 0.18, FACE_Z + 0.1]), 0.012)
  k.add(box(0.06, 0.2, 0.05, 0.02), '#140a24', T([coinX, coinY + 0.18, FACE_Z + 0.125]), 0)
  k.add(box(0.5, 0.08, 0.05, 0.02), '#140a24', T([coinX, coinY - 0.3, FACE_Z + 0.1]), 0)
  // big stars on the front between the doors
  for (const [x, y, s, c] of [[-0.1, -1.05, 0.28, '#ffe36b'], [0.42, -1.55, 0.17, '#ffffff'], [-0.55, -1.62, 0.13, '#7fe3ff']] as const) {
    const sh = new THREE.Shape()
    for (let i = 0; i < 10; i++) {
      const a = (i * Math.PI) / 5 + Math.PI / 2
      const r = i % 2 ? s * 0.45 : s
      if (i) sh.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      else sh.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
    }
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 })
    k.add(g, c, T([0, 0, FACE_Z + 0.03]), 0.015)
  }

  /* ---- control deck ---- */
  const deckZ = FACE_Z + 0.25
  k.add(box(W * 2 - 0.2, 0.42, 0.76, 0.1), PURPLE, T([0, -0.3, FACE_Z + 0.2]))
  k.add(box(W * 2 - 0.3, 0.1, 0.72, 0.045), PANEL, T([0, -0.08, FACE_Z + 0.21], [0.12, 0, 0]), 0.02)
  k.add(box(W * 2 - 0.1, 0.08, 0.09, 0.035), GOLD, T([0, -0.12, FACE_Z + 0.57], [0.12, 0, 0]), 0.018)

  /* ---- the glass box: posts, rails, back and side walls ---- */
  for (const sx of [-1, 1])
    for (const z of [BOX.front + 0.08, BOX.back - 0.08]) {
      k.add(box(0.28, top + 0.2, 0.28, 0.1), PURPLE_D, T([sx * (W + 0.12), top / 2, z]))
      k.add(box(0.36, 0.16, 0.36, 0.06), GOLD, T([sx * (W + 0.12), 0.06, z]), 0.018)
    }
  k.add(box(W * 2 + 0.5, 0.14, 0.3, 0.06), PURPLE_D, T([0, 0.02, BOX.front + 0.1]))
  // the back wall and the side walls inside the box, printed with stars and hearts
  const wallT = wallTexture()
  own.push(wallT)
  const wallMat = new THREE.MeshBasicMaterial({ map: wallT, vertexColors: true })
  own.push(wallMat)
  /** a plane lit from the strip light at the top: brighter there, dimmer at the heap */
  const litPlane = (w: number, h: number) => {
    const g = new THREE.PlaneGeometry(w, h, 1, 8)
    const pos = g.getAttribute('position')
    const col = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) col.fill(0.62 + 0.55 * ((pos.getY(i) + h / 2) / h) ** 1.5, i * 3, i * 3 + 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    return g
  }
  const backWall = new THREE.Mesh(litPlane(W * 2, top), wallMat)
  wallT.repeat.set(2.4, 1.8)
  backWall.position.set(0, top / 2, BOX.back)
  root.add(backWall)
  for (const sx of [-1, 1]) {
    const side = new THREE.Mesh(litPlane(BOX.front - BOX.back, top), wallMat)
    side.position.set(sx * W, top / 2, (BOX.front + BOX.back) / 2)
    side.rotation.y = -sx * (Math.PI / 2)
    root.add(side)
    own.push(side.geometry)
  }
  own.push(backWall.geometry)

  /* ---- the header and the marquee ---- */
  const headH = 0.66
  k.add(box(W * 2 + 0.6, headH, 3.6, 0.14), PINK, T([0, top + headH / 2, 0.02]))
  k.add(box(W * 2 + 0.66, 0.14, 3.66, 0.06), GOLD, T([0, top + 0.02, 0.02]))
  k.add(box(W * 2 + 0.66, 0.12, 3.66, 0.05), GOLD, T([0, top + headH - 0.02, 0.02]))
  // the marquee board stands on the header
  const mW = W * 2 - 0.2
  const mH = 1.18
  const mY = top + headH + mH / 2 - 0.02
  const mZ = 1.25
  k.add(box(mW + 0.3, mH + 0.3, 0.42, 0.18), GOLD, T([0, mY, mZ]))
  k.add(box(mW + 0.06, mH + 0.06, 0.46, 0.12), PURPLE_D, T([0, mY, mZ]), 0.018)
  // a little crown of three gold balls on top
  for (const [x, r] of [[-0.9, 0.12], [0, 0.17], [0.9, 0.12]] as const) {
    k.add(new THREE.SphereGeometry(r, 16, 12), GOLD, T([x, mY + mH / 2 + 0.15 + r * 0.6, mZ]))
    k.add(cyl(0.05, 0.08, 0.14, 12), GOLD, T([x, mY + mH / 2 + 0.12, mZ]))
  }
  const signT = marqueeTexture()
  own.push(signT)
  const signMat = new THREE.MeshBasicMaterial({ map: signT })
  own.push(signMat)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(mW - 0.1, mH - 0.1), signMat)
  sign.position.set(0, mY, mZ + 0.235)
  own.push(sign.geometry)
  root.add(sign)

  // the bulbs round the marquee board and along the header's front
  const bulbAt: THREE.Vector3[] = []
  const perim = (w: number, h: number, n: number, cx: number, cy: number, z: number) => {
    const L = 2 * (w + h)
    for (let i = 0; i < n; i++) {
      let d = (i / n) * L
      let p: [number, number]
      if (d < w) p = [-w / 2 + d, h / 2]
      else if ((d -= w) < h) p = [w / 2, h / 2 - d]
      else if ((d -= h) < w) p = [w / 2 - d, -h / 2]
      else p = [-w / 2, -h / 2 + (d - w)]
      bulbAt.push(V(cx + p[0], cy + p[1], z))
    }
  }
  perim(mW + 0.15, mH + 0.15, 34, 0, mY, mZ + 0.23)
  for (let i = 0; i < 14; i++) bulbAt.push(V(-W - 0.05 + ((i + 0.5) / 14) * (W * 2 + 0.1), top + headH / 2, 1.83))
  // and a row along the front of the control deck
  for (let i = 0; i < 16; i++) bulbAt.push(V(-W + 0.25 + ((i + 0.5) / 16) * (W * 2 - 0.5), -0.33, FACE_Z + 0.59))
  const bulbMat = new THREE.MeshBasicMaterial({ toneMapped: false })
  own.push(bulbMat)
  const bulbGeo = new THREE.SphereGeometry(0.065, 12, 8)
  own.push(bulbGeo)
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbAt.length)
  bulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bulbAt.length * 3), 3)
  const m4 = new THREE.Matrix4()
  bulbAt.forEach((p, i) => {
    bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z))
    bulbs.setColorAt(i, C('#ffe9a8', 1.6))
  })
  bulbs.frustumCulled = false
  root.add(bulbs)
  // sockets for the bulbs
  for (const p of bulbAt) k.add(cyl(0.05, 0.05, 0.05, 8), '#b8892a', T([p.x, p.y, p.z - 0.04], [Math.PI / 2, 0, 0]), 0)

  // the light strip under the header lights the inside
  const stripMat = new THREE.MeshBasicMaterial({ color: C('#fff1d6', 1.6), toneMapped: false })
  own.push(stripMat)
  const strip = new THREE.Mesh(new THREE.BoxGeometry(W * 2 - 0.1, 0.06, 0.1), stripMat)
  strip.position.set(0, top - 0.05, BOX.front - 0.12)
  own.push(strip.geometry)
  root.add(strip)

  /* ---- the gantry ---- */
  for (const z of [-1.32, 1.32]) {
    rod(k, [-W + 0.05, RAIL_Y + 0.06, z], [W - 0.05, RAIL_Y + 0.06, z], 0.045, CHROME, 0.016)
    for (const sx of [-1, 1]) k.add(box(0.14, 0.26, 0.14, 0.04), '#8f99b8', T([sx * (W - 0.06), RAIL_Y + 0.12, z]), 0.014)
  }
  const bk = new VKit(INK)
  bk.add(box(0.16, 0.12, 2.75, 0.05), '#8f99b8', undefined, 0.016)
  for (const z of [-1.32, 1.32]) bk.add(puck(0.07, 0.1, 0.02, 16), GOLD, T([0, 0.07, z], [0, 0, Math.PI / 2]), 0.012)
  const bridge = bk.mesh('bridge', mat)
  bridge.position.y = RAIL_Y
  root.add(bridge)
  const kk = new VKit(INK)
  kk.add(box(0.34, 0.2, 0.3, 0.06), '#ff5f9e', T([0, -0.08, 0]), 0.016)
  kk.add(puck(0.09, 0.22, 0.03, 16), GOLD, T([0, -0.06, 0], [0, 0, Math.PI / 2]), 0.012)
  kk.add(cyl(0.05, 0.06, 0.06, 12), CHROME, T([0, -0.2, 0]), 0.01)
  const carriage = kk.mesh('carriage', mat)
  carriage.position.y = RAIL_Y
  root.add(carriage)

  /* ---- the chute ---- */
  const acrylic = new THREE.MeshBasicMaterial({ color: '#bfefff', transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide })
  own.push(acrylic)
  const cw = CHUTE.x1 - CHUTE.x0
  const cd = CHUTE.z1 - CHUTE.z0
  const wallR = new THREE.Mesh(new THREE.PlaneGeometry(cd, CHUTE.rim), acrylic)
  wallR.position.set(CHUTE.x1, CHUTE.rim / 2, (CHUTE.z0 + CHUTE.z1) / 2)
  wallR.rotation.y = Math.PI / 2
  const wallB = new THREE.Mesh(new THREE.PlaneGeometry(cw, CHUTE.rim), acrylic)
  wallB.position.set((CHUTE.x0 + CHUTE.x1) / 2, CHUTE.rim / 2, CHUTE.z0)
  wallR.renderOrder = wallB.renderOrder = 4
  root.add(wallR, wallB)
  own.push(wallR.geometry, wallB.geometry)
  // its rims and edges: rounded yellow bars, so the edge reads (and something can teeter on it)
  rod(k, [CHUTE.x1, CHUTE.rim, CHUTE.z0], [CHUTE.x1, CHUTE.rim, CHUTE.z1 - 0.02], 0.055, '#ffe36b', 0.016)
  rod(k, [CHUTE.x0 + 0.02, CHUTE.rim, CHUTE.z0], [CHUTE.x1, CHUTE.rim, CHUTE.z0], 0.055, '#ffe36b', 0.016)
  rod(k, [CHUTE.x1, 0, CHUTE.z0], [CHUTE.x1, CHUTE.rim, CHUTE.z0], 0.035, '#ffe36b', 0.012)
  rod(k, [CHUTE.x1, 0, CHUTE.z1 - 0.02], [CHUTE.x1, CHUTE.rim, CHUTE.z1 - 0.02], 0.035, '#ffe36b', 0.012)
  // a sticker on the chute's back wall
  const chuteT = chuteTexture()
  own.push(chuteT)
  const chuteMat = new THREE.MeshBasicMaterial({ map: chuteT, transparent: true, depthWrite: false })
  own.push(chuteMat)
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.41), chuteMat)
  sticker.position.set((CHUTE.x0 + CHUTE.x1) / 2, CHUTE.rim * 0.62, CHUTE.z0 + 0.012)
  sticker.renderOrder = 5
  own.push(sticker.geometry)
  root.add(sticker)
  // the dark hole at the bottom
  k.add(box(cw - 0.04, 0.04, cd - 0.04, 0.015), '#12081f', T([(CHUTE.x0 + CHUTE.x1) / 2, 0.0, (CHUTE.z0 + CHUTE.z1) / 2]), 0)
  // the floor round the heap
  k.add(box(W * 2, 0.06, BOX.front - BOX.back, 0.02), '#b069c9', T([0, -0.02, 0]), 0)

  /* ---- the heap ---- */
  // a mound of felt underneath, so the gaps between the plushies look deep rather than empty
  const mound = new THREE.PlaneGeometry(W * 2, BOX.front - BOX.back, 40, 24)
  mound.rotateX(-Math.PI / 2)
  const mp = mound.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < mp.count; i++) {
    const x = mp.getX(i)
    const z = mp.getZ(i) + (BOX.front + BOX.back) / 2
    const y = inChute(x, z, -0.04) ? -0.6 : heapY(x, z) - 0.2 + 0.05 * Math.sin(x * 5.3) * Math.sin(z * 4.7)
    mp.setXYZ(i, x, y, z)
  }
  mound.computeVertexNormals()
  k.add(mound, '#8a4fb8', undefined, 0)

  const heapMesh = new THREE.Mesh(heapGeo, mat)
  heapMesh.name = 'heap'
  root.add(heapMesh)
  void heapSpots

  // the loose plushie beside each prize
  const loose = {} as Record<PrizeId, THREE.Mesh>
  const looseAt = {} as Record<PrizeId, THREE.Vector3>
  PRIZES.forEach((p, i) => {
    const [sx, sz] = SLOTS[p.id]
    const [dx, dz] = NEIGHBOUR[p.id]
    const x = sx + dx
    const z = sz + dz
    const g = fillerGeometry(FILLER_COLORS[(i * 3 + 1) % FILLER_COLORS.length], (i % 3) as FillerKind)
    const m = new THREE.Mesh(g, mat)
    m.name = `loose-${p.id}`
    const at = V(x, heapY(x, z) + 0.04, z)
    m.position.copy(at)
    m.rotation.set(-0.2, (i % 2 ? -1 : 1) * 0.35, (i % 2 ? 1 : -1) * 0.18)
    m.scale.setScalar(1.2)
    loose[p.id] = m
    looseAt[p.id] = at
    root.add(m)
  })

  /* ---- the glass ---- */
  const glassT = glassTexture()
  own.push(glassT)
  const glassMat = new THREE.MeshBasicMaterial({ map: glassT, color: '#ffffff', transparent: true, opacity: 0.36, depthWrite: false, blending: THREE.AdditiveBlending })
  own.push(glassMat)
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, top), glassMat)
  glass.position.set(0, top / 2, BOX.front + 0.02)
  glass.renderOrder = 6
  own.push(glass.geometry)
  root.add(glass)
  const tintMat = new THREE.MeshBasicMaterial({ color: '#cdeeff', transparent: true, opacity: 0.06, depthWrite: false })
  own.push(tintMat)
  const glassTint = new THREE.Mesh(glass.geometry, tintMat)
  glassTint.position.copy(glass.position)
  glassTint.renderOrder = 5
  root.add(glassTint)

  /* ---- the prize door, the joystick, the button and the coin light ---- */
  const flapT = flapTexture()
  own.push(flapT)
  const flapMat = new THREE.MeshBasicMaterial({ map: flapT, transparent: true })
  own.push(flapMat)
  const flap = new THREE.Group()
  flap.position.set(FLAP.x, FLAP.y + FLAP.h / 2, FACE_Z + 0.12)
  const flapPane = new THREE.Mesh(new THREE.PlaneGeometry(FLAP.w - 0.04, FLAP.h - 0.04), flapMat)
  flapPane.position.y = -FLAP.h / 2
  own.push(flapPane.geometry)
  const fk = new VKit(INK)
  fk.add(cyl(0.035, 0.035, FLAP.w, 10), GOLD, T([0, 0, 0], [0, 0, Math.PI / 2]), 0.012)
  flap.add(flapPane, fk.mesh('hinge', mat))
  root.add(flap)

  const stick = new THREE.Group()
  stick.position.set(0.45, -0.02, deckZ - 0.02)
  stick.rotation.x = 0.12
  const sk = new VKit(INK)
  sk.add(puck(0.17, 0.06, 0.02), '#1d1240', T([0, 0.02, 0]), 0.014)
  sk.add(new THREE.SphereGeometry(0.11, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#2d1b66', T([0, 0.04, 0]), 0.014)
  rod(sk, [0, 0.04, 0], [0, 0.42, 0], 0.035, CHROME, 0.014)
  sk.add(new THREE.SphereGeometry(0.12, 18, 12), '#ff3d5e', T([0, 0.5, 0]), 0.018)
  sk.add(new THREE.SphereGeometry(0.035, 8, 6), C('#ffffff', 1.3), T([-0.04, 0.55, 0.07]), 0, true)
  stick.add(sk.mesh('stick', mat))
  root.add(stick)

  const button = new THREE.Group()
  const btnBase = new THREE.Group()
  btnBase.position.set(1.55, -0.03, deckZ - 0.04)
  btnBase.rotation.x = 0.12
  const rk = new VKit(INK)
  rk.add(puck(0.27, 0.07, 0.025), '#ffcf4d', T([0, 0.01, 0]), 0.016)
  btnBase.add(rk.mesh('ring', mat))
  const bk2 = new VKit(INK)
  bk2.add(puck(0.2, 0.14, 0.06), '#3ee08f', T([0, 0.08, 0]), 0.018)
  bk2.add(new THREE.SphereGeometry(0.05, 10, 6), C('#ffffff', 1.2), T([-0.08, 0.16, -0.06], [0, 0, 0], [1, 0.4, 0.7]), 0, true)
  button.add(bk2.mesh('button', mat))
  const glowMat = new THREE.MeshBasicMaterial({ color: C('#7dffbf', 1.6), transparent: true, opacity: 0, toneMapped: false, depthWrite: false })
  own.push(glowMat)
  const buttonGlow = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.025, 8, 32), glowMat)
  buttonGlow.rotation.x = Math.PI / 2
  buttonGlow.position.y = 0.05
  own.push(buttonGlow.geometry)
  btnBase.add(button, buttonGlow)
  root.add(btnBase)
  // a small pair of decoy buttons on the left of the deck
  for (const [x, c] of [[-0.75, '#ffcf4d'], [-1.15, '#7fc8ff']] as const) {
    k.add(puck(0.1, 0.06, 0.02), '#1d1240', T([x, -0.02, deckZ - 0.04], [0.12, 0, 0]), 0.012)
    k.add(puck(0.075, 0.07, 0.03), c, T([x, 0.02, deckZ - 0.035], [0.12, 0, 0]), 0.012)
  }

  const coinT = coinTexture()
  own.push(coinT)
  const coinMat = new THREE.MeshBasicMaterial({ map: coinT, color: C('#ffffff', 1), toneMapped: false })
  own.push(coinMat)
  const coinLight = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), coinMat)
  coinLight.position.set(coinX, coinY - 0.08, FACE_Z + 0.1)
  own.push(coinLight.geometry)
  root.add(coinLight)

  /* ---- bake ---- */
  root.add(k.mesh('cabinet', mat))
  return { root, bridge, carriage, flap, stick, button, buttonGlow, coinLight, bulbs, bulbAt, stripMat, heapMesh, loose, looseAt, own }
}

/* ------------------------------------------------------------------ */
/*  The heap's layout                                                   */
/* ------------------------------------------------------------------ */

/** how often each filler kind turns up: mostly round buddies and pillows, a few with bunny ears */
const KINDS: FillerKind[] = [0, 0, 0, 2, 2, 2, 3, 3, 4, 4, 1]

/** the filler plushies of the heap: a jittered grid over the box (not in the chute), the same on every visit */
export function heapSpots(): FillerSpot[] {
  let seed = 20261016
  const rnd = () => ((seed = (seed * 48271) % 2147483647) / 2147483647)
  const out: FillerSpot[] = []
  const step = 0.42
  for (let z = BOX.back + 0.2; z < BOX.front - 0.1; z += step * 0.86)
    for (let x = -BOX.x + 0.2; x < BOX.x - 0.15; x += step) {
      const jx = x + (rnd() - 0.5) * step * 0.7 + (Math.round(z / step) % 2 ? step / 2 : 0)
      const jz = z + (rnd() - 0.5) * step * 0.5
      if (Math.abs(jx) > BOX.x - 0.15 || inChute(jx, jz, 0.18)) continue
      const s = 0.85 + rnd() * 0.35
      out.push({
        p: [jx, heapY(jx, jz) - 0.13 * s, jz],
        r: [-0.6 + rnd() * 1.2 - 0.25, rnd() * Math.PI * 2, -0.7 + rnd() * 1.4],
        s,
        color: FILLER_COLORS[Math.floor(rnd() * FILLER_COLORS.length)],
        kind: KINDS[Math.floor(rnd() * KINDS.length)],
      })
    }
  return out
}
