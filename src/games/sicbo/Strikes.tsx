import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useUid } from '../../art/ids'

/*
  The lucky strikes' golden lightning, drawn over the whole stage: a jagged bolt from the top of the room down onto
  a struck spot, with a branch or two, a white-hot core in a gold glow, a flicker, and a burst where it lands. The
  bigger the multiplier, the thicker the bolt and the bigger the burst (the stage's own flash and shake are the
  screen's). Each bolt's shape comes from its id, so a re-render never reshapes it.
*/

export interface StrikeFx {
  id: number
  /** where it lands, stage px */
  x: number
  y: number
  mult: number
  turbo: boolean
}

/** a small seeded random source, so a bolt keeps its shape */
function seeded(seed: number) {
  let a = (seed * 2654435761) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a jagged line from a to b: midpoints pushed sideways, less at each finer level */
function jag(ax: number, ay: number, bx: number, by: number, rough: number, depth: number, rnd: () => number): [number, number][] {
  let pts: [number, number][] = [
    [ax, ay],
    [bx, by],
  ]
  let amp = rough
  for (let d = 0; d < depth; d++) {
    const next: [number, number][] = [pts[0]]
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1]
      const [x1, y1] = pts[i]
      const len = Math.hypot(x1 - x0, y1 - y0) || 1
      const off = (rnd() - 0.5) * amp * len
      next.push([(x0 + x1) / 2 + (-(y1 - y0) / len) * off, (y0 + y1) / 2 + ((x1 - x0) / len) * off], pts[i])
    }
    pts = next
    amp *= 0.62
  }
  return pts
}

const toPath = (pts: readonly [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')

function boltShape(fx: StrikeFx) {
  const rnd = seeded(fx.id * 97 + 13)
  // from high in the room, leaning in from the side the spot is on
  const x0 = fx.x + (rnd() - 0.5) * 160
  const y0 = -12
  const main = jag(x0, y0, fx.x, fx.y, 0.42, 6, rnd)
  const branches: string[] = []
  const n = fx.mult >= 10 ? 3 : 2
  for (let b = 0; b < n; b++) {
    const i = Math.floor(main.length * (0.25 + rnd() * 0.45))
    const [sx, sy] = main[i]
    const len = Math.hypot(fx.x - x0, fx.y - y0) * (0.14 + rnd() * 0.14)
    const ang = Math.PI / 2 + (rnd() < 0.5 ? -1 : 1) * (0.5 + rnd() * 0.6)
    branches.push(toPath(jag(sx, sy, sx + Math.cos(ang) * len, sy + Math.sin(ang) * len, 0.5, 4, rnd)))
  }
  const sparks = Array.from({ length: fx.mult >= 10 ? 9 : 6 }, (_, i) => {
    const a = (i / (fx.mult >= 10 ? 9 : 6)) * Math.PI * 2 + rnd() * 0.5
    return { a, r: 0.6 + rnd() * 0.5 }
  })
  return { main: toPath(main), branches, sparks }
}

const Bolt = memo(function Bolt({ fx }: { fx: StrikeFx }) {
  const u = useUid()
  const { main, branches, sparks } = boltShape(fx)
  const big = fx.mult >= 10
  const huge = fx.mult >= 20
  const w = huge ? 1.6 : big ? 1.3 : 1
  const d = fx.turbo ? 0.6 : 1
  const burst = (huge ? 90 : big ? 70 : 52) * (fx.turbo ? 0.8 : 1)
  return (
    <g>
      {/* the room lights up for an instant */}
      <motion.rect width="100%" height="100%" fill="#ffe3a0" initial={{ opacity: huge ? 0.26 : big ? 0.18 : 0.1 }} animate={{ opacity: 0 }} transition={{ duration: 0.4 * d, ease: 'easeOut' }} />
      <motion.g initial={{ opacity: 1 }} animate={{ opacity: [1, 0.35, 1, 0.75, 0] }} transition={{ duration: 0.6 * d, times: [0, 0.18, 0.3, 0.55, 1], delay: 0.08 * d }}>
        <defs>
          <filter id={`${u}b`} x="-50%" y="-10%" width="200%" height="120%">
            <feGaussianBlur stdDeviation={6 * w} />
          </filter>
          <radialGradient id={`${u}r`}>
            <stop offset="0" stopColor="#fffbe6" stopOpacity="1" />
            <stop offset=".35" stopColor="#ffd45c" stopOpacity=".75" />
            <stop offset="1" stopColor="#ff9a1f" stopOpacity="0" />
          </radialGradient>
        </defs>
        {/* the glow, the gold, the white-hot core; drawn on from the top */}
        {[
          { sw: 16 * w, c: '#ffc23a', o: 0.5, f: true },
          { sw: 5 * w, c: '#ffd85e', o: 1, f: false },
          { sw: 1.8 * w, c: '#fffdf0', o: 1, f: false },
        ].map((l, i) => (
          <g key={i} filter={l.f ? `url(#${u}b)` : undefined}>
            <motion.path
              d={main}
              fill="none"
              stroke={l.c}
              strokeOpacity={l.o}
              strokeWidth={l.sw}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.09 * d, ease: 'easeOut' }}
            />
            {branches.map((b, j) => (
              <motion.path
                key={j}
                d={b}
                fill="none"
                stroke={l.c}
                strokeOpacity={l.o * 0.85}
                strokeWidth={l.sw * 0.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.07 * d, delay: 0.05 * d, ease: 'easeOut' }}
              />
            ))}
          </g>
        ))}
        {/* the burst where it lands */}
        <motion.circle
          cx={fx.x}
          cy={fx.y}
          fill={`url(#${u}r)`}
          initial={{ r: 0, opacity: 1 }}
          animate={{ r: burst, opacity: 0 }}
          transition={{ duration: 0.5 * d, delay: 0.08 * d, ease: 'easeOut' }}
        />
        {sparks.map((s, i) => (
          <motion.line
            key={i}
            x1={fx.x}
            y1={fx.y}
            stroke="#fff1a8"
            strokeWidth={2 * w}
            strokeLinecap="round"
            initial={{ x2: fx.x, y2: fx.y, opacity: 1 }}
            animate={{ x2: fx.x + Math.cos(s.a) * burst * s.r, y2: fx.y + Math.sin(s.a) * burst * s.r, opacity: 0 }}
            transition={{ duration: 0.42 * d, delay: 0.1 * d, ease: 'easeOut' }}
          />
        ))}
      </motion.g>
    </g>
  )
})

export function Strikes({ fx }: { fx: readonly StrikeFx[] }) {
  return (
    <svg className="pointer-events-none absolute inset-0 z-[26] h-full w-full overflow-visible" aria-hidden>
      <AnimatePresence>
        {fx.map((f) => (
          <Bolt key={f.id} fx={f} />
        ))}
      </AnimatePresence>
    </svg>
  )
}
