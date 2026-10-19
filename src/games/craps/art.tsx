import type { ReactNode } from 'react'
import { useUid } from '../../art/ids'
import type { Die } from './rules'

/*
  Craps' flat art: the dice as the felt prints them (cream pictograms with green pips) and as they are on the table
  (casino red, white pips) for the readouts and the screen without 3D; the dealer's puck, ON and OFF; the Fire Bet's
  flame; and the big outlined lettering of the win banners.
*/

/** pip centres on a unit face */
export const PIPS: Record<Die, readonly (readonly [number, number])[]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.27, 0.27],
    [0.73, 0.73],
  ],
  3: [
    [0.26, 0.26],
    [0.5, 0.5],
    [0.74, 0.74],
  ],
  4: [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ],
  5: [
    [0.26, 0.26],
    [0.74, 0.26],
    [0.5, 0.5],
    [0.26, 0.74],
    [0.74, 0.74],
  ],
  6: [
    [0.28, 0.24],
    [0.72, 0.24],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.76],
    [0.72, 0.76],
  ],
}

export const CREAM = '#f1e6c8'
export const GOLD = '#e6bd62'
export const RED = '#e0473f'
export const FELT_INK = '#0d3b2a'

/** a die pictogram at (x, y), s across, inside an SVG: printed on the felt, cream with green pips */
export function FeltDie({ n, x, y, s, fill = CREAM, ink = FELT_INK }: { n: Die; x: number; y: number; s: number; fill?: string; ink?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.2} fill={fill} />
      {PIPS[n].map(([px, py], i) => (
        <circle key={i} cx={x + px * s} cy={y + py * s} r={s * (n === 1 ? 0.13 : 0.095)} fill={ink} />
      ))}
    </g>
  )
}

/** a casino die as its own little image, `size` px: translucent red with white pips, as on the table */
export function RedDie({ n, size = 24, className, dim }: { n: Die; size?: number; className?: string; dim?: boolean }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} role="img" aria-label={String(n)}>
      <defs>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#f2464a" />
          <stop offset=".55" stopColor="#c8141f" />
          <stop offset="1" stopColor="#8e0712" />
        </linearGradient>
      </defs>
      <rect x="0.6" y="0.6" width="18.8" height="18.8" rx="4.2" fill={`url(#${u}r)`} opacity={dim ? 0.55 : 1} />
      <rect x="1.6" y="1.4" width="16.8" height="7" rx="3.2" fill="#fff" opacity=".13" />
      <rect x="0.6" y="0.6" width="18.8" height="18.8" rx="4.2" fill="none" stroke="#4a0208" strokeOpacity=".55" strokeWidth=".8" />
      {PIPS[n].map(([px, py], i) => (
        <circle key={i} cx={1 + px * 18} cy={1 + py * 18} r={n === 1 ? 2.3 : 1.75} fill="#fbf7ee" />
      ))}
    </svg>
  )
}

/** the dealer's puck: white with ON when a point is set, black with OFF when not */
export function PuckGlyph({ on, size, label }: { on: boolean; size: number; label?: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="21.6" r="18" fill="#000" opacity=".4" />
      <circle cx="20" cy="20" r="18" fill={on ? '#f4f1ea' : '#141214'} />
      <circle cx="20" cy="20" r="18" fill="none" stroke={on ? '#c9c2b4' : '#3a3438'} strokeWidth="1.4" />
      <circle cx="20" cy="20" r="13.6" fill="none" stroke={on ? '#141214' : '#f4f1ea'} strokeWidth="1.6" />
      <text x="20" y="20" dy=".36em" textAnchor="middle" fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif" fontWeight="900" fontSize={on ? 12.5 : 10.5} letterSpacing=".4" fill={on ? '#141214' : '#f4f1ea'}>
        {label ?? (on ? 'ON' : 'OFF')}
      </text>
    </svg>
  )
}

/** a flame, inside an SVG: the Fire Bet's mark (lit) or its ghost (unlit) */
export function Flame({ x, y, s, lit, id }: { x: number; y: number; s: number; lit: boolean; id: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s / 24})`}>
      <path
        d="M12 1.5c1.2 3.6 5.6 6.4 5.6 12.2A5.6 5.6 0 0 1 6.4 13.7c0-2.4 1.2-4.1 2.4-5.3.2 1.6 1 2.7 2.1 3.2-.5-3.6.2-7 1.1-10.1Z"
        fill={lit ? `url(#${id})` : 'rgba(255,140,60,.14)'}
        stroke={lit ? '#7a2a00' : '#ffb36b'}
        strokeOpacity={0.8}
        strokeWidth={lit ? 1.1 : 1.3}
        strokeLinejoin="round"
      />
      {lit && <path d="M12 9.5c.8 2 2.6 3.2 2.6 5.6a2.6 2.6 0 0 1-5.2 0c0-1.3.6-2.2 1.3-2.9.2 1 .7 1.4 1.2 1.6-.2-1.6 0-3 .1-4.3Z" fill="#fff4b8" />}
    </g>
  )
}

/** the flame's paint, for a <defs> */
export function FlameDefs({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#ffe066" />
      <stop offset=".5" stopColor="#ff8a1f" />
      <stop offset="1" stopColor="#e8341c" />
    </linearGradient>
  )
}

/** Big lettering with a gradient face and an ink outline (a solid copy of the text behind the face). */
export function Lettering({ text, face, size }: { text: string; face: string; size: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight ${size}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] text-[#0b1f16] [-webkit-text-stroke:0.16em_#0b1f16] [filter:drop-shadow(0_0.07em_0_#0b1f16)]">
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${face}`}>{text}</span>
    </span>
  )
}

export const FACE = {
  gold: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]',
  fire: 'bg-[linear-gradient(180deg,#fff3a8_0%,#ffb627_40%,#ff5a1f_75%,#d61f1f_100%)]',
}
