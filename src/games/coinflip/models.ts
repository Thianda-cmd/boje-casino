import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { T, VKit, toonRamp, vkMaterial } from '../../lib/three/toon'
import { HALF, RADIUS } from './physics'
import {
  BOX,
  B_PATH,
  C,
  CROWN_BALLS,
  CROWN_BAND,
  CROWN_BODY,
  CROWN_CROSS,
  CROWN_INNER,
  CROWN_JEWELS,
  CROWN_STUDS,
  ENAMEL,
  FACET_SHADE,
  GEM_B_X,
  GEM_B_Y,
  GEM_HEX,
  GEM_SCALE,
  INK,
  LEGEND,
  RING,
  ROUNDEL_R,
} from './faces'
import type { Side } from './rules'

/*
  The coin, built in code. The body is turned like a real blank: a raised rim with rounded shoulders and a reeded
  edge (90 grooves). The faces are discs sunk inside the rim, painted from faces.ts into four maps: a height field
  (blurred into soft bevels) turned into a normal map, a cavity term from it, the colours (gold, the gem's green
  enamel, the crown's jewels, ink lines) and which parts are metal. Everything is shaded in the site's toon style but
  rich: the gold is a banded matcap of a warm studio (deep amber to white in hard steps, a breath of the velvet's plum
  in the lowest band), with a warm fresnel glow at grazing angles so a face turned away from the lamp still reads as
  gold, never brown; the enamel takes the spotlight in two tones with a glassy glint, the metal flashes a hard star
  where it catches the spotlight, and an inverted hull draws the ink outline. The gold heats up as a streak burns.

  Textures and materials are cached for the next visit; releaseModels() lets go of their GPU copies when the scene
  closes (as Pop Party's does).
*/

export const FACE_Y = HALF - 0.026
export const FACE_R = 0.852
const RIM_TOP = HALF
const EDGE = HALF - 0.04
const OUTLINE = 0.024

/* ---------------- the matcap: a toon studio in gold ---------------- */

let matcap: THREE.CanvasTexture | null = null
function matcapTexture() {
  if (matcap) return matcap
  const S = 256
  const cv = document.createElement('canvas')
  cv.width = cv.height = S
  const g = cv.getContext('2d')!
  const img = g.createImageData(S, S)
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  // darkest to brightest; the darkest picks up the velvet's plum where the coin looks down at the table
  // (the darkest is a deep amber, not bronze: gold looking down at plum velvet still reads as gold)
  const PAL = ['#8a4510', '#c2741c', '#e8a42a', '#fbcd4c', '#ffe7a3', '#fff6dc'].map(hex)
  const PLUM = hex('#5a1f3c')
  const EDGES = [0.2, 0.4, 0.63, 0.87, 1.3]
  const L = new THREE.Vector3(-0.38, 0.74, 0.56).normalize()
  const K = new THREE.Vector3(0.92, 0.12, -0.36).normalize()
  for (let j = 0; j < S; j++)
    for (let i = 0; i < S; i++) {
      const x = ((i + 0.5) / S) * 2 - 1
      const y = 1 - ((j + 0.5) / S) * 2
      const rr = x * x + y * y
      const o = (j * S + i) * 4
      if (rr > 1) {
        img.data.set([...PAL[1], 255], o)
        continue
      }
      const z = Math.sqrt(1 - rr)
      // the view reflected off a surface facing (x, y, z)
      const Rx = 2 * z * x
      const Ry = 2 * z * y
      const Rz = 2 * z * z - 1
      const sm = (a: number, b: number, t: number) => {
        const u = Math.min(1, Math.max(0, (t - a) / (b - a)))
        return u * u * (3 - 2 * u)
      }
      const softbox = sm(0.12, 0.7, Ry)
      const horizon = sm(-0.25, 0.18, Ry)
      // the warm room behind the camera: what a face turned to you shows
      const fill = sm(0.15, 0.95, Rz) * (1 - sm(-0.1, -0.6, Ry))
      const spec = Math.max(0, Rx * L.x + Ry * L.y + Rz * L.z) ** 48
      const kick = Math.max(0, Rx * K.x + Ry * K.y + Rz * K.z) ** 6
      // the lit velvet under the coin, mirrored warm in a face that looks down at it
      const table = sm(-0.05, -0.55, Ry)
      const e = 0.1 + 0.34 * softbox + 0.3 * horizon + 0.42 * fill + 0.42 * kick + 0.36 * table + 1.4 * spec
      // hard bands with a pixel of softening, so the texture filters cleanly
      const w = 0.012
      let c = [...PAL[0]]
      if (Ry < -0.55) {
        const k = sm(-0.55, -0.95, Ry) * 0.3
        c = c.map((v, t) => v + (PLUM[t] - v) * k)
      }
      for (let b = 0; b < EDGES.length; b++) {
        const k = sm(EDGES[b] - w, EDGES[b] + w, e)
        if (k <= 0) break
        c = c.map((v, t) => v + (PAL[b + 1][t] - v) * k)
      }
      img.data.set([c[0], c[1], c[2], 255], o)
    }
  g.putImageData(img, 0, 0)
  matcap = new THREE.CanvasTexture(cv)
  matcap.colorSpace = THREE.SRGBColorSpace
  return matcap
}

