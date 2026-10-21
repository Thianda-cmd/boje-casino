import { useEffect } from 'react'
import { motion, useAnimate } from 'framer-motion'
import { useUid } from '../../art/ids'
import type { ThrowerId } from './rules'

/*
  A dart, and its flight into the board.

  The dart is drawn in the board's millimetres with its tip at the origin, seen from the oche a little below and to
  the right: the steel point in the board, the knurled tungsten barrel, the shaft and the flight falling away down
  and to the right, nearer the eye and so larger. Its shadow falls on the board below it (the lamp is above). The
  flights are the thrower's colours. Each of the three sits at its own slight angle, so a tight group fans out as
  real darts do (each one glances off the ones already in).

  A flight in: the dart leaves the hand near the eye (big, low and right of the board) and flies away into the
  exact point the round drew for it. Its depth grows evenly with time, so it shrinks as it goes and seems to slow
  (true perspective: the screen position is the world position over the depth); it rises a little and drops into
  the board, wobbling as a thrown dart does, then thuds in and quivers. The page times the landing itself (the
  thud, the call, the score), so the dart only has to look right.
*/

export const FLIGHTS: Record<ThrowerId, { a: string; b: string; edge: string; mark: string }> = {
  pro: { a: '#ffe08a', b: '#d79a1c', edge: '#6b4300', mark: '#2a1c00' },
  regular: { a: '#ff6b7f', b: '#c4142f', edge: '#5c0a17', mark: '#ffffff' },
  wild: { a: '#c4b0ff', b: '#7a4ff0', edge: '#2d1670', mark: '#ffffff' },
}

/** the dart's drawing box around its tip, mm */
const BOX = { x: -7, y: -6, w: 50, h: 76 }
/** the dart is drawn a little larger than life, so it reads at a glance on a small board */
const BIG = 1.3
const TURN = -24

function DartArt({ thrower, tilt = 0 }: { thrower: ThrowerId; tilt?: number }) {
  const u = useUid()
  const c = FLIGHTS[thrower]
  const wing = 'M0 34 L-12.5 46.5 C-13.4 50.5 -12.2 55 -9.5 58.2 L0 53.4Z'
  const silhouette = `${wing} M0 34 L12.5 46.5 C13.4 50.5 12.2 55 9.5 58.2 L0 53.4Z M-3.2 10 H3.2 V38 H-3.2Z M-.6 0 H.6 L1 10 H-1Z`
  return (
    <svg viewBox={`${BOX.x} ${BOX.y} ${BOX.w} ${BOX.h}`} className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${u}steel`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#6d737c" />
          <stop offset=".45" stopColor="#f4f7fa" />
          <stop offset="1" stopColor="#7b828c" />
        </linearGradient>
        <linearGradient id={`${u}tung`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2a2d33" />
          <stop offset=".32" stopColor="#c6ccd4" />
          <stop offset=".5" stopColor="#8d949e" />
          <stop offset="1" stopColor="#25282d" />
        </linearGradient>
        <linearGradient id={`${u}shaft`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0f1013" />
          <stop offset=".4" stopColor="#4a4f59" />
          <stop offset="1" stopColor="#0f1013" />
        </linearGradient>
        <linearGradient id={`${u}l`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={c.a} />
          <stop offset="1" stopColor={c.b} />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.b} />
          <stop offset="1" stopColor={c.edge} />
        </linearGradient>
        <filter id={`${u}blur`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
      </defs>
      {/* the shadow on the board: the far end of the dart throws it further */}
      <g transform={`translate(2.5 5) rotate(${TURN + tilt}) scale(1.06 1.1)`} filter={`url(#${u}blur)`} opacity=".42">
        <path d={silhouette} fill="#000" />
      </g>
      <g transform={`rotate(${TURN + tilt})`}>
        {/* the point */}
        <path d="M-.28 0 L.28 0 L1.05 10.4 H-1.05Z" fill={`url(#${u}steel)`} />
        {/* the barrel, knurled, with the light down one side */}
        <path d="M-1.3 9.6 C-2.8 11 -3.25 12.6 -3.25 14.2 V24.6 C-3.25 26.1 -2.5 27.1 -1.7 27.7 H1.7 C2.5 27.1 3.25 26.1 3.25 24.6 V14.2 C3.25 12.6 2.8 11 1.3 9.6Z" fill={`url(#${u}tung)`} stroke="#0d0e12" strokeWidth=".45" />
        {[15.4, 17.3, 19.2, 21.1, 23].map((y) => (
          <path key={y} d={`M-3.1 ${y} H3.1`} stroke="#0d0e12" strokeOpacity=".75" strokeWidth=".75" />
        ))}
        <path d="M-1.5 12 V25.5" stroke="#fff" strokeOpacity=".6" strokeWidth=".8" strokeLinecap="round" />
        {/* the shaft */}
        <rect x="-1.25" y="27.4" width="2.5" height="11.5" rx="1.1" fill={`url(#${u}shaft)`} />
        {/* the flight: the wing toward the light, the wing away from it, and the third seen edge on */}
        <path d={wing} fill={`url(#${u}l)`} stroke={c.edge} strokeWidth=".75" strokeLinejoin="round" />
        <path d="M0 34 L12.5 46.5 C13.4 50.5 12.2 55 9.5 58.2 L0 53.4Z" fill={`url(#${u}r)`} stroke={c.edge} strokeWidth=".75" strokeLinejoin="round" />
        <path d="M-3.2 42.5 L-8.6 48.2 M3.2 42.5 L8.6 48.2" stroke={c.mark} strokeOpacity=".85" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M-.85 35.5 V55.6 H.85 V35.5Z" fill={c.edge} />
        <path d="M-.6 36.5 L-11.2 47.4" stroke="#fff" strokeOpacity=".45" strokeWidth=".6" strokeLinecap="round" />
      </g>
    </svg>
  )
}

export interface Flight {
  /** where the dart leaves the hand, px from the board's centre */
  fromX: number
  fromY: number
  /** how long it is in the air (ms) */
  ms: number
}

/** how big the dart is as it leaves the hand, against its size in the board */
const NEAR = 3.4
const STEPS = 14

/** the screen path of a flight, as keyframes relative to the landing point (px) */
function path(f: Flight, tipX: number, tipY: number) {
  const z0 = 1 / NEAR
  const arc = Math.min(120, Math.hypot(f.fromX - tipX, f.fromY - tipY) * 0.16)
  const xs: number[] = []
  const ys: number[] = []
  const ss: number[] = []
  const rs: number[] = []
  const times: number[] = []
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS
    const z = z0 + (1 - z0) * t
    // the world position, from the hand (at the near depth) to the board, lifted along the way
    const wx = f.fromX * z0 + (tipX - f.fromX * z0) * t
    const wy = f.fromY * z0 + (tipY - f.fromY * z0) * t - arc * 4 * t * (1 - t) * z
    xs.push(wx / z - tipX)
    ys.push(wy / z - tipY)
    ss.push(1 / z)
    rs.push(-16 * (1 - t) ** 2 + Math.sin(t * Math.PI * 3.5) * 7 * (1 - t))
    times.push(t)
  }
  xs[STEPS] = 0
  ys[STEPS] = 0
  ss[STEPS] = 1
  rs[STEPS] = 0
  return { xs, ys, ss, rs, times }
}

