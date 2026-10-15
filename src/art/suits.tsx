import type { SVGProps } from 'react'

export type Suit = '♠' | '♥' | '♦' | '♣'

export const RED = '#e8344e'
export const BLACK = '#1b2a38'
export const isRed = (s: Suit) => s === '♥' || s === '♦'
export const suitColor = (s: Suit) => (isRed(s) ? RED : BLACK)

/** Suit shapes in a 24×24 box, as paths so they render the same everywhere (no font glyphs). */
export function SuitShape({ suit, ...p }: { suit: Suit } & SVGProps<SVGGElement>) {
  switch (suit) {
    case '♥':
      return (
        <g {...p}>
          <path d="M12 21.2s-8.6-5.1-10.3-10.4C.5 6.9 2.9 3 6.8 3c2.4 0 4.1 1.3 5.2 3.1C13.1 4.3 14.8 3 17.2 3c3.9 0 6.3 3.9 5.1 7.8C20.6 16.1 12 21.2 12 21.2Z" />
        </g>
      )
    case '♦':
      return (
        <g {...p}>
          <path d="M12 1.5c2.2 3.6 5 7 8.4 10.5-3.4 3.5-6.2 6.9-8.4 10.5C9.8 18.9 7 15.5 3.6 12 7 8.5 9.8 5.1 12 1.5Z" />
        </g>
      )
    case '♠':
      return (
        <g {...p}>
          <path d="M12 1.8C9.6 5.8 2.6 9 2.6 14.1c0 3 2.3 5 4.9 5 1.7 0 3-.8 3.8-2-.3 2.1-1.2 3.6-2.9 5.3h7.2c-1.7-1.7-2.6-3.2-2.9-5.3.8 1.2 2.1 2 3.8 2 2.6 0 4.9-2 4.9-5C21.4 9 14.4 5.8 12 1.8Z" />
        </g>
      )
    case '♣':
      return (
        <g {...p}>
          <circle cx="12" cy="6.6" r="4.6" />
          <circle cx="6.4" cy="13.4" r="4.6" />
          <circle cx="17.6" cy="13.4" r="4.6" />
          <path d="M10.6 11h2.8l.3 5c.3 2.4 1.2 4 2.9 5.6H7.4c1.7-1.6 2.6-3.2 2.9-5.6Z" />
        </g>
      )
  }
}

export function SuitIcon({ suit, size = 16, color, className }: { suit: Suit; size?: number; color?: string; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <SuitShape suit={suit} fill={color ?? suitColor(suit)} />
    </svg>
  )
}
