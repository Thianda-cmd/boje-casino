import { BULL, NUMBERS, OUTER_BULL, R_BULL, R_DOUBLE_IN, R_DOUBLE_OUT, R_OUTER_BULL, R_TREBLE_IN, R_TREBLE_OUT, TARGETS, shapesOf, type Region, type TargetId } from './rules'

/*
  The board's drawing geometry. The rules work in millimetres with y up and angles clockwise from the top; the SVG
  layers draw in the same millimetres with y down, so a point (x, y) of the rules is drawn at (x, -y). Every region
  is one or two annular sectors (shapesOf), drawn as a path each.

  How far the drawing reaches, in mm from the centre: the scoring area to the outer double wire (170), the black
  number ring to the board's edge (EDGE), the dark foam surround (SURROUND) and the ring light round it (RING).
*/

export const EDGE = 226
export const SURROUND = 250
export const RING = 262
/** where the numbers sit */
export const NUMBER_R = 197

const rad = (deg: number) => (deg * Math.PI) / 180
/** a point at radius r and angle a (degrees clockwise from the top), in SVG millimetres (y down) */
export const pt = (r: number, a: number) => [r * Math.sin(rad(a)), -r * Math.cos(rad(a))] as const
const f = (n: number) => n.toFixed(2)

/** an annular sector from angle a0 to a1 between radii r0 and r1, as an SVG path (a whole ring when it goes all round) */
export function sector(r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= 360) {
    const ring = (r: number, dir: 0 | 1) => `M${f(-r)} 0A${r} ${r} 0 1 ${dir} ${f(r)} 0A${r} ${r} 0 1 ${dir} ${f(-r)} 0Z`
    return r0 > 0 ? ring(r1, 1) + ring(r0, 0) : ring(r1, 1)
  }
  const [x0, y0] = pt(r1, a0)
  const [x1, y1] = pt(r1, a1)
  const [x2, y2] = pt(r0, a1)
  const [x3, y3] = pt(r0, a0)
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`
}

/** the outline of a region (both pieces of a single), as one SVG path */
export const regionPath = (r: Region) =>
  shapesOf(r)
    .map((s) => sector(s.r0, s.r1, s.a0, s.a1))
    .join('')

/** the bed a target aims at: the treble of its number, or the whole bull (the 50 and the 25) */
export function targetRegions(t: TargetId): Region[] {
  if (t === 'bull') return [BULL, OUTER_BULL]
  return [40 + (t === 't20' ? 20 : 19)]
}
export const aimOf = (t: TargetId) => TARGETS.find((x) => x.id === t)!.aim

/** the kind of bed a region is, for colours and sounds */
export type Kind = 'single' | 'treble' | 'double' | 'outer' | 'bull' | 'miss'
export function kindOf(r: Region): Kind {
  if (r === 0) return 'miss'
  if (r === BULL) return 'bull'
  if (r === OUTER_BULL) return 'outer'
  if (r <= 20) return 'single'
  if (r <= 40) return 'double'
  return 'treble'
}

/** the regions' paths, worked out once: the singles (inner and outer pieces), trebles and doubles of each number */
export const SEGMENTS = NUMBERS.map((n, i) => {
  const a0 = i * 18 - 9
  const a1 = a0 + 18
  return {
    n,
    i,
    inner: sector(R_OUTER_BULL, R_TREBLE_IN, a0, a1),
    outer: sector(R_TREBLE_OUT, R_DOUBLE_IN, a0, a1),
    treble: sector(R_TREBLE_IN, R_TREBLE_OUT, a0, a1),
    double: sector(R_DOUBLE_IN, R_DOUBLE_OUT, a0, a1),
  }
})

/** the wires of the spider: the rings and the radial wires between the segments */
export const WIRE_RINGS = [R_BULL, R_OUTER_BULL, R_TREBLE_IN, R_TREBLE_OUT, R_DOUBLE_IN, R_DOUBLE_OUT]
export const WIRE_SPOKES = NUMBERS.map((_, i) => {
  const a = i * 18 + 9
  const [x0, y0] = pt(R_OUTER_BULL, a)
  const [x1, y1] = pt(R_DOUBLE_OUT + 4, a)
  return `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`
}).join('')
