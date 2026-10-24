import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T, VKit, type P3 } from '../../../lib/three/toon'
import { glowTexture } from '../../../lib/three/fx'
import { BACK_Z, COIN_H, FIELD_W, CAB, GUTTER_Z0, HOPPER, LAND_Z, LOWER_PUSH_MIN, SLOT_X, SLOT_Y, TRAY, UPPER_FRONT_Z, UPPER_PUSH_MIN, UPPER_Y } from './layout'
import { INK, type Mats } from './models'

/*
  The Coin Cascade cabinet, built in code in the toon style of the coins: a teal cabinet with chrome and gold trim and
  magenta lights, open at the top so the camera can look down into it. From the back: the marquee board (COIN CASCADE
  ringed with bulbs, the display panel set into its foot), the back wall with the drop slot's rail and carriage, the
  upper tier (a felt shelf with the upper pusher sliding out of the back wall), the lower tier (felt, its pusher a
  plate sliding out from under the shelf), the front edge and below it the win chute down to the tray; the gutters
  at the front corners where the side walls open; the side panels, the gantry over the lower tier with the hopper
  hanging from it, and the glass front. World units are the simulation's (geom.ts); layout.ts adds the cabinet's own.

  Everything that never moves is baked into one mesh per material (toon paint, chrome, gold) plus a few textured
  planes; the pushers, the carriage and the hopper are their own groups for the scene to move. The LED strips are a
  small shader (dashes chasing along each strip, a rainbow for a party, a white flash) the scene drives.
*/

const OUT = 0.045
const TEAL = '#16c0b4'
const TEAL_D = '#0d8a92'
const NAVY = '#1a2466'
const NAVY_D = '#0d1440'
const DARK = '#070a1e'
const WHITE = '#ffffff'
const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const C = (c: THREE.ColorRepresentation, f = 1) => new THREE.Color(c).multiplyScalar(f)
const box = (w: number, h: number, d: number, r = 0.06, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))
const HW = FIELD_W / 2

/** the top edge of the side panels at depth z: low at the glass, rising to the back wall's top */
export function sideTop(z: number) {
  const t = Math.min(1, Math.max(0, (CAB.z - z) / (CAB.z - (BACK_Z - 0.6))))
  return CAB.top + (CAB.backTop - CAB.top) * (t * t * (3 - 2 * t) * 0.65 + t * 0.35)
}

/** a matrix that stands a +y shape on the segment a-b */
function aim(a: THREE.Vector3, b: THREE.Vector3) {
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize())
  return new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, V(1, 1, 1))
}
function rod(k: VKit, a: P3, b: P3, r: number, color: THREE.ColorRepresentation = WHITE, ink = OUT * 0.6, seg = 12) {
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
function tex(c: HTMLCanvasElement, repeat = false) {
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  return t
}
function star(g: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.45) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * inner : r
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  g.closePath()
}
function coinIcon(g: CanvasRenderingContext2D, x: number, y: number, r: number, gold: boolean) {
  g.fillStyle = '#0b1033'
  g.beginPath()
  g.arc(x, y + r * 0.12, r * 1.1, 0, TAU)
  g.fill()
  g.fillStyle = gold ? '#ffcf3d' : '#d6e0f2'
  g.beginPath()
  g.arc(x, y, r, 0, TAU)
  g.fill()
  g.fillStyle = gold ? '#fff2b0' : '#ffffff'
  g.beginPath()
  g.arc(x - r * 0.15, y - r * 0.15, r * 0.62, 0, TAU)
  g.fill()
  g.fillStyle = gold ? '#e09412' : '#8fa2c2'
  g.font = `900 ${Math.round(r * 1.2)}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(gold ? 'B' : '★', x, y + r * 0.06)
}

/** the marquee: COIN CASCADE in fat gold-to-magenta letters on a night-navy board with a teal glow and a few coins */
export function marqueeTexture() {
  const W = 2048
  const H = 340
  const [c, g] = canvas(W, H)
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#1b2a86')
  bg.addColorStop(0.6, '#0f175a')
  bg.addColorStop(1, '#0a1040')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  // a fan of rays from the middle and a teal glow behind the words
  g.save()
  g.translate(W / 2, H * 0.42)
  for (let i = 0; i < 28; i++) {
    g.rotate(TAU / 28)
    g.fillStyle = i % 2 ? 'rgba(40,230,215,0.08)' : 'rgba(255,80,190,0.07)'
    g.beginPath()
    g.moveTo(0, 0)
    g.lineTo(1400, -90)
    g.lineTo(1400, 90)
    g.closePath()
    g.fill()
  }
  g.restore()
  const glow = g.createRadialGradient(W / 2, H * 0.4, 20, W / 2, H * 0.4, W * 0.45)
  glow.addColorStop(0, 'rgba(60,240,220,0.35)')
  glow.addColorStop(1, 'rgba(60,240,220,0)')
  g.fillStyle = glow
  g.fillRect(0, 0, W, H)
  for (const [x, y, r, gold] of [[80, 120, 44, true], [1968, 118, 44, true], [180, 236, 28, false], [1868, 236, 28, false]] as const) coinIcon(g, x, y, r, gold)
  for (const [x, y, r] of [[300, 54, 13], [1748, 58, 14], [260, 286, 9], [1790, 290, 10], [130, 300, 8], [1920, 40, 9]] as const) {
    star(g, x, y, r)
    g.fillStyle = '#ffe36b'
    g.fill()
  }
  const text = 'COIN CASCADE'
  let size = 210
  g.font = `900 ${size}px ${FONT}`
  while (g.measureText(text).width > 1520 && size > 80) g.font = `900 ${(size -= 4)}px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  const y = 138
  g.fillStyle = INK
  g.strokeStyle = INK
  g.lineWidth = 40
  g.strokeText(text, W / 2, y + 14)
  g.fillText(text, W / 2, y + 14)
  g.lineWidth = 28
  g.strokeText(text, W / 2, y)
  const fill = g.createLinearGradient(0, y - size * 0.5, 0, y + size * 0.45)
  fill.addColorStop(0, '#fff7c2')
  fill.addColorStop(0.4, '#ffd23a')
  fill.addColorStop(0.42, '#ffa62a')
  fill.addColorStop(1, '#ff3fb4')
  g.fillStyle = fill
  g.fillText(text, W / 2, y)
  g.save()
  g.beginPath()
  g.rect(0, y - size * 0.42, W, size * 0.12)
  g.clip()
  g.fillStyle = 'rgba(255,255,255,0.5)'
  g.fillText(text, W / 2, y)
  g.restore()
  return tex(c)
}

