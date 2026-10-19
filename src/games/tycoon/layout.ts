/*
  Where everything stands on the Casino Tycoon floor (world units; y is up, the camera looks in from +x +z).

  The floor is a square 2·HALF across. Its outer ring of a 4 × 4 grid of cells holds the ten plots, the entrance
  (the front corner, nearest the camera) and a fountain garden; the middle four cells are the plaza, with the Coin
  Vault in the middle. Cheap attractions sit by the entrance and the dear ones further back, so the casino grows
  from the front corner back to the Penthouse Suites tower at the back corner:

              suites
          stage    fountain
      lounge          bar
   roulette    VAULT     poker
      dice            blackjack
         claw      slots
            ENTRANCE

  Every attraction faces +x or +z (the two sides the camera sees): the ones left of the centre line face +x, the
  ones right of it +z, so they all turn towards the middle of the screen. Guests walk the corridors between the
  plots: a ring of eight nodes round the plaza (RING), out to a spot in front of each plot (spotOf) and in from the
  entrance.
*/

/** a plot's pad is PLOT across; its attraction keeps within ±USE of the centre */
export const PLOT = 4.6
export const USE = 2.1
/** the pads stand this high on the carpet */
export const PAD_H = 0.14
/** the ring's cells: the middle ones B from the centre line, the corners A (corridors between them) */
const A = 8.4
const B = 2.9
/** the corridor between a corner cell and a middle one, and the walk round the plaza */
export const LANE = (B + A) / 2
/** the floor's half size; its edge stands EDGE_H above the ground round it */
export const HALF = A + PLOT / 2 + 0.8
export const EDGE_H = 1.1

export interface PlotSpot {
  x: number
  z: number
  /** the way its attraction faces: +x or +z */
  face: 'x' | 'z'
  /** the root's turn about y (local +z → world face) */
  rot: number
  /** the ring node guests reach it from */
  anchor: number
}

const plot = (x: number, z: number, face: 'x' | 'z', anchor: number): PlotSpot => ({ x, z, face, rot: face === 'x' ? Math.PI / 2 : 0, anchor })

/** the ten plots, in the engine's order (claw, slots, dice, blackjack, roulette, poker, lounge, bar, stage, suites) */
export const PLOTS: readonly PlotSpot[] = [
  plot(B, A, 'x', 0),
  plot(A, B, 'z', 0),
  plot(-B, A, 'x', 1),
  plot(A, -B, 'z', 7),
  plot(-A, A, 'x', 2),
  plot(A, -A, 'z', 6),
  plot(-A, B, 'x', 2),
  plot(B, -A, 'z', 5),
  plot(-A, -B, 'x', 3),
  plot(-A, -A, 'x', 4),
]

/** the fountain garden (decor) and the entrance foyer */
export const FOUNTAIN = { x: -B, z: -A }
export const FOYER = { x: A, z: A }
/** the Coin Vault's dais in the middle of the plaza */
export const VAULT_R = 2.5

/** the walk round the plaza, in order (each node joins the next and the one before) */
export const RING: readonly [number, number][] = [
  [LANE, LANE],
  [0, LANE],
  [-LANE, LANE],
  [-LANE, 0],
  [-LANE, -LANE],
  [0, -LANE],
  [LANE, -LANE],
  [LANE, 0],
]

/** guests come in at DOOR (outside the front corner) and walk through the foyer to ring node 0 */
export const DOOR: [number, number] = [HALF + 2.2, HALF + 2.2]
export const FOYER_IN: [number, number] = [A + 0.4, A + 0.4]

/** a spot in front of plot i, `u` (-1..1) along its front and `gap` past its edge, into out[] */
export function spotOf(i: number, u: number, out: [number, number], gap = 0.45) {
  const p = PLOTS[i]
  const d = PLOT / 2 + gap
  if (p.face === 'x') {
    out[0] = p.x + d
    out[1] = p.z + u * (USE - 0.3)
  } else {
    out[0] = p.x + u * (USE - 0.3)
    out[1] = p.z + d
  }
  return out
}

/** a point in plot i's own frame (lx across, lz towards its front) in world x, z, into out[] */
export function toWorld(i: number, lx: number, lz: number, out: [number, number]) {
  const p = PLOTS[i]
  const c = Math.cos(p.rot)
  const s = Math.sin(p.rot)
  out[0] = p.x + lx * c + lz * s
  out[1] = p.z - lx * s + lz * c
  return out
}

/** the steps of an attraction's look by how many are owned: 1, 10, 25, 50, 100, 200 */
export const TIERS = [1, 10, 25, 50, 100, 200] as const
export const tierOf = (n: number) => {
  let t = -1
  for (let k = 0; k < TIERS.length; k++) if (n >= TIERS[k]) t = k
  return t
}
