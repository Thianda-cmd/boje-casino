import { shuffle } from '../../lib/rng'

/*
  Punto Banco on an 8-deck shoe. Pure rules: the cards, the drawing tableau, the bets and the shoe. Nothing here
  touches React, so tools/baccarat-test.ts runs it under Node.

  A round is dealt Player, Banker, Player, Banker. A natural (8 or 9 on two cards, either side) ends it. Otherwise
  the Player draws on 0-5 and stands on 6-7. A Banker whose Player stood draws on 0-5 too; after a Player third
  card the Banker follows the tableau in bankerDraws(). Tens and court cards count 0, aces 1, totals are mod 10.

  Bets: Player 1:1, Banker 0.95:1 (5% commission), Tie 8:1 (Player and Banker push on a tie), Player Pair and
  Banker Pair 11:1 (the first two cards of that hand share a rank). Exact house edges (tools/baccarat-test.ts):
  Banker 1.06%, Player 1.24%, Tie 14.36%, each pair 10.36%.

  The shoe is shuffled, the first card is turned up and that many more cards are burned (court cards and tens burn
  10), and a cut card goes in 14 to 26 cards from the end. Once it comes out one more round is dealt (the last hand),
  then the shoe is shuffled.
*/

export const SUITS = ['♠', '♥', '♦', '♣'] as const
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export type Suit = (typeof SUITS)[number]
export type Rank = (typeof RANKS)[number]
/** Same shape as the blackjack table's card, so its card art and flights can be shared. */
export interface Card {
  rank: Rank
  suit: Suit
  id: number
}

export const DECKS = 8
export const SHOE_SIZE = DECKS * 52
/** the cut card sits this many cards from the end of the shoe (inclusive range) */
export const CUT_MIN = 14
export const CUT_MAX = 26

/** Baccarat points of a card: ace 1, two to nine face value, tens and court cards 0. */
export const points = (c: { rank: Rank }) => {
  const i = RANKS.indexOf(c.rank)
  return i >= 9 ? 0 : i + 1
}
export const handTotal = (cards: { rank: Rank }[]) => cards.reduce((t, c) => t + points(c), 0) % 10

/** Player draws a third card on 0-5. */
export const playerDraws = (total: number) => total <= 5

/**
 * The Banker's tableau. `third` is the points of the Player's third card, or null when the Player stood
 * (then the Banker plays like the Player: draws on 0-5).
 */
export function bankerDraws(total: number, third: number | null): boolean {
  if (third === null) return total <= 5
  switch (total) {
    case 0:
    case 1:
    case 2:
      return true
    case 3:
      return third !== 8
    case 4:
      return third >= 2 && third <= 7
    case 5:
      return third >= 4 && third <= 7
    case 6:
      return third === 6 || third === 7
    default:
      return false
  }
}

export type Side = 'P' | 'B'
export type Winner = 'P' | 'B' | 'T'

export interface Round {
  player: Card[]
  banker: Card[]
  /** every card in the order it came out of the shoe, with the hand it went to */
  order: { side: Side; card: Card }[]
  pTotal: number
  bTotal: number
  winner: Winner
  /** either hand had 8 or 9 on its first two cards */
  natural: boolean
  pPair: boolean
  bPair: boolean
}

/** Plays one round from a card source (the shoe's next card each call). */
export function playRound(next: () => Card): Round {
  const order: Round['order'] = []
  const player: Card[] = []
  const banker: Card[] = []
  const give = (side: Side) => {
    const card = next()
    ;(side === 'P' ? player : banker).push(card)
    order.push({ side, card })
    return card
  }
  give('P')
  give('B')
  give('P')
  give('B')
  const p2 = handTotal(player)
  const b2 = handTotal(banker)
  const natural = p2 >= 8 || b2 >= 8
  if (!natural) {
    let third: number | null = null
    if (playerDraws(p2)) third = points(give('P'))
    if (bankerDraws(b2, third)) give('B')
  }
  const pTotal = handTotal(player)
  const bTotal = handTotal(banker)
  return {
    player,
    banker,
    order,
    pTotal,
    bTotal,
    winner: pTotal > bTotal ? 'P' : bTotal > pTotal ? 'B' : 'T',
    natural,
    pPair: player[0].rank === player[1].rank,
    bPair: banker[0].rank === banker[1].rank,
  }
}

