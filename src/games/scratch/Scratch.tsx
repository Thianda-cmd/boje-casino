import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import { ActionButton, GameShell, HistoryPills, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { navigate } from '../../lib/router'
import { sfx } from '../../lib/sound'
import { scratchSfx } from './sound'
import { safeStorage } from '../../lib/storage'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { MIN_BET, useWallet } from '../../store/wallet'
import { CARDS, CARD_IDS, buildBoard, celebrates, hitChance, isHot, isMax, isPrize, multLabel, oddsLabel, serial, symbolOf, winTier, drawCard, type CardId, type Outcome } from './rules'
import { CARD_H, CARD_W, CELL, GAP, GRID_X, GRID_Y, cellCenter } from './layout'
import { CardThumb, THEMES } from './cardart'
import { BONUS_AREA } from './engine'
import { releaseFoilCaches } from './foil'
import { ScratchCard, type CardHandle, type Speed } from './ScratchCard'
import { Fx } from './fx'
import { Backdrop } from './backdrop'
import { RackChip, RackTile, RiskMeter, topCoins } from './rack'
import { Celebration, type Party } from './celebrate'
import { AutoStops, CountControl, NO_SESSION, PriceControl, SessionStrip, SpeedControl, type Session, type Stops } from './panel'
import { PrizeModal, TicketModal, type TicketData } from './ticket'

/*
  Scratch & Win: four instant-win cards. Pick a card in the rack (its price is your bet), buy it, and scratch the foil
  with the mouse or a finger (or press Reveal all, or Space, and a coin does it for you). Three of a kind win that
  symbol's prize; Fruit Frenzy's Frenzy spot multiplies it.

  The prize is drawn the moment the card is bought (rules.ts) and the board is built to show it; the card, with its
  board, is kept in storage until it is paid. It pays once: when its last foil comes off, or, for a win big enough to be
  celebrated, when the celebration's coins reach the balance (or it is skipped). Leaving the page or the game with foil
  still on pays it on the way out, and the card is shown again, fully out and stamped "Paid while away", on the next
  visit; a card whose page died before it could pay is paid then too.
*/

type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; ticket: TicketData }
type Stored = { bet?: number; payout?: number; meta?: Record<string, number | string | boolean>; ticket?: TicketData; paid?: boolean }
/** what is kept in storage: every card bought and not yet shown paid (an entry from before stacks is one Stored) */
type Store = { v: 2; cards: Stored[] }
const pendingKey = (uid: string | null) => `lumen.scratch.pending.${uid ?? 'guest'}`
const CARD_KEY = 'lumen.scratch.card'
const SPEED_KEY = 'lumen.scratch.speed'

type Phase = 'idle' | 'play' | 'done'

/** how the card on the stage changes: a fresh one is dealt from below and the old one tossed aside; picking another
 *  card in the rack slides them past like a carousel */
type Move = { kind: 'buy' | 'pick'; dir: number }
const EASE_OUT = [0.4, 0, 0.6, 1] as const
const CARD_MOTION: Variants = {
  enter: (m: Move) => (m.kind === 'buy' ? { x: 0, y: 70, opacity: 0, rotate: 2.5, scale: 0.96 } : { x: 90 * m.dir, y: 0, opacity: 0, rotate: 4 * m.dir, scale: 0.94 }),
  center: { x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 },
  exit: (m: Move) =>
    m.kind === 'buy'
      ? { x: -60, y: -20, opacity: 0, rotate: -7, scale: 1, transition: { duration: 0.32, ease: EASE_OUT } }
      : { x: -90 * m.dir, y: 0, opacity: 0, rotate: -4 * m.dir, scale: 0.94, transition: { duration: 0.24, ease: EASE_OUT } },
}

const MemoHistoryPills = memo(HistoryPills)
const MemoModeTabs = memo(ModeTabs)

/** a short buzz on phones that have it (touch screens only; never throws) */
function buzz(pattern: number | number[]) {
  try {
    if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(pattern)
  } catch {
    /* no vibration here */
  }
}

