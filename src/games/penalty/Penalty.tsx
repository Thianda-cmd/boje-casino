import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Segmented, sleep, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { CHALLENGE_MIN_BET, useWallet } from '../../store/wallet'
import { LEVELS, MAX_SHOTS, ZONE_NAMES, chanceLabel, details, drawShot, isDifficulty, isTop, ladder, levelOf, multiplier, payoutFor, scoreChance, waysLabel, zoneCol, zoneDist, type Difficulty, type Shot, type Zone } from './rules'
import type { PenaltyScene, Speed, Stakes, ZoneRect } from './scene'

/*
  Penalty Shootout: pay the bet and take up to ten penalties against a keeper who covers 1 to 4 of the goal's six
  zones (the difficulty). One tap on a zone shoots there (the big button shoots at the zone last aimed at); every shot
  is drawn the moment it is struck (rules.ts) and the 3D scene acts it out. After a goal they cash out or shoot again;
  a save ends the run with nothing.
  Money moves only on an explicit start: a tap that only hurries the show along never starts a run, and taps that come
  in a burst never line a shot up. The run's value is kept as a pending payout from the moment a shot is drawn (in
  memory and in localStorage), so it settles exactly once: on a cash-out, when a save shows, after a Perfect 10's
  celebration, or straight away if the page is left mid-run (an unfinished run is cashed out at what it is worth, and
  says so). A run whose page died without paying is paid on the next visit.
*/

type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.penalty.pending.${uid ?? 'guest'}`
const NOTICE_KEY = 'lumen.penalty.notice'
const DIFF_KEY = 'lumen.penalty.diff'
const ZONE_KEY = 'lumen.penalty.zone'
const SPEED_KEY = 'lumen.penalty.speed'
const OLD_TURBO_KEY = 'lumen.penalty.turbo'
const AUTO_KEY = 'lumen.penalty.auto'
const HINT_KEY = 'lumen.penalty.hint'

/** how long a finished run's result holds the button before "Take the penalty" comes back (ms) */
const RESULT_HOLD = 1200
/** a goal must have been on screen this long before a press lines the next shot up (ms) */
const QUEUE_AFTER = 400
/** presses closer together than this are a burst: they only hurry (ms) */
const BURST = 380

interface Run {
  id: number
  bet: number
  diff: Difficulty
  goals: number
  /** each shot's outcome, in order */
  shots: boolean[]
  over: boolean
  cashed: boolean
}
interface Past {
  id: number
  goals: number
  mult: number
  cashed: boolean
}
type Phase = 'idle' | 'flight' | 'after'
type Headline =
  | { id: number; kind: 'goal'; goals: number; mult: number; amount: number }
  | { id: number; kind: 'saved'; keeper: string; how: string }
  | { id: number; kind: 'cash'; mult: number; amount: number; tier: number }
  | { id: number; kind: 'perfect'; mult: number; amount: number; tier: number }
  | { id: number; kind: 'banner'; text: string; sub: string }
type Caption = { id: number; text: string; tone: 'gold' | 'white' | 'info' }
type Pattern = 'random' | 'same' | 'sweep' | 'corners'

const SWEEP: Zone[] = [0, 1, 2, 5, 4, 3]
const CORNERS: Zone[] = [0, 5, 2, 3]
/** the keepers' colours, for the difficulty picker */
const ACCENT: Record<Difficulty, string> = { easy: '#9ee34f', medium: '#ff9f1c', hard: '#a580ff', expert: '#ffcf3a' }
const pickOne = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]
const MOMENT: Record<string, string[]> = {
  close: ['Fingertips!', 'Just past him!', 'By a whisker!', 'Inches!'],
  post: ['Off the post... and in!', 'Post and in!'],
  bar: ['In off the bar!', 'Crossbar... and in!'],
  chip: ['A cheeky chip!', 'Chipped down the middle!'],
}
const SAVE_HOW: Record<string, (k: string) => string> = {
  catch: (k) => `Held by ${k}`,
  parry: (k) => `Pushed away by ${k}`,
  tip: (k) => `Tipped over by ${k}`,
}
const goalTitle = (n: number) => (n >= 7 ? 'UNSTOPPABLE!' : n >= 4 ? 'GOAL!!' : 'GOAL!')
/** win tiers by multiplier: 1 at 10×, 2 at 100×, 3 at 1,000× */
const tierOf = (m: number) => (m >= 1000 ? 3 : m >= 100 ? 2 : m >= 10 ? 1 : 0)
const TIER_NAME = ['', 'BIG WIN', 'HUGE WIN', 'LEGENDARY']
/** one rule for every multiplier on the ladder: two decimals, thousands as K */
const short = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)}K×` : `${m.toFixed(2)}×`)
/** an amount, shortened past a million (1.91M, 3.04B) */
const money = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : fmt(n))
const pct = (p: number) => `${(p * 100).toFixed((p * 100) % 1 ? 2 : 0)}%`
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches

// dev only: window.__penaltyForce = 'goal' | 'save' | 'close' | 'wide' | 'post' | 'bar' | 'chip' | 'catch' | 'parry' | 'tip'
function forced(shot: Shot, d: Difficulty): Shot {
  const f = (window as unknown as { __penaltyForce?: string }).__penaltyForce
  if (!f) return shot
  const goal = ['goal', 'close', 'wide', 'post', 'bar', 'chip'].includes(f)
  const fits = (s: Shot) =>
    f === 'close' ? s.close : f === 'wide' ? !s.close && zoneDist(s.dive, s.zone) > 1 : f === 'chip' ? zoneCol(s.dive) !== 1 : f === 'post' ? zoneCol(s.zone) !== 1 : f === 'bar' ? isTop(s.zone) : true
  let s: Shot = { ...shot, goal, ...details(d, goal, shot.zone, rand) }
  for (let i = 0; i < 300 && !fits(s); i++) s = { ...shot, goal, ...details(d, goal, shot.zone, rand) }
  if (f === 'post' || f === 'bar') s.finish = fits(s) ? f : 'clean'
  if (f === 'chip') s.flavour = 0.2
  if (f === 'catch' || f === 'parry' || f === 'tip') s.save = f
  return s
}

const readSpeed = (): Speed => {
  const s = Number(safeStorage.getItem(SPEED_KEY))
  if (s === 1 || s === 2) return s
  if (safeStorage.getItem(SPEED_KEY) == null && safeStorage.getItem(OLD_TURBO_KEY) === '1') return 1
  return 0
}

