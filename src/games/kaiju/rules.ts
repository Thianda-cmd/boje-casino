/*
  Kaiju Clash's rules: the eight fighters, the fight card, the outcome model, the prices and the payouts.

  The card. Round n's fight is worked out from n alone (matchupOf), so the page can show the fights ahead: two draws
  from sha256('kaiju:card:' + n) pick A and then B from the other seven. A pairing that just fought (in either corner)
  is drawn again from the next numbers, so there are no instant rematches. Every tenth fight is the Main Event.

  The outcome. A fight between A and B ends in one of 14 ways: A or B wins, by a knockout in round 1, 2 or 3, by a
  Splash (thrown into the bay) in round 1, 2 or 3, or on the judges' cards after three rounds. Each way has a whole
  number weight and the weights add up to exactly W_TOTAL = 2^20; the round's key draws u below W_TOTAL and the cell
  it falls in is the result. The weights come from the stats, split in steps that each round down and give the
  remainder to the last part, so they always add up exactly:
    the winner    A gets floor(W × S_A⁴ / (S_A⁴ + S_B⁴)), B the rest, with S = 2·power + grapple + 2·tough + speed,
                  plus 2 for each edge the matchup gives it: a grappler (8+) against a slow kaiju (4 or less), speed
                  against slowness (4 or more faster), big power (9+) against a glass jaw (tough 5 or less)
    how           the winner W's share is split in proportion to
                    knockout  power² × (13 − L.tough) × (16 − L.speed)   (L the loser: a tough or quick loser is hard
                                                                          to put away)
                    Splash    70 × grapple × (12 − L.speed)                 (a slow loser is easy to throw)
                    decision  185 × (L.tough + L.speed + W.speed)           (durable fighters and quick feet go long)
    which round   a knockout or a Splash is split over the rounds as (3 + d) : (4 + d) : 5, with d (0 to 3) how much
                  stronger the winner is (S_W − S_L, in threes): a mismatch ends early
  So Bedrock and Gorrath knock people out, Kraka and Pincer throw them in the bay (and Pincer, slow on its feet, gets
  thrown too), and Lumina dances round the plaza until the judges decide.

  The first strike is drawn on its own: A lands first with weight (A.speed + 4) out of (A.speed + B.speed + 8), as a
  share of 1024. The buildings: each round fought flattens 0 to 6 of them, with weights out of 64 from a binomial on
  the two kaijus' chaos (q = (chaos A + chaos B) / 36); the fight's total is the sum over the rounds it lasted.

  The prices. Every selection's chance p is exact (sums of the weights over their totals, the buildings by
  convolution), and it pays floor(0.97 / p to the cent) per coin staked, the stake included, so every selection
  returns just under 97%. The buildings line is the half number that makes Over closest to an even chance.

  Nothing that decides a result or a price uses anything but + − × ÷ and rounding: every browser computes the same
  numbers, bit for bit. (tools/kaiju-test.ts checks the weights, the prices and samples the draw.)
*/

import { below, drawFrom, sha256, type Draw } from './fair'
import { SELS, type Fighter, type KaijuId, type KaijuMeta, type Market, type Matchup, type Method, type Odds, type Result, type Sel, type Side, type Stakes } from './types'

export const RTP = 0.97
export const MAX_MULT = 250
/** the most one player can stake on one selection in a round */
export const STAKE_LIMIT = 10_000
/** the outcome cells' weights add up to this */
export const W_TOTAL = 1 << 20
/** the first strike's weights add up to this */
export const FIRST_TOTAL = 1024
/** a round's building weights add up to this */
export const DMG_TOTAL = 64
/** the most buildings one round can flatten */
export const DMG_MAX = 6

/* ---------------- the fighters ---------------- */

