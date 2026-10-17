import type { ReactNode } from 'react'
import { useUid } from '../../art/ids'
import type { SymbolId } from './rules'
import { GOLD, Lin, Rad, shadow, starPath, twinkle } from './symbolkit'
import { Cherry, FI, Grapes, Lemon, Seven } from './coversymbols'
import { Acorn, Banana, Boot, Butterfly, Canteen, Champagne, Daisy, GoldenKey, Kiwi, Pear, Perfume, Plum, Snail, Stetson, Watch, Wheel } from './blanks'

export { starPath, twinkle }

/*
  The 48 symbols under the foil, twelve per card (eight prizes here, four blanks in blanks.tsx), each in a 100 × 100
  box. Shapes are flat shades of one hue lit from the top left with a dark ink outline in the card's own ink colour, so
  they read at 20 px in the prize table as well as at 120 px in a cell. No SVG filters: a card shows seventeen of them
  at once.
*/

/** a heart-shaped leaf pointing up from (50, 50), rotated by `a` degrees */
const leaf = (a: number) => <path d="M50 50 C38 42 30 30 36 22 C41 16 48 19 50 25 C52 19 59 16 64 22 C70 30 62 42 50 50Z" transform={`rotate(${a} 50 50)`} />

/* ---------------- Lucky Clover (ink: deep green) ---------------- */

const CI = '#163a23'

function Mushroom({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}st`} stops={[[0, '#fffaf0'], [1, '#e8d9b8']]} x2={1} y2={0} />
        <Rad id={`${u}cap`} stops={[[0, '#ff9a8a'], [0.45, '#f1443a'], [1, '#a81c1f']]} cx={0.38} cy={0.25} r={0.9} />
      </defs>
      {shadow(24)}
      <path d="M40 56 Q38 74 34 86 Q50 92 66 86 Q62 74 60 56Z" fill={`url(#${u}st)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M57 62 Q58 74 61 84" stroke="#cdbb96" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d="M12 58 C10 30 30 14 50 14 C70 14 90 30 88 58 C70 66 30 66 12 58Z" fill={`url(#${u}cap)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M17 57 C35 62 65 62 83 57" stroke="#7d1214" strokeWidth="2" fill="none" opacity=".5" />
      <ellipse cx="50" cy="28" rx="9" ry="6" fill="#fff8ec" />
      <ellipse cx="28" cy="40" rx="7" ry="5.5" fill="#fff8ec" />
      <ellipse cx="72" cy="40" rx="7" ry="5.5" fill="#fff8ec" />
      <ellipse cx="42" cy="49" rx="5" ry="3.6" fill="#fff8ec" />
      <ellipse cx="62" cy="50" rx="4.4" ry="3.2" fill="#fff8ec" />
      <path d="M22 34 C26 24 34 19 42 18" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".55" />
    </g>
  )
}

function CloverCoin({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}c`} stops={GOLD} x1={0.2} y1={0} x2={0.8} y2={1} />
        <Lin id={`${u}e`} stops={[[0, '#d88f10'], [1, '#8a5205']]} />
      </defs>
      {shadow(26)}
      <ellipse cx="50" cy="55" rx="34" ry="34" fill={`url(#${u}e)`} stroke={CI} strokeWidth="3" />
      <circle cx="50" cy="49" r="34" fill={`url(#${u}c)`} stroke={CI} strokeWidth="3" />
      <circle cx="50" cy="49" r="26" fill="none" stroke="#c4800c" strokeWidth="2.4" strokeDasharray="1.6 3.2" />
      <g fill="#d18a10" transform="translate(0 -1) scale(1)">
        <g transform="translate(50 49) scale(.5) translate(-50 -50)">
          {leaf(0)}
          {leaf(120)}
          {leaf(240)}
        </g>
      </g>
      <g fill="#ffe9a1" transform="translate(-1 -2)">
        <g transform="translate(50 49) scale(.5) translate(-50 -50)">
          {leaf(0)}
          {leaf(120)}
          {leaf(240)}
        </g>
      </g>
      <path d="M26 36 A28 28 0 0 1 44 22" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
    </g>
  )
}

function Ladybug({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}b`} stops={[[0, '#ff8d7c'], [0.5, '#e8302b'], [1, '#9b1515']]} cx={0.35} cy={0.3} r={0.85} />
      </defs>
      {shadow(26)}
      <path d="M40 24 Q34 12 26 12 M60 24 Q66 12 74 12" stroke={CI} strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="26" cy="12" r="3.5" fill={CI} />
      <circle cx="74" cy="12" r="3.5" fill={CI} />
      <g stroke={CI} strokeWidth="3" strokeLinecap="round">
        <path d="M20 50 L10 46 M20 64 L9 68 M80 50 L90 46 M80 64 L91 68 M28 78 L22 87 M72 78 L78 87" />
      </g>
      <ellipse cx="50" cy="30" rx="17" ry="12" fill="#262626" stroke={CI} strokeWidth="3" />
      <ellipse cx="44" cy="26" rx="4" ry="3" fill="#fff" opacity=".9" />
      <ellipse cx="56" cy="26" rx="4" ry="3" fill="#fff" opacity=".9" />
      <ellipse cx="50" cy="58" rx="32" ry="30" fill={`url(#${u}b)`} stroke={CI} strokeWidth="3" />
      <path d="M50 30 V87" stroke="#262626" strokeWidth="3" />
      <g fill="#262626">
        <circle cx="35" cy="48" r="6.5" />
        <circle cx="65" cy="48" r="6.5" />
        <circle cx="31" cy="68" r="5" />
        <circle cx="69" cy="68" r="5" />
        <circle cx="42" cy="80" r="4" />
        <circle cx="58" cy="80" r="4" />
      </g>
      <path d="M27 42 C30 36 36 32 42 31" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".55" />
    </g>
  )
}

