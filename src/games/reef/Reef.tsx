import { useEffect, useReducer, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GameShell } from '../../components/ui'
import { BojeLoader } from '../../components/Loader'
import { isMuted, sfx } from '../../lib/sound'
import { fmt, round2 } from '../../lib/format'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import { COSTS, multLabel, speciesOf, type FishId } from './rules'
import { Purse } from './purse'
import { Panel } from './Panel'
import { BIG_WIN_MS, Banner, BigWin, Dock, Feed, Hint, LockTag, NetPill, Plaque, Pops, StageToggles, type BannerData, type BannerKind, type BigWinData, type FeedItem, type HintData, type Pop } from './Hud'
import { TreasureWheel, type WheelSpin } from './Wheel'
import { Paytable } from './Paytable'
import type { CatchFx, Cue, FormationName, ReefEvent, ReefScene, StageLayout } from './scene'

/*
  Reef Raid: an arcade fish table. Cartoon sea creatures swim across a sunlit reef (the 3D stage, scene.ts, loaded
  lazily with three.js); the player aims the bubble cannon at the bottom and fires torpedoes, each costing the cannon's
  level. A torpedo bursts into a net on the first creature it touches, which is caught with chance 97% ÷ its
  multiplier and pays multiplier × the shot (rules.ts).

  This screen joins the pieces. The scene owns the reef, the pointer and the trigger, and asks before every shot; the
  purse (purse.ts) owns the money: it charges each shot, decides each hit with rules.resolveHit and pays it (a chest's
  win as its wheel lands: the screen tells it when the chest bursts), refunds a fizzle, writes the bet records in
  batches and squares everything up when the page goes. Only one tab at a time plays for a player (a Web Lock); a
  second one waits and says so. Around them: the panel (Panel.tsx), the overlay on the reef (Hud.tsx: the dock, feed,
  banners, payout numbers and the big-win celebration), the treasure wheel (Wheel.tsx), the paytable (Paytable.tsx)
  and the sounds (sfx.reef, woken inside the first press on the stage for iOS).

  Controls: the mouse aims, a click fires one and holding keeps firing (Space too); A auto fire, L lock (pick a
  creature; Esc lets go), 1-7, Q / E or the mouse wheel over the reef change the cannon. On a phone a tap fires toward
  it and holding keeps firing; Auto, Lock and the level sit on the stage. Dev only: window.__reefForce (scene.ts) and
  window.__reefScene / window.__reefPurse.
*/

const LEVEL_KEY = 'lumen.reef.level'
const FORMATION: Record<FormationName, string> = { ring: 'Ring of fish!', rows: 'Fish parade!', conga: 'Conga line!', arrow: 'Arrowhead!' }
/** how long each kind of banner stays up (ms), and its rank: a banner never covers a higher-ranked one still showing */
const BANNERS: Record<BannerKind, { ms: number; rank: number }> = {
  whale: { ms: 3500, rank: 3 },
  tide: { ms: 2000, rank: 2 },
  bomb: { ms: 1700, rank: 1 },
  zap: { ms: 1700, rank: 1 },
  formation: { ms: 2200, rank: 1 },
  gone: { ms: 2200, rank: 1 },
}
/** the room kept under the cannon's spot for its cost badge (CSS px) */
const DOCK = 36
/**
 * The sign hangs over the far reef when there is at least this much of it above the field, on a stage wide enough to
 * keep it clear of the session pill and the catch feed (CSS px).
 */
const PLAQUE_ROOM = 54
const PLAQUE_WIDE = 560
/** the pointer has to rest on the reef this long (ms) before the mouse wheel steps the level instead of the page */
const SETTLE_MS = 350
/**
 * The stage's size below desktop: tall on a phone, most of the screen on a tablet, and on a short screen (a phone on
 * its side) whatever fits between the header and the bottom nav, so the cannon and its buttons are never under it.
 */
const STAGE =
  'max-sm:h-[min(134vw,640px)] max-sm:min-h-[440px] sm:max-lg:h-[min(80vh,780px)] max-lg:[@media(max-height:520px)]:h-[calc(100dvh-158px-env(safe-area-inset-bottom,0px))] max-lg:[@media(max-height:520px)]:min-h-[200px]'
/** a catch stays in the feed this long (ms); the same catch again within MERGE_MS counts up on its row */
const FEED_MS = 9000
const MERGE_MS = 5000
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x))
/** a hint as it is asked for, before it gets its key */
type HintIn = { [K in HintData['kind']]: Omit<Extract<HintData, { kind: K }>, 'key'> }[HintData['kind']]

