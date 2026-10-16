import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, fmtCompact, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import {
  ANTE_COST,
  BUY_PRICE,
  BUY_SPINS,
  COLS,
  CONFIG,
  CROWD_MULT,
  EGGS_TO_TRIGGER,
  EGG_PAYS,
  EGG_SPINS,
  EXTRA_SPINS,
  FEAST_MODS,
  LEVEL_MULTS,
  LEVEL_SPINS,
  MAX_LEVEL,
  MAX_WIN,
  PAYS,
  PAY_SYMS,
  RAIN_MULT,
  SUPER_MODS,
  SUPER_PRICE,
  WILDS_PER_LEVEL,
  cellsOf,
  eggOdds,
  playRound,
  type Buy,
  type Config,
  type Feast,
  type FeastMod,
  type Grid,
  type PaySym,
  type PlayOpts,
  type Round,
  type Spin,
  type Sym,
} from './rules'
import { SYMBOL_COLOR, SYMBOL_NAME, donutColor } from './meta'
import type { ChompScene } from './scene'

/*
  Chompers: five reels of cartoon monsters and snacks, 1,024 ways, with Big Mama Chomp peering over the machine. The
  round is drawn in full when the spin is placed (rules.ts); this screen plays it back through the 3D scene (the
  Feast Pick included, which only presents a modifier that is already drawn) and settles when the show is over.
*/

type BannerData =
  | { kind: 'intro'; spins: number; super: boolean }
  | { kind: 'level'; spins: number; mult: number }
  | { kind: 'big'; amount: number; unit: number; count: number }
  | { kind: 'end'; amount: number; unit: number; count: number; spins: number }
  | { kind: 'max'; amount: number; unit: number }
/** `jump`: the player tapped during the count-up, so the banner shows its final amount and tier */
type Banner = BannerData & { id: number; jump?: boolean }
/** an amount over a win; `mult` tags a collect that is multiplied */
type Pop = { id: number; x: number; y: number; amount: number; color: string; big?: boolean; mult?: number }
type Meter = { filled: number; level: number }
type Hud = { win: number; free: { left: number; played: number } | null; meter: Meter | null; mods: FeastMod[] }
type Spot = { x: number; y: number; r: number }
/** the Feast Pick overlay: tap targets over the 3D eggs, then the line under the hatched card */
type FeastUi =
  | { id: number; phase: 'pick'; spots: Spot[]; secs: number; super: boolean }
  /** `egg`: the one picked (0-2), `pick`: what it hatched */
  | { id: number; phase: 'reveal'; spots: Spot[]; egg: number; pick: FeastMod; super: boolean }

const EMPTY_HUD: Hud = { win: 0, free: null, meter: null, mods: [] }

/** the win banner tiers, in multiples of the bet */
const TIERS = [
  { min: 15, name: 'Big feast' },
  { min: 40, name: 'Mega feast' },
  { min: 100, name: 'Epic feast' },
  { min: 500, name: 'Monster feast!' },
] as const
/** the highest tier reached by a win of `mult` × bet, or -1 below the first */
const tierIndex = (mult: number) => TIERS.reduce((i, t, k) => (mult >= t.min ? k : i), -1)

/** each Feast Pick modifier: its name, the colour of its card (models.ts) and what it does */
const MOD: Record<FeastMod, { name: string; color: string; line: string }> = {
  hungry: { name: 'Hungry', color: '#2ee87f', line: `Collects pay ×${LEVEL_MULTS[1]} from the first spin` },
  rain: { name: 'Donut rain', color: '#ff7ac8', line: `Donuts land ${RAIN_MULT}× as often` },
  crowd: { name: 'Wild crowd', color: '#ffc93d', line: `Wilds land ${CROWD_MULT}× as often` },
  extra: { name: `+${EXTRA_SPINS} spins`, color: '#3db4ff', line: `${EXTRA_SPINS} more free spins to feast on` },
}

const PLURAL: Record<PaySym, string> = {
  grumbo: 'Grumbos',
  fang: 'Fangs',
  blip: 'Blips',
  mimi: 'Mimis',
  cupcake: 'Cupcakes',
  lolly: 'Lollipops',
  cookie: 'Cookies',
  gummy: 'Gummies',
  candy: 'Candies',
}

/** percentages of a weight table, rounded */
const odds = <K extends string>(w: Record<K, number>) => {
  const total = Object.values<number>(w).reduce((a, b) => a + b, 0)
  return (k: K) => Math.round((w[k] / total) * 100)
}
const feastOdds = odds(CONFIG.feast)
const superOdds = odds(CONFIG.superFeast)
/** paid spins per free-spins start, normal and in Hungry Mode */
const triggerEvery = (ante: boolean) => Math.round(1 / eggOdds(ante).reduce((a, b) => a + b, 0))

/** the grid as the reels land it, before any wild sneaks in */
const landed = (s: Spin): Grid => (s.sneak ? s.grid.map((col, c) => col.map((cell, r) => (c === s.sneak!.col && r === s.sneak!.row ? s.sneak!.replaced : cell))) : s.grid)

/** with two eggs already showing, the reels after them hold back and glow; returns the first such reel, or -1 */
function teaseColumn(grid: Grid) {
  let eggs = 0
  for (let c = 0; c < COLS - 1; c++) {
    eggs += grid[c].filter((x) => x.sym === 'egg').length
    if (eggs >= EGGS_TO_TRIGGER - 1) return c + 1
  }
  return -1
}

/** a calm opening screen: no win, no feature */
function startGrid(): Grid {
  for (let i = 0; i < 60; i++) {
    const r = playRound(rand)
    const s = r.base!
    if (!s.win && !s.sneak && s.eggs < 2 && !cellsOf(s.grid, 'wild').length) return s.grid
  }
  return playRound(rand).base!.grid
}

/** filled meter segments at `level` with `meter` wilds counted (a maxed meter shows full) */
const filledOf = (meter: number, level: number) => (level >= MAX_LEVEL ? WILDS_PER_LEVEL : Math.max(0, Math.min(WILDS_PER_LEVEL, meter - level * WILDS_PER_LEVEL)))

/** the three eggs left to right: the picked one hatches the drawn modifier, the other two what they would have been */
function eggKinds(pick: number, f: Feast): [FeastMod, FeastMod, FeastMod] {
  let k = 0
  return [0, 1, 2].map((j) => (j === pick ? f.pick : f.others[k++])) as [FeastMod, FeastMod, FeastMod]
}

/** nudges win amounts apart so the labels of ways sharing their wilds don't sit on top of each other */
function spread(pops: Pop[]) {
  const out = pops.map((p) => ({ ...p })).sort((a, b) => a.y - b.y)
  for (let i = 1; i < out.length; i++)
    for (let j = 0; j < i; j++) {
      const a = out[j]
      const b = out[i]
      if (Math.abs(a.x - b.x) < 90 && b.y - a.y < 34) b.y = a.y + 34
    }
  return out
}

/** the caption for a spin's ways: its best line, and how many more */
function waysCaption(spin: Spin, coins: (m: number) => number) {
  const w = spin.ways.reduce((a, b) => (b.pay > a.pay ? b : a))
  const text = `${PLURAL[w.sym]} on ${w.len} reels${w.ways > 1 ? ` · ${w.ways} ways` : ''} · ${fmt(coins(w.pay))}`
  return spin.ways.length > 1 ? `${text} · +${spin.ways.length - 1} more` : text
}

