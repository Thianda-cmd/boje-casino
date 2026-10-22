import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CardBack } from '../../art/Card'
import { HistoryPills, WinPopup } from '../../components/ui'
import { IconX } from '../../components/icons'
import { fmt } from '../../lib/format'
import { CardSlot, Felt, isBJ, PlayingCard, ScorePill, Shoe, score } from '../blackjack/table'
import { BetSpot, cardVars, Nameplate, Pod, SeatHands, SeatReaction, type SeatInfo, type ShownCard, type ShownHand, type TurnInfo } from './Seat'
import { TIMING, type ReactionCode, type TableFeed } from './types'
import { arcSeat, dealerAt, handsAt, momentOf, resultsOut, toCard, turnOf, type Moment } from './view'

/* The felt: the dealer at the top, the five seats on the arc (or, on a phone, pods for the other seats
   and the seat you play or watch at full size), the status line and everything that pops up over it. */

/** What the screen shows before the server confirms the player's own move. */
export type Optimistic =
  | { kind: 'bet'; seat: number; round: number; amount: number; until: number }
  | { kind: 'hit' | 'double' | 'split'; seat: number; hand: 0 | 1; n: number; until: number }

export interface Reaction {
  id: number
  seat: number
  code: ReactionCode
  at: number
}

export interface StageProps {
  stageRef: RefObject<HTMLDivElement | null>
  size: { w: number; h: number }
  feed: TableFeed | null
  t: number
  now: () => number
  opt: Optimistic | null
  reactions: Reaction[]
  /** my result this round once it is shown */
  summary: { bet: number; payout: number } | null
  reconnecting: boolean
  /** my seat at this table, if any */
  mySeat: number | null
  /** empty seats can be taken (not seated anywhere and nothing in flight) */
  canSit: boolean
  onSit: (seat: number) => void
  onHistory: (round: number) => void
}

/** Decides which cards fly in from the shoe and staggers the ones that become due together. */
function useFlights(round: number | undefined) {
  const seen = useRef(new Map<string, { first: number; delay: number | null }>())
  const first = useRef(true)
  const roundRef = useRef(round)
  if (roundRef.current !== round) {
    roundRef.current = round
    seen.current.clear()
  }
  useEffect(() => void (first.current = false))
  let batch = 0
  return (id: string, at: number, t: number): number | null => {
    let e = seen.current.get(id)
    if (!e) {
      e = { first: performance.now(), delay: first.current || t - at > 1200 ? null : 0.08 * batch++ }
      seen.current.set(id, e)
    }
    // a card that has landed doesn't fly again if it moves (a split)
    return performance.now() - e.first < 700 ? e.delay : null
  }
}

function seatInfo(feed: TableFeed, seat: number): SeatInfo | null {
  const s = feed.seats[seat - 1]
  if (s)
    return {
      seat,
      name: s.name,
      avatar: s.avatar,
      tag: s.me ? 'you' : s.bot ? 'bot' : s.guest ? 'guest' : 'account',
      acct: s.acct,
      status: s.leaving ? 'Leaving' : s.away ? 'Away' : s.idle >= 2 ? 'Idle zzz' : null,
      ghost: false,
    }
  const h = handsAt(feed, seat)[0]
  return h ? { seat, name: h.name, avatar: h.avatar, tag: h.mine ? 'you' : h.guest ? 'guest' : 'account', acct: h.acct, status: 'Left the table', ghost: true } : null
}

const PLACEHOLDER = toCard(0, 0)
export const WIN_POPUP_MS = 2600

