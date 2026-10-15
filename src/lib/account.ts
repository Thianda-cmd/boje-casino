import type { Session, SupabaseClient } from '@supabase/supabase-js'
import { apiUrl, backend, backendConfig, fetchWithTimeout, rpc, type BackendConfig } from './backend'
import { safeStorage } from './storage'
import { useAuth, type Profile } from '../store/auth'
import { accountWalletKey, GUEST_WALLET_KEY, switchWallet, useWallet, walletSnapshot } from '../store/wallet'

/* Accounts. Supabase Auth keeps the session; each account has a profile row holding its username,
   avatar and the whole wallet. The wallet is cached on the device and saved to the server a moment
   after it changes (and when the page is hidden), with a revision number so two devices can't
   silently overwrite each other: a stale save is refused and the newer server copy wins. */

interface ServerProfile extends Profile {
  wallet: Record<string, unknown> | null
  rev: number
}
interface Meta {
  rev: number
  dirty: boolean
  profile?: Profile
}

const metaKey = (uid: string) => `lumen.wallet.acct.${uid}.meta`
const readMeta = (uid: string): Meta | null => {
  try {
    return JSON.parse(safeStorage.getItem(metaKey(uid)) ?? 'null')
  } catch {
    return null
  }
}

let sb: SupabaseClient | null = null
let cfg: BackendConfig | null = null
let token: string | null = null
let rev = 0
let dirty = false
let saving: Promise<void> | null = null
let timer = 0
let firstChange = 0
let unsubscribe: (() => void) | null = null
let applying = false
let resetGuestOnEnter = false
let entering: string | null = null

const writeMeta = () => {
  const { uid, profile } = useAuth.getState()
  if (uid) safeStorage.setItem(metaKey(uid), JSON.stringify({ rev, dirty, profile }))
}

/* ---------------- start-up ---------------- */

/** Before the first render: if a session is stored, show that account's cached wallet right away. */
export function bootAccount() {
  try {
    const s = JSON.parse(safeStorage.getItem('lumen.auth') ?? 'null')
    const uid = s?.user?.id
    if (typeof uid === 'string' && safeStorage.getItem(accountWalletKey(uid))) {
      switchWallet(accountWalletKey(uid))
      const meta = readMeta(uid)
      useAuth.setState({ uid, email: s.user.email ?? null, profile: meta?.profile ?? null })
    }
  } catch {
    /* no stored session */
  }
}

export async function initAccount() {
  sb = await backend().catch(() => null)
  cfg = await backendConfig().catch(() => null)
  if (!sb) {
    if (useAuth.getState().uid) enterGuest()
    useAuth.setState({ status: 'guest', available: false })
    return
  }
  // a password-reset link lands here with ?code=...; supabase-js reads it, then we tidy the address
  if (/[?&]code=/.test(location.search)) setTimeout(() => history.replaceState(null, '', location.pathname + location.hash), 1500)
  sb.auth.onAuthStateChange((event, session) => {
    // don't call back into supabase from inside its own callback
    setTimeout(() => void onSession(event, session), 0)
  })
  window.addEventListener('pagehide', flushNow)
  document.addEventListener('visibilitychange', () => document.hidden && flushNow())
}

async function onSession(event: string, session: Session | null) {
  token = session?.access_token ?? null
  if (event === 'PASSWORD_RECOVERY') useAuth.getState().open('reset')
  const user = session?.user
  if (user) {
    const st = useAuth.getState()
    if (st.status === 'user' && st.uid === user.id) {
      if (user.email !== st.email) useAuth.setState({ email: user.email ?? null })
      return
    }
    if (entering === user.id) return
    entering = user.id
    try {
      await enterAccount(user.id, user.email ?? null, (user.user_metadata?.username as string | undefined) ?? null)
    } finally {
      entering = null
    }
  } else if (useAuth.getState().status !== 'guest') enterGuest()
}