function TopHat({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}h`} stops={[[0, '#3fd27a'], [0.55, '#1f9a50'], [1, '#126536']]} x2={1} y2={0} />
        <Lin id={`${u}br`} stops={[[0, '#2bb764'], [1, '#0f5a2f']]} />
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(36, 88)}
      <ellipse cx="50" cy="76" rx="42" ry="12" fill={`url(#${u}br)`} stroke={CI} strokeWidth="3" />
      <path d="M26 74 L30 18 Q50 12 70 18 L74 74 Q50 82 26 74Z" fill={`url(#${u}h)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <ellipse cx="50" cy="18" rx="20" ry="5" fill="#2fc56d" stroke={CI} strokeWidth="2.5" />
      <path d="M28 56 Q50 63 72 56 L73 70 Q50 77 27 70Z" fill="#1d1d1d" stroke={CI} strokeWidth="2.5" />
      <rect x="40" y="55" width="20" height="17" rx="2.5" fill="none" stroke={`url(#${u}g)`} strokeWidth="5" />
      <rect x="40" y="55" width="20" height="17" rx="2.5" fill="none" stroke={CI} strokeWidth="1.2" />
      <path d="M35 24 L33 50" stroke="#9ff0bf" strokeWidth="4" strokeLinecap="round" opacity=".6" />
      <path d="M78 34 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2Z" fill="#fff6c8" />
    </g>
  )
}

/** a lucky golden horseshoe, open end up: flared heels with calkins, a groove round the middle and its nail holes */
function Horseshoe({ u }: { u: string }) {
  // the groove, and points along it for the nail holes (angle along the curve)
  const nails: [number, number, number][] = [
    [27, 30, 4],
    [26.5, 46, -4],
    [30, 61, -22],
    [70, 61, 22],
    [73.5, 46, 4],
    [73, 30, -4],
  ]
  return (
    <g>
      <defs>
        <Lin id={`${u}h`} stops={[[0, '#fff4c2'], [0.35, '#ffd451'], [0.75, '#e2971a'], [1, '#a8640a']]} x1={0.1} y1={0} x2={0.9} y2={1} />
        <Lin id={`${u}k`} stops={[[0, '#e8a21a'], [1, '#8a5205']]} />
      </defs>
      {shadow(30, 92)}
      <path d="M15 20 C9 44 12 70 30 84 C40 92 60 92 70 84 C88 70 91 44 85 20 L65 20 C70 42 70 60 62 70 C56 77 44 77 38 70 C30 60 30 42 35 20 Z" fill={`url(#${u}h)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M13 12 H37 L35 22 H15Z M63 12 H87 L85 22 H65Z" fill={`url(#${u}k)`} stroke={CI} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M25.5 23 C21 45 23 66 36.5 79 C44 85.5 56 85.5 63.5 79 C77 66 79 45 74.5 23" stroke="#b47408" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity=".85" />
      <g fill="#5a3404">
        {nails.map(([x, y, a]) => (
          <rect key={`${x}${y}`} x={x - 1.8} y={y - 3.2} width="3.6" height="6.4" rx="1.2" transform={`rotate(${a} ${x} ${y})`} />
        ))}
      </g>
      <path d="M18 26 C14 46 17 66 30 78" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".75" />
      <path d={twinkle(82, 34, 7)} fill="#fff" />
    </g>
  )
}

function Rainbow({ u }: { u: string }) {
  const bands = ['#ff4d5e', '#ff9b3d', '#ffe14a', '#4cd964', '#3fa8ff', '#8c6bff']
  return (
    <g>
      <defs>
        <Lin id={`${u}cl`} stops={[[0, '#ffffff'], [1, '#d6e4f2']]} />
      </defs>
      {shadow(36, 86, 0.15)}
      <path d="M12 72 A38 38 0 0 1 88 72" fill="none" stroke={CI} strokeWidth="39" />
      {bands.map((c, i) => (
        <path key={c} d={`M${12 + i * 6} 72 A${38 - i * 6} ${38 - i * 6} 0 0 1 ${88 - i * 6} 72`} fill="none" stroke={c} strokeWidth="6.4" />
      ))}
      <path d="M20 60 A31 31 0 0 1 38 39" fill="none" stroke="#fff" strokeWidth="2.4" opacity=".55" strokeLinecap="round" />
      {[
        [17, 74],
        [83, 74],
      ].map(([x, y]) => (
        <g key={x} stroke={CI} strokeWidth="3" fill={`url(#${u}cl)`}>
          <path d={`M${x - 15} ${y + 8} a8 8 0 0 1 4 -12 a9 9 0 0 1 16 -2 a7 7 0 0 1 10 8 a6 6 0 0 1 -2 6Z`} strokeLinejoin="round" />
        </g>
      ))}
    </g>
  )
}

function FourLeaf({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}l`} stops={[[0, '#8ef09a'], [0.5, '#2ec25a'], [1, '#13843a']]} cx={0.5} cy={0.45} r={0.6} />
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(28)}
      <path d="M52 52 Q60 70 72 88" stroke={CI} strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M52 52 Q60 70 72 88" stroke="#22a24c" strokeWidth="4" fill="none" strokeLinecap="round" />
      <g fill={`url(#${u}l)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" transform="translate(50 50) scale(1.22) translate(-50 -50)">
        {leaf(45)}
        {leaf(135)}
        {leaf(225)}
        {leaf(315)}
      </g>
      <g stroke="#0f6a2d" strokeWidth="1.8" fill="none" opacity=".55" strokeLinecap="round" transform="translate(50 50) scale(1.22) translate(-50 -50)">
        {[45, 135, 225, 315].map((a) => (
          <path key={a} d="M50 50 L50 30" transform={`rotate(${a} 50 50)`} />
        ))}
      </g>
      <circle cx="50" cy="50" r="5" fill={`url(#${u}g)`} stroke={CI} strokeWidth="2" />
      <path d="M27 30 Q30 22 38 20" stroke="#e8ffe9" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".7" />
      <path d={twinkle(84, 16, 7)} fill="#fff6c8" />
      <path d={twinkle(14, 70, 5)} fill="#fff6c8" />
    </g>
  )
}

function PotOfGold({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}p`} stops={[[0, '#4b5560'], [0.5, '#262c33'], [1, '#121519']]} x2={1} y2={0} />
        <Lin id={`${u}g`} stops={GOLD} />
      </defs>
      {shadow(32)}
      {/* the heap of coins */}
      <path d="M18 46 C20 22 36 18 50 18 C64 18 80 22 82 46Z" fill={`url(#${u}g)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      {[
        [32, 34],
        [48, 26],
        [64, 33],
        [40, 42],
        [58, 42],
        [74, 42],
        [26, 44],
      ].map(([x, y], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx="8" ry="4" fill="#ffe27a" stroke="#b97808" strokeWidth="1.6" />
          <ellipse cx={x - 1.6} cy={y - 0.8} rx="3.2" ry="1.4" fill="#fff8d6" />
        </g>
      ))}
      {/* the pot */}
      <path d="M14 46 H86 C88 52 86 54 82 56 C86 66 84 80 72 86 H28 C16 80 14 66 18 56 C14 54 12 52 14 46Z" fill={`url(#${u}p)`} stroke={CI} strokeWidth="3" strokeLinejoin="round" />
      <rect x="11" y="44" width="78" height="10" rx="5" fill="#3a434d" stroke={CI} strokeWidth="3" />
      <path d="M24 62 C24 72 28 78 34 82" stroke="#8994a0" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".7" />
      <path d="M16 47 H50" stroke="#9aa6b2" strokeWidth="2" opacity=".7" strokeLinecap="round" />
      <path d={twinkle(80, 16, 8)} fill="#fff" />
      <path d={twinkle(22, 18, 5)} fill="#fff6c8" />
    </g>
  )
}

/* ---------------- Gold Rush (ink: dark leather) ---------------- */

const GI = '#3a1c08'

function Cactus({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}c`} stops={[[0, '#7bdc6a'], [0.5, '#3ea84a'], [1, '#22703a']]} x2={1} y2={0} />
      </defs>
      {shadow(26)}
      <g fill={`url(#${u}c)`} stroke={GI} strokeWidth="3" strokeLinejoin="round">
        <path d="M18 56 C14 56 14 36 18 32 C22 28 28 32 28 38 V52 H36 V60 H26 C22 60 20 58 18 56Z" />
        <path d="M82 46 C86 46 86 26 82 22 C78 18 72 22 72 28 V44 H64 V52 H74 C78 52 80 50 82 46Z" />
        <path d="M38 88 V22 C38 10 62 10 62 22 V88Z" />
      </g>
      <path d="M45 20 V84" stroke="#a7f09a" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <path d="M55 22 V86" stroke="#1d5e30" strokeWidth="2" opacity=".5" />
      <g stroke="#fff4c8" strokeWidth="1.5" strokeLinecap="round">
        {[30, 44, 58, 72].map((y) => (
          <path key={y} d={`M38 ${y} l-4 -2 M62 ${y + 6} l4 -2`} />
        ))}
      </g>
      <circle cx="50" cy="12" r="6" fill="#ff6fa8" stroke={GI} strokeWidth="2.5" />
      <circle cx="50" cy="12" r="2.2" fill="#ffe36b" />
      <path d="M26 88 H74" stroke={GI} strokeWidth="3" strokeLinecap="round" />
    </g>
  )
}

function Lantern({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}f`} stops={[[0, '#fffbe0'], [0.35, '#ffd34d'], [1, '#ff8a1f']]} cx={0.5} cy={0.55} r={0.6} />
        <Lin id={`${u}m`} stops={[[0, '#d8a25a'], [1, '#8a5420']]} x2={1} y2={0} />
      </defs>
      {shadow(24)}
      <path d="M36 22 Q50 2 64 22" stroke={GI} strokeWidth="4" fill="none" strokeLinecap="round" />
      <rect x="34" y="18" width="32" height="8" rx="3" fill={`url(#${u}m)`} stroke={GI} strokeWidth="3" />
      <rect x="30" y="26" width="40" height="48" rx="8" fill={`url(#${u}f)`} stroke={GI} strokeWidth="3" />
      <path d="M50 40 C44 48 44 56 50 62 C56 56 56 48 50 40Z" fill="#fff" opacity=".9" />
      <path d="M35 32 V66" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      <g stroke={GI} strokeWidth="3">
        <path d="M30 50 H70" opacity=".35" />
        <path d="M42 26 V74 M58 26 V74" opacity=".35" />
      </g>
      <path d="M26 74 H74 L70 84 H30Z" fill={`url(#${u}m)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <circle cx="50" cy="50" r="30" fill="#ffd24d" opacity=".12" />
    </g>
  )
}

function Pickaxe({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}w`} stops={[[0, '#e2a868'], [1, '#9a5b28']]} x2={1} y2={0} />
        <Lin id={`${u}i`} stops={[[0, '#f2f6fa'], [0.5, '#a8b6c4'], [1, '#5d6c7c']]} />
      </defs>
      {shadow(28)}
      <path d="M30 86 L68 22" stroke={GI} strokeWidth="13" strokeLinecap="round" />
      <path d="M30 86 L68 22" stroke={`url(#${u}w)`} strokeWidth="7" strokeLinecap="round" />
      <path d="M33 80 L62 31" stroke="#f6cf9a" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      <path d="M14 30 C30 12 60 8 88 22 C72 18 56 20 46 26 L70 32 C58 26 34 26 14 30Z" fill={`url(#${u}i)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 26 C34 17 52 14 70 16" stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity=".8" />
      <rect x="60" y="18" width="14" height="12" rx="3" transform="rotate(30 67 24)" fill="#6d7a88" stroke={GI} strokeWidth="2.5" />
    </g>
  )
}

function MineCart({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}b`} stops={[[0, '#a96a3a'], [1, '#5e3416']]} />
        <Lin id={`${u}g`} stops={GOLD} />
      </defs>
      <path d="M6 88 H94" stroke={GI} strokeWidth="4" strokeLinecap="round" />
      <path d="M12 92 V86 M30 92 V86 M48 92 V86 M66 92 V86 M84 92 V86" stroke={GI} strokeWidth="3" strokeLinecap="round" />
      {/* the gold heaped over the rim */}
      <path d="M16 46 C18 30 30 22 42 28 C48 18 62 18 66 28 C76 24 86 32 84 46Z" fill={`url(#${u}g)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M28 34 l4 -3 4 3 -4 3Z M52 26 l4 -3 4 3 -4 3Z M68 36 l3 -3 4 3 -3 3Z" fill="#fff6c8" />
      <path d="M12 44 H88 L80 76 H20Z" fill={`url(#${u}b)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M16 52 H84" stroke="#3b1c08" strokeWidth="2" opacity=".5" />
      <path d="M18 66 H82" stroke="#3b1c08" strokeWidth="2" opacity=".5" />
      <g fill="#c9d3dc" stroke={GI} strokeWidth="1.5">
        <circle cx="20" cy="50" r="2.2" />
        <circle cx="80" cy="50" r="2.2" />
        <circle cx="24" cy="70" r="2.2" />
        <circle cx="76" cy="70" r="2.2" />
      </g>
      {[32, 68].map((x) => (
        <g key={x}>
          <circle cx={x} cy="80" r="9" fill="#4b5560" stroke={GI} strokeWidth="3" />
          <circle cx={x} cy="80" r="3" fill="#aeb8c2" />
        </g>
      ))}
    </g>
  )
}

function Dynamite({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}s`} stops={[[0, '#ff6b5c'], [0.5, '#e02a2a'], [1, '#981818']]} x2={1} y2={0} />
      </defs>
      {shadow(26)}
      <path d="M50 30 C52 18 62 14 70 12" stroke={GI} strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d={twinkle(72, 11, 9)} fill="#ffe14a" />
      <path d={twinkle(72, 11, 4.5)} fill="#fff" />
      {[30, 50, 70].map((x, i) => (
        <g key={x}>
          <rect x={x - 10} y={i === 1 ? 26 : 32} width="20" height={i === 1 ? 60 : 54} rx="5" fill={`url(#${u}s)`} stroke={GI} strokeWidth="3" />
          <ellipse cx={x} cy={i === 1 ? 28 : 34} rx="8" ry="3" fill="#ffb3a6" opacity=".8" />
          <path d={`M${x - 5} ${i === 1 ? 34 : 40} V${i === 1 ? 80 : 80}`} stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".45" />
        </g>
      ))}
      <rect x="16" y="54" width="68" height="12" rx="2" fill="#2b2b2b" stroke={GI} strokeWidth="2.5" />
      <text x="50" y="63.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#ffe14a" fontFamily="Manrope, system-ui, sans-serif" letterSpacing="1">
        TNT
      </text>
    </g>
  )
}

function SheriffStar({ u }: { u: string }) {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 2
    return [50 + Math.cos(a) * 38, 50 + Math.sin(a) * 38] as const
  })
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} x1={0.1} y1={0} x2={0.9} y2={1} />
      </defs>
      {shadow(26, 92)}
      <path d={starPath(50, 50, 36, 19, 6)} fill={`url(#${u}g)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="6" fill={`url(#${u}g)`} stroke={GI} strokeWidth="2.5" />
      ))}
      <circle cx="50" cy="50" r="15" fill="#e7a51f" stroke="#a96a08" strokeWidth="2" />
      <path d={starPath(50, 50, 10, 4.5)} fill="#fff1b0" />
      <path d="M30 34 L40 32" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".7" />
    </g>
  )
}

