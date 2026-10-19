import type { ReelSym } from './rules'

/*
  Lucky Lines' drawings, in the lobby's toon style: ink outlines, bold glossy fills, a soft top light. Every symbol
  is a ball on a 100 × 100 grid, so the reels read as one clean row whatever lands: a bingo ball in its column's
  colour (the letter over the number, like the real thing), the Joker (a grinning jester on a violet ball), the Super
  Joker (the same jester in gold, a star on his hat) and the Free Spin (a ticket across a teal ball).

  The gradients live once in <ArtDefs>, referenced by a prefix, because a spin puts a hundred balls on the reels at
  once. Plain SVG with no animation and nothing heavy imported: the lobby cover (cover.tsx, main bundle) draws
  with these too.
*/

export const INK = '#1d0f30'
export const FONT = 'Manrope, system-ui, sans-serif'

export interface ColStyle {
  letter: string
  main: string
  light: string
  dark: string
}
/** the five columns, L-U-C-K-Y: cherry, tangerine, mint, sky and grape */
export const COL: readonly ColStyle[] = [
  { letter: 'L', main: '#ff4d6a', light: '#ffb0bc', dark: '#c4234a' },
  { letter: 'U', main: '#ff9b1f', light: '#ffd596', dark: '#cf6604' },
  { letter: 'C', main: '#25c46c', light: '#9cf2c0', dark: '#118a4a' },
  { letter: 'K', main: '#2b9dff', light: '#a8d8ff', dark: '#1563c4' },
  { letter: 'Y', main: '#a463ff', light: '#dcc4ff', dark: '#6d33d6' },
]
export const GOLD = '#ffd23d'

