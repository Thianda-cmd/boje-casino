import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { carried } from '../../lib/account'
import { fmt, round2 } from '../../lib/format'
import { useAuth } from '../../store/auth'
import { MAX_BET, useWallet } from '../../store/wallet'
import { phaseAt, roundAt, timesOf, type Phase, type Times } from './clock'
import { keyOf, verifyRound } from './fair'
import { drawFight } from './fight'
import { KAIJU_IDS, STAKE_LIMIT, drawResult, hitsOf, matchupOf, oddsOf } from './rules'
import { SELS, type Fight, type KaijuId, type Matchup, type Odds, type Result, type Sel, type StageView, type Stakes } from './types'
import { addStakes, capStakes, cleanStakes, openRounds, pruneSettled, refundGuest, refundStakes, resultAt, settleFrom, settledOf, stakeOf, stakeTotal, trimTo, type Book, type Outcome, type Settlement } from './ledger'
import { awayToast, connect, defaultName, guestAvatar, localStandIn, saveName, tryShared, type Bettor, type Feed, type FeedRound, type KaijuServer, type RoundInfo } from './net'
import { loadLast, saveLast } from './storage'

/*
  Kaiju Clash's live loop, as one React hook: useKaijuLive() connects to the shared fight night (or the stand-in when
  the database can't be reached: net.ts), polls it on the server's clock, keeps the stakes in the ledger (ledger.ts)
  and settles every round once, wherever the page was when it ended. The page only renders what it returns and calls
  its actions. Everything in it follows the shared clock: `now()` is the server's time, and the round, its phase and
  the fight move on by themselves at the moments of the timetable (clock.ts), whether or not a poll has just answered.

  What it returns (KaijuLive):
    ready        a feed has arrived (before that, round is null and the page shows its loading state)
    conn         'connecting' | 'live' | 'reconnecting' | 'solo' (the stand-in), for double/bits.tsx StatusCard
    book         'shared' | 'local'
    online, bots viewers in the last 30 s (the stand-in: you and its house bots), and the stand-in's bots betting
    now()        the server clock in ms (stable: pass it to the Stage)
    round        the round in play (null until ready): { id, matchup, main, times (clock.ts Times), phase, betUntil,
                 hash, key, seed, fight, result, overAt, over, hits, odds }
                   phase    this page's phase: 'bets' ends CLIENT_CLOSE_MS before the server closes (a chip sent in
                            'bets' still lands), then 'closed', 'walkout', 'fight', 'result' as clock.ts phaseAt
                   betUntil when 'bets' ends, for the countdown
                   key      out once betting has closed; fight = drawFight(key, matchup) and result follow from it.
                            Both are known from the close on: show them as the stage plays them, not before
                   overAt   when the stage shows how it ended and the round is paid (clock.ts revealAt: the K.O. or SPLASH
                            banner, or the judges' verdict); over: now ≥ it
                   hits     the winning selections, once over (null before): light them on the board
                   seed     out at the final bell (times.endsAt)
    view         the StageView for Stage.tsx (fight null while betting)
    odds         the round's prices (rules.ts oddsOf): p, mult, line
    mine         this player's stakes this round, as they stand: while betting what this page has sent (or is
                 sending), after the close what reached the fight, after settling what was played
    staked       their total
    sending      a change is on its way to the server
    canUndo      whether undo() has anything to take back this round
    last         the stakes of the last round the player bet on (what rebet() puts back), or null
    totals       everyone's chips on each selection: { total, players }
    players      how many players have a bet on this round
    bettors      the round's 30 biggest players (net.ts Bettor: name, avatar, acct, me, bot?, total, sel, amount)
    history      the last 50 finished rounds, newest first (PastFight: id, seed, key, matchup, result, odds, hits)
    standings    every kaiju over that history (Standing: fights, wins, losses, ko, splash, dec, form newest first)
    lastSettled  the outcome of the last round this player had a bet in, settled on this page as it ended (ledger.ts
                 Outcome: round, matchup, landed, bet, payout, net, refund, result, hits, won); rounds settled while
                 the player was away are told with a toast instead
    next         the next three fight cards: { id, matchup, odds, times, hash (the next one's only) }
    busy         some stake is waiting to settle
    me           { name, avatar, guest }
    actions
      place(adds)  adds chips: { 'win:a': 25 }. A selection takes as much as fits under STAKE_LIMIT (one selection
                   alone also as much as the balance covers); checks the phase, MAX_BET a round and the balance;
                   charges the wallet (placeBet) before sending; gives back whatever the server refuses. Resolves
                   when the server has answered: { ok, reason?, placed?, refunded? } (reasonText(result) words it)
      undo()       takes the last change of this round back
      clear()      takes every chip of this round off
      double()     doubles every stake of this round
      rebet()      tops this round's stakes up to the last round's
      verify(id)   a round for the fairness panel: hash, key, seed, whether they check out, its matchup and result
                   (null result for the round on show until it is decided)
      retry()      tries the shared fight night again (the Retry button when playing solo)
      rename(name) a guest's display name
*/

