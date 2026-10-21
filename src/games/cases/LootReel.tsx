import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import { rand, randInt } from '../../lib/rng'
import { casesSfx } from './sound'
import { twinkle } from './art'
import { clamp01, delayed, glideCurve, keyframes, smooth, spinCurve, type Curve } from './reel'
import { CRATES, RARITY, buildStrip, fillers, type Crate, type Rarity, type Tier, type Tile } from './rules'
import { TileFace } from './tiles'

/*
  One horizontal loot reel. The item is drawn by the page and handed to spin(); the strip is built around it: the
  tiles on screen stay where they are, fillers drawn from the same table follow, and the winner sits where the reel
  will stop, a little off centre so every stop lands somewhere new. The reel is one Web Animation of transform only (a
  few hundred keyframes sampled from the motion curve), so the compositor runs it at the display's rate whatever the
  page is doing; a frame loop only follows along for the ticks and the swell of the tile under the marker.

  Cases stacks one to five of these. Each owns its strip and its landed look (the dimmed neighbours, the sweep of
  light, the burst behind a big pull); the page owns the money.
*/

/** the manual spin: a short push, then a long ease-out that slides a hair past the stop and settles back */
const SPIN = { main: [3.35, 3.85], settle: 0.42, k: 2, ramp: 0.07, overshoot: 0.1, travel: [22, 27] } as const
const TURBO = { main: [0.98, 0.98], settle: 0.22, k: 1.6, ramp: 0.1, overshoot: 0.06 } as const

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
  /** set once the reel pushes off (a staggered reel waits at rest first, and shouldn't swell its tile meanwhile) */
  moved: boolean
}

export interface Landing {
  /** where the winner sits from the marker, in tiles */
  offset: number
}

export interface SpinOrder {
  crate: Crate
  winner: number
  fast: boolean
  /** ms the reel waits (inside its own animation) before it pushes off */
  delay?: number
  /** seconds added to the main phase, so a stack of reels comes to rest one after another */
  extra?: number
  /** a main phase shared by a stack of reels (seconds); drawn per spin when left out */
  main?: number
  onLand: (l: Landing) => void
}

export interface ReelHandle {
  spin(o: SpinOrder): void
  /** speeds a spin to its stop; false when there is nothing (left) to skip */
  skip(): boolean
  /** a new crate: its items glide in from the right */
  glide(tier: Tier): void
  /** drops the landed look (the next spin or a crate change) */
  clear(): void
}

interface Shown {
  id: number
  rarity: Rarity
  offset: number
}

let shownSeq = 1