function GoldBars({ u }: { u: string }) {
  const bar = (x: number, y: number) => (
    <g key={`${x}${y}`}>
      <path d={`M${x} ${y + 18} L${x + 6} ${y} H${x + 30} L${x + 36} ${y + 18}Z`} fill={`url(#${u}g)`} stroke={GI} strokeWidth="2.6" strokeLinejoin="round" />
      <path d={`M${x + 8} ${y + 3} H${x + 28} L${x + 31} ${y + 12} H${x + 5}Z`} fill="#ffe89a" opacity=".85" />
      <path d={`M${x} ${y + 18} H${x + 36}`} stroke="#9a5f06" strokeWidth="2" />
    </g>
  )
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} />
      </defs>
      {shadow(36, 86)}
      {bar(10, 64)}
      {bar(46, 64)}
      {bar(28, 44)}
      {bar(64, 44)}
      {bar(46, 24)}
      <path d={twinkle(26, 26, 7)} fill="#fff" />
      <path d={twinkle(86, 30, 5)} fill="#fff6c8" />
    </g>
  )
}

function Nugget({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={[[0, '#fff6c8'], [0.3, '#ffd94a'], [0.7, '#e59a12'], [1, '#9a5a04']]} x1={0.15} y1={0} x2={0.85} y2={1} />
      </defs>
      {shadow(34)}
      <path d="M14 58 L20 34 L38 18 L62 16 L82 30 L88 54 L76 78 L50 86 L24 80Z" fill={`url(#${u}g)`} stroke={GI} strokeWidth="3" strokeLinejoin="round" />
      <g stroke="#b2700a" strokeWidth="1.8" fill="none" strokeLinejoin="round" opacity=".8">
        <path d="M20 34 L40 40 L38 18 M40 40 L62 16 M40 40 L56 48 L82 30 M56 48 L88 54 M56 48 L50 86 M40 40 L24 80 M56 48 L76 78 M40 40 L14 58" />
      </g>
      <path d="M38 18 L62 16 L40 40Z" fill="#fff8d4" opacity=".75" />
      <path d="M20 34 L38 18 L40 40Z" fill="#ffeb8f" opacity=".7" />
      <path d="M56 48 L88 54 L76 78Z" fill="#a8640a" opacity=".45" />
      <path d="M50 86 L76 78 L56 48Z" fill="#8a5004" opacity=".35" />
      <path d={twinkle(30, 26, 8)} fill="#fff" />
      <path d={twinkle(80, 20, 6)} fill="#fff" />
      <path d={twinkle(70, 66, 4)} fill="#fff6c8" />
    </g>
  )
}

