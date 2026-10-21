import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, useStake, type PillTone } from '../../components/ui'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { BOARDS, CASES, ROUNDS, boardOf, closedOthers, deal, newGame, noDeal, open, payoutOf, pick, playOut, toOpen, unseen, type BoardId, type Game } from './rules'
import { ASPECT, Briefcase } from './Case'
import { PrizeColumn, PrizeRows, type BarSpec } from './PrizeBoard'
import { BankerBooth, OfferScreen, type OfferPhase } from './Banker'
import { BoardReveal, Celebration, FinalScreen, PrizeChip, Stamp, tierOf, type Face } from './Result'
import { Podium, RoundTrack, Studio, TierBadge } from './art'
import { InfoModal } from './Info'
import { dealSfx } from './sound'
import { STALE_MS, addHistory, dropSaved, gameKey, histKey, lastKey, loadHistory, loadLast, newId, readSaved, saveLast, storageWorks, takeSaved, writeSaved, type Last, type Past, type Saved } from './storage'
import { TIERS, chanceOf, coinText, isHigh, multText, oneIn, prizeCoins, rankOf, stepLine, topOf, unseenAverage } from './words'

/*
  Banker's Deal: a TV-studio briefcase show.

  The player sets a stake and presses Start: the stake is taken, tonight's board is drawn (Classic, Gold or Diamond;
  rules.ts) and revealed with ceremony (the badge flicks and lands; Gold and Diamond are events). The player picks a
  case to keep (it goes up on the podium), then opens the others round by round: each lid pops, the prize card rises
  out with the room's reaction (a cheer for a small prize gone, a groan for a big one) and its bar on the prize
  board turns dark. After each round the Banker's phone rings in his booth and his offer builds on the big screen:
  DEAL takes it, NO DEAL plays on; at the final two he makes a last offer and the player may also SWAP. Then the
  player's case opens to a drumroll (after a deal too, as what it would have paid), and the result is celebrated as
  it deserves.

  The money. A game is a decision game, so it waits for the player: it is kept per player in localStorage
  (storage.ts) and written synchronously after every move and before the move is shown, so a reload, a page that
  died or a visit next week finds it exactly where it was, and nothing can be re-rolled. It is paid exactly once,
  when it is over: the move that ends it takes the record out of storage (checking it is still there and still this
  game) and settles in the same moment. A tab re-reads the record before every move and acts only on the very state
  it shows; otherwise it adopts what storage holds (it also follows the storage event, so two tabs show one game and
  only one of them can pay it). A game untouched for STALE_MS is played out with every offer refused and paid on the
  next visit; one that can't be read is removed and its stake handed back. The game belongs to the player whose
  stake it took: signing in or out switches to that player's own game. Without working storage (a private window) a
  game lives in the page and is paid from there, once.

  Dev hooks (dev builds only): window.__dealBoard = 'classic' | 'gold' | 'diamond' sets the next game's board;
  window.__dealDraw = 'low' | 'high' makes every case opened (and the player's case) hold the smallest or largest
  prize left, until cleared.
*/

type How = 'deal' | 'final' | 'swap' | 'away' | 'stale'
type EndStage = 'stamp' | 'roll' | 'open' | 'other' | 'done'
const STAGES: EndStage[] = ['stamp', 'roll', 'open', 'other', 'done']
/** the finished game on show */
interface End extends Last {
  how: How
  stage: EndStage
}
type Banker = 'off' | 'ring' | 'build' | 'ready'

const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* ---------------- dev: forced boards and draws ---------------- */

function devBoardRng(): () => number {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __dealBoard?: unknown }
    const b = w.__dealBoard
    if (b === 'classic' || b === 'gold' || b === 'diamond') {
      delete w.__dealBoard
      const x = b === 'classic' ? 0 : b === 'gold' ? BOARDS[0].chance + BOARDS[1].chance / 2 : 1 - BOARDS[2].chance / 2
      let first = true
      return () => {
        if (!first) return rand()
        first = false
        return x
      }
    }
  }
  return rand
}
function drawRng(): () => number {
  if (import.meta.env.DEV) {
    const d = (window as unknown as { __dealDraw?: unknown }).__dealDraw
    if (d === 'low') return () => 0
    if (d === 'high') return () => 0.999999
  }
  return rand
}

/* ---------------- the stage's layout ---------------- */

function layoutOf(w: number, h: number) {
  const wide = w >= 640 && h >= 480
  if (wide) {
    const pad = 16
    const topH = 58
    const botH = Math.round(clamp(h * 0.24, 150, 205))
    const colW = Math.round(clamp(w * 0.145, 100, 138))
    const midTop = pad + topH + 4
    const midH = h - midTop - botH - 6
    const gap = Math.round(clamp(w * 0.016, 10, 18))
    const availW = w - 2 * colW - 4 * pad
    const cw = Math.floor(Math.min((availW - 3 * gap) / 4, ((midH - 3 * gap) / 4) * ASPECT, 150))
    const ch = cw / ASPECT
    const gw = 4 * cw + 3 * gap
    const gh = 4 * ch + 3 * gap
    const gx = (w - gw) / 2
    const gy = midTop + (midH - gh) / 2
    const barGap = 7
    const barH = Math.floor(Math.min(44, (midH - 7 * barGap) / 8))
    const colH = 8 * barH + 7 * barGap
    const botY = h - pad - botH
    const podW = Math.min(230, cw * 1.9)
    const podScale = 1.22
    const podTop = botY + botH * 0.66
    const sideW = (w - podW) / 2 - pad * 1.5
    // the big screen covers the cases, never the player's case on its podium
    const caseTop = podTop - ch * podScale + ch * 0.04
    const sy = Math.max(midTop - 4, gy - 16)
    return {
      wide,
      w,
      h,
      pad,
      top: { y: pad, h: topH },
      grid: { x: gx, y: gy, cw, ch, gap, w: gw, h: gh },
      cols: { w: colW, barH, gap: barGap, y: midTop + (midH - colH) / 2, left: pad, right: w - pad - colW },
      rows: null as null | { x: number; y: number; w: number; chipH: number; gap: number },
      pod: { cx: w / 2, top: podTop, w: podW, scale: podScale, cy: podTop - (ch * podScale) / 2 + ch * 0.04 },
      bot: { y: botY, h: botH, left: { x: pad, w: sideW }, right: { x: w - pad - sideW, w: sideW } },
      screen: { x: Math.max(pad + colW + 8, gx - 18), y: sy, w: Math.min(w - 2 * (pad + colW + 8), gw + 36), h: Math.min(midH + 8, gh + 32, caseTop - 10 - sy) },
      floorY: botY + 16,
    }
  }
  const pad = 8
  const topH = 40
  const chipH = 22
  const chipGap = 4
  const rowsY = pad + topH + 6
  const rowsH = chipH * 2 + chipGap
  const botH = h >= 560 ? 118 : 100
  const midTop = rowsY + rowsH + 10
  const midH = h - midTop - botH - pad
  const gap = 8
  const cw = Math.floor(Math.min((w - 2 * pad - 3 * gap) / 4, ((midH - 3 * gap) / 4) * ASPECT, 120))
  const ch = cw / ASPECT
  const gw = 4 * cw + 3 * gap
  const gh = 4 * ch + 3 * gap
  const gx = (w - gw) / 2
  const gy = midTop + (midH - gh) / 2
  const botY = h - pad - botH
  const podW = Math.min(124, w * 0.32)
  const podScale = Math.min(1.08, (botH - 34) / ch)
  const podTop = botY + botH * 0.72
  const podCx = pad + podW / 2 + 4
  return {
    wide,
    w,
    h,
    pad,
    top: { y: pad, h: topH },
    grid: { x: gx, y: gy, cw, ch, gap, w: gw, h: gh },
    cols: null as null | { w: number; barH: number; gap: number; y: number; left: number; right: number },
    rows: { x: pad, y: rowsY, w: w - 2 * pad, chipH, gap: chipGap },
    pod: { cx: podCx, top: podTop, w: podW, scale: podScale, cy: podTop - (ch * podScale) / 2 + ch * 0.04 },
    bot: { y: botY, h: botH, left: { x: pad, w: podW }, right: { x: pad + podW + 14, w: w - pad * 2 - podW - 14 } },
    screen: { x: pad, y: Math.max(rowsY + rowsH + 4, gy - 10), w: w - 2 * pad, h: Math.min(h - (rowsY + rowsH + 4) - botH - pad + 6, gh + 20) },
    floorY: botY + 10,
  }
}

