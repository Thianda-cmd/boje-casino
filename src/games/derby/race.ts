/*
  Duck Derby race plans: how the race looks, built around a finishing order that is already drawn.

  The race runs on its own clock t, in which the winner crosses the line at t = 1. Every duck gets a speed profile:
  a burst out of the gate, a handful of random surges and lulls, and its share of the course's moments (a duck that
  bonks the log nearly stops, one caught in the whirlpool crawls while it spins, one riding a wave surges). The
  profile is integrated and scaled so the duck reaches the line exactly at its finishing time; finishing times follow
  the drawn order, with second place a whisker behind the winner (the photo finish) and the rest strung out behind.
  Many candidate races are built and scored for drama (lead changes, a comeback or a duel down the stretch, the pack
  close enough to keep on screen, every moment happening where the camera can see it) and the best one is raced.
  Course features that only one duck meets (the log, the whirlpool) are placed where that duck will be.
*/
import { DUCKS, LANES } from './rules'

/** where things are on the course, as progress from the start (0) to the finish line (1) */
export const COURSE = { rapids: [0.155, 0.275] as const, falls: 0.585, finish: 1 }
/** the course in duck lengths, start to finish */
export const COURSE_DL = 72
/** the clock runs to here, so the field can coast past the line */
export const T_END = 1.32

const STEP = 0.001
const N = Math.round(T_END / STEP) + 1
const COARSE = 0.006
const NC = Math.round(T_END / COARSE) + 1

/** whirlpool, wave and log windows on the clock */
const WHIRL = { from: [0.4, 0.455], len: 0.082 } as const
const WAVE = { from: [0.655, 0.715], len: 0.075 } as const
const LOG = { from: [0.3, 0.355], len: 0.028 } as const

export type Script = 'comeback' | 'duel' | 'wire'

export interface Caption {
  t: number
  text: string
  /** higher wins when two would show at once */
  pri: number
  kind: 'start' | 'lead' | 'rapids' | 'log' | 'whirl' | 'falls' | 'wave' | 'stretch' | 'close'
}

