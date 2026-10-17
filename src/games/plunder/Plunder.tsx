import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, animate, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, Stat, Toggle, useStake } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { BojeLoader } from '../../components/Loader'
import { fmt, fmtCompact, round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { isMuted, sfx, type PlunderBed } from '../../lib/sound'
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { CHALLENGE_MIN_BET, useWallet } from '../../store/wallet'
import {
  BUY_PRICE,
  CONFIG,
  MAX_FREE_SPINS,
  MAX_WIN,
  PAYS,
  PAY_SYMS,
  REELS,
  RETRIGGER_MIN,
  SCATTER_MIN,
  calmBoard,
  playRound,
  teaseReel,
  waysOf,
  type Board,
  type Buy,
  type PlayOpts,
  type Round,
  type Spin,
  type Step,
  type Sym,
  type WayWin,
} from './rules'
import { SYMBOL_COLOR, SYMBOL_NAME, TIERS, tierIndex } from './meta'
import type { PlunderScene } from './scene'

/*
  Plunder Bay: a pirate Megaways slot on a ship's deck at sunset, with Captain Polly perched on the frame. The round is
  drawn in full when the spin is placed (rules.ts); this screen plays it back through the 3D scene step by step (the
  drop with its new reel heights, every cascade, the maps, then Treasure Hunt spin by spin with the multiplier
  medallion stamping up) and settles once the show is over.
*/

type BannerData =
  | { kind: 'intro'; spins: number; bought: boolean; maps: number }
  | { kind: 'retrigger'; spins: number; maps: number }
  | { kind: 'big'; amount: number; unit: number; count: number }
  | { kind: 'end'; amount: number; unit: number; count: number; spins: number; mult: number }
  | { kind: 'max'; amount: number; unit: number }
/** `jump`: the player tapped during the count-up, so the banner shows its final amount and tier */
type Banner = BannerData & { id: number; jump?: boolean }
/** an amount over a way win: its pay, then (in Treasure Hunt) ×the multiplier, then what it pays once it settles */
type Pop = { id: number; x: number; y: number; base: number; mult: number; pay: number | null; color: string; big?: boolean }
type FreeHud = { left: number; played: number; added: number; addId: number }
/** `mult`: the Treasure Hunt multiplier (1 outside it), shown in a pill on narrow stages */
type Hud = { win: number; maps: number; need: number; free: FreeHud | null; cascade: number; mult: number }
/** the full-stage stamp when the multiplier reaches ×10, ×20...; `legs` when it counts for the Sea Legs challenge */
type Stamp = { id: number; n: number; legs: boolean }

const EMPTY_HUD: Hud = { win: 0, maps: 0, need: SCATTER_MIN, free: null, cascade: 0, mult: 1 }
/** the crew: Polly chirps as a landing reel carries one of them on from reel 1 */
const CREW: readonly Sym[] = ['captain', 'shark', 'monkey', 'crab']
/** short names for captions */
const SHORT: Record<Sym, string> = {
  captain: 'Polly',
  shark: 'Finn',
  monkey: 'Coco',
  crab: 'Pinch',
  anchor: 'Anchor',
  compass: 'Compass',
  spyglass: 'Spyglass',
  bottle: 'Bottle',
  flag: 'Jolly Roger',
  map: 'Map',
}
/** fireworks rockets as a win banner reaches each tier */
const ROCKETS = [4, 7, 11, 18]
/** a step this big (in bets) gets the push-in and a cannon: 20× on a paid spin, 50× in Treasure Hunt (where the
 *  multiplier makes 20× steps common) */
const HUGE_STEP = { base: 20, free: 50 }
const INK = '#1f1029'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** "a, b or c" */
const either = (xs: readonly (string | number)[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`
const pick = <X,>(xs: readonly X[]) => xs[Math.floor(Math.random() * xs.length)]

/** the caption for a cascade step: its best way (short enough for a phone; the amounts show over every way) */
function stepCaption(step: Step, coins: (m: number) => number, free: boolean) {
  const w = step.wins.reduce((a, b) => (b.base > a.base ? b : a))
  // "winning ways", so it can't be read as the plaque's count of all ways
  const ways = w.ways > 1 ? ` · ${fmt(w.ways, 0)} winning ways` : ''
  const amount = free && step.mult > 1 ? ` · ×${step.mult}` : ` · ${fmt(coins(w.base))}`
  return `${SHORT[w.sym]} · ${w.len} reels${ways}${amount}`
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

// dev only: window.__plunderForce = 'feature' | 'big' | 'retrigger' | 'mult10' | 'max' | 'tease'
// replays the round until it shows that, for testing (the paid-spin ones leave buys alone)
const FORCE: Record<string, (r: Round) => boolean> = {
  feature: (r) => r.feature,
  big: (r) => r.total >= 15 && !r.free.length,
  retrigger: (r) => r.free.some((s) => s.award > 0),
  mult10: (r) => r.maxMult >= 10,
  tease: (r) => r.base != null && teaseReel(r.base.steps[0].board, SCATTER_MIN) >= 0,
  max: (r) => r.capped,
}
const PAID_ONLY = ['feature', 'big', 'tease']

/** dev: a seeded generator, so 'max' can replay a known capped round (the cap is about 1 in 1.7 million buys) */
function mulberry32(seed: number) {
  let a = seed | 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// found by tools/plunder-maxseed.ts: a bought hunt that caps on its sixth spin at ×19, and a paid spin of 43 draws that
// lands exactly four maps (twelve spins, like the buy), after which the buy's draws replay as its hunt
const MAX_BUY_SEED = 4292377
const MAX_PAID_SEED = 431
const MAX_PAID_DRAWS = 43

function forced(round: Round, opts: PlayOpts) {
  const name = (window as unknown as { __plunderForce?: string }).__plunderForce ?? ''
  if (name === 'max') {
    const hunt = mulberry32(MAX_BUY_SEED)
    if (opts.buy === 'fs') return playRound(hunt, opts)
    const paid = mulberry32(MAX_PAID_SEED)
    let k = 0
    return playRound(() => (k++ < MAX_PAID_DRAWS ? paid() : hunt()), opts)
  }
  const test = FORCE[name]
  if (!test || (opts.buy !== 'none' && PAID_ONLY.includes(name))) return round
  for (let i = 0; i < 300000 && !test(round); i++) round = playRound(rand, opts)
  return round
}

/** a round already paid for but not yet settled; kept in storage under `key` until it is */
type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.plunder.pending.${uid ?? 'guest'}`

/** a step reached the max win: the rules stop there, so the show ends on that step's winners, still lit */
const cutShort = (spin: Spin) => spin.capped && spin.steps[spin.steps.length - 1].wins.length > 0

export default function Plunder() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)
  const authStatus = useAuth((s) => s.status)
  const uid = useAuth((s) => s.uid)

  const [bet, setBet] = useState(10)
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurbo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [progress, setProgress] = useState(0.02)
  const [failed, setFailed] = useState(false)
  const [hud, setHud] = useState<Hud>(EMPTY_HUD)
  const [pops, setPops] = useState<Pop[]>([])
  const [banner, setBanner] = useState<Banner | null>(null)
  const [caption, setCaption] = useState<{ id: number; text: string } | null>(null)
  const [stamp, setStamp] = useState<Stamp | null>(null)
  const [lastWin, setLastWin] = useState(0)
  const [paytable, setPaytable] = useState(false)
  const [buying, setBuying] = useState(false)
  const [thumbs, setThumbs] = useState<Partial<Record<Sym | 'host', string>>>({})
  const [hudTop, setHudTop] = useState(-100)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PlunderScene | null>(null)
  const alive = useRef(true)
  const busyRef = useRef(false)
  const seq = useRef(1)
  /** the banner on screen: a tap skips its count-up or closes it; close() always closes */
  const bannerDone = useRef<{ tap: () => void; close: () => void } | null>(null)
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const autoRef = useRef(false)
  /** the round in play, from the stake until it is settled */
  const pending = useRef<Pending | null>(null)
  /** dead paid spins in a row; Polly grumbles at every eighth */
  const deadRun = useRef(0)
  /** maps that have come to rest in the current spin, and how many count (4 on a paid spin, 3 in Treasure Hunt) */
  const mapsN = useRef(0)
  const needRef = useRef(SCATTER_MIN)
  const captionTimer = useRef(0)
  /** when Polly last said something (performance.now) */
  const spokeAt = useRef(0)
  const widthRef = useRef(800)
  /** the board dropping in, for the crew chirps as its reels land */
  const dropBoard = useRef<Board | null>(null)
  /** the sea, creaks and gulls, and the shanty in Treasure Hunt; started by the first spin (audio needs a gesture) */
  const bed = useRef<PlunderBed | null>(null)

  /** pays the round in play, once: when its show ends, or as soon as the player leaves (the outcome is already drawn) */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'plunder', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: PlunderScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ PlunderScene }) => {
        if (!live) return
        setProgress(0.12)
        sc = new PlunderScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __plunderScene?: PlunderScene }).__plunderScene = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onCoin = () => sfx.coin()
        sc.onLanterns = () => sfx.plunder.lanterns()
        sc.onWays = (n) => sfx.plunder.ways(n)
        sc.onLand = (reel) => {
          sfx.plunder.land(reel)
          // a chirp, a step higher each reel, only while a crew member's run from reel 1 is still alive (wilds stand
          // in from reel 2), so it means a crew win may be coming
          const b = dropBoard.current
          if (b && reel >= 1 && CREW.some((s) => b.slice(0, reel + 1).every((cells, r) => cells.some((c) => c.sym === s || (r > 0 && c.sym === 'flag'))))) sfx.plunder.crew(reel)
        }
        sc.onMapLand = () => {
          const n = ++mapsN.current
          setHud((h) => ({ ...h, maps: n }))
          sfx.plunder.map(n - 1)
          if (n === needRef.current) sfx.plunder.mapsReady()
        }
        // the caption needs a line under the frame; the counters go on the deck under it when there is room (a phone),
        // else over the frame's bottom beam, so the reels can take the height (a desktop)
        sc.setHudRoom(30)
        const fit = () => {
          const r = host.getBoundingClientRect()
          widthRef.current = r.width
          sc!.resize(r.width, r.height)
          const f = sc!.frameRect()
          const rail = sc!.railRect()
          const pills = r.width >= 512 ? 40 : 36
          const below = r.height - f.bottom
          const top = below >= pills + 30 ? f.bottom + Math.max(2, (below - pills - 26) / 2) : (rail.top + rail.bottom) / 2 - pills / 2
          setHudTop(Math.round(Math.min(r.height - pills - 26, top)))
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          // the opening board may show a map or two, but maps don't carry over: the counter starts every spin empty
          sc.show(calmBoard(rand))
          say(`${SCATTER_MIN} maps start Treasure Hunt`)
          setReady(true)
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      clearTimeout(captionTimer.current)
      bed.current?.stop()
      bed.current = null
      bannerDone.current?.close()
      sc?.dispose()
      sceneRef.current = null
      // the dev hook would keep the disposed scene (and all its buffers) alive until the next visit
      if (import.meta.env.DEV) {
        const w = window as unknown as { __plunderScene?: PlunderScene }
        if (w.__plunderScene === sc) delete w.__plunderScene
      }
      settlePending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])

  // The browser's audio engine takes a tenth of a second to start: start it on the first press anywhere, so that
  // happens while the button is still down, not in the first frame of the first spin
  useEffect(() => {
    const wake = () => {
      sfx.plunder.wake()
      window.removeEventListener('pointerdown', wake, true)
      window.removeEventListener('keydown', wake, true)
    }
    window.addEventListener('pointerdown', wake, true)
    window.addEventListener('keydown', wake, true)
    return () => {
      window.removeEventListener('pointerdown', wake, true)
      window.removeEventListener('keydown', wake, true)
    }
  }, [])

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
    useWallet.getState().settle({ game: 'plunder', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Plunder Bay round paid out', amount: p.payout })
  }, [authStatus, uid])

  /* ---------------- playback ---------------- */

  /** banner time: turbo cuts it to 70%, as in the other slots */
  const hold = (ms: number) => (turboRef.current ? ms * 0.7 : ms)

  const say = (text: string | null) => {
    clearTimeout(captionTimer.current)
    setCaption(text == null ? null : { id: seq.current++, text })
  }

  /** Captain Polly does something, with a squawk when she talks; a `chatty` line is dropped if she spoke in the last 3 s */
  const polly = (action: Parameters<PlunderScene['host']>[0], line?: string | null, chatty = false) => {
    const now = performance.now()
    if (chatty && now - spokeAt.current < 3000) line = null
    sceneRef.current?.host(action, line)
    if (line === null) return
    spokeAt.current = now
    sfx.plunder.squawk(action === 'gasp' ? 1 : 0)
  }

  /** shows a banner for `ms`; one with a count-up of `count` seconds jumps to its end on the first tap */
  const showBanner = (b: BannerData, ms: number, count = 0) =>
    new Promise<void>((resolve) => {
      const id = seq.current++
      let ends = performance.now() + count * 1000
      setBanner({ ...b, id })
      // the bed dips under the banner's fanfare and count
      bed.current?.duck(Math.min(ms, Math.max(1600, count * 1000 + 600)) / 1000)
      const sc = sceneRef.current
      if (b.kind === 'intro') {
        sfx.plunder.intro()
        sc?.confettiBurst(60)
      } else if (b.kind === 'retrigger') sc?.confettiBurst(40)
      else if (b.kind === 'max') {
        sfx.plunder.fanfare()
        sc?.coinShower(3.6)
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
  const showWin = (b: { kind: 'big' } | { kind: 'end'; spins: number; mult: number }, amount: number, unit: number) => {
    const plan = countPlan(amount, unit)
    let count = plan[plan.length - 1][0] * (turboRef.current ? 0.6 : 1)
    if (b.kind === 'big' && autoRef.current) count = Math.min(count, 1.2)
    const ms = Math.max(b.kind === 'end' ? hold(3200) : 0, count * 1000 + hold(1200))
    if (b.kind === 'big' || amount >= unit * 20) sceneRef.current?.coinShower(ms / 1000)
    // the tiers bring their own fanfare; a smaller total gets the plain one
    if (tierIndex(amount / unit) < 0) sfx.plunder.win(2)
    return showBanner({ ...b, amount, unit, count }, ms, count)
  }

  /** a win banner's count passed a tier: a brass stab and a cannon, fireworks, confetti cannons, and Polly cheers */
  const tierUp = (k: number) => {
    const sc = sceneRef.current
    sfx.plunder.tierUp(k)
    bed.current?.duck(1.2, -14)
    sc?.fireworks(ROCKETS[k])
    sc?.confettiCannons()
    if (k >= 2) sc?.flash('#ffd23f', 0.35)
    polly(k >= 1 ? 'cheer' : 'squawk', pick(k >= 3 ? ['Rich as a king!', 'Legendary loot!'] : k >= 1 ? ['Shiver me timbers!', 'Yo ho ho!', 'Treasure!'] : ['Arr!', 'Pieces of eight!']))
  }

  /** the max win: a gold flash, confetti from every side, fireworks over the sea and the banner */
  const maxWin = async (amount: number, unit: number) => {
    const sc = sceneRef.current
    // the step's amount clears before the banner's own amount comes up over it
    setPops([])
    say(null)
    sc?.flash('#ffd23f', 0.5)
    sc?.confettiCannons()
    sc?.confettiBurst(150)
    sc?.fireworks(14)
    polly('cheer', 'The whole treasure!')
    await sc?.wait(0.38)
    if (!alive.current) return
    await showBanner({ kind: 'max', amount, unit }, hold(3800))
    // the capping step's winners were left lit (nothing blasts on it)
    sceneRef.current?.clearHighlight()
  }

  /** amounts over the way wins (the best four), pushed apart where they would overlap and kept on the stage */
  const wayPops = (wins: readonly WayWin[], coins: (m: number) => number, mult: number): Pop[] => {
    const sc = sceneRef.current
    const w = widthRef.current
    const out: Pop[] = []
    for (const win of [...wins].sort((a, b) => b.base - a.base).slice(0, 4)) {
      const at = sc?.screenOf(win.ids) ?? { x: w / 2, y: 200 }
      const x = Math.min(w - 56, Math.max(56, at.x))
      let y = at.y
      while (out.some((p) => Math.abs(p.y - y) < 36 && Math.abs(p.x - x) < 120)) y += 38
      out.push({ id: seq.current++, x, y, base: coins(win.base), mult, pay: mult > 1 ? null : coins(win.base), color: SYMBOL_COLOR[win.sym], big: win.base * mult >= 5 })
    }
    return out
  }

  /** plays one spin of a round; `before` is the total already on the counter; `quick` drops a dead free spin 1.2×
   *  faster. Returns the new total, or null once the screen is gone. */
  const playSpin = async (sc: PlunderScene, spin: Spin, free: boolean, before: number, unit: number, quick = false): Promise<number | null> => {
    const coins = (m: number) => round2(m * unit)
    const cap = MAX_WIN * unit
    let run = before
    const add = (m: number) => {
      run = Math.min(cap, round2(run + coins(m)))
      setHud((h) => ({ ...h, win: run }))
    }

    // the old symbols drop out, the reels take their new heights and the new symbols drop in; with a map short of
    // the feature showing, the reels after it hold back under Polly's spyglass
    const need = free ? RETRIGGER_MIN : SCATTER_MIN
    needRef.current = need
    mapsN.current = 0
    setHud((h) => ({ ...h, maps: 0, need, cascade: 0 }))
    const first = spin.steps[0].board
    const tease = teaseReel(first, need)
    if (tease >= 0) {
      const secs = ((REELS - tease) * 0.55) / (turboRef.current ? 1.75 : 1)
      void sc.wait(0.2 + 0.085 * tease).then(() => alive.current && !sc.hurried && sfx.plunder.tease(secs))
    }
    sfx.plunder.spin()
    dropBoard.current = first
    if (quick) sc.setChain(1.2)
    await sc.drop(first, tease)
    sc.setChain(1)
    dropBoard.current = null
    if (!alive.current) return null
    const ways = waysOf(spin.heights)
    if (ways >= 20000) {
      say(`${fmt(ways, 0)} ways!`)
      sfx.plunder.bell()
    }

    for (let i = 0; i < spin.steps.length; i++) {
      const step = spin.steps[i]
      if (!step.wins.length) break
      const next = spin.steps[i + 1]
      const ids = [...new Set(step.wins.flatMap((w) => w.ids))]
      // from the fifth winning step on, each plays 1.3× faster, up to 2×
      sc.setChain(i >= 4 ? Math.min(2, 1.3 ** (i - 3)) : 1)
      sc.setCombo(i + 1)
      if (i >= 1) setHud((h) => ({ ...h, cascade: i + 1 }))
      sfx.plunder.glow(i)
      await sc.highlight(step.wins)
      if (!alive.current) return null

      // an amount over each way; in Treasure Hunt the multiplier joins it, then it settles to what it pays. The step
      // that reaches the max win shows the one amount it adds (the cap cuts the rest)
      const mult = free ? step.mult : 1
      const capping = !next
      const labels = capping ? [] : wayPops(step.wins, coins, mult)
      if (capping) {
        const room = round2(cap - run)
        const at = sc.screenOf(ids) ?? { x: widthRef.current / 2, y: 200 }
        setPops([{ id: seq.current++, x: Math.min(widthRef.current - 70, Math.max(70, at.x)), y: at.y, base: room, mult: 1, pay: room, color: '#ffd23f', big: true }])
        say('Max win reached!')
      } else {
        setPops(labels)
        say(stepCaption(step, coins, free))
      }
      const size = step.win >= 5 ? 2 : step.win >= 1 ? 1 : 0
      if (mult > 1 && !capping) {
        sfx.plunder.chip(mult)
        await sc.wait(0.22)
        if (!alive.current) return null
        setPops(labels.map((p) => ({ ...p, pay: round2(p.base * mult), big: p.base * mult >= coins(5) })))
        sfx.plunder.slam(mult)
      }
      add(step.win)
      sfx.plunder.win(size)
      if (step.win >= HUGE_STEP[free ? 'free' : 'base']) {
        sfx.plunder.cannon()
        polly('gasp', pick(['Blimey!', 'Great barnacles!', 'Sink me!']))
        await sc.bigWin(ids)
        if (!alive.current) return null
      } else if (step.win >= 3) polly('cheer', pick(['Yo ho ho!', 'Treasure!', 'Arr, gold!']), true)
      // a moment to read the amounts: a little longer for each further way in the step
      await sc.wait((free ? 0.1 : 0.3) + Math.min(3, step.wins.length - 1) * 0.1)
      if (!alive.current) return null

      // the step that reached the max win: nothing blasts and the multiplier stays, the max banner follows
      if (capping) break

      if (free) {
        // a coin flies from the winners to the medallion, which stamps up to the next multiplier
        const n = step.mult + 1
        const flies = !sc.hurried
        sfx.plunder.coinFly()
        void sc.wait(flies ? 0.28 : 0).then(() => alive.current && sfx.plunder.stamp(n))
        await sc.stampMult(n, ids)
        if (!alive.current) return null
        setHud((h) => ({ ...h, mult: n }))
        if (n >= 10) bed.current?.fast(true)
        if (n % 10 === 0) {
          // "Sea legs!" only where the Sea Legs challenge counts the round
          const legs = n === 10 && (pending.current?.bet ?? 0) >= CHALLENGE_MIN_BET
          setStamp({ id: seq.current++, n, legs })
          sfx.plunder.milestone(n)
          polly('cheer', legs ? 'Sea legs! ×10!' : `×${n}! Shiver me timbers!`)
        } else if (n % 5 === 0) say(`Multiplier ×${n}!`)
      }

      setPops([])
      await sc.blast(ids, (j) => sfx.plunder.blast(i + j))
      if (!alive.current) return null
      sfx.plunder.cascade()
      await sc.cascade(next.board)
      if (!alive.current) return null
    }
    sc.setChain(1)
    sc.setCombo(0)
    setHud((h) => ({ ...h, cascade: 0 }))
    // that step ends the show: no maps and no scatter pay, the max banner follows
    if (cutShort(spin)) return run

    if (!free && spin.maps >= SCATTER_MIN) {
      // the maps flare and pay; they start Treasure Hunt (Polly unrolls the big map), or, when the pay reaches the
      // max win, she digs for it
      const at = sc.screenOf(spin.mapIds) ?? { x: widthRef.current / 2, y: 200 }
      const pay = Math.min(coins(spin.scatterPay), round2(cap - run))
      setPops([{ id: seq.current++, x: Math.min(widthRef.current - 56, Math.max(56, at.x)), y: at.y, base: pay, mult: 1, pay, color: '#ffd36a', big: true }])
      add(spin.scatterPay)
      sfx.plunder.treasure()
      say(spin.award ? `${spin.maps} treasure maps · ${spin.award} free spins!` : `${spin.maps} treasure maps · ${fmt(coins(spin.scatterPay))}`)
      if (spin.award) {
        // a tap during the drop must not rush the rarest moment; a tap during it still speeds it up
        sc.calm()
        await sc.trigger(spin.mapIds, (beat) => {
          if (!alive.current) return
          if (beat === 'fly') sfx.plunder.coinFly()
          else if (beat === 'unroll') {
            // the map pay has had its moment; the big map takes the middle of the stage
            setPops([])
            sfx.plunder.unfurl()
          } else if (beat === 'boom') {
            sfx.plunder.xMarks()
            void sc.wait(0.14).then(() => alive.current && sfx.plunder.dig())
          }
        })
      } else {
        void sc.wait(0.3).then(() => alive.current && sfx.plunder.dig())
        await sc.maps(spin.mapIds, 'pay')
      }
      if (!alive.current) return null
      setPops([])
    } else if (!free && spin.maps === SCATTER_MIN - 1) {
      say('So close! One more map starts Treasure Hunt')
      sfx.plunder.nearMiss()
      polly('gasp', pick(['So close!', 'One map short!', 'Blast it!']))
    } else if (free && spin.maps >= RETRIGGER_MIN && !spin.award) say(`Treasure Hunt is full · ${MAX_FREE_SPINS} spins`)
    return run
  }

  /** Treasure Hunt: the banner, the sail into the night, every free spin with its retriggers, the end banner and back to the sunset */
  const playFeature = async (sc: PlunderScene, round: Round, buy: Buy, before: number, unit: number, payout: number) => {
    let shown = before
    // a tap that sped up the paid spin must not rush the hunt it started; a tap in the hunt speeds up the rest
    sc.calm()
    await showBanner({ kind: 'intro', spins: round.startSpins, bought: buy === 'fs', maps: round.base?.maps ?? 0 }, hold(buy === 'fs' ? 2000 : 2200))
    if (!alive.current) return false
    setPops([])
    say(null)
    sfx.plunder.night()
    bed.current?.mode('night')
    let left = round.startSpins
    let played = 0
    let added = 0
    /** dead free spins in a row */
    let dead = 0
    setHud((h) => ({ ...h, win: shown, maps: 0, need: RETRIGGER_MIN, free: { left, played, added, addId: 0 }, mult: 1 }))
    await sc.setFree(true)
    if (!alive.current) return false
    say('The multiplier climbs with every cascade win')

    for (const fs of round.free) {
      left--
      played++
      setHud((h) => ({ ...h, free: { left, played, added, addId: h.free?.addId ?? 0 } }))
      // a free spin that wins nothing (and teases nothing) drops quicker and moves straight on
      const quiet = !fs.steps[0].wins.length && fs.maps < RETRIGGER_MIN && teaseReel(fs.steps[0].board, RETRIGGER_MIN) < 0
      if (left === 0) {
        say('Last spin!')
        if (!turboRef.current) {
          sfx.plunder.heartbeat()
          polly('spyglass', 'Last spin, mateys…')
          await sc.wait(0.45)
          if (!alive.current) return false
        }
      } else say(`Spin ${played} · ×${fs.steps[0].mult}${played > 1 && dead >= 2 ? ' waiting' : ''}`)
      const r = await playSpin(sc, fs, true, shown, unit, quiet)
      if (r == null) return false
      shown = r
      if (fs.win > 0 || fs.award > 0) dead = 0
      else if (++dead % 3 === 0) {
        // a dry run: Polly keeps the crew going and the medallion glints, waiting
        sc.glintMedal()
        sfx.plunder.glint()
        polly('squawk', pick(['Keep digging!', 'Steady, crew…', 'Arr, nothing yet…', 'The gold is down there!']), true)
      }
      if (fs.award > 0) {
        left += fs.award
        added += fs.award
        setHud((h) => ({ ...h, free: { left, played, added, addId: seq.current++ } }))
        sfx.plunder.retrigger()
        say(`${fs.maps} treasure maps · +${fs.award} spins`)
        await sc.maps(fs.mapIds, 'retrigger')
        if (!alive.current) return false
        await showBanner({ kind: 'retrigger', spins: fs.award, maps: fs.maps }, hold(1800))
        if (!alive.current) return false
      }
      if (fs.capped) break
      if (!(quiet && dead > 0)) await sc.wait(0.3)
      if (!alive.current) return false
    }

    if (round.capped) await maxWin(payout, unit)
    else {
      polly(payout >= unit * 40 ? 'cheer' : 'squawk', payout >= unit * 40 ? 'What a haul!' : payout > 0 ? 'Not bad, matey!' : 'Bah! Empty chest…')
      await showWin({ kind: 'end', spins: played, mult: round.maxMult }, payout, unit)
    }
    if (!alive.current) return false
    say(null)
    sfx.plunder.dawn()
    bed.current?.mode('day')
    bed.current?.fast(false)
    setHud((h) => ({ ...h, free: null, maps: 0, need: SCATTER_MIN, win: payout, mult: 1 }))
    await sc.setFree(false)
    return alive.current
  }

  const play = async (buy: Buy): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const unit = bet
    const opts: PlayOpts = { buy }
    const cost = round2(unit * (buy === 'fs' ? BUY_PRICE : 1))
    if (!stake(cost)) return null
    busyRef.current = true
    setBusy(true)
    setPops([])
    say(null)
    setHud(EMPTY_HUD)
    sfx.spinStart()
    if (!bed.current && !isMuted()) bed.current = sfx.plunder.bed()

    let round = playRound(rand, opts)
    if (import.meta.env.DEV) {
      round = forced(round, opts)
      // for the timing checks in tools/plunder-qa.mjs
      ;(window as unknown as { __plunderRound?: Round }).__plunderRound = round
    }
    const payout = round2(unit * round.total)
    const meta = { feature: round.feature, buy, mult: payout / cost, maxMult: round.maxMult, spins: round.free.length, capped: round.capped }
    // stored before the show starts, so even a page that never gets to settle can't lose the round
    const key = pendingKey(uid)
    pending.current = { bet: cost, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: cost, payout, meta }))

    let shown = 0
    if (round.base) {
      const r = await playSpin(sc, round.base, false, 0, unit)
      if (r == null) return null
      shown = r
      if (round.base.win > 0 || round.base.maps >= SCATTER_MIN - 1) deadRun.current = 0
      else if (++deadRun.current % 8 === 0) polly('squawk', pick(['Bah! Barnacles!', 'Nothing but sea water…', 'Keep sailing!']))
    }

    if (round.free.length) {
      if (!(await playFeature(sc, round, buy, shown, unit, payout))) return null
    } else if (round.capped) {
      await maxWin(payout, unit)
      if (!alive.current) return null
    }

    // a big win on a paid spin: its banner counts up first, then the round pays, so the header balance can't give it
    // away (leaving or reloading during the banner pays through settlePending all the same)
    if (!round.free.length && !round.capped && payout >= unit * 15) await showWin({ kind: 'big' }, payout, unit)
    if (!alive.current) return null
    // a no-op if the page already paid it on its way out (and came back from the back/forward cache)
    settlePending()
    setLastWin(payout)
    setHud((h) => ({ ...h, win: payout }))
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

  const buyCost = round2(bet * BUY_PRICE)
  const free = hud.free
  const freeLabel = !free ? undefined : free.played === 0 ? `Treasure Hunt · ${free.left} spins` : free.left === 0 ? `Treasure Hunt ${free.played} · last spin` : `Treasure Hunt ${free.played} · ${free.left} left`

  const panel = (
    <>
      <ModeTabs mode={mode} onChange={setMode} disabled={locked} />
      {/* on a phone the bet comes straight after the Spin button, above the fold */}
      <div className="max-lg:-order-1">
        <BetInput value={bet} onChange={setBet} disabled={locked} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Last win" value={fmt(lastWin)} tone={lastWin > 0 ? 'accent' : undefined} />
        <Stat label="Max win" value={`${fmt(MAX_WIN, 0)}×`} />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <span className="text-[13px] font-semibold text-muted">Turbo</span>
        <Toggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <BuyButton cost={buyCost} spins={CONFIG.spins[0]} disabled={locked || !ready || balance < buyCost} onClick={() => (sfx.click(), setBuying(true))} />
      <button onClick={() => (sfx.click(), setPaytable(true))} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Paytable
      </button>
      <div className="max-lg:order-first lg:mt-auto">
        {auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop} sub={freeLabel}>
            Stop autospin
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
          <ActionButton onClick={() => void play('none')} disabled={!ready || balance < bet}>
            Spin
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || balance < bet}>
            Start autospin
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const need = hud.need
  const stage = (
    <div className="@container absolute inset-0 overflow-hidden bg-[#2b1748]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* counters and caption: on the deck under the frame, or over its bottom beam; out of the way of a banner */}
      <motion.div
        className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1.5 px-2"
        style={{ top: hudTop }}
        animate={{ opacity: banner && banner.kind !== 'retrigger' ? 0 : 1 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex items-center justify-center gap-1.5 @lg:gap-2">
          <AnimatePresence mode="popLayout" initial={false}>
            {free && (
              <motion.div key="spins" layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={`${pill} relative`} aria-label={`${free.left} free spins left`}>
                <span className={`${pillLabel} text-[#9fe8ff]/85`}>Spins</span>
                <motion.span key={`left-${free.left}`} initial={{ scale: 1.35 }} animate={{ scale: 1 }} className={`tnum font-black ${free.left === 0 ? 'text-[13px] uppercase text-[#ff9a8a] @lg:text-[15px]' : 'text-[15px] text-white @lg:text-[18px]'}`}>
                  {free.left === 0 ? 'Last' : free.left}
                </motion.span>
                {free.addId > 0 && (
                  <motion.span
                    key={`add-${free.addId}`}
                    className="absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-[#1f1029] bg-[#ffd23f] px-2 py-0.5 text-[10px] font-black uppercase leading-none tracking-wider text-[#1f1029] shadow-[0_2px_0_#1f1029]"
                    initial={{ opacity: 0, scale: 0.5, y: 8 }}
                    animate={{ opacity: [0, 1, 1, 0], scale: [0.5, 1.15, 1, 1], y: [8, 0, 0, -6] }}
                    transition={{ duration: 1.6, times: [0, 0.15, 0.78, 1] }}
                  >
                    More spins
                  </motion.span>
                )}
              </motion.div>
            )}
            {free && (
              // the multiplier, for narrow stages, where the medallion on the frame is small
              <motion.div key="mult" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={`${pill} relative @lg:hidden`} aria-label={`multiplier ×${hud.mult}`}>
                <span className={`${pillLabel} text-[#ffd36a]/85`}>Mult</span>
                <motion.span
                  key={`mult-${hud.mult}`}
                  initial={hud.mult > 1 ? { scale: 1.7, color: '#ffffff' } : false}
                  animate={{ scale: 1, color: '#ffd23f' }}
                  transition={{ type: 'spring', stiffness: 520, damping: 13 }}
                  className="tnum inline-block text-[15px] font-black"
                >
                  ×{hud.mult}
                </motion.span>
              </motion.div>
            )}
            {(free || hud.win > 0) && (
              <motion.div key="win" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={`${pill} relative`}>
                <span className={`${pillLabel} text-gold/85`}>{free ? 'Total' : 'Win'}</span>
                <Counter value={hud.win} className="text-[15px] font-black text-gold @lg:text-[18px]" />
                <AnimatePresence>
                  {hud.cascade > 1 && (
                    // over the pill's middle on a narrow stage (clear of its label), on its corner from @lg up
                    <motion.span
                      key="cascade"
                      initial={{ scale: 0, rotate: -14 }}
                      animate={{ scale: 1, rotate: 4 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
                      className="absolute -top-5 left-1/2 -translate-x-1/2 @lg:-right-3 @lg:-top-3 @lg:left-auto @lg:translate-x-0"
                    >
                      <motion.span
                        key={`cascade-${hud.cascade}`}
                        initial={{ scale: 1.3 }}
                        animate={{ scale: 1 }}
                        transition={{ type: 'spring', stiffness: 600, damping: 14 }}
                        className="tnum block whitespace-nowrap rounded-full border-2 border-[#1f1029] bg-[#2fc7c9] px-2 py-0.5 text-[10.5px] font-black uppercase leading-tight text-[#0b2030] shadow-[0_2px_0_#1f1029]"
                      >
                        Cascade {hud.cascade}
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
            <motion.div key="maps" layout className={`${pillBase} gap-0.5 pl-3 pr-2.5 @lg:gap-1 @lg:pl-4 @lg:pr-3`} aria-label={`${hud.maps} treasure ${hud.maps === 1 ? 'map' : 'maps'}, ${need} needed`}>
              <span className={`${pillLabel} mr-1 text-[#f6dfa4]/80`}>Maps</span>
              {Array.from({ length: need }, (_, i) => (
                <motion.span
                  key={`${need}-${i}-${i < hud.maps}`}
                  initial={i < hud.maps ? { scale: 1.9, rotate: -16, y: -4 } : false}
                  animate={hud.maps === need - 1 && i >= hud.maps ? { opacity: [0.45, 1, 0.45] } : { scale: 1, rotate: 0, y: 0 }}
                  transition={hud.maps === need - 1 && i >= hud.maps ? { duration: 0.6, repeat: Infinity } : { type: 'spring', stiffness: 500, damping: 14 }}
                  className={hud.maps >= need ? 'drop-shadow-[0_0_6px_#ffd36a]' : ''}
                >
                  <MapIcon on={i < hud.maps} className="h-[17px] w-[22px] @lg:h-5 @lg:w-[26px]" />
                </motion.span>
              ))}
              {hud.maps > need && (
                <motion.span key={hud.maps} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="tnum ml-0.5 text-[13px] font-black text-[#ffe3a0]">
                  ×{hud.maps}
                </motion.span>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="relative h-5 w-full max-w-[560px]" aria-live="polite">
          {/* one caption at a time: the old one is gone before the new one comes in */}
          <AnimatePresence initial={false} mode="wait">
            {caption && (
              <motion.div
                key={caption.id}
                className="absolute inset-0 truncate text-center text-[13px] font-bold text-white/90 [text-shadow:0_1.5px_0_#1f1029,0_0_3px_#1f1029,0_0_3px_#1f1029]"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0, transition: { duration: 0.16 } }}
                exit={{ opacity: 0, y: -3, transition: { duration: 0.08 } }}
              >
                {caption.text}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* amounts over each way */}
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
              key={p.pay != null ? 'pay' : 'base'}
              initial={{ scale: p.pay != null && p.mult > 1 ? 1.45 : 1 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 14 }}
              className={`inline-block ${p.big ? 'text-[28px] @lg:text-[36px]' : 'text-[22px] @lg:text-[28px]'}`}
              // cartoon lettering: an ink outline and a hard drop, no glow
              style={{ color: p.big ? '#ffd84a' : '#fff', WebkitTextStroke: `5px ${INK}`, paintOrder: 'stroke fill', textShadow: `0 4px 0 ${INK}` }}
            >
              {p.pay != null ? (
                fmt(p.pay)
              ) : (
                <>
                  {fmt(p.base)}
                  <motion.span initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 600, damping: 13 }} className="ml-1 inline-block text-[#ffd23f]">
                    ×{p.mult}
                  </motion.span>
                </>
              )}
            </motion.span>
          </motion.div>
        ))}
      </AnimatePresence>

      {stamp && <StampFx key={stamp.id} n={stamp.n} legs={stamp.legs} onDone={() => setStamp(null)} />}

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} onTap={() => bannerDone.current?.tap()} onTier={tierUp} />}</AnimatePresence>

      {/* while it loads: the banners drawn once under the loader's opaque backdrop, so the browser has every effect they
          use (the rays, the inked titles) ready before the first real one, which would otherwise stutter. They go the
          moment the scene is ready, before the loader fades: drawn over the loader, even at 1% opacity, Chromium let
          the inked titles show through */}
      {!ready && !failed && (
        <div className="pointer-events-none absolute inset-0 z-30 opacity-[0.012]" aria-hidden>
          <BannerCard banner={WARM_INTRO} onTap={noop} onTier={noop} />
          <BannerCard banner={WARM_END} onTap={noop} onTier={noop} />
          <StampFx n={10} legs onDone={noop} />
        </div>
      )}

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_38%,#5a2f6e_0%,#2b1748_70%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Hoisting the sails" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100vw+112px)] max-sm:min-h-[450px] sm:max-lg:h-[min(80vh,780px)]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(false)} title="Buy Treasure Hunt" width={400}>
            <div className="flex items-start gap-3">
              <MapIcon className="mt-0.5 h-9 w-11 shrink-0" />
              <p className="text-[14px] text-muted">
                Set sail straight away on {CONFIG.spins[0]} free spins for <span className="font-bold text-ink">{fmt(buyCost)}</span> coins, {BUY_PRICE}× your bet. The multiplier starts at ×1 and
                climbs after every cascade win, all hunt long.
              </p>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => setBuying(false)}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="gold"
                disabled={balance < buyCost}
                onClick={() => {
                  setBuying(false)
                  void play('fs')
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

/** the banners drawn once while the game loads (see the stage) */
const WARM_INTRO: Banner = { kind: 'intro', spins: 12, bought: true, maps: 4, id: -1 }
const WARM_END: Banner = { kind: 'end', amount: 600, unit: 1, count: 0.1, spins: 12, mult: 11, id: -2, jump: true }
const noop = () => {}

/** an inked counter pill in the frame's navy and brass */
const pillBase = 'flex h-9 items-center rounded-full border-2 border-[#1f1029] bg-[#16244a]/95 shadow-[0_3px_0_rgba(31,16,41,.6),inset_0_0_0_1.5px_rgba(232,176,74,.32)] @lg:h-10'
/** a counter pill: label over value on phones, so three of them fit across; side by side from sm up */
const pill = `${pillBase} flex-col justify-center gap-0.5 px-3.5 leading-none @lg:flex-row @lg:gap-2 @lg:px-4`
const pillLabel = 'text-[9px] font-bold uppercase tracking-wider @lg:text-[11px]'

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

function BuyButton({ cost, spins, disabled, onClick }: { cost: number; spins: number; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-14 items-center gap-3 rounded-lg bg-[linear-gradient(180deg,#ffe58a,#f5b41f)] px-3 text-left text-[#3a2400] shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-40"
    >
      <MapIcon className="h-8 w-10 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-extrabold leading-tight">Buy Treasure Hunt</span>
        <span className="block text-[12px] font-bold leading-tight opacity-75">{spins} free spins</span>
      </span>
      <span className="tnum shrink-0 rounded bg-black/15 px-1.5 py-1 text-[12px] font-extrabold leading-none">{fmt(cost, cost >= 1000 ? 0 : 2)}</span>
    </button>
  )
}

/** a treasure map: the HUD pips (dim until one lands), the buy button and the banners */
function MapIcon({ on = true, className = '' }: { on?: boolean; className?: string }) {
  const line = on ? INK : 'rgba(246,225,173,.38)'
  return (
    <svg viewBox="0 0 30 24" className={className} aria-hidden>
      <path d="M6 4.5h18v15H6Z" fill={on ? '#f6e1ad' : 'rgba(246,225,173,.1)'} stroke={line} strokeWidth={on ? 1.8 : 1.4} strokeLinejoin="round" />
      {on && (
        <>
          <path d="M8.6 16.2c1.6-3.4 4.4-4.4 7-2.6" fill="none" stroke="#a86f2c" strokeWidth="1.6" strokeDasharray="1.9 1.7" strokeLinecap="round" />
          <path d="m16.9 8.2 4.6 4.6m0-4.6-4.6 4.6" stroke="#e8344a" strokeWidth="2.6" strokeLinecap="round" />
        </>
      )}
      <rect x="2.5" y="3" width="5" height="18" rx="2.5" fill={on ? '#e4b768' : 'rgba(246,225,173,.16)'} stroke={line} strokeWidth={on ? 1.8 : 1.4} />
      <rect x="22.5" y="3" width="5" height="18" rx="2.5" fill={on ? '#e4b768' : 'rgba(246,225,173,.16)'} stroke={line} strokeWidth={on ? 1.8 : 1.4} />
      {on && <rect x="3.9" y="5" width="1.4" height="9" rx=".7" fill="#fff" opacity=".7" />}
    </svg>
  )
}

/** the gold multiplier coin, a skull and crossbones on its face */
function CoinMedal({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <radialGradient id="plunder-coin" cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff2b0" />
          <stop offset=".5" stopColor="#ffc93d" />
          <stop offset="1" stopColor="#d98a12" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="21" fill="url(#plunder-coin)" stroke={INK} strokeWidth="3" />
      <circle cx="24" cy="24" r="16" fill="none" stroke="#b86e0c" strokeWidth="1.6" strokeDasharray="2.4 2.2" />
      <g stroke={INK} strokeWidth="2.4" strokeLinecap="round">
        <path d="M15 33 33 19M15 19l18 14" />
      </g>
      <path d="M17.5 21.5c0-4 2.9-6.8 6.5-6.8s6.5 2.8 6.5 6.8c0 2-1 3.3-2.3 4v2.6h-8.4v-2.6c-1.3-.7-2.3-2-2.3-4Z" fill="#fff7dc" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="21.4" cy="21.6" r="1.9" fill={INK} />
      <circle cx="26.6" cy="21.6" r="1.9" fill={INK} />
      <path d="M22.4 28.1v-1.6M25.6 28.1v-1.6" stroke={INK} strokeWidth="1.3" />
      <ellipse cx="17" cy="14.5" rx="3.6" ry="2" fill="#fff" opacity=".6" transform="rotate(-35 17 14.5)" />
    </svg>
  )
}

/** light rays behind a banner, one colour per ray in turn */
const rays = (...colors: string[]) =>
  `repeating-conic-gradient(from 0deg, ${colors.map((c, i) => `${c} ${i * 22.5}deg ${i * 22.5 + 7}deg, transparent ${i * 22.5 + 7}deg ${(i + 1) * 22.5}deg`).join(', ')})`
const HUNT_RAYS = rays('rgba(255,200,61,.38)', 'rgba(47,199,201,.3)')
const GOLD_RAYS = rays('rgba(255,200,61,.4)')
/** each win tier's title gradient and rays: doubloon gold, sea green, ruby, then every jewel in the chest */
const TIER_LOOK = [
  { text: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]', rays: rays('rgba(255,200,61,.36)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#b4f6ee_45%,#22c3b4_100%)]', rays: rays('rgba(47,199,201,.36)', 'rgba(255,200,61,.3)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#ffc4bb_45%,#ff4a3d_100%)]', rays: rays('rgba(255,90,78,.36)', 'rgba(255,200,61,.32)') },
  {
    text: 'bg-[linear-gradient(100deg,#ffd23f_0%,#ff5a4e_28%,#c48bff_52%,#2fd3c6_76%,#ffd23f_100%)]',
    rays: rays('rgba(255,210,63,.38)', 'rgba(255,90,78,.32)', 'rgba(196,139,255,.32)', 'rgba(47,211,198,.32)'),
  },
]
const GOLD_TEXT = TIER_LOOK[0].text
const SEA_TEXT = TIER_LOOK[1].text
/** parchment, for Treasure Hunt */
const MAP_TEXT = 'bg-[linear-gradient(180deg,#fffaf0_0%,#f6dfa4_50%,#e0a64a_100%)]'

/**
 * A cartoon title, lettered like the ways plaque: the gradient over a thick ink outline with a hard drop under it.
 * The outline is a copy of the text behind, stroked, so the stroke never eats into the letters.
 */
function Toon({ children, className, look, stroke = 8 }: { children: ReactNode; className: string; look: string; stroke?: number }) {
  return (
    <div className={`relative ${className}`}>
      <span className="absolute inset-0 text-[#1f1029] [filter:drop-shadow(0_4px_0_#1f1029)]" style={{ WebkitTextStroke: `${stroke}px ${INK}` }} aria-hidden>
        {children}
      </span>
      <span className={`relative bg-clip-text text-transparent ${look}`}>{children}</span>
    </div>
  )
}

/** the multiplier reaching ×10, ×20...: the number slams across the stage; taps go straight through */
function StampFx({ n, legs, onDone }: { n: number; legs: boolean; onDone: () => void }) {
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[40%] z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
      initial={{ scale: 2.4, opacity: 0, rotate: -10 }}
      animate={{ scale: [2.4, 0.92, 1, 1, 1.1], opacity: [0, 1, 1, 1, 0], rotate: -6 }}
      transition={{ duration: 1.7, times: [0, 0.12, 0.2, 0.82, 1], ease: 'easeOut' }}
      onAnimationComplete={onDone}
    >
      <CoinMedal className="h-14 w-14 @lg:h-16 @lg:w-16" />
      <Toon look={GOLD_TEXT} stroke={11} className="mt-1 text-[60px] font-black italic leading-none tracking-tight @lg:text-[88px]">
        ×{n}
      </Toon>
      <Toon look={SEA_TEXT} stroke={7} className="mt-1 whitespace-nowrap text-[22px] font-black uppercase italic leading-none @lg:text-[30px]">
        {legs ? 'Sea legs!' : n === 10 ? 'Shipshape!' : 'Full sail!'}
      </Toon>
    </motion.div>
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
  const look = banner.kind === 'intro' || banner.kind === 'retrigger' ? HUNT_RAYS : banner.kind === 'max' ? GOLD_RAYS : TIER_LOOK[Math.max(0, tier)].rays
  const money = amount != null && (
    <div className="tnum relative mt-3 flex items-center gap-2 text-[34px] font-black text-white drop-shadow-[0_3px_0_rgba(0,0,0,.5)] @lg:text-[44px]">
      {fmt(n)} <Coin size={34} />
    </div>
  )
  const tierTitle = (
    <div className="relative flex h-[40px] items-center justify-center @lg:h-[56px]">
      <AnimatePresence mode="popLayout">
        {tier >= 0 && (
          <motion.div
            key={tier}
            initial={{ scale: 1.25, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 12 }}
          >
            <Toon look={TIER_LOOK[tier].text} className="whitespace-nowrap text-[32px] font-black uppercase italic leading-none tracking-tight @lg:text-[50px]">
              {TIERS[tier].name}
            </Toon>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  let body: ReactNode
  if (banner.kind === 'intro') {
    body = (
      <>
        <div className="relative mb-2 flex items-end gap-2">
          <motion.div animate={{ y: [0, -5, 0], rotate: [-14, -6, -14] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}>
            <MapIcon className="h-10 w-12" />
          </motion.div>
          <motion.div animate={{ y: [0, -8, 0], rotateY: [0, 180, 360] }} transition={{ y: { duration: 0.9, repeat: Infinity, ease: 'easeInOut' }, rotateY: { duration: 2.4, repeat: Infinity, ease: 'linear' } }}>
            <CoinMedal className="h-16 w-16 drop-shadow-[0_0_14px_rgba(255,200,61,.7)]" />
          </motion.div>
          <motion.div animate={{ y: [0, -5, 0], rotate: [14, 6, 14] }} transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}>
            <MapIcon className="h-10 w-12" />
          </motion.div>
        </div>
        <Toon look={MAP_TEXT} className="whitespace-nowrap text-[40px] font-black uppercase italic leading-none tracking-tight @lg:text-[60px]">
          Treasure Hunt
        </Toon>
        <div className="relative mt-3 flex items-baseline gap-2">
          <Toon look={GOLD_TEXT} className="text-[54px] font-black leading-none">
            {banner.spins}
          </Toon>
          <span className="text-[13px] font-extrabold uppercase tracking-[0.3em] text-white/80">free spins</span>
        </div>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">{banner.bought ? 'Anchors aweigh!' : `${banner.maps} treasure maps found!`}</div>
        <div className="relative mt-1 max-w-[300px] text-[12px] font-semibold text-white/60">The multiplier starts at ×1 and climbs after every cascade win. It never resets!</div>
      </>
    )
  } else if (banner.kind === 'retrigger') {
    body = (
      <>
        <motion.div className="relative mb-2" animate={{ y: [0, -6, 0], rotate: [-10, 8, -10] }} transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}>
          <MapIcon className="h-11 w-14 drop-shadow-[0_0_14px_rgba(255,211,106,.7)]" />
        </motion.div>
        <Toon look={MAP_TEXT} className="whitespace-nowrap text-[44px] font-black uppercase italic leading-none tracking-tight @lg:text-[60px]">
          +{banner.spins} spins
        </Toon>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">{banner.maps} more maps · the hunt goes on</div>
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
    // the win tier is the headline (or "Hunt over" / "Empty chest" below the first tier), the hunt's figures under it
    body = (
      <>
        <div className="relative mb-1 text-[12px] font-extrabold uppercase tracking-[0.3em] text-[#f6dfa4]/90 @lg:text-[13px]">{banner.amount > 0 ? 'Treasure haul' : 'Treasure Hunt'}</div>
        {finalTier >= 0 ? (
          tierTitle
        ) : (
          <div className="relative flex h-[40px] items-center justify-center @lg:h-[56px]">
            <Toon look={MAP_TEXT} stroke={7} className="whitespace-nowrap text-[30px] font-black uppercase italic leading-none tracking-tight @lg:text-[44px]">
              {banner.amount > 0 ? 'Hunt over' : 'Empty chest'}
            </Toon>
          </div>
        )}
        {money}
        <div className="relative mt-2 flex items-center gap-2 text-[14px] font-bold text-white/85">
          <span>{plural(banner.spins, 'free spin')}</span>
          <motion.span
            initial={{ scale: 0, rotate: -12 }}
            animate={{ scale: 1, rotate: -4 }}
            transition={{ type: 'spring', stiffness: 400, damping: 12, delay: 0.25 }}
            className="inline-flex items-center gap-1 rounded-full border-2 border-[#1f1029] bg-[linear-gradient(180deg,#ffe58a,#f5b41f)] py-0.5 pl-0.5 pr-2.5 text-[13px] font-black uppercase tracking-wider text-[#3a2400] shadow-[0_2px_0_#1f1029]"
          >
            <CoinMedal className="h-5 w-5" />×{banner.mult}
          </motion.span>
          {banner.amount > 0 && <span>{fmt(banner.amount / unit, 2)}× your bet</span>}
        </div>
      </>
    )
  } else {
    body = (
      <>
        <Toon look={GOLD_TEXT} className="whitespace-nowrap text-[40px] font-black uppercase italic leading-none tracking-tight @lg:text-[56px]">
          Max win
        </Toon>
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(banner.amount / unit, 0)}× your bet · the whole treasure</div>
      </>
    )
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-[#120a24]/70 p-6"
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

/** six reels of different heights, as a spin might land them, and the ways they make */
function WaysDiagram() {
  const hs = [3, 5, 2, 7, 4, 6]
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-[88px] shrink-0 gap-1 rounded-lg bg-[#0e1a33] p-1.5 ring-2 ring-[#8a5a2b]">
        {hs.map((h, r) => (
          <div key={r} className="flex w-[18px] flex-col gap-[2px]">
            {Array.from({ length: h }, (_, i) => (
              <div key={i} className="flex-1 rounded-[3px] bg-[#27426f] shadow-[inset_0_1px_0_rgba(255,255,255,.12)]" />
            ))}
          </div>
        ))}
      </div>
      <div className="min-w-0 text-[13px] text-muted">
        <div className="tnum whitespace-nowrap font-extrabold text-ink">{hs.join(' × ')}</div>
        <div className="tnum">= {fmt(waysOf(hs), 0)} ways</div>
        <div className="mt-1 text-[12px] text-dim">All seven high: {fmt(waysOf([7, 7, 7, 7, 7, 7]), 0)}</div>
      </div>
    </div>
  )
}

function PaytableModal({ bet, thumbs, onClose }: { bet: number; thumbs: Partial<Record<Sym | 'host', string>>; onClose: () => void }) {
  const pic = (s: Sym | 'host', size = 40) =>
    thumbs[s] ? (
      <img src={thumbs[s]} alt="" width={size} height={size} className="shrink-0" />
    ) : (
      <span className="shrink-0 rounded-full" style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, background: s === 'host' ? '#ff5a4e' : SYMBOL_COLOR[s] }} />
    )
  const money = (m: number) => {
    const a = round2(bet * m)
    return a >= 100000 ? fmtCompact(a) : fmt(a, a >= 1000 ? 0 : 2)
  }
  const cols = 'grid-cols-[44px_repeat(4,minmax(0,1fr))] sm:grid-cols-[176px_repeat(4,minmax(0,1fr))]'
  return (
    <Modal onClose={onClose} title="Paytable" width={640}>
      <p className="text-[13px] text-muted">
        Six reels, and every spin each one lands 2 to 7 symbols, so the ways to win change from spin to spin: multiply the six reel heights. The count shows on the plaque over the reels.
      </p>
      <div className="mt-3 rounded-lg bg-stage p-3">
        <WaysDiagram />
        <p className="mt-2.5 text-[13px] text-muted">
          Matching symbols on 3 or more neighbouring reels from the left win, and every combination of them counts: 2 Coco on reel 1, 1 on reel 2 and 3 on reel 3 is 6 ways. Amounts are per
          way, for your bet of {fmt(bet)}.
        </p>
      </div>
      <div className={`mt-3 grid ${cols} items-center gap-x-1 px-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-dim sm:text-[11px]`}>
        <span className="text-left">
          <span className="hidden sm:inline">Symbol</span>
        </span>
        {['3 reels', '4 reels', '5 reels', '6 reels'].map((b) => (
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

      <Card tone="#ffc63d" icon={pic('flag', 48)}>
        <span className="font-bold text-ink">The Jolly Roger</span> is wild. It lands on reels 2 to 6 and stands in for every crew member and low symbol, in every way at once.
      </Card>
      <Card tone="#2fc7c9" icon={<CascadeIcon thumb={thumbs.monkey} className="h-12 w-12 shrink-0" />}>
        <span className="font-bold text-ink">Cascades.</span> Every symbol in a win blasts away, wilds too. The rest fall down their reel and new ones drop in from the top, and it goes on until
        nothing wins. The reel heights stay put for the whole spin.
      </Card>
      <Card tone="#f4dca0" icon={pic('map', 48)}>
        <span className="font-bold text-ink">Treasure maps</span> land anywhere, never blast and count once the cascades are done. {SCATTER_MIN}, 5 or 6+ on a paid spin pay{' '}
        {either(CONFIG.scatterPays.map(money))} and start {either(CONFIG.spins)} free spins of <span className="font-bold text-ink">Treasure Hunt</span>. There, 3, 4 or 5+ maps add{' '}
        {either(CONFIG.retrigger)} more spins (up to {MAX_FREE_SPINS} in all), and the crew turns up far more often.
      </Card>
      <Card tone="#ffb020" icon={<CoinMedal className="h-12 w-12 shrink-0" />}>
        <span className="font-bold text-ink">The multiplier.</span> Treasure Hunt starts at ×1. Every cascade that wins is paid at the multiplier, then it climbs by one, and it never resets
        until the hunt is over, so every spin builds on the last.
      </Card>
      <Card tone="#ff5a4e" icon={pic('host', 48)}>
        <span className="font-bold text-ink">Buy Treasure Hunt</span> for {BUY_PRICE}× the bet ({money(BUY_PRICE)}): {CONFIG.spins[0]} free spins straight away, without a paid spin or a map pay.
      </Card>
      <p className="mt-3 text-[12px] text-dim">A round pays at most {fmt(MAX_WIN, 0)}× the bet. Simulated return to player: 96.05% for spins, 96.10% for the buy.</p>
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

/** a reel for the cascades card: a winner bursting at the bottom and a symbol from above dropping into its place */
function CascadeIcon({ thumb, className = '' }: { thumb?: string; className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect x="9" y="1.5" width="30" height="45" rx="6" fill="#16244a" stroke="#8a5a2b" strokeWidth="2.5" />
      {thumb ? <image href={thumb} x="11" y="2" width="26" height="24" /> : <circle cx="24" cy="13" r="7" fill="#c98a4b" stroke={INK} strokeWidth="2" />}
      <path d="M24 25.5v5.5m-3.2-2.8 3.2 3.2 3.2-3.2" fill="none" stroke="#9fe8ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24 32.5l2.1 3.6 4.1.6-3 2.8.8 4.1-4-2-4 2 .8-4.1-3-2.8 4.1-.6Z" fill="#ffd23f" stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      <g stroke="#2fc7c9" strokeWidth="2" strokeLinecap="round">
        <path d="M13 38h2.5M32.5 38H35M14.5 32.5l1.8 1.6M33.5 32.5l-1.8 1.6M14.5 44l1.8-1.6M33.5 44l-1.8-1.6" />
      </g>
    </svg>
  )
}
