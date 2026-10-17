import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { T, VKit, ellipsePts, type P2, type P3 } from '../../lib/three/toon'
import { C, INK, SHINE, TAU, V, arc, ballEye, flatShape, hash, joint, lathe, limb, morphTo, path3, restOf, rope, rrect, slab, smooth, sphere, star, tint, tubeR } from './kit'
import { castMaterial, clothMaterial, goldMaterial, lampHaloMaterial, lampMaterial } from './mats'
import { FONT, canvasTexture, goldText } from './labels'
import { BONE, BRASS, BRASS_D, ROPE_A, ROPE_B, TOOTH_GOLD, clothDecal, clothGeo, flatDecal, jolly, stripPts, waveCloth } from './pieces'

/*
  The Plunder Bay stage pieces: the carved wooden frame round the reels (rope, brass, the ways counter plaque that
  Captain Polly perches on), the gold multiplier medallion of the Treasure Hunt, lanterns, gulls, and a ship's deck
  kit (planks, rail, mast with a sail and a flag, barrels, a crate, a cannon, a treasure chest, the helm). All of it
  is VKit toon geometry in the stage material (castMaterial(true), never clipped), outlined in ink like the cast.
*/

const WOOD = '#8f4e2a'
const WOOD_L = '#b06a3a'
const WOOD_D = '#5f2f17'
const GRAIN = '#6d3a1d'
const IRON = '#3d3a4a'
const STAGE_INK = 0.026
const smat = () => castMaterial(true)
const box = (w: number, h: number, d: number, r = 0.04, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))

/** wood grain on a flat front face (z) of a w × h board centred on (cx, cy): long thin darker streaks and a knot */
function grain(k: VKit, cx: number, cy: number, w: number, h: number, z: number, seed: number, along: 'x' | 'y' = 'x', color = GRAIN) {
  const L = along === 'x' ? w : h
  const S = along === 'x' ? h : w
  const n = Math.max(2, Math.round(S / 0.09))
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5
    const a0 = -0.5 + 0.35 * hash(seed, i)
    const a1 = 0.5 - 0.3 * hash(seed + 7, i)
    if (a1 - a0 < 0.2) continue
    const pts: P2[] = Array.from({ length: 6 }, (_, j) => {
      const v = a0 + ((a1 - a0) * j) / 5
      const wob = 0.012 * Math.sin(v * 9 + seed + i)
      return along === 'x' ? [cx + v * L, cy + u * S * 0.86 + wob] : [cx + u * S * 0.86 + wob, cy + v * L]
    })
    k.add(flatShape(stripPts(pts, 0.012), z), color, undefined, 0, true)
  }
  if (L > 0.8) {
    const kx = along === 'x' ? cx + (hash(seed, 3) - 0.5) * L * 0.6 : cx + (hash(seed, 4) - 0.5) * S * 0.4
    const ky = along === 'x' ? cy + (hash(seed, 5) - 0.5) * S * 0.4 : cy + (hash(seed, 6) - 0.5) * L * 0.6
    k.add(flatShape(ellipsePts(kx, ky, 0.035, 0.022, 10), z + 0.0005), color, undefined, 0, true)
    k.add(flatShape(ellipsePts(kx, ky, 0.016, 0.009, 8), z + 0.001), WOOD_D, undefined, 0, true)
  }
}

/** a brass rivet facing +z at p */
function rivet(k: VKit, p: P3, r = 0.03) {
  k.add(new THREE.SphereGeometry(1, 8, 4, 0, TAU, 0, Math.PI / 2), BRASS, T(p, [Math.PI / 2, 0, 0], [r, r * 0.6, r]), 0.012)
}

/** a rounded rectangle path (closed) for ropes round a w × h rectangle centred on (cx, cy) at depth z */
function rectPath(cx: number, cy: number, w: number, h: number, r: number, z: number) {
  return new THREE.CatmullRomCurve3(
    rrect(cx, cy, w, h, r, 4).map(([x, y]) => V(x, y, z)),
    true,
    'centripetal',
  )
}

/* ------------------------------------------------------------------ */
/*  Text: the ways counter and the multiplier                           */
/* ------------------------------------------------------------------ */

/** "117,649" with thousands commas */
export const formatWays = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * The ways counter's lettering: the number in big engraved gold and WAYS in cream, on a transparent canvas laid over
 * the plaque's dark panel. set() redraws only when the text changes, so it can count up every frame.
 */
export class WaysBoard {
  readonly texture: THREE.CanvasTexture
  readonly material: THREE.MeshBasicMaterial
  readonly mesh: THREE.Mesh
  private text = ''
  private readonly g: CanvasRenderingContext2D
  private flashV = 0

  constructor(width: number, height: number, ways = 117649) {
    const W = 1024
    const H = Math.round((W * height) / width)
    this.texture = canvasTexture(W, H, `800 100px ${FONT}`, (g) => this.draw(g))
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d')!
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false })
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this.material)
    this.mesh.name = 'waysText'
    this.mesh.renderOrder = 2
    this.set(ways)
  }

  /** shows `ways` (a number, or any short text such as "FREE SPINS") */
  set(ways: number | string, flash = this.flashV) {
    const text = typeof ways === 'number' ? formatWays(ways) : ways
    if (text === this.text && flash === this.flashV) return
    this.text = text
    this.flashV = flash
    this.draw(this.g)
    this.texture.needsUpdate = true
  }

  private draw(g: CanvasRenderingContext2D) {
    const W = g.canvas.width
    const H = g.canvas.height
    g.clearRect(0, 0, W, H)
    if (!this.text) return
    const isNum = /^[\d,]+$/.test(this.text)
    const f = this.flashV
    const face: [string, string, string] = f > 0 ? ['#ffffff', '#fff1a0', '#ffc93d'] : ['#fff3b0', '#ffc93d', '#d9821c']
    if (isNum) {
      // the number big, WAYS beside it at two thirds of its height, so the headline mechanic reads on a phone
      const NUM = 0.72
      const WORD = 0.47
      g.font = `800 ${H * NUM}px ${FONT}`
      const wNum = g.measureText(this.text).width
      g.font = `800 ${H * WORD}px ${FONT}`
      const wWays = g.measureText('WAYS').width
      const gap = H * 0.12
      const total = wNum + gap + wWays
      const scale = Math.min(1, (W * 0.94) / total)
      const x0 = W / 2 - (total * scale) / 2
      goldText(g, this.text, x0 + (wNum * scale) / 2, H * 0.53, H * NUM * scale, W, { face, rimW: 0.15 })
      g.save()
      g.font = `800 ${H * WORD * scale}px ${FONT}`
      g.textAlign = 'left'
      g.textBaseline = 'middle'
      g.lineJoin = 'round'
      g.lineWidth = H * 0.08 * scale
      g.strokeStyle = '#2a1206'
      const xw = x0 + (wNum + gap) * scale
      g.strokeText('WAYS', xw, H * 0.56)
      g.fillStyle = f > 0 ? '#ffffff' : '#ffe9c2'
      g.fillText('WAYS', xw, H * 0.56)
      g.restore()
    } else goldText(g, this.text, W / 2, H * 0.53, H * 0.6, W * 0.92, { face, rimW: 0.15 })
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.mesh.geometry.dispose()
  }
}

