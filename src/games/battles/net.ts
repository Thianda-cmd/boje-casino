import { backend, rpc } from '../../lib/backend'
import { guestAvatar, guestId } from '../../lib/identity'
import { TIERS, type Tier } from '../cases/rules'
import { BattleGone, MODES, TIMING, type BattleServer, type BattleView, type CbError, type CbRes, type CbResult, type ListFeed, type Mode, type SeatView, type Status } from './types'

/* Where Case Battles come from: the shared battles in the database when it answers (the cb_* functions in
   api/_lib/schema.js), otherwise the offline stand-in (local.ts), where only the house bots play. This file only calls
   them and turns their JSON into the types in types.ts. The stand-in is its own chunk, fetched only when needed. */

const num = (v: unknown) => (v == null ? null : Number(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const STATUSES: Status[] = ['open', 'running', 'done', 'cancelled']

function seat(s: any, i: number): SeatView | null {
  if (!s) return null
  return { seat: Number(s.seat ?? i + 1), name: String(s.name ?? ''), avatar: Number(s.avatar ?? 0), guest: !!s.guest, bot: !!s.bot, me: !!s.me }
}

export function viewOf(raw: any): BattleView {
  if (raw == null || raw.id == null) throw new Error('no battle')
  const mode: Mode = MODES.includes(raw.mode) ? raw.mode : '1v1'
  const cases = list(raw.cases).filter((t): t is Tier => TIERS.includes(t))
  const results = Array.isArray(raw.results) ? raw.results.map((r: unknown) => list(r).map(Number)) : null
  return {
    now: Number(raw.now ?? Date.now()),
    id: Number(raw.id),
    status: STATUSES.includes(raw.status) ? raw.status : 'open',
    mode,
    crazy: !!raw.crazy,
    unit: Number(raw.unit),
    cases,
    cost: Number(raw.cost),
    seats: list(raw.seats).map(seat),
    createdAt: Number(raw.createdAt),
    expiresAt: Number(raw.expiresAt ?? Number(raw.createdAt) + TIMING.OPEN_MS),
    startAt: num(raw.startAt),
    roundMs: Number(raw.roundMs ?? TIMING.ROUND_MS),
    endAt: num(raw.endAt),
    results,
    winners: Array.isArray(raw.winners) ? raw.winners.map(Number) : null,
    payouts: Array.isArray(raw.payouts) ? raw.payouts.map(Number) : null,
    pot: num(raw.pot),
  }
}

function feedOf(raw: any): ListFeed {
  if (!raw || !Array.isArray(raw.open)) throw new Error('no feed')
  const now = Number(raw.now ?? Date.now())
  const views = (v: unknown) => list(v).map((b) => viewOf({ now, ...b }))
  return { now, open: views(raw.open), live: views(raw.live), recent: views(raw.recent), mine: views(raw.mine) }
}

const ERRORS: CbError[] = ['player', 'invalid', 'limit', 'gone', 'started', 'full', 'taken', 'already', 'not-seated']

/** A write: its answer, or `network` when the outcome is unknown (thrown, timed out or an answer we can't read). */
async function call<T extends object>(name: string, args: Record<string, unknown>, ms: number, shape: (r: any) => T): Promise<CbRes<T>> {
  try {
    const r = await rpc<any>(name, args, ms)
    if (r?.ok === true) return { ok: true, ...shape(r) }
    if (r?.ok === false && ERRORS.includes(r.error)) return { ok: false, error: r.error }
    return { ok: false, error: 'network' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

const withBattle = (r: any) => ({ battle: viewOf(r.battle) })

const shared: BattleServer = {
  online: true,
  list: async () => feedOf(await rpc('cb_list', { p_player: guestId }, 4500)),
  state: async (id) => {
    const raw = await rpc<any>('cb_state', { p_battle: id, p_player: guestId }, 4500)
    if (raw?.error === 'gone') throw new BattleGone()
    return viewOf(raw)
  },
  create: (a) =>
    call('cb_create', { p_player: guestId, p_name: a.name, p_avatar: guestAvatar(), p_mode: a.mode, p_crazy: a.crazy, p_unit: a.unit, p_cases: a.cases }, 7000, withBattle),
  join: (id, seat, name) => call('cb_join', { p_battle: id, p_player: guestId, p_name: name, p_avatar: guestAvatar(), p_seat: seat }, 7000, withBattle),
  bots: (id) => call('cb_bots', { p_battle: id, p_player: guestId }, 7000, withBattle),
  leave: (id) => call('cb_leave', { p_battle: id, p_player: guestId }, 7000, (r) => ({ cancelled: !!r.cancelled })),
  result: async (id): Promise<CbResult> => {
    const r = await rpc<any>('cb_result', { p_battle: id, p_player: guestId }, 4500)
    if (r?.state === 'done') return { state: 'done', cost: Number(r.cost), payout: Number(r.payout) }
    if (['open', 'running', 'cancelled', 'none', 'gone'].includes(r?.state)) return { state: r.state }
    throw new Error('bad result')
  },
}

let local: Promise<BattleServer> | null = null
/** The offline stand-in, loaded on first use. A failed fetch isn't kept, though browsers may keep it until a reload. */
export function localServer(): Promise<BattleServer> {
  return (local ??= import('./local').then(
    (m) => m.localServer(),
    (e) => {
      local = null
      throw e
    },
  ))
}

/** The shared battles if the database answers, otherwise the offline stand-in. Rejects only if the stand-in could not be fetched. */
export async function connect(): Promise<BattleServer> {
  return (await tryShared()) ?? localServer()
}

/** Try the shared battles again (the Retry button while playing offline). */
export async function tryShared(): Promise<BattleServer | null> {
  try {
    if (!(await backend())) return null
    await shared.list()
    return shared
  } catch {
    return null
  }
}
