import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T, VKit, shell, toonRamp, vkMaterial, type Geo, type P3 } from '../../../lib/three/toon'
import { COIN_H, COIN_R, PRIZE_SIZE } from '../geom'
import type { ItemKind } from '../types'

/*
  Coin Cascade's models, built in code in the site's toon style: flat tones and a dark ink outline (an inverted hull)
  round every solid. The metal is drawn with matcaps rather than lights: a matcap is a picture of a shiny ball, and
  each point of a surface takes its colour from the spot of the ball that faces the same way. Ours are painted in
  hard bands like a chrome reflection (a bright sky above, a white horizon, the dark machine below), so a coin lying
  flat shows the bright top of the ball, its rim shows the dark band, and a coin that leans or tumbles flashes the
  white horizon as it turns. The ink outline rides in the same geometry (flagged by `aFlat`, drawn in its own colour
  unlit), so a model is one draw call per material.

  Coins are one geometry each (silver, gold), drawn instanced: every coin on the field, in the tray and in the hopper
  is an instance of one of the two meshes. Their faces are painted (the rim, a groove, a star on silver, a B on gold)
  on a small texture over the matcap. Gold coins also catch a slow band of shine that sweeps the field (uTime).
  The four prizes (a cut gem, a stamped gold bar, the Golden Idol, the Crown) are groups of a few meshes each. Every
  model is centred on its body (a coin's middle, the middle of a prize's PRIZE_SIZE box), lies flat and faces +z, as
  the simulation's poses expect (types.ts Item: x, y, z, yaw, tiltX, tiltZ).
*/

export const INK = '#0b1033'
const TAU = Math.PI * 2
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z)
const V2 = (x: number, y: number) => new THREE.Vector2(x, y)

/* ------------------------------------------------------------------ */
/*  Matcaps and materials                                               */
/* ------------------------------------------------------------------ */

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

/** a band of the matcap: from this height of the ball (0 the top, 1 the bottom) down to the next */
type Band = [number, string]

/**
 * Paints a matcap: hard horizontal bands across the ball (a reflection of the sky, a horizon and the floor), a rim
 * light round its edge, and optionally a scatter of sparkle dots (for jewels, so their facets glint).
 */
function matcap(bands: Band[], rim: string, rimA: number, dots = 0) {
  const S = 256
  const [c, g] = canvas(S, S)
  g.fillStyle = bands[bands.length - 1][1]
  g.fillRect(0, 0, S, S)
  g.save()
  g.beginPath()
  g.arc(S / 2, S / 2, S / 2, 0, TAU)
  g.clip()
  bands.forEach(([y0, col], i) => {
    const y1 = i + 1 < bands.length ? bands[i + 1][0] : 1
    g.fillStyle = col
    g.fillRect(0, y0 * S, S, (y1 - y0) * S + 1)
  })
  // the horizon bends a little round the ball, like a reflection would
  g.globalAlpha = 0.25
  g.fillStyle = '#ffffff'
  g.beginPath()
  g.ellipse(S * 0.5, S * 0.18, S * 0.42, S * 0.1, 0, 0, TAU)
  g.fill()
  g.globalAlpha = 1
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < dots; i++) {
    const a = rnd() * TAU
    const r = Math.sqrt(rnd()) * S * 0.46
    g.fillStyle = 'rgba(255,255,255,0.95)'
    g.beginPath()
    g.arc(S / 2 + Math.cos(a) * r, S / 2 + Math.sin(a) * r, 3 + rnd() * 6, 0, TAU)
    g.fill()
  }
  const rg = g.createRadialGradient(S / 2, S / 2, S * 0.36, S / 2, S / 2, S / 2)
  rg.addColorStop(0, 'rgba(0,0,0,0)')
  rg.addColorStop(1, rim)
  g.globalAlpha = rimA
  g.fillStyle = rg
  g.fillRect(0, 0, S, S)
  g.restore()
  return tex(c)
}

