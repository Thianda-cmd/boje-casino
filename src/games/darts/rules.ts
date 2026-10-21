/*
  Bullseye's rules: three darts at a standard board, paid on their total.

  The player picks a target (Treble 20, Treble 19 or the Bull) and a thrower (Pro, Regular or Wild). A dart lands
  around the target with a round Gaussian scatter whose spread is the thrower's; where it lands scores as on a real
  board (singles, doubles, trebles, the 25 and the 50; off the wire scores 0). The round is three darts and pays on
  their total, 0 to 180, from the paytable of that target and thrower.

  The odds are worked out, not simulated. Every region of the board is an annular sector (the singles two of them),
  so for each target and thrower the scatter is integrated over each region on a polar grid whose cells line up with
  the wires: half a millimetre (less for a tight thrower) by a quarter of a degree. Each cell lies wholly inside its
  region, so the only error is the midpoint rule's within a cell, a few parts in a million. A miss is whatever the
  board doesn't take. That table *is* the game: a dart is drawn by first drawing its region from the table, then a
  spot inside that region (a cell by its weight, then a point in it) for the dart to land on, or, for a miss, a spot
  off the board drawn from the scatter itself. The three darts' totals follow by convolution, and the paytable is
  solved against them.

  The paytable rule, the same for every target and thrower: a total pays nothing below the round's par (the total
  reached or beaten only TOP_SHARE of the time); from par up, a total pays c / T^GAMMA, where T is the chance of
  scoring that total or more. Rarer totals pay more, the 180 most of all. Payouts are rounded to tidy steps and c is
  then settled (by bisection) so the rounded table returns as close to RTP as it can without going over it.
  (tools/darts-test.ts checks the geometry, the grid's totals, every table's exact return, and samples rounds.)
*/

/* ---------------- the board ---------------- */

/** radii in millimetres, as on a regulation board */
export const R_BULL = 6.35
export const R_OUTER_BULL = 15.9
export const R_TREBLE_IN = 99
export const R_TREBLE_OUT = 107
export const R_DOUBLE_IN = 162
export const R_DOUBLE_OUT = 170
/** the numbers clockwise from the top; each segment spans 18°, the 20 centred on the top */
export const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5] as const

/**
 * A board region, as an index: 0 off the board, 1-20 a single, 21-40 a double, 41-60 a treble (of the number), 61
 * the 25 (outer bull) and 62 the 50 (bull).
 */
export type Region = number
export const MISS = 0
export const OUTER_BULL = 61
export const BULL = 62
export const REGIONS = 63

export function regionScore(r: Region): number {
  if (r === MISS) return 0
  if (r === OUTER_BULL) return 25
  if (r === BULL) return 50
  if (r <= 20) return r
  if (r <= 40) return 2 * (r - 20)
  return 3 * (r - 40)
}

/** how a region is called: "T20", "D16", "S5", "25", "BULL", "MISS" */
export function regionName(r: Region): string {
  if (r === MISS) return 'MISS'
  if (r === OUTER_BULL) return '25'
  if (r === BULL) return 'BULL'
  if (r <= 20) return `S${r}`
  if (r <= 40) return `D${r - 20}`
  return `T${r - 40}`
}

/** the angle (degrees clockwise from the top) of a number's segment centre */
export const numberAngle = (n: number) => NUMBERS.indexOf(n as (typeof NUMBERS)[number]) * 18

/** where a point lands, x to the right and y up from the centre, in millimetres */
export function classify(x: number, y: number): Region {
  const r = Math.hypot(x, y)
  if (r > R_DOUBLE_OUT) return MISS
  if (r <= R_BULL) return BULL
  if (r <= R_OUTER_BULL) return OUTER_BULL
  let a = (Math.atan2(x, y) * 180) / Math.PI
  if (a < 0) a += 360
  const n = NUMBERS[Math.floor(((a + 9) % 360) / 18)]
  if (r >= R_TREBLE_IN && r <= R_TREBLE_OUT) return 40 + n
  if (r >= R_DOUBLE_IN) return 20 + n
  return n
}

/* ---------------- targets and throwers ---------------- */

export type TargetId = 't20' | 't19' | 'bull'
export type ThrowerId = 'pro' | 'regular' | 'wild'

