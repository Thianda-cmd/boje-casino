import type { ReactNode } from 'react'
import { useUid } from '../../art/ids'
import type { ItemKind, Tier } from './rules'

/*
  Cases art: the four crates and one loot picture per multiplier band. Flat shades of one hue lit from the top left,
  like the gems and chips, and no SVG filters, so fifty tiles sliding past stay cheap to draw.
*/

type Pal = { hi: string; light: string; mid: string; dark: string; deep: string }

const GOLD: Pal = { hi: '#fff6cf', light: '#ffdc6e', mid: '#f4b72f', dark: '#c98b12', deep: '#8a5705' }
const SILVER: Pal = { hi: '#ffffff', light: '#e4ebf2', mid: '#b9c6d3', dark: '#8597aa', deep: '#566779' }
const COPPER: Pal = { hi: '#ffd6b0', light: '#f2a66d', mid: '#d67d45', dark: '#a8552b', deep: '#6e3418' }
const BILL: Pal = { hi: '#e2ffee', light: '#a9f0c6', mid: '#62d394', dark: '#2f9a5d', deep: '#1b6a3f' }
const SACK: Pal = { hi: '#fdebc8', light: '#ebc88f', mid: '#d2a160', dark: '#a6753c', deep: '#6f4a20' }
const ICE = ['#ffffff', '#d9f7ff', '#a2e8ff', '#62cff8', '#33a8e8', '#1d7fc2', '#10548a']

/** a five-point star around (cx, cy) */
function star(cx: number, cy: number, ro: number, ri: number) {
  return (
    'M' +
    Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2
      const r = i % 2 ? ri : ro
      return `${(cx + Math.cos(a) * r).toFixed(2)} ${(cy + Math.sin(a) * r).toFixed(2)}`
    }).join('L') +
    'Z'
  )
}

/** a four-point twinkle around (x, y) */
export function twinkle(x: number, y: number, r: number) {
  const k = r * 0.2
  return `M${x} ${y - r}Q${x + k} ${y - k} ${x + r} ${y}Q${x + k} ${y + k} ${x} ${y + r}Q${x - k} ${y + k} ${x - r} ${y}Q${x - k} ${y - k} ${x} ${y - r}Z`
}

/** A coin face-on with its milled edge showing underneath. */
function CoinFace({ cx, cy, r, p, t = r * 0.2 }: { cx: number; cy: number; r: number; p: Pal; t?: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy + t} r={r} fill={p.deep} />
      <circle cx={cx} cy={cy} r={r} fill={p.dark} />
      <circle cx={cx} cy={cy} r={r * 0.86} fill={p.mid} />
      <path d={`M${cx - r * 0.86} ${cy}A${r * 0.86} ${r * 0.86} 0 0 1 ${cx + r * 0.86} ${cy}`} fill="none" stroke={p.light} strokeWidth={r * 0.07} opacity=".8" />
      <circle cx={cx} cy={cy} r={r * 0.66} fill="none" stroke={p.dark} strokeWidth={r * 0.07} opacity=".55" />
      <path d={star(cx + r * 0.03, cy + r * 0.05, r * 0.4, r * 0.17)} fill={p.dark} opacity=".75" />
      <path d={star(cx, cy, r * 0.4, r * 0.17)} fill={p.light} />
      <path d={`M${cx - r * 0.66} ${cy - r * 0.32}A${r * 0.74} ${r * 0.74} 0 0 1 ${cx - r * 0.12} ${cy - r * 0.72}`} fill="none" stroke={p.hi} strokeWidth={r * 0.12} strokeLinecap="round" opacity=".75" />
    </g>
  )
}

/** One coin of a stack, seen from the side: a rim band and its top face. */
function StackCoin({ cx, y, rx, ry, t, p }: { cx: number; y: number; rx: number; ry: number; t: number; p: Pal }) {
  return (
    <g>
      <path d={`M${cx - rx} ${y}V${y + t}A${rx} ${ry} 0 0 0 ${cx + rx} ${y + t}V${y}Z`} fill={p.dark} />
      <path d={`M${cx - rx * 0.55} ${y + ry * 0.84 + t * 0.2}v${t * 0.6}M${cx} ${y + ry + t * 0.2}v${t * 0.6}M${cx + rx * 0.55} ${y + ry * 0.84 + t * 0.2}v${t * 0.6}`} stroke={p.deep} strokeWidth="1" opacity=".6" />
      <ellipse cx={cx} cy={y} rx={rx} ry={ry} fill={p.mid} />
      <ellipse cx={cx} cy={y} rx={rx * 0.7} ry={ry * 0.62} fill="none" stroke={p.light} strokeWidth="1.2" opacity=".8" />
      <path d={`M${cx - rx * 0.8} ${y - ry * 0.25}A${rx} ${ry} 0 0 1 ${cx - rx * 0.1} ${y - ry * 0.95}`} stroke={p.hi} strokeWidth="1.4" fill="none" strokeLinecap="round" opacity=".8" />
    </g>
  )
}