/** the display panel: a dark LED field with a faint dot matrix (the page lays its counter over it) */
function displayTexture() {
  const [c, g] = canvas(512, 96)
  g.fillStyle = '#04060f'
  g.fillRect(0, 0, 512, 96)
  g.fillStyle = 'rgba(40,220,200,0.12)'
  for (let y = 6; y < 96; y += 9) for (let x = 6; x < 512; x += 9) g.fillRect(x, y, 3, 3)
  const sh = g.createLinearGradient(0, 0, 0, 96)
  sh.addColorStop(0, 'rgba(255,255,255,0.1)')
  sh.addColorStop(0.45, 'rgba(255,255,255,0)')
  g.fillStyle = sh
  g.fillRect(0, 0, 512, 96)
  return tex(c)
}

/** the playfield felt: deep royal blue with a fine diamond print and a soft nap (tiles every 2 units) */
function feltTexture() {
  const S = 512
  const [c, g] = canvas(S, S)
  g.fillStyle = '#1f3796'
  g.fillRect(0, 0, S, S)
  let seed = 3
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,20,0.06)'
    g.fillRect(rnd() * S, rnd() * S, 2 + rnd() * 3, 2 + rnd() * 3)
  }
  g.strokeStyle = 'rgba(120,170,255,0.16)'
  g.lineWidth = 3
  for (let i = -2; i <= 2; i++) {
    g.beginPath()
    g.moveTo(i * S * 0.5, 0)
    g.lineTo(i * S * 0.5 + S, S)
    g.moveTo(i * S * 0.5 + S, 0)
    g.lineTo(i * S * 0.5, S)
    g.stroke()
  }
  for (const [x, y] of [[0, 0], [S / 2, S / 2], [S, 0], [0, S], [S, S]]) {
    star(g, x, y, 15)
    g.fillStyle = 'rgba(255,214,90,0.22)'
    g.fill()
  }
  return tex(c, true)
}

/** the back wall above the upper pusher: a sunburst of teal and navy, arrows pointing down from the slot, stars */
function backTexture() {
  const W = 1024
  const H = 400
  const [c, g] = canvas(W, H)
  const bg = g.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#13206e')
  bg.addColorStop(1, '#0a103e')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)
  g.save()
  g.translate(W / 2, H * 1.05)
  for (let i = 0; i < 22; i++) {
    g.fillStyle = i % 2 ? 'rgba(30,210,200,0.13)' : 'rgba(255,255,255,0.025)'
    g.beginPath()
    g.moveTo(0, 0)
    const a0 = -Math.PI + (i / 22) * Math.PI
    const a1 = -Math.PI + ((i + 1) / 22) * Math.PI
    g.lineTo(Math.cos(a0) * 1400, Math.sin(a0) * 1400)
    g.lineTo(Math.cos(a1) * 1400, Math.sin(a1) * 1400)
    g.closePath()
    g.fill()
  }
  g.restore()
  // a row of chevrons under the slot rail, pointing down to the field
  for (let i = 0; i < 9; i++) {
    const x = W * (0.1 + i * 0.1)
    g.fillStyle = i % 2 ? 'rgba(255,63,180,0.55)' : 'rgba(255,210,58,0.55)'
    g.beginPath()
    g.moveTo(x - 22, 50)
    g.lineTo(x, 72)
    g.lineTo(x + 22, 50)
    g.lineTo(x + 22, 62)
    g.lineTo(x, 84)
    g.lineTo(x - 22, 62)
    g.closePath()
    g.fill()
  }
  let seed = 5
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 30; i++) {
    star(g, rnd() * W, 110 + rnd() * (H - 130), 3 + rnd() * 6)
    g.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.35})`
    g.fill()
  }
  // a gold pinstripe frame
  g.strokeStyle = 'rgba(255,210,80,0.5)'
  g.lineWidth = 4
  g.strokeRect(10, 10, W - 20, H - 20)
  return tex(c)
}

/** a pusher's face: diagonal hazard stripes in gold and navy between chrome bands */
function stripeTexture() {
  const W = 1024
  const H = 96
  const [c, g] = canvas(W, H)
  g.fillStyle = '#ffc93a'
  g.fillRect(0, 0, W, H)
  g.fillStyle = '#121a52'
  for (let x = -H; x < W + H; x += 64) {
    g.beginPath()
    g.moveTo(x, H)
    g.lineTo(x + 32, H)
    g.lineTo(x + 32 + H, 0)
    g.lineTo(x + H, 0)
    g.closePath()
    g.fill()
  }
  const sh = g.createLinearGradient(0, 0, 0, H)
  sh.addColorStop(0, 'rgba(255,255,255,0.28)')
  sh.addColorStop(0.3, 'rgba(255,255,255,0)')
  sh.addColorStop(0.8, 'rgba(0,0,0,0)')
  sh.addColorStop(1, 'rgba(0,0,0,0.35)')
  g.fillStyle = sh
  g.fillRect(0, 0, W, H)
  return tex(c)
}

/** light streaking across the glass */
function glassTexture() {
  const [c, g] = canvas(512, 256)
  g.clearRect(0, 0, 512, 256)
  const streak = (x: number, w: number, a: number) => {
    const grad = g.createLinearGradient(x - w, 0, x + w, 0)
    grad.addColorStop(0, 'rgba(255,255,255,0)')
    grad.addColorStop(0.5, `rgba(255,255,255,${a})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.save()
    g.translate(0, 128)
    g.transform(1, 0, -0.7, 1, 0, 0)
    g.fillStyle = grad
    g.fillRect(x - w, -300, w * 2, 600)
    g.restore()
  }
  streak(70, 26, 0.32)
  streak(112, 8, 0.26)
  streak(380, 18, 0.18)
  streak(440, 5, 0.2)
  // a faint sheen at the top edge
  const top = g.createLinearGradient(0, 0, 0, 10)
  top.addColorStop(0, 'rgba(255,255,255,0.12)')
  top.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = top
  g.fillRect(0, 0, 512, 10)
  return tex(c)
}

