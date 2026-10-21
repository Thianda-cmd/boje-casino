import { memo, useEffect, useMemo, useRef, type ReactNode, type Ref } from 'react'
import { motion, type MotionValue } from 'framer-motion'
import { Avatar } from '../../art/Avatar'
import { useUid } from '../../art/ids'
import { Jar, JAR_FLOOR, JAR_TOP, levelOf, mix, shade, type Band } from './art'

/*
  The pot's stage piece: the jar in the middle of a ring that shows everyone's tickets. The ring is laid out by
  ticket, in the order paid: each deposit is a sliver as long as its share of the pot, in its player's colour, from
  the top clockwise, with the player's avatar on their biggest sliver. When betting closes the ring turns (its angle
  comes from the clock, clock.ts spinAt, through `rot`) and stops with the winning ticket under the gold pointer at
  the top, so the pointer lands on exactly the ticket the seed drew. Round it, the countdown track empties while
  coins are taken, and a ring of bulbs chases while the wheel turns and flashes in the winner's colour after.
  Everything is drawn in a 600 × 600 box and scales with the page.
*/

export interface Sliver {
  key: string
  colour: string
  amount: number
  avatar: number
  /** the player, so their biggest sliver carries the avatar */
  who: string
  pending?: boolean
}

const C = 300
const R_OUT = 270
const R_IN = 222
const R_MID = (R_OUT + R_IN) / 2
const W = R_OUT - R_IN
const CIRC = 2 * Math.PI * R_MID
const TRACK = 291
export const TRACK_LEN = 2 * Math.PI * TRACK
const BULBS = 40

export type Stage = 'betting' | 'shut' | 'spinning' | 'done' | 'next' | null

