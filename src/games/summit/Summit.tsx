import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion, useMotionValue, type Easing, type MotionValue } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, NumberField, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Coin } from '../../components/icons'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { MAX_MULT, PITCHES, ROUTES, bank, climb, multiplierOf, newClimb, payoutOf, routeOf, type Climb, type RouteId } from './rules'
import { SNOW, along, campPt, fallPt, layoutOf, routePath } from './geom'
import { Scene, furnitureScale, type Burst, type Pop } from './Mountain'
import type { Pose } from './Climber'
import { Ladder } from './Ladder'
import { BigButton, RouteCard, type BigKind } from './Deck'
import { EndCard, RouteChips, SummitParty } from './Result'
import { InfoModal } from './Info'
import { FlagMark, RouteGlyph } from './art'
import { summitSfx } from './sound'
import { STALE_MS, addHistory, climbKey, dropSaved, histKey, lastKey, loadHistory, loadLast, newId, readSaved, saveLast, storageWorks, takeSaved, writeSaved, type How, type Last, type Past, type Saved } from './storage'
import { LOOK, altText, campName, multText, oneIn, pathChance, pct } from './words'

/*
  Summit: climb a mountain pitch by pitch, choosing the route each time, and bank whenever you like.

  The player sets a stake and presses Start climb: the stake is taken and the climber waits at Base Camp (the camera
  glides down to it from wherever the last climb ended). Then four route cards offer the next pitch, each with its
  chance of holding and the multiplier the climb would make if it does (rules.ts: the Trail holds 90% of the time,
  the Ridge 66%, the Cliff 40%, the Sheer Wall 20%, each priced at its own odds). Pointing at a card lights its line
  up the mountain. Choosing one draws the pitch and the climber goes: a stroll up the Trail's switchbacks, an
  arms-out edge along the Ridge, a scramble up the Cliff, a roped climb up the Sheer Wall (Climber.tsx), the camera
  rising with them through the clouds, the sky darkening and the weather worsening as they go (Mountain.tsx). A pitch
  that holds lands on the next camp with a cheer and the multiplier rising off it, and the Bank button, which pays
  the stake times the multiplier, bounces up to its new amount. One that gives way teeters, then snaps (rock, or the
  rope on the Wall) and the climber tumbles into the clouds below. Ten pitches make the summit, which banks itself
  with a flag and a party. The ladder at the side shows every camp's worth; recent climbs sit in the panel; Auto
  climbs one route and banks at a target multiplier.

  The money. A climb is a decision game, so it waits for the player: it is kept per player in localStorage
  (storage.ts) and written synchronously after every pitch and before the pitch is shown, so a reload, a page that
  died or a visit next week finds the climber on the same ledge, and no pitch can be re-rolled (rules.ts draws each
  one only when its route is chosen). It is paid exactly once, when it ends: the move that ends it (a fall, Bank, or
  the summit) takes the record out of storage (checking it is still there and still this climb) and settles in the
  same moment, then the moment plays. A tab re-reads the record before every move and acts only on the very state it
  shows; otherwise it adopts what storage holds (it follows the storage event too, so two tabs show one climb and
  only one of them can pay it). A climb untouched for STALE_MS is banked where it stands on the next visit (its
  stake handed back if it never left Base Camp); one that can't be read is removed and its stake handed back. The
  climb belongs to the player whose stake it took: signing in or out switches to that player's own climb. Without
  working storage (a private window) a climb lives in the page and is paid from there, once.

  Dev hooks (dev builds only): window.__summitForce = 'hold' | 'fall' forces every pitch until cleared, or an array
  of them forces the next pitches one by one; window.__summitSpeed = 0.2 plays the moments five times faster.
*/

type EndStage = 'anim' | 'done'
/** the finished climb on show */
interface End extends Omit<Last, 'how'> {
  how: How | 'away'
  stage: EndStage
}
/** the pitch on show: the climber on their way up from camp k */
interface Pitch {
  id: number
  k: number
  r: RouteId
}

const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
const isTouch = () => typeof matchMedia !== 'undefined' && matchMedia('(hover: none)').matches
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** how long each route's pitch takes to climb (ms) */
const DUR: Record<RouteId, number> = { trail: 1500, ridge: 1750, cliff: 1850, wall: 2150 }
const RISK: Record<RouteId, number> = { trail: 0, ridge: 0.35, cliff: 0.7, wall: 1 }
const WORD: Record<RouteId, string> = { trail: 'SLIP!', ridge: 'CRACK!', cliff: 'CRACK!', wall: 'SNAP!' }

/* ---------------- dev: forced pitches, faster moments ---------------- */

function pitchDraw(): number {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __summitForce?: unknown }
    const f = w.__summitForce
    const u = (v: unknown) => (v === 'hold' ? 0 : v === 'fall' ? 0.999999 : null)
    if (Array.isArray(f)) {
      const v = u(f.shift())
      if (!f.length) delete w.__summitForce
      if (v != null) return v
    } else {
      const v = u(f)
      if (v != null) return v
    }
  }
  return rand()
}
function devSpeed(): number {
  if (import.meta.env.DEV) {
    const s = (window as unknown as { __summitSpeed?: unknown }).__summitSpeed
    if (typeof s === 'number' && s > 0) return s
  }
  return 1
}

/* ---------------- the page ---------------- */