/* ---------------- painting the faces ---------------- */

interface FaceMaps {
  color: THREE.DataTexture
  normal: THREE.DataTexture
}
const faceMaps = new Map<string, FaceMaps>()

/** the lettering round the top of a face, letter by letter along an arc */
function arcText(g: CanvasRenderingContext2D, text: string, r: number, size: number, spread: number) {
  g.save()
  g.font = `800 ${size}px Manrope, system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  const widths = [...text].map((ch) => g.measureText(ch).width + size * 0.12)
  const total = widths.reduce((a, b) => a + b, 0)
  let a = -Math.PI / 2 - (total / r) * spread * 0.5
  for (let i = 0; i < text.length; i++) {
    const w = widths[i]
    a += (w / r / 2) * spread
    g.save()
    g.translate(C + Math.cos(a) * r, C + Math.sin(a) * r)
    g.rotate(a + Math.PI / 2)
    g.fillText(text[i], 0, 0)
    g.restore()
    a += (w / r / 2) * spread
  }
  g.restore()
}

/** five-pointed stars along the bottom of a face */
function bottomStars(g: CanvasRenderingContext2D, r: number, n: number, size: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i - (n - 1) / 2) * 0.22
    star(g, C + Math.cos(a) * r, C + Math.sin(a) * r, size, size * 0.45)
    g.fill()
  }
}
function star(g: CanvasRenderingContext2D, x: number, y: number, ro: number, ri: number) {
  g.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    const r = i % 2 ? ri : ro
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
  }
  g.closePath()
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
const gray = (v: number) => {
  const c = Math.round(Math.min(1, Math.max(0, v)) * 255)
  return `rgb(${c},${c},${c})`
}
const dome = (g: CanvasRenderingContext2D, x: number, y: number, r: number, lo: number, hi: number, rx = r, ry = r) => {
  g.save()
  g.translate(x, y)
  g.scale(rx / r, ry / r)
  const gr = g.createRadialGradient(-r * 0.15, -r * 0.15, 0, 0, 0, r)
  gr.addColorStop(0, gray(hi))
  gr.addColorStop(0.7, gray(lo + (hi - lo) * 0.55))
  gr.addColorStop(1, gray(lo))
  g.fillStyle = gr
  g.beginPath()
  g.arc(0, 0, r, 0, Math.PI * 2)
  g.fill()
  g.restore()
}

/**
 * Paints one face: the height field (drawn in grey, soft-blurred into bevels), the colours and the metal mask. Both
 * are drawn in face units (the 200 box) and read back at `size` pixels.
 */
function paintFace(side: Side, size: number): FaceMaps {
  const k = size / BOX
  const mk = () => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.setTransform(k, 0, 0, k, 0, 0)
    return g
  }
  const H = mk()
  const P = mk()
  const M = mk()
  const hex = new Path2D()
  GEM_HEX.forEach(([x, y], i) => (i ? hex.lineTo(x, y) : hex.moveTo(x, y)))
  hex.closePath()
  const bPath = new Path2D()
  bPath.addPath(new Path2D(B_PATH), new DOMMatrix().translate(GEM_B_X, GEM_B_Y).scale(GEM_SCALE))
  const crown = new Path2D(CROWN_BODY)
  const cross = new Path2D(CROWN_CROSS)
  const roundel = new Path2D()
  roundel.arc(C, C, ROUNDEL_R, 0, Math.PI * 2)

  /* height: the field dished towards the rim, a groove, beads, lettering, then the design */
  {
    const g = H
    const fr = g.createRadialGradient(C, C, 0, C, C, 100)
    fr.addColorStop(0, gray(0.2))
    fr.addColorStop(1, gray(0.32))
    g.fillStyle = fr
    g.fillRect(0, 0, BOX, BOX)
    g.strokeStyle = gray(0.1)
    g.lineWidth = 1.7
    g.beginPath()
    g.arc(C, C, RING.groove, 0, Math.PI * 2)
    g.stroke()
    for (let i = 0; i < RING.beadN; i++) {
      const a = (i / RING.beadN) * Math.PI * 2
      dome(g, C + Math.cos(a) * RING.beads, C + Math.sin(a) * RING.beads, RING.beadR, 0.32, 0.66)
    }
    g.fillStyle = gray(0.58)
    arcText(g, LEGEND[side], RING.text, side === 'heads' ? 12.5 : 10.5, 1)
    bottomStars(g, RING.text, 5, 4.6)
    if (side === 'heads') {
      // the gem: a raised hexagon cut into six facets that rise to its middle, a bezel, the B standing on it
      g.fillStyle = gray(0.5)
      g.fill(hex)
      for (let i = 0; i < 6; i++) {
        const a = GEM_HEX[i]
        const b = GEM_HEX[(i + 1) % 6]
        const mx = (a[0] + b[0]) / 2
        const my = (a[1] + b[1]) / 2
        const gr = g.createLinearGradient(mx, my, C, C)
        gr.addColorStop(0, gray(0.5))
        gr.addColorStop(1, gray(0.78))
        g.fillStyle = gr
        g.beginPath()
        g.moveTo(C, C)
        g.lineTo(a[0], a[1])
        g.lineTo(b[0], b[1])
        g.closePath()
        g.fill()
      }
      g.strokeStyle = gray(0.62)
      g.lineWidth = 4.2
      g.lineJoin = 'round'
      g.stroke(hex)
      g.fillStyle = gray(0.96)
      g.fill(bPath, 'evenodd')
    } else {
      // the enamel roundel, sunk a touch below the field over an engraved sunburst (guilloché that glints through the
      // enamel), in a raised gold bezel
      g.fillStyle = gray(0.17)
      g.beginPath()
      g.arc(C, C, ROUNDEL_R, 0, Math.PI * 2)
      g.fill()
      g.save()
      g.beginPath()
      g.arc(C, C, ROUNDEL_R, 0, Math.PI * 2)
      g.clip()
      for (let i = 0; i < 64; i += 2) {
        const a0 = (i / 64) * Math.PI * 2
        const a1 = ((i + 1) / 64) * Math.PI * 2
        g.fillStyle = 'rgba(255,255,255,0.05)'
        g.beginPath()
        g.moveTo(C, C)
        g.arc(C, C, ROUNDEL_R, a0, a1)
        g.closePath()
        g.fill()
      }
      g.restore()
      g.strokeStyle = gray(0.6)
      g.lineWidth = 3.6
      g.beginPath()
      g.arc(C, C, ROUNDEL_R + 1.4, 0, Math.PI * 2)
      g.stroke()
      // the crown: raised gold, an engraved line inside the points, the band higher still, the balls domed
      g.fillStyle = gray(0.7)
      g.fill(crown)
      g.strokeStyle = gray(0.6)
      g.lineWidth = 1.6
      g.lineJoin = 'round'
      g.stroke(new Path2D(CROWN_INNER))
      g.fillStyle = gray(0.74)
      g.fill(cross)
      g.fillStyle = gray(0.82)
      roundRect(g, CROWN_BAND.x, CROWN_BAND.y, CROWN_BAND.w, CROWN_BAND.h, CROWN_BAND.r)
      g.fill()
      for (const [x, y, r] of CROWN_BALLS) dome(g, x, y, r, 0.7, 1)
      for (const [x, y, rx, ry] of CROWN_JEWELS) dome(g, x, y, Math.max(rx, ry), 0.84, 1, rx, ry)
      for (const [x, y] of CROWN_STUDS) dome(g, x, y, 2.2, 0.84, 0.96)
    }
  }

  /* colour: gold (white: the matcap brings the gold), the gem's green facets, the jewels, ink lines */
  {
    const g = P
    g.fillStyle = '#fff'
    g.fillRect(0, 0, BOX, BOX)
    // the field a touch deeper than the raised parts
    const fr = g.createRadialGradient(C, C, 0, C, C, 100)
    fr.addColorStop(0, '#e6dccb')
    fr.addColorStop(1, '#f4ecdc')
    g.fillStyle = fr
    g.fillRect(0, 0, BOX, BOX)
    g.fillStyle = '#fff'
    for (let i = 0; i < RING.beadN; i++) {
      const a = (i / RING.beadN) * Math.PI * 2
      g.beginPath()
      g.arc(C + Math.cos(a) * RING.beads, C + Math.sin(a) * RING.beads, RING.beadR, 0, Math.PI * 2)
      g.fill()
    }
    arcText(g, LEGEND[side], RING.text, side === 'heads' ? 12.5 : 10.5, 1)
    bottomStars(g, RING.text, 5, 4.6)
    if (side === 'heads') {
      const base = new THREE.Color(ENAMEL.green)
      for (let i = 0; i < 6; i++) {
        const a = GEM_HEX[i]
        const b = GEM_HEX[(i + 1) % 6]
        const c = base.clone().multiplyScalar(0.62 + 0.42 * FACET_SHADE[i])
        g.fillStyle = `#${c.getHexString()}`
        g.beginPath()
        g.moveTo(C, C)
        g.lineTo(a[0], a[1])
        g.lineTo(b[0], b[1])
        g.closePath()
        g.fill()
        g.strokeStyle = 'rgba(210,255,230,.55)'
        g.lineWidth = 0.9
        g.beginPath()
        g.moveTo(C, C)
        g.lineTo(a[0], a[1])
        g.stroke()
      }
      // a shine across the top facets
      g.save()
      g.clip(hex)
      const sh = g.createLinearGradient(C - 30, C - 40, C + 6, C - 6)
      sh.addColorStop(0, 'rgba(220,255,236,.55)')
      sh.addColorStop(1, 'rgba(220,255,236,0)')
      g.fillStyle = sh
      g.fill(hex)
      g.restore()
      g.strokeStyle = '#fff'
      g.lineWidth = 4.2
      g.lineJoin = 'round'
      g.stroke(hex)
      g.strokeStyle = INK
      g.lineWidth = 1.4
      g.stroke(hex)
      g.fillStyle = '#fff'
      g.fill(bPath, 'evenodd')
      g.strokeStyle = INK
      g.lineWidth = 1.5
      g.stroke(bPath)
    } else {
      // royal-blue enamel, deeper towards the bezel, a little lighter where the lamp catches it
      const bg = g.createRadialGradient(C - 18, C - 22, 4, C, C, ROUNDEL_R)
      bg.addColorStop(0, ENAMEL.blueLight)
      bg.addColorStop(0.55, ENAMEL.blue)
      bg.addColorStop(1, ENAMEL.blueDeep)
      g.fillStyle = bg
      g.fill(roundel)
      g.strokeStyle = INK
      g.lineWidth = 1.2
      g.beginPath()
      g.arc(C, C, ROUNDEL_R + 0.2, 0, Math.PI * 2)
      g.stroke()
      g.fillStyle = '#fff'
      g.fill(crown)
      g.fill(cross)
      roundRect(g, CROWN_BAND.x, CROWN_BAND.y, CROWN_BAND.w, CROWN_BAND.h, CROWN_BAND.r)
      g.fill()
      g.strokeStyle = INK
      g.lineWidth = 1.6
      g.lineJoin = 'round'
      g.stroke(crown)
      g.stroke(cross)
      roundRect(g, CROWN_BAND.x, CROWN_BAND.y, CROWN_BAND.w, CROWN_BAND.h, CROWN_BAND.r)
      g.stroke()
      for (const [x, y, r] of CROWN_BALLS) {
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(x, y, r, 0, Math.PI * 2)
        g.fill()
        g.stroke()
      }
      for (const [x, y, rx, ry, col] of CROWN_JEWELS) {
        g.fillStyle = col
        g.beginPath()
        g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2)
        g.fill()
        g.stroke()
        g.fillStyle = 'rgba(255,255,255,.75)'
        g.beginPath()
        g.ellipse(x - rx * 0.32, y - ry * 0.35, rx * 0.3, ry * 0.22, -0.5, 0, Math.PI * 2)
        g.fill()
      }
      for (const [x, y] of CROWN_STUDS) {
        g.fillStyle = '#fff'
        g.beginPath()
        g.arc(x, y, 2.2, 0, Math.PI * 2)
        g.fill()
      }
    }
  }

  /* the metal mask: everything is gold but the enamel, the pearls, the jewels and the ink */
  {
    const g = M
    g.fillStyle = '#fff'
    g.fillRect(0, 0, BOX, BOX)
    g.fillStyle = '#000'
    g.strokeStyle = '#000'
    if (side === 'heads') {
      g.save()
      g.clip(hex)
      g.fillRect(0, 0, BOX, BOX)
      g.restore()
      g.fillStyle = '#fff'
      g.fill(bPath, 'evenodd')
      g.strokeStyle = '#fff'
      g.lineWidth = 4.2
      g.stroke(hex)
      g.strokeStyle = '#000'
      g.lineWidth = 1.4
      g.stroke(hex)
      g.lineWidth = 1.5
      g.stroke(bPath)
    } else {
      g.fill(roundel)
      g.fillStyle = '#fff'
      g.fill(crown)
      g.fill(cross)
      roundRect(g, CROWN_BAND.x, CROWN_BAND.y, CROWN_BAND.w, CROWN_BAND.h, CROWN_BAND.r)
      g.fill()
      for (const [x, y, r] of CROWN_BALLS) {
        g.beginPath()
        g.arc(x, y, r, 0, Math.PI * 2)
        g.fill()
      }
      g.fillStyle = '#000'
      g.lineWidth = 1.6
      g.lineJoin = 'round'
      g.stroke(crown)
      g.stroke(cross)
      roundRect(g, CROWN_BAND.x, CROWN_BAND.y, CROWN_BAND.w, CROWN_BAND.h, CROWN_BAND.r)
      g.stroke()
      for (const [x, y, r] of CROWN_BALLS) {
        g.beginPath()
        g.arc(x, y, r, 0, Math.PI * 2)
        g.stroke()
      }
      g.lineWidth = 1.2
      g.beginPath()
      g.arc(C, C, ROUNDEL_R + 0.2, 0, Math.PI * 2)
      g.stroke()
      for (const [x, y, rx, ry] of CROWN_JEWELS) {
        g.beginPath()
        g.ellipse(x, y, rx + 0.8, ry + 0.8, 0, 0, Math.PI * 2)
        g.fill()
      }
    }
  }

  /* read back: blur the height into bevels, take its slopes as normals and its hollows as cavities */
  const n = size * size
  const hd = H.getImageData(0, 0, size, size).data
  const h0 = new Float32Array(n)
  for (let i = 0; i < n; i++) h0[i] = hd[i * 4] / 255
  const soft = blur(h0, size, Math.max(1, Math.round(size / 420)))
  const wide = blur(soft, size, Math.max(2, Math.round(size / 70)))
  const pd = P.getImageData(0, 0, size, size).data
  const md = M.getImageData(0, 0, size, size).data
  const col = new Uint8Array(n * 4)
  const nrm = new Uint8Array(n * 4)
  // slope scale: a bevel that rises 0.4 over 2 face units stands at about 45 degrees
  const S = 26 * (size / 1024)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const xl = soft[y * size + Math.max(0, x - 1)]
      const xr = soft[y * size + Math.min(size - 1, x + 1)]
      const yu = soft[Math.max(0, y - 1) * size + x]
      const yd = soft[Math.min(size - 1, y + 1) * size + x]
      // canvas y runs down the face, the texture's v up it
      let nx = -(xr - xl) * S
      let ny = (yd - yu) * S
      let nz = 1
      const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz)
      nx *= l
      ny *= l
      nz *= l
      const cav = Math.min(1, Math.max(0.5, 1 - (wide[i] - soft[i]) * 3.2))
      // rows go bottom-up in a DataTexture (no flipY), so the face reads upright
      const o = ((size - 1 - y) * size + x) * 4
      nrm[o] = Math.round((nx * 0.5 + 0.5) * 255)
      nrm[o + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      nrm[o + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      nrm[o + 3] = Math.round(cav * 255)
      col[o] = pd[i * 4]
      col[o + 1] = pd[i * 4 + 1]
      col[o + 2] = pd[i * 4 + 2]
      col[o + 3] = md[i * 4]
    }
  const tex = (data: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat)
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.generateMipmaps = true
    t.minFilter = THREE.LinearMipmapLinearFilter
    t.magFilter = THREE.LinearFilter
    t.anisotropy = 8
    t.needsUpdate = true
    return t
  }
  return { color: tex(col, true), normal: tex(nrm, false) }
}