export const ROSTER: readonly Fighter[] = [
  {
    id: 'rexor', name: 'Rexor', epithet: 'The Atomic King', style: 'Walks through punches and answers with fire',
    colors: { body: '#2f6b4f', accent: '#a9c99a', glow: '#5fe0ff' }, power: 8, grapple: 5, tough: 8, speed: 5, chaos: 7, special: 'Atomic Breath',
  },
  {
    id: 'gorrath', name: 'Gorrath', epithet: 'Ape of the Ashlands', style: 'Swings first, swings hardest, never stops swinging',
    colors: { body: '#4a3a35', accent: '#b98b6e', glow: '#ff8a3d' }, power: 9, grapple: 7, tough: 6, speed: 6, chaos: 8, special: 'Ground Pound',
  },
  {
    id: 'titan', name: 'Titan-X', epithet: 'The Iron Sentinel', style: 'A walking bank vault with lasers: slow, sure, hard to dent',
    colors: { body: '#8a97a8', accent: '#3a4656', glow: '#ff3b4f' }, power: 7, grapple: 4, tough: 9, speed: 4, chaos: 5, special: 'Eye Lasers',
  },
  {
    id: 'kraka', name: 'Kraka', epithet: 'Terror of the Deep', style: 'Wraps you up, drags you down, and the bay does the rest',
    colors: { body: '#7b3f9e', accent: '#e7a0d4', glow: '#b06bff' }, power: 5, grapple: 9, tough: 6, speed: 5, chaos: 6, special: 'Ink Cyclone',
  },
  {
    id: 'lumina', name: 'Lumina', epithet: 'The Moth Queen', style: 'Flutters out of reach and wins on points while giants swing at air',
    colors: { body: '#d9b45a', accent: '#f6e7b0', glow: '#ffe36b' }, power: 6, grapple: 3, tough: 4, speed: 10, chaos: 4, special: 'Dust Storm',
  },
  {
    id: 'pincer', name: 'Pincer', epithet: 'The Living Fortress', style: 'Pinches, holds and shoves: nothing gets through that shell',
    colors: { body: '#d0482f', accent: '#f2b39a', glow: '#ffb04f' }, power: 6, grapple: 8, tough: 9, speed: 3, chaos: 5, special: 'Shell Crush',
  },
  {
    id: 'bedrock', name: 'Bedrock', epithet: 'The Walking Mountain', style: 'Hits like a falling skyscraper, moves like one too',
    colors: { body: '#6b6358', accent: '#a39a8a', glow: '#ff7a2f' }, power: 10, grapple: 5, tough: 8, speed: 2, chaos: 9, special: 'Boulder Hurl',
  },
  {
    id: 'voltra', name: 'Voltra', epithet: 'Storm Serpent', style: 'Fast, coiled and crackling: one wrong move and the lights go out',
    colors: { body: '#1f5e8c', accent: '#9fd8ff', glow: '#7df9ff' }, power: 8, grapple: 6, tough: 5, speed: 8, chaos: 7, special: 'Chain Lightning',
  },
]
export const KAIJU_IDS: readonly KaijuId[] = ROSTER.map((f) => f.id)
const BY_ID = new Map(ROSTER.map((f) => [f.id, f]))
export const fighter = (id: KaijuId): Fighter => BY_ID.get(id) ?? ROSTER[0]
export const isKaiju = (s: unknown): s is KaijuId => typeof s === 'string' && BY_ID.has(s as KaijuId)
/** the kaiju in a corner */
export const sideId = (m: Matchup, s: Side): KaijuId => (s === 'a' ? m.a : m.b)
export const other = (s: Side): Side => (s === 'a' ? 'b' : 'a')

/* ---------------- the card ---------------- */

function rawCard(id: number, i: number): [KaijuId, KaijuId] {
  const d = drawFrom(sha256(`kaiju:card:${id}`))
  const a = below(d, 'a', i, KAIJU_IDS.length)
  let b = below(d, 'b', i, KAIJU_IDS.length - 1)
  if (b >= a) b++
  return [KAIJU_IDS[a], KAIJU_IDS[b]]
}
const samePair = (x: [KaijuId, KaijuId], y: [KaijuId, KaijuId]) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0])
const cards = new Map<number, Matchup>()

/** round id's fight card, from the id alone */
export function matchupOf(id: number): Matchup {
  const hit = cards.get(id)
  if (hit) return hit
  // no instant rematch: a pair that is also the previous round's first draw is drawn again (the previous round's own
  // first draw, so this never needs more than the two rounds' hashes)
  const prev = rawCard(id - 1, 0)
  let pair = rawCard(id, 0)
  for (let i = 1; i < 8 && samePair(pair, prev); i++) pair = rawCard(id, i)
  const m: Matchup = { a: pair[0], b: pair[1], main: id % 10 === 0 }
  if (cards.size > 500) cards.clear()
  cards.set(id, m)
  return m
}

