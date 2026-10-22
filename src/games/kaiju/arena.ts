/*
  Neon Bay, the arena: a round city plaza on the waterfront, in world units (the 3D stage and the fight script share
  it; one unit is about a storey, and a kaiju stands 9 to 13 tall).

  The plaza is a disc of radius PLAZA_R round (0, 0), cut off at the back by the shore: the bay is all of z < SHORE_Z.
  The camera looks from +z, so the fighters are seen with the bay and the far skyline behind them, and a Splash
  throws the loser away from the camera into the water (it lands about SPLASH_Z). A starts on the left (x < 0), B on
  the right. The kaijus' centres stay inside the fighting ground (inGround: within FIGHT_R of the centre and
  SHORE_MARGIN clear of the water) except when one is thrown into the bay.

  Round the plaza, facing in, stands a ring of BUILDINGS from the right-hand waterfront round the front to the
  left-hand waterfront (none on the water side). The ones at the front, between the camera and the fight, are low
  (shops and tanks) so they never hide the kaiju; the tall towers and hotels stand at the sides. Each has a stand
  point 3 units in front of its face, where a kaiju is when it smashes the building or is knocked into it, and `out`,
  the DIRS direction from the plaza's centre toward it.

  The tables are written out as numbers (worked out once with trigonometry), so the script, which only adds and
  multiplies, never needs a sine or a square root: DIRS holds 32 unit directions instead.
*/

export const PLAZA_R = 26
/** the bay is z < SHORE_Z */
export const SHORE_Z = -22
/** how far from the centre a kaiju's centre may be while it fights */
export const FIGHT_R = 25.6
/** how far a fighting kaiju's centre stays from the water's edge */
export const SHORE_MARGIN = 2.5
/** where a thrown kaiju comes down in the bay (z), and how far to the side of the centre a Splash may be (|x|) */
export const SPLASH_Z = -31
export const SPLASH_X = 12

/** where each kaiju starts every round */
export const START = { a: { x: -10, z: 0 }, b: { x: 10, z: 0 } } as const

/** the stage's landmarks off the plaza, clear of where Splashes land: a pier on the right, a lighthouse on a rock */
export const PIER = { x: 19, z0: SHORE_Z, z1: -42, w: 4 }
export const LIGHTHOUSE = { x: -26, z: -38 }

export type BuildingKind = 'tower' | 'hotel' | 'casino' | 'block' | 'tank' | 'neon' | 'shop' | 'depot'

export interface Building {
  /** how the stage draws it: an office tower, a hotel, a casino with its sign, an apartment block, a round tank, a
   *  neon billboard on a frame, a low shop front, a waterfront warehouse */
  kind: BuildingKind
  /** for the commentary: "crashes through the Starlight Hotel" */
  name: string
  /** the centre of its footprint */
  x: number
  z: number
  /** its width along the plaza's edge, its depth (toward the centre and away) and its height */
  w: number
  d: number
  h: number
  /** three.js rotation.y that turns its front (local +z, the w × h face) toward the plaza's centre */
  rot: number
  /** where a kaiju stands to smash it or is knocked into it: 3 units in front of its face */
  stand: { x: number; z: number }
  /** the DIRS index pointing from the plaza's centre toward it */
  out: number
}

