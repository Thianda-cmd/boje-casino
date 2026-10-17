import { rand } from '../../lib/rng'

/*
  Scratch & Win: four instant-win cards. Each card hides nine symbols under its foil; three of a kind win that symbol's
  prize, and a card wins at most one prize.

  The prize is drawn first, the moment a card is bought, from the card's table of whole weights out of 1,000,000. Only
  then is the board built to show it: the winning symbol three times (on three cells picked uniformly), and every other
  cell drawn uniformly from the card's other symbols with no symbol more than twice, so a losing card never hides a win
  and a winning card never hides a second one. Besides its eight prizes every card prints four blanks: symbols that pay
  nothing and only ever fill (no symbol, blank or prize, shows more than twice unless it is the win). With twelve
  symbols to fill from, a losing card shows two pairs at most on three cards in four, so a pair means something. Pairs
  and near misses fall out of that uniform fill: the jackpot symbol shows up as a pair exactly as often as a blank does.

  Fruit Frenzy adds a Frenzy spot: a multiplier drawn on its own (independent of the grid) from a second table out of
  1,000, which multiplies whatever the grid pays. Every card returns exactly 96%:
    Σ weight × mult = 0.96 × 1,000,000                 (Lucky Clover, Gold Rush, Diamond Deluxe)
    Σ weight × mult × Σ bonusWeight × bonus = 0.96 × 1,000,000 × 1,000   (Fruit Frenzy: 0.60 × 1.60)
  tools/scratch-test.ts checks the sums in integers, the boards and their independence from everything but the prize.
*/

export type CardId = 'clover' | 'gold' | 'fruit' | 'diamond'

export type SymbolId =
  // Lucky Clover
  | 'mushroom' | 'coin' | 'ladybug' | 'hat' | 'horseshoe' | 'rainbow' | 'clover' | 'pot'
  | 'acorn' | 'daisy' | 'butterfly' | 'snail'
  // Gold Rush
  | 'cactus' | 'lantern' | 'pickaxe' | 'cart' | 'dynamite' | 'star' | 'bars' | 'nugget'
  | 'boot' | 'canteen' | 'stetson' | 'wheel'
  // Fruit Frenzy
  | 'cherry' | 'lemon' | 'orange' | 'strawberry' | 'pineapple' | 'grapes' | 'melon' | 'seven'
  | 'banana' | 'pear' | 'plum' | 'kiwi'
  // Diamond Deluxe
  | 'pearl' | 'amethyst' | 'sapphire' | 'emerald' | 'ruby' | 'ring' | 'crown' | 'diamond'
  | 'watch' | 'key' | 'perfume' | 'champagne'

export interface Prize {
  sym: SymbolId
  name: string
  /** a whole number: the prize is mult × the card's price */
  mult: number
  /** out of WEIGHT_TOTAL */
  weight: number
}

/** a symbol that pays nothing: it only ever fills */
export interface Blank {
  sym: SymbolId
  name: string
}

export interface BonusValue {
  mult: number
  /** out of BONUS_TOTAL */
  weight: number
}

export interface CardDef {
  id: CardId
  name: string
  /** one line under the name */
  tagline: string
  risk: 'Low' | 'Medium' | 'Medium-high' | 'High'
  /** 1 to 4, for the risk meter */
  riskLevel: 1 | 2 | 3 | 4
  /** eight prizes, smallest first; the last is the card's top prize */
  prizes: Prize[]
  /** four blanks; on a board they come after the prizes (symbol index prizes.length + i) */
  blanks: Blank[]
  /** the Frenzy spot's multipliers, when the card has one */
  bonus?: BonusValue[]
}

export const RTP = 0.96
export const WEIGHT_TOTAL = 1_000_000
export const BONUS_TOTAL = 1_000
export const CELLS = 9
export const COLS = 3
/** no symbol shows more than this many times unless it is the win */
export const MAX_FILL = 2
/** the top three prizes are the ones a pair of builds suspense for */
export const HOT = 3

const prizes = (rows: [sym: SymbolId, name: string, mult: number, weight: number][]): Prize[] => rows.map(([sym, name, mult, weight]) => ({ sym, name, mult, weight }))
const blanks = (rows: [sym: SymbolId, name: string][]): Blank[] => rows.map(([sym, name]) => ({ sym, name }))

