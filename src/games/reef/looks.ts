/*
  The cannon's seven looks, one per cost level, as plain data. gear.ts builds the 3D barrels from them; the screen
  draws its little cannon in the panel from the same table, without pulling three.js into the page's bundle.
*/

/** each level's colour: teal, green, blue, purple, pink, orange, gold */
export const LEVEL_COLORS = ['#2fc6c0', '#3fd47a', '#3a8dff', '#8a5cff', '#ff4fa0', '#ff8a2a', '#ffcf3a'] as const

export interface Look {
  body: string
  /** the barrel's length and radius in reef units */
  len: number
  r: number
  /** brass bands round the barrel, fins at its base, gems set in it */
  bands: number
  fins: number
  gems: number
  /** side pods (from level 6) and a crown round the muzzle (level 7) */
  pods: boolean
  crown: boolean
  /** the bands' and collar's colour, when not brass (the gold barrel's ruby, so it doesn't melt into the brass ring) */
  trim?: string
}

/** the seven barrels, one per cost level */
export const LOOKS: readonly Look[] = [
  { body: LEVEL_COLORS[0], len: 1.0, r: 0.24, bands: 1, fins: 0, gems: 0, pods: false, crown: false },
  { body: LEVEL_COLORS[1], len: 1.08, r: 0.255, bands: 2, fins: 0, gems: 0, pods: false, crown: false },
  { body: LEVEL_COLORS[2], len: 1.16, r: 0.27, bands: 2, fins: 2, gems: 0, pods: false, crown: false },
  { body: LEVEL_COLORS[3], len: 1.24, r: 0.285, bands: 3, fins: 2, gems: 1, pods: false, crown: false },
  { body: LEVEL_COLORS[4], len: 1.32, r: 0.3, bands: 3, fins: 3, gems: 2, pods: false, crown: false },
  { body: LEVEL_COLORS[5], len: 1.42, r: 0.32, bands: 3, fins: 3, gems: 3, pods: true, crown: false },
  { body: LEVEL_COLORS[6], len: 1.54, r: 0.34, bands: 4, fins: 3, gems: 4, pods: true, crown: true, trim: '#e8344f' },
]
