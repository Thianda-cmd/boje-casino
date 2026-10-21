/*
  Banker's Deal's rules: sixteen briefcases, one board of prizes, and a Banker who wants to buy yours.

  A game costs the stake. Its board (the sixteen prizes, as multiples of the stake) is one of three: Classic (top
  prize 5×), Gold (25×) or Diamond (250×), drawn with the chances in BOARDS. The prizes go into the cases unseen. The
  player keeps one case and opens the others in rounds of 4, 4, 3, 2 and 1; after each round the Banker offers to
  buy the player's case. Deal takes the offer and ends the game; No Deal plays on. With two cases left (the player's
  and one other) the Banker makes a last offer and the player may swap cases; then the player's case is opened and
  pays what is inside.

  The return. Playing every game to the end pays, on average, the average prize on the board, and the board chances
  are solved so that comes to exactly RTP. Every offer is at most the average of the prizes still unopened (BETA of
  it, a little less again by the Banker's mood, rounded down to the cent), which is what the player's case is worth
  on average at that moment, so taking a deal can never return more than playing on: no way of playing returns more
  than RTP. Swapping changes nothing (the two cases left are alike).

  Nothing is decided ahead. A case's prize is drawn, from the prizes not yet seen, the moment it is opened, and the
  player's own case is only filled at the end from the last two. That is the same as filling every case at the start
  (the prizes are shuffled either way), and it means no stored game ever holds a prize the player has not seen, so
  there is nothing to peek at. Each draw and each offer is stored before it is shown, so reloading can't change one.
  (tools/deal-test.ts checks the board chances, the offers' bound, and simulates ways of playing.)
*/

import { round2 } from '../../lib/format'

export const RTP = 0.96
export const CASES = 16
/** the cases opened in each round; with the player's case, two are left at the end */
export const ROUNDS = [4, 4, 3, 2, 1] as const
/** the share of the unopened prizes' average the Banker offers after each round, and at the final two */
export const BETA = [0.75, 0.84, 0.9, 0.94, 0.97, 0.99] as const
/** the Banker's mood shaves up to this share off an offer */
export const MOOD = 0.03

export type BoardId = 'classic' | 'gold' | 'diamond'

/** the three boards' prizes, smallest first, as multiples of the stake */
const PRIZES: Record<BoardId, readonly number[]> = {
  classic: [0, 0.01, 0.05, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 5],
  gold: [0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 7.5, 10, 25],
  diamond: [0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 25, 50, 100, 250],
}
const mean = (v: readonly number[]) => v.reduce((a, x) => a + x, 0) / v.length
/** a Diamond board turns up once in this many games; Gold's chance is solved so the whole returns RTP */
const DIAMOND = 0.002
const GOLD = (RTP - DIAMOND * mean(PRIZES.diamond) - (1 - DIAMOND) * mean(PRIZES.classic)) / (mean(PRIZES.gold) - mean(PRIZES.classic))

export const BOARDS: { id: BoardId; name: string; chance: number; prizes: readonly number[] }[] = [
  { id: 'classic', name: 'Classic', chance: 1 - GOLD - DIAMOND, prizes: PRIZES.classic },
  { id: 'gold', name: 'Gold', chance: GOLD, prizes: PRIZES.gold },
  { id: 'diamond', name: 'Diamond', chance: DIAMOND, prizes: PRIZES.diamond },
]
export const boardOf = (id: BoardId) => BOARDS.find((b) => b.id === id)!
/** the exact return of playing every game to the end */
export const returnToEnd = () => BOARDS.reduce((a, b) => a + b.chance * mean(b.prizes), 0)

/* ---------------- a game ---------------- */

export type Step =
  /** the player picks their case */
  | 'pick'
  /** cases to open this round */
  | 'open'
  /** the Banker's offer is on the table */
  | 'offer'
  /** done: dealt, or the player's case opened */
  | 'over'

export interface Game {
  board: BoardId
  /** the player's case (0-15), once picked; swapping changes it */
  mine: number | null
  /** prizes of the cases opened so far, by case */
  opened: Record<number, number>
  /** the round under way (0-4), or 5 at the final two */
  round: number
  step: Step
  /** the Banker's offer, as a multiple of the stake, while one is on the table; and every offer made, in order */
  offer: number | null
  offers: number[]
  /** how it ended: the deal taken (its multiple), or the player's case opened (its prize) */
  dealt: number | null
  /** the prize in the player's case and in the last other case, filled at the end (or when it ends early) */
  minePrize: number | null
  lastPrize: number | null
  /** the multiple the game pays */
  result: number | null
}

export function newGame(rng: () => number): Game {
  let x = rng()
  let board: BoardId = 'classic'
  for (const b of BOARDS) {
    if ((x -= b.chance) < 0) {
      board = b.id
      break
    }
  }
  return { board, mine: null, opened: {}, round: 0, step: 'pick', offer: null, offers: [], dealt: null, minePrize: null, lastPrize: null, result: null }
}

/** the prizes not yet seen, smallest first (each prize is one case's; equal prizes count separately) */
export function unseen(g: Game): number[] {
  const left = [...boardOf(g.board).prizes]
  for (const v of Object.values(g.opened)) {
    const i = left.indexOf(v)
    if (i >= 0) left.splice(i, 1)
  }
  return left
}

