import * as THREE from 'three'
import { HALF, ROUND, type Face } from './cube'

/*
  The die's mesh, shared by the dice games, and the atlas convention their face textures follow: one atlas holds all
  six faces, three across and two down, each face's cell oriented by FACE_FRAME (which matches cube.ts's FACE_AXIS).
  A game paints its own atlas (Sic Bo's ivory dice, Craps' casino red) with the pips where PIPS puts them.
*/

/** where the pips sit on each face, in units of half the face (up is +) */
export const PIPS: Readonly<Record<Face, readonly [number, number][]>> = {
  1: [[0, 0]],
  2: [
    [0.5, 0.5],
    [-0.5, -0.5],
  ],
  3: [
    [0.5, 0.5],
    [0, 0],
    [-0.5, -0.5],
  ],
  4: [
    [-0.5, 0.5],
    [0.5, 0.5],
    [-0.5, -0.5],
    [0.5, -0.5],
  ],
  5: [
    [-0.5, 0.5],
    [0.5, 0.5],
    [0, 0],
    [-0.5, -0.5],
    [0.5, -0.5],
  ],
  6: [
    [-0.5, 0.56],
    [0.5, 0.56],
    [-0.5, 0],
    [0.5, 0],
    [-0.5, -0.56],
    [0.5, -0.56],
  ],
}

/** each face's cell in the atlas (3 across, 2 down) */
export const cellOf = (f: Face) => [(f - 1) % 3, Math.floor((f - 1) / 3)] as const

/**
 * Each face's own axes on the die (u to the right, v up as you look at it), outward normal = u × v; matching
 * cube.ts's FACE_AXIS (1 up, 6 down, 2 front, 5 back, 3 right, 4 left).
 */
export const FACE_FRAME: Readonly<Record<Face, readonly [THREE.Vector3Tuple, THREE.Vector3Tuple, THREE.Vector3Tuple]>> = {
  1: [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  6: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  2: [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  5: [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  3: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  4: [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
}

let diceGeo: THREE.BufferGeometry | null = null
/**
 * A die: the cube's surface pushed out round its edges and corners onto the rounded shape (each point of the
 * squared-off cube is moved onto the ball of radius ROUND round its nearest point of the inner cube), dense along the
 * edges and plain across the faces, each face mapped onto its cell of the atlas.
 */
export function diceGeometry() {
  if (diceGeo) return diceGeo
  const core = HALF - ROUND
  // along an edge of a face: the rounded band in even steps of angle, the flat between in two
  const K = 5
  const ticks: number[] = []
  for (let k = K; k >= 1; k--) ticks.push(-(core + ROUND * Math.tan(((Math.PI / 4) * k) / K)))
  ticks.push(-core, 0, core)
  for (let k = 1; k <= K; k++) ticks.push(core + ROUND * Math.tan(((Math.PI / 4) * k) / K))
  const M = ticks.length
  const pos: number[] = []
  const nor: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const v = new THREE.Vector3()
  const inner = new THREE.Vector3()
  for (const f of [1, 2, 3, 4, 5, 6] as Face[]) {
    const [n, a, b] = FACE_FRAME[f].map((x) => new THREE.Vector3(...x))
    const [cx, cy] = cellOf(f)
    const base = pos.length / 3
    for (let j = 0; j < M; j++)
      for (let i = 0; i < M; i++) {
        v.copy(n).multiplyScalar(HALF).addScaledVector(a, ticks[i]).addScaledVector(b, ticks[j])
        inner.set(THREE.MathUtils.clamp(v.x, -core, core), THREE.MathUtils.clamp(v.y, -core, core), THREE.MathUtils.clamp(v.z, -core, core))
        const d = v.clone().sub(inner).normalize()
        const p = inner.clone().addScaledVector(d, ROUND)
        pos.push(p.x, p.y, p.z)
        nor.push(d.x, d.y, d.z)
        // the face's own (u, v) in 0-1, into its cell (the canvas's rows run down, the texture's v up)
        const fu = (ticks[i] + HALF) / (2 * HALF)
        const fv = (ticks[j] + HALF) / (2 * HALF)
        uv.push((cx + fu) / 3, 1 - (cy + 1 - fv) / 2)
      }
    for (let j = 0; j < M - 1; j++)
      for (let i = 0; i < M - 1; i++) {
        const p0 = base + j * M + i
        idx.push(p0, p0 + 1, p0 + M + 1, p0, p0 + M + 1, p0 + M)
      }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeBoundingSphere()
  diceGeo = g
  return g
}

/** lets go of the mesh's GPU copy (a closing renderer's); the mesh stays cached for the next visit */
export function releaseDiceGeometry() {
  diceGeo?.dispose()
}