async function enterAccount(uid: string, email: string | null, metaName: string | null) {
  let prof: ServerProfile | null = null
  try {
    prof = await rpc<ServerProfile | null>('my_profile', {}, 8000)
    if (!prof) {
      // an account without a profile (made some other way): give it one
      const base = (metaName || email?.split('@')[0] || 'player').replace(/[^A-Za-z0-9_]/g, '').slice(0, 12) || 'player'
      for (let i = 0; i < 4 && !prof; i++) {
        const name = i ? `${base.slice(0, 11)}_${Math.floor(Math.random() * 9000 + 1000)}` : base.length >= 3 ? base : `${base}_${Math.floor(Math.random() * 900 + 100)}`
        const r = await rpc<{ ok: boolean; profile?: ServerProfile }>('create_profile', { p_username: name, p_wallet: null, p_avatar: Math.floor(Math.random() * 16) })
        if (r?.ok && r.profile) prof = r.profile
      }
    }
  } catch {
    prof = null
  }

  const key = accountWalletKey(uid)
  const meta = readMeta(uid)
  const cached = safeStorage.getItem(key)
  stopSync()
  if (prof) {
    const server = prof.wallet && Object.keys(prof.wallet).length ? prof.wallet : null
    // keep unsaved play from this device if nobody has saved since; otherwise the server copy wins
    const keepLocal = !!cached && !!meta?.dirty && meta.rev === prof.rev
    applying = true
    if (keepLocal) switchWallet(key)
    else switchWallet(key, server ?? (cached ? null : {}))
    applying = false
    rev = prof.rev
    dirty = keepLocal || !server
    useAuth.setState({ status: 'user', uid, email, profile: { username: prof.username, avatar: prof.avatar, createdAt: prof.createdAt }, sync: 'idle' })
  } else if (cached) {
    // offline: play on the cached copy and save once the server answers again
    applying = true
    switchWallet(key)
    applying = false
    rev = meta?.rev ?? 0
    dirty = !!meta?.dirty
    useAuth.setState({ status: 'user', uid, email, profile: meta?.profile ?? { username: metaName ?? 'Player', avatar: 0, createdAt: '' }, sync: 'error' })
  } else {
    useWallet.getState().pushToast({ kind: 'info', title: "Couldn't load your account. Check your connection." })
    await sb?.auth.signOut({ scope: 'local' }).catch(() => {})
    enterGuest()
    return
  }
  writeMeta()
  if (resetGuestOnEnter) {
    resetGuestOnEnter = false
    safeStorage.removeItem(GUEST_WALLET_KEY)
  }
  startSync()
  if (dirty) schedule(500)
}

function enterGuest() {
  stopSync()
  token = null
  applying = true
  switchWallet(GUEST_WALLET_KEY)
  applying = false
  useAuth.setState({ status: 'guest', uid: null, email: null, profile: null, sync: 'idle' })
}

/* ---------------- wallet sync ---------------- */

function startSync() {
  unsubscribe = useWallet.subscribe((s, prev) => {
    if (applying) return
    let changed = false
    for (const k in s) {
      if (k === 'toasts') continue
      if ((s as unknown as Record<string, unknown>)[k] !== (prev as unknown as Record<string, unknown>)[k]) {
        changed = true
        break
      }
    }
    if (!changed) return
    if (!dirty) firstChange = Date.now()
    dirty = true
    writeMeta()
    // save shortly after play pauses, and at least every 15 seconds during long sessions
    schedule(Date.now() - firstChange > 15000 ? 0 : 2500)
  })
}

function stopSync() {
  unsubscribe?.()
  unsubscribe = null
  clearTimeout(timer)
}

function schedule(ms: number) {
  clearTimeout(timer)
  timer = window.setTimeout(() => void save(), ms)
}

/** Save the wallet now if it has unsaved changes. */
export function save(): Promise<void> {
  if (saving) return saving
  if (!dirty || useAuth.getState().status !== 'user') return Promise.resolve()
  saving = (async () => {
    const snap = walletSnapshot()
    const sentRev = rev
    useAuth.setState({ sync: 'saving' })
    try {
      const r = await rpc<{ ok: boolean; rev?: number; error?: string; wallet?: Record<string, unknown> }>('save_wallet', { p_wallet: snap, p_rev: sentRev }, 8000)
      applyResult(r, snap)
    } catch {
      useAuth.setState({ sync: 'error' })
      schedule(10000)
    } finally {
      saving = null
    }
  })()
  return saving
}

function applyResult(r: { ok: boolean; rev?: number; error?: string; wallet?: Record<string, unknown> } | null, snap: Record<string, unknown>) {
  if (!r) return
  if (r.ok && typeof r.rev === 'number') {
    rev = r.rev
    // anything played while the save was in flight still needs saving
    dirty = JSON.stringify(walletSnapshot()) !== JSON.stringify(snap)
    firstChange = Date.now()
    useAuth.setState({ sync: 'idle' })
    if (dirty) schedule(2500)
  } else if (r.error === 'conflict' && r.wallet && typeof r.rev === 'number') {
    const uid = useAuth.getState().uid
    if (uid) {
      applying = true
      switchWallet(accountWalletKey(uid), r.wallet)
      applying = false
    }
    rev = r.rev
    dirty = false
    useAuth.setState({ sync: 'idle' })
    useWallet.getState().pushToast({ kind: 'info', title: 'Your wallet was updated from another device.' })
  } else {
    useAuth.setState({ sync: 'error' })
  }
  writeMeta()
}

/** When the page is being hidden or closed: send the save in a request that outlives the page. */
function flushNow() {
  if (!dirty || !token || !cfg || useAuth.getState().status !== 'user') return
  clearTimeout(timer)
  const snap = walletSnapshot()
  const headers: Record<string, string> = { apikey: cfg.key, authorization: `Bearer ${token}`, 'content-type': 'application/json' }
  const body = JSON.stringify({ p_wallet: snap, p_rev: rev })
  if (body.length > 60000) return void save()
  fetch(`${cfg.url}/rest/v1/rpc/save_wallet`, { method: 'POST', keepalive: true, headers, body })
    .then((res) => res.json())
    .then((r) => applyResult(r, snap))
    .catch(() => {})
}

