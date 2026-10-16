/*
  Live Blackjack contracts shared by the network layer (net.ts), the local stand-in (local.ts on top of engine.ts)
  and the screen. The JSON shapes match what the database functions in api/_lib/schema.js return.
*/

export const TIMING = {
  BET_MS: 12000,
  ALL_IN_MS: 1500,
  CLOSE_EARLY_MS: 150,
  SHUFFLE_MS: 2500,
  DEAL_LEAD_MS: 400,
  CARD_MS: 380,
  DEAL_SETTLE_MS: 500,
  PEEK_MS: 1200,
  TURN_MS: 15000,
  HIT_TURN_MS: 8000,
  AWAY_TURN_MS: 4000,
  TURN_GRACE_MS: 600,
  BUST_NEXT_MS: 450,
  DOUBLE_NEXT_MS: 500,
  SPLIT_CARD0_MS: 300,
  SPLIT_CARD1_MS: 650,
  SPLIT_TURN_MS: 900,
  HOLE_MS: 500,
  DRAW_MS: 850,
  RESULT_LAG_MS: 800,
  RESULT_MS: 5000,
  LOOK_MS: 1000,
  AWAY_MS: 10000,
  STALE_SEAT_MS: 30000,
  WAIT_SEAT_MS: 90000,
  IDLE_ROUNDS: 3,
  HEARTBEAT_MS: 3000,
  REACTION_SHOW_MS: 3000,
  REACTION_GAP_MS: 1500,
  REACTION_WINDOW_MS: 15000,
  REACTION_MAX: 6,
} as const

export const REACTIONS = ['thumbs', 'haha', 'wow', 'cry', 'fire', 'clap', 'clover', 'cool', 'nice', 'gl', 'hitme', 'ouch', 'hot', 'gg', 'ty', 'hurry'] as const
export type ReactionCode = (typeof REACTIONS)[number]
export type Phase = 'waiting' | 'betting' | 'dealing' | 'turns' | 'dealer' | 'done'
export type Outcome = 'win' | 'lose' | 'push' | 'blackjack' | 'bust'
export type Act = 'hit' | 'stand' | 'double' | 'split'
export type BjError =
  | 'player'
  | 'table'
  | 'seat'
  | 'busy'
  | 'taken'
  | 'retry'
  | 'not-seated'
  | 'other-tab'
  | 'leaving'
  | 'already'
  | 'stale'
  | 'closed'
  | 'min'
  | 'max'
  | 'turn'
  | 'dealing'
  | 'invalid'
  | 'rate'
  | 'network'

/** player cards: flip is always null */
export interface CardView {
  c: number | null
  at: number
  flip: number | null
}
export interface HandView {
  seat: number
  idx: 0 | 1
  name: string
  avatar: number
  guest: boolean
  mine: boolean
  ctl: boolean
  bet: number
  doubled: boolean
  split: boolean
  done: boolean
  auto: boolean
  cards: CardView[]
  outcome: Outcome | null
  payout: number | null
}
export interface SeatView {
  seat: number
  name: string
  avatar: number
  guest: boolean
  me: boolean
  away: boolean
  idle: number
  leaving: boolean
  /** local stand-in only */
  bot?: boolean
}
export interface RoundView {
  id: number
  ver: number
  phase: Phase
  openedAt: number
  betEndsAt: number | null
  dealEndsAt: number | null
  shuffle: boolean
  peek: boolean
  turn: { seat: number; hand: 0 | 1; at: number; endsAt: number; away: boolean } | null
  resultsAt: number | null
  nextAt: number | null
}
export interface TableFeed {
  now: number
  etag: string
  table: { id: number; name: string; min: number; max: number; seats: number; cardsLeft: number; shoeNo: number; watchers: number }
  round: RoundView
  dealer: CardView[]
  seats: (SeatView | null)[]
  hands: HandView[]
  mine: { table: number; seat: number; active: boolean; idle: number; leaving: boolean; expiresAt: number | null } | null
  reactions: { id: number; seat: number; code: ReactionCode; at: number }[]
  history: { id: number; total: number; bj: boolean }[]
  past: { round: number; table: number; bet: number; payout: number }[]
}
export interface LobbyTable {
  id: number
  name: string
  min: number
  max: number
  seats: number
  players: { seat: number; name: string; avatar: number; guest: boolean }[]
  watchers: number
  phase: 'waiting' | 'betting' | 'playing' | 'done'
  betEndsAt: number | null
}
export interface LobbyFeed {
  now: number
  tables: LobbyTable[]
  mine: { table: number; seat: number; active: boolean } | null
}
export interface RoundDetail {
  id: number
  table: number
  at: number
  dealer: number[]
  hands: {
    seat: number
    idx: 0 | 1
    name: string
    avatar: number
    guest: boolean
    bet: number
    cards: number[]
    doubled: boolean
    split: boolean
    auto: boolean
    outcome: Outcome
    payout: number
  }[]
}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type Res<T = {}> =
  | ({ ok: true; state?: TableFeed } & T)
  | { ok: false; error: BjError; state?: TableFeed; round?: number; bet?: number; table?: number; seat?: number }
export type RoundResult = { state: 'done'; table: number; bet: number; payout: number } | { state: 'live' | 'none' | 'gone' }
export class TableGone extends Error {}

export interface TableServer {
  readonly online: boolean
  /**
   * What stakes on these tables are filed under in the ledger (ledger.ts keyOf): 'shared', or 'local:<id>' for one run
   * of the offline tables. Empty while another tab runs the offline tables: nothing is staked or settled from here then.
   */
  readonly book: string
  /** the offline tables only: they run in one tab at a time */
  readonly host?: TableHost
  /** this tab's seat token, or null (passive) */
  sid(table: number): string | null
  /** become passive (duplicate tab) */
  dropSid(table: number): void
  /** throws on network errors */
  tables(): Promise<LobbyFeed>
  /** throws TableGone on {error:'table'}; Error otherwise */
  state(table: number): Promise<TableFeed>
  sit(table: number, seat: number, name: string): Promise<Res<{ seat: number; sid: string }>>
  claim(table: number): Promise<Res>
  leave(table: number): Promise<Res<{ cancelled?: number; leaving?: boolean; gone?: boolean; round?: number }>>
  /** fire-and-forget keepalive */
  away(table: number): void
  bet(table: number, round: number, amount: number): Promise<Res<{ round: number; bet: number }>>
  act(table: number, round: number, hand: 0 | 1, n: number, action: Act): Promise<Res>
  react(table: number, code: ReactionCode): Promise<Res<{ id: number; at: number }>>
  result(round: number, guest?: string): Promise<RoundResult>
  roundInfo(round: number): Promise<RoundDetail | null>
}

/** Which tab runs the offline tables (local.ts). Two tabs each running a copy would answer for each other's rounds. */
export interface TableHost {
  /** takes the tables if they are free; settles once this tab knows whether it runs them */
  ask(): Promise<void>
  /** another tab runs them: this one can only offer to take them over */
  readonly elsewhere: boolean
  /** while Live Blackjack is open: keep the tables (or wait for them to come free) and hear about changes. Returns the release. */
  use(onChange: () => void): () => void
  /** Play here: take the tables over from the other tab */
  take(): Promise<void>
}

/** card id 0..51: rank c % 13 (0 = A … 12 = K), suit floor(c / 13) in ♠ ♥ ♦ ♣ order */
export const RANK_OF = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const
export const SUIT_OF = ['♠', '♥', '♦', '♣'] as const
export const cardOf = (c: number) => ({ rank: RANK_OF[c % 13], suit: SUIT_OF[Math.floor(c / 13)] })
