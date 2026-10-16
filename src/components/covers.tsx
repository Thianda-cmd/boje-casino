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
import { CrateArt, ItemArt } from '../games/cases/art'
import { duckMarkup, type Expr } from '../games/derby/art'
import { bojeFacets } from '../art/brand'

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
    case 'chompers':
      return <ChompersCover />
    case 'battles':
      return <BattlesCover />
    case 'derby':
      return <DerbyCover />
    case 'double':
      return <DoubleCover />
    case 'claw':
      return <ClawCover />
    case 'cases':
      return <CasesCover />
    case 'baccarat':
      return <BaccaratCover />
    case 'roboriot':
      return <RoboRiotCover />
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

/** Big Mama Chomp's furry outline: an ellipse whose edge breaks into curling tufts, longest on top */
const MAMA_FUR = (() => {
  const [cx, cy, rx, ry, n] = [100, 112, 60, 54, 30]
  const at = (a: number, out: number) => `${(cx + Math.cos(a) * (rx + out)).toFixed(1)} ${(cy + Math.sin(a) * (ry + out)).toFixed(1)}`
  const step = (Math.PI * 2) / n
  let d = `M${at(-Math.PI / 2, 0)}`
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + i * step
    const tip = a0 + step * 0.62
    const up = Math.max(0, -Math.sin(tip))
    const len = 1.2 + up ** 1.6 * 12 + (i % 3) * up * 1.6
    d += ` Q${at(a0 + step * 0.2, len * 0.9)} ${at(tip, len)} Q${at(tip + step * 0.12, len * 0.35)} ${at(a0 + step, 0)}`
  }
  return d + 'Z'
})()

/** The slime along the top of the machine: a band with drips hanging from it (x, length) */
const SLIME_DRIPS: [number, number][] = [
  [168, 14],
  [138, 22],
  [112, 10],
  [84, 18],
  [56, 12],
  [26, 20],
]
const SLIME = (() => {
  let d = 'M-6 168 Q50 163 100 167 T206 166 V184'
  for (const [x, len] of SLIME_DRIPS) d += ` H${x + 4.5} V${184 + len - 4.5} A4.5 4.5 0 0 1 ${x - 4.5} ${184 + len - 4.5} V184`
  return d + ' H-6 Z'
})()

