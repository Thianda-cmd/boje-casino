import { backend, rpc } from '../../lib/backend'
import { restAuth } from '../../lib/account'
import { guestAvatar, guestId } from '../../lib/identity'
import { TableGone, type CardView, type HandView, type LobbyFeed, type Res, type RoundDetail, type RoundResult, type TableFeed, type TableServer } from './types'

/* Where Live Blackjack tables come from: the shared tables in the database when it answers, otherwise
   the local stand-in (local.ts) with house bots. Every function the shared tables run lives in
   api/_lib/schema.js; this file only calls them and turns their JSON into the types in types.ts.
   The stand-in (with the rules engine and the bots) is its own chunk, fetched only when it is needed. */

const num = (v: unknown) => (v == null ? null : Number(v))
const list = (v: unknown): any[] => (Array.isArray(v) ? v : [])

const card = (c: any): CardView => ({ c: num(c?.c), at: Number(c?.at), flip: num(c?.flip) })

function hand(h: any): HandView {
  return {
    seat: Number(h.seat),
    idx: Number(h.idx) === 1 ? 1 : 0,
    name: String(h.name ?? ''),
    avatar: Number(h.avatar ?? 0),
    guest: !!h.guest,
    // the shared tables seat only accounts and guests
    acct: !h.guest,
    mine: !!h.mine,
    ctl: !!h.ctl,
    bet: Number(h.bet),
    doubled: !!h.doubled,
    split: !!h.split,
    done: !!h.done,
    auto: !!h.auto,
    cards: list(h.cards).map(card),
    outcome: h.outcome ?? null,
    payout: num(h.payout),
  }
}

function feedOf(raw: any): TableFeed {
  if (!raw?.round) throw new Error('no round')
  const r = raw.round
  const t = raw.table ?? {}
  return {
    now: Number(raw.now),
    etag: String(raw.etag ?? ''),
    table: {
      id: Number(t.id),
      name: String(t.name ?? ''),
      min: Number(t.min),
      max: Number(t.max),
      seats: Number(t.seats ?? 5),
      cardsLeft: Number(t.cardsLeft ?? 0),
      shoeNo: Number(t.shoeNo ?? 0),
      watchers: Number(t.watchers ?? 0),
    },
    round: {
      id: Number(r.id),
      ver: Number(r.ver),
      phase: r.phase,
      openedAt: Number(r.openedAt),
      betEndsAt: num(r.betEndsAt),
      dealEndsAt: num(r.dealEndsAt),
      shuffle: !!r.shuffle,
      peek: !!r.peek,
      turn: r.turn
        ? { seat: Number(r.turn.seat), hand: Number(r.turn.hand) === 1 ? 1 : 0, at: Number(r.turn.at), endsAt: Number(r.turn.endsAt), away: !!r.turn.away }
        : null,
      resultsAt: num(r.resultsAt),
      nextAt: num(r.nextAt),
    },
    dealer: list(raw.dealer).map(card),
    seats: list(raw.seats).map((s) =>
      s
        ? {
            seat: Number(s.seat),
            name: String(s.name ?? ''),
            avatar: Number(s.avatar ?? 0),
            guest: !!s.guest,
            acct: !s.guest,
            me: !!s.me,
            away: !!s.away,
            idle: Number(s.idle ?? 0),
            leaving: !!s.leaving,
            ...(s.bot ? { bot: true } : {}),
          }
        : null,
    ),
    hands: list(raw.hands).map(hand),
    mine: raw.mine
      ? {
          table: Number(raw.mine.table),
          seat: Number(raw.mine.seat),
          active: !!raw.mine.active,
          idle: Number(raw.mine.idle ?? 0),
          leaving: !!raw.mine.leaving,
          expiresAt: num(raw.mine.expiresAt),
        }
      : null,
    reactions: list(raw.reactions).map((x) => ({ id: Number(x.id), seat: Number(x.seat), code: x.code, at: Number(x.at) })),
    history: list(raw.history).map((x) => ({ id: Number(x.id), total: Number(x.total), bj: !!x.bj })),
    past: list(raw.past).map((x) => ({ round: Number(x.round), table: Number(x.table), bet: Number(x.bet), payout: Number(x.payout) })),
  }
}