/** a separable box blur, run twice (close to a gaussian) */
function blur(src: Float32Array, size: number, r: number) {
  let a = src.slice()
  const b = new Float32Array(a.length)
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const w = 1 / (2 * r + 1)
    for (let line = 0; line < size; line++) {
      let acc = 0
      const at = (k: number) => {
        const kk = Math.min(size - 1, Math.max(0, k))
        return horizontal ? from[line * size + kk] : from[kk * size + line]
      }
      for (let k = -r; k <= r; k++) acc += at(k)
      for (let k = 0; k < size; k++) {
        if (horizontal) to[line * size + k] = acc * w
        else to[k * size + line] = acc * w
        acc += at(k + r + 1) - at(k - r)
      }
    }
  }
  for (let it = 0; it < 2; it++) {
    pass(a, b, true)
    pass(b, a, false)
  }
  return a
}

/** both faces' maps at this size, painted once and kept */
export function faceTextures(side: Side, size: number) {
  const key = `${side}:${size}`
  let m = faceMaps.get(key)
  if (!m) faceMaps.set(key, (m = paintFace(side, size)))
  return m
}

/* ---------------- the material ---------------- */

const COIN_VERT = /* glsl */ `
uniform float uFace;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vT;
varying vec3 vB;
// (three.js defines USE_INSTANCING_COLOR in the vertex shader only, so the tint always travels in a varying)
varying vec3 vTint;
void main() {
  vUv = uv;
  vTint = vec3(1.0);
  vec4 p = vec4(position, 1.0);
  vec3 nn = normal;
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  nn = mat3(instanceMatrix) * nn;
  #endif
  #ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
  #endif
  vec4 mv = modelViewMatrix * p;
  vV = -mv.xyz;
  vN = normalize(normalMatrix * nn);
  #ifdef USE_FACE
  vT = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));
  vB = normalize(normalMatrix * vec3(0.0, 0.0, -uFace));
  #endif
  gl_Position = projectionMatrix * mv;
}`

