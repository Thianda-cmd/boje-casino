import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { TableGone, TIMING, type TableFeed, type TableServer } from './types'

/* Keeping a table view in step with the server: an estimate of the server clock, a poll loop paced by
   the round's next deadline, and a timer that re-renders the stage exactly when something is due to
   appear (a card landing, the hole card turning, results) instead of ticking all the time. */

export interface Clock {
  now(): number
  sample(t0: number, t1: number, server: number): void
}

/** Server time from round trips: half the round trip is the delay; the fastest recent trips count most. */
export function makeClock(): Clock {
  let offset = 0
  let first = true
  const rtts: number[] = []
  return {
    now: () => Date.now() + offset,
    sample(t0, t1, server) {
      const rtt = t1 - t0
      if (rtt > 1500) return
      const est = server - (t0 + t1) / 2
      if (first) offset = est
      else {
        offset = 0.8 * offset + 0.2 * est
        if (rtt <= Math.min(...rtts)) offset = 0.5 * offset + 0.5 * est
      }
      first = false
      rtts.push(rtt)
      if (rtts.length > 10) rtts.shift()
    },
  }
}

const SEATED_MS = { waiting: 1500, betting: 700, dealing: 800, turns: 600, dealer: 500, done: 1000 } as const
const jitter = () => Math.random() * 250

/** How long to wait before the next poll: sooner near a deadline, slower when only watching or hidden. */
export function pollDelay(f: TableFeed | null, t: number, hidden: boolean): number {
  if (!f) return 1000
  const r = f.round
  const turnHand = r.turn && f.hands.find((h) => h.seat === r.turn!.seat && h.idx === r.turn!.hand)
  const seated = f.mine?.table === f.table.id
  const base = seated ? (r.phase === 'turns' && turnHand?.ctl ? 1500 : SEATED_MS[r.phase]) : r.phase === 'dealing' || r.phase === 'dealer' ? 1000 : 2000
  const overdue =
    (r.phase === 'betting' && r.betEndsAt != null && r.betEndsAt <= t) ||
    (r.phase === 'turns' && !!r.turn && r.turn.endsAt + TIMING.TURN_GRACE_MS <= t) ||
    (r.phase === 'done' && r.nextAt != null && r.nextAt <= t)
  const next = Math.min(
    ...[r.betEndsAt, r.dealEndsAt, r.turn && r.turn.endsAt + TIMING.TURN_GRACE_MS, r.resultsAt, r.nextAt, f.mine?.expiresAt].filter((x): x is number => x != null && x > t),
  )
  let delay = overdue ? 250 + jitter() : Number.isFinite(next) ? Math.max(150, Math.min(base, next - t + 60 + jitter())) : base
  if (hidden) {
    const live = f.hands.some((h) => h.mine) && (r.phase === 'dealing' || r.phase === 'turns' || r.phase === 'dealer')
    delay = Math.max(delay, live ? 1500 : 5000)
  }
  return delay
}

const newer = (a: TableFeed, b: TableFeed) =>
  a.round.id !== b.round.id ? a.round.id > b.round.id : a.round.ver !== b.round.ver ? a.round.ver > b.round.ver : a.now >= b.now

/**
 * Polls one table. `accept` also takes the states that come back with actions; a feed older than the
 * one on screen (by round, version, then server time) is dropped.
 */
export function useTableFeed(server: TableServer, table: number, onGone: () => void) {
  const clock = useRef<Clock>(null)
  clock.current ??= makeClock()
  const [feed, setFeed] = useState<TableFeed | null>(null)
  const feedRef = useRef<TableFeed | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const kick = useRef<() => void>(() => {})
  const gone = useRef(onGone)
  gone.current = onGone

  const shown = useRef('')
  const accept = useCallback((f: TableFeed) => {
    const cur = feedRef.current
    if (f.table.id !== table || (cur && !newer(f, cur))) return
    feedRef.current = f
    // most polls repeat what is on screen with a later `now` (the local stand-in polls ten times a second): keep the stage still
    const sig = JSON.stringify({ ...f, now: 0, etag: '' })
    if (sig === shown.current) return
    shown.current = sig
    setFeed(f)
  }, [table])

  useEffect(() => {
    let stop = false
    let timer = 0
    let busy = false
    let again = false
    let fails = 0
    let lastOk = Date.now()
    const tick = async () => {
      if (stop) return
      if (busy) return void (again = true)
      clearTimeout(timer)
      busy = true
      const t0 = Date.now()
      try {
        const f = await server.state(table)
        clock.current!.sample(t0, Date.now(), f.now)
        accept(f)
        fails = 0
        lastOk = Date.now()
        setReconnecting(false)
      } catch (e) {
        if (e instanceof TableGone) {
          stop = true
          return gone.current()
        }
        fails++
        if (Date.now() - lastOk > 2500) setReconnecting(true)
      } finally {
        busy = false
      }
      if (stop) return
      if (again) {
        again = false
        return void tick()
      }
      const delay = !server.online ? 100 : fails ? [1200, 2500, 5000][Math.min(fails, 3) - 1] : pollDelay(feedRef.current, clock.current!.now(), document.hidden)
      timer = window.setTimeout(tick, delay)
    }
    kick.current = () => void tick()
    tick()
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [server, table, accept])

  return { feed, feedRef, accept, clock: clock.current, reconnecting, poll: () => kick.current() }
}

/**
 * Re-renders at the next moment the feed says something changes on screen (cards landing, the hole
 * card turning, a turn starting or ending, results, the next round, a reaction expiring), plus any
 * extra instants the caller cares about.
 */
export function useReveal(feed: TableFeed | null, now: () => number, extra: (number | null | undefined)[] = []) {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!feed) return
    const t = now()
    let next = Infinity
    const at = (x: number | null | undefined) => {
      if (x != null && x > t && x < next) next = x
    }
    for (const c of feed.dealer) (at(c.at), at(c.flip))
    for (const h of feed.hands) for (const c of h.cards) at(c.at)
    const r = feed.round
    ;[r.dealEndsAt, r.turn?.at, r.turn?.endsAt, r.resultsAt, r.nextAt, r.betEndsAt].forEach(at)
    if (feed.mine?.expiresAt != null) at(feed.mine.expiresAt - 30000)
    for (const x of feed.reactions) at(x.at + TIMING.REACTION_SHOW_MS)
    extra.forEach(at)
    if (next === Infinity) return
    const id = window.setTimeout(bump, Math.min(next - t + 8, 60_000))
    return () => clearTimeout(id)
  })
  return tick
}
