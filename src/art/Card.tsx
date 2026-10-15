import type { CSSProperties } from 'react'
import { useUid } from './ids'
import { SuitShape, suitColor, isRed, type Suit } from './suits'
import { BOJE_B, BOJE_FACET_LEFT, BOJE_FACET_TOP, BOJE_HEX } from './brand'

/*
  Boje playing cards as vector art. Faces: a big corner index (repeated upside down in the opposite corner),
  classic pip layouts, a branded ace of spades and illustrated court cards. Back: a deep emerald honeycomb
  with gold foil and the Boje gem in the middle.
*/

export const CARD_RATIO = 140 / 100
const FONT = 'Manrope, ui-sans-serif, system-ui, sans-serif'
const GOLD = '#f2b42c'
const GOLD_EDGE = '#a8700c'
const SKIN = '#f8d0a8'
const SKIN_SHADE = '#e8ad84'

type Box = { x?: number; y?: number; width?: number; height?: number }

/* ------------------------------------------------------------------ */
/*  Faces                                                               */
/* ------------------------------------------------------------------ */

/** Pip centres for 2–10 in the 100 × 140 card; pips below the middle are drawn upside down. */
const L = 34.5
const R = 65.5
const M = 50
const ROW = [27, 55.7, 84.3, 113]
const PIPS: Record<string, [number, number][]> = {
  '2': [[M, 27], [M, 113]],
  '3': [[M, 27], [M, 70], [M, 113]],
  '4': [[L, 27], [R, 27], [L, 113], [R, 113]],
  '5': [[L, 27], [R, 27], [M, 70], [L, 113], [R, 113]],
  '6': [[L, 27], [R, 27], [L, 70], [R, 70], [L, 113], [R, 113]],
  '7': [[L, 27], [R, 27], [M, 48.5], [L, 70], [R, 70], [L, 113], [R, 113]],
  '8': [[L, 27], [R, 27], [M, 48.5], [L, 70], [R, 70], [M, 91.5], [L, 113], [R, 113]],
  '9': [...ROW.flatMap((y): [number, number][] => [[L, y], [R, y]]), [M, 70]],
  '10': [...ROW.flatMap((y): [number, number][] => [[L, y], [R, y]]), [M, 41.3], [M, 98.7]],
}

function Pip({ x, y, suit, size = 15 }: { x: number; y: number; suit: Suit; size?: number }) {
  const s = size / 24
  const flip = y > 70.5
  return (
    <g transform={`translate(${x} ${y}) ${flip ? 'rotate(180)' : ''} translate(${-12 * s} ${-12 * s}) scale(${s})`}>
      <SuitShape suit={suit} fill={suitColor(suit)} />
    </g>
  )
}

function Index({ rank, suit }: { rank: string; suit: Suit }) {
  const c = suitColor(suit)
  const ten = rank === '10'
  return (
    <g>
      <text x="12.5" y="29" textAnchor="middle" fontSize={ten ? 22 : 27} fontWeight="800" fill={c} fontFamily={FONT} letterSpacing={ten ? -2.8 : 0}>
        {rank}
      </text>
      <g transform="translate(5.9 33.5) scale(0.55)">
        <SuitShape suit={suit} fill={c} />
      </g>
    </g>
  )
}

export function CardFace({ rank, suit, className, style, ...box }: { rank: string; suit: Suit; className?: string; style?: CSSProperties } & Box) {
  const u = useUid()
  const court = rank === 'J' || rank === 'Q' || rank === 'K'
  return (
    <svg {...box} viewBox="0 0 100 140" className={className} style={style} aria-label={`${rank}${suit}`}>
      <defs>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#edf1f5" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="98.5" height="138.5" rx="9" fill={`url(#${u}g)`} stroke="rgba(9,24,38,.2)" strokeWidth="1.5" />
      {court ? <Court rank={rank} suit={suit} u={u} /> : rank === 'A' ? <Ace suit={suit} u={u} /> : (PIPS[rank] ?? []).map(([x, y], i) => <Pip key={i} x={x} y={y} suit={suit} />)}
      <Index rank={rank} suit={suit} />
      <g transform="rotate(180 50 70)">
        <Index rank={rank} suit={suit} />
      </g>
    </svg>
  )
}

