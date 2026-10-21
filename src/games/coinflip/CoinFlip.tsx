import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Segmented, Toggle, sleep, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { isMuted, sfx } from '../../lib/sound'
import { coinflipSfx } from './sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { CHALLENGE_MIN_BET, useWallet } from '../../store/wallet'
import { CoinArt } from './art'
import { SIDE_COLOR } from './faces'
import { MAX_FLIPS, PATTERNS, RTP, autoCall, chanceLabel, drawFlip, isPattern, isSide, ladder, multLabel, multiplier, oddsLabel, other, payoutFor, reachChance, shortMult, sideLetter, sideName, type Flip, type Pattern, type Side } from './rules'
import type { CoinScene } from './scene'

/*
  Coin Flip: call Heads (the Boje gem) or Tails (the crown), pay the bet and flip. A win doubles the streak's value
  (0.97 × 2^n): cash out, or call again and flip on; a loss ends the streak with nothing. Up to 16 flips; the
  sixteenth win cashes out by itself. Every flip is drawn the moment it is thrown (rules.ts) and the 3D scene acts it
  out with a flight worked out ahead (physics.ts) that lands on the drawn face.

  Money moves only on a deliberate press: taps in quick succession only hurry the show along, and for a moment after
  a streak ends a press only hurries. From each flip's draw the streak's value is kept as a pending payout (in memory
  and in localStorage), so it settles exactly once: on a cash-out, when a losing face shows, or straight away if the
  page is left mid-streak (cashed out at what it is worth, and said so). A streak paid that way is over even if the
  page turns out to stay (a cancelled navigation): it can't be flipped on or cashed out again. A streak whose page
  died without paying is paid on the next visit; a lost one is announced too.
*/

type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string; face: Side; wins: number }
const pendingKey = (uid: string | null) => `lumen.coinflip.pending.${uid ?? 'guest'}`
const NOTICE_KEY = 'lumen.coinflip.notice'
const SIDE_KEY = 'lumen.coinflip.side'
const TURBO_KEY = 'lumen.coinflip.turbo'
const AUTO_KEY = 'lumen.coinflip.auto'

/** how long a finished streak's result holds the button before a press can start the next one (ms) */
const RESULT_HOLD = 900
/** presses closer together than this are a burst: they only hurry (ms) */
const BURST = 340
/** a streak this long is a jackpot (and 16, the most, the biggest) */
const JACKPOT_AT = 10

interface Streak {
  id: number
  bet: number
  wins: number
  calls: Side[]
  faces: Side[]
  over: boolean
  cashed: boolean
  /** paid as the page began to leave (the amount), so it is over whatever happens next */
  paid: number | null
}
/** a finished streak, for the history row */
interface Past {
  id: number
  wins: number
  cashed: boolean
  face: Side
}
type Phase = 'idle' | 'flight' | 'after'
type Headline =
  | { id: number; kind: 'win'; face: Side; wins: number; mult: number; amount: number }
  | { id: number; kind: 'lose'; face: Side; call: Side; wins: number; lost: number }
  | { id: number; kind: 'cash'; wins: number; mult: number; amount: number; note?: string }
  | { id: number; kind: 'jackpot'; wins: number; mult: number; amount: number; tier: number }

/** the jackpot's tier by streak: 10 to 12, 13 to 15, all sixteen */
const tierOf = (n: number) => (n >= MAX_FLIPS ? 3 : n >= 13 ? 2 : n >= JACKPOT_AT ? 1 : 0)
const TIER_NAME = ['', 'JACKPOT', 'MEGA JACKPOT', 'LEGENDARY']
/** the win's shout by streak */
const winShout = (n: number) => (n >= 12 ? 'UNSTOPPABLE!' : n >= 9 ? 'BLAZING!' : n >= 6 ? 'ON FIRE!' : n >= 3 ? 'HOT STREAK!' : null)
/** an amount, shortened past a million */
const money = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : fmt(n))
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

// dev only: window.__coinForce = 'win' | 'lose' plays that next
function forced(f: Flip): Flip {
  const v = (window as unknown as { __coinForce?: string }).__coinForce
  if (v !== 'win' && v !== 'lose') return f
  const win = v === 'win'
  return { call: f.call, win, face: win ? f.call : other(f.call) }
}

