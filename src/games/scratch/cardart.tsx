import { memo, type ReactNode } from 'react'
import { useUid } from '../../art/ids'
import { round2 } from '../../lib/format'
import { CARDS, coinLabel, maxMult, topPrize, type CardId } from './rules'
import { BONUS, CARD_H, CARD_R, CARD_W, PANEL, TABLE_Y, cellRect } from './layout'
import { SymbolArt, starPath, twinkle } from './symbols'

/*
  The printed side of each card: paper, frame, header art and logo, the play area the foil covers, the prize table and
  the small print. Four art directions: an Irish emerald with a rainbow for Lucky Clover, a sunset gold-mining sign for
  Gold Rush, candy-striped juice for Fruit Frenzy and black-and-gold art deco for Diamond Deluxe.
*/

export interface Theme {
  /** paper gradient, top to bottom */
  paper: [string, string]
  /** under the foil */
  cell: [string, string]
  cellEdge: string
  /** the recess the foil sits in */
  well: string
  /** text and outlines */
  ink: string
  /** caption under each symbol */
  pill: { bg: string; fg: string }
  /** prize table */
  table: { bg: string; fg: string; dim: string; edge: string }
  small: string
  /** glow of the winning cells and the line through them */
  win: string
  /** prize stamp ink */
  stamp: string
  /** the card's colours for confetti */
  confetti: string[]
  /** a dark card: symbols sit on velvet */
  dark?: boolean
}

export const THEMES: Record<CardId, Theme> = {
  clover: {
    paper: ['#13703f', '#0a4627'],
    cell: ['#fffbea', '#f3e9c6'],
    cellEdge: '#c9b98a',
    well: '#06331b',
    ink: '#0f3b22',
    pill: { bg: '#0f5a32', fg: '#ffe9a3' },
    table: { bg: '#0b4a29', fg: '#fff3c4', dim: '#8fc9a4', edge: '#e9c25a' },
    small: '#9fd1b1',
    win: '#ffd54a',
    stamp: '#d8263a',
    confetti: ['#2fd36a', '#ffd54a', '#ffffff', '#ff6b5e', '#7be495'],
  },
  gold: {
    paper: ['#4d2a12', '#25120a'],
    cell: ['#fbefcf', '#ead39c'],
    cellEdge: '#b98d4a',
    well: '#1a0c04',
    ink: '#3a1c08',
    pill: { bg: '#3a1c08', fg: '#ffd451' },
    table: { bg: '#2c1608', fg: '#ffe08a', dim: '#c79a5a', edge: '#d9a631' },
    small: '#c9a06a',
    win: '#ffcf3a',
    stamp: '#c21f1f',
    confetti: ['#ffd451', '#fff1b8', '#e8a21a', '#ff8a3d', '#ffffff'],
  },
  fruit: {
    paper: ['#ff3b8d', '#e8236e'],
    cell: ['#ffffff', '#ffe8f1'],
    cellEdge: '#f4a5c6',
    well: '#9c0f4a',
    ink: '#4a0d2c',
    pill: { bg: '#4a0d2c', fg: '#ffe14a' },
    table: { bg: '#b8124f', fg: '#ffffff', dim: '#ffc2dc', edge: '#ffe14a' },
    small: '#ffd3e6',
    win: '#ffe14a',
    stamp: '#7a1fd1',
    confetti: ['#ffe14a', '#46c35b', '#ff8a1f', '#ffffff', '#8e3fe0', '#3fc4ff'],
  },
  diamond: {
    paper: ['#1b1236', '#0a0618'],
    cell: ['#2a1d55', '#130c2a'],
    cellEdge: '#6b5aa8',
    well: '#05030c',
    ink: '#0b0620',
    pill: { bg: '#d9b45a', fg: '#1a0f2e' },
    table: { bg: '#130c28', fg: '#f3dc96', dim: '#8e83b8', edge: '#c9a24a' },
    small: '#8e83b8',
    win: '#7fe3ff',
    stamp: '#e8c25a',
    confetti: ['#7fe3ff', '#ffffff', '#e8c25a', '#b892ff', '#ff6fa8'],
    dark: true,
  },
}

const FONT = 'Manrope, system-ui, sans-serif'

