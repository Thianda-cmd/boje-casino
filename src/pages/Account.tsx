import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { Avatar, AVATAR_COUNT } from '../art/Avatar'
import { TierBadge } from '../art/TierBadge'
import { Field, FormError, PasswordField, Submit } from '../components/AuthModal'
import { Coin, IconCheck } from '../components/icons'
import { authMessage, changePassword, deleteAccount, logout, save, updateProfile } from '../lib/account'
import { fmt } from '../lib/format'
import { navigate } from '../lib/router'
import { useAuth } from '../store/auth'
import { CHALLENGES, levelFromXp, tierOf, TIERS, useWallet } from '../store/wallet'
import { BojeLoader } from '../components/Loader'
import { Toggle } from '../components/ui'
import { GameCover } from '../components/covers'
import { gameInfo, type GameId } from '../store/games'
import { setMuted, useMuted } from '../lib/sound'
import { ResetButton } from './History'

/* The player's account: profile, avatar, password, favourite games, settings, sign-out and deletion. Guests get the
   pitch, what they have built up on this device, and the settings. */

function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden rounded-2xl bg-panel p-5 shadow-[0_24px_60px_-30px_rgba(0,0,0,.8)] sm:p-6 ${className}`}>{children}</div>
}

function H({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="mb-4">
      <div className="text-[16px] font-extrabold">{children}</div>
      {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
    </div>
  )
}

export default function Account() {
  const status = useAuth((s) => s.status)
  const available = useAuth((s) => s.available)
  if (status === 'loading')
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl bg-panel">
        <BojeLoader />
      </div>
    )
  if (status !== 'user')
    return (
      <div className="mx-auto flex max-w-[980px] flex-col gap-4">
        <GuestPitch available={available} />
        <div className="grid gap-4 lg:grid-cols-2">
          <DeviceProgress />
          <Settings />
        </div>
      </div>
    )
  return <Profile />
}

/** a level badge with the bar to the next level */
function LevelBar() {
  const xp = useWallet((s) => s.xp)
  const lv = levelFromXp(xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  return (
    <button onClick={() => navigate('/rewards')} className="flex w-full items-center gap-3 rounded-xl bg-stage/60 p-3 text-left transition hover:bg-stage">
      <TierBadge color={tier.color} rank={rank} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[15px] font-extrabold" style={{ color: tier.color }}>
            {tier.name} · Level {lv.level}
          </span>
          <span className="tnum text-[12px] font-semibold text-dim">
            {fmt(lv.into, 0)} / {fmt(lv.need, 0)} XP
          </span>
        </span>
        <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-black/30">
          <span className="block h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, (lv.into / lv.need) * 100))}%`, background: tier.color }} />
        </span>
      </span>
    </button>
  )
}