/* ---------------- the outcome model ---------------- */

/** the 14 cells, in order: A's 7 then B's 7, each KO r1–r3, Splash r1–r3, decision */
export interface Cell {
  winner: Side
  method: Method
  round: 1 | 2 | 3
}
export const CELLS: readonly Cell[] = (['a', 'b'] as const).flatMap((winner) => [
  ...([1, 2, 3] as const).map((round) => ({ winner, method: 'ko' as Method, round })),
  ...([1, 2, 3] as const).map((round) => ({ winner, method: 'splash' as Method, round })),
  { winner, method: 'dec' as Method, round: 3 as const },
])

/** a kaiju's fighting strength against another: the base strength plus the matchup's edges */
export function strengthOf(w: Fighter, l: Fighter): number {
  let s = 2 * w.power + w.grapple + 2 * w.tough + w.speed
  if (w.grapple >= 8 && l.speed <= 4) s += 2
  if (w.speed - l.speed >= 4) s += 2
  if (w.power >= 9 && l.tough <= 5) s += 2
  return s
}

/** how a win by W over L comes, in proportion: knockout, Splash, decision */
export function methodWeights(w: Fighter, l: Fighter): [ko: number, splash: number, dec: number] {
  return [w.power * w.power * (13 - l.tough) * (16 - l.speed), 70 * w.grapple * (12 - l.speed), 185 * (l.tough + l.speed + w.speed)]
}

const cellMemo = new Map<string, readonly number[]>()

/** the 14 cells' weights for an ordered matchup (CELLS order); they add up to W_TOTAL exactly */
export function cellsOf(a: KaijuId, b: KaijuId): readonly number[] {
  const k = `${a}-${b}`
  const hit = cellMemo.get(k)
  if (hit) return hit
  const A = fighter(a)
  const B = fighter(b)
  const sa = strengthOf(A, B)
  const sb = strengthOf(B, A)
  const pa = sa * sa * sa * sa
  const pb = sb * sb * sb * sb
  const wa = Math.floor((W_TOTAL * pa) / (pa + pb))
  const out: number[] = []
  for (const [w, l, share, sw, sl] of [[A, B, wa, sa, sb], [B, A, W_TOTAL - wa, sb, sa]] as const) {
    const [ko, sp, dec] = methodWeights(w, l)
    const t = ko + sp + dec
    const wko = Math.floor((share * ko) / t)
    const wsp = Math.floor((share * sp) / t)
    const d = Math.max(0, Math.min(3, Math.floor((sw - sl) / 3)))
    const rw = [3 + d, 4 + d, 5]
    const rt = rw[0] + rw[1] + rw[2]
    for (const x of [wko, wsp]) {
      const r1 = Math.floor((x * rw[0]) / rt)
      const r2 = Math.floor((x * rw[1]) / rt)
      out.push(r1, r2, x - r1 - r2)
    }
    out.push(share - wko - wsp)
  }
  cellMemo.set(k, out)
  return out
}

/** A's weight for landing the first strike, out of FIRST_TOTAL */
export function firstWeight(a: KaijuId, b: KaijuId): number {
  const x = fighter(a).speed + 4
  const y = fighter(b).speed + 4
  return Math.floor((FIRST_TOTAL * x) / (x + y))
}

const pmfMemo = new Map<number, readonly number[]>()
const CHOOSE6 = [1, 6, 15, 20, 15, 6, 1]

/** the weights (out of DMG_TOTAL) of a round flattening 0 to 6 buildings, from the two kaijus' chaos */
export function dmgPmf(a: KaijuId, b: KaijuId): readonly number[] {
  const c = fighter(a).chaos + fighter(b).chaos
  const hit = pmfMemo.get(c)
  if (hit) return hit
  // binomial(6, c / 36) in whole numbers: C(6, k) × c^k × (36 − c)^(6 − k) out of 36^6
  const raw = CHOOSE6.map((n, k) => {
    let w = n
    for (let i = 0; i < k; i++) w *= c
    for (let i = k; i < 6; i++) w *= 36 - c
    return w
  })
  const t = raw.reduce((x, y) => x + y, 0)
  const out = raw.map((w) => Math.floor((DMG_TOTAL * w) / t))
  let top = 0
  for (let k = 1; k <= DMG_MAX; k++) if (out[k] > out[top]) top = k
  out[top] += DMG_TOTAL - out.reduce((x, y) => x + y, 0)
  pmfMemo.set(c, out)
  return out
}

