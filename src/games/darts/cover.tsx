import type { SVGProps } from 'react'
import { useUid } from '../../art/ids'

/*
  Bullseye's lobby cover and navigation icon. The cover, in the lobby's cartoon style (ink outlines, bold
  gradients): a pub-red room with a burst of light behind a big regulation board in its ring light, three darts
  fanned in the treble 20 (the 180) with the house-red flights, and the gold "180!" plaque the caller shouts. The
  board keeps the real proportions and colours (the 20's beds red, black and cream singles), its rings a touch bolder
  so they read at tile size. Plain SVG, part of the main bundle. The icon is a 24 × 24 stroke drawing like the other
  nav icons: a board with a dart in it.
*/

const INK = '#1a0710'
const FONT = 'Manrope, system-ui, sans-serif'
const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5]
const SINGLE = ['#1e1c20', '#f1e2bd']
const BED = ['#e02a40', '#12a058']

export function DartsCover() {
  const u = useUid() + 'bx'
  const cx = 100
  const cy = 140
  const pt = (r: number, a: number) => [cx + r * Math.sin((a * Math.PI) / 180), cy - r * Math.cos((a * Math.PI) / 180)] as const
  const f = (n: number) => n.toFixed(2)
  const sector = (r0: number, r1: number, a0: number, a1: number) => {
    const [x0, y0] = pt(r1, a0)
    const [x1, y1] = pt(r1, a1)
    const [x2, y2] = pt(r0, a1)
    const [x3, y3] = pt(r0, a0)
    return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`
  }
  // the board's radii, scaled from the regulation board and the rings made a touch bolder
  const R = { edge: 80, dOut: 62, dIn: 55, tOut: 40.5, tIn: 34, outer: 7.2, bull: 3.2 }
  // the three darts in the treble 20: their tips and their own slight angles
  const darts = [
    { a: -5.5, r: 37.2, tilt: -22 },
    { a: 5, r: 36.8, tilt: 14 },
    { a: 0, r: 38, tilt: -4 },
  ]
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor="#ff5468" />
          <stop offset=".45" stopColor="#b3173a" />
          <stop offset="1" stopColor="#3a0717" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx=".5" cy=".5" r=".5">
          <stop offset=".55" stopColor="#fff4d6" stopOpacity="0" />
          <stop offset=".8" stopColor="#fff4d6" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff4d6" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#c98d14" />
        </linearGradient>
        <linearGradient id={`${u}tung`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#3a3e46" />
          <stop offset=".35" stopColor="#e6ebf0" />
          <stop offset="1" stopColor="#2d3036" />
        </linearGradient>
        <linearGradient id={`${u}flight`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a98" />
          <stop offset="1" stopColor="#d0122f" />
        </linearGradient>
        <radialGradient id={`${u}lamp`} cx=".5" cy=".2" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".22" />
          <stop offset="1" stopColor="#000" stopOpacity=".3" />
        </radialGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      {/* the burst of light behind the board */}
      <g opacity=".16">
        {Array.from({ length: 12 }, (_, i) => {
          const [x0, y0] = pt(260, i * 30 - 6)
          const [x1, y1] = pt(260, i * 30 + 6)
          return <path key={i} d={`M${cx} ${cy}L${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}Z`} fill="#fff4d6" />
        })}
      </g>
      {/* sparkles */}
      {[
        [26, 40, 3],
        [22, 74, 2.5],
        [18, 214, 2.2],
        [184, 220, 3],
        [62, 18, 2],
      ].map(([x, y, r], i) => (
        <path key={i} d={`M${x} ${y - r * 2}L${x + r * 0.5} ${y - r * 0.5}L${x + r * 2} ${y}L${x + r * 0.5} ${y + r * 0.5}L${x} ${y + r * 2}L${x - r * 0.5} ${y + r * 0.5}L${x - r * 2} ${y}L${x - r * 0.5} ${y - r * 0.5}Z`} fill="#fff4d6" />
      ))}
      {/* the ring light and the board */}
      <circle cx={cx} cy={cy} r="108" fill={`url(#${u}glow)`} />
      <circle cx={cx} cy={cy + 5} r="93" fill="#000" opacity=".38" />
      <circle cx={cx} cy={cy} r="90" fill="#f6f8ff" stroke={INK} strokeWidth="3" />
      <circle cx={cx} cy={cy} r="85" fill="#17161a" stroke={INK} strokeWidth="2.5" />
      <circle cx={cx} cy={cy} r={R.edge} fill="#121114" />
      {NUMBERS.map((n, i) => {
        const a0 = i * 18 - 9
        return (
          <g key={n}>
            <path d={sector(R.dIn, R.dOut, a0, a0 + 18)} fill={BED[i % 2]} />
            <path d={sector(R.tOut, R.dIn, a0, a0 + 18)} fill={SINGLE[i % 2]} />
            <path d={sector(R.tIn, R.tOut, a0, a0 + 18)} fill={BED[i % 2]} />
            <path d={sector(R.outer, R.tIn, a0, a0 + 18)} fill={SINGLE[i % 2]} />
          </g>
        )
      })}
      <circle cx={cx} cy={cy} r={R.outer} fill={BED[1]} stroke={INK} strokeWidth="1.2" />
      <circle cx={cx} cy={cy} r={R.bull} fill={BED[0]} stroke={INK} strokeWidth="1" />
      {/* the wire, in ink */}
      <g fill="none" stroke={INK} strokeWidth="1.1" opacity=".85">
        {[R.tIn, R.tOut, R.dIn, R.dOut].map((r) => (
          <circle key={r} cx={cx} cy={cy} r={r} />
        ))}
        {NUMBERS.map((_, i) => {
          const [x0, y0] = pt(R.outer, i * 18 + 9)
          const [x1, y1] = pt(R.dOut, i * 18 + 9)
          return <path key={i} d={`M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`} />
        })}
      </g>
      <circle cx={cx} cy={cy} r={R.edge} fill={`url(#${u}lamp)`} />
      {NUMBERS.map((n, i) => {
        const [x, y] = pt(71, i * 18)
        return (
          <text key={n} x={f(x)} y={f(y)} textAnchor="middle" dominantBaseline="central" fontSize="9.5" fontWeight="800" fill="#f4efe4" fontFamily={FONT}>
            {n}
          </text>
        )
      })}
      {/* three darts in the treble 20 */}
      {darts.map((d, i) => {
        const [x, y] = pt(d.r, d.a)
        return (
          <g key={i} transform={`translate(${f(x)} ${f(y)}) rotate(${-26 + d.tilt}) scale(1.3)`}>
            <path d="M0 0 L3.4 9 V27 L0 33 L-12.5 45.5 C-13.4 49.5 -12.2 54 -9.5 57.2 L0 52.4 L9.5 57.2 C12.2 54 13.4 49.5 12.5 45.5 L0 33 L-3.4 27 V9Z" fill="#000" opacity=".3" transform="translate(3 4.5)" />
            <path d="M-.4 0 L.4 0 L1.1 9 H-1.1Z" fill="#dfe5ea" stroke={INK} strokeWidth=".8" strokeLinejoin="round" />
            <path d="M-1.3 8.6 C-3 10 -3.4 11.6 -3.4 13.2 V24 C-3.4 25.6 -2.6 26.6 -1.8 27.2 H1.8 C2.6 26.6 3.4 25.6 3.4 24 V13.2 C3.4 11.6 3 10 1.3 8.6Z" fill={`url(#${u}tung)`} stroke={INK} strokeWidth="1.1" />
            <path d="M-3.2 15 H3.2 M-3.2 18 H3.2 M-3.2 21 H3.2" stroke={INK} strokeWidth=".7" />
            <rect x="-1.3" y="27" width="2.6" height="11" rx="1" fill="#26292f" stroke={INK} strokeWidth=".9" />
            <path d="M0 33 L-12.5 45.5 C-13.4 49.5 -12.2 54 -9.5 57.2 L0 52.4Z" fill={`url(#${u}flight)`} stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M0 33 L12.5 45.5 C13.4 49.5 12.2 54 9.5 57.2 L0 52.4Z" fill="#a50d26" stroke={INK} strokeWidth="1.2" strokeLinejoin="round" />
            <path d="M-3.4 41 L-8.6 46.4 M3.4 41 L8.6 46.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        )
      })}
      {/* the caller's plaque */}
      <g transform="rotate(9 148 36)">
        <rect x="113" y="16" width="70" height="38" rx="11" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="3" />
        <rect x="118" y="20" width="60" height="9" rx="4.5" fill="#fff" opacity=".35" />
        <text x="148" y="36.5" textAnchor="middle" dominantBaseline="central" fontSize="26" fontWeight="900" fontStyle="italic" fill="#3a2400" fontFamily={FONT} letterSpacing="-.5">
          180!
        </text>
      </g>
    </svg>
  )
}

export function DartsIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      <circle cx="10.5" cy="13.5" r="8" />
      <circle cx="10.5" cy="13.5" r="4" />
      <circle cx="10.5" cy="13.5" r="1" fill="currentColor" />
      <path d="M10.5 13.5 19.5 4.5" />
      <path d="M17.6 2.6v3.8h3.8" />
    </svg>
  )
}
