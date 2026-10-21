import { memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import { R_BULL, R_OUTER_BULL, regionName, type Region, type TargetId } from './rules'
import { EDGE, NUMBER_R, RING, SEGMENTS, SURROUND, WIRE_RINGS, WIRE_SPOKES, aimOf, kindOf, pt, regionPath, targetRegions } from './geom'

/*
  The board and what is drawn on it, as layers of SVG in the board's own millimetres (see geom.ts), each laid over
  the same square centred on the board's centre, `k` pixels to the millimetre:

  - Backdrop: the soft shadow on the wall, the ring light round the board (its glow takes the colour of the moment:
    cool white at rest, green for a win, gold for a big one, a chase of gold for the 180) and the dark foam surround
    with its red rim.
  - BoardFace: the regulation board itself, to scale from the rules' radii: black and cream singles, red and green
    trebles and doubles (the 20's are red), the 25 and the bull, a sisal grain over it all, the wire spider with its
    highlight and shadow, the numbers upright round the black ring, and the light of the lamp above. Drawn once.
  - AimLayer: where the thrower aims: the target's bed lit gold, a soft cloud as wide as the thrower's scatter (its
    dashed ring holds about 86% of darts), and the aim mark at its centre.
  - HitLayer: a dart going in: its bed flashes, a ring goes out from where it stuck and its call pops up there.
*/

/** how far each layer's square reaches from the centre (mm) */
export const VIEW = 300
const box = `${-VIEW} ${-VIEW} ${2 * VIEW} ${2 * VIEW}`

export type Glow = 'idle' | 'win' | 'big' | 'max' | 'lose'
const GLOW: Record<Glow, string> = { idle: '#dfeaff', win: '#2ee87f', big: '#ffd45c', max: '#ffd45c', lose: '#ff5a6e' }

/** an SVG layer the size of the board's square, `k` px per mm, centred on the parent's origin */
function Layer({ k, children, className = '' }: { k: number; children: React.ReactNode; className?: string }) {
  const s = 2 * VIEW * k
  return (
    <svg viewBox={box} width={s} height={s} className={`pointer-events-none absolute ${className}`} style={{ left: -s / 2, top: -s / 2 }} aria-hidden>
      {children}
    </svg>
  )
}

export const Backdrop = memo(function Backdrop({ k, glow }: { k: number; glow: Glow }) {
  const u = useUid()
  return (
    <Layer k={k}>
      <defs>
        <radialGradient id={`${u}shade`} cx=".5" cy=".5" r=".5">
          <stop offset=".72" stopColor="#000" stopOpacity=".55" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        {(Object.keys(GLOW) as Glow[]).map((g) => (
          <radialGradient key={g} id={`${u}glow${g}`} cx=".5" cy=".5" r=".5">
            <stop offset={(RING - 30) / VIEW} stopColor={GLOW[g]} stopOpacity="0" />
            <stop offset={RING / VIEW} stopColor={GLOW[g]} stopOpacity={g === 'idle' ? 0.3 : 0.62} />
            <stop offset="1" stopColor={GLOW[g]} stopOpacity="0" />
          </radialGradient>
        ))}
        <radialGradient id={`${u}foam`} cx=".5" cy=".42" r=".55">
          <stop offset="0" stopColor="#24262c" />
          <stop offset=".8" stopColor="#111216" />
          <stop offset="1" stopColor="#08090b" />
        </radialGradient>
        <linearGradient id={`${u}tube`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#e9f0fb" />
          <stop offset="1" stopColor="#b9c4d4" />
        </linearGradient>
      </defs>
      {/* the board's shadow on the wall, under the lamp */}
      <circle cx="0" cy="18" r={VIEW - 4} fill={`url(#${u}shade)`} />
      {/* the ring light's glow, in the colour of the moment */}
      {(Object.keys(GLOW) as Glow[]).map((g) => (
        <circle key={g} r={VIEW} fill={`url(#${u}glow${g})`} style={{ opacity: glow === g ? 1 : 0, transition: 'opacity .5s ease' }} />
      ))}
      {/* the ring light */}
      <circle r={RING} fill="none" stroke="#0a0b0e" strokeWidth="11" />
      <circle r={RING} fill="none" stroke={`url(#${u}tube)`} strokeWidth="5.5" />
      <circle r={RING} fill="none" stroke={GLOW[glow]} strokeWidth="5.5" style={{ opacity: glow === 'idle' ? 0 : 0.8, transition: 'opacity .5s ease, stroke .3s' }} />
      {glow === 'max' && (
        <motion.g animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}>
          <circle r={RING} fill="none" stroke="#fff6cf" strokeWidth="6" strokeDasharray="16 24" strokeLinecap="round" />
        </motion.g>
      )}
      <circle r={RING - 1.6} fill="none" stroke="#fff" strokeOpacity=".7" strokeWidth=".8" />
      {/* the foam surround and its rim */}
      <circle r={SURROUND} fill={`url(#${u}foam)`} />
      <circle r={SURROUND - 1.5} fill="none" stroke="#e8344e" strokeOpacity=".75" strokeWidth="2.2" />
      <path d={`M${pt(SURROUND - 6, -58).join(' ')}A${SURROUND - 6} ${SURROUND - 6} 0 0 1 ${pt(SURROUND - 6, 58).join(' ')}`} fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="5" strokeLinecap="round" />
    </Layer>
  )
})

const SINGLE = ['#1d1c1f', '#ecdcb6']
const BED = ['#d3263a', '#11904f']

export const BoardFace = memo(function BoardFace({ k }: { k: number }) {
  const u = useUid()
  return (
    <Layer k={k}>
      <defs>
        <filter id={`${u}grain`} x="-180" y="-180" width="360" height="360" filterUnits="userSpaceOnUse">
          <feTurbulence type="fractalNoise" baseFrequency=".55" numOctaves="2" seed="7" />
          <feColorMatrix values="0 0 0 0 .5  0 0 0 0 .45  0 0 0 0 .38  0 0 0 .55 -.12" />
          <feComposite in2="SourceGraphic" operator="in" />
        </filter>
        <radialGradient id={`${u}lamp`} cx=".5" cy=".18" r=".85">
          <stop offset="0" stopColor="#fff8e6" stopOpacity=".2" />
          <stop offset=".45" stopColor="#fff8e6" stopOpacity=".05" />
          <stop offset="1" stopColor="#000" stopOpacity=".38" />
        </radialGradient>
        <linearGradient id={`${u}rim`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4e57" />
          <stop offset=".5" stopColor="#1b1d22" />
          <stop offset="1" stopColor="#0c0d10" />
        </linearGradient>
      </defs>
      {/* the black ring and its rim */}
      <circle r={EDGE + 2} fill={`url(#${u}rim)`} />
      <circle r={EDGE - 1} fill="#141416" />
      <circle r={EDGE - 1} fill="none" stroke="#000" strokeOpacity=".6" strokeWidth="2" />
      {/* the beds */}
      {SEGMENTS.map((s) => (
        <g key={s.n}>
          <path d={s.double} fill={BED[s.i % 2]} />
          <path d={s.outer} fill={SINGLE[s.i % 2]} />
          <path d={s.treble} fill={BED[s.i % 2]} />
          <path d={s.inner} fill={SINGLE[s.i % 2]} />
        </g>
      ))}
      <circle r={R_OUTER_BULL} fill={BED[1]} />
      <circle r={R_BULL} fill={BED[0]} />
      {/* the sisal's grain */}
      <circle r="171" fill="#fff" filter={`url(#${u}grain)`} opacity=".9" />
      {/* the spider: a shadow, then the wire, then its highlight */}
      <g fill="none" strokeLinecap="round">
        <g stroke="#000" strokeOpacity=".45" strokeWidth="1.4" transform="translate(.5 .9)">
          <path d={WIRE_SPOKES} />
          {WIRE_RINGS.map((r) => (
            <circle key={r} r={r} />
          ))}
        </g>
        <g stroke="#b7bec7" strokeWidth=".95">
          <path d={WIRE_SPOKES} />
          {WIRE_RINGS.map((r) => (
            <circle key={r} r={r} />
          ))}
        </g>
        <g stroke="#fff" strokeOpacity=".55" strokeWidth=".35" transform="translate(-.2 -.3)">
          <path d={WIRE_SPOKES} />
          {WIRE_RINGS.map((r) => (
            <circle key={r} r={r} />
          ))}
        </g>
      </g>
      {/* the numbers, upright, as on a real board */}
      <g fontFamily="Manrope, system-ui, sans-serif" fontWeight="800" fontSize="25" textAnchor="middle" dominantBaseline="central">
        {SEGMENTS.map((s) => {
          const [x, y] = pt(NUMBER_R, s.i * 18)
          return (
            <g key={s.n}>
              <text x={x + 0.6} y={y + 1.4} fill="#000" opacity=".6">
                {s.n}
              </text>
              <text x={x} y={y} fill="#f1ede4">
                {s.n}
              </text>
            </g>
          )
        })}
      </g>
      {/* the lamp above: brighter at the top, falling away to the foot */}
      <circle r={EDGE + 2} fill={`url(#${u}lamp)`} />
    </Layer>
  )
})

/** where the thrower aims, and how wide they scatter (sigma, mm) */
export function AimLayer({ k, target, sigma, dim }: { k: number; target: TargetId; sigma: number; dim: boolean }) {
  const u = useUid()
  const aim = aimOf(target)
  const spring = { type: 'spring' as const, stiffness: 260, damping: 26 }
  return (
    <Layer k={k}>
      <defs>
        <radialGradient id={`${u}cloud`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff" stopOpacity=".2" />
          <stop offset=".4" stopColor="#fff" stopOpacity=".1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <motion.g animate={{ opacity: dim ? 0.3 : 1 }} transition={{ duration: 0.35 }}>
        {/* the bed aimed at, lit */}
        <AnimatePresence initial={false}>
          <motion.g key={target} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
            {targetRegions(target).map((r) => (
              <path key={r} d={regionPath(r)} fill="#ffd45c" fillOpacity=".22" stroke="#ffd45c" strokeWidth="1.8" strokeLinejoin="round" className="animate-pulse" />
            ))}
          </motion.g>
        </AnimatePresence>
        <motion.g initial={false} animate={{ x: aim.x, y: -aim.y }} transition={spring}>
          {/* the scatter: a soft cloud, and the ring that holds most darts */}
          <motion.circle initial={false} animate={{ r: sigma * 2.6 }} transition={spring} fill={`url(#${u}cloud)`} />
          <motion.circle initial={false} animate={{ r: sigma * 2 }} transition={spring} fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth=".9" strokeDasharray="3.5 3" />
          {/* the aim mark */}
          <circle r="4.2" fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="2.6" />
          <circle r="4.2" fill="none" stroke="#fff" strokeWidth="1.3" />
          <path d="M0 -10V-6.5M0 10V6.5M-10 0H-6.5M10 0H6.5" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" />
          <circle r="1" fill="#fff" />
        </motion.g>
      </motion.g>
    </Layer>
  )
}

export interface Hit {
  key: string
  r: Region
  x: number
  y: number
}
const RING_COLOR = { single: '#ffffff', treble: '#ffd45c', double: '#7dffb3', outer: '#7dffb3', bull: '#ffd45c', miss: '#ff8a96' }
const CALL_COLOR = { single: '#ffffff', treble: '#ffd45c', double: '#8affbe', outer: '#8affbe', bull: '#ff5a6e', miss: '#ff9aa8' }

export function HitLayer({ k, hits }: { k: number; hits: Hit[] }) {
  return (
    <Layer k={k}>
      <AnimatePresence>
        {hits.map((h) => {
          const kind = kindOf(h.r)
          const big = kind === 'treble' || kind === 'bull' || kind === 'double'
          return (
            <g key={h.key}>
              {h.r !== 0 && (
                <motion.path
                  d={regionPath(h.r)}
                  fill="#fff"
                  initial={{ opacity: big ? 0.7 : 0.45 }}
                  animate={{ opacity: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: big ? 0.9 : 0.6, ease: 'easeOut' }}
                />
              )}
              <motion.circle
                cx={h.x}
                cy={-h.y}
                fill="none"
                stroke={RING_COLOR[kind]}
                initial={{ r: 1, opacity: 0.95, strokeWidth: 3 }}
                animate={{ r: big ? 22 : 15, opacity: 0, strokeWidth: 0.5 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.55, ease: 'easeOut' }}
              />
              {/* the call pops up from where it stuck and floats away */}
              <motion.text
                x={h.x}
                y={-h.y - 16}
                textAnchor="middle"
                dominantBaseline="central"
                fontFamily="Manrope, system-ui, sans-serif"
                fontWeight="800"
                fontSize={big ? 19 : 15}
                fill={CALL_COLOR[kind]}
                stroke="#120509"
                strokeWidth="4"
                strokeLinejoin="round"
                paintOrder="stroke"
                initial={{ opacity: 0, y: 6, scale: 0.6 }}
                animate={{ opacity: [0, 1, 1, 0], y: [6, 0, -8, -20], scale: [0.6, 1.15, 1, 1] }}
                transition={{ duration: 0.9, times: [0, 0.18, 0.6, 1], ease: 'easeOut' }}
                style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
              >
                {regionName(h.r)}
              </motion.text>
            </g>
          )
        })}
      </AnimatePresence>
    </Layer>
  )
}