export interface Plan {
  /** lanes, first to last */
  order: number[]
  /** clock time each lane reaches the line */
  finish: number[]
  /** progress samples per lane, every STEP of the clock */
  prog: Float32Array[]
  log: { lane: number; hop: number; x: number; t: number }
  whirl: { lane: number; x: number; t0: number; t1: number }
  wave: { lane: number; t0: number; t1: number }
  captions: Caption[]
  script: Script
  /** how far second place is behind the winner as the winner crosses, in duck lengths */
  gapDL: number
  leadChanges: number
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => x * x * (3 - 2 * x)
/** 1 inside [a, b], easing in and out over `e` at either end */
const inWin = (t: number, a: number, b: number, e: number) => smooth(clamp01((t - a) / e)) * smooth(clamp01((b - t) / e))

interface Draft {
  order: number[]
  finish: number[]
  bumps: { a: number; c: number; w: number }[][]
  log: { lane: number; hop: number; t: number }
  whirl: { lane: number; t0: number }
  wave: { lane: number; t0: number }
  script: Script
}

function speed(d: Draft, lane: number, t: number) {
  let v = 0.3 + 0.7 * smooth(clamp01(t / 0.07))
  let s = 1
  for (const b of d.bumps[lane]) {
    const z = (t - b.c) / b.w
    s += b.a * Math.exp(-z * z)
  }
  v *= Math.max(0.35, s)
  if (lane === d.whirl.lane) v *= 1 - 0.8 * inWin(t, d.whirl.t0, d.whirl.t0 + WHIRL.len, 0.012)
  if (lane === d.wave.lane) v *= 1 + 0.85 * inWin(t, d.wave.t0, d.wave.t0 + WAVE.len, 0.016)
  if (lane === d.log.lane) v *= 1 - 0.93 * inWin(t, d.log.t, d.log.t + LOG.len, 0.006)
  // past the line the duck coasts to a stop
  const f = d.finish[lane]
  if (t > f) v *= Math.exp(-(t - f) / 0.04)
  return v
}

/** integrates every lane's speed on a grid of `step`, scaled so each lane reaches 1 at its finishing time */
function integrate(d: Draft, step: number, n: number): Float32Array[] {
  return d.finish.map((f, lane) => {
    const raw = new Float64Array(n)
    let prev = speed(d, lane, 0)
    for (let i = 1; i < n; i++) {
      const v = speed(d, lane, i * step)
      raw[i] = raw[i - 1] + ((prev + v) / 2) * step
      prev = v
    }
    const k = f / step
    const i0 = Math.floor(k)
    const atF = raw[i0] + (raw[Math.min(n - 1, i0 + 1)] - raw[i0]) * (k - i0)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = raw[i] / atF
    return out
  })
}

function sample(arr: Float32Array, step: number, t: number) {
  const k = Math.max(0, Math.min(arr.length - 1, t / step))
  const i = Math.floor(k)
  const j = Math.min(arr.length - 1, i + 1)
  return arr[i] + (arr[j] - arr[i]) * (k - i)
}

/** lanes in race order at clock t: those past the line by when they crossed, the rest by progress */
function rankOf(prog: Float32Array[], finish: number[], step: number, t: number) {
  const key = prog.map((p, lane) => (t >= finish[lane] ? 10 - finish[lane] : sample(p, step, t)))
  return [...key.keys()].sort((a, b) => key[b] - key[a])
}

function draft(order: number[], script: Script, rand: () => number): Draft {
  const finish = new Array<number>(LANES)
  finish[order[0]] = 1
  let f = 1 + 0.0016 + rand() * 0.0085
  finish[order[1]] = f
  f += 0.004 + rand() * 0.016
  finish[order[2]] = f
  for (let k = 3; k < LANES; k++) {
    f += 0.005 + rand() * 0.026
    finish[order[k]] = f
  }
  const bumps = order.map(() =>
    Array.from({ length: 5 }, () => ({ a: (rand() * 2 - 1) * 0.17, c: 0.05 + rand() * 0.9, w: 0.035 + rand() * 0.07 })),
  )
  const lanes = [...Array(LANES).keys()]
  const pick = (from: number[]) => from[Math.floor(rand() * from.length)]
  const whirl = pick(lanes)
  const wave = pick(lanes.filter((l) => l !== whirl))
  const log = pick(lanes.filter((l) => l !== whirl && l !== wave))
  const hop = log === 0 ? 1 : log === LANES - 1 ? LANES - 2 : log + (rand() < 0.5 ? -1 : 1)
  return {
    order,
    finish,
    bumps,
    script,
    whirl: { lane: whirl, t0: WHIRL.from[0] + rand() * (WHIRL.from[1] - WHIRL.from[0]) },
    wave: { lane: wave, t0: WAVE.from[0] + rand() * (WAVE.from[1] - WAVE.from[0]) },
    log: { lane: log, hop, t: LOG.from[0] + rand() * (LOG.from[1] - LOG.from[0]) },
  }
}

/** leader changes on the coarse samples, counting only leads held for two samples or more */
function leaders(prog: Float32Array[], finish: number[], step: number) {
  const seq: number[] = []
  for (let t = 0.06; t <= 0.995; t += 0.02) seq.push(rankOf(prog, finish, step, t)[0])
  let changes = 0
  let cur = seq[0]
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] !== cur && seq[i] === seq[i + 1]) {
      changes++
      cur = seq[i]
    }
  }
  return { seq, changes }
}