const COIN_FRAG = /* glsl */ `
uniform sampler2D uMatcap;
uniform sampler2D uColor;
uniform sampler2D uNormal;
uniform vec3 uLight;
uniform float uHeat;
uniform float uTime;
uniform float uShine;
uniform float uOpacity;
uniform float uDull;
uniform vec3 uGlow;
varying vec3 vN;
varying vec3 vV;
varying vec2 vUv;
varying vec3 vT;
varying vec3 vB;
varying vec3 vTint;
vec2 matcapUv(vec3 n, vec3 v) {
  vec3 x = normalize(vec3(v.z, 0.0, -v.x));
  vec3 y = cross(v, x);
  return vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
}
void main() {
  vec3 V = normalize(vV);
  vec3 N = normalize(vN);
  vec3 albedo = vec3(1.0);
  float metal = 1.0;
  float cav = 1.0;
  #ifdef USE_FACE
  vec4 c = texture2D(uColor, vUv);
  albedo = c.rgb;
  metal = c.a;
  vec4 nm = texture2D(uNormal, vUv);
  vec3 tn = nm.xyz * 2.0 - 1.0;
  cav = nm.a;
  N = normalize(tn.x * normalize(vT) + tn.y * normalize(vB) + tn.z * N);
  #endif
  albedo *= vTint;
  vec3 mc = texture2D(uMatcap, matcapUv(N, V)).rgb;
  vec3 H = normalize(uLight + V);
  float nh = dot(N, H);
  float nl = dot(N, uLight);
  float nv = max(0.0, dot(N, V));
  // the gold: the studio reflected, and a warm glow towards grazing angles (polished metal turned away from the lamp
  // still mirrors the lit room: amber, never brown), heated towards copper and red as a streak burns
  vec3 gold = mc * albedo;
  float rim = pow(max(0.0, 1.0 - nv), 3.0);
  gold += rim * vec3(0.55, 0.36, 0.1) * albedo;
  gold = mix(gold, gold * vec3(1.1, 0.86, 0.66) + vec3(0.03, 0.0, 0.0), uHeat * 0.5);
  // a lost call: the gold loses its glow for a moment
  gold = mix(gold, vec3(dot(gold, vec3(0.3, 0.55, 0.15))) * vec3(0.7, 0.64, 0.6), uDull * 0.45);
  // the enamel: two tones under the spotlight, a glassy glint, a little of the room in it
  float tone = 0.5 + 0.28 * smoothstep(-0.05, 0.05, nl) + 0.24 * smoothstep(0.5, 0.58, nl);
  vec3 enamel = albedo * tone + smoothstep(0.978, 0.988, nh) * 0.6 + mc * albedo * 0.1;
  vec3 col = mix(enamel, gold, metal) * cav;
  // a hard star where the metal catches the spotlight
  // (tight enough that a flat face mirroring the lamp flashes in a spot, not all over)
  col += metal * smoothstep(0.9991, 0.99975, nh) * vec3(0.7, 0.62, 0.42);
  // a band of shine sweeping over a winner
  // (a narrow band, kept under the bloom's threshold: it gleams, it never washes the face out)
  if (uShine > 0.0) {
    float b = fract((vUv.x + vUv.y) * 0.6 - uTime * 0.7);
    col += uShine * (smoothstep(0.0, 0.03, b) - smoothstep(0.03, 0.07, b)) * vec3(0.3, 0.26, 0.15) * metal;
  }
  // heat: a hot rim, embers in the hollows
  float fres = pow(max(0.0, 1.0 - nv), 2.0);
  col += uHeat * (vec3(0.9, 0.3, 0.05) * fres + vec3(0.3, 0.07, 0.0) * (1.0 - cav) * 1.4 + vec3(0.02, 0.004, 0.0));
  col += uGlow;
  gl_FragColor = vec4(col, uOpacity);
}`