export default function CoinFlip() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const master = useWallet((s) => s.challenges['coinflip-streak'])
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [side, setSide] = useState<Side>(() => {
    const s = safeStorage.getItem(SIDE_KEY)
    return isSide(s) ? s : 'heads'
  })
  const [turbo, setTurbo] = useState(() => safeStorage.getItem(TURBO_KEY) === '1')
  const [auto0] = useState(() => {
    try {
      const a = JSON.parse(safeStorage.getItem(AUTO_KEY) ?? '{}') as { target?: number; pattern?: Pattern }
      return { target: Math.min(MAX_FLIPS, Math.max(1, Math.round(a.target ?? 2))), pattern: isPattern(a.pattern) ? a.pattern : ('same' as Pattern) }
    } catch {
      return { target: 2, pattern: 'same' as Pattern }
    }
  })
  const [target, setTarget] = useState(auto0.target)
  const [pattern, setPattern] = useState<Pattern>(auto0.pattern)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [streak, setStreak] = useState<Streak | null>(null)
  const [past, setPast] = useState<Past[]>([])
  const [headline, setHeadline] = useState<Headline | null>(null)
  const [called, setCalled] = useState<Side | null>(null)
  const [queued, setQueued] = useState(false)
  const [info, setInfo] = useState(false)
  const [endedAt, setEndedAt] = useState(0)
  const [, setTick] = useState(0)
  const [autoRunNo, setAutoRunNo] = useState(0)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [touch] = useState(isTouch)

  const hostRef = useRef<HTMLDivElement>(null)
  const ladderRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CoinScene | null>(null)
  const alive = useRef(true)
  const readyRef = useRef(false)
  const busyRef = useRef(false)
  const streakRef = useRef<Streak | null>(null)
  const pending = useRef<Pending | null>(null)
  const seq = useRef(1)
  const autoRef = useRef(false)
  const autoStop = useRef(false)
  const autoSide = useRef<Side>('heads')
  const queuedRef = useRef(false)
  const headTimer = useRef(0)
  const endedRef = useRef(0)
  const lastPress = useRef(0)
  const lastBroke = useRef(0)
  const lastFace = useRef<Side | null>(null)
  const music = useRef<ReturnType<typeof coinflipSfx.music>>(null)
  const reconcileRef = useRef<() => void>(() => {})
  const live = useRef({ bet, side, turbo, target, pattern, uid, phase, mode })
  live.current = { bet, side, turbo, target, pattern, uid, phase, mode }

  /** pays the streak in play, once: on a cash-out, when a losing face shows, or as soon as the player leaves */
  const settlePending = () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'coinflip', bet: p.bet, payout: p.payout, meta: p.meta })
    return p
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let on = true
    const host = hostRef.current!
    let sc: CoinScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ CoinScene }) => {
        if (!on) return
        setProgress(0.08)
        sc = new CoinScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __coin?: CoinScene }).__coin = sc
        sc.setTurbo(live.current.turbo)
        sc.onProgress = (p) => alive.current && setProgress(0.08 + p * 0.92)
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          setBox({ w: r.width, h: r.height })
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!on || !sc) return
          readyRef.current = true
          lastFace.current = sc.face
          setReady(true)
        })
      })
      .catch(() => on && setFailed(true))
    return () => {
      on = false
      alive.current = false
      readyRef.current = false
      ro?.disconnect()
      clearTimeout(headTimer.current)
      music.current?.stop()
      music.current = null
      if (import.meta.env.DEV) {
        const w = window as unknown as { __coin?: CoinScene }
        if (w.__coin === sc) delete w.__coin
      }
      sc?.dispose()
      sceneRef.current = null
      // leaving mid-streak cashes it out at what it is worth (or pays the flip already in the air), and says so
      const p = settlePending()
      if (p && streakRef.current) {
        if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your Coin Flip streak was cashed out as you left', amount: p.payout })
        else useWallet.getState().pushToast({ kind: 'info', title: lostLine(p.face, p.wins) })
      }
    }
    // the scene lives as long as the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setTurbo(turbo)
    safeStorage.setItem(TURBO_KEY, turbo ? '1' : '0')
  }, [turbo])
  useEffect(() => safeStorage.setItem(AUTO_KEY, JSON.stringify({ target, pattern })), [target, pattern])
  useEffect(() => {
    if (!endedAt) return
    const t = window.setTimeout(() => alive.current && setTick((n) => n + 1), RESULT_HOLD + 20)
    return () => clearTimeout(t)
  }, [endedAt])

  // the streak's music follows the streak (and the mute switch)
  const wins = streak && !streak.over ? streak.wins : 0
  useEffect(() => {
    const sync = () => {
      if (wins > 0 && !isMuted()) {
        music.current ??= coinflipSfx.music()
        music.current?.set(wins)
      } else if (music.current) {
        music.current.stop()
        music.current = null
      }
    }
    sync()
    if (wins <= 0) return
    const t = window.setInterval(sync, 600)
    return () => clearInterval(t)
  }, [wins])

  // Reloading, closing the tab or going to another site mid-streak pays it on the way out (not on a mere tab switch:
  // the header balance would give the result away). The next visit says what happened. If the page stays after all
  // (a cancelled navigation), the streak it paid is over: it is wound up on screen, never flipped on or paid again.
  useEffect(() => {
    const onHide = () => {
      const s = streakRef.current
      const p = settlePending()
      if (!p) return
      safeStorage.setItem(NOTICE_KEY, JSON.stringify({ amount: p.payout, face: p.face, wins: p.wins }))
      if (s && !s.over) {
        s.paid = p.payout
        // timers don't run once the page is gone: this only fires if it stayed
        window.setTimeout(() => reconcileRef.current(), 300)
      }
    }
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) reconcileRef.current()
    }
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pageshow', onShow)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pageshow', onShow)
    }
    // settlePending only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a streak whose page went away with no chance to pay it is paid on the next visit, into the wallet that staked it;
  // one that was paid (or lost) on the way out is announced
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
    const n = safeStorage.getItem(NOTICE_KEY)
    if (n != null) {
      safeStorage.removeItem(NOTICE_KEY)
      try {
        const o = JSON.parse(n) as { amount?: number; face?: unknown; wins?: number }
        const amount = Number(o.amount)
        if (amount > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your last Coin Flip streak was cashed out when you left', amount })
        else if (isSide(o.face)) useWallet.getState().pushToast({ kind: 'info', title: lostLine(o.face, Number(o.wins) || 0) })
      } catch {
        /* a damaged notice */
      }
    }
    const key = pendingKey(uid)
    const raw = safeStorage.getItem(key)
    if (raw == null) return
    safeStorage.removeItem(key)
    let p: Partial<Pending> | null = null
    try {
      p = JSON.parse(raw)
    } catch {
      /* a damaged entry */
    }
    if (typeof p?.bet !== 'number' || typeof p.payout !== 'number') return
    useWallet.getState().settle({ game: 'coinflip', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Coin Flip streak was cashed out', amount: p.payout })
    else if (isSide(p.face)) useWallet.getState().pushToast({ kind: 'info', title: lostLine(p.face, Number(p.wins) || 0) })
  }, [authStatus, uid])

  /* ---------------- calling ---------------- */

  const active = !!streak && !streak.over
  const choose = (s: Side, quiet = false) => {
    if (autoRef.current || live.current.phase === 'flight') return
    if (s !== live.current.side && !quiet) coinflipSfx.pick(s)
    setSide(s)
    live.current.side = s
    safeStorage.setItem(SIDE_KEY, s)
  }

  /* ---------------- a flip ---------------- */

  const say = (h: Headline, ms: number) => {
    clearTimeout(headTimer.current)
    setHeadline(h)
    if (ms > 0) headTimer.current = window.setTimeout(() => alive.current && setHeadline((x) => (x?.id === h.id ? null : x)), ms)
  }
  const sp = () => (live.current.turbo ? 0.6 : 1)

  const endStreak = (s: Streak, face: Side) => {
    s.over = true
    streakRef.current = null
    setStreak({ ...s, calls: [...s.calls], faces: [...s.faces] })
    setPast((xs) => [{ id: s.id, wins: s.wins, cashed: s.cashed, face }, ...xs].slice(0, 16))
    queuedRef.current = false
    setQueued(false)
    endedRef.current = performance.now()
    setEndedAt(endedRef.current)
  }

  /** the cash-out's show: the sunburst, the coins, the sound, the headline (or a jackpot's celebration) */
  const showCash = (s: Streak, amount: number, note?: string) => {
    const mult = multiplier(s.wins)
    const tier = tierOf(s.wins)
    const sc = sceneRef.current
    sc?.setStreak(0, true)
    sc?.cashout(mult)
    coinflipSfx.cashout(mult)
    if (tier) {
      sc?.jackpot(tier)
      coinflipSfx.jackpot(tier)
      say({ id: seq.current++, kind: 'jackpot', wins: s.wins, mult, amount, tier }, (autoRef.current ? 2600 : 4400) + tier * (tier >= 3 ? 1400 : 900))
    } else say({ id: seq.current++, kind: 'cash', wins: s.wins, mult, amount, note }, note ? 3600 : autoRef.current ? 1500 * sp() : 2600 * sp())
  }

  /** cashes the streak out at what it is worth now (the sixteenth win does it by itself) */
  const cashOut = () => {
    const s = streakRef.current
    if (!alive.current || !s || s.wins < 1 || live.current.phase === 'flight') return
    if (s.paid != null) return reconcileRef.current()
    const amount = payoutFor(s.bet, s.wins)
    if (pending.current) pending.current.meta = { flips: s.wins, cashed: true, sides: s.calls.map(sideLetter).join('') }
    settlePending()
    s.cashed = true
    endStreak(s, s.faces[s.faces.length - 1] ?? 'heads')
    showCash(s, amount)
  }

  /**
   * A streak paid as the page began to leave, on a page that stayed: it is over. Shown as the cash-out it was (or,
   * if its last flip lost, the loss shows as usual). Waits for a coin in the air to land.
   */
  const reconcile = () => {
    const s = streakRef.current
    if (!alive.current || !s || s.paid == null || live.current.phase === 'flight') return
    finishPaid(s)
  }
  reconcileRef.current = reconcile
  const finishPaid = (s: Streak) => {
    const amount = s.paid ?? 0
    safeStorage.removeItem(NOTICE_KEY)
    s.cashed = amount > 0
    endStreak(s, s.faces[s.faces.length - 1] ?? 'heads')
    if (autoRef.current) stopAuto()
    if (amount > 0) {
      showCash(s, amount, 'paid as the page began to close')
      useWallet.getState().pushToast({ kind: 'win', title: 'Your Coin Flip streak was cashed out as the page began to close', amount })
    } else sceneRef.current?.setStreak(0, true)
  }

  /** a press that would start a streak: refused (with one toast, not a stack of them) when the bet can't be covered */
  const canAfford = (unit: number) => {
    if (useWallet.getState().balance >= unit) return true
    const now = performance.now()
    if (now - lastBroke.current > 3500) {
      lastBroke.current = now
      useWallet.getState().pushToast({ kind: 'info', title: 'Not enough coins for this bet. Lower it, or visit Rewards.' })
    }
    return false
  }

  /** throws the coin once, starting (and staking) a streak if none is on; resolves when the coin lies still */
  const flipOnce = async (call: Side): Promise<{ win: boolean; s: Streak } | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !readyRef.current) return null
    let s = streakRef.current
    if (s && s.paid != null) {
      reconcile()
      return null
    }
    busyRef.current = true
    if (!s) {
      const unit = live.current.bet
      if (!canAfford(unit) || !stake(unit)) {
        busyRef.current = false
        return null
      }
      s = { id: seq.current++, bet: unit, wins: 0, calls: [], faces: [], over: false, cashed: false, paid: null }
      streakRef.current = s
      setStreak({ ...s })
    }
    setPhase('flight')
    live.current.phase = 'flight'
    setHeadline(null)
    setCalled(call)
    let flip = drawFlip(call, rand)
    if (import.meta.env.DEV) flip = forced(flip)
    const before = s.wins
    const after = flip.win ? before + 1 : before
    // what the streak pays if it ends now, stored before the coin leaves the table so even a page that dies can't lose it
    const payout = flip.win ? payoutFor(s.bet, after) : 0
    const meta = { flips: s.calls.length + 1, cashed: flip.win, sides: [...s.calls, call].map(sideLetter).join('') }
    const key = pendingKey(live.current.uid)
    pending.current = { bet: s.bet, payout, meta, key, face: flip.face, wins: after }
    safeStorage.setItem(key, JSON.stringify({ bet: s.bet, payout, meta, face: flip.face, wins: after }))
    const theStreak = s
    let shown = false
    const result = () => {
      if (shown) return
      shown = true
      theStreak.calls.push(call)
      theStreak.faces.push(flip.face)
      theStreak.wins = after
      lastFace.current = flip.face
      if (!alive.current) return
      setPhase('after')
      live.current.phase = 'after'
      if (theStreak.paid != null) safeStorage.removeItem(NOTICE_KEY)
      if (!flip.win) {
        // the streak is over: it pays nothing
        settlePending()
        theStreak.cashed = false
        endStreak(theStreak, flip.face)
        music.current?.stop(true)
        music.current = null
        sceneRef.current?.lost(before)
        sceneRef.current?.setStreak(0, true)
        coinflipSfx.lose(before)
        if (autoRef.current && theStreak.paid != null) stopAuto()
        say({ id: seq.current++, kind: 'lose', face: flip.face, call, wins: before, lost: before > 0 ? payoutFor(theStreak.bet, before) : theStreak.bet }, (autoRef.current ? 1400 : 2400) * sp())
        return
      }
      if (theStreak.paid != null) return finishPaid(theStreak)
      setStreak({ ...theStreak, calls: [...theStreak.calls], faces: [...theStreak.faces] })
      coinflipSfx.win(after)
      sceneRef.current?.setStreak(after)
      if (after >= MAX_FLIPS) cashOut()
      else say({ id: seq.current++, kind: 'win', face: flip.face, wins: after, mult: multiplier(after), amount: payoutFor(theStreak.bet, after) }, (autoRef.current ? 1100 : 2200) * sp())
    }
    try {
      await sc.toss(flip.face, { streak: before, win: flip.win }, { result })
    } catch {
      // never expected: a scene error must not lock the game
    }
    result()
    if (!alive.current) return { win: flip.win, s: theStreak }
    busyRef.current = false
    setPhase('idle')
    live.current.phase = 'idle'
    setCalled(null)
    if (queuedRef.current && !autoRef.current && streakRef.current === theStreak) {
      queuedRef.current = false
      setQueued(false)
      void flipOnce(live.current.side)
    }
    return { win: flip.win, s: theStreak }
  }

  /**
   * The big button, Space and a tap on the stage. Whatever is on screen, a press only ever does one of: flip (the
   * coin is at rest), line the next flip up (a win is showing and the streak goes on), start a new streak (the last
   * one ended a moment ago and this isn't a burst of taps), or hurry the show along.
   */
  const press = () => {
    if (!readyRef.current || autoRef.current) return
    const sc = sceneRef.current
    const now = performance.now()
    const burst = now - lastPress.current < BURST
    lastPress.current = now
    const s = streakRef.current
    if (burst) {
      if (queuedRef.current) {
        queuedRef.current = false
        setQueued(false)
      }
      sc?.hurry()
      return
    }
    if (live.current.phase === 'flight') {
      sc?.hurry()
      return
    }
    if (live.current.phase === 'after') {
      // the result is showing and the coin is settling: line the next flip up (or take it back)
      if (s) {
        queuedRef.current = !queuedRef.current
        setQueued(queuedRef.current)
        sfx.click()
      }
      sc?.hurry()
      return
    }
    if (!s && now - endedRef.current < RESULT_HOLD) {
      sc?.hurry()
      return
    }
    if (busyRef.current) return
    void flipOnce(live.current.side)
  }

  /* ---------------- auto ---------------- */

  /** one whole streak: flip until the target (cash out) or a loss */
  const autoRound = async (): Promise<number | null> => {
    setAutoRunNo((n) => n + 1)
    let i = 0
    const call = () => {
      // calls follow the side the player chose when the run started (the tiles show each call as it is made)
      const c = autoCall(live.current.pattern, autoSide.current, i++, lastFace.current, Math.random)
      setSide(c)
      return c
    }
    let out = await flipOnce(call())
    if (!out) return null
    const s = out.s
    while (out && out.win && streakRef.current === s && s.wins < live.current.target && !autoStop.current && alive.current) {
      await sleep(live.current.turbo ? 120 : 320)
      if (!alive.current) return null
      out = await flipOnce(call())
    }
    if (!alive.current) return null
    if (streakRef.current === s && s.wins >= live.current.target) cashOut()
    // stopped mid-streak: the player takes over from here, and is told so
    if (streakRef.current === s) {
      setMode('manual')
      useWallet.getState().pushToast({ kind: 'info', title: `Auto stopped. Your ${s.wins}-win streak (${money(payoutFor(s.bet, s.wins))}) is still live: cash out or flip again.` })
      return 0
    }
    // a jackpot gets its moment before the next streak
    if (s.cashed && tierOf(s.wins)) await sleep((live.current.turbo ? 2800 : 4000) + tierOf(s.wins) * 900)
    return s.cashed ? payoutFor(s.bet, s.wins) - s.bet : -s.bet
  }
  const auto = useAutoBet(autoRound, turbo ? 650 : 1100)
  autoRef.current = auto.running
  useEffect(() => sceneRef.current?.setAuto(auto.running), [auto.running])
  const startAuto = () => {
    if (!canAfford(bet)) return
    autoSide.current = side
    autoStop.current = false
    setAutoRunNo(0)
    void auto.start()
  }
  // when a run ends, the tiles go back to the side the player chose
  const autoWas = useRef(false)
  useEffect(() => {
    if (autoWas.current && !auto.running) setSide(autoSide.current)
    autoWas.current = auto.running
  }, [auto.running])
  function stopAuto() {
    autoStop.current = true
    auto.stop()
    // the coin in the air needn't keep the player waiting
    sceneRef.current?.hurry()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || e.metaKey || e.ctrlKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'h' || k === 't') {
        choose(k === 'h' ? 'heads' : 'tails')
        return
      }
      if (e.code === 'Space' || (e.key === 'Enter' && tag !== 'BUTTON')) {
        e.preventDefault()
        if (e.repeat) return
        if (autoRef.current) sceneRef.current?.hurry()
        else if (live.current.mode === 'manual' || streakRef.current || busyRef.current) press()
        return
      }
      if (k === 'c' && !autoRef.current) cashOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the ladder keeps the next step in view
  useEffect(() => {
    const el = ladderRef.current
    if (!el) return
    const step = el.querySelector<HTMLElement>(`[data-step="${Math.min(MAX_FLIPS - 1, wins)}"]`)
    if (!step) return
    if (el.scrollWidth > el.clientWidth + 2) el.scrollTo({ left: step.offsetLeft - el.clientWidth / 2 + step.clientWidth / 2, behavior: 'smooth' })
    if (el.scrollHeight > el.clientHeight + 2) el.scrollTo({ top: step.offsetTop - el.clientHeight / 2 + step.clientHeight / 2, behavior: 'smooth' })
  }, [wins, streak?.id])

  /* ---------------- layout ---------------- */

  const narrow = box.w < 560
  /** a roomy stage (desktop): the choices sit on the table under the coin, and the panel shows the streak */
  const roomy = !narrow && box.h >= 560
  const unit = active ? streak!.bet : bet
  const nowValue = active && wins > 0 ? payoutFor(unit, wins) : 0
  const nextValue = payoutFor(unit, Math.min(MAX_FLIPS, wins + 1))
  const locked = active || phase !== 'idle' || auto.running
  const canCash = active && wins > 0 && phase !== 'flight' && !auto.running
  const holding = !active && endedAt > 0 && performance.now() - endedAt < RESULT_HOLD
  const broke = !active && balance < bet
  const last = streak && streak.over ? streak : null
  const masterOpen = !master || (master.progress < 1 && !master.claimed)
  const jackpotUp = headline?.kind === 'jackpot'

  /* ---------------- panel ---------------- */

  let action: ReactNode
  if (auto.running) {
    action = (
      <ActionButton tone="danger" className="min-h-[58px]" onClick={stopAuto} sub={`Streak ${Math.max(1, autoRunNo)}${auto.cfg.count ? ` of ${auto.cfg.count}` : ''} · ${wins} of ${target} win${target > 1 ? 's' : ''}`}>
        Stop autobet
      </ActionButton>
    )
  } else if (active && roomy) {
    // the choices are on the table, right under the coin
    action = null
  } else if (active && wins > 0) {
    const cashLabel = `Cash out ${money(nowValue)}`
    action = (
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="gold" className="min-h-[60px] !px-2" onClick={() => cashOut()} disabled={!canCash} sub={<span className="tnum">{multLabel(multiplier(wins))} · C</span>}>
          <span className={`tnum whitespace-nowrap ${fitClass(cashLabel)}`}>{cashLabel}</span>
        </ActionButton>
        <ActionButton
          tone={phase === 'flight' ? 'neutral' : 'accent'}
          className="min-h-[60px] !px-2"
          onClick={() => press()}
          sub={<span className="whitespace-nowrap">{phase === 'flight' ? 'Tap to hurry' : queued ? 'Lined up · tap to cancel' : <span className="tnum">{sideName(side)} · to {money(nextValue)}</span>}</span>}
        >
          <span className="whitespace-nowrap text-[15px]">{phase === 'flight' ? 'Flipping…' : queued ? 'Next flip ✓' : 'Flip again'}</span>
        </ActionButton>
      </div>
    )
  } else if (active) {
    action = (
      <ActionButton tone="neutral" className="min-h-[60px]" onClick={() => press()} sub="Tap to hurry">
        Flipping…
      </ActionButton>
    )
  } else if (holding && last) {
    action = (
      <ActionButton tone={last.cashed ? 'gold' : 'neutral'} className="min-h-[60px]" onClick={() => press()} sub="Tap to skip">
        {last.cashed ? <span className="tnum">Cashed out {money(payoutFor(last.bet, last.wins))} ✓</span> : 'Streak lost'}
      </ActionButton>
    )
  } else if (mode === 'manual') {
    action = broke ? (
      <ActionButton className="min-h-[60px]" disabled sub="Lower your bet, or visit Rewards">
        Not enough coins
      </ActionButton>
    ) : (
      <ActionButton className="min-h-[60px]" onClick={() => press()} disabled={!ready} sub={<span className="tnum">{sideName(side)} · a win pays {money(payoutFor(bet, 1))}</span>}>
        Flip
      </ActionButton>
    )
  } else {
    action = (
      <ActionButton className="min-h-[60px]" onClick={startAuto} disabled={!ready || broke} sub={broke ? 'Not enough coins for this bet' : <span className="tnum">cash out at {target} win{target > 1 ? 's' : ''} · {multLabel(multiplier(target))}</span>}>
        Start autobet
      </ActionButton>
    )
  }

  const pickLocked = phase === 'flight' || auto.running
  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <div className="max-lg:order-[-1]">
        <BetInput value={unit} onChange={setBet} disabled={locked} />
      </div>
      <div className="max-lg:order-[-2]">
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>{active && wins > 0 ? 'Call the next flip' : 'Your call'}</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Your call">
          {(['heads', 'tails'] as Side[]).map((s) => (
            <SideTile key={s} side={s} on={side === s} disabled={pickLocked} touch={touch} onClick={() => choose(s)} />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2.5 max-lg:order-[-3] lg:sticky lg:bottom-0 lg:z-10 lg:order-last lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">
        {roomy && <StreakCard active={active} wins={wins} unit={unit} phase={phase} called={called} auto={auto.running} />}
        {action}
      </div>
      {mode === 'auto' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[auto_1fr] items-end gap-2">
            <div>
              <Label>Cash out after</Label>
              <div className="flex h-11 items-stretch overflow-hidden rounded-lg border-2 border-raised bg-stage">
                <button disabled={auto.running || target <= 1} onClick={() => (sfx.click(), setTarget((t) => Math.max(1, t - 1)))} className="w-9 bg-raised text-[17px] font-black text-ink/90 transition hover:bg-hover disabled:opacity-40" aria-label="Fewer wins">
                  −
                </button>
                <div className="tnum flex w-[74px] items-center justify-center text-[14px] font-extrabold">
                  {target} win{target > 1 ? 's' : ''}
                </div>
                <button disabled={auto.running || target >= MAX_FLIPS} onClick={() => (sfx.click(), setTarget((t) => Math.min(MAX_FLIPS, t + 1)))} className="w-9 bg-raised text-[17px] font-black text-ink/90 transition hover:bg-hover disabled:opacity-40" aria-label="More wins">
                  +
                </button>
              </div>
            </div>
            <div className="min-w-0 pb-0.5 text-right">
              <div className="tnum text-[15px] font-black leading-tight text-accent">{multLabel(multiplier(target))}</div>
              <div className="tnum text-[11px] font-semibold text-dim">{chanceLabel(reachChance(target))} of streaks</div>
            </div>
          </div>
          <div>
            <Label right={PATTERNS.find((p) => p.id === pattern)?.hint}>Calls</Label>
            <Segmented value={pattern} onChange={setPattern} disabled={auto.running} options={PATTERNS.map((p) => ({ value: p.id, label: p.label }))} />
          </div>
          <AutoSettings auto={auto} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-bold">Turbo</div>
          <div className="text-[11px] text-dim">A quicker flip, no slow motion</div>
        </div>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      {masterOpen && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-dim">
          <span className="text-gold">★</span>
          <span>
            <span className="font-bold text-gold">Flip Master:</span> win 7 in a row and cash out for a 3,000 reward{unit < CHALLENGE_MIN_BET ? ` (bet ${CHALLENGE_MIN_BET}+ to count)` : ''}.
          </span>
        </p>
      )}
      {mode === 'manual' && <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Keys: H or T to call, Space to flip, C to cash out. Every call wins half the time; every way of playing returns 97%.</p>}
    </>
  )

  /* ---------------- stage ---------------- */

  const steps = ladder()
  const ladderW = roomy ? 116 : 0
  const stage = (
    <div
      className="absolute inset-0 overflow-hidden bg-[#07030b]"
      onClick={(e) => {
        const sc = sceneRef.current
        if (!sc) return
        if (sc.playing) return sc.hurry()
        // a tap on the coin flips it (a click, so a finger scrolling past the stage never does)
        const r = e.currentTarget.getBoundingClientRect()
        if (live.current.mode === 'manual' && !autoRef.current && sc.onCoin(e.clientX - r.left, e.clientY - r.top)) press()
      }}
      onPointerMove={(e) => {
        if (e.pointerType === 'touch') return
        const sc = sceneRef.current
        const r = e.currentTarget.getBoundingClientRect()
        const on = !!sc && ready && live.current.mode === 'manual' && !autoRef.current && sc.onCoin(e.clientX - r.left, e.clientY - r.top)
        e.currentTarget.style.cursor = on ? 'pointer' : ''
      }}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {/* a soft vignette: the eye goes to the coin */}
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_70%_at_50%_52%,transparent_55%,rgba(5,1,8,.55)_100%)]" />

      {/* the streaks so far, and (on a phone) what this one is worth */}
      <AnimatePresence>
        {!jackpotUp && (
          <motion.div key="top" className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-2.5 sm:p-3" style={{ right: ladderW ? ladderW - 8 : 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <HistoryPills
              className="mt-0.5 min-w-0 flex-1"
              items={past.map((r) => ({
                key: r.id,
                tone: r.cashed ? 'gold' : 'loss',
                style: r.cashed ? undefined : { background: '#3a1222', color: '#ff9aa8' },
                label: <PastPill p={r} />,
              }))}
            />
            {!roomy && <ValueChip active={active} wins={wins} unit={unit} hidden={!!headline} />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* the call in the air */}
      <AnimatePresence>
        {called && phase === 'flight' && (
          <motion.div
            key="called"
            className="pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/45 py-1 pl-1 pr-3 text-[12px] font-extrabold text-white backdrop-blur-sm"
            style={{ bottom: roomy ? 22 : 78, marginLeft: -ladderW / 2 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <CoinArt side={called} size={22} detail={false} />
            You called {sideName(called)}
            {wins > 0 && <span className="tnum font-bold text-white/65">· for {money(nextValue)}</span>}
          </motion.div>
        )}
      </AnimatePresence>

      {/* after a win, the two choices right under the coin (a phone has them just below the stage) */}
      <AnimatePresence>
        {roomy && active && wins > 0 && phase !== 'flight' && !auto.running && (
          <motion.div
            key={`choice-${streak?.id}`}
            className="absolute bottom-5 z-20 flex justify-center gap-3"
            style={{ left: 12, right: ladderW + 4 }}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            onClick={(e) => e.stopPropagation()}
          >
            <CashButton value={money(nowValue)} sub={`${multLabel(multiplier(wins))} · C`} onClick={() => cashOut()} />
            <FlipAgainButton value={money(nextValue)} side={side} queued={queued} onFlip={() => press()} onPick={(s) => choose(s)} touch={touch} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* the first time: what to do */}
      <AnimatePresence>
        {ready && past.length === 0 && phase === 'idle' && !active && !auto.running && mode === 'manual' && (
          <motion.div
            key="hint"
            className="pointer-events-none absolute left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/55 px-3.5 py-1.5 text-[12px] font-bold text-white backdrop-blur-sm sm:text-[13px]"
            style={{ bottom: roomy ? 22 : 78, marginLeft: -ladderW / 2 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {touch ? 'Call heads or tails, then tap the coin' : 'Call heads or tails (H / T), then click the coin or press Space'}
          </motion.div>
        )}
      </AnimatePresence>

      {/* the headline: the face that came up, the streak's value, the cash-out, the loss */}
      <div className="pointer-events-none absolute z-30 flex justify-center px-3" style={{ top: narrow ? '12%' : '11%', left: 0, right: ladderW }}>
        <AnimatePresence>{headline && headline.kind !== 'jackpot' && <HeadlineCard key={headline.id} h={headline} narrow={narrow} />}</AnimatePresence>
      </div>
      <AnimatePresence>{headline?.kind === 'jackpot' && <JackpotCard key={headline.id} h={headline} narrow={narrow} onSkip={() => setHeadline(null)} />}</AnimatePresence>

      {/* the ladder: what each win in a row pays */}
      {!jackpotUp && <Ladder refEl={ladderRef} steps={steps} wins={wins} active={active} last={last} unit={unit} vertical={roomy} />}

      <AnimatePresence>
        {!ready && (
          <motion.div key="loading" className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,#3a1436_0%,#07030b_72%)]" exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Polishing the coin" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(calc(100vw+30px),430px)] max-sm:min-h-[380px]" />
      <AnimatePresence>{info && <InfoModal bet={unit} onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- words ---------------- */

/** what to say about a streak that ended on a losing flip while the player was away */
function lostLine(face: Side, wins: number) {
  return `Your last Coin Flip landed ${sideName(face).toLowerCase()}: ${wins > 0 ? `the ${wins}-win streak was lost` : 'the flip was lost'}`
}

/** a label's size so it fits a half-width phone button on one line */
const fitClass = (s: string) => (s.length > 18 ? 'text-[13px]' : s.length > 15 ? 'text-[14px]' : 'text-[15px]')

/* ---------------- pieces ---------------- */

function SideTile({ side, on, disabled, touch, onClick }: { side: Side; on: boolean; disabled: boolean; touch: boolean; onClick: () => void }) {
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={`${sideName(side)}${side === 'heads' ? ', the gem' : ', the crown'}`}
      disabled={disabled && !on}
      onClick={onClick}
      className={`group relative flex items-center gap-2.5 overflow-hidden rounded-xl px-2.5 py-1.5 text-left transition sm:py-2 ${on ? 'bg-raised' : 'bg-stage hover:bg-raised/70'} disabled:cursor-not-allowed disabled:opacity-45`}
      style={on ? { boxShadow: `inset 0 0 0 2px ${SIDE_COLOR[side]}, 0 0 18px -8px ${SIDE_COLOR[side]}` } : undefined}
    >
      <motion.span animate={on ? { rotateY: [0, 360], scale: [1, 1.08, 1] } : { rotateY: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }} className="shrink-0" style={{ transformStyle: 'preserve-3d' }}>
        <CoinArt side={side} size={42} detail={false} />
      </motion.span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-extrabold leading-tight">{sideName(side)}</span>
        <span className="block text-[11px] font-semibold leading-tight" style={{ color: on ? SIDE_COLOR[side] : undefined }}>
          <span className={on ? '' : 'text-dim'}>{side === 'heads' ? 'The gem' : 'The crown'}</span>
        </span>
      </span>
      {!touch && (
        <span className="absolute right-2 top-1.5 rounded-[5px] px-1 text-[10px] font-black leading-[15px]" style={on ? { background: SIDE_COLOR[side], color: '#06121f' } : { background: 'rgba(0,0,0,.3)', color: 'rgba(255,255,255,.6)' }}>
          {sideLetter(side)}
        </span>
      )}
    </button>
  )
}

/** a finished streak in the history row: the gold multiplier it cashed out at, or a red cross and how far it got */
function PastPill({ p }: { p: Past }) {
  return (
    <span className="-my-0.5 -ml-1.5 flex items-center gap-1" title={p.cashed ? `${p.wins} in a row, cashed out at ${multLabel(multiplier(p.wins))}` : p.wins > 0 ? `Lost after ${p.wins} in a row (landed ${sideName(p.face).toLowerCase()})` : `Lost on the first flip (landed ${sideName(p.face).toLowerCase()})`}>
      <CoinArt side={p.face} size={18} detail={false} className={p.cashed ? '' : 'opacity-80'} />
      {p.cashed ? <span>{shortMult(multiplier(p.wins))}</span> : <span>{p.wins > 0 ? `✕ ${p.wins}` : '✕'}</span>}
    </span>
  )
}

/** the cash-out on the table: big, gold, the amount on it */
function CashButton({ value, sub, onClick }: { value: string; sub: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      whileHover={{ y: -2 }}
      onClick={onClick}
      className="tnum flex h-[68px] min-w-[230px] flex-col items-center justify-center rounded-2xl border-[3px] border-[#1d0f30] bg-[linear-gradient(180deg,#ffe28a,#f7c548_55%,#e0a52a)] px-5 text-[#2a1c00] shadow-[0_6px_0_rgba(29,15,48,.55),0_14px_30px_-10px_rgba(0,0,0,.7)] transition-[filter] hover:brightness-105"
    >
      <span className="text-[11px] font-black uppercase tracking-[0.14em] opacity-75">Cash out</span>
      <span className="flex items-center gap-1.5 whitespace-nowrap text-[21px] font-black leading-tight">
        {value} <Coin size={17} />
      </span>
      <span className="text-[11px] font-extrabold opacity-70">{sub}</span>
    </motion.button>
  )
}

/** flip again on the table: the value it flips for, and the call to make, changeable right here */
function FlipAgainButton({ value, side, queued, onFlip, onPick, touch }: { value: string; side: Side; queued: boolean; onFlip: () => void; onPick: (s: Side) => void; touch: boolean }) {
  return (
    <div className="flex h-[68px] items-stretch overflow-hidden rounded-2xl border-[3px] border-[#1d0f30] bg-[linear-gradient(180deg,#7dffb8,#22d36f_55%,#14a957)] text-[#032412] shadow-[0_6px_0_rgba(29,15,48,.55),0_14px_30px_-10px_rgba(0,0,0,.7)]">
      <motion.button whileTap={{ scale: 0.97 }} onClick={onFlip} className="tnum flex min-w-[168px] flex-col items-center justify-center px-4 transition-[filter] hover:brightness-105">
        <span className="text-[11px] font-black uppercase tracking-[0.14em] opacity-75">{queued ? 'Lined up ✓' : 'Flip again'}</span>
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[21px] font-black leading-tight">
          {value} <Coin size={17} />
        </span>
        <span className="text-[11px] font-extrabold opacity-70">{queued ? 'tap to cancel' : `${sideName(side)}${touch ? '' : ' · Space'}`}</span>
      </motion.button>
      <div className="flex flex-col justify-center gap-1 border-l-[3px] border-[#1d0f30]/70 bg-[#0d3a22]/25 px-1.5" role="radiogroup" aria-label="Call the next flip">
        {(['heads', 'tails'] as Side[]).map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={side === s}
            aria-label={sideName(s)}
            onClick={() => onPick(s)}
            className={`flex items-center gap-1 rounded-lg py-0.5 pl-0.5 pr-1.5 text-[11px] font-black transition ${side === s ? 'bg-[#1d0f30] text-white' : 'text-[#032412]/70 hover:bg-[#1d0f30]/15'}`}
          >
            <CoinArt side={s} size={20} detail={false} />
            {sideLetter(s)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** the streak's value now (on a phone, over the stage) */
function ValueChip({ active, wins, unit, hidden }: { active: boolean; wins: number; unit: number; hidden: boolean }) {
  const cash = active && wins > 0
  // (it steps aside while a headline says the same thing, so the two never collide on a narrow stage)
  return (
    <div className={`shrink-0 rounded-xl border border-white/10 bg-[#120818]/80 px-2.5 py-1.5 text-right shadow-[0_6px_18px_-8px_rgba(0,0,0,.8)] backdrop-blur-sm transition-opacity duration-200 sm:px-3 ${hidden ? 'opacity-0' : 'opacity-100'}`}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/55">{cash ? `Streak ${wins} · cash out` : 'First win'}</div>
      <div className={`tnum flex items-center justify-end gap-1 text-[14px] font-black leading-tight sm:text-[16px] ${cash ? 'text-gold' : 'text-white'}`}>
        {money(cash ? payoutFor(unit, wins) : payoutFor(unit, 1))} <Coin size={13} />
      </div>
      <div className="tnum text-[10.5px] font-bold text-white/60">{cash && wins < MAX_FLIPS ? `next ${money(payoutFor(unit, wins + 1))} · 50%` : '50% a flip'}</div>
    </div>
  )
}

/** the panel's streak card (desktop): what the streak is worth, what the next win makes it, where the choices are */
function StreakCard({ active, wins, unit, phase, called, auto }: { active: boolean; wins: number; unit: number; phase: Phase; called: Side | null; auto: boolean }) {
  const cash = active && wins > 0
  const pips = Array.from({ length: MAX_FLIPS }, (_, i) => i)
  return (
    <div className="rounded-xl border border-white/[0.06] bg-stage px-3.5 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10.5px] font-black uppercase tracking-[0.14em] text-dim">{cash ? `Streak · ${wins} win${wins > 1 ? 's' : ''}` : active ? 'First flip' : 'A first win pays'}</span>
        <span className="tnum text-[13px] font-black text-accent">{multLabel(multiplier(cash ? wins : 1))}</span>
      </div>
      <div className={`tnum mt-0.5 flex items-center gap-1.5 text-[26px] font-black leading-tight ${cash ? 'text-gold' : 'text-ink'}`}>
        {money(payoutFor(unit, cash ? wins : 1))} <Coin size={19} />
      </div>
      <div className="mt-2 flex gap-[3px]" aria-hidden>
        {pips.map((i) => (
          <span key={i} className="h-1.5 flex-1 rounded-full" style={{ background: i < wins && active ? `hsl(${46 - Math.min(1, i / 11) * 22} 100% ${60 - Math.min(1, i / 11) * 6}%)` : i === wins && active ? 'rgba(255,255,255,.45)' : 'rgba(255,255,255,.08)' }} />
        ))}
      </div>
      <div className="tnum mt-2 text-[11.5px] font-semibold leading-snug text-muted">
        {phase === 'flight' && called ? (
          <>
            In the air: <span className="font-bold text-ink">{sideName(called)}</span> makes it <span className="font-bold text-ink">{money(payoutFor(unit, Math.min(MAX_FLIPS, wins + 1)))}</span>
          </>
        ) : cash ? (
          wins < MAX_FLIPS ? (
            <>
              Next win <span className="font-bold text-ink">{money(payoutFor(unit, wins + 1))}</span> · 50%.{' '}
              {!auto && <span className="text-dim">Cash out (C) or flip again (Space) on the table.</span>}
            </>
          ) : null
        ) : (
          <>
            3 in a row <span className="font-bold text-ink">{money(payoutFor(unit, 3))}</span> · 7 in a row <span className="font-bold text-ink">{money(payoutFor(unit, 7))}</span>
          </>
        )}
      </div>
    </div>
  )
}

function Ladder({ refEl, steps, wins, active, last, unit, vertical }: { refEl: React.RefObject<HTMLDivElement | null>; steps: number[]; wins: number; active: boolean; last: Streak | null; unit: number; vertical: boolean }) {
  const lost = last && !last.cashed ? last.wins : -1
  const cashedAt = last && last.cashed ? last.wins : -1
  const state = (i: number): StepState => {
    if (active) return i < wins ? (i === wins - 1 ? 'current' : 'won') : i === wins ? 'next' : 'future'
    if (cashedAt > 0) return i < cashedAt ? (i === cashedAt - 1 ? 'cashed' : 'won') : 'future'
    if (lost >= 0) return i < lost ? 'won' : i === lost ? 'lost' : 'future'
    return 'future'
  }
  const items = steps.map((m, i) => <Step key={i} i={i} mult={m} state={state(i)} amount={payoutFor(unit, i + 1)} vertical={vertical} />)
  if (vertical)
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 top-3 z-10 flex w-[100px] flex-col">
        <div className="mb-1.5 text-center text-[9.5px] font-black uppercase tracking-[0.16em] text-white/50">Wins in a row</div>
        <div className="flex min-h-0 flex-1 flex-col justify-end">
          <div ref={refEl} className="no-scrollbar pointer-events-auto flex max-h-full flex-col-reverse gap-1 overflow-y-auto">
            {items}
          </div>
        </div>
      </div>
    )
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#07030b] via-[#07030b]/70 to-transparent px-2 pb-2 pt-5 sm:px-3">
      <div className="mb-1 pl-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-white/45">Wins in a row</div>
      <div ref={refEl} className="no-scrollbar pointer-events-auto flex items-end gap-1 overflow-x-auto">
        {items}
      </div>
    </div>
  )
}

type StepState = 'won' | 'current' | 'cashed' | 'lost' | 'next' | 'future'

function Step({ i, mult, state, amount, vertical }: { i: number; mult: number; state: StepState; amount: number; vertical: boolean }) {
  // the won steps warm from gold to orange as the streak climbs; red is kept for the step a streak was lost on
  const heat = Math.min(1, i / 11)
  const warm = `linear-gradient(180deg, hsl(${48 - heat * 22} 100% ${66 - heat * 6}%) 0%, hsl(${40 - heat * 20} 100% ${52 - heat * 4}%) 100%)`
  const big = state === 'next' || state === 'current'
  const jackpot = i + 1 >= 10 && (i + 1 === 10 || i + 1 === 13 || i + 1 === 16)
  return (
    <div
      data-step={i}
      title={`${i + 1} in a row: ${multLabel(mult)} · ${money(amount)} · ${oddsLabel(i + 1)}`}
      className={`relative flex shrink-0 rounded-lg transition-colors ${vertical ? `${big ? 'h-[50px] flex-col justify-center gap-0.5' : 'h-[34px] items-center justify-between'} px-2` : `min-w-[62px] flex-1 flex-col items-center justify-center px-1 ${big ? 'py-1.5' : 'py-1'}`} ${
        state === 'won' || state === 'current' || state === 'cashed'
          ? 'text-[#2a1200]'
          : state === 'lost'
            ? 'bg-danger text-white'
            : state === 'next'
              ? 'bg-[#2a1233] text-white ring-2 ring-gold'
              : 'bg-[#170b1f]/90 text-white/70'
      }`}
      style={state === 'won' || state === 'current' ? { background: warm } : state === 'cashed' ? { background: 'linear-gradient(180deg,#fff6c4,#f7c548)', boxShadow: '0 0 0 2px #fff3b0' } : undefined}
    >
      {vertical && big ? (
        <>
          <span className="flex items-center justify-between">
            <span className="tnum text-[10.5px] font-black leading-none opacity-70">{i + 1}</span>
            <span className="tnum text-[13px] font-black leading-none">{shortMult(mult)}</span>
          </span>
          <span className={`tnum flex items-center justify-end gap-0.5 text-[11px] font-extrabold leading-none ${state === 'next' ? 'text-gold' : ''}`}>
            {money(amount)}
          </span>
        </>
      ) : (
        <>
          <span className={`tnum font-black leading-none ${vertical ? 'text-[10.5px] opacity-70' : 'text-[10px] opacity-70'}`}>
            {state === 'lost' ? '✕' : state === 'cashed' ? '✓' : i + 1}
            {jackpot && state !== 'lost' && state !== 'cashed' && <span className="ml-0.5 text-gold">★</span>}
          </span>
          <span className={`tnum font-black leading-none ${vertical ? 'text-[13px]' : 'mt-0.5 text-[13px]'}`}>{shortMult(mult)}</span>
          {!vertical && big && <span className={`tnum mt-0.5 text-[10.5px] font-extrabold leading-none ${state === 'next' ? 'text-gold' : ''}`}>{money(amount)}</span>}
        </>
      )}
      {state === 'next' && <motion.div className="pointer-events-none absolute inset-0 rounded-lg ring-2 ring-gold" animate={{ opacity: [0.9, 0.2, 0.9] }} transition={{ duration: 1.2, repeat: Infinity }} />}
    </div>
  )
}

/** a number that counts up to `to` over `ms`, ticking as it goes */
function useCount(to: number, ms: number, tick = false) {
  const [v, setV] = useState(ms > 0 ? 0 : to)
  useEffect(() => {
    if (ms <= 0) return setV(to)
    let last = 0
    const c = animate(0, to, {
      duration: ms / 1000,
      ease: [0.2, 0.7, 0.3, 1],
      onUpdate: (x) => {
        setV(x)
        const now = performance.now()
        if (tick && now - last > 70) {
          last = now
          coinflipSfx.count(x / (to || 1))
        }
      },
    })
    return () => c.stop()
  }, [to, ms, tick])
  return v
}

/** Big lettering with a gradient face and an ink outline (a solid copy of the text behind the face). */
function Lettering({ text, face, size }: { text: string; face: string; size: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight ${size}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] text-[#1d0f30] [-webkit-text-stroke:0.16em_#1d0f30] [filter:drop-shadow(0_0.07em_0_#1d0f30)]">
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${face}`}>{text}</span>
    </span>
  )
}

const FACE = {
  gold: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]',
  green: 'bg-[linear-gradient(180deg,#eafff2_0%,#7dffb8_45%,#18b65e_100%)]',
  blue: 'bg-[linear-gradient(180deg,#eef4ff_0%,#8fb4ff_45%,#3d6ff0_100%)]',
  fire: 'bg-[linear-gradient(180deg,#fff3c4_0%,#ffb340_40%,#ff4d2e_100%)]',
  grey: 'bg-[linear-gradient(180deg,#f4eef7_0%,#c9bdd3_55%,#8e7f9c_100%)]',
  red: 'bg-[linear-gradient(180deg,#ffe1e4_0%,#ff7a8a_45%,#e0263f_100%)]',
  rainbow: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
}

function HeadlineCard({ h, narrow }: { h: Headline; narrow: boolean }) {
  const amount = h.kind === 'cash' || h.kind === 'win' ? h.amount : 0
  const counted = useCount(amount, h.kind === 'cash' ? 700 : 0, h.kind === 'cash')
  const size = narrow ? 'text-[34px]' : 'text-[54px]'
  const pill = 'flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white py-1 shadow-[0_5px_0_rgba(29,15,48,.45)]'
  const shout = h.kind === 'win' ? winShout(h.wins) : null
  if (h.kind === 'lose') {
    const streakLost = h.wins > 0
    return (
      <motion.div
        className="flex flex-col items-center"
        initial={{ opacity: 0, y: -10, scale: 1.25 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 6, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 380, damping: 22 }}
      >
        <motion.div className="mb-1.5 flex items-center gap-1.5 rounded-full bg-[#1d0f30]/90 py-0.5 pl-0.5 pr-3 text-[11px] font-black tracking-[0.12em] text-white/80 sm:text-[12px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.12 }}>
          <CoinArt side={h.face} size={narrow ? 20 : 22} detail={false} />
          {sideName(h.face).toUpperCase()} · YOU CALLED {sideName(h.call).toUpperCase()}
        </motion.div>
        <motion.div animate={{ x: [0, -7, 6, -4, 2, 0] }} transition={{ duration: 0.45, delay: 0.1 }}>
          <Lettering text={streakLost ? 'STREAK LOST' : 'NO LUCK'} face={streakLost ? FACE.red : FACE.grey} size={size} />
        </motion.div>
        <div className={`mt-1.5 ${pill} px-3.5`}>
          <span className="tnum relative text-[15px] font-black text-[#8e7f9c] sm:text-[19px]">
            {streakLost ? money(h.lost) : `−${money(h.lost)}`}
            {streakLost && (
              <motion.span className="absolute inset-x-[-3px] top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-danger" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ delay: 0.3, duration: 0.25 }} style={{ originX: 0 }} />
            )}
          </span>
          {streakLost && <span className="text-[12px] font-black text-[#e0263f] sm:text-[14px]">{h.wins} in a row, gone</span>}
        </div>
      </motion.div>
    )
  }
  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ opacity: 0, y: 18, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      {shout && (
        <motion.div className="mb-1.5 rounded-full bg-[#1d0f30] px-3 py-0.5 text-[11px] font-black tracking-[0.22em] text-[#ffb340] sm:text-[12px]" initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.18, duration: 0.4 }}>
          {shout}
        </motion.div>
      )}
      <motion.div className="flex items-center gap-2" animate={{ scale: [1, 1.06, 1] }} transition={{ duration: 0.5, delay: 0.15 }}>
        {h.kind === 'win' && <CoinArt side={h.face} size={narrow ? 38 : 56} className="drop-shadow-[0_4px_0_rgba(29,15,48,.6)]" />}
        <Lettering
          text={h.kind === 'win' ? `${sideName(h.face).toUpperCase()}!` : 'CASHED OUT'}
          face={h.kind !== 'win' ? FACE.gold : h.wins >= 6 ? FACE.fire : h.face === 'heads' ? FACE.green : FACE.blue}
          size={size}
        />
      </motion.div>
      {h.kind === 'win' && (
        <div className={`mt-1.5 ${pill} pl-1.5 pr-3.5`}>
          <span className="tnum rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-black text-[#032412] sm:text-[16px]">{multLabel(h.mult)}</span>
          <span className="tnum flex items-center gap-1 text-[13px] font-black text-[#1d0f30] sm:text-[16px]">
            {money(h.amount)} <Coin size={14} />
          </span>
        </div>
      )}
      {h.kind === 'cash' && (
        <>
          <div className={`mt-1.5 ${pill} pl-1.5 pr-4`}>
            <span className="tnum rounded-full bg-gold px-2.5 py-0.5 text-[14px] font-black text-[#2a1c00] sm:text-[17px]">{multLabel(h.mult)}</span>
            <span className="tnum flex items-center gap-1.5 text-[17px] font-black text-[#1d0f30] sm:text-[22px]">
              {money(counted)} <Coin size={19} />
            </span>
          </div>
          {h.note && <div className="mt-1.5 rounded-full bg-black/55 px-3 py-0.5 text-[11.5px] font-bold text-white/80">{h.note}</div>}
        </>
      )}
    </motion.div>
  )
}

/** a jackpot streak over the coin rain: it counts the win up in full; a tap closes it */
function JackpotCard({ h, narrow, onSkip }: { h: Extract<Headline, { kind: 'jackpot' }>; narrow: boolean; onSkip: () => void }) {
  const legend = h.tier >= 3
  const counted = useCount(h.amount, legend ? 4200 : 2600, true)
  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer flex-col items-center px-4 pt-[9%]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      onClick={(e) => {
        e.stopPropagation()
        onSkip()
      }}
    >
      <div className={`pointer-events-none absolute inset-0 ${legend ? 'bg-[radial-gradient(ellipse_at_50%_26%,rgba(7,3,11,.8)_0%,rgba(7,3,11,.35)_50%,transparent_78%)]' : 'bg-[radial-gradient(ellipse_at_50%_26%,rgba(7,3,11,.65)_0%,rgba(7,3,11,.25)_45%,transparent_72%)]'}`} />
      {h.tier >= 2 && (
        <motion.div
          className="pointer-events-none absolute left-1/2 top-[22%] aspect-square w-[min(120%,900px)] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 [mask-image:radial-gradient(circle,black_20%,transparent_68%)]"
          style={{ background: legend ? 'repeating-conic-gradient(from 0deg, #ff4fd8 0deg 8deg, transparent 8deg 20deg, #ffe23d 20deg 28deg, transparent 28deg 40deg, #2fd3ff 40deg 48deg, transparent 48deg 60deg)' : 'repeating-conic-gradient(from 0deg, #ffd45c 0deg 9deg, transparent 9deg 22deg)' }}
          animate={{ rotate: 360 }}
          transition={{ duration: legend ? 14 : 20, repeat: Infinity, ease: 'linear' }}
        />
      )}
      <motion.div className="pointer-events-none relative flex flex-col items-center" initial={{ scale: 0.4, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <motion.div className="mb-2 rounded-full bg-[#1d0f30] px-3.5 py-1 text-[11px] font-black tracking-[0.22em] text-gold sm:text-[13px]" initial={{ scale: 0 }} animate={{ scale: [0, 1.15, 1] }} transition={{ delay: 0.35, duration: 0.4 }}>
          {h.wins} IN A ROW · {oddsLabel(h.wins).toUpperCase()}
        </motion.div>
        <motion.div animate={{ scale: [1, 1.05, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <Lettering text={`${TIER_NAME[h.tier]}!`} face={h.tier >= 2 ? FACE.rainbow : FACE.gold} size={legend ? (narrow ? 'text-[44px]' : 'text-[88px]') : narrow ? 'text-[36px]' : 'text-[72px]'} />
        </motion.div>
        <div className="mt-3 flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white py-1.5 pl-2 pr-5 shadow-[0_6px_0_rgba(29,15,48,.45)]">
          <span className="tnum rounded-full bg-gold px-3 py-0.5 text-[14px] font-black text-[#2a1c00] sm:text-[20px]">{multLabel(h.mult)}</span>
          <span className="tnum flex items-center gap-1.5 text-[19px] font-black text-[#1d0f30] sm:text-[30px]">
            {fmt(counted)} <Coin size={narrow ? 18 : 24} />
          </span>
        </div>
      </motion.div>
      <div className="pointer-events-none absolute bottom-4 left-0 right-0 text-center text-[12px] font-bold text-white/60">Tap to close</div>
    </motion.div>
  )
}

function InfoModal({ bet, onClose }: { bet: number; onClose: () => void }) {
  const steps = ladder()
  return (
    <Modal onClose={onClose} title="How Coin Flip works" width={500}>
      <div className="flex items-center gap-3 rounded-xl bg-stage p-3">
        <CoinArt side="heads" size={54} />
        <CoinArt side="tails" size={54} />
        <p className="text-[13px] leading-relaxed text-muted">
          Call <span className="font-bold text-ink">Heads</span> (the green gem) or <span className="font-bold text-ink">Tails</span> (the crown on blue), pay your bet and flip.
        </p>
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        If the coin lands on your call you win: cash out, or flip again to double it (call the same side or switch, it's up to you). If it lands the other way, the streak is lost. A streak
        is at most {MAX_FLIPS} flips; the sixteenth win cashes out by itself.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        Every flip is decided the moment the coin is flicked, half and half, before your call is even looked at, so heads and tails are exactly as good. The coin's flight is worked out
        with real physics and only shown landing on the face that was drawn. Cashing out after n wins pays {Math.round(RTP * 100)}% × 2<sup>n</sup>, so whichever way you play, it
        returns {Math.round(RTP * 100)}% over time.
      </p>
      <div className="mt-3 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 rounded-lg bg-stage px-3 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-dim">Wins</span>
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-dim">Chance</span>
        <span className="text-right text-[10.5px] font-bold uppercase tracking-wider text-dim">Multiplier</span>
        <span className="text-right text-[10.5px] font-bold uppercase tracking-wider text-dim">Pays</span>
        {steps.map((m, i) => (
          <div key={i} className="contents">
            <span className="tnum text-[13px] font-extrabold">
              {i + 1}
              {(i + 1 === 10 || i + 1 === 13 || i + 1 === 16) && <span className="ml-1 text-[11px] text-gold">★</span>}
            </span>
            <span className="tnum text-[12px] font-semibold text-muted">{oddsLabel(i + 1)}</span>
            <span className="tnum text-right text-[13px] font-extrabold text-accent">{multLabel(m)}</span>
            <span className="tnum text-right text-[12px] font-semibold text-ink/85">{money(payoutFor(bet, i + 1))}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-dim">
        ★ 10, 13 and all 16 in a row are jackpots. Keys: H or T to call, Space to flip, C to cash out. Turbo plays the flip quicker without the slow motion; a tap on the table (or
        Space) hurries a flip along. Auto mode flips until your target streak, then cashes out, calling the way you choose. If you leave in the middle of a streak, it is cashed out at
        what it is worth.
      </p>
    </Modal>
  )
}
