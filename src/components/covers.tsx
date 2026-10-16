import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import type { Sprite } from '../lib/pixel'
import { Px } from './pixelui'
import { asphalt, bush, chicken, curb, flower, grass, vehicle } from '../games/chicken/sprites'
import type { GameId } from '../store/games'
import { useUid } from '../art/ids'
import { Avatar } from '../art/Avatar'
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
    case 'popparty':
      return <PopPartyCover />
    case 'livebj':
      return <LiveBlackjackCover />
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

const PARTY_COLORS = ['#ff4fb8', '#ffcc29', '#3fc4ff', '#9a6bff', '#29d8c4']

/** The bunting string M-5 28 Q100 48 205 24 at x; its x runs evenly with t, so t falls straight out of x. */
function buntY(x: number) {
  const t = (x + 5) / 210
  return 28 * (1 - t) ** 2 + 96 * t * (1 - t) + 24 * t * t
}

/** A poodle pom-pom: a circle with a scalloped edge. */
function pom(cx: number, cy: number, r: number) {
  const n = r > 10 ? 9 : 7
  const p = (i: number) => {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2
    return `${(cx + Math.cos(a) * r * 0.86).toFixed(1)} ${(cy + Math.sin(a) * r * 0.86).toFixed(1)}`
  }
  const b = (r * 0.86 * Math.sin(Math.PI / n) * 1.3).toFixed(1)
  return `M${p(0)}${Array.from({ length: n }, (_, i) => ` A${b} ${b} 0 0 1 ${p(i + 1)}`).join('')}Z`
}

/** A star polygon around the origin with n points. */
function burst(n: number, ro: number, ri: number) {
  return Array.from({ length: n * 2 }, (_, i) => {
    const a = (i * Math.PI) / n - Math.PI / 2
    const r = i % 2 ? ri : ro
    return `${(Math.cos(a) * r).toFixed(1)},${(Math.sin(a) * r).toFixed(1)}`
  }).join(' ')
}

/** A four-point twinkle. */
function Sparkle({ x, y, r }: { x: number; y: number; r: number }) {
  const k = r * 0.22
  return <path d={`M${x} ${y - r} Q${x + k} ${y - k} ${x + r} ${y} Q${x + k} ${y + k} ${x} ${y + r} Q${x - k} ${y + k} ${x - r} ${y} Q${x - k} ${y - k} ${x} ${y - r}Z`} fill="#fff" />
}

/** A party balloon on a curly string. */
function CoverBalloon({ x, y, rx, ry, color, light, dark }: { x: number; y: number; rx: number; ry: number; color: string; light: string; dark: string }) {
  const u = useUid()
  const b = y + ry
  return (
    <g>
      <defs>
        <radialGradient id={u} cx=".34" cy=".28" r=".8">
          <stop offset="0" stopColor={light} />
          <stop offset=".55" stopColor={color} />
          <stop offset="1" stopColor={dark} />
        </radialGradient>
      </defs>
      <path d={`M${x} ${b + 5} c-7 7 7 12 0 19 s7 12 0 19 s7 12 0 19`} fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <path d={`M${x} ${b - 1} l-4.5 6.5 h9 Z`} fill={color} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={`url(#${u})`} stroke={INK} strokeWidth="3" />
      <ellipse cx={x - rx * 0.42} cy={y - ry * 0.42} rx={rx * 0.2} ry={ry * 0.3} fill="#fff" opacity=".85" transform={`rotate(32 ${x - rx * 0.42} ${y - ry * 0.42})`} />
    </g>
  )
}

