/*
  Settings & security. For an account: the username and the sign-in email, the password, the bio and privacy of the
  public profile (kept in the wallet, so they are saved with it; setProfileInfo, then saved at once), the device's
  preferences, the sync state and logging out, and deleting the account. For a guest: the pitch for a free account,
  what this browser holds, and the preferences that work without one. The username, password, log-out and delete
  forms behave as they always have (src/lib/account.ts).
*/
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { Avatar } from '../../art/Avatar'
import { Field, FormError, PasswordField, Submit } from '../../components/AuthModal'
import { Coin, IconCheck, IconLogout } from '../../components/icons'
import { Toggle } from '../../components/ui'
import { authMessage, changePassword, deleteAccount, logout, save, updateProfile } from '../../lib/account'
import { fmt } from '../../lib/format'
import { navigate } from '../../lib/router'
import { setMuted, useMuted } from '../../lib/sound'
import { useAuth } from '../../store/auth'
import { BIO_MAX, CHALLENGES, DEFAULT_PRIVACY, cleanBio, useWallet, type Privacy } from '../../store/wallet'
import { ResetButton } from '../History'
import { CardHead, IconEye, IconGear, IconShield, Panel, accountNumber, saveSoon } from './kit'

export function SettingsTab() {
  const status = useAuth((s) => s.status)
  const available = useAuth((s) => s.available)
  if (status !== 'user')
    return (
      <div className="flex flex-col gap-4">
        <GuestPitch available={available} />
        <div className="grid gap-4 lg:grid-cols-2">
          <DeviceProgress />
          <Preferences guest />
        </div>
      </div>
    )
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ProfileForm />
        <PasswordForm />
        <BioForm />
        <PrivacyCard />
        <Preferences />
        <SessionCard />
      </div>
      <DangerZone />
    </div>
  )
}

function Row({ title, text, control }: { title: ReactNode; text: ReactNode; control: ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-bold">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-muted">{text}</div>
      </div>
      {control}
    </div>
  )
}

/** sound, the game finder's shortcut, and starting over */
function Preferences({ guest = false }: { guest?: boolean }) {
  const muted = useMuted()
  return (
    <Panel>
      <CardHead icon={<IconGear size={18} />} title="Preferences" sub="Kept on this device." />
      <Row title="Sound effects" text="Spins, cards, wins and the sounds of the tables." control={<Toggle on={!muted} onChange={(on) => setMuted(!on)} label="Sound effects" />} />
      <Row
        title="Find a game fast"
        text="Press these anywhere on a computer to open the game finder."
        control={
          <span className="flex shrink-0 gap-1 text-[12px] font-bold text-muted">
            <kbd className="rounded-md border border-line bg-stage px-2 py-1">Ctrl</kbd>
            <kbd className="rounded-md border border-line bg-stage px-2 py-1">K</kbd>
          </span>
        }
      />
      <Row title="Start over" text={guest ? 'Wipes your coins, level, history, rewards and cosmetics, and gives you a fresh 1,000.' : 'Wipes this account’s coins, level, history, rewards and cosmetics, and gives it a fresh 1,000.'} control={<ResetButton className="bg-stage" />} />
    </Panel>
  )
}