function shownHands(feed: TableFeed, seat: number, t: number, opt: Optimistic | null, flight: ReturnType<typeof useFlights>): ShownHand[] {
  const rid = feed.round.id
  const out = resultsOut(feed, t)
  const turn = turnOf(feed, t)
  const raw = handsAt(feed, seat)
  const hands = raw.map((h): ShownHand => {
    const cards = h.cards.flatMap((c, i): ShownCard[] => {
      if (c.at > t) return []
      const id = `${rid}:${seat}:${c.at}`
      return [{ key: String(i), id, card: toCard(c.c ?? 0, i), faceDown: false, delay: flight(id, c.at, t) }]
    })
    // a bust shows the moment the card lands, as in single-player; everything else waits for the results
    const bust = score(cards.map((c) => c.card)).total > 21
    return {
      key: `${rid}:${seat}:${h.idx}`,
      idx: h.idx,
      bet: h.bet,
      doubled: h.doubled,
      split: h.split,
      cards,
      outcome: out ? h.outcome : bust ? 'bust' : null,
      payout: out ? h.payout : bust ? 0 : null,
      active: turn?.seat === seat && turn.idx === h.idx,
      dim: raw.length > 1 && turn?.seat === seat && turn.idx !== h.idx,
    }
  })
  if (!opt || opt.kind === 'bet' || opt.seat !== seat || t >= opt.until) return hands
  if (opt.kind === 'split') {
    // the pair slides apart at once; the new cards follow when the server deals them
    if (hands.length !== 1 || hands[0].cards.length !== 2) return hands
    const [a, b] = hands[0].cards
    return [
      { ...hands[0], split: true, cards: [a] },
      { ...hands[0], key: `${rid}:${seat}:1`, idx: 1, split: true, cards: [{ ...b, key: '0', delay: null }], active: false, dim: true },
    ]
  }
  const h = hands.find((x) => x.idx === opt.hand)
  if (!h || h.cards.length !== opt.n) return hands
  // a face-down card is on its way; it turns over in place when the real one lands
  h.cards = [...h.cards, { key: String(opt.n), id: `g:${rid}:${seat}:${opt.hand}:${opt.n}`, card: PLACEHOLDER, faceDown: true, delay: flight(`g:${rid}:${seat}:${opt.hand}:${opt.n}`, t, t) ?? 0 }]
  if (opt.kind === 'double' && !h.doubled) (h.bet *= 2), (h.doubled = true)
  return hands
}

function turnInfo(feed: TableFeed, seat: number, t: number): TurnInfo | null {
  const turn = feed.round.turn
  if (!turn || turn.seat !== seat || t < turn.at) return null
  return { key: `${feed.round.id}:${turn.seat}:${turn.hand}:${turn.at}:${turn.endsAt}`, at: turn.at, endsAt: turn.endsAt, away: turn.away }
}

/** The stake on a seat's spot: what the server holds, or the bet on its way. */
function spotAmount(feed: TableFeed, seat: number, t: number, opt: Optimistic | null) {
  const h0 = handsAt(feed, seat).find((h) => h.idx === 0)
  if (h0) return { amount: h0.bet, pending: false }
  if (opt?.kind === 'bet' && opt.seat === seat && opt.round === feed.round.id && t < opt.until) return { amount: opt.amount, pending: true }
  return { amount: 0, pending: false }
}

/** One countdown readout, refreshed ten times a second without re-rendering the stage. */
export function Countdown({ to, now, clock }: { to: number; now: () => number; clock?: boolean }) {
  const [, set] = useState(0)
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), 100)
    return () => clearInterval(id)
  }, [])
  const ms = Math.max(0, to - now())
  if (clock) {
    const s = Math.ceil(ms / 1000)
    return <span className="tnum">{`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`}</span>
  }
  return <span className="tnum">{(ms / 1000).toFixed(1)}s</span>
}

/** A thin bar that drains until `to`, as a compositor animation. */
function DrainBar({ to, total, now, tone }: { to: number; total: number; now: () => number; tone: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.animate) return
    const left = Math.max(0, to - now())
    const a = el.animate([{ transform: `scaleX(${Math.min(1, left / total)})` }, { transform: 'scaleX(0)' }], { duration: Math.max(1, left), fill: 'forwards', easing: 'linear' })
    return () => a.cancel()
  }, [to, total, now])
  return (
    <div className="mt-2 h-1 w-44 overflow-hidden rounded-full bg-white/10">
      <div ref={ref} className={`h-full origin-left rounded-full ${tone}`} />
    </div>
  )
}