/** a draw below DMG_TOTAL as a round's buildings */
const sampleDmg = (pmf: readonly number[], u: number) => {
  for (let k = 0; k <= DMG_MAX; k++) if ((u -= pmf[k]) < 0) return k
  return DMG_MAX
}

/** the buildings each of the three rounds would flatten (the fight counts the rounds it lasted) */
export function damageRolls(key: string, a: KaijuId, b: KaijuId): [number, number, number] {
  const d = drawFrom(key)
  const pmf = dmgPmf(a, b)
  return [1, 2, 3].map((i) => sampleDmg(pmf, below(d, 'dmg', i, DMG_TOTAL))) as [number, number, number]
}

/* ---------------- the result ---------------- */

/** the fight's result from the round's key: the cell, the first strike and the buildings (see the top) */
export function drawResult(key: string, a: KaijuId, b: KaijuId): Result {
  return resultFrom(drawFrom(key), a, b)
}

/** the result from any source of draws (the tests use a fast one) */
export function resultFrom(d: Draw, a: KaijuId, b: KaijuId): Result {
  const w = cellsOf(a, b)
  let u = below(d, 'result', 0, W_TOTAL)
  let i = 0
  while (i < w.length - 1 && (u -= w[i]) >= 0) i++
  const c = CELLS[i]
  const first: Side = below(d, 'first', 0, FIRST_TOTAL) < firstWeight(a, b) ? 'a' : 'b'
  const pmf = dmgPmf(a, b)
  let damage = 0
  for (let r = 1; r <= c.round; r++) damage += sampleDmg(pmf, below(d, 'dmg', r, DMG_TOTAL))
  return { winner: c.winner, method: c.method, round: c.round, first, damage }
}

/* ---------------- the prices ---------------- */

/** a chance as a whole numerator over a power-of-two denominator, so the price is worked out exactly */
interface Frac {
  n: number
  d: number
}

/** how many ways (out of 64^k) k rounds flatten each total, by convolution */
function sums(pmf: readonly number[], k: number): number[] {
  let out = [1]
  for (let r = 0; r < k; r++) {
    const next = new Array(out.length + DMG_MAX).fill(0)
    out.forEach((x, i) => pmf.forEach((y, j) => (next[i + j] += x * y)))
    out = next
  }
  return out
}

/** the chances of the buildings markets over every half-number line, and the line nearest an even chance */
function dmgOdds(a: KaijuId, b: KaijuId): { line: number; over: Frac } {
  const w = cellsOf(a, b)
  const pmf = dmgPmf(a, b)
  // the weight of the fight lasting exactly 1, 2 or 3 rounds
  const lasts = [0, 0, 0]
  CELLS.forEach((c, i) => (lasts[c.round - 1] += w[i]))
  const ways = [1, 2, 3].map((k) => sums(pmf, k))
  // over k.5 for every k: Σ_L lasts[L] × ways_L(> k) × 64^(3 − L), out of 2^20 × 64^3 = 2^38 (exact in a double)
  const den = W_TOTAL * DMG_TOTAL * DMG_TOTAL * DMG_TOTAL
  let best: { line: number; over: Frac } | null = null
  for (let k = 0; k < 3 * DMG_MAX; k++) {
    let n = 0
    for (let L = 1; L <= 3; L++) {
      let tail = 0
      ways[L - 1].forEach((x, s) => s > k && (tail += x))
      let scale = 1
      for (let i = L; i < 3; i++) scale *= DMG_TOTAL
      n += lasts[L - 1] * tail * scale
    }
    // the most even line; between two equally even ones, the lower
    if (!best || Math.abs(2 * n - den) < Math.abs(2 * best.over.n - best.over.d)) best = { line: k + 0.5, over: { n, d: den } }
  }
  return best!
}

