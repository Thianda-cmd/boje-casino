/*
  A die as a body, shared by the dice games (Sic Bo's dome, the Craps table): its size and rounding, the turns of
  space it is described by (quaternions), which face is which, and the 24 turns that map a cube onto itself. Pure
  TypeScript (no three.js), so Node can test the physics built on it.

  Units: a die's edge is 1. The faces follow a real die: opposite faces add up to 7, and 1, 2, 3 run anticlockwise
  round the corner they share.
*/

export type Face = 1 | 2 | 3 | 4 | 5 | 6
export type Q = [number, number, number, number]
export type V3 = [number, number, number]

/** half a die's edge */
export const HALF = 0.5
/** the radius its edges and corners are rounded to */
export const ROUND = 0.085
/** half the edge of the sharp inner cube the rounded die is grown from */
export const CORE = HALF - ROUND
/** the farthest any point of a die is from its centre */
export const REACH = Math.sqrt(3) * CORE + ROUND

/** a die lying at rest on the floor (its centre is HALF above it): where, and turned how */
export interface Pose {
  x: number
  z: number
  q: Q
}

/* ---------------- quaternions ---------------- */

export const qmul = (a: Q, b: Q): Q => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]
export const qconj = (q: Q): Q => [-q[0], -q[1], -q[2], q[3]]
/** a turn of `a` radians about the unit axis (x, y, z) */
export const axisAngle = (x: number, y: number, z: number, a: number): Q => {
  const l = Math.hypot(x, y, z) || 1
  const s = Math.sin(a / 2) / l
  return [x * s, y * s, z * s, Math.cos(a / 2)]
}
/** a vector turned by a quaternion */
export const rotate = (q: Q, v: V3): V3 => {
  const [x, y, z, w] = q
  // t = 2 q.xyz × v; v' = v + w t + q.xyz × t
  const tx = 2 * (y * v[2] - z * v[1])
  const ty = 2 * (z * v[0] - x * v[2])
  const tz = 2 * (x * v[1] - y * v[0])
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)]
}
export const normQ = (q: Q): Q => {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l]
}
/** the normalised blend of two orientations, the short way round */
export function nlerp(a: Q, b: Q, t: number): Q {
  const s = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3] < 0 ? -1 : 1
  return normQ([a[0] + (b[0] * s - a[0]) * t, a[1] + (b[1] * s - a[1]) * t, a[2] + (b[2] * s - a[2]) * t, a[3] + (b[3] * s - a[3]) * t])
}
/** the shortest turn taking unit vector a to unit vector b */
export function fromTo(a: V3, b: V3): Q {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const cx = a[1] * b[2] - a[2] * b[1]
  const cy = a[2] * b[0] - a[0] * b[2]
  const cz = a[0] * b[1] - a[1] * b[0]
  return normQ([cx, cy, cz, 1 + d])
}
/** smoothstep on 0-1 */
export const smooth = (t: number) => {
  const u = Math.min(1, Math.max(0, t))
  return u * u * (3 - 2 * u)
}

/* ---------------- the faces ---------------- */

/** the body axis each face's pips are on */
export const FACE_AXIS: Readonly<Record<Face, V3>> = { 1: [0, 1, 0], 6: [0, -1, 0], 2: [0, 0, 1], 5: [0, 0, -1], 3: [1, 0, 0], 4: [-1, 0, 0] }
export const FACES: readonly Face[] = [1, 2, 3, 4, 5, 6]

/** the face of a body axis (a unit vector along one of them) */
export const faceOfAxis = (v: V3): Face => FACES.find((f) => FACE_AXIS[f][0] * v[0] + FACE_AXIS[f][1] * v[1] + FACE_AXIS[f][2] * v[2] > 0.5)!

/** the body axis nearest a body-frame direction */
export const nearestAxis = (v: V3): V3 => {
  const ax = Math.abs(v[0])
  const ay = Math.abs(v[1])
  const az = Math.abs(v[2])
  if (ax >= ay && ax >= az) return [Math.sign(v[0]), 0, 0]
  if (ay >= az) return [0, Math.sign(v[1]), 0]
  return [0, 0, Math.sign(v[2])]
}

/** the face showing on top of a die turned `q` (the body axis nearest straight up) */
export function topFace(q: Q): Face {
  return faceOfAxis(nearestAxis(rotate(qconj(q), [0, 1, 0])))
}

/** how far a die turned `q` is from lying flat, radians */
export function tiltOf(q: Q): number {
  const up = rotate(qconj(q), [0, 1, 0])
  return Math.acos(Math.min(1, Math.max(Math.abs(up[0]), Math.abs(up[1]), Math.abs(up[2]))))
}

/** a die lying flat with `face` on top, turned `yaw` radians about the vertical */
export function restQuat(face: Face, yaw: number): Q {
  const [x, y, z] = FACE_AXIS[face]
  // the turn that stands the face's axis straight up
  const base: Q = y > 0 ? [0, 0, 0, 1] : y < 0 ? axisAngle(1, 0, 0, Math.PI) : z !== 0 ? axisAngle(z, 0, 0, -Math.PI / 2) : axisAngle(0, 0, x, Math.PI / 2)
  return normQ(qmul(axisAngle(0, 1, 0, yaw), base))
}

/**
 * The 24 turns that map a cube onto itself, each with its axis and angle (0 to π). A die turned by one of them fills
 * exactly the same space; only its pips are elsewhere, which is how the dice games make the dice land on the faces
 * that were drawn without touching the path physics gives them.
 */
export const CUBE_TURNS: readonly { q: Q; axis: V3; angle: number }[] = (() => {
  const out: { q: Q; axis: V3; angle: number }[] = [{ q: [0, 0, 0, 1], axis: [0, 1, 0], angle: 0 }]
  const add = (x: number, y: number, z: number, a: number) => {
    const l = Math.hypot(x, y, z)
    out.push({ q: axisAngle(x, y, z, a), axis: [x / l, y / l, z / l], angle: a })
  }
  // quarter and half turns about the face axes (three quarters = a quarter the other way)
  for (const ax of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]) {
    add(ax[0], ax[1], ax[2], Math.PI / 2)
    add(-ax[0], -ax[1], -ax[2], Math.PI / 2)
    add(ax[0], ax[1], ax[2], Math.PI)
  }
  // thirds of a turn about the four long diagonals, each way
  for (const [x, y, z] of [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1]] as V3[]) {
    add(x, y, z, (Math.PI * 2) / 3)
    add(-x, -y, -z, (Math.PI * 2) / 3)
  }
  // half turns about the six edge diagonals
  for (const [x, y, z] of [[1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]] as V3[]) add(x, y, z, Math.PI)
  return out
})()

/** a seeded random source, so a roll can be worked out again exactly */
export function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