/** how far the name scroll's band rises in its middle */
const SCROLL_BULGE = 0.1

/**
 * The game's name on a parchment scroll that arches over the ways plaque: a cream band with rolled ends and darker
 * forked tails behind, PLUNDER BAY lettered in deep red-brown along the arch. `root` is centred on the band.
 */
export class NameScroll {
  readonly root = new THREE.Group()
  private readonly texture: THREE.CanvasTexture
  private readonly material: THREE.MeshBasicMaterial
  private readonly textGeo: THREE.PlaneGeometry

  constructor(halfL = 1.45, half = 0.19) {
    const L = halfL
    const lift = (x: number) => SCROLL_BULGE * (1 - (x / L) ** 2)
    const k = new VKit(INK, STAGE_INK)
    // the band: between two parallel arches
    const n = 16
    const band: P2[] = []
    for (let i = 0; i <= n; i++) {
      const x = -L + (2 * L * i) / n
      band.push([x, half + lift(x)])
    }
    for (let i = n; i >= 0; i--) {
      const x = -L + (2 * L * i) / n
      band.push([x, -half + lift(x)])
    }
    k.add(slab(band, 0.035, 0.012, 2), '#f6e1ad')
    // darker edges along the top and bottom of the band
    for (const s of [-1, 1]) {
      const edge: P2[] = []
      for (let i = 0; i <= n; i++) {
        const x = -L * 0.97 + (1.94 * L * i) / n
        edge.push([x, s * (half - 0.035) + lift(x)])
      }
      k.add(flatShape(stripPts(edge, 0.022), 0.03), '#ddb36a', undefined, 0, true)
    }
    // forked tails behind each end, folded back
    for (const s of [-1, 1]) {
      const x0 = s * (L - 0.05)
      const tail: P2[] = [
        [x0, half * 0.85],
        [x0 + s * 0.42, half * 0.7 - 0.06],
        [x0 + s * 0.3, -0.02],
        [x0 + s * 0.44, -half - 0.14],
        [x0, -half * 0.85],
      ]
      k.add(slab(tail, 0.03, 0.01, 2), '#d9a85f', T([0, -0.06, -0.06]))
      // the fold's shadow where the tail tucks under the band
      k.add(flatShape(stripPts([[x0 + s * 0.02, half * 0.6 - 0.06], [x0 + s * 0.02, -half * 0.6 - 0.06]], 0.05), -0.02), '#a8733a', undefined, 0, true)
    }
    // the rolled ends: parchment wound round, a brown spiral on top
    for (const s of [-1, 1]) {
      const x = s * L
      k.add(smooth(new THREE.CylinderGeometry(0.075, 0.075, 2 * half + 0.1, 14, 1)), '#ecc888', T([x, 0, 0.03]))
      const sp: P2[] = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 13) * Math.PI * 3
        const rr = 0.008 + (i / 13) * 0.05
        return [Math.cos(a) * rr, Math.sin(a) * rr]
      })
      k.add(flatShape(stripPts(sp, 0.009), 0.001), '#a2703c', T([x, half + 0.051, 0.03], [-Math.PI / 2, 0, 0]), 0, true)
      k.add(new THREE.SphereGeometry(1, 6, 4), SHINE, T([x - s * 0.03, 0.04, 0.1], [0, 0, 0], [0.01, half * 0.7, 0.005]), 0, true)
    }
    this.root.add(k.mesh('scroll', smat()))
    // the lettering, on a plane bent along the arch
    const tw = 2 * L - 0.24
    const th = 2 * half - 0.06
    this.textGeo = new THREE.PlaneGeometry(tw, th, 24, 1)
    const p = this.textGeo.getAttribute('position')
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) + lift(p.getX(i)))
    this.texture = canvasTexture(1024, Math.round((1024 * th) / tw), `800 100px ${FONT}`, (g) => this.draw(g))
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false })
    const text = new THREE.Mesh(this.textGeo, this.material)
    text.position.z = 0.0475
    text.renderOrder = 2
    this.root.add(text)
  }

  private draw(g: CanvasRenderingContext2D) {
    const W = g.canvas.width
    const H = g.canvas.height
    g.clearRect(0, 0, W, H)
    const text = 'PLUNDER BAY'
    let size = H * 0.78
    const track = 0.08
    const width = () => {
      g.font = `800 ${size}px ${FONT}`
      return g.measureText(text).width + track * size * (text.length - 1)
    }
    const w0 = width()
    if (w0 > W * 0.96) size *= (W * 0.96) / w0
    const w = width()
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.lineJoin = 'round'
    const each = (fn: (ch: string, x: number) => void) => {
      let x = W / 2 - w / 2
      for (const ch of text) {
        fn(ch, x)
        x += g.measureText(ch).width + track * size
      }
    }
    const y = H * 0.55
    // a cream highlight below, the letters in deep red-brown, a darker edge above: carved into the parchment
    g.fillStyle = 'rgba(255, 248, 225, 0.9)'
    each((ch, x) => g.fillText(ch, x, y + size * 0.05))
    const grad = g.createLinearGradient(0, y - size * 0.4, 0, y + size * 0.4)
    grad.addColorStop(0, '#8a2a14')
    grad.addColorStop(1, '#4e1407')
    g.fillStyle = grad
    each((ch, x) => g.fillText(ch, x, y))
  }

  dispose() {
    this.texture.dispose()
    this.material.dispose()
    this.textGeo.dispose()
  }
}

/** the perch rail Captain Polly stands on, its foot at the origin; she stands PERCH_Y above it */
const PERCH_Y = 0.084
function buildPerchRail() {
  const k = new VKit(INK, STAGE_INK)
  for (const s of [-1, 1]) {
    k.add(new THREE.CylinderGeometry(0.03, 0.04, 0.09, 10), WOOD_D, T([s * 0.27, 0.02, 0]))
    k.add(sphere(10, 8), BRASS, T([s * 0.355, 0.05, 0], [0, 0, 0], 0.045), 0.014)
  }
  k.add(capsule2(0.034, 0.66), WOOD, T([0, 0.05, 0], [0, 0, Math.PI / 2]))
  return k.mesh('perch', smat())
}

/* ------------------------------------------------------------------ */
/*  The frame                                                           */
/* ------------------------------------------------------------------ */

export interface FrameOptions {
  /** the reel window (inside the frame), centred on the origin: width and height in scene units */
  w: number
  h: number
  /** reel count, for the dividers between them (6) */
  cols?: number
  /** the wooden border's width (0.36) */
  border?: number
  /** the plaque's width (min(3, 0.55 w)) */
  plaqueW?: number
}

export interface FrameRig {
  root: THREE.Group
  /** the carved border, rope, brass corners and the plaque, one mesh */
  wood: THREE.Mesh
  /** dark sea-blue planks behind the reels, one per reel (z -0.45); swap it or hide it as you like */
  back: THREE.Mesh
  /** thin brass-capped slats between the reels (z -0.32) */
  dividers: THREE.Mesh
  /** the ways counter's lettering on the plaque: rig.ways.set(n) */
  ways: WaysBoard
  /** the plaque (header) group; the counter is in it: pulse its scale when the ways change */
  plaque: THREE.Group
  /** the perch rail Polly stands on (its foot at its origin; she stands rig.perchY above it): place it on the top
   *  beam beside the plaque (rig.perchAt is the default spot) */
  perchRail: THREE.Mesh
  perchY: number
  perchAt: THREE.Vector3
  /** where Captain Polly's feet go at the default spot (perchAt + perchY) */
  perch: THREE.Vector3
  /** the game's name on a scroll arching over the plaque (dispose() it with the frame) */
  title: NameScroll
  /** the hooks at the frame's top corners where lanterns hang (buildLantern's origin is its ring) */
  hooks: THREE.Vector3[]
  /** extents: outer half width, the border's top and bottom, the plaque's top and half width (scroll ends included),
   *  the name scroll's top, and the front face's z */
  size: { halfW: number; top: number; bottom: number; plaqueTop: number; plaqueHalfW: number; titleTop: number; front: number }
}

