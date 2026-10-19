/*
  Hold'em Showdown rules: heads-up Texas Hold'em against the dealer, played the way the casino table game is.

  The player puts out an Ante and an equal Blind (and may add a Trips side bet). Both get two hole cards. Before the
  flop the player may check or bet the Play: 4× or 3× the ante. After the flop (three community cards), a player who
  checked may check again or bet 2×. After the turn and river (dealt together), a player who checked twice must bet
  1× or fold. Only one Play bet is ever made. Then the dealer turns over and each side makes its best five cards from
  its two and the board's five.

  The dealer qualifies with a pair or better.
  - Player wins: Play pays 1:1; Ante pays 1:1 if the dealer qualified, otherwise it is returned; Blind pays by the
    player's hand (BLIND_PAYS: royal 500:1 … straight 1:1) and is returned for anything less.
  - Dealer wins: Play and Blind lose; Ante loses too, unless the dealer didn't qualify (then it is returned).
  - Tie: Play, Ante and Blind are returned.
  - Fold: Ante and Blind lose.
  - Trips is paid on the player's final hand whatever happens, folded or not (TRIPS_PAYS: royal 50:1 … trips 3:1;
    it returns 98.1%).

  The whole deck is shuffled at the deal and saved with the hand, so a hand resumes exactly after a reload. `advise`
  gives the recommended move: a chart before the flop, the well-known flop rules after it, and on the river the exact
  best move (every dealer hand that can still come is counted). (tools/holdem-test.ts checks the evaluator against the
  known 7-card frequencies and hand by hand, every payout rule, and the returns with the advice played.)
*/

import { round2 } from '../../lib/format'

/* ---------------- cards ---------------- */

/** a card is 0..51: rank = c % 13 (0 is a two, 12 an ace), suit = floor(c / 13) (clubs, diamonds, hearts, spades) */
export type Card = number
export const rankOf = (c: Card) => c % 13
export const suitOf = (c: Card) => Math.floor(c / 13)
export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const
export const SUIT_CHARS = ['♣', '♦', '♥', '♠'] as const
export const rankLabel = (c: Card) => RANK_CHARS[rankOf(c)]
export const suitSymbol = (c: Card) => SUIT_CHARS[suitOf(c)]
export const cardName = (c: Card) => `${rankLabel(c)}${suitSymbol(c)}`

export function shuffledDeck(rng: () => number): Card[] {
  const d = Array.from({ length: 52 }, (_, i) => i)
  for (let i = 51; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[d[i], d[j]] = [d[j], d[i]]
  }
  return d
}

/* ---------------- hands ---------------- */

export type HandRank = 'high' | 'pair' | 'twoPair' | 'trips' | 'straight' | 'flush' | 'fullHouse' | 'quads' | 'straightFlush' | 'royal'
export const HAND_ORDER: readonly HandRank[] = ['high', 'pair', 'twoPair', 'trips', 'straight', 'flush', 'fullHouse', 'quads', 'straightFlush', 'royal']
export const HAND_NAMES: Readonly<Record<HandRank, string>> = {
  high: 'High card',
  pair: 'Pair',
  twoPair: 'Two pair',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  fullHouse: 'Full house',
  quads: 'Four of a kind',
  straightFlush: 'Straight flush',
  royal: 'Royal flush',
}

export interface Eval {
  /** comparable: a higher score is a better hand, equal scores tie */
  score: number
  rank: HandRank
  /** the five cards that make the hand */
  best: Card[]
}

/** the highest straight in a 13-bit rank mask (ace low allowed): its top rank, or -1 */
function straightTop(mask: number): number {
  for (let top = 12; top >= 4; top--) {
    const need = 0b11111 << (top - 4)
    if ((mask & need) === need) return top
  }
  // the wheel: A-2-3-4-5
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3
  return -1
}

const pack = (cat: number, ks: readonly number[]) => {
  let s = cat
  for (let i = 0; i < 5; i++) s = s * 16 + (ks[i] ?? 0)
  return s
}

