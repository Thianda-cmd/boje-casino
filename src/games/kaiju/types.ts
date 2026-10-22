import type * as THREE from 'three'
import type { Times } from './clock'

/*
  Kaiju Clash's shared types: what the rules, the fight script, the network, the 3D stage and the page agree on.

  Kaiju Clash is a live fight night. Every round, two of eight kaiju meet in Neon Bay, a small city on the water, and
  everyone bets on the same fight: who wins, how it ends (a knockout on land, a Splash into the bay, or the judges'
  decision after three rounds), which round it ends in, who lands the first strike, and how many buildings the fight
  flattens. Every selection is priced at its exact chance (rules.ts), so each one returns 97%.

  The fight is drawn from the round's key (fair.ts), revealed when betting closes, and acted out from a script drawn
  from the same key (fight.ts), so every browser sees the same fight, blow for blow.
*/

/** the eight kaiju (rules.ts ROSTER); the ids are stored in bets and history: never rename one */
export type KaijuId = 'rexor' | 'gorrath' | 'titan' | 'kraka' | 'lumina' | 'pincer' | 'bedrock' | 'voltra'

/** a corner: A (red, on the left) or B (blue, on the right) */
export type Side = 'a' | 'b'

/** how a fight ends: knocked out on land, thrown into the bay, or the judges' decision after three rounds */
export type Method = 'ko' | 'splash' | 'dec'

/** what a fighter is like; every stat is a whole number from 1 to 10 */
export interface Fighter {
  id: KaijuId
  name: string
  /** a few words under the name ("The Atomic King") */
  epithet: string
  /** one line about how it fights, for the tale of the tape */
  style: string
  /** its colours: body, belly or accent, glow (eyes, spines, beam) */
  colors: { body: string; accent: string; glow: string }
  /** knockout power */
  power: number
  /** grabs and throws: Splashes */
  grapple: number
  /** takes a hit: fewer knockouts against it */
  tough: number
  /** strikes first, dodges: fewer Splashes against it */
  speed: number
  /** how much of the city it wrecks */
  chaos: number
  /** its signature move, as the commentary names it */
  special: string
}

/*
  Selections. The server's kj_bet table checks a selection against this list (api/_lib/schema.js): never rename one.
    win:a, win:b                     the winner
    how:ko, how:splash, how:dec      how it ends, whoever wins
    exact:<side>-<method>            the winner and how (six)
    rnd:1, rnd:2, rnd:3              a knockout or Splash in that round
    rnd:dist                         it goes the distance (the judges' decision)
    first:a, first:b                 who lands the first strike
    dmg:over, dmg:under              buildings flattened, over or under the fight's line (a half number)
*/
export const SELS = [
  'win:a', 'win:b',
  'how:ko', 'how:splash', 'how:dec',
  'exact:a-ko', 'exact:a-splash', 'exact:a-dec', 'exact:b-ko', 'exact:b-splash', 'exact:b-dec',
  'rnd:1', 'rnd:2', 'rnd:3', 'rnd:dist',
  'first:a', 'first:b',
  'dmg:over', 'dmg:under',
] as const
export type Sel = (typeof SELS)[number]
export const isSel = (s: unknown): s is Sel => typeof s === 'string' && (SELS as readonly string[]).includes(s)

/** the markets, as the board groups the selections */
export type Market = 'win' | 'how' | 'exact' | 'rnd' | 'first' | 'dmg'
export const marketOf = (s: Sel): Market => s.slice(0, s.indexOf(':')) as Market

/** one player's stakes in a round, by selection */
export type Stakes = Partial<Record<Sel, number>>

/** a round's fight card: who fights, worked out from the round id alone (rules.ts matchupOf), so it is known ahead */
export interface Matchup {
  a: KaijuId
  b: KaijuId
  /** every tenth round is the Main Event: a bigger show, the same maths */
  main: boolean
}

/** a fight's prices: the chance of each selection and what it pays per coin staked (stake × mult) */
export interface Odds {
  /** the chance of each selection, 0 to 1 */
  p: Record<Sel, number>
  /** what each selection pays back per coin staked, the stake included: 0.97 / p rounded down to the cent, capped */
  mult: Record<Sel, number>
  /** the buildings line: dmg:over wins when more than this many buildings fall (always a half number) */
  line: number
}

/** how a fight came out: everything a bet is settled on */
export interface Result {
  winner: Side
  method: Method
  /** the round it ended in: 1 to 3 (always 3 for a decision) */
  round: 1 | 2 | 3
  /** who landed the first strike */
  first: Side
  /** how many buildings fell */
  damage: number
}

/*
  The fight script (fight.ts drawFight): the fight as it plays, from the moment the first round's bell rings. Times are
  ms from the bell (Times.fightAt); round k runs from roundStart(k) for ROUND_MS (clock.ts). Everything a browser shows
  comes from the script, so the health bars, the commentary, the buildings and the 3D stage always agree with the
  result.
*/