/**
 * How a win banner counts up, as [seconds, amount] points: 0.8 s to the first tier, a second through each tier
 * after that and 1.6 s for the rest. Below the first tier it is a plain 2 s count.
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

/*
  dev only: window.__chompForce replays the round until it shows something, for testing:
    'feature' | 'collect' | 'multi' (two or more wilds eat) | 'sneak' | 'big' | 'tease' (paid spins; buys are left alone)
    'level' (a level-up in free spins) | 'max' (a round that reaches the max win, on a rigged donut table)
    'feast:hungry' | 'feast:rain' | 'feast:crowd' | 'feast:extra' (a feature, and the Feast Pick hatches that)
    'super' | 'super:rain' | 'super:crowd' | 'super:extra' (the spin becomes a Super Feast buy, at its price)
*/
const FORCE: Record<string, (r: Round) => boolean> = {
  feature: (r) => r.feature,
  feast: (r) => r.feature,
  collect: (r) => !!r.base?.collects.length && !r.feature,
  multi: (r) => (r.base?.collects.length ?? 0) >= 2 && !r.feature,
  sneak: (r) => !!r.base?.sneak && !r.feature,
  big: (r) => r.total >= 20 && !r.feature,
  tease: (r) => r.base != null && teaseColumn(landed(r.base)) >= 0,
  level: (r) => r.free.some((s) => s.levelUp > 0),
  max: (r) => r.capped,
}
const PAID_ONLY = ['feature', 'feast', 'collect', 'multi', 'sneak', 'big', 'tease']
let rigged: Config | null = null

/** the dev force in effect: the options it plays with, and how to draw its round */
function devPlan(opts: PlayOpts): { opts: PlayOpts; draw: () => Round } {
  const [what = '', mod] = ((window as unknown as { __chompForce?: string }).__chompForce ?? '').split(':')
  const o: PlayOpts = { ...opts }
  if (what === 'super') o.buy = 'super'
  if (o.buy !== 'none') o.ante = false
  if (mod && (FEAST_MODS as readonly string[]).includes(mod)) o.force = mod as FeastMod
  // the max win is about 1 in 9 million buys: a table of 250× donuts and plenty of wilds gets there in a few rounds
  if (what === 'max') rigged ??= { ...CONFIG, free: { ...CONFIG.free, wild: 6 }, freeDonuts: [[250, 1]] }
  const cfg = what === 'max' ? rigged! : CONFIG
  const test = FORCE[what]
  return {
    opts: o,
    draw: () => {
      let round = playRound(rand, o, cfg)
      if (!test || (o.buy !== 'none' && PAID_ONLY.includes(what))) return round
      for (let i = 0; i < 200000 && !test(round); i++) round = playRound(rand, o, cfg)
      return round
    },
  }
}

