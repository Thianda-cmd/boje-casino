import { useUid } from '../../art/ids'
import type { Die } from './rules'

/*
  Sic Bo's flat art: the ivory die drawn the way the 3D dice look (the 1 and the 4 in red, the rest in near-black ink,
  a big red ace), for the table, the readout and the history; and the big outlined lettering of the win banners.
*/

/** pip centres on a unit face */
const PIPS: Record<Die, readonly (readonly [number, number])[]> = {
  1: [[0.5, 0.5]],
  2: [
    [0.28, 0.28],
    [0.72, 0.72],
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
    [0.29, 0.24],
    [0.71, 0.24],
    [0.29, 0.5],
    [0.71, 0.5],
    [0.29, 0.76],
    [0.71, 0.76],
  ],
}
export const PIP_RED = '#d21f30'
const PIP_INK = '#24171b'

/** The ivory paint of a die face, as an SVG gradient (one per SVG: dice share it by id). */
export function IvoryDefs({ id }: { id: string }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2=".6" y2="1">
      <stop offset="0" stopColor="#fffdf6" />
      <stop offset=".55" stopColor="#f6eedc" />
      <stop offset="1" stopColor="#e6d7b9" />
    </linearGradient>
  )
}

/** A die face at (x, y), s across, inside an SVG; `fill` is the face's paint (an IvoryDefs url, or a colour). */
export function DieGlyph({ n, x, y, s, fill }: { n: Die; x: number; y: number; s: number; fill: string }) {
  const r = n === 1 ? 0.17 : n === 6 ? 0.088 : 0.098
  return (
    <g>
      {/* the die's depth under its face, which makes it a little tile rather than a flat square */}
      <rect x={x} y={y + s * 0.06} width={s} height={s} rx={s * 0.2} fill="#b59d74" />
      <rect x={x} y={y} width={s} height={s} rx={s * 0.2} fill={fill} stroke="rgba(70,45,20,.32)" strokeWidth={Math.max(0.5, s * 0.03)} />
      {PIPS[n].map(([px, py], i) => (
        <circle key={i} cx={x + px * s} cy={y + py * s} r={r * s} fill={n === 1 || n === 4 ? PIP_RED : PIP_INK} />
      ))}
    </g>
  )
}

/** A die face as its own little image, `size` px. */
export function DieFace({ n, size = 24, className }: { n: Die; size?: number; className?: string }) {
  const u = useUid()
  return (
    <svg width={size} height={size * 1.06} viewBox="0 0 20 21.2" className={className} aria-label={String(n)} role="img">
      <defs>
        <IvoryDefs id={`${u}iv`} />
      </defs>
      <DieGlyph n={n} x={0} y={0} s={20} fill={`url(#${u}iv)`} />
    </svg>
  )
}

/** Big lettering with a gradient face and an ink outline (a solid copy of the text behind the face). */
export function Lettering({ text, face, size }: { text: string; face: string; size: string }) {
  return (
    <span className={`relative inline-block whitespace-nowrap font-black italic leading-none tracking-tight ${size}`}>
      <span aria-hidden className="absolute inset-0 pl-[0.06em] pr-[0.16em] text-[#1d0f30] [-webkit-text-stroke:0.16em_#1d0f30] [filter:drop-shadow(0_0.07em_0_#1d0f30)]">
        {text}
      </span>
      <span className={`relative block bg-clip-text pl-[0.06em] pr-[0.16em] text-transparent ${face}`}>{text}</span>
    </span>
  )
}

export const FACE = {
  gold: 'bg-[linear-gradient(180deg,#fff6cf_0%,#ffd45c_45%,#f39b12_100%)]',
  rainbow: 'bg-[linear-gradient(100deg,#ff4fd8_0%,#ffe23d_30%,#6dff5a_55%,#2fd3ff_78%,#b38bff_100%)]',
}
