import { fmt } from '../../lib/format'
import {
  FIRE_PAYS,
  HARD_ODDS,
  LAY_MAX_WIN,
  LIMIT_FIRE,
  LIMIT_FLAT,
  LIMIT_PROP,
  ODDS_MAX,
  PLACE_ODDS,
  PROP_ODDS,
  TRUE_ODDS,
  betName,
  betReturn,
  isHard,
  kindOf,
  totalOf,
  type BetKey,
  type Hard,
  type Num,
  type Roll,
  type RollResult,
  type Table,
} from './rules'

/*
  How the screen talks about craps: each bet in a line or two (what it is, when it wins, how it pays, its house edge),
  why a chip can't go somewhere right now, the stickman's call for every roll, and a roll in plain words. Kept in one
  place so the tooltips, the refusals, the paytable and the screen reader always say the same thing, and every number
  comes from rules.ts.
*/

const numOf = (key: string) => Number(key.replace(/\D/g, '')) as Num

/** a payout ratio as the felt prints it: "9 to 5" */
export const pays = (win: number, per = 1) => `${win} to ${per}`
/** a house edge, from a bet's return per decision: "1.41%" */
export const edgeText = (ret: number) => {
  const e = Math.max(0, 1 - ret) * 100
  return e < 0.005 ? '0%' : `${e.toFixed(2)}%`
}
/** a number as the stickman says it */
export const NUM_WORD: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' }
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

/** what a bet pays, in words ("1 to 1", "9 to 5", "true odds") */
export function payText(key: BetKey): string {
  const n = numOf(key)
  switch (kindOf(key)) {
    case 'pass':
    case 'dontPass':
    case 'come':
    case 'dontCome':
    case 'comeOn':
    case 'dontComeOn':
      return pays(1)
    case 'passOdds':
    case 'comeOdds':
      return isFinite(n) && n ? pays(...TRUE_ODDS[n]) : 'true odds'
    case 'dontPassOdds':
    case 'dontComeOdds':
      return isFinite(n) && n ? pays(TRUE_ODDS[n][1], TRUE_ODDS[n][0]) : 'true odds'
    case 'place':
      return pays(...PLACE_ODDS[n])
    case 'field':
      return '1 to 1, 2 pays 2 to 1, 12 pays 3 to 1'
    case 'hard':
      return pays(HARD_ODDS[n as Hard])
    case 'prop':
      return pays(PROP_ODDS[key as keyof typeof PROP_ODDS])
    case 'fire':
      return `${FIRE_PAYS[4]}, ${FIRE_PAYS[5]} or ${FIRE_PAYS[6]} to 1`
  }
}

/** when a bet wins, in a sentence */
function winsWhen(key: BetKey, point: Num | null): string {
  const n = numOf(key)
  switch (kindOf(key)) {
    case 'pass':
      return 'On the come-out roll 7 or 11 wins and 2, 3 or 12 loses; any other number becomes the point, and then it wins if the point rolls again before a 7.'
    case 'dontPass':
      return 'The opposite of the Pass Line: on the come-out 2 or 3 wins, 12 is a tie and 7 or 11 loses; then it wins if a 7 rolls before the point.'
    case 'come':
      return 'Like the Pass Line, made while a point is on: the next roll is its own come-out. A 4 to 10 moves it onto that number, where it waits for that number again (wins) or a 7 (loses).'
    case 'dontCome':
      return 'Like Don\'t Pass, made while a point is on. A 4 to 10 moves it onto that number, where it wins if a 7 comes first.'
    case 'comeOn':
      return `Your come bet travelled to the ${n}: it wins when ${n} rolls again and loses on a 7. It stays up until then.`
    case 'dontComeOn':
      return `Your don't come bet travelled to the ${n}: it wins on a 7 and loses if ${n} rolls first.`
    case 'passOdds':
      return point ? `Wins with your Pass Line if the ${point} rolls before a 7, at true odds: no house edge at all.` : 'Goes behind a Pass Line bet once a point is set, and pays true odds: no house edge at all.'
    case 'dontPassOdds':
      return point ? `Wins with your Don't Pass if a 7 rolls before the ${point}, at true odds: no house edge.` : 'Goes behind a Don\'t Pass bet once a point is set, and pays true odds: no house edge.'
    case 'comeOdds':
      return `Odds on your come bet on the ${n}: true odds, no house edge. Off on the come-out roll (returned if the come bet is decided then).`
    case 'dontComeOdds':
      return `Lay odds on your don't come bet on the ${n}: true odds, no house edge.`
    case 'place':
      return `Wins every time a ${n} rolls before a 7, and stays up for the next one. Off on the come-out roll unless Working is on.`
    case 'field':
      return 'One roll: 3, 4, 9, 10 or 11 pay even money, 2 pays double and 12 pays triple; 5, 6, 7 or 8 lose.'
    case 'hard': {
      const h = n / 2
      return `Wins when ${n} rolls as a pair (${h} and ${h}) before a 7 or an easy ${n}. Off on the come-out roll unless Working is on.`
    }
    case 'prop':
      return {
        any7: 'One roll: any 7.',
        anyCraps: 'One roll: 2, 3 or 12.',
        aces: 'One roll: 2 (a pair of aces).',
        aceDeuce: 'One roll: 3 (ace and deuce).',
        yo: 'One roll: 11 ("yo").',
        boxcars: 'One roll: 12 (a pair of sixes).',
      }[key as 'any7']
    case 'fire':
      return "Made before the shooter's first roll. Pays when the shooter makes 4, 5 or all 6 different points before sevening out."
  }
}

