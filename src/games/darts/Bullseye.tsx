import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Toggle, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { DARTS, REGIONS, TARGETS, THROWERS, drawRound, payout, regionName, regionScore, shapesOf, throwing, type Region, type Round, type TargetId, type ThrowerId } from './rules'
import { AimLayer, Backdrop, BoardFace, HitLayer, type Glow, type Hit } from './Board'
import { DartSprite, FLIGHTS, type Flight } from './Dart'
import { Ladder, LadderStrip } from './Ladder'
import { Scoreboard } from './Scoreboard'
import { Celebration, Ribbon, TIER_COUNT, TIER_NAME, WinPlate, tierOf } from './Result'
import { InfoModal } from './Info'
import { Grouping, MiniBoard } from './art'
import { aimOf, kindOf, type Kind } from './geom'
import { dartsSfx } from './sound'
import { breakEven, chanceText, multText, reach, reachAtStart, stepsOf, topStep } from './table'
import { calloutOf, spoken, type Callout } from './words'
import {
  LIVE_MS,
  clearNotice,
  clearPending,
  loadHistory,
  loadTarget,
  loadThrower,
  loadTurbo,
  pendingAge,
  pendingKey,
  pendingTaken,
  saveHistory,
  saveNotice,
  savePending,
  saveTarget,
  saveThrower,
  saveTurbo,
  takeNotice,
  takePending,
  withRound,
  type Meta,
  type PastRound,
  type PendingRound,
} from './storage'

/*
  Bullseye: three darts at a regulation board, paid on their total.

  The player sets a bet, picks a target (Treble 20, Treble 19 or the Bull) and a thrower (Pro, Regular or Wild, who
  scatter more or less), and throws. Throw takes the stake and draws the whole round at once (rules.ts: each dart's
  region and the exact point it sticks in, the total and what it pays). The round is kept as a pending payout, in
  memory and in localStorage, and paid exactly once: when the third dart is in, straight away if the page is left
  mid-round (the next visit says what it came to), or on the next visit if the page died. A round paid on a leave
  that was then cancelled just plays out; it is never paid or staked again. (storage.ts: the heartbeat that keeps a
  second tab off a live round. This is Sic Bo's scheme.)

  The show: the last round's darts are pulled, then each dart flies in from the oche (Dart.tsx) and thuds into its
  point; its bed flashes, the board answers in its own voice, and its call goes up on the scoreboard with the
  running total. The ladder beside the board fills to the total, locking in each step it passes, and its chances
  update to say what the darts to come need. When the last dart could make the round, the caller says so ("180
  ON!"), the room hushes, the camera leans in and the dart flies slow. Then the round is in: the ring light turns
  the colour of the result, the caller has his line for a ton, a ton-forty or the 180, and a win gets its plate (or,
  at ten times the stake and more, the stage). The darts stay in the board until the next throw.

  Dev hook (dev builds only): window.__dartsForce = [r1, r2, r3] (regions, 0-62: 60 is T20, 62 the bull, 0 a miss)
  or 180, for the next round.
*/

type Phase = 'idle' | 'throw' | 'result'

/** a dart on the board: stuck, or (with a flight) flying in */
interface Shown {
  key: string
  r: Region
  x: number
  y: number
  thrower: ThrowerId
  flight: Flight | null
  /** the dart's own slight angle (degrees) */
  tilt: number
}
/** the angle a dart sits at: the three of a round fan out, each with a little of its own */
const tiltOf = (i: number, x: number, y: number) => [-9, 0, 9][i] + ((Math.abs(Math.round(x * 7 + y * 13)) % 7) - 3)

/** the round on the scoreboard: the one in play, or the last one */
interface Scene {
  id: number
  target: TargetId
  thrower: ThrowerId
  regions: Region[]
  flying: number | null
  done: boolean
  mult: number
  payout: number
}

/** how the round came out, on the stage */
type Show =
  | { kind: 'celebrate'; id: number; headline: string; tier: number; amount: number; mult: number }
  | { kind: 'plate'; id: number; amount: number; mult: number; line: string | null }
  | { kind: 'line'; id: number; line: string }

const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
const sum = (rs: readonly Region[]) => rs.reduce((a, r) => a + regionScore(r), 0)
const round2 = (n: number) => Math.round(n * 100) / 100
const dartsText = (rs: readonly Region[]) => rs.map(regionName).join(' ')
const coins = (v: number) => fmt(v, v % 1 ? 2 : 0)

/** the settle details of a round */
const metaOf = (r: PastRound): Meta => ({ total: r.total, target: r.target, thrower: r.thrower, darts: dartsText(r.darts.map((d) => d.r)) })

/* ---------------- the stage's layout ---------------- */

/** how far the board's frame reaches (mm): the ring light on a wide stage, just past the board on a phone */
const FRAME = { wide: 270, narrow: 236 }