export interface CoinUniforms {
  uMatcap: { value: THREE.Texture }
  uLight: { value: THREE.Vector3 }
  uHeat: { value: number }
  uTime: { value: number }
  uShine: { value: number }
  uDull: { value: number }
  uGlow: { value: THREE.Color }
}

let shared: CoinUniforms | null = null
/** the uniforms every coin material shares: the light, the heat, the clock */
export function coinUniforms(): CoinUniforms {
  return (shared ??= {
    uMatcap: { value: matcapTexture() },
    uLight: { value: new THREE.Vector3(0, 1, 0) },
    uHeat: { value: 0 },
    uTime: { value: 0 },
    uShine: { value: 0 },
    uDull: { value: 0 },
    uGlow: { value: new THREE.Color(0, 0, 0) },
  })
}

const materials: THREE.ShaderMaterial[] = []
/** a coin material: a face (with its maps) or the body; `opacity` < 1 for the motion-blur ghosts */
export function coinMaterial(part: { side: Side; size: number } | 'body', opacity = 1) {
  const u = coinUniforms()
  const face = part !== 'body' ? faceTextures(part.side, part.size) : null
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...u,
      uColor: { value: face?.color ?? null },
      uNormal: { value: face?.normal ?? null },
      uFace: { value: part !== 'body' && part.side === 'tails' ? -1 : 1 },
      uOpacity: { value: opacity },
    },
    defines: face ? { USE_FACE: '' } : {},
    vertexShader: COIN_VERT,
    fragmentShader: COIN_FRAG,
    transparent: opacity < 1,
    depthWrite: opacity >= 1,
  })
  materials.push(m)
  return m
}