/** a round already paid for but not yet settled; kept in storage under `key` until it is */
type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.chompers.pending.${uid ?? 'guest'}`

export default function Chompers() {
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
  const [feastUi, setFeastUi] = useState<FeastUi | null>(null)
  const [lastWin, setLastWin] = useState(0)
  const [paytable, setPaytable] = useState(false)
  const [buying, setBuying] = useState<Buy | null>(null)
  const [thumbs, setThumbs] = useState<Partial<Record<Sym | 'host', string>>>({})
  const [cards, setCards] = useState<Partial<Record<FeastMod, string>>>({})
  const [hudTop, setHudTop] = useState(-100)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<ChompScene | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const seq = useRef(1)
  /** the banner on screen: a tap skips its count-up or closes it; close() always closes */
  const bannerDone = useRef<{ tap: () => void; close: () => void } | null>(null)
  /** the Feast Pick waiting for a tap: call with an egg (0-2), or -1 for any */
  const pickDone = useRef<((i: number) => void) | null>(null)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const betRef = useRef(bet)
  betRef.current = bet
  const autoRef = useRef(false)
  /** the round in play, from the stake until it is settled */
  const pending = useRef<Pending | null>(null)
  const captionTimer = useRef(0)
  const hoverTimer = useRef(0)

  const donutText = (v: number) => {
    const a = round2(v * betRef.current)
    return a >= 10000 ? fmtCompact(a) : a >= 1000 ? fmt(a, 0) : fmt(a)
  }

  /** pays the round in play, once: when its show ends, or as soon as the player leaves (the outcome is already drawn) */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'chompers', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: ChompScene | null = null
    let ro: ResizeObserver | null = null
    Promise.all([import('./scene'), import('./models')])
      .then(([{ ChompScene }, models]) => {
        if (!live) return
        setProgress(0.12)
        sc = new ChompScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __chompScene?: ChompScene }).__chompScene = sc
        sc.setTurbo(turboRef.current)
        sc.donutText = donutText
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onCoin = () => sfx.coin()
        sc.onReelStop = (col, syms) => {
          sfx.reelStop(col)
          if (syms.includes('wild')) sfx.boing()
          if (syms.includes('donut')) sfx.donutLand()
        }
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          // the counters and the caption sit in the space under the frame; Big Mama has the space above it
          const f = sc!.frameRect()
          setHudTop(Math.round(Math.min(r.height - 66, f.bottom + (r.height - f.bottom) / 2 - 30)))
          setFeastUi((u) => (u ? { ...u, spots: sc!.feastSpots() } : u))
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          setCards(cardPictures(models.feastTexture))
          sc.show(startGrid())
          setReady(true)
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      clearTimeout(captionTimer.current)
      clearInterval(hoverTimer.current)
      pickDone.current?.(-1)
      bannerDone.current?.close()
      sc?.dispose()
      sceneRef.current = null
      settlePending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])
  useEffect(() => {
    if (!busyRef.current) sceneRef.current?.relabel()
  }, [bet])

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
    useWallet.getState().settle({ game: 'chompers', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Chompers round paid out', amount: p.payout })
  }, [authStatus, uid])

  /* ---------------- playback ---------------- */

  /** banner time: turbo cuts it to 70%, as in the other slots */
  const hold = (ms: number) => (turboRef.current ? ms * 0.7 : ms)

  const say = (text: string | null) => {
    clearTimeout(captionTimer.current)
    setCaption(text == null ? null : { id: seq.current++, text })
  }

  /** shows a banner for `ms`; one with a count-up of `count` seconds jumps to its end on the first tap */
  const showBanner = (b: BannerData, ms: number, count = 0) =>
    new Promise<void>((resolve) => {
      const id = seq.current++
      let ends = performance.now() + count * 1000
      setBanner({ ...b, id })
      const sc = sceneRef.current
      if (b.kind === 'intro') {
        sfx.feature()
        sfx.chomp.cheer()
        sc?.confettiBurst(80)
      } else if (b.kind === 'level') sc?.confettiBurst(60)
      else if (b.kind === 'max') {
        sfx.bigWin()
        sc?.coinShower(3)
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
  const showWin = (kind: 'big' | 'end', amount: number, unit: number, spins = 0) => {
    const plan = countPlan(amount, unit)
    let count = plan[plan.length - 1][0] * (turboRef.current ? 0.6 : 1)
    if (kind === 'big' && autoRef.current) count = Math.min(count, 1.2)
    const ms = Math.max(kind === 'end' ? hold(3400) : 0, count * 1000 + hold(1200))
    if (kind === 'big' || amount >= unit * 20) sceneRef.current?.coinShower(ms / 1000)
    // the tiers bring their own fanfare; a smaller feature total gets the plain one
    if (tierIndex(amount / unit) < 0) {
      sfx.bigWin()
      sceneRef.current?.host(amount > 0 ? 'clap' : 'laugh')
    }
    return showBanner(kind === 'big' ? { kind, amount, unit, count } : { kind, amount, unit, count, spins }, ms, count)
  }

  /** a win banner's count passed a tier: a fanfare, confetti and a flash, and Big Mama cheers louder each time */
  const tierUp = (k: number) => {
    const sc = sceneRef.current
    sfx.chomp.tierUp(k)
    if (k >= 2) sfx.chomp.cheer()
    sc?.host(k >= 3 ? 'wow' : k >= 1 ? 'cheer' : 'clap')
    sc?.confettiBurst(40 + k * 30)
    sc?.flash(0.2 + k * 0.1)
  }

  /** the max win: a flash, confetti and the banner; Big Mama can't believe it */
  const maxWin = (amount: number, unit: number) => {
    const sc = sceneRef.current
    sc?.flash(1)
    sc?.confettiBurst(160)
    sc?.host('wow')
    sfx.chomp.tierUp(3)
    sfx.chomp.cheer()
    return showBanner({ kind: 'max', amount, unit }, hold(3800))
  }

  const popAt = (ids: number[], amount: number, color: string, big = false): Pop => {
    const at = sceneRef.current?.screenOf(ids) ?? { x: 0, y: 0 }
    return { id: seq.current++, x: at.x, y: at.y, amount, color, big }
  }

  /** shows the free-spins meter, on the counter and on the slime band */
  const showMeter = (meter: Meter | null) => {
    setHud((h) => ({ ...h, meter }))
    sceneRef.current?.setMeter(meter && { filled: meter.filled, of: WILDS_PER_LEVEL, mult: LEVEL_MULTS[meter.level] })
  }

  /** plays one spin of a round; `before` is the total already on the counter. Returns the new total, or null once the screen is gone. */
  const playSpin = async (sc: ChompScene, spin: Spin, free: boolean, before: number, unit: number): Promise<number | null> => {
    const coins = (m: number) => round2(m * unit)
    let run = before
    const add = (m: number) => {
      run = Math.min(MAX_WIN * unit, round2(run + coins(m)))
      setHud((h) => ({ ...h, win: run }))
    }
    const grid = landed(spin)
    const tease = free ? -1 : teaseColumn(grid)
    // a hurried spin can land every reel before the tease line is due: then it would talk over the result
    let stopped = false
    if (tease >= 0)
      void sc.wait(0.5 + tease * 0.16).then(() => {
        if (!alive.current || stopped) return
        sfx.tease()
        say('Two eggs… one more for free spins!')
      })
    let eggsSeen = 0
    const prevStop = sc.onReelStop
    sc.onReelStop = (col, syms) => {
      prevStop?.(col, syms)
      const n = syms.filter((s) => s === 'egg').length
      for (let i = 0; i < n; i++) sfx.eggLand(eggsSeen++)
    }
    await sc.spin(grid, free, tease)
    stopped = true
    sc.onReelStop = prevStop
    if (!alive.current) return null

    if (spin.sneak) {
      sfx.whoosh()
      say('A hungry wild sneaks in!')
      await sc.wait(0.2)
      await sc.sneak(spin.sneak.col, spin.sneak.row, spin.sneak.cell, spin.sneak.replaced)
      sfx.boing()
      if (!alive.current) return null
    }

    // ways
    if (spin.ways.length) {
      setPops(spread(spin.ways.map((w) => popAt(w.ids, coins(w.pay), SYMBOL_COLOR[w.sym], w.pay >= 5))))
      add(spin.waysWin)
      say(waysCaption(spin, coins))
      if (spin.waysWin >= 5) sfx.bigWin()
      else sfx.win()
      await sc.highlight([...new Set(spin.ways.flatMap((w) => w.ids))], spin.ways.length > 2 ? 1.5 : 1.2)
      setPops([])
      sc.clearHighlight()
      await sc.wait(0.2)
      if (!alive.current) return null
    }

    // every wild eats every donut, the collect multiplier stamped on each on its way in
    if (spin.collects.length) {
      const values = new Map(cellsOf(spin.grid, 'donut').map((d) => [d.id, d.value ?? 0]))
      const mult = spin.mult
      for (let i = 0; i < spin.collects.length; i++) {
        const c = spin.collects[i]
        const n = c.donuts.length
        let got = 0
        const popId = seq.current++
        const at = sc.screenOf([c.wild]) ?? { x: 0, y: 0 }
        say(i === 0 ? `Chomp! ${n} ${n === 1 ? 'donut' : 'donuts'}${mult > 1 ? ` × ${mult}` : ''}` : `Another wild, another helping!`)
        if (mult > 1) sfx.chomp.stamp(mult)
        await sc.collect(
          c.wild,
          c.donuts,
          (j) => {
            // leaving the page lands the donuts still in the air: no bites to hear then
            if (!alive.current) return
            got = round2(got + coins((values.get(c.donuts[j]) ?? 0) * mult))
            sfx.chomp(j)
            setHud((h) => ({ ...h, win: Math.min(MAX_WIN * unit, round2(run + got)) }))
            setPops([{ id: popId, x: at.x, y: at.y - 44, amount: got, color: SYMBOL_COLOR.wild, big: true, mult: mult > 1 ? mult : undefined }])
          },
          mult,
        )
        add(c.pay)
        say(`${i === 0 ? 'Chomp!' : 'Seconds!'} ${n} ${n === 1 ? 'donut' : 'donuts'}${mult > 1 ? ` × ${mult}` : ''} · ${fmt(coins(c.pay))}`)
        if (c.pay >= 10) {
          sfx.bigWin()
          sfx.chomp.cheer()
        } else sfx.win()
        await sc.wait(0.5)
        setPops([])
        if (!alive.current) return null
      }
    }

    // eggs
    if (!free && spin.eggs >= EGGS_TO_TRIGGER) {
      const ids = cellsOf(spin.grid, 'egg').map((c) => c.id)
      setPops([popAt(ids, coins(spin.eggPay), SYMBOL_COLOR.egg, true)])
      add(spin.eggPay)
      say(`${spin.eggs} eggs · ${spin.award} free spins!`)
      sfx.hatch()
      await sc.eggs(ids, true)
      setPops([])
      if (!alive.current) return null
    }
    return run
  }

  /** the Feast Pick: tap an egg (or let it pick after 3 s, at once in autoplay or when hurried); resolves with 0-2 */
  const pickEgg = (sc: ChompScene, sup: boolean) =>
    new Promise<number>((resolve) => {
      const auto = autoRef.current
      const secs = auto ? 0.9 : 3
      const ticks: number[] = []
      const finish = (i: number) => {
        if (pickDone.current !== finish) return
        pickDone.current = null
        clearTimeout(t)
        ticks.forEach(clearTimeout)
        clearInterval(hoverTimer.current)
        sc.feastHover(-1)
        resolve(i >= 0 && i < 3 ? i : Math.floor(Math.random() * 3))
      }
      const t = window.setTimeout(() => finish(-1), secs * 1000)
      if (!auto) for (let k = 1; k < secs; k++) ticks.push(window.setTimeout(() => sfx.chomp.tick(k), k * 1000))
      pickDone.current = finish
      setFeastUi({ id: seq.current++, phase: 'pick', spots: sc.feastSpots(), secs, super: sup })
    })

  /** Big Mama's three eggs: one is picked and hatches the modifier already drawn, the others show what they held */
  const feastPick = async (sc: ChompScene, feast: Feast) => {
    say(feast.super ? 'Super Feast! One more treat in one of these eggs' : 'Big Mama has three eggs. Pick one!')
    sfx.chomp.rise()
    sfx.chomp.grumble()
    await sc.feastShow()
    if (!alive.current) return false
    const pick = await pickEgg(sc, feast.super)
    if (!alive.current) return false
    const spots = sc.feastSpots()
    setFeastUi(null)
    sfx.chomp.crack()
    const reveal = sc.feastReveal(pick, eggKinds(pick, feast))
    await sc.wait(0.55)
    if (!alive.current) return false
    sfx.chomp.reveal()
    sfx.chomp.cheer()
    setFeastUi({ id: seq.current++, phase: 'reveal', spots, egg: pick, pick: feast.pick, super: feast.super })
    const m = MOD[feast.pick]
    say(feast.super ? `Super Feast: Hungry + ${m.name}` : `${m.name}! ${m.line}`)
    void sc.wait(0.9).then(() => alive.current && (sfx.chomp.peek(0), sfx.chomp.peek(1)))
    await reveal
    await sc.wait(autoRef.current ? 0.5 : 1.3)
    if (!alive.current) return false
    setFeastUi(null)
    await sc.feastHide()
    return alive.current
  }

  /** free spins: the intro, the Feast Pick, every spin with its level-ups, the end banner and back to night */
  const playFeature = async (sc: ChompScene, round: Round, before: number, unit: number, payout: number) => {
    const feast = round.feast!
    let shown = before
    await showBanner({ kind: 'intro', spins: round.startSpins, super: feast.super }, hold(2800))
    if (!alive.current) return false
    sc.setFree(true)
    let left = round.startSpins
    let played = 0
    let level = feast.super ? feast.level : 0
    setHud((h) => ({ ...h, win: shown, free: { left, played }, mods: feast.super ? ['hungry'] : [] }))
    showMeter({ filled: 0, level })
    await sc.wait(0.5)
    if (!alive.current) return false

    if (!(await feastPick(sc, feast))) return false
    // the modifier takes hold
    sfx.chomp.power()
    setHud((h) => ({ ...h, mods: feast.mods }))
    if (feast.spins) {
      left += feast.spins
      sfx.chomp.extra()
      setHud((h) => ({ ...h, free: { left, played } }))
    }
    if (feast.level > level) {
      level = feast.level
      showMeter({ filled: 0, level })
      sc.flash(0.3)
    }
    await sc.wait(0.6)
    if (!alive.current) return false

    for (const fs of round.free) {
      left--
      played++
      setHud((h) => ({ ...h, free: { left, played } }))
      if (left === 0) {
        // the last one, as far as anyone knows: Big Mama can't look
        say('Last spin!')
        sc.host('cover')
        if (!turboRef.current) {
          sfx.chomp.heartbeat()
          await sc.wait(0.5)
          if (!alive.current) return false
        }
      } else say(null)
      const r = await playSpin(sc, fs, true, shown, unit)
      if (r == null) return false
      shown = r
      // the spin that reaches the max win ends the feature: no meter or level-up after it, the max banner follows
      if (round.capped && fs === round.free[round.free.length - 1]) break
      if (fs.wildsCounted) {
        const filled = fs.levelUp ? WILDS_PER_LEVEL : filledOf(fs.meter, level)
        showMeter({ filled, level })
        sfx.chomp.meter(filled)
      }
      if (fs.levelUp) {
        level = fs.level + fs.levelUp
        left = fs.left
        void sc.levelUp()
        sfx.levelUp()
        sfx.chomp.cheer()
        say(`Meter full! +${LEVEL_SPINS * fs.levelUp} spins · donuts now ×${LEVEL_MULTS[level]}`)
        await showBanner({ kind: 'level', spins: LEVEL_SPINS * fs.levelUp, mult: LEVEL_MULTS[level] }, hold(2200))
        if (!alive.current) return false
        showMeter({ filled: filledOf(fs.meter, level), level })
      }
      left = fs.left
      setHud((h) => ({ ...h, free: { left, played } }))
      await sc.wait(0.25)
      if (!alive.current) return false
    }

    sc.setMeter(null)
    if (round.capped) await maxWin(payout, unit)
    else await showWin('end', payout, unit, played)
    if (!alive.current) return false
    sc.setFree(false)
    setHud((h) => ({ ...h, free: null, meter: null, mods: [], win: payout }))
    say(`${played} free spins paid ${fmt(payout)}`)
    return true
  }

  const play = async (buyIn: Buy): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const unit = bet
    let opts: PlayOpts = { buy: buyIn, ante: buyIn === 'none' && ante }
    const dev = import.meta.env.DEV ? devPlan(opts) : null
    if (dev) opts = dev.opts
    const price = opts.buy === 'fs' ? BUY_PRICE : opts.buy === 'super' ? SUPER_PRICE : opts.ante ? ANTE_COST : 1
    const cost = round2(unit * price)
    if (!stake(cost)) return null
    busyRef.current = true
    setBusy(true)
    setPops([])
    say(null)
    setHud(EMPTY_HUD)
    sfx.spinStart()
    if (opts.buy !== 'none') {
      sc.host('wow')
      sfx.chomp.grumble()
    }

    const round = dev ? dev.draw() : playRound(rand, opts)
    const payout = round2(unit * round.total)
    const level = round.feast ? round.feast.level + round.free.reduce((n, s) => n + s.levelUp, 0) : 0
    const meta = { feature: round.feature, buy: round.kind, ante: round.ante, mult: payout / cost, level, feast: round.feast?.pick ?? '', spins: round.free.length }
    // stored before the show starts, so even a page that never gets to settle can't lose the round
    const key = pendingKey(uid)
    pending.current = { bet: cost, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: cost, payout, meta }))

    let shown = 0
    if (round.base) {
      const r = await playSpin(sc, round.base, false, 0, unit)
      if (r == null) return null
      shown = r
    }
    if (round.free.length) {
      if (!(await playFeature(sc, round, shown, unit, payout))) return null
    } else if (round.capped) {
      await maxWin(payout, unit)
      if (!alive.current) return null
    }

    // a no-op if the page already paid it on its way out (and came back from the back/forward cache)
    settlePending()
    setLastWin(payout)
    setHud((h) => ({ ...h, win: payout }))
    if (!round.free.length && !round.capped && payout >= unit * TIERS[0].min) await showWin('big', payout, unit)
    if (!alive.current) return null
    sc.calm()
    sc.relabel()
    captionTimer.current = window.setTimeout(() => setCaption(null), 2500)
    busyRef.current = false
    setBusy(false)
    return payout - cost
  }

  const auto = useAutoBet(() => play('none'), turbo ? 150 : 400)
  autoRef.current = auto.running
  const locked = busy || auto.running

  const hurry = () => {
    if (pickDone.current) pickDone.current(-1)
    else if (bannerDone.current) bannerDone.current.tap()
    else sceneRef.current?.hurry()
  }

  const toggleAnte = (on: boolean) => {
    setAnte(on)
    if (on) {
      sfx.chomp.rumble()
      sceneRef.current?.host('lick')
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || paytable || buying) return
      // 1, 2 and 3 pick an egg
      if (pickDone.current && ['Digit1', 'Digit2', 'Digit3'].includes(e.code)) {
        pickDone.current(+e.code.slice(5) - 1)
        return
      }
      if (e.code !== 'Space') return
      e.preventDefault()
      if (busyRef.current) hurry()
      else if (mode === 'manual') void play('none')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const spinCost = round2(bet * (ante ? ANTE_COST : 1))
  const fsCost = round2(bet * BUY_PRICE)
  const superCost = round2(bet * SUPER_PRICE)
  const free = hud.free
  const freeLabel = free && (free.played ? `Free spin ${free.played} · ${free.left} left` : `Feast Pick · ${free.left} free spins`)
  const anteRate = Math.round((triggerEvery(false) / triggerEvery(true)) * 100) / 100

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
      <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${ante ? 'bg-[#ff4fa3]/12 ring-1 ring-[#ff4fa3]/40' : 'bg-stage'}`}>
        <div className="min-w-0">
          <div className={`text-[13px] font-semibold ${ante ? 'text-[#ff9fd0]' : 'text-muted'}`}>Hungry Mode</div>
          <div className="text-[11px] font-semibold text-dim">
            Spin {ANTE_COST}× · free spins {anteRate}× as often
          </div>
        </div>
        <Toggle on={ante} onChange={toggleAnte} disabled={locked} label="Hungry Mode" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div>
        <div className="grid grid-cols-2 gap-2" title={ante ? 'Turn off Hungry Mode to buy' : undefined}>
          <BuyButton label="Free spins" cost={fsCost} tone="green" disabled={locked || !ready || ante || balance < fsCost} onClick={() => (sfx.click(), setBuying('fs'))} />
          <BuyButton label="Super Feast" cost={superCost} tone="pink" disabled={locked || !ready || ante || balance < superCost} onClick={() => (sfx.click(), setBuying('super'))} />
        </div>
        {ante && <div className="mt-1.5 text-center text-[11px] font-semibold text-dim">Turn off Hungry Mode to buy</div>}
      </div>
      <button onClick={() => (sfx.click(), setPaytable(true))} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Paytable
      </button>
      <div className="max-lg:order-first lg:mt-auto">
        {auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop} sub={free ? freeLabel : undefined}>
            Stop autospin
          </ActionButton>
        ) : feastUi?.phase === 'pick' ? (
          <ActionButton tone="gold" onClick={hurry} sub="Or let Big Mama choose">
            Pick an egg
          </ActionButton>
        ) : free ? (
          <ActionButton tone="gold" onClick={hurry} sub="Tap to speed up">
            {freeLabel}
          </ActionButton>
        ) : busy ? (
          <ActionButton tone="neutral" onClick={hurry} sub="Tap to speed up">
            Spinning…
          </ActionButton>
        ) : mode === 'manual' ? (
          <ActionButton onClick={() => void play('none')} disabled={!ready || balance < spinCost} sub={ante ? `Hungry Mode · ${fmt(spinCost)}` : undefined}>
            Spin
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || balance < spinCost} sub={ante ? `Hungry Mode · ${fmt(spinCost)}` : undefined}>
            Start autospin
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const m = hud.meter

  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#14072e]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* the Feast modifiers in force, in the top corner (Hungry Mode's reminder there between features) */}
      <div className="pointer-events-none absolute left-2.5 top-2.5 z-10 flex flex-col items-start gap-1.5 sm:left-4 sm:top-4">
        <AnimatePresence>
          {ante && !free && (
            <motion.div
              key="ante"
              layout
              initial={{ opacity: 0, scale: 0.4, x: -16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="flex h-7 items-center gap-1.5 rounded-full bg-[#1d0f30]/90 px-3 sm:h-8"
              style={{ boxShadow: 'inset 0 0 0 1px #ff4fa366, 0 0 16px -4px #ff4fa3' }}
            >
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#ff4fa3] shadow-[0_0_8px_#ff4fa3]" />
              <span className="text-[10px] font-black uppercase tracking-wide text-[#ff9fd0] sm:text-[12px]">Hungry Mode · {ANTE_COST}×</span>
            </motion.div>
          )}
          {hud.mods.map((k) => (
            <motion.div
              key={k}
              layout
              initial={{ opacity: 0, scale: 0.4, x: -16 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 420, damping: 20 }}
              className="flex h-8 items-center gap-1.5 rounded-full bg-[#1d0f30]/90 py-0.5 pl-0.5 pr-3 sm:h-10 sm:pr-4"
              style={{ boxShadow: `inset 0 0 0 1px ${MOD[k].color}66, 0 0 16px -4px ${MOD[k].color}` }}
            >
              <ModBadge kind={k} src={cards[k]} className="h-7 w-7 sm:h-9 sm:w-9" />
              <span className="text-[11px] font-black uppercase tracking-wide sm:text-[13px]" style={{ color: MOD[k].color }}>
                {MOD[k].name}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* counters and caption under the frame */}
      <div className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1.5 px-2" style={{ top: hudTop }}>
        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
          <AnimatePresence mode="popLayout">
            {free && (
              <motion.div key="spins" layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill}>
                <span className={`${pillLabel} text-[#ffd9f0]/80`}>Spins</span>
                <motion.span key={free.left} initial={{ scale: 1.35 }} animate={{ scale: 1 }} className="tnum text-[15px] font-black text-white sm:text-[18px]">
                  {free.left}
                </motion.span>
              </motion.div>
            )}
            {(free || hud.win > 0) && (
              <motion.div key="win" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={pill}>
                <span className={`${pillLabel} text-gold/80`}>{free ? 'Total' : 'Win'}</span>
                <Counter value={hud.win} className="text-[15px] font-black text-gold sm:text-[18px]" />
              </motion.div>
            )}
            {m && (
              <motion.div
                key="meter"
                layout
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className={`${pillBase} gap-1 px-3 sm:gap-1.5 sm:px-4`}
                aria-label={`${m.filled} of ${WILDS_PER_LEVEL} wilds, donuts ×${LEVEL_MULTS[m.level]}`}
              >
                {Array.from({ length: WILDS_PER_LEVEL }, (_, i) => (
                  <motion.span
                    key={`${m.level}-${i}-${i < m.filled}`}
                    initial={i < m.filled ? { scale: 1.8 } : false}
                    animate={{ scale: 1 }}
                    className={`h-2.5 w-2.5 rounded-full sm:h-3 sm:w-3 ${i < m.filled ? 'bg-[#2ee87f] shadow-[0_0_10px_#2ee87f]' : 'bg-white/15'}`}
                  />
                ))}
                <AnimatePresence mode="popLayout">
                  <motion.span
                    key={m.level}
                    initial={{ scale: 2, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="tnum ml-1 text-[15px] font-black sm:text-[17px]"
                    style={{ color: m.level >= MAX_LEVEL ? '#ffcf3a' : '#2ee87f' }}
                  >
                    ×{LEVEL_MULTS[m.level]}
                  </motion.span>
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="relative h-5 w-full max-w-[560px]" aria-live="polite">
          <AnimatePresence initial={false}>
            {caption && (
              <motion.div
                key={caption.id}
                className="absolute inset-0 truncate text-center text-[13px] font-bold text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,.7)]"
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

      {/* amounts over each win */}
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
            <motion.span
              key={p.amount}
              initial={{ scale: 1.25 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 14 }}
              className={`inline-block ${p.big ? 'text-[26px] sm:text-[34px]' : 'text-[22px] sm:text-[28px]'}`}
              style={{ color: p.big ? '#fff3b0' : '#fff', textShadow: `0 0 18px ${p.big ? '#ffc93d' : p.color}, 0 3px 0 #1d0f30, 0 0 3px #1d0f30, 0 0 3px #1d0f30` }}
            >
              {fmt(p.amount)}
            </motion.span>
            {p.mult && (
              <span
                className="ml-1 inline-block -translate-y-2 rotate-[-8deg] rounded-md bg-[#ffcf3a] px-1.5 py-0.5 align-middle text-[13px] font-black text-[#1d0f30] shadow-[0_3px_0_#1d0f30] ring-2 ring-[#1d0f30] sm:text-[15px]"
                aria-label={`times ${p.mult}`}
              >
                ×{p.mult}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>

      <AnimatePresence>
        {feastUi && (
          <FeastOverlay
            key={feastUi.id}
            ui={feastUi}
            hudTop={hudTop}
            onPick={(i) => pickDone.current?.(i)}
            onHover={(i) => {
              clearInterval(hoverTimer.current)
              const sc = sceneRef.current
              sc?.feastHover(i)
              if (i >= 0) hoverTimer.current = window.setInterval(() => sceneRef.current?.feastHover(i), 250)
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} host={thumbs.host} onTap={() => bannerDone.current?.tap()} onTier={tierUp} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,#221048_0%,#14072e_72%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-muted">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Waking the monsters" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  const buyCost = buying === 'super' ? superCost : fsCost

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(84vw+130px)] max-sm:min-h-[420px]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} cards={cards} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(null)} title={buying === 'super' ? 'Buy Super Feast' : 'Buy free spins'} width={440}>
            <p className="text-[14px] text-muted">
              {buying === 'super' ? (
                <>
                  {BUY_SPINS} free spins for <span className="font-bold text-ink">{fmt(superCost)}</span> coins, {SUPER_PRICE}× your bet. They start{' '}
                  <span className="font-bold" style={{ color: MOD.hungry.color }}>Hungry</span>, so collects pay ×{LEVEL_MULTS[1]} from the first spin, and Big Mama's eggs add one more treat:
                </>
              ) : (
                <>
                  Go straight to {BUY_SPINS} free spins for <span className="font-bold text-ink">{fmt(fsCost)}</span> coins, {BUY_PRICE}× your bet. Big Mama opens them with a Feast Pick:
                </>
              )}
            </p>
            <div className={`mt-3 grid gap-1.5 ${buying === 'super' ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {((buying === 'super' ? SUPER_MODS : FEAST_MODS) as readonly FeastMod[]).map((k) => (
                <div key={k} className="flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-center" style={{ background: `${MOD[k].color}14`, boxShadow: `inset 0 0 0 1px ${MOD[k].color}33` }}>
                  <ModBadge kind={k} src={cards[k]} className="h-11 w-11" />
                  <span className="text-[12px] font-extrabold leading-tight" style={{ color: MOD[k].color }}>
                    {MOD[k].name}
                  </span>
                  <span className="tnum text-[11px] font-bold text-dim">{buying === 'super' ? superOdds(k as Exclude<FeastMod, 'hungry'>) : feastOdds(k)}%</span>
                </div>
              ))}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => setBuying(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="gold"
                disabled={balance < buyCost}
                onClick={() => {
                  const b = buying
                  setBuying(null)
                  void play(b)
                }}
              >
                Buy · {fmt(buyCost, buyCost >= 1000 ? 0 : 2)}
              </ActionButton>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </>
  )
}

/** the Feast cards drawn by models.ts, shrunk to small pictures for the counters, the buy dialog and the paytable */
function cardPictures(texture: (k: FeastMod) => { image: unknown }) {
  const out: Partial<Record<FeastMod, string>> = {}
  try {
    for (const k of FEAST_MODS) {
      const src = texture(k).image as HTMLCanvasElement
      // the round badge sits in the top 480 of the 512 × 640 card; the ribbon below is left out
      const c = document.createElement('canvas')
      c.width = c.height = 128
      c.getContext('2d')!.drawImage(src, 16, 10, 480, 480, 0, 0, 128, 128)
      out[k] = c.toDataURL('image/png')
    }
  } catch {
    /* the counters fall back to a plain dot */
  }
  return out
}

const pillBase = 'flex h-9 items-center rounded-full bg-[#1d0f30]/90 ring-1 ring-white/10 sm:h-10'
/** a counter pill: label over value on phones, side by side from sm up */
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

function BuyButton({ label, cost, tone, disabled, onClick }: { label: string; cost: number; tone: 'green' | 'pink'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 font-extrabold shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-40 ${
        tone === 'green' ? 'bg-[linear-gradient(180deg,#7dffb5,#1fc96b)] text-[#03290f]' : 'bg-[linear-gradient(180deg,#ff9ad4,#ff4fa3)] text-[#3d0328]'
      }`}
    >
      <span className="text-[14px] leading-none">{label}</span>
      <span className="tnum rounded bg-black/15 px-1.5 py-0.5 text-[12px] leading-none">{fmt(cost, cost >= 1000 ? 0 : 2)}</span>
    </button>
  )
}

/** a Feast modifier's round badge: the card art from the scene, or a plain disc until it is ready */
function ModBadge({ kind, src, className = '' }: { kind: FeastMod; src?: string; className?: string }) {
  return src ? (
    <img src={src} alt="" className={`shrink-0 ${className}`} draggable={false} />
  ) : (
    <span className={`shrink-0 rounded-full ring-2 ring-[#1d0f30] ${className}`} style={{ background: MOD[kind].color }} />
  )
}

/** the Feast Pick over the stage: a prompt and tap targets on the three eggs, then the line under the hatched card */
function FeastOverlay({ ui, hudTop, onPick, onHover }: { ui: FeastUi; hudTop: number; onPick: (i: number) => void; onHover: (i: number) => void }) {
  if (!ui.spots.length) return null
  const top = Math.min(...ui.spots.map((s) => s.y - s.r))
  const bottom = Math.max(...ui.spots.map((s) => s.y + s.r))
  const r = ui.spots[0].r
  if (ui.phase === 'pick')
    return (
      <motion.div className="absolute inset-0 z-20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }}>
        <motion.div
          className="pointer-events-none absolute inset-x-0 flex flex-col items-center"
          style={{ top: Math.max(4, top - r * 0.55 - 58) }}
          initial={{ y: -12, scale: 0.8 }}
          animate={{ y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 16 }}
        >
          <div className="absolute left-1/2 top-1/2 -z-10 h-[150%] w-[min(120%,420px)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,rgba(20,7,46,.72),rgba(20,7,46,0))]" />
          <div className="text-[11px] font-extrabold uppercase tracking-[0.3em] text-white/80 [text-shadow:0_1px_3px_rgba(0,0,0,.8)] sm:text-[12px]">{ui.super ? 'Super Feast' : 'Feast Pick'}</div>
          <div className={`bg-clip-text text-[30px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[42px] ${GREEN_TEXT}`}>Pick an egg!</div>
          <div className="mt-2 h-1.5 w-28 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/15 sm:w-36">
            <motion.div className="h-full origin-left rounded-full bg-[linear-gradient(90deg,#2ee87f,#ffd96a)]" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: ui.secs, ease: 'linear' }} />
          </div>
        </motion.div>
        {ui.spots.map((s, i) => (
          <button
            key={i}
            aria-label={`Egg ${i + 1}`}
            className="group absolute rounded-full outline-none"
            style={{ left: s.x - s.r * 1.15, top: s.y - s.r * 1.3, width: s.r * 2.3, height: s.r * 2.6 }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onPick(i)
            }}
            onPointerEnter={() => onHover(i)}
            onPointerLeave={() => onHover(-1)}
            onFocus={() => onHover(i)}
            onBlur={() => onHover(-1)}
            onKeyDown={(e) => e.key === 'Enter' && onPick(i)}
          >
            <motion.span
              className="pointer-events-none absolute inset-[6%] rounded-[50%] border-2 border-dashed border-[#ffd96a]/70 group-hover:border-white group-focus-visible:border-white"
              animate={{ scale: [1, 1.07, 1], opacity: [0.55, 1, 0.55] }}
              transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: 'easeInOut' }}
            />
          </button>
        ))}
      </motion.div>
    )

  return <FeastReveal ui={ui} below={bottom + r * 0.4} limit={hudTop} />
}

/** the hatched modifier's name and line under its egg, kept clear of the stage's edges and of the counters under the frame */
function FeastReveal({ ui, below, limit }: { ui: Extract<FeastUi, { phase: 'reveal' }>; below: number; limit: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [h, setH] = useState(0)
  useLayoutEffect(() => setH(box.current?.offsetHeight ?? 0), [])
  const mod = MOD[ui.pick]
  const at = ui.spots[ui.egg]?.x
  // on a phone the space under the eggs is short: the line then rises over the eggs rather than onto the counters
  const top = Math.max(4, Math.min(below, limit - h - 6))
  return (
    <div ref={box} className="pointer-events-none absolute z-20 w-[min(92%,440px)] -translate-x-1/2" style={{ top, left: `clamp(min(46%, 220px), ${at ?? 0}px, max(54%, calc(100% - 220px)))` }}>
      <motion.div
        className="flex flex-col items-center text-center"
        initial={{ opacity: 0, y: 14, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, transition: { duration: 0.2 } }}
        transition={{ type: 'spring', stiffness: 420, damping: 14 }}
      >
        {ui.super && (
          <div className="mb-1 rounded-full bg-[#1d0f30]/85 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.2em] sm:text-[11px]" style={{ color: MOD.hungry.color }}>
            Super Feast · Hungry +
          </div>
        )}
        <div className="rounded-full bg-[#1d0f30]/92 px-5 py-2 sm:px-7" style={{ boxShadow: `inset 0 0 0 2px ${mod.color}, 0 0 30px -4px ${mod.color}` }}>
          <div className="whitespace-nowrap text-[22px] font-black uppercase leading-none tracking-tight sm:text-[32px]" style={{ color: mod.color, textShadow: '0 2px 0 #1d0f30' }}>
            {mod.name}!
          </div>
        </div>
        <div className="mt-1.5 text-[12px] font-bold text-white/90 [text-shadow:0_1px_3px_rgba(0,0,0,.95),0_0_8px_rgba(0,0,0,.6)] sm:text-[13px]">{mod.line}</div>
      </motion.div>
    </div>
  )
}

/** a little donut, for banners */
function DonutIcon({ className = '', color = '#ff8ad0' }: { className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <circle cx="20" cy="20" r="17" fill="#e9a656" stroke="#1d0f30" strokeWidth="2.5" />
      <path d="M5.5 18c2-1.5 3 1 5-.5s2.5-3 5-2.5 3 2 5 1 3-3 5-2 2.5 2.5 4.5 2 3.5-1 4.5 0c-1-7-7-12.5-14.5-12.5S6.5 10 5.5 18Z" fill={color} />
      <circle cx="20" cy="20" r="6" fill="#1d0f30" />
      <circle cx="20" cy="20" r="4.3" fill="#3a1670" />
      {[
        [11, 11, '#fff'],
        [27, 9, '#ffe14d'],
        [31, 15, '#3dd9ff'],
        [15, 7, '#2ee87f'],
      ].map(([x, y, c], i) => (
        <rect key={i} x={x as number} y={y as number} width="4" height="1.6" rx=".8" fill={c as string} transform={`rotate(${i * 50} ${x} ${y})`} />
      ))}
    </svg>
  )
}

/** a speckled monster egg with a crack and eyes peeking out, for banners */
function EggIcon({ className = '', spots = '#a55bff' }: { className?: string; spots?: string }) {
  return (
    <svg viewBox="0 0 40 48" className={className} aria-hidden>
      <path d="M20 3C10 3 4 17 4 28c0 10 7 17 16 17s16-7 16-17C36 17 30 3 20 3Z" fill="#fff4dc" stroke="#1d0f30" strokeWidth="2.5" />
      <ellipse cx="13" cy="15" rx="3" ry="4.5" fill="#fff" opacity=".8" transform="rotate(25 13 15)" />
      <circle cx="27" cy="16" r="3.2" fill={spots} />
      <circle cx="11" cy="31" r="2.6" fill={spots} />
      <circle cx="29" cy="35" r="2.2" fill="#2ee87f" />
      <path d="M8 24l5 3 4-4 4 4 5-4 4 3 3-2" fill="none" stroke="#1d0f30" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
      <ellipse cx="16.5" cy="31" rx="2" ry="2.6" fill="#1d0f30" />
      <ellipse cx="23.5" cy="31" rx="2" ry="2.6" fill="#1d0f30" />
      <circle cx="17.2" cy="30.2" r=".8" fill="#fff" />
      <circle cx="24.2" cy="30.2" r=".8" fill="#fff" />
    </svg>
  )
}

/** light rays behind a banner, one colour per ray in turn */
const rays = (...colors: string[]) =>
  `repeating-conic-gradient(from 0deg, ${colors.map((c, i) => `${c} ${i * 22.5}deg ${i * 22.5 + 7}deg, transparent ${i * 22.5 + 7}deg ${(i + 1) * 22.5}deg`).join(', ')})`
const SLIME_RAYS = rays('rgba(46,232,127,.36)', 'rgba(255,79,163,.3)')
const GREEN_TEXT = 'bg-[linear-gradient(180deg,#ffffff_0%,#b8ffd6_45%,#2ee87f_100%)]'
/** each win tier's title gradient and rays: gold, slime green, Mama pink, then candy colours for a Monster feast */
const TIER_LOOK = [
  { text: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]', rays: rays('rgba(255,200,61,.34)') },
  { text: GREEN_TEXT, rays: rays('rgba(46,232,127,.36)', 'rgba(255,200,61,.3)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#ffc2e4_45%,#ff4fa3_100%)]', rays: rays('rgba(255,79,163,.38)', 'rgba(155,92,255,.34)') },
  {
    text: 'bg-[linear-gradient(100deg,#ff4fa3_0%,#ffd23f_30%,#2ee87f_55%,#3db4ff_78%,#9b5cff_100%)]',
    rays: rays('rgba(255,79,163,.36)', 'rgba(255,210,63,.34)', 'rgba(46,232,127,.34)', 'rgba(61,180,255,.32)'),
  },
]
const GOLD_TEXT = TIER_LOOK[0].text

function BannerCard({ banner, host, onTap, onTier }: { banner: Banner; host?: string; onTap: () => void; onTier: (k: number) => void }) {
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
  const look = banner.kind === 'intro' || banner.kind === 'level' ? SLIME_RAYS : TIER_LOOK[Math.max(0, tier)].rays
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
            initial={{ scale: 1.3, opacity: 0, rotate: -4 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.85, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 12 }}
            className={`whitespace-nowrap bg-clip-text text-[34px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[50px] ${TIER_LOOK[tier].text}`}
          >
            {TIERS[tier].name}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
  /** Big Mama's head pops up over the banner, bigger as the tiers climb */
  const mama = host && (
    <motion.img
      src={host}
      alt=""
      draggable={false}
      className="relative -mb-1 h-20 w-20 sm:h-24 sm:w-24"
      initial={{ y: 30, scale: 0.4, opacity: 0 }}
      animate={{ y: [0, -5, 0], scale: 1 + Math.max(0, tier) * 0.08, opacity: 1 }}
      transition={{ y: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }, scale: { type: 'spring', stiffness: 380, damping: 12 }, opacity: { duration: 0.2 } }}
    />
  )

  let body: ReactNode
  if (banner.kind === 'intro') {
    body = (
      <>
        <div className="relative mb-1 flex items-end gap-1.5">
          <motion.div animate={{ y: [0, -6, 0], rotate: [-12, 8, -12] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut' }}>
            <EggIcon className="h-11 w-9" spots="#ff5fa2" />
          </motion.div>
          <motion.div animate={{ y: [0, -9, 0] }} transition={{ duration: 0.8, repeat: Infinity, ease: 'easeInOut' }}>
            <EggIcon className="h-[60px] w-[50px] drop-shadow-[0_0_14px_rgba(255,217,106,.7)]" />
          </motion.div>
          <motion.div animate={{ y: [0, -6, 0], rotate: [12, -8, 12] }} transition={{ duration: 1.3, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}>
            <EggIcon className="h-11 w-9" spots="#3db4ff" />
          </motion.div>
        </div>
        <div className={`relative bg-clip-text text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] ${GREEN_TEXT}`}>
          <div className="text-[64px] font-black leading-none sm:text-[84px]">{banner.spins}</div>
        </div>
        <div className="relative text-[12px] font-extrabold uppercase tracking-[0.3em] text-white/75">Free spins</div>
        <div className={`relative mt-1 bg-clip-text text-[28px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[38px] ${banner.super ? TIER_LOOK[2].text : GREEN_TEXT}`}>
          {banner.super ? 'Super Feast' : 'Feast time!'}
        </div>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">{banner.super ? `Collects start at ×${LEVEL_MULTS[1]}, plus one more treat` : 'Big Mama has three eggs for you'}</div>
      </>
    )
  } else if (banner.kind === 'level') {
    body = (
      <>
        <div className="relative mb-2 flex items-end gap-1">
          <motion.div animate={{ rotate: [-12, 12, -12] }} transition={{ duration: 1.2, repeat: Infinity }}>
            <DonutIcon className="h-9 w-9" color="#59c8ff" />
          </motion.div>
          <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 0.8, repeat: Infinity }}>
            <DonutIcon className="h-12 w-12" />
          </motion.div>
          <motion.div animate={{ rotate: [12, -12, 12] }} transition={{ duration: 1.2, repeat: Infinity }}>
            <DonutIcon className="h-9 w-9" color="#b77bff" />
          </motion.div>
        </div>
        <div className={`relative bg-clip-text text-[30px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[40px] ${GREEN_TEXT}`}>
          +{banner.spins} free spins
        </div>
        <div className={`relative mt-2 bg-clip-text text-[48px] font-black leading-none text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[60px] ${banner.mult >= 10 ? GOLD_TEXT : GREEN_TEXT}`}>
          ×{banner.mult} donuts
        </div>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">The meter filled up</div>
      </>
    )
  } else if (banner.kind === 'big') {
    body = (
      <>
        {mama}
        {tierTitle}
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(banner.amount / unit, 2)}× your bet</div>
      </>
    )
  } else if (banner.kind === 'end') {
    body = (
      <>
        {mama}
        <div className={`relative bg-clip-text text-[30px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[40px] ${GREEN_TEXT}`}>Bellies full!</div>
        {finalTier >= 0 && tierTitle}
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">
          {banner.spins} free spins · {fmt(banner.amount / unit, 2)}×
        </div>
      </>
    )
  } else {
    body = (
      <>
        {mama}
        <div className={`relative bg-clip-text text-[40px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[56px] ${GOLD_TEXT}`}>Max win</div>
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(MAX_WIN, 0)}× your bet · Big Mama is stuffed</div>
      </>
    )
  }

  return (
    <motion.div
      data-banner={banner.kind}
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-[#14072e]/65 p-6"
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

function PaytableModal({ bet, thumbs, cards, onClose }: { bet: number; thumbs: Partial<Record<Sym | 'host', string>>; cards: Partial<Record<FeastMod, string>>; onClose: () => void }) {
  // the pictures are drawn with room to spare around each symbol; shown a size up, cropped to their box
  const pic = (s: Sym | 'host', size = 44) =>
    thumbs[s] ? (
      <span className="relative shrink-0" style={{ width: size, height: size }}>
        <img src={thumbs[s]} alt="" draggable={false} className="absolute max-w-none" style={{ width: size * 1.4, height: size * 1.4, left: -size * 0.2, top: -size * 0.2 }} />
      </span>
    ) : (
      <span className="shrink-0 rounded-full" style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, background: s === 'host' ? '#ff4fa3' : SYMBOL_COLOR[s] }} />
    )
  const money = (m: number) => {
    const a = round2(bet * m)
    return a >= 10000 ? fmtCompact(a) : fmt(a, a >= 1000 ? 0 : 2)
  }
  return (
    <Modal onClose={onClose} title="Paytable" width={600}>
      <p className="text-[13px] text-muted">
        1,024 ways: three or more of a symbol on neighbouring reels, starting from the left, win. Each line below pays per way, and the ways multiply (two on a reel count twice). Amounts are for
        your bet of {fmt(bet)}.
      </p>
      <div className="mt-3 grid grid-cols-[1fr_repeat(3,60px)] items-center gap-x-2 px-2 text-center text-[11px] font-bold uppercase tracking-wider text-dim sm:grid-cols-[1fr_repeat(3,72px)]">
        <span className="text-left">Symbol</span>
        <span>3</span>
        <span>4</span>
        <span>5</span>
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {PAY_SYMS.map((s) => (
          <div key={s} className="grid grid-cols-[1fr_repeat(3,60px)] items-center gap-x-2 rounded-lg bg-stage px-2 py-0.5 sm:grid-cols-[1fr_repeat(3,72px)]">
            <div className="flex min-w-0 items-center gap-2">
              {pic(s, 40)}
              <span className="truncate text-[13px] font-bold">{SYMBOL_NAME[s]}</span>
            </div>
            {PAYS[s].map((m, i) => (
              <span key={i} className="tnum text-center text-[12px] font-extrabold sm:text-[13px]">
                {money(m)}
              </span>
            ))}
          </div>
        ))}
      </div>
      <Card tone="#2ee87f" icon={pic('wild', 52)}>
        <span className="font-bold text-ink">Chomper wilds</span> land on reels 2 to 5 and stand in for every paying symbol. Whenever donuts are on the screen, each wild eats all of them and pays their
        values. Now and then a hungry wild sneaks in when donuts land without one.
      </Card>
      <Card tone="#ff7ac8" icon={pic('donut', 52)}>
        <span className="font-bold text-ink">Donuts</span> show what they are worth. The icing colour hints at the size: <span style={{ color: donutColor(2) }}>pink</span>,{' '}
        <span style={{ color: donutColor(10) }}>blue</span>, <span style={{ color: donutColor(20) }}>violet</span>, <span style={{ color: donutColor(50) }}>red</span> and{' '}
        <span style={{ color: donutColor(100) }}>gold</span>. They land far more often in free spins, where they are worth up to {CONFIG.freeDonuts[CONFIG.freeDonuts.length - 1][0]}× the bet.
      </Card>
      <Card tone="#ffd96a" icon={pic('egg', 52)}>
        <span className="font-bold text-ink">Monster eggs</span> anywhere: 3, 4 or 5 pay {EGG_PAYS.map(money).join(', ')} and hatch {EGG_SPINS.join(', ')} free spins. In free spins every wild that lands
        fills the meter; each {WILDS_PER_LEVEL} wilds add {LEVEL_SPINS} spins and raise the donut multiplier to {LEVEL_MULTS.slice(1).map((x) => `×${x}`).join(', then ')}.
      </Card>

      <div className="mt-2 rounded-lg px-3 py-3" style={{ background: '#ff4fa31a', boxShadow: 'inset 0 0 0 1px #ff4fa340' }}>
        <div className="flex items-start gap-3">
          {pic('host', 52)}
          <div className="text-[13px] text-muted">
            <span className="font-bold text-ink">Feast Pick.</span> Every round of free spins opens with Big Mama Chomp offering three eggs. Pick one and it hatches a treat for the whole feature;
            the other two show what you missed.
          </div>
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {FEAST_MODS.map((k) => (
            <div key={k} className="flex flex-col items-center gap-1 rounded-lg bg-stage px-2 py-2 text-center">
              <ModBadge kind={k} src={cards[k]} className="h-11 w-11" />
              <span className="text-[12px] font-extrabold leading-tight" style={{ color: MOD[k].color }}>
                {MOD[k].name} <span className="tnum font-bold text-dim">{feastOdds(k)}%</span>
              </span>
              <span className="text-[11px] font-semibold leading-snug text-dim">{MOD[k].line}</span>
            </div>
          ))}
        </div>
      </div>

      <Card tone="#ffcf3a" icon={pic('grumbo', 52)}>
        <span className="font-bold text-ink">Buy free spins</span> for {BUY_PRICE}× the bet ({money(BUY_PRICE)}): {BUY_SPINS} spins with a Feast Pick.{' '}
        <span className="font-bold text-ink">Super Feast</span> costs {SUPER_PRICE}× ({money(SUPER_PRICE)}): {BUY_SPINS} spins that start Hungry (×{LEVEL_MULTS[1]} from the first spin) with a second
        treat from the eggs: {SUPER_MODS.map((k) => `${MOD[k].name.toLowerCase()} ${superOdds(k)}%`).join(', ')}. <span className="font-bold text-ink">Hungry Mode</span> makes each spin cost{' '}
        {ANTE_COST}× the bet with the same pays, and free spins start about once in {triggerEvery(true)} spins instead of {triggerEvery(false)}; the buys are off while it is on.
      </Card>
      <p className="mt-3 text-[12px] text-dim">
        A round pays at most {fmt(MAX_WIN, 0)}× the bet. Simulated return to player 96.1% for spins, Hungry Mode and both buys, over the long run.
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