type Grad = [number, string][]
const lin = (id: string, stops: Grad, x2 = 0, y2 = 1, x1 = 0, y1 = 0) => (
  <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
    {stops.map(([o, c]) => (
      <stop key={o} offset={o} stopColor={c} />
    ))}
  </linearGradient>
)
const GOLD: Grad = [
  [0, '#fff4c2'],
  [0.4, '#ffd451'],
  [0.75, '#e8a21a'],
  [1, '#b06e08'],
]

/** outlined display text: a fat outline behind, then the fill (paint-order keeps the outline outside) */
function Title({ x, y, size, children, fill, stroke, sw, ls = 0, outer, osw = 0, anchor = 'middle', rotate = 0 }: { x: number; y: number; size: number; children: ReactNode; fill: string; stroke: string; sw: number; ls?: number; outer?: string; osw?: number; anchor?: 'middle' | 'start' | 'end'; rotate?: number }) {
  const common = { x, y, fontSize: size, fontWeight: 800, fontFamily: FONT, letterSpacing: ls, textAnchor: anchor, transform: rotate ? `rotate(${rotate} ${x} ${y})` : undefined }
  return (
    <g>
      {outer && (
        <text {...common} fill={outer} stroke={outer} strokeWidth={osw} strokeLinejoin="round">
          {children}
        </text>
      )}
      <text {...common} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" paintOrder="stroke">
        {children}
      </text>
    </g>
  )
}

/* ---------------- headers ---------------- */

function CloverHeader({ u, top }: { u: string; top: string }) {
  const bands = ['#ff4d5e', '#ff9b3d', '#ffe14a', '#4cd964', '#3fa8ff', '#8c6bff']
  return (
    <g>
      <defs>
        <radialGradient id={`${u}hg`} cx=".22" cy=".5" r=".75">
          <stop offset="0" stopColor="#5fe08f" stopOpacity=".55" />
          <stop offset="1" stopColor="#5fe08f" stopOpacity="0" />
        </radialGradient>
        {lin(`${u}gold`, GOLD)}
        {lin(`${u}wt`, [
          [0, '#ffffff'],
          [1, '#d6ffe3'],
        ])}
      </defs>
      <rect x="10" y="10" width="340" height="132" rx="16" fill={`url(#${u}hg)`} />
      {/* sunburst behind the clover */}
      <g opacity=".13" fill="#d9ffe6">
        {Array.from({ length: 14 }, (_, i) => (
          <path key={i} d="M66 78 L58 -60 L74 -60 Z" transform={`rotate(${i * 25.7} 66 78)`} />
        ))}
      </g>
      {/* the rainbow behind the logo */}
      <g opacity=".85">
        {bands.map((c, i) => (
          <path key={c} d={`M${138 + i * 7} 134 A${100 - i * 7} ${100 - i * 7} 0 0 1 ${338 - i * 7} 134`} fill="none" stroke={c} strokeWidth="7.2" />
        ))}
        <path d="M180 134 A58 58 0 0 1 296 134" fill="none" stroke="#0e5e35" strokeWidth="2" opacity=".6" />
      </g>
      <g transform="rotate(-9 64 80)">
        <SymbolArt sym="clover" x={4} y={14} size={122} />
      </g>
      {/* coins tumbling round it */}
      <SymbolArt sym="coin" x={98} y={98} size={34} />
      <SymbolArt sym="coin" x={10} y={102} size={26} />
      <Title x={238} y={52} size={19} ls={7} fill={`url(#${u}gold)`} stroke="#0a3d22" sw={4.5}>
        LUCKY
      </Title>
      <Title x={238} y={96} size={45} ls={0.5} fill={`url(#${u}wt)`} stroke="#0a3d22" sw={8} outer="#f0c24a" osw={14}>
        CLOVER
      </Title>
      {/* the ribbon */}
      <g transform="translate(238 120)">
        <path d="M-78 -11 H78 L70 0 L78 11 H-78 L-70 0Z" fill="#a8781a" />
        <path d="M-70 -12 H70 V12 H-70Z" fill={`url(#${u}gold)`} stroke="#0a3d22" strokeWidth="2.4" />
        <text y="4.8" textAnchor="middle" fontSize="13" fontWeight="800" fill="#0a3d22" fontFamily={FONT} letterSpacing="1.2">
          TOP PRIZE {top}
        </text>
      </g>
      <path d={twinkle(150, 30, 6)} fill="#fff6c8" />
      <path d={twinkle(332, 30, 5)} fill="#fff" />
      <path d={twinkle(122, 74, 4)} fill="#fff" />
    </g>
  )
}