/** what a kaiju can do on stage; the rig (models) has a pose for each */
export type Action =
  | 'idle' // breathing, swaying
  | 'walk' // stepping forward (or back, with negative speed on the stage)
  | 'circle' // side-stepping round the other
  | 'roar' // head up, chest out
  | 'taunt' // a show-off gesture
  | 'jab' // a quick strike (claw, fist, pincer, tentacle)
  | 'heavy' // a big wind-up strike
  | 'tail' // a spinning tail whip (or the kaiju's sweeping attack)
  | 'charge' // a running body slam
  | 'grab' // seize the other
  | 'throw' // throw what it holds
  | 'beam' // its special: a breath, a laser, lightning, a gust
  | 'stomp' // smashing a building
  | 'block' // guard up
  | 'dodge' // sway out of the way
  | 'hit' // a flinch from a blow
  | 'stagger' // reeling back
  | 'knockdown' // falling down
  | 'down' // lying on the ground (looping)
  | 'getup' // getting back up
  | 'thrown' // flying through the air
  | 'sink' // floundering in the bay after a Splash (looping)
  | 'victory' // the winner's celebration (looping)

/** a beat of the fight: one kaiju doing one thing */
export interface FightEvent {
  /** ms from the first bell */
  t: number
  /** how long the action plays, ms */
  dur: number
  who: Side
  action: Action
  /** for strikes: whether it landed, was blocked or missed */
  outcome?: 'land' | 'block' | 'miss'
  /** health the other kaiju loses when it lands, 0 to 100 */
  dmg?: number
  /** where the kaiju is when the action ends, arena units (arena.ts), if it moves */
  to?: { x: number; z: number }
  /** a building this action flattens (an index into arena.ts BUILDINGS) */
  building?: number
  /** a hint for the camera and the effects */
  cue?: 'close' | 'wide' | 'shake' | 'slowmo' | 'splash' | 'flash'
  /** a line for the commentary (words.ts), if this beat deserves one */
  call?: string
}

/** a building falling: when, which, and who did it (counted in Result.damage) */
export interface Collapse {
  t: number
  building: number
  by: Side
}

/** the fight, from the first bell to the end of the show */
export interface Fight {
  result: Result
  /** every beat, in time order */
  events: FightEvent[]
  /** every building that falls, in time order; length = result.damage */
  collapses: Collapse[]
  /** health at the start of each round and after every blow lands: [t, healthA, healthB], in time order */
  health: [number, number, number][]
  /** when it is over: the knockout lands, the Splash hits the water, or the final bell (ms from the first bell) */
  endsAt: number
  /** a decision: each judge's score for A and B (three judges, 10-point must over three rounds); null otherwise */
  cards: [number, number][] | null
  /** where each kaiju starts the first round */
  start: { a: { x: number; z: number }; b: { x: number; z: number } }
}

/** what a round looks like to the stage */
export interface StageView {
  id: number
  matchup: Matchup
  times: Times
  /** the fight, once betting has closed and the key is known; null while betting */
  fight: Fight | null
}

/** things the stage tells the page as the fight plays (for sounds, the commentary and the overlays) */
export type StageEvent =
  | { kind: 'bell'; round: 1 | 2 | 3 }
  | { kind: 'land'; who: Side; heavy: boolean }
  | { kind: 'block'; who: Side }
  | { kind: 'collapse'; building: number; by: Side }
  | { kind: 'ko'; who: Side }
  | { kind: 'splash'; who: Side }
  | { kind: 'final' }
  | { kind: 'roar'; who: Side }

export interface StageProps {
  view: StageView | null
  /** the shared clock: server time in ms (net.ts serverNow) */
  now: () => number
  onEvent?: (e: StageEvent) => void
  className?: string
}

/*
  A kaiju's 3D rig (models/): built from primitives with the toon kit (src/lib/three/toon.ts), feet on y = 0, facing
  +z. The stage moves and turns `group`; the rig poses its own joints.
*/
export interface KaijuRig {
  id: KaijuId
  group: THREE.Group
  /** standing height in world units (about 9 to 13) */
  height: number
  /** how far its strikes reach from its centre */
  reach: number
  /** where a beam or breath comes from (a child of the head) */
  mouth: THREE.Object3D
  /** its striking points (hands, claws, pincers, tentacle tips), for impact effects */
  strikers: THREE.Object3D[]
  /** sets the joints for an action at progress t (0 to 1; looping actions repeat each unit), easing from the last
   *  pose over `blend` seconds so actions flow into each other; `time` is the scene clock in seconds (for breathing) */
  pose(action: Action, t: number, time: number, blend?: number): void
  /** a special charging up: its glow brightens (0 to 1) */
  charge(k: number): void
  /** a blow landing: a quick white flash (0 to 1) */
  flash(k: number): void
  dispose(): void
}

/** what a settled Kaiju Clash round tells the wallet (BetEvent.meta), for the history and the challenges */
export interface KaijuMeta {
  round: number
  a: KaijuId
  b: KaijuId
  winner: Side
  method: Method
  /** the round it ended in */
  ended: 1 | 2 | 3
  damage: number
  /** the selections that won, joined by commas (meta holds only plain values) */
  hits: string
  /** a winner bet won on a kaiju priced at 3× or more */
  upset: boolean
}