/** Pop Party: Fifi the balloon poodle dancing on a lit disco floor under the bunting and the mirror ball. */
function PopPartyCover() {
  const u = useUid()
  const dark = '#2a1a4f'
  const floor = [
    ['#2fd3ff', '#6dff5a', '#ffe23d', '#ff4fd8'],
    [dark, '#ff9a2e', '#2fd3ff', dark],
  ]
  const pills = [
    [76, 209, '×4', '#6dff5a'],
    [76, 237, '×16', '#ff9a2e'],
  ] as const
  const confetti = [
    [84, 62, 0, 30], [98, 70, 2, 0], [70, 98, 4, -24], [178, 108, 1, 45], [190, 140, 3, 0],
    [166, 158, 2, 16], [188, 176, 0, -30], [12, 124, 1, 0], [10, 158, 3, 20], [150, 146, 4, 0],
  ] as const
  return (
    <Scene from="#62d4ff" to="#ff5fb8">
      <defs>
        <radialGradient id={`${u}d`} cx=".34" cy=".3" r=".8">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#9aa3c2" />
        </radialGradient>
        <radialGradient id={`${u}h`}>
          <stop offset="0" stopColor="#fff" stopOpacity=".7" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}t`} cy=".6" r=".6">
          <stop offset="0" stopColor="#fff" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}r`} cx="160" cy="64" r="190" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".4" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}p`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff86d0" />
          <stop offset=".55" stopColor="#ff4fb8" />
          <stop offset="1" stopColor="#e2349c" />
        </linearGradient>
        <radialGradient id={`${u}q`} cx=".38" cy=".32" r=".75">
          <stop offset="0" stopColor="#ffe3f6" />
          <stop offset="1" stopColor="#ff9fdc" />
        </radialGradient>
        <clipPath id={`${u}c`}>
          <circle cx="160" cy="64" r="22" />
        </clipPath>
        <filter id={`${u}g`} x="-40%" y="-80%" width="180%" height="260%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>

      {/* light beams from the mirror ball, then the dance floor, whose lit tiles glow up into the room */}
      <path d="M160 64 L-10 112 L-10 142 Z M160 64 L36 250 L70 250 Z M160 64 L138 250 L160 250 Z" fill={`url(#${u}r)`} />
      <rect y="192" width="200" height="58" fill={INK} />
      <g filter={`url(#${u}g)`} opacity=".9">
        {floor.map((row, r) => row.map((c, i) => c !== dark && <rect key={`${r}${i}`} x={6 + i * 48} y={197 + r * 28} width="44" height="24" rx="6" fill={c} />))}
      </g>
      {floor.map((row, r) =>
        row.map((c, i) => (
          <g key={`${r}${i}`}>
            <rect x={6 + i * 48} y={197 + r * 28} width="44" height="24" rx="6" fill={c} stroke={INK} strokeWidth="2.5" />
            {c !== dark && <rect x={6 + i * 48} y={197 + r * 28} width="44" height="24" rx="6" fill={`url(#${u}t)`} />}
            <rect x={11 + i * 48} y={200 + r * 28} width="34" height="3" rx="1.5" fill="#fff" opacity={c === dark ? 0.08 : 0.5} />
          </g>
        )),
      )}

      {[14, 38, 62, 86, 110, 134, 186].map((c, i) => {
        const y0 = buntY(c - 8)
        const y1 = buntY(c + 8)
        const n = Math.hypot(16, y1 - y0)
        const tip = `${(c - ((y1 - y0) / n) * 20).toFixed(1)} ${((y0 + y1) / 2 + (16 / n) * 20).toFixed(1)}`
        return <path key={c} d={`M${c - 8} ${y0.toFixed(1)} L${c + 8} ${y1.toFixed(1)} L${tip}Z`} fill={PARTY_COLORS[i % 5]} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      })}
      <path d="M-5 28 Q100 48 205 24" fill="none" stroke={INK} strokeWidth="2.5" />

      <CoverBalloon x={52} y={58} rx={12} ry={14} color="#3fc4ff" light="#c4f0ff" dark="#1d8fd6" />
      <CoverBalloon x={30} y={78} rx={15} ry={18} color="#ff8a2a" light="#ffd2a4" dark="#e0600c" />

      {/* the mirror ball hangs from the bunting */}
      <circle cx="160" cy="64" r="36" fill={`url(#${u}h)`} />
      <path d={`M160 ${buntY(160).toFixed(1)} V40`} stroke={INK} strokeWidth="2" />
      <circle cx="160" cy="64" r="22" fill={`url(#${u}d)`} />
      <g clipPath={`url(#${u}c)`} fill="none" stroke="#7d86a8" strokeWidth="1.5">
        {[-11, 0, 11].map((dy) => {
          const w = Math.sqrt(22 * 22 - dy * dy)
          return <path key={dy} d={`M${160 - w} ${64 + dy} A${w} ${w * 0.3} 0 0 0 ${160 + w} ${64 + dy}`} />
        })}
        {[9, 17].map((w) => (
          <path key={w} d={`M160 42 A${w} 22 0 0 0 160 86 M160 42 A${w} 22 0 0 1 160 86`} />
        ))}
        <rect x="145" y="49" width="6" height="6" rx="1" fill="#fff" stroke="none" transform="rotate(-12 148 52)" />
        <rect x="152.5" y="45" width="5" height="5" rx="1" fill="#fff" stroke="none" opacity=".85" transform="rotate(-8 155 47.5)" />
        <rect x="165" y="70" width="5" height="5" rx="1" fill="#ff9fdc" stroke="none" opacity=".8" />
        <rect x="151" y="74" width="5" height="5" rx="1" fill="#9ff0ff" stroke="none" opacity=".8" />
      </g>
      <circle cx="160" cy="64" r="22" fill="none" stroke={INK} strokeWidth="3.5" />
      <g transform="translate(160 41)" fill="#ff4fb8" stroke={INK} strokeWidth="2" strokeLinejoin="round">
        <path d="M0 0 L-10 -6 L-10 6 Z M0 0 L10 -6 L10 6 Z" />
        <circle r="3.4" />
      </g>
      <Sparkle x={192} y={62} r={5} />
      <Sparkle x={185} y={94} r={4} />
      <Sparkle x={134} y={74} r={3} />

      {confetti.map(([x, y, c, a], i) =>
        i % 2 ? (
          <circle key={i} cx={x} cy={y} r="2.2" fill={PARTY_COLORS[c]} />
        ) : (
          <rect key={i} x={x - 3} y={y - 1.5} width="6" height="3" rx="1" fill={PARTY_COLORS[c]} transform={`rotate(${a} ${x} ${y})`} />
        ),
      )}

      <g style={{ filter: 'drop-shadow(0 12px 16px rgba(0,0,0,.35))' }}>
        <g stroke={INK} strokeWidth="4" strokeLinejoin="round">
          <rect x="82" y="156" width="14" height="34" rx="7" fill="#d8399b" />
          <rect x="124" y="156" width="14" height="34" rx="7" fill="#d8399b" />
          <path d={pom(89, 187, 9)} fill="#f07fc9" strokeWidth="3" />
          <path d={pom(131, 187, 9)} fill="#f07fc9" strokeWidth="3" />
          <rect x="68" y="158" width="14" height="34" rx="7" fill={`url(#${u}p)`} />
          <rect x="110" y="158" width="14" height="34" rx="7" fill={`url(#${u}p)`} />
          <path d="M70 148 Q57 140 51 123" fill="none" strokeWidth="18" strokeLinecap="round" />
          <path d="M70 148 Q57 140 51 123" fill="none" stroke="#ff4fb8" strokeWidth="10" strokeLinecap="round" />
          <path d={pom(46, 116, 13)} fill={`url(#${u}q)`} strokeWidth="3" />
          <rect x="119" y="117" width="18" height="34" rx="9" fill={`url(#${u}p)`} transform="rotate(-20 128 134)" />
          <rect x="64" y="140" width="74" height="30" rx="15" fill={`url(#${u}p)`} />
          <path d={pom(75, 190, 9)} fill={`url(#${u}q)`} strokeWidth="3" />
          <path d={pom(117, 190, 9)} fill={`url(#${u}q)`} strokeWidth="3" />
          <circle cx="124" cy="104" r="24" fill={`url(#${u}p)`} />
          <path d={pom(102, 116, 13)} fill={`url(#${u}q)`} strokeWidth="3" />
          <path d={pom(122, 78, 13)} fill={`url(#${u}q)`} strokeWidth="3" />
          <rect x="136" y="108" width="34" height="18" rx="9" fill={`url(#${u}p)`} />
          <ellipse cx="130" cy="98" rx="8" ry="9" fill="#fff" strokeWidth="2.5" />
        </g>
        <g transform="translate(112 68) rotate(-20)" fill="#b6ff3b" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d="M0 0 L-9 -6 L-9 6 Z M0 0 L9 -6 L9 6 Z" />
          <circle r="3" />
        </g>
        <circle cx="168" cy="111" r="5" fill={INK} />
        <circle cx="166.5" cy="109.5" r="1.5" fill="#fff" />
        <circle cx="132.5" cy="99.5" r="4" fill={INK} />
        <circle cx="134" cy="97.5" r="1.5" fill="#fff" />
        <path d="M135 91 L139 87 M131 89.5 L133 85" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        <ellipse cx="122" cy="114" rx="5.5" ry="3.2" fill="#ff9ccf" />
        <path d="M146 121 Q153 127 161 122" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
        <path d="M76 147 Q84 144 96 144" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="113" cy="92" rx="6" ry="3.5" fill="#fff" opacity=".55" transform="rotate(-40 113 92)" />
      </g>

      {pills.map(([x, y, t, c]) => (
        <g key={t}>
          <rect x={x - 15} y={y - 8} width="30" height="16" rx="8" fill={c} stroke={INK} strokeWidth="2.5" />
          <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="3" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
            {t}
          </text>
        </g>
      ))}

      <g transform="translate(42 176) rotate(-12)" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.3))' }}>
        <polygon points={burst(12, 26, 16)} fill="#ffe23d" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
        <text y="5.5" textAnchor="middle" fontSize="16" fontWeight="900" fill="#ff3b55" stroke="#fff" strokeWidth="3" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
          POP!
        </text>
      </g>
    </Scene>
  )
}

