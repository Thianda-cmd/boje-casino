/*
  Craps rules. Two dice, a shooter, and bets that can stay on the table across many rolls.

  The game runs in rounds called hands. A hand starts with a come-out roll (the point is OFF): 7 or 11 is a natural,
  2, 3 or 12 is craps, and any other number (4, 5, 6, 8, 9, 10) becomes the point (the puck goes ON). The shooter then
  rolls until the point comes again (the point is made: the puck goes OFF and a new come-out follows) or a 7 comes
  first (seven-out: the hand is over and a new shooter takes the dice).

  The bets:
  - Pass Line (come-out only): wins 1:1 on a natural, loses on craps; after a point it wins when the point is made and
    loses on a seven-out. It can't be taken down once a point is set.
  - Don't Pass (come-out only): the opposite, except a come-out 12 pushes (the bar).
  - Odds behind them (once a point is set): Pass odds pay true odds (2:1 on 4 and 10, 3:2 on 5 and 9, 6:5 on 6 and
    8, so they return exactly 100%); Don't Pass odds (lay odds) pay the reverse (1:2, 2:3, 5:6). Limits: 3-4-5× odds
    on pass, and a lay may win up to 6× its flat bet.
  - Come / Don't Come (point ON only): like Pass / Don't Pass, with the next roll as their own come-out; a number moves
    the bet onto that number, where it waits for the number (come) or a 7. Come odds are off on the come-out roll
    (returned if it decides), as in a casino; don't come odds always work.
  - Place 4, 5, 6, 8, 9, 10: win 9:5 (4, 10), 7:5 (5, 9) or 7:6 (6, 8) whenever the number rolls, and stay up; lose
    on a 7. Off on the come-out roll unless the player turns them on (`working`).
  - Field (one roll): 3, 4, 9, 10, 11 pay 1:1, 2 pays 2:1, 12 pays 3:1; 5, 6, 7, 8 lose.
  - Hardways 4, 6, 8, 10: win when the number rolls as a pair (7:1 on 4 and 10, 9:1 on 6 and 8), lose on a 7 or the
    number rolled the easy way. Off on the come-out roll like place bets.
  - One-roll props: Any 7 (4:1), Any Craps (7:1), Aces 2 (30:1), Ace-Deuce 3 (15:1), Yo 11 (15:1), Boxcars 12 (30:1).
  - Fire Bet (before a shooter's first roll): pays by how many different points the shooter makes before sevening
    out: 4 points 24:1, 5 points 249:1, all 6 points 999:1 (paid the moment the sixth is made); fewer lose.

  Money: chips are taken from the balance when placed. Each roll decides some bets: a decided bet is one round of
  play (its stake is wagered once) and anything it returns is paid. A place bet that wins pays its winnings and stays
  up: it is decided and placed again at once, so its stake counts as wagered on every win. `resolveRoll` works it all
  out from the table and the dice; the screen moves the coins. (tools/craps-test.ts checks every bet on every roll
  against a direct reading of the rules, the exact returns, and long random sessions for coin conservation.)
*/

import { round2 } from '../../lib/format'

export type Die = 1 | 2 | 3 | 4 | 5 | 6
export type Roll = readonly [Die, Die]
export type Num = 4 | 5 | 6 | 8 | 9 | 10
export const NUMBERS: readonly Num[] = [4, 5, 6, 8, 9, 10]
export type Hard = 4 | 6 | 8 | 10
export const HARDS: readonly Hard[] = [4, 6, 8, 10]

export type BetKey =
  | 'pass'
  | 'passOdds'
  | 'dontPass'
  | 'dontPassOdds'
  | 'come'
  | 'dontCome'
  | `come${Num}`
  | `comeOdds${Num}`
  | `dontCome${Num}`
  | `dontComeOdds${Num}`
  | `place${Num}`
  | 'field'
  | `hard${Hard}`
  | 'any7'
  | 'anyCraps'
  | 'aces'
  | 'aceDeuce'
  | 'yo'
  | 'boxcars'
  | 'fire'