function GoldHeader({ u, top }: { u: string; top: string }) {
  return (
    <g>
      <defs>
        {lin(`${u}sky`, [
          [0, '#ffd27a'],
          [0.45, '#ff9a4a'],
          [1, '#c2452c'],
        ])}
        {lin(`${u}wood`, [
          [0, '#a8642e'],
          [0.5, '#8a4c1e'],
          [1, '#5e3010'],
        ])}
        {lin(`${u}gold`, GOLD)}
        <clipPath id={`${u}hc`}>
          <rect x="10" y="10" width="340" height="134" rx="16" />
        </clipPath>
        <path id={`${u}arc`} d="M50 96 Q180 64 310 96" />
      </defs>
      <g clipPath={`url(#${u}hc)`}>
        <rect x="10" y="10" width="340" height="134" fill={`url(#${u}sky)`} />
        <g opacity=".22" fill="#fff6d8">
          {Array.from({ length: 12 }, (_, i) => (
            <path key={i} d="M180 130 L172 -40 L188 -40 Z" transform={`rotate(${(i - 5.5) * 15} 180 130)`} />
          ))}
        </g>
        <circle cx="180" cy="128" r="46" fill="#ffe7a6" />
        <circle cx="180" cy="128" r="36" fill="#fff4cf" />
        <path d="M10 118 L52 92 L84 108 L128 78 L170 112 L212 86 L250 106 L292 80 L350 110 V150 H10Z" fill="#9a3f2a" opacity=".85" />
        <path d="M10 132 L44 116 L96 128 L140 108 L196 130 L246 112 L300 128 L350 116 V150 H10Z" fill="#4a1f10" />
        {/* a little mine entrance on the hill */}
        <path d="M296 128 V118 Q306 108 316 118 V128Z" fill="#1d0b04" stroke="#7a4a20" strokeWidth="2" />
      </g>
      {/* crossed pickaxes behind the sign */}
      <g opacity=".95">
        <SymbolArt sym="pickaxe" x={14} y={16} size={58} />
        <g transform="translate(346 16) scale(-1 1)">
          <SymbolArt sym="pickaxe" x={0} y={0} size={58} />
        </g>
      </g>
      {/* the sign */}
      <g>
        <path d="M44 40 Q180 18 316 40 L312 100 Q180 82 48 100Z" fill={`url(#${u}wood)`} stroke="#2a1205" strokeWidth="3" strokeLinejoin="round" />
        <path d="M54 52 Q180 32 306 52 M52 72 Q180 52 308 72 M50 90 Q180 72 310 90" stroke="#5e3010" strokeWidth="1.4" fill="none" opacity=".55" />
        {[
          [54, 46],
          [306, 46],
          [56, 92],
          [304, 92],
        ].map(([x, y]) => (
          <circle key={x * y} cx={x} cy={y} r="3" fill="#d9b88a" stroke="#2a1205" strokeWidth="1.4" />
        ))}
        <text fontSize="44" fontWeight="800" fontFamily={FONT} letterSpacing="2" textAnchor="middle" fill="#2a1205" stroke="#2a1205" strokeWidth="10" strokeLinejoin="round">
          <textPath href={`#${u}arc`} startOffset="50%">
            GOLD RUSH
          </textPath>
        </text>
        <text fontSize="44" fontWeight="800" fontFamily={FONT} letterSpacing="2" textAnchor="middle" fill={`url(#${u}gold)`} stroke="#fff3c4" strokeWidth="1.2">
          <textPath href={`#${u}arc`} startOffset="50%">
            GOLD RUSH
          </textPath>
        </text>
      </g>
      <g transform="translate(180 122)">
        <rect x="-74" y="-12" width="148" height="24" rx="12" fill="#2a1205" stroke="#d9a631" strokeWidth="2" />
        <text y="4.8" textAnchor="middle" fontSize="13" fontWeight="800" fill="#ffd451" fontFamily={FONT} letterSpacing="1.2">
          TOP PRIZE {top}
        </text>
      </g>
      <path d={twinkle(84, 116, 5)} fill="#fff" />
      <path d={twinkle(276, 118, 4)} fill="#fff6c8" />
    </g>
  )
}

