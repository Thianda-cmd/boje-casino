import * as THREE from 'three'
import { glowTexture } from '../../../lib/three/fx'
import { toonRamp } from '../../../lib/three/toon'
import { INK } from '../models/palette'
import { buildingMaterial, hullMaterial, lampMaterial, signMaterial } from './shaders'

/*
  The kit Neon Bay is built from. Every building in the city, the ones the kaiju knock down and the skyline alike, is
  made of three shapes (a box, a cylinder and a cone), each one InstancedMesh for the whole city on the windowed toon
  material, plus the same instances again as ink outlines: six draw calls for all the architecture. The neon signs
  are quads cut from one canvas atlas (one draw call), and every point of light, street lamps, marquee bulbs, warning
  lights on the masts, is one Points cloud.

  A part is added in world space (a matrix) with its wall colour, window light, window grid and trim; the kit hands
  back its index so a building that falls can move its own parts (buildings.ts). Parts added after build() are not
  allowed: the city is built once, at load.
*/

export type Shape = 'box' | 'cyl' | 'cone'

export interface PartLook {
  color: THREE.ColorRepresentation
  /** lit windows' colour (over 1 blooms) and the share lit */
  win?: [number, number, number, number]
  /** window cell width, storey height, style (0 none, 1 grid, 2 ribbons, 3 slots, 4 shop front) */
  grid?: [number, number, number]
  /** neon trim round the top: colour (over 1) and depth */
  trim?: [number, number, number, number]
  /** outline thickness (0 none: far skyline) */
  ink?: number
}

const GEO: Record<Shape, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cyl: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1),
  cone: () => new THREE.ConeGeometry(0.5, 1, 18, 1),
}

class Batch {
  mats: THREE.Matrix4[] = []
  col: number[] = []
  win: number[] = []
  grid: number[] = []
  trim: number[] = []
  ink: number[] = []
  dark: number[] = []
  mesh!: THREE.InstancedMesh
  hull!: THREE.InstancedMesh
  darkAttr!: THREE.InstancedBufferAttribute

  add(m: THREE.Matrix4, look: PartLook, seed: number) {
    const c = new THREE.Color(look.color)
    this.mats.push(m.clone())
    this.col.push(c.r, c.g, c.b)
    this.win.push(...(look.win ?? [0, 0, 0, 0]))
    const g = look.grid ?? [1, 1, 0]
    this.grid.push(g[0], g[1], g[2], seed)
    this.trim.push(...(look.trim ?? [0, 0, 0, 0]))
    this.ink.push(look.ink ?? 0.11)
    this.dark.push(1)
    return this.mats.length - 1
  }

  build(shape: Shape, mat: THREE.Material, hullMat: THREE.Material) {
    const n = Math.max(1, this.mats.length)
    const geo = GEO[shape]()
    const inst = (a: number[], k: number) => new THREE.InstancedBufferAttribute(new Float32Array(a.length ? a : new Array(k).fill(0)), k)
    geo.setAttribute('aWin', inst(this.win, 4))
    geo.setAttribute('aGrid', inst(this.grid, 4))
    geo.setAttribute('aTrim', inst(this.trim, 4))
    geo.setAttribute('aInk', inst(this.ink, 1))
    this.darkAttr = inst(this.dark, 1)
    this.darkAttr.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute('aDark', this.darkAttr)
    this.mesh = new THREE.InstancedMesh(geo, mat, n)
    this.mesh.count = this.mats.length
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mats.forEach((m, i) => this.mesh.setMatrixAt(i, m))
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.col.length ? this.col : [1, 1, 1]), 3)
    this.mesh.frustumCulled = false
    this.hull = new THREE.InstancedMesh(geo, hullMat, n)
    this.hull.count = this.mats.length
    // the outline draws from the same instances: one buffer, uploaded once
    this.hull.instanceMatrix = this.mesh.instanceMatrix
    this.hull.frustumCulled = false
  }
}

/* ------------------------------------------------------------------ */
/*  Signs                                                               */
/* ------------------------------------------------------------------ */

export interface SignSpec {
  text: string
  /** stacked letters, top to bottom */
  vertical?: boolean
  /** a neon tube round it */
  box?: boolean
  /** a second line, smaller */
  sub?: string
}

const FONT = 'Manrope, system-ui, sans-serif'

/** the signs' canvas: each spec drawn once in white neon (the instances tint it), packed in rows */
export class SignAtlas {
  readonly tex: THREE.CanvasTexture
  private readonly rects = new Map<string, { u: number; v: number; w: number; h: number; aspect: number }>()