function StatusLine({ feed, t, now, moment, mySeat, summary }: { feed: TableFeed; t: number; now: () => number; moment: Moment; mySeat: number | null; summary: StageProps['summary'] }) {
  const r = feed.round
  const turn = turnOf(feed, t)
  const mine = turn?.ctl && turn.mine
  let text: ReactNode
  let bar: ReactNode = null
  let tone = 'text-white/80'
  switch (moment) {
    case 'waiting': {
      const exp = feed.mine?.table === feed.table.id ? feed.mine.expiresAt : null
      if (exp != null && exp - t < 30000) {
        text = (
          <>
            Bet within <Countdown to={exp} now={now} clock /> or your seat opens up
          </>
        )
        tone = 'text-gold'
      } else text = mySeat ? 'Place your bets' : feed.seats.some(Boolean) ? 'Waiting for bets' : 'Take a seat to play'
      break
    }
    case 'betting':
      text = (
        <>
          {mySeat ? 'Place your bets' : 'Bets open'} · <Countdown to={r.betEndsAt!} now={now} />
        </>
      )
      bar = <DrainBar to={r.betEndsAt!} total={TIMING.BET_MS} now={now} tone="bg-gold" />
      break
    case 'closed':
      text = 'Bets closed'
      break
    case 'shuffling':
      text = 'Shuffling'
      break
    case 'dealing':
      text = 'Dealing'
      break
    case 'peek':
      text = 'Checking for blackjack'
      break
    case 'turns':
      if (mine && r.turn) {
        text = (
          <>
            Your turn · <Countdown to={r.turn.endsAt} now={now} />
          </>
        )
        tone = 'text-accent'
        bar = <DrainBar to={r.turn.endsAt} total={r.turn.endsAt - r.turn.at} now={now} tone="bg-accent" />
      } else {
        // between turns (a bust card landing, a split being dealt) name the hand that plays next
        const next = turn ?? (r.turn && feed.hands.find((h) => h.seat === r.turn!.seat && h.idx === r.turn!.hand))
        text = next ? `${next.mine ? 'Your' : `${next.name}'s`} turn` : 'Dealer plays'
      }
      break
    case 'dealer':
      text = 'Dealer plays'
      break
    case 'done': {
      const next = r.nextAt != null && (
        <span className="text-white/55">
          {' '}
          · Next round in <Countdown to={r.nextAt} now={now} />
        </span>
      )
      if (summary) {
        const net = summary.payout - summary.bet
        tone = net > 0 ? 'text-accent' : net < 0 ? 'text-white/80' : 'text-white'
        text = (
          <>
            {net > 0 ? `You win ${fmt(summary.payout)}` : net < 0 ? `You lose ${fmt(-net)}` : 'Push'}
            {next}
          </>
        )
      } else text = <>Round over{next}</>
    }
  }
  return (
    <div className="pointer-events-none flex flex-col items-center text-center">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={`${moment}:${mine ? 'me' : ''}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
          className={`whitespace-nowrap rounded-full bg-[#071a14]/70 px-4 py-1.5 text-[13px] font-extrabold tracking-wide ring-1 ring-white/10 ${tone} ${
            mine ? 'shadow-[0_0_24px_-4px_rgba(34,211,111,.6)] ring-accent/50' : ''
          }`}
        >
          {text}
        </motion.div>
      </AnimatePresence>
      {bar}
    </div>
  )
}

function Dealer({ feed, t, cw, from, flight }: { feed: TableFeed; t: number; cw: number; from: { x: number; y: number }; flight: ReturnType<typeof useFlights> }) {
  const rid = feed.round.id
  const cards = dealerAt(feed, t)
  const open = cards.filter((c) => c.open).map((c, i) => toCard(c.c.c!, i))
  // the dealer has no choices, so its pill shows the best total (soft or not), or BJ
  const value = !open.length ? null : cards[1]?.open && isBJ(open) ? 'BJ' : String(score(open).total)
  return (
    <div className="flex flex-col items-center gap-1.5" style={cardVars(cw)}>
      <div className="text-[11px] font-bold uppercase tracking-[.18em] text-white/55">Dealer</div>
      <div className="relative flex h-[var(--card-h)] items-center">
        {cards.length === 0 && <CardSlot />}
        <AnimatePresence>
          {cards.map(({ c, open: up }, i) => {
            const id = `${rid}:d:${i}`
            const delay = flight(id, c.at, t)
            return (
              <PlayingCard
                key={id}
                card={up ? toCard(c.c!, i) : PLACEHOLDER}
                index={i}
                hidden={!up}
                from={delay == null ? null : from}
                delay={delay ?? 0}
                overlap={cards.length > 3 ? 0.62 : 0.5}
              />
            )
          })}
        </AnimatePresence>
      </div>
      <ScorePill value={value} />
    </div>
  )
}

/** The shoe's fill and a riffle while a new shoe is shuffled. */
function ShoeMeter({ left, shuffling }: { left: number; shuffling: boolean }) {
  return (
    <div className="pointer-events-none absolute right-3 top-[calc(var(--card-h)*0.86)] flex flex-col items-end gap-1">
      <AnimatePresence>
        {shuffling && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="relative mb-1 h-[calc(var(--card-h)*0.5)] w-[calc(var(--card-w)*0.9)]">
            {[0, 1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className="absolute inset-0"
                animate={{ x: i % 2 ? [8, -8, 8] : [-8, 8, -8], rotate: i % 2 ? [6, -4, 6] : [-6, 4, -6] }}
                transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.06, ease: 'easeInOut' }}
              >
                <CardBack className="h-full w-full" />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="h-1 w-12 overflow-hidden rounded-full bg-black/30" title={`${left} cards left in the shoe`}>
        <div className="h-full rounded-full bg-white/45 transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(1, left / 312)) * 100}%` }} />
      </div>
    </div>
  )
}

