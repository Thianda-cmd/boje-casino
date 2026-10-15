import * as THREE from 'three'
import type { Sym } from './rules'
import { SYMBOL_COLOR, SYMBOL_NAME, orbColor } from './meta'
import { glowTexture } from '../../lib/three/fx'

/*
  The slot symbols, modelled in code: faceted gems lofted from outlines, a gold crown and coin, the star
  and the multiplier orb. Geometry and materials are built once and shared; every cell gets a light clone.
  Each model fits a unit cell (about 0.9 across) and faces +z, the camera.
*/

export { SYMBOL_COLOR, SYMBOL_NAME, orbColor }

/* ------------------------------------------------------------------ */
/*  Environment: a dark studio with coloured softboxes, so every facet */
/*  catches a different glint                                          */
/* ------------------------------------------------------------------ */

export function createEnvironment(renderer: THREE.WebGLRenderer) {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const env = new THREE.Scene()
  env.background = new THREE.Color('#120c22')
  const box = (w: number, h: number, color: string, power: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }))
    m.position.set(x, y, z)
    m.lookAt(0, 0, 0)
    env.add(m)
  }
  box(9, 3, '#ffffff', 5, 0, 7, 2)
  box(2, 9, '#ffd49a', 4, -7, 1, 2)
  box(2, 9, '#9ad6ff', 4, 7, 1, 2)
  box(7, 1.5, '#ff7ad1', 3, 0, -5, 4)
  box(3, 3, '#ffffff', 1.1, 0, 1.5, 8)
  box(0.5, 0.5, '#ffffff', 40, 3, 4, 6)
  box(0.4, 0.4, '#ffffff', 40, -3.5, 3, 5)
  box(0.4, 0.4, '#fff1d0', 30, 1, -3, 7)
  box(0.35, 0.35, '#ffffff', 40, -2, -4, 5)
  box(3, 3, '#8b7bff', 2.5, -4, 3, -6)
  box(3, 3, '#5effc4', 1.6, 5, -2, -5)
  const rt = pmrem.fromScene(env, 0.03)
  env.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
    }
  })
  pmrem.dispose()
  return rt
}

/* ------------------------------------------------------------------ */
/*  Lofting: stack outlines into a faceted solid                        */
/* ------------------------------------------------------------------ */

type P2 = [number, number]
interface Layer {
  pts: P2[]
  z: number
}

const area = (pts: P2[]) => pts.reduce((a, p, i) => a + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0) / 2
const ccw = (pts: P2[]) => (area(pts) < 0 ? [...pts].reverse() : pts)