/** the best five-card hand from 5 to 7 cards */
export function evaluate(cards: readonly Card[]): Eval {
  const counts = new Array(13).fill(0)
  const bySuit: Card[][] = [[], [], [], []]
  let mask = 0
  for (const c of cards) {
    const r = rankOf(c)
    counts[r]++
    bySuit[suitOf(c)].push(c)
    mask |= 1 << r
  }
  const desc = (a: Card, b: Card) => rankOf(b) - rankOf(a)
  // flushes and straight flushes
  const fl = bySuit.find((s) => s.length >= 5)
  if (fl) {
    let fmask = 0
    for (const c of fl) fmask |= 1 << rankOf(c)
    const top = straightTop(fmask)
    if (top >= 0) {
      const ranks = top === 3 ? [3, 2, 1, 0, 12] : [top, top - 1, top - 2, top - 3, top - 4]
      const best = ranks.map((r) => fl.find((c) => rankOf(c) === r)!)
      return { score: pack(top === 12 ? 9 : 8, [top]), rank: top === 12 ? 'royal' : 'straightFlush', best }
    }
  }
  const byCount = (n: number) => {
    const out: number[] = []
    for (let r = 12; r >= 0; r--) if (counts[r] === n) out.push(r)
    return out
  }
  const quads = byCount(4)
  const threes = byCount(3)
  const pairs = byCount(2)
  const pick = (r: number, n: number) => cards.filter((c) => rankOf(c) === r).slice(0, n)
  const kickers = (exclude: number[], n: number) => cards.filter((c) => !exclude.includes(rankOf(c))).sort(desc).slice(0, n)
  if (quads.length) {
    const q = quads[0]
    const k = kickers([q], 1)
    return { score: pack(7, [q, rankOf(k[0])]), rank: 'quads', best: [...pick(q, 4), ...k] }
  }
  if (threes.length && (threes.length > 1 || pairs.length)) {
    const t = threes[0]
    const p = threes.length > 1 ? Math.max(threes[1], pairs[0] ?? -1) : pairs[0]
    return { score: pack(6, [t, p]), rank: 'fullHouse', best: [...pick(t, 3), ...pick(p, 2)] }
  }
  if (fl) {
    const best = fl.slice().sort(desc).slice(0, 5)
    return { score: pack(5, best.map(rankOf)), rank: 'flush', best }
  }
  const st = straightTop(mask)
  if (st >= 0) {
    const ranks = st === 3 ? [3, 2, 1, 0, 12] : [st, st - 1, st - 2, st - 3, st - 4]
    return { score: pack(4, [st]), rank: 'straight', best: ranks.map((r) => pick(r, 1)[0]) }
  }
  if (threes.length) {
    const t = threes[0]
    const k = kickers([t], 2)
    return { score: pack(3, [t, ...k.map(rankOf)]), rank: 'trips', best: [...pick(t, 3), ...k] }
  }
  if (pairs.length >= 2) {
    const [a, b] = pairs
    const k = kickers([a, b], 1)
    return { score: pack(2, [a, b, rankOf(k[0])]), rank: 'twoPair', best: [...pick(a, 2), ...pick(b, 2), ...k] }
  }
  if (pairs.length) {
    const p = pairs[0]
    const k = kickers([p], 3)
    return { score: pack(1, [p, ...k.map(rankOf)]), rank: 'pair', best: [...pick(p, 2), ...k] }
  }
  const best = cards.slice().sort(desc).slice(0, 5)
  return { score: pack(0, best.map(rankOf)), rank: 'high', best }
}

/* ---------------- paytables ---------------- */

/** what the Blind pays (to 1) by the player's winning hand; anything less than a straight is returned */
export const BLIND_PAYS: Readonly<Partial<Record<HandRank, number>>> = { royal: 500, straightFlush: 50, quads: 10, fullHouse: 3, flush: 1.5, straight: 1 }
/** what Trips pays (to 1) by the player's hand, win or lose; less than three of a kind loses */
export const TRIPS_PAYS: Readonly<Partial<Record<HandRank, number>>> = { royal: 50, straightFlush: 40, quads: 30, fullHouse: 8, flush: 6, straight: 5, trips: 3 }