/** the tray's front plate: WIN in gold on navy, between two stars */
function trayLabelTexture() {
  const [c, g] = canvas(512, 128)
  g.fillStyle = '#0d1440'
  g.beginPath()
  g.roundRect(4, 4, 504, 120, 30)
  g.fill()
  g.strokeStyle = '#ffd23a'
  g.lineWidth = 6
  g.stroke()
  g.font = `900 86px ${FONT}`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 12
  g.strokeStyle = INK
  g.strokeText('WIN', 256, 70)
  const f = g.createLinearGradient(0, 30, 0, 110)
  f.addColorStop(0, '#fff3b0')
  f.addColorStop(0.5, '#ffd23a')
  f.addColorStop(1, '#ff9a2a')
  g.fillStyle = f
  g.fillText('WIN', 256, 70)
  for (const x of [96, 416]) {
    star(g, x, 66, 26)
    g.fillStyle = '#ff3fb4'
    g.fill()
  }
  return tex(c)
}

/* ------------------------------------------------------------------ */
/*  LED strips                                                          */
/* ------------------------------------------------------------------ */

const LED_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const LED_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uTime;
uniform float uSpeed;
uniform float uLen;
uniform float uParty;
uniform float uFlash;
uniform float uBright;
uniform vec3 uA;
uniform vec3 uB;
void main() {
  float u = vUv.x * uLen;
  float seg = fract(u * 1.4 - uTime * uSpeed);
  float dash = smoothstep(0.0, 0.07, seg) * (1.0 - smoothstep(0.5, 0.57, seg));
  vec3 col = mix(uB, uA, dash);
  vec3 rb = 0.5 + 0.5 * cos(6.2831 * (u * 0.06 - uTime * 0.6 + vec3(0.0, 0.33, 0.67)));
  col = mix(col, rb * 2.4, uParty);
  col = mix(col, vec3(2.8, 2.6, 2.4), uFlash);
  float across = 1.0 - pow(abs(vUv.y - 0.5) * 2.0, 4.0);
  gl_FragColor = vec4(col * uBright * (0.45 + 0.55 * across), 1.0);
}`

export interface Led {
  mat: THREE.ShaderMaterial
  /** chase speed while waiting and while a drop plays */
  idle: number
  busy: number
}

function ledMaterial(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, len: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSpeed: { value: 0.6 },
      uLen: { value: len },
      uParty: { value: 0 },
      uFlash: { value: 0 },
      uBright: { value: 1 },
      uA: { value: C(a, 2.2) },
      uB: { value: C(b, 0.7) },
    },
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
    toneMapped: false,
  })
}

/** a flat strip, w long and h tall, standing in the xy plane (uv.x along it) */
const stripGeo = (w: number, h: number) => new THREE.PlaneGeometry(w, h)

/** a ribbon lying along the top of a side panel, following its curve (uv.x along it) */
function topRibbon(x: number, w: number, z0: number, z1: number, n = 48) {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  let len = 0
  let prev: THREE.Vector3 | null = null
  for (let i = 0; i <= n; i++) {
    const z = z0 + ((z1 - z0) * i) / n
    const y = sideTop(z) + 0.075
    const p = V(x, y, z)
    if (prev) len += p.distanceTo(prev)
    prev = p
    pos.push(x - w / 2, y, z, x + w / 2, y, z)
    uv.push(len, 0, len, 1)
    if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  for (let i = 0; i < uv.length; i += 2) uv[i] /= len
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  return { geo: g, len }
}

/* ------------------------------------------------------------------ */
/*  The cabinet                                                         */
/* ------------------------------------------------------------------ */

export interface Pusher {
  group: THREE.Group
  led: Led
}

export interface HopperRig {
  /** the funnel turns about x on its pins (positive tips its mouth forward, towards the camera) */
  pivot: THREE.Group
  /** where the brimming coins sit, in the funnel's frame: kind and matrix */
  coins: { gold: boolean; m: THREE.Matrix4 }[]
  /** the spout's ring light */
  light: THREE.MeshBasicMaterial
}

export interface CabinetParts {
  root: THREE.Group
  upper: Pusher
  lower: Pusher
  carriage: THREE.Group
  carriageLight: THREE.MeshBasicMaterial
  hopper: HopperRig
  bulbs: THREE.InstancedMesh
  bulbAt: THREE.Vector3[]
  /** which bulbs ring the marquee (the rest line the side panels and the tray) */
  marqueeBulbs: number
  leds: Led[]
  /** the four corners of the display panel, for the page's counter */
  display: THREE.Vector3[]
  trayGlow: THREE.Mesh
  glass: THREE.MeshBasicMaterial
  own: { dispose: () => void }[]
}

export function buildCabinet(mats: Mats): CabinetParts {
  const own: { dispose: () => void }[] = []
  const root = new THREE.Group()
  root.name = 'cabinet'
  const paint = new VKit(INK, OUT)
  const chrome = new VKit(INK, OUT)
  const gold = new VKit(INK, OUT)
  const leds: Led[] = []
  const addLed = (geo: THREE.BufferGeometry, a: string, b: string, len: number, idle: number, busy: number, at?: THREE.Matrix4, parent: THREE.Object3D = root) => {
    const mat = ledMaterial(a, b, len)
    const m = new THREE.Mesh(geo, mat)
    if (at) m.applyMatrix4(at)
    parent.add(m)
    own.push(geo, mat)
    const led = { mat, idle, busy }
    leds.push(led)
    return led
  }
  const plane = (w: number, h: number, mat: THREE.Material, at: THREE.Matrix4, order = 0, segs: [number, number] = [1, 1]) => {
    const g = new THREE.PlaneGeometry(w, h, ...segs)
    const m = new THREE.Mesh(g, mat)
    m.applyMatrix4(at)
    m.renderOrder = order
    root.add(m)
    own.push(g)
    return m
  }

  /* ---- the side panels ---- */
  const FZ = CAB.z
  const BZ = BACK_Z - 0.6
  const base = CAB.base
  // the outer panel's profile in (z, y): a foot that reaches forward round the tray, the front edge, the top curve
  const profile = () => {
    const s = new THREE.Shape()
    s.moveTo(BZ, base)
    s.lineTo(TRAY.z + TRAY.d / 2 + 0.45, base)
    s.lineTo(TRAY.z + TRAY.d / 2 + 0.45, TRAY.y + 0.95)
    s.quadraticCurveTo(TRAY.z + TRAY.d / 2 + 0.3, TRAY.y + 1.5, FZ, TRAY.y + 1.75)
    s.lineTo(FZ, CAB.top)
    for (let i = 1; i <= 24; i++) {
      const z = FZ + ((BZ - FZ) * i) / 24
      s.lineTo(z, sideTop(z))
    }
    s.lineTo(BZ, base)
    return s
  }
  const T_SIDE = CAB.outer - CAB.gutter
  for (const sx of [-1, 1]) {
    const g = new THREE.ExtrudeGeometry(profile(), { depth: T_SIDE - 0.12, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 2, curveSegments: 8 })
    // shape x is world z, the extrusion runs along world x
    g.rotateY(-Math.PI / 2)
    g.translate(sx > 0 ? CAB.outer - 0.06 : -CAB.gutter - 0.06, 0, 0)
    paint.add(g, TEAL)
    // the inner wall along the field, up to where the gutter opens
    const inner = new THREE.Shape()
    inner.moveTo(BZ, -0.35)
    inner.lineTo(GUTTER_Z0, -0.35)
    inner.lineTo(GUTTER_Z0, sideTop(GUTTER_Z0) - 0.02)
    for (let i = 1; i <= 16; i++) {
      const z = GUTTER_Z0 + ((BZ - GUTTER_Z0) * i) / 16
      inner.lineTo(z, sideTop(z) - 0.02)
    }
    inner.lineTo(BZ, -0.35)
    const ig = new THREE.ExtrudeGeometry(inner, { depth: CAB.gutter - HW - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 1, curveSegments: 4 })
    ig.rotateY(-Math.PI / 2)
    ig.translate(sx > 0 ? CAB.gutter - 0.02 : -HW - 0.02, 0, 0)
    paint.add(ig, NAVY, undefined, OUT * 0.6)
    // a gold trim along the top edge and a chrome edge down the front
    for (let i = 0; i < 20; i++) {
      const za = FZ + ((BZ - FZ) * i) / 20
      const zb = FZ + ((BZ - FZ) * (i + 1)) / 20
      rod(gold, [sx * (CAB.outer - 0.02), sideTop(za) + 0.02, za], [sx * (CAB.outer - 0.02), sideTop(zb) + 0.02, zb], 0.07, WHITE, 0)
    }
    rod(chrome, [sx * (CAB.gutter + T_SIDE / 2), TRAY.y + 1.85, FZ + 0.08], [sx * (CAB.gutter + T_SIDE / 2), CAB.top - 0.05, FZ + 0.08], 0.09)
  }
  // the magenta strip along the top of each side panel
  for (const sx of [-1, 1]) {
    const r = topRibbon(sx * (CAB.gutter + 0.12), 0.16, FZ - 0.05, BZ + 0.1)
    addLed(r.geo, '#ff3fb4', '#5a1050', r.len, 0.35, 1.4)
  }

  /* ---- the lower tier: its floor, the front edge, the chute face below it, the gutters ---- */
  const feltT = feltTexture()
  own.push(feltT)
  /** a felt floor lit from above: brighter in the middle and towards the front */
  const feltMat = new THREE.MeshBasicMaterial({ map: feltT, vertexColors: true })
  own.push(feltMat)
  const floor = (w: number, d: number, y: number, z: number) => {
    const g = new THREE.PlaneGeometry(w, d, 10, 10)
    g.rotateX(-Math.PI / 2)
    const p = g.getAttribute('position')
    const uv = g.getAttribute('uv')
    const col = new Float32Array(p.count * 3)
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const wz = p.getZ(i) + z
      const k = 0.72 + 0.36 * Math.exp(-((x / (w * 0.55)) ** 2)) * (0.75 + 0.25 * Math.min(1, (wz + 9) / 12))
      col.set([k, k, k], i * 3)
      uv.setXY(i, (x + HW) / 2.2, -(wz) / 2.2)
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    const m = new THREE.Mesh(g, feltMat)
    m.position.set(0, y, z)
    root.add(m)
    own.push(g)
  }
  floor(FIELD_W, CAB.edge - LOWER_PUSH_MIN + 0.2, 0, (CAB.edge + LOWER_PUSH_MIN - 0.2) / 2)
  floor(FIELD_W, UPPER_FRONT_Z - BACK_Z, UPPER_Y, (UPPER_FRONT_Z + BACK_Z) / 2)
  // the slab under the lower floor and its rounded chrome front edge (flush with the felt, so coins slide off it)
  paint.add(box(FIELD_W, 0.3, CAB.edge - BACK_Z, 0.04), NAVY_D, T([0, -0.16, (CAB.edge + BACK_Z) / 2]), 0)
  rod(chrome, [-HW, -0.07, CAB.edge - 0.02], [HW, -0.07, CAB.edge - 0.02], 0.07, WHITE, OUT * 0.5)
  // the chute's back: the cabinet's front face under the edge, down to the tray
  const chuteTop = -0.2
  const chuteH = chuteTop - (TRAY.y - 0.15)
  paint.add(box(CAB.gutter * 2, chuteH, 0.1, 0.03), NAVY, T([0, chuteTop - chuteH / 2, CAB.edge - 0.05]))
  // gold bands across it, and the edge's LED strip
  gold.add(box(CAB.gutter * 2 - 0.1, 0.1, 0.06, 0.02), WHITE, T([0, chuteTop - 0.05, CAB.edge + 0.02]), OUT * 0.5)
  gold.add(box(CAB.gutter * 2 - 0.1, 0.08, 0.06, 0.02), WHITE, T([0, TRAY.y + 0.95, CAB.edge + 0.02]), OUT * 0.5)
  addLed(stripGeo(FIELD_W - 0.1, 0.17), '#ffd23a', '#7a1a60', FIELD_W, 0.5, 2.2, T([0, chuteTop - 0.2, CAB.edge + 0.012]))
  // big chevrons on the chute face pointing down to the tray
  for (let i = -2; i <= 2; i++) {
    const sh = new THREE.Shape()
    sh.moveTo(-0.32, 0.2)
    sh.lineTo(0, -0.08)
    sh.lineTo(0.32, 0.2)
    sh.lineTo(0.32, 0.02)
    sh.lineTo(0, -0.26)
    sh.lineTo(-0.32, 0.02)
    sh.closePath()
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.02, bevelEnabled: false })
    paint.add(g, i % 2 ? '#ff3fb4' : TEAL, T([i * 1.9, -1.35, CAB.edge + 0.005]), OUT * 0.4)
  }
  // the gutters: open pits where the side walls open, dark inside (a coin that goes in falls out of sight), with a
  // chrome rail round their outer side
  const pitMat = new THREE.MeshBasicMaterial({ color: '#03040c', side: THREE.BackSide })
  const pitLid = new THREE.MeshBasicMaterial({ visible: false })
  own.push(pitMat, pitLid)
  for (const sx of [-1, 1]) {
    const gw = CAB.gutter - HW
    const gd = CAB.edge - GUTTER_Z0
    const pg = new THREE.BoxGeometry(gw, CAB.gutterDepth, gd)
    // its faces: +x, -x, +y (the open top), -y, +z, -z
    const pit = new THREE.Mesh(pg, [pitMat, pitMat, pitLid, pitMat, pitMat, pitMat])
    pit.position.set(sx * (HW + gw / 2), -CAB.gutterDepth / 2 - 0.005, (GUTTER_Z0 + CAB.edge) / 2)
    root.add(pit)
    own.push(pg)
    rod(chrome, [sx * (CAB.gutter - 0.04), 0.02, GUTTER_Z0], [sx * (CAB.gutter - 0.04), 0.02, CAB.edge], 0.05, WHITE, OUT * 0.4)
  }

  /* ---- the upper tier: the shelf and its lip ---- */
  const shelfH = UPPER_Y - CAB.shelfBottom
  paint.add(box(FIELD_W, shelfH, UPPER_FRONT_Z - BACK_Z, 0.04), NAVY, T([0, CAB.shelfBottom + shelfH / 2 - 0.005, (UPPER_FRONT_Z + BACK_Z) / 2]), OUT * 0.6)
  rod(chrome, [-HW, UPPER_Y - 0.06, UPPER_FRONT_Z], [HW, UPPER_Y - 0.06, UPPER_FRONT_Z], 0.065, WHITE, OUT * 0.5)
  addLed(stripGeo(FIELD_W - 0.2, 0.2), '#3ff0e0', '#0a3a6a', FIELD_W, 0.5, 2, T([0, CAB.shelfBottom + 0.2, UPPER_FRONT_Z + 0.012]))

  /* ---- the back wall, the slot rail ---- */
  const wallY0 = UPPER_Y + CAB.upperPushH + 0.02
  const wallY1 = CAB.backTop
  paint.add(box(FIELD_W + 0.1, wallY1 - wallY0, 0.6, 0.05), NAVY_D, T([0, (wallY0 + wallY1) / 2, BACK_Z - 0.3]), OUT * 0.6)
  // a dark cavity behind the upper pusher's opening
  paint.add(box(FIELD_W, CAB.upperPushH + 0.06, 0.5, 0.02), DARK, T([0, UPPER_Y + CAB.upperPushH / 2, BACK_Z - 0.34]), 0)
  rod(chrome, [-HW, wallY0 + 0.07, BACK_Z + 0.02], [HW, wallY0 + 0.07, BACK_Z + 0.02], 0.07, WHITE, OUT * 0.5)
  const backT = backTexture()
  own.push(backT)
  const backMat = new THREE.MeshBasicMaterial({ map: backT })
  own.push(backMat)
  plane(FIELD_W, wallY1 - wallY0 - 0.1, backMat, T([0, (wallY0 + wallY1) / 2 + 0.02, BACK_Z + 0.006]))
  // the slot's rail, on brackets
  const railY = SLOT_Y + 0.62
  const railZ = BACK_Z + 0.42
  rod(gold, [-SLOT_X - 0.8, railY, railZ], [SLOT_X + 0.8, railY, railZ], 0.1)
  for (const sx of [-1, 1]) chrome.add(box(0.22, 0.32, 0.5, 0.05), WHITE, T([sx * (SLOT_X + 0.95), railY, BACK_Z + 0.2]), OUT * 0.5)

  /* ---- the marquee and the display ---- */
  const mY0 = CAB.backTop - 0.05
  const mY1 = mY0 + 2.5
  const mW = CAB.outer * 2 + 0.3
  const mZ = BACK_Z - 0.32
  gold.add(box(mW + 0.24, mY1 - mY0 + 0.24, 0.55, 0.14), WHITE, T([0, (mY0 + mY1) / 2, mZ - 0.1]))
  paint.add(box(mW, mY1 - mY0, 0.6, 0.1), NAVY_D, T([0, (mY0 + mY1) / 2, mZ]), OUT * 0.5)
  const signT = marqueeTexture()
  own.push(signT)
  const signMat = new THREE.MeshBasicMaterial({ map: signT, color: C(WHITE, 1.05) })
  own.push(signMat)
  const signW = mW - 0.5
  const signH = mY1 - mY0 - 0.42
  plane(signW, signH, signMat, T([0, (mY0 + mY1) / 2 + 0.02, mZ + 0.305]))
  // the display, set into the foot of the board in a chrome bezel
  const dW = 4.6
  const dH = 0.72
  const dY = mY0 + 0.55
  const dZ = mZ + 0.33
  chrome.add(box(dW + 0.26, dH + 0.22, 0.12, 0.06), WHITE, T([0, dY, dZ - 0.03]), OUT * 0.5)
  const dispT = displayTexture()
  own.push(dispT)
  const dispMat = new THREE.MeshBasicMaterial({ map: dispT })
  own.push(dispMat)
  plane(dW, dH, dispMat, T([0, dY, dZ + 0.035]), 1)
  const display = [V(-dW / 2, dY + dH / 2, dZ + 0.04), V(dW / 2, dY + dH / 2, dZ + 0.04), V(dW / 2, dY - dH / 2, dZ + 0.04), V(-dW / 2, dY - dH / 2, dZ + 0.04)]

  /* ---- bulbs ---- */
  const bulbAt: THREE.Vector3[] = []
  const bw = signW + 0.12
  const bh = signH + 0.12
  const per = 2 * (bw + bh)
  const nM = 52
  for (let i = 0; i < nM; i++) {
    let d = (i / nM) * per
    let p: [number, number]
    if (d < bw) p = [-bw / 2 + d, bh / 2]
    else if ((d -= bw) < bh) p = [bw / 2, bh / 2 - d]
    else if ((d -= bh) < bw) p = [bw / 2 - d, -bh / 2]
    else p = [-bw / 2, -bh / 2 + (d - bw)]
    bulbAt.push(V(p[0], (mY0 + mY1) / 2 + 0.02 + p[1], mZ + 0.34))
  }
  const marqueeBulbs = bulbAt.length
  // and a column down the front of each side panel
  for (const sx of [-1, 1]) for (let i = 0; i < 8; i++) bulbAt.push(V(sx * (CAB.gutter + T_SIDE / 2), TRAY.y + 2.3 + i * ((CAB.top - TRAY.y - 2.6) / 7), FZ + 0.2))
  const bulbMat = new THREE.MeshBasicMaterial({ toneMapped: false })
  const bulbGeo = new THREE.SphereGeometry(0.1, 12, 8)
  own.push(bulbMat, bulbGeo)
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbAt.length)
  bulbs.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bulbAt.length * 3), 3)
  const m4 = new THREE.Matrix4()
  bulbAt.forEach((p, i) => {
    bulbs.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z))
    bulbs.setColorAt(i, C('#ffe9a8', 1.6))
  })
  bulbs.frustumCulled = false
  root.add(bulbs)
  for (const p of bulbAt) chrome.add(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 10), WHITE, T([p.x, p.y, p.z - 0.07], [Math.PI / 2, 0, 0]), 0)

  /* ---- the tray ---- */
  const tz0 = CAB.edge - 0.02
  const tz1 = TRAY.z + TRAY.d / 2 + 0.12
  const tw = TRAY.w
  const trayTop = TRAY.y + 0.4
  // the plinth under it, between the side panels
  paint.add(box(CAB.gutter * 2, TRAY.y - 0.12 - base, tz1 - CAB.edge + 0.6, 0.06), NAVY_D, T([0, (TRAY.y - 0.12 + base) / 2, (tz1 + CAB.edge - 0.6) / 2]))
  gold.add(box(CAB.gutter * 2 + 0.04, 0.16, tz1 - CAB.edge + 0.66, 0.05), WHITE, T([0, base + 0.08, (tz1 + CAB.edge - 0.6) / 2]), OUT * 0.5)
  // the bowl: its floor, its walls, a chrome rim
  paint.add(box(tw, 0.14, tz1 - tz0, 0.03), '#101a52', T([0, TRAY.y - 0.07, (tz0 + tz1) / 2]), 0)
  paint.add(box(tw + 0.24, trayTop - TRAY.y + 0.14, 0.18, 0.05), TEAL_D, T([0, (trayTop + TRAY.y - 0.14) / 2, tz1 + 0.04]))
  for (const sx of [-1, 1]) paint.add(box(0.18, trayTop - TRAY.y + 0.14, tz1 - tz0 + 0.1, 0.05), TEAL_D, T([sx * (tw / 2 + 0.03), (trayTop + TRAY.y - 0.14) / 2, (tz0 + tz1) / 2]))
  rod(chrome, [-tw / 2 - 0.05, trayTop + 0.04, tz1 + 0.06], [tw / 2 + 0.05, trayTop + 0.04, tz1 + 0.06], 0.075)
  for (const sx of [-1, 1]) rod(chrome, [sx * (tw / 2 + 0.05), trayTop + 0.04, tz0 + 0.05], [sx * (tw / 2 + 0.05), trayTop + 0.04, tz1 + 0.06], 0.075)
  const labelT = trayLabelTexture()
  own.push(labelT)
  const labelMat = new THREE.MeshBasicMaterial({ map: labelT, transparent: true })
  own.push(labelMat)
  plane(2.4, 0.6, labelMat, T([0, TRAY.y - 0.5, tz1 + 0.012]), 1)
  // ledges either side of the tray, with round speaker grilles
  for (const sx of [-1, 1]) {
    const lx = sx * (tw / 2 + 0.12 + (CAB.gutter - tw / 2 - 0.12) / 2)
    const lw = CAB.gutter - tw / 2 - 0.12
    paint.add(box(lw, 1.2, tz1 - CAB.edge + 0.1, 0.06), NAVY, T([lx, TRAY.y + 0.3, (tz1 + CAB.edge) / 2]))
    chrome.add(new THREE.TorusGeometry(0.34, 0.06, 8, 24), WHITE, T([lx, TRAY.y + 0.3, tz1 + 0.06]), OUT * 0.5)
    paint.add(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 24), DARK, T([lx, TRAY.y + 0.3, tz1 + 0.04], [Math.PI / 2, 0, 0]), 0)
  }
  // the happy flash: a glow laid over the tray's floor (the scene fades it in on a win)
  const tgMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: C('#ffd86a', 1.6), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
  own.push(tgMat)
  const tgGeo = new THREE.PlaneGeometry(tw * 1.25, (tz1 - tz0) * 2.2)
  tgGeo.rotateX(-Math.PI / 2)
  own.push(tgGeo)
  const trayGlow = new THREE.Mesh(tgGeo, tgMat)
  trayGlow.position.set(0, TRAY.y + 0.05, (tz0 + tz1) / 2)
  trayGlow.renderOrder = 4
  root.add(trayGlow)
  addLed(stripGeo(tw, 0.12), '#ffd23a', '#7a4a10', tw, 0.4, 1.8, T([0, trayTop - 0.1, tz1 + 0.135]))

  /* ---- the gantry over the lower tier ---- */
  const gz = CAB.gantryZ
  const hz = HOPPER.z
  const gy = CAB.gantryY
  for (const sx of [-1, 1]) {
    const px = sx * (CAB.gutter + T_SIDE / 2)
    rod(chrome, [px, sideTop(gz) - 0.1, gz], [px, gy + 0.05, gz], 0.13)
    gold.add(box(0.5, 0.18, 0.5, 0.05), WHITE, T([px, sideTop(gz) + 0.08, gz]), OUT * 0.5)
    gold.add(new THREE.SphereGeometry(0.2, 16, 10), WHITE, T([px, gy + 0.1, gz]))
  }
  rod(chrome, [-CAB.gutter - T_SIDE / 2, gy, gz], [CAB.gutter + T_SIDE / 2, gy, gz], 0.15)
  addLed(stripGeo(CAB.gutter * 2 - 0.6, 0.11), '#3ff0e0', '#123a7a', CAB.gutter * 2, 0.4, 1.6, T([0, gy - 0.02, gz + 0.152]))
  // the hangers down to the hopper's pins
  const S = CAB.hopperSize
  const pivotY = HOPPER.y + CAB.bucketPivot
  for (const sx of [-1, 1]) rod(chrome, [sx * (0.9 * S + 0.14), gy, gz], [sx * (0.9 * S + 0.14), pivotY, hz], 0.06, WHITE, OUT * 0.5)

  /* ---- the hopper: a funnel brimming with coins, tipping on its pins to pour from its spout ---- */
  const pivot = new THREE.Group()
  pivot.name = 'hopper'
  pivot.position.set(HOPPER.x, pivotY, hz)
  const hk = new VKit(INK, OUT)
  const hc = new VKit(INK, OUT)
  const hg = new VKit(INK, OUT)
  const spoutY = -CAB.bucketPivot
  const rimY = 0.3 * S
  // a loft of rounded rectangles: the spout, the bowl's foot, its belly and its rim
  const rings = [
    { hx: 0.25, hz: 0.25, y: spoutY },
    { hx: 0.3, hz: 0.3, y: spoutY + 0.25 },
    { hx: 0.52 * S, hz: 0.42 * S, y: -0.32 * S },
    { hx: 0.88 * S, hz: 0.66 * S, y: 0 },
    { hx: 0.98 * S, hz: 0.74 * S, y: rimY },
  ]
  const pos: number[] = []
  const rr = (r: { hx: number; hz: number; y: number }, i: number, n: number): P3 => {
    const a = (i / n) * TAU
    const c = Math.cos(a)
    const s = Math.sin(a)
    const k = Math.min(1, 0.86 / Math.max(Math.abs(c), Math.abs(s)) ** 0.25)
    return [c * r.hx * k, r.y, s * r.hz * k]
  }
  const N = 28
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < N; i++) {
      const a0 = rr(rings[j], i, N)
      const a1 = rr(rings[j], i + 1, N)
      const b0 = rr(rings[j + 1], i, N)
      const b1 = rr(rings[j + 1], i + 1, N)
      pos.push(...a0, ...b0, ...a1, ...a1, ...b0, ...b1)
    }
  for (const [r, up] of [[rings[0], false], [rings[rings.length - 1], true]] as const)
    for (let i = 0; i < N; i++) {
      const a0 = rr(r, i, N)
      const a1 = rr(r, i + 1, N)
      if (up) pos.push(0, r.y, 0, ...a1, ...a0)
      else pos.push(0, r.y, 0, ...a0, ...a1)
    }
  const bg = new THREE.BufferGeometry()
  bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  // smooth across the corners, so its outline closes
  const bsm = mergeVertices(bg, 1e-4)
  bsm.computeVertexNormals()
  bg.dispose()
  hk.add(bsm, TEAL)
  // the dark mouth under the coins, chrome bands round the rim and the spout, the pins either side
  hk.add(new THREE.CylinderGeometry(1, 1, 0.02, 32), DARK, T([0, rimY + 0.012, 0], [0, 0, 0], [0.8 * S, 1, 0.6 * S]), 0)
  hc.add(new THREE.TorusGeometry(1, 0.06, 8, 48), WHITE, T([0, rimY + 0.02, 0], [Math.PI / 2, 0, 0], [0.84 * S, 0.64 * S, 1]), OUT * 0.5)
  hc.add(new THREE.TorusGeometry(0.25, 0.06, 8, 20), WHITE, T([0, spoutY + 0.04, 0], [Math.PI / 2, 0, 0]), OUT * 0.4)
  hc.add(new THREE.TorusGeometry(1, 0.045, 8, 40), WHITE, T([0, -0.32 * S, 0], [Math.PI / 2, 0, 0], [0.46 * S, 0.37 * S, 1]), OUT * 0.4)
  for (const sx of [-1, 1]) hc.add(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 14), WHITE, T([sx * 0.9 * S, 0, 0], [0, 0, Math.PI / 2]), OUT * 0.5)
  // a gold star on its front, laid on the slope of the bowl
  const sh = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? 0.12 : 0.27
    if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  const starG = new THREE.ExtrudeGeometry(sh, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 })
  hg.add(starG, WHITE, T([0, -0.15 * S, 0.47 * S], [0.58, 0, 0]), OUT * 0.4)
  pivot.add(hk.mesh('hopperBody', mats.toon), hc.mesh('hopperChrome', mats.chrome), hg.mesh('hopperStar', mats.gold))
  // the spout's light: it glows as the coins pour
  const light = new THREE.MeshBasicMaterial({ color: C('#ff3fb4', 1.2), toneMapped: false })
  own.push(light)
  const lg = new THREE.TorusGeometry(0.29, 0.035, 6, 24)
  lg.rotateX(Math.PI / 2)
  const lm = new THREE.Mesh(lg, light)
  lm.position.y = spoutY + 0.13
  pivot.add(lm)
  own.push(lg)
  // the brimming coins: a mound on the mouth, in four layers
  const hcoins: { gold: boolean; m: THREE.Matrix4 }[] = []
  let seed = 41
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const spots: [number, number, number][] = []
  for (let layer = 0; layer < 4; layer++) {
    const n = [16, 11, 6, 1][layer]
    const sx = [0.66, 0.46, 0.26, 0][layer] * S
    const sz = [0.46, 0.32, 0.17, 0][layer] * S
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + layer * 0.7 + rnd() * 0.3
      const r = 0.62 + rnd() * 0.38
      spots.push([Math.cos(a) * sx * r, rimY + 0.04 + layer * 0.1 + rnd() * 0.03, Math.sin(a) * sz * r])
    }
  }
  for (const [x, y, z] of spots) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, rnd() * TAU, (rnd() - 0.5) * 0.6, 'ZXY'))
    hcoins.push({ gold: rnd() < 0.4, m: new THREE.Matrix4().compose(V(x, y + COIN_H / 2, z), q, V(1, 1, 1)) })
  }
  root.add(pivot)

  /* ---- the pushers ---- */
  const stripeT = stripeTexture()
  own.push(stripeT)
  const stripeMat = new THREE.MeshBasicMaterial({ map: stripeT, color: C(WHITE, 0.95) })
  own.push(stripeMat)
  const pusher = (h: number, depth: number, y0: number, name: string, ledA: string): Pusher => {
    const group = new THREE.Group()
    group.name = name
    const pk = new VKit(INK, OUT)
    const pc = new VKit(INK, OUT)
    const w = FIELD_W - 0.1
    pk.add(box(w, h, depth, 0.04), NAVY, T([0, y0 + h / 2, -depth / 2]), OUT * 0.6)
    // a chrome plate on top (flush with the pusher's height: things ride the lower one), a chrome foot
    pc.add(box(w + 0.02, 0.1, depth - 0.05, 0.03), '#8a97b6', T([0, y0 + h - 0.05, -depth / 2 - 0.02]), OUT * 0.5)
    pc.add(box(w + 0.02, 0.08, 0.1, 0.03), WHITE, T([0, y0 + 0.04, -0.04]), OUT * 0.4)
    group.add(pk.mesh(name + 'Body', mats.toon), pc.mesh(name + 'Chrome', mats.chrome))
    const fg = new THREE.PlaneGeometry(w - 0.06, h - 0.24)
    const face = new THREE.Mesh(fg, stripeMat)
    face.position.set(0, y0 + 0.1 + (h - 0.24) / 2, 0.004)
    group.add(face)
    own.push(fg)
    const led = addLed(stripGeo(w - 0.1, 0.07), ledA, '#3a2a10', w, 0.3, 1.2, T([0, y0 + h - 0.07, 0.012]), group)
    return { group, led }
  }
  const upper = pusher(CAB.upperPushH, 3.2, UPPER_Y, 'upperPusher', '#ffd23a')
  upper.group.position.z = UPPER_PUSH_MIN
  const lower = pusher(CAB.lowerPushH, 6.4, 0, 'lowerPusher', '#ffd23a')
  lower.group.position.z = LOWER_PUSH_MIN
  root.add(upper.group, lower.group)

  /* ---- the carriage on the slot rail ---- */
  const carriage = new THREE.Group()
  carriage.name = 'carriage'
  carriage.position.set(0, railY, railZ)
  const ck = new VKit(INK, OUT)
  const cc = new VKit(INK, OUT)
  const nozZ = LAND_Z - railZ
  const cz = nozZ * 0.5
  ck.add(box(1.95, 0.76, 1.1, 0.18), TEAL, T([0, -0.13, cz]))
  ck.add(box(1.55, 0.5, 0.06, 0.06), NAVY_D, T([0, -0.15, cz + 0.55]), OUT * 0.4)
  cc.add(box(2.03, 0.13, 1.15, 0.05), WHITE, T([0, 0.27, cz]), OUT * 0.5)
  cc.add(new THREE.CylinderGeometry(0.34, 0.22, 0.34, 18), WHITE, T([0, -0.62, nozZ]), OUT * 0.5)
  carriage.add(ck.mesh('carriageBody', mats.toon), cc.mesh('carriageChrome', mats.chrome))
  // its coin slot and a down arrow, lit: they glow brighter as a coin goes in
  const carriageLight = new THREE.MeshBasicMaterial({ color: C('#ff3fb4', 1.4), toneMapped: false })
  own.push(carriageLight)
  const slotG = new THREE.PlaneGeometry(1.0, 0.13)
  const slotM = new THREE.Mesh(slotG, carriageLight)
  slotM.position.set(0, -0.03, cz + 0.586)
  carriage.add(slotM)
  const arrowG = new THREE.CircleGeometry(0.17, 3)
  arrowG.rotateZ(-Math.PI / 2)
  const arrowM = new THREE.Mesh(arrowG, carriageLight)
  arrowM.position.set(0, -0.26, cz + 0.586)
  carriage.add(arrowM)
  own.push(slotG, arrowG)
  root.add(carriage)

  /* ---- the glass ---- */
  const glassT = glassTexture()
  own.push(glassT)
  const glass = new THREE.MeshBasicMaterial({ map: glassT, color: '#ffffff', transparent: true, opacity: 0.36, depthWrite: false, blending: THREE.AdditiveBlending })
  own.push(glass)
  const gw = CAB.gutter * 2
  const gh = CAB.top - CAB.glassBottom - 0.05
  plane(gw, gh, glass, T([0, CAB.glassBottom + gh / 2, FZ - 0.02]), 6)
  const tint = new THREE.MeshBasicMaterial({ color: '#bff6ff', transparent: true, opacity: 0.035, depthWrite: false })
  own.push(tint)
  plane(gw, gh, tint, T([0, CAB.glassBottom + gh / 2, FZ - 0.02]), 5)

  /* ---- bake ---- */
  root.add(paint.mesh('cabinetPaint', mats.toon), chrome.mesh('cabinetChrome', mats.chrome), gold.mesh('cabinetGold', mats.gold))
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !own.includes(o.geometry)) own.push(o.geometry)
  })
  return { root, upper, lower, carriage, carriageLight, hopper: { pivot, coins: hcoins, light }, bulbs, bulbAt, marqueeBulbs, leds, display, trayGlow, glass, own }
}

/** where a body's pose puts it in the tray pile when the simulation's track ends above the tray (see scene.ts) */
export const TRAY_BOX = { x0: -TRAY.w / 2 + 0.55, x1: TRAY.w / 2 - 0.55, z0: CAB.edge + 0.45, z1: TRAY.z + TRAY.d / 2 - 0.4, y: TRAY.y }
