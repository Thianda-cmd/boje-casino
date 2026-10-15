import { cfg, clientIp, createAccount, deleteUser, readBody, rpc, userFromToken } from './_lib/supa.js'

/*
  Account actions that need the service key. Everything else (signing in, sessions, password
  changes) goes straight from the browser to Supabase Auth.
    POST /api/auth {action:'signup', email, password, username, wallet?, avatar?}
    POST /api/auth {action:'delete'} with the user's access token as a bearer token
*/

const SIGNUPS_PER_HOUR = 5

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' })
  const c = cfg()
  if (!c.url || !c.service) return res.status(503).json({ error: 'offline' })
  const body = readBody(req)
  try {
    if (body.action === 'signup') {
      const gate = await rpc('signup_gate', { p_ip: clientIp(req) }, { key: c.service })
      if (gate.ok && Number(gate.body) >= SIGNUPS_PER_HOUR) return res.status(429).json({ error: 'rate' })
      const r = await createAccount(body)
      return res.status(r.status).json(r.error ? { error: r.error } : { ok: true })
    }
    if (body.action === 'delete') {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      const user = await userFromToken(token)
      if (!user) return res.status(401).json({ error: 'auth' })
      const r = await deleteUser(user.id)
      return r.ok ? res.status(200).json({ ok: true }) : res.status(502).json({ error: 'server' })
    }
    return res.status(400).json({ error: 'action' })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'server' })
  }
}