/** betting closes on this page a little before the server's close, so a chip sent at the last moment still lands */
export const CLIENT_CLOSE_MS = 220

export type Conn = 'connecting' | 'live' | 'reconnecting' | 'solo'

export interface LiveRound {
  id: number
  matchup: Matchup
  /** every tenth round */
  main: boolean
  times: Times
  phase: Phase
  /** betting ends on this page at this moment (server ms) */
  betUntil: number
  /** sha256(seed), published before betting opens (null for a moment if the round opened before any feed said it) */
  hash: string | null
  key: string | null
  seed: string | null
  fight: Fight | null
  result: Result | null
  overAt: number | null
  over: boolean
  hits: Sel[] | null
  odds: Odds
}
export interface PastFight {
  id: number
  seed: string
  key: string
  matchup: Matchup
  result: Result
  odds: Odds
  hits: Sel[]
}
export interface Standing {
  id: KaijuId
  fights: number
  wins: number
  losses: number
  /** wins by knockout, by Splash, on the judges' cards */
  ko: number
  splash: number
  dec: number
  /** the last five, newest first */
  form: ('W' | 'L')[]
}
export interface NextFight {
  id: number
  matchup: Matchup
  odds: Odds
  times: Times
  hash: string | null
}
export interface Verification {
  id: number
  matchup: Matchup
  odds: Odds
  hash: string | null
  key: string | null
  seed: string | null
  /** whether the seed hashes to the published hash, and gives the revealed key (null until the seed is out) */
  hashOk: boolean | null
  keyOk: boolean | null
  result: Result | null
  hits: Sel[] | null
  /** the round is too old (or too far ahead) to look up */
  missing: boolean
}

export type Reason = 'wait' | 'closed' | 'limit' | 'table' | 'coins' | 'wallet' | 'invalid' | 'net' | 'empty'
export interface PlaceResult {
  ok: boolean
  reason?: Reason
  /** what this change put on the board (for a chip animation) */
  placed?: Stakes
  /** coins that came back after a refusal */
  refunded?: number
}

export interface KaijuLive {
  ready: boolean
  conn: Conn
  book: Book
  online: number
  bots: number
  now: () => number
  round: LiveRound | null
  view: StageView | null
  odds: Odds | null
  mine: Stakes
  staked: number
  sending: boolean
  canUndo: boolean
  last: Stakes | null
  totals: Record<Sel, { total: number; players: number }>
  players: number
  bettors: Bettor[]
  history: PastFight[]
  standings: Standing[]
  lastSettled: Outcome | null
  next: NextFight[]
  busy: boolean
  me: { name: string; avatar: number; guest: boolean }
  actions: {
    place: (adds: Stakes) => Promise<PlaceResult>
    undo: () => Promise<PlaceResult>
    clear: () => Promise<PlaceResult>
    double: () => Promise<PlaceResult>
    rebet: () => Promise<PlaceResult>
    verify: (id: number) => Promise<Verification>
    retry: () => Promise<boolean>
    rename: (name: string) => void
  }
}