export type Bets = Partial<Record<BetKey, number>>

export interface Table {
  /** the point, or null when it is OFF (the next roll is a come-out) */
  point: Num | null
  bets: Bets
  /** place bets and hardways work on the come-out roll too */
  working: boolean
  /** the current shooter: the different points made so far (for the Fire Bet) and rolls thrown */
  shooter: { points: Num[]; rolls: number }
}

export const newTable = (): Table => ({ point: null, bets: {}, working: false, shooter: { points: [], rolls: 0 } })

/* ---------------- payouts ---------------- */

/** [win, stake]: true odds behind pass / come */
export const TRUE_ODDS: Readonly<Record<Num, readonly [number, number]>> = { 4: [2, 1], 5: [3, 2], 6: [6, 5], 8: [6, 5], 9: [3, 2], 10: [2, 1] }
/** [win, stake]: place bets */
export const PLACE_ODDS: Readonly<Record<Num, readonly [number, number]>> = { 4: [9, 5], 5: [7, 5], 6: [7, 6], 8: [7, 6], 9: [7, 5], 10: [9, 5] }
export const HARD_ODDS: Readonly<Record<Hard, number>> = { 4: 7, 6: 9, 8: 9, 10: 7 }
export const PROP_ODDS = { any7: 4, anyCraps: 7, aces: 30, aceDeuce: 15, yo: 15, boxcars: 30 } as const
/** the Fire Bet pays by different points made */
export const FIRE_PAYS: Readonly<Record<number, number>> = { 4: 24, 5: 249, 6: 999 }
/** odds behind pass / come may be up to this many times the flat bet (3-4-5× odds) */
export const ODDS_MAX: Readonly<Record<Num, number>> = { 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3 }
/** a lay (don't odds) may win up to this many times its flat bet */
export const LAY_MAX_WIN = 6

/** per-bet stake limits */
export const LIMIT_FLAT = 5_000
export const LIMIT_PROP = 500
export const LIMIT_FIRE = 100

/** winnings (not counting the stake) of `stake` at `win`:`per`, in whole cents, never rounded up */
export const winAt = (stake: number, win: number, per: number) => Math.floor((stake * win * 100) / per + 1e-7) / 100

/* ---------------- what a bet is ---------------- */

export const isNum = (n: number): n is Num => n === 4 || n === 5 || n === 6 || n === 8 || n === 9 || n === 10
const numOf = (key: string) => Number(key.replace(/\D/g, '')) as Num

export type BetKind = 'pass' | 'passOdds' | 'dontPass' | 'dontPassOdds' | 'come' | 'dontCome' | 'comeOn' | 'comeOdds' | 'dontComeOn' | 'dontComeOdds' | 'place' | 'field' | 'hard' | 'prop' | 'fire'

export function kindOf(key: BetKey): BetKind {
  if (key === 'pass' || key === 'passOdds' || key === 'dontPass' || key === 'dontPassOdds' || key === 'come' || key === 'dontCome' || key === 'field' || key === 'fire') return key
  if (key.startsWith('comeOdds')) return 'comeOdds'
  if (key.startsWith('dontComeOdds')) return 'dontComeOdds'
  if (key.startsWith('come')) return 'comeOn'
  if (key.startsWith('dontCome')) return 'dontComeOn'
  if (key.startsWith('place')) return 'place'
  if (key.startsWith('hard')) return 'hard'
  return 'prop'
}

/** every bet key */
export const ALL_KEYS: readonly BetKey[] = [
  'pass',
  'passOdds',
  'dontPass',
  'dontPassOdds',
  'come',
  'dontCome',
  ...NUMBERS.flatMap((n) => [`come${n}`, `comeOdds${n}`, `dontCome${n}`, `dontComeOdds${n}`, `place${n}`] as BetKey[]),
  'field',
  ...HARDS.map((n) => `hard${n}` as BetKey),
  'any7',
  'anyCraps',
  'aces',
  'aceDeuce',
  'yo',
  'boxcars',
  'fire',
]
export const isBetKey = (x: unknown): x is BetKey => typeof x === 'string' && (ALL_KEYS as readonly string[]).includes(x)

