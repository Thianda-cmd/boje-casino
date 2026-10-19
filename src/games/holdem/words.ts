import { HAND_NAMES, HAND_ORDER, evaluate, rankOf, suitOf, type Card, type Eval, type HandRank } from './rules'

/*
  Hold'em Showdown in words: a hand as people say it ("Flush, ace high", "Two pair, kings and sevens", "Pair of
  nines"), split into a title and a detail for the two-line tags on the table, and the hole cards before the flop
  ("Pocket aces", "Ace-king suited"). Also the paytables' rows and odds, worded once for the felt, the verdict and the
  rules.
*/

const ONE = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace']
const MANY = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces']
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export interface HandWords {
  /** the kind of hand: "Flush", "Two pair" */
  title: string
  /** what decides it: "ace high", "kings and sevens" (empty for a royal) */
  detail: string
  /** the two together as a sentence's worth: "Flush, ace high", "Pair of nines" */
  full: string
}

/** a made hand (five to seven cards evaluated) in words */
export function handWords(e: Eval): HandWords {
  const r = (i: number) => rankOf(e.best[i])
  const w = (title: string, detail: string, full = detail ? `${title}, ${detail}` : title): HandWords => ({ title, detail, full })
  switch (e.rank) {
    case 'royal':
      return w('Royal flush', '')
    case 'straightFlush':
      return w('Straight flush', `${ONE[r(0)]} high`)
    case 'quads':
      return w('Four of a kind', MANY[r(0)])
    case 'fullHouse':
      return w('Full house', `${MANY[r(0)]} over ${MANY[r(3)]}`)
    case 'flush':
      return w('Flush', `${ONE[r(0)]} high`)
    case 'straight':
      return w('Straight', `${ONE[r(0)]} high`)
    case 'trips':
      return w('Three of a kind', MANY[r(0)])
    case 'twoPair':
      return w('Two pair', `${MANY[r(0)]} and ${MANY[r(2)]}`)
    case 'pair':
      return w('Pair', MANY[r(0)], `Pair of ${MANY[r(0)]}`)
    default:
      return w('High card', ONE[r(0)], `${cap(ONE[r(0)])} high`)
  }
}

/** the player's hand from the cards they can see: the hole cards alone before the flop, then with the board */
export function liveWords(hole: readonly Card[], board: readonly Card[]): HandWords {
  if (board.length) return handWords(evaluate([...hole, ...board]))
  const [a, b] = hole
  const hi = Math.max(rankOf(a), rankOf(b))
  const lo = Math.min(rankOf(a), rankOf(b))
  if (hi === lo) return { title: 'Pocket pair', detail: MANY[hi], full: `Pocket ${MANY[hi]}` }
  const title = `${cap(ONE[hi])}-${ONE[lo]}`
  const detail = suitOf(a) === suitOf(b) ? 'suited' : 'offsuit'
  return { title, detail, full: `${title} ${detail}` }
}

/** a short name for the history pills: "Flush", "Two pair", "Ace high" */
export const shortName = (rank: HandRank) => (rank === 'high' ? 'High card' : HAND_NAMES[rank])

/** flush or better: the hands that get their moment on the table */
export const isBigHand = (rank: HandRank) => HAND_ORDER.indexOf(rank) >= HAND_ORDER.indexOf('flush')

/** the rows of both paytables, best first (each table prints the rows it pays) */
export const PAY_ROWS: readonly { rank: HandRank; name: string }[] = [
  { rank: 'royal', name: 'Royal flush' },
  { rank: 'straightFlush', name: 'Straight flush' },
  { rank: 'quads', name: 'Four of a kind' },
  { rank: 'fullHouse', name: 'Full house' },
  { rank: 'flush', name: 'Flush' },
  { rank: 'straight', name: 'Straight' },
  { rank: 'trips', name: 'Three of a kind' },
]

/** a payout's odds in words: "3 to 2", "50 to 1"; the felt prints them with a colon ("3 : 2") */
export const oddsWords = (x: number, sep = 'to') => (x === 1.5 ? `3 ${sep} 2` : `${x} ${sep} 1`)
