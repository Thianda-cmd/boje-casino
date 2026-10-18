/*
  localStorage can throw (private mode, blocked storage); never let that break the app.

  Some keys change many times a second while a game is busy: the wallet while Reef Raid's trigger is held, and the
  reef's ledger with it. Those writes go through `setSoon` / `removeSoon`: they are held and written together, in one
  go, at the end of the current task, and then at most every SOON_MS while they keep coming. Held writes are always
  written as one block, so the wallet and a ledger saved with it can never land apart: after a crash, storage shows
  them both as they were at the same moment.

  Every other write (`setItem` / `removeItem`) first writes everything held, so storage still sees changes in the
  order they happened: a game's saved round is never written ahead of the stake taken from the wallet for it. Reads
  see held values. When the page is hidden or about to unload, everything held is written at once, and soon-writes go
  straight through until the page is shown again (timers don't run once a page is gone).
*/

/** at most one write of the held keys per this many ms while they keep changing */
export const SOON_MS = 250

/** key → value to write (null: remove), in the order first held */
const held = new Map<string, string | null>()
let timer: ReturnType<typeof setTimeout> | null = null
let queued = false
let lastFlush = -Infinity
/** the page is hidden or going: write at once */
let urgent = false

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

function rawSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function rawRemove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/** writes everything held, now */
export function flushStorage() {
  if (timer) clearTimeout(timer)
  timer = null
  queued = false
  if (!held.size) return
  lastFlush = now()
  const all = [...held]
  held.clear()
  for (const [k, v] of all) {
    if (v === null) rawRemove(k)
    else rawSet(k, v)
  }
}

function schedule() {
  if (urgent) return flushStorage()
  if (timer || queued) return
  const wait = SOON_MS - (now() - lastFlush)
  if (wait <= 0) {
    // quiet until now: at the end of this task, so a shot's stake and its ledger entry land together
    queued = true
    queueMicrotask(() => {
      if (queued) flushStorage()
    })
  } else timer = setTimeout(flushStorage, wait)
}

export const safeStorage = {
  getItem(key: string): string | null {
    if (held.has(key)) return held.get(key) ?? null
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string) {
    flushStorage()
    rawSet(key, value)
  },
  removeItem(key: string) {
    flushStorage()
    rawRemove(key)
  },
  /** a write that may be held back a moment and written together with the other held ones (see above) */
  setSoon(key: string, value: string) {
    held.delete(key)
    held.set(key, value)
    schedule()
  },
  removeSoon(key: string) {
    held.delete(key)
    held.set(key, null)
    schedule()
  },
}

if (typeof window !== 'undefined') {
  // capture: at the window these run before the page's own listeners, so whatever a game pays on its way out is
  // written straight through
  const going = () => {
    flushStorage()
    urgent = true
  }
  window.addEventListener(
    'beforeunload',
    () => {
      going()
      // only runs if the page stays (a cancelled leave)
      setTimeout(() => {
        if (document.visibilityState === 'visible') urgent = false
      }, 0)
    },
    { capture: true },
  )
  window.addEventListener('pagehide', going, { capture: true })
  window.addEventListener(
    'pageshow',
    () => {
      if (document.visibilityState === 'visible') urgent = false
    },
    { capture: true },
  )
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') going()
      else urgent = false
    },
    { capture: true },
  )
  document.addEventListener('freeze', flushStorage, { capture: true })
}
