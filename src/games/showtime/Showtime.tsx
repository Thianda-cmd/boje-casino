import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, animate, cubicBezier, motion, useMotionValue } from 'framer-motion'
import { Coin, IconCheck } from '../../components/icons'
import { Modal } from '../../components/Modal'
import { Chip, chipLabel } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { MAX_BET, useWallet } from '../../store/wallet'
import { Kbd } from '../blackjack/table'
import { StatusCard, type Conn } from '../double/bits'
import {
  BONUS_SPOTS,
  BOOST,
  BOOST_CHANCE,
  BOOST_MISS,
  COUNT,
  FLAPPERS,
  MAX_WIN,
  RTP,
  SEGMENTS,
  SPOTS,
  WALL_TILES,
  bonusWin,
  boostOf,
  drawRound,
  isBonus,
  pickOf,
  revealed,
  stakeTotal,
  winOf,
  type Booster,
  type Round,
  type Spot,
  type Stakes,
} from './rules'
import { BET_MS, BOOST_MS, CLOSE_MS, INTRO_MS, LAND_MS, PLATE_MS } from './clock'
import { drawFrom, verifyRound } from './fair'
import { addStakes, ageOf, cleanStakes, hashOf, loseRound, openRounds, pruneSettled, refundStakes, settleRound, settledOf, stakeOf, trimTo, type Book, type Outcome } from './ledger'
import { KEEP_MS, SPOT_LIMIT, connect, defaultName, guestAvatar, localStandIn, roundFromSeed, saveName, tryShared, type Feed, type FeedRound, type RoundInfo, type ShowtimeServer } from './net'
import { showtimeSfx } from './sound'
import { MoneyWheel, STEP, restAngle } from './Wheel'
import { BoosterPanel } from './Booster'
import { Board } from './Board'
import { SpotBadge } from './art'
import { LOOK, fmtX } from './words'
import { seeded, type BonusTimes } from './bonus/kit'
import { CoinTossShow } from './bonus/CoinToss'
import { PegDropShow } from './bonus/PegDrop'
import { PrizeWallShow } from './bonus/PrizeWall'
import { MegaSpinShow } from './bonus/MegaSpin'
import { LIVE_MS, loadChip, loadLast, pendingAge, pendingKey, saveChip, saveLast, takeNotice, takePending } from './storage'

/*
  Showtime: a live game-show money wheel, the same show for everyone. Rounds come from the shared show in the
  database when it is reachable, otherwise from a stand-in with the same rules in the browser (net.ts). Each round
  takes bets for 15 s; chips go on the eight spots and leave the wallet as they are sent, waiting in the ledger
  (ledger.ts) until the round settles, once, wherever the page was when it ended. Then the show plays to the shared
  clock (clock.ts), so every browser sees it at the same moment: the Booster's reels light a spot, the wheel is pushed
  off and slows past the flapper onto the segment, and a number pays at once while a bonus round takes over the
  stage. In Prize Wall and Mega Spin every player picks their own tile or flapper on the shared wall and wheel.
  Everything a round does comes from its seed, committed to by its hash before anyone bets (fair.ts).

  Dev hook (dev builds, stand-in only): window.__stForce = 'coin' | 'peg' | 'wall' | 'mega' | '1' | '2' | '5' | '10'
  redraws the round taking bets to land on that spot; { spot, boost } also boosts it.
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000]
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
/** betting closes on this page a little before the server's close, so a chip sent at the last moment still lands */
const CLIENT_CLOSE_MS = CLOSE_MS + 220
/** picks close on this page a little before the server's close, for the same reason */
const PICK_CLOSE_MS = 600
const spinEase = cubicBezier(0.1, 0.55, 0.08, 1)

type Scene = 'wait' | 'betting' | 'shut' | 'boost' | 'spin' | 'landed' | 'bonus' | 'result'

/** what the stage shows at `now`: `bonus` is whether the round is a bonus round (null while its key is unknown) */
function sceneAt(r: FeedRound, bonus: boolean | null, now: number): Scene {
  if (now < r.startsAt - CLIENT_CLOSE_MS) return 'betting'
  if (now >= r.nextAt) return 'wait'
  if (now < r.startsAt) return 'shut'
  if (now < r.startsAt + BOOST_MS || bonus == null) return now < r.landsAt ? (now < r.startsAt + BOOST_MS ? 'boost' : 'spin') : 'wait'
  if (now < r.landsAt) return 'spin'
  if (!bonus) return 'result'
  if (now < r.landsAt + LAND_MS) return 'landed'
  return now < r.endsAt + PLATE_MS ? 'bonus' : 'result'
}

// a stand-in for a round whose result can't matter: none of the stakes reached it, so they all come back
const NOTHING: Round = { booster: null, segment: 1, spot: '1', bonus: null }

/** where the wheel rests after round `id` lands on `segment`: a little off the centre of the segment, the same everywhere */
const restOf = (id: number, segment: number) => restAngle(segment, (seeded(id, 99)() - 0.5) * 0.7)

/** a round of the history, worked out from its seed */
interface Past {
  id: number
  seed: string
  spot: Spot
  boosted: boolean
  /** what it paid to 1, when that was the same for everyone (not Prize Wall or Mega Spin) */
  win: number | null
  round: Round
}

type PickState = { round: number; pick: number; state: 'sending' | 'ok' | 'failed' | 'local' }

function useWide() {
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)')
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

