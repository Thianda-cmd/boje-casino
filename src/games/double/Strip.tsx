import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { doubleSfx } from './sound'
import { useSize } from '../../lib/useSize'
import { keyframes, spinCurve, type Curve } from '../cases/reel'
import { TONE, Tile } from './art'
import { COLORS, WHEEL, colorOf } from './rules'

/*
  The strip: an endless row of the 33 tiles sliding under a fixed marker. Every browser spins it at the round's start
  on the server clock and lands it at the round's end, from where the last round left it onto a spot inside the
  winning tile that only depends on the round id, so everyone sees the same spin land at the same moment. Like the
  Cases reel it is one Web Animation of transform only, whose clock is set from the server time: a page opened (or
  reloaded) mid-spin picks the spin up where it is. If the roll reaches a page that was watching the strip rest only
  after the spin should have started (a slow answer), the strip sets off from rest then and still lands on time, so it
  never jumps. A soft tick sounds for every tile that passes the marker.
*/

export interface Spin {
  id: number
  roll: number
  /** strip positions in tiles: tile g sits at g, and the marker reads tile WHEEL[g mod 33] */
  from: number
  to: number
  startsAt: number
  endsAt: number
}

const wheelAt = (g: number) => WHEEL[((g % 33) + 33) % 33]
// the spin's motion: a quick push, then a long fall in speed and a small settle back inside the winning tile
const SETTLE_MS = 520
const SHAPE = { k: 2.2, ramp: 0.05, overshoot: 0.1 }

