import { ITEM_KINDS, VALUE, type DropResult, type Feature, type ItemKind, type PusherMeta } from './types'

/*
  Coin Cascade's rules: what a drop can bring and how often, decided before the machine moves.

  A drop costs the stake. What falls into the tray is drawn first, from a table of outcomes: each outcome is a set of
  things that go over the front edge (so many silver coins, so many gold coins, maybe a prize) and the drop's special
  moment, if any (a Coin Shower or a Quake). Each outcome has a whole number of ways out of DRAW, the ways add up to
  DRAW exactly, and the ways times the multipliers add up to exactly RTP × DRAW, so the game returns exactly 97% before
  payouts are rounded down to the cent. An outcome pays the sum of what falls (VALUE: a silver coin is a quarter of the
  stake, a gold coin the stake, a gem 5×, a gold bar 25×, the Golden Idol 100×, the Crown 500×).

  The table is a coin pusher's rhythm: a little over half the drops push nothing over; most wins are a few silver
  coins, gold coins come about one drop in four, a gem about one in thirty, a gold bar about one in three hundred,
  the Idol about one in four thousand and the Crown about one in thirty thousand. A Coin Shower (the hopper pours a
  stream of coins onto the lower tier and a crowd of them goes over) comes about one drop in twenty-three, a Quake (the
  machine shudders, the pushers surge and a lot goes over, often with a prize) about one in sixty-six. Nothing in the
  table puts more than 21 things over the edge at once, never more of a prize than the field holds (two gems, one of
  each other prize), and the top win is the Crown and the Idol together in a Quake: 612.5×.

  Then the machine (sim.ts) acts out exactly that result. Where the player aims changes how the drop looks, never
  what it pays. (tools/pusher-test.ts checks the sums, the paytable and samples the draw.)
*/

export const RTP = 0.97

export interface Outcome {
  wins: Record<ItemKind, number>
  feature: Feature
  ways: number
}

/** an outcome: the feature, its ways, then how many of each go over (silver, gold, gem, bar, idol, crown) */
const o = (feature: Feature, ways: number, silver = 0, gold = 0, gem = 0, bar = 0, idol = 0, crown = 0): Outcome => ({
  wins: { silver, gold, gem, bar, idol, crown },
  feature,
  ways,
})

/** the draw is a whole number in [0, DRAW): the outcome whose ways it falls in */
export const DRAW = 1_000_000

/* the winning outcomes (the losing one, nothing over the edge, takes the rest of the draw) */
const WINS: readonly Outcome[] = [
  // a plain drop: a few coins, now and then a prize
  o('none', 54_218, 1),
  o('none', 42_000, 2),
  o('none', 33_000, 3),
  o('none', 25_000, 4),
  o('none', 13_000, 5),
  o('none', 6_000, 6),
  o('none', 50_000, 0, 1),
  o('none', 36_000, 1, 1),
  o('none', 26_000, 2, 1),
  o('none', 16_000, 3, 1),
  o('none', 8_000, 4, 1),
  o('none', 18_000, 0, 2),
  o('none', 14_000, 1, 2),
  o('none', 10_000, 2, 2),
  o('none', 6_000, 3, 2),
  o('none', 3_000, 1, 3),
  o('none', 2_000, 3, 3),
  o('none', 9_500, 0, 0, 1),
  o('none', 6_500, 1, 0, 1),
  o('none', 4_000, 2, 0, 1),
  o('none', 3_000, 1, 1, 1),
  o('none', 1_500, 3, 1, 1),
  o('none', 850, 0, 0, 0, 1),
  o('none', 600, 2, 0, 0, 1),
  o('none', 350, 2, 1, 0, 1),
  o('none', 80, 1, 0, 0, 0, 1),
  o('none', 50, 3, 1, 0, 0, 1),
  o('none', 12, 1, 0, 0, 0, 0, 1),
  o('none', 8, 3, 1, 0, 0, 0, 1),
  // a Coin Shower: the hopper pours and a crowd of coins goes over
  o('shower', 10_400, 6, 1),
  o('shower', 9_100, 8, 1),
  o('shower', 6_500, 7, 2),
  o('shower', 5_200, 9, 2),
  o('shower', 3_250, 10, 3),
  o('shower', 1_950, 12, 3),
  o('shower', 1_040, 11, 4),
  o('shower', 520, 14, 4),
  o('shower', 2_600, 6, 1, 1),
  o('shower', 1_560, 8, 2, 1),
  o('shower', 780, 10, 3, 1),
  o('shower', 260, 8, 2, 2),
  o('shower', 520, 8, 2, 0, 1),
  o('shower', 130, 10, 3, 1, 1),
  o('shower', 40, 8, 2, 0, 0, 1),
  o('shower', 10, 10, 3, 1, 0, 1),
  o('shower', 4, 8, 2, 0, 0, 1, 1),
  // a Quake: the pushers surge and a lot goes over, often with a prize
  o('quake', 4_050, 10, 2),
  o('quake', 3_375, 12, 3),
  o('quake', 2_025, 14, 4),
  o('quake', 1_080, 16, 5),
  o('quake', 2_025, 10, 2, 1),
  o('quake', 1_350, 12, 3, 1),
  o('quake', 405, 12, 3, 2),
  o('quake', 540, 12, 3, 0, 1),
  o('quake', 200, 14, 4, 1, 1),
  o('quake', 70, 12, 3, 2, 1),
  o('quake', 40, 12, 3, 0, 0, 1),
  o('quake', 15, 14, 4, 1, 1, 1),
  o('quake', 5, 12, 3, 0, 0, 0, 1),
  o('quake', 3, 14, 4, 1, 0, 1, 1),
]