function useMedia(q: string) {
  const [on, setOn] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useLayoutEffect(() => {
    if (typeof matchMedia !== 'function') return
    const m = matchMedia(q)
    const f = () => setOn(m.matches)
    f()
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

// dev only: window.__scratchForce = { prize: 'top' | 'lose' | <index>, bonus?: number } plays that on the next card
function forced(id: CardId, o: Outcome): Outcome {
  const f = (window as unknown as { __scratchForce?: { prize?: number | 'top' | 'lose'; bonus?: number } }).__scratchForce
  if (!f) return o
  const c = CARDS[id]
  const prize = f.prize === 'top' ? c.prizes.length - 1 : f.prize === 'lose' ? -1 : typeof f.prize === 'number' ? f.prize : o.prize
  const bonus = c.bonus ? (f.bonus ?? o.bonus) : 1
  const { board, line } = buildBoard(c, prize)
  return { card: id, prize, bonus, mult: prize < 0 ? 0 : c.prizes[prize].mult * bonus, top: prize === c.prizes.length - 1, board, line }
}

const CSS = `
@keyframes scr-pulse { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.09) } }
.scr-winsym { animation: scr-pulse .95s ease-in-out infinite; }
@keyframes scr-hint { 0%, 100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.07); opacity: .75 } }
.scr-hint { animation: scr-hint 1.1s ease-in-out infinite; }
@keyframes scr-hotring { 0%, 100% { opacity: .55; transform: scale(1) } 50% { opacity: 1; transform: scale(1.035) } }
.scr-hotring { animation: scr-hotring .7s ease-in-out infinite; }
@keyframes scr-hotsym { 0%, 100% { transform: scale(1) } 50% { transform: scale(1.06) } }
.scr-hot > div { animation: scr-hotsym .7s ease-in-out infinite; }
@keyframes scr-wiggle { 0%, 100% { transform: rotate(0) } 20% { transform: rotate(-6deg) scale(1.06) } 40% { transform: rotate(5deg) scale(1.06) } 60% { transform: rotate(-3deg) } 80% { transform: rotate(2deg) } }
.scr-coin-cursor { cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.38' cy='.32' r='.8'%3E%3Cstop offset='0' stop-color='%23fff6c4'/%3E%3Cstop offset='.5' stop-color='%23ffd34a'/%3E%3Cstop offset='1' stop-color='%23b8780a'/%3E%3C/radialGradient%3E%3C/defs%3E%3Cellipse cx='16' cy='18' rx='12' ry='9' fill='%237a4a06'/%3E%3Cellipse cx='16' cy='16' rx='12' ry='9' fill='url(%23g)' stroke='%236a3f04' stroke-width='1.2'/%3E%3Cellipse cx='16' cy='16' rx='8' ry='5.6' fill='none' stroke='%23b8780a' stroke-width='1.2'/%3E%3C/svg%3E") 16 16, crosshair; }
@keyframes scr-rays { to { transform: translate(-50%, -50%) rotate(360deg) } }
@keyframes scr-shine { 0% { background-position: 200% 0 } 100% { background-position: -100% 0 } }
@media (prefers-reduced-motion: reduce) { .scr-winsym, .scr-hint, .scr-hotring, .scr-hot > div { animation: none } }
@media (max-width: 639.98px) { .scr-shell { height: calc(100dvh - 146px - env(safe-area-inset-bottom, 0px)); min-height: 400px } }
@media (min-width: 640px) and (max-width: 1023.98px) { .scr-shell { height: calc(100dvh - 154px - env(safe-area-inset-bottom, 0px)); min-height: 210px; max-height: 920px } }
`

export default function Scratch() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const modeRef = useRef(mode)
  modeRef.current = mode
  const [cardId, setCardId] = useState<CardId>(() => {
    const v = safeStorage.getItem(CARD_KEY) as CardId | null
    return v && CARD_IDS.includes(v) ? v : 'clover'
  })
  const [speed, setSpeed] = useState<Speed>(() => {
    const v = safeStorage.getItem(SPEED_KEY)
    if (v === 'normal' || v === 'turbo' || v === 'instant') return v
    return safeStorage.getItem('lumen.scratch.turbo') === '1' ? 'turbo' : 'normal'
  })
  const [ticket, setTicket] = useState<TicketData | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [present, setPresent] = useState(false)
  const [stampOn, setStampOn] = useState(false)
  const [stamped, setStamped] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const sweepingRef = useRef(false)
  sweepingRef.current = sweeping
  const [hintBonus, setHintBonus] = useState(false)
  const [history, setHistory] = useState<TicketData[]>([])
  const [party, setParty] = useState<Party | null>(null)
  const partyRef = useRef<Party | null>(null)
  partyRef.current = party
  /** a celebrated win is out and its celebration is about to start: the card stays (and stays owed) until it has */
  const [due, setDueState] = useState(false)
  const dueRef = useRef(false)
  const setDue = (v: boolean) => {
    dueRef.current = v
    setDueState(v)
  }
  const [info, setInfo] = useState(false)
  const [viewing, setViewing] = useState<TicketData | null>(null)
  const [move, setMove] = useState<Move>({ kind: 'pick', dir: 1 })
  const [poke, setPoke] = useState(0)
  const [denied, setDenied] = useState(0)
  /** cards per buy (a stack, dealt one at a time) */
  const [count, setCount] = useState<1 | 5 | 10>(1)
  const countRef = useRef(count)
  countRef.current = count
  /** cards bought and waiting under the one on the stage */
  const [stack, setStackState] = useState<TicketData[]>([])
  const stackRef = useRef<TicketData[]>([])
  const setStack = (v: TicketData[]) => {
    stackRef.current = v
    setStackState(v)
  }
  const [stops, setStops] = useState<Stops>({ win: 0, jackpot: false })
  const stopsRef = useRef(stops)
  stopsRef.current = stops
  const [session, setSession] = useState<Session>(NO_SESSION)
  const [stageRef, size] = useSize<HTMLDivElement>({ w: 840, h: 780 })
  const lg = useMedia('(min-width: 1024px)')
  const fine = useMedia('(pointer: fine)')
  const fxCanvas = useRef<HTMLCanvasElement>(null)
  const [fx, setFx] = useState<Fx | null>(null)

  /** every card on the stage by its key (one leaving and one arriving overlap for a moment) */
  const handles = useRef(new Map<string, CardHandle>())
  const cardKeyRef = useRef('')
  /** the card in play, or on show */
  const cardNow = () => handles.current.get(cardKeyRef.current) ?? null
  /** every card bought and not paid yet: the one on the stage, then the stack */
  const pendings = useRef<Pending[]>([])
  /** the storage key of the wallet that bought them */
  const storeKey = useRef(pendingKey(null))
  const ticketRef = useRef<TicketData | null>(null)
  ticketRef.current = ticket
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase
  const betRef = useRef(bet)
  betRef.current = bet
  const cardIdRef = useRef(cardId)
  cardIdRef.current = cardId
  const speedRef = useRef(speed)
  speedRef.current = speed
  const autoRef = useRef(false)
  const alive = useRef(true)
  const seq = useRef(1)
  /** the autoplay round waiting for its card to finish */
  const roundDone = useRef<((net: number | null) => void) | null>(null)
  const revealedCells = useRef<number[]>([])
  /** the Frenzy spot of the card in play is out */
  const bonusOut = useRef(false)
  const timers = useRef<number[]>([])
  const roll = useRef<(() => void) | null>(null)
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  /** the cards still owed, written down (an empty list clears the entry) */
  const storeOwed = () => {
    const list = pendings.current
    if (!list.length) safeStorage.removeItem(storeKey.current)
    else safeStorage.setItem(storeKey.current, JSON.stringify({ v: 2, cards: list.map((p) => ({ ...p, paid: false })) } satisfies Store))
  }

  /** Pays the card on the stage, once: it finished (or its celebration's coins reached the balance). */
  const settlePending = () => {
    const t = ticketRef.current
    const i = t ? pendings.current.findIndex((p) => p.ticket.key === t.key) : -1
    if (i < 0) return
    const [p] = pendings.current.splice(i, 1)
    useWallet.getState().settle({ game: 'scratch', bet: p.bet, payout: p.payout, meta: p.meta })
    storeOwed()
  }

  /**
   * Pays every card still owed, each once, because the player is leaving: 'leave' (the page is going away) or 'unmount'
   * (another page of the app; a toast says what they paid). The cards are kept, marked paid, to be shown on the next visit.
   */
  const settleAll = (how: 'leave' | 'unmount') => {
    const list = pendings.current
    if (!list.length) return
    pendings.current = []
    for (const p of list) useWallet.getState().settle({ game: 'scratch', bet: p.bet, payout: p.payout, meta: p.meta })
    safeStorage.setItem(storeKey.current, JSON.stringify({ v: 2, cards: list.map((p) => ({ ...p, paid: true })) } satisfies Store))
    if (how === 'unmount') {
      const paid = round2(list.reduce((a, p) => a + p.payout, 0))
      const many = list.length > 1
      useWallet.getState().pushToast(paid > 0 ? { kind: 'win', title: many ? `Your ${list.length} unfinished scratch cards paid out` : 'Your scratch card paid out', amount: paid } : { kind: 'info', title: many ? `Your ${list.length} unfinished scratch cards had no win` : 'Your unfinished scratch card had no win' })
    }
  }

  /* ---------------- lifecycle ---------------- */

  useEffect(() => {
    alive.current = true
    const f = new Fx(fxCanvas.current!)
    setFx(f)
    return () => {
      alive.current = false
      f.dispose()
      timers.current.forEach(clearTimeout)
      roll.current?.()
      settleAll('unmount')
      roundDone.current?.(null)
      roundDone.current = null
      // no painted foil or coin brush outlives the game
      releaseFoilCaches()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fx?.resize(size.w, size.h)
  }, [fx, size.w, size.h])

  useEffect(() => safeStorage.setItem(SPEED_KEY, speed), [speed])

  // Reloading, closing the tab or going to another site with foil still on pays the card on the way out (not on a
  // mere tab switch: the header balance would give the card away).
  useEffect(() => {
    const leave = () => settleAll('leave')
    window.addEventListener('beforeunload', leave)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('pagehide', leave)
    }
    // settlePending only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Cards left behind: paid on the way out (shown again now, fully out), or never paid because their page died (paid now).
  useEffect(() => {
    if (authStatus === 'loading' || pendings.current.length) return
    const key = pendingKey(uid)
    const raw = safeStorage.getItem(key)
    if (raw == null) return
    safeStorage.removeItem(key)
    let parsed: (Store & Stored) | null = null
    try {
      parsed = JSON.parse(raw)
    } catch {
      /* a damaged entry */
    }
    if (!parsed) return
    const cards = (Array.isArray(parsed.cards) ? parsed.cards : [parsed]).filter((p) => typeof p?.bet === 'number' && typeof p.payout === 'number')
    if (!cards.length) return
    let paid = 0
    let died = false
    const shown: TicketData[] = []
    for (const p of cards) {
      if (!p.paid) {
        useWallet.getState().settle({ game: 'scratch', bet: p.bet!, payout: p.payout!, meta: { ...p.meta, recovered: true } })
        died = true
      }
      paid += p.payout!
      const t = p.ticket
      if (t && CARD_IDS.includes(t.id) && t.outcome && Array.isArray(t.outcome.board) && t.outcome.board.length === 9) shown.push({ ...t, key: seq.current++, away: true })
    }
    if (shown.length && phaseRef.current !== 'play') {
      // the card that was on the stage comes back; the rest of its stack goes in the history
      const first = shown[0]
      setMove({ kind: 'pick', dir: 1 })
      setCardId(first.id)
      cardIdRef.current = first.id
      setTicket(first)
      ticketRef.current = first
      setPhase('done')
      phaseRef.current = 'done'
      setPresent(true)
      setStampOn(true)
      setHistory((h) => [...shown].reverse().concat(h).slice(0, 16))
    }
    paid = round2(paid)
    const many = cards.length > 1 ? `${cards.length} ` : ''
    useWallet.getState().pushToast(
      paid > 0
        ? { kind: 'win', title: died ? `Your ${many}unfinished scratch card${many ? 's' : ''} paid out` : `Your ${many}scratch card${many ? 's' : ''} paid out while you were away`, amount: paid }
        : { kind: 'info', title: `Your ${many}unfinished scratch card${many ? 's' : ''} had no win` },
    )
  }, [authStatus, uid])

  /* ---------------- buying ---------------- */

  /**
   * Buys a card (or a stack of 5 or 10, paid for at once and dealt one at a time), or deals the next card of the stack.
   * Every card's prize is drawn now; they are all stored before the first shows, so even a page that never gets to pay
   * can't lose one.
   */
  const buy = (): TicketData | null => {
    if (phaseRef.current === 'play' || partyRef.current || dueRef.current) return null
    // the card on the stage, if it is still owed (a celebration cut short), pays first
    settlePending()
    const next = stackRef.current[0]
    if (next) {
      setStack(stackRef.current.slice(1))
      deal(next)
      return next
    }
    // Nothing else can still be owed here (the stage card was paid just above and the stack is empty); if anything
    // ever is, it is paid now, each card once, rather than written over by the new purchase.
    const left = pendings.current
    if (left.length) {
      pendings.current = []
      for (const p of left) useWallet.getState().settle({ game: 'scratch', bet: p.bet, payout: p.payout, meta: p.meta })
      storeOwed()
    }
    const id = cardIdRef.current
    const price = betRef.current
    // autoplay buys one card a round, whatever Manual's cards per buy says (autoRef only follows on the next render,
    // and the first round is bought before it)
    const n = autoRef.current || modeRef.current === 'auto' ? 1 : countRef.current
    const total = round2(price * n)
    if (total > useWallet.getState().balance) {
      setDenied((d) => d + 1)
      scratchSfx.denied()
      return null
    }
    if (!stake(total)) return null
    const cards: TicketData[] = []
    for (let k = 0; k < n; k++) {
      let outcome = drawCard(id, rand)
      if (import.meta.env.DEV) outcome = forced(id, outcome)
      cards.push({ key: seq.current++, id, serial: serial(), outcome, bet: price, payout: round2(price * outcome.mult) })
    }
    storeKey.current = pendingKey(uid)
    pendings.current = cards.map((t) => ({ bet: price, payout: t.payout, meta: { card: id, mult: t.outcome.mult, top: t.outcome.top }, ticket: t }))
    storeOwed()
    setStack(cards.slice(1))
    deal(cards[0])
    return cards[0]
  }

  /** puts a bought card on the stage */
  const deal = (t: TicketData) => {
    if (ticketRef.current) scratchSfx.toss()
    setMove({ kind: 'buy', dir: 1 })
    scratchSfx.buy()
    revealedCells.current = []
    bonusOut.current = false
    roll.current?.()
    roll.current = null
    timers.current.forEach(clearTimeout)
    timers.current = []
    setHintBonus(false)
    setParty(null)
    setDue(false)
    fx?.stopShower()
    fx?.puff()
    setTicket(t)
    ticketRef.current = t
    setPresent(false)
    setStampOn(false)
    setStamped(false)
    setPhase('play')
    phaseRef.current = 'play'
  }

  /* ---------------- the card's events ---------------- */

  const onReveal = (area: number) => {
    const t = ticketRef.current
    if (!t || phaseRef.current !== 'play') return
    const c = CARDS[t.id]
    if (area === BONUS_AREA) {
      bonusOut.current = true
      setHintBonus(false)
      scratchSfx.bonus(t.outcome.bonus)
      return
    }
    // the deciding cell is out: the roll stops on it
    roll.current?.()
    roll.current = null
    const s = t.outcome.board[area]
    revealedCells.current.push(area)
    const same = revealedCells.current.filter((i) => t.outcome.board[i] === s).length
    const n = revealedCells.current.length
    if (same === 3) scratchSfx.match(t.id)
    else if (same === 2 && isHot(c, s)) {
      scratchSfx.reveal(n, s === c.prizes.length - 1 ? 'top' : 'hot')
      // a hot pair with its third still covered: a shimmer of suspense (nothing after a loss)
      if (n < 9) scratchSfx.tease()
    } else if (same === 2) {
      scratchSfx.reveal(n, isPrize(c, s) ? 'prize' : 'blank')
      scratchSfx.pair(n)
    } else scratchSfx.reveal(n, !isPrize(c, s) ? 'blank' : s === c.prizes.length - 1 ? 'top' : isHot(c, s) ? 'hot' : 'prize')
    if (!sweepingRef.current) buzz(same === 3 ? [12, 40, 12] : 8)
    // the grid is out and the Frenzy spot isn't: on a win it waits to be scratched; on a loss it can't matter, so it
    // comes off by itself
    if (n === 9 && c.bonus && !bonusOut.current) {
      if (t.outcome.prize >= 0) setHintBonus(true)
      else later(380, () => ticketRef.current === t && cardNow()?.reveal(BONUS_AREA))
    }
  }

  const onDeciding = () => {
    roll.current?.()
    roll.current = scratchSfx.drumroll(speedRef.current === 'turbo' ? 0.85 : 1.5)
  }

  /** resolves the autoplay round once the result has had its moment */
  const finishRound = (t: TicketData, hold: number) => {
    later(hold, () => {
      const r = roundDone.current
      roundDone.current = null
      r?.(round2(t.payout - t.bet))
    })
  }

  const onDone = () => {
    const t = ticketRef.current
    if (!alive.current || !t || phaseRef.current !== 'play') return
    roll.current?.()
    roll.current = null
    setPhase('done')
    phaseRef.current = 'done'
    setPresent(true)
    setHistory((h) => [t, ...h].slice(0, 16))
    fx?.puff()
    const o = t.outcome
    if (autoRef.current) {
      setSession((s) => ({ played: s.played + 1, won: s.won + (o.mult > 0 ? 1 : 0), net: s.net + t.payout - t.bet, best: Math.max(s.best, o.mult) }))
      const st = stopsRef.current
      if ((st.win > 0 && o.mult >= st.win) || (st.jackpot && o.top)) auto.stop()
    }
    const k = speedRef.current === 'instant' ? 0.3 : speedRef.current === 'turbo' ? 0.6 : 1
    if (celebrates(o)) {
      // the celebration pays when its coins reach the balance; the stamp lands after it. Until it starts, the card can't
      // be put away (by a pick in the rack, a swipe or a buy): it is still owed, and its moment is still to come.
      setDue(true)
      later(speedRef.current === 'instant' ? 250 : 720, () => {
        if (!alive.current) return
        if (ticketRef.current === t) startParty(t)
        else setDue(false)
      })
      return
    }
    settlePending()
    if (o.prize < 0) scratchSfx.lose()
    // a win has just been circled: the stamp waits for the copies to land in the table
    later(o.prize < 0 ? 120 : speedRef.current === 'instant' ? 300 : 650, () => alive.current && ticketRef.current === t && setStampOn(true))
    const tier = winTier(o.mult)
    finishRound(t, (o.prize < 0 ? 750 : [0, 900, 1100, 1500, 1900][tier] ?? 1900) * k)
  }

  /** the stamp landed: the jolt, the fanfare and the coins */
  const onStamp = () => {
    const t = ticketRef.current
    const card = cardNow()
    setStamped(true)
    if (!t || !card) return
    const o = t.outcome
    const won = o.prize >= 0
    const tier = winTier(o.mult)
    scratchSfx.stamp(!won ? 'lose' : tier <= 1 ? 'back' : 'win')
    card.jolt(!won ? 0.5 : tier <= 1 ? 0.4 : Math.min(2.2, 0.8 + tier * 0.3))
    if (!won || t.away || celebrates(o)) return
    scratchSfx.win(tier, t.id)
    buzz(tier >= 4 ? [30, 50, 60] : 22)
    const mid = card.client(GRID_X + (CELL * 3 + GAP * 2) / 2, GRID_Y + (CELL * 3 + GAP * 2) / 2)
    if (fx) {
      if (tier >= 2) fx.ring(mid.x, mid.y, 120 * (size.w < 560 ? 0.8 : 1), THEMES[t.id].win)
      const coins = tier >= 4 ? 30 : tier >= 3 ? 16 : tier >= 2 ? 7 : 0
      if (coins) {
        fx.coins(mid.x, mid.y, coins, tier >= 4 ? 1.15 : 1)
        for (let i = 0; i < Math.min(8, coins); i++) later(40 + i * 70, () => scratchSfx.coin())
      }
      for (const i of o.line) {
        const c = cellCenter(i)
        const p = card.client(c.x, c.y)
        fx.sparks(p.x, p.y, tier >= 3 ? 5 : 3, 34, THEMES[t.id].win)
      }
      if (tier >= 4) fx.confetti(36, THEMES[t.id].confetti, { cx: mid.x, cy: mid.y })
    }
  }

  const startParty = (t: TicketData) => {
    const o = t.outcome
    const card = cardNow()
    const st = stageRef.current?.getBoundingClientRect()
    const cells = o.line.map((i) => {
      const b = card?.cellBox(i)
      return b && st ? { x: b.left - st.left, y: b.top - st.top, w: b.width, h: b.height } : { x: (st?.width ?? 600) / 2 - 40, y: (st?.height ?? 600) / 2 - 40, w: 80, h: 80 }
    })
    buzz([40, 60, 40, 60, 120])
    const p: Party = { key: t.key, id: t.id, sym: symbolOf(CARDS[t.id], o.board[o.line[0]]), mult: o.mult, amount: t.payout, top: o.top, max: isMax(o), cells }
    partyRef.current = p
    setParty(p)
    setDue(false)
  }

  const closeParty = () => {
    const t = ticketRef.current
    partyRef.current = null
    setParty(null)
    fx?.stopShower()
    settlePending()
    setStampOn(true)
    if (t) finishRound(t, 450)
  }

  /* ---------------- reveal all, autoplay ---------------- */

  const revealAll = async () => {
    if (phaseRef.current !== 'play' || sweepingRef.current) return
    setSweeping(true)
    sweepingRef.current = true
    try {
      await cardNow()?.revealAll(speedRef.current)
    } finally {
      if (alive.current) setSweeping(false)
      sweepingRef.current = false
    }
  }

  const round = async (): Promise<number | null> => {
    const t = buy()
    if (!t) return null
    const result = new Promise<number | null>((res) => (roundDone.current = res))
    // let the new card slide in first (and make sure it is the one on the stage before the coin goes to work: the card
    // it replaces is still there, on its way out)
    await new Promise((r) => setTimeout(r, speedRef.current === 'instant' ? 70 : speedRef.current === 'turbo' ? 280 : 520))
    const onStage = () => cardKeyRef.current === `t${t.key}` && !!cardNow()
    for (let i = 0; i < 40 && alive.current && !onStage(); i++) await new Promise((r) => setTimeout(r, 50))
    if (!alive.current) return null
    if (!onStage()) {
      // never seen to arrive: autoplay stops and the card stays in play, to be scratched by hand
      roundDone.current = null
      return null
    }
    setSweeping(true)
    sweepingRef.current = true
    try {
      await cardNow()?.revealAll(speedRef.current)
    } finally {
      if (alive.current) setSweeping(false)
      sweepingRef.current = false
    }
    return result
  }

  const auto = useAutoBet(round, speed === 'instant' ? 40 : speed === 'turbo' ? 150 : 350)
  autoRef.current = auto.running
  const locked = phase === 'play' || auto.running || !!party || due || stack.length > 0
  const startAuto = () => {
    setSession(NO_SESSION)
    void auto.start()
  }

  const pick = (id: CardId) => {
    if (id === cardIdRef.current || phaseRef.current === 'play' || autoRef.current || partyRef.current || dueRef.current || stackRef.current.length) return
    scratchSfx.pick(id)
    setMove({ kind: 'pick', dir: CARD_IDS.indexOf(id) > CARD_IDS.indexOf(cardIdRef.current) ? 1 : -1 })
    setCardId(id)
    cardIdRef.current = id
    safeStorage.setItem(CARD_KEY, id)
    // a finished card makes way for the new one on display (paid first, should it somehow still be owed)
    if (phaseRef.current === 'done') {
      settlePending()
      fx?.puff()
      setTicket(null)
      ticketRef.current = null
      setPhase('idle')
      setPresent(false)
      setStampOn(false)
    }
  }
  const swipe = (dir: number) => pick(CARD_IDS[(CARD_IDS.indexOf(cardIdRef.current) + dir + CARD_IDS.length) % CARD_IDS.length])

  // Space: buy, reveal everything, or buy another (and start or stop autoplay in Auto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.code !== 'Space' || info || viewing || party) return
      e.preventDefault()
      if (e.repeat) return
      if (mode === 'auto') {
        if (auto.running) auto.stop()
        else if (phaseRef.current !== 'play' && bet <= balance) startAuto()
        else if (bet > balance) {
          setDenied((d) => d + 1)
          scratchSfx.denied()
        }
        return
      }
      if (phaseRef.current === 'play') void revealAll()
      else buy()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- layout ---------------- */

  // Three ways to lay the stage out: the rack in a column beside the card (wide), in a row above it (narrow), or a
  // column of chips on the left and the button on the right (short landscape). Below the lg breakpoint the panel sits
  // under the stage, so the stage carries its own button bar.
  const W = size.w
  const H = size.h
  const bar = !lg
  const fit = (w: number, h: number) => Math.max(0.3, Math.min(w / CARD_W, h / CARD_H, 1.6))
  const land = !lg && H < 470 && W >= 540 && W > H * 1.2
  // the button, and the session strip over it during autoplay
  const barH = 64 + (mode === 'auto' && (auto.running || session.played > 0) ? 36 : 0)
  const sideRackW = Math.min(236, Math.max(196, W * 0.24))
  const sideScale = fit(W - sideRackW - 26 - 56, H - 48 - (bar ? barH + 8 : 0))
  const TOP = 86
  const topScale = fit(W - 20, H - TOP - (bar ? barH + 6 : 0) - 10)
  const layout: 'side' | 'top' | 'land' = land ? 'land' : W >= 600 && H >= 460 && sideScale >= topScale * 0.97 ? 'side' : 'top'
  const landL = 128
  const landR = Math.min(220, Math.max(160, W * 0.24))
  const scale = layout === 'side' ? sideScale : layout === 'top' ? topScale : fit(W - landL - landR - 28, H - 16)
  const cardW = Math.ceil(CARD_W * scale)
  const cardH = Math.ceil(CARD_H * scale)
  const gap = 26
  const left0 = layout === 'side' ? Math.max(24, Math.round((W - sideRackW - gap - cardW) / 2)) : 0
  const cardBox =
    layout === 'side'
      ? { left: left0 + sideRackW + gap, top: 24, width: cardW, height: H - 48 - (bar ? barH + 8 : 0) }
      : layout === 'top'
        ? { left: 10, top: TOP, width: W - 20, height: H - TOP - (bar ? barH + 6 : 0) - 10 }
        : { left: landL + 10, top: 8, width: W - landL - landR - 28, height: H - 16 }
  // where the card sits inside its box (it is centred), for the pills laid over it
  const cardX = cardBox.left + (cardBox.width - cardW) / 2
  const cardY = cardBox.top + (cardBox.height - cardH) / 2

  /* ---------------- panel ---------------- */

  const card = CARDS[cardId]
  const shownTicket = ticket && ticket.id === cardId ? ticket : null
  const pills = useMemo(
    () =>
      history.map((h) => {
        const tone: PillTone = h.outcome.mult === 0 ? 'loss' : h.outcome.top ? 'gold' : 'win'
        return {
          key: h.key,
          tone,
          onClick: () => (sfx.click(), setViewing(h)),
          label: (
            <span className="flex items-center gap-1">
              <CardDot id={h.id} />
              {h.outcome.mult ? multLabel(h.outcome.mult) : '–'}
            </span>
          ),
        }
      }),
    [history],
  )

  const n = mode === 'auto' ? 1 : count
  const total = round2(bet * n)
  const maxCard = Math.floor((balance / n) * 100) / 100
  const short = total > balance && phase !== 'play' && !auto.running && !stack.length
  const primary: { label: string; sub?: string; tone: 'accent' | 'gold' | 'danger' | 'neutral'; onClick: () => void; disabled?: boolean } = auto.running
    ? { label: 'Stop autoplay', sub: auto.left != null ? `${auto.left} left` : 'Until stopped', tone: 'danger', onClick: auto.stop }
    : phase === 'play'
      ? { label: sweeping ? 'Scratching…' : 'Reveal all', sub: sweeping ? `${card.name}` : 'or scratch it yourself', tone: 'gold', onClick: () => void revealAll(), disabled: sweeping }
      : short
        ? maxCard >= MIN_BET
          ? { label: 'Not enough coins', sub: `${n > 1 ? `Max ${n} cards at ` : 'Max card '}${fmt(maxCard)} · tap to set`, tone: 'neutral', onClick: () => (sfx.click(), setBet(maxCard)) }
          : { label: 'Not enough coins', sub: 'Get free coins in Rewards', tone: 'neutral', onClick: () => navigate('/rewards') }
        : mode === 'auto'
          ? { label: 'Start autoplay', sub: `${card.name} · ${fmt(bet)} a card`, tone: 'accent', onClick: startAuto, disabled: !!party || due }
          : stack.length
            ? { label: 'Next card', sub: `${stack.length} more in your stack · paid`, tone: 'accent', onClick: () => void buy(), disabled: !!party || due }
            : n > 1
              ? { label: phase === 'done' ? `Buy ${n} more` : `Buy ${n} cards`, sub: `${card.name} · ${n} × ${fmt(bet)} = ${fmt(total)}`, tone: 'accent', onClick: () => void buy(), disabled: !!party || due }
              : { label: phase === 'done' ? 'Buy another' : 'Buy card', sub: `${card.name} · ${fmt(bet)}`, tone: 'accent', onClick: () => void buy(), disabled: !!party || due }

  const action = (
    <motion.div key={denied} animate={denied ? { x: [0, -9, 9, -6, 6, -3, 0] } : undefined} transition={{ duration: 0.38 }} className="relative" style={{ animation: poke && layout === 'top' ? 'scr-wiggle .5s ease-in-out' : undefined }}>
      <ActionButton tone={primary.tone} onClick={primary.onClick} disabled={primary.disabled} sub={primary.sub}>
        {primary.label}
      </ActionButton>
    </motion.div>
  )

  const panel = (
    <>
      <MemoModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <PriceControl value={bet} onChange={setBet} disabled={locked} balance={balance} />
      {mode === 'manual' && <CountControl value={count} onChange={setCount} disabled={locked} price={bet} />}
      <div className={`rounded-lg bg-stage px-3 py-2.5 ${mode === 'auto' ? 'hidden' : ''}`}>
        <div className="flex items-center gap-3">
          <CardThumb id={cardId} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-extrabold">{card.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 truncate text-[11.5px] font-semibold text-dim">
              <RiskMeter id={cardId} size="sm" /> {card.risk} risk
            </div>
          </div>
          <button onClick={() => (sfx.click(), setInfo(true))} className="shrink-0 rounded-md bg-raised px-2.5 py-1.5 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
            How to play
          </button>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 text-[10.5px] font-semibold text-dim">
          <div className="rounded-md bg-panel2 px-2 py-1.5">
            Wins
            <div className="tnum whitespace-nowrap text-[13px] font-extrabold text-ink">{oddsLabel(hitChance(card))}</div>
          </div>
          <div className="rounded-md bg-panel2 px-2 py-1.5">
            Top prize
            <div className="tnum flex items-center gap-1 whitespace-nowrap text-[13px] font-extrabold text-gold">
              {fmt(topCoins(cardId, bet), topCoins(cardId, bet) >= 1000 ? 0 : 2)} <Coin size={11} />
            </div>
          </div>
        </div>
      </div>
      <SpeedControl value={speed} onChange={setSpeed} disabled={auto.running} />
      {mode === 'auto' && <AutoSettings auto={auto} />}
      {mode === 'auto' && <AutoStops stops={stops} onChange={setStops} disabled={auto.running} />}
      {mode === 'auto' && (auto.running || session.played > 0) && <SessionStrip s={session} />}
      <div className="max-lg:hidden lg:mt-auto">{action}</div>
      {mode === 'manual' && <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Scratch the foil with the mouse, or press Space to buy and to reveal everything. Every card pays back 96% on average.</p>}
    </>
  )

  /* ---------------- stage ---------------- */

  const cardMode = shownTicket ? (phase === 'play' ? 'play' : 'done') : 'display'
  const cardKey = shownTicket ? `t${shownTicket.key}` : `d-${cardId}`
  cardKeyRef.current = cardKey
  const pokeTip = poke > 0
  useEffect(() => {
    if (!poke) return
    const id = window.setTimeout(() => setPoke(0), 1700)
    return () => clearTimeout(id)
  }, [poke])
  const onPoke = () => {
    if (auto.running || party) return
    setPoke((p) => p + 1)
    sfx.click()
  }
  const showBuyAnother = layout === 'side' && !bar && phase === 'done' && stamped && mode === 'manual' && !party && !auto.running

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden">
      <style>{CSS}</style>
      <Backdrop id={cardId} />

      {/* the rack */}
      {layout === 'side' ? (
        <div className="absolute flex flex-col justify-center gap-2" style={{ left: left0, width: sideRackW, top: 0, bottom: bar ? barH + 8 : 0 }}>
          <div className="mb-0.5 flex items-baseline justify-between pl-1 pr-0.5 text-[11px] font-extrabold uppercase tracking-[.16em] text-white/55">
            Pick a card
            <span className="tnum flex items-center gap-1 text-[11px] normal-case tracking-normal text-white/70">
              {fmt(bet)} <Coin size={10} /> each
            </span>
          </div>
          {CARD_IDS.map((id) => (
            <RackTile key={id} id={id} on={id === cardId} price={bet} disabled={locked && id !== cardId} onPick={() => pick(id)} />
          ))}
        </div>
      ) : layout === 'top' ? (
        <div className="absolute inset-x-0 top-0 px-2.5 pt-2">
          <div className="grid grid-cols-4 gap-1.5">
            {CARD_IDS.map((id) => (
              <RackChip key={id} id={id} on={id === cardId} price={bet} disabled={locked && id !== cardId} onPick={() => pick(id)} />
            ))}
          </div>
          <div className="mt-1.5 flex h-[24px] items-center gap-2">
            <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-black/30 px-2 py-[3px] text-[11px] font-bold text-white/80">
              <RiskMeter id={cardId} size="sm" />
              <span className="tnum">Wins {oddsLabel(hitChance(card))}</span>
            </span>
            <MemoHistoryPills className="min-w-0 flex-1 justify-end [&>*]:!px-2 [&>*]:!py-1 [&>*]:!text-[11px] [mask-image:linear-gradient(to_left,#000_80%,transparent)]" items={pills.slice(0, 8)} />
          </div>
        </div>
      ) : (
        <div className="absolute flex flex-col justify-center gap-1.5" style={{ left: 8, width: landL, top: 8, bottom: 8 }}>
          {CARD_IDS.map((id) => (
            <RackChip key={id} id={id} on={id === cardId} price={bet} disabled={locked && id !== cardId} onPick={() => pick(id)} tall />
          ))}
        </div>
      )}

      {/* recent cards (a tap shows the ticket again) */}
      {layout === 'side' && (
        <div className="absolute right-0 top-0 z-10 flex max-w-[45%] justify-end p-3">
          <MemoHistoryPills className="justify-end [mask-image:linear-gradient(to_left,#000_80%,transparent)]" items={pills} />
        </div>
      )}

      {/* the cards still to come in a stack, peeking out under the one on the stage */}
      <AnimatePresence>
        {stack.slice(0, 3).map((t, i) => (
          <motion.div
            key={t.key}
            className="pointer-events-none absolute"
            style={{ left: cardX, top: cardY, width: cardW, height: cardH, borderRadius: 22 * scale, background: `linear-gradient(${THEMES[t.id].paper[0]}, ${THEMES[t.id].paper[1]})`, boxShadow: `inset 0 0 0 ${Math.max(1.5, 3 * scale)}px ${THEMES[t.id].table.edge}, 0 10px 24px -10px rgba(0,0,0,.7)` }}
            initial={{ opacity: 0, x: 0, y: 0, rotate: 0 }}
            animate={{ opacity: 1, x: (i + 1) * 7 * Math.min(1, scale + 0.2), y: (i + 1) * 5 * Math.min(1, scale + 0.2), rotate: (i + 1) * 1.4 }}
            exit={{ opacity: 0, y: -30, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          />
        ))}
      </AnimatePresence>
      {stack.length > 0 && (
        <div className="tnum pointer-events-none absolute z-20 flex h-7 min-w-7 items-center justify-center rounded-full px-2 text-[12.5px] font-extrabold text-[#1a1000] shadow-[0_4px_12px_rgba(0,0,0,.5)]" style={{ left: Math.min(cardX + cardW - 4, W - 38), top: cardY + cardH * 0.5, background: THEMES[cardId].win }}>
          +{stack.length}
        </div>
      )}

      {/* the card */}
      <div className="absolute" style={cardBox}>
        <AnimatePresence initial={false} custom={move}>
          <motion.div
            key={cardKey}
            className="absolute inset-0 flex items-center justify-center"
            custom={move}
            variants={CARD_MOTION}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          >
            <ScratchCard
              ref={(h) => {
                if (h) handles.current.set(cardKey, h)
                else handles.current.delete(cardKey)
              }}
              id={shownTicket?.id ?? cardId}
              serial={shownTicket?.serial ?? ''}
              outcome={shownTicket?.outcome ?? null}
              price={shownTicket?.bet ?? bet}
              amount={shownTicket?.payout ?? 0}
              away={shownTicket?.away}
              mode={cardMode}
              scale={scale}
              fx={fx}
              present={!!shownTicket && present}
              stampOn={stampOn}
              interactive={cardMode === 'play' && !sweeping && !auto.running}
              hintBonus={hintBonus && cardMode === 'play'}
              onReveal={onReveal}
              onDone={onDone}
              onStamp={onStamp}
              onDeciding={onDeciding}
              onPoke={onPoke}
              onSwipe={swipe}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* the buy pill on a card on display (a real button in Auto too) */}
      <AnimatePresence>
        {cardMode === 'display' && layout !== 'top' && !auto.running && (
          <motion.div
            key="nudge"
            className="pointer-events-none absolute z-20 flex justify-center"
            style={{ left: cardX, width: cardW, top: cardY + (GRID_Y + (CELL * 3 + GAP * 2) / 2) * scale - 22 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
          >
            <div className="relative" style={{ animation: pokeTip ? 'scr-wiggle .5s ease-in-out' : undefined }} key={poke}>
              <motion.button
                onClick={() => (mode === 'auto' ? startAuto() : void buy())}
                disabled={!!party}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                className="tnum pointer-events-auto flex items-center gap-2 whitespace-nowrap rounded-full bg-[#08121b]/85 py-1.5 pl-1.5 pr-4 text-[14px] font-extrabold text-white shadow-[0_10px_30px_-8px_rgba(0,0,0,.8)] ring-1 ring-white/15 backdrop-blur-sm transition-colors hover:bg-[#0c1a26]/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={`rounded-full px-3 py-1 text-[13px] ${short ? 'bg-raised text-ink' : 'bg-accent text-[#032412]'}`}>{short ? 'Need' : mode === 'auto' ? 'Start autoplay' : n > 1 ? `Buy ×${n}` : 'Buy'}</span>
                {fmt(total)} <Coin size={15} />
              </motion.button>
              <AnimatePresence>
                {pokeTip && (
                  <motion.div key="tip" className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-[12px] font-extrabold text-[#0b1822] shadow-lg" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                    {short ? 'Not enough coins for this card' : 'Buy the card to scratch it'}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* desktop: buy another, right on the card, once the stamp is down */}
      <AnimatePresence>
        {showBuyAnother && (
          <motion.div key="again" className="absolute z-20 flex justify-center" style={{ left: cardX, width: cardW, top: cardY + cardH - 26 }} initial={{ opacity: 0, y: 14, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }} transition={{ type: 'spring', stiffness: 420, damping: 26 }}>
            <motion.button
              onClick={() => void buy()}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              className={`tnum flex items-center gap-2 whitespace-nowrap rounded-full py-2 pl-4 pr-4 text-[14px] font-extrabold shadow-[0_12px_30px_-8px_rgba(0,0,0,.85)] ring-2 ring-black/20 ${short ? 'bg-raised text-ink' : 'bg-accent text-[#032412]'}`}
            >
              {stack.length ? (
                <>
                  Next card <span className="opacity-60">·</span> {stack.length} left
                </>
              ) : (
                <>
                  {short ? 'Not enough coins' : n > 1 ? `Buy ${n} more` : 'Buy another'} <span className="opacity-60">·</span> {fmt(total)} <Coin size={14} />
                </>
              )}
              <span className="ml-1 rounded bg-black/15 px-1.5 py-[1px] text-[10.5px] font-bold">Space</span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* the stage's own button bar, under the card (the panel is under the stage) */}
      {bar && layout !== 'land' && (
        <div className="absolute z-20 flex flex-col gap-1.5" style={layout === 'side' ? { left: Math.max(10, cardX - 20), width: Math.min(W - 20 - Math.max(10, cardX - 20), cardW + 40), bottom: 10 } : { left: 10, right: 10, bottom: 10 }}>
          {mode === 'auto' && (auto.running || session.played > 0) && <SessionStrip s={session} compact />}
          {action}
          <AnimatePresence>
            {pokeTip && layout === 'top' && (
              <motion.div key="tip" className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-white px-2.5 py-1 text-[12px] font-extrabold text-[#0b1822] shadow-lg" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {short ? 'Not enough coins for this card' : 'Tap Buy card to play'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
      {layout === 'land' && (
        <div className="absolute z-20 flex flex-col justify-center gap-2" style={{ right: 10, width: landR - 10, top: 8, bottom: 8 }}>
          <div className="text-center text-[12px] font-extrabold text-white/85">{card.name}</div>
          <div className="tnum flex items-center justify-center gap-1.5 text-[11px] font-bold text-white/60">
            <RiskMeter id={cardId} size="sm" /> Wins {oddsLabel(hitChance(card))}
          </div>
          {mode === 'auto' && (auto.running || session.played > 0) && <SessionStrip s={session} compact />}
          {action}
          <MemoHistoryPills className="justify-center [&>*]:!px-2 [&>*]:!py-1 [&>*]:!text-[11px]" items={pills.slice(0, 3)} />
        </div>
      )}

      {/* the celebration: its backdrop under the particles, its words over them */}
      <AnimatePresence>{party && <Celebration key={party.key} party={party} fx={fx} phone={W < 560} desk={fine} quick={autoRef.current && speed !== 'normal'} stage={stageRef.current} onSettle={() => settlePending()} onClose={closeParty} />}</AnimatePresence>
      <canvas ref={fxCanvas} className="pointer-events-none absolute left-0 top-0 z-40" />
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="scr-shell" />
      <AnimatePresence>{info && <PrizeModal initial={cardId} bet={bet} onClose={() => setInfo(false)} />}</AnimatePresence>
      <AnimatePresence>{viewing && <TicketModal t={viewing} onClose={() => setViewing(null)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

function CardDot({ id }: { id: CardId }) {
  return <span className="inline-block h-2 w-2 rounded-full" style={{ background: THEMES[id].table.edge, boxShadow: `0 0 0 1.5px ${THEMES[id].paper[0]}` }} />
}
