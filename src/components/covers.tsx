import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Sprite } from '../lib/pixel'
import { Px } from './pixelui'
import { asphalt, bush, chicken, curb, flower, grass, vehicle } from '../games/chicken/sprites'
import type { GameId } from '../store/games'
import { useUid } from '../art/ids'
import { CardBack, CardFace } from '../art/Card'
import { Chip } from '../art/Chip'
import { Gem } from '../art/Gem'
import { Bomb } from '../art/Bomb'
import { Rocket } from '../art/Rocket'
import { RouletteWheel } from '../art/RouletteWheel'
import { PrizeWheel } from '../art/PrizeWheel'
import { wheelSegments } from '../games/wheel/rules'

/* Lobby art. Chicken Road keeps its pixel look; everything else is clean vector art on a bold gradient. */

const tiled = (s: Sprite, scale: number, extra?: CSSProperties): CSSProperties => ({
  backgroundImage: `url(${s.url})`,
  backgroundSize: `${s.w * scale}px ${s.h * scale}px`,
  imageRendering: 'pixelated',
  ...extra,
})

export function GameCover({ id }: { id: GameId }) {
  switch (id) {
    case 'chicken':
      return <ChickenCover />
    case 'crash':
      return <CrashCover />
    case 'mines':
      return <MinesCover />
    case 'plinko':
      return <PlinkoCover />
    case 'dice':
      return <DiceCover />
    case 'limbo':
      return <LimboCover />
    case 'keno':
      return <KenoCover />
    case 'hilo':
      return <HiloCover />
    case 'wheel':
      return <WheelCover />
    case 'blackjack':
      return <BlackjackCover />
    case 'roulette':
      return <RouletteCover />
    case 'slots':
      return <SlotsCover />
    case 'chompers':
      return <ChompersCover />
    case 'videopoker':
      return <VideoPokerCover />
  }
}

function ChickenCover() {
      return (
        <div className="absolute inset-0 overflow-hidden" style={tiled(grass(), 4)}>
          <div className="absolute inset-y-0 left-[46%] right-0" style={tiled(asphalt(), 4)}>
            <div className="absolute inset-y-0 left-0 w-4" style={tiled(curb(), 4)} />
            <div className="absolute inset-y-0 left-[54%] w-1" style={{ backgroundImage: 'linear-gradient(#e8edf3 50%, transparent 50%)', backgroundSize: '4px 40px' }} />
          </div>
          <Px s={vehicle('sedan', '#4cb4ff')} scale={4} className="absolute left-[62%] top-[-12%]" style={{ filter: 'drop-shadow(0 8px 0 rgba(0,0,0,.3))' }} />
          <Px s={bush()} scale={4} className="absolute left-[4%] top-[8%]" />
          <Px s={flower('#ff8fc7')} scale={4} className="absolute left-[30%] top-[22%]" />
          <Px s={flower('#ffe36b')} scale={4} className="absolute left-[10%] top-[44%]" />
          <div className="absolute left-[18%] top-[32%]">
            <Px s={chicken.idle()} scale={4} className="px-bob" style={{ filter: 'drop-shadow(0 4px 0 rgba(0,0,0,.25))' }} />
          </div>
        </div>
      )
}

/** A 200×250 vector scene on a diagonal gradient with a soft top light. */
function Scene({ from, to, children }: { from: string; to: string; children: ReactNode }) {
  const u = useUid()
  return (
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 200 250" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <linearGradient id={`${u}bg`} x1="0" y1="0" x2=".7" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
        <radialGradient id={`${u}gl`} cx=".5" cy=".28" r=".62">
          <stop offset="0" stopColor="#fff" stopOpacity=".3" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="200" height="250" fill={`url(#${u}bg)`} />
      <rect width="200" height="250" fill={`url(#${u}gl)`} />
      <circle cx="178" cy="18" r="70" fill="#fff" opacity=".05" />
      <circle cx="10" cy="230" r="90" fill="#000" opacity=".08" />
      {children}
    </svg>
  )
}