/** every outcome, the losing one first; Σ ways = DRAW and Σ ways × mult = RTP × DRAW exactly */
export const OUTCOMES: readonly Outcome[] = [o('none', DRAW - WINS.reduce((a, x) => a + x.ways, 0)), ...WINS]

/** what a set of things in the tray pays, times the stake (every value is a whole number of quarters, so this is exact) */
export const multOf = (wins: Record<ItemKind, number>) => ITEM_KINDS.reduce((a, k) => a + wins[k] * VALUE[k], 0)

/** the biggest multiplier in the table */
export const MAX_MULT = Math.max(...OUTCOMES.map((x) => multOf(x.wins)))

/** the draw for u in [0, 1): a whole number in [0, DRAW) */
export const drawWays = (u: number) => Math.min(DRAW - 1, Math.max(0, Math.floor(u * DRAW)))

/** the outcome a whole number of the draw falls in */
export function outcomeAt(k: number): Outcome {
  let x = k
  for (const it of OUTCOMES) {
    if (x < it.ways) return it
    x -= it.ways
  }
  return OUTCOMES[OUTCOMES.length - 1]
}

/** a drop's result from one uniform number u in [0, 1) (the page passes rand()) */
export function drawDrop(u: number): DropResult {
  const it = outcomeAt(drawWays(u))
  return { wins: { ...it.wins }, mult: multOf(it.wins), feature: it.feature }
}

/** a result from its parts (the dev labs and tests force one) */
export const resultOf = (wins: Partial<Record<ItemKind, number>>, feature: Feature = 'none'): DropResult => {
  const w = { silver: 0, gold: 0, gem: 0, bar: 0, idol: 0, crown: 0, ...wins }
  return { wins: w, mult: multOf(w), feature }
}

/** what a drop pays for a stake, rounded down to the cent (the tiny allowance keeps 0.7 × 3 from landing on 2.0999…) */
export const payoutOf = (stake: number, r: DropResult) => Math.floor(stake * r.mult * 100 + 1e-6) / 100

/** what a settled drop tells the wallet */
export const metaOf = (r: DropResult): PusherMeta => ({ ...r.wins, mult: r.mult, feature: r.feature })

/** how many things go over the edge in a result */
export const itemsOf = (wins: Record<ItemKind, number>) => ITEM_KINDS.reduce((a, k) => a + wins[k], 0)

/* ---------------- the paytable ---------------- */

export interface PayRow {
  kind: ItemKind
  /** what one pays, times the stake */
  value: number
  /** the ways out of DRAW that at least one falls in a drop, and that as a chance */
  ways: number
  chance: number
}

const waysWhere = (f: (x: Outcome) => boolean) => OUTCOMES.reduce((a, x) => a + (f(x) ? x.ways : 0), 0)
const row = (kind: ItemKind): PayRow => {
  const ways = waysWhere((x) => x.wins[kind] > 0)
  return { kind, value: VALUE[kind], ways, chance: ways / DRAW }
}

/** the page's paytable: each thing's value and the chance of seeing at least one fall in a drop, and the rest */
export const PAYTABLE = {
  rows: ITEM_KINDS.map(row) as readonly PayRow[],
  /** the chance a drop pays anything */
  anyWin: waysWhere((x) => itemsOf(x.wins) > 0) / DRAW,
  shower: waysWhere((x) => x.feature === 'shower') / DRAW,
  quake: waysWhere((x) => x.feature === 'quake') / DRAW,
  /** the top win, times the stake */
  top: MAX_MULT,
  rtp: RTP,
}

/** "1 in 29.5", "1 in 4,132", "44.77%" (chances of one in five or better are shown as percentages) */
export function oddsLabel(chance: number): string {
  if (chance >= 0.2) return `${(chance * 100).toFixed(2)}%`
  const n = 1 / chance
  return `1 in ${n < 100 ? n.toFixed(1) : Math.round(n).toLocaleString('en-US')}`
}
