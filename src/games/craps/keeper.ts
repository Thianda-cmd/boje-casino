import { carried } from '../../lib/account'
import { round2 } from '../../lib/format'
import { useWallet } from '../../store/wallet'
import { canRemove, dependents, isHard, maxStake, newTable, onTable, resolveRoll, type BetKey, type Bets, type Roll, type RollResult, type Table } from './rules'
import { dropSaved, loadSaved, tableKey, writeSaved, type InPlay } from './storage'

/*
  Craps' money, kept out of React so every path is plain to follow (as Reef Raid's purse is). The keeper holds the
  player's table and moves the coins exactly as the spec and rules.ts lay out:

  - a chip placed: the wallet takes it at once (placeBet), within what rules.maxStake allows on that spot now;
  - a bet taken down (only when rules.canRemove allows): the wallet gets it back (refund), and odds resting on it
    come down with it, or down to what the smaller bet still allows (rules.dependents);
  - a roll: the dice are drawn by the screen and worked out here (rules.resolveRoll) the moment Roll is pressed, and
    saved as the roll in play before anything moves;
  - the roll paid (settle): when the dice land, or as the page goes, or on the next visit if the page died first. In
    one go: the round's record (wallet.settle: the stakes it decided, what came back), the stakes of place bets that
    won and stay up taken again (placeBet), and the table after the roll saved with no roll in play.

  The table is saved after every change (storage.ts: one record holds the table and the roll in play, written after
  the wallet's own changes), so whatever moment the page dies at, the next visit finds the same coins: the chips on
  the table, and a roll in play paid exactly once.

  A keeper only ever touches the wallet that staked it. When the player logs in or out the app swaps the wallet and
  starts the page over; from the moment the wallet in use is no longer the one this keeper began with, it touches
  nothing again and leaves its saved table for its owner's next visit. A guest's table carried into a new account
  (the account took over the guest's wallet as it signed up) comes over with it.
*/

/** the wallet in use, by the storage key it lives under (the guest's, or one account's) */
const walletName = () => useWallet.persist.getOptions().name ?? ''

/** why a chip or a roll was refused */
export type Refusal =
  /** the wallet is not this keeper's any more (the page is about to start over) */
  | 'away'
  /** the table hasn't opened yet (the player's wallet is still loading) */
  | 'wait'
  /** a roll is in play */
  | 'rolling'
  /** this bet can't be made now (rules.maxStake is 0) */
  | 'closed'
  /** the spot is at its limit */
  | 'limit'
  /** not enough coins */
  | 'coins'
  /** this bet can't be taken down now (rules.canRemove) */
  | 'stays'

export type Placed = { ok: true; amount: number; max: number } | { ok: false; why: Refusal; max: number }
export type Removed = { ok: true; refund: number; trimmed: BetKey[] } | { ok: false; why: Refusal }

/** what opening the table found and did */
export interface Opened {
  /** rolls a page left unpaid, paid now (this player's, and a carried guest table's) */
  recovered: RollResult[]
  /** coins of a carried guest table that couldn't join this one (it had bets of its own), given back */
  refund: number
}

export class Keeper {
  table: Table = newTable()
  /** the roll in play: drawn and worked out, not yet paid */
  pending: InPlay | null = null
  /** the bets of the last come-out roll, for Rebet */
  rebet: Bets | null = null
  /** where the table is saved (also the name of the lock that keeps one tab at a time playing for this player) */
  readonly key: string
  private readonly wallet: string
  private open = false
  private away = false

  /** `owner`: the signed-in player's uid, or 'guest' */
  constructor(private readonly owner: string) {
    this.key = tableKey(owner)
    this.wallet = walletName()
  }

  /** whether the wallet in use is still the one this keeper staked from (once it isn't, it never is again) */
  private mine() {
    if (!this.away && walletName() !== this.wallet) this.away = true
    return !this.away
  }

  get opened() {
    return this.open
  }

  /**
   * Once the player's wallet has loaded (and this tab holds the table): loads the saved table, pays a roll a page
   * left unpaid, brings over a guest table carried into this account, and opens the table for play. Null if it was
   * open already, or the wallet is no longer this keeper's.
   */
  start(): Opened | null {
    if (this.open || !this.mine()) return null
    this.open = true
    const out: Opened = { recovered: [], refund: 0 }
    const s = loadSaved(this.key)
    if (s) {
      this.table = s.table
      this.rebet = s.rebet
      this.pending = s.pending
      const r = this.settle(true)
      if (r) out.recovered.push(r)
    }
    const c = this.owner === 'guest' ? null : carried()
    if (c && c.to === this.owner) {
      const gk = tableKey('guest')
      const g = loadSaved(gk)
      if (g && g.at < c.at) {
        // out of storage before anything is paid from it, so it can never be paid twice
        dropSaved(gk)
        let gt = g.table
        if (g.pending) {
          const r = resolveRoll(gt, g.pending.dice)
          gt = this.pay(r, true)
          out.recovered.push(r)
        }
        if (!onTable(this.table)) this.table = gt
        else {
          out.refund = onTable(gt)
          if (out.refund > 0) useWallet.getState().refund(out.refund)
        }
        this.save()
      }
    }
    return out
  }

  private ready(): Refusal | null {
    if (!this.mine()) return 'away'
    if (!this.open) return 'wait'
    if (this.pending) return 'rolling'
    return null
  }

