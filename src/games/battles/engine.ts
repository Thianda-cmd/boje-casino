import { CRATES, WEIGHT_TOTAL, type Tier } from '../cases/rules'
import { SEATS, type BattleView, type Mode } from './types'

/*
  The Case Battles rules as pure functions: drawing the items, the totals, who wins and what each seat is paid. The
  offline stand-in (local.ts) runs battles on them, and the battle view uses the tallies to show the race as it plays.
  They mirror the cb_* functions in api/_lib/schema.js: multipliers are whole hundredths, the pot is unit × the sum of
  every multiplier (floored to the cent, like _cb_settle), and each winner gets floor(pot / winners × 100) / 100.
*/

/** the house bots, in the order the server names them, with their avatars */
export const BOTS: { name: string; avatar: number }[] = [
  { name: 'Otis', avatar: 2 },
  { name: 'Hazel', avatar: 5 },
  { name: 'Barnaby', avatar: 9 },
  { name: 'Juniper', avatar: 12 },
  { name: 'Mabel', avatar: 7 },
  { name: 'Pip', avatar: 3 },
  { name: 'Nova', avatar: 14 },
  { name: 'Rocco', avatar: 10 },
]

/** the item a uniform integer 0..99,999 draws from a crate: its index */
export function itemFor(tier: Tier, x: number): number {
  const items = CRATES[tier].items
  let r = Math.max(0, Math.min(WEIGHT_TOTAL - 1, Math.floor(x)))
  for (let i = 0; i < items.length; i++) {
    r -= items[i].weight
    if (r < 0) return i
  }
  return items.length - 1
}

/** the item a multiplier came from (the server sends multipliers); the closest one if the tables ever disagree */
export function itemOfMult(tier: Tier, mult: number): number {
  const items = CRATES[tier].items
  let best = 0
  for (let i = 1; i < items.length; i++) if (Math.abs(items[i].mult - mult) < Math.abs(items[best].mult - mult)) best = i
  return best
}

/** hundredths, so sums stay exact */
const cents = (x: number) => Math.round(x * 100)

/** 0 or 1 for the two teams of a 2v2; every seat is its own side otherwise */
export const sideOf = (mode: Mode, seat: number) => (mode === '2v2' ? (seat <= 2 ? 0 : 1) : seat - 1)

export interface Outcome {
  /** each seat's total multiplier */
  totals: number[]
  winners: number[]
  payouts: number[]
  pot: number
}

/** Who wins and what everyone is paid, from results[seat - 1][round]. */
export function decide(mode: Mode, crazy: boolean, unit: number, results: number[][]): Outcome {
  const tc = results.map((r) => r.reduce((a, m) => a + cents(m), 0))
  const all = tc.reduce((a, t) => a + t, 0)
  // unit × Σ multipliers floored to the cent, in cents (cents(unit) × all is a whole number of ten-thousandths)
  const potC = Math.floor((cents(unit) * all) / 100)
  const sides = new Map<number, number>()
  tc.forEach((t, i) => sides.set(sideOf(mode, i + 1), (sides.get(sideOf(mode, i + 1)) ?? 0) + t))
  const vals = [...sides.values()]
  const best = crazy ? Math.min(...vals) : Math.max(...vals)
  const winners = tc.map((_, i) => i + 1).filter((s) => sides.get(sideOf(mode, s)) === best)
  const share = Math.floor(potC / winners.length) / 100
  return { totals: tc.map((t) => t / 100), winners, payouts: tc.map((_, i) => (winners.includes(i + 1) ? share : 0)), pot: potC / 100 }
}

/** Draws every seat's items for a battle (`draw` gives uniform integers 0..99,999). */
export function drawResults(mode: Mode, cases: Tier[], draw: () => number): number[][] {
  return Array.from({ length: SEATS[mode] }, () => cases.map((t) => CRATES[t].items[itemFor(t, draw())].mult))
}

/* ---------------- the race as it plays ---------------- */

/** a battle's clock: when each round's reels start and land */
export const SPIN_MS = 4000

export const roundStart = (b: BattleView, r: number) => (b.startAt ?? 0) + r * b.roundMs
export const roundLand = (b: BattleView, r: number) => roundStart(b, r) + Math.min(SPIN_MS, b.roundMs - 400)

/** how many rounds have landed by `now` */
export function landedBy(b: BattleView, now: number): number {
  if (b.startAt == null || !b.results) return 0
  let n = 0
  while (n < b.cases.length && roundLand(b, n) <= now) n++
  return n
}

/** the round whose reels are on screen at `now` (spinning or just landed), or -1 before the first */
export function roundAt(b: BattleView, now: number): number {
  if (b.startAt == null || now < b.startAt) return -1
  return Math.min(b.cases.length - 1, Math.floor((now - b.startAt) / b.roundMs))
}

/** each seat's total over the first `n` rounds */
export function totalsAfter(b: BattleView, n: number): number[] {
  return b.seats.map((_, i) => (b.results?.[i] ?? []).slice(0, n).reduce((a, m) => a + cents(m), 0) / 100)
}

/** the seats ahead after `n` rounds (sides for a 2v2), or [] when nothing has landed or everyone is level */
export function leadersAfter(b: BattleView, n: number): number[] {
  if (n <= 0 || !b.results) return []
  const t = totalsAfter(b, n).map(cents)
  const sides = new Map<number, number>()
  t.forEach((v, i) => sides.set(sideOf(b.mode, i + 1), (sides.get(sideOf(b.mode, i + 1)) ?? 0) + v))
  const vals = [...sides.values()]
  const best = b.crazy ? Math.min(...vals) : Math.max(...vals)
  if (vals.every((v) => v === best)) return []
  return t.map((_, i) => i + 1).filter((s) => sides.get(sideOf(b.mode, s)) === best)
}

/** what a battle costs each seat */
export const costOf = (unit: number, cases: Tier[]) => Math.round(cents(unit) * cases.length) / 100