/** a target's aim point, x right and y up in mm: the middle of its treble bed, or the centre */
const trebleAim = (n: number) => {
  const a = (numberAngle(n) * Math.PI) / 180
  const r = (R_TREBLE_IN + R_TREBLE_OUT) / 2
  return { x: r * Math.sin(a), y: r * Math.cos(a) }
}
export const TARGETS: { id: TargetId; name: string; short: string; aim: { x: number; y: number } }[] = [
  { id: 't20', name: 'Treble 20', short: 'T20', aim: trebleAim(20) },
  { id: 't19', name: 'Treble 19', short: 'T19', aim: trebleAim(19) },
  { id: 'bull', name: 'Bull', short: 'Bull', aim: { x: 0, y: 0 } },
]
/** a thrower's scatter: the spread (standard deviation, mm) of a dart about the aim in each direction */
export const THROWERS: { id: ThrowerId; name: string; line: string; sigma: number }[] = [
  { id: 'pro', name: 'Pro', line: 'Tight grouping, steady pays', sigma: 14 },
  { id: 'regular', name: 'Regular', line: 'A pub player on a good night', sigma: 26 },
  { id: 'wild', name: 'Wild', line: 'Anything can happen', sigma: 42 },
]

/* ---------------- the maths ---------------- */

export const RTP = 0.97
/** the most a round pays, times the stake */
export const MAX_MULT = 10_000
/** a total pays from the round's par up: the total reached or beaten this share of the time */
export const TOP_SHARE = 0.42
/** how steeply payouts climb as totals get rarer */
export const GAMMA = 0.86
export const DARTS = 3
export const MAX_TOTAL = 180
/** a total rarer than this is left off the paytable shown (it still pays, should it ever happen) */
export const TOP_ODDS = 1e-7

/** the polar grid: the largest cell across (mm, and at most a 24th of the spread) and the angular step (degrees) */
const DR = 0.5
const DA = 0.25

export interface Throwing {
  target: TargetId
  thrower: ThrowerId
  /** P(region) for one dart */
  region: Float64Array
  /** P(score) for one dart, 0..60 */
  dart: Float64Array
  /** P(total) for the round, 0..180 */
  total: Float64Array
  /** P(total >= s) */
  tail: Float64Array
  /** what each total pays, times the stake */
  pays: Float64Array
  /** the smallest total that pays */
  par: number
  /** the highest total worth showing: scored at least once in TOP_ODDS rounds (higher ones are all but impossible) */
  top: number
  /** the table's exact return */
  rtp: number
  /** the aim (mm) and spread (mm) it was worked out for */
  aim: { x: number; y: number }
  sigma: number
}

const cache = new Map<string, Throwing>()

/** a piece of the board: radii r0 to r1 (mm) and angles a0 to a1 (degrees clockwise from the top) */
interface Shape {
  r0: number
  r1: number
  a0: number
  a1: number
}

/** the pieces of the board a region covers */
export function shapesOf(r: Region): Shape[] {
  if (r === BULL) return [{ r0: 0, r1: R_BULL, a0: 0, a1: 360 }]
  if (r === OUTER_BULL) return [{ r0: R_BULL, r1: R_OUTER_BULL, a0: 0, a1: 360 }]
  if (r === MISS) return []
  const n = r <= 20 ? r : r <= 40 ? r - 20 : r - 40
  const a0 = numberAngle(n) - 9
  const a1 = a0 + 18
  if (r <= 20)
    return [
      { r0: R_OUTER_BULL, r1: R_TREBLE_IN, a0, a1 },
      { r0: R_TREBLE_OUT, r1: R_DOUBLE_IN, a0, a1 },
    ]
  if (r <= 40) return [{ r0: R_DOUBLE_IN, r1: R_DOUBLE_OUT, a0, a1 }]
  return [{ r0: R_TREBLE_IN, r1: R_TREBLE_OUT, a0, a1 }]
}

/** how a shape is cut into polar cells: nr rings of dr (mm) by na sectors of da (degrees) */
interface Grid {
  s: Shape
  nr: number
  na: number
  dr: number
  da: number
}
function gridOf(s: Shape, sigma: number): Grid {
  const nr = Math.max(1, Math.ceil((s.r1 - s.r0) / Math.min(DR, sigma / 24)))
  // the bulls are small: a coarser angle is still far finer than their size
  const na = Math.max(1, Math.round((s.a1 - s.a0) / (s.r1 <= R_OUTER_BULL ? 2 : DA)))
  return { s, nr, na, dr: (s.r1 - s.r0) / nr, da: (s.a1 - s.a0) / na }
}

/**
 * The polar cells of a shape and each one's probability under the scatter (density at the cell's middle times its
 * area), cell (i, j) being ring i and sector j. `visit` gets each cell's index (i * na + j) and weight.
 */