/* ------------------------------------------------------------------ */
/*  Bets                                                                */
/* ------------------------------------------------------------------ */

export const BET_KEYS = ['pPair', 'player', 'tie', 'banker', 'bPair'] as const
export type BetKey = (typeof BET_KEYS)[number]
export type Bets = Partial<Record<BetKey, number>>

export const BET_INFO: Record<BetKey, { name: string; short: string; pays: string; limit: number }> = {
  player: { name: 'Player', short: 'Player', pays: '1 : 1', limit: 10_000 },
  banker: { name: 'Banker', short: 'Banker', pays: '0.95 : 1', limit: 10_000 },
  tie: { name: 'Tie', short: 'Tie', pays: '8 : 1', limit: 2_000 },
  pPair: { name: 'Player Pair', short: 'P Pair', pays: '11 : 1', limit: 1_000 },
  bPair: { name: 'Banker Pair', short: 'B Pair', pays: '11 : 1', limit: 1_000 },
}
export const TABLE_MIN = 1
export const TABLE_MAX = 10_000

export type BetOutcome = 'win' | 'push' | 'lose'

/** What one unit staked on `key` returns, stake included: 0 (lost), 1 (push), 1.95, 2, 9 or 12. */
export function returnOf(key: BetKey, r: Pick<Round, 'winner' | 'pPair' | 'bPair'>): number {
  switch (key) {
    case 'player':
      return r.winner === 'P' ? 2 : r.winner === 'T' ? 1 : 0
    case 'banker':
      return r.winner === 'B' ? 1.95 : r.winner === 'T' ? 1 : 0
    case 'tie':
      return r.winner === 'T' ? 9 : 0
    case 'pPair':
      return r.pPair ? 12 : 0
    case 'bPair':
      return r.bPair ? 12 : 0
  }
}

export const outcomeOf = (key: BetKey, r: Pick<Round, 'winner' | 'pPair' | 'bPair'>): BetOutcome => {
  const m = returnOf(key, r)
  return m > 1 ? 'win' : m === 1 ? 'push' : 'lose'
}

const cents = (n: number) => Math.round(n * 100) / 100

export const betTotal = (bets: Bets) => cents(BET_KEYS.reduce((t, k) => t + (bets[k] ?? 0), 0))

/** Total returned for a set of bets, and what each bet returned. */
export function payBets(bets: Bets, r: Pick<Round, 'winner' | 'pPair' | 'bPair'>) {
  const per: Bets = {}
  let total = 0
  for (const k of BET_KEYS) {
    const v = bets[k]
    if (!v) continue
    per[k] = cents(v * returnOf(k, r))
    total += per[k]!
  }
  return { payout: cents(total), per }
}

/* ------------------------------------------------------------------ */
/*  Shoe                                                                */
/* ------------------------------------------------------------------ */

export interface Shoe {
  /** cards still to come, next card last (pop) */
  cards: Card[]
  /** the cut card comes out once this few cards are left */
  cutAt: number
  /** the cut card has come out: the next round is the last hand */
  cutOut: boolean
  /** the last hand has been dealt: the next round needs a new shoe */
  finished: boolean
  /** the card turned up to decide the burn, and how many cards were burned after it */
  burn: { card: Card; count: number } | null
}

let cardSeq = 1
export const freshId = () => cardSeq++

export const fullShoeCards = (): Card[] =>
  Array.from({ length: DECKS }, () => SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit, id: 0 })))).flat()

