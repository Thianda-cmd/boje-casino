import type { ReactNode, SVGProps } from 'react'
import { useUid } from '../../art/ids'
import { CardFace } from '../../art/Card'

/*
  Hold'em Showdown's lobby cover and navigation icon. The cover is the game's identity in the lobby's cartoon style
  (ink outlines, bold gradients) and tells a hand at a glance: the deep midnight felt under the table lamp, the five
  board cards face up along the far side with the gold tabs of the best five under three of them, a pair of aces
  fanned in front (aces full of nines), the gold print of the layout (the rail, the Ante, Blind and Play circles in
  perspective) with chips stacked on the Play, and the golden "4×" plaque of the big pre-flop raise. Midnight and gold keep it apart from Blackjack's bright blue. Plain SVG (the house cards are SVG too): it is
  part of the main bundle. The icon is a 24 × 24 stroke drawing like the other nav icons: two fanned cards, a spade
  on the front one.
*/

const INK = '#081233'
const GOLD = '#f7c548'
const FONT = 'Manrope, system-ui, sans-serif'

/** a playing card with the lobby's ink outline, `w` wide, centred on (cx, cy), turned by `rot` */
function InkCard({ cx, cy, w, rot = 0, stroke = 2.4, children }: { cx: number; cy: number; w: number; rot?: number; stroke?: number; children: (x: number, y: number, w: number, h: number) => ReactNode }) {
  const h = w * 1.4
  const x = cx - w / 2
  const y = cy - h / 2
  const rx = w * 0.09
  return (
    <g transform={rot ? `rotate(${rot} ${cx} ${cy})` : undefined}>
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="#000" opacity=".35" transform={`translate(${w * 0.04} ${w * 0.09})`} />
      {children(x, y, w, h)}
      <rect x={x} y={y} width={w} height={h} rx={rx} fill="none" stroke={INK} strokeWidth={stroke} />
    </g>
  )
}

/** a stack of chips standing on the felt in perspective, bottom chip first */
function ChipStack({ x, y, r, colors }: { x: number; y: number; r: number; colors: string[] }) {
  const ry = r * 0.42
  const h = r * 0.3
  return (
    <g>
      <ellipse cx={x} cy={y + h * 0.6} rx={r * 1.1} ry={ry * 1.15} fill="#020818" opacity=".5" />
      {colors.map((c, i) => {
        const cy = y - i * h
        return (
          <g key={i}>
            <path d={`M${x - r} ${cy} v${-h} a${r} ${ry} 0 0 0 ${2 * r} 0 v${h} a${r} ${ry} 0 0 1 ${-2 * r} 0Z`} fill={c} stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
            {/* the edge inserts */}
            {[-0.62, 0, 0.62].map((k) => (
              <rect key={k} x={x + k * r - r * 0.1} y={cy - h + ry * Math.sqrt(1 - k * k) - 0.2} width={r * 0.2} height={h * 0.82} fill="#fff" opacity=".85" />
            ))}
            {i === colors.length - 1 && (
              <>
                <ellipse cx={x} cy={cy - h} rx={r} ry={ry} fill={c} stroke={INK} strokeWidth="1.5" />
                <ellipse cx={x} cy={cy - h} rx={r * 0.66} ry={ry * 0.66} fill="none" stroke="#fff" strokeOpacity=".8" strokeWidth="1" strokeDasharray="2.4 2" />
                <ellipse cx={x - r * 0.3} cy={cy - h - ry * 0.3} rx={r * 0.32} ry={ry * 0.22} fill="#fff" opacity=".3" />
              </>
            )}
          </g>
        )
      })}
    </g>
  )
}

/** the board: aces full of nines with the player's pair, so the ace and both nines carry the gold tab */
const BOARD: { rank: string; suit: '♠' | '♥' | '♦' | '♣'; best: boolean }[] = [
  { rank: 'A', suit: '♦', best: true },
  { rank: '9', suit: '♥', best: true },
  { rank: 'K', suit: '♠', best: false },
  { rank: '9', suit: '♣', best: true },
  { rank: '4', suit: '♠', best: false },
]