/** Live Blackjack: the dealer's hand at the top of a shared table, players and their stakes around the rail. */
function LiveBlackjackCover() {
  // [avatar x, y, design, chip value]: players round the table edge, each with a stake on the felt
  const seats: [number, number, number, number][] = [
    [28, 138, 9, 10],
    [100, 156, 2, 100],
    [172, 138, 5, 25],
  ]
  return (
    <Scene from="#f2a93b" to="#0a3027">
      <ellipse cx="100" cy="52" rx="124" ry="96" fill="#0f5a42" stroke="#f7c548" strokeOpacity=".7" strokeWidth="2.5" />
      <ellipse cx="100" cy="52" rx="108" ry="80" fill="none" stroke="#fff" strokeOpacity=".14" strokeWidth="1.5" strokeDasharray="5 5" />
      <g transform="rotate(-9 76 46)" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' }}>
        <CardFace rank="A" suit="♠" x={52} y={12} width={48} height={67} />
      </g>
      <g transform="rotate(8 124 48)" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' }}>
        <CardBack x={100} y={14} width={48} height={67} />
      </g>
      {seats.map(([x, y, a, v]) => (
        <g key={x}>
          <Chip value={v} size={24} x={x - 12 + (100 - x) * 0.12} y={y - 44} />
          <circle cx={x} cy={y} r="18" fill="#0a3027" stroke="#f7c548" strokeOpacity=".55" strokeWidth="1.5" />
          <g transform={`translate(${x - 15} ${y - 15})`}>
            <Avatar index={a} size={30} />
          </g>
        </g>
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