function cellsOf(g: Grid, aim: { x: number; y: number }, sigma: number, visit: (k: number, w: number) => void) {
  const { s, nr, na, dr, da } = g
  const k = 1 / (2 * Math.PI * sigma * sigma)
  const two = 2 * sigma * sigma
  const sector = (da * Math.PI) / 180
  for (let i = 0; i < nr; i++) {
    const r0 = s.r0 + i * dr
    const rm = r0 + dr / 2
    // the cell's area: (r1² - r0²)/2 times its angle in radians
    const area = (((r0 + dr) ** 2 - r0 * r0) / 2) * sector
    for (let j = 0; j < na; j++) {
      const am = ((s.a0 + (j + 0.5) * da) * Math.PI) / 180
      const dx = rm * Math.sin(am) - aim.x
      const dy = rm * Math.cos(am) - aim.y
      visit(i * na + j, k * Math.exp(-(dx * dx + dy * dy) / two) * area)
    }
  }
}

/** a region's cells laid end to end over its shapes, with their weights' running sum (made when first needed) */
const places = new Map<string, { grids: Grid[]; cum: Float64Array }>()
function placesOf(t: Throwing, r: Region) {
  const key = `${t.target}:${t.thrower}:${r}`
  const hit = places.get(key)
  if (hit) return hit
  const grids = shapesOf(r).map((s) => gridOf(s, t.sigma))
  const cum = new Float64Array(grids.reduce((a, g) => a + g.nr * g.na, 0))
  let run = 0
  let base = 0
  for (const g of grids) {
    cellsOf(g, t.aim, t.sigma, (k, w) => (cum[base + k] = run += w))
    base += g.nr * g.na
  }
  const out = { grids, cum }
  places.set(key, out)
  return out
}

/** a payout rounded to a tidy step: 0.01 under 2, 0.05 under 10, 0.5 under 50, 1 under 200, then 5, 25, 100 */
export function tidy(m: number): number {
  const step = m < 2 ? 0.01 : m < 10 ? 0.05 : m < 50 ? 0.5 : m < 200 ? 1 : m < 1000 ? 5 : m < 5000 ? 25 : 100
  return Math.round(Math.round(m / step) * step * 100) / 100
}

/** the paytable for a round distribution: below par nothing, from par up c / T^GAMMA (tidied, capped) */
function solvePays(total: Float64Array, tail: Float64Array) {
  let par = 0
  while (par < MAX_TOTAL && tail[par + 1] >= TOP_SHARE) par++
  // par is the largest total whose tail is still at least TOP_SHARE
  const build = (c: number) => {
    const pays = new Float64Array(MAX_TOTAL + 1)
    let last = 0
    for (let s = par; s <= MAX_TOTAL; s++) {
      // totals that can't be scored still get a payout in line with their neighbours (never shown in play)
      const m = Math.min(MAX_MULT, tidy(c / Math.max(tail[s], 1e-12) ** GAMMA))
      last = Math.max(last, m)
      pays[s] = last
    }
    let rtp = 0
    for (let s = 0; s <= MAX_TOTAL; s++) rtp += total[s] * pays[s]
    return { pays, rtp }
  }
  // the return grows with c: find the largest c whose tidied table does not go over RTP
  let lo = 0
  let hi = 10
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (build(mid).rtp <= RTP) lo = mid
    else hi = mid
  }
  return { par, ...build(lo) }
}

/** the exact odds and paytable of a target and thrower (worked out once, then kept) */
export function throwing(target: TargetId, thrower: ThrowerId): Throwing {
  const key = `${target}:${thrower}`
  const hit = cache.get(key)
  if (hit) return hit
  const aim = TARGETS.find((t) => t.id === target)!.aim
  const sigma = THROWERS.find((t) => t.id === thrower)!.sigma
  const region = new Float64Array(REGIONS)
  let board = 0
  for (let r = 1; r < REGIONS; r++) {
    for (const s of shapesOf(r)) cellsOf(gridOf(s, sigma), aim, sigma, (_k, w) => (region[r] += w))
    board += region[r]
  }
  // the scatter off the board is a miss; the board's integral can't exceed 1 by more than the quadrature's error
  region[MISS] = Math.max(0, 1 - board)
  if (board > 1) for (let r = 1; r < REGIONS; r++) region[r] /= board
  const dart = new Float64Array(61)
  for (let r = 0; r < REGIONS; r++) dart[regionScore(r)] += region[r]
  let total = new Float64Array([1])
  for (let d = 0; d < DARTS; d++) {
    const next = new Float64Array(total.length + 60)
    for (let a = 0; a < total.length; a++) if (total[a]) for (let b = 0; b <= 60; b++) next[a + b] += total[a] * dart[b]
    total = next
  }
  const tail = new Float64Array(MAX_TOTAL + 2)
  for (let s = MAX_TOTAL; s >= 0; s--) tail[s] = tail[s + 1] + total[s]
  const { par, pays, rtp } = solvePays(total, tail)
  let top = MAX_TOTAL
  while (top > par && total[top] < TOP_ODDS) top--
  const t: Throwing = { target, thrower, region, dart, total, tail, pays, par, top, rtp, aim, sigma }
  cache.set(key, t)
  return t
}

