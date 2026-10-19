import { motion } from 'framer-motion'
import { useUid } from './ids'

/*
  A toy treasure chest for the top of the Rewards page: shut and locked when there's nothing to collect, lid thrown
  back on a heap of gold (with a warm glow and a few twinkles) when rewards are waiting. Chunky outlines and
  flat wood with a gold trim, in the cartoon style of the site's other props (the vault door, the tier badges).

  The open and shut chests are drawn whole, one over the other, and cross-fade. The twinkles only move with `twinkle`
  (the page leaves it off for players who ask for reduced motion).
*/

const OUTLINE = '#3d1806'

/** a coin lying in the heap, seen from the front: a flattened disc with its rim */
function HeapCoin({ x, y, r = 7, g }: { x: number; y: number; r?: number; g: string }) {
  return (
    <g>
      <ellipse cx={x} cy={y + 1.6} rx={r} ry={r * 0.42} fill="#9a5a08" stroke={OUTLINE} strokeWidth="1.4" />
      <ellipse cx={x} cy={y} rx={r} ry={r * 0.42} fill={`url(#${g})`} stroke={OUTLINE} strokeWidth="1.4" />
      <ellipse cx={x - r * 0.25} cy={y - r * 0.08} rx={r * 0.38} ry={r * 0.13} fill="#fff6cf" opacity=".75" />
    </g>
  )
}

/** a coin standing on its edge at the back of the heap */
function StandingCoin({ x, y, r = 8, g }: { x: number; y: number; r?: number; g: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={`url(#${g})`} stroke={OUTLINE} strokeWidth="1.6" />
      <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke="#b97c12" strokeWidth="1.3" />
      <circle cx={x - r * 0.32} cy={y - r * 0.36} r={r * 0.2} fill="#fff" opacity=".7" />
    </g>
  )
}