/* ---------------- the geometry ---------------- */

/** the top half of the coin's profile from the rim's inner wall over the shoulder to the edge: [r, y, reeded] */
const PROFILE: [number, number, number][] = [
  [0.836, FACE_Y - 0.004, 0],
  [0.851, FACE_Y, 0],
  [0.866, FACE_Y + 0.011, 0],
  [0.878, RIM_TOP - 0.004, 0],
  [0.894, RIM_TOP, 0],
  [0.948, RIM_TOP, 0],
  [0.97, RIM_TOP - 0.004, 0],
  [0.986, RIM_TOP - 0.013, 0],
  [0.996, RIM_TOP - 0.026, 0.4],
  [RADIUS, EDGE, 1],
]

let bodyGeo: THREE.BufferGeometry | null = null
let hullGeo: THREE.BufferGeometry | null = null
let faceGeo: [THREE.BufferGeometry, THREE.BufferGeometry] | null = null
let smallGeo: THREE.BufferGeometry | null = null

/** the rim, shoulders and reeded edge, as one smooth turned surface (90 grooves round the edge) */
export function coinBodyGeometry(reeds = 90) {
  if (bodyGeo) return bodyGeo
  const rows: [number, number, number][] = [...PROFILE, [RADIUS, 0, 1], ...[...PROFILE].reverse().map(([r, y, e]): [number, number, number] => [r, -y, e])]
  const seg = reeds * 4
  const pos: number[] = []
  const idx: number[] = []
  const depth = 0.011
  for (let j = 0; j < rows.length; j++) {
    const [r, y, e] = rows[j]
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2
      // a rounded groove: flat land between grooves, a soft hollow in each
      const ph = (i % 4) / 4
      const groove = Math.max(0, Math.sin(ph * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5) ** 1.6
      const rr = r - depth * e * groove
      pos.push(Math.cos(a) * rr, y, -Math.sin(a) * rr)
    }
  }
  for (let j = 0; j < rows.length - 1; j++)
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i
      const b = a + seg + 1
      idx.push(a, b, a + 1, a + 1, b, b + 1)
    }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  // the seam where the turn closes: average the normals so it doesn't show
  const n = g.getAttribute('normal') as THREE.BufferAttribute
  for (let j = 0; j < rows.length; j++) {
    const a = j * (seg + 1)
    const b = a + seg
    const x = (n.getX(a) + n.getX(b)) / 2
    const y = (n.getY(a) + n.getY(b)) / 2
    const z = (n.getZ(a) + n.getZ(b)) / 2
    const l = Math.hypot(x, y, z) || 1
    n.setXYZ(a, x / l, y / l, z / l)
    n.setXYZ(b, x / l, y / l, z / l)
  }
  return (bodyGeo = g)
}

