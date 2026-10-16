import type { Tier } from '../cases/rules'

/*
  Case Battles contracts, shared by the network layer, the offline stand-in and the screens. The JSON shapes match
  what the cb_* database functions in api/_lib/schema.js return.

  A battle: every seat pays `cost` = unit × cases.length. When the last seat fills (a player joins or the creator
  calls bots) the server draws one item per seat per crate, in order, and the rounds play out on a shared clock:
  a countdown, then one round every `roundMs`. The highest total multiplier wins the whole pot (`crazy`: the lowest);
  in 2v2 the team totals decide and the winning pair splits it; a tie splits the pot between everyone tied.
*/

export type Mode = '1v1' | '1v1v1' | '1v1v1v1' | '2v2'
export const MODES: Mode[] = ['1v1', '1v1v1', '1v1v1v1', '2v2']
export const SEATS: Record<Mode, number> = { '1v1': 2, '1v1v1': 3, '1v1v1v1': 4, '2v2': 4 }

/** stored status; 'running' reads as 'done' once now >= endAt */
export type Status = 'open' | 'running' | 'done' | 'cancelled'

export const LIMITS = {
  MIN_UNIT: 1,
  MAX_UNIT: 10_000,
  MAX_CASES: 10,
  MAX_COST: 100_000,
  /** open battles a player may sit in at once */
  MAX_OPEN: 3,
} as const

export const TIMING = {
  /** countdown between the last seat filling and the first reels starting */
  COUNTDOWN_MS: 3000,
  /** one round: the reels spin for ~4 s, then a beat to show the items */
  ROUND_MS: 4800,
  /** after the last round, before the winner is shown */
  END_MS: 1500,
  /** an open battle nobody fills is cancelled after this */
  OPEN_MS: 15 * 60_000,
} as const

export interface SeatView {
  seat: number
  name: string
  avatar: number
  guest: boolean
  bot: boolean
  me: boolean
}

export interface BattleView {
  now: number
  id: number
  status: Status
  mode: Mode
  crazy: boolean
  /** stake per crate */
  unit: number
  /** one crate per round, in order */
  cases: Tier[]
  /** what each seat pays: unit × cases.length */
  cost: number
  /** seats[i] is seat i + 1, or null when empty */
  seats: (SeatView | null)[]
  createdAt: number
  /** open battles are cancelled at this time */
  expiresAt: number
  /** when the first round's reels start (the countdown runs before it); null while open */
  startAt: number | null
  roundMs: number
  /** when the winner is final and shown; null while open */
  endAt: number | null
  /** results[seat - 1][round] = multiplier; null while open (list feeds leave it null for open and live battles) */
  results: number[][] | null
  /** winning seats; null while open */
  winners: number[] | null
  /** coins paid to each seat, in seat order; null while open */
  payouts: number[] | null
  /** unit × the sum of every multiplier drawn; null while open */
  pot: number | null
}

export interface ListFeed {
  now: number
  /** waiting for players, newest first */
  open: BattleView[]
  /** running now */
  live: BattleView[]
  /** finished lately, newest first */
  recent: BattleView[]
  /** battles this player sits in that are open, running, or finished in the last 10 minutes */
  mine: BattleView[]
}

export type CbError = 'player' | 'invalid' | 'limit' | 'gone' | 'started' | 'full' | 'taken' | 'already' | 'not-seated' | 'network'
export type CbRes<T = object> = ({ ok: true } & T) | { ok: false; error: CbError }
export type CbResult = { state: 'done'; cost: number; payout: number } | { state: 'open' | 'running' | 'cancelled' | 'none' | 'gone' }

export interface BattleServer {
  readonly online: boolean
  list(): Promise<ListFeed>
  /** throws BattleGone on {error:'gone'}, Error on network errors */
  state(id: number): Promise<BattleView>
  create(a: { mode: Mode; crazy: boolean; unit: number; cases: Tier[]; name: string }): Promise<CbRes<{ battle: BattleView }>>
  join(id: number, seat: number | null, name: string): Promise<CbRes<{ battle: BattleView }>>
  bots(id: number): Promise<CbRes<{ battle: BattleView }>>
  leave(id: number): Promise<CbRes<{ cancelled: boolean }>>
  result(id: number): Promise<CbResult>
}

export class BattleGone extends Error {}

/** derived status: a running battle is done once its end time has passed */
export const statusAt = (b: BattleView, now: number): Status => (b.status === 'running' && b.endAt != null && now >= b.endAt ? 'done' : b.status)