function FruitHeader({ u, top }: { u: string; top: string }) {
  return (
    <g>
      <defs>
        {lin(`${u}lime`, [
          [0, '#f4ffc8'],
          [0.5, '#b8f04a'],
          [1, '#58c22a'],
        ])}
        {lin(`${u}yel`, [
          [0, '#fff8b0'],
          [1, '#ffc81a'],
        ])}
        {lin(`${u}burst`, [
          [0, '#fff36b'],
          [0.6, '#ffc21a'],
          [1, '#ff8a00'],
        ])}
        <clipPath id={`${u}hc`}>
          <rect x="10" y="10" width="340" height="134" rx="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${u}hc)`}>
        <rect x="10" y="10" width="340" height="134" fill="#ff4f9a" />
        <g fill="#ff6aac">
          {Array.from({ length: 18 }, (_, i) => (
            <path key={i} d="M126 80 L116 -120 L136 -120 Z" transform={`rotate(${i * 20} 126 80)`} />
          ))}
        </g>
        <g fill="#fff" opacity=".16">
          {Array.from({ length: 30 }, (_, i) => (
            <circle key={i} cx={16 + ((i * 47) % 330)} cy={16 + ((i * 29) % 126)} r={2 + (i % 3)} />
          ))}
        </g>
      </g>
      {/* the juice splash behind the logo */}
      <path d="M40 70 C36 40 70 26 96 34 C110 18 150 16 170 34 C196 30 222 50 212 74 C230 92 210 122 182 116 C170 136 128 140 112 122 C86 134 54 120 58 98 C34 96 30 80 40 70Z" fill="#ffd21a" stroke={'#4a0d2c'} strokeWidth="3" />
      <circle cx="30" cy="46" r="6" fill="#ffd21a" stroke="#4a0d2c" strokeWidth="2.4" />
      <circle cx="226" cy="40" r="4.5" fill="#ffd21a" stroke="#4a0d2c" strokeWidth="2" />
      <circle cx="214" cy="124" r="5" fill="#ffd21a" stroke="#4a0d2c" strokeWidth="2" />
      <Title x={126} y={70} size={34} ls={1} fill={`url(#${u}yel)`} stroke="#4a0d2c" sw={7} rotate={-5} outer="#fff" osw={13}>
        FRUIT
      </Title>
      <Title x={128} y={108} size={38} ls={0.5} fill={`url(#${u}lime)`} stroke="#4a0d2c" sw={7.5} rotate={-5} outer="#fff" osw={13}>
        FRENZY
      </Title>
      <SymbolArt sym="cherry" x={6} y={92} size={46} />
      <SymbolArt sym="strawberry" x={196} y={8} size={32} />
      <g transform="translate(126 134)">
        <rect x="-62" y="-10" width="124" height="20" rx="10" fill="#4a0d2c" />
        <text y="4.2" textAnchor="middle" fontSize="11.5" fontWeight="800" fill="#ffe14a" fontFamily={FONT} letterSpacing="1">
          UP TO {top}
        </text>
      </g>
      {/* the Frenzy spot's starburst */}
      <g>
        <path d={starPath(BONUS.cx, BONUS.cy, 54, 44, 16)} fill={`url(#${u}burst)`} stroke="#4a0d2c" strokeWidth="3" strokeLinejoin="round" />
        <circle cx={BONUS.cx} cy={BONUS.cy} r={BONUS.r + 4} fill="#4a0d2c" />
        <g transform={`translate(${BONUS.cx} ${BONUS.cy + 56})`}>
          <rect x="-34" y="-9" width="68" height="18" rx="9" fill="#4a0d2c" stroke="#ffe14a" strokeWidth="1.6" />
          <text y="3.8" textAnchor="middle" fontSize="9.5" fontWeight="800" fill="#ffe14a" fontFamily={FONT} letterSpacing="1.4">
            FRENZY
          </text>
        </g>
      </g>
    </g>
  )
}