export const CARD_IDS: CardId[] = ['clover', 'gold', 'fruit', 'diamond']

export const CARDS: Record<CardId, CardDef> = {
  // wins 39% of the time, mostly small: a gentle card
  clover: {
    id: 'clover',
    name: 'Lucky Clover',
    tagline: 'Frequent small wins',
    risk: 'Low',
    riskLevel: 1,
    prizes: prizes([
      ['mushroom', 'Toadstool', 1, 200_000],
      ['coin', 'Lucky Coin', 2, 100_000],
      ['ladybug', 'Ladybird', 3, 50_000],
      ['hat', 'Top Hat', 5, 30_000],
      ['horseshoe', 'Horseshoe', 10, 8_000],
      ['rainbow', 'Rainbow', 20, 3_000],
      ['clover', 'Four-Leaf Clover', 50, 1_000],
      ['pot', 'Pot of Gold', 100, 700],
    ]),
    blanks: blanks([
      ['acorn', 'Acorn'],
      ['daisy', 'Daisy'],
      ['butterfly', 'Butterfly'],
      ['snail', 'Snail'],
    ]),
  },
  gold: {
    id: 'gold',
    name: 'Gold Rush',
    tagline: 'Strike it rich',
    risk: 'Medium',
    riskLevel: 2,
    prizes: prizes([
      ['cactus', 'Cactus', 1, 140_000],
      ['lantern', 'Lantern', 2, 80_000],
      ['pickaxe', 'Pickaxe', 4, 35_000],
      ['cart', 'Mine Cart', 10, 10_000],
      ['dynamite', 'Dynamite', 25, 4_000],
      ['star', 'Sheriff Star', 50, 2_000],
      ['bars', 'Gold Bars', 100, 1_000],
      ['nugget', 'Mother Lode', 500, 240],
    ]),
    blanks: blanks([
      ['boot', 'Boot'],
      ['canteen', 'Canteen'],
      ['stetson', 'Stetson'],
      ['wheel', 'Wagon Wheel'],
    ]),
  },
  // the grid returns 60% and the Frenzy spot multiplies it by 1.6 on average
  fruit: {
    id: 'fruit',
    name: 'Fruit Frenzy',
    tagline: 'Frenzy spot multiplies up to ×10',
    risk: 'Medium-high',
    riskLevel: 3,
    prizes: prizes([
      ['cherry', 'Cherries', 1, 80_000],
      ['lemon', 'Lemon', 2, 40_000],
      ['orange', 'Orange', 3, 25_000],
      ['strawberry', 'Strawberry', 5, 15_000],
      ['pineapple', 'Pineapple', 10, 7_000],
      ['grapes', 'Grapes', 25, 2_600],
      ['melon', 'Watermelon', 100, 800],
      ['seven', 'Lucky Seven', 250, 300],
    ]),
    blanks: blanks([
      ['banana', 'Banana'],
      ['pear', 'Pear'],
      ['plum', 'Plum'],
      ['kiwi', 'Kiwi'],
    ]),
    bonus: [
      { mult: 1, weight: 650 },
      { mult: 2, weight: 230 },
      { mult: 3, weight: 80 },
      { mult: 5, weight: 30 },
      { mult: 10, weight: 10 },
    ],
  },
  // one card in eight wins; a fifth of the return sits in the 5,000× diamond
  diamond: {
    id: 'diamond',
    name: 'Diamond Deluxe',
    tagline: 'Chase the 5,000× diamond',
    risk: 'High',
    riskLevel: 4,
    prizes: prizes([
      ['pearl', 'Pearl', 1, 60_000],
      ['amethyst', 'Amethyst', 2, 35_000],
      ['sapphire', 'Sapphire', 5, 16_000],
      ['emerald', 'Emerald', 10, 8_000],
      ['ruby', 'Ruby', 25, 4_000],
      ['ring', 'Diamond Ring', 100, 1_500],
      ['crown', 'Crown', 500, 400],
      ['diamond', 'Grand Diamond', 5000, 44],
    ]),
    blanks: blanks([
      ['watch', 'Pocket Watch'],
      ['key', 'Golden Key'],
      ['perfume', 'Perfume'],
      ['champagne', 'Champagne'],
    ]),
  },
}

/* ---------------- odds ---------------- */

