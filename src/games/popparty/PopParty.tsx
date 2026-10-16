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
import { safeStorage } from '../../lib/storage'
import { useAuth } from '../../store/auth'
import { useWallet } from '../../store/wallet'
import {
  ANTE_COST,
  BAND_LABELS,
  BUY_PRICE,
  BUY_SPINS,
  CELLS,
  MAX_FREE_SPINS,
  MAX_LEVEL,
  MAX_WIN,
  PAYS,
  PAY_SYMS,
  RETRIGGER_SPINS,
  SCATTER_MIN,
  SCATTER_PAYS,
  SCATTER_SPINS,
  SUPER_PRICE,
  calmGrid,
  floorSum,
  playRound,
  teaseColumn,
  type Buy,
  type PaySym,
  type PlayOpts,
  type Round,
  type Spin,
  type Step,
  type Sym,
  type TileUp,
} from './rules'
import { BIG_POP_AT, LEVEL_COLOR, SYMBOL_COLOR, SYMBOL_NAME, SYMBOL_PLURAL, SYMBOL_SHORT, TIERS, levelColor, levelLabel, multColor, tierIndex } from './meta'
import type { PartyScene } from './scene'

/*
  Pop Party: balloon animals on a 7 × 7 light-up disco floor, with DJ Bop on the decks. The round is drawn in full
  when the spin is placed (rules.ts); this screen plays it back through the 3D scene, step by step, and settles
  when the show is over.
*/

type BannerData =
  | { kind: 'intro'; spins: number; super: boolean }
  | { kind: 'retrigger'; spins: number }
  | { kind: 'big'; amount: number; unit: number; count: number }
  | { kind: 'end'; amount: number; unit: number; count: number; spins: number }
  | { kind: 'max'; amount: number; unit: number }
/** `jump`: the player tapped during the count-up, so the banner shows its final amount and tier */
type Banner = BannerData & { id: number; jump?: boolean }
/** an amount over a cluster: its base pay, then ×(tiles gathered so far), then the pay once it settles */
type Pop = { id: number; x: number; y: number; base: number; mult: number; pay: number | null; color: string; big?: boolean }
type Floor = { sum: number; hot: number }
type Hud = { win: number; discos: number; free: { left: number; played: number } | null; floor: Floor | null; combo: number }

const EMPTY_HUD: Hud = { win: 0, discos: 0, free: null, floor: null, combo: 0 }
const ZEROS: readonly number[] = Array.from({ length: CELLS }, () => 0)
const ANIMALS: readonly Sym[] = ['poodle', 'giraffe', 'bunny', 'octo']
/** fireworks rockets as a win banner reaches each tier */
const ROCKETS = [3, 6, 10, 16]

/** one balloon of a kind, by name: "Fifi", "Party balloon" */
const one = (sym: PaySym) => (sym === 'round' ? SYMBOL_NAME.round : SYMBOL_SHORT[sym])
const floorOf = (tiles: readonly number[]): Floor => ({ sum: floorSum(tiles), hot: Math.max(...tiles) })
/** "a, b or c" */
const either = (xs: readonly (string | number)[]) => `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`

