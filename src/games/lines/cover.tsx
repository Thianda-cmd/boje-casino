import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'
import { ArtDefs, COL, FONT, GOLD, INK, JesterBall, LetterBall, NumBall, blobPath, starPath, twinklePath } from './art'

/*
  Lucky Lines' lobby cover and navigation icon. The cover is the game's moment in the lobby's toon style: a glossy
  bingo card tipped towards the viewer with a gold line blazing down its diagonal, the grinning Joker popping out
  over its corner, a 500× burst, and the reels' balls rolling along the bottom. Drawn with the game's own pieces
  (art.tsx: plain SVG, nothing heavy), so it ships in the main bundle. The icon is a 24 × 24 stroke drawing like the
  other nav icons: a card's grid with a line through it.
*/

/** the card's daubed cells (column * 5 + row): the diagonal that makes the line, and a few more */
const DAUBED = new Set([0, 6, 12, 18, 24, 3, 9, 15, 22, 21])
const NUMS = [2, 5, 7, 12, 14, 16, 19, 23, 27, 30, 33, 35, 38, 41, 44, 46, 49, 52, 58, 60, 63, 66, 68, 71, 75]

/** a 200 × 250 burst of `n` points */
function burst(n: number, ro: number, ri: number) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (i * Math.PI) / n - Math.PI / 2
    const r = i % 2 ? ri : ro
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
}

/** the card's grid, in the card's own frame */
const cx = (c: number) => 18 + c * 25
const cy = (r: number) => 41 + r * 25
const LINE = `M${cx(0) - 9} ${cy(0) - 9} L${cx(4) + 9} ${cy(4) + 9}`

