import * as THREE from 'three'
import { BUILDINGS, type Building } from '../arena'
import { Lot, type Kit, type PartLook, type Shape, type SignSpec } from './kit'

/*
  The 24 buildings round the plaza that the kaiju knock down (arena.ts BUILDINGS), each kind drawn its own way from
  the kit's parts: office towers in glass ribbons with a mast and its warning light, hotels with tall gold windows
  and a blade sign, casinos with a gold crown and a marquee of chasing bulbs, apartment blocks with balconies and a
  water tank on the roof, round tanks (a gas holder, a water tower on legs, a coolant tank with a glowing band, an oil
  tank), neon billboards on a frame, low shop fronts with awnings, and waterfront warehouses with shipping
  containers. The signs carry the buildings' names where they have one (Lucky Strike, Golden Dragon, the BOJE
  billboard ...).

  A collapse is a pure function of the script time since the building fell, so a replay or a scrub shows it right:
  the building shudders and its lights flicker and die, then every part drops under gravity, drifting away from the
  plaza and tumbling, crumbling smaller as it goes, into a heap of rubble where it stood; a handful of chunks burst
  out and scatter round the heap. Dust, debris and sparks are the effects' job (fx.ts), started by the stage when the
  building falls.
*/

export const COLLAPSE_MS = 2600

interface Piece {
  shape: Shape | 'sign'
  idx: number
  p: THREE.Vector3
  q: THREE.Quaternion
  s: THREE.Vector3
  /** height of its middle over the building's height */
  lvl: number
  seed: number
  /** a chunk: hidden until the collapse throws it out */
  chunk?: boolean
}

interface Ruin {
  lot: Lot
  b: Building
  pieces: Piece[]
  lamps: number[]
  /** the collapse progress last drawn (-1 standing, 1 settled) */
  shown: number
}

const rnd = (s: number) => {
  const x = Math.sin(s * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))

const C = (hex: string) => new THREE.Color(hex)
const WARM: [number, number, number] = [1.55, 1.08, 0.6]
const COOL: [number, number, number] = [0.85, 1.05, 1.45]
const GOLD = '#ffd36b'
const PINK = '#ff4fa3'
const SKY = '#4cc3ff'
const GREEN = '#22d36f'
const VIOLET = '#a46bff'
const ORANGE = '#ff8a3d'

/** each building's signs: text, colour, where (roof, front, blade, street) */
const SIGNS: Record<number, { spec: SignSpec; tint: string; at: 'roof' | 'front' | 'blade' | 'street' | 'board'; flicker?: number }[]> = {
  0: [{ spec: { text: 'PIER 9' }, tint: SKY, at: 'front' }],
  1: [{ spec: { text: 'GAS' }, tint: ORANGE, at: 'front', flicker: 0.3 }],
  2: [{ spec: { text: 'BAYLINE' }, tint: SKY, at: 'roof' }],
  3: [{ spec: { text: 'GRAND NEON', box: true }, tint: PINK, at: 'roof' }, { spec: { text: 'HOTEL', vertical: true }, tint: PINK, at: 'blade' }],
  5: [{ spec: { text: 'KAIJU INSURANCE' }, tint: GREEN, at: 'roof' }],
  6: [{ spec: { text: 'LUCKY STRIKE', sub: 'CASINO', box: true }, tint: GOLD, at: 'front' }],
  7: [{ spec: { text: 'BOJE', sub: 'CASINO', box: true }, tint: GREEN, at: 'board' }],
  8: [{ spec: { text: 'NOODLES' }, tint: GOLD, at: 'street', flicker: 0.6 }],
  10: [{ spec: { text: 'ARCADE' }, tint: SKY, at: 'street' }],
  12: [{ spec: { text: 'PACHINKO' }, tint: PINK, at: 'street', flicker: 0.8 }],
  13: [{ spec: { text: 'KARAOKE' }, tint: VIOLET, at: 'street' }],
  15: [{ spec: { text: 'PAWN' }, tint: GOLD, at: 'street' }],
  16: [{ spec: { text: 'JADE' }, tint: GREEN, at: 'roof' }],
  17: [{ spec: { text: 'ELECTRIC', sub: 'SKY', box: true }, tint: VIOLET, at: 'board' }],
  18: [{ spec: { text: 'GOLDEN DRAGON', sub: 'CASINO', box: true }, tint: '#ffb347', at: 'front' }],
  19: [{ spec: { text: 'STARLIGHT', box: true }, tint: SKY, at: 'roof' }, { spec: { text: 'HOTEL', vertical: true }, tint: SKY, at: 'blade' }],
  21: [{ spec: { text: 'BANK' }, tint: GOLD, at: 'roof' }],
  23: [{ spec: { text: 'FERRY' }, tint: SKY, at: 'front' }],
}

