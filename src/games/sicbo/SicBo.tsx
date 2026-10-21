import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { ActionButton, GameShell, Label, Toggle, useStake } from '../../components/ui'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { Modal } from '../../components/Modal'
import { Chip, chipLabel } from '../../art/Chip'
import { fmt, round2 } from '../../lib/format'
import { rand, randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { sicboSfx } from './sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { MAX_BET, useWallet } from '../../store/wallet'
import { Kbd } from '../blackjack/table'
import { DieFace } from './art'
import { Board, type Leaving } from './Board'
import { COMPACT, WIDE } from './layout'
import { Paytable } from './Paytable'
import { HistoryColumn, HistoryStrip, RollsPanel } from './Roads'
import { Celebration, Readout, TIER_COUNT, WinPlate, tierOf } from './Result'
import { Strikes, type StrikeFx } from './Strikes'
import {
  ALL_ROLLS,
  LIMITS,
  SPOTS,
  describe,
  drawRound,
  isBetKey,
  oddsWon,
  rollDie,
  settleBets,
  sorted,
  spotOf,
  totalOf,
  type BetKey,
  type BetResult,
  type Bets,
  type Dice,
  type Lucky,
  type Round,
} from './rules'
import {
  LIVE_MS,
  MAX_HIST,
  clearNotice,
  clearPending,
  isDice,
  loadChip,
  loadHistory,
  loadLast,
  loadTurbo,
  pendingAge,
  pendingKey,
  pendingTaken,
  saveChip,
  saveHistory,
  saveLast,
  saveNotice,
  savePending,
  saveTurbo,
  takeNotice,
  takePending,
  type Meta,
  type PastRoll,
  type PendingRound,
} from './storage'
import { spotTitle, topMult } from './words'
import type { FrameBox, SicBoScene } from './scene'

/*
  Sic Bo. Chips go on the table; Roll takes the stake and draws the whole round at once (rules.ts): the lucky strikes
  and the dice, settled against the table there and then. The round is kept as a pending payout, in memory and in
  localStorage, and paid exactly once: when its show ends, straight away if the page is left mid-roll (the next
  visit says what it came to), or on the next visit if the page died. A round paid on a leave that was then cancelled
  just plays out; it is never paid or staked again. (storage.ts: the heartbeat that keeps a second tab off a live
  round.)

  The show: golden lightning strikes the struck spots one by one (the dome flashes, the badges land, the odds count
  up; chips on a struck spot jump), the dome is shaken and the dice really tumble (scene.ts plays a roll worked out
  ahead that lands on the drawn faces), the camera leans in once they can be read, the winning spots light up, the
  dealer sweeps the losers and pays the winners, and the chips come back so Space rolls the same table again.

  On a phone the table takes most of the stage while bets go down; for the shake it steps back (scaled toward its
  foot) so the dome can grow into the room, and returns once the dice have been read big, for the payout.

  Dev hook (dev builds only): window.__sicboForce = 'triple' (the next roll is a triple), 'lucky' (the largest lucky
  bet on the table is struck ×25, or its kind's top multiplier, and wins), or { dice: [a, b, c], lucky?: [{ key,
  mult }] }. window.__sicbo is the scene.
*/

const CHIPS = [1, 5, 10, 25, 100, 500, 1000, 5000]
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
/** on a phone, the room the win plate takes at the foot of the dome at the result (the dice are framed above it) */
const PLATE_ROOM = 40
/** the room a big win's lettering takes at the top of the dome (the dice are framed below it, still in view) */
const CELEBRATION_ROOM = { phone: 112, desktop: 178 }
/* The table only re-renders when what it shows changes, not on every tick of the round around it. */
const MemoBoard = memo(Board)
const MemoToggle = memo(Toggle)

type Phase = 'bet' | 'strike' | 'shake' | 'result'
type Mode = 'columns' | 'strip' | 'phone'

/** the round in play (or the one just shown) */
interface Play {
  id: number
  t: number
  bets: Bets
  stake: number
  ret: number
  lucky: Lucky[]
  dice: Dice
  results: BetResult[]
  /** in the history on screen already: it goes in when shown, or as the page is left */
  logged: boolean
}

const betTotal = (b: Bets) => round2(Object.values(b).reduce((a, v) => a + (v ?? 0), 0))
const betCount = (b: Bets) => Object.values(b).filter((v) => !!v).length
const winningKeys = (dice: Dice) => new Set(SPOTS.filter((s) => oddsWon(s, dice) > 0).map((s) => s.key))
const diceText = (d: Dice) => sorted(d).join('·')
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
const coins = (v: number) => fmt(v, v % 1 ? 2 : 0)
/** the history with a roll in it (once: a roll already there is replaced), the newest last */
const withRoll = (h: readonly PastRoll[], r: { t: number; dice: Dice; lucky: Lucky[] }) => [...h.filter((x) => x.t !== r.t), { t: r.t, dice: r.dice, lucky: r.lucky }].slice(-MAX_HIST)

/** the challenge and history details of a settled round */
function metaOf(round: Round, results: BetResult[]): Meta {
  const won = results.filter((r) => r.ret > 0)
  return {
    tripleWin: won.some((r) => r.key === 'anyTriple' || spotOf(r.key).kind === 'triple'),
    strikes: round.lucky.length,
    maxMult: Math.max(1, ...won.map((r) => r.mult)),
    total: totalOf(round.dice),
    dice: sorted(round.dice).join('-'),
  }
}

/** a roll in words, for the screen reader */
function rollWords(d: Dice) {
  const x = describe(d)
  return `Rolled ${sorted(d).join(', ')}: ${x.size === 'triple' ? `a triple, total ${x.total}` : `total ${x.total}, ${x.size}, ${x.parity}`}.`
}

/** dev builds only: the round the dev hook asks for, or the drawn one */
function forced(placed: Bets, round: Round): Round {
  const w = window as unknown as { __sicboForce?: unknown }
  const f = w.__sicboForce
  if (f == null) return round
  delete w.__sicboForce
  const boardOrder = (l: Lucky[]) => [...l].sort((a, b) => SPOTS.findIndex((s) => s.key === a.key) - SPOTS.findIndex((s) => s.key === b.key))
  if (f === 'triple') {
    const d = rollDie(rand)
    return { ...round, dice: [d, d, d] }
  }
  if (f === 'lucky') {
    const keys = (Object.keys(placed) as BetKey[]).filter((k) => isBetKey(k) && placed[k]).sort((a, b) => placed[b]! - placed[a]!)
    const target = keys.find((k) => spotOf(k).lucky) ?? keys[0] ?? 'combo25'
    // a bet that can't be struck (Small, a single...) still wins, under a ×25 on a combination it shares a roll with
    const struck: BetKey = spotOf(target).lucky ? target : (SPOTS.find((s) => s.kind === 'combo' && ALL_ROLLS.some((d) => oddsWon(s, d) && oddsWon(spotOf(target), d)))?.key ?? 'combo25')
    const fits = ALL_ROLLS.filter((d) => oddsWon(spotOf(target), d) > 0 && oddsWon(spotOf(struck), d) > 0)
    return { lucky: boardOrder([...round.lucky.filter((l) => l.key !== struck), { key: struck, mult: Math.min(25, topMult(struck)) }]), dice: fits.length ? fits[randInt(fits.length)] : round.dice }
  }
  if (typeof f === 'object') {
    const o = f as { dice?: unknown; lucky?: unknown }
    const lucky = Array.isArray(o.lucky) ? (o.lucky as Lucky[]).filter((l) => l && isBetKey(l.key) && spotOf(l.key).lucky && Number.isFinite(l.mult) && l.mult >= 2) : null
    return { lucky: lucky?.length ? boardOrder(lucky) : round.lucky, dice: isDice(o.dice) ? o.dice : round.dice }
  }
  return round
}

/**
 * Where everything sits on a stage of W × H: the table along the bottom (and the chip bar under it when the side
 * panel is below the stage), the dome framed above it, and the history and the readout either in columns either
 * side of the dome, in a strip over it (no side room), or in the dome's top corners on a phone. On a phone, also
 * the roll's view: how far the table steps back (its scale, toward its foot) and the bigger dome box that leaves.
 */
function geometry(W: number, H: number, bar: boolean) {
  const compact = W < 600
  const layout = compact ? COMPACT : WIDE
  const pad = compact ? 6 : 12
  const rail = compact ? 5 : 8
  const barH = bar ? 56 : 0
  let tw = Math.min(W - pad * 2 - rail * 2, 1080)
  let th = (tw * layout.vh) / layout.vw
  const maxTh = H * (compact ? 0.62 : 0.5)
  if (th > maxTh) {
    th = maxTh
    tw = (th * layout.vw) / layout.vh
  }
  const tTop = H - pad - barH - rail - th
  let domeTop = compact ? 4 : 10
  const domeBot = tTop - rail - (compact ? 6 : 10)
  let domeH = domeBot - domeTop
  let domeW = Math.min(W - pad * 2, domeH * (compact ? 1.04 : 1.12))
  let side = (W - domeW) / 2 - pad
  const mode: Mode = compact ? 'phone' : side >= 160 ? 'columns' : 'strip'
  if (mode === 'strip') {
    domeTop += 40
    domeH -= 40
    domeW = Math.min(W - pad * 2, domeH * 1.12)
    side = (W - domeW) / 2 - pad
  }
  let big: { s: number; dome: FrameBox } | null = null
  if (mode === 'phone') {
    // the dome gets about half the stage (above the chip bar), the table keeping at least 60% of its size
    const want = Math.min((H - barH) * 0.56, domeH + th * 0.42)
    const s = Math.max(0.6, Math.min(1, 1 - (want - domeH) / th))
    const h = domeH + (th + rail * 2) * (1 - s)
    const w = Math.min(W - pad * 2, h * 1.04)
    big = { s, dome: { x: (W - w) / 2, y: domeTop, w, h } }
  }
  return {
    compact,
    layout,
    bar,
    pad,
    rail,
    barH,
    tw,
    th,
    tLeft: (W - tw) / 2,
    tTop,
    k: tw / layout.vw,
    mode,
    /** the side columns' width (columns and phone) */
    colW: mode === 'phone' ? Math.max(58, Math.min(80, side)) : Math.min(232, side - 6),
    dome: { x: (W - domeW) / 2, y: domeTop, w: domeW, h: Math.max(80, domeH) },
    big,
  }
}

export default function SicBo() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const pushToast = useWallet((s) => s.pushToast)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [hist, setHist] = useState<PastRoll[]>(loadHistory)
  const histRef = useRef(hist)
  const [chip, setChipState] = useState(() => loadChip(CHIPS, 10))
  const [bets, setBetsState] = useState<Bets>({})
  const betsRef = useRef<Bets>({})
  const [undo, setUndo] = useState<{ key: BetKey; amount: number }[]>([])
  const [last, setLast] = useState<Bets | null>(loadLast)
  const [wins, setWins] = useState<Bets>({})
  const [leaving, setLeaving] = useState<Leaving>('player')
  const [struck, setStruck] = useState<Lucky[]>([])
  const [winning, setWinning] = useState<ReadonlySet<BetKey> | null>(null)
  const [shake, setShake] = useState<{ key: BetKey; n: number } | null>(null)
  const [fx, setFx] = useState<StrikeFx[]>([])
  const [readout, setReadout] = useState<{ dice: Dice; live: boolean } | null>(() => (hist.length ? { dice: hist[hist.length - 1].dice, live: false } : null))
  const [winShow, setWinShow] = useState<{ id: number; amount: number; stake: number; tier: number } | null>(null)
  const [lastRound, setLastRound] = useState<{ ret: number; stake: number } | null>(null)
  const [hint, setHint] = useState(0)
  const [info, setInfo] = useState(false)
  const [rollsOpen, setRollsOpen] = useState(false)
  /** the phone's roll view: the table stepped back, the dome big */
  const [big, setBig] = useState(false)
  /** what the screen reader is told (strikes, the roll, the payout) */
  const [say, setSay] = useState('')
  const [touch] = useState(isTouch)
  const [phase, setPhaseState] = useState<Phase>('bet')
  // the phase as of now, for the money path: two presses handled before React re-renders must not roll twice
  const phaseRef = useRef<Phase>('bet')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const [turbo, setTurboState] = useState(loadTurbo)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const setTurbo = useCallback((on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }, [])
  const setBets = (b: Bets) => {
    betsRef.current = b
    setBetsState(b)
  }
  const setChip = (v: number) => {
    setChipState(v)
    saveChip(v)
  }

  const [stageRef, size] = useSize<HTMLDivElement>()
  // below the lg breakpoint the side panel sits under the stage, so the chips and Roll move onto the stage
  const [wide, setWide] = useState(() => typeof matchMedia === 'undefined' || matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const m = matchMedia('(min-width: 1024px)')
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const G = geometry(size.w, size.h, !wide)
  const geo = useRef(G)
  geo.current = G
  const quake = useAnimationControls()

  /* ---------------- the scene ---------------- */

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<SicBoScene | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const readyRef = useRef(false)
  const failedRef = useRef(false)

  /* the round's bookkeeping (the money section below works it) */
  const run = useRef(0)
  const alive = useRef(true)
  const timers = useRef<number[]>([])
  const play = useRef<Play | null>(null)
  const pending = useRef<{ key: string; round: PendingRound } | null>(null)
  /** the round in play was paid as the page began to leave */
  const paidOnHide = useRef(false)
  const collected = useRef(0)
  const hints = useRef(0)

  // where the camera frames the dome: its box; on a phone the bigger box of the roll's view; during a big win's
  // celebration, below its lettering; and on a phone at the result, its box less the win plate's room at the foot
  const result = phase === 'result' ? play.current : null
  const celebrating = !!winShow && winShow.tier > 0
  const D = G.dome
  const celebrationRoom = G.compact ? CELEBRATION_ROOM.phone : CELEBRATION_ROOM.desktop
  const frame: FrameBox =
    big && G.big
      ? G.big.dome
      : celebrating
        ? { ...D, y: D.y + celebrationRoom, h: Math.max(80, D.h - celebrationRoom) }
        : G.mode === 'phone' && result && result.ret > 0
          ? { ...D, h: Math.max(80, D.h - PLATE_ROOM) }
          : D
  const frameRef = useRef(frame)
  frameRef.current = frame

  useEffect(() => {
    let on = true
    const host = hostRef.current!
    let sc: SicBoScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ SicBoScene }) => {
        if (!on) return
        setProgress(0.08)
        sc = new SicBoScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __sicbo?: SicBoScene }).__sicbo = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => on && setProgress(0.08 + p * 0.92)
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          sc!.setFrame(frameRef.current)
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        // the dice lie as the last roll left them
        const h = histRef.current
        if (h.length) sc.setRest(h[h.length - 1].dice)
        return sc.ready.then(() => {
          if (!on) return
          readyRef.current = true
          setReady(true)
        })
      })
      .catch(() => {
        if (!on) return
        failedRef.current = true
        setFailed(true)
      })
    return () => {
      on = false
      readyRef.current = false
      ro?.disconnect()
      if (import.meta.env.DEV) {
        const w = window as unknown as { __sicbo?: SicBoScene }
        if (w.__sicbo === sc) delete w.__sicbo
      }
      sc?.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo, ready])
  // the frame glides when the stage rearranges itself, and cuts when the stage is resized
  const stageKey = `${size.w}x${size.h}`
  const lastStage = useRef(stageKey)
  useEffect(() => {
    const resized = lastStage.current !== stageKey
    lastStage.current = stageKey
    sceneRef.current?.setFrame(frameRef.current, !resized)
  }, [frame.x, frame.y, frame.w, frame.h, stageKey, ready])

  /* ---------------- money ---------------- */

  /**
   * Pays the round in play, once: when its show ends, or as soon as the player leaves (it is decided). A round that
   * another tab already took and paid (see storage.ts) is not paid again; null then, as when there is none.
   */
  const settlePending = () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    const taken = pendingTaken(p.key)
    clearPending(p.key)
    if (taken) return null
    useWallet.getState().settle({ game: 'sicbo', bet: p.round.bet, payout: p.round.payout, meta: p.round.meta })
    return p.round
  }

  /** puts a roll in the history strip and the stats (and in storage), once */
  const logRoll = (r: { t: number; dice: Dice; lucky: Lucky[] }) => {
    const next = withRoll(histRef.current, r)
    histRef.current = next
    saveHistory(next)
    if (alive.current) setHist(next)
  }

  useEffect(() => {
    alive.current = true
    // reloading, closing the tab or going to another site mid-roll pays it on the way out; the next visit says so
    const onHide = () => {
      const p = settlePending()
      if (!p) return
      paidOnHide.current = true
      saveNotice({ amount: p.payout, dice: p.dice })
      // into the stored history now (the page may be going); on screen only when its dice land (the page may stay)
      const r = play.current
      if (r && !r.logged) saveHistory(withRoll(histRef.current, r))
    }
    // while a round's show plays, its heartbeat tells other tabs it is live (and stops if one of them took it)
    const beat = window.setInterval(() => {
      const p = pending.current
      if (p && !pendingTaken(p.key)) savePending(p.key, { ...p.round, at: Date.now() })
    }, 1000)
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      alive.current = false
      clearInterval(beat)
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      timers.current.forEach(clearTimeout)
      timers.current = []
      // leaving the page mid-roll pays the roll at once, and says what it came to
      const p = settlePending()
      const r = play.current
      if (r && !r.logged) {
        r.logged = true
        logRoll(r)
      }
      if (p) {
        if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your Sic Bo roll (${diceText(p.dice)}) paid out as you left`, amount: p.payout })
        else useWallet.getState().pushToast({ kind: 'info', title: `Your Sic Bo roll (${diceText(p.dice)}) didn't win` })
      }
    }
    // settlePending and logRoll only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A round whose page went away before it could pay is paid on the next visit, once sign-in has settled so it lands
  // in the wallet that took the stake; one paid as the page was left is announced. A round another tab is still
  // showing (its heartbeat is fresh) is left to that tab, and looked at again once the heartbeat would have stopped.
  useEffect(() => {
    if (authStatus === 'loading') return
    const n = takeNotice()
    if (n) {
      if (n.amount > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your last Sic Bo roll (${diceText(n.dice)}) paid out when you left`, amount: n.amount })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your last Sic Bo roll (${diceText(n.dice)}) didn't win` })
    }
    let timer = 0
    const recover = () => {
      if (pending.current || !alive.current) return
      const key = pendingKey(uid)
      const age = pendingAge(key)
      if (age == null) return
      if (age < LIVE_MS) {
        timer = window.setTimeout(recover, LIVE_MS - age + 300)
        return
      }
      const p = takePending(key)
      if (!p) return
      useWallet.getState().settle({ game: 'sicbo', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
      logRoll(p)
      if (phaseRef.current === 'bet') {
        setReadout({ dice: p.dice, live: false })
        sceneRef.current?.setRest(p.dice)
      }
      if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your unfinished Sic Bo roll (${diceText(p.dice)}) paid out`, amount: p.payout })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your unfinished Sic Bo roll (${diceText(p.dice)}) didn't win` })
    }
    recover()
    return () => clearTimeout(timer)
    // logRoll only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, uid])

  /* ---------------- the round ---------------- */

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r))
  const live = (id: number) => alive.current && run.current === id
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  /** a lightning strike on one spot: the bolt, the badge and the upgraded odds, the dome's flash, the sound */
  const strike = (l: Lucky) => {
    const g = geo.current
    const c = g.layout.byKey.get(l.key)
    if (c) {
      const id = Date.now() + Math.random()
      const bolt: StrikeFx = { id, x: g.tLeft + (c.x + c.w / 2) * g.k, y: g.tTop + (c.y + c.h / 2) * g.k, mult: l.mult, turbo: turboRef.current }
      setFx((f) => [...f, bolt])
      later(900, () => setFx((f) => f.filter((b) => b.id !== id)))
    }
    setStruck((s) => [...s, l])
    sceneRef.current?.flash(l.mult >= 20 ? 1.4 : l.mult >= 10 ? 1.1 : 0.75)
    sicboSfx.strike(l.mult)
    // the most exciting strike of all: one on the player's own chips
    const mine = !!play.current?.bets[l.key]
    if (mine) sicboSfx.mine(l.mult)
    setSay(`Lucky strike ×${l.mult} on ${spotTitle(l.key)}${mine ? ', your bet' : ''}.`)
    if (l.mult >= 20) void quake.start({ x: [0, -8, 7, -5, 3, -1, 0], y: [0, 4, -5, 3, -2, 1, 0], transition: { duration: 0.5 } })
    else if (l.mult >= 10) void quake.start({ x: [0, -3, 3, -2, 0], y: [0, 2, -2, 1, 0], transition: { duration: 0.3 } })
  }

  /** the strikes, one after another, the biggest last; about 1.5 s (half a second in turbo) */
  async function strikes(id: number, lucky: Lucky[]) {
    const T = turboRef.current
    const order = [...lucky].sort((a, b) => a.mult - b.mult)
    const gap = Math.min(T ? 0.2 : 0.5, Math.max(T ? 0.1 : 0.26, (T ? 0.5 : 1.3) / order.length))
    await wait(T ? 80 : 260)
    for (const l of order) {
      if (!live(id)) return
      // a breath before a big one
      if (!T && l.mult >= 20) await wait(260)
      if (!live(id)) return
      strike(l)
      await wait((gap + (!T && l.mult >= 10 ? 0.2 : 0)) * 1000)
    }
    await wait(T ? 120 : 360)
  }

  async function roll() {
    if (phaseRef.current === 'strike' || phaseRef.current === 'shake') return
    if (!readyRef.current && !failedRef.current) return
    // after a roll the same chips are back on the table: rolling now rolls them again
    const placed = phaseRef.current === 'result' ? restore() : betsRef.current
    const total = betTotal(placed)
    if (!total) return void pushToast({ kind: 'info', title: last ? 'Place chips on the table, or Rebet (R)' : 'Place chips on the table first' })
    if (!stake(total)) return
    const id = ++run.current
    clearTimers()
    const T = turboRef.current

    // the round is decided, settled and stored before anything moves, so leaving mid-roll can't change or lose it
    let round = drawRound(rand)
    if (import.meta.env.DEV) round = forced(placed, round)
    const pay = settleBets(placed, round)
    const t = Date.now()
    const p: PendingRound = { bet: total, payout: pay.ret, meta: metaOf(round, pay.results), dice: round.dice, lucky: round.lucky, t, at: t }
    const key = pendingKey(uid)
    pending.current = { key, round: p }
    savePending(key, p)
    paidOnHide.current = false
    play.current = { id, t, bets: placed, stake: total, ret: pay.ret, lucky: round.lucky, dice: round.dice, results: pay.results, logged: false }
    setLast(placed)
    saveLast(placed)

    setPhase('strike')
    setUndo([])
    setWins({})
    setStruck([])
    setWinning(null)
    setWinShow(null)
    setLeaving('player')
    setBig(false)
    setReadout((r) => r && { ...r, live: false })
    setHint(0)
    sicboSfx.roll()
    const sc = readyRef.current ? sceneRef.current : null
    // the shake is worked out (off the main thread) while the lightning plays
    void sc?.plan(round.dice)
    await strikes(id, round.lucky)
    if (!live(id)) return

    setPhase('shake')
    setBig(true)
    let shown = false
    const reveal = () => {
      if (shown || !live(id)) return
      shown = true
      setReadout({ dice: round.dice, live: true })
      setSay(rollWords(round.dice))
      sicboSfx.settle()
    }
    if (sc && readyRef.current) {
      const bed = sicboSfx.rattle()
      try {
        await sc.shake(round.dice, {
          kick: (k) => {
            sicboSfx.kick(k)
            bed?.kick(k)
          },
          hit: (h, k) => sicboSfx.knock(h.on, k),
          readable: () => {
            bed?.stop()
            reveal()
          },
        })
      } catch {
        // never expected: a scene error must not lock the game
      }
      bed?.stop()
    } else await wait(T ? 600 : 1400)
    if (!live(id)) return
    reveal()
    finish(id)
  }

  /**
   * The result: pay; then (on a phone, once the dice have had their moment big and the table is back) light the
   * winners, sweep the losers, pay the winners, the win; then the chips come back.
   */
  function finish(id: number) {
    const p = play.current
    if (!p) return
    settlePending()
    // a round paid as the page began to leave, on a page that stayed: the player sees it now, no notice needed
    if (paidOnHide.current) clearNotice()
    if (!p.logged) {
      p.logged = true
      logRoll(p)
    }
    const T = turboRef.current
    setPhase('result')
    setLastRound({ ret: p.ret, stake: p.stake })
    const lag = geo.current.mode === 'phone' ? (T ? 260 : 600) : 0
    const at = (ms: number, fn: () => void) => later(lag + ms, fn)
    if (lag) later(lag, () => setBig(false))
    else setBig(false)
    at(0, () => setWinning(winningKeys(p.dice)))
    const keep: Bets = {}
    const profit: Bets = {}
    let lost = false
    for (const r of p.results) {
      if (r.ret > 0) {
        keep[r.key] = r.stake
        profit[r.key] = round2(r.ret - r.stake)
      } else lost = true
    }
    if (lost)
      at(T ? 150 : 480, () => {
        setLeaving('house')
        setBets(keep)
        sicboSfx.sweep()
      })
    if (Object.keys(profit).length)
      at(T ? 320 : 900, () => {
        setWins(profit)
        sicboSfx.pay()
      })
    const tier = p.ret > p.stake ? tierOf(p.ret / p.stake) : 0
    if (p.ret > p.stake) {
      at(T ? 260 : 650, () => {
        setWinShow({ id, amount: p.ret, stake: p.stake, tier })
        sicboSfx.win(tier)
      })
    }
    at(T ? 300 : 700, () => setSay(p.ret > p.stake ? `You won ${coins(p.ret)}.` : p.ret > 0 ? `${coins(p.ret)} of ${coins(p.stake)} back.` : 'No win this roll.'))
    // a big win holds the table until its celebration ends (or a tap closes it)
    const hold = tier ? 650 + TIER_COUNT[tier] + 1800 : p.ret > p.stake ? (T ? 1500 : 2900) : T ? 1100 : 2300
    at(hold, () => collect(id))
  }

  /** the chips on the table go back to the player, then the same table comes back for the next roll */
  function collect(id: number) {
    if (!live(id) || phaseRef.current !== 'result' || collected.current === id) return
    collected.current = id
    const p = play.current
    setWinShow(null)
    setLeaving('player')
    setBets({})
    setWins({})
    if (p && p.ret > 0) sfx.coin()
    later(turboRef.current ? 380 : 560, () => live(id) && phaseRef.current === 'result' && restore())
  }

  /** betting reopens with the last round's chips on the table; returns them */
  function restore(): Bets {
    const p = play.current
    clearTimers()
    setWinShow(null)
    setWinning(null)
    setStruck([])
    setWins({})
    setFx([])
    setLeaving('player')
    setBig(false)
    setPhase('bet')
    sceneRef.current?.focus(false)
    setReadout((r) => r && { ...r, live: false })
    const next: Bets = p ? { ...p.bets } : {}
    setBets(next)
    setUndo([])
    const t = betTotal(next)
    // "same bets": the first few times, and whenever the balance no longer covers them
    if (t && (hints.current < 3 || t > useWallet.getState().balance)) {
      hints.current++
      setHint((h) => h + 1)
    }
    return next
  }

  /* ---------------- chips ---------------- */

  const betting = phase === 'bet' || phase === 'result'
  const total = betTotal(bets)

  const refuse = (key: BetKey | null, why: string) => {
    if (key) setShake((s) => ({ key, n: (s?.n ?? 0) + 1 }))
    sicboSfx.nope()
    pushToast({ kind: 'info', title: why })
  }

  /** the table to change: the one on screen, or (while a result shows) the restored one */
  const editable = () => (phaseRef.current === 'result' ? restore() : betsRef.current)

  function place(key: BetKey) {
    if (!betting) return
    const base = editable()
    const s = spotOf(key)
    const cur = base[key] ?? 0
    const roomLimit = round2(s.limit - cur)
    const roomTable = round2(MAX_BET - betTotal(base))
    const roomCoins = round2(balance - betTotal(base))
    let add = Math.min(chip, roomLimit, roomTable, roomCoins)
    // the coins left over are placed in whole coins (a chip is never a fraction)
    if (add === roomCoins && add < chip) add = Math.floor(add)
    if (add < 1) return refuse(key, roomLimit < 1 ? `Limit reached: ${fmt(s.limit, 0)} on ${s.label}` : roomTable < 1 ? `Table limit: ${fmt(MAX_BET, 0)} a roll` : NO_COINS)
    // a chip cut short is never silent: say what was placed, and why
    if (add < chip)
      pushToast({
        kind: 'info',
        title:
          add === roomLimit
            ? `Topped up to the ${fmt(s.limit, 0)} limit on ${s.label}`
            : add === roomTable
              ? `Table limit ${fmt(MAX_BET, 0)}: placed ${coins(add)} on ${s.label}`
              : `Only ${coins(add)} coins left: placed ${coins(add)} on ${s.label}`,
      })
    sicboSfx.chip()
    setBets({ ...base, [key]: round2(cur + add) })
    setUndo((u) => [...u, { key, amount: add }])
  }

  function remove(key: BetKey) {
    if (!betting) return
    const base = editable()
    const cur = base[key] ?? 0
    if (!cur) return
    // the chip placed there last, or the chosen chip's worth, or what is left
    const lastStep = [...undo].reverse().find((u) => u.key === key && u.amount > 0)
    const take = Math.min(cur, lastStep?.amount ?? chip)
    const v = round2(cur - take)
    const next = { ...base }
    if (v > 0) next[key] = v
    else delete next[key]
    sicboSfx.remove()
    setBets(next)
    setUndo((u) => [...u, { key, amount: -take }])
  }

  // the table gets stable handlers that always call the latest place() / remove()
  const placeRef = useRef(place)
  placeRef.current = place
  const removeRef = useRef(remove)
  removeRef.current = remove
  const onPlace = useCallback((key: BetKey) => placeRef.current(key), [])
  const onRemove = useCallback((key: BetKey) => removeRef.current(key), [])

  function undoLast() {
    if (phase !== 'bet' || !undo.length) return
    const step = undo[undo.length - 1]
    setUndo(undo.slice(0, -1))
    const v = round2((bets[step.key] ?? 0) - step.amount)
    const next = { ...bets }
    if (v > 0) next[step.key] = v
    else delete next[step.key]
    sfx.click()
    setBets(next)
  }

  function clear() {
    if (!betting) return
    const base = editable()
    if (!betTotal(base)) return
    sicboSfx.remove()
    setLeaving('player')
    setBets({})
    setUndo([])
  }

  /** puts `next` on the table if the limits and the balance allow it, recording the change for undo */
  function putBets(next: Bets) {
    const base = editable()
    for (const k of Object.keys(next) as BetKey[]) next[k] = Math.min(next[k]!, spotOf(k).limit)
    const t = betTotal(next)
    if (t > MAX_BET) return refuse(null, `Table limit: ${fmt(MAX_BET, 0)} a roll`)
    if (t > balance) return refuse(null, NO_COINS)
    const steps = (Object.keys(next) as BetKey[]).flatMap((key) => {
      const d = round2((next[key] ?? 0) - (base[key] ?? 0))
      return d > 0 ? [{ key, amount: d }] : []
    })
    if (!steps.length) return refuse(null, 'Those bets are at their limits')
    sicboSfx.chip()
    setBets(next)
    setUndo((u) => [...u, ...steps])
  }

  // while a result shows, Clear and 2× act on the round's table (which comes back for the next roll)
  const roundTable = phase === 'result' && !!play.current && betTotal(play.current.bets) > 0
  const canRebet = betting && !!last && (phase === 'bet' ? !total : false)
  const rebet = () => canRebet && last && putBets({ ...last })
  const canDouble = betting && (total > 0 || roundTable)
  const canClear = betting && (total > 0 || roundTable)
  const double = () => {
    if (!canDouble) return
    const base = editable()
    const next: Bets = {}
    for (const k of Object.keys(base) as BetKey[]) if (base[k]) next[k] = round2(base[k]! * 2)
    if (betTotal(next)) putBets(next)
  }

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || rollsOpen || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (e.ctrlKey) {
        if (k === 'z') {
          e.preventDefault()
          undoLast()
        }
        return
      }
      if (e.code === 'Space' || e.key === 'Enter') {
        // A control reached with the keyboard keeps its own Space and Enter (a button presses, the switch flips, a
        // table spot takes a chip); Enter on any focused control too. Otherwise both roll, so a button just clicked
        // with the mouse doesn't swallow Space. (:focus-visible can't tell: a key press makes any focus visible.)
        const control = (e.target as HTMLElement | null)?.closest?.('button,[role=button],[role=switch],[role=tab]')
        if (control && (e.key === 'Enter' || !pointerFocus.current)) return
        e.preventDefault()
        if (!e.repeat) void roll()
      } else if (k === 'z' || k === 'backspace') undoLast()
      else if (k === 'c') clear()
      else if (k === 'r') rebet()
      else if (k === 'd') double()
      else if (/^[1-8]$/.test(e.key)) {
        sfx.click()
        setChip(CHIPS[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const rolling = phase === 'strike' || phase === 'shake'
  // what Roll would stake: the chips on the table, or (in play, and while a result shows) the round's table, which
  // is what comes back for the next roll
  const table = (rolling || phase === 'result') && play.current ? play.current.bets : bets
  const tableTotal = betTotal(table)
  const tableCount = betCount(table)
  const short = tableTotal > balance
  const canRoll = (ready || failed) && !rolling && tableTotal > 0 && !short
  const rollSub = rolling
    ? phase === 'strike'
      ? 'Lucky strikes…'
      : 'Shaking…'
    : !ready && !failed
      ? 'Setting up the table…'
      : short
        ? 'Not enough coins for these bets'
        : tableTotal
          ? `${phase === 'result' ? 'Same bets · ' : ''}${tableCount} bet${tableCount > 1 ? 's' : ''} · ${fmt(tableTotal)}`
          : 'Place chips on the table'
  const rollLabel = rolling ? 'Rolling…' : phase === 'result' && tableTotal ? 'Roll again' : 'Roll'

  // On a phone all eight chips share the rack beside Roll, each as wide as the rack allows; only on the narrowest
  // screens does the rack scroll (half a chip peeking out, the chosen chip kept in view) rather than shrink the
  // chips past a comfortable tap.
  const rollW = G.compact ? 76 : 104
  const rackIn = size.w - 16 - 8 - rollW - 8
  const fit = Math.floor((rackIn - 7 * 2) / 8)
  const chipBtn = !G.compact ? 40 : fit >= 30 ? Math.min(40, fit) : Math.max(32, Math.floor((rackIn - 6 * 2) / 6.5))
  const rackRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rack = rackRef.current
    const el = rack?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!rack || !el) return
    const l = el.offsetLeft - rack.offsetLeft
    if (l < rack.scrollLeft) rack.scrollTo({ left: l - 4, behavior: 'smooth' })
    else if (l + el.offsetWidth > rack.scrollLeft + rack.clientWidth) rack.scrollTo({ left: l + el.offsetWidth - rack.clientWidth + 4, behavior: 'smooth' })
  }, [chip, G.bar, chipBtn])
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
        title={compact ? undefined : `${fmt(v, 0)} (${i + 1})`}
      >
        <motion.span animate={{ y: chip === v && !compact ? -2 : 0 }}>
          <Chip value={v} size={compact ? Math.min(30, chipBtn - 4) : 38} />
        </motion.span>
      </button>
    ))

  const won = !!lastRound && lastRound.ret > lastRound.stake
  const panel = (
    <>
      <div className={G.bar ? 'hidden' : ''}>
        <Label right={<>{fmt(balance)}</>}>Chip value</Label>
        <div className="grid grid-cols-4 gap-2 rounded-lg bg-stage p-2">{chipPicker(false)}</div>
      </div>
      <div className="rounded-lg bg-stage px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-muted">Total bet{tableCount > 0 ? ` · ${tableCount} spot${tableCount > 1 ? 's' : ''}` : ''}</span>
          <span className="tnum flex items-center gap-1.5 text-[16px] font-extrabold">
            {fmt(tableTotal)} <Coin size={16} />
          </span>
        </div>
        {lastRound && (
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted">{won ? 'Last win' : 'Last roll'}</span>
            <span className={`tnum text-[13px] font-extrabold ${won ? 'text-gold' : 'text-dim'}`}>
              {won ? fmt(lastRound.ret) : lastRound.ret > 0 ? `${fmt(lastRound.ret)} of ${fmt(lastRound.stake)} back` : 'No win'}
            </span>
          </div>
        )}
        <div className="mt-1.5 text-balance text-[11px] font-semibold leading-snug text-dim">
          Spot limits: even money {chipLabel(LIMITS.small)} · singles {chipLabel(LIMITS.single)} · totals, doubles, combos {chipLabel(LIMITS.total)} · triples {chipLabel(LIMITS.triple)}. Table{' '}
          {chipLabel(MAX_BET)}.
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="neutral" onClick={undoLast} disabled={phase !== 'bet' || !undo.length}>
          Undo <Kbd>Z</Kbd>
        </ActionButton>
        <ActionButton tone="neutral" onClick={clear} disabled={!canClear}>
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
          <div className="text-[11px] font-semibold text-dim">Quicker strikes and shake</div>
        </div>
        <MemoToggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <button onClick={() => (sfx.click(), setInfo(true))} className="text-muted transition hover:text-ink">
          How it works · paytable
        </button>
        {(G.mode !== 'columns' || G.bar) && (
          <button onClick={() => (sfx.click(), setRollsOpen(true))} className="text-muted transition hover:text-ink">
            History · stats
          </button>
        )}
      </div>
      <div className="hidden text-[11px] font-semibold leading-relaxed text-dim lg:block [@media(max-height:780px)]:lg:hidden">
        Keys: 1 to 8 pick a chip, Space or Enter rolls, Z or Backspace undoes, C clears, R rebets, D doubles. Right-click a spot to take a chip off.
      </div>
      {/* Roll stays in view at the foot of the panel, however short the screen */}
      <div
        className={`lg:sticky lg:bottom-0 lg:z-10 lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_80%,transparent)] lg:px-4 lg:pb-4 lg:pt-3 ${G.bar ? 'hidden' : ''}`}
      >
        <ActionButton onClick={() => void roll()} disabled={!canRoll} sub={rollSub}>
          {rollLabel} <Kbd>Space</Kbd>
        </ActionButton>
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const narrow = G.compact
  const rollsRows = G.mode === 'columns' ? Math.max(3, Math.floor((D.h - 64) / 31)) : 4
  const tableScale = big && G.big ? G.big.s : 1
  // the win: in the side column; over the dome (a strip); on a phone in one row at the dome's foot, under the dice
  const plateAt =
    G.mode === 'columns'
      ? { right: G.pad, width: G.colW, top: D.y + 142 }
      : G.mode === 'phone'
        ? { left: G.pad, right: G.pad, top: G.tTop - G.rail - PLATE_ROOM }
        : { left: D.x, width: D.w, top: D.y + 6 }
  // the quick fixes where the panel sits under the stage (phones, tablets): Undo and Clear (or Rebet) in the dome's
  // bottom corners while bets go down, so a slip never means scrolling down to the panel
  const pill = 'pointer-events-auto absolute z-[22] flex h-8 items-center gap-1 rounded-full bg-[#12070a]/80 px-3 text-[12px] font-extrabold text-white/85 ring-1 ring-white/15 backdrop-blur-[2px] active:scale-95'
  const showUndo = G.bar && phase === 'bet' && undo.length > 0
  const showClear = G.bar && phase === 'bet' && total > 0
  const showRebet = G.bar && !showClear && canRebet
  // "same bets", until the player changes the table
  const showHint = hint > 0 && phase === 'bet' && total > 0 && !undo.length
  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[#070204]">
      <motion.div className="absolute inset-0" animate={quake}>
        <div ref={hostRef} className="absolute inset-0" />
        {/* the room's corners fall away: the eye goes to the dome and the table */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_75%_at_50%_45%,transparent_55%,rgba(5,1,3,.6)_100%)]" />

        {/* the 3D stage loading, or not available: the round then plays on flat dice */}
        <AnimatePresence>
          {!ready && (
            <motion.div
              key="loading"
              className="absolute z-[15] flex items-center justify-center rounded-3xl"
              style={{ left: D.x, top: D.y, width: D.w, height: D.h }}
              exit={{ opacity: 0, transition: { duration: 0.45 } }}
            >
              {failed ? <FlatDice dice={readout?.dice ?? null} rolling={rolling} small={narrow} /> : <BojeLoader label="Polishing the dice" progress={progress} />}
            </motion.div>
          )}
        </AnimatePresence>

        {/* history and readout */}
        {G.mode === 'columns' && (
          <>
            <div className="absolute z-10 flex flex-col" style={{ left: G.pad, top: D.y, width: G.colW, maxHeight: D.h }}>
              <div className="flex min-h-0 flex-col rounded-2xl bg-[#12070a]/70 p-2 ring-1 ring-white/10 backdrop-blur-[2px]">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-[10.5px] font-black uppercase tracking-[0.16em] text-white/50">Last rolls</span>
                  <button onClick={() => (sfx.click(), setRollsOpen(true))} className="rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold text-gold/80 transition hover:bg-white/10 hover:text-gold">
                    Stats
                  </button>
                </div>
                <HistoryColumn rolls={hist} rows={rollsRows} die={G.colW >= 200 ? 20 : 18} words={G.colW >= 200} empty="No rolls yet" onOpen={() => setRollsOpen(true)} />
              </div>
            </div>
            <div className="absolute z-10" style={{ right: G.pad, top: D.y, width: G.colW }}>
              <Readout dice={readout?.dice ?? null} live={!!readout?.live} rolling={rolling && !readout?.live} variant="card" />
            </div>
          </>
        )}
        {G.mode === 'strip' && (
          <div className="absolute z-10 flex items-center justify-between gap-3" style={{ left: G.pad, right: G.pad, top: 10, height: 34 }}>
            <HistoryStrip rolls={hist} onOpen={() => setRollsOpen(true)} />
            <Readout dice={readout?.dice ?? null} live={!!readout?.live} rolling={rolling && !readout?.live} variant="bar" />
          </div>
        )}
        {/* (on a phone they step aside while a big win's lettering fills the top of the stage) */}
        {G.mode === 'phone' && (
          <motion.div className="pointer-events-none absolute inset-0" initial={false} animate={{ opacity: celebrating ? 0 : 1 }} transition={{ duration: 0.25 }}>
            <div className="pointer-events-auto absolute z-10" style={{ left: G.pad - 2, top: D.y + 2, width: G.colW }}>
              <HistoryColumn rolls={hist} rows={Math.max(2, Math.min(5, Math.floor((D.h - 10) / 24)))} die={11} words={false} onOpen={() => setRollsOpen(true)} />
            </div>
            <div className="pointer-events-auto absolute z-10" style={{ right: G.pad, top: D.y + 4, width: G.colW }}>
              <Readout dice={readout?.dice ?? null} live={!!readout?.live} rolling={rolling && !readout?.live} variant="mini" />
            </div>
          </motion.div>
        )}

        {/* the table (a padded ruby rail round the felt); on a phone it steps back toward its foot for the shake */}
        <motion.div
          className="absolute left-0 top-0 z-20"
          style={{ transformOrigin: `${size.w / 2}px ${G.tTop + G.th + G.rail}px` }}
          initial={false}
          animate={{ scale: tableScale }}
          transition={{ type: 'spring', stiffness: 210, damping: 30 }}
        >
          <div
            className="pointer-events-none absolute"
            style={{
              left: G.tLeft - G.rail,
              top: G.tTop - G.rail,
              width: G.tw + G.rail * 2,
              height: G.th + G.rail * 2,
              borderRadius: (narrow ? 12 : 18) + G.rail,
              background: 'linear-gradient(180deg,#5c1622 0%,#3a0b13 55%,#24060b 100%)',
              boxShadow: '0 0 0 1px rgba(247,197,72,.32), inset 0 1px 0 rgba(255,255,255,.14), inset 0 -2px 0 rgba(0,0,0,.35), 0 22px 44px -16px rgba(0,0,0,.9)',
            }}
          >
            <div
              className="absolute"
              style={{
                inset: G.rail,
                borderRadius: narrow ? 12 : 18,
                background: `${NOISE}, radial-gradient(ellipse 90% 80% at 50% 0%, #1e7458 0%, #135342 48%, #0b3328 100%)`,
                backgroundBlendMode: 'overlay, normal',
                boxShadow: '0 0 0 1.5px rgba(247,197,72,.62), inset 0 0 46px rgba(0,0,0,.42)',
              }}
            />
          </div>
          <MemoBoard
            layout={G.layout}
            left={G.tLeft}
            top={G.tTop}
            width={G.tw}
            height={G.th}
            stageH={size.h}
            bets={bets}
            wins={wins}
            leaving={leaving}
            struck={struck}
            winning={winning}
            interactive={betting}
            onPlace={onPlace}
            onRemove={onRemove}
            shake={shake}
          />
        </motion.div>

        {/* the quick fixes: Undo, and Clear (or Rebet) */}
        <AnimatePresence>
          {showUndo && (
            <motion.button
              key="undo"
              className={pill}
              style={{ left: G.pad, top: G.tTop - G.rail - 40 }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={undoLast}
              aria-label="Undo the last chip"
            >
              <UndoIcon /> Undo
            </motion.button>
          )}
          {(showClear || showRebet) && (
            <motion.button
              key={showClear ? 'clear' : 'rebet'}
              className={pill}
              style={{ right: G.pad, top: G.tTop - G.rail - 40 }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              onClick={showClear ? clear : rebet}
              aria-label={showClear ? 'Clear the table' : 'Put the last bets back'}
            >
              {showClear ? 'Clear' : 'Rebet'}
            </motion.button>
          )}
        </AnimatePresence>

        {/* "same bets": after a roll the chips come back for the next one (or can't, if the balance falls short) */}
        <AnimatePresence>
          {showHint && (
            <motion.div
              key={hint}
              className={`pointer-events-none absolute z-[24] whitespace-nowrap rounded-full bg-[#12070a]/85 px-3 py-1 text-[11.5px] font-extrabold ring-1 ${short ? 'text-[#ffb3bc] ring-[#ff5468]/40' : 'text-white/85 ring-gold/30'}`}
              // (on a phone, in the quick fixes' row: no Undo shows until the table changes, and that ends the hint)
              style={G.bar && G.compact ? { left: G.pad, top: G.tTop - G.rail - 36 } : { left: size.w / 2, top: G.tTop - G.rail - (G.bar ? 66 : 30), x: '-50%' }}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: [0, 1, 1, 0], y: 0 }}
              transition={{ duration: short ? 3.6 : 2.6, times: [0, 0.1, 0.8, 1] }}
              onAnimationComplete={() => setHint(0)}
            >
              {G.compact
                ? short
                  ? 'Not enough coins for these bets'
                  : 'Same bets · tap Roll again'
                : short
                  ? `Not enough coins for the same bets · ${touch ? 'Clear' : 'C'} to start over`
                  : `Same bets on the table · ${touch ? 'tap Roll' : 'Space'} to roll again`}
            </motion.div>
          )}
        </AnimatePresence>

        <Strikes fx={fx} />

        {/* the win: under the readout in the side column, or at the top of the dome, over the dice's framed spot */}
        <div className="pointer-events-none absolute z-30 flex justify-center" style={plateAt}>
          <AnimatePresence>
            {winShow && !winShow.tier && <WinPlate key={winShow.id} amount={winShow.amount} stake={winShow.stake} size={G.mode === 'columns' ? 'md' : G.mode === 'phone' ? 'line' : 'sm'} />}
            {result && result.ret > 0 && result.ret <= result.stake && (
              <motion.div
                key={`back-${result.id}`}
                className="whitespace-nowrap rounded-full bg-black/65 px-3 py-1 text-[12px] font-extrabold text-white/85 ring-1 ring-white/10"
                style={{ marginTop: G.mode === 'columns' ? 8 : G.mode === 'phone' ? 6 : 4 }}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, transition: { duration: 0.2 } }}
                transition={{ delay: turbo ? 0.25 : G.mode === 'phone' ? 1.2 : 0.6 }}
              >
                {fmt(result.ret)} of {fmt(result.stake)} back
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
      {/* a big win's celebration fills the room over the dome, high enough to leave the dice and the table's lit spots in view */}
      <div className="pointer-events-none absolute inset-x-0 z-[32]" style={{ top: 0, height: G.tTop - G.rail }}>
        <AnimatePresence>
          {winShow && winShow.tier > 0 && (
            <Celebration key={winShow.id} tier={winShow.tier} amount={winShow.amount} stake={winShow.stake} narrow={narrow} top={D.y + (narrow ? 2 : 14)} onDone={() => collect(winShow.id)} />
          )}
        </AnimatePresence>
      </div>

      {G.bar && (
        <div className={`absolute inset-x-0 bottom-0 z-20 flex items-center gap-2 px-2 pb-2 ${G.compact ? '' : 'justify-center'}`} style={{ height: G.barH + 4 }}>
          <div ref={rackRef} className={`no-scrollbar flex min-w-0 flex-1 overflow-x-auto rounded-lg bg-black/35 p-1 ${G.compact ? 'gap-0.5' : 'max-w-[460px] justify-between gap-1'}`}>
            {chipPicker(true)}
          </div>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => void roll()}
            disabled={!canRoll}
            style={{ width: rollW }}
            className="flex h-12 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16)] disabled:opacity-45"
          >
            <span className={`font-extrabold leading-tight ${rolling ? 'text-[13px]' : 'text-[16px]'}`}>{rolling ? 'Rolling' : phase === 'result' && tableTotal ? 'Again' : 'Roll'}</span>
            {!rolling && tableTotal > 0 && <span className="tnum text-[10px] font-bold leading-tight opacity-75">{fmt(tableTotal)}</span>}
          </motion.button>
        </div>
      )}
      <div className="sr-only" aria-live="polite">
        {say}
      </div>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100svh-150px-env(safe-area-inset-bottom))] max-sm:max-h-[820px] max-sm:min-h-[480px] sm:max-lg:h-[min(84vh,820px)]" />
      <AnimatePresence>{info && <Paytable onClose={() => setInfo(false)} />}</AnimatePresence>
      <AnimatePresence>
        {rollsOpen && (
          <Modal onClose={() => setRollsOpen(false)} title="Sic Bo · last rolls" width={420}>
            <RollsPanel rolls={hist} rows={MAX_HIST} initial={G.mode === 'columns' ? 'stats' : 'history'} />
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)'/%3E%3C/svg%3E\")"

function UndoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}

/** Without 3D graphics the dice are shown flat: they tumble through faces while the roll plays, then show the roll. */
function FlatDice({ dice, rolling, small }: { dice: Dice | null; rolling: boolean; small: boolean }) {
  const [faces, setFaces] = useState<Dice>(dice ?? [1, 2, 3])
  useEffect(() => {
    if (!rolling) {
      if (dice) setFaces(dice)
      return
    }
    const t = window.setInterval(() => setFaces([rollDie(Math.random), rollDie(Math.random), rollDie(Math.random)]), 90)
    return () => clearInterval(t)
  }, [rolling, dice])
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex gap-3">
        {faces.map((n, i) => (
          <motion.span
            key={i}
            animate={rolling ? { rotate: [0, 12, -10, 0], y: [0, -8, 0] } : { rotate: 0, y: 0 }}
            transition={rolling ? { duration: 0.35, repeat: Infinity, delay: i * 0.08 } : { duration: 0.2 }}
          >
            <DieFace n={n} size={small ? 40 : 64} />
          </motion.span>
        ))}
      </div>
      <div className="max-w-[260px] text-center text-[12px] font-semibold text-white/60">3D graphics aren't available on this device, so the dice are shown flat.</div>
    </div>
  )
}