export function Stage(p: StageProps) {
  const { feed, t, size } = p
  const phone = size.w < 640
  // a short, wide stage (a tablet in landscape, a small window) moves the status line aside to leave the middle to the seats
  const short = !phone && size.h < 520
  // on the arc the middle seat's cards must clear the dealer and the status line: 0.70h >= 164 + 2.94cw (130 with the status aside)
  const cw = Math.round(phone ? Math.max(46, Math.min(84, size.w / 12, size.h * 0.09)) : Math.max(40, Math.min(84, size.w / 13.5, (size.h * 0.7 - (short ? 130 : 164)) / 2.94)))
  const flight = useFlights(feed?.round.id)
  const [peekSeat, setPeekSeat] = useState<number | null>(null)
  // a spectator on a phone follows the seat on turn, and keeps looking at it until another takes over
  const watch = useRef<number | null>(null)

  const vars = cardVars(cw)
  const shoe = { x: size.w - cw * 0.25, y: cw * 0.2 }

  let body: ReactNode = null
  if (feed) {
    const moment = momentOf(feed, t)
    const out = resultsOut(feed, t)
    const n = feed.table.seats
    const turn = turnOf(feed, t)
    const latest = new Map<number, Reaction>()
    for (const x of p.reactions) if (t >= x.at - 300 && t < x.at + TIMING.REACTION_SHOW_MS) latest.set(x.seat, x)
    const reactionAt = (seat: number) => {
      const x = latest.get(seat)
      return x ? { code: x.code, id: x.id } : null
    }
    const sitLabel = p.canSit ? 'Sit' : 'Empty'

    if (!phone) {
      const dealerY = size.h * 0.06 + 20 + cw * 0.77
      body = (
        <>
          <div className="absolute inset-x-0 top-[6%] flex justify-center">
            <Dealer feed={feed} t={t} cw={Math.round(cw * 1.1)} from={{ x: shoe.x - size.w / 2, y: shoe.y - dealerY }} flight={flight} />
          </div>
          <div className={short ? 'absolute left-3 top-12 flex' : 'absolute inset-x-0 flex justify-center'} style={short ? undefined : { top: size.h * 0.06 + 72 + cw * 1.54 }}>
            <StatusLine feed={feed} t={t} now={p.now} moment={moment} mySeat={p.mySeat} summary={p.summary} />
          </div>
          {Array.from({ length: n }, (_, i) => {
            const seat = i + 1
            const pos = arcSeat(seat, n)
            const ax = (pos.x / 100) * size.w
            // a short stage has room to spare below the seats, not above them
            const ay = (pos.y / 100) * size.h + (short ? 12 : 0)
            const info = seatInfo(feed, seat)
            const hands = shownHands(feed, seat, t, p.opt, flight)
            const spot = spotAmount(feed, seat, t, p.opt)
            const mine = info?.tag === 'you'
            const outcome = out ? (handsAt(feed, seat).find((h) => h.idx === 0)?.outcome ?? null) : null
            const cardTop = ay - 22 - 10 - cw * 1.4 * 0.5
            return (
              <div key={seat} className="absolute" style={{ left: ax, top: ay, zIndex: turn?.seat === seat ? 13 : mine ? 12 : 10 - Math.round(Math.abs(seat - (n + 1) / 2)) }}>
                <div className="relative" style={{ transform: mine ? 'scale(1.08)' : undefined }}>
                  <div className="absolute bottom-[30px] left-0 -translate-x-1/2">
                    <SeatHands hands={hands} from={{ x: shoe.x - ax, y: shoe.y - cardTop }} scale={0.72} />
                  </div>
                  <div className="absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2">
                    <BetSpot
                      amount={spot.amount}
                      pending={spot.pending}
                      outcome={outcome}
                      dealer={{ x: size.w / 2 - ax, y: dealerY - ay }}
                      empty={
                        !info &&
                        (p.canSit ? (
                          <button onClick={() => p.onSit(seat)} className="flex h-full w-full items-center justify-center rounded-full text-[11px] font-extrabold text-white/80 transition hover:bg-white/10 hover:text-white">
                            Sit
                          </button>
                        ) : (
                          <span className="text-[9px] font-bold uppercase tracking-wide text-white/30">{sitLabel}</span>
                        ))
                      }
                    />
                  </div>
                  {info && (
                    <div className="absolute left-0 top-[28px] -translate-x-1/2" style={{ width: 150 }}>
                      <div className="relative flex justify-center">
                        <SeatReaction code={reactionAt(seat)?.code ?? null} id={reactionAt(seat)?.id ?? null} />
                        <Nameplate info={info} turn={turnInfo(feed, seat, t)} now={p.now} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </>
      )
    } else {
      // phones: the focus seat is mine, else the one on turn, else the last one followed, else the first with a hand
      const withHands = Array.from({ length: n }, (_, i) => i + 1).filter((s) => handsAt(feed, s).length)
      if (!p.mySeat) {
        if (turn) watch.current = turn.seat
        else if (watch.current == null || !withHands.includes(watch.current)) watch.current = withHands[0] ?? null
      }
      const focus = p.mySeat ?? watch.current
      const heroCw = Math.round(Math.min(76, size.w / 5))
      const heroInfo = focus ? seatInfo(feed, focus) : null
      // stacked from the top: the dealer (label, cards, score), the status line, then the pods
      const dealerCw = Math.round(cw * 1.1)
      const dealerY = 44 + 22 + dealerCw * 0.7
      const statusTop = 44 + 22 + Math.round(dealerCw * 1.4) + 40
      const heroY = size.h - 60 - heroCw * 0.7
      const heroSpot = focus ? spotAmount(feed, focus, t, p.opt) : { amount: 0, pending: false }
      const heroOutcome = focus && out ? (handsAt(feed, focus).find((h) => h.idx === 0)?.outcome ?? null) : null
      const heroHands = focus ? shownHands(feed, focus, t, p.opt, flight) : []
      body = (
        <>
          <div className="absolute inset-x-0 top-11 flex justify-center">
            <Dealer feed={feed} t={t} cw={dealerCw} from={{ x: shoe.x - size.w / 2, y: shoe.y - dealerY }} flight={flight} />
          </div>
          <div className="absolute inset-x-0 flex justify-center" style={{ top: statusTop }}>
            <StatusLine feed={feed} t={t} now={p.now} moment={moment} mySeat={p.mySeat} summary={p.summary} />
          </div>
          <div className="absolute inset-x-0 flex flex-row-reverse justify-center gap-1" style={{ top: statusTop + 38 }}>
            {Array.from({ length: n }, (_, i) => {
              const seat = i + 1
              if (seat === focus)
                return (
                  <div key={seat} className="flex w-14 flex-col items-center pt-2 text-[10px] font-extrabold uppercase tracking-wide text-gold/80">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-gold/50">{seat}</span>
                    {p.mySeat ? 'You' : 'Watching'}
                  </div>
                )
              const info = seatInfo(feed, seat)
              return (
                <Pod
                  key={seat}
                  info={info}
                  hands={shownHands(feed, seat, t, p.opt, flight)}
                  turn={turnInfo(feed, seat, t)}
                  now={p.now}
                  bet={spotAmount(feed, seat, t, p.opt).amount}
                  reaction={reactionAt(seat)}
                  onClick={info ? () => setPeekSeat(seat) : p.canSit ? () => p.onSit(seat) : undefined}
                  empty={sitLabel}
                />
              )
            })}
          </div>
          <div className="absolute inset-x-0 bottom-3 flex flex-col items-center gap-2" style={cardVars(heroCw)}>
            {focus && heroInfo ? (
              <>
                {heroHands.length ? (
                  <SeatHands hands={heroHands} from={{ x: shoe.x - size.w / 2, y: shoe.y - heroY }} scale={0.85} />
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="h-8" />
                    <CardSlot />
                  </div>
                )}
                <div className="relative flex items-center gap-2">
                  <SeatReaction code={reactionAt(focus)?.code ?? null} id={reactionAt(focus)?.id ?? null} />
                  <BetSpot amount={heroSpot.amount} pending={heroSpot.pending} outcome={heroOutcome} dealer={{ x: 0, y: dealerY - (size.h - 30) }} size={38} />
                  <Nameplate info={heroInfo} turn={turnInfo(feed, focus, t)} now={p.now} />
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2 pb-2">
                <CardSlot />
                <span className="text-[12px] font-bold text-white/55">{p.canSit ? 'Tap an empty seat to sit down' : 'Waiting for players'}</span>
              </div>
            )}
          </div>
          <AnimatePresence>
            {peekSeat != null && seatInfo(feed, peekSeat) && (
              <motion.div
                className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-4"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setPeekSeat(null)}
              >
                <motion.div
                  initial={{ scale: 0.92, y: 10 }}
                  animate={{ scale: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="relative flex flex-col items-center gap-3 rounded-2xl bg-[#0b2c22]/95 px-5 pb-4 pt-5 ring-1 ring-white/10"
                  style={cardVars(56)}
                >
                  <button onClick={() => setPeekSeat(null)} className="absolute right-1.5 top-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:text-white" aria-label="Close">
                    <IconX size={16} />
                  </button>
                  <SeatHands hands={shownHands(feed, peekSeat, t, p.opt, flight)} from={{ x: 0, y: -120 }} />
                  <Nameplate info={seatInfo(feed, peekSeat)!} turn={turnInfo(feed, peekSeat, t)} now={p.now} />
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )
    }
  }

  const net = p.summary ? p.summary.payout - p.summary.bet : 0
  // the win card shows for a moment, then gets out of the way of everyone else's results
  const popup = !!feed?.round.resultsAt && t < feed.round.resultsAt + WIN_POPUP_MS
  return (
    <div ref={p.stageRef} className="absolute inset-0 overflow-hidden" style={vars as CSSProperties}>
      <Felt />
      <Shoe />
      {feed && <ShoeMeter left={feed.table.cardsLeft} shuffling={momentOf(feed, t) === 'shuffling'} />}
      <HistoryPills
        className={`absolute left-3 top-3 ${phone ? 'right-[calc(var(--card-w)*0.9)]' : 'max-w-[34%]'}`}
        items={(feed?.history ?? []).map((h) => ({
          key: h.id,
          label: h.bj ? 'BJ' : h.total > 21 ? 'Bust' : h.total,
          tone: h.bj ? 'gold' : h.total > 21 ? 'win' : 'neutral',
          onClick: () => p.onHistory(h.id),
        }))}
      />
      {body}
      <AnimatePresence>{p.summary && net > 0 && popup && <WinPopup key="win" mult={p.summary.payout / p.summary.bet} amount={p.summary.payout} />}</AnimatePresence>
      <AnimatePresence>
        {p.reconnecting && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-panel/95 px-4 py-2 text-[13px] font-bold text-gold shadow-lg"
          >
            <span className="h-2 w-2 animate-pulse rounded-full bg-gold" /> Reconnecting…
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