/** a four-pointed twinkle, growing and fading in a slow loop when `on` */
function Sparkle({ x, y, s, delay, on }: { x: number; y: number; s: number; delay: number; on: boolean }) {
  return (
    <motion.path
      d={`M${x} ${y - s}Q${x} ${y} ${x + s} ${y}Q${x} ${y} ${x} ${y + s}Q${x} ${y} ${x - s} ${y}Q${x} ${y} ${x} ${y - s}Z`}
      fill="#fff8d6"
      animate={on ? { scale: [0.3, 1, 0.3], opacity: [0.2, 1, 0.2] } : { scale: 1, opacity: 0.9 }}
      transition={on ? { duration: 1.8, delay, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
    />
  )
}

export function RewardChest({ open, twinkle = true, size = 80, className = '' }: { open: boolean; twinkle?: boolean; size?: number; className?: string }) {
  const u = useUid()
  // the chest's body below the rim; the shut lid's dome above it
  const body = 'M14 54H106V86Q106 94 98 94H22Q14 94 14 86Z'
  const dome = 'M14 54V42Q14 20 60 20Q106 20 106 42V54Z'
  return (
    <svg width={size} height={size * (104 / 120)} viewBox="0 0 120 104" className={className} aria-hidden>
      <defs>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c46f34" />
          <stop offset="1" stopColor="#8c4520" />
        </linearGradient>
        <linearGradient id={`${u}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9884a" />
          <stop offset="1" stopColor="#a5562a" />
        </linearGradient>
        <linearGradient id={`${u}in`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a210c" />
          <stop offset="1" stopColor="#6e3418" />
        </linearGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0a8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98a16" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx="60" cy="40" r="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffe48a" stopOpacity=".85" />
          <stop offset=".45" stopColor="#f7c548" stopOpacity=".28" />
          <stop offset="1" stopColor="#f7c548" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${u}shut`}>
          <path d={`${body}${dome}`} />
        </clipPath>
        <clipPath id={`${u}box`}>
          <path d={body} />
        </clipPath>
      </defs>

      <ellipse cx="60" cy="97" rx="47" ry="5.5" fill="#000" opacity=".32" />

      {/* open: the glow, the lid thrown back, the heap of gold */}
      <g opacity={open ? 1 : 0} style={{ transition: 'opacity .35s ease' }}>
        <circle cx="60" cy="40" r="56" fill={`url(#${u}glow)`} />
        <path d="M17 52L25 15Q60 6 95 15L103 52Z" fill={`url(#${u}in)`} stroke={OUTLINE} strokeWidth="2.6" strokeLinejoin="round" />
        <path d="M30 47L35 20M85 47L90 20" stroke="#f7c548" strokeWidth="7" strokeLinecap="butt" opacity=".9" />
        <path d="M25 15Q60 6 95 15" fill="none" stroke="#f7c548" strokeWidth="3.4" />
        <StandingCoin x={40} y={37} g={`${u}g`} />
        <StandingCoin x={76} y={35} r={9} g={`${u}g`} />
        <StandingCoin x={58} y={31} r={7.5} g={`${u}g`} />
        <path d="M18 54Q24 40 38 40Q48 33 60 36Q72 32 84 39Q97 40 102 54Z" fill={`url(#${u}g)`} stroke={OUTLINE} strokeWidth="2" strokeLinejoin="round" />
        <HeapCoin x={33} y={46} g={`${u}g`} />
        <HeapCoin x={50} y={42} r={8} g={`${u}g`} />
        <HeapCoin x={68} y={41} g={`${u}g`} />
        <HeapCoin x={86} y={46} r={7.5} g={`${u}g`} />
        <HeapCoin x={58} y={49} r={6.5} g={`${u}g`} />
        <Sparkle x={22} y={26} s={5} delay={0} on={open && twinkle} />
        <Sparkle x={99} y={22} s={6} delay={0.6} on={open && twinkle} />
        <Sparkle x={63} y={10} s={4} delay={1.1} on={open && twinkle} />
      </g>

      {/* shut: the dome of the lid, its trim following the curve */}
      <g opacity={open ? 0 : 1} style={{ transition: 'opacity .35s ease' }}>
        <path d={dome} fill={`url(#${u}l)`} />
        <g clipPath={`url(#${u}shut)`}>
          <rect x="24" y="0" width="10" height="56" fill="#e3a93a" />
          <rect x="86" y="0" width="10" height="56" fill="#e3a93a" />
          <path d="M16 36Q60 22 104 36" fill="none" stroke={OUTLINE} strokeOpacity=".3" strokeWidth="1.6" />
          <path d="M22 30Q40 22 58 22" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
        </g>
        <path d={dome} fill="none" stroke={OUTLINE} strokeWidth="2.6" strokeLinejoin="round" />
      </g>

      {/* the body, the same either way */}
      <path d={body} fill={`url(#${u}w)`} />
      <g clipPath={`url(#${u}box)`}>
        <path d="M14 70H106M14 84H106" stroke={OUTLINE} strokeOpacity=".28" strokeWidth="1.6" />
        <rect x="24" y="50" width="10" height="50" fill="#e3a93a" />
        <rect x="86" y="50" width="10" height="50" fill="#e3a93a" />
        <rect x="24" y="50" width="3" height="50" fill="#fff" opacity=".25" />
        <rect x="86" y="50" width="3" height="50" fill="#fff" opacity=".25" />
      </g>
      <path d={body} fill="none" stroke={OUTLINE} strokeWidth="2.6" strokeLinejoin="round" />
      {/* the gold rim between lid and body */}
      <rect x="11" y="50" width="98" height="8" rx="3" fill={`url(#${u}g)`} stroke={OUTLINE} strokeWidth="2.2" />
      {/* the lock */}
      <rect x="50" y="55" width="20" height="21" rx="5" fill={`url(#${u}g)`} stroke={OUTLINE} strokeWidth="2.2" />
      <circle cx="60" cy="63.5" r="3" fill={OUTLINE} />
      <path d="M58.6 64.5H61.4L62.2 71H57.8Z" fill={OUTLINE} />
      <circle cx="55" cy="59" r="1.6" fill="#fff" opacity=".7" />
    </svg>
  )
}