/** what a guest has built up in this browser: what an account would keep */
function DeviceProgress() {
  const balance = useWallet((s) => s.balance)
  const rounds = useWallet((s) => s.rounds ?? 0)
  const biggest = useWallet((s) => s.biggestWin)
  const streak = useWallet((s) => s.dailyStreak)
  const challenges = useWallet((s) => s.challenges)
  const done = CHALLENGES.filter((c) => challenges[c.id]?.claimed).length
  const tiles: [string, ReactNode][] = [
    ['Balance', <span className="flex items-center gap-1.5">{fmt(balance)} <Coin size={14} /></span>],
    ['Rounds played', fmt(rounds, 0)],
    ['Biggest win', fmt(biggest)],
    ['Daily streak', `${streak} ${streak === 1 ? 'day' : 'days'}`],
    ['Challenges', `${done} of ${CHALLENGES.length}`],
    ['Saved in', 'This browser'],
  ]
  return (
    <Panel>
      <H sub="An account keeps all of this, on every device.">Your progress so far</H>
      <LevelBar />
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-xl bg-stage/60 px-3 py-2.5">
            <div className="text-[11.5px] font-semibold text-dim">{k}</div>
            <div className="tnum mt-0.5 truncate text-[15px] font-extrabold">{v}</div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

/** sound, the game finder's shortcut, and starting over */
function Settings() {
  const muted = useMuted()
  const row = (title: string, text: string, control: ReactNode) => (
    <div className="flex items-center gap-4 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-muted">{text}</div>
      </div>
      {control}
    </div>
  )
  return (
    <Panel>
      <H sub="Kept on this device.">Settings</H>
      <div>
        {row('Sound effects', 'Spins, cards, wins and the sounds of the tables.', <Toggle on={!muted} onChange={(on) => setMuted(!on)} label="Sound effects" />)}
        {row(
          'Find a game fast',
          'Press these anywhere on a computer to open the game finder.',
          <span className="flex shrink-0 gap-1 text-[12px] font-bold text-muted">
            <kbd className="rounded-md border border-line bg-stage px-2 py-1">Ctrl</kbd>
            <kbd className="rounded-md border border-line bg-stage px-2 py-1">K</kbd>
          </span>,
        )}
        {row('Start over', 'Wipes your coins, level, history and rewards, and gives you a fresh 1,000.', <ResetButton className="bg-stage" />)}
      </div>
    </Panel>
  )
}

/** the games played most: the bets of 25 or more counted for challenges, or the rounds kept, whichever is more */
function FavouriteGames() {
  const played = useWallet((s) => s.gamesPlayed)
  const bets = useWallet((s) => s.bets)
  const top = useMemo(() => {
    const n = new Map<string, number>(Object.entries(played).map(([k, v]) => [k, v ?? 0]))
    const recent = new Map<string, number>()
    for (const b of bets) recent.set(b.game, (recent.get(b.game) ?? 0) + 1)
    for (const [k, v] of recent) n.set(k, Math.max(n.get(k) ?? 0, v))
    return [...n.entries()].filter(([id, v]) => v > 0 && !gameInfo(id).retired).sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [played, bets])
  return (
    <Panel>
      <H sub="The games you play most.">Favourite games</H>
      {top.length ? (
        <div className="grid grid-cols-4 gap-2.5">
          {top.map(([id, n]) => (
            <button key={id} onClick={() => navigate(`/game/${id}`)} className="group min-w-0 text-left">
              <div className="aspect-[4/5] overflow-hidden rounded-lg ring-1 ring-white/5 transition group-hover:-translate-y-0.5">
                <GameCover id={id as GameId} />
              </div>
              <div className="mt-1.5 truncate text-[12.5px] font-bold">{gameInfo(id).name}</div>
              <div className="tnum text-[11.5px] text-dim">{fmt(n, 0)} rounds</div>
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-stage/60 p-4 text-[13px] text-muted">Play a few rounds and the games you come back to will show up here.</p>
      )}
    </Panel>
  )
}

function GuestPitch({ available }: { available: boolean }) {
  const open = useAuth((s) => s.open)
  const balance = useWallet((s) => s.balance)
  const perks: [string, string][] = [
    ['Keep your coins everywhere', 'Your balance, level and challenges follow you to any phone or computer.'],
    ['Never lose progress', 'Clearing your browser no longer wipes your wallet.'],
    ['Your name on the board', 'Crash shows your username to everyone in the round.'],
  ]
  return (
    <Panel className="!p-0">
      <div className="relative overflow-hidden bg-[radial-gradient(ellipse_at_20%_0%,rgba(34,211,111,.22),transparent_60%),radial-gradient(ellipse_at_90%_100%,rgba(155,123,255,.25),transparent_60%)] p-6 sm:p-10">
        <div className="flex -space-x-3">
          {[0, 9, 4, 14, 3].map((i, k) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}>
              <Avatar index={i} size={52} ring="#112230" />
            </motion.div>
          ))}
        </div>
        <h1 className="mt-5 text-[28px] font-black leading-tight tracking-tight sm:text-[34px]">Save your progress</h1>
        <p className="mt-2 max-w-[520px] text-[15px] leading-relaxed text-muted">
          You're playing as a guest, so your <b className="tnum text-ink">{fmt(balance)}</b> coins only live in this browser. A free account keeps them safe and brings them with you.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {perks.map(([t, d]) => (
            <div key={t} className="rounded-xl bg-panel/70 p-4 backdrop-blur">
              <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[#032412]">
                <IconCheck size={15} />
              </div>
              <div className="text-[14px] font-extrabold">{t}</div>
              <div className="mt-1 text-[13px] leading-relaxed text-muted">{d}</div>
            </div>
          ))}
        </div>
        {available ? (
          <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
            <button
              onClick={() => open('register')}
              className="h-12 rounded-lg bg-accent px-7 text-[15px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16)] transition hover:brightness-110"
            >
              Create free account
            </button>
            <button onClick={() => open('login')} className="h-12 rounded-lg bg-raised px-7 text-[15px] font-bold text-ink transition hover:bg-hover">
              I have an account
            </button>
          </div>
        ) : (
          <p className="mt-7 text-[13px] text-dim">Accounts aren't available in this preview.</p>
        )}
      </div>
    </Panel>
  )
}

function Profile() {
  const profile = useAuth((s) => s.profile)!
  const email = useAuth((s) => s.email)
  const sync = useAuth((s) => s.sync)
  const w = useWallet()
  const lv = levelFromXp(w.xp)
  const tier = tierOf(lv.level)
  const rank = TIERS.findIndex((t) => t.name === tier.name)
  const since = profile.createdAt ? new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : null

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-4">
      <Panel className="!p-0">
        <div className="flex flex-col gap-5 bg-[radial-gradient(ellipse_at_0%_0%,rgba(34,211,111,.16),transparent_55%)] p-5 sm:flex-row sm:items-center sm:p-7">
          <Avatar index={profile.avatar} size={88} ring={tier.color} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-[26px] font-black tracking-tight">{profile.username}</h1>
              <SyncChip sync={sync} />
            </div>
            <div className="mt-0.5 truncate text-[14px] text-muted">{email}</div>
            {since && <div className="mt-0.5 text-[12px] text-dim">Member since {since}</div>}
          </div>
          <button onClick={() => navigate('/rewards')} className="flex items-center gap-3 rounded-xl bg-stage/70 px-4 py-3 text-left transition hover:bg-stage">
            <TierBadge color={tier.color} rank={rank} size={40} />
            <div>
              <div className="text-[12px] font-semibold text-dim">Level {lv.level}</div>
              <div className="text-[15px] font-extrabold" style={{ color: tier.color }}>
                {tier.name}
              </div>
            </div>
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-4">
          {(
            [
              ['Balance', <span className="flex items-center gap-1.5">{fmt(w.balance)} <Coin size={15} /></span>],
              ['Wagered', fmt(w.totalWagered)],
              ['Rounds played', fmt(w.rounds ?? 0, 0)],
              ['Biggest win', fmt(w.biggestWin)],
            ] as [string, ReactNode][]
          ).map(([k, v]) => (
            <div key={k} className="bg-panel px-5 py-4">
              <div className="text-[12px] font-semibold text-dim">{k}</div>
              <div className="tnum mt-0.5 text-[17px] font-extrabold">{v}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileForm />
        <PasswordForm />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FavouriteGames />
        <Settings />
      </div>

      <Panel>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <div className="text-[16px] font-extrabold">Log out</div>
            <div className="mt-0.5 text-[13px] text-muted">Your coins stay saved in your account. This device goes back to a guest wallet.</div>
          </div>
          <button onClick={() => void logout().then(() => navigate('/'))} className="h-12 rounded-lg bg-raised px-6 text-[15px] font-bold text-ink transition hover:bg-hover">
            Log out
          </button>
        </div>
      </Panel>

      <DangerZone username={profile.username} />
    </div>
  )
}

function SyncChip({ sync }: { sync: 'idle' | 'saving' | 'error' }) {
  const [label, cls] =
    sync === 'saving' ? ['Saving…', 'bg-raised text-muted'] : sync === 'error' ? ['Offline, will retry', 'bg-gold/15 text-gold'] : ['Saved', 'bg-accent/15 text-accent']
  return (
    <button onClick={() => void save()} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`} title="Save now">
      {label}
    </button>
  )
}

function ProfileForm() {
  const profile = useAuth((s) => s.profile)!
  const [name, setName] = useState(profile.username)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState(false)
  const pushToast = useWallet((s) => s.pushToast)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (name === profile.username) return
    setBusy(true)
    setError(null)
    const r = await updateProfile({ username: name })
    setBusy(false)
    if (r.ok) {
      setSavedName(true)
      setTimeout(() => setSavedName(false), 1500)
    } else setError(authMessage(r.error))
  }
  const pick = async (i: number) => {
    if (i === profile.avatar) return
    const r = await updateProfile({ avatar: i })
    if (!r.ok) pushToast({ kind: 'info', title: authMessage(r.error) })
  }

  return (
    <Panel>
      <H sub="Shown to other players in Crash.">Profile</H>
      <div className="mb-5 grid grid-cols-8 gap-2">
        {Array.from({ length: AVATAR_COUNT }, (_, i) => (
          <button
            key={i}
            onClick={() => void pick(i)}
            aria-label={`Avatar ${i + 1}`}
            className={`aspect-square rounded-full p-0.5 transition ${profile.avatar === i ? 'ring-2 ring-accent' : 'opacity-60 hover:opacity-100'}`}
          >
            <Avatar index={i} size={64} className="h-full w-full" />
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Username" value={name} maxLength={16} autoComplete="username" onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} hint="3 to 16 letters, numbers or underscores." />
        <FormError error={error} />
        <Submit busy={busy} disabled={name === profile.username || !/^[A-Za-z0-9_]{3,16}$/.test(name)}>
          {savedName ? 'Saved' : 'Save username'}
        </Submit>
      </form>
    </Panel>
  )
}

function PasswordForm() {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await changePassword(pw)
    setBusy(false)
    if (r.ok) {
      setPw('')
      setDone(true)
      setTimeout(() => setDone(false), 2000)
    } else setError(authMessage(r.error))
  }
  return (
    <Panel>
      <H sub="Use at least 8 characters.">Password</H>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <PasswordField label="New password" value={pw} onChange={setPw} autoComplete="new-password" />
        <FormError error={error} />
        <Submit busy={busy} disabled={pw.length < 8}>
          {done ? 'Password changed' : 'Change password'}
        </Submit>
      </form>
    </Panel>
  )
}

function DangerZone({ username }: { username: string }) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await deleteAccount()
    setBusy(false)
    if (r.ok) {
      useWallet.getState().pushToast({ kind: 'info', title: 'Your account was deleted.' })
      navigate('/')
    } else setError(authMessage(r.error))
  }
  return (
    <Panel className="border border-danger/25">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <div className="text-[16px] font-extrabold text-danger">Delete account</div>
          <div className="mt-0.5 text-[13px] text-muted">Removes your account, username and saved coins for good.</div>
        </div>
        {!open && (
          <button onClick={() => setOpen(true)} className="h-12 rounded-lg bg-danger/15 px-6 text-[15px] font-bold text-danger transition hover:bg-danger/25">
            Delete account
          </button>
        )}
      </div>
      {open && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
          <Field label={`Type ${username} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          <FormError error={error} />
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => (setOpen(false), setTyped(''))} className="h-12 rounded-lg bg-raised text-[15px] font-bold text-ink hover:bg-hover">
              Keep account
            </button>
            <button
              type="submit"
              disabled={typed !== username || busy}
              className="h-12 rounded-lg bg-danger text-[15px] font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  )
}