/**
 * The carved frame round a w × h reel window: thick beams of warm wood with grain and brass rivets, a twisted rope
 * round the window, brass compass bosses on the corners, iron lantern hooks, and on top a carved plaque with scroll
 * ends, a dark panel for the ways counter and a perch rail for Captain Polly.
 */
export function buildFrame(o: FrameOptions): FrameRig {
  const { w, h } = o
  const cols = o.cols ?? 6
  const B = o.border ?? 0.36
  const D = 0.32
  const zc = 0.05
  const front = zc + D / 2
  const k = new VKit(INK, STAGE_INK)
  const ow = w + 2 * B
  // a darker lip behind, so the frame has a carved edge
  k.add(slab(rrect(0, -0.04, ow + 0.1, h + 2 * B + 0.18, 0.08, 3), D * 0.5, 0.02, 4, [rrect(0, 0, w - 0.1, h - 0.1, 0.04, 2).reverse()]), WOOD_D, T([0, 0, zc - D * 0.3]))
  // the four beams (the bottom one a little deeper)
  const beams: [number, number, number, number, 'x' | 'y'][] = [
    [0, h / 2 + B / 2, ow, B, 'x'],
    [0, -h / 2 - (B + 0.08) / 2, ow, B + 0.08, 'x'],
    [-(w / 2 + B / 2), 0, B, h + 0.02, 'y'],
    [w / 2 + B / 2, 0, B, h + 0.02, 'y'],
  ]
  beams.forEach(([x, y, bw, bh, al], i) => {
    k.add(box(bw, bh, D, 0.05), WOOD, T([x, y, zc]))
    // a raised, lighter band carved along the middle of the beam
    const bandW = al === 'x' ? bw - 0.62 : bw * 0.42
    const bandH = al === 'x' ? bh * 0.42 : bh - 0.62
    k.add(box(bandW, bandH, 0.05, 0.025, 2), '#b06b3c', T([x, y, front + 0.012]))
    grain(k, x, y, bandW - 0.06, bandH - 0.04, front + 0.0375, i * 13 + 5, al, '#8a5130')
    grain(k, x, y, bw - 0.1, bh - 0.1, front + 0.001, i * 13 + 1, al)
    // a lighter bevel along the top (or inner) edge
    if (al === 'x') k.add(flatShape(stripPts([[x - bw / 2 + 0.06, y + bh / 2 - 0.035], [x + bw / 2 - 0.06, y + bh / 2 - 0.035]], 0.022), front + 0.0012), WOOD_L, undefined, 0, true)
    else k.add(flatShape(stripPts([[x - Math.sign(x) * (bw / 2 - 0.035), y - bh / 2 + 0.06], [x - Math.sign(x) * (bw / 2 - 0.035), y + bh / 2 - 0.06]], 0.022), front + 0.0012), WOOD_L, undefined, 0, true)
  })
  // brass straps across the beams, two rivets each
  const strap = (cx: number, cy: number, vertical: boolean) => {
    const sw = vertical ? 0.075 : B + 0.02
    const sh = vertical ? B + 0.02 : 0.075
    const sd = 2 * (front + 0.052 - zc)
    k.add(box(sw, sh, sd, 0.015, 1), BRASS_D, T([cx, cy, zc]), 0.014)
    k.add(flatShape(stripPts(vertical ? [[cx - 0.02, cy - sh / 2 + 0.03], [cx - 0.02, cy + sh / 2 - 0.03]] : [[cx - sw / 2 + 0.03, cy + 0.02], [cx + sw / 2 - 0.03, cy + 0.02]], 0.014), zc + sd / 2 + 0.001), '#ffd77a', undefined, 0, true)
    for (const d of [-1, 1]) rivet(k, vertical ? [cx, cy + d * (B / 2 - 0.07), zc + sd / 2] : [cx + d * (B / 2 - 0.07), cy, zc + sd / 2], 0.024)
  }
  for (const fx of [-0.3, 0.3]) {
    strap(fx * w, h / 2 + B / 2, true)
    strap(fx * w, -h / 2 - (B + 0.08) / 2, true)
  }
  for (const fy of [-0.25, 0.25]) for (const s of [-1, 1]) strap(s * (w / 2 + B / 2), fy * h, false)
  // the rope round the window
  k.add(rope(rectPath(0, 0, w + 0.06, h + 0.06, 0.12, front - 0.03), 0.05, ROPE_A, ROPE_B, 5, Math.round((w + h) * 2 * 26), 7, true), '#ffffff', undefined, 0.02)
  // brass compass bosses on the corners
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const c: P3 = [sx * (w / 2 + B / 2), sy * (h / 2 + B / 2) - (sy < 0 ? 0.04 : 0), front + 0.02]
      k.add(new THREE.CylinderGeometry(0.22, 0.24, 0.06, 24), BRASS_D, T(c, [Math.PI / 2, 0, 0]), 0.02)
      k.add(new THREE.TorusGeometry(0.2, 0.025, 6, 24), BRASS, T([c[0], c[1], c[2] + 0.03]), 0.016)
      k.add(flatShape(ellipsePts(c[0], c[1], 0.175, 0.175, 24), c[2] + 0.031), '#1b2b4a', undefined, 0, true)
      k.add(flatShape(star(c[0], c[1], 0.16, 0.035, 4), c[2] + 0.033), BRASS, undefined, 0, true)
      k.add(flatShape(star(c[0], c[1], 0.09, 0.025, 4, Math.PI / 4), c[2] + 0.034), '#ffe9a8', undefined, 0, true)
      k.add(new THREE.SphereGeometry(0.03, 8, 6), TOOTH_GOLD, T([c[0], c[1], c[2] + 0.04]), 0.01)
    }
  // iron lantern hooks out of the sides near the top
  const hooks: THREE.Vector3[] = []
  for (const s of [-1, 1]) {
    const bx = s * (ow / 2 - 0.02)
    const by = h / 2 - 0.35
    k.add(tubeR(path3([[bx, by, zc + 0.05], [bx + s * 0.22, by + 0.02, zc + 0.08], [bx + s * 0.4, by - 0.02, zc + 0.12]]), () => 0.02, 8, 6), IRON, undefined, 0.014)
    k.add(new THREE.TorusGeometry(0.035, 0.01, 5, 10, Math.PI * 1.4), IRON, T([bx + s * 0.4, by - 0.05, zc + 0.12], [0, 0, -Math.PI * 0.2]), 0.01)
    k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), IRON, T([bx, by, zc + 0.04], [Math.PI / 2, 0, 0]), 0.012)
    hooks.push(V(bx + s * 0.4, by - 0.08, zc + 0.12))
  }

  // the plaque on top, for the ways counter, with scroll ends
  const PW = o.plaqueW ?? Math.min(3.2, w * 0.55)
  const PH = 0.8
  const py = h / 2 + B + PH / 2 - 0.12
  const pz = zc + 0.06
  k.add(box(PW, PH, D * 0.8, 0.08), WOOD_L, T([0, py, pz]))
  const pf = pz + (D * 0.8) / 2
  k.add(box(PW - 0.22, PH - 0.2, 0.04, 0.05), '#14223a', T([0, py, pf]))
  grain(k, 0, py, PW - 0.1, PH - 0.08, pf + 0.0005, 77, 'x', '#9a5a30')
  for (const sx of [-1, 1]) {
    // the scroll ends: a rolled curl of wood on each side
    const cx = sx * (PW / 2 + 0.05)
    const pts: P3[] = Array.from({ length: 18 }, (_, i) => {
      const a = (i / 17) * Math.PI * 1.7
      const r = 0.2 - (i / 17) * 0.12
      return [cx + sx * Math.sin(a) * r * 0.9, py - 0.04 + Math.cos(a) * r, pz]
    })
    k.add(tubeR(path3(pts), (t) => 0.075 * (1 - t * 0.55), 22, 9), WOOD_L)
    for (const sy of [-1, 1]) rivet(k, [sx * (PW / 2 - 0.07), py + sy * (PH / 2 - 0.07), pf], 0.032)
  }
  k.add(rope(rectPath(0, py, PW - 0.15, PH - 0.13, 0.06, pf + 0.01), 0.026, ROPE_A, ROPE_B, 7, Math.round(PW * 2 * 30), 6, true), '#ffffff', undefined, 0.014)
  const top = py + PH / 2
  const wood = k.mesh('wood', smat())
  const plaque = new THREE.Group()
  plaque.name = 'plaque'
  plaque.position.set(0, py, pf + 0.03)
  const ways = new WaysBoard(PW - 0.3, PH - 0.24)
  plaque.add(ways.mesh)
  plaque.userData.rest = restOf(plaque)
  // the perch rail, on the top beam beside the plaque on the right
  const perchRail = buildPerchRail()
  const perchAt = V(PW / 2 + 0.92, h / 2 + B, pz)
  perchRail.position.copy(perchAt)
  // the name scroll arching over the plaque
  const title = new NameScroll(PW / 2 - 0.12, 0.19)
  const titleY = top + 0.27
  title.root.position.set(0, titleY, pz + 0.02)

  // the planks behind the reels, one per reel, and the slats between them
  const bk = new VKit(INK, 0)
  const cw = w / cols
  for (let i = 0; i < cols; i++) {
    const x = -w / 2 + (i + 0.5) * cw
    bk.add(new THREE.BoxGeometry(cw - 0.012, h + 0.1, 0.04), i % 2 ? '#162f4c' : '#132943', T([x, 0, -0.47]), 0)
    grain(bk, x, 0, cw - 0.12, h - 0.1, -0.449, 30 + i, 'y', '#10233a')
  }
  const back = bk.mesh('back', smat())
  const dv = new VKit(INK, 0.014)
  for (let i = 1; i < cols; i++) {
    const x = -w / 2 + i * cw
    dv.add(box(0.05, h, 0.05, 0.02, 1), '#2a3f5f', T([x, 0, -0.33]))
    for (const s of [-1, 1]) dv.add(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 8), BRASS_D, T([x, s * (h / 2 - 0.03), -0.32]), 0.01)
  }
  const dividers = dv.mesh('dividers', smat())

  const root = new THREE.Group()
  root.name = 'frame'
  root.add(back, dividers, wood, plaque, perchRail, title.root)
  return {
    root,
    wood,
    back,
    dividers,
    ways,
    plaque,
    perchRail,
    perchY: PERCH_Y,
    perchAt,
    perch: perchAt.clone().setY(perchAt.y + PERCH_Y),
    title,
    hooks,
    size: { halfW: ow / 2 + 0.05, top: h / 2 + B, bottom: -h / 2 - B - 0.08, plaqueTop: top, plaqueHalfW: PW / 2 + 0.25, titleTop: titleY + 0.19 + SCROLL_BULGE + 0.02, front },
  }
}