/** stake limits */
export const MIN_ANTE = 1
export const MAX_ANTE = 10_000
export const MAX_TRIPS = 1_000

/* ---------------- a hand ---------------- */

export type Stage = 'preflop' | 'flop' | 'river' | 'done'
export type Action = 'check' | 'bet4' | 'bet3' | 'bet2' | 'bet1' | 'fold'

export interface Hand {
  /** the shuffled deck: player 0-1, dealer 2-3, board 4-8 (flop 4-6, turn 7, river 8) */
  deck: Card[]
  ante: number
  /** the Blind always equals the Ante */
  trips: number
  /** the Play bet as a multiple of the ante (0: not made) */
  play: 0 | 1 | 2 | 3 | 4
  stage: Stage
  folded: boolean
}

export const playerCards = (h: Hand) => h.deck.slice(0, 2)
export const dealerCards = (h: Hand) => h.deck.slice(2, 4)
/** the board cards showing at this stage */
export const boardShown = (h: Hand) => h.deck.slice(4, h.stage === 'preflop' ? 4 : h.stage === 'flop' ? 7 : 9)
export const fullBoard = (h: Hand) => h.deck.slice(4, 9)

export function deal(ante: number, trips: number, rng: () => number): Hand {
  return { deck: shuffledDeck(rng), ante: round2(ante), trips: round2(trips), play: 0, stage: 'preflop', folded: false }
}

/** what can be done now */
export function actions(h: Hand): Action[] {
  if (h.stage === 'preflop') return ['check', 'bet4', 'bet3']
  if (h.stage === 'flop') return ['check', 'bet2']
  if (h.stage === 'river') return ['bet1', 'fold']
  return []
}

/** the Play bet an action makes, as a multiple of the ante */
export const playMultiple = (a: Action): 0 | 1 | 2 | 3 | 4 => (a === 'bet4' ? 4 : a === 'bet3' ? 3 : a === 'bet2' ? 2 : a === 'bet1' ? 1 : 0)

/** the hand after an action. A bet ends the decisions (the hand goes to the showdown); so does a fold. */
export function act(h: Hand, a: Action): Hand {
  if (!actions(h).includes(a)) throw new Error(`can't ${a} at ${h.stage}`)
  if (a === 'fold') return { ...h, stage: 'done', folded: true }
  if (a === 'check') return { ...h, stage: h.stage === 'preflop' ? 'flop' : 'river' }
  return { ...h, play: playMultiple(a), stage: 'done' }
}

/** coins on the table for the hand (ante + blind + trips + play) */
export const staked = (h: Hand) => round2(h.ante * 2 + h.trips + h.ante * h.play)

export type BetKey = 'ante' | 'blind' | 'play' | 'trips'
export interface BetResult {
  key: BetKey
  stake: number
  outcome: 'win' | 'lose' | 'push'
  /** returned, stake included */
  ret: number
}

export interface Showdown {
  player: Eval
  dealer: Eval
  /** the dealer has a pair or better */
  qualifies: boolean
  winner: 'player' | 'dealer' | 'tie'
  folded: boolean
  results: BetResult[]
  stake: number
  ret: number
}

const winCents = (stake: number, mult: number) => Math.floor(stake * mult * 100 + 1e-7) / 100