export const loseWeight = (c: CardDef) => WEIGHT_TOTAL - c.prizes.reduce((a, p) => a + p.weight, 0)
/** chance a card matches three of anything */
export const hitChance = (c: CardDef) => (WEIGHT_TOTAL - loseWeight(c)) / WEIGHT_TOTAL
export const topPrize = (c: CardDef) => c.prizes[c.prizes.length - 1]
/** the most one card can pay, Frenzy spot included */
export const maxMult = (c: CardDef) => topPrize(c).mult * (c.bonus ? Math.max(...c.bonus.map((b) => b.mult)) : 1)
export const chanceOf = (p: Prize) => p.weight / WEIGHT_TOTAL
export const bonusChance = (b: BonusValue) => b.weight / BONUS_TOTAL
/** the chance of the most a card can pay (the top prize, times the biggest Frenzy spot) */
export const maxChance = (c: CardDef) => chanceOf(topPrize(c)) * (c.bonus ? bonusChance(c.bonus[c.bonus.length - 1]) : 1)
/** how many symbols a board can show: the prizes, then the blanks */
export const symbolCount = (c: CardDef) => c.prizes.length + c.blanks.length
/** a board's symbol index is a prize (not a blank) */
export const isPrize = (c: CardDef, s: number) => s >= 0 && s < c.prizes.length
/** the art of a board's symbol index */
export const symbolOf = (c: CardDef, s: number): SymbolId => (s < c.prizes.length ? c.prizes[s].sym : c.blanks[s - c.prizes.length].sym)
/** one of the top three prizes: a pair of them is worth a drumroll */
export const isHot = (c: CardDef, s: number) => isPrize(c, s) && s >= c.prizes.length - HOT

/* ---------------- a card ---------------- */

export interface Outcome {
  card: CardId
  /** index into the card's prizes, or -1 for a losing card */
  prize: number
  /** the Frenzy spot's multiplier (1 on a card without one) */
  bonus: number
  /** what the card pays, as a multiple of its price */
  mult: number
  /** the card's top prize (its jackpot symbol) came up, whatever the Frenzy spot says */
  top: boolean
  /** nine symbol indexes, row by row: prizes first, then blanks (see symbolOf) */
  board: number[]
  /** the winning cells, in reading order (empty on a losing card) */
  line: number[]
}

/** the most this card can pay came up (on Fruit Frenzy: the seven with the ×10 spot) */
export const isMax = (o: Outcome) => o.mult > 0 && o.mult === maxMult(CARDS[o.card])

/** Draws an index from whole weights adding up to `total`; `r` is uniform in [0, 1). */
export function pickWeighted(weights: number[], total: number, r: number): number {
  let x = Math.floor(r * total)
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i]
    if (x < 0) return i
  }
  return -1
}

/** the prize index for a uniform r: -1 (no win) once r falls past every prize */
export const pickPrize = (c: CardDef, r: number) => pickWeighted(c.prizes.map((p) => p.weight), WEIGHT_TOTAL, r)

export function pickBonus(c: CardDef, r: number) {
  if (!c.bonus) return 1
  const i = pickWeighted(c.bonus.map((b) => b.weight), BONUS_TOTAL, r)
  return c.bonus[i < 0 ? c.bonus.length - 1 : i].mult
}

/**
 * Fills `n` cells uniformly from `symbols` so that no symbol ends up more than MAX_FILL times: rejection sampling, so
 * every allowed filling is exactly as likely as any other.
 */
function fill(n: number, symbols: number[], r: () => number): number[] {
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const out: number[] = []
    const counts = new Map<number, number>()
    let ok = true
    for (let i = 0; i < n; i++) {
      const s = symbols[Math.floor(r() * symbols.length)]
      const k = (counts.get(s) ?? 0) + 1
      if (k > MAX_FILL) {
        ok = false
        break
      }
      counts.set(s, k)
      out.push(s)
    }
    if (ok) return out
  }
  throw new Error('could not fill the board')
}

/** `k` distinct cells out of n, uniformly (a partial Fisher-Yates) */
function pickCells(n: number, k: number, r: () => number): number[] {
  const all = Array.from({ length: n }, (_, i) => i)
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(r() * (n - i))
    ;[all[i], all[j]] = [all[j], all[i]]
  }
  return all.slice(0, k).sort((a, b) => a - b)
}