/* ---------------- actions for the UI ---------------- */

export type AuthResult = { ok: true } | { ok: false; error: string }

const MESSAGES: Record<string, string> = {
  email: 'Enter a valid email address.',
  username: 'Usernames are 3 to 16 letters, numbers or underscores.',
  password: 'Passwords need at least 8 characters.',
  'weak-password': 'That password is too weak. Try a longer one.',
  'email-taken': 'An account with this email already exists. Try logging in.',
  'username-taken': 'That username is taken.',
  rate: 'Too many sign-ups from this network. Try again later.',
  offline: 'Accounts are unavailable right now.',
  network: 'Connection problem. Try again.',
  server: 'Something went wrong on our side. Try again.',
  credentials: 'Wrong email or password.',
  'same-password': 'That is already your password.',
}
export const authMessage = (code: string) => MESSAGES[code] ?? MESSAGES.server

export async function register(input: { email: string; password: string; username: string; avatar: number }): Promise<AuthResult> {
  if (!sb) return { ok: false, error: 'offline' }
  const guest = useAuth.getState().status === 'guest' ? walletSnapshot() : null
  let res: Response
  try {
    res = await fetchWithTimeout(
      apiUrl('/api/auth'),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'signup', ...input, wallet: guest }) },
      15000,
    )
  } catch {
    return { ok: false, error: 'network' }
  }
  const body = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, error: String(body.error ?? 'server') }
  // the guest's progress now lives in the account, so the guest starts over
  resetGuestOnEnter = !!guest
  const { error } = await sb.auth.signInWithPassword({ email: input.email.trim().toLowerCase(), password: input.password })
  if (error) {
    resetGuestOnEnter = false
    return { ok: false, error: 'server' }
  }
  return { ok: true }
}

export async function login(email: string, password: string): Promise<AuthResult> {
  if (!sb) return { ok: false, error: 'offline' }
  await save().catch(() => {})
  try {
    const { error } = await sb.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    if (!error) return { ok: true }
    const code = (error as { code?: string }).code
    if (code === 'invalid_credentials' || /invalid login/i.test(error.message)) return { ok: false, error: 'credentials' }
    if (error.status === 0 || /fetch|network/i.test(error.message)) return { ok: false, error: 'network' }
    return { ok: false, error: 'server' }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function logout() {
  await Promise.race([save(), new Promise((r) => setTimeout(r, 3000))]).catch(() => {})
  stopSync()
  await sb?.auth.signOut({ scope: 'local' }).catch(() => {})
  enterGuest()
}

export async function sendReset(email: string): Promise<AuthResult> {
  if (!sb) return { ok: false, error: 'offline' }
  const { error } = await sb.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: location.origin + location.pathname })
  if (error && /rate/i.test(error.message)) return { ok: false, error: 'rate' }
  // say the same thing whether or not the address has an account
  return { ok: true }
}

export async function changePassword(password: string): Promise<AuthResult> {
  if (!sb) return { ok: false, error: 'offline' }
  if (password.length < 8) return { ok: false, error: 'password' }
  const { error } = await sb.auth.updateUser({ password })
  if (!error) return { ok: true }
  if (/weak|short|password/i.test(error.message) && !/same/i.test(error.message)) return { ok: false, error: 'weak-password' }
  if (/same/i.test(error.message)) return { ok: false, error: 'same-password' }
  return { ok: false, error: 'server' }
}

export async function updateProfile(changes: { username?: string; avatar?: number }): Promise<AuthResult> {
  try {
    const r = await rpc<{ ok: boolean; error?: string; profile?: ServerProfile }>('update_profile', { p_username: changes.username ?? null, p_avatar: changes.avatar ?? null })
    if (!r?.ok || !r.profile) return { ok: false, error: r?.error === 'taken' ? 'username-taken' : r?.error === 'username' ? 'username' : 'server' }
    useAuth.setState({ profile: { username: r.profile.username, avatar: r.profile.avatar, createdAt: r.profile.createdAt } })
    writeMeta()
    return { ok: true }
  } catch {
    return { ok: false, error: 'network' }
  }
}

export async function usernameFree(name: string): Promise<boolean | null> {
  try {
    return await rpc<boolean>('username_available', { p_username: name }, 5000)
  } catch {
    return null
  }
}

export async function deleteAccount(): Promise<AuthResult> {
  const uid = useAuth.getState().uid
  if (!sb || !uid || !token) return { ok: false, error: 'offline' }
  try {
    const res = await fetchWithTimeout(apiUrl('/api/auth'), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'delete' }) }, 15000)
    if (!res.ok) return { ok: false, error: 'server' }
  } catch {
    return { ok: false, error: 'network' }
  }
  stopSync()
  dirty = false
  await sb.auth.signOut({ scope: 'local' }).catch(() => {})
  safeStorage.removeItem(accountWalletKey(uid))
  safeStorage.removeItem(metaKey(uid))
  enterGuest()
  return { ok: true }
}
