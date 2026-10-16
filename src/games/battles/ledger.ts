import { round2 } from '../../lib/format'
import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import type { Mode } from './types'

/*
  Case Battles' stake ledger. A seat's cost leaves the wallet when the create or join request is sent, before the
  server answers, so every battle this browser has paid into is written down here until it is settled or refunded,
  across reloads and sign-ins. One localStorage key per battle (or per create whose battle id isn't known yet), plus a
  marker once it is settled. Every credit runs under a Web Lock and checks the marker, so two tabs can't pay the same
  battle twice, and refunds are capped by what this browser staked.
*/

export type Src = 'shared' | 'local'

export interface Stake {
  /** the battle, or 0 while a create's answer is unknown */
  battle: number
  /** the seat this browser holds, once known */
  seat: number | null
  staked: number
  at: number
  src: Src
  /** for the settle record (and the challenges) */
  mode: Mode
  players: number
  cases: number
  crazy: boolean
  /** the guest id that staked it, once the entry has moved into an account */
  guest?: string
  /** when the server was last asked about it */
  lastTry?: number
  /** what the seat costs and pays, noted once the battle is seen running (every item is drawn when it fills), so the
   *  stake still settles right if the battle is later cleared from the server before this browser comes back */
  outcome?: { cost: number; payout: number }
}

export const keyOf = (src: Src, battle: number) => `${src}:${battle}`
/** a create in flight: its battle id comes with the answer */
export const newKey = (src: Src) => `${src}:new-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
export const srcOf = (key: string): Src => (key.startsWith('local:') ? 'local' : 'shared')
export const isNew = (key: string) => key.includes(':new-')

const pKey = (who: string, key: string) => `lumen.battles.p.${who}.${key}`
const sKey = (who: string, key: string) => `lumen.battles.s.${who}.${key}`
const SETTLED_TTL = 7 * 86400_000

// with storage blocked (some private windows) the ledger still has to hold this page's stakes
const durable = (() => {
  try {
    localStorage.setItem('lumen.battles.probe', '1')
    localStorage.removeItem('lumen.battles.probe')
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

function read(who: string, key: string): Stake | null {
  try {
    const v = JSON.parse(get(pKey(who, key)) ?? 'null')
    return v && typeof v.staked === 'number' && typeof v.battle === 'number' ? v : null
  } catch {
    return null
  }
}
const write = (who: string, key: string, p: Stake) => set(pKey(who, key), JSON.stringify(p))
const isSettled = (who: string, key: string) => get(sKey(who, key)) != null
const markSettled = (who: string, key: string) => set(sKey(who, key), JSON.stringify({ at: Date.now() }))

/** Records a stake; call it in the same task as the wallet deduction, before the request goes out. */
export function addStake(who: string, key: string, s: Omit<Stake, 'at' | 'staked'>, amount: number) {
  const p = read(who, key)
  write(who, key, { ...s, at: p?.at ?? Date.now(), staked: round2((p?.staked ?? 0) + amount) })
}

export const pending = (who: string, key: string) => read(who, key)

export function pendingAll(who: string): Record<string, Stake> {
  const prefix = pKey(who, '')
  const out: Record<string, Stake> = {}
  for (const k of keysWith(prefix)) {
    const key = k.slice(prefix.length)
    const p = read(who, key)
    if (p) out[key] = p
  }
  return out
}

/** Whether `who` has a stake open on the shared battles (App keeps settling those while you're elsewhere). */
export const hasShared = (who: string) => keysWith(pKey(who, 'shared:')).length > 0

/** Runs `fn` while holding the ledger lock. Without Web Locks only the focused tab may touch the wallet. */
export async function withLedger<T>(fn: () => T): Promise<T | undefined> {
  if (typeof navigator !== 'undefined' && navigator.locks?.request) return navigator.locks.request('lumen.battles.ledger', () => fn())
  return document.hasFocus() ? fn() : undefined
}

/** A create came back: the stake moves under its battle id, with the seat it took. */
export async function claim(who: string, tmp: string, battle: number, seat: number | null) {
  await withLedger(() => {
    const p = read(who, tmp)
    if (!p) return
    const key = keyOf(p.src, battle)
    const q = read(who, key)
    write(who, key, { ...p, battle, seat: seat ?? p.seat, staked: round2(p.staked + (q?.staked ?? 0)), at: q?.at ?? p.at })
    del(pKey(who, tmp))
  })
}

/** The seat this browser holds, learned later (a join whose answer was lost). */
export function noteSeat(who: string, key: string, seat: number) {
  const p = read(who, key)
  if (p && p.seat !== seat) write(who, key, { ...p, seat })
}

export function markTry(who: string, key: string, now: number) {
  const p = read(who, key)
  if (p) write(who, key, { ...p, lastTry: now })
}

/** The battle filled with this browser's seat in it: what the seat costs and will be paid is final from here. */
export function noteOutcome(who: string, key: string, cost: number, payout: number) {
  const p = read(who, key)
  if (p && (p.outcome?.cost !== cost || p.outcome?.payout !== payout)) write(who, key, { ...p, outcome: { cost, payout } })
}

/** Pays out a finished battle once. `bet` and `payout` come from the server; stakes it never took are refunded. */
export async function settleBattle(who: string, key: string, bet: number, payout: number): Promise<boolean> {
  return (
    (await withLedger(() => {
      if (isSettled(who, key)) {
        del(pKey(who, key))
        return false
      }
      const p = read(who, key)
      if (!p) return false
      const wallet = useWallet.getState()
      wallet.settle({ game: 'battles', bet: round2(bet), payout: round2(payout), meta: { mode: p.mode, players: p.players, cases: p.cases, won: payout > 0, crazy: p.crazy } })
      const diff = round2(p.staked - bet)
      if (diff > 0) wallet.refund(diff)
      else if (diff < 0) console.warn('battles stake mismatch', key, diff)
      markSettled(who, key)
      del(pKey(who, key))
      return true
    })) ?? false
  )
}

/** The seat was never taken, or the battle was called off: give back everything staked on it. */
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

/** A request the server refused outright: give back what it staked (another tab may have staked on the same battle). */
export async function refundPart(who: string, key: string, amount: number): Promise<number> {
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

/**
 * The battle can no longer be looked up (the server clears battles a week after they end, offline battles live in one
 * browser). If this browser saw it fill, the outcome it noted then settles it; otherwise nothing says whether it was
 * played or called off, so the stake comes back.
 */
export async function goneBattle(who: string, key: string): Promise<'paid' | 'refunded' | null> {
  const p = read(who, key)
  if (!p) return null
  if (p.outcome) return (await settleBattle(who, key, p.outcome.cost, p.outcome.payout)) ? 'paid' : null
  const back = await refundAll(who, key)
  if (back > 0) useWallet.getState().pushToast({ kind: 'info', title: 'A Case Battle could no longer be found. Your stake is back.' })
  return back > 0 ? 'refunded' : null
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

/** The last battle set up, for the create dialog's defaults. */
const LAST = 'lumen.battles.last'
export function readLast(): { mode: Mode; crazy: boolean; unit: number; cases: string[] } | null {
  try {
    const v = JSON.parse(safeStorage.getItem(LAST) ?? 'null')
    return v && typeof v.unit === 'number' && Array.isArray(v.cases) && typeof v.mode === 'string' ? v : null
  } catch {
    return null
  }
}
export const writeLast = (v: { mode: Mode; crazy: boolean; unit: number; cases: string[] }) => safeStorage.setItem(LAST, JSON.stringify(v))
