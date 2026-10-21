import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Toggle, useStake, type PillTone } from '../../components/ui'
import { Coin } from '../../components/icons'
import { fmt, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { linesSfx } from './sound'
import { safeStorage } from '../../lib/storage'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import {
  BASE_SPINS,
  LADDER,
  LINES,
  LINES_AT,
  MAX_EXTRA,
  atExtras,
  atPriceFloor,
  bestCell,
  buyExtra,
  canSpin,
  colOf,
  doneLines,
  extraPrice,
  extraValue,
  extrasLeft,
  finish,
  ladderPay,
  linesOf,
  newCard,
  newGame,
  place,
  placeable,
  spin,
  staked,
  suggest,
  type Game,
  type ReelSym,
} from './rules'
import { CELL, MACHINE_H, MACHINE_W, PLATE, REELS_H, REELS_TOP, SIDE_GAP, cellXY, fit, reelXY } from './layout'
import { ArtDefs, COL, GAME_U, INK, Sym, twinklePath } from './art'
import { Card, LINE_ENDS, effectsOf } from './Card'
import { Reels, type Look, type ReelsHandle, type SpinPlan } from './Reels'
import { Ladder, STEPS, stepOf, stepXY } from './Ladder'
import { ExtrasPlate, IntroNote, JokerNote, ResultPlate, ShoutLayer, SpinsPlate, extraHints, type Result, type Shout, type ShoutKind } from './Plates'
import { BigWin, tierOf, type BigWinData } from './BigWin'
import { HowToPlay } from './HowToPlay'
import { Fx } from './fx'
import { NOTICE_KEY, clearGame, forcedRng, gameKey, loadGame, lockName, saveGame } from './save'

/*
  Lucky Lines: a 5 × 5 bingo card played with five reels, one under each column (rules.ts has the game and its
  maths). Play stakes the bet, deals a card (the one on show before a first game: every card is as good as any
  other, each reel drawing its column's numbers evenly) and spins the first of ten spins. Each spin marks the card's numbers
  that land; a Joker waits for the player to mark a number in its column (any number, for a Super Joker), with the
  best one suggested and an Auto-place switch; Free Spins add spins. Lines climb the ladder. When the spins run
  out the player buys extra spins one at a time, each priced from the card (worth ÷ 0.97, worked out once per card
  state, off the animation's path), or collects.

  Money: the bet when the game starts, each extra spin when it is bought, the ladder paid once at the collect
  (settle). The game is plain data saved after every step, a spin before it is shown, so a reload resumes exactly
  where it was, jokers waiting included. Leaving while the extra-spin decision is up collects the card (leaving is
  choosing not to buy); a game mid-spins is kept for later. A full card has nothing left to win: it collects itself
  after a beat, and however the page goes in that beat (a reload, a closed tab, another page) it is collected then,
  or as soon as the game is opened again. One tab at a time plays for a player (a Web Lock); a tab that takes over
  first picks up the wallet as the other tab left it.

  Buying is always deliberate: Space never buys a spin (it plays, spins, places the suggested joker and hurries a
  spin), clicks and taps on the decision (and E) wait a moment after it opens (so a run of presses meant for the spins
  can't land on it), and a spin dearer than CONFIRM_OVER bets asks for a second press.

  The screen: Card.tsx, Reels.tsx, Ladder.tsx, Plates.tsx (decision, result, the reels' plate, shouts), BigWin.tsx,
  fx.ts (the particles), HowToPlay.tsx; all drawn in one design space scaled to the stage (layout.ts). Keys: Space
  plays, spins or places the suggested joker (and hurries a spin), E buys an extra spin, C collects, A toggles
  Auto-place, 1-5 place a waiting joker in that column. A tap on the reels spins. A screen reader hears each spin,
  the decision and the result. Dev only: window.__linesForce (save.ts) and window.__linesState().
*/

const TURBO_KEY = 'lumen.lines.turbo'
const AUTO_KEY = 'lumen.lines.auto'
/** once the decision is up, presses on it wait this long */
const DECIDE_HOLD = 900
/** after a collect, Play waits this long (a double press on Collect can't start a new game) */
const PLAY_HOLD = 700
/** an extra spin dearer than this many bets asks for a second press */
const CONFIRM_OVER = 5
const EMPTY: readonly boolean[] = new Array(25).fill(false)
const NO_LOOKS: readonly Look[] = [null, null, null, null, null]

type XY = { x: number; y: number }
interface Flight {
  id: number
  s: ReelSym
  col: number
  from: XY
  to: XY
  /** the size it arrives at (a ticket shrinks into the spins counter) */
  end: number
  ms: number
  done: () => void
}
/** 'move': the last waiting joker is on its way to its number; 'full': a full card about to collect itself */
type Phase = 'idle' | 'spin' | 'move' | 'place' | 'ready' | 'extras' | 'full'
/** the spins counter as shown (it moves with the show, not with the game) */
interface Counter {
  left: number
  free: number
  extras: number
}
type Finished = Result & { card: number[]; marks: boolean[]; jokered: number[] }

/** the cell a number in each line still needs, for lines one number away */
function nearCells(marks: readonly boolean[]): Set<number> {
  const out = new Set<number>()
  for (const l of LINES) {
    const open = l.filter((i) => !marks[i])
    if (open.length === 1) out.add(open[0])
  }
  return out
}
/** how many numbers each unfinished line still needs */
const linesNeed = (marks: readonly boolean[]) => LINES.map((l) => l.filter((i) => !marks[i]).length).filter((n) => n > 0)
/** one card state, for the price kept for it */
const sigOf = (g: Game) => `${g.bet}|${g.extras}|${g.marks.map((m) => (m ? 1 : 0)).join('')}`
const randomRest = (): ReelSym[] => [0, 1, 2, 3, 4].map((c) => ({ kind: 'num', n: 15 * c + 1 + Math.floor(Math.random() * 15), cell: null }))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listOf = (xs: (string | number)[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

/**
 * When each reel stops: left to right, and a reel that could finish a line (its column holds the number a line
 * needs, counting what the reels before it marked) is teased with a longer, slower stop; two at most a spin. It only
 * looks at the card, never at what the reel will show.
 */
function planSpin(marks0: readonly boolean[], reels: ReelSym[], quick: boolean): SpinPlan {
  const marks = marks0.slice()
  const stopAt: number[] = []
  const tease: boolean[] = []
  let t = quick ? 300 : 560
  let teases = 0
  for (let c = 0; c < 5; c++) {
    const near = [...nearCells(marks)].some((i) => colOf(i) === c)
    const on = c >= 1 && teases < 2 && near
    if (on) {
      t += quick ? 260 : 620
      teases++
    }
    stopAt.push(t)
    tease.push(on)
    const s = reels[c]
    if (s.kind === 'num' && s.cell != null) marks[s.cell] = true
    t += quick ? 105 : 210
  }
  return { stopAt, tease, speed: quick ? 22 : 16, quick }
}

/** the shout for lines just finished; "Bingo!" is a win, so it waits for the first line that pays (the ladder's first step) */
function lineShout(fresh: number, total: number) {
  if (total === 12) return 'Full card!'
  if (fresh >= 4) return `${fresh} lines!`
  if (fresh === 3) return 'Triple!'
  if (fresh === 2) return 'Double!'
  return total === STEPS[0].lines ? 'Bingo!' : 'Line!'
}

export default function LuckyLines() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [game, setGame] = useState<Game | null>(null)
  const [shown, setShown] = useState<readonly boolean[]>(EMPTY)
  const [stamps, setStamps] = useState<Record<number, number>>({})
  const [jokered, setJokered] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const [placing, setPlacing] = useState(0)
  const [preview, setPreview] = useState<number[]>(() => newCard(rand))
  const [dealKey, setDealKey] = useState(0)
  const [result, setResult] = useState<Finished | null>(null)
  /** this visit's finished games, newest first */
  const [past, setPast] = useState<(Result & { id: number })[]>([])
  const [price, setPrice] = useState<{ sig: string; value: number; floor: boolean } | null>(null)
  /** the card state a dear extra spin was pressed for once (the next press buys it) */
  const [armed, setArmed] = useState<string | null>(null)
  const [turbo, setTurbo] = useState(() => safeStorage.getItem(TURBO_KEY) === '1')
  // off until the player turns it on: placing the jokers is the game's choice
  const [autoPlace, setAutoPlace] = useState(() => safeStorage.getItem(AUTO_KEY) === '1')
  const [held, setHeld] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const [shout, setShout] = useState<Shout | null>(null)
  const [big, setBig] = useState<BigWinData | null>(null)
  const [landGlow, setLandGlow] = useState<number[]>([])
  const [landSuper, setLandSuper] = useState(false)
  const [looks, setLooks] = useState<readonly Look[]>(NO_LOOKS)
  const [counter, setCounter] = useState<Counter | null>(null)
  const [flights, setFlights] = useState<Flight[]>([])
  const [reels, setReels] = useState<{ key: number; rest: ReelSym[] }>(() => ({ key: 0, rest: randomRest() }))
  const [info, setInfo] = useState(false)
  /** what a screen reader hears: each spin, the decision, the result */
  const [said, setSaid] = useState('')
  // a touch screen: no key hints, and "tap" rather than "click"
  const [touch] = useState(() => typeof matchMedia === 'function' && matchMedia('(hover: none), (pointer: coarse)').matches)

  const [stageRef, box] = useSize<HTMLDivElement>()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fxRef = useRef<Fx | null>(null)
  const reelsRef = useRef<ReelsHandle>(null)
  const gameRef = useRef<Game | null>(null)
  const keyRef = useRef(gameKey(null))
  const shownRef = useRef<readonly boolean[]>(EMPTY)
  const jokeredRef = useRef<number[]>([])
  const busyRef = useRef(false)
  /** jokers in flight to their numbers */
  const placingRef = useRef(0)
  const hurried = useRef(false)
  /** a full card is about to collect itself: no more moves */
  const closing = useRef(false)
  const alive = useRef(true)
  const seq = useRef(1)
  const decideAt = useRef(0)
  const collectedAt = useRef(-Infinity)
  const armedRef = useRef<string | null>(null)
  /** what this page collected as it was being left, until the player shows it stayed */
  const leftRef = useRef<Result | null>(null)
  const shoutTimer = useRef(0)
  const autoTimer = useRef(0)
  const armTimer = useRef(0)
  const flightsRef = useRef<Flight[]>([])
  const live = useRef({ turbo, autoPlace, held })
  live.current = { turbo, autoPlace, held }

  const f = fit(box.w, box.h, box.w < 560 ? 6 : 18)
  const fitRef = useRef(f)
  fitRef.current = f

  /* ---------------- the stage's pieces ---------------- */

  useEffect(() => {
    alive.current = true
    const cv = canvasRef.current
    if (cv) fxRef.current = new Fx(cv)
    return () => {
      alive.current = false
      fxRef.current?.dispose()
      fxRef.current = null
      clearTimeout(shoutTimer.current)
      clearTimeout(autoTimer.current)
      clearTimeout(armTimer.current)
    }
  }, [])
  useEffect(() => fxRef.current?.resize(box.w, box.h), [box.w, box.h])
  useEffect(() => safeStorage.setItem(TURBO_KEY, turbo ? '1' : '0'), [turbo])
  useEffect(() => safeStorage.setItem(AUTO_KEY, autoPlace ? '1' : '0'), [autoPlace])

  /** a point in machine space, on the stage */
  const onStage = (p: XY): XY => {
    const q = fitRef.current
    return { x: q.ox + (q.mx + p.x) * q.k, y: q.oy + (q.my + p.y) * q.k }
  }

  const say = (kind: ShoutKind, text: string, ms = 1100) => {
    clearTimeout(shoutTimer.current)
    const s = { id: seq.current++, kind, text }
    setShout(s)
    shoutTimer.current = window.setTimeout(() => alive.current && setShout((x) => (x?.id === s.id ? null : x)), ms * (live.current.turbo ? 0.75 : 1))
  }
  const setLook = (i: number, l: Look) => setLooks((xs) => xs.map((x, k) => (k === i ? l : x)))

  /* ---------------- one tab per player, and the saved game ---------------- */

  // One tab at a time plays for a player: two would each save the game over the other's. The page holds the
  // player's lock while it is open (a tab that closes or dies lets go) and touches the saved game only once it has
  // it; a second tab waits, says so, and picks up the game as soon as the first lets go.
  useEffect(() => {
    if (authStatus === 'loading') return
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks
    if (!locks) {
      setHeld(true)
      return
    }
    const quit = new AbortController()
    let gone = false
    let release = () => {}
    // a moment's wait is this page starting over (its old lock on its way out); any longer, another tab has it
    const slow = window.setTimeout(() => setElsewhere(true), 1500)
    locks
      .request(lockName(uid), { signal: quit.signal }, async () => {
        if (gone) return
        // Tabs' wallets don't follow each other: another tab may have staked and collected since this page read the
        // wallet, and this tab's first bet would write its old balance over all of that. Pick up what is stored first.
        await useWallet.persist.rehydrate()
        if (gone) return
        return new Promise<void>((done) => {
          release = done
          clearTimeout(slow)
          setElsewhere(false)
          setHeld(true)
        })
      })
      .catch(() => {
        // given up because the page went first; or locks refused here (a page with no origin, say): play without one
        if (gone) return
        clearTimeout(slow)
        setHeld(true)
      })
    return () => {
      gone = true
      clearTimeout(slow)
      quit.abort()
      release()
      setHeld(false)
    }
  }, [authStatus, uid])

  // with the lock: say what a game collected as the page closed paid, and pick up a game in play exactly where it was
  useEffect(() => {
    if (!held) return
    const key = gameKey(uid)
    const n = safeStorage.getItem(NOTICE_KEY)
    if (n != null) {
      safeStorage.removeItem(NOTICE_KEY)
      try {
        const o = JSON.parse(n) as { payout?: number; lines?: number }
        const amount = Number(o.payout)
        if (amount > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your Lucky Lines card was collected when you left', amount })
        else useWallet.getState().pushToast({ kind: 'info', title: `Your Lucky Lines card was collected when you left (${plural(Number(o.lines) || 0, 'line')})` })
      } catch {
        /* a damaged notice */
      }
    }
    if (gameRef.current) {
      if (keyRef.current === key) return
      // the account changed under the page: that player's game stays saved under their key
      gameRef.current = null
      setGame(null)
    }
    keyRef.current = key
    const saved = loadGame(key)
    if (!saved) return
    if (saved.game.done) {
      clearGame(key)
      return
    }
    const g = saved.game
    gameRef.current = g
    jokeredRef.current = saved.jokered
    shownRef.current = g.marks
    setGame(g)
    setJokered(saved.jokered)
    setShown(g.marks)
    setStamps({})
    setResult(null)
    setBet(g.bet)
    setDealKey((k) => k + 1)
    setCounter({ left: g.spins, free: g.freeWon, extras: g.extras })
    if (g.last) {
      setReels((r) => ({ key: r.key + 1, rest: g.last! }))
      // Super Jokers are placed in reel order (jokerReel): the first ones are used, the last g.supers still wait
      const superReels = g.last.flatMap((s, c) => (s.kind === 'super' ? [c] : []))
      const usedSupers = superReels.length - g.supers
      setLooks(
        g.last.map((s, c) => {
          if (s.kind === 'num') return s.cell != null ? 'hit' : 'miss'
          if (s.kind === 'joker') return g.jokers.includes(c) ? 'wait' : 'used'
          if (s.kind === 'super') return superReels.indexOf(c) < usedSupers ? 'used' : 'wait'
          return 'hit'
        }),
      )
    }
    const isFull = g.marks.every(Boolean)
    linesSfx.welcome()
    say('welcome', isFull ? 'Welcome back: your full card is here' : 'Welcome back: your card is still here', isFull ? 1600 : 2600)
    // a full card left in its beat (a reload, a closed tab) collects itself now; nothing else can happen to it
    if (isFull) closeFull(1300)
    else if (atExtras(g)) decideAt.current = performance.now()
    // a resumed game with jokers waiting and Auto-place on carries on by itself
    else if ((g.jokers.length || g.supers) && live.current.autoPlace) scheduleAuto(1400)
    // the lock is per player; the rest reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, uid])

  /** the game moves on: kept in memory and saved before anything shows it */
  const commit = (g: Game) => {
    gameRef.current = g
    saveGame(keyRef.current, g, jokeredRef.current)
    setGame(g)
  }

  /* ---------------- collecting ---------------- */

  /**
   * Ends the game and pays the ladder, once. The decision collects on a press or when the page is left while it is
   * up; a full card (nothing left to decide) collects itself after its beat, on a press, or however the page is left,
   * even mid-show. Returns what it paid (null if there was nothing to collect).
   */
  const collect = (why: 'press' | 'leave' | 'full'): Result | null => {
    const g = gameRef.current
    if (!g || g.done) return null
    const full = g.marks.every(Boolean)
    const settled = !busyRef.current && !placingRef.current
    const ok = why === 'leave' ? full || (settled && atExtras(g)) : why === 'full' ? full : settled && (full || atExtras(g))
    if (!ok) return null
    const { payout, lines } = finish(g)
    const st = staked(g)
    gameRef.current = null
    collectedAt.current = performance.now()
    clearTimeout(autoTimer.current)
    clearGame(keyRef.current)
    useWallet.getState().settle({ game: 'lines', bet: st, payout, meta: { lines, extras: g.extras, full: lines === 12, free: g.freeWon } })
    const r: Result = { lines, mult: ladderPay(lines), payout, staked: st, extras: g.extras, free: g.freeWon }
    if (!alive.current) return r
    setGame(null)
    setPrice(null)
    disarm()
    setResult({ ...r, card: g.card, marks: g.marks, jokered: jokeredRef.current })
    setPast((xs) => [{ ...r, id: seq.current++ }, ...xs].slice(0, 12))
    setCounter(null)
    setSaid(payout > 0 ? `Collected ${fmt(payout)} for ${plural(lines, 'line')}.` : `Game over: ${plural(lines, 'line')}, no prize.`)
    const tier = tierOf(r.mult, lines)
    if (tier) setBig({ id: seq.current++, tier, mult: r.mult, lines, amount: payout })
    else if (payout > 0) {
      linesSfx.collect(r.mult)
      const at = onStage({ x: MACHINE_W / 2, y: REELS_TOP + 60 })
      fxRef.current?.coins(at.x, at.y, 8 + Math.round(r.mult * 4), fitRef.current.k)
    } else linesSfx.over()
    return r
  }

  /**
   * Collect clicked or tapped: on the decision only once it has been up a moment (the panel's Collect opens where the
   * Spin button was, and the plate over the reels being tapped to hurry them). The C key, used for nothing else,
   * collects at once.
   */
  const collectPress = () => {
    const g = gameRef.current
    if (g && atExtras(g) && performance.now() - decideAt.current < DECIDE_HOLD) return
    collect('press')
  }

  /** a full card has nothing left to win: a beat to see it, then it collects itself */
  function closeFull(ms: number) {
    closing.current = true
    clearTimeout(autoTimer.current)
    window.setTimeout(() => {
      closing.current = false
      if (alive.current) collect('full')
    }, ms)
  }

  // Closing, reloading or leaving the site while the decision is up (or a full card is waiting) collects the card,
  // and the next visit says so. If the page stays after all (a cancelled leave), the result just shows.
  useEffect(() => {
    const onHide = () => {
      // a leave already collected this page's card: say so again (the notice may have been cleared below while a
      // slow next page loaded, and this is the pagehide as the page really goes)
      const r = collect('leave') ?? leftRef.current
      if (!r) return
      leftRef.current = r
      safeStorage.setItem(NOTICE_KEY, JSON.stringify({ payout: r.payout, lines: r.lines }))
      // timers don't run once the page is gone: this only fires if it stayed, or is still waiting for the next page
      window.setTimeout(() => safeStorage.removeItem(NOTICE_KEY), 300)
    }
    // the player using the page again: it stayed, and there is nothing to tell a next visit
    const stayed = () => void (leftRef.current = null)
    window.addEventListener('beforeunload', onHide)
    window.addEventListener('pagehide', onHide)
    window.addEventListener('pointerdown', stayed, true)
    window.addEventListener('keydown', stayed, true)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('pointerdown', stayed, true)
      window.removeEventListener('keydown', stayed, true)
    }
    // collect only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // going to another page of the casino does the same, with a toast
  useEffect(
    () => () => {
      const r = collect('leave')
      if (!r) return
      const w = useWallet.getState()
      if (r.payout > 0) w.pushToast({ kind: 'win', title: 'Your Lucky Lines card was collected as you left', amount: r.payout })
      else w.pushToast({ kind: 'info', title: 'Your Lucky Lines card was collected as you left' })
    },
    // collect only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /* ---------------- showing a spin ---------------- */

  /** a ball (or a joker) flies from its reel to its cell; resolves as it lands (at once when hurried) */
  const fly = (s: ReelSym, col: number, from: XY, to: XY, end = 1.02): Promise<void> =>
    new Promise((resolve) => {
      if (hurried.current || !alive.current) return resolve()
      let over = false
      const fl: Flight = {
        id: seq.current++,
        s,
        col,
        from,
        to,
        end,
        ms: live.current.turbo ? 240 : 400,
        done: () => {
          if (over) return
          over = true
          flightsRef.current = flightsRef.current.filter((x) => x !== fl)
          if (alive.current) setFlights(flightsRef.current)
          resolve()
        },
      }
      flightsRef.current = [...flightsRef.current, fl]
      setFlights(flightsRef.current)
    })

  const hurry = () => {
    if (!busyRef.current || hurried.current) return
    hurried.current = true
    reelsRef.current?.hurry()
    flightsRef.current.forEach((fl) => fl.done())
  }

  /** stamps a number on the card: the daub, its sound and ink, and any line it finishes (with the ladder's step) */
  const daub = (cell: number, joker: boolean) => {
    if (!alive.current || shownRef.current[cell]) return
    const before = shownRef.current
    const after = before.slice()
    after[cell] = true
    shownRef.current = after
    setShown(after)
    setStamps((s) => ({ ...s, [cell]: (s[cell] ?? 0) + 1 }))
    const fill = Math.max(...LINES_AT[cell].map((k) => LINES[k].filter((j) => after[j]).length))
    linesSfx.daub(fill, joker)
    const k = fitRef.current.k
    const at = onStage(cellXY(cell))
    fxRef.current?.splat(at.x, at.y, COL[colOf(cell)].main, k)
    const l0 = linesOf(before)
    const l1 = linesOf(after)
    if (l1 <= l0) return
    const was = new Set(doneLines(before))
    for (const ln of doneLines(after)) {
      if (was.has(ln)) continue
      const e = LINE_ENDS[ln]
      const a = onStage({ x: e.x0, y: e.y0 })
      const b = onStage({ x: e.x1, y: e.y1 })
      fxRef.current?.line(a.x, a.y, b.x, b.y, k)
    }
    linesSfx.line(l1 - l0, l1)
    say('line', lineShout(l1 - l0, l1), 1000)
    const s0 = stepOf(l0)
    const s1 = stepOf(l1)
    if (s1 > s0) {
      window.setTimeout(() => alive.current && linesSfx.step(s1), 160)
      const q = fitRef.current
      const p = stepXY(q.mode, s1)
      const ox = q.mode === 'wide' ? MACHINE_W + SIDE_GAP : 0
      fxRef.current?.sparkle(q.ox + (ox + p.x) * q.k, q.oy + p.y * q.k, k, 12)
    }
  }

  /** what a reel's landing does: a number flies to its cell, a Joker lights its column, a Free Spin adds a spin */
  const land = (i: number, s: ReelSym, next: Game): Promise<void> => {
    linesSfx.stop(i)
    if (s.kind === 'num') {
      if (s.cell != null && !shownRef.current[s.cell]) {
        const cell = s.cell
        setLook(i, 'hit')
        return fly(s, i, reelXY(i), cellXY(cell)).then(() => daub(cell, false))
      }
      setLook(i, 'miss')
    } else if (s.kind === 'joker') {
      // a Joker whose column is already full has nowhere to go (the rules drop it)
      const ok = next.jokers.includes(i)
      setLook(i, ok ? 'wait' : 'miss')
      if (ok) {
        setLandGlow((xs) => [...xs, i])
        linesSfx.joker()
        say('joker', 'Joker!', 900)
      }
    } else if (s.kind === 'super') {
      const ok = next.supers > 0
      setLook(i, ok ? 'wait' : 'miss')
      if (ok) {
        setLandSuper(true)
        linesSfx.superJoker()
        say('super', 'Super Joker!', 1100)
      }
    } else {
      // the ticket flies into the spins counter, which gains a pip as it lands
      setLook(i, 'hit')
      linesSfx.free()
      say('free', 'Free spin!', 1100)
      return fly(s, i, reelXY(i), { x: 230, y: REELS_TOP + PLATE / 2 + 1 }, 0.3).then(() => setCounter((c) => (c ? { ...c, left: c.left + 1, free: c.free + 1 } : c)))
    }
    return Promise.resolve()
  }

  /** acts a drawn spin out: the reels, the flights, the daubs; then whatever comes next */
  const show = async (prev: Game, next: Game) => {
    busyRef.current = true
    hurried.current = false
    setBusy(true)
    setLooks(NO_LOOKS)
    setLandGlow([])
    setLandSuper(false)
    // the counter: a paid-up spin is used as it starts, a free one added as it lands
    setCounter({ left: prev.spins > 0 ? prev.spins - 1 : 0, free: prev.freeWon, extras: next.extras })
    const quick = live.current.turbo
    const syms = next.last!
    linesSfx.spin(quick)
    const lands: Promise<void>[] = []
    try {
      await reelsRef.current?.spin(
        syms,
        planSpin(prev.marks, syms, quick),
        (i) => lands.push(land(i, syms[i], next)),
        () => linesSfx.tease(),
      )
      await Promise.all(lands)
    } catch {
      // never expected: a failed show must not lock the game
    }
    if (!alive.current) return
    // the card shows exactly the game now
    for (let i = 0; i < 25; i++) if (next.marks[i] && !shownRef.current[i]) daub(i, false)
    setCounter({ left: next.spins, free: next.freeWon, extras: next.extras })
    busyRef.current = false
    setBusy(false)
    setLandGlow([])
    setLandSuper(false)
    setSaid(spinNews(prev, next))
    afterStep(next)
  }

  /** a spin, in words */
  const spinNews = (prev: Game, next: Game) => {
    const marked = next.last!.flatMap((s) => (s.kind === 'num' && s.cell != null ? [s.n] : []))
    const parts = [`Spin ${next.spun}: ${marked.length ? `${listOf(marked)} marked` : 'nothing marked'}`]
    if (next.jokers.length) parts.push(`a Joker for the ${listOf(next.jokers.map((c) => COL[c].letter))} ${next.jokers.length === 1 ? 'column' : 'columns'}`)
    if (next.supers) parts.push(next.supers === 1 ? 'a Super Joker' : `${next.supers} Super Jokers`)
    if (next.freeWon > prev.freeWon) parts.push(plural(next.freeWon - prev.freeWon, 'free spin'))
    parts.push(plural(linesOf(next.marks), 'line'))
    return `${parts.join('. ')}.`
  }

  /** after a spin or a joker has been shown: a full card collects, a waiting joker may place itself, the decision opens */
  const afterStep = (g: Game) => {
    if (gameRef.current !== g || busyRef.current || placingRef.current) return
    if (g.marks.every(Boolean)) return closeFull(650)
    if (g.jokers.length || g.supers) {
      if (live.current.autoPlace) scheduleAuto()
      return
    }
    if (atExtras(g)) {
      decideAt.current = performance.now()
      const pays = round2(g.bet * ladderPay(linesOf(g.marks)))
      setSaid((s) => `${s} No spins left: the card pays ${fmt(pays)}. Buy an extra spin, or collect.`)
    }
  }

  const rngFor = (g: Game) => {
    if (!import.meta.env.DEV) return rand
    const w = window as unknown as { __linesForce?: unknown }
    const force = w.__linesForce
    if (force == null) return rand
    delete w.__linesForce
    return forcedRng(g, force)
  }

  /* ---------------- the player's moves ---------------- */

  const play = () => {
    if (!live.current.held || gameRef.current || busyRef.current) return
    if (performance.now() - collectedAt.current < PLAY_HOLD) return
    const unit = bet
    if (!stake(unit)) return
    // the card drawn ahead becomes the game's (before a first game it is the one on show; any card is as good as
    // another, the reels drawing each column evenly)
    const g0: Game = { ...newGame(unit, rand), card: preview }
    const g1 = spin(g0, rngFor(g0))
    jokeredRef.current = []
    shownRef.current = EMPTY
    setJokered([])
    setShown(EMPTY)
    setStamps({})
    setResult(null)
    setBig(null)
    setPrice(null)
    setDealKey((k) => k + 1)
    setPreview(newCard(rand))
    commit(g1)
    linesSfx.deal()
    void show(g0, g1)
  }

  const spinNow = () => {
    const g = gameRef.current
    if (!g || busyRef.current || placingRef.current || closing.current || !canSpin(g)) return
    const next = spin(g, rngFor(g))
    commit(next)
    void show(g, next)
  }

  /** the reel a joker for `cell` comes from: its column's, or a Super Joker's */
  const jokerReel = (g: Game, cell: number) => {
    const c = colOf(cell)
    if (g.jokers.includes(c)) return c
    const supers = (g.last ?? []).flatMap((s, i) => (s.kind === 'super' ? [i] : []))
    return supers[Math.max(0, supers.length - g.supers)] ?? c
  }

  /** places a waiting joker; the next one can be placed while this one is still flying to its number */
  const placeAt = (cell: number) => {
    const g = gameRef.current
    if (!g || busyRef.current || closing.current || !placeable(g).has(cell)) return
    clearTimeout(autoTimer.current)
    const from = jokerReel(g, cell)
    const s: ReelSym = g.jokers.includes(colOf(cell)) ? { kind: 'joker' } : { kind: 'super' }
    const next = place(g, cell)
    jokeredRef.current = [...jokeredRef.current, cell]
    setJokered(jokeredRef.current)
    commit(next)
    setLook(from, 'used')
    placingRef.current++
    setPlacing((n) => n + 1)
    linesSfx.placed()
    setSaid(`Joker placed on ${g.card[cell]}.`)
    hurried.current = false
    void fly(s, from, reelXY(from), cellXY(cell)).then(() => {
      daub(cell, true)
      placingRef.current--
      if (!alive.current) return
      setPlacing((n) => n - 1)
      // the last flight to land moves the game on (afterStep waits while any is in the air)
      const now = gameRef.current
      if (now) afterStep(now)
    })
  }

  const placeBest = () => {
    const g = gameRef.current
    if (g) placeAt(bestCell(g))
  }

  /** places a waiting joker in column c's best cell (a column joker, or a Super Joker kept to that column) */
  const placeCol = (c: number) => {
    const g = gameRef.current
    if (!g || (!g.jokers.includes(c) && g.supers <= 0)) return
    const i = suggest(g.marks, c)
    if (i >= 0) placeAt(i)
  }

  function scheduleAuto(ms?: number) {
    clearTimeout(autoTimer.current)
    autoTimer.current = window.setTimeout(
      () => {
        const g = gameRef.current
        if (!alive.current || !g || !live.current.autoPlace || !(g.jokers.length || g.supers)) return
        placeBest()
      },
      ms ?? (live.current.turbo ? 320 : 700),
    )
  }

  // switching Auto-place on with a joker waiting places it
  useEffect(() => {
    const g = gameRef.current
    if (autoPlace && g && (g.jokers.length || g.supers) && !busyRef.current && !placingRef.current) scheduleAuto(250)
    if (!autoPlace) clearTimeout(autoTimer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlace])

  const sig = game && atExtras(game) && !busy && !placing ? sigOf(game) : null
  const priceNow = price && sig && price.sig === sig ? price.value : null
  const floor = !!price && price.sig === sig && price.floor
  const isArmed = armed != null && armed === sig
  // the extra spin's price, worked out once per card state, after the frame that shows the decision
  useEffect(() => {
    if (!sig || price?.sig === sig) return
    const t = window.setTimeout(() => {
      const g = gameRef.current
      if (!alive.current || !g || sigOf(g) !== sig) return
      const value = extraValue(g.marks)
      setPrice({ sig, value: extraPrice(g, value), floor: atPriceFloor(value) })
    }, 60)
    return () => clearTimeout(t)
  }, [sig, price])

  function disarm() {
    clearTimeout(armTimer.current)
    armedRef.current = null
    setArmed(null)
  }

  const buy = () => {
    const g = gameRef.current
    if (!g || busyRef.current || placingRef.current || closing.current || !atExtras(g) || extrasLeft(g) <= 0) return
    // presses meant for the spins (a run of clicks, taps on the reels to hurry them) can't land on the decision
    if (performance.now() - decideAt.current < DECIDE_HOLD) return
    const s = sigOf(g)
    const p = price && price.sig === s ? price.value : null
    if (p == null) return
    if (useWallet.getState().balance < p) {
      useWallet.getState().pushToast({ kind: 'info', title: `An extra spin costs ${fmt(p)}: not enough coins. Collect this card to end the game.` })
      return
    }
    // a dear spin takes a second press
    if (p > CONFIRM_OVER * g.bet && armedRef.current !== s) {
      clearTimeout(armTimer.current)
      armedRef.current = s
      setArmed(s)
      sfx.click()
      armTimer.current = window.setTimeout(() => alive.current && disarm(), 3500)
      return
    }
    disarm()
    if (!useWallet.getState().placeBet(p, 0.01)) return
    linesSfx.buy()
    const bought = buyExtra(g, p)
    const next = spin(bought, rngFor(bought))
    commit(next)
    void show(bought, next)
  }

  const full = !!game && game.marks.every(Boolean)
  const jokersWaiting = !!game && (game.jokers.length > 0 || game.supers > 0)
  const phase: Phase = !game ? 'idle' : busy ? 'spin' : full ? (placing ? 'move' : 'full') : jokersWaiting ? 'place' : placing ? 'move' : canSpin(game) ? 'ready' : 'extras'

  /** Space: play, spin, place the suggested joker, or hurry a spin. Never a buy: the decision waits for E or a press on it */
  const press = () => {
    if (!held) return
    if (phase === 'spin') return hurry()
    if (phase === 'idle') return play()
    if (phase === 'ready') return spinNow()
    if (phase === 'place') return placeBest()
  }

  // one listener for the page's life, calling the latest handler (it reads this render's phase and price)
  const onKey = useRef<(e: KeyboardEvent) => void>(() => {})
  onKey.current = (e) => {
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || info || big || e.metaKey || e.ctrlKey || e.altKey) return
    const k = e.key.toLowerCase()
    if (e.code === 'Space') {
      e.preventDefault()
      if (e.repeat) return
      // a focused button would take the Space too
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
      press()
    } else if (k === 'e') {
      // a fresh press only: a key held down from before the decision opened can't buy
      if (!e.repeat && phase === 'extras') buy()
    } else if (k === 'c') {
      if (!e.repeat && (phase === 'extras' || phase === 'full')) collect('press')
    } else if (k === 'a') setAutoPlace((a) => !a)
    else if (/^[1-5]$/.test(k) && phase === 'place') placeCol(Number(k) - 1)
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // dev: the state, for test scripts
  const devState = useRef<() => unknown>(() => null)
  devState.current = () => ({ phase, game: gameRef.current, price: priceNow, floor, armed: isArmed, shown: shownRef.current, held, elsewhere, result, autoPlace, turbo, said })
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as { __linesState?: () => unknown }
    w.__linesState = () => devState.current()
    return () => {
      delete w.__linesState
    }
  }, [])

  /* ---------------- what shows ---------------- */

  const card = game ? game.card : result ? result.card : preview
  const marks = game ? shown : result ? result.marks : EMPTY
  const jokeredSet = useMemo(() => new Set(game ? jokered : result ? result.jokered : []), [game, jokered, result])
  const waiting = useMemo(() => (phase === 'place' && game ? effectsOf(game.marks, placeable(game)) : null), [phase, game])
  const best = phase === 'place' && game ? bestCell(game) : -1
  const glowCols = useMemo(() => new Set(busy ? landGlow : phase === 'place' && game ? game.jokers : []), [busy, landGlow, phase, game])
  const superGlow = busy ? landSuper : phase === 'place' && !!game && game.supers > 0
  const near = useMemo(() => (game ? nearCells(marks) : new Set<number>()), [game, marks])
  const lines = linesOf(marks)
  const pays = ladderPay(lines)
  const curBet = game ? game.bet : bet
  const left = game ? extrasLeft(game) : 0
  const afford = priceNow != null && balance >= priceNow
  const hints = phase === 'extras' && game ? extraHints(marks, lines, linesNeed(marks)) : []
  const pick = useCallback((cell: number) => placeAt(cell), [])
  const c = counter ?? (game ? { left: game.spins, free: game.freeWon, extras: game.extras } : { left: BASE_SPINS, free: 0, extras: 0 })
  // the plate's buttons stay a thumb high (44 px) however small the stage draws them
  const btnH = Math.round(Math.min(80, Math.max(58, 46 / Math.max(f.k, 0.01))))

  /* ---------------- panel ---------------- */

  const topPrize = round2(curBet * LADDER[12])
  const mainButton = !held ? (
    <ActionButton tone="neutral" disabled sub={elsewhere ? 'Close it to play here' : undefined}>
      {elsewhere ? 'Open in another tab' : 'Loading…'}
    </ActionButton>
  ) : phase === 'idle' ? (
    <ActionButton onClick={play} disabled={balance < bet} sub={balance < bet ? 'Not enough coins' : `${BASE_SPINS} spins · ${fmt(bet)}`}>
      {result ? 'Play again' : 'Play'}
    </ActionButton>
  ) : phase === 'spin' ? (
    <ActionButton tone="neutral" onClick={hurry} sub="Tap to hurry">
      Spinning…
    </ActionButton>
  ) : phase === 'full' ? (
    // it collects itself in a moment; the button is there so no saved state can ever leave a full card waiting
    <ActionButton tone="gold" onClick={collectPress} sub={`Full card · ${fmt(round2(curBet * LADDER[12]))}`}>
      Collect 500×
    </ActionButton>
  ) : phase === 'move' ? (
    <ActionButton tone="neutral" disabled>
      Placing…
    </ActionButton>
  ) : phase === 'place' ? (
    autoPlace ? (
      <ActionButton tone="neutral" onClick={placeBest} sub="Auto-place is on">
        Placing joker…
      </ActionButton>
    ) : (
      <ActionButton tone="gold" onClick={placeBest} sub="On the suggested number">
        Place joker
      </ActionButton>
    )
  ) : phase === 'ready' ? (
    <ActionButton onClick={spinNow} sub={`${plural(game!.spins, 'spin')} left`}>
      Spin
    </ActionButton>
  ) : (
    <div className="grid grid-cols-2 gap-2">
      <ActionButton
        onClick={buy}
        disabled={priceNow == null || !afford || left <= 0}
        sub={left <= 0 ? 'None left' : priceNow == null ? 'Pricing…' : !afford ? 'Not enough coins' : isArmed ? 'Click again to buy' : fmt(priceNow)}
      >
        Extra spin
      </ActionButton>
      <ActionButton tone="gold" onClick={collectPress} sub={fmt(round2(curBet * pays))}>
        Collect
      </ActionButton>
    </div>
  )

  const panel = (
    <>
      <BetInput value={game ? game.bet : bet} onChange={setBet} disabled={!!game || !held} />
      <div className="rounded-lg bg-stage px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>{game ? 'Your card' : 'Lucky Lines'}</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works
          </button>
        </div>
        {game ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Lines" value={lines} />
            <Stat label="Card pays" value={<>{fmt(round2(game.bet * pays))} <Coin size={12} /></>} tone={pays > 0 ? 'gold' : undefined} />
            <Stat label={c.left > 0 || game.spins > 0 ? 'Spins left' : 'Extra spins'} value={c.left > 0 || game.spins > 0 ? `${c.left}${c.free ? ` · ${c.free} free won` : ''}` : `${game.extras} of ${MAX_EXTRA}`} />
            <Stat label="Staked" value={<>{fmt(staked(game))} <Coin size={12} /></>} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="For your bet" value={`${BASE_SPINS} spins`} />
            <Stat label="Top prize" value={<>{fmt(topPrize, topPrize >= 1e5 ? 0 : 2)} <Coin size={12} /></>} tone="gold" />
          </div>
        )}
      </div>
      {past.length > 0 && (
        <HistoryPills
          items={past.map((r) => ({
            key: r.id,
            tone: (r.mult >= 10 ? 'gold' : r.payout >= r.staked ? 'win' : r.payout > 0 ? 'neutral' : 'loss') as PillTone,
            label: r.payout > 0 ? `${r.mult}×` : plural(r.lines, 'line'),
          }))}
        />
      )}
      <ToggleRow title="Turbo" sub="Quicker reels" on={turbo} onChange={setTurbo} />
      <ToggleRow title="Auto-place jokers" sub="On the suggested number" on={autoPlace} onChange={setAutoPlace} hint="A" />
      {/* below the desktop layout the decision is the plate on the stage, just above: no second pair of buttons here */}
      <div className={`max-lg:order-first lg:mt-auto ${phase === 'extras' && held ? 'max-lg:hidden' : ''}`}>{mainButton}</div>
      <p className="hidden text-[11px] leading-relaxed text-dim lg:block">
        Space plays, spins or places the suggested joker · 1-5 place in a column · A auto-place · E extra spin · C collect. The base game returns about 95.5%; extra spins return 97% of
        their price on average.
      </p>
    </>
  )

  /* ---------------- stage ---------------- */

  const plate =
    phase === 'extras' && game ? (
      <ExtrasPlate
        key="extras"
        price={priceNow}
        floor={floor}
        collect={round2(game.bet * pays)}
        left={left}
        max={MAX_EXTRA}
        hints={hints}
        afford={afford}
        armed={isArmed}
        keys={!touch}
        touch={touch}
        btnH={btnH}
        onBuy={buy}
        onCollect={collectPress}
      />
    ) : !game && result ? (
      <ResultPlate key={`result${dealKey}`} r={result} />
    ) : null

  const stage = (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden"
      style={{ background: 'radial-gradient(ellipse at 50% 32%, #5d2fc0 0%, #34148a 48%, #1b0950 100%)' }}
      // a tap on the stage hurries a spin (not a press of a button on it, which does its own thing)
      onClick={(e) => busyRef.current && !(e.target as HTMLElement).closest('button') && hurry()}
    >
      <div className="sr-only" aria-live="polite">
        {said}
      </div>
      <Backdrop />
      <svg width="0" height="0" className="absolute" aria-hidden>
        <ArtDefs u={GAME_U} />
      </svg>

      <div className="absolute left-0 top-0" style={{ width: f.w, height: f.h, transform: `translate(${f.ox}px, ${f.oy}px) scale(${f.k})`, transformOrigin: '0 0' }}>
        {/* the ladder: beside the machine, or a strip above it */}
        <div className="absolute" style={{ left: f.mode === 'wide' ? MACHINE_W + SIDE_GAP : 0, top: 0 }}>
          <Ladder marks={marks} bet={curBet} mode={f.mode} live={!!game} />
        </div>

        {/* the machine: the card, the reels and what goes over them */}
        <div className="absolute" style={{ left: f.mx, top: f.my, width: MACHINE_W, height: MACHINE_H }}>
          <Card
            u={GAME_U}
            card={card}
            marks={marks}
            stamps={stamps}
            jokered={jokeredSet}
            placeable={waiting}
            best={best}
            glowCols={glowCols}
            superGlow={superGlow}
            near={near}
            deciding={phase === 'extras'}
            dealKey={dealKey}
            quick={turbo}
            onPick={pick}
          />
          {/* the reels: a tap on them spins when a spin is ready, like Space */}
          <div
            className={`absolute left-0 ${phase === 'ready' && held ? 'cursor-pointer' : ''}`}
            style={{ top: REELS_TOP, width: MACHINE_W, height: REELS_H }}
            onClick={(e) => {
              if (phase !== 'ready' || !held || (e.target as HTMLElement).closest('button')) return
              e.stopPropagation()
              spinNow()
            }}
          >
            <Reels key={reels.key} ref={reelsRef} u={GAME_U} rest={reels.rest} looks={looks} />
            <div className="absolute inset-x-0 top-0 flex items-center px-4" style={{ height: PLATE + 2 }}>
              <SpinsPlate
                base={BASE_SPINS}
                free={c.free}
                left={c.left}
                extras={c.extras}
                extraMax={MAX_EXTRA}
                pays={pays}
                bet={curBet}
                note={phase === 'place' && game && !autoPlace ? <JokerNote key={`j${game.jokers.join('')}-${game.supers}`} jokers={game.jokers} supers={game.supers} keys={!touch} /> : undefined}
                intro={phase === 'idle' && held && !result ? <IntroNote u={GAME_U} bet={fmt(bet)} /> : undefined}
              />
            </div>
            <AnimatePresence mode="wait">{plate}</AnimatePresence>
          </div>
          <ShoutLayer shout={shout} />
          {flights.map((fl) => (
            <motion.div
              key={fl.id}
              className="pointer-events-none absolute left-0 top-0 z-20"
              style={{ width: CELL - 4, height: CELL - 4, marginLeft: -(CELL - 4) / 2, marginTop: -(CELL - 4) / 2 }}
              initial={{ x: fl.from.x, y: fl.from.y, scale: 1 }}
              animate={{ x: [fl.from.x, fl.to.x], y: [fl.from.y, Math.min(fl.from.y, fl.to.y) - 46, fl.to.y], scale: [1, 1.24, fl.end] }}
              transition={{ duration: fl.ms / 1000, x: { ease: 'linear', duration: fl.ms / 1000 }, y: { ease: ['easeOut', 'easeIn'], duration: fl.ms / 1000 }, scale: { duration: fl.ms / 1000 } }}
              onAnimationComplete={() => fl.done()}
            >
              <Sym u={GAME_U} s={fl.s} col={fl.col} size={CELL - 4} />
            </motion.div>
          ))}
        </div>
      </div>

      <AnimatePresence>{big && <BigWin key={big.id} win={big} fx={fxRef.current} box={box} quick={turbo} onDone={() => setBig((b) => (b?.id === big.id ? null : b))} />}</AnimatePresence>
      {/* the particles fly over everything, the big win included */}
      <canvas ref={canvasRef} className="pointer-events-none absolute left-0 top-0 z-[45]" />

      <AnimatePresence>
        {elsewhere && !held && (
          <motion.div key="elsewhere" className="absolute inset-0 z-50 flex items-center justify-center bg-[#12062e]/75 p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="max-w-[340px] rounded-[22px] border-[4px] bg-white px-6 py-5 text-center" style={{ borderColor: INK, color: INK, boxShadow: '0 8px 0 rgba(29,15,48,.45)' }}>
              <div className="text-[19px] font-black">Lucky Lines is open in another tab</div>
              <div className="mt-1.5 text-[13.5px] font-semibold opacity-70">Play there, or close it: this tab picks your card up as soon as it is free.</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      {/* on a phone the stage keeps the card's shape, but never runs past the screen (the reels stay above the tab bar) */}
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(calc((100vw_-_38px)*1.7_+_14px),calc(100svh_-_150px))] max-sm:min-h-0 sm:max-lg:h-[min(84vh,880px)]" />
      <AnimatePresence>{info && <HowToPlay bet={curBet} onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'gold' }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-dim">{label}</div>
      <div className={`tnum flex items-center gap-1 truncate text-[14px] font-bold ${tone === 'gold' ? 'text-gold' : 'text-ink'}`}>{value}</div>
    </div>
  )
}

function ToggleRow({ title, sub, on, onChange, hint }: { title: string; sub: string; on: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
      <div className="min-w-0">
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

/** the stage behind the machine: a faint scatter of balls and twinkles, and a soft light where the card stands */
function Backdrop() {
  const dots = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const r = ((i * 7919) % 97) / 97
        const q = ((i * 104729) % 89) / 89
        return { x: r * 100, y: q * 100, s: 6 + ((i * 31) % 5) * 3, c: COL[i % 5].main, star: i % 3 === 0 }
      }),
    [],
  )
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <radialGradient id="ll-spot" cx="50%" cy="40%" r="55%">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#ll-spot)" />
      {dots.map((d, i) =>
        d.star ? (
          <svg key={i} x={`${d.x}%`} y={`${d.y}%`} overflow="visible">
            <path d={twinklePath(0, 0, d.s * 0.7)} fill="#fff" opacity=".14" />
          </svg>
        ) : (
          <svg key={i} x={`${d.x}%`} y={`${d.y}%`} overflow="visible">
            <circle r={d.s} fill={d.c} opacity=".13" />
          </svg>
        ),
      )}
    </svg>
  )
}
