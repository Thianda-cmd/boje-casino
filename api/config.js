import { cfg } from './_lib/supa.js'

/* The public Supabase settings for the browser (the URL and the public key, both meant to be public). */
export default function handler(req, res) {
  const c = cfg()
  res.setHeader('cache-control', 'public, max-age=300')
  if (!c.url || !c.anon) return res.status(503).json({ error: 'offline' })
  return res.status(200).json({ url: c.url, key: c.anon })
}
