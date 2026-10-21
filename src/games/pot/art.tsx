import { memo } from 'react'
import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'

/*
  Pot Luck's drawings: the players' colours, the glass jar that fills with everyone's coins, and the small marks the
  page uses (the crown, the bot tag, a coloured coin). The jar is plain SVG in a 200 × 256 box: a gold screw lid, the
  glass with its highlights drawn over the coins, and inside it one band of coins per deposit, in the order paid,
  coloured by who paid, rising with the pot (on a log scale, so a pot of 100 shows and one of 30,000 fills the jar).
*/

export const ME = '#22d36f'
/** the other players' colours, by their number in the round (green is always you) */
export const PALETTE = ['#4cb4ff', '#f7c548', '#ff5fa2', '#9b7bff', '#ff8a3d', '#ff4d61', '#e879f9', '#22c7d8', '#fde68a', '#a5b4fc']
export const colourOf = (p: number, me: boolean) => (me ? ME : PALETTE[(((p - 1) % PALETTE.length) + PALETTE.length) % PALETTE.length])

/** a colour lighter (k > 0) or darker (k < 0) */
export function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16)
  const ch = (v: number) => Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))
  const r = ch((n >> 16) & 255)
  const g = ch((n >> 8) & 255)
  const b = ch(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** a colour mixed toward another (k 0-1) */
export function mix(a: string, b: string, k: number) {
  const x = parseInt(a.slice(1), 16)
  const y = parseInt(b.slice(1), 16)
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - k) + ((y >> s) & 255) * k)
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}

/** how full the jar looks for a pot: 0 to 1 on a log scale */
export const levelOf = (pot: number) => (pot <= 0 ? 0 : Math.min(1, Math.log(1 + pot / 40) / Math.log(1 + 30000 / 40)))

/* ---------- the jar ---------- */

const BODY = 'M58 50 C58 66 18 70 18 100 L18 222 Q18 248 44 248 L156 248 Q182 248 182 222 L182 100 C182 70 142 66 142 50 Z'
const INSIDE = 'M63 55 C63 71 24 75 24 103 L24 220 Q24 242 46 242 L154 242 Q176 242 176 220 L176 103 C176 75 137 71 137 55 Z'
/** the inside's floor and the highest the coins go (just under the neck) */
export const JAR_FLOOR = 242
export const JAR_TOP = 66
/** half the inside's width at height y */
export const jarHalf = (y: number) => (y >= 103 ? 76 : y <= 55 ? 37 : 37 + ((y - 55) / 48) * 39)

export interface Band {
  key: string
  colour: string
  /** coins in the band */
  amount: number
  /** this band's deposit is still on its way (shown faint) */
  pending?: boolean
}