/** settles a finished hand */
export function showdown(h: Hand): Showdown {
  if (h.stage !== 'done') throw new Error('the hand is not finished')
  const board = fullBoard(h)
  const player = evaluate([...playerCards(h), ...board])
  const dealer = evaluate([...dealerCards(h), ...board])
  const qualifies = HAND_ORDER.indexOf(dealer.rank) >= 1
  const winner = player.score > dealer.score ? 'player' : player.score < dealer.score ? 'dealer' : 'tie'
  const results: BetResult[] = []
  const r = (key: BetKey, stake: number, outcome: BetResult['outcome'], winnings = 0) =>
    results.push({ key, stake, outcome, ret: outcome === 'lose' ? 0 : outcome === 'push' ? stake : round2(stake + winnings) })
  const A = h.ante
  if (h.folded) {
    r('ante', A, 'lose')
    r('blind', A, 'lose')
  } else if (winner === 'tie') {
    r('ante', A, 'push')
    r('blind', A, 'push')
    r('play', A * h.play, 'push')
  } else if (winner === 'player') {
    r('play', A * h.play, 'win', A * h.play)
    if (qualifies) r('ante', A, 'win', A)
    else r('ante', A, 'push')
    const bp = BLIND_PAYS[player.rank]
    if (bp !== undefined) r('blind', A, 'win', winCents(A, bp))
    else r('blind', A, 'push')
  } else {
    r('play', A * h.play, 'lose')
    r('ante', A, qualifies ? 'lose' : 'push')
    r('blind', A, 'lose')
  }
  if (h.trips > 0) {
    const tp = TRIPS_PAYS[player.rank]
    if (tp !== undefined) r('trips', h.trips, 'win', winCents(h.trips, tp))
    else r('trips', h.trips, 'lose')
  }
  const stake = round2(results.reduce((a, x) => a + x.stake, 0))
  const ret = round2(results.reduce((a, x) => a + x.ret, 0))
  return { player, dealer, qualifies, winner, folded: h.folded, results, stake, ret }
}

/* ---------------- advice ---------------- */

export interface Advice {
  action: Action
  /** a short reason for people */
  why: string
}

/** before the flop: the 4× chart */
export function preflopRaise(hole: readonly Card[]): { raise: boolean; why: string } {
  const [a, b] = hole
  const hi = Math.max(rankOf(a), rankOf(b))
  const lo = Math.min(rankOf(a), rankOf(b))
  const suited = suitOf(a) === suitOf(b)
  const R = (ch: string) => RANK_CHARS.indexOf(ch as (typeof RANK_CHARS)[number])
  if (hi === lo) return hi >= R('3') ? { raise: true, why: 'A pair of threes or better: bet 4×.' } : { raise: false, why: 'Pocket twos: check.' }
  if (hi === R('A')) return { raise: true, why: 'Any ace: bet 4×.' }
  if (hi === R('K') && (suited || lo >= R('5'))) return { raise: true, why: suited ? 'King with a suited kicker: bet 4×.' : 'King with a five or better: bet 4×.' }
  if (hi === R('Q') && ((suited && lo >= R('6')) || lo >= R('8'))) return { raise: true, why: suited ? 'Queen with a suited six or better: bet 4×.' : 'Queen with an eight or better: bet 4×.' }
  if (hi === R('J') && ((suited && lo >= R('8')) || lo >= R('10'))) return { raise: true, why: suited ? 'Jack with a suited eight or better: bet 4×.' : 'Jack-ten: bet 4×.' }
  return { raise: false, why: 'Not strong enough to raise before the flop: check.' }
}

/** after the flop: bet 2× with two pair or better, a pair that uses a hole card (not pocket twos), or four to a flush with a hidden ten or better of that suit */
export function flopBet(hole: readonly Card[], flop: readonly Card[]): { bet: boolean; why: string } {
  const all = [...hole, ...flop]
  const e = evaluate(all)
  const boardOnly = evaluate(flop)
  // two pair or better that the hole cards make (not the board's own hand, which the dealer shares)
  if (HAND_ORDER.indexOf(e.rank) >= HAND_ORDER.indexOf('twoPair') && HAND_ORDER.indexOf(e.rank) > HAND_ORDER.indexOf(boardOnly.rank)) return { bet: true, why: `${HAND_NAMES[e.rank]} with your cards: bet 2×.` }
  const holeRanks = hole.map(rankOf)
  const flopRanks = flop.map(rankOf)
  const pocketPair = holeRanks[0] === holeRanks[1]
  const hiddenPair = (pocketPair && holeRanks[0] > 0) || holeRanks.some((r) => flopRanks.includes(r))
  if (hiddenPair) return { bet: true, why: 'A pair that uses your hole cards: bet 2×.' }
  for (let s = 0; s < 4; s++) {
    const n = all.filter((c) => suitOf(c) === s).length
    if (n >= 4 && hole.some((c) => suitOf(c) === s && rankOf(c) >= 8)) return { bet: true, why: 'Four to a flush with a ten or better in your hand: bet 2×.' }
  }
  return { bet: false, why: 'Nothing strong yet: check.' }
}

