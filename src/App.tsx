import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { navigate, useRoute } from './lib/router'
import { CATEGORIES, GAMES, type GameId } from './store/games'
import { levelFromXp, tierOf, useClaimableCount, useHeistPicks, useWallet } from './store/wallet'
import { AnimatedNumber } from './components/ui'
import { Coin, IconGift, IconGrid, IconHistory, IconHome, IconMenu, IconMute, IconLogout, IconSearch, IconUser, IconVault, IconVolume, IconX, Logo } from './components/icons'
import { AuthModal } from './components/AuthModal'
import { BojeLoader, Spinner } from './components/Loader'
import { Avatar } from './art/Avatar'
import { useAuth } from './store/auth'
import { carried, logout } from './lib/account'
import { guestId } from './lib/identity'
import { migrateGuest, pendingAll } from './games/livebj/ledger'
import type { TableServer } from './games/livebj/types'
import { hasShared as hasBattleStakes, isNew as isNewBattle, migrateGuest as migrateBattleGuest, pendingAll as pendingBattles } from './games/battles/ledger'
import type { BattleServer } from './games/battles/types'
import { GameIcon } from './components/GameIcon'
import { GameCover } from './components/covers'
import { Toasts } from './components/Toasts'
import { isMuted, setMuted } from './lib/sound'
import { BootDone } from './lib/boot'
import Lobby from './pages/Lobby'
import Rewards from './pages/Rewards'
import History from './pages/History'
import Account from './pages/Account'

const gamePages: Record<GameId, React.LazyExoticComponent<() => ReactNode>> = {
  chicken: lazy(() => import('./games/chicken/ChickenRoad')),
  crash: lazy(() => import('./games/crash/Crash')),
  mines: lazy(() => import('./games/mines/Mines')),
  plinko: lazy(() => import('./games/plinko/Plinko')),
  dice: lazy(() => import('./games/dice/Dice')),
  limbo: lazy(() => import('./games/limbo/Limbo')),
  keno: lazy(() => import('./games/keno/Keno')),
  hilo: lazy(() => import('./games/hilo/HiLo')),
  wheel: lazy(() => import('./games/wheel/Wheel')),
  blackjack: lazy(() => import('./games/blackjack/Blackjack')),
  roulette: lazy(() => import('./games/roulette/Roulette')),
  chompers: lazy(() => import('./games/chompers/Chompers')),
  cases: lazy(() => import('./games/cases/Cases')),
  double: lazy(() => import('./games/double/Double')),
  claw: lazy(() => import('./games/claw/LuckyClaw')),
  battles: lazy(() => import('./games/battles/CaseBattles')),
  derby: lazy(() => import('./games/derby/DuckDerby')),
  baccarat: lazy(() => import('./games/baccarat/Baccarat')),
  popparty: lazy(() => import('./games/popparty/PopParty')),
  roboriot: lazy(() => import('./games/roboriot/RoboRiot')),
  livebj: lazy(() => import('./games/livebj/LiveBlackjack')),
  videopoker: lazy(() => import('./games/videopoker/VideoPoker')),
}
const Heist = lazy(() => import('./games/heist/Heist'))
const pageFallback = (
  <div className="flex h-[calc(100dvh-108px)] min-h-[420px] items-center justify-center rounded-2xl bg-panel2/50">
    <BojeLoader />
  </div>
)

