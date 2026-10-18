import { carried } from '../../lib/account'
import { round2 } from '../../lib/format'
import { rand } from '../../lib/rng'
import { safeStorage } from '../../lib/storage'
import { useWallet } from '../../store/wallet'
import { BATCH_SHOTS, due, emptyLedger, fired, fizzled, flush, landed, paidOwed, parseLedger, payoutFor, recover, resolveHit, speciesOf, type BatchRecord, type FishId, type HitOutcome, type Ledger } from './rules'

/*
  Reef Raid's money, kept out of React so every path is plain to follow. The screen hands the purse each moment of
  play and it moves the coins exactly as rules.ts lays out:

  - a shot: the wallet takes its cost as it is fired (placeBet), or refuses it; the ledger counts it in the water;
  - a hit: rules.resolveHit decides it, once; the ledger records the shot as landed and a catch is paid at once,
    except a treasure chest's: its win is owed until its wheel lands (payOwed, from the screen as the chest bursts;
    tick pays it anyway should that never come), so the balance doesn't give the wheel away;
  - a fizzle (the torpedo touched nothing): its cost comes straight back;
  - a bet record every BATCH_SHOTS shots, or once the player has stopped for BATCH_IDLE_MS (wallet.settle with
    `prepaid`: the catches were paid as they happened, so the record credits nothing twice).

  The ledger is saved to localStorage on every change. When the page goes (closed, reloaded, left for another page)
  it is squared up there and then: the coins on torpedoes still in the water come back, a chest's win still owed is
  paid and the landed shots get their record (rules.recover). A ledger left behind by a page that died is squared up the same way on the next visit, once
  the player's wallet has loaded. The saved copy is written before the wallet is credited and removed before a
  recovery pays, so no path can pay twice.

  A ledger only ever touches the wallet that staked it. When the player logs in or out the app swaps the wallet and
  then starts the page over (App keys pages by player); from the moment the wallet in use is no longer the one this
  purse began with, it touches nothing again (shots are refused, hits play as misses) and leaves its saved copy for
  its owner's next visit, which squares it up into the right wallet. A guest's ledger carried into a new account (the
  account took over the guest's wallet as it signed up) is squared up into that account.
*/

export const ledgerKey = (owner: string) => `lumen.reef.ledger.${owner}`
/**
 * A chest's win is paid by now even if its wheel never reported landing (it lands about 4.4 s after the hit, on the
 * reef's clock, which runs slow on a device that can't keep 20 frames a second)
 */
const OWED_MS = 12000

/** the wallet in use, by the storage key it lives under (the guest's, or one account's) */
const walletName = () => useWallet.persist.getOptions().name ?? ''

export type FireResult = 'ok' | 'broke' | 'wait' | 'away'

export interface Best {
  id: FishId
  mult: number
  payout: number
  cost: number
}

/** the page's play since it opened, for the panel */
export interface Session {
  /** shots that landed (a fizzle is refunded, so it doesn't count) */
  shots: number
  catches: number
  spent: number
  won: number
  best: Best | null
}

/** a chest's win waiting for its wheel to land */
interface Owed {
  pay: number
  mult: number
  cost: number
  /** when it was won (performance.now()) */
  at: number
}

/** what squaring up a ledger left behind did, for the toast */
export interface Leftover {
  refund: number
  shots: number
}

export class Purse {
  ledger: Ledger = emptyLedger()
  readonly session: Session = { shots: 0, catches: 0, spent: 0, won: 0, best: null }
  /** called after each change to the session numbers */
  onChange?: () => void
  /** where the ledger is saved (also the name of the lock that keeps one tab at a time playing for this player) */
  readonly key: string
  private readonly wallet: string
  /** chest wins owed, by shot */
  private readonly owed = new Map<number, Owed>()
  private open = false
  private away = false
  /** when the last shot was fired or the last torpedo landed (for the idle record) */
  private lastMove = 0

  /** `owner`: the signed-in player's uid, or 'guest' */
  constructor(private readonly owner: string) {
    this.key = ledgerKey(owner)
    this.wallet = walletName()
  }

  /** whether the wallet in use is still the one this purse staked from (once it isn't, it never is again) */
  private mine() {
    if (!this.away && walletName() !== this.wallet) this.away = true
    return !this.away
  }

  /** the wallet is gone (the player logged in or out): this purse is done */
  get gone() {
    return !this.mine()
  }

  /**
   * Once the player's wallet has loaded: squares up any ledger a page left behind, then lets play begin (shots are
   * refused with 'wait' until then, so nothing is staked from a wallet that is about to be replaced by the server's).
   */
  start(): Leftover | null {
    if (this.open || !this.mine()) return null
    this.open = true
    const left = [takeSaved(this.key)]
    const c = this.owner === 'guest' ? null : carried()
    if (c && c.to === this.owner) left.push(takeSaved(ledgerKey('guest'), c.at))
    let refund = 0
    let shots = 0
    for (const l of left) {
      if (!l) continue
      const r = squareLedger(l, true)
      refund = round2(refund + r.refund)
      shots += r.record?.meta.shots ?? 0
    }
    return refund > 0 || shots > 0 ? { refund, shots } : null
  }

  /** the trigger wants a shot of `cost`: takes it from the wallet ('ok'), or says why not */
  fire(cost: number): FireResult {
    if (!this.mine()) return 'away'
    if (!this.open) return 'wait'
    if (!useWallet.getState().placeBet(cost)) return 'broke'
    this.ledger = fired(this.ledger, cost)
    this.moved()
    return 'ok'
  }