export default function Showtime() {
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)
  const profile = useAuth((s) => s.profile)
  const who = uid ?? 'guest'
  const [guestName, setGuestName] = useState(defaultName)
  const name = profile?.username ?? guestName
  const avatar = profile?.avatar ?? guestAvatar()
  const lg = useWide()

  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }
  const [last, setLast] = useState<Stakes | null>(loadLast)
  const [undo, setUndo] = useState<{ round: number; list: Stakes[] }>({ round: -1, list: [] })
  const [info, setInfo] = useState(false)
  const [fair, setFair] = useState<number | null>(null)
  const [say, setSay] = useState('')
  const rot = useMotionValue(0)
  const flap = useMotionValue(0)
  const [stageRef, size] = useSize<HTMLDivElement>({ w: 900, h: 520 })

  const [server, setServer] = useState<ShowtimeServer | null>(null)
  const serverRef = useRef<ShowtimeServer | null>(null)
  serverRef.current = server
  const [conn, setConn] = useState<Conn>('connecting')
  const [feed, setFeed] = useState<Feed | null>(null)
  const feedRef = useRef<Feed | null>(null)
  const [hist, setHist] = useState<{ id: number; seed: string }[]>([])
  const histRef = useRef(hist)
  const offset = useRef(0) // server clock minus local clock
  const clock = useCallback(() => Date.now() + offset.current, [])
  const [scene, setScene] = useState<Scene>('wait')
  /** this round's stakes as the board shows them: the ledger's, or the last change sent while it is on its way */
  const [mine, setMine] = useState<Stakes>({})
  const [result, setResult] = useState<{ round: number; outcome: Outcome } | null>(null)
  const [pickState, setPickState] = useState<PickState | null>(null)
  const whoRef = useRef(who)
  whoRef.current = who
  const nameRef = useRef({ name, avatar })
  nameRef.current = { name, avatar }
  const countRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  // the stake changes on their way to the server, one at a time, and the stakes the board shows meanwhile
  const pending = useRef(0)
  const view = useRef<{ round: number; stakes: Stakes } | null>(null)
  const queue = useRef<Promise<void>>(Promise.resolve())

  /* ---------------- connection and polling ---------------- */

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
      if (!server.online) return 250
      const est = clock()
      const r = f.round
      if (est >= r.nextAt) return 350
      // betting has closed but this answer came from before: the key is due now
      if (r.phase === 'betting' && est >= r.startsAt - CLOSE_MS) return 90
      if (r.picksUntil != null && f.now < r.picksUntil && est >= r.picksUntil) return 90
      const busy = openRounds(whoRef.current, server.book).length > 0
      const base = document.hidden && !busy ? 5000 : r.phase === 'betting' ? 1000 : 1700
      // be there when betting closes (the key), after the show starts (the final bets), when the picks close (the
      // seed), when the result is final, and when the next round opens
      const next = [r.startsAt - CLOSE_MS + 40, r.startsAt + 1200, r.picksUntil != null ? r.picksUntil + 40 : null, r.endsAt + 80, r.nextAt + 60].find((m): m is number => m != null && m > est + 30)
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
        if (!pending.current) setMine(stakeOf(whoRef.current, server.book, f.round.id))
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

  const retryShared = async () => {
    setConn('connecting')
    const s = await tryShared()
    if (s) {
      feedRef.current = null
      setFeed(null)
      setHist([])
      setServer(s)
      setConn('live')
    } else {
      setConn('solo')
      pushToast({ kind: 'info', title: 'The shared show is still unavailable.' })
    }
  }

  /* ---------------- the round on show ---------------- */

  // the round as far as it is revealed: from its key once betting closes, all of it once its seed is out
  const drawn = useMemo(() => {
    const r = feed?.round
    if (!r?.key) return null
    return { id: r.id, round: drawRound(drawFrom(r.key), r.seed ? drawFrom(r.seed) : null) }
    // the round changes only with its id, key and seed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.round.id, feed?.round.key, feed?.round.seed])
  const drawnRef = useRef(drawn)
  drawnRef.current = drawn

  // the history, worked out from the seeds (once each)
  const pastCache = useRef(new Map<number, Past>())
  const past = useMemo(() => {
    return hist.map((h) => {
      let p = pastCache.current.get(h.id)
      if (!p || p.seed !== h.seed) {
        const round = roundFromSeed(h.seed)
        const b = round.bonus
        p = { id: h.id, seed: h.seed, spot: round.spot, boosted: boostOf(round) > 1, win: b && (b.kind === 'wall' || b.kind === 'mega') ? null : winOf(round), round }
        pastCache.current.set(h.id, p)
        if (pastCache.current.size > 300) pastCache.current.delete(pastCache.current.keys().next().value!)
      }
      return p
    })
  }, [hist])

  /* ---------------- settling ---------------- */

  const announced = useRef(new Set<string>())
  const announce = (book: Book, id: number, res: { outcome: Outcome; paid: boolean }, live: boolean) => {
    const o = res.outcome
    const key = `${book}:${id}`
    const first = !announced.current.has(key)
    announced.current.add(key)
    if (live) setResult({ round: id, outcome: o })
    if (!res.paid || !first) return
    if (live) {
      if (o.refund > 0) pushToast({ kind: 'info', title: `${fmt(o.refund)} of your bets never reached the show, so it came back.` })
    } else if (o.bet > 0) {
      const what = o.payout > o.bet ? `won ${fmt(o.payout)}` : o.payout > 0 ? `${fmt(o.payout)} of ${fmt(o.bet)} back` : `lost ${fmt(o.bet)}`
      pushToast({ kind: o.payout > o.bet ? 'win' : o.payout > 0 ? 'info' : 'loss', title: `Showtime round #${id} (${LOOK[o.spot].name}) settled while you were away: ${what}` })
    } else if (o.refund > 0) pushToast({ kind: 'info', title: `Your bets on Showtime round #${id} never reached the show, so ${fmt(o.refund)} came back.` })
  }

  /** Settles every round this browser has paid into whose result the feed can tell. Safe to call any time. */
  const settling = useRef(false)
  const settleFrom = async (book: Book, f: Feed, est: number, live: boolean) => {
    const me = whoRef.current
    for (const id of openRounds(me, book)) {
      let res: { outcome: Outcome; paid: boolean } | null = null
      if (id === f.round.id) {
        const r = f.round
        // the bets are final once the show has started, the picks once they have closed; pay when the result is out
        if (est < r.endsAt || f.now < r.startsAt || (r.picksUntil != null && f.now < r.picksUntil) || !r.key) continue
        const round = r.seed ? roundFromSeed(r.seed) : drawRound(drawFrom(r.key), null)
        if (!revealed(round)) continue
        const h = hashOf(me, book, id)
        const stale = !!h && h !== r.hash
        res = await settleRound(me, book, id, round, stale ? null : f.pick, stale ? null : f.mine)
        if (res) announce(book, id, res, live)
      } else if (id < f.round.id) {
        const p = f.past.find((x) => x.round === id)
        if (p) res = await settleRound(me, book, id, roundFromSeed(p.seed), p.pick, p.stakes)
        // so old the round may have been cleared away: there is no telling what happened
        else if (Date.now() - ageOf(me, book, id) > KEEP_MS[book]) await loseRound(me, book, id)
        // asked about, finished, and holding nothing of mine: none of it reached the show
        else if (f.asked.includes(id)) res = await settleRound(me, book, id, NOTHING, null, null)
        if (res) announce(book, id, res, false)
      } else if (Date.now() - ageOf(me, book, id) > 10 * 60_000) {
        // a round ahead of the server's: the database was reset, so it can never finish
        res = await settleRound(me, book, id, NOTHING, null, null)
        if (res) announce(book, id, res, false)
      }
    }
  }
  const settleDue = async () => {
    const s = serverRef.current
    const f = feedRef.current
    if (settling.current || !s || !f) return
    settling.current = true
    try {
      await settleFrom(s.book, f, clock(), true)
      // stakes from an offline session settle from the stand-in
      if (s.book === 'shared' && openRounds(whoRef.current, 'local').length) {
        const lf = await localStandIn().state(null, openRounds(whoRef.current, 'local'))
        await settleFrom('local', lf, lf.now, false)
      }
    } finally {
      settling.current = false
    }
  }

  // a round of the single-player Showtime that a page left unpaid is paid on the next visit, once sign-in has settled
  useEffect(() => {
    if (authStatus === 'loading') return
    const n = takeNotice()
    if (n) {
      if (n.amount > 0) pushToast({ kind: 'win', title: `Your last Showtime spin (${LOOK[n.spot].name}) paid out when you left`, amount: n.amount })
      else pushToast({ kind: 'info', title: `Your last Showtime spin landed on ${LOOK[n.spot].name}: no win` })
    }
    let timer = 0
    const recover = () => {
      const key = pendingKey(uid)
      const age = pendingAge(key)
      if (age == null) return
      if (age < LIVE_MS) {
        timer = window.setTimeout(recover, LIVE_MS - age + 300)
        return
      }
      const p = takePending(key)
      if (!p) return
      useWallet.getState().settle({ game: 'showtime', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
      if (p.payout > 0) pushToast({ kind: 'win', title: `Your unfinished Showtime spin (${LOOK[p.spot].name}) paid out`, amount: p.payout })
      else pushToast({ kind: 'info', title: `Your unfinished Showtime spin landed on ${LOOK[p.spot].name}: no win` })
    }
    recover()
    return () => clearTimeout(timer)
    // pushToast is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, uid])

  /* ---------------- betting ---------------- */

  const canBet = () => {
    const f = feedRef.current
    return !!f && f.round.phase === 'betting' && clock() < f.round.startsAt - CLIENT_CLOSE_MS
  }
  /** this round's stakes as they stand on this page */
  const current = (): Stakes => {
    const s = serverRef.current
    const f = feedRef.current
    if (!s || !f) return {}
    const v = view.current
    return v && v.round === f.round.id ? v.stakes : stakeOf(whoRef.current, s.book, f.round.id)
  }

  /**
   * Puts this round's stakes to `target`: what is added leaves the wallet now and waits in the ledger, what is taken
   * off comes back once the server confirms it. The changes go out one at a time, in order.
   */
  function change(target: Stakes): boolean {
    const s = serverRef.current
    const f = feedRef.current
    if (!s || !f || !canBet()) return false
    const id = f.round.id
    const cur = current()
    const delta: Stakes = {}
    const adds: Stakes = {}
    for (const k of SPOTS) {
      const d = round2((target[k] ?? 0) - (cur[k] ?? 0))
      if (d === 0) continue
      delta[k] = d
      if (d > 0) adds[k] = d
    }
    if (!Object.keys(delta).length) return false
    const add = stakeTotal(adds)
    const me = whoRef.current
    if (add > 0 && !useWallet.getState().placeBet(add)) {
      pushToast({ kind: 'info', title: NO_COINS })
      return false
    }
    if (add > 0) addStakes(me, s.book, id, f.round.hash, adds)
    const next = cleanStakes(target)
    view.current = { round: id, stakes: next }
    setMine(next)
    pending.current++
    const { name: nm, avatar: av } = nameRef.current
    queue.current = queue.current.then(async () => {
      try {
        const r = await s.bet(id, delta, nm, av)
        if (r.ok) {
          const removed: Stakes = {}
          for (const k of SPOTS) if ((delta[k] ?? 0) < 0) removed[k] = -delta[k]!
          if (Object.keys(removed).length) await trimTo(me, s.book, id, r.held, removed)
        } else {
          const back = add > 0 ? await refundStakes(me, s.book, id, adds) : 0
          const tail = back > 0 ? ` Your ${fmt(back)} came back.` : ''
          pushToast({ kind: 'info', title: r.error === 'closed' ? `Too late, betting had closed.${tail}` : r.error === 'limit' ? `That would go over ${fmt(SPOT_LIMIT, 0)} on a spot.${tail}` : `That bet was refused.${tail}` })
          view.current = null
        }
      } catch {
        pushToast({ kind: 'info', title: 'Connection trouble. If that bet missed the show, it comes back when the round ends.' })
      } finally {
        pending.current--
        if (!pending.current) {
          view.current = null
          if (feedRef.current?.round.id === id) setMine(stakeOf(me, s.book, id))
        }
        poll.current()
      }
    })
    return true
  }

  const roundId = feed?.round.id ?? -1
  const undoList = undo.round === roundId ? undo.list : []
  const pushUndo = (s: Stakes) => setUndo((u) => ({ round: roundId, list: [...(u.round === roundId ? u.list : []).slice(-40), s] }))
  const bet = (s: Spot) => {
    if (!canBet()) return
    const cur = current()
    const have = useWallet.getState().balance
    const room = Math.min(SPOT_LIMIT - (cur[s] ?? 0), MAX_BET - stakeTotal(cur), have)
    const add = round2(Math.min(chip, room))
    if (add < 1) {
      pushToast({ kind: 'info', title: SPOT_LIMIT - (cur[s] ?? 0) < 1 ? `Limit reached: ${fmt(SPOT_LIMIT, 0)} on ${LOOK[s].name}` : have < 1 ? NO_COINS : `Table limit: ${fmt(MAX_BET, 0)} a round` })
      return
    }
    if (change({ ...cur, [s]: round2((cur[s] ?? 0) + add) })) {
      pushUndo(cur)
      showtimeSfx.chip(SPOTS.indexOf(s))
    }
  }
  const doUndo = () => {
    if (!canBet() || !undoList.length) return
    if (change(undoList[undoList.length - 1])) setUndo({ round: roundId, list: undoList.slice(0, -1) })
  }
  const clear = () => {
    const cur = current()
    if (!canBet() || !stakeTotal(cur)) return
    if (change({})) pushUndo(cur)
  }
  const double = () => {
    const cur = current()
    if (!canBet() || !stakeTotal(cur)) return
    if (stakeTotal(cur) > useWallet.getState().balance) return void pushToast({ kind: 'info', title: NO_COINS })
    if (stakeTotal(cur) * 2 > MAX_BET || SPOTS.some((s) => (cur[s] ?? 0) * 2 > SPOT_LIMIT)) return void pushToast({ kind: 'info', title: 'That would go over the table limit' })
    if (change(Object.fromEntries(SPOTS.filter((s) => cur[s]).map((s) => [s, round2(cur[s]! * 2)])) as Stakes)) pushUndo(cur)
  }
  const repeat = () => {
    const cur = current()
    if (!canBet() || !last) return
    if (round2(stakeTotal(last) - stakeTotal(cur)) > useWallet.getState().balance) return void pushToast({ kind: 'info', title: NO_COINS })
    if (change(last)) pushUndo(cur)
  }

  /* ---------------- picks ---------------- */

  const choose = async (i: number) => {
    const s = serverRef.current
    const f = feedRef.current
    const d = drawnRef.current
    if (!s || !f || !d || d.id !== f.round.id || f.round.picksUntil == null) return
    const b = d.round.bonus
    if (!b || (b.kind !== 'wall' && b.kind !== 'mega') || clock() >= f.round.picksUntil - PICK_CLOSE_MS) return
    const id = f.round.id
    const staked = (stakeOf(whoRef.current, s.book, id)[d.round.spot] ?? 0) > 0
    setPickState({ round: id, pick: i, state: staked ? 'sending' : 'local' })
    showtimeSfx.choose()
    if (!staked) return
    try {
      const r = await s.pick(id, i)
      setPickState((p) => (p && p.round === id && p.pick === i ? { ...p, state: r.ok ? 'ok' : 'failed' } : p))
      if (!r.ok && r.error === 'none') pushToast({ kind: 'info', title: `Your stake on ${LOOK[d.round.spot].name} never reached the show, so your pick can't count.` })
    } catch {
      setPickState((p) => (p && p.round === id && p.pick === i ? { ...p, state: 'failed' } : p))
    }
    poll.current()
  }

  /* ---------------- the clock: scenes, countdown, the wheel ---------------- */

  const sceneRef = useRef<Scene>('wait')
  const boostFor = useRef(-1)
  const [boostSpin, setBoostSpin] = useState(0)
  const [boostResult, setBoostResult] = useState<Booster | null>(null)
  const [boostLanded, setBoostLanded] = useState(true)
  const [boostRound, setBoostRound] = useState(-1)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    let raf = 0
    let lastKey = ''
    let lastCount = -1
    /** the wheel's spin this round, from where it rested: set off on time, or late (and landing on time) */
    let plan: { id: number; from: number; to: number; t0: number; live: boolean } | null = null
    /** where the wheel rests, and the round whose betting this page watched with it there */
    let rest: { id: number; angle: number } | null = null
    let watched = -1
    let peg = 0
    let lastT = 0
    let lastV = 0
    const frame = () => {
      const f = feedRef.current
      const d = drawnRef.current
      if (f) {
        const est = clock()
        const r = f.round
        const mineDrawn = d && d.id === r.id ? d : null
        const sc = sceneAt(r, mineDrawn ? !!mineDrawn.round.bonus : null, est)
        const key = `${r.id}:${sc}`
        const audible = !document.hidden
        if (key !== lastKey) {
          if (lastKey === `${r.id}:betting` && sc !== 'betting') {
            // betting has closed: these stakes are the ones Repeat puts back
            const s = serverRef.current
            const st = s ? stakeOf(whoRef.current, s.book, r.id) : {}
            if (stakeTotal(st) > 0) {
              setLast(st)
              saveLast(st)
            }
          }
          lastKey = key
          sceneRef.current = sc
          setScene(sc)
          if (sc === 'betting') watched = r.id
        }
        if (sc === 'betting' || sc === 'shut') {
          const left = Math.max(0, r.startsAt - CLIENT_CLOSE_MS - est)
          if (countRef.current) countRef.current.textContent = (left / 1000).toFixed(1)
          if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, left / (BET_MS - CLIENT_CLOSE_MS)).toFixed(4)})`
          const s = Math.ceil(left / 1000)
          if (sc === 'betting' && s >= 1 && s <= 3 && s !== lastCount) {
            lastCount = s
            if (audible) showtimeSfx.count(s)
          }
        }
        // the wheel rests where the last round left it (on a fresh page, where the newest finished round landed)
        const head = histRef.current[0]
        if (!rest && head && head.id < r.id) {
          const seg = pastCache.current.get(head.id)?.round.segment
          if (seg != null) {
            rest = { id: head.id, angle: restOf(head.id, seg) }
            rot.set(rest.angle)
          }
        }
        if (mineDrawn && est >= r.startsAt + BOOST_MS) {
          const spinAt = r.startsAt + BOOST_MS
          if (!plan || plan.id !== r.id) {
            const from = rest?.angle ?? rot.get()
            const want = restOf(r.id, mineDrawn.round.segment)
            const base = from + 360 * 5
            // the key came in after the spin should have started while this page watched: set off now, land on time
            const t0 = watched === r.id && est > spinAt + 50 && r.landsAt - est >= 1800 ? est : spinAt
            plan = { id: r.id, from, to: base + ((((want - base) % 360) + 360) % 360), t0, live: est < r.landsAt }
            peg = Math.floor((from + STEP / 2) / STEP)
          }
          if (est < r.landsAt) {
            const p = Math.max(0, Math.min(1, (est - plan.t0) / (r.landsAt - plan.t0)))
            const v = plan.from + (plan.to - plan.from) * spinEase(p)
            rot.set(v)
            const now = performance.now()
            const speed = Math.min(1, Math.abs(v - lastV) / Math.max(1, now - lastT) / 1.2)
            lastT = now
            lastV = v
            const k = Math.floor((v + STEP / 2) / STEP)
            if (k !== peg) {
              peg = k
              if (audible) showtimeSfx.tick(speed)
              flap.set(-14 - 16 * (1 - speed))
              void animate(flap, 0, { type: 'spring', stiffness: 700, damping: 14 })
            }
          } else if (rest?.id !== r.id) {
            rot.set(plan.to)
            rest = { id: r.id, angle: plan.to }
            if (audible && plan.live) showtimeSfx.land(!!mineDrawn.round.bonus)
          }
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // reads refs only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // the Booster's reels run as the show starts, once the key is in; a page that comes in later shows where they stopped
  useEffect(() => {
    if (!drawn || drawn.id !== feed?.round.id || boostFor.current === drawn.id) return
    if (scene === 'boost') {
      boostFor.current = drawn.id
      setBoostRound(drawn.id)
      setBoostResult(drawn.round.booster)
      setBoostLanded(false)
      setBoostSpin((n) => n + 1)
      if (!document.hidden) showtimeSfx.boostStart()
      setSay('The Booster is spinning')
      timers.current.push(
        window.setTimeout(() => {
          setBoostLanded(true)
          if (!document.hidden) showtimeSfx.boost(drawn.round.booster?.mult ?? 0)
          setSay(drawn.round.booster ? `${LOOK[drawn.round.booster.spot].name} boosted times ${drawn.round.booster.mult}` : 'No boost this spin')
        }, 1950),
      )
    } else if (scene !== 'betting' && scene !== 'shut' && scene !== 'wait') {
      boostFor.current = drawn.id
      setBoostRound(drawn.id)
      setBoostResult(drawn.round.booster)
      setBoostLanded(true)
    }
  }, [scene, drawn, feed?.round.id])

  // the result: a sound and a word for it
  useEffect(() => {
    const r = drawn?.round
    if (!r || drawn!.id !== feed?.round.id) return
    if (scene === 'landed' || (scene === 'result' && !r.bonus)) setSay(`The wheel stops on ${LOOK[r.spot].name}`)
    if (scene !== 'result' || !result || result.round !== drawn!.id) return
    const o = result.outcome
    if (o.bet > 0 && !document.hidden) (o.payout > 0 ? () => showtimeSfx.win(o.payout >= o.bet * 10) : showtimeSfx.lose)()
    if (o.bet > 0) setSay(o.payout > 0 ? `You win ${fmt(o.payout)}` : 'No win this time')
    // once per round, as its result shows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, result?.round])

  // the keyboard: R repeats, U undoes, X clears, D doubles, 1-8 put the chip on a spot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey || info || fair != null) return
      if (e.key === 'r' || e.key === 'R') repeat()
      else if (e.key === 'u' || e.key === 'U') doUndo()
      else if (e.key === 'x' || e.key === 'X') clear()
      else if (e.key === 'd' || e.key === 'D') double()
      else if (/^[1-8]$/.test(e.key)) bet(SPOTS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- view ---------------- */

  const round = feed?.round ?? null
  const shown = drawn && round && drawn.id === round.id ? drawn.round : null
  const open = scene === 'betting' && round?.phase === 'betting'
  const total = stakeTotal(mine)
  const myResult = result && round && result.round === round.id ? result.outcome : null
  const shownBoost = boostLanded && boostRound === round?.id && scene !== 'betting' && scene !== 'shut' && scene !== 'wait' ? boostResult : null
  const winner = shown && (scene === 'landed' || scene === 'bonus' || scene === 'result') ? shown.spot : null
  const pickFor = pickState && round && pickState.round === round.id ? pickState : null
  // the pick that counts: the server's for a player with a stake on the round (none: the round's own), once the picks are in
  const b = shown?.bonus
  const choice = b && (b.kind === 'wall' || b.kind === 'mega') ? b : null
  const picksIn = !!round && round.picksUntil != null && !!feed && feed.now >= round.picksUntil && !!round.seed
  const onSpot = shown ? (mine[shown.spot] ?? 0) : 0
  const played = choice && picksIn ? pickOf(choice, onSpot > 0 ? (feed!.pick ?? null) : (pickFor?.pick ?? null)) : null
  const bonusTimes: BonusTimes | null = round && shown?.bonus ? { bonusAt: round.landsAt + LAND_MS, playAt: round.landsAt + LAND_MS + INTRO_MS, picksUntil: round.picksUntil, endsAt: round.endsAt } : null
  const myWin = shown && revealed(shown) ? (shown.bonus ? bonusWin(shown, played) : winOf(shown)) : null

  const wide = size.w >= 760
  // the wheel is big, its top under the flapper near the top of the stage and its lower part running off the bottom
  const wheelSize = Math.max(240, Math.min(size.w * (wide ? 0.6 : 0.98), size.h * (wide ? 1.3 : 1.18)))
  // the history as this player saw it: their own win in a Prize Wall or Mega Spin they played
  const views = useMemo(
    () =>
      past.map((p) => {
        if (p.win != null || !server) return p
        const o = settledOf(who, server.book, p.id)?.outcome
        return o && o.spot === p.spot && o.bet > 0 && (o.landed[p.spot] ?? 0) > 0 ? { ...p, win: o.win } : p
      }),
    [past, who, server, result],
  )
  const busy = openRounds(who, server?.book ?? 'shared').length > 0

  const status = !round
    ? 'Joining the show…'
    : scene === 'betting'
      ? total
        ? `${fmt(total)} on the board`
        : 'Place your bets'
      : scene === 'shut'
        ? 'No more bets'
        : scene === 'boost'
          ? 'The Booster is choosing a spot…'
          : scene === 'spin'
            ? 'Round and round it goes…'
            : scene === 'landed' && shown
              ? `The wheel stops on ${LOOK[shown.spot].name}`
              : scene === 'bonus' && shown
                ? LOOK[shown.spot].name
                : scene === 'result' && shown
                  ? myResult && myResult.bet > 0
                    ? myResult.payout > 0
                      ? `You win ${fmt(myResult.payout)}`
                      : `${LOOK[shown.spot].name}. No win this time`
                    : `${LOOK[shown.spot].name}${myWin != null ? ` pays ${fmtX(myWin)}` : ''}`
                  : 'Next round coming up…'

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-line bg-[#0d0a1c] shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
        <div ref={stageRef} data-scene={scene} data-round={round?.id} className="relative h-[min(52vh,470px)] min-h-[330px] select-none overflow-hidden lg:h-[calc(100dvh-108px-262px)] lg:min-h-[400px]">
          {/* the studio: a purple glow behind the wheel, two spotlights and a lit floor */}
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,#3b2380_0%,#1a1040_45%,#0d0a1c_80%)]" />
          <div className="pointer-events-none absolute -left-[10%] -top-1/4 h-[150%] w-[38%] origin-top rotate-[20deg] bg-[linear-gradient(180deg,rgba(255,236,170,.13),transparent_65%)] blur-2xl" />
          <div className="pointer-events-none absolute -right-[10%] -top-1/4 h-[150%] w-[38%] origin-top -rotate-[20deg] bg-[linear-gradient(180deg,rgba(170,220,255,.12),transparent_65%)] blur-2xl" />
          <div className="absolute" style={{ width: wheelSize, height: wheelSize, left: (size.w - wheelSize) / 2, top: wide ? 30 : 24 }}>
            <MoneyWheel rot={rot} flap={flap} boosted={shownBoost?.spot ?? null} boost={shownBoost?.mult ?? 1} chase={scene === 'spin'} win={scene === 'spin' ? null : winner} />
          </div>
          <div className="absolute left-2 top-2 z-10 origin-top-left max-sm:scale-[.8] sm:left-3 sm:top-3">
            <BoosterPanel result={boostResult} spin={boostSpin} landed={boostLanded} onStop={(i) => showtimeSfx.reelStop(i)} compact={!wide} />
          </div>
          <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-2 sm:right-3 sm:top-3">
            <button onClick={() => setInfo(true)} className="flex h-9 items-center gap-1.5 rounded-full bg-black/40 px-3 text-[12.5px] font-bold text-white/85 ring-1 ring-white/10 transition hover:bg-black/60">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/85 text-[10px] font-black text-[#140e33]">?</span>
              <span className="hidden sm:inline">How it works</span>
            </button>
            {wide && <HistoryColumn items={views} onPick={setFair} />}
          </div>
          {/* what is happening, at the foot of the stage */}
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
            <motion.div key={scene} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="rounded-full bg-black/55 px-4 py-1.5 text-[13px] font-bold text-white/90 ring-1 ring-white/10 backdrop-blur">
              {status}
            </motion.div>
          </div>
          <AnimatePresence>
            {scene === 'bonus' && round && shown?.bonus && bonusTimes && (
              <BonusRound
                key={round.id}
                id={round.id}
                clock={clock}
                t={bonusTimes}
                round={shown}
                stake={onSpot}
                win={myWin}
                chosen={pickFor?.pick ?? null}
                played={played}
                note={pickFor?.state ?? null}
                onPick={(i) => void choose(i)}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>{scene === 'result' && myResult && myResult.payout > 0 && <WinPlate key={round!.id} outcome={myResult} />}</AnimatePresence>
          <div className="sr-only" aria-live="polite">
            {say}
          </div>
        </div>

        <div className="flex flex-col gap-2.5 bg-panel2 p-2.5 sm:p-3">
          {!wide && <HistoryStrip items={views} onPick={setFair} />}
          <Board stakes={mine} onBet={bet} open={open} boost={shownBoost} winner={scene === 'result' || scene === 'bonus' || scene === 'landed' ? winner : null} totals={feed?.spots} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="no-scrollbar -mx-1 flex w-full min-w-0 gap-1 overflow-x-auto px-1 py-0.5 sm:w-auto sm:flex-1">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  onClick={() => setChip(v)}
                  aria-label={`Chip ${v}`}
                  aria-pressed={chip === v}
                  className={`shrink-0 rounded-full transition ${chip === v ? '-translate-y-1 ring-2 ring-white ring-offset-2 ring-offset-panel2' : 'opacity-70 hover:opacity-100'}`}
                >
                  <Chip value={v} size={38} label={chipLabel(v)} />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <Small onClick={doUndo} off={!open || !undoList.length}>
                Undo<Kbd>U</Kbd>
              </Small>
              <Small onClick={clear} off={!open || !total}>
                Clear<Kbd>X</Kbd>
              </Small>
              <Small onClick={double} off={!open || !total}>
                ×2<Kbd>D</Kbd>
              </Small>
              <Small onClick={repeat} off={!open || !last}>
                Repeat<Kbd>R</Kbd>
              </Small>
            </div>
            <BetClock open={open} scene={scene} total={total} countRef={countRef} barRef={barRef} players={feed?.players ?? 0} />
          </div>
          <div className={`grid gap-2.5 ${lg ? 'grid-cols-[1fr_1fr]' : ''}`}>
            <StatusCard
              conn={conn}
              online={feed?.online ?? 0}
              bots={feed?.bots ?? 0}
              name={name}
              editable={!profile}
              onName={(n) => (setGuestName(n), saveName(n))}
              onFair={() => round && setFair(round.id)}
              onRetry={retryShared}
              busy={busy}
            />
            <YourRound mine={mine} round={round?.id ?? null} result={myResult} shown={shown} scene={scene} />
          </div>
        </div>
      </div>
      <AnimatePresence>{info && <HowItWorks onClose={() => setInfo(false)} />}</AnimatePresence>
      <AnimatePresence>{fair != null && server && feed && <FairnessModal server={server} feed={feed} past={past} id={fair} onPick={setFair} onClose={() => setFair(null)} />}</AnimatePresence>
    </div>
  )
}

function Small({ onClick, off, children }: { onClick: () => void; off: boolean; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={off} className="flex h-10 items-center rounded-lg bg-raised px-2.5 text-[12.5px] font-bold text-ink transition hover:bg-hover disabled:opacity-40 sm:px-3">
      {children}
    </button>
  )
}

/** where the Spin button was: the betting countdown, then what the show is doing */
function BetClock({ open, scene, total, countRef, barRef, players }: { open: boolean; scene: Scene; total: number; countRef: React.Ref<HTMLSpanElement>; barRef: React.Ref<HTMLDivElement>; players: number }) {
  const betting = scene === 'betting' || scene === 'shut'
  return (
    <div
      className={`relative flex h-12 min-w-[170px] flex-1 items-center justify-center gap-2 overflow-hidden rounded-xl px-5 text-[15px] font-black sm:flex-none ${open ? 'bg-accent text-[#032412] shadow-[0_10px_28px_-10px_rgba(34,211,111,.8)]' : 'bg-raised text-ink/80'}`}
      role="timer"
    >
      {betting && <div ref={barRef} className={`absolute inset-y-0 left-0 w-full origin-left ${open ? 'bg-white/20' : 'bg-white/5'}`} />}
      <span className="relative flex items-center gap-2">
        {open ? (
          <>
            Bets close in <span ref={countRef} className="tnum w-9 text-left" />
            {total > 0 && (
              <span className="tnum flex items-center gap-1 rounded-md bg-black/15 px-1.5 py-0.5 text-[13px]">
                {fmt(total)} <Coin size={13} />
              </span>
            )}
          </>
        ) : scene === 'shut' ? (
          <>
            <span ref={countRef} className="hidden" />
            No more bets
          </>
        ) : scene === 'wait' ? (
          'Next round…'
        ) : (
          <>Spinning{players > 0 ? ` · ${players} ${players === 1 ? 'player' : 'players'}` : ''}</>
        )}
      </span>
    </div>
  )
}

/** this round's bets, and what they came to */
function YourRound({ mine, round, result, shown, scene }: { mine: Stakes; round: number | null; result: Outcome | null; shown: Round | null; scene: Scene }) {
  const placed = SPOTS.filter((s) => (mine[s] ?? 0) > 0)
  const total = stakeTotal(mine)
  const settled = !!result && scene === 'result'
  return (
    <div className="rounded-xl bg-stage p-3 text-[12px]">
      <div className="mb-2 flex items-center justify-between font-bold text-muted">
        <span>Your bets</span>
        {round != null && <span className="tnum text-dim">Round #{round}</span>}
      </div>
      {placed.length === 0 && !settled ? (
        <p className="leading-relaxed text-dim">Tap a spot to put the chip on it. Bets stay open for 15 seconds, then everyone watches the same spin.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {(settled ? SPOTS.filter((s) => (result!.landed[s] ?? 0) > 0) : placed).map((s) => {
            const amt = settled ? result!.landed[s]! : mine[s]!
            const hit = shown && scene !== 'betting' && scene !== 'shut' && scene !== 'boost' && scene !== 'spin' ? shown.spot === s : null
            return (
              <span key={s} className={`tnum flex items-center gap-1 rounded-full bg-black/25 py-0.5 pl-0.5 pr-2 font-bold ${hit === false ? 'opacity-45' : ''}`}>
                <SpotBadge spot={s} size={18} />
                {fmt(amt)}
              </span>
            )
          })}
          <span className="tnum ml-auto flex items-center gap-1 font-bold text-ink">
            {settled ? (result!.payout > 0 ? <span className="text-accent">won {fmt(result!.payout)}</span> : <span className="text-dim">no win</span>) : (
              <>
                {fmt(total)} <Coin size={13} />
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

/** the bonus round the wheel stopped on, over the stage */
function BonusRound({
  id,
  clock,
  t,
  round,
  stake,
  win,
  chosen,
  played,
  note,
  onPick,
}: {
  id: number
  clock: () => number
  t: BonusTimes
  round: Round
  stake: number
  win: number | null
  chosen: number | null
  played: number | null
  note: PickState['state'] | null
  onPick: (i: number) => void
}) {
  const b = round.bonus!
  const boost = boostOf(round)
  const common = { clock, t, boost, stake }
  if (b.kind === 'coin') return <CoinTossShow round={b} {...common} win={win ?? 0} />
  if (b.kind === 'peg') return <PegDropShow round={b} {...common} win={win ?? 0} id={id} />
  if (b.kind === 'wall') return <PrizeWallShow round={b} {...common} win={win} chosen={chosen} played={played} note={note} onPick={onPick} />
  return <MegaSpinShow round={b} {...common} win={win} chosen={chosen} played={played} note={note} onPick={onPick} id={id} />
}

/** the round's payout, over the stage */
function WinPlate({ outcome }: { outcome: Outcome }) {
  const big = outcome.payout >= outcome.bet * 10
  const L = LOOK[outcome.spot]
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div
        initial={{ scale: 0.5, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 16 }}
        className="rounded-3xl border-4 bg-[#140e33]/92 px-8 py-4 text-center backdrop-blur"
        style={{ borderColor: big ? '#f7c548' : '#22d36f', boxShadow: `0 0 70px -10px ${big ? '#f7c548' : '#22d36f'}` }}
      >
        <div className="flex items-center justify-center gap-2 text-[12px] font-black uppercase tracking-[.2em] text-white/70">
          <SpotBadge spot={outcome.spot} size={20} /> {L.name} {fmtX(outcome.win)}
        </div>
        <div className={`tnum mt-1 flex items-center justify-center gap-2 text-[40px] font-black leading-none sm:text-[52px] ${big ? 'text-gold' : 'text-accent'}`}>
          +{fmt(outcome.payout)} <Coin size={34} />
        </div>
        {big && <div className="mt-1 text-[13px] font-black uppercase tracking-widest text-gold">Big win!</div>}
      </motion.div>
    </motion.div>
  )
}

/** the last results, newest at the top, beside the wheel */
function HistoryColumn({ items, onPick }: { items: Past[]; onPick: (id: number) => void }) {
  const list = items.slice(0, 9)
  if (!list.length) return null
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-black/35 p-1.5 ring-1 ring-white/10">
      {list.map((h, i) => (
        <motion.button key={h.id} onClick={() => onPick(h.id)} aria-label={`Round ${h.id}: ${LOOK[h.spot].name}`} initial={{ opacity: 0, x: 10 }} animate={{ opacity: i ? 0.85 : 1, x: 0 }} className="flex items-center gap-1.5 rounded-lg px-1 py-0.5 transition hover:bg-white/10">
          <SpotBadge spot={h.spot} size={22} />
          {isBonus(h.spot) && h.win != null && <span className="tnum text-[11.5px] font-black text-white">{fmtX(h.win)}</span>}
          {h.boosted && <span className="tnum rounded bg-gold/90 px-1 text-[10px] font-black text-[#3a2400]">B</span>}
        </motion.button>
      ))}
    </div>
  )
}

/** the last results in a row, newest first, on narrow screens */
function HistoryStrip({ items, onPick }: { items: Past[]; onPick: (id: number) => void }) {
  const list = items.slice(0, 14)
  if (!list.length) return null
  return (
    <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
      <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-dim">Last</span>
      {list.map((h) => (
        <button key={h.id} onClick={() => onPick(h.id)} aria-label={`Round ${h.id}: ${LOOK[h.spot].name}`} className="flex shrink-0 items-center gap-1 rounded-full bg-black/30 py-0.5 pl-0.5 pr-2">
          <SpotBadge spot={h.spot} size={20} />
          <span className="tnum text-[11px] font-black text-white/85">{h.win != null ? fmtX(h.win) : LOOK[h.spot].short}</span>
        </button>
      ))}
    </div>
  )
}

/** A round's published hash, its key once betting closes and its seed once it is revealed, checked in the browser. */
function FairnessModal({ server, feed, past, id, onPick, onClose }: { server: ShowtimeServer; feed: Feed; past: Past[]; id: number; onPick: (id: number) => void; onClose: () => void }) {
  const current = feed.round.id === id ? feed.round : null
  const [info, setInfo] = useState<RoundInfo | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setInfo(null)
    if (current) return setState('ready')
    setState('loading')
    server
      .roundInfo(id)
      .catch(() => null)
      .then((r) => {
        if (!alive) return
        setInfo(r)
        setState(r ? 'ready' : 'missing')
      })
    return () => void (alive = false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const hash = current?.hash ?? info?.hash ?? null
  const key = current ? current.key : (info?.key ?? null)
  const seed = current ? current.seed : (info?.seed ?? null)
  const verdict = seed && hash && key ? verifyRound(seed, hash, key) : null
  const round = seed ? roundFromSeed(seed) : key ? drawRound(drawFrom(key), null) : null
  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(label)
      setTimeout(() => setCopied(null), 1200)
    })
  }
  const field = (label: string, value: string | null, placeholder: string) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-muted">
        {label}
        {value && (
          <button onClick={() => copy(label, value)} className="rounded px-1.5 py-0.5 text-[11px] font-bold text-dim transition hover:bg-panel2 hover:text-ink">
            {copied === label ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>
      <div className="break-all rounded-lg bg-stage px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink/90">{value || <span className="font-sans text-dim">{placeholder}</span>}</div>
    </div>
  )
  const check = (ok: boolean | undefined, text: string) => (
    <div className="flex items-center gap-2 text-[13px] font-semibold">
      <span className={`flex h-5 w-5 items-center justify-center rounded-full ${ok == null ? 'bg-raised' : ok ? 'bg-accent text-[#032412]' : 'bg-danger text-white'}`}>{ok == null ? <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted" /> : ok ? <IconCheck size={12} /> : '!'}</span>
      {text}
    </div>
  )
  const b = round?.bonus
  const shared = round && revealed(round) && (!b || (b.kind !== 'wall' && b.kind !== 'mega')) ? winOf(round) : null
  return (
    <Modal onClose={onClose} title={`Round #${id}`} width={540}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          {round ? (
            <>
              <SpotBadge spot={round.spot} size={44} />
              <div>
                <div className="text-[20px] font-black leading-tight">{LOOK[round.spot].name}</div>
                <div className="text-[12px] font-semibold text-muted">
                  {round.booster ? `Booster ×${round.booster.mult} on ${LOOK[round.booster.spot].name}` : 'The Booster missed'}
                  {shared != null && ` · paid ${fmtX(shared)}`}
                  {b?.kind === 'wall' && ' · each player’s own tile'}
                  {b?.kind === 'mega' && ' · each player’s own flapper'}
                </div>
              </div>
            </>
          ) : (
            <div className="text-[24px] font-black leading-none text-ink">{current?.phase === 'betting' ? 'Taking bets' : state === 'loading' ? 'Loading…' : 'Not found'}</div>
          )}
          {!server.online && <span className="ml-auto rounded-full bg-raised px-2.5 py-1 text-[11px] font-bold text-muted">Solo round</span>}
        </div>
        {field('Hash, published before betting', hash, state === 'missing' ? 'This round is too old to look up' : 'Loading…')}
        {field('Key, revealed when betting closes', key, current?.phase === 'betting' ? 'Revealed when betting closes' : state === 'missing' ? '—' : 'Loading…')}
        {field('Seed', seed, current ? (current.picksUntil != null ? 'Revealed when the picks close' : 'Revealed when the show ends') : state === 'missing' ? '—' : 'Loading…')}
        {verdict && round && (
          <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
            {check(verdict.hashOk, 'The seed matches the published hash')}
            {check(verdict.keyOk, 'The key is SHA-256(seed + ":key")')}
            {check(true, `The key draws segment ${round.segment}: ${LOOK[round.spot].name}`)}
          </div>
        )}
        {!!past.length && (
          <div>
            <div className="mb-2 text-[12px] font-bold text-muted">Recent rounds</div>
            <div className="flex flex-wrap gap-1.5">
              {past.slice(0, 18).map((h) => (
                <button key={h.id} onClick={() => onPick(h.id)} className={`rounded-full transition ${h.id === id ? 'ring-2 ring-ink ring-offset-2 ring-offset-panel' : 'opacity-80 hover:opacity-100'}`} aria-label={`Round ${h.id}`}>
                  <SpotBadge spot={h.spot} size={28} />
                </button>
              ))}
              {feed.round.id !== id && (
                <button onClick={() => onPick(feed.round.id)} className="rounded-full bg-raised px-3 py-1.5 text-[12px] font-extrabold text-muted hover:bg-hover hover:text-ink">
                  Current round
                </button>
              )}
            </div>
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-dim">
          Each round comes from a random seed whose SHA-256 hash is shown before anyone bets. When betting closes the key, SHA-256(seed + ":key"), is revealed: it draws the Booster, the segment and the bonus round as everyone sees
          it. The seed itself is revealed once the Prize Wall or Mega Spin picks are in (or when the show ends), and draws the prizes behind the wall and where the Mega Spin wheel stops, so no pick can know what it will turn up.
          Each number drawn for a purpose is the first 52 bits of SHA-256(root:purpose:index); your browser redraws the whole round from the seed.
        </p>
      </div>
    </Modal>
  )
}

function HowItWorks({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="How Showtime works" width={560}>
      <div className="flex flex-col gap-4 text-[13.5px] leading-relaxed text-muted">
        <p>
          Showtime is a live show: everyone watching bets on the same spin. Bets are open for 15 seconds; then the wheel spins for everyone at once. It has {SEGMENTS} segments; the spot it stops on wins and the rest lose. Numbers pay
          their value to 1, and a bonus round pays the multiplier it ends on, to 1. Your stake comes back on every win.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SPOTS.map((s) => (
            <div key={s} className="flex items-center gap-2 rounded-xl bg-stage px-2.5 py-2">
              <SpotBadge spot={s} size={28} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-bold text-ink">{s.length <= 2 ? `Number ${s}` : LOOK[s].name}</div>
                <div className="text-[11.5px] text-dim">
                  {COUNT[s]} of {SEGMENTS} segments
                </div>
              </div>
            </div>
          ))}
        </div>
        <p>
          <b className="text-ink">The Booster</b> runs before every spin and lights one spot with a multiplier from ×{BOOST[0][0]} to ×{BOOST[BOOST.length - 1][0]} (or misses, {Math.round(BOOST_MISS * 100)}% of the time). If the wheel stops on that
          spot, its win is multiplied: a boosted bonus round has all of its multipliers boosted.
        </p>
        <ul className="flex flex-col gap-1.5">
          {BONUS_SPOTS.map((s) => (
            <li key={s} className="flex gap-2">
              <SpotBadge spot={s} size={20} className="mt-0.5 shrink-0" />
              <span>
                <b className="text-ink">{LOOK[s].name}.</b>{' '}
                {s === 'coin' && 'A coin with a multiplier on each face is tossed; the face that lands up pays.'}
                {s === 'peg' && 'A puck drops down the pegs onto 16 slots. A DOUBLE doubles every slot and drops the puck again.'}
                {s === 'wall' && `${WALL_TILES} prizes hide behind the tiles of one wall. Everyone picks their own tile before the timer runs out.`}
                {s === 'mega' && `Pick one of ${FLAPPERS.length} flappers round one giant wheel. When yours stops on DOUBLE or TRIPLE, your whole wheel is multiplied and it spins again.`}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[12px] text-dim">
          Every spot returns {(RTP * 100).toFixed(0)}% over time (the Booster's chances are set so that each one does: {SPOTS.map((s) => `${LOOK[s].short} ${(BOOST_CHANCE[s] * 100).toFixed(1)}%`).join(', ')}), and in Prize Wall and Mega
          Spin every tile and flapper is as good as any other. A bonus round pays at most {fmtX(MAX_WIN)} your stake. One spot holds up to {fmt(SPOT_LIMIT, 0)} a round. Each round is provably fair: tap a result to check it.
        </p>
      </div>
    </Modal>
  )
}
