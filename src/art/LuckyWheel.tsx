import { memo } from 'react'
import { useUid } from './ids'
import { shade } from '../lib/pixel'

/*
  The Rewards page's Lucky Wheel, drawn as stacked layers that share one viewBox (-120..120) so the page can move them
  separately: the frame (a dark ring of light bulbs with a gold lip) stays put, the disc (the prize segments, their
  pegs and the gold hub) turns, the gloss (a soft highlight and the rim's shadow) sits still on top so the light never
  turns with the wheel, and the pointer flicks on its pivot as the pegs pass. The two bulb layers (WheelLights) are
  separate little svgs so the page can fade them in turn for a chase without repainting the wheel.

  Segment 0 is centred at the top; segment i is centred i × (360 / n) degrees clockwise from it. Each label runs along
  the rim, and the ones that would sit in the bottom half when the disc rests at `upright` degrees are turned over, so
  the resting wheel reads the right way up all round (the page re-aims them mid-spin, while the wheel is a blur).

  Every layer is memoised: the page re-renders around them every second (its countdowns) and they rarely change.
*/

export interface WheelSegment {
  label: string
  color: string
  /** coins drawn under the label, 1 to 4: bigger prizes get a bigger pile */
  coins: number
}

const VIEW = '-120 -120 240 240'
const FONT = 'Manrope, system-ui, sans-serif'
const R_DISC = 97
const R_SEG = 95
const BULBS = 20
const R_BULB = 108

/** where the pointer pivots, as a CSS transform-origin over the full box */
export const POINTER_ORIGIN = '50% 3.75%'

const rad = (d: number) => (d * Math.PI) / 180
const pt = (r: number, a: number) => [+(r * Math.sin(rad(a))).toFixed(2), +(-r * Math.cos(rad(a))).toFixed(2)] as const

/** a pie slice from the centre, between angles a0 and a1 (degrees clockwise from the top) */
function slice(r: number, a0: number, a1: number) {
  const [x0, y0] = pt(r, a0)
  const [x1, y1] = pt(r, a1)
  return `M0 0L${x0} ${y0}A${r} ${r} 0 0 1 ${x1} ${y1}Z`
}

/** The static ring: dark lacquer, a gold lip around the disc and the bulbs' unlit glass. */
export const WheelFrame = memo(function WheelFrame({ size }: { size: number | string }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox={VIEW} className="absolute inset-0" aria-hidden>
      <defs>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a2a7a" />
          <stop offset=".55" stopColor="#24185a" />
          <stop offset="1" stopColor="#140c38" />
        </linearGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0b0" />
          <stop offset=".45" stopColor="#f7c548" />
          <stop offset="1" stopColor="#b97c12" />
        </linearGradient>
      </defs>
      <circle r="118" fill="#0b0720" />
      <circle r="116" fill={`url(#${u}r)`} />
      <circle r="115" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="1.2" />
      <circle r={R_DISC + 2.4} fill="none" stroke={`url(#${u}g)`} strokeWidth="4.8" />
      <circle r={R_DISC + 4.9} fill="none" stroke="#0b0720" strokeOpacity=".55" strokeWidth="1" />
      {Array.from({ length: BULBS }, (_, i) => {
        const [x, y] = pt(R_BULB, (i * 360) / BULBS)
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="4.6" fill="#0b0720" opacity=".7" />
            <circle cx={x} cy={y} r="3.5" fill="#6b5a35" />
            <circle cx={x - 1} cy={y - 1.1} r="1.2" fill="#fff" opacity=".25" />
          </g>
        )
      })}
    </svg>
  )
})

/** One set of lit bulbs (every other one, starting at `phase` 0 or 1), to fade over the frame. */
export const WheelLights = memo(function WheelLights({ size, phase }: { size: number | string; phase: 0 | 1 }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox={VIEW} className="absolute inset-0" aria-hidden>
      <defs>
        <radialGradient id={`${u}h`}>
          <stop offset="0" stopColor="#ffe9a0" stopOpacity=".9" />
          <stop offset="1" stopColor="#ffb83a" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}b`} cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".5" stopColor="#fff2c2" />
          <stop offset="1" stopColor="#ffc64a" />
        </radialGradient>
      </defs>
      {Array.from({ length: BULBS / 2 }, (_, k) => {
        const [x, y] = pt(R_BULB, ((k * 2 + phase) * 360) / BULBS)
        return (
          <g key={k}>
            <circle cx={x} cy={y} r="9" fill={`url(#${u}h)`} />
            <circle cx={x} cy={y} r="3.6" fill={`url(#${u}b)`} />
          </g>
        )
      })}
    </svg>
  )
})

