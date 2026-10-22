import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Modal } from './Modal'
import { Coin } from './icons'
import { Avatar } from '../art/Avatar'
import { FREE_AVATARS } from '../store/cosmetics'
import { authMessage, changePassword, login, register, sendReset, usernameFree } from '../lib/account'
import { fmt } from '../lib/format'
import { useAuth, type AuthView } from '../store/auth'
import { STARTING_BALANCE, useWallet } from '../store/wallet'
import { Spinner } from './Loader'

/* Log in, register, forgotten password and the new-password form a reset link opens. */

export function AuthModal() {
  const view = useAuth((s) => s.view)
  const close = useAuth((s) => s.close)
  return <AnimatePresence>{view && <AuthDialog key="auth" view={view} onClose={close} />}</AnimatePresence>
}

const TITLES: Record<AuthView, string> = {
  login: 'Welcome back',
  register: 'Create your account',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
}

function AuthDialog({ view, onClose }: { view: AuthView; onClose: () => void }) {
  const open = useAuth((s) => s.open)
  return (
    <Modal onClose={onClose} title={TITLES[view]} width={440}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.16 }}>
          {view === 'login' && <LoginForm onDone={onClose} go={open} />}
          {view === 'register' && <RegisterForm onDone={onClose} go={open} />}
          {view === 'forgot' && <ForgotForm go={open} />}
          {view === 'reset' && <ResetForm onDone={onClose} />}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}

/* ---------------- shared bits ---------------- */

export function Field({
  label,
  hint,
  right,
  ...input
}: { label: string; hint?: ReactNode; right?: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-[12px] font-semibold text-muted">
        <label htmlFor={id}>{label}</label>
        {right}
      </div>
      <input
        {...input}
        id={id}
        className="h-12 w-full rounded-lg border-2 border-raised bg-stage px-3 text-[16px] font-semibold text-ink shadow-[inset_0_1px_3px_rgba(0,0,0,.25)] outline-none transition-colors placeholder:font-medium placeholder:text-dim hover:border-hover focus:border-accent/70"
      />
      {hint && <span className="mt-1.5 block text-[12px] text-dim">{hint}</span>}
    </div>
  )
}

export function PasswordField({ label, value, onChange, autoComplete }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false)
  return (
    <Field
      label={label}
      type={show ? 'text' : 'password'}
      value={value}
      autoComplete={autoComplete}
      onChange={(e) => onChange(e.target.value)}
      right={
        <button type="button" onClick={() => setShow(!show)} className="rounded px-1.5 text-[12px] font-bold text-dim hover:text-ink">
          {show ? 'Hide' : 'Show'}
        </button>
      }
      hint={autoComplete === 'new-password' ? <Strength pw={value} /> : undefined}
    />
  )
}

function Strength({ pw }: { pw: string }) {
  const score = !pw ? 0 : Math.min(4, (pw.length >= 8 ? 1 : 0) + (pw.length >= 12 ? 1 : 0) + (/[A-Z]/.test(pw) && /[a-z]/.test(pw) ? 1 : 0) + (/[\d\W_]/.test(pw) ? 1 : 0))
  const colors = ['#2f4553', '#ff4d61', '#f7c548', '#7fe3ff', '#22d36f']
  return (
    <span className="flex items-center gap-2">
      <span className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span key={i} className="h-1 flex-1 rounded-full transition-colors" style={{ background: score >= i ? colors[score] : colors[0] }} />
        ))}
      </span>
      <span className="shrink-0 whitespace-nowrap text-right">{pw.length < 8 ? 'At least 8 characters' : ['', 'Weak', 'Okay', 'Good', 'Strong'][score]}</span>
    </span>
  )
}

export function Submit({ busy, children, disabled }: { busy: boolean; children: ReactNode; disabled?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      type="submit"
      disabled={busy || disabled}
      className="flex h-[52px] w-full items-center justify-center gap-2 rounded-lg bg-accent text-[16px] font-extrabold text-[#032412] shadow-[0_8px_22px_-10px_rgba(34,211,111,.8),inset_0_-3px_0_rgba(0,0,0,.16),inset_0_1px_0_rgba(255,255,255,.35)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {busy && <Spinner size={18} />}
      {children}
    </motion.button>
  )
}

