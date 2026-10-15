import { useSyncExternalStore } from 'react'

// Hash routing: works from file:// and inside Capacitor without server rewrites.
// The current route is also kept in memory, so navigation still works in sandboxed
// frames where the hash can't be changed.
const listeners = new Set<() => void>()
const readHash = () => {
  try {
    return window.location.hash.replace(/^#/, '') || '/'
  } catch {
    return '/'
  }
}
let current = readHash()

window.addEventListener('hashchange', () => {
  current = readHash()
  listeners.forEach((l) => l())
})

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useRoute() {
  return useSyncExternalStore(subscribe, () => current, () => '/')
}

export function navigate(path: string) {
  if (current === path) return
  current = path
  listeners.forEach((l) => l())
  try {
    window.location.hash = path
  } catch {
    /* sandboxed: in-memory route is enough */
  }
}
