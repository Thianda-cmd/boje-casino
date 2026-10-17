import * as THREE from 'three'
import { T, VKit, ellipsePts, type P2, type P3 } from '../../lib/three/toon'
import { INK, V, arc, clipY, flatShape, joint, slab, slicedX, smooth, type Surf } from './kit'
import { castMaterial } from './mats'
import { SYMBOL_COLOR } from './meta'

/*
  Pieces shared by the Plunder Bay cast (models.ts), Captain Polly the host (host.ts) and the ship (ship.ts): the
  pirate palette, the captain's bicorne, macaw wings, the skull and crossbones, waving cloth, and helpers that build
  a model in a local frame and move it into place.
*/

/** outline thickness of the cast (drawn about a cell, 40 to 110 px, across) */
export const W_INK = 0.018

/** adds a flat decal (any simple polygon) lying on a flat face at local z, placed by matrix m */
export function flatDecal(k: VKit, m: THREE.Matrix4, pts: P2[], color: THREE.ColorRepresentation, z: number, flatLit = true) {
  k.add(flatShape(pts, z), color, m, 0, flatLit)
}
/** a basis that stands local +y on the direction d with local +z turned towards the camera, at p */
export function frameAt(p: P3, d: THREE.Vector3, mirror = false, roll = 0) {
  const y = d.clone().normalize()
  const z = V(Math.sin(roll), 0, Math.cos(roll)).addScaledVector(y, -y.z).normalize()
  const x = V().crossVectors(y, z).normalize()
  const m = new THREE.Matrix4().makeBasis(x, y, z).setPosition(V(...p))
  if (mirror) m.multiply(T([0, 0, 0], [0, 0, 0], [-1, 1, 1]))
  return m
}


export const RED = SYMBOL_COLOR.captain
export const MACAW_Y = '#ffcf33'
export const MACAW_B = '#2f7bff'
export const BEAK = '#ffd84a'
export const BEAK_LO = '#e9952a'
export const HAT = '#2a2440'
export const GOLD_TRIM = '#ffc63d'
export const BONE = '#fff6e2'
export const TONGUE_C = '#ff6f8a'

/** the bicorne's outline: a wide half-moon with upturned tips, W across each way, H tall */
export function hatOutline(W: number, H: number, B: number, n = 12): P2[] {
  const top: P2[] = []
  const bot: P2[] = []
  for (let i = 0; i <= n; i++) {
    const x = -W + (2 * W * i) / n
    const u = x / W
    const lift = 0.16 * H * u ** 4
    top.push([x, H * Math.pow(Math.max(0, 1 - u * u), 0.62) + lift])
    bot.push([x, B * (1 - u * u) + lift])
  }
  return [...bot, ...top.reverse().slice(1, -1)]
}

/** a skull and crossbones drawn flat at local z, placed by m: centred on (cx, cy), `s` the skull radius */
export function jolly(k: VKit, m: THREE.Matrix4, cx: number, cy: number, s: number, z: number, bone = BONE, bones = true) {
  if (bones)
    for (const d of [-1, 1]) {
      const a: P2 = [cx - s * 1.45, cy - s * 0.9 * d - s * 0.25]
      const b: P2 = [cx + s * 1.45, cy + s * 0.9 * d - s * 0.25]
      const l = Math.hypot(b[0] - a[0], b[1] - a[1])
      const nx = -(b[1] - a[1]) / l
      const ny = (b[0] - a[0]) / l
      const w = s * 0.2
      flatDecal(k, m, [[a[0] + nx * w, a[1] + ny * w], [a[0] - nx * w, a[1] - ny * w], [b[0] - nx * w, b[1] - ny * w], [b[0] + nx * w, b[1] + ny * w]], bone, z)
      for (const e of [a, b]) for (const sd of [-1, 1]) flatDecal(k, m, ellipsePts(e[0] + nx * w * 1.1 * sd, e[1] + ny * w * 1.1 * sd, s * 0.26, s * 0.26, 8), bone, z)
    }
  flatDecal(k, m, ellipsePts(cx, cy + s * 0.12, s, s * 0.92, 16), bone, z + 0.001)
  flatDecal(k, m, [[cx - s * 0.55, cy - s * 0.45], [cx - s * 0.45, cy - s * 0.95], [cx + s * 0.45, cy - s * 0.95], [cx + s * 0.55, cy - s * 0.45]], bone, z + 0.001)
  for (const d of [-1, 1]) flatDecal(k, m, ellipsePts(cx + d * s * 0.4, cy + s * 0.12, s * 0.26, s * 0.3, 10), INK, z + 0.002)
  flatDecal(k, m, [[cx, cy - s * 0.18], [cx - s * 0.12, cy - s * 0.38], [cx + s * 0.12, cy - s * 0.38]], INK, z + 0.002)
}