/** the face discs inside the rim: heads up (top of the design away from the camera at rest), tails down */
export function coinFaceGeometry(): [THREE.BufferGeometry, THREE.BufferGeometry] {
  if (faceGeo) return faceGeo
  const top = new THREE.CircleGeometry(FACE_R, 128)
  top.rotateX(-Math.PI / 2)
  top.translate(0, FACE_Y, 0)
  const bot = new THREE.CircleGeometry(FACE_R, 128)
  bot.rotateX(Math.PI / 2)
  bot.translate(0, -FACE_Y, 0)
  return (faceGeo = [top, bot])
}

/** the ink outline: the coin's silhouette pushed out, seen from inside */
export function coinHullGeometry() {
  if (hullGeo) return hullGeo
  const t = OUTLINE
  const pts: THREE.Vector2[] = []
  pts.push(new THREE.Vector2(0, -(RIM_TOP + t)))
  const corner = (sgn: number) => {
    const out: THREE.Vector2[] = []
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2)
      // round shoulder: from the flat top to the edge
      out.push(new THREE.Vector2(0.955 + (RADIUS - 0.955 + t) * Math.sin(a), sgn * (EDGE + (RIM_TOP + t - EDGE) * Math.cos(a))))
    }
    return out
  }
  pts.push(...corner(-1))
  pts.push(...corner(1).reverse())
  pts.push(new THREE.Vector2(0, RIM_TOP + t))
  const g = new THREE.LatheGeometry(pts, 96)
  return (hullGeo = g)
}

/** a little coin for the cash-out burst and the jackpot's rain: a disc with a raised rim on both faces */
export const SMALL_R = 0.28
export const SMALL_HALF = 0.03
export function smallCoinGeometry() {
  if (smallGeo) return smallGeo
  const R = SMALL_R
  const H = SMALL_HALF
  // a turned profile: the sunk field, the rim's lip, the edge, and the same below
  const pts = [
    [0, H * 0.55],
    [R * 0.78, H * 0.55],
    [R * 0.88, H],
    [R, H * 0.45],
    [R, -H * 0.45],
    [R * 0.88, -H],
    [R * 0.78, -H * 0.55],
    [0, -H * 0.55],
  ].map(([x, y]) => new THREE.Vector2(x, y))
  const g = new THREE.LatheGeometry(pts.reverse(), 16)
  g.computeVertexNormals()
  return (smallGeo = g)
}

/* ---------------- casino chips, stacked round the edge of the light ---------------- */

