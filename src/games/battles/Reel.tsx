import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { rand, randInt } from '../../lib/rng'
import { casesSfx } from '../cases/sound'
import { keyframes, spinCurve } from '../cases/reel'
import { CRATES, RARITY, buildStrip, fillers, type Tile } from '../cases/rules'
import { TileFace } from '../cases/tiles'
import { itemOfMult, roundLand, roundStart } from './engine'
import type { BattleView } from './types'
import type { Clock } from './useBattle'

/*
  One seat's reel: a column of loot falling past a marker. Every seat's reel pushes off at the round's start on the
  server clock and comes to rest on that seat's item when the round lands, so everyone at the battle sees the same
  spin at the same moment. Like the Cases reel it is one Web Animation of transform only; the animation's clock is set
  from the server time, so a page that opens mid-spin picks the spin up where it is, and a reload lands where it would
  have. The strip is built around the drawn item: the tiles on screen stay, fillers from the round's crate follow, and
  the winner sits a little off the marker so every stop lands somewhere new.
*/

/** the strip's transform for a position: tile `pos` centred on the marker (the strip's bottom edge sits there) */
const tf = (pos: number, n: number) => `translate3d(0,${(((pos + 0.5) / n) * 100).toFixed(4)}%,0)`

interface Strip {
  tiles: Tile[]
  win: number
  round: number
  /** where the reel rests once this strip's spin is done */
  end: number
}