export const PotWheel = memo(function PotWheel({
  slivers,
  pot,
  rot,
  stage,
  winner,
  winnerWho = null,
  trackRef,
  pointerRef,
  centre,
  overlay,
}: {
  slivers: Sliver[]
  pot: number
  /** the ring's turn in degrees, set every frame from the clock */
  rot: MotionValue<number>
  stage: Stage
  /** the winning sliver's colour once the wheel has landed */
  winner: string | null
  /** the winner (a sliver's `who`): the other players' slivers dim once the wheel has landed */
  winnerWho?: string | null
  /** the countdown arc: its dash offset is set every frame */
  trackRef: Ref<SVGCircleElement>
  /** the pointer, for the page to flick as the slivers pass it */
  pointerRef?: Ref<SVGGElement>
  /** shown over the jar (the pot label, or the winner) */
  centre?: ReactNode
  /** shown over everything (falling coins, confetti) */
  overlay?: ReactNode
}) {
  const u = useUid() + 'pw'
  const total = slivers.reduce((a, s) => a + Math.round(s.amount * 100), 0)
  const arcs = useMemo(() => {
    let at = 0
    return slivers.map((s) => {
      const len = total ? (Math.round(s.amount * 100) / total) * 360 : 0
      const a = { ...s, from: at, len }
      at += len
      return a
    })
  }, [slivers, total])
  // each player's avatar on their biggest sliver, if it is long enough to hold one
  const faces = useMemo(() => {
    const best = new Map<string, (typeof arcs)[number]>()
    for (const a of arcs) if (!best.has(a.who) || best.get(a.who)!.len < a.len) best.set(a.who, a)
    return [...best.values()].filter((a) => a.len >= 13)
  }, [arcs])
  const bands: Band[] = useMemo(() => slivers.map((s) => ({ key: s.key, colour: s.colour, amount: s.amount, pending: s.pending })), [slivers])
  const spinning = stage === 'spinning'
  const landed = (stage === 'done' || stage === 'next') && winner != null
  const glow = levelOf(pot)
  // the ring turns about the wheel's centre, every frame, straight on the element (no re-render)
  const ring = useRef<SVGGElement>(null)
  useEffect(() => {
    const set = (v: number) => ring.current?.setAttribute('transform', `rotate(${v.toFixed(3)} ${C} ${C})`)
    set(rot.get())
    return rot.on('change', set)
  }, [rot])
  return (
    <div className="relative aspect-square w-full select-none">
      <svg viewBox="0 0 600 600" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
        <defs>
          <radialGradient id={`${u}disc`} cx=".5" cy=".55" r=".55">
            <stop offset="0" stopColor="#1b3346" />
            <stop offset=".7" stopColor="#0c1a25" />
            <stop offset="1" stopColor="#081219" />
          </radialGradient>
          <radialGradient id={`${u}tube`} gradientUnits="userSpaceOnUse" cx={C} cy={C} r={R_OUT}>
            <stop offset={R_IN / R_OUT} stopColor="#000" stopOpacity=".45" />
            <stop offset={(R_IN + 6) / R_OUT} stopColor="#000" stopOpacity="0" />
            <stop offset={(R_IN + W * 0.55) / R_OUT} stopColor="#fff" stopOpacity=".16" />
            <stop offset={(R_OUT - 6) / R_OUT} stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".42" />
          </radialGradient>
          <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff3b8" />
            <stop offset=".5" stopColor="#f7c548" />
            <stop offset="1" stopColor="#b07a10" />
          </linearGradient>
          <filter id={`${u}soft`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
        </defs>

        {/* the bezel */}
        <circle cx={C} cy={C} r="298" fill="#071017" />
        <circle cx={C} cy={C} r="298" fill="none" stroke="#fff" strokeOpacity=".06" strokeWidth="2" />
        {/* the countdown track */}
        <circle cx={C} cy={C} r={TRACK} fill="none" stroke="#fff" strokeOpacity=".07" strokeWidth="7" />
        <circle
          ref={trackRef}
          cx={C}
          cy={C}
          r={TRACK}
          fill="none"
          stroke={landed ? winner! : '#f7c548'}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${TRACK_LEN} ${TRACK_LEN}`}
          strokeDashoffset={stage === 'betting' ? undefined : 0}
          transform={`rotate(-90 ${C} ${C})`}
          style={{ opacity: stage === 'betting' || spinning || landed ? 1 : 0.35, transition: 'opacity .4s, stroke .4s' }}
        />
        {/* the bulbs */}
        {Array.from({ length: BULBS }, (_, i) => {
          const a = (i / BULBS) * Math.PI * 2
          const x = C + 280 * Math.sin(a)
          const y = C - 280 * Math.cos(a)
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r="3.1"
              className={spinning ? 'pot-chase' : landed ? 'pot-flash' : ''}
              style={{ fill: landed ? winner! : '#ffe7a3', animationDelay: spinning ? `${(i % 8) * 0.06}s` : landed ? `${(i % 2) * 0.22}s` : undefined, opacity: spinning || landed ? undefined : 0.32 }}
            />
          )
        })}
        {/* the ring of tickets */}
        <g ref={ring}>
          <circle cx={C} cy={C} r={R_MID} fill="none" stroke="#0f2130" strokeWidth={W} />
          {arcs.length === 0 && <circle cx={C} cy={C} r={R_MID} fill="none" stroke="#fff" strokeOpacity=".06" strokeWidth={W - 10} strokeDasharray="6 14" />}
          {arcs.map((a) => (
            <circle
              key={a.key}
              cx={C}
              cy={C}
              r={R_MID}
              fill="none"
              stroke={landed && winnerWho && a.who !== winnerWho ? mix(a.colour, '#142230', 0.8) : a.colour}
              strokeOpacity={a.pending ? 0.55 : 1}
              strokeWidth={W}
              strokeDasharray={`${Math.max(0, (a.len / 360) * CIRC)} ${CIRC}`}
              transform={`rotate(${a.from - 90} ${C} ${C})`}
              style={{ transition: 'stroke-dasharray .45s cubic-bezier(.2,.8,.2,1), transform .45s cubic-bezier(.2,.8,.2,1), stroke .5s' }}
            />
          ))}
          {/* where one player's sliver meets another's */}
          {arcs.length > 1 &&
            arcs.map((a, i) => {
              const prev = arcs[(i - 1 + arcs.length) % arcs.length]
              if (prev.who === a.who) return null
              const r = ((a.from - 90) * Math.PI) / 180
              return <line key={`s${a.key}`} x1={C + R_IN * Math.cos(r)} y1={C + R_IN * Math.sin(r)} x2={C + R_OUT * Math.cos(r)} y2={C + R_OUT * Math.sin(r)} stroke="#06121b" strokeWidth="2.5" />
            })}
          <circle cx={C} cy={C} r={R_OUT} fill="none" stroke={`url(#${u}tube)`} strokeWidth="0" />
          <path d={`M${C} ${C - R_OUT} A${R_OUT} ${R_OUT} 0 1 1 ${C - 0.01} ${C - R_OUT} Z M${C} ${C - R_IN} A${R_IN} ${R_IN} 0 1 0 ${C + 0.01} ${C - R_IN} Z`} fill={`url(#${u}tube)`} fillRule="evenodd" />
          {faces.map((a) => {
            const mid = a.from + a.len / 2
            const r = ((mid - 90) * Math.PI) / 180
            const x = C + R_MID * Math.cos(r)
            const y = C + R_MID * Math.sin(r)
            return (
              <g key={`f${a.who}`} transform={`translate(${x} ${y}) rotate(${mid}) translate(-16 -16)`} style={{ transition: 'transform .45s cubic-bezier(.2,.8,.2,1)' }}>
                <circle cx="16" cy="16" r="17.5" fill={shade(a.colour, -0.45)} />
                <Avatar index={a.avatar} size={32} />
              </g>
            )
          })}
          <circle cx={C} cy={C} r={R_OUT + 1} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="2" />
          <circle cx={C} cy={C} r={R_IN - 1} fill="none" stroke="#000" strokeOpacity=".55" strokeWidth="2" />
        </g>
        {/* the disc under the jar */}
        <circle cx={C} cy={C} r={R_IN - 3} fill={`url(#${u}disc)`} />
        <circle cx={C} cy={C} r={R_IN - 3} fill="none" stroke="#f7c548" strokeOpacity=".22" strokeWidth="2" />
        {landed && <circle cx={C} cy={C} r={R_IN - 30} fill={winner!} opacity=".16" filter={`url(#${u}soft)`} />}
        {/* the pointer */}
        <g transform={`translate(${C} 0)`} style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.55))' }}>
          {/* flicked by every sliver that passes (pointerRef), about its pin */}
          <g ref={pointerRef} style={{ transformBox: 'fill-box', transformOrigin: '50% 24%' }}>
            <path d="M0 64 L-17 14 A18 18 0 1 1 17 14 Z" fill={`url(#${u}gold)`} stroke="#3a2600" strokeWidth="2.4" strokeLinejoin="round" />
            <circle cx="0" cy="8" r="7.5" fill={landed ? winner! : '#ff4d61'} stroke="#3a2600" strokeWidth="2" style={{ transition: 'fill .3s' }} />
            <circle cx="-2.4" cy="5.6" r="2.2" fill="#fff" opacity=".7" />
          </g>
        </g>
      </svg>
      {/* the jar, filling as the coins go in */}
      <div className="absolute transition-opacity duration-500" style={{ left: '33%', top: '15.5%', width: '34%', height: '43.5%', opacity: landed ? 0.4 : 1 }}>
        <Jar bands={bands} pot={pot} glow={glow} dim={landed} open={stage === 'betting'} />
      </div>
      {centre}
      {overlay}
    </div>
  )
})