  /**
   * Puts up to `want` coins on `key`: as much as the spot may still take (rules.maxStake) and the balance covers
   * (whole coins when it is the balance that runs short). The amount placed, or why nothing was.
   */
  place(key: BetKey, want: number): Placed {
    const max = maxStake(this.table, key)
    const why = this.ready()
    if (why) return { ok: false, why, max }
    if (max <= 0) return { ok: false, why: 'closed', max }
    const cur = this.table.bets[key] ?? 0
    const room = round2(max - cur)
    if (room < 0.01) return { ok: false, why: 'limit', max }
    const balance = useWallet.getState().balance
    let add = round2(Math.min(want, room))
    if (add > balance) add = Math.floor(balance)
    if (add < 0.01 || !useWallet.getState().placeBet(add, 0.01)) return { ok: false, why: 'coins', max }
    this.table = { ...this.table, bets: { ...this.table.bets, [key]: round2(cur + add) } }
    this.save()
    return { ok: true, amount: add, max }
  }

  /**
   * Puts several bets up at once (Rebet): all of them or none, as one stake from the wallet. `adds`: coins to add per
   * bet, each already within its limit (rebetAdds).
   */
  putMany(adds: Bets): Refusal | null {
    const why = this.ready()
    if (why) return why
    const total = round2(Object.values(adds).reduce((a, v) => a + (v ?? 0), 0))
    if (!(total > 0)) return 'limit'
    if (total > useWallet.getState().balance || !useWallet.getState().placeBet(total, 0.01)) return 'coins'
    const bets = { ...this.table.bets }
    for (const [k, v] of Object.entries(adds) as [BetKey, number][]) bets[k] = round2((bets[k] ?? 0) + v)
    this.table = { ...this.table, bets }
    this.save()
    return null
  }

  /** what Rebet would put up now: the last come-out's bets that can be made now, up to their amounts then */
  rebetAdds(): Bets {
    const out: Bets = {}
    if (!this.rebet) return out
    for (const [k, want] of Object.entries(this.rebet) as [BetKey, number][]) {
      const cur = this.table.bets[k] ?? 0
      const add = round2(Math.min(want, maxStake(this.table, k)) - cur)
      if (add >= 0.01) out[k] = add
    }
    return out
  }

  /**
   * Takes up to `amount` off `key` (Infinity: all of it), if it may come down now. Odds resting on it come down with
   * it, or down to what the smaller bet still allows; all of it goes back to the wallet.
   */
  remove(key: BetKey, amount: number): Removed {
    const why = this.ready()
    if (why) return { ok: false, why }
    const cur = this.table.bets[key] ?? 0
    if (!cur) return { ok: false, why: 'closed' }
    if (!canRemove(this.table, key)) return { ok: false, why: 'stays' }
    const take = round2(Math.min(cur, amount))
    const bets = { ...this.table.bets }
    if (round2(cur - take) > 0) bets[key] = round2(cur - take)
    else delete bets[key]
    let refund = take
    const trimmed: BetKey[] = []
    const next: Table = { ...this.table, bets }
    for (const d of dependents(key)) {
      const on = bets[d] ?? 0
      const max = maxStake(next, d)
      if (on > max) {
        refund = round2(refund + on - max)
        if (max > 0) bets[d] = max
        else delete bets[d]
        trimmed.push(d)
      }
    }
    useWallet.getState().refund(refund)
    this.table = next
    this.save()
    return { ok: true, refund, trimmed }
  }

  /** takes down everything that may come down now (contract bets stay); the coins given back */
  clear(): number {
    let back = 0
    // flat bets first, so their odds come down with them; then odds left resting on bets that stay up
    const keys = (Object.keys(this.table.bets) as BetKey[]).sort((a, b) => Number(a.includes('Odds')) - Number(b.includes('Odds')))
    for (const k of keys) {
      if (!this.table.bets[k] || !canRemove(this.table, k)) continue
      const r = this.remove(k, Infinity)
      if (r.ok) back = round2(back + r.refund)
    }
    return back
  }

  setWorking(on: boolean) {
    if (this.ready() || this.table.working === on) return false
    this.table = { ...this.table, working: on }
    this.save()
    return true
  }

  /**
   * Throws `dice` against the table: works the roll out and saves it as the roll in play, before anything moves.
   * The result is for the screen to show; the money moves at settle(). Null if a roll can't be thrown now.
   */
  roll(dice: Roll): RollResult | null {
    if (this.ready() || !onTable(this.table)) return null
    const r = resolveRoll(this.table, dice)
    if (this.table.point === null) this.rebet = { ...this.table.bets }
    this.pending = { dice: [dice[0], dice[1]], t: Date.now() }
    this.save()
    return r
  }

  /**
   * Pays the roll in play, once: when its dice land, as the page goes, or on the next visit. Null when there is none
   * (it was paid already) or the wallet is no longer this keeper's (it waits, saved, for its owner).
   */
  settle(recovered = false): RollResult | null {
    const p = this.pending
    if (!p || !this.mine()) return null
    const r = resolveRoll(this.table, p.dice)
    this.pending = null
    this.table = this.pay(r, recovered)
    this.save()
    return r
  }

  /** a roll's money: the round's record and its payout, then the stakes of place bets that stay up; the table after */
  private pay(r: RollResult, recovered: boolean): Table {
    const w = useWallet.getState()
    if (r.wagered > 0) {
      const meta = { points: r.after.shooter.points.length, total: r.total, event: r.event, hard: isHard(r.dice) }
      w.settle({ game: 'craps', bet: r.wagered, payout: r.returned, meta: recovered ? { ...meta, recovered: true } : meta })
    }
    if (r.replaced > 0 && !w.placeBet(r.replaced, 0.01)) {
      // never expected (those stakes were just paid back): the bets come down rather than stay up unpaid for
      const bets = { ...r.after.bets }
      for (const x of r.results) if (x.outcome === 'win-stays') delete bets[x.key]
      return { ...r.after, bets }
    }
    return r.after
  }

  private save() {
    writeSaved(this.key, { table: this.table, pending: this.pending, rebet: this.rebet })
  }
}