/** the bet's name for people */
export function betName(key: BetKey): string {
  const n = numOf(key)
  switch (kindOf(key)) {
    case 'pass':
      return 'Pass Line'
    case 'passOdds':
      return 'Pass odds'
    case 'dontPass':
      return "Don't Pass"
    case 'dontPassOdds':
      return "Don't Pass odds"
    case 'come':
      return 'Come'
    case 'dontCome':
      return "Don't Come"
    case 'comeOn':
      return `Come on ${n}`
    case 'comeOdds':
      return `Come odds on ${n}`
    case 'dontComeOn':
      return `Don't Come on ${n}`
    case 'dontComeOdds':
      return `Don't Come odds on ${n}`
    case 'place':
      return `Place ${n}`
    case 'field':
      return 'Field'
    case 'hard':
      return `Hard ${n}`
    case 'fire':
      return 'Fire Bet'
    case 'prop':
      return ({ any7: 'Any 7', anyCraps: 'Any Craps', aces: 'Aces (2)', aceDeuce: 'Ace-Deuce (3)', yo: 'Yo (11)', boxcars: 'Boxcars (12)' } as Record<string, string>)[key]
  }
}

/* ---------------- placing and taking down ---------------- */

/** the most that may be on `key` right now (0: it can't be bet now) */
export function maxStake(t: Table, key: BetKey): number {
  const b = t.bets
  const k = kindOf(key)
  switch (k) {
    case 'pass':
    case 'dontPass':
      return t.point === null ? LIMIT_FLAT : 0
    case 'passOdds':
      return t.point !== null && b.pass ? round2(b.pass * ODDS_MAX[t.point]) : 0
    case 'dontPassOdds':
      return t.point !== null && b.dontPass ? layMax(b.dontPass, t.point) : 0
    case 'come':
    case 'dontCome':
      return t.point !== null ? LIMIT_FLAT : 0
    case 'comeOdds': {
      const n = numOf(key)
      const flat = b[`come${n}`]
      return flat ? round2(flat * ODDS_MAX[n]) : 0
    }
    case 'dontComeOdds': {
      const n = numOf(key)
      const flat = b[`dontCome${n}`]
      return flat ? layMax(flat, n) : 0
    }
    case 'comeOn':
    case 'dontComeOn':
      // a come bet gets onto a number by rolling it, never by hand
      return 0
    case 'place':
    case 'field':
    case 'hard':
      return LIMIT_FLAT
    case 'prop':
      return LIMIT_PROP
    case 'fire':
      return t.point === null && t.shooter.rolls === 0 ? LIMIT_FIRE : 0
  }
}

/** the largest lay on `n` that wins at most LAY_MAX_WIN × the flat bet */
function layMax(flat: number, n: Num) {
  const [win, per] = TRUE_ODDS[n]
  // a lay of x wins x × per / win
  return Math.floor(((flat * LAY_MAX_WIN * win) / per) * 100) / 100
}

/** whether `key` may be taken down now (contract bets can't: Pass after a point, and a come bet on its number) */
export function canRemove(t: Table, key: BetKey): boolean {
  if (!t.bets[key]) return false
  const k = kindOf(key)
  if (k === 'pass') return t.point === null
  if (k === 'comeOn') return false
  // a Fire Bet is for the shooter's whole hand once the dice are rolled
  if (k === 'fire') return t.shooter.rolls === 0
  return true
}

/** taking down a bet also takes down odds that rest on it (they are returned with it) */
export function dependents(key: BetKey): BetKey[] {
  if (key === 'pass') return ['passOdds']
  if (key === 'dontPass') return ['dontPassOdds']
  if (key.startsWith('dontCome') && !key.startsWith('dontComeOdds') && key !== 'dontCome') return [`dontComeOdds${numOf(key)}` as BetKey]
  return []
}