/** Layers top (highest z) to bottom; a layer of one point is an apex. Rings must share a point count. */
function loft(layers: Layer[]) {
  const pos: number[] = []
  const tri = (a: number[], b: number[], c: number[]) => {
    if ((a === b || b === c || a === c)) return
    pos.push(...a, ...b, ...c)
  }
  const v = (l: Layer, i: number) => {
    const p = l.pts[l.pts.length === 1 ? 0 : i % l.pts.length]
    return [p[0], p[1], l.z]
  }
  const top = layers[0]
  const bottom = layers[layers.length - 1]
  if (top.pts.length > 1) {
    const c = [top.pts.reduce((a, p) => a + p[0], 0) / top.pts.length, top.pts.reduce((a, p) => a + p[1], 0) / top.pts.length, top.z]
    for (let i = 0; i < top.pts.length; i++) tri(c, v(top, i), v(top, i + 1))
  }
  for (let k = 0; k < layers.length - 1; k++) {
    const U = layers[k]
    const L = layers[k + 1]
    const n = Math.max(U.pts.length, L.pts.length)
    for (let i = 0; i < n; i++) {
      const u0 = v(U, i)
      const u1 = U.pts.length === 1 ? u0 : v(U, i + 1)
      const l0 = v(L, i)
      const l1 = L.pts.length === 1 ? l0 : v(L, i + 1)
      tri(u0, l0, l1)
      tri(u0, l1, u1)
    }
  }
  if (bottom.pts.length > 1) {
    const c = [bottom.pts.reduce((a, p) => a + p[0], 0) / bottom.pts.length, bottom.pts.reduce((a, p) => a + p[1], 0) / bottom.pts.length, bottom.z]
    for (let i = 0; i < bottom.pts.length; i++) tri(c, v(bottom, i + 1), v(bottom, i))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  // every facet a slightly different brightness, like light bouncing around inside a cut stone
  const col: number[] = []
  const nrm = g.getAttribute('normal')
  for (let i = 0; i < pos.length / 9; i++) {
    const nx = nrm.getX(i * 3)
    const ny = nrm.getY(i * 3)
    const nz = nrm.getZ(i * 3)
    const h = Math.sin(nx * 12.9898 + ny * 78.233 + nz * 37.719) * 43758.5453
    const f = 0.62 + (h - Math.floor(h)) * 0.6
    for (let k = 0; k < 3; k++) col.push(f, f, f)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

const scaleAbout = (pts: P2[], s: number, cx = 0, cy = 0): P2[] => pts.map(([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s])
/** Each point slides half way to the next: offsets a ring by half a facet for star and kite facets. */
const half = (pts: P2[]): P2[] => pts.map((p, i) => {
  const q = pts[(i + 1) % pts.length]
  return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
})

/** A face-up brilliant from any outline: table, star-faceted crown, girdle, pavilion to a point. */
function brilliant(outline: P2[], o: { table?: number; crown?: number; top?: number; girdle?: number; depth?: number; cx?: number; cy?: number } = {}) {
  const pts = ccw(outline)
  const { table = 0.56, crown = 0.82, top = 0.24, girdle = 0.05, depth = 0.5, cx = 0, cy = 0 } = o
  return loft([
    { pts: scaleAbout(pts, table, cx, cy), z: top },
    { pts: scaleAbout(half(pts), crown, cx, cy), z: top * 0.55 },
    { pts, z: girdle },
    { pts, z: 0 },
    { pts: scaleAbout(half(pts), 0.5, cx, cy), z: -depth * 0.55 },
    { pts: [[cx, cy]], z: -depth },
  ])
}

const ellipse = (n: number, rx: number, ry: number, rot = 0): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = rot + (i / n) * Math.PI * 2
    return [Math.cos(t) * rx, Math.sin(t) * ry]
  })

/* ------------------------------------------------------------------ */
/*  Materials                                                          */
/* ------------------------------------------------------------------ */

function gem(color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) {
  // a deep body colour with bright facet glints: dark base, little emission, strong clearcoat
  const c = new THREE.Color(color)
  const hsl = { h: 0, s: 0, l: 0 }
  c.getHSL(hsl)
  const body = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.1), hsl.l * 0.62)
  return new THREE.MeshPhysicalMaterial({
    color: body,
    emissive: new THREE.Color().setHSL(hsl.h, 1, 0.42),
    emissiveIntensity: 0.22,
    metalness: 0.0,
    roughness: 0.03,
    ior: 2.2,
    specularIntensity: 1,
    specularColor: new THREE.Color('#ffffff'),
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 0.12,
    iridescenceIOR: 1.4,
    envMapIntensity: 1.7,
    flatShading: true,
    vertexColors: true,
    ...o,
  })
}

const gold = () =>
  new THREE.MeshStandardMaterial({ color: '#ffcc55', metalness: 1, roughness: 0.2, envMapIntensity: 1.9, emissive: '#5a3a00', emissiveIntensity: 0.25 })

/* ------------------------------------------------------------------ */
/*  Symbols                                                            */
/* ------------------------------------------------------------------ */

type Build = () => THREE.Object3D

function mesh(g: THREE.BufferGeometry, m: THREE.Material) {
  const x = new THREE.Mesh(g, m)
  x.castShadow = false
  return x
}