/** The jar with its coins: `bands` bottom to top, `pot` sets how full it is, `glow` lights it from behind (0-1), `open` takes its lid off. */
export const Jar = memo(function Jar({ bands, pot, glow = 0, dim = false, open = false }: { bands: Band[]; pot: number; glow?: number; dim?: boolean; open?: boolean }) {
  const u = useUid() + 'jar'
  const level = levelOf(pot)
  const height = level * (JAR_FLOOR - JAR_TOP)
  const total = bands.reduce((a, b) => a + b.amount, 0) || 1
  // each band's share of the height, at least a sliver so a small deposit still shows
  const raw = bands.map((b) => Math.max(1.6, (b.amount / total) * height))
  const k = height > 0 ? height / raw.reduce((a, b) => a + b, 0) : 0
  let y = JAR_FLOOR
  const rows = bands.map((b, i) => {
    const h = raw[i] * Math.max(k, 0)
    y -= h
    return { ...b, y, h }
  })
  const top = JAR_FLOOR - height
  const topColour = rows.length ? rows[rows.length - 1].colour : '#f7c548'
  const hw = jarHalf(top)
  return (
    <svg viewBox="0 0 200 256" className="h-full w-full overflow-visible" aria-hidden>
      <defs>
        <clipPath id={`${u}in`}>
          <path d={INSIDE} />
        </clipPath>
        <linearGradient id={`${u}cyl`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".55" />
          <stop offset=".18" stopColor="#000" stopOpacity=".12" />
          <stop offset=".42" stopColor="#fff" stopOpacity=".16" />
          <stop offset=".6" stopColor="#fff" stopOpacity=".04" />
          <stop offset=".86" stopColor="#000" stopOpacity=".2" />
          <stop offset="1" stopColor="#000" stopOpacity=".6" />
        </linearGradient>
        <pattern id={`${u}coins`} width="14" height="5" patternUnits="userSpaceOnUse">
          <path d="M0 4.6 Q3.5 5.6 7 4.6 Q10.5 5.6 14 4.6" fill="none" stroke="#000" strokeOpacity=".28" strokeWidth=".9" />
          <path d="M-3.5 1.2 Q0 0.4 3.5 1.2 M10.5 1.2 Q14 0.4 17.5 1.2" fill="none" stroke="#fff" strokeOpacity=".22" strokeWidth=".7" />
          <path d="M3.5 2.2 Q7 1.4 10.5 2.2" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth=".6" />
        </pattern>
        <linearGradient id={`${u}glass`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#bfe6ff" stopOpacity=".2" />
          <stop offset=".25" stopColor="#bfe6ff" stopOpacity=".05" />
          <stop offset=".75" stopColor="#bfe6ff" stopOpacity=".03" />
          <stop offset="1" stopColor="#bfe6ff" stopOpacity=".18" />
        </linearGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff1b0" />
          <stop offset=".45" stopColor="#f7c548" />
          <stop offset="1" stopColor="#a8700c" />
        </linearGradient>
        <linearGradient id={`${u}goldx`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#000" stopOpacity=".35" />
          <stop offset=".3" stopColor="#fff" stopOpacity=".25" />
          <stop offset=".55" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".4" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx=".5" cy=".62" r=".6">
          <stop offset="0" stopColor="#ffd56b" stopOpacity=".55" />
          <stop offset=".55" stopColor="#ffb02e" stopOpacity=".12" />
          <stop offset="1" stopColor="#ffb02e" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* the glow behind */}
      <ellipse cx="100" cy="160" rx="120" ry="120" fill={`url(#${u}glow)`} opacity={0.25 + glow * 0.75} />
      {/* the shadow under it */}
      <ellipse cx="100" cy="250" rx="80" ry="7" fill="#000" opacity=".45" />
      {/* the dark inside of the glass */}
      <path d={BODY} fill="#06121b" fillOpacity=".72" />
      {/* the coins */}
      <g clipPath={`url(#${u}in)`} opacity={dim ? 0.45 : 1} style={{ transition: 'opacity .5s' }}>
        {rows.map((b) => (
          <motion.rect
            key={b.key}
            x="18"
            width="164"
            initial={{ y: JAR_FLOOR - height, height: 0 }}
            animate={{ y: b.y, height: b.h + 0.6 }}
            transition={{ type: 'spring', stiffness: 170, damping: 22 }}
            fill={b.colour}
            opacity={b.pending ? 0.55 : 1}
          />
        ))}
        {height > 0 && (
          <>
            <rect x="18" y={top} width="164" height={height} fill={`url(#${u}coins)`} />
            <rect x="18" y={top - 10} width="164" height={height + 10} fill={`url(#${u}cyl)`} />
            {/* the top of the pile, a heap of coins */}
            <motion.g initial={false} animate={{ y: top }} transition={{ type: 'spring', stiffness: 170, damping: 22 }}>
              <ellipse cx="100" cy="0" rx={hw} ry="7" fill={shade(topColour, 0.18)} />
              <ellipse cx="100" cy="-1" rx={hw * 0.7} ry="4.6" fill={shade(topColour, 0.32)} />
              {[-0.52, -0.2, 0.12, 0.44, -0.36, 0.28].map((f, i) => (
                <ellipse key={i} cx={100 + f * hw} cy={i < 4 ? -2.2 : -5} rx="7" ry="2.6" fill={shade(topColour, 0.45)} stroke={shade(topColour, -0.35)} strokeWidth=".7" />
              ))}
            </motion.g>
          </>
        )}
      </g>
      {/* the glass over them */}
      <path d={BODY} fill={`url(#${u}glass)`} />
      <path d={BODY} fill="none" stroke="#d9f0ff" strokeOpacity=".42" strokeWidth="2.6" />
      <path d={INSIDE} fill="none" stroke="#000" strokeOpacity=".35" strokeWidth="1.4" />
      <path d="M30 112 C30 96 44 86 58 80 L58 86 C47 92 37 100 37 114 L37 214 Q37 228 46 233 L44 236 Q30 230 30 214 Z" fill="#fff" fillOpacity=".24" />
      <path d="M168 118 L168 206 Q168 216 162 222 L160 220 Q164 214 164 206 L164 118 Z" fill="#fff" fillOpacity=".16" />
      <path d="M66 62 C70 70 92 72 100 72" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      {/* the neck ring and the lid */}
      <rect x="54" y="40" width="92" height="12" rx="4" fill={`url(#${u}gold)`} stroke="#3a2600" strokeOpacity=".7" strokeWidth="1.2" />
      <rect x="54" y="40" width="92" height="12" rx="4" fill={`url(#${u}goldx)`} />
      {/* the lid: off and tipped back while the jar takes coins, screwed on when betting closes */}
      <motion.g initial={false} animate={open ? { x: -14, y: -13, rotate: -9 } : { x: 0, y: 0, rotate: 0 }} transition={open ? { type: 'spring', stiffness: 160, damping: 16 } : { type: 'spring', stiffness: 420, damping: 22 }} style={{ originX: 0.05, originY: 1 }}>
        <rect x="48" y="12" width="104" height="30" rx="8" fill={`url(#${u}gold)`} stroke="#3a2600" strokeOpacity=".75" strokeWidth="1.4" />
        {Array.from({ length: 12 }, (_, i) => (
          <rect key={i} x={54 + i * 8} y="16" width="3.2" height="22" rx="1.4" fill="#7a4f06" opacity=".35" />
        ))}
        <rect x="48" y="12" width="104" height="30" rx="8" fill={`url(#${u}goldx)`} />
        <rect x="54" y="15" width="92" height="4" rx="2" fill="#fff8d8" opacity=".6" />
      </motion.g>
    </svg>
  )
})

/* ---------- small marks ---------- */

export function Crown({ size = 18, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M3 17.5 1.8 7.6l5.6 4.1L12 4l4.6 7.7 5.6-4.1-1.2 9.9Z" fill="#f7c548" stroke="#6b4300" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="3" y="18.4" width="18" height="2.8" rx="1.2" fill="#f7c548" stroke="#6b4300" strokeWidth="1.2" />
      <circle cx="12" cy="13.5" r="1.6" fill="#ff5fa2" />
    </svg>
  )
}

/** marks a house bot */
export function BotTag({ className = '' }: { className?: string }) {
  return <span className={`shrink-0 rounded bg-white/10 px-1 text-[9px] font-black tracking-wider text-white/55 ${className}`}>BOT</span>
}

/** a coin in a player's colour, with a gold rim */
export function Token({ colour, size = 14 }: { colour: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="shrink-0" aria-hidden>
      <circle cx="10" cy="10" r="9.2" fill="#c9900f" />
      <circle cx="10" cy="10" r="7.4" fill={colour} />
      <circle cx="10" cy="10" r="4.6" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" />
      <path d="M5.5 6.5 A6 6 0 0 1 12 4.2" fill="none" stroke="#fff" strokeOpacity=".6" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

export function ShieldIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 2.8 4.5 5.6v6c0 4.6 3.1 8.2 7.5 9.6 4.4-1.4 7.5-5 7.5-9.6v-6Z" />
      <path d="m8.8 12 2.2 2.2 4.3-4.4" />
    </svg>
  )
}