/** what a selection pays per coin staked for a chance n / d: 0.97 / p rounded down to the cent, capped */
const multOf = (f: Frac) => (f.n <= 0 ? MAX_MULT : Math.min(MAX_MULT * 100, Math.floor((97 * f.d) / f.n)) / 100)

const oddsMemo = new Map<string, Odds>()

/** the prices of a fight (A in the red corner): the chance of every selection, what it pays, the buildings line */
export function oddsOf(a: KaijuId, b: KaijuId): Odds {
  const k = `${a}-${b}`
  const hit = oddsMemo.get(k)
  if (hit) return hit
  const w = cellsOf(a, b)
  const sum = (f: (c: Cell) => boolean) => CELLS.reduce((x, c, i) => (f(c) ? x + w[i] : x), 0)
  const cell = (f: (c: Cell) => boolean): Frac => ({ n: sum(f), d: W_TOTAL })
  const fa = firstWeight(a, b)
  const dmg = dmgOdds(a, b)
  const fr: Record<Sel, Frac> = {
    'win:a': cell((c) => c.winner === 'a'),
    'win:b': cell((c) => c.winner === 'b'),
    'how:ko': cell((c) => c.method === 'ko'),
    'how:splash': cell((c) => c.method === 'splash'),
    'how:dec': cell((c) => c.method === 'dec'),
    'exact:a-ko': cell((c) => c.winner === 'a' && c.method === 'ko'),
    'exact:a-splash': cell((c) => c.winner === 'a' && c.method === 'splash'),
    'exact:a-dec': cell((c) => c.winner === 'a' && c.method === 'dec'),
    'exact:b-ko': cell((c) => c.winner === 'b' && c.method === 'ko'),
    'exact:b-splash': cell((c) => c.winner === 'b' && c.method === 'splash'),
    'exact:b-dec': cell((c) => c.winner === 'b' && c.method === 'dec'),
    'rnd:1': cell((c) => c.method !== 'dec' && c.round === 1),
    'rnd:2': cell((c) => c.method !== 'dec' && c.round === 2),
    'rnd:3': cell((c) => c.method !== 'dec' && c.round === 3),
    'rnd:dist': cell((c) => c.method === 'dec'),
    'first:a': { n: fa, d: FIRST_TOTAL },
    'first:b': { n: FIRST_TOTAL - fa, d: FIRST_TOTAL },
    'dmg:over': dmg.over,
    'dmg:under': { n: dmg.over.d - dmg.over.n, d: dmg.over.d },
  }
  const p = {} as Record<Sel, number>
  const mult = {} as Record<Sel, number>
  for (const s of SELS) {
    p[s] = fr[s].n / fr[s].d
    mult[s] = multOf(fr[s])
  }
  const odds: Odds = { p, mult, line: dmg.line }
  oddsMemo.set(k, odds)
  return odds
}

/* ---------------- settling ---------------- */

/** the selections a result wins, against the fight's buildings line */
export function hitsOf(r: Result, line: number): Sel[] {
  return [
    `win:${r.winner}`,
    `how:${r.method}`,
    `exact:${r.winner}-${r.method}`,
    r.method === 'dec' ? 'rnd:dist' : `rnd:${r.round}`,
    `first:${r.first}`,
    r.damage > line ? 'dmg:over' : 'dmg:under',
  ] as Sel[]
}

const cents = (x: number) => Math.round(x * 100)

/** what a won selection pays for a stake: stake × mult, rounded down to the cent (worked out in cents) */
export const winOf = (stake: number, mult: number) => Math.floor((cents(stake) * cents(mult)) / 100) / 100

/** everything the stakes are paid back for a result, the stakes on the winning selections included */
export function payoutOf(stakes: Stakes, r: Result, odds: Odds): number {
  let c = 0
  for (const s of hitsOf(r, odds.line)) {
    const st = stakes[s] ?? 0
    if (st > 0) c += cents(winOf(st, odds.mult[s]))
  }
  return c / 100
}

/** the total staked */
export const stakeTotal = (stakes: Stakes) => SELS.reduce((c, s) => c + cents(stakes[s] ?? 0), 0) / 100

