import { BOJE_B } from '../../art/brand'

/*
  The two faces of the coin, as plain shapes in a 200 × 200 box centred on (100, 100), the field's edge at radius 100.
  The 3D coin paints its textures from these (models.ts) and the panel, history and lobby draw the same shapes in SVG
  (art.tsx), so the coin looks the same everywhere.

  Heads is the Boje gem: the brand's hexagon cut into six facets, in green enamel, with a gold B standing on it.
  Tails is a royal crown in gold on a roundel of royal-blue enamel: five upright points (gold balls on four, a cross on
  the tallest) over a jewelled band. Green for heads and blue for tails tell the sides apart at any size. Both are
  ringed by beads and lettering.
*/

export const BOX = 200
export const C = 100

/** the gem's hexagon (the brand's, point up), circumradius 46 */
export const GEM_R = 46
const BRAND_HEX: [number, number][] = [
  [16, 2.6],
  [27.6, 9.3],
  [27.6, 22.7],
  [16, 29.4],
  [4.4, 22.7],
  [4.4, 9.3],
]
/** brand units (32 box, hexagon circumradius 13.4) to face units */
export const GEM_SCALE = GEM_R / 13.4
export const GEM_HEX: [number, number][] = BRAND_HEX.map(([x, y]) => [C + (x - 16) * GEM_SCALE, C + (y - 16) * GEM_SCALE])
/** the brand's B; draw it with transform `translate(GEM_B_X GEM_B_Y) scale(GEM_SCALE)` (it is cut for the 32 box) */
export const B_PATH = BOJE_B
export const GEM_B_X = C - (16 - 0.3) * GEM_SCALE
export const GEM_B_Y = C - 16 * GEM_SCALE
/** how bright each facet's enamel is, clockwise from the top right (lit from the top left, like the loader) */
export const FACET_SHADE = [1.0, 0.86, 0.68, 0.6, 0.74, 0.93]

/** the blue enamel roundel behind the crown: its radius (a raised gold bezel runs round it) */
export const ROUNDEL_R = 61
/** the crown's body: five upright points with shallow valleys between them, standing on the band */
export const CROWN_BODY = 'M63 122 L59 80 L72 96 L80.5 67 L91 91 L100 57 L109 91 L119.5 67 L128 96 L141 80 L137 122 Z'
/** the band across the bottom of the crown */
export const CROWN_BAND = { x: 55, y: 115, w: 90, h: 24, r: 6 }
/** gold balls on the four outer points: x, y, radius */
export const CROWN_BALLS: [number, number, number][] = [
  [59, 77, 5.6],
  [80.5, 63.5, 5.6],
  [119.5, 63.5, 5.6],
  [141, 77, 5.6],
]
/** the cross on the tallest point */
export const CROWN_CROSS = 'M96.8 33 H103.2 V39.6 H109.6 V46 H103.2 V60 H96.8 V46 H90.4 V39.6 H96.8 Z'
/** an inner line just inside the points (an engraved groove) */
export const CROWN_INNER = 'M67 113 L65 92 L73.5 103 L80.5 80 L89.5 101 L100 72 L110.5 101 L119.5 80 L126.5 103 L135 92 L133 113'
/** jewels on the band: x, y, rx, ry, colour */
export const CROWN_JEWELS: [number, number, number, number, string][] = [
  [100, 127, 8.6, 6.4, '#ff3150'],
  [77, 127, 5, 5, '#f4f1ff'],
  [123, 127, 5, 5, '#f4f1ff'],
]
/** little studs between the jewels */
export const CROWN_STUDS: [number, number][] = [
  [63.5, 127],
  [88.5, 127],
  [111.5, 127],
  [136.5, 127],
]

/** the lettering round each face (top arc), and the stars along the bottom */
export const LEGEND = { heads: 'BOJE CASINO', tails: 'DOUBLE OR NOTHING' } as const
export const RING = { groove: 69, beads: 75, beadR: 2.5, beadN: 40, text: 87 }

export const GOLD = { light: '#fff3b0', mid: '#f7c548', deep: '#d9901c', dark: '#8a4a0c', ink: '#2a1206' }
export const ENAMEL = { green: '#22d36f', greenLight: '#7dffb8', greenDeep: '#0b8a47', blue: '#2b62f0', blueLight: '#6f9bff', blueDeep: '#1637a8' }
/** each side's own colour, for the history, the ladder and the buttons */
export const SIDE_COLOR = { heads: '#22d36f', tails: '#4d84ff' } as const
export const INK = '#1d0f30'