/** the captain's bicorne at m: black felt, a gold band along the crown, a skull and crossbones on the front */
export function bicorne(k: VKit, m: THREE.Matrix4, W = 0.25, H = 0.15) {
  const D = 0.07
  const bev = 0.012
  k.add(slab(hatOutline(W, H, 0.035), D, bev), HAT, m)
  const zf = D / 2 + bev + 0.002
  const n = 14
  const top = (x: number) => H * Math.pow(Math.max(0, 1 - (x / W) ** 2), 0.62) + 0.16 * H * (x / W) ** 4
  const band: P2[] = []
  for (let i = 0; i <= n; i++) {
    const x = -W * 0.84 + (1.68 * W * i) / n
    band.push([x, top(x) - 0.024])
  }
  for (let i = n; i >= 0; i--) {
    const x = -W * 0.84 + (1.68 * W * i) / n
    band.push([x, top(x) - 0.006])
  }
  flatDecal(k, m, band, GOLD_TRIM, zf)
  jolly(k, m, 0, H * 0.46, H * 0.2, zf + 0.001)
}

/**
 * A wing's outline in its own frame: the shoulder at the origin, reaching L up +y, a round leading edge on the right
 * and `fingers` flight feathers fanning out at the top, longest at the leading edge, notched between them.
 */
export function wingOutline(L: number, hw: number, fingers = 4): P2[] {
  const out: P2[] = []
  for (let i = 0; i <= 3; i++) {
    const a = -Math.PI / 2 + (i / 3) * (Math.PI / 2)
    out.push([Math.cos(a) * hw * 0.42, Math.sin(a) * hw * 0.32])
  }
  const P: P2 = [0, L * 0.3]
  const spread = 0.78
  const fw = hw * 0.32
  const dirs = Array.from({ length: fingers }, (_, i) => Math.PI / 2 - spread / 2 + 0.12 + (spread * i) / Math.max(1, fingers - 1))
  const lens = dirs.map((_, i) => L * 0.7 * (1 - 0.085 * i))
  out.push([hw * 0.98, L * 0.36])
  dirs.forEach((th, i) => {
    const c: P2 = [P[0] + Math.cos(th) * (lens[i] - fw), P[1] + Math.sin(th) * (lens[i] - fw)]
    for (let j = 0; j <= 4; j++) {
      const a = th - Math.PI / 2 + (j / 4) * Math.PI
      out.push([c[0] + Math.cos(a) * fw, c[1] + Math.sin(a) * fw * 1.05])
    }
    if (i < fingers - 1) {
      const tm = (th + dirs[i + 1]) / 2
      const lm = (lens[i] + lens[i + 1]) / 2
      out.push([P[0] + Math.cos(tm) * lm * 0.72, P[1] + Math.sin(tm) * lm * 0.72])
    }
  })
  out.push([-hw * 0.8, L * 0.34])
  for (let i = 0; i <= 3; i++) {
    const a = Math.PI + (i / 3) * (Math.PI / 2)
    out.push([Math.cos(a) * hw * 0.42, Math.sin(a) * hw * 0.32])
  }
  return out
}

/**
 * A macaw wing at m (local frame as wingOutline): a flat blue slab with the yellow band and the red coverts painted on
 * its face, scalloped where they meet, and ink lines between the flight feathers.
 */
export function macawWing(k: VKit, m: THREE.Matrix4, L: number, hw: number, fingers = 4) {
  const D = 0.024
  const bev = 0.008
  const out = wingOutline(L, hw, fingers)
  k.add(slab(out, D, bev, 2), MACAW_B, m)
  const z = D / 2 + bev + 0.0015
  const yB = L * 0.3
  const yY = L * 0.5
  flatDecal(k, m, clipY(out, -1, yY), MACAW_Y, z)
  flatDecal(k, m, clipY(out, -1, yB), RED, z + 0.0008)
  const n = 3
  for (let i = 0; i < n; i++) {
    const xl = -hw * 0.8 + ((i + 0.5) * hw * 1.75) / n
    const r = (hw * 1.75) / n / 2
    flatDecal(k, m, arc(xl, yB + 0.001, r, r * 0.85, Math.PI, Math.PI * 2, 6), RED, z + 0.0008)
    flatDecal(k, m, arc(xl + 0.004, yY + 0.001, r, r * 0.8, Math.PI, Math.PI * 2, 6), MACAW_Y, z + 0.0004)
  }
  // ink between the flight feathers, from each notch in towards the wrist
  const P: P2 = [0, L * 0.3]
  const spread = 0.78
  for (let i = 0; i < fingers - 1; i++) {
    const tm = Math.PI / 2 - spread / 2 + 0.12 + (spread * (i + 0.5)) / Math.max(1, fingers - 1)
    const lm = L * 0.7 * (1 - 0.085 * (i + 0.5))
    const a: P2 = [P[0] + Math.cos(tm) * lm * 0.74, P[1] + Math.sin(tm) * lm * 0.74]
    const b: P2 = [P[0] + Math.cos(tm) * lm * 0.42, P[1] + Math.sin(tm) * lm * 0.42]
    k.add(flatShape(stripPts([a, b], 0.008), z + 0.002), INK, m, 0, true)
  }
}