/** the caption for a cascade step: its best cluster and the tiles under it */
function stepCaption(step: Step, coins: (m: number) => number) {
  const c = step.clusters.reduce((a, b) => (b.pay > a.pay ? b : a))
  const tiles = c.mults.filter((m) => m > 0)
  const who = `${c.size} ${SYMBOL_PLURAL[c.sym]}`
  const text = !tiles.length
    ? `${who} pop · ${fmt(coins(c.pay))}`
    : tiles.length === 1
      ? `${who} on a ×${tiles[0]} tile`
      : tiles.length <= 4
        ? `${who} on ${tiles.map((m) => `×${m}`).join(' + ')} = ×${c.sum}`
        : `${who} on ${tiles.length} tiles = ×${c.sum}`
  return step.clusters.length > 1 ? `${text} · +${step.clusters.length - 1} more` : text
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

// dev only: window.__popForce = 'feature' | 'pump' | 'pin' | 'big' | 'tease' | 'retrigger' | 'super128' | 'max'
// replays the round until it shows that, for testing (the paid-spin ones leave buys alone)
const FORCE: Record<string, (r: Round) => boolean> = {
  feature: (r) => r.feature,
  pump: (r) => !!r.base?.pump && !r.feature,
  pin: (r) => r.free.some((s) => s.steps[0].pin != null),
  big: (r) => r.total >= 20 && !r.feature,
  tease: (r) => r.base != null && teaseColumn(r.base.drop) >= 0,
  retrigger: (r) => r.free.some((s) => s.award > 0),
  super128: (r) => r.maxTile >= 128,
  max: (r) => r.capped,
}
const PAID_ONLY = ['feature', 'pump', 'big', 'tease']

function forced(round: Round, opts: PlayOpts) {
  const name = (window as unknown as { __popForce?: string }).__popForce ?? ''
  const test = FORCE[name]
  if (!test || (opts.buy !== 'none' && PAID_ONLY.includes(name))) return round
  for (let i = 0; i < 200000 && !test(round); i++) round = playRound(rand, opts)
  return round
}

/** a round already paid for but not yet settled; kept in storage under `key` until it is */
type Pending = { bet: number; payout: number; meta: Record<string, number | string | boolean>; key: string }
const pendingKey = (uid: string | null) => `lumen.popparty.pending.${uid ?? 'guest'}`

/** a step reached the max win: the rules stop there, so the show ends on that step's pops, with holes in the floor */
const cutShort = (spin: Spin) => spin.capped && spin.steps[spin.steps.length - 1].clusters.length > 0

export default function PopParty() {
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
  const [splat, setSplat] = useState<number | null>(null)
  const [lastWin, setLastWin] = useState(0)
  const [paytable, setPaytable] = useState(false)
  const [buying, setBuying] = useState<Buy | null>(null)
  const [thumbs, setThumbs] = useState<Partial<Record<Sym | 'host', string>>>({})
  const [hudTop, setHudTop] = useState(-100)

  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<PartyScene | null>(null)
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
  /** dead paid spins in a row; DJ Bop yawns at every eighth */
  const deadRun = useRef(0)
  /** tiles that already had their ×128 fanfare */
  const x128Seen = useRef(new Set<number>())
  const bigPopDone = useRef(false)
  /** disco balls that have come to rest in the current spin */
  const discoN = useRef(0)
  const captionTimer = useRef(0)

  /** pays the round in play, once: when its show ends, or as soon as the player leaves (the outcome is already drawn) */
  const settlePending = () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    safeStorage.removeItem(p.key)
    useWallet.getState().settle({ game: 'popparty', bet: p.bet, payout: p.payout, meta: p.meta })
  }

  /* ---------------- scene ---------------- */

  useEffect(() => {
    alive.current = true
    let live = true
    const host = hostRef.current!
    let sc: PartyScene | null = null
    let ro: ResizeObserver | null = null
    import('./scene')
      .then(({ PartyScene }) => {
        if (!live) return
        setProgress(0.12)
        sc = new PartyScene(host)
        sceneRef.current = sc
        if (import.meta.env.DEV) (window as unknown as { __popScene?: PartyScene }).__popScene = sc
        sc.setTurbo(turboRef.current)
        sc.onProgress = (p) => alive.current && setProgress(0.12 + p * 0.88)
        sc.onCoin = () => sfx.coin()
        sc.onRefill = () => sfx.party.inflate()
        sc.onLand = (col, syms) => {
          sfx.party.boop(col)
          if (syms.some((s) => ANIMALS.includes(s))) sfx.party.squeak()
        }
        sc.onDiscoLand = () => {
          const n = ++discoN.current
          setHud((h) => ({ ...h, discos: n }))
          sfx.party.disco(n - 1)
          if (n === SCATTER_MIN) {
            sfx.party.airhorn()
            sc!.flareDiscos()
          }
        }
        const fit = () => {
          const r = host.getBoundingClientRect()
          sc!.resize(r.width, r.height)
          // the counters and caption sit in the space under the arch; DJ Bop has the space above it
          const f = sc!.frameRect()
          setHudTop(Math.round(Math.min(r.height - 70, f.bottom + (r.height - f.bottom) / 2 - 30)))
        }
        ro = new ResizeObserver(fit)
        ro.observe(host)
        fit()
        return sc.ready.then(() => {
          if (!live || !sc) return
          setThumbs(sc.thumbs)
          sc.show(calmGrid(rand), ZEROS)
          setReady(true)
        })
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
      alive.current = false
      ro?.disconnect()
      clearTimeout(captionTimer.current)
      bannerDone.current?.close()
      sc?.dispose()
      sceneRef.current = null
      settlePending()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => sceneRef.current?.setTurbo(turbo), [turbo])

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
    useWallet.getState().settle({ game: 'popparty', bet: p.bet, payout: p.payout, meta: { ...p.meta, recovered: true } })
    if (p.payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'Your unfinished Pop Party round paid out', amount: p.payout })
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
        sc?.confettiBurst(80)
      } else if (b.kind === 'retrigger') sc?.confettiBurst(60)
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
    if (tierIndex(amount / unit) < 0) sfx.bigWin()
    return showBanner(kind === 'big' ? { kind, amount, unit, count } : { kind, amount, unit, count, spins }, ms, count)
  }

  /** a win banner's count passed a tier: horns, fireworks and confetti cannons, and DJ Bop jumps */
  const tierUp = (k: number) => {
    sfx.party.tierUp(k)
    sfx.party.partyHorn()
    sfx.party.confettiCannon()
    sceneRef.current?.fireworks(ROCKETS[k])
    sceneRef.current?.confettiCannons()
  }

  /**
   * The max win: a gold flash, confetti from every side and the banner. When it cut the last spin short mid-cascade,
   * a calm floor rises in under the banner to fill the holes; that is only for show, the round is already drawn.
   */
  const maxWin = (round: Round, amount: number, unit: number) => {
    const sc = sceneRef.current
    sc?.flash('#ffd23f')
    sc?.confettiCannons()
    sc?.confettiBurst(160)
    sfx.party.confettiCannon()
    const banner = showBanner({ kind: 'max', amount, unit }, hold(3400))
    const last = round.free.length ? round.free[round.free.length - 1] : round.base
    if (!sc || !last || !cutShort(last)) return banner
    discoN.current = 0
    setHud((h) => ({ ...h, discos: 0 }))
    return Promise.all([banner, sc.drop(calmGrid(rand), -1)])
  }

  const popAt = (ids: number[], base: number, color: string): Pop => {
    const at = sceneRef.current?.screenOf(ids) ?? { x: 0, y: 0 }
    return { id: seq.current++, x: at.x, y: at.y, base, mult: 0, pay: null, color }
  }

  /** plays one spin of a round; `before` is the total already on the counter. Returns the new total, or null once the screen is gone. */
  const playSpin = async (sc: PartyScene, spin: Spin, free: boolean, before: number, unit: number): Promise<number | null> => {
    const coins = (m: number) => round2(m * unit)
    let run = before
    const add = (m: number) => {
      run = Math.min(MAX_WIN * unit, round2(run + coins(m)))
      setHud((h) => ({ ...h, win: run }))
    }
    const tiles = spin.tilesStart.slice()

    /** tiles go up under a step's pops; a tile reaching ×128 gets its fanfare once */
    const lift = async (ups: TileUp[]) => {
      await sc.tileUps(ups, (u) => {
        if (u.to === 1) sfx.party.tileLit()
        else sfx.party.tileUp(u.to)
        tiles[u.pos] = u.to
        if (free) setHud((h) => ({ ...h, floor: floorOf(tiles) }))
      })
      for (const u of ups) {
        if (!alive.current) return false
        if (u.to < MAX_LEVEL || x128Seen.current.has(u.pos)) continue
        x128Seen.current.add(u.pos)
        sfx.party.airhorn()
        say('×128! That tile is maxed')
        await sc.tileFanfare(u.pos)
      }
      return alive.current
    }

    // the new floor rises in; with two disco balls already showing, the rest of the columns hold back
    const tease = teaseColumn(spin.drop)
    discoN.current = 0
    setHud((h) => ({ ...h, discos: 0 }))
    if (tease >= 0) void sc.wait((free ? 0.3 : 0.15) + 0.06 * tease).then(() => alive.current && !sc.hurried && sfx.party.tease())
    await sc.drop(spin.drop, tease)
    if (!alive.current) return null

    if (spin.pump) {
      const { sym, group, changes } = spin.pump
      await sc.wait(0.25)
      if (!alive.current) return null
      say(`Pump It! DJ Bop pumps up ${changes.length} more ${changes.length === 1 ? one(sym) : SYMBOL_PLURAL[sym]}`)
      for (let i = 0; i < 3; i++) void sc.wait(i * 0.18).then(() => alive.current && sfx.party.pumpBreath(i))
      await sc.pump(group, changes.map((c) => ({ pos: c.pos, fromId: c.from.id, to: c.to })), () => sfx.party.squeak())
      if (!alive.current) return null
    }

    for (let i = 0; i < spin.steps.length; i++) {
      const step = spin.steps[i]
      const next = spin.steps[i + 1]
      if (step.clusters.length) {
        // from the sixth step on, each step plays 1.3× faster, up to 2×
        sc.setChain(i >= 5 ? Math.min(2, 1.3 ** (i - 4)) : 1)
        sc.setCombo(i + 1)
        if (i >= 1) {
          setHud((h) => ({ ...h, combo: i + 1 }))
          sc.host('scratch')
          sfx.party.scratch()
        }
        if (i >= 3) sc.host('shades')
        sfx.party.stretch()
        await sc.highlight(step.clusters)
        if (!alive.current) return null
        if (step.win >= 2) {
          sc.host('cheer')
          sfx.party.cheer()
        }

        // an amount over each cluster; on multiplied ones the tiles' orbs fly in and the label counts the ×
        const labels = step.clusters.map((c) => popAt(c.ids, coins(c.base), SYMBOL_COLOR[c.sym]))
        setPops(labels)
        await Promise.all(
          step.clusters.map((c, k) => {
            if (!c.sum) return null
            let sum = 0
            return sc.gather(c, labels[k], (j, m) => {
              const s = (sum += m)
              setPops((ps) => ps.map((p) => (p.id === labels[k].id ? { ...p, mult: s } : p)))
              sfx.party.orb(j)
            })
          }),
        )
        if (!alive.current) return null
        const huge = step.clusters.filter((c) => c.mult >= 50)
        if (huge.length) {
          sfx.party.superPop()
          await sc.superPop(huge.reduce((a, b) => (b.pay > a.pay ? b : a)).ids)
          if (!alive.current) return null
        }
        setPops(labels.map((p, k) => ({ ...p, mult: step.clusters[k].sum, pay: coins(step.clusters[k].pay), big: step.clusters[k].pay >= 5 })))
        add(step.win)
        const multiplied = step.clusters.some((c) => c.mult > 1)
        if (multiplied) sfx.party.slam()
        if (step.win >= 5) sfx.bigWin()
        else if (!multiplied) sfx.win()
        say(stepCaption(step, coins))

        await sc.pop(
          step.clusters.map((c) => c.ids),
          (j) => sfx.party.pop(i + j),
        )
        if (!alive.current) return null
        setPops([])
        if (!(await lift(step.ups))) return null
        sc.clearHighlight()
        // only a step that reached the max win has nothing after it
        if (!next) break
        await sc.float(next.grid)
        if (!alive.current) return null
      } else if (step.pin) {
        const { sym, ids } = step.pin
        say(`Pin Drop! Every ${one(sym)} pops`)
        // DJ Bop pulls the pins for 0.25 s, then throws
        void sc.wait(0.25).then(() => alive.current && sfx.party.pinThrow())
        await sc.pin(sym, ids, (j) => sfx.party.pinHit(j))
        if (!alive.current) return null
        if (!(await lift(step.ups))) return null
        if (step.ups.length) say(`${step.ups.length} tiles light up`)
        if (!next) break
        await sc.float(next.grid)
        if (!alive.current) return null
      } else break
    }
    sc.setChain(1)
    sc.setCombo(0)
    setHud((h) => ({ ...h, combo: 0 }))
    // that step ends the show: no scatter pay and no Big Pop, the max banner follows
    if (cutShort(spin)) return run

    if (!free && spin.discos >= SCATTER_MIN) {
      setPops([{ ...popAt(spin.discoIds, coins(spin.scatterPay), '#ff4fd8'), pay: coins(spin.scatterPay), big: spin.scatterPay >= 5 }])
      add(spin.scatterPay)
      sfx.party.beatDrop()
      await sc.discos(spin.discoIds, 'trigger')
      if (!alive.current) return null
      say(spin.award ? `${spin.discos} disco balls · Disco Night!` : `${spin.discos} disco balls`)
      setPops([])
    }

    // the Big Pop, once a round, at the end of the spin that takes the total past 50×
    if (!bigPopDone.current && run >= BIG_POP_AT * unit) {
      bigPopDone.current = true
      await sc.bigPop(() => {
        setSplat(seq.current++)
        sfx.party.glassPop()
      })
      if (!alive.current) return null
    }
    return run
  }

  /** Disco Night: the scene change, every free spin with its retriggers, the end banner and lights back on */
  const playFeature = async (sc: PartyScene, round: Round, buy: Buy, before: number, unit: number, payout: number) => {
    let shown = before
    await showBanner({ kind: 'intro', spins: round.startSpins, super: buy === 'super' }, hold(2800))
    if (!alive.current) return false
    await sc.setFree(true)
    if (!alive.current) return false
    sfx.party.beatDrop()
    sc.onBeat = (_n, half) => (half ? sfx.party.hat() : sfx.party.kick())
    x128Seen.current.clear()
    let left = round.startSpins
    let played = 0
    const start = round.free[0].tilesStart
    setHud((h) => ({ ...h, win: shown, discos: 0, free: { left, played }, floor: { sum: 0, hot: 0 } }))
    if (buy === 'super') {
      // every tile stamps in at ×2 from the middle out, and the floor counter climbs with them
      const full = floorOf(start)
      await sc.setTiles(start, 'spiral', (i) => {
        sfx.party.inflate()
        setHud((h) => ({ ...h, floor: { sum: Math.round((full.sum * (i + 1)) / CELLS), hot: full.hot } }))
      })
      if (!alive.current) return false
    }

    for (const fs of round.free) {
      left--
      played++
      setHud((h) => ({ ...h, free: { left, played } }))
      if (left === 0 && !turboRef.current) {
        say('Last spin!')
        sfx.party.heartbeat()
        sc.host('cross')
        await sc.wait(0.4)
      }
      const r = await playSpin(sc, fs, true, shown, unit)
      if (r == null) return false
      shown = r
      if (fs.award > 0) {
        left += fs.award
        setHud((h) => ({ ...h, free: { left, played } }))
        await sc.discos(fs.discoIds, 'retrigger')
        sfx.levelUp()
        await showBanner({ kind: 'retrigger', spins: fs.award }, hold(1800))
        if (!alive.current) return false
      }
      if (fs.capped) break
      await sc.wait(0.25)
      if (!alive.current) return false
    }

    sc.onBeat = undefined
    if (round.capped) await maxWin(round, payout, unit)
    else await showWin('end', payout, unit, played)
    if (!alive.current) return false
    await sc.setTiles(ZEROS, 'waveOff', (r) => sfx.party.lightsOff(r))
    await sc.setFree(false)
    if (!alive.current) return false
    setHud((h) => ({ ...h, free: null, floor: null, win: payout }))
    return true
  }

  const play = async (buy: Buy): Promise<number | null> => {
    const sc = sceneRef.current
    if (busyRef.current || !sc || !ready) return null
    const unit = bet
    const opts: PlayOpts = { buy, ante: buy === 'none' && ante }
    const price = buy === 'fs' ? BUY_PRICE : buy === 'super' ? SUPER_PRICE : opts.ante ? ANTE_COST : 1
    const cost = round2(unit * price)
    if (!stake(cost)) return null
    busyRef.current = true
    setBusy(true)
    setPops([])
    say(null)
    setHud(EMPTY_HUD)
    x128Seen.current.clear()
    bigPopDone.current = false
    sfx.spinStart()
    sc.host('slap')
    sfx.party.scratch()

    let round = playRound(rand, opts)
    if (import.meta.env.DEV) round = forced(round, opts)
    const payout = round2(unit * round.total)
    const meta = { feature: round.feature, buy, ante: round.ante, mult: payout / cost, maxTile: round.maxTile, floor: round.floor, spins: round.free.length }
    // stored before the show starts, so even a page that never gets to settle can't lose the round
    const key = pendingKey(uid)
    pending.current = { bet: cost, payout, meta, key }
    safeStorage.setItem(key, JSON.stringify({ bet: cost, payout, meta }))

    let shown = 0
    if (round.base) {
      const r = await playSpin(sc, round.base, false, 0, unit)
      if (r == null) return null
      shown = r
      if (round.base.win === 0) {
        if (++deadRun.current % 8 === 0) {
          sc.host('yawn')
          sfx.party.yawn()
        }
      } else deadRun.current = 0
    }

    if (round.free.length) {
      if (!(await playFeature(sc, round, buy, shown, unit, payout))) return null
    } else if (round.capped) {
      await maxWin(round, payout, unit)
      if (!alive.current) return null
    }

    // a no-op if the page already paid it on its way out (and came back from the back/forward cache)
    settlePending()
    setLastWin(payout)
    setHud((h) => ({ ...h, win: payout }))
    if (!round.free.length && !round.capped && payout >= unit * 15) await showWin('big', payout, unit)
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
  const fsCost = round2(bet * BUY_PRICE)
  const superCost = round2(bet * SUPER_PRICE)
  const free = hud.free

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
      <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors ${ante ? 'bg-[#ff4fb8]/12 ring-1 ring-[#ff4fb8]/40' : 'bg-stage'}`}>
        <div className="min-w-0">
          <div className={`text-[13px] font-semibold ${ante ? 'text-[#ff9fd6]' : 'text-muted'}`}>Party Mode</div>
          <div className="text-[11px] font-semibold text-dim">
            Spin costs {ANTE_COST}× · Disco Night 1.6× as often
          </div>
        </div>
        <Toggle on={ante} onChange={setAnte} disabled={locked} label="Party Mode" />
      </div>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div>
        <div className="grid grid-cols-2 gap-2" title={ante ? 'Turn off Party Mode to buy' : undefined}>
          <BuyButton label="Disco Night" cost={fsCost} tone="pink" disabled={locked || !ready || ante || balance < fsCost} onClick={() => (sfx.click(), setBuying('fs'))} />
          <BuyButton label="Super Night" cost={superCost} tone="gold" disabled={locked || !ready || ante || balance < superCost} onClick={() => (sfx.click(), setBuying('super'))} />
        </div>
        {ante && <div className="mt-1.5 text-center text-[11px] font-semibold text-dim">Turn off Party Mode to buy</div>}
      </div>
      <button onClick={() => (sfx.click(), setPaytable(true))} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Paytable
      </button>
      <div className="max-lg:order-first lg:mt-auto">
        {auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop} sub={free ? `Disco Night ${free.played} · ${free.left} left` : undefined}>
            Stop autospin
          </ActionButton>
        ) : free ? (
          <ActionButton tone="gold" onClick={hurry} sub="Tap to speed up">
            Disco Night {free.played} · {free.left} left
          </ActionButton>
        ) : busy ? (
          <ActionButton tone="neutral" onClick={hurry} sub="Tap to speed up">
            Spinning…
          </ActionButton>
        ) : mode === 'manual' ? (
          <ActionButton onClick={() => void play('none')} disabled={!ready || balance < spinCost} sub={ante ? `Party Mode · ${fmt(spinCost)}` : undefined}>
            Spin
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={!ready || balance < spinCost} sub={ante ? `Party Mode · ${fmt(spinCost)}` : undefined}>
            Start autospin
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const stage = (
    <div className="absolute inset-0 overflow-hidden bg-[#2a1450]" onPointerDown={() => busyRef.current && hurry()}>
      <div ref={hostRef} className="absolute inset-0" />

      {/* counters and caption under the arch */}
      <div className="pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1.5 px-2" style={{ top: hudTop }}>
        <div className="flex items-center justify-center gap-1.5 sm:gap-2">
          <motion.div layout className={`${pillBase} gap-1 px-3 sm:px-4`} aria-label={`${hud.discos} disco ${hud.discos === 1 ? 'ball' : 'balls'}`}>
            {[0, 1, 2].map((i) => (
              <motion.span
                key={`${i}-${i < hud.discos}`}
                initial={i < hud.discos ? { scale: 1.8 } : false}
                animate={hud.discos === 2 ? { scale: [1, 1.2, 1] } : { scale: 1 }}
                transition={hud.discos === 2 ? { duration: 0.5, repeat: Infinity } : { type: 'spring', stiffness: 500, damping: 15 }}
                className={hud.discos >= SCATTER_MIN ? 'drop-shadow-[0_0_6px_#ff4fd8]' : ''}
              >
                <DiscoBall on={i < hud.discos} className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
              </motion.span>
            ))}
            {hud.discos > 3 && (
              <motion.span key={hud.discos} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="tnum ml-0.5 text-[13px] font-black text-[#ffc2ea]">
                ×{hud.discos}
              </motion.span>
            )}
          </motion.div>
          <AnimatePresence mode="popLayout">
            {free && (
              <motion.div key="spins" layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill}>
                <span className={`${pillLabel} text-[#ffd9f0]/80`}>Spins</span>
                <motion.span key={free.left} initial={{ scale: 1.3 }} animate={{ scale: 1 }} className="tnum text-[15px] font-black text-white sm:text-[18px]">
                  {free.left}
                </motion.span>
              </motion.div>
            )}
            {(free || hud.win > 0) && (
              <motion.div key="win" layout initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className={`${pill} relative`}>
                <span className={`${pillLabel} text-gold/80`}>{free ? 'Total' : 'Win'}</span>
                <Counter value={hud.win} className="text-[15px] font-black text-gold sm:text-[18px]" />
                <AnimatePresence>
                  {hud.combo > 1 && (
                    <motion.span
                      key="combo"
                      initial={{ scale: 0, rotate: -14 }}
                      animate={{ scale: 1, rotate: 6 }}
                      exit={{ scale: 0, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 520, damping: 16 }}
                      className="absolute -right-3 -top-3 rounded-full bg-[#ff4fb8] px-2 py-0.5 text-[11px] font-black uppercase leading-tight text-white shadow-[0_4px_12px_-2px_rgba(255,79,184,.7)] ring-2 ring-[#1d0f30]"
                    >
                      <motion.span key={hud.combo} initial={{ scale: 1.5 }} animate={{ scale: 1 }} className="tnum inline-block">
                        Combo ×{hud.combo}
                      </motion.span>
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>
            )}
            {hud.floor && (
              <motion.div key="floor" layout initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className={pill} aria-label={`Floor multiplier ${hud.floor.sum}`}>
                <span className={`${pillLabel} text-white/60`}>Floor</span>
                <motion.span
                  key={hud.floor.sum}
                  initial={{ scale: 1.25 }}
                  animate={{ scale: 1 }}
                  className="tnum text-[15px] font-black sm:text-[18px]"
                  style={{ color: hud.floor.hot >= 2 ? levelColor(hud.floor.hot) : 'rgba(255,255,255,.6)' }}
                >
                  ×{fmt(hud.floor.sum, 0)}
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
              key={p.pay != null ? 'pay' : p.mult}
              initial={{ scale: p.pay != null ? 1.45 : 1.25 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 14 }}
              className={`inline-block ${p.big ? 'text-[28px] sm:text-[36px]' : 'text-[22px] sm:text-[28px]'}`}
              style={{ color: p.big ? '#fff3b0' : '#fff', textShadow: `0 0 18px ${p.big ? '#ffc93d' : p.color}, 0 3px 0 #1d0f30, 0 0 3px #1d0f30, 0 0 3px #1d0f30` }}
            >
              {p.pay != null ? (
                fmt(p.pay)
              ) : (
                <>
                  {fmt(p.base)}
                  {p.mult > 0 && <span style={{ color: multColor(p.mult) }}> ×{p.mult}</span>}
                </>
              )}
            </motion.span>
          </motion.div>
        ))}
      </AnimatePresence>

      {splat != null && <Splat key={splat} onDone={() => setSplat(null)} />}

      <AnimatePresence>{banner && <BannerCard key={banner.id} banner={banner} onTap={() => bannerDone.current?.tap()} onTier={tierUp} />}</AnimatePresence>

      <AnimatePresence>
        {!ready && (
          <motion.div
            key="loading"
            className="absolute inset-0 z-40 flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_42%,#3b1c60_0%,#2a1450_72%)]"
            exit={{ opacity: 0, transition: { duration: 0.45 } }}
          >
            {failed ? (
              <div className="max-w-[260px] text-center text-[14px] font-semibold text-white/85">This device couldn't start the 3D graphics. Try another browser, or turn on hardware acceleration.</div>
            ) : (
              <BojeLoader label="Inflating the balloons" progress={progress} />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[calc(100vw+170px)] max-sm:min-h-[480px]" />
      <AnimatePresence>{paytable && <PaytableModal bet={bet} thumbs={thumbs} onClose={() => setPaytable(false)} />}</AnimatePresence>
      <AnimatePresence>
        {buying && (
          <Modal onClose={() => setBuying(null)} title={buying === 'super' ? 'Buy Super Disco Night' : 'Buy Disco Night'} width={400}>
            <p className="text-[14px] text-muted">
              {buying === 'super' ? (
                <>
                  {BUY_SPINS} free spins with every tile already at ×2 for <span className="font-bold text-ink">{fmt(superCost)}</span> coins, {SUPER_PRICE}× your bet.
                </>
              ) : (
                <>
                  Go straight to {BUY_SPINS} free spins on a fresh disco floor for <span className="font-bold text-ink">{fmt(fsCost)}</span> coins, {BUY_PRICE}× your bet.
                </>
              )}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <ActionButton tone="neutral" onClick={() => setBuying(null)}>
                Cancel
              </ActionButton>
              <ActionButton
                tone="gold"
                disabled={balance < (buying === 'super' ? superCost : fsCost)}
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

const pillBase = 'flex h-9 items-center rounded-full bg-[#1d0f30]/90 ring-1 ring-white/10 sm:h-10'
/** a counter pill: label over value on phones, so four of them fit across; side by side from sm up */
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

function BuyButton({ label, cost, tone, disabled, onClick }: { label: string; cost: number; tone: 'pink' | 'gold'; disabled: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 font-extrabold shadow-[inset_0_-3px_0_rgba(0,0,0,.18),inset_0_1px_0_rgba(255,255,255,.5)] transition hover:brightness-105 disabled:pointer-events-none disabled:opacity-40 ${
        tone === 'pink' ? 'bg-[linear-gradient(180deg,#ff8fd0,#ff4fb8)] text-[#3d0328]' : 'bg-[linear-gradient(180deg,#ffe58a,#f5b41f)] text-[#3a2400]'
      }`}
    >
      <span className="text-[14px] leading-none">{label}</span>
      <span className="tnum rounded bg-black/15 px-1.5 py-0.5 text-[12px] leading-none">{fmt(cost, cost >= 1000 ? 0 : 2)}</span>
    </button>
  )
}

/** a disco ball: the HUD pips (dim until one lands) and the banners */
function DiscoBall({ on = true, className = '' }: { on?: boolean; className?: string }) {
  const line = on ? '#8d96b8' : 'rgba(255,255,255,.14)'
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M11.5 3.5 16 7l4.5-3.5v6L16 7l-4.5 2.5Z" fill={on ? '#ff4fb8' : 'rgba(255,255,255,.18)'} stroke="#1d0f30" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="16" cy="19" r="11" fill={on ? '#e6ebff' : 'rgba(255,255,255,.07)'} stroke={on ? '#1d0f30' : 'rgba(255,255,255,.22)'} strokeWidth="2.4" />
      <g fill="none" stroke={line} strokeWidth="1.3">
        <path d="M5.6 15.5h20.8M5 19h22M5.6 22.5h20.8M16 8.2v21.6" />
        <ellipse cx="16" cy="19" rx="5.5" ry="10.8" />
      </g>
      {on && <path d="M9.5 12.2h3.2v3.2H9.5zM13.2 9.8h2.4v2.4h-2.4z" fill="#fff" />}
    </svg>
  )
}

function Balloon({ color, className = '' }: { color: string; className?: string }) {
  return (
    <svg viewBox="0 0 32 46" className={className} aria-hidden>
      <path d="M16 31.5c-2.5 2.5 2.5 4.5 0 7s2.5 4 0 6.5" fill="none" stroke="#f4eefc" strokeWidth="1.6" strokeLinecap="round" />
      <ellipse cx="16" cy="15" rx="12.5" ry="14" fill={color} stroke="#1d0f30" strokeWidth="2.5" />
      <path d="M13.5 31.5h5L16 28.5Z" fill={color} stroke="#1d0f30" strokeWidth="2" strokeLinejoin="round" />
      <ellipse cx="11" cy="9.5" rx="2.8" ry="4.6" fill="#fff" opacity=".6" transform="rotate(25 11 9.5)" />
    </svg>
  )
}

/** a 16-point comic starburst for the Big Pop splat */
const STARBURST = Array.from({ length: 32 }, (_, i) => {
  const a = (i / 32) * Math.PI * 2 - Math.PI / 2
  const r = i % 2 ? 88 : [140, 122, 134, 116][(i / 2) % 4]
  return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`
}).join(' ')
/** latex shreds flung around the splat: where they start, where they land and their colour */
const SHREDS = [
  { x: -96, y: -70, dx: -40, dy: -30, r: -20, c: '#ff4fb8' },
  { x: 104, y: -58, dx: 46, dy: -24, r: 35, c: '#ffcc29' },
  { x: 124, y: 46, dx: 50, dy: 30, r: 70, c: '#3fc4ff' },
  { x: -118, y: 52, dx: -48, dy: 34, r: -60, c: '#9a6bff' },
  { x: -30, y: 116, dx: -14, dy: 50, r: 15, c: '#29d8c4' },
  { x: 52, y: -118, dx: 18, dy: -48, r: -45, c: '#ff8a2a' },
]

/** The DOM "POP!" that bursts over the stage when the Big Pop balloon pops; taps go straight through it. */
function Splat({ onDone }: { onDone: () => void }) {
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-[44%] z-20 w-[min(84%,380px)] -translate-x-1/2 -translate-y-1/2"
      initial={{ scale: 0.5, opacity: 1, y: 0 }}
      animate={{ scale: 1, opacity: 0, y: 60 }}
      transition={{ scale: { type: 'spring', stiffness: 380, damping: 13 }, y: { duration: 1.6, ease: 'easeIn' }, opacity: { duration: 1.6, ease: [0.7, 0, 0.9, 0.6] } }}
      onAnimationComplete={onDone}
    >
      <svg viewBox="-170 -170 340 340" className="h-auto w-full overflow-visible" aria-hidden>
        {SHREDS.map((s, i) => (
          <motion.path
            key={i}
            d="M0-15c10-1 17 6 13 14s-15 10-21 4-4-17 8-18Z"
            fill={s.c}
            stroke="#1d0f30"
            strokeWidth="4"
            strokeLinejoin="round"
            initial={{ x: s.x * 0.5, y: s.y * 0.5, rotate: 0, scale: 0.6 }}
            animate={{ x: s.x + s.dx, y: s.y + s.dy, rotate: s.r * 3, scale: 1.2 }}
            transition={{ duration: 1.1, ease: [0.15, 0.8, 0.3, 1] }}
          />
        ))}
        <polygon points={STARBURST} fill="#ffe23d" stroke="#1d0f30" strokeWidth="6" strokeLinejoin="round" />
        <g transform="rotate(-8)" fontSize="84" fontWeight="900" textAnchor="middle" style={{ letterSpacing: '-2px' }}>
          <text y="28" fill="#1d0f30" stroke="#1d0f30" strokeWidth="20" strokeLinejoin="round">
            POP!
          </text>
          <text y="28" fill="#ff3b55" stroke="#fff" strokeWidth="7" strokeLinejoin="round" paintOrder="stroke">
            POP!
          </text>
        </g>
      </svg>
    </motion.div>
  )
}

/** light rays behind a banner, one colour per ray in turn */
const rays = (...colors: string[]) =>
  `repeating-conic-gradient(from 0deg, ${colors.map((c, i) => `${c} ${i * 22.5}deg ${i * 22.5 + 7}deg, transparent ${i * 22.5 + 7}deg ${(i + 1) * 22.5}deg`).join(', ')})`
const DISCO_RAYS = rays('rgba(255,79,184,.38)', 'rgba(47,211,255,.32)')
/** each win tier's title gradient and rays: gold, pink, cyan, then a rainbow for a Party legend */
const TIER_LOOK = [
  { text: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]', rays: rays('rgba(255,200,61,.34)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#ffc2ea_45%,#ff4fb8_100%)]', rays: rays('rgba(255,79,184,.36)', 'rgba(255,200,61,.3)') },
  { text: 'bg-[linear-gradient(180deg,#ffffff_0%,#b9f3ff_45%,#2fd3ff_100%)]', rays: rays('rgba(47,211,255,.34)', 'rgba(154,107,255,.34)') },
  {
    text: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
    rays: rays('rgba(255,79,216,.36)', 'rgba(255,226,61,.34)', 'rgba(47,211,255,.34)', 'rgba(109,255,90,.3)'),
  },
]
const PINK_TEXT = 'bg-[linear-gradient(180deg,#ffffff_0%,#ffc2ea_45%,#ff4fb8_100%)]'
const GOLD_TEXT = TIER_LOOK[0].text

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
  const look = banner.kind === 'intro' || banner.kind === 'retrigger' ? DISCO_RAYS : TIER_LOOK[Math.max(0, tier)].rays
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
            className={`whitespace-nowrap bg-clip-text text-[34px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[50px] ${TIER_LOOK[tier].text}`}
          >
            {TIERS[tier].name}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  let body: ReactNode
  if (banner.kind === 'intro') {
    body = (
      <>
        <div className="relative mb-1 flex items-end gap-1.5">
          <motion.div animate={{ y: [0, -6, 0], rotate: [-10, 6, -10] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}>
            <Balloon color="#3fc4ff" className="h-11 w-8" />
          </motion.div>
          <motion.div animate={{ y: [0, -8, 0] }} transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}>
            <DiscoBall className="h-14 w-14 drop-shadow-[0_0_14px_rgba(255,79,216,.7)]" />
          </motion.div>
          <motion.div animate={{ y: [0, -6, 0], rotate: [10, -6, 10] }} transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}>
            <Balloon color="#ff4fb8" className="h-11 w-8" />
          </motion.div>
        </div>
        <div className={`relative bg-clip-text text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] ${PINK_TEXT}`}>
          <div className="text-[64px] font-black leading-none sm:text-[84px]">{banner.spins}</div>
        </div>
        <div className="relative text-[12px] font-extrabold uppercase tracking-[0.3em] text-white/75">Free spins</div>
        <div className={`relative mt-1 bg-clip-text text-[28px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[38px] ${PINK_TEXT}`}>
          {banner.super ? 'Super Disco Night' : 'Disco Night'}
        </div>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">{banner.super ? 'Every tile starts at ×2' : 'The floor stays lit for every spin'}</div>
      </>
    )
  } else if (banner.kind === 'retrigger') {
    body = (
      <>
        <motion.div className="relative mb-2" animate={{ y: [0, -6, 0], rotate: [-8, 8, -8] }} transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}>
          <DiscoBall className="h-12 w-12 drop-shadow-[0_0_14px_rgba(255,79,216,.7)]" />
        </motion.div>
        <div className={`relative bg-clip-text text-[44px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[60px] ${PINK_TEXT}`}>
          +{banner.spins} spins
        </div>
        <div className="relative mt-2 text-[14px] font-bold text-white/85">Disco Night goes on</div>
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
        <div className={`relative bg-clip-text text-[30px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_3px_0_#1d0f30)] sm:text-[40px] ${PINK_TEXT}`}>Party's over!</div>
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
        <div className={`relative bg-clip-text text-[40px] font-black uppercase leading-none tracking-tight text-transparent [filter:drop-shadow(0_4px_0_#1d0f30)] sm:text-[56px] ${GOLD_TEXT}`}>Max win</div>
        {money}
        <div className="relative mt-1 text-[14px] font-bold text-white/85">{fmt(MAX_WIN, 0)}× your bet</div>
      </>
    )
  }

  return (
    <motion.div
      className="absolute inset-0 z-30 flex cursor-pointer items-center justify-center bg-[#170a30]/65 p-6"
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

function PaytableModal({ bet, thumbs, onClose }: { bet: number; thumbs: Partial<Record<Sym | 'host', string>>; onClose: () => void }) {
  const pic = (s: Sym | 'host', size = 40) =>
    thumbs[s] ? (
      <img src={thumbs[s]} alt="" width={size} height={size} className="shrink-0" />
    ) : (
      <span className="shrink-0 rounded-full" style={{ width: size * 0.6, height: size * 0.6, margin: size * 0.2, background: s === 'host' ? '#29d8c4' : SYMBOL_COLOR[s] }} />
    )
  const money = (m: number) => {
    const a = round2(bet * m)
    return a >= 10000 ? fmtCompact(a) : fmt(a, a >= 1000 ? 0 : 2)
  }
  const cols = 'grid-cols-[36px_repeat(7,minmax(0,1fr))] sm:grid-cols-[156px_repeat(7,minmax(0,1fr))]'
  return (
    <Modal onClose={onClose} title="Paytable" width={620}>
      <p className="text-[13px] text-muted">
        5 or more touching balloons of one kind win (up, down, left and right). Winners pop, the rest float up and new balloons rise in from below, until nothing more wins. Amounts are for
        your bet of {fmt(bet)}.
      </p>
      <div className={`mt-3 grid ${cols} items-center gap-x-1 px-1.5 text-center text-[10px] font-bold uppercase tracking-wider text-dim sm:text-[11px]`}>
        <span className="text-left">
          <span className="hidden sm:inline">Symbol</span>
        </span>
        {BAND_LABELS.map((b) => (
          <span key={b} className="whitespace-nowrap">
            {b}
          </span>
        ))}
      </div>
      <div className="mt-1 flex flex-col gap-1">
        {PAY_SYMS.map((s) => (
          <div key={s} className={`grid ${cols} items-center gap-x-1 rounded-lg bg-stage px-1.5 py-0.5`}>
            <div className="flex min-w-0 items-center gap-2">
              {pic(s, 36)}
              <span className="hidden truncate text-[13px] font-bold sm:inline">{SYMBOL_NAME[s]}</span>
            </div>
            {PAYS[s].map((m, i) => (
              <span key={i} className="tnum text-center text-[11px] font-extrabold sm:text-[13px]">
                {money(m)}
              </span>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-lg bg-stage p-3">
        <div className="grid grid-cols-9 gap-1">
          {LEVEL_COLOR.map((c, l) => (
            <div key={l} className="flex flex-col items-center gap-1">
              {/* like the floor: a dark panel, lit from a frame in the level's colour */}
              <div
                className="h-7 w-full rounded-md border-2 border-transparent"
                style={{
                  background:
                    l === MAX_LEVEL
                      ? 'linear-gradient(#22133f,#22133f) padding-box, linear-gradient(135deg,#ff4fd8,#ffe23d,#6dff5a,#2fd3ff,#b38bff) border-box'
                      : l
                        ? `linear-gradient(#22133f,#22133f) padding-box, ${c} border-box`
                        : '#1d1238',
                  boxShadow: l ? `inset 0 0 9px -1px ${l === MAX_LEVEL ? '#ffd23f' : c}, 0 0 10px -3px ${c}` : 'inset 0 2px 4px rgba(0,0,0,.45)',
                }}
              />
              <span className="tnum text-[10px] font-bold text-muted sm:text-[11px]">{levelLabel(l)}</span>
            </div>
          ))}
        </div>
        <p className="mt-2.5 text-[13px] text-muted">
          <span className="font-bold text-ink">Disco tiles.</span> Every spot on the floor has a tile. A pop lights the tile under it, and each pop after that doubles it, from ×2 up to ×128. A
          cluster is multiplied by the sum of the tiles under it, so a tile counts from its second pop on. The floor goes dark after every paid spin; in Disco Night it stays lit for every spin.
        </p>
      </div>

      <Card tone="#ff4fd8" icon={pic('disco', 48)}>
        <span className="font-bold text-ink">Disco balls</span> never pop, and one parked on a lit tile blocks it. When a spin ends with {SCATTER_MIN}, 4, 5, 6 or 7+ on the floor they pay{' '}
        {either(SCATTER_PAYS.map(money))} and start {either(SCATTER_SPINS)} free spins of Disco Night. There, 3, 4 or 5+ add {either(RETRIGGER_SPINS)} more spins (up to {MAX_FREE_SPINS} in
        all).
      </Card>
      <Card tone="#29d8c4" icon={pic('host', 48)}>
        <span className="font-bold text-ink">Pump It!</span> When a paid spin's first drop has no win, DJ Bop sometimes grabs his pump and blows the biggest group of one kind up into a winning
        cluster.
      </Card>
      <Card tone="#ff8a2a" icon={<PinIcon className="mx-1 h-10 w-10 shrink-0" />}>
        <span className="font-bold text-ink">Pin Drop!</span> In Disco Night, when the first drop has no win, DJ Bop often throws pins: every balloon of one kind pops without paying, the tiles
        under them go up, and the floor plays on.
      </Card>
      <Card tone="#f7c548" icon={pic('poodle', 48)}>
        <span className="font-bold text-ink">Buy Disco Night</span> for {BUY_PRICE}× the bet ({money(BUY_PRICE)}): {BUY_SPINS} free spins on a fresh floor.{' '}
        <span className="font-bold text-ink">Super Disco Night</span> costs {SUPER_PRICE}× ({money(SUPER_PRICE)}): the same {BUY_SPINS} spins with every tile starting at ×2.{' '}
        <span className="font-bold text-ink">Party Mode</span> makes each spin cost {ANTE_COST}× the bet with the same pays and starts Disco Night about 1.6× as often; the buys are off while it
        is on.
      </Card>
      <p className="mt-3 text-[12px] text-dim">A round pays at most {fmt(MAX_WIN, 0)}× the bet. Return to player about 96% for spins, Party Mode and both buys.</p>
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

/** one of DJ Bop's pins, for the Pin Drop! card */
function PinIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <path d="M21 21 7 35" stroke="#c9d1e8" strokeWidth="3" strokeLinecap="round" />
      <path d="M21 21 7 35" stroke="#1d0f30" strokeWidth="1" strokeLinecap="round" opacity=".35" />
      <circle cx="25" cy="15" r="9" fill="#ff8a2a" stroke="#1d0f30" strokeWidth="2.5" />
      <ellipse cx="22" cy="12" rx="2.6" ry="3.4" fill="#fff" opacity=".65" transform="rotate(35 22 12)" />
      <path d="M33 4l1.2 2.8L37 8l-2.8 1.2L33 12l-1.2-2.8L29 8l2.8-1.2Z" fill="#ffe23d" />
    </svg>
  )
}