/* ---------------- Fruit Frenzy (ink: deep berry) ---------------- */

function Orange({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}o`} stops={[[0, '#ffd18a'], [0.45, '#ff9418'], [1, '#d35800']]} cx={0.36} cy={0.3} r={0.8} />
      </defs>
      {shadow(30)}
      <circle cx="50" cy="56" r="33" fill={`url(#${u}o)`} stroke={FI} strokeWidth="3" />
      <g fill="#d86a00" opacity=".45">
        {[
          [36, 62],
          [46, 72],
          [60, 66],
          [66, 52],
          [54, 48],
          [40, 48],
          [70, 70],
          [32, 72],
        ].map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="1.5" />
        ))}
      </g>
      <path d="M50 24 L50 18" stroke={FI} strokeWidth="4" strokeLinecap="round" />
      <path d="M52 22 C58 10 74 8 80 14 C74 24 60 26 52 22Z" fill="#46c35b" stroke={FI} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M26 44 C30 36 38 31 46 30" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" />
    </g>
  )
}

function Strawberry({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}s`} stops={[[0, '#ff8f9c'], [0.45, '#f02a46'], [1, '#a5102b']]} cx={0.36} cy={0.3} r={0.85} />
      </defs>
      {shadow(26)}
      <path d="M50 88 C30 80 14 62 16 44 C18 30 32 26 50 30 C68 26 82 30 84 44 C86 62 70 80 50 88Z" fill={`url(#${u}s)`} stroke={FI} strokeWidth="3" strokeLinejoin="round" />
      <g fill="#ffe27a">
        {[
          [32, 44],
          [46, 42],
          [60, 44],
          [72, 48],
          [26, 56],
          [40, 56],
          [54, 56],
          [68, 60],
          [34, 68],
          [48, 70],
          [60, 72],
          [44, 80],
        ].map(([x, y], i) => (
          <ellipse key={i} cx={x} cy={y} rx="1.6" ry="2.4" />
        ))}
      </g>
      <path d="M30 32 L36 18 L44 28 L50 14 L56 28 L64 18 L70 32 C60 36 40 36 30 32Z" fill="#3fbd55" stroke={FI} strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M24 46 C26 38 32 35 38 34" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".65" />
    </g>
  )
}