/**
 * A dart in the board at (x, y) mm, `k` px per mm, placed in the board's frame (its centre at the parent's origin).
 * With a flight it flies in first.
 */
export function DartSprite({ k, x, y, thrower, flight, tilt = 0 }: { k: number; x: number; y: number; thrower: ThrowerId; flight: Flight | null; tilt?: number }) {
  const [scope, animate] = useAnimate<HTMLDivElement>()
  const tipX = x * k
  const tipY = -y * k
  useEffect(() => {
    if (!flight) return
    let on = true
    const p = path(flight, tipX, tipY)
    void (async () => {
      await animate(scope.current, { x: p.xs, y: p.ys, scale: p.ss, rotate: p.rs, opacity: [0, 1, 1] }, { duration: flight.ms / 1000, ease: 'linear', times: p.times, opacity: { duration: flight.ms / 1000, times: [0, 0.12, 1] } })
      if (!on) return
      // the thud: a squash into the board, then the quiver
      await animate(scope.current, { rotate: [0, 4, -3, 2, -1.2, 0.5, 0], scale: [1, 0.95, 1.01, 1] }, { duration: 0.45, ease: 'easeOut' })
    })()
    return () => {
      on = false
    }
    // a dart flies once, when it is first shown
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <motion.div
      ref={scope}
      className="pointer-events-none absolute"
      style={{ left: tipX, top: tipY, width: 0, height: 0, originX: 0, originY: 0, opacity: flight ? 0 : 1 }}
      exit={{ opacity: 0, scale: 1.5, x: 30 * k, y: 38 * k, transition: { duration: 0.22, ease: 'easeIn' } }}
    >
      <div className="absolute" style={{ left: BOX.x * k * BIG, top: BOX.y * k * BIG, width: BOX.w * k * BIG, height: BOX.h * k * BIG }}>
        <DartArt thrower={thrower} tilt={tilt} />
      </div>
    </motion.div>
  )
}

/** a dart standing on its own (for the panel and the info sheet), `size` px tall */
export function DartGlyph({ thrower, size }: { thrower: ThrowerId; size: number }) {
  return (
    <span className="relative inline-block" style={{ width: (size * BOX.w) / BOX.h, height: size }}>
      <DartArt thrower={thrower} />
    </span>
  )
}
