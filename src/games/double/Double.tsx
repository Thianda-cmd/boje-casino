import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { BetInput, GameShell } from '../../components/ui'
import { fmt, round2 } from '../../lib/format'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { MAX_BET, useWallet } from '../../store/wallet'
import { ColorButtons, Columns, FairnessModal, HistoryRow, Last100, QuickAmounts, StatusBar, StatusCard, YourBets, type ColumnView, type Conn } from './bits'
import { addStake, ageOf, hashOf, loseRound, openRounds, pruneSettled, refundChip, settleRound, stakeOf, type Book } from './ledger'
import { KEEP_MS, connect, defaultName, guestAvatar, localStandIn, saveName, tryShared, type DoubleServer, type Feed } from './net'
import { BET_MS, CLOSE_MS, COLORS, LABEL, MAX_STAKE, SHOW_MS, colorOf, noStakes, phaseAt, restAt, spinTarget, type Color, type Outcome, type Stakes } from './rules'
import { Strip, type Spin } from './Strip'

/*
  Double: one strip of red, black and green tiles, spun for everyone at once. Bets open for 15 s; then the strip spins
  for 6 s and lands on the roll, and the winners glow for 3 s before the next round. Red and black pay 2×, green 32×,
  and a player may back several colours and add to a bet until betting closes. Rounds come from the shared database
  when it is reachable and from a stand-in with house bots otherwise; every round is provably fair (its hash is shown
  before betting and its seed once the strip lands). Chips leave the wallet when they are sent and wait in the ledger
  (ledger.ts) until the round settles, once, wherever the page was when it landed.
*/

/** betting closes on the client a little before the server's close, so a chip sent at the last moment still lands */
const CLIENT_CLOSE_MS = CLOSE_MS + 220

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