/** a stroke as a polygon (for flat decals) */
export function stripPts(path: P2[], w: number): P2[] {
  const left: P2[] = []
  const right: P2[] = []
  path.forEach((p, i) => {
    const a = path[Math.max(0, i - 1)]
    const b = path[Math.min(path.length - 1, i + 1)]
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    const nx = (-(b[1] - a[1]) / l) * (w / 2)
    const ny = ((b[0] - a[0]) / l) * (w / 2)
    left.push([p[0] + nx, p[1] + ny])
    right.push([p[0] - nx, p[1] - ny])
  })
  return [...right, ...left.reverse()]
}


export const TOOTH_GOLD = '#ffd23f'

/** a VKit modelled in a local frame, moved into place by m, as a mesh */
export function meshAt(k: VKit, name: string, m: THREE.Matrix4, material: THREE.Material = castMaterial()) {
  const g = k.geometry()
  g.applyMatrix4(m)
  const mesh = new THREE.Mesh(g, material)
  mesh.name = name
  return mesh
}
/** like meshAt, wrapped in a named group that turns about p (in the model's frame) */
export function partAt(k: VKit, name: string, m: THREE.Matrix4, p: P3, material: THREE.Material = castMaterial()) {
  const mesh = meshAt(k, '', m, material)
  return joint(name, p, mesh)
}
/** a basis whose local +z is n and local +y as close to world up as it gets, at p */
export function facingUp(n: THREE.Vector3, p: P3) {
  const z = n.clone().normalize()
  const y = V(0, 1, 0).addScaledVector(z, -z.y).normalize()
  const x = V().crossVectors(y, z)
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(V(...p))
}
/** a basis whose local +y runs along d (for lathes), at p */
export function along(d: THREE.Vector3, p: P3) {
  const yv = d.clone().normalize()
  const zc = V(0, 0, 1).addScaledVector(yv, -yv.z).normalize()
  const x = V().crossVectors(yv, zc)
  return new THREE.Matrix4().makeBasis(x, yv, zc).setPosition(V(...p))
}

/** a lathe profile's front surface (the profile spins round local y) */
export function latheSurf(prof: P2[]): Surf {
  const r = (y: number) => {
    for (let i = 1; i < prof.length; i++) {
      const [r0, y0] = prof[i - 1]
      const [r1, y1] = prof[i]
      if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) return r0 + (r1 - r0) * ((y - y0) / (y1 - y0 || 1))
    }
    return 0
  }
  return (x, y) => Math.sqrt(Math.max(0, r(y) ** 2 - x * x))
}


export const ROPE_A = '#ecc58a'
export const ROPE_B = '#b8844a'

export const BRASS = SYMBOL_COLOR.compass
export const BRASS_D = '#c48a26'

/** gives a cloth geometry its wave attribute: still at the pole, swinging more towards the fly */
export function waveCloth(g: THREE.BufferGeometry, x0: number, len: number, amp: number, freq: number) {
  const p = g.getAttribute('position')
  const w = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const u = Math.max(0, (p.getX(i) - x0) / len)
    w.set([amp * Math.pow(u, 1.15), (p.getX(i) - x0) * freq + p.getY(i) * 2.2, freq], i * 3)
  }
  g.setAttribute('aWave', new THREE.BufferAttribute(w, 3))
  return g
}

/** the flag's cloth, ragged at the fly, as a smooth grid box (so it can bend) */
export function clothGeo(x0: number, x1: number, y0: number, y1: number, t: number, nx: number, ny: number) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, t, nx, ny, 1)
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, 0)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    if (x > x1 - 1e-4) {
      const v = (p.getY(i) - y0) / (y1 - y0)
      // two notches torn into the fly
      p.setX(i, x - 0.05 * Math.max(0, 1 - Math.abs(v - 0.3) / 0.12) - 0.04 * Math.max(0, 1 - Math.abs(v - 0.74) / 0.1))
    }
  }
  return smooth(g)
}

/** a decal on the cloth's face at z, split fine enough to wave with it */
export function clothDecal(k: VKit, pts: P2[], color: THREE.ColorRepresentation, z: number) {
  k.add(slicedX(pts, 0.035, z), color, undefined, 0, true)
}