/** the limit line of a bet's tooltip */
function limitText(key: BetKey, t: Table): string {
  const k = kindOf(key)
  if (k === 'passOdds' || k === 'comeOdds') {
    const n = k === 'passOdds' ? t.point : numOf(key)
    return n ? `Up to ${ODDS_MAX[n]}× the bet it backs` : 'Up to 3-4-5× the bet it backs'
  }
  if (k === 'dontPassOdds' || k === 'dontComeOdds') return `May win up to ${LAY_MAX_WIN}× the bet it backs`
  if (k === 'prop') return `Limit ${fmt(LIMIT_PROP, 0)}`
  if (k === 'fire') return `Limit ${fmt(LIMIT_FIRE, 0)}`
  if (k === 'comeOn' || k === 'dontComeOn') return 'Stays up until decided'
  return `Limit ${fmt(LIMIT_FLAT, 0)}`
}

/** the hover tooltip of a spot or a bet */
export function betTip(key: BetKey, t: Table): { title: string; lines: string[] } {
  const ret = betReturn(key)
  return {
    title: betName(key),
    lines: [winsWhen(key, t.point), `Pays ${payText(key)} · house edge ${edgeText(ret)}`, limitText(key, t)],
  }
}

/** why a chip can't go on `key` right now (maxStake said 0) */
export function whyNot(key: BetKey, t: Table): string {
  const b = t.bets
  switch (kindOf(key)) {
    case 'pass':
      return t.point ? `Pass Line bets are made on the come-out roll. The point is ${t.point}: back your Pass Line with odds instead` : 'Pass Line bets are made on the come-out roll'
    case 'dontPass':
      return "Don't Pass bets are made on the come-out roll"
    case 'passOdds':
      return t.point === null ? 'Odds go behind a Pass Line bet once a point is set' : 'Odds go behind a Pass Line bet: make one on the next come-out roll'
    case 'dontPassOdds':
      return t.point === null ? "Lay odds go behind a Don't Pass bet once a point is set" : "Lay odds go behind a Don't Pass bet: make one on the next come-out roll"
    case 'come':
      return 'Come bets are made once a point is set. On the come-out roll, use the Pass Line'
    case 'dontCome':
      return "Don't Come bets are made once a point is set. On the come-out roll, use Don't Pass"
    case 'comeOdds':
      return 'Odds go on a come bet once it has travelled to a number'
    case 'dontComeOdds':
      return "Lay odds go on a don't come bet once it has travelled to a number"
    case 'comeOn':
    case 'dontComeOn':
      return 'Come bets travel to a number when it rolls'
    case 'fire':
      return t.shooter.rolls > 0 ? "The Fire Bet is made before a shooter's first roll: wait for the next shooter" : 'The Fire Bet is made before the come-out roll'
    default:
      return b[key] ? `${betName(key)} is at its limit` : `${betName(key)} can't be bet now`
  }
}

/** why a bet can't be taken down (canRemove said no) */
export function whyStays(key: BetKey, t: Table): string {
  switch (kindOf(key)) {
    case 'pass':
      return `Your Pass Line bet stays up now the point is ${t.point}: it's decided when the ${t.point} or a 7 rolls`
    case 'comeOn':
      return `A come bet on the ${numOf(key)} stays up until the ${numOf(key)} or a 7 rolls`
    case 'fire':
      return "The Fire Bet rides for the shooter's whole hand"
    default:
      return `${betName(key)} can't be taken down now`
  }
}