function Pineapple({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}p`} stops={[[0, '#ffe99a'], [0.5, '#ffc22e'], [1, '#c97c00']]} cx={0.38} cy={0.35} r={0.8} />
        <Lin id={`${u}l`} stops={[[0, '#5fd36a'], [1, '#1f8a3a']]} />
      </defs>
      {shadow(24)}
      <g fill={`url(#${u}l)`} stroke={FI} strokeWidth="2.5" strokeLinejoin="round">
        <path d="M50 40 L36 10 L48 26 L50 4 L52 26 L64 10Z" />
        <path d="M50 40 L28 22 L46 32Z" />
        <path d="M50 40 L72 22 L54 32Z" />
      </g>
      <ellipse cx="50" cy="63" rx="24" ry="27" fill={`url(#${u}p)`} stroke={FI} strokeWidth="3" />
      <g stroke="#b06a00" strokeWidth="1.8" opacity=".7">
        <path d="M30 50 L62 86 M34 42 L72 82 M44 37 L76 70 M28 62 L50 89 M70 46 L38 86 M62 38 L28 78 M74 58 L50 89" />
      </g>
      <path d="M34 54 C36 46 42 41 48 40" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" opacity=".65" />
    </g>
  )
}

function Watermelon({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}r`} stops={[[0, '#ff7a8c'], [1, '#f02c4c']]} />
      </defs>
      {shadow(36, 84)}
      <g transform="rotate(-12 50 50)">
        <path d="M8 40 A42 42 0 0 0 92 40Z" fill="#2fa64a" stroke={FI} strokeWidth="3" strokeLinejoin="round" />
        <path d="M14 40 A36 36 0 0 0 86 40Z" fill="#c8f5b0" />
        <path d="M18 40 A32 32 0 0 0 82 40Z" fill={`url(#${u}r)`} />
        <path d="M8 40 H92" stroke={FI} strokeWidth="3" strokeLinecap="round" />
        <g fill="#2b1020">
          {[
            [32, 50],
            [44, 56],
            [56, 56],
            [68, 50],
            [38, 64],
            [50, 66],
            [62, 64],
          ].map(([x, y], i) => (
            <ellipse key={i} cx={x} cy={y} rx="2" ry="3.2" transform={`rotate(${(x - 50) * 0.8} ${x} ${y})`} />
          ))}
        </g>
        <path d="M22 44 H46" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      </g>
      <path d={twinkle(84, 74, 6)} fill="#fff" />
    </g>
  )
}