const STARS = [
  [18, 22], [44, 60], [70, 18], [120, 30], [150, 12], [176, 48], [30, 110], [92, 84], [134, 96], [186, 120], [60, 140], [14, 170], [110, 128], [160, 160],
] as const

function CrashCover() {
  const u = useUid()
  const pts: string[] = []
  for (let x = 0; x <= 146; x += 3) pts.push(`${14 + x},${(196 - (Math.exp(x / 48) - 1) * 6.33).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  return (
    <Scene from="#7b5cff" to="#1d1550">
      <defs>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#a58bff" />
          <stop offset="1" stopColor="#ff6fae" />
        </linearGradient>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff6fae" stopOpacity=".45" />
          <stop offset="1" stopColor="#ff6fae" stopOpacity="0" />
        </linearGradient>
        <filter id={`${u}b`}>
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      {STARS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i % 3 ? 0.9 : 1.5} fill="#fff" opacity={i % 2 ? 0.5 : 0.9} />
      ))}
      <path d={`${line} L160 196 Z`} fill={`url(#${u}f)`} />
      <path d={line} fill="none" stroke="#ff6fae" strokeWidth="7" opacity=".55" filter={`url(#${u}b)`} />
      <path d={line} fill="none" stroke={`url(#${u}s)`} strokeWidth="4.5" strokeLinecap="round" />
      <g transform="translate(160 70) rotate(-60)">
        <Rocket width={70} x={-70 * 0.29} y={-70 * 0.2} flicker={false} />
      </g>
    </Scene>
  )
}

function MinesCover() {
  const layout = ['', 'g', '', 'g', 'm', '', '', 'g', 'g']
  return (
    <Scene from="#2ee59d" to="#0a4a33">
      <g transform="rotate(-8 100 100)">
        <rect x="31" y="31" width="138" height="138" rx="14" fill="rgba(4,30,22,.35)" />
        {layout.map((k, i) => {
          const x = 37 + (i % 3) * 44
          const y = 37 + Math.floor(i / 3) * 44
          return (
            <g key={i}>
              {k ? (
                <rect x={x} y={y} width="38" height="38" rx="7" fill="#0b1d2a" />
              ) : (
                <>
                  <rect x={x} y={y + 4} width="38" height="38" rx="7" fill="#15303f" />
                  <rect x={x} y={y} width="38" height="38" rx="7" fill="#2f5068" />
                  <rect x={x + 4} y={y + 2} width="30" height="2" rx="1" fill="#fff" opacity=".12" />
                </>
              )}
              {k === 'g' && <Gem size={30} x={x + 4} y={y + 4} />}
              {k === 'm' && <Bomb size={32} x={x + 3} y={y + 3} flicker={false} />}
            </g>
          )
        })}
      </g>
    </Scene>
  )
}

function bucketFill(k: number, n: number) {
  const t = Math.abs(k - (n - 1) / 2) / ((n - 1) / 2)
  return t > 0.75 ? '#ff3d5a' : t > 0.45 ? '#ff7a45' : t > 0.2 ? '#ffb340' : '#ffd64d'
}

function PlinkoCover() {
  const u = useUid()
  const rows = 7
  return (
    <Scene from="#ff5fa2" to="#4e1aa6">
      <defs>
        <radialGradient id={`${u}b`} cx=".35" cy=".3">
          <stop offset="0" stopColor="#fff0f7" />
          <stop offset=".4" stopColor="#ff7ab5" />
          <stop offset="1" stopColor="#c4185c" />
        </radialGradient>
      </defs>
      {Array.from({ length: rows }, (_, r) =>
        Array.from({ length: r + 3 }, (_, c) => <circle key={`${r}-${c}`} cx={100 + (c - (r + 2) / 2) * 20} cy={26 + r * 20} r="3.3" fill="#fff" opacity=".95" />),
      )}
      {Array.from({ length: rows + 1 }, (_, k) => (
        <g key={k}>
          <rect x={100 + (k - rows / 2) * 20 - 8.5} y="162" width="17" height="13" rx="3" fill="rgba(0,0,0,.3)" />
          <rect x={100 + (k - rows / 2) * 20 - 8.5} y="159" width="17" height="13" rx="3" fill={bucketFill(k, rows + 1)} />
        </g>
      ))}
      <circle cx="100" cy="14" r="2.6" fill="#fff" opacity=".3" />
      <circle cx="104" cy="38" r="3.2" fill="#fff" opacity=".35" />
      <circle cx="109" cy="62" r="4" fill="#fff" opacity=".4" />
      <circle cx="110" cy="84" r="12" fill="#ff5fa2" opacity=".45" style={{ filter: 'blur(6px)' }} />
      <circle cx="110" cy="84" r="8" fill={`url(#${u}b)`} />
    </Scene>
  )
}

/** An isometric die. Faces list the pips for the top, left and right faces. */
function Die({ cx, cy, s, faces }: { cx: number; cy: number; s: number; faces: [number, number, number] }) {
  const k = 0.866 * s
  const tops: [number, number, number, number, number, number][] = [
    [k, -s / 2, k, s / 2, cx - k, cy - s / 2],
    [k, s / 2, 0, s, cx - k, cy - s / 2],
    [k, -s / 2, 0, s, cx, cy],
  ]
  const shades = ['#ffffff', '#dfe7ef', '#bccad8']
  return (
    <g>
      <ellipse cx={cx + 6} cy={cy + s + 8} rx={k * 1.1} ry={s * 0.28} fill="rgba(0,0,0,.25)" />
      {tops.map((m, i) => (
        <g key={i} transform={`matrix(${m.join(' ')})`}>
          <rect width="1" height="1" rx=".14" fill={shades[i]} />
          {PIPS[faces[i]].map(([x, y], j) => (
            <circle key={j} cx={x} cy={y} r={faces[i] === 1 ? 0.15 : 0.095} fill={faces[i] === 1 ? '#e8344e' : '#1b2a38'} />
          ))}
        </g>
      ))}
    </g>
  )
}
const PIPS: Record<number, [number, number][]> = {
  1: [[0.5, 0.5]],
  2: [[0.27, 0.27], [0.73, 0.73]],
  3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
  4: [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]],
  5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
  6: [[0.27, 0.22], [0.27, 0.5], [0.27, 0.78], [0.73, 0.22], [0.73, 0.5], [0.73, 0.78]],
}