function DiamondHeader({ u, top }: { u: string; top: string }) {
  return (
    <g>
      <defs>
        {lin(`${u}plat`, [
          [0, '#ffffff'],
          [0.45, '#dfe6f5'],
          [0.55, '#a9b4cc'],
          [1, '#eef2fb'],
        ])}
        {lin(`${u}gold`, GOLD)}
        <radialGradient id={`${u}glow`} cx=".5" cy=".38" r=".55">
          <stop offset="0" stopColor="#7fd8ff" stopOpacity=".42" />
          <stop offset=".5" stopColor="#8a6bff" stopOpacity=".16" />
          <stop offset="1" stopColor="#8a6bff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="10" y="10" width="340" height="134" rx="16" fill={`url(#${u}glow)`} />
      {/* the deco fan */}
      <g stroke="#c9a24a" strokeWidth=".9" opacity=".5" fill="none">
        {Array.from({ length: 15 }, (_, i) => (
          <path key={i} d={`M180 150 L${180 + Math.cos(Math.PI + (i / 14) * Math.PI) * 190} ${150 + Math.sin(Math.PI + (i / 14) * Math.PI) * 190}`} />
        ))}
        <path d="M70 150 A110 110 0 0 1 290 150" />
        <path d="M100 150 A80 80 0 0 1 260 150" />
      </g>
      <g stroke="#c9a24a" strokeWidth="1.4" fill="none">
        <path d="M20 22 H50 M20 22 V52 M340 22 H310 M340 22 V52" />
        <path d="M25 27 H42 M25 27 V44 M335 27 H318 M335 27 V44" opacity=".6" />
      </g>
      <SymbolArt sym="diamond" x={136} y={4} size={88} />
      <Title x={180} y={114} size={32} ls={6} fill={`url(#${u}plat)`} stroke="#0b0620" sw={5}>
        DIAMOND
      </Title>
      <g>
        <path d="M96 132 H146 M214 132 H264" stroke={`url(#${u}gold)`} strokeWidth="1.6" />
        <path d="M92 132 l4 -4 4 4 -4 4Z M268 132 l-4 -4 -4 4 4 4Z" fill="#e8c25a" />
        <text x="180" y="136.5" textAnchor="middle" fontSize="12" fontWeight="800" fill={`url(#${u}gold)`} fontFamily={FONT} letterSpacing="7">
          DELUXE
        </text>
      </g>
      {/* either side of the stone, inside the corner brackets */}
      <text x="78" y="50" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#c9a24a" fontFamily={FONT} letterSpacing="2.4">
        TOP PRIZE
      </text>
      <text x="78" y="72" textAnchor="middle" fontSize="21" fontWeight="800" fill={`url(#${u}gold)`} fontFamily={FONT}>
        {top}
      </text>
      <text x="282" y="50" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#c9a24a" fontFamily={FONT} letterSpacing="2.4">
        MATCH 3
      </text>
      <text x="282" y="72" textAnchor="middle" fontSize="21" fontWeight="800" fill={`url(#${u}gold)`} fontFamily={FONT}>
        TO WIN
      </text>
      <path d={twinkle(122, 30, 5)} fill="#fff" />
      <path d={twinkle(244, 56, 4)} fill="#fff" />
    </g>
  )
}

/* ---------------- frames and paper ---------------- */