/** A gold ingot in three-quarter view; (x, y) is the front bottom left corner, s its scale. */
function Ingot({ x, y, s }: { x: number; y: number; s: number }) {
  const P = (px: number, py: number) => `${(x + px * s).toFixed(2)} ${(y + py * s).toFixed(2)}`
  return (
    <g>
      <path d={`M${P(0, 0)}L${P(36, 0)}L${P(31, -12)}L${P(5, -12)}Z`} fill={GOLD.mid} />
      <path d={`M${P(5, -12)}L${P(31, -12)}L${P(38, -18)}L${P(13, -18)}Z`} fill={GOLD.light} />
      <path d={`M${P(36, 0)}L${P(43, -7)}L${P(38, -18)}L${P(31, -12)}Z`} fill={GOLD.dark} />
      <path d={`M${P(5, -12)}L${P(31, -12)}`} stroke={GOLD.hi} strokeWidth={1.2 * s} strokeLinecap="round" />
      <path d={`M${P(13.5, -14)}L${P(27, -14)}L${P(30.5, -16.6)}L${P(17.5, -16.6)}Z`} fill={GOLD.mid} opacity=".75" />
      <path d={`M${P(3, -3)}L${P(9, -9)}`} stroke={GOLD.hi} strokeWidth={1.4 * s} strokeLinecap="round" opacity=".7" />
    </g>
  )
}

/** A small brilliant-cut stone: crown and pavilion facets in the ice palette. (cx, cy) is the girdle centre. */
function Brilliant({ cx, cy, w, c = ICE }: { cx: number; cy: number; w: number; c?: string[] }) {
  const h = w / 2
  const P = (px: number, py: number) => `${(cx + px * h).toFixed(2)} ${(cy + py * h).toFixed(2)}`
  return (
    <g>
      <path d={`M${P(-0.62, -0.5)}L${P(-0.26, -0.5)}L${P(-0.42, 0)}L${P(-1, 0)}Z`} fill={c[2]} />
      <path d={`M${P(-0.26, -0.5)}L${P(0.26, -0.5)}L${P(0.42, 0)}L${P(-0.42, 0)}Z`} fill={c[1]} />
      <path d={`M${P(0.26, -0.5)}L${P(0.62, -0.5)}L${P(1, 0)}L${P(0.42, 0)}Z`} fill={c[3]} />
      <path d={`M${P(-1, 0)}L${P(-0.42, 0)}L${P(0, 1.15)}Z`} fill={c[3]} />
      <path d={`M${P(-0.42, 0)}L${P(0, 0)}L${P(0, 1.15)}Z`} fill={c[2]} />
      <path d={`M${P(0, 0)}L${P(0.42, 0)}L${P(0, 1.15)}Z`} fill={c[4]} />
      <path d={`M${P(0.42, 0)}L${P(1, 0)}L${P(0, 1.15)}Z`} fill={c[5]} />
      <path d={`M${P(-0.2, -0.42)}L${P(0.16, -0.42)}L${P(0.24, -0.16)}L${P(-0.28, -0.16)}Z`} fill={c[0]} opacity=".8" />
      <path d={`M${P(-0.62, -0.5)}L${P(0.62, -0.5)}L${P(1, 0)}L${P(0, 1.15)}L${P(-1, 0)}Z`} fill="none" stroke={c[6]} strokeOpacity=".5" strokeWidth={h * 0.07} strokeLinejoin="round" />
    </g>
  )
}

const SACK_PATH = 'M22 28C12 34 7.5 45 10.5 51.5 13.5 58 50.5 58 53.5 51.5 56.5 45 52 34 42 28Z'

function MoneyBag() {
  const u = useUid()
  return (
    <g>
      <defs>
        <clipPath id={`${u}s`}>
          <path d={SACK_PATH} />
        </clipPath>
      </defs>
      <path d={SACK_PATH} fill={SACK.mid} />
      <g clipPath={`url(#${u}s)`}>
        <path d="M40 27C50 34 51 48 42 60H62V27Z" fill={SACK.dark} />
        <path d="M22 28C15 33 11.5 41 12.6 47.5 15 41 18.5 34.5 25.5 29.5Z" fill={SACK.light} />
      </g>
      <path d="M23.5 24.5C18.5 21 20 13.5 26 15.5 28 11 36 11 38 15.5 44 13.5 45.5 21 40.5 24.5Z" fill={SACK.light} />
      <path d="M38 15.5C44 13.5 45.5 21 40.5 24.5H33.5C36.5 21.5 37.5 18.5 38 15.5Z" fill={SACK.mid} />
      <rect x="21.5" y="23" width="21" height="5.6" rx="2.8" fill={GOLD.dark} />
      <rect x="21.5" y="23" width="21" height="2.8" rx="1.4" fill={GOLD.light} />
      <CoinFace cx={32} cy={43} r={8.4} p={GOLD} t={1.6} />
    </g>
  )
}

