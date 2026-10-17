import { useUid } from '../../art/ids'
import { GOLD, Lin, Rad, shadow, twinkle } from './symbolkit'

/*
  Four of Fruit Frenzy's symbols in a module of their own: the lobby cover draws them, and importing them from here keeps
  the other 28 symbols out of the lobby's bundle. symbols.tsx uses them like any other.
*/

export const FI = '#4a0d2c'

export function Cherry({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}c`} stops={[[0, '#ff8a9a'], [0.45, '#ee1f3b'], [1, '#8d0b23']]} cx={0.35} cy={0.3} r={0.8} />
      </defs>
      {shadow(28)}
      <path d="M30 64 C34 40 48 22 62 14 M70 66 C66 44 64 28 62 14" stroke={FI} strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M30 64 C34 40 48 22 62 14 M70 66 C66 44 64 28 62 14" stroke="#4fb045" strokeWidth="2.6" fill="none" strokeLinecap="round" />
      <path d="M62 14 C70 6 86 8 90 18 C80 24 68 22 62 14Z" fill="#46c35b" stroke={FI} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M64 15 C72 13 80 14 88 18" stroke="#2d8a3e" strokeWidth="1.6" fill="none" />
      <circle cx="30" cy="68" r="18" fill={`url(#${u}c)`} stroke={FI} strokeWidth="3" />
      <circle cx="70" cy="70" r="18" fill={`url(#${u}c)`} stroke={FI} strokeWidth="3" />
      <ellipse cx="24" cy="61" rx="5" ry="3.5" fill="#fff" opacity=".8" transform="rotate(-30 24 61)" />
      <ellipse cx="64" cy="63" rx="5" ry="3.5" fill="#fff" opacity=".8" transform="rotate(-30 64 63)" />
    </g>
  )
}

export function Lemon({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <Rad id={`${u}l`} stops={[[0, '#fff9b0'], [0.5, '#ffe03a'], [1, '#e0a400']]} cx={0.38} cy={0.32} r={0.8} />
      </defs>
      {shadow(30)}
      <path d="M10 54 C10 34 30 22 50 22 C70 22 90 34 90 54 C90 72 70 82 50 82 C30 82 10 72 10 54Z" transform="rotate(-18 50 52)" fill={`url(#${u}l)`} stroke={FI} strokeWidth="3" />
      <path d="M6 64 L13 60 M94 40 L87 44" stroke={FI} strokeWidth="4" strokeLinecap="round" />
      <path d="M58 22 C62 10 76 6 84 10 C80 20 68 24 58 22Z" fill="#46c35b" stroke={FI} strokeWidth="2.5" strokeLinejoin="round" />
      <g fill="#e8b400" opacity=".55">
        <circle cx="40" cy="58" r="1.4" />
        <circle cx="54" cy="64" r="1.4" />
        <circle cx="64" cy="52" r="1.4" />
        <circle cx="48" cy="46" r="1.4" />
        <circle cx="72" cy="62" r="1.4" />
      </g>
      <path d="M24 46 C30 36 40 32 50 32" stroke="#fff" strokeWidth="4" fill="none" strokeLinecap="round" opacity=".7" transform="rotate(-18 50 52)" />
    </g>
  )
}

export function Grapes({ u }: { u: string }) {
  const balls: [number, number][] = [
    [34, 38],
    [50, 36],
    [66, 38],
    [42, 52],
    [58, 52],
    [26, 52],
    [74, 52],
    [34, 66],
    [50, 66],
    [66, 66],
    [42, 80],
    [58, 80],
  ]
  return (
    <g>
      <defs>
        <Rad id={`${u}g`} stops={[[0, '#d9a8ff'], [0.45, '#8e3fe0'], [1, '#4b158c']]} cx={0.35} cy={0.3} r={0.8} />
      </defs>
      {shadow(24, 94)}
      <path d="M50 30 C50 20 54 12 60 8" stroke={FI} strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M52 22 C40 8 22 12 18 22 C30 30 44 28 52 22Z" fill="#46c35b" stroke={FI} strokeWidth="2.5" strokeLinejoin="round" />
      {balls.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="10" fill={`url(#${u}g)`} stroke={FI} strokeWidth="2.6" />
          <circle cx={x - 3.2} cy={y - 3.4} r="2.4" fill="#fff" opacity=".75" />
        </g>
      ))}
    </g>
  )
}

export function Seven({ u }: { u: string }) {
  const d = 'M22 18 H80 V30 C64 46 54 64 50 88 H32 C36 64 46 46 58 32 H22Z'
  return (
    <g>
      <defs>
        <Lin id={`${u}r`} stops={[[0, '#ff7a6a'], [0.5, '#f0213a'], [1, '#a00c24']]} />
        <Lin id={`${u}g`} stops={GOLD} x1={0} y1={0} x2={1} y2={1} />
      </defs>
      {shadow(24, 92)}
      <path d={d} fill="none" stroke={FI} strokeWidth="15" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={`url(#${u}g)`} strokeWidth="9" strokeLinejoin="round" />
      <path d={d} fill={`url(#${u}r)`} />
      <path d="M26 22 H76" stroke="#ffd0c8" strokeWidth="3" strokeLinecap="round" opacity=".8" />
      <path d={twinkle(84, 14, 8)} fill="#fff" />
      <path d={twinkle(16, 70, 5)} fill="#fff6c8" />
    </g>
  )
}

/**
 * A few symbols on their own, for the lobby cover: importing these instead of SymbolArt keeps the other 28 (and the
 * lookup) out of the lobby's bundle.
 */
export function CoverSymbol({ sym, size, x, y }: { sym: 'seven' | 'cherry' | 'lemon' | 'grapes'; size: number; x: number; y: number }) {
  const u = useUid()
  const Draw = sym === 'seven' ? Seven : sym === 'cherry' ? Cherry : sym === 'lemon' ? Lemon : Grapes
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 100 100" overflow="visible" aria-hidden>
      <Draw u={u} />
    </svg>
  )
}
