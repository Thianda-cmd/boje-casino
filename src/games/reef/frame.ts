import * as THREE from 'three'
import { FIELD } from './rules'
import { PITCH } from './cast'
import { LAYOUTS, LAYOUT_IDS, type LayoutId } from './field'

/*
  Framing the reef: a perspective camera pitched PITCH down onto the swim plane, backed off until the whole field fits
  the stage with the given margins (in CSS pixels), then slid along it: by default so the field's bottom edge (where
  the cannon sits) rests on the bottom margin and any spare height shows the reef beyond the far edge, like a real
  fish table; or centred between the margins. On a wide stage the field fills the height and the reef shows at the
  sides. pickLayout() chooses which field shape (field.ts) shows biggest on a stage.
*/

export const FOV = 32
const DIR = new THREE.Vector3(0, Math.sin(PITCH), Math.cos(PITCH))
const corner = new THREE.Vector3()

export interface Margins {
  top: number
  bottom: number
  side: number
}

export interface FieldSize {
  w: number
  h: number
}

/** frames the field for a w × h stage; returns the camera's target (the point it looks at) */
export function fitCamera(cam: THREE.PerspectiveCamera, w: number, h: number, m: Margins = { top: 8, bottom: 8, side: 8 }, anchor: 'bottom' | 'center' = 'bottom', field: FieldSize = FIELD) {
  cam.fov = FOV
  cam.aspect = w / h
  cam.updateProjectionMatrix()
  const target = new THREE.Vector3()
  const hw = field.w / 2
  const hh = field.h / 2
  const lim = { x: 1 - (2 * m.side) / w, top: 1 - (2 * m.top) / h, bottom: -1 + (2 * m.bottom) / h }
  const place = (d: number) => {
    cam.position.copy(target).addScaledVector(DIR, d)
    cam.lookAt(target)
    cam.updateMatrixWorld(true)
  }
  /** the field's extent on screen (NDC) from distance d */
  const extent = (d: number) => {
    place(d)
    let x = 0
    let y0 = Infinity
    let y1 = -Infinity
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      corner.set(sx * hw, 0, sz * hh).project(cam)
      x = Math.max(x, Math.abs(corner.x))
      y0 = Math.min(y0, corner.y)
      y1 = Math.max(y1, corner.y)
    }
    return { x, y0, y1 }
  }
  for (let pass = 0; pass < 4; pass++) {
    let lo = 1
    let hi = 400
    for (let i = 0; i < 40; i++) {
      const d = (lo + hi) / 2
      const e = extent(d)
      if (e.x <= lim.x && e.y0 >= lim.bottom && e.y1 <= lim.top) hi = d
      else lo = d
    }
    // slide along the field so its bottom edge rests on the bottom margin (or it sits centred)
    const e = extent(hi)
    const want = anchor === 'bottom' ? lim.bottom + (e.y1 - e.y0) / 2 : (lim.top + lim.bottom) / 2
    const got = (e.y0 + e.y1) / 2
    const unitsPerNdc = (field.h * Math.sin(PITCH)) / Math.max(1e-3, e.y1 - e.y0)
    target.z -= (got - want) * unitsPerNdc
    if (Math.abs(got - want) < 1e-4) {
      place(hi)
      break
    }
    place(hi)
  }
  return target
}

const probe = new THREE.PerspectiveCamera(FOV, 1, 0.5, 200)
const quad = [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()]

/** how many CSS px² a field covers once framed on a w × h stage */
function shownArea(w: number, h: number, m: Margins, field: FieldSize) {
  fitCamera(probe, w, h, m, 'bottom', field)
  const order = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  order.forEach(([sx, sz], i) => {
    corner.set((sx * field.w) / 2, 0, (sz * field.h) / 2).project(probe)
    quad[i].set(((corner.x + 1) / 2) * w, ((1 - corner.y) / 2) * h)
  })
  let a = 0
  for (let i = 0; i < 4; i++) {
    const p = quad[i]
    const q = quad[(i + 1) % 4]
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a) / 2
}

/**
 * The field layout that fills the most of a w × h stage (the layouts have about the same area, so that is also the one
 * that draws the creatures biggest), keeping `current` unless another is clearly better, so a stage near the boundary
 * doesn't flip back and forth. The tall field has to win by a margin: it is for portrait stages, and on a squarish one
 * the wider field plays better (the creatures cross the way they face).
 */
export function pickLayout(w: number, h: number, m: Margins, current?: LayoutId): LayoutId {
  let best: LayoutId = current ?? 'wide'
  let bestScore = -1
  const score = (id: LayoutId) => shownArea(w, h, m, LAYOUTS[id]) * (id === current ? 1.07 : 1) * (id === 'tall' ? 0.85 : 1)
  for (const id of LAYOUT_IDS) {
    const s = score(id)
    if (s > bestScore) {
      bestScore = s
      best = id
    }
  }
  return best
}