/** The board for a drawn prize (-1 for a losing card). The prize decides the board, never the other way round. */
export function buildBoard(c: CardDef, prize: number, r: () => number = rand): { board: number[]; line: number[] } {
  const symbols = Array.from({ length: symbolCount(c) }, (_, i) => i)
  if (prize < 0) return { board: fill(CELLS, symbols, r), line: [] }
  const line = pickCells(CELLS, 3, r)
  const rest = fill(CELLS - 3, symbols.filter((s) => s !== prize), r)
  const board: number[] = []
  let k = 0
  for (let i = 0; i < CELLS; i++) board.push(line.includes(i) ? prize : rest[k++])
  return { board, line }
}

/** Reads a board the way the player does: the prize showing three (or more) times, and where. */
export function evaluate(c: CardDef, board: number[]): { prize: number; line: number[] } {
  const counts = new Map<number, number[]>()
  board.forEach((s, i) => counts.set(s, [...(counts.get(s) ?? []), i]))
  const wins = [...counts.entries()].filter(([, cells]) => cells.length >= 3)
  if (wins.length > 1) throw new Error('a board with two wins')
  if (wins.length && !isPrize(c, wins[0][0])) throw new Error('three of a blank')
  return wins.length ? { prize: wins[0][0], line: wins[0][1] } : { prize: -1, line: [] }
}

/** Buys one card: the prize and the Frenzy spot first, then the board that shows them. */
export function drawCard(id: CardId, r: () => number = rand): Outcome {
  const c = CARDS[id]
  const prize = pickPrize(c, r())
  const bonus = pickBonus(c, r())
  const { board, line } = buildBoard(c, prize, r)
  const mult = prize < 0 ? 0 : c.prizes[prize].mult * bonus
  return { card: id, prize, bonus, mult, top: prize === c.prizes.length - 1, board, line }
}

/* ---------------- how big a win is ---------------- */

/**
 * The win's tier, by what it pays: 0 nothing, 1 the stake back (1×), 2 a small win, 3 a good one (5×+), 4 a big one
 * (25×+), then the celebrations: 5 Big win (50×+), 6 Mega win (250×+), 7 Epic win (1,000×+), 8 Legendary (2,500×+).
 */
export function winTier(mult: number): number {
  if (mult <= 0) return 0
  if (mult < 1.5) return 1
  if (mult < 5) return 2
  if (mult < 25) return 3
  if (mult < 50) return 4
  if (mult < 250) return 5
  if (mult < 1000) return 6
  if (mult < 2500) return 7
  return 8
}

/** a win big enough for the full-stage celebration (or the card's top prize, whatever it pays) */
export const celebrates = (o: Outcome) => o.top || o.mult >= 50

/** the celebration's title */
export const tierTitle = (mult: number) => (mult >= 2500 ? 'Legendary win' : mult >= 1000 ? 'Epic win' : mult >= 250 ? 'Mega win' : 'Big win')

/* ---------------- labels ---------------- */

/** 1×, 25×, 5,000× */
export const multLabel = (m: number) => `${m.toLocaleString('en-US', { maximumFractionDigits: 2 })}×`

/** a coin amount short enough for a cell: 12.50, 5,000, 50,000, 250K, 1.25M */
export function coinLabel(v: number) {
  if (v >= 1e6) return `${trim(v / 1e6)}M`
  if (v >= 1e5) return `${trim(v / 1e3)}K`
  const whole = Math.abs(v - Math.round(v)) < 0.005
  return v.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })
}
const trim = (x: number) => (Math.round(x * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })

/** "1 in 2.5", "1 in 22,727" */
export function oddsLabel(p: number) {
  const n = 1 / p
  return `1 in ${n < 10 ? (Math.round(n * 10) / 10).toString() : Math.round(n).toLocaleString('en-US')}`
}

/** 39.27%, 0.070%, 0.0044% */
export function chanceLabel(p: number) {
  const pct = p * 100
  if (pct >= 1) return `${pct.toFixed(2)}%`
  if (pct >= 0.1) return `${pct.toFixed(3)}%`
  return `${pct.toPrecision(2)}%`
}

/** a six-digit ticket serial, for the small print */
export const serial = (r: () => number = Math.random) => `${String(Math.floor(r() * 900) + 100)}-${String(Math.floor(r() * 90000) + 10000)}`