/** A small gold coin, drawn round (cx, cy) with radius r. */
function DiscCoin({ cx, cy, r, grad }: { cx: number; cy: number; r: number; grad: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy + r * 0.22} r={r} fill="#000" opacity=".22" />
      <circle cx={cx} cy={cy} r={r} fill={`url(#${grad})`} stroke="#8a5a0c" strokeWidth={r * 0.16} />
      <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke="#b97c12" strokeWidth={r * 0.12} opacity=".7" />
      <circle cx={cx - r * 0.35} cy={cy - r * 0.38} r={r * 0.22} fill="#fff" opacity=".6" />
    </g>
  )
}

/** where each coin of a pile of n sits, relative to the pile's middle */
const PILES: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [
    [-5, 1.5],
    [5, -1.5],
  ],
  3: [
    [-6.5, 2.5],
    [6.5, 2.5],
    [0, -3.5],
  ],
  4: [
    [-7, 3],
    [7, 3],
    [-3.5, -4],
    [3.5, -4],
  ],
}

/** the height the labels' middles sit at: they turn over about it */
const LABEL_MID = -68

/**
 * The turning disc: the segments with their prize and a pile of coins, gold dividers and pegs, and the hub. With `lit`
 * set, the other segments dim so the winner stands out. `upright` is the disc's rotation the labels are aimed for.
 */
export const WheelDisc = memo(function WheelDisc({ size, segments, lit = null, upright = 0 }: { size: number | string; segments: WheelSegment[]; lit?: number | null; upright?: number }) {
  const u = useUid()
  const n = segments.length
  const seg = 360 / n
  return (
    <svg width={size} height={size} viewBox={VIEW} className="absolute inset-0" aria-hidden>
      <defs>
        {segments.map((s, i) => (
          <radialGradient key={i} id={`${u}s${i}`} cx="0" cy="0" r={R_SEG} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={shade(s.color, -0.42)} />
            <stop offset=".42" stopColor={shade(s.color, -0.08)} />
            <stop offset=".86" stopColor={s.color} />
            <stop offset=".95" stopColor={shade(s.color, 0.22)} />
            <stop offset="1" stopColor={shade(s.color, -0.18)} />
          </radialGradient>
        ))}
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset=".55" stopColor="#f7c548" />
          <stop offset="1" stopColor="#d99a1e" />
        </linearGradient>
        <radialGradient id={`${u}hub`} cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".45" stopColor="#f7c548" />
          <stop offset="1" stopColor="#a86c0e" />
        </radialGradient>
      </defs>
      <circle r={R_DISC} fill="#120b30" />
      {segments.map((s, i) => {
        const a = i * seg
        const dim = lit != null && lit !== i
        const long = s.label.length > 3
        const ink = shade(s.color, -0.62)
        // where this label ends up on screen when the disc rests at `upright`: in the bottom half it turns over
        const onScreen = (((a + upright) % 360) + 360) % 360
        const over = onScreen > 90 && onScreen < 270
        return (
          <g key={i}>
            <path d={slice(R_SEG, a - seg / 2, a + seg / 2)} fill={`url(#${u}s${i})`} />
            <g transform={`rotate(${a})`}>
              <text
                transform={over ? `rotate(180 0 ${LABEL_MID})` : undefined}
                y={long ? -63 : -61}
                textAnchor="middle"
                fontSize={long ? 15.5 : 20}
                fontWeight="900"
                fontFamily={FONT}
                fill="#fff"
                stroke={ink}
                strokeWidth={long ? 3.6 : 4.2}
                strokeLinejoin="round"
                paintOrder="stroke"
                letterSpacing={long ? -0.4 : 0}
              >
                {s.label}
              </text>
              {(PILES[Math.max(1, Math.min(4, s.coins))] ?? PILES[1]).map(([x, y], k) => (
                <DiscCoin key={k} cx={x} cy={-38 + y} r={5.6} grad={`${u}c`} />
              ))}
            </g>
            {dim && <path d={slice(R_SEG, a - seg / 2, a + seg / 2)} fill="#0a0620" opacity=".45" />}
          </g>
        )
      })}
      {/* dividers and the pegs the pointer catches on, one at each boundary */}
      {segments.map((_, i) => {
        const a = i * seg + seg / 2
        const [x0, y0] = pt(25, a)
        const [x1, y1] = pt(R_SEG, a)
        const [px, py] = pt(R_SEG - 5.5, a)
        return (
          <g key={i}>
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#2a1a05" strokeOpacity=".45" strokeWidth="4" />
            <line x1={x0} y1={y0} x2={x1} y2={y1} stroke="#ffd36b" strokeWidth="1.8" />
            <circle cx={px} cy={py + 0.8} r="3.6" fill="#000" opacity=".35" />
            <circle cx={px} cy={py} r="3.4" fill={`url(#${u}c)`} stroke="#7a4d08" strokeWidth=".9" />
            <circle cx={px - 1} cy={py - 1.1} r="1" fill="#fff" opacity=".8" />
          </g>
        )
      })}
      {/* the hub: a big gold coin with a star */}
      <circle r="27" fill="#120b30" opacity=".55" />
      <circle r="24" fill="#1d1248" stroke="#ffd36b" strokeOpacity=".5" strokeWidth="1.2" />
      <circle r="19.5" fill={`url(#${u}hub)`} stroke="#7a4d08" strokeWidth="1.4" />
      <circle r="14.5" fill="none" stroke="#b97c12" strokeWidth="1.3" opacity=".7" />
      <path d="M0 -9.6 2.8 -3.4 9.4 -2.9 4.4 1.5 5.9 8.1 0 4.6 -5.9 8.1 -4.4 1.5 -9.4 -2.9 -2.8 -3.4Z" fill="#a86c0e" opacity=".85" />
      <ellipse cx="-6.5" cy="-8.5" rx="5" ry="3" fill="#fff" opacity=".45" transform="rotate(-30 -6.5 -8.5)" />
    </svg>
  )
})