const storedLevel = () => {
  const raw = safeStorage.getItem(LEVEL_KEY)
  const i = raw == null ? NaN : Number(raw)
  return Number.isInteger(i) && i >= 0 && i < COSTS.length ? i : 2
}

export default function Reef() {
  const authStatus = useAuth((s) => s.status)
  const authOpen = useAuth((s) => s.view != null)
  const balance = useWallet((s) => s.balance)
  // the player this page plays for: App starts the page over when that changes
  const [purse] = useState(() => new Purse(useAuth.getState().uid ?? 'guest'))
  const [, refresh] = useReducer((n: number) => n + 1, 0)

  const [level, setLevel] = useState(storedLevel)
  const [auto, setAuto] = useState(false)
  const [lock, setLock] = useState(false)
  const [locked, setLocked] = useState<FishId | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [progress, setProgress] = useState(0.04)
  const [scene, setScene] = useState<ReefScene | null>(null)
  const [portraits, setPortraits] = useState<Partial<Record<FishId, string>>>({})
  const [layout, setLayout] = useState<StageLayout | null>(null)
  const [box, setBox] = useState({ w: 800, h: 600 })
  const [pops, setPops] = useState<Pop[]>([])
  const [big, setBig] = useState<BigWinData | null>(null)
  const [spoken, setSpoken] = useState('')
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [banner, setBanner] = useState<BannerData | null>(null)
  const [wheel, setWheel] = useState<WheelSpin | null>(null)
  const [hint, setHint] = useState<HintData | null>(null)
  const [paytable, setPaytable] = useState(false)
  // whether this tab holds the player's reef (see the lock below), and whether another tab has it
  const [held, setHeld] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const [touch] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches)
  // a modal over the stage (the paytable, or the sign-in dialog): the reef stops taking shots
  const paused = paytable || authOpen

  const hostRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ReefScene | null>(null)
  const bed = useRef<ReturnType<typeof sfx.reef.ambience>>(null)
  const seq = useRef(0)
  const shownBanner = useRef({ rank: 0, until: 0 })
  const timers = useRef(new Set<number>())
  const live = useRef({ level, lock, paused, box, elsewhere })
  live.current = { level, lock, paused, box, elsewhere }

  /** a timeout that dies with the page */
  const later = (fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }

  /* ---------------- the cannon ---------------- */

  const pickLevel = (i: number) => {
    const n = clamp(i, 0, COSTS.length - 1)
    if (n === live.current.level) return
    // so quick steps (a spun mouse wheel) chain before the next render
    live.current.level = n
    setLevel(n)
    sfx.reef.level(n)
  }
  const step = (d: -1 | 1) => pickLevel(live.current.level + d)
  const toggleAuto = () => {
    sfx.click()
    setAuto((a) => !a)
  }
  const toggleLock = () => {
    sfx.click()
    setLock((l) => !l)
  }

  /** a press on the stage: the audio wakes inside the gesture (iOS only lets it start in one) and the bed starts */
  const wake = () => {
    sfx.reef.unlock()
    if (!bed.current && !isMuted()) bed.current = sfx.reef.ambience()
  }

  /* ---------------- what the scene reports ---------------- */

  const showHint = (h: HintIn, ms: number) => {
    const key = ++seq.current
    setHint({ ...h, key })
    later(() => setHint((x) => (x?.key === key ? null : x)), ms)
  }

  /** the trigger wants a shot: the purse charges it, or the player hears why not */
  const fire = (cost: number) => {
    const r = purse.fire(cost)
    if (r === 'ok') {
      // the bed starts with the first shot (a gesture, so the audio may start)
      if (!bed.current && !isMuted()) bed.current = sfx.reef.ambience()
      return true
    }
    if (r === 'broke') {
      setAuto(false)
      sfx.reef.broke()
      const bal = useWallet.getState().balance
      let lower: number | null = null
      for (let i = COSTS.length - 1; i >= 0 && lower == null; i--) if (COSTS[i] < cost && COSTS[i] <= bal) lower = i
      showHint({ kind: 'broke', cost, lower }, 3200)
    } else if (r === 'wait' && !live.current.elsewhere) showHint({ kind: 'wait' }, 2000)
    return false
  }

  const say = (kind: BannerKind, title: string, sub?: string) => {
    const now = performance.now()
    const b = BANNERS[kind]
    if (shownBanner.current.until > now && shownBanner.current.rank > b.rank) return
    shownBanner.current = { rank: b.rank, until: now + b.ms }
    const key = ++seq.current
    setBanner({ key, kind, title, sub })
    later(() => setBanner((x) => (x?.key === key ? null : x)), b.ms)
  }

  const caught = (c: CatchFx) => {
    // the chest bursts as its wheel lands: its win, owed till now, is paid
    if (c.target === 'chest') purse.payOwed(c.shot)
    const key = ++seq.current
    const { w, h } = live.current.box
    // kept clear of the stage's edges and of the dock
    const x = clamp(c.x, Math.min(w / 2, 78), Math.max(w / 2, w - 78))
    const y = clamp(c.y, 64, Math.max(64, h - 104))
    // the Golden Whale (on its own, or netted in a blast or a chain) and any catch of 100× or more get the big-win
    // celebration; the rest a number popping where they were (the chest's win is shown by its wheel, landing now)
    const whale = c.parts.some((q) => q.id === 'whale')
    if (c.target !== 'chest' && (whale || c.tier >= 3)) {
      setBig({ key, title: whale ? 'Golden Whale!' : 'Mega catch!', id: whale ? 'whale' : c.target, mult: c.mult, payout: c.payout, n: c.parts.length })
      later(() => setBig((b) => (b?.key === key ? null : b)), BIG_WIN_MS)
    } else if (c.target !== 'chest') {
      setPops((p) => [...p.slice(-10), { key, x, y, payout: c.payout, mult: c.mult, tier: c.tier, id: c.target, n: c.parts.length }])
      later(() => setPops((p) => p.filter((q) => q.key !== key)), (1.5 + c.tier * 0.3) * 1000 + 80)
    }
    // screen readers hear about the big ones
    if (c.tier >= 2 || whale) setSpoken(`${whale ? 'Golden Whale' : speciesOf(c.target).name} caught, ${multLabel(c.mult)}, plus ${fmt(c.payout)} coins`)
    // a run of the same small catch counts up on one row rather than filling the feed
    const now = performance.now()
    const n = c.parts.length
    setFeed((f) => {
      const top = f[0]
      if (top && top.id === c.target && top.mult === c.mult && top.n === 1 && n === 1 && now - top.at < MERGE_MS) return [{ ...top, count: top.count + 1, payout: round2(top.payout + c.payout), at: now }, ...f.slice(1)]
      return [{ key, id: c.target, mult: c.mult, payout: c.payout, n, count: 1, at: now }, ...f].slice(0, 4)
    })
    later(() => setFeed((f) => f.filter((q) => performance.now() - q.at < FEED_MS - 100)), FEED_MS)
    // (the chest's fanfare plays as its wheel lands)
    if (c.target !== 'chest' && (c.tier >= 1 || whale)) sfx.reef.win(whale ? 3 : c.tier)
  }

  const event = (e: ReefEvent) => {
    switch (e.type) {
      case 'whale-incoming':
        say('whale', 'Golden Whale incoming!', 'Worth 200× your shot')
        sfx.reef.whale()
        break
      case 'whale-gone':
        if (!e.caught) say('gone', 'The Golden Whale swam away')
        break
      case 'tide':
        say('tide', 'Here comes the tide!')
        sfx.reef.tide()
        break
      case 'formation':
        say('formation', FORMATION[e.name])
        break
      case 'bomb':
        say('bomb', 'Kaboom!', e.count ? `+${e.count} caught in the blast` : undefined)
        break
      case 'zap':
        say('zap', 'Zap!', e.count ? `${e.count} linked` : undefined)
        break
      case 'wheel':
        setWheel({ key: ++seq.current, segment: e.segment, mult: e.mult, payout: e.payout, spin: e.spin, x: e.x, y: e.y })
        break
      case 'lock':
        setLocked(e.target)
        break
    }
  }

  const cue = (c: Cue, k: number) => {
    const s = sfx.reef
    if (c === 'shot') s.shot(k)
    else if (c === 'net') s.net(k)
    else if (c === 'flinch') s.flinch(k)
    else if (c === 'catch') s.catch(k)
    else if (c === 'coin') s.coin(k)
    else if (c === 'boom') s.boom(k)
    else if (c === 'zap') s.zap(k)
    else if (c === 'chest') s.chest()
    else if (c === 'fizzle') s.fizzle()
    else if (c === 'bounce') s.bounce()
    else if (c === 'lock') s.lock()
  }

  // the scene's callbacks are set once; they call the latest of these
  const on = useRef({ fire, caught, event, cue })
  on.current = { fire, caught, event, cue }

  /* ---------------- the scene ---------------- */

  useEffect(() => {
    let alive = true
    const host = hostRef.current!
    let sc: ReefScene | null = null
    let ro: ResizeObserver | null = null
    purse.onChange = refresh
    if (import.meta.env.DEV) (window as unknown as { __reefPurse?: Purse }).__reefPurse = purse
    import('./scene')
      .then(({ ReefScene }) => {
        if (!alive) return
        sc = new ReefScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __reefScene?: ReefScene }).__reefScene = sc
        sc.setCost(COSTS[live.current.level])
        sc.onProgress = (p) => alive && setProgress(0.06 + p * 0.94)
        sc.onFire = (_shot, cost) => on.current.fire(cost)
        sc.onHit = (h) => purse.hit(h.shot, h.cost, h.target, h.extras, h.forced)
        sc.onFizzle = (_shot, cost) => purse.fizzle(cost)
        sc.onCatch = (c) => on.current.caught(c)
        sc.onEvent = (e) => on.current.event(e)
        sc.onCue = (c, k) => on.current.cue(c, k)
        sc.onLayout = (l) => alive && setLayout(l)
        // room under the cannon for its cost badge
        sc.setMargins({ bottom: DOCK })
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          setBox({ w: r.width, h: r.height })
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!alive || !sc) return
          setPortraits(sc.portraits)
          setScene(sc)
          setReady(true)
        })
      })
      .catch(() => alive && setFailed(true))
    const ticker = window.setInterval(() => purse.tick(), 250)
    const pending = timers.current
    return () => {
      alive = false
      clearInterval(ticker)
      ro?.disconnect()
      pending.forEach(clearTimeout)
      pending.clear()
      bed.current?.stop()
      bed.current = null
      if (import.meta.env.DEV) {
        const w = window as unknown as { __reefScene?: ReefScene; __reefPurse?: Purse }
        if (w.__reefScene === sc) delete w.__reefScene
        if (w.__reefPurse === purse) delete w.__reefPurse
      }
      // the scene goes first (it reports nothing once disposed), then the torpedoes still in the water are refunded
      try {
        sc?.dispose()
      } finally {
        sceneRef.current = null
        purse.squareUp()
      }
    }
    // the scene and the purse live as long as the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // One tab at a time plays the reef for a player: a second one would square up the first one's ledger (refunding its
  // torpedoes still in the water) while the first played on. The page holds the player's lock while it is open (a tab
  // that closes or dies lets go of it), and the purse starts only once it has it.
  useEffect(() => {
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
      .request(purse.key, { signal: quit.signal }, () =>
        // granted after the page went (the grant was already on its way): let go at once
        gone
          ? undefined
          : new Promise<void>((done) => {
              release = done
              clearTimeout(slow)
              setElsewhere(false)
              setHeld(true)
            }),
      )
      .catch(() => {
        /* given up: the page went first */
      })
    return () => {
      gone = true
      clearTimeout(slow)
      quit.abort()
      release()
    }
  }, [purse])

  // a ledger a page left behind (a crash, a closed tab) is squared up once the player's wallet has loaded; until then
  // the purse refuses shots, so nothing is staked from a wallet the server is about to replace
  useEffect(() => {
    if (authStatus === 'loading' || !held) return
    const left = purse.start()
    if (!left) return
    const w = useWallet.getState()
    if (left.refund > 0) w.pushToast({ kind: 'win', title: 'Coins left on the reef last time came back', amount: left.refund })
    else w.pushToast({ kind: 'info', title: `Your last ${left.shots === 1 ? 'Reef Raid shot was' : `${left.shots} Reef Raid shots were`} added to your bets` })
  }, [authStatus, held, purse])

  // Closing, reloading or leaving the site squares the purse up on the way out. Should the page stay after all (a
  // cancelled leave), the torpedoes it refunded are gone from the water and play carries on with a fresh ledger.
  useEffect(() => {
    const leave = () => {
      purse.squareUp()
      sceneRef.current?.clearBullets()
    }
    window.addEventListener('beforeunload', leave)
    window.addEventListener('pagehide', leave)
    return () => {
      window.removeEventListener('beforeunload', leave)
      window.removeEventListener('pagehide', leave)
    }
  }, [purse])

  useEffect(() => {
    sceneRef.current?.setCost(COSTS[level])
    safeStorage.setItem(LEVEL_KEY, String(level))
  }, [level, ready])
  useEffect(() => sceneRef.current?.setAuto(auto && !paused), [auto, paused, ready])
  useEffect(() => sceneRef.current?.setLock(lock), [lock, ready])
  useEffect(() => {
    const sc = sceneRef.current
    if (!sc) return
    sc.setInput(!paused)
    if (paused) sc.trigger(false)
  }, [paused, ready])

  /* ---------------- keys and the wheel ---------------- */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.metaKey || e.ctrlKey || e.altKey || live.current.paused) return
      const sc = sceneRef.current
      if (e.code === 'Space') {
        // held: fires at the fire rate (and never scrolls the page or presses a focused button)
        e.preventDefault()
        if (!e.repeat) sc?.trigger(true)
        return
      }
      if (e.repeat) return
      const k = e.key.toLowerCase()
      if (k === 'a') toggleAuto()
      else if (k === 'l') toggleLock()
      else if (k === 'escape') {
        // lets go of the locked creature, or leaves lock mode when nothing is locked
        if (sc?.lockedAt({ x: 0, y: 0 })) sc.releaseLock()
        else if (live.current.lock) setLock(false)
      } else if (k === 'q') step(-1)
      else if (k === 'e') step(1)
      else if (k >= '1' && k <= '7') pickLevel(Number(k) - 1)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      sceneRef.current?.trigger(false)
    }
    // The mouse wheel over the reef steps the level, but only once the pointer has settled on the stage (or pressed
    // it): a page scroll that merely passes over the reef, or a trackpad's gentle glide, scrolls the page as usual
    // rather than quietly raising the cost of every shot.
    let acc = 0
    let last = 0
    let arrived = Infinity
    let pressed = false
    const enter = () => {
      arrived = performance.now()
      acc = 0
    }
    const leave = () => {
      arrived = Infinity
      pressed = false
    }
    const press = () => {
      pressed = true
    }
    const wheel = (e: WheelEvent) => {
      const now = performance.now()
      const settled = pressed || now - arrived > SETTLE_MS
      // a trackpad sends a stream of small pixel steps; a mouse wheel's notch is a big one
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 30
      if (live.current.paused || !settled || !notch) return
      e.preventDefault()
      acc += e.deltaY
      if (Math.abs(acc) < 40 || now - last < 110) return
      step(acc < 0 ? 1 : -1)
      acc = 0
      last = now
    }
    const el = stageRef.current!
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    el.addEventListener('pointerenter', enter)
    el.addEventListener('pointerleave', leave)
    el.addEventListener('pointerdown', press)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      el.removeEventListener('pointerenter', enter)
      el.removeEventListener('pointerleave', leave)
      el.removeEventListener('pointerdown', press)
      el.removeEventListener('wheel', wheel)
    }
    // reads the page through refs and setters only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------- the page ---------------- */

  const session = purse.session
  const shownHint: HintData | null = hint ?? (elsewhere ? { key: 0, kind: 'elsewhere' } : lock && !locked && ready ? { key: 0, kind: 'lock', touch } : null)

  const panel = (
    <Panel
      level={level}
      onLevel={pickLevel}
      auto={auto}
      onAuto={setAuto}
      lock={lock}
      onLock={setLock}
      session={session}
      balance={balance}
      portraits={portraits}
      onPaytable={() => setPaytable(true)}
    />
  )

  const stage = (
    <div
      ref={stageRef}
      className="absolute inset-0 overflow-hidden bg-[#1d8fb8]"
      style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={wake}
      onPointerUp={wake}
    >
      <div ref={hostRef} className="absolute inset-0" />
      {ready && (
        <>
          {layout && layout.rect.top >= PLAQUE_ROOM && box.w >= PLAQUE_WIDE && <Plaque />}
          {session.shots > 0 && <NetPill net={session.won - session.spent} />}
          <Feed items={feed} portraits={portraits} compact={banner != null} />
          <LockTag scene={scene} target={locked} />
          <Pops pops={pops} scale={clamp(box.w / 760, 0.74, 1)} />
          <Banner banner={banner} />
          <BigWin win={big} portraits={portraits} stage={box} />
          <div className="sr-only" aria-live="polite">
            {spoken}
          </div>
          {layout && <Dock layout={layout} level={level} onStep={step} />}
          <StageToggles auto={auto} lock={lock} onAuto={toggleAuto} onLock={toggleLock} />
          <Hint hint={shownHint} bottom={layout ? DOCK + layout.unit * 1.9 + 8 : 120} onLower={pickLevel} />
          {wheel && <TreasureWheel key={wheel.key} spin={wheel} stage={box} onDone={() => setWheel((w) => (w?.key === wheel.key ? null : w))} />}
        </>
      )}
      <AnimatePresence>
        {!ready && (
          <motion.div key="loading" className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_35%,#3fb6d8_0%,#1d8fb8_45%,#0d4f7a_100%)]" exit={{ opacity: 0, transition: { duration: 0.45 } }}>
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/90">This device couldn&apos;t start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Filling the reef" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass={STAGE} />
      <AnimatePresence>{paytable && <Paytable portraits={portraits} cost={COSTS[level]} onClose={() => setPaytable(false)} />}</AnimatePresence>
    </>
  )
}