/** the limit refusal: a chip that would go over what `key` may hold */
export function atLimit(key: BetKey, max: number, t: Table): string {
  const k = kindOf(key)
  if (k === 'passOdds' || k === 'comeOdds') {
    const n = k === 'passOdds' ? t.point! : numOf(key)
    return `Odds on the ${n} are capped at ${ODDS_MAX[n]}× the bet they back (${fmt(max, max % 1 ? 2 : 0)})`
  }
  if (k === 'dontPassOdds' || k === 'dontComeOdds') return `Lay odds may win up to ${LAY_MAX_WIN}× the bet they back (${fmt(max, max % 1 ? 2 : 0)} here)`
  return `Limit reached: ${fmt(max, 0)} on ${betName(key)}`
}

/* ---------------- the stickman ---------------- */

export type CallTone = 'win' | 'lose' | 'point' | 'plain'
export interface Call {
  big: string
  small?: string
  tone: CallTone
}

/** the stickman's call for a roll, as he'd sing it out over the table */
export function stickCall(r: Pick<RollResult, 'dice' | 'before' | 'event'>): Call {
  const t = totalOf(r.dice)
  const hard = isHard(r.dice)
  const point = r.before.point
  const word = NUM_WORD[t]
  switch (r.event) {
    case 'natural':
      return t === 7 ? { big: 'Seven, winner!', small: 'Front line winner, pay the line', tone: 'win' } : { big: 'Yo-leven!', small: 'Front line winner', tone: 'win' }
    case 'craps':
      return t === 2 ? { big: 'Aces, craps!', small: 'Two, line away', tone: 'lose' } : t === 3 ? { big: 'Craps, ace-deuce!', small: 'Three, line away', tone: 'lose' } : { big: 'Boxcars!', small: "Twelve craps, the don'ts are barred", tone: 'lose' }
    case 'point-set':
      return { big: `Point is ${word}, mark it!`, small: hard ? `${cap(word)} the hard way` : `${r.dice[0]} and ${r.dice[1]}, ${word}`, tone: 'point' }
    case 'point-made':
      return { big: hard ? `Hard ${word}, winner!` : `${cap(word)}, winner!`, small: 'The point is made, pay the line', tone: 'win' }
    case 'seven-out':
      return { big: 'Seven out, line away!', small: 'New shooter coming out', tone: 'lose' }
    case 'roll':
      break
  }
  // a roll that decides nothing on the line, with the point on
  const on = point ? ` · point is ${point}` : ''
  switch (t) {
    case 2:
      return { big: 'Aces!', small: `Craps two${on}`, tone: 'plain' }
    case 3:
      return { big: 'Ace-deuce!', small: `Craps three${on}`, tone: 'plain' }
    case 11:
      return { big: 'Yo-leven!', small: `Eleven${on}`, tone: 'plain' }
    case 12:
      return { big: 'Boxcars!', small: `Twelve craps${on}`, tone: 'plain' }
    case 4:
      return hard ? { big: 'Hard four!', small: `Little Joe, two and two${on}`, tone: 'plain' } : { big: 'Easy four', small: `Four${on}`, tone: 'plain' }
    case 5:
      return { big: 'Five, no field five', small: point ? `Point is ${point}` : undefined, tone: 'plain' }
    case 6:
      return hard ? { big: 'Hard six!', small: `Three and three${on}`, tone: 'plain' } : { big: 'Easy six', small: `Six${on}`, tone: 'plain' }
    case 8:
      return hard ? { big: 'Hard eight!', small: `Four and four${on}`, tone: 'plain' } : { big: 'Easy eight', small: `Eight${on}`, tone: 'plain' }
    case 9:
      return { big: 'Nina, center field!', small: `Nine${on}`, tone: 'plain' }
    case 10:
      return hard ? { big: 'Hard ten!', small: `Five and five${on}`, tone: 'plain' } : { big: 'Easy ten', small: `Ten${on}`, tone: 'plain' }
    default:
      return { big: cap(word), tone: 'plain' }
  }
}

/** a roll in words, for notices and the screen reader: "3 and 4, seven out" */
export function rollWords(dice: Roll, event: RollResult['event'], before: Num | null): string {
  const t = totalOf(dice)
  const what =
    event === 'natural'
      ? 'a natural'
      : event === 'craps'
        ? 'craps'
        : event === 'point-set'
          ? `point is ${t}`
          : event === 'point-made'
            ? `the ${t} made`
            : event === 'seven-out'
              ? 'seven out'
              : `${t}${isHard(dice) && t !== 2 && t !== 12 ? ' the hard way' : ''}${before ? `, point ${before}` : ''}`
  return `${dice[0]} and ${dice[1]}, ${what}`
}