function DiceCover() {
  return (
    <Scene from="#4cb4ff" to="#163aa0">
      <path d="M150 112 L178 98 M146 126 L184 110 M156 138 L176 128" stroke="#fff" strokeOpacity=".35" strokeWidth="3" strokeLinecap="round" />
      <Die cx={84} cy={96} s={46} faces={[5, 3, 1]} />
      <g transform="rotate(16 148 56)">
        <Die cx={148} cy={46} s={26} faces={[2, 4, 6]} />
      </g>
    </Scene>
  )
}

function LimboCover() {
  return (
    <Scene from="#ffbd3d" to="#c93a1a">
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d="M100 104 L96 -40 L104 -40 Z" fill="#fff" opacity=".07" transform={`rotate(${i * 30} 100 104)`} />
      ))}
      {[96, 74, 52, 32].map((r, i) => (
        <circle key={r} cx="100" cy="104" r={r} fill="none" stroke="#fff" strokeOpacity={0.08 + i * 0.08} strokeWidth="2.5" />
      ))}
      <circle cx="100" cy="104" r="24" fill="#fff" opacity=".16" />
      <text x="102" y="120" textAnchor="middle" fontSize="40" fontWeight="900" fill="#7a1d06" opacity=".35" fontFamily="Manrope, system-ui, sans-serif">
        2.00×
      </text>
      <text x="100" y="117" textAnchor="middle" fontSize="40" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif">
        2.00×
      </text>
    </Scene>
  )
}