export default function Penalty() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const perfectFive = useWallet((s) => s.challenges['penalty-perfect'])
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [diff, setDiff] = useState<Difficulty>(() => {
    const d = safeStorage.getItem(DIFF_KEY)
    return isDifficulty(d) ? d : 'medium'
  })
  const [zone, setZone] = useState<Zone>(() => {
    const z = Number(safeStorage.getItem(ZONE_KEY))
    return (Number.isInteger(z) && z >= 0 && z < 6 ? z : 2) as Zone
  })
  const [speed, setSpeed] = useState<Speed>(readSpeed)
  const [auto0] = useState(() => {
    try {
      const a = JSON.parse(safeStorage.getItem(AUTO_KEY) ?? '{}') as { target?: number; pattern?: Pattern }
      return { target: Math.min(MAX_SHOTS, Math.max(1, Math.round(a.target ?? 2))), pattern: (['random', 'same', 'sweep', 'corners'] as Pattern[]).includes(a.pattern as Pattern) ? (a.pattern as Pattern) : 'random' }
    } catch {
      return { target: 2, pattern: 'random' as Pattern }
    }
  })
  const [target, setTarget] = useState(auto0.target)
  const [pattern, setPattern] = useState<Pattern>(auto0.pattern)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [run, setRun] = useState<Run | null>(null)
  const [past, setPast] = useState<Past[]>([])
  const [headline, setHeadline] = useState<Headline | null>(null)
  const [caption, setCaption] = useState<Caption | null>(null)
  const [rects, setRects] = useState<ZoneRect[] | null>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [info, setInfo] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [hint, setHint] = useState(() => safeStorage.getItem(HINT_KEY) !== '1')
  const [queued, setQueued] = useState<Zone | null>(null)
  const [away, setAway] = useState(false)
  const [replayOn, setReplayOn] = useState(false)
  const [portraits, setPortraits] = useState<Partial<Record<Difficulty, string>>>({})
  /** when the last run ended (a save or a cash-out), for the button's hold */
  const [endedAt, setEndedAt] = useState(0)
  const [, setTick] = useState(0)
  const [autoRunNo, setAutoRunNo] = useState(0)
  const [touch] = useState(isTouch)

  const hostRef = useRef<HTMLDivElement>(null)
  const ladderRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PenaltyScene | null>(null)
  const alive = useRef(true)
  const readyRef = useRef(false)
  const busyRef = useRef(false)
  const runRef = useRef<Run | null>(null)
  const pending = useRef<Pending | null>(null)
  /** a Perfect 10 waiting for its celebration to finish before it pays (so nothing covers the moment) */
  const holdPerfect = useRef(false)
  const seq = useRef(1)
  const shotToken = useRef(0)
  const queuedRef = useRef<Zone | null>(null)
  const autoRef = useRef(false)
  const autoStop = useRef(false)
  const headTimer = useRef(0)
  const capTimer = useRef(0)
  const resultAt = useRef(0)
  const endedRef = useRef(0)
  const lastPress = useRef(0)
  const queuedAt = useRef(0)
  const lastBroke = useRef(0)
  // the latest values, for callbacks that outlive a render
  const live = useRef({ bet, diff, zone, speed, target, pattern, uid, phase, mode })
  live.current = { bet, diff, zone, speed, target, pattern, uid, phase, mode }

  /** pays the run in play, once: on a cash-out, when a save shows, or as soon as the player leaves */
  const settlePending = () => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    holdPerfect.current = false
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'penalty', bet: p.bet, payout: p.payout, meta: p.meta })
    return p
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let on = true
    const host = hostRef.current!
    let sc: PenaltyScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ PenaltyScene }) => {
        if (!on) return
        setProgress(0.08)
        sc = new PenaltyScene(host, live.current.diff)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __penalty?: PenaltyScene }).__penalty = sc
        sc.setSpeed(live.current.speed)
        sc.aim(live.current.zone, true)
        sc.onProgress = (p) => alive.current && setProgress(0.08 + p * 0.92)
        sc.onZones = (r) => alive.current && setRects(r)
        sc.onRead = (shot) => {
          if (!alive.current) return
          const lv = levelOf(live.current.diff)
          const name = lv.keeper.split(' ').pop()!
          note(`${shot.read.length > 1 ? `${name} covered these ${shot.read.length}` : `${name} covered this one`} · ${shot.goal ? 'you found the gap' : 'you went where he was'}`, 'info', 2000)
        }
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
          setPortraits(sc.portraits)
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
      clearTimeout(capTimer.current)
      if (import.meta.env.DEV) {
        const w = window as unknown as { __penalty?: PenaltyScene }
        if (w.__penalty === sc) delete w.__penalty
      }
      sc?.dispose()
      sceneRef.current = null
      // leaving mid-run cashes it out at what it is worth (or pays the shot already in the air), and says so; so does
      // leaving during a Perfect 10's celebration, before it has paid
      const perfectHeld = holdPerfect.current
      const p = settlePending()
      if (p && p.payout > 0 && (runRef.current || perfectHeld))
        useWallet.getState().pushToast({ kind: 'win', title: perfectHeld ? 'Your Perfect 10 was paid as you left' : 'Your shootout was cashed out as you left', amount: p.payout })
    }
    // the scene lives as long as the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    sceneRef.current?.setSpeed(speed)
    safeStorage.setItem(SPEED_KEY, String(speed))
  }, [speed])
  useEffect(() => safeStorage.setItem(AUTO_KEY, JSON.stringify({ target, pattern })), [target, pattern])
  // the stand's drum follows the run
  useEffect(() => sceneRef.current?.setRun(run && !run.over ? run.goals : 0, !!run && !run.over), [run])
  // the button's hold after a run ends lifts on its own
  useEffect(() => {
    if (!endedAt) return
    const t = window.setTimeout(() => alive.current && setTick((n) => n + 1), RESULT_HOLD + 20)
    return () => clearTimeout(t)
  }, [endedAt])

  // Reloading, closing the tab or going to another site mid-run pays the run on the way out (not on a mere tab
  // switch: the header balance would give the result away). The next visit says it was cashed out. A page brought
  // back from the back-forward cache after that shows the run as over.
  useEffect(() => {
    const onHide = () => {
      const p = settlePending()
      if (p && p.payout > 0) safeStorage.setItem(NOTICE_KEY, JSON.stringify({ amount: p.payout }))
    }
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted || !runRef.current || pending.current) return
      // the run object itself, so a shot still playing out finishes it as over too
      runRef.current.over = true
      runRef.current = null
      queuedRef.current = null
      setQueued(null)
      setRun((r) => (r ? { ...r, over: true } : r))
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

  // a run whose page went away with no chance to pay it is paid on the next visit, into the wallet that staked it;
  // one that was paid on the way out is announced
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
    const n = safeStorage.getItem(NOTICE_KEY)
    if (n != null) {
      safeStorage.removeItem(NOTICE_KEY)
      try {
        const amount = Number(JSON.parse(n).amount)
        if (amount > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your last shootout was cashed out when you left', amount })
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
    useWallet.getState().settle({ game: 'penalty', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished shootout was cashed out', amount: p.payout })
  }, [authStatus, uid])

  /* ---------------- choosing ---------------- */

  const active = !!run && !run.over
  const choose = (z: Zone, quiet = false) => {
    setZone(z)
    sceneRef.current?.aim(z, quiet)
    sceneRef.current?.clearRead()
    safeStorage.setItem(ZONE_KEY, String(z))
  }
  const pickDiff = (d: Difficulty) => {
    if (runRef.current || busyRef.current || autoRef.current) return
    setDiff(d)
    sceneRef.current?.setDifficulty(d)
    safeStorage.setItem(DIFF_KEY, d)
  }

  /* ---------------- a shot ---------------- */

  const say = (h: Headline, ms: number) => {
    clearTimeout(headTimer.current)
    setHeadline(h)
    headTimer.current = window.setTimeout(() => alive.current && setHeadline((x) => (x?.id === h.id ? null : x)), ms)
  }
  const note = (text: string, tone: Caption['tone'], ms = 1300) => {
    clearTimeout(capTimer.current)
    const c = { id: seq.current++, text, tone }
    setCaption(c)
    capTimer.current = window.setTimeout(() => alive.current && setCaption((x) => (x?.id === c.id ? null : x)), ms)
  }
  const sp = () => [1, 0.7, 0.45][live.current.speed]

  const pushPast = (r: Run) => setPast((xs) => [{ id: r.id, goals: r.goals, mult: r.cashed ? multiplier(r.diff, r.goals) : 0, cashed: r.cashed }, ...xs].slice(0, 16))
  const endRun = (r: Run) => {
    r.over = true
    runRef.current = null
    // the show may still be on, but the next run can start (after the result has had its moment)
    busyRef.current = false
    setRun({ ...r, shots: [...r.shots] })
    pushPast(r)
    queuedRef.current = null
    setQueued(null)
    endedRef.current = performance.now()
    setEndedAt(endedRef.current)
  }

  /** cashes the run out at what it is worth now */
  const cashOut = () => {
    const r = runRef.current
    if (!alive.current || !r || r.goals < 1 || live.current.phase === 'flight') return
    const mult = multiplier(r.diff, r.goals)
    const amount = payoutFor(r.bet, r.diff, r.goals)
    if (pending.current) pending.current.meta = { difficulty: r.diff, goals: r.goals, cashed: true }
    settlePending()
    r.cashed = true
    endRun(r)
    setCaption(null)
    const tier = tierOf(mult)
    say({ id: seq.current++, kind: 'cash', mult, amount, tier }, tier ? 3400 : 2400)
    sceneRef.current?.cashout(mult)
    sceneRef.current?.hurry()
    sfx.penalty.cashout(mult)
    if (tier) sfx.penalty.bigWin(tier)
  }

  /** ten from ten: it cashes out by itself, and pays once the celebration is over */
  const perfect = (r: Run) => {
    const mult = multiplier(r.diff, r.goals)
    const amount = payoutFor(r.bet, r.diff, r.goals)
    if (pending.current) pending.current.meta = { difficulty: r.diff, goals: r.goals, cashed: true }
    holdPerfect.current = true
    r.cashed = true
    endRun(r)
    setCaption(null)
    say({ id: seq.current++, kind: 'perfect', mult, amount, tier: Math.max(1, tierOf(mult)) }, 60000)
    sfx.penalty.perfect()
    sfx.penalty.bigWin(Math.max(1, tierOf(mult)))
  }
  const releasePerfect = () => {
    if (!holdPerfect.current) return
    settlePending()
    setHeadline((h) => (h?.kind === 'perfect' ? null : h))
  }

  /** a press that would start a run: refused (with one toast, not a stack of them) when the bet can't be covered */
  const canAfford = (unit: number) => {
    if (useWallet.getState().balance >= unit) return true
    const now = performance.now()
    if (now - lastBroke.current > 3500) {
      lastBroke.current = now
      useWallet.getState().pushToast({ kind: 'info', title: 'Not enough coins for this bet. Lower it, or visit Rewards.' })
    }
    return false
  }

  /** takes one penalty, starting (and staking) a run if none is on; resolves when the players are back in place */
  const shootOnce = async (z: Zone): Promise<{ goal: boolean; run: Run } | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !readyRef.current) return null
    let r = runRef.current
    busyRef.current = true
    const token = ++shotToken.current
    if (!r) {
      const unit = live.current.bet
      if (!canAfford(unit)) {
        busyRef.current = false
        return null
      }
      // the last run's show is still on: dash through what is left of it
      if (sc.playing) await sc.rush()
      if (!alive.current || token !== shotToken.current) return null
      if (!stake(unit)) {
        busyRef.current = false
        return null
      }
      r = { id: seq.current++, bet: unit, diff: live.current.diff, goals: 0, shots: [], over: false, cashed: false }
      runRef.current = r
      setRun({ ...r, shots: [] })
    } else if (sc.playing) {
      await sc.rush()
      if (!alive.current || token !== shotToken.current) return null
    }
    setPhase('flight')
    live.current.phase = 'flight'
    setHeadline(null)
    setCaption(null)
    if (live.current.zone !== z) choose(z, true)
    if (hint) {
      setHint(false)
      safeStorage.setItem(HINT_KEY, '1')
    }
    let shot = drawShot(r.diff, z, rand)
    if (import.meta.env.DEV) shot = forced(shot, r.diff)
    const after = shot.goal ? r.goals + 1 : r.goals
    // what the run pays if it ends now, stored before the striker moves so even a page that dies can't lose it
    const payout = shot.goal ? payoutFor(r.bet, r.diff, after) : 0
    const meta = { difficulty: r.diff, goals: after, cashed: shot.goal }
    const key = pendingKey(live.current.uid)
    pending.current = { bet: r.bet, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: r.bet, payout, meta }))
    const theRun = r
    const n = r.goals + 1
    const stakes: Stakes = {
      shot: n,
      tension: r.goals >= 3 ? Math.min(1, (r.goals - 2) / 6) : 0,
      board: n === MAX_SHOTS ? 'FOR THE PERFECT 10' : r.goals >= 3 ? `SHOT ${n} · ${short(multiplier(r.diff, n))}` : undefined,
      last: n === MAX_SHOTS,
    }
    if (n === MAX_SHOTS && live.current.speed < 2) say({ id: seq.current++, kind: 'banner', text: 'FOR THE PERFECT 10', sub: `${short(multiplier(r.diff, MAX_SHOTS))} · ${fmt(payoutFor(r.bet, r.diff, MAX_SHOTS))}` }, 1900)
    let shown = false
    const result = () => {
      if (shown) return
      shown = true
      theRun.shots.push(shot.goal)
      theRun.goals = after
      if (!alive.current) return
      setPhase('after')
      live.current.phase = 'after'
      resultAt.current = performance.now()
      if (!shot.goal) {
        // the run is over: it pays nothing
        settlePending()
        endRun(theRun)
        const k = levelOf(theRun.diff).keeper
        say({ id: seq.current++, kind: 'saved', keeper: k, how: SAVE_HOW[shot.save](k) }, 2300 * sp())
        return
      }
      setRun({ ...theRun, shots: [...theRun.shots] })
      if (after >= MAX_SHOTS) perfect(theRun)
      else say({ id: seq.current++, kind: 'goal', goals: after, mult: multiplier(theRun.diff, after), amount: payoutFor(theRun.bet, theRun.diff, after) }, 2000 * sp())
    }
    try {
      await sc.shoot(shot, after, {
        result,
        moment: (m) => {
          if (!alive.current || !MOMENT[m]) return
          note(pickOne(MOMENT[m]), 'gold', m === 'close' ? 1500 : 1200)
          if (m === 'close') sfx.penalty.ooh()
        },
        replay: (on) => alive.current && setReplayOn(on),
        away: (on) => {
          if (!alive.current) return
          setAway(on)
          // the Perfect 10's party is over: now it pays
          if (!on && holdPerfect.current && theRun.goals >= MAX_SHOTS) releasePerfect()
        },
      }, stakes)
    } catch {
      // never expected: a scene error must not lock the game
      result()
    }
    result()
    if (holdPerfect.current && theRun.goals >= MAX_SHOTS) releasePerfect()
    if (!alive.current || token !== shotToken.current) return { goal: shot.goal, run: theRun }
    busyRef.current = false
    setPhase('idle')
    live.current.phase = 'idle'
    setAway(false)
    setReplayOn(false)
    const q = queuedRef.current
    if (q != null && !autoRef.current && runRef.current === theRun) {
      queuedRef.current = null
      setQueued(null)
      void shootOnce(q)
    }
    return { goal: shot.goal, run: theRun }
  }

  /**
   * The big button, Space, and a tap on a zone (with its zone). Whatever is on screen, a press only ever does one of:
   * shoot (the scene is ready), line the next shot up (a goal has shown for a moment and the run goes on), start a new
   * run (the last one ended a while ago and this isn't a burst of taps), or hurry the show along.
   */
  const press = (z: Zone = live.current.zone) => {
    if (!readyRef.current || autoRef.current) return
    const sc = sceneRef.current
    const now = performance.now()
    const burst = now - lastPress.current < BURST
    lastPress.current = now
    const r = runRef.current
    if (burst) {
      // taps in quick succession are someone hurrying the show along: they never shoot, line up or start anything,
      // and a shot lined up by the first tap of the burst is taken back
      if (queuedRef.current != null && now - queuedAt.current < BURST * 1.6) {
        queuedRef.current = null
        setQueued(null)
      }
      sc?.hurry()
      return
    }
    if (r && live.current.phase !== 'idle') {
      // a run is on and a shot is playing out
      if (live.current.phase === 'after' && now - resultAt.current >= QUEUE_AFTER) {
        if (queuedRef.current != null && z === queuedRef.current) {
          queuedRef.current = null
          setQueued(null)
          sfx.click()
        } else {
          queuedRef.current = z
          queuedAt.current = now
          setQueued(z)
          if (z !== live.current.zone) choose(z, true)
          sfx.penalty.aim()
        }
      }
      sc?.hurry()
      return
    }
    if (!r && now - endedRef.current < RESULT_HOLD) {
      // a run has just ended (a save, a cash-out, even one taken between shots with the scene at rest): its result
      // holds the button for a moment, and a press then only hurries what is left of the show
      sc?.hurry()
      return
    }
    if (!r && sc?.playing) {
      // the last run is over and its show is still on: a deliberate press after the hold starts the next one
      void shootOnce(z)
      return
    }
    if (busyRef.current) {
      sc?.hurry()
      return
    }
    void shootOnce(z)
  }

  const tapZone = (z: Zone) => {
    if (autoRef.current || !readyRef.current) return
    // on the Auto tab, with no run on, a tap only picks the zone (the "Aimed" pattern shoots there)
    if (live.current.mode === 'auto' && !runRef.current) return choose(z)
    if (z !== live.current.zone && live.current.phase !== 'flight') choose(z, true)
    press(z)
  }

  /* ---------------- auto ---------------- */

  const autoZone = (i: number): Zone => {
    const p = live.current.pattern
    if (p === 'same') return live.current.zone
    if (p === 'sweep') return SWEEP[i % SWEEP.length]
    if (p === 'corners') return CORNERS[i % CORNERS.length]
    return Math.floor(Math.random() * 6) as Zone
  }

  /** one whole run: shoot until the target is reached (cash out) or the keeper saves */
  const autoRound = async (): Promise<number | null> => {
    setAutoRunNo((n) => n + 1)
    let i = 0
    // the next target lights up in the goal a moment before each shot
    const aimThen = async () => {
      const z = autoZone(i++)
      choose(z)
      await sleep([320, 200, 90][live.current.speed])
      return z
    }
    let out = await shootOnce(await aimThen())
    if (!out) return null
    const r = out.run
    while (out && out.goal && runRef.current === r && r.goals < live.current.target && !autoStop.current && alive.current) {
      out = await shootOnce(await aimThen())
    }
    // the page has gone: the run was paid as it went (see the scene effect), nothing more to do or say
    if (!alive.current) return null
    if (runRef.current === r && r.goals >= live.current.target) cashOut()
    // stopped mid-run: the player takes over from here
    if (runRef.current === r) {
      setMode('manual')
      note('Autobet stopped · cash out or shoot on', 'info', 2600)
      return 0
    }
    return r.cashed ? payoutFor(r.bet, r.diff, r.goals) - r.bet : -r.bet
  }
  const auto = useAutoBet(autoRound, [600, 300, 120][speed])
  autoRef.current = auto.running
  const startAuto = () => {
    if (!canAfford(bet)) return
    autoStop.current = false
    setAutoRunNo(0)
    void auto.start()
  }
  const stopAuto = () => {
    autoStop.current = true
    auto.stop()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const tag = el?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || sheet) return
      if (e.key >= '1' && e.key <= '6' && !autoRef.current) {
        choose((Number(e.key) - 1) as Zone)
        return
      }
      const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
      const mv = arrows[e.key]
      if (mv && !autoRef.current) {
        e.preventDefault()
        const z = live.current.zone
        const c = Math.max(0, Math.min(2, (z % 3) + mv[0]))
        const row = Math.max(0, Math.min(1, Math.floor(z / 3) + mv[1]))
        choose((row * 3 + c) as Zone)
        return
      }
      if (e.code === 'Space' || (e.key === 'Enter' && tag !== 'BUTTON')) {
        e.preventDefault()
        if (e.repeat) return
        if (autoRef.current) sceneRef.current?.hurry()
        else if (live.current.mode === 'manual' || runRef.current || busyRef.current) press()
        return
      }
      if ((e.key === 'c' || e.key === 'C') && !autoRef.current) cashOut()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the ladder keeps the next step in view
  const goals = run?.goals ?? 0
  useEffect(() => {
    const el = ladderRef.current
    if (!el) return
    const step = el.querySelector<HTMLElement>(`[data-step="${Math.min(MAX_SHOTS - 1, goals)}"]`)
    if (step) el.scrollTo({ left: step.offsetLeft - el.clientWidth / 2 + step.clientWidth / 2, behavior: 'smooth' })
  }, [goals, run?.id])

  /* ---------------- panel ---------------- */

  const runDiff = active ? run!.diff : diff
  const lv = levelOf(runDiff)
  const nowMult = active ? multiplier(runDiff, goals) : 0
  const nextMult = multiplier(runDiff, Math.min(MAX_SHOTS, goals + 1))
  const unit = active ? run!.bet : bet
  const locked = active || phase !== 'idle' || auto.running
  const canCash = active && goals > 0 && phase !== 'flight' && !auto.running
  const holding = !active && endedAt > 0 && performance.now() - endedAt < RESULT_HOLD
  const broke = !active && balance < bet
  const last = run && run.over ? run : null
  const challengeOpen = !perfectFive || (perfectFive.progress < 1 && !perfectFive.claimed)
  const fiveCounts = (runDiff === 'hard' || runDiff === 'expert') && challengeOpen

  let action: ReactNode
  if (auto.running) {
    action = (
      <ActionButton tone="danger" onClick={stopAuto} sub={`Run ${Math.max(1, autoRunNo)}${auto.cfg.count ? ` of ${auto.cfg.count}` : ''} · ${active ? goals : 0} of ${target} goal${target > 1 ? 's' : ''}`}>
        Stop autobet
      </ActionButton>
    )
  } else if (active && goals > 0) {
    action = (
      <div className="grid grid-cols-2 gap-2">
        <ActionButton tone="gold" className="min-h-[58px]" onClick={() => cashOut()} disabled={!canCash} sub={`${money(payoutFor(unit, runDiff, goals))} · ${short(nowMult)}`}>
          Cash out
        </ActionButton>
        <ActionButton
          tone={phase === 'flight' ? 'neutral' : 'accent'}
          className="min-h-[58px]"
          onClick={() => press()}
          sub={phase === 'flight' ? 'Tap to hurry' : queued != null ? `${ZONE_NAMES[queued]} · tap to cancel` : `next ${short(nextMult)}`}
        >
          {phase === 'flight' ? 'Shooting…' : queued != null ? 'Lined up ✓' : 'Shoot'}
        </ActionButton>
      </div>
    )
  } else if (active) {
    action = (
      <ActionButton tone="neutral" className="min-h-[58px]" onClick={() => press()} sub="Tap to hurry">
        Shooting…
      </ActionButton>
    )
  } else if (holding && last) {
    action = (
      <ActionButton tone={last.cashed ? 'gold' : 'neutral'} className="min-h-[58px]" onClick={() => press()} sub="Tap to skip">
        {last.cashed ? (
          <span className="tnum">
            Cashed out {money(payoutFor(last.bet, last.diff, last.goals))} ✓
          </span>
        ) : (
          'Saved!'
        )}
      </ActionButton>
    )
  } else if (mode === 'manual') {
    action = broke ? (
      <ActionButton className="min-h-[58px]" disabled sub="Lower your bet, or visit Rewards">
        Not enough coins
      </ActionButton>
    ) : (
      <ActionButton className="min-h-[58px]" onClick={() => press()} disabled={!ready} sub={`${ZONE_NAMES[zone]} · first goal pays ${money(payoutFor(bet, runDiff, 1))}`}>
        Take the penalty
      </ActionButton>
    )
  } else {
    action = (
      <ActionButton className="min-h-[58px]" onClick={startAuto} disabled={!ready || broke} sub={broke ? 'Not enough coins for this bet' : `cash out at ${target} goal${target > 1 ? 's' : ''} · ${short(multiplier(runDiff, target))}`}>
        Start autobet
      </ActionButton>
    )
  }

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <div className="max-lg:order-[-1]">
        <BetInput value={unit} onChange={setBet} disabled={locked} />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
          <span>Keeper</span>
          <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
            How it works
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Keeper">
          {LEVELS.map((l) => (
            <LevelTile key={l.id} level={l.id} portrait={portraits[l.id]} on={l.id === runDiff} disabled={locked && l.id !== runDiff} onClick={() => (sfx.click(), pickDiff(l.id))} />
          ))}
        </div>
        <p className="mt-2 text-[11.5px] leading-snug text-dim">
          {lv.keeper} covers {lv.covers} of the 6 zones: you score <span className="font-bold text-ink/85">{chanceLabel(runDiff)}</span> of the time, wherever you aim.
        </p>
        {fiveCounts && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug text-dim">
            <span className="text-gold">★</span>
            <span>
              <span className="font-bold text-gold">Perfect Five:</span> cash out after 5 goals here for a 3,000 reward
              {unit < CHALLENGE_MIN_BET ? ` (bet ${CHALLENGE_MIN_BET}+ to count)` : ''}.
            </span>
          </p>
        )}
      </div>
      {mode === 'auto' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-[auto_1fr] items-end gap-2">
            <div>
              <Label>Cash out after</Label>
              <div className="flex h-11 items-stretch overflow-hidden rounded-lg border-2 border-raised bg-stage">
                <button disabled={auto.running || target <= 1} onClick={() => (sfx.click(), setTarget((t) => Math.max(1, t - 1)))} className="w-9 bg-raised text-[17px] font-black text-ink/90 transition hover:bg-hover disabled:opacity-40" aria-label="Fewer goals">
                  −
                </button>
                <div className="tnum flex w-[74px] items-center justify-center text-[14px] font-extrabold">
                  {target} goal{target > 1 ? 's' : ''}
                </div>
                <button disabled={auto.running || target >= MAX_SHOTS} onClick={() => (sfx.click(), setTarget((t) => Math.min(MAX_SHOTS, t + 1)))} className="w-9 bg-raised text-[17px] font-black text-ink/90 transition hover:bg-hover disabled:opacity-40" aria-label="More goals">
                  +
                </button>
              </div>
            </div>
            <div className="min-w-0 pb-0.5 text-right">
              <div className="tnum text-[15px] font-black leading-tight text-accent">{short(multiplier(runDiff, target))}</div>
              <div className="tnum text-[11px] font-semibold text-dim">{pct(scoreChance(runDiff) ** target)} of runs</div>
            </div>
          </div>
          <div>
            <Label>Aim</Label>
            <Segmented
              value={pattern}
              onChange={setPattern}
              disabled={auto.running}
              options={[
                { value: 'random', label: 'Random' },
                { value: 'same', label: 'Aimed' },
                { value: 'sweep', label: 'Sweep' },
                { value: 'corners', label: 'Corners' },
              ]}
            />
          </div>
          <AutoSettings auto={auto} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-muted">Speed</span>
        <div className="w-[208px]">
          <Segmented
            value={speed}
            onChange={setSpeed}
            options={[
              { value: 0 as Speed, label: 'Normal' },
              { value: 1 as Speed, label: 'Turbo' },
              { value: 2 as Speed, label: 'Super' },
            ]}
          />
        </div>
      </div>
      {/* on a short laptop screen the panel scrolls, and the button stays in reach at its foot */}
      <div className="max-lg:order-[-2] lg:sticky lg:bottom-0 lg:z-10 lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">{action}</div>
      {mode === 'manual' && <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Click a zone in the goal to shoot there. Keys: 1–6 or arrows to aim, Space to shoot, C to cash out.</p>}
    </>
  )

  /* ---------------- stage ---------------- */

  const showZones = ready && rects && !auto.running && phase !== 'flight' && !away
  const steps = ladder(runDiff)
  const barY = rects ? rects[0].y : box.h * 0.3
  const lineY = rects ? rects[3].y + rects[3].h : box.h * 0.5
  const goalX = rects ? (rects[0].x + rects[2].x + rects[2].w) / 2 : box.w / 2
  const narrow = box.w < 520
  // the hit areas reach a little past the frame, so the zones are easy to hit on a phone
  const padTop = Math.max(0, Math.min(22, barY - 64))
  const padBot = 22
  const padSide = narrow ? 8 : 18
  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#070b1f]" onClick={() => sceneRef.current?.playing && sceneRef.current.hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* tap targets over the six zones (one tap shoots there) */}
      {showZones &&
        rects!.map((r, i) => {
          const col = i % 3
          const top = i < 3
          const x = r.x - (col === 0 ? padSide : 0)
          const y = r.y - (top ? padTop : 0)
          const w = r.w + (col !== 1 ? padSide : 0)
          const h = r.h + (top ? padTop : padBot)
          return (
            <button
              key={i}
              aria-label={`Shoot ${ZONE_NAMES[i].toLowerCase()}`}
              className="group absolute z-[5] cursor-pointer rounded-md outline-none focus-visible:ring-2 focus-visible:ring-gold"
              style={{ left: x, top: y, width: w, height: h }}
              onPointerEnter={(e) => e.pointerType !== 'touch' && sceneRef.current?.hover(i)}
              onPointerLeave={() => sceneRef.current?.hover(-1)}
              onClick={(e) => {
                e.stopPropagation()
                tapZone(i as Zone)
              }}
            >
              {!touch && phase === 'idle' && (
                <span
                  className="pointer-events-none absolute flex h-[18px] min-w-[18px] items-center justify-center rounded-[5px] bg-black/45 px-1 text-[11px] font-black text-white/70 transition group-hover:bg-white group-hover:text-[#1d0f30]"
                  style={{ left: r.x - x + 6, top: r.y - y + 5 }}
                >
                  {i + 1}
                </span>
              )}
            </button>
          )
        })}

      {/* past runs, the keeper you face, and the run's value now */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start gap-2 p-2.5 sm:p-3">
        <KeeperChip diff={runDiff} portrait={portraits[runDiff]} locked={locked} onClick={() => (sfx.click(), setSheet(true))} />
        <HistoryPills
          className="mt-1 min-w-0 flex-1"
          items={past.map((r) => ({
            key: r.id,
            tone: r.cashed ? (r.mult >= 10 ? 'gold' : 'win') : 'loss',
            label: (
              <span className="flex items-center gap-1">
                <BallIcon size={11} muted={!r.cashed} />
                {r.goals}
                <span className="opacity-60">·</span>
                {r.cashed ? short(r.mult) : '✕'}
              </span>
            ),
          }))}
        />
        <ValueChip active={active} goals={active ? goals : 0} unit={unit} diff={runDiff} />
      </div>

      {/* the replay tag */}
      <AnimatePresence>
        {replayOn && (
          <motion.div
            key="replay"
            className="pointer-events-none absolute left-3 z-20 flex items-center gap-1.5 rounded-md bg-black/60 px-2.5 py-1 text-[12px] font-black tracking-[0.18em] text-white backdrop-blur-sm"
            style={{ top: narrow ? 62 : 70 }}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
          >
            <motion.span className="h-2 w-2 rounded-full bg-danger" animate={{ opacity: [1, 0.2, 1] }} transition={{ duration: 0.9, repeat: Infinity }} />
            REPLAY
          </motion.div>
        )}
      </AnimatePresence>

      {/* captions under the goal: the first-time hint, fingertips and off-the-post moments, the keeper's read */}
      <div className="pointer-events-none absolute z-20 flex -translate-x-1/2 justify-center" style={{ left: goalX, top: lineY + (narrow ? 8 : 12), width: Math.min(box.w - 16, 460) }}>
        <AnimatePresence mode="popLayout">
          {caption && !away && headline?.kind !== 'perfect' ? (
            <motion.div
              key={caption.id}
              initial={{ opacity: 0, y: 10, scale: 0.85 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 26 }}
              className={
                caption.tone === 'info'
                  ? 'rounded-full bg-black/60 px-3 py-1 text-center text-[12px] font-bold text-white backdrop-blur-sm sm:text-[13px]'
                  : `rounded-2xl border-[2.5px] border-[#1d0f30] px-4 py-1 text-center text-[14px] font-black text-[#1d0f30] shadow-[0_4px_0_rgba(29,15,48,.4)] sm:text-[16px] ${caption.tone === 'gold' ? 'bg-[#ffe36b]' : 'bg-white'}`
              }
            >
              {caption.text}
            </motion.div>
          ) : hint && ready && rects && phase === 'idle' && !auto.running && !active ? (
            <motion.div key="hint" className="whitespace-nowrap rounded-full bg-black/60 px-3 py-1 text-[12px] font-bold text-white backdrop-blur-sm sm:text-[13px]" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {touch ? 'Tap' : 'Click'} a zone in the goal to shoot there
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* the headline, in the crowd above the bar: GOAL!, SAVED!, the cash-out */}
      <div className="pointer-events-none absolute inset-x-0 z-30 flex justify-center px-3" style={{ bottom: box.h - barY + (narrow ? 6 : 12) }}>
        <AnimatePresence>{headline && headline.kind !== 'perfect' && <HeadlineCard key={headline.id} h={headline} narrow={narrow} />}</AnimatePresence>
      </div>

      {/* a Perfect 10: the whole stage */}
      <AnimatePresence>{headline?.kind === 'perfect' && <PerfectCard key={headline.id} h={headline} narrow={narrow} />}</AnimatePresence>

      {/* the ladder: one step per shot, its multiplier, and how each shot went */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-[#050816] via-[#050816]/70 to-transparent px-2 pb-2 pt-6 sm:px-3">
        <div ref={ladderRef} className="no-scrollbar pointer-events-auto flex gap-1 overflow-x-auto sm:gap-1.5">
          {steps.map((m, i) => {
            const shot = run?.shots[i]
            const state = shot === true ? 'goal' : shot === false ? 'saved' : active && i === goals ? 'next' : 'future'
            return <Step key={i} i={i} mult={m} state={state} cashedHere={!!run?.cashed && run.goals === i + 1} badge={i === 4 && fiveCounts} />
          })}
        </div>
      </div>

      <AnimatePresence>
        {!ready && (
          <motion.div key="loading" className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_38%,#1c2a63_0%,#070b1f_72%)]" exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Switching on the floodlights" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100vw+128px)] max-sm:min-h-[460px]" />
      <AnimatePresence>{info && <InfoModal diff={runDiff} bet={unit} onClose={() => setInfo(false)} />}</AnimatePresence>
      <AnimatePresence>
        {sheet && (
          <Modal onClose={() => setSheet(false)} title="Choose your keeper" width={420}>
            <div className="grid grid-cols-2 gap-2 pb-1">
              {LEVELS.map((l) => (
                <LevelTile
                  key={l.id}
                  big
                  level={l.id}
                  portrait={portraits[l.id]}
                  on={l.id === runDiff}
                  disabled={locked && l.id !== runDiff}
                  onClick={() => {
                    sfx.click()
                    pickDiff(l.id)
                    setSheet(false)
                  }}
                />
              ))}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-dim">{locked ? 'You can change keeper once this run is over.' : 'A bigger keeper covers more of the goal: fewer goals, bigger multipliers.'}</p>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

function BallIcon({ size = 14, muted = false }: { size?: number; muted?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={muted ? 'opacity-60' : ''}>
      <circle cx="10" cy="10" r="8.6" fill="#fff" stroke="#1d0f30" strokeWidth="1.8" />
      <path d="M10 6.2 13.4 8.6 12.1 12.6H7.9L6.6 8.6Z" fill="#1d0f30" />
      <path d="M10 6.2V2M13.4 8.6l4-1.4M12.1 12.6l2.5 3.6M7.9 12.6l-2.5 3.6M6.6 8.6l-4-1.4" stroke="#1d0f30" strokeWidth="1.3" />
    </svg>
  )
}

/** the keeper's face (rendered from the 3D model once the stadium is up), or a little goal with his zones filled in */
function Portrait({ level, src, size }: { level: Difficulty; src?: string; size: number }) {
  if (src)
    return <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" style={{ boxShadow: `0 0 0 2px ${ACCENT[level]}`, width: size, height: size }} draggable={false} />
  const covers = levelOf(level).covers
  const order = [4, 1, 3, 5, 0, 2]
  const mine = new Set(order.slice(0, covers))
  return (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-black/30" style={{ width: size, height: size, boxShadow: `0 0 0 2px ${ACCENT[level]}` }}>
      <svg width={size * 0.66} height={size * 0.44} viewBox="0 0 30 20" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <rect key={i} x={2 + (i % 3) * 8.7} y={2 + Math.floor(i / 3) * 8} width="8.1" height="7.4" rx="1.2" fill={mine.has(i) ? ACCENT[level] : 'rgba(255,255,255,.14)'} />
        ))}
        <path d="M1 19V1h28v18" fill="none" stroke="rgba(255,255,255,.75)" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function LevelTile({ level, portrait, on, disabled, onClick, big = false }: { level: Difficulty; portrait?: string; on: boolean; disabled: boolean; onClick: () => void; big?: boolean }) {
  const l = levelOf(level)
  return (
    <button
      role="radio"
      aria-checked={on}
      aria-label={`${l.label}: ${l.keeper}, you score ${waysLabel(level)}`}
      disabled={disabled}
      onClick={onClick}
      className={`relative flex items-center gap-2 overflow-hidden rounded-lg text-left transition ${big ? 'px-3 py-3' : 'px-2 py-1.5'} ${on ? 'bg-raised ring-2 ring-[color:var(--acc)]' : 'bg-stage hover:bg-raised/70'} disabled:cursor-not-allowed disabled:opacity-45`}
      style={{ ['--acc' as string]: ACCENT[level] }}
    >
      <Portrait level={level} src={portrait} size={big ? 46 : 34} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-1">
          <span className={`font-extrabold leading-tight ${big ? 'text-[15px]' : 'text-[13px]'}`}>{l.label}</span>
          <span className={`tnum font-black ${big ? 'text-[13px]' : 'text-[11.5px]'}`} style={{ color: ACCENT[level] }}>
            {waysLabel(level).replace(' in ', '/')}
          </span>
        </span>
        <span className={`block font-semibold leading-tight text-dim ${big ? 'text-[12.5px]' : 'text-[11px]'}`}>{l.keeper}</span>
      </span>
    </button>
  )
}

/** the keeper you face, on the stage (opens the keeper picker) */
function KeeperChip({ diff, portrait, locked, onClick }: { diff: Difficulty; portrait?: string; locked: boolean; onClick: () => void }) {
  const l = levelOf(diff)
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="pointer-events-auto flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-[#0a0f2a]/80 py-1 pl-1 pr-3 text-left shadow-[0_6px_18px_-8px_rgba(0,0,0,.8)] backdrop-blur-sm transition hover:bg-[#141a3c]/90"
      aria-label={`Keeper: ${l.keeper}, ${l.label}${locked ? '' : '. Change keeper'}`}
    >
      <Portrait level={diff} src={portrait} size={30} />
      <span className="leading-tight">
        <span className="block text-[12px] font-extrabold text-white">{l.keeper}</span>
        <span className="tnum block text-[10.5px] font-bold" style={{ color: ACCENT[diff] }}>
          {l.label} · {waysLabel(diff)}
        </span>
      </span>
    </button>
  )
}

/** the run's value now: the one place the live numbers live */
function ValueChip({ active, goals, unit, diff }: { active: boolean; goals: number; unit: number; diff: Difficulty }) {
  const p = scoreChance(diff)
  const cash = active && goals > 0
  const done = goals >= MAX_SHOTS
  return (
    <div className="shrink-0 rounded-xl border border-white/10 bg-[#0a0f2a]/80 px-2.5 py-1.5 text-right shadow-[0_6px_18px_-8px_rgba(0,0,0,.8)] backdrop-blur-sm sm:px-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-white/55">{cash ? 'Cash out' : 'First goal'}</div>
      <div className={`tnum flex items-center justify-end gap-1 text-[14px] font-black leading-tight sm:text-[16px] ${cash ? 'text-gold' : 'text-white'}`}>
        {money(cash ? payoutFor(unit, diff, goals) : payoutFor(unit, diff, 1))} <Coin size={13} />
      </div>
      <div className="tnum text-[10.5px] font-bold text-white/60">{cash && !done ? `next ${money(payoutFor(unit, diff, goals + 1))} · ${pct(p)}` : `${pct(p)} to score`}</div>
    </div>
  )
}

function Step({ i, mult, state, cashedHere, badge }: { i: number; mult: number; state: 'goal' | 'saved' | 'next' | 'future'; cashedHere: boolean; badge: boolean }) {
  return (
    <div
      data-step={i}
      className={`relative flex min-w-[64px] flex-1 shrink-0 flex-col items-center rounded-lg px-1 pb-1 pt-1 transition-colors sm:min-w-[74px] ${
        state === 'goal'
          ? cashedHere
            ? 'bg-gold text-[#2a1c00]'
            : 'bg-accent text-[#032412]'
          : state === 'saved'
            ? 'bg-danger text-white'
            : state === 'next'
              ? 'bg-[#1c2550] text-white ring-2 ring-gold'
              : 'bg-[#121935] text-white/75'
      }`}
    >
      <div className="flex h-4 items-center gap-1 text-[10.5px] font-black uppercase leading-none">
        {state === 'goal' ? <BallIcon size={12} /> : state === 'saved' ? <span className="text-[12px] leading-none">✕</span> : <span className="opacity-70">{i + 1}</span>}
      </div>
      <div className="tnum mt-0.5 text-[13px] font-black leading-none sm:text-[14px]">{short(mult)}</div>
      {badge && (
        <span className="absolute -right-1 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-gold text-[9px] text-[#2a1c00] shadow" title="Perfect Five challenge">
          ★
        </span>
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
          sfx.penalty.count(x / (to || 1))
        }
      },
    })
    return () => c.stop()
  }, [to, ms, tick])
  return v
}

/**
 * Big italic lettering with a gradient face and an ink outline. The outline is a solid copy of the text behind the
 * face (a thick stroke there can't show through the letters), and both have room on the right for the italic overhang.
 */
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
  red: 'bg-[linear-gradient(180deg,#ffffff_0%,#ffd0d6_50%,#ff5a6e_100%)]',
  rainbow: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
  white: 'bg-[linear-gradient(180deg,#ffffff_0%,#e6ecff_60%,#aebcff_100%)]',
}

function HeadlineCard({ h, narrow }: { h: Headline; narrow: boolean }) {
  const amount = h.kind === 'cash' || h.kind === 'goal' ? h.amount : 0
  const counted = useCount(amount, h.kind === 'cash' ? (h.tier ? 1100 : 550) : 0, h.kind === 'cash')
  const size = narrow ? 'text-[34px]' : 'text-[58px]'
  const pill = 'flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white py-1 shadow-[0_5px_0_rgba(29,15,48,.45)]'
  return (
    <motion.div
      className="flex flex-col items-center"
      initial={{ opacity: 0, y: 18, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
    >
      {h.kind === 'cash' && h.tier > 0 && (
        <motion.div
          className="mb-1.5 rounded-full bg-[#1d0f30] px-3 py-0.5 text-[11px] font-black tracking-[0.22em] text-gold sm:text-[12px]"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.15, 1] }}
          transition={{ delay: 0.2, duration: 0.4 }}
        >
          {TIER_NAME[h.tier]}
        </motion.div>
      )}
      <motion.div animate={h.kind === 'saved' ? { rotate: [0, -3, 3, 0] } : { scale: [1, 1.06, 1] }} transition={{ duration: 0.5, delay: 0.15 }}>
        <Lettering
          text={h.kind === 'goal' ? goalTitle(h.goals) : h.kind === 'saved' ? 'SAVED!' : h.kind === 'banner' ? h.text : 'CASHED OUT'}
          face={h.kind === 'saved' ? FACE.red : h.kind === 'banner' ? FACE.white : (h.kind === 'goal' && h.goals >= 7) || (h.kind === 'cash' && h.tier >= 2) ? FACE.rainbow : FACE.gold}
          size={h.kind === 'banner' ? (narrow ? 'text-[24px]' : 'text-[40px]') : size}
        />
      </motion.div>
      {h.kind === 'goal' && (
        <div className={`mt-1.5 ${pill} pl-1.5 pr-3.5`}>
          <span className="tnum rounded-full bg-accent px-2.5 py-0.5 text-[13px] font-black text-[#032412] sm:text-[16px]">{short(h.mult)}</span>
          <span className="tnum flex items-center gap-1 text-[13px] font-black text-[#1d0f30] sm:text-[16px]">
            {money(h.amount)} <Coin size={14} />
          </span>
        </div>
      )}
      {h.kind === 'saved' && <div className={`mt-1.5 ${pill} px-3.5 text-[13px] font-black text-[#1d0f30] sm:text-[15px]`}>{h.how}</div>}
      {h.kind === 'banner' && <div className={`mt-1.5 ${pill} tnum px-3.5 text-[13px] font-black text-[#1d0f30] sm:text-[15px]`}>{h.sub}</div>}
      {h.kind === 'cash' && (
        <div className={`mt-1.5 ${pill} pl-1.5 pr-4`}>
          <span className="tnum rounded-full bg-gold px-2.5 py-0.5 text-[14px] font-black text-[#2a1c00] sm:text-[17px]">{short(h.mult)}</span>
          <span className="tnum flex items-center gap-1.5 text-[17px] font-black text-[#1d0f30] sm:text-[22px]">
            {money(counted)} <Coin size={19} />
          </span>
        </div>
      )}
    </motion.div>
  )
}

/** the Perfect 10 over the team's celebration: it counts the win up, and a tap skips the party */
function PerfectCard({ h, narrow }: { h: Extract<Headline, { kind: 'perfect' }>; narrow: boolean }) {
  const counted = useCount(h.amount, 2600, true)
  return (
    <motion.div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center px-4 pt-[13%]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3 } }}>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_24%,rgba(5,8,22,.6)_0%,rgba(5,8,22,.2)_45%,transparent_70%)]" />
      <motion.div className="relative flex flex-col items-center" initial={{ scale: 0.4, y: 20 }} animate={{ scale: 1, y: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
        <motion.div
          className="mb-2 rounded-full bg-[#1d0f30] px-3.5 py-1 text-[12px] font-black tracking-[0.26em] text-gold sm:text-[13px]"
          initial={{ scale: 0 }}
          animate={{ scale: [0, 1.15, 1] }}
          transition={{ delay: 0.35, duration: 0.4 }}
        >
          TEN FROM TEN · {TIER_NAME[h.tier]}
        </motion.div>
        <motion.div animate={{ scale: [1, 1.05, 1], rotate: [-1, 1, -1] }} transition={{ duration: 1.6, repeat: Infinity }}>
          <Lettering text="PERFECT 10!" face={FACE.rainbow} size={narrow ? 'text-[42px]' : 'text-[76px]'} />
        </motion.div>
        <div className="mt-3 flex items-center gap-2 rounded-full border-[3px] border-[#1d0f30] bg-white py-1.5 pl-2 pr-5 shadow-[0_6px_0_rgba(29,15,48,.45)]">
          <span className="tnum rounded-full bg-gold px-3 py-0.5 text-[16px] font-black text-[#2a1c00] sm:text-[20px]">{short(h.mult)}</span>
          <span className="tnum flex items-center gap-1.5 text-[22px] font-black text-[#1d0f30] sm:text-[30px]">
            {money(counted)} <Coin size={24} />
          </span>
        </div>
        <div className="mt-3 text-[12px] font-bold text-white/70">Tap to skip</div>
      </motion.div>
    </motion.div>
  )
}

