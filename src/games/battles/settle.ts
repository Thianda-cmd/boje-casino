import { restAuth } from '../../lib/account'
import { useWallet } from '../../store/wallet'
import { localServer } from './net'
import { claim, goneBattle, isNew, keyOf, markTry, noteOutcome, noteSeat, pending, pendingAll, refundAll, settleBattle, type Src } from './ledger'
import { statusAt, type BattleServer, type BattleView } from './types'

/**
 * A sign-in or sign-out is under way: the server already answers for the new identity (or soon will) while this page
 * still holds the old one's wallet, which is about to be swapped out. No stake is settled or refunded until they agree.
 */
export function switching(who: string) {
  const auth = restAuth()
  return !!auth && (who === 'guest') === (auth.token != null)
}

export const srcOfServer = (s: BattleServer): Src => (s.online ? 'shared' : 'local')

/** a stake this young may still have its request in flight: don't call it lost yet */
const YOUNG_MS = 20_000

/**
 * The battle on screen: settles this browser's stake on it once the winner is shown, refunds it if the battle was called
 * off, and asks the server about a stake whose seat isn't (or is no longer) ours. Returns what happened, if anything.
 */
export async function settleView(server: BattleServer, who: string, v: BattleView, now: number): Promise<'paid' | 'refunded' | null> {
  if (switching(who)) return null
  const key = keyOf(srcOfServer(server), v.id)
  const p = pending(who, key)
  if (!p) return null
  const mine = v.seats.findIndex((s) => s?.me) + 1
  if (mine && p.seat !== mine) noteSeat(who, key, mine)
  const st = statusAt(v, now)
  if (st === 'cancelled') return (await refundAll(who, key)) > 0 ? 'refunded' : null
  // a stake that moved into an account sat as the guest, whom the server no longer marks as us: trust the seat it took
  const seat = mine || (p.guest ? p.seat : 0)
  // filled: every item is drawn, so what this seat is paid is known now; noted in case the battle is gone by the time
  // this browser next asks
  if (seat && v.payouts && (st === 'running' || st === 'done')) noteOutcome(who, key, v.cost, v.payouts[seat - 1] ?? 0)
  if (st === 'done' && seat) return (await settleBattle(who, key, v.cost, v.payouts?.[seat - 1] ?? 0)) ? 'paid' : null
  if (seat || Date.now() - p.at < YOUNG_MS || Date.now() - (p.lastTry ?? 0) < 8000) return null
  // paid in but not seated: a join that never landed, or a leave whose answer was lost
  markTry(who, key, Date.now())
  const r = await server.result(v.id).catch(() => null)
  if (r?.state === 'none' || r?.state === 'cancelled') return (await refundAll(who, key)) > 0 ? 'refunded' : null
  if (r?.state === 'done') return (await settleBattle(who, key, r.cost, r.payout)) ? 'paid' : null
  return null
}

/**
 * Battles this browser paid into but isn't watching (closed tab, another page, another battle, a lost answer).
 * `current` is the battle on screen, which settles itself; `mine` (the lobby feed's own battles) finds creates whose
 * answer was lost. cb_result answers for the browser's guest id as well as the account, so a stake placed as a guest
 * before signing up resolves the same way.
 */
export async function settleMissed(server: BattleServer, who: string, o: { current?: number | null; mine?: BattleView[] | null } = {}) {
  if (switching(who)) return
  const src = srcOfServer(server)
  const all = pendingAll(who)
  const tracked = new Set(Object.values(all).map((p) => p.battle))
  for (const [key, p] of Object.entries(all)) {
    if (p.src !== src) continue
    if (isNew(key)) {
      // a create whose answer was lost: it's the battle we hold seat 1 in, at the same cost, opened about then
      if (!o.mine) continue
      const hit = o.mine.find((b) => b.seats[0]?.me && !tracked.has(b.id) && Math.abs(b.cost - p.staked) < 0.005 && Math.abs(b.createdAt - p.at) < 120_000)
      if (hit) {
        tracked.add(hit.id)
        await claim(who, key, hit.id, 1)
      } else if (Date.now() - p.at > 30_000) await refundAll(who, key)
      continue
    }
    if (p.battle === o.current) continue
    if (Date.now() - (p.lastTry ?? 0) < 8000) continue
    markTry(who, key, Date.now())
    const r = await server.result(p.battle).catch(() => null)
    if (!r) continue
    if (r.state === 'done') {
      if (await settleBattle(who, key, r.cost, r.payout)) paid(r.payout)
    } else if (r.state === 'cancelled') {
      if ((await refundAll(who, key)) > 0) useWallet.getState().pushToast({ kind: 'info', title: 'A Case Battle was called off. Your stake is back.' })
    } else if (r.state === 'none') {
      if (Date.now() - p.at > YOUNG_MS) await refundAll(who, key)
    } else if (r.state === 'gone') {
      if ((await goneBattle(who, key)) === 'paid') paid(p.outcome?.payout ?? 0)
    }
  }
  // stakes on offline battles (paid while the shared battles were down) live on in this browser's own battles, which
  // keep to the clock without anyone watching: settle them from there even while online
  if (server.online && Object.values(all).some((p) => p.src === 'local')) {
    const local = await localServer().catch(() => null)
    if (local) await settleMissed(local, who, { mine: (await local.list().catch(() => null))?.mine ?? null })
  }
}

function paid(payout: number) {
  if (payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'A Case Battle you missed paid out', amount: payout })
}