/** every sign the ring uses, for the atlas */
export const RING_SIGNS: SignSpec[] = Object.values(SIGNS).flatMap((l) => l.map((s) => s.spec))

export class Ring {
  readonly ruins: Ruin[] = []
  private dirtyBox = false
  private dirtySign = false
  private dirtyLamp = false
  private readonly kit: Kit
  private readonly low: boolean
  private readonly m = new THREE.Matrix4()
  private readonly lm = new THREE.Matrix4()
  private readonly v = new THREE.Vector3()
  private readonly qa = new THREE.Quaternion()
  private readonly qb = new THREE.Quaternion()
  private readonly sv = new THREE.Vector3()
  private readonly axis = new THREE.Vector3()

  constructor(kit: Kit, low: boolean) {
    this.kit = kit
    this.low = low
    BUILDINGS.forEach((b, i) => this.ruins.push(this.raise(b, i)))
  }

  /* ---------------- building them ---------------- */

  private raise(b: Building, i: number): Ruin {
    const lot = new Lot(b.x, b.z, b.rot)
    const r: Ruin = { lot, b, pieces: [], lamps: [], shown: -1 }
    const H = b.h
    const add = (shape: Shape, x: number, y: number, z: number, sx: number, sy: number, sz: number, look: PartLook, ry = 0, rx = 0, rz = 0) => {
      const idx = this.kit.part(shape, lot.local(x, y, z, sx, sy, sz, ry, rx, rz), look)
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'))
      r.pieces.push({ shape, idx, p: new THREE.Vector3(x, y, z), q, s: new THREE.Vector3(sx, sy, sz), lvl: clamp(y / H, 0, 1), seed: rnd(i * 31 + r.pieces.length * 7.7) })
    }
    const sign = (spec: SignSpec, tint: string, x: number, y: number, z: number, h: number, ry = 0, flicker = 0, maxW = 99) => {
      let w = h * this.kit.aspect(spec)
      if (w > maxW) {
        h *= maxW / w
        w = maxW
      }
      const idx = this.kit.sign(lot.local(x, y, z, w, h, 1, ry), spec, tint, 2.3, flicker)
      r.pieces.push({ shape: 'sign', idx, p: new THREE.Vector3(x, y, z), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), s: new THREE.Vector3(w, h, 1), lvl: clamp(y / H, 0, 1), seed: rnd(i * 13 + r.pieces.length) })
      return { w, h }
    }
    const lamp = (x: number, y: number, z: number, color: THREE.ColorRepresentation, size: number, rate = 0, phase = 0) => r.lamps.push(this.kit.lamp({ p: lot.point(x, y, z), color: new THREE.Color(color), size, rate, phase }))
    const { w, d } = b
    const front = d / 2
    const seed = rnd(i + 0.5)
    const signs = SIGNS[i] ?? []
    const signAt = (at: string) => signs.filter((s) => s.at === at)

