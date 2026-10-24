import { BACK_Z, FIELD_W, FRONT_Z, GUTTER_Z0, TRAY, UPPER_FRONT_Z, UPPER_Y } from './geom'
import type { Field, ItemKind, Run, Track } from './types'
import { LOWER_TOP, shapeOf, type Shape } from './world'

/*
  Checks on poses, shared by the field lab (dev/FieldLab.tsx) and the tests (tools/pusher-sim-test.ts): whether two
  bodies as shown intersect, and whether a body is inside the machine and clear of the pushers. A pose is what the
  scene draws (a body's centre, yaw and tilt), so these look at the bodies as they would be seen, tilts and all, not at
  the simulation's own bookkeeping.
*/

export interface Pose {
  id: number
  kind: ItemKind
  x: number
  y: number
  z: number
  yaw: number
  tiltX: number
  tiltZ: number
}

const shapes = new Map<ItemKind, Shape>()
const shape = (k: ItemKind) => {
  let s = shapes.get(k)
  if (!s) shapes.set(k, (s = shapeOf(k)))
  return s
}

/** the height of the bottom of a (flat, possibly tilted) body under the point (px, pz) */
function bottomAt(p: Pose, s: Shape, px: number, pz: number) {
  const cx = Math.cos(p.tiltX)
  const n0 = -Math.sin(p.tiltZ) * cx
  const n1 = Math.cos(p.tiltZ) * cx
  const n2 = Math.sin(p.tiltX)
  // the body's mid-plane through its centre; a face-down body has the same plane
  const ny = Math.abs(n1) < 0.3 ? 0.3 * Math.sign(n1 || 1) : n1
  const off = -(n0 * (px - p.x) + n2 * (pz - p.z)) / ny
  return p.y + off - s.h / 2
}

/** how deep the footprints of two bodies overlap (0 when apart), and a point inside the overlap */
function footprints(a: Pose, sa: Shape, b: Pose, sb: Shape): [number, number, number] {
  const dx = b.x - a.x
  const dz = b.z - a.z
  const d = Math.sqrt(dx * dx + dz * dz)
  if (d >= sa.r + sb.r) return [0, 0, 0]
  if (sa.coin && sb.coin) {
    const pen = sa.r + sb.r - d
    const ux = d > 1e-6 ? dx / d : 1
    const uz = d > 1e-6 ? dz / d : 0
    const m = sa.r - pen / 2
    return [pen, a.x + ux * m, a.z + uz * m]
  }
  // with a box: sample the smaller footprint's points against the other
  const [p, sp, q, sq] = sa.r <= sb.r ? [a, sa, b, sb] : [b, sb, a, sa]
  let best = 0
  let bx = 0
  let bz = 0
  const c = Math.cos(p.yaw)
  const s = Math.sin(p.yaw)
  for (let i = -2; i <= 2; i++)
    for (let j = -2; j <= 2; j++) {
      const lx = (i / 2) * sp.hw * 0.98
      const lz = (j / 2) * sp.hd * 0.98
      if (sp.coin && lx * lx + lz * lz > sp.r * sp.r) continue
      const wx = p.x + lx * c + lz * s
      const wz = p.z - lx * s + lz * c
      const depth = inside(q, sq, wx, wz)
      if (depth > best) {
        best = depth
        bx = wx
        bz = wz
      }
    }
  return [best, bx, bz]
}

/** how far point (px, pz) is inside body q's footprint (0 outside) */
function inside(q: Pose, s: Shape, px: number, pz: number) {
  const dx = px - q.x
  const dz = pz - q.z
  if (s.coin) return Math.max(0, s.r - Math.sqrt(dx * dx + dz * dz))
  const c = Math.cos(q.yaw)
  const sn = Math.sin(q.yaw)
  const lx = Math.abs(dx * c - dz * sn)
  const lz = Math.abs(dx * sn + dz * c)
  return Math.max(0, Math.min(s.hw - lx, s.hd - lz))
}

/** how deep two bodies as shown intersect (0 when they don't): the lesser of the side and the height overlaps */
export function overlapOf(a: Pose, b: Pose): number {
  const sa = shape(a.kind)
  const sb = shape(b.kind)
  if (Math.abs(a.y - b.y) > (sa.h + sb.h) / 2 + 1.2) return 0
  const [pen, px, pz] = footprints(a, sa, b, sb)
  if (pen <= 0) return 0
  const a0 = bottomAt(a, sa, px, pz)
  const b0 = bottomAt(b, sb, px, pz)
  const v = Math.min(a0 + sa.h, b0 + sb.h) - Math.max(a0, b0)
  return v > 0 ? Math.min(pen, v) : 0
}