export default function App() {
  const route = useRoute()
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState(false)
  // a different player means a different wallet: start the page over
  const who = useAuth((s) => s.uid ?? 'guest')
  const authReady = useAuth((s) => s.status !== 'loading')
  const m = route.match(/^\/game\/(\w+)/)
  useLiveBjPayouts(who, authReady && m?.[1] !== 'livebj')
  useBattlePayouts(who, authReady && m?.[1] !== 'battles')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearch((s) => !s)
      } else if (e.key === 'Escape') setSearch(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  let page: ReactNode
  // a game's own sub-routes (Live Blackjack tables) keep the page mounted
  const pageKey = m && m[1] in gamePages ? `/game/${m[1]}` : route
  if (m && m[1] in gamePages) {
    const Game = gamePages[m[1] as GameId]
    page = (
      <Suspense fallback={pageFallback}>
        <Game />
        <BootDone />
      </Suspense>
    )
  } else if (route.startsWith('/heist'))
    page = (
      <Suspense fallback={pageFallback}>
        <Heist />
        <BootDone />
      </Suspense>
    )
  else {
    const Page = route.startsWith('/rewards') ? Rewards : route.startsWith('/history') ? History : route.startsWith('/account') ? Account : Lobby
    page = (
      <>
        <Page />
        <BootDone />
      </>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar route={route} collapsed={collapsed} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggle={() => setCollapsed((c) => !c)} onSearch={() => setSearch(true)} />
        <main className="min-h-0 flex-1 overflow-y-auto pb-24 lg:pb-8">
          <div className="mx-auto w-full max-w-[1480px] px-3 pt-3 sm:px-5 sm:pt-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${pageKey}|${who}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
                {page}
              </motion.div>
            </AnimatePresence>
          </div>
        </main>
      </div>
      <MobileNav route={route} onGames={() => setSearch(true)} />
      <AnimatePresence>{search && <SearchModal onClose={() => setSearch(false)} />}</AnimatePresence>
      <AuthModal />
      <Toasts />
    </div>
  )
}

/* A Live Blackjack round plays on after you leave the table (your hands stand when their turn runs out). The Live
   Blackjack page settles its own rounds; everywhere else in the app this keeps finishing the shared rounds you still
   have a stake in and pays them out, so a win lands seconds after its results rather than when you next open the
   tables. It only polls while such a stake is pending (games/livebj/ledger.ts). */
function useLiveBjPayouts(who: string, on: boolean) {
  useEffect(() => {
    if (!on) return
    // stakes a guest had open when signing up were paid from the wallet the account took over: they settle there
    const c = carried()
    if (c) migrateGuest(c.to, guestId, c.at)
    let stop = false
    let busy = false
    let server: TableServer | null = null
    const run = async () => {
      if (busy || !Object.values(pendingAll(who)).some((p) => p.src === 'shared')) return
      busy = true
      try {
        const [net, { settleMissed }] = await Promise.all([import('./games/livebj/net'), import('./games/livebj/settle')])
        server ??= await net.tryShared()
        if (!server) return
        // bj_tables advances every table that is due, so a round nobody is watching still plays out
        const f = await server.tables()
        // only the tab that controls the seat touches the wallet, as in the Live Blackjack lobby
        if (!stop && (!f.mine || f.mine.active)) await settleMissed(server, who, 'shared', null, [])
      } catch {
        /* offline: try again on the next tick */
      } finally {
        busy = false
      }
    }
    run()
    const id = setInterval(run, 5000)
    const onVisible = () => !document.hidden && run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [who, on])
}

/* A Case Battle plays out on the server's clock whether or not anyone watches. The Case Battles pages settle their own;
   everywhere else this asks about the shared battles you paid into (cb_result) and pays each one out once its winner
   is shown, or refunds it if it was called off. It only polls while such a stake is pending (games/battles/ledger.ts). */
function useBattlePayouts(who: string, on: boolean) {
  useEffect(() => {
    if (!on) return
    const c = carried()
    if (c) migrateBattleGuest(c.to, guestId, c.at)
    let stop = false
    let busy = false
    let server: BattleServer | null = null
    const run = async () => {
      if (busy || !hasBattleStakes(who)) return
      busy = true
      try {
        const [net, { settleMissed }] = await Promise.all([import('./games/battles/net'), import('./games/battles/settle')])
        server ??= await net.tryShared()
        if (!server || stop) return
        // a create whose answer was lost is found among your own battles in the lobby feed
        const mine = Object.keys(pendingBattles(who)).some(isNewBattle) ? (await server.list()).mine : null
        if (!stop) await settleMissed(server, who, { mine })
      } catch {
        /* offline: try again on the next tick */
      } finally {
        busy = false
      }
    }
    run()
    const id = setInterval(run, 5000)
    const onVisible = () => !document.hidden && run()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stop = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [who, on])
}

function Sidebar({ route, collapsed }: { route: string; collapsed: boolean }) {
  const claimable = useClaimableCount()
  const picks = useHeistPicks()
  const item = (to: string, icon: ReactNode, label: string, badge?: number, accent?: string) => {
    const active = to === '/' ? route === '/' : route.startsWith(to)
    return (
      <button
        key={to}
        onClick={() => navigate(to)}
        title={label}
        className={`group relative flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-[14px] font-semibold transition ${
          active ? 'bg-raised text-ink' : 'text-muted hover:bg-panel2 hover:text-ink'
        } ${collapsed ? 'justify-center px-0' : ''}`}
      >
        {active && <motion.span layoutId="nav-active" className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-full bg-accent" />}
        <span className="flex w-5 shrink-0 justify-center transition-colors" style={accent && active ? { color: accent } : undefined}>
          {icon}
        </span>
        {!collapsed && <span className="truncate">{label}</span>}
        {!!badge && (
          <span className={`${collapsed ? 'absolute right-1 top-1' : 'ml-auto'} flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-black text-[#032412]`}>
            {badge}
          </span>
        )}
      </button>
    )
  }
  return (
    <aside className={`hidden shrink-0 flex-col bg-panel transition-[width] duration-300 lg:flex ${collapsed ? 'w-[72px]' : 'w-[232px]'}`}>
      <button onClick={() => navigate('/')} className={`flex h-16 shrink-0 items-center ${collapsed ? 'justify-center' : 'px-5'}`}>
        <Logo compact={collapsed} />
      </button>
      <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-4">
        <nav className="flex flex-col gap-0.5 rounded-xl bg-panel2/60 p-1.5">
          {item('/', <IconHome size={19} />, 'Lobby')}
          {item('/rewards', <IconGift size={19} />, 'Rewards', claimable)}
          {item('/history', <IconHistory size={19} />, 'My bets')}
          {item('/account', <IconUser size={19} />, 'Account')}
        </nav>
        <div className="mt-4">
          {!collapsed ? <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">Earn coins</div> : <div className="mx-3 mb-2 h-px bg-line" />}
          <nav className="flex flex-col gap-0.5 rounded-xl bg-panel2/60 p-1.5">{item('/heist', <IconVault size={19} />, 'Vault Heist', picks || undefined, '#f7c548')}</nav>
        </div>
        {CATEGORIES.map((c) => (
          <div key={c.id} className="mt-4">
            {!collapsed ? <div className="px-3 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-dim">{c.name}</div> : <div className="mx-3 mb-2 h-px bg-line" />}
            <nav className="flex flex-col gap-0.5 rounded-xl bg-panel2/60 p-1.5">
              {GAMES.filter((g) => g.category === c.id).map((g) => item(`/game/${g.id}`, <GameIcon id={g.id} size={19} />, g.name, undefined, g.accent))}
            </nav>
          </div>
        ))}
        {!collapsed && <p className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-dim">Play money only. Coins have no cash value and can't be bought or withdrawn.</p>}
      </div>
    </aside>
  )
}

function TopBar({ onToggle, onSearch }: { onToggle: () => void; onSearch: () => void }) {
  const balance = useWallet((s) => s.balance)
  const xp = useWallet((s) => s.xp)
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const claimable = useClaimableCount()
  const [muted, setM] = useState(isMuted())
  const pct = Math.min(1, lv.into / lv.need)

  return (
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 bg-panel px-3 shadow-[0_6px_20px_-12px_rgba(0,0,0,.7)] sm:gap-3 sm:px-5">
      <button onClick={onToggle} className="hidden h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink lg:flex" aria-label="Toggle sidebar">
        <IconMenu />
      </button>
      <button className="lg:hidden" onClick={() => navigate('/')} aria-label="Lobby">
        <Logo compact />
      </button>
      <button
        onClick={onSearch}
        className="hidden h-10 w-[260px] items-center gap-2.5 rounded-lg bg-stage px-3 text-[13px] font-semibold text-dim transition hover:text-muted md:flex"
      >
        <IconSearch size={17} /> Search games
        <span className="ml-auto rounded border border-line px-1.5 text-[11px]">Ctrl K</span>
      </button>

      <div className="mx-auto flex items-center md:mx-0 md:ml-auto md:mr-auto">
        <div className="flex h-11 items-center gap-2 rounded-l-lg bg-stage pl-3 pr-4">
          <Coin size={20} />
          <AnimatedNumber value={balance} className="text-[15px] font-extrabold sm:text-[16px]" />
        </div>
        <button
          onClick={() => navigate('/rewards')}
          className="relative flex h-11 items-center gap-2 rounded-r-lg bg-accent px-4 text-[14px] font-extrabold text-[#032412] shadow-[inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110"
        >
          <IconGift size={18} />
          <span className="hidden sm:inline">Rewards</span>
          {claimable > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-panel bg-gold px-1 text-[10px] font-black text-[#2a1c00]">{claimable}</span>}
        </button>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <button onClick={onSearch} className="hidden h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-panel2 hover:text-ink sm:flex md:hidden" aria-label="Search">
          <IconSearch />
        </button>
        <button
          onClick={() => navigate('/rewards')}
          className="hidden items-center gap-2.5 rounded-lg px-2 py-1.5 transition hover:bg-panel2 sm:flex"
          title={`${Math.round(pct * 100)}% to level ${lv.level + 1}`}
        >
          <div className="relative h-9 w-9">
            <svg viewBox="0 0 36 36" className="h-9 w-9 -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#213a4c" strokeWidth="3.5" />
              <motion.circle
                cx="18"
                cy="18"
                r="15.5"
                fill="none"
                stroke={tier.color}
                strokeWidth="3.5"
                strokeLinecap="round"
                strokeDasharray={97.4}
                animate={{ strokeDashoffset: 97.4 * (1 - pct) }}
                transition={{ duration: 0.8 }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[12px] font-black">{lv.level}</span>
          </div>
          <div className="hidden text-left xl:block">
            <div className="text-[11px] font-semibold text-dim">VIP</div>
            <div className="text-[13px] font-bold" style={{ color: tier.color }}>
              {tier.name}
            </div>
          </div>
        </button>
        <button
          onClick={() => {
            setMuted(!muted)
            setM(!muted)
          }}
          className="hidden h-10 w-10 items-center justify-center rounded-lg text-muted transition hover:bg-panel2 hover:text-ink sm:flex"
          title={muted ? 'Unmute' : 'Mute'}
        >
          {muted ? <IconMute /> : <IconVolume />}
        </button>
        <UserMenu muted={muted} onMute={() => (setMuted(!muted), setM(!muted))} />
      </div>
    </header>
  )
}

function MobileNav({ route, onGames }: { route: string; onGames: () => void }) {
  const claimable = useClaimableCount()
  const profile = useAuth((s) => s.profile)
  const items: [string, ReactNode, string][] = [
    ['/', <IconHome />, 'Lobby'],
    ['games', <IconGrid />, 'Games'],
    ['/rewards', <IconGift />, 'Rewards'],
    ['/history', <IconHistory />, 'Bets'],
    ['/account', profile ? <Avatar index={profile.avatar} size={24} /> : <IconUser />, profile ? 'Me' : 'Account'],
  ]
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex bg-panel pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_24px_-12px_rgba(0,0,0,.7)] lg:hidden">
      {items.map(([to, icon, label]) => {
        const active = to === 'games' ? route.startsWith('/game/') : to === '/' ? route === '/' : route.startsWith(to)
        return (
          <button
            key={to}
            onClick={() => (to === 'games' ? onGames() : navigate(to))}
            className={`relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-bold transition ${active ? 'text-accent' : 'text-muted'}`}
          >
            {icon}
            {label}
            {to === '/rewards' && claimable > 0 && <span className="absolute right-[30%] top-2.5 h-2.5 w-2.5 rounded-full bg-gold" />}
          </button>
        )
      })}
    </nav>
  )
}

/** Top-right account control: log in and register for guests, an avatar menu for players. */
function UserMenu({ muted, onMute }: { muted: boolean; onMute: () => void }) {
  const status = useAuth((s) => s.status)
  const available = useAuth((s) => s.available)
  const profile = useAuth((s) => s.profile)
  const open = useAuth((s) => s.open)
  const xp = useWallet((s) => s.xp)
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setMenu(false)
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [menu])

  if (!available) return null
  if (status === 'loading')
    return (
      <div className="flex h-9 w-9 items-center justify-center">
        <Spinner size={22} className="text-accent" />
      </div>
    )
  if (status === 'guest' || !profile)
    return (
      <div className="flex items-center gap-1.5">
        <button onClick={() => open('login')} className="h-10 rounded-lg px-3 text-[14px] font-bold text-ink transition hover:bg-panel2 sm:bg-raised sm:px-4 sm:hover:bg-hover">
          Log in
        </button>
        <button onClick={() => open('register')} className="hidden h-10 rounded-lg bg-ink px-4 text-[14px] font-extrabold text-panel transition hover:bg-white sm:block">
          Register
        </button>
      </div>
    )

  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const go = (to: string) => (setMenu(false), navigate(to))
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setMenu(!menu)} className="flex items-center gap-2 rounded-full p-0.5 transition hover:brightness-110" aria-label="Account menu">
        <Avatar index={profile.avatar} size={38} ring={tier.color} />
      </button>
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-[calc(100%+8px)] z-50 w-60 origin-top-right overflow-hidden rounded-xl border border-line bg-panel shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)]"
          >
            <div className="flex items-center gap-3 border-b border-line p-3">
              <Avatar index={profile.avatar} size={40} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-extrabold">{profile.username}</div>
                <div className="text-[12px] font-semibold" style={{ color: tier.color }}>
                  {tier.name} · Level {lv.level}
                </div>
              </div>
            </div>
            <div className="p-1.5">
              {(
                [
                  ['/account', <IconUser size={17} />, 'Account'],
                  ['/rewards', <IconGift size={17} />, 'Rewards'],
                  ['/history', <IconHistory size={17} />, 'My bets'],
                ] as [string, ReactNode, string][]
              ).map(([to, icon, label]) => (
                <button key={to} onClick={() => go(to)} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-semibold text-muted transition hover:bg-panel2 hover:text-ink">
                  {icon}
                  {label}
                </button>
              ))}
              <button onClick={onMute} className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-semibold text-muted transition hover:bg-panel2 hover:text-ink sm:hidden">
                {muted ? <IconMute size={17} /> : <IconVolume size={17} />}
                {muted ? 'Sound off' : 'Sound on'}
              </button>
              <div className="my-1 h-px bg-line" />
              <button
                onClick={() => (setMenu(false), void logout())}
                className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-[14px] font-semibold text-muted transition hover:bg-panel2 hover:text-ink"
              >
                <IconLogout size={17} />
                Log out
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Ctrl+K game finder; also the mobile "Games" sheet. */
function SearchModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? GAMES.filter((g) => g.name.toLowerCase().includes(t) || g.tagline.toLowerCase().includes(t)) : GAMES
  }, [q])
  const go = (id: GameId) => {
    navigate(`/game/${id}`)
    onClose()
  }
  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-start sm:pt-[10vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div
        initial={{ y: 30, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80dvh] w-full max-w-[720px] flex-col overflow-hidden rounded-t-2xl bg-panel shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)] sm:rounded-2xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <IconSearch size={18} className="text-dim" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && list[0] && go(list[0].id)}
            placeholder="Search games"
            className="h-14 flex-1 bg-transparent text-[16px] font-semibold outline-none placeholder:text-dim"
          />
          <button onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-panel2 hover:text-ink" aria-label="Close">
            <IconX size={18} />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2.5 overflow-y-auto p-4 sm:grid-cols-4">
          {list.map((g) => (
            <button key={g.id} onClick={() => go(g.id)} className="group text-left">
              <div className="relative aspect-[4/5] overflow-hidden rounded-xl ring-1 ring-white/5 transition group-hover:-translate-y-1">
                <GameCover id={g.id} />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-2 pt-8 text-[13px] font-extrabold text-white">{g.name}</div>
              </div>
            </button>
          ))}
          {!list.length && <div className="col-span-full py-10 text-center text-[14px] text-muted">No games match “{q}”.</div>}
        </div>
      </motion.div>
    </motion.div>
  )
}