const ITEMS: Record<ItemKind, () => ReactNode> = {
  // each entry is rendered as a component (<C />), so one may use hooks
  copper: () => <CoinFace cx={32} cy={30} r={19} p={COPPER} t={4} />,
  silver: () => (
    <g>
      <CoinFace cx={39} cy={25} r={15} p={SILVER} t={3.4} />
      <CoinFace cx={26} cy={36} r={16.5} p={SILVER} t={3.6} />
    </g>
  ),
  coins: () => (
    <g>
      {[50, 44.5, 39, 33.5, 28].map((y, i) => (
        <StackCoin key={i} cx={i === 4 ? 25 : 26 - (i % 2) * 1.2} y={y} rx={16} ry={5.6} t={4.2} p={GOLD} />
      ))}
      <CoinFace cx={46} cy={43} r={12.5} p={GOLD} t={3} />
    </g>
  ),
  cash: () => (
    <g transform="rotate(-11 32 34)">
      <rect x="7" y="27" width="50" height="24" rx="3.5" fill={BILL.deep} />
      <rect x="7" y="24" width="50" height="24" rx="3.5" fill={BILL.dark} />
      <path d="M8 26.5h48M8 29.5h48" stroke={BILL.light} strokeOpacity=".35" strokeWidth=".8" transform="translate(0 18)" />
      <rect x="7" y="20" width="50" height="24" rx="3.5" fill={BILL.mid} />
      <rect x="10.5" y="23.5" width="43" height="17" rx="2" fill="none" stroke={BILL.dark} strokeWidth="1.3" />
      <circle cx="18" cy="32" r="2.4" fill={BILL.dark} opacity=".7" />
      <circle cx="46" cy="32" r="2.4" fill={BILL.dark} opacity=".7" />
      <rect x="8" y="20.6" width="48" height="1.4" rx=".7" fill={BILL.hi} opacity=".6" />
      <rect x="25.5" y="18.2" width="13" height="28.6" rx="1.6" fill="#f3e3b6" />
      <rect x="25.5" y="18.2" width="13" height="28.6" rx="1.6" fill="none" stroke="#c49a4c" strokeWidth="1" />
      <path d={star(32, 32.5, 4.2, 1.8)} fill="#c49a4c" />
      <rect x="26.5" y="19" width="2" height="27" fill="#fff" opacity=".45" />
    </g>
  ),
  bag: () => <MoneyBag />,
  bar: () => (
    <g>
      <Ingot x={6} y={56} s={1.05} />
      <Ingot x={13} y={38.5} s={0.88} />
    </g>
  ),
  watch: () => (
    <g>
      <path d="M24.5 3h15l-1.6 16h-11.8Z" fill="#4a3024" />
      <path d="M26.2 47h11.6l1.7 14h-15Z" fill="#4a3024" />
      <path d="M27.5 5v12M36.5 5v12M27.6 49v10M36.4 49v10" stroke="#7b5440" strokeWidth="1" strokeDasharray="1.6 1.6" />
      <rect x="47.5" y="29" width="5.5" height="8" rx="1.6" fill={GOLD.dark} />
      <circle cx="32" cy="33" r="17.5" fill={GOLD.dark} />
      <circle cx="32" cy="33" r="16" fill={GOLD.mid} />
      <path d="M17.6 30A14.6 14.6 0 0 1 40 19.6" fill="none" stroke={GOLD.hi} strokeWidth="1.6" strokeLinecap="round" opacity=".85" />
      <circle cx="32" cy="33" r="12.6" fill="#1b2633" />
      <circle cx="32" cy="33" r="11.4" fill="#fbf6ea" />
      {Array.from({ length: 12 }, (_, i) => (
        <rect key={i} x="31.4" y={i % 3 ? 22.9 : 22.4} width="1.2" height={i % 3 ? 2 : 3.2} rx=".5" fill={i % 3 ? '#8a94a3' : '#1f2833'} transform={`rotate(${i * 30} 32 33)`} />
      ))}
      <path d="M32 33 26.6 28.6" stroke="#1f2833" strokeWidth="2" strokeLinecap="round" />
      <path d="M32 33 38.6 25.4" stroke="#1f2833" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M32 33 30.4 40.4" stroke="#e8344e" strokeWidth=".9" strokeLinecap="round" />
      <circle cx="32" cy="33" r="1.5" fill={GOLD.dark} />
      <path d="M22.6 29.4A10 10 0 0 1 30 23.2L27.8 31.6Z" fill="#fff" opacity=".55" />
    </g>
  ),
  ring: () => (
    <g>
      <ellipse cx="32" cy="42" rx="15.5" ry="13.5" fill="none" stroke={GOLD.deep} strokeWidth="6.4" />
      <ellipse cx="32" cy="42" rx="15.5" ry="13.5" fill="none" stroke={GOLD.mid} strokeWidth="4.4" />
      <path d="M17.6 38A15 13 0 0 1 26 29.4" fill="none" stroke={GOLD.hi} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M44.5 48A15 13 0 0 1 36 55" fill="none" stroke={GOLD.dark} strokeWidth="2" strokeLinecap="round" />
      <path d="M25.5 31.5 28 26h8l2.5 5.5Z" fill={GOLD.dark} />
      <path d="M27 30.5 29 26.5h6l2 4Z" fill={GOLD.mid} />
      <Brilliant cx={32} cy={19.5} w={23} />
      <path d={twinkle(45, 11, 4.2)} fill="#fff" />
    </g>
  ),
  trophy: () => (
    <g>
      <path d="M18.5 17C9 16.5 8.5 31 20.5 32" fill="none" stroke={GOLD.dark} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M45.5 17C55 16.5 55.5 31 43.5 32" fill="none" stroke={GOLD.dark} strokeWidth="4.2" strokeLinecap="round" />
      <path d="M17 11h30v9c0 11-6.8 18-15 18s-15-7-15-18Z" fill={GOLD.mid} />
      <path d="M32 11h15v9c0 11-6.8 18-15 18Z" fill={GOLD.dark} opacity=".55" />
      <path d="M20.5 15v5.5c0 5 1.6 9 4.4 11.8" fill="none" stroke={GOLD.hi} strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <rect x="15" y="8.5" width="34" height="5.2" rx="2.2" fill={GOLD.light} />
      <path d={star(32, 22.5, 6.2, 2.7)} fill={GOLD.light} />
      <path d="M29.3 38h5.4l-.9 7h-3.6Z" fill={GOLD.dark} />
      <rect x="25.5" y="44" width="13" height="3.6" rx="1.6" fill={GOLD.mid} />
      <path d="M21.5 47.5h21l3 9h-27Z" fill="#2c3646" />
      <path d="M21.5 47.5h21l.7 2.2h-22.4Z" fill="#43516a" />
      <rect x="27" y="51" width="10" height="3" rx="1" fill={GOLD.light} />
    </g>
  ),
  crown: () => (
    <g>
      <path d="M11 44 7.5 20.5 21 31.5 32 13l11 18.5 13.5-11L53 44Z" fill={GOLD.mid} strokeLinejoin="round" stroke={GOLD.mid} strokeWidth="1.5" />
      <path d="M32 13l11 18.5 13.5-11L53 44H32Z" fill={GOLD.dark} opacity=".5" />
      <path d="M24 34.5 31.2 22" fill="none" stroke={GOLD.hi} strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
      <rect x="9.5" y="42" width="45" height="10.5" rx="2.6" fill={GOLD.dark} />
      <rect x="9.5" y="42" width="45" height="3" rx="1.5" fill={GOLD.light} />
      {[
        [7.5, 20.5],
        [32, 13],
        [56.5, 20.5],
      ].map(([x, y]) => (
        <g key={x}>
          <circle cx={x} cy={y} r="3.4" fill="#f4ead7" />
          <circle cx={x - 1} cy={y - 1} r="1.2" fill="#fff" />
        </g>
      ))}
      <path d="M32 43.6 36 47.4 32 51.2 28 47.4Z" fill="#ff4d61" />
      <path d="M32 43.6 36 47.4H28Z" fill="#ff8a98" />
      <circle cx="19.5" cy="47.4" r="2.6" fill="#4f9dff" />
      <circle cx="44.5" cy="47.4" r="2.6" fill="#4f9dff" />
      <circle cx="18.8" cy="46.7" r=".9" fill="#d7ebff" />
      <circle cx="43.8" cy="46.7" r=".9" fill="#d7ebff" />
    </g>
  ),
  diamond: () => (
    <g>
      <path d="M18 14h28l12.5 15L32 58.5 5.5 29Z" fill={ICE[3]} />
      <path d="M18 14h9l-5.5 15H5.5Z" fill={ICE[2]} />
      <path d="M27 14h10l5.5 15h-21Z" fill={ICE[1]} />
      <path d="M37 14h9l12.5 15H42.5Z" fill={ICE[3]} />
      <path d="M5.5 29h16L32 58.5Z" fill={ICE[3]} />
      <path d="M21.5 29H32v29.5Z" fill={ICE[2]} />
      <path d="M32 29h10.5L32 58.5Z" fill={ICE[4]} />
      <path d="M42.5 29h16L32 58.5Z" fill={ICE[5]} />
      <path d="M5.5 29h53" stroke={ICE[0]} strokeOpacity=".6" strokeWidth="1" />
      <path d="M28.5 16.5h7.2l2.4 7h-12Z" fill="#fff" opacity=".8" />
      <path d="M9.5 29.6h8l7.6 17.2Z" fill="#fff" opacity=".3" />
      <path d="M18 14h28l12.5 15L32 58.5 5.5 29Z" fill="none" stroke={ICE[6]} strokeOpacity=".55" strokeWidth="1.2" strokeLinejoin="round" />
      <path d={twinkle(52, 10, 5)} fill="#fff" />
      <path d={twinkle(9, 47, 3.2)} fill="#fff" opacity=".85" />
    </g>
  ),
  chest: () => (
    <g>
      <path d="M9 31 12.5 12.5Q32 6 51.5 12.5L55 31Z" fill="#5c2e12" />
      <path d="M13.5 30 16 15.5Q32 10.5 48 15.5L50.5 30Z" fill="#3a1d0a" />
      <path d="M12.5 12.5Q32 6 51.5 12.5" fill="none" stroke={GOLD.mid} strokeWidth="3" strokeLinecap="round" />
      <path d="M12.5 12.5 9 31M51.5 12.5 55 31" stroke={GOLD.dark} strokeWidth="2.6" strokeLinecap="round" />
      <ellipse cx="32" cy="30.5" rx="21" ry="6" fill={GOLD.dark} />
      {[
        [17, 28.5, 5],
        [25.5, 25.5, 5.4],
        [36, 25, 5.2],
        [45.5, 28, 4.8],
        [31, 29.5, 5],
        [21.5, 31, 4.4],
        [41.5, 31, 4.6],
      ].map(([x, y, r], i) => (
        <g key={i}>
          <circle cx={x} cy={y + 1.2} r={r} fill={GOLD.deep} />
          <circle cx={x} cy={y} r={r} fill={i % 2 ? GOLD.mid : GOLD.light} />
          <circle cx={x} cy={y} r={r * 0.62} fill="none" stroke={GOLD.dark} strokeWidth=".9" opacity=".6" />
        </g>
      ))}
      <path d="M38 17.5 42 21.6 38 25.7 34 21.6Z" fill="#ff4d61" />
      <path d="M38 17.5 42 21.6H34Z" fill="#ff98a5" />
      <rect x="7.5" y="31.5" width="49" height="24.5" rx="3" fill="#a8642c" />
      <rect x="7.5" y="44" width="49" height="12" rx="3" fill="#7d461b" />
      <path d="M7.5 43.6h49" stroke="#5a2f10" strokeWidth="1" />
      <rect x="11" y="31.5" width="5" height="24.5" fill={GOLD.mid} />
      <rect x="48" y="31.5" width="5" height="24.5" fill={GOLD.dark} />
      <rect x="6.5" y="30" width="51" height="5" rx="1.6" fill={GOLD.mid} />
      <rect x="6.5" y="30" width="51" height="1.8" rx=".9" fill={GOLD.hi} />
      <rect x="26.5" y="35" width="11" height="12" rx="2" fill={GOLD.light} />
      <path d="M32 38.4a1.8 1.8 0 0 1 1 3.3l.6 2.8h-3.2l.6-2.8a1.8 1.8 0 0 1 1-3.3Z" fill="#5a2f10" />
      <path d={twinkle(53, 15, 4.2)} fill="#fff" />
      <path d={twinkle(10, 23, 2.8)} fill="#fff" opacity=".85" />
    </g>
  ),
}