function KenoCover() {
  const sel = new Set([2, 5, 7, 11, 14])
  const hit = new Set([5, 11])
  const miss = new Set([9, 16])
  return (
    <Scene from="#b07cff" to="#33127f">
      {Array.from({ length: 16 }, (_, i) => {
        const n = i + 1
        const x = 31 + (i % 4) * 36
        const y = 24 + Math.floor(i / 4) * 36
        const isHit = hit.has(n)
        const isSel = sel.has(n)
        return (
          <g key={n}>
            {!isHit && <rect x={x} y={y + 3} width="30" height="30" rx="6" fill="#1d0f4d" />}
            <rect x={x} y={y} width="30" height="30" rx="6" fill={isHit ? '#0e1f2b' : isSel ? '#c39bff' : '#3f2a8c'} />
            {isHit ? (
              <Gem size={24} x={x + 3} y={y + 3} />
            ) : (
              <text
                x={x + 15}
                y={y + 15}
                dy=".35em"
                textAnchor="middle"
                fontSize="12"
                fontWeight="800"
                fill={miss.has(n) ? '#ff6b7c' : isSel ? '#2a0f66' : 'rgba(255,255,255,.7)'}
                fontFamily="Manrope, system-ui, sans-serif"
              >
                {n}
              </text>
            )}
          </g>
        )
      })}
    </Scene>
  )
}

function Badge({ cx, cy, up }: { cx: number; cy: number; up: boolean }) {
  return (
    <g>
      <circle cx={cx} cy={cy + 3} r="19" fill="rgba(0,0,0,.25)" />
      <circle cx={cx} cy={cy} r="19" fill={up ? '#22d36f' : '#ff4d61'} />
      <path d={up ? `M${cx} ${cy - 9}v18M${cx - 7} ${cy - 2}l7-7 7 7` : `M${cx} ${cy + 9}v-18M${cx - 7} ${cy + 2}l7 7 7-7`} stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </g>
  )
}