const MATCAPS = {
  chrome: () =>
    matcap(
      [
        [0, '#c7d3e8'],
        [0.17, '#e3eaf6'],
        [0.27, '#ffffff'],
        [0.34, '#9fb0cb'],
        [0.5, '#7898bb'],
        [0.62, '#526899'],
        [0.8, '#3a4680'],
        [0.92, '#6a4f9a'],
      ],
      'rgba(255,90,200,0.9)',
      0.5,
    ),
  gold: () =>
    matcap(
      [
        [0, '#ffcf3d'],
        [0.17, '#ffe27a'],
        [0.27, '#fff7d6'],
        [0.34, '#f4b324'],
        [0.5, '#e29a1c'],
        [0.62, '#b8700c'],
        [0.8, '#8c4a08'],
        [0.92, '#a65a2a'],
      ],
      'rgba(255,120,90,0.9)',
      0.45,
    ),
  jewel: () =>
    matcap(
      [
        [0, '#d8d8d8'],
        [0.16, '#ffffff'],
        [0.26, '#f2f2f2'],
        [0.33, '#a8a8a8'],
        [0.52, '#686868'],
        [0.72, '#363636'],
        [0.88, '#7a7a7a'],
      ],
      'rgba(255,255,255,0.9)',
      0.35,
      26,
    ),
}

