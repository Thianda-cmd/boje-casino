/*
  Reef Raid rules. A fish-table arcade game: sea creatures swim across the reef, the player fires bubble torpedoes
  from a cannon, and each torpedo bursts into a net on the first creature it touches. Every shot costs its cannon
  level's price in coins (COSTS, 1 to 100). A netted creature is caught with chance RTP / value, and a catch pays
  value × the shot's cost, so every shot returns exactly RTP whatever it hits: aiming at a shark instead of a clownfish
  only changes the odds and the size of the win, never what a shot is worth.

  Specials:
  - Bomb crab: if caught it blows up and also catches every ordinary creature in its blast (the scene says which:
    those within BLAST_RADIUS at that moment). Its value is its own 10 plus theirs, all decided as one catch.
  - Zap jelly: if caught, lightning jumps to up to CHAIN_MAX ordinary creatures within CHAIN_RANGE, nearest first.
    Value 5 plus theirs.
  - Treasure chest: if caught, a treasure wheel spins one of WHEEL's equal segments. It is caught with chance
    RTP / mean(WHEEL), so it returns RTP like everything else.
  "Ordinary" means kind 'fish' or 'boss' (the Golden Whale counts; specials never set each other off).

  The catch is decided the moment a net touches a creature, from that moment's snapshot (`resolveHit`); nothing the
  scene shows afterwards can change it. A torpedo that never touches anything (it fizzles after BULLET_LIFE seconds)
  gets its cost back.

  Money: each shot's cost is taken from the balance as it is fired and each catch is paid into it at once, except
  the treasure chest's: its win is owed until its wheel lands a few seconds later (so the balance doesn't give the
  wheel away), and a page that closes before then pays it on the way out like a torpedo still in the water. Shots are
  recorded as rounds in batches (a bet record every BATCH_SHOTS shots, or when the player stops for BATCH_IDLE_MS), so
  the history isn't flooded. The `Ledger` below keeps that bookkeeping; tools/reef-test.ts checks it never loses or
  invents a coin, plus every return above.
*/

import { round2 } from '../../lib/format'

export const RTP = 0.97

/** cannon levels: the coins one shot costs */
export const COSTS = [1, 2, 5, 10, 25, 50, 100] as const
export type Cost = (typeof COSTS)[number]

export type FishId = 'clown' | 'tang' | 'puffer' | 'angel' | 'seahorse' | 'turtle' | 'octopus' | 'manta' | 'shark' | 'whale' | 'crab' | 'jelly' | 'chest'
export type FishKind = 'fish' | 'boss' | 'bomb' | 'chain' | 'chest'

export interface Species {
  id: FishId
  name: string
  kind: FishKind
  /** what a catch is worth on its own, × the shot's cost (the chest's is the wheel's mean) */
  mult: number
  /** one line for the paytable */
  blurb: string
  /** the creature's main colour, for UI chips and coins */
  color: string
}

export const WHEEL = [20, 25, 30, 40, 50, 60, 80, 150] as const
export const WHEEL_MEAN = WHEEL.reduce((a, b) => a + b, 0) / WHEEL.length

export const SPECIES: readonly Species[] = [
  { id: 'clown', name: 'Clownfish', kind: 'fish', mult: 2, blurb: 'Small, quick and always in a crowd.', color: '#ff8a2a' },
  { id: 'tang', name: 'Blue tang', kind: 'fish', mult: 3, blurb: 'Swims in bright blue schools.', color: '#2f7cff' },
  { id: 'puffer', name: 'Pufferfish', kind: 'fish', mult: 4, blurb: 'Puffs up when a net brushes past.', color: '#f2d04b' },
  { id: 'angel', name: 'Angelfish', kind: 'fish', mult: 6, blurb: 'Tall stripy fins, drifts slowly.', color: '#ffd84a' },
  { id: 'seahorse', name: 'Seahorse', kind: 'fish', mult: 8, blurb: 'Bobs upright through the reef.', color: '#ff6fa8' },
  { id: 'turtle', name: 'Sea turtle', kind: 'fish', mult: 12, blurb: 'Old, wise and in no hurry.', color: '#46c37b' },
  { id: 'octopus', name: 'Octopus', kind: 'fish', mult: 20, blurb: 'Jets across the reef in bursts.', color: '#c46bff' },
  { id: 'manta', name: 'Manta ray', kind: 'fish', mult: 30, blurb: 'Glides on huge wing fins.', color: '#3a5f9e' },
  { id: 'shark', name: 'Hammerhead', kind: 'fish', mult: 60, blurb: 'The reef bully. Big win, rare catch.', color: '#7d93a8' },
  { id: 'whale', name: 'Golden Whale', kind: 'boss', mult: 200, blurb: 'Surfaces now and then. The biggest prize on the reef.', color: '#ffc93c' },
  { id: 'crab', name: 'Bomb crab', kind: 'bomb', mult: 10, blurb: 'Caught, it blows up and nets everything in the blast.', color: '#ff4b3e' },
  { id: 'jelly', name: 'Zap jelly', kind: 'chain', mult: 5, blurb: 'Caught, its lightning nets up to 6 creatures nearby.', color: '#7ef0ff' },
  { id: 'chest', name: 'Treasure chest', kind: 'chest', mult: WHEEL_MEAN, blurb: 'Caught, it spins the treasure wheel for 20× to 150×.', color: '#c8862e' },
]

