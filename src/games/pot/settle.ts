import { asDeposits, KEEP_MS, localStandIn, type Feed, type PotServer } from './net'
import { drawOf } from './fair'
import { ageOf, hashOf, loseRound, openRounds, settleRound, type Book, type Outcome } from './ledger'
import { potOf, winnerIndex } from './rules'

/*
  Settling Pot Luck rounds from a feed, shared by the page and the background payouts in src/App.tsx (usePotPayouts),
  so a round is paid the same way wherever the player was when it ended. Every round this browser has paid into and
  not settled is looked at: the round on show settles once its wheel has landed and its seed is out (the winner worked
  out here from the seed and the deposits, rules.ts winnerIndex); an older one from the server's account of it
  (`past`); one the server says holds nothing of the player's gives the coins back; one too old to look up is lost.
*/

export type Settlement = { book: Book; round: number; outcome: Outcome; paid: boolean; live: boolean }

/** Settles what `f` can tell about this player's open rounds in `book`; `est` is the server clock now. */
export async function settleFrom(who: string, book: Book, f: Feed, est: number, live: boolean): Promise<Settlement[]> {
  const out: Settlement[] = []
  for (const id of openRounds(who, book)) {
    let res: { outcome: Outcome; paid: boolean } | null = null
    if (id === f.round.id) {
      const r = f.round
      // the deposits are final once betting has closed; pay when the wheel lands and the seed is out
      if (r.seed == null || est < r.endsAt || f.now < r.endsAt) continue
      const h = hashOf(who, book, id)
      if (h && h !== r.hash) res = await settleRound(who, book, id, null)
      else {
        const ds = asDeposits(f.deposits)
        const i = winnerIndex(ds, drawOf(r.seed))
        res = await settleRound(who, book, id, { pot: potOf(ds), held: f.mine?.amount ?? 0, won: i >= 0 && ds[i].me })
      }
      if (res) out.push({ book, round: id, ...res, live })
    } else if (id < f.round.id) {
      const p = f.past.find((x) => x.round === id)
      if (p) res = await settleRound(who, book, id, { pot: p.pot, held: p.held, won: p.won })
      // so old the round may have been cleared away: there is no telling what happened
      else if (Date.now() - ageOf(who, book, id) > KEEP_MS[book]) await loseRound(who, book, id)
      // asked about, finished, and holding nothing of the player's: none of it reached the pot (a round this request
      // didn't ask about is asked about on the next one)
      else if (f.asked.includes(id)) res = await settleRound(who, book, id, null)
      if (res) out.push({ book, round: id, ...res, live: false })
    } else if (Date.now() - ageOf(who, book, id) > 10 * 60_000) {
      // a round ahead of the server's: the database was reset, so it can never finish
      res = await settleRound(who, book, id, null)
      if (res) out.push({ book, round: id, ...res, live: false })
    }
  }
  return out
}

/** What to tell the player about a round that settled while they weren't watching it (null: nothing to say). */
export function awayToast(s: Settlement): { kind: 'win' | 'loss' | 'info'; title: string; amount?: number } | null {
  const o = s.outcome
  if (!s.paid) return null
  if (o.bet > 0)
    return o.won
      ? { kind: 'win', title: `You won the Pot Luck pot (round #${s.round}) while you were away`, amount: o.payout }
      : { kind: 'loss', title: `Pot Luck round #${s.round} settled while you were away: another ticket was drawn` }
  if (o.refund > 0) return { kind: 'info', title: `Your coins in Pot Luck round #${s.round} never reached the pot, so ${o.refund.toFixed(2)} came back.` }
  return null
}

/** Settles payments made in an offline session (the stand-in's rounds follow the clock, so they can always be told). */
export async function settleLocal(who: string): Promise<Settlement[]> {
  const open = openRounds(who, 'local')
  if (!open.length) return []
  const lf = await localStandIn().state(null, open)
  return settleFrom(who, 'local', lf, lf.now, false)
}

/** Everything due for this player, from wherever: the background payouts' one call. */
export async function settleMissed(server: PotServer | null, who: string): Promise<Settlement[]> {
  const out = await settleLocal(who)
  if (server && openRounds(who, server.book).length) {
    const f = await server.state(null, openRounds(who, server.book))
    out.push(...(await settleFrom(who, server.book, f, f.now, false)))
  }
  return out
}