  constructor(specs: SignSpec[]) {
    const W = 2048
    const H = 2048
    const c = document.createElement('canvas')
    c.width = W
    c.height = H
    const g = c.getContext('2d')!
    let x = 0
    let y = 0
    let row = 0
    const pad = 24
    for (const s of specs) {
      const key = keyOf(s)
      if (this.rects.has(key)) continue
      const fs = s.vertical ? 104 : 120
      g.font = `900 ${fs}px ${FONT}`
      let w: number
      let h: number
      if (s.vertical) {
        w = fs * 1.25 + pad * 2
        h = s.text.length * fs * 0.98 + pad * 2
      } else {
        w = Math.ceil(g.measureText(s.text).width) + pad * 2 + (s.box ? 40 : 0)
        h = fs * 1.15 + pad * 2 + (s.sub ? fs * 0.5 : 0) + (s.box ? 24 : 0)
      }
      w = Math.min(W, w)
      if (x + w > W) {
        x = 0
        y += row
        row = 0
      }
      if (y + h > H) break
      g.save()
      g.translate(x, y)
      drawSign(g, s, w, h, fs)
      g.restore()
      this.rects.set(key, { u: x / W, v: 1 - (y + h) / H, w: w / W, h: h / H, aspect: w / h })
      x += w
      row = Math.max(row, h)
    }
    this.tex = new THREE.CanvasTexture(c)
    this.tex.colorSpace = THREE.SRGBColorSpace
    this.tex.anisotropy = 4
  }

  rect(s: SignSpec) {
    return this.rects.get(keyOf(s)) ?? { u: 0, v: 0, w: 0.001, h: 0.001, aspect: 1 }
  }
}

const keyOf = (s: SignSpec) => `${s.text}|${s.vertical ? 1 : 0}|${s.box ? 1 : 0}|${s.sub ?? ''}`

function drawSign(g: CanvasRenderingContext2D, s: SignSpec, w: number, h: number, fs: number) {
  g.fillStyle = '#fff'
  g.strokeStyle = '#fff'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  // a soft glow under a bright core, so the sign reads before the bloom adds its own
  const pass = (blur: number, alpha: number) => {
    g.shadowColor = 'rgba(255,255,255,0.9)'
    g.shadowBlur = blur
    g.globalAlpha = alpha
    if (s.vertical) {
      g.font = `900 ${fs}px ${FONT}`
      ;[...s.text].forEach((ch, i) => g.fillText(ch, w / 2, 24 + fs * 0.5 + i * fs * 0.98))
    } else {
      g.font = `900 ${fs}px ${FONT}`
      const ty = s.sub ? h / 2 - fs * 0.22 : h / 2 + 4
      g.fillText(s.text, w / 2, ty)
      if (s.sub) {
        g.font = `800 ${fs * 0.42}px ${FONT}`
        g.fillText(s.sub, w / 2, ty + fs * 0.72)
      }
    }
    if (s.box) {
      g.lineWidth = 9
      roundRect(g, 10, 10, w - 20, h - 20, 22)
      g.stroke()
    }
  }
  pass(26, 0.55)
  pass(6, 1)
  g.globalAlpha = 1
  g.shadowBlur = 0
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath()
  g.moveTo(x + r, y)
  g.arcTo(x + w, y, x + w, y + h, r)
  g.arcTo(x + w, y + h, x, y + h, r)
  g.arcTo(x, y + h, x, y, r)
  g.arcTo(x, y, x + w, y, r)
  g.closePath()
}

/* ------------------------------------------------------------------ */
/*  The kit                                                             */
/* ------------------------------------------------------------------ */

export interface SignPart {
  m: THREE.Matrix4
  spec: SignSpec
  tint: THREE.Color
  flicker: number
}

export interface LampSpec {
  p: THREE.Vector3
  color: THREE.Color
  size: number
  /** blinks a second (0 steady), and its phase (a chase: each bulb a little later) */
  rate?: number
  phase?: number
}

export class Kit {
  readonly ramp = toonRamp([70, 145, 215, 255])
  readonly mat: THREE.MeshToonMaterial
  readonly matU: { uTime: { value: number } }
  readonly hullMat: THREE.ShaderMaterial
  readonly batches: Record<Shape, Batch> = { box: new Batch(), cyl: new Batch(), cone: new Batch() }
  readonly signs: SignPart[] = []
  readonly lamps: LampSpec[] = []
  signMesh!: THREE.InstancedMesh
  signMat!: THREE.ShaderMaterial
  signDark!: THREE.InstancedBufferAttribute
  lampPoints!: THREE.Points
  lampMat!: THREE.ShaderMaterial
  lampOn!: THREE.BufferAttribute
  atlas!: SignAtlas
  private seed = 1

  constructor() {
    const b = buildingMaterial(this.ramp)
    this.mat = b.mat
    this.matU = b.u
    this.hullMat = hullMaterial(INK)
  }

  /** a part, in world space; returns its index in its shape's batch */
  part(shape: Shape, m: THREE.Matrix4, look: PartLook) {
    return this.batches[shape].add(m, look, (this.seed = (this.seed * 16807) % 2147483647) / 2147483647)
  }