const capsule2 = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 2, 10)

/* ------------------------------------------------------------------ */
/*  The multiplier medallion                                            */
/* ------------------------------------------------------------------ */

export interface MedallionRig {
  /** a coin 1 unit across standing on its rim at the origin's -0.5 (the centre is the origin); faces +z. Stamp it
   *  with root.scale */
  root: THREE.Group
  /** the coin itself (gold, its shine sweeping); spin it on y for a flip */
  coin: THREE.Group
  /** the soft glow behind it: sprite; its material is the medallion's own (set opacity) */
  glow: THREE.Sprite
  /** shows ×n on the coin */
  set(n: number): void
  dispose(): void
}

/**
 * The medallion's number: "×12" lettered like the banner titles, cream over a thick ink outline with a hard drop under
 * it, as big as the coin's face allows (a one-digit number is over half the coin's width), so it reads at a glance.
 */
class CoinLabel {
  readonly texture: THREE.CanvasTexture
  readonly material: THREE.MeshBasicMaterial
  private n = -1
  private readonly g: CanvasRenderingContext2D
  constructor() {
    this.texture = canvasTexture(512, 512, `800 200px ${FONT}`, (g) => this.draw(g))
    this.g = (this.texture.image as HTMLCanvasElement).getContext('2d')!
    this.material = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false, toneMapped: false })
  }
  set(n: number) {
    if (n === this.n) return
    this.n = n
    this.draw(this.g)
    this.texture.needsUpdate = true
  }
  private draw(g: CanvasRenderingContext2D) {
    g.clearRect(0, 0, 512, 512)
    if (this.n < 0) return
    const num = String(Math.round(this.n))
    const X = 0.62
    let size = 330
    const room = 452
    const measure = () => {
      g.font = `800 ${size * X}px ${FONT}`
      const wx = g.measureText('×').width * 0.92
      g.font = `800 ${size}px ${FONT}`
      return { wx, wn: g.measureText(num).width }
    }
    let m = measure()
    if (m.wx + m.wn > room) {
      size *= room / (m.wx + m.wn)
      m = measure()
    }
    const x0 = 256 - (m.wx + m.wn) / 2
    const cy = 268
    g.textBaseline = 'middle'
    g.textAlign = 'left'
    g.lineJoin = 'round'
    const parts = [
      ['×', x0, cy + size * 0.04, X],
      [num, x0 + m.wx, cy, 1],
    ] as const
    const put = (dx: number, dy: number, fill: string | CanvasGradient | null, stroke: string | null, lw = 0) => {
      for (const [txt, x, y, f] of parts) {
        g.font = `800 ${size * f}px ${FONT}`
        if (stroke) {
          g.lineWidth = lw * f
          g.strokeStyle = stroke
          g.strokeText(txt, x + dx, y + dy)
        }
        if (fill) {
          g.fillStyle = fill
          g.fillText(txt, x + dx, y + dy)
        }
      }
    }
    // the hard drop, the ink outline, then the cream face with a warm shade at its foot
    put(0, size * 0.07, INK, INK, size * 0.2)
    put(0, 0, null, INK, size * 0.2)
    const grad = g.createLinearGradient(0, cy - size * 0.38, 0, cy + size * 0.38)
    grad.addColorStop(0, '#ffffff')
    grad.addColorStop(0.55, '#fff4d2')
    grad.addColorStop(1, '#ffd98a')
    put(0, 0, grad, null)
  }
  dispose() {
    this.texture.dispose()
    this.material.dispose()
  }
}