const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
const MESSAGES: Record<Reason, string | null> = {
  wait: 'Joining the fight night…',
  closed: 'Too late: betting had closed.',
  limit: `That would go over ${fmt(STAKE_LIMIT, 0)} on one selection.`,
  table: `Table limit: ${fmt(MAX_BET, 0)} a round.`,
  coins: NO_COINS,
  // the wallet has said why (a loss limit or a cool-off)
  wallet: null,
  invalid: 'That bet was refused.',
  net: 'Connection trouble. If that bet missed the fight, it comes back when the round ends.',
  empty: null,
}
/** What to tell the player about a refused change (null: nothing to say). */
export function reasonText(r: PlaceResult): string | null {
  if (r.ok || !r.reason) return null
  const m = MESSAGES[r.reason]
  return m && r.refunded ? `${m} Your ${fmt(r.refunded)} came back.` : m
}

const NONE = Promise.resolve<PlaceResult>({ ok: false, reason: 'empty' })
const refuse = (reason: Reason) => Promise.resolve<PlaceResult>({ ok: false, reason })
const timesFrom = (r: FeedRound): Times => ({ opensAt: r.opensAt, closesAt: r.closesAt, showAt: r.showAt, fightAt: r.fightAt, endsAt: r.endsAt, nextAt: r.nextAt })
const emptyTotals = () => Object.fromEntries(SELS.map((s) => [s, { total: 0, players: 0 }])) as Record<Sel, { total: number; players: number }>

/** this page's phase: betting ends CLIENT_CLOSE_MS before the server's close */
export const pagePhase = (t: Times, est: number): Phase => (est < t.closesAt - CLIENT_CLOSE_MS ? 'bets' : est < t.closesAt ? 'closed' : phaseAt(t, est))

interface Base {
  id: number
  times: Times
  hash: string | null
  key: string | null
  seed: string | null
  /** the feed is this round's (its totals, bettors and key) */
  fromFeed: boolean
}
/**
 * The round in play at `est`: the feed's, or the next one as soon as it opens (its hash came with the last feed), so the
 * page moves on at the moment the round changes rather than when the next answer comes.
 */
function baseOf(f: Feed | null, est: number): Base | null {
  if (!f) return null
  const id = Math.max(f.round.id, roundAt(est))
  if (id === f.round.id) return { id, times: timesFrom(f.round), hash: f.round.hash, key: f.round.key, seed: f.round.seed, fromFeed: true }
  return { id, times: timesOf(id), hash: f.next?.id === id ? f.next.hash : null, key: null, seed: null, fromFeed: false }
}

