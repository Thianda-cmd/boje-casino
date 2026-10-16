import { guestAvatar, guestId } from '../../lib/identity'
import { randInt, shuffle } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { createHouse, isBot } from './bots'
import {
  bjAction,
  bjAway,
  bjBet,
  bjLeave,
  bjReact,
  bjResult,
  bjRoundInfo,
  bjSit,
  bjState,
  bjTables,
  createDB,
  pruneRounds,
  seed,
  type DB,
  type Reply,
  type Rng,
  type View,
} from './engine'
import { hasPending } from './ledger'
import { TableGone, type Res, type TableFeed, type TableHost, type TableServer } from './types'

/*
  The local stand-in for the shared tables (offline, in the preview and in the single-file build): the same
  rules (engine.ts) run in this tab, with house bots (bots.ts) at the table the player has open. The table
  ticks every 100 ms. When timers were throttled in a background tab, the missed time is replayed in short
  slices so the bots keep their pace; a gap of more than a few minutes is skipped instead. The tables are
  saved to localStorage after every change and picked up again by the next page load within ten minutes, or
  later while someone still has a stake on them.

  One tab runs the tables at a time, under a Web Lock held while Live Blackjack is open there: two tabs each
  running a copy would answer for each other's rounds and settle stakes they never saw. Another tab shows
  Play here, which takes them over (and takes them by itself when brought to the front once they are free).
  Whichever tab takes them picks up the saved tables. Each set of tables has an id that the ledger files
  its stakes under, so a fresh set never answers for an old one's rounds.
*/

const SNAPSHOT_KEY = 'lumen.livebj.local'
const OWNER_KEY = 'lumen.livebj.local.owner' // the tab running the tables, for one that missed the handover
const LOCK = 'lumen.livebj.local'
const SID_KEY = 'lumen.livebj.local.sid'
const TICK_MS = 100
const SLICE_MS = 250
const REPLAY_MS = 3 * 60000 // longer gaps are skipped, not replayed
const IDLE_MS = 15000 // stop ticking once nothing has asked for the tables this long
const RESUME_MS = 10 * 60000
const KEEP_ROUNDS = 40
const HANDOVER_MS = 1500 // a reloading page waits this long for the old one to let go of the tables

const rng: Rng = {
  shoe: () => shuffle(Array.from({ length: 312 }, (_, i) => i % 52)),
  cut: () => 234 + randInt(27),
  uuid: () => Array.from({ length: 32 }, () => '0123456789abcdef'[randInt(16)]).join(''),
}

interface Snapshot {
  at: number
  seq: number
  /** this set of tables; stakes on it are filed under `local:<id>` */
  id: string
  db: DB
  /** the table the player last opened */
  table: number
}

function load(now: number): Snapshot | null {
  try {
    const s = JSON.parse(safeStorage.getItem(SNAPSHOT_KEY) ?? 'null') as Snapshot | null
    const ok = s && typeof s.at === 'number' && typeof s.id === 'string' && Array.isArray(s.db?.tables) && typeof s.db.seq?.round === 'number'
    // old tables still come back while a stake is open on them, so the round settles from its real hands
    if (ok && (now - s.at < RESUME_MS || hasPending(`local:${s.id}`))) return s
  } catch {
    /* unreadable: start over */
  }
  safeStorage.removeItem(SNAPSHOT_KEY)
  return null
}

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
    /* ignore */
  }
}

/** Another tab runs the tables. */
class Elsewhere extends Error {}

const timeout = (ms: number) => {
  const c = new AbortController()
  setTimeout(() => c.abort(), ms)
  return c.signal
}

let instance: TableServer | null = null

/** The local stand-in. One per page, so every connect() that falls back to it sees the same tables. */
export function localServer(): TableServer {
  return (instance ??= create())
}

