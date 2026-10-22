/*
  The Overview: the profile header on the player's banner, then the wallet beside the quick stats, the recent
  activity beside the achievements closest to done, and the favourite games. A guest gets the sign-up pitch under
  the header, and the header says the progress lives in this browser.
*/
import { useShallow } from 'zustand/react/shallow'
import { BadgeIcon } from '../../art/cosmetics'
import { AnimatedNumber } from '../../components/ui'
import { Coin, IconGift, IconHistory, IconTrophy, IconUser } from '../../components/icons'
import { fmt, fmtCompact } from '../../lib/format'
import { navigate } from '../../lib/router'
import { useNow } from '../../lib/useNow'
import { useAuth } from '../../store/auth'
import { CHALLENGES, lossToday, useClaimableCount, useWallet } from '../../store/wallet'
import { allAchievements, earnedAchievements } from '../../store/cosmetics'
import { Bar, CardHead, Figure, Glow, IconBag, IconBrush, IconEye, Panel, achievementProgress, accountNumber, useIdentity, useLook, useWardrobe } from './kit'
import { ProfileHeader } from './ProfileHeader'
import { FeedRow, useFeed } from './Activity'
import { FavouriteGames } from './Stats'
import { GuestPitch, SyncChip } from './Settings'
import { useAccountTab } from './tab'
import { RARITY } from '../../art/cosmetics'

const big = (n: number) => (Math.abs(n) >= 1e6 ? fmtCompact(n) : fmt(n))

