import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Toggle, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { fmt } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx, useMuted } from '../../lib/sound'
import { safeStorage } from '../../lib/storage'
import { useSize } from '../../lib/useSize'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import Machine from './Machine'
import { DropPlanner } from './planner'
import { newField } from './field'
import { MAX_MULT, drawDrop, itemsOf, metaOf, payoutOf, resultOf } from './rules'
import {
  LIVE_MS,
  addHistory,
  beat,
  clearNotice,
  fieldKey,
  histKey,
  holdsPending,
  loadAim,
  loadHistory,
  loadTurbo,
  newId,
  pastOf,
  pendingAge,
  pendingKey,
  readField,
  releasePending,
  saveAim,
  saveField,
  saveNotice,
  savePending,
  saveTurbo,
  takeNotice,
  takePending,
  type PastDrop,
  type PendingDrop,
} from './storage'
import { pusherSfx } from './sound'
import { AimBar, AutoStops, FieldStrip, Paytable, aimText, type Stops } from './Panel'
import { Burst, Callout, Flash, HudStyles, Party, Roller, WinBanner, WinDisplay, type BannerInfo, type PartyInfo } from './Hud'
import { InfoModal } from './Info'
import { FeatureMark, ItemGlyph } from './art'
import { VALUE, type DropResult, type Feature, type Field, type ItemKind, type Run, type RunEvent } from './types'
import { FEATURE_NAME, bestOf, fellText, headline, isPrize, multText, tierOf } from './words'

/*
  Coin Cascade: a neon coin pusher. Set a stake, aim along the slot and press Drop: the coin falls onto the upper tier,
  the pushers shove the field, and whatever tips over the front edge lands in the tray and pays (a silver coin a
  quarter of the stake, a gold coin the stake, a gem 5×, a gold bar 25×, the Golden Idol 100×, the Crown 500×). Now and
  then the hopper tips for a Coin Shower, or the machine shudders in a Quake.

  A drop, start to finish. The result is drawn first (rules.ts drawDrop with the browser's crypto RNG: what goes over
  the edge, and any Shower or Quake, at exact odds returning 97%), then the drop is worked out on the physics so that
  exactly that goes over (sim.ts runDrop, in a worker: planner.ts), from the field as storage holds it and with a seed
  drawn the same way. Only then is the stake taken, and in the same moment the drop is stored as pending (its bet,
  payout, meta and the field it leaves), before anything moves; then the machine (Machine.tsx) plays it. The page
  follows the machine's moments: the counter in the cabinet's display rolls up as things land in the tray, the
  sounds, COIN SHOWER! and QUAKE!, and once the last thing is in the tray the drop is paid (settled once, with the
  wallet) and its banner rises; the Golden Idol and the Crown get the whole stage. A drop with nothing to come is paid
  as the machine stops. Where the player aims changes where their coin lands, never what the drop pays.

  The money is LuckyClaw's pending flow, with Bullseye's guard for a second tab (storage.ts): a drop is paid exactly
  once, when its last thing lands, or at once if the page is hidden, left or closed mid-drop (a note then tells the
  next visit what it paid), and a drop whose page died is paid on the next visit, flagged recovered. The player's
  field is saved as the drop is paid (its `after`), so a reload shows the machine as it was. One drop at a time, in
  every tab: a drop still playing in another tab is left alone and blocks a new one until it is paid.

  Dev hooks (dev builds only): window.__pusherForce = { wins, feature } forces the next drop's result (an array of
  them forces the next drops one by one); window.__pusherSpeed = 4 plays drops four times faster.
*/

const TURBO_SPEED = 2.5
const HURRY_SPEED = 4
const NO_COINS = 'Not enough coins. Visit Rewards to earn more.'
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/* ---------------- dev: forced results, faster drops ---------------- */

type Force = { wins?: Partial<Record<ItemKind, number>>; feature?: Feature }
function forced(r: DropResult): DropResult {
  const w = window as unknown as { __pusherForce?: Force | Force[] }
  let f = w.__pusherForce
  if (!f) return r
  if (Array.isArray(f)) {
    f = f.shift()
    if (!(w.__pusherForce as Force[]).length) delete w.__pusherForce
  } else delete w.__pusherForce
  return f && typeof f === 'object' ? resultOf(f.wins ?? {}, f.feature ?? 'none') : r
}
function devSpeed(): number {
  if (import.meta.env.DEV) {
    const s = (window as unknown as { __pusherSpeed?: unknown }).__pusherSpeed
    if (typeof s === 'number' && s > 0) return s
  }
  return 1
}