/** The Boje gem mark, 32 × 32, with its own gradient. */
function Mark({ u, id, transform, ink = '#04260f' }: { u: string; id: string; transform: string; ink?: string }) {
  return (
    <g transform={transform}>
      <defs>
        <linearGradient id={`${u}${id}g`} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor="#6dffb2" />
          <stop offset="0.5" stopColor="#1fd172" />
          <stop offset="1" stopColor="#0b8a47" />
        </linearGradient>
        <clipPath id={`${u}${id}c`}>
          <path d={BOJE_HEX} />
        </clipPath>
      </defs>
      <path d={BOJE_HEX} fill={`url(#${u}${id}g)`} stroke={`url(#${u}${id}g)`} strokeWidth="2.6" strokeLinejoin="round" />
      <g clipPath={`url(#${u}${id}c)`}>
        <path d={BOJE_FACET_TOP} fill="#fff" opacity=".22" />
        <path d={BOJE_FACET_LEFT} fill="#000" opacity=".08" />
      </g>
      <path d={BOJE_B} fill={ink} fillRule="evenodd" transform="translate(0.3 0)" />
    </g>
  )
}

function Ace({ suit, u }: { suit: Suit; u: string }) {
  const c = suitColor(suit)
  if (suit === '♠')
    // the house ace: a big spade carrying the Boje gem, inside a fine gold ring
    return (
      <g>
        <defs>
          <linearGradient id={`${u}sp`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2c4157" />
            <stop offset="1" stopColor="#111c27" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="70" r="34" fill="none" stroke={GOLD} strokeWidth="1.2" strokeOpacity=".75" />
        <circle cx="50" cy="70" r="31" fill="none" stroke={GOLD} strokeWidth="0.6" strokeOpacity=".5" strokeDasharray="1.5 2.2" />
        <g transform="translate(23 43) scale(2.25)">
          <SuitShape suit="♠" fill={`url(#${u}sp)`} />
        </g>
        <Mark u={u} id="am" transform="translate(41 61.5) scale(0.56)" />
      </g>
    )
  return (
    <g>
      <circle cx="50" cy="70" r="31" fill={c} opacity=".06" />
      <g transform="translate(28 48) scale(1.83)">
        <SuitShape suit={suit} fill={c} />
      </g>
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Court cards: a king, queen and jack in the suit's colours           */
/* ------------------------------------------------------------------ */

function Court({ rank, suit, u }: { rank: string; suit: Suit; u: string }) {
  const red = isRed(suit)
  const robe = red ? '#e3344c' : '#24384d'
  const robeDark = red ? '#a81d33' : '#142231'
  const tint = red ? '#fdecef' : '#e9eef5'
  return (
    <g>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={tint} />
          <stop offset="1" stopColor={red ? '#f8d5dc' : '#d5dfeb'} />
        </linearGradient>
        <clipPath id={`${u}pc`}>
          <rect x="24" y="22" width="52" height="96" rx="6" />
        </clipPath>
        <linearGradient id={`${u}rb`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={robe} />
          <stop offset="1" stopColor={robeDark} />
        </linearGradient>
      </defs>
      <rect x="24" y="22" width="52" height="96" rx="6" fill={`url(#${u}bg)`} />
      <g clipPath={`url(#${u}pc)`}>
        {/* rays behind the head */}
        <g opacity=".5">
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M50 62 L47.5 10 L52.5 10Z" fill="#fff" transform={`rotate(${i * 30} 50 62)`} />
          ))}
        </g>
        <g transform="translate(24 22)">{rank === 'K' ? <King u={u} /> : rank === 'Q' ? <Queen u={u} /> : <Jack u={u} robe={robe} />}</g>
        {/* robe, shared */}
        <g transform="translate(24 22)">
          <path d="M1 96 C2 80 10 70 26 68 C42 70 50 80 51 96Z" fill={`url(#${u}rb)`} />
          <path d="M15.5 70.5 L26 86 L36.5 70.5" fill="none" stroke={GOLD} strokeWidth="2.6" strokeLinejoin="round" />
          {rank !== 'J' && (
            <g>
              <path d="M3.5 88 Q26 76 48.5 88" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" />
              {[8, 15, 22, 30, 37, 44].map((x) => (
                <circle key={x} cx={x} cy={84.5 - Math.sin(((x - 3.5) / 45) * Math.PI) * 5.2 + 1.2} r="0.9" fill="#1b2a38" />
              ))}
            </g>
          )}
          <SuitShape suit={suit} fill={GOLD} transform="translate(21.5 87) scale(0.38)" />
        </g>
      </g>
      <rect x="24" y="22" width="52" height="96" rx="6" fill="none" stroke={red ? '#e3344c' : '#24384d'} strokeOpacity=".35" strokeWidth="1.2" />
      <rect x="26.2" y="24.2" width="47.6" height="91.6" rx="4.6" fill="none" stroke={GOLD} strokeOpacity=".55" strokeWidth="0.6" />
    </g>
  )
}

/** shared face: head, ears, eyes, nose, cheeks; local box is 52 wide, the head centred on x 26, y 46 */
function Face({ smile = 1 }: { smile?: number }) {
  return (
    <g>
      <rect x="22" y="54" width="8" height="15" rx="3" fill={SKIN_SHADE} />
      <ellipse cx="15.3" cy="46.5" rx="2.4" ry="3.2" fill={SKIN_SHADE} />
      <ellipse cx="36.7" cy="46.5" rx="2.4" ry="3.2" fill={SKIN_SHADE} />
      <ellipse cx="26" cy="45" rx="11" ry="12.6" fill={SKIN} />
      <circle cx="20.2" cy="50" r="2.4" fill="#ff8a8a" opacity=".35" />
      <circle cx="31.8" cy="50" r="2.4" fill="#ff8a8a" opacity=".35" />
      <ellipse cx="21.6" cy="44.6" rx="1.45" ry="1.75" fill="#2a1d18" />
      <ellipse cx="30.4" cy="44.6" rx="1.45" ry="1.75" fill="#2a1d18" />
      <circle cx="22.1" cy="44" r="0.5" fill="#fff" />
      <circle cx="30.9" cy="44" r="0.5" fill="#fff" />
      <path d="M26 46 q1.4 2.6 -.4 3.3" fill="none" stroke={SKIN_SHADE} strokeWidth="1" strokeLinecap="round" />
      <path d={`M22.6 52.3 q3.4 ${2.2 * smile} 6.8 0`} fill="none" stroke="#a8433a" strokeWidth="1.1" strokeLinecap="round" />
    </g>
  )
}

/** a small Boje gem for crowns and caps: green hexagon with a light top facet */
function Jewel({ x, y, r = 2.6 }: { x: number; y: number; r?: number }) {
  const h = r * 0.866
  return (
    <g>
      <path d={`M${x} ${y - r} L${x + h} ${y - r / 2} L${x + h} ${y + r / 2} L${x} ${y + r} L${x - h} ${y + r / 2} L${x - h} ${y - r / 2}Z`} fill="#1fd172" stroke="#0b6b38" strokeWidth="0.6" />
      <path d={`M${x} ${y - r} L${x + h} ${y - r / 2} L${x} ${y} L${x - h} ${y - r / 2}Z`} fill="#fff" opacity=".45" />
    </g>
  )
}

function King({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}kg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe28a" />
          <stop offset="1" stopColor={GOLD} />
        </linearGradient>
      </defs>
      {/* hair behind */}
      <path d="M13.5 44 C12 34 18 30 26 30 C34 30 40 34 38.5 44 L38 52 L14 52Z" fill="#e6eaf0" />
      <Face smile={0.8} />
      {/* beard and moustache */}
      <path d="M15.2 46.5 C15.5 56 19.5 64 26 66.5 C32.5 64 36.5 56 36.8 46.5 C35 52 31 54.5 26 54.5 C21 54.5 17 52 15.2 46.5Z" fill="#eef1f5" stroke="#cfd6df" strokeWidth="0.6" />
      <path d="M20 51.2 C22.5 49.6 24.8 50 26 51 C27.2 50 29.5 49.6 32 51.2 C29.6 52.6 27.5 52.4 26 51.8 C24.5 52.4 22.4 52.6 20 51.2Z" fill="#d9dfe7" />
      {/* crown */}
      <path d="M13 34.5 L14 21 L19.5 27 L26 17.5 L32.5 27 L38 21 L39 34.5Z" fill={`url(#${u}kg)`} stroke={GOLD_EDGE} strokeWidth="0.9" strokeLinejoin="round" />
      <rect x="12.5" y="32" width="27" height="4.4" rx="1.3" fill={GOLD} stroke={GOLD_EDGE} strokeWidth="0.8" />
      <circle cx="14" cy="20.6" r="1.4" fill="#fff4cc" stroke={GOLD_EDGE} strokeWidth="0.6" />
      <circle cx="38" cy="20.6" r="1.4" fill="#fff4cc" stroke={GOLD_EDGE} strokeWidth="0.6" />
      <circle cx="26" cy="17" r="1.5" fill="#fff4cc" stroke={GOLD_EDGE} strokeWidth="0.6" />
      <Jewel x={26} y={28.4} r={3} />
      <circle cx="18" cy="34.2" r="1.15" fill="#e3344c" />
      <circle cx="34" cy="34.2" r="1.15" fill="#e3344c" />
    </g>
  )
}