/* ---------------- the page ---------------- */

export default function BankersDeal() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const betRef = useRef(bet)
  betRef.current = bet
  const [solo] = useState(() => !storageWorks())
  const [touch] = useState(isTouch)

  // the game in play (null: none), as storage holds it; the ref is the money path's view of it
  const [rec, setRecState] = useState<Saved | null>(null)
  const recRef = useRef<Saved | null>(null)
  const setRec = (r: Saved | null) => {
    recRef.current = r
    setRecState(r)
  }
  // a finished game on show
  const [end, setEndState] = useState<End | null>(null)
  const endRef = useRef<End | null>(null)
  const setEnd = (e: End | null) => {
    endRef.current = e
    setEndState(e)
  }
  const [reveal, setRevealState] = useState<BoardId | null>(null)
  const revealRef = useRef<BoardId | null>(null)
  const setReveal = (b: BoardId | null) => {
    revealRef.current = b
    setRevealState(b)
  }
  const [banker, setBankerState] = useState<Banker>('off')
  const bankerRef = useRef<Banker>('off')
  const setBanker = (b: Banker) => {
    bankerRef.current = b
    setBankerState(b)
  }
  /** cases opening now: 'live' while the lid swings and the card rises, 'shown' once its prize is out */
  const [anim, setAnim] = useState<Record<number, 'live' | 'shown'>>({})
  const [stamp, setStamp] = useState<{ text: string; face: Face; id: number } | null>(null)
  const [celebrate, setCelebrate] = useState<{ amount: number; mult: number; id: string } | null>(null)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const [note, setNote] = useState<{ text: string; id: number } | null>(null)
  const [hist, setHist] = useState<Past[]>(() => loadHistory(histKey(useAuth.getState().uid)))

  const keyRef = useRef(gameKey(uid))
  const uidRef = useRef(uid)
  uidRef.current = uid
  /** games this page has paid (the guard without storage) */
  const paid = useRef(new Set<string>())
  /** a short lock after a case is opened, so a double tap opens one */
  const openLock = useRef(false)
  /** the id of the show under way: a newer one (or a game adopted from another tab) cancels its steps */
  const show = useRef(0)
  /** a game another tab took, while its ending is awaited from storage */
  const waiting = useRef<{ id: string; timer: number } | null>(null)
  const timers = useRef<number[]>([])
  const alive = useRef(true)

  const [stageRef, size] = useSize<HTMLDivElement>()
  const L = layoutOf(size.w, size.h)

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const cancelShow = () => {
    show.current++
    timers.current.forEach(clearTimeout)
    timers.current = []
    openLock.current = false
  }
  const toast = (title: string, amount?: number) => useWallet.getState().pushToast(amount != null && amount > 0 ? { kind: 'win', title, amount } : { kind: 'info', title })
  const flash = (text: string) => {
    const id = Date.now()
    setNote({ text, id })
    later(3200, () => setNote((n) => (n && n.id === id ? null : n)))
  }

  /* ---------------- money: the game's record ---------------- */

  /** shows a game read from storage (another tab's move, a reload, a new visit), with nothing animating */
  const adopt = (next: Saved) => {
    const cur = recRef.current
    cancelShow()
    if (!cur || cur.id !== next.id) {
      setEnd(null)
      setReveal(null)
      setCelebrate(null)
      setStamp(null)
    }
    setAnim({})
    setRec(next)
    setBanker(next.game.step === 'offer' ? 'ready' : 'off')
  }

  /** a finished game, shown as it ended (paid elsewhere: another tab, or a stale game played out) */
  const showEnded = (l: Last, how: How) => {
    setRec(null)
    setBanker('off')
    setAnim({})
    setEnd({ ...l, how, stage: 'done' })
  }

  /** the game on show was taken out of storage by another tab (it paid it): show how it ended, once storage has it */
  const gone = (cur: Saved) => {
    cancelShow()
    setRec(null)
    setBanker('off')
    setAnim({})
    const l = loadLast(lastKey(cur.uid))
    if (l && l.id === cur.id) {
      showEnded(l, 'away')
      flash('This game was finished in another tab')
      return
    }
    if (waiting.current) clearTimeout(waiting.current.timer)
    waiting.current = {
      id: cur.id,
      timer: window.setTimeout(() => {
        waiting.current = null
        if (alive.current) flash('This game was finished in another tab')
      }, 2000),
    }
  }
  const checkWaiting = () => {
    const w = waiting.current
    if (!w) return
    const l = loadLast(lastKey(uidRef.current))
    if (l && l.id === w.id) {
      clearTimeout(w.timer)
      waiting.current = null
      showEnded(l, 'away')
      flash('This game was finished in another tab')
    }
  }

  /** a stored game that can't be read: removed, and its stake handed back (once: only the page that removes it) */
  const dropBad = (key: string, stakeBack: number | null) => {
    if (dropSaved(key) && stakeBack) {
      useWallet.getState().refund(stakeBack)
      toast("A saved Banker's Deal game couldn't be read: your stake was returned", stakeBack)
    }
  }

  /** follows storage: adopts a newer state of the game, or notices it is gone */
  const resync = () => {
    if (solo) return
    const key = gameKey(uidRef.current)
    if (key !== keyRef.current) return
    const r = readSaved(key)
    const cur = recRef.current
    if (r.kind === 'ok') {
      if (!cur || cur.id !== r.rec.id || r.rec.n > cur.n) adopt(r.rec)
    } else if (r.kind === 'none') {
      if (cur) gone(cur)
    } else if (authStatusRef.current !== 'loading') {
      dropBad(key, r.stake)
      if (cur) setRec(null)
    }
  }
  const authStatusRef = useRef(authStatus)
  authStatusRef.current = authStatus

  /**
   * The game as storage holds it, if it is exactly the state on show and belongs to whoever is signed in now: the only
   * state a move may be made on. Otherwise storage's state is shown instead and null returned (the press does nothing).
   */
  const current = (): Saved | null => {
    const cur = recRef.current
    if (!cur) return null
    if (gameKey(useAuth.getState().uid) !== keyRef.current) return null
    if (solo) return cur
    const r = readSaved(keyRef.current)
    if (r.kind === 'ok' && r.rec.id === cur.id && r.rec.n === cur.n) return r.rec
    resync()
    return null
  }

  /** a move made: stored first (synchronously), then shown */
  const commit = (cur: Saved, g: Game): Saved => {
    const next: Saved = { ...cur, game: g, n: cur.n + 1, at: Date.now() }
    if (!solo) writeSaved(keyRef.current, next)
    setRec(next)
    return next
  }

  /**
   * The game is over: taken out of storage (if it is still there and still this game) and paid, in one moment. False
   * if another tab took it first (nothing is paid here then).
   */
  const settleGame = (cur: Saved, g: Game, key: string): Last | null => {
    if (solo) {
      if (paid.current.has(cur.id)) return null
      paid.current.add(cur.id)
    } else if (!takeSaved(key, cur.id)) return null
    const payout = payoutOf(cur.stake, g)
    useWallet.getState().settle({ game: 'deal', bet: cur.stake, payout, meta: { board: g.board, dealt: g.dealt != null, result: g.result ?? 0, round: g.round } })
    const l: Last = { id: cur.id, stake: cur.stake, game: g, payout, t: Date.now() }
    // after the wallet's credit (a write here writes it first): how it ended, for this page, another tab and the strip
    saveLast(lastKey(cur.uid), l)
    const h = addHistory(histKey(cur.uid), { id: cur.id, t: l.t, board: g.board, stake: cur.stake, payout, result: g.result ?? 0, dealt: g.dealt != null })
    if (alive.current) setHist(h)
    return l
  }

  // The player's game: the one stored under their key (signing in or out switches to the new player's). Shown where
  // it was; a game untouched for a week is played out and paid, and one that can't be read is refunded, once sign-in
  // has settled so the money lands in the wallet that took the stake.
  useEffect(() => {
    const key = gameKey(uid)
    const switched = key !== keyRef.current
    keyRef.current = key
    // a new player (or the first look): whatever was on show was someone else's; once sign-in settles for the same
    // player, a game or an ending already on show is left as it is
    if (switched || (!recRef.current && !endRef.current && !revealRef.current)) {
      if (switched) {
        cancelShow()
        setEnd(null)
        setReveal(null)
        setBanker('off')
        setAnim({})
        setStamp(null)
        setCelebrate(null)
      }
      setHist(loadHistory(histKey(uid)))
      if (solo) {
        if (recRef.current && recRef.current.uid !== uid) setRec(null)
      } else {
        const r = readSaved(key)
        // a game left for a week is played out below, once sign-in has settled: it is not shown as resumed
        if (r.kind === 'ok' && Date.now() - r.rec.at <= STALE_MS) {
          setRec(r.rec)
          setBanker(r.rec.game.step === 'offer' ? 'ready' : 'off')
          flash('Your game is right where you left it')
          setSay(`Your game is back: ${stepLine(r.rec.game, toOpen(r.rec.game))}.`)
        } else setRec(null)
      }
    }
    if (authStatus === 'loading' || solo) return
    const r = readSaved(key)
    if (r.kind === 'bad') {
      dropBad(key, r.stake)
      setRec(null)
    } else if (r.kind === 'ok' && Date.now() - r.rec.at > STALE_MS) {
      const g = playOut(r.rec.game, rand)
      const l = settleGame(r.rec, g, key)
      if (l) {
        showEnded(l, 'stale')
        const when = new Date(r.rec.t).toLocaleDateString()
        toast(l.payout > 0 ? `Your Banker's Deal game from ${when} was played out (every offer refused) and paid` : `Your Banker's Deal game from ${when} was played out: the case was empty`, l.payout)
      }
    }
    // the helpers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authStatus])

  // another tab's moves, and coming back to a tab that missed some
  useEffect(() => {
    alive.current = true
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === keyRef.current) resync()
      else if (e.key === lastKey(uidRef.current)) checkWaiting()
    }
    const onShow = () => {
      if (document.visibilityState === 'visible') resync()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('pageshow', onShow)
    document.addEventListener('visibilitychange', onShow)
    return () => {
      alive.current = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', onShow)
      document.removeEventListener('visibilitychange', onShow)
      timers.current.forEach(clearTimeout)
      timers.current = []
      if (waiting.current) clearTimeout(waiting.current.timer)
    }
    // the handlers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the moves ---------------- */

  const busy = () => !!revealRef.current || (!!endRef.current && endRef.current.stage !== 'done')

  function start() {
    if (busy() || recRef.current) return
    const u = useAuth.getState().uid
    const key = gameKey(u)
    keyRef.current = key
    // one game at a time: a game already stored (another tab started it) is shown instead
    if (!solo) {
      const r = readSaved(key)
      if (r.kind === 'ok') return adopt(r.rec)
      if (r.kind === 'bad') dropBad(key, r.stake)
    }
    const amount = betRef.current
    if (useWallet.getState().balance < amount) return toast(NO_COINS)
    if (!stake(amount)) return
    const g = newGame(devBoardRng())
    const now = Date.now()
    const r: Saved = { v: 1, id: newId(), uid: u, stake: amount, game: g, n: 0, t: now, at: now }
    // stored before anything shows (the stake's write goes first: storage writes the wallet ahead of it)
    if (!solo) writeSaved(key, r)
    cancelShow()
    setEnd(null)
    setCelebrate(null)
    setStamp(null)
    setAnim({})
    setBanker('off')
    setRec(r)
    dealSfx.start()
    setReveal(g.board)
    setSay(`Game on: drawing tonight's board.`)
  }

  const revealDone = useCallback(() => {
    if (!revealRef.current) return
    const b = revealRef.current
    setReveal(null)
    setSay(`Tonight's board is ${TIERS[b].name}, top prize ${multText(topOf(b))}. Pick the case you will keep.`)
  }, [])

  function pickCase(i: number) {
    if (busy()) return
    const cur = current()
    if (!cur) return
    const g = pick(cur.game, i)
    if (g === cur.game) return
    commit(cur, g)
    dealSfx.pick()
    setSay(`You keep case ${i + 1}. Now open ${toOpen(g)} cases.`)
  }

  function openCase(i: number) {
    if (busy() || openLock.current) return
    const cur = current()
    if (!cur) return
    const g = open(cur.game, i, drawRng())
    if (g === cur.game) return
    commit(cur, g)
    const prize = g.opened[i]
    const id = show.current
    openLock.current = true
    dealSfx.latch()
    setAnim((a) => ({ ...a, [i]: 'live' }))
    later(380, () => {
      openLock.current = false
    })
    later(600, () => {
      if (show.current !== id) return
      dealSfx.prize(rankOf(g.board, prize))
      later(120, dealSfx.flip)
      setAnim((a) => ({ ...a, [i]: 'shown' }))
    })
    later(1400, () =>
      setAnim((a) => {
        const n = { ...a }
        delete n[i]
        return n
      }),
    )
    const coins = prizeCoins(cur.stake, prize)
    const left = toOpen(g)
    setSay(`Case ${i + 1} held ${fmt(coins)}.${g.step === 'offer' ? ' The Banker is calling.' : left ? ` ${left} more to open.` : ''}`)
    if (g.step === 'offer') call(id)
  }

  /** the Banker's call: the phone rings, the offer builds on the screen, the buttons come up */
  function call(id: number) {
    later(1300, () => {
      if (show.current !== id) return
      setBanker('ring')
      dealSfx.ring()
    })
    later(2900, () => {
      if (show.current !== id) return
      dealSfx.pickup()
      dealSfx.build(1.15)
      setBanker('build')
    })
    later(4150, () => {
      if (show.current !== id || bankerRef.current !== 'build') return
      dealSfx.offer()
      setBanker('ready')
    })
  }
  function skipCall() {
    if (bankerRef.current !== 'ring' && bankerRef.current !== 'build') return
    show.current++
    dealSfx.offer()
    setBanker('ready')
  }

  function takeDeal() {
    if (bankerRef.current !== 'ready' || busy()) return
    const cur = current()
    if (!cur || cur.game.step !== 'offer') return
    const g = deal(cur.game, drawRng())
    if (g.step !== 'over') return
    finish(cur, g, 'deal')
  }

  function refuse(swap: boolean) {
    if (bankerRef.current !== 'ready' || busy()) return
    const cur = current()
    if (!cur || cur.game.step !== 'offer') return
    const final = cur.game.round >= ROUNDS.length
    if (swap && !final) return
    const g = noDeal(cur.game, drawRng(), swap)
    if (g === cur.game) return
    if (g.step === 'over') return finish(cur, g, swap ? 'swap' : 'final')
    commit(cur, g)
    cancelShow()
    setBanker('off')
    const id = Date.now()
    setStamp({ text: 'NO DEAL!', face: 'red', id })
    dealSfx.noDeal()
    later(950, () => setStamp((s) => (s && s.id === id ? null : s)))
    if (g.step === 'offer') {
      // the last round is done: the final two, and the Banker's last call
      setSay('No deal. The final two: the Banker is calling with his last offer.')
      return call(show.current)
    }
    const n = toOpen(g)
    setSay(`No deal. Round ${g.round + 1}: open ${n} case${n > 1 ? 's' : ''}.`)
  }

  /** the last move: paid at once, then the ending plays (the stamp, the drumroll, the player's case, the other one) */
  function finish(cur: Saved, g: Game, how: How) {
    const l = settleGame(cur, g, keyRef.current)
    if (!l) return resync()
    cancelShow()
    const id = show.current
    setRec(null)
    setEnd({ ...l, how, stage: 'stamp' })
    const sid = Date.now()
    if (how === 'deal') {
      setStamp({ text: 'DEAL!', face: 'green', id: sid })
      dealSfx.deal()
    } else if (how === 'swap') {
      setStamp({ text: 'SWAP!', face: 'violet', id: sid })
      dealSfx.swap()
    } else {
      setStamp({ text: 'NO DEAL!', face: 'red', id: sid })
      dealSfx.noDeal()
    }
    const stage = (s: EndStage) => {
      if (show.current !== id || !endRef.current || endRef.current.id !== l.id) return false
      setEnd({ ...endRef.current, stage: s })
      return true
    }
    const mine = g.minePrize ?? 0
    const m = l.payout / l.stake
    const roll = how === 'swap' ? 2100 : 1150
    setSay(how === 'deal' ? `Deal! You sold your case for ${fmt(l.payout)}. Let's see what it held.` : how === 'swap' ? 'Swap! Opening your new case.' : 'No deal. Opening your case.')
    later(roll, () => {
      setStamp((s) => (s && s.id === sid ? null : s))
      setBanker('off')
      if (stage('roll')) dealSfx.drumroll(1.6)
    })
    later(roll + 1700, () => {
      if (!stage('open')) return
      dealSfx.cymbal()
      const good = g.dealt != null ? mine <= g.dealt : m >= 1
      dealSfx.reveal(g.dealt != null ? (good ? 1 : 0) : m, good)
      later(250, dealSfx.flip)
      const coins = prizeCoins(l.stake, mine)
      setSay(g.dealt != null ? `Your case held ${fmt(coins)}. ${mine <= g.dealt ? 'You beat the Banker!' : 'The Banker got a bargain.'}` : `Your case held ${fmt(coins)}.`)
    })
    const other = g.lastPrize != null
    const after = roll + 1700 + (other ? 1300 : 900)
    if (other) later(roll + 1700 + 1000, () => stage('other') && dealSfx.flip())
    later(after, () => {
      if (!stage('done')) return
      if (tierOf(m) >= 1) setCelebrate({ amount: l.payout, mult: m, id: l.id })
    })
  }

  /** the main button (and Space): start, or pick / open a case for the player */
  function press() {
    const cur = recRef.current
    if (!cur) return start()
    if (busy()) return
    const g = cur.game
    if (g.step === 'pick') return pickCase(Math.floor(rand() * CASES))
    if (g.step === 'open') {
      const free = closedOthers(g)
      if (free.length) openCase(free[Math.floor(rand() * free.length)])
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space' || (e.key === 'Enter' && tag !== 'BUTTON')) {
        e.preventDefault()
        if (e.repeat) return
        if (celebrate) return setCelebrate(null)
        if (bankerRef.current === 'ring' || bankerRef.current === 'build') return skipCall()
        if (recRef.current?.game.step === 'offer') return
        press()
      } else if (e.key === 'd' || e.key === 'D') takeDeal()
      else if (e.key === 'n' || e.key === 'N') refuse(false)
      else if (e.key === 's' || e.key === 'S') refuse(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- what the screen reads ---------------- */

  const view: Game | null = end ? end.game : (rec?.game ?? null)
  const viewStake = end ? end.stake : (rec?.stake ?? bet)
  const atLeast = (s: EndStage) => !!end && STAGES.indexOf(end.stage) >= STAGES.indexOf(s)
  const board: BoardId = view && !reveal ? view.board : 'classic'
  const prizes = boardOf(board).prizes
  const final = !!view && view.round >= ROUNDS.length && view.step === 'offer'

  // the prize board: a prize goes dark once a case has shown it
  const seen: number[] = []
  if (view && !reveal) {
    for (const [k, v] of Object.entries(view.opened)) if (anim[Number(k)] !== 'live') seen.push(v)
    if (end && atLeast('open') && view.minePrize != null) seen.push(view.minePrize)
    if (end && atLeast('other') && view.lastPrize != null) seen.push(view.lastPrize)
  }
  const taken = new Set<number>()
  for (const v of seen) {
    const k = prizes.findIndex((p, i) => p === v && !taken.has(i))
    if (k >= 0) taken.add(k)
  }
  const bars: BarSpec[] = prizes.map((p, k) => ({ k, coins: prizeCoins(viewStake, p), lit: !taken.has(k) }))

  const otherCase = end && view && view.lastPrize != null ? closedOthers(view)[0] : null
  const openedCount = view ? Object.keys(view.opened).length : 0
  const left = rec ? toOpen(rec.game) : 0
  const avg = rec ? prizeCoins(rec.stake, unseenAverage(rec.game)) : 0
  const bestLeft = rec ? prizeCoins(rec.stake, Math.max(...prizes.filter((_, k) => !taken.has(k)))) : 0
  const offerPhase: OfferPhase | null = rec && rec.game.step === 'offer' && banker !== 'off' ? banker : end && end.stage === 'stamp' && end.how !== 'away' && end.how !== 'stale' ? (end.how === 'deal' ? 'deal' : 'nodeal') : null
  const offerGame = rec?.game.step === 'offer' ? rec.game : end && end.stage === 'stamp' ? end.game : null
  const offerMult = rec?.game.step === 'offer' ? (rec.game.offer ?? 0) : end && end.stage === 'stamp' ? (end.game.offers[end.game.offers.length - 1] ?? 0) : 0
  const canPick = !busy() && rec?.game.step === 'pick'
  const canOpen = !busy() && rec?.game.step === 'open'
  const hype = banker === 'ring' || banker === 'build' || end?.stage === 'roll' ? 1 : board !== 'classic' ? 0.5 : 0
  const narrow = !L.wide
  const g = L.grid

  /* ---------------- panel ---------------- */

  const broke = balance < bet
  const offerReady = banker === 'ready' && rec?.game.step === 'offer'
  let action: ReactNode
  if (!rec && (!end || end.stage === 'done')) {
    action = broke ? (
      <ActionButton disabled sub="Lower your stake, or visit Rewards">
        Not enough coins
      </ActionButton>
    ) : (
      <ActionButton onClick={start} sub={`${fmt(bet)} stake · up to ${multText(topOf('diamond'))}`}>
        {end ? 'Play again' : 'Start'}
      </ActionButton>
    )
  } else if (reveal) {
    action = (
      <ActionButton tone="neutral" disabled sub="Classic, Gold or Diamond">
        Drawing the board…
      </ActionButton>
    )
  } else if (end) {
    action = (
      <ActionButton tone="neutral" disabled sub="Here it comes">
        Opening your case…
      </ActionButton>
    )
  } else if (rec?.game.step === 'pick') {
    action = (
      <ActionButton tone="neutral" onClick={press} sub={touch ? 'Or tap a case' : 'Or click a case · Space'}>
        Pick a case for me
      </ActionButton>
    )
  } else if (rec?.game.step === 'open') {
    action = (
      <ActionButton tone="neutral" onClick={press} sub={`${left} left this round${touch ? '' : ' · Space'}`}>
        Open a case for me
      </ActionButton>
    )
  } else if (offerReady && rec) {
    const o = prizeCoins(rec.stake, rec.game.offer ?? 0)
    action = (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <ActionButton onClick={takeDeal} sub={`Take ${fmt(o)}`}>
            Deal
          </ActionButton>
          <ActionButton tone="danger" onClick={() => refuse(false)} sub={final ? 'Open my case' : 'Play on'}>
            No Deal
          </ActionButton>
        </div>
        {final && (
          <ActionButton tone="neutral" onClick={() => refuse(true)} sub={`Take case ${(closedOthers(rec.game)[0] ?? 0) + 1}`}>
            Swap
          </ActionButton>
        )}
      </div>
    )
  } else {
    action = (
      <ActionButton tone="neutral" onClick={skipCall} sub="Tap to hurry him">
        The Banker is calling…
      </ActionButton>
    )
  }

  const historyItems = [...hist]
    .reverse()
    .slice(0, 14)
    .map((p) => ({
      key: p.id,
      tone: (p.result >= 5 ? 'gold' : p.result >= 1 ? 'win' : 'loss') as PillTone,
      style: p.result > 0 && p.result < 1 ? { background: '#2b475c', color: '#cfe0ee' } : p.result === 0 ? { background: '#2a1620', color: '#ff9aa8' } : undefined,
      label: (
        <span title={`${TIERS[p.board].name} · ${p.dealt ? 'deal' : 'own case'} · ${fmt(p.payout)}`}>
          {p.dealt && <span className="mr-1 opacity-60">D</span>}
          {multText(p.result)}
        </span>
      ),
    }))

  const panel = (
    <>
      <div className="max-lg:order-[-1]">
        <BetInput value={bet} onChange={setBet} disabled={!!rec || (!!end && end.stage !== 'done')} />
      </div>
      {rec && (
        <div className="rounded-xl bg-stage p-3 ring-1 ring-white/[.04]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted">Your game</span>
            <span className="tnum flex items-center gap-1 text-[12px] font-bold text-ink">
              {fmt(rec.stake)} <Coin size={13} />
            </span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-center">
            {[
              ['Average left', rec.game.step === 'pick' ? '—' : coinText(avg)],
              ['Best left', reveal ? '—' : coinText(bestLeft)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-panel2 px-1 py-1.5">
                <div className="text-[10.5px] font-semibold text-dim">{k}</div>
                <div className="tnum text-[14px] font-extrabold">{v}</div>
              </div>
            ))}
          </div>
          {rec.game.offers.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-dim">The Banker's offers</div>
              <div className="flex flex-wrap gap-1">
                {rec.game.offers.map((o, i) => (
                  <span key={i} className={`tnum rounded-md px-1.5 py-0.5 text-[11.5px] font-extrabold ${i === rec.game.offers.length - 1 ? 'bg-gold/15 text-gold' : 'bg-panel2 text-muted'}`}>
                    {coinText(prizeCoins(rec.stake, o))}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Tonight's board is one of</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works · return
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {BOARDS.map((b) => {
            const on = !!view && view.board === b.id && !reveal
            return (
              <div key={b.id} className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition ${on ? 'bg-raised ring-1 ring-gold/40' : 'bg-stage'}`}>
                <TierBadge board={b.id} size="sm" />
                <span className="tnum text-right text-[11.5px] font-bold leading-tight text-muted">
                  <span className="text-ink">top {multText(b.prizes[CASES - 1])}</span>
                  <br />
                  {b.id === 'classic' ? `${(b.chance * 100).toFixed(1)}% of games` : `${oneIn(chanceOf(b.id))} games`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      {historyItems.length > 0 && (
        <div>
          <Label>Recent games</Label>
          <HistoryPills items={historyItems} className="flex-wrap" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-lg:order-[-3] lg:sticky lg:bottom-0 lg:z-10 lg:order-last lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">{action}</div>
      <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Keys: D Deal, N No Deal, S Swap at the final two; Space starts, or opens a case for you.</p>
    </>
  )

  /* ---------------- stage ---------------- */

  const caseLook = (i: number): { look: 'closed' | 'open'; prize?: number; live: boolean; dim: boolean } => {
    if (!view || reveal) return { look: 'closed', live: false, dim: false }
    if (i in view.opened) return { look: 'open', prize: view.opened[i], live: anim[i] === 'live', dim: !anim[i] }
    if (end && i === view.mine) return atLeast('open') ? { look: 'open', prize: view.minePrize ?? 0, live: end.stage === 'open', dim: false } : { look: 'closed', live: false, dim: false }
    if (end && i === otherCase) return atLeast('other') ? { look: 'open', prize: view.lastPrize ?? 0, live: end.stage === 'other', dim: false } : { look: 'closed', live: false, dim: false }
    return { look: 'closed', live: false, dim: !!end }
  }

  const statusText = (() => {
    if (!view) return touch ? 'Set your stake below, then Start' : 'Set your stake, then Start'
    if (reveal) return 'Drawing tonight’s board…'
    if (end) {
      if (end.stage === 'stamp' || end.stage === 'roll') return end.how === 'deal' ? 'Let’s see what you sold…' : 'Opening your case…'
      return end.game.dealt != null ? 'Deal done' : 'Your case is open'
    }
    if (rec && rec.game.step === 'offer' && banker !== 'ready') return 'The Banker is calling…'
    return stepLine(view, left)
  })()

  const myNum = view?.mine != null ? view.mine + 1 : null

  // the end on the big screen
  let finalScreen: ReactNode = null
  if (end && end.stage === 'done') {
    const eg = end.game
    const mine = eg.minePrize ?? 0
    const coinsMine = prizeCoins(end.stake, mine)
    const m = end.payout / end.stake
    const dealt = eg.dealt != null
    const beat = dealt && mine < (eg.dealt ?? 0)
    const headline = dealt ? (beat ? 'GREAT DEAL!' : mine > (eg.dealt ?? 0) ? 'DEAL DONE' : 'DEAL!') : m >= 5 ? 'WHAT A CASE!' : m >= 1 ? 'WINNER!' : m >= 0.5 ? 'NOT BAD!' : 'TOUGH LUCK!'
    const face: Face = dealt ? 'green' : m >= 1 ? 'gold' : m >= 0.5 ? 'violet' : 'red'
    const last = eg.lastPrize != null ? prizeCoins(end.stake, eg.lastPrize) : null
    const verdict = dealt
      ? beat
        ? `You beat the Banker by ${fmt(end.payout - coinsMine)}`
        : mine > (eg.dealt ?? 0)
          ? `Your case was worth ${fmt(coinsMine - end.payout)} more`
          : 'Spot on: the offer matched your case'
      : end.how === 'swap' && last != null
        ? last > coinsMine
          ? `Your first case held ${fmt(last)}: the swap cost you`
          : `Your first case held ${fmt(last)}: the swap paid off`
        : end.how === 'stale'
          ? 'Played out for you: every offer refused'
          : last != null
            ? `The other case held ${fmt(last)}`
            : null
    // the best offer turned down (a game played to the end), or the deal taken among the offers
    const offers = eg.offers.map((o) => prizeCoins(end.stake, o))
    const bestIdx = offers.length ? offers.indexOf(Math.max(...offers)) : -1
    const rows = (
      <>
        {dealt && (
          <div className="flex items-center gap-2.5 text-[12px] font-bold text-white/60 sm:text-[14px]">
            Sold for <PrizeChip text={fmt(end.payout)} tone="deal" big />
          </div>
        )}
        <div className="flex items-center gap-2.5 text-[12px] font-bold text-white/60 sm:text-[14px]">
          {dealt ? 'Your case held' : `Case ${eg.mine! + 1} held`} <PrizeChip text={fmt(coinsMine)} tone={mine === topOf(eg.board) ? 'top' : isHigh(eg.board, mine) ? 'high' : 'low'} big={!dealt} />
        </div>
        {offers.length > 0 && (
          <div className="mt-1 flex max-w-full flex-wrap items-center justify-center gap-1">
            <span className="mr-0.5 text-[9.5px] font-black uppercase tracking-[0.14em] text-white/35 sm:text-[10px]">{dealt ? 'Offers' : 'Offers refused'}</span>
            {offers.map((o, i) => (
              <span key={i} className={`tnum rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold sm:text-[11.5px] ${dealt && i === offers.length - 1 ? 'bg-accent/20 text-accent' : !dealt && i === bestIdx ? 'bg-[#ffd45c]/15 text-[#ffd45c]' : 'bg-white/[.07] text-white/55'}`}>
                {coinText(o)}
              </span>
            ))}
          </div>
        )}
      </>
    )
    finalScreen = (
      <FinalScreen
        headline={headline}
        face={face}
        rows={rows}
        paid={end.payout}
        mult={m}
        verdict={verdict}
        narrow={narrow}
        action={
          broke ? (
            <ActionButton disabled sub="Lower your stake, or visit Rewards">
              Not enough coins
            </ActionButton>
          ) : (
            <ActionButton onClick={start} sub={`${fmt(bet)} stake${touch ? '' : ' · Space'}`}>
              Play again
            </ActionButton>
          )
        }
      />
    )
  }

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[#070914]">
      <Studio w={L.w} h={L.h} board={view && !reveal ? view.board : null} floorY={L.floorY} wide={L.wide} hype={hype} />

      {/* the top bar: tonight's board, the Banker's booth, help */}
      <div className="absolute z-20 flex items-center" style={{ left: L.pad, top: L.top.y, height: L.top.h }}>
        <AnimatePresence mode="wait">
          {view && !reveal ? (
            <motion.div key={view.board} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
              <TierBadge board={view.board} size={narrow ? 'sm' : 'md'} top={narrow ? undefined : `top ${multText(topOf(view.board))}`} />
            </motion.div>
          ) : (
            <motion.div key="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-white/60 ring-1 ring-white/10 sm:text-[12px]">
              {reveal ? 'Drawing…' : 'Banker’s Deal'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="absolute z-20 -translate-x-1/2" style={{ left: L.w / 2, top: L.top.y - (narrow ? 2 : 4) }}>
        <BankerBooth w={narrow ? 74 : 128} ringing={banker === 'ring'} talking={banker === 'build'} />
      </div>
      <button
        onClick={() => (sfx.click(), setInfo(true))}
        aria-label="How Banker's Deal works"
        className="absolute z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-[15px] font-black text-white/75 ring-1 ring-white/15 transition hover:bg-black/65 hover:text-white"
        style={{ right: L.pad, top: L.top.y + (L.top.h - 36) / 2 }}
      >
        ?
      </button>

      {/* the prize board */}
      {L.cols && (
        <>
          <motion.div key={`l${board}`} className="absolute z-10" style={{ left: L.cols.left, top: L.cols.y }} initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.45 }}>
            <PrizeColumn bars={bars.slice(0, 8)} w={L.cols.w} barH={L.cols.barH} gap={L.cols.gap} high={false} />
          </motion.div>
          <motion.div key={`r${board}`} className="absolute z-10" style={{ left: L.cols.right, top: L.cols.y }} initial={{ rotateY: -90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.45, delay: 0.08 }}>
            <PrizeColumn bars={bars.slice(8)} w={L.cols.w} barH={L.cols.barH} gap={L.cols.gap} high />
          </motion.div>
        </>
      )}
      {L.rows && (
        <motion.div key={`rows${board}`} className="absolute z-10" style={{ left: L.rows.x, top: L.rows.y }} initial={{ rotateX: 90, opacity: 0 }} animate={{ rotateX: 0, opacity: 1 }} transition={{ duration: 0.45 }}>
          <PrizeRows low={bars.slice(0, 8)} high={bars.slice(8)} w={L.rows.w} chipH={L.rows.chipH} gap={L.rows.gap} />
        </motion.div>
      )}

      {/* the podium, and the slot the player's case left */}
      <Podium x={L.pod.cx} y={L.pod.top} w={L.pod.w} lit={!!view && view.mine != null} />
      {view?.mine != null && (
        <div className="pointer-events-none absolute z-[5] flex items-center justify-center rounded-[10px] border-2 border-dashed border-white/15" style={{ left: g.x + (view.mine % 4) * (g.cw + g.gap), top: g.y + Math.floor(view.mine / 4) * (g.ch + g.gap) + g.ch * 0.15, width: g.cw, height: g.ch * 0.85 }}>
          <span className="text-[10px] font-black uppercase tracking-[0.16em] text-white/25 sm:text-[11px]">Your case</span>
        </div>
      )}
      <div className="pointer-events-none absolute z-[16] -translate-x-1/2 whitespace-nowrap" style={{ left: L.pod.cx, top: L.pod.top + L.pod.w * 0.2 }}>
        <div className={`rounded-full px-2.5 py-0.5 font-black uppercase tracking-[0.16em] ${myNum ? 'bg-[#ffd45c] text-[#2a1600]' : 'bg-black/40 text-white/45'} ${narrow ? 'text-[9px]' : 'text-[10.5px]'}`}>{myNum ? `Your case · ${myNum}` : 'Your case'}</div>
      </div>

      {/* the sixteen cases */}
      {Array.from({ length: CASES }, (_, i) => {
        const mine = !!view && view.mine === i
        const s = caseLook(i)
        const x = mine ? L.pod.cx - g.cw / 2 : g.x + (i % 4) * (g.cw + g.gap)
        const y = mine ? L.pod.cy - g.ch / 2 : g.y + Math.floor(i / 4) * (g.ch + g.gap)
        const clickable = (canPick && view?.mine == null) || (canOpen && !mine && !(i in (view?.opened ?? {})))
        const prize = s.prize
        const label = mine ? `Your case, number ${i + 1}${s.look === 'open' && prize != null ? `: ${fmt(prizeCoins(viewStake, prize))}` : ''}` : s.look === 'open' && prize != null ? `Case ${i + 1}, opened: ${fmt(prizeCoins(viewStake, prize))}` : `Case ${i + 1}`
        return (
          <motion.button
            key={i}
            type="button"
            aria-label={label}
            disabled={!clickable}
            onClick={() => (canPick ? pickCase(i) : openCase(i))}
            className={`absolute left-0 top-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#ffd45c] ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
            style={{ width: g.cw, height: g.ch, zIndex: mine ? 15 : s.live ? 13 : 10 }}
            initial={false}
            animate={{ x, y, scale: mine ? L.pod.scale : 1 }}
            whileHover={clickable ? { y: y - 5 } : undefined}
            whileTap={clickable ? { scale: 0.96 } : undefined}
            transition={{ type: 'spring', stiffness: 260, damping: 24 }}
          >
            {clickable && <span className="pointer-events-none absolute inset-[-3px] rounded-xl opacity-0 ring-2 ring-[#ffd45c]/70 transition-opacity duration-150 [button:hover>&]:opacity-100" />}
            {mine && <span className="pointer-events-none absolute inset-[-8%] rounded-[20px] bg-[radial-gradient(closest-side,rgba(255,212,92,.35),transparent)]" />}
            <Briefcase
              w={g.cw}
              n={i + 1}
              look={s.look}
              mine={mine}
              prize={prize != null ? coinText(prizeCoins(viewStake, prize)) : undefined}
              tone={prize != null && isHigh(view!.board, prize) ? 'high' : 'low'}
              top={prize != null && prize === topOf(view!.board)}
              live={s.live}
              dim={s.dim}
            />
          </motion.button>
        )
      })}

      {/* the status and the offers, either side of the podium (beside it on a phone) */}
      <div className="absolute z-[12] flex flex-col justify-center" style={{ left: L.wide ? L.bot.left.x : L.bot.right.x, top: L.bot.y, width: L.wide ? L.bot.left.w : L.bot.right.w, height: L.bot.h }}>
        <div className={`font-black leading-tight text-white ${narrow ? 'text-[14px]' : 'text-[19px]'}`}>
          <AnimatePresence mode="wait">
            <motion.span key={statusText} className="block" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
              {statusText}
            </motion.span>
          </AnimatePresence>
        </div>
        {view && !reveal && (
          <div className="mt-2">
            <RoundTrack opened={openedCount} round={Math.min(view.round, ROUNDS.length - 1)} final={view.round >= ROUNDS.length} compact={narrow || L.bot.left.w < 300} />
          </div>
        )}
        {!L.wide && rec && rec.game.offers.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <span className="text-[9.5px] font-black uppercase tracking-[0.12em] text-white/40">Offers</span>
            {rec.game.offers.map((o, i) => (
              <span key={i} className={`tnum rounded px-1 py-[1px] text-[10.5px] font-extrabold ${i === rec.game.offers.length - 1 ? 'bg-[#ffd45c]/20 text-[#ffd45c]' : 'bg-white/[.07] text-white/60'}`}>
                {coinText(prizeCoins(rec.stake, o))}
              </span>
            ))}
          </div>
        )}
        {!view && (
          <div className={`mt-1.5 font-bold text-white/50 ${narrow ? 'text-[11px]' : 'text-[12.5px]'}`}>
            Sixteen cases. Keep one, open the rest, and decide what the Banker's offers are worth.
          </div>
        )}
      </div>
      {L.wide && (
        <div className="absolute z-[12] flex flex-col justify-center" style={{ left: L.bot.right.x, top: L.bot.y, width: L.bot.right.w, height: L.bot.h }}>
          <div className="mb-1.5 text-right text-[10.5px] font-black uppercase tracking-[0.2em] text-white/45">The Banker's offers</div>
          <div className="flex flex-wrap justify-end gap-1.5">
            {(view?.offers ?? []).length === 0 ? (
              <span className="text-right text-[12px] font-bold text-white/35">{view ? 'His first call comes after 4 cases' : 'He calls after every round'}</span>
            ) : (
              view!.offers.map((o, i) => {
                const lastOne = i === view!.offers.length - 1
                return (
                  <motion.span
                    key={i}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`tnum flex flex-col items-center rounded-lg px-2 py-1 leading-none ring-1 ${lastOne ? 'bg-[#ffd45c]/15 text-[#ffd45c] ring-[#ffd45c]/40' : 'bg-white/[.06] text-white/70 ring-white/10'}`}
                  >
                    <span className="text-[9px] font-black text-white/40">{i < ROUNDS.length ? `R${i + 1}` : 'FINAL'}</span>
                    <span className="mt-0.5 text-[13px] font-black">{coinText(prizeCoins(viewStake, o))}</span>
                  </motion.span>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* the big screen: the Banker's offer, then the end */}
      <AnimatePresence>
        {offerPhase && offerGame && (
          <motion.div
            key="offer"
            className="absolute z-30"
            style={{ left: L.screen.x, top: L.screen.y, width: L.screen.w, height: L.screen.h }}
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, y: 16, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <OfferScreen
              phase={offerPhase}
              coins={prizeCoins(end ? end.stake : (rec?.stake ?? 0), offerMult)}
              mult={offerMult}
              avg={prizeCoins(end ? end.stake : (rec?.stake ?? 0), unseenAverage(offerGame))}
              best={prizeCoins(end ? end.stake : (rec?.stake ?? 0), Math.max(...unseen(offerGame)))}
              left={unseen(offerGame).map((p) => ({ coins: prizeCoins(end ? end.stake : (rec?.stake ?? 0), p), high: isHigh(offerGame.board, p) }))}
              earlier={offerGame.offers.slice(0, -1).map((o) => prizeCoins(end ? end.stake : (rec?.stake ?? 0), o))}
              final={offerGame.round >= ROUNDS.length}
              swapTo={rec && rec.game.step === 'offer' ? (closedOthers(rec.game)[0] ?? 0) + 1 : null}
              narrow={narrow}
              onDeal={takeDeal}
              onNoDeal={() => refuse(false)}
              onSwap={() => refuse(true)}
              onSkip={skipCall}
            />
          </motion.div>
        )}
        {finalScreen && !celebrate && (
          <motion.div
            key={`end${end!.id}`}
            className="absolute z-30 flex items-center"
            style={{ left: L.screen.x, top: L.screen.y, width: L.screen.w, height: L.screen.h }}
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 300, damping: 24, delay: 0.1 }}
          >
            {finalScreen}
          </motion.div>
        )}
      </AnimatePresence>

      {/* the moments */}
      <AnimatePresence>{reveal && <BoardReveal key="reveal" board={reveal} narrow={narrow} onDone={revealDone} />}</AnimatePresence>
      <AnimatePresence>{stamp && <Stamp key={stamp.id} text={stamp.text} face={stamp.face} narrow={narrow} />}</AnimatePresence>
      <AnimatePresence>{celebrate && <Celebration key={celebrate.id} amount={celebrate.amount} mult={celebrate.mult} narrow={narrow} onDone={() => setCelebrate(null)} />}</AnimatePresence>
      {end?.stage === 'roll' && (
        <motion.div className="pointer-events-none absolute z-[14] rounded-full" style={{ left: L.pod.cx - L.pod.w * 0.7, top: L.pod.cy - L.pod.w * 0.6, width: L.pod.w * 1.4, height: L.pod.w * 1.2, background: 'radial-gradient(closest-side, rgba(255,212,92,.4), transparent)' }} animate={{ opacity: [0.4, 1, 0.4], scale: [0.95, 1.05, 0.95] }} transition={{ duration: 0.5, repeat: Infinity }} />
      )}
      <AnimatePresence>
        {note && (
          <motion.div
            key={note.id}
            className="pointer-events-none absolute z-[40] -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-3.5 py-1.5 text-[12px] font-bold text-white ring-1 ring-white/10 backdrop-blur-sm sm:text-[13px]"
            style={{ left: L.w / 2, top: L.top.y + L.top.h + 4 }}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {note.text}
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
      <GameShell panel={panel} stage={stage} stageClass="max-lg:h-[min(660px,calc(100svh-120px))] max-lg:min-h-[500px] max-sm:h-[min(600px,calc(100svh-150px))] max-sm:min-h-[480px]" />
      <AnimatePresence>{info && <InfoModal onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}