function create(): TableServer {
  let db: DB = createDB()
  let id = ''
  let clock = 0
  let viewing = 1
  let seq = 0
  let saved = ''
  let lastUse = Date.now()
  let timer: ReturnType<typeof setInterval> | null = null
  let mySid = storedSid()
  let house = createHouse(guestAvatar())

  // the bots sit where the player sits, or else at the table the player has open
  const active = () => db.seats.find((s) => s.player === guestId)?.tableId ?? viewing

  /** brings the tables (and the bots) up to now, monotonically, and returns the engine time */
  function sync() {
    const now = Math.max(Date.now(), clock)
    if (now - clock > REPLAY_MS) clock = now - SLICE_MS
    while (clock < now) {
      clock = Math.min(now, clock + SLICE_MS)
      house.step(db, rng, clock, active())
    }
    return clock
  }

  function save(force = false) {
    if (hold !== 'here' || taken()) return
    pruneRounds(db, KEEP_ROUNDS)
    const json = JSON.stringify(db)
    if (json === saved && !force) return
    saved = json
    safeStorage.setItem(SNAPSHOT_KEY, `{"at":${clock},"seq":${++seq},"id":"${id}","table":${viewing},"db":${json}}`)
  }

  function wake() {
    lastUse = Date.now()
    if (timer != null) return
    timer = setInterval(() => {
      sync()
      save()
      if (Date.now() - lastUse < IDLE_MS) return
      stopTicking()
      // nothing has asked for a while and Live Blackjack isn't open here: let another tab have them
      if (!users) letGo()
    }, TICK_MS)
  }
  function stopTicking() {
    if (timer != null) clearInterval(timer)
    timer = null
  }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => save(true))

  /* ---------------- which tab runs the tables ---------------- */

  // Web Locks need a secure context (https, localhost, the app shell)
  const locks = (typeof navigator !== 'undefined' ? (navigator.locks as LockManager | undefined) : undefined) ?? null
  const token = rng.uuid()
  // idle: not holding them and not asked yet (or let go); elsewhere: another tab holds them
  let hold: 'idle' | 'here' | 'elsewhere' = 'idle'
  let release: (() => void) | null = null
  let asking: Promise<void> | null = null
  let users = 0
  const listeners = new Set<() => void>()
  const changed = () => listeners.forEach((fn) => fn())

  /** This tab runs the tables now: pick them up where the last tab left them. */
  function open() {
    const now = Date.now()
    const snap = load(now)
    // unless they are this tab's own, untouched since it let go
    if (!snap || snap.id !== id || snap.seq !== seq) {
      db = snap ? seed(snap.db) : createDB()
      id = snap?.id ?? rng.uuid().slice(0, 8)
      clock = snap?.at ?? now - SLICE_MS // a fresh table gets one step at once, so the bots are seated before the first answer
      viewing = snap?.table ?? viewing
      seq = snap?.seq ?? 0
      saved = ''
      house = createHouse(guestAvatar())
    }
    hold = 'here'
    safeStorage.setItem(OWNER_KEY, token)
    save(true)
    wake()
    changed()
  }

  /** Another tab took the tables over (Play here there): stop at once, without saving over them. */
  function lost() {
    if (hold !== 'here') return
    stopTicking()
    release?.()
    release = null
    elsewhere()
  }

  function elsewhere() {
    if (hold === 'elsewhere') return
    hold = 'elsewhere'
    changed()
  }

  /** A tab that was frozen in the background can miss the handover: the owner key tells it. */
  function taken() {
    const owner = safeStorage.getItem(OWNER_KEY)
    if (owner == null || owner === token) return false
    lost()
    return true
  }

  /** Live Blackjack closed in this tab: save and let another tab have the tables. */
  function letGo() {
    if (hold !== 'here') return
    save(true)
    stopTicking()
    hold = 'idle'
    release?.()
    release = null
  }

  function request(options: LockOptions): Promise<void> {
    return new Promise((settle) => {
      let held = false
      locks!
        .request(LOCK, options, (lock) => {
          if (!lock) {
            // ifAvailable, and another tab has them
            if (hold !== 'here') elsewhere()
            return settle()
          }
          if (hold === 'here') return settle() // already ours through another request: let this one go
          held = true
          open()
          settle()
          return new Promise<void>((r) => (release = r))
        })
        .catch(() => {
          if (held) lost() // stolen: Play here in another tab
          else if (hold !== 'here') elsewhere() // the wait for a closing page ran out: another tab is using them
          settle()
        })
    })
  }

  /**
   * Takes the tables if they are free. The page's first ask gives a page that is closing (a reload) a moment to let go.
   * Without Web Locks a tab takes them unless another took them from it, and the other tab notices when it next saves.
   */
  let first = true
  function ask(): Promise<void> {
    if (hold === 'here') return Promise.resolve()
    if (!locks) return Promise.resolve(hold === 'idle' ? open() : undefined)
    const options: LockOptions = first ? { signal: timeout(HANDOVER_MS) } : { ifAvailable: true }
    first = false
    return (asking ??= request(options).finally(() => (asking = null)))
  }

  const host: TableHost = {
    ask,
    get elsewhere() {
      return hold === 'elsewhere'
    },
    use(onChange) {
      const fn = () => onChange()
      listeners.add(fn)
      users++
      void ask()
      return () => {
        listeners.delete(fn)
        if (--users === 0) letGo()
      }
    },
    take: () => (hold === 'here' ? Promise.resolve() : locks ? request({ steal: true }) : Promise.resolve(open())),
  }
  // Coming back to a tab that waits with Live Blackjack open: take the tables if the other tab has let go. Not sooner,
  // since a waiting tab in the background would grab them while the tab running them reloads.
  if (typeof document !== 'undefined')
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && users && hold === 'elsewhere') void ask()
    })

  /** every call: catch up, run it at the engine's now, save. Only the tab running the tables answers. */
  async function run<T>(fn: (now: number) => T): Promise<T> {
    if (hold === 'idle') await ask()
    if (hold !== 'here' || taken()) throw new Elsewhere()
    wake()
    try {
      return fn(sync())
    } finally {
      save()
    }
  }
  /** a move while another tab runs the tables is refused the way a seat played in another tab is */
  const write = <T>(fn: (now: number) => Res<T>): Promise<Res<T>> =>
    run(fn).catch((e) => {
      if (e instanceof Elsewhere) return { ok: false, error: 'other-tab' } as Res<T>
      throw e
    })

  const sid = (t: number) => (mySid && mySid.table === t ? mySid.sid : null)
  const setSid = (v: { table: number; sid: string } | null) => {
    mySid = v
    storeSid(v)
  }

  /** the engine's view as the screen expects it: an etag, flip on every card and the bots marked */
  function feed(v: View, etag = ''): TableFeed {
    const bots = new Set(db.seats.filter((s) => s.tableId === v.table.id && isBot(s.player)).map((s) => s.seat))
    return {
      ...v,
      etag,
      seats: v.seats.map((s) => (s && bots.has(s.seat) ? { ...s, bot: true } : s)),
      hands: v.hands.map((h) => ({ ...h, cards: h.cards.map((c) => ({ ...c, flip: null })) })),
    }
  }
  function reply<T>(r: Reply<T>): Res<T> {
    if (!r.state) return r as Res<T>
    return { ...r, state: feed(r.state) } as Res<T>
  }

  return {
    online: false,
    get book() {
      return hold === 'here' ? `local:${id}` : ''
    },
    host,
    sid,
    dropSid: (t) => {
      if (mySid?.table === t) setSid(null)
    },
    tables: () => run((now) => bjTables(db, rng, now, { player: guestId, sid: mySid?.sid ?? null })),
    state: (t) =>
      run((now) => {
        const v = bjState(db, rng, now, { table: t, player: guestId, sid: sid(t) })
        if ('error' in v) throw new TableGone(`table ${t}`)
        viewing = t
        return feed(v, v.etag)
      }),
    sit: (t, seat, name) =>
      write((now) => {
        const r = bjSit(db, rng, now, { table: t, seat, player: guestId, sid: sid(t), name, avatar: guestAvatar() })
        if (r.ok) setSid({ table: t, sid: r.sid })
        return reply(r)
      }),
    // local play has no accounts to move a seat into
    claim: () => Promise.resolve({ ok: false, error: 'player' }),
    leave: (t) =>
      write((now) => {
        const r = bjLeave(db, rng, now, { table: t, player: guestId, sid: sid(t) })
        // leaving mid-round keeps the seat (and this tab's control of it) until the round is over, as in net.ts
        if (r.ok && !r.leaving && mySid?.table === t) setSid(null)
        return reply(r)
      }),
    away: (t) => {
      run((now) => bjAway(db, now, { table: t, player: guestId, sid: sid(t) })).catch(() => {})
    },
    bet: (t, round, amount) => write((now) => reply(bjBet(db, rng, now, { table: t, round, player: guestId, sid: sid(t), amount }))),
    act: (t, round, hand, n, action) => write((now) => reply(bjAction(db, rng, now, { table: t, round, player: guestId, sid: sid(t), hand, n, action }))),
    react: (t, code) => write((now) => reply(bjReact(db, now, { table: t, player: guestId, code }))),
    result: (round, guest) => run((now) => bjResult(db, now, { round, player: guestId, guest: guest ?? null })),
    roundInfo: (round) => run((now) => bjRoundInfo(db, now, { round })),
  }
}