function lobbyOf(raw: any): LobbyFeed {
  if (!Array.isArray(raw?.tables)) throw new Error('no tables')
  return {
    now: Number(raw.now),
    tables: raw.tables.map((t: any) => ({
      id: Number(t.id),
      name: String(t.name ?? ''),
      min: Number(t.min),
      max: Number(t.max),
      seats: Number(t.seats ?? 5),
      players: list(t.players).map((p) => ({ seat: Number(p.seat), name: String(p.name ?? ''), avatar: Number(p.avatar ?? 0), guest: !!p.guest })),
      watchers: Number(t.watchers ?? 0),
      phase: t.phase,
      betEndsAt: num(t.betEndsAt),
    })),
    mine: raw.mine ? { table: Number(raw.mine.table), seat: Number(raw.mine.seat), active: !!raw.mine.active } : null,
  }
}

/** A write: its answer, or `network` when the outcome is unknown (thrown, timed out or refused by the server). */
async function call<T>(name: string, args: Record<string, unknown>, ms: number): Promise<Res<T>> {
  try {
    const r = await rpc<any>(name, args, ms)
    if (!r || typeof r.ok !== 'boolean') return { ok: false, error: 'network' }
    const out: any = { ...r }
    for (const k of ['round', 'bet', 'table', 'seat', 'cancelled', 'id', 'at']) if (out[k] != null) out[k] = Number(out[k])
    if (r.state) out.state = feedOf(r.state)
    return out
  } catch {
    return { ok: false, error: 'network' }
  }
}

/* ---------- this tab's seat token ---------- */

// one seat per player, so one entry; sessionStorage keeps it across reloads but not in other tabs
const SID_KEY = 'lumen.livebj.sid'
function storedSid(): { table: number; sid: string } | null {
  try {
    const v = JSON.parse(sessionStorage.getItem(SID_KEY) ?? 'null')
    return v && typeof v.table === 'number' && typeof v.sid === 'string' ? v : null
  } catch {
    return null
  }
}
function storeSid(v: { table: number; sid: string } | null) {
  try {
    if (v) sessionStorage.setItem(SID_KEY, JSON.stringify(v))
    else sessionStorage.removeItem(SID_KEY)
  } catch {
    /* storage blocked: the seat lasts as long as the page */
  }
}

/** The table this tab holds a seat token for, if any. */
export const sidTable = () => storedSid()?.table ?? null

/** A duplicated tab copies sessionStorage, sid included. The older tab answers the newcomer's hello and the newcomer goes passive. */
let channel: BroadcastChannel | null = null
function watchTabs(): Promise<void> {
  if (channel || typeof BroadcastChannel === 'undefined') return Promise.resolve()
  channel = new BroadcastChannel('lumen.livebj')
  let helloAt = 0
  channel.onmessage = (e: MessageEvent) => {
    const m = e.data
    const s = storedSid()
    if (!s || m?.sid !== s.sid) return
    if (m.type === 'hello') channel?.postMessage({ type: 'mine', sid: s.sid })
    else if (m.type === 'mine' && Date.now() - helloAt < 300) storeSid(null)
  }
  const s = storedSid()
  if (!s) return Promise.resolve()
  helloAt = Date.now()
  channel.postMessage({ type: 'hello', sid: s.sid })
  return new Promise((r) => setTimeout(r, 300))
}

/* ---------- the shared tables ---------- */

const etags = new Map<number, TableFeed>()