/** the gradients every drawing here uses; render once (inside any <svg>) and pass the same prefix to the drawings */
export function ArtDefs({ u }: { u: string }) {
  return (
    <defs>
      {COL.map((c, i) => (
        <radialGradient key={c.letter} id={`${u}b${i}`} cx=".36" cy=".3" r=".78">
          <stop offset="0" stopColor={c.light} />
          <stop offset=".48" stopColor={c.main} />
          <stop offset="1" stopColor={c.dark} />
        </radialGradient>
      ))}
      <radialGradient id={`${u}disc`} cx=".4" cy=".32" r=".8">
        <stop offset="0" stopColor="#ffffff" />
        <stop offset="1" stopColor="#efe6d6" />
      </radialGradient>
      <radialGradient id={`${u}jok`} cx=".36" cy=".3" r=".78">
        <stop offset="0" stopColor="#dcc6ff" />
        <stop offset=".5" stopColor="#8b5cf6" />
        <stop offset="1" stopColor="#5223bf" />
      </radialGradient>
      <radialGradient id={`${u}gold`} cx=".36" cy=".3" r=".78">
        <stop offset="0" stopColor="#fff8cf" />
        <stop offset=".45" stopColor="#ffcf3a" />
        <stop offset="1" stopColor="#d07a06" />
      </radialGradient>
      <radialGradient id={`${u}teal`} cx=".36" cy=".3" r=".78">
        <stop offset="0" stopColor="#c4fff5" />
        <stop offset=".5" stopColor="#29cfc0" />
        <stop offset="1" stopColor="#0f8584" />
      </radialGradient>
      <radialGradient id={`${u}face`} cx=".4" cy=".35" r=".75">
        <stop offset="0" stopColor="#fff7ec" />
        <stop offset="1" stopColor="#ffd6b0" />
      </radialGradient>
      <linearGradient id={`${u}tix`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ff86cc" />
        <stop offset=".55" stopColor="#ff5c93" />
        <stop offset="1" stopColor="#ff9a3d" />
      </linearGradient>
      <linearGradient id={`${u}band`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff2a8" />
        <stop offset="1" stopColor="#f0a91f" />
      </linearGradient>
    </defs>
  )
}

/** the glossy arc on a ball's top left */
const Gloss = () => <path d="M20 38 A32 32 0 0 1 40 16" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".55" />

/** a five-point star of outer radius r round (x, y) */
export function starPath(x: number, y: number, r: number, inner = 0.45) {
  return (
    Array.from({ length: 10 }, (_, i) => {
      const a = (i * Math.PI) / 5 - Math.PI / 2
      const k = i % 2 ? r * inner : r
      return `${i ? 'L' : 'M'}${(x + Math.cos(a) * k).toFixed(2)} ${(y + Math.sin(a) * k).toFixed(2)}`
    }).join(' ') + 'Z'
  )
}

/** a four-point twinkle */
export function twinklePath(x: number, y: number, r: number) {
  const q = r * 0.2
  return `M${x} ${y - r} Q${x + q} ${y - q} ${x + r} ${y} Q${x + q} ${y + q} ${x} ${y + r} Q${x - q} ${y + q} ${x - r} ${y} Q${x - q} ${y - q} ${x} ${y - r}Z`
}

/** a bingo ball: the column's colour, a white disc with the letter over the number */
export function NumBall({ u, col, n }: { u: string; col: number; n: number }) {
  const c = COL[col]
  return (
    <g>
      <circle cx="50" cy="50" r="45" fill={`url(#${u}b${col})`} stroke={INK} strokeWidth="4.5" />
      <circle cx="50" cy="50" r="29" fill={`url(#${u}disc)`} stroke={INK} strokeOpacity=".22" strokeWidth="1.5" />
      <text x="50" y="40.5" textAnchor="middle" fontSize="10.5" fontWeight="900" fill={c.dark} fontFamily={FONT}>
        {c.letter}
      </text>
      <text x="50" y="66" textAnchor="middle" fontSize={n >= 10 ? 27 : 29} fontWeight="900" fill={INK} fontFamily={FONT} letterSpacing="-1">
        {n}
      </text>
      <Gloss />
    </g>
  )
}

/** the jester's three-pointed hat over a band (in a 100 × 100 frame); `gold` for the Super Joker */
function JesterHat({ u, gold }: { u: string; gold: boolean }) {
  const pts = gold ? ['#ffb020', '#fff3b0', '#ff8a1e'] : ['#ff4d6a', '#ffd23d', '#25c46c']
  return (
    <g stroke={INK} strokeWidth="3" strokeLinejoin="round">
      <path d="M34 51 C27 45 19 37 15 24 C26 26 37 34 45 46 Z" fill={pts[0]} />
      <path d="M66 51 C73 45 81 37 85 24 C74 26 63 34 55 46 Z" fill={pts[2]} />
      <path d="M38 48 C40 33 45 21 50 9 C55 21 60 33 62 48 Z" fill={pts[1]} />
      <circle cx="15" cy="23" r="5.4" fill={`url(#${u}band)`} />
      <circle cx="85" cy="23" r="5.4" fill={`url(#${u}band)`} />
      {gold ? <path d={starPath(50, 9, 8.5)} fill="#fff" /> : <circle cx="50" cy="9" r="5.4" fill={`url(#${u}band)`} />}
    </g>
  )
}

/** the grinning jester (Joker), or the golden one (Super Joker) */
export function JesterBall({ u, gold = false }: { u: string; gold?: boolean }) {
  return (
    <g>
      <circle cx="50" cy="50" r="45" fill={`url(#${u}${gold ? 'gold' : 'jok'})`} stroke={INK} strokeWidth="4.5" />
      {gold && (
        <g fill="#fff" opacity=".5">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <path key={a} d="M50 50 L46 10 L54 10 Z" transform={`rotate(${a + 22} 50 50)`} />
          ))}
        </g>
      )}
      <Gloss />
      <JesterHat u={u} gold={gold} />
      {/* the ruff, then the face, then the hat's band over his brow */}
      <g stroke={INK} strokeWidth="2.4">
        {[36, 43, 50, 57, 64].map((x, i) => (
          <circle key={x} cx={x} cy={i % 2 ? 85 : 83} r="5" fill={i % 2 ? (gold ? '#ff8a1e' : '#ff4d6a') : GOLD} />
        ))}
      </g>
      <circle cx="50" cy="65" r="16.5" fill={`url(#${u}face)`} stroke={INK} strokeWidth="3" />
      <path d="M31 53 Q50 43 69 53 L67.5 59.5 Q50 51 32.5 59.5 Z" fill={`url(#${u}band)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round" />
      {gold ? <path d={starPath(50, 52.5, 4.2)} fill="#ff6a3d" /> : <path d="M50 48.5 l3 3.6 -3 3.6 -3 -3.6Z" fill="#ff4d6a" stroke={INK} strokeWidth="1.2" />}
      <g fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round">
        <path d="M41.5 64 q3 -3.6 6 0" />
        <path d="M52.5 64 q3 -3.6 6 0" />
      </g>
      <circle cx="40" cy="69.5" r="3" fill="#ff8fa6" opacity=".85" />
      <circle cx="60" cy="69.5" r="3" fill="#ff8fa6" opacity=".85" />
      <path d="M43.5 70 Q50 79.5 56.5 70 Q50 72.5 43.5 70Z" fill="#8a1f3e" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <circle cx="50" cy="67.6" r="2.5" fill="#ff4d6a" />
    </g>
  )
}

/** the Free Spin: a ticket across a teal ball */
function TicketBall({ u }: { u: string }) {
  return (
    <g>
      <circle cx="50" cy="50" r="45" fill={`url(#${u}teal)`} stroke={INK} strokeWidth="4.5" />
      <Gloss />
      <g transform="rotate(-14 50 50)">
        <path
          d="M15 33 H85 a5 5 0 0 0 5 5 V45 a5 5 0 0 0 0 10 V62 a5 5 0 0 0 -5 5 H15 a5 5 0 0 0 -5 -5 V55 a5 5 0 0 0 0 -10 V38 a5 5 0 0 0 5 -5 Z"
          fill={`url(#${u}tix)`}
          stroke={INK}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <path d="M25 37 V63" stroke="#fff" strokeWidth="2" strokeDasharray="3 3" opacity=".8" />
        <path d={starPath(17.5, 50, 4.5)} fill="#fff" />
        <text x="57" y="53.5" textAnchor="middle" fontSize="18" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="3.4" paintOrder="stroke" fontFamily={FONT} letterSpacing="-.5">
          FREE
        </text>
        <text x="57" y="63" textAnchor="middle" fontSize="8" fontWeight="900" fill="#fff" fontFamily={FONT} letterSpacing="1.5">
          SPIN
        </text>
        <path d="M18 37 H80" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".45" />
      </g>
    </g>
  )
}

/** the ball for a reel symbol */
function SymArt({ u, s, col }: { u: string; s: ReelSym; col: number }) {
  if (s.kind === 'num') return <NumBall u={u} col={col} n={s.n} />
  if (s.kind === 'joker') return <JesterBall u={u} />
  if (s.kind === 'super') return <JesterBall u={u} gold />
  return <TicketBall u={u} />
}

/** a symbol on its own little svg, `size` px square */
export function Sym({ u, s, col, size, className = '' }: { u: string; s: ReelSym; col: number; size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden style={{ overflow: 'visible' }}>
      <SymArt u={u} s={s} col={col} />
    </svg>
  )
}

/** a header letter: the column's ball with its letter in white */
export function LetterBall({ u, col }: { u: string; col: number }) {
  return (
    <g>
      <circle cx="50" cy="50" r="45" fill={`url(#${u}b${col})`} stroke={INK} strokeWidth="5" />
      <text x="50" y="68" textAnchor="middle" fontSize="52" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="7" paintOrder="stroke" fontFamily={FONT}>
        {COL[col].letter}
      </text>
      <Gloss />
    </g>
  )
}

/** a small jester's hat (24 × 24): the badge on a number a joker marked */
export function HatBadge({ u }: { u: string }) {
  return (
    <g stroke={INK} strokeWidth="1.6" strokeLinejoin="round">
      <path d="M7 16 C5 13 3 10 2 6 C5 7 8 9 10 13 Z" fill="#ff4d6a" />
      <path d="M17 16 C19 13 21 10 22 6 C19 7 16 9 14 13 Z" fill="#25c46c" />
      <path d="M8.5 15 C9 10 10.5 6 12 2.5 C13.5 6 15 10 15.5 15 Z" fill={GOLD} />
      <circle cx="2.2" cy="5.8" r="1.8" fill={`url(#${u}band)`} />
      <circle cx="21.8" cy="5.8" r="1.8" fill={`url(#${u}band)`} />
      <circle cx="12" cy="2.6" r="1.8" fill={`url(#${u}band)`} />
      <path d="M5.5 16.5 Q12 13.5 18.5 16.5 L18 19.5 Q12 16.8 6 19.5 Z" fill={`url(#${u}band)`} />
    </g>
  )
}

/* ---------------- daubs ---------------- */

/** a small seeded generator, so a cell's splat keeps its shape from render to render */
function seeded(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 10000) / 10000
  }
}