export function LootReel({
  ref,
  tier,
  winW,
  tileW,
  ticks,
}: {
  ref?: Ref<ReelHandle>
  tier: Tier
  winW: number
  tileW: number
  /** this reel drives the tick sound (one per stack) */
  ticks: boolean
}) {
  const tileH = Math.round(tileW * 1.2)
  const gap = Math.round(tileW * 0.085)
  const pitch = tileW + gap
  const padY = Math.round(tileW * 0.15)
  const reelH = tileH + padY * 2

  const [strip, setStrip] = useState(() => ({ tiles: fillers(CRATES[tier], 27), win: -1 }))
  const [shown, setShown] = useState<Shown | null>(null)
  const stripRef = useRef(strip)
  stripRef.current = strip
  const tierRef = useRef(tier)
  tierRef.current = tier
  const ticksRef = useRef(ticks)
  ticksRef.current = ticks
  const geo = useRef({ pitch, winW })
  geo.current = { pitch, winW }

  const stripEl = useRef<HTMLDivElement>(null)
  const tileEls = useRef(new Map<number, HTMLDivElement>())
  const posRef = useRef(13)
  const live = useRef<Motion | null>(null)
  const layoutJob = useRef<{ pos: number; run?: Run } | null>(null)
  const raf = useRef(0)
  const lastIdx = useRef(0)
  const swollen = useRef(new Set<number>())
  const spinning = useRef(false)
  const dimAt = useRef(0)

  /** how many tiles either side of the marker can be on screen, plus one */
  const keepCount = () => Math.ceil(geo.current.winW / 2 / geo.current.pitch) + 1

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
      if (ticksRef.current) casesSfx.tick(Math.min(1, speed / 22))
    }
    if (speed > 1) m.moved = true
    if (m.moved) lens(p, speed)
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
    const anim = el.animate(keyframes(run, run.to, (p) => tf(p, n)), { duration: run.dur, easing: 'linear', fill: 'forwards' })
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
    live.current = { ...run, anim, n, timer: window.setTimeout(finish, run.dur + 1200), moved: false }
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
    if (live.current || spinning.current) return
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

  useImperativeHandle(ref, () => ({
    spin: (o) => {
      spinning.current = true
      setShown(null)
      releaseWinner()
      const { from, c, keep, at, K } = keepWindow()
      const travel = o.fast ? Math.max(8, K + 3) : Math.max(K + 3, SPIN.travel[0] + randInt(SPIN.travel[1] - SPIN.travel[0] + 1))
      const built = buildStrip(o.crate, keep, at, travel, o.winner, K + 2)
      const startPos = at + (from - c)
      const jitter = (rand() * 2 - 1) * 0.3
      const end = built.win + jitter
      const shape = o.fast ? TURBO : SPIN
      const main = (o.main ?? shape.main[0] + rand() * (shape.main[1] - shape.main[0])) + (o.extra ?? 0)
      const curve = delayed(spinCurve(startPos, end, { main, settle: shape.settle, k: shape.k, ramp: shape.ramp, overshoot: shape.overshoot }), o.delay ?? 0)
      const rarity = o.crate.items[o.winner].rarity
      const land = () => {
        spinning.current = false
        setStrip((s) => ({ ...s, win: built.win }))
        setShown({ id: shownSeq++, rarity, offset: -jitter })
        // the winner rises a touch; any neighbour the lens left swollen settles back
        const wid = built.tiles[built.win].id
        for (const id of swollen.current) if (id !== wid) setScale(id, 1, true)
        setScale(wid, 1.085, true)
        swollen.current = new Set([wid])
        o.onLand({ offset: -jitter })
      }
      layoutJob.current = { pos: startPos, run: { ...curve, to: end, skippable: true, onDone: land } }
      setStrip({ tiles: built.tiles, win: -1 })
    },
    skip: () => {
      const m = live.current
      if (!m || !m.skippable) return false
      const t = (m.anim.currentTime as number | null) ?? 0
      if (m.dur - t < 500) return false
      const v = Math.max(0, (m.posAt(t + 8) - m.posAt(t - 8)) / 16)
      const p = halt()
      start({ ...glideCurve(p, m.to, v, 520), to: m.to, skippable: false, onDone: m.onDone })
      return true
    },
    glide: (t) => {
      setShown(null)
      releaseWinner()
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
    },
    clear: () => {
      setShown(null)
      releaseWinner()
    },
    // the engine reads refs; a fresh handle each render is fine
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }))

  useEffect(
    () => () => {
      const m = live.current
      if (m) {
        clearTimeout(m.timer)
        m.anim.cancel()
        live.current = null
      }
      cancelAnimationFrame(raf.current)
      raf.current = 0
    },
    [],
  )

  // the winner's place stays put while the dimming fades out, so the clear window doesn't jump
  if (shown) dimAt.current = shown.offset
  const landed = strip.win >= 0 && !!shown
  const big = shown && (shown.rarity === 'legendary' || shown.rarity === 'epic') ? shown : null

  return (
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
  )
}

/** The reel's height for a tile width (the page lays out the stack with it). */
export const reelHeight = (tileW: number) => Math.round(tileW * 1.2) + Math.round(tileW * 0.15) * 2

/** One loot tile. The reel engine drives its scale; `win` only rings it, and the face underneath never re-renders for that. */
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

/** Behind a big pull: a halo, and for a legendary a slow turn of soft rays. Drawn behind the reel frame. */
export function Burst({ rarity, x, y = 0, reelH, tileW }: { rarity: Rarity; x: number; y?: number; reelH: number; tileW: number }) {
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
      style={{ x, y, width: 0, height: 0 }}
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
export function Sparkles({ rarity, x, y = 0, tileW, tileH }: { rarity: Rarity; x: number; y?: number; tileW: number; tileH: number }) {
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
    <motion.div className="pointer-events-none absolute left-1/2 top-1/2 z-10" style={{ x, y, width: 0, height: 0 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
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