/* ---------------- a roll ---------------- */

export type Outcome =
  /** decided and paid: stake back with winnings */
  | 'win'
  /** decided and lost */
  | 'lose'
  /** decided, stake back without winnings */
  | 'push'
  /** won and stays up (a place bet): winnings paid, the stake is placed again */
  | 'win-stays'
  /** a come / don't come bet moved onto the number rolled */
  | 'move'

export interface BetResult {
  key: BetKey
  stake: number
  outcome: Outcome
  /** what comes back to the player: stake + winnings on a win or a win that stays, stake on a push, 0 on a loss or move */
  ret: number
  /** where a moved bet went */
  to?: BetKey
}

export interface RollResult {
  dice: Roll
  total: number
  before: Table
  after: Table
  results: BetResult[]
  /** stakes decided this roll (each counts as wagered once): wins, losses, pushes and wins that stay up */
  wagered: number
  /** coins paid back this roll */
  returned: number
  /** stakes of wins that stay up, taken again at once */
  replaced: number
  /** what happened to the hand */
  event: 'natural' | 'craps' | 'point-set' | 'point-made' | 'seven-out' | 'roll'
}

export const totalOf = (d: Roll) => d[0] + d[1]
export const isHard = (d: Roll) => d[0] === d[1]
export const rollDie = (rng: () => number) => (Math.min(5, Math.floor(rng() * 6)) + 1) as Die
export const rollDice = (rng: () => number): Roll => [rollDie(rng), rollDie(rng)]

