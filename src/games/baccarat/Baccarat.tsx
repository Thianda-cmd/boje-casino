import { memo, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, type AnimationPlaybackControls } from 'framer-motion'
import { ActionButton, GameShell, Label, Toggle, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { CardBack, CardFace } from '../../art/Card'
import { Chip } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { baccaratSfx } from './sound'
import { useSize } from '../../lib/useSize'
import { useWallet } from '../../store/wallet'
import { useAuth } from '../../store/auth'
import { Kbd, Shoe } from '../blackjack/table'
import { BetLayout, DESK_BOX, PHONE_BOX, type Leaving } from './BetLayout'
import { SIDE_COLOR, Scoreboard } from './Scoreboard'
import { Slot, TableCard, type CardMode } from './TableCard'
import {
  BET_INFO,
  BET_KEYS,
  SHOE_SIZE,
  betTotal,
  dealRound,
  handTotal,
  newShoe,
  outcomeOf,
  payBets,
  toEntry,
  type BetKey,
  type BetOutcome,
  type Bets,
  type Card,
  type RoadEntry,
  type Round,
  type Shoe as ShoeState,
  type Side,
  type Winner,
} from './rules'
import { clearPending, loadTable, loadTurbo, pendingKey, saveTable, savePending, saveTurbo, takePending, type PendingRound } from './storage'

/*
  Punto Banco. Chips go on the layout, Deal plays the round from an 8-deck shoe: the cards glide out of the shoe in
  order, the second card of each hand and any third card are squeezed (turbo or a tap turns them straight over),
  and the layout pays: losing chips go to the dealer, winnings slide in beside the winning stakes, then everything
  comes back to the player. The round is decided and stored the moment it is dealt, and settled once: when the last
  card is shown, or straight away if the player leaves mid-deal.
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000]
/* The pieces that don't change while cards are dealt skip those renders: the scoreboard and the layout, and the turbo
   toggle, whose framer layout animation would otherwise measure the page on every card. */
const MemoToggle = memo(Toggle)
const MemoScoreboard = memo(Scoreboard)
const MemoBetLayout = memo(BetLayout)
const WIN_NAME = { P: 'player', B: 'banker', T: 'tie' } as const
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'

type Phase = 'bet' | 'shuffle' | 'deal' | 'done'
interface OnTable {
  card: Card
  side: Side
  slot: number
  mode: CardMode
  flipInFlight: boolean
}
interface ResultView {
  id: number
  winner: Winner
  natural: boolean
  pPair: boolean
  bPair: boolean
  bet: number
  payout: number
  /** every bet on the layout pushed (a Tie with only Player and Banker bets) */
  push: boolean
}

/** what the scoreboard shows of the shoe; `extra` adds back the cards of a round still being dealt */
const shoeView = (s: ShoeState | null, extra = 0) =>
  s ? { left: s.cards.length + extra, size: SHOE_SIZE, cutAt: s.cutAt, lastHand: s.cutOut && !s.finished && !extra } : null

/** totals of the cards that are face up */
function shownTotals(cards: OnTable[]) {
  const t = { P: null as number | null, B: null as number | null }
  for (const side of ['P', 'B'] as const) {
    const up = cards.filter((c) => c.side === side && c.mode === 'up')
    if (up.length) t[side] = handTotal(up.map((c) => c.card))
  }
  return t
}

/**
 * Where everything sits on a stage of W × H. `bar` puts the chip rack and Deal at the bottom of the stage, for
 * layouts where the side panel sits below the table.
 */
function geometry(W: number, H: number, bar: boolean) {
  const phone = W < 560
  const pad = phone ? 8 : 16
  const box = phone ? PHONE_BOX : DESK_BOX
  const barH = bar ? 52 : 0
  const layW = phone ? W - 12 : Math.min(W - pad * 2, 1040)
  const layH = Math.min((layW * box.vh) / box.vw, H * 0.34)
  const layTop = H - (bar ? 12 : pad) - barH - layH
  const sbH = phone ? 76 : 120
  const handsTop = pad + sbH + (phone ? 10 : 16)
  const handsBot = layTop - (phone ? 8 : 12)
  const region = handsBot - handsTop
  const labelH = phone ? 28 : 34
  // the two cards of a hand: side by side on wide screens, slightly overlapped on phones
  const step = phone ? 0.84 : 1.08
  const midMin = phone ? 14 : 60
  const tuckK = 0.18
  const bannerH = 44
  const fit = (reserve: number) =>
    Math.max(36, Math.floor(Math.min((W - pad * 2 - midMin) / (2 * (1 + step)), (region - labelH - 6 - reserve) / (2.4 - tuckK), phone ? 96 : 168)))
  const midFor = (c: number) => Math.max(midMin, Math.min(phone ? 30 : 280, W - pad * 2 - c * (1 + step) * 2))
  // the result banner goes between the hands when there is room, otherwise under them, which needs its own strip
  let cw = fit(0)
  const bannerMid = midFor(cw) >= 200
  if (!bannerMid) cw = fit(bannerH)
  const ch = Math.round(cw * 1.4)
  const hw = cw * (1 + step)
  const mid = midFor(cw)
  const pX = W / 2 - mid / 2 - hw / 2
  const bX = W / 2 + mid / 2 + hw / 2
  const tuck = cw * tuckK
  const blockH = labelH + ch + cw - tuck + (bannerMid ? 0 : bannerH)
  const spare = Math.max(0, region - blockH)
  const labelTop = handsTop + spare * (phone ? 0.2 : 0.45)
  const cardsTop = labelTop + labelH
  const blockBot = cardsTop + ch + cw - tuck
  const banner = bannerMid ? { x: W / 2, y: cardsTop + ch * 0.5 } : { x: W / 2, y: Math.min(blockBot + bannerH / 2 + Math.max(0, (handsBot - blockBot - bannerH) / 2), handsBot - bannerH / 2 + 4) }
  // the shoe peeks in from the top-right corner, a little smaller than the cards on the felt
  const shoeCw = Math.round(cw * (phone ? 0.7 : 0.8))
  const shoeCh = Math.round(shoeCw * 1.4)
  const shoeRoom = shoeCw * 0.95
  const slot = (side: Side, i: number) => {
    const cx = side === 'P' ? pX : bX
    if (i < 2) return { left: cx - hw / 2 + i * cw * step, top: cardsTop, sideways: false }
    // the third card lies sideways, tucked under the first two
    const cy = cardsTop + ch + cw / 2 - tuck
    return { left: cx - cw / 2, top: cy - ch / 2, sideways: true }
  }
  return {
    phone,
    bar,
    pad,
    box,
    barH,
    layW,
    layH,
    layTop,
    layLeft: (W - layW) / 2,
    sbH,
    sbW: W - pad * 2 - shoeRoom,
    handsTop,
    handsBot,
    labelH,
    labelTop,
    cardsTop,
    cw,
    ch,
    hw,
    pX,
    bX,
    banner,
    bannerMid,
    slot,
    shoeCw,
    shoeCh,
    // the mouth of the shoe, where cards come out
    shoe: { x: W - shoeCw * 0.5, y: shoeCh * 0.52 },
  }
}

export default function Baccarat() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [saved] = useState(loadTable)
  const shoe = useRef<ShoeState | null>(saved.shoe)
  /** every result of this shoe, including a round still being dealt */
  const model = useRef<RoadEntry[]>(saved.hist)
  const [hist, setHist] = useState<RoadEntry[]>(saved.hist)
  const [shoeInfo, setShoeInfo] = useState(() => shoeView(saved.shoe))

  const [chip, setChip] = useState(10)
  const [bets, setBets] = useState<Bets>({})
  const [undo, setUndo] = useState<{ key: BetKey; amount: number }[]>([])
  const [last, setLast] = useState<Bets | null>(null)
  const [wins, setWins] = useState<Bets>({})
  const [leaving, setLeaving] = useState<Leaving>('player')
  const [outcomes, setOutcomes] = useState<Partial<Record<BetKey, BetOutcome>> | null>(null)
  const [shake, setShake] = useState<{ key: BetKey; n: number } | null>(null)

  const [phase, setPhaseState] = useState<Phase>('bet')
  // the phase as of now, for the money path: two presses handled before React re-renders must not deal twice
  const phaseRef = useRef<Phase>('bet')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [table, setTable] = useState<OnTable[]>([])
  const [shown, setShown] = useState<{ P: number | null; B: number | null }>({ P: null, B: null })
  const [lifted, setLifted] = useState<number | null>(null)
  const [result, setResult] = useState<ResultView | null>(null)
  const [shuffling, setShuffling] = useState<{ burn: Card; count: number; id: number } | null>(null)
  const [turbo, setTurboState] = useState(loadTurbo)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const setTurbo = useCallback((on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }, [])

  const [stageRef, size] = useSize<HTMLDivElement>()
  // below the lg breakpoint the side panel sits under the table, so the chips and Deal move onto the table
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)')
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const G = geometry(size.w, size.h, !wide || size.w < 560)

  /* ---------------- round machinery ---------------- */

  const peel = useMotionValue(0)
  const peelCtl = useRef<AnimationPlaybackControls | null>(null)
  const peelDone = useRef<(() => void) | null>(null)
  const hurry = useRef(false)
  const run = useRef(0)
  const alive = useRef(true)
  const timers = useRef<number[]>([])
  const cards = useRef<OnTable[]>([])
  const pending = useRef<(PendingRound & { key: string }) | null>(null)

  /** Pays the round in play, once: when its last card is shown, or as soon as the player leaves (it is decided). */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    clearPending(p.key)
    useWallet.getState().settle({ game: 'baccarat', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  useEffect(() => {
    alive.current = true
    // reloading or closing the tab mid-deal pays the round on the way out, as leaving the page does
    window.addEventListener('beforeunload', settlePending)
    window.addEventListener('pagehide', settlePending)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', settlePending)
      window.removeEventListener('pagehide', settlePending)
      timers.current.forEach(clearTimeout)
      timers.current = []
      peelCtl.current?.stop()
      settlePending()
    }
    // settlePending only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a round whose page went away before it could pay is paid on the next visit, once sign-in has settled so it lands
  // in the wallet that took the stake
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
    const p = takePending(pendingKey(uid))
    if (!p) return
    useWallet.getState().settle({ game: 'baccarat', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Baccarat round paid out', amount: p.payout })
  }, [authStatus, uid])

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r))
  const live = (id: number) => alive.current && run.current === id
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const putCards = (next: OnTable[]) => {
    cards.current = next
    setTable(next)
  }
  const refreshTotals = () => setShown(shownTotals(cards.current))
  const setMode = (id: number, mode: CardMode) => putCards(cards.current.map((c) => (c.card.id === id ? { ...c, mode, flipInFlight: false } : c)))

  /** Turns a face-down card over: a squeeze, or a plain flip in turbo and once the player has asked to hurry. */
  async function reveal(cardId: number, id: number) {
    if (turboRef.current || hurry.current) {
      setMode(cardId, 'up')
      baccaratSfx.flip()
      await wait(turboRef.current ? 240 : 380)
      refreshTotals()
      return
    }
    peel.set(0)
    setMode(cardId, 'squeeze')
    setLifted(cardId)
    await wait(150)
    if (!live(id)) return
    baccaratSfx.squeeze()
    await new Promise<void>((res) => {
      peelDone.current = res
      // peek at the corner, hold a breath, then peel the rest
      peelCtl.current = animate(peel, hurry.current ? 1 : [0, 0.355, 0.39, 1], {
        duration: hurry.current ? 0.2 : 1,
        times: hurry.current ? undefined : [0, 0.4, 0.62, 1],
        ease: hurry.current ? 'easeOut' : ['easeOut', 'linear', 'easeInOut'],
        onComplete: () => res(),
      })
    })
    peelCtl.current = null
    peelDone.current = null
    if (!live(id)) return
    setMode(cardId, 'up')
    setLifted(null)
    baccaratSfx.reveal()
    refreshTotals()
    await wait(turboRef.current || hurry.current ? 120 : 240)
  }

  /** Tap or Space while dealing: finish the squeeze in hand and turn the rest straight over. */
  function hurryUp() {
    if (phaseRef.current !== 'deal' && phaseRef.current !== 'shuffle') return
    hurry.current = true
    const ctl = peelCtl.current
    if (ctl) {
      ctl.stop()
      const done = peelDone.current
      peelCtl.current = animate(peel, 1, { duration: 0.2, ease: 'easeOut', onComplete: () => done?.() })
    }
  }

  async function dealCards(id: number, round: Round, T: boolean) {
    const flight = T ? 0.3 : 0.48
    const gap = T ? 150 : 300
    const add = (o: Round['order'][number], up: boolean) => {
      const slot = cards.current.filter((c) => c.side === o.side).length
      putCards([...cards.current, { card: o.card, side: o.side, slot, mode: up ? 'up' : 'down', flipInFlight: up }])
      baccaratSfx.deal()
      if (up) later(flight * 900, refreshTotals)
    }
    // Player, Banker, Player, Banker: the first card of each hand face up, the second face down
    for (let i = 0; i < 4; i++) {
      add(round.order[i], i < 2 || T || hurry.current)
      await wait(gap)
      if (!live(id)) return
    }
    await wait(Math.max(0, flight * 1000 - gap) + (T ? 60 : 180))
    if (!live(id)) return
    refreshTotals()
    for (const side of ['P', 'B'] as const) {
      const c = cards.current.find((x) => x.side === side && x.slot === 1)
      if (c && c.mode !== 'up') await reveal(c.card.id, id)
      if (!live(id)) return
    }
    // third cards
    for (let i = 4; i < round.order.length; i++) {
      const o = round.order[i]
      const up = T || hurry.current
      add(o, up)
      await wait(flight * 1000 + (T ? 40 : 140))
      if (!live(id)) return
      if (!up) await reveal(o.card.id, id)
      else refreshTotals()
      if (!live(id)) return
    }
  }

  async function deal() {
    if (phaseRef.current === 'deal' || phaseRef.current === 'shuffle') return hurryUp()
    // after a round the layout shows last round's chips: Deal plays them again
    const placed = phase === 'done' || !betTotal(bets) ? last : bets
    const total = placed ? betTotal(placed) : 0
    if (!placed || !total) return
    if (!stake(total)) return
    const id = ++run.current
    clearTimers()
    hurry.current = false
    const T = turboRef.current

    // the round is decided and stored before anything moves, so leaving mid-deal can't change or lose it
    const fresh = !shoe.current || shoe.current.finished
    if (fresh) {
      shoe.current = newShoe(rand)
      model.current = []
    }
    const s = shoe.current!
    // dev builds only: window.__bacForce = ['3', 'K', ...] stacks the next cards (tools/baccarat-*.mjs)
    const force = import.meta.env.DEV ? (window as { __bacForce?: Card['rank'][] }).__bacForce : undefined
    if (force?.length) {
      s.cards.push(...force.map((rank, i) => ({ rank, suit: (['♥', '♠', '♦', '♣'] as const)[i % 4], id: 0 })).reverse())
      delete (window as { __bacForce?: unknown }).__bacForce
    }
    const round = dealRound(s)
    const pay = payBets(placed, round)
    const p: PendingRound = {
      bet: total,
      payout: pay.payout,
      meta: {
        winner: WIN_NAME[round.winner],
        natural: round.natural,
        tieWin: round.winner === 'T' && !!placed.tie,
        pair: round.pPair && round.bPair ? 'both' : round.pPair ? 'player' : round.bPair ? 'banker' : 'none',
      },
    }
    const key = pendingKey(uid)
    pending.current = { ...p, key }
    savePending(key, p)
    model.current = [...model.current, toEntry(round)]
    saveTable(s, model.current)

    setBets(placed)
    setUndo([])
    setLast(placed)
    setWins({})
    setOutcomes(null)
    setResult(null)
    setLeaving('player')
    setLifted(null)

    if (fresh) {
      setPhase('shuffle')
      putCards([])
      setShown({ P: null, B: null })
      setHist([])
      setShoeInfo(shoeView(s, round.order.length))
      setShuffling({ burn: s.burn!.card, count: s.burn!.count, id })
      baccaratSfx.shuffle()
      await wait(T ? 1150 : 2350)
      if (!live(id)) return
      setShuffling(null)
      await wait(T ? 150 : 320)
    } else {
      setPhase('deal')
      if (cards.current.length) {
        putCards([])
        setShown({ P: null, B: null })
        await wait(T ? 200 : 340)
      }
    }
    if (!live(id)) return
    setPhase('deal')
    await dealCards(id, round, T)
    if (!live(id)) return
    finish(round, placed, pay)
  }

  function finish(round: Round, placed: Bets, pay: ReturnType<typeof payBets>) {
    settlePending()
    const total = betTotal(placed)
    const T = turboRef.current
    setHist(model.current)
    setShoeInfo(shoeView(shoe.current))
    setLifted(null)
    setPhase('done')
    // light every winning area, and the pushes the player has chips on
    const outs: Partial<Record<BetKey, BetOutcome>> = {}
    for (const k of BET_KEYS) {
      const o = outcomeOf(k, round)
      if (o === 'win' || placed[k]) outs[k] = o
    }
    const push = BET_KEYS.every((k) => !placed[k] || outs[k] === 'push')
    setResult({ id: run.current, winner: round.winner, natural: round.natural, pPair: round.pPair, bPair: round.bPair, bet: total, payout: pay.payout, push })
    setOutcomes(outs)
    baccaratSfx.announce(round.winner)

    // the dealer takes the losing chips, pays the winners, then the chips come back to the player
    const keep: Bets = {}
    const profit: Bets = {}
    let lost = false
    for (const k of BET_KEYS) {
      const v = placed[k]
      if (!v) continue
      if (outs[k] === 'lose') lost = true
      else keep[k] = v
      if (outs[k] === 'win') profit[k] = round2((pay.per[k] ?? 0) - v)
    }
    if (lost)
      later(T ? 120 : 420, () => {
        setLeaving('dealer')
        setBets(keep)
        baccaratSfx.collect()
      })
    if (Object.keys(profit).length)
      later(T ? 300 : 820, () => {
        setWins(profit)
        baccaratSfx.pay()
      })
    later(T ? 1250 : 2500, () => {
      setLeaving('player')
      setBets({})
      setWins({})
      if (pay.payout > 0) sfx.coin()
    })
    if (pay.payout > total) later(T ? 260 : 700, () => (pay.payout >= total * 5 ? sfx.bigWin : sfx.win)())
    else if (pay.payout === 0) later(T ? 200 : 480, sfx.lose)
  }

  /* ---------------- chips ---------------- */

  const betting = phase === 'bet' || phase === 'done'
  const total = phase === 'done' ? 0 : betTotal(bets)

  /** Leaves the last round's display behind once the player starts on the next one. */
  function freshLayout(): Bets {
    if (phase !== 'done') return bets
    clearTimers()
    setLeaving('player')
    setWins({})
    setOutcomes(null)
    setResult(null)
    setPhase('bet')
    return {}
  }

  const refuse = (key: BetKey, why: string) => {
    setShake((s) => ({ key, n: (s?.n ?? 0) + 1 }))
    pushToast({ kind: 'info', title: why })
  }

  function place(key: BetKey) {
    if (!betting) return
    const base = freshLayout()
    const cur = base[key] ?? 0
    const roomLimit = BET_INFO[key].limit - cur
    const roomCoins = round2(balance - betTotal(base))
    const add = Math.min(chip, roomLimit, roomCoins)
    if (add < 1) {
      if (phase === 'done') setBets(base)
      return refuse(key, roomLimit < 1 ? `Table limit: ${fmt(BET_INFO[key].limit, 0)} on ${BET_INFO[key].name}` : NO_COINS)
    }
    baccaratSfx.chip()
    setBets({ ...base, [key]: round2(cur + add) })
    setUndo((u) => [...(phase === 'done' ? [] : u), { key, amount: add }])
  }
  // the layout gets one stable handler that always calls the latest place()
  const placeRef = useRef(place)
  placeRef.current = place
  const onPlace = useCallback((key: BetKey) => placeRef.current(key), [])

  function undoLast() {
    if (phase !== 'bet' || !undo.length) return
    const lastStep = undo[undo.length - 1]
    setUndo(undo.slice(0, -1))
    const v = round2((bets[lastStep.key] ?? 0) - lastStep.amount)
    const next = { ...bets }
    if (v > 0) next[lastStep.key] = v
    else delete next[lastStep.key]
    sfx.click()
    setBets(next)
  }

  function clear() {
    if (phase !== 'bet' || !total) return
    sfx.click()
    setLeaving('player')
    setBets({})
    setUndo([])
  }

  /** Puts `next` on the layout if the limits and the balance allow it, recording the change for undo. */
  function putBets(next: Bets) {
    const base = phase === 'done' ? {} : bets
    for (const k of BET_KEYS) if ((next[k] ?? 0) > BET_INFO[k].limit) next[k] = BET_INFO[k].limit
    if (betTotal(next) > balance) return void pushToast({ kind: 'info', title: NO_COINS })
    freshLayout()
    const steps = BET_KEYS.flatMap((key) => {
      const d = round2((next[key] ?? 0) - (base[key] ?? 0))
      return d > 0 ? [{ key, amount: d }] : []
    })
    if (!steps.length) return void pushToast({ kind: 'info', title: 'Those bets are at the table limit' })
    baccaratSfx.chip()
    setBets(next)
    setUndo((u) => [...(phase === 'done' ? [] : u), ...steps])
  }

  const canRebet = betting && !!last && !total
  const rebet = () => canRebet && putBets({ ...last })
  const doubleBase = total ? bets : last
  const canDouble = betting && !!doubleBase && betTotal(doubleBase) > 0
  const double = () => {
    if (!canDouble || !doubleBase) return
    const next: Bets = {}
    for (const k of BET_KEYS) if (doubleBase[k]) next[k] = round2(doubleBase[k]! * 2)
    putBets(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey) {
        if (k === 'z') {
          e.preventDefault()
          undoLast()
        }
        return
      }
      if (e.code === 'Space' || e.key === 'Enter') {
        // Enter on a focused button presses that button; Space always deals, as at the other tables
        const target = e.target as HTMLElement | null
        if (e.key === 'Enter' && target?.closest('button,[role=button]')) return
        e.preventDefault()
        if (!e.repeat) void deal()
      } else if (k === 'p') place(e.shiftKey ? 'pPair' : 'player')
      else if (k === 'b') place(e.shiftKey ? 'bPair' : 'banker')
      else if (k === 't') place('tie')
      else if (k === 'z' || k === 'backspace') undoLast()
      else if (k === 'c') clear()
      else if (k === 'r') rebet()
      else if (k === 'd') double()
      else if (/^[1-7]$/.test(e.key)) setChip(CHIPS[Number(e.key) - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const lastTotal = last ? betTotal(last) : 0
  const dealing = phase === 'deal' || phase === 'shuffle'
  const dealReady = (total > 0 && total <= balance) || (!total && lastTotal > 0 && lastTotal <= balance)
  const dealSub = dealing
    ? turbo
      ? undefined
      : 'Turn the cards over'
    : total > balance || (!total && lastTotal > balance)
      ? 'Not enough coins'
      : total
        ? undefined
        : last
          ? `Rebet ${fmt(lastTotal)}`
          : 'Place chips on the table'
  const dealLabel = dealing ? (turbo ? 'Dealing…' : 'Reveal') : 'Deal'

  // On a phone all seven chips share the rack beside Deal, each as wide as the rack allows; only on the narrowest
  // screens (under about 350 px) does the rack scroll instead of shrinking the chips past a comfortable tap.
  const dealW = G.phone ? 76 : 96
  const rackIn = size.w - 16 - 8 - dealW - 8
  const fit = Math.floor((rackIn - 6 * 2) / 7)
  // when they can't all fit, half of the sixth chip peeks out so the rack reads as one to swipe
  const chipBtn = !G.phone ? 40 : fit >= 30 ? Math.min(40, fit) : Math.max(30, Math.floor((rackIn - 5 * 2) / 5.5))
  const chipPicker = (compact: boolean) =>
    CHIPS.map((v, i) => (
      <button
        key={v}
        onClick={() => (sfx.click(), setChip(v))}
        style={compact ? { width: chipBtn } : undefined}
        className={`flex shrink-0 items-center justify-center transition ${compact ? 'h-10 rounded-md' : 'rounded-lg py-1.5'} ${
          chip === v ? (compact ? 'bg-white/15 ring-2 ring-accent' : 'bg-hover ring-2 ring-accent') : compact ? '' : 'hover:bg-raised'
        }`}
        aria-label={`${v} coin chip`}
        aria-pressed={chip === v}
        title={compact ? undefined : `${v} (${i + 1})`}
      >
        <motion.span animate={{ y: chip === v && !compact ? -2 : 0 }}>
          <Chip value={v} size={compact ? Math.min(30, chipBtn - 4) : 38} />
        </motion.span>
      </button>
    ))

  const panel = (
    <>
      <div className={G.bar ? 'hidden' : ''}>
        <Label right={<>{fmt(balance)}</>}>Chip value</Label>
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-stage p-2">{chipPicker(false)}</div>
      </div>
      <div className="rounded-lg bg-stage px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-muted">Total bet</span>
          <span className="tnum flex items-center gap-1.5 text-[16px] font-extrabold">
            {fmt(dealing ? lastTotal : total)} <Coin size={16} />
          </span>
        </div>
        <div className="mt-1.5 text-balance text-[11px] font-semibold text-dim">
          Limits: Player and Banker {fmt(BET_INFO.player.limit, 0)}, Tie {fmt(BET_INFO.tie.limit, 0)}, Pairs {fmt(BET_INFO.pPair.limit, 0)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="neutral" onClick={undoLast} disabled={phase !== 'bet' || !undo.length}>
          Undo <Kbd>Z</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={clear} disabled={phase !== 'bet' || !total}>
          Clear <Kbd>C</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={rebet} disabled={!canRebet}>
          Rebet <Kbd>R</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={double} disabled={!canDouble}>
          2× <Kbd>D</Kbd>
        </ActionButton>
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-semibold text-ink">Turbo</div>
          <div className="text-[11px] font-semibold text-dim">Faster deals, no squeeze</div>
        </div>
        <MemoToggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <div className="hidden text-[11px] font-semibold leading-relaxed text-dim lg:block">
        Keys: P, B and T bet Player, Banker and Tie, Shift+P and Shift+B the pairs, 1 to 7 pick a chip, Space deals.
      </div>
      <div className={`lg:mt-auto ${G.bar ? 'hidden' : ''}`}>
        <ActionButton onClick={dealing ? hurryUp : deal} disabled={dealing ? turbo : !dealReady} sub={dealSub}>
          {dealLabel} <Kbd>Space</Kbd>
        </ActionButton>
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const winner = result?.winner
  const vars = { ['--card-w' as string]: `${G.cw}px`, ['--card-h' as string]: `${G.ch}px` } as CSSProperties
  const handHeader = (side: Side) => {
    const x = side === 'P' ? G.pX : G.bX
    const won = winner === side || winner === 'T'
    const up = table.filter((c) => c.side === side && c.mode === 'up' && c.slot < 2)
    const pair = up.length === 2 && up[0].card.rank === up[1].card.rank
    const tone = winner === 'T' ? SIDE_COLOR.T : SIDE_COLOR[side]
    return (
      <div
        key={side}
        className={`pointer-events-none absolute flex items-center justify-center gap-2 ${side === 'B' ? 'flex-row-reverse' : ''}`}
        style={{ left: x - G.hw / 2 - 20, width: G.hw + 40, top: G.labelTop, height: G.labelH }}
      >
        <span className={`font-extrabold uppercase ${G.phone ? 'text-[11px] tracking-[.16em]' : 'text-[13px] tracking-[.22em]'}`} style={{ color: side === 'P' ? '#a9cbff' : '#ffb0bb' }}>
          {side === 'P' ? 'Player' : 'Banker'}
        </span>
        <AnimatePresence mode="popLayout">
          {shown[side] != null && (
            <motion.span
              key={`${shown[side]}`}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              className={`tnum rounded-full text-center font-extrabold leading-none shadow-[0_4px_12px_-4px_rgba(0,0,0,.6)] ${G.phone ? 'min-w-8 px-2.5 py-1.5 text-[13px]' : 'min-w-10 px-3 py-1.5 text-[15px]'}`}
              style={
                won && phase === 'done'
                  ? { background: tone, color: '#fff', boxShadow: `0 0 0 2px rgba(255,255,255,.25), 0 6px 18px -4px ${tone}` }
                  : { background: 'rgba(7,26,20,.78)', color: '#fff', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.1)' }
              }
            >
              {shown[side]}
            </motion.span>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {pair && (
            <motion.span
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0 }}
              className={`rounded-full bg-gold/15 font-extrabold uppercase text-gold ring-1 ring-gold/40 ${G.phone ? 'px-1.5 py-0.5 text-[9px] tracking-wide' : 'px-2 py-1 text-[10px] tracking-[.12em]'}`}
            >
              Pair
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    )
  }

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden" style={vars}>
      <BaccaratFelt />

      {/* winner glow under the hand */}
      {(['P', 'B'] as const).map((side) => (
        <motion.div
          key={side}
          className="pointer-events-none absolute rounded-full"
          style={{
            left: (side === 'P' ? G.pX : G.bX) - G.hw * 0.85,
            top: G.cardsTop - G.ch * 0.25,
            width: G.hw * 1.7,
            height: G.ch * 1.9,
            background: `radial-gradient(closest-side, ${winner === 'T' ? 'rgba(34,211,111,.32)' : side === 'P' ? 'rgba(76,155,255,.34)' : 'rgba(255,90,112,.32)'}, transparent)`,
          }}
          initial={false}
          animate={{ opacity: phase === 'done' && (winner === side || winner === 'T') ? 1 : 0 }}
          transition={{ duration: 0.6 }}
        />
      ))}

      {!shuffling && (['P', 'B'] as const).map(handHeader)}

      {table.length === 0 &&
        !shuffling &&
        (['P', 'B'] as const).flatMap((side) =>
          [0, 1].map((i) => {
            const s = G.slot(side, i)
            return <Slot key={`${side}${i}`} left={s.left} top={s.top} w={G.cw} />
          }),
        )}

      <AnimatePresence>
        {table.map((c) => {
          const s = G.slot(c.side, c.slot)
          const cx = s.left + G.cw / 2
          const cy = s.top + G.ch / 2
          return (
            <TableCard
              key={c.card.id}
              card={c.card}
              left={s.left}
              top={s.top}
              w={G.cw}
              sideways={s.sideways}
              z={c.slot + 1}
              from={{ x: G.shoe.x - cx, y: G.shoe.y - cy, rotate: -18 }}
              flight={turbo ? 0.3 : 0.48}
              mode={c.mode}
              flipInFlight={c.flipInFlight}
              peel={peel}
              lifted={lifted === c.card.id}
              dim={phase === 'done' && !!winner && winner !== 'T' && winner !== c.side}
            />
          )
        })}
      </AnimatePresence>

      <div
        className="pointer-events-none absolute inset-x-0 z-20 h-0"
        style={{ top: G.shoeCh * 0.3 - 6, ['--card-w' as string]: `${G.shoeCw}px`, ['--card-h' as string]: `${G.shoeCh}px` }}
      >
        <Shoe />
      </div>
      {/* the cut card has come out: the next round (or the one being dealt) is the shoe's last */}
      <AnimatePresence>
        {shoeInfo?.lastHand && !shuffling && (
          <motion.div
            key="cut"
            className="pointer-events-none absolute z-[22] flex items-center gap-1.5 rounded-full bg-[#03130e]/80 py-1 pl-1.5 pr-2.5 text-[10px] font-extrabold uppercase tracking-[.12em] text-gold ring-1 ring-gold/30"
            style={{ right: G.pad, top: G.pad + G.sbH + (G.phone ? 3 : 6) }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span className="h-3 w-2 rounded-[2px] bg-danger shadow-[0_0_0_1px_rgba(255,255,255,.35)]" />
            Last hand
          </motion.div>
        )}
      </AnimatePresence>
      {/* the scoreboard hangs over the felt: cards slide out of the shoe beneath it */}
      <div className="absolute z-[21]" style={{ left: 0, top: 0 }}>
        <MemoScoreboard hist={hist} left={G.pad} top={G.pad} width={G.sbW} height={G.sbH} phone={G.phone} shoe={shoeInfo} />
      </div>

      <AnimatePresence>{shuffling && <ShuffleView key={shuffling.id} burn={shuffling.burn} count={shuffling.count} cw={G.cw} x={size.w / 2} y={G.cardsTop + G.ch * 0.45} turbo={turbo} />}</AnimatePresence>

      {/* a tap anywhere on the cards hurries the deal */}
      {dealing && <div className="absolute inset-x-0 z-[25] cursor-pointer" style={{ top: G.handsTop, height: G.handsBot - G.handsTop }} onPointerDown={hurryUp} />}

      <AnimatePresence>
        {lifted != null && !hurry.current && (
          <motion.div
            key="hint"
            className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2"
            style={{ left: G.banner.x, top: G.bannerMid ? G.banner.y : G.banner.y }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.5, duration: 0.3 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
          >
            <span className="whitespace-nowrap rounded-full bg-black/35 px-3 py-1.5 text-[11px] font-bold text-white/70">{G.bar ? 'Tap to reveal' : 'Click or Space to reveal'}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{result && phase === 'done' && <ResultBanner key={result.id} r={result} x={G.banner.x} y={G.banner.y} row={!G.bannerMid} />}</AnimatePresence>

      <MemoBetLayout
        box={G.box}
        phone={G.phone}
        left={G.layLeft}
        top={G.layTop}
        width={G.layW}
        height={G.layH}
        stageH={size.h}
        bets={bets}
        wins={wins}
        leaving={leaving}
        outcomes={outcomes}
        interactive={betting}
        onPlace={onPlace}
        shake={shake}
      />

      {G.bar && (
        <div className={`absolute inset-x-0 bottom-0 flex items-center gap-2 px-2 pb-2 ${G.phone ? '' : 'justify-center'}`} style={{ height: G.barH + 8 }}>
          <div className={`no-scrollbar flex min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/30 p-1 ${G.phone ? 'gap-0.5' : 'max-w-[420px] justify-between gap-1'}`}>{chipPicker(true)}</div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={dealing ? hurryUp : deal}
            disabled={dealing ? turbo : !dealReady}
            style={{ width: dealW }}
            className="flex h-12 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)] disabled:opacity-45"
          >
            <span className="text-[16px] font-extrabold leading-tight">{dealLabel}</span>
            {!dealing && !total && last && <span className="tnum text-[10px] font-bold leading-tight opacity-75">{fmt(lastTotal)}</span>}
          </motion.button>
        </div>
      )}
    </div>
  )

  return <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(80vh,660px)] sm:max-lg:h-[min(78vh,760px)]" />
}

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .55 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

/** The same baize as the blackjack table, without the dealer's arc. */
function BaccaratFelt() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,#1f7a5c_0%,#125240_44%,#0a3027_82%,#08251f_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[.18] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
      <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_120px_30px_rgba(0,0,0,.45)]" />
    </>
  )
}

function ResultBanner({ r, x, y, row }: { r: ResultView; x: number; y: number; row: boolean }) {
  const tone = SIDE_COLOR[r.winner]
  const title = r.winner === 'T' ? 'Tie' : r.winner === 'P' ? 'Player wins' : 'Banker wins'
  const net = round2(r.payout - r.bet)
  return (
    <div className="pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-1/2" style={{ left: x, top: y }}>
      <motion.div
        className={`flex items-center ${row ? 'flex-row gap-2' : 'flex-col gap-2.5'}`}
        initial={{ opacity: 0, scale: 0.9, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.18 } }}
        transition={{ type: 'spring', stiffness: 360, damping: 26 }}
      >
        <div
          className={`flex items-center gap-2 whitespace-nowrap rounded-full font-extrabold uppercase text-white ${row ? 'px-3.5 py-2 text-[12px] tracking-[.12em]' : 'px-5 py-2.5 text-[14px] tracking-[.16em]'}`}
          style={{ background: tone, boxShadow: `0 10px 30px -8px ${tone}, inset 0 1px 0 rgba(255,255,255,.3), inset 0 -2px 0 rgba(0,0,0,.18)` }}
        >
          {title}
          {r.natural && <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] tracking-[.1em]">Natural</span>}
        </div>
        {net > 0 ? (
          <motion.div
            initial={{ opacity: 0, y: row ? 0 : -6, x: row ? -6 : 0 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            transition={{ delay: 0.5, type: 'spring', stiffness: 360, damping: 24 }}
            className={`tnum flex items-center gap-1.5 whitespace-nowrap rounded-xl border-2 border-accent bg-panel font-black text-accent shadow-[0_14px_36px_-12px_rgba(0,0,0,.8),0_0_30px_-10px_rgba(34,211,111,.6)] ${
              row ? 'px-3 py-1.5 text-[14px]' : 'px-4 py-2 text-[20px]'
            }`}
          >
            +{fmt(net)} <Coin size={row ? 15 : 18} />
          </motion.div>
        ) : r.push ? (
          <span className={`rounded-full bg-black/35 font-bold text-white/80 ${row ? 'px-3 py-1.5 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'}`}>Push</span>
        ) : null}
      </motion.div>
    </div>
  )
}

/** A new shoe: two half decks riffle together, then the first card turns up to set the burn. */
function ShuffleView({ burn, count, cw, x, y, turbo }: { burn: Card; count: number; cw: number; x: number; y: number; turbo: boolean }) {
  const d = turbo ? 0.48 : 1
  const ch = Math.round(cw * 1.4)
  const n = 12
  const merged = (0.15 + (n - 1) * 0.06 + 0.34) * d
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <div className="absolute" style={{ left: x, top: y }}>
        <motion.div
          className="absolute -translate-x-1/2 whitespace-nowrap text-center font-extrabold uppercase tracking-[.24em] text-gold/80"
          style={{ top: -ch / 2 - 34, fontSize: 12 }}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          New shoe
        </motion.div>
        {Array.from({ length: n }, (_, i) => {
          const left = i % 2 === 0
          return (
            <motion.div
              key={i}
              className="absolute"
              style={{ left: -cw / 2, top: -ch / 2, width: cw, height: ch, zIndex: i }}
              initial={{ x: left ? -cw * 0.62 : cw * 0.62, y: -Math.floor(i / 2) * 1.5, rotate: left ? -7 : 7 }}
              animate={{ x: 0, y: -i * 1.1, rotate: 0 }}
              transition={{ delay: (0.15 + i * 0.06) * d, duration: 0.34 * d, ease: [0.3, 0, 0.2, 1] }}
            >
              <CardBack className="h-full w-full drop-shadow-[0_6px_10px_rgba(0,0,0,.35)]" />
            </motion.div>
          )
        })}
        {/* the burn card slides off the top of the shoe and turns over */}
        <motion.div
          className="absolute [perspective:900px]"
          style={{ left: -cw / 2, top: -ch / 2, width: cw, height: ch, zIndex: n + 1 }}
          initial={{ x: 0, y: -n * 1.1, opacity: 0 }}
          animate={{ x: cw * 1.2, y: 0, opacity: 1 }}
          transition={{ delay: merged + 0.1 * d, duration: 0.42 * d, ease: [0.16, 1, 0.3, 1], opacity: { delay: merged + 0.1 * d, duration: 0.01 } }}
        >
          <motion.div
            className="absolute inset-0 [transform-style:preserve-3d]"
            initial={{ rotateY: 180 }}
            animate={{ rotateY: 0 }}
            transition={{ delay: merged + 0.3 * d, duration: 0.42 * d, ease: [0.45, 0, 0.2, 1] }}
          >
            <CardFace rank={burn.rank} suit={burn.suit} className="absolute inset-0 h-full w-full drop-shadow-[0_8px_14px_rgba(0,0,0,.4)] [backface-visibility:hidden]" />
            <CardBack className="absolute inset-0 h-full w-full [backface-visibility:hidden] [transform:rotateY(180deg)]" />
          </motion.div>
          <motion.div
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-bold text-white/85"
            style={{ top: ch + 8 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: merged + 0.7 * d }}
          >
            Burn {count}
          </motion.div>
        </motion.div>
      </div>
    </motion.div>
  )
}
