import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ActionButton, BetInput, GameShell, HistoryPills, Label, Segmented, Stat, Toggle, useStake, type PillTone } from '../../components/ui'
import { AutoSettings, ModeTabs, useAutoBet, type Mode } from '../../components/auto'
import { Modal } from '../../components/Modal'
import { Coin } from '../../components/icons'
import { useUid } from '../../art/ids'
import { fmt, round2 } from '../../lib/format'
import { rand, randInt } from '../../lib/rng'
import { sfx } from '../../lib/sound'
import { useSize } from '../../lib/useSize'
import { useWallet, type BetEvent } from '../../store/wallet'
import { CRATE_ACCENT, CrateArt, ItemArt, twinkle } from './art'
import {
  CRATES,
  ITEM_NAME,
  RARITIES,
  RARITY,
  RTP,
  TIERS,
  buildStrip,
  chanceLabel,
  chanceOf,
  fillers,
  hitChance,
  multLabel,
  oddsLabel,
  pickIndex,
  topMult,
  type Rarity,
  type Tier,
  type Tile,
} from './rules'

/*
  Cases: pick a crate, press Open, and a reel of loot glides past the marker and settles on the prize.

  The item is drawn the moment Open is pressed (lib/rng) and the strip is built around it: the tiles on screen stay
  where they are, fillers drawn from the same table follow, and the winner sits where the reel will stop, a little off
  centre so every stop lands somewhere new. The reel is one Web Animation of transform only (a few hundred keyframes
  sampled from the motion curve), so the compositor runs it at the display's rate whatever the page is doing; a
  frame loop only follows along for the ticks and the swell of the tile under the marker. The round settles once,
  when the reel stops, or straight away if the page is left mid-spin.
*/

/** the manual spin: a short push, then a long ease-out that slides a hair past the stop and settles back */
const SPIN = { main: [3.35, 3.85], settle: 0.42, k: 2, ramp: 0.07, overshoot: 0.1, travel: [22, 27] } as const
const TURBO = { main: [0.98, 0.98], settle: 0.22, k: 1.6, ramp: 0.1, overshoot: 0.06 } as const

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (x: number) => x * x * (3 - 2 * x)

interface Curve {
  dur: number
  posAt: (ms: number) => number
}

/**
 * Position (in tiles) over time for a spin from `from` to `to`: speed rises over the first `ramp` of the main phase,
 * then falls as (1 − s)^k, carrying the reel `overshoot` tiles past the stop, and a gentle cosine brings it back.
 */
function spinCurve(from: number, to: number, o: { main: number; settle: number; k: number; ramp: number; overshoot: number }): Curve {
  const N = 720
  const cum = new Float64Array(N + 1)
  for (let i = 1; i <= N; i++) {
    const s = (i - 0.5) / N
    cum[i] = cum[i - 1] + smooth(Math.min(1, s / o.ramp)) * (1 - s) ** o.k
  }
  const total = cum[N]
  const span = to + o.overshoot - from
  const main = o.main * 1000
  const settle = o.settle * 1000
  return {
    dur: main + settle,
    posAt: (ms) => {
      if (ms <= 0) return from
      if (ms < main) {
        const f = (ms / main) * N
        const i = Math.floor(f)
        return from + (span * (cum[i] + (cum[Math.min(N, i + 1)] - cum[i]) * (f - i))) / total
      }
      const u = Math.min(1, (ms - main) / settle)
      return to + (o.overshoot * (1 + Math.cos(Math.PI * u))) / 2
    },
  }
}

/** A Hermite glide from `from` (moving at v0 tiles per ms) to rest at `to`, shortened if needed so it never overshoots. */
function glideCurve(from: number, to: number, v0: number, ms: number): Curve {
  const d = to - from
  let T = ms
  if (v0 > 0 && v0 * T > 3 * d) T = Math.max(60, (3 * d) / v0)
  const m0 = Math.min(v0 * T, 3 * d)
  return {
    dur: T,
    posAt: (t) => {
      const s = clamp01(t / T)
      const s2 = s * s
      const s3 = s2 * s
      return from * (2 * s3 - 3 * s2 + 1) + m0 * (s3 - 2 * s2 + s) + to * (3 * s2 - 2 * s3)
    },
  }
}

/** the strip's transform for a position: the tile at `pos` centred on the marker (the strip's left edge sits there) */
const tf = (pos: number, n: number) => `translate3d(${((-(pos + 0.5) / n) * 100).toFixed(4)}%,0,0)`

interface Run extends Curve {
  to: number
  skippable: boolean
  onDone: () => void
}
interface Motion extends Run {
  anim: Animation
  n: number
  timer: number
}

interface Result {
  id: number
  tier: Tier
  item: number
  mult: number
  rarity: Rarity
  bet: number
  payout: number
  /** where the winner sits from the marker, in tiles */
  offset: number
}

/* The shared pieces whose framer layout animations measure the page on every render: kept out of the renders the
   reel causes, so a spin's start and stop don't force extra layout passes. */
const MemoHistoryPills = memo(HistoryPills)
const MemoModeTabs = memo(ModeTabs)
const MemoToggle = memo(Toggle)

