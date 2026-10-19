import type { BetKey, Num } from './rules'

/*
  The craps layout printed on the felt: where each area is, in the felt's own units (a die's edge is 1). The scene
  paints the felt from it (models.ts) and stands the puck on it; the screen can draw its own board from the same
  areas, so the two always read as one table.

  Coordinates: u across the felt from the left wall (0) to the right (FELT_W), v down its length from the backboard
  (0) to the shooter's end (FELT_L), as the shooter sees it: text on the felt reads upright from the shooter's end.
  The table's frame (physics.ts) has x = u - FELT_W / 2 and z = v - FELT_L / 2.

  Down the felt from the backboard: the landing zone (plain felt and the house's mark, where the dice come to rest),
  the centre props the stickman deals (Any Seven, the hardways, the horn bets, Any Craps), then the shooter's layout:
  the place numbers with the Don't Come bar, Come, the Field, the Don't Pass bar and the Pass Line along the rail.
  A strip of plain felt (CUT_V) lies between the props and the number boxes: the betting view's foot is cut there,
  where the screen's own board takes over, so neither half of the print is clipped.
*/

export const FELT_W = 11
export const FELT_L = 24

export interface Area {
  /** the bet made here; the number boxes hold place bets and come bets that travel there */
  key: BetKey
  u: number
  v: number
  w: number
  h: number
}

const NUMS: readonly Num[] = [4, 5, 6, 8, 9, 10]

/** the shooter's layout and the centre props, as areas */
export const AREAS: readonly Area[] = (() => {
  const out: Area[] = []
  // the number boxes, with the Don't Come bar at their left
  const nTop = 12.7
  const nH = 2.5
  out.push({ key: 'dontCome', u: 0.35, v: nTop, w: 1.9, h: nH })
  const nw = (FELT_W - 0.35 - 2.25) / 6
  NUMS.forEach((n, i) => out.push({ key: `place${n}`, u: 2.25 + i * nw, v: nTop, w: nw, h: nH }))
  out.push({ key: 'come', u: 0.35, v: 15.35, w: FELT_W - 0.7, h: 2.2 })
  out.push({ key: 'field', u: 0.35, v: 17.7, w: FELT_W - 0.7, h: 2.15 })
  out.push({ key: 'dontPass', u: 0.35, v: 20, w: FELT_W - 0.7, h: 1.3 })
  out.push({ key: 'pass', u: 0.35, v: 21.45, w: FELT_W - 0.7, h: 2.15 })
  // the centre props
  const pu = 1.1
  const pw = FELT_W - 2.2
  out.push({ key: 'any7', u: pu, v: 7.35, w: pw, h: 0.95 })
  ;(['hard4', 'hard6', 'hard8', 'hard10'] as const).forEach((k, i) => out.push({ key: k, u: pu + (i * pw) / 4, v: 8.4, w: pw / 4, h: 1.25 }))
  ;(['aces', 'aceDeuce', 'yo', 'boxcars'] as const).forEach((k, i) => out.push({ key: k, u: pu + (i * pw) / 4, v: 9.75, w: pw / 4, h: 1.05 }))
  out.push({ key: 'anyCraps', u: pu, v: 10.9, w: pw, h: 0.85 })
  return out
})()

/** the area a bet is made in (come bets on a number sit in that number's box) */
export function areaOf(key: BetKey): Area | undefined {
  return AREAS.find((a) => a.key === key)
}

/** the props box round the centre bets, and the landing zone's middle (where the house's mark is printed) */
export const PROPS_BOX = { u: 0.85, v: 7.1, w: FELT_W - 1.7, h: 4.9 }
/** the line across the felt between the props box (it ends at v 12) and the number boxes (from v 12.7) */
export const CUT_V = 12.35
export const MARK_AT = { u: FELT_W / 2, v: 3.7 }

/** where the puck stands: on the point's number box (ON), or in the Don't Come bar (OFF) */
export function puckSpot(point: Num | null): { u: number; v: number } {
  const a = areaOf(point === null ? 'dontCome' : `place${point}`)!
  return { u: a.u + a.w / 2, v: a.v + (point === null ? 1.88 : 0.55) }
}
