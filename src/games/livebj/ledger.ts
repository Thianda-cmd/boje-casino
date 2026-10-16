import { round2 } from '../../lib/format'
import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'

/*
  Live Blackjack's stake ledger. A stake leaves the wallet when the bet (or double, or split) is sent,
  before the server answers, so every round this browser has paid into is written down here until it
  is settled or refunded, across reloads and sign-ins. One localStorage key per round, plus a marker
  once it is settled. Every credit runs under a Web Lock and checks the marker, so two tabs can't pay
  the same round twice, and refunds are capped by what this browser staked.
*/

export type Src = 'shared' | 'local'
export interface Pending {
  table: number
  staked: number
  at: number
  src: Src
  /** the guest id that staked it, once the entry has moved into an account */
  guest?: string
  /** when bj_result was last asked about it */
  lastTry?: number
}

/**
 * A round's key. `book` names the tables it ran on: 'shared', or 'local:<id>' for one run of the offline tables, whose
 * round ids mean nothing to any other run (TableServer.book).
 */
export const keyOf = (book: string, round: number) => `${book}:${round}`
export const bookOf = (key: string) => key.slice(0, key.lastIndexOf(':'))
export const roundOf = (key: string) => Number(key.slice(key.lastIndexOf(':') + 1))
const pKey = (who: string, key: string) => `lumen.livebj.p.${who}.${key}`
const sKey = (who: string, key: string) => `lumen.livebj.s.${who}.${key}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's stakes
const durable = (() => {
  try {
    localStorage.setItem('lumen.livebj.probe', '1')
    localStorage.removeItem('lumen.livebj.probe')
    return true
  } catch {
    return false
  }
})()
const mem = new Map<string, string>()
const get = (k: string) => (durable ? safeStorage.getItem(k) : (mem.get(k) ?? null))
const set = (k: string, v: string) => (durable ? safeStorage.setItem(k, v) : void mem.set(k, v))
const del = (k: string) => (durable ? safeStorage.removeItem(k) : void mem.delete(k))

function keysWith(prefix: string): string[] {
  if (!durable) return [...mem.keys()].filter((k) => k.startsWith(prefix))
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.startsWith(prefix)) out.push(k)
    }
  } catch {
    /* storage went away */
  }
  return out
}

function read(who: string, key: string): Pending | null {
  try {
    const v = JSON.parse(get(pKey(who, key)) ?? 'null')
    return v && typeof v.staked === 'number' && typeof v.table === 'number' ? v : null
  } catch {
    return null
  }
}
const write = (who: string, key: string, p: Pending) => set(pKey(who, key), JSON.stringify(p))
const isSettled = (who: string, key: string) => get(sKey(who, key)) != null

/** Records a stake; call it in the same task as the wallet deduction, before the request goes out. */
export function addStake(who: string, key: string, table: number, amount: number, src: Src) {
  const p = read(who, key) ?? { table, staked: 0, at: Date.now(), src }
  write(who, key, { ...p, staked: round2(p.staked + amount) })
}

export function pending(who: string, key: string): Pending | null {
  return read(who, key)
}

export function pendingAll(who: string): Record<string, Pending> {
  const prefix = pKey(who, '')
  const out: Record<string, Pending> = {}
  for (const k of keysWith(prefix)) {
    const key = k.slice(prefix.length)
    const p = read(who, key)
    if (p) out[key] = p
  }
  return out
}

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
export async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.livebj.ledger', () => fn())
  return document.hasFocus() ? fn() : undefined
}

/** Pays out a finished round once. `bet` and `payout` come from the server; stakes it never took are refunded. */
export async function settleRound(who: string, key: string, bet: number, payout: number, meta: Record<string, number | string | boolean>): Promise<boolean> {
  return (
    (await withLedger(() => {
      if (isSettled(who, key)) {
        del(pKey(who, key))
        return false
      }
      const p = read(who, key)
      if (!p) return false
      const wallet = useWallet.getState()
      wallet.settle({ game: 'livebj', bet: round2(bet), payout: round2(payout), meta })
      const diff = round2(p.staked - bet)
      if (diff > 0) wallet.refund(diff)
      else if (diff < 0) console.warn('livebj stake mismatch', key, diff)
      set(sKey(who, key), JSON.stringify({ at: Date.now() }))
      del(pKey(who, key))
      return true
    })) ?? false
  )
}

/** A request the server definitely refused: give back up to its amount. */
export async function refundUpTo(who: string, key: string, amount: number): Promise<number> {
  return (
    (await withLedger(() => {
      const p = read(who, key)
      if (!p || isSettled(who, key)) return 0
      const back = round2(Math.min(amount, p.staked))
      if (back > 0) useWallet.getState().refund(back)
      const left = round2(p.staked - back)
      if (left > 0) write(who, key, { ...p, staked: left })
      else del(pKey(who, key))
      return back
    })) ?? 0
  )
}

/** The bet never reached the round, or leaving cancelled it: give back everything staked on it. */
export async function refundAll(who: string, key: string): Promise<number> {
  return (
    (await withLedger(() => {
      const p = read(who, key)
      if (!p || isSettled(who, key)) return 0
      if (p.staked > 0) useWallet.getState().refund(p.staked)
      del(pKey(who, key))
      return p.staked
    })) ?? 0
  )
}

/** The round can no longer be looked up: settle it as a loss so the stake shows in the history. */
export async function loseRound(who: string, key: string): Promise<void> {
  await withLedger(() => {
    const p = read(who, key)
    if (!p || isSettled(who, key)) return
    const wallet = useWallet.getState()
    wallet.settle({ game: 'livebj', bet: p.staked, payout: 0, meta: { table: p.table, expired: true } })
    set(sKey(who, key), JSON.stringify({ at: Date.now() }))
    del(pKey(who, key))
    wallet.pushToast({ kind: 'info', title: 'A Live Blackjack round expired and was settled as a loss' })
  })
}

export function markTry(who: string, key: string, now: number) {
  const p = read(who, key)
  if (p) write(who, key, { ...p, lastTry: now })
}

/**
 * A sign-up carried the guest wallet into an account (at `before`, when known). The stakes the guest had open then were
 * paid from that wallet, so they follow it; stakes from a later guest session stay with the guest.
 */
export function migrateGuest(uid: string, guestId: string, before = Infinity) {
  void withLedger(() => {
    for (const [key, p] of Object.entries(pendingAll('guest'))) {
      if (p.at > before) continue
      if (!read(uid, key) && !isSettled('guest', key)) write(uid, key, { ...p, guest: p.guest ?? guestId })
      del(pKey('guest', key))
    }
  })
}

/** Whether anyone on this device still has a stake open on the tables `book` names. */
export function hasPending(book: string): boolean {
  const tail = `.${book}:`
  return keysWith('lumen.livebj.p.').some((k) => k.includes(tail))
}

export function pruneSettled(who: string) {
  const now = Date.now()
  for (const k of keysWith(sKey(who, ''))) {
    try {
      const at = Number(JSON.parse(get(k) ?? 'null')?.at)
      if (!(now - at < SETTLED_TTL)) del(k)
    } catch {
      del(k)
    }
  }
}

/** The last table and stake, for Rebet and the lobby's way back. */
export const lastKey = (who: string) => `lumen.livebj.last.${who}`
export function readLast(who: string): { table: number; bet: number } | null {
  try {
    const v = JSON.parse(safeStorage.getItem(lastKey(who)) ?? 'null')
    return v && typeof v.table === 'number' && typeof v.bet === 'number' ? v : null
  } catch {
    return null
  }
}
export const writeLast = (who: string, table: number, bet: number) => safeStorage.setItem(lastKey(who), JSON.stringify({ table, bet }))
