import { fmt } from '../../lib/format'
import { DARTS, MAX_TOTAL, outlook, type Throwing } from './rules'

/*
  What the screen reads off a paytable (rules.ts works the tables out; nothing here changes what anything pays).

  The ladder beside the board shows a handful of steps, each a total and what reaching it pays at least ("101+
  pays 3.85×"): par (the smallest paying total), the first total that pays the stake back, the totals where the pay
  first passes 2×, 5×, 10×, 25× and so on, the big jumps, and last the first total of the top step (the highest
  total worth showing, rules.ts's `top`, and everything that pays the same). A step is dropped when it pays no more
  than the one below it, and on a small screen the least telling steps go first. Every step is a floor: a total
  pays its own entry in the table, which is never less than the step it has reached.

  `reach` is the live part: given the total so far and the darts left, the chance of ending on each total or more
  (outlook() from rules.ts, summed from the top).
*/

/** the first total that pays at least the stake back (or the top, should none) */
export function breakEven(t: Throwing): number {
  for (let s = t.par; s <= t.top; s++) if (t.pays[s] >= 1) return s
  return t.top
}

/** the first total of the top step: the lowest total paying what the top total pays */
export function topStep(t: Throwing): number {
  let s = t.top
  while (s > t.par && t.pays[s - 1] === t.pays[t.top]) s--
  return s
}

const MARKS = [2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

/** the ladder's steps, lowest first: at most `max` totals */
export function stepsOf(t: Throwing, max: number): number[] {
  const keep = new Set([t.par, breakEven(t), topStep(t)])
  const all = new Set(keep)
  const first = (m: number) => {
    for (let s = t.par; s <= t.top; s++) if (t.pays[s] >= m) return s
    return -1
  }
  for (const m of MARKS) {
    const s = first(m)
    if (s > 0) all.add(s)
  }
  // the big jumps, where a total pays several times what the one under it does
  for (let s = t.par + 1; s <= t.top; s++) if (t.pays[s - 1] > 0 && t.pays[s] / t.pays[s - 1] >= 2.5) all.add(s)
  let steps = [...all].filter((s) => s >= t.par && s <= t.top).sort((a, b) => a - b)
  // a step paying no more than the one below it says nothing new
  steps = steps.filter((s, i) => i === 0 || t.pays[s] > t.pays[steps[i - 1]])
  while (steps.length > max) {
    // drop the step that adds least: the smallest rise over the step below it (the kept ones stay)
    let worst = -1
    let low = Infinity
    for (let i = 1; i < steps.length; i++) {
      if (keep.has(steps[i])) continue
      const rise = t.pays[steps[i]] / t.pays[steps[i - 1]]
      if (rise < low) {
        low = rise
        worst = i
      }
    }
    if (worst < 0) break
    steps.splice(worst, 1)
  }
  return steps
}

/** the chance of ending on each total or more, from `sofar` with `left` darts to come */
export function reach(t: Throwing, sofar: number, left: number): Float64Array {
  const dist = outlook(t, sofar, left)
  const out = new Float64Array(MAX_TOTAL + 2)
  let run = 0
  for (let s = MAX_TOTAL; s >= 0; s--) {
    run += dist[s] ?? 0
    out[s] = Math.min(1, run)
  }
  return out
}
/** before any dart is thrown */
export const reachAtStart = (t: Throwing) => reach(t, 0, DARTS)

/** a chance as the ladder prints it: "42%", "4.1%", "0.42%", "1 in 5.4K" */
export function chanceText(p: number): string {
  if (p >= 0.9995) return '100%'
  if (p <= 0) return '–'
  if (p >= 0.1) return `${Math.round(p * 100)}%`
  if (p >= 0.01) return `${(p * 100).toFixed(1)}%`
  if (p >= 0.001) return `${(p * 100).toFixed(2)}%`
  const n = 1 / p
  if (n >= 1e6) return `1 in ${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`
  if (n >= 1e3) return `1 in ${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}K`
  return `1 in ${fmt(n, 0)}`
}

/** a multiplier as the game prints it: "0.89×", "4.3×", "41.5×", "1,975×" */
export function multText(m: number): string {
  if (m >= 1000) return `${fmt(m, 0)}×`
  if (m >= 100) return `${Math.round(m * 10) / 10}×`
  return `${Number(m.toFixed(2))}×`
}

/** the paytable as runs of totals paying the same, par to top, for the info sheet */
export function runsOf(t: Throwing): { from: number; to: number; pays: number; chance: number }[] {
  const out: { from: number; to: number; pays: number; chance: number }[] = []
  let s = t.par
  while (s <= t.top) {
    let e = s
    while (e + 1 <= t.top && t.pays[e + 1] === t.pays[s]) e++
    let p = 0
    for (let x = s; x <= e; x++) p += t.total[x]
    out.push({ from: s, to: e, pays: t.pays[s], chance: p })
    s = e + 1
  }
  return out
}