/** The still light on top of the disc: a soft sheen from the top left and a shadow tucked under the rim. */
export const WheelGloss = memo(function WheelGloss({ size }: { size: number | string }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox={VIEW} className="pointer-events-none absolute inset-0" aria-hidden>
      <defs>
        <radialGradient id={`${u}e`} cx="0" cy="0" r={R_DISC} gradientUnits="userSpaceOnUse">
          <stop offset=".8" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".42" />
        </radialGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".05" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${u}k`}>
          <circle r={R_DISC} />
        </clipPath>
      </defs>
      <circle r={R_DISC} fill={`url(#${u}e)`} />
      <g clipPath={`url(#${u}k)`}>
        <path d="M-97 -6C-80 -58 -40 -90 8 -97C-34 -76 -62 -44 -76 2Z" fill={`url(#${u}s)`} />
      </g>
    </svg>
  )
})

/** The pointer at the top: a red flapper on a gold pivot, its tip reaching down between the pegs. */
export const WheelPointer = memo(function WheelPointer({ size }: { size: number | string }) {
  const u = useUid()
  return (
    <svg width={size} height={size} viewBox={VIEW} className="absolute inset-0 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ff7a8a" />
          <stop offset=".5" stopColor="#f0364f" />
          <stop offset="1" stopColor="#b51732" />
        </linearGradient>
        <radialGradient id={`${u}g`} cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#a86c0e" />
        </radialGradient>
      </defs>
      <path d="M-11 -111A11 11 0 1 1 11 -111L2.2 -84.5Q0 -80.5 -2.2 -84.5Z" fill="#000" opacity=".35" transform="translate(0 2.5)" />
      <path d="M-11 -111A11 11 0 1 1 11 -111L2.2 -84.5Q0 -80.5 -2.2 -84.5Z" fill={`url(#${u}p)`} stroke="#4a0716" strokeWidth="2" strokeLinejoin="round" />
      <path d="M-6 -114A7 7 0 0 1 3 -119" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <circle cy="-111" r="5" fill={`url(#${u}g)`} stroke="#6b4206" strokeWidth="1.2" />
    </svg>
  )
})