/** what a guest has built up in this browser: what an account would keep */
function DeviceProgress() {
  const balance = useWallet((s) => s.balance)
  const rounds = useWallet((s) => s.rounds ?? 0)
  const owned = useWallet((s) => s.owned)
  const streak = useWallet((s) => s.dailyStreak)
  const challenges = useWallet((s) => s.challenges)
  const done = CHALLENGES.filter((c) => challenges[c.id]?.claimed).length
  const tiles: [string, ReactNode][] = [
    [
      'Balance',
      <span className="flex items-center gap-1.5">
        {fmt(balance)} <Coin size={14} />
      </span>,
    ],
    ['Rounds played', fmt(rounds, 0)],
    ['Cosmetics bought', fmt(owned?.length ?? 0, 0)],
    ['Daily streak', `${streak} ${streak === 1 ? 'day' : 'days'}`],
    ['Challenges', `${done} of ${CHALLENGES.length}`],
    ['Saved in', 'This browser'],
  ]
  return (
    <Panel>
      <CardHead title="What this browser holds" sub="An account keeps all of this, on every device." />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
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

export function GuestPitch({ available, compact = false }: { available: boolean; compact?: boolean }) {
  const open = useAuth((s) => s.open)
  const balance = useWallet((s) => s.balance)
  const perks: [string, string][] = [
    ['Keep your coins everywhere', 'Your balance, level, cosmetics and badges follow you to any phone or computer.'],
    ['A public profile', 'Your banner, frame and showcase on a page other players can visit, and a place on the leaderboards.'],
    ['Never lose progress', 'Clearing your browser no longer wipes your wallet.'],
  ]
  return (
    <Panel flush>
      <div className={`relative overflow-hidden bg-[radial-gradient(ellipse_at_20%_0%,rgba(34,211,111,.22),transparent_60%),radial-gradient(ellipse_at_90%_100%,rgba(155,123,255,.25),transparent_60%)] ${compact ? 'p-5 sm:p-6' : 'p-6 sm:p-10'}`}>
        {!compact && (
          <div className="flex -space-x-3">
            {[0, 21, 4, 28, 31].map((i, k) => (
              <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: k * 0.06 }}>
                <Avatar index={i} size={52} ring="#112230" />
              </motion.div>
            ))}
          </div>
        )}
        <h2 className={`font-black leading-tight tracking-tight ${compact ? 'text-[21px]' : 'mt-5 text-[28px] sm:text-[34px]'}`}>Save your progress</h2>
        <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-muted">
          You're playing as a guest, so your <b className="tnum text-ink">{fmt(balance)}</b> coins and everything you've unlocked only live in this browser. A free account keeps them safe and brings them with you.
        </p>
        {!compact && (
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
        )}
        {available ? (
          <div className={`flex flex-col gap-2.5 sm:flex-row ${compact ? 'mt-4' : 'mt-7'}`}>
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
          <p className={`text-[13px] text-dim ${compact ? 'mt-3' : 'mt-7'}`}>Accounts aren't available in this preview.</p>
        )}
      </div>
    </Panel>
  )
}