export const Strip = memo(function Strip({
  spin,
  rest,
  betting,
  clock,
  landed,
  sound,
}: {
  /** this round's spin, once its roll is out; null while betting */
  spin: Spin | null
  /** where the strip rests when there is no spin */
  rest: number
  /** the round taking bets while the strip rests (null otherwise) */
  betting: number | null
  clock: () => number
  /** the spin has landed: light the winner */
  landed: boolean
  sound: boolean
}) {
  const [box, size] = useSize<HTMLDivElement>({ w: 900, h: 120 })
  const w = size.w
  const small = w < 560
  const tile = small ? 58 : 84
  const gap = small ? 6 : 8
  const pitch = tile + gap
  const padY = small ? 11 : 15
  const half = Math.ceil(w / pitch / 2) + 2
  const lo = Math.floor((spin ? Math.min(spin.from, spin.to) : rest) - half)
  const hi = Math.ceil((spin ? Math.max(spin.from, spin.to) : rest) + half)
  const xOf = (p: number) => w / 2 - p * pitch - tile / 2

  const el = useRef<HTMLDivElement>(null)
  const anim = useRef<Animation | null>(null)
  const curve = useRef<Curve | null>(null)
  const raf = useRef(0)
  const lastIdx = useRef(0)
  const soundRef = useRef(sound)
  /** the spins this page saw from before their last moments, which get the landing sound */
  const seen = useRef(new Map<number, boolean>())
  /** when this page set each spin off: its start on the server clock, or later if the roll came in late */
  const setOff = useRef(new Map<number, number>())
  /** the round whose betting this page showed with the strip at rest */
  const watched = useRef<number | null>(null)
  soundRef.current = sound

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
        if (soundRef.current && !document.hidden) doubleSfx.tick(Math.min(1, (Math.abs(c.posAt(t + 8) - c.posAt(t - 8)) * (1000 / 16)) / 40))
      }
    }
    raf.current = requestAnimationFrame(frame)
  }

  // place the strip, and run the spin on the server clock (or rest it at its end if that has passed)
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    anim.current?.cancel()
    anim.current = null
    curve.current = null
    const place = (p: number) => (node.style.transform = `translate3d(${xOf(p).toFixed(2)}px,0,0)`)
    if (!spin) {
      if (betting != null) watched.current = betting
      return void place(rest)
    }
    const now = clock()
    if (now >= spin.endsAt || !node.animate) return void place(spin.to)
    let t0 = setOff.current.get(spin.id)
    if (t0 == null) {
      // the roll came in after the spin should have started (a slow answer) while this page watched the strip rest:
      // set off from rest now and land on time, rather than jump ahead. A page opened mid-spin picks it up instead.
      t0 = watched.current === spin.id && now > spin.startsAt + 50 && spin.endsAt - now >= 1800 ? now : spin.startsAt
      setOff.current.set(spin.id, t0)
      if (setOff.current.size > 8) setOff.current.delete(setOff.current.keys().next().value!)
    }
    const dur = spin.endsAt - t0
    const c = spinCurve(spin.from, spin.to, { main: (dur - SETTLE_MS) / 1000, settle: SETTLE_MS / 1000, ...SHAPE })
    const a = node.animate(
      keyframes(c, spin.to, (p) => `translate3d(${xOf(p).toFixed(2)}px,0,0)`),
      { duration: c.dur, easing: 'linear', fill: 'both' },
    )
    // before the start the strip holds its first frame; after that it plays from wherever the clock says
    a.currentTime = now - t0
    anim.current = a
    curve.current = c
    lastIdx.current = Math.floor(c.posAt(Math.max(0, now - t0)) + 0.5)
    if (!seen.current.has(spin.id)) seen.current.set(spin.id, now < spin.endsAt - 400)
    const live = seen.current.get(spin.id)!
    if (seen.current.size > 8) seen.current.delete(seen.current.keys().next().value!)
    a.finished.then(
      () => {
        if (anim.current !== a) return
        place(spin.to)
        a.cancel()
        anim.current = null
        curve.current = null
        if (live && soundRef.current && !document.hidden) doubleSfx.land(COLORS.indexOf(colorOf(spin.roll)))
      },
      () => {},
    )
    if (!raf.current) raf.current = requestAnimationFrame(frame)
    // the clock is read once per spin; a resize rebuilds the same spin at the new size
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin, spin ? null : rest, spin ? null : betting, w, tile])

  useEffect(
    () => () => {
      anim.current?.cancel()
      anim.current = null
      cancelAnimationFrame(raf.current)
      raf.current = 0
    },
    [],
  )

  const win = spin && landed ? Math.round(spin.to) : null
  const winColor = spin ? colorOf(spin.roll) : null
  const glow = winColor ? TONE[winColor].glow : '#f7c548'
  // the clear window over the winner, so everything else sinks into the dark once the strip rests
  const off = win != null ? (win - spin!.to) * pitch : 0
  const halfW = tile / 2 + 3
  const tiles = []
  for (let g = lo; g <= hi; g++) {
    const roll = wheelAt(g)
    const isWin = g === win
    tiles.push(
      <div
        key={g}
        className="absolute top-0"
        style={{
          left: g * pitch,
          transform: isWin ? 'scale(1.08)' : undefined,
          transition: 'transform .5s cubic-bezier(.2,.9,.25,1)',
          zIndex: isWin ? 1 : undefined,
        }}
      >
        <Tile roll={roll} size={tile} />
        {isWin && <div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ borderRadius: Math.round(tile * 0.2), boxShadow: `0 0 0 2px #fff, 0 0 26px 2px ${glow}` }} />}
      </div>,
    )
  }

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-2xl bg-[#08111a] ring-1 ring-white/[.06] transition-shadow duration-700"
      style={{
        height: tile + padY * 2,
        boxShadow: win != null ? `inset 0 2px 18px rgba(0,0,0,.7), 0 0 0 1px ${glow}55, 0 0 ${winColor === 'green' ? 60 : 34}px -10px ${glow}` : 'inset 0 2px 18px rgba(0,0,0,.7)',
      }}
    >
      {/* a soft light along the strip and behind the marker */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,.035),transparent_40%,rgba(0,0,0,.25))]" />
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-[240px] -translate-x-1/2 bg-[radial-gradient(closest-side,rgba(247,197,72,.13),transparent)]" />
      <div
        className="absolute inset-0"
        style={{ maskImage: 'linear-gradient(90deg,transparent 0,#000 11%,#000 89%,transparent 100%)', WebkitMaskImage: 'linear-gradient(90deg,transparent 0,#000 11%,#000 89%,transparent 100%)' }}
      >
        <div ref={el} data-double-strip className="absolute left-0 will-change-transform" style={{ top: padY, height: tile, width: 1 }}>
          {tiles}
        </div>
      </div>
      {/* everything but the winner dims once the strip rests */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity"
        style={{
          opacity: win != null ? 1 : 0,
          transitionDuration: win != null ? '600ms' : '200ms',
          background: `linear-gradient(90deg, rgba(8,17,26,.62) 0, rgba(8,17,26,.62) calc(50% + ${(off - halfW - 2).toFixed(1)}px), rgba(8,17,26,0) calc(50% + ${(off - halfW + 1).toFixed(1)}px), rgba(8,17,26,0) calc(50% + ${(off + halfW - 1).toFixed(1)}px), rgba(8,17,26,.62) calc(50% + ${(off + halfW + 2).toFixed(1)}px), rgba(8,17,26,.62) 100%)`,
        }}
      />
      <Marker small={small} color={landed && winColor ? glow : '#f7c548'} />
    </div>
  )
})

/** The marker: a fine gold needle across the strip with a notch at each end. */
function Marker({ small, color }: { small: boolean; color: string }) {
  const nw = small ? 14 : 18
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2" style={{ width: nw }}>
      <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full transition-colors duration-500" style={{ background: color, boxShadow: `0 0 10px ${color}, 0 0 2px ${color}` }} />
      <svg className="absolute left-0 top-0" width={nw} height={nw * 0.7} viewBox="0 0 18 12.6" aria-hidden style={{ filter: 'drop-shadow(0 2px 3px rgba(0,0,0,.5))' }}>
        <path d="M1 0h16L9 12.6Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
      <svg className="absolute bottom-0 left-0" width={nw} height={nw * 0.7} viewBox="0 0 18 12.6" aria-hidden style={{ filter: 'drop-shadow(0 -2px 3px rgba(0,0,0,.5))' }}>
        <path d="M1 12.6h16L9 0Z" fill={color} style={{ transition: 'fill .5s' }} />
      </svg>
    </div>
  )
}
