import { useEffect, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CATEGORIES, GAMES, type Category, type GameId } from '../store/games'
import { navigate } from '../lib/router'
import { GameCover, HeroRoad } from '../components/covers'
import { DAILY_COOLDOWN, dailyReward, levelFromXp, tierOf, useWallet } from '../store/wallet'
import { Coin, IconChart, IconChevron, IconFire, IconGift, IconStar, IconTrophy } from '../components/icons'
import { fmt, fmtDuration } from '../lib/format'
import { BetsTable } from './History'
import { useNow } from '../lib/useNow'
import { useUid } from '../art/ids'
import { Rocket } from '../art/Rocket'
import { useAuth } from '../store/auth'
import { VaultDoor } from '../art/Vault'
import { Avatar } from '../art/Avatar'
import { CardBack, CardFace } from '../art/Card'
import { Chip } from '../art/Chip'
import type { Suit } from '../art/suits'

export default function Lobby() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <Hero />
        <DailyCard />
      </div>
      <GuestStrip />
      <GameGrid />
      <StatsStrip />
      <section>
        <SectionTitle icon={<IconChart size={18} />}>Your recent bets</SectionTitle>
        <BetsTable limit={8} />
      </section>
    </div>
  )
}

function SectionTitle({ children, icon, right }: { children: ReactNode; icon?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-[17px] font-extrabold tracking-tight">
        {icon && <span className="text-muted">{icon}</span>}
        {children}
      </h2>
      {right}
    </div>
  )
}

/* ------------------------------ hero ------------------------------ */

interface Slide {
  key: string
  eyebrow: string
  tone: string
  title: ReactNode
  text: string
  cta: string
  to: string
  bg: string
  art: ReactNode
}

const SLIDES: Slide[] = [
  {
    key: 'chicken',
    eyebrow: 'Featured',
    tone: 'text-gold bg-gold/15',
    title: (
      <>
        Why did the chicken
        <br />
        cross the road?
      </>
    ),
    text: 'Every lane pays more. One car ends the run.',
    cta: 'Play Chicken Road',
    to: '/game/chicken',
    bg: 'linear-gradient(110deg,#13283a 0%,#0f2131 55%,#1b2a37 100%)',
    art: <HeroRoad />,
  },
  {
    key: 'crash',
    eyebrow: 'Multiplayer',
    tone: 'text-[#c9b8ff] bg-violet/20',
    title: (
      <>
        One rocket.
        <br />
        Everyone on board.
      </>
    ),
    text: 'Bet together, watch the same flight, cash out before it blows.',
    cta: 'Join Crash',
    to: '/game/crash',
    bg: 'linear-gradient(110deg,#171338 0%,#1d1650 55%,#2b1f6e 100%)',
    art: <HeroCrash />,
  },
  {
    key: 'popparty',
    eyebrow: 'New slot',
    tone: 'text-[#ff4fb8] bg-[#ff4fb8]/15',
    title: (
      <>
        Pop the
        <br />
        Party
      </>
    ),
    text: 'Balloon animals pop on a light-up floor. Every pop lights a tile, and in Disco Night the tiles stay lit and double up to ×128.',
    cta: 'Play Pop Party',
    to: '/game/popparty',
    bg: 'linear-gradient(110deg,#251236 0%,#3a1748 55%,#552058 100%)',
    art: <HeroFan ids={['chompers', 'roboriot', 'popparty', 'videopoker', 'mines']} />,
  },
  {
    key: 'livebj',
    eyebrow: 'Multiplayer',
    tone: 'text-[#f7c548] bg-[#f2a93b]/15',
    title: (
      <>
        Pull up a seat.
        <br />
        Play together.
      </>
    ),
    text: 'Real players share one shoe at live blackjack tables. Bet together and watch every card land at the same moment.',
    cta: 'Join a table',
    to: '/game/livebj',
    bg: 'linear-gradient(110deg,#0b241d 0%,#0e3027 55%,#2a2812 100%)',
    art: <HeroLiveTable />,
  },
  {
    key: 'roboriot',
    eyebrow: 'New slot',
    tone: 'text-[#5cf2ff] bg-[#5cf2ff]/15',
    title: (
      <>
        Charge the
        <br />
        Power Grid
      </>
    ),
    text: 'Toy robots charge the Power Grid: zappers double cells, boosters pump them all, magnets grab the lot. A full grid pays double.',
    cta: 'Play Robo Riot',
    to: '/game/roboriot',
    bg: 'linear-gradient(110deg,#0b0d30 0%,#141850 55%,#2a1260 100%)',
    art: <HeroRobo />,
  },
  {
    key: 'heist',
    eyebrow: 'Free coins',
    tone: 'text-gold bg-gold/15',
    title: (
      <>
        Crack the vault.
        <br />
        Keep the gold.
      </>
    ),
    text: 'A skill game that pays coins. Go deeper for more, up to 650 a run.',
    cta: 'Play Vault Heist',
    to: '/heist',
    bg: 'linear-gradient(110deg,#191a14 0%,#1f1d12 55%,#2d2611 100%)',
    art: <HeroVault />,
  },
  {
    key: 'chompers',
    eyebrow: 'New: Feast Pick',
    tone: 'text-[#2ee87f] bg-[#2ee87f]/15',
    title: (
      <>
        Feed the
        <br />
        Chompers
      </>
    ),
    text: "Monsters gobble every donut on the reels. Big Mama's Feast Pick cracks open free spins with a treat.",
    cta: 'Play Chompers',
    to: '/game/chompers',
    bg: 'linear-gradient(110deg,#170b31 0%,#241050 55%,#33166a 100%)',
    art: <HeroFan ids={['blackjack', 'popparty', 'chompers', 'roboriot', 'mines']} />,
  },
]