const CHIP_R = 0.62
const CHIP_H = 0.13
const chipGeos = new Map<string, THREE.BufferGeometry>()
let chipMat: THREE.MeshToonMaterial | null = null

/** one chip as a single toon mesh: the body, six edge spots, a ring and an inlay on top, its ink outline */
function chipGeometry(color: string, spot: string) {
  const key = color + spot
  let g = chipGeos.get(key)
  if (g) return g
  const k = new VKit(INK, 0.014)
  k.add(new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 40), color)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    k.add(new THREE.BoxGeometry(0.2, CHIP_H * 1.02, 0.05), spot, T([Math.cos(a) * (CHIP_R - 0.02), 0, Math.sin(a) * (CHIP_R - 0.02)], [0, -a + Math.PI / 2, 0]), 0)
  }
  // the ring of spots and the inlay on top
  k.add(new THREE.RingGeometry(CHIP_R * 0.62, CHIP_R * 0.7, 40), spot, T([0, CHIP_H / 2 + 0.002, 0], [-Math.PI / 2, 0, 0]), 0)
  k.add(new THREE.CircleGeometry(CHIP_R * 0.55, 40), color, T([0, CHIP_H / 2 + 0.003, 0], [-Math.PI / 2, 0, 0]), 0)
  g = k.geometry()
  chipGeos.set(key, g)
  return g
}

const CHIP_COLORS: [string, string][] = [
  ['#1fb866', '#e6fff1'],
  ['#e8344e', '#ffe5e9'],
  ['#26313f', '#f7c548'],
  ['#7d4dff', '#efe6ff'],
]

const stackGeos: THREE.BufferGeometry[] = []
/** a stack of n chips (colour index c), each a hair off true, merged into one mesh (one draw call a stack) */
export function chipStack(n: number, c: number, seed: number) {
  chipMat ??= vkMaterial(toonRamp([70, 150, 215, 255])) as THREE.MeshToonMaterial
  let r = seed
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647)
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < n; i++) {
    const [col, spot] = CHIP_COLORS[(c + (i > n - 3 && n > 4 ? 1 : 0)) % CHIP_COLORS.length]
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3((rnd() - 0.5) * 0.06, CHIP_H / 2 + i * (CHIP_H + 0.004), (rnd() - 0.5) * 0.06),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
      new THREE.Vector3(1, 1, 1),
    )
    parts.push(chipGeometry(col, spot).clone().applyMatrix4(m))
  }
  const g = mergeGeometries(parts)
  for (const x of parts) x.dispose()
  stackGeos.push(g)
  return new THREE.Mesh(g, chipMat)
}

let railGeo: THREE.BufferGeometry | null = null
/**
 * The round table's edge, far out in the dark: a padded leather rail and a brass trim just inside it, one mesh in the
 * chips' toon material. It shows behind the coin when the camera drops low, from whichever side it stands.
 */
export function tableRail(r: number) {
  chipMat ??= vkMaterial(toonRamp([70, 150, 215, 255])) as THREE.MeshToonMaterial
  if (!railGeo) {
    const k = new VKit(INK, 0)
    const pad = new THREE.TorusGeometry(r, 0.46, 12, 180)
    pad.rotateX(Math.PI / 2)
    pad.scale(1, 0.72, 1)
    pad.translate(0, 0.3, 0)
    k.add(pad, '#4a1430', undefined, 0)
    const trim = new THREE.TorusGeometry(r - 0.5, 0.05, 6, 180)
    trim.rotateX(Math.PI / 2)
    trim.translate(0, 0.03, 0)
    k.add(trim, '#d9a038', undefined, 0)
    railGeo = k.geometry()
  }
  return new THREE.Mesh(railGeo, chipMat)
}

let inkMat: THREE.MeshBasicMaterial | null = null
export function inkMaterial() {
  return (inkMat ??= new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }))
}

/** the size of the face maps to paint for this device */
export const faceSize = () => (matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700 ? 512 : 1024)

/**
 * Lets go of a renderer that is closing: every cached material, texture and geometry holds a 'dispose' listener from
 * each renderer that drew it, and through it the whole renderer. Disposing them drops those listeners and the GPU
 * copies; the objects stay cached for the next visit.
 */
export function releaseModels() {
  for (const m of materials.splice(0)) m.dispose()
  inkMat?.dispose()
  chipMat?.dispose()
  for (const g of chipGeos.values()) g.dispose()
  // the merged stacks are made fresh each visit
  for (const g of stackGeos.splice(0)) g.dispose()
  toonRamp([70, 150, 215, 255]).dispose()
  matcap?.dispose()
  for (const f of faceMaps.values()) {
    f.color.dispose()
    f.normal.dispose()
  }
  bodyGeo?.dispose()
  hullGeo?.dispose()
  faceGeo?.[0].dispose()
  faceGeo?.[1].dispose()
  smallGeo?.dispose()
  railGeo?.dispose()
}