function HiloCover() {
  return (
    <Scene from="#3be0cd" to="#0a4f5e">
      <g transform="rotate(-14 70 92)">
        <CardBack x={36} y={40} width={70} height={98} />
      </g>
      <g transform="rotate(7 108 94)" style={{ filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
        <CardFace rank="K" suit="♠" x={66} y={36} width={84} height={118} />
      </g>
      <Badge cx={160} cy={46} up />
      <Badge cx={40} cy={158} up={false} />
    </Scene>
  )
}

function WheelCover() {
  return (
    <Scene from="#ff9a4d" to="#9c1430">
      <PrizeWheel segments={wheelSegments(20, 'medium')} size={240} x={-20} y={44} />
      <path d="M100 66 L89 44 H111 Z" fill="#fff" stroke="rgba(0,0,0,.2)" strokeWidth="1.5" strokeLinejoin="round" />
    </Scene>
  )
}

function BlackjackCover() {
  return (
    <Scene from="#4f8bff" to="#14287a">
      <g transform="rotate(-12 77 82)" style={{ filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
        <CardFace rank="A" suit="♠" x={40} y={30} width={74} height={104} />
      </g>
      <g transform="rotate(11 123 86)" style={{ filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
        <CardFace rank="K" suit="♥" x={86} y={34} width={74} height={104} />
      </g>
      <Chip value={500} size={40} x={18} y={146} />
      <Chip value={100} size={40} x={18} y={138} />
      <Chip value={25} size={40} x={18} y={130} />
      <Chip value={10} size={34} x={150} y={140} />
    </Scene>
  )
}

function RouletteCover() {
  const a = (-38 * Math.PI) / 180
  return (
    <Scene from="#ff5a6e" to="#5a0a1c">
      <g style={{ filter: 'drop-shadow(0 10px 14px rgba(0,0,0,.4))' }}>
        <RouletteWheel size={184} x={8} y={10} numbers={false} />
      </g>
      <circle cx={100 + Math.cos(a) * 66} cy={102 + Math.sin(a) * 66} r="5.5" fill="#f4f6f9" />
      <circle cx={98.5 + Math.cos(a) * 66} cy={100.5 + Math.sin(a) * 66} r="2" fill="#fff" />
    </Scene>
  )
}

function SlotsCover() {
  const u = useUid()
  const rows = [
    ['violet', 'gold', 'sky', 'pink'],
    ['green', 'pink', 'violet', 'gold'],
    ['sky', 'violet', 'green', 'sky'],
  ] as const
  return (
    <Scene from="#9b4dff" to="#170736">
      <defs>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="1" stopColor="#e8a10f" />
        </linearGradient>
        <radialGradient id={`${u}o`} cx=".35" cy=".3" r=".75">
          <stop offset="0" stopColor="#ffe7ff" />
          <stop offset=".45" stopColor="#c86bff" />
          <stop offset="1" stopColor="#5a1aa8" />
        </radialGradient>
      </defs>
      <g style={{ filter: 'drop-shadow(0 12px 16px rgba(0,0,0,.45))' }}>
        <rect x="16" y="66" width="168" height="132" rx="16" fill={`url(#${u}f)`} />
        <rect x="21" y="71" width="158" height="122" rx="12" fill="#150a33" />
        {rows.map((row, r) => row.map((t, c) => <Gem key={`${r}${c}`} tone={t} size={36} x={26 + c * 38} y={76 + r * 38} glow={false} />))}
      </g>
      <g transform="translate(30 18) rotate(-14)">
        <Gem tone="pink" size={42} />
      </g>
      <g transform="translate(122 6) rotate(10)">
        <Gem tone="gold" size={34} />
      </g>
      <g transform="translate(152 200)" style={{ filter: 'drop-shadow(0 8px 12px rgba(0,0,0,.45))' }}>
        <circle r="25" fill={`url(#${u}o)`} />
        <circle r="25" fill="none" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" />
        <ellipse cx="-8" cy="-11" rx="8" ry="4.5" fill="#fff" opacity=".55" transform="rotate(-30 -8 -11)" />
        <text y="6" textAnchor="middle" fontSize="17" fontWeight="800" fill="#fff" fontFamily="Manrope, system-ui, sans-serif" stroke="#2a0b5e" strokeWidth="3" paintOrder="stroke">
          50×
        </text>
      </g>
    </Scene>
  )
}

const INK = '#1d0f30'

/** A cartoon donut seen from above: dough ring, icing and sprinkles. */
function CoverDonut({ x, y, r, icing, rot = 0 }: { x: number; y: number; r: number; icing: string; rot?: number }) {
  const h = r * 0.36
  const mid = (r + h) / 2
  const sprinkles = [
    [-40, '#fff'], [10, '#ffe35a'], [62, '#5be3ff'], [118, '#fff'], [165, '#ffe35a'], [215, '#5be3ff'], [262, '#fff'], [310, '#ffe35a'],
  ] as const
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot})`}>
      <circle r={mid} fill="none" stroke="#e39a4b" strokeWidth={r - h} />
      <circle r={mid + (r - h) * 0.3} fill="none" stroke="#c97a32" strokeWidth={(r - h) * 0.22} />
      <circle r={mid - (r - h) * 0.07} fill="none" stroke={icing} strokeWidth={(r - h) * 0.64} />
      <circle r={r} fill="none" stroke={INK} strokeWidth="3" />
      <circle r={h} fill="none" stroke={INK} strokeWidth="3" />
      {sprinkles.map(([a, c], i) => {
        const rad = (a * Math.PI) / 180
        return (
          <rect
            key={i}
            x={-r * 0.1}
            y={-r * 0.035}
            width={r * 0.2}
            height={r * 0.07}
            rx={r * 0.035}
            fill={c}
            transform={`translate(${Math.cos(rad) * mid} ${Math.sin(rad) * mid}) rotate(${a + 60 + i * 23})`}
          />
        )
      })}
      <path d={`M${-mid * 0.7} ${-mid * 0.72} A${mid} ${mid} 0 0 1 ${mid * 0.2} ${-mid * 0.98}`} stroke="#fff" strokeOpacity=".55" strokeWidth={r * 0.08} strokeLinecap="round" fill="none" />
    </g>
  )
}

function ChompersCover() {
  const u = useUid()
  const teeth = [62, 78, 94, 110, 126]
  return (
    <Scene from="#3fe08a" to="#122a5c">
      <defs>
        <radialGradient id={`${u}b`} cx=".36" cy=".26" r=".85">
          <stop offset="0" stopColor="#a6ffb2" />
          <stop offset=".5" stopColor="#35d873" />
          <stop offset="1" stopColor="#0f8a4c" />
        </radialGradient>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2ad" />
          <stop offset="1" stopColor="#f0a514" />
        </linearGradient>
        <radialGradient id={`${u}m`} cx=".5" cy=".2" r=".9">
          <stop offset="0" stopColor="#7a1846" />
          <stop offset="1" stopColor="#2c0620" />
        </radialGradient>
      </defs>
      <CoverDonut x={34} y={86} r={20} icing="#ff8ad0" rot={-18} />
      <CoverDonut x={166} y={46} r={17} icing="#59c8ff" rot={24} />
      <CoverDonut x={176} y={126} r={13} icing="#ffcf3a" rot={-6} />
      <g style={{ filter: 'drop-shadow(0 14px 18px rgba(0,0,0,.4))' }}>
        <g stroke={INK} strokeWidth="4" strokeLinejoin="round">
          <path d="M26 266 C 22 168, 50 100, 100 100 C 150 100, 178 168, 174 266 Z" fill={`url(#${u}b)`} />
          <path d="M70 108 L64 74 L84 92 L100 64 L116 92 L136 74 L130 108 Q100 116 70 108 Z" fill={`url(#${u}c)`} />
          <circle cx="100" cy="96" r="6.5" fill="#2ee87f" strokeWidth="3" />
          <ellipse cx="77" cy="140" rx="15" ry="16" fill="#fff" />
          <ellipse cx="123" cy="140" rx="15" ry="16" fill="#fff" />
          <path d="M50 172 Q100 182 150 172 Q150 238 100 240 Q50 238 50 172 Z" fill={`url(#${u}m)`} />
        </g>
        <circle cx="80" cy="143" r="7.5" fill={INK} />
        <circle cx="120" cy="143" r="7.5" fill={INK} />
        <circle cx="82.5" cy="140" r="2.6" fill="#fff" />
        <circle cx="122.5" cy="140" r="2.6" fill="#fff" />
        <path d="M60 122 Q72 114 88 120" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        <path d="M112 120 Q128 114 140 122" stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none" />
        <ellipse cx="100" cy="228" rx="30" ry="10" fill="#ff6f9a" />
        {teeth.map((x) => (
          <path key={x} d={`M${x} ${174 + (x === 94 ? 2 : 0)} l6 13 l6 -13`} fill="#fff" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
        ))}
        <path d="M44 152 Q36 150 34 160" stroke="#fff" strokeOpacity=".45" strokeWidth="4" strokeLinecap="round" fill="none" />
        <ellipse cx="66" cy="114" rx="7" ry="3.5" fill="#fff" opacity=".55" transform="rotate(-20 66 114)" />
      </g>
      <g transform="translate(100 206)">
        <CoverDonut x={0} y={0} r={15} icing="#ff5b6e" rot={10} />
      </g>
      {[[56, 196, 3], [146, 200, 2.5], [138, 186, 2], [62, 208, 2]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#e39a4b" stroke={INK} strokeWidth="1.5" />
      ))}
    </Scene>
  )
}

function VideoPokerCover() {
  const ranks = ['10', 'J', 'Q', 'K', 'A']
  return (
    <Scene from="#2fb8ff" to="#0b2a6e">
      {ranks.map((r, i) => {
        const a = (i - 2) * 11
        return (
          <g key={r} transform={`rotate(${a} 100 230)`} style={{ filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
            <CardFace rank={r} suit="♠" x={68} y={62} width={64} height={90} />
          </g>
        )
      })}
      <rect x="54" y="176" width="92" height="26" rx="13" fill="#f7c548" />
      <text x="100" y="194" textAnchor="middle" fontSize="13" fontWeight="900" fill="#2a1c00" fontFamily="Manrope, system-ui, sans-serif" letterSpacing="1">
        ROYAL
      </text>
    </Scene>
  )
}

/** One lane's car driving down the banner road, over and over. A Web Animation of transform only, so the browser runs it
 *  on the GPU; a script-driven animation here would repaint the shadowed sprite every frame. */
function Car({ left, dur, delay, rest, children }: { left: string; dur: number; delay: number; rest: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const total = dur + rest
    const a = el.animate(
      [{ transform: 'translateY(-170px)' }, { transform: 'translateY(340px)', offset: dur / total }, { transform: 'translateY(340px)' }],
      { duration: total * 1000, delay: delay * 1000, iterations: Infinity, fill: 'backwards' },
    )
    return () => a.cancel()
  }, [dur, delay, rest])
  return (
    <div ref={ref} className="absolute top-0 will-change-transform" style={{ left, transform: 'translateY(-170px)' }}>
      {children}
    </div>
  )
}

/** The lobby banner's road: three lanes of traffic and a chicken waiting at the kerb. */
export function HeroRoad() {
  const lanes = [
    { left: 'calc(16px + 4px)', car: vehicle('taxi', '#f7c548'), dur: 2.8, delay: 0.3 },
    { left: 'calc(16px + 88px + 4px)', car: vehicle('sedan', '#ff6b5c'), dur: 2.2, delay: 1.4 },
    { left: 'calc(16px + 176px + 4px)', car: vehicle('truck', '#4cb4ff'), dur: 3.4, delay: 0.1 },
  ]
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[46%] overflow-hidden sm:block [mask-image:linear-gradient(to_right,transparent,black_18%)]" style={tiled(grass(), 4)}>
      <div className="absolute inset-y-0 left-[34%] w-[300px]" style={tiled(asphalt(), 4)}>
        <div className="absolute inset-y-0 left-0 w-4" style={tiled(curb(), 4)} />
        {[1, 2].map((i) => (
          <div key={i} className="absolute inset-y-0 w-1" style={{ left: 16 + i * 88 - 2, backgroundImage: 'linear-gradient(#e8edf3 50%, transparent 50%)', backgroundSize: '4px 40px' }} />
        ))}
        {lanes.map((l, i) => (
          <Car key={i} left={l.left} dur={l.dur} delay={l.delay} rest={0.6 + i * 0.4}>
            <Px s={l.car} scale={4} style={{ filter: 'drop-shadow(0 8px 0 rgba(0,0,0,.3))' }} />
          </Car>
        ))}
      </div>
      <Px s={bush()} scale={4} className="absolute left-[18%] top-[10%]" />
      <Px s={flower('#ff8fc7')} scale={4} className="absolute left-[8%] top-[66%]" />
      <div className="absolute bottom-[18%] left-[17%]">
        <Px s={chicken.idle()} scale={5} className="px-bob" style={{ filter: 'drop-shadow(0 5px 0 rgba(0,0,0,.25))' }} />
      </div>
    </div>
  )
}