/** a matcap material that also draws the ink hull: where `aFlat` is 1 it shows the vertex colour as it is */
function inkMatcap(matcapTex: THREE.Texture, o: { map?: THREE.Texture; glint?: { value: number } } = {}) {
  const m = new THREE.MeshMatcapMaterial({ matcap: matcapTex, map: o.map ?? null, vertexColors: true })
  const glint = o.glint
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFlat;\nvarying float vFlat;\nvarying vec3 vWorld;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vFlat = aFlat;
        vec4 wp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        vWorld = (modelMatrix * wp).xyz;`,
      )
    let frag = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFlat;\nvarying vec3 vWorld;\nuniform float uTime;')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb, vFlat);\n#include <opaque_fragment>')
    if (glint) {
      s.uniforms.uTime = glint
      // a slow diagonal band of shine that sweeps the field every few seconds
      frag = frag.replace(
        'outgoingLight = mix(',
        `float gb = fract((vWorld.x * 0.55 + vWorld.z * 0.4) * 0.045 - uTime * 0.09);
        float shine = smoothstep(0.0, 0.012, gb) * (1.0 - smoothstep(0.012, 0.05, gb));
        outgoingLight += vec3(1.0, 0.92, 0.62) * shine * 0.85 * (1.0 - vFlat);
        outgoingLight = mix(`,
      )
    } else s.uniforms.uTime = { value: 0 }
    s.fragmentShader = frag
  }
  m.customProgramCacheKey = () => (glint ? 'pc-mc-glint' : o.map ? 'pc-mc-map' : 'pc-mc')
  return m
}

/** the materials one machine draws with; the scene owns them and disposes them (nothing is cached across scenes) */
export interface Mats {
  /** painted parts: toon shading through a ramp, lit by the scene's key light */
  toon: THREE.Material
  chrome: THREE.Material
  gold: THREE.Material
  /** jewels and the gem: a neutral matcap times the vertex colour */
  jewel: THREE.Material
  coin: Record<'silver' | 'gold', THREE.Material>
  /** the gold coins' sweeping shine (scene seconds) */
  uTime: { value: number }
  own: { dispose: () => void }[]
}

export function makeMats(): Mats {
  const uTime = { value: 0 }
  const caps = { chrome: MATCAPS.chrome(), gold: MATCAPS.gold(), jewel: MATCAPS.jewel() }
  const faces = { silver: coinFace('silver'), gold: coinFace('gold') }
  const ramp = toonRamp([92, 166, 226, 255])
  const toon = vkMaterial(ramp)
  const chrome = inkMatcap(caps.chrome)
  const gold = inkMatcap(caps.gold)
  const jewel = inkMatcap(caps.jewel)
  const coin = { silver: inkMatcap(caps.chrome, { map: faces.silver }), gold: inkMatcap(caps.gold, { map: faces.gold, glint: uTime }) }
  return {
    toon,
    chrome,
    gold,
    jewel,
    coin,
    uTime,
    own: [toon, chrome, gold, jewel, coin.silver, coin.gold, caps.chrome, caps.gold, caps.jewel, faces.silver, faces.gold],
  }
}

/* ------------------------------------------------------------------ */
/*  Coins                                                               */
/* ------------------------------------------------------------------ */

/** a five-pointed star path, centred on (x, y) */
function starPath(g: CanvasRenderingContext2D, x: number, y: number, r: number, inner = 0.45) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const rr = i % 2 ? r * inner : r
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
  }
  g.closePath()
}

/**
 * A coin's face, in grey (it multiplies the matcap): a bright rim, a dark groove inside it, the field, and the emblem
 * stamped in relief (a highlight up and left of it, a shadow down and right). The corners are spare: the top left is
 * white (for the outline, which takes its colour from the vertices) and the bottom left the tone of the coin's edge.
 */
function coinFace(kind: 'silver' | 'gold') {
  const S = 256
  const [c, g] = canvas(S, S)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, S, S)
  g.fillStyle = '#9c9c9c'
  g.fillRect(0, S - 28, 28, 28)
  const cx = S / 2
  const R = S / 2
  const disc = (r: number, col: string) => {
    g.fillStyle = col
    g.beginPath()
    g.arc(cx, cx, r, 0, TAU)
    g.fill()
  }
  disc(R, '#ffffff')
  disc(R * 0.85, '#8a8a8a')
  disc(R * 0.8, '#d6d6d6')
  // a ring of beads round the field
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU
    g.fillStyle = '#f4f4f4'
    g.beginPath()
    g.arc(cx + Math.cos(a) * R * 0.71, cx + Math.sin(a) * R * 0.71, R * 0.028, 0, TAU)
    g.fill()
  }
  const emblem = (dx: number, dy: number, col: string) => {
    g.fillStyle = col
    if (kind === 'silver') {
      starPath(g, cx + dx, cx + dy + 4, R * 0.5)
      g.fill()
    } else {
      g.font = `900 ${Math.round(R * 1.02)}px Manrope, ui-rounded, system-ui, sans-serif`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText('B', cx + dx, cx + dy + R * 0.06)
    }
  }
  emblem(5, 6, '#6e6e6e')
  emblem(-3, -3, '#ffffff')
  emblem(0, 0, '#e8e8e8')
  return tex(c)
}

type Vert = { p: P3; n: P3; u: [number, number] }

/**
 * One coin, lying flat and centred on the origin: bevelled caps (UVs planar, so the face art lies flat on them, the
 * bottom one mirrored), the edge, and the ink hull (a slightly bigger cylinder seen from inside) in one geometry with
 * position, normal, uv, color and aFlat. About 330 triangles.
 */
export function coinGeometry(seg = 28, ink = 0.03) {
  const R = COIN_R
  const H = COIN_H / 2
  const B = 0.03
  const pos: number[] = []
  const nrm: number[] = []
  const uvs: number[] = []
  const col: number[] = []
  const flat: number[] = []
  const inkC = new THREE.Color(INK)
  const a = V()
  const b = V()
  const fn = V()
  const tri = (v0: Vert, v1: Vert, v2: Vert, hull = false) => {
    // keep the triangle facing the way its normals say (or the opposite, for the hull)
    a.set(v1.p[0] - v0.p[0], v1.p[1] - v0.p[1], v1.p[2] - v0.p[2])
    b.set(v2.p[0] - v0.p[0], v2.p[1] - v0.p[1], v2.p[2] - v0.p[2])
    fn.crossVectors(a, b)
    const out = fn.x * (v0.n[0] + v1.n[0] + v2.n[0]) + fn.y * (v0.n[1] + v1.n[1] + v2.n[1]) + fn.z * (v0.n[2] + v1.n[2] + v2.n[2])
    const list = out < 0 !== hull ? [v0, v2, v1] : [v0, v1, v2]
    for (const v of list) {
      pos.push(...v.p)
      nrm.push(...(hull ? (v.n.map((x) => -x) as P3) : v.n))
      uvs.push(...v.u)
      if (hull) col.push(inkC.r, inkC.g, inkC.b)
      else col.push(1, 1, 1)
      flat.push(hull ? 1 : 0)
    }
  }
  const EDGE: [number, number] = [0.04, 0.04]
  const WHITE: [number, number] = [0.03, 0.97]
  const planar = (x: number, z: number, mirror: boolean): [number, number] => [0.5 + (mirror ? -x : x) / (2 * R), 0.5 - z / (2 * R)]
  const ring = (r: number, y: number, n: (c: number, s: number) => P3, uv: (x: number, z: number) => [number, number]) =>
    Array.from({ length: seg + 1 }, (_, i): Vert => {
      const t = (i / seg) * TAU
      const x = Math.cos(t) * r
      const z = -Math.sin(t) * r
      return { p: [x, y, z], n: n(Math.cos(t), -Math.sin(t)), u: uv(x, z) }
    })
  const k = Math.SQRT1_2
  for (const sy of [1, -1]) {
    const mirror = sy < 0
    const centre: Vert = { p: [0, sy * H, 0], n: [0, sy, 0], u: [0.5, 0.5] }
    const capEdge = ring(R - B, sy * H, () => [0, sy, 0], (x, z) => planar(x, z, mirror))
    const bevTop = ring(R - B, sy * H, (c, s) => [c * 0.35, sy * 0.94, s * 0.35], (x, z) => planar(x, z, mirror))
    const bevOut = ring(R, sy * (H - B), (c, s) => [c * k, sy * k, s * k], (x, z) => planar(x * 0.99, z * 0.99, mirror))
    for (let i = 0; i < seg; i++) {
      tri(centre, capEdge[i], capEdge[i + 1])
      tri(bevTop[i], bevOut[i], bevOut[i + 1])
      tri(bevTop[i], bevOut[i + 1], bevTop[i + 1])
    }
  }
  const sideTop = ring(R, H - B, (c, s) => [c, 0, s], () => EDGE)
  const sideBot = ring(R, -(H - B), (c, s) => [c, 0, s], () => EDGE)
  for (let i = 0; i < seg; i++) {
    tri(sideTop[i], sideBot[i], sideBot[i + 1])
    tri(sideTop[i], sideBot[i + 1], sideTop[i + 1])
  }
  // the hull: a closed cylinder pushed out by `ink`, its faces turned inwards
  const hr = R + ink
  const hh = H + ink * 0.8
  const hseg = Math.max(12, Math.round(seg * 0.75))
  const hring = (y: number) =>
    Array.from({ length: hseg + 1 }, (_, i): Vert => {
      const t = (i / hseg) * TAU
      return { p: [Math.cos(t) * hr, y, -Math.sin(t) * hr], n: [Math.cos(t), 0, -Math.sin(t)], u: WHITE }
    })
  const ht = hring(hh)
  const hb = hring(-hh)
  for (let i = 0; i < hseg; i++) {
    tri(ht[i], hb[i], hb[i + 1], true)
    tri(ht[i], hb[i + 1], ht[i + 1], true)
    tri({ p: [0, hh, 0], n: [0, 1, 0], u: WHITE }, { ...ht[i], n: [0, 1, 0] }, { ...ht[i + 1], n: [0, 1, 0] }, true)
    tri({ p: [0, -hh, 0], n: [0, -1, 0], u: WHITE }, { ...hb[i], n: [0, -1, 0] }, { ...hb[i + 1], n: [0, -1, 0] }, true)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  g.setAttribute('aFlat', new THREE.Float32BufferAttribute(flat, 1))
  g.computeBoundingSphere()
  return g
}

/* ------------------------------------------------------------------ */
/*  Prize kit                                                           */
/* ------------------------------------------------------------------ */

const PRIZE_INK = 0.026
const rbox = (w: number, h: number, d: number, r = 0.05, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3))

/** smooth normals across shared corners, so the hull of a faceted shape stays closed */
function smoothed(g: Geo) {
  const x = g.index ? g.toNonIndexed() : g.clone()
  for (const key of Object.keys(x.attributes)) if (key !== 'position') x.deleteAttribute(key)
  const m = mergeVertices(x, 1e-4)
  m.computeVertexNormals()
  x.dispose()
  return m
}

/** the ink hull of a flat-shaded solid, built from its smoothed copy and turned inside out, ready for VKit (flat) */
function inkHull(g: Geo, t: number) {
  const s = smoothed(g)
  const h = shell(s, t).toNonIndexed()
  s.dispose()
  const p = h.getAttribute('position').array as Float32Array
  for (let i = 0; i < p.length; i += 9) {
    const tmp = p.slice(i + 3, i + 6)
    p.copyWithin(i + 3, i + 6, i + 9)
    p.set(tmp, i + 6)
  }
  h.deleteAttribute('normal')
  h.computeVertexNormals()
  return h
}

/** adds a flat-faceted solid: its facets shaded each on its own, outlined by a closed hull */
function facets(k: VKit, g: Geo, color: THREE.ColorRepresentation, m?: THREE.Matrix4, ink = PRIZE_INK) {
  const f = g.index ? g.toNonIndexed() : g.clone()
  f.deleteAttribute('normal')
  f.computeVertexNormals()
  const hull = inkHull(g, ink)
  g.dispose()
  k.add(f, color, m, 0)
  k.add(hull, INK, m, 0, true)
}

/** a prism between rings of points (each ring a closed loop at its own height), capped at both ends; flat-shaded */
function loft(rings: { pts: [number, number][]; y: number }[]) {
  const pos: number[] = []
  const quad = (a: P3, b: P3, c: P3, d: P3) => pos.push(...a, ...b, ...c, ...a, ...c, ...d)
  for (let r = 0; r < rings.length - 1; r++) {
    const A = rings[r]
    const B = rings[r + 1]
    const n = A.pts.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      quad([A.pts[i][0], A.y, A.pts[i][1]], [A.pts[j][0], A.y, A.pts[j][1]], [B.pts[j][0], B.y, B.pts[j][1]], [B.pts[i][0], B.y, B.pts[i][1]])
    }
  }
  const cap = (R: { pts: [number, number][]; y: number }, up: boolean) => {
    const n = R.pts.length
    const c: P3 = [R.pts.reduce((s, p) => s + p[0], 0) / n, R.y, R.pts.reduce((s, p) => s + p[1], 0) / n]
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      const a: P3 = [R.pts[i][0], R.y, R.pts[i][1]]
      const b: P3 = [R.pts[j][0], R.y, R.pts[j][1]]
      if (up) pos.push(...c, ...b, ...a)
      else pos.push(...c, ...a, ...b)
    }
  }
  cap(rings[rings.length - 1], true)
  cap(rings[0], false)
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  // make every triangle face outwards (away from the middle of the solid)
  const p = g.getAttribute('position').array as Float32Array
  const mid = V()
  for (let i = 0; i < p.length; i += 3) mid.add(V(p[i], p[i + 1], p[i + 2]))
  mid.multiplyScalar(3 / p.length)
  const e1 = V()
  const e2 = V()
  const c = V()
  for (let i = 0; i < p.length; i += 9) {
    e1.set(p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2])
    e2.set(p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2])
    c.set((p[i] + p[i + 3] + p[i + 6]) / 3 - mid.x, (p[i + 1] + p[i + 4] + p[i + 7]) / 3 - mid.y, (p[i + 2] + p[i + 5] + p[i + 8]) / 3 - mid.z)
    if (e1.cross(e2).dot(c) < 0) {
      const t = p.slice(i + 3, i + 6)
      p.copyWithin(i + 3, i + 6, i + 9)
      p.set(t, i + 6)
    }
  }
  g.computeVertexNormals()
  return g
}

/** a rectangle with its corners cut (an octagon), half-sizes hx, hz, corner cut c */
const octagon = (hx: number, hz: number, c: number): [number, number][] => [
  [hx, hz - c],
  [hx, -hz + c],
  [hx - c, -hz],
  [-hx + c, -hz],
  [-hx, -hz + c],
  [-hx, hz - c],
  [-hx + c, hz],
  [hx - c, hz],
]

export interface PrizeModel {
  root: THREE.Group
  /** a soft glow behind it, so it reads among the coins (its opacity pulses) */
  halo: THREE.Sprite
  /** what the scene must dispose for this model (geometries, the stamp's texture) */
  own: { dispose: () => void }[]
}

export const PRIZE_GLOW: Record<'gem' | 'bar' | 'idol' | 'crown', string> = { gem: '#ff4fb8', bar: '#ffc94a', idol: '#ffb030', crown: '#ffe39a' }

/* ---- the gem: an octagonal step cut in hot pink, table up ---- */

function gemParts(mats: Mats) {
  const { w, h, d } = PRIZE_SIZE.gem
  const hx = w / 2
  const hz = d / 2
  const y0 = -h / 2
  const k = new VKit(INK, PRIZE_INK)
  const ring = (s: number, y: number) => ({ pts: octagon(hx * s, hz * s, hx * s * 0.34), y: y0 + y })
  const body = loft([ring(0.5, 0), ring(0.82, 0.2), ring(1, 0.36), ring(1, 0.44), ring(0.8, 0.58), ring(0.58, h)])
  facets(k, body, '#ff3d9a')
  // the table catches a lighter tone, and a few bright glints sit on its facets
  const table = loft([ring(0.5, h - 0.004), ring(0.5, h + 0.004)])
  k.add(table, '#ff9ccd', undefined, 0)
  for (const [x, z, s] of [[-0.12, -0.08, 0.05], [0.1, 0.06, 0.035], [0.2, -0.16, 0.025]] as const) k.add(new THREE.SphereGeometry(s, 8, 6), new THREE.Color('#ffffff').multiplyScalar(1.6), T([x, h / 2 + 0.01, z], [0, 0, 0], [1, 0.35, 1]), 0, true)
  return k.mesh('gem', mats.jewel)
}

/* ---- the gold bar: a stamped ingot ---- */

function stampTexture() {
  const [c, g] = canvas(512, 196)
  g.clearRect(0, 0, 512, 196)
  g.strokeStyle = 'rgba(90,45,0,0.75)'
  g.lineWidth = 10
  g.beginPath()
  g.roundRect(14, 14, 484, 168, 26)
  g.stroke()
  g.fillStyle = 'rgba(90,45,0,0.8)'
  g.font = '900 86px Manrope, ui-rounded, system-ui, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('BOJE', 256, 84)
  g.font = '800 40px Manrope, ui-rounded, system-ui, sans-serif'
  g.fillText('999.9  FINE GOLD', 256, 148)
  for (const x of [52, 460]) {
    starPath(g, x, 84, 22)
    g.fill()
  }
  // a highlight edge under each stroke, so the stamp reads as pressed in
  return tex(c)
}

function barParts(mats: Mats, own: { dispose: () => void }[]) {
  const { w, h, d } = PRIZE_SIZE.bar
  const k = new VKit(INK, PRIZE_INK)
  const bot = (s: number) => octagon(w / 2 * s, d / 2 * s, 0.05)
  const body = loft([
    { pts: bot(1), y: -h / 2 },
    { pts: bot(1), y: -h / 2 + 0.06 },
    { pts: octagon(w / 2 - 0.15, d / 2 - 0.11, 0.05), y: h / 2 },
  ])
  facets(k, body, '#ffffff')
  const group = new THREE.Group()
  group.add(k.mesh('bar', mats.gold))
  const t = stampTexture()
  const sm = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const stamp = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.42, (d - 0.26) * 0.92), sm)
  stamp.rotation.x = -Math.PI / 2
  stamp.position.y = h / 2 + 0.002
  stamp.renderOrder = 2
  group.add(stamp)
  own.push(t, sm, stamp.geometry)
  return group
}

/* ---- the Golden Idol: a squat temple statuette on a plinth, ruby eyes, a sunburst headdress ---- */

function idolParts(mats: Mats) {
  const { w, h } = PRIZE_SIZE.idol
  const y0 = -h / 2
  const g = new VKit(INK, PRIZE_INK)
  const j = new VKit(INK, PRIZE_INK)
  const dark = new VKit(INK, PRIZE_INK)
  // the plinth: a stepped block
  g.add(rbox(w, 0.22, w, 0.04), '#ffffff', T([0, y0 + 0.11, 0]))
  g.add(rbox(w * 0.82, 0.12, w * 0.82, 0.035), '#ffe9a8', T([0, y0 + 0.28, 0]))
  // the body, sitting cross-legged: a round belly, folded legs in front
  g.add(new THREE.SphereGeometry(0.36, 22, 16), '#ffffff', T([0, y0 + 0.62, 0], [0, 0, 0], [1.05, 0.95, 0.9]))
  g.add(new THREE.CapsuleGeometry(0.13, 0.42, 4, 12), '#ffffff', T([0, y0 + 0.42, 0.18], [0, 0, Math.PI / 2]))
  // arms folded over the belly
  for (const s of [-1, 1]) {
    g.add(new THREE.CapsuleGeometry(0.085, 0.3, 4, 10), '#ffffff', T([s * 0.3, y0 + 0.66, 0.12], [0.2, 0, s * 0.5]))
    g.add(new THREE.SphereGeometry(0.09, 12, 8), '#ffffff', T([s * 0.1, y0 + 0.56, 0.32]))
  }
  // the head: big and square, tiki style
  const hy = y0 + 1.12
  g.add(rbox(0.66, 0.54, 0.56, 0.12, 4), '#ffffff', T([0, hy, 0]))
  // brow, nose, ear plugs
  g.add(rbox(0.6, 0.09, 0.12, 0.04), '#ffe9a8', T([0, hy + 0.1, 0.26]))
  g.add(rbox(0.13, 0.17, 0.1, 0.04), '#ffffff', T([0, hy - 0.03, 0.29]))
  for (const s of [-1, 1]) g.add(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 14), '#ffe9a8', T([s * 0.35, hy - 0.04, 0.02], [0, 0, Math.PI / 2]))
  // the mouth: a dark grin with gold teeth
  dark.add(rbox(0.32, 0.08, 0.06, 0.03), '#3a1606', T([0, hy - 0.17, 0.27]), 0.012)
  // ruby eyes, a jade gem on the brow band
  for (const s of [-1, 1]) j.add(new THREE.SphereGeometry(0.07, 14, 10), '#ff2b4f', T([s * 0.15, hy + 0.02, 0.27], [0, 0, 0], [1, 0.8, 0.6]), 0.014)
  j.add(new THREE.OctahedronGeometry(0.07, 0), '#2bf0a0', T([0, hy + 0.2, 0.25], [0, 0, 0], [1, 1.2, 0.6]), 0.014)
  // the sunburst headdress: rays fanning up behind the head
  for (let i = 0; i < 7; i++) {
    const a = ((i - 3) / 3) * 1.05
    const r0 = 0.26
    const len = i === 3 ? 0.34 : 0.27
    const cx = Math.sin(a) * (r0 + len / 2)
    const cy = hy + 0.12 + Math.cos(a) * (r0 + len / 2)
    g.add(new THREE.ConeGeometry(0.085, len, 4, 1), i % 2 ? '#ffe9a8' : '#ffffff', T([cx, Math.min(cy, h / 2 - (len / 2) * Math.cos(a)), -0.12], [0, 0, -a], [1, 1, 0.45]))
  }
  g.add(new THREE.CylinderGeometry(0.29, 0.29, 0.1, 22, 1, false, -Math.PI / 2, Math.PI), '#ffe9a8', T([0, hy + 0.24, -0.08], [-Math.PI / 2, 0, 0]))
  const group = new THREE.Group()
  group.add(g.mesh('idol', mats.gold), j.mesh('idolGems', mats.jewel), dark.mesh('idolMouth', mats.toon))
  return group
}

/* ---- the Crown: a gold band of points on an ermine rim, velvet inside, jewels round the band ---- */

function crownParts(mats: Mats) {
  const { w, h } = PRIZE_SIZE.crown
  const y0 = -h / 2
  const R = w / 2 - 0.1
  const g = new VKit(INK, PRIZE_INK)
  const j = new VKit(INK, PRIZE_INK)
  const t = new VKit(INK, PRIZE_INK)
  // the ermine rim: a fat white roll with black tails
  t.add(new THREE.TorusGeometry(R + 0.01, 0.085, 10, 40), '#f6f2ea', T([0, y0 + 0.085, 0], [Math.PI / 2, 0, 0]))
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.2
    t.add(new THREE.SphereGeometry(0.026, 6, 4), '#1a1424', T([Math.cos(a) * (R + 0.09), y0 + 0.1, Math.sin(a) * (R + 0.09)], [0, 0, 0], [1, 1.6, 1]), 0, true)
  }
  // the band
  const band = [V2(R - 0.05, -0.15), V2(R + 0.02, -0.15), V2(R, 0.15), V2(R - 0.05, 0.15), V2(R - 0.05, -0.15)]
  g.add(new THREE.LatheGeometry(band, 40), '#ffffff', T([0, y0 + 0.31, 0]))
  // the velvet cap inside, domed
  t.add(new THREE.SphereGeometry(R - 0.05, 28, 14, 0, TAU, 0, Math.PI / 2), '#c4126e', T([0, y0 + 0.36, 0], [0, 0, 0], [1, 0.82, 1]))
  // the points, each tipped with a ball, and little fleurs between them
  const N = 6
  for (let i = 0; i < N; i++) {
    const a = (i / N) * TAU
    const x = Math.sin(a) * R
    const z = Math.cos(a) * R
    g.add(new THREE.ConeGeometry(0.15, 0.36, 4, 1), '#ffffff', T([x, y0 + 0.6, z], [0, a, 0], [1, 1, 0.5]))
    g.add(new THREE.SphereGeometry(0.065, 12, 8), '#ffffff', T([x * 1.0, y0 + 0.8, z * 1.0]))
    const b = a + Math.PI / N
    g.add(new THREE.SphereGeometry(0.05, 10, 6), '#ffffff', T([Math.sin(b) * R, y0 + 0.5, Math.cos(b) * R]))
  }
  // the orb and cross on top
  g.add(new THREE.SphereGeometry(0.09, 14, 10), '#ffffff', T([0, y0 + 0.74, 0]))
  g.add(rbox(0.05, 0.2, 0.05, 0.015), '#ffffff', T([0, y0 + 0.88, 0]))
  g.add(rbox(0.15, 0.05, 0.05, 0.015), '#ffffff', T([0, y0 + 0.91, 0]))
  // jewels round the band: ruby, sapphire, emerald
  const cols = ['#ff2b4f', '#3a7bff', '#20e08a']
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU
    j.add(new THREE.SphereGeometry(0.075, 14, 10), cols[i % 3], T([Math.sin(a) * (R + 0.03), y0 + 0.3, Math.cos(a) * (R + 0.03)], [0, a, 0], [1, 1.1, 0.55]), 0.014)
  }
  j.add(new THREE.OctahedronGeometry(0.06, 0), '#ff2b4f', T([0, y0 + 0.74, 0.085], [0, 0, 0], [1, 1.2, 0.5]), 0.012)
  const group = new THREE.Group()
  group.add(g.mesh('crown', mats.gold), j.mesh('crownGems', mats.jewel), t.mesh('crownSoft', mats.toon))
  return group
}

/** builds one prize model (its own geometries; the materials are the scene's) */
export function buildPrize(kind: 'gem' | 'bar' | 'idol' | 'crown', mats: Mats, glow: THREE.Texture): PrizeModel {
  const own: { dispose: () => void }[] = []
  const root = new THREE.Group()
  root.name = kind
  const body = kind === 'gem' ? gemParts(mats) : kind === 'bar' ? barParts(mats, own) : kind === 'idol' ? idolParts(mats) : crownParts(mats)
  root.add(body)
  body.traverse((o) => {
    if (o instanceof THREE.Mesh) own.push(o.geometry)
  })
  const hm = new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(PRIZE_GLOW[kind]).multiplyScalar(0.9), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })
  const halo = new THREE.Sprite(hm)
  const s = PRIZE_SIZE[kind]
  halo.scale.setScalar((Math.max(s.w, s.d) + s.h) * 1.15)
  halo.renderOrder = 3
  root.add(halo)
  own.push(hm)
  return { root, halo, own }
}

/** the colour a kind's effects use (sparkles, the tray flash) */
export const KIND_COLOR: Record<ItemKind, string> = { silver: '#dfe9ff', gold: '#ffd24a', gem: '#ff4fb8', bar: '#ffc94a', idol: '#ffb030', crown: '#ffe39a' }