export function OverviewTab() {
  const me = useIdentity()
  const look = useLook()
  const xp = useWallet((s) => s.xp)
  const setTab = useAccountTab((s) => s.setTab)
  const available = useAuth((s) => s.available)
  const open = useAuth((s) => s.open)
  const since = me.createdAt ? new Date(me.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : null
  const meta = me.account ? (
    <>
      <span className="inline-flex items-center gap-1.5">
        <IconUser size={15} className="text-dim" /> {since ? `Member since ${since}` : 'Member'}
      </span>
      <span className="tnum inline-flex items-center gap-1.5" data-account-number>
        <span className="text-dim">Account</span> {accountNumber(me.uid)}
      </span>
      <SyncChip />
    </>
  ) : (
    <>
      <span className="inline-flex items-center gap-1.5">
        <IconUser size={15} className="text-dim" /> Guest on this device
      </span>
      <span className="text-dim">Progress is saved in this browser</span>
    </>
  )
  const actions = me.account ? (
    <>
      <button onClick={() => setTab('customize')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-raised px-4 text-[13px] font-bold transition hover:bg-hover">
        <IconBrush size={16} /> Customize
      </button>
      <button onClick={() => navigate(`/player/${encodeURIComponent(me.name)}`)} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-extrabold text-[#032412] transition hover:brightness-110" data-public-profile>
        <IconEye size={16} /> View public profile
      </button>
    </>
  ) : (
    <>
      <button onClick={() => setTab('customize')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-raised px-4 text-[13px] font-bold transition hover:bg-hover">
        <IconBrush size={16} /> Customize
      </button>
      {available && (
        <button onClick={() => open('register')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-4 text-[13px] font-extrabold text-[#032412] transition hover:brightness-110">
          Create free account
        </button>
      )}
    </>
  )
  return (
    <div className="flex flex-col gap-4">
      <ProfileHeader look={look} avatar={me.avatar} name={me.name} xp={xp} meta={meta} actions={actions} onBadges={() => setTab('achievements')} />
      {!me.account && <GuestPitch available={available} compact />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <WalletCard />
        <QuickStats />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <RecentActivity />
        <UpNext />
      </div>
      <FavouriteGames />
    </div>
  )
}

function WalletCard() {
  const balance = useWallet((s) => s.balance)
  const loss = useWallet((s) => lossToday(s))
  const ready = useClaimableCount()
  const setTab = useAccountTab((s) => s.setTab)
  const net = -loss
  return (
    <Panel className="flex flex-col">
      <Glow color="#f7c548" className="-right-16 -top-20 h-64 w-64" opacity={0.16} />
      <div className="text-[12.5px] font-bold text-dim">Balance</div>
      <div className="mt-1 flex items-center gap-2 text-[34px] font-black leading-none tracking-tight" data-overview-balance>
        <AnimatedNumber value={balance} />
        <Coin size={26} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Figure label="Today" value={`${net > 0 ? '+' : net < 0 ? '−' : ''}${fmt(Math.abs(net))}`} tone={net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : ''} />
        <Figure label="Rewards ready" value={ready} tone={ready ? 'text-gold' : ''} />
      </div>
      <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
        <button onClick={() => navigate('/rewards')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(180deg,#ffd75e,#f2b134)] text-[13.5px] font-extrabold text-[#2a1c00] shadow-[0_10px_26px_-12px_rgba(247,197,72,.9),inset_0_-3px_0_rgba(0,0,0,.14)] transition hover:brightness-105">
          <IconGift size={17} /> Free coins
        </button>
        <button onClick={() => setTab('shop')} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-raised text-[13.5px] font-bold transition hover:bg-hover">
          <IconBag size={17} /> Shop
        </button>
      </div>
    </Panel>
  )
}

function QuickStats() {
  const s = useWallet(useShallow((w) => ({ rounds: w.rounds ?? 0, wagered: w.totalWagered, won: w.totalWon, biggest: w.biggestWin, streak: w.dailyStreak, challenges: w.challenges })))
  const setTab = useAccountTab((t) => t.setTab)
  const net = s.won - s.wagered
  const done = CHALLENGES.filter((c) => s.challenges?.[c.id]?.claimed).length
  return (
    <Panel>
      <CardHead
        title="Your numbers"
        sub="Lifetime, across every game."
        right={
          <button onClick={() => setTab('stats')} className="h-8 shrink-0 rounded-full bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
            All stats
          </button>
        }
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Figure label="Rounds played" value={fmt(s.rounds, 0)} />
        <Figure label="Wagered" value={big(s.wagered)} />
        <Figure label="Won" value={big(s.won)} />
        <Figure label="Net result" value={`${net > 0 ? '+' : net < 0 ? '−' : ''}${big(Math.abs(net))}`} tone={net > 0 ? 'text-accent' : net < 0 ? 'text-danger' : ''} />
        <Figure label="Biggest win" value={big(s.biggest)} tone={s.biggest > 0 ? 'text-gold' : ''} />
        <Figure label="Challenges" value={`${done} / ${CHALLENGES.length}`} />
      </div>
    </Panel>
  )
}

function RecentActivity() {
  const now = useNow(30_000)
  const feed = useFeed().slice(0, 6)
  const setTab = useAccountTab((s) => s.setTab)
  return (
    <Panel className="flex flex-col">
      <CardHead
        icon={<IconHistory size={18} />}
        title="Recent activity"
        right={
          <button onClick={() => setTab('history')} className="h-8 shrink-0 rounded-full bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
            See all
          </button>
        }
      />
      {feed.length ? (
        <div className="-mx-2.5 -mb-2">
          {feed.map((it, i) => (
            <FeedRow key={it.key} it={it} now={now} i={i} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-stage/60 p-4 text-[13px] text-muted">Rounds, rewards and purchases will show up here as they happen.</p>
      )}
    </Panel>
  )
}

/** the achievements closest to done (one ready to claim first) */
function UpNext() {
  const w = useWardrobe()
  const source = useWallet(useShallow((s) => ({ xp: s.xp, rounds: s.rounds, totalWagered: s.totalWagered, totalWon: s.totalWon, biggestWin: s.biggestWin, dailyStreak: s.dailyStreak, heist: s.heist, challenges: s.challenges })))
  const setTab = useAccountTab((s) => s.setTab)
  const all = allAchievements()
  const earned = new Set(earnedAchievements(w.source))
  const next = all
    .filter((a) => !earned.has(a.id))
    .map((a) => ({ a, p: achievementProgress(a, source) }))
    .filter((x) => x.p && (x.p.ready || x.p.cur > 0 || x.a.id.startsWith('tier-') || x.a.id === 'first-win' || x.a.id === 'rounds-100'))
    .sort((x, y) => Number(!!y.p!.ready) - Number(!!x.p!.ready) || y.p!.cur / y.p!.goal - x.p!.cur / x.p!.goal)
    .slice(0, 3)
  return (
    <Panel className="flex flex-col">
      <CardHead
        icon={<IconTrophy size={18} />}
        title="Achievements"
        right={
          <button onClick={() => setTab('achievements')} className="h-8 shrink-0 rounded-full bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
            All {all.length}
          </button>
        }
      />
      <div className="flex items-center justify-between text-[12.5px] font-bold">
        <span className="text-muted">Earned</span>
        <span className="tnum">
          {earned.size} <span className="text-dim">/ {all.length}</span>
        </span>
      </div>
      <Bar pct={(earned.size / all.length) * 100} color="#f7c548" className="mt-1.5 h-2" />
      <div className="mt-4 text-[11.5px] font-extrabold uppercase tracking-[.08em] text-dim">Up next</div>
      <div className="mt-1.5 flex flex-col gap-1">
        {next.map(({ a, p }) => (
          <button key={a.id} onClick={() => (p!.ready ? navigate('/rewards') : setTab('achievements'))} className="flex items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-panel2">
            <BadgeIcon id={a.id} size={40} locked={!p!.ready} />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[13px] font-bold">{a.name}</span>
                <span className={`tnum shrink-0 text-[11px] font-bold ${p!.ready ? 'text-gold' : 'text-dim'}`}>{p!.ready ? 'Claim' : p!.text}</span>
              </span>
              <Bar pct={(p!.cur / p!.goal) * 100} color={RARITY[a.rarity].color} className="mt-1.5 h-1" />
            </span>
          </button>
        ))}
        {!next.length && <p className="text-[12.5px] text-muted">Play a few rounds to get going.</p>}
      </div>
    </Panel>
  )
}