function Queen({ u }: { u: string }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}qh`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f4c15a" />
          <stop offset="1" stopColor="#d48a1e" />
        </linearGradient>
      </defs>
      {/* long hair behind */}
      <path d="M12 46 C10 33 17 29.5 26 29.5 C35 29.5 42 33 40 46 C41 56 43 64 40 72 L12 72 C9 64 11 56 12 46Z" fill={`url(#${u}qh)`} />
      <Face smile={1.1} />
      {/* fringe */}
      <path d="M14.8 40.5 C15.5 33.5 20 31 26 31 C32 31 36.5 33.5 37.2 40.5 C34 36.2 30 34.8 26 36.2 C22 34.8 18 36.2 14.8 40.5Z" fill={`url(#${u}qh)`} />
      <path d="M23.2 52.2 q2.8 1.9 5.6 0" fill="none" stroke="#e3344c" strokeWidth="1.5" strokeLinecap="round" />
      {/* tiara */}
      <path d="M16 33 C19 30 22 29.5 26 26 C30 29.5 33 30 36 33 C32.5 31.6 29.5 31.6 26 32.6 C22.5 31.6 19.5 31.6 16 33Z" fill={GOLD} stroke={GOLD_EDGE} strokeWidth="0.7" strokeLinejoin="round" />
      <Jewel x={26} y={27.4} r={2.5} />
      <circle cx="19.6" cy="30.7" r="0.9" fill="#fff4cc" />
      <circle cx="32.4" cy="30.7" r="0.9" fill="#fff4cc" />
      {/* earrings and pearls */}
      <circle cx="15.4" cy="51" r="1.2" fill={GOLD} />
      <circle cx="36.6" cy="51" r="1.2" fill={GOLD} />
      {[19, 22.5, 26, 29.5, 33].map((x, i) => (
        <circle key={x} cx={x} cy={68.6 + Math.abs(i - 2) * -0.9 + 1.6} r="1.1" fill="#fffaf0" stroke="#d9cfbf" strokeWidth="0.35" />
      ))}
    </g>
  )
}