  /**
   * Torpedo `shot` of `cost` touched `target`, with `extras` in a bomb crab's blast or a zap jelly's chain: decides the
   * hit (the one call to resolveHit), records it and pays a catch (a chest's once its wheel lands: payOwed). Null once
   * the wallet is gone (the scene plays a miss; the torpedo stays in the saved ledger and its cost goes back to its
   * owner).
   */
  hit(shot: number, cost: number, target: FishId, extras: readonly FishId[], forced = false): HitOutcome | null {
    if (!this.mine()) return null
    // dev: a forced hit draws 0 first (a catch), then a fair draw for the chest's wheel
    let first = import.meta.env.DEV && forced
    const o = resolveHit(target, extras, () => (first ? ((first = false), 0) : rand()))
    const pay = o.caught ? payoutFor(cost, o.mult) : 0
    const later = o.caught && speciesOf(target).kind === 'chest'
    this.ledger = landed(this.ledger, cost, target, o, later)
    this.moved()
    const s = this.session
    s.shots++
    s.spent = round2(s.spent + cost)
    if (o.caught) s.catches += 1 + o.extras.length
    if (later) this.owed.set(shot, { pay, mult: o.mult, cost, at: performance.now() })
    else if (pay > 0) {
      useWallet.getState().refund(pay)
      this.won(target, o.mult, pay, cost)
    }
    // a record the moment the batch is full, not at the next tick
    if (this.ledger.shots >= BATCH_SHOTS) this.tick()
    this.onChange?.()
    return o
  }

  /** the chest caught by `shot` has opened and its wheel landed: its win is paid now */
  payOwed(shot: number) {
    const w = this.owed.get(shot)
    if (!w || !this.mine()) return
    this.owed.delete(shot)
    // the ledger stops owing it (and is saved) before the wallet is paid, as everywhere here
    this.ledger = paidOwed(this.ledger, w.pay)
    this.save()
    useWallet.getState().refund(w.pay)
    this.won('chest', w.mult, w.pay, w.cost)
    this.onChange?.()
  }

  /** a catch paid: the session's winnings and its biggest catch */
  private won(id: FishId, mult: number, pay: number, cost: number) {
    const s = this.session
    s.won = round2(s.won + pay)
    if (!s.best || pay > s.best.payout || (pay === s.best.payout && mult > s.best.mult)) s.best = { id, mult, payout: pay, cost }
  }

  /** a torpedo of `cost` touched nothing: its cost comes back */
  fizzle(cost: number) {
    if (!this.mine()) return
    this.ledger = fizzled(this.ledger, cost)
    this.moved()
    useWallet.getState().refund(cost)
  }

  /**
   * Call every so often (the screen does, every 250 ms): pays a chest win whose wheel never reported landing, and
   * writes the bet record once one is due.
   */
  tick(now = performance.now()) {
    if (!this.mine()) return
    for (const [shot, w] of this.owed) if (now - w.at > OWED_MS) this.payOwed(shot)
    if (!due(this.ledger, now - this.lastMove)) return
    const { record, next } = flush(this.ledger)
    this.ledger = next
    this.save()
    if (record) settle(record, false)
  }

  /**
   * The page is going (closing, reloading, or left for another page): the torpedoes in the water come back, the
   * landed shots get their record and the saved copy goes. Should the page stay after all (a cancelled leave), the
   * screen clears the water and play carries on with the fresh ledger, so nothing is paid twice. A purse that never
   * started has staked nothing, and the saved copy is still a page before's, waiting for the next start: it is left be.
   */
  squareUp() {
    if (!this.mine() || !this.open) return
    const l = this.ledger
    this.ledger = emptyLedger()
    safeStorage.removeItem(this.key)
    squareLedger(l, false)
    // the owed chest wins were paid with it
    for (const w of this.owed.values()) this.won('chest', w.mult, w.pay, w.cost)
    this.owed.clear()
  }

  private moved() {
    this.lastMove = performance.now()
    this.save()
  }

  private save() {
    const l = this.ledger
    if (l.bullets === 0 && l.shots === 0 && l.owed === 0) safeStorage.removeItem(this.key)
    // `at` tells a carried guest ledger from a later guest's (see start)
    else safeStorage.setItem(this.key, JSON.stringify({ ...l, at: Date.now() }))
  }
}

function settle(r: BatchRecord, recovered: boolean) {
  useWallet.getState().settle({ game: 'reef', bet: r.bet, payout: r.payout, prepaid: r.prepaid, meta: recovered ? { ...r.meta, recovered: true } : r.meta })
}

/** a ledger whose torpedoes will never land: refunds what is still in the water, pays what is owed and records the landed shots */
function squareLedger(l: Ledger, recovered: boolean) {
  const r = recover(l)
  if (r.refund > 0) useWallet.getState().refund(r.refund)
  if (r.record) settle(r.record, recovered)
  return r
}

/** the ledger a page left saved under `key` (only one saved before `before`, when given), taken out of storage */
function takeSaved(key: string, before?: number): Ledger | null {
  const raw = safeStorage.getItem(key)
  if (raw == null) return null
  let data: unknown = null
  try {
    data = JSON.parse(raw)
  } catch {
    /* a damaged entry: dropped below */
  }
  if (before != null && !(Number((data as { at?: unknown } | null)?.at) < before)) return null
  safeStorage.removeItem(key)
  return parseLedger(data)
}