/** how good a race this would make; -100 and below breaks the course */
function score(d: Draft, prog: Float32Array[], rand: () => number) {
  const at = (lane: number, t: number) => sample(prog[lane], COARSE, t)
  const lead = (t: number) => Math.max(...prog.map((_, l) => at(l, t)))
  const rank = (t: number) => rankOf(prog, d.finish, COARSE, t)
  const [w, r] = d.order
  let s = rand() * 0.6

  // the course: every moment where it belongs
  const logX = at(d.log.lane, d.log.t + 0.014)
  const whirlX = at(d.whirl.lane, d.whirl.t0 + WHIRL.len / 2)
  const whirlOut = at(d.whirl.lane, d.whirl.t0 + WHIRL.len)
  const waveIn = at(d.wave.lane, d.wave.t0)
  const waveOut = at(d.wave.lane, d.wave.t0 + WAVE.len)
  if (logX < COURSE.rapids[1] + 0.02 || logX > 0.42) s -= 100
  if (whirlX < 0.38 || whirlOut > COURSE.falls - 0.03) s -= 100
  if (waveIn < COURSE.falls + 0.04 || waveOut > 0.86) s -= 100

  // and close enough to the leader for the camera to catch it
  const seen = (lane: number, t: number) => Math.max(0, lead(t) - at(lane, t) - 0.045)
  s -= 160 * (seen(d.log.lane, d.log.t) + seen(d.whirl.lane, d.whirl.t0 + 0.01) + seen(d.wave.lane, d.wave.t0 + 0.02))

  // lead changes: a few, not a carousel
  const { seq, changes } = leaders(prog, d.finish, COARSE)
  s += changes >= 2 && changes <= 5 ? 4 : changes === 1 ? 0.5 : changes > 5 ? 4 - (changes - 5) * 1.5 : -3

  // the pack stays together enough to film
  let spread = 0
  for (let t = 0.1; t <= 0.92; t += 0.04) {
    const ps = prog.map((_, l) => at(l, t))
    spread = Math.max(spread, Math.max(...ps) - Math.min(...ps))
  }
  s -= Math.max(0, spread - 0.085) * 140
  const top3 = d.order.slice(0, 3).map((l) => at(l, 0.965))
  s -= Math.max(0, Math.max(...top3) - Math.min(...top3) - 0.03) * 100

  // the story down the stretch
  if (d.script === 'comeback') {
    if (rank(0.78).indexOf(w) >= 2) s += 4
    if (rank(0.9).indexOf(w) >= 1) s += 1.5
  } else if (d.script === 'duel') {
    let swaps = 0
    let prev = -1
    for (let t = 0.8; t <= 0.996; t += 0.008) {
      const a = at(w, t)
      const b = at(r, t)
      const cur = a >= b ? w : r
      if (prev !== -1 && cur !== prev) swaps++
      prev = cur
    }
    s += Math.min(swaps, 3) * 1.6
    if (rank(0.95)[0] === r) s += 1.5
  } else {
    const share = seq.filter((l) => l === w).length / seq.length
    if (share > 0.6) s += 3
    if (at(w, 0.97) - at(r, 0.97) < 0.008) s += 2
  }
  if (d.script !== 'wire' && rank(0.3)[0] !== w) s += 1
  // a contender caught in the whirlpool, a wave that carries someone into the frame
  if (rank(d.whirl.t0).indexOf(d.whirl.lane) <= 2) s += 0.7
  if (d.order.indexOf(d.wave.lane) <= 2) s += 1
  return s
}

/** builds the race for a drawn finishing order */
export function planRace(order: number[], rand: () => number, candidates = 36): Plan {
  const steps = planning(order, rand, candidates)
  let r = steps.next()
  while (!r.done) r = steps.next()
  return r.value
}

/**
 * The same, a candidate at a time: each `next()` scores one candidate race and the last one returns the plan, so the
 * page can spread the work over the countdown instead of stalling the Start press.
 */
export function* planning(order: number[], rand: () => number, candidates = 36): Generator<void, Plan, void> {
  const r = rand()
  const script: Script = r < 0.45 ? 'comeback' : r < 0.8 ? 'duel' : 'wire'
  let best: Draft | null = null
  let bestScore = -Infinity
  // a course nothing fitted (never seen in testing) keeps trying until something does
  for (let i = 0; i < candidates || (bestScore <= -100 && i < candidates + 400); i++) {
    const d = draft(order, script, rand)
    const sc = score(d, integrate(d, COARSE, NC), rand)
    if (sc > bestScore) {
      bestScore = sc
      best = d
    }
    yield
  }
  const d = best!
  const prog = integrate(d, STEP, N)
  const at = (lane: number, t: number) => sample(prog[lane], STEP, t)
  const logX = at(d.log.lane, d.log.t + 0.014) + 0.42 / COURSE_DL
  const plan: Plan = {
    order,
    finish: d.finish,
    prog,
    script: d.script,
    log: { lane: d.log.lane, hop: d.log.hop, x: logX, t: d.log.t },
    whirl: { lane: d.whirl.lane, x: at(d.whirl.lane, d.whirl.t0 + WHIRL.len * 0.45), t0: d.whirl.t0, t1: d.whirl.t0 + WHIRL.len },
    wave: { lane: d.wave.lane, t0: d.wave.t0, t1: d.wave.t0 + WAVE.len },
    captions: [],
    gapDL: (1 - at(order[1], 1)) * COURSE_DL,
    leadChanges: leaders(prog, d.finish, STEP).changes,
  }
  plan.captions = commentary(plan, rand)
  return plan
}


