import type { CSSProperties } from 'react'
import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import { multLabel, speciesOf, type FishId } from './rules'
import { LEVEL_COLORS, LOOKS } from './looks'

/*
  Reef Raid's flat art for the screen (the panel, the HUD, the paytable), in the reef's toon style: ink outlines,
  bold fills, a soft shine. The creatures themselves are the stage's own renders (scene.portraits); until they arrive
  a creature shows as a dot in its colour.
*/

export const INK = '#171338'
const BRASS = '#ffcf5a'
const BRASS_DEEP = '#d99a2b'

/** cartoon lettering: an ink outline under the fill and a hard drop, no glow */
export const inked = (stroke = 4, drop = 3): CSSProperties => ({ WebkitTextStroke: `${stroke}px ${INK}`, paintOrder: 'stroke fill', textShadow: `0 ${drop}px 0 ${INK}` })

/** a chip in a creature's (or a level's) colour, lettered in ink or in white, whichever reads on it */
export const chip = (color: string): CSSProperties => {
  const n = parseInt(color.slice(1), 16)
  const light = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.62
  return light ? { background: color, color: INK } : { background: color, color: '#fff', textShadow: `0 1px 0 ${INK}` }
}

/** what a creature is worth on its own, as the HUD labels it (the chest: its wheel's range) */
export const valueLabel = (id: FishId) => (id === 'chest' ? '20–150×' : multLabel(speciesOf(id).mult))