function layoutOf(w: number, h: number) {
  const wide = w >= 640 && h >= 440
  if (wide) {
    const pad = 16
    const ladderW = Math.round(Math.min(250, Math.max(228, w * 0.27)))
    const colW = w - ladderW - pad * 3
    const scoreH = 108
    const top = pad + 34
    const bottom = h - pad - scoreH - 10
    const areaH = Math.max(160, bottom - top)
    const D = Math.min(colW, areaH)
    const k = D / (2 * FRAME.wide)
    return {
      wide,
      h,
      k,
      cx: pad + colW / 2,
      cy: top + areaH / 2,
      col: { x: pad, w: colW },
      ladder: { x: w - pad - ladderW, y: pad, w: ladderW, h: h - pad * 2 },
      score: { x: pad + (colW - Math.min(colW, 520)) / 2, w: Math.min(colW, 520), bottom: pad },
    }
  }
  const pad = 8
  const stripH = 52
  const scoreH = 84
  const top = pad + stripH + 4
  const bottom = h - pad - scoreH - 4
  const areaH = Math.max(160, bottom - top)
  const D = Math.min(w - 8, areaH)
  const k = D / (2 * FRAME.narrow)
  return {
    wide,
    h,
    k,
    cx: w / 2,
    cy: top + areaH / 2,
    col: { x: pad, w: w - pad * 2 },
    ladder: { x: pad, y: pad, w: w - pad * 2, h: stripH },
    score: { x: pad, w: w - pad * 2, bottom: pad },
  }
}

/* ---------------- dev: forced rounds ---------------- */

/** a spot inside region r (mm, y up) for a forced dart to stick in */
function spotIn(r: Region): { x: number; y: number } {
  if (r === 0) {
    const a = rand() * 2 * Math.PI
    const d = 182 + rand() * 30
    return { x: d * Math.sin(a), y: d * Math.cos(a) }
  }
  const shapes = shapesOf(r)
  const s = shapes[Math.floor(rand() * shapes.length)]
  const rr = s.r0 + (s.r1 - s.r0) * (s.r0 === 0 ? rand() * 0.6 : 0.2 + rand() * 0.6)
  const a = ((s.a0 + (s.a1 - s.a0) * (0.15 + rand() * 0.7)) * Math.PI) / 180
  return { x: rr * Math.sin(a), y: rr * Math.cos(a) }
}

function forced(target: TargetId, thrower: ThrowerId, round: Round): Round {
  const w = window as unknown as { __dartsForce?: unknown }
  const f = w.__dartsForce
  if (f == null) return round
  delete w.__dartsForce
  const ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < REGIONS
  const regions: Region[] | null = f === 180 ? [60, 60, 60] : Array.isArray(f) && f.length === DARTS && f.every(ok) ? (f as Region[]) : null
  if (!regions) return round
  const t = throwing(target, thrower)
  const darts = regions.map((r) => ({ region: r, score: regionScore(r), ...spotIn(r) }))
  const total = sum(regions)
  return { darts, total, mult: t.pays[total] }
}

/* ---------------- the page ---------------- */