function Jack({ u, robe }: { u: string; robe: string }) {
  return (
    <g>
      <defs>
        <linearGradient id={`${u}jf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7dffbe" />
          <stop offset="1" stopColor="#12a85a" />
        </linearGradient>
      </defs>
      {/* short hair */}
      <path d="M14 46 C12.5 36 18 31.5 26 31.5 C34 31.5 39.5 36 38 46 C36.5 41 33 39 26 39 C19 39 15.5 41 14 46Z" fill="#7a4524" />
      <Face smile={1.3} />
      <path d="M14.5 44 C15 49 15 52 16.5 55 L15 55 C13.6 52 13.4 48 14.5 44Z M37.5 44 C37 49 37 52 35.5 55 L37 55 C38.4 52 38.6 48 37.5 44Z" fill="#7a4524" />
      {/* cap with a feather */}
      <path d="M38 22 C44 15 49 13.5 50.5 12 C49.5 16 46 21 39 26Z" fill={`url(#${u}jf)`} />
      <path d="M39.5 24.6 L48.5 14" stroke="#0b6b38" strokeWidth="0.6" />
      <path d="M12 35 C11.5 27 18 23 27 23 C35 23 41 26.5 40.5 34 C33 31.5 20 31.5 12 35Z" fill={robe} />
      <path d="M11.6 35.2 C20 31.6 32.8 31.6 40.8 34.2 L40.6 37 C32.6 34.5 20 34.6 11.8 38Z" fill={GOLD} stroke={GOLD_EDGE} strokeWidth="0.6" />
      <Jewel x={26} y={34.6} r={2.2} />
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Back                                                                */
/* ------------------------------------------------------------------ */

const HR = 4.2
const HW = Math.sqrt(3) * HR
/** one tile of a pointy-top honeycomb: a full hexagon plus the edge joining the two below it */
const HONEYCOMB = `M${HW / 2} 0 L${HW} ${HR / 2} L${HW} ${HR * 1.5} L${HW / 2} ${HR * 2} L0 ${HR * 1.5} L0 ${HR / 2}Z M${HW / 2} ${HR * 2} L${HW / 2} ${HR * 3}`

/** pointy-top hexagon around (cx, cy) */
const hexPath = (cx: number, cy: number, r: number) => {
  const h = r * 0.866
  return `M${cx} ${cy - r} L${cx + h} ${cy - r / 2} L${cx + h} ${cy + r / 2} L${cx} ${cy + r} L${cx - h} ${cy + r / 2} L${cx - h} ${cy - r / 2}Z`
}

export function CardBack({ className, style, ...box }: { className?: string; style?: CSSProperties } & Box) {
  const u = useUid()
  return (
    <svg {...box} viewBox="0 0 100 140" className={className} style={style} aria-hidden>
      <defs>
        <radialGradient id={`${u}b`} cx="0.5" cy="0.5" r="0.78">
          <stop offset="0" stopColor="#13684a" />
          <stop offset="0.55" stopColor="#0c3735" />
          <stop offset="1" stopColor="#081922" />
        </radialGradient>
        <pattern id={`${u}p`} width={HW} height={HR * 3} patternUnits="userSpaceOnUse" x="50" y="70">
          <path d={HONEYCOMB} fill="none" stroke="rgba(120,255,185,.17)" strokeWidth="0.55" />
        </pattern>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff0b0" />
          <stop offset="0.3" stopColor="#f2c14e" />
          <stop offset="0.62" stopColor="#b8801a" />
          <stop offset="1" stopColor="#ffe08a" />
        </linearGradient>
        <radialGradient id={`${u}h`}>
          <stop offset="0" stopColor="#4dffa6" stopOpacity=".5" />
          <stop offset="1" stopColor="#4dffa6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0.75" y="0.75" width="98.5" height="138.5" rx="9" fill="#f4f6f9" stroke="rgba(9,24,38,.2)" strokeWidth="1.5" />
      <rect x="5" y="5" width="90" height="130" rx="6" fill={`url(#${u}b)`} />
      <rect x="5" y="5" width="90" height="130" rx="6" fill={`url(#${u}p)`} />
      {/* gold foil frame */}
      <rect x="9" y="9" width="82" height="122" rx="4" fill="none" stroke={`url(#${u}f)`} strokeWidth="1.5" />
      <rect x="12" y="12" width="76" height="116" rx="2.5" fill="none" stroke={`url(#${u}f)`} strokeWidth="0.5" strokeOpacity=".7" />
      {[
        [12, 12],
        [88, 12],
        [12, 128],
        [88, 128],
      ].map(([x, y]) => (
        <g key={`${x}${y}`}>
          <path d={hexPath(x, y, 3.6)} fill="#0a2a2a" stroke={`url(#${u}f)`} strokeWidth="0.9" />
          <path d={hexPath(x, y, 1.6)} fill="#2ee88a" />
        </g>
      ))}
      {/* spine lines from the medallion to the frame */}
      <path d="M50 12 V24 M50 110 V128" stroke={`url(#${u}f)`} strokeWidth="0.6" strokeOpacity=".75" />
      <path d={hexPath(50, 18, 2.2)} fill={`url(#${u}f)`} />
      <path d={hexPath(50, 119, 2.2)} fill={`url(#${u}f)`} />
      {/* medallion */}
      <circle cx="50" cy="70" r="34" fill={`url(#${u}h)`} />
      <path d={hexPath(50, 70, 25)} fill="#0a2626" stroke={`url(#${u}f)`} strokeWidth="1.7" strokeLinejoin="round" />
      <path d={hexPath(50, 70, 21.6)} fill="none" stroke={`url(#${u}f)`} strokeWidth="0.5" strokeOpacity=".6" strokeLinejoin="round" />
      <Mark u={u} id="bm" transform="translate(36 56) scale(0.875)" />
      <text x="50" y="38.6" textAnchor="middle" fontSize="7.2" fontWeight="800" letterSpacing="1.4" fill="#f6d77a" fontFamily={FONT}>
        BOJE
      </text>
      <text x="50" y="104" textAnchor="middle" fontSize="4.6" fontWeight="800" letterSpacing="2.2" fill="#f6d77a" fillOpacity=".85" fontFamily={FONT}>
        CASINO
      </text>
    </svg>
  )
}