export const progAt = (plan: Plan, lane: number, t: number) => sample(plan.prog[lane], STEP, t)
/** progress per unit of clock */
export const speedAt = (plan: Plan, lane: number, t: number) => (progAt(plan, lane, t + 0.002) - progAt(plan, lane, t - 0.002)) / 0.004
export const ranking = (plan: Plan, t: number) => rankOf(plan.prog, plan.finish, STEP, t)

/* ---------------- the commentary ---------------- */

const LINES = {
  start: ["And they're off!", 'Quack! And away they go!', "They're off and paddling!"],
  rapids: ['{a} leads them into the rapids!', 'White water! {a} first into the rapids!', 'Into the rapids, {a} out in front!'],
  log: ['Bonk! {a} paddles straight into the log!', 'Ouch! {a} meets the log head on!', '{a} bonks the log! That has to hurt.'],
  whirl: ['Oh no! {a} is caught in the whirlpool!', '{a} is spinning round and round!', 'The whirlpool has got {a}!'],
  falls: ['Over the falls they go!', 'Hold on to your hats, here come the falls!', 'Down the waterfall!'],
  wave: ['{a} catches a wave! Surf’s up!', 'Look at {a} ride that wave!', '{a} is surfing past them!'],
  stretch: ['Into the final stretch, {a} in front!', 'Here comes the finish, {a} leads!', 'The crowd is on its feet, {a} out front!'],
  lead: ['{a} takes the lead!', '{a} hits the front!', '{a} snatches the lead from {b}!', 'And now it’s {a} in front!'],
  close: ['{a} and {b}, nothing between them!', 'Neck and neck to the line!', "It's {b}! No, it's {a}! Too close to call!"],
}

function commentary(plan: Plan, rand: () => number): Caption[] {
  const name = (l: number) => DUCKS[l].name
  const say = (kind: Caption['kind'], t: number, pri: number, a?: number, b?: number): Caption => {
    const opts = LINES[kind]
    const text = opts[Math.floor(rand() * opts.length)].replace('{a}', a == null ? '' : name(a)).replace('{b}', b == null ? '' : name(b))
    return { t, text, pri, kind }
  }
  const lead = (t: number) => ranking(plan, t)[0]
  /** clock time the leader first reaches progress x */
  const leaderAt = (x: number) => {
    for (let t = 0; t < 1.2; t += 0.002) if (progAt(plan, lead(t), t) >= x) return t
    return 1
  }
  const out: Caption[] = [say('start', 0.012, 9)]
  const tr = leaderAt(COURSE.rapids[0] - 0.012)
  out.push(say('rapids', tr, 4, lead(tr)))
  out.push(say('log', plan.log.t + 0.006, 6, plan.log.lane))
  out.push(say('whirl', plan.whirl.t0 + 0.006, 7, plan.whirl.lane))
  out.push(say('falls', leaderAt(COURSE.falls - 0.018), 6))
  out.push(say('wave', plan.wave.t0 + 0.01, 6, plan.wave.lane))
  const ts = leaderAt(0.86)
  out.push(say('stretch', ts, 5, lead(ts)))
  const tc = leaderAt(0.955)
  out.push(say('close', tc, 7, plan.order[0], plan.order[1]))
  // lead changes held for a while
  let cur = lead(0.05)
  for (let t = 0.07; t < 0.95; t += 0.01) {
    const l = lead(t)
    if (l !== cur && lead(t + 0.03) === l) {
      out.push(say('lead', t, 3, l, cur))
      cur = l
    }
  }
  // keep the most important of any two that would crowd each other
  out.sort((a, b) => b.pri - a.pri || a.t - b.t)
  const kept: Caption[] = []
  for (const c of out) if (kept.every((k) => Math.abs(k.t - c.t) >= 0.055)) kept.push(c)
  return kept.sort((a, b) => a.t - b.t)
}