export function LinesCover() {
  const u = useUid()
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <ArtDefs u={u} />
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor="#b48bff" />
          <stop offset=".55" stopColor="#7440e6" />
          <stop offset="1" stopColor="#3c1497" />
        </linearGradient>
        <radialGradient id={`${u}gl`} cx=".5" cy=".3" r=".62">
          <stop offset="0" stopColor="#fff" stopOpacity=".32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}frm`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor="#c3a2ff" />
          <stop offset=".5" stopColor="#8a58f2" />
          <stop offset="1" stopColor="#5f2fd0" />
        </linearGradient>
        <radialGradient id={`${u}cd`} cx=".42" cy=".34" r=".72">
          <stop offset="0" stopColor="#fffbf1" />
          <stop offset="1" stopColor="#f1dcb2" />
        </radialGradient>
        <filter id={`${u}blur`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="4.5" />
        </filter>
      </defs>

      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <rect width="200" height="250" fill={`url(#${u}gl)`} />
      <circle cx="182" cy="14" r="70" fill="#fff" opacity=".06" />
      <circle cx="8" cy="236" r="92" fill="#000" opacity=".1" />
      {/* light rays behind the card */}
      <g opacity=".14" fill="#fff">
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <path key={i} d="M100 118 L92 -40 L108 -40 Z" transform={`rotate(${i * 45 + 10} 100 118)`} />
        ))}
      </g>
      {[
        [16, 40, 0],
        [186, 104, 2],
        [12, 168, 3],
        [190, 186, 1],
        [40, 18, 4],
      ].map(([x, y, c], i) => (
        <circle key={i} cx={x} cy={y} r={i % 2 ? 4 : 5.5} fill={COL[c].main} stroke={INK} strokeWidth="1.6" />
      ))}

      {/* the card */}
      <g transform="translate(28 50) rotate(-7 68 84)">
        <rect x="0" y="6" width="136" height="166" rx="16" fill={INK} opacity=".4" />
        <rect x="0" y="0" width="136" height="166" rx="16" fill={`url(#${u}frm)`} stroke={INK} strokeWidth="3" />
        <path d="M14 3.5 H122" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".4" />
        {COL.map((_, c) => (
          <g key={c} transform={`translate(${cx(c) - 10.5} ${4}) scale(.21)`}>
            <LetterBall u={u} col={c} />
          </g>
        ))}
        <rect x="4" y="28" width="128" height="134" rx="11" fill="#fffaf0" stroke={INK} strokeWidth="2.2" />
        {/* in layers, as in the game: the discs and daubs, the line, then the numbers over it */}
        {NUMS.map((_, i) => {
          const c = Math.floor(i / 5)
          const r = i % 5
          return (
            <g key={i}>
              <circle cx={cx(c)} cy={cy(r)} r="10.5" fill={`url(#${u}cd)`} stroke={INK} strokeOpacity=".2" strokeWidth="1" />
              {DAUBED.has(i) && (
                <g transform={`translate(${cx(c) - 11.5} ${cy(r) - 11.5}) scale(.23)`}>
                  <path d={blobPath(i + 3, 50, 50, 50)} fill={COL[c].main} stroke={INK} strokeWidth="5" />
                  <ellipse cx="36" cy="30" rx="16" ry="9" fill="#fff" opacity=".45" transform="rotate(-28 36 30)" />
                </g>
              )}
            </g>
          )
        })}
        <path d={LINE} stroke={GOLD} strokeWidth="12" strokeLinecap="round" opacity=".6" filter={`url(#${u}blur)`} />
        <path d={LINE} stroke={INK} strokeWidth="8.5" strokeLinecap="round" />
        <path d={LINE} stroke={GOLD} strokeWidth="5" strokeLinecap="round" />
        <path d={LINE} stroke="#fff8cc" strokeWidth="1.5" strokeLinecap="round" />
        {NUMS.map((num, i) => {
          const on = DAUBED.has(i)
          return (
            <text
              key={i}
              x={cx(Math.floor(i / 5))}
              y={cy(i % 5) + 3.4}
              textAnchor="middle"
              fontSize="9.5"
              fontWeight="900"
              fontFamily={FONT}
              fill={on ? '#fff' : INK}
              stroke={on ? INK : 'none'}
              strokeWidth={on ? 2.2 : 0}
              paintOrder="stroke"
            >
              {num}
            </text>
          )
        })}
      </g>

      {/* the Joker popping out over the corner */}
      <g transform="translate(124 18) rotate(14 34 34)" style={{ filter: 'drop-shadow(0 6px 6px rgba(20,4,50,.35))' }}>
        <g transform="scale(.68)">
          <JesterBall u={u} />
        </g>
      </g>
      <path d="M118 30 l-8 -6 M116 44 l-10 -1 M126 18 l-5 -8" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" opacity=".85" />
      <path d={twinklePath(186, 74, 6)} fill="#fff" />
      <path d={twinklePath(110, 14, 4.5)} fill="#fff" opacity=".85" />
      <path d={twinklePath(20, 104, 4)} fill="#fff" opacity=".7" />

      {/* the reels: a cabinet along the bottom edge, the balls' tops showing */}
      <rect x="10" y="214" width="180" height="60" rx="14" fill="#3d1897" stroke={INK} strokeWidth="3" />
      {[0, 1, 2, 3, 4].map((c) => (
        <g key={c}>
          <rect x={17 + c * 35} y="220" width="31" height="40" rx="8" fill="#fff6e6" stroke={INK} strokeWidth="2" />
          <g transform={`translate(${17.5 + c * 35} ${222}) scale(.3)`}>
            <NumBall u={u} col={c} n={[9, 23, 41, 57, 70][c]} />
          </g>
        </g>
      ))}

      {/* 500× */}
      <g transform="translate(40 186) rotate(-12)" style={{ filter: 'drop-shadow(0 5px 6px rgba(20,4,50,.35))' }}>
        <polygon points={burst(12, 27, 19)} fill={GOLD} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
        <polygon points={burst(12, 19, 15)} fill="#ffe680" />
        <text y="5.5" textAnchor="middle" fontSize="15" fontWeight="900" fill="#ff4d6a" stroke="#fff" strokeWidth="3" paintOrder="stroke" fontFamily={FONT} letterSpacing="-.5">
          500×
        </text>
      </g>
      <path d={starPath(186, 150, 6)} fill={GOLD} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function LinesIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <path d="M3 8.5h18M9 8.5V21M15 8.5V21M3 14.75h18" opacity=".45" />
      <circle cx="6" cy="11.6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="11.6" r="1.4" fill="currentColor" stroke="none" opacity=".45" />
      <path d="M5 19.5 19 9.5" />
    </svg>
  )
}