const BY_ID = new Map<string, Species>(SPECIES.map((s) => [s.id, s]))
export const speciesOf = (id: FishId) => BY_ID.get(id)!
export const isFishId = (x: unknown): x is FishId => typeof x === 'string' && BY_ID.has(x)
/** creatures a bomb blast or a lightning chain can catch */
export const isOrdinary = (id: FishId) => {
  const k = speciesOf(id).kind
  return k === 'fish' || k === 'boss'
}

/* ---------------- the reef, in reef units ---------------- */

/**
 * The wide play field, FIELD.w × FIELD.h reef units centred on 0 with the cannon at the bottom centre. The scene picks
 * the field shape that suits the stage (field.ts: this one, or a squarer or taller one of about the same area);
 * nothing below depends on which.
 */
export const FIELD = { w: 16, h: 9 } as const
export const BLAST_RADIUS = 2.6
export const CHAIN_RANGE = 4.2
export const CHAIN_MAX = 6
/** a torpedo that hasn't touched anything after this many seconds fizzles and its cost comes back */
export const BULLET_LIFE = 8
/** at most this many torpedoes in the water at once */
export const MAX_BULLETS = 24
/** fastest fire, shots per second (holding the trigger, or auto fire) */
export const FIRE_RATE = 5

/* ---------------- a hit ---------------- */

/**
 * What a catch on this hit is worth (× the shot's cost). `extras` are the other creatures the scene found in the blast
 * (bomb crab) or chain (zap jelly) at the moment of the hit, nearest first; anything that can't be caught along
 * (specials, and chain links beyond CHAIN_MAX) is dropped. For the chest it is the wheel's mean.
 */
export function eligibleExtras(target: FishId, extras: readonly FishId[]): FishId[] {
  const k = speciesOf(target).kind
  if (k !== 'bomb' && k !== 'chain') return []
  const ok = extras.filter(isOrdinary)
  return k === 'chain' ? ok.slice(0, CHAIN_MAX) : ok
}

export function hitValue(target: FishId, extras: readonly FishId[]): number {
  return speciesOf(target).mult + eligibleExtras(target, extras).reduce((a, id) => a + speciesOf(id).mult, 0)
}

/** the chance a net on this hit catches */
export const catchChance = (value: number) => Math.min(1, RTP / value)

export interface HitOutcome {
  caught: boolean
  /** the catch's value used for the chance (× cost) */
  value: number
  /** what it pays, × the shot's cost (0 if it got away) */
  mult: number
  /** the creatures caught along with the target (empty when it got away) */
  extras: FishId[]
  /** the chest's wheel segment (index into WHEEL), when a chest was caught */
  wheel?: number
}

/** decides a hit: one draw for the catch, and a second for the wheel when a chest is caught */
export function resolveHit(target: FishId, extras: readonly FishId[], rng: () => number): HitOutcome {
  const value = hitValue(target, extras)
  const caught = rng() < catchChance(value)
  if (!caught) return { caught: false, value, mult: 0, extras: [] }
  if (speciesOf(target).kind === 'chest') {
    const wheel = Math.min(WHEEL.length - 1, Math.floor(rng() * WHEEL.length))
    return { caught: true, value, mult: WHEEL[wheel], extras: [], wheel }
  }
  return { caught: true, value, mult: value, extras: eligibleExtras(target, extras) }
}

export const payoutFor = (cost: number, mult: number) => round2(cost * mult)

/* ---------------- the ledger ---------------- */

/** a catch of the Golden Whale with a shot at least this big counts for the Whale Tamer challenge */
export const WHALE_CHALLENGE_COST = 25
/** a bet record every this many shots (about 20 s of holding the trigger, so the 60-entry history isn't flooded) */
export const BATCH_SHOTS = 100
/** or once the player has stopped (no torpedo in the water) for this long */
export const BATCH_IDLE_MS = 3000

/**
 * The shots since the last bet record. Plain data, so it can be saved as is (the screen keeps a copy in
 * localStorage, and a crash or closed tab is squared up on the next visit with `recover`).
 */
export interface Ledger {
  /** coins riding on torpedoes still in the water (already taken from the balance) */
  inflight: number
  /** torpedoes still in the water */
  bullets: number
  /** the cost of the shots that landed since the last record */
  bet: number
  /** what they caught (paid into the balance, or owed) */
  payout: number
  /** catches won but not yet paid into the balance (a chest whose wheel is still spinning); carried until paid */
  owed: number
  shots: number
  catches: number
  /** the creatures caught, by id */
  caught: Partial<Record<FishId, number>>
  /** the biggest single-shot win, × its cost */
  best: number
  /** the largest shot cost that caught the Golden Whale (0 if none) */
  whaleCost: number
}

export const emptyLedger = (): Ledger => ({ inflight: 0, bullets: 0, bet: 0, payout: 0, owed: 0, shots: 0, catches: 0, caught: {}, best: 0, whaleCost: 0 })

