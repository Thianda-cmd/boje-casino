import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent } from 'framer-motion'
import { ActionButton, GameShell, Label, Toggle, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { Chip } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { holdemSfx } from './sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { Kbd } from '../blackjack/table'
import {
  BLIND_PAYS,
  MAX_ANTE,
  MAX_TRIPS,
  MIN_ANTE,
  act,
  actions,
  advise,
  boardShown,
  deal as dealHand,
  playMultiple,
  playerCards,
  showdown,
  staked,
  type Action,
  type BetKey,
  type Card,
  type Hand,
  type HandRank,
  type Showdown,
} from './rules'
import { geometry } from './layout'
import { Felt, Shoe } from './Table'
import { DEALER_TONE, GOLD, HandTag, HoldemCard, Slot, SlotLabel } from './Cards'
import { Circles, type Leaving, type Outcomes } from './Circles'
import { AdviceLine, DecisionButtons, type Choice, type Shake } from './Decision'
import { BigHand, VerdictInline, VerdictNoteLine, VerdictPlaque, bigMomentOf, verdictOf, type BigHandData } from './Showdown'
import { HistoryPanel } from './History'
import { HowToPlay } from './HowToPlay'
import { handWords, isBigHand, liveWords, shortName } from './words'
import {
  clearHand,
  clearNotice,
  forcedDeck,
  handKey,
  histKey,
  loadAdvice,
  loadBets,
  loadChip,
  loadHand,
  loadHistory,
  loadTurbo,
  lockName,
  saveAdvice,
  saveBets,
  saveChip,
  saveHand,
  saveHistory,
  saveNotice,
  saveTurbo,
  takeCarried,
  takeNotice,
  withHand,
  type Bets,
  type History,
} from './storage'

/*
  Hold'em Showdown: heads-up Texas Hold'em against the dealer, played like the casino's Ultimate Texas Hold'em
  (rules.ts has the game and its maths, tested in tools/holdem-test.ts).

  Chips go on the Ante (the Blind matches it) and, if the player likes, Trips. Deal takes the stake and shuffles the
  whole deck at once: the cards glide out of the shoe (the player's two, the dealer's two, the five board cards face
  down) and the player's two turn over. Then the decisions: before the flop check or bet 4× / 3× the ante; on the flop
  check or bet 2×; at the river bet 1× or fold. A bet ends the decisions: the rest of the board turns over, the dealer
  shows, each side's best five are marked, and the circles pay (losing chips swept to the dealer, winnings slid in
  beside their stakes), then everything comes back to the player so Space deals the same bets again. With advice on,
  the recommended move glows and says why.

  Money: the stake at the deal (ante × 2 + trips) and the Play bet when it is made, both before the hand moves on. The
  hand is plain data, saved after every step before anything shows it, so a reload resumes it exactly (same cards,
  nothing charged again). A finished hand is settled exactly once, and only ever into its own player's wallet: when the
  showdown reaches its verdict, at once if the page is left before that (the next visit says what it came to), or on
  the next visit if the page died. If the account changes under the page, the last player's hand waits, saved, for
  them; a guest who signs up brings an open hand into the new account with the wallet that paid for it (storage.ts).
  One tab at a time plays for a player (a Web Lock); a tab that takes over first picks up the wallet as the other left
  it.

  The screen: Table.tsx (the felt, its print, the shoe), Cards.tsx (cards and hand tags), Circles.tsx, Decision.tsx
  (the buttons and the advice line), Showdown.tsx (the verdict, the big-hand moment), History.tsx, HowToPlay.tsx; the
  positions come from layout.ts. Keys: Space deals, checks or hurries the cards (the river is never Space's: a run of
  presses there stops and points at Bet 1× and Fold); 4 3 2 1 bet; C checks; F folds; A and T add a chip to the Ante
  or Trips; H toggles the advice. Dev builds only: window.__holdemForce (storage.ts: a scenario's name or the cards)
  stacks the next deal; window.__holdemState().
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000]
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
/** after a decision opens, Space waits this long (a run of presses meant for the cards can't land on it) */
const DECIDE_HOLD = 380
const ALL = [0, 1, 2, 3, 4, 5, 6, 7, 8]
const NONE = ALL.map(() => false)
const NO_OPTIONS: number[] = []
/** the narrowest a chip button on the phone's bar gets; under it the rack scrolls (with a fade where chips are hidden) */
const RACK_MIN = 34

type Phase = 'bet' | 'busy' | 'decide'

/** the cards on the felt */
interface TableView {
  /** the hand's id: the cards' keys */
  id: number
  deck: Card[]
  dealt: boolean[]
  up: boolean[]
  /** dealt from the shoe this time (a resumed hand is simply there) */
  fly: boolean
}

/** the showdown as far as it has been shown */
interface Reveal {
  sd: Showdown
  /** whose best five are marked so far */
  marks: 'dealer' | 'both'
  verdict: boolean
}

interface CircleView {
  stakes: Record<BetKey, number>
  wins: Partial<Record<BetKey, number>>
  outcomes: Outcomes | null
  leaving: Leaving
}

const LABEL: Record<Action, { label: string; key: string }> = {
  check: { label: 'Check', key: 'C' },
  bet4: { label: 'Bet 4×', key: '4' },
  bet3: { label: 'Bet 3×', key: '3' },
  bet2: { label: 'Bet 2×', key: '2' },
  bet1: { label: 'Bet 1×', key: '1' },
  fold: { label: 'Fold', key: 'F' },
}
/** passive moves first, bets after, the biggest last */
const SHOWN_ORDER: Action[] = ['fold', 'check', 'bet1', 'bet2', 'bet3', 'bet4']

const betStakes = (b: Bets): Record<BetKey, number> => ({ ante: b.ante, blind: b.ante, trips: b.trips, play: 0 })
const handStakes = (h: Hand): Record<BetKey, number> => ({ ante: h.ante, blind: h.ante, trips: h.trips, play: round2(h.ante * h.play) })
const total = (b: Bets) => round2(b.ante * 2 + b.trips)
const coins = (v: number) => fmt(v, v % 1 ? 2 : 0)
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

/** why a key's move can't be made at this point of the hand */
function notNow(a: Action, h: Hand): string {
  const now = h.stage === 'preflop' ? 'before the flop: check, or bet 4× or 3×' : h.stage === 'flop' ? 'on the flop: check, or bet 2×' : 'at the river: bet 1× or fold'
  if (a === 'fold') return `You can only fold at the river. Now it's ${now}.`
  if (a === 'check') return 'No checking at the river: bet 1× or fold.'
  return `${LABEL[a].label} isn't open now. It's ${now}.`
}

/** says what a hand paid that the player didn't see paid: "Your last Hold'em hand (Flush) paid out when you left" */
function toastPaid(what: string, rank: HandRank, ret: number, when = '') {
  const w = useWallet.getState()
  const title = `${what} (${shortName(rank)})`
  if (ret > 0) w.pushToast({ kind: 'win', title: `${title} paid out${when}`, amount: ret })
  else w.pushToast({ kind: 'info', title: `${title} didn't win` })
}

/** the result in words, for the screen reader and the toasts */
function resultWords(sd: Showdown) {
  const net = round2(sd.ret - sd.stake)
  const v = verdictOf(sd)
  const head = v === 'win' ? 'You win' : v === 'lose' ? 'The dealer wins' : v === 'push' ? 'A push' : 'You folded'
  return `${head} with ${handWords(sd.player).full.toLowerCase()} against ${handWords(sd.dealer).full.toLowerCase()}: ${net >= 0 ? `+${coins(net)}` : `−${coins(-net)}`}.`
}

export default function Holdem() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  /* ---------------- switches ---------------- */

  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const [turbo, setTurboState] = useState(loadTurbo)
  const [adviceOn, setAdviceState] = useState(loadAdvice)
  const [info, setInfo] = useState(false)
  const [touch] = useState(isTouch)
  const switches = useRef({ turbo, adviceOn })
  switches.current = { turbo, adviceOn }
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }
  const setTurbo = useCallback((on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }, [])
  const setAdvice = useCallback((on: boolean) => {
    setAdviceState(on)
    saveAdvice(on)
  }, [])

  /* ---------------- state ---------------- */

  // the player's lock this page holds: held only while it is the lock of the player of the moment, so the page lets go
  // of everything the instant the account changes under it, and waits for the new player's lock
  const [heldBy, setHeldBy] = useState<string | null>(null)
  const held = heldBy === lockName(uid)
  const [elsewhere, setElsewhere] = useState(false)
  const [bets, setBetsState] = useState<Bets>(loadBets)
  const betsRef = useRef(bets)
  const [hand, setHandState] = useState<Hand | null>(null)
  const handRef = useRef<Hand | null>(null)
  const idRef = useRef(0)
  /** whose hand, history and notice the page shows (null: the guest's) */
  const ownerRef = useRef<string | null>(null)
  /** a finished hand not yet paid: paid exactly once, into its player's wallet (settlePending) */
  const pending = useRef<{ owner: string | null; id: number; hand: Hand } | null>(null)
  /** the hand in play was paid as the page began to leave (its notice waits for its player's next visit) */
  const paidOnHide = useRef<{ owner: string | null } | null>(null)
  /** the last hand paid (for the dev state: test scripts check the wallet against it) */
  const lastPaid = useRef<{ id: number; hand: Hand } | null>(null)

  const [phase, setPhaseState] = useState<Phase>('bet')
  // the phase as of now, for the money path: two presses handled before React re-renders must not deal or bet twice
  const phaseRef = useRef<Phase>('bet')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [table, setTableState] = useState<TableView | null>(null)
  const tableRef = useRef<TableView | null>(null)
  const putTable = (t: TableView | null) => {
    tableRef.current = t
    setTableState(t)
  }
  const [reveal, setReveal] = useState<Reveal | null>(null)
  const [folded, setFolded] = useState(false)
  const [circ, setCirc] = useState<CircleView>(() => ({ stakes: betStakes(bets), wins: {}, outcomes: null, leaving: 'player' }))
  const [big, setBig] = useState<BigHandData | null>(null)
  const [hist, setHist] = useState<History>(() => loadHistory(histKey(null)))
  const histRef = useRef(hist)
  /** the cards hurry (Space or a tap while they move) */
  const [fast, setFast] = useState(false)
  const hurried = useRef(false)
  const [shake, setShake] = useState<{ key: BetKey; n: number } | null>(null)
  const [btnShake, setBtnShake] = useState<Shake | null>(null)
  const [say, setSay] = useState('')
  const decideAt = useRef(0)
  /** when Space last pointed at the river's two buttons (its toast isn't repeated while Space is mashed) */
  const riverHintAt = useRef(0)

  const setBets = (b: Bets) => {
    betsRef.current = b
    setBetsState(b)
    saveBets(b)
  }
  const setHand = (h: Hand | null) => {
    handRef.current = h
    setHandState(h)
  }

  const [stageRef, size] = useSize<HTMLDivElement>()
  // below the lg breakpoint the side panel sits under the stage, so the chips, Deal and the decisions move onto it
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)')
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const G = useMemo(() => geometry(size.w, size.h, !wide), [size.w, size.h, wide])

  /* ---------------- timing ---------------- */

  const alive = useRef(true)
  const run = useRef(0)
  /** the sequence's waits, which a hurry resolves at once */
  const waits = useRef(new Set<{ t: number; done: () => void }>())
  /** the result's timers (chips swept, paid, brought back), cleared by the next deal or a change of bets */
  const timers = useRef<number[]>([])
  const live = (id: number) => alive.current && run.current === id

  function wait(ms: number) {
    return new Promise<void>((resolve) => {
      const k = hurried.current ? 0.12 : switches.current.turbo ? 0.55 : 1
      const w = {
        t: 0,
        done: () => {
          clearTimeout(w.t)
          waits.current.delete(w)
          resolve()
        },
      }
      w.t = window.setTimeout(w.done, ms * k)
      waits.current.add(w)
    })
  }
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms * (switches.current.turbo ? 0.55 : 1)))
  }
  const clearLater = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  const stopAll = () => {
    run.current++
    clearLater()
    waits.current.forEach((w) => clearTimeout(w.t))
    waits.current.clear()
  }

  /** Space or a tap while the cards move: the rest of the sequence plays at once */
  function hurry() {
    if (phaseRef.current !== 'busy' || hurried.current) return
    hurried.current = true
    setFast(true)
    ;[...waits.current].forEach((w) => w.done())
  }
  const calm = () => {
    hurried.current = false
    setFast(false)
  }

  const flightS = fast ? 0.2 : turbo ? 0.3 : 0.46
  const flipS = fast ? 0.18 : turbo ? 0.28 : 0.44

  /* ---------------- money: settling ---------------- */

  /** puts a settled hand in its player's history and stats (and in storage), once */
  const logHand = (owner: string | null, id: number, sd: Showdown) => {
    const mine = owner === ownerRef.current
    const hk = histKey(owner)
    const next = withHand(mine ? histRef.current : loadHistory(hk), { id, stake: sd.stake, ret: sd.ret, rank: sd.player.rank, outcome: verdictOf(sd) })
    saveHistory(hk, next)
    if (mine) {
      histRef.current = next
      if (alive.current) setHist(next)
    }
  }

  /** pays a finished hand into the wallet and logs it; `from`, the key it is saved under, is cleared as it is paid */
  const pay = (owner: string | null, id: number, h: Hand, from: string | null): Showdown => {
    lastPaid.current = { id, hand: h }
    const sd = showdown(h)
    const won = !sd.folded && sd.winner === 'player'
    useWallet.getState().settle({ game: 'holdem', bet: sd.stake, payout: sd.ret, meta: { hand: sd.player.rank, won, bigWin: won && isBigHand(sd.player.rank), folded: sd.folded } })
    // the wallet is written before the hand leaves storage (safeStorage writes held values first)
    if (from) clearHand(from)
    logHand(owner, id, sd)
    return sd
  }

  /**
   * Pays the finished hand, once: at its verdict, or as soon as the page is left (it is decided). Only into its own
   * player's wallet: if the account has changed since it was dealt, it stays saved for its player's next visit. Null
   * if nothing was paid.
   */
  const settlePending = (): { owner: string | null; sd: Showdown } | null => {
    const p = pending.current
    if (!p || p.owner !== useAuth.getState().uid) return null
    pending.current = null
    return { owner: p.owner, sd: pay(p.owner, p.id, p.hand, handKey(p.owner)) }
  }

  /** the hand moves on: kept in memory and saved before anything shows it (a finished one waits to be paid) */
  const commit = (h: Hand) => {
    const owner = ownerRef.current
    setHand(h)
    saveHand(handKey(owner), { id: idRef.current, hand: h })
    if (h.stage === 'done') pending.current = { owner, id: idRef.current, hand: h }
  }

  useEffect(() => {
    alive.current = true
    // reloading, closing the tab or going to another site as the cards turn over pays the hand on the way out
    const onHide = () => {
      const paid = settlePending()
      if (!paid) return
      paidOnHide.current = { owner: paid.owner }
      saveNotice(paid.owner, { stake: paid.sd.stake, ret: paid.sd.ret, rank: paid.sd.player.rank, outcome: verdictOf(paid.sd) })
    }
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      alive.current = false
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      stopAll()
      // going to another page of the casino mid-showdown pays it at once, and says what it came to; so does a hand
      // paid by a leave the player then cancelled (said now, rather than on some later visit)
      const paid = settlePending()
      const n = !paid && paidOnHide.current ? takeNotice(paidOnHide.current.owner) : null
      if (paid) toastPaid("Your Hold'em hand", paid.sd.player.rank, paid.sd.ret, ' as you left')
      else if (n) toastPaid("Your Hold'em hand", n.rank, n.ret, ' as you left')
    }
    // settlePending and stopAll only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- one tab per player, and the saved hand ---------------- */

  // One tab at a time plays for a player: two would each save the hand over the other's. The page holds the player's
  // lock while it is open (a tab that closes or dies lets go) and touches the saved hand only once it has it; a
  // second tab waits, says so, and picks the hand up as soon as the first lets go. A page on its way out (the app
  // fades it while the next page comes in, a new one for a new account) lets go at once and plays no more.
  const present = useIsPresent()
  useEffect(() => {
    if (authStatus === 'loading' || !present) return
    const name = lockName(uid)
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      setHeldBy(name)
      return
    }
    const quit = new AbortController()
    let gone = false
    let release = () => {}
    // a moment's wait is this page starting over (its old lock on its way out); any longer, another tab has it
    const slow = window.setTimeout(() => setElsewhere(true), 1500)
    locks
      .request(name, { signal: quit.signal }, async () => {
        if (gone) return
        // Tabs' wallets don't follow each other: another tab may have staked and settled since this page read the
        // wallet, and this tab's first bet would write its old balance over all of that. Pick up what is stored first.
        await useWallet.persist.rehydrate()
        if (gone) return
        return new Promise<void>((done) => {
          release = done
          clearTimeout(slow)
          setElsewhere(false)
          setHeldBy(name)
        })
      })
      .catch(() => {
        // given up because the page went first; or locks refused here (a page with no origin, say): play without one
        if (gone) return
        clearTimeout(slow)
        setHeldBy(name)
      })
    return () => {
      gone = true
      clearTimeout(slow)
      quit.abort()
      release()
      setHeldBy(null)
    }
  }, [authStatus, uid, present])

  // with the lock: say what a hand paid as the page closed, settle a finished hand the page died on, and pick up a
  // hand in play exactly where it was
  useEffect(() => {
    if (!held) return
    const owner = uid
    const n = takeNotice(owner)
    if (n) toastPaid("Your last Hold'em hand", n.rank, n.ret, ' when you left')
    if (ownerRef.current === owner && (handRef.current || tableRef.current)) return
    // a new player at the page: the last one's hand stays saved under their key, paid or resumed when they come back
    // (never into this wallet)
    stopAll()
    pending.current = null
    paidOnHide.current = null
    setHand(null)
    putTable(null)
    setReveal(null)
    setFolded(false)
    setBig(null)
    setPhase('bet')
    ownerRef.current = owner
    const h0 = loadHistory(histKey(owner))
    histRef.current = h0
    setHist(h0)
    setCirc({ stakes: betStakes(betsRef.current), wins: {}, outcomes: null, leaving: 'player' })

    const key = handKey(owner)
    // a guest who signed up with a hand open: the account's wallet paid for it, so the account plays it on
    const carriedIn = takeCarried(owner)
    if (carriedIn) {
      if (!loadHand(key)) saveHand(key, carriedIn)
      // (a brand-new account has no hand of its own to be in the way; if one ever is, the carried hand is squared up
      // here instead of lost: paid if it had finished, its stake handed back if not)
      else if (carriedIn.hand.stage === 'done') pay(owner, carriedIn.id, carriedIn.hand, null)
      else useWallet.getState().refund(staked(carriedIn.hand))
    }
    const saved = loadHand(key)
    if (!saved) return
    const brought = carriedIn?.id === saved.id
    idRef.current = saved.id
    const h = saved.hand
    const up = ALL.map((i) => i < 2 || (i >= 4 && i < 4 + boardShown(h).length))
    if (h.stage === 'done') {
      // finished while the page was gone: paid now, and the table shows how it ended
      const sd = pay(owner, saved.id, h, key)
      putTable({ id: saved.id, deck: h.deck, dealt: ALL.map(() => true), up: ALL.map(() => true), fly: false })
      setFolded(h.folded)
      setReveal({ sd, marks: 'both', verdict: true })
      setSay(resultWords(sd))
      // its bets are the ones Space deals again
      setBets({ ante: h.ante, trips: h.trips })
      setCirc({ stakes: betStakes({ ante: h.ante, trips: h.trips }), wins: {}, outcomes: null, leaving: 'player' })
      toastPaid(brought ? "The Hold'em hand you brought into your account" : "Your unfinished Hold'em hand", sd.player.rank, sd.ret)
      return
    }
    setHand(h)
    putTable({ id: saved.id, deck: h.deck, dealt: ALL.map(() => true), up, fly: false })
    setCirc({ stakes: handStakes(h), wins: {}, outcomes: null, leaving: 'player' })
    setBets({ ante: h.ante, trips: h.trips })
    holdemSfx.welcome()
    pushToast({ kind: 'info', title: brought ? "Your Hold'em hand came with you into your account" : "Welcome back: your Hold'em hand is just as you left it" })
    openDecision(h)
    // the lock is per player; the rest reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, uid])

  /* ---------------- the cards ---------------- */

  const setCards = (fn: (t: TableView) => Partial<TableView>) => {
    const t = tableRef.current
    if (t) putTable({ ...t, ...fn(t) })
  }
  const dealOne = (i: number) => setCards((t) => ({ dealt: t.dealt.map((d, k) => d || k === i) }))
  const turnOne = (i: number) => setCards((t) => ({ up: t.up.map((u, k) => u || k === i) }))

  /** turns cards over one after another; false if the sequence was stopped */
  async function turn(id: number, idx: number[], stagger: number, sound: () => void = holdemSfx.flip) {
    for (let k = 0; k < idx.length; k++) {
      turnOne(idx[k])
      sound()
      if (k < idx.length - 1) {
        await wait(stagger)
        if (!live(id)) return false
      }
    }
    await wait(flipS * 1000 + 60)
    return live(id)
  }

  function openDecision(h: Hand) {
    calm()
    decideAt.current = performance.now()
    setPhase('decide')
    const words = liveWords(playerCards(h), boardShown(h)).full
    setSay(h.stage === 'preflop' ? `Your cards: ${words}. Check, or bet 4× or 3×.` : h.stage === 'flop' ? `The flop. You have ${words.toLowerCase()}. Check, or bet 2×.` : `The river. You have ${words.toLowerCase()}. Bet 1×, or fold.`)
  }

  /* ---------------- the hand ---------------- */

  const refuse = (why: string, at?: { key?: BetKey; action?: Shake['action'] }) => {
    if (at?.key) setShake((s) => ({ key: at.key!, n: (s?.n ?? 0) + 1 }))
    if (at?.action) setBtnShake((s) => ({ action: at.action!, n: (s?.n ?? 0) + 1 }))
    holdemSfx.nope()
    pushToast({ kind: 'info', title: why })
  }

  function deal() {
    if (!held) return
    if (phaseRef.current === 'busy') return hurry()
    if (phaseRef.current !== 'bet') return
    const b = betsRef.current
    if (b.ante < MIN_ANTE) return refuse('Put chips on the Ante first', { key: 'ante' })
    if (!stake(total(b))) return
    stopAll()
    const id = run.current
    idRef.current = Date.now()
    let h = dealHand(b.ante, b.trips, rand)
    if (import.meta.env.DEV) {
      // window.__holdemForce: a scenario's name or { player, dealer, board } stacks this deal (storage.ts)
      const w = window as unknown as { __holdemForce?: unknown }
      const deck = w.__holdemForce != null ? forcedDeck(w.__holdemForce, rand) : null
      delete w.__holdemForce
      if (deck) h = { ...h, deck }
    }
    // the hand is decided and stored before anything moves: a reload resumes it, nothing is charged again
    commit(h)
    setPhase('busy')
    void runDeal(id, h)
  }

  async function runDeal(id: number, h: Hand) {
    calm()
    setBig(null)
    setReveal(null)
    setFolded(false)
    setCirc({ stakes: handStakes(h), wins: {}, outcomes: null, leaving: 'player' })
    setSay('Dealing.')
    // last hand's cards are swept off first
    if (tableRef.current) {
      putTable(null)
      await wait(360)
      if (!live(id)) return
    }
    putTable({ id: idRef.current, deck: h.deck, dealt: NONE, up: NONE, fly: true })
    // player, dealer, player, dealer, then the board face down
    for (const i of [0, 2, 1, 3]) {
      dealOne(i)
      holdemSfx.deal()
      await wait(190)
      if (!live(id)) return
    }
    for (let i = 4; i < 9; i++) {
      dealOne(i)
      holdemSfx.deal(true)
      await wait(100)
      if (!live(id)) return
    }
    await wait(flightS * 1000 - 40)
    if (!live(id)) return
    // the player's cards turn over
    if (!(await turn(id, [0, 1], 130))) return
    openDecision(h)
  }

  function decide(a: Action) {
    const h = handRef.current
    if (!held || !h || phaseRef.current !== 'decide') return
    if (!actions(h).includes(a)) return refuse(notNow(a, h), { action: a })
    const k = playMultiple(a)
    if (k) {
      const cost = round2(h.ante * k)
      if (useWallet.getState().balance < cost || !useWallet.getState().placeBet(cost))
        return refuse(`${LABEL[a].label} needs ${fmt(cost)} coins: you have ${fmt(useWallet.getState().balance)}.`, { action: a })
      holdemSfx.bet(k)
    } else if (a === 'check') holdemSfx.check()
    else holdemSfx.fold()
    const next = act(h, a)
    // saved (with the Play bet just taken) before anything moves
    commit(next)
    setPhase('busy')
    void runAfter(run.current, next, a)
  }

  async function runAfter(id: number, h: Hand, a: Action) {
    calm()
    const k = playMultiple(a)
    if (k) {
      setCirc((c) => ({ ...c, stakes: { ...c.stakes, play: round2(h.ante * k) } }))
      setSay(`Bet ${k}×.`)
      await wait(420)
    } else if (a === 'check') {
      setSay('Check.')
      await wait(260)
    } else {
      setFolded(true)
      setSay('Fold.')
      await wait(380)
    }
    if (!live(id)) return
    if (h.stage === 'flop') {
      if (await turn(id, [4, 5, 6], 90)) openDecision(h)
      return
    }
    if (h.stage === 'river') {
      if (await turn(id, [7, 8], 120)) openDecision(h)
      return
    }
    await runShowdown(id, h)
  }

  async function runShowdown(id: number, h: Hand) {
    const sd = showdown(h)
    // what is still face down on the board turns over: the flop together, then the turn and river
    if (!tableRef.current?.up[4]) {
      if (!(await turn(id, [4, 5, 6], 90))) return
      await wait(240)
      if (!live(id)) return
    }
    if (!tableRef.current?.up[7]) {
      if (!(await turn(id, [7, 8], 120))) return
    }
    await wait(260)
    if (!live(id)) return
    // the dealer turns over
    holdemSfx.reveal()
    await wait(280)
    if (!live(id)) return
    if (!(await turn(id, [2, 3], 120, () => {}))) return
    setReveal({ sd, marks: 'dealer', verdict: false })
    setSay(`The dealer has ${handWords(sd.dealer).full.toLowerCase()}${sd.qualifies ? '' : ", and doesn't qualify"}.`)
    await wait(720)
    if (!live(id)) return
    setReveal({ sd, marks: 'both', verdict: false })
    await wait(560)
    if (!live(id)) return
    finish(sd, h)
  }

  /** the verdict: pay, show it, sweep the losers, pay the winners, then the chips come back for the next deal */
  function finish(sd: Showdown, h: Hand) {
    settlePending()
    // a hand paid as the page began to leave, on a page that stayed: the player sees it now, no notice needed
    if (paidOnHide.current) {
      clearNotice(paidOnHide.current.owner)
      paidOnHide.current = null
    }
    setHand(null)
    calm()
    setPhase('bet')
    setReveal({ sd, marks: 'both', verdict: true })
    setSay(resultWords(sd))
    const v = verdictOf(sd)
    const net = round2(sd.ret - sd.stake)
    // the sting: a won hand's by the size of the win; any other by what it came to (Trips can carry a lost or folded
    // hand into profit)
    if (v === 'win') holdemSfx.win(net >= h.ante * 8 ? 2 : net >= h.ante * 3 ? 1 : 0)
    else if (net > 0) holdemSfx.win(net >= h.ante * 3 ? 1 : 0)
    else if (v === 'push') holdemSfx.push()
    else holdemSfx.lose()

    const outcomes: Outcomes = {}
    const keep = handStakes(h)
    const profit: Partial<Record<BetKey, number>> = {}
    let lost = false
    for (const r of sd.results) {
      if (!r.stake) continue
      outcomes[r.key] = r.outcome
      if (r.outcome === 'lose') {
        keep[r.key] = 0
        lost = true
      }
      if (r.outcome === 'win') profit[r.key] = round2(r.ret - r.stake)
    }
    setCirc((c) => ({ ...c, outcomes }))

    // a big hand that won gets its moment and the fanfare; one that only Trips paid on, a quiet one (Showdown.tsx)
    const moment = bigMomentOf(sd, idRef.current)
    const full = moment?.kind === 'hand'
    const royal = full && moment.rank === 'royal'
    if (moment) {
      later(380, () => {
        setBig(moment)
        if (full) holdemSfx.bigHand(royal)
        else holdemSfx.trips()
      })
      // the moment closes itself (a tap or Space closes it sooner)
      later(380 + (royal ? 4400 : full ? 2300 : 1700), () => setBig((b) => (b?.id === moment.id ? null : b)))
    }
    if (lost)
      later(450, () => {
        setCirc((c) => ({ ...c, leaving: 'dealer', stakes: keep }))
        holdemSfx.sweep()
      })
    if (Object.keys(profit).length)
      later(900, () => {
        setCirc((c) => ({ ...c, wins: profit }))
        holdemSfx.pay()
      })
    // the chips come back to the player, then the same bets go down again for the next deal
    later(royal ? 4600 : full ? 3000 : 2700, () => {
      setCirc((c) => ({ ...c, leaving: 'player', stakes: { ante: 0, blind: 0, trips: 0, play: 0 }, wins: {} }))
      if (sd.ret > 0) sfx.coin()
      later(560, () => setCirc({ stakes: betStakes(betsRef.current), wins: {}, outcomes: null, leaving: 'player' }))
    })
  }

  /* ---------------- the bets ---------------- */

  const betting = phase === 'bet' && held

  /** the bets change: the last hand's chips and results leave the circles, the new bets go down */
  function changeBets(next: Bets) {
    clearLater()
    setBig(null)
    setBets(next)
    setCirc({ stakes: betStakes(next), wins: {}, outcomes: null, leaving: 'player' })
  }

  /** a chip on Ante (or Blind, which matches it) or Trips; `sign` -1 takes one off */
  function chipOn(key: BetKey, sign: 1 | -1 = 1) {
    if (!betting) return
    const b = betsRef.current
    const k = key === 'blind' ? 'ante' : key
    if (k === 'play') return
    const cur = b[k]
    if (sign < 0) {
      if (!cur) return
      const left = round2(Math.max(k === 'ante' ? MIN_ANTE : 0, cur - chip))
      // Trips is a whole coin or more (a part-coin left by a top-up comes off with it)
      const v = k === 'trips' && left < 1 ? 0 : left
      if (v === cur) return refuse(`The Ante can't go under ${MIN_ANTE}`, { key })
      holdemSfx.remove()
      return changeBets({ ...b, [k]: v })
    }
    const max = k === 'ante' ? MAX_ANTE : MAX_TRIPS
    // an ante chip goes on twice (the Blind matches it)
    const room = round2(useWallet.getState().balance - total(b))
    const fits = Math.floor((k === 'ante' ? room / 2 : room) * 100) / 100
    const add = Math.min(chip, round2(max - cur), fits)
    if (add < 1) {
      if (cur >= max) return refuse(`Table limit: ${fmt(max, 0)} on ${k === 'ante' ? 'the Ante' : 'Trips'}`, { key })
      return refuse(NO_COINS, { key })
    }
    if (add < chip) pushToast({ kind: 'info', title: cur + add >= max ? `Topped up to the ${fmt(max, 0)} limit` : `Only room for ${coins(add)} more` })
    holdemSfx.chip()
    changeBets({ ...b, [k]: round2(cur + add) })
  }
  const chipRef = useRef(chipOn)
  chipRef.current = chipOn
  const onPlace = useCallback((k: BetKey) => chipRef.current(k, 1), [])
  const onRemove = useCallback((k: BetKey) => chipRef.current(k, -1), [])

  const setTrips = (on: boolean) => {
    if (!betting) return
    const b = betsRef.current
    if (!on) return changeBets({ ...b, trips: 0 })
    const v = Math.min(MAX_TRIPS, b.ante, chip)
    if (round2(useWallet.getState().balance - total(b)) < v) return refuse(NO_COINS, { key: 'trips' })
    holdemSfx.chip()
    changeBets({ ...b, trips: Math.max(1, v) })
  }

  /* ---------------- keys ---------------- */

  // whether the control in focus got there by pointer (a click) rather than by keyboard (Tab): see the keys below
  const pointerFocus = useRef(false)
  useEffect(() => {
    let down = 0
    const onDown = () => (down = performance.now())
    const onFocus = () => (pointerFocus.current = performance.now() - down < 500)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('focusin', onFocus, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('focusin', onFocus, true)
    }
  }, [])

  /**
   * Space: deal, hurry the cards, or (once the decision has been up a moment) check. At the river there is nothing to
   * check and both moves cost something, so Space doesn't choose: it points at Bet 1× and Fold.
   */
  const press = () => {
    if (big) return setBig(null)
    if (phaseRef.current === 'busy') return hurry()
    if (phaseRef.current === 'bet') return deal()
    const h = handRef.current
    if (!h || performance.now() - decideAt.current < DECIDE_HOLD) return
    if (h.stage !== 'river') return decide('check')
    setBtnShake((s) => ({ action: 'all', n: (s?.n ?? 0) + 1 }))
    if (performance.now() - riverHintAt.current < 2500) return
    riverHintAt.current = performance.now()
    holdemSfx.nope()
    pushToast({ kind: 'info', title: 'Your call at the river: Bet 1× (key 1) or Fold (F)' })
  }

  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || info || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (e.code === 'Space' || e.key === 'Enter') {
      // A control reached with the keyboard keeps its own Space and Enter; Enter on any focused control too. Otherwise
      // both play, so a button just clicked with the mouse doesn't swallow Space.
      const control = (e.target as HTMLElement | null)?.closest?.('button,[role=button],[role=switch]')
      if (control && (e.key === 'Enter' || !pointerFocus.current)) return
      e.preventDefault()
      if (!e.repeat) press()
      return
    }
    if (e.repeat) return
    const bet: Record<string, Action> = { '4': 'bet4', '3': 'bet3', '2': 'bet2', '1': 'bet1', f: 'fold', c: 'check' }
    if (bet[k]) {
      if (phaseRef.current === 'decide') decide(bet[k])
    } else if (k === 'a') chipOn('ante')
    else if (k === 't') chipOn('trips')
    else if (k === 'h') setAdvice(!switches.current.adviceOn)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /* ---------------- what shows ---------------- */

  const deciding = phase === 'decide' && !!hand
  const choices: Choice[] =
    deciding && hand
    ? SHOWN_ORDER.filter((a) => actions(hand).includes(a)).map((a) => {
        const k = playMultiple(a)
        const cost = k ? round2(hand.ante * k) : undefined
        // a fold says what it gives up (and that Trips rides on); Check, that Space makes it too
        const fold = a === 'fold'
        return {
          action: a,
          ...LABEL[a],
          cost,
          sub: fold ? `Lose ${fmt(round2(hand.ante * 2))}` : undefined,
          alt: a === 'check' ? 'or Space' : undefined,
          note: fold && hand.trips > 0 ? 'Trips still pays' : undefined,
          blocked: cost != null && balance < cost ? `Needs ${fmt(cost)}` : undefined,
        }
      })
    : []
  // the river's advice counts 990 dealer hands: worked out once per decision
  const advice = useMemo(() => (adviceOn && deciding && hand ? advise(hand) : null), [adviceOn, deciding, hand])
  // the advised bet may be more than the balance: say so (the hand waits while the player fetches coins)
  const advisedChoice = advice ? choices.find((c) => c.action === advice.action) : undefined
  const adviceText = advice ? (advisedChoice?.blocked ? `Best: ${advisedChoice.label} (needs ${fmt(advisedChoice.cost!)}). Claim coins in Rewards: your hand waits.` : advice.why) : null
  const options = useMemo(() => (deciding && hand ? actions(hand).map(playMultiple).filter((m) => m > 0) : NO_OPTIONS), [deciding, hand])

  const sd = reveal?.sd ?? null
  // a folded hand still shows its best five when Trips rides on it
  const showP = !!sd && reveal!.marks === 'both' && (!sd.folded || sd.results.some((r) => r.key === 'trips'))
  const tripsWon = !!sd && sd.results.some((r) => r.key === 'trips' && r.outcome === 'win')
  // the winner's five rise and glow; a push or a fold has no winner to show
  const winner = sd && reveal!.verdict && !sd.folded && sd.winner !== 'tie' ? sd.winner : null
  const winBest = winner ? (winner === 'player' ? sd!.player.best : sd!.dealer.best) : null

  // the player's hand in words: live as the cards show, the final hand at the showdown
  const holeUp = !!table && table.up[0] && table.up[1]
  const playerWords = !table || !holeUp ? null : sd && reveal!.marks === 'both' ? handWords(sd.player) : liveWords(table.deck.slice(0, 2), table.deck.slice(4, 9).filter((_, i) => table.up[4 + i]))
  const dealerWords = sd ? handWords(sd.dealer) : null
  // the paytable rows the felt lights at the verdict
  const shownVerdict = !!reveal?.verdict
  const hit = useMemo(
    () => ({
      blind: sd && shownVerdict && !sd.folded && sd.winner === 'player' && BLIND_PAYS[sd.player.rank] !== undefined ? sd.player.rank : null,
      trips: sd && shownVerdict && tripsWon ? sd.player.rank : null,
    }),
    [sd, shownVerdict, tripsWon],
  )

  // dev: the state, for test scripts
  const devState = useRef<() => unknown>(() => null)
  devState.current = () => ({
    phase,
    held,
    elsewhere,
    hand: handRef.current,
    pending: !!pending.current,
    paid: lastPaid.current,
    bets: betsRef.current,
    choices: choices.map((c) => ({ action: c.action, blocked: c.blocked ?? null })),
    advice,
    verdict: reveal?.verdict
      ? { verdict: verdictOf(reveal.sd), player: reveal.sd.player.rank, dealer: reveal.sd.dealer.rank, qualifies: reveal.sd.qualifies, stake: reveal.sd.stake, ret: reveal.sd.ret }
      : null,
    big: big?.rank ?? null,
    bigKind: big?.kind ?? null,
    hist: histRef.current,
  })
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __holdemState?: () => unknown }
    w.__holdemState = () => devState.current()
    return () => {
      delete w.__holdemState
    }
  }, [])

  /* ---------------- panel ---------------- */

  const shownBets: Bets = hand ? { ante: hand.ante, trips: hand.trips } : bets
  const betTotal = hand ? round2(hand.ante * (2 + hand.play) + hand.trips) : total(bets)
  const canDeal = betting && bets.ante >= MIN_ANTE && total(bets) <= balance
  const afterDeal = round2(balance - total(bets))
  const thin = betting && canDeal && afterDeal < bets.ante
  const again = betting && !!reveal?.verdict
  const dealSub = !held
    ? elsewhere
      ? 'Close it to play here'
      : 'Loading…'
    : total(bets) > balance
      ? 'Not enough coins for these bets'
      : `${again ? 'Same bets · ' : ''}Ante ${coins(bets.ante)} · Blind ${coins(bets.ante)}${bets.trips ? ` · Trips ${coins(bets.trips)}` : ''}`

  // the panel's chips in one row; the bar's (compact) each `btn` wide
  const chipPicker = (compact: boolean, btn = 40) =>
    CHIPS.map((v) => (
      <button
        key={v}
        onClick={() => (sfx.click(), setChip(v))}
        style={compact ? { width: btn } : undefined}
        className={`flex shrink-0 items-center justify-center transition ${compact ? 'h-11 rounded-md' : 'h-11 min-w-0 flex-1 rounded-lg'} ${
          chip === v ? (compact ? 'bg-white/15 ring-2 ring-accent' : 'bg-hover ring-2 ring-accent') : compact ? '' : 'hover:bg-raised'
        }`}
        aria-label={`${v} coin chip`}
        aria-pressed={chip === v}
        title={compact ? undefined : `${fmt(v, 0)}`}
      >
        <motion.span animate={{ y: chip === v && !compact ? -2 : 0 }}>
          <Chip value={v} size={compact ? Math.min(32, btn - 4) : 31} />
        </motion.span>
      </button>
    ))

  const mainAction =
    phase === 'decide' && hand ? (
      <div className="flex flex-col gap-2.5">
        {adviceOn && <AdviceLine why={adviceText} compact={false} />}
        <DecisionButtons choices={choices} advised={advice?.action ?? null} onPick={decide} variant="panel" keys={!touch} shake={btnShake} />
      </div>
    ) : phase === 'busy' ? (
      <ActionButton tone="neutral" onClick={hurry} sub={fast ? undefined : 'Click to hurry'}>
        Dealing… <Kbd>Space</Kbd>
      </ActionButton>
    ) : (
      <ActionButton onClick={deal} disabled={!canDeal} sub={dealSub}>
        {again ? 'Rebet & Deal' : 'Deal'} <Kbd>Space</Kbd>
      </ActionButton>
    )

  const panel = (
    <>
      <div className={G.bar ? 'hidden' : ''}>
        <Label right={<>{fmt(balance)}</>}>Chip value</Label>
        <div className="flex gap-1 rounded-lg bg-stage p-1.5">{chipPicker(false)}</div>
      </div>
      <div className="rounded-lg bg-stage px-3 py-2.5">
        <BetRow name="Ante" hint="A" value={shownBets.ante} onMinus={() => chipOn('ante', -1)} onPlus={() => chipOn('ante')} disabled={!betting} />
        <div className="flex items-center justify-between py-1.5">
          <span className="text-[13px] font-bold text-ink">
            Blind <span className="text-[11px] font-semibold text-dim">matches the Ante</span>
          </span>
          <span className="tnum pr-1 text-[14px] font-extrabold text-ink/80">{fmt(shownBets.ante)}</span>
        </div>
        <BetRow
          name="Trips"
          hint="T"
          value={shownBets.trips}
          onMinus={() => chipOn('trips', -1)}
          onPlus={() => chipOn('trips')}
          disabled={!betting}
          toggle={<Toggle on={shownBets.trips > 0} onChange={setTrips} disabled={!betting} label="Trips side bet" />}
        />
        {hand && hand.play > 0 && (
          <div className="flex items-center justify-between py-1.5">
            <span className="text-[13px] font-bold text-ink">Play {hand.play}×</span>
            <span className="tnum pr-1 text-[14px] font-extrabold text-ink/80">{fmt(round2(hand.ante * hand.play))}</span>
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between border-t border-white/[.06] pt-2">
          <span className="text-[12px] font-semibold text-muted">{hand ? 'On the table' : 'Total bet'}</span>
          <span className="tnum flex items-center gap-1.5 text-[16px] font-extrabold">
            {fmt(betTotal)} <Coin size={16} />
          </span>
        </div>
        {thin && (
          <div className="mt-1.5 text-[11.5px] font-semibold leading-snug text-[#ffd77a]">
            After the deal you'd have {fmt(Math.max(0, afterDeal))}: not enough for even a 1× Play bet ({fmt(bets.ante)}).
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2.5 rounded-lg bg-stage px-3 py-2.5">
        <ToggleRow title="Show advice" sub="The best move glows, with the reason" on={adviceOn} onChange={setAdvice} hint="H" />
        <ToggleRow title="Turbo" sub="Quicker dealing and showdown" on={turbo} onChange={setTurbo} />
      </div>
      <HistoryPanel hist={hist} />
      <button onClick={() => (sfx.click(), setInfo(true))} className="-my-2 self-start py-2 text-[12px] font-semibold text-muted transition hover:text-ink max-lg:-my-3 max-lg:py-3">
        How to play · pays · house edge
      </button>
      <div className="hidden text-[11px] font-semibold leading-relaxed text-dim lg:block [@media(max-height:980px)]:lg:hidden">
        Keys: Space deals and checks · 4 3 2 1 bet · C check · F fold · A and T add a chip · H advice.
      </div>
      {/* the deal and the decisions stay in view at the foot of the panel, however short the screen: an opaque foot with a
          hairline, so what scrolls under it reads as scrolled, not cut off */}
      <div
        className={`lg:sticky lg:bottom-0 lg:z-10 lg:-mx-4 lg:-mb-4 lg:mt-auto lg:border-t lg:border-white/[.07] lg:bg-panel2 lg:px-4 lg:pb-4 lg:pt-3.5 lg:shadow-[0_-16px_22px_-18px_rgba(0,0,0,.85)] ${G.bar ? 'hidden' : ''}`}
      >
        {mainAction}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const dealerPoint = useMemo(() => ({ x: G.W / 2, y: G.slots[2].y + G.slots[2].h / 2 }), [G])
  // the phone's bar: Deal on the right, the chips in what is left, all seven if each gets RACK_MIN, else a scrolling rack
  const dealW = G.phone ? (size.w < 380 ? 78 : 84) : 104
  const rackIn = size.w - 16 - 8 - dealW - 8
  const fitChip = Math.floor((rackIn - 6 * 2) / 7)
  const rackScrolls = G.phone && fitChip < RACK_MIN
  const chipBtn = !G.phone ? 40 : Math.max(RACK_MIN, Math.min(40, fitChip))
  const dealShort = betting && !canDeal

  const stage = (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      // a tap on the felt hurries the cards (a press on a button does its own thing)
      onClick={(e) => phaseRef.current === 'busy' && !(e.target as HTMLElement).closest('button') && hurry()}
    >
      {/* (the printed line steps back while the best five rise and are marked over it) */}
      <Felt G={G} hit={hit} print={!sd} />
      <Shoe G={G} />

      {!table && (
        <>
          {ALL.map((i) => (
            <Slot key={i} box={G.slots[i]} />
          ))}
          <SlotLabel boxes={G.slots.slice(2, 4)} text="Dealer" small={G.phone} />
          <SlotLabel boxes={G.slots.slice(4)} text="Board" small={G.phone} />
          <SlotLabel boxes={G.slots.slice(0, 2)} text="Your hand" small={G.phone} />
        </>
      )}

      <AnimatePresence>
        {table &&
          ALL.filter((i) => table.dealt[i]).map((i) => {
            const c = table.deck[i]
            const inP = showP && sd!.player.best.includes(c)
            const inD = !!sd && sd.dealer.best.includes(c)
            return (
              <HoldemCard
                key={`${table.id}-${i}`}
                card={c}
                box={G.slots[i]}
                from={table.fly ? G.fromShoe[i] : null}
                flight={flightS}
                up={table.up[i]}
                flipTime={flipS}
                markP={inP}
                markD={inD}
                lift={!!winBest && winBest.includes(c)}
                liftTone={winner === 'dealer' ? DEALER_TONE : GOLD}
                // the cards in neither hand settle back; folded hole cards too, unless Trips paid on them
                dim={(!!reveal?.verdict && !inP && !inD) || (folded && i < 2 && !(tripsWon && inP))}
                out={G.out[i]}
                z={i < 2 ? 4 : i < 4 ? 3 : 2}
              />
            )
          })}
      </AnimatePresence>

      <HandTag
        who="Dealer"
        words={dealerWords}
        tone={DEALER_TONE}
        status={sd ? (sd.qualifies ? { text: 'Qualifies', good: true } : { text: "Doesn't qualify", good: false }) : null}
        variant={G.phone ? 'line' : 'side'}
        align="right"
        {...G.tags.dealer}
        glow={winner === 'dealer'}
      />
      <HandTag
        who={folded ? 'You · folded' : 'You'}
        words={playerWords}
        tone={GOLD}
        variant={G.phone ? 'line' : 'side'}
        align="left"
        {...G.tags.player}
        glow={winner === 'player'}
        // on a phone the verdict joins the player's line
        lead={G.phone && sd && reveal!.verdict ? <VerdictInline sd={sd} /> : undefined}
      />
      <AnimatePresence>{!G.phone && sd && reveal!.verdict && <VerdictPlaque key={`v${table?.id ?? 0}`} sd={sd} {...G.tags.verdict} />}</AnimatePresence>

      <Circles
        x={G.circles.x}
        y={G.circles.y}
        d={G.circles.d}
        labelY={G.circles.labelY}
        small={G.phone}
        stakes={circ.stakes}
        wins={circ.wins}
        outcomes={circ.outcomes}
        leaving={circ.leaving}
        dealer={dealerPoint}
        stageH={size.h}
        options={options}
        interactive={betting}
        onPlace={onPlace}
        onRemove={onRemove}
        shake={shake}
      />

      {/* just above the bar (where the panel is below the stage): the advice while deciding; on a phone, where the
          verdict has no plaque, its note after the hand ("Blind pays 3 to 2 · Trips pays 6 to 1") */}
      {G.advice && (
        <div className="pointer-events-none absolute inset-x-2 z-30 grid -translate-y-full items-end justify-items-center" style={{ top: G.advice.bottom }}>
          {adviceOn && (
            <div className="col-start-1 row-start-1">
              <AdviceLine why={deciding ? adviceText : null} compact={G.phone} />
            </div>
          )}
          {G.phone && (
            <div className="col-start-1 row-start-1">
              <VerdictNoteLine sd={reveal?.verdict ? sd : null} />
            </div>
          )}
        </div>
      )}

      <AnimatePresence>
        {big && (
          <BigHand
            key={big.id}
            data={big}
            x={G.W / 2}
            // over the board; a phone's royal, with its count, sits a little higher so it clears the verdict line
            y={G.slots[4].y + G.slots[4].h * (G.phone && big.kind === 'hand' && big.rank === 'royal' ? 0.25 : 0.5)}
            narrow={G.phone}
            onDone={() => setBig(null)}
          />
        )}
      </AnimatePresence>

      {G.bar && (
        <div className={`absolute inset-x-0 bottom-0 z-30 flex items-center gap-2 px-2 pb-2 ${G.phone ? '' : 'justify-center'}`} style={{ height: G.barH + 6 }}>
          {phase === 'decide' && hand ? (
            <div className="w-full max-w-[560px]">
              <DecisionButtons choices={choices} advised={advice?.action ?? null} onPick={decide} variant="bar" keys={false} shake={btnShake} />
            </div>
          ) : phase === 'busy' ? (
            <button onClick={hurry} className="h-12 w-full max-w-[560px] rounded-lg bg-black/30 text-[13px] font-extrabold text-white/70">
              {fast ? 'Dealing…' : 'Dealing… tap to hurry'}
            </button>
          ) : (
            <>
              <ChipRack scrolls={rackScrolls} chip={chip} className={`rounded-lg bg-black/30 p-1 ${G.phone ? 'gap-0.5' : 'max-w-[420px] justify-between gap-1'}`}>
                {chipPicker(true, chipBtn)}
              </ChipRack>
              {/* (a tap on Deal when the bets are more than the balance still answers: Deal says why, with the way to Rewards) */}
              <motion.button
                whileTap={{ scale: 0.96 }}
                onClick={deal}
                disabled={!betting}
                aria-disabled={dealShort}
                style={{ width: dealW }}
                className={`flex h-12 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)] disabled:opacity-45 ${dealShort ? 'opacity-55 saturate-50' : ''}`}
              >
                <span className="text-[16px] font-extrabold leading-tight">{again ? 'Rebet' : 'Deal'}</span>
                <span className="tnum text-[10px] font-bold leading-tight opacity-75">{dealShort ? `Need ${coins(total(bets))}` : fmt(total(bets))}</span>
              </motion.button>
            </>
          )}
        </div>
      )}

      <AnimatePresence>
        {elsewhere && !held && (
          <motion.div key="elsewhere" className="absolute inset-0 z-50 flex items-center justify-center bg-[#040a1e]/80 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="max-w-[340px] rounded-2xl border border-gold/30 bg-panel px-6 py-5 text-center shadow-[0_24px_60px_-20px_rgba(0,0,0,.9)]">
              <div className="text-[18px] font-extrabold">Hold'em Showdown is open in another tab</div>
              <div className="mt-1.5 text-[13.5px] font-semibold text-muted">Play there, or close it: this tab picks your hand up as soon as it is free.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="sr-only" aria-live="polite">
        {say}
      </div>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100svh-150px-env(safe-area-inset-bottom))] max-sm:max-h-[820px] max-sm:min-h-[500px] sm:max-lg:h-[min(84vh,820px)] sm:max-lg:min-h-[560px]" />
      <AnimatePresence>{info && <HowToPlay onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- panel pieces ---------------- */

function BetRow({ name, hint, value, onMinus, onPlus, disabled, toggle }: { name: string; hint: string; value: number; onMinus: () => void; onPlus: () => void; disabled: boolean; toggle?: ReactNode }) {
  // (finger-sized where the panel sits under the stage: phones and tablets)
  const btn =
    'flex h-7 w-7 items-center justify-center rounded-md bg-raised text-[15px] font-extrabold text-ink transition hover:bg-hover active:scale-95 disabled:pointer-events-none disabled:opacity-35 max-lg:h-10 max-lg:w-10 max-lg:text-[18px]'
  const off = toggle != null && !value
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="flex items-center gap-2 text-[13px] font-bold text-ink">
        {toggle}
        {name}
        <kbd className="hidden rounded border border-line px-1 text-[10px] font-bold text-dim lg:inline">{hint}</kbd>
      </span>
      <span className="flex items-center gap-1.5">
        <button className={btn} onClick={onMinus} disabled={disabled || !value} aria-label={`Take a chip off ${name}`}>
          −
        </button>
        <span className={`tnum min-w-[64px] text-right text-[14px] font-extrabold ${off ? 'text-dim' : 'text-ink'}`}>{off ? 'Off' : fmt(value)}</span>
        <button className={btn} onClick={onPlus} disabled={disabled} aria-label={`Add a chip to ${name}`}>
          +
        </button>
      </span>
    </div>
  )
}

function ToggleRow({ title, sub, on, onChange, hint }: { title: string; sub: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      {/* (the words switch it too: a bigger target than the switch alone) */}
      <div className="min-w-0 flex-1 cursor-pointer select-none" onClick={() => (sfx.click(), onChange(!on))}>
        <div className="flex items-center gap-1.5 text-[13px] font-bold">
          {title}
          {hint && <kbd className="hidden rounded border border-line px-1 text-[10px] font-bold text-dim lg:inline">{hint}</kbd>}
        </div>
        <div className="text-[11px] text-dim">{sub}</div>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  )
}

/**
 * The phone bar's chip rack. When the seven chips don't fit at a finger's width it scrolls: the edge with chips past
 * it fades out (the cue that there are more), and the chosen chip is kept in view.
 */
function ChipRack({ scrolls, chip, className, children }: { scrolls: boolean; chip: number; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edge, setEdge] = useState({ start: true, end: false })
  const look = useCallback(() => {
    const el = ref.current
    if (el) setEdge({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 4 })
  }, [])
  useEffect(() => {
    const el = ref.current
    const on = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!scrolls || !el || !on) return
    // the chosen chip into view (the rack only: the page itself stays where it is)
    if (on.offsetLeft < el.scrollLeft) el.scrollLeft = on.offsetLeft - 8
    else if (on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = on.offsetLeft + on.offsetWidth - el.clientWidth + 8
    look()
  }, [scrolls, chip, look])
  const fade = 22
  const mask = !scrolls
    ? undefined
    : `linear-gradient(to right, ${edge.start ? 'black' : 'transparent'} 0, black ${fade}px, black calc(100% - ${fade}px), ${edge.end ? 'black' : 'transparent'} 100%)`
  return (
    <div ref={ref} onScroll={scrolls ? look : undefined} className={`no-scrollbar flex min-w-0 flex-1 overflow-x-auto ${className}`} style={{ maskImage: mask, WebkitMaskImage: mask }}>
      {children}
    </div>
  )
}