/**
 * The Treasure Hunt multiplier: a big gold doubloon with a beaded rim and a reeded edge, a little skull and crossbones
 * struck above the number, with a warm glow behind it.
 */
export function buildMedallion(): MedallionRig {
  const R = 0.5
  const T0 = 0.11
  const gm = goldMaterial()
  const k = new VKit(INK, STAGE_INK)
  // the coin: a reeded edge (stripes round the rim), a raised rim and a slightly sunk face
  const edge = tint(new THREE.CylinderGeometry(R, R, T0, 48, 1, false), (x, y, z) => (Math.abs(y) > T0 / 2 - 1e-4 ? C('#f5b82e') : Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 48) % 2 ? C('#e9a524') : C('#c98318')))
  k.add(smooth(edge), '#ffffff', T([0, 0, 0], [Math.PI / 2, 0, 0]))
  k.add(new THREE.TorusGeometry(R - 0.035, 0.035, 8, 48), '#ffc93d', T([0, 0, T0 / 2]), 0.016)
  k.add(flatShape(ellipsePts(0, 0, R - 0.07, R - 0.07, 48), T0 / 2 + 0.002), '#f2b42c', undefined, 0, false)
  // beads round the face
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU
    k.add(new THREE.SphereGeometry(1, 6, 3, 0, TAU, 0, Math.PI / 2), '#ffd65a', T([Math.cos(a) * (R - 0.1), Math.sin(a) * (R - 0.1), T0 / 2 + 0.002], [Math.PI / 2, 0, 0], [0.014, 0.01, 0.014]), 0)
  }
  jolly(k, new THREE.Matrix4(), 0, 0.322, 0.04, T0 / 2 + 0.004, '#b8730f', true)
  k.add(flatShape(stripPts(arc(0, 0, R - 0.13, R - 0.13, Math.PI * 0.62, Math.PI * 0.86, 10), 0.03), T0 / 2 + 0.005), SHINE, undefined, 0, true)
  // a red rosette ribbon behind the coin's foot: two forked tails
  for (const s of [-1, 1]) {
    const tail: P2[] = [[0, 0.08], [s * 0.16, 0.06], [s * 0.26, -0.2], [s * 0.17, -0.15], [s * 0.12, -0.24], [-s * 0.02, -0.02]]
    k.add(slab(tail, 0.03, 0.01, 2), s < 0 ? '#d8323a' : '#b8242e', T([s * 0.1, -0.36, -T0 / 2 - 0.04], [0, 0, s * 0.18]))
  }
  const coinMesh = k.mesh('', gm)
  const label = new CoinLabel()
  const lm = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 0.86), label.material)
  lm.position.set(0, -0.045, T0 / 2 + 0.008)
  lm.renderOrder = 2
  const coin = new THREE.Group()
  coin.name = 'coin'
  coin.add(coinMesh, lm)
  const glowMat = lampHaloMaterial().clone()
  glowMat.color.set('#ffcf5a')
  glowMat.opacity = 0.6
  const glow = new THREE.Sprite(glowMat)
  glow.scale.set(2.2, 2.2, 1)
  glow.position.z = -0.3
  const root = new THREE.Group()
  root.name = 'medallion'
  root.add(glow, coin)
  label.set(1)
  return {
    root,
    coin,
    glow,
    set: (n: number) => label.set(n),
    dispose: () => {
      label.dispose()
      glowMat.dispose()
      for (const m of [coinMesh, lm]) m.geometry.dispose()
    },
  }
}

/* ------------------------------------------------------------------ */
/*  Lanterns and gulls                                                  */
/* ------------------------------------------------------------------ */

/**
 * A ship's lantern hanging from its ring (the origin), about 0.55 tall: a black iron cage with brass caps round warm
 * glass and a flame, and a halo. The glass, flame and halo all follow setLanternGlow (shared by every lantern).
 */
export function buildLantern(): THREE.Group {
  const k = new VKit(INK, 0.018)
  k.add(new THREE.TorusGeometry(0.04, 0.012, 5, 12), IRON, T([0, -0.04, 0]))
  k.add(lathe([[0.0, -0.08], [0.03, -0.08], [0.06, -0.12], [0.13, -0.17], [0.135, -0.19], [0.0, -0.19]], 12), IRON)
  k.add(new THREE.CylinderGeometry(0.135, 0.135, 0.025, 12), BRASS, T([0, -0.2, 0]), 0.014)
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI / 4
    limb(k, [Math.cos(a) * 0.11, -0.21, Math.sin(a) * 0.11], [Math.cos(a) * 0.11, -0.44, Math.sin(a) * 0.11], 0.012, IRON, 0.01)
  }
  k.add(new THREE.CylinderGeometry(0.14, 0.12, 0.04, 12), BRASS_D, T([0, -0.46, 0]), 0.014)
  k.add(lathe([[0.0, -0.48], [0.1, -0.48], [0.05, -0.53], [0.0, -0.55]], 10), IRON)
  const cage = k.mesh('cage', smat())
  const gk = new VKit(INK, 0)
  gk.add(new THREE.CylinderGeometry(0.1, 0.1, 0.23, 8, 1, true), '#ffffff', T([0, -0.325, 0]), 0)
  gk.add(sphere(8, 6), '#ffffff', T([0, -0.33, 0], [0, 0, 0], [0.035, 0.06, 0.035]), 0)
  const glass = gk.mesh('glass', lampMaterial())
  const halo = new THREE.Sprite(lampHaloMaterial())
  halo.name = 'halo'
  halo.position.set(0, -0.33, 0.05)
  halo.scale.set(1.1, 1.1, 1)
  const g = new THREE.Group()
  g.name = 'lantern'
  g.add(glass, cage, halo)
  return g
}

let gullGeo: THREE.BufferGeometry | null = null
/**
 * A gull, about 0.9 across the wings, facing +x (flying right; mirror x to fly left). One mesh: its morph target
 * beats the wings, so set morphTargetInfluences[0] (0 = up, 1 = down) or call flapGull.
 */
