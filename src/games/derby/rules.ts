/*
  Duck Derby rules: six ducks, fresh win chances every race, and three kinds of bet.

  Before each race the fixed set of chances (32/22/16/12/10/8%) is dealt to the ducks at random, so the favourite
  changes from race to race. The whole finishing order is drawn up front by successive weighted sampling (Harville):
  the winner is picked by the chances, then second place from the ducks left with their chances renormalised, and so
  on down to sixth. Every bet pays RTP / its exact probability under that model:
    Win       the duck finishes first                P = p_i
    Place     the duck finishes first or second      P = p_i + sum over j != i of p_j * p_i / (1 - p_j)
    Forecast  a then b, in that exact order          P = p_a * p_b / (1 - p_a)
  so every bet returns exactly 97% (tools/derby-test.ts enumerates all 720 orders with exact fractions).
*/
import { round2 } from '../../lib/format'

export const RTP = 0.97
/** the chances dealt each race, in whole percent (they add up to 100) */
export const CHANCES = [32, 22, 16, 12, 10, 8] as const
/** a Win bet at these odds or longer counts as a long shot (the Long Shot challenge) */
export const LONGSHOT = 8
export const MAX_BETS = 12

export interface Duck {
  name: string
  /** body colour, its highlight and its shade */
  color: string
  light: string
  dark: string
  /** a word for the race card */
  trait: string
  blurb: string
}

/** in lane order: lane 1 is the far lane, lane 6 the near one */
export const DUCKS: Duck[] = [
  { name: 'Quackers', color: '#ffd23f', light: '#fff1a8', dark: '#e7a417', trait: 'Crowd favourite', blurb: 'Loud, proud and never rattled. Quacks at the start horn every single time.' },
  { name: 'Puddles', color: '#5cc6ff', light: '#c4ecff', dark: '#2a8fd6', trait: 'Loves rough water', blurb: 'The wetter the better. Splashes through rapids like they are a warm bath.' },
  { name: 'Sir Waddles', color: '#a984ff', light: '#e2d4ff', dark: '#7451d8', trait: 'Old money', blurb: 'Refuses to hurry on principle. Somehow still turns up at the front.' },
  { name: 'Bubbles', color: '#ff86c8', light: '#ffd3ec', dark: '#e0509f', trait: 'Pure chaos', blurb: 'Blows bubbles on the start line and forgets which way the finish is.' },
  { name: 'Dash', color: '#46dd8c', light: '#c2f7d9', dark: '#1ea862', trait: 'Built for speed', blurb: 'Goggles on, scarf flying. Brakes were never part of the plan.' },
  { name: 'Nugget', color: '#ffa63d', light: '#ffdcae', dark: '#e2741a', trait: 'Small but mighty', blurb: 'The smallest duck in the field, with a propeller hat and the biggest heart.' },
]
export const LANES = DUCKS.length

export type BetKind = 'win' | 'place' | 'forecast'
/** a bet on lane a (and, for a forecast, lane b second) */
export interface Bet {
  kind: BetKind
  a: number
  b?: number
}

export const betKey = (b: Bet) => (b.kind === 'forecast' ? `forecast:${b.a}>${b.b}` : `${b.kind}:${b.a}`)

/** deals the chances to the lanes at random: the result is each lane's chance in whole percent */
export function dealChances(rand: () => number): number[] {
  const c: number[] = [...CHANCES]
  for (let i = c.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[c[i], c[j]] = [c[j], c[i]]
  }
  return c
}

/** chances as probabilities */
export const probs = (chances: readonly number[]) => chances.map((c) => c / 100)

export function winProb(p: readonly number[], i: number) {
  return p[i]
}

export function placeProb(p: readonly number[], i: number) {
  let s = p[i]
  for (let j = 0; j < p.length; j++) if (j !== i) s += (p[j] * p[i]) / (1 - p[j])
  return s
}

export function forecastProb(p: readonly number[], a: number, b: number) {
  return a === b ? 0 : (p[a] * p[b]) / (1 - p[a])
}

export function betProb(p: readonly number[], bet: Bet) {
  if (bet.kind === 'win') return winProb(p, bet.a)
  if (bet.kind === 'place') return placeProb(p, bet.a)
  return forecastProb(p, bet.a, bet.b ?? -1)
}

/** the exact multiplier a bet pays: RTP / P */
export function betMult(p: readonly number[], bet: Bet) {
  return RTP / betProb(p, bet)
}

/** the finishing order (lanes, first to last) by successive weighted sampling */
export function drawOrder(p: readonly number[], rand: () => number): number[] {
  const left = p.map((_, i) => i)
  const order: number[] = []
  while (left.length > 1) {
    let total = 0
    for (const i of left) total += p[i]
    let r = rand() * total
    let k = 0
    for (; k < left.length - 1; k++) {
      r -= p[left[k]]
      if (r < 0) break
    }
    order.push(left[k])
    left.splice(k, 1)
  }
  order.push(left[0])
  return order
}

export function betWins(bet: Bet, order: readonly number[]) {
  if (bet.kind === 'win') return order[0] === bet.a
  if (bet.kind === 'place') return order[0] === bet.a || order[1] === bet.a
  return order[0] === bet.a && order[1] === bet.b
}

/** what a bet of `stake` returns for this finishing order (0 if it lost) */
export function betPayout(p: readonly number[], bet: Bet, stake: number, order: readonly number[]) {
  return betWins(bet, order) ? round2(stake * betMult(p, bet)) : 0
}

/** the most a slip can return: its best finishing order (every bet is decided by the first two home, so 30 pairs) */
export function bestReturn(p: readonly number[], bets: readonly Bet[], stake: number) {
  let best = 0
  for (let a = 0; a < p.length; a++)
    for (let b = 0; b < p.length; b++) {
      if (a === b) continue
      let s = 0
      for (const bet of bets) s += betPayout(p, bet, stake, [a, b])
      if (s > best) best = s
    }
  return round2(best)
}

/** odds as the site writes them: 3.03×, 12.13×, 111.5× */
export function oddsLabel(m: number) {
  return m >= 100 ? `${m.toFixed(1)}×` : `${m.toFixed(2)}×`
}

export const ordinal = (n: number) => ['1st', '2nd', '3rd', '4th', '5th', '6th'][n] ?? `${n + 1}th`
