import { fmtScore, isBJ, type Card } from '../blackjack/table'
import { cardOf, TIMING, type CardView, type HandView, type Outcome, type TableFeed } from './types'

/* What the table looks like at a moment `t` of server time. The feed carries cards and results up to a
   second before they are due, and the screen only shows what is due. */

export const toCard = (c: number, id: number): Card => ({ ...cardOf(c), id })
export const landed = (cards: CardView[], t: number) => cards.filter((c) => c.at <= t)

/** The score pill for a hand; a split hand's 21 isn't a blackjack. */
export function scoreOf(cards: Card[], split = false) {
  if (!cards.length) return null
  return split && isBJ(cards) ? '21' : fmtScore(cards)
}

/** The dealer's cards on the table now, and which of them show their face. */
export function dealerAt(feed: TableFeed, t: number) {
  return landed(feed.dealer, t).map((c, i) => ({ c, open: c.c != null && (i !== 1 || (c.flip != null && c.flip <= t)) }))
}

export const resultsOut = (feed: TableFeed, t: number) => feed.round.resultsAt != null && t >= feed.round.resultsAt

/** What the round is doing, as the players see it. */
export type Moment = 'waiting' | 'betting' | 'closed' | 'shuffling' | 'dealing' | 'peek' | 'turns' | 'dealer' | 'done'
export function momentOf(feed: TableFeed, t: number): Moment {
  const r = feed.round
  switch (r.phase) {
    case 'waiting':
      return 'waiting'
    case 'betting':
      return r.betEndsAt != null && t >= r.betEndsAt - TIMING.CLOSE_EARLY_MS ? 'closed' : 'betting'
    case 'dealing': {
      const first = Math.min(...feed.dealer.map((c) => c.at), ...feed.hands.flatMap((h) => h.cards.map((c) => c.at)))
      if (r.shuffle && t < first) return 'shuffling'
      const hole = feed.dealer[1]
      return r.peek && hole && t >= hole.at + 250 ? 'peek' : 'dealing'
    }
    case 'turns':
      return 'turns'
    default:
      return resultsOut(feed, t) ? 'done' : 'dealer'
  }
}

/** The hand whose turn it is, once its turn has started. */
export function turnOf(feed: TableFeed, t: number): HandView | null {
  const turn = feed.round.turn
  if (!turn || t < turn.at) return null
  return feed.hands.find((h) => h.seat === turn.seat && h.idx === turn.hand) ?? null
}

const RANK: Record<Outcome, number> = { blackjack: 4, win: 3, push: 2, lose: 1, bust: 0 }
export const bestOutcome = (hands: HandView[]) =>
  hands.reduce<Outcome | null>((best, h) => (h.outcome && (!best || RANK[h.outcome] > RANK[best]) ? h.outcome : best), null)

/** Every hand of one seat, hand 0 first. */
export const handsAt = (feed: TableFeed, seat: number) => feed.hands.filter((h) => h.seat === seat)

/** Seat positions on the stage (percent), seat 1 on the right: points on the arc (8,52) (50,100) (92,52). */
export function arcSeat(seat: number, seats: number) {
  const s = 1 - (2 * seat - 1) / (2 * seats)
  const u = 1 - s
  return { x: u * u * 8 + 2 * u * s * 50 + s * s * 92, y: u * u * 52 + 2 * u * s * 100 + s * s * 52 }
}
