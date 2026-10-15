import type { SupabaseClient } from '@supabase/supabase-js'
import { safeStorage } from './storage'

/* The online backend: Supabase for accounts and shared Crash rounds, plus a few small functions
   under /api on the same host. The browser talks to Supabase directly; the public URL and key come
   from the build when they are set there, otherwise from /api/config at runtime. */

// a native (Capacitor) build has no same-origin /api, so it can point at the deployed site
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/+$/, '')
export const apiUrl = (path: string) => `${API_BASE}${path}`

export interface BackendConfig {
  url: string
  key: string
}

const CACHE_KEY = 'lumen.backend'

function fromBuild(): BackendConfig | null {
  const url = import.meta.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined
  const key = (import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) as string | undefined
  return url && key ? { url, key } : null
}

function fromCache(): BackendConfig | null {
  try {
    const v = JSON.parse(safeStorage.getItem(CACHE_KEY) ?? 'null')
    return v && typeof v.url === 'string' && typeof v.key === 'string' ? v : null
  } catch {
    return null
  }
}

/** Fetch with a deadline, so a slow network never leaves the UI hanging. */
export async function fetchWithTimeout(input: string, init: RequestInit = {}, ms = 6000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function fromApi(): Promise<BackendConfig | null> {
  const res = await fetchWithTimeout(apiUrl('/api/config'), { cache: 'no-store' }, 5000)
  if (!res.ok) return null
  const v = await res.json()
  if (typeof v?.url !== 'string' || typeof v?.key !== 'string') return null
  safeStorage.setItem(CACHE_KEY, JSON.stringify({ url: v.url, key: v.key }))
  return { url: v.url, key: v.key }
}

let configPromise: Promise<BackendConfig | null> | null = null

/** Where the backend lives, or null when this build has none (offline preview). */
export function backendConfig(): Promise<BackendConfig | null> {
  if (!configPromise) {
    const built = fromBuild()
    const cached = fromCache()
    if (built) configPromise = Promise.resolve(built)
    else if (cached) {
      configPromise = Promise.resolve(cached)
      fromApi().catch(() => null) // refresh quietly for next time
    } else
      configPromise = fromApi().catch(() => null).then((c) => {
        if (!c) configPromise = null // try again on the next call
        return c
      })
  }
  return configPromise
}

let clientPromise: Promise<SupabaseClient | null> | null = null

/** The shared Supabase client, created on first use. */
export function backend(): Promise<SupabaseClient | null> {
  if (!clientPromise) {
    clientPromise = backendConfig().then(async (c) => {
      if (!c) {
        clientPromise = null
        return null
      }
      const { createClient } = await import('@supabase/supabase-js')
      return createClient(c.url, c.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'lumen.auth' },
      })
    })
  }
  return clientPromise
}

/** Call a database function with a deadline. Throws on network or server errors. */
export async function rpc<T>(name: string, args: Record<string, unknown>, ms = 5000): Promise<T> {
  const sb = await backend()
  if (!sb) throw new Error('offline')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  try {
    const { data, error } = await sb.rpc(name, args).abortSignal(ctrl.signal)
    if (error) throw new Error(error.message || 'rpc failed')
    return data as T
  } finally {
    clearTimeout(t)
  }
}