const BUILD: Record<Exclude<Sym, 'orb'>, Build> = {
  emerald: () => {
    // emerald cut: an octagon stepped down in rings, standing tall
    const w = 0.31
    const h = 0.44
    const k = 0.11
    const oct: P2[] = ccw([
      [-w + k, -h], [w - k, -h], [w, -h + k], [w, h - k], [w - k, h], [-w + k, h], [-w, h - k], [-w, -h + k],
    ])
    const g = loft([
      { pts: scaleAbout(oct, 0.6), z: 0.2 },
      { pts: scaleAbout(oct, 0.78), z: 0.16 },
      { pts: scaleAbout(oct, 0.91), z: 0.1 },
      { pts: oct, z: 0.04 },
      { pts: oct, z: 0 },
      { pts: scaleAbout(oct, 0.78), z: -0.13 },
      { pts: scaleAbout(oct, 0.5), z: -0.25 },
      { pts: scaleAbout(oct, 0.18), z: -0.33 },
    ])
    return mesh(g, gem(SYMBOL_COLOR.emerald))
  },
  sapphire: () => mesh(brilliant(ellipse(16, 0.36, 0.45)), gem(SYMBOL_COLOR.sapphire)),
  topaz: () => {
    // curved trillion: a triangle with softly bowed sides
    const pts: P2[] = []
    const corners: P2[] = [0, 1, 2].map((i) => {
      const t = Math.PI / 2 + (i * Math.PI * 2) / 3
      return [Math.cos(t) * 0.5, Math.sin(t) * 0.5 - 0.06]
    })
    for (let i = 0; i < 3; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 3]
      const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const out: P2 = [mid[0] * 1.32, (mid[1] + 0.06) * 1.32 - 0.06]
      for (let s = 0; s < 6; s++) {
        const t = s / 6
        // quadratic bezier a → out → b
        const x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * out[0] + t * t * b[0]
        const y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * out[1] + t * t * b[1]
        pts.push([x, y])
      }
    }
    return mesh(brilliant(pts, { cy: -0.02, table: 0.5 }), gem(SYMBOL_COLOR.topaz))
  },
  aqua: () => {
    // pear: round at the bottom, pointed at the top
    const pts: P2[] = Array.from({ length: 20 }, (_, i) => {
      const t = (i / 20) * Math.PI * 2
      return [Math.sin(t) * Math.pow(Math.abs(Math.sin(t / 2)), 1.25) * 0.42, Math.cos(t) * 0.48 - 0.02]
    })
    return mesh(brilliant(pts, { cy: -0.12 }), gem(SYMBOL_COLOR.aqua))
  },
  amethyst: () => {
    // a cluster of three hexagonal crystal points
    const crystal = (r: number, h: number, tip: number) => {
      const hex = ellipse(6, r, r, Math.PI / 6)
      const g = loft([
        { pts: [[0, 0]], z: h + tip },
        { pts: hex, z: h },
        { pts: scaleAbout(hex, 1.08), z: h * 0.25 },
        { pts: scaleAbout(hex, 0.9), z: 0 },
      ])
      g.rotateX(-Math.PI / 2)
      return g
    }
    const mat = gem(SYMBOL_COLOR.amethyst)
    const grp = new THREE.Group()
    const main = mesh(crystal(0.15, 0.5, 0.2), mat)
    main.position.set(0, -0.42, 0)
    const left = mesh(crystal(0.1, 0.3, 0.14), mat)
    left.position.set(-0.13, -0.42, 0.04)
    left.rotation.z = 0.5
    const right = mesh(crystal(0.11, 0.34, 0.15), mat)
    right.position.set(0.14, -0.42, -0.02)
    right.rotation.z = -0.42
    grp.add(left, right, main)
    return grp
  },
  heart: () => {
    const pts: P2[] = Array.from({ length: 32 }, (_, i) => {
      const t = (i / 32) * Math.PI * 2
      const x = 16 * Math.sin(t) ** 3
      const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
      return [x / 34, y / 34 + 0.05]
    })
    return mesh(brilliant(pts, { cy: 0.02, table: 0.6, top: 0.22, depth: 0.42 }), gem(SYMBOL_COLOR.heart, { iridescence: 0.3 }))
  },
  diamond: () => {
    // the classic brilliant, seen from the side with the table tipped toward us
    const n = 10
    const ring = (r: number, rot = 0): P2[] => ellipse(n, r, r, rot)
    const g = loft([
      { pts: ring(0.27), z: 0.27 },
      { pts: ring(0.43, Math.PI / n), z: 0.19 },
      { pts: ring(0.5), z: 0.1 },
      { pts: ring(0.5), z: 0.07 },
      { pts: ring(0.3, Math.PI / n), z: -0.2 },
      { pts: [[0, 0]], z: -0.48 },
    ])
    g.rotateX(-Math.PI / 2)
    g.translate(0, 0.04, 0)
    const m = new THREE.MeshPhysicalMaterial({
      color: '#e2efff',
      emissive: '#9fcfff',
      emissiveIntensity: 0.05,
      roughness: 0.02,
      metalness: 0.1,
      ior: 2.42,
      specularIntensity: 1,
      clearcoat: 1,
      iridescence: 1,
      iridescenceIOR: 2.0,
      iridescenceThicknessRange: [250, 900],
      envMapIntensity: 1.9,
      flatShading: true,
      vertexColors: true,
    })
    const x = mesh(g, m)
    x.rotation.x = 0.42
    return x
  },
  coin: () => {
    const grp = new THREE.Group()
    const polished = gold()
    const field = new THREE.MeshStandardMaterial({ color: '#c98a1c', metalness: 1, roughness: 0.48, envMapIntensity: 1.3, emissive: '#3a2200', emissiveIntensity: 0.3 })
    const rimProfile = [
      new THREE.Vector2(0.33, -0.06),
      new THREE.Vector2(0.41, -0.06),
      new THREE.Vector2(0.45, -0.03),
      new THREE.Vector2(0.45, 0.03),
      new THREE.Vector2(0.41, 0.06),
      new THREE.Vector2(0.36, 0.06),
      new THREE.Vector2(0.33, 0.03),
    ]
    const rim = new THREE.LatheGeometry(rimProfile, 56)
    rim.rotateX(Math.PI / 2)
    grp.add(mesh(rim, polished))
    const disc = new THREE.CylinderGeometry(0.335, 0.335, 0.06, 48)
    disc.rotateX(Math.PI / 2)
    grp.add(mesh(disc, field))
    // the B, raised on both faces, and a ring of dots
    const eg = new THREE.ExtrudeGeometry(bShape(0.95), { depth: 0.035, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.01, bevelSegments: 2, curveSegments: 12 })
    eg.translate(-0.012, 0, 0.03)
    const front = mesh(eg, polished)
    const back = mesh(eg, polished)
    back.rotation.y = Math.PI
    grp.add(front, back)
    const dot = new THREE.SphereGeometry(0.014, 8, 6)
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2
      const d = mesh(dot, polished)
      d.position.set(Math.cos(a) * 0.3, Math.sin(a) * 0.3, 0.032)
      grp.add(d)
    }
    grp.rotation.x = 0.1
    return grp
  },
  crown: () => {
    const grp = new THREE.Group()
    const mat = gold()
    // band: a thick open ring, wider at the top
    const band = new THREE.LatheGeometry(
      [new THREE.Vector2(0.33, -0.24), new THREE.Vector2(0.36, -0.24), new THREE.Vector2(0.4, 0.02), new THREE.Vector2(0.37, 0.02), new THREE.Vector2(0.3, -0.21)],
      40,
    )
    grp.add(mesh(band, mat))
    const rim = new THREE.TorusGeometry(0.345, 0.028, 10, 48)
    rim.rotateX(Math.PI / 2)
    const r1 = mesh(rim, mat)
    r1.position.y = -0.235
    grp.add(r1)
    // five points, each with a pearl
    const pearlMat = new THREE.MeshPhysicalMaterial({ color: '#fff6e8', roughness: 0.18, clearcoat: 1, sheen: 1, sheenColor: new THREE.Color('#ffd9f0'), envMapIntensity: 1.6, emissive: '#3a2a20', emissiveIntensity: 0.2 })
    const spike = new THREE.ConeGeometry(0.075, 0.3, 4)
    const pearl = new THREE.SphereGeometry(0.05, 16, 12)
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2
      const s = mesh(spike, mat)
      s.position.set(Math.cos(a) * 0.37, 0.15, Math.sin(a) * 0.37)
      s.rotation.set(Math.sin(a) * 0.18, -a, -Math.cos(a) * 0.18)
      grp.add(s)
      const p = mesh(pearl, pearlMat)
      p.position.set(Math.cos(a) * 0.4, 0.32, Math.sin(a) * 0.4)
      grp.add(p)
    }
    // velvet cap and jewels round the band
    const velvet = new THREE.MeshStandardMaterial({ color: '#b0123c', roughness: 0.85, emissive: '#3d0010', emissiveIntensity: 0.6 })
    const cap = new THREE.SphereGeometry(0.33, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    cap.scale(1, 0.62, 1)
    const capM = mesh(cap, velvet)
    capM.position.y = -0.04
    grp.add(capM)
    const cross = mesh(new THREE.OctahedronGeometry(0.07), gem('#ff2e6a', { emissiveIntensity: 0.5 }))
    cross.position.set(0, 0.2, 0)
    grp.add(cross)
    const jewel = new THREE.OctahedronGeometry(0.055, 0)
    const jewels = [gem('#ff2e6a', { emissiveIntensity: 0.5 }), gem('#3d7dff', { emissiveIntensity: 0.45 }), gem('#19d97a', { emissiveIntensity: 0.45 })]
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 2
      const j = mesh(jewel, jewels[i % 3])
      j.position.set(Math.cos(a) * 0.385, -0.11, Math.sin(a) * 0.385)
      j.scale.set(1, 1.25, 0.6)
      j.lookAt(Math.cos(a) * 2, -0.11, Math.sin(a) * 2)
      grp.add(j)
    }
    grp.rotation.x = 0.32
    grp.position.y = 0.02
    grp.scale.setScalar(1.12)
    return grp
  },
  star: () => {
    const starPts = (ro: number, ri: number): P2[] =>
      Array.from({ length: 10 }, (_, i) => {
        const r = i % 2 ? ri : ro
        const a = Math.PI / 2 + (i * Math.PI) / 5
        return [Math.cos(a) * r, Math.sin(a) * r]
      })
    const outline = starPts(0.5, 0.215)
    const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
    const frame = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.035, bevelSegments: 2, curveSegments: 1 })
    frame.translate(0, 0, -0.1)
    const grp = new THREE.Group()
    grp.add(mesh(frame, gold()))
    // the crystal inlay: a faceted star that throws rainbow light
    const inner = ccw(starPts(0.4, 0.17))
    const crystal = loft([
      { pts: [[0, 0]], z: 0.16 },
      { pts: scaleAbout(inner, 0.55), z: 0.1 },
      { pts: inner, z: 0.02 },
      { pts: inner, z: -0.02 },
    ])
    const cm = new THREE.MeshPhysicalMaterial({
      color: '#fff3c8',
      emissive: '#ff9a3c',
      emissiveIntensity: 0.4,
      roughness: 0.02,
      metalness: 0.2,
      iridescence: 1,
      iridescenceIOR: 2.1,
      iridescenceThicknessRange: [200, 1000],
      clearcoat: 1,
      envMapIntensity: 2.4,
      flatShading: true,
    })
    grp.add(mesh(crystal, cm))
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffb84a', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }))
    halo.scale.setScalar(1.45)
    halo.position.z = -0.25
    halo.name = 'halo'
    grp.add(halo)
    return grp
  },
}

