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
    eyebrow: 'New slot',
    tone: 'text-[#2ee87f] bg-[#2ee87f]/15',
    title: (
      <>
        Feed the
        <br />
        Chompers
      </>
    ),
    text: 'Cartoon monsters gobble every donut on the reels. Fill the meter for up to 10× in free spins.',
    cta: 'Play Chompers',
    to: '/game/chompers',
    bg: 'linear-gradient(110deg,#0f2a26 0%,#123528 55%,#173f2c 100%)',
    art: <HeroFan ids={['slots', 'blackjack', 'chompers', 'videopoker', 'mines']} />,
  },
  {
    key: 'new',
    eyebrow: 'New',
    tone: 'text-accent bg-accent/15',
    title: (
      <>
        Slots, now
        <br />
        in 3D
      </>
    ),
    text: 'Gems that pay anywhere, tumbling wins and multiplier orbs up to 100× in free spins.',
    cta: 'Spin Slots',
    to: '/game/slots',
    bg: 'linear-gradient(110deg,#1f1338 0%,#24164a 55%,#2f1a5a 100%)',
    art: <HeroFan />,
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
      <AnimatePresence initial={false}>
        <motion.div key={s.key} className="absolute inset-0" style={{ background: s.bg }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          {s.art}
          <div className="relative z-10 flex h-full max-w-[460px] flex-col justify-center px-6 pb-12 pt-6 sm:px-8 sm:pb-12 sm:pt-8">
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

function HeroCrash() {
  const u = useUid()
  const pts: string[] = []
  for (let x = 0; x <= 300; x += 4) pts.push(`${40 + x},${(250 - (Math.exp(x / 95) - 1) * 9.6).toFixed(1)}`)
  const line = `M${pts.join(' L')}`
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[58%] sm:block [mask-image:linear-gradient(to_right,transparent,black_22%)]">
      <svg className="h-full w-full" viewBox="0 0 400 270" preserveAspectRatio="xMaxYMid slice" aria-hidden>
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
        {Array.from({ length: 40 }, (_, i) => (
          <circle key={i} className="twinkle" style={{ animationDelay: `${(i * 0.37) % 2.4}s` }} cx={(i * 97) % 400} cy={(i * 53) % 230} r={i % 4 ? 0.9 : 1.6} fill="#fff" opacity=".7" />
        ))}
        <path d={`${line} L340 250 Z`} fill={`url(#${u}f)`} />
        <path d={line} fill="none" stroke={`url(#${u}s)`} strokeWidth="5" strokeLinecap="round" />
        <g transform="translate(340 63) rotate(-58)">
          <Rocket width={96} x={-96 * 0.29} y={-96 * 0.2} />
        </g>
        <text x="236" y="120" fontSize="34" fontWeight="900" fill="#fff" fontFamily="Manrope, system-ui, sans-serif">
          12.48×
        </text>
      </svg>
    </div>
  )
}

function HeroVault() {
  return (
    <div className="absolute inset-y-0 right-0 hidden w-[52%] items-center justify-center sm:flex">
      <div className="absolute h-[70%] w-[60%] rounded-full bg-gold/20 blur-3xl" />
      <motion.div initial={{ rotate: -40, scale: 0.85, opacity: 0 }} animate={{ rotate: 0, scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 120, damping: 16 }}>
        <VaultDoor size={230} className="drop-shadow-[0_24px_40px_rgba(0,0,0,.6)]" />
      </motion.div>
    </div>
  )
}

function HeroFan({ ids = ['blackjack', 'videopoker', 'slots', 'roulette', 'mines'] }: { ids?: GameId[] }) {
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
            style={{ left: `${10 + i * 15}%`, aspectRatio: '4 / 5', zIndex: i === 2 ? 5 : 5 - Math.abs(i - 2), transformOrigin: '50% 120%' }}
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
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ delay: 0.03 * i, type: 'spring', stiffness: 260, damping: 24 }}
              whileHover={{ y: -6 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => navigate(`/game/${g.id}`)}
              className="group text-left"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-panel2 shadow-[0_14px_30px_-16px_rgba(0,0,0,.9)] ring-1 ring-white/5 transition-shadow group-hover:shadow-[0_22px_40px_-16px_rgba(0,0,0,.9)]">
                <GameCover id={g.id} />
                {g.tag && <Tag tag={g.tag} />}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent p-3 pt-14">
                  <div className="text-[17px] font-black leading-tight tracking-tight text-white drop-shadow sm:text-[18px]">{g.name}</div>
                </div>
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
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
      <span className="absolute left-2.5 top-2.5 flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-white backdrop-blur">
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
