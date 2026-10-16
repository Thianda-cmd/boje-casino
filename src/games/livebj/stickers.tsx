import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useUid } from '../../art/ids'
import type { ReactionCode } from './types'

/* Table reactions: eight stickers in the avatars' style (a glossy disc with a white emblem) and eight
   short phrases. Both show in a bubble over the player's seat for a few seconds. */

export const STICKERS = ['thumbs', 'haha', 'wow', 'cry', 'fire', 'clap', 'clover', 'cool'] as const satisfies readonly ReactionCode[]
export const PHRASES = {
  nice: 'Nice hand!',
  gl: 'Good luck!',
  hitme: 'Hit me!',
  ouch: 'Ouch!',
  hot: "Dealer's on fire",
  gg: 'GG',
  ty: 'Thanks!',
  hurry: 'Your turn, friend',
} as const satisfies Partial<Record<ReactionCode, string>>

type StickerCode = (typeof STICKERS)[number]
export const isSticker = (c: ReactionCode): c is StickerCode => (STICKERS as readonly string[]).includes(c)

// each emblem is drawn in a 24x24 box in white; `d` is the dark detail colour
const ART: Record<StickerCode, { colors: [string, string]; label: string; emblem: (d: string) => ReactNode }> = {
  thumbs: {
    colors: ['#6ee7ff', '#2f7bff'],
    label: 'Thumbs up',
    emblem: (d) => (
      <>
        <rect x="3" y="10.4" width="3.6" height="9.8" rx="1" />
        <path d="M8 10.6h1.8l3.2-6.4c.5-1 1.7-1.3 2.6-.7.8.5 1 1.5.7 2.3l-1.3 3.7h4.3c1.4 0 2.4 1.3 2.1 2.6l-1.5 6.6c-.2 1-1.1 1.6-2.1 1.6H9.6c-.6 0-1.2-.3-1.6-.7z" />
        <path d="M12.6 14.6h4M12.2 17.4h3.8" fill="none" stroke={d} strokeOpacity=".35" strokeWidth="1.2" strokeLinecap="round" />
      </>
    ),
  },
  haha: {
    colors: ['#ffe066', '#f0a020'],
    label: 'Laughing',
    emblem: (d) => (
      <>
        <circle cx="12" cy="12" r="9.6" />
        <path d="M6.8 9.6l2.4 1.3-2.4 1.3M17.2 9.6l-2.4 1.3 2.4 1.3" fill="none" stroke={d} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6.6 13.6h10.8a5.4 5.4 0 0 1-10.8 0z" fill={d} />
        <path d="M9.2 17.7a4.2 2.2 0 0 1 5.6 0 5.3 5.3 0 0 1-5.6 0z" fill="#ff6f8e" />
      </>
    ),
  },
  wow: {
    colors: ['#d3b8ff', '#7b5cff'],
    label: 'Surprised',
    emblem: (d) => (
      <>
        <circle cx="12" cy="12" r="9.6" />
        <path d="M6.8 7.4c.8-.9 2-1.2 3-.9M17.2 7.4c-.8-.9-2-1.2-3-.9" fill="none" stroke={d} strokeWidth="1.4" strokeLinecap="round" />
        <ellipse cx="9" cy="10.4" rx="1.4" ry="1.9" fill={d} />
        <ellipse cx="15" cy="10.4" rx="1.4" ry="1.9" fill={d} />
        <ellipse cx="12" cy="16.2" rx="2.3" ry="2.8" fill={d} />
      </>
    ),
  },
  cry: {
    colors: ['#8fd3ff', '#2a6fdb'],
    label: 'Crying',
    emblem: (d) => (
      <>
        <circle cx="12" cy="12" r="9.6" />
        <path d="M6.9 10.6c.9-1 2.5-1 3.4 0M13.7 10.6c.9-1 2.5-1 3.4 0" fill="none" stroke={d} strokeWidth="1.5" strokeLinecap="round" />
        <path d="M8.6 17.4c1.9-1.9 4.9-1.9 6.8 0" fill="none" stroke={d} strokeWidth="1.6" strokeLinecap="round" />
        <path d="M7.4 12.4c.9 1.4 1.4 2.3 1.4 3a1.4 1.4 0 0 1-2.8 0c0-.7.5-1.6 1.4-3zM16.6 12.4c.9 1.4 1.4 2.3 1.4 3a1.4 1.4 0 0 1-2.8 0c0-.7.5-1.6 1.4-3z" fill="#5cc2ff" />
      </>
    ),
  },
  fire: {
    colors: ['#ffc06b', '#ff4d3d'],
    label: 'Fire',
    emblem: (d) => (
      <>
        <path d="M12 2.2c.6 3.4 5.9 5.8 5.9 11.4a5.9 5.9 0 0 1-11.8 0c0-2.9 1.7-4.6 2.3-6.8 1.8 1.2 2.5 2.8 2.6 4.6 1.6-1.6 1.9-5 1-9.2z" />
        <path d="M12 21.4c-1.9 0-3.1-1.4-3.1-3.1 0-1.9 1.6-2.9 2.3-4.5 1.6 1.2 3.9 2.5 3.9 4.5 0 1.7-1.2 3.1-3.1 3.1z" fill={d} fillOpacity=".38" />
      </>
    ),
  },
  clap: {
    colors: ['#ffc2dc', '#ff5f9e'],
    label: 'Clapping',
    emblem: (d) => (
      <>
        <path d="M5.8 4.2 4.8 2.4M9 3.4V1.4M12.2 4.2l1-1.8" fill="none" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        <g transform="rotate(-16 9 15)">
          <rect x="5.4" y="7.4" width="7.4" height="13" rx="3.7" />
          <rect x="3.2" y="12" width="3.6" height="6.4" rx="1.8" transform="rotate(-24 5 15.2)" />
        </g>
        <g transform="rotate(14 15 15)">
          <rect x="11.6" y="7" width="7.4" height="13.4" rx="3.7" stroke={d} strokeOpacity=".3" strokeWidth="1" />
          <path d="M14 10.2v4.6M16.6 10.2v4.6" fill="none" stroke={d} strokeOpacity=".3" strokeWidth="1.1" strokeLinecap="round" />
        </g>
      </>
    ),
  },
  clover: {
    colors: ['#5df0a0', '#109a5c'],
    label: 'Lucky clover',
    emblem: (d) => (
      <>
        <path d="M12.4 12.6c.5 3.2 1.7 6 3.8 8.6" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        {/* four heart-shaped leaves, tips meeting in the middle */}
        {[0, 90, 180, 270].map((a) => (
          <path
            key={a}
            d="M12 11.4C8.6 9.4 7 7.4 8 5.1c.8-1.7 2.9-1.9 4-.3 1.1-1.6 3.2-1.4 4 .3 1 2.3-.6 4.3-4 6.3z"
            transform={`rotate(${a} 12 11.4)`}
            stroke={d}
            strokeOpacity=".55"
            strokeWidth="1"
            strokeLinejoin="round"
          />
        ))}
        <path d="M12 8.2v6.4M8.8 11.4h6.4" stroke={d} strokeOpacity=".3" strokeWidth=".9" strokeLinecap="round" />
      </>
    ),
  },
  cool: {
    colors: ['#64f0c8', '#2a9df4'],
    label: 'Cool',
    emblem: (d) => (
      <>
        <circle cx="12" cy="12" r="9.6" />
        <path d="M3.4 9.6h17.2v1.2c-.6.2-.9.6-1 1.2-.3 2-1.6 3-3.4 3-2 0-3-1.2-3.3-3.2-.1-.7-.4-1-.9-1s-.8.3-.9 1C10.8 13.8 9.8 15 7.8 15 6 15 4.7 14 4.4 12c-.1-.6-.4-1-1-1.2z" fill={d} />
        <path d="M5.8 11.2l1.6-.1M14.2 11.2l1.6-.1" stroke="#fff" strokeOpacity=".6" strokeWidth="1" strokeLinecap="round" />
        <path d="M8.8 17.4c1.9 1.4 4.5 1.4 6.4 0" fill="none" stroke={d} strokeWidth="1.6" strokeLinecap="round" />
      </>
    ),
  },
}