const shared: TableServer = {
  online: true,
  book: 'shared',
  sid: (t) => {
    const s = storedSid()
    return s && s.table === t ? s.sid : null
  },
  dropSid: (t) => {
    if (storedSid()?.table === t) storeSid(null)
  },
  tables: async () => lobbyOf(await rpc('bj_tables', { p_player: guestId, p_sid: storedSid()?.sid ?? null }, 4500)),
  state: async (t) => {
    const prev = etags.get(t)
    const raw = await rpc<any>('bj_state', { p_table: t, p_player: guestId, p_sid: shared.sid(t), p_etag: prev?.etag || null }, 4500)
    if (raw?.error === 'table') throw new TableGone()
    if (raw?.same && prev) return { ...prev, now: Number(raw.now) }
    const f = feedOf(raw)
    etags.set(t, f)
    return f
  },
  sit: async (t, seat, name) => {
    // `retry`: another tab moved the seat between the read and the lock; once more settles it
    for (let i = 0; ; i++) {
      const r = await call<{ seat: number; sid: string }>('bj_sit', { p_table: t, p_seat: seat, p_player: guestId, p_sid: shared.sid(t), p_name: name, p_avatar: guestAvatar() }, 6000)
      if (r.ok) storeSid({ table: t, sid: String(r.sid) })
      if (r.ok || r.error !== 'retry' || i > 0) return r
    }
  },
  claim: (t) => call('bj_claim', { p_table: t, p_guest: guestId, p_sid: shared.sid(t) }, 6000),
  leave: async (t) => {
    const r = await call<{ cancelled?: number; leaving?: boolean; gone?: boolean; round?: number }>('bj_leave', { p_table: t, p_player: guestId, p_sid: shared.sid(t) }, 6000)
    // leaving mid-round keeps the seat (and this tab's control of it) until the round is over
    if (r.ok && !r.leaving) storeSid(null)
    return r
  },
  away: (t) => {
    const sid = shared.sid(t)
    const auth = restAuth()
    if (!sid || !auth) return
    // the same bearer rule as api/selftest.js: new-style publishable keys are not JWTs
    const bearer = auth.token ?? (auth.key.startsWith('eyJ') ? auth.key : null)
    fetch(`${auth.url}/rest/v1/rpc/bj_away`, {
      method: 'POST',
      keepalive: true,
      headers: { apikey: auth.key, 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      body: JSON.stringify({ p_table: t, p_player: guestId, p_sid: sid }),
    }).catch(() => {})
  },
  bet: (t, round, amount) => call('bj_bet', { p_table: t, p_round: round, p_player: guestId, p_sid: shared.sid(t), p_amount: amount }, 6000),
  act: (t, round, h, n, action) => call('bj_action', { p_table: t, p_round: round, p_player: guestId, p_sid: shared.sid(t), p_hand: h, p_n: n, p_action: action }, 6000),
  react: (t, code) => call('bj_react', { p_table: t, p_player: guestId, p_code: code }, 4500),
  result: async (round, guest): Promise<RoundResult> => {
    const r = await rpc<any>('bj_result', { p_round: round, p_player: guestId, p_guest: guest ?? null }, 4500)
    return r?.state === 'done' ? { state: 'done', table: Number(r.table), bet: Number(r.bet), payout: Number(r.payout) } : { state: r?.state === 'gone' || r?.state === 'none' ? r.state : 'live' }
  },
  roundInfo: async (round): Promise<RoundDetail | null> => {
    const r = await rpc<any>('bj_round_info', { p_round: round }, 4500)
    if (!r) return null
    return {
      id: Number(r.id),
      table: Number(r.table),
      at: Number(r.at),
      dealer: list(r.dealer).map(Number),
      hands: list(r.hands).map((h) => ({
        seat: Number(h.seat),
        idx: Number(h.idx) === 1 ? 1 : 0,
        name: String(h.name ?? ''),
        avatar: Number(h.avatar ?? 0),
        guest: !!h.guest,
        acct: !h.guest,
        bet: Number(h.bet),
        cards: list(h.cards).map(Number),
        doubled: !!h.doubled,
        split: !!h.split,
        auto: !!h.auto,
        outcome: h.outcome,
        payout: Number(h.payout),
      })),
    }
  },
}

let local: Promise<TableServer> | null = null
/**
 * The local stand-in, loaded on first use, once it knows whether this tab runs the offline tables or another tab does.
 * A failed fetch isn't kept here, though browsers may keep it until a reload.
 */
async function localServer(): Promise<TableServer> {
  const s = await (local ??= import('./local').then(
    (m) => m.localServer(),
    (e) => {
      local = null
      throw e
    },
  ))
  await s.host?.ask()
  return s
}

/** The shared tables if the database answers, otherwise the local stand-in. Rejects only if the stand-in could not be fetched. */
export async function connect(): Promise<TableServer> {
  return (await tryShared()) ?? localServer()
}

/** Try the shared tables again (the Retry button while playing offline). */
export async function tryShared(): Promise<TableServer | null> {
  try {
    if (!(await backend())) return null
    await shared.tables()
    await watchTabs()
    return shared
  } catch {
    return null
  }
}