export { glowTexture }

/** A "B" for the coin, matching the Boje logo. */
export function bShape(size = 1) {
  const k = size
  const s = new THREE.Shape()
  s.moveTo(-0.13 * k, -0.2 * k)
  s.lineTo(-0.13 * k, 0.2 * k)
  s.lineTo(0.03 * k, 0.2 * k)
  s.bezierCurveTo(0.17 * k, 0.2 * k, 0.17 * k, 0.015 * k, 0.05 * k, 0.012 * k)
  s.bezierCurveTo(0.2 * k, 0.005 * k, 0.2 * k, -0.2 * k, 0.04 * k, -0.2 * k)
  s.lineTo(-0.13 * k, -0.2 * k)
  const h1 = new THREE.Path()
  h1.moveTo(-0.055 * k, 0.135 * k)
  h1.lineTo(0.025 * k, 0.135 * k)
  h1.bezierCurveTo(0.09 * k, 0.135 * k, 0.09 * k, 0.06 * k, 0.025 * k, 0.06 * k)
  h1.lineTo(-0.055 * k, 0.06 * k)
  h1.closePath()
  const h2 = new THREE.Path()
  h2.moveTo(-0.055 * k, -0.035 * k)
  h2.lineTo(0.035 * k, -0.035 * k)
  h2.bezierCurveTo(0.115 * k, -0.035 * k, 0.115 * k, -0.135 * k, 0.035 * k, -0.135 * k)
  h2.lineTo(-0.055 * k, -0.135 * k)
  h2.closePath()
  s.holes.push(h1, h2)
  return s
}

