import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { GAMES, gameInfo, type Category, type GameId, type GameInfo } from '../store/games'
import { navigate } from '../lib/router'
import { GameCover, HeroRoad } from '../components/covers'
import { GameGridView, GameRow, RowTitle } from '../components/GameRows'
import {
  DAILY_COOLDOWN,
  HEIST_MAX_PICKS,
  dailyReward,
  heistPicks,
  levelFromXp,
  missionsToday,
  rakebackRate,
  tierOf,
  TIERS,
  useClaimableCount,
  useWallet,
} from '../store/wallet'
import { dayKey, missionTarget, missionsFor } from '../store/rewards'
import { dailyState } from './rewards/daily'
import { Coin, IconBolt, IconCards, IconChart, IconChevron, IconGift, IconHistory, IconHome, IconSearch, IconStar, IconTrophy, IconX } from '../components/icons'
import { fmt, fmtAgo, fmtDuration } from '../lib/format'
import { BetsTable } from './History'
import { useNow } from '../lib/useNow'
import { useUid } from '../art/ids'
import { Rocket } from '../art/Rocket'
import { useAuth } from '../store/auth'
import { Lockpick, VaultDoor } from '../art/Vault'
import { Avatar } from '../art/Avatar'
import { CardBack, CardFace } from '../art/Card'
import { Chip } from '../art/Chip'
import type { Suit } from '../art/suits'
import { CrateArt, ItemArt } from '../games/cases/art'
import { TierBadge } from '../art/TierBadge'
import { TycoonIcon } from '../games/tycoon/icon'
import { useTycoonStatus } from '../games/tycoon/status'
import { TopPlayers } from '../components/profile/TopPlayers'