function Paper({ id, u }: { id: CardId; u: string }) {
  const t = THEMES[id]
  return (
    <g>
      <defs>
        {lin(`${u}paper`, [
          [0, t.paper[0]],
          [1, t.paper[1]],
        ])}
        {lin(`${u}gold`, GOLD, 1, 1)}
        <pattern id={`${u}pat`} width="28" height="28" patternUnits="userSpaceOnUse" patternTransform="rotate(18)">
          {id === 'clover' && (
            <g fill="#fff" opacity=".05">
              <circle cx="10" cy="8" r="3.4" />
              <circle cx="15" cy="12" r="3.4" />
              <circle cx="7" cy="13" r="3.4" />
            </g>
          )}
          {id === 'gold' && <path d="M0 6 Q14 2 28 6 M0 18 Q14 14 28 18" stroke="#fff" strokeWidth=".8" opacity=".05" fill="none" />}
          {id === 'fruit' && <circle cx="14" cy="14" r="3" fill="#fff" opacity=".12" />}
          {id === 'diamond' && <path d="M14 2 L26 14 L14 26 L2 14Z" stroke="#c9a24a" strokeWidth=".7" opacity=".16" fill="none" />}
        </pattern>
      </defs>
      <rect width={CARD_W} height={CARD_H} rx={CARD_R} fill={`url(#${u}paper)`} />
      <rect width={CARD_W} height={CARD_H} rx={CARD_R} fill={`url(#${u}pat)`} />
      {/* frame */}
      {id === 'clover' && (
        <g fill="none">
          <rect x="4" y="4" width={CARD_W - 8} height={CARD_H - 8} rx={CARD_R - 3} stroke={`url(#${u}gold)`} strokeWidth="3" />
          <rect x="9" y="9" width={CARD_W - 18} height={CARD_H - 18} rx={CARD_R - 7} stroke="#f0c24a" strokeWidth="1" opacity=".6" />
        </g>
      )}
      {id === 'gold' && (
        <g fill="none">
          <rect x="4" y="4" width={CARD_W - 8} height={CARD_H - 8} rx={CARD_R - 3} stroke="#d9a631" strokeWidth="2.6" />
          <rect x="8.5" y="8.5" width={CARD_W - 17} height={CARD_H - 17} rx={CARD_R - 7} stroke="#e9c27a" strokeWidth="1.2" strokeDasharray="5 3" opacity=".7" />
        </g>
      )}
      {id === 'fruit' && (
        <g fill="none">
          <rect x="4" y="4" width={CARD_W - 8} height={CARD_H - 8} rx={CARD_R - 3} stroke="#fff" strokeWidth="2.4" opacity=".9" />
          <rect x="8.5" y="8.5" width={CARD_W - 17} height={CARD_H - 17} rx={CARD_R - 7} stroke="#ffe14a" strokeWidth="1.6" strokeDasharray="1 5" strokeLinecap="round" />
        </g>
      )}
      {id === 'diamond' && (
        <g fill="none" stroke={`url(#${u}gold)`}>
          <rect x="4" y="4" width={CARD_W - 8} height={CARD_H - 8} rx={CARD_R - 3} strokeWidth="2" />
          <rect x="8" y="8" width={CARD_W - 16} height={CARD_H - 16} rx={CARD_R - 7} strokeWidth=".8" opacity=".7" />
        </g>
      )}
    </g>
  )
}

