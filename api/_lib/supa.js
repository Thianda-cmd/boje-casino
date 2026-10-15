/* Small helpers for talking to Supabase from the Vercel functions, without the SDK. */

export function cfg() {
  const env = process.env
  return {
    url: (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, ''),
    anon: env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY || '',
    service: env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '',
  }
}

// legacy keys are JWTs and go in both headers; the newer sb_ keys only go in apikey
function headers(key, token) {
  const h = { apikey: key, 'content-type': 'application/json' }
  const bearer = token || (key.startsWith('eyJ') ? key : '')
  if (bearer) h.authorization = `Bearer ${bearer}`
  return h
}

async function send(url, init, timeoutMs = 8000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const text = await res.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = { message: text }
    }
    return { status: res.status, ok: res.ok, body }
  } finally {
    clearTimeout(t)
  }
}

/** Call a database function through the REST API. */
export function rpc(name, args, { key, token } = {}) {
  const c = cfg()
  return send(`${c.url}/rest/v1/rpc/${name}`, { method: 'POST', headers: headers(key ?? c.anon, token), body: JSON.stringify(args ?? {}) })
}

/** Call the auth server. */
export function auth(path, { method = 'GET', key, token, body } = {}) {
  const c = cfg()
  return send(`${c.url}/auth/v1${path}`, { method, headers: headers(key ?? c.anon, token), body: body ? JSON.stringify(body) : undefined })
}

export function readBody(req) {
  const b = req.body
  if (!b) return {}
  if (typeof b === 'string') {
    try {
      return JSON.parse(b)
    } catch {
      return {}
    }
  }
  return b
}

export function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '')
  return (fwd.split(',')[0] || req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown').toString().trim().slice(0, 64)
}

export const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@.]{2,24}$/
export const USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/

/**
 * Create a confirmed account with a profile. The auth user is made with the service key so no
 * confirmation email is needed; if the profile can't be made the user is removed again.
 */
export async function createAccount({ email, password, username, wallet, avatar = 0 }) {
  const c = cfg()
  email = String(email ?? '').trim().toLowerCase()
  username = String(username ?? '').trim()
  password = String(password ?? '')
  if (!EMAIL_RE.test(email)) return { status: 400, error: 'email' }
  if (!USERNAME_RE.test(username)) return { status: 400, error: 'username' }
  if (password.length < 8 || password.length > 72) return { status: 400, error: 'password' }

  const free = await rpc('username_available', { p_username: username })
  if (!free.ok) return { status: 502, error: 'server' }
  if (free.body !== true) return { status: 409, error: 'username-taken' }

  const made = await auth('/admin/users', {
    method: 'POST',
    key: c.service,
    body: { email, password, email_confirm: true, user_metadata: { username } },
  })
  if (!made.ok) {
    const code = String(made.body?.error_code || made.body?.code || '')
    const msg = String(made.body?.msg || made.body?.message || made.body?.error_description || '')
    if (code === 'email_exists' || /already (been )?registered|already exists/i.test(msg)) return { status: 409, error: 'email-taken' }
    if (code === 'weak_password' || /password/i.test(msg)) return { status: 400, error: 'weak-password' }
    if (code === 'email_address_invalid' || /email/i.test(msg)) return { status: 400, error: 'email' }
    return { status: 502, error: 'server' }
  }
  const id = made.body?.id ?? made.body?.user?.id
  const prof = await rpc(
    'admin_create_profile',
    { p_id: id, p_username: username, p_wallet: wallet && typeof wallet === 'object' ? wallet : null, p_avatar: Number(avatar) || 0 },
    { key: c.service },
  )
  if (!prof.ok || !prof.body?.ok) {
    await auth(`/admin/users/${id}`, { method: 'DELETE', key: c.service })
    return { status: prof.body?.error === 'taken' ? 409 : 502, error: prof.body?.error === 'taken' ? 'username-taken' : 'server' }
  }
  return { status: 200, id }
}

/** The user behind an access token, or null. */
export async function userFromToken(token) {
  if (!token) return null
  const r = await auth('/user', { token })
  return r.ok && r.body?.id ? r.body : null
}

export async function deleteUser(id) {
  const c = cfg()
  return auth(`/admin/users/${id}`, { method: 'DELETE', key: c.service })
}