export function buildGull(): THREE.Mesh {
  if (!gullGeo) {
    const b = new VKit(INK, 0.022)
    b.add(sphere(12, 9), '#f7f9fc', T([0, 0, 0], [0, 0, 0.12], [0.2, 0.085, 0.08]))
    b.add(sphere(10, 8), '#f7f9fc', T([0.17, 0.05, 0], [0, 0, 0], 0.07))
    b.add(new THREE.ConeGeometry(0.026, 0.09, 8), '#ffb32a', T([0.265, 0.035, 0], [0, 0, -Math.PI / 2 - 0.15]))
    ballEye(b, [0.2, 0.075, 0.05], 0.022, [0.3, 0.1], 0.6)
    b.add(slab([[-0.17, 0.02], [-0.3, 0.06], [-0.3, -0.04], [-0.17, -0.03]], 0.02, 0.008, 2), '#e8ecf3', T([0, 0, 0]))
    // the wings: an inner arm rising from the shoulder and an outer hand drooping to a black tip (the gull's M)
    const w = new VKit(INK, 0.02)
    const seg = (a: P3, b2: P3, chord: number, tipBlack: boolean) => {
      const A = V(...a)
      const Bv = V(...b2)
      const d = Bv.clone().sub(A)
      const len = d.length()
      const z = d.clone().normalize()
      const x = V(1, 0, 0).addScaledVector(z, -z.x).normalize()
      const y = V().crossVectors(z, x)
      const m = new THREE.Matrix4().makeBasis(x, y, z).scale(V(chord, 0.016, len / 2)).setPosition(A.clone().add(Bv).multiplyScalar(0.5))
      const g = tint(new THREE.SphereGeometry(1, 10, 6), (_x, _y, zz) => (tipBlack && zz > 0.45 ? C('#2a2f3e') : C('#d3dbe8')))
      w.add(g, '#ffffff', m)
    }
    for (const s of [-1, 1]) {
      const sh: P3 = [0.0, 0.04, s * 0.05]
      const el: P3 = [-0.03, 0.13, s * 0.24]
      const tip: P3 = [-0.13, 0.08, s * 0.46]
      seg(sh, el, 0.085, false)
      seg(el, tip, 0.065, true)
    }
    const bg = b.geometry()
    morphTo(bg, () => {})
    const wg = w.geometry()
    // the down stroke: each wing swung about the shoulder line (x) to below the body
    const q = new THREE.Quaternion()
    morphTo(wg, (v) => {
      const s = Math.sign(v.z) || 1
      q.setFromAxisAngle(V(1, 0, 0), s * 1.0)
      v.sub(V(0, 0.03, 0)).applyQuaternion(q).add(V(0, 0.03, 0))
    })
    gullGeo = mergeGeometries([bg, wg])
    gullGeo.morphTargetsRelative = false
    bg.dispose()
    wg.dispose()
  }
  const m = new THREE.Mesh(gullGeo, smat())
  m.name = 'gull'
  return m
}

/** beats a gull's wings: `t` seconds, `rate` beats per second, `glide` 0..1 holds them out */
export function flapGull(g: THREE.Mesh, t: number, rate = 2.2, glide = 0) {
  if (!g.morphTargetInfluences) return
  const f = 0.5 - 0.5 * Math.cos(t * rate * TAU)
  g.morphTargetInfluences[0] = (1 - glide) * f + glide * 0.35
}

/* ------------------------------------------------------------------ */
/*  The deck kit                                                        */
/* ------------------------------------------------------------------ */

/** deck planks, w across (x) and d deep (from z = 0 back to -d), the top at y = 0, with nail heads at the seams */
export function buildDeck(w = 14, d = 6): THREE.Mesh {
  const k = new VKit(INK, 0)
  const pw = 0.42
  const n = Math.ceil(d / pw)
  for (let i = 0; i < n; i++) {
    const z = -(i + 0.5) * pw
    const tone = ['#9b5b33', '#8f532d', '#a5643a', '#94572f'][i % 4]
    k.add(new THREE.BoxGeometry(w, 0.08, pw - 0.025), tone, T([0, -0.04, z]), 0)
    k.add(new THREE.BoxGeometry(w, 0.08, 0.022), '#4a2412', T([0, -0.045, z - pw / 2]), 0)
    const seams = Math.round(w / 2.4)
    for (let j = 0; j <= seams; j++) {
      const x = -w / 2 + (j + (i % 2) * 0.5) * (w / seams)
      if (x > w / 2) continue
      k.add(new THREE.BoxGeometry(0.018, 0.081, pw - 0.03), '#6e3a1c', T([x, -0.04, z]), 0)
    }
  }
  return k.mesh('deck', smat())
}

/** the ship's rail along x (w long), its foot at y = 0: a top rail on turned balusters over a lower board */
export function buildRail(w = 14): THREE.Mesh {
  const k = new VKit(INK, STAGE_INK)
  k.add(box(w, 0.12, 0.16, 0.04), WOOD, T([0, 0.86, 0]))
  k.add(box(w, 0.22, 0.12, 0.04), WOOD_D, T([0, 0.11, 0]))
  const n = Math.round(w / 0.42)
  for (let i = 0; i <= n; i++) {
    const x = -w / 2 + (i * w) / n
    k.add(lathe([[0.0, 0.22], [0.045, 0.22], [0.03, 0.3], [0.055, 0.5], [0.03, 0.7], [0.045, 0.8], [0.0, 0.8]], 8), i % 4 ? WOOD_L : WOOD, T([x, 0, 0]))
  }
  for (let i = 0; i <= n; i += 4) rivet(k, [-w / 2 + (i * w) / n, 0.86, 0.08], 0.03)
  return k.mesh('rail', smat())
}

export interface MastRig {
  root: THREE.Group
  /** the sail (waving cloth, stage copy) */
  sail: THREE.Mesh
  /** the Jolly Roger at the masthead (waving cloth) */
  flag: THREE.Mesh
}