/* ---------------- Diamond Deluxe (ink: midnight) ---------------- */

const DI = '#0b0620'

/** a lustrous pearl sitting in an open scallop shell */
function Pearl({ u }: { u: string }) {
  // ridges fan out from the shell's hinge
  const fan = (cx: number, cy: number, r: number, a0: number, a1: number, n: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = a0 + ((a1 - a0) * (i + 1)) / (n + 1)
      return `M${cx} ${cy} L${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`
    }).join(' ')
  return (
    <g>
      <defs>
        <Lin id={`${u}t`} stops={[[0, '#fff4f7'], [1, '#f1b4c8']]} />
        <Lin id={`${u}b`} stops={[[0, '#ffe6ee'], [1, '#e693b0']]} />
        <Rad id={`${u}p`} stops={[[0, '#ffffff'], [0.4, '#f8f2f8'], [0.78, '#dccdea'], [1, '#a893c4']]} cx={0.36} cy={0.3} r={0.78} />
        <Rad id={`${u}i`} stops={[[0, '#bdf3ff'], [1, '#bdf3ff00']]} cx={0.72} cy={0.72} r={0.55} />
      </defs>
      {shadow(36, 92)}
      <clipPath id={`${u}ct`}>
        <path d="M16 56 C12 30 30 10 50 10 C70 10 88 30 84 56 Z" />
      </clipPath>
      <clipPath id={`${u}cb`}>
        <path d="M10 62 C24 66 76 66 90 62 C88 80 72 91 50 91 C28 91 12 80 10 62Z" />
      </clipPath>
      {/* the upper shell, opened up behind */}
      <path d="M16 56 C12 30 30 10 50 10 C70 10 88 30 84 56 Z" fill={`url(#${u}t)`} />
      <path d={fan(50, 58, 50, Math.PI * 1.02, Math.PI * 1.98, 7)} stroke="#d88aa6" strokeWidth="1.8" opacity=".75" clipPath={`url(#${u}ct)`} />
      <path d="M16 56 C12 30 30 10 50 10 C70 10 88 30 84 56 Z" fill="none" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      {/* the pearl */}
      <circle cx="50" cy="54" r="17" fill={`url(#${u}p)`} stroke={DI} strokeWidth="2.6" />
      <circle cx="50" cy="54" r="16" fill={`url(#${u}i)`} opacity=".7" />
      <ellipse cx="44" cy="47" rx="6" ry="4" fill="#fff" transform="rotate(-35 44 47)" />
      <circle cx="58" cy="62" r="1.8" fill="#fff" opacity=".7" />
      {/* the lower shell, the pearl resting on its lip */}
      <path d="M10 62 C24 66 76 66 90 62 C88 80 72 91 50 91 C28 91 12 80 10 62Z" fill={`url(#${u}b)`} />
      <path d={fan(50, 100, 46, Math.PI * 1.06, Math.PI * 1.94, 7)} stroke="#c06a8c" strokeWidth="1.7" opacity=".6" clipPath={`url(#${u}cb)`} />
      <path d="M10 62 C24 66 76 66 90 62 C88 80 72 91 50 91 C28 91 12 80 10 62Z" fill="none" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M16 66 C26 69 40 70 50 70" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity=".7" />
      <path d={twinkle(80, 20, 7)} fill="#fff" />
    </g>
  )
}

/** a gem's facets: a list of polygons, each a flat shade of `pal` (light to dark) */
function Facets({ faces, pal }: { faces: [string, number][]; pal: string[] }) {
  return (
    <>
      {faces.map(([d, k], i) => (
        <path key={i} d={d} fill={pal[k]} />
      ))}
    </>
  )
}

const AMETHYST = ['#f6ecff', '#dcbdff', '#bd8cff', '#9c5cf5', '#7c3ad8', '#5a22a8', '#3a1270']
const SAPPHIRE = ['#eaf4ff', '#a9d0ff', '#6aa8ff', '#3a80f2', '#2260d0', '#1644a0', '#0c2a6a']
const EMERALD = ['#e6fff1', '#a6f5c8', '#5fe39a', '#2cc373', '#1aa058', '#107840', '#08502a']
const RUBY = ['#ffe8ee', '#ffb0c2', '#ff6688', '#f02a58', '#c81642', '#960c30', '#62061e']
const ICE = ['#ffffff', '#e6faff', '#b8eeff', '#7fd8ff', '#46b8f2', '#2690d6', '#145f9e']

/** an amethyst cluster: hexagonal crystal points rising out of a rock */
function Amethyst() {
  /** one crystal: a prism of width w from the base (x, y) up to height h, its tip a point; lit left, shaded right */
  const crystal = (x: number, y: number, w: number, h: number, rot: number, k = 0) => {
    const l = x - w / 2
    const r = x + w / 2
    const shoulder = y - h + w * 0.55
    const tip = y - h
    return (
      <g key={`${x}${rot}`} transform={`rotate(${rot} ${x} ${y})`}>
        <path d={`M${l} ${y} L${l} ${shoulder} L${x} ${tip} L${x} ${y}Z`} fill={AMETHYST[2 + k]} />
        <path d={`M${x} ${y} L${x} ${tip} L${r} ${shoulder} L${r} ${y}Z`} fill={AMETHYST[4 + k]} />
        <path d={`M${l} ${shoulder} L${x} ${tip} L${x} ${shoulder + w * 0.2}Z`} fill={AMETHYST[0 + k]} />
        <path d={`M${x} ${tip} L${r} ${shoulder} L${x} ${shoulder + w * 0.2}Z`} fill={AMETHYST[3 + k]} />
        <path d={`M${l} ${y} L${l} ${shoulder} L${x} ${tip} L${r} ${shoulder} L${r} ${y}`} fill="none" stroke={DI} strokeWidth="2.8" strokeLinejoin="round" />
        <path d={`M${l + 3} ${y - 4} L${l + 3} ${shoulder + 3}`} stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".55" />
      </g>
    )
  }
  return (
    <g>
      {shadow(36, 90)}
      {crystal(32, 80, 16, 44, -24, 1)}
      {crystal(68, 80, 16, 48, 22, 1)}
      {crystal(50, 82, 20, 70, 0)}
      {crystal(39, 86, 12, 26, -8)}
      {crystal(62, 86, 12, 30, 10)}
      <path d="M14 84 C20 76 32 74 50 76 C68 74 82 76 86 84 C72 92 28 92 14 84Z" fill="#5a4670" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 83 C30 80 40 80 46 81" stroke="#9a86b8" strokeWidth="2" strokeLinecap="round" opacity=".7" fill="none" />
      <path d={twinkle(64, 24, 6)} fill="#fff" />
      <path d={twinkle(24, 46, 4)} fill="#fff" />
    </g>
  )
}

