import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, fmtCompact, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { roboSfx } from './sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import {
  ANTE_COST,
  BUY_PRICE,
  CELLS,
  FULL_MULT,
  MAX_WIN,
  PAYS,
  PAY_SYMS,
  RESPINS,
  SUPER_PRICE,
  TRIGGER,
  ZAP_BOLTS,
  calmGrid,
  playRound,
  teaseColumn,
  type Action,
  type BaseSpin,
  type BotKind,
  type Buy,
  type PlayOpts,
  type Round,
  type WayWin,
} from './rules'
import { BOT_TEXT, SYMBOL_COLOR, SYMBOL_NAME, TIERS, tierIndex } from './meta'
import type { HostAction, RoboScene, ThumbKey } from './scene'

/*
  Robo Riot: vinyl-toy robots in five glass tubes, with Volt on the lever. The round is drawn in full when the spin
  is placed (rules.ts); this screen plays it back through the 3D scene (the drop, Volt's Power Surge, the ways, then
  the Power Grid respin by respin with every bot's ability) and settles once the show is over.
*/

type BannerData =
  | { kind: 'intro'; super: boolean; cells: number; surge: boolean; bought: boolean }
  | { kind: 'big'; amount: number; unit: number; count: number }
  | { kind: 'end'; amount: number; unit: number; count: number; respins: number; filled: number; full: boolean }
  | { kind: 'max'; amount: number; unit: number }
/** `jump`: the player tapped during the count-up, so the banner shows its final amount and tier */
type Banner = BannerData & { id: number; jump?: boolean }
/** an amount over a way win */
type Pop = { id: number; x: number; y: number; text: string; color: string; big?: boolean }
/** the Power Grid counters: respins left (with a pulse id for each reset), sockets filled */
type GridHud = { left: number; filled: number; reset: number; last: boolean; done?: boolean }
type Hud = { win: number; cells: number; grid: GridHud | null }
/** a full-stage stamp for the big moments */
type Stamp = { id: number; kind: 'surge' | 'full' }
/** Volt's speech bubble, next to his screen */
type Bubble = { id: number; text: string; x: number; y: number; side: number }

const EMPTY_HUD: Hud = { win: 0, cells: 0, grid: null }
const ROBOTS = ['rex', 'dot', 'clank', 'zip']
/** fireworks rockets as a win banner reaches each tier */
const ROCKETS = [4, 7, 11, 18]
const BOT_NAME: Record<BotKind, string> = { zap: 'Zap bot', boost: 'Boost bot', magnet: 'Magnet bot' }
const BOT_COLOR: Record<BotKind, string> = { zap: '#ffe14a', boost: '#59ff7a', magnet: '#ff3b5c' }
/** a cell value as the cells show it: a multiple of the bet */
const xs = (v: number) => `${fmt(v, v % 1 ? 2 : 0)}×`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** the caption for the ways: the best win, and how many more there are */
function waysCaption(ways: readonly WayWin[], coins: (m: number) => number) {
  const w = ways.reduce((a, b) => (b.pay > a.pay ? b : a))
  const text = `${SYMBOL_NAME[w.sym]} on ${w.len} reels${w.ways > 1 ? ` × ${w.ways} ways` : ''} · ${fmt(coins(w.pay))}`
  return ways.length > 1 ? `${text} · +${ways.length - 1} more` : text
}

/** the caption for one bot firing */
function actionCaption(a: Action) {
  const who = a.persistent ? `Gold ${a.kind} again` : BOT_NAME[a.kind]
  const n = a.hits.length
  if (a.kind === 'zap') return `${who} · ${plural(n, 'bolt')}, each doubles a cell`
  if (a.kind === 'boost') return n ? `${who} · +${xs(round2(a.hits[0].to - a.hits[0].from))} to ${plural(n, 'cell')}` : who
  const gain = n ? round2(a.hits[0].to - a.hits[0].from) : 0
  return `${who} · collects ${plural(a.sources.length, 'cell')} for +${xs(gain)}`
}

/**
 * How a win banner counts up, as [seconds, amount] points: 0.8 s to the first tier, a second through each tier
 * after that and 1.6 s for the rest, so a Big win runs 2.4 s and each higher tier adds one. Below the first tier
 * it is a plain 2 s count.
 */
function countPlan(amount: number, unit: number): [number, number][] {
  const marks = TIERS.map((t) => t.min * unit).filter((v) => v < amount)
  if (!marks.length) return [[0, 0], [2, amount]]
  const plan: [number, number][] = [[0, 0], ...marks.map((v, i): [number, number] => [0.8 + i, v])]
  plan.push([plan[plan.length - 1][0] + 1.6, amount])
  return plan
}

/** the amount a count-up shows after `t` seconds; each stretch slows as it reaches its tier */
function countAt(plan: [number, number][], t: number) {
  let i = 1
  while (i < plan.length - 1 && t > plan[i][0]) i++
  const [t0, v0] = plan[i - 1]
  const [t1, v1] = plan[i]
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))
  return v0 + (v1 - v0) * (1 - (1 - u) ** 2)
}

// dev only: window.__roboForce = 'grid' | 'surge' | 'gold' | 'full' | 'big' | 'tease' | 'max'
// replays the round until it shows that, for testing (the paid-spin ones leave buys alone)
const FORCE: Record<string, (r: Round) => boolean> = {
  grid: (r) => !!r.base?.trigger,
  surge: (r) => !!r.base?.surge,
  gold: (r) => r.gold,
  full: (r) => !!r.bonus?.full,
  big: (r) => r.total >= 15 && !r.bonus,
  tease: (r) => r.base != null && teaseColumn(r.base.grid) >= 0,
  max: (r) => r.capped,
}
const PAID_ONLY = ['grid', 'surge', 'big', 'tease']

function forced(round: Round, opts: PlayOpts) {
  const name = (window as unknown as { __roboForce?: string }).__roboForce ?? ''
  const test = FORCE[name]
  if (!test || (opts.buy !== 'none' && PAID_ONLY.includes(name))) return round
  for (let i = 0; i < 400000 && !test(round); i++) round = playRound(rand, opts)
  return round
}