/** works out a roll against the table: every bet's result, the table after, and the money */
export function resolveRoll(before: Table, dice: Roll): RollResult {
  const total = totalOf(dice)
  const hard = isHard(dice)
  const comeOut = before.point === null
  const point = before.point
  const bets: Bets = { ...before.bets }
  const results: BetResult[] = []
  // come bets moving onto a number move after everything is decided: an older come bet on that number is paid first
  const moves: [BetKey, BetKey][] = []
  const decide = (key: BetKey, outcome: Exclude<Outcome, 'move'>, winnings = 0) => {
    const stake = before.bets[key]!
    const ret = outcome === 'lose' ? 0 : outcome === 'push' ? stake : round2(stake + winnings)
    results.push({ key, stake, outcome, ret })
    if (outcome !== 'win-stays') delete bets[key]
  }
  const working = !comeOut || before.working

  for (const key of ALL_KEYS) {
    const stake = before.bets[key]
    if (!stake) continue
    const k = kindOf(key)
    const n = numOf(key)
    switch (k) {
      case 'pass':
        if (comeOut) {
          if (total === 7 || total === 11) decide(key, 'win', stake)
          else if (total === 2 || total === 3 || total === 12) decide(key, 'lose')
        } else if (total === point) decide(key, 'win', stake)
        else if (total === 7) decide(key, 'lose')
        break
      case 'dontPass':
        if (comeOut) {
          if (total === 2 || total === 3) decide(key, 'win', stake)
          else if (total === 12) decide(key, 'push')
          else if (total === 7 || total === 11) decide(key, 'lose')
        } else if (total === 7) decide(key, 'win', stake)
        else if (total === point) decide(key, 'lose')
        break
      case 'passOdds':
        if (point === null) break
        if (total === point) decide(key, 'win', winAt(stake, ...TRUE_ODDS[point]))
        else if (total === 7) decide(key, 'lose')
        break
      case 'dontPassOdds':
        if (point === null) break
        if (total === 7) decide(key, 'win', winAt(stake, TRUE_ODDS[point][1], TRUE_ODDS[point][0]))
        else if (total === point) decide(key, 'lose')
        break
      case 'come':
        if (total === 7 || total === 11) decide(key, 'win', stake)
        else if (total === 2 || total === 3 || total === 12) decide(key, 'lose')
        else if (isNum(total)) moves.push([key, `come${total}`])
        break
      case 'dontCome':
        if (total === 2 || total === 3) decide(key, 'win', stake)
        else if (total === 12) decide(key, 'push')
        else if (total === 7 || total === 11) decide(key, 'lose')
        else if (isNum(total)) moves.push([key, `dontCome${total}`])
        break
      case 'comeOn':
        if (total === n) decide(key, 'win', stake)
        else if (total === 7) decide(key, 'lose')
        break
      case 'comeOdds':
        // off on the come-out roll: returned if its come bet is decided then
        if (total === n) decide(key, comeOut ? 'push' : 'win', comeOut ? 0 : winAt(stake, ...TRUE_ODDS[n]))
        else if (total === 7) decide(key, comeOut ? 'push' : 'lose')
        break
      case 'dontComeOn':
        if (total === 7) decide(key, 'win', stake)
        else if (total === n) decide(key, 'lose')
        break
      case 'dontComeOdds':
        if (total === 7) decide(key, 'win', winAt(stake, TRUE_ODDS[n][1], TRUE_ODDS[n][0]))
        else if (total === n) decide(key, 'lose')
        break
      case 'place':
        if (!working) break
        if (total === n) decide(key, 'win-stays', winAt(stake, ...PLACE_ODDS[n]))
        else if (total === 7) decide(key, 'lose')
        break
      case 'field':
        if (total === 2) decide(key, 'win', stake * 2)
        else if (total === 12) decide(key, 'win', stake * 3)
        else if (total === 3 || total === 4 || total === 9 || total === 10 || total === 11) decide(key, 'win', stake)
        else decide(key, 'lose')
        break
      case 'hard':
        if (!working) break
        if (total === n && hard) decide(key, 'win', stake * HARD_ODDS[n as Hard])
        else if (total === 7 || total === n) decide(key, 'lose')
        break
      case 'prop': {
        const wins = key === 'any7' ? total === 7 : key === 'anyCraps' ? total === 2 || total === 3 || total === 12 : key === 'aces' ? total === 2 : key === 'aceDeuce' ? total === 3 : key === 'yo' ? total === 11 : total === 12
        if (wins) decide(key, 'win', stake * PROP_ODDS[key as keyof typeof PROP_ODDS])
        else decide(key, 'lose')
        break
      }
      case 'fire':
        // decided below, once the hand's fate on this roll is known
        break
    }
  }

  for (const [key, to] of moves) {
    const stake = before.bets[key]!
    results.push({ key, stake, outcome: 'move', ret: 0, to })
    delete bets[key]
    bets[to] = round2((bets[to] ?? 0) + stake)
  }

  // the hand
  let nextPoint: Num | null = point
  let event: RollResult['event'] = 'roll'
  const points = before.shooter.points.slice()
  let sevenOut = false
  if (comeOut) {
    if (total === 7 || total === 11) event = 'natural'
    else if (total === 2 || total === 3 || total === 12) event = 'craps'
    else if (isNum(total)) {
      nextPoint = total
      event = 'point-set'
    }
  } else if (total === point) {
    nextPoint = null
    event = 'point-made'
    if (!points.includes(point)) points.push(point)
  } else if (total === 7) {
    nextPoint = null
    event = 'seven-out'
    sevenOut = true
  }

  // the Fire Bet: paid at the sixth different point, decided at the seven-out
  if (before.bets.fire) {
    if (points.length >= 6) decide('fire', 'win', before.bets.fire * FIRE_PAYS[6])
    else if (sevenOut) {
      const made = points.length
      if (made >= 4) decide('fire', 'win', before.bets.fire * FIRE_PAYS[made])
      else decide('fire', 'lose')
    }
  }

  const after: Table = {
    point: nextPoint,
    bets,
    working: before.working,
    shooter: sevenOut ? { points: [], rolls: 0 } : { points, rolls: before.shooter.rolls + 1 },
  }
  let wagered = 0
  let returned = 0
  let replaced = 0
  for (const r of results) {
    if (r.outcome === 'move') continue
    wagered += r.stake
    returned += r.ret
    if (r.outcome === 'win-stays') replaced += r.stake
  }
  return { dice, total, before, after, results, wagered: round2(wagered), returned: round2(returned), replaced: round2(replaced), event }
}