/** how many cases are still to be opened this round */
export function toOpen(g: Game): number {
  if (g.step !== 'open') return 0
  const before = ROUNDS.slice(0, g.round).reduce((a, n) => a + n, 0)
  return before + ROUNDS[g.round] - Object.keys(g.opened).length
}

/** the cases that can be opened now: not the player's, not already open */
export const closedOthers = (g: Game) => Array.from({ length: CASES }, (_, i) => i).filter((i) => i !== g.mine && !(i in g.opened))

export function pick(g: Game, i: number): Game {
  if (g.step !== 'pick' || i < 0 || i >= CASES) return g
  return { ...g, mine: i, step: 'open' }
}

/** what the Banker offers for the player's case now: BETA of the unseen average, less his mood, to the cent */
export function makeOffer(g: Game, rng: () => number): number {
  const avg = mean(unseen(g))
  const m = BETA[Math.min(g.round, BETA.length - 1)] * avg * (1 - MOOD * rng())
  return Math.floor(m * 100 + 1e-9) / 100
}

/** opens case i: its prize is drawn from those unseen; at the end of a round the Banker makes his offer */
export function open(g: Game, i: number, rng: () => number): Game {
  if (g.step !== 'open' || i === g.mine || i in g.opened || i < 0 || i >= CASES) return g
  const left = unseen(g)
  const prize = left[Math.floor(rng() * left.length)]
  const next: Game = { ...g, opened: { ...g.opened, [i]: prize } }
  if (toOpen(next) > 0) return next
  const offer = makeOffer(next, rng)
  return { ...next, step: 'offer', offer, offers: [...next.offers, offer] }
}

/** the player's case and the last one filled from the two prizes left */
function fill(g: Game, rng: () => number): { mine: number; last: number | null } {
  const left = unseen(g)
  const k = Math.floor(rng() * left.length)
  const mine = left[k]
  left.splice(k, 1)
  return { mine, last: left.length === 1 ? left[0] : null }
}

/** Deal: the game ends at the offer; the player's case is opened to show what it held */
export function deal(g: Game, rng: () => number): Game {
  if (g.step !== 'offer' || g.offer == null) return g
  const { mine, last } = fill(g, rng)
  return { ...g, step: 'over', dealt: g.offer, minePrize: mine, lastPrize: last, result: g.offer, offer: null }
}

/** No Deal: on to the next round, or, after the final two's offer, the player's case is opened */
export function noDeal(g: Game, rng: () => number, swap = false): Game {
  if (g.step !== 'offer') return g
  if (g.round < ROUNDS.length - 1 || (g.round === ROUNDS.length - 1 && Object.keys(g.opened).length < CASES - 2)) {
    return { ...g, step: 'open', round: g.round + 1, offer: null }
  }
  if (g.round === ROUNDS.length - 1) {
    // the last round is done: the final two, with the Banker's last offer and the swap
    const offer = makeOffer({ ...g, round: ROUNDS.length }, rng)
    return { ...g, round: ROUNDS.length, offer, offers: [...g.offers, offer] }
  }
  // No Deal at the final two: open the player's case (swapped for the other if asked)
  const other = closedOthers(g)[0]
  const { mine, last } = fill(g, rng)
  return { ...g, step: 'over', mine: swap && other != null ? other : g.mine, minePrize: mine, lastPrize: last, result: mine, offer: null }
}

/**
 * The game played out as if every offer were refused: what a game left unfinished pays (its page went away). Its
 * expected value is the unseen average, at least any offer, so finishing a game this way never costs the player.
 */
export function playOut(g: Game, rng: () => number): Game {
  if (g.step === 'over') return g
  let x = g.step === 'pick' ? pick(g, 0) : g
  for (let n = 0; n < 40 && x.step !== 'over'; n++) {
    if (x.step === 'open') x = open(x, closedOthers(x)[0], rng)
    else if (x.step === 'offer') x = noDeal(x, rng)
  }
  return x
}

/** what a game pays for a stake, to the cent */
export const payoutOf = (stake: number, g: Game) => (g.result == null ? 0 : round2(Math.floor(stake * g.result * 100 + 1e-6) / 100))

/** whether a stored game is well formed (a game from storage is checked before it is trusted) */
export function isGame(x: unknown): x is Game {
  const g = x as Game
  if (!g || typeof g !== 'object' || !BOARDS.some((b) => b.id === g.board)) return false
  if (!['pick', 'open', 'offer', 'over'].includes(g.step) || !Number.isInteger(g.round) || g.round < 0 || g.round > ROUNDS.length) return false
  if (g.mine !== null && !(Number.isInteger(g.mine) && g.mine >= 0 && g.mine < CASES)) return false
  if (!g.opened || typeof g.opened !== 'object' || !Array.isArray(g.offers)) return false
  const prizes = [...boardOf(g.board).prizes]
  for (const [k, v] of Object.entries(g.opened)) {
    const i = prizes.indexOf(v)
    if (i < 0 || Number(k) === g.mine) return false
    prizes.splice(i, 1)
  }
  return true
}
