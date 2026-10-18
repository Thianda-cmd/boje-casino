import { fmt } from '../../lib/format'
import { LUCKY_MULTS, SINGLE_ODDS, STRUCK_CHANCE, luckyKindOf, spotMax, spotOf, spotRtp, winChance, type BetKey } from './rules'

/*
  How the screen talks about a spot: its odds as printed on the felt, the percentages, and the few lines of the hover
  tooltip. Kept in one place so the table, the tooltip and the paytable always agree.
*/

/** odds as the felt prints them: "5:1" */
export const oddsText = (n: number) => `${n >= 1000 ? fmt(n, 0) : n}:1`
/** a chance as a percentage, to one decimal (two below 1%) */
export const pct = (p: number) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`
/** a return as a percentage, two decimals */
export const rtpText = (r: number) => `${(r * 100).toFixed(2)}%`
/** the top multiplier a lucky spot can be struck with */
export const topMult = (key: BetKey) => {
  const s = spotOf(key)
  return s.lucky ? Math.max(...LUCKY_MULTS[luckyKindOf(s)].map((m) => m.mult)) : 1
}

/** a spot's name as the tooltip, the screen reader and the paytable say it */
export const spotTitle = (key: BetKey) => {
  const s = spotOf(key)
  return s.kind === 'combo' ? `Combination ${s.label}` : s.label
}

/** the lines of a spot's tooltip; `mult` is the strike on it this round, if any */
export function spotTip(key: BetKey, mult = 1): { title: string; lines: string[] } {
  const s = spotOf(key)
  const lines: string[] = []
  const chance = winChance(key)
  if (s.kind === 'single') {
    lines.push(`Pays ${SINGLE_ODDS[1]}:1 on one die, ${SINGLE_ODDS[2]}:1 on two, ${SINGLE_ODDS[3]}:1 on three`)
    lines.push(`Shows on at least one die ${pct(chance)} of rolls`)
  } else {
    const what =
      s.kind === 'small'
        ? 'Total 4 to 10, not a triple'
        : s.kind === 'big'
          ? 'Total 11 to 17, not a triple'
          : s.kind === 'odd'
            ? 'An odd total, not a triple'
            : s.kind === 'even'
              ? 'An even total, not a triple'
              : null
    if (what) lines.push(what)
    lines.push(`Pays ${oddsText(s.odds)} · wins ${pct(chance)} (${s.ways} of 216)`)
  }
  if (s.lucky) {
    if (mult > 1) lines.push(`Struck ×${mult}: pays ${oddsText(s.odds * mult)} this roll`)
    else lines.push(`Lucky strike ${pct(STRUCK_CHANCE[key])} of rolls, up to ×${topMult(key)} (${oddsText(s.odds * topMult(key))})`)
  }
  lines.push(`Max ${fmt(spotMax(key), 0)}× · limit ${fmt(s.limit, 0)} · returns ${rtpText(spotRtp(key))}`)
  return { title: spotTitle(key), lines }
}