/** all coins sitting on the table */
export const onTable = (t: Table) => round2(Object.values(t.bets).reduce((a, v) => a + (v ?? 0), 0))

/* ---------------- returns, for the paytable ---------------- */

const P = (n: number) => ({ 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 })[n]! / 36

/**
 * Each bet's return per coin wagered, per decision (the usual way to quote craps: the house edge is 1 minus this).
 * Place, hardway and odds bets are counted from the moment they are working.
 */
export function betReturn(key: BetKey): number {
  const k = kindOf(key)
  const n = numOf(key)
  // chance the number rolls before a 7
  const before7 = (x: Num) => P(x) / (P(x) + P(7))
  switch (k) {
    case 'pass':
    case 'come': {
      let win = P(7) + P(11)
      for (const x of NUMBERS) win += P(x) * before7(x)
      return 2 * win
    }
    case 'dontPass':
    case 'dontCome': {
      // per decision, a bar-12 push returns the stake
      let win = P(2) + P(3)
      for (const x of NUMBERS) win += P(x) * (1 - before7(x))
      return 2 * win + P(12)
    }
    case 'passOdds':
    case 'comeOdds':
    case 'dontPassOdds':
    case 'dontComeOdds':
      return 1
    case 'comeOn':
      return 2 * before7(n)
    case 'dontComeOn':
      return 2 * (1 - before7(n))
    case 'place': {
      const [win, per] = PLACE_ODDS[n]
      return before7(n) * (1 + win / per)
    }
    case 'field':
      return P(2) * 3 + P(12) * 4 + (P(3) + P(4) + P(9) + P(10) + P(11)) * 2
    case 'hard': {
      const h = n as Hard
      const pHard = 1 / 36
      const pEasy = P(h) - pHard
      return (pHard / (pHard + pEasy + P(7))) * (1 + HARD_ODDS[h])
    }
    case 'prop': {
      const p = key === 'any7' ? P(7) : key === 'anyCraps' ? P(2) + P(3) + P(12) : key === 'aces' ? P(2) : key === 'aceDeuce' ? P(3) : key === 'yo' ? P(11) : P(12)
      return p * (1 + PROP_ODDS[key as keyof typeof PROP_ODDS])
    }
    case 'fire':
      return fireReturn()
  }
}

/**
 * The Fire Bet's exact return: a Markov chain over the set of points made (a shooter's hand ends at a seven-out). From
 * a come-out, a 4-10 sets a point which is then made (before a 7) or not; naturals and craps just come out again.
 */
export function fireReturn(): number {
  // value[mask] = expected payout multiple (stake included) from a come-out with `mask` points made
  const memo = new Map<number, number>()
  const bits = (m: number) => NUMBERS.filter((_, i) => m & (1 << i)).length
  const pay = (made: number) => (made >= 4 ? 1 + FIRE_PAYS[made] : 0)
  const value = (mask: number): number => {
    if (bits(mask) >= 6) return 1 + FIRE_PAYS[6]
    const hit = memo.get(mask)
    if (hit !== undefined) return hit
    // come-out: with chance pPoint(x) a point x is set; it is made with before7, else seven-out ends the hand
    // naturals/craps return to the same state: solve v = sum + pStay v
    // a point already made, made again, comes back to the same state too
    let pStay = P(2) + P(3) + P(7) + P(11) + P(12)
    let sum = 0
    NUMBERS.forEach((x, i) => {
      const made = P(x) / (P(x) + P(7))
      sum += P(x) * (1 - made) * pay(bits(mask))
      if (mask & (1 << i)) pStay += P(x) * made
      else sum += P(x) * made * value(mask | (1 << i))
    })
    const v = sum / (1 - pStay)
    memo.set(mask, v)
    return v
  }
  return value(0)
}