/** a mast `h` tall from y = 0 with a yard, a billowing sail, a crow's nest, rigging lines and a Jolly Roger on top */
export function buildMast(h = 7): MastRig {
  const k = new VKit(INK, STAGE_INK)
  k.add(new THREE.CylinderGeometry(0.11, 0.15, h, 12), WOOD, T([0, h / 2, 0]))
  for (const y of [h * 0.3, h * 0.55]) k.add(new THREE.TorusGeometry(0.135, 0.025, 5, 14), IRON, T([0, y, 0], [Math.PI / 2, 0, 0]), 0.014)
  // the yard and the crow's nest
  const yardY = h * 0.72
  k.add(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 10), WOOD_D, T([0, yardY, 0.18], [0, 0, Math.PI / 2]))
  const nestY = h * 0.86
  k.add(lathe([[0.0, -0.18], [0.36, -0.18], [0.42, 0.14], [0.38, 0.16], [0.0, 0.16]], 16), WOOD_L, T([0, nestY, 0]))
  k.add(new THREE.TorusGeometry(0.41, 0.03, 5, 18), WOOD_D, T([0, nestY + 0.15, 0], [Math.PI / 2, 0, 0]))
  // rigging lines from the nest down and out
  for (const s of [-1, 1]) for (const z of [-0.6, 0.4]) k.add(rope(path3([[s * 0.3, nestY - 0.1, 0], [s * 2.6, 0.9, z]]), 0.018, ROPE_A, ROPE_B, 6, 40, 4), '#ffffff', undefined, 0.01)
  const root = new THREE.Group()
  root.name = 'mast'
  root.add(k.mesh('mast', smat()))
  // the sail: a cream canvas hanging from the yard, waving gently
  const sk = new VKit(INK, STAGE_INK)
  const sail = clothGeo(-1.5, 1.5, -2.2, 0, 0.02, 16, 10)
  // the canvas bellies out in the wind, and its foot curves up at the corners
  const sp = sail.getAttribute('position')
  for (let i = 0; i < sp.count; i++) {
    const u = (sp.getX(i) + 1.5) / 3
    const v = -sp.getY(i) / 2.2
    sp.setZ(i, sp.getZ(i) + 0.32 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, v * 0.9 + 0.1)))
    sp.setY(i, sp.getY(i) + 0.25 * v * (1 - Math.sin(Math.PI * u)))
  }
  sail.computeVertexNormals()
  sk.add(sail, '#f3e6c8')
  const sz = (x: number, y: number) => 0.012 + 0.32 * Math.sin((Math.PI * (x + 1.5)) / 3) * Math.sin(Math.PI * Math.min(1, (-y / 2.2) * 0.9 + 0.1))
  for (const x of [-0.75, 0, 0.75]) {
    const seam: P3[] = Array.from({ length: 12 }, (_, i) => {
      const y = -0.04 - (i / 11) * 2.1
      const v = -y / 2.2
      return [x, y + 0.25 * v * (1 - Math.sin((Math.PI * (x + 1.5)) / 3)), sz(x, y) + 0.004]
    })
    sk.add(tubeR(path3(seam), () => 0.008, 16, 3), '#d9c7a0', undefined, 0)
  }
  const sg = sk.geometry()
  // a sail billows from the yard down: the wave runs down the canvas
  const p = sg.getAttribute('position')
  const wv = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const v = Math.max(0, -p.getY(i) / 2.2)
    wv.set([0.08 * v, -p.getY(i) * 2 + p.getX(i) * 0.6, 0.6], i * 3)
  }
  sg.setAttribute('aWave', new THREE.BufferAttribute(wv, 3))
  const sailMesh = new THREE.Mesh(sg, clothMaterial(true))
  sailMesh.name = 'sail'
  sailMesh.position.set(0, yardY - 0.05, 0.24)
  root.add(sailMesh)
  // the Jolly Roger at the masthead
  const fk = new VKit(INK, STAGE_INK)
  fk.add(clothGeo(0, 1.1, -0.38, 0.38, 0.02, 12, 3), '#262b3f')
  const fz = 0.012
  clothDecal(fk, ellipsePts(0.52, 0.06, 0.17, 0.15, 18), BONE, fz)
  clothDecal(fk, rrect(0.52, -0.1, 0.18, 0.1, 0.03), BONE, fz)
  for (const s of [-1, 1]) clothDecal(fk, ellipsePts(0.52 + s * 0.065, 0.06, 0.045, 0.05, 10), '#262b3f', fz + 0.002)
  for (const d of [-1, 1]) clothDecal(fk, stripPts([[0.25, -0.12 - 0.12 * d], [0.79, -0.12 + 0.12 * d]], 0.05), BONE, fz - 0.001)
  const fg = waveCloth(fk.geometry(), 0, 1.1, 0.09, 4.5)
  const flag = new THREE.Mesh(fg, clothMaterial(true))
  flag.name = 'flag'
  flag.position.set(0.1, h + 0.05, 0)
  root.add(flag)
  k.add(sphere(10, 8), TOOTH_GOLD, T([0, h + 0.5, 0], [0, 0, 0], 0.09))
  const pole = new VKit(INK, STAGE_INK)
  pole.add(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 8), WOOD_D, T([0.06, h + 0.05, 0]))
  pole.add(sphere(10, 8), TOOTH_GOLD, T([0.06, h + 0.52, 0], [0, 0, 0], 0.08))
  root.add(pole.mesh('pole', smat()))
  return { root, sail: sailMesh, flag }
}

/** a barrel standing on y = 0, about 0.75 tall, with iron hoops */
export function buildBarrel(): THREE.Mesh {
  const k = new VKit(INK, STAGE_INK)
  const prof: P2[] = Array.from({ length: 9 }, (_, i) => {
    const y = (i / 8) * 0.74
    return [0.25 + 0.06 * Math.sin((i / 8) * Math.PI), y]
  })
  const g = tint(lathe([[0, 0], ...prof, [0, 0.74]], 16), (x, _y, z) => (Math.floor(((Math.atan2(z, x) + Math.PI) / TAU) * 16) % 2 ? C('#9b5a31') : C('#8a4e2a')))
  k.add(smooth(g), '#ffffff')
  for (const y of [0.1, 0.27, 0.47, 0.64]) {
    const r = 0.25 + 0.06 * Math.sin((y / 0.74) * Math.PI) + 0.008
    k.add(new THREE.TorusGeometry(r, 0.018, 4, 20), IRON, T([0, y, 0], [Math.PI / 2, 0, 0]), 0.012)
  }
  k.add(flatShape(ellipsePts(0, 0, 0.23, 0.23, 16), 0), '#b26e3e', T([0, 0.741, 0], [-Math.PI / 2, 0, 0]), 0, false)
  return k.mesh('barrel', smat())
}

/** a wooden crate on y = 0, 0.6 on a side, with cross braces */
export function buildCrate(): THREE.Mesh {
  const k = new VKit(INK, STAGE_INK)
  const S = 0.6
  k.add(box(S, S, S, 0.03), '#b47a45', T([0, S / 2, 0]))
  for (const [nx, nz, ry] of [
    [0, 1, 0],
    [1, 0, Math.PI / 2],
  ] as const) {
    const m = T([nx * (S / 2 + 0.005), S / 2, nz * (S / 2 + 0.005)], [0, ry, 0])
    flatDecal(k, m, stripPts([[-S / 2 + 0.04, S / 2 - 0.04], [S / 2 - 0.04, -S / 2 + 0.04]], 0.07), '#8a5530', 0.004)
    for (const y of [S / 2 - 0.04, -S / 2 + 0.04]) flatDecal(k, m, stripPts([[-S / 2 + 0.02, y], [S / 2 - 0.02, y]], 0.07), '#8a5530', 0.005)
  }
  return k.mesh('crate', smat())
}

/** a cannon on its wooden carriage, barrel along +x, about 1.1 long, sitting on y = 0 */
export function buildCannon(): THREE.Mesh {
  const k = new VKit(INK, STAGE_INK)
  k.add(lathe([[0.0, -0.5], [0.16, -0.5], [0.2, -0.42], [0.17, -0.36], [0.15, 0.3], [0.17, 0.36], [0.17, 0.44], [0.12, 0.44], [0.0, 0.4]], 18), '#565670', T([0.1, 0.36, 0], [0, 0, -Math.PI / 2 + 0.12]))
  k.add(sphere(10, 8), '#565670', T([-0.42, 0.3, 0], [0, 0, 0], 0.08))
  k.add(new THREE.SphereGeometry(1, 6, 4), SHINE, T([0.05, 0.47, 0.13], [0, 0, 0.12], [0.3, 0.012, 0.005]), 0, true)
  for (const x of [-0.18, 0.3]) k.add(new THREE.TorusGeometry(0.165, 0.02, 5, 16), BRASS_D, T([x, 0.36 + x * 0.12, 0], [0, Math.PI / 2, 0]), 0.012)
  k.add(box(0.75, 0.2, 0.36, 0.03), WOOD, T([-0.05, 0.16, 0]))
  for (const x of [-0.3, 0.22]) for (const z of [-0.2, 0.2]) {
    k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12), WOOD_D, T([x, 0.1, z], [Math.PI / 2, 0, 0]))
    k.add(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 8), IRON, T([x, 0.1, z + Math.sign(z) * 0.01], [Math.PI / 2, 0, 0]), 0.01)
  }
  return k.mesh('cannon', smat())
}