export function SyncChip() {
  const sync = useAuth((s) => s.sync)
  const [label, cls] = sync === 'saving' ? ['Saving…', 'bg-raised text-muted'] : sync === 'error' ? ['Offline, will retry', 'bg-gold/15 text-gold'] : ['Saved', 'bg-accent/15 text-accent']
  return (
    <button onClick={() => void save()} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${cls}`} title="Save now">
      {label}
    </button>
  )
}

function ProfileForm() {
  const profile = useAuth((s) => s.profile)!
  const email = useAuth((s) => s.email)
  const [name, setName] = useState(profile.username)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedName, setSavedName] = useState(false)
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
  return (
    <Panel>
      <CardHead title="Profile" sub="Your name on your public profile, the leaderboards and the live games." />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Username" value={name} maxLength={16} autoComplete="username" onChange={(e) => setName(e.target.value.replace(/\s/g, ''))} hint="3 to 16 letters, numbers or underscores." />
        <FormError error={error} />
        <Submit busy={busy} disabled={name === profile.username || !/^[A-Za-z0-9_]{3,16}$/.test(name)}>
          {savedName ? 'Saved' : 'Save username'}
        </Submit>
      </form>
      <div className="mt-4 flex items-center gap-3 rounded-xl bg-stage/70 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-[11.5px] font-bold text-dim">Email</div>
          <div className="truncate text-[14px] font-bold" data-email>
            {email}
          </div>
        </div>
        <span className="shrink-0 text-[11.5px] font-semibold text-dim">For signing in and password resets</span>
      </div>
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
      <CardHead icon={<IconShield size={18} />} title="Password" sub="Use at least 8 characters." />
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

function BioForm() {
  const bio = useWallet((s) => s.profile?.bio ?? '')
  const setInfo = useWallet((s) => s.setProfileInfo)
  const [text, setText] = useState(bio)
  const [saved, setSaved] = useState(false)
  useEffect(() => setText(bio), [bio])
  const changed = cleanBio(text) !== bio
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setInfo({ bio: text })
    saveSoon()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }
  return (
    <Panel>
      <CardHead title="About you" sub="A line for your public profile." />
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div>
          <textarea
            value={text}
            maxLength={BIO_MAX}
            rows={3}
            onChange={(e) => setText(e.target.value.replace(/\n/g, ' '))}
            placeholder="Here for the 180s and the big multipliers."
            className="block w-full resize-none rounded-lg border-2 border-raised bg-stage px-3 py-2.5 text-[14.5px] font-semibold leading-snug outline-none transition placeholder:text-dim focus:border-hover"
            aria-label="Bio"
            data-bio
          />
          <div className="tnum mt-1 text-right text-[11.5px] font-semibold text-dim">
            {text.length} / {BIO_MAX}
          </div>
        </div>
        <Submit busy={false} disabled={!changed}>
          {saved ? 'Saved' : 'Save bio'}
        </Submit>
      </form>
    </Panel>
  )
}

function PrivacyCard() {
  const privacy = useWallet(useShallow((s) => ({ ...DEFAULT_PRIVACY, ...(s.profile?.privacy ?? {}) })))
  const setInfo = useWallet((s) => s.setProfileInfo)
  const set = (k: keyof Privacy, v: boolean) => {
    setInfo({ privacy: { [k]: v } })
    saveSoon()
  }
  const username = useAuth((s) => s.profile?.username)
  return (
    <Panel>
      <CardHead
        icon={<IconEye size={18} />}
        title="Privacy"
        sub="What other players see on your public profile."
        right={
          username ? (
            <button onClick={() => navigate(`/player/${encodeURIComponent(username)}`)} className="h-8 shrink-0 rounded-full bg-raised px-3 text-[12px] font-bold text-muted transition hover:bg-hover hover:text-ink">
              View
            </button>
          ) : undefined
        }
      />
      <Row title="Show my stats" text="Rounds, coins wagered, favourite games and achievements." control={<Toggle on={privacy.stats} onChange={(v) => set('stats', v)} label="Show my stats" />} />
      <Row title="Show my big wins" text="Your biggest wins among your recent rounds." control={<Toggle on={privacy.bets} onChange={(v) => set('bets', v)} label="Show my big wins" />} />
      <Row title="List me" text="Appear in player search and on the leaderboards." control={<Toggle on={privacy.listed} onChange={(v) => set('listed', v)} label="List me" />} />
    </Panel>
  )
}

function SessionCard() {
  const uid = useAuth((s) => s.uid)
  return (
    <Panel>
      <CardHead title="This session" sub="Your coins are saved to your account as you play." right={<SyncChip />} />
      <div className="mb-4 flex items-center justify-between rounded-xl bg-stage/70 px-3.5 py-3">
        <span className="text-[12px] font-bold text-dim">Account number</span>
        <span className="tnum text-[14px] font-extrabold tracking-wide">{accountNumber(uid)}</span>
      </div>
      <button onClick={() => void logout().then(() => navigate('/'))} className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-raised text-[15px] font-bold text-ink transition hover:bg-hover">
        <IconLogout size={18} /> Log out
      </button>
      <p className="mt-2.5 text-[12px] text-muted">Your coins stay saved in your account. This device goes back to a guest wallet.</p>
    </Panel>
  )
}

function DangerZone() {
  const username = useAuth((s) => s.profile?.username ?? '')
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
          <div className="mt-0.5 text-[13px] text-muted">Removes your account, username, profile and saved coins for good.</div>
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
            <button type="submit" disabled={typed !== username || busy} className="h-12 rounded-lg bg-danger text-[15px] font-extrabold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? 'Deleting…' : 'Delete forever'}
            </button>
          </div>
        </form>
      )}
    </Panel>
  )
}