export default function Bullseye() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [target, setTargetState] = useState<TargetId>(loadTarget)
  const [thrower, setThrowerState] = useState<ThrowerId>(loadThrower)
  const [turbo, setTurboState] = useState(loadTurbo)
  const [hist, setHist] = useState<PastRound[]>(loadHistory)
  const histRef = useRef(hist)
  const [phase, setPhaseState] = useState<Phase>('idle')
  // the phase as of now, for the money path: two presses handled before React re-renders must not throw twice
  const phaseRef = useRef<Phase>('idle')
  const setPhase = (p: Phase) => {
    phaseRef.current = p
    setPhaseState(p)
  }
  const last = hist.length ? hist[hist.length - 1] : null
  const [shown, setShownState] = useState<Shown[]>(() => (last ? last.darts.map((d, i) => ({ key: `${last.t}-${i}`, r: d.r, x: d.x, y: d.y, thrower: last.thrower, flight: null, tilt: tiltOf(i, d.x, d.y) })) : []))
  const shownRef = useRef(shown)
  const setShown = (f: (s: Shown[]) => Shown[]) => {
    shownRef.current = f(shownRef.current)
    setShownState(shownRef.current)
  }
  const [scene, setScene] = useState<Scene | null>(() =>
    last ? { id: 0, target: last.target, thrower: last.thrower, regions: last.darts.map((d) => d.r), flying: null, done: true, mult: last.mult, payout: last.payout } : null,
  )
  const [hits, setHits] = useState<Hit[]>([])
  const [glow, setGlow] = useState<Glow>('idle')
  const [show, setShow] = useState<Show | null>(null)
  const [ribbon, setRibbon] = useState<{ text: string; sub: string } | null>(null)
  const [zoom, setZoom] = useState(false)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const [touch] = useState(isTouch)

  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const betRef = useRef(bet)
  betRef.current = bet
  const pick = useRef({ target, thrower })
  pick.current = { target, thrower }
  const setTurbo = useCallback((on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }, [])

  const [stageRef, size] = useSize<HTMLDivElement>()
  const L = layoutOf(size.w, size.h)
  const geo = useRef(L)
  geo.current = L
  const quake = useAnimationControls()

  // the selected pair's table (worked out once, then kept), and the rest warmed up while the page is idle
  const table = throwing(target, thrower)
  useEffect(() => {
    let on = true
    const pairs = TARGETS.flatMap((t) => THROWERS.map((h) => [t.id, h.id] as const))
    const idle = (fn: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(fn, { timeout: 1500 }) : window.setTimeout(fn, 60))
    const next = (i: number) => {
      if (!on || i >= pairs.length) return
      throwing(pairs[i][0], pairs[i][1])
      idle(() => next(i + 1))
    }
    idle(() => next(0))
    return () => {
      on = false
    }
  }, [])

  /* the round's bookkeeping (the money section below works it) */
  const run = useRef(0)
  const alive = useRef(true)
  const timers = useRef<number[]>([])
  const play = useRef<{ id: number; past: PastRound; logged: boolean } | null>(null)
  const pending = useRef<{ key: string; round: PendingRound } | null>(null)
  /** the round in play was paid as the page began to leave */
  const paidOnHide = useRef(false)
  /** the player asked to hurry the round in the air */
  const hurry = useRef(false)

  /* ---------------- money ---------------- */

  /**
   * Pays the round in play, once: when its last dart is in, or as soon as the player leaves (it is decided). A round
   * that another tab already took and paid (see storage.ts) is not paid again; null then, as when there is none.
   */
  const settlePending = () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    const taken = pendingTaken(p.key)
    clearPending(p.key)
    if (taken) return null
    useWallet.getState().settle({ game: 'darts', bet: p.round.bet, payout: p.round.payout, meta: p.round.meta })
    return p.round
  }

  /** puts a round in the history (and in storage), once */
  const logRound = (r: PastRound) => {
    const next = withRound(histRef.current, r)
    histRef.current = next
    saveHistory(next)
    if (alive.current) setHist(next)
  }

  useEffect(() => {
    alive.current = true
    // reloading, closing the tab or going to another site mid-round pays it on the way out; the next visit says so
    const onHide = () => {
      const p = settlePending()
      if (!p) return
      paidOnHide.current = true
      saveNotice({ amount: p.payout, total: p.past.total })
      // into the stored history now (the page may be going); on screen only when its last dart lands (it may stay)
      const r = play.current
      if (r && !r.logged) saveHistory(withRound(histRef.current, r.past))
    }
    // while a round's darts fly, its heartbeat tells other tabs it is live (and stops if one of them took it)
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
      // leaving the page mid-round pays the round at once, and says what it came to
      const p = settlePending()
      const r = play.current
      if (r && !r.logged) {
        r.logged = true
        logRound(r.past)
      }
      if (p) {
        if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your Bullseye round (${p.past.total}) paid out as you left`, amount: p.payout })
        else useWallet.getState().pushToast({ kind: 'info', title: `Your Bullseye round (${p.past.total}) didn't pay` })
      }
    }
    // settlePending and logRound only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A round whose page went away before it could pay is paid on the next visit, once sign-in has settled so it lands
  // in the wallet that took the stake; one paid as the page was left is announced. A round another tab is still
  // showing (its heartbeat is fresh) is left to that tab, and looked at again once the heartbeat would have stopped.
  useEffect(() => {
    if (authStatus === 'loading') return
    const n = takeNotice()
    if (n) {
      if (n.amount > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your last Bullseye round (${n.total}) paid out when you left`, amount: n.amount })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your last Bullseye round (${n.total}) didn't pay` })
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
      useWallet.getState().settle({ game: 'darts', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
      const past = p.past
      if (past) {
        logRound(past)
        // the board shows the round's darts, if it is free
        if (phaseRef.current === 'idle') {
          setShown(() => past.darts.map((d, i) => ({ key: `${past.t}-${i}`, r: d.r, x: d.x, y: d.y, thrower: past.thrower, flight: null, tilt: tiltOf(i, d.x, d.y) })))
          setScene({ id: 0, target: past.target, thrower: past.thrower, regions: past.darts.map((d) => d.r), flying: null, done: true, mult: past.mult, payout: past.payout })
        }
      }
      const what = past ? ` (${past.total})` : ''
      if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: `Your unfinished Bullseye round${what} paid out`, amount: p.payout })
      else useWallet.getState().pushToast({ kind: 'info', title: `Your unfinished Bullseye round${what} didn't pay` })
    }
    recover()
    return () => clearTimeout(timer)
    // logRound only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, uid])

  /* ---------------- the round ---------------- */

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms))
  }
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r))
  const live = (id: number) => alive.current && run.current === id
  const fast = () => turboRef.current || hurry.current
  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  /** what the last dart could make, if it is worth a moment: the highest step of 10× or more it still has a fair chance at */
  function moment(t: ReturnType<typeof throwing>, first: Region[]) {
    const sofar = sum(first)
    const r = reach(t, sofar, 1)
    const steps = stepsOf(t, 99)
    let best = -1
    for (const s of steps) if (s > sofar && t.pays[s] >= 10 && t.pays[s] > t.pays[sofar] * 3 && r[s] >= 0.03) best = s
    if (best < 0) return null
    const both = (r: Region) => first.every((x) => x === r)
    const text = both(60) ? '180 ON!' : both(59) ? '171 ON!' : both(62) ? 'THREE BULLS ON!' : `NEEDS ${best - sofar}`
    return { text, sub: `for ${multText(t.pays[best])} · ${chanceText(r[best])} chance`, big: t.pays[best] >= 25 }
  }

  /** a dart goes in: the thud, its bed flashing, its call and the running total */
  function land(id: number, i: number, r: Region, x: number, y: number) {
    const key = `${id}-${i}`
    setScene((s) => (s && s.id === id ? { ...s, regions: [...s.regions, r], flying: null } : s))
    setHits((h) => [...h, { key, r, x, y }])
    later(950, () => setHits((h) => h.filter((v) => v.key !== key)))
    const kind: Kind = kindOf(r)
    dartsSfx.thud(kind)
    later(fast() ? 60 : 150, () => dartsSfx.call(i))
    const hard = kind === 'treble' || kind === 'bull' || kind === 'double' ? 1 : 0.5
    void quake.start({ x: [0, 2.2 * hard, -1.6 * hard, 0.8 * hard, 0], y: [0, -2.6 * hard, 1.4 * hard, -0.6 * hard, 0], transition: { duration: 0.32 } })
    setSay(`Dart ${i + 1}: ${spoken(r)}, ${regionScore(r)}.`)
  }

  /** one round, start to finish: resolves with what it won less the stake, or null if it could not be thrown */
  async function throwRound(): Promise<number | null> {
    if (phaseRef.current === 'throw') return null
    const amount = betRef.current
    const { target: tg, thrower: th } = pick.current
    if (!stake(amount)) return null
    const id = ++run.current
    clearTimers()
    hurry.current = false

    // the round is decided, settled and stored before anything moves, so leaving mid-round can't change or lose it
    let round = drawRound(tg, th, rand)
    if (import.meta.env.DEV) round = forced(tg, th, round)
    const pay = payout(amount, round)
    const t = Date.now()
    const past: PastRound = {
      t,
      target: tg,
      thrower: th,
      darts: round.darts.map((d) => ({ r: d.region, x: round2(d.x), y: round2(d.y) })),
      total: round.total,
      mult: round.mult,
      bet: amount,
      payout: pay,
    }
    const p: PendingRound = { bet: amount, payout: pay, meta: metaOf(past), past, t, at: t }
    const key = pendingKey(uid)
    pending.current = { key, round: p }
    savePending(key, p)
    paidOnHide.current = false
    play.current = { id, past, logged: false }

    setPhase('throw')
    setShow(null)
    setRibbon(null)
    setGlow('idle')
    setZoom(false)
    // the last round's darts come out first
    if (shownRef.current.length) {
      dartsSfx.pluck()
      setShown(() => [])
      await wait(fast() ? 130 : 300)
      if (!live(id)) return null
    }
    setScene({ id, target: tg, thrower: th, regions: [], flying: null, done: false, mult: round.mult, payout: pay })
    const tbl = throwing(tg, th)
    for (let i = 0; i < DARTS; i++) {
      const d = round.darts[i]
      let slow = false
      if (i === DARTS - 1) {
        const m = moment(tbl, round.darts.slice(0, i).map((x) => x.region))
        if (m) {
          setRibbon({ text: m.text, sub: m.sub })
          setSay(`${m.text.toLowerCase()} ${m.sub}`)
          dartsSfx.tension()
          if (!fast()) {
            setZoom(true)
            slow = m.big
          }
          await wait(fast() ? 500 : 1100)
          if (!live(id)) return null
        }
      }
      const g = geo.current
      const ms = slow && !fast() ? 1000 : fast() ? 230 : 440
      const flight: Flight = { fromX: (g.wide ? 0.3 : 0.26) * g.col.w + i * 14, fromY: g.h - g.cy - 10, ms }
      setScene((s) => (s && s.id === id ? { ...s, flying: i } : s))
      dartsSfx.whoosh(slow)
      setShown((list) => [...list, { key: `${id}-${i}`, r: d.region, x: d.x, y: d.y, thrower: th, flight, tilt: tiltOf(i, d.x, d.y) }])
      await wait(ms)
      if (!live(id)) return null
      land(id, i, d.region, d.x, d.y)
      if (i === DARTS - 1) setRibbon(null)
      await wait(i === DARTS - 1 ? (fast() ? 180 : 420) : fast() ? 170 : 520)
      if (!live(id)) return null
    }
    const hold = finish(id)
    await wait(hold)
    if (live(id) && phaseRef.current === 'result') {
      setShow(null)
      setZoom(false)
      setPhase('idle')
    }
    return round2(pay - amount)
  }

  /** the round is in: pay it, light the ring, the caller's line and the win. Returns how long the result holds (ms). */
  function finish(id: number): number {
    const r = play.current
    if (!r || r.id !== id) return 0
    settlePending()
    // a round paid as the page began to leave, on a page that stayed: the player sees it now, no notice needed
    if (paidOnHide.current) clearNotice()
    if (!r.logged) {
      r.logged = true
      logRound(r.past)
    }
    const { past } = r
    const m = past.mult
    const call: Callout | null = calloutOf(past.darts.map((d) => d.r))
    const tier = tierOf(m)
    setPhase('result')
    setScene((s) => (s && s.id === id ? { ...s, done: true, flying: null } : s))
    setGlow(call?.size === 'max' ? 'max' : tier ? 'big' : m >= 1 ? 'win' : m > 0 ? 'idle' : 'lose')
    if (call && call.roar >= 0) dartsSfx.roar(call.roar)
    if (m >= 1) later(call?.size === 'max' ? 500 : 120, () => dartsSfx.win(m))
    else if (m > 0) dartsSfx.some()
    else dartsSfx.lose()
    if (tier || call?.size === 'max') setShow({ kind: 'celebrate', id, headline: call && call.size !== 'small' ? call.text : TIER_NAME[Math.max(1, tier)], tier: Math.max(1, tier), amount: past.payout, mult: m })
    else if (m > 0) setShow({ kind: 'plate', id, amount: past.payout, mult: m, line: call ? call.text : null })
    else if (call) setShow({ kind: 'line', id, line: call.text })
    const words = m >= 1 ? `You won ${coins(past.payout)}, ${multText(m)} your bet.` : m > 0 ? `${coins(past.payout)} back.` : `Under par: no pay.`
    setSay(`Total ${past.total}. ${call ? call.text + ' ' : ''}${words}`)
    const T = fast()
    if (tier || call?.size === 'max') return 600 + TIER_COUNT[Math.max(1, tier)] + 1700
    if (m >= 1) return T ? 1100 : 2100
    return T ? 450 : 1000
  }

  const auto = useAutoBet(throwRound, turbo ? 200 : 500)
  const autoRef = useRef(auto.running)
  autoRef.current = auto.running

  /** the main button and the keys: throw, or hurry the round in the air */
  function press() {
    if (phaseRef.current === 'throw') {
      hurry.current = true
      return
    }
    if (autoRef.current) return
    if (useWallet.getState().balance < betRef.current) {
      useWallet.getState().pushToast({ kind: 'info', title: NO_COINS })
      return
    }
    void throwRound()
  }
  function startAuto() {
    if (useWallet.getState().balance < betRef.current) {
      useWallet.getState().pushToast({ kind: 'info', title: NO_COINS })
      return
    }
    void auto.start()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space' || (e.key === 'Enter' && tag !== 'BUTTON')) {
        e.preventDefault()
        if (e.repeat) return
        if (mode === 'manual') press()
        else if (phaseRef.current === 'throw') hurry.current = true
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const choose = {
    target: (v: TargetId) => {
      if (phaseRef.current === 'throw' || v === pick.current.target) return
      dartsSfx.pick()
      setTargetState(v)
      saveTarget(v)
      if (phaseRef.current === 'result') endResult()
    },
    thrower: (v: ThrowerId) => {
      if (phaseRef.current === 'throw' || v === pick.current.thrower) return
      dartsSfx.pick()
      setThrowerState(v)
      saveThrower(v)
      if (phaseRef.current === 'result') endResult()
    },
  }
  function endResult() {
    setShow(null)
    setZoom(false)
    setPhase('idle')
  }

  /* ---------------- what the screen reads ---------------- */

  const throwing_ = phase === 'throw'
  const inPlay = phase !== 'idle' && !!scene && scene.id === run.current
  // the ladder follows the round in play; at rest it shows the next round's chances
  const ladderT = inPlay ? throwing(scene!.target, scene!.thrower) : table
  const steps = useMemo(() => stepsOf(ladderT, L.wide ? 9 : 6), [ladderT, L.wide])
  const sofar = inPlay ? sum(scene!.regions) : 0
  const left = inPlay ? DARTS - scene!.regions.length : DARTS
  const reachNow = useMemo(() => (inPlay ? reach(ladderT, sofar, left) : reachAtStart(ladderT)), [inPlay, ladderT, sofar, left])
  const be = breakEven(table)

  let line: ReactNode
  let verdict: { text: string; tone: 'win' | 'gold' | 'part' | 'none' } | null = null
  if (inPlay && scene) {
    const t = ladderT
    if (scene.done || left === 0) {
      const m = scene.mult
      line =
        m >= 1 ? (
          <span>
            Paid <b className="text-ink">{fmt(scene.payout)}</b> · {multText(m)} your bet
          </span>
        ) : m > 0 ? (
          <span>
            {fmt(scene.payout)} back · {multText(m)} · stake back from {breakEven(t)}
          </span>
        ) : (
          <span>Under par ({t.par}): no pay</span>
        )
      verdict = { text: m > 0 ? `pays ${multText(m)}` : 'no pay', tone: m >= 10 ? 'gold' : m >= 1 ? 'win' : m > 0 ? 'part' : 'none' }
    } else if (scene.regions.length === 0) {
      line = (
        <span>
          Par {t.par} · pays {chanceText(t.tail[t.par])} of rounds
        </span>
      )
      verdict = { text: `par ${t.par}`, tone: 'none' }
    } else {
      const need = t.par - sofar
      const darts = `${left} dart${left > 1 ? 's' : ''}`
      if (need > 60 * left) line = <span>Needs {need} in {darts}: par is out of reach</span>
      else if (need > 0)
        line = (
          <span>
            Needs <b className="text-ink">{need}</b> in {darts} for par · <b className="text-ink">{chanceText(reachNow[t.par])}</b>
          </span>
        )
      else {
        const next = steps.find((s) => s > sofar && reachNow[s] > 0)
        line = (
          <span>
            <b className="text-accent">{multText(t.pays[sofar])}</b> locked in
            {next != null && (
              <>
                {' '}
                · {next - sofar} more for {multText(t.pays[next])} ({chanceText(reachNow[next])})
              </>
            )}
          </span>
        )
      }
      verdict = { text: `par ${t.par}`, tone: 'none' }
    }
  } else {
    line = (
      <span>
        Par {table.par} pays {chanceText(table.tail[table.par])} of rounds · stake back from {be} ({chanceText(table.tail[be])})
      </span>
    )
  }

  const narrow = !L.wide
  const scoreDarts = scene ? scene.regions : []
  const scoreTotal = scene ? sum(scene.regions) : 0
  const dimLast = !inPlay && !!scene

  /* ---------------- panel ---------------- */

  const locked = throwing_ || auto.running
  const broke = balance < bet
  const tTop = topStep(table)
  const thrInfo = THROWERS.find((x) => x.id === thrower)!

  let action: ReactNode
  if (mode === 'auto') {
    action = auto.running ? (
      <ActionButton tone="danger" onClick={auto.stop} sub={auto.left != null ? `${auto.left} left` : 'until stopped'}>
        Stop autobet
      </ActionButton>
    ) : (
      <ActionButton onClick={startAuto} disabled={broke} sub={broke ? 'Not enough coins for this bet' : `${TARGETS.find((x) => x.id === target)!.short} · ${thrInfo.name} · up to ${multText(table.pays[tTop])}`}>
        Start autobet
      </ActionButton>
    )
  } else if (throwing_) {
    action = (
      <ActionButton tone="neutral" onClick={press} sub={touch ? 'Tap to hurry' : 'Space to hurry'}>
        Throwing…
      </ActionButton>
    )
  } else {
    action = broke ? (
      <ActionButton disabled sub="Lower your bet, or visit Rewards">
        Not enough coins
      </ActionButton>
    ) : (
      <ActionButton onClick={press} sub={`${TARGETS.find((x) => x.id === target)!.short} · ${thrInfo.name} · up to ${multText(table.pays[tTop])}`}>
        Throw
      </ActionButton>
    )
  }

  const historyItems = [...hist]
    .reverse()
    .slice(0, 14)
    .map((r) => ({
      key: r.t,
      tone: (r.mult >= 10 ? 'gold' : r.mult >= 1 ? 'win' : 'loss') as PillTone,
      style: r.mult > 0 && r.mult < 1 ? { background: '#2b475c', color: '#cfe0ee' } : r.mult === 0 ? { background: '#2a1620', color: '#ff9aa8' } : undefined,
      label: (
        <span>
          {r.total}
          {r.mult > 0 && <span className="ml-1 opacity-70">{multText(r.mult)}</span>}
        </span>
      ),
    }))

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <div className="max-lg:order-[-1]">
        <BetInput value={bet} onChange={setBet} disabled={locked} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Target</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works · paytable
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Target">
          {TARGETS.map((x) => {
            const on = x.id === target
            const tt = throwing(x.id, thrower)
            return (
              <button
                key={x.id}
                role="radio"
                aria-checked={on}
                aria-label={`${x.name}: up to ${multText(tt.pays[topStep(tt)])}`}
                disabled={locked}
                onClick={() => choose.target(x.id)}
                className={`flex flex-col items-center gap-1 rounded-xl px-1 pb-2 pt-2.5 transition disabled:cursor-not-allowed ${on ? 'bg-raised ring-2 ring-accent' : 'bg-stage ring-1 ring-white/[.04] hover:bg-panel'} ${locked && !on ? 'opacity-45' : ''}`}
              >
                <MiniBoard target={x.id} size={44} lit={on} />
                <span className={`text-[13px] font-extrabold leading-tight ${on ? 'text-ink' : 'text-muted'}`}>{x.name}</span>
                <span className={`tnum text-[11px] font-bold leading-none ${on ? 'text-gold' : 'text-dim'}`}>to {multText(tt.pays[topStep(tt)])}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <Label right={`${thrInfo.sigma} mm spread`}>Thrower</Label>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Thrower">
          {THROWERS.map((x) => {
            const on = x.id === thrower
            return (
              <button
                key={x.id}
                role="radio"
                aria-checked={on}
                aria-label={`${x.name}: ${x.line}`}
                disabled={locked}
                onClick={() => choose.thrower(x.id)}
                className={`flex flex-col items-center gap-1 rounded-xl px-1 pb-2 pt-2.5 transition disabled:cursor-not-allowed ${on ? 'bg-raised ring-2 ring-accent' : 'bg-stage ring-1 ring-white/[.04] hover:bg-panel'} ${locked && !on ? 'opacity-45' : ''}`}
              >
                <Grouping sigma={x.sigma} size={40} color={FLIGHTS[x.id].a} />
                <span className={`text-[13px] font-extrabold leading-tight ${on ? 'text-ink' : 'text-muted'}`}>{x.name}</span>
                <span className="tnum text-[11px] font-bold leading-none text-dim">par {throwing(target, x.id).par}</span>
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-[11.5px] font-semibold text-dim">{thrInfo.line}.</p>
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-bold">Turbo</div>
          <div className="text-[11px] text-dim">Quicker darts, no slow motion</div>
        </div>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        {[
          ['Pays from', String(table.par)],
          ['Wins 1×+', chanceText(table.tail[be])],
          ['Return', `${(table.rtp * 100).toFixed(2)}%`],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-stage px-1 py-1.5">
            <div className="text-[10.5px] font-semibold text-dim">{k}</div>
            <div className="tnum text-[13.5px] font-extrabold">{v}</div>
          </div>
        ))}
      </div>
      {narrow && historyItems.length > 0 && (
        <div>
          <Label>Recent rounds</Label>
          <HistoryPills items={historyItems} className="flex-wrap" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-lg:order-[-3] lg:sticky lg:bottom-0 lg:z-10 lg:order-last lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">{action}</div>
      {mode === 'manual' && <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Space or Enter throws (and hurries the darts in the air).</p>}
    </>
  )

  /* ---------------- stage ---------------- */

  const k = L.k
  const aim = aimOf(scene && inPlay ? scene.target : target)
  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[#070d13]">
      {/* the wall: dark panelling under the lamp */}
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse 75% 65% at ${L.cx}px ${L.cy}px, #22303c 0%, #111c26 45%, #070d13 100%)` }} />
      <div className="pointer-events-none absolute inset-0 opacity-[.35] [background:repeating-linear-gradient(90deg,transparent_0,transparent_78px,rgba(0,0,0,.35)_78px,rgba(0,0,0,.35)_80px,rgba(255,255,255,.025)_80px,rgba(255,255,255,.025)_82px)]" />
      <div className="pointer-events-none absolute top-0 h-full -translate-x-1/2 bg-[linear-gradient(180deg,rgba(255,244,214,.10),rgba(255,244,214,0)_70%)] [clip-path:polygon(38%_0,62%_0,100%_100%,0_100%)]" style={{ left: L.cx, width: 2 * 300 * k }} />

      {/* the board, its darts and what happens on it */}
      <motion.div className="absolute" style={{ left: L.cx, top: L.cy, width: 0, height: 0, originX: 0, originY: 0 }} animate={{ scale: zoom ? 1.07 : 1, x: zoom ? -aim.x * k * 0.07 : 0, y: zoom ? aim.y * k * 0.07 : 0 }} transition={{ type: 'spring', stiffness: 70, damping: 18 }}>
        <motion.div className="absolute left-0 top-0" animate={quake}>
          <Backdrop k={k} glow={glow} />
          <BoardFace k={k} />
          <AimLayer k={k} target={inPlay && scene ? scene.target : target} sigma={THROWERS.find((x) => x.id === (inPlay && scene ? scene.thrower : thrower))!.sigma} dim={phase !== 'idle'} />
          <HitLayer k={k} hits={hits} />
          <AnimatePresence>
            {shown.map((d) => (
              <DartSprite key={d.key} k={k} x={d.x} y={d.y} thrower={d.thrower} flight={d.flight} tilt={d.tilt} />
            ))}
          </AnimatePresence>
        </motion.div>
      </motion.div>

      {/* the recent rounds (a phone has them in the panel) */}
      {L.wide && historyItems.length > 0 && (
        <div className="absolute left-4 top-4 z-10" style={{ width: L.col.w }}>
          <HistoryPills items={historyItems} />
        </div>
      )}
      {L.wide && (
        <button
          onClick={() => (sfx.click(), setInfo(true))}
          aria-label="How Bullseye works and its paytable"
          className="absolute z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-[14px] font-black text-white/70 ring-1 ring-white/10 transition hover:bg-black/60 hover:text-white"
          style={{ left: L.col.x + L.col.w - 32, top: 16 }}
        >
          ?
        </button>
      )}

      {/* the paytable ladder */}
      <div className={`absolute z-10 ${L.wide ? 'flex flex-col justify-center' : ''}`} style={{ left: L.ladder.x, top: L.ladder.y, width: L.ladder.w, height: L.ladder.h }}>
        {L.wide ? (
          <Ladder t={ladderT} steps={steps} reach={reachNow} total={sofar} done={!!scene?.done && inPlay} height={L.ladder.h} title={`${TARGETS.find((x) => x.id === ladderT.target)!.name} · ${THROWERS.find((x) => x.id === ladderT.thrower)!.name}`} />
        ) : (
          <LadderStrip t={ladderT} steps={steps} reach={reachNow} total={sofar} done={!!scene?.done && inPlay} />
        )}
      </div>

      {/* the scoreboard */}
      <div className={`absolute z-10 transition-opacity duration-300 ${dimLast ? 'opacity-80' : ''}`} style={{ left: L.score.x, bottom: L.score.bottom, width: L.score.w }}>
        <Scoreboard darts={scoreDarts} flying={scene && inPlay ? scene.flying : null} total={scoreTotal} line={line} verdict={dimLast ? null : verdict} compact={narrow} />
      </div>

      {/* the moment before the last dart */}
      <div className="pointer-events-none absolute z-20 flex -translate-y-1/2 justify-center" style={{ left: L.col.x, width: L.col.w, top: L.cy + (aim.y > 20 ? 1 : -1) * 214 * k }}>
        <AnimatePresence>{ribbon && <Ribbon key={ribbon.text} text={ribbon.text} sub={ribbon.sub} narrow={narrow} />}</AnimatePresence>
      </div>

      {/* a win (or part of the stake back) under the board, the caller's line */}
      <div className="pointer-events-none absolute z-20 flex justify-center" style={{ left: L.col.x, width: L.col.w, top: L.cy + 108 * k }}>
        <AnimatePresence>
          {show?.kind === 'plate' && <WinPlate key={show.id} amount={show.amount} mult={show.mult} line={show.line} narrow={narrow} />}
          {show?.kind === 'line' && (
            <motion.div key={show.id} initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="rounded-full bg-black/70 px-3.5 py-1 text-[13px] font-black tracking-[0.1em] text-gold ring-1 ring-gold/30">
              {show.line}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* a big win takes the stage */}
      <AnimatePresence>{show?.kind === 'celebrate' && <Celebration key={show.id} headline={show.headline} tier={show.tier} amount={show.amount} mult={show.mult} narrow={narrow} top={L.cy + (aim.y > 20 ? 128 : -150) * k} left={L.cx} onDone={() => setShow(null)} />}</AnimatePresence>

      {/* the first visit: what to do */}
      <AnimatePresence>
        {hist.length === 0 && phase === 'idle' && !auto.running && (
          <motion.div
            key="hint"
            className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/65 px-3.5 py-1.5 text-[12px] font-bold text-white ring-1 ring-white/10 backdrop-blur-sm sm:text-[13px]"
            style={{ left: L.cx, top: L.wide ? 16 : L.cy + 214 * k - 14 }}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {touch ? 'Pick a target and a thrower, then Throw' : 'Pick a target and a thrower, then Throw (Space)'}
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
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(calc(100vw+150px),560px)]" />
      <AnimatePresence>{info && <InfoModal target={target} thrower={thrower} onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}

