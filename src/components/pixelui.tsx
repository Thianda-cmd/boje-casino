import type { CSSProperties, ReactNode } from 'react'
import type { Sprite } from '../lib/pixel'
import { fmt } from '../lib/format'

/* Shared bits of the pixel art direction: the font, the boxy HUD chip and the result card. */

export const PIXEL_FONT = '"Press Start 2P", "Manrope", system-ui, monospace'

/** A sprite drawn at `scale` screen pixels per art pixel. */
export function Px({ s, scale, className, style }: { s: Sprite; scale: number; className?: string; style?: CSSProperties }) {
  return (
    <img
      src={s.url}
      alt=""
      draggable={false}
      className={className}
      style={{ width: s.w * scale, height: s.h * scale, imageRendering: 'pixelated', ...style }}
    />
  )
}

export function HudChip({ label, value, tone }: { label: string; value: ReactNode; tone?: 'gold' | 'green' | 'red' }) {
  const color = tone === 'gold' ? 'text-[#f7c548]' : tone === 'green' ? 'text-[#4be38f]' : tone === 'red' ? 'text-[#ff6b7c]' : 'text-white'
  return (
    <div
      className="bg-[#0b1118]/75 px-3 py-1.5 backdrop-blur"
      style={{ fontFamily: PIXEL_FONT, boxShadow: 'inset 0 0 0 2px rgba(255,255,255,.08), 0 3px 0 rgba(0,0,0,.35)' }}
    >
      <div className="text-[9px] uppercase text-white/55">{label}</div>
      <div className={`mt-1 text-[14px] leading-tight ${color}`}>{value}</div>
    </div>
  )
}

const CARD_TONES = {
  win: ['#123d29', '#22d36f', '#0a2418'],
  loss: ['#3b1219', '#ff4d61', '#22080d'],
  push: ['#1b2733', '#9fb2c6', '#0b1118'],
  gold: ['#3d2e0c', '#f7c548', '#1f1704'],
} as const

export function PixelCard({ tone, children, className = '' }: { tone: keyof typeof CARD_TONES; children: ReactNode; className?: string }) {
  const c = CARD_TONES[tone]
  return (
    <div
      className={`px-8 py-4 text-center ${className}`}
      style={{
        fontFamily: PIXEL_FONT,
        background: c[0],
        boxShadow: `0 0 0 4px ${c[1]}, 0 0 0 8px ${c[2]}, inset 0 -6px 0 rgba(0,0,0,.25), inset 0 6px 0 rgba(255,255,255,.08), 0 18px 40px rgba(0,0,0,.45)`,
      }}
    >
      {children}
    </div>
  )
}

/** Multiplier text for the pixel font, which has no × glyph. */
export const mx = (m: number) => `${m >= 1000 ? fmt(m, 0) : m.toFixed(2)}x`