/** the recess the foil sits in, and the nine cells printed under it */
function PlayArea({ id, u }: { id: CardId; u: string }) {
  const t = THEMES[id]
  return (
    <g>
      <defs>
        <linearGradient id={`${u}cell`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={t.cell[0]} />
          <stop offset="1" stopColor={t.cell[1]} />
        </linearGradient>
        <radialGradient id={`${u}vel`} cx=".5" cy=".42" r=".7">
          <stop offset="0" stopColor="#3a2a72" />
          <stop offset="1" stopColor={t.cell[1]} />
        </radialGradient>
      </defs>
      <rect x={PANEL.x - 2} y={PANEL.y - 2} width={PANEL.w + 4} height={PANEL.h + 4} rx={PANEL.r + 2} fill={t.well} opacity=".55" />
      <rect x={PANEL.x} y={PANEL.y} width={PANEL.w} height={PANEL.h} rx={PANEL.r} fill={t.well} opacity=".7" />
      {Array.from({ length: 9 }, (_, i) => {
        const r = cellRect(i)
        return (
          <g key={i}>
            <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="10" fill={t.dark ? `url(#${u}vel)` : `url(#${u}cell)`} />
            <rect x={r.x + 0.75} y={r.y + 0.75} width={r.w - 1.5} height={r.h - 1.5} rx="9.5" fill="none" stroke={t.cellEdge} strokeWidth="1.5" opacity=".7" />
          </g>
        )
      })}
    </g>
  )
}

/** the prize table's layout: four across, two rows, biggest first */
const TW = 82
const TH = 25
const TX0 = (CARD_W - TW * 4) / 2

/** where a prize's symbol sits in the printed table (design units, its 22-unit box) */
export function tableSlot(id: CardId, prize: number) {
  const j = CARDS[id].prizes.length - 1 - prize
  return { x: TX0 + (j % 4) * TW + 5, y: TABLE_Y + Math.floor(j / 4) * TH + 1.5, size: 22 }
}

/** The printed prize table: what each symbol pays at this card's price. `win` lights a row. */
function PrizeTable({ id, win, price }: { id: CardId; win: number; price: number }) {
  const t = THEMES[id]
  const c = CARDS[id]
  return (
    <g>
      <rect x={TX0 - 6} y={TABLE_Y - 5} width={TW * 4 + 12} height={TH * 2 + 10} rx="12" fill={t.table.bg} stroke={t.table.edge} strokeWidth="1" strokeOpacity=".55" />
      {/* biggest first, reading across */}
      {[...c.prizes].reverse().map((p, j) => {
        const i = c.prizes.length - 1 - j
        const x = TX0 + (j % 4) * TW
        const y = TABLE_Y + Math.floor(j / 4) * TH
        const on = i === win
        const label = coinLabel(round2(price * p.mult))
        return (
          <g key={p.sym}>
            {on && <rect x={x + 1} y={y + 1} width={TW - 2} height={TH - 2} rx="8" fill={t.win} opacity=".95" />}
            <SymbolArt sym={p.sym} x={x + 5} y={y + 1.5} size={22} />
            <text x={x + 30} y={y + 17.5} fontSize={label.length >= 7 ? 11 : label.length >= 6 ? 12 : 13.5} fontWeight="800" fill={on ? t.ink : t.table.fg} fontFamily={FONT}>
              {label}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * The printed card at a price (the prize table and the top prize are printed in coins). `win` lights the prize table
 * row of the prize won (-1 for none); a card on display has no serial yet.
 */
export const CardFace = memo(function CardFace({ id, serial, win = -1, price }: { id: CardId; serial: string; win?: number; price: number }) {
  const u = useUid()
  const t = THEMES[id]
  const top = coinLabel(round2(price * (id === 'fruit' ? maxMult(CARDS[id]) : topPrize(CARDS[id]).mult)))
  return (
    <svg className="absolute inset-0" width={CARD_W} height={CARD_H} viewBox={`0 0 ${CARD_W} ${CARD_H}`} aria-hidden>
      <Paper id={id} u={u} />
      {id === 'clover' ? <CloverHeader u={u} top={top} /> : id === 'gold' ? <GoldHeader u={u} top={top} /> : id === 'fruit' ? <FruitHeader u={u} top={top} /> : <DiamondHeader u={u} top={top} />}
      <PlayArea id={id} u={u} />
      <PrizeTable id={id} win={win} price={price} />
      <text x={CARD_W / 2} y={CARD_H - 11} textAnchor="middle" fontSize="7.4" fontWeight="700" fill={t.small} fontFamily={FONT} letterSpacing=".4">
        {serial ? `Nº ${serial} · ` : ''}Price {coinLabel(price)} · Match 3 to win{id === 'fruit' ? ' × the Frenzy spot' : ''} · Play money · Returns 96%
      </text>
    </svg>
  )
})

/* ---------------- the rack ---------------- */

/** A small picture of a card for the rack: its colours, its top symbol and a silvery play area. */
export function CardThumb({ id, size = 64 }: { id: CardId; size?: number }) {
  const u = useUid()
  const t = THEMES[id]
  const top = topPrize(CARDS[id]).sym
  const foil: Record<CardId, [string, string, string]> = {
    clover: ['#eef6f0', '#a9bcb0', '#dde9e1'],
    gold: ['#fff0b8', '#c9921f', '#f7d26b'],
    fruit: ['#ffd1ec', '#c9f2ff', '#fff6b8'],
    diamond: ['#c7cede', '#4b5266', '#a4abc0'],
  }
  const f = foil[id]
  return (
    <svg width={size} height={size * 1.4} viewBox="0 0 100 140" aria-hidden>
      <defs>
        {lin(`${u}p`, [
          [0, t.paper[0]],
          [1, t.paper[1]],
        ])}
        {lin(
          `${u}f`,
          [
            [0, f[0]],
            [0.5, f[1]],
            [1, f[2]],
          ],
          1,
          1,
        )}
      </defs>
      <rect x="2" y="2" width="96" height="136" rx="10" fill={`url(#${u}p)`} stroke={t.table.edge} strokeWidth="2.5" />
      <SymbolArt sym={top} x={26} y={6} size={48} />
      <rect x="12" y="58" width="76" height="62" rx="7" fill={`url(#${u}f)`} />
      {[0, 1, 2].map((r) =>
        [0, 1, 2].map((c) => <circle key={`${r}${c}`} cx={25 + c * 25} cy={69 + r * 20} r="6.5" fill="none" stroke="#000" strokeOpacity=".16" strokeWidth="1.6" />),
      )}
      <rect x="12" y="124" width="76" height="8" rx="4" fill={t.table.bg} />
    </svg>
  )
}
