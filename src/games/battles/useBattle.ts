import { useCallback, useEffect, useReducer, useRef, useState } from 'react'

import { roundLand, roundStart } from './engine'
import { BattleGone, type BattleServer, type BattleView, type ListFeed } from './types'

/* Keeping the battle screens in step with the server: an estimate of the server clock, a poll loop paced by what the
   battle can still do, and a timer that re-renders exactly when something is due on screen (a countdown beat, a round
   pushing off or landing, the winner) instead of ticking all the time. */

export interface Clock {
  now(): number
  sample(t0: number, t1: number, server: number): void
}

/** Server time from round trips: half the round trip is the delay; the fastest recent trips count most. On a slow line
 *  the first answer still sets the clock (off by at most half its round trip, far better than trusting a device clock
 *  that may be minutes out), and the first quick one replaces it. */
export function makeClock(): Clock {
  let offset = 0
  let first = true
  let rough = false
  const rtts: number[] = []
  return {
    now: () => Date.now() + offset,
    sample(t0, t1, server) {
      const rtt = t1 - t0
      if (!Number.isFinite(server) || rtt < 0) return
      const est = server - (t0 + t1) / 2
      if (rtt > 1500) {
        if (first) {
          offset = est
          first = false
          rough = true
        }
        return
      }
      if (first || rough) {
        offset = est
        rough = false
      } else {
        offset = 0.8 * offset + 0.2 * est
        if (rtt <= Math.min(...rtts)) offset = 0.5 * offset + 0.5 * est
      }
      first = false
      rtts.push(rtt)
      if (rtts.length > 10) rtts.shift()
    },
  }
}

const jitter = () => Math.random() * 250

/** How long to wait before the next poll of one battle. */
export function pollDelay(b: BattleView | null, t: number, hidden: boolean, online: boolean): number {
  if (!b) return 1000
  const seated = b.seats.some((s) => s?.me)
  let d: number
  if (b.status === 'open') {
    // someone may join (or the creator may call it off) at any moment
    d = seated ? 1000 : 1800
    if (b.expiresAt > t) d = Math.min(d, b.expiresAt - t + 80)
  } else if (b.status === 'running' && b.endAt != null && t < b.endAt) {
    // every item is known once it runs: only the end needs confirming
    d = Math.max(400, Math.min(15_000, b.endAt - t + 120 + jitter()))
  } else d = 15_000
  if (!online) d = Math.min(d, b.status === 'open' ? 300 : 2000)
  if (hidden) d = Math.max(d, b.status === 'open' && seated ? 3000 : 8000)
  return d
}

/** Polls one battle. `accept` also takes the battles that come back with actions. */
export function useBattle(server: BattleServer, id: number) {
  const clock = useRef<Clock>(null)
  clock.current ??= makeClock()
  const [view, setView] = useState<BattleView | null>(null)
  const [gone, setGone] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const viewRef = useRef<BattleView | null>(null)
  const kick = useRef<() => void>(() => {})
  const shown = useRef('')

  const accept = useCallback(
    (b: BattleView) => {
      if (b.id !== id) return
      const cur = viewRef.current
      // a battle only moves forward: open, then running, then done or cancelled
      const rank = { open: 0, running: 1, done: 2, cancelled: 2 }
      if (cur && rank[b.status] < rank[cur.status]) return
      viewRef.current = b
      const sig = JSON.stringify({ ...b, now: 0 })
      if (sig === shown.current) return
      shown.current = sig
      setView(b)
    },
    [id],
  )

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
        const b = await server.state(id)
        clock.current!.sample(t0, Date.now(), b.now)
        accept(b)
        fails = 0
        lastOk = Date.now()
        setReconnecting(false)
      } catch (e) {
        if (e instanceof BattleGone) {
          stop = true
          setGone(true)
          return
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
      const delay = fails ? [1200, 2500, 5000][Math.min(fails, 3) - 1] : pollDelay(viewRef.current, clock.current!.now(), document.hidden, server.online)
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
  }, [server, id, accept])

  return { view, accept, clock: clock.current, gone, reconnecting, poll: () => kick.current() }
}

/** The moments a battle changes on screen: the countdown beats, each round pushing off and landing, the end. */
export function battleInstants(b: BattleView | null): number[] {
  if (!b || b.startAt == null) return b ? [b.expiresAt] : []
  const out = [b.startAt - 3000, b.startAt - 2000, b.startAt - 1000, b.startAt]
  for (let r = 0; r < b.cases.length; r++) out.push(roundStart(b, r), roundLand(b, r))
  if (b.endAt != null) out.push(b.endAt - 1500, b.endAt)
  return out
}

/** Re-renders at the next of `instants` (server times) after `now()`. */
export function useInstants(instants: number[], now: () => number) {
  const [tick, bump] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const t = now()
    let next = Infinity
    for (const x of instants) if (x > t && x < next) next = x
    if (next === Infinity) return
    const id = window.setTimeout(bump, Math.min(next - t + 8, 60_000))
    return () => clearTimeout(id)
  })
  return tick
}

/** Polls the lobby feed: quicker while a battle you sit in is waiting for players, slower when hidden. */
export function useFeed(server: BattleServer, onFeed?: (f: ListFeed) => void) {
  const [feed, setFeed] = useState<ListFeed | null>(null)
  const [failed, setFailed] = useState(false)
  const clock = useRef<Clock>(null)
  clock.current ??= makeClock()
  const cb = useRef(onFeed)
  cb.current = onFeed
  const kick = useRef<() => void>(() => {})
  useEffect(() => {
    let stop = false
    let timer = 0
    let busy = false
    const tick = async () => {
      if (stop || busy) return
      clearTimeout(timer)
      busy = true
      const t0 = Date.now()
      let f: ListFeed | null = null
      try {
        f = await server.list()
        if (stop) return
        clock.current!.sample(t0, Date.now(), f.now)
        setFeed(f)
        setFailed(false)
        cb.current?.(f)
      } catch {
        if (!stop) setFailed(true)
      } finally {
        busy = false
      }
      if (stop) return
      const waiting = !!f?.mine.some((b) => b.status === 'open')
      const base = server.online ? (waiting ? 1500 : 3000) : waiting ? 500 : 1000
      timer = window.setTimeout(tick, document.hidden ? 10_000 : base)
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
  }, [server])
  return { feed, failed, clock: clock.current, poll: () => kick.current() }
}

/** An element's content size, tracked from the moment it mounts (a callback ref, so it works for elements that only
 *  appear after a loading state); the first measure lands before paint. */
export function useMeasure<T extends HTMLElement>(initial = { w: 1000, h: 600 }) {
  const [size, setSize] = useState(initial)
  const ro = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect()
    ro.current = null
    if (!el) return
    setSize({ w: el.clientWidth, h: el.clientHeight })
    const o = new ResizeObserver(([e]) => setSize((s) => (Math.abs(s.w - e.contentRect.width) < 0.5 && Math.abs(s.h - e.contentRect.height) < 0.5 ? s : { w: e.contentRect.width, h: e.contentRect.height })))
    o.observe(el)
    ro.current = o
  }, [])
  useEffect(() => () => ro.current?.disconnect(), [])
  return [ref, size] as const
}