/* ------------------------------------------------------------------ */
/*  Multiplier orbs                                                    */
/* ------------------------------------------------------------------ */


const labelCache = new Map<number, THREE.CanvasTexture>()
function label(v: number) {
  let t = labelCache.get(v)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  const text = `${v}×`
  g.font = `900 ${text.length > 3 ? 80 : 92}px Manrope, ui-sans-serif, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.lineJoin = 'round'
  g.lineWidth = 16
  g.strokeStyle = 'rgba(10,6,24,0.9)'
  g.strokeText(text, 128, 68)
  const grad = g.createLinearGradient(0, 24, 0, 110)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(1, '#ffe7a8')
  g.fillStyle = grad
  g.fillText(text, 128, 68)
  t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  labelCache.set(v, t)
  return t
}

let orbParts: { glass: THREE.SphereGeometry; core: THREE.IcosahedronGeometry; ring: THREE.TorusGeometry } | null = null
const orbMats = new Map<string, { glass: THREE.MeshPhysicalMaterial; core: THREE.MeshStandardMaterial; ring: THREE.MeshStandardMaterial }>()

function buildOrb(v: number) {
  orbParts ??= { glass: new THREE.SphereGeometry(0.38, 40, 28), core: new THREE.IcosahedronGeometry(0.24, 1), ring: new THREE.TorusGeometry(0.42, 0.022, 8, 64) }
  const color = orbColor(v)
  let m = orbMats.get(color)
  if (!m) {
    const c = new THREE.Color(color)
    m = {
      glass: new THREE.MeshPhysicalMaterial({ color: c, roughness: 0, metalness: 0, clearcoat: 1, transparent: true, opacity: 0.38, envMapIntensity: 2.8, depthWrite: false, iridescence: 0.6 }),
      core: new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.3, flatShading: true }),
      ring: new THREE.MeshStandardMaterial({ color: '#ffe9a8', metalness: 1, roughness: 0.25, emissive: c, emissiveIntensity: 0.6 }),
    }
    orbMats.set(color, m)
  }
  const grp = new THREE.Group()
  const core = new THREE.Mesh(orbParts.core, m.core)
  core.name = 'spin'
  const ring = new THREE.Mesh(orbParts.ring, m.ring)
  ring.name = 'ring'
  ring.rotation.set(1.38, 0.35, 0)
  const glass = new THREE.Mesh(orbParts.glass, m.glass)
  glass.renderOrder = 2
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: label(v), depthTest: false, transparent: true }))
  sprite.scale.set(0.78, 0.39, 1)
  sprite.position.set(0, -0.02, 0.45)
  sprite.renderOrder = 5
  grp.add(core, ring, glass, sprite)
  return grp
}

/* ------------------------------------------------------------------ */
/*  Public: one instance per cell                                      */
/* ------------------------------------------------------------------ */

const protos = new Map<Sym, THREE.Object3D>()

export function buildSymbol(sym: Sym, mult?: number): THREE.Object3D {
  if (sym === 'orb') return buildOrb(mult ?? 2)
  let p = protos.get(sym)
  if (!p) {
    p = BUILD[sym]()
    protos.set(sym, p)
  }
  return p.clone()
}

/** Build everything up front so the first spin doesn't stutter while shaders compile. */
export function warmUp() {
  for (const s of Object.keys(BUILD) as Exclude<Sym, 'orb'>[]) if (!protos.has(s)) protos.set(s, BUILD[s]())
}

/** Every distinct material the symbols use, so the scene can fade or tint them. */
export function symbolMaterials(o: THREE.Object3D) {
  const out: THREE.Material[] = []
  o.traverse((x) => {
    if (x instanceof THREE.Mesh || x instanceof THREE.Sprite) out.push(x.material as THREE.Material)
  })
  return out
}
