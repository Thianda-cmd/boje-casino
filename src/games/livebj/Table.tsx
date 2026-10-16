import { useEffect, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ActionButton, BetInput, GameShell, useStake } from '../../components/ui'
import { Spinner } from '../../components/Loader'
import { fmt, round2 } from '../../lib/format'
import { defaultName, saveName } from '../../lib/identity'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { cardValue, Kbd } from '../blackjack/table'
import { addStake, keyOf, pending, readLast, refundAll, refundUpTo, settleRound, writeLast, type Src } from './ledger'
import { settleMissed, switching } from './settle'
import { HistoryModal, NameEditor, PastRounds, Reactions, SeatList, SoloNote, TableHeader } from './Panel'
import { Stage, WIN_POPUP_MS, type Optimistic, type Reaction } from './Stage'
import { STICKERS } from './stickers'
import { TIMING, type Act, type BjError, type HandView, type ReactionCode, type TableFeed, type TableServer } from './types'
import { useReveal, useTableFeed } from './useTable'
import { bestOutcome, momentOf, toCard, turnOf } from './view'

/* One table: the poll loop, your seat, bets and moves (shown at once, confirmed by the server), the
   wallet bookkeeping for every round you paid into, sounds and keyboard. */

type Req = { kind: 'sit' | 'leave' | 'bet' | Act; retrying?: boolean }

const ERRORS: Partial<Record<BjError, string>> = {
  taken: 'Someone just took that seat.',
  seat: 'That seat is not available.',
  'not-seated': 'You are not seated at this table.',
  'other-tab': 'This seat is being played in another tab.',
  leaving: 'You are leaving this table.',
  min: 'That bet is below the table minimum.',
  max: 'That bet is above the table maximum.',
  stale: 'The round moved on. Try again.',
  turn: 'Too late: your hand already stood.',
  rate: 'Slow down a little.',
  network: 'Connection problem. Try again.',
}
const say = (e: BjError) => ERRORS[e] ?? 'Something went wrong. Try again.'
const RESEND_MS = 3000 // between attempts at a bet whose answer was lost