/** The loot picture for an item kind, `size` px square. */
export function ItemArt({ kind, size = 64, className, x, y }: { kind: ItemKind; size?: number; className?: string; x?: number; y?: number }) {
  const Item = ITEMS[kind]
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 64 64" className={className} overflow="visible" aria-hidden>
      <Item />
    </svg>
  )
}

/* ---------------- crates ---------------- */

/** each crate's colours: frame, panel and trim, from light to deep, plus an accent */
const CRATE: Record<Tier, Pal & { ink: string; accent: string; inside: string }> = {
  low: { hi: '#f7cf98', light: '#e4a96b', mid: '#c88a4f', dark: '#9b6133', deep: '#6b3d1a', ink: '#4a2810', accent: '#8b96a3', inside: '#1a0e06' },
  medium: { hi: '#f5f9fc', light: '#d3dde7', mid: '#a6b5c4', dark: '#74869a', deep: '#4a596a', ink: '#2c3743', accent: '#4cc1ff', inside: '#0a1119' },
  high: { hi: '#fff7d1', light: '#ffdc6c', mid: '#f1b42d', dark: '#c4860f', deep: '#8a5604', ink: '#5a3700', accent: '#ff3d5e', inside: '#1e1100' },
  extreme: { hi: '#a585d6', light: '#5c4282', mid: '#2e1f45', dark: '#1d132c', deep: '#110a1c', ink: '#07040c', accent: '#ff4f8b', inside: '#050208' },
}