/** every pair of poses that intersect deeper than tol, quickly (a grid) */
export function overlapsIn(poses: Pose[], tol: number): { a: Pose; b: Pose; d: number }[] {
  const cell = 1.5
  const grid = new Map<number, Pose[]>()
  const key = (x: number, z: number) => Math.floor(x / cell + 100) * 1000 + Math.floor(z / cell + 100)
  for (const p of poses) {
    const k = key(p.x, p.z)
    const l = grid.get(k)
    if (l) l.push(p)
    else grid.set(k, [p])
  }
  const out: { a: Pose; b: Pose; d: number }[] = []
  for (const p of poses) {
    const gx = Math.floor(p.x / cell + 100)
    const gz = Math.floor(p.z / cell + 100)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const l = grid.get((gx + i) * 1000 + gz + j)
        if (!l) continue
        for (const q of l) {
          if (q.id <= p.id) continue
          const d = overlapOf(p, q)
          if (d > tol) out.push({ a: p, b: q, d })
        }
      }
  }
  return out
}

/** how far a body is tilted from lying flat (a coin face down is flat too) */
export function tiltOf(p: Pose) {
  const unit = shape(p.kind).coin ? Math.PI : Math.PI * 2
  const rx = p.tiltX - Math.round(p.tiltX / unit) * unit
  const rz = p.tiltZ - Math.round(p.tiltZ / unit) * unit
  return Math.sqrt(rx * rx + rz * rz)
}

/**
  What is wrong with where a field body is (null if nothing): outside the walls, under a floor, inside a pusher or the
  shelf. A tilted body (leaning a little) is measured by its tilted extents; one turned further than `flat` (tumbling
  through the air) is not judged.
*/
export function misplaced(p: Pose, zU: number, zL: number, tol = 0.02, flat = 0.35): string | null {
  const s = shape(p.kind)
  const half = FIELD_W / 2
  if (tiltOf(p) > flat) return null
  if (Math.abs(p.x) > half + tol) return 'outside the side walls'
  if (p.z > FRONT_Z) return 'past the front edge'
  // points around the edge of its underside (and its middle), each against the solid parts of the machine there
  const c = Math.cos(p.yaw)
  const sn = Math.sin(p.yaw)
  for (let k = 0; k < 9; k++) {
    let lx = 0
    let lz = 0
    if (k < 8) {
      const a = (k / 8) * Math.PI * 2
      if (s.coin) {
        lx = Math.cos(a) * s.r * 0.98
        lz = Math.sin(a) * s.r * 0.98
      } else {
        // the box's corners and the middles of its sides
        lx = Math.max(-1, Math.min(1, Math.cos(a) * 1.5)) * s.hw * 0.98
        lz = Math.max(-1, Math.min(1, Math.sin(a) * 1.5)) * s.hd * 0.98
      }
    }
    const px = p.x + lx * c + lz * sn
    const pz = p.z - lx * sn + lz * c
    const py = bottomAt(p, s, px, pz)
    const bad = solidAt(px, py, pz, zU, zL, tol)
    if (bad) return bad
  }
  return null
}

/** what solid part of the machine (if any) the point (x, y, z) is inside */
function solidAt(x: number, y: number, z: number, zU: number, zL: number, tol: number): string | null {
  const half = FIELD_W / 2
  if (z < UPPER_FRONT_Z - tol) {
    if (y < UPPER_Y - tol) return 'under the upper floor'
    if (z < Math.max(BACK_Z, zU) - tol) return 'inside the upper pusher'
    if (Math.abs(x) > half + tol) return 'in the upper wall'
    return null
  }
  if (z < UPPER_FRONT_Z + tol) return null
  if (z < zL - tol && y < LOWER_TOP - tol) return 'inside the lower pusher'
  if (z > FRONT_Z + tol || Math.abs(x) > half + tol) {
    // off the edges: the open sides and the front are air, the walls are not
    if (z < GUTTER_Z0 - tol && Math.abs(x) > half + tol && y < UPPER_Y) return 'in the lower wall'
    return null
  }
  if (y < -tol) return 'under the lower floor'
  return null
}

/** whether a pose is in the tray */
export const inTray = (p: Pose) => Math.abs(p.x) <= TRAY.w / 2 + 0.01 && p.z >= TRAY.z - TRAY.d / 2 - 0.01 && p.z <= TRAY.z + TRAY.d / 2 + 0.01 && p.y < TRAY.y + 2

/** every body's pose at frame f of a run started from field: tracked bodies from their tracks, the rest from the field */
export function posesAt(field: Field, run: Run, f: number, onlyShown = true): (Pose & { fate: Track['fate'] | 'still' })[] {
  const out: (Pose & { fate: Track['fate'] | 'still' })[] = []
  const tracked = new Map(run.tracks.map((t) => [t.id, t]))
  for (const it of field.items) if (!tracked.has(it.id)) out.push({ ...it, fate: 'still' })
  const fi = Math.floor(f)
  const u = f - fi
  for (const t of run.tracks) {
    if (onlyShown && (fi < t.from || fi > t.to)) continue
    const k0 = Math.max(0, Math.min(t.to - t.from, fi - t.from))
    const k1 = Math.min(t.to - t.from, k0 + 1)
    const g = (c: number) => t.data[k0 * 6 + c] + (t.data[k1 * 6 + c] - t.data[k0 * 6 + c]) * u
    out.push({ id: t.id, kind: t.kind, x: g(0), y: g(1), z: g(2), yaw: g(3), tiltX: g(4), tiltZ: g(5), fate: t.fate })
  }
  return out
}