export function HoldemCover() {
  const u = useUid() + 'he'
  const bw = 31
  const bgap = 4
  const b0 = 100 - (5 * bw + 4 * bgap) / 2 + bw / 2
  // the circles printed on the felt in perspective, and what stands in them
  const circles = [
    { cx: 38, label: 'ANTE' },
    { cx: 100, label: 'BLIND' },
    { cx: 162, label: 'PLAY' },
  ]
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".5" y2="1">
          <stop offset="0" stopColor="#1c3a8a" />
          <stop offset=".42" stopColor="#0c1f58" />
          <stop offset="1" stopColor="#030920" />
        </linearGradient>
        <radialGradient id={`${u}lamp`} cx=".5" cy=".46" r=".55">
          <stop offset="0" stopColor="#7fa6ff" stopOpacity=".4" />
          <stop offset=".6" stopColor="#3f6ce0" stopOpacity=".1" />
          <stop offset="1" stopColor="#3f6ce0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}gold`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b8" />
          <stop offset=".5" stopColor="#f7c548" />
          <stop offset="1" stopColor="#e09a1f" />
        </linearGradient>
        <radialGradient id={`${u}spot`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff2c0" stopOpacity=".7" />
          <stop offset=".45" stopColor="#ffd45c" stopOpacity=".22" />
          <stop offset="1" stopColor="#ffd45c" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <circle cx="178" cy="14" r="70" fill="#fff" opacity=".045" />
      {/* the lamp over the table */}
      <path d="M70 -10 L130 -10 L210 236 L-10 236 Z" fill="#cfe0ff" opacity=".05" />
      <ellipse cx="100" cy="122" rx="122" ry="120" fill={`url(#${u}lamp)`} />

      {/* the far side of the table: the board, face up, the best five tabbed in gold, the rest settled into the felt */}
      {BOARD.map((c, i) => {
        const cx = b0 + i * (bw + bgap)
        return (
          <g key={i}>
            <InkCard cx={cx} cy={42} w={bw} stroke={1.7}>
              {(x, y, w, h) => (
                <>
                  <CardFace rank={c.rank} suit={c.suit} x={x} y={y} width={w} height={h} />
                  {!c.best && <rect x={x} y={y} width={w} height={h} rx={w * 0.09} fill="#06102e" opacity=".42" />}
                </>
              )}
            </InkCard>
            {c.best && <rect x={cx - 7.5} y={67.2} width="15" height="3" rx="1.5" fill={GOLD} stroke={INK} strokeWidth=".8" />}
          </g>
        )
      })}

      {/* the layout's gold print: a line arched under the board, the rail round the circles */}
      <path d="M22 92 A200 200 0 0 1 178 92" fill="none" stroke={GOLD} strokeOpacity=".4" strokeWidth="1.2" />
      <path d="M-6 200 A240 240 0 0 1 206 200" fill="none" stroke={GOLD} strokeOpacity=".55" strokeWidth="1.6" />
      <path d="M-6 194 A240 240 0 0 1 206 194" fill="none" stroke={GOLD} strokeOpacity=".22" strokeWidth="1" />

      {/* the Ante, Blind and Play circles, printed in perspective */}
      {circles.map((c) => (
        <g key={c.label}>
          <ellipse cx={c.cx} cy={223} rx="25" ry="9.5" fill="#030a22" opacity=".45" />
          <ellipse cx={c.cx} cy={221.5} rx="25" ry="9.5" fill="none" stroke={GOLD} strokeWidth="1.7" strokeOpacity=".9" />
          <ellipse cx={c.cx} cy={221.5} rx="20.5" ry="7.4" fill="none" stroke={GOLD} strokeWidth=".8" strokeOpacity=".4" />
          <text x={c.cx} y={242.5} textAnchor="middle" fontSize="7.2" fontWeight="900" letterSpacing="1.8" fill={GOLD} fillOpacity=".85" fontFamily={FONT}>
            {c.label}
          </text>
        </g>
      ))}
      <text x="69" y="224.5" textAnchor="middle" fontSize="10" fontWeight="900" fill={GOLD} fillOpacity=".8" fontFamily={FONT}>
        =
      </text>
      <ChipStack x={38} y={223} r={13} colors={['#2f7cf6', '#2f7cf6']} />
      <ChipStack x={100} y={223} r={13} colors={['#1fb866', '#2f7cf6']} />
      <ChipStack x={162} y={223} r={13} colors={['#7c4dff', '#7c4dff', '#f59e0b', '#f59e0b', '#f59e0b']} />

      {/* the pair of aces, fanned: the house ace of spades behind the ace of hearts */}
      <circle cx="100" cy="140" r="60" fill={`url(#${u}spot)`} />
      <InkCard cx={83} cy={142} w={70} rot={-12}>
        {(x, y, w, h) => <CardFace rank="A" suit="♠" x={x} y={y} width={w} height={h} />}
      </InkCard>
      <InkCard cx={119} cy={146} w={70} rot={10}>
        {(x, y, w, h) => <CardFace rank="A" suit="♥" x={x} y={y} width={w} height={h} />}
      </InkCard>

      {/* the big raise */}
      <g transform="rotate(10 160 100)" style={{ filter: 'drop-shadow(0 5px 6px rgba(2,6,26,.6))' }}>
        <rect x="133" y="84" width="54" height="32" rx="16" fill={`url(#${u}gold)`} stroke={INK} strokeWidth="2.6" />
        <rect x="140" y="87.5" width="40" height="8.5" rx="4.25" fill="#fff" opacity=".4" />
        <text x="160" y="108" textAnchor="middle" fontSize="22" fontWeight="900" fill="#2a1600" fontFamily={FONT}>
          4×
        </text>
      </g>

      {/* sparkles */}
      {[
        [26, 112, 4.6],
        [178, 142, 3.4],
        [40, 182, 3],
        [150, 72, 2.4],
      ].map(([x, y, r], i) => {
        const k = r * 0.22
        return <path key={i} d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`} fill="#fff6d0" />
      })}
    </svg>
  )
}

export function HoldemIcon(p: SVGProps<SVGSVGElement>) {
  return (
    <svg {...p}>
      {/* the card behind: only its edge left of the front card shows */}
      <path d="M9.3 5.6 5.4 6.5a1.9 1.9 0 0 0-1.4 2.3l2.6 10.6a1.9 1.9 0 0 0 2.3 1.4l2.4-.6" />
      {/* the front card, tipped the other way, with a spade */}
      <g transform="rotate(9 14.9 10.8)">
        <rect x="9.6" y="3.4" width="10.6" height="14.8" rx="2" />
        <path d="M14.9 7.1c-.9 1.4-2.8 2.4-2.8 4 0 1 .8 1.6 1.6 1.6.5 0 1-.2 1.2-.6-.1.8-.4 1.3-.9 1.8h2c-.5-.5-.8-1-.9-1.8.3.4.7.6 1.2.6.8 0 1.6-.6 1.6-1.6 0-1.6-1.9-2.6-2.8-4Z" fill="currentColor" stroke="none" />
      </g>
    </svg>
  )
}