/** A shuffled shoe with its burn done and the cut card placed. `rnd` is uniform in [0, 1). */
export function newShoe(rnd: () => number): Shoe {
  const cards = shuffle(fullShoeCards())
  const first = cards.pop()!
  const count = points(first) || 10
  cards.splice(cards.length - count, count)
  return { cards, cutAt: CUT_MIN + Math.floor(rnd() * (CUT_MAX - CUT_MIN + 1)), cutOut: false, finished: false, burn: { card: { ...first, id: freshId() }, count } }
}

/** Plays the next round from the shoe (mutating it): notes when the cut card comes out and when the last hand is done. */
export function dealRound(shoe: Shoe): Round {
  if (shoe.finished) throw new Error('shoe is finished')
  const lastHand = shoe.cutOut
  const round = playRound(() => {
    const c = shoe.cards.pop()
    if (!c) throw new Error('shoe ran out')
    return { ...c, id: freshId() }
  })
  if (shoe.cards.length <= shoe.cutAt) shoe.cutOut = true
  if (lastHand) shoe.finished = true
  return round
}

/* the remaining cards, stored as one character each so a shoe fits in a short string */
const CODE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const encodeCards = (cards: Card[]) => cards.map((c) => CODE[SUITS.indexOf(c.suit) * 13 + RANKS.indexOf(c.rank)]).join('')
export function decodeCards(s: string): Card[] | null {
  const out: Card[] = []
  for (const ch of s) {
    const i = CODE.indexOf(ch)
    if (i < 0) return null
    out.push({ rank: RANKS[i % 13], suit: SUITS[Math.floor(i / 13)], id: 0 })
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  Scoreboard: bead plate and Big Road                                 */
/* ------------------------------------------------------------------ */

export interface RoadEntry {
  w: Winner
  /** Player and Banker totals */
  p: number
  b: number
  pp?: boolean
  bp?: boolean
  n?: boolean
}

export const ROAD_ROWS = 6

export interface BigRoadCell {
  col: number
  row: number
  w: Side
  /** ties that followed this result */
  ties: number
  pp: boolean
  bp: boolean
}

/**
 * The Big Road: a new column whenever the winner changes, down to six rows, then a "dragon tail" turns right along
 * the row it reached (also when the cell below is already taken). Ties take no cell: they mark the last result
 * (ties before the first Player or Banker result go on that first cell).
 */
export function bigRoad(entries: RoadEntry[]): BigRoadCell[] {
  const cells: BigRoadCell[] = []
  const taken = new Set<string>()
  const key = (c: number, r: number) => `${c},${r}`
  let leadTies = 0
  let last: BigRoadCell | null = null
  let startCol = -1
  let tail = false
  for (const e of entries) {
    if (e.w === 'T') {
      if (last) last.ties++
      else leadTies++
      continue
    }
    let col: number
    let row: number
    if (!last || last.w !== e.w) {
      startCol++
      while (taken.has(key(startCol, 0))) startCol++
      col = startCol
      row = 0
      tail = false
    } else if (!tail && last.row + 1 < ROAD_ROWS && !taken.has(key(last.col, last.row + 1))) {
      col = last.col
      row = last.row + 1
    } else {
      col = last.col + 1
      row = last.row
      while (taken.has(key(col, row))) col++
      tail = true
    }
    const cell: BigRoadCell = { col, row, w: e.w, ties: leadTies, pp: !!e.pp, bp: !!e.bp }
    leadTies = 0
    cells.push(cell)
    taken.add(key(col, row))
    last = cell
  }
  return cells
}

export const roadCounts = (entries: RoadEntry[]) => {
  const c = { P: 0, B: 0, T: 0, pp: 0, bp: 0 }
  for (const e of entries) {
    c[e.w]++
    if (e.pp) c.pp++
    if (e.bp) c.bp++
  }
  return c
}

export const toEntry = (r: Round): RoadEntry => ({
  w: r.winner,
  p: r.pTotal,
  b: r.bTotal,
  ...(r.pPair ? { pp: true } : {}),
  ...(r.bPair ? { bp: true } : {}),
  ...(r.natural ? { n: true } : {}),
})