export default function Summit() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const betRef = useRef(bet)
  betRef.current = bet
  const [solo] = useState(() => !storageWorks())
  const [touch] = useState(isTouch)
  const [mode, setMode] = useState<Mode>('manual')
  const [autoRoute, setAutoRoute] = useState<RouteId>('ridge')
  const [autoTarget, setAutoTarget] = useState(3)
  const autoRouteRef = useRef(autoRoute)
  autoRouteRef.current = autoRoute
  const autoTargetRef = useRef(autoTarget)
  autoTargetRef.current = autoTarget

  // the climb in progress (null: none), as storage holds it; the ref is the money path's view of it
  const [rec, setRecState] = useState<Saved | null>(null)
  const recRef = useRef<Saved | null>(null)
  const setRec = (r: Saved | null) => {
    recRef.current = r
    setRecState(r)
  }
  // a finished climb on show
  const [end, setEndState] = useState<End | null>(null)
  const endRef = useRef<End | null>(null)
  const setEnd = (e: End | null) => {
    endRef.current = e
    setEndState(e)
  }
  // the pitch being climbed
  const [pitch, setPitchState] = useState<Pitch | null>(null)
  const pitchRef = useRef<Pitch | null>(null)
  const setPitch = (p: Pitch | null) => {
    pitchRef.current = p
    setPitchState(p)
  }
  const [pose, setPose] = useState<Pose>('stand')
  const [face, setFaceState] = useState<1 | -1>(1)
  const faceRef = useRef<1 | -1>(1)
  const setFace = (f: 1 | -1) => {
    if (faceRef.current === f) return
    faceRef.current = f
    setFaceState(f)
  }
  const [rope, setRope] = useState<number | null>(null)
  const [burst, setBurst] = useState<Burst | null>(null)
  const [pop, setPop] = useState<Pop | null>(null)
  const [planted, setPlanted] = useState(false)
  /** a pitch is on its way and has not shown how it went yet: nothing on screen may tell */
  const [veil, setVeil] = useState(false)
  const [party, setParty] = useState<{ id: string; amount: number; mult: number } | null>(null)
  const [level, setLevel] = useState(0)
  const [hover, setHover] = useState<RouteId | null>(null)
  const [info, setInfo] = useState(false)
  const [say, setSay] = useState('')
  const [note, setNote] = useState<{ text: string; id: number } | null>(null)
  const [hist, setHist] = useState<Past[]>(() => loadHistory(histKey(useAuth.getState().uid)))

  const keyRef = useRef(climbKey(uid))
  const uidRef = useRef(uid)
  uidRef.current = uid
  /** climbs this page has paid (the guard without storage) */
  const paid = useRef(new Set<string>())
  /** the id of the moment under way: a newer one (or a climb adopted from another tab) cancels its steps */
  const show = useRef(0)
  /** a climb another tab took, while its ending is awaited from storage */
  const waiting = useRef<{ id: string; timer: number } | null>(null)
  const timers = useRef<number[]>([])
  const tweens = useRef<{ stop: () => void; done: () => void }[]>([])
  const beat = useRef<number | null>(null)
  const alive = useRef(true)
  const autoOn = useRef(false)
  const autoStop = useRef(false)

  // the camera's altitude (camps) and the climber's place on the mountain
  const alt = useMotionValue(0)
  const cx = useMotionValue(0)
  const cy = useMotionValue(0)
  const spin = useMotionValue(0)
  const fade = useMotionValue(1)

  const [stageRef, size] = useSize<HTMLDivElement>()
  const L = layoutOf(size.w, size.h)
  const geoRef = useRef(L.geo)
  geoRef.current = L.geo
  const wideRef = useRef(L.wide)
  wideRef.current = L.wide
  /** where the camera rests on a finished climb: a little above its camp, so the card over the sky leaves the climber in view */
  const endAlt = (k: number) => k + (wideRef.current ? 0.32 : 0.55)

  /* ---------------- timing ---------------- */

  const speed = () => (autoOn.current ? 0.7 : 1) * devSpeed()
  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(fn, ms * speed()))
  }
  const drop = (e: { stop: () => void; done: () => void }) => {
    tweens.current = tweens.current.filter((x) => x !== e)
  }
  /** waits ms (sped up in auto); resolves at once if the moment is cancelled */
  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      const e = { stop: () => clearTimeout(t), done: () => resolve() }
      const t = window.setTimeout(() => {
        drop(e)
        resolve()
      }, ms * speed())
      tweens.current.push(e)
    })
  /** tweens a number (or a motion value) over ms; resolves when done or cancelled */
  const tween = (from: number | MotionValue<number>, to: number, ms: number, ease: Easing, onUpdate?: (v: number) => void) =>
    new Promise<void>((resolve) => {
      const e = { stop: () => {}, done: () => resolve() }
      const opts = {
        duration: (ms * speed()) / 1000,
        ease,
        onUpdate,
        onComplete: () => {
          drop(e)
          resolve()
        },
      }
      const c = typeof from === 'number' ? animate(from, to, opts) : animate(from, to, opts)
      e.stop = () => c.stop()
      tweens.current.push(e)
    })
  const stopBeat = () => {
    if (beat.current != null) clearInterval(beat.current)
    beat.current = null
  }
  const cancelShow = () => {
    show.current++
    const all = tweens.current
    tweens.current = []
    all.forEach((e) => {
      e.stop()
      e.done()
    })
    timers.current.forEach(clearTimeout)
    timers.current = []
    stopBeat()
  }
  const toast = (title: string, amount?: number) => useWallet.getState().pushToast(amount != null && amount > 0 ? { kind: 'win', title, amount } : { kind: 'info', title })
  const flash = (text: string) => {
    const id = Date.now()
    setNote({ text, id })
    later(3200, () => setNote((n) => (n && n.id === id ? null : n)))
  }

  /** the climber stands at camp k, the camera on them */
  const placeAt = (k: number) => {
    const p = campPt(geoRef.current, k)
    cx.set(p.x)
    cy.set(p.y)
    spin.set(0)
    fade.set(1)
  }
  const rest = (k: number, hidden = false) => {
    setPose('stand')
    setRope(null)
    setPitch(null)
    placeAt(k)
    if (hidden) fade.set(0)
    alt.set(k)
    setLevel(k)
    setPlanted(false)
    setVeil(false)
  }
  /** where the climber rests now: the camp of the climb (or the ending) on show */
  const restCamp = () => endRef.current?.climb.path.length ?? recRef.current?.climb.path.length ?? 0

  // a new stage size: the climber and the camera back on their camp (unless a moment is moving them)
  useLayoutEffect(() => {
    if (pitchRef.current || tweens.current.length) return
    const k = restCamp()
    const e = endRef.current
    const p = campPt(L.geo, k)
    cx.set(p.x)
    cy.set(p.y)
    if (e && e.climb.state === 'fell') fade.set(0)
    alt.set(e && e.stage === 'done' && e.climb.state !== 'fell' ? endAlt(k) : k)
    // the size is all this follows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L.geo.w, L.geo.h, L.geo.S, L.geo.cx, L.geo.anchor])

  /* ---------------- money: the climb's record ---------------- */

  /** shows a climb read from storage (another tab's pitch, a reload, a new visit), with nothing moving */
  const adopt = (next: Saved) => {
    const cur = recRef.current
    cancelShow()
    if (!cur || cur.id !== next.id) {
      setEnd(null)
      setParty(null)
    }
    setBurst(null)
    setRec(next)
    rest(next.climb.path.length)
  }

  /** a finished climb, shown as it ended (paid elsewhere: another tab, or one finished after a week away) */
  const showEnded = (l: Last, how: How | 'away') => {
    cancelShow()
    setRec(null)
    setParty(null)
    setBurst(null)
    rest(l.climb.path.length, l.climb.state === 'fell')
    if (l.climb.state === 'banked' && l.climb.path.length >= PITCHES) setPlanted(true)
    if (l.climb.state !== 'fell') alt.set(endAlt(l.climb.path.length))
    setEnd({ ...l, how, stage: 'done' })
  }

  /** the climb on show was taken out of storage by another tab (it paid it): show how it ended, once storage has it */
  const gone = (cur: Saved) => {
    cancelShow()
    setRec(null)
    rest(cur.climb.path.length)
    const l = loadLast(lastKey(cur.uid))
    if (l && l.id === cur.id) {
      showEnded(l, 'away')
      flash('This climb was finished in another tab')
      return
    }
    if (waiting.current) clearTimeout(waiting.current.timer)
    waiting.current = {
      id: cur.id,
      timer: window.setTimeout(() => {
        waiting.current = null
        if (alive.current) flash('This climb was finished in another tab')
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
      flash('This climb was finished in another tab')
    }
  }

  /** a stored climb that can't be read: removed, and its stake handed back (once: only the page that removes it) */
  const dropBad = (key: string, stakeBack: number | null) => {
    if (dropSaved(key) && stakeBack) {
      useWallet.getState().refund(stakeBack)
      toast("A saved Summit climb couldn't be read: your stake was returned", stakeBack)
    }
  }

  const authStatusRef = useRef(authStatus)
  authStatusRef.current = authStatus
  /** follows storage: adopts a newer state of the climb, or notices it is gone */
  const resync = () => {
    if (solo) return
    const key = climbKey(uidRef.current)
    if (key !== keyRef.current) return
    const r = readSaved(key)
    const cur = recRef.current
    if (r.kind === 'ok') {
      if (!cur || cur.id !== r.rec.id || r.rec.n > cur.n) adopt(r.rec)
    } else if (r.kind === 'none') {
      if (cur) gone(cur)
    } else if (authStatusRef.current !== 'loading') {
      dropBad(key, r.stake)
      if (cur) {
        setRec(null)
        rest(0)
      }
    }
  }

  /**
   * The climb as storage holds it, if it is exactly the state on show and belongs to whoever is signed in now: the
   * only state a move may be made on. Otherwise storage's state is shown instead and null returned (the press does
   * nothing).
   */
  const current = (): Saved | null => {
    const cur = recRef.current
    if (!cur) return null
    if (climbKey(useAuth.getState().uid) !== keyRef.current) return null
    if (solo) return cur
    const r = readSaved(keyRef.current)
    if (r.kind === 'ok' && r.rec.id === cur.id && r.rec.n === cur.n) return r.rec
    resync()
    return null
  }

  /** a pitch climbed: stored first (synchronously), then shown */
  const commit = (cur: Saved, c: Climb): Saved => {
    const next: Saved = { ...cur, climb: c, n: cur.n + 1, at: Date.now() }
    if (!solo) writeSaved(keyRef.current, next)
    setRec(next)
    return next
  }

  /**
   * The climb is over: taken out of storage (if it is still there and still this climb) and paid, in one moment.
   * Null if another tab took it first (nothing is paid here then).
   */
  const settleClimb = (cur: Saved, c: Climb, key: string, how: How): Last | null => {
    if (solo) {
      if (paid.current.has(cur.id)) return null
      paid.current.add(cur.id)
    } else if (!takeSaved(key, cur.id)) return null
    const payout = payoutOf(cur.stake, c)
    const fell = c.state === 'fell'
    const mult = fell ? 0 : multiplierOf(c.path)
    useWallet.getState().settle({ game: 'summit', bet: cur.stake, payout, meta: { pitches: c.path.length, mult, fell, routes: [...c.path, ...(c.fellOn ? [c.fellOn] : [])].join(' ') } })
    const l: Last = { id: cur.id, stake: cur.stake, climb: c, payout, how, t: Date.now() }
    // after the wallet's credit (a write here writes it first): how it ended, for this page, another tab and the strip
    saveLast(lastKey(cur.uid), l)
    const h = addHistory(histKey(cur.uid), { id: cur.id, t: l.t, stake: cur.stake, payout, mult, path: c.path, fellOn: c.fellOn, how })
    if (alive.current) setHist(h)
    return l
  }

  // The player's climb: the one stored under their key (signing in or out switches to the new player's). Shown where
  // it was; a climb untouched for a week is banked (or refunded) and one that can't be read is refunded, once sign-in
  // has settled so the money lands in the wallet that took the stake.
  useEffect(() => {
    const key = climbKey(uid)
    const switched = key !== keyRef.current
    keyRef.current = key
    if (switched || (!recRef.current && !endRef.current)) {
      if (switched) {
        cancelShow()
        setEnd(null)
        setParty(null)
        setBurst(null)
      }
      setHist(loadHistory(histKey(uid)))
      if (solo) {
        if (recRef.current && recRef.current.uid !== uid) {
          setRec(null)
          rest(0)
        }
      } else {
        const r = readSaved(key)
        // a climb left for a week is finished below, once sign-in has settled: it is not shown as resumed
        if (r.kind === 'ok' && Date.now() - r.rec.at <= STALE_MS) {
          setRec(r.rec)
          rest(r.rec.climb.path.length)
          const k = r.rec.climb.path.length
          flash(k ? `Your climb is right where you left it: ${campName(k)}` : 'Your climb is waiting at Base Camp')
          setSay(k ? `Your climb is back at ${campName(k)}, ${multText(multiplierOf(r.rec.climb.path))}. Pick a route or bank.` : 'Your climb is waiting at Base Camp. Pick a route.')
        } else {
          setRec(null)
          if (switched) rest(0)
        }
      }
    }
    if (authStatus === 'loading' || solo) return
    const r = readSaved(key)
    if (r.kind === 'bad') {
      dropBad(key, r.stake)
      setRec(null)
    } else if (r.kind === 'ok' && Date.now() - r.rec.at > STALE_MS) {
      const when = new Date(r.rec.t).toLocaleDateString()
      const k = r.rec.climb.path.length
      if (k) {
        const l = settleClimb(r.rec, bank(r.rec.climb), key, 'stale')
        if (l) {
          showEnded(l, 'stale')
          toast(`Your Summit climb from ${when} was banked at ${campName(k)} (${multText(multiplierOf(l.climb.path))}) and paid`, l.payout)
        }
      } else if (takeSaved(key, r.rec.id)) {
        useWallet.getState().refund(r.rec.stake)
        toast(`Your Summit climb from ${when} never left Base Camp: your stake was returned`, r.rec.stake)
      }
    }
    // the helpers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, authStatus])

  // another tab's pitches, and coming back to a tab that missed some
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
      autoStop.current = true
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('pageshow', onShow)
      document.removeEventListener('visibilitychange', onShow)
      cancelShow()
      if (waiting.current) clearTimeout(waiting.current.timer)
    }
    // the handlers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the moves ---------------- */

  const busy = () => !!pitchRef.current || (!!endRef.current && endRef.current.stage !== 'done')

  function start(): Saved | null {
    if (busy() || recRef.current) return null
    const u = useAuth.getState().uid
    const key = climbKey(u)
    keyRef.current = key
    // one climb at a time: a climb already stored (another tab started it) is shown instead
    if (!solo) {
      const r = readSaved(key)
      if (r.kind === 'ok') {
        adopt(r.rec)
        return null
      }
      if (r.kind === 'bad') dropBad(key, r.stake)
    }
    const amount = betRef.current
    if (useWallet.getState().balance < amount) {
      toast(NO_COINS)
      return null
    }
    if (!stake(amount)) return null
    const now = Date.now()
    const r: Saved = { v: 1, id: newId(), uid: u, stake: amount, climb: newClimb(), n: 0, t: now, at: now }
    // stored before anything shows (the stake's write goes first: storage writes the wallet ahead of it)
    if (!solo) writeSaved(key, r)
    cancelShow()
    setEnd(null)
    setParty(null)
    setBurst(null)
    setPop(null)
    setRec(r)
    // back to base camp: the climber is there, the camera glides down to them
    const from = alt.get()
    setPose('stand')
    setRope(null)
    setPitch(null)
    setPlanted(false)
    setFace(1)
    placeAt(0)
    setLevel(0)
    if (Math.abs(from) > 0.02) void tween(alt, 0, Math.min(1500, 450 + Math.abs(from) * 110), 'easeInOut')
    summitSfx.start()
    setSay(`Climb on: ${fmt(amount)} staked. Pick your route to Camp 1.`)
    return r
  }

  /** the beat of the climber's moves while a pitch is climbed: footsteps, holds, the rope's creak */
  function startBeat(r: RouteId, k: number) {
    stopBeat()
    const snow = k + 1 >= SNOW
    let n = 0
    const ms = r === 'trail' ? 300 : r === 'ridge' ? 420 : r === 'cliff' ? 260 : 450
    beat.current = window.setInterval(() => {
      n++
      if (r === 'trail') summitSfx.step(snow)
      else if (r === 'ridge') {
        summitSfx.step(snow)
        if (n % 3 === 0) summitSfx.grab()
      } else if (r === 'cliff') {
        if (n % 2) summitSfx.grab()
        else summitSfx.step(snow)
      } else {
        summitSfx.grab()
        if (n % 2 === 0) summitSfx.creak()
      }
    }, ms * speed())
  }

  /** moves the climber along route r's path from camp k, between shares t0 and t1 of the way */
  function along_(k: number, r: RouteId, t0: number, t1: number, ms: number, ease: Easing) {
    const P = routePath(geoRef.current, k, r)
    return tween(t0, t1, ms, ease, (v) => {
      const q = along(P, v)
      cx.set(q.x)
      cy.set(q.y)
      if (r !== 'wall') setFace(q.dir)
    })
  }

  /** a pitch climbed on route r from camp k: it holds (and the climb goes on), the summit, or a fall */
  async function playPitch(id: number, k: number, r: RouteId, outcome: 'hold' | 'fall' | 'summit', l: Last | null) {
    const g = geoRef.current
    const P = routePath(g, k, r)
    setPitch({ id, k, r })
    setRope(r === 'wall' ? k : null)
    setPose(r)
    setFace(along(P, 0.05).dir)
    const dur = DUR[r]
    summitSfx.tension(RISK[r], (dur * speed()) / 1000)
    if (r === 'wall') summitSfx.clip()
    if (k >= 3) summitSfx.wind(k, 2)
    startBeat(r, k)
    setSay(`${LOOK[r].doing} to ${campName(k + 1)}…`)

    if (outcome === 'fall') {
      const stop = 0.45 + Math.random() * 0.3
      const P0 = along(P, stop)
      void tween(alt, k + stop * 0.85, dur * stop * 1.1, 'easeInOut')
      await along_(k, r, 0, stop, dur * stop * 1.05, 'easeIn')
      if (show.current !== id) return
      stopBeat()
      setPose('teeter')
      if (r === 'wall') summitSfx.creak()
      await wait(440)
      if (show.current !== id) return
      const dir = P0.x >= g.cx ? 1 : -1
      const sc = furnitureScale(g)
      setVeil(false)
      setBurst({ id: Date.now(), x: P0.x, y: P0.y - 26 * sc, word: WORD[r], rope: r === 'wall' })
      if (r === 'wall') summitSfx.snap()
      else summitSfx.crumble()
      setRope(null)
      setPose('fall')
      setFace(dir === 1 ? 1 : -1)
      summitSfx.fall()
      setSay(`${LOOK[r].gives}! The climb is lost.`)
      const a0 = -P0.y / g.S
      void tween(alt, a0 - 0.75, 1300, 'easeInOut')
      await tween(0, 1, 1550, 'linear', (t) => {
        const q = fallPt(g, P0, dir, t)
        cx.set(q.x)
        cy.set(q.y)
        spin.set(dir * t * 940)
        if (t > 0.78) fade.set(Math.max(0, 1 - (t - 0.78) / 0.22))
      })
      if (show.current !== id) return
      fade.set(0)
      spin.set(0)
      setPose('stand')
      setPitch(null)
      await wait(260)
      if (show.current !== id || !l) return
      finishEnd(l.id)
      return
    }

    // the pitch holds: the camera rises with the climber; the risky routes pause at the crux
    void tween(alt, k + 1, dur * 1.08, 'easeInOut')
    const crux = r === 'cliff' || r === 'wall' ? 0.82 : null
    if (crux) {
      await along_(k, r, 0, crux, dur * 0.82, 'easeIn')
      if (show.current !== id) return
      stopBeat()
      await wait(r === 'wall' ? 420 : 300)
      if (show.current !== id) return
      startBeat(r, k)
      await along_(k, r, crux, 1, dur * 0.3, 'easeOut')
    } else await along_(k, r, 0, 1, dur, 'easeInOut')
    if (show.current !== id) return
    stopBeat()
    const top = outcome === 'summit'
    const path = top && l ? l.climb.path : (recRef.current?.climb.path ?? [])
    const m = multiplierOf(path)
    setRope(null)
    setPose('cheer')
    setLevel(k + 1)
    setVeil(false)
    if (!top) setPop({ id: Date.now(), k: k + 1, text: multText(m), color: LOOK[r].a })
    if (top) {
      setPlanted(true)
      summitSfx.summit()
      setSay(`The summit! ${multText(m)}: ${fmt(l?.payout ?? 0)} coins.`)
    } else {
      summitSfx.made(k + 1, r === 'cliff' || r === 'wall')
      setSay(`Made it to ${campName(k + 1)}: the climb is worth ${multText(m)}. Bank, or pick the next route.`)
    }
    if (!top) {
      // the next pitch can be chosen at once; the cheer plays on
      setPitch(null)
      later(800, () => show.current === id && setPose('stand'))
      await wait(420)
      return
    }
    await wait(1000)
    if (show.current !== id || !l) return
    setPitch(null)
    if (autoOn.current) {
      await wait(1100)
      if (show.current !== id) return
      finishEnd(l.id)
      return
    }
    setParty({ id: l.id, amount: l.payout, mult: m })
  }

  /** the ending is over: its card comes up */
  const finishEnd = (lid: string) => {
    const e = endRef.current
    if (!e || e.id !== lid || e.stage === 'done') return
    setEnd({ ...e, stage: 'done' })
    if (e.climb.state !== 'fell') void tween(alt, endAlt(e.climb.path.length), 700, 'easeInOut')
  }
  const partyDone = useCallback(() => {
    setParty(null)
    const e = endRef.current
    if (e && e.stage !== 'done') {
      setEnd({ ...e, stage: 'done' })
      animate(alt, endAlt(e.climb.path.length), { duration: 0.7, ease: 'easeInOut' })
    }
    // the ending is all this reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** a route chosen: the pitch is drawn now; a pitch that holds is stored first, one that ends the climb is paid first */
  function choose(r: RouteId): Promise<void> | null {
    if (busy()) return null
    const cur = current()
    if (!cur) return null
    const k = cur.climb.path.length
    const next = climb(cur.climb, r, pitchDraw())
    if (next === cur.climb) return null
    if (touch) setHover(null)
    cancelShow()
    const id = show.current
    setPop(null)
    setBurst(null)
    setVeil(true)
    if (next.state === 'up') {
      commit(cur, next)
      return playPitch(id, k, r, 'hold', null)
    }
    const how: How = next.state === 'fell' ? 'fell' : 'summit'
    const l = settleClimb(cur, next, keyRef.current, how)
    if (!l) {
      resync()
      return null
    }
    setRec(null)
    setEnd({ ...l, how, stage: 'anim' })
    return playPitch(id, k, r, how === 'fell' ? 'fall' : 'summit', l)
  }

  /** Bank: the climb is paid at its multiplier, at once, then the moment plays */
  function bankNow(): Promise<void> | null {
    if (busy()) return null
    const cur = current()
    if (!cur || !cur.climb.path.length) return null
    const c = bank(cur.climb)
    if (c === cur.climb) return null
    const l = settleClimb(cur, c, keyRef.current, 'bank')
    if (!l) {
      resync()
      return null
    }
    cancelShow()
    const id = show.current
    setRec(null)
    setEnd({ ...l, how: 'bank', stage: 'anim' })
    const k = c.path.length
    const m = multiplierOf(c.path)
    setPose('cheer')
    setPop({ id: Date.now(), k, text: `+${fmt(l.payout)}`, color: '#ffd45c' })
    summitSfx.bank(m)
    setSay(`Banked at ${campName(k)}: ${fmt(l.payout)} coins, ${multText(m)} your stake.`)
    return (async () => {
      await wait(1150)
      if (show.current !== id) return
      setPose('stand')
      finishEnd(l.id)
    })()
  }

  /* ---------------- auto ---------------- */

  /** one auto climb: start, the same route every pitch, bank at the first camp at or above the target */
  async function autoRound(): Promise<number | null> {
    if (autoStop.current) return null
    const s = start()
    if (!s) return null
    await wait(650)
    for (;;) {
      // stopped mid-climb: the climb is handed back to the player
      if (autoStop.current) return null
      const cur = recRef.current
      if (!cur || cur.id !== s.id) break
      if (cur.climb.path.length && multiplierOf(cur.climb.path) >= autoTargetRef.current) {
        const b = bankNow()
        if (!b) return null
        await b
        break
      }
      const p = choose(autoRouteRef.current)
      if (!p) return null
      await p
      await wait(180)
    }
    for (let i = 0; i < 80 && endRef.current?.id === s.id && endRef.current.stage !== 'done'; i++) await wait(100)
    const e = endRef.current
    if (!e || e.id !== s.id) return null
    return e.payout - e.stake
  }
  const auto = useAutoBet(autoRound, 700)
  autoOn.current = auto.running || autoOn.current
  useEffect(() => {
    if (!auto.running) autoOn.current = false
  }, [auto.running])
  function startAuto() {
    if (recRef.current || busy()) return
    if (useWallet.getState().balance < betRef.current) return toast(NO_COINS)
    autoStop.current = false
    autoOn.current = true
    void auto.start()
  }
  function stopAuto() {
    autoStop.current = true
    auto.stop()
  }
  const autoMin = multiplierOf([autoRoute])
  useEffect(() => {
    if (autoTarget < autoMin) setAutoTarget(autoMin)
  }, [autoMin, autoTarget])

  /** the main button (and Space): start a climb, or play again */
  function press() {
    if (recRef.current || busy() || auto.running) return
    start()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || info || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space' || (e.key === 'Enter' && tag !== 'BUTTON')) {
        e.preventDefault()
        if (e.repeat) return
        if (party) return partyDone()
        if (mode === 'auto' && !recRef.current) return auto.running ? undefined : startAuto()
        press()
      } else if (/^[1-4]$/.test(e.key)) {
        if (e.repeat || auto.running) return
        void choose(ROUTES[Number(e.key) - 1].id)
      } else if (e.key === 'b' || e.key === 'B') {
        if (e.repeat || auto.running) return
        void bankNow()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- what the screen reads ---------------- */

  const viewClimb: Climb | null = end ? end.climb : (rec?.climb ?? null)
  const viewPath = viewClimb?.path ?? []
  /** the camp the climber is at (or leaving) */
  const at = pitch ? pitch.k : viewPath.length
  const atPath = viewPath.slice(0, at)
  const atMult = multiplierOf(atPath)
  const moving = !!pitch
  const ending = !!end && end.stage !== 'done'
  // the climb as the player has seen it: while a pitch is on its way nothing about how it went shows
  const veiled = veil && !!pitch
  const seenPath = veiled ? viewPath.slice(0, pitch!.k) : viewPath
  const seenStake = rec ? rec.stake : end ? end.stake : bet
  const seenBank = seenPath.length ? payoutOf(seenStake, { path: seenPath, state: 'banked', fellOn: null }) : 0
  const canClimb = !!rec && !moving && !ending && !auto.running
  const options = canClimb ? rec.climb.path.length : !rec && !end ? 0 : null
  const bankAmount = rec && rec.climb.path.length ? payoutOf(rec.stake, bank(rec.climb)) : 0
  const narrow = !L.wide
  const broke = balance < bet
  const fellOn = veiled ? null : (end?.climb.fellOn ?? null)

  /* ---------------- panel ---------------- */

  let action: ReactNode
  if (veiled && !auto.running) {
    action = (
      <ActionButton tone="gold" disabled sub={`${LOOK[pitch!.r].doing}…`}>
        {seenPath.length ? (
          <>
            Bank {fmt(seenBank)} <Coin size={16} />
          </>
        ) : (
          'Climbing…'
        )}
      </ActionButton>
    )
  } else if (mode === 'auto' && (auto.running || !rec)) {
    action = auto.running ? (
      <ActionButton tone="danger" onClick={stopAuto} sub={rec ? 'The climb in progress is handed back to you' : auto.left != null ? `${auto.left} left` : 'until stopped'}>
        Stop auto
      </ActionButton>
    ) : (
      <ActionButton onClick={startAuto} disabled={broke || ending} sub={broke ? 'Not enough coins for this stake' : `${routeOf(autoRoute).name} · bank at ${multText(autoTarget)}`}>
        Start auto
      </ActionButton>
    )
  } else if (!rec && (!end || end.stage === 'done')) {
    action = broke ? (
      <ActionButton disabled sub="Lower your stake, or visit Rewards">
        Not enough coins
      </ActionButton>
    ) : (
      <ActionButton onClick={press} sub={`${fmt(bet)} stake · up to ${multText(MAX_MULT)}`}>
        {end ? 'Play again' : 'Start climb'}
      </ActionButton>
    )
  } else if (ending) {
    action = (
      <ActionButton tone="neutral" disabled sub={end!.how === 'fell' ? 'Down into the clouds' : end!.how === 'summit' ? 'All ten pitches' : 'Into the pouch'}>
        {end!.how === 'fell' ? 'Falling…' : end!.how === 'summit' ? 'Summit!' : 'Banking…'}
      </ActionButton>
    )
  } else if (rec && !rec.climb.path.length) {
    action = (
      <ActionButton tone="neutral" disabled sub="You can bank after the first pitch">
        Pick a route
      </ActionButton>
    )
  } else if (rec) {
    action = (
      <ActionButton tone="gold" onClick={() => void bankNow()} disabled={moving} sub={`${multText(multiplierOf(rec.climb.path))} at ${campName(rec.climb.path.length)}${touch ? '' : ' · B'}`}>
        Bank {fmt(bankAmount)} <Coin size={16} />
      </ActionButton>
    )
  }

  const historyItems = hist
    .filter((p) => !(end && end.id === p.id && (end.stage !== 'done' || veiled)))
    .reverse()
    .slice(0, 14)
    .map((p) => {
      const fell = p.how === 'fell'
      const top = !fell && p.path.length >= PITCHES
      return {
        key: p.id,
        tone: (fell ? 'loss' : p.mult >= 10 ? 'gold' : 'win') as PillTone,
        style: fell ? { background: '#2a1620', color: '#ff9aa8' } : undefined,
        label: (
          <span className="flex items-center gap-1" title={`${fell ? `Fell above ${campName(p.path.length)}` : `Banked at ${campName(p.path.length)}`} · ${p.path.length} pitch${p.path.length === 1 ? '' : 'es'} · ${fmt(p.payout)}`}>
            {top && <FlagMark size={11} color="#ffd45c" />}
            {fell ? `0× · ${p.path.length}` : multText(p.mult)}
          </span>
        ),
      }
    })

  const minTargets = [1.5, 2, 3, 5, 10, 25, 100].filter((t) => t >= autoMin)
  const pitchesFor = (() => {
    for (let n = 1; n <= PITCHES; n++) if (multiplierOf(Array<RouteId>(n).fill(autoRoute)) >= autoTarget) return n
    return null
  })()
  const autoTop = multiplierOf(Array<RouteId>(PITCHES).fill(autoRoute))

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={!!rec || auto.running || ending} />
      <div className="max-lg:order-[-1]">
        <BetInput value={bet} onChange={setBet} disabled={!!rec || auto.running || ending} />
      </div>
      {(rec || veiled) && (
        <div className="rounded-xl bg-stage p-3 ring-1 ring-white/[.04]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-semibold text-muted">Your climb</span>
            <span className="tnum flex items-center gap-1 text-[12px] font-bold text-ink">
              {fmt(seenStake)} <Coin size={13} />
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              ['At', seenPath.length ? campName(seenPath.length).replace('Camp ', 'C') : 'Base'],
              ['Worth', seenPath.length ? multText(multiplierOf(seenPath)) : '—'],
              ['Odds so far', seenPath.length ? oneIn(pathChance(seenPath)) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-panel2 px-1 py-1.5">
                <div className="text-[10.5px] font-semibold text-dim">{k}</div>
                <div className="tnum truncate text-[13.5px] font-extrabold">{v}</div>
              </div>
            ))}
          </div>
          {seenPath.length > 0 && (
            <div className="mt-2">
              <RouteChips climb={{ path: seenPath, state: 'up', fellOn: null }} small />
            </div>
          )}
        </div>
      )}
      {mode === 'auto' && (
        <>
          <div>
            <Label>Route every pitch</Label>
            <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Auto route">
              {ROUTES.map((r) => {
                const on = r.id === autoRoute
                return (
                  <button
                    key={r.id}
                    role="radio"
                    aria-checked={on}
                    disabled={auto.running}
                    onClick={() => (sfx.click(), setAutoRoute(r.id))}
                    className={`flex flex-col items-center gap-1 rounded-xl px-1 pb-1.5 pt-2 transition disabled:cursor-not-allowed ${on ? 'bg-raised ring-2' : 'bg-stage ring-1 ring-white/[.04] hover:bg-panel'} ${auto.running && !on ? 'opacity-45' : ''}`}
                    style={on ? { ['--tw-ring-color' as string]: LOOK[r.id].a } : undefined}
                  >
                    <RouteGlyph id={r.id} size={28} />
                    <span className={`text-[11.5px] font-extrabold leading-tight ${on ? 'text-ink' : 'text-muted'}`}>{r.id === 'wall' ? 'Wall' : r.name}</span>
                    <span className="tnum text-[10.5px] font-bold leading-none text-dim">{pct(r.p)}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <NumberField label="Bank at" right={`from ${multText(autoMin)}`} value={autoTarget} min={autoMin} max={MAX_MULT} disabled={auto.running} onCommit={setAutoTarget} suffix="×" />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {minTargets.slice(0, 5).map((t) => (
                <button key={t} disabled={auto.running} onClick={() => setAutoTarget(t)} className={`tnum h-8 rounded-lg px-2.5 text-[12px] font-bold transition disabled:opacity-50 ${autoTarget === t ? 'bg-hover text-ink' : 'bg-raised text-muted hover:text-ink'}`}>
                  {multText(t)}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11.5px] font-semibold leading-snug text-dim">
              {pitchesFor
                ? `${routeOf(autoRoute).name} reaches ${multText(multiplierOf(Array<RouteId>(pitchesFor).fill(autoRoute)))} at ${campName(pitchesFor)}: ${oneIn(routeOf(autoRoute).p ** pitchesFor)} climbs get there.`
                : `${routeOf(autoRoute).name} tops out at ${multText(autoTop)} on the summit: auto banks there (${oneIn(routeOf(autoRoute).p ** PITCHES)} climbs).`}
            </p>
          </div>
          <AutoSettings auto={auto} />
        </>
      )}
      {mode === 'manual' && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
            <span>The routes</span>
            <button onClick={() => (sfx.click(), setInfo(true))} className="text-dim transition hover:text-ink">
              How it works · return
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {ROUTES.map((r, i) => (
              <div key={r.id} className="flex items-center gap-2.5 rounded-lg bg-stage px-2 py-1.5">
                <RouteGlyph id={r.id} size={26} />
                <div className="min-w-0 flex-1 leading-tight">
                  <div className="text-[12.5px] font-extrabold" style={{ color: LOOK[r.id].a }}>
                    {r.name}
                  </div>
                  <div className="truncate text-[11px] font-semibold text-dim">{r.line}</div>
                </div>
                <div className="tnum text-right leading-tight">
                  <div className="text-[12.5px] font-extrabold text-ink">{pct(r.p)}</div>
                  <div className="text-[10.5px] font-bold text-dim">×{(1 / r.p).toFixed(2)} a pitch</div>
                </div>
                {!touch && <kbd className="hidden h-5 min-w-5 items-center justify-center rounded bg-raised px-1 text-[10.5px] font-black text-muted lg:flex">{i + 1}</kbd>}
              </div>
            ))}
          </div>
        </div>
      )}
      {historyItems.length > 0 && (
        <div>
          <Label>Recent climbs</Label>
          <HistoryPills items={historyItems} className="flex-wrap" />
        </div>
      )}
      <div className="flex flex-col gap-2 max-lg:order-[-3] lg:sticky lg:bottom-0 lg:z-10 lg:order-last lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">{action}</div>
      <p className="hidden text-[11px] leading-relaxed text-dim lg:block">Keys: 1 to 4 pick a route, B banks, Space starts a climb. Returns {pct(0.97)} whatever you climb, up to the {multText(MAX_MULT)} cap.</p>
    </>
  )

  /* ---------------- stage ---------------- */

  const statusText = (() => {
    if (veiled) return `${LOOK[pitch!.r].doing}…`
    if (party) return 'The summit!'
    if (end) {
      if (end.stage !== 'done') return end.how === 'fell' ? `${LOOK[end.climb.fellOn ?? 'trail'].gives}!` : end.how === 'summit' ? 'Going for the summit…' : 'Banked!'
      return end.how === 'fell' ? 'The climb is lost' : end.climb.path.length >= PITCHES ? 'You made the summit!' : `Banked at ${campName(end.climb.path.length)}`
    }
    if (pitch) return `${LOOK[pitch.r].doing}…`
    if (rec && !auto.running && multiplierOf(rec.climb.path) >= MAX_MULT) return `At the ${multText(MAX_MULT)} cap: climbing on can't pay more`
    if (rec) return auto.running ? `Auto: ${routeOf(autoRoute).name}, banking at ${multText(autoTarget)}` : rec.climb.path.length ? `Pick a route to ${campName(rec.climb.path.length + 1)}, or bank` : 'Pick your route to Camp 1'
    if (mode === 'auto') return `Auto: ${routeOf(autoRoute).name} every pitch, banking at ${multText(autoTarget)}`
    return narrow ? 'Set your stake, then Start climb' : 'Set your stake, then Start climb (Space)'
  })()

  let big: { kind: BigKind; title: ReactNode; amount?: number; sub?: ReactNode; onClick?: () => void; disabled?: boolean }
  if (veiled && !auto.running) big = { kind: seenPath.length ? 'bank' : 'wait', title: seenPath.length ? 'Bank' : 'Climbing…', amount: seenPath.length ? seenBank : undefined, sub: seenPath.length ? `${multText(multiplierOf(seenPath))} · ${campName(seenPath.length)}` : undefined, disabled: true }
  else if (auto.running) big = { kind: 'stop', title: 'Stop auto', sub: auto.left != null ? `${auto.left} left` : 'until stopped', onClick: stopAuto }
  else if (!rec && (!end || end.stage === 'done')) big = broke ? { kind: 'wait', title: 'Not enough coins', disabled: true } : mode === 'auto' ? { kind: 'start', title: 'Start auto', sub: `${routeOf(autoRoute).name} · ${multText(autoTarget)}`, onClick: startAuto } : { kind: 'start', title: end ? 'Play again' : 'Start climb', sub: `${fmt(bet)} stake`, onClick: press }
  else if (ending) big = { kind: 'wait', title: end!.how === 'fell' ? 'Falling…' : end!.how === 'summit' ? 'Summit!' : 'Banked', amount: end!.how === 'fell' ? undefined : end!.payout, disabled: true }
  else if (rec && !rec.climb.path.length) big = { kind: 'wait', title: 'Bank', sub: 'after the first pitch', disabled: true }
  else big = { kind: 'bank', title: 'Bank', amount: bankAmount, sub: `${multText(multiplierOf(rec!.climb.path))} · ${campName(rec!.climb.path.length)}${touch ? '' : ' · B'}`, onClick: () => void bankNow(), disabled: moving }

  const deck = L.deck
  const bigW = L.wide ? Math.round(clamp(deck.w * 0.2, 168, 210)) : 0
  const sceneW = L.ladder.x - L.pad
  const cardW = Math.min(L.wide ? 400 : 330, sceneW - 2 * L.pad)
  const endCard =
    end && end.stage === 'done' && !party ? (
      <EndCard
        how={end.how}
        stake={end.stake}
        climb={end.climb}
        payout={end.payout}
        narrow={narrow}
        action={
          mode === 'auto' ? null : broke ? (
            <ActionButton disabled sub="Lower your stake, or visit Rewards">
              Not enough coins
            </ActionButton>
          ) : (
            <ActionButton onClick={press} sub={`${fmt(bet)} stake${touch ? '' : ' · Space'}`}>
              Play again
            </ActionButton>
          )
        }
      />
    ) : null

  const stage = (
    <div ref={stageRef} className="absolute inset-0 overflow-hidden bg-[#0b1630]">
      <Scene
        L={L}
        alt={alt}
        path={viewPath}
        options={options}
        hover={canClimb || options === 0 ? hover : null}
        active={pitch ? { k: pitch.k, r: pitch.r } : null}
        reached={at}
        planted={planted}
        climber={{ x: cx, y: cy, spin, fade, pose, face }}
        rope={rope}
        burst={burst}
        pop={pop}
        level={level}
        clear={planted}
      />

      {/* the top bar: where the climber is, what the climb is worth, help */}
      <div className="absolute z-20 flex items-center gap-2" style={{ left: L.pad, top: L.pad, height: L.topH, maxWidth: sceneW - 50 }}>
        <div className={`flex items-center gap-2.5 rounded-full bg-[#060c1a]/70 ring-1 ring-white/10 backdrop-blur-sm ${narrow ? 'py-1 pl-2.5 pr-3' : 'py-1.5 pl-3 pr-4'}`}>
          <span className={`font-black uppercase tracking-[0.14em] text-white/55 ${narrow ? 'text-[9.5px]' : 'text-[11px]'}`}>
            {campName(at)} · {altText(at)}
          </span>
          <span className={`tnum font-black ${narrow ? 'text-[14px]' : 'text-[17px]'} ${at ? 'text-gold' : 'text-white/45'}`}>{at ? multText(atMult) : narrow ? '—' : 'Ten pitches up'}</span>
        </div>
      </div>
      {L.wide && (
        <div className="pointer-events-none absolute z-20 flex justify-center" style={{ left: L.pad + 250, width: Math.max(0, sceneW - 260 - L.pad), top: L.pad + 4 }}>
          <AnimatePresence mode="wait">
            <motion.div key={statusText} className="truncate rounded-full bg-[#060c1a]/70 px-4 py-2 text-[13px] font-extrabold text-white ring-1 ring-white/10 backdrop-blur-sm" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
              {statusText}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      <button
        onClick={() => (sfx.click(), setInfo(true))}
        aria-label="How Summit works"
        className="absolute z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#060c1a]/70 text-[15px] font-black text-white/80 ring-1 ring-white/15 transition hover:bg-black/70 hover:text-white"
        style={{ right: L.pad, top: L.pad + (L.topH - 36) / 2 }}
      >
        ?
      </button>

      <Ladder L={L} path={seenPath} at={at} fellOn={fellOn} hover={canClimb ? hover : null} choosing={canClimb} />

      {/* the deck: the big button and the four routes */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[18]" style={{ height: L.h - deck.y + 34, background: 'linear-gradient(to bottom, transparent, rgba(6,11,24,.72) 38%, rgba(6,11,24,.92))' }} />
      {narrow && (
        <div className="pointer-events-none absolute z-20 flex justify-center" style={{ left: L.pad, width: sceneW - L.pad, top: deck.y - 24 }}>
          <AnimatePresence mode="wait">
            <motion.span key={statusText} className="truncate text-[12px] font-extrabold text-white [text-shadow:0_1px_3px_rgba(0,0,0,.9)]" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
              {statusText}
            </motion.span>
          </AnimatePresence>
        </div>
      )}
      <div className="absolute z-20 flex" style={{ left: deck.x, top: deck.y, width: deck.w, height: deck.h, gap: L.wide ? 10 : 6 }}>
        {L.wide && (
          <div className="shrink-0" style={{ width: bigW }}>
            <BigButton {...big} />
          </div>
        )}
        {ROUTES.map((r, i) => (
          <RouteCard
            key={r.id}
            r={r.id}
            i={i}
            path={veiled ? seenPath : rec ? rec.climb.path : []}
            stake={rec || veiled ? seenStake : bet}
            enabled={canClimb}
            hot={(hover === r.id && (canClimb || options === 0)) || (auto.running && autoRoute === r.id)}
            narrow={narrow}
            keys={!touch}
            onPick={(x) => void choose(x)}
            onHover={(x) => {
              if (x && x !== hover && canClimb) summitSfx.pick(ROUTES.findIndex((q) => q.id === x))
              setHover(x)
            }}
          />
        ))}
      </div>

      {/* the ending */}
      <AnimatePresence>
        {endCard && (
          <motion.div key={`end${end!.id}`} className="absolute z-30" style={{ left: L.pad + (sceneW - L.pad - cardW) / 2, top: L.pad + L.topH + (narrow ? 4 : 14), width: cardW }} initial={{ opacity: 0, y: -24, scale: 0.92 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -12, transition: { duration: 0.2 } }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
            {endCard}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{party && <SummitParty key={party.id} amount={party.amount} mult={party.mult} narrow={narrow} onDone={partyDone} />}</AnimatePresence>
      <AnimatePresence>
        {note && !endCard && !party && (
          <motion.div
            key={note.id}
            className="pointer-events-none absolute z-[40] -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-3.5 py-1.5 text-[12px] font-bold text-white ring-1 ring-white/10 backdrop-blur-sm sm:text-[13px]"
            style={{ left: sceneW / 2 + L.pad / 2, top: L.pad + L.topH + 6 }}
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