/** what a settled round tells the wallet: the fight, the result, the player's winning selections and an upset */
export function metaOf(round: number, m: Matchup, r: Result, odds: Odds, stakes: Stakes): KaijuMeta {
  const won = hitsOf(r, odds.line).filter((s) => (stakes[s] ?? 0) > 0)
  const winSel: Sel = `win:${r.winner}`
  return {
    round,
    a: m.a,
    b: m.b,
    winner: r.winner,
    method: r.method,
    ended: r.round,
    damage: r.damage,
    hits: won.join(','),
    upset: (stakes[winSel] ?? 0) > 0 && odds.mult[winSel] >= 3,
  }
}

/* ---------------- names ---------------- */

export const METHOD_NAME: Record<Method, string> = { ko: 'KO', splash: 'Splash', dec: 'Decision' }

/** how the board and the history name a selection */
export function selName(s: Sel, m: Matchup): string {
  const n = (x: Side) => fighter(sideId(m, x)).name
  switch (s) {
    case 'win:a':
    case 'win:b':
      return `${n(s === 'win:a' ? 'a' : 'b')} to win`
    case 'how:ko':
      return 'Ends in a knockout'
    case 'how:splash':
      return 'Ends in a Splash'
    case 'how:dec':
      return "Judges' decision"
    case 'rnd:1':
    case 'rnd:2':
    case 'rnd:3':
      return `Ends in round ${s.slice(4)}`
    case 'rnd:dist':
      return 'Goes the distance'
    case 'first:a':
    case 'first:b':
      return `${n(s === 'first:a' ? 'a' : 'b')} lands first`
    case 'dmg:over':
    case 'dmg:under': {
      const line = oddsOf(m.a, m.b).line
      return `${s === 'dmg:over' ? 'Over' : 'Under'} ${line} buildings`
    }
    default: {
      // exact:<side>-<method>
      const side = s.charAt(6) as Side
      const how = s.slice(8) as Method
      return `${n(side)} ${how === 'ko' ? 'by KO' : how === 'splash' ? 'by Splash' : 'on points'}`
    }
  }
}

/** a selection's short label on the board's buttons (the market's title says the rest) */
export function selShort(s: Sel, m: Matchup): string {
  const n = (x: Side) => fighter(sideId(m, x)).name
  if (s === 'win:a' || s === 'first:a') return n('a')
  if (s === 'win:b' || s === 'first:b') return n('b')
  if (s === 'how:ko') return 'KO'
  if (s === 'how:splash') return 'Splash'
  if (s === 'how:dec') return 'Decision'
  if (s === 'rnd:dist') return 'Distance'
  if (s.startsWith('rnd:')) return `Round ${s.slice(4)}`
  if (s === 'dmg:over') return `Over ${oddsOf(m.a, m.b).line}`
  if (s === 'dmg:under') return `Under ${oddsOf(m.a, m.b).line}`
  return `${n(s.charAt(6) as Side)} ${METHOD_NAME[s.slice(8) as Method]}`
}

/** the six markets as the board groups them */
export const MARKETS: readonly { id: Market; name: string; line: string; sels: readonly Sel[] }[] = [
  { id: 'win', name: 'Winner', line: 'Who wins the fight, however it ends', sels: ['win:a', 'win:b'] },
  { id: 'how', name: 'Method', line: 'A knockout, a Splash into the bay, or the judges', sels: ['how:ko', 'how:splash', 'how:dec'] },
  { id: 'exact', name: 'Winner and method', line: 'Name the winner and how it wins', sels: ['exact:a-ko', 'exact:a-splash', 'exact:a-dec', 'exact:b-ko', 'exact:b-splash', 'exact:b-dec'] },
  { id: 'rnd', name: 'Round', line: 'The round a knockout or Splash comes in, or the distance', sels: ['rnd:1', 'rnd:2', 'rnd:3', 'rnd:dist'] },
  { id: 'first', name: 'First strike', line: 'The first blow to land', sels: ['first:a', 'first:b'] },
  { id: 'dmg', name: 'Buildings', line: 'Buildings flattened, over or under the line', sels: ['dmg:over', 'dmg:under'] },
]