export function FormError({ error }: { error: string | null }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="overflow-hidden rounded-lg bg-danger/12 px-3 py-2.5 text-[13px] font-semibold text-danger"
        >
          {error}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const linkCls = 'font-bold text-accent hover:underline underline-offset-2'

/* ---------------- forms ---------------- */

function LoginForm({ onDone, go }: { onDone: () => void; go: (v: AuthView) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await login(email, password)
    setBusy(false)
    if (r.ok) onDone()
    else setError(authMessage(r.error))
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <p className="text-[14px] text-muted">Log in to play with your saved coins on any device.</p>
      <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <div className="-mt-2 text-right">
        <button type="button" onClick={() => go('forgot')} className="text-[13px] font-bold text-muted hover:text-ink">
          Forgot password?
        </button>
      </div>
      <FormError error={error} />
      <Submit busy={busy} disabled={!email || !password}>
        Log in
      </Submit>
      <p className="text-center text-[14px] text-muted">
        New here?{' '}
        <button type="button" onClick={() => go('register')} className={linkCls}>
          Create an account
        </button>
      </p>
    </form>
  )
}

function RegisterForm({ onDone, go }: { onDone: () => void; go: (v: AuthView) => void }) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [avatar, setAvatar] = useState(() => Math.floor(Math.random() * FREE_AVATARS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [free, setFree] = useState<boolean | null>(null)
  const balance = useWallet((s) => s.balance)
  const rounds = useWallet((s) => s.rounds)
  const valid = /^[A-Za-z0-9_]{3,16}$/.test(username)

  useEffect(() => {
    setFree(null)
    if (!valid) return
    const t = setTimeout(async () => setFree(await usernameFree(username)), 350)
    return () => clearTimeout(t)
  }, [username, valid])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!valid) return setError(authMessage('username'))
    if (free === false) return setError(authMessage('username-taken'))
    if (password.length < 8) return setError(authMessage('password'))
    setBusy(true)
    setError(null)
    const r = await register({ email, password, username, avatar })
    setBusy(false)
    if (r.ok) {
      useWallet.getState().pushToast({ kind: 'reward', title: `Welcome, ${username}! Your account is ready.` })
      onDone()
    } else setError(authMessage(r.error))
  }

  const status = !username ? null : !valid ? (
    <span className="text-danger">3 to 16 letters, numbers or _</span>
  ) : free == null ? (
    <span className="text-dim">Checking…</span>
  ) : free ? (
    <span className="text-accent">Available</span>
  ) : (
    <span className="text-danger">Taken</span>
  )

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <Avatar index={avatar} size={56} />
          <div className="min-w-0">
            <div className="truncate text-[16px] font-extrabold">{username || 'Your name'}</div>
            <div className="text-[12px] text-dim">Pick an avatar</div>
          </div>
        </div>
        <div className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-1 [mask-image:linear-gradient(90deg,#000_88%,transparent)]">
          {Array.from({ length: FREE_AVATARS }, (_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setAvatar(i)}
              aria-label={`Avatar ${i + 1}`}
              className={`shrink-0 rounded-full p-0.5 transition ${avatar === i ? 'ring-2 ring-accent' : 'opacity-70 hover:opacity-100'}`}
            >
              <Avatar index={i} size={36} />
            </button>
          ))}
        </div>
      </div>
      <Field label="Username" autoComplete="username" value={username} maxLength={16} onChange={(e) => setUsername(e.target.value.replace(/\s/g, ''))} right={status} required autoFocus />
      <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <PasswordField label="Password" value={password} onChange={setPassword} autoComplete="new-password" />
      {rounds > 0 || balance !== STARTING_BALANCE ? (
        <div className="flex items-center gap-2 rounded-lg bg-stage px-3 py-2.5 text-[13px] text-muted">
          <Coin size={16} />
          <span>
            Your <b className="tnum text-ink">{fmt(balance)}</b> coins and progress move into the new account.
          </span>
        </div>
      ) : null}
      <FormError error={error} />
      <Submit busy={busy} disabled={!username || !email || !password}>
        Create account
      </Submit>
      <p className="text-center text-[14px] text-muted">
        Already have an account?{' '}
        <button type="button" onClick={() => go('login')} className={linkCls}>
          Log in
        </button>
      </p>
      <p className="text-center text-[11px] leading-relaxed text-dim">Play money only. Coins have no cash value and can't be bought or withdrawn.</p>
    </form>
  )
}

function ForgotForm({ go }: { go: (v: AuthView) => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await sendReset(email)
    setBusy(false)
    if (r.ok) setSent(true)
    else setError(authMessage(r.error))
  }
  if (sent)
    return (
      <div className="flex flex-col gap-4 pt-1">
        <p className="text-[14px] leading-relaxed text-muted">
          If an account uses <b className="text-ink">{email}</b>, a reset link is on its way. Open it on this device to choose a new password.
        </p>
        <button onClick={() => go('login')} className="h-12 rounded-lg bg-raised text-[15px] font-bold text-ink transition hover:bg-hover">
          Back to log in
        </button>
      </div>
    )
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <p className="text-[14px] text-muted">Enter your email and we'll send you a link to set a new password.</p>
      <Field label="Email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      <FormError error={error} />
      <Submit busy={busy} disabled={!email}>
        Send reset link
      </Submit>
      <p className="text-center text-[14px]">
        <button type="button" onClick={() => go('login')} className={linkCls}>
          Back to log in
        </button>
      </p>
    </form>
  )
}

function ResetForm({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const r = await changePassword(password)
    setBusy(false)
    if (r.ok) {
      useWallet.getState().pushToast({ kind: 'info', title: 'Password changed.' })
      onDone()
    } else setError(authMessage(r.error))
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pt-1">
      <PasswordField label="New password" value={password} onChange={setPassword} autoComplete="new-password" />
      <FormError error={error} />
      <Submit busy={busy} disabled={password.length < 8}>
        Save new password
      </Submit>
    </form>
  )
}