export default function Table({
  server,
  table,
  autoSit,
  onAutoSit,
  connecting,
  onRetry,
}: {
  server: TableServer
  table: number
  /** sit at the lowest free seat as soon as the table loads (Sit or Quick seat in the lobby) */
  autoSit: boolean
  onAutoSit: () => void
  connecting: boolean
  onRetry: () => void
}) {
  const uid = useAuth((s) => s.uid)
  const username = useAuth((s) => s.profile?.username ?? null)
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const stake = useStake()
  const who = uid ?? 'guest'
  const src: Src = server.online ? 'shared' : 'local'
  const [guestName, setGuestName] = useState(defaultName)
  const name = username ?? guestName

  const { feed, feedRef, accept, clock, reconnecting, poll } = useTableFeed(server, table, () => {
    pushToast({ kind: 'info', title: "That table doesn't exist" })
    navigate('/game/livebj')
  })
  const [req, setReq] = useState<Req | null>(null)
  const reqRef = useRef<Req | null>(null)
  const begin = (r: Req) => {
    reqRef.current = r
    setReq(r)
  }
  const end = () => {
    reqRef.current = null
    setReq(null)
  }
  const [opt, setOpt] = useState<Optimistic | null>(null)
  const [queued, setQueued] = useState<number | null>(null)
  const [sent, setSent] = useState<Reaction[]>([])
  const [rateUntil, setRateUntil] = useState(0)
  const [hints, setHints] = useState(false)
  const [busyAt, setBusyAt] = useState<number | null>(null)
  const [history, setHistory] = useState<number | null>(null)
  const [stageRef, size] = useSize<HTMLDivElement>()
  const [bet, setBet] = useState(() => readLast(who)?.bet ?? 0)

  const r = feed?.round
  const takesBets = (x: TableFeed) => x.round.phase === 'waiting' || (x.round.phase === 'betting' && x.round.betEndsAt != null && clock.now() < x.round.betEndsAt - 300)
  const tick = useReveal(feed, clock.now, [opt?.until, rateUntil, r?.betEndsAt != null ? r.betEndsAt - 300 : null, r?.resultsAt != null ? r.resultsAt + WIN_POPUP_MS : null])
  const t = clock.now()

  /* ---------------- derived ---------------- */

  const here = feed?.mine?.table === table ? feed.mine : null
  const active = !!here?.active
  const myHands = feed?.hands.filter((h) => h.mine) ?? []
  const roundKey = r ? keyOf(server.book, r.id) : ''
  const staked = r ? pending(who, roundKey) : null
  const turn = feed ? turnOf(feed, t) : null
  const myTurn = !!turn?.ctl && !!r?.turn && t < r.turn.endsAt
  const otherTab = !!turn && turn.mine && !turn.ctl
  const betOpen = !!r && (r.phase === 'waiting' || (r.phase === 'betting' && r.betEndsAt != null && t < r.betEndsAt - 300))
  const canBet = active && !here!.leaving && betOpen && !myHands.length && !staked && !req
  // staked on this round, the round still takes bets, but no hand of mine: the bet's answer was lost
  const unconfirmed = active && !here!.leaving && betOpen && !myHands.length && staked?.table === table && !req
  const pairOk = (h: HandView) => h.cards.length === 2 && h.cards[0].c != null && h.cards[1].c != null && cardValue(toCard(h.cards[0].c, 0)) === cardValue(toCard(h.cards[1].c, 1))
  const canDouble = myTurn && !req && turn!.cards.length === 2 && !turn!.doubled && balance >= turn!.bet
  const canSplit = myTurn && !req && turn!.idx === 0 && pairOk(turn!) && !myHands.some((h) => h.idx === 1) && balance >= turn!.bet
  const finished = !!r?.resultsAt && t >= r.resultsAt
  // my hand is still being played (the bet button waits for the next round)
  const inRound = myHands.length > 0 && !finished
  // the stake can be changed whenever it isn't already on the table
  const editable = canBet || queued != null || !betOpen
  const results = finished && myHands.length > 0 && myHands.every((h) => h.payout != null)
  const summary = results ? { bet: round2(myHands.reduce((a, h) => a + h.bet, 0)), payout: round2(myHands.reduce((a, h) => a + (h.payout ?? 0), 0)) } : null
  const reactions = feed ? [...feed.reactions, ...sent.filter((x) => !feed.reactions.some((y) => y.id === x.id))] : sent

  // the stake starts at the last bet, or the table minimum
  useEffect(() => {
    if (feed && (bet < feed.table.min || bet > feed.table.max)) setBet(feed.table.min)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.table.min, feed?.table.max])

  /* ---------------- seat ---------------- */

  const sit = async (seat: number, as = name) => {
    if (reqRef.current) return
    begin({ kind: 'sit' })
    const res = await server.sit(table, seat, as)
    end()
    if (res.state) accept(res.state)
    if (!res.ok) {
      if (res.error === 'busy') setBusyAt(res.table ?? null)
      else pushToast({ kind: 'info', title: say(res.error) })
      poll()
    } else setBusyAt(null)
  }

  const firstFree = (f: TableFeed) => f.seats.findIndex((s, i) => !s && !f.hands.some((h) => h.seat === i + 1 && !h.mine)) + 1

  useEffect(() => {
    if (!autoSit || !feed) return
    onAutoSit()
    if (feed.mine?.table === table) return
    const seat = firstFree(feed)
    if (seat > 0) void sit(seat)
    else pushToast({ kind: 'info', title: 'This table is full. You can watch until a seat opens.' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSit, !!feed])

  const leaving = useRef(false)
  const leave = async () => {
    if (reqRef.current || !active) return
    begin({ kind: 'leave' })
    leaving.current = true
    const res = await server.leave(table)
    end()
    if (res.state) accept(res.state)
    if (res.ok) {
      setQueued(null)
      // waiting or betting: the bet is cancelled; everything staked on the round comes back
      if (res.cancelled != null && res.round != null) await refundAll(who, keyOf(server.book, res.round))
    } else pushToast({ kind: 'info', title: say(res.error) })
    poll()
  }

  // removed by the server (idle, or away too long) rather than by leaving. Not after signing in or out: until the seat
  // follows (bj_claim), the server answers for an identity that isn't seated
  const wasHere = useRef<string | null>(null)
  useEffect(() => {
    if (!feed) return
    if (wasHere.current === who && !feed.mine && !leaving.current && !switching(who)) pushToast({ kind: 'info', title: 'You were moved off the table' })
    wasHere.current = feed.mine?.table === table ? who : null
    if (wasHere.current) leaving.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.mine?.table])

  const rename = (n: string) => {
    setGuestName(n)
    saveName(n)
    if (here?.active) void sit(here.seat, n)
  }

  /* ---------------- bets ---------------- */

  const lastSend = useRef(0)
  const placeBet = async (amount = bet) => {
    const f = feedRef.current
    if (!f || reqRef.current || f.mine?.table !== table || !f.mine.active || f.mine.leaving || !server.book) return
    const now = clock.now()
    if (!takesBets(f) || f.hands.some((h) => h.mine)) return
    const a = round2(Math.min(f.table.max, Math.max(f.table.min, amount)))
    const round = f.round.id
    const key = keyOf(server.book, round)
    if (pending(who, key)) return
    // the stake leaves the wallet and enters the ledger in the same task, before anything is sent
    if (!stake(a)) return
    addStake(who, key, table, a, src)
    writeLast(who, table, a)
    setBet(a)
    setQueued(null)
    begin({ kind: 'bet' })
    setOpt({ kind: 'bet', seat: f.mine.seat, round, amount: a, until: (f.round.betEndsAt ?? now + TIMING.BET_MS) + 1000 })
    let res = await server.bet(table, round, a)
    // a bet that may have landed is safe to repeat: the server answers ok without a second hand
    for (let i = 0; i < 2 && !res.ok && res.error === 'network' && takesBets(feedRef.current ?? f); i++) {
      begin({ kind: 'bet', retrying: true })
      res = await server.bet(table, round, a)
    }
    end()
    lastSend.current = Date.now()
    if (res.state) accept(res.state)
    if (res.ok) return setOpt(null)
    if (res.error === 'network') {
      // the outcome is unknown: the chips stay faded, the bet goes again while the round takes bets (resendBet) and
      // later feeds settle or refund the stake
      pushToast({ kind: 'info', title: 'Connection problem. Your bet will be confirmed or refunded.' })
      return
    }
    setOpt(null)
    await refundUpTo(who, key, a)
    if (res.error === 'closed') joinNext(a)
    else if (res.error !== 'already') pushToast({ kind: 'info', title: say(res.error) })
  }

  const joinNext = (a: number) => {
    setQueued(a)
    pushToast({ kind: 'info', title: 'Bets just closed. Yours joins the next round.' })
  }

  // A bet whose answer was lost (or a reload right after Bet) while its round still takes bets goes again until it
  // lands; otherwise a quiet table would keep the stake and the Bet button until someone else starts a round.
  // Safe: a bet that already landed answers ok without a second hand.
  const resendBet = async () => {
    const f = feedRef.current
    if (!f || reqRef.current || f.mine?.table !== table || !f.mine.active || f.mine.leaving || !server.book) return
    if (!takesBets(f) || f.hands.some((h) => h.mine)) return
    const round = f.round.id
    const key = keyOf(server.book, round)
    const p = pending(who, key)
    if (!p || p.table !== table) return
    begin({ kind: 'bet', retrying: true })
    setOpt({ kind: 'bet', seat: f.mine.seat, round, amount: p.staked, until: (f.round.betEndsAt ?? clock.now() + TIMING.BET_MS) + 1000 })
    // one bet per round while bets are open (doubles and splits come later), so what is staked is the bet
    const res = await server.bet(table, round, p.staked)
    end()
    lastSend.current = Date.now()
    if (res.state) accept(res.state)
    if (res.ok) return setOpt(null)
    if (res.error === 'network') return
    setOpt(null)
    // closed: the round was dealt without it, so it can't land any more. Anything else (stale, already, ...) is left to
    // settlement, since an earlier attempt may have landed on a round this view hasn't caught up with
    if (res.error === 'closed' && (await refundUpTo(who, key, p.staked)) > 0) joinNext(p.staked)
    poll()
  }
  useEffect(() => {
    if (!unconfirmed) return
    const id = window.setTimeout(() => void resendBet(), Math.max(0, lastSend.current + RESEND_MS - Date.now()))
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unconfirmed, r?.id])

  // a queued bet goes in as soon as a new round takes bets
  useEffect(() => {
    if (queued != null && canBet) void placeBet(queued)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queued, canBet, r?.id])

  /* ---------------- moves ---------------- */

  const act = async (a: Act) => {
    const f = feedRef.current
    const now = clock.now()
    const h = f && turnOf(f, now)
    if (!f || !h || !h.ctl || reqRef.current || !f.round.turn || now >= f.round.turn.endsAt || !server.book) return
    if ((a === 'double' && !canDouble) || (a === 'split' && !canSplit)) return
    const key = keyOf(server.book, f.round.id)
    let extra = 0
    if (a === 'double' || a === 'split') {
      if (!stake(h.bet)) return
      addStake(who, key, table, h.bet, src)
      extra = h.bet
    } else sfx.click()
    begin({ kind: a })
    if (a !== 'stand') setOpt({ kind: a, seat: h.seat, hand: h.idx, n: h.cards.length, until: now + 8000 })
    let res = await server.act(table, f.round.id, h.idx, h.cards.length, a)
    // the card count makes a repeat safe: a move that already landed answers `stale`
    const retried = !res.ok && res.error === 'network'
    if (retried) res = await server.act(table, f.round.id, h.idx, h.cards.length, a)
    end()
    if (res.state) accept(res.state)
    if (res.ok) {
      // keep the face-down card until the real one lands, so it turns over in place
      setOpt((o) => o && { ...o, until: Math.min(o.until, clock.now() + 1500) })
      return
    }
    setOpt(null)
    // after a lost answer the first attempt may have landed: leave it to settlement, which refunds stakes the server never took
    if (extra && !retried && res.error !== 'network') await refundUpTo(who, key, extra)
    if (res.error !== 'stale' && res.error !== 'dealing') pushToast({ kind: 'info', title: say(res.error) })
    poll()
  }

  /* ---------------- reactions ---------------- */

  const react = async (code: ReactionCode) => {
    const f = feedRef.current
    if (!f || f.mine?.table !== table || clock.now() < rateUntil) return
    const seat = f.mine.seat
    const res = await server.react(table, code)
    if (res.ok) {
      sfx.table.pop()
      setSent((s) => [...s.filter((x) => x.at > res.at - 8000), { id: res.id, seat, code, at: res.at }])
    } else if (res.error === 'rate') setRateUntil(clock.now() + TIMING.REACTION_GAP_MS)
  }

  /* ---------------- wallet ---------------- */

  // every feed: pay out this round once its results show, refund a bet that never reached the round,
  // and settle rounds this browser paid into but missed. Only the tab that controls the seat touches the wallet,
  // and nothing does while signing in or out swaps the wallet.
  useEffect(() => {
    const f = feed
    if (!f || !server.book || switching(who)) return
    const controls = !f.mine || f.mine.active
    if (!controls) return
    const round = f.round
    const key = keyOf(server.book, round.id)
    const mine = f.hands.filter((h) => h.mine)
    if (summary) {
      void settleRound(who, key, summary.bet, summary.payout, {
        table,
        players: new Set(f.hands.map((h) => h.seat)).size,
        hands: mine.length,
        outcome: bestOutcome(mine) ?? 'lose',
      })
    }
    // a bet that never reached the round comes back once betting is over, but only while this tab holds the seat here.
    // Without it (moved off, or signed up before bj_claim moved the seat and hands) a missing hand proves nothing:
    // settleMissed asks bj_result about the round once it is over
    const seated = f.mine?.table === f.table.id && f.mine.active
    const p = pending(who, key)
    if (p && seated && p.table === f.table.id && round.phase !== 'waiting' && round.phase !== 'betting' && !mine.length) {
      void refundAll(who, key)
      setOpt(null)
    }
    void settleMissed(server, who, src, round.id, f.past)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, tick])

  // a quiet table can go a long time without a new feed: keep asking about rounds played elsewhere
  useEffect(() => {
    const id = setInterval(() => {
      const f = feedRef.current
      if (f && (!f.mine || f.mine.active)) void settleMissed(server, who, src, f.round.id, f.past)
    }, 10_000)
    return () => clearInterval(id)
  }, [server, who, src, feedRef])

  /* ---------------- sounds ---------------- */

  const heard = useRef({ round: 0, results: false, shuffle: false, hole: false, turn: '' })
  useEffect(() => {
    if (!feed || !r) return
    const h = heard.current
    if (h.round !== r.id) heard.current = { round: r.id, results: false, shuffle: false, hole: !!feed.dealer[1]?.flip && feed.dealer[1].flip <= t - 1000, turn: '' }
    const s = heard.current
    if (!s.shuffle && momentOf(feed, t) === 'shuffling') {
      s.shuffle = true
      sfx.table.shuffle()
    }
    const hole = feed.dealer[1]
    if (!s.hole && hole?.flip != null && hole.flip <= t) {
      s.hole = true
      sfx.table.flip()
    }
    if (!s.results && r.resultsAt != null && t >= r.resultsAt && feed.hands.some((x) => x.outcome)) {
      s.results = true
      sfx.table.chipsSlide()
      if (summary) {
        const net = summary.payout - summary.bet
        if (net > 0) (myHands.some((x) => x.outcome === 'blackjack') ? sfx.bigWin : sfx.win)()
        else if (net < 0) sfx.lose()
      }
      if (feed.hands.some((x) => !x.mine && (x.outcome === 'win' || x.outcome === 'blackjack'))) setTimeout(sfx.coin, 450)
    }
    const turnKey = myTurn && r.turn ? `${r.id}:${r.turn.seat}:${r.turn.hand}` : ''
    if (turnKey && s.turn !== turnKey) {
      s.turn = turnKey
      sfx.table.turn()
      navigator.vibrate?.(30)
    }
  })

  // the last five seconds of your turn tick, and a hidden tab's title says it's your turn
  const turnEnds = myTurn ? r!.turn!.endsAt : null
  useEffect(() => {
    if (turnEnds == null) return
    const title = document.title
    let flip = false
    let lastSec = 0
    const id = setInterval(() => {
      const sec = Math.ceil((turnEnds - clock.now()) / 1000)
      if (sec > 0 && sec <= 5 && sec !== lastSec) sfx.tick()
      lastSec = sec
      if (document.hidden) document.title = (flip = !flip) ? 'Your turn' : title
      else if (document.title !== title) document.title = title
    }, 100)
    return () => {
      clearInterval(id)
      document.title = title
    }
  }, [turnEnds, clock])

  /* ---------------- leaving the page ---------------- */

  useEffect(() => {
    // a reload polls again within a second and keeps the seat; a closed tab frees it in about 5 s
    const onHide = () => server.away(table)
    window.addEventListener('pagehide', onHide)
    return () => window.removeEventListener('pagehide', onHide)
  }, [server, table])

  /* ---------------- keyboard ---------------- */

  const spaceAction = () => {
    if (canBet) void placeBet()
    else if (queued != null) setQueued(null)
    else if (active && !betOpen && !inRound && !req && !here!.leaving) setQueued(bet)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === ' ') {
        e.preventDefault()
        spaceAction()
      } else if (k === 'h' && myTurn) void act('hit')
      else if (k === 's' && myTurn) void act('stand')
      else if (k === 'd' && canDouble) void act('double')
      else if (k === 'p' && canSplit) void act('split')
      else if (k === 'r') setHints((v) => !v)
      else if (k === 'escape') setHints(false)
      else if (hints && /^[1-8]$/.test(k)) void react(STICKERS[Number(k) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const seatTaken = (f: TableFeed) => firstFree(f) === 0
  const spin = (k: Req['kind']) => req?.kind === k && <Spinner size={16} />

  let seatArea: React.ReactNode
  if (!feed) seatArea = <ActionButton disabled>{connecting ? 'Connecting…' : 'Loading table…'}</ActionButton>
  else if (busyAt != null)
    seatArea = (
      <div className="flex flex-col gap-2 rounded-xl bg-stage p-3 text-[13px] text-muted">
        You still have a hand at another table.
        <div className="grid grid-cols-2 gap-2">
          <ActionButton tone="gold" onClick={() => navigate(`/game/livebj/${busyAt}`)}>
            Go back
          </ActionButton>
          <ActionButton tone="neutral" onClick={() => setBusyAt(null)}>
            Stay here
          </ActionButton>
        </div>
      </div>
    )
  else if (!here) {
    const elsewhere = feed.mine
    seatArea = (
      <div className="flex flex-col gap-2.5">
        <ActionButton onClick={() => void sit(firstFree(feed))} disabled={!!req || seatTaken(feed)} sub={elsewhere ? 'Moves you from your other table' : undefined}>
          {spin('sit')} {seatTaken(feed) ? 'Table is full' : 'Sit down'}
        </ActionButton>
        {elsewhere && (
          <button onClick={() => navigate(`/game/livebj/${elsewhere.table}`)} className="text-left text-[12px] font-bold text-gold hover:underline">
            You're seated at another table · Go back
          </button>
        )}
        <NameEditor name={name} editable={!username} onName={rename} />
      </div>
    )
  } else if (!active)
    seatArea = (
      <div className="flex flex-col gap-2 rounded-xl bg-stage p-3 text-[13px] text-muted">
        Your seat is being played in another tab.
        <ActionButton tone="gold" onClick={() => void sit(here.seat)} disabled={!!req}>
          {spin('sit')} Play here
        </ActionButton>
      </div>
    )
  else {
    const last = readLast(who)
    const rebet = feed.past.length > 0 && last?.table === table && last.bet === bet
    const again = rebet ? `Rebet ${fmt(bet, bet % 1 ? 2 : 0)}` : null
    let label: React.ReactNode = again ?? 'Bet'
    // two dealt rounds without a bet: the third removes the seat
    let sub: React.ReactNode = here.idle >= 2 ? 'Bet this round to keep your seat' : undefined
    let onClick: (() => void) | undefined = () => void placeBet()
    let disabled = !canBet
    let tone: 'accent' | 'neutral' = 'accent'
    if (req?.kind === 'bet') {
      label = (
        <>
          <Spinner size={16} /> {req.retrying ? 'Confirming…' : 'Placing bet…'}
        </>
      )
      disabled = true
    } else if (inRound || (betOpen && staked)) {
      label = myHands.length ? 'Bet placed' : 'Confirming…'
      sub = r?.phase === 'betting' ? 'Waiting for the deal' : r?.phase === 'waiting' ? 'The deal starts once betting closes' : 'In this round'
      disabled = true
      tone = 'neutral'
    } else if (queued != null) {
      label = 'Bets closed · joins next round'
      sub = 'Tap to cancel'
      onClick = () => setQueued(null)
      disabled = false
      tone = 'neutral'
    } else if (!betOpen) {
      label = again ?? 'Bet next round'
      sub = 'Joins the next round'
      onClick = () => setQueued(bet)
      disabled = !!req || here.leaving
      tone = 'neutral'
    }
    seatArea = (
      <div className="flex flex-col gap-3">
        <BetInput value={bet} onChange={setBet} disabled={!editable} />
        <div className="-mt-1 grid grid-cols-2 gap-1.5">
          {[
            ['Min', feed.table.min],
            ['Max', Math.min(feed.table.max, Math.max(feed.table.min, Math.floor(balance)))],
          ].map(([k, v]) => (
            <button
              key={k}
              onClick={() => (sfx.click(), setBet(Number(v)))}
              disabled={!editable}
              className={`tnum h-9 rounded-lg text-[12px] font-bold transition disabled:opacity-50 ${bet === v ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}
            >
              {k} {fmt(Number(v), 0)}
            </button>
          ))}
        </div>
        <ActionButton tone={tone} onClick={onClick} disabled={disabled} sub={sub}>
          {label} {!disabled && <Kbd>Space</Kbd>}
        </ActionButton>
        <NameEditor name={name} editable={!username} onName={rename} />
      </div>
    )
  }

  const waitingFor = r?.phase === 'turns' && !myTurn && turn ? (otherTab ? 'This hand is being played in another tab' : turn.mine ? 'Your next hand is up' : `Waiting for ${turn.name}…`) : null
  const moves = (
    <div className={`flex flex-col gap-2 ${myTurn ? 'max-lg:order-first' : ''}`}>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="neutral" onClick={() => void act('hit')} disabled={!myTurn || !!req}>
          {spin('hit')} Hit <Kbd>H</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={() => void act('stand')} disabled={!myTurn || !!req}>
          {spin('stand')} Stand <Kbd>S</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={() => void act('double')} disabled={!canDouble}>
          {spin('double')} Double <Kbd>D</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={() => void act('split')} disabled={!canSplit}>
          {spin('split')} Split <Kbd>P</Kbd>
        </ActionButton>
      </div>
      {waitingFor && <div className="text-center text-[12px] font-semibold text-muted">{waitingFor}</div>}
    </div>
  )

  const panel = (
    <>
      <TableHeader feed={feed} live={server.online && !reconnecting} />
      <div className={betOpen && active && !myHands.length ? 'max-lg:order-first' : ''}>{seatArea}</div>
      {moves}
      <Reactions enabled={!!here} cooling={t < rateUntil} hints={hints && !!here} onReact={(c) => void react(c)} />
      {feed && <SeatList feed={feed} t={t} />}
      {feed && <PastRounds past={feed.past} onPick={setHistory} />}
      {active && (
        <button
          onClick={() => void leave()}
          disabled={!!req}
          className="flex items-center justify-center gap-2 self-start rounded-lg px-3 py-2 text-[12px] font-bold text-muted transition hover:bg-raised hover:text-ink disabled:opacity-50"
        >
          {spin('leave')} {here!.leaving ? 'Leaving after this round' : 'Leave seat'}
        </button>
      )}
      {!server.online && <SoloNote connecting={connecting} onRetry={onRetry} />}
    </>
  )

  return (
    <>
      <GameShell
        panel={panel}
        stageClass="max-lg:h-[min(64vh,600px)]"
        stage={
          <Stage
            stageRef={stageRef}
            size={size}
            feed={feed}
            t={t}
            now={clock.now}
            opt={opt}
            reactions={reactions}
            summary={summary}
            reconnecting={reconnecting}
            mySeat={here?.seat ?? null}
            canSit={!!feed && !feed.mine && !req}
            onSit={(seat) => void sit(seat)}
            onHistory={setHistory}
          />
        }
      />
      <AnimatePresence>
        {history != null && <HistoryModal server={server} id={history} recent={feed?.history ?? []} onPick={setHistory} onClose={() => setHistory(null)} />}
      </AnimatePresence>
    </>
  )
}