function Sapphire() {
  return (
    <g>
      {shadow(28, 92)}
      <ellipse cx="50" cy="52" rx="30" ry="36" fill={SAPPHIRE[3]} />
      <Facets
        pal={SAPPHIRE}
        faces={[
          ['M50 16 L70 30 L50 40 L30 30Z', 1],
          ['M30 30 L50 40 L34 60 L21 46Z', 2],
          ['M70 30 L79 46 L66 60 L50 40Z', 4],
          ['M34 60 L50 40 L66 60 L50 76Z', 3],
          ['M21 46 L34 60 L30 76 L22 62Z', 3],
          ['M79 46 L78 62 L70 76 L66 60Z', 5],
          ['M30 76 L34 60 L50 76 L50 88Z', 4],
          ['M70 76 L66 60 L50 76 L50 88Z', 6],
        ]}
      />
      <path d="M50 16 L70 30 L79 46 L78 62 L70 76 L50 88 L30 76 L22 62 L21 46 L30 30Z" fill="none" stroke={SAPPHIRE[6]} strokeWidth="1.2" opacity=".5" />
      <ellipse cx="50" cy="52" rx="30" ry="36" fill="none" stroke={DI} strokeWidth="3" />
      <path d="M36 26 L48 20" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".85" />
    </g>
  )
}

function Emerald() {
  return (
    <g>
      {shadow(30, 90)}
      <Facets
        pal={EMERALD}
        faces={[
          ['M28 14 H72 L84 26 V74 L72 86 H28 L16 74 V26Z', 3],
          ['M28 14 H72 L64 24 H36Z', 1],
          ['M84 26 V74 L74 68 V32Z', 5],
          ['M72 86 H28 L36 76 H64Z', 5],
          ['M16 26 V74 L26 68 V32Z', 2],
          ['M36 24 H64 L74 32 V68 L64 76 H36 L26 68 V32Z', 3],
          ['M42 34 H58 L64 40 V60 L58 66 H42 L36 60 V40Z', 2],
          ['M42 34 H58 L54 42 H46Z', 0],
        ]}
      />
      <path d="M28 14 H72 L84 26 V74 L72 86 H28 L16 74 V26Z" fill="none" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M22 30 V60" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".6" />
    </g>
  )
}

function Ruby() {
  const heart = 'M50 86 C30 72 10 58 10 38 C10 22 22 14 32 14 C40 14 46 18 50 26 C54 18 60 14 68 14 C78 14 90 22 90 38 C90 58 70 72 50 86Z'
  return (
    <g>
      {shadow(30, 92)}
      <path d={heart} fill={RUBY[3]} />
      <Facets
        pal={RUBY}
        faces={[
          ['M50 26 L50 46 L30 36 L32 14 C40 14 46 18 50 26Z', 1],
          ['M50 26 C54 18 60 14 68 14 L70 36 L50 46Z', 2],
          ['M32 14 C22 14 10 22 10 38 L30 36Z', 2],
          ['M68 14 C78 14 90 22 90 38 L70 36Z', 4],
          ['M10 38 C10 58 30 72 50 86 L30 36Z', 3],
          ['M90 38 C90 58 70 72 50 86 L70 36Z', 5],
          ['M30 36 L50 46 L70 36 L50 86Z', 4],
          ['M38 40 L50 46 L62 40 L50 68Z', 3],
        ]}
      />
      <path d={heart} fill="none" stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M20 30 C22 24 26 21 30 20" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".85" fill="none" />
    </g>
  )
}

function Brilliant({ cx, cy, w, pal = ICE }: { cx: number; cy: number; w: number; pal?: string[] }) {
  const h = w * 0.82
  const x0 = cx - w / 2
  const y0 = cy - h * 0.45
  const g = y0 + h * 0.32
  const P = (fx: number, fy: number) => `${(x0 + fx * w).toFixed(2)} ${(fy === -1 ? g : y0 + fy * h).toFixed(2)}`
  const bot = P(0.5, 1)
  return (
    <g>
      <path d={`M${P(0.22, 0)} L${P(0.78, 0)} L${P(1, 0.32)} L${bot} L${P(0, 0.32)}Z`} fill={pal[3]} />
      {/* crown */}
      <path d={`M${P(0.22, 0)} L${P(0.36, 0)} L${P(0.28, 0.32)} L${P(0, 0.32)}Z`} fill={pal[2]} />
      <path d={`M${P(0.36, 0)} L${P(0.64, 0)} L${P(0.72, 0.32)} L${P(0.28, 0.32)}Z`} fill={pal[1]} />
      <path d={`M${P(0.64, 0)} L${P(0.78, 0)} L${P(1, 0.32)} L${P(0.72, 0.32)}Z`} fill={pal[3]} />
      <path d={`M${P(0.36, 0)} L${P(0.64, 0)} L${P(0.5, 0.2)}Z`} fill={pal[0]} />
      {/* pavilion */}
      <path d={`M${P(0, 0.32)} L${P(0.28, 0.32)} L${bot}Z`} fill={pal[2]} />
      <path d={`M${P(0.28, 0.32)} L${P(0.5, 0.32)} L${bot}Z`} fill={pal[1]} />
      <path d={`M${P(0.5, 0.32)} L${P(0.72, 0.32)} L${bot}Z`} fill={pal[4]} />
      <path d={`M${P(0.72, 0.32)} L${P(1, 0.32)} L${bot}Z`} fill={pal[5]} />
      <path d={`M${P(0, 0.32)} L${P(1, 0.32)}`} stroke={pal[0]} strokeWidth={w * 0.012} opacity=".7" />
      <path d={`M${P(0.22, 0)} L${P(0.78, 0)} L${P(1, 0.32)} L${bot} L${P(0, 0.32)}Z`} fill="none" stroke={DI} strokeWidth={Math.max(2.4, w * 0.04)} strokeLinejoin="round" />
    </g>
  )
}