/** a torpedo left the cannon; its cost has just been taken from the balance */
export function fired(l: Ledger, cost: number): Ledger {
  return { ...l, inflight: round2(l.inflight + cost), bullets: l.bullets + 1 }
}

/**
 * A torpedo hit something and the hit was resolved. The caller pays a catch's payout into the balance at once, or,
 * when `later` (a chest: its win shows as its wheel lands), the ledger holds it as owed until `paidOwed`.
 */
export function landed(l: Ledger, cost: number, target: FishId, o: HitOutcome, later = false): Ledger {
  const pay = o.caught ? payoutFor(cost, o.mult) : 0
  const caught = { ...l.caught }
  if (o.caught) for (const id of [target, ...o.extras]) caught[id] = (caught[id] ?? 0) + 1
  return {
    ...l,
    inflight: round2(Math.max(0, l.inflight - cost)),
    bullets: Math.max(0, l.bullets - 1),
    bet: round2(l.bet + cost),
    payout: round2(l.payout + pay),
    owed: later ? round2(l.owed + pay) : l.owed,
    shots: l.shots + 1,
    catches: l.catches + (o.caught ? 1 + o.extras.length : 0),
    caught,
    best: o.caught ? Math.max(l.best, o.mult) : l.best,
    whaleCost: o.caught && (target === 'whale' || o.extras.includes('whale')) ? Math.max(l.whaleCost, cost) : l.whaleCost,
  }
}

/** a torpedo fizzled without touching anything; the caller refunds `cost` */
export function fizzled(l: Ledger, cost: number): Ledger {
  return { ...l, inflight: round2(Math.max(0, l.inflight - cost)), bullets: Math.max(0, l.bullets - 1) }
}

/** `amount` of what was owed (see landed) is about to be paid into the balance by the caller */
export function paidOwed(l: Ledger, amount: number): Ledger {
  return { ...l, owed: round2(Math.max(0, l.owed - amount)) }
}

/**
 * Whether it's time for a bet record: enough shots, or the player stopped, every torpedo has landed and every win has
 * been paid (so the record never shows a win before the balance does).
 */
export function due(l: Ledger, idleMs: number): boolean {
  if (l.shots >= BATCH_SHOTS) return true
  return l.shots > 0 && l.bullets === 0 && l.owed === 0 && idleMs >= BATCH_IDLE_MS
}

export interface BatchRecord {
  bet: number
  payout: number
  /** all of it is paid into the balance outside the record: as it was caught, or (owed) once its wheel lands */
  prepaid: number
  meta: { shots: number; catches: number; best: number; whaleCost: number; whale: boolean }
}

/**
 * The bet record for the landed shots, and the ledger that carries on (torpedoes in the water and wins still owed
 * stay in it).
 */
export function flush(l: Ledger): { record: BatchRecord | null; next: Ledger } {
  const next: Ledger = { ...emptyLedger(), inflight: l.inflight, bullets: l.bullets, owed: l.owed }
  if (l.shots === 0) return { record: null, next }
  return {
    record: {
      bet: l.bet,
      payout: l.payout,
      prepaid: l.payout,
      meta: { shots: l.shots, catches: l.catches, best: l.best, whaleCost: l.whaleCost, whale: l.whaleCost > 0 },
    },
    next,
  }
}

/**
 * Squaring up a ledger whose torpedoes will never land (the page is closing, or it was left behind by a crash): the
 * coins still in the water and any win still owed go to the player, and the landed shots get their record.
 */
export function recover(l: Ledger): { refund: number; record: BatchRecord | null } {
  const { record } = flush(l)
  return { refund: round2(l.inflight + l.owed), record }
}

/** a saved ledger read back, or null if it isn't one */
export function parseLedger(raw: unknown): Ledger | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const num = (k: string) => (typeof o[k] === 'number' && Number.isFinite(o[k]) && (o[k] as number) >= 0 ? (o[k] as number) : null)
  const fields = ['inflight', 'bullets', 'bet', 'payout', 'shots', 'catches', 'best', 'whaleCost'] as const
  const vals = fields.map(num)
  if (vals.some((v) => v === null)) return null
  // `owed` came later: a ledger saved before it has none
  const owed = o.owed === undefined ? 0 : num('owed')
  if (owed === null) return null
  const caught: Partial<Record<FishId, number>> = {}
  if (o.caught && typeof o.caught === 'object') for (const [k, v] of Object.entries(o.caught)) if (isFishId(k) && typeof v === 'number' && v > 0) caught[k] = Math.floor(v)
  const [inflight, bullets, bet, payout, shots, catches, best, whaleCost] = vals as number[]
  return { inflight, bullets, bet, payout, owed, shots, catches, caught, best, whaleCost }
}

/* ---------------- labels ---------------- */

export const chanceLabel = (value: number) => {
  const p = catchChance(value) * 100
  return `${p >= 10 ? p.toFixed(1) : p >= 1 ? p.toFixed(2) : p.toFixed(3)}%`
}
export const multLabel = (m: number) => `${Number.isInteger(m) ? m : m.toFixed(1)}×`