export const CRATE_ACCENT: Record<Tier, string> = { low: '#f0a860', medium: '#5cc8ff', high: '#ffcc4d', extreme: '#ff5c95' }

/** The crate body: everything below the lid, drawn in a 160 × 150 box. */
function CrateBody({ tier }: { tier: Tier }) {
  const c = CRATE[tier]
  const u = useUid()
  return (
    <g>
      <defs>
        <clipPath id={`${u}b`}>
          <rect x="20" y="60" width="120" height="72" rx="8" />
        </clipPath>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset=".35" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".24" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="139" rx="62" ry="7" fill="#000" opacity=".38" />
      {/* the open top: only seen while the lid is up */}
      <path d="M21 62 28 53h104l7 9Z" fill={c.inside} />
      <rect x="20" y="60" width="120" height="72" rx="8" fill={c.mid} />
      <g clipPath={`url(#${u}b)`}>
        {tier === 'low' && (
          <g>
            {[84, 108].map((y) => (
              <g key={y}>
                <rect x="20" y={y - 1} width="120" height="2.4" fill={c.deep} opacity=".6" />
                <rect x="20" y={y + 1.4} width="120" height="1.2" fill={c.hi} opacity=".22" />
              </g>
            ))}
            <path d="M40 72c14-2 26 2 40 0s26-3 44 0M44 96c16 2 30-2 46 0s20 2 30-1M40 118c12-2 26 1 38 0" fill="none" stroke={c.dark} strokeWidth="1.2" opacity=".45" />
            {/* the diagonal brace, raised over the planks */}
            <path d="M38 132 51 132 124 64 111 64Z" fill={c.deep} opacity=".35" transform="translate(0 3)" />
            <path d="M38 132 51 132 124 64 111 64Z" fill={c.light} />
            <path d="M38 132 111 64h3L41 132Z" fill={c.hi} opacity=".45" />
            <rect x="20" y="60" width="17" height="72" fill={c.dark} />
            <rect x="123" y="60" width="17" height="72" fill={c.dark} />
            <rect x="37" y="60" width="2.4" height="72" fill={c.deep} opacity=".5" />
            <rect x="120.6" y="60" width="2.4" height="72" fill={c.deep} opacity=".5" />
            <rect x="21.5" y="60" width="2" height="72" fill={c.light} opacity=".5" />
            <rect x="124.5" y="60" width="2" height="72" fill={c.light} opacity=".35" />
            {[
              [28.5, 70],
              [28.5, 122],
              [131.5, 70],
              [131.5, 122],
            ].map(([x, y]) => (
              <g key={`${x}${y}`}>
                <circle cx={x} cy={y} r="2.6" fill="#3e4650" />
                <circle cx={x - 0.6} cy={y - 0.6} r="1" fill="#aab4bf" />
              </g>
            ))}
          </g>
        )}
        {tier === 'medium' && (
          <g>
            <rect x="20" y="60" width="120" height="14" fill={c.light} opacity=".55" />
            <rect x="38" y="76" width="84" height="44" rx="4" fill={c.dark} />
            <rect x="38" y="118" width="84" height="2" rx="1" fill={c.hi} opacity=".5" />
            {Array.from({ length: 9 }, (_, i) => (
              <rect key={i} x="40" y={80 + i * 4.4} width="80" height="1" fill={c.hi} opacity=".12" />
            ))}
            <rect x="20" y="60" width="15" height="72" fill={c.deep} />
            <rect x="125" y="60" width="15" height="72" fill={c.deep} />
            <rect x="21.4" y="60" width="2" height="72" fill={c.dark} />
            <rect x="126.4" y="60" width="2" height="72" fill={c.dark} />
            {[70, 96, 122].flatMap((y) => [27.5, 132.5].map((x) => [x, y])).map(([x, y]) => (
              <g key={`${x}${y}`}>
                <circle cx={x} cy={y} r="2.8" fill={c.ink} />
                <circle cx={x} cy={y - 0.3} r="2.2" fill={c.light} />
                <circle cx={x - 0.6} cy={y - 0.9} r=".8" fill="#fff" />
              </g>
            ))}
            <rect x="44" y="108" width="72" height="5" rx="2.5" fill={c.accent} opacity=".25" />
            <rect x="46" y="109.4" width="68" height="2.2" rx="1.1" fill={c.accent} />
          </g>
        )}
        {tier === 'high' && (
          <g>
            <rect x="20" y="60" width="120" height="12" fill={c.light} opacity=".6" />
            <rect x="34" y="72" width="92" height="50" rx="6" fill={c.dark} opacity=".42" />
            <rect x="34" y="72" width="92" height="50" rx="6" fill="none" stroke={c.hi} strokeOpacity=".55" strokeWidth="1.5" />
            <rect x="38.5" y="76.5" width="83" height="41" rx="4" fill="none" stroke={c.deep} strokeOpacity=".5" strokeWidth="1.2" />
            {[48, 112].map((x) => (
              <g key={x}>
                <path d={`M${x} 88 ${x + 7} 97 ${x} 106 ${x - 7} 97Z`} fill={c.light} />
                <path d={`M${x} 88 ${x + 7} 97H${x - 7}Z`} fill={c.hi} />
              </g>
            ))}
            <rect x="20" y="60" width="13" height="72" fill={c.light} />
            <rect x="127" y="60" width="13" height="72" fill={c.dark} />
            {[
              [26.5, 68],
              [26.5, 124],
              [133.5, 68],
              [133.5, 124],
            ].map(([x, y]) => (
              <g key={`${x}${y}`}>
                <circle cx={x} cy={y + 0.8} r="3.4" fill={c.deep} />
                <circle cx={x} cy={y} r="3.2" fill={c.light} />
                <circle cx={x - 1} cy={y - 1} r="1.1" fill="#fff" />
              </g>
            ))}
            {/* a gloss band across the gold */}
            <path d="M60 60h22l-40 72H20Z" fill="#fff" opacity=".13" />
            <path d="M88 60h8l-40 72h-8Z" fill="#fff" opacity=".1" />
          </g>
        )}
        {tier === 'extreme' && (
          <g>
            <path d="M20 60h62L48 96 20 88Z" fill={c.light} opacity=".55" />
            <path d="M82 60h58v26L108 100Z" fill={c.dark} />
            <path d="M20 132V88l28 8 30 36Z" fill={c.deep} />
            <path d="M140 132V86l-32 14-20 32Z" fill={c.light} opacity=".28" />
            <path d="M48 96 82 60l26 40-20 32-10 0Z" fill={c.mid} />
            {/* glowing veins */}
            <path d="M24 74 40 80 48 96 66 104 78 126M108 100 122 92 138 96M88 132 98 116 108 100 114 78 126 66" fill="none" stroke={c.accent} strokeWidth="5" strokeOpacity=".22" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M24 74 40 80 48 96 66 104 78 126M108 100 122 92 138 96M88 132 98 116 108 100 114 78 126 66" fill="none" stroke={c.accent} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M40 80 48 96M108 100 114 78" fill="none" stroke="#ffd0e0" strokeWidth=".8" strokeLinecap="round" />
            <path d="M22 62.5h116" stroke={c.hi} strokeOpacity=".55" strokeWidth="1.4" />
          </g>
        )}
      </g>
      <rect x="20" y="60" width="120" height="72" rx="8" fill={`url(#${u}s)`} />
      <rect x="17" y="122" width="126" height="13" rx="5" fill={tier === 'extreme' ? c.ink : c.deep} />
      <rect x="17" y="122" width="126" height="2" rx="1" fill={tier === 'extreme' ? c.light : c.dark} />
      {/* the lock under the hasp */}
      <rect x="66" y="64" width="28" height="26" rx="6" fill={tier === 'low' ? '#4b545e' : c.deep} />
      <rect x="66" y="64" width="28" height="23.5" rx="6" fill={tier === 'low' ? '#7c8794' : tier === 'extreme' ? c.dark : c.light} />
      {tier === 'extreme' ? (
        <g>
          <path d="M80 70.5 86 74v7l-6 3.5-6-3.5v-7Z" fill={c.accent} opacity=".35" />
          <path d="M80 72.5 84.2 75v5l-4.2 2.5-4.2-2.5v-5Z" fill={c.accent} />
          <path d="M80 72.5 84.2 75 80 77.5 75.8 75Z" fill="#ffd0e0" />
        </g>
      ) : tier === 'medium' ? (
        <g>
          <rect x="72" y="72" width="16" height="8" rx="2" fill={c.ink} />
          <circle cx="76" cy="76" r="1.6" fill={c.accent} />
          <circle cx="80" cy="76" r="1.6" fill={c.accent} opacity=".5" />
          <circle cx="84" cy="76" r="1.6" fill={c.accent} opacity=".25" />
        </g>
      ) : (
        <path d="M80 71.5a3 3 0 0 1 1.7 5.5l1 4.5h-5.4l1-4.5a3 3 0 0 1 1.7-5.5Z" fill={tier === 'high' ? c.deep : '#2b3138'} />
      )}
    </g>
  )
}