/** Chompers: Big Mama Chomp rises over the slimy machine in her party hat, chomping a donut, with a Feast Pick egg and snacks on the reels. */
function ChompersCover() {
  const u = useUid()
  const eyes = [78, 122]
  const teeth = [86, 93, 100, 107, 114]
  return (
    <Scene from="#b35cff" to="#1c0a45">
      <defs>
        <radialGradient id={`${u}f`} cx=".38" cy=".3" r=".8">
          <stop offset="0" stopColor="#ff9fd2" />
          <stop offset=".55" stopColor="#ff4fa3" />
          <stop offset="1" stopColor="#c4237a" />
        </radialGradient>
        <linearGradient id={`${u}h`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff6dc" />
          <stop offset="1" stopColor="#e7b46a" />
        </linearGradient>
        <radialGradient id={`${u}m`} cx=".5" cy=".15" r=".95">
          <stop offset="0" stopColor="#7a1846" />
          <stop offset="1" stopColor="#2c0620" />
        </radialGradient>
        <radialGradient id={`${u}e`} cx=".4" cy=".35" r=".7">
          <stop offset="0" stopColor="#8dffb9" />
          <stop offset="1" stopColor="#13a755" />
        </radialGradient>
        <linearGradient id={`${u}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8cffbd" />
          <stop offset=".5" stopColor="#2ee87f" />
          <stop offset="1" stopColor="#17b45e" />
        </linearGradient>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a0f55" />
          <stop offset="1" stopColor="#14072e" />
        </linearGradient>
        <radialGradient id={`${u}g`}>
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff6c8" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${u}b`} cx=".4" cy=".35" r=".75">
          <stop offset="0" stopColor="#b6ffd4" />
          <stop offset="1" stopColor="#14a854" />
        </radialGradient>
      </defs>

      {/* the night sky: a big moon with a bat across it, and stars */}
      <circle cx="38" cy="50" r="34" fill={`url(#${u}g)`} />
      <circle cx="38" cy="50" r="21" fill="#fff3c4" />
      <circle cx="31" cy="45" r="4" fill="#f1dc9a" />
      <circle cx="44" cy="58" r="3" fill="#f1dc9a" />
      <path d="M30 34c3 1 4 4 6 3s2-4 5-4c-1 2 0 4 2 4s3-3 5-2c-3 1-3 5-6 5s-3-2-6-2-3 3-6 2 1-4 0-6Z" fill={INK} opacity=".85" />
      {[[16, 92, 1.6], [70, 22, 1.4], [150, 16, 1.8], [186, 96, 1.4], [174, 128, 1.2], [12, 130, 1.2]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity=".85" />
      ))}
      <Sparkle x={186} y={30} r={5} />
      <Sparkle x={12} y={112} r={4} />

      {/* the machine under her: the reel window with snacks peeking up, the frame and the dripping slime */}
      <rect x="-6" y="176" width="212" height="80" fill="#6a2bd0" />
      <rect x="14" y="186" width="172" height="70" rx="10" fill={`url(#${u}w)`} stroke="#ff7ac8" strokeWidth="2.5" />
      {/* a cupcake */}
      <g transform="translate(46 222)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
        <path d="M-15 0 L15 0 L11 22 L-11 22 Z" fill="#ffc94d" />
        <path d="M-7 1 L-6 21 M0 1 V21 M7 1 L6 21" stroke="#e39a2b" strokeWidth="2" />
        <path d="M-17 2 Q-19 -8 -10 -10 Q-10 -20 0 -20 Q10 -20 10 -10 Q19 -8 17 2 Z" fill="#ff8cc6" />
        <circle cx="2" cy="-23" r="5" fill="#ff3b5c" strokeWidth="2" />
        <path d="M3 -28 Q5 -33 9 -34" fill="none" strokeWidth="2" />
        <circle cx="-4" cy="10" r="1.6" fill={INK} stroke="none" />
        <circle cx="4" cy="10" r="1.6" fill={INK} stroke="none" />
        <path d="M-3 14 Q0 16.5 3 14" fill="none" strokeWidth="1.8" strokeLinecap="round" />
        {[[-9, -6, '#fff'], [-2, -13, '#ffe35a'], [6, -7, '#5be3ff'], [10, -2, '#fff']].map(([x, y, c], i) => (
          <rect key={i} x={(x as number) - 2} y={(y as number) - 0.8} width="4" height="1.6" rx=".8" fill={c as string} stroke="none" transform={`rotate(${i * 40 - 30} ${x} ${y})`} />
        ))}
      </g>
      {/* a rainbow lollipop */}
      <g transform="translate(154 220)">
        <rect x="-2" y="10" width="4" height="30" rx="2" fill="#fff" stroke={INK} strokeWidth="2" />
        <circle r="17" fill="#fff" stroke={INK} strokeWidth="3" />
        <circle r="13.5" fill="none" stroke="#ff5b6e" strokeWidth="3.5" />
        <circle r="9.5" fill="none" stroke="#ffd23f" strokeWidth="3.5" />
        <circle r="5.5" fill="none" stroke="#2fd3c4" strokeWidth="3.5" />
        <circle cx="-4" cy="1" r="1.7" fill={INK} />
        <circle cx="4" cy="1" r="1.7" fill={INK} />
        <path d="M-3 5 Q0 7.5 3 5" fill="none" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
        <ellipse cx="-7" cy="-8" rx="3" ry="4.5" fill="#fff" opacity=".7" transform="rotate(35 -7 -8)" />
      </g>
      <CoverDonut x={100} y={232} r={18} icing="#ffcf3a" rot={-8} />

      {/* her arms reach down to the corners of the machine */}
      <g fill="none" strokeLinecap="round">
        <path d="M54 136 Q30 140 28 172" stroke={INK} strokeWidth="25" />
        <path d="M146 136 Q170 140 172 172" stroke={INK} strokeWidth="25" />
        <path d="M54 136 Q30 140 28 172" stroke="#e8398f" strokeWidth="18" />
        <path d="M146 136 Q170 140 172 172" stroke="#e8398f" strokeWidth="18" />
      </g>

      {/* Big Mama Chomp */}
      <g style={{ filter: 'drop-shadow(0 10px 14px rgba(20,0,40,.45))' }}>
        {/* horns */}
        <g stroke={INK} strokeWidth="3" strokeLinejoin="round" fill={`url(#${u}h)`}>
          <path d="M60 72 Q44 60 46 36 Q58 50 74 60 Z" />
          <path d="M140 72 Q156 60 154 36 Q142 50 126 60 Z" />
        </g>
        <path d="M52 50 Q58 56 64 58 M148 50 Q142 56 136 58" stroke="#c98d48" strokeWidth="2" fill="none" />
        <path d={MAMA_FUR} fill={`url(#${u}f)`} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        {/* spots and a soft shine */}
        {[[64, 78, 5], [146, 100, 4], [136, 70, 3.5], [56, 130, 3]].map(([x, y, r], i) => (
          <ellipse key={i} cx={x} cy={y} rx={r} ry={r * 0.8} fill="#a43be0" opacity=".55" />
        ))}
        <ellipse cx="76" cy="70" rx="15" ry="7" fill="#fff" opacity=".28" transform="rotate(-24 76 70)" />
        {/* party hat */}
        <g transform="rotate(14 104 52)">
          <path d="M90 64 L104 26 L118 64 Z" fill="#ffd23f" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <path d="M96 48 L112 48 M93 56 L115 56 M100 38 L108 38" stroke="#2ee87f" strokeWidth="4" />
          <path d="M90 64 L104 26 L118 64 Z" fill="none" stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          <circle cx="104" cy="25" r="5" fill="#ff5fa2" stroke={INK} strokeWidth="2.5" />
        </g>
        {/* eyes: big green ones, looking at the donut she's about to eat */}
        {eyes.map((x) => (
          <g key={x}>
            <ellipse cx={x} cy="94" rx="16.5" ry="17.5" fill="#fff" stroke={INK} strokeWidth="3" />
            <circle cx={x + 3.5} cy="97" r="10" fill={`url(#${u}e)`} />
            <circle cx={x + 4.5} cy="98" r="5.2" fill={INK} />
            <circle cx={x + 1.5} cy="93.5" r="2.6" fill="#fff" />
            <circle cx={x + 8} cy="102" r="1.3" fill="#fff" opacity=".8" />
          </g>
        ))}
        <path d="M64 82 l-7 -5 M68 78.5 l-4 -7 M74 77 l-1.5 -7 M136 82 l7 -5 M132 78.5 l4 -7 M126 77 l1.5 -7" stroke={INK} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M62 70 Q76 62 90 70 M110 70 Q124 62 138 70" stroke="#8c1858" strokeWidth="4.5" strokeLinecap="round" fill="none" />
        {/* cheeks and nose */}
        <ellipse cx="58" cy="118" rx="9" ry="6" fill="#ffb8dc" opacity=".85" />
        <ellipse cx="142" cy="118" rx="9" ry="6" fill="#ffb8dc" opacity=".85" />
        <ellipse cx="100" cy="114" rx="5.5" ry="3.8" fill="#c4237a" stroke={INK} strokeWidth="2" />
        {/* the huge open mouth, fangs, teeth and tongue */}
        <path d="M64 124 Q100 133 136 124 Q134 170 100 172 Q66 170 64 124 Z" fill={`url(#${u}m)`} stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
        <ellipse cx="100" cy="160" rx="21" ry="10" fill="#ff6f9a" />
        <path d="M100 153 V164" stroke="#d94a78" strokeWidth="2" strokeLinecap="round" />
        <g fill="#fff" stroke={INK} strokeWidth="2.2" strokeLinejoin="round">
          <path d="M70 126 L80 128.5 L75 143 Z" />
          <path d="M130 126 L120 128.5 L125 143 Z" />
          {teeth.map((x) => (
            <path key={x} d={`M${x - 3.2} ${129.6 + Math.abs(x - 100) * -0.05} h6.4 v4.5 a3.2 3.2 0 0 1 -6.4 0 Z`} />
          ))}
        </g>
      </g>

      {/* the slime band over the machine's top edge, and her hands gripping it */}
      <path d={SLIME} fill={`url(#${u}s)`} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      <path d="M8 171 Q50 167 92 170 M110 170 Q150 167 192 169" stroke="#fff" strokeOpacity=".6" strokeWidth="3" strokeLinecap="round" fill="none" />
      {SLIME_DRIPS.map(([x, len]) => (
        <circle key={x} cx={x - 1.5} cy={184 + len - 6} r="1.4" fill="#fff" opacity=".7" />
      ))}
      {[28, 172].map((x, s) => (
        <g key={x} transform={`translate(${x} 174) scale(${s ? -1 : 1} 1)`} stroke={INK} strokeWidth="2.6" strokeLinejoin="round">
          <ellipse cx="0" cy="-2" rx="15" ry="11" fill="#ff5fae" />
          {[-9, -2, 6].map((fx, i) => (
            <g key={fx}>
              <path d={`M${fx - 2} 10 l${i === 2 ? 5 : 3} 8 l3 -8`} fill="#fff" strokeWidth="2" />
              <ellipse cx={fx + 1} cy="6" rx="5" ry="6.5" fill="#ff5fae" />
            </g>
          ))}
          <ellipse cx="-4" cy="-6" rx="5" ry="2.6" fill="#fff" opacity=".45" stroke="none" />
        </g>
      ))}

      {/* the donut she's about to eat, flying in with crumbs */}
      <path d="M176 116 L194 110 M178 126 L198 124 M174 136 L190 140" stroke="#fff" strokeOpacity=".55" strokeWidth="2.5" strokeLinecap="round" />
      <CoverDonut x={160} y={128} r={13} icing="#ff8ad0" rot={30} />
      {[[140, 146, 2.4], [148, 112, 2], [136, 120, 1.6], [150, 150, 1.8]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#e39a4b" stroke={INK} strokeWidth="1.2" />
      ))}

      {/* the Feast Pick: a cracked egg hatching a ×2 badge */}
      <g transform="translate(170 64) rotate(10)" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' }}>
        <path d="M-15 4 C-15 -10 -8 -22 0 -22 C8 -22 15 -10 15 4 C15 15 8 21 0 21 C-8 21 -15 15 -15 4 Z" fill="#fff4dc" stroke={INK} strokeWidth="2.6" />
        <path d="M-15 0 l5 4 l4 -5 l5 5 l5 -5 l4 4 l6 -3" fill="none" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx="-7" cy="11" r="2.4" fill="#a55bff" />
        <circle cx="8" cy="13" r="2" fill="#2ee87f" />
        <circle cx="0" cy="-30" r="14" fill={`url(#${u}b)`} stroke={INK} strokeWidth="2.6" />
        <text x="0" y="-25" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="3" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
          2×
        </text>
        <Sparkle x={-17} y={-40} r={4} />
        <Sparkle x={17} y={-20} r={3} />
      </g>
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

const RINK = '#0b1033'
const ROBO_FONT = 'Manrope, system-ui, sans-serif'
/** the city behind the workshop window: [x, roof y, width] */
const ROBO_CITY: [number, number, number][] = [
  [-4, 128, 20], [14, 106, 18], [30, 138, 16], [44, 96, 18], [60, 120, 14], [140, 112, 16], [154, 90, 20], [172, 124, 14], [184, 100, 20],
]
/** lit windows: a few per building, picked deterministically, in warm lamplight */
const ROBO_WINDOWS = ROBO_CITY.flatMap(([x, y, w], b) =>
  Array.from({ length: 5 }, (_, i) => {
    const col = (b * 7 + i * 3) % 3
    const row = (b * 5 + i * 7) % 6
    return { x: x + 3 + col * ((w - 6) / 3), y: y + 6 + row * 9, c: ['#ffd76a', '#ffe9a8', '#ffc24d'][(b + i) % 3] }
  }).filter((p) => p.y < 172),
)
/** the Power Grid sockets on the machine's sign: [label, colour] */
const ROBO_SOCKETS: [string, string][] = [
  ['5', '#5cf2ff'],
  ['×2', '#ffe14a'],
  ['25', '#ff4fd8'],
  ['50', '#ffcf3a'],
]

/** A glass power cell like the game's: chrome caps, a glowing core, and a value tag under it when given. (x, y) is its top centre. */
function CoverCell({ x, y, core, tag, gold = false, rot = 0 }: { x: number; y: number; core: string; tag?: string; gold?: boolean; rot?: number }) {
  const cap = gold ? '#ffd45a' : '#e3eaf3'
  return (
    <g transform={`rotate(${rot} ${x} ${y + 18})`}>
      <rect x={x - 10} y={y + 4} width="20" height="28" rx="5" fill={gold ? '#ffe6a0' : '#c9f3ff'} stroke={RINK} strokeWidth="2.5" />
      <rect x={x - 5} y={y + 8} width="10" height="20" rx="5" fill={core} />
      <rect x={x - 2.4} y={y + 10} width="3.6" height="15" rx="1.8" fill="#fff" opacity=".9" />
      <rect x={x - 12.5} y={y} width="25" height="7" rx="2.5" fill={cap} stroke={RINK} strokeWidth="2.5" />
      <rect x={x - 12.5} y={y + 29} width="25" height="7" rx="2.5" fill={cap} stroke={RINK} strokeWidth="2.5" />
      {tag && (
        <g>
          <rect x={x - 16} y={y + 39} width="32" height="16" rx="5" fill="#fff" stroke={RINK} strokeWidth="2.5" />
          <text x={x} y={y + 51.5} textAnchor="middle" fontSize="12" fontWeight="900" fill={RINK} fontFamily={ROBO_FONT}>
            {tag}
          </text>
        </g>
      )}
    </g>
  )
}

/** Robo Riot: Volt, the big cartoon toy robot, behind his machine's red marquee in the workshop at night, a power cell
 *  held high and a lightning bolt from his other claw. */
function RoboRiotCover() {
  const u = useUid()
  const arm = (d: string) => (
    <>
      <path d={d} fill="none" stroke={RINK} strokeWidth="15" strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={`url(#${u}a)`} strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
    </>
  )
  const pincer = (d: string) => (
    <>
      <path d={d} fill="none" stroke={RINK} strokeWidth="8" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#dfe7f1" strokeWidth="3.5" strokeLinecap="round" />
    </>
  )
  const bolt = '166,60 175,44 169,42 181,25 175,23 188,4'
  return (
    <Scene from="#8f78ff" to="#2a1660">
      <defs>
        <linearGradient id={`${u}m`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset=".62" stopColor="#f1f4fa" />
          <stop offset=".62" stopColor="#d6deeb" />
          <stop offset="1" stopColor="#d6deeb" />
        </linearGradient>
        <linearGradient id={`${u}a`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f4f6fb" />
          <stop offset="1" stopColor="#d6deeb" />
        </linearGradient>
        <linearGradient id={`${u}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6ff5ea" />
          <stop offset=".6" stopColor="#19d3c5" />
          <stop offset="1" stopColor="#0d958c" />
        </linearGradient>
        <radialGradient id={`${u}s`} cx=".4" cy=".35" r=".8">
          <stop offset="0" stopColor="#25407a" />
          <stop offset="1" stopColor="#13234d" />
        </radialGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff8a8a" />
          <stop offset="1" stopColor="#d81e2c" />
        </linearGradient>
        <linearGradient id={`${u}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5a5f" />
          <stop offset=".5" stopColor="#ff5a5f" />
          <stop offset=".5" stopColor="#e2343f" />
          <stop offset="1" stopColor="#e2343f" />
        </linearGradient>
      </defs>

      {/* the window onto the city: searchlights, the moon, the skyline with its lit windows */}
      <circle cx="34" cy="34" r="17" fill="#fff4d0" stroke={RINK} strokeWidth="2.5" />
      <circle cx="29" cy="30" r="3.4" fill="#f0dfa8" />
      <circle cx="39" cy="40" r="2.4" fill="#f0dfa8" />
      <g fill="#3d2580">
        {ROBO_CITY.map(([x, y, w]) => (
          <rect key={x} x={x} y={y} width={w} height={190 - y} />
        ))}
      </g>
      {ROBO_WINDOWS.map((w, i) => (
        <rect key={i} x={w.x} y={w.y} width="2.6" height="3" fill={w.c} />
      ))}

      {/* the body, with the chest panel, its power core and LEDs */}
      <g stroke={RINK} strokeWidth="3" strokeLinejoin="round">
        <rect x="66" y="106" width="68" height="84" rx="13" fill={`url(#${u}m)`} />
        <rect x="80" y="116" width="40" height="44" rx="8" fill={`url(#${u}t)`} strokeWidth="2.5" />
        <circle cx="100" cy="136" r="12" fill={`url(#${u}s)`} strokeWidth="2.5" />
      </g>
      <path d="M102.5 127 95 138h5l-2.5 8.5 8-11.5h-5l2-8Z" fill="#ffe14a" stroke="#fff6c0" strokeWidth=".8" strokeLinejoin="round" />
      {['#ff4fd8', '#ffe14a', '#59ff7a', '#5cf2ff'].map((c, i) => (
        <circle key={c} cx={88 + i * 8} cy="154" r="2" fill={c} />
      ))}
      <rect x="91" y="100" width="18" height="10" rx="2" fill="#6f7c94" stroke={RINK} strokeWidth="2.5" />

      {/* arms up: a gold power cell held high on the left, lightning from the open claw on the right */}
      {arm('M70 118 L46 104 L38 84')}
      {arm('M130 118 L154 104 L164 82')}
      <g stroke={RINK} strokeWidth="2.5" fill={`url(#${u}t)`}>
        <circle cx="66" cy="117" r="11" strokeWidth="3" />
        <circle cx="134" cy="117" r="11" strokeWidth="3" />
        <circle cx="46" cy="104" r="5.5" />
        <circle cx="154" cy="104" r="5.5" />
      </g>
      <CoverCell x={37} y={40} core="#ffb21f" gold rot={-8} />
      {pincer('M31 88 Q25 82 30 74')}
      {pincer('M44 88 Q50 81 44 73')}

      <polyline points={bolt} fill="none" stroke={RINK} strokeWidth="9" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={bolt} fill="none" stroke="#ffe14a" strokeWidth="4.5" strokeLinejoin="round" strokeLinecap="round" />
      {pincer('M160 84 Q154 74 160 66')}
      {pincer('M171 84 Q178 74 171 66')}

      {/* the head: antennae with glowing bulbs, the beacon, ear discs and the screen face (^ ^ and a grin) */}
      <g stroke={RINK} strokeWidth="3" strokeLinecap="round">
        <path d="M76 44 L68 20 M124 44 L132 20" />
      </g>
      <g stroke={RINK} strokeWidth="2.5">
        <circle cx="68" cy="18" r="5.2" fill="#ffd34a" />
        <circle cx="132" cy="18" r="5.2" fill="#ffd34a" />
        <rect x="87" y="35" width="26" height="7" rx="2" fill="#6f7c94" />
        <path d="M90 36 A10 10 0 0 1 110 36 Z" fill={`url(#${u}r)`} />
      </g>
      <ellipse cx="96" cy="30" rx="2.4" ry="1.6" fill="#fff" opacity=".8" />
      <g stroke={RINK} strokeWidth="3">
        <circle cx="58" cy="72" r="10" fill={`url(#${u}t)`} />
        <circle cx="142" cy="72" r="10" fill={`url(#${u}t)`} />
        <rect x="60" y="40" width="80" height="64" rx="16" fill={`url(#${u}m)`} />
        <rect x="69" y="48" width="62" height="47" rx="10" fill={`url(#${u}s)`} strokeWidth="2.5" />
      </g>
      <path d="M73 54 Q73 51 77 51 H100 L88 64 H73 Z" fill="#fff" opacity=".08" />
      <g fill="none" stroke="#5cf2ff" strokeLinecap="round">
        <path d="M80 75 Q87 64 94 75 M106 75 Q113 64 120 75" strokeWidth="4.5" />
        <path d="M88 82 Q100 93 112 82" strokeWidth="4" />
      </g>
      <ellipse cx="78.5" cy="84" rx="4.2" ry="2.6" fill="#ff5fb0" opacity=".9" />
      <ellipse cx="121.5" cy="84" rx="4.2" ry="2.6" fill="#ff5fb0" opacity=".9" />

      {/* a power cell with its value hovers by his side */}
      <CoverCell x={176} y={118} core="#ff4fd8" tag="25" rot={10} />

      {/* the machine's marquee: chasing bulbs, and the Power Grid sockets lit with values */}
      <path d="M4 254 V186 Q4 172 18 172 H182 Q196 172 196 186 V254 Z" fill={`url(#${u}k)`} stroke={RINK} strokeWidth="3" />
      {Array.from({ length: 15 }, (_, i) => (
        <circle key={i} cx={16 + i * 12} cy="180" r="2.8" fill={i % 2 ? '#fff4c2' : '#ffd34a'} stroke={RINK} strokeWidth="1.2" />
      ))}
      <rect x="14" y="190" width="172" height="70" rx="9" fill="#25226b" stroke={RINK} strokeWidth="2.5" />
      {ROBO_SOCKETS.map(([t, c], i) => (
        <g key={t}>
          <rect x={22 + i * 41} y="198" width="33" height="28" rx="6" fill={c} stroke={RINK} strokeWidth="2.5" />
          <text x={38.5 + i * 41} y="217" textAnchor="middle" fontSize="14" fontWeight="900" fill="#fff" stroke={RINK} strokeWidth="3" paintOrder="stroke" fontFamily={ROBO_FONT}>
            {t}
          </text>
        </g>
      ))}

      {/* ZAP! */}
      <g transform="translate(30 150) rotate(-12)" style={{ filter: 'drop-shadow(0 6px 8px rgba(0,0,0,.35))' }}>
        <polygon points={burst(12, 25, 15)} fill="#ffe14a" stroke={RINK} strokeWidth="3" strokeLinejoin="round" />
        <text y="5.5" textAnchor="middle" fontSize="15" fontWeight="900" fill="#2a6cff" stroke="#fff" strokeWidth="3" paintOrder="stroke" fontFamily={ROBO_FONT}>
          ZAP!
        </text>
      </g>
      <Sparkle x={190} y={60} r={4.5} />
      <Sparkle x={14} y={98} r={3.5} />
      <Sparkle x={150} y={18} r={3} />
    </Scene>
  )
}

/** Cases: the obsidian crate thrown open, gold light pouring out and the loot rising on it: a grand diamond, a crown,
 *  gold coins and a ring. */
function CasesCover() {
  const u = useUid()
  return (
    <Scene from="#ffb547" to="#4a1804">
      <defs>
        <linearGradient id={`${u}beam`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#fff3c4" stopOpacity=".75" />
          <stop offset=".55" stopColor="#ffe08a" stopOpacity=".22" />
          <stop offset="1" stopColor="#ffe08a" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff6d6" stopOpacity=".95" />
          <stop offset=".45" stopColor="#ffc94a" stopOpacity=".55" />
          <stop offset="1" stopColor="#ffb547" stopOpacity="0" />
        </radialGradient>
      </defs>
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d="M100 150 L94 -60 L106 -60 Z" fill="#fff" opacity=".07" transform={`rotate(${(i - 4) * 17} 100 150)`} />
      ))}
      <path d="M52 146 L4 -10 H196 L148 146 Z" fill={`url(#${u}beam)`} />
      <ellipse cx="100" cy="142" rx="86" ry="56" fill={`url(#${u}glow)`} />
      {/* the crate, its lid thrown up and back */}
      <g style={{ filter: 'drop-shadow(0 10px 12px rgba(40,10,0,.45))' }}>
        <CrateArt tier="extreme" part="body" size={146} x={27} y={92} />
      </g>
      <ellipse cx="100" cy="144" rx="44" ry="7" fill="#fff4cf" opacity=".85" />
      <g transform="translate(0 -26) rotate(-10 100 120)">
        <CrateArt tier="extreme" part="lid" size={146} x={27} y={92} />
      </g>
      {/* the loot */}
      <g transform="rotate(-16 40 86)">
        <ItemArt kind="crown" size={50} x={15} y={60} />
      </g>
      <g transform="rotate(12 160 92)">
        <ItemArt kind="coins" size={46} x={137} y={68} />
      </g>
      <g transform="rotate(14 150 38)">
        <ItemArt kind="ring" size={34} x={133} y={20} />
      </g>
      <g style={{ filter: 'drop-shadow(0 8px 10px rgba(60,20,0,.35))' }}>
        <ItemArt kind="diamond" size={78} x={61} y={22} />
      </g>
      <Sparkle x={40} y={30} r={5} />
      <Sparkle x={176} y={128} r={4} />
      <Sparkle x={22} y={128} r={3} />
    </Scene>
  )
}

/** Baccarat: a natural nine and a card being squeezed, its corner peeled back to the first pip, over the curved
 *  Player and Banker zones with chips on them. */
function BaccaratCover() {
  const u = useUid()
  // the layout's arcs, concentric with the dealer far above
  const cx = 100
  const cy = -175
  const pt = (r: number, deg: number) => {
    const a = (deg * Math.PI) / 180
    return `${(cx + r * Math.sin(a)).toFixed(1)} ${(cy + r * Math.cos(a)).toFixed(1)}`
  }
  const band = (ri: number, ro: number, a0: number, a1: number) => `M${pt(ro, a0)} A${ro} ${ro} 0 0 0 ${pt(ro, a1)} L${pt(ri, a1)} A${ri} ${ri} 0 0 1 ${pt(ri, a0)}Z`
  const arc = (r: number, a0: number, a1: number) => `M${pt(r, a0)} A${r} ${r} 0 0 0 ${pt(r, a1)}`
  // the squeezed card: 66 × 92 at (98, 34), peeled from its bottom-left corner along 35°
  const [x0, y0, w, h] = [98, 34, 66, 92]
  const nx = Math.cos((35 * Math.PI) / 180)
  const ny = Math.sin((35 * Math.PI) / 180)
  const cut = (s: number) => [`${x0} ${(y0 + h - s / ny).toFixed(1)}`, `${(x0 + s / nx).toFixed(1)} ${y0 + h}`]
  const [a1, b1] = cut(30)
  const [a2, b2] = cut(39)
  const [a3, b3] = cut(46)
  const along = (s: number) => [x0 + nx * s, y0 + h - ny * s]
  const [g0x, g0y] = along(30)
  const [g1x, g1y] = along(39)
  const [g2x, g2y] = along(46)
  return (
    <Scene from="#ecc56a" to="#2d0f3f">
      <defs>
        <clipPath id={`${u}rest`}>
          <path d={`M${a1} L${x0} ${y0} H${x0 + w} V${y0 + h} H${b1.split(' ')[0]}Z`} />
        </clipPath>
        <linearGradient id={`${u}lip`} gradientUnits="userSpaceOnUse" x1={g0x} y1={g0y} x2={g1x} y2={g1y}>
          <stop offset="0" stopColor="#8995a3" />
          <stop offset=".3" stopColor="#eef1f5" />
          <stop offset=".52" stopColor="#ffffff" />
          <stop offset=".8" stopColor="#dce2e9" />
          <stop offset="1" stopColor="#97a2ae" />
        </linearGradient>
        <linearGradient id={`${u}shade`} gradientUnits="userSpaceOnUse" x1={g1x} y1={g1y} x2={g2x} y2={g2y}>
          <stop offset="0" stopColor="#000" stopOpacity=".42" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${u}pl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f7cf6" stopOpacity=".28" />
          <stop offset="1" stopColor="#2f7cf6" stopOpacity=".5" />
        </linearGradient>
        <linearGradient id={`${u}bk`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e8344e" stopOpacity=".28" />
          <stop offset="1" stopColor="#e8344e" stopOpacity=".5" />
        </linearGradient>
      </defs>
      {/* the layout */}
      <path d={band(296, 361, -24, 24)} fill="#0b0716" opacity=".35" />
      <path d={band(301, 326, -22, -6.6)} fill="#fff" fillOpacity=".06" stroke="#f7c548" strokeOpacity=".7" strokeWidth="1.1" />
      <path d={band(301, 326, -6, 6)} fill="#22d36f" fillOpacity=".22" stroke="#f7c548" strokeOpacity=".7" strokeWidth="1.1" />
      <path d={band(301, 326, 6.6, 22)} fill="#fff" fillOpacity=".06" stroke="#f7c548" strokeOpacity=".7" strokeWidth="1.1" />
      <path d={band(330, 357, -22, -0.4)} fill={`url(#${u}pl)`} stroke="#f7c548" strokeOpacity=".8" strokeWidth="1.2" />
      <path d={band(330, 357, 0.4, 22)} fill={`url(#${u}bk)`} stroke="#f7c548" strokeOpacity=".8" strokeWidth="1.2" />
      <path id={`${u}tp`} d={arc(348, -22, -0.4)} fill="none" />
      <path id={`${u}tb`} d={arc(348, 0.4, 22)} fill="none" />
      <path id={`${u}tt`} d={arc(309, -6, 6)} fill="none" />
      <text fontSize="10.5" fontWeight="900" letterSpacing="2" fill="#cfe1ff" fontFamily="Manrope, system-ui, sans-serif">
        <textPath href={`#${u}tp`} startOffset="50%" textAnchor="middle">
          PLAYER
        </textPath>
      </text>
      <text fontSize="10.5" fontWeight="900" letterSpacing="2" fill="#ffd0d7" fontFamily="Manrope, system-ui, sans-serif">
        <textPath href={`#${u}tb`} startOffset="50%" textAnchor="middle">
          BANKER
        </textPath>
      </text>
      <text fontSize="8" fontWeight="900" letterSpacing="1.6" fill="#b6f7d2" fontFamily="Manrope, system-ui, sans-serif">
        <textPath href={`#${u}tt`} startOffset="50%" textAnchor="middle">
          TIE
        </textPath>
      </text>
      {/* chips on Banker, one on Player */}
      <Chip value={100} size={24} x={112} y={153} />
      <Chip value={500} size={24} x={112} y={148.5} />
      <Chip value={25} size={24} x={112} y={144} />
      <Chip value={10} size={21} x={68} y={154} />
      {/* a natural nine, face up */}
      <g transform="rotate(-11 70 80)" style={{ filter: 'drop-shadow(0 8px 10px rgba(0,0,0,.35))' }}>
        <CardFace rank="9" suit="♥" x={38} y={36} width={66} height={92} />
      </g>
      {/* the squeeze: the back peels from the corner to show the first pip */}
      <g transform="rotate(10 131 80)">
        <rect x={x0} y={y0} width={w} height={h} rx={6} fill="#000" opacity=".3" transform="translate(2 7)" />
        <CardFace rank="8" suit="♦" x={x0} y={y0} width={w} height={h} />
        <g clipPath={`url(#${u}rest)`}>
          <CardBack x={x0} y={y0} width={w} height={h} />
        </g>
        <path d={`M${a1} L${b1} L${b2} L${a2}Z`} fill={`url(#${u}lip)`} />
        <path d={`M${a2} L${b2} L${b3} L${a3}Z`} fill={`url(#${u}shade)`} />
      </g>
      <Sparkle x={182} y={30} r={4} />
      <Sparkle x={22} y={118} r={3} />
    </Scene>
  )
}

/** Case Battles: two players' reels face off over their open crates. The right reel has stopped on a grand diamond (the
 *  winner, crowned), the left on a copper coin; a vs badge sits between them. */
function BattlesCover() {
  const u = useUid()
  const cols: { x: number; avatar: number; tiles: ['ring' | 'bag', 'diamond' | 'copper', 'coins' | 'watch']; hit: string; tier: 'high' | 'extreme'; win: boolean }[] = [
    { x: 16, avatar: 2, tiles: ['bag', 'copper', 'watch'], hit: '#8d9fb4', tier: 'extreme', win: false },
    { x: 110, avatar: 9, tiles: ['ring', 'diamond', 'coins'], hit: '#ffc23d', tier: 'high', win: true },
  ]
  const W = 74
  const top = 52
  const H = 132
  const mid = top + H / 2
  return (
    <Scene from="#ff7a3d" to="#2a0d0a">
      <defs>
        <radialGradient id={`${u}g`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff1d6" stopOpacity=".9" />
          <stop offset=".4" stopColor="#ffb547" stopOpacity=".45" />
          <stop offset="1" stopColor="#ff7a3d" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b1621" />
          <stop offset=".24" stopColor="#0b1621" stopOpacity="0" />
          <stop offset=".76" stopColor="#0b1621" stopOpacity="0" />
          <stop offset="1" stopColor="#0b1621" />
        </linearGradient>
        {cols.map((c, i) => (
          <clipPath key={i} id={`${u}c${i}`}>
            <rect x={c.x} y={top} width={W} height={H} rx="12" />
          </clipPath>
        ))}
      </defs>
      {Array.from({ length: 9 }, (_, i) => (
        <path key={i} d="M100 250 L94 -40 L106 -40 Z" fill="#fff" opacity=".06" transform={`rotate(${(i - 4) * 16} 100 250)`} />
      ))}
      <ellipse cx="147" cy={mid} rx="70" ry="80" fill={`url(#${u}g)`} />
      {cols.map((c, i) => (
        <g key={i}>
          <rect x={c.x} y={top} width={W} height={H} rx="12" fill="#0b1621" opacity=".94" />
          <g clipPath={`url(#${u}c${i})`}>
            {c.tiles.map((k, j) => {
              const y = mid - 25 + (j - 1) * 56
              const hit = j === 1
              return (
                <g key={k} opacity={hit ? 1 : 0.55}>
                  <rect x={c.x + 8} y={y} width={W - 16} height={50} rx="7" fill="#15283a" stroke={hit ? c.hit : '#ffffff'} strokeOpacity={hit ? 1 : 0.08} strokeWidth={hit ? 2.2 : 1} />
                  {hit && <rect x={c.x + 8} y={y} width={W - 16} height={50} rx="7" fill={c.hit} opacity=".16" />}
                  <ItemArt kind={k} size={hit ? 40 : 34} x={c.x + W / 2 - (hit ? 20 : 17)} y={y + (hit ? 4 : 8)} />
                </g>
              )
            })}
            <rect x={c.x} y={top} width={W} height={H} fill={`url(#${u}f)`} />
          </g>
          {/* the marker notches */}
          <path d={`M${c.x} ${mid - 5}v10l7-5Z`} fill={c.hit} />
          <path d={`M${c.x + W} ${mid - 5}v10l-7-5Z`} fill={c.hit} />
          {/* the crate it came from, lid up */}
          <g style={{ filter: 'drop-shadow(0 6px 6px rgba(30,8,0,.45))' }}>
            <CrateArt tier={c.tier} part="body" size={62} x={c.x + W / 2 - 31} y={top + H + 2} />
          </g>
          <g transform={`translate(0 -7) rotate(${i ? 9 : -9} ${c.x + W / 2} ${top + H + 22})`}>
            <CrateArt tier={c.tier} part="lid" size={62} x={c.x + W / 2 - 31} y={top + H + 2} />
          </g>
          {/* the player */}
          <circle cx={c.x + W / 2} cy={top} r="15" fill={c.win ? '#ffc23d' : '#2b475c'} />
          <g transform={`translate(${c.x + W / 2 - 13} ${top - 13})`}>
            <Avatar index={c.avatar} size={26} />
          </g>
        </g>
      ))}
      {/* the winner's crown */}
      <g transform={`translate(${110 + W / 2 - 13} ${top - 40}) rotate(8 13 10)`} style={{ filter: 'drop-shadow(0 3px 3px rgba(40,10,0,.45))' }}>
        <path d="M2 20 1 6.5 7.5 12 13 2.5 18.5 12 25 6.5 24 20Z" fill="#f4b72f" stroke="#8a5705" strokeWidth="1.2" strokeLinejoin="round" />
        <rect x="1.6" y="18.4" width="22.8" height="4.4" rx="1.4" fill="#c98b12" stroke="#8a5705" strokeWidth="1" />
        <circle cx="13" cy="2.5" r="1.8" fill="#fff6cf" />
      </g>
      {/* vs */}
      <circle cx="100" cy={mid} r="16" fill="#0b1621" stroke="#ff7a3d" strokeWidth="2.5" />
      <text x="100" y={mid + 4.6} textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif" letterSpacing=".5">
        VS
      </text>
      <Sparkle x={188} y={78} r={4.5} />
      <Sparkle x={104} y={44} r={3.5} />
      <Sparkle x={194} y={160} r={3} />
    </Scene>
  )
}

const DERBY_COLORS = ['#ffd23f', '#5cc6ff', '#a984ff', '#ff86c8', '#46dd8c', '#ffa63d']

/** a rubber duck from the Duck Derby model, its waterline at (x, y) */
function CoverDuck({ lane, x, y, s, expr = 'happy', beak = 0, tilt = 0 }: { lane: number; x: number; y: number; s: number; expr?: Expr; beak?: number; tilt?: number }) {
  const u = useUid()
  return <g transform={`translate(${x} ${y}) rotate(${tilt}) scale(${s})`} dangerouslySetInnerHTML={{ __html: duckMarkup(lane, u, expr, beak) }} />
}

/** Duck Derby: the field charging down the river to the finish flag, Quackers riding a wave out in front. */
function DerbyCover() {
  const u = useUid()
  const DINK = '#26182f'
  return (
    <Scene from="#8fe1ff" to="#1477c4">
      <defs>
        <linearGradient id={`${u}w`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9aeaf8" />
          <stop offset=".45" stopColor="#4cc2e6" />
          <stop offset="1" stopColor="#1782c4" />
        </linearGradient>
        <radialGradient id={`${u}sun`}>
          <stop offset="0" stopColor="#fff6c2" stopOpacity=".9" />
          <stop offset="1" stopColor="#fff6c2" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${u}chk`} width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#fff" />
          <rect width="4" height="4" fill={DINK} />
          <rect x="4" y="4" width="4" height="4" fill={DINK} />
        </pattern>
      </defs>

      {/* a sleepy sun and a cloud */}
      <circle cx="160" cy="36" r="34" fill={`url(#${u}sun)`} />
      <circle cx="160" cy="36" r="15" fill="#ffe066" stroke="#f2a91d" strokeWidth="2" />
      <path d="M154 34 q2.5 2.5 5 0 M161 34 q2.5 2.5 5 0" stroke="#c9781a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M155.5 39.5 q4.5 4 9 0" stroke="#c9781a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <g fill="#fff">
        <circle cx="82" cy="44" r="9" />
        <circle cx="95" cy="38" r="12" />
        <circle cx="108" cy="45" r="8" />
        <rect x="75" y="44" width="40" height="8" rx="4" />
      </g>

      {/* race-day bunting in the six ducks' colours */}
      <path d="M-5 14 Q100 40 205 12" fill="none" stroke={DINK} strokeWidth="1.4" />
      {[0.1, 0.22, 0.34, 0.46, 0.58, 0.7, 0.82, 0.94].map((t, i) => {
        const x = (1 - t) * (1 - t) * -5 + 2 * (1 - t) * t * 100 + t * t * 205
        const y = (1 - t) * (1 - t) * 14 + 2 * (1 - t) * t * 40 + t * t * 12
        return <path key={t} d={`M${x - 6} ${y} L${x + 6} ${y} L${x} ${y + 13} Z`} fill={DERBY_COLORS[i % 6]} stroke={DINK} strokeWidth="1.3" strokeLinejoin="round" />
      })}

      {/* hills, trees and the far bank */}
      <path d="M-5 92 Q30 70 62 86 T130 80 T205 84 V112 H-5 Z" fill="#86cfae" />
      {[8, 30, 52, 76, 98, 122, 146, 170, 194].map((x, i) => (
        <circle key={x} cx={x} cy={96 + (i % 2) * 3} r={13 + (i % 3) * 2} fill={i % 2 ? '#4fb65a' : '#5cc463'} />
      ))}
      <rect x="-5" y="100" width="210" height="16" fill="#6fcd6a" />
      <rect x="-5" y="112" width="210" height="5" fill="#e3c78e" />

      {/* the finish post */}
      <rect x="164" y="56" width="4" height="58" rx="1.5" fill="#f2ead8" stroke={DINK} strokeWidth="1.8" />
      <path d="M168 58 Q177 55 188 59 V76 Q177 72 168 75 Z" fill={`url(#${u}chk)`} stroke={DINK} strokeWidth="1.8" strokeLinejoin="round" />

      {/* the river, its ripples and a lane rope */}
      <rect x="-5" y="116" width="210" height="140" fill={`url(#${u}w)`} />
      <g stroke="#fff" strokeLinecap="round" fill="none" opacity=".55" strokeWidth="2">
        <path d="M12 128 q6 -3 12 0 M150 126 q5 -3 10 0 M104 134 q6 -3 12 0 M30 170 q7 -3 14 0 M164 176 q7 -3 14 0 M10 214 q8 -4 16 0 M176 222 q8 -4 16 0" />
      </g>
      <path d="M-5 158 L205 150" stroke="#fff" strokeOpacity=".5" strokeWidth="1.5" />
      {[4, 30, 56, 82, 108, 134, 160, 186].map((x, i) => (
        <circle key={x} cx={x} cy={158 - (x + 5) * 0.038} r="3.2" fill={i % 2 ? '#fff' : '#ff4d61'} stroke={DINK} strokeWidth="1.2" />
      ))}

      {/* the chasers */}
      <path d="M8 142 l14 0 M2 148 l16 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      <CoverDuck lane={4} x={42} y={146} s={0.46} expr="grit" />
      <ellipse cx="42" cy="146.5" rx="25" ry="3" fill="none" stroke="#fff" strokeWidth="1.8" opacity=".85" />
      <path d="M118 140 l12 0 M114 146 l14 0" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".7" />
      <CoverDuck lane={5} x={150} y={145} s={0.42} expr="wow" beak={18} />
      <ellipse cx="150" cy="145.5" rx="23" ry="2.8" fill="none" stroke="#fff" strokeWidth="1.8" opacity=".85" />

      {/* Quackers charging through a splash */}
      <ellipse cx="94" cy="196" rx="62" ry="12" fill="#1f86c2" opacity=".35" />
      <g fill="#fff">
        {[
          [36, 186, -48, 5, 13],
          [46, 176, -30, 4.5, 12],
          [58, 172, -14, 3.6, 9],
          [146, 182, 36, 5, 14],
          [156, 190, 56, 4.5, 11],
          [136, 172, 18, 3.6, 9],
        ].map(([x, y, r, rx, ry], i) => (
          <ellipse key={i} cx={x} cy={y} rx={rx} ry={ry} transform={`rotate(${r} ${x} ${y})`} />
        ))}
      </g>
      <path d="M26 176 l-18 -3 M24 188 l-20 1 M30 198 l-16 5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" opacity=".75" />
      <CoverDuck lane={0} x={94} y={192} s={1} expr="joy" beak={22} tilt={-8} />
      {/* the foam hugging the front of the duck */}
      <path d="M34 192 C46 184 64 196 80 190 C96 184 112 196 128 189 C140 184 150 190 156 194 C146 204 120 206 94 205 C66 205 44 202 34 192 Z" fill="#fff" />
      <path d="M44 198 C70 204 120 204 146 197" stroke="#bfefff" strokeWidth="2" fill="none" strokeLinecap="round" />
      {[
        [162, 168, 3.2],
        [170, 182, 2.4],
        [152, 160, 2.2],
        [176, 170, 1.8],
        [22, 166, 2.6],
        [14, 178, 1.8],
        [30, 156, 1.6],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="#fff" />
      ))}
      <Sparkle x={186} y={98} r={4} />
      <Sparkle x={14} y={70} r={3.5} />
    </Scene>
  )
}

const DOUBLE_FACETS = bojeFacets(0.09)
const DOUBLE_SHADE = [0.98, 0.86, 0.7, 0.62, 0.76, 0.92]
// the tiles round the green zero, in the strip's order (src/games/double/rules.ts WHEEL)
const DOUBLE_ROW: [number, 'r' | 'k' | 'g'][] = [[15, 'r'], [31, 'k'], [16, 'r'], [32, 'k'], [0, 'g'], [1, 'r'], [17, 'k'], [2, 'r'], [18, 'k']]

/** Double: the strip coming to rest on the green zero under the gold marker, with chips riding on each colour. */
function DoubleCover() {
  // ids carry a '_': React's ids never do, so no other component's `${uid}x` can name one of these
  const u = useUid() + '_'
  const cy = 118
  const T = 38
  const P = 44
  const tile = (x: number, n: number, c: 'r' | 'k' | 'g', s: number) => (
    <g key={n}>
      <rect x={x - s / 2} y={cy - s / 2} width={s} height={s} rx={s * 0.21} fill={`url(#${u}${c})`} />
      <rect x={x - s / 2 + 4} y={cy - s / 2 + 4} width={s - 8} height={s - 8} rx={s * 0.14} fill="none" stroke="#fff" strokeOpacity={c === 'k' ? 0.12 : 0.24} strokeWidth="1.1" />
      {c !== 'g' && (
        <text x={x} y={cy + s * 0.13} textAnchor="middle" fontSize={s * 0.36} fontWeight="900" fill={c === 'k' ? '#dde6f0' : '#fff'} fontFamily="Manrope, system-ui, sans-serif">
          {n}
        </text>
      )}
    </g>
  )
  // a chip like art/Chip's, its sheen from this cover's own gradient
  const chip = (x: number, y: number, size: number, body: string, inset: string, label: string, k: string) => (
    <svg key={k} x={x} y={y} width={size} height={size} viewBox="0 0 64 64">
      <circle cx="32" cy="34.5" r="29" fill="rgba(0,0,0,.35)" />
      <circle cx="32" cy="32" r="29" fill={body} />
      {Array.from({ length: 6 }, (_, i) => (
        <rect key={i} x="28" y="3" width="8" height="9" rx="1.5" fill={inset} transform={`rotate(${i * 60} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="20.5" fill={body} stroke="rgba(0,0,0,.18)" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="17.5" fill="none" stroke={inset} strokeOpacity=".7" strokeWidth="1.4" strokeDasharray="3.2 2.6" />
      <circle cx="32" cy="32" r="29" fill={`url(#${u}sh)`} />
      <text x="32" y="32" dy=".36em" textAnchor="middle" fontFamily="Manrope, ui-sans-serif, system-ui, sans-serif" fontWeight="800" fontSize={label.length >= 3 ? 15 : 18} fill="#fff">
        {label}
      </text>
    </svg>
  )
  return (
    <Scene from="#ff4d6a" to="#24061a">
      <defs>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2=".55" y2="1">
          <stop offset="0" stopColor="#ff7487" />
          <stop offset=".5" stopColor="#f2384f" />
          <stop offset="1" stopColor="#b5163a" />
        </linearGradient>
        <linearGradient id={`${u}k`} x1="0" y1="0" x2=".55" y2="1">
          <stop offset="0" stopColor="#4a586f" />
          <stop offset=".5" stopColor="#2a3445" />
          <stop offset="1" stopColor="#141a25" />
        </linearGradient>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2=".55" y2="1">
          <stop offset="0" stopColor="#7affba" />
          <stop offset=".46" stopColor="#22d36f" />
          <stop offset="1" stopColor="#0a8c46" />
        </linearGradient>
        <radialGradient id={`${u}glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#e2ffee" stopOpacity=".95" />
          <stop offset=".38" stopColor="#3ef08e" stopOpacity=".5" />
          <stop offset="1" stopColor="#22d36f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${u}fade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#090d15" stopOpacity=".95" />
          <stop offset=".24" stopColor="#090d15" stopOpacity="0" />
          <stop offset=".76" stopColor="#090d15" stopOpacity="0" />
          <stop offset="1" stopColor="#090d15" stopOpacity=".95" />
        </linearGradient>
        <radialGradient id={`${u}sh`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".6" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <clipPath id={`${u}c`}>
          <rect x="-30" y={cy - 31} width="260" height="62" rx="14" />
        </clipPath>
      </defs>
      {Array.from({ length: 12 }, (_, i) => (
        <path key={i} d={`M100 ${cy} L95 -80 L105 -80 Z`} fill="#fff" opacity=".055" transform={`rotate(${i * 30 + 8} 100 ${cy})`} />
      ))}
      <ellipse cx="100" cy={cy} rx="92" ry="78" fill={`url(#${u}glow)`} />
      <g transform={`rotate(-9 100 ${cy})`}>
        {/* the strip */}
        <rect x="-30" y={cy - 31} width="260" height="62" rx="14" fill="#090d15" opacity=".94" />
        <g clipPath={`url(#${u}c)`}>
          {DOUBLE_ROW.map(([n, c], i) => (c === 'g' ? null : tile(100 + (i - 4) * P, n, c, T)))}
          <rect x="-30" y={cy - 31} width="260" height="62" fill={`url(#${u}fade)`} />
        </g>
        <rect x="-30" y={cy - 31} width="260" height="62" rx="14" fill="none" stroke="#fff" strokeOpacity=".08" />
        {/* the winner: the green zero, lifted and lit, carrying the Boje gem */}
        <g style={{ filter: 'drop-shadow(0 0 9px rgba(62,240,142,.85))' }}>
          {tile(100, 0, 'g', 52)}
          <rect x={74} y={cy - 26} width="52" height="52" rx="11" fill="none" stroke="#fff" strokeWidth="2.4" />
        </g>
        <g transform={`translate(${100 - 16} ${cy - 16})`}>
          {DOUBLE_FACETS.map((d, i) => (
            <path key={`s${i}`} d={d} fill="#06612f" opacity=".45" transform="translate(0 1.6)" />
          ))}
          {DOUBLE_FACETS.map((d, i) => (
            <path key={i} d={d} fill="#fff" opacity={DOUBLE_SHADE[i]} />
          ))}
        </g>
        {/* the marker */}
        <g style={{ filter: 'drop-shadow(0 0 4px rgba(247,197,72,.8))' }}>
          <rect x="98.7" y={cy - 40} width="2.6" height="80" rx="1.3" fill="#f7c548" />
          <path d={`M91 ${cy - 43}h18l-9 10Z`} fill="#f7c548" />
          <path d={`M91 ${cy + 43}h18l-9-10Z`} fill="#f7c548" />
        </g>
      </g>
      {/* what green pays */}
      <g transform="rotate(-9 100 46)" style={{ filter: 'drop-shadow(0 5px 6px rgba(40,0,15,.45))' }}>
        <rect x="69" y="31" width="62" height="28" rx="14" fill="#f7c548" />
        <rect x="76" y="33.5" width="48" height="9" rx="4.5" fill="#fff" opacity=".24" />
        <text x="100" y="51" textAnchor="middle" fontSize="17" fontWeight="900" fill="#2a1c00" fontFamily="Manrope, system-ui, sans-serif" letterSpacing=".3">
          32×
        </text>
      </g>
      {/* chips riding on red, green and black */}
      <g style={{ filter: 'drop-shadow(0 6px 6px rgba(30,0,10,.45))' }}>
        {[186, 178, 170].map((y, i) => chip(22, y, 42, '#e8344e', '#ffe5e9', '5', `r${i}`))}
        {[186, 178].map((y, i) => chip(136, y, 42, '#26313f', '#f7c548', '100', `k${i}`))}
        {[192, 183].map((y, i) => chip(75, y, 50, '#1fb866', '#e6fff1', '25', `g${i}`))}
      </g>
      <Sparkle x={150} y={70} r={6} />
      <Sparkle x={42} y={78} r={4} />
      <Sparkle x={178} y={152} r={3.5} />
      <Sparkle x={26} y={154} r={3} />
    </Scene>
  )
}

/** A pastel blob plushie for the Lucky Claw heap: round body, ears (round or bunny) and a little face. */
function CoverBlob({ x, y, r, color, ears = 'round', tilt = 0 }: { x: number; y: number; r: number; color: string; ears?: 'round' | 'bunny' | 'none'; tilt?: number }) {
  const e = r * 0.36
  return (
    <g transform={`translate(${x} ${y}) rotate(${tilt})`} stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
      {ears === 'round' && [-1, 1].map((s) => <circle key={s} cx={s * r * 0.7} cy={-r * 0.72} r={e} fill={color} />)}
      {ears === 'bunny' && [-1, 1].map((s) => <ellipse key={s} cx={s * r * 0.36} cy={-r * 1.12} rx={e * 0.62} ry={r * 0.55} fill={color} transform={`rotate(${s * 12} ${s * r * 0.36} ${-r * 1.12})`} />)}
      <ellipse rx={r} ry={r * 0.9} fill={color} />
      <ellipse cy={r * 0.3} rx={r * 0.5} ry={r * 0.36} fill="#fff" opacity=".45" stroke="none" />
      <circle cx={-r * 0.34} cy={-r * 0.1} r={r * 0.11} fill={INK} stroke="none" />
      <circle cx={r * 0.34} cy={-r * 0.1} r={r * 0.11} fill={INK} stroke="none" />
      <path d={`M${-r * 0.16} ${r * 0.12} q${r * 0.16} ${r * 0.16} ${r * 0.32} 0`} fill="none" strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx={-r * 0.6} cy={r * 0.12} rx={r * 0.16} ry={r * 0.09} fill="#ff8fb5" stroke="none" opacity=".8" />
      <ellipse cx={r * 0.6} cy={r * 0.12} rx={r * 0.16} ry={r * 0.09} fill="#ff8fb5" stroke="none" opacity=".8" />
    </g>
  )
}

/** Lucky Claw: the golden unicorn, the 100× prize, swinging up out of the heap in the claw, under the marquee lights. */
function ClawCover() {
  const u = useUid()
  const mane = ['#ff5f8f', '#ff9a3c', '#ffe04a', '#5fe08c', '#4fb8ff', '#a77dff']
  const heap: [number, number, number, string, 'round' | 'bunny' | 'none', number][] = [
    [18, 214, 24, '#a8e6ff', 'round', -12],
    [60, 226, 22, '#ffe08a', 'bunny', 8],
    [104, 220, 25, '#c9b8ff', 'round', -4],
    [150, 228, 23, '#b8f2c8', 'none', 10],
    [190, 212, 24, '#ffb3d1', 'round', 14],
    [-2, 246, 22, '#ffc8a8', 'none', 0],
    [40, 252, 24, '#ffb3d1', 'round', -8],
    [86, 252, 23, '#a8e6ff', 'none', 6],
    [130, 254, 24, '#ffe08a', 'round', -10],
    [174, 250, 25, '#c9b8ff', 'bunny', 4],
  ]
  // a prong, from the hub out to its knuckle and down to the hooked tip (mirrored for the right one)
  const prong = (s: number) => `M${100 + s * 15} 35 L${100 + s * 40} 66 Q${100 + s * 45} 94 ${100 + s * 33} 116 Q${100 + s * 28} 124 ${100 + s * 21} 124`
  return (
    <Scene from="#ff73b4" to="#4a1fb8">
      <defs>
        <linearGradient id={`${u}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe48a" />
          <stop offset=".55" stopColor="#ffc72e" />
          <stop offset="1" stopColor="#f29a12" />
        </linearGradient>
        <radialGradient id={`${u}h`} cx=".38" cy=".32" r=".8">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset=".55" stopColor="#ffd040" />
          <stop offset="1" stopColor="#f0a020" />
        </radialGradient>
        <linearGradient id={`${u}c`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b8c4dc" />
        </linearGradient>
        <linearGradient id={`${u}r`} x1="0" y1="0" x2="1" y2="0">
          {mane.map((c, i) => (
            <stop key={c} offset={i / (mane.length - 1)} stopColor={c} />
          ))}
        </linearGradient>
        <radialGradient id={`${u}l`}>
          <stop offset="0" stopColor="#fff6c8" stopOpacity=".95" />
          <stop offset=".45" stopColor="#ffd86b" stopOpacity=".35" />
          <stop offset="1" stopColor="#ffd86b" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* light rays behind the prize */}
      <g opacity=".22" fill="#fff">
        {Array.from({ length: 12 }, (_, i) => (
          <path key={i} d="M100 112 L92 -40 L108 -40 Z" transform={`rotate(${i * 30} 100 112)`} />
        ))}
      </g>
      <circle cx="100" cy="112" r="74" fill={`url(#${u}l)`} />

      {/* the marquee lights along the top */}
      <rect x="-5" y="-4" width="210" height="18" fill="#2a1666" />
      <rect x="-5" y="12" width="210" height="4" fill="#ffcf4d" />
      {Array.from({ length: 11 }, (_, i) => (
        <g key={i}>
          <circle cx={6 + i * 19} cy="5" r={i % 2 ? 4.2 : 5} fill={i % 2 ? '#ff7ac8' : '#fff1a8'} opacity=".55" />
          <circle cx={6 + i * 19} cy="5" r={i % 2 ? 2.6 : 3.2} fill={i % 2 ? '#ffd1ec' : '#ffffff'} />
        </g>
      ))}

      {/* the heap */}
      {heap.map(([x, y, r, c, e, t], i) => (
        <CoverBlob key={i} x={x} y={y} r={r} color={c} ears={e} tilt={t} />
      ))}

      {/* the cable, and the back prong half hidden behind her head */}
      <path d="M100 14 V24" stroke={INK} strokeWidth="5" />
      <path d="M100 14 V24" stroke="#6a7090" strokeWidth="2" />
      <path d="M100 36 V74" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <path d="M100 36 V74" stroke={`url(#${u}c)`} strokeWidth="4.5" strokeLinecap="round" />

      {/* motion lines: it is swinging */}
      <g stroke="#fff" strokeWidth="2.6" strokeLinecap="round" fill="none" opacity=".85">
        <path d="M40 104 q-7 12 0 24" />
        <path d="M30 98 q-9 18 0 36" opacity=".6" />
        <path d="M160 104 q7 12 0 24" />
        <path d="M170 98 q9 18 0 36" opacity=".6" />
      </g>

      {/* Goldie: her mane flowing to one side and her rainbow tail behind, then body, dangling legs and head */}
      <g stroke={INK} strokeWidth="3" strokeLinejoin="round">
        {[
          [74, 80, 10, 0],
          [66, 94, 10, 1],
          [66, 109, 9.5, 2],
          [71, 123, 9, 3],
          [128, 78, 8.5, 5],
          [134, 154, 8.5, 4],
          [141, 165, 8, 5],
          [143, 177, 7.5, 0],
        ].map(([x, y, r, c], i) => (
          <circle key={i} cx={x} cy={y} r={r} fill={mane[c]} />
        ))}
        <path d="M84 150 Q82 166 80 174" fill="none" strokeWidth="12" strokeLinecap="round" />
        <path d="M116 150 Q118 166 120 174" fill="none" strokeWidth="12" strokeLinecap="round" />
        <path d="M84 150 Q82 166 80 174" fill="none" stroke="#ffc72e" strokeWidth="6.5" strokeLinecap="round" />
        <path d="M116 150 Q118 166 120 174" fill="none" stroke="#ffc72e" strokeWidth="6.5" strokeLinecap="round" />
        <ellipse cx="80" cy="176" rx="6.5" ry="4.5" fill="#ff8fc4" strokeWidth="2.5" />
        <ellipse cx="120" cy="176" rx="6.5" ry="4.5" fill="#ff8fc4" strokeWidth="2.5" />
        <ellipse cx="100" cy="142" rx="26" ry="21" fill={`url(#${u}g)`} />
        <ellipse cx="100" cy="146" rx="15" ry="12" fill="#fff4d9" strokeWidth="0" />
        <path d="M76 132 Q66 140 68 150" fill="none" strokeWidth="11" strokeLinecap="round" />
        <path d="M124 132 Q134 140 132 150" fill="none" strokeWidth="11" strokeLinecap="round" />
        <path d="M76 132 Q66 140 68 150" fill="none" stroke="#ffc72e" strokeWidth="6" strokeLinecap="round" />
        <path d="M124 132 Q134 140 132 150" fill="none" stroke="#ffc72e" strokeWidth="6" strokeLinecap="round" />
        <path d="M84 78 L78 56 L96 70 Z" fill="#ffc72e" />
        <path d="M116 78 L122 56 L104 70 Z" fill="#ffc72e" />
        <path d="M85 72 L81.5 61 L90 68 Z M115 72 L118.5 61 L110 68 Z" fill="#ff9fd0" strokeWidth="1.6" />
        <circle cx="100" cy="100" r="31" fill={`url(#${u}h)`} />
        <ellipse cx="100" cy="113" rx="18" ry="12.5" fill="#fff4d9" />
        {/* the forelock over her brow */}
        <circle cx="86" cy="75" r="7.5" fill={mane[0]} strokeWidth="2.5" />
        <circle cx="96" cy="71" r="6.5" fill={mane[5]} strokeWidth="2.5" />
      </g>
      <ellipse cx="91" cy="91" rx="10" ry="6" fill="#fff" opacity=".45" transform="rotate(-30 91 91)" />
      <ellipse cx="88" cy="99" rx="4.6" ry="5.8" fill={INK} />
      <ellipse cx="112" cy="99" rx="4.6" ry="5.8" fill={INK} />
      <circle cx="86.6" cy="97" r="1.8" fill="#fff" />
      <circle cx="110.6" cy="97" r="1.8" fill="#fff" />
      <path d="M83 93 l-3 -3 M86 92 l-1.5 -3.4 M117 93 l3 -3 M114 92 l1.5 -3.4" stroke={INK} strokeWidth="1.8" strokeLinecap="round" />
      <ellipse cx="78" cy="108" rx="5.5" ry="3.2" fill="#ff8fb5" opacity=".85" />
      <ellipse cx="122" cy="108" rx="5.5" ry="3.2" fill="#ff8fb5" opacity=".85" />
      <circle cx="94" cy="111" r="1.6" fill="#d9925a" />
      <circle cx="106" cy="111" r="1.6" fill="#d9925a" />
      <path d="M94 117 q6 5 12 0" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />

      {/* the tag on her tummy */}
      <path d="M88 128 L100 136 L112 128" fill="none" stroke="#ff4f7b" strokeWidth="2" />
      <g transform="translate(100 146) rotate(-6)">
        <rect x="-21" y="-10" width="42" height="20" rx="10" fill={`url(#${u}g)`} stroke={INK} strokeWidth="2.8" />
        <rect x="-17" y="-6.5" width="34" height="13" rx="6.5" fill="none" stroke={`url(#${u}r)`} strokeWidth="1.6" />
        <text y="4.6" textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" stroke={INK} strokeWidth="3.4" paintOrder="stroke" fontFamily="Manrope, system-ui, sans-serif">
          100×
        </text>
      </g>

      {/* the front prongs hug her head */}
      {[-1, 1].map((s) => (
        <g key={s}>
          <path d={prong(s)} fill="none" stroke={INK} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          <path d={prong(s)} fill="none" stroke={`url(#${u}c)`} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={100 + s * 40} cy="66" r="6" fill="#ffcf4d" stroke={INK} strokeWidth="2.5" />
          <circle cx={100 + s * 21} cy="124" r="4.6" fill="#ff5f9e" stroke={INK} strokeWidth="2.5" />
        </g>
      ))}
      <g stroke={INK} strokeWidth="3" strokeLinejoin="round">
        <rect x="80" y="21" width="40" height="17" rx="8.5" fill="#ffcf4d" />
        <rect x="80" y="28" width="40" height="6" fill="#ff5f9e" strokeWidth="2.2" />
      </g>
      <circle cx="88" cy="26" r="1.6" fill="#fff" />
      {/* her horn, pearly with a gold spiral, pointing up in front of the hub */}
      <g stroke={INK} strokeWidth="3" strokeLinejoin="round">
        <path d="M93.5 73 L103 36 L110 73 Z" fill="#fff8e8" />
      </g>
      <path d="M96 64.5 L107.5 61.5 M98 56 L106 53.5 M100 47.5 L104.8 45.8" stroke="#f2a516" strokeWidth="2.4" fill="none" strokeLinecap="round" />

      {/* glass glints and sparkles */}
      <path d="M150 20 L196 20 L120 250 L74 250 Z" fill="#fff" opacity=".06" />
      <path d="M200 60 L208 60 L150 250 L142 250 Z" fill="#fff" opacity=".08" />
      <Sparkle x={150} y={56} r={6} />
      <Sparkle x={44} y={62} r={4.5} />
      <Sparkle x={162} y={150} r={4} />
      <Sparkle x={32} y={160} r={3.5} />
      <Sparkle x={128} y={34} r={3} />
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