  /** a neon sign: a unit quad (1 × 1, facing +z) placed by m; returns its index */
  sign(m: THREE.Matrix4, spec: SignSpec, tint: THREE.ColorRepresentation, k = 2.2, flicker = 0) {
    this.signs.push({ m: m.clone(), spec, tint: new THREE.Color(tint).multiplyScalar(k), flicker })
    return this.signs.length - 1
  }

  lamp(l: LampSpec) {
    this.lamps.push(l)
    return this.lamps.length - 1
  }

  /** the width over height a sign's text needs, to size its quad */
  aspect(spec: SignSpec) {
    return this.atlas.rect(spec).aspect
  }

  /** draws the signs' atlas (before any sign is placed, so their quads can be sized to their text) */
  prepareSigns(specs: SignSpec[]) {
    this.atlas = new SignAtlas(specs)
  }

  build(root: THREE.Object3D) {
    for (const k of ['box', 'cyl', 'cone'] as const) {
      const b = this.batches[k]
      b.build(k, this.mat, this.hullMat)
      root.add(b.mesh, b.hull)
    }
    // signs
    this.signMat = signMaterial(this.atlas.tex)
    const sg = new THREE.PlaneGeometry(1, 1)
    const n = Math.max(1, this.signs.length)
    const uv = new Float32Array(n * 4)
    const tint = new Float32Array(n * 4)
    this.signs.forEach((s, i) => {
      const r = this.atlas.rect(s.spec)
      uv.set([r.u, r.v, r.w, r.h], i * 4)
      tint.set([s.tint.r, s.tint.g, s.tint.b, s.flicker], i * 4)
    })
    sg.setAttribute('aUv', new THREE.InstancedBufferAttribute(uv, 4))
    sg.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 4))
    this.signDark = new THREE.InstancedBufferAttribute(new Float32Array(n).fill(1), 1)
    this.signDark.setUsage(THREE.DynamicDrawUsage)
    sg.setAttribute('aDark', this.signDark)
    this.signMesh = new THREE.InstancedMesh(sg, this.signMat, n)
    this.signMesh.count = this.signs.length
    this.signMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.signs.forEach((s, i) => this.signMesh.setMatrixAt(i, s.m))
    this.signMesh.frustumCulled = false
    this.signMesh.renderOrder = 4
    root.add(this.signMesh)
    // lamps
    const L = this.lamps
    const pos = new Float32Array(L.length * 3)
    const col = new Float32Array(L.length * 3)
    const lamp = new Float32Array(L.length * 3)
    L.forEach((l, i) => {
      pos.set([l.p.x, l.p.y, l.p.z], i * 3)
      col.set([l.color.r, l.color.g, l.color.b], i * 3)
      lamp.set([l.size, l.rate ?? 0, l.phase ?? 0], i * 3)
    })
    const lg = new THREE.BufferGeometry()
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    lg.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    lg.setAttribute('aLamp', new THREE.BufferAttribute(lamp, 3))
    this.lampOn = new THREE.BufferAttribute(new Float32Array(L.length).fill(1), 1)
    this.lampOn.setUsage(THREE.DynamicDrawUsage)
    lg.setAttribute('aOn', this.lampOn)
    this.lampMat = lampMaterial(glowTexture())
    this.lampPoints = new THREE.Points(lg, this.lampMat)
    this.lampPoints.frustumCulled = false
    this.lampPoints.renderOrder = 5
    root.add(this.lampPoints)
  }

  dispose() {
    for (const b of Object.values(this.batches)) {
      b.mesh?.geometry.dispose()
      b.mesh?.dispose()
      b.hull?.dispose()
    }
    this.mat.dispose()
    this.hullMat.dispose()
    this.signMesh?.geometry.dispose()
    this.signMesh?.dispose()
    this.signMat?.dispose()
    this.atlas?.tex.dispose()
    this.lampPoints?.geometry.dispose()
    this.lampMat?.dispose()
  }
}

/* ------------------------------------------------------------------ */
/*  Placing parts                                                       */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion()
const _e = new THREE.Euler()
const _p = new THREE.Vector3()
const _s = new THREE.Vector3()

/** a part's matrix: centre, size, and turn (radians about y, then local x and z) */
export function place(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ')
  _q.setFromEuler(_e)
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz))
}

/** a frame for a building: its centre on the ground and its turn; local() places a part in it */
export class Lot {
  readonly m: THREE.Matrix4
  constructor(x: number, z: number, rot: number) {
    this.m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot), new THREE.Vector3(1, 1, 1))
  }
  /** a part centred at (x, y, z) in the lot, size (sx, sy, sz), turned by (rx, ry, rz) in the lot */
  local(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0) {
    return this.m.clone().multiply(place(x, y, z, sx, sy, sz, ry, rx, rz))
  }
  /** a point in the lot, in the world */
  point(x: number, y: number, z: number) {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.m)
  }
}
