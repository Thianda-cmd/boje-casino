import { restAuth } from '../../lib/account'
import { guestId } from '../../lib/identity'
import { useWallet } from '../../store/wallet'
import { bookOf, loseRound, markTry, pendingAll, refundAll, roundOf, settleRound, type Src } from './ledger'
import type { TableFeed, TableServer } from './types'

/**
 * A sign-in or sign-out is under way: the server already answers for the new identity (or soon will) while this page
 * still holds the old one's wallet, which is about to be swapped out. No stake is settled or refunded until they agree.
 */
export function switching(who: string) {
  const auth = restAuth()
  return !!auth && (who === 'guest') === (auth.token != null)
}

/** Rounds this browser paid into but didn't see finish (closed tab, network loss, another table). */
export async function settleMissed(server: TableServer, who: string, src: Src, current: number | null, past: TableFeed['past']) {
  // no book: another tab runs the offline tables, and only that tab can say how their rounds went
  if (!server.book || switching(who)) return
  for (const [key, p] of Object.entries(pendingAll(who))) {
    // local rounds live in this browser's stand-in and shared ones on the server: each waits for its own mode
    if (p.src !== src) continue
    // offline tables that have since been replaced by a fresh set: nothing can say how the round went
    if (bookOf(key) !== server.book) {
      await refundAll(who, key)
      continue
    }
    const round = roundOf(key)
    if (round === current) continue
    const done = past.find((x) => x.round === round)
    if (done) {
      if (await settleRound(who, key, done.bet, done.payout, { table: done.table })) paid(done.payout)
      continue
    }
    if (Date.now() - (p.lastTry ?? 0) < 10_000) continue
    markTry(who, key, Date.now())
    // a guest's stake is looked up by the guest id too, in case the request carries an account's session already
    const res = await server.result(round, p.guest ?? (who === 'guest' ? guestId : undefined)).catch(() => null)
    if (res?.state === 'done') {
      if (await settleRound(who, key, res.bet, res.payout, { table: res.table })) paid(res.payout)
    } else if (res?.state === 'none') await refundAll(who, key)
    else if (res?.state === 'gone') await loseRound(who, key)
  }
}

function paid(payout: number) {
  if (payout > 0) useWallet.getState().pushToast({ kind: 'win', title: 'A Live Blackjack round you missed paid out', amount: payout })
}