function InfoModal({ diff, bet, onClose }: { diff: Difficulty; bet: number; onClose: () => void }) {
  const [d, setD] = useState(diff)
  const steps = ladder(d)
  const p = scoreChance(d)
  return (
    <Modal onClose={onClose} title="How Penalty Shootout works" width={500}>
      <p className="text-[13px] leading-relaxed text-muted">
        Pay your bet and take up to {MAX_SHOTS} penalties: tap a zone of the goal to shoot there (or aim with 1–6 or the arrows and press Shoot). Score and you can cash out, or shoot again for a bigger
        multiplier. If the keeper saves one, the run is over and the bet is lost. Ten goals in a row is a Perfect 10, and it cashes out by itself.
      </p>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">
        The keeper decides how many zones he covers when he dives, so your chance to score is the same wherever you aim. Each shot is decided the moment you strike it, before your zone
        is even looked at; afterwards gloves in the goal show the zones he covered. The cash-out after n goals is 97% ÷ chance<sup>n</sup>, floored to the cent, so whichever way you play
        it returns 97% over time on Hard and Expert, and between 96.5% and 97% on Easy and Medium, where the floored cent weighs a little more.
      </p>
      <div className="mt-3">
        <Segmented value={d} onChange={setD} options={LEVELS.map((l) => ({ value: l.id, label: l.label }))} />
      </div>
      <div className="mt-2 flex items-center justify-between px-1 text-[12px] font-semibold text-muted">
        <span>
          {levelOf(d).keeper} covers {levelOf(d).covers} of 6
        </span>
        <span className="tnum font-extrabold text-gold">{chanceLabel(d)} per shot</span>
      </div>
      <div className="mt-2 grid grid-cols-[auto_1fr_auto_auto] items-center gap-x-3 gap-y-1 rounded-lg bg-stage px-3 py-2">
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-dim">Goals</span>
        <span className="text-[10.5px] font-bold uppercase tracking-wider text-dim">Chance</span>
        <span className="text-right text-[10.5px] font-bold uppercase tracking-wider text-dim">Multiplier</span>
        <span className="text-right text-[10.5px] font-bold uppercase tracking-wider text-dim">Pays</span>
        {steps.map((m, i) => (
          <div key={i} className="contents">
            <span className="tnum text-[13px] font-extrabold">{i + 1}</span>
            <span className="tnum text-[12px] font-semibold text-muted">{((p ** (i + 1)) * 100).toFixed(p ** (i + 1) < 0.001 ? 4 : 2)}%</span>
            <span className="tnum text-right text-[13px] font-extrabold text-accent">{short(m)}</span>
            <span className="tnum text-right text-[12px] font-semibold text-ink/85">{money(payoutFor(bet, d, i + 1))}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[12px] text-dim">
        Auto mode shoots until your target number of goals, then cashes out; pick how it aims. Turbo speeds the show up and Super goes straight to the strike; a tap on the pitch (or
        Space) hurries a shot along. If you leave in the middle of a run, it is cashed out at what it is worth.
      </p>
    </Modal>
  )
}