/** where a coin dropped into the jar comes to rest, as fractions of the wheel's box (the top of the pile) */
export function pileTop(pot: number) {
  const level = levelOf(pot)
  const yJar = JAR_FLOOR - level * (JAR_FLOOR - JAR_TOP)
  return 0.155 + (yJar / 256) * 0.435
}

/** A few coins in a player's colour dropping through the jar's mouth onto the pile. */
export function CoinDrop({ colour, to, n = 5, onDone }: { colour: string; to: number; n?: number; onDone?: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: n }, (_, i) => {
        const dx = (i - (n - 1) / 2) * 1.6 + ((i * 37) % 7) - 3
        return (
          <motion.div
            key={i}
            className="absolute left-1/2 top-0"
            style={{ width: '4.2%', aspectRatio: '1', marginLeft: '-2.1%' }}
            initial={{ x: `${dx * 6}%`, y: '230%', opacity: 0, rotate: 0, scale: 0.8 }}
            animate={{ y: ['230%', `${to * 2381}%`], opacity: [0, 1, 1, 0], rotate: 260 + i * 70, scale: [0.8, 1, 0.9] }}
            transition={{ duration: 0.62 + i * 0.03, delay: i * 0.07, ease: [0.45, 0, 0.9, 0.6], times: [0, 0.15, 0.85, 1] }}
            onAnimationComplete={i === n - 1 ? onDone : undefined}
          >
            <svg viewBox="0 0 20 20" className="h-full w-full" aria-hidden>
              <ellipse cx="10" cy="10" rx="9.2" ry="9.2" fill="#b98208" />
              <ellipse cx="10" cy="10" rx="7.4" ry="7.4" fill={colour} />
              <circle cx="10" cy="10" r="4.4" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.2" />
            </svg>
          </motion.div>
        )
      })}
    </div>
  )
}

/** A burst of confetti from the middle of the wheel. */
export function Confetti({ colours, seed = 1, spread = 300 }: { colours: string[]; seed?: number; spread?: number }) {
  const bits = useMemo(() => {
    let s = seed * 9301 + 49297
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
    return Array.from({ length: 46 }, (_, i) => {
      const a = rnd() * Math.PI * 2
      const v = 0.6 + rnd() * 0.9
      return { i, x: Math.cos(a) * v, y: Math.sin(a) * v * 0.8 - 0.3, r: rnd() * 720 - 360, c: colours[i % colours.length], w: 6 + rnd() * 7, round: rnd() < 0.3, d: rnd() * 0.15 }
    })
  }, [colours, seed])
  return (
    <div className="pointer-events-none absolute inset-0 overflow-visible">
      {bits.map((b) => (
        <motion.span
          key={b.i}
          className="absolute left-1/2 top-1/2 block"
          style={{ width: b.w, height: b.round ? b.w : b.w * 0.45, background: b.c, borderRadius: b.round ? 999 : 2, marginLeft: -b.w / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.4 }}
          animate={{ x: [0, b.x * spread * 0.85, b.x * spread], y: [0, b.y * spread, b.y * spread + spread * 0.9], opacity: [1, 1, 0], rotate: b.r, scale: 1 }}
          transition={{ duration: 1.9, delay: b.d, ease: 'easeOut', times: [0, 0.45, 1] }}
        />
      ))}
    </div>
  )
}

