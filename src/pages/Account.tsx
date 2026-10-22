import { useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BojeLoader } from '../components/Loader'
import { Coin, IconChart, IconHistory, IconHome, IconTrophy } from '../components/icons'
import { TierBadge } from '../art/TierBadge'
import { fmt } from '../lib/format'
import { sfx } from '../lib/sound'
import { useAuth } from '../store/auth'
import { TIERS, levelFromXp, tierIndexOf, useWallet } from '../store/wallet'
import { IconBag, IconBrush, IconGear, IconShield, accountNumber, useIdentity } from './account/kit'
import { ACCOUNT_TABS, useAccountTab, type AccountTab } from './account/tab'
import { OverviewTab } from './account/Overview'
import { CustomizeTab } from './account/Customize'
import { ShopTab } from './account/Shop'
import { StatsTab } from './account/Stats'
import { ActivityTab } from './account/Activity'
import { AchievementsTab } from './account/Achievements'
import { SettingsTab } from './account/Settings'
import { LimitsTab } from './account/Responsible'

/*
  The player's account, laid out like a casino's "My account": a heading with the account number and the balance,
  a tab bar that stays in reach as the page scrolls, and eight tabs (./account/*):
    Overview      the profile header on the player's banner, the wallet, the numbers, recent activity, what's next
    Customize     the wardrobe, with a live preview of the profile card
    Shop          cosmetics for coins, with a try-on and a confirm step
    Statistics    lifetime figures, VIP progress, how rounds paid, favourite games, each game's breakdown
    History       rounds, rewards and purchases in one list
    Achievements  every badge, earned and locked, and the showcase
    Settings      username, email, password, bio and privacy, preferences, log out, delete (for a guest: the pitch)
    Responsible   daily loss limit, session reminder, cool-off
  Guests get every tab; what needs an account (the avatar, the public profile, the security forms) says so. The tab is
  not in the address: it is remembered for the visit (./account/tab.ts), and openAccount(tab) opens the page on one.
*/

// dev only: the stores on window, for seeding and reading states in the page checks (tools/account-*)
if (import.meta.env.DEV) Object.assign(window as object, { __wallet: useWallet, __auth: useAuth })

const ICONS: Record<AccountTab, (s: number) => ReactNode> = {
  overview: (s) => <IconHome size={s} />,
  customize: (s) => <IconBrush size={s} />,
  shop: (s) => <IconBag size={s} />,
  stats: (s) => <IconChart size={s} />,
  history: (s) => <IconHistory size={s} />,
  achievements: (s) => <IconTrophy size={s} />,
  settings: (s) => <IconGear size={s} />,
  limits: (s) => <IconShield size={s} />,
}

export default function Account() {
  const status = useAuth((s) => s.status)
  const tab = useAccountTab((s) => s.tab)
  if (status === 'loading')
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl bg-panel">
        <BojeLoader />
      </div>
    )
  const content: Record<AccountTab, ReactNode> = {
    overview: <OverviewTab />,
    customize: <CustomizeTab />,
    shop: <ShopTab />,
    stats: <StatsTab />,
    history: <ActivityTab />,
    achievements: <AchievementsTab />,
    settings: <SettingsTab />,
    limits: <LimitsTab />,
  }
  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-3" data-account-page>
      <Heading />
      <TabBar />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: 'easeOut' }} className="pt-1" data-account-tab={tab}>
          {content[tab]}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function Heading() {
  const me = useIdentity()
  const balance = useWallet((s) => s.balance)
  const xp = useWallet((s) => s.xp)
  const level = levelFromXp(xp).level
  const t = tierIndexOf(level)
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[26px] font-black tracking-tight">My account</h1>
        <p className="tnum truncate text-[13px] text-muted">{me.account ? `${accountNumber(me.uid)} · signed in as ${me.name}` : `Guest · ${me.name} · saved in this browser`}</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="flex h-10 items-center gap-2 rounded-full bg-panel px-3 text-[13px] font-extrabold ring-1 ring-white/[.04]">
          <TierBadge color={TIERS[t].color} rank={t} size={20} />
          <span style={{ color: TIERS[t].color }}>{TIERS[t].name}</span>
          <span className="tnum text-dim">Lv {level}</span>
        </span>
        <span className="tnum hidden h-10 items-center gap-1.5 rounded-full bg-panel px-3.5 text-[14px] font-extrabold ring-1 ring-white/[.04] sm:flex" data-account-balance>
          {fmt(balance)} <Coin size={17} />
        </span>
      </div>
    </div>
  )
}

function TabBar() {
  const tab = useAccountTab((s) => s.tab)
  const setTab = useAccountTab((s) => s.setTab)
  const row = useRef<HTMLDivElement>(null)
  // keep the open tab in view on a narrow screen
  useEffect(() => {
    const el = row.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
    const box = row.current
    if (!el || !box) return
    const left = el.offsetLeft - box.clientWidth / 2 + el.clientWidth / 2
    box.scrollTo({ left, behavior: 'smooth' })
  }, [tab])
  return (
    <div className="sticky top-0 z-20 -mx-3 bg-bg/90 px-3 py-2 backdrop-blur-md sm:-mx-5 sm:px-5">
      <div ref={row} role="tablist" aria-label="Account" className="no-scrollbar flex gap-1 overflow-x-auto rounded-2xl bg-panel p-1 ring-1 ring-white/[.04]">
        {ACCOUNT_TABS.map((t) => {
          const on = t.id === tab
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={on}
              data-tab={t.id}
              onClick={() => {
                if (on) return
                sfx.click()
                setTab(t.id)
              }}
              className={`relative flex h-10 shrink-0 items-center gap-2 rounded-xl px-3.5 text-[13px] font-bold transition-colors lg:flex-1 lg:justify-center ${on ? 'text-ink' : 'text-muted hover:text-ink'}`}
            >
              {on && <motion.span layoutId="account-tab" className="absolute inset-0 rounded-xl bg-raised shadow-[0_2px_8px_rgba(0,0,0,.3),inset_0_1px_0_rgba(255,255,255,.06)]" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
              <span className={`relative ${on ? 'text-accent' : ''}`}>{ICONS[t.id](16)}</span>
              <span className="relative whitespace-nowrap">
                <span className="xl:hidden">{t.short}</span>
                <span className="hidden xl:inline">{t.name}</span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
