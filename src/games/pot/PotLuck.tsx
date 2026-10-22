import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { ActionButton, AnimatedNumber, BetInput, GameShell, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { PlayerName } from '../../components/profile/PlayerName'
import { fmt, round2 } from '../../lib/format'
import { safeStorage } from '../../lib/storage'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { StatusCard, type Conn } from '../double/bits'
import { BotTag, Crown, ShieldIcon, colourOf } from './art'
import { ChanceCard, FairnessModal, InfoModal, LiveFeed, Players, QuickAmounts, Winners, pct, type FeedLine, type PlayerRow } from './bits'
import { CLOSE_MS, phaseAt, spinAt } from './clock'
import { addPayment, countOf, openRounds, paidOf, pruneSettled, refundPayment, type Outcome } from './ledger'
import { asDeposits, connect, defaultName, guestAvatar, saveName, tryShared, type Dep, type Feed, type PotServer, type Winner } from './net'
import { BET_MS, MAX_DEPOSIT, MAX_DEPOSITS, MAX_PER_PLAYER, SHOW_MS, potOf, refuse, shares, ticketsOf, winnings } from './rules'
import { awayToast, settleFrom, settleLocal, type Settlement } from './settle'
import { potSfx } from './sound'
import { CoinDrop, Confetti, PotWheel, TRACK_LEN, pileTop, type Sliver, type Stage } from './Wheel'

/*
  Pot Luck: one pot for everyone, a cent a ticket, one ticket drawn.

  Rounds come from the shared pot in the database when it is reachable and from a stand-in in the browser otherwise
  (net.ts), on one timetable (clock.ts): 20 s to pay in, a 7 s draw, 4 s for the winner. While the jar is open anyone
  pays coins in (a few times, within rules.ts refuse()); each deposit drops into the jar in its player's colour and
  takes its sliver of the ring round it, so the ring always shows everyone's share of the tickets. When betting closes
  the server draws the winning ticket from the round's seed; the ring turns for the same 7 s in every browser (its
  angle is a function of the clock) and stops with that ticket under the pointer. The winner takes the pot less the
  rake: confetti if it's you, a polite flourish if not.

  Money: coins leave the wallet when they are paid in (useStake) and wait in the ledger (ledger.ts) until the round
  settles, exactly once, wherever the page was: here when the wheel lands (the winner worked out from the revealed
  seed, settle.ts), on the next visit, or from usePotPayouts in src/App.tsx while the player is elsewhere in the
  casino. A payment the server refuses comes back at once; one it never confirms comes back when the round settles.
  Every round is provably fair: its hash is shown before anyone pays in and its seed once the wheel lands (fair.ts).

  Dev hook (dev builds, stand-in only): window.__potForce = 'me' | 'bot' draws your ticket (or a bot's) in the round
  taking coins when its betting closes.
*/

/** betting closes on the client a little before the server's close, so a payment sent at the last moment still lands */
const CLIENT_CLOSE_MS = CLOSE_MS + 220
const AMOUNT_KEY = 'lumen.pot.amount'

const CSS = `
@keyframes pot-chase { 0%, 100% { opacity: .22 } 35% { opacity: 1 } }
.pot-chase { animation: pot-chase .48s linear infinite; }
@keyframes pot-flash { 0%, 100% { opacity: .3 } 50% { opacity: 1 } }
.pot-flash { animation: pot-flash .44s ease-in-out infinite; }
@keyframes pot-breathe { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.04) } }
@media (prefers-reduced-motion: reduce) { .pot-chase, .pot-flash { animation: none } }
`

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

const loadAmount = () => {
  const v = Number(safeStorage.getItem(AMOUNT_KEY))
  return Number.isFinite(v) && v >= 1 && v <= MAX_DEPOSIT ? v : 50
}

/** the deposit holding a ticket */
const holderOf = (ds: readonly { amount: number }[], ticket: number | null) => {
  if (ticket == null) return -1
  let at = 0
  for (let i = 0; i < ds.length; i++) {
    at += ticketsOf(ds[i].amount)
    if (ticket < at) return i
  }
  return -1
}

export default function PotLuck() {
  const pushToast = useWallet((s) => s.pushToast)
  const balance = useWallet((s) => s.balance)
  const stake = useStake()
  const uid = useAuth((s) => s.uid)
  const profile = useAuth((s) => s.profile)
  const who = uid ?? 'guest'
  const [guestName, setGuestName] = useState(defaultName)
  const name = profile?.username ?? guestName
  const avatar = profile?.avatar ?? guestAvatar()
  const wide = useWide()

  const [amount, setAmountState] = useState(loadAmount)
  const setAmount = (v: number) => {
    setAmountState(v)
    safeStorage.setSoon(AMOUNT_KEY, String(v))
  }
  const [server, setServer] = useState<PotServer | null>(null)
  const serverRef = useRef<PotServer | null>(null)
  serverRef.current = server
  const [conn, setConn] = useState<Conn>('connecting')
  const [feed, setFeed] = useState<Feed | null>(null)
  const feedRef = useRef<Feed | null>(null)
  const [hist, setHist] = useState<Winner[]>([])
  const histRef = useRef(hist)
  const offset = useRef(0) // server clock minus local clock
  const clock = useCallback(() => Date.now() + offset.current, [])
  const [stage, setStage] = useState<Stage>(null)
  /** what this browser has paid into the round on show, and how many times */
  const [paid, setPaid] = useState({ round: -1, amount: 0, count: 0 })
  const [result, setResult] = useState<{ round: number; outcome: Outcome } | null>(null)
  const [fair, setFair] = useState<number | null>(null)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const [drops, setDrops] = useState<{ id: number; colour: string; n: number; to: number }[]>([])
  const [party, setParty] = useState(0)
  const [, setTick] = useState(0)
  const whoRef = useRef(who)
  whoRef.current = who
  const nameRef = useRef({ name, avatar })
  nameRef.current = { name, avatar }
  const rot = useMotionValue(0)
  const countRef = useRef<HTMLSpanElement>(null)
  const trackRef = useRef<SVGCircleElement>(null)
  const pointerRef = useRef<SVGGElement>(null)
  const [boxRef, box] = useSize<HTMLDivElement>({ w: 640, h: 640 })

  // the feed's "seconds ago" moves on
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const syncPaid = (s: PotServer, id: number) => setPaid({ round: id, amount: paidOf(whoRef.current, s.book, id), count: countOf(whoRef.current, s.book, id) })

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
      if (phaseAt(r, est) === 'next') return 350
      // betting has closed but this answer came from just before: the ticket is due now
      if (r.phase === 'betting' && est >= r.startsAt - CLOSE_MS) return 90
      const busy = openRounds(whoRef.current, server.book).length > 0
      const base = document.hidden && !busy ? 5000 : r.phase === 'betting' ? 800 : 1700
      // be there when betting closes (the ticket), at the landing (the seed) and when the next round opens
      const next = [r.startsAt - CLOSE_MS + 40, r.endsAt + 80, r.endsAt + SHOW_MS + 60].find((m) => m > est + 30)
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
        syncPaid(server, f.round.id)
        ok = true
        lastOk = Date.now()
        if (server.online) setConn('live')
        void settleDue()
      } catch {
        // keep showing the last state and try again
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
      pushToast({ kind: 'info', title: 'The shared pot is still unavailable.' })
    }
  }

  /* ---------------- settling ---------------- */

  const announced = useRef(new Set<string>())
  const announce = (s: Settlement) => {
    const o = s.outcome
    const key = `${s.book}:${s.round}`
    const first = !announced.current.has(key)
    announced.current.add(key)
    if (s.live) setResult({ round: s.round, outcome: o })
    if (!s.paid || !first) return
    if (s.live) {
      if (o.refund > 0) pushToast({ kind: 'info', title: `${fmt(o.refund)} of your coins never reached the pot, so it came back.` })
    } else {
      const t = awayToast(s)
      if (t) pushToast(t)
    }
  }

  /** Settles every round this browser has paid into whose result the feed can tell. Safe to call any time. */
  const settling = useRef(false)
  const settleDue = async () => {
    const s = serverRef.current
    const f = feedRef.current
    if (settling.current || !s || !f) return
    settling.current = true
    try {
      for (const x of await settleFrom(whoRef.current, s.book, f, clock(), true)) announce(x)
      // payments from an offline session settle from the stand-in, whose rounds follow the clock
      if (s.book === 'shared' && openRounds(whoRef.current, 'local').length) for (const x of await settleLocal(whoRef.current)) announce(x)
    } catch {
      /* the next poll tries again */
    } finally {
      settling.current = false
    }
  }

  /* ---------------- paying in ---------------- */

  const amountRef = useRef(amount)
  amountRef.current = amount
  const mineSkip = useRef(0)
  const dropId = useRef(0)
  const drop = (colour: string, amt: number, to: number) => {
    const id = ++dropId.current
    const n = amt >= 2500 ? 8 : amt >= 500 ? 6 : amt >= 50 ? 4 : 3
    setDrops((d) => [...d.slice(-8), { id, colour, n, to }])
    window.setTimeout(() => setDrops((d) => d.filter((x) => x.id !== id)), 1400)
  }

  /** your coins in the round on show as the server and this browser see them: [amount, payments] */
  const mineNow = (f: Feed, s: PotServer): [number, number] => [Math.max(paidOf(whoRef.current, s.book, f.round.id), f.mine?.amount ?? 0), Math.max(countOf(whoRef.current, s.book, f.round.id), f.mine?.count ?? 0)]

  const payIn = async () => {
    const s = serverRef.current
    const f = feedRef.current
    if (!s || !f) return
    const id = f.round.id
    if (f.round.phase !== 'betting' || clock() >= f.round.startsAt - CLIENT_CLOSE_MS) {
      potSfx.refused()
      return
    }
    const amt = round2(amountRef.current)
    const [have, count] = mineNow(f, s)
    const why = refuse(count ? [{ who: 'me', name, avatar, amount: have }, ...Array.from({ length: count - 1 }, () => ({ who: 'me', name, avatar, amount: 0 }))] : [], 'me', amt)
    if (why) {
      potSfx.refused()
      pushToast({ kind: 'info', title: why })
      return
    }
    if (!stake(amt)) return
    const me = whoRef.current
    addPayment(me, s.book, id, f.round.hash, amt)
    syncPaid(s, id)
    mineSkip.current++
    potSfx.pay()
    drop('#22d36f', amt, pileTop(potOf(asDeposits(f.deposits)) + have + amt))
    setSay(`You paid ${fmt(amt)} into the pot.`)
    try {
      const r = await s.pay(id, amt, nameRef.current.name, nameRef.current.avatar)
      if (!r.ok) {
        const back = await refundPayment(me, s.book, id, amt)
        mineSkip.current = Math.max(0, mineSkip.current - 1)
        potSfx.refused()
        const tail = back > 0 ? ` Your ${fmt(back)} came back.` : ''
        pushToast({
          kind: 'info',
          title:
            r.error === 'closed'
              ? `Too late, betting had closed.${tail}`
              : r.error === 'count'
                ? `At most ${MAX_DEPOSITS} payments a round.${tail}`
                : r.error === 'limit'
                  ? `At most ${fmt(MAX_PER_PLAYER, 0)} a round.${tail}`
                  : `That payment was refused.${tail}`,
        })
      }
    } catch {
      pushToast({ kind: 'info', title: 'Connection trouble. If that payment missed the pot, it comes back when the round ends.' })
    } finally {
      if (feedRef.current?.round.id === id) syncPaid(s, id)
      poll.current()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey || fair != null || info) return
      if (e.key.toLowerCase() !== 'p') return
      e.preventDefault()
      void payIn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- coins dropping in ---------------- */

  const seen = useRef({ round: -1, n: 0 })
  useEffect(() => {
    if (!feed) return
    const r = feed.round.id
    const n = feed.deposits.length
    const s = seen.current
    if (s.round !== r) {
      // a round first seen with coins already in: they are just there
      seen.current = { round: r, n }
      return
    }
    if (n <= s.n) return
    const all = asDeposits(feed.deposits)
    let pot = potOf(all.slice(0, s.n))
    for (const d of feed.deposits.slice(s.n)) {
      pot += d.amount
      if (d.me && mineSkip.current > 0) {
        mineSkip.current--
        continue
      }
      if (!document.hidden) {
        drop(colourOf(d.p, d.me), d.amount, pileTop(pot))
        potSfx.clink(Math.min(1, Math.log10(Math.max(1, d.amount)) / 3.7))
      }
      setSay(`${d.me ? 'You' : d.name} added ${fmt(d.amount)}.`)
    }
    seen.current = { round: r, n }
  }, [feed])

  /* ---------------- the clock: stages, countdown, the wheel, sounds ---------------- */

  useEffect(() => {
    let raf = 0
    let last = ''
    let lastCount = -1
    let spun = -1
    let landed = -1
    let lastAngle = 0
    let lastT = performance.now()
    const frame = () => {
      const f = feedRef.current
      if (f) {
        const est = clock()
        const r = f.round
        const ph = phaseAt(r, est)
        const st: Stage = ph === 'betting' ? (est >= r.startsAt - CLIENT_CLOSE_MS ? 'shut' : 'betting') : ph === 'spinning' && est < r.startsAt ? 'shut' : ph
        const key = `${r.id}:${st}`
        const audible = !document.hidden
        if (key !== last) {
          const prev = last
          last = key
          setStage(st)
          if (prev === `${r.id}:betting` && st === 'shut') {
            if (audible) potSfx.close()
            setSay('Betting closed. The draw is about to start.')
          }
          if (st === 'betting' && prev && !prev.startsWith(`${r.id}:`)) {
            if (audible) potSfx.open()
            setSay(`Round ${r.id} is open. Pay in to join the pot.`)
          }
        }
        if (st === 'betting') {
          const left = Math.max(0, r.startsAt - CLIENT_CLOSE_MS - est)
          if (countRef.current) countRef.current.textContent = (left / 1000).toFixed(1)
          if (trackRef.current) {
            trackRef.current.style.strokeDashoffset = String(TRACK_LEN * (1 - Math.min(1, left / (BET_MS - CLIENT_CLOSE_MS))))
            trackRef.current.style.stroke = left > 10_000 ? '#22d36f' : left > 5_000 ? '#f7c548' : '#ff8a3d'
          }
          const s = Math.ceil(left / 1000)
          if (s >= 1 && s <= 3 && s !== lastCount) {
            lastCount = s
            if (audible) potSfx.count(s)
          }
        } else if (trackRef.current) {
          trackRef.current.style.strokeDashoffset = '0'
          trackRef.current.style.stroke = ''
        }
        // the wheel: its angle from the clock, a tick for every sliver of 15 degrees that passes the pointer
        const ds = f.deposits
        const tickets = ds.reduce((a, d) => a + ticketsOf(d.amount), 0)
        const angle = spinAt(r, r.ticket, tickets, est)
        rot.set(angle)
        const now = performance.now()
        if (angle > lastAngle && st === 'spinning') {
          const speed = Math.min(1, (angle - lastAngle) / Math.max(1, now - lastT) / 1.15)
          if (Math.floor(angle / 15) !== Math.floor(lastAngle / 15)) {
            if (audible) potSfx.tick(speed)
            // the pointer is knocked back by the sliver and springs home
            const el = pointerRef.current
            if (el) {
              el.style.transition = 'none'
              el.style.transform = `rotate(${(-6 - 10 * (1 - speed)).toFixed(1)}deg)`
              requestAnimationFrame(() => {
                el.style.transition = 'transform .16s cubic-bezier(.3,1.6,.5,1)'
                el.style.transform = 'rotate(0deg)'
              })
            }
          }
        }
        lastAngle = angle
        lastT = now
        if (r.ticket != null && est >= r.startsAt && est < r.startsAt + 1500 && spun !== r.id) {
          spun = r.id
          if (audible) potSfx.spin()
          setSay('Drawing the winning ticket.')
        }
        if (r.ticket != null && est >= r.endsAt && landed !== r.id) {
          landed = r.id
          const i = holderOf(ds, r.ticket)
          const w = ds[i]
          const fresh = est < r.endsAt + 1500
          if (w) {
            const amt = ds.filter((d) => d.p === w.p).reduce((a, d) => a + ticketsOf(d.amount), 0) / 100
            const pot = tickets / 100
            const inPot = ds.some((d) => d.me)
            if (fresh && audible) {
              potSfx.land()
              window.setTimeout(() => (w.me ? potSfx.win(winnings(pot) >= amt * 4) : inPot ? potSfx.lose() : potSfx.other()), 260)
            }
            if (w.me && fresh) setParty((n) => n + 1)
            setSay(w.me ? `You won the pot: ${fmt(winnings(pot))} with a ${pct(amt / pot)} chance.` : `${w.name} won the pot of ${fmt(pot)} with a ${pct(amt / pot)} chance.`)
          }
          void settleDue()
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- view ---------------- */

  const round = feed?.round ?? null
  const rid = round?.id ?? -1
  const open = !!round && stage === 'betting' && round.phase === 'betting'
  const betting = stage === 'betting' || stage === 'shut'
  const landed = (stage === 'done' || stage === 'next') && round?.ticket != null
  // your coins this browser has sent that the server hasn't shown yet, at the end of the line while betting
  const view: Dep[] = useMemo(() => {
    const ds = feed?.deposits ?? []
    if (!feed || paid.round !== feed.round.id || !betting) return ds
    const held = feed.mine?.amount ?? 0
    const extra = round2(paid.amount - held)
    if (extra <= 0) return ds
    const mineP = ds.find((d) => d.me)?.p ?? ds.reduce((a, d) => Math.max(a, d.p), 0) + 1
    return [...ds, { p: mineP, name, avatar, amount: extra, bot: false, me: true, at: Number.MAX_SAFE_INTEGER, pending: true } as Dep & { pending: boolean }]
  }, [feed, paid, betting, name, avatar])
  const ds = useMemo(() => asDeposits(view), [view])
  const pot = potOf(ds)
  const holder = landed ? holderOf(view, round!.ticket) : -1
  const winDep = holder >= 0 ? view[holder] : null
  const winKey = winDep ? `${rid}:${winDep.me ? 'me' : `p${winDep.p}`}` : null

  const slivers: Sliver[] = useMemo(
    () => view.map((d, i) => ({ key: `${rid}:${i}`, colour: colourOf(d.p, d.me), amount: d.amount, avatar: d.avatar, who: d.me ? 'me' : `p${d.p}`, pending: (d as Dep & { pending?: boolean }).pending })),
    [view, rid],
  )
  const rows: PlayerRow[] = useMemo(
    () =>
      shares(ds).map((s) => {
        const p = s.who === 'me' ? (view.find((d) => d.me)?.p ?? 0) : Number(s.who.slice(1))
        const acct = view.some((d) => d.acct && (s.who === 'me' ? d.me : !d.me && d.p === p))
        return { key: `${rid}:${s.who}`, name: s.name, avatar: s.avatar, bot: s.bot, me: s.who === 'me', acct, amount: s.amount, share: s.share, colour: colourOf(p, s.who === 'me') }
      }),
    [ds, view, rid],
  )
  const lines: FeedLine[] = useMemo(
    () =>
      view
        .map((d, i) => ({ key: `${rid}:${i}`, name: d.name, avatar: d.avatar, amount: d.amount, me: d.me, bot: d.bot, acct: d.acct, colour: colourOf(d.p, d.me), at: d.at === Number.MAX_SAFE_INTEGER ? Date.now() + offset.current : d.at }))
        .slice(-7)
        .reverse(),
    [view, rid],
  )
  const myRow = rows.find((r) => r.me)
  const [have, count] = feed && server && paid.round === feed.round.id ? [Math.max(paid.amount, feed.mine?.amount ?? 0), Math.max(paid.count, feed.mine?.count ?? 0)] : [0, 0]
  const myResult = result && result.round === rid ? result.outcome : null
  const room = Math.max(0, Math.min(MAX_DEPOSIT, MAX_PER_PLAYER - have, balance))
  const full = count >= MAX_DEPOSITS || have >= MAX_PER_PLAYER
  const tickets = view.reduce((a, d) => a + ticketsOf(d.amount), 0)
  const recent = useMemo(() => hist.slice(0, 20), [hist])
  const winAmount = winDep ? view.filter((d) => d.p === winDep.p && d.me === winDep.me).reduce((a, d) => a + ticketsOf(d.amount), 0) / 100 : 0

  // the wheel fits its column
  const wheelSize = wide ? Math.max(300, Math.min(box.w, box.h) - 8) : Math.min(box.w, 520)

  const centre = (
    <>
      <AnimatePresence>
        {!landed && (
          <motion.div
            key={`pot${rid}`}
            className="pointer-events-none absolute inset-x-0 flex justify-center"
            style={{ top: '59.5%' }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            <div className="flex flex-col items-center rounded-2xl bg-[#05101a]/85 px-4 pb-1.5 pt-1 ring-1 ring-gold/30 shadow-[0_10px_30px_-10px_rgba(0,0,0,.8)]" style={{ minWidth: wheelSize * 0.3 }}>
              <span className="font-black uppercase tracking-[.24em] text-gold/80" style={{ fontSize: Math.max(9, wheelSize * 0.018) }}>
                Pot
              </span>
              <span className="tnum flex items-center gap-1.5 font-black leading-none text-white" style={{ fontSize: Math.max(18, wheelSize * 0.05) }}>
                <AnimatedNumber key={rid} value={pot} /> <Coin size={Math.max(14, wheelSize * 0.034)} />
              </span>
              <span className="mt-1.5 flex w-full justify-center border-t border-white/10 pt-1 whitespace-nowrap" style={{ fontSize: Math.max(10, wheelSize * 0.021) }}>
                {stage === 'betting' ? (
                  <span className="flex items-baseline gap-1.5">
                    <span className="font-bold uppercase tracking-[.16em] text-white/50">Draw in</span>
                    <span className="tnum font-black text-white">
                      <span ref={countRef}>{(BET_MS / 1000).toFixed(1)}</span>s
                    </span>
                  </span>
                ) : stage === 'shut' ? (
                  <span className="flex items-center gap-1.5 font-black uppercase tracking-[.16em] text-gold">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" /> No more coins
                  </span>
                ) : stage === 'spinning' ? (
                  <span className="font-black uppercase tracking-[.16em] text-gold">Drawing…</span>
                ) : (
                  <span className="font-bold uppercase tracking-[.16em] text-white/50">{round ? 'Next round' : 'Connecting…'}</span>
                )}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {landed && winDep && (
          <motion.div
            key={`win${rid}`}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
          >
            <div
              className={`flex flex-col items-center rounded-3xl px-6 pb-4 pt-3 text-center ring-2 ${winDep.me ? 'bg-[#062615]/95 ring-accent shadow-[0_0_60px_-6px_rgba(34,211,111,.7)]' : 'bg-[#0a1520]/95 ring-gold/70 shadow-[0_0_50px_-10px_rgba(247,197,72,.6)]'}`}
              style={{ width: wheelSize * 0.42, minWidth: 176 }}
            >
              <span className="relative mt-1">
                <motion.span className="block" initial={{ rotate: -14, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 14, delay: 0.1 }}>
                  <Avatar index={winDep.avatar} size={Math.max(46, wheelSize * 0.1)} ring={colourOf(winDep.p, winDep.me)} />
                </motion.span>
                <motion.span className="absolute -right-3 -top-4" initial={{ y: -14, opacity: 0, rotate: -30 }} animate={{ y: 0, opacity: 1, rotate: 14 }} transition={{ delay: 0.28, type: 'spring', stiffness: 400, damping: 12 }}>
                  <Crown size={Math.max(22, wheelSize * 0.045)} />
                </motion.span>
              </span>
              <span className={`mt-1.5 flex max-w-full items-center gap-1.5 font-black ${winDep.me ? 'text-accent' : 'text-white'}`} style={{ fontSize: Math.max(14, wheelSize * 0.032) }}>
                <PlayerName name={winDep.name} acct={winDep.acct} className="pointer-events-auto truncate">
                  {winDep.me ? 'You won!' : winDep.name}
                </PlayerName>
                {winDep.bot && <BotTag />}
              </span>
              <span className="tnum flex items-center gap-1 font-black leading-tight text-gold" style={{ fontSize: Math.max(20, wheelSize * 0.052), textShadow: '0 0 22px rgba(247,197,72,.45)' }}>
                {winDep.me ? '+' : ''}
                {fmt(winnings(potOf(asDeposits(view))))} <Coin size={Math.max(16, wheelSize * 0.036)} />
              </span>
              <span className="tnum font-bold text-white/55" style={{ fontSize: Math.max(10, wheelSize * 0.02) }}>
                {pct(pot ? winAmount / pot : 0)} chance
              </span>
              {round?.ticket != null && (
                <span className="tnum mt-1.5 w-full border-t border-white/10 pt-1.5 font-semibold text-white/45" style={{ fontSize: Math.max(10, wheelSize * 0.019) }}>
                  Ticket <span className="font-black text-white/85">#{(round.ticket + 1).toLocaleString('en-US')}</span> of {tickets.toLocaleString('en-US')}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )

  const overlay = (
    <>
      {drops.map((d) => (
        <CoinDrop key={d.id} colour={d.colour} n={d.n} to={d.to} />
      ))}
      <AnimatePresence>{party > 0 && landed && winDep?.me && <Confetti key={`c${rid}`} seed={rid} spread={wheelSize * 0.55} colours={['#22d36f', '#f7c548', '#4cb4ff', '#ff5fa2', '#ffffff', '#9b7bff']} />}</AnimatePresence>
    </>
  )

  const wheel = (
    <div style={{ width: wheelSize }} className="relative mx-auto">
      <PotWheel slivers={slivers} pot={pot} rot={rot} stage={stage} winner={winDep ? colourOf(winDep.p, winDep.me) : null} winnerWho={winDep ? (winDep.me ? 'me' : `p${winDep.p}`) : null} trackRef={trackRef} pointerRef={pointerRef} centre={centre} overlay={overlay} />
    </div>
  )

  const players = <Players rows={rows} pot={pot} round={rid} winner={winKey} open={open} className={wide ? 'min-h-[200px] flex-[1.15]' : 'max-h-[420px]'} />
  const live = <LiveFeed lines={lines} now={clock()} className={wide ? 'min-h-[180px] flex-1' : ''} />

  const topBar = (
    <div className="relative flex min-h-[34px] items-center gap-2">
      <Winners items={recent} onPick={setFair} compact={!wide} />
      {round && (
        <button onClick={() => setFair(round.id)} className="tnum flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-2 text-[12px] font-bold text-dim transition hover:bg-white/5 hover:text-ink" title="Check this round is fair" aria-label={`Check round ${round.id} is fair`}>
          <ShieldIcon />#{round.id}
        </button>
      )}
      <button onClick={() => setInfo(true)} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-black/35 px-3 text-[12px] font-extrabold text-ink ring-1 ring-white/10 transition hover:bg-black/50" aria-label="How Pot Luck works">
        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[10px] font-black text-panel">?</span>
        {wide && 'How it works'}
      </button>
    </div>
  )

  const stageEl = (
    <div className="relative flex flex-col gap-3 overflow-hidden p-3 sm:p-4 lg:absolute lg:inset-0">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_55%_50%_at_38%_48%,rgba(247,197,72,.10),transparent_70%),radial-gradient(ellipse_60%_40%_at_50%_0%,rgba(155,123,255,.08),transparent_70%)]" />
      {topBar}
      {wide ? (
        <div className="relative flex min-h-0 flex-1 gap-5">
          <div ref={boxRef} className="flex min-h-0 min-w-0 flex-1 items-center justify-center">
            {wheel}
          </div>
          <div className="flex w-[272px] shrink-0 flex-col gap-3 2xl:w-[320px]">
            {players}
            {live}
          </div>
        </div>
      ) : (
        <div ref={boxRef} className="relative w-full px-1 pb-1 pt-2">
          {wheel}
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {say}
      </div>
    </div>
  )

  const payLabel = !round ? 'Connecting…' : open ? (full ? 'Round limit reached' : `Pay in ${fmt(amount)}`) : stage === 'shut' || stage === 'spinning' ? 'Drawing…' : 'Next round soon'
  const panel = (
    <>
      <div className="max-lg:order-4">
        <ChanceCard share={myRow?.share ?? 0} mine={myRow?.amount ?? 0} pot={pot} count={count} result={myResult} open={open} />
      </div>
      <div className="max-lg:order-2">
        <BetInput value={amount} onChange={(v) => setAmount(Math.min(MAX_DEPOSIT, v))} />
      </div>
      <div className="max-lg:order-3">
        <QuickAmounts value={amount} max={Math.max(1, room)} onPick={setAmount} />
      </div>
      <div className="max-lg:order-1">
        <ActionButton onClick={payIn} disabled={!open || full} sub={open && !full ? (count ? `${count} of ${MAX_DEPOSITS} payments made` : wide ? 'Press P to pay in' : 'Every coin is a ticket') : undefined}>
          {payLabel}
        </ActionButton>
      </div>
      <div className="max-lg:order-5">
      <StatusCard
        conn={conn}
        online={feed?.online ?? 0}
        bots={feed?.bots ?? 0}
        name={name}
        editable={!profile}
        onName={(n) => (setGuestName(n), saveName(n))}
        onFair={() => round && setFair(round.id)}
        onRetry={retryShared}
        busy={have > 0 || openRounds(who, server?.book ?? 'shared').length > 0}
      />
      </div>
    </>
  )

  return (
    <>
      <style>{CSS}</style>
      <GameShell panel={panel} stage={stageEl} stageClass="max-lg:h-auto max-lg:min-h-0" footer={wide ? undefined : <div className="flex flex-col gap-3">{players}{live}</div>} />
      <AnimatePresence>
        {fair != null && server && feed && <FairnessModal server={server} feed={feed} history={hist} id={fair} landed={landed} onPick={setFair} onClose={() => setFair(null)} />}
        {info && <InfoModal onClose={() => setInfo(false)} />}
      </AnimatePresence>
    </>
  )
}