/**
 * On the river, the exact value of betting 1× against folding, × the ante: every two-card hand the dealer can still
 * hold (990 of them) is played out. Trips is the same either way, so it is left out.
 */
export function riverValues(h: Hand): { bet: number; fold: number } {
  const hole = playerCards(h)
  const board = fullBoard(h)
  const seen = new Set([...hole, ...board])
  const rest = Array.from({ length: 52 }, (_, i) => i).filter((c) => !seen.has(c))
  const p = evaluate([...hole, ...board])
  const pBlind = BLIND_PAYS[p.rank]
  let sum = 0
  let n = 0
  for (let i = 0; i < rest.length; i++) {
    for (let j = i + 1; j < rest.length; j++) {
      const d = evaluate([rest[i], rest[j], ...board])
      const q = HAND_ORDER.indexOf(d.rank) >= 1
      // net win in antes for Ante + Blind + Play(1×)
      let v: number
      if (p.score > d.score) v = 1 + (q ? 1 : 0) + (pBlind ?? 0)
      else if (p.score < d.score) v = -1 - (q ? 1 : 0) - 1
      else v = 0
      sum += v
      n++
    }
  }
  return { bet: sum / n, fold: -2 }
}

/** the recommended move now */
export function advise(h: Hand): Advice {
  if (h.stage === 'preflop') {
    const p = preflopRaise(playerCards(h))
    return { action: p.raise ? 'bet4' : 'check', why: p.why }
  }
  if (h.stage === 'flop') {
    const f = flopBet(playerCards(h), boardShown(h))
    return { action: f.bet ? 'bet2' : 'check', why: f.why }
  }
  if (h.stage === 'river') {
    const v = riverValues(h)
    const avg = fmtUnits(Math.abs(v.bet))
    if (v.bet < v.fold) return { action: 'fold', why: `Betting 1× would lose ${avg} antes on average; folding loses 2.` }
    if (avg === '0.00') return { action: 'bet1', why: 'Betting 1× breaks even on average; folding loses 2.' }
    return v.bet > 0
      ? { action: 'bet1', why: `Betting 1× wins ${avg} antes on average; folding loses 2.` }
      : { action: 'bet1', why: `Betting 1× loses ${avg} antes on average, less than the 2 a fold loses: bet.` }
  }
  return { action: 'check', why: '' }
}

const fmtUnits = (x: number) => (Math.round(x * 100) / 100).toFixed(2)

/** a saved hand read back, or null if it isn't one */
export function parseHand(raw: unknown): Hand | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Partial<Hand>
  if (!Array.isArray(o.deck) || o.deck.length !== 52 || new Set(o.deck).size !== 52 || !o.deck.every((c) => Number.isInteger(c) && c >= 0 && c < 52)) return null
  if (typeof o.ante !== 'number' || !(o.ante >= MIN_ANTE) || typeof o.trips !== 'number' || o.trips < 0) return null
  if (![0, 1, 2, 3, 4].includes(o.play as number) || !['preflop', 'flop', 'river', 'done'].includes(o.stage as string) || typeof o.folded !== 'boolean') return null
  return { deck: o.deck, ante: o.ante, trips: o.trips, play: o.play as Hand['play'], stage: o.stage as Stage, folded: o.folded }
}