export default function Double() {
  const pushToast = useWallet((s) => s.pushToast)
  const balance = useWallet((s) => s.balance)
  const uid = useAuth((s) => s.uid)
  const profile = useAuth((s) => s.profile)
  const who = uid ?? 'guest'
  const [guestName, setGuestName] = useState(defaultName)
  const name = profile?.username ?? guestName
  const avatar = profile?.avatar ?? guestAvatar()
  const wide = useWide()
  const [stageRef, stageSize] = useSize<HTMLDivElement>({ w: 900, h: 700 })
  // narrow columns (a phone, or a small desktop window) stack each bettor's name over the amount
  const compact = !wide || stageSize.w < 590

  const [amount, setAmount] = useState(10)
  const [server, setServer] = useState<DoubleServer | null>(null)
  const serverRef = useRef<DoubleServer | null>(null)
  serverRef.current = server
  const [conn, setConn] = useState<Conn>('connecting')
  const [feed, setFeed] = useState<Feed | null>(null)
  const feedRef = useRef<Feed | null>(null)
  const [hist, setHist] = useState<{ id: number; roll: number }[]>([])
  const histRef = useRef(hist)
  const offset = useRef(0) // server clock minus local clock
  const clock = useCallback(() => Date.now() + offset.current, [])
  const [phase, setPhase] = useState<'betting' | 'spinning' | 'done' | 'next' | null>(null)
  /** betting, but past this page's close: chips are no longer sent */
  const [shut, setShut] = useState(false)
  const [mine, setMine] = useState<Stakes>(noStakes)
  const [result, setResult] = useState<{ round: number; outcome: Outcome } | null>(null)
  const [fair, setFair] = useState<number | null>(null)
  const whoRef = useRef(who)
  whoRef.current = who
  const nameRef = useRef({ name, avatar })
  nameRef.current = { name, avatar }

  const countRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)

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
    // one request at a time: a poll asked for while one is out (a bet, the tab coming back) runs as soon as it
    // answers, so two timer chains never start and an older answer never lands after a newer one
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
      // betting has closed but this answer came from just before: the roll is due now
      if (r.phase === 'betting' && est >= r.startsAt - CLOSE_MS) return 90
      const busy = openRounds(whoRef.current, server.book).length > 0
      const base = document.hidden && !busy ? 5000 : r.phase === 'betting' ? 1000 : 1700
      // be there when betting closes (the roll), after the spin starts (the final bets), at the landing (the seed)
      // and when the next round opens
      const next = [r.startsAt - CLOSE_MS + 40, r.startsAt + 1200, r.endsAt + 80, r.endsAt + SHOW_MS + 60].find((m) => m > est + 30)
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
        // each sample is right to within half its round trip; one that can't agree with the best means a clock
        // jumped (the device's time was changed, or it woke from sleep), so the old samples are dropped
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
        setMine(stakeOf(whoRef.current, server.book, f.round.id))
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
      pushToast({ kind: 'info', title: 'The shared rounds are still unavailable.' })
    }
  }

  /* ---------------- settling ---------------- */

  const announced = useRef(new Set<string>())
  const announce = (book: Book, id: number, res: { outcome: Outcome; paid: boolean }, live: boolean) => {
    const o = res.outcome
    const key = `${book}:${id}`
    const first = !announced.current.has(key)
    announced.current.add(key)
    if (live) setResult({ round: id, outcome: o })
    if (!res.paid || !first) return
    const audible = !document.hidden
    if (live) {
      if (o.bet > 0 && audible) (o.payout > 0 ? () => sfx.double.win(o.green) : sfx.double.lose)()
      if (o.refund > 0) pushToast({ kind: 'info', title: `${fmt(o.refund)} of your bet never reached the table, so it came back.` })
    } else if (o.bet > 0) {
      const what = o.payout > o.bet ? `won ${fmt(o.payout)}` : o.payout === o.bet ? `your ${fmt(o.bet)} back` : o.payout > 0 ? `${fmt(o.payout)} of ${fmt(o.bet)} back` : `lost ${fmt(o.bet)}`
      pushToast({ kind: o.payout > o.bet ? 'win' : o.payout > 0 ? 'info' : 'loss', title: `Double round #${id} settled while you were away: ${what}` })
    } else if (o.refund > 0) pushToast({ kind: 'info', title: `Your bet on Double round #${id} never reached the table, so ${fmt(o.refund)} came back.` })
  }

  /** Settles every round this browser has paid into whose result the feed can tell. Safe to call any time. */
  const settling = useRef(false)
  const settleFrom = async (book: Book, f: Feed, est: number, live: boolean) => {
    const me = whoRef.current
    for (const id of openRounds(me, book)) {
      let res: { outcome: Outcome; paid: boolean } | null = null
      if (id === f.round.id) {
        // the bets are final once the spin has started; pay when the strip lands
        if (f.round.roll == null || est < f.round.endsAt || f.now < f.round.startsAt) continue
        const h = hashOf(me, book, id)
        res = await settleRound(me, book, id, f.round.roll, h && h !== f.round.hash ? null : f.mine)
        if (res) announce(book, id, res, live)
      } else if (id < f.round.id) {
        const p = f.past.find((x) => x.round === id)
        if (p) res = await settleRound(me, book, id, p.roll, p)
        // so old the round may have been cleared away: there is no telling what happened
        else if (Date.now() - ageOf(me, book, id) > KEEP_MS[book]) await loseRound(me, book, id)
        // asked about, landed, and holding nothing of mine: none of it reached the table (a round this request
        // didn't ask about is asked about on the next one)
        else if (f.asked.includes(id)) res = await settleRound(me, book, id, 0, null)
        if (res) announce(book, id, res, false)
      } else if (Date.now() - ageOf(me, book, id) > 10 * 60_000) {
        // a round ahead of the server's: the database was reset, so it can never land
        res = await settleRound(me, book, id, 0, null)
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
      // stakes from an offline session settle from the stand-in, whose rounds follow the clock
      if (s.book === 'shared' && openRounds(whoRef.current, 'local').length) {
        const lf = await localStandIn().state(null, openRounds(whoRef.current, 'local'))
        await settleFrom('local', lf, lf.now, false)
      }
    } finally {
      settling.current = false
    }
  }

  /* ---------------- betting ---------------- */

  const amountRef = useRef(amount)
  amountRef.current = amount
  const placeBet = async (color: Color) => {
    const s = serverRef.current
    const f = feedRef.current
    if (!s || !f) return
    const id = f.round.id
    if (f.round.phase !== 'betting' || clock() >= f.round.startsAt - CLIENT_CLOSE_MS) {
      sfx.double.refused()
      return
    }
    const amt = round2(amountRef.current)
    const me = whoRef.current
    const had = stakeOf(me, s.book, id)
    if (had[color] + amt > MAX_STAKE + 1e-9) {
      pushToast({ kind: 'info', title: `You can have at most ${fmt(MAX_STAKE, 0)} on ${LABEL[color]} in a round.` })
      return
    }
    const w = useWallet.getState()
    if (!w.placeBet(amt)) {
      pushToast({ kind: 'info', title: 'Not enough coins. Visit Rewards to earn more.' })
      return
    }
    addStake(me, s.book, id, f.round.hash, color, amt)
    sfx.double.chip(COLORS.indexOf(color))
    setMine(stakeOf(me, s.book, id))
    try {
      const r = await s.bet(id, color, amt, nameRef.current.name, nameRef.current.avatar)
      if (!r.ok) {
        const back = await refundChip(me, s.book, id, color, amt)
        sfx.double.refused()
        pushToast({
          kind: 'info',
          title:
            r.error === 'closed'
              ? `Too late, betting had closed. Your ${fmt(back)} came back.`
              : r.error === 'limit'
                ? `That would take ${LABEL[color]} over ${fmt(MAX_STAKE, 0)}. Your ${fmt(back)} came back.`
                : `That bet was refused. Your ${fmt(back)} came back.`,
        })
      }
    } catch {
      pushToast({ kind: 'info', title: 'Connection trouble. If that bet missed the table, it comes back when the round ends.' })
    } finally {
      if (feedRef.current?.round.id === id) setMine(stakeOf(me, s.book, id))
      poll.current()
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      // a held key repeats: one chip per press
      if (e.repeat || tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey || fair != null) return
      const c = ({ r: 'red', g: 'green', b: 'black' } as Record<string, Color>)[e.key.toLowerCase()]
      if (!c) return
      e.preventDefault()
      void placeBet(c)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- the clock: phases, countdown, sounds, landing ---------------- */

  useEffect(() => {
    let raf = 0
    let last = ''
    let lastCount = -1
    let spun = -1
    let landedAt = -1
    const frame = () => {
      const f = feedRef.current
      if (f) {
        const est = clock()
        const r = f.round
        const ph = phaseAt(r, est)
        // this page stops taking chips a moment before the server does ('shut'), so the buttons go dark then
        const stage = ph === 'betting' ? (est >= r.startsAt - CLIENT_CLOSE_MS ? 'shut' : 'open') : ph
        const key = `${r.id}:${stage}`
        const audible = !document.hidden
        if (key !== last) {
          if (last === `${r.id}:open` && audible) sfx.double.close()
          last = key
          setPhase(ph)
          setShut(stage === 'shut')
        }
        if (ph === 'betting') {
          const left = Math.max(0, r.startsAt - est)
          if (countRef.current) countRef.current.textContent = (left / 1000).toFixed(1)
          if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, left / BET_MS).toFixed(4)})`
          const s = Math.ceil((left - CLIENT_CLOSE_MS) / 1000)
          if (s >= 1 && s <= 3 && s !== lastCount) {
            lastCount = s
            if (audible) sfx.double.count(s)
          }
        }
        // the push-off, also when a late roll sets the strip off a moment after the start (Strip.tsx)
        if (r.roll != null && est >= r.startsAt && est < r.startsAt + 1500 && spun !== r.id) {
          spun = r.id
          if (audible) sfx.double.spin()
        }
        if (r.roll != null && est >= r.endsAt && landedAt !== r.id) {
          landedAt = r.id
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
  const roll = round?.roll ?? null
  const landed = phase === 'done' && roll != null
  const winner = landed ? colorOf(roll!) : null
  const open = !!round && phase === 'betting' && !shut && round.phase === 'betting'
  const myResult = result && round && result.round === round.id ? result.outcome : null

  // where the strip rests (the last landed round) and this round's spin from there
  const prev = round ? hist.find((h) => h.id < round.id) : undefined
  const rest = useMemo(() => (hist[0] ? restAt(hist[0].id, hist[0].roll) : 0), [hist])
  const spin = useMemo<Spin | null>(() => {
    if (!round || roll == null) return null
    const from = prev ? restAt(prev.id, prev.roll) : 0
    return { id: round.id, roll, from, to: spinTarget(from, round.id, roll), startsAt: round.startsAt, endsAt: round.endsAt }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round?.id, roll, prev?.id, round?.startsAt])

  // the columns, with this browser's chips shown at once (before the server has answered)
  const view = useMemo(() => {
    const out = {} as Record<Color, ColumnView>
    for (const c of COLORS) {
      const col = feed?.colors[c] ?? { total: 0, players: 0, bets: [] }
      const held = feed?.mine?.[c] ?? 0
      const extra = Math.max(0, Math.round((mine[c] - held) * 100) / 100)
      let rows = col.bets
      let total = col.total
      let players = col.players
      if (extra > 0 || (held > 0 && !rows.some((b) => b.me))) {
        const amount = Math.max(mine[c], held)
        const others = rows.filter((b) => !b.me)
        rows = [...others, { name, avatar, amount, me: true }].sort((a, b) => b.amount - a.amount)
        total = round2(total + extra)
        if (held === 0 && extra > 0) players += 1
      }
      out[c] = { total, players, rows }
    }
    return out
  }, [feed, mine, name, avatar])

  const recent = useMemo(() => hist.slice(0, 18), [hist])
  const histSize = wide ? 30 : 24
  const busy = COLORS.some((c) => mine[c] > 0)
  const hint = !round ? 'Connecting…' : open ? (wide ? 'Press R, G or B to bet' : 'Tap a colour to bet') : phase === 'betting' ? 'Bets closed' : phase === 'spinning' ? 'Rolling…' : 'Next round soon'

  const panel = (
    <>
      <div className="max-lg:order-first">
        <ColorButtons open={open} mine={mine} onBet={placeBet} hint={hint} />
      </div>
      <BetInput value={amount} onChange={setAmount} />
      <QuickAmounts value={amount} max={Math.min(balance, MAX_BET)} onPick={setAmount} />
      <YourBets mine={mine} round={round?.id ?? null} landedColor={winner} result={myResult} />
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
    </>
  )

  const columns = <Columns view={view} open={open} winner={winner} onBet={placeBet} amount={amount} round={round?.id ?? 0} compact={compact} className={wide ? 'min-h-0 flex-1' : ''} />

  const stage = (
    <div ref={stageRef} className="relative flex flex-col gap-3 overflow-hidden p-3 sm:gap-4 sm:p-4 lg:absolute lg:inset-0 lg:p-5">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_45%_at_50%_0%,rgba(242,56,79,.13),transparent_70%),radial-gradient(ellipse_50%_40%_at_50%_100%,rgba(34,211,111,.06),transparent_70%)]" />
      <div className="relative flex min-h-[32px] items-center gap-3">
        <HistoryRow items={recent} size={histSize} onPick={setFair} />
        <Last100 items={hist} compact={compact} />
      </div>
      <div className="relative">
        <Strip spin={spin} rest={rest} betting={round && roll == null ? round.id : null} clock={clock} landed={landed} sound />
      </div>
      <div className="relative">
        <StatusBar phase={phase} shut={shut} roll={roll} round={round?.id ?? null} countRef={countRef} barRef={barRef} result={myResult} onFair={() => round && setFair(round.id)} />
      </div>
      {wide && <div className="relative flex min-h-0 flex-1 flex-col">{columns}</div>}
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-lg:h-auto max-lg:min-h-0" footer={wide ? undefined : columns} />
      <AnimatePresence>
        {fair != null && server && feed && <FairnessModal server={server} feed={feed} history={hist} id={fair} landed={landed} onPick={setFair} onClose={() => setFair(null)} />}
      </AnimatePresence>
    </>
  )
}