/** The lid, in the same 160 × 150 box, drawn over the body. */
function CrateLid({ tier }: { tier: Tier }) {
  const c = CRATE[tier]
  const strap = tier === 'low' ? '#5f6a76' : tier === 'medium' ? c.deep : tier === 'high' ? c.light : c.dark
  return (
    <g>
      <path d="M33 21h94q3.2 0 5.2 2.4L143 38v4H17v-4l10.8-14.6Q29.8 21 33 21Z" fill={c.light} />
      {tier === 'low' && <path d="M24.5 27.5h111M20 33h120" stroke={c.dark} strokeWidth="1.3" opacity=".5" />}
      {tier === 'medium' && <path d="M27 30h106" stroke={c.dark} strokeWidth="2" opacity=".55" />}
      {tier === 'high' && <path d="M27 30h106" stroke={c.hi} strokeWidth="1.6" opacity=".8" />}
      {tier === 'extreme' && (
        <g>
          <path d="M33 21h47l-14 17H17l10.8-14.6Q29.8 21 33 21Z" fill={c.hi} opacity=".35" />
          <path d="M100 22l-8 16" stroke={c.accent} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )}
      <rect x="14" y="36" width="132" height="28" rx="7" fill={c.mid} />
      <rect x="19" y="36" width="122" height="3" rx="1.5" fill={c.hi} opacity={tier === 'extreme' ? 0.5 : 0.55} />
      <rect x="18" y="59" width="124" height="5" rx="2.5" fill={c.deep} opacity=".55" />
      {tier === 'low' && <path d="M18 49.5h124" stroke={c.deep} strokeWidth="1.6" opacity=".5" />}
      {tier === 'extreme' && (
        <g>
          <path d="M14 50 40 40l30 14 26-12 24 10 26-6" fill="none" stroke={c.accent} strokeWidth="4" strokeOpacity=".22" strokeLinejoin="round" />
          <path d="M14 50 40 40l30 14 26-12 24 10 26-6" fill="none" stroke={c.accent} strokeWidth="1.4" strokeLinejoin="round" />
        </g>
      )}
      {tier === 'medium' &&
        Array.from({ length: 10 }, (_, i) => (
          <g key={i}>
            <circle cx={30 + i * 11.1} cy="50" r="1.9" fill={c.ink} opacity=".6" />
            <circle cx={30 + i * 11.1} cy="49.6" r="1.4" fill={c.hi} />
          </g>
        ))}
      {tier === 'high' && <rect x="20" y="42.5" width="120" height="14" rx="4" fill="none" stroke={c.hi} strokeOpacity=".6" strokeWidth="1.3" />}
      {/* straps at the ends */}
      {[24, 126].map((x) => (
        <g key={x}>
          <rect x={x} y="36" width="10" height="28" fill={strap} />
          <rect x={x} y="36" width="2" height="28" fill={tier === 'extreme' ? c.hi : '#fff'} opacity={tier === 'extreme' ? 0.45 : 0.18} />
          {tier !== 'extreme' && (
            <>
              <circle cx={x + 5} cy="43" r="1.6" fill="#fff" opacity=".55" />
              <circle cx={x + 5} cy="57" r="1.6" fill="#fff" opacity=".55" />
            </>
          )}
        </g>
      ))}
      {/* the hasp */}
      <rect x="70" y="52" width="20" height="19" rx="4.5" fill={tier === 'low' ? '#3e4650' : c.deep} />
      <rect x="70" y="52" width="20" height="17" rx="4.5" fill={tier === 'low' ? '#9aa6b3' : tier === 'medium' ? c.light : tier === 'high' ? c.hi : c.dark} />
      {tier === 'high' ? (
        <g>
          <path d="M80 55.5 85 60.5 80 65.5 75 60.5Z" fill={c.accent} />
          <path d="M80 55.5 85 60.5H75Z" fill="#ff9aa9" />
        </g>
      ) : tier === 'extreme' ? (
        <rect x="78.6" y="56" width="2.8" height="9" rx="1.4" fill={c.accent} />
      ) : (
        <circle cx="80" cy="60.5" r="2.6" fill={tier === 'medium' ? c.accent : '#3e4650'} />
      )}
    </g>
  )
}

/** A whole crate, `size` px wide (the box is 160 × 150). `part` draws only the body or only the lid, so a page can
 *  lift the lid on its own layer. */
export function CrateArt({ tier, size = 160, part = 'all', className, x, y }: { tier: Tier; size?: number; part?: 'all' | 'body' | 'lid'; className?: string; x?: number; y?: number }) {
  return (
    <svg x={x} y={y} width={size} height={(size * 150) / 160} viewBox="0 0 160 150" className={className} overflow="visible" aria-hidden>
      {part !== 'lid' && <CrateBody tier={tier} />}
      {part !== 'body' && <CrateLid tier={tier} />}
    </svg>
  )
}