export interface ChestRig {
  root: THREE.Group
  /** the lid, hinged at the back: rotation.x negative opens it (-1.9 is wide open) */
  lid: THREE.Group
  /** the heap of gold and gems inside (hide it for an empty chest) */
  loot: THREE.Mesh
}

/** a treasure chest on y = 0, about 0.8 wide: banded wood, a gold lock, a heap of coins and gems inside */
export function buildChest(): ChestRig {
  const k = new VKit(INK, STAGE_INK)
  const W = 0.8
  const H = 0.42
  const Dp = 0.5
  k.add(box(W, H, Dp, 0.04), '#9a5530', T([0, H / 2, 0]))
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) k.add(box(0.07, H + 0.02, Dp + 0.02, 0.02, 1), BRASS_D, T([x, H / 2, 0]))
  k.add(box(W + 0.02, 0.06, Dp + 0.02, 0.02, 1), BRASS_D, T([0, 0.04, 0]))
  k.add(rrectSlab(0.12, 0.14), TOOTH_GOLD, T([0, H - 0.06, Dp / 2 + 0.01]))
  k.add(flatShape(ellipsePts(0, H - 0.06, 0.022, 0.022, 10), Dp / 2 + 0.03), '#3a2010', undefined, 0, true)
  // the lid: a half barrel, hinged at the back top
  const l = new VKit(INK, STAGE_INK)
  const lidG = new THREE.CylinderGeometry(Dp / 2, Dp / 2, W, 16, 1, false, 0, Math.PI)
  l.add(smooth(lidG), '#a55d34', T([0, H, 0], [0, 0, Math.PI / 2]))
  l.add(box(W - 0.01, 0.03, Dp - 0.01, 0.01, 1), '#7a4224', T([0, H + 0.012, 0]))
  for (const x of [-W / 2 + 0.1, W / 2 - 0.1]) l.add(new THREE.CylinderGeometry(Dp / 2 + 0.012, Dp / 2 + 0.012, 0.07, 16, 1, true, 0, Math.PI), BRASS_D, T([x, H, 0], [0, 0, Math.PI / 2]), 0.014)
  const lid = joint('lid', [0, H, -Dp / 2], l.mesh('', smat()))
  // the loot
  const g = new VKit(INK, 0.016)
  for (let i = 0; i < 26; i++) {
    const x = (hash(i, 1) - 0.5) * (W - 0.14)
    const z = (hash(i, 2) - 0.5) * (Dp - 0.12)
    const y = H + 0.03 + 0.12 * (1 - (x / (W / 2)) ** 2) * hash(i, 3)
    g.add(new THREE.CylinderGeometry(0.055, 0.055, 0.016, 12), i % 5 ? '#ffd23f' : '#ffe680', T([x, y, z], [hash(i, 4) * 1.2 - 0.6, 0, hash(i, 5) - 0.5]), 0.01)
  }
  for (const [x, c] of [
    [-0.18, '#ff3b6b'],
    [0.12, '#3fd6ff'],
    [0.26, '#5bff8a'],
  ] as const)
    g.add(new THREE.OctahedronGeometry(0.06, 0), c, T([x, H + 0.13, 0.05], [0.4, 0.6, 0]), 0.012)
  const loot = g.mesh('loot', goldMaterial())
  const root = new THREE.Group()
  root.name = 'chest'
  root.add(k.mesh('chest', smat()), loot, lid)
  return { root, lid, loot }
}

const rrectSlab = (w: number, h: number) => slab(rrect(0, 0, w, h, 0.03, 3), 0.03, 0.01, 2)

export interface HelmRig {
  root: THREE.Group
  /** the wheel: rotation.z turns it */
  wheel: THREE.Group
}

/** the ship's wheel on its stand, about 1.2 tall: eight spokes with handles round a brass hub */
export function buildHelm(): HelmRig {
  const s = new VKit(INK, STAGE_INK)
  s.add(box(0.22, 0.9, 0.22, 0.04), WOOD_D, T([0, 0.45, -0.1]))
  s.add(box(0.36, 0.08, 0.36, 0.03), WOOD, T([0, 0.04, -0.1]))
  const w = new VKit(INK, STAGE_INK)
  const R = 0.38
  const c: P3 = [0, 0.95, 0.06]
  w.add(new THREE.TorusGeometry(R, 0.035, 8, 32), WOOD, T(c))
  w.add(new THREE.TorusGeometry(R * 0.55, 0.022, 6, 24), WOOD_L, T(c))
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    limb(w, c, [c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R, c[2]], 0.024, WOOD_L)
    w.add(lathe([[0.0, 0], [0.03, 0], [0.04, 0.05], [0.028, 0.1], [0.036, 0.14], [0.0, 0.16]], 8), WOOD, T([c[0] + Math.cos(a) * (R + 0.02), c[1] + Math.sin(a) * (R + 0.02), c[2]], [0, 0, a - Math.PI / 2]))
  }
  w.add(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 14), BRASS, T(c, [Math.PI / 2, 0, 0]), 0.014)
  const wheel = joint('wheel', c, w.mesh('', smat()))
  const root = new THREE.Group()
  root.name = 'helm'
  root.add(s.mesh('stand', smat()), wheel)
  return { root, wheel }
}

/** a coil of rope lying on y = 0, about 0.6 across */
export function buildRopeCoil(): THREE.Mesh {
  const k = new VKit(INK, 0.018)
  const pts: P3[] = []
  for (let i = 0; i <= 60; i++) {
    const a = (i / 60) * TAU * 3
    const r = 0.26 - (i / 60) * 0.12
    pts.push([Math.cos(a) * r, 0.04 + (i / 60) * 0.05, Math.sin(a) * r])
  }
  k.add(rope(path3(pts), 0.04, ROPE_A, ROPE_B, 5, 110, 6), '#ffffff')
  return k.mesh('ropeCoil', smat())
}

let coinGeo: THREE.BufferGeometry | null = null
/**
 * A gold coin, radius 0.1, in the gold material's colours with its ink rim (VKit attributes: position, normal, color,
 * aFlat), for instanced coin showers: new InstancedMesh(coinGeometry(), goldMaterial(), n).
 */
export function coinGeometry() {
  if (coinGeo) return coinGeo
  const k = new VKit(INK, 0.012)
  k.add(new THREE.CylinderGeometry(0.1, 0.1, 0.022, 16), '#ffc93d', T([0, 0, 0], [Math.PI / 2, 0, 0]))
  for (const s of [-1, 1]) {
    k.add(flatShape(ellipsePts(0, 0, 0.075, 0.075, 16), 0), '#ffe27a', T([0, 0, s * 0.0115], [0, s < 0 ? Math.PI : 0, 0]), 0, false)
    k.add(flatShape(star(0, 0, 0.045, 0.02, 5), 0.001), '#e09a1e', T([0, 0, s * 0.0115], [0, s < 0 ? Math.PI : 0, 0]), 0, true)
  }
  return (coinGeo = k.geometry())
}

/** frees what this module caches (the gull and coin geometry) */
export function releaseShip() {
  gullGeo?.dispose()
  coinGeo?.dispose()
}

/** disposes every mesh geometry under `o` (the frame, mast, chest... own theirs) */
export function disposeTree(o: THREE.Object3D) {
  o.traverse((x) => {
    if (x instanceof THREE.Mesh && x.geometry !== gullGeo && x.geometry !== coinGeo) x.geometry.dispose()
  })
}