/** a round already paid for but not yet settled; kept in storage under `key` until it is */
type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.roboriot.pending.${uid ?? 'guest'}`

export default function RoboRiot() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurbo] = useState(false)
  const [ante, setAnte] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [caption, setCaption] = useState<{ id: number; text: string } | null>(null)
  const [stamp, setStamp] = useState<Stamp | null>(null)
  const [bubble, setBubble] = useState<Bubble | null>(null)
  const [punch, setPunch] = useState(0)
  const [lastWin, setLastWin] = useState(0)
  const [paytable, setPaytable] = useState(false)
  const [buying, setBuying] = useState<Buy | null>(null)
  const [thumbs, setThumbs] = useState<Partial<Record<ThumbKey, string>>>({})
  const [hudTop, setHudTop] = useState(-100)

  const hostRef = useRef<HTMLDivElement>(null)
  const totalRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RoboScene | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const seq = useRef(1)
  /** the banner on screen: a tap skips its count-up or closes it; close() always closes */
  const bannerDone = useRef<{ tap: () => void; close: () => void } | null>(null)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const anteRef = useRef(ante)
  anteRef.current = ante
  const autoRef = useRef(false)
  /** the round in play, from the stake until it is settled */
  const pending = useRef<Pending | null>(null)
  /** dead paid spins in a row; Volt facepalms at every seventh */
  const deadRun = useRef(0)
  /** bonus symbols that have come to rest in the current drop */
  const bonusN = useRef(0)
  const captionTimer = useRef(0)
  const bubbleTimer = useRef(0)

  /** pays the round in play, once: when its show ends, or as soon as the player leaves (the outcome is already drawn) */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'roboriot', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: RoboScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ RoboScene }) => {
        if (!live) return
        setProgress(0.12)
        sc = new RoboScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __roboScene?: RoboScene }).__roboScene = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onCoin = () => sfx.coin()
        sc.onLever = () => roboSfx.lever()
        sc.onVacuum = (col) => roboSfx.vacuum(col)
        sc.onLand = (col, syms) => {
          roboSfx.land(col)
          if (syms.some((s) => ROBOTS.includes(s))) roboSfx.beep(col)
        }
        sc.onBonusLand = () => {
          const n = ++bonusN.current
          setHud((h) => ({ ...h, cells: n }))
          roboSfx.cell(n)
        }
        sc.onSpinStop = (_pos, landed) => !landed && roboSfx.tick()
        sc.onClamp = (_pos, cell) => {
          roboSfx.clamp()
          if (cell.gold) roboSfx.gold()
        }
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          // the counters and caption sit in the space under the machine; Volt has the space above it
          const f = sc!.frameRect()
          setHudTop(Math.round(Math.min(r.height - 62, f.bottom + Math.max(3, (r.height - f.bottom) / 2 - 31))))
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          sc.show(calmGrid(rand))
          sc.setOverclock(anteRef.current)
          setReady(true)
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      clearTimeout(captionTimer.current)
      clearTimeout(bubbleTimer.current)
      bannerDone.current?.close()
      sc?.dispose()
      sceneRef.current = null
      // the dev hook would keep the disposed scene (and all its buffers) alive until the next visit
      if (import.meta.env.DEV) {
        const w = window as unknown as { __roboScene?: RoboScene }
        if (w.__roboScene === sc) delete w.__roboScene
      }
      settlePending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])
  useEffect(() => sceneRef.current?.setOverclock(ante), [ante])

  // Reloading, closing the tab or going to another site mid-show pays the round on the way out. beforeunload comes
  // first where it fires, so the account save on pagehide already carries the payout. Not on visibilitychange: the
  // header balance would give the win away to a player who only switched tabs.
  useEffect(() => {
    window.addEventListener('beforeunload', settlePending)
    window.addEventListener('pagehide', settlePending)
    return () => {
      window.removeEventListener('beforeunload', settlePending)
      window.removeEventListener('pagehide', settlePending)
    }
    // settlePending only reads refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A round whose page went away with no chance to pay it (a phone dropping a background tab, a crash) is paid on the
  // next visit. Only once sign-in has settled, so it lands in the wallet that took the stake and gets saved with it.
  useEffect(() => {
    if (authStatus === 'loading' || pending.current) return
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
    useWallet.getState().settle({ game: 'roboriot', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Robo Riot round paid out', amount: p.payout })
  }, [authStatus, uid])

  /* ---------------- playback ---------------- */

  /** banner time: turbo cuts it to 70%, as in the other slots */
  const hold = (ms: number) => (turboRef.current ? ms * 0.7 : ms)

  const say = (text: string | null) => {
    clearTimeout(captionTimer.current)
    setCaption(text == null ? null : { id: seq.current++, text })
  }

  /** Volt says something in a bubble beside his screen, with a chirp in his voice */
  const speak = (text: string, voice: 'happy' | 'sad' | 'wow' | 'alert' = 'happy') => {
    const sc = sceneRef.current
    if (!sc) return
    const at = sc.hostScreen()
    const f = sc.frameRect()
    setBubble({ id: seq.current++, text, x: at.x, y: at.y, side: (f.right - f.left) * 0.15 })
    roboSfx.voice(voice)
    clearTimeout(bubbleTimer.current)
    bubbleTimer.current = window.setTimeout(() => setBubble(null), turboRef.current ? 1200 : 1700)
  }

  /** a move from Volt, with the whine of his servos */
  const act = (a: HostAction) => {
    sceneRef.current?.host(a)
    roboSfx.servo()
  }

  /** shows a banner for `ms`; one with a count-up of `count` seconds jumps to its end on the first tap */
  const showBanner = (b: BannerData, ms: number, count = 0) =>
    new Promise<void>((resolve) => {
      const id = seq.current++
      let ends = performance.now() + count * 1000
      setBanner({ ...b, id })
      const sc = sceneRef.current
      if (b.kind === 'intro') {
        roboSfx.intro()
        sc?.confettiBurst(50)
      } else if (b.kind === 'max') {
        roboSfx.fanfare()
        sc?.coinShower(3.5)
      }
      const close = () => {
        clearTimeout(t)
        bannerDone.current = null
        sceneRef.current?.stopShower()
        setBanner(null)
        resolve()
      }
      let t = setTimeout(close, ms)
      bannerDone.current = {
        close,
        tap: () => {
          if (performance.now() >= ends) return close()
          ends = 0
          setBanner((x) => (x?.id === id ? { ...x, jump: true } : x))
          clearTimeout(t)
          t = setTimeout(close, hold(1200))
        },
      }
    })

  /** a win banner whose amount counts up through the tiers, with a coin shower; it closes 1.2 s after the count */
  const showWin = (b: { kind: 'big' } | { kind: 'end'; respins: number; filled: number; full: boolean }, amount: number, unit: number) => {
    const plan = countPlan(amount, unit)
    let count = plan[plan.length - 1][0] * (turboRef.current ? 0.6 : 1)
    if (b.kind === 'big' && autoRef.current) count = Math.min(count, 1.2)
    const ms = Math.max(b.kind === 'end' ? hold(3400) : 0, count * 1000 + hold(1200))
    if (b.kind === 'big' || amount >= unit * 20) sceneRef.current?.coinShower(ms / 1000)
    // the tiers bring their own fanfare; a smaller total gets the plain one
    if (tierIndex(amount / unit) < 0) roboSfx.win(2)
    return showBanner({ ...b, amount, unit, count }, ms, count)
  }

  /** a win banner's count passed a tier: a synth stab, fireworks and bolt cannons, steam, and Volt dances */
  const tierUp = (k: number) => {
    const sc = sceneRef.current
    roboSfx.tierUp(k)
    sc?.fireworks(ROCKETS[k])
    sc?.confettiCannons()
    sc?.steam(0.6 + k * 0.2)
    sc?.host(k >= 1 ? 'dance' : 'cheer')
  }

  /** the max win: a gold flash, bolts and gears from every side and the banner */
  const maxWin = (amount: number, unit: number) => {
    const sc = sceneRef.current
    sc?.flash('#ffd23f')
    sc?.confettiCannons()
    sc?.confettiBurst(140)
    sc?.fireworks(14)
    sc?.host('dance')
    return showBanner({ kind: 'max', amount, unit }, hold(3600))
  }

  /** amounts over the way wins, pushed apart where they would overlap */
  const wayPops = (ways: readonly WayWin[], coins: (m: number) => number): Pop[] => {
    const sc = sceneRef.current
    const out: Pop[] = []
    for (const w of [...ways].sort((a, b) => b.pay - a.pay).slice(0, 4)) {
      const at = sc?.screenOf(w.ids) ?? { x: 0, y: 0 }
      let y = at.y
      while (out.some((p) => Math.abs(p.y - y) < 34 && Math.abs(p.x - at.x) < 110)) y += 36
      out.push({ id: seq.current++, x: at.x, y, text: fmt(coins(w.pay)), color: SYMBOL_COLOR[w.sym], big: w.pay >= 5 })
    }
    return out
  }

  /** the paid spin: the drop (with its tease), Volt's Power Surge and the ways. Returns the ways win in coins, or null once the screen is gone. */
  const playBase = async (sc: RoboScene, base: BaseSpin, unit: number): Promise<number | null> => {
    const coins = (m: number) => round2(m * unit)
    bonusN.current = 0
    setHud((h) => ({ ...h, cells: 0 }))
    const tease = teaseColumn(base.grid)
    if (tease >= 0) void sc.wait(0.45 + 0.06 * tease).then(() => alive.current && !sc.hurried && roboSfx.tease())
    await sc.drop(base.grid, tease)
    if (!alive.current) return null

    if (base.surge) {
      const n = base.surge.length
      await sc.wait(0.2)
      if (!alive.current) return null
      setStamp({ id: seq.current++, kind: 'surge' })
      say(`Power Surge! Volt zaps in ${plural(n, 'power cell')}`)
      speak('POWER SURGE!', 'alert')
      roboSfx.charge()
      await sc.surge(base.surge, (i) => {
        const k = ++bonusN.current
        setHud((h) => ({ ...h, cells: k }))
        roboSfx.zap(i)
        roboSfx.cell(k)
      })
      if (!alive.current) return null
    }

    let win = 0
    if (base.ways.length) {
      await sc.highlight(base.ways)
      if (!alive.current) return null
      win = coins(base.waysWin)
      setPops(wayPops(base.ways, coins))
      setHud((h) => ({ ...h, win }))
      say(waysCaption(base.ways, coins))
      roboSfx.win(base.win >= 5 ? 2 : base.win >= 1 ? 1 : 0)
      if (base.win >= 2) {
        act(base.win >= 8 ? 'dance' : 'cheer')
        if (base.win >= 5) speak(base.win >= 15 ? 'RIOT!' : 'BEEP BOOP!', 'happy')
      } else if (base.win >= 1) act('clap')
      await sc.wait(base.trigger ? 0.8 : 1.1)
      if (!alive.current) return null
      setPops([])
    }

    if (base.trigger) deadRun.current = 0
    else if (base.bonusCount >= TRIGGER - 2) {
      // four or five power cells, and no surge: so close
      deadRun.current = 0
      say(`So close! ${base.bonusCount} power cells, ${TRIGGER} start the Power Grid`)
      act(base.bonusCount === TRIGGER - 1 ? 'facepalm' : 'shrug')
      speak('SO CLOSE…', 'sad')
    } else if (!win) {
      if (++deadRun.current % 7 === 0) {
        act('facepalm')
        roboSfx.voice('sad')
      }
    } else deadRun.current = 0
    return win
  }

  /**
   * The Power Grid: the trigger flare and intro banner, the switch to red alert, the starting bots, every respin with
   * its arrivals and abilities, the full-grid fanfare, the payout orbs, the end banner and back to the base game.
   */
  const playGrid = async (sc: RoboScene, round: Round, buy: Buy, unit: number, payout: number) => {
    const bonus = round.bonus!
    const coins = (m: number) => round2(m * unit)
    const cap = MAX_WIN * unit
    const pre = round.base?.win ?? 0
    /** Σ values on the board, multiples of the bet */
    let sum = 0
    let filled = 0
    let left = RESPINS
    let reset = 0
    const showTotal = () => setHud((h) => ({ ...h, win: Math.min(cap, coins(pre + sum)) }))
    const grid = (g: Partial<GridHud>) => setHud((h) => ({ ...h, grid: { left, filled, reset, last: false, ...h.grid, ...g } }))
    // a tap that sped up the reels (the usual quick stop) must not rush the feature it started: the Power Grid
    // begins at full speed, and a tap in it speeds up the rest
    sc.calm()

    /** one bot firing, with its caption, its sounds and the total counting along with every hit */
    const fire = async (a: Action) => {
      say(actionCaption(a))
      const goldT = a.persistent ? (sc.hurried ? 0.1 : 0.3) : 0
      if (a.persistent) roboSfx.gold()
      if (a.kind === 'zap') void sc.wait(goldT).then(() => alive.current && roboSfx.coil())
      else if (a.kind === 'boost') {
        roboSfx.charge(0.5)
        void sc.wait(goldT + (sc.hurried ? 0.12 : 0.3)).then(() => alive.current && roboSfx.boost())
      } else void sc.wait(goldT).then(() => alive.current && roboSfx.magnet())
      await sc.fire(
        a,
        (h, i) => {
          sum = round2(sum + h.to - h.from)
          showTotal()
          if (a.kind === 'zap') roboSfx.zap(i)
          else if (a.kind === 'boost') roboSfx.plus(i)
          else roboSfx.cash()
        },
        (i) => roboSfx.ping(i),
      )
      return alive.current
    }

    if (round.base) {
      // every power cell on the board flares
      roboSfx.trigger()
      speak('POWER GRID!', 'wow')
      await sc.flareBonus()
      if (!alive.current) return false
    }
    await showBanner({ kind: 'intro', super: buy === 'super', cells: bonus.start.length, surge: !!round.base?.surge, bought: buy !== 'none' }, hold(2600))
    if (!alive.current) return false

    // red alert: the tubes become sockets and the starting cells lock in
    roboSfx.alarm()
    setPops([])
    say(null)
    setHud((h) => ({ ...h, cells: 0, win: coins(pre), grid: { left, filled: 0, reset: 0, last: false } }))
    let clamped = 0
    const onClamp = sc.onClamp
    sc.onClamp = (pos, cell) => {
      onClamp?.(pos, cell)
      if (clamped >= bonus.start.length) return
      clamped++
      sum = round2(sum + (cell.value ?? 0))
      grid({ filled: clamped })
      showTotal()
    }
    await sc.enterGrid(bonus.start)
    sc.onClamp = onClamp
    if (!alive.current) return false
    filled = bonus.start.length
    sum = round2(bonus.start.reduce((a, pl) => a + (pl.cell.value ?? 0), 0))
    grid({ filled })
    showTotal()
    const gold = bonus.start.filter((pl) => pl.cell.gold).length
    say(gold ? `${plural(filled, 'cell')} locked · ${plural(gold, 'gold bot')} ${gold === 1 ? 'fires' : 'fire'} again whenever a new cell clamps in` : `${plural(filled, 'cell')} locked · ${RESPINS} respins`)
    if (gold) speak('GOLD BOT!', 'wow')
    await sc.wait(0.35)
    if (!alive.current) return false

    // the starting bots fire once
    for (const a of bonus.startActions) if (!(await fire(a))) return false

    for (const r of bonus.respins) {
      // long Power Grids speed up a little from the eighth respin on
      sc.setChain(r.index >= 8 ? 1 + Math.min(0.5, (r.index - 7) * 0.07) : 1)
      left--
      const last = left === 0
      grid({ left, last })
      if (last) {
        sc.heartbeat(true)
        say('Last respin!')
        roboSfx.heartbeat()
        if (!turboRef.current && !sc.hurried) await sc.wait(0.35)
        if (!alive.current) return false
      } else say(null)
      roboSfx.respin()
      await sc.respin(r.landed, (pl) => {
        filled++
        sum = round2(sum + (pl.cell.value ?? 0))
        grid({ filled })
        showTotal()
        if (pl.cell.gold) {
          say(`Gold ${pl.cell.sym} bot! It fires again whenever a new cell clamps in`)
          speak('GOLD!', 'wow')
        }
      })
      if (!alive.current) return false
      if (r.landed.length) {
        left = RESPINS
        reset++
        sc.heartbeat(false)
        sc.resetPulse()
        roboSfx.reset()
        grid({ left, reset, last: false })
        if (!r.actions.length) say(`${plural(r.landed.length, 'new cell')} · respins back to ${RESPINS}`)
      } else {
        left = r.left
        if (left > 0) say(`${plural(left, 'respin')} left`)
      }
      if (filled >= CELLS - 3 && filled < CELLS && r.landed.length) act('nervous')
      for (const a of r.actions) if (!(await fire(a))) return false
      sum = r.sum
      showTotal()
      await sc.wait(0.15)
      if (!alive.current) return false
    }
    sc.heartbeat(false)
    sc.setChain(1)
    grid({ left: 0, last: false, done: true })

    if (bonus.full) {
      setStamp({ id: seq.current++, kind: 'full' })
      say(`Full Grid! Every cell ×${FULL_MULT}`)
      speak('FULL GRID!', 'wow')
      roboSfx.fanfare()
      sum = bonus.total
      void sc.wait(0.3).then(() => alive.current && showTotal())
      await sc.fullBoard(true)
      if (!alive.current) return false
    }

    // the payout: every cell sends an orb into the total
    say(round.capped ? 'Max win reached!' : `Power Grid pays ${fmt(payout)}`)
    const box = totalRef.current?.getBoundingClientRect()
    const stageBox = hostRef.current?.getBoundingClientRect()
    const to = box && stageBox ? { x: box.left + box.width / 2 - stageBox.left, y: box.top + box.height / 2 - stageBox.top } : { x: 0, y: hudTop }
    roboSfx.charge(0.6)
    await sc.collect(to, (_id, _v, i) => {
      setPunch((n) => n + 1)
      roboSfx.collect(i)
    })
    if (!alive.current) return false
    setHud((h) => ({ ...h, win: payout }))

    if (round.capped) await maxWin(payout, unit)
    else {
      act(payout >= unit * 40 ? 'dance' : payout >= unit * 10 ? 'cheer' : 'clap')
      await showWin({ kind: 'end', respins: bonus.respins.length, filled, full: bonus.full }, payout, unit)
    }
    if (!alive.current) return false
    roboSfx.powerDown()
    say(null)
    setHud((h) => ({ ...h, grid: null, cells: 0, win: payout }))
    bonusN.current = 0
    await sc.exitGrid(calmGrid(rand))
    return alive.current
  }

  const play = async (buy: Buy): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const unit = bet
    const opts: PlayOpts = { buy, ante: buy === 'none' && ante }
    const price = buy === 'bonus' ? BUY_PRICE : buy === 'super' ? SUPER_PRICE : opts.ante ? ANTE_COST : 1
    const cost = round2(unit * price)
    if (!stake(cost)) return null
    busyRef.current = true
    setBusy(true)
    setPops([])
    say(null)
    setHud(EMPTY_HUD)
    sfx.spinStart()

    let round = playRound(rand, opts)
    if (import.meta.env.DEV) round = forced(round, opts)
    const payout = round2(unit * round.total)
    const bonus = round.bonus
    const filled = bonus ? bonus.start.length + bonus.respins.reduce((a, r) => a + r.landed.length, 0) : 0
    const meta = {
      buy,
      ante: round.ante,
      mult: payout / cost,
      feature: !!bonus,
      full: !!bonus?.full,
      gold: round.gold,
      maxCell: round.maxCell,
      cells: filled,
      respins: bonus?.respins.length ?? 0,
      surge: !!round.base?.surge,
      capped: round.capped,
    }
    // stored before the show starts, so even a page that never gets to settle can't lose the round
    const key = pendingKey(uid)
    pending.current = { bet: cost, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: cost, payout, meta }))

    if (round.base) {
      if ((await playBase(sc, round.base, unit)) == null) return null
    }
    if (bonus) {
      if (!(await playGrid(sc, round, buy, unit, payout))) return null
    } else if (round.capped) {
      await maxWin(payout, unit)
      if (!alive.current) return null
    }

    // a no-op if the page already paid it on its way out (and came back from the back/forward cache)
    settlePending()
    setLastWin(payout)
    setHud((h) => ({ ...h, win: payout }))
    if (!bonus && !round.capped && payout >= unit * 15) await showWin({ kind: 'big' }, payout, unit)
    if (!alive.current) return null
    sc.calm()
    captionTimer.current = window.setTimeout(() => setCaption(null), 2500)
    busyRef.current = false
    setBusy(false)
    return payout - cost
  }

  const auto = useAutoBet(() => play('none'), turbo ? 150 : 400)
  autoRef.current = auto.running
  const locked = busy || auto.running

  const hurry = () => {
    if (bannerDone.current) bannerDone.current.tap()
    else sceneRef.current?.hurry()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.code !== 'Space' || paytable || buying) return
      e.preventDefault()
      if (busyRef.current) hurry()
      else if (mode === 'manual') void play('none')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const spinCost = round2(bet * (ante ? ANTE_COST : 1))
  const buyCost = round2(bet * BUY_PRICE)
  const superCost = round2(bet * SUPER_PRICE)
  const grid = hud.grid
  const gridSub = grid ? (grid.done ? 'Power Grid · payout' : grid.last ? 'Power Grid · last respin' : `Power Grid · ${plural(grid.left, 'respin')} left`) : undefined

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={locked} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Last win" value={fmt(lastWin)} tone={lastWin > 0 ? 'accent' : undefined} />
        <Stat label="Max win" value={`${fmt(MAX_WIN, 0)}×`} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <span className="text-[13px] font-semibold text-muted">Turbo</span>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${ante ? 'bg-[#ff8a2a]/12 ring-1 ring-[#ff8a2a]/45' : 'bg-stage'}`}>
        <div className="min-w-0">
          <div className={`flex items-center gap-1.5 text-[13px] font-semibold ${ante ? 'text-[#ffb070]' : 'text-muted'}`}>
            <BoltIcon className="h-3.5 w-3.5" color={ante ? '#ff8a2a' : 'currentColor'} />
            Overclock
          </div>
          <div className="text-[11px] font-semibold text-dim">Spins {ANTE_COST}× · Power Grid 1.6× as often</div>
        </div>
        <Toggle on={ante} onChange={setAnte} disabled={locked} label="Overclock" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div>
        <div className="grid grid-cols-2 gap-2" title={ante ? 'Turn off Overclock to buy' : undefined}>
          <BuyButton label="Power Grid" cost={buyCost} tone="cyan" disabled={locked || !ready || ante || balance < buyCost} onClick={() => (sfx.click(), setBuying('bonus'))} />
          <BuyButton label="Super Grid" cost={superCost} tone="gold" disabled={locked || !ready || ante || balance < superCost} onClick={() => (sfx.click(), setBuying('super'))} />
        </div>
        {ante && <div className="mt-1.5 text-center text-[11px] font-semibold text-dim">Turn off Overclock to buy</div>}
      </div>
      <button onClick={() => (sfx.click(), setPaytable(true))} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Paytable
      </button>
      <div className="max-lg:order-first lg:mt-auto">
        {auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop} sub={gridSub}>
            Stop autospin
          </ActionButton>
        ) : grid ? (
          <ActionButton tone="gold" onClick={hurry} sub="Tap to speed up">
            {gridSub}
          </ActionButton>
        ) : busy ? (
          <ActionButton tone="neutral" onClick={hurry} sub="Tap to speed up">
            Spinning…
          </ActionButton>
        ) : mode === 'manual' ? (
          <ActionButton onClick={() => void play('none')} disabled={!ready || balance < spinCost} sub={ante ? `Overclock · ${fmt(spinCost)}` : undefined}>
            Spin
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || balance < spinCost} sub={ante ? `Overclock · ${fmt(spinCost)}` : undefined}>
            Start autospin
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#0a0b26]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* counters and caption under the machine */}
      <div className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1.5 px-2" style={{ top: hudTop }}>
        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {grid ? (
              <motion.div
                key="respins"
                layout
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={`${pill} relative transition-colors ${grid.last ? '!border-[#ff5468] !bg-[#3a1030]/95' : ''}`}
                aria-label={grid.last ? 'Last respin' : `${grid.left} respins left`}
              >
                <span className={`${pillLabel} ${grid.last ? 'text-[#ff7a8a]' : 'text-[#9ff4ff]/80'}`}>{grid.last ? 'Last' : 'Respins'}</span>
                <span className="flex items-center gap-0.5">
                  {Array.from({ length: RESPINS }, (_, i) => (
                    <motion.span
                      key={`${i}-${i < grid.left}-${grid.reset}`}
                      initial={i < grid.left ? { scale: 1.9, rotate: -20 } : false}
                      animate={grid.last ? { scale: [1, 1.18, 1], opacity: [0.5, 1, 0.5] } : { scale: 1, rotate: 0 }}
                      transition={grid.last ? { duration: 0.7, repeat: Infinity } : { type: 'spring', stiffness: 520, damping: 14, delay: i * 0.05 }}
                    >
                      <BoltIcon on={i < grid.left} danger={grid.last} className="h-4 w-3 sm:h-[18px] sm:w-3.5" />
                    </motion.span>
                  ))}
                </span>
                {grid.reset > 0 && (
                  <motion.span
                    key={grid.reset}
                    className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full border-2 border-[#1b1634] bg-[#5cf2ff] px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-wider text-[#1b1634] shadow-[0_2px_0_#1b1634]"
                    initial={{ opacity: 0, scale: 0.5, y: 8 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.15, 1, 1], y: [8, 0, 0, -6] }}
                    transition={{ duration: 1.3, times: [0, 0.15, 0.75, 1] }}
                  >
                    Reset
                  </motion.span>
                )}
              </motion.div>
            ) : (
              <motion.div key="cells" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`${pillBase} gap-0.5 px-3 sm:gap-1 sm:px-4`} aria-label={`${hud.cells} power cells`}>
                {Array.from({ length: TRIGGER }, (_, i) => (
                  <motion.span
                    key={`${i}-${i < hud.cells}`}
                    initial={i < hud.cells ? { scale: 1.9, y: -4 } : false}
                    animate={hud.cells >= TRIGGER - 2 && hud.cells < TRIGGER && i >= hud.cells ? { opacity: [0.45, 1, 0.45] } : { scale: 1, y: 0 }}
                    transition={hud.cells >= TRIGGER - 2 && i >= hud.cells ? { duration: 0.6, repeat: Infinity } : { type: 'spring', stiffness: 500, damping: 15 }}
                  >
                    <CellIcon on={i < hud.cells} className="h-[21px] w-[14px] sm:h-6 sm:w-4" />
                  </motion.span>
                ))}
                {hud.cells > TRIGGER && (
                  <motion.span key={hud.cells} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="tnum ml-0.5 text-[13px] font-black text-[#9ff4ff]">
                    ×{hud.cells}
                  </motion.span>
                )}
              </motion.div>
            )}
            {(grid || hud.win > 0) && (
              <motion.div key="win" ref={totalRef} layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={`${pill} relative`}>
                <span className={`${pillLabel} text-gold/80`}>{grid ? 'Total' : 'Win'}</span>
                <motion.span key={punch} initial={{ scale: punch ? 1.22 : 1 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 14 }} className="inline-block">
                  <Counter value={hud.win} className="text-[15px] font-black text-gold sm:text-[18px]" />
                </motion.span>
              </motion.div>
            )}
            {grid && (
              <motion.div key="filled" layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill} aria-label={`${grid.filled} of ${CELLS} sockets filled`}>
                <span className={`${pillLabel} text-white/60`}>Cells</span>
                <motion.span key={grid.filled} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className={`tnum text-[15px] font-black sm:text-[18px] ${grid.filled >= CELLS ? 'text-gold' : 'text-white'}`}>
                  {grid.filled}
                  <span className="text-[11px] font-bold text-white/45 sm:text-[13px]">/{CELLS}</span>
                </motion.span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="relative h-5 w-full max-w-[560px]" aria-live="polite">
          <AnimatePresence initial={false}>
            {caption && (
              <motion.div
                key={caption.id}
                className="absolute inset-0 truncate text-center text-[13px] font-bold text-white/90 [text-shadow:0_1.5px_0_#1b1634,0_0_3px_#1b1634]"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
              >
                {caption.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* amounts over each way win */}
      <AnimatePresence>
        {pops.map((p) => (
          <motion.div
            key={p.id}
            className="tnum pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap font-black"
            style={{ left: p.x, top: p.y }}
            initial={{ opacity: 0, scale: 0.4, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: -6 }}
            exit={{ opacity: 0, scale: 1.15, y: -26, transition: { duration: 0.35 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <span
              className={`inline-block ${p.big ? 'text-[28px] sm:text-[36px]' : 'text-[22px] sm:text-[28px]'}`}
              // cartoon lettering: an ink outline and a hard drop, no glow
              style={{ color: p.big ? '#ffe14a' : '#fff', WebkitTextStroke: '5px #1b1634', paintOrder: 'stroke fill', textShadow: '0 4px 0 #1b1634' }}
            >
              {p.text}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {bubble && (
          <motion.div
            key={bubble.id}
            className="pointer-events-none absolute z-20"
            style={{ right: `calc(100% - ${bubble.x - bubble.side}px)`, top: bubble.y - 18 }}
            initial={{ opacity: 0, scale: 0.4, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 20 }}
          >
            {/* a cartoon speech bubble, inked like the machine */}
            <div className="relative whitespace-nowrap rounded-xl border-[2.5px] border-[#1b1634] bg-white px-2.5 py-1 text-[12px] font-black uppercase tracking-wide text-[#1b1634] shadow-[0_3px_0_rgba(27,22,52,.55)] sm:px-3 sm:text-[14px]">
              {bubble.text}
              <span className="absolute -right-[8px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-r-[2.5px] border-t-[2.5px] border-[#1b1634] bg-white" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {stamp && <StampFx key={stamp.id} kind={stamp.kind} onDone={() => setStamp(null)} />}

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} onTap={() => bannerDone.current?.tap()} onTier={tierUp} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,#171b46_0%,#0a0b26_72%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Booting the bots" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100vw+156px)] max-sm:min-h-[460px]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(null)} title={buying === 'super' ? 'Buy Super Grid' : 'Buy Power Grid'} width={400}>
            <p className="text-[14px] text-muted">
              {buying === 'super' ? (
                <>
                  The Power Grid with {TRIGGER} power cells plus a <span className="font-bold text-[#ffcf3a]">gold bot</span> that fires again whenever a new cell clamps in, for{' '}
                  <span className="font-bold text-ink">{fmt(superCost)}</span> coins, {fmt(SUPER_PRICE, 0)}× your bet.
                </>
              ) : (
                <>
                  Go straight to the Power Grid with {TRIGGER} power cells on random sockets and {RESPINS} respins for <span className="font-bold text-ink">{fmt(buyCost)}</span> coins,{' '}
                  {BUY_PRICE}× your bet.
                </>
              )}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => setBuying(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="gold"
                disabled={balance < (buying === 'super' ? superCost : buyCost)}
                onClick={() => {
                  setBuying(null)
                  void play(buying)
                }}
              >
                Buy
              </ActionButton>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

/** an inked counter pill, flat like the cabinet (no glow) */
const pillBase = 'flex h-8 items-center rounded-full border-2 border-[#1b1634] bg-[#151c52]/95 shadow-[0_3px_0_rgba(27,22,52,.6),inset_0_1.5px_0_rgba(255,255,255,.13)] sm:h-10'
/** a counter pill: label over value on phones, so three of them fit across; side by side from sm up */
const pill = `${pillBase} flex-col justify-center gap-0.5 px-3.5 leading-none sm:flex-row sm:gap-2 sm:px-4`
const pillLabel = 'text-[9px] font-bold uppercase tracking-wider sm:text-[11px]'

/** A number that counts up to its value. */
function Counter({ value, className = '' }: { value: number; className?: string }) {
  const [n, setN] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const c = animate(from.current, value, { duration: value > from.current ? 0.5 : 0, ease: 'easeOut', onUpdate: (v) => ((from.current = v), setN(v)) })
    return () => c.stop()
  }, [value])
  return <span className={`tnum ${className}`}>{fmt(n)}</span>
}

function BuyButton({ label, cost, tone, disabled, onClick }: { label: string; cost: number; tone: 'cyan' | 'gold'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 font-extrabold shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-40 ${
        tone === 'cyan' ? 'bg-[linear-gradient(180deg,#a6f9ff,#2fd0ea)] text-[#03252c]' : 'bg-[linear-gradient(180deg,#ffe58a,#f5b41f)] text-[#3a2400]'
      }`}
    >
      <span className="text-[14px] leading-none">{label}</span>
      <span className="tnum rounded bg-black/15 px-1.5 py-0.5 text-[12px] leading-none">{fmt(cost, cost >= 1000 ? 0 : 2)}</span>
    </button>
  )
}

/** a power cell: the HUD pips (dim until one lands) and the banners */
function CellIcon({ on = true, gold = false, className = '' }: { on?: boolean; gold?: boolean; className?: string }) {
  // drawn like the 3D cell: flat colours, an ink outline and a hard white shine (dim and outline-free until one lands)
  const ink = '#1b1634'
  const core = gold ? '#ffcf3a' : '#5cf2ff'
  const cap = on ? (gold ? '#ffb020' : '#c3cde6') : 'rgba(255,255,255,.16)'
  return (
    <svg viewBox="0 0 20 32" className={className} aria-hidden>
      <rect x="3.5" y="5" width="13" height="22" rx="3.5" fill={on ? (gold ? '#fff2c4' : '#e2fdff') : 'rgba(255,255,255,.05)'} stroke={on ? ink : 'rgba(255,255,255,.22)'} strokeWidth={on ? 1.8 : 1.5} />
      {on && (
        <>
          <rect x="6.5" y="8.5" width="7" height="15" rx="2.5" fill={core} stroke={ink} strokeWidth="1.2" />
          <path d="M11.2 10.3 8.3 16.6h2.6l-1.3 5.3 3.6-7h-2.6l1.3-4.6Z" fill="#fff" stroke={ink} strokeWidth=".9" strokeLinejoin="round" />
          <rect x="4.9" y="7.2" width="1.6" height="7" rx=".8" fill="#fff" opacity=".9" />
        </>
      )}
      <rect x="2" y="1.5" width="16" height="5" rx="2" fill={cap} stroke={on ? ink : 'none'} strokeWidth="1.5" />
      <rect x="2" y="25.5" width="16" height="5" rx="2" fill={cap} stroke={on ? ink : 'none'} strokeWidth="1.5" />
    </svg>
  )
}

/** a lightning bolt: the respin pips and the Overclock label */
function BoltIcon({ on = true, danger = false, color, ink = false, className = '' }: { on?: boolean; danger?: boolean; color?: string; ink?: boolean; className?: string }) {
  const fill = color ?? (on ? (danger ? '#ff5468' : '#5cf2ff') : 'rgba(255,255,255,.12)')
  // the pips and the big bolts are inked like the machine; the small label bolt in the panel stays plain
  const inked = on && (ink || !color)
  return (
    <svg viewBox="-1 -1 16 22" className={className} aria-hidden>
      <path
        d="M9 1 2 11.2h4.4L4.6 19 12 8.6H7.6L9 1Z"
        fill={fill}
        stroke={inked ? '#1b1634' : danger ? 'rgba(255,84,104,.6)' : 'none'}
        strokeWidth={inked ? 1.6 : 1}
        strokeLinejoin="round"
      />
      {inked && <path d="M8.2 3.6 5 8.6" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" opacity=".85" />}
    </svg>
  )
}

/** the big moments: POWER SURGE! and FULL GRID ×2 slam across the stage; taps go straight through */
function StampFx({ kind, onDone }: { kind: 'surge' | 'full'; onDone: () => void }) {
  const full = kind === 'full'
  const grad = full ? 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]' : 'bg-[linear-gradient(180deg,#ffffff_0%,#a8f7ff_40%,#22c7f0_100%)]'
  const word = full ? 'Full grid' : 'Power surge!'
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[42%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      initial={{ scale: 2.4, opacity: 0, rotate: -10 }}
      animate={{ scale: [2.4, 0.92, 1, 1, 1.1], opacity: [0, 1, 1, 1, 0], rotate: -6 }}
      transition={{ duration: full ? 2 : 1.5, times: [0, 0.12, 0.2, 0.82, 1], ease: 'easeOut' }}
      onAnimationComplete={onDone}
    >
      <Toon look={grad} stroke={10} className="whitespace-nowrap text-[40px] font-black uppercase italic leading-none tracking-tight sm:text-[64px]">
        {word}
      </Toon>
      {full && (
        <motion.div initial={{ scale: 0 }} animate={{ scale: [0, 1.4, 1] }} transition={{ delay: 0.25, duration: 0.45 }}>
          <Toon look="bg-[linear-gradient(100deg,#5cf2ff_0%,#ff3fd2_35%,#ffe14a_65%,#59ff7a_100%)]" stroke={12} className="mt-1 text-[56px] font-black italic leading-none sm:text-[84px]">
            ×{FULL_MULT}
          </Toon>
        </motion.div>
      )}
    </motion.div>
  )
}

/** light rays behind a banner, one colour per ray in turn */
const rays = (...colors: string[]) =>
  `repeating-conic-gradient(from 0deg, ${colors.map((c, i) => `${c} ${i * 22.5}deg ${i * 22.5 + 7}deg, transparent ${i * 22.5 + 7}deg ${(i + 1) * 22.5}deg`).join(', ')})`
const GRID_RAYS = rays('rgba(92,242,255,.38)', 'rgba(255,63,210,.3)')
const GOLD_RAYS = rays('rgba(255,200,61,.38)', 'rgba(92,242,255,.3)')
/** each win tier's title gradient and rays: cyan, magenta, gold, then an electric rainbow for a Riot */
const TIER_LOOK = [
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#a8f7ff_45%,#22c7f0_100%)]', rays: rays('rgba(92,242,255,.36)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#ffc2f1_45%,#ff3fd2_100%)]', rays: rays('rgba(255,63,210,.36)', 'rgba(92,242,255,.3)') },
  { text: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]', rays: rays('rgba(255,200,61,.36)', 'rgba(255,63,210,.3)') },
  {
    text: 'bg-[linear-gradient(100deg,#5cf2ff_0%,#ff3fd2_30%,#ffe14a_55%,#59ff7a_78%,#5cf2ff_100%)]',
    rays: rays('rgba(92,242,255,.36)', 'rgba(255,63,210,.34)', 'rgba(255,225,74,.34)', 'rgba(89,255,122,.3)'),
  },
]
const CYAN_TEXT = TIER_LOOK[0].text
const GOLD_TEXT = TIER_LOOK[2].text
/**
 * A cartoon title, lettered like the ROBO / RIOT boards: the gradient over a thick ink outline with a hard drop under it.
 * The outline is a copy of the text behind, stroked, so the stroke never eats into the letters.
 */
function Toon({ children, className, look, stroke = 8 }: { children: ReactNode; className: string; look: string; stroke?: number }) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute inset-0 text-[#1b1634] [filter:drop-shadow(0_4px_0_#1b1634)]" style={{ WebkitTextStroke: `${stroke}px #1b1634` }} aria-hidden>
        {children}
      </span>
      <span className={`relative bg-clip-text text-transparent ${look}`}>{children}</span>
    </div>
  )
}

function BannerCard({ banner, onTap, onTier }: { banner: Banner; onTap: () => void; onTier: (k: number) => void }) {
  const counting = banner.kind === 'big' || banner.kind === 'end'
  const secs = counting ? banner.count : 0
  const amount = 'amount' in banner ? banner.amount : null
  const unit = 'unit' in banner ? banner.unit : 1
  const [n, setN] = useState(0)
  const [tier, setTier] = useState(-1)
  const [counted, setCounted] = useState(!counting)
  const count = useRef<{ stop: () => void } | null>(null)
  const reached = useRef(-1)
  const tierRef = useRef(onTier)
  tierRef.current = onTier

  /** shows an amount; as a count-up passes each tier the title punches up to it */
  const show = (v: number) => {
    setN(v)
    const k = tierIndex(v / unit + 1e-9)
    if (counting && k > reached.current) {
      reached.current = k
      setTier(k)
      tierRef.current(k)
    }
  }

  useEffect(() => {
    if (amount == null) return
    if (!counting) {
      const c = animate(0, amount, { duration: 1.6, ease: [0.2, 0.7, 0.3, 1], onUpdate: setN })
      return () => c.stop()
    }
    const plan = countPlan(amount, unit)
    const k = plan[plan.length - 1][0] / secs
    const c = animate(0, secs, { duration: secs, ease: 'linear', onUpdate: (t) => show(countAt(plan, t * k)), onComplete: () => setCounted(true) })
    count.current = c
    return () => c.stop()
    // a banner never changes its amount; a tap to skip arrives as `jump`, below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner.id])

  useEffect(() => {
    if (!banner.jump || amount == null) return
    count.current?.stop()
    show(amount)
    setCounted(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [banner.jump])

  const finalTier = amount == null ? -1 : tierIndex(amount / unit)
  const look = banner.kind === 'intro' ? (banner.super ? GOLD_RAYS : GRID_RAYS) : banner.kind === 'max' ? GOLD_RAYS : TIER_LOOK[Math.max(0, tier)].rays
  const money = amount != null && (
    <div className="tnum relative mt-3 flex items-center gap-2 text-[34px] font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,.5)] sm:text-[44px]">
      {fmt(n)} <Coin size={34} />
    </div>
  )
  const tierTitle = (
    <div className="relative flex h-[40px] items-center justify-center sm:h-[56px]">
      <AnimatePresence mode="popLayout">
        {tier >= 0 && (
          <motion.div
            key={tier}
            initial={{ scale: 1.25, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 12 }}
          >
            <Toon look={TIER_LOOK[tier].text} className="whitespace-nowrap text-[34px] font-black uppercase italic leading-none tracking-tight sm:text-[50px]">
              {TIERS[tier].name}
            </Toon>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  let body: ReactNode
  if (banner.kind === 'intro') {
    const sup = banner.super
    body = (
      <>
        <div className="relative mb-2 flex items-end gap-2">
          <motion.div animate={{ y: [0, -5, 0], rotate: [-12, -4, -12] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}>
            <CellIcon className="h-11 w-7" />
          </motion.div>
          <motion.div animate={{ y: [0, -8, 0], scale: [1, 1.08, 1] }} transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}>
            <BoltIcon className="h-16 w-12" color={sup ? '#ffcf3a' : '#ffe14a'} ink />
          </motion.div>
          <motion.div animate={{ y: [0, -5, 0], rotate: [12, 4, 12] }} transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}>
            <CellIcon gold={sup} className="h-11 w-7" />
          </motion.div>
        </div>
        <Toon look={sup ? GOLD_TEXT : CYAN_TEXT} className="text-[44px] font-black uppercase italic leading-none tracking-tight sm:text-[64px]">
          {sup ? 'Super Grid' : 'Power Grid'}
        </Toon>
        <div className="relative mt-3 flex items-baseline gap-2">
          <Toon look={CYAN_TEXT} className="text-[52px] font-black leading-none">{RESPINS}</Toon>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.3em] text-white/80">respins</span>
        </div>
        <div className="relative mt-2 max-w-[300px] text-[14px] font-bold text-white/85">
          {banner.surge
            ? `Volt's Power Surge did it! ${banner.cells} cells lock in`
            : banner.bought
              ? `${banner.cells} power cells lock in${sup ? ', one of them a gold bot' : ''}`
              : `${banner.cells} power cells lock in`}
        </div>
        <div className="relative mt-1 text-[12px] font-semibold text-white/55">Anything new locks and resets the respins to {RESPINS}</div>
      </>
    )
  } else if (banner.kind === 'big') {
    body = (
      <>
        {tierTitle}
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(banner.amount / unit, 2)}× your bet</div>
      </>
    )
  } else if (banner.kind === 'end') {
    body = (
      <>
        <Toon look={CYAN_TEXT} stroke={7} className="text-[28px] font-black uppercase italic leading-none tracking-tight sm:text-[38px]">Power down!</Toon>
        {banner.full && (
          <motion.div
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: -4 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.2 }}
            className="relative mt-3 rounded-md border-2 border-[#1b1634] bg-[linear-gradient(180deg,#ffe58a,#f5b41f)] px-2.5 py-1 text-[13px] font-black uppercase tracking-wider text-[#3a2400] shadow-[0_3px_0_#1b1634]"
          >
            Full grid ×{FULL_MULT}
          </motion.div>
        )}
        {finalTier >= 0 && tierTitle}
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">
          {plural(banner.respins, 'respin')} · {banner.filled}/{CELLS} cells · {fmt(banner.amount / unit, 2)}×
        </div>
      </>
    )
  } else {
    body = (
      <>
        <Toon look={GOLD_TEXT} className="text-[40px] font-black uppercase italic leading-none tracking-tight sm:text-[56px]">
          Max win
        </Toon>
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(MAX_WIN, 0)}× your bet</div>
      </>
    )
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-[#050820]/70 p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.25 } }}
      onPointerDown={(e) => {
        e.stopPropagation()
        onTap()
      }}
    >
      <motion.div
        initial={{ scale: 0.4, y: 40, rotate: -6 }}
        animate={{ scale: 1, y: 0, rotate: 0 }}
        exit={{ scale: 0.9, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 14 }}
        className="relative flex flex-col items-center text-center"
      >
        <motion.div
          className="pointer-events-none absolute left-1/2 top-1/2 h-[440px] w-[440px] -translate-x-1/2 -translate-y-1/2"
          animate={{ rotate: 360 }}
          transition={{ duration: 14, repeat: Infinity, ease: 'linear' }}
        >
          <AnimatePresence initial={false}>
            <motion.div
              key={look}
              className="absolute inset-0 rounded-full [mask-image:radial-gradient(circle,black_20%,transparent_68%)]"
              style={{ background: look }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            />
          </AnimatePresence>
        </motion.div>
        {body}
        <div className="relative mt-4 text-[11px] font-semibold uppercase tracking-widest text-white/40">{counted ? 'Tap to continue' : 'Tap to skip'}</div>
      </motion.div>
    </motion.div>
  )
}

function PaytableModal({ bet, thumbs, onClose }: { bet: number; thumbs: Partial<Record<ThumbKey, string>>; onClose: () => void }) {
  const pic = (s: ThumbKey, size = 40) =>
    thumbs[s] ? (
      <img src={thumbs[s]} alt="" width={size} height={size} className="shrink-0" />
    ) : (
      <span
        className="shrink-0 rounded-full"
        style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, background: s === 'host' ? '#5cf2ff' : s.endsWith('Gold') ? '#ffcf3a' : SYMBOL_COLOR[s as keyof typeof SYMBOL_COLOR] }}
      />
    )
  const money = (m: number) => {
    const a = round2(bet * m)
    return a >= 100000 ? fmtCompact(a) : fmt(a, a >= 1000 ? 0 : 2)
  }
  const cols = 'grid-cols-[44px_repeat(3,minmax(0,1fr))] sm:grid-cols-[180px_repeat(3,minmax(0,1fr))]'
  const bots: BotKind[] = ['zap', 'boost', 'magnet']
  return (
    <Modal onClose={onClose} title="Paytable" width={620}>
      <p className="text-[13px] text-muted">
        5 reels, 5 rows and 3,125 ways. Matching robots on 3, 4 or 5 neighbouring reels from the left win, and every combination of them counts: 2 Rex on reel 1, 1 on reel 2 and 3 on reel 3 is 6
        ways. Amounts per way, for your bet of {fmt(bet)}.
      </p>
      <div className={`mt-3 grid ${cols} items-center gap-x-1 px-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-dim sm:text-[11px]`}>
        <span className="text-left">
          <span className="hidden sm:inline">Symbol</span>
        </span>
        {['3 reels', '4 reels', '5 reels'].map((b) => (
          <span key={b} className="whitespace-nowrap">
            {b}
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {PAY_SYMS.map((s) => (
          <div key={s} className={`grid ${cols} items-center gap-x-1 rounded-lg bg-stage px-1.5 py-0.5`}>
            <div className="flex min-w-0 items-center gap-2">
              {pic(s, 40)}
              <span className="hidden truncate text-[13px] font-bold sm:inline">{SYMBOL_NAME[s]}</span>
            </div>
            {PAYS[s].map((m, i) => (
              <span key={i} className="tnum text-center text-[12px] font-extrabold sm:text-[13px]">
                {money(m)}
              </span>
            ))}
          </div>
        ))}
      </div>

      <Card tone="#ff3fd2" icon={pic('wild', 48)}>
        <span className="font-bold text-ink">Wild core</span> lands on reels 2 to 5 and stands in for every robot and part. Power cells and bots never take part in ways.
      </Card>

      <div className="mt-2 rounded-lg px-3 py-3" style={{ background: '#5cf2ff1a', boxShadow: 'inset 0 0 0 1px #5cf2ff40' }}>
        <div className="flex items-center gap-1">
          {(['cell', 'zap', 'boost', 'magnet'] as const).map((k) => (
            <span key={k}>{pic(k, 48)}</span>
          ))}
        </div>
        <p className="mt-2 text-[13px] text-muted">
          <span className="font-bold text-ink">Power cells and bots</span> land anywhere, each showing a value from 1 to 50 (times your bet). {TRIGGER} or more on the board start the{' '}
          <span className="font-bold text-ink">Power Grid</span>: they lock in their sockets and you get {RESPINS} respins. Every empty socket spins on its own; anything that lands locks
          and resets the respins to {RESPINS}. It ends when the respins run out or all {CELLS} sockets are full. You win the sum of every cell, and a{' '}
          <span className="font-bold text-ink">Full Grid</span> doubles it.
        </p>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {bots.map((k) => (
          <div key={k} className="flex flex-col items-center rounded-lg px-3 py-3 text-center" style={{ background: `${BOT_COLOR[k]}14`, boxShadow: `inset 0 0 0 1px ${BOT_COLOR[k]}40` }}>
            {pic(k, 64)}
            <div className="mt-1 text-[13px] font-bold text-ink">{BOT_NAME[k]}</div>
            <div className="mt-0.5 text-[12px] text-muted">{k === 'zap' ? `Fires ${ZAP_BOLTS} bolts at power cells; each doubles the cell it hits.` : BOT_TEXT[k]}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-[12px] text-dim">Bots fire once when they lock: zaps first, then boosts, then magnets. They work on power cells only, never on other bots, and pay their own value too.</p>

      <Card tone="#ffcf3a" icon={<span className="flex shrink-0 -space-x-3">{(['zapGold', 'boostGold', 'magnetGold'] as const).map((k) => <span key={k}>{pic(k, 40)}</span>)}</span>}>
        <span className="font-bold text-ink">Gold bots</span> land only on Power Grid respins (the Super Grid starts with one). They fire when they lock, then again every time a new cell clamps in, for the rest of the Power Grid.
      </Card>
      <Card tone="#5cf2ff" icon={pic('host', 48)}>
        <span className="font-bold text-ink">Power Surge!</span> When 4 or 5 power cells land on a paid spin, Volt sometimes zaps in the missing ones and starts the Power Grid.
      </Card>
      <Card tone="#ff8a2a" icon={<BoltIcon className="mx-2 h-10 w-8 shrink-0" color="#ff8a2a" ink />}>
        <span className="font-bold text-ink">Buy the Power Grid</span> for {BUY_PRICE}× the bet ({money(BUY_PRICE)}): it starts with {TRIGGER} power cells or bots on random sockets.{' '}
        <span className="font-bold text-ink">Super Grid</span> costs {fmt(SUPER_PRICE, 0)}× ({money(SUPER_PRICE)}): the same plus a gold bot on a seventh socket.{' '}
        <span className="font-bold text-ink">Overclock</span> makes each spin cost {ANTE_COST}× the bet with the same pays and starts the Power Grid about 1.6× as often; the buys are off
        while it is on.
      </Card>
      <p className="mt-3 text-[12px] text-dim">
        A round pays at most {fmt(MAX_WIN, 0)}× the bet. Simulated return to player: 96.0% for spins, 96.1% with Overclock and for both buys.
      </p>
    </Modal>
  )
}

function Card({ tone, icon, children }: { tone: string; icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-2 flex items-start gap-3 rounded-lg px-3 py-3" style={{ background: `${tone}1a`, boxShadow: `inset 0 0 0 1px ${tone}40` }}>
      {icon}
      <div className="text-[13px] text-muted">{children}</div>
    </div>
  )
}
