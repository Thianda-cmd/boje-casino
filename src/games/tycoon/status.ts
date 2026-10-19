import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useNow } from '../../lib/useNow'
import { useWallet } from '../../store/wallet'

/*
  Casino Tycoon at a glance, for the rest of the site: the nav item's badge, the Rewards page's card and the game
  finder. Read from the save stored in the wallet with the engine, brought up to now, so a vault that filled up or a
  milestone the managers reached while the player was elsewhere shows at once.

  The nav and the finder ship with the app, so the engine is fetched on first use rather than bundled with them
  (it then sits in its own small chunk, shared with the game): until it is here the status is null and the badge
  shows nothing. Nothing of three.js comes with it.
*/

type Engine = typeof import('./engine')

let engine: Engine | null = null
let loading: Promise<void> | null = null
const waiting = new Set<() => void>()
const load = () => {
  loading ??= import('./engine').then((m) => {
    engine = m
    waiting.forEach((f) => f())
  })
  return loading
}
const subscribe = (f: () => void) => {
  waiting.add(f)
  return () => waiting.delete(f)
}

export interface TycoonStatus {
  /** coins in the vault, what it holds, its rate an hour, and ms until it is full (0: full) */
  vault: number
  cap: number
  rate: number
  fullIn: number
  /** milestones reached and not yet claimed, and their coins */
  due: number
  dueCoins: number
}

/** the status of a stored save at `now`; null before the first casino (or for a save it can't read: this runs in the
 *  app's sidebar, which must never break over it) */
function statusOf(e: Engine, raw: unknown, now: number): TycoonStatus | null {
  try {
    return readStatus(e, raw, now)
  } catch {
    return null
  }
}

function readStatus(e: Engine, raw: unknown, now: number): TycoonStatus | null {
  const stored = e.parseSave(raw, now)
  if (!stored) return null
  const s = e.advance(stored, now).save
  const vault = e.vaultAt(s, now)
  const cap = e.vaultCap(s)
  const rate = e.coinRate(s)
  const due = e.milestonesDue(s)
  return { vault, cap, rate, fullIn: vault >= cap ? 0 : ((cap - vault) / rate) * 3_600_000, due: due.length, dueCoins: due.reduce((a, m) => a + m.coins, 0) }
}

/** the player's casino at a glance, refreshed every `every` ms and whenever the save changes */
export function useTycoonStatus(every = 30_000) {
  const raw = useWallet((w) => w.tycoon)
  // (only what draws it again: the status itself is worked out for the moment it is drawn, not the last tick)
  const tick = useNow(every)
  const e = useSyncExternalStore(subscribe, () => engine)
  useEffect(() => {
    void load()
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` is here to work it out again as time passes
  return useMemo(() => (e ? statusOf(e, raw, Date.now()) : null), [e, raw, tick])
}

/** the nav badge: milestones ready to claim, and one more for a full vault (0: nothing waiting) */
export function useTycoonBadge() {
  const st = useTycoonStatus()
  return st ? st.due + (st.fullIn === 0 ? 1 : 0) : 0
}