/** the frame from which the pushers stand parked to the end of the run */
function parkFrame(run: Run): number {
  const p = run.pushers
  const n = run.frames
  const u = p[(n - 1) * 2]
  const l = p[(n - 1) * 2 + 1]
  for (let f = n - 1; f >= 0; f--) if (Math.abs(p[f * 2] - u) > 1e-4 || Math.abs(p[f * 2 + 1] - l) > 1e-4) return f + 1
  return 0
}

/** the drop on show */
interface Cur {
  id: string
  run: Run
  result: DropResult
  bet: number
  payout: number
  /** things still to land in the tray */
  left: number
  /** what has landed so far, times the stake */
  m: number
  /** a prize has landed */
  prized: boolean
  /** the last thing is in (or nothing was to come): the result is out and paid */
  ended: boolean
  /** the frame the pushers park at */
  park: number
  resolve: (net: number) => void
}

/** the drop staked and stored, until it is paid */
interface Live {
  key: string
  fkey: string
  hkey: string
  uid: string | null
  rec: PendingDrop
}

export default function CoinCascade() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const betRef = useRef(bet)
  betRef.current = bet
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurboState] = useState(loadTurbo)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const [aim, setAimState] = useState(loadAim)
  const aimRef = useRef(aim)
  aimRef.current = aim
  const [stops, setStops] = useState<Stops>({ win: 0, prize: true })
  const stopsRef = useRef(stops)
  stopsRef.current = stops

  // the player's machine: the field on show, and the key it is kept under with how storage last had it
  const shelf = useRef<{ key: string; raw: string | null }>({ key: '', raw: null })
  const [field, setFieldState] = useState<Field>(() => {
    const key = fieldKey(useAuth.getState().uid)
    const r = readField(key)
    if (r) {
      shelf.current = { key, raw: r.raw }
      return r.field
    }
    const f = newField()
    shelf.current = { key, raw: saveField(key, f) }
    return f
  })
  const fieldRef = useRef(field)
  const showField = (f: Field) => {
    fieldRef.current = f
    setFieldState(f)
  }

  const [play, setPlay] = useState<{ run: Run; speed: number; key: string } | null>(null)
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false)
  const setBusy = (b: boolean) => {
    busyRef.current = b
    setBusyState(b)
  }
  const [hurry, setHurryState] = useState(false)
  const hurryRef = useRef(false)
  const setHurry = (h: boolean) => {
    hurryRef.current = h
    setHurryState(h)
  }
  const [hist, setHist] = useState<PastDrop[]>(() => loadHistory(histKey(useAuth.getState().uid)))
  /** the drop in play, kept out of the history until it has played */
  const [hideId, setHideId] = useState<string | null>(null)
  const [banner, setBanner] = useState<BannerInfo | null>(null)
  const [callout, setCallout] = useState<{ id: number; kind: 'shower' | 'quake' } | null>(null)
  const [party, setPartyState] = useState<PartyInfo | null>(null)
  const partyRef = useRef<PartyInfo | null>(null)
  const setParty = (p: PartyInfo | null) => {
    partyRef.current = p
    setPartyState(p)
  }
  const [burst, setBurst] = useState<{ id: number; big: boolean } | null>(null)
  const [flash, setFlash] = useState(0)
  const [gone, setGone] = useState<ReadonlySet<number>>(() => new Set())
  const [fresh, setFresh] = useState<ReadonlySet<number>>(() => new Set())
  const [info, setInfo] = useState(false)
  const [note, setNote] = useState<{ id: number; text: string } | null>(null)
  const [say, setSay] = useState('')

  const [stageRef, size] = useSize<HTMLDivElement>()
  const compact = size.w < 640

  const alive = useRef(true)
  const cur = useRef<Cur | null>(null)
  const pending = useRef<Live | null>(null)
  /** the drop in play was paid as the page began to leave */
  const paidOnHide = useRef(false)
  const planner = useRef<DropPlanner | null>(null)
  const [roller] = useState(() => new Roller())
  const timers = useRef<number[]>([])
  const seq = useRef(1)
  /** the auto run waits on a celebration still up */
  const partyWait = useRef<(() => void) | null>(null)
  const autoOn = useRef(false)
  const autoStop = useRef(false)

  const later = (ms: number, fn: () => void) => {
    timers.current.push(window.setTimeout(() => alive.current && fn(), ms))
  }
  const toast = (title: string, amount?: number) => useWallet.getState().pushToast(amount != null && amount > 0 ? { kind: 'win', title, amount } : { kind: 'info', title })
  const flashNote = (text: string) => {
    const id = seq.current++
    setNote({ id, text })
    later(2800, () => setNote((n) => (n && n.id === id ? null : n)))
  }

  /* ---------------- the field ---------------- */

  /** the player's field as storage holds it now (another tab may have dropped since): shown, and returned */
  const currentField = (): Field => {
    const s = shelf.current
    const r = readField(s.key)
    if (r && r.raw !== s.raw) {
      s.raw = r.raw
      showField(r.field)
    }
    return fieldRef.current
  }
  /** whether storage's field is not the one this page last read or wrote */
  const fieldMoved = () => {
    const raw = safeStorage.getItem(shelf.current.key)
    return raw != null && raw !== shelf.current.raw
  }
  /** the signed-in player's machine and history (signing in or out switches to theirs, once no drop is playing) */
  const syncPlayer = () => {
    if (busyRef.current) return
    const u = useAuth.getState().uid
    const key = fieldKey(u)
    if (key === shelf.current.key) return
    const r = readField(key)
    if (r) {
      shelf.current = { key, raw: r.raw }
      showField(r.field)
    } else {
      const f = newField()
      shelf.current = { key, raw: saveField(key, f) }
      showField(f)
    }
    setHist(loadHistory(histKey(u)))
    setGone(new Set())
    setFresh(new Set())
  }

  /* ---------------- money ---------------- */

  /**
   * Pays the drop in play, once: when its last thing lands in the tray, or as soon as the page is hidden or left (it
   * is decided). The field it leaves becomes the player's and it goes into the history. A drop another tab already
   * took and paid is not paid again: null then, as when there is none.
   */
  const settlePending = (): PendingDrop | null => {
    const p = pending.current
    if (!p) return null
    pending.current = null
    if (!releasePending(p.key, p.rec.id)) return null
    useWallet.getState().settle({ game: 'pusher', bet: p.rec.bet, payout: p.rec.payout, meta: p.rec.meta })
    const raw = saveField(p.fkey, p.rec.after)
    if (shelf.current.key === p.fkey) shelf.current.raw = raw
    const h = addHistory(p.hkey, pastOf(p.rec))
    if (alive.current && p.hkey === histKey(useAuth.getState().uid)) setHist(h)
    return p.rec
  }

  /** a drop a page left unpaid (the page died mid-drop) is paid now, flagged recovered; one still beating is left to its page */
  const recoverTimer = useRef(0)
  const recover = () => {
    clearTimeout(recoverTimer.current)
    if (pending.current || !alive.current || useAuth.getState().status === 'loading') return
    const u = useAuth.getState().uid
    const key = pendingKey(u)
    const age = pendingAge(key)
    if (age == null) return
    if (age < LIVE_MS) {
      recoverTimer.current = window.setTimeout(recover, LIVE_MS - age + 300)
      return
    }
    const p = takePending(key)
    if (!p) return
    useWallet.getState().settle({ game: 'pusher', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.after) {
      const fk = fieldKey(u)
      const raw = saveField(fk, p.after)
      if (!busyRef.current && shelf.current.key === fk) {
        shelf.current.raw = raw
        showField(p.after)
      }
    }
    setHist(addHistory(histKey(u), pastOf(p)))
    const what = p.payout > 0 ? ` (${fellText(p.wins)})` : ''
    if (p.payout > 0) toast(`Your unfinished Coin Cascade drop paid out${what}`, p.payout)
    else toast("Your unfinished Coin Cascade drop didn't pay")
  }
  const recoverRef = useRef(recover)
  recoverRef.current = recover

  // A drop paid as the page was left is announced on the next visit; one whose page went away before it could pay is
  // paid now, once sign-in has settled so it lands in the wallet that took the stake.
  useEffect(() => {
    if (authStatus === 'loading') return
    const n = takeNotice(uid)
    if (n) {
      if (n.amount > 0) toast(`Your last Coin Cascade drop (${multText(n.mult)}) paid out when you left`, n.amount)
      else toast("Your last Coin Cascade drop didn't pay")
    }
    recoverRef.current()
    syncPlayer()
    // the helpers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus, uid])

  /* ---------------- the page's life ---------------- */

  useEffect(() => {
    alive.current = true
    planner.current = new DropPlanner()
    // closing the tab, reloading or going to another site mid-drop pays it on the way out; the next visit says so
    const onLeave = () => {
      const p = pending.current
      const r = settlePending()
      if (!r || !p) return
      paidOnHide.current = true
      saveNotice(p.uid, { amount: r.payout, mult: r.mult })
    }
    // hiding the page mid-drop pays it at once (the machine waits, and plays the rest when the page is back)
    const onVis = () => {
      if (document.hidden) {
        settlePending()
        pauseClock()
      } else resumeClock()
    }
    // while a drop plays, its heartbeat tells other tabs it is live (and stops if one of them took it)
    const beating = window.setInterval(() => {
      const p = pending.current
      if (p && holdsPending(p.key, p.rec.id)) beat(p.key, p.rec.id)
    }, 1000)
    // another tab's drop moved the machine, or added to the history: follow it while nothing plays here
    const onStorage = (e: StorageEvent) => {
      if (busyRef.current) return
      const s = shelf.current
      if (e.key === null || e.key === s.key) {
        const r = readField(s.key)
        if (r && r.raw !== s.raw) {
          s.raw = r.raw
          showField(r.field)
          setGone(new Set())
          setFresh(new Set())
        }
      }
      const hk = histKey(useAuth.getState().uid)
      if (e.key === null || e.key === hk) setHist(loadHistory(hk))
    }
    window.addEventListener('beforeunload', onLeave)
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('storage', onStorage)
    return () => {
      alive.current = false
      autoStop.current = true
      clearInterval(beating)
      clearTimeout(recoverTimer.current)
      window.removeEventListener('beforeunload', onLeave)
      window.removeEventListener('pagehide', onLeave)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('storage', onStorage)
      timers.current.forEach(clearTimeout)
      timers.current = []
      stopHum()
      planner.current?.dispose()
      planner.current = null
      roller.dispose()
      // leaving the page mid-drop pays the drop at once, and says what it came to
      const r = settlePending()
      if (r) {
        if (r.payout > 0) toast(`Your Coin Cascade drop (${multText(r.mult)}) paid out as you left`, r.payout)
        else toast("Your Coin Cascade drop didn't pay")
      }
    }
    // the handlers only read refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the machine's clock: the pushers' hum runs until they park ---------------- */

  const hum = useRef<(() => void) | null>(null)
  const humTimer = useRef(0)
  /** where the drop in play is: the last frame heard, when, and how fast it has played since (0 while paused) */
  const clock = useRef({ f: 0, at: 0, speed: 1 })
  const speedNow = () => (hurryRef.current ? HURRY_SPEED : turboRef.current ? TURBO_SPEED : 1) * devSpeed()
  const frameNow = () => {
    const k = clock.current
    const step = cur.current?.run.step ?? 1 / 30
    return k.f + ((performance.now() - k.at) / 1000) * (k.speed / step)
  }
  const setClock = (f: number, speed: number) => {
    clock.current = { f, at: performance.now(), speed }
  }
  function stopHum() {
    clearTimeout(humTimer.current)
    hum.current?.()
    hum.current = null
  }
  /** the hum runs (at the speed of play) while the pushers do, and stops as they park */
  const armHum = () => {
    clearTimeout(humTimer.current)
    const c = cur.current
    const k = clock.current
    if (!c || !k.speed || document.hidden) return stopHum()
    const left = c.park - frameNow()
    if (left <= 0) return stopHum()
    if (!hum.current) hum.current = pusherSfx.hum(k.speed)
    humTimer.current = window.setTimeout(stopHum, ((left * c.run.step) / k.speed) * 1000)
  }
  function pauseClock() {
    if (!cur.current) return
    setClock(frameNow(), 0)
    stopHum()
  }
  function resumeClock() {
    if (!cur.current) return
    setClock(clock.current.f, speedNow())
    if (clock.current.f > 0) armHum()
  }

  // the site's mute silences the hum at once (every other sound checks it as it plays)
  const muted = useMuted()
  useEffect(() => {
    if (muted) stopHum()
  }, [muted])

  // turbo or a hurry: the drop in play speeds up too
  useEffect(() => {
    const s = speedNow()
    setPlay((p) => (p && p.speed !== s ? { ...p, speed: s } : p))
    if (cur.current && clock.current.speed) {
      setClock(frameNow(), s)
      if (hum.current) {
        stopHum()
        armHum()
      }
    }
    // the speed is all this follows
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turbo, hurry])

  /* ---------------- a drop ---------------- */

  /** one drop at a time, in every tab: one still playing elsewhere is left to finish, an unfinished one is paid first */
  const clearToDrop = (pkey: string) => {
    const age = pendingAge(pkey)
    if (age == null) return true
    if (age < LIVE_MS) {
      flashNote('A drop is still playing in another tab')
      return false
    }
    recoverRef.current()
    if (pendingAge(pkey) == null) return true
    flashNote('One moment…')
    return false
  }

  /** a drop, start to finish: resolves with what it won less the stake once it has played, or null if it couldn't be made */
  async function drop(): Promise<number | null> {
    if (busyRef.current || !alive.current) return null
    const amount = betRef.current
    if (useWallet.getState().balance < amount) {
      toast(NO_COINS)
      return null
    }
    const u = useAuth.getState().uid
    const pkey = pendingKey(u)
    if (!clearToDrop(pkey)) return null
    syncPlayer()
    setBusy(true)
    const free = () => {
      if (alive.current) setBusy(false)
    }
    // the result first, then the drop that shows it, worked out from the field as storage holds it
    const start = currentField()
    let result = drawDrop(rand())
    if (import.meta.env.DEV) result = forced(result)
    const seed = rand()
    const a = aimRef.current
    let run: Run
    try {
      run = await planner.current!.plan(start, result, a, seed)
    } catch {
      if (alive.current) toast('The machine jammed: nothing was staked. Try again.')
      free()
      return null
    }
    if (!alive.current) return null
    // meanwhile another tab may have started a drop or moved the machine, or the player signed in or out: nothing is staked
    if (useAuth.getState().uid !== u || !clearToDrop(pkey) || fieldMoved()) {
      if (useAuth.getState().uid === u && fieldMoved()) flashNote('The machine moved in another tab: drop again')
      free()
      return null
    }
    if (!stake(amount)) {
      free()
      return null
    }
    // staked: stored before anything moves (the stake's write goes first: storage writes the wallet ahead of it)
    const payout = payoutOf(amount, result)
    const id = newId()
    const rec: PendingDrop = { v: 1, id, bet: amount, payout, meta: metaOf(result), mult: result.mult, wins: { ...result.wins }, feature: result.feature, after: run.after, t: Date.now() }
    pending.current = { key: pkey, fkey: shelf.current.key, hkey: histKey(u), uid: u, rec }
    savePending(pkey, rec)
    paidOnHide.current = false

    // the drop plays
    pusherSfx.insert()
    timers.current.forEach(clearTimeout)
    timers.current = []
    setBanner(null)
    setCallout(null)
    setBurst(null)
    closeParty()
    setGone(new Set())
    setFresh(new Set())
    setHurry(false)
    setHideId(id)
    roller.snap(0)
    roller.mood('idle')
    const speed = speedNow()
    setClock(0, document.hidden ? 0 : speed)
    setSay(`Coin in: ${fmt(amount)} staked, aimed ${aimText(a).toLowerCase()}.`)
    const done = new Promise<number>((resolve) => {
      cur.current = { id, run, result, bet: amount, payout, left: itemsOf(result.wins), m: 0, prized: false, ended: false, park: parkFrame(run), resolve }
    })
    setPlay({ run, speed, key: id })
    // a page hidden as its drop begins pays it at once
    if (document.hidden) settlePending()
    return done
  }

  /** the machine's moments, as it plays them */
  const onEvent = (e: RunEvent) => {
    const c = cur.current
    if (!c || !alive.current) return
    if (clock.current.speed) setClock(e.f, clock.current.speed)
    switch (e.kind) {
      case 'drop':
        pusherSfx.drop()
        armHum()
        break
      case 'land':
        pusherSfx.land(e.item)
        break
      case 'edge':
        pusherSfx.spill(e.item)
        if (isPrize(e.item)) setGone((s) => new Set(s).add(e.id))
        break
      case 'tray': {
        c.m += VALUE[e.item]
        c.left--
        const shown = c.left <= 0 ? c.payout : Math.floor(c.bet * c.m * 100 + 1e-6) / 100
        roller.to(shown)
        pusherSfx.tray(e.item, c.m)
        if (isPrize(e.item)) {
          c.prized = true
          pusherSfx.fanfare(e.item)
          roller.mood('prize')
          setBurst({ id: seq.current++, big: e.item !== 'gem' })
          if (e.item !== 'gem') setFlash((f) => f + 1)
        } else if (c.m >= 1 && !c.prized) roller.mood('win')
        if (c.left <= 0) finish(c)
        break
      }
      case 'gutter':
        pusherSfx.gutter()
        break
      case 'shower':
      case 'quake': {
        const id = seq.current++
        setCallout({ id, kind: e.kind })
        if (e.kind === 'shower') pusherSfx.shower()
        else pusherSfx.quake()
        setSay(e.kind === 'shower' ? 'Coin Shower! The hopper pours.' : 'Quake! The machine shudders.')
        later(1700 / Math.min(2, Math.max(1, speedNow() * 0.7)), () => setCallout((x) => (x && x.id === id ? null : x)))
        break
      }
      case 'feed':
        pusherSfx.feed()
        break
      case 'restock':
        pusherSfx.restock()
        setFresh((s) => new Set(s).add(e.id))
        break
    }
    if (e.f >= c.park) stopHum()
  }

  /** the last thing is in the tray (or the machine has stopped with nothing to come): the drop is paid and its result shown */
  function finish(c: Cur) {
    if (c.ended) return
    c.ended = true
    // a no-op if the page paid it already (it was hidden mid-drop)
    settlePending()
    // a drop paid as the page began to leave, on a page that stayed: the player sees it now, no note needed
    if (paidOnHide.current) {
      paidOnHide.current = false
      clearNotice(useAuth.getState().uid)
    }
    roller.to(c.payout)
    const r = c.result
    const tier = tierOf(r)
    if (c.payout > 0) {
      if (tier >= 4) setParty({ id: c.id, wins: r.wins, mult: r.mult, amount: c.payout, feature: r.feature })
      else {
        const b: BannerInfo = { id: c.id, wins: r.wins, mult: r.mult, feature: r.feature, amount: c.payout }
        setBanner(b)
        later(tier >= 2 ? (turboRef.current || autoOn.current ? 2000 : 3200) : turboRef.current || autoOn.current ? 1300 : 2200, () => setBanner((x) => (x && x.id === b.id ? null : x)))
        if (tier === 1) pusherSfx.win(r.mult)
      }
    }
    const line = c.payout > 0 ? `${r.feature !== 'none' ? `${FEATURE_NAME[r.feature]}! ` : ''}Over the edge: ${fellText(r.wins)}. You won ${fmt(c.payout)}, ${multText(r.mult)} your stake.` : 'Nothing went over the edge this time.'
    setSay(tier >= 2 ? `${headline(r)} ${line}` : line)
    // Auto's stops
    if (autoOn.current) {
      const st = stopsRef.current
      const prize = r.wins.gem + r.wins.bar + r.wins.idol + r.wins.crown > 0
      if ((st.win > 0 && r.mult >= st.win) || (st.prize && prize)) stopAuto()
    }
  }

  /** the machine has played the drop to its last frame */
  const onDone = (key: string) => {
    const c = cur.current
    if (!c || c.id !== key) return
    finish(c)
    stopHum()
    cur.current = null
    showField(c.run.after)
    setPlay(null)
    setHideId(null)
    setHurry(false)
    setBusy(false)
    syncPlayer()
    const net = c.payout - c.bet
    if (partyRef.current) partyWait.current = () => c.resolve(net)
    else c.resolve(net)
  }

  const closeParty = useCallback(() => {
    setParty(null)
    const w = partyWait.current
    partyWait.current = null
    w?.()
  }, [])

  const hurryNow = () => {
    if (cur.current && !hurryRef.current) setHurry(true)
  }

  /* ---------------- auto ---------------- */

  async function autoRound(): Promise<number | null> {
    if (autoStop.current) return null
    return drop()
  }
  const auto = useAutoBet(autoRound, turbo ? 250 : 600)
  autoOn.current = auto.running || autoOn.current
  useEffect(() => {
    if (!auto.running) autoOn.current = false
  }, [auto.running])
  const autoApi = useRef(auto)
  autoApi.current = auto
  function startAuto() {
    if (busyRef.current || autoApi.current.running) return
    if (useWallet.getState().balance < betRef.current) return toast(NO_COINS)
    autoStop.current = false
    autoOn.current = true
    void autoApi.current.start()
  }
  function stopAuto() {
    autoStop.current = true
    autoApi.current.stop()
  }

  /* ---------------- aim, turbo, keys ---------------- */

  const aimSave = useRef(0)
  const setAim = (a: number) => {
    const v = clamp(Math.round(a * 100) / 100, -1, 1)
    if (v === aimRef.current) return
    aimRef.current = v
    setAimState(v)
    pusherSfx.tick()
    clearTimeout(aimSave.current)
    aimSave.current = window.setTimeout(() => saveAim(v), 300)
  }
  const setTurbo = (on: boolean) => {
    setTurboState(on)
    saveTurbo(on)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || info || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.code === 'Space') {
        e.preventDefault()
        if (e.repeat) return
        if (busyRef.current) return hurryNow()
        if (mode === 'manual') void drop()
        else if (!autoApi.current.running) startAuto()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = e.shiftKey ? 0.25 : 0.05
        setAim(aimRef.current + (e.key === 'ArrowLeft' ? -step : step))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const onDisplay = useCallback((r: { x: number; y: number; w: number; h: number } | null) => roller.place(r), [roller])

  /* ---------------- panel ---------------- */

  const locked = busy || auto.running
  const broke = balance < bet
  let action: ReactNode
  if (auto.running)
    action = (
      <ActionButton tone="danger" onClick={stopAuto} sub={auto.left != null ? `${auto.left} left` : 'until stopped'}>
        Stop auto
      </ActionButton>
    )
  else if (busy)
    action = (
      <ActionButton tone="neutral" onClick={hurryNow} sub={hurry ? 'Hurrying it along' : compact ? 'Tap the machine to hurry' : 'Space or tap the machine to hurry'}>
        Pushing…
      </ActionButton>
    )
  else if (broke)
    action = (
      <ActionButton disabled sub="Lower your stake, or visit Rewards">
        Not enough coins
      </ActionButton>
    )
  else if (mode === 'manual')
    action = (
      <ActionButton onClick={() => void drop()} sub={`${fmt(bet)} a drop · up to ${multText(MAX_MULT)}`}>
        Drop a coin
      </ActionButton>
    )
  else
    action = (
      <ActionButton onClick={startAuto} sub={`${fmt(bet)} a drop${auto.cfg.count ? ` · ${auto.cfg.count} drops` : ' · until stopped'}`}>
        Start auto
      </ActionButton>
    )

  const pills = hist
    .filter((h) => h.id !== hideId)
    .slice(0, 16)
    .map((h) => {
      const best = bestOf(h.wins)
      const prize = best && isPrize(best) ? best : null
      const tone: PillTone = h.mult === 0 ? 'loss' : prize || h.mult >= 10 ? 'gold' : h.mult >= 1 ? 'win' : 'neutral'
      return {
        key: h.id,
        tone,
        label: (
          <span className="flex items-center gap-1" title={`${fmt(h.bet)} staked · ${h.payout > 0 ? `${fellText(h.wins)}: ${fmt(h.payout)}` : 'nothing over the edge'}${h.feature !== 'none' ? ` · ${FEATURE_NAME[h.feature]}` : ''}`}>
            {prize && <ItemGlyph kind={prize} size={15} className="-my-1 -ml-1" />}
            {h.feature !== 'none' && <FeatureMark kind={h.feature} size={12} />}
            {multText(h.mult)}
          </span>
        ),
      }
    })

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <div className="max-lg:order-[-1]">
        <BetInput value={bet} onChange={setBet} disabled={locked} />
      </div>
      {mode === 'auto' && (
        <>
          <AutoSettings auto={auto} />
          <AutoStops stops={stops} onChange={setStops} disabled={auto.running} />
        </>
      )}
      <div className="flex items-center justify-between gap-3 rounded-lg bg-stage px-3 py-2.5">
        <div>
          <div className="text-[13px] font-bold">Turbo</div>
          <div className="text-[11px] text-dim">The machine runs {TURBO_SPEED}× as fast</div>
        </div>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      {pills.length > 0 && (
        <div>
          <Label>Recent drops</Label>
          <HistoryPills items={pills} className="max-w-full" />
        </div>
      )}
      <FieldStrip field={field} gone={gone} fresh={fresh} />
      <Paytable onInfo={() => setInfo(true)} />
      {/* stuck to the bottom of the panel (over its padding too, so nothing scrolls past under it) */}
      <div className="flex flex-col gap-2 max-lg:order-[-3] lg:sticky lg:-bottom-4 lg:z-10 lg:order-last lg:-mx-4 lg:-mb-4 lg:mt-auto lg:bg-[linear-gradient(to_top,var(--color-panel2)_78%,transparent)] lg:px-4 lg:pb-4 lg:pt-3">{action}</div>
    </>
  )

  /* ---------------- stage ---------------- */

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[#070b22]">
      <HudStyles />
      {/* a tap hurries a drop along (a click, so a finger scrolling the page past the machine doesn't) */}
      <div className="relative min-h-0 flex-1" onClick={() => busyRef.current && hurryNow()}>
        <div className="absolute inset-0">
          <Machine field={field} play={play} aim={aim} onEvent={onEvent} onDone={onDone} onDisplay={onDisplay} className="h-full w-full" />
        </div>
        <WinDisplay roller={roller} />
        <AnimatePresence>{callout && <Callout key={callout.id} kind={callout.kind} />}</AnimatePresence>
        <AnimatePresence>{banner && !party && <WinBanner key={banner.id} b={banner} />}</AnimatePresence>
        <AnimatePresence>{burst && <Burst key={burst.id} big={burst.big} />}</AnimatePresence>
        <AnimatePresence>{flash > 0 && <Flash key={flash} />}</AnimatePresence>
        <AnimatePresence>{party && <Party key={party.id} p={party} compact={compact} quick={autoOn.current} onDone={closeParty} />}</AnimatePresence>
        <AnimatePresence>
          {note && (
            <motion.div
              key={note.id}
              className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/75 px-3.5 py-1.5 text-[12px] font-bold text-white ring-1 ring-white/10 backdrop-blur-sm sm:text-[13px]"
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              {note.text}
            </motion.div>
          )}
        </AnimatePresence>
        <button
          onClick={(e) => {
            e.stopPropagation()
            sfx.click()
            setInfo(true)
          }}
          aria-label="How Coin Cascade works"
          className="absolute right-2.5 top-2.5 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#060c1a]/70 text-[15px] font-black text-white/80 ring-1 ring-white/15 transition hover:bg-black/70 hover:text-white"
        >
          ?
        </button>
        <div className="sr-only" aria-live="polite">
          {say}
        </div>
      </div>
      <AimBar aim={aim} onAim={setAim} compact={compact} />
    </div>
  )

  // the confetti from the tray is gone after a couple of seconds
  useEffect(() => {
    if (!burst) return
    const t = window.setTimeout(() => setBurst((b) => (b && b.id === burst.id ? null : b)), 2600)
    return () => clearTimeout(t)
  }, [burst])

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-lg:h-[min(720px,calc(100svh-150px))] max-lg:min-h-[520px] max-sm:h-[min(600px,calc(100svh-212px))] max-sm:min-h-[460px]" />
      <AnimatePresence>{info && <InfoModal bet={bet} onClose={() => setInfo(false)} />}</AnimatePresence>
    </>
  )
}