export const BUILDINGS: readonly Building[] = [
  { kind: 'depot', name: 'Pier 9 Warehouse', x: 26.5, z: -16.1, w: 5.6, d: 5, h: 6, rot: -1.02, stand: { x: 21.8, z: -13.3 }, out: 29 },
  { kind: 'tank', name: 'Harbour Gas Works', x: 28.7, z: -10.7, w: 4.2, d: 4.2, h: 6.5, rot: -1.21, stand: { x: 23.9, z: -8.9 }, out: 30 },
  { kind: 'tower', name: 'Bayline Tower', x: 30.4, z: -5.9, w: 4.2, d: 5, h: 21, rot: -1.38, stand: { x: 25, z: -4.8 }, out: 31 },
  { kind: 'hotel', name: 'Grand Neon Hotel', x: 31.5, z: 0.1, w: 5.8, d: 6, h: 17, rot: -1.57, stand: { x: 25.5, z: 0.1 }, out: 0 },
  { kind: 'block', name: 'Seaview Flats', x: 30.6, z: 6.4, w: 4.8, d: 5.5, h: 10, rot: -1.78, stand: { x: 25, z: 5.2 }, out: 1 },
  { kind: 'tower', name: 'Kaiju Insurance Tower', x: 28.7, z: 11.6, w: 4.2, d: 5, h: 19, rot: -1.95, stand: { x: 23.6, z: 9.5 }, out: 2 },
  { kind: 'casino', name: 'Lucky Strike Casino', x: 26.4, z: 17.6, w: 6.4, d: 6.5, h: 10, rot: -2.16, stand: { x: 21.2, z: 14.1 }, out: 3 },
  { kind: 'neon', name: 'Boje Billboard', x: 20.9, z: 21.1, w: 4, d: 2.4, h: 11, rot: -2.36, stand: { x: 18, z: 18.1 }, out: 4 },
  { kind: 'block', name: 'Noodle House Block', x: 17.9, z: 25.6, w: 4.8, d: 5.5, h: 9, rot: -2.53, stand: { x: 14.6, z: 20.9 }, out: 5 },
  { kind: 'tower', name: 'Mirror Tower', x: 13, z: 28.1, w: 4.2, d: 5, h: 16, rot: -2.71, stand: { x: 10.7, z: 23.2 }, out: 6 },
  { kind: 'shop', name: 'Moonlight Arcade', x: 7.8, z: 29.6, w: 4.6, d: 4.2, h: 5, rot: -2.88, stand: { x: 6.5, z: 24.6 }, out: 7 },
  { kind: 'tank', name: 'Water Tower', x: 2.6, z: 30.5, w: 4.2, d: 4.2, h: 6, rot: -3.06, stand: { x: 2.2, z: 25.4 }, out: 8 },
  { kind: 'shop', name: 'Pachinko Parlour', x: -2.6, z: 30.5, w: 4.6, d: 4.2, h: 4.5, rot: 3.06, stand: { x: -2.2, z: 25.4 }, out: 8 },
  { kind: 'shop', name: 'Karaoke Box', x: -8.1, z: 29.5, w: 4.6, d: 4.2, h: 4.5, rot: 2.88, stand: { x: -6.7, z: 24.6 }, out: 9 },
  { kind: 'tank', name: 'Coolant Tank', x: -13, z: 27.7, w: 4.2, d: 4.2, h: 5.5, rot: 2.7, stand: { x: -10.8, z: 23.1 }, out: 10 },
  { kind: 'shop', name: 'Lucky Cat Pawnshop', x: -17.6, z: 25, w: 4.6, d: 4.2, h: 5, rot: 2.53, stand: { x: -14.7, z: 20.9 }, out: 11 },
  { kind: 'tower', name: 'Jade Tower', x: -21.9, z: 21.9, w: 4.2, d: 5, h: 18, rot: 2.36, stand: { x: -18, z: 18 }, out: 12 },
  { kind: 'neon', name: 'Electric Sky Sign', x: -24.1, z: 17.3, w: 4, d: 2.4, h: 12, rot: 2.19, stand: { x: -20.7, z: 14.9 }, out: 13 },
  { kind: 'casino', name: 'Golden Dragon Casino', x: -29, z: 13, w: 6.4, d: 6.5, h: 11, rot: 1.99, stand: { x: -23.3, z: 10.5 }, out: 14 },
  { kind: 'hotel', name: 'Starlight Hotel', x: -30.9, z: 5.9, w: 5.8, d: 6, h: 15, rot: 1.76, stand: { x: -25, z: 4.8 }, out: 15 },
  { kind: 'block', name: 'Old Town Flats', x: -31.2, z: -0.5, w: 4.8, d: 5.5, h: 9, rot: 1.56, stand: { x: -25.5, z: -0.4 }, out: 16 },
  { kind: 'tower', name: 'Harbour Bank', x: -30.4, z: -5.9, w: 4.2, d: 5, h: 20, rot: 1.38, stand: { x: -25, z: -4.8 }, out: 17 },
  { kind: 'tank', name: 'Oil Tank', x: -28.7, z: -10.7, w: 4.2, d: 4.2, h: 6, rot: 1.21, stand: { x: -23.9, z: -8.9 }, out: 18 },
  { kind: 'depot', name: 'Ferry Terminal', x: -26.5, z: -16.1, w: 5.6, d: 5, h: 6.5, rot: 1.02, stand: { x: -21.8, z: -13.3 }, out: 19 },
]

/** 32 unit directions in the ground plane, [x, z], DIRS[k] at k × 11.25° from +x toward +z */
export const DIRS: readonly (readonly [number, number])[] = [
  [1, 0], [0.980785, 0.19509], [0.92388, 0.382683], [0.83147, 0.55557], [0.707107, 0.707107], [0.55557, 0.83147], [0.382683, 0.92388], [0.19509, 0.980785],
  [0, 1], [-0.19509, 0.980785], [-0.382683, 0.92388], [-0.55557, 0.83147], [-0.707107, 0.707107], [-0.83147, 0.55557], [-0.92388, 0.382683], [-0.980785, 0.19509],
  [-1, 0], [-0.980785, -0.19509], [-0.92388, -0.382683], [-0.83147, -0.55557], [-0.707107, -0.707107], [-0.55557, -0.83147], [-0.382683, -0.92388], [-0.19509, -0.980785],
  [0, -1], [0.19509, -0.980785], [0.382683, -0.92388], [0.55557, -0.83147], [0.707107, -0.707107], [0.83147, -0.55557], [0.92388, -0.382683], [0.980785, -0.19509],
]
export const NDIRS = DIRS.length

/** the DIRS index nearest a direction (the one with the biggest dot product: no square roots) */
export function dirIndex(dx: number, dz: number): number {
  let best = 0
  let top = -Infinity
  for (let k = 0; k < NDIRS; k++) {
    const d = DIRS[k][0] * dx + DIRS[k][1] * dz
    if (d > top) {
      top = d
      best = k
    }
  }
  return best
}

/** whether a point is in the bay */
export const inWater = (_x: number, z: number) => z < SHORE_Z

/** whether a point is on the plaza (margin: how far inside its edge) */
export const inPlaza = (x: number, z: number, margin = 0) => x * x + z * z <= (PLAZA_R - margin) * (PLAZA_R - margin) && z >= SHORE_Z + margin

/** whether a kaiju's centre may be here while it fights */
export const inGround = (x: number, z: number) => x * x + z * z <= FIGHT_R * FIGHT_R && z >= SHORE_Z + SHORE_MARGIN

/**
 * How far a point is from a building's footprint (0 inside it). For checks and effects (which building a stray beam
 * passes, the tests), not for the script: it uses the rotation's sine and cosine.
 */
export function distToBuilding(b: Building, x: number, z: number): number {
  const c = Math.cos(b.rot)
  const s = Math.sin(b.rot)
  const dx = x - b.x
  const dz = z - b.z
  // into the building's own frame: local x = (cos, −sin), local z = (sin, cos) in world (x, z)
  const lx = dx * c - dz * s
  const lz = dx * s + dz * c
  const ox = Math.max(0, Math.abs(lx) - b.w / 2)
  const oz = Math.max(0, Math.abs(lz) - b.d / 2)
  return Math.hypot(ox, oz)
}