function Ring({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(26, 92)}
      <ellipse cx="50" cy="64" rx="27" ry="24" fill="none" stroke={DI} strokeWidth="13" />
      <ellipse cx="50" cy="64" rx="27" ry="24" fill="none" stroke={`url(#${u}g)`} strokeWidth="8" />
      <path d="M28 54 A27 24 0 0 1 40 42" stroke="#fff" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity=".8" />
      <path d="M40 42 L44 34 H56 L60 42Z" fill={`url(#${u}g)`} stroke={DI} strokeWidth="2.5" strokeLinejoin="round" />
      <Brilliant cx={50} cy={26} w={34} />
      <path d={twinkle(74, 14, 7)} fill="#fff" />
    </g>
  )
}

function Crown({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={0.6} y2={1} />
      </defs>
      {shadow(36, 88)}
      <path d="M14 34 L30 54 L50 22 L70 54 L86 34 L80 76 H20Z" fill={`url(#${u}g)`} stroke={DI} strokeWidth="3" strokeLinejoin="round" />
      <path d="M20 66 H80" stroke="#b77706" strokeWidth="2" />
      <rect x="18" y="74" width="64" height="12" rx="3" fill={`url(#${u}g)`} stroke={DI} strokeWidth="3" />
      {[
        [14, 32],
        [50, 19],
        [86, 32],
      ].map(([x, y]) => (
        <circle key={x} cx={x} cy={y} r="5.5" fill="#fff4c2" stroke={DI} strokeWidth="2.5" />
      ))}
      <circle cx="50" cy="56" r="7" fill={RUBY[3]} stroke={DI} strokeWidth="2.4" />
      <circle cx="48" cy="54" r="2" fill="#fff" opacity=".8" />
      <circle cx="31" cy="68" r="4.5" fill={SAPPHIRE[3]} stroke={DI} strokeWidth="2" />
      <circle cx="69" cy="68" r="4.5" fill={EMERALD[3]} stroke={DI} strokeWidth="2" />
      <circle cx="40" cy="80" r="2.5" fill="#fff6c8" />
      <circle cx="50" cy="80" r="2.5" fill="#fff6c8" />
      <circle cx="60" cy="80" r="2.5" fill="#fff6c8" />
      <path d="M22 40 L28 62" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".7" />
    </g>
  )
}

function GrandDiamond() {
  return (
    <g>
      {shadow(32, 92, 0.25)}
      <circle cx="50" cy="48" r="40" fill="#7fd8ff" opacity=".14" />
      <Brilliant cx={50} cy={50} w={84} />
      <path d={twinkle(18, 20, 8)} fill="#fff" />
      <path d={twinkle(84, 70, 6)} fill="#fff" />
      <path d={twinkle(70, 24, 4.5)} fill="#fff" />
    </g>
  )
}

/* ---------------- the lookup ---------------- */

const DRAW: Record<SymbolId, (p: { u: string }) => ReactNode> = {
  mushroom: Mushroom,
  coin: CloverCoin,
  ladybug: Ladybug,
  hat: TopHat,
  horseshoe: Horseshoe,
  rainbow: Rainbow,
  clover: FourLeaf,
  pot: PotOfGold,
  cactus: Cactus,
  lantern: Lantern,
  pickaxe: Pickaxe,
  cart: MineCart,
  dynamite: Dynamite,
  star: SheriffStar,
  bars: GoldBars,
  nugget: Nugget,
  cherry: Cherry,
  lemon: Lemon,
  orange: Orange,
  strawberry: Strawberry,
  pineapple: Pineapple,
  grapes: Grapes,
  melon: Watermelon,
  seven: Seven,
  pearl: Pearl,
  amethyst: Amethyst,
  sapphire: Sapphire,
  emerald: Emerald,
  ruby: Ruby,
  ring: Ring,
  crown: Crown,
  diamond: GrandDiamond,
  acorn: Acorn,
  daisy: Daisy,
  butterfly: Butterfly,
  snail: Snail,
  boot: Boot,
  canteen: Canteen,
  stetson: Stetson,
  wheel: Wheel,
  banana: Banana,
  pear: Pear,
  plum: Plum,
  kiwi: Kiwi,
  watch: Watch,
  key: GoldenKey,
  perfume: Perfume,
  champagne: Champagne,
}

/** One symbol in a square box. */
export function SymbolArt({ sym, size = 64, className, style, x, y }: { sym: SymbolId; size?: number | string; className?: string; style?: React.CSSProperties; x?: number; y?: number }) {
  const u = useUid()
  const Draw = DRAW[sym]
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100" className={className} style={style} overflow="visible" aria-hidden>
      <Draw u={u} />
    </svg>
  )
}