export function useKaijuLive(): KaijuLive {
  const pushToast = useWallet((s) => s.pushToast)
  const uid = useAuth((s) => s.uid)
  const profile = useAuth((s) => s.profile)
  const who = uid ?? 'guest'
  const [guestName, setGuestName] = useState(defaultName)
  const name = profile?.username ?? guestName
  const avatar = profile?.avatar ?? guestAvatar()

  const [server, setServer] = useState<KaijuServer | null>(null)
  const serverRef = useRef<KaijuServer | null>(null)
  serverRef.current = server
  const [conn, setConn] = useState<Conn>('connecting')
  const [feed, setFeed] = useState<Feed | null>(null)
  const feedRef = useRef<Feed | null>(null)
  const [hist, setHist] = useState<{ id: number; seed: string }[]>([])
  const histRef = useRef(hist)
  const offset = useRef(0) // server clock minus local clock
  const now = useCallback(() => Date.now() + offset.current, [])
  const [tick, setTick] = useState(0)
  // bumped whenever the ledger or a change on its way moves, so what is read from them is read again
  const [ver, bump] = useReducer((x: number) => x + 1, 0)
  const whoRef = useRef(who)
  whoRef.current = who
  const nameRef = useRef({ name, avatar })
  nameRef.current = { name, avatar }
  // the stake changes on their way to the server, one at a time, and the stakes the board shows meanwhile
  const pending = useRef(0)
  const [sending, setSending] = useState(false)
  const view = useRef<{ round: number; stakes: Stakes } | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const [lastSettled, setLastSettled] = useState<Outcome | null>(null)
  const [last, setLast] = useState<Stakes | null>(loadLast)
  const undoRef = useRef<{ round: number; list: Stakes[] }>({ round: -1, list: [] })

  /* ---------------- connection and polling ---------------- */

  // a guest's stakes still waiting when they signed up come back to the account that took the guest's wallet over
  useEffect(() => {
    const c = uid ? carried() : null
    if (!c || c.to !== uid) return
    void refundGuest(c.at).then((back) => {
      if (back > 0) pushToast({ kind: 'info', title: `${fmt(back)} you had on Kaiju Clash as a guest came back to your account.` })
    })
    // pushToast is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid])

  useEffect(() => {
    let alive = true
    pruneSettled()
    connect().then((s) => {
      if (!alive) return
      setServer(s)
      setConn(s.online ? 'live' : 'solo')
    })
    return () => void (alive = false)
  }, [])

  const poll = useRef<() => void>(() => {})
  useEffect(() => {
    if (!server) return
    let stop = false
    let timer = 0
    let lastOk = Date.now()
    // one request at a time: a poll asked for while one is out runs as soon as it answers
    let inflight = false
    let again = false
    // the clock offset comes from the quickest of the recent round trips, whose midpoint guess is the tightest
    const samples: { off: number; rtt: number }[] = []
    histRef.current = []
    const delay = (ok: boolean) => {
      const f = feedRef.current
      if (!ok || !f) return 1200
      const est = now()
      const r = f.round
      const busy = openRounds(whoRef.current, server.book).length > 0
      if (!server.online) return document.hidden && !busy ? 5000 : est < r.closesAt ? 250 : 1000
      if (est >= r.nextAt) return 250
      // betting has closed (the final bell has rung) but this answer came from before: the key (the seed) is due now
      if ((f.now < r.closesAt && est >= r.closesAt) || (f.now < r.endsAt && est >= r.endsAt)) return 90
      // nothing changes on the server once betting has closed but the online count, so the fight is polled slowly
      const base = document.hidden && !busy ? 5000 : est < r.closesAt ? 1000 : est < r.endsAt ? 3000 : 2000
      // be there when betting closes (the key), at the final bell (the seed) and when the next round opens
      const next = [r.closesAt + 40, r.endsAt + 80, r.nextAt + 60].find((m) => m > est + 30)
      return Math.max(60, Math.min(base, next != null ? next - est : base))
    }
    const tick = async () => {
      if (inflight) {
        again = true
        return
      }
      inflight = true
      again = false
      clearTimeout(timer)
      const t0 = Date.now()
      let ok = false
      try {
        const f = await server.state(histRef.current[0]?.id ?? null, openRounds(whoRef.current, server.book))
        if (stop) return
        const t1 = Date.now()
        const s = { off: f.now - (t0 + t1) / 2, rtt: t1 - t0 }
        const best = samples.length ? samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)) : null
        // a sample that can't agree with the best means a clock jumped, so the old samples are dropped
        if (best && Math.abs(s.off - best.off) > (s.rtt + best.rtt) / 2 + 100) samples.length = 0
        samples.push(s)
        if (samples.length > 12) samples.shift()
        offset.current = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).off
        if (f.history) {
          histRef.current = f.history
          setHist(f.history)
        }
        feedRef.current = f
        setFeed(f)
        // a round this browser already settled (another tab, or before a reload) still shows its result
        const done = settledOf(whoRef.current, server.book, f.round.id, f.round.hash)
        if (done && f.now >= f.round.closesAt) setLastSettled((o) => (o?.round === f.round.id ? o : done.outcome))
        ok = true
        lastOk = Date.now()
        if (server.online) setConn('live')
        void settleDue()
      } catch {
        if (server.online && Date.now() - lastOk > 2500) setConn('reconnecting')
      }
      inflight = false
      if (stop) return
      timer = window.setTimeout(tick, again && ok ? 0 : delay(ok))
    }
    poll.current = tick
    tick()
    const onVisible = () => !document.hidden && tick()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server])

  const retry = async () => {
    setConn('connecting')
    const s = await tryShared()
    if (s) {
      feedRef.current = null
      setFeed(null)
      setHist([])
      setServer(s)
      setConn('live')
      return true
    }
    setConn(serverRef.current?.online ? 'reconnecting' : 'solo')
    pushToast({ kind: 'info', title: 'The shared fight night is still unavailable.' })
    return false
  }

  /* ---------------- settling ---------------- */

  const announced = useRef(new Set<string>())
  const announce = (x: Settlement, onShow: boolean) => {
    const key = `${x.book}:${x.round}`
    const first = !announced.current.has(key)
    announced.current.add(key)
    if (onShow) {
      setLastSettled(x.outcome)
      if (x.paid && first && x.outcome.refund > 0) pushToast({ kind: 'info', title: `${fmt(x.outcome.refund)} of your bets never reached the fight, so it came back.` })
      return
    }
    if (!first) return
    const t = awayToast(x)
    if (t) pushToast(t)
  }

  /** Settles every round this browser has paid into whose result the feed can tell. Safe to call any time. */
  const settling = useRef(false)
  const settleDue = async () => {
    const s = serverRef.current
    const f = feedRef.current
    if (settling.current || !s || !f) return
    settling.current = true
    try {
      const me = whoRef.current
      for (const x of await settleFrom(me, s.book, f, now())) announce(x, x.live)
      // stakes from an offline session settle from the stand-in
      if (s.book === 'shared' && openRounds(me, 'local').length) {
        const lf = await localStandIn().state(null, openRounds(me, 'local'))
        for (const x of await settleFrom(me, 'local', lf, lf.now)) announce(x, false)
      }
    } catch {
      /* tried again on the next poll */
    } finally {
      settling.current = false
      bump()
    }
  }

  /* ---------------- the round on show ---------------- */

  const est = now()
  const base = baseOf(feed, est)
  const id = base?.id ?? null
  const matchup = useMemo(() => (id == null ? null : matchupOf(id)), [id])
  const odds = useMemo(() => (matchup ? oddsOf(matchup.a, matchup.b) : null), [matchup])
  const key = base?.key ?? null
  const fight = useMemo(() => (id != null && key && matchup ? drawFight(key, matchup) : null), [id, key, matchup])
  const result = useMemo(() => (key && matchup ? drawResult(key, matchup.a, matchup.b) : null), [key, matchup])
  const overAt = base && key ? resultAt(base.times.fightAt, base.times.endsAt, base.id, key) : null
  const overAtRef = useRef(overAt)
  overAtRef.current = overAt
  const phase = base ? pagePhase(base.times, est) : null
  const over = overAt != null && est >= overAt

  // a re-render at each moment of the timetable (and when the fight is decided), so the phase moves on by itself
  useEffect(() => {
    const b = baseOf(feedRef.current, now())
    if (!b) return
    const t = now()
    const marks = [b.times.closesAt - CLIENT_CLOSE_MS, b.times.closesAt, b.times.showAt, b.times.fightAt, overAtRef.current, b.times.endsAt, b.times.nextAt]
    const next = Math.min(...marks.filter((m): m is number => m != null && m > t))
    if (!Number.isFinite(next)) return
    const timer = window.setTimeout(() => setTick((x) => x + 1), Math.min(2_000_000_000, next - t + 5))
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, feed])

  // betting has closed: these stakes are the ones rebet() puts back. The fight decided: settle it now.
  const seenPhase = useRef<{ id: number; phase: Phase | null }>({ id: -1, phase: null })
  const phaseKey = base ? `${base.id}:${phase}:${over ? 1 : 0}` : ''
  useEffect(() => {
    if (!base) return
    const p = seenPhase.current
    const s = serverRef.current
    if (s && p.phase === 'bets' && (p.id !== base.id || phase !== 'bets')) {
      const st = stakeOf(whoRef.current, s.book, p.id)
      if (stakeTotal(st) > 0) {
        setLast(st)
        saveLast(st)
      }
    }
    seenPhase.current = { id: base.id, phase }
    if (over) void settleDue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseKey])

  /** this round's stakes as the board shows them (see `mine` above) */
  const stakesOf = (s: KaijuServer | null, f: Feed | null, b: Base | null): Stakes => {
    if (!s || !b) return {}
    const v = view.current
    if (v && v.round === b.id) return v.stakes
    const me = whoRef.current
    const done = b.hash ? settledOf(me, s.book, b.id, b.hash) : null
    if (done) return done.outcome.landed
    const paid = stakeOf(me, s.book, b.id)
    return b.fromFeed && f && f.now >= b.times.closesAt ? capStakes(paid, f.mine ?? {}) : paid
  }
  // (read from storage only when something it depends on moves: a page may re-render often)
  const mine = useMemo(() => stakesOf(server, feed, base), [server, feed, base?.id, base?.hash, base?.fromFeed, ver, who, tick])

  /* ---------------- betting ---------------- */

  /** the round taking bets on this page right now, or why none is */
  const open = (): { s: KaijuServer; b: Base & { hash: string } } | Reason => {
    const s = serverRef.current
    const t = now()
    const b = baseOf(feedRef.current, t)
    if (!s || !b) return 'wait'
    if (pagePhase(b.times, t) !== 'bets') return 'closed'
    if (!b.hash) return 'wait'
    return { s, b: { ...b, hash: b.hash } }
  }
  /** this round's stakes as they stand on this page: the change on its way, else the ledger's */
  const current = (s: KaijuServer, round: number): Stakes => {
    const v = view.current
    return v && v.round === round ? v.stakes : stakeOf(whoRef.current, s.book, round)
  }
  const pushUndo = (round: number, st: Stakes) => {
    const u = undoRef.current
    undoRef.current = { round, list: [...(u.round === round ? u.list : []).slice(-40), st] }
  }

  /**
   * Puts this round's stakes to `target`: what is added leaves the wallet now and waits in the ledger, what is taken off
   * comes back once the server confirms it. The changes go out one at a time, in order; each resolves with its answer.
   * `sent` says whether it went out at all (a change refused on this page never leaves it).
   */
  function change(target: Stakes, undoable = true): { sent: boolean; reason?: Reason; done: Promise<PlaceResult> } {
    const no = (reason: Reason) => ({ sent: false, reason, done: refuse(reason) })
    const o = open()
    if (typeof o === 'string') return no(o)
    const { s, b } = o
    const round = b.id
    const cur = current(s, round)
    const delta: Stakes = {}
    const adds: Stakes = {}
    for (const k of SELS) {
      const d = round2((target[k] ?? 0) - (cur[k] ?? 0))
      if (d === 0) continue
      delta[k] = d
      if (d > 0) adds[k] = d
    }
    if (!Object.keys(delta).length) return no('empty')
    const add = stakeTotal(adds)
    if (SELS.some((k) => (adds[k] ?? 0) > 0 && (target[k] ?? 0) > STAKE_LIMIT)) return no('limit')
    if (add > 0 && stakeTotal(target) > MAX_BET) return no('table')
    const me = whoRef.current
    if (add > 0 && !useWallet.getState().placeBet(add)) return no(useWallet.getState().refusal?.why === 'coins' ? 'coins' : 'wallet')
    if (add > 0) addStakes(me, s.book, round, b.hash, adds)
    if (undoable) pushUndo(round, cur)
    view.current = { round, stakes: cleanStakes(target) }
    pending.current++
    setSending(true)
    bump()
    const { name: nm, avatar: av } = nameRef.current
    const done = new Promise<PlaceResult>((resolve) => {
      queue.current = queue.current.then(async () => {
        let out: PlaceResult = { ok: true, placed: adds }
        try {
          const r = await s.bet(round, delta, nm, av)
          if (r.ok) {
            const removed: Stakes = {}
            for (const k of SELS) if ((delta[k] ?? 0) < 0) removed[k] = -delta[k]!
            if (Object.keys(removed).length) await trimTo(me, s.book, round, r.held, removed)
          } else {
            const back = add > 0 ? await refundStakes(me, s.book, round, adds) : 0
            out = { ok: false, reason: r.error === 'closed' ? 'closed' : r.error === 'limit' ? 'limit' : 'invalid', refunded: back }
            view.current = null
          }
        } catch {
          // the chips stay in the ledger: if they missed the fight, settling gives them back
          out = { ok: false, reason: 'net' }
        } finally {
          pending.current--
          if (!pending.current) {
            view.current = null
            setSending(false)
          }
          bump()
          poll.current()
        }
        resolve(out)
      })
    })
    return { sent: true, done }
  }

  const place = (adds: Stakes): Promise<PlaceResult> => {
    const o = open()
    if (typeof o === 'string') return refuse(o)
    const cur = current(o.s, o.b.id)
    const want = SELS.filter((k) => (adds[k] ?? 0) > 0)
    if (!want.length) return NONE
    const target: Stakes = { ...cur }
    // each selection takes as much as fits under its limit (and a lone one as much as the balance covers)
    const have = useWallet.getState().balance
    let any = false
    for (const k of want) {
      let a = round2(Math.min(adds[k]!, STAKE_LIMIT - (cur[k] ?? 0), MAX_BET - stakeTotal(target)))
      if (want.length === 1) a = round2(Math.min(a, have))
      if (a < 0.01) continue
      target[k] = round2((cur[k] ?? 0) + a)
      any = true
    }
    if (!any) {
      if (want.every((k) => STAKE_LIMIT - (cur[k] ?? 0) < 0.01)) return refuse('limit')
      if (MAX_BET - stakeTotal(cur) < 0.01) return refuse('table')
      return refuse('coins')
    }
    return change(target).done
  }
  const undo = (): Promise<PlaceResult> => {
    const o = open()
    if (typeof o === 'string') return refuse(o)
    const u = undoRef.current
    if (u.round !== o.b.id || !u.list.length) return NONE
    const c = change(u.list[u.list.length - 1], false)
    // off the list once it has gone out, or if the board is already there (one this page refused stays, to try again)
    if (c.sent || c.reason === 'empty') undoRef.current = { round: u.round, list: u.list.slice(0, -1) }
    return c.done
  }
  const clear = (): Promise<PlaceResult> => {
    const o = open()
    if (typeof o === 'string') return refuse(o)
    return stakeTotal(current(o.s, o.b.id)) > 0 ? change({}).done : NONE
  }
  const double = (): Promise<PlaceResult> => {
    const o = open()
    if (typeof o === 'string') return refuse(o)
    const cur = current(o.s, o.b.id)
    if (!stakeTotal(cur)) return NONE
    if (SELS.some((k) => (cur[k] ?? 0) * 2 > STAKE_LIMIT)) return refuse('limit')
    return change(Object.fromEntries(SELS.filter((k) => cur[k]).map((k) => [k, round2(cur[k]! * 2)])) as Stakes).done
  }
  const rebet = (): Promise<PlaceResult> => {
    const o = open()
    if (typeof o === 'string') return refuse(o)
    const l = last
    if (!l) return NONE
    const cur = current(o.s, o.b.id)
    const target: Stakes = { ...cur }
    for (const k of SELS) if ((l[k] ?? 0) > (cur[k] ?? 0)) target[k] = Math.min(STAKE_LIMIT, l[k]!)
    return change(target).done
  }

  /* ---------------- the fairness panel ---------------- */

  const verify = async (round: number): Promise<Verification> => {
    const f = feedRef.current
    const s = serverRef.current
    const m = matchupOf(round)
    let info: RoundInfo | null = null
    if (f && f.round.id === round) info = { id: round, hash: f.round.hash, key: f.round.key, seed: f.round.seed }
    else if (s) info = await s.roundInfo(round).catch(() => null)
    const v = info?.seed && info.key ? verifyRound(info.seed, info.hash, info.key) : null
    // the round on show keeps its result to itself until the stage has played it
    const t = now()
    const playing = info?.key && f && f.round.id === round && t < resultAt(f.round.fightAt, f.round.endsAt, round, info.key)
    const k = info?.key && !playing ? info.key : null
    const o = oddsOf(m.a, m.b)
    const r = k ? drawResult(k, m.a, m.b) : null
    return { id: round, matchup: m, odds: o, hash: info?.hash ?? null, key: info?.key ?? null, seed: info?.seed ?? null, hashOk: v?.hashOk ?? null, keyOk: v?.keyOk ?? null, result: r, hits: r ? hitsOf(r, o.line) : null, missing: !info }
  }

  /* ---------------- the history and the standings ---------------- */

  const pastCache = useRef(new Map<number, PastFight>())
  const history = useMemo(
    () =>
      hist.map((h) => {
        let p = pastCache.current.get(h.id)
        if (!p || p.seed !== h.seed) {
          const k = keyOf(h.seed)
          const m = matchupOf(h.id)
          const o = oddsOf(m.a, m.b)
          const r = drawResult(k, m.a, m.b)
          p = { id: h.id, seed: h.seed, key: k, matchup: m, result: r, odds: o, hits: hitsOf(r, o.line) }
          pastCache.current.set(h.id, p)
          if (pastCache.current.size > 300) pastCache.current.delete(pastCache.current.keys().next().value!)
        }
        return p
      }),
    [hist],
  )
  const standings = useMemo(() => {
    const t = new Map<KaijuId, Standing>(KAIJU_IDS.map((k) => [k, { id: k, fights: 0, wins: 0, losses: 0, ko: 0, splash: 0, dec: 0, form: [] }]))
    for (const p of history) {
      const w = p.result.winner === 'a' ? p.matchup.a : p.matchup.b
      const l = p.result.winner === 'a' ? p.matchup.b : p.matchup.a
      const sw = t.get(w)!
      const sl = t.get(l)!
      sw.fights++
      sl.fights++
      sw.wins++
      sl.losses++
      sw[p.result.method]++
      if (sw.form.length < 5) sw.form.push('W')
      if (sl.form.length < 5) sl.form.push('L')
    }
    return [...t.values()].sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.ko + b.splash - (a.ko + a.splash) || KAIJU_IDS.indexOf(a.id) - KAIJU_IDS.indexOf(b.id))
  }, [history])

  /* ---------------- what the page gets ---------------- */

  const round: LiveRound | null =
    base && matchup && odds && phase
      ? {
          id: base.id,
          matchup,
          main: matchup.main,
          times: base.times,
          phase,
          betUntil: base.times.closesAt - CLIENT_CLOSE_MS,
          hash: base.hash,
          key,
          seed: base.seed,
          fight,
          result,
          overAt,
          over,
          hits: over && result ? hitsOf(result, odds.line) : null,
          odds,
        }
      : null
  const stage = useMemo<StageView | null>(() => (base && matchup ? { id: base.id, matchup, times: base.times, fight } : null), [base?.id, matchup, fight, base?.times.opensAt])
  const next = useMemo<NextFight[]>(
    () =>
      id == null
        ? []
        : [1, 2, 3].map((k) => {
            const m = matchupOf(id + k)
            return { id: id + k, matchup: m, odds: oddsOf(m.a, m.b), times: timesOf(id + k), hash: k === 1 && feed?.next?.id === id + 1 ? feed.next.hash : null }
          }),
    [id, feed?.next?.id, feed?.next?.hash],
  )
  const fromFeed = !!base?.fromFeed && !!feed
  const busy = useMemo(() => openRounds(who, server?.book ?? 'shared').length > 0, [who, server, feed, ver])
  return {
    ready: !!feed,
    conn,
    book: server?.book ?? 'shared',
    online: feed?.online ?? 0,
    bots: feed?.bots ?? 0,
    now,
    round,
    view: stage,
    odds,
    mine,
    staked: stakeTotal(mine),
    sending,
    canUndo: !!round && round.phase === 'bets' && undoRef.current.round === round.id && undoRef.current.list.length > 0,
    last,
    totals: fromFeed ? feed!.sels : emptyTotals(),
    players: fromFeed ? feed!.players : 0,
    bettors: fromFeed ? feed!.bettors : [],
    history,
    standings,
    lastSettled,
    next,
    busy,
    me: { name, avatar, guest: !profile },
    actions: {
      place,
      undo,
      clear,
      double,
      rebet,
      verify,
      retry,
      rename: (n: string) => {
        if (profile) return
        setGuestName(n)
        saveName(n)
      },
    },
  }
}