const RARITY_TEXT: Record<Rarity, string> ={ common: '#c3cfdb', uncommon: '#eafff3', rare: '#d6e8ff', epic: '#ecdfff', legendary: '#ffe7a8' }
const PILL: Record<Rarity, { tone: PillTone; style?: CSSProperties }> = {
  common: { tone: 'loss' },
  uncommon: { tone: 'win' },
  rare: { tone: 'neutral', style: { background: RARITY.rare.color, color: '#061a33' } },
  epic: { tone: 'neutral', style: { background: RARITY.epic.color, color: '#1c0838' } },
  legendary: { tone: 'gold' },
}

export default function Cases() {
  const stake = useStake()
  const balance = useWallet((s) => s.balance)

  const [bet, setBet] = useState(10)
  const [tier, setTier] = useState<Tier>('medium')
  const [mode, setMode] = useState<Mode>('manual')
  const [turbo, setTurbo] = useState(false)
  const [busy, setBusy] = useState(false)
  const [canSkip, setCanSkip] = useState(false)
  const [lidOpen, setLidOpen] = useState(false)
  const [showContents, setShowContents] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [history, setHistory] = useState<Result[]>([])
  const [strip, setStrip] = useState(() => ({ tiles: fillers(CRATES.medium, 27), win: -1 }))
  const [stageRef, size] = useSize<HTMLDivElement>()

  // the latest values for the engine, which runs outside React's renders
  const betRef = useRef(bet)
  betRef.current = bet
  const tierRef = useRef(tier)
  tierRef.current = tier
  const turboRef = useRef(turbo)
  turboRef.current = turbo
  const stripRef = useRef(strip)
  stripRef.current = strip
  const busyRef = useRef(false)

  const stripEl = useRef<HTMLDivElement>(null)
  const tileEls = useRef(new Map<number, HTMLDivElement>())
  const posRef = useRef(13)
  const live = useRef<Motion | null>(null)
  const layoutJob = useRef<{ pos: number; run?: Run } | null>(null)
  const raf = useRef(0)
  const lastIdx = useRef(0)
  const swollen = useRef(new Set<number>())
  const pending = useRef<BetEvent | null>(null)
  const finishRound = useRef<((net: number | null) => void) | null>(null)
  const lidTimer = useRef(0)
  const resultId = useRef(1)
  const autoRef = useRef(false)
  const dimAt = useRef(0)
  const pills = useMemo(() => history.map((h) => ({ key: h.id, label: multLabel(h.mult), tone: PILL[h.rarity].tone, style: PILL[h.rarity].style })), [history])

  /* ---------------- geometry ---------------- */

  const phone = size.w < 560
  const winW = Math.max(240, Math.min(1180, size.w - (phone ? 24 : 48)))
  // the reserved bands: history, crate caption, result plate, contents strip and the gaps between them
  const reserved = phone ? 262 : 318
  let tileW = Math.round(Math.max(76, Math.min(138, winW / (phone ? 3.9 : 6.5))))
  tileW = Math.max(70, Math.min(tileW, Math.floor((size.h - reserved - 64) / 1.52)))
  const tileH = Math.round(tileW * 1.2)
  const gap = Math.round(tileW * 0.085)
  const pitch = tileW + gap
  const padY = Math.round(tileW * 0.15)
  const reelH = tileH + padY * 2
  const crateW = Math.round(Math.max(72, Math.min(phone ? 136 : 230, (size.h - reserved - reelH) / 0.98)))
  const geo = useRef({ pitch, winW })
  geo.current = { pitch, winW }

  /** how many tiles either side of the marker can be on screen, plus one */
  const keepCount = () => Math.ceil(geo.current.winW / 2 / geo.current.pitch) + 1

  /* ---------------- the reel engine ---------------- */

  const register = useCallback((id: number, el: HTMLDivElement | null) => {
    if (el) tileEls.current.set(id, el)
    else tileEls.current.delete(id)
  }, [])

  const setScale = (id: number, s: number, ease = false) => {
    const el = tileEls.current.get(id)
    if (!el) return
    el.style.transition = ease ? 'transform .5s cubic-bezier(.2,.9,.25,1)' : ''
    el.style.transform = s === 1 ? '' : `scale(${s.toFixed(4)})`
  }

  /** the tile coming to rest under the marker swells a little as the reel slows */
  const lens = (p: number, speed: number) => {
    const amt = 0.07 * clamp01(1 - speed / 6) ** 2
    const tiles = stripRef.current.tiles
    const near = new Set<number>()
    if (amt > 0.002)
      for (let i = Math.floor(p) - 1; i <= Math.ceil(p) + 1; i++) {
        const t = tiles[i]
        if (!t) continue
        const c = smooth(clamp01((0.85 - Math.abs(i - p)) / 0.6))
        if (c <= 0) continue
        setScale(t.id, 1 + amt * c)
        near.add(t.id)
      }
    for (const id of swollen.current) if (!near.has(id)) setScale(id, 1)
    swollen.current = near
  }

  const frame = () => {
    const m = live.current
    if (!m) {
      raf.current = 0
      return
    }
    const t = (m.anim.currentTime as number | null) ?? 0
    const p = m.posAt(t)
    const speed = Math.abs(m.posAt(t + 8) - m.posAt(t - 8)) * (1000 / 16)
    const idx = Math.floor(p + 0.5)
    if (idx !== lastIdx.current) {
      lastIdx.current = idx
      sfx.cases.tick(Math.min(1, speed / 22))
    }
    lens(p, speed)
    raf.current = requestAnimationFrame(frame)
  }

  /** where the reel is right now, mid-animation or at rest */
  const currentPos = () => {
    const m = live.current
    return m ? m.posAt((m.anim.currentTime as number | null) ?? 0) : posRef.current
  }

  /** stops the reel where it is (without finishing its run) and returns that position */
  const halt = () => {
    const m = live.current
    if (!m) return posRef.current
    const p = currentPos()
    live.current = null
    clearTimeout(m.timer)
    m.anim.cancel()
    if (stripEl.current) stripEl.current.style.transform = tf(p, m.n)
    posRef.current = p
    return p
  }

  const start = (run: Run) => {
    const el = stripEl.current
    if (!el) return
    const n = stripRef.current.tiles.length
    const frames: Keyframe[] = []
    const step = 1000 / 60
    for (let t = 0; t < run.dur; t += step) frames.push({ transform: tf(run.posAt(t), n), offset: t / run.dur })
    frames.push({ transform: tf(run.to, n), offset: 1 })
    const anim = el.animate(frames, { duration: run.dur, easing: 'linear', fill: 'forwards' })
    const finish = () => {
      const m = live.current
      if (!m || m.anim !== anim) return
      live.current = null
      clearTimeout(m.timer)
      el.style.transform = tf(run.to, n)
      anim.cancel()
      posRef.current = run.to
      lens(run.to, 0)
      run.onDone()
    }
    // a hidden tab may hold the animation back; the timer still ends the round
    live.current = { ...run, anim, n, timer: window.setTimeout(finish, run.dur + 1200) }
    anim.finished.then(finish, () => {})
    lastIdx.current = Math.floor(run.posAt(0) + 0.5)
    if (!raf.current) raf.current = requestAnimationFrame(frame)
  }

  // a new strip is in the DOM: put the reel where the job says (before paint, so nothing jumps) and start its run
  useLayoutEffect(() => {
    const el = stripEl.current
    if (!el) return
    const job = layoutJob.current
    layoutJob.current = null
    if (job) posRef.current = job.pos
    if (!live.current) el.style.transform = tf(posRef.current, strip.tiles.length)
    if (job?.run) start(job.run)
    // start and the refs it reads are stable for the engine's purposes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip])

  // a wider reel needs more tiles either side of the marker: top them up while it rests
  useLayoutEffect(() => {
    if (live.current || busyRef.current) return
    const K = keepCount()
    const { tiles, win } = stripRef.current
    const p = posRef.current
    const needL = K + 1 - Math.floor(p)
    const needR = Math.ceil(p) + K + 1 - (tiles.length - 1)
    if (needL <= 0 && needR <= 0) return
    const crate = CRATES[tierRef.current]
    const left = needL > 0 ? fillers(crate, needL) : []
    const right = needR > 0 ? fillers(crate, needR) : []
    layoutJob.current = { pos: p + left.length }
    setStrip({ tiles: [...left, ...tiles, ...right], win: win >= 0 ? win + left.length : -1 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pitch, winW])

  const releaseWinner = () => {
    for (const id of swollen.current) setScale(id, 1, true)
    swollen.current = new Set()
  }

  /** the tiles on screen now, ready to be carried into a new strip */
  const keepWindow = () => {
    const from = halt()
    const tiles = stripRef.current.tiles
    const c = Math.round(from)
    const K = keepCount()
    const lo = Math.max(0, c - K)
    return { from, c, keep: tiles.slice(lo, c + K + 1), at: c - lo, K }
  }

  /* ---------------- a round ---------------- */

  const settlePending = () => {
    const ev = pending.current
    if (!ev) return
    pending.current = null
    useWallet.getState().settle(ev)
  }

  const play = (): Promise<number | null> => {
    if (busyRef.current) return Promise.resolve(null)
    const crate = CRATES[tierRef.current]
    const b = betRef.current
    if (!stake(b)) return Promise.resolve(null)
    busyRef.current = true
    setBusy(true)
    setCanSkip(true)

    const winner = pickIndex(crate)
    const item = crate.items[winner]
    const payout = round2(b * item.mult)
    pending.current = { game: 'cases', bet: b, payout, meta: { tier: crate.tier, mult: item.mult, rarity: item.rarity } }

    setResult(null)
    releaseWinner()
    clearTimeout(lidTimer.current)
    setLidOpen(true)
    sfx.cases.open(TIERS.indexOf(crate.tier))

    const { from, c, keep, at, K } = keepWindow()
    const fast = turboRef.current
    const travel = fast ? Math.max(8, K + 3) : Math.max(K + 3, SPIN.travel[0] + randInt(SPIN.travel[1] - SPIN.travel[0] + 1))
    const built = buildStrip(crate, keep, at, travel, winner, K + 2)
    const startPos = at + (from - c)
    const jitter = (rand() * 2 - 1) * 0.3
    const end = built.win + jitter
    const o = fast ? TURBO : SPIN
    const curve = spinCurve(startPos, end, { main: o.main[0] + rand() * (o.main[1] - o.main[0]), settle: o.settle, k: o.k, ramp: o.ramp, overshoot: o.overshoot })

    return new Promise<number | null>((resolve) => {
      finishRound.current = resolve
      const land = () => {
        settlePending()
        const res: Result = { id: resultId.current++, tier: crate.tier, item: winner, mult: item.mult, rarity: item.rarity, bet: b, payout, offset: -jitter }
        setStrip((s) => ({ ...s, win: built.win }))
        setResult(res)
        setHistory((h) => [res, ...h].slice(0, 14))
        sfx.cases.land(RARITIES.indexOf(item.rarity))
        // the winner rises a touch; any neighbour the lens left swollen settles back
        const wid = built.tiles[built.win].id
        for (const id of swollen.current) if (id !== wid) setScale(id, 1, true)
        setScale(wid, 1.085, true)
        swollen.current = new Set([wid])
        busyRef.current = false
        setBusy(false)
        setCanSkip(false)
        if (!autoRef.current) lidTimer.current = window.setTimeout(() => setLidOpen(false), 1300)
        // let a big pull breathe before autobet moves on
        const hold = (item.rarity === 'legendary' ? 1700 : item.rarity === 'epic' ? 800 : 0) * (fast ? 0.6 : 1)
        const done = () => {
          if (finishRound.current !== resolve) return
          finishRound.current = null
          resolve(payout - b)
        }
        if (autoRef.current && hold) window.setTimeout(done, hold)
        else done()
      }
      layoutJob.current = { pos: startPos, run: { ...curve, to: end, skippable: true, onDone: land } }
      setStrip({ tiles: built.tiles, win: -1 })
    })
  }

  /** speeds a manual spin to its stop */
  const skip = () => {
    const m = live.current
    if (!m || !m.skippable) return
    const t = (m.anim.currentTime as number | null) ?? 0
    if (m.dur - t < 500) return
    const v = Math.max(0, (m.posAt(t + 8) - m.posAt(t - 8)) / 16)
    const p = halt()
    setCanSkip(false)
    start({ ...glideCurve(p, m.to, v, 520), to: m.to, skippable: false, onDone: m.onDone })
  }

  /** a new crate: its items glide in from the right */
  const pickTier = (t: Tier) => {
    if (t === tierRef.current || busyRef.current || auto.running) return
    setTier(t)
    tierRef.current = t
    sfx.cases.pick(TIERS.indexOf(t))
    setResult(null)
    releaseWinner()
    clearTimeout(lidTimer.current)
    setLidOpen(false)
    const m = live.current
    let v0 = 0
    if (m) {
      const tt = (m.anim.currentTime as number | null) ?? 0
      v0 = Math.max(0, (m.posAt(tt + 8) - m.posAt(tt - 8)) / 16)
    }
    const { from, c, keep, at, K } = keepWindow()
    const travel = 2 * K + 2
    const tiles = [...keep, ...fillers(CRATES[t], at + travel + K + 2 - keep.length)]
    const startPos = at + (from - c)
    const end = at + travel
    layoutJob.current = { pos: startPos, run: { ...glideCurve(startPos, end, v0, 1000), to: end, skippable: false, onDone: () => {} } }
    setStrip({ tiles, win: -1 })
  }

  const auto = useAutoBet(play, turbo ? 300 : 700)
  autoRef.current = auto.running
  const locked = busy || auto.running

  // autobet keeps the crate open between rounds; it closes once autobet stops
  useEffect(() => {
    if (!auto.running && !busy && lidOpen) {
      clearTimeout(lidTimer.current)
      lidTimer.current = window.setTimeout(() => setLidOpen(false), 1300)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto.running])

  // leaving mid-spin settles the round at once; so does closing the page, or hiding it (a phone may drop a background
  // tab without another word); the reel still lands where it was going
  useEffect(() => {
    const onHide = () => settlePending()
    const onVisibility = () => document.hidden && settlePending()
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      const m = live.current
      if (m) {
        clearTimeout(m.timer)
        m.anim.cancel()
        live.current = null
      }
      cancelAnimationFrame(raf.current)
      raf.current = 0
      clearTimeout(lidTimer.current)
      settlePending()
      busyRef.current = false
      finishRound.current?.(null)
      finishRound.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || showContents) return
      if (e.code === 'Space' && mode === 'manual') {
        e.preventDefault()
        if (e.repeat) return
        if (busyRef.current) skip()
        else if (balance >= bet) void play()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /* ---------------- panel ---------------- */

  const crate = CRATES[tier]
  const panel = (
    <>
      <MemoModeTabs mode={mode} onChange={setMode} disabled={locked} />
      <BetInput value={bet} onChange={setBet} disabled={auto.running} />
      <div>
        <Label right={crate.name}>Crate</Label>
        <div className="grid grid-cols-2 gap-2">
          {TIERS.map((t) => {
            const on = t === tier
            return (
              <button
                key={t}
                disabled={locked && !on}
                onClick={() => pickTier(t)}
                aria-pressed={on}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition disabled:opacity-45 ${on ? 'bg-hover shadow-[inset_0_0_0_2px_rgba(34,211,111,.6)]' : 'bg-raised hover:bg-hover'}`}
              >
                <CrateArt tier={t} size={44} className="shrink-0" />
                <span className="min-w-0">
                  <span className={`block text-[13px] font-bold ${on ? 'text-ink' : 'text-ink/85'}`}>{CRATES[t].risk.replace(' risk', '')}</span>
                  <span className="tnum block text-[11px] font-semibold text-dim">up to {multLabel(topMult(CRATES[t]))}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Chance of 1×+" value={chanceLabel(hitChance(crate))} />
        <Stat label="Top prize" value={fmt(bet * topMult(crate))} tone="gold" />
      </div>
      <div className="flex items-center justify-between rounded-lg bg-stage px-3 py-2.5">
        <span className="text-[13px] font-semibold text-muted">Turbo</span>
        <MemoToggle on={turbo} onChange={setTurbo} label="Turbo" />
      </div>
      <button onClick={() => (sfx.click(), setShowContents(true))} className="h-10 rounded-lg bg-raised text-[14px] font-bold text-muted transition hover:bg-hover hover:text-ink">
        Crate contents
      </button>
      {mode === 'auto' && <AutoSettings auto={auto} />}
      <div className="max-lg:order-first lg:mt-auto">
        {mode === 'manual' ? (
          busy ? (
            <ActionButton tone="neutral" onClick={skip} sub={canSkip ? 'Tap to skip' : undefined}>
              Opening…
            </ActionButton>
          ) : (
            <ActionButton onClick={() => void play()} disabled={balance < bet}>
              Open crate
            </ActionButton>
          )
        ) : auto.running ? (
          <ActionButton tone="danger" onClick={auto.stop}>
            Stop autobet
          </ActionButton>
        ) : (
          <ActionButton onClick={auto.start} disabled={balance < bet}>
            Start autobet
          </ActionButton>
        )}
      </div>
    </>
  )

  /* ---------------- stage ---------------- */

  const shown = result && result.tier === tier ? result : null
  const glow = shown ? RARITY[shown.rarity].color : CRATE_ACCENT[tier]
  const big = shown && (shown.rarity === 'legendary' || shown.rarity === 'epic') ? shown : null
  // the winner's place stays put while the dimming fades out, so the clear window doesn't jump
  if (shown) dimAt.current = shown.offset
  const landed = strip.win >= 0 && !!shown

  const stage = (
    <div ref={stageRef} className="absolute inset-0 flex flex-col overflow-hidden bg-[radial-gradient(ellipse_at_50%_36%,#1a2f43_0%,#0a1620_70%)]">
      <MemoHistoryPills className="min-h-[44px] shrink-0 justify-end px-4 pt-4" items={pills} />
      <div className={`relative flex min-h-0 flex-1 flex-col items-center justify-center ${phone ? 'gap-2.5' : 'gap-4'}`}>
        <CrateHero tier={tier} width={crateW} open={lidOpen} glow={glow} />
        <div className="relative z-[1] -mt-1 text-center">
          <div className={`font-extrabold tracking-tight text-ink ${phone ? 'text-[14px]' : 'text-[16px]'}`}>{crate.name}</div>
          <div className="tnum text-[12px] font-semibold text-muted">
            {crate.risk} · up to {multLabel(topMult(crate))}
          </div>
        </div>

        {/* the reel */}
        <div className="relative shrink-0" style={{ width: winW, height: reelH }}>
          <AnimatePresence>{big && <Burst key={big.id} rarity={big.rarity} x={big.offset * pitch} reelH={reelH} tileW={tileW} />}</AnimatePresence>
          <div className="absolute inset-0 overflow-hidden rounded-[18px] border border-line bg-[#08131c] shadow-[inset_0_2px_16px_rgba(0,0,0,.6)]">
            {/* a soft light under the marker */}
            <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2" style={{ width: pitch * 1.6, background: 'radial-gradient(closest-side, rgba(150,190,230,.13), rgba(150,190,230,0))' }} />
            <div ref={stripEl} className="absolute left-1/2 will-change-transform" style={{ top: padY, width: strip.tiles.length * pitch, height: tileH }}>
              {strip.tiles.map((t, i) => (
                <LootTile key={t.id} tile={t} x={i * pitch + gap / 2} w={tileW} h={tileH} win={i === strip.win} register={register} />
              ))}
            </div>
            {/* once the reel rests, everything but the winner sinks into the dark: one layer over the reel, rather than
                fifty tiles fading each on their own (cheaper for a phone, and nothing to lift when the next spin starts) */}
            <DimOverlay on={landed} x={dimAt.current * pitch} half={tileW * 0.55} top={padY - 2} height={tileH + 4} />
            <AnimatePresence>
              {shown && (
                <motion.div
                  key={shown.id}
                  className="pointer-events-none absolute inset-y-0 left-0 w-[34%]"
                  style={{ background: `linear-gradient(100deg, transparent 0%, ${RARITY[shown.rarity].glow} 50%, transparent 100%)` }}
                  // a transform (not x) so the sweep runs on the compositor
                  initial={{ transform: 'translateX(-110%)', opacity: 0 }}
                  animate={{ transform: 'translateX(300%)', opacity: [0, 1, 1, 0] }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 1.25, ease: [0.35, 0.1, 0.3, 1] }}
                />
              )}
            </AnimatePresence>
            {/* the edges fade into the frame */}
            <div className="pointer-events-none absolute inset-y-0 left-0 w-[16%] bg-gradient-to-r from-[#08131c] to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 w-[16%] bg-gradient-to-l from-[#08131c] to-transparent" />
            <Marker color={shown ? RARITY[shown.rarity].color : '#ffd36a'} padY={padY} />
          </div>
          <AnimatePresence>{big && <Sparkles key={big.id} rarity={big.rarity} x={big.offset * pitch} tileW={tileW} tileH={tileH} />}</AnimatePresence>
        </div>

        <ResultPlate result={shown} hint={!busy && !auto.running} phone={phone} width={Math.min(winW, 460)} />
      </div>
      <ContentsStrip tier={tier} won={shown ? shown.item : -1} />
    </div>
  )

  return (
    <>
      <GameShell panel={panel} stage={stage} stageClass="max-sm:h-[min(72vh,600px)] sm:max-lg:h-[min(70vh,700px)]" />
      <AnimatePresence>{showContents && <ContentsModal initial={tier} onClose={() => setShowContents(false)} />}</AnimatePresence>
    </>
  )
}

/* ---------------- pieces ---------------- */

/** One loot tile: a rarity-lit card with the item and its multiplier. The reel engine drives its scale; `win` only
 *  rings it, and the face underneath never re-renders for that. */
const LootTile = memo(function LootTile({
  tile,
  x,
  w,
  h,
  win,
  register,
}: {
  tile: Tile
  x: number
  w: number
  h: number
  win: boolean
  register: (id: number, el: HTMLDivElement | null) => void
}) {
  const color = RARITY[CRATES[tile.tier].items[tile.item].rarity].color
  const ref = useCallback(
    (el: HTMLDivElement | null) => {
      register(tile.id, el)
      return () => register(tile.id, null)
    },
    [register, tile.id],
  )
  const radius = Math.round(w * 0.11)
  return (
    <div ref={ref} className="absolute top-0" style={{ left: x, width: w, height: h }}>
      <TileFace tile={tile} w={w} h={h} />
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-500" style={{ borderRadius: radius, opacity: win ? 1 : 0, boxShadow: `inset 0 0 0 2px ${color}, 0 0 26px -4px ${color}` }} />
    </div>
  )
})

/**
 * The dark veil over the row of tiles on a resting reel, clear over the winner (`x` px from the marker, `half` px either
 * side, a hair wider than the risen winner and short of its neighbours). Fades in slowly as the prize settles, and lifts
 * quickly as the next spin pushes off.
 */
function DimOverlay({ on, x, half, top, height }: { on: boolean; x: number; half: number; top: number; height: number }) {
  const c = 'rgba(8,19,28,.58)'
  const o = 'rgba(8,19,28,0)'
  const at = (px: number) => `calc(50% + ${px.toFixed(1)}px)`
  return (
    <div
      className="pointer-events-none absolute inset-x-0"
      style={{
        top,
        height,
        opacity: on ? 1 : 0,
        transition: `opacity ${on ? 500 : 160}ms ease-out`,
        background: `linear-gradient(90deg, ${c} 0, ${c} ${at(x - half - 2)}, ${o} ${at(x - half + 1)}, ${o} ${at(x + half - 1)}, ${c} ${at(x + half + 2)}, ${c} 100%)`,
      }}
    />
  )
}

const TileFace = memo(function TileFace({ tile, w, h }: { tile: Tile; w: number; h: number }) {
  const it = CRATES[tile.tier].items[tile.item]
  const r = RARITY[it.rarity]
  return (
    <>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: Math.round(w * 0.11),
          background: 'linear-gradient(180deg,#182b3a 0%,#101e2a 100%)',
          boxShadow: `inset 0 0 0 1px ${r.color}40, inset 0 1px 0 rgba(255,255,255,.07), 0 8px 16px -10px rgba(0,0,0,.8)`,
        }}
      >
        <div className="absolute inset-0" style={{ background: `radial-gradient(62% 48% at 50% 40%, ${r.glow}, transparent 72%)` }} />
        <div className="absolute inset-x-0 bottom-0 h-1/2" style={{ background: `linear-gradient(0deg, ${r.color}33, transparent)` }} />
        <div className="absolute inset-x-[22%] bottom-0 rounded-t-full" style={{ height: Math.max(2, Math.round(w * 0.025)), background: r.color }} />
      </div>
      <div className="absolute inset-x-0 flex justify-center" style={{ top: h * 0.1 }}>
        <ItemArt kind={it.kind} size={Math.round(w * 0.6)} />
      </div>
      <div className="tnum absolute inset-x-0 text-center font-extrabold leading-none" style={{ bottom: h * 0.1, fontSize: Math.max(12, Math.round(w * 0.13)), color: RARITY_TEXT[it.rarity], textShadow: '0 1px 2px rgba(0,0,0,.6)' }}>
        {multLabel(it.mult)}
      </div>
    </>
  )
})

/** The marker: a fine line down the middle with a notch at each end. */
function Marker({ color, padY }: { color: string; padY: number }) {
  const notch = Math.max(8, Math.round(padY * 0.62))
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2">
      <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors duration-500" style={{ background: `linear-gradient(180deg, ${color} 0%, ${color}00 22%, ${color}00 78%, ${color} 100%)` }} />
      <svg className="absolute left-1/2 top-0 -translate-x-1/2" width={notch * 1.6} height={notch} viewBox="0 0 16 10" aria-hidden>
        <path d="M1 0h14L8 9.5Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
      <svg className="absolute bottom-0 left-1/2 -translate-x-1/2" width={notch * 1.6} height={notch} viewBox="0 0 16 10" aria-hidden>
        <path d="M1 10h14L8 .5Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
    </div>
  )
}

/** The chosen crate, floating gently. Its lid lifts while a round plays, with light spilling out in `glow`. */
function CrateHero({ tier, width, open, glow }: { tier: Tier; width: number; open: boolean; glow: string }) {
  const floatRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = floatRef.current
    if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }], { duration: 2400, direction: 'alternate', iterations: Infinity, easing: 'ease-in-out' })
    return () => a.cancel()
  }, [])
  const h = Math.round((width * 150) / 160)
  return (
    <div className="relative z-[1] shrink-0" style={{ width, height: h }}>
      {/* the glow behind the crate */}
      <div
        className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 rounded-full transition-[opacity,background] duration-700"
        style={{ width: width * 1.7, height: width * 1.3, background: `radial-gradient(closest-side, ${glow}40, ${glow}00)`, opacity: open ? 1 : 0.55 }}
      />
      <div ref={floatRef} className="absolute inset-0 will-change-transform">
        <AnimatePresence initial={false}>
          <motion.div
            key={tier}
            className="absolute inset-0"
            initial={{ opacity: 0, scale: 0.86, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -4, transition: { duration: 0.18 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <CrateArt tier={tier} part="body" size={width} className="absolute inset-0" />
            {/* light from inside, seen once the lid lifts */}
            <div
              className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full transition-opacity duration-500"
              style={{ top: h * 0.12, width: width * 0.86, height: h * 0.42, background: `radial-gradient(closest-side, ${glow}cc, ${glow}00)`, opacity: open ? 0.9 : 0 }}
            />
            <div
              className="absolute inset-0"
              style={{
                transformOrigin: '50% 28%',
                transform: open ? 'translateY(-15%) rotate(-4deg) scale(.97,.9)' : 'none',
                transition: open ? 'transform .55s cubic-bezier(.25,1.35,.45,1)' : 'transform .4s cubic-bezier(.5,0,.3,1)',
              }}
            >
              <CrateArt tier={tier} part="lid" size={width} className="absolute inset-0" />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

/** Behind a big pull: a halo, and for a legendary a slow turn of soft rays. Drawn behind the reel frame. */
function Burst({ rarity, x, reelH, tileW }: { rarity: Rarity; x: number; reelH: number; tileW: number }) {
  const c = RARITY[rarity].color
  const legendary = rarity === 'legendary'
  const size = Math.round(reelH * (legendary ? 3.4 : 2.2))
  const raysRef = useRef<SVGSVGElement>(null)
  const u = useUid()
  useEffect(() => {
    const el = raysRef.current
    if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const a = el.animate([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 48000, iterations: Infinity })
    return () => a.cancel()
  }, [])
  return (
    <motion.div
      className="pointer-events-none absolute left-1/2 top-1/2"
      style={{ x, width: 0, height: 0 }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.3 } }}
      transition={{ duration: 0.7, ease: [0.2, 0.8, 0.2, 1] }}
    >
      <div className="absolute rounded-full" style={{ left: -tileW * 1.5, top: -reelH * 0.9, width: tileW * 3, height: reelH * 1.8, background: `radial-gradient(closest-side, ${c}55, ${c}00)` }} />
      {legendary && (
        <svg ref={raysRef} className="absolute" style={{ left: -size / 2, top: -size / 2 }} width={size} height={size} viewBox="-100 -100 200 200" aria-hidden>
          <defs>
            <radialGradient id={u} cx="0" cy="0" r="100" gradientUnits="userSpaceOnUse">
              <stop offset=".18" stopColor={c} stopOpacity=".42" />
              <stop offset=".6" stopColor={c} stopOpacity=".12" />
              <stop offset="1" stopColor={c} stopOpacity="0" />
            </radialGradient>
          </defs>
          <g fill={`url(#${u})`}>
            {Array.from({ length: 16 }, (_, i) => (
              <path key={i} d={i % 2 ? 'M0 0-4 -100H4Z' : 'M0 0-7.5 -100H7.5Z'} transform={`rotate(${i * 22.5})`} />
            ))}
          </g>
        </svg>
      )}
    </motion.div>
  )
}

/** A few twinkles around the winning tile: three for an epic, six for a legendary. */
function Sparkles({ rarity, x, tileW, tileH }: { rarity: Rarity; x: number; tileW: number; tileH: number }) {
  const spots =
    rarity === 'legendary'
      ? [
          [-0.62, -0.5, 1],
          [0.6, -0.36, 0.7],
          [0.66, 0.42, 0.9],
          [-0.56, 0.48, 0.6],
          [0.05, -0.68, 0.55],
          [-0.12, 0.7, 0.5],
        ]
      : [
          [-0.58, -0.46, 0.8],
          [0.62, -0.2, 0.6],
          [0.4, 0.52, 0.55],
        ]
  return (
    <motion.div className="pointer-events-none absolute left-1/2 top-1/2 z-10" style={{ x, width: 0, height: 0 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
      {spots.map(([sx, sy, s], i) => {
        const r = Math.round(tileW * 0.16 * s)
        return (
          <motion.svg
            key={i}
            className="absolute"
            style={{ left: sx * tileW - r, top: sy * tileH - r }}
            width={r * 2}
            height={r * 2}
            viewBox="-10 -10 20 20"
            initial={{ scale: 0, opacity: 0, rotate: -40 }}
            animate={{ scale: [0, 1, 0.85, 0], opacity: [0, 1, 1, 0], rotate: 40 }}
            transition={{ duration: 1.4, delay: 0.15 + i * 0.13, ease: 'easeOut', times: [0, 0.3, 0.6, 1], repeat: rarity === 'legendary' ? 2 : 0, repeatDelay: 0.5 }}
            aria-hidden
          >
            <path d={twinkle(0, 0, 10)} fill="#fff" />
            <circle r="2.6" fill={RARITY[rarity].color} opacity=".9" />
          </motion.svg>
        )
      })}
    </motion.div>
  )
}

/** Under the reel: what came out, its multiplier and the payout (or, before an open, how to start one). Holds its
 *  height so nothing below moves. */
function ResultPlate({ result, hint, phone, width }: { result: Result | null; hint: boolean; phone: boolean; width: number }) {
  const h = phone ? 56 : 64
  return (
    <div className="relative shrink-0" style={{ width, height: h }}>
      <AnimatePresence>
        {result ? (
          <motion.div
            key={result.id}
            className="absolute inset-0 flex items-center gap-3 rounded-xl bg-panel2/90 px-3"
            style={{ boxShadow: `inset 0 0 0 1px ${RARITY[result.rarity].color}55, 0 14px 30px -18px ${RARITY[result.rarity].color}` }}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          >
            <div className="relative flex shrink-0 items-center justify-center rounded-lg" style={{ width: h - 14, height: h - 14, background: `radial-gradient(closest-side, ${RARITY[result.rarity].glow}, transparent)` }}>
              <ItemArt kind={CRATES[result.tier].items[result.item].kind} size={h - 18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-extrabold uppercase tracking-[.08em]" style={{ color: RARITY[result.rarity].color }}>
                {RARITY[result.rarity].name}
              </div>
              <div className={`truncate font-extrabold text-ink ${phone ? 'text-[14px]' : 'text-[15px]'}`}>{ITEM_NAME[CRATES[result.tier].items[result.item].kind]}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className={`tnum font-black leading-none ${phone ? 'text-[20px]' : 'text-[24px]'}`} style={{ color: result.mult >= 1 ? RARITY[result.rarity].color : '#c3cfdb' }}>
                {multLabel(result.mult)}
              </div>
              <div className="tnum mt-1 flex items-center justify-end gap-1 text-[13px] font-bold text-muted">
                {fmt(result.payout)} <Coin size={13} />
              </div>
            </div>
          </motion.div>
        ) : hint ? (
          <motion.div key="idle" className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold text-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.1 } }}>
            {phone ? 'Tap Open crate to spin the reel' : 'Press Open crate or Space to spin the reel'}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}

/** Along the bottom of the stage: every item in the crate with its multiplier and chance. */
function ContentsStrip({ tier, won }: { tier: Tier; won: number }) {
  const crate = CRATES[tier]
  return (
    <div className="no-scrollbar shrink-0 overflow-x-auto bg-panel2/60 px-3 py-2.5">
      <div className="mx-auto flex w-max gap-1.5">
        {crate.items.map((it, i) => {
          const r = RARITY[it.rarity]
          return (
            <div
              key={`${tier}${i}`}
              title={`${ITEM_NAME[it.kind]} · ${multLabel(it.mult)} · ${chanceLabel(chanceOf(it))}`}
              className="flex min-w-[60px] shrink-0 flex-col items-center rounded-lg bg-raised px-1.5 pb-1.5 pt-1 transition-shadow duration-300"
              style={{ boxShadow: `inset 0 -2px 0 ${r.color}${won === i ? `, inset 0 0 0 2px ${r.color}, 0 0 16px -4px ${r.color}` : ''}` }}
            >
              <ItemArt kind={it.kind} size={26} />
              <div className="tnum mt-0.5 text-[12px] font-extrabold leading-tight" style={{ color: RARITY_TEXT[it.rarity] }}>
                {multLabel(it.mult)}
              </div>
              <div className="tnum text-[10px] font-bold leading-tight text-dim">{chanceLabel(chanceOf(it))}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The full contents of every crate: item, rarity, multiplier, chance and odds. */
function ContentsModal({ initial, onClose }: { initial: Tier; onClose: () => void }) {
  const [tier, setTier] = useState(initial)
  const crate = CRATES[tier]
  return (
    <Modal onClose={onClose} title="Crate contents" width={520}>
      <div className="flex flex-col gap-3">
        <Segmented value={tier} onChange={setTier} options={TIERS.map((t) => ({ value: t, label: CRATES[t].risk.replace(' risk', '') }))} />
        <div className="flex items-center gap-3 rounded-xl bg-panel2 px-3 py-2">
          <CrateArt tier={tier} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-extrabold">{crate.name}</div>
            <div className="tnum text-[12px] font-semibold text-muted">
              Return {(RTP * 100).toFixed(0)}% · 1× or more {chanceLabel(hitChance(crate))}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          {[...crate.items].reverse().map((it) => {
            const r = RARITY[it.rarity]
            const p = chanceOf(it)
            return (
              <div key={it.mult} className="flex items-center gap-3 rounded-lg bg-panel2/70 px-2.5 py-1.5" style={{ boxShadow: `inset 3px 0 0 ${r.color}` }}>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md" style={{ background: `radial-gradient(closest-side, ${r.glow}, transparent)` }}>
                  <ItemArt kind={it.kind} size={34} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold">{ITEM_NAME[it.kind]}</div>
                  <div className="text-[11px] font-bold" style={{ color: r.color }}>
                    {r.name}
                  </div>
                </div>
                <div className="tnum w-[70px] text-right text-[15px] font-black" style={{ color: RARITY_TEXT[it.rarity] }}>
                  {multLabel(it.mult)}
                </div>
                <div className="tnum w-[84px] text-right leading-tight">
                  <div className="text-[13px] font-bold text-ink/90">{chanceLabel(p)}</div>
                  <div className="text-[10.5px] font-semibold text-dim">{oddsLabel(p)}</div>
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[12px] font-medium leading-relaxed text-dim">
          The item is drawn the moment you open the crate; the reel then shows it. Every filler tile on the reel is drawn from the same table.
        </p>
      </div>
    </Modal>
  )
}