export const Reel = memo(function Reel({
  battle,
  seat,
  clock,
  round,
  landed,
  width,
  tileW,
  height,
  ticks,
  idle,
}: {
  battle: BattleView
  seat: number
  clock: Clock
  /** the round on screen, or -1 before the first */
  round: number
  /** the round on screen has come to rest */
  landed: boolean
  width: number
  tileW: number
  height: number
  /** this reel drives the tick sound (one per battle) */
  ticks: boolean
  /** an empty seat, or the battle hasn't started: a still strip of the first crate */
  idle: boolean
}) {
  const tileH = Math.round(tileW * 0.92)
  const gap = Math.round(tileW * 0.08)
  const pitch = tileH + gap

  const [strip, setStrip] = useState<Strip>(() => ({ tiles: fillers(CRATES[battle.cases[0] ?? 'low'], 9), win: -1, round: -1, end: 4 }))
  const stripRef = useRef(strip)
  stripRef.current = strip
  const el = useRef<HTMLDivElement>(null)
  const anim = useRef<Animation | null>(null)
  const pos = useRef(4)
  const curve = useRef<{ posAt: (t: number) => number; t0: number } | null>(null)
  const raf = useRef(0)
  const lastIdx = useRef(0)
  const ticksRef = useRef(ticks)
  ticksRef.current = ticks
  const geo = useRef({ height, pitch })
  geo.current = { height, pitch }

  // a new round: build its strip around this seat's item, starting from the tiles on screen
  const mult = battle.results?.[seat - 1]?.[round]
  useEffect(() => {
    if (idle || round < 0 || mult == null || strip.round === round) return
    const tier = battle.cases[round]
    const crate = CRATES[tier]
    const winner = itemOfMult(tier, mult)
    const from = currentPos()
    stopAnim(from)
    const tiles = stripRef.current.tiles
    const c = Math.round(from)
    const K = Math.ceil(geo.current.height / 2 / geo.current.pitch) + 1
    const lo = Math.max(0, c - K)
    const keep = tiles.slice(lo, c + K + 1)
    const at = c - lo
    const built = buildStrip(crate, keep, at, Math.max(K + 3, 24 + randInt(6)), winner, K + 2)
    const startPos = at + (from - c)
    pos.current = startPos
    setStrip({ tiles: built.tiles, win: built.win, round, end: built.win + (rand() * 2 - 1) * 0.28 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, mult, idle])

  /** where the reel is right now */
  const currentPos = () => {
    const c = curve.current
    const a = anim.current
    if (!c || !a) return pos.current
    return c.posAt(Math.max(0, (a.currentTime as number | null) ?? 0))
  }

  const stopAnim = (at: number) => {
    anim.current?.cancel()
    anim.current = null
    curve.current = null
    pos.current = at
    if (el.current) el.current.style.transform = tf(at, stripRef.current.tiles.length)
  }

  const frame = () => {
    const a = anim.current
    const c = curve.current
    if (!a || !c) {
      raf.current = 0
      return
    }
    const t = (a.currentTime as number | null) ?? 0
    if (t > 0) {
      const p = c.posAt(t)
      const idx = Math.floor(p + 0.5)
      if (idx !== lastIdx.current) {
        lastIdx.current = idx
        if (ticksRef.current && !document.hidden) casesSfx.tick(Math.min(1, (Math.abs(c.posAt(t + 8) - c.posAt(t - 8)) * (1000 / 16)) / 22))
      }
    }
    raf.current = requestAnimationFrame(frame)
  }

  // the strip is in the DOM: place it, and run its spin on the server clock (or rest it at its end if that has passed)
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const n = strip.tiles.length
    if (strip.round < 0) {
      node.style.transform = tf(pos.current, n)
      return
    }
    const t0 = roundStart(battle, strip.round)
    const dur = roundLand(battle, strip.round) - t0
    const now = clock.now()
    if (now >= t0 + dur) {
      stopAnim(strip.end)
      return
    }
    const settle = 420
    const c = spinCurve(pos.current, strip.end, { main: (dur - settle) / 1000, settle: settle / 1000, k: 2, ramp: 0.07, overshoot: 0.12 })
    const a = node.animate(keyframes(c, strip.end, (p) => tf(p, n)), { duration: c.dur, easing: 'linear', fill: 'both' })
    // before the round starts the reel holds its first frame; after that it plays from wherever the clock says
    a.currentTime = now - t0
    anim.current = a
    curve.current = { posAt: c.posAt, t0 }
    lastIdx.current = Math.floor(pos.current + 0.5)
    const end = strip.end
    a.finished.then(
      () => {
        if (anim.current !== a) return
        stopAnim(end)
      },
      () => {},
    )
    if (!raf.current) raf.current = requestAnimationFrame(frame)
    // the clock and the battle's times are read once per strip
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strip])

  useEffect(
    () => () => {
      anim.current?.cancel()
      anim.current = null
      cancelAnimationFrame(raf.current)
      raf.current = 0
    },
    [],
  )

  const showWin = landed && strip.round === round && strip.win >= 0
  const win = showWin ? strip.tiles[strip.win] : null
  const color = win ? RARITY[CRATES[win.tier].items[win.item].rarity].color : '#ffd36a'
  const n = strip.tiles.length
  const left = (width - tileW) / 2
  // the clear window over the winner, so everything else sinks into the dark once the reel rests
  const half = tileH / 2 + 3
  const dimOff = (strip.end - strip.win) * pitch

  return (
    <div className="relative overflow-hidden rounded-xl bg-[#08131c] shadow-[inset_0_2px_14px_rgba(0,0,0,.65)] ring-1 ring-white/[.06]" style={{ width, height }}>
      {/* a soft light behind the marker */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2" style={{ height: pitch * 1.5, background: 'radial-gradient(closest-side, rgba(150,190,230,.12), rgba(150,190,230,0))' }} />
      <div ref={el} className="absolute will-change-transform" style={{ left, width: tileW, top: `calc(50% - ${n * pitch}px)`, height: n * pitch, opacity: idle ? 0.4 : 1, transition: 'opacity .4s' }}>
        {strip.tiles.map((t, i) => (
          <div
            key={t.id}
            className="absolute left-0"
            style={{
              bottom: i * pitch + gap / 2,
              width: tileW,
              height: tileH,
              transform: showWin && i === strip.win ? 'scale(1.07)' : undefined,
              transition: 'transform .45s cubic-bezier(.2,.9,.25,1)',
            }}
          >
            <TileFace tile={t} w={tileW} h={tileH} />
            {showWin && i === strip.win && <div className="pointer-events-none absolute inset-0" style={{ borderRadius: Math.round(tileW * 0.11), boxShadow: `inset 0 0 0 2px ${color}, 0 0 22px -4px ${color}` }} />}
          </div>
        ))}
      </div>
      <div
        className="pointer-events-none absolute inset-0 transition-opacity"
        style={{
          opacity: showWin ? 1 : 0,
          transitionDuration: showWin ? '500ms' : '150ms',
          background: `linear-gradient(180deg, rgba(8,19,28,.62) 0, rgba(8,19,28,.62) calc(50% + ${(dimOff - half - 2).toFixed(1)}px), rgba(8,19,28,0) calc(50% + ${(dimOff - half + 1).toFixed(1)}px), rgba(8,19,28,0) calc(50% + ${(dimOff + half - 1).toFixed(1)}px), rgba(8,19,28,.62) calc(50% + ${(dimOff + half + 2).toFixed(1)}px), rgba(8,19,28,.62) 100%)`,
        }}
      />
      {/* the ends fade into the frame */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[22%] bg-gradient-to-b from-[#08131c] to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[22%] bg-gradient-to-t from-[#08131c] to-transparent" />
      <Marker color={color} />
    </div>
  )
})

/** The marker: a fine line across the middle with a notch at each side. */
function Marker({ color }: { color: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
      <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 transition-colors duration-500" style={{ background: `linear-gradient(90deg, ${color} 0%, ${color}00 18%, ${color}00 82%, ${color} 100%)` }} />
      <svg className="absolute left-0 top-1/2 -translate-y-1/2" width="9" height="14" viewBox="0 0 10 16" aria-hidden>
        <path d="M0 1v14L9.5 8Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
      <svg className="absolute right-0 top-1/2 -translate-y-1/2" width="9" height="14" viewBox="0 0 10 16" aria-hidden>
        <path d="M10 1v14L.5 8Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
    </div>
  )
}