/** a creature's picture: its render from the stage, or a dot in its colour until that is ready */
export function Portrait({ id, src, size, className = '', dim = false }: { id: FishId; src?: string; size: number; className?: string; dim?: boolean }) {
  if (src) return <img src={src} alt="" width={size} height={size} draggable={false} className={`shrink-0 select-none ${dim ? 'opacity-50 grayscale' : ''} ${className}`} style={{ width: size, height: size }} />
  return (
    <span className={`flex shrink-0 items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <span className="rounded-full border-2" style={{ width: size * 0.5, height: size * 0.5, background: speciesOf(id).color, borderColor: INK }} />
    </span>
  )
}

/**
 * The bubble cannon at a cost level, as the panel shows it: the brass-ringed turret on its rock with the barrel
 * standing out of the glass chamber, longer and fatter at each level and dressed like the 3D one (bands, fins, gems,
 * side pods, the crown), and the level's pips lit along the ring.
 */
export function CannonArt({ level, className = '' }: { level: number; className?: string }) {
  const u = useUid()
  const L = LOOKS[Math.max(0, Math.min(LOOKS.length - 1, level))]
  const body = L.body
  const trim = L.trim ?? BRASS
  // the barrel stands on the glass chamber at (70, 98), leaning a little towards the reef
  const cx = 70
  const cy = 96
  const len = L.len * 54
  const rt = L.r * 60
  const rb = rt * 0.8
  const top = cy - len
  const along = (k: number) => cy - len * k
  const bands = Array.from({ length: L.bands }, (_, i) => along(0.32 + (0.5 * (i + 0.5)) / L.bands))
  const gems = Array.from({ length: L.gems }, (_, i) => along(0.3 + (0.52 * (i + 0.5)) / Math.max(1, L.gems)))
  const halfAt = (y: number) => rb + ((cy - y) / len) * (rt - rb)
  return (
    <svg viewBox="0 0 140 134" className={className} aria-hidden>
      <defs>
        <radialGradient id={`${u}glow`}>
          <stop offset="0" stopColor={body} stopOpacity=".5" />
          <stop offset="1" stopColor={body} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}dome`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3fd0d8" />
          <stop offset="1" stopColor="#167a8a" />
        </linearGradient>
      </defs>
      <circle cx="70" cy="64" r="62" fill={`url(#${u}glow)`} />
      {/* the rock it stands on, the dome and its shine */}
      <path d="M32 134 L40 116 H100 L108 134 Z" fill="#a3a9cf" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M48 125 l6 -3 M86 129 l5 -4" stroke={INK} strokeOpacity=".35" strokeWidth="2" strokeLinecap="round" />
      <path d="M22 116 Q22 78 70 78 Q118 78 118 116 Z" fill={`url(#${u}dome)`} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M33 107 Q35 90 54 84" fill="none" stroke="#fff" strokeOpacity=".4" strokeWidth="4.5" strokeLinecap="round" />
      <motion.g key={level} initial={{ scale: 0.82, rotate: -20 }} animate={{ scale: 1, rotate: -13 }} transition={{ type: 'spring', stiffness: 420, damping: 14 }} style={{ originX: `${cx}px`, originY: `${cy}px` }}>
        {L.pods &&
          [-1, 1].map((s) => {
            const x = cx + s * (halfAt(along(0.42)) + 5)
            return (
              <g key={s}>
                <rect x={x - 5} y={along(0.66)} width="10" height={len * 0.36} rx="5" fill={body} stroke={INK} strokeWidth="2.6" />
                <rect x={x - 5.5} y={along(0.66) - 1} width="11" height="5" rx="2.5" fill={trim} stroke={INK} strokeWidth="1.8" />
              </g>
            )
          })}
        {Array.from({ length: L.fins }, (_, i) => {
          const s = L.fins === 3 ? i - 1 : i === 0 ? -1 : 1
          const y = along(0.3)
          if (s === 0) return <path key={i} d={`M${cx - 5} ${y + 2} L${cx} ${y - 14} L${cx + 5} ${y + 2} Z`} fill={BRASS} stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
          const x = cx + s * halfAt(y)
          return <path key={i} d={`M${x} ${y - 10} Q${x + s * 15} ${y - 2} ${x + s * 13} ${y + 16} L${x} ${y + 9} Z`} fill={BRASS} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
        })}
        {/* the barrel: a tube widening to the muzzle, a streak of light down it */}
        <path d={`M${cx - rb} ${cy} L${cx - rt} ${top + 6} L${cx + rt} ${top + 6} L${cx + rb} ${cy} Z`} fill={body} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <path d={`M${cx - rb * 0.5} ${cy - 6} L${cx - rt * 0.55} ${top + 12}`} stroke="#fff" strokeOpacity=".5" strokeWidth={Math.max(3, rt * 0.3)} strokeLinecap="round" />
        {bands.map((y) => {
          const w = halfAt(y) + 1.8
          return <rect key={y} x={cx - w} y={y - 3} width={w * 2} height="6" rx="2.5" fill={trim} stroke={INK} strokeWidth="2.2" />
        })}
        {gems.map((y, i) => (
          <path key={y} d={`M${cx} ${y - 5} L${cx + 4.6} ${y} L${cx} ${y + 5} L${cx - 4.6} ${y} Z`} fill={['#ff3b6b', '#3be8ff', '#7dff6a', '#ffe14a'][i % 4]} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
        ))}
        {/* the flared muzzle and its bore */}
        <path d={`M${cx - rt} ${top + 9} L${cx - rt * 1.42} ${top} L${cx + rt * 1.42} ${top} L${cx + rt} ${top + 9} Z`} fill={BRASS} stroke={INK} strokeWidth="2.8" strokeLinejoin="round" />
        <ellipse cx={cx} cy={top} rx={rt * 1.42} ry="3.6" fill={BRASS} stroke={INK} strokeWidth="2.8" />
        <ellipse cx={cx} cy={top} rx={rt * 0.95} ry="2" fill={INK} opacity=".7" />
        {L.crown &&
          [-2, -1, 0, 1, 2].map((k) => {
            const x = cx + k * rt * 0.62
            const h = k === 0 ? 13 : Math.abs(k) === 1 ? 10 : 8
            return <path key={k} d={`M${x - 3.6} ${top - 2} L${x} ${top - 2 - h} L${x + 3.6} ${top - 2} Z`} fill={BRASS} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          })}
      </motion.g>
      {/* the glass bubble chamber at its foot, bubbles inside */}
      <circle cx={cx} cy={cy} r={rb + 3} fill="#c8f6ff" fillOpacity=".95" stroke={INK} strokeWidth="3" />
      <circle cx={cx + 2} cy={cy + 2} r={(rb + 3) * 0.26} fill="none" stroke="#5fd6ef" strokeWidth="1.8" />
      <ellipse cx={cx - (rb + 3) * 0.42} cy={cy - (rb + 3) * 0.4} rx={(rb + 3) * 0.28} ry={(rb + 3) * 0.17} fill="#fff" transform={`rotate(-35 ${cx - (rb + 3) * 0.42} ${cy - (rb + 3) * 0.4})`} />
      {/* the brass ring with the level's pips */}
      <rect x="16" y="109" width="108" height="14" rx="7" fill={BRASS} stroke={INK} strokeWidth="3" />
      <path d="M24 113 H116" stroke="#fff3c4" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round" />
      {LEVEL_COLORS.map((c, i) => (
        <circle key={c} cx={31 + i * 13} cy="116" r="3.6" fill={i <= level ? c : BRASS_DEEP} stroke={INK} strokeWidth="1.6" />
      ))}
    </svg>
  )
}

/** a gold coin, for the treasure wheel and the HUD */
export function GoldCoin({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} className={className} aria-hidden>
      <circle cx="10" cy="10" r="8.6" fill="#ffc93c" stroke={INK} strokeWidth="1.8" />
      <circle cx="10" cy="10" r="5.6" fill="none" stroke="#d99a2b" strokeWidth="1.3" />
      <path d="M10 6.6l1 2.1 2.3.3-1.7 1.6.4 2.3L10 11.8 8 12.9l.4-2.3-1.7-1.6L9 8.7Z" fill="#fff2b0" />
    </svg>
  )
}