    switch (b.kind) {
      case 'tower': {
        const wall = ['#34506e', '#3a4a66', '#2d5a5a', '#4a5878', '#3b4a72'][i % 5]
        const jade = b.name.startsWith('Jade')
        const mirror = b.name.startsWith('Mirror')
        const look: PartLook = { color: jade ? '#2c5e52' : mirror ? '#5a7090' : wall, win: [...(mirror ? [0.9, 1.1, 1.5] : COOL), mirror ? 0.35 : 0.62] as [number, number, number, number], grid: [1.05, 1.0, mirror ? 2 : i % 2 ? 2 : 1] }
        // a lobby, the shaft in storeys of three, a set-back crown with a neon trim, a mast with its warning light
        add('box', 0, 1, 0, w + 0.5, 2, d + 0.5, { color: '#1f2638', win: [1.4, 1.2, 0.8, 1], grid: [1, 1, 4] })
        const top = H - 2.2
        const n = Math.max(2, Math.round((top - 2) / 3))
        const sh = (top - 2) / n
        for (let k = 0; k < n; k++) add('box', 0, 2 + sh * (k + 0.5), 0, w, sh, d, k === n - 1 ? { ...look, trim: jade ? [0.4, 2.4, 1.2, 0.18] : [0.6, 1.6, 2.6, 0.18] } : look)
        add('box', 0, top + 1.1, 0, w * 0.72, 2.2, d * 0.72, { ...look, trim: jade ? [0.4, 2.4, 1.2, 0.25] : [2.4, 0.7, 1.6, 0.25] })
        add('cyl', 0, H + 1.6, 0, 0.22, 3.2, 0.22, { color: '#8b93a6', ink: 0.06 })
        lamp(0, H + 3.3, 0, '#ff3048', 1.1, 0.8, seed)
        for (const s of signAt('roof')) sign(s.spec, s.tint, 0, top + 1.1, d * 0.36 + 0.02, 1.2, 0, s.flicker, w * 0.95)
        break
      }
      case 'hotel': {
        const wall = i === 3 ? '#5a4470' : '#3f4f78'
        const look: PartLook = { color: wall, win: [...WARM, 0.7] as [number, number, number, number], grid: [1.0, 1.25, 3] }
        add('box', 0, 1.3, 0.3, w + 1, 2.6, d + 0.8, { color: '#2a2234', win: [1.6, 1.1, 0.6, 1], grid: [1, 1, 4], trim: [2.6, 1.8, 0.7, 0.14] })
        // a canopy over the door
        add('box', 0, 2.75, front + 1.2, w * 0.55, 0.22, 1.6, { color: '#c9a227', ink: 0.07 })
        const top = H - 1.8
        const n = Math.max(2, Math.round((top - 2.6) / 2.5))
        const sh = (top - 2.6) / n
        for (let k = 0; k < n; k++) add('box', 0, 2.6 + sh * (k + 0.5), 0, w, sh, d, look)
        add('box', 0, top + 0.9, 0, w * 0.85, 1.8, d * 0.85, { ...look, win: [0, 0, 0, 0], grid: [1, 1, 0], color: '#2a2234' })
        for (const s of signAt('roof')) {
          // the name on a frame over the roof
          add('box', 0, H + 0.9, -0.2, w * 0.95, 1.9, 0.25, { color: '#141826', ink: 0.06 })
          sign(s.spec, s.tint, 0, H + 0.9, -0.03, 1.55, 0, 0, w * 0.9)
        }
        for (const s of signAt('blade')) {
          // the blade sign on the front corner, standing out from the wall
          add('box', w / 2 - 0.15, H * 0.55, front + 0.75, 0.3, H * 0.5, 1.3, { color: '#141826', ink: 0.06 })
          sign(s.spec, s.tint, w / 2 - 0.15, H * 0.55, front + 0.75, H * 0.45, Math.PI / 2, 0)
          sign(s.spec, s.tint, w / 2 - 0.15, H * 0.55, front + 0.75, H * 0.45, -Math.PI / 2, 0)
        }
        break
      }
      case 'casino': {
        const wall = i === 6 ? '#6a1f4a' : '#7a2a1e'
        const look: PartLook = { color: wall, win: [1.7, 0.95, 0.5, 0.35], grid: [1.4, 1.4, 1] }
        add('box', 0, 1.2, 0.2, w + 0.4, 2.4, d + 0.4, { color: '#2a1424', win: [1.8, 1.2, 0.6, 1], grid: [1, 1, 4] })
        const bodyH = H * 0.62
        add('box', 0, 2.4 + (bodyH - 2.4) / 4, 0, w, (bodyH - 2.4) / 2, d, look)
        add('box', 0, 2.4 + ((bodyH - 2.4) * 3) / 4, 0, w, (bodyH - 2.4) / 2, d, { ...look, trim: [2.8, 2.0, 0.6, 0.22] })
        // a stepped gold crown with a dome
        add('box', 0, bodyH + 0.6, 0, w * 0.8, 1.2, d * 0.8, { color: '#c9a227', trim: [2.4, 1.6, 0.5, 0.2], ink: 0.09 })
        add('cyl', 0, bodyH + 1.9, 0, w * 0.5, 1.4, w * 0.5, { color: '#d9b440', ink: 0.09 })
        add('cone', 0, bodyH + 3.2, 0, w * 0.52, H - bodyH - 2.6, w * 0.52, { color: '#e8c35a', ink: 0.09 })
        lamp(0, H + 0.6, 0, '#ffd36b', 1.6)
        for (const s of signAt('front')) {
          // the big sign across the front, framed by chasing bulbs
          add('box', 0, bodyH - 1.6, front + 0.25, w * 1.04, 2.8, 0.35, { color: '#140c18', ink: 0.07 })
          const sz = sign(s.spec, s.tint, 0, bodyH - 1.6, front + 0.45, 2.5, 0, 0, w * 0.98)
          const nb = this.low ? 10 : 18
          for (let k = 0; k < nb; k++) {
            const u = k / nb
            const per = 2 * (sz.w + 2.6)
            let x: number
            let y: number
            const at = u * per
            if (at < sz.w) [x, y] = [-sz.w / 2 + at, bodyH - 1.6 + 1.45]
            else if (at < sz.w + 2.6) [x, y] = [sz.w / 2 + 0.25, bodyH - 1.6 + 1.3 - (at - sz.w)]
            else if (at < 2 * sz.w + 2.6) [x, y] = [sz.w / 2 - (at - sz.w - 2.6), bodyH - 1.6 - 1.45]
            else [x, y] = [-sz.w / 2 - 0.25, bodyH - 1.6 - 1.3 + (at - 2 * sz.w - 2.6)]
            lamp(x, y, front + 0.55, '#ffcf6b', 0.55, 1.6, u * 3)
          }
        }
        break
      }
      case 'block': {
        const wall = ['#4f5d6b', '#6b5a48', '#56506e'][i % 3]
        const look: PartLook = { color: wall, win: [...WARM, 0.55] as [number, number, number, number], grid: [1.0, 1.1, 1] }
        const n = Math.max(2, Math.round(H / 2.2))
        const sh = (H - 0.6) / n
        for (let k = 0; k < n; k++) {
          add('box', 0, sh * (k + 0.5), 0, w, sh, d, k === 0 && signAt('street').length ? { ...look, grid: [1, 1, 4], win: [1.6, 1.1, 0.6, 1] } : look)
          // a balcony along the front of each storey above the street
          if (k > 0) add('box', 0, sh * k + 0.08, front + 0.35, w * 0.86, 0.16, 0.7, { color: '#c8c2b8', ink: 0.05 })
        }
        add('box', 0, H - 0.3, 0, w + 0.2, 0.6, d + 0.2, { color: '#2b2f3a', ink: 0.08 })
        // a water tank and an air conditioner on the roof
        add('cyl', -w * 0.22, H + 0.85, -d * 0.15, 1.3, 1.3, 1.3, { color: '#7a6a58', ink: 0.07 })
        add('cone', -w * 0.22, H + 1.75, -d * 0.15, 1.45, 0.6, 1.45, { color: '#5a4a3a', ink: 0.07 })
        add('box', w * 0.25, H + 0.3, d * 0.1, 1.1, 0.6, 0.9, { color: '#9aa3ad', ink: 0.06 })
        for (const s of signAt('street')) {
          add('box', 0, 2.55, front + 0.2, w * 0.9, 1.0, 0.3, { color: '#141826', ink: 0.06 })
          sign(s.spec, s.tint, 0, 2.55, front + 0.38, 0.85, 0, s.flicker, w * 0.85)
        }
        break
      }
      case 'tank': {
        if (b.name === 'Water Tower') {
          for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) add('cyl', lx * 1.25, 1.6, lz * 1.25, 0.28, 3.2, 0.28, { color: '#3a4250', ink: 0.05 })
          add('box', 0, 2.3, 0, 2.9, 0.18, 2.9, { color: '#3a4250', ink: 0.05 })
          add('cyl', 0, H - 1.8, 0, w * 0.85, 2.6, w * 0.85, { color: '#5f86a0', trim: [0.6, 1.4, 2.4, 0.16] })
          add('cone', 0, H - 0.1, 0, w * 0.95, 0.9, w * 0.95, { color: '#40607a' })
          lamp(0, H + 0.5, 0, '#ff3048', 0.8, 0.7, seed)
        } else if (b.name === 'Harbour Gas Works') {
          add('cyl', 0, H * 0.45, 0, w, H * 0.9, w, { color: '#b9b2a2' })
          add('cyl', 0, H * 0.62, 0, w * 1.02, 0.6, w * 1.02, { color: '#d0482f', ink: 0.05 })
          add('cone', 0, H * 0.9 + 0.45, 0, w * 1.0, 0.9, w * 1.0, { color: '#8f897c' })
          // the frame round the holder
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI * 2 + 0.4
            add('box', Math.cos(a) * w * 0.56, H * 0.5, Math.sin(a) * w * 0.56, 0.18, H, 0.18, { color: '#5a5550', ink: 0.04 })
          }
          for (const s of signAt('front')) sign(s.spec, s.tint, 0, H * 0.4, w / 2 + 0.06, 1.1, 0, s.flicker)
        } else if (b.name === 'Coolant Tank') {
          add('cyl', 0, H * 0.45, 0, w, H * 0.9, w, { color: '#3f5f58' })
          add('cyl', 0, H * 0.45, 0, w * 1.03, 0.55, w * 1.03, { color: '#1c2a26', trim: [0.4, 2.6, 1.0, 0.55], ink: 0.04 })
          add('cyl', 0, H * 0.75, 0, w * 1.03, 0.4, w * 1.03, { color: '#1c2a26', trim: [0.4, 2.6, 1.0, 0.4], ink: 0.04 })
          add('cone', 0, H * 0.9 + 0.35, 0, w, 0.7, w, { color: '#2e4842' })
          lamp(0, H + 0.2, 0, '#7dff9a', 0.9, 0.5, seed)
        } else {
          add('cyl', 0, H * 0.45, 0, w * 1.05, H * 0.9, w * 1.05, { color: '#2f3640' })
          add('cyl', 0, H * 0.7, 0, w * 1.08, 0.5, w * 1.08, { color: '#f7c548', ink: 0.04 })
          add('cone', 0, H * 0.9 + 0.25, 0, w * 1.05, 0.5, w * 1.05, { color: '#262c35' })
          add('box', w * 0.53, H * 0.45, 0, 0.18, H * 0.9, 0.5, { color: '#5a6270', ink: 0.04 })
        }
        break
      }
      case 'neon': {
        const postH = H * 0.5
        for (const px of [-w * 0.35, w * 0.35]) add('box', px, postH / 2, 0, 0.35, postH, 0.35, { color: '#2a3140', ink: 0.06 })
        add('box', 0, postH, 0, w * 0.95, 0.3, 0.5, { color: '#2a3140', ink: 0.06 })
        const sh = H - postH - 0.4
        add('box', 0, postH + 0.2 + sh / 2, -0.15, w * 1.08, sh, 0.4, { color: '#121522', ink: 0.08 })
        for (const s of signAt('board')) {
          sign(s.spec, s.tint, 0, postH + 0.2 + sh / 2, 0.08, sh * 0.86, 0, 0, w * 1.0)
          sign(s.spec, s.tint, 0, postH + 0.2 + sh / 2, -0.38, sh * 0.86, Math.PI, 0, w * 1.0)
        }
        for (let k = 0; k < 6; k++) lamp(-w * 0.45 + (k / 5) * w * 0.9, postH + 0.32, 0.35, '#fff3d6', 0.5, 0.9, k / 6)
        break
      }
      case 'shop': {
        const wall = ['#1f6f78', '#8a2f6a', '#9a5a22', '#4a3a8a'][i % 4]
        add('box', 0, H / 2, 0, w, H, d, { color: wall, win: [1.7, 1.25, 0.75, 1], grid: [1, 1, 4] })
        add('box', 0, H + 0.12, 0, w + 0.2, 0.24, d + 0.2, { color: '#2b2f3a', ink: 0.07 })
        // a striped awning over the window
        const aw = ['#ff4fa3', '#22d36f', '#ffd36b', '#4cc3ff'][i % 4]
        add('box', 0, H * 0.7, front + 0.7, w * 0.92, 0.18, 1.5, { color: aw, ink: 0.06 }, 0, 0.35)
        add('box', w * 0.2, H + 0.5, -d * 0.15, 1.0, 0.6, 0.8, { color: '#9aa3ad', ink: 0.06 })
        for (const s of signAt('street')) {
          add('box', 0, H + 0.75, front - 0.2, w * 0.95, 1.2, 0.25, { color: '#141826', ink: 0.06 })
          sign(s.spec, s.tint, 0, H + 0.75, front - 0.05, 1.0, 0, s.flicker, w * 0.9)
        }
        break
      }
      case 'depot': {
        const wall = i === 0 ? '#5b5248' : '#4a5560'
        const bodyH = H * 0.72
        add('box', 0, bodyH / 2, 0, w, bodyH, d, { color: wall, win: [1.3, 1.1, 0.7, 0.4], grid: [2.2, 2.2, 1] })
        // the pitched roof: two slabs meeting along the ridge
        const rh = H - bodyH
        const half = d / 2
        const slope = Math.atan2(rh, half)
        const len = Math.hypot(rh, half) + 0.2
        add('box', 0, bodyH + rh / 2, half / 2, w + 0.3, 0.3, len, { color: '#3a3530', ink: 0.08 }, 0, slope)
        add('box', 0, bodyH + rh / 2, -half / 2, w + 0.3, 0.3, len, { color: '#3a3530', ink: 0.08 }, 0, -slope)
        // the big door, lit inside
        add('box', 0, bodyH * 0.35, front + 0.02, w * 0.45, bodyH * 0.68, 0.1, { color: '#20232c', win: [1.5, 1.1, 0.6, 1], grid: [1, 1, 4], ink: 0 })
        // shipping containers stacked beside it
        const cc = ['#a8432f', '#2e6e9e', '#c99a2e', '#2e8a5a']
        add('box', -w / 2 - 1.5, 0.7, 0.6, 2.4, 1.4, 4.4, { color: cc[i % 4], ink: 0.07 })
        add('box', -w / 2 - 1.5, 2.1, 0.3, 2.4, 1.4, 4.4, { color: cc[(i + 1) % 4], ink: 0.07 })
        for (const s of signAt('front')) {
          add('box', 0, bodyH + 0.1, front + 0.2, w * 0.6, 1.0, 0.25, { color: '#141826', ink: 0.06 })
          sign(s.spec, s.tint, 0, bodyH + 0.1, front + 0.36, 0.85, 0, s.flicker, w * 0.55)
        }
        break
      }
    }
    // the chunks a collapse throws out (hidden until then)
    const wallOf = r.pieces.find((p) => p.shape === 'box')
    const chunkColor = wallOf ? new THREE.Color().fromArray(this.kit.batches.box.col, wallOf.idx * 3).multiplyScalar(0.8) : C('#555')
    for (let k = 0; k < (this.low ? 4 : 8); k++) {
      const idx = this.kit.part('box', new THREE.Matrix4().makeScale(0, 0, 0), { color: chunkColor, ink: 0.06 })
      r.pieces.push({ shape: 'box', idx, p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), lvl: rnd(i * 5 + k), seed: rnd(i * 17 + k * 3.3), chunk: true })
    }
    return r
  }

  /* ---------------- knocking them down ---------------- */

  /**
   * Every building as it is at script time `st`: `fallAt(i)` is when building i falls (Infinity if it doesn't). Only
   * the buildings whose state changed are written.
   */
  update(st: number, fallAt: (i: number) => number) {
    this.ruins.forEach((r, i) => {
      const at = fallAt(i)
      const k = st < at ? -1 : Math.min(1, (st - at) / COLLAPSE_MS)
      if (k === r.shown) return
      if (k === 1 && r.shown === 1) return
      r.shown = k
      this.draw(r, k < 0 ? -1 : (st - at) / 1000)
    })
    const b = this.kit.batches
    if (this.dirtyBox) {
      for (const s of ['box', 'cyl', 'cone'] as const) {
        b[s].mesh.instanceMatrix.needsUpdate = true
        b[s].darkAttr.needsUpdate = true
      }
      this.dirtyBox = false
    }
    if (this.dirtySign) {
      this.kit.signMesh.instanceMatrix.needsUpdate = true
      this.kit.signDark.needsUpdate = true
      this.dirtySign = false
    }
    if (this.dirtyLamp) {
      this.kit.lampOn.needsUpdate = true
      this.dirtyLamp = false
    }
  }

  /** a building T seconds into its collapse (T < 0: standing) */
  private draw(r: Ruin, T: number) {
    const kit = this.kit
    const H = r.b.h
    // the lights flicker and die in the first moments
    const lit = T < 0 ? 1 : T < 0.4 ? (rnd(Math.floor(T * 24) + r.b.x) > 0.45 ? 1 - T / 0.4 : 0) : 0
    for (const l of r.lamps) (kit.lampOn.array as Float32Array)[l] = T < 0 ? 1 : 0
    this.dirtyLamp = true
    for (const pc of r.pieces) {
      if (T < 0) {
        if (pc.chunk) this.m.makeScale(0, 0, 0)
        else this.m.compose(pc.p, pc.q, pc.s)
      } else if (pc.chunk) this.chunk(pc, T, H)
      else this.fall(pc, T, H)
      this.lm.multiplyMatrices(r.lot.m, this.m)
      if (pc.shape === 'sign') {
        kit.signMesh.setMatrixAt(pc.idx, this.lm)
        ;(kit.signDark.array as Float32Array)[pc.idx] = lit
        this.dirtySign = true
      } else {
        const bt = kit.batches[pc.shape]
        bt.mesh.setMatrixAt(pc.idx, this.lm)
        ;(bt.darkAttr.array as Float32Array)[pc.idx] = lit
        this.dirtyBox = true
      }
    }
  }

  /** a part of the building dropping into the heap: gravity, a drift away from the plaza (local -z), a tumble, a crumble */
  private fall(pc: Piece, T: number, H: number) {
    const s = pc.seed
    const shudder = T < 0.3 ? Math.sin(T * 70 + s * 20) * 0.12 * (1 - T / 0.3) : 0
    const delay = 0.12 + (1 - pc.lvl) * 0.12 * rnd(s * 3) + pc.lvl * 0.05
    const tt = Math.max(0, T - delay)
    const g = 32
    const y0 = pc.p.y
    // the heap: the low parts rest low, the high ones a little higher, all somewhat squashed
    const rest = 0.25 + pc.lvl * Math.min(2.6, H * 0.14) + rnd(s * 5) * 0.6
    const drop = Math.max(0, y0 - rest)
    const tl = Math.sqrt((2 * drop) / g)
    const tf = Math.min(tt, tl)
    const y = y0 - 0.5 * g * tf * tf
    const out = (0.8 + 2.4 * rnd(s * 7)) * (0.3 + pc.lvl)
    const side = (rnd(s * 11) - 0.5) * 3.2 * (0.2 + pc.lvl)
    this.v.set(pc.p.x + side * tf + shudder, y, pc.p.z - out * tf + shudder * 0.6)
    // a tumble about a random axis, settling where it lands
    this.axis.set(rnd(s * 13) - 0.5, rnd(s * 17) * 0.3, rnd(s * 19) - 0.5).normalize()
    const ang = (0.4 + 1.6 * rnd(s * 23)) * (0.3 + pc.lvl) * Math.min(1, tf / Math.max(0.2, tl)) * (pc.shape === 'sign' ? 1.6 : 1)
    this.qa.setFromAxisAngle(this.axis, ang)
    this.qb.copy(this.qa).multiply(pc.q)
    const crumble = 1 - 0.38 * Math.min(1, tt / (tl + 0.35))
    this.sv.copy(pc.s).multiplyScalar(crumble)
    // tall slabs settle flatter than they stood
    if (pc.shape !== 'sign') this.sv.y *= 1 - 0.3 * Math.min(1, tt / (tl + 0.2))
    this.m.compose(this.v, this.qb, this.sv)
  }

  /** a chunk thrown out of the building, landing round the heap */
  private chunk(pc: Piece, T: number, H: number) {
    const s = pc.seed
    const t0 = 0.15 + rnd(s * 2) * 0.35
    const tt = T - t0
    if (tt < 0) {
      this.m.makeScale(0, 0, 0)
      return
    }
    const g = 30
    const y0 = H * (0.3 + 0.6 * pc.lvl)
    const vx = (rnd(s * 3) - 0.5) * 9
    const vy = 2 + rnd(s * 5) * 6
    // mostly away from the plaza (local -z), a few tumbling out the front
    const vz = -(1 + rnd(s * 7) * 5) + (rnd(s * 9) < 0.3 ? 4.5 : 0)
    // when it hits the ground (y = 0.35): solve y0 + vy t - g t²/2 = 0.35
    const tl = (vy + Math.sqrt(vy * vy + 2 * g * (y0 - 0.35))) / g
    const tf = Math.min(tt, tl)
    this.v.set(vx * tf, y0 + vy * tf - 0.5 * g * tf * tf, vz * tf)
    this.axis.set(rnd(s * 11) - 0.5, rnd(s * 13) - 0.5, rnd(s * 17) - 0.5).normalize()
    this.qa.setFromAxisAngle(this.axis, tf * (4 + rnd(s * 19) * 6))
    const sz = 0.45 + rnd(s * 23) * 0.7
    this.sv.set(sz, sz * 0.7, sz * 0.9).multiplyScalar(Math.min(1, tt * 6))
    this.m.compose(this.v, this.qa, this.sv)
  }

  /** where a building is and how big, for the effects */
  centre(i: number) {
    const b = BUILDINGS[i]
    return new THREE.Vector3(b.x, b.h * 0.5, b.z)
  }

  /** stands every building up again (a new round) */
  reset() {
    this.update(-Infinity, () => Infinity)
  }
}