function Hero() {
  const [i, setI] = useState(0)
  const [hover, setHover] = useState(false)
  useEffect(() => {
    if (hover) return
    const t = setTimeout(() => setI((x) => (x + 1) % SLIDES.length), 7000)
    return () => clearTimeout(t)
  }, [i, hover])
  const s = SLIDES[i]
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="relative min-h-[280px] overflow-hidden rounded-2xl shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] sm:min-h-[300px]"
    >
      {/* every slide's picture stays mounted and the active one fades in, so changing slides only fades layers the
          GPU already has; mounting the art fresh each time redrew the shadowed covers and stalled a frame */}
      {SLIDES.map((x, j) => (
        <div
          key={x.key}
          aria-hidden={j !== i}
          className={`absolute inset-0 transition-opacity duration-500 will-change-[opacity] ${j === i ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          style={{ background: x.bg }}
        >
          <div className={`absolute inset-0 ${j === i ? 'hero-art-in' : ''}`}>{x.art}</div>
        </div>
      ))}
      <AnimatePresence initial={false}>
        <motion.div key={s.key} className="absolute inset-0 z-10" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <div className="relative flex h-full max-w-[460px] flex-col justify-center px-6 pb-12 pt-6 sm:px-8 sm:pb-12 sm:pt-8">
            <motion.span
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={`inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider ${s.tone}`}
            >
              {s.eyebrow}
            </motion.span>
            <motion.h1 initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mt-3 text-[28px] font-black leading-[1.06] tracking-tight sm:text-[38px]">
              {s.title}
            </motion.h1>
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25 }} className="mt-2 max-w-[380px] text-[14px] text-muted">
              {s.text}
            </motion.p>
            <motion.button
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              onClick={() => navigate(s.to)}
              className="mt-5 inline-flex h-12 w-fit shrink-0 items-center gap-2 rounded-lg bg-accent px-6 text-[15px] font-extrabold text-[#032412] shadow-[0_10px_28px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110"
            >
              {s.cta} <IconChevron size={18} />
            </motion.button>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-4 left-6 z-20 flex gap-1.5 sm:left-8">
        {SLIDES.map((x, j) => (
          <button key={x.key} onClick={() => setI(j)} aria-label={`Slide ${j + 1}`} className="h-2 rounded-full bg-white/25 transition-all hover:bg-white/50" style={{ width: j === i ? 26 : 8, background: j === i ? '#fff' : undefined }} />
        ))}
      </div>
    </div>
  )
}

// the hero's star field; it twinkles in four groups, each its own little svg that fades as a whole, so the
// browser can run the fade on the GPU instead of repainting the whole banner every frame
const STARS = Array.from({ length: 40 }, (_, i) => ({ cx: (i * 97) % 400, cy: (i * 53) % 230, r: i % 4 ? 0.9 : 1.6 }))

function HeroCrash() {
  const u = useUid()
  const pts: string[] = []
  for (let x = 0; x <= 300; x += 4) pts.push(`${40 + x},${(250 - (Math.exp(x / 95) - 1) * 9.6).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[58%] sm:block [mask-image:linear-gradient(to_right,transparent,black_22%)]">
      {[0, 1, 2, 3].map((g) => (
        <svg key={g} className="twinkle absolute inset-0 h-full w-full" style={{ animationDelay: `${g * 0.6}s` }} viewBox="0 0 400 270" preserveAspectRatio="xMaxYMid slice" aria-hidden>
          {STARS.filter((_, i) => i % 4 === g).map((st, i) => (
            <circle key={i} {...st} fill="#fff" opacity=".7" />
          ))}
        </svg>
      ))}
      <svg className="relative h-full w-full" viewBox="0 0 400 270" preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs>
          <linearGradient id={`${u}s`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8f74ff" />
            <stop offset="1" stopColor="#ff6fae" />
          </linearGradient>
          <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff6fae" stopOpacity=".35" />
            <stop offset="1" stopColor="#ff6fae" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${line} L340 250 Z`} fill={`url(#${u}f)`} />
        <path d={line} fill="none" stroke={`url(#${u}s)`} strokeWidth="5" strokeLinecap="round" />
        <g transform="translate(340 63) rotate(-58)">
          <Rocket width={96} x={-96 * 0.29} y={-96 * 0.2} flicker={false} />
        </g>
        <text x="236" y="120" fontSize="34" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif">
          12.48×
        </text>
      </svg>
    </div>
  )
}

/* Live Blackjack's table, dealer at the top: five players on the rail, each with a stake and a hand on the felt, and
   your turn up. The players sit at the right, clear of the slide's text; the felt runs on to the left under the fade. */
const TABLE = { x: 272, y: -40, rx: 230, ry: 250 }
interface HeroSeat {
  x: number
  avatar: number
  name: string
  chip: number
  cards: [string, Suit][]
  score?: string
  chat?: string
  me?: boolean
}
const HERO_SEATS: HeroSeat[] = [
  { x: 164, avatar: 3, name: 'Mia', chip: 25, cards: [['9', '♣'], ['7', '♦']], chat: 'Nice hand!' },
  { x: 218, avatar: 9, name: 'Leo', chip: 100, cards: [['A', '♥'], ['K', '♠']], score: 'BJ' },
  { x: 272, avatar: 0, name: 'You', chip: 10, cards: [['10', '♠'], ['9', '♥']], score: '19', me: true },
  { x: 326, avatar: 10, name: 'Ava', chip: 5, cards: [['Q', '♦'], ['6', '♣']] },
  { x: 380, avatar: 14, name: 'Sam', chip: 500, cards: [['8', '♠'], ['8', '♥']] },
]
const LIVE_SEATS = HERO_SEATS.map((s) => {
  // each seat on the rim; its stake and hand lie inward on the felt, fanned a little towards the dealer
  const y = TABLE.y + TABLE.ry * Math.sqrt(1 - ((s.x - TABLE.x) / TABLE.rx) ** 2)
  const dx = TABLE.x - s.x
  const dy = -200 - y
  const n = Math.hypot(dx, dy)
  const at = (d: number) => [s.x + (dx / n) * d, y + (dy / n) * d].map((v) => +v.toFixed(1))
  const [chipX, chipY] = at(30)
  const [hx, hy] = at(66)
  return { ...s, y: +y.toFixed(1), chipX, chipY, hx, hy, tilt: +((Math.atan2(dx, -dy) * 180 * 0.8) / Math.PI).toFixed(1) }
})
const HERO_FONT = 'Manrope, system-ui, sans-serif'
const TURN_RING = 2 * Math.PI * 19

function HeroLiveTable() {
  const u = useUid()
  const { x: tx, y: ty, rx, ry } = TABLE
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[60%] sm:block [mask-image:linear-gradient(to_right,transparent,black_40%)]">
      <svg className="h-full w-full" viewBox="0 12 400 246" preserveAspectRatio="xMaxYMid meet" overflow="visible" aria-hidden>
        <defs>
          <radialGradient id={`${u}f`} cx=".5" cy=".42" r=".62">
            <stop offset="0" stopColor="#1f7a5c" />
            <stop offset=".6" stopColor="#125240" />
            <stop offset="1" stopColor="#0a3027" />
          </radialGradient>
          <radialGradient id={`${u}w`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#f2a93b" stopOpacity=".26" />
            <stop offset="1" stopColor="#f2a93b" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${u}t`} cx=".5" cy=".5" r=".5">
            <stop offset=".5" stopColor="#22d36f" stopOpacity=".5" />
            <stop offset="1" stopColor="#22d36f" stopOpacity="0" />
          </radialGradient>
          <path id={`${u}a`} d={`M${tx - 55} 83 A110 142 0 0 0 ${tx + 55} 83`} />
        </defs>
        <ellipse cx="290" cy="165" rx="210" ry="140" fill={`url(#${u}w)`} />

        {/* the table: a dark rail, the felt with its gold rim, the betting line and the payout */}
        <ellipse cx={tx} cy={ty} rx={rx + 8} ry={ry + 8} fill="none" stroke="#04110d" strokeOpacity=".55" strokeWidth="12" />
        <ellipse cx={tx} cy={ty} rx={rx} ry={ry} fill={`url(#${u}f)`} stroke="#f7c548" strokeOpacity=".75" strokeWidth="2.5" />
        <ellipse cx={tx} cy={ty} rx="190" ry="214" fill="none" stroke="#f7c548" strokeOpacity=".35" strokeWidth="1.5" />
        <ellipse cx={tx} cy={ty} rx="176" ry="200" fill="none" stroke="#fff" strokeOpacity=".12" strokeWidth="1.2" strokeDasharray="5 5" />
        <text fontSize="7" fontWeight="800" letterSpacing="1.6" fill="#f7c548" fillOpacity=".6" fontFamily={HERO_FONT}>
          <textPath href={`#${u}a`} startOffset="50%" textAnchor="middle">
            BLACKJACK PAYS 3 TO 2
          </textPath>
        </text>

        {/* cards and chips share one shadow */}
        <g style={{ filter: 'drop-shadow(0 4px 5px rgba(0,0,0,.4))' }}>
          <g transform={`rotate(-6 ${tx - 10} 50)`}>
            <CardFace rank="K" suit="♥" x={tx - 34} y={22} width={40} height={56} />
          </g>
          <g transform={`rotate(6 ${tx + 18} 50)`}>
            <CardBack x={tx - 4} y={24} width={40} height={56} />
          </g>
          {LIVE_SEATS.map((s) => (
            <g key={s.name}>
              <Chip value={s.chip} size={17} x={s.chipX - 8.5} y={s.chipY - 8.5} />
              <g transform={`rotate(${s.tilt} ${s.hx} ${s.hy})`}>
                <CardFace rank={s.cards[0][0]} suit={s.cards[0][1]} x={s.hx - 16} y={s.hy - 15} width={24} height={34} />
                <CardFace rank={s.cards[1][0]} suit={s.cards[1][1]} x={s.hx - 8} y={s.hy - 19} width={24} height={34} />
              </g>
            </g>
          ))}
        </g>

        {LIVE_SEATS.map((s) => (
          <g key={s.name}>
            {s.me && <circle cx={s.x} cy={s.y} r="29" fill={`url(#${u}t)`} />}
            <circle cx={s.x} cy={s.y} r="16.5" fill="#08251f" stroke={s.me ? '#22d36f' : '#f7c548'} strokeOpacity={s.me ? 0.3 : 0.55} strokeWidth="1.5" />
            {/* your decision clock */}
            {s.me && (
              <circle
                cx={s.x}
                cy={s.y}
                r="19"
                fill="none"
                stroke="#22d36f"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeDasharray={`${(TURN_RING * 0.72).toFixed(1)} ${TURN_RING.toFixed(1)}`}
                transform={`rotate(-90 ${s.x} ${s.y.toFixed(1)})`}
              />
            )}
            <g transform={`translate(${s.x - 13} ${(s.y - 13).toFixed(1)})`}>
              <Avatar index={s.avatar} size={26} />
            </g>
            <rect x={s.x - 15} y={s.y + 20} width="30" height="13" rx="6.5" fill={s.me ? '#22d36f' : '#071a14'} fillOpacity={s.me ? 1 : 0.85} />
            <text x={s.x} y={s.y + 29.3} textAnchor="middle" fontSize="8" fontWeight="800" fill={s.me ? '#032412' : '#fff'} fontFamily={HERO_FONT}>
              {s.name}
            </text>
            {s.score && (
              <g transform={`translate(${s.hx - 2} ${s.hy - 29})`}>
                <rect x="-11" y="-7.5" width="22" height="15" rx="7.5" fill={s.me ? '#22d36f' : '#f7c548'} />
                <text y="3" textAnchor="middle" fontSize="8.5" fontWeight="900" fill={s.me ? '#032412' : '#2a1c00'} fontFamily={HERO_FONT}>
                  {s.score}
                </text>
              </g>
            )}
            {/* table chat, in the game's speech bubble over the player's hand */}
            {s.chat && (
              <g transform={`translate(${s.hx} ${s.hy - 34})`} style={{ filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.35))' }}>
                <rect x="-27" y="-9" width="54" height="17" rx="8.5" fill="#fff" />
                <rect x="-3" y="4" width="6" height="6" rx="1" fill="#fff" transform="rotate(45 0 7)" />
                <text y="2.8" textAnchor="middle" fontSize="8" fontWeight="900" fill="#0b1520" fontFamily={HERO_FONT}>
                  {s.chat}
                </text>
              </g>
            )}
          </g>
        ))}

        <g transform="translate(366 26)">
          <rect x="-24" y="-9" width="48" height="18" rx="9" fill="#071a14" fillOpacity=".8" stroke="#fff" strokeOpacity=".12" />
          <circle cx="-13" cy="0" r="3" fill="#ff4d61" />
          <text x="4" y="3" textAnchor="middle" fontSize="8" fontWeight="900" letterSpacing="1.2" fill="#fff" fontFamily={HERO_FONT}>
            LIVE
          </text>
        </g>
      </svg>
    </div>
  )
}

function HeroVault() {
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[52%] items-center justify-center sm:flex">
      <div className="absolute h-[70%] w-[60%] rounded-full bg-gold/20 blur-3xl" />
      <motion.div initial={{ rotate: -40, scale: 0.85, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }} style={{ willChange: 'transform' }}>
        <VaultDoor size={230} className="drop-shadow-[0_24px_40px_rgba(0,0,0,.6)]" />
      </motion.div>
    </div>
  )
}

/* Robo Riot: Volt peeking over the top of his machine, its Power Grid lit with power cells and a zap bot crackling
   lightning into two of them, the neon city behind. */
const ROBO_SKY: [number, number, number][] = [
  [30, 150, 26], [58, 118, 22], [82, 162, 18], [100, 100, 26], [128, 138, 20], [376, 92, 30], [356, 150, 18],
]
const ROBO_LIT = ROBO_SKY.flatMap(([x, y, w], b) =>
  Array.from({ length: 6 }, (_, i) => ({ x: x + 4 + ((b * 5 + i * 3) % 3) * ((w - 8) / 3), y: y + 8 + ((b * 3 + i * 5) % 7) * 12, c: ['#ffe14a', '#5cf2ff', '#ff6fd8'][(b + i) % 3] })),
)
/** what the hero's sockets hold, by [col, row]: a value and its colour, or the zap bot */
const ROBO_GRID: Record<string, [string, string]> = {
  '0,0': ['5', '#5cf2ff'],
  '2,0': ['zap', '#ffe14a'],
  '4,0': ['25', '#ff4fd8'],
  '1,1': ['20', '#ff4fd8'],
  '3,1': ['50', '#ffcf3a'],
  '0,2': ['2', '#5cf2ff'],
  '2,2': ['8', '#3d8bff'],
  '4,2': ['10', '#b56bff'],
}
const BUTTONS = ['#ff4b3e', '#ffc21a', '#4dff8f', '#3ea2ff', '#ff3fd2']

function HeroRobo() {
  const u = useUid()
  const sx = (c: number) => 183 + c * 36
  const sy = (r: number) => 118 + r * 35
  const ink = '#0b1033'
  const mid = (c: number, r: number) => [sx(c) + 15, sy(r) + 15] as const
  const [zx, zy] = mid(2, 0)
  const arc = (tx: number, ty: number) => `${zx},${zy} ${(zx + tx) / 2 - 6},${(zy + ty) / 2 - 4} ${(zx + tx) / 2 + 5},${(zy + ty) / 2 + 3} ${tx},${ty}`
  const [ax, ay] = mid(1, 1)
  const [bx, by] = mid(3, 1)
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[58%] sm:block [mask-image:linear-gradient(to_right,transparent,black_26%)]">
      <svg className="h-full w-full" viewBox="0 0 400 270" preserveAspectRatio="xMaxYMid slice" aria-hidden>
        <defs>
          <linearGradient id={`${u}m`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#b3bfd1" />
          </linearGradient>
          <linearGradient id={`${u}t`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6ff5ea" />
            <stop offset="1" stopColor="#0f9c93" />
          </linearGradient>
          <radialGradient id={`${u}s`} cx=".4" cy=".35" r=".8">
            <stop offset="0" stopColor="#17386a" />
            <stop offset="1" stopColor="#060d24" />
          </radialGradient>
          <linearGradient id={`${u}k`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a2170" />
            <stop offset="1" stopColor="#100a30" />
          </linearGradient>
          <linearGradient id={`${u}b`} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#ff4a4a" stopOpacity=".45" />
            <stop offset="1" stopColor="#ff4a4a" stopOpacity="0" />
          </linearGradient>
          <radialGradient id={`${u}g`}>
            <stop offset="0" stopColor="#5cf2ff" stopOpacity=".5" />
            <stop offset="1" stopColor="#5cf2ff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${u}r`} cx=".35" cy=".3" r=".8">
            <stop offset="0" stopColor="#ff8a8a" />
            <stop offset="1" stopColor="#c8121f" />
          </radialGradient>
          <filter id={`${u}f`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.6" />
          </filter>
        </defs>

        {/* the city through the workshop window: searchlights, the moon, the skyline */}
        <path d="M70 270 L130 -10 L152 -10 Z M396 270 L330 -10 L350 -10 Z" fill="#fff" opacity=".06" />
        <circle cx="128" cy="44" r="30" fill="#fff6dc" opacity=".12" />
        <circle cx="128" cy="44" r="14" fill="#fff3d1" />
        <circle cx="124" cy="41" r="3" fill="#ecdcae" />
        <circle cx="133" cy="49" r="2" fill="#ecdcae" />
        <g fill="#1a1050" opacity=".9">
          {ROBO_SKY.map(([x, y, w]) => (
            <rect key={x} x={x} y={y} width={w} height={270 - y} />
          ))}
        </g>
        {ROBO_LIT.map((w, i) => (
          <rect key={i} x={w.x} y={w.y} width="3" height="3.5" fill={w.c} opacity=".8" />
        ))}
        <ellipse cx="270" cy="266" rx="150" ry="20" fill={`url(#${u}g)`} />

        {/* Volt behind his machine: the beacon's red sweep, antennae, the screen face and his claws on the frame */}
        <path d="M270 26 L196 -10 L236 -10 Z M270 26 L310 -10 L352 -10 Z" fill={`url(#${u}b)`} />
        <g stroke={ink} strokeWidth="3" strokeLinejoin="round">
          <rect x="222" y="80" width="96" height="30" rx="14" fill={`url(#${u}m)`} />
          <circle cx="222" cy="94" r="12" fill={`url(#${u}t)`} />
          <circle cx="318" cy="94" r="12" fill={`url(#${u}t)`} />
          <path d="M252 34 L244 14 M288 34 L296 14" fill="none" strokeLinecap="round" />
        </g>
        <circle cx="244" cy="12" r="10" fill={`url(#${u}g)`} />
        <circle cx="296" cy="12" r="10" fill={`url(#${u}g)`} />
        <g stroke={ink} strokeWidth="2.5">
          <circle cx="244" cy="12" r="4.4" fill="#8ff8ff" />
          <circle cx="296" cy="12" r="4.4" fill="#8ff8ff" />
          <rect x="258" y="26" width="24" height="7" rx="2" fill="#6f7c94" />
          <path d="M261 27 A9 9 0 0 1 279 27 Z" fill={`url(#${u}r)`} />
          <circle cx="234" cy="56" r="8.5" fill={`url(#${u}t)`} strokeWidth="3" />
          <circle cx="306" cy="56" r="8.5" fill={`url(#${u}t)`} strokeWidth="3" />
          <rect x="236" y="31" width="68" height="54" rx="14" fill={`url(#${u}m)`} strokeWidth="3" />
          <rect x="244" y="38" width="52" height="39" rx="9" fill={`url(#${u}s)`} />
        </g>
        <g fill="none" stroke="#5cf2ff" strokeLinecap="round">
          <path d="M253 59 Q258 51 263 59 M277 59 Q282 51 287 59 M262 66 Q270 73 278 66" strokeWidth="7" opacity=".45" filter={`url(#${u}f)`} />
          <path d="M253 59 Q258 51 263 59 M277 59 Q282 51 287 59" strokeWidth="3.6" />
          <path d="M262 66 Q270 73 278 66" strokeWidth="3.2" />
        </g>
        <ellipse cx="252" cy="68" rx="3.4" ry="2.1" fill="#ff5fb0" opacity=".9" />
        <ellipse cx="288" cy="68" rx="3.4" ry="2.1" fill="#ff5fb0" opacity=".9" />

        {/* the machine: bulbs along the top, the Power Grid behind neon glass, the tube buttons */}
        <rect x="166" y="96" width="208" height="186" rx="14" fill={`url(#${u}k)`} stroke={ink} strokeWidth="3" />
        <g filter={`url(#${u}f)`} opacity=".9">
          {Array.from({ length: 16 }, (_, i) => (
            <circle key={i} cx={180 + i * 12} cy="104" r="3" fill={i % 3 === 1 ? '#ff8fd8' : '#ffe9a8'} />
          ))}
        </g>
        {Array.from({ length: 16 }, (_, i) => (
          <circle key={i} cx={180 + i * 12} cy="104" r="2" fill="#fffaf0" />
        ))}
        <rect x="176" y="111" width="188" height="116" rx="8" fill="#060918" stroke="#5cf2ff" strokeWidth="2" />
        {Array.from({ length: 15 }, (_, k) => {
          const c = k % 5
          const r = Math.floor(k / 5)
          const cell = ROBO_GRID[`${c},${r}`]
          const [x, y] = [sx(c), sy(r)]
          if (!cell)
            return (
              <g key={k} fill="none" stroke="#ff6a3d" opacity=".45">
                <rect x={x} y={y} width="30" height="30" rx="6" fill="#120c2c" strokeWidth="1.5" />
                <circle cx={x + 15} cy={y + 15} r="9" strokeWidth="1.4" />
                <circle cx={x + 15} cy={y + 15} r="4.5" strokeWidth="1.4" />
              </g>
            )
          const [t, col] = cell
          return (
            <g key={k}>
              <rect x={x - 1} y={y - 1} width="32" height="32" rx="7" fill={col} opacity=".5" filter={`url(#${u}f)`} />
              <rect x={x} y={y} width="30" height="30" rx="6" fill="#0b1235" stroke={col} strokeWidth="2.2" />
              {t === 'zap' ? (
                <path d={`M${x + 17} ${y + 5} ${x + 9} ${y + 17}h5l-2 8 8-12h-5l2-8Z`} fill="#ffe14a" stroke="#fff6c0" strokeWidth=".8" strokeLinejoin="round" />
              ) : (
                <text x={x + 15} y={y + 20} textAnchor="middle" fontSize="13" fontWeight="900" fill="#fff" stroke={col} strokeWidth="2.4" paintOrder="stroke" fontFamily={HERO_FONT}>
                  {t}
                </text>
              )}
            </g>
          )
        })}
        {[arc(ax, ay), arc(bx, by)].map((pts) => (
          <g key={pts}>
            <polyline points={pts} fill="none" stroke="#ffe14a" strokeWidth="7" strokeLinejoin="round" opacity=".5" filter={`url(#${u}f)`} />
            <polyline points={pts} fill="none" stroke="#fffbe0" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        ))}
        {[
          [ax - 4, ay - 18],
          [bx + 6, by - 18],
        ].map(([x, y]) => (
          <text key={x} x={x} y={y} textAnchor="middle" fontSize="12" fontWeight="900" fill="#ffe14a" stroke={ink} strokeWidth="3" paintOrder="stroke" fontFamily={HERO_FONT}>
            ×2
          </text>
        ))}
        {BUTTONS.map((c, i) => (
          <g key={c}>
            <circle cx={sx(i) + 15} cy="246" r="9" fill={c} opacity=".45" filter={`url(#${u}f)`} />
            <circle cx={sx(i) + 15} cy="246" r="6" fill={c} stroke={ink} strokeWidth="2" />
          </g>
        ))}
        {/* Volt's claws grip the top of the frame */}
        <g fill="none" strokeLinecap="round">
          {[
            'M214 108 Q206 98 214 90',
            'M226 108 Q232 98 225 90',
            'M314 108 Q308 98 315 90',
            'M326 108 Q334 98 326 90',
          ].map((d) => (
            <g key={d}>
              <path d={d} stroke={ink} strokeWidth="8" />
              <path d={d} stroke="#dfe7f1" strokeWidth="3.5" />
            </g>
          ))}
        </g>
        {/* his lever */}
        <path d="M374 160 L390 112" stroke={ink} strokeWidth="7" strokeLinecap="round" />
        <path d="M374 160 L390 112" stroke="#c9d3e2" strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="391" cy="108" r="8" fill={`url(#${u}r)`} stroke={ink} strokeWidth="2.5" />
        {[
          [198, 62, 4],
          [352, 70, 3.5],
          [160, 122, 3],
        ].map(([x, y, r]) => (
          <path key={x} d={`M${x} ${y - r} Q${x + r * 0.2} ${y - r * 0.2} ${x + r} ${y} Q${x + r * 0.2} ${y + r * 0.2} ${x} ${y + r} Q${x - r * 0.2} ${y + r * 0.2} ${x - r} ${y} Q${x - r * 0.2} ${y - r * 0.2} ${x} ${y - r}Z`} fill="#fff" />
        ))}
      </svg>
    </div>
  )
}

function HeroFan({ ids =['blackjack', 'videopoker', 'popparty', 'roulette', 'mines'] }: { ids?: GameId[] }) {
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[55%] sm:block">
      {ids.map((id, i) => {
        const mid = (ids.length - 1) / 2
        return (
          <motion.div
            key={id}
            initial={{ opacity: 0, y: 30, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: (i - mid) * 7 }}
            transition={{ delay: 0.1 + i * 0.06, type: 'spring', stiffness: 200, damping: 20 }}
            className="absolute top-[18%] h-[72%] overflow-hidden rounded-xl shadow-[0_18px_40px_-12px_rgba(0,0,0,.7)] ring-1 ring-white/10"
            style={{ left: `${10 + i * 15}%`, aspectRatio: '4 / 5', zIndex: i === 2 ? 5 : 5 - Math.abs(i - 2), transformOrigin: '50% 120%', willChange: 'transform' }}
          >
            <GameCover id={id} />
          </motion.div>
        )
      })}
    </div>
  )
}

/* ------------------------------ grid ------------------------------ */

function GameGrid() {
  const [cat, setCat] = useState<Category | 'all'>('all')
  const list = GAMES.filter((g) => cat === 'all' || g.category === cat)
  const tabs: { id: Category | 'all'; name: string }[] = [{ id: 'all', name: 'All games' }, ...CATEGORIES]
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-full bg-panel p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setCat(t.id)}
              className={`relative whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-bold transition-colors ${cat === t.id ? 'text-ink' : 'text-muted hover:text-ink'}`}
            >
              {cat === t.id && <motion.span layoutId="lobby-tab" className="absolute inset-0 -z-0 rounded-full bg-raised" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className="relative">{t.name}</span>
            </button>
          ))}
        </div>
        <span className="text-[13px] font-semibold text-dim">{list.length} games</span>
      </div>
      <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        <AnimatePresence mode="popLayout">
          {list.map((g, i) => (
            <motion.button
              key={g.id}
              layout
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              onClick={() => navigate(`/game/${g.id}`)}
              className="card-in group text-left"
              style={{ animationDelay: `${0.03 * i}s` }}
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-panel2 shadow-[0_14px_30px_-16px_rgba(0,0,0,.9)] ring-1 ring-white/5 transition-transform duration-200 will-change-transform group-hover:-translate-y-1.5 group-active:translate-y-0 group-active:scale-[.98]">
                <GameCover id={g.id} />
                {g.tag && <Tag tag={g.tag} />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-14">
                  <div className="text-[17px] font-black leading-tight tracking-tight text-white drop-shadow sm:text-[18px]">{g.name}</div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 opacity-0 transition-opacity will-change-[opacity] group-hover:opacity-100">
                  <span className="rounded-full bg-white px-5 py-2.5 text-[14px] font-extrabold text-[#0b1520] shadow-lg">Play</span>
                </div>
              </div>
            </motion.button>
          ))}
        </AnimatePresence>
      </motion.div>
    </section>
  )
}

function Tag({ tag }: { tag: 'new' | 'live' | 'hot' }) {
  if (tag === 'live')
    return (
      <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
        </span>
        Live
      </span>
    )
  return (
    <span
      className={`absolute left-2.5 top-2.5 flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider ${
        tag === 'new' ? 'bg-accent text-[#032412]' : 'bg-gold text-[#2a1c00]'
      }`}
    >
      {tag === 'hot' && <IconFire size={11} strokeWidth={3} />}
      {tag}
    </span>
  )
}

/* ------------------------------ side cards ------------------------------ */

function GuestStrip() {
  const status = useAuth((s) => s.status)
  const available = useAuth((s) => s.available)
  const open = useAuth((s) => s.open)
  const balance = useWallet((s) => s.balance)
  if (status !== 'guest' || !available) return null
  return (
    <div className="-mt-2 flex flex-col gap-3 rounded-xl bg-[linear-gradient(90deg,rgba(34,211,111,.12),rgba(34,211,111,.03))] px-4 py-3 ring-1 ring-accent/20 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[14px] text-muted">
        <span className="font-bold text-ink">Keep your {fmt(balance)} coins.</span> A free account saves your balance, level and streak across devices.
      </p>
      <div className="flex shrink-0 gap-2">
        <button onClick={() => open('login')} className="h-10 flex-1 rounded-lg bg-raised px-4 text-[14px] font-bold transition hover:bg-hover sm:flex-none">
          Log in
        </button>
        <button onClick={() => open('register')} className="h-10 flex-1 rounded-lg bg-accent px-4 text-[14px] font-extrabold text-[#032412] transition hover:brightness-110 sm:flex-none">
          Create account
        </button>
      </div>
    </div>
  )
}

function DailyCard() {
  const now = useNow(1000)
  const dailyLast = useWallet((s) => s.dailyLast)
  const dailyStreak = useWallet((s) => s.dailyStreak)
  const ready = now - dailyLast >= DAILY_COOLDOWN
  const day = ready ? Math.min(dailyStreak + 1, 7) : dailyStreak
  return (
    <div className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-panel p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)]">
      <div className="absolute -right-12 -top-12 h-44 w-44 rounded-full bg-gold/10 blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-2 text-[13px] font-bold text-gold">
          <IconGift size={18} /> Daily bonus
        </div>
        <div className="mt-2 text-[22px] font-black tracking-tight">{ready ? `${fmt(dailyReward(Math.max(1, day)), 0)} coins waiting` : 'Claimed for today'}</div>
        <div className="mt-3 flex gap-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className={`h-1.5 flex-1 rounded-full ${i < day ? 'bg-gold' : 'bg-raised'}`} />
          ))}
        </div>
        <p className="mt-2 text-[12px] text-muted">Day {Math.max(1, day)} of a 7 day streak. Miss a day and it resets.</p>
      </div>
      <button
        onClick={() => navigate('/rewards')}
        className={`relative mt-4 flex h-12 items-center justify-center gap-2 rounded-lg text-[15px] font-extrabold transition ${
          ready ? 'shimmer bg-[linear-gradient(90deg,#f7c548,#ffe38f,#f7c548)] text-[#2a1c00]' : 'bg-raised text-muted hover:bg-hover'
        }`}
      >
        {ready ? (
          <>
            <Coin size={18} /> Claim in Rewards
          </>
        ) : (
          <span className="tnum">Next in {fmtDuration(DAILY_COOLDOWN - (now - dailyLast))}</span>
        )}
      </button>
    </div>
  )
}

function StatsStrip() {
  const s = useWallet()
  const lv = levelFromXp(s.xp)
  const tier = tierOf(lv.level)
  const items: [string, ReactNode, ReactNode][] = [
    ['Rounds played', fmt(s.rounds ?? 0, 0), <IconChart size={16} />],
    ['Total wagered', fmt(s.totalWagered), <Coin size={16} />],
    ['Biggest win', fmt(s.biggestWin), <IconTrophy size={16} />],
    [
      'VIP level',
      <span>
        {lv.level} <span style={{ color: tier.color }}>{tier.name}</span>
      </span>,
      <IconStar size={16} />,
    ],
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map(([k, v, icon]) => (
        <div key={k} className="rounded-xl bg-panel px-4 py-3">
          <div className="flex items-center gap-1.5 text-[12px] font-semibold text-dim">
            {icon} {k}
          </div>
          <div className="tnum mt-1 text-[20px] font-extrabold tracking-tight">{v}</div>
        </div>
      ))}
    </div>
  )
}