export default function Lobby() {
  return (
    <div className="flex flex-col gap-7">
      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        <Hero />
        <DailyCard />
      </div>
      <GuestStrip />
      <Games />
      <TopPlayers />
      <Activity />
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

// Casino Tycoon's art comes with its own small chunk, so the game adds next to nothing to the landing page
const TycoonHero = lazy(() => import('../games/tycoon/hero').then((m) => ({ default: m.TycoonHero })))

const SLIDES: Slide[] = [
  {
    key: 'kaiju',
    eyebrow: 'New · Live fight night',
    tone: 'text-[#ff8fa8] bg-[#ff3b6b]/15',
    title: (
      <>
        Monsters fight.
        <br />
        The city falls.
      </>
    ),
    text: 'Kaiju Clash: a live fight night in Neon Bay. Back your kaiju, call the KO or the Splash into the bay, and bet on the buildings.',
    cta: 'Play Kaiju Clash',
    to: '/game/kaiju',
    bg: 'linear-gradient(110deg,#140a26 0%,#2a0f3d 55%,#4a1238 100%)',
    art: <HeroFan ids={['showtime', 'summit', 'kaiju', 'pot', 'darts']} />,
  },
  {
    key: 'showtime',
    eyebrow: 'New game show',
    tone: 'text-[#ff8c9a] bg-[#ff4d61]/15',
    title: (
      <>
        It's
        <br />
        Showtime!
      </>
    ),
    text: 'A live money wheel: everyone bets the same spin. The Booster lights a spot every round, and four bonus rounds pay up to 20,000×.',
    cta: 'Play Showtime',
    to: '/game/showtime',
    bg: 'linear-gradient(110deg,#1f0f3d 0%,#2e1460 55%,#4a1650 100%)',
    art: <HeroFan ids={['coinflip', 'lines', 'showtime', 'popparty', 'reef']} />,
  },
  {
    key: 'pot',
    eyebrow: 'New · Live',
    tone: 'text-[#d6b4ff] bg-[#a855f7]/18',
    title: (
      <>
        One pot.
        <br />
        Winner takes all.
      </>
    ),
    text: 'Pot Luck: everyone pays into the same pot and your share is your chance. Drop in late, chase the long shot, take the lot.',
    cta: 'Join Pot Luck',
    to: '/game/pot',
    bg: 'linear-gradient(110deg,#140a26 0%,#22103e 55%,#3a1660 100%)',
    art: <HeroFan ids={['battles', 'double', 'pot', 'showtime', 'crash']} />,
  },
  {
    key: 'summit',
    eyebrow: 'New original',
    tone: 'text-[#9be3ff] bg-[#38bdf8]/15',
    title: (
      <>
        Every pitch,
        <br />
        your call.
      </>
    ),
    text: 'Summit: climb the mountain route by route. Take the safe Trail or chance the Sheer Wall, and bank at any camp before the rope gives.',
    cta: 'Climb Summit',
    to: '/game/summit',
    bg: 'linear-gradient(110deg,#06182a 0%,#0b2b46 55%,#123e5e 100%)',
    art: <HeroFan ids={['chicken', 'mines', 'summit', 'darts', 'deal']} />,
  },
  {
    key: 'deal',
    eyebrow: 'New game show',
    tone: 'text-gold bg-gold/15',
    title: (
      <>
        Deal,
        <br />
        or no deal?
      </>
    ),
    text: "Banker's Deal: sixteen briefcases, one is yours. Open the rest, hear the Banker's offer, and decide. A Diamond board hides 250×.",
    cta: "Play Banker's Deal",
    to: '/game/deal',
    bg: 'linear-gradient(110deg,#1a1406 0%,#2a1e08 55%,#3d2a0a 100%)',
    art: <HeroFan ids={['scratch', 'cases', 'deal', 'claw', 'showtime']} />,
  },
  {
    key: 'darts',
    eyebrow: 'New original',
    tone: 'text-[#ff8c9a] bg-[#e8344e]/15',
    title: (
      <>
        One hundred
        <br />
        and eighty!
      </>
    ),
    text: 'Bullseye: three darts at a real board. Pick your target and your thrower, and the total pays, up to 10,000× for a big finish.',
    cta: 'Play Bullseye',
    to: '/game/darts',
    bg: 'linear-gradient(110deg,#200c12 0%,#301018 55%,#0f2a1c 100%)',
    art: <HeroFan ids={['penalty', 'claw', 'darts', 'scratch', 'mines']} />,
  },
  {
    key: 'market',
    eyebrow: 'New original',
    tone: 'text-[#5cf0c8] bg-[#00d1a0]/15',
    title: (
      <>
        Buy the dip.
        <br />
        Ride the rush.
      </>
    ),
    text: 'Market Rush: a live price chart. Go Up or Down with up to 100× leverage and cash out before you are liquidated.',
    cta: 'Play Market Rush',
    to: '/game/market',
    bg: 'linear-gradient(110deg,#04161a 0%,#062a24 55%,#0b3a2c 100%)',
    art: <HeroFan ids={['crash', 'limbo', 'market', 'double', 'plinko']} />,
  },
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
    key: 'battles',
    eyebrow: 'Multiplayer',
    tone: 'text-[#ffa36e] bg-[#ff7a3d]/15',
    title: (
      <>
        Same crates.
        <br />
        Winner takes all.
      </>
    ),
    text: 'Case Battles: open the same crates as other players or the bots. The biggest haul takes the pot.',
    cta: 'Start a battle',
    to: '/game/battles',
    bg: 'linear-gradient(110deg,#1b1016 0%,#2a1512 55%,#3d1d0f 100%)',
    art: <HeroBattles />,
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
    key: 'tycoon',
    eyebrow: 'New · Free coins',
    tone: 'text-[#ffcf4a] bg-[#f5b83d]/15',
    title: (
      <>
        Build a casino.
        <br />
        Wake up richer.
      </>
    ),
    text: 'An idle tycoon: hire managers to run it while you are away, and collect real coins from its vault every day.',
    cta: 'Open Casino Tycoon',
    to: '/tycoon',
    bg: 'linear-gradient(110deg,#171230 0%,#231640 55%,#3a1d3e 100%)',
    art: (
      <Suspense fallback={null}>
        <TycoonHero />
      </Suspense>
    ),
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

/* Case Battles: two players' reels face off under the row of crates being opened. The left reel has landed on a gold
   watch and leads; the right has a copper coin; a stack of what each has pulled sits underneath. */
function HeroBattles() {
  const u = useUid()
  const cols = [
    { x: 168, avatar: 12, total: '128.40', tiles: ['coins', 'watch', 'bag'] as const, hit: '#4f9dff', stack: ['ring', 'cash', 'silver'] as const, lead: true },
    { x: 292, avatar: 5, total: '36.20', tiles: ['silver', 'copper', 'cash'] as const, hit: '#8d9fb4', stack: ['coins', 'copper', 'bag'] as const, lead: false },
  ]
  const W = 94
  const top = 64
  const H = 150
  const mid = top + H / 2
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[60%] sm:block [mask-image:linear-gradient(to_right,transparent,black_24%)]">
      <svg className="h-full w-full" viewBox="96 -4 312 278" preserveAspectRatio="xMaxYMid meet" aria-hidden>
        <defs>
          <radialGradient id={`${u}g`} cx=".5" cy=".5" r=".5">
            <stop offset="0" stopColor="#ff9a52" stopOpacity=".45" />
            <stop offset="1" stopColor="#ff7a3d" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${u}f`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b1621" />
            <stop offset=".26" stopColor="#0b1621" stopOpacity="0" />
            <stop offset=".74" stopColor="#0b1621" stopOpacity="0" />
            <stop offset="1" stopColor="#0b1621" />
          </linearGradient>
          {cols.map((c, i) => (
            <clipPath key={i} id={`${u}c${i}`}>
              <rect x={c.x} y={top} width={W} height={H} rx="12" />
            </clipPath>
          ))}
        </defs>
        <ellipse cx="276" cy={mid} rx="150" ry="120" fill={`url(#${u}g)`} />
        {/* the crates, one per round; the second is being opened */}
        {(['medium', 'high', 'extreme', 'high', 'low'] as const).map((t, i) => (
          <g key={i} opacity={i === 0 ? 0.5 : 1}>
            <rect x={196 + i * 38} y={10} width={34} height={32} rx="7" fill={i === 1 ? 'rgba(255,122,61,.18)' : 'rgba(255,255,255,.05)'} stroke={i === 1 ? '#ff7a3d' : 'none'} strokeWidth="1.6" />
            <CrateArt tier={t} size={26} x={200 + i * 38} y={13} />
          </g>
        ))}
        {cols.map((c, i) => (
          <g key={i}>
            <rect x={c.x - 6} y={top - 30} width={W + 12} height={H + 70} rx="14" fill="#0d1a26" opacity=".85" stroke={c.lead ? '#ff7a3d' : 'rgba(255,255,255,.06)'} strokeOpacity={c.lead ? 0.7 : 1} strokeWidth="1.4" />
            <rect x={c.x} y={top} width={W} height={H} rx="12" fill="#08131c" />
            <g clipPath={`url(#${u}c${i})`}>
              {c.tiles.map((k, j) => {
                const y = mid - 29 + (j - 1) * 64
                const hit = j === 1
                return (
                  <g key={k} opacity={hit ? 1 : 0.5}>
                    <rect x={c.x + 10} y={y} width={W - 20} height={58} rx="8" fill="#15283a" stroke={hit ? c.hit : '#ffffff'} strokeOpacity={hit ? 1 : 0.08} strokeWidth={hit ? 2.2 : 1} />
                    {hit && <rect x={c.x + 10} y={y} width={W - 20} height={58} rx="8" fill={c.hit} opacity=".14" />}
                    <ItemArt kind={k} size={42} x={c.x + W / 2 - 21} y={y + 6} />
                  </g>
                )
              })}
              <rect x={c.x} y={top} width={W} height={H} fill={`url(#${u}f)`} />
            </g>
            <path d={`M${c.x} ${mid - 5}v10l7-5Z`} fill={c.hit} />
            <path d={`M${c.x + W} ${mid - 5}v10l-7-5Z`} fill={c.hit} />
            {/* the player and their running total */}
            <g transform={`translate(${c.x + 4} ${top - 25})`}>
              <circle cx="10" cy="10" r="11.5" fill={c.lead ? '#ff7a3d' : '#2b475c'} />
              <Avatar index={c.avatar} size={20} />
            </g>
            <text x={c.x + W - 4} y={top - 10} textAnchor="end" fontSize="13" fontWeight="900" fill={c.lead ? '#ffc23d' : '#eef4f9'} fontFamily="Manrope, system-ui, sans-serif">
              {c.total}
            </text>
            {/* what they've pulled so far */}
            {c.stack.map((k, j) => (
              <g key={j}>
                <rect x={c.x + j * 32 - 1} y={top + H + 8} width={30} height={30} rx="6" fill="#15283a" />
                <ItemArt kind={k} size={22} x={c.x + j * 32 + 3} y={top + H + 12} />
              </g>
            ))}
          </g>
        ))}
        <circle cx="280" cy={mid} r="15" fill="#0b1621" stroke="#ff7a3d" strokeWidth="2.4" />
        <text x="280" y={mid + 4.5} textAnchor="middle" fontSize="12" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif">
          VS
        </text>
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

/* ------------------------------ games ------------------------------ */

/* The games, two ways. The Lobby view is a page of rows (what you played last, the live tables, slots, originals,
   the free-coin games and the table games), each scrolling sideways; every other view, and any search, is one grid
   of the games that match. The view you picked stays for the visit, so coming back from a game lands where you were. */

type View = 'lobby' | Category | 'live' | 'new'
let lastView: View = 'lobby'

const LiveDot = () => (
  <span className="relative flex h-2 w-2">
    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-danger opacity-70" />
    <span className="relative inline-flex h-2 w-2 rounded-full bg-danger" />
  </span>
)
const SlotIcon = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16M15 4v16" />
  </svg>
)

const VIEWS: { id: View; name: string; icon: ReactNode }[] = [
  { id: 'lobby', name: 'Lobby', icon: <IconHome size={15} /> },
  { id: 'originals', name: 'Originals', icon: <IconStar size={15} /> },
  { id: 'slots', name: 'Slots', icon: <SlotIcon /> },
  { id: 'table', name: 'Table games', icon: <IconCards size={15} /> },
  { id: 'live', name: 'Live', icon: <LiveDot /> },
  { id: 'new', name: 'New', icon: <IconBolt size={15} /> },
]
const inView = (v: View, g: GameInfo) => v === 'lobby' || (v === 'live' ? g.tag === 'live' : v === 'new' ? g.tag === 'new' : g.category === v)
const ofCategory = (c: Category) => GAMES.filter((g) => g.category === c)

function Games() {
  const [view, setViewState] = useState<View>(lastView)
  const [q, setQ] = useState('')
  const top = useRef<HTMLDivElement>(null)
  const t = q.trim().toLowerCase()
  const list = GAMES.filter((g) => inView(view, g) && (!t || g.name.toLowerCase().includes(t) || g.tagline.toLowerCase().includes(t)))
  const setView = (v: View, scroll = false) => {
    lastView = v
    setViewState(v)
    if (scroll) requestAnimationFrame(() => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const name = VIEWS.find((v) => v.id === view)!.name
  return (
    <section className="flex flex-col gap-7">
      <div ref={top} className="-mb-2 flex scroll-mt-3 flex-wrap items-center justify-between gap-3">
        <div className="no-scrollbar -mx-3 flex max-w-[calc(100%+24px)] overflow-x-auto px-3 sm:mx-0 sm:max-w-full sm:px-0">
          <div className="flex gap-1 rounded-full bg-panel p-1">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => setView(v.id)}
                className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-[13px] font-bold transition-colors ${view === v.id ? 'text-ink' : 'text-muted hover:text-ink'}`}
              >
                {view === v.id && <motion.span layoutId="lobby-tab" className="absolute inset-0 rounded-full bg-raised" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
                <span className="relative flex items-center">{v.icon}</span>
                <span className="relative">{v.name}</span>
              </button>
            ))}
          </div>
        </div>
        <label className="flex h-10 w-full items-center gap-2 rounded-full bg-panel px-3.5 text-dim ring-1 ring-transparent transition focus-within:ring-raised sm:w-[240px]">
          <IconSearch size={16} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={view === 'lobby' ? 'Find a game' : `Find in ${name}`}
            className="min-w-0 flex-1 bg-transparent text-[13.5px] font-semibold text-ink outline-none placeholder:text-dim"
          />
          {q && (
            <button onClick={() => setQ('')} aria-label="Clear" className="-mr-1 flex h-7 w-7 items-center justify-center rounded-full hover:bg-raised hover:text-ink">
              <IconX size={14} />
            </button>
          )}
        </label>
      </div>

      {view === 'lobby' && !t ? (
        <>
          <ContinueRow />
          <GameRow
            title="Live & multiplayer"
            icon={
              <span className="flex w-[18px] justify-center">
                <LiveDot />
              </span>
            }
            games={GAMES.filter((g) => g.tag === 'live')}
            onAll={() => setView('live', true)}
          />
          <GameRow title="Slots" icon={<SlotIcon size={18} />} games={ofCategory('slots')} onAll={() => setView('slots', true)} />
          <GameRow title="Boje Originals" icon={<IconStar size={18} />} games={ofCategory('originals')} onAll={() => setView('originals', true)} />
          <FreeCoins />
          <GameRow title="Table games" icon={<IconCards size={18} />} games={ofCategory('table')} onAll={() => setView('table', true)} />
        </>
      ) : (
        <div>
          <RowTitle count={list.length} right={t ? <span className="truncate text-[13px] font-semibold text-dim">matching “{q.trim()}”</span> : undefined}>
            {view === 'lobby' ? 'All games' : name}
          </RowTitle>
          {list.length ? (
            <GameGridView games={list} />
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-panel/50 p-10 text-center text-[14px] text-muted">
              No games match “{q.trim()}”.{' '}
              <button onClick={() => setQ('')} className="font-bold text-accent hover:underline">
                Clear the search
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** the games you played last, newest first, with how your last round there went */
function ContinueRow() {
  const bets = useWallet((s) => s.bets)
  const now = useNow(30_000)
  const recent = useMemo(() => {
    const seen = new Map<string, { game: GameId; net: number; time: number }>()
    for (const b of bets) if (!seen.has(b.game) && !gameInfo(b.game).retired) seen.set(b.game, { game: b.game, net: b.payout - b.bet, time: b.time })
    return [...seen.values()].slice(0, 10)
  }, [bets])
  if (!recent.length) return null
  const by = new Map(recent.map((r) => [r.game, r]))
  return (
    <GameRow
      title="Continue playing"
      icon={<IconHistory size={18} />}
      games={recent.map((r) => r.game)}
      below={(g) => {
        const r = by.get(g.id)!
        return (
          <div className="tnum mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[12px] font-bold">
            <span className="truncate text-dim">{fmtAgo(now - r.time)}</span>
            <span className={r.net > 0 ? 'text-accent' : 'text-dim'}>
              {r.net > 0 ? '+' : ''}
              {fmt(r.net)}
            </span>
          </div>
        )
      }}
    />
  )
}

/* ------------------------------ free coins ------------------------------ */

/** the ways to free coins, as a row of three: Vault Heist, Casino Tycoon and what's waiting on the Rewards page */
function FreeCoins() {
  const now = useNow(1000)
  const heist = useWallet((s) => s.heist)
  const { picks, next } = heistPicks(heist, now)
  const st = useTycoonStatus(5000)
  const claimable = useClaimableCount()
  const rakeback = useWallet((s) => s.rakeback ?? 0)
  const xp = useWallet((s) => s.xp)
  const rate = rakebackRate(levelFromXp(xp).level)
  return (
    <section>
      <RowTitle icon={<Coin size={18} />}>Free coins</RowTitle>
      <div className="grid gap-3 md:grid-cols-3">
        <FreeCard
          to="/heist"
          bg="linear-gradient(120deg,#2d2611 0%,#1f1d12 60%,#191a14 100%)"
          glow="#f7c548"
          eyebrow="Vault Heist"
          title="Crack the vault"
          line={next ? `Next lockpick in ${fmtDuration(next)}` : `${picks} of ${HEIST_MAX_PICKS} lockpicks ready`}
          extra={
            <span className="flex gap-0.5">
              {Array.from({ length: HEIST_MAX_PICKS }, (_, i) => (
                <Lockpick key={i} on={i < picks} size={20} />
              ))}
            </span>
          }
          art={<VaultDoor size={84} />}
          cta={picks ? 'Play' : 'Practice'}
          tone="bg-gold text-[#2a1c00]"
        />
        <FreeCard
          to="/tycoon"
          bg="linear-gradient(120deg,#3a1d3e 0%,#231640 60%,#171230 100%)"
          glow="#f5b83d"
          eyebrow="Casino Tycoon"
          title={!st ? 'Build a casino' : st.fullIn === 0 ? 'Your vault is full' : 'Your vault is filling'}
          line={
            !st
              ? 'An idle game that pays coins every hour'
              : st.due
                ? `${st.due} ${st.due === 1 ? 'milestone' : 'milestones'} to claim`
                : `${fmt(st.vault, 0)} of ${fmt(st.cap, 0)} coins · +${fmt(st.rate, 1)}/h`
          }
          extra={
            st && (
              <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-black/30">
                <span className="block h-full rounded-full bg-[#ffcf4a]" style={{ width: `${Math.min(100, (st.vault / st.cap) * 100)}%` }} />
              </span>
            )
          }
          art={
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-gradient-to-b from-[#ffe08a] to-[#f2a93b] text-[#3a2400] shadow-[inset_0_-4px_0_rgba(0,0,0,.18)]">
              <TycoonIcon width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </span>
          }
          cta={!st ? 'Open' : 'Collect'}
          tone="bg-[#ffcf4a] text-[#2a1c00]"
        />
        <FreeCard
          to="/rewards"
          bg="linear-gradient(120deg,#0f3324 0%,#10261d 60%,#0e1d18 100%)"
          glow="#22d36f"
          eyebrow="Rewards"
          title={claimable ? `${claimable} ${claimable === 1 ? 'reward' : 'rewards'} to claim` : 'Missions, wheel and more'}
          line={rakeback >= 0.01 ? `${fmt(rakeback)} rakeback set aside` : `${+(rate * 100).toFixed(2)}% of every bet comes back`}
          art={
            <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-gradient-to-b from-[#5cf09a] to-[#14a957] text-[#032412] shadow-[inset_0_-4px_0_rgba(0,0,0,.18)]">
              <IconGift size={38} />
            </span>
          }
          cta="Open"
          tone="bg-accent text-[#032412]"
        />
      </div>
    </section>
  )
}

function FreeCard(p: { to: string; bg: string; glow: string; eyebrow: string; title: string; line: string; extra?: ReactNode; art: ReactNode; cta: string; tone: string }) {
  return (
    <button
      onClick={() => navigate(p.to)}
      className="group relative flex min-h-[132px] items-center gap-4 overflow-hidden rounded-2xl p-4 text-left ring-1 ring-white/[.05] transition hover:-translate-y-0.5"
      style={{ background: p.bg }}
    >
      <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl" style={{ background: p.glow, opacity: 0.16 }} />
      <span className="relative min-w-0 flex-1">
        <span className="block text-[11px] font-extrabold uppercase tracking-wider" style={{ color: p.glow }}>
          {p.eyebrow}
        </span>
        <span className="mt-0.5 block truncate text-[18px] font-black tracking-tight text-white">{p.title}</span>
        <span className="tnum mt-0.5 block truncate text-[12.5px] font-semibold text-white/60">{p.line}</span>
        <span className="mt-2.5 flex items-center gap-3">
          <span className={`inline-flex h-8 items-center gap-1 rounded-lg px-3.5 text-[13px] font-extrabold shadow-[inset_0_-2px_0_rgba(0,0,0,.16)] ${p.tone}`}>
            {p.cta} <IconChevron size={14} className="transition-transform group-hover:translate-x-0.5" />
          </span>
          {p.extra}
        </span>
      </span>
      <span className="relative shrink-0 drop-shadow-[0_12px_24px_rgba(0,0,0,.55)] transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">{p.art}</span>
    </button>
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
  // the same rules as the Rewards page: a lapsed streak pays day 1 again
  const { ready, alive, day } = dailyState(dailyLast, dailyStreak, now)
  const lapsed = ready && dailyLast > 0 && !alive
  // today's missions and the Lucky Wheel, teased under the streak (the full hub is on Rewards): the count on the left,
  // what's next in a pill on the right (missions to claim, or the wheel's state), so it's never what gets cut off
  const missions = useWallet((s) => s.missions)
  const wheelSpin = useWallet((s) => s.wheelSpin)
  const m = missionsToday(missions, dayKey(now))
  const finished = missionsFor(m.day).map((mi, i) => m.claimed[i] || (m.progress[i] ?? 0) >= missionTarget(mi))
  const unclaimed = finished.filter((f, i) => f && !m.claimed[i]).length
  const wheel = wheelSpin
    ? ['Prize waiting', 'bg-gold/15 text-gold']
    : m.wheel === 'ready'
      ? ['Spin ready', 'bg-[#ff5fa2]/15 text-[#ff8cc0]']
      : unclaimed
        ? [`${unclaimed} to claim`, 'bg-gold/15 text-gold']
        : m.wheel === 'spun'
          ? ['Spun today', 'bg-accent/12 text-accent']
          : ['Wheel locked', 'bg-raised text-dim']
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
        <p className="mt-2 text-[12px] text-muted">{lapsed ? 'Your streak lapsed, so this is day 1 again.' : `Day ${Math.max(1, day)} of a 7 day streak. Miss a day and it resets.`}</p>
        <button
          onClick={() => navigate('/rewards')}
          className="group mt-3 flex h-10 w-full items-center gap-2.5 rounded-lg bg-stage/80 px-3 text-left text-[12px] font-bold text-muted ring-1 ring-white/[.04] transition hover:text-ink"
        >
          <span className="flex shrink-0 gap-1">
            {finished.map((f, i) => (
              <span key={i} className={`h-2 w-2 rounded-full ${m.claimed[i] ? 'bg-accent' : f ? 'bg-gold' : 'bg-raised'}`} />
            ))}
          </span>
          <span className="min-w-0 truncate">
            Missions <span className="tnum text-ink">{finished.filter(Boolean).length}/3</span>
          </span>
          <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${wheel[1]}`}>{wheel[0]}</span>
          <IconChevron size={14} className="-ml-1 shrink-0 transition-transform group-hover:translate-x-0.5" />
        </button>
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

/* ------------------------------ activity ------------------------------ */

/** your last few rounds, beside your VIP level and totals */
function Activity() {
  const any = useWallet((s) => s.bets.length > 0)
  return (
    <section className="grid gap-x-3 gap-y-7 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col">
        <RowTitle
          icon={<IconChart size={18} />}
          right={
            any && (
              <button onClick={() => navigate('/history')} className="flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-bold text-muted transition hover:bg-panel hover:text-ink">
                All bets <IconChevron size={14} />
              </button>
            )
          }
        >
          Your recent bets
        </RowTitle>
        <div className="flex-1">
          <BetsTable limit={6} />
        </div>
      </div>
      <div>
        <RowTitle icon={<IconTrophy size={18} />}>Your level</RowTitle>
        <LevelCard />
      </div>
    </section>
  )
}

function LevelCard() {
  const xp = useWallet((s) => s.xp)
  const rounds = useWallet((s) => s.rounds ?? 0)
  const wagered = useWallet((s) => s.totalWagered)
  const biggest = useWallet((s) => s.biggestWin)
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  const nextTier = TIERS[rank + 1]
  const stats: [string, ReactNode][] = [
    ['Rounds played', fmt(rounds, 0)],
    ['Total wagered', fmt(wagered)],
    ['Biggest win', <span className={biggest > 0 ? 'text-gold' : ''}>{fmt(biggest)}</span>],
    ['Rakeback', `${+(rakebackRate(lv.level) * 100).toFixed(2)}%`],
  ]
  return (
    <div className="relative overflow-hidden rounded-2xl bg-panel p-5">
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full blur-3xl" style={{ background: tier.color, opacity: 0.13 }} />
      <button onClick={() => navigate('/rewards')} className="group relative flex w-full items-center gap-4 text-left">
        <TierBadge color={tier.color} rank={rank} size={56} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-semibold text-dim">VIP level {lv.level}</span>
          <span className="block text-[21px] font-black tracking-tight" style={{ color: tier.color }}>
            {tier.name}
          </span>
        </span>
        <span className="flex items-center gap-1 rounded-lg bg-stage/70 px-2.5 py-1.5 text-[12px] font-bold text-muted transition group-hover:text-ink">
          Perks <IconChevron size={13} />
        </span>
      </button>
      <div className="relative mt-4">
        <div className="flex justify-between text-[12px] font-semibold text-dim">
          <span>To level {lv.level + 1}</span>
          <span className="tnum">
            {fmt(lv.into, 0)} / {fmt(lv.need, 0)} XP
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stage">
          <motion.div className="h-full rounded-full" style={{ background: tier.color }} initial={false} animate={{ width: `${Math.max(2, Math.min(100, (lv.into / lv.need) * 100))}%` }} transition={{ duration: 0.6 }} />
        </div>
        <div className="mt-1.5 text-[12px] text-dim">
          {nextTier ? `${nextTier.name} at level ${nextTier.min}.` : 'You are at the top tier.'} Every coin you bet is 1 XP.
        </div>
      </div>
      <div className="relative mt-4 grid grid-cols-2 gap-2">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-stage/60 px-3 py-2.5">
            <div className="text-[11.5px] font-semibold text-dim">{k}</div>
            <div className="tnum mt-0.5 text-[16px] font-extrabold tracking-tight">{v}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