/** a wobbly round splat of radius ~r round (cx, cy): smooth curves through jittered points */
export function blobPath(seed: number, cx: number, cy: number, r: number, wobble = 0.07, n = 9) {
  const rnd = seeded(seed)
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3
    const k = r * (1 - wobble + rnd() * wobble * 2)
    return [cx + Math.cos(a) * k, cy + Math.sin(a) * k] as const
  })
  const mid = (i: number) => {
    const p = pts[i % n]
    const q = pts[(i + 1) % n]
    return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] as const
  }
  const m0 = mid(0)
  let d = `M${m0[0].toFixed(1)} ${m0[1].toFixed(1)}`
  for (let i = 1; i <= n; i++) {
    const p = pts[i % n]
    const m = mid(i)
    d += ` Q${p[0].toFixed(1)} ${p[1].toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)}`
  }
  return d + 'Z'
}

/** the droplets thrown off round a splat: [x, y, r] in a 100 × 100 cell */
export function droplets(seed: number): [number, number, number][] {
  const rnd = seeded(seed + 77)
  return Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2 + rnd() * 1.2
    const d = 43 + rnd() * 6
    return [50 + Math.cos(a) * d, 50 + Math.sin(a) * d, 2.4 + rnd() * 2.6]
  })
}

/** the prefix the game's own <ArtDefs> uses (one game screen is open at a time; the cover uses its own) */
export const GAME_U = 'lla_'