/* ---------------- a round ---------------- */

export interface Dart {
  region: Region
  score: number
  /** where it sticks in the board, mm, x right and y up */
  x: number
  y: number
}

export interface Round {
  darts: Dart[]
  total: number
  /** what the round pays, times the stake */
  mult: number
}

/** draws one region from a table of probabilities */
function drawRegion(p: Float64Array, u: number): Region {
  let x = u
  for (let r = 0; r < p.length; r++) if ((x -= p[r]) < 0 && p[r] > 0) return r
  // rounding left a sliver: the likeliest region
  let best = 0
  for (let r = 1; r < p.length; r++) if (p[r] > p[best]) best = r
  return best
}

/**
 * A spot inside region r for the dart to stick in: a cell of the region by its weight, then a point in the cell, even
 * by area. A miss is a spot off the board drawn from the scatter itself.
 */
function placeIn(t: Throwing, r: Region, rng: () => number): { x: number; y: number } {
  const { aim, sigma } = t
  if (r === MISS) {
    for (let i = 0; i < 200_000; i++) {
      const u = Math.sqrt(-2 * Math.log(1 - rng()))
      const v = 2 * Math.PI * rng()
      const x = aim.x + sigma * u * Math.cos(v)
      const y = aim.y + sigma * u * Math.sin(v)
      if (classify(x, y) === MISS) return { x, y }
    }
    // a miss so unlikely the scatter never finds one: just off the board, beyond the aim
    const a = Math.atan2(aim.x, aim.y) || 0
    return { x: (R_DOUBLE_OUT + 8) * Math.sin(a), y: (R_DOUBLE_OUT + 8) * Math.cos(a) }
  }
  const { grids, cum } = placesOf(t, r)
  // the first cell whose running weight passes u, by a binary search
  const u = rng() * cum[cum.length - 1]
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (cum[mid] > u) hi = mid
    else lo = mid + 1
  }
  let g = grids[0]
  for (const x of grids) {
    if (lo < x.nr * x.na) {
      g = x
      break
    }
    lo -= x.nr * x.na
  }
  const i = Math.floor(lo / g.na)
  const j = lo % g.na
  const r0 = g.s.r0 + i * g.dr
  const r1 = r0 + g.dr
  const a0 = g.s.a0 + j * g.da
  const a1 = a0 + g.da
  // even by area within the cell: the radius by its square
  const rr = Math.sqrt(r0 * r0 + rng() * (r1 * r1 - r0 * r0))
  const aa = ((a0 + rng() * (a1 - a0)) * Math.PI) / 180
  const x = rr * Math.sin(aa)
  const y = rr * Math.cos(aa)
  // a point on a wire (the cell's very edge) could read as the neighbour: keep it a hair inside
  if (classify(x, y) === r) return { x, y }
  const rm = (r0 + r1) / 2
  const am = (((a0 + a1) / 2) * Math.PI) / 180
  return { x: rm * Math.sin(am), y: rm * Math.cos(am) }
}

/** a whole round, from a source of uniform numbers in [0, 1) */
export function drawRound(target: TargetId, thrower: ThrowerId, rng: () => number): Round {
  const t = throwing(target, thrower)
  const darts: Dart[] = []
  for (let d = 0; d < DARTS; d++) {
    const region = drawRegion(t.region, rng())
    const at = placeIn(t, region, rng)
    darts.push({ region, score: regionScore(region), x: at.x, y: at.y })
  }
  const total = darts.reduce((a, d) => a + d.score, 0)
  return { darts, total, mult: t.pays[total] }
}

/** what the round pays for a stake */
export const payout = (stake: number, round: Round) => Math.round(stake * round.mult * 100) / 100

/**
 * What the darts thrown so far can still come to: for each total the round could end on, its chance, given the first
 * k darts. The screen uses it to show what the next dart needs.
 */
export function outlook(t: Throwing, sofar: number, left: number): Float64Array {
  let dist = new Float64Array(sofar + 1)
  dist[sofar] = 1
  for (let d = 0; d < left; d++) {
    const next = new Float64Array(dist.length + 60)
    for (let a = 0; a < dist.length; a++) if (dist[a]) for (let b = 0; b <= 60; b++) next[a + b] += dist[a] * t.dart[b]
    dist = next
  }
  return dist
}