export function Sticker({ code, size = 40 }: { code: StickerCode; size?: number }) {
  const id = useUid()
  const { colors, label, emblem } = ART[code]
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className="shrink-0" role="img" aria-label={label}>
      <defs>
        <linearGradient id={`${id}b`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={colors[0]} />
          <stop offset="1" stopColor={colors[1]} />
        </linearGradient>
        <radialGradient id={`${id}g`} cx=".3" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".45" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="24" fill={`url(#${id}b)`} />
      <circle cx="24" cy="24" r="24" fill={`url(#${id}g)`} />
      <g transform="translate(9.6 9.6) scale(1.2)" fill="#fff" fillOpacity=".97" style={{ filter: 'drop-shadow(0 1.5px 1.5px rgba(0,0,0,.25))' }}>
        {emblem(colors[1])}
      </g>
    </svg>
  )
}

/** A reaction over a seat: the sticker, or the phrase in a speech bubble whose tail points down at the player. */
export function ReactionBubble({ code, size = 44 }: { code: ReactionCode; size?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.6 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 520, damping: 22 }}
      className="pointer-events-none origin-bottom drop-shadow-[0_8px_16px_rgba(0,0,0,.45)]"
    >
      {isSticker(code) ? (
        <Sticker code={code} size={size} />
      ) : (
        <div className="relative whitespace-nowrap rounded-full bg-white px-3 py-1.5 text-[12px] font-extrabold leading-none text-[#0b1520]">
          {PHRASES[code as keyof typeof PHRASES]}
          <span className="absolute -bottom-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-white" />
        </div>
      )}
    </motion.div>
  )
}
