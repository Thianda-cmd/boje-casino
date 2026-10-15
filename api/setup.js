import postgres from 'postgres'
import { SCHEMA_SQL, SCHEMA_VERSION } from './_lib/schema.js'

/*
  Applies the database schema when it is out of date. Safe to call any time: if the stored
  version matches it only reads one row. Schema changes never run on the request paths.
*/

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store')
  const raw = process.env.POSTGRES_URL || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL
  if (!raw) return res.status(503).json({ error: 'offline' })
  const url = new URL(raw)
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost'
  url.search = '' // provider extras like ?supa=... are not valid startup parameters
  const sql = postgres(url.toString(), { ssl: local ? false : 'require', prepare: false, max: 1, connect_timeout: 10, idle_timeout: 5, onnotice: () => {} })
  try {
    let current = null
    try {
      ;[{ value: current } = {}] = await sql`select value from public.app_meta where key = 'schema'`
    } catch {
      /* first run: no table yet */
    }
    if (current === SCHEMA_VERSION) return res.status(200).json({ ok: true, version: current, applied: false })
    await sql.unsafe(SCHEMA_SQL)
    return res.status(200).json({ ok: true, version: SCHEMA_VERSION, previous: current, applied: true })
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'setup', message: String(e?.message || e).slice(0, 300) })
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {})
  }
}
